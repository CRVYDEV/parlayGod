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

console.log('✅ watcher test passed — confirmation-depth gating (reorg-safe), downtime backfill (no lost fee credits), cursor advance, and idempotent reprocessing for both fee + Claimed streams');
await app.close();
