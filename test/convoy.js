// SMUGGLING CONVOYS test — load (bulk beyond the trunk), guard-fee sink, the public band board,
// ambush gates (own/family/safehouse/once/spent), a deterministic hijack (trunk-capped transfer,
// the rest rolls on), a deterministic repel (hospital), arrival + collect at the destination,
// and step two: the destination TOLL (holder treasury credit, §10.4 treasury check exact),
// degrading MULTI-AMBUSH (one per character, MAX_AMBUSHES per convoy), and INSURED freight
// (premium → pool, pool-capped claim at collect, §10.4 pool check exact). pg-mem, zero infra.
process.env.CONVOY_MS = '600000'; // 10-minute road for the test (TEST-ONLY knob, SEARCH_MS pattern)
process.env.MOD_KEY = 'test-mod-key'; // Tier-4 death test uses /v1/mod/kill
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { spawnNpcConvoys, despawnArrivedNpc, sweepConvoyHauls } from '../src/convoy.js';
import { CONVOY, NOTORIETY, goodPriceOf } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import crypto from 'node:crypto';

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
assert.equal((await call('POST', `/v1/convoy/${cid}/ambush`, { token: harry.token })).body.error, 'once', 'one play per character per run');
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

// ── STEP TWO: the destination TOLL — the family holding the docks taxes what lands there ──
await seedCh(harry.id, 'respect=400, cash=60000');
const rbId = (await call('POST', '/v1/gangs', { token: harry.token, body: { name: 'Road Barons', tag: 'RBS' } })).body.gangId;
assert(rbId, 'harry founded the Road Barons');
await pool.query(`UPDATE districts SET holder_gang='${rbId}' WHERE id='docks'`);
await pool.query(`UPDATE convoys SET arrives_at = now() - interval '1 minute' WHERE id='${cid2}'`);
await seedCh(sam.id, "loc='docks', cash=100000");
const rbPre = Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${rbId}'`)).rows[0].treasury);
r = await call('POST', `/v1/convoy/${cid2}/collect`, { token: sam.token });
assert.equal(r.code, 200, 'the return run collected'); assert.equal(r.body.collected, 10, 'all ten landed');
const expectToll = Math.floor(10 * goodPriceOf('gin', 'docks') * CONVOY.TOLL_BPS / 10000);
assert.equal(r.body.toll, expectToll, `the Barons take ${CONVOY.TOLL_BPS / 100}% of what lands on their docks ($${expectToll})`);
assert.equal(Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${rbId}'`)).rows[0].treasury), rbPre + expectToll, 'the toll reached the treasury');
assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='convoy:toll'`)).rows[0].s), -expectToll, 'convoy:toll is the ledgered transfer');
const checks1 = (await runLedgerInvariants(pool)).checks;
assert(checks1.find((c) => c.name === 'gang treasuries').ok, 'the treasury §10.4 check reconciles the toll');

// ── STEP TWO: insured freight + degrading multi-ambush (only WINS spend the convoy's slots) ──
const b1 = await mk('Bandit Bruno'), b2 = await mk('Bandit Benny'), b3 = await mk('Bandit Bobby');
r = await call('POST', '/v1/convoy', { token: sam.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
assert.equal(r.code, 200, 'the insured run opened');
await seedCh(sam.id, 'cash=100000');
const samPreIns = (await meOf(sam.token)).cash;
r = await call('POST', '/v1/convoy/depart', { token: sam.token, body: { guards: 'heavy', insure: true } });
assert.equal(r.code, 200, 'departed heavy, with a policy'); const cid3 = r.body.id;
const value = 10 * goodPriceOf('gin', 'neon');
const premium = Math.ceil(value * CONVOY.INSURE_BPS / 10000);
assert.equal(r.body.premium, premium, `the policy runs ${CONVOY.INSURE_BPS / 100}% of the manifest ($${premium})`);
assert.equal((await meOf(sam.token)).cash, samPreIns - 20000 - premium, 'the guards and the premium left the pocket');
assert.equal(Number((await pool.query('SELECT pool FROM convoy_insurance WHERE id=1')).rows[0].pool), premium, 'the premium sits in the pool');
// a deliberate LOSS spends only the loser's play — never the convoy's slots (audit HIGH-2:
// three throwaway alts could otherwise make any convoy unambushable)
await seedCh(willy.id, 'energy=200, ammo=100, muscle=1, speed=1, hosp_until=NULL, safe_until=NULL');
r = await call('POST', `/v1/convoy/${cid3}/ambush`, { token: willy.token });
assert.equal(r.body.win, false, 'a weakling bounces off heavy guards');
assert.equal(Number((await pool.query(`SELECT ambushes FROM convoys WHERE id='${cid3}'`)).rows[0].ambushes), 0, "willy's sacrifice consumed NO hijack slot");
await seedCh(willy.id, 'hosp_until=NULL, energy=200, ammo=100');
assert.equal((await call('POST', `/v1/convoy/${cid3}/ambush`, { token: willy.token })).body.error, 'once', 'but his own play is spent');
// hijack 1 takes EVERYTHING — the insured loss is stamped; hijacks 2+3 fight worn guards
await seedCh(b1.id, 'energy=200, ammo=100, muscle=500, speed=500');
r = await call('POST', `/v1/convoy/${cid3}/ambush`, { token: b1.token });
assert.equal(r.body.win, true, 'bruno takes the lot'); assert.equal(r.body.taken, 10, 'the whole manifest');
assert.equal((await call('POST', `/v1/convoy/${cid3}/ambush`, { token: b1.token })).body.error, 'once', 'bruno had his play');
assert.equal(Number((await pool.query(`SELECT insured_loss FROM convoys WHERE id='${cid3}'`)).rows[0].insured_loss), value, 'the lost value is on the policy');
assert.equal((await call('GET', '/v1/convoys', { token: sam.token })).body.mine.insuranceDue,
  Math.floor(value * CONVOY.INSURE_PAYOUT_BPS / 10000), 'the shipper sees the claim due');
await seedCh(b2.id, 'energy=200, ammo=100, muscle=500, speed=500');
assert.equal((await call('POST', `/v1/convoy/${cid3}/ambush`, { token: b2.token })).body.win, true, 'hijack two (empty truck, worn guards)');
await seedCh(b3.id, 'energy=200, ammo=100, muscle=500, speed=500');
assert.equal((await call('POST', `/v1/convoy/${cid3}/ambush`, { token: b3.token })).body.win, true, 'hijack three');
await seedCh(harry.id, 'energy=200, ammo=100, hosp_until=NULL, safe_until=NULL');
assert.equal((await call('POST', `/v1/convoy/${cid3}/ambush`, { token: harry.token })).body.error, 'spent', `${CONVOY.MAX_AMBUSHES} hijacks and the road is done`);
assert((await pool.query("SELECT outcome FROM rng_audit WHERE action LIKE 'convoy:ambush:%' AND outcome LIKE '%guards worn%'")).rows.length >= 1, 'the wear shows in the audit trail');
// a second shipper's premium fattens the pool — sam's claim must NOT reach it (the
// UNDERWRITING LIMIT: you never claim past your own lifetime premiums — audit HIGH-1)
await seedCh(harry.id, "loc='docks', cash=100000");
assert.equal((await call('POST', '/v1/convoy', { token: harry.token, body: { to: 'neon', goodId: 'gin', qty: 10 } })).code, 200, "harry ships his stolen gin");
const hPremium = (await call('POST', '/v1/convoy/depart', { token: harry.token, body: { guards: 'none', insure: true } })).body.premium;
assert(hPremium > 0, 'harry paid a premium too');
// D2: collecting (freight + toll + claim) is an EXPOSED act — not from a safehouse
await pool.query(`UPDATE convoys SET arrives_at = now() - interval '1 minute' WHERE id='${cid3}'`);
await seedCh(sam.id, "loc='neon', safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/convoy/${cid3}/collect`, { token: sam.token })).body.error, 'safe', 'nobody signs for freight from a safehouse');
await seedCh(sam.id, 'safe_until=NULL');
const samPreClaim = (await meOf(sam.token)).cash;
r = await call('POST', `/v1/convoy/${cid3}/collect`, { token: sam.token });
assert.equal(r.code, 200, 'the empty run settles'); assert.equal(r.body.collected, 0, 'nothing survived');
assert.equal(r.body.insurance, premium, 'the payout is CAPPED at his own lifetime premiums — not the fattened pool');
assert.equal((await meOf(sam.token)).cash, samPreClaim + premium, 'the claim landed');
assert.equal(Number((await pool.query('SELECT pool FROM convoy_insurance WHERE id=1')).rows[0].pool), hPremium, "harry's premium is untouched — colluders can't drain other shippers");
const checks2 = (await runLedgerInvariants(pool)).checks;
assert(checks2.find((c) => c.name === 'convoy insurance pool').ok, 'the insurance-pool §10.4 check reconciles (premiums − payouts)');

