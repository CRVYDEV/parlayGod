// THE MAP — the visible city (/v1/map). A §10.4-free read that aggregates six control states per
// district + a family power ranking. The centre of the test: the board reflects real control (a
// district my family holds reads `mine`; an NPC-occupied one carries its liberation cost; a territory
// racket surfaces its type), the power ranking ranks by districts held, and the whole read moves no
// value.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import * as S from '../src/social/gangs.js';

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
const map = async (t) => (await call('GET', '/v1/map', { token: t })).body;
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);

// ════════════ the board — six districts, a power ranking, the season, my holdings ════════════
const p = await mk('Map Boss');
let b = await map(p.token);
assert.ok(Array.isArray(b.districts) && b.districts.length === b.total, 'every core district is on the board');
assert.ok(b.season && b.season.name, 'the season phase is surfaced');
assert.ok(b.mine && b.mine.districts === 0, 'a gangless player holds nothing');
// the fresh map is all NPC-occupied / open — an occupied tile carries its liberation cost
const occ = b.districts.find((d) => d.occupier);
assert.ok(occ && occ.state === 'occupied' && occ.occupier.liberationCost > 0, 'an NPC-occupied district shows its liberation cost');

// ════════════ MY FAMILY HOLDS THE DOCKS — the identity hook + the power ranking ════════════
// found a gang for the player and plant its flag on a couple of districts (direct seed — the map is a
// pure read; we're testing what it REFLECTS, not the seize path).
const gid = 'g-map-1';
await pool.query("INSERT INTO gangs (id, name, tag, treasury) VALUES ($1,'The Cartographers','MAP',500000)", [gid]);
await pool.query("INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,'boss')", [gid, p.id]);
// clear the NPC occupier off 'docks' and 'neon' and hand them to my family; give docks a smuggling racket
await pool.query("UPDATE districts SET npc_holder=NULL, holder_gang=$1, garrison=45000 WHERE id IN ('docks','neon')", [gid]);
await pool.query("INSERT INTO territory_rackets (district_id, owner_gang, tier, kind) VALUES ('docks',$1,2,'smuggling')", [gid]);

// a SECOND family holds just ONE district — so the ranking ORDER is load-bearing (mine, at 2, must top it)
const gid2 = 'g-map-2';
await pool.query("INSERT INTO gangs (id, name, tag, treasury) VALUES ($1,'The Runners-Up','RU2',100000)", [gid2]);
await pool.query("UPDATE districts SET npc_holder=NULL, holder_gang=$1 WHERE id='foundry'", [gid2]);

b = await map(p.token);
const docks = b.districts.find((d) => d.id === 'docks');
assert.ok(docks.holder && docks.holder.mine === true && docks.state === 'mine', 'a district my family holds reads as MINE');
assert.equal(docks.holder.tag, 'MAP', 'the holding family\'s tag is surfaced');
assert.ok(docks.racket && docks.racket.typeName === 'Smuggling Ring' && docks.racket.tier === 2, 'the territory racket on the district is surfaced');
assert.equal(b.mine.districts, 2, 'my family\'s core-district count is surfaced');
// the power ranking — my family tops it (2 districts)
assert.ok(b.powers.length >= 2 && b.powers[0].tag === 'MAP' && b.powers[0].districts === 2 && b.powers[0].mine === true,
  'the power ranking ranks families by core districts held, and flags mine');
assert.equal(b.powers[1].tag, 'RU2', 'a family holding fewer districts ranks BELOW — the ranking is by control, not insertion');
assert.equal(b.powers[1].mine, false, 'another family is not flagged mine');

// WHAT IT COSTS TO COME FOR IT. The map priced the NPC path and showed the player path a raw
// GARRISON — which is not the price and reads exactly like one. Asserted against turfQuote's OWN
// answer rather than a restated formula, because the point is that the map and the till agree; a
// literal here would pass while the two drifted, which is the whole class this is fixing.
{
  // measured against a district carrying a REAL garrison — on a bare one the floor is the base and
  // the two differ trivially, so the assertion would pass while proving nothing about the outbid
  const priced = b.districts.find((d) => d.id === 'docks');
  assert.ok(priced.garrison > 0, 'the precondition: a garrison to be understated by');
  const truth = (await S.turfQuote(pool, { respect: 0 },
    (await pool.query("SELECT * FROM districts WHERE id='docks'")).rows[0], null)).cost;
  assert.equal(priced.claimFloor, truth, 'the map quotes what a stake really costs, not the garrison');
  assert.ok(priced.claimFloor > priced.garrison,
    `and it is DEARER than the garrison the map used to show alone (${priced.garrison} → ${priced.claimFloor})`);
  assert.ok(b.districts.find((d) => d.id === 'foundry').claimFloor > 0, 'a rival-held district is priced too');
  const occupied = b.districts.find((d) => d.occupier);
  assert.equal(occupied.claimFloor, undefined,
    'an OCCUPIED district quotes liberation, not a stake — you free it, you do not bid for it');
}

// ════════════ §10.4 — the whole read moves NO value ════════════
const txBefore = await txnCount();
const driftBefore = Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'character cash').drift);
await map(p.token); await map(p.token);
assert.equal(await txnCount(), txBefore, 'reading the map writes zero transactions rows');
assert.equal(Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'character cash').drift), driftBefore, 'the map is §10.4-neutral');

console.log('citymap: THE MAP ok');
await app.close();
process.exit(0);
