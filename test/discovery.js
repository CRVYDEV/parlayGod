// THE ROLODEX (omerta-discovery-design.md) — player discovery.
//
// A §10.4-free read layer + one LFG toggle, so the centre of this file is: the three lists surface the
// right HUMANS (near-level peers, a fresh "looking for a crew" recruit list, and newcomers), the
// exclusions hold (self / NPC residents / agents / out-of-band whales), the LFG flag drives the recruit
// list and goes stale, and the whole thing moves no value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { DISCOVERY } from '../src/rules.js';

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
const seed = (id, sql) => pool.query(`UPDATE characters SET ${sql} WHERE id='${id}'`);
const board = async (t) => (await call('GET', '/v1/discovery', { token: t })).body;
const driftOf = async (name) => {
  const r = await runLedgerInvariants(pool, { alert: false });
  return Number(r.checks.find((x) => x.name === name).drift);
};
const has = (list, name) => list.some((r) => r.name === name);

// a viewer + a near-level peer (both ~level 23 at respect 5000; BAND ±10 puts them squarely in band)
const me = await mk('Johnny Front');
const peer = await mk('Sally Near');
await seed(me.id, 'respect=5000');
await seed(peer.id, 'respect=5000');

// an AGENT and a RESIDENT at the SAME level — both must be excluded from the human front door
const agent = await mk('Bot Nine');
const resident = await mk('Ghost Res');
await seed(agent.id, 'respect=5000');
await seed(resident.id, 'respect=5000');
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [await acctOf(agent.id)]);
await seed(resident.id, 'is_npc=true');

// a WHALE far above the band (level ~80) — out of peers/looking, but a valid human
const whale = await mk('Big Money');
await seed(whale.id, 'respect=62410');

// ════════════ PEERS — near-level humans, exclusions held ════════════
let b = await board(me.token);
assert.equal(b.me.level >= 20, true, 'the viewer carries a live level');
assert.equal(b.me.band, DISCOVERY.BAND, 'the band is surfaced');
assert.equal(has(b.peers, 'Sally Near'), true, 'a near-level human is a peer');
assert.equal(has(b.peers, 'Johnny Front'), false, 'never yourself');
assert.equal(has(b.peers, 'Bot Nine'), false, 'an agent is off the social front door');
assert.equal(has(b.peers, 'Ghost Res'), false, 'an NPC resident is off it too');
assert.equal(has(b.peers, 'Big Money'), false, 'a whale far above the band is not a peer');

// ════════════ LFG — the recruit list ════════════
assert.deepEqual(b.looking, [], "nobody's advertised yet, so the recruit list is empty (honest)");
assert.equal(b.me.lfg, false, 'the viewer is not looking');
// the peer flags LFG
assert.equal((await call('POST', '/v1/discovery/lfg', { token: peer.token, body: { on: true } })).body.discovery, 'looking', 'the peer puts the word out');
b = await board(me.token);
assert.equal(has(b.looking, 'Sally Near'), true, 'a looking, crewless, near-level human is on the recruit list');
assert.equal(has(b.peers, 'Sally Near'), false, 'and is de-duped OUT of the general peers list');
// the viewer's own flag round-trips
assert.equal((await call('POST', '/v1/discovery/lfg', { token: me.token, body: { on: true } })).body.lfg, true, 'the viewer can flag too');
assert.equal((await board(me.token)).me.lfg, true, 'and it surfaces on their own board');
assert.equal((await call('POST', '/v1/discovery/lfg', { token: me.token, body: { on: false } })).body.discovery, 'not_looking', 'and take it down');

// a crewed player is NOT on the recruit list (you want a crew when you have none)
await seed(peer.id, 'respect=5000');
await call('POST', '/v1/crew', { token: peer.token, body: { name: 'Sallys Crew' } });
assert.equal(has((await board(me.token)).looking, 'Sally Near'), false, 'a peer who now runs a crew drops off the recruit list');
await call('POST', '/v1/crew/leave', { token: peer.token });   // back to solo + still LFG
assert.equal(has((await board(me.token)).looking, 'Sally Near'), true, 'and is back on it once solo again');

// a STALE flag (older than the TTL) drops from the recruit list but the peer stays discoverable
await pool.query(`UPDATE characters SET lfg_at = now() - interval '10 days' WHERE id='${peer.id}'`);
b = await board(me.token);
assert.equal(has(b.looking, 'Sally Near'), false, 'a week-old LFG flag is stale — off the recruit list');
assert.equal(has(b.peers, 'Sally Near'), true, 'but the peer is still a discoverable near-level human');

// ════════════ NEWCOMERS — newest humans, any level, exclusions held ════════════
b = await board(me.token);
assert.equal(has(b.newcomers, 'Big Money'), true, 'the whale shows in fresh blood (any level)');
assert.equal(has(b.newcomers, 'Johnny Front'), false, 'never yourself');
assert.equal(has(b.newcomers, 'Bot Nine'), false, 'agents excluded here too');
assert.equal(has(b.newcomers, 'Ghost Res'), false, 'residents excluded here too');

