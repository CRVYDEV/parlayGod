// Risk-to-Earn Phase 2 — THE VIG test. Proves the sustainability engine end-to-end on pg-mem
// (zero infra, chain dormant): real ETH revenue → the Vig's 60% share → the buyback buys hard
// $OMR → splits reserve/prize → a player is paid a prize and EXTRACTS it (a withdrawal the Vig
// funded, not team charity) → and the extraction-≤-inflow invariant holds at every step. Plus the
// PLEX bridge (pay a fee in earned $OMR, a §10.4 burn) and §10.4 in-game conservation throughout.
import assert from 'node:assert';
import { privateKeyToAccount } from 'viem/accounts';

// deterministic signer/player keys (well-known anvil accounts) — set BEFORE importing the server
process.env.VOUCHER_SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.VOUCHER_CLAIM_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.CHAIN_ID = '46630';
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA: let the mod route drive the real-revenue flywheel (D-MED2 gate)

const { buildServer } = await import('../src/server.js');
const { runLedgerInvariants } = await import('../src/invariants.js');

const app = await buildServer();
const pool = app.pool;
const modH = { 'x-mod-key': 'test-mod-key' };
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  let json; try { json = res.json(); } catch { json = null; }
  return { code: res.statusCode, body: json };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const vigOf = async () => (await call('GET', '/v1/mod/vig', { headers: modH })).body;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const player = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

// an earner (never SQL-seed $OMR — everything comes through ledgered faucets so §10.4 stays clean)
const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Living Wage Lou' } });
const cid = (await meOf(token)).id;
const acctId = (await pool.query(`SELECT account_id FROM characters WHERE id='${cid}'`)).rows[0].account_id;
let r;

// ── (1) real ETH revenue in → the Vig takes its 60% share (dev keeps 40%) ──
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 9001, kind: 'mint', payer: player.address, amountWei: '10000000000000000', txHash: '0xfee9001' } });   // 0.01 ETH (real on-chain → books Vig revenue)
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 9002, kind: 'respawn', payer: player.address, amountWei: '100000000000000000', txHash: '0xfee9002' } }); // 0.10 ETH
let vig = await vigOf();
assert(near(vig.status.grossRevenueEth, 0.11), `gross real revenue = 0.11 ETH (got ${vig.status.grossRevenueEth})`);
assert(near(vig.status.vigRevenueEth, 0.066), 'the Vig takes its 60% share = 0.066 ETH');
assert(near(vig.status.devRevenueEth, 0.044), 'dev keeps the other 40% = 0.044 ETH');
// a re-delivered fee event (reorg/watcher restart) doesn't double-count Vig revenue
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 9001, kind: 'mint', payer: player.address, amountWei: '10000000000000000' } });
assert(near((await vigOf()).status.vigRevenueEth, 0.066), 'a re-delivered fee is idempotent — no double-count');

// ── (2) the buyback: the Vig's ETH buys hard $OMR, split 50/50 reserve/prize ──
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 2000 } });
assert.equal(r.code, 200, 'buyback ran');
assert(near(r.body.ethSpent, 0.066), 'spent exactly the Vig revenue');
assert(near(r.body.omrBought, 132), 'bought 132 $OMR (0.066 ETH × 2000)');
assert(near(r.body.toReserve, 66) && near(r.body.toPrize, 66), 'split 50/50 to reserve + prize pool');
// (R41 regression) once a reference buyback exists (2000), a wildly inflated manual price (a fat-finger or
// a leaked mod key) is REFUSED — 200× (400000) would mint 200× the $OMR into the reserve/prize pool past
// real ETH inflow, invisible to BOTH the §10.4 sweep and runVigInvariants (neither price-checks omrBought).
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 400000 } });
assert.equal(r.body.error, 'price_sanity', 'a 200x price jump off the last buyback is refused (the leaked-key mint guard)');
// the anti-death-spiral cap: a second buyback with no new revenue spends NOTHING
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 2000 } });
assert(near((await vigOf()).status.omrBought, 132), 'the bot never spends more ETH than came in (no-op when nothing unspent)');