// ── STEP THREE — NPC TRUCKING: worker-run unmarked trucks players can hijack (the ambush loop's PvE target) ──
// the worker keeps CONVOY.NPC.TARGET on the road
let sp = await spawnNpcConvoys(pool);
assert.equal(sp.spawned, CONVOY.NPC.TARGET, `the road is topped up to ${CONVOY.NPC.TARGET} NPC trucks`);
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM convoys WHERE is_npc AND status='transit'")).rows[0].n), CONVOY.NPC.TARGET, 'NPC convoys are on the road');
assert.equal((await spawnNpcConvoys(pool)).spawned, 0, 'already at TARGET — no over-spawn');
// seed a KNOWN NPC convoy (guards none, a fat gin manifest) for a deterministic hijack
const npcId = crypto.randomUUID();
await pool.query(`INSERT INTO convoys (id, owner_character, is_npc, owner_gang, origin, destination, status, guards, departed_at, arrives_at) VALUES ('${npcId}',NULL,true,NULL,'docks','neon','transit',10, now(), now() + interval '10 minutes')`);
await pool.query(`INSERT INTO convoy_cargo (convoy_id, good_id, qty) VALUES ('${npcId}','gin',12)`);
// it shows on the public board as an unmarked truck (no owner), flagged npc
const board = (await call('GET', '/v1/convoys', { token: harry.token })).body;
const onBoard = board.inTransit.find((c) => c.id === npcId);
assert(onBoard && onBoard.npc === true && onBoard.owner === 'an unmarked truck', 'the NPC truck is an ambushable target on the board');
// a strong raider hijacks it — the goods land in his trunk, and the NULL owner never crashes the notify
await seedCh(harry.id, "muscle=100, speed=40, energy=200, ammo=500, health=100, cash=100000, jail_until=NULL, hosp_until=NULL, safe_until=NULL, loc='docks'");
const harryGinPre = (await meOf(harry.token)).cargo?.gin || 0;
r = await call('POST', `/v1/convoy/${npcId}/ambush`, { token: harry.token });
assert.equal(r.code, 200, 'the ambush runs on an NPC truck'); assert.equal(r.body.win, true, 'the strong raider takes the freight');
assert((await meOf(harry.token)).cargo.gin > harryGinPre, "the NPC truck's gin landed in the raider's trunk");
// an ARRIVED NPC convoy despawns (the driver delivered; the remaining freight leaves the world)
const goneId = crypto.randomUUID();
await pool.query(`INSERT INTO convoys (id, owner_character, is_npc, owner_gang, origin, destination, status, guards, departed_at, arrives_at) VALUES ('${goneId}',NULL,true,NULL,'docks','neon','transit',10, now() - interval '20 minutes', now() - interval '1 minute')`);
await pool.query(`INSERT INTO convoy_cargo (convoy_id, good_id, qty) VALUES ('${goneId}','silk',8)`);
const dsp = await despawnArrivedNpc(pool);
assert(dsp.despawned >= 1, 'the arrived NPC truck despawned');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM convoys WHERE id='${goneId}'`)).rows[0].n), 0, 'the delivered NPC convoy is gone');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM convoy_cargo WHERE convoy_id='${goneId}'`)).rows[0].n), 0, 'its cargo is gone too (no faucet on a delivered truck)');

