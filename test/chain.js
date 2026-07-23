// M6-B chain-service test: SIWE wallet link, EIP-712 voucher signing PARITY (recover
// the signer), the full-reserve withdrawal queue, $OMR ledger conservation on withdraw,
// and gear-mint vouchers. Runs on pg-mem — zero infra, no live chain. (The Claimed
// watcher needs a real RPC; markClaimed is exercised as its unit-testable core.)
import assert from 'node:assert';
import { recoverTypedDataAddress, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// deterministic test keys (well-known anvil accounts) — set BEFORE importing the server
const SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PLAYER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
process.env.VOUCHER_SIGNER_PK = SIGNER_PK;
process.env.VOUCHER_CLAIM_ADDRESS = '0x1111111111111111111111111111111111111111';
process.env.OMERTA_BOND_ADDRESS = '0x2222222222222222222222222222222222222222'; // the bond-quote verifyingContract
process.env.CHAIN_ID = '46630';
process.env.MOD_KEY = 'test-mod-key';
process.env.WITHDRAW_TAX_BPS = '0'; // legacy exact-amount assertions run toll-free; the EXIT TOLL block below re-arms it

const { buildServer } = await import('../src/server.js');
const { chainConfig, VOUCHER_TYPES, markClaimed, bondChainConfig, BOND_QUOTE_TYPES } = await import('../src/chain.js');
const { recordBond } = await import('../src/bonds.js');
const { reconcileFees } = await import('../src/fees.js');
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
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);

const signerAddr = privateKeyToAccount(SIGNER_PK).address;
const player = privateKeyToAccount(PLAYER_PK);
const player2 = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'); // anvil #2

// ── bootstrap: a character that EARNS $OMR through the AMM (never SQL-seeded) ──
const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Cash Out Carl' } });
const cid = (await meOf(token)).id;
await seedCh(cid, 'cash = 2000000'); // cash isn't the currency under test; $OMR is earned below
let r = await call('POST', '/v1/swap', { token, body: { direction: 'buy', amount: 200000 } });
assert.equal(r.code, 200, 'swap buys $OMR'); assert(r.body.character.omr > 100, 'holds >100 $OMR');

// ── SIWE wallet link (§4 EVM) ──
assert.equal((await call('POST', '/v1/withdraw', { token, body: { amount: 1 } })).code, 400, 'no wallet + unminted, no withdraw');
r = await call('POST', '/v1/wallet/challenge', { token });
assert.equal(r.code, 200, 'challenge issued');
const goodSig = await player.signMessage({ message: r.body.message });
assert.equal((await call('POST', '/v1/wallet/verify', { token, body: { address: player.address, signature: '0xdead' } })).code, 400, 'bad signature rejected');
r = await call('POST', '/v1/wallet/verify', { token, body: { address: player.address, signature: goodSig } });
assert.equal(r.code, 200, 'wallet verified'); assert.equal(r.body.wallet.toLowerCase(), player.address.toLowerCase(), 'wallet linked');

// ── §11 two-tier mint gate: an unminted account can't cash out until the 0.01 ETH fee ──
assert.equal((await call('POST', '/v1/withdraw', { token, body: { amount: 1 } })).code, 400, 'unminted account cannot withdraw');
assert.equal((await call('POST', '/v1/character/mint', { token })).code, 400, 'no mint without a paid credit');
// the worker's fee watcher calls this on a MintFeePaid event; the mod route is its manual twin
r = await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 5001, kind: 'mint', payer: player.address, amountWei: '10000000000000000' } });
assert.equal(r.code, 200); assert(r.body.credited, 'linked wallet credited immediately');
assert.equal((await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 5001, kind: 'mint', payer: player.address, amountWei: '10000000000000000' } })).body.duplicate, true, 'same payment nonce is idempotent');
assert.equal((await call('GET', '/v1/fees/status', { token })).body.mintCredits, 1, 'exactly one mint credit (no double-credit)');
r = await call('POST', '/v1/character/mint', { token });
assert.equal(r.code, 200, 'mint spends the credit'); assert.equal(r.body.minted, true, 'character is made');
assert.equal((await meOf(token)).minted, true, 'view shows minted');
assert.equal((await call('GET', '/v1/fees/status', { token })).body.mintCredits, 0, 'credit consumed');

