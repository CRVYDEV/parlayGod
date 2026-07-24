// THE RESERVE BOND test (the 30th suite) — Protocol-Owned Liquidity via a disciplined treasury bond
// (Olympus Pro, without the mint). Real-value / OUT-OF-BAND: bonds write ZERO in-game `transactions` rows,
// so the §10.4 sweep stays untouched. Covers: fund the tranche, record a bond (the discounted payout + the
// POL/Vig ETH split), the ANTI-PONZI cap (committed ≤ capacity → over_capacity), idempotency (duplicate
// nonce), claim (linear vesting), the bond invariant, the Vig integration (bond ETH feeds the buyback), and
// §10.4-IN-GAME-UNTOUCHED (the sweep is drift-free through a bond run). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA: let the mod route drive the real-revenue flywheel (D-MED2 gate)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BONDS, bondPayout } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runBondInvariants, reconcileBonds } from '../src/bonds.js';
import { runVigInvariants } from '../src/vig.js';

const app = await buildServer();
const pool = app.pool;
const mod = 'test-mod-key';
const call = async (method, url, { token, body, modkey } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (modkey) headers['x-mod-key'] = modkey;
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const bonder = await (async () => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name: 'Meyer Bonds' } });
  const aid = (await pool.query('SELECT account_id a FROM characters LIMIT 1')).rows[0].a;
  return { token, aid };
})();

// ── the in-game §10.4 sweep is clean at the start (bonds must never perturb it) ──
const inGameOk = async () => (await runLedgerInvariants(pool)).checks.every((c) => c.ok);
assert(await inGameOk(), 'in-game §10.4 clean before bonds');

// ── FUND the tranche + record a bond ──
const fund = await call('POST', '/v1/mod/bond/fund', { modkey: mod, body: { omr: 100000 } });
assert.equal(fund.body.capacityOmr, 100000, 'the treasury budgeted 100k OMR for bonding');
const expectPayout = bondPayout(2, 5000, 800); // 2 ETH × 5000 / 0.92 = 10,869.565…
// a REAL on-chain-driven bond (txHash present) books the full POL/Vig accounting
const rec = await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 1, account: bonder.aid, principalEth: 2, price: 5000, discountBps: 800, txHash: '0xrealbond01' } });
assert.equal(rec.code, 200, 'the bond is recorded');
assert.equal(rec.body.payoutOmr, expectPayout, 'the discounted payout is right (2 ETH @5000, 8% discount)');
assert.equal(rec.body.polEth, 1.0, '50% of the ETH → Protocol-Owned Liquidity');
assert.equal(rec.body.devEth, 0.4, '20% → the dev wallet (founder revenue)');
assert.equal(rec.body.vigEth, 0.6, '30% → the Vig buyback (reserve + prizes)');

// ── THE ANTI-PONZI CAP: the treasury can never promise more OMR than it budgeted ──
const over = await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 2, account: bonder.aid, principalEth: 50, price: 5000, discountBps: 800 } });
assert.equal(over.body.error, 'over_capacity', 'a bond past the tranche is rejected (never over-budget)');
// ── idempotency: a re-delivered bond (reorg / watcher restart) is a clean no-op ──
const dup = await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 1, account: bonder.aid, principalEth: 2, price: 5000, discountBps: 800 } });
assert.equal(dup.body.duplicate, true, 'a duplicate nonce is a no-op (not double-counted)');

// ── the bond invariant (the real-value side) holds ──
let bi = await runBondInvariants(pool);
assert(bi.ok, `bond invariant holds: ${JSON.stringify(bi.checks.filter((c) => !c.ok))}`);
assert.equal(bi.checks.find((c) => c.name === 'bond committed == Σ payout').ok, true, 'committed matches the rows');
assert.equal(bi.checks.find((c) => c.name === 'bond ETH split == principal').ok, true, 'POL + Vig == principal (nothing skimmed)');

