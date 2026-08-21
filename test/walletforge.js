// THE WALLET FORGE (depth B, founder-signed 2026-08-21 — omerta-wallet-forged-stats-design.md §6).
//
// The centre of the test, in order of what would hurt most if it broke:
//   • THE BUDGET LAW — a forged build is EXACTLY CREATE_STAT_TOTAL + bonus, bonus ≤ BONUS_MAX,
//     pinned against the LIVE constants (never literals — a retune must move this test with it).
//   • ONCE PER WALLET, EVER — the wallet_rolls latch holds across ACCOUNTS (wallet-shopping buys
//     nothing), and only the BANDS are stored (no raw feature ever lands on a permanent table).
//   • FAIL-CLOSED — no reader refuses; a throwing reader refuses; neither guesses a history.
//   • §10.4 ZERO — the whole flow writes NOT ONE `transactions` row.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { WALLET_FORGE, walletBands, forgeShape, forgeBonus, CONSTANTS } from '../src/rules.js';
import { __setReader } from '../src/walletforge.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: me.id, name };
};
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const linkWallet = (acct, w) => pool.query('UPDATE account_persistent SET wallet_address=$2 WHERE account_id=$1', [acct, w]);
const driftOf = async (name) => Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === name).drift);
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

// ════════════ the pure half — bands, shape and bonus, driven at their boundaries ════════════
// (these are what the reader's raw features become; everything after only ever sees the bands)
assert.deepEqual(walletBands({ ageDays: 364, txCount: 19 }), { ageTier: 0, velTier: 0 }, 'just under both first tiers');
assert.deepEqual(walletBands({ ageDays: 365, txCount: 20 }), { ageTier: 1, velTier: 1 }, 'both first tiers at the boundary');
assert.deepEqual(walletBands({ ageDays: 1095, txCount: 1000 }), { ageTier: 2, velTier: 3 }, 'both top tiers');
assert.equal(forgeShape({ ageTier: 2, velTier: 3 }), 'wheelman', 'very high velocity wins whatever the age');
assert.equal(forgeShape({ ageTier: 2, velTier: 1 }), 'patient', 'old and quiet is the patient man');
assert.equal(forgeShape({ ageTier: 0, velTier: 2 }), 'workhorse', 'a working wallet is the workhorse');
assert.equal(forgeShape({ ageTier: 1, velTier: 0 }), 'fixer', 'a little history is a fixer');
assert.equal(forgeShape({ ageTier: 0, velTier: 0 }), null, 'a fresh empty wallet earns nothing');
assert.equal(forgeBonus({ ageTier: 2, velTier: 3 }), Math.min(WALLET_FORGE.BONUS_MAX, 3), 'the bonus is hard-capped at BONUS_MAX');
assert.equal(forgeBonus({ ageTier: 1, velTier: 0 }), 1, 'age alone pays its tier');
// THE SHAPE LAW, against the LIVE budget (the load guard enforces it at boot; this pins it here too)
for (const [k, a] of Object.entries(WALLET_FORGE.ARCHETYPES))
  assert.equal(a.muscle + a.cunning + a.speed, CONSTANTS.CREATE_STAT_TOTAL,
    `archetype ${k} sums to the SAME budget every random roll gets — the wallet decides the SHAPE, never the budget`);

// ════════════ gates: no wallet linked, then fail-closed readers ════════════
const A = await mk('Forge Able');
const acctA = await acctOf(A.id);
let r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'wallet', 'no linked wallet → the forge refuses');
const WALLET_A = '0xAAAA00000000000000000000000000000000f001';
await linkWallet(acctA, WALLET_A);
// no reader configured (no CHAIN_RPC_URL in the suite) → fail-closed, never a guessed history
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'chain_unconfigured', 'no reader → the forge refuses (fail-closed)');
__setReader(async () => { throw new Error('rpc down'); });
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'read_failed', 'a throwing reader refuses — it never falls back to a guess');

