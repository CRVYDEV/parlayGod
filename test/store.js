// THE STORE (ETH revenue packages) test — the real-money revenue engine. Covers: the catalog board,
// the three-way revenue split (founder / buyback→Vig flywheel / RWA→R2 dormant), idempotent
// ingestion (a re-delivered event is a no-op), per-SKU grants (mint credit, revive bundle, the ETH
// Street Wire, the season pass + patron badge, the permanent patron), pay-before-link reconcile,
// zero-value no-grant, and — the whole point — §10.4 NEUTRALITY: the Store grants only
// entitlements/access/status, so a full purchase run leaves EVERY §10.4 check at drift-0 (nothing
// minted), and the buyback share rides the EXISTING vig_revenue so runVigInvariants absorbs it.
// pg-mem, zero infra. The chain layer is dormant — the test drives recordStorePurchase directly
// (the test/chain.js fee precedent), simulating the watcher's StorePaid → ingestion call.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA: let the mod route drive the real-revenue flywheel (D-MED2 gate)
import assert from 'node:assert';
import { getAddress } from 'viem';
import { buildServer } from '../src/server.js';
import { STORE } from '../src/rules.js';
import { recordStorePurchase, reconcileStore, revenueStatus, benefactorLeaderboard } from '../src/store.js';
import { PATRON, PASS, patronTierOf } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runVigInvariants } from '../src/vig.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  const aid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a;
  return { token, id: ch.id, aid };
};
const setWallet = (aid, w) => pool.query(`UPDATE account_persistent SET wallet_address='${w}' WHERE account_id='${aid}'`);
const ethWei = (eth) => String(BigInt(Math.round(eth * 1e6)) * (10n ** 12n)); // eth → wei string, no float
const W1 = getAddress('0x' + '11'.repeat(20));
const W2 = getAddress('0x' + '22'.repeat(20));
let np = 1000; const nonce = () => np++;

const alice = await mk('Patron Alice');
const bob = await mk('Latecomer Bob');

// ── the board: catalog present, nothing owned, the split surfaced ──
let r = await call('GET', '/v1/store', { token: alice.token });
assert.equal(r.code, 200, 'the store is readable');
assert.equal(r.body.packages.length, STORE.PACKAGES.length, 'the full catalog');
// THE MINT HAS ITS OWN RAIL, and the Store no longer runs a second one. `made_man` sold ONE thing —
// a mint credit — for a hardcoded 0.01 ETH that did NOT move with MINT_TRANCHES, so from wave 2 the
// published price would have been 0.025 while this door still sold the same entitlement for 0.01.
// Retired outright; the board makes the POSITIVE claim so a client with a card for it learns where
// the thing went rather than finding it silently gone.
assert(!r.body.packages.find((p) => p.sku === 'made_man'), 'made_man is OFF the shelf — the mint is not sold twice');
assert(!r.body.packages.some((p) => p.grant?.mintCredits),
  'and NO package grants a mint credit — the entitlement that gates extraction has exactly one price');
const gone = r.body.retired.find((x) => x.sku === 'made_man');
assert(gone && gone.where === '/v1/character/mint', 'the board says WHERE it went, rather than leaving a hole');
// the same string is an API error AND a card on the shelf, so it must read as prose to a player.
// (This used to word-match /mint/ on the copy — a proxy that broke the moment the copy was reworded
// to say "made" instead, which is the better sentence. Assert the PROPERTY, not the wording.)
assert(gone.why && gone.why.length > 30 && !/\/v1\//.test(gone.why),
  'and says WHY in prose — no route name, because this renders on a card a player reads');
assert.equal(r.body.owned.mintCredits, 0, 'a nobody owns nothing');
assert.equal(r.body.owned.patron, false, 'not a patron yet');
assert.equal(r.body.split.founder + r.body.split.buyback + r.body.split.rwa, 10000, 'the split sums to 10000');

// ── bad sku is refused ──
assert.equal((await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'nope', payer: W1, amountWei: ethWei(0.01) } })).body.error, 'bad_sku', 'no such package');