// ── §10.4 IN-GAME IS UNTOUCHED — bonds wrote zero `transactions` rows (the fees.js precedent) ──
assert(await inGameOk(), 'in-game §10.4 STILL clean after a bond (bonds are out-of-band, zero transactions rows)');
// ── the Vig invariant still holds — the bond's Vig share is legitimate revenue the buyback can spend ──
assert((await runVigInvariants(pool)).ok, 'the Vig invariant holds with the bond revenue in the mix');
const vigBond = Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s);
assert.equal(vigBond, 0.6, 'the bond routed its Vig share into the flywheel');

// ── the board surfaces the offering + your bond + the Treasury Backer status ──
const board = (await call('GET', '/v1/bonds', { token: bonder.token })).body;
assert.equal(board.reserve.committedOmr, expectPayout, 'the board shows the committed tranche');
assert.equal(board.reserve.remainingOmr, 100000 - expectPayout, 'and the remaining capacity');
assert.equal(board.reserve.polEth, 1.0, 'and the POL acquired');
assert.equal(board.reserve.devEth, 0.4, 'and the dev share recorded');
assert(board.isBacker, 'the bonder is a Treasury Backer (pure status)');
assert.equal(board.yours.length, 1, 'their bond is on the board');
const bondId = board.yours[0].id;

// ── CLAIM: linear vesting. Warp the bond fully vested, claim the payout; a second claim has nothing left ──
assert(board.yours[0].claimableOmr < expectPayout, 'nothing (or little) vested immediately');
await pool.query(`UPDATE bonds SET opened_at = now() - interval '200 hours' WHERE id='${bondId}'`); // past the 120h vest
const claim = await call('POST', `/v1/bonds/${bondId}/claim`, { token: bonder.token });
assert.equal(claim.code, 200, 'the fully-vested payout claims');
assert.equal(claim.body.claimed, expectPayout, 'the whole payout vested and claimed');
assert.equal((await call('POST', `/v1/bonds/${bondId}/claim`, { token: bonder.token })).body.error, 'nothing', 'a second claim has nothing left');
// bond invariant still holds after claims (claimed ≤ committed)
bi = await runBondInvariants(pool);
assert(bi.ok, 'bond invariant holds after the claim');
assert.equal(bi.checks.find((c) => c.name === 'bond claimed ≤ committed').ok, true, 'never over-claimed');

// ── PARKED bond → reconcile-at-link (audit LOW-1): a bond made BEFORE the wallet linked is attributable + claimable ──
const wallet = '0x0000000000000000000000000000000000000abc';
const parked = await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 7, payer: wallet, principalEth: 1, price: 5000, discountBps: 800 } });
assert.equal(parked.body.recorded, true, 'a bond from an unlinked wallet still records (committed against the tranche)');
assert.equal(parked.body.attributed, false, 'but it is PARKED (no account yet)');
assert.equal((await call('GET', '/v1/bonds', { token: bonder.token })).body.yours.length, 1, 'the parked bond is NOT on the bonder board yet');
const rc = await reconcileBonds(pool, bonder.aid, wallet); // the wallet links → attribute the pre-link bond (walletVerify calls this)
assert.equal(rc.attributed, 1, 'reconcile-at-link attributes the parked bond to the freshly-linked account');
const after = (await call('GET', '/v1/bonds', { token: bonder.token })).body.yours;
assert.equal(after.length, 2, 'the reconciled bond is now claimable by the bonder');