// ════════════ the forge: an old, worked wallet — deterministic archetype + capped bonus ════════════
const rowsBefore = await ledgerRows();
const cashBefore = await driftOf('character cash');
__setReader(async (w) => {
  assert.equal(w, WALLET_A.toLowerCase(), 'the reader is handed the LOWERCASED wallet');
  return { ageDays: 2000, txCount: 50 }; // ageTier 2, velTier 1 → patient, bonus 2
});
r = (await call('POST', '/v1/character/forge', { token: A.token })).body;
assert.equal(r.forged, 'patient', 'old + quiet forges The Patient Man');
assert.equal(r.name, WALLET_FORGE.ARCHETYPES.patient.name, 'the fictional name rides the reply');
assert.equal(r.bonus, 2, 'ageTier 2, velTier 1 → bonus 2 (age tiers alone)');
assert.equal(r.spentCredit, false, 'at level 1 the forge is free');
// THE BUDGET LAW — pinned against the LIVE constants, never a literal
const total = r.stats.muscle + r.stats.cunning + r.stats.speed;
assert.equal(total, CONSTANTS.CREATE_STAT_TOTAL + r.bonus,
  'a forged build is EXACTLY the base budget + the banded bonus — nothing else');
assert.ok(r.bonus <= WALLET_FORGE.BONUS_MAX, 'the bonus never exceeds BONUS_MAX');
const P = WALLET_FORGE.ARCHETYPES.patient;
assert.equal(r.stats.cunning, P.cunning + r.bonus, 'the bonus lands on the archetype BOOST stat only');
assert.equal(r.stats.muscle, P.muscle, 'the other stats are the shape verbatim');
// the view carries the archetype; the database row matches the reply
const me = (await call('GET', '/v1/me', { token: A.token })).body.character;
assert.equal(me.forged, 'patient', 'the sheet names the archetype');
assert.equal(me.stats.cunning, r.stats.cunning, 'the sheet and the reply agree');
// the latch stores the BANDS and nothing rawer (ground truth is the DATABASE)
const roll = (await pool.query('SELECT * FROM wallet_rolls WHERE wallet=$1', [WALLET_A.toLowerCase()])).rows[0];
assert.ok(roll, 'the wallet_rolls latch exists, keyed on the LOWERCASED wallet');
assert.equal(roll.archetype, 'patient');
assert.equal(Number(roll.age_tier), 2); assert.equal(Number(roll.vel_tier), 1); assert.equal(Number(roll.bonus), 2);
for (const k of Object.keys(roll))
  assert.ok(!/age_days|tx_count|balance|volume/.test(k), `no raw feature column ever lands on the latch (found ${k})`);
// rng_audit: a deterministic archetype records roll 0 + '(deterministic)'
const aud = (await pool.query("SELECT roll, outcome FROM rng_audit WHERE character_id=$1 AND action='wallet_forge'", [A.id])).rows[0];
assert.equal(Number(aud.roll), 0, 'a deterministic forge audits roll 0');
assert.ok(/deterministic/.test(aud.outcome), 'the outcome says so');

// ════════════ once per wallet, EVER — across accounts ════════════
r = await call('POST', '/v1/character/forge', { token: A.token });
assert.equal(r.body.error, 'wallet_spent', 'the same account cannot forge the same wallet twice');
const B = await mk('Forge Baker');
// SIWE enforces wallet uniqueness across accounts, so a wallet MOVES: unlink A, then B links it
// (the realistic wallet-shopping shape — and exactly what the once-EVER latch exists to defeat).
await linkWallet(acctA, null);
await linkWallet(await acctOf(B.id), WALLET_A);
r = await call('POST', '/v1/character/forge', { token: B.token });
assert.equal(r.body.error, 'wallet_spent', 'a SECOND account linking the same wallet gets nothing — one forge per wallet, EVER');