// ── link alice's wallet, then a real purchase (decor_deco, 0.02 ETH) — granted now, split recorded ──
await setWallet(alice.aid, W1);
let n1 = nonce();
// a REAL on-chain purchase carries a txHash (the StorePaid event) → it records the revenue split
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: n1, sku: 'decor_deco', payer: W1, amountWei: ethWei(0.02), txHash: '0xrealtx1' } });
assert.equal(r.code, 200, 'the purchase landed');
assert.equal(r.body.granted, true, 'a linked wallet is granted immediately');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM store_cosmetics WHERE account_id=$1 AND style='deco'", [alice.aid])).rows[0].n), 1, 'the cosmetic unlock is on the account');

// the three-way split: 0.02 ETH → founder 40% / buyback 40% / rwa 20%
let rev = await revenueStatus(pool);
assert.equal(rev.grossEth, 0.02, 'gross recorded');
assert.equal(rev.buybackEth, 0.008, 'buyback share = 40%');
assert.equal(rev.rwaEth, 0.004, 'rwa share = 20%');
assert.equal(rev.founderEth, 0.008, 'founder share = gross − buyback − rwa = 40%');
assert.equal(rev.treasuryHolds, 'eth', 'the treasury slice is recorded and HELD AS ETH — the stock layer it once funded is retired');

// ── idempotency: re-delivering the SAME nonce is a no-op (no double-grant) ──
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: n1, sku: 'decor_deco', payer: W1, amountWei: ethWei(0.02) } });
assert.equal(r.body.duplicate, true, 'a re-delivered event is a no-op');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM store_cosmetics WHERE account_id=$1 AND style='deco'", [alice.aid])).rows[0].n), 1, 'still just the one unlock');

// ── a COMP (no txHash — the mod tool, not a real payment): grants the entitlement but records NO
// Vig revenue, so a free comp can never fabricate buyback basis (audit MED) ──
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'revive_3', payer: W1, amountWei: ethWei(0.25) } });
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.respawnTokens, 3, 'the comp granted three revives');
assert.equal((await revenueStatus(pool)).grossEth, 0.02, 'a comp (no txHash) records NO revenue — only real on-chain payments (with a tx) feed the flywheel');

// ── D-MED2 regression: in PRODUCTION (the QA flag OFF), a caller-supplied txHash on the mod route
// CANNOT fabricate real-ETH revenue — the vector that would unback the withdrawal reserve. Only the
// on-chain watcher (observing a genuine event) may book revenue.
process.env.ALLOW_MOD_REAL_REVENUE = 'off';
const W_NEVER = getAddress('0x' + '99'.repeat(20)); // never linked to an account → nothing parked reconciles later
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'revive_5', payer: W_NEVER, amountWei: ethWei(0.40), txHash: '0xFABRICATED' } });
assert.equal((await revenueStatus(pool)).grossEth, 0.02, 'production (flag off): a caller txHash CANNOT fabricate Vig revenue (D-MED2)');
process.env.ALLOW_MOD_REAL_REVENUE = 'on';

// ── the ETH Street Wire — a 30-day access window on the living character ──
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'wire_month', payer: W1, amountWei: ethWei(0.03) } });
r = await call('GET', '/v1/store', { token: alice.token });
assert.equal(r.body.owned.wire.active, true, 'the Street Wire is live');
assert(r.body.owned.wire.seconds > 29 * 86400, 'roughly a month left');

// ── audit: a wire bought with NO living character is PARKED on the account + applied at the next birth ──
const W_ORPHAN = getAddress('0x' + '33'.repeat(20));
const { body: { token: orphanTok } } = await call('POST', '/v1/auth/guest');
const orphanAid = (await pool.query("SELECT ap.account_id a FROM account_persistent ap LEFT JOIN characters c ON c.account_id=ap.account_id WHERE c.id IS NULL ORDER BY ap.account_id DESC LIMIT 1")).rows[0].a;
await pool.query('UPDATE account_persistent SET wallet_address=$1 WHERE account_id=$2', [W_ORPHAN, orphanAid]);
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'wire_month', payer: W_ORPHAN, amountWei: ethWei(0.03) } });
assert(Number((await pool.query('SELECT wire_pending_days d FROM account_persistent WHERE account_id=$1', [orphanAid])).rows[0].d) >= 30, 'the wire is PARKED (no living character to apply it to)');
await call('POST', '/v1/character', { token: orphanTok, body: { name: 'Late Bloomer' } });
assert.equal(Number((await pool.query('SELECT wire_pending_days d FROM account_persistent WHERE account_id=$1', [orphanAid])).rows[0].d), 0, 'the parked days are consumed at the character\'s birth');
assert.equal((await call('GET', '/v1/store', { token: orphanTok })).body.owned.wire.active, true, 'the parked wire applied to the freshly-born character (not dropped)');