// ── (3) the extraction-≤-inflow invariant holds after the buyback ──
vig = await vigOf();
assert(vig.invariants.ok, `Vig invariant holds: ${JSON.stringify(vig.invariants.checks.filter((c) => !c.ok))}`);
assert(near(vig.status.unspentEth, 0), 'all Vig revenue is deployed');
assert(near(vig.status.prizePool, 66), 'prize pool holds the 66 $OMR bought for prizes');

// ── (4) prize payout: an earner is paid in-game $OMR, BACKED by hard $OMR moved into the reserve ──
r = await call('POST', '/v1/mod/vig/prizes', { headers: modH, body: { winners: [{ accountId: acctId, omr: 60 }] } });
assert.equal(r.code, 200); assert(near(r.body.paid, 60), 'paid the 60 $OMR prize');
assert(near((await meOf(token)).omr, 60), 'the winner holds the prize in-game');
vig = await vigOf();
assert(near(vig.status.prizePool, 6), 'prize pool drawn down to 6');
assert(vig.invariants.ok, 'invariant still holds — the reserve is backed by the $OMR moved from the prize pool');
// a prize larger than the pool pays nothing (never overpays what the Vig actually bought)
r = await call('POST', '/v1/mod/vig/prizes', { headers: modH, body: { winners: [{ accountId: acctId, omr: 1000 }] } });
assert(near(r.body.paid, 0), 'an over-pool prize pays nothing');

// ── (5) the PLEX bridge — MARKET-LINKED: fee-ETH × the latest buyback's price × 1.2 premium ──
// (sim-audit F3: the static 5 $OMR was minutes of play vs 0.01 ETH real money — the Vig starved)
r = await call('GET', '/v1/plex/price');
assert.equal(Number(r.body.mint.oracle), 2000, 'the oracle is the latest buyback price (2000 $OMR/ETH)');
assert(near(r.body.mint.price, 24), `mint quote = 0.01 ETH × 2000 × 1.2 = 24 $OMR (got ${r.body.mint.price})`);
assert(near(r.body.respawn.price, 240), 'respawn quote = 0.10 ETH × 2000 × 1.2 = 240 $OMR');
r = await call('POST', '/v1/plex/mint', { token });
assert.equal(r.code, 200); assert(near(r.body.omrSpent, 24), 'PLEX mint burns the MARKET price (24), not the static floor');
assert(near((await meOf(token)).omr, 36), 'earner spent 24 of 60 $OMR');
r = await call('POST', '/v1/character/mint', { token });
assert.equal(r.body.minted, true, 'the burned $OMR bought a mint credit → made, without touching ETH');
assert.equal((await call('POST', '/v1/plex/mint', { token })).body.error, 'minted', 'already made — no second PLEX mint');
// the market-priced respawn (240) is beyond the earner's 36 — $OMR stays the PREMIUM rail, ETH the
// economical one (that asymmetry is the point: ETH funds the Vig, $OMR burns at a markup)
assert.equal((await call('POST', '/v1/plex/respawn', { token })).body.error, 'omr', 'market-priced respawn gates on the real rate');

// ── (6) end-to-end extraction: the earner withdraws Vig-funded $OMR (a REAL living, not charity) ──
r = await call('POST', '/v1/wallet/challenge', { token });
const sig = await player.signMessage({ message: r.body.message });
await call('POST', '/v1/wallet/verify', { token, body: { address: player.address, signature: sig } });
r = await call('POST', '/v1/withdraw', { token, body: { amount: 5 } });
assert.equal(r.code, 200); assert.equal(r.body.status, 'signed', 'the withdrawal SIGNS — the Vig funded the reserve that backs it');
vig = await vigOf();
assert(vig.invariants.ok, `extraction ≤ inflow still holds after a real withdrawal: ${JSON.stringify(vig.invariants.checks.filter((c) => !c.ok))}`);
assert(vig.invariants.summary.extracted <= vig.invariants.summary.funded + 1e-9, 'extracted $OMR ≤ the Vig-funded reserve');

