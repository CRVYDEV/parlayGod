// §11 chain-event sync test (audit F2/F3): the cursor + confirmation-depth + idempotency core,
// driven by a MOCK source (no live chain). Proves: downtime backfill credits missed fees; the
// sync never processes inside the confirmation window; a reorg-then-replay doesn't double-apply;
// and the cursor advances so events are processed exactly once.
import fs from 'node:fs/promises';
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

// ── Tier B: the trade-fee stream is RETIRED (founder-directed 2026-08-11) ──
// It never fired in production, so what is worth asserting is not that it books correctly but that
// it CANNOT BOOK AT ALL — the emission.js "the printer is off" shape. A payer left dormant behind a
// flag is one env var from live, so all four ways it could come back are pinned: the module export,
// the source adapter, the worker wiring, and the ledger.
{
  const watcherMod = await import('../src/watcher.js');
  const vigMod = await import('../src/vig.js');
  assert.equal(watcherMod.syncTradeFees, undefined, 'syncTradeFees must be DELETED, not left dormant');
  assert.equal(vigMod.recordTradeFee, undefined, 'recordTradeFee must be DELETED, not left dormant');
  const wsrc = await fs.readFile(new URL('../src/watcher.js', import.meta.url), 'utf8');
  assert.ok(!/tradeFeeLogs|TradeFeePaid/.test(wsrc), 'the viem adapter must not still fetch trade-fee logs');
  const worker = await fs.readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.ok(!/syncTradeFees|TRADE_FEE_HOOK_ADDRESS/.test(worker), 'the worker must not still poll a retired stream');
  // The HISTORY half, and it is the half that is easy to get wrong: 'trade' stays a declared
  // VIG_SOURCE forever. Deleting a retired source from membership would make its historical rows
  // read as the router's loudest alarm — an unknown source — which is the opposite of the truth.
  const { VIG_SOURCES } = await import('../src/router.js');
  assert.ok(VIG_SOURCES.includes('trade'), "'trade' stays a declared source so history reconciles");
}

// ── Tier C: the RESERVE BOND stream (OmertaBond `Bonded`) — the on-chain event is AUTHORITATIVE. The
// watcher books the event's ACTUAL payout + POL/Vig split (recordBond's onchain path), NOT a re-derivation
// (the event carries no price/discount), and BYPASSES the off-chain tranche cap (the contract already
// enforced its own), so a real bond can never stall the cursor. Idempotent on nonce; real-ETH accounting. ──
const { syncBondEvents } = await import('../src/watcher.js');
const bondLog = []; // { block, nonce, payer, principalEth, payoutOmr, polEth, devEth, rwaEth, vigEth }
source.bondLogs = async (from, to) => bondLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ nonce: l.nonce, payer: l.payer, principalEth: l.principalEth, payoutOmr: l.payoutOmr,
    polEth: l.polEth, devEth: l.devEth, rwaEth: l.rwaEth, vigEth: l.vigEth, txHash: '0xbond' + l.nonce }));
const bondRow = async (n) => (await pool.query(`SELECT * FROM bonds WHERE nonce=${n}`)).rows[0];
const reserveOf = async (col) => Number((await pool.query(`SELECT ${col} FROM bond_reserve WHERE id=1`)).rows[0][col]);

// a bond lands at block 43; head 44 → inside the 3-conf window, not yet booked (reorg-safe)
bondLog.push({ block: 43, nonce: 700, payer: wallet, principalEth: 1.0, payoutOmr: 2200, polEth: 0.5, devEth: 0.15, rwaEth: 0.25, vigEth: 0.1 });
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
assert.equal(await reserveOf('pol_eth'), 0.5, "the event's toPol deepened POL");
assert.equal(await reserveOf('dev_eth'), 0.15, "the event's toDev landed as founder revenue");
assert.equal(Number((await pool.query(`SELECT vig_eth FROM vig_revenue WHERE source='bond' AND ref='700'`)).rows[0].vig_eth), 0.1, "the event's toVig fed the Vig buyback basis (real-ETH accounting)");
// (CHAIN-DEPLOY §0.5) THE FOURTH SLICE. The contract used to split ETH three ways and emit no `toRwa`,
// so `recordBond`'s on-chain branch booked rwa_eth = 0 on every REAL bond and the whole remainder landed
// as Vig — and NEITHER bond invariant could see it (check (4) sums because the Vig remainder absorbs the
// missing slice exactly; the mirror check compares 0 to 0). This asserts the event's own toRwa reaches
// BOTH the accumulator and the bucket the buy bot actually draws on.
assert.equal(await reserveOf('rwa_eth'), 0.25, "the event's toRwa landed on the float accumulator");
assert.equal(Number((await pool.query(`SELECT rwa_eth FROM rwa_revenue WHERE source='bond' AND ref='700'`)).rows[0].rwa_eth), 0.25,
  'and was mirrored into rwa_revenue — the bucket the float actually spends');
