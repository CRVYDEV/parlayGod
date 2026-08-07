// STILL ON THE TABLE — the cross-system pull: systems you've UNLOCKED by level and never touched.
//
// The centre of the test: a fresh street at a high level has unlocked many systems and TRIED none of
// them (so they're all "on the table"); engaging one — a single mastery-track XP row, the same signal
// the board reads — drops it from the untapped list and ticks the explorer tally. Pure read: a GET
// moves NO value (no ledger row) — the whole feature is §10.4-free by construction.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SYSTEMS } from '../src/explore.js';
import { levelOf } from '../src/rules.js';

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
const idOf = async (cid) => (await pool.query('SELECT id FROM characters WHERE id=$1', [cid])).rows[0].id;
// respect needed to sit at exactly level L (the levelOf inverse: floor(sqrt(respect/DIV))+1)
const respectForLevel = (L) => { let r = 0; while (levelOf(r) < L) r += 25; return r; };
const board = async (token) => (await call('GET', '/v1/explore', { token })).body;
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);

// ════════════ a fresh street below every gate — nothing unlocked, so nothing on the table ════════════
const rookie = await mk('Fresh Fish');
let b = await board(rookie.token);
assert.equal(b.progress.unlocked, 0, 'a level-1 street has unlocked no systems yet');
assert.deepEqual(b.untapped, [], 'so nothing is on the table');
assert.equal(b.allTried, false, 'and allTried is false when nothing is even unlocked');

// ════════════ level 30 — every system unlocked, none touched: the whole city on the table ════════════
const p = await mk('The Explorer');
await pool.query('UPDATE characters SET respect=$2 WHERE id=$1', [p.id, respectForLevel(30)]);
b = await board(p.token);
const total = SYSTEMS.length;
assert.equal(b.progress.unlocked, total, `at level 30 all ${total} systems are unlocked`);
assert.equal(b.progress.tried, 0, 'a fresh street has tried none of them');
assert.equal(b.progress.remaining, total, 'so all of them are on the table');
assert.equal(b.untapped.length, total, 'the untapped grid carries every one');
assert.equal(b.allTried, false, 'not an all-clear yet');
// the earliest-unlocked system leads (most overdue first)
assert.ok(b.untapped[0].at <= b.untapped[b.untapped.length - 1].at, 'ordered by unlock level, earliest first');
// every entry is well-formed (a hook + a tab to jump to)
for (const s of b.untapped) { assert.ok(s.name && s.hook && s.tab, `entry ${s.id} is well-formed`); }
// the Kitchen (a mastery-tracked system) is on the table for a street that's never cooked
assert.ok(b.untapped.some((s) => s.id === 'kitchen'), 'the Kitchen is on the table before any cook');

// ════════════ engaging a system drops it — the mastery XP the board reads is the signal ════════════
// one row of chemistry XP is exactly what `seen` reads for the Kitchen (via loadOwned's mastery map).
await pool.query('INSERT INTO masteries (character_id, track_id, xp) VALUES ($1,$2,$3)', [await idOf(p.id), 'chemistry', 40]);
b = await board(p.token);
assert.ok(!b.untapped.some((s) => s.id === 'kitchen'), 'the Kitchen leaves the table once you\'ve cooked');
assert.equal(b.progress.tried, 1, 'the explorer tally ticks to 1 tried');
assert.equal(b.progress.remaining, total - 1, 'one fewer on the table');

// ════════════ §10.4 — a GET moves NO value (no ledger row): the feature is pure read ════════════
const before = await txnCount();
await board(p.token);
await board(p.token);
assert.equal(await txnCount(), before, 'reading the board writes zero transactions rows');

console.log('explore: STILL ON THE TABLE ok');
await app.close();
process.exit(0);