// ── randomized build + the paid RE-ROLL (0.01 ETH each, infinitely repeatable) ──
{
  const before = (await meOf(token)).stats;
  assert.equal(before.muscle + before.cunning + before.speed, 15, 'a fresh build rolls the fixed 15-point budget');
  assert(before.muscle >= 3 && before.cunning >= 3 && before.speed >= 3, 'each stat floors at 3');
  // no re-roll without a paid credit
  assert.equal((await call('POST', '/v1/character/reroll', { token })).body.error, 'no_reroll_credit', 'no re-roll without a paid credit');
  // pay the fee (the watcher's manual twin) → one credit; idempotent on nonce
  r = await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 5010, kind: 'reroll', payer: player.address, amountWei: '10000000000000000' } });
  assert.equal(r.code, 200); assert(r.body.credited, 're-roll fee credited');
  assert.equal((await call('GET', '/v1/fees/status', { token })).body.rerollCredits, 1, 'one re-roll credit in hand');
  // spend it — the build re-rolls, total conserved (no power creep), the credit is consumed
  r = await call('POST', '/v1/character/reroll', { token });
  assert.equal(r.code, 200, 're-roll spent the credit'); assert(r.body.rerolled, 'rerolled');
  assert.equal(r.body.stats.muscle + r.body.stats.cunning + r.body.stats.speed, 15, 'the re-roll conserves the 15-point budget');
  assert.equal((await meOf(token)).statTotal, 15, 'the view agrees the budget is unchanged');
  assert.equal((await call('GET', '/v1/fees/status', { token })).body.rerollCredits, 0, 're-roll credit consumed');
  // infinitely repeatable — but each needs a fresh paid credit
  assert.equal((await call('POST', '/v1/character/reroll', { token })).body.error, 'no_reroll_credit', 'the next re-roll needs another 0.01 ETH');
  // and it rides the same fee-payment idempotency as mint/respawn
  assert.equal((await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 5010, kind: 'reroll', payer: player.address, amountWei: '10000000000000000' } })).body.duplicate, true, 'a re-delivered re-roll payment is a no-op');
}

// ── full-reserve queue ──
// funded reserve starts at 0 → the first withdrawal QUEUES (debited in-game, unsigned)
const omrBefore = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 10 } });
assert.equal(r.code, 200, 'withdraw accepted'); assert.equal(r.body.status, 'queued', 'queued when reserve is dry');
assert(!r.body.signature, 'no signature while queued');
assert.equal((await meOf(token)).omr, omrBefore - 10, '$OMR debited immediately (no double-spend while queued)');
const nonceA = r.body.nonce;

// ── audit LOW: cancel a still-QUEUED withdrawal → the burned $OMR is refunded (the escape hatch if
//    the reserve never funds to your FIFO position). A separate voucher B, so A survives for the drain. ──
const omrBeforeB = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 5 } });
assert.equal(r.body.status, 'queued', 'a second withdrawal also queues while the reserve is dry');
const vB = r.body.id;
assert.equal((await meOf(token)).omr, omrBeforeB - 5, 'the queued withdrawal debited $OMR');
r = await call('POST', `/v1/withdraw/${vB}/cancel`, { token });
assert.equal(r.code, 200, 'the queued withdrawal cancels'); assert.equal(r.body.refunded, 5, 'the burned $OMR is refunded');
assert.equal((await meOf(token)).omr, omrBeforeB, '$OMR fully restored — no stuck funds (net-0 reversal)');
assert.equal((await call('POST', `/v1/withdraw/${vB}/cancel`, { token })).body.error, 'not_queued', 'a cancelled voucher cannot be cancelled again');

// ── (red-team R19 F2) markClaimed must NO-OP on a QUEUED (never-signed) voucher — the mod /reserve/claimed
//    route could otherwise flip a queued voucher to 'claimed' on an operator typo, permanently stranding
//    its burned $OMR (drainQueue/cancel both require status='queued'). Voucher A is still queued here. ──
assert.equal((await markClaimed(pool, nonceA)).claimed, 0, "markClaimed no-ops on a queued voucher (only status='signed' is claimable)");
assert.equal((await pool.query('SELECT status FROM vouchers WHERE nonce=$1', [nonceA])).rows[0].status, 'queued', 'the queued voucher is untouched — still drainable');

