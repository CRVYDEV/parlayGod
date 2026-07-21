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
import { recordStorePurchase, reconcileStore, revenueStatus } from '../src/store.js';
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
assert(r.body.packages.find((p) => p.sku === 'made_man'), 'made_man is on the shelf');
assert.equal(r.body.owned.mintCredits, 0, 'a nobody owns nothing');
assert.equal(r.body.owned.patron, false, 'not a patron yet');
assert.equal(r.body.split.founder + r.body.split.buyback + r.body.split.rwa, 10000, 'the split sums to 10000');

// ── bad sku is refused ──
assert.equal((await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'nope', payer: W1, amountWei: ethWei(0.01) } })).body.error, 'bad_sku', 'no such package');

// ── link alice's wallet, then a Made Man purchase (0.01 ETH) — granted now, split recorded ──
await setWallet(alice.aid, W1);
let n1 = nonce();
// a REAL on-chain purchase carries a txHash (the StorePaid event) → it records the revenue split
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: n1, sku: 'made_man', payer: W1, amountWei: ethWei(0.01), txHash: '0xrealtx1' } });
assert.equal(r.code, 200, 'the purchase landed');
assert.equal(r.body.granted, true, 'a linked wallet is granted immediately');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.mintCredits, 1, 'the mint credit is on the account');

// the three-way split: 0.01 ETH → founder 40% / buyback 40% / rwa 20%
let rev = await revenueStatus(pool);
assert.equal(rev.grossEth, 0.01, 'gross recorded');
assert.equal(rev.buybackEth, 0.004, 'buyback share = 40%');
assert.equal(rev.rwaEth, 0.002, 'rwa share = 20%');
assert.equal(rev.founderEth, 0.004, 'founder share = gross − buyback − rwa = 40%');
assert.equal(rev.rwaDormant, true, 'the rwa share is recorded but unspent (R2 dormant)');

// ── idempotency: re-delivering the SAME nonce is a no-op (no double-grant) ──
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: n1, sku: 'made_man', payer: W1, amountWei: ethWei(0.01) } });
assert.equal(r.body.duplicate, true, 'a re-delivered event is a no-op');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.mintCredits, 1, 'still just one mint credit');

// ── a COMP (no txHash — the mod tool, not a real payment): grants the entitlement but records NO
// Vig revenue, so a free comp can never fabricate buyback basis (audit MED) ──
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'revive_3', payer: W1, amountWei: ethWei(0.25) } });
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.respawnTokens, 3, 'the comp granted three revives');
assert.equal((await revenueStatus(pool)).grossEth, 0.01, 'a comp (no txHash) records NO revenue — only real on-chain payments (with a tx) feed the flywheel');

// ── D-MED2 regression: in PRODUCTION (the QA flag OFF), a caller-supplied txHash on the mod route
// CANNOT fabricate real-ETH revenue — the vector that would unback the withdrawal reserve. Only the
// on-chain watcher (observing a genuine event) may book revenue.
process.env.ALLOW_MOD_REAL_REVENUE = 'off';
const W_NEVER = getAddress('0x' + '99'.repeat(20)); // never linked to an account → nothing parked reconciles later
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'made_man', payer: W_NEVER, amountWei: ethWei(0.01), txHash: '0xFABRICATED' } });
assert.equal((await revenueStatus(pool)).grossEth, 0.01, 'production (flag off): a caller txHash CANNOT fabricate Vig revenue (D-MED2)');
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
r = await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'made_man', payer: W1, amountWei: '0' } });
assert.equal(r.body.granted, false, 'a zero-wei payment grants no entitlement');
assert.equal((await call('GET', '/v1/store', { token: alice.token })).body.owned.mintCredits, 1, 'still one mint credit (unchanged)');

// ── §10.4 NEUTRALITY: the Store minted no currency — every in-game check holds at drift-0 ──
const inv = await runLedgerInvariants(pool);
assert(inv.checks.every((c) => c.ok), `every §10.4 check holds — the Store moved no in-game currency (${JSON.stringify(inv.checks.filter((c) => !c.ok))})`);