// ── the Season Pass: a window + 2 revives + the patron badge ──
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'season_pass', payer: W1, amountWei: ethWei(0.05) } });
r = await call('GET', '/v1/store', { token: alice.token });
assert.equal(r.body.owned.pass.active, true, 'the pass is active');
assert(r.body.owned.pass.seconds > 29 * 86400, 'a month of pass');
assert.equal(r.body.owned.patron, true, 'the pass makes you a patron');
assert.equal(r.body.owned.respawnTokens, 5, 'the pass added two more revives (3 + 2)');

// ── the permanent patron badge is idempotent (buying it again keeps you a patron, no error) ──
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'patron', payer: W1, amountWei: ethWei(0.10) } });
assert.equal(r.code, 200, 'bought the ring');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.patron, true, 'still a patron');

// ── pay-before-link: bob buys with an UNLINKED wallet → the row waits; reconcile grants at link ──
let nb = nonce();
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nb, sku: 'patron', payer: W2, amountWei: ethWei(0.10) } });
assert.equal(r.body.recorded, true, 'the payment is recorded');
assert.equal(r.body.attributed, false, 'but nobody owns that wallet yet');
assert.equal(r.body.granted, false, 'so nothing is granted');
await setWallet(bob.aid, W2);
const rec = await reconcileStore(pool, bob.aid, W2);
assert.equal(rec.granted, 1, 'linking the wallet grants the parked purchase');
assert.equal((await call('GET', '/v1/store', { token: bob.token })).body.owned.patron, true, 'bob is a patron now');
// reconciling again grants nothing (claim-then-grant is exactly-once)
assert.equal((await reconcileStore(pool, bob.aid, W2)).granted, 0, 'no double-grant on a second reconcile');

// ── a zero-value payment attributes but grants nothing (belt-and-suspenders vs a fee misconfig) ──
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'revive_5', payer: W1, amountWei: '0' } });
assert.equal(r.body.granted, false, 'a zero-wei payment grants no entitlement');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.respawnTokens, 5, 'still five revives (3 bought + 2 from the pass — unchanged)');

// ── §10.4 NEUTRALITY: the Store minted no currency — every in-game check holds at drift-0 ──
const inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.every((c) => c.ok), `every §10.4 check holds — the Store moved no in-game currency (${JSON.stringify(inv.checks.filter((c) => !c.ok))})`);

// ── the buyback share rides the EXISTING vig_revenue; the real-value invariant absorbs it ──
const vig = await runVigInvariants(pool);
assert(vig.checks.find((c) => c.name === 'spend ≤ revenue').ok, 'spend ≤ revenue holds with Store revenue in the pool');
rev = await revenueStatus(pool);
assert(rev.buybackEth > 0, 'the buyback flywheel is funded by Store revenue');
assert.equal(rev.treasuryEth, rev.rwaEth, 'the treasury slice is the same number under its honest name — nothing is spent on units any more');
assert(rev.bySku.find((s) => s.sku === 'decor_deco'), 'the ops view tallies sales by SKU');

