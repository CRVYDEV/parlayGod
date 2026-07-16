// SMUGGLING CONVOYS test — load (bulk beyond the trunk), guard-fee sink, the public band board,
// ambush gates (own/family/safehouse/spent), a deterministic hijack (trunk-capped transfer, the
// rest rolls on), a deterministic repel (hospital), arrival + collect at the destination, and the
// §10.4 vocabulary (convoy: cash + ammo sinks). pg-mem, zero infra.
process.env.CONVOY_MS = '600000'; // 10-minute road for the test (TEST-ONLY knob, SEARCH_MS pattern)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CONVOY } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);

const sam = await mk('Shipper Sam');
const harry = await mk('Highway Harry');
const fred = await mk('Family Fred');
const willy = await mk('Weak Willy');
await seedCh(sam.id, "respect=400, cash=200000, loc='docks'");

// ── load: goods come FROM the trunk; two loads beat the trunk cap ──
let r = await call('POST', '/v1/goods/buy', { token: sam.token, body: { goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'trunk filled (10 = the base cap)');
assert.equal((await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'nowhere', goodId: 'gin', qty: 10 } })).body.error, 'bad_district', 'no such road');
assert.equal((await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'docks', goodId: 'gin', qty: 10 } })).body.error, 'same', 'it is already here');
r = await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'shipment opened'); assert.equal(r.body.loaded, 10, 'first pallet loaded');
assert(!(await meOf(sam.token)).cargo.gin, 'the trunk emptied into the manifest');
assert.equal((await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'neon', goodId: 'gin', qty: 1 } })).body.error, 'busy', 'one shipment at a time');
assert.equal((await call('POST', '/v1/goods/buy', { token: sam.token, body: { goodId: 'gin', qty: 10 } })).code, 200, 'trunk refilled from the market');
assert.equal((await call('POST', '/v1/convoy/load', { token: sam.token, body: { goodId: 'gin', qty: 10 } })).code, 200, 'second pallet loaded');
assert.equal((await call('GET', '/v1/convoys', { token: sam.token })).body.mine.manifest[0].qty, 20, 'the manifest holds DOUBLE the trunk — bulk is the point');

// ── depart: the guard fee is a ledgered sink; the road announces a BAND, never the manifest ──
assert.equal((await call('POST', '/v1/convoy/depart', { token: sam.token, body: { guards: 'platoon' } })).body.error, 'bad_guards', 'no such tier');
const samCashPre = (await meOf(sam.token)).cash;
r = await call('POST', '/v1/convoy/depart', { token: sam.token, body: { guards: 'crew' } });
assert.equal(r.code, 200, 'on the road'); const cid = r.body.id;
assert.equal((await meOf(sam.token)).cash, samCashPre - 5000, 'the crew took their fee');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='convoy:guards' AND character_id='${sam.id}'`)).rows[0].s), -5000, 'convoy:guards is a ledgered cash sink');
r = await call('GET', '/v1/convoys', { token: harry.token });
const road = r.body.inTransit.find((c) => c.id === cid);
assert(road && road.band && !JSON.stringify(road).includes('"qty"'), 'the road shows a value band, never the manifest');

// ── ambush gates ──
assert.equal((await call('POST', `/v1/convoy/${cid}/ambush`, { token: sam.token })).body.error, 'own', 'not your own truck');
const gangId = (await call('POST', '/v1/gangs', { token: sam.token, body: { name: 'Freight Kings', tag: 'FRT' } })).body.gangId;
assert(gangId, 'sam founded a family');
// the gang snapshot rides the convoy at DEPART — it already left ungoverned; re-check family via fred joining sam's gang and a fresh run later is heavy, so assert the live-family block on a fresh convoy below. For THIS run: safehouse + readiness gates on harry.
await seedCh(harry.id, "energy=200, ammo=100, muscle=500, speed=500, safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/convoy/${cid}/ambush`, { token: harry.token })).body.error, 'safe', 'no highway work from a safehouse');
await seedCh(harry.id, 'safe_until=NULL');