// ══ CONVOYS → Tier 4: THE RIG, the two legends, the weekly boards ══
// clear prior-block haul noise so the read-derived weekly contest reflects only the Tier-4 actors
// (earlier test streets legitimately banked deliver/hijack hauls — the board correctly sums them)
await pool.query('DELETE FROM convoy_hauls');
const rick = await mk('Rig Rick');     // high level — buys/upgrades a rig, delivers clean
const bo = await mk('Bandit Bo');      // high level — hijacks (bumps the Highwayman legend)
const runt = await mk('Legend Runt');  // below LEGEND_MIN_LVL — the anti-Sybil floor
await seedCh(rick.id, "respect=1000000, cash=8000000, loc='docks', energy=200, ammo=100, muscle=600, speed=600, safe_until=NULL, hosp_until=NULL, jail_until=NULL");
await seedCh(bo.id, "respect=1000000, cash=100000, energy=200, ammo=100, muscle=600, speed=600, safe_until=NULL, hosp_until=NULL, jail_until=NULL, loc='docks'");
await seedCh(runt.id, "respect=100, cash=100000, energy=200, ammo=100, muscle=600, speed=600, safe_until=NULL, hosp_until=NULL, jail_until=NULL, loc='docks'");
const aidOf = async (id) => (await pool.query(`SELECT account_id a FROM characters WHERE id='${id}'`)).rows[0].a;
const freightOf = async (id, col) => Number((await pool.query(`SELECT ${col} v FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`)).rows[0].v);

