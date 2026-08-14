// THE STOCK DELIVERY RAIL (brokers §3.4) — treasury-bought stock lands in the player's on-chain STREET
// DEED's ERC-6551 token-bound account. This suite proves the DB core (the fully-testable part; the
// on-chain TBA read + the real StockVault.deliver send are the mainnet edge, proven on devnet like the
// rest of the chain-live paths): the DEED-REQUIRED gate in the plan (an account with no extracted deed
// waits), the two-phase stage→confirm (only a REAL, confirmed delivery flips the allocation — a comp
// never does, the treasury.js txHash gate), idempotency both ways, the `delivered <= allocated`
// nightly wall, the board, and §10.4-NEUTRALITY (the whole rail writes ZERO transactions rows).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { makeDb } from '../src/db.js';
import {
  deliveryIdFor, deedTbaFor, planStockDeliveries, stageStockDelivery, confirmStockDelivered,
  deliverStock, stockDeliveryBoard, __setTbaResolver,
} from '../src/stockdeliver.js';
import { runTreasuryInvariants } from '../src/treasury.js';

const pool = await makeDb();
// a deterministic TBA resolver (the test seam) — production reads the ERC-6551 registry on-chain.
const FAKE_TBA = (tokenId) => '0x' + BigInt(tokenId).toString(16).padStart(40, '0');
__setTbaResolver(async (tokenId) => FAKE_TBA(tokenId));

const q = (sql, args) => pool.query(sql, args);
const txCount = async () => Number((await q('SELECT COUNT(*) n FROM transactions')).rows[0].n);
const allocDelivered = async (epoch, acct, ticker) => (await q(
  'SELECT delivered FROM stock_allocations WHERE epoch_id=$1 AND account_id=$2 AND ticker=$3', [epoch, acct, ticker])).rows[0]?.delivered;
const checkOf = async (name) => (await runTreasuryInvariants(pool)).checks.find((c) => c.name === name);

// ── seed: held stock, an extracted deed for A (no deed for B), and allocations to both ──
await q("INSERT INTO stock_buys (ref, ticker, units, eth_spent, price_eth_per_unit, tx_hash, real) VALUES ('buy1','AAPL',100,1,0.01,'0xhash',true)");
await q("INSERT INTO stock_buys (ref, ticker, units, eth_spent, price_eth_per_unit, tx_hash, real) VALUES ('buy2','TSLA',100,1,0.01,'0xhash2',true)");
// A extracted a Street Deed — account_id re-keyed to onchain:<tokenId>, extracted_by_account = A.
await q("INSERT INTO street_deeds (account_id, name, name_lc, district, onchain_token_id, extracted_by_account, extracted_at) VALUES ('onchain:777','Mott Street','mott street','docks','777','accA', now())");
// B holds a deed IN-GAME but has NOT extracted it (onchain_token_id null) — so it is not a delivery target.
await q("INSERT INTO street_deeds (account_id, name, name_lc, district) VALUES ('accB','Mulberry Street','mulberry street','canal')");
// owed: A gets AAPL (deliverable) + TSLA (for the comp test); B gets AAPL (waits — no extracted deed).
await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e1','accA','AAPL',10)");
await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e2','accA','TSLA',5)");
await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e1','accB','AAPL',5)");

const tx0 = await txCount();

// ════════════ THE DEED-REQUIRED GATE (the plan) ════════════
{
  const plan = await planStockDeliveries(pool);
  const accts = plan.map((p) => p.accountId);
  assert(accts.includes('accA'), 'A (extracted deed) is a delivery target');
  assert(!accts.includes('accB'), 'B (no extracted deed) is NOT a target — its allocation waits');
  const aAapl = plan.find((p) => p.accountId === 'accA' && p.ticker === 'AAPL');
  assert(aAapl && aAapl.deedTokenId === '777' && aAapl.units === 10, 'A/AAPL resolves to the extracted deed + owed units');
}

// ════════════ deedTbaFor — resolves the extracted deed's TBA; null for an account with none ════════
{
  const tgt = await deedTbaFor(pool, 'accA');
  assert(tgt && tgt.tba === FAKE_TBA('777') && tgt.deedTokenId === '777', 'A resolves to its deed TBA');
  assert.equal(await deedTbaFor(pool, 'accB'), null, 'B (no extracted deed) resolves to no target');
}

// ════════════ deliveryIdFor is deterministic ════════════
{
  const id1 = await deliveryIdFor('e1', 'accA', 'AAPL');
  const id2 = await deliveryIdFor('e1', 'accA', 'aapl'); // ticker case-normalized
  assert.equal(id1, id2, 'deliveryId is deterministic + ticker-case-insensitive');
  assert(/^\d+$/.test(id1), 'deliveryId is a decimal uint256 string');
}