// Safe funds a tranche → the queue drains FIFO and signs A
r = await call('POST', '/v1/mod/reserve/fund', { body: { amount: 100 }, headers: modH });
assert.equal(r.code, 200); assert.equal(r.body.signed, 1, 'funding drained one queued voucher');
let status = (await call('GET', '/v1/withdraw/status', { token })).body;
const vA = status.vouchers.find((v) => v.nonce === nonceA);
assert.equal(vA.status, 'signed', 'A is now signed'); assert(vA.payload?.signature, 'A carries a signature');
assert.equal(status.reserve.signedOutstanding, 10, 'reserve shows 10 outstanding');

// within available reserve → signs immediately
r = await call('POST', '/v1/withdraw', { token, body: { amount: 30 } });
assert.equal(r.body.status, 'signed', 'signs immediately when the tranche covers it (10+30 ≤ 100)');
// exceeding available → queues
r = await call('POST', '/v1/withdraw', { token, body: { amount: 100 } });
assert.equal(r.body.status, 'queued', 'queues when it would exceed the funded tranche (40+100 > 100)');
const nonceC = r.body.nonce;
// fund more → C drains
r = await call('POST', '/v1/mod/reserve/fund', { body: { amount: 100 }, headers: modH });
assert.equal(r.body.signed, 1, 'second funding drains C');
status = (await call('GET', '/v1/withdraw/status', { token })).body;
assert.equal(status.vouchers.find((v) => v.nonce === nonceC).status, 'signed', 'C signed after top-up');

// ── signing PARITY: recover the signer from A's EIP-712 voucher ──
const p = vA.payload;
const message = { to: p.voucher.to, amount: BigInt(p.voucher.amount), kind: p.voucher.kind,
  gearId: BigInt(p.voucher.gearId), nonce: BigInt(p.voucher.nonce), deadline: BigInt(p.voucher.deadline) };
const recovered = await recoverTypedDataAddress({ domain: chainConfig(), types: VOUCHER_TYPES,
  primaryType: 'Voucher', message, signature: p.voucher && p.signature });
assert.equal(recovered.toLowerCase(), signerAddr.toLowerCase(), 'the voucher recovers to the server signer — VoucherClaim will accept it');
assert.equal(BigInt(p.voucher.amount), parseUnits('10', 18), 'amount is 10 $OMR in wei');
assert.equal(p.voucher.to.toLowerCase(), player.address.toLowerCase(), 'pays the linked wallet');

// ── $OMR ledger conservation: withdrawal is a ledgered burn, adds no §10.4 drift ──
const driftOf = async (name) => (await runLedgerInvariants(pool)).checks.find((c) => c.name === name).drift;
const d0 = await driftOf('$OMR conservation');
await call('POST', '/v1/withdraw', { token, body: { amount: 5 } });
assert.equal(await driftOf('$OMR conservation'), d0, 'withdraw is a ledgered burn — $OMR conservation unmoved');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='withdraw:omr'")).rows[0].s) < 0, true, 'withdrawals ledgered as negative $OMR');

// ── gear-mint voucher (not reserve-bounded; contract caps supply) ──
await pool.query(`UPDATE account_persistent SET omr = omr + 10 WHERE account_id = (SELECT account_id FROM characters WHERE id='${cid}')`);
await call('POST', '/v1/gear/knuckles/mint', { token }); // own the gear in-game first
r = await call('POST', '/v1/gear/knuckles/withdraw', { token });
assert.equal(r.code, 200, 'gear withdraw signs'); assert.equal(r.body.status, 'signed');
assert(r.body.voucher.kind === 1 && BigInt(r.body.voucher.gearId) > 0n, 'gear voucher: kind 1, nonzero gearId');
assert.equal((await pool.query(`SELECT minted_onchain FROM account_gear WHERE gear_id='knuckles'`)).rows[0].minted_onchain, true, 'gear marked on-chain');
assert.equal((await call('POST', '/v1/gear/knuckles/withdraw', { token })).code, 400, 'no double-mint of the same gear');