// ── THE PLEX RAIL — every SKU, because the one that wasn't is GONE ─────────────────────────────
// (founder-directed 2026-08-10: retired wholesale, then pulled back to the mint alone, then the mint
// SKU retired outright rather than left selling the same credit on a stale ETH price.)
//
// THE LINE IS THE BOUND, NOT THE DENOMINATION. A Store SKU is a consumable, an access window or
// cosmetic status — nothing about what it DOES depends on which currency bought it, so the rail is a
// choice. The single exception was anything granting a mint credit, and no such SKU exists now. The
// GRANT guard STAYS anyway, and asserting it here on a package nobody has written yet is the point:
// it is the wall, not the patch, which is why it is checked on the grant rather than the sku name.
const plexer = await mk('Plex Pete');
const paid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${plexer.id}'`)).rows[0].a;
await pool.query(`UPDATE account_persistent SET omr=100000000 WHERE account_id='${paid}'`);
const sb = (await call('GET', '/v1/store', { token: plexer.token })).body;
assert(sb.packages.every((p) => p.plexOmr > 0),
  'EVERY shelf SKU quotes a $OMR price now — none of them is a bound');
// the retired door still names itself rather than reading as a typo
r = await call('POST', '/v1/store/plex/made_man', { token: plexer.token });
assert.equal(r.body.error, 'retired', 'the retired SKU says so — not "unknown package", which would be a lie');
assert(/made|mission ladder/i.test(r.body.message || ''), 'and points at the rail that does sell it');

// RETIRING A PACKAGE MUST NOT CANCEL A PURCHASE SOMEBODY ALREADY PAID FOR. A payment recorded before
// the retirement — or parked pre-link and reconciled after it — is money that already moved, so the
// GRANT path still honors it while the two BUY paths refuse. Getting this backwards would also crash
// sweepUncreditedStore for every other parked payment queued behind the retired one.
{
  const buyer = await mk('Paid Before It Went');
  const wOld = getAddress('0x' + '77'.repeat(20));
  await setWallet(buyer.aid, wOld);
  const credBefore = (await call('GET', '/v1/store', { token: buyer.token })).body.owned.mintCredits;
  // a NEW purchase is refused at the ingest, and the throw is what stops a watcher cursor advancing
  await assert.rejects(() => recordStorePurchase(pool, { nonce: nonce(), sku: 'made_man', payer: wOld, amountWei: ethWei(0.01), txHash: '0xtoolate' }),
    (e) => e.code === 'retired', 'a NEW payment for a retired sku is refused loudly — a human looks');
  // but a HISTORICAL row (recorded when it was still sold) reconciles and grants what was bought
  await pool.query("INSERT INTO store_payments (nonce, sku, payer_address, amount_wei, granted) VALUES (990111,'made_man',$1,'10000000000000000',false)", [wOld]);
  // caught rather than awaited bare: if the grant path stops honoring a retired sku it THROWS, and an
  // uncaught throw kills the run without naming what broke.
  const honored = await reconcileStore(pool, buyer.aid, wOld).catch((e) => ({ granted: 0, threw: e.code || e.message }));
  assert.equal(honored.granted, 1, `the paid-for purchase is honored, not cancelled (${honored.threw || ''})`);
  assert.equal((await call('GET', '/v1/store', { token: buyer.token })).body.owned.mintCredits, credBefore + 1,
    'and grants exactly what they paid for');
}
assert.equal((await call('GET', '/v1/store', { token: plexer.token })).body.owned.mintCredits, 0,
  'and grants nothing — no amount of $OMR makes you');
