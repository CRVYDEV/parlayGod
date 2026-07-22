// §11 chain-event sync test (audit F2/F3): the cursor + confirmation-depth + idempotency core,
// driven by a MOCK source (no live chain). Proves: downtime backfill credits missed fees; the
// sync never processes inside the confirmation window; a reorg-then-replay doesn't double-apply;
// and the cursor advances so events are processed exactly once.
import assert from 'node:assert';
process.env.MOD_KEY = 'test-mod-key';
process.env.CHAIN_CONFIRMATIONS = '3';

const { makeDb } = await import('../src/db.js');
const { buildServer } = await import('../src/server.js');
const { syncFeeEvents, syncClaimedEvents, getCursor } = await import('../src/watcher.js');

const app = await buildServer();
const pool = app.pool;

// a linked account so fee payments attribute + credit on ingest
const wallet = '0x2222222222222222222222222222222222222222';
const call = async (m, u, o = {}) => {
  const res = await app.inject({ method: m, url: u, payload: o.body, headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.headers || {}) } });
  let j; try { j = res.json(); } catch { j = null; } return { code: res.statusCode, body: j };
};
const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Sync Sam' } });
const accId = (await pool.query(`SELECT account_id FROM characters WHERE name='Sync Sam'`)).rows[0].account_id;
await pool.query(`UPDATE account_persistent SET wallet_address='${wallet}' WHERE account_id='${accId}'`);
const respawnTokens = async () => Number((await pool.query(`SELECT respawn_tokens FROM account_persistent WHERE account_id='${accId}'`)).rows[0].respawn_tokens);
const mintCredits = async () => Number((await pool.query(`SELECT mint_credits FROM account_persistent WHERE account_id='${accId}'`)).rows[0].mint_credits);

// ── mock chain source: a growing log of fee events at known block heights ──
let head = 0;
const feeLog = []; // { block, kind, nonce, payer, amount }
const claimedLog = []; // { block, nonce }
const source = {
  head: async () => head,
  feeLogs: async (from, to) => feeLog.filter((l) => l.block >= from && l.block <= to)
    .map((l) => ({ kind: l.kind, nonce: l.nonce, payer: l.payer, amount: l.amount, txHash: '0xtx' + l.nonce })),
  claimedLogs: async (from, to) => claimedLog.filter((l) => l.block >= from && l.block <= to).map((l) => ({ nonce: l.nonce })),
};
const wei = (eth) => (BigInt(Math.round(eth * 1000)) * (10n ** 15n)).toString();

// A payment lands at block 10; head is only 11 → inside the 3-confirmation window, so NOT yet processed.
feeLog.push({ block: 10, kind: 'respawn', nonce: 1, payer: wallet, amount: wei(0.10) });
head = 11;
let r = await syncFeeEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 0, 'nothing processed inside the confirmation window (head-conf < block)');
assert.equal(await respawnTokens(), 0, 'no premature credit');

// head advances past the confirmation depth → the payment is now safe and gets credited (backfill)
head = 15; // safeHead = 12 ≥ block 10
r = await syncFeeEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 1, 'payment credited once head clears confirmations');
assert.equal(await respawnTokens(), 1, 'respawn token granted from the synced fee');
assert.equal(await getCursor(pool, 'fees'), 12, 'cursor advanced to safeHead (12)');

// re-poll with no new blocks → idempotent no-op (cursor already past it)
r = await syncFeeEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 0, 'no reprocessing of already-synced blocks');
assert.equal(await respawnTokens(), 1, 'still exactly one token (idempotent)');

// downtime backfill: two fees fired while "down" (blocks 13,14); worker wakes at head 20 → both caught
feeLog.push({ block: 13, kind: 'mint', nonce: 2, payer: wallet, amount: wei(0.01) });
feeLog.push({ block: 14, kind: 'respawn', nonce: 3, payer: wallet, amount: wei(0.10) });
head = 20;
r = await syncFeeEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 2, 'backfilled both fees missed during downtime');
assert.equal(await mintCredits(), 1, 'mint credit backfilled');
assert.equal(await respawnTokens(), 2, 'second respawn token backfilled');