// (A) THE RIG — level gate, ledgered sink, one per char, upgrades (absolute writes), maxed, no_rig
assert.equal((await call('POST', '/v1/convoy/rig/box', { token: runt.token })).body.error, 'level', 'the Box Truck is level-gated');
assert.equal((await call('POST', '/v1/convoy/rig/upgrade', { token: bo.token, body: { track: 'armor' } })).body.error, 'no_rig', 'no rig to upgrade');
r = await call('POST', '/v1/convoy/rig/box', { token: rick.token });
assert.equal(r.code, 200, `bought the box: ${JSON.stringify(r.body)}`); assert.equal(r.body.rig, 'box');
assert.equal((await call('POST', '/v1/convoy/rig/van', { token: rick.token })).body.error, 'already', 'one rig per man');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='convoy:rig' AND character_id='${rick.id}'`)).rows[0].s) < 0, 'convoy:rig is a ledgered cash sink');
r = await call('POST', '/v1/convoy/rig/upgrade', { token: rick.token, body: { track: 'armor' } });
assert.equal(r.code, 200); assert.equal(r.body.level, 1, 'armor → level 1 (absolute write)');
assert.equal((await call('POST', '/v1/convoy/rig/upgrade', { token: rick.token, body: { track: 'engine' } })).body.level, 1, 'engine track independent');
assert(Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='convoy:rig:up' AND character_id='${rick.id}'`)).rows[0].s) < 0, 'convoy:rig:up ledgered');
for (let i = 1; i < CONVOY.RIG_UPGRADE_MAX; i++) await call('POST', '/v1/convoy/rig/upgrade', { token: rick.token, body: { track: 'armor' } });
assert.equal((await call('POST', '/v1/convoy/rig/upgrade', { token: rick.token, body: { track: 'armor' } })).body.error, 'maxed', 'armor caps at RIG_UPGRADE_MAX');
let cbR = (await call('GET', '/v1/convoys', { token: rick.token })).body;
assert.equal(cbR.rig.kind, 'box', 'the board surfaces the rig'); assert.equal(cbR.rig.armorLvl, CONVOY.RIG_UPGRADE_MAX, 'armor maxed on the board');

