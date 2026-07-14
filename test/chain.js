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
process.env.CHAIN_ID = '46630';
process.env.MOD_KEY = 'test-mod-key';

const { buildServer } = await import('../src/server.js');
const { chainConfig, VOUCHER_TYPES } = await import('../src/chain.js');
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

// ── full-reserve queue ──
// funded reserve starts at 0 → the first withdrawal QUEUES (debited in-game, unsigned)
const omrBefore = (await meOf(token)).omr;
r = await call('POST', '/v1/withdraw', { token, body: { amount: 10 } });
assert.equal(r.code, 200, 'withdraw accepted'); assert.equal(r.body.status, 'queued', 'queued when reserve is dry');
assert(!r.body.signature, 'no signature while queued');
assert.equal((await meOf(token)).omr, omrBefore - 10, '$OMR debited immediately (no double-spend while queued)');
const nonceA = r.body.nonce;

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
assert.equal(afterClaim, beforeClaim - 10, 'a claimed voucher stops counting against the reserve');

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

console.log('✅ M6-B chain test passed — SIWE wallet link, EIP-712 voucher signing parity (recovers the signer), full-reserve withdrawal queue (debit→queue→fund→drain→sign), $OMR ledger conservation, gear-mint vouchers, Claimed reserve release, §11 mint-gate + fee reconcile');
await app.close();
