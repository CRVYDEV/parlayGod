// THE VOUCH (the symmetric peer bond) — you stake your name on someone (scarce, capped); if they vouch
// back it's mutual. PURE STATUS, §10.4-free (no ledger, no currency). ACCOUNT-keyed → survives death.
// This suite proves: the give/pull lifecycle + every gate (self/gone/not_human/already/maxed), the MUTUAL
// detection + notification, the board (given/received/mutuals/vouchedBy/rank/slots), the per-card counts,
// the leaderboard (agents + residents excluded), survives-death (a vouch you earned stands after your
// street falls), and §10.4-neutrality (the whole flow writes ZERO transactions rows).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { VOUCH } from '../src/rules.js';
import * as Vouch from '../src/vouch.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id, acct: (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [ch.id])).rows[0].a };
};
const notesFor = async (id, type) => (await pool.query(
  "SELECT payload FROM notifications WHERE character_id=$1 AND type=$2", [id, type]))
  .rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

const a = await mk('Vito'), b = await mk('Sonny'), c = await mk('Clemenza');
const txBefore = await txCount();

// ════════════ GATES ════════════
assert.equal((await call('POST', `/v1/vouch/${a.id}`, { token: a.token })).body.error, 'self', "you can't vouch for yourself");
assert.equal((await call('POST', '/v1/vouch/nope', { token: a.token })).body.error, 'gone', 'a missing target is refused');

// ════════════ GIVE — A vouches B ════════════
const g1 = await call('POST', `/v1/vouch/${b.id}`, { token: a.token });
assert.equal(g1.code, 200, 'the vouch lands');
assert.equal(g1.body.vouched, 'Sonny', 'the response names who you vouched');
assert.equal(g1.body.mutual, false, 'not mutual yet — B hasn\'t vouched back');
assert.equal((await call('POST', `/v1/vouch/${b.id}`, { token: a.token })).body.error, 'already', 'one vouch per pair');
// B was notified
const bNote = await notesFor(b.id, 'vouched');
assert.equal(bNote.length, 1, 'B got a "someone vouched for you" notification');
assert.equal(bNote[0].by, 'Vito', 'the notification names the voucher');

// ════════════ THE BOARD — A's reputation + given list ════════════
const aBoard = (await call('GET', '/v1/vouches', { token: a.token })).body;
assert.equal(aBoard.slotsLeft, VOUCH.MAX_OUT - 1, 'a vouch spent one of A\'s slots');
assert.equal(aBoard.given.length, 1, 'A vouches one person');
assert.equal(aBoard.given[0].name, 'Sonny', 'the given list names B');
assert.equal(aBoard.given[0].mutual, false, 'not mutual yet');
const bBoard = (await call('GET', '/v1/vouches', { token: b.token })).body;
assert.equal(bBoard.vouchedBy, 1, 'B is vouched for by one player');
assert.equal(bBoard.rank, 'Vouched For', 'B\'s reputation rank reflects the inbound vouch');
assert.equal(bBoard.vouchers[0].name, 'Vito', 'B sees who vouched for them');

// ════════════ MUTUAL — B vouches A back ════════════
const g2 = await call('POST', `/v1/vouch/${a.id}`, { token: b.token });
assert.equal(g2.body.mutual, true, 'B vouching A back is MUTUAL');
assert.equal((await notesFor(a.id, 'vouch_mutual')).length, 1, 'A got the "vouched you back" mutual notification');
const aBoard2 = (await call('GET', '/v1/vouches', { token: a.token })).body;
assert.equal(aBoard2.mutuals.length, 1, 'A now has one mutual bond');
assert.equal(aBoard2.mutuals[0].name, 'Sonny', 'the mutual is B');
assert.equal(aBoard2.given[0].mutual, true, 'A\'s given entry for B is flagged mutual');

// ════════════ per-card counts (the discovery chip) ════════════
const counts = await Vouch.vouchCounts(pool, [a.id, b.id, c.id]);
assert.equal(counts.get(b.id), 1, 'B carries one vouch on their card');
assert.equal(counts.get(a.id), 1, 'A carries one (from B) on their card');
assert.equal(counts.get(c.id) || 0, 0, 'C, unvouched, carries none');

// ════════════ REVOKE — A pulls their name, freeing a slot ════════════
const pull = await call('DELETE', `/v1/vouch/${b.id}`, { token: a.token });
assert.equal(pull.body.pulled, 'Sonny', 'pulling names who you dropped');
assert.equal((await call('GET', '/v1/vouches', { token: a.token })).body.slotsLeft, VOUCH.MAX_OUT, 'the slot is freed');
assert.equal((await call('DELETE', `/v1/vouch/${b.id}`, { token: a.token })).body.error, 'not_vouched', 'pulling one you don\'t hold is refused');
assert.equal((await call('GET', '/v1/vouches', { token: b.token })).body.vouchedBy, 0, 'B\'s inbound count dropped to zero');

// ════════════ NOT_HUMAN — you can only vouch real players (not a resident) ════════════
const res = await mk('Resident Joe');
await pool.query('UPDATE characters SET is_npc=true WHERE id=$1', [res.id]);
await pool.query('UPDATE account_persistent SET npc_flag=true WHERE account_id=$1', [res.acct]);
assert.equal((await call('POST', `/v1/vouch/${res.id}`, { token: a.token })).body.error, 'not_human', 'a resident can\'t be vouched (status-farm shield)');

// ════════════ MAXED — the outbound cap makes a vouch scarce ════════════
const targets = [];
for (let i = 0; i < VOUCH.MAX_OUT; i++) targets.push(await mk('Made Man ' + i));
for (const t of targets) assert.equal((await call('POST', `/v1/vouch/${t.id}`, { token: a.token })).code, 200, 'A fills their slots');
const extra = await mk('One Too Many');
assert.equal((await call('POST', `/v1/vouch/${extra.id}`, { token: a.token })).body.error, 'maxed', `you can only vouch ${VOUCH.MAX_OUT} people`);

// ════════════ LEADERBOARD — most-vouched, agents + residents excluded ════════════
// give C several vouches from the made men so they top the board
for (let i = 0; i < 3; i++) await call('POST', `/v1/vouch/${c.id}`, { token: targets[i].token });
const lb = (await call('GET', '/v1/leaderboard/vouches', { token: a.token })).body;
assert(lb.length >= 1, 'the leaderboard has entries');
assert.equal(lb[0].name, 'Clemenza', 'the most-vouched player tops the board');
assert.equal(lb[0].vouches, 3, 'with the right count');
assert(!lb.find((v) => v.name === 'Resident Joe'), 'a resident never appears on the trusted board');

// ════════════ SURVIVES DEATH — a vouch you earned stands after your street falls ════════════
// C is vouched by 3; kill C's street. The vouches are ACCOUNT-keyed, so the count survives for the heir.
await pool.query('UPDATE characters SET alive=false WHERE id=$1', [c.id]);
const cAfter = await Vouch.vouchBoard(pool, { account_id: c.acct });
assert.equal(cAfter.vouchedBy, 3, 'C\'s bloodline keeps its reputation after the street dies (account-keyed)');

// ════════════ §10.4 — the whole flow moved no value ════════════
assert.equal(await txCount(), txBefore, 'THE VOUCH writes ZERO ledger rows — it is pure status, never value');

console.log('vouch: PASS');
await app.close();
process.exit(0);