// ── audit MED: a COMP bond (mod simulate with NO txHash) books the OMR tranche for QA but injects
//    ZERO real-ETH Vig/POL — else a comp fabricates buyback basis that unbacks the withdrawal reserve. ──
const vigBefore = Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s);
const comp = await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 3, account: bonder.aid, principalEth: 1, price: 5000, discountBps: 800 } });
assert.equal(comp.body.recorded, true, 'the comp bond records (books the tranche commitment)');
assert.equal(comp.body.real, false, 'the comp bond is not real-ETH-backed');
assert.equal(comp.body.vigEth, 0, 'the comp injects ZERO Vig buyback basis');
assert.equal(comp.body.polEth, 0, 'the comp injects ZERO POL');
assert.equal(comp.body.devEth, 0, 'the comp injects ZERO dev revenue');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s), vigBefore, 'the vig_revenue basis is UNMOVED by a comp — the reserve can never be unbacked by a comp');
assert((await runBondInvariants(pool)).ok, 'the bond invariant still holds with a comp in the mix (ETH split reconciles over REAL bonds only)');
assert((await runVigInvariants(pool)).ok, 'the Vig invariant holds — a comp added no spendable buyback basis');

// ── §10.4 in-game STILL untouched after claims ──
assert(await inGameOk(), 'in-game §10.4 clean through the whole bond lifecycle');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNDERWRITER (Tier-4) — the off-chain backer-prestige pillar: THE PLEDGE ($OMR sink) + THE CHARTER
// (sequential seal) + the read-derived Underwriters' League / Financier crown / Family Syndicate.
// ════════════════════════════════════════════════════════════════════════════════════════════════
let grantedOmr = 0; // track the SQL-seeded $OMR (the only unledgered mint — everything else reconciles as a bond: burn)
const grantOmr = async (aid, omr) => { await pool.query('UPDATE account_persistent SET omr = omr + $1 WHERE account_id=$2', [omr, aid]); grantedOmr += omr; };
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const row = (await pool.query('SELECT id, account_id FROM characters WHERE name=$1 AND alive LIMIT 1', [name])).rows[0];
  return { token, aid: row.account_id, cid: row.id };
};
const pledgedOf = async (aid) => Number((await pool.query('SELECT pledged_omr v FROM account_persistent WHERE account_id=$1', [aid])).rows[0].v);
const charterOfAcct = async (aid) => Number((await pool.query('SELECT bond_charter v FROM account_persistent WHERE account_id=$1', [aid])).rows[0].v);

// ── (A) THE PLEDGE — the live-now $OMR sink ──
const alice = await mk('Alice Underwriter');
await grantOmr(alice.aid, 5000);
assert.equal((await call('POST', '/v1/bonds/pledge', { token: alice.token, body: { omr: 5 } })).body.error, 'min', 'a pledge below PLEDGE_MIN is rejected');
const pl = await call('POST', '/v1/bonds/pledge', { token: alice.token, body: { omr: 500 } });
assert.equal(pl.code, 200, `pledge landed: ${JSON.stringify(pl.body)}`);
assert.equal(await pledgedOf(alice.aid), 500, 'pledged_omr banked the pledge (account legend)');
assert.equal(pl.body.standing.pledgedOmr, 500, 'the standing reflects the pledge');
assert.equal(pl.body.standing.score, 500, 'score == pledge (no bonds)');
assert.equal(pl.body.standing.tier, 'Patron', 'score 500 → Patron tier');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='bond:pledge' AND account_id='${alice.aid}'`)).rows[0].s) === -500, 'bond:pledge is a ledgered $OMR burn (-500)');
// over-pledge: more $OMR than held → the spendOmr 'omr' error (alice has 4500 left)
assert.equal((await call('POST', '/v1/bonds/pledge', { token: alice.token, body: { omr: 99999 } })).body.error, 'omr', 'you cannot pledge $OMR you do not hold');

// ── (B) THE CHARTER — sequential seals, backer-gated ──
const c1 = await call('POST', '/v1/bonds/charter', { token: alice.token });
assert.equal(c1.code, 200); assert.equal(c1.body.charter, 1, 'commissioned the Bronze Charter'); assert.equal(c1.body.spent, 25);
assert.equal(await charterOfAcct(alice.aid), 1, 'bond_charter == 1');
const c2 = await call('POST', '/v1/bonds/charter', { token: alice.token });
assert.equal(c2.body.charter, 2, 'the next call buys the Silver Charter (sequential)'); assert.equal(c2.body.spent, 75);
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='bond:charter' AND account_id='${alice.aid}'`)).rows[0].s) === -100, 'bond:charter ledgered (-25 -75)');
// a fresh account with score 0 cannot commission a charter
const bob = await mk('Bob NoBacker');
assert.equal((await call('POST', '/v1/bonds/charter', { token: bob.token })).body.error, 'not_backer', 'a non-backer cannot commission a charter');

