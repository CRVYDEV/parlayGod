// Risk-to-Earn Phase 2 — THE VIG test. Proves the sustainability engine end-to-end on pg-mem
// (zero infra, chain dormant): real ETH revenue → the Vig's 60% share → the buyback buys hard
// $OMR → splits reserve/prize → a player is paid a prize and EXTRACTS it (a withdrawal the Vig
// funded, not team charity) → and the extraction-≤-inflow invariant holds at every step. Plus the
// the retired PLEX bridge (every fee is ETH) and §10.4 in-game conservation throughout.
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
// …and the wall must anchor on the LATEST price, not an arbitrary one. `vig_buyback.id` is a random
// UUID, so the original `ORDER BY id DESC LIMIT 1` read a RANDOM historical row — measured: after 12
// buybacks it anchored on the 7th, and a 50x call sailed through by latching onto a stale high print.
// Every consumer of this price (the ETH vault, bond quotes, PLEX, the exit toll) reads created_at DESC.
// One buyback in history makes the two orderings agree, which is why this hid: build a REAL history
// where they disagree — an OLD high print whose UUID sorts LAST, and a newer low one.
await pool.query(`INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize, created_at)
  VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 0, 0, 100000, 0, 0, now() - interval '2 days')`);
await pool.query(`INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize, created_at)
  VALUES ('00000000-0000-4000-8000-000000000000', 0, 0, 200, 0, 0, now() + interval '1 minute')`);
await pool.query("INSERT INTO vig_revenue (source, ref, gross_eth, vig_eth) VALUES ('fee','anchor-probe',1,1)");
r = await call('POST', '/v1/mod/vig/buyback', { headers: modH, body: { priceOmrPerEth: 50000 } });
assert.equal(r.body.error, 'price_sanity',
  '250x off the LATEST print (200) is refused — the wall reads created_at, not a random UUID '
  + `(got ${JSON.stringify(r.body)})`);
await pool.query("DELETE FROM vig_buyback WHERE eth_spent = 0"); // clear the synthetic prints
await pool.query("DELETE FROM vig_revenue WHERE ref='anchor-probe'");
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

// ── (5) THE PLEX BRIDGE — THE MINT IS ETH ONLY, THE REST IS PAYABLE IN EARNED $OMR ─────────────
// (founder-directed 2026-08-10: the mint went ETH-only, then the whole bridge was retired, then that
// was pulled back to the mint alone — "maybe we over exaggerated".)
//
// THE LINE IS THE BOUND, NOT THE DENOMINATION, and this asserts both halves of it. Only one of the
// two retirement arguments was ever about PLEX: "priced by the cheaper rail" is FATAL for the mint
// (the Sybil bound AND the extraction gate) and merely a currency choice for a consumable. So the
// mint refuses and the respawn pays — and the invariant is narrowed to match, because a check that
// names a whole family fires on its living members.
r = await call('GET', '/v1/plex/price');
assert.equal(r.body.mint, null, 'no $OMR mint price is quoted — the identity has exactly one rail');
assert.equal(r.body.mintEthOnly, true, 'and the board says that POSITIVELY, rather than by omission');
assert(r.body.respawn && r.body.respawn.price > 0, 'the respawn DOES quote — a consumable is not a bound');

const omrBeforeRefusals = (await meOf(token)).omr;
r = await call('POST', '/v1/plex/mint', { token });
assert.equal(r.body.error, 'retired', 'the PLEX mint refuses — minting is the Sybil bound');
assert(/ETH only/i.test(r.body.message || ''), 'and says what replaced it');
assert(/grants one outright/i.test(r.body.message || ''), '…and that the FREE path is a mission grant, not a conversion');
// THE DOOR BESIDE IT, which was standing open before the full retirement and is closed now: a Store
// SKU that grants a mint credit sold the same thing for $OMR one layer up.
r = await call('POST', '/v1/store/plex/made_man', { token });
assert.equal(r.body.error, 'retired', 'a SKU that would MAKE you refuses on the $OMR rail too — checked on the grant, not the sku id');
assert(near((await meOf(token)).omr, omrBeforeRefusals), 'a refused purchase burns NOTHING — the earner keeps every $OMR');