// ── Claimed watcher core: marking a nonce claimed frees its reserve ──
const beforeClaim = (await call('GET', '/v1/mod/reserve', { headers: modH })).body.signedOutstanding;
await call('POST', '/v1/mod/reserve/claimed', { body: { nonce: nonceA }, headers: modH });
const afterClaim = (await call('GET', '/v1/mod/reserve', { headers: modH })).body.signedOutstanding;
assert.equal(afterClaim, beforeClaim - 10, 'a claimed voucher stops counting against the DISPLAYED unclaimed-outstanding');
// audit HIGH: but a claim must NOT free signing ROOM — funded_omr is cumulative-ever and the gate
// counts committed-ever (signed OR claimed), so extraction can never exceed cumulative funding.
const rs = (await call('GET', '/v1/mod/reserve', { headers: modH })).body;
// committed-ever so far: A(10 claimed) + 30 + C(100) + 5 = 145, all against 200 funded → 55 available
assert.equal(rs.committedOutstanding, 145, 'committed-ever counts the claimed voucher too');
assert.equal(rs.available, 200 - 145, 'available = funded − committed-ever (a claim did NOT re-open room)');
// a withdrawal beyond the committed-ever headroom QUEUES even though the claim freed "unclaimed" room
r = await call('POST', '/v1/withdraw', { token, body: { amount: 60 } });
assert.equal(r.body.status, 'queued', 'a claim does not free signing room — 145+60 > 200 queues (no extraction > inflow)');
await pool.query("UPDATE vouchers SET status='queued', signed_payload=NULL WHERE nonce=$1", [r.body.nonce]); // leave the ledger clean for the conservation checks below

// ── §11 pay-before-link: a fee paid before the wallet is linked reconciles on link ──
const { body: { token: tok2 } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token: tok2, body: { name: 'Late Linker Lou' } });
// two payments (mint + respawn) arrive while player2's wallet is unlinked → parked, uncredited
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 6001, kind: 'mint', payer: player2.address, amountWei: '10000000000000000' } });
await call('POST', '/v1/mod/fees/record', { headers: modH, body: { nonce: 6002, kind: 'respawn', payer: player2.address, amountWei: '100000000000000000' } });
assert.equal((await call('GET', '/v1/fees/status', { token: tok2 })).body.mintCredits, 0, 'nothing credited before the wallet links');
const chal2 = (await call('POST', '/v1/wallet/challenge', { token: tok2 })).body.message;
const sig2 = await player2.signMessage({ message: chal2 });
r = await call('POST', '/v1/wallet/verify', { token: tok2, body: { address: player2.address, signature: sig2 } });
assert.equal(r.code, 200); assert.equal(r.body.feesCredited, 2, 'both parked payments reconcile on link');
let fs2 = (await call('GET', '/v1/fees/status', { token: tok2 })).body;
assert.equal(fs2.mintCredits, 1, 'mint credit granted retroactively');
assert.equal(fs2.respawnTokens, 1, 'respawn token granted retroactively');

