// THE CIRCLE — the ambient stream of the people you know (crew / mentor / protégés / spouse).
//
// Two halves, both PURE READS: RIGHT NOW (a live snapshot of each circle member — name/level/district +
// online + trouble flags) and LATELY (recent kills involving the circle, derived from kill_log). The
// centre of the test: the circle resolves the right people (and not strangers), the online set drives the
// chip, trouble surfaces, the blood feed frames around the circle member, NO account UUID ever leaks, and
// the whole thing moves no value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { circleBoard } from '../src/circle.js';

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

const me = await mk('Boss');        const meA = await acctOf(me.id);
const mate = await mk('Crew Mate'); const mateA = await acctOf(mate.id);
const ment = await mk('The Vet');   const mentA = await acctOf(ment.id);
const stranger = await mk('Nobody'); const strA = await acctOf(stranger.id);

// build the circle by seeding the relationship rows (pure status — no §10.4 surface): a crew mate + a mentor
await pool.query("INSERT INTO crew_members (crew_id, account_id, name) VALUES ('crew-x',$1,'Boss'),('crew-x',$2,'Crew Mate')", [meA, mateA]);
await pool.query('INSERT INTO mentorships (protege_account, mentor_account) VALUES ($1,$2)', [meA, mentA]);

const meCh = (await pool.query('SELECT * FROM characters WHERE id=$1', [me.id])).rows[0];
const strCh = (await pool.query('SELECT * FROM characters WHERE id=$1', [stranger.id])).rows[0];
const client = await pool.connect();
const tx0 = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
try {
  // ════════════ RIGHT NOW — the right people, and not strangers ════════════
  let b = await circleBoard(client, meCh, []);
  assert.deepEqual(b.people.map((p) => p.name).sort(), ['Crew Mate', 'The Vet'], 'the circle is my crew mate + my mentor');
  assert.equal(b.people.find((p) => p.name === 'Crew Mate').relation, 'crew', 'the crew mate is labeled crew');
  assert.equal(b.people.find((p) => p.name === 'The Vet').relation, 'mentor', 'the mentor is labeled mentor');
  assert.equal(b.people.some((p) => p.name === 'Nobody'), false, 'a stranger is not in the circle');
  assert.equal(b.people.every((p) => !p.online), true, 'nobody is online (empty set)');

  // ════════════ no account UUID ever leaks ════════════
  const blob = JSON.stringify(b);
  assert.equal(blob.includes(meA) || blob.includes(mateA) || blob.includes(mentA), false, 'no account UUID in the board — keyed by the living character');

  // ════════════ the online set drives the chip ════════════
  b = await circleBoard(client, meCh, [mateA]);
  assert.equal(b.people.find((p) => p.name === 'Crew Mate').online, true, 'a connected member reads online');
  assert.equal(b.people.find((p) => p.name === 'The Vet').online, false, 'and one who is not, does not');

  // ════════════ trouble surfaces (the vet gets jailed) ════════════
  await pool.query("UPDATE characters SET jail_until=now()+interval '1 hour' WHERE id=$1", [ment.id]);
  b = await circleBoard(client, meCh, []);
  assert.equal(b.people.find((p) => p.name === 'The Vet').jailed, true, 'a jailed circle member shows in trouble');

  // ════════════ LATELY — the crew mate whacks someone → the blood feed ════════════
  await pool.query("INSERT INTO kill_log (id, killer_account, victim_account, victim_name, at) VALUES ('kl-1',$1,$2,'Some Rat', now())", [mateA, strA]);
  b = await circleBoard(client, meCh, []);
  assert.ok(b.feed.length >= 1, 'the kill surfaces in the circle feed');
  const f = b.feed.find((x) => x.kind === 'whacked');
  assert.ok(f, 'a circle member doing the killing surfaces');
  assert.equal(f.who, 'Crew Mate', 'framed around the circle member who did it');
  assert.equal(f.other, 'Some Rat', 'and names the victim');

  // ════════════ a circle member FALLING surfaces too (victim side) ════════════
  await pool.query("INSERT INTO kill_log (id, killer_account, victim_account, victim_name, at) VALUES ('kl-2',$1,$2,'The Vet', now()+interval '1 second')", [strA, mentA]);
  b = await circleBoard(client, meCh, []);
  const fell = b.feed.find((x) => x.kind === 'fell');
  assert.ok(fell, 'a circle member falling surfaces');
  assert.equal(fell.who, 'The Vet', 'framed around the fallen circle member');

  // ════════════ a player with no circle → an honest empty board ════════════
  const eb = await circleBoard(client, strCh, []);
  assert.equal(eb.empty, true, 'no crew, no mentor, no spouse → an honest empty circle');
  assert.equal(eb.people.length, 0, 'and no people');
} finally { client.release(); }

// ════════════ §10.4 — the circle moves no value ════════════
assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), tx0, 'reading the circle writes no ledger rows — it is a pure read');

console.log('circle: PASS');
await app.close();
process.exit(0);
