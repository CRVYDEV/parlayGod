// THE CREW (omerta-crew-design.md) — the lightweight 2-4 player mutual-aid pact.
//
// Status + coordination only: the whole drop writes NO ledger rows (there is no `crew:` vocabulary),
// so the centre of this file is the lifecycle + the breakable non-aggression + a zero-§10.4 proof.
// Covers: create + its gates, invite/accept/decline, the board's REACH, the member cap, leader
// succession + kick, the CREW ROOM chat, the non-aggression gate (a crewmate can't be jumped) with the
// rat/leave exceptions, and that the whole flow moves no value.
process.env.SEARCH_MS = '0';
process.env.SHOOT_CD_MS = '0';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepCrewInvites } from '../src/crew.js';
import { CREW } from '../src/rules.js';

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
const invite = (from, target) => call('POST', '/v1/crew/invite', { token: from.token, body: { name: target.name } });
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const seed = async (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const one = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the ${name} check exists`);
  return Number(c.drift);
};
// a fighter kit so a jump reaches the crew gate (health/energy/ammo, same street)
const kit = (id) => seed(id, "respect=5000, health=100, energy=100, ammo=50, loc='docks', hosp_until=NULL, jail_until=NULL, safe_until=NULL");

// ════════════ A · LIFECYCLE ════════════
const boss = await mk('Big Sal');
const tony = await mk('Tony Two');
const vito = await mk('Vito Rags');
const nick = await mk('Nicky Cuts');
const rookie = await mk('Fresh Meat');   // stays level 1 for the level gate
for (const c of [boss, tony, vito, nick]) await kit(c.id);

// the level gate — a fresh street can't start a crew
assert.equal((await call('POST', '/v1/crew', { token: rookie.token, body: { name: 'The Nobodies' } })).body.error, 'level',
  `level ${CREW.MIN_LEVEL} to start a crew`);
// name bounds
assert.equal((await call('POST', '/v1/crew', { token: boss.token, body: { name: 'ab' } })).body.error, 'name', 'name floor');
// form it
let r = await call('POST', '/v1/crew', { token: boss.token, body: { name: 'The Dockside Boys' } });
assert.equal(r.code, 200, `the crew forms (${JSON.stringify(r.body)})`);
const crewId = r.body.id;
assert.equal((await call('POST', '/v1/crew', { token: boss.token, body: { name: 'Another' } })).body.error, 'in_crew', 'one crew per man');
assert.equal((await call('POST', '/v1/crew', { token: tony.token, body: { name: 'The Dockside Boys' } })).body.error, 'taken', 'unique name');

// invite → accept
assert.equal((await invite(boss, boss)).body.error, 'self', 'no inviting yourself');
assert.equal((await invite(boss, tony)).code, 200, 'Tony is asked');
assert.equal((await invite(boss, tony)).body.error, 'already', 'no double-ask');
// Tony sees the invite on his board
let tb = (await call('GET', '/v1/crew', { token: tony.token })).body;
assert.equal(tb.crew, null, 'Tony has no crew yet');
assert.equal(tb.invites.length, 1, 'and one invite waiting');
assert.equal(tb.invites[0].name, 'The Dockside Boys', 'from the right crew');
// a stranger cannot accept an invite that was not theirs
assert.equal((await call('POST', `/v1/crew/accept/${crewId}`, { token: vito.token })).body.error, 'no_invite', "you can't gatecrash");
assert.equal((await call('POST', `/v1/crew/accept/${crewId}`, { token: tony.token })).code, 200, 'Tony joins');
// the board shows both, the leader flagged
let bb = (await call('GET', '/v1/crew', { token: boss.token })).body;
assert.equal(bb.crew.members.length, 2, 'two on the board');
assert.equal(bb.crew.members.find((m) => m.isMe).leader, true, 'the boss is flagged leader');
assert.equal(bb.crew.members.find((m) => m.name === 'Tony Two').level >= 3, true, 'members carry live level');

// the cap — fill to MAX_MEMBERS, then the next invite is refused at the door
for (const c of [vito, nick]) {
  await invite(boss, c);
  await call('POST', `/v1/crew/accept/${crewId}`, { token: c.token });
}
assert.equal((await call('GET', '/v1/crew', { token: boss.token })).body.crew.members.length, CREW.MAX_MEMBERS, 'crew is full');
assert.equal((await invite(boss, rookie)).body.error, 'full', `no room past ${CREW.MAX_MEMBERS}`);

// kick — leader only, and never themselves
assert.equal((await call('DELETE', `/v1/crew/member/${nick.id}`, { token: tony.token })).body.error, 'not_leader', 'only the boss cuts a man');
assert.equal((await call('DELETE', `/v1/crew/member/${boss.id}`, { token: boss.token })).body.error, 'self', 'leave to step down');
assert.equal((await call('DELETE', `/v1/crew/member/${nick.id}`, { token: boss.token })).code, 200, 'Nicky is cut loose');
assert.equal((await call('GET', '/v1/crew', { token: nick.token })).body.crew, null, "and he's out");

// succession — the boss walks, the oldest remaining member (Tony) inherits
assert.equal((await call('POST', '/v1/crew/leave', { token: boss.token })).code, 200, 'the boss walks');
const led = (await pool.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0].leader_account;
assert.equal(led, await acctOf(tony.id), 'Tony inherits the crew');

// ════════════ B · NON-AGGRESSION (the omertà twin) ════════════
// a clean 2-man crew: A leads, B joins. A jumps B → blocked. rat forfeits it. leaving breaks it.
const a = await mk('Shooter A'); const b = await mk('Shooter B');
for (const c of [a, b]) await kit(c.id);
await call('POST', '/v1/crew', { token: a.token, body: { name: 'Two Guns' } });
await invite(a, b);
const twoGuns = (await call('GET', '/v1/crew', { token: a.token })).body.crew.id;
await call('POST', `/v1/crew/accept/${twoGuns}`, { token: b.token });

assert.equal((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'you do not raise a hand to your own crew');
// a RAT crewmate forfeits the shield (the omertà exception)
await pool.query('UPDATE account_persistent SET rat=true WHERE account_id=$1', [await acctOf(b.id)]);
assert.notEqual((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'a rat is fair game — the shield is void');
await pool.query('UPDATE account_persistent SET rat=false WHERE account_id=$1', [await acctOf(b.id)]);
await kit(b.id);   // patch him up after the rat jump
// and LEAVING breaks it — the pact is opt-in, and walking away ends it
assert.equal((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew', 'still shielded while crewed');
await call('POST', '/v1/crew/leave', { token: b.token });
assert.notEqual((await call('POST', `/v1/streets/${b.id}/jump`, { token: a.token })).body.error, 'crew',
  'once he walks, he is fair game again');

// ════════════ C · THE CREW ROOM (the small-group chat channel) ════════════
assert.equal((await call('POST', '/v1/crew/chat', { token: nick.token, body: { text: 'anyone home?' } })).body.error, 'no_crew',
  'no crew, no room');
assert.equal((await call('POST', '/v1/crew/chat', { token: tony.token, body: { text: 'meet at the docks' } })).code, 200, 'a crewmate talks');
const room = (await call('GET', '/v1/crew/chat', { token: vito.token })).body.messages;
assert.equal(room.some((m) => m.text === 'meet at the docks'), true, 'and the crew reads it');
assert.deepEqual((await call('GET', '/v1/crew/chat', { token: nick.token })).body.messages, [], 'an outsider reads nothing');

// ════════════ D · §10.4 — the whole thing moves no value ════════════
assert.equal(await one("SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'crew%'"), 0,
  'THE CREW writes no ledger rows — there is no crew: vocabulary');
{ // a pure crew op (form → invite → accept → leave) must not move the character-cash identity
  const before = await driftOf('character cash');
  const x = await mk('Ledger Probe'); const y = await mk('Ledger Probe Two');
  await kit(x.id); await kit(y.id);
  await call('POST', '/v1/crew', { token: x.token, body: { name: 'No Money Here' } });
  const cid = (await call('GET', '/v1/crew', { token: x.token })).body.crew.id;
  await invite(x, y);
  await call('POST', `/v1/crew/accept/${cid}`, { token: y.token });
  await call('POST', '/v1/crew/leave', { token: y.token });
  assert.equal(await driftOf('character cash'), before, 'the cash identity did not move across the crew flow');
}

// the worker invite sweep — a stale invite is tidied (row hygiene)
await invite(tony, rookie);
await pool.query("UPDATE crew_invites SET at = now() - interval '10 days'");
assert.equal((await sweepCrewInvites(pool)).swept >= 1, true, 'the worker sweeps stale invites');

console.log('crew: PASS');
await app.close();
process.exit(0);