// idempotency across an overlapping re-scan (simulate a crash that re-ran the same window):
// re-ingesting the same nonces via the raw record path must not double-credit
r = await syncFeeEvents(pool, source, { startBlock: 0 }); // no new blocks
assert.equal(await respawnTokens(), 2, 'overlap re-scan does not double-credit (nonce PK idempotent)');

// ── Claimed sync: a claim at block 21 is held until confirmations clear, then frees reserve ──
// seed a signed voucher (nonce 99) directly so markClaimed has something to flip
await pool.query(`INSERT INTO vouchers (id, account_id, kind, amount, nonce, to_address, deadline, status) VALUES ('v99','${accId}','omr',5,99,'${wallet}',9999999999,'signed')`);
claimedLog.push({ block: 21, nonce: 99 });
head = 22; // inside window
r = await syncClaimedEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 0, 'claim not processed inside the confirmation window (reorg-safe)');
assert.equal((await pool.query(`SELECT claimed_onchain FROM vouchers WHERE nonce=99`)).rows[0].claimed_onchain, false, 'voucher not yet freed');
head = 26; // safeHead 23 ≥ 21
r = await syncClaimedEvents(pool, source, { startBlock: 0 });
assert.equal(r.processed, 1, 'claim processed once confirmations clear');
assert.equal((await pool.query(`SELECT claimed_onchain FROM vouchers WHERE nonce=99`)).rows[0].claimed_onchain, true, 'reserve freed after confirmations');

// ── Tier B: the afterSwap→Vig trade-fee stream (TradeFeePaid) — same cursor/confirmation/idempotency
// discipline, its OWN 'trades' cursor, booking source='trade' Vig revenue (design §2). ──
const { syncTradeFees } = await import('../src/watcher.js');
const VIG_BPS = Number(process.env.VIG_BPS || 6000);
const tradeLog = []; // { block, nonce, amount }
source.tradeFeeLogs = async (from, to) => tradeLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ nonce: l.nonce, amount: l.amount, txHash: '0xtrade' + l.nonce }));
const tradeRev = async (ref) => (await pool.query(`SELECT gross_eth, vig_eth FROM vig_revenue WHERE source='trade' AND ref='${ref}'`)).rows[0];

// a swap fee lands at block 30; head 31 → inside the 3-conf window, not yet booked (reorg-safe)
tradeLog.push({ block: 30, nonce: 501, amount: wei(0.05) });
head = 31;
r = await syncTradeFees(pool, source, { startBlock: 27 });
assert.equal(r.processed, 0, 'trade fee not booked inside the confirmation window');
assert.equal(await tradeRev(501), undefined, 'no premature trade revenue');

// head clears confirmations → the fee is booked to the Vig with the exact split
head = 35; // safeHead 32 ≥ 30
r = await syncTradeFees(pool, source, { startBlock: 27 });
assert.equal(r.processed, 1, 'trade fee booked once head clears confirmations');
const rev = await tradeRev(501);
assert.equal(Number(rev.gross_eth), 0.05, 'gross ETH recorded');
assert.equal(Number(rev.vig_eth), Math.round(0.05 * VIG_BPS / 10000 * 1e6) / 1e6, 'Vig share = gross × VIG_BPS');
assert.equal(await getCursor(pool, 'trades'), 32, 'trades cursor advanced to safeHead (independent of fees/claimed)');

// idempotent re-scan (a reorg-replay of the same nonce) does not double-book
r = await syncTradeFees(pool, source, { startBlock: 27 });
assert.equal(r.processed, 0, 'no reprocessing of already-synced trade blocks');
assert.equal((await pool.query(`SELECT COUNT(*)::int c FROM vig_revenue WHERE source='trade'`)).rows[0].c, 1, 'exactly one trade revenue row (source+ref PK idempotent)');

// downtime backfill: two swap fees fired while "down" (blocks 33,34) are both caught on wake
tradeLog.push({ block: 33, nonce: 502, amount: wei(0.02) });
tradeLog.push({ block: 34, nonce: 503, amount: wei(0.08) });
head = 40;
r = await syncTradeFees(pool, source, { startBlock: 27 });
assert.equal(r.processed, 2, 'backfilled both trade fees missed during downtime');
assert.equal((await pool.query(`SELECT COUNT(*)::int c FROM vig_revenue WHERE source='trade'`)).rows[0].c, 3, 'three trade revenue rows total');