// ── audit HIGH: reconcileFees must credit ONE payment exactly once, even under concurrent
// links (the old SELECT-then-credit double-credited one on-chain fee into N tokens). ──
const a2id = (await pool.query(`SELECT account_id FROM account_persistent WHERE wallet_address='${player2.address}'`)).rows[0].account_id;
const respBefore = Number((await pool.query(`SELECT respawn_tokens FROM account_persistent WHERE account_id='${a2id}'`)).rows[0].respawn_tokens);
// one fresh, uncredited on-chain payment parked against player2's (already-linked) wallet
await pool.query(`INSERT INTO fee_payments (nonce, kind, payer_address, amount_wei) VALUES (7777,'respawn','${player2.address}','100000000000000000')`);
// fire two reconciles at once (models two concurrent /wallet/verify) — must net exactly +1
await Promise.all([reconcileFees(pool, a2id, player2.address), reconcileFees(pool, a2id, player2.address)]);
const respAfter = Number((await pool.query(`SELECT respawn_tokens FROM account_persistent WHERE account_id='${a2id}'`)).rows[0].respawn_tokens);
assert.equal(respAfter - respBefore, 1, 'one fee → exactly one token, even across concurrent reconciles (no double-credit)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM fee_payments WHERE nonce=7777 AND credited`)).rows[0].n), 1, 'payment claimed exactly once');

// ── audit MED-1/MED-2: expired-unclaimed vouchers are RECLAIMED — burned $OMR refunded, the
// permanently-stuck reserve capacity freed, optimistically-removed gear restored to play ──
const { reclaimExpiredVouchers } = await import('../src/chain.js');
const driftPreReclaim = await driftOf('$OMR conservation'); // baseline here (an earlier line raw-credits $OMR)
await call('POST', '/v1/mod/reserve/fund', { headers: modH, body: { amount: 1000 } }); // fresh headroom
const omrPreReclaim = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 7 } });
assert.equal(r.body.status, 'signed', 'the withdrawal signs against the fresh reserve');
const expNonce = r.body.nonce;
assert.equal((await meOf(token)).omr, omrPreReclaim - 7, 'the $OMR is burned at request');
assert.equal((await reclaimExpiredVouchers(pool)).omrReclaimed, 0, 'a still-live voucher is NOT reclaimed');
await pool.query(`UPDATE vouchers SET deadline = ${Math.floor(Date.now() / 1000) - 99999} WHERE nonce=${expNonce}`); // past deadline+grace
const availPre = (await call('GET', '/v1/mod/reserve', { headers: modH })).body.available;
// full-system v3 chain F1: WITHOUT an on-chain reader we NEVER blind-refund (the voucher could be
// claimed on a signing-enabled-but-RPC-down box) — the sweep skips and retries; only a reader that
// confirms the nonce is UNUSED lets the refund proceed.
const noReader = await reclaimExpiredVouchers(pool);
assert.equal(noReader.omrReclaimed, 0, 'no on-chain reader → the expired voucher is NOT blind-refunded');
assert.equal(noReader.skipped, 1, 'it is skipped for retry, not refunded');
assert.equal((await meOf(token)).omr, omrPreReclaim - 7, 'the $OMR stays burned until the chain confirms it unclaimed');
assert.equal((await reclaimExpiredVouchers(pool, { usedNonce: async () => false })).omrReclaimed, 7, 'a reader confirming the nonce is unclaimed reclaims the expired voucher');
assert.equal((await meOf(token)).omr, omrPreReclaim, 'the burned $OMR is refunded whole');
assert.equal((await pool.query(`SELECT status FROM vouchers WHERE nonce=${expNonce}`)).rows[0].status, 'expired', 'the voucher is marked expired');
assert.equal((await call('GET', '/v1/mod/reserve', { headers: modH })).body.available, availPre + 7, 'the stuck reserve capacity is freed');
assert.equal(await driftOf('$OMR conservation'), driftPreReclaim, 'the refund reverses the burn — §10.4 $OMR conservation unmoved');
await call('POST', '/v1/mod/reserve/claimed', { body: { nonce: expNonce }, headers: modH }); // a late Claimed event
assert.equal((await pool.query(`SELECT status FROM vouchers WHERE nonce=${expNonce}`)).rows[0].status, 'expired', 'a stale Claimed event cannot un-expire a reclaimed voucher');
await pool.query(`UPDATE vouchers SET deadline = ${Math.floor(Date.now() / 1000) - 99999} WHERE kind='gear' AND status='signed'`);
assert.equal((await reclaimExpiredVouchers(pool, { usedNonce: async () => false })).gearRestored, 1, 'the expired gear voucher restores (reader confirms unclaimed)');
assert.equal((await pool.query(`SELECT minted_onchain FROM account_gear WHERE gear_id='knuckles'`)).rows[0].minted_onchain, false, 'the gear is back in play — not lost to a failed claim');

// ══ AUDIT (chain on-chain audit) regressions ══
// CRITICAL — reclaim-vs-claim double-spend: a voucher whose nonce is USED on-chain (the watcher just
// missed the event) must NEVER be refunded — reclaim asks the chain directly and records the claim.
await call('POST', '/v1/mod/reserve/fund', { headers: modH, body: { amount: 1000 } });
const omrPreRace = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 9 } });
const raceNonce = r.body.nonce;
assert.equal((await meOf(token)).omr, omrPreRace - 9, '$OMR burned at request');
await pool.query(`UPDATE vouchers SET deadline = ${Math.floor(Date.now() / 1000) - 99999} WHERE nonce=${raceNonce}`);
// inject a chain reader that reports this nonce as CLAIMED on-chain (the watcher was down past the grace)
const claimedReader = { usedNonce: async (n) => Number(n) === Number(raceNonce) };
const raceRes = await reclaimExpiredVouchers(pool, claimedReader);
assert.equal(raceRes.omrReclaimed, 0, 'a voucher already CLAIMED on-chain is NOT refunded — no double-spend');
assert.equal(raceRes.reconciled, 1, 'the watcher-missed claim is reconciled instead');
assert.equal((await meOf(token)).omr, omrPreRace - 9, 'the $OMR stays burned — the player got the tokens on-chain');
assert.equal((await pool.query(`SELECT status, claimed_onchain FROM vouchers WHERE nonce=${raceNonce}`)).rows[0].status, 'claimed', 'the voucher is recorded claimed, not expired');
// and a reader reporting NOT-claimed still refunds normally (the legitimate expiry)
await call('POST', '/v1/mod/reserve/fund', { headers: modH, body: { amount: 1000 } });
const omrPreLegit = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 4 } });
const legitNonce = r.body.nonce;
await pool.query(`UPDATE vouchers SET deadline = ${Math.floor(Date.now() / 1000) - 99999} WHERE nonce=${legitNonce}`);
assert.equal((await reclaimExpiredVouchers(pool, { usedNonce: async () => false })).omrReclaimed, 4, 'an unclaimed expired voucher still refunds');
assert.equal((await meOf(token)).omr, omrPreLegit, 'the burned $OMR came back');