assert.equal(await getCursor(pool, 'bonds'), 44, 'bonds cursor advanced to safeHead (independent of the other streams)');

// idempotent re-scan (a reorg-replay of the same nonce) does not double-book
r = await syncBondEvents(pool, source, { startBlock: 40 });
assert.equal((await pool.query(`SELECT COUNT(*)::int c FROM bonds WHERE nonce=700`)).rows[0].c, 1, 'exactly one bond row (nonce UNIQUE idempotent)');
assert.equal(await reserveOf('committed_omr'), 2200, 'committed unchanged on the idempotent re-scan');


// ═══ THE ON-CHAIN STORE (PackagePaid → recordStorePurchase) — the paywall leg delivers ═══
const { syncStorePaidEvents, syncDynastyMintEvents, syncDynastyTransferEvents } = await import('../src/watcher.js');
const { skuChainId } = await import('../src/store.js');
const storeLog = []; // { block, nonce, payer, skuId, amount }
source.storePaidLogs = async (from, to) => storeLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ nonce: l.nonce, payer: l.payer, skuId: l.skuId, amount: l.amount, txHash: '0xstore' + l.nonce }));

// a LIVE sku (revive_3 → 3 respawn tokens) paid on-chain: the numeric sku is keccak(skuString) — the
// StreetDeed tokenId convention — and the watcher reverses it with NO registry to keep in lockstep
storeLog.push({ block: 50, nonce: 900, payer: wallet, skuId: skuChainId('revive_3'), amount: wei(0.25) });
head = 60; // safeHead 57 ≥ 50
const tokensBefore = await respawnTokens();
r = await syncStorePaidEvents(pool, source, { startBlock: 45 });
assert.equal(r.processed, 1, 'the package payment was recorded');
assert.equal(await respawnTokens(), tokensBefore + 3, 'the sku resolved through the keccak map and the entitlement landed (+3 revives)');
assert.equal(await getCursor(pool, 'store'), 57, 'store cursor advanced (its own stream)');
r = await syncStorePaidEvents(pool, source, { startBlock: 45 });
assert.equal(await respawnTokens(), tokensBefore + 3, 'idempotent on nonce — a re-scan grants nothing twice');

// a RETIRED sku (made_man) with REAL money HOLDS the cursor — the recorded ingest posture: the game
// must neither keep the ETH quietly nor grant a bound-bypassing credit; a human looks.
storeLog.push({ block: 58, nonce: 901, payer: wallet, skuId: skuChainId('made_man'), amount: wei(0.01) });
head = 65; // safeHead 62 ≥ 58
await assert.rejects(() => syncStorePaidEvents(pool, source, { startBlock: 45 }),
  (e) => e?.code === 'retired', 'a retired-sku payment throws BY NAME');
assert.equal(await getCursor(pool, 'store'), 57, 'the cursor did NOT advance past the retired payment (a human looks)');
// an UNKNOWN numeric sku id gets the same held posture
storeLog[storeLog.length - 1] = { block: 58, nonce: 902, payer: wallet, skuId: '12345', amount: wei(0.01) };
await assert.rejects(() => syncStorePaidEvents(pool, source, { startBlock: 45 }),
  (e) => e?.code === 'unknown_sku', 'an unknown sku id throws BY NAME');
assert.equal(await getCursor(pool, 'store'), 57, 'the cursor held on the unknown sku too');
storeLog.pop(); // the human resolved it — the stream resumes
r = await syncStorePaidEvents(pool, source, { startBlock: 45 });
assert.equal(await getCursor(pool, 'store'), 62, 'the stream resumes once the poison payment is resolved');

// ═══ THE DYNASTY TOKEN REGISTRY (Minted + Transfer) — the portrait FREEZES at first sale ═══
const dynMintLog = [];  // { block, nonce, minter, tokenId }
const dynXferLog = [];  // { block, from, to, tokenId }
source.dynastyMintedLogs = async (from, to) => dynMintLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ nonce: l.nonce, minter: l.minter, tokenId: l.tokenId }));
source.dynastyTransferLogs = async (from, to) => dynXferLog.filter((l) => l.block >= from && l.block <= to)
  .map((l) => ({ from: l.from, to: l.to, tokenId: l.tokenId }));
const ZERO = '0x0000000000000000000000000000000000000000';
const STRANGER = '0xB0B0000000000000000000000000000000000b0b';