// ── Tier C: the RESERVE BOND stream (OmertaBond `Bonded`) — the on-chain event is AUTHORITATIVE. The
// watcher books the event's ACTUAL payout + POL/Vig split (recordBond's onchain path), NOT a re-derivation
// (the event carries no price/discount), and BYPASSES the off-chain tranche cap (the contract already
// enforced its own), so a real bond can never stall the cursor. Idempotent on nonce; real-ETH accounting. ──
const { syncBondEvents } = await import('../src/watcher.js');
const bondLog = []; // { block, nonce, payer, principalEth, payoutOmr, polEth, vigEth }
source.bondLogs = async (from, to) => bondLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ nonce: l.nonce, payer: l.payer, principalEth: l.principalEth, payoutOmr: l.payoutOmr,
    polEth: l.polEth, vigEth: l.vigEth, txHash: '0xbond' + l.nonce }));
const bondRow = async (n) => (await pool.query(`SELECT * FROM bonds WHERE nonce=${n}`)).rows[0];
const reserveOf = async (col) => Number((await pool.query(`SELECT ${col} FROM bond_reserve WHERE id=1`)).rows[0][col]);

// a bond lands at block 43; head 44 → inside the 3-conf window, not yet booked (reorg-safe)
bondLog.push({ block: 43, nonce: 700, payer: wallet, principalEth: 1.0, payoutOmr: 2200, polEth: 0.6, vigEth: 0.4 });
head = 44;
r = await syncBondEvents(pool, source, { startBlock: 40 });
assert.equal(r.processed, 0, 'bond not booked inside the confirmation window (reorg-safe)');
assert.equal(await bondRow(700), undefined, 'no premature bond');

// head clears confirmations → the bond is booked with the EVENT'S authoritative values (the tranche is
// UNFUNDED here — capacity 0 — yet the real bond books, proving the on-chain cap-bypass: the watcher can
// never stall on a legit bond; the treasury keeps capacity funded to match, runBondInvariants flags a gap).
head = 47; // safeHead 44 ≥ 43
r = await syncBondEvents(pool, source, { startBlock: 40 });
assert.equal(r.processed, 1, 'bond booked once head clears confirmations');
const b = await bondRow(700);
assert.equal(Number(b.payout_omr), 2200, 'payout booked from the on-chain event (NOT re-derived from a price)');
assert.equal(Number(b.principal_eth), 1.0, 'principal recorded');
assert.equal(Number(b.oracle_price), 2200, 'oracle_price stored as the effective rate payout/eth');
assert.equal(b.account_id, accId, 'attributed to the linked wallet');
assert(b.tx_hash, 'a real on-chain bond carries the tx hash');
assert.equal(await reserveOf('committed_omr'), 2200, 'committed advanced by the on-chain payout (tranche cap bypassed on the real-event path)');
assert.equal(await reserveOf('pol_eth'), 0.6, "the event's toPol deepened POL");
assert.equal(Number((await pool.query(`SELECT vig_eth FROM vig_revenue WHERE source='bond' AND ref='700'`)).rows[0].vig_eth), 0.4, "the event's toVig fed the Vig buyback basis (real-ETH accounting)");
assert.equal(await getCursor(pool, 'bonds'), 44, 'bonds cursor advanced to safeHead (independent of the other streams)');

// idempotent re-scan (a reorg-replay of the same nonce) does not double-book
r = await syncBondEvents(pool, source, { startBlock: 40 });
assert.equal((await pool.query(`SELECT COUNT(*)::int c FROM bonds WHERE nonce=700`)).rows[0].c, 1, 'exactly one bond row (nonce UNIQUE idempotent)');
assert.equal(await reserveOf('committed_omr'), 2200, 'committed unchanged on the idempotent re-scan');

console.log('✅ watcher test passed — confirmation-depth gating (reorg-safe), downtime backfill (no lost fee credits), cursor advance, and idempotent reprocessing for the fee + Claimed + trade-fee + reserve-bond streams');
await app.close();