// ════════════ STAGE → CONFIRM: only a real, confirmed delivery flips the allocation ════════════
{
  const staged = await stageStockDelivery(pool, { epochId: 'e1', accountId: 'accA', ticker: 'AAPL', units: 10 });
  assert(staged.staged && staged.status === 'pending' && staged.tba === FAKE_TBA('777'), 'staged a pending delivery to the deed TBA');
  // a pending stage does NOT flip the allocation yet — it is not on-chain-confirmed
  assert.equal(await allocDelivered('e1', 'accA', 'AAPL'), false, 'pending stage leaves the allocation undelivered');
  // re-stage is idempotent
  const again = await stageStockDelivery(pool, { epochId: 'e1', accountId: 'accA', ticker: 'AAPL', units: 10 });
  assert(again.duplicate, 're-stage is a no-op');

  // the Delivered watcher confirms it
  const c = await confirmStockDelivered(pool, { deliveryId: staged.deliveryId, txHash: '0xdeliver1' });
  assert(c.confirmed && c.ticker === 'AAPL', 'confirm flips the delivery');
  assert.equal(await allocDelivered('e1', 'accA', 'AAPL'), true, 'a CONFIRMED delivery flips the allocation');
  const row = (await q('SELECT status, tx_hash FROM stock_deliveries WHERE delivery_id=$1', [staged.deliveryId])).rows[0];
  assert(row.status === 'delivered' && row.tx_hash === '0xdeliver1', 'the ledger row is delivered + carries the txHash');
  // re-confirm (a re-scanned log) is a no-op
  assert((await confirmStockDelivered(pool, { deliveryId: staged.deliveryId, txHash: '0xdeliver1' })).duplicate, 're-confirm is a no-op');
}

// ════════════ THE COMP GATE: a simulated delivery is never confirmed, never flips ════════════
{
  const comp = await stageStockDelivery(pool, { epochId: 'e2', accountId: 'accA', ticker: 'TSLA', units: 5, simulate: true });
  assert(comp.status === 'simulated', 'a comp stages simulated');
  // the watcher would refuse to confirm a simulated row (a comp must never assert delivery)
  const c = await confirmStockDelivered(pool, { deliveryId: comp.deliveryId, txHash: '0xcomp' });
  assert(c.notPending, 'a simulated comp is never upgraded to delivered');
  assert.equal(await allocDelivered('e2', 'accA', 'TSLA'), false, 'the comp flips no allocation');
}

// ════════════ deliverStock (real path) — stage + confirm in one call ════════════
{
  // free the TSLA comp first so a real deliver can stage a fresh id path: use a NEW epoch to avoid the
  // simulated row's deliveryId collision (same epoch/account/ticker → same id).
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e3','accA','TSLA',5)");
  const r = await deliverStock(pool, { epochId: 'e3', accountId: 'accA', ticker: 'TSLA', units: 5, txHash: '0xreal2' });
  assert(r.confirmed, 'a real deliver stages + confirms in one call');
  assert.equal(await allocDelivered('e3', 'accA', 'TSLA'), true, 'the real deliver flipped the allocation');
}

// ════════════ THE no_target REFUSAL: an account with no extracted deed ════════════
{
  await assert.rejects(
    () => stageStockDelivery(pool, { epochId: 'e1', accountId: 'accB', ticker: 'AAPL', units: 5 }),
    (e) => e.code === 'no_target', 'delivery to an account with no extracted deed refuses (the allocation waits)');
}

// ════════════ THE delivered <= allocated WALL ════════════
{
  const ok = await checkOf('delivered <= allocated (AAPL, units)');
  assert(ok && ok.ok, 'delivered (10) <= allocated (15) for AAPL holds');
  // force an over-delivery (a bug that double-booked) and the nightly wall must catch it
  await q("INSERT INTO stock_deliveries (delivery_id, epoch_id, account_id, ticker, units, deed_token_id, tba, tx_hash, status) VALUES ('over','eX','accA','AAPL',999,'777',$1,'0xbad','delivered')", [FAKE_TBA('777')]);
  const bad = await checkOf('delivered <= allocated (AAPL, units)');
  assert(bad && !bad.ok, 'an over-delivery trips the delivered <= allocated wall');
  await q("DELETE FROM stock_deliveries WHERE delivery_id='over'"); // restore
}

// ════════════ THE BOARD ════════════
{
  const b = await stockDeliveryBoard(pool);
  const aapl = b.tickers.find((t) => t.ticker === 'AAPL');
  assert(aapl && aapl.allocated === 15 && aapl.delivered === 10 && aapl.pending === 5, 'board: AAPL owed 15 / delivered 10 / pending 5');
  assert.equal(b.waitingOnADeed, 1, 'B is counted as waiting on a deed (owed stock, no extracted deed)');
}

// ════════════ §10.4-NEUTRALITY: the whole rail moves no in-game currency ════════════
assert.equal(await txCount(), tx0, 'the stock delivery rail writes ZERO transactions rows (out-of-band real value)');

console.log('✅ stock delivery rail: the deed-required gate, stage→confirm (real flips / comp never), idempotency, the delivered<=allocated wall, the board, and §10.4-neutrality');
await pool.end?.();