// ── the hijack (deterministic: 750-ish vs 35+30 max) — trunk-capped, the rest rolls on ──
r = await call('POST', `/v1/convoy/${cid}/ambush`, { token: harry.token });
assert.equal(r.code, 200, 'ambush resolves'); assert.equal(r.body.win, true, 'the crew guards fold to overwhelming muscle');
assert.equal(r.body.taken, 10, 'the hijacker takes what HIS trunk holds (10), not the manifest (20)');
assert.equal((await meOf(harry.token)).cargo.gin, 10, 'the gin changed hands');
assert((await meOf(harry.token)).heat >= CONVOY.AMBUSH_HEAT, 'highway robbery draws the law');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='convoy:ambush' AND character_id='${harry.id}'`)).rows[0].s), -CONVOY.AMBUSH_AMMO, 'the ammo burn is ledgered');
await seedCh(willy.id, 'energy=200, ammo=100');
assert.equal((await call('POST', `/v1/convoy/${cid}/ambush`, { token: willy.token })).body.error, 'spent', 'one attempt per convoy — the guards are awake now');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM notifications WHERE character_id='${sam.id}' AND type='convoy_hit'`)).rows[0].n), 1, 'the shipper heard');

// ── arrival + collect at the destination ──
assert.equal((await call('POST', `/v1/convoy/${cid}/collect`, { token: sam.token })).body.error, 'en_route', 'still on the road');
await pool.query(`UPDATE convoys SET arrives_at = now() - interval '1 minute' WHERE id='${cid}'`);
assert.equal((await call('POST', `/v1/convoy/${cid}/collect`, { token: sam.token })).body.error, 'district', 'the freight lands at neon — be there');
await seedCh(sam.id, "loc='neon'");
r = await call('POST', `/v1/convoy/${cid}/collect`, { token: sam.token });
assert.equal(r.code, 200, 'collected'); assert.equal(r.body.collected, 10, 'the surviving half of the manifest landed');
assert.equal(r.body.remaining, 0, 'nothing left on the dock');
assert.equal((await meOf(sam.token)).cargo.gin, 10, 'in the trunk, ready for the neon market');

// ── a fresh HEAVY run: the family block + a deterministic repel ──
r = await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'docks', goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'the return run opened');
r = await call('POST', '/v1/convoy/depart', { token: sam.token, body: { guards: 'heavy' } });
assert.equal(r.code, 200, 'heavy guards hired'); const cid2 = r.body.id;
assert.equal((await call('POST', `/v1/gangs/${gangId}/join`, { token: fred.token })).code, 200, 'fred joined the family');
await seedCh(fred.id, 'energy=200, ammo=100');
assert.equal((await call('POST', `/v1/convoy/${cid2}/ambush`, { token: fred.token })).body.error, 'family', "the family's freight is off-limits");
await seedCh(willy.id, 'energy=200, ammo=100, muscle=1, speed=1, hosp_until=NULL, safe_until=NULL');
r = await call('POST', `/v1/convoy/${cid2}/ambush`, { token: willy.token });
assert.equal(r.code, 200, 'the attempt resolves'); assert.equal(r.body.win, false, 'heavy guards repel a weakling (60+ vs ~31 max)');
assert((await meOf(willy.token)).hospSeconds > 0, 'the guards put him in the hospital');
assert.equal(Number((await pool.query(`SELECT qty FROM convoy_cargo WHERE convoy_id='${cid2}'`)).rows[0].qty), 10, 'the freight rolls on untouched');

// ── §10.4: the vocabulary knows the convoy reasons (cash + ammo) ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `convoy:* is enumerated (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ Convoy test passed — bulk loading beyond the trunk, guard-fee sink ledgered, band-only road board, ambush gates (own/family/safehouse/spent), deterministic hijack (trunk-capped transfer, remainder rolls on, shipper notified), deterministic repel (hospital, freight untouched), arrival + at-destination collect, §10.4 vocabulary');
await app.close();
