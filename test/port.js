// THE PORT test — maritime smuggling (boats + runs + the Coast Guard). Proves: buy/sell boats (cash
// sink/faucet + gates), launch a run (contraband sourcing sink + gates: level/route/too-slow/busy/
// safehouse/supply-cap), the lazy collect (CLEAN → the port:sale faucet + net margin; INTERDICTED → seize
// + the port:fine sink + heat + boat sink), the daily SUPPLY CAP, boats die with the street, and §10.4
// (every port:* row is character_id'd → the per-character cash check reconciles; drift == the seeded cash).
process.env.PORT_RUN_MS = '0'; // TEST-ONLY: runs arrive instantly
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { PORT, boatOf, boatResale } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

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
  return { token, id: (await meOf(token)).id };
};
let seeded = 0;
const seedCash = async (id, amt) => { await pool.query(`UPDATE characters SET cash = cash + ${amt} WHERE id='${id}'`); seeded += amt; };
const cashOf = async (t) => (await meOf(t)).cash;

const cap = await mk('Captain Nemo');
await pool.query(`UPDATE characters SET respect=6000, loc='docks' WHERE id='${cap.id}'`); // level ~38 — every route open
await seedCash(cap.id, 6000000);

// ── buy a boat: cash sink + gates ──
assert.equal((await call('POST', '/v1/port/boat/dreadnought', { token: cap.token })).body.error, 'bad_boat', 'no such vessel');
const rookie = await mk('Landlubber Larry'); await pool.query(`UPDATE characters SET loc='docks' WHERE id='${rookie.id}'`); await seedCash(rookie.id, 100000);
assert.equal((await call('POST', '/v1/port/boat/dinghy', { token: rookie.token })).body.error, 'level', 'the harbormaster deals with made men');
await pool.query(`UPDATE characters SET loc='neon' WHERE id='${cap.id}'`);
assert.equal((await call('POST', '/v1/port/boat/cutter', { token: cap.token })).body.error, 'district', 'boats are bought at the docks');
await pool.query(`UPDATE characters SET loc='docks' WHERE id='${cap.id}'`);
const preBuy = await cashOf(cap.token);
let r = await call('POST', '/v1/port/boat/cutter', { token: cap.token });
assert.equal(r.code, 200, 'bought the cutter'); const cutter = r.body.boat.id;
assert.equal(await cashOf(cap.token), preBuy - boatOf('cutter').cost, 'cash paid for the boat (port:boat sink)');

// ── launch a CLEAN run: the contraband sourcing sink + the arrival faucet ──
process.env.PORT_INTERDICT_P = '0'; // never caught
// gates first
assert.equal((await call('POST', `/v1/port/run/${cutter}`, { token: cap.token, body: { route: 'nowhere' } })).body.error, 'bad_route', 'no such route');
const preLaunch = await cashOf(cap.token);
r = await call('POST', `/v1/port/run/${cutter}`, { token: cap.token, body: { route: 'openwater' } });
assert.equal(r.code, 200, 'the run launches'); assert.equal(r.body.hold, boatOf('cutter').hold, 'the full hold is loaded');
const runCost = boatOf('cutter').hold * PORT.ROUTES.find((x) => x.id === 'openwater').buy;
assert.equal(await cashOf(cap.token), preLaunch - runCost, 'the contraband cost was sourced (port:buy sink)');
assert.equal((await call('POST', `/v1/port/run/${cutter}`, { token: cap.token, body: { route: 'coastal' } })).body.error, 'busy', 'she can only run one at a time');
assert.equal((await call('POST', `/v1/port/boat/${cutter}/sell`, { token: cap.token })).body.error, 'at_sea', "can't sell a boat that's out");
// collect — clean arrival, the cargo lands (PORT_RUN_MS=0 → arrived instantly)
const preCollect = await cashOf(cap.token);
r = await call('POST', `/v1/port/collect/${cutter}`, { token: cap.token });
assert.equal(r.code, 200, 'collected'); assert.equal(r.body.interdicted, false, 'slipped the Coast Guard');
const sale = boatOf('cutter').hold * PORT.ROUTES.find((x) => x.id === 'openwater').sell;
assert.equal(r.body.landed, sale, 'the contraband fenced for the route rate (port:sale faucet)');
assert.equal(r.body.net, sale - runCost, 'net = landed − cost (the smuggling margin)');
assert.equal(await cashOf(cap.token), preCollect + sale, 'the landing hit the pocket');