{ // the respawn rail PAYS, and it is a real ledgered burn that recycles to the desk
  const before = (await meOf(token)).omr;
  const quote = (await call('GET', '/v1/plex/price')).body.respawn.price;
  // fund it as a LEGAL MINT, not a raw SQL credit — an unledgered grant would drift the very
  // conservation check this file asserts at the end (and `prize:omr` is exactly how a Vig-funded
  // earner gets $OMR in the first place, so it is also the realistic way to arrive at this purchase)
  await pool.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acctId, quote]);
  await pool.query(`INSERT INTO transactions (id, account_id, currency, amount, reason, at)
    VALUES ('plex-fund-1', $1, 'omr', $2, 'prize:omr', now())`, [acctId, quote]);
  const tokensBefore = Number((await pool.query('SELECT respawn_tokens t FROM account_persistent WHERE account_id=$1', [acctId])).rows[0].t);
  r = await call('POST', '/v1/plex/respawn', { token });
  assert.equal(r.code, 200, 'the respawn is payable in earned $OMR — "pay your rent in ISK", on the half that is not a bound');
  assert(near(r.body.omrSpent, quote), 'it charges exactly what it quoted');
  assert.equal(Number((await pool.query('SELECT respawn_tokens t FROM account_persistent WHERE account_id=$1', [acctId])).rows[0].t), tokensBefore + 1,
    'and grants the SAME entitlement an ETH payer gets');
  assert(near((await meOf(token)).omr, before), 'the granted $OMR is exactly consumed — no more, no less');
  assert.equal((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='plex:respawn'")).rows[0].n, '1',
    'one ledgered plex:respawn burn — the reason was already in the vocabulary, the burn term and DESK.SINK_REASONS');
}
{ // the invariant is narrowed to the DEAD thing, not the family — or it alarms on the live rail above
  const inv = await runLedgerInvariants(pool, { alert: false });
  const retired = inv.checks.find((c) => c.name === 'plex mint retired');
  assert(retired && retired.ok, 'the `plex mint retired` freshness check is live and clean WITH a fresh plex:respawn row in the ledger');
  assert(!inv.checks.find((c) => c.name === 'plex bridge retired'),
    'and the whole-prefix check is GONE — it was right for the hours the whole bridge was dead and would now fire on ordinary play');
}
{ // a FRESH mint burn is still the alarm — the half that stayed retired is still watched
  await pool.query(`INSERT INTO transactions (id, account_id, currency, amount, reason, at)
    VALUES ('fresh-plex-mint', $1, 'omr', -3, 'plex:mint', now())`, [acctId]);
  await pool.query('UPDATE account_persistent SET omr = omr - 3 WHERE account_id=$1', [acctId]);
  const inv = await runLedgerInvariants(pool, { alert: false });
  assert(!inv.checks.find((c) => c.name === 'plex mint retired').ok,
    'a NEW plex:mint row trips the alarm — the mint rail is dead and stays watched');
  await pool.query("DELETE FROM transactions WHERE id='fresh-plex-mint'");
  await pool.query('UPDATE account_persistent SET omr = omr + 3 WHERE account_id=$1', [acctId]);
}
{ // THE OTHER HALF, and why the reason must never leave the burn term: a HISTORICAL plex row is REAL —
  // conservation is a claim about the whole ledger, so it keeps reconciling while only NEW mint writes
  // are an alarm (the emission.js retirement, in its second costume).
  const conservBefore = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === '$OMR conservation');
  await pool.query(`INSERT INTO transactions (id, account_id, currency, amount, reason, at)
    VALUES ('hist-plex-1', $1, 'omr', -7, 'plex:mint', now() - interval '2 days')`, [acctId]);
  await pool.query('UPDATE account_persistent SET omr = omr - 7 WHERE account_id=$1', [acctId]);
  const inv2 = await runLedgerInvariants(pool, { alert: false });
  const conservAfter = inv2.checks.find((c) => c.name === '$OMR conservation');
  assert(near(Number(conservAfter.drift), Number(conservBefore.drift)),
    'a 2-day-old plex burn still reconciles — the reason stays in the vocabulary AND the burn term forever');
  assert(inv2.checks.find((c) => c.name === 'plex mint retired').ok,
    '…and does NOT trip the freshness alarm, which is about new writes, not history');
}

// ── (6) end-to-end extraction: the earner withdraws Vig-funded $OMR (a REAL living, not charity) ──
r = await call('POST', '/v1/wallet/challenge', { token });
const sig = await player.signMessage({ message: r.body.message });
await call('POST', '/v1/wallet/verify', { token, body: { address: player.address, signature: sig } });
// Withdrawing needs a MINTED account, and the mint is ETH ONLY — so the identity is paid for the way
// the game now requires: a real fee payment on the chain rail (the worker's fee watcher calls this on
// a MintFeePaid event; the mod route is its manual twin). This block used to reach `minted` through
// the PLEX mint, which is exactly the rail that retired.
assert.equal((await call('POST', '/v1/withdraw', { token, body: { amount: 5 } })).code, 400,
  'an unminted account cannot extract — minting is the gate, and it is ETH only');
await call('POST', '/v1/mod/fees/record', { headers: modH,
  body: { nonce: 7001, kind: 'mint', payer: player.address, amountWei: '10000000000000000' } });
assert.equal((await call('POST', '/v1/character/mint', { token })).body.minted, true, 'the ETH fee bought the identity');
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
r = await call('POST', '/v1/withdraw', { token, body: { amount: 5 } });
assert.equal(r.body.status, 'signed', 'A6: a further withdrawal signs against the trade-widened reserve');
assert(vig.invariants.summary.extracted <= vig.invariants.summary.funded + 1e-9, 'A6: extraction never exceeds the funded reserve');

// ── (7) §10.4 in-game conservation holds with the prize mint + PLEX/withdraw burns + the trade source in the mix ──
assert((await runLedgerInvariants(pool, { alert: false })).ok, '§10.4 in-game ledger still balances (prize:omr mint offset by plex:* + withdraw:omr burns; trade revenue is out-of-band)');

console.log('✅ Vig test passed — real revenue → 60/40 split → buyback (spend ≤ inflow) → reserve+prize → prize payout → the PLEX bridge (the MINT is ETH only — and the Store door beside it is shut; the respawn pays in earned $OMR, and the freshness check is narrowed to the dead rail so it cannot fire on the live one) → real Vig-funded withdrawal + TIER A: a TRADE-fee source (the afterSwap→Vig hook rail) splits/buys/reconciles end-to-end and WIDENS extraction≤inflow, §10.4 untouched — the extraction-≤-inflow invariant + §10.4 conservation holding throughout');
await app.close();