// ════════════ STEP TWO — online presence + recruiting crews ════════════
// `discoveryBoard` takes an onlineIds set from the route (the WS registry). The suite drives the
// board directly through the module to exercise presence + the crews list.
import { discoveryBoard } from '../src/discovery.js';
const readCh = async (id) => (await pool.query('SELECT * FROM characters WHERE id=$1', [id])).rows[0];
const acctOfId = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;

// presence: with the peer's account marked online, their card reads online; nobody online → all false
{
  const meCh = await readCh(me.id);
  const peerAcct = await acctOfId(peer.id);
  const on = await discoveryBoard(meCh, pool, [peerAcct]);
  const pc = [...on.looking, ...on.peers, ...on.newcomers].find((r) => r.name === 'Sally Near');
  assert.equal(pc && pc.online, true, 'a connected account reads ONLINE on the board');
  const off = await discoveryBoard(meCh, pool, []);
  assert.equal([...off.looking, ...off.peers, ...off.newcomers].every((r) => r.online === false), true, 'nobody online → every card offline');
  assert.equal([...off.looking, ...off.peers, ...off.newcomers].every((r) => r.accountId === undefined && r.account_id === undefined), true,
    'the account id never leaks even though online is derived from it');
}

// recruiting crews: the peer opens a crew to new blood → it shows on the viewer's board near their level
{
  await pool.query(`UPDATE characters SET respect=5000 WHERE id='${peer.id}'`);
  await call('POST', '/v1/crew', { token: peer.token, body: { name: 'The Open Door' } });   // peer leads a crew
  let mc = await discoveryBoard(await readCh(me.id), pool, []);
  assert.equal((mc.crews || []).some((c) => c.name === 'The Open Door'), false, 'a CLOSED crew is not advertised');
  assert.equal((await call('POST', '/v1/crew/recruiting', { token: me.token, body: { on: true } })).body.error, 'no_crew', 'you need a crew to open it');
  assert.equal((await call('POST', '/v1/crew/recruiting', { token: peer.token, body: { on: true } })).body.crew, 'recruiting', 'the boss opens the doors');
  mc = await discoveryBoard(await readCh(me.id), pool, []);
  const openCrew = (mc.crews || []).find((c) => c.name === 'The Open Door');
  assert(openCrew, 'a RECRUITING crew near your level is advertised on the board');
  assert.equal(openCrew.members, 1, 'with its size');
  assert.equal(openCrew.maxLevel >= 20, true, 'and a level hint');
}

// ════════════ STEP THREE — filters (district / no-family / online) ════════════
{
  const fa = await mk('Filter Docks');   // docks, in a family
  const fb = await mk('Filter Neon');    // neon, unaffiliated
  await pool.query(`UPDATE characters SET respect=5000, loc='docks', cash=100000 WHERE id='${fa.id}'`);
  await pool.query(`UPDATE characters SET respect=5000, loc='neon' WHERE id='${fb.id}'`);
  await call('POST', '/v1/gangs', { token: fa.token, body: { name: 'Filter Mob', tag: 'FLT' } });   // fa joins a family
  const meCh = await readCh(me.id);
  const names = (bd) => [...bd.looking, ...bd.peers, ...bd.newcomers].map((r) => r.name);

  const dk = await discoveryBoard(meCh, pool, [], { district: 'docks' });
  assert.equal(names(dk).includes('Filter Docks'), true, 'the district filter keeps a docks player');
  assert.equal(names(dk).includes('Filter Neon'), false, 'and drops a neon player');
  assert.deepEqual(dk.filters, { district: 'docks', nofam: false, online: false }, 'the applied filters are echoed back');

  const nf = await discoveryBoard(meCh, pool, [], { nofam: true });
  assert.equal(names(nf).includes('Filter Neon'), true, 'the no-family filter keeps the unaffiliated');
  assert.equal(names(nf).includes('Filter Docks'), false, 'and drops a family man');

  const onl = await discoveryBoard(meCh, pool, [await acctOfId(fb.id)], { online: true });
  assert.equal(names(onl).includes('Filter Neon'), true, 'the online filter keeps the connected');
  assert.equal(names(onl).includes('Filter Docks'), false, 'and drops the offline');

  const none = await discoveryBoard(meCh, pool, [], {});
  assert.equal(names(none).includes('Filter Docks') && names(none).includes('Filter Neon'), true, 'no filter → both present');
}

// ════════════ §10.4 — the whole thing moves no value ════════════
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'discovery%'")).rows[0].n), 0,
  'discovery writes no ledger rows — there is no discovery: vocabulary');
{
  const before = await driftOf('character cash');
  await call('POST', '/v1/discovery/lfg', { token: me.token, body: { on: true } });
  await board(me.token);
  await call('POST', '/v1/discovery/lfg', { token: me.token, body: { on: false } });
  assert.equal(await driftOf('character cash'), before, 'the cash identity did not move across a discovery flow');
}

console.log('discovery: PASS');
await app.close();
process.exit(0);