// (B) THE TEAMSTER legend — a clean collect banks freight_delivered (+ a haul row); the RIG armor rides depart
await call('POST', '/v1/goods/buy', { token: rick.token, body: { goodId: 'gin', qty: 10 } });
r = await call('POST', '/v1/convoy', { token: rick.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
const rcid = r.body.id;
r = await call('POST', '/v1/convoy/depart', { token: rick.token, body: { guards: 'crew' } });
assert.equal(r.code, 200, 'rick departed');
const departedGuards = Number((await pool.query(`SELECT guards FROM convoys WHERE id='${rcid}'`)).rows[0].guards);
assert(departedGuards > CONVOY.GUARD_TIERS.find((g) => g.id === 'crew').def, 'the rig armor folded into the convoy guard defense at depart');
await pool.query(`UPDATE convoys SET arrives_at = now() - interval '1 minute' WHERE id='${rcid}'`);
await seedCh(rick.id, "loc='neon'");
r = await call('POST', `/v1/convoy/${rcid}/collect`, { token: rick.token });
assert.equal(r.code, 200, `rick collected: ${JSON.stringify(r.body)}`);
assert(await freightOf(rick.id, 'freight_delivered') > 0, 'THE TEAMSTER: clean freight banked to the legend');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM convoy_hauls WHERE account_id='${await aidOf(rick.id)}' AND kind='deliver'`)).rows[0].n), 1, 'a deliver haul was logged');

// (C) THE HIGHWAYMAN legend — a win ambush banks freight_hijacked; a sub-floor bandit banks NOTHING
await seedCh(rick.id, "loc='docks'");
await call('POST', '/v1/goods/buy', { token: rick.token, body: { goodId: 'gin', qty: 10 } });
r = await call('POST', '/v1/convoy', { token: rick.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
const hcid = r.body.id;
await call('POST', '/v1/convoy/depart', { token: rick.token, body: { guards: 'none' } });
r = await call('POST', `/v1/convoy/${hcid}/ambush`, { token: bo.token });
assert.equal(r.body.win, true, 'Bo overwhelms the unguarded run');
assert(await freightOf(bo.id, 'freight_hijacked') > 0, 'THE HIGHWAYMAN: the take banked to the legend');
// the runt wins too but is below LEGEND_MIN_LVL → banks nothing
await pool.query(`UPDATE convoys SET status='done' WHERE id='${hcid}'`); // free rick's shipper slot (the hijacked run stays in transit otherwise)
await seedCh(rick.id, "loc='docks'");
await call('POST', '/v1/goods/buy', { token: rick.token, body: { goodId: 'gin', qty: 10 } });
r = await call('POST', '/v1/convoy', { token: rick.token, body: { to: 'canal', goodId: 'gin', qty: 10 } });
await call('POST', '/v1/convoy/depart', { token: rick.token, body: { guards: 'none' } });
r = await call('POST', `/v1/convoy/${r.body.id}/ambush`, { token: runt.token });
assert.equal(r.body.win, true, 'the runt wins the fight');
assert.equal(await freightOf(runt.id, 'freight_hijacked'), 0, 'a sub-floor bandit banks NOTHING (anti-Sybil floor)');

// (D) THE BOARDS — the two leaderboards + the read-derived weekly contest
r = await call('GET', '/v1/leaderboard/convoy', { token: rick.token });
assert.equal(r.code, 200);
assert(r.body.teamsters.some((x) => x.name === 'Rig Rick'), 'Rick tops the Teamsters');
assert(r.body.highwaymen.some((x) => x.name === 'Bandit Bo'), 'Bo is a Highwayman');
cbR = (await call('GET', '/v1/convoys', { token: rick.token })).body;
assert(cbR.teamsterOfWeek && cbR.teamsterOfWeek.name === 'Rig Rick', 'the read-derived Teamster of the Week');
assert(cbR.roadBoss && cbR.roadBoss.name === 'Bandit Bo', 'the read-derived Road Boss');

// (E) the worker sweep drops stale haul rows; a fresh one is kept
await pool.query(`INSERT INTO convoy_hauls (id, account_id, kind, value, at) VALUES ('stale-haul', '${await aidOf(bo.id)}', 'hijack', 1, now() - interval '9 days')`);
await sweepConvoyHauls(pool);
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM convoy_hauls WHERE id='stale-haul'`)).rows[0].n), 0, 'the stale haul was swept');
assert(Number((await pool.query(`SELECT COUNT(*) n FROM convoy_hauls WHERE account_id='${await aidOf(rick.id)}'`)).rows[0].n) >= 1, 'the fresh deliver haul survives');