// ── the buyback share rides the EXISTING vig_revenue; the real-value invariant absorbs it ──
const vig = await runVigInvariants(pool);
assert(vig.checks.find((c) => c.name === 'spend ≤ revenue').ok, 'spend ≤ revenue holds with Store revenue in the pool');
rev = await revenueStatus(pool);
assert(rev.buybackEth > 0, 'the buyback flywheel is funded by Store revenue');
assert.equal(rev.rwaSpent, 0, 'the RWA reserve is recorded-only (R2 dormant)');
assert(rev.bySku.find((s) => s.sku === 'made_man'), 'the ops view tallies sales by SKU');

// ── PLEX-for-packages: pay a SKU with EARNED $OMR (a plex:* BURN) for the same entitlement ──
// (runs AFTER the neutrality check because the test SQL-grants $OMR — an unledgered mint; the plex
// burn itself IS ledgered, asserted directly below.)
const plexer = await mk('Plex Pete');
const paid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${plexer.id}'`)).rows[0].a;
await pool.query(`UPDATE account_persistent SET omr=1000 WHERE account_id='${paid}'`);
const sb = (await call('GET', '/v1/store', { token: plexer.token })).body;
const mm = sb.packages.find((p) => p.sku === 'made_man');
assert(mm.plexOmr > 0, 'the PLEX $OMR price is quoted (the floor, before any buyback prints an oracle)');
const plexBurnBefore = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'plex:%'")).rows[0].s);
const omrPre = (await meOf(plexer.token)).omr;
r = await call('POST', '/v1/store/plex/made_man', { token: plexer.token });
assert.equal(r.code, 200, 'PLEX-bought Made Man with earned $OMR');
assert.equal(r.body.omrSpent, mm.plexOmr, 'burned exactly the quoted $OMR');
assert.equal((await meOf(plexer.token)).omr, omrPre - mm.plexOmr, 'the $OMR left the account');
assert.equal((await call('GET', '/v1/store', { token: plexer.token })).body.owned.mintCredits, 1, 'the entitlement granted — same as an ETH payer gets');
// the spend is a LEDGERED plex:* burn (§10.4-legal deflationary sink; no clobber of the grant)
const plexBurnAfter = -Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason LIKE 'plex:%'")).rows[0].s);
assert.equal(plexBurnAfter - plexBurnBefore, mm.plexOmr, 'the PLEX spend is a ledgered plex:* burn');
// walkthrough MED-1: buying made_man while ALREADY MINTED is refused BEFORE the burn (a dead credit) —
// the vig.js:116 precedent; the $OMR must not leave the account
await pool.query(`UPDATE account_persistent SET minted=true, omr=1000 WHERE account_id='${paid}'`);
const omrBeforeDead = (await meOf(plexer.token)).omr;
const deadBuy = await call('POST', '/v1/store/plex/made_man', { token: plexer.token });
assert.equal(deadBuy.body.error, 'minted', 'a made account cannot PLEX-buy a dead mint credit');
assert.equal((await meOf(plexer.token)).omr, omrBeforeDead, 'the refused made_man buy burned nothing');
// and re-buying the pure Patron ring while already a patron is refused (no-op re-burn)
await pool.query(`UPDATE account_persistent SET patron=true WHERE account_id='${paid}'`);
const omrBeforePatron = (await meOf(plexer.token)).omr;
assert.equal((await call('POST', '/v1/store/plex/patron', { token: plexer.token })).body.error, 'patron', 'a patron cannot re-buy the ring');
assert.equal((await meOf(plexer.token)).omr, omrBeforePatron, 'the refused patron buy burned nothing');
// insufficient earned $OMR + bad sku are clean refusals
assert.equal((await call('POST', '/v1/store/plex/revive_5', { token: plexer.token })).body.error, 'omr', 'not enough earned $OMR is refused');
assert.equal((await call('POST', '/v1/store/plex/nope', { token: plexer.token })).body.error, 'bad_sku', 'no such package');

console.log('✅ The Store (ETH revenue packages) test passed — the catalog board, the three-way revenue split (founder/buyback/rwa, exact math), idempotent ingestion (re-delivered nonce = no-op), per-SKU grants (mint credit, revive bundle, ETH Street Wire window, the season pass + patron, the permanent patron badge), pay-before-link reconcile (claim-then-grant, exactly-once), zero-value no-grant, §10.4 NEUTRALITY (every check drift-0 — the Store mints no currency), and the buyback share funding the EXISTING Vig flywheel (spend ≤ revenue holds; RWA recorded-only, R2 dormant)');
await app.close();
