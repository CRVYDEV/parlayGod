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

// ── the ETH Street Wire — a 30-day access window on the living character ──
await call('POST', '/v1/mod/store/grant', { mod: true, body: { nonce: nonce(), sku: 'wire_month', payer: W1, amountWei: ethWei(0.03) } });
r = await call('GET', '/v1/store', { token: alice.token });
assert.equal(r.body.owned.wire.active, true, 'the Street Wire is live');
assert(r.body.owned.wire.seconds > 29 * 86400, 'roughly a month left');

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

console.log('✅ The Store (ETH revenue packages) test passed — the catalog board, the three-way revenue split (founder/buyback/rwa, exact math), idempotent ingestion (re-delivered nonce = no-op), per-SKU grants (mint credit, revive bundle, ETH Street Wire window, the season pass + patron, the permanent patron badge), pay-before-link reconcile (claim-then-grant, exactly-once), zero-value no-grant, §10.4 NEUTRALITY (every check drift-0 — the Store mints no currency), and the buyback share funding the EXISTING Vig flywheel (spend ≤ revenue holds; RWA recorded-only, R2 dormant)');
await app.close();