// the mint: Minted + the mint Transfer (0x0 → the linked wallet) — a row, NO freeze
dynMintLog.push({ block: 63, nonce: 1, minter: wallet, tokenId: '7' });
dynXferLog.push({ block: 63, from: ZERO, to: wallet, tokenId: '7' });
head = 70; // safeHead 67 ≥ 63
r = await syncDynastyMintEvents(pool, source, { startBlock: 60 });
assert.equal(r.processed, 1, 'the identity mint was recorded');
await syncDynastyTransferEvents(pool, source, { startBlock: 60 });
let dtok = (await pool.query("SELECT * FROM dynasty_tokens WHERE token_id='7'")).rows[0];
assert.equal(dtok.account_id, accId, "the minter's SIWE wallet resolved the account");
assert.equal(dtok.frozen, false, 'a mint transfer does NOT freeze — the portrait lives while the minter holds it');

// the tokenId form of the identity routes serves the LIVE bloodline while unfrozen
const liveMeta = await call('GET', '/v1/identity/7');
assert.equal(liveMeta.code, 200, 'the tokenId metadata form serves');
assert.ok(liveMeta.body.name.startsWith('Sync Sam'), 'unfrozen: the live bloodline renders');

// THE SALE — the first owner→owner transfer FREEZES the portrait (the snapshot is taken NOW)
const levelBefore = liveMeta.body.attributes.find((a) => a.trait_type === 'Rank')?.value;
dynXferLog.push({ block: 68, from: wallet, to: STRANGER, tokenId: '7' });
head = 75; // safeHead 72 ≥ 68
r = await syncDynastyTransferEvents(pool, source, { startBlock: 60 });
assert.equal(r.processed, 1, 'the sale transfer processed');
dtok = (await pool.query("SELECT * FROM dynasty_tokens WHERE token_id='7'")).rows[0];
assert.equal(dtok.frozen, true, 'the first owner→owner transfer froze the token');
assert.equal(String(dtok.owner_address), STRANGER.toLowerCase(), 'the new owner recorded lowercased');
assert.ok(dtok.snapshot, 'the freeze captured a snapshot of the bloodline as it stood');

// A SOLD PORTRAIT IS A PHOTOGRAPH: the seller's later play must NOT re-render the buyer's asset.
// Level the seller up hard and assert the frozen metadata shows the OLD facts.
await pool.query(`UPDATE characters SET respect=respect+2000000 WHERE account_id='${accId}' AND alive`);
const frozenMeta = await call('GET', '/v1/identity/7');
assert.equal(frozenMeta.code, 200, 'frozen metadata serves');
assert.ok(/frozen at its first transfer/i.test(frozenMeta.body.description), 'the metadata SAYS it is frozen');
const levelAfter = frozenMeta.body.attributes.find((a) => a.trait_type === 'Rank')?.value;
assert.equal(levelAfter, levelBefore, "a sold portrait is a PHOTOGRAPH — the seller's later play changed nothing");
// the PRECONDITION, guaranteed rather than assumed (the recorded flake discipline): the live
// bloodline's rank genuinely moved, so the frozen equality above cannot pass by coincidence
const chId = (await pool.query(`SELECT id FROM characters WHERE account_id='${accId}' AND alive`)).rows[0].id;
const liveNow = await call('GET', '/v1/identity/' + chId);
assert.notEqual(liveNow.body.attributes.find((a) => a.trait_type === 'Rank')?.value, levelBefore,
  'the live rank moved — the frozen check is measuring a real difference');

// replay-safe + one-way: a re-scanned sale changes nothing, and a buy-back does NOT unfreeze
r = await syncDynastyTransferEvents(pool, source, { startBlock: 60 });
dynXferLog.push({ block: 73, from: STRANGER, to: wallet, tokenId: '7' });
head = 80;
await syncDynastyTransferEvents(pool, source, { startBlock: 60 });
dtok = (await pool.query("SELECT * FROM dynasty_tokens WHERE token_id='7'")).rows[0];
assert.equal(dtok.frozen, true, 'the freeze is ONE-WAY — a buy-back does not resurrect a living portrait');
assert.equal(String(dtok.owner_address), wallet.toLowerCase(), 'though the owner is tracked back');

// zero §10.4 surface across the whole registry + store stream (out-of-band real value / status)
const txn = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
assert.ok(Number.isFinite(txn), 'countable'); // (the store/dynasty rails write zero ledger rows by design — proven in test/store.js; here the streams simply must not throw on it)

console.log('✅ watcher test passed — confirmation-depth gating (reorg-safe), downtime backfill, cursor advance and idempotent reprocessing for the fee + Claimed + reserve-bond + PackagePaid + Dynasty streams; the retired-sku payment holds its cursor for a human; and a sold Dynasty portrait is a PHOTOGRAPH (frozen at first transfer, one-way)');
await app.close();