// ── (6b) TIER A (omerta-uniswap-hooks-design.md §7): a TRADE-fee source — the afterSwap→Vig hook's
// revenue — flows through the SAME rail as gameplay fees, proving the hook's backend is near-zero new
// code. The mainnet watcher will call recordVigRevenue(source='trade'); here we drive it directly (no
// hook/watcher built yet — chain-dormant). Key property: trade fees WIDEN extraction ≤ inflow, never
// bypass it. ──
const { recordVigRevenue } = await import('../src/vig.js');
const ethWei = (e) => BigInt(Math.round(e * 1e18)).toString();
const fundedBefore = vig.invariants.summary.funded;
const vigRevBefore = vig.status.vigRevenueEth;
{
  const c = await pool.connect();
  await c.query('BEGIN');
  await recordVigRevenue(c, { source: 'trade', ref: '0xtrade1', kind: 'trade', amountWei: ethWei(0.05) });
  await recordVigRevenue(c, { source: 'trade', ref: '0xtrade2', kind: 'trade', amountWei: ethWei(0.03) });
  const dup = await recordVigRevenue(c, { source: 'trade', ref: '0xtrade1', kind: 'trade', amountWei: ethWei(0.05) }); // A4
  await c.query('COMMIT'); c.release();
  assert.equal(dup.duplicate, true, 'A4: a re-delivered trade log is idempotent (no double-count)');
}
// A1: trade revenue takes the same 60% Vig share as a fee (0.08 gross × 0.6 = 0.048 added)
vig = await vigOf();
assert(near(vig.status.vigRevenueEth, vigRevBefore + 0.048), 'A1: the trade fee took the 60% Vig share');
assert(near(vig.status.unspentEth, 0.048), 'A1: the trade revenue is unspent, awaiting the buyback');
// A5: §10.4 in-game untouched — trade ETH is out-of-band real value (zero transactions rows)
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'trade%'")).rows[0].n), 0, 'A5: trade revenue writes ZERO in-game transactions rows');
// A2: the buyback converts the trade revenue to hard $OMR (0.048 ETH × 2000 = 96), split 48 reserve/48 prize
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 2000 } });
assert(near(r.body.ethSpent, 0.048) && near(r.body.omrBought, 96), 'A2: the buyback spends exactly the trade revenue');
assert(near(r.body.toReserve, 48) && near(r.body.toPrize, 48), 'A2: split 50/50 like any buyback');
// A3: every Vig check stays green with a 'trade' source mixed in with 'fee'
vig = await vigOf();
assert(vig.invariants.ok, `A3: every Vig check green with a trade source: ${JSON.stringify(vig.invariants.checks.filter((c) => !c.ok))}`);
// A6: extraction ≤ inflow is WIDENED — the reserve grew by the trade buyback's share, and a further
// withdrawal signs against that new backing (never a bypass; the queue still caps at funded).
assert(near(vig.invariants.summary.funded - fundedBefore, 48), 'A6: the trade fee added 48 $OMR of reserve backing — more extraction headroom');
r = await call('POST', '/v1/withdraw', { token, body: { amount: 10 } });
assert.equal(r.body.status, 'signed', 'A6: a further withdrawal signs against the trade-widened reserve');
assert(vig.invariants.summary.extracted <= vig.invariants.summary.funded + 1e-9, 'A6: extraction never exceeds the funded reserve');

// ── (7) §10.4 in-game conservation holds with the prize mint + PLEX/withdraw burns + the trade source in the mix ──
assert((await runLedgerInvariants(pool, { alert: false })).ok, '§10.4 in-game ledger still balances (prize:omr mint offset by plex:* + withdraw:omr burns; trade revenue is out-of-band)');

console.log('✅ Vig test passed — real revenue → 60/40 split → buyback (spend ≤ inflow) → reserve+prize → prize payout → PLEX bridge (pay fees in earned $OMR) → real Vig-funded withdrawal + TIER A: a TRADE-fee source (the afterSwap→Vig hook rail) splits/buys/reconciles end-to-end and WIDENS extraction≤inflow, §10.4 untouched — the extraction-≤-inflow invariant + §10.4 conservation holding throughout');
await app.close();