// MED — chainConfig fails CLOSED: no chainId / verifyingContract → throw, never sign a wrong domain
const savedChainId = process.env.CHAIN_ID;
delete process.env.CHAIN_ID;
assert.throws(() => chainConfig(), /chain_unconfigured|missing/i, 'chainConfig throws when unconfigured (never signs a testnet-default domain)');
process.env.CHAIN_ID = savedChainId;
assert.ok(chainConfig().chainId === 46630, 'chainConfig works again with the env restored');

// LOW — gearNumId is APPEND-ONLY: the on-chain ERC-1155 tokenId is a gear's 1-based MARKET position,
// and the Safe keys gearSupplyCap[n]/gearMinted[n] by that number. A MARKET reorder/insert would
// silently re-point every cap AND change the tokenId of gear players already hold. Pin the known
// head so any reorder breaks CI loudly (a re-extract must only APPEND).
const { gearNumId } = await import('../src/chain.js');
// AUDIT-full-system-v2 D-MED3: pin the head AND the current tail — a mid-list insert anywhere before the
// last class shifts the tail, so pinning `supledger`==51 catches an insertion the head pins would miss
// (a head-only pin only guards inserts before position 4). An append (a new class AFTER supledger) keeps
// every pin valid — the only safe way to grow the catalog.
for (const [id, n] of [['brasspin', 1], ['newscap', 2], ['knuckles', 3], ['dice', 4], ['supledger', 51]])
  assert.equal(gearNumId(id), n, `gear tokenId is stable + append-only: ${id} == ${n}`);

// MED — daily-cap guard: a single withdrawal over the on-chain cap is refused BEFORE any burn
process.env.DAILY_CAP_OMR = String(50n * 10n ** 18n); // 50 $OMR cap
const omrPreCap = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 51 } });
assert.equal(r.body.error, 'daily_cap', 'a withdrawal exceeding the daily cap is refused');
assert.equal((await meOf(token)).omr, omrPreCap, 'no $OMR was burned on the rejected over-cap request');
delete process.env.DAILY_CAP_OMR;

