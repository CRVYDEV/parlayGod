// THE DAY — the returning player's one-glance daily checklist (/v1/day). A §10.4-free consolidation of
// the seven daily surfaces. The centre of the test: the checklist surfaces the right daily items with a
// ready/todo/done state each, the state reflects real progress (claiming the streak flips it to done),
// and the whole read moves no value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return token;
};
const day = async (t) => (await call('GET', '/v1/day', { token: t })).body;
const pool = app.pool;
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);

// ════════════ the checklist — five daily surfaces, each with a state ════════════
const t = await mk('Day Planner');
let b = await day(t);
assert.ok(Array.isArray(b.items) && b.items.length === 5, 'the five daily surfaces are consolidated');
const ids = b.items.map((i) => i.id);
for (const id of ['streak', 'contracts', 'hustle', 'corner', 'drills']) assert.ok(ids.includes(id), `the checklist carries ${id}`);
for (const it of b.items) assert.ok(['ready', 'todo', 'done'].includes(it.state) && it.tab && it.detail, 'each item has a state, a jump tab, and a detail');
assert.equal(b.total, 5, 'the summary counts every item');
// a fresh player has the streak + a corner job READY, and hasn't claimed anything yet
const streak = b.items.find((i) => i.id === 'streak');
assert.equal(streak.state, 'ready', 'a fresh player can claim today\'s streak');
assert.equal(b.done, 0, 'nothing claimed yet');

// ════════════ state reflects progress — claiming the streak flips it to done ════════════
const claimed = await call('POST', '/v1/streak/claim', { token: t });
assert.equal(claimed.body.streak, 1, 'the streak was claimed');
b = await day(t);
assert.equal(b.items.find((i) => i.id === 'streak').state, 'done', 'the checklist reflects the claim — streak now done');
assert.ok(b.done >= 1, 'the done count rose');

// ════════════ §10.4 — reading the day moves NO value ════════════
const txBefore = await txnCount();
const driftBefore = Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'character cash').drift);
await day(t); await day(t);
assert.equal(await txnCount(), txBefore, 'reading the day writes zero transactions rows');
assert.equal(Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'character cash').drift), driftBefore, 'the day board is §10.4-neutral');

console.log('day: THE DAY ok');
await app.close();
process.exit(0);