// ── (C) BACKER TIER DERIVATION — the combined ETH + pledge score ──
const whale = await mk('Whale Financier');
await grantOmr(whale.aid, 2000);
await call('POST', '/v1/bonds/pledge', { token: whale.token, body: { omr: 1000 } });
// a 2-ETH bond to the whale → derivedBondedEth 2 → score = 1000 + 2×5000 = 11000
await call('POST', '/v1/mod/bond/simulate', { modkey: mod, body: { nonce: 20, account: whale.aid, principalEth: 2, price: 5000, discountBps: 800, txHash: '0xwhalebond' } });
const wStand = (await call('GET', '/v1/bonds', { token: whale.token })).body.yourStanding;
assert.equal(wStand.bondedEth, 2, 'the whale bonded 2 ETH (read-derived)');
assert.equal(wStand.score, 11000, 'underwriterScore == pledge + bondedEth × ETH_SCORE_OMR (1000 + 2×5000)');
assert.equal(wStand.tier, 'Financier', 'score 11000 → the Financier tier');

// ── (D) THE UNDERWRITERS' LEAGUE + the Financier crown + agent exclusion ──
let lb = (await call('GET', '/v1/leaderboard/underwriters', { token: alice.token })).body;
assert(lb.league.some((e) => e.name === 'Whale Financier'), 'the whale is on the league (a real backer)');
assert.equal(lb.league[0].financier, true, 'the top backer wears the Financier crown (exactly one)');
assert.equal(lb.league.filter((e) => e.financier).length, 1, 'the crown is unique');
const topBefore = lb.league[0].name; // whoever currently leads (an earlier bonder outranks the fresh whale)
// an agent with a huge (would-be-top) pledge never appears (excluded like referral payouts)
const spook = await mk('Spook Agent');
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [spook.aid]);
await grantOmr(spook.aid, 60000);
await call('POST', '/v1/bonds/pledge', { token: spook.token, body: { omr: 50000 } });
lb = (await call('GET', '/v1/leaderboard/underwriters', { token: alice.token })).body;
assert(!lb.league.some((e) => e.name === 'Spook Agent'), 'an agent_flag backer never appears on the league');
assert.equal(lb.league[0].name, topBefore, 'the crown did NOT go to the agent (still the prior top)');
// the crown is READ-DERIVED — a bigger pledge by a new account flips it (25000 > any standing backer)
const titan = await mk('Titan Reserve');
await grantOmr(titan.aid, 26000);
await call('POST', '/v1/bonds/pledge', { token: titan.token, body: { omr: 25000 } });
lb = (await call('GET', '/v1/leaderboard/underwriters', { token: alice.token })).body;
assert.equal(lb.league[0].name, 'Titan Reserve', 'the biggest pledge flips the crown (recomputed on read)');
assert.equal(lb.league[0].financier, true, 'Titan now wears the crown');
assert.equal(lb.league.find((e) => e.name === topBefore).financier, false, 'the prior top lost the crown');