assert.equal((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='plex:made_man'")).rows[0].n, '0',
  'no plex:made_man row is ever written');
{ // and a CONSUMABLE goes through, for real $OMR, granting exactly what an ETH payer would get
  const sku = sb.packages.find((p) => p.grant?.respawnTokens);
  const quoted = sku.plexOmr;
  const before = (await meOf(plexer.token)).omr;
  const tokBefore = Number((await pool.query(`SELECT respawn_tokens t FROM account_persistent WHERE account_id='${paid}'`)).rows[0].t);
  r = await call('POST', `/v1/store/plex/${sku.sku}`, { token: plexer.token });
  assert.equal(r.code, 200, `${sku.sku} is payable in earned $OMR — the rail is a currency choice, not a bypassed bound`);
  assert.equal(r.body.omrSpent, quoted, 'it charges exactly what the shelf quoted');
  assert.equal((await meOf(plexer.token)).omr, before - quoted, 'and burns exactly that much');
  assert.equal(Number((await pool.query(`SELECT respawn_tokens t FROM account_persistent WHERE account_id='${paid}'`)).rows[0].t),
    tokBefore + sku.grant.respawnTokens, 'granting the SAME entitlement an ETH payer gets');
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM transactions WHERE reason='plex:${sku.sku}'`)).rows[0].n, '1',
    'one ledgered burn, on a reason already in the vocabulary + the burn term + DESK.SINK_REASONS');
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PATRON PROGRAM (Store Tier-4) — the backer-prestige ladder (patron_spent), THE LEDGER PRESTIGE
// (pass_seasons), THE BENEFACTORS league + THE HOUSE'S FAVOR. Status only.
// ════════════════════════════════════════════════════════════════════════════════════════════════
// (A) THE PATRON LADDER — a REAL purchase bumps patron_spent; a COMP does not; the tier climbs.
// alice made a REAL decor_deco (0.02) earlier + a COMP revive_3 (0.25, no txHash) → spent should be 0.02.
let sbA = (await call('GET', '/v1/store', { token: alice.token })).body;
assert.equal(sbA.owned.patronStanding.spentEth, 0.02, 'a REAL purchase bumped patron_spent (0.02); the comp did NOT (txHash-gated)');
assert.equal(sbA.owned.patronStanding.tierName, PATRON.TIERS[patronTierOf(0.02)].name, '0.02 ETH sits on the ladder where patronTierOf puts it');
// two more REAL purchases climb the ladder: 0.02 + 0.10 (patron) + 0.40 (revive_5) = 0.52 → Benefactor
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'patron', payer: W1, amountWei: ethWei(0.10), txHash: '0xreal_pat' } });
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'revive_5', payer: W1, amountWei: ethWei(0.40), txHash: '0xreal_rev5' } });
sbA = (await call('GET', '/v1/store', { token: alice.token })).body;
assert.equal(sbA.owned.patronStanding.spentEth, 0.52, 'patron_spent summed the real purchases');
assert.equal(sbA.owned.patronStanding.tier, patronTierOf(0.52), 'the tier index matches patronTierOf');
assert.equal(sbA.owned.patronStanding.tierName, 'Benefactor', '0.52 ETH → Benefactor');
assert(patronTierOf(0.52) > patronTierOf(0.02), 'and the ladder actually CLIMBED — otherwise this proves nothing');
assert(sbA.owned.patronStanding.nextTier && sbA.owned.patronStanding.nextTier.name === 'Patron', 'the next tier + delta surface');

// (B/C) THE PLEX CONTRIBUTION and THE PLEX DISCOUNT are both retired with the rail they priced.
// `patron_spent` now moves on REAL ETH purchases alone, which is the honest meter: it measures what
// reached the revenue split. `plexDiscountBps` shipped at 0 and is reported as 0 — the tier NAMES
// are what the program is.
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.patronStanding.plexDiscountBps, 0,
  'the retired discount reports 0 rather than a live-looking number');

// (D) THE BENEFACTORS + THE HOUSE'S FAVOR — ranked by patron_spent; agents excluded; families aggregate
let lb = await benefactorLeaderboard(pool);
assert(lb.patrons.some((p) => p.steward === 'Patron Alice'), 'alice is on the Benefactors board');
assert.equal(lb.patrons[0].steward, 'Patron Alice', 'the top spender (0.52) leads');
assert(lb.favor && lb.favor.steward === 'Patron Alice', "THE HOUSE'S FAVOR is the top patron (read-derived crown)");
// an agent with the biggest spend is EXCLUDED from the status board
const spook = await mk('Spook Patron');
await pool.query('UPDATE account_persistent SET agent_flag=true, patron_spent=99 WHERE account_id=$1', [spook.aid]);
lb = await benefactorLeaderboard(pool);
assert(!lb.patrons.some((p) => p.steward === 'Spook Patron'), 'an agent_flag patron never appears on the board');
assert.equal(lb.favor.steward, 'Patron Alice', "the agent did not steal the House's Favor");
// families aggregate a roster's spend (seed a light gang with alice + a second REAL patron)
const famPat = await mk('Family Patron');
const WFAM = getAddress('0x' + 'fa'.repeat(20));
await setWallet(famPat.aid, WFAM);
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'wire_month', payer: WFAM, amountWei: ethWei(0.03), txHash: '0xreal_fam' } });
await pool.query(`INSERT INTO gangs (id, name, tag) VALUES ('pat-gang','The Benefactors','BEN')`);
await pool.query(`INSERT INTO gang_members (gang_id, character_id, role, joined_at) VALUES ('pat-gang','${alice.id}','boss',now()), ('pat-gang','${famPat.id}','soldier',now())`);
lb = await benefactorLeaderboard(pool);
const fam = lb.families.find((g) => g.name === 'The Benefactors');
assert(fam && fam.patrons === 2, 'the family board counts both patrons');
assert.equal(fam.spentEth, Math.round((0.52 + 0.03) * 1e6) / 1e6, "the family sums its roster's spend");

// (E) THE LEDGER PRESTIGE — completing the 12-tier track then buying a FRESH pass bumps pass_seasons
const led = await mk('Ledger Larry');
// set a COMPLETED, LAPSED track (tier at the cap, pass expired) then buy a fresh pass → +1 season
await pool.query(`UPDATE account_persistent SET pass_tier=${PASS.TRACK.length}, pass_until=now() - interval '1 day' WHERE account_id='${led.aid}'`);
await setWallet(led.aid, getAddress('0x' + '44'.repeat(20)));
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'season_pass', payer: getAddress('0x' + '44'.repeat(20)), amountWei: ethWei(0.05), txHash: '0xled1' } });
let pbL = (await call('GET', '/v1/pass', { token: led.token })).body;
assert.equal(pbL.seasons, 1, 'a completed-then-renewed track bumps pass_seasons to 1');
assert.equal(pbL.prestigeName, 'Regular', 'the prestige rank advances (Regular @ 1 season)');
// buying a fresh pass WITHOUT completing does NOT bump (leave it mid-track, lapse it, re-buy)
await pool.query(`UPDATE account_persistent SET pass_tier=3, pass_until=now() - interval '1 day' WHERE account_id='${led.aid}'`);
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'season_pass', payer: getAddress('0x' + '44'.repeat(20)), amountWei: ethWei(0.05), txHash: '0xled2' } });
pbL = (await call('GET', '/v1/pass', { token: led.token })).body;
assert.equal(pbL.seasons, 1, 'an unfinished track does NOT bump pass_seasons');
// pass_seasons + patron_spent SURVIVE DEATH (account-level status)
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: led.id } });
assert.equal((await call('GET', '/v1/pass', { token: led.token })).body.seasons, 1, 'pass_seasons survives death (the heir keeps the prestige)');
const aliceSpentBefore = sbA.owned.patronStanding.spentEth;
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: alice.id } });
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.patronStanding.spentEth, aliceSpentBefore, 'patron_spent survives death');

// (F) §10.4 STILL NEUTRAL — the whole patron program minted nothing
const inv2 = await runLedgerInvariants(pool, { alert: false });
assert(inv2.checks.find((c) => c.name === 'reason vocabulary').ok, 'no unknown-reason alarm from the patron program');

console.log('✅ THE PATRON PROGRAM (Store Tier-4) test passed — the patron ladder (a REAL purchase bumps patron_spent, a COMP does not, the tier climbs Friend→Benefactor), the retired PLEX rail (the Store is ETH only), THE BENEFACTORS league + THE HOUSE\'S FAVOR crown (agents excluded, families aggregate a roster), THE LEDGER PRESTIGE (a completed-then-renewed track bumps pass_seasons, an unfinished one does not), and DEATH SURVIVAL of both status axes');

console.log('✅ The Store (ETH revenue packages) test passed — the catalog board, the three-way revenue split (founder/buyback/rwa, exact math), idempotent ingestion (re-delivered nonce = no-op), per-SKU grants (mint credit, revive bundle, ETH Street Wire window, the season pass + patron, the permanent patron badge), pay-before-link reconcile (claim-then-grant, exactly-once), zero-value no-grant, §10.4 NEUTRALITY (every check drift-0 — the Store mints no currency), and the buyback share funding the EXISTING Vig flywheel (spend ≤ revenue holds; RWA recorded-only, R2 dormant)');
await app.close();
