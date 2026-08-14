// NFT RE-IMPORT (Option A, omerta-nft-reimport-design.md) — the inverse of extraction: a GearVault
// Redeemed(from, tokenId, amount) burn re-created as a LIVE in-game car/boat row on the burner's living
// character. Runs on pg-mem: reimportItem/sweepReimports are the watcher's unit-testable core (the real
// getLogs sync needs an RPC), exactly as test/chain.js exercises markClaimed directly.
//
// The properties under test:
//   • the tokenId DECODE round-trips nftTokenId, and gear/out-of-range is rejected (the contract's redeem
//     is car/boat-only — its in-game form is set membership, the assets deferral reason);
//   • a burn from a wallet with a LIVING character re-creates a fresh STOCK instance, live in-game;
//   • §10.4-NEUTRAL — a car/boat is ownership (conserved by ROW COUNT), never a currency, so the whole
//     flow writes ZERO ledger rows;
//   • idempotency on the log ref (a re-delivered log is a clean no-op);
//   • PENDING → APPLIED — a burn from a wallet with no living character WAITS, and the worker sweep
//     brings it back once a living street exists.
import assert from 'node:assert';
import { privateKeyToAccount } from 'viem/accounts';

process.env.VOUCHER_SIGNER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.CHAIN_ID = '46630';

const { buildServer } = await import('../src/server.js');
const { reimportItem, sweepReimports } = await import('../src/chain.js');
const { nftTokenId, nftDecode, CARS, PORT, RARITY } = await import('../src/rules.js');

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body, headers } = {}) => {
  const res = await app.inject({ method, url, payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) } });
  let json; try { json = res.json(); } catch { json = null; }
  return { code: res.statusCode, body: json };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const txCount = async () => Number((await pool.query('SELECT COUNT(*) c FROM transactions')).rows[0].c);
const carCount = async (cid, model, rarity) => Number((await pool.query(
  'SELECT COUNT(*) c FROM cars WHERE character_id=$1 AND model_id=$2 AND rarity=$3 AND NOT minted_onchain', [cid, model, rarity])).rows[0].c);

// well-known anvil accounts — two distinct burner wallets
const walletA = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const walletB = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

// create a guest + character, link the given wallet via SIWE, return { token, cid, accountId }
async function makeMember(name, wallet) {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const cid = (await meOf(token)).id;
  const accountId = (await pool.query("SELECT account_id FROM characters WHERE id=$1", [cid])).rows[0].account_id;
  const ch = await call('POST', '/v1/wallet/challenge', { token });
  const sig = await wallet.signMessage({ message: ch.body.message });
  const v = await call('POST', '/v1/wallet/verify', { token, body: { address: wallet.address, signature: sig } });
  assert.equal(v.code, 200, `${name}: wallet linked`);
  return { token, cid, accountId };
}

const CAR = CARS[0], BOAT = PORT.BOATS[0];
const carRar = RARITY.TIERS[2].id;  // 'legendary'
const boatRar = RARITY.TIERS[1].id; // 'rare'
const carToken = nftTokenId('car', CAR.id, carRar);
const boatToken = nftTokenId('boat', BOAT.id, boatRar);

// ── 1. the decode is the exact inverse of nftTokenId, and gear/out-of-range is rejected ──
assert.deepEqual(nftDecode(carToken), { kind: 'car', catalogId: CAR.id, rarity: carRar }, 'car token decodes');
assert.deepEqual(nftDecode(boatToken), { kind: 'boat', catalogId: BOAT.id, rarity: boatRar }, 'boat token decodes');
assert.throws(() => nftDecode(7), /not a re-importable/, 'a gear token (< CAR_BASE) is NOT re-importable');
assert.throws(() => nftDecode(999999999), /no (car|boat)/, 'an out-of-range token throws (fail-closed)');

