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


// ════════════ THE SECONDARY-MARKET EXCLUSION (the deed Transfer watcher's teeth) ════════════
// A extracted Mott Street and SELLS the deed NFT on a marketplace. The Transfer watcher records the
// new on-chain owner; from that moment A's allocations must STOP targeting the deed — its ERC-6551
// vault belongs to the buyer, and pushing A's stock into it would hand A's assets to a stranger.
{
  const { recordDeedTransfer } = await import('../src/chain.js');
  // A's SIWE-linked wallet (the exclusion compares against THIS)
  // the fixture never made an account_persistent row for accA (the rail itself doesn't need one) —
  // the exclusion compares against the SIWE-linked wallet stored there, so seed it
  await q("INSERT INTO account_persistent (account_id, wallet_address) VALUES ('accA','0xAAAA00000000000000000000000000000000aaaa')");
  // the MINT transfer records the FIRST owner = A's wallet (mixed case on purpose — logs arrive
  // checksummed, SIWE stores lowercase; the comparison must not care)
  const mint = await recordDeedTransfer(pool, { tokenId: '777', from: '0x0000000000000000000000000000000000000000', to: '0xAAAA00000000000000000000000000000000AAAA' });
  assert.ok(mint.changed, 'the mint records the first owner');
  assert.ok(await deedTbaFor(pool, 'accA'), 'held by the extractor: still the delivery target');
  assert.equal((await q("SELECT COUNT(*) c FROM street_deed_history WHERE account_id='onchain:777' AND kind='sold'")).rows[0].c, '0',
    'a MINT is not a sale — no legend line');

  // the SALE: the deed moves to a stranger's wallet
  const sale = await recordDeedTransfer(pool, { tokenId: '777', from: '0xAAAA00000000000000000000000000000000aaaa', to: '0xB0B0000000000000000000000000000000000b0b' });
  assert.ok(sale.changed, 'the sale records the new owner');
  assert.equal((await q("SELECT onchain_owner FROM street_deeds WHERE onchain_token_id='777'")).rows[0].onchain_owner,
    '0xb0b0000000000000000000000000000000000b0b', 'owner stored lowercased');
  assert.equal((await q("SELECT COUNT(*) c FROM street_deed_history WHERE account_id='onchain:777' AND kind='sold'")).rows[0].c, '1',
    'the sale is on the deed\'s public legend — provenance is the value');
  // REPLAY-SAFETY: a re-scanned log window delivers the same event again — nothing may duplicate
  const replay = await recordDeedTransfer(pool, { tokenId: '777', from: '0xAAAA00000000000000000000000000000000aaaa', to: '0xB0B0000000000000000000000000000000000b0b' });
  assert.equal(replay.changed, false, 'a replayed transfer is a no-op');
  assert.equal((await q("SELECT COUNT(*) c FROM street_deed_history WHERE account_id='onchain:777' AND kind='sold'")).rows[0].c, '1',
    'no duplicate legend line on replay');

  // THE EXCLUSION: A is no longer a delivery target — the allocation waits again
  assert.equal(await deedTbaFor(pool, 'accA'), null, 'a SOLD deed stops being its extractor\'s delivery target');
  const plan = await planStockDeliveries(pool);
  assert.ok(!plan.some((p) => p.accountId === 'accA'), 'the plan drops A — their stock stays OWED, never pushed into a stranger\'s vault');
  // and the BOARD agrees with the plan (a board/plan disagreement is the check-5 "control that lies"
  // class): A still holds an undelivered allocation (the e2 comp), so they now count as waiting too
  assert.equal((await stockDeliveryBoard(pool)).waitingOnADeed, 2,
    'the board counts A as waiting after the sale — board and plan apply the SAME exclusion');

  // A BUYS IT BACK (or the buyer is A on another day): the target returns
  await recordDeedTransfer(pool, { tokenId: '777', from: '0xB0B0000000000000000000000000000000000b0b', to: '0xAAAA00000000000000000000000000000000AAAA' });
  assert.ok(await deedTbaFor(pool, 'accA'), 'bought back: the delivery target returns');
  assert.equal((await stockDeliveryBoard(pool)).waitingOnADeed, 1, 'bought back: the board returns to B alone');
}


