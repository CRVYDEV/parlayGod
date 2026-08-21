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

// ── 1. the decode is the exact inverse of nftTokenId, and an unknown token is rejected ──
assert.deepEqual(nftDecode(carToken), { kind: 'car', catalogId: CAR.id, rarity: carRar }, 'car token decodes');
assert.deepEqual(nftDecode(boatToken), { kind: 'boat', catalogId: BOAT.id, rarity: boatRar }, 'boat token decodes');
// GEAR joined the round trip (§7, 2026-08-21): a gear token resolves through the FROZEN map.
assert.deepEqual(nftDecode(3), { kind: 'gear', catalogId: 'knuckles', rarity: null }, 'a gear token decodes through GEAR_TOKEN_IDS');
assert.throws(() => nftDecode(0), /not re-importable/, 'token 0 is reserved (fail-closed)');
assert.throws(() => nftDecode(99999), /no gear class/, 'an unmapped below-CAR_BASE token throws (fail-closed)');
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

// ── 4. an undecodable token is skipped WITHOUT throwing, and records nothing ──
const rBad = await reimportItem(pool, { ref: '0xbad:0', from: walletA.address, tokenId: 99999, amount: 1 });
assert.equal(rBad.skipped, true, 'an unmapped token is skipped (fail-closed; the watcher is defensive)');
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

// ── 6. GEAR (§7, founder-signed 2026-08-21) — the THREE-CASE rule, account-level ──
// Gear is account-level SET MEMBERSHIP, so a gear burn needs a linked wallet and NOT a living
// character. Wallet C links to a bare guest account (no character ever created) to prove it.
const walletC = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const { body: { token: tokenC } } = await call('POST', '/v1/auth/guest');
const chC = await call('POST', '/v1/wallet/challenge', { token: tokenC });
const sigC = await walletC.signMessage({ message: chC.body.message });
assert.equal((await call('POST', '/v1/wallet/verify', { token: tokenC, body: { address: walletC.address, signature: sigC } })).code, 200, 'C links with NO character');
const acctC = (await pool.query('SELECT account_id FROM account_persistent WHERE lower(wallet_address)=lower($1)', [walletC.address])).rows[0].account_id;

// CASE 1 — no row: the burn lands the class on the ACCOUNT, live (minted_onchain=false), with no
// living character anywhere (a car would WAIT here; gear must not).
const gBefore = await txCount();
const g1 = await reimportItem(pool, { ref: '0xgear:1', from: walletC.address, tokenId: 4, amount: 1 }); // dice
assert.equal(g1.applied, true, 'case 1: a gear burn applies with NO living character (account-level)');
let row = (await pool.query('SELECT minted_onchain FROM account_gear WHERE account_id=$1 AND gear_id=$2', [acctC, 'dice'])).rows[0];
assert.equal(row.minted_onchain, false, 'case 1: the class joined the account, live in-game');
assert.equal((await pool.query("SELECT applied_character FROM nft_reimports WHERE id='0xgear:1'")).rows[0].applied_character, null, 'gear attaches to the ACCOUNT — applied_character stays NULL');

// CASE 2 — the burner's OWN row is extracted: the burn un-flags it (their token came home), never
// a second row (the PK is the membership).
await pool.query('INSERT INTO account_gear (account_id, gear_id, minted_onchain) VALUES ($1,$2,true)', [acctC, 'knuckles']);
const g2 = await reimportItem(pool, { ref: '0xgear:2', from: walletC.address, tokenId: 3, amount: 1 }); // knuckles
assert.equal(g2.applied, true, 'case 2: applied');
row = (await pool.query('SELECT minted_onchain FROM account_gear WHERE account_id=$1 AND gear_id=$2', [acctC, 'knuckles'])).rows[0];
assert.equal(row.minted_onchain, false, 'case 2: the extracted row is un-flagged — the token came home');
assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM account_gear WHERE account_id=$1 AND gear_id=$2', [acctC, 'knuckles'])).rows[0].c), 1, 'case 2: still exactly ONE membership row');

// CASE 3 — the burner already RUNS the in-game copy: the burn WAITS (pending) — it is not lost, and
// the sweep applies it the moment the copy extracts (simulated by flipping the flag).
const g3 = await reimportItem(pool, { ref: '0xgear:3', from: walletC.address, tokenId: 4, amount: 1 }); // dice again
assert.equal(g3.pending, true, 'case 3: an in-game copy held → the burn waits');
assert.equal((await pool.query("SELECT status FROM nft_reimports WHERE id='0xgear:3'")).rows[0].status, 'pending', 'case 3: recorded pending');
assert.equal((await sweepReimports(pool)).applied, 0, 'case 3: the sweep leaves it pending while the copy is held');
await pool.query('UPDATE account_gear SET minted_onchain=true WHERE account_id=$1 AND gear_id=$2', [acctC, 'dice']); // they extract it
assert.equal((await sweepReimports(pool)).applied, 1, 'case 3: the sweep applies the waiting burn once the copy extracts');
row = (await pool.query('SELECT minted_onchain FROM account_gear WHERE account_id=$1 AND gear_id=$2', [acctC, 'dice'])).rows[0];
assert.equal(row.minted_onchain, false, 'case 3: the waiting burn landed — the class is live again');
assert.equal(await txCount() - gBefore, 0, '§10.4-NEUTRAL: the whole gear flow writes ZERO ledger rows (set membership is ownership, not currency)');

// ── 7. the operator's read: pending burns NAME their reason (GET /v1/mod/items/stranded) ──
const { strandedItems } = await import('../src/chain.js');
const walletD = privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a');
await reimportItem(pool, { ref: '0xstr:1', from: walletD.address, tokenId: carToken, amount: 1 }); // unlinked → pending
await pool.query('UPDATE account_gear SET minted_onchain=false WHERE account_id=$1 AND gear_id=$2', [acctC, 'dice']);
await reimportItem(pool, { ref: '0xstr:2', from: walletC.address, tokenId: 4, amount: 1 }); // C holds dice in-game → pending
const strand = await strandedItems(pool);
const s1 = strand.pending.find((p) => p.ref === '0xstr:1');
const s2 = strand.pending.find((p) => p.ref === '0xstr:2');
assert.match(s1.reason, /wallet not linked/, 'an unlinked burner reads WHY it waits');
assert.match(s2.reason, /in-game copy held/, 'a held gear copy reads WHY it waits (and that it self-resolves)');
assert.equal(s2.rarity, null, 'gear surfaces null rarity, never the storage sentinel');

console.log('reimport.js OK');
await app.close?.();
process.exit(0);