// ══ THE RESERVE BOND — the EIP-712 quote signer (the piece OmertaBond.bond() accepts) ══
// The `token`/`player` account already linked player.address (SIWE) above. Seed a live oracle price and
// fund the bond tranche, then sign a quote and prove PARITY (the on-chain OmertaBond recovers our signer).
{
  const { BONDS } = await import('../src/rules.js');
  await pool.query(
    "INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize) VALUES ('bb-bondtest', 1, 2000, 2000, 0, 0)");
  await call('POST', '/v1/mod/bond/fund', { headers: modH, body: { omr: 100000 } });

  // a fresh, wallet-LESS guest can't quote — a bond quote is bound to the payer wallet
  const { body: { token: noWallet } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: noWallet, body: { name: 'No Wallet Nick' } });
  assert.equal((await call('POST', '/v1/bond/quote', { token: noWallet, body: { principalEth: 1 } })).body.error, 'wallet', 'no linked wallet → no bond quote');

  // below the floor is refused
  assert.equal((await call('POST', '/v1/bond/quote', { token, body: { principalEth: 0.001 } })).body.error, 'min', 'sub-minimum principal refused');

  // sign a real quote for 1 ETH
  const q = await call('POST', '/v1/bond/quote', { token, body: { principalEth: 1 } });
  assert.equal(q.code, 200, 'quote signed');
  const expectedPayout = Math.round((1 * 2000 / (1 - 800 / 10000)) * 1e6) / 1e6; // bondPayout(1, 2000, 800)
  assert.equal(q.body.payoutOmr, expectedPayout, 'payout = principal × price / (1 − discount)');
  assert.equal(q.body.discountBps, BONDS.DISCOUNT_BPS, 'quotes at the offering discount');
  assert.equal(q.body.contract.toLowerCase(), process.env.OMERTA_BOND_ADDRESS, 'the verifyingContract is OmertaBond');

  // PARITY: the on-chain OmertaBond will recover exactly our server signer from this quote+sig
  const qm = q.body.quote;
  const bondMsg = { payer: qm.payer, principal: BigInt(qm.principal), priceOmrPerEth: BigInt(qm.priceOmrPerEth),
    discountBps: BigInt(qm.discountBps), vestSeconds: BigInt(qm.vestSeconds), nonce: BigInt(qm.nonce), deadline: BigInt(qm.deadline) };
  const bondRecovered = await recoverTypedDataAddress({ domain: bondChainConfig(), types: BOND_QUOTE_TYPES,
    primaryType: 'BondQuote', message: bondMsg, signature: q.body.signature });
  assert.equal(bondRecovered.toLowerCase(), signerAddr.toLowerCase(), 'the bond quote recovers to the server signer — OmertaBond.bond() will accept it');
  assert.equal(qm.payer.toLowerCase(), player.address.toLowerCase(), 'the quote is bound to the linked wallet');
  assert.equal(BigInt(qm.principal), parseUnits('1', 18), 'principal is 1 ETH in wei');
  assert.equal(BigInt(qm.priceOmrPerEth), parseUnits('2000', 18), 'priceOmrPerEth is OMR-wei per 1 ETH');
  const bondNonce = Number(qm.nonce);

  // the wallet-submit calldata: the server ABI-encodes bond(quote, sig) so an injected browser wallet
  // (MetaMask / Robinhood Wallet / …) can eth_sendTransaction it — the zero-dep client never hand-rolls ABI.
  const { decodeFunctionData } = await import('viem');
  const BOND_ABI = [{ type: 'function', name: 'bond', stateMutability: 'payable', inputs: [
    { name: 'q', type: 'tuple', components: [{ name: 'payer', type: 'address' }, { name: 'principal', type: 'uint256' },
      { name: 'priceOmrPerEth', type: 'uint256' }, { name: 'discountBps', type: 'uint256' }, { name: 'vestSeconds', type: 'uint256' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, { name: 'sig', type: 'bytes' }], outputs: [{ type: 'uint256' }] }];
  const cd = await call('POST', '/v1/bond/calldata', { token, body: { nonce: bondNonce } });
  assert.equal(cd.code, 200, 'calldata encoded');
  assert.equal(cd.body.to.toLowerCase(), process.env.OMERTA_BOND_ADDRESS, 'the tx targets the OmertaBond contract');
  assert.equal(BigInt(cd.body.value), parseUnits('1', 18), 'the tx value is the principal in wei');
  assert.equal(cd.body.chainIdHex, '0x' + (46630).toString(16), 'the wallet is told which chain to switch to');
  const decoded = decodeFunctionData({ abi: BOND_ABI, data: cd.body.data });
  assert.equal(decoded.functionName, 'bond', 'the calldata is a bond() call');
  assert.equal(decoded.args[0].nonce, BigInt(bondNonce), 'the encoded quote carries the right nonce');
  assert.equal(decoded.args[0].payer.toLowerCase(), player.address.toLowerCase(), 'the encoded quote is bound to the wallet');
  assert.equal(decoded.args[1], q.body.signature, 'the encoded sig is the server-signed quote signature');
  assert.equal((await call('POST', '/v1/bond/calldata', { token: noWallet, body: { nonce: bondNonce } })).body.error, 'no_quote', "another account can't fetch your quote's calldata");

  // the Bonded watcher enriches the record from the persisted quote: the event omits price/discount, so
  // recordBond recovers the TRUE terms (2000 / 800 bps) — NOT the effective payout/eth rate (≈2173.9) or disc 0.
  const rb = await recordBond(pool, { nonce: bondNonce, payer: player.address, principalEth: 1,
    onchainPayout: expectedPayout, onchainPol: 0.6, onchainVig: 0.4, txHash: '0xbondtx' });
  assert.equal(rb.recorded, true, 'the Bonded event books the bond');
  const bondRow = (await pool.query('SELECT oracle_price, discount_bps, payout_omr FROM bonds WHERE nonce=$1', [bondNonce])).rows[0];
  assert.equal(Number(bondRow.oracle_price), 2000, 'oracle_price recovered from the quote (not the effective rate)');
  assert.equal(Number(bondRow.discount_bps), 800, 'discount recovered from the quote (not 0)');
  assert.equal(Number(bondRow.payout_omr), expectedPayout, 'payout is the on-chain-authoritative amount');
  assert.equal((await pool.query('SELECT status FROM bond_quotes WHERE nonce=$1', [bondNonce])).rows[0].status, 'bonded', 'the quote is marked consumed');

  // bondChainConfig fails CLOSED without the bond address (never signs a wrong domain)
  const savedBond = process.env.OMERTA_BOND_ADDRESS;
  delete process.env.OMERTA_BOND_ADDRESS;
  assert.throws(() => bondChainConfig(), /chain_unconfigured|missing/i, 'bondChainConfig throws when the bond chain is unconfigured');
  process.env.OMERTA_BOND_ADDRESS = savedBond;

  // WalletConnect (mobile) config surface: /v1/rules exposes the public projectId when set, else null (dormant)
  assert.equal((await call('GET', '/v1/rules')).body.walletConnect, null, 'WalletConnect is dormant (null) without WALLETCONNECT_PROJECT_ID');
  process.env.WALLETCONNECT_PROJECT_ID = 'wc-test-project-id';
  const wc = (await call('GET', '/v1/rules')).body.walletConnect;
  assert.equal(wc?.projectId, 'wc-test-project-id', 'the public WalletConnect project id is surfaced when configured');
  assert.equal(wc?.chainId, 46630, 'the WalletConnect chain to request matches CHAIN_ID');
  delete process.env.WALLETCONNECT_PROJECT_ID;
}


// ── THE EXIT TOLL (founder-directed): a withdrawal pays a tax that splits DEV revenue + the
// buyback/yield pool. Gross debited, NET signed, both toll shares ledgered transfers (tax:dev →
// dev_fund, tax:buyback → stake_pool), §10.4 conservation unmoved, and the mod claim moves the
// dev fund to an account without minting. Rate is read per-call, so re-arming the env here works. ──
{
  process.env.WITHDRAW_TAX_BPS = '200'; // 2%
  const omr0 = (await meOf(token)).omr;
  const pool0 = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
  const d0 = await driftOf('$OMR conservation');
  const r = await call('POST', '/v1/withdraw', { token, body: { amount: 10 } });
  assert.equal(r.code, 200, 'tolled withdrawal accepted');
  assert.equal(r.body.gross, 10, 'gross is what the player paid');
  assert.equal(r.body.tax, 0.2, 'the 2% toll');
  assert.equal(r.body.net, 9.8, 'the voucher carries the NET');
  assert.equal((await meOf(token)).omr, omr0 - 10, 'the account was debited the gross');
  const dev = (await pool.query('SELECT omr FROM dev_fund WHERE id=1')).rows[0];
  assert.equal(Number(dev.omr), 0.1, 'half the toll landed in the dev fund');
  const pool1 = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
  assert.equal(Math.round((pool1 - pool0) * 1e6) / 1e6, 0.1, 'half the toll landed in the buyback/yield pool');
  assert.equal(await driftOf('$OMR conservation'), d0, 'the toll is transfers + a net burn — conservation unmoved');
  // the founder claims the dev fund to an account (a bucket transfer, never a mint)
  const acctId = (await pool.query('SELECT account_id FROM account_persistent LIMIT 1')).rows[0].account_id;
  const claim = await call('POST', '/v1/mod/dev/claim', { headers: modH, body: { accountId: acctId } });
  assert.equal(claim.body.claimed, 0.1, 'the dev fund claims to an account');
  assert.equal(Number((await pool.query('SELECT omr FROM dev_fund WHERE id=1')).rows[0].omr), 0, 'the fund empties');
  assert.equal(await driftOf('$OMR conservation'), d0, 'the claim is a transfer — conservation unmoved');
  process.env.WITHDRAW_TAX_BPS = '0';
}

console.log('✅ M6-B chain test passed — SIWE wallet link, EIP-712 voucher signing parity (recovers the signer), full-reserve withdrawal queue (debit→queue→fund→drain→sign), $OMR ledger conservation, gear-mint vouchers, Claimed reserve release, expired-voucher reclaim (OMR refund + reserve free + gear restore, §10.4 exact), §11 mint-gate + fee reconcile + concurrent-credit safety, bond-quote signing parity (recovers the signer) + watcher enrichment + wallet-submit calldata (server-encoded bond() for MetaMask/Robinhood Wallet), and THE EXIT TOLL (gross debit → net voucher, tax:dev/tax:buyback transfers, dev-fund claim, conservation exact)');
await app.close();