// ════════════ the fresh empty wallet: an honest random roll, zero bonus ════════════
const WALLET_B = '0xBBBB00000000000000000000000000000000f002';
await linkWallet(await acctOf(B.id), WALLET_B);
__setReader(async () => ({ ageDays: 10, txCount: 3 })); // no tier anywhere → unknown
r = (await call('POST', '/v1/character/forge', { token: B.token })).body;
assert.equal(r.forged, 'unknown', 'a fresh empty wallet earns no archetype');
assert.equal(r.bonus, 0, '…and no bonus');
assert.equal(r.stats.muscle + r.stats.cunning + r.stats.speed, CONSTANTS.CREATE_STAT_TOTAL,
  'an unknown wallet rolls the ordinary fixed budget — exactly, no bonus');
const audB = (await pool.query("SELECT roll, outcome FROM rng_audit WHERE character_id=$1 AND action='wallet_forge'", [B.id])).rows[0];
assert.ok(Number(audB.roll) > 0, 'an unknown wallet audits a REAL roll (the build is random)');

// ════════════ the FREE_LVL gate: an established street pays a reroll credit ════════════
const C = await mk('Forge Charlie');
const acctC = await acctOf(C.id);
const WALLET_C = '0xCCCC00000000000000000000000000000000f003';
await linkWallet(acctC, WALLET_C);
// seed respect past FREE_LVL (levelOf = floor(sqrt(r/LEVEL_DIVISOR))+1 — 400 respect is level 7 at divisor 10)
await pool.query('UPDATE characters SET respect=400 WHERE id=$1', [C.id]);
__setReader(async () => ({ ageDays: 400, txCount: 500 })); // ageTier 1, velTier 2 → workhorse, bonus 2
r = await call('POST', '/v1/character/forge', { token: C.token });
assert.equal(r.body.error, 'no_reroll_credit', 'past FREE_LVL the forge takes a paid re-roll credit');
await pool.query('UPDATE account_persistent SET reroll_credits=1 WHERE account_id=$1', [acctC]);
r = (await call('POST', '/v1/character/forge', { token: C.token })).body;
assert.equal(r.forged, 'workhorse', 'a working wallet is the workhorse');
assert.equal(r.spentCredit, true, 'the credit was consumed');
assert.equal(Number((await pool.query('SELECT reroll_credits n FROM account_persistent WHERE account_id=$1', [acctC])).rows[0].n), 0,
  'the paid credit is genuinely gone');

// ════════════ the board — the client's card reads the true terms ════════════
const board = (await call('GET', '/v1/forge', { token: C.token })).body;
assert.equal(board.linked, true);
assert.equal(board.walletForged, true, 'the board says this wallet is spent');
assert.equal(board.forged, 'workhorse', 'the board names the living street\'s archetype');
assert.equal(board.free, false, 'past FREE_LVL the board says it costs a credit');
assert.equal(board.bonusMax, WALLET_FORGE.BONUS_MAX);
assert.ok(board.archetypes.patient.name, 'the archetype catalog rides the board');

// ════════════ a later paid re-roll REPLACES the forge — mark and bonus both ════════════
// (the codex says so, so the code must: a sheet claiming "forged" over a random build is a lie)
await pool.query('UPDATE account_persistent SET reroll_credits=1 WHERE account_id=$1', [acctC]);
r = (await call('POST', '/v1/character/reroll', { token: C.token })).body;
assert.equal(r.rerolled, true, 'the re-roll went through');
const after = (await call('GET', '/v1/me', { token: C.token })).body.character;
assert.equal(after.forged, null, 'a re-roll clears the forged mark — the sheet cannot claim a forge it replaced');
assert.equal(after.statTotal, CONSTANTS.CREATE_STAT_TOTAL, 'the bonus went with it — back to the ordinary budget');

// ════════════ §10.4 — the whole flow moved NO value ════════════
assert.equal(await ledgerRows(), rowsBefore, 'three forges + every refusal wrote NOT ONE transactions row');
assert.equal(await driftOf('character cash'), cashBefore, 'the cash identity is untouched');

console.log('walletforge: PASS — the budget law, the once-per-wallet latch, banded storage, fail-closed readers, the credit gate, §10.4 zero');
await app.close();
process.exit(0);
