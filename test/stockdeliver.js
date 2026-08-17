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
import { runTreasuryInvariants, allocateStock } from '../src/treasury.js';

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

// ════ (red-team HIGH) AN ALLOCATION IS DELIVERED IN TRANCHES, and the second one must still land ════
// `allocateStock` ACCUMULATES into the (epoch, account, ticker) PK, and BROKERS.EPOCH_DAYS is 7 against
// a DAILY ticker ballot — so up to seven buys of the same ticker distribute into the SAME row. The plan
// used to filter a row-level `NOT delivered`, which the first tranche's confirm set forever: every
// later distribution into that epoch became permanently undeliverable real stock, while the board went
// on reporting it pending and `delivered <= allocated` passed at 100 <= 200. This is the default
// operating shape, not an edge, so it is driven end to end: deliver, allocate again, deliver again.
{
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('eT','accA','AAPL',4)");
  const first = await deliverStock(pool, { epochId: 'eT', accountId: 'accA', ticker: 'AAPL', units: 4, txHash: '0xtranche1' });
  assert(first.confirmed, 'the first tranche delivers');
  assert.equal(await allocDelivered('eT', 'accA', 'AAPL'), true, 'and the row reads fully delivered while nothing more is owed');
  // the next day's buy distributes into the SAME frozen epoch
  const c = await pool.connect();
  try { await allocateStock(c, { epochId: 'eT', accountId: 'accA', ticker: 'AAPL', units: 3 }); } finally { c.release(); }
  assert.equal(await allocDelivered('eT', 'accA', 'AAPL'), false,
    'accumulating re-opens the derived flag — the row owes again, and no surface may call that settled');
  const plan = await planStockDeliveries(pool);
  const line = plan.find((p) => p.epochId === 'eT' && p.ticker === 'AAPL');
  assert(line, 'the second tranche is PLANNED — it used to vanish the moment the first one landed');
  assert.equal(line.units, 3, 'and it plans exactly what is OUTSTANDING (units - delivered_units), not the whole row again');
  const second = await deliverStock(pool, { epochId: 'eT', accountId: 'accA', ticker: 'AAPL', units: 3, txHash: '0xtranche2' });
  assert(second.confirmed, 'the second tranche delivers — its deliveryId is keyed on the tranche offset, so it cannot collide with the first');
  const rowT = (await pool.query(
    "SELECT units, delivered_units, delivered FROM stock_allocations WHERE epoch_id='eT' AND account_id='accA' AND ticker='AAPL'")).rows[0];
  assert.equal(Number(rowT.delivered_units), 7, 'the running total carries both tranches');
  assert.equal(Number(rowT.units), 7, 'and nothing is left owed');
  assert.equal(rowT.delivered, true, 'so the derived flag settles again');
  assert.equal((await planStockDeliveries(pool)).filter((p) => p.epochId === 'eT').length, 0, 'a fully-delivered allocation plans nothing');
  const agree = await checkOf('allocation delivery ledger agrees (AAPL, units)');
  assert(agree && agree.ok, 'the allocation ledger and the delivery ledger agree exactly — the bound above cannot see a stalled total');

  // …and the plan must read the RUNNING TOTAL, not the flag, INDEPENDENTLY of anyone remembering to
  // clear it. `allocateStock` does clear it, which is why the assertions above pass either way — so
  // this drives the state that separates them: a row whose flag says settled while units are still
  // owed. That is every row migrated from before this fix, and every row a future writer forgets. A
  // plan that trusts the boolean goes blind here; one that computes `units - delivered_units` does not.
  await q("UPDATE stock_allocations SET units = 9, delivered = true WHERE epoch_id='eT' AND account_id='accA' AND ticker='AAPL'");
  const stale = (await planStockDeliveries(pool)).find((p) => p.epochId === 'eT' && p.ticker === 'AAPL');
  assert(stale, 'a stale `delivered` flag cannot hide outstanding units from the plan');
  assert.equal(stale.units, 2, 'and it still plans exactly what is outstanding (9 owed − 7 delivered)');
  await q("UPDATE stock_allocations SET units = 7, delivered = true WHERE epoch_id='eT' AND account_id='accA' AND ticker='AAPL'"); // restore
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

  // THE RETARGET (the deed FOLLOWS ITS OWNER): the buyer links the wallet that now holds the deed —
  // from that moment THEIR allocations deliver into the vault of the deed they bought (mixed-case
  // wallet on purpose: the rule must not care). The seller's stock never moves into it.
  await q("INSERT INTO account_persistent (account_id, wallet_address) VALUES ('accS','0xB0B0000000000000000000000000000000000B0B')");
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e3','accS','TSLA',4)");
  assert.ok(await deedTbaFor(pool, 'accS'), 'the secondary BUYER (wallet linked) is now the delivery target');
  const plan2 = await planStockDeliveries(pool);
  const sRow = plan2.find((p) => p.accountId === 'accS');
  assert.ok(sRow && sRow.deedTokenId === '777', "the plan delivers the buyer's stock into the deed they bought");
  assert.ok(!plan2.some((p) => p.accountId === 'accA'), "and still never the seller's");
  assert.equal((await stockDeliveryBoard(pool)).waitingOnADeed, 2,
    'the board through the SAME target rule: A + B wait, the buyer does not');

  // A BUYS IT BACK (or the buyer is A on another day): the target returns — and leaves the buyer
  await recordDeedTransfer(pool, { tokenId: '777', from: '0xB0B0000000000000000000000000000000000b0b', to: '0xAAAA00000000000000000000000000000000AAAA' });
  assert.ok(await deedTbaFor(pool, 'accA'), 'bought back: the delivery target returns');
  assert.equal(await deedTbaFor(pool, 'accS'), null, 'and the former buyer\'s allocations wait again');
  assert.equal((await stockDeliveryBoard(pool)).waitingOnADeed, 2, 'bought back: B and the former buyer wait');
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

  // ── A DEED THAT CHANGES HANDS WITH A DELIVERY IN FLIGHT (red team 2026-08-16) ──
  // A SCENARIO WALK, and labelled as one: it adds no wall, it composes the existing ones across a
  // lifecycle event the unit assertions each cover only half of. The question was fair — the row
  // stores the vault resolved when it was STAGED and a resend can be RESEND_MS later, so a blind
  // send would put the seller's units in the BUYER's vault (the vault travels WITH the deed),
  // against THE TARGET RULE's own promise that a sold Street sends its former owner's allocations
  // back to waiting. The answer is that TWO independent walls already stop it: the plan drops the
  // account, and `stageStockDelivery` re-resolves and refuses `no_target` even when called directly.
  // A third wall was written before that was checked, and it could never fire — a wall that cannot
  // fire reads exactly like a wall that works, so it was removed rather than kept for comfort. What
  // was genuinely missing is the end-to-end shape: that a delivery caught mid-flight is HELD rather
  // than lost or silently cancelled, and goes out under its own id once a target exists again.
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e7','accA','AAPL',4)");
  __setTxSender(async () => { throw new Error('rpc down'); });
  await runStockDeliveryKeeper(pool, { tokens });                       // stages the row, then fails → claim released
  const before = sends.length;
  // the Street sells: the Transfer watcher records an owner who is not this account's linked wallet
  await q("UPDATE street_deeds SET onchain_owner='0xstranger0000000000000000000000000000beef' WHERE extracted_by_account='accA'");
  __setTxSender(async (d) => { sends.push(d); return '0xshouldnothappen'; });
  run = await runStockDeliveryKeeper(pool, { tokens });
  assert.equal(sends.length, before, 'nothing goes out once the deed has changed hands');
  assert.ok(!run.sent.length, 'and the keeper reports no send at all — the account left the plan');
  await assert.rejects(
    () => stageStockDelivery(pool, { epochId: 'e7', accountId: 'accA', ticker: 'AAPL', units: 4 }),
    (e) => e.code === 'no_target',
    'the second wall holds too: staging re-resolves, so even a direct call refuses');
  const held2 = (await q("SELECT delivery_id, status, sent_at FROM stock_deliveries WHERE epoch_id='e7'")).rows[0];
  assert.equal(held2.status, 'pending', 'the delivery is still OWED — waiting, never lost');
  assert.equal(held2.sent_at, null, 'its claim was released, so it resumes the moment a target exists again');
  const heldId = held2.delivery_id;
  await q("UPDATE street_deeds SET onchain_owner=NULL WHERE extracted_by_account='accA'"); // the deed comes home
  run = await runStockDeliveryKeeper(pool, { tokens });
  const resumed = sends.find((s) => s.deliveryId === heldId);
  assert.ok(resumed, 'with the target back, the held delivery goes out — waiting is not losing');
  assert.equal(resumed.to, FAKE_TBA('777'), 'to the deed vault, re-resolved on the way out');

  // ── red-team R30 F3: A STAGED DELIVERY MUST NOT OUTLIVE ITS DEED ──────────────────────────────
  // A pending row records where the keeper is ABOUT to send, so it has to carry the target as it
  // stands NOW. `stageStockDelivery` re-resolves it correctly and the duplicate path used to throw
  // that answer away, leaving the keeper's claim to read a STALE tba off the row. The window is
  // ordinary, not exotic: a send that didn't land leaves the row pending BY DESIGN (send_failed
  // releases the claim), and a deed can be sold in that window. The result was real stock delivered
  // into the vault of a deed its recipient had already SOLD — the buyer gets it, the seller's
  // allocation is marked delivered.
  await q("INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e8','accA','AAPL',3)");
  __setTxSender(async () => { throw new Error('rpc down'); });      // the send doesn't land …
  await runStockDeliveryKeeper(pool, { tokens });
  const staleRow = (await q("SELECT delivery_id, tba FROM stock_deliveries WHERE epoch_id='e8'")).rows[0];
  assert.equal(staleRow.tba, FAKE_TBA('777'), 'staged against the deed A held at the time');

  // … A SELLS deed 777 on-chain (the Transfer watcher records the buyer) and extracts a NEW one
  await q("UPDATE account_persistent SET wallet_address='0xbuyer' WHERE account_id='accB'");
  await q("UPDATE street_deeds SET onchain_owner='0xBUYER' WHERE onchain_token_id='777'");
  await q("INSERT INTO street_deeds (account_id, name, name_lc, district, onchain_token_id, extracted_by_account, extracted_at) VALUES ('onchain:888','Bleecker Row','bleecker row','brick','888','accA', now())");
  assert.equal((await deedTbaFor(pool, 'accA')).deedTokenId, '888', "A's target is their NEW deed");

  sends.length = 0;
  __setTxSender(async (a) => { sends.push(a); return '0xtxFresh'; });
  await runStockDeliveryKeeper(pool, { tokens, resendMs: 0 });
  const out = sends.find((s) => s.deliveryId === staleRow.delivery_id);
  assert.ok(out, 'the held delivery goes out once a target exists again');
  assert.equal(out.to, FAKE_TBA('888'), 'to the deed A NOW holds — never the one they sold');
  assert.notEqual(out.to, FAKE_TBA('777'), "the buyer's vault receives nothing that was never theirs");
  assert.equal((await q("SELECT tba FROM stock_deliveries WHERE delivery_id=$1", [staleRow.delivery_id])).rows[0].tba,
    FAKE_TBA('888'), 'and the row itself was refreshed, so the record matches where it went');

  // DORMANT without the seam or the env — and the whole keeper wrote ZERO transactions rows
  __setTxSender(null);
  run = await runStockDeliveryKeeper(pool);
  assert.equal(run.dormant, true, 'without the seam or env the keeper is dormant');
  assert.equal(await txCount(), txBefore, 'the delivery keeper writes ZERO transactions rows (out-of-band)');
  __setTxSender(null);
}

console.log('✅ stock delivery rail: the deed-required gate, stage→confirm (real flips / comp never), idempotency, the delivered<=allocated wall, the board, the secondary-market exclusion, THE DELIVERY KEEPER (claim-then-send, named skips, retry-on-release), and §10.4-neutrality');
await pool.end?.();