// ── 2. happy path: a burn from a wallet with a living character re-creates a fresh STOCK instance ──
const A = await makeMember('Cash Out Carl', walletA);
const before = await txCount();
const r1 = await reimportItem(pool, { ref: '0xaaa:0', from: walletA.address, tokenId: carToken, amount: 1 });
assert.equal(r1.applied, true, 're-import applied to the living character');
assert.equal(r1.character, A.cid, 'attached to the burner\'s living street');
assert.equal(await carCount(A.cid, CAR.id, carRar), 1, 'exactly one live re-imported car');
const car = (await pool.query('SELECT * FROM cars WHERE character_id=$1 AND model_id=$2 AND rarity=$3', [A.cid, CAR.id, carRar])).rows[0];
assert.equal(car.trim_id, 'stock', 'a re-imported car is a clean STOCK instance (trim not encoded in the tokenId)');
assert.equal(Number(car.dmg), 0, 'undamaged');
assert.equal(car.minted_onchain, false, 'live in-game (not on-chain)');
assert.equal(await txCount() - before, 0, '§10.4-NEUTRAL: the whole flow writes ZERO ledger rows (a car is ownership, not currency)');
// and the re-imported car is LIVE in the fleet (loadOwned no longer filters it — minted_onchain=false)
const fleet = (await meOf(A.token)).cars || [];
assert(fleet.some((c) => c.id === car.id), 'the re-imported car shows up live in the fleet');

// ── 3. idempotency: a re-delivered log (restart / overlapping re-scan) is a clean no-op ──
const r2 = await reimportItem(pool, { ref: '0xaaa:0', from: walletA.address, tokenId: carToken, amount: 1 });
assert.equal(r2.duplicate, true, 'same log ref is a no-op');
assert.equal(await carCount(A.cid, CAR.id, carRar), 1, 'still exactly one car — no double re-import');

// ── 4. a gear/undecodable token is skipped WITHOUT throwing, and records nothing ──
const rGear = await reimportItem(pool, { ref: '0xbad:0', from: walletA.address, tokenId: 7, amount: 1 });
assert.equal(rGear.skipped, true, 'a gear token is skipped (the contract rejects it; the watcher is defensive)');
assert.equal(Number((await pool.query("SELECT COUNT(*) c FROM nft_reimports WHERE id='0xbad:0'")).rows[0].c), 0, 'no record for an undecodable token');

// ── 5. PENDING → APPLIED: a burn from a wallet with no living character WAITS, then the sweep applies it ──
const boatsBefore = Number((await pool.query('SELECT COUNT(*) c FROM boats')).rows[0].c);
const r3 = await reimportItem(pool, { ref: '0xbbb:0', from: walletB.address, tokenId: boatToken, amount: 1 });
assert.equal(r3.pending, true, 'no account for this wallet yet — the re-import waits');
assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM boats')).rows[0].c), boatsBefore, 'nothing created while pending');
assert.equal((await pool.query("SELECT status FROM nft_reimports WHERE id='0xbbb:0'")).rows[0].status, 'pending', 'recorded as pending');

// now walletB gets an account with a living street; the worker sweep brings the boat back
const B = await makeMember('Late Linker Lou', walletB);
const beforeSweep = await txCount();
const sw = await sweepReimports(pool);
assert.equal(sw.applied, 1, 'the sweep applies the one pending re-import once a living street exists');
const boat = (await pool.query('SELECT * FROM boats WHERE character_id=$1 AND kind=$2 AND rarity=$3 AND NOT minted_onchain', [B.cid, BOAT.id, boatRar])).rows;
assert.equal(boat.length, 1, 'one live re-imported boat on B');
assert.equal((await pool.query("SELECT status, applied_character FROM nft_reimports WHERE id='0xbbb:0'")).rows[0].applied_character, B.cid, 'record marked applied to B');
assert.equal(await txCount() - beforeSweep, 0, '§10.4-neutral through the sweep too');
// sweeping again applies nothing (already applied — the FOR UPDATE re-check)
assert.equal((await sweepReimports(pool)).applied, 0, 'no re-apply of an already-applied re-import');

console.log('reimport.js OK');
await app.close?.();
process.exit(0);