// ── (E) THE FAMILY SYNDICATE — a gang's summed roster score ──
// seed a gang with the whale (boss) + titan on its roster (SQL — a light gang, the syndicate is a read)
await pool.query(`INSERT INTO gangs (id, name, tag) VALUES ('synd-gang','The Syndicate','SYN')`);
await pool.query(`INSERT INTO gang_members (gang_id, character_id, role, joined_at) VALUES ('synd-gang','${whale.cid}','boss',now()), ('synd-gang','${titan.cid}','soldier',now())`);
lb = (await call('GET', '/v1/leaderboard/underwriters', { token: alice.token })).body;
const syn = lb.syndicate.find((g) => g.name === 'The Syndicate');
assert(syn, 'the family appears on the syndicate board');
assert.equal(syn.backers, 2, 'both backers counted');
assert.equal(syn.score, 11000 + 25000, "the syndicate sums its roster's scores (whale 11000 + titan 25000)");

// ── (F) §10.4 — the vocabulary knows bond:; the burns reconcile; only the SQL grant drifts ──
const inv = await runLedgerInvariants(pool);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'bond: is enumerated (no unknown-reason alarm)');
const bondBurns = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason LIKE 'bond:%'")).rows[0].s);
const totalSpent = 500 + 100 + 1000 + 50000 + 25000; // alice pledge+charters, whale pledge, spook pledge, titan pledge
assert.equal(bondBurns, totalSpent, 'every $OMR pledge/charter reconciles as a bond: burn');
const cons = inv.checks.find((c) => c.name === '$OMR conservation');
assert(Math.abs((cons.lhs - cons.rhs) - grantedOmr) < 0.01, 'the only $OMR conservation drift is the SQL-seeded grant (the burns are all ledgered)');

// ── (G) DEATH SURVIVAL — the backer legend + charter are account-level (survive death) ──
const wPledged = await pledgedOf(whale.aid), wCharter = await charterOfAcct(whale.aid);
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': mod }, payload: { characterId: whale.cid } });
assert.equal(await pledgedOf(whale.aid), wPledged, 'pledged_omr survives death (account legend)');
assert.equal(await charterOfAcct(whale.aid), wCharter, 'bond_charter survives death');
const wEth = Number((await pool.query('SELECT COALESCE(SUM(principal_eth),0) s FROM bonds WHERE account_id=$1', [whale.aid])).rows[0].s);
assert.equal(wEth, 2, 'bonded_eth still read-derives from the surviving bonds rows after death');

// ── (H) bonds are STILL out-of-band — the whole underwriter lifecycle wrote zero perturbation of the sweep ──
assert((await runBondInvariants(pool)).ok, 'the bond invariant still holds through the underwriter lifecycle');

console.log('✅ THE UNDERWRITER (Reserve Bond Tier-4) test passed — THE PLEDGE (min gate, ledgered bond:pledge burn, over-pledge → omr), THE CHARTER (sequential Bronze→Silver seals, not_backer gate, ledgered bond:charter), backer-tier derivation (pledge + bondedEth×ETH_SCORE_OMR → Financier), THE UNDERWRITERS LEAGUE + the read-derived Financier crown (agent excluded, the crown flips on a bigger pledge), THE FAMILY SYNDICATE (summed roster score), §10.4 (bond: enumerated + every burn reconciles + the only drift is the SQL seed), and DEATH SURVIVAL (pledged_omr/bond_charter/bonded_eth all survive the estate)');

console.log('✅ The Reserve Bond test passed — fund the tranche, record a bond (the discounted payout + the 50/20/30 POL/Dev/Vig ETH split), the ANTI-PONZI cap (committed ≤ capacity → over_capacity), idempotency (duplicate nonce = no-op), the bond invariant (committed==Σpayout, ≤capacity, claimed≤committed, ETH-split==principal, discounts capped), the Vig integration (bond ETH feeds the buyback → reserve+prizes), CLAIM (linear vesting → full claim → nothing left), the Treasury Backer status, and §10.4 IN-GAME UNTOUCHED (bonds are out-of-band real value — zero transactions rows — so the sweep stays drift-free through the whole lifecycle)');
await app.close();
