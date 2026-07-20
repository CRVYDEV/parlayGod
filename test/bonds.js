// THE RESERVE BOND test (the 30th suite) — Protocol-Owned Liquidity via a disciplined treasury bond
// (Olympus Pro, without the mint). Real-value / OUT-OF-BAND: bonds write ZERO in-game `transactions` rows,
// so the §10.4 sweep stays untouched. Covers: fund the tranche, record a bond (the discounted payout + the
// POL/Vig ETH split), the ANTI-PONZI cap (committed ≤ capacity → over_capacity), idempotency (duplicate
// nonce), claim (linear vesting), the bond invariant, the Vig integration (bond ETH feeds the buyback), and
// §10.4-IN-GAME-UNTOUCHED (the sweep is drift-free through a bond run). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
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
assert.equal(rec.body.polEth, 1.2, '60% of the ETH → Protocol-Owned Liquidity');
assert.equal(rec.body.vigEth, 0.8, '40% → the Vig buyback (reserve + prizes)');

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
assert.equal(vigBond, 0.8, 'the bond routed its Vig share into the flywheel');

// ── the board surfaces the offering + your bond + the Treasury Backer status ──
const board = (await call('GET', '/v1/bonds', { token: bonder.token })).body;
assert.equal(board.reserve.committedOmr, expectPayout, 'the board shows the committed tranche');
assert.equal(board.reserve.remainingOmr, 100000 - expectPayout, 'and the remaining capacity');
assert.equal(board.reserve.polEth, 1.2, 'and the POL acquired');
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
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'")).rows[0].s), vigBefore, 'the vig_revenue basis is UNMOVED by a comp — the reserve can never be unbacked by a comp');
assert((await runBondInvariants(pool)).ok, 'the bond invariant still holds with a comp in the mix (ETH split reconciles over REAL bonds only)');
assert((await runVigInvariants(pool)).ok, 'the Vig invariant holds — a comp added no spendable buyback basis');

// ── §10.4 in-game STILL untouched after claims ──
assert(await inGameOk(), 'in-game §10.4 clean through the whole bond lifecycle');

console.log('✅ The Reserve Bond test passed — fund the tranche, record a bond (the discounted payout + the 60/40 POL/Vig ETH split), the ANTI-PONZI cap (committed ≤ capacity → over_capacity), idempotency (duplicate nonce = no-op), the bond invariant (committed==Σpayout, ≤capacity, claimed≤committed, ETH-split==principal, discounts capped), the Vig integration (bond ETH feeds the buyback → reserve+prizes), CLAIM (linear vesting → full claim → nothing left), the Treasury Backer status, and §10.4 IN-GAME UNTOUCHED (bonds are out-of-band real value — zero transactions rows — so the sweep stays drift-free through the whole lifecycle)');
await app.close();