// ── an INTERDICTED run: seize + the fine sink + heat, boat survives (PORT_SINK=0) ──
process.env.PORT_INTERDICT_P = '1'; process.env.PORT_SINK = '0';
await call('POST', `/v1/port/run/${cutter}`, { token: cap.token, body: { route: 'coastal' } });
const coastalCost = boatOf('cutter').hold * PORT.ROUTES.find((x) => x.id === 'coastal').buy;
const heatBefore = (await meOf(cap.token)).heat;
const cashB = await cashOf(cap.token);
r = await call('POST', `/v1/port/collect/${cutter}`, { token: cap.token });
assert.equal(r.body.interdicted, true, 'the Coast Guard was waiting'); assert.equal(r.body.sunk, false, 'the boat made it home');
assert.equal(r.body.fine, Math.floor(coastalCost * PORT.FINE_RATE), 'a fine of FINE_RATE × the cargo cost (port:fine sink)');
assert.equal(await cashOf(cap.token), cashB - r.body.fine, 'the fine came off the top');
assert((await meOf(cap.token)).heat > heatBefore, 'the bust spiked the heat');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM boats WHERE id='${cutter}'`)).rows[0].c), 1, 'the surviving boat is back in the fleet');

// ── the SUPPLY CAP: sourcing past the daily cap is refused ──
await pool.query(`UPDATE characters SET port_used=${PORT.SUPPLY_CAP_DAY - 10000}, port_at=now() WHERE id='${cap.id}'`);
assert.equal((await call('POST', `/v1/port/run/${cutter}`, { token: cap.token, body: { route: 'deeprun' } })).body.error, 'supply', 'the offshore supplier is tapped out for the day');
await pool.query(`UPDATE characters SET port_used=0 WHERE id='${cap.id}'`);

// ── too-slow gate: a dinghy can't attempt Open Water ──
const dinghy = (await call('POST', '/v1/port/boat/dinghy', { token: cap.token })).body.boat.id;
assert.equal((await call('POST', `/v1/port/run/${dinghy}`, { token: cap.token, body: { route: 'openwater' } })).body.error, 'too_slow', 'the Open Water needs a faster boat');
// safehouse blocks a run (P1.3)
await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${cap.id}'`);
assert.equal((await call('POST', `/v1/port/run/${dinghy}`, { token: cap.token, body: { route: 'coastal' } })).body.error, 'safe', 'no running contraband from the bunker');
await pool.query(`UPDATE characters SET safe_until=NULL WHERE id='${cap.id}'`);

// ── the boat SINKS on a bust (PORT_SINK=1) ──
process.env.PORT_INTERDICT_P = '1'; process.env.PORT_SINK = '1';
await call('POST', `/v1/port/run/${dinghy}`, { token: cap.token, body: { route: 'coastal' } });
r = await call('POST', `/v1/port/collect/${dinghy}`, { token: cap.token });
assert.equal(r.body.sunk, true, 'the Coast Guard sank her');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM boats WHERE id='${dinghy}'`)).rows[0].c), 0, 'the boat is gone (impounded/sunk)');
delete process.env.PORT_INTERDICT_P; delete process.env.PORT_SINK;

// ── sell a boat back to the yard (a fraction of cost) ──
const skiff = (await call('POST', '/v1/port/boat/skiff', { token: cap.token })).body.boat.id;
const preSell = await cashOf(cap.token);
r = await call('POST', `/v1/port/boat/${skiff}/sell`, { token: cap.token });
assert.equal(r.body.refund, boatResale('skiff'), 'sold back at the resale fraction (port:sell)');
assert.equal(await cashOf(cap.token), preSell + boatResale('skiff'), 'the resale hit the pocket');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM boats WHERE id='${skiff}'`)).rows[0].c), 0, 'the boat left the fleet');

// ── the harbor board ──
const board = (await call('GET', '/v1/port', { token: cap.token })).body;
assert(board.catalog.length === PORT.BOATS.length && board.routes.length === PORT.ROUTES.length, 'the yard + charts are published');
assert(board.fleet.find((b) => b.id === cutter), 'the fleet shows the cutter');
assert(typeof board.supplyLeft === 'number', 'the supplier headroom is shown');

// ── boats die with the street ──
process.env.MOD_KEY = 'test-mod-key';
const app2ok = await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: cap.id } });
assert.equal(app2ok.statusCode, 200, 'the captain sleeps with the fishes');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM boats WHERE character_id='${cap.id}'`)).rows[0].c), 0, 'the fleet died with the street');

// ── §10.4: every port:* row is character_id'd → the per-character cash check reconciles ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `port: rides the cash vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, seeded, `the only cash drift is the seeded stake (${seeded}) — every port spend/sale/fine reconciles`);

console.log('✅ The Port test passed — buy/sell boats (cash sink/faucet + bad-boat/level/district/at-sea gates), the RUN (contraband sourcing sink + bad-route/busy/too-slow/safehouse/supply-cap gates), the lazy COLLECT (clean → port:sale faucet + net margin; interdicted → seize + port:fine sink + heat + boat survives/sinks), the daily SUPPLY CAP, the harbor board, boats DIE WITH THE STREET, and section 10.4 (port: vocabulary + the per-character cash check reconciles — drift equals the seeded stake only)');
await app.close();