// (F) DEATH — the rig dies with the street; the freight legend SURVIVES
const rickDelivered = await freightOf(rick.id, 'freight_delivered');
await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: rick.id } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM rigs WHERE character_id='${rick.id}'`)).rows[0].n), 0, 'the rig is wiped by the estate');
assert.equal(await freightOf(rick.id, 'freight_delivered'), rickDelivered, 'the Teamster legend survives death (account-level)');

// ════════════════════ TIER C — ROUTE NOTORIETY + THE HAULER'S REPUTATION ════════════════════
// running the SAME land lane heats it (bandits case it → the convoy departs with weaker guards); reputation
// from THE TEAMSTER legend manages it (faster decay / lower gain) + a destination-toll break. EMISSION-SAFE
// (an ambush is a pure ownership transfer, not a §10.4 faucet — only WHO holds the same bounded haul changes).
const tc = await mk('Trucker Tim'); await seedCh(tc.id, "respect=400, cash=8000000, loc='docks'");
await pool.query(`DELETE FROM route_notoriety WHERE character_id='${tc.id}'`);
const depart = async (to) => {
  await seedCh(tc.id, "loc='docks'");
  await call('POST', '/v1/goods/buy', { token: tc.token, body: { goodId: 'gin', qty: 10 } });
  const o = (await call('POST', '/v1/convoy', { token: tc.token, body: { to, goodId: 'gin', qty: 10 } })).body;
  const d = (await call('POST', '/v1/convoy/depart', { token: tc.token, body: { guards: 'heavy' } })).body;
  await pool.query(`UPDATE convoys SET status='done' WHERE id='${o.id}'`); // free the shipper slot for the next depart
  return { id: o.id, ...d };
};
const d1 = await depart('neon');
assert.equal(d1.notoriety, 0, 'a fresh lane departs cold — the first run faces no notoriety');
assert.equal(d1.guardCut, 0, 'no guard cut on a cold lane');
const d2 = await depart('neon');
assert(d2.notoriety > d1.notoriety, 'the SAME lane heats up — the second run faces notoriety');
assert(d2.guardCut > 0, 'a hot lane departs with WEAKER guards (bandits have it cased)');
const g2 = Number((await pool.query(`SELECT guards FROM convoys WHERE id='${d2.id}'`)).rows[0].guards);
assert(g2 < CONVOY.GUARD_TIERS.find((t) => t.id === 'heavy').def, 'the hot-lane convoy stored reduced guard defense');
const d3 = await depart('neon');
assert(d3.notoriety > d2.notoriety && d3.guardCut >= d2.guardCut, 'hammering the lane keeps climbing');
// a DIFFERENT lane starts cold — the incentive to rotate routes
assert.equal((await depart('canal')).notoriety, 0, 'a different lane is cold — vary your lanes to stay cool');

// THE HAULER'S REPUTATION — rep T2 (Dispatcher rank, ≥$2M delivered): the destination toll is HALVED
const tcAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${tc.id}'`)).rows[0].a;
await pool.query(`UPDATE account_persistent SET freight_delivered=2500000 WHERE account_id='${tcAcct}'`); // Dispatcher rank → rep tier 2
const tollBoss = await mk('Toll Boss'); await seedCh(tollBoss.id, "respect=800, cash=100000, loc='docks'");
await call('POST', '/v1/gangs', { token: tollBoss.token, body: { name: 'Neon Kings', tag: 'NK' } });
const ngid = (await pool.query(`SELECT id FROM gangs WHERE name='Neon Kings'`)).rows[0].id;
await pool.query(`UPDATE districts SET holder_gang='${ngid}' WHERE id='neon'`);
await seedCh(tc.id, "loc='docks'");
await call('POST', '/v1/goods/buy', { token: tc.token, body: { goodId: 'gin', qty: 10 } });
const to2 = (await call('POST', '/v1/convoy', { token: tc.token, body: { to: 'neon', goodId: 'gin', qty: 10 } })).body;
await call('POST', '/v1/convoy/depart', { token: tc.token, body: { guards: 'heavy' } });
await pool.query(`UPDATE convoys SET arrives_at = now() - interval '1 minute' WHERE id='${to2.id}'`); // arrive it
await seedCh(tc.id, "loc='neon'");
const col = (await call('POST', `/v1/convoy/${to2.id}/collect`, { token: tc.token })).body;
const cv2 = goodPriceOf('gin', 'neon') * col.collected;
const fullToll = Math.floor(cv2 * CONVOY.TOLL_BPS / 10000);
assert.equal(col.toll, Math.floor(cv2 * CONVOY.TOLL_BPS / 10000 * NOTORIETY.REP_TOLL_MULT), 'a Dispatcher-rank hauler (rep T2) is tolled at HALF (the reputation transfer break)');
assert(col.toll > 0 && col.toll < fullToll, 'the reputation toll break is a real discount');
// the board surfaces the reputation + the active shipment's lane heat
await seedCh(tc.id, "loc='docks'");
await call('POST', '/v1/goods/buy', { token: tc.token, body: { goodId: 'gin', qty: 10 } });
await call('POST', '/v1/convoy', { token: tc.token, body: { to: 'neon', goodId: 'gin', qty: 10 } });
await call('POST', '/v1/convoy/depart', { token: tc.token, body: { guards: 'heavy' } });
const cbTC = (await call('GET', '/v1/convoys', { token: tc.token })).body;
assert(cbTC.reputation && cbTC.reputation.tollBreak && cbTC.reputation.coolsFaster, 'the board surfaces the hauler reputation perks');
assert(cbTC.mine && cbTC.mine.notoriety > 0, 'the active shipment shows the lane heat');

// ── §10.4: the vocabulary knows the convoy reasons (cash + ammo) ──
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `convoy:* is enumerated (${JSON.stringify(vocab.unknown || [])})`);
// the reputation toll is a TRANSFER (a discounted convoy:toll) — the gang-treasuries check reconciles
const treC = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'gang treasuries');
assert(treC.ok, `the discounted convoy:toll transfer reconciles the treasury (drift ${treC.drift})`);

console.log('✅ Convoy test passed — bulk loading beyond the trunk, guard-fee sink ledgered, band-only road board, ambush gates (own/family/safehouse/once/spent), deterministic hijack (trunk-capped transfer, remainder rolls on, shipper notified), deterministic repel (hospital, freight untouched), arrival + at-destination collect + STEP TWO: destination toll (treasury credit, §10.4 exact), degrading multi-ambush (per-character once, 3-cap, wear in the audit), insured freight (premium → pool, pool-capped claim, §10.4 pool check), vocabulary; STEP THREE: NPC TRUCKING (the worker tops the road to TARGET unmarked trucks, no over-spawn, an NPC truck on the public board, a deterministic hijack landing goods in the raider trunk with no owner to notify, and an arrived NPC convoy despawning with its cargo — no faucet on a delivered truck)');
await app.close();
