// THE COLLISION (src/collision.js) — make a real human being around VISIBLE, the thing the NPC scenery
// hides in a thin population. HERE (real humans in your district), NEARBY (near your level elsewhere),
// HOT DISTRICTS (where the humans are), each with an `online` flag (the live ●). REAL humans only —
// residents + agents excluded. §10.4-FREE (pure reads, no ledger row). Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { spawnResident } from '../src/population.js';
import { collisionBoard } from '../src/collision.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const id = (await meOf(token)).id;
  return { token, id, acct: await acctOf(id) };
};
const chRow = async (id) => (await pool.query('SELECT * FROM characters WHERE id=$1', [id])).rows[0];

// ── the viewer, at the docks, mid-level ──
const me = await mk('The Viewer');
await seedCh(me.id, "respect=200, loc='docks'");

// ── real humans: one in the viewer's district (HERE), one near-level elsewhere (NEARBY) ──
const here1 = await mk('Docks Human');
await seedCh(here1.id, "respect=180, loc='docks'");
const near1 = await mk('Canal Human');
await seedCh(near1.id, "respect=220, loc='canal'");
// a far, off-level human to populate a HOT district but not NEARBY
const far1 = await mk('Neon Whale');
await seedCh(far1.id, "respect=500000, loc='neon'");

// ── scenery that must be EXCLUDED: an NPC resident in the viewer's district, and an agent ──
const res = await spawnResident(pool, { band: { id: 'corner', lvl: [1, 2], seed: [200, 400], stat: [1, 3] } });
await seedCh(res.id, "loc='docks', respect=190");
const agent = await mk('Agent Smith');
await seedCh(agent.id, "respect=200, loc='docks'");
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [agent.acct]);

const client = await pool.connect();
try {
  const meCh = await chRow(me.id);

  // ── nobody online: the lists still surface real humans (online is a FLAG, not a filter), all offline ──
  let b = await collisionBoard(client, meCh, []);
  assert.ok(b.here.some((p) => p.id === here1.id), 'the district human is HERE');
  assert.ok(!b.here.some((p) => p.id === res.id), 'the NPC resident is EXCLUDED from HERE (scenery, not a real player)');
  assert.ok(!b.here.some((p) => p.id === agent.id), 'the agent is EXCLUDED from HERE');
  assert.ok(!b.here.some((p) => p.id === me.id), 'the viewer is not in their own list');
  assert.ok(b.nearby.some((p) => p.id === near1.id), 'the near-level human elsewhere is NEARBY');
  assert.ok(!b.nearby.some((p) => p.id === far1.id), 'the off-level whale is NOT nearby');
  assert.equal(b.onlineNow, 0, 'nobody online → onlineNow 0');
  assert.ok(b.here.every((p) => p.online === false), 'everyone reads offline with an empty online set');
  assert.equal(b.you.district, 'docks', 'the board carries your district');

  // ── HOT DISTRICTS: real humans per other district, viewer\'s own dropped ──
  assert.ok(b.hotDistricts.some((h) => h.district === 'canal'), 'canal (a near human) is a hot district');
  assert.ok(b.hotDistricts.some((h) => h.district === 'neon'), 'neon (the far human) is a hot district');
  assert.ok(!b.hotDistricts.some((h) => h.district === 'docks'), 'your OWN district is dropped from hot districts');

  // ── the online FLAG lights when the account is on the wire, and online-first ordering leads ──
  b = await collisionBoard(client, meCh, [here1.acct, near1.acct]);
  assert.equal(b.here.find((p) => p.id === here1.id).online, true, 'the district human reads ONLINE when on the wire');
  assert.equal(b.nearby.find((p) => p.id === near1.id).online, true, 'the near human reads online');
  assert.equal(b.onlineNow, 2, 'onlineNow counts both live real humans');
  assert.equal(b.here[0].online, true, 'the online human leads HERE (online-first ordering)');

  // ── NO account UUID ever leaves (the rivals/cast discipline) ──
  for (const p of [...b.here, ...b.nearby]) assert.ok(!('account_id' in p), 'no account UUID surfaces on a card');
} finally { client.release(); }

// ── the route wires it (readCharacter + the online set) ──
const rb = (await call('GET', '/v1/live', { token: me.token })).body;
assert.ok(Array.isArray(rb.here) && Array.isArray(rb.nearby), 'GET /v1/live returns the board');
assert.ok(rb.here.some((p) => p.id === here1.id), 'the route surfaces the district human');

// ── §10.4: the whole surface moves no value ──
const inv = (await runLedgerInvariants(pool, { alert: false })).checks;
assert.equal(inv.find((c) => c.name === 'reason vocabulary').ok, true, 'no unknown reason (the collision writes nothing)');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason LIKE 'collision%' OR reason LIKE 'live%'")).rows[0].n), 0, 'the collision surface writes zero ledger rows');

console.log('✅ THE COLLISION: here/nearby split, residents+agents excluded, hot districts, online flag, §10.4-free');
process.exit(0);