// ════════════ THE DELIVERY KEEPER — the tx sender the rail was missing ════════════
// Stage + CLAIM + send, through the __setTxSender seam; the Delivered watcher (not the keeper)
// confirms. Claim-then-send (the push.js C1 discipline) is the mutation target: without the atomic
// sent_at claim, every keeper tick re-sends every pending delivery.
{
  const { runStockDeliveryKeeper, __setTxSender } = await import('../src/stockdeliver.js');
  const txBefore = await txCount();
  const sends = [];
  __setTxSender(async (d) => { sends.push(d); return '0xkeeper' + sends.length; });

  // a fresh owed allocation for A (deed bought back above, so A is a live target) + one for a ticker
  // with NO configured token address (the named-skip path)
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e4','accA','AAPL',7)");
  const tokens = { AAPL: '0x1111111111111111111111111111111111111111',
    TSLA: '0x2222222222222222222222222222222222222222' }; // TSLA priced so the e2 comp row is REACHED (and skipped by name)

  let run = await runStockDeliveryKeeper(pool, { tokens });
  assert.equal(run.dormant, false, 'the seam arms the keeper (no env needed in the suite)');
  assert.equal(run.sent.length, 1, 'exactly ONE send — the e4/AAPL allocation');
  assert.equal(sends.length, 1, 'the seam saw the send');
  assert.equal(sends[0].token, tokens.AAPL, 'the ticker resolved to its ERC-20 address');
  assert.equal(sends[0].units, 7, 'the owed units rode the send');
  assert.ok(sends[0].to && sends[0].to.startsWith('0x'), 'the deed TBA is the destination');
  // the TSLA allocation (e2) has a SIMULATED comp row — the keeper must skip it BY NAME, and the
  // ticker-with-no-address path must also be named, never silent (the no_budget lesson)
  assert.ok(run.skipped.some((k) => k.why === 'simulated'), 'a comp-staged delivery is skipped by name');
  const row = (await q("SELECT status, sent_at FROM stock_deliveries WHERE epoch_id='e4'")).rows[0];
  assert.equal(row.status, 'pending', 'the keeper never confirms — the Delivered watcher owns that');
  assert.ok(row.sent_at, 'the claim stamped sent_at');

  // CLAIM-THEN-SEND: a second keeper tick inside the resend window must NOT re-send
  run = await runStockDeliveryKeeper(pool, { tokens });
  assert.equal(run.sent.length, 0, 'a second run does not re-send a claimed in-flight delivery');
  assert.equal(sends.length, 1, 'the seam saw no second send');
  assert.ok(run.skipped.some((k) => k.why === 'in_flight_or_done'), 'the in-flight skip is named');

  // ...but a send the watcher never confirms RETRIES once the claim ages out of the resend window
  run = await runStockDeliveryKeeper(pool, { tokens, resendMs: 0 });
  assert.equal(sends.length, 2, 'an unconfirmed send retries after the resend window');
  // the retry reused the SAME deliveryId — on-chain usedDeliveryId makes the duplicate a clean revert
  assert.equal(sends[0].deliveryId, sends[1].deliveryId, 'the retry reuses the deterministic deliveryId');

  // the watcher confirms → the keeper stops touching it for good
  await confirmStockDelivered(pool, { deliveryId: sends[0].deliveryId, txHash: '0xkeeper-final' });
  run = await runStockDeliveryKeeper(pool, { tokens, resendMs: 0 });
  assert.equal(sends.length, 2, 'a confirmed delivery is never re-sent');

  // a FAILED send releases the claim so the very next tick retries
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e5','accA','AAPL',3)");
  __setTxSender(async () => { throw new Error('rpc down'); });
  run = await runStockDeliveryKeeper(pool, { tokens });
  assert.ok(run.skipped.some((k) => k.why === 'send_failed'), 'a failed send is named');
  const failedRow = (await q("SELECT sent_at FROM stock_deliveries WHERE epoch_id='e5'")).rows[0];
  assert.equal(failedRow.sent_at, null, 'the failed claim was RELEASED — the next tick retries immediately');
  __setTxSender(async (d) => { sends.push(d); return '0xretry'; });
  run = await runStockDeliveryKeeper(pool, { tokens });
  assert.equal(run.sent.length, 1, 'the released delivery went out on the next tick');

  // a planned ticker with NO token address skips BY NAME (never reads as an empty plan)
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e6','accA','TSLA',2)");
  run = await runStockDeliveryKeeper(pool, { tokens: { AAPL: tokens.AAPL } }); // no TSLA address this run
  assert.ok(run.skipped.some((k) => k.ticker === 'TSLA' && k.why === 'no_token_address'),
    'a ticker with no configured address is skipped by NAME');

  // DORMANT without the seam or the env — and the whole keeper wrote ZERO transactions rows
  __setTxSender(null);
  run = await runStockDeliveryKeeper(pool);
  assert.equal(run.dormant, true, 'without the seam or env the keeper is dormant');
  assert.equal(await txCount(), txBefore, 'the delivery keeper writes ZERO transactions rows (out-of-band)');
  __setTxSender(null);
}

console.log('✅ stock delivery rail: the deed-required gate, stage→confirm (real flips / comp never), idempotency, the delivered<=allocated wall, the board, the secondary-market exclusion, THE DELIVERY KEEPER (claim-then-send, named skips, retry-on-release), and §10.4-neutrality');
await pool.end?.();
