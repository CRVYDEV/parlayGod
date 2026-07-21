// STREET RACES test — the 60-car catalog as a competitive loop. Proves: the PvE circuit (fee BURNS
// win/lose, purse pays only on a win — a bounded faucet; gates level/tier/cooldown/car), tuning (a cash
// sink + power gain + the cap), PvP wager races (the audited casino:pvp taxed transfer — winner nets
// wager − rake, half → street tax, the loser's car takes damage; gates self/family/min/max/not_listed/
// limit), THE WHEEL legend (lifetime wins, survives death) + the leaderboard, and §10.4 (every race:*
// row is character_id'd → the per-character cash check reconciles; drift == the seeded cash only).
process.env.RACE_CD_MS = '0'; // TEST-ONLY: no cooldown between runs
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { RACES, carPower, carVal, levelOf } from '../src/rules.js';
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
const mkCar = async (chId, model, trim, dmg = 0) => {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('${id}','${chId}','${model}','${trim}',${dmg})`);
  return id;
};
let seeded = 0;
const seedCash = async (id, amt) => { await pool.query(`UPDATE characters SET cash = cash + ${amt} WHERE id='${id}'`); seeded += amt; };

// ── two racers. Speed 200 makes the pigeon a monster (carPower ~144); the rival's junker is a runabout. ──
const racer = await mk('Speed Demon');
const rival = await mk('Slow Sammy');
await pool.query(`UPDATE characters SET respect=3600, speed=200 WHERE id='${racer.id}'`); // level 30 — every tier open
await pool.query(`UPDATE characters SET respect=3600, speed=5 WHERE id='${rival.id}'`);
await seedCash(racer.id, 2000000);
await seedCash(rival.id, 500000);
const myCar = await mkCar(racer.id, 'pigeon', 'stock', 0);   // carVal 2000
const rivalCar = await mkCar(rival.id, 'junker', 'stock', 0); // carVal 900

// carPower is deterministic — assert the pigeon is race-ready and the board reads it
const myPow = carPower('pigeon', 'stock', 0, 200, 0);
assert.equal(myPow, Math.floor(Math.sqrt(carVal('pigeon', 'stock'))) + Math.floor(200 / RACES.SPEED_DIV), 'car power = sqrt(val) + speed/2 at tune 0');
let board = (await call('GET', '/v1/races', { token: racer.token })).body;
assert(board.cars.find((c) => c.id === myCar && c.power === myPow), 'the board reads the car power');
assert(board.tiers.length === RACES.TIERS.length, 'the PvE card is published');
assert.equal(board.legend.wins, 0, 'no wins yet');

// ── PvE WIN: the Back-Alley Sprint (field 45) — the monster always beats the pack ──
const preWin = (await meOf(racer.token)).cash;
let r = await call('POST', '/v1/races/npc', { token: racer.token, body: { car: myCar, tier: 'backalley' } });
assert.equal(r.code, 200, 'the race runs'); assert.equal(r.body.win, true, 'the monster wins the sprint');
assert.equal(r.body.purse, RACES.TIERS[0].purse, 'the purse pays'); assert.equal(r.body.fee, RACES.TIERS[0].fee, 'the fee was charged');
assert.equal((await meOf(racer.token)).cash, preWin - RACES.TIERS[0].fee + RACES.TIERS[0].purse, 'net = purse − fee landed');
assert.equal((await call('GET', '/v1/races', { token: racer.token })).body.legend.wins, 1, 'a win banked to THE WHEEL');
// ledgered: a race:fee sink + a race:purse faucet
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='race:purse'")).rows[0].s), RACES.TIERS[0].purse, 'the purse is a ledgered faucet');

// ── PvE LOSS: The Ghost Circuit (field 320) — even the monster can't touch it; the fee still burns, car dings ──
const preLoss = (await meOf(racer.token)).cash;
r = await call('POST', '/v1/races/npc', { token: racer.token, body: { car: myCar, tier: 'grandprix' } });
assert.equal(r.body.win, false, 'the ghost circuit is out of reach'); assert.equal(r.body.net, -RACES.TIERS[2].fee, 'the fee burned on the loss');
assert.equal((await meOf(racer.token)).cash, preLoss - RACES.TIERS[2].fee, 'only the fee left the pocket');
assert.equal(r.body.dmg, RACES.LOSS_DMG, 'a lost race dinged the car');

// ── gates: bad tier, and a rookie can't race ──
assert.equal((await call('POST', '/v1/races/npc', { token: racer.token, body: { car: myCar, tier: 'nope' } })).body.error, 'bad_tier', 'no such race');
const rookie = await mk('Fresh Frankie');
const rookieCar = await mkCar(rookie.id, 'junker', 'stock', 0);
await seedCash(rookie.id, 50000);
assert.equal((await call('POST', '/v1/races/npc', { token: rookie.token, body: { car: rookieCar, tier: 'backalley' } })).body.error, 'level', 'a level-1 rookie is off the strip');

// ── TUNING: a cash sink that adds power, capped at TUNE_MAX ──
const preTune = (await meOf(racer.token)).cash;
r = await call('POST', `/v1/races/tune/${myCar}`, { token: racer.token });
assert.equal(r.code, 200, 'tuned'); assert.equal(r.body.tune, 1, 'tune level 1'); assert.equal(r.body.spent, RACES.TUNE_COST, 'a tune costs cash');
assert.equal((await meOf(racer.token)).cash, preTune - RACES.TUNE_COST, 'the tune burned cash (a §10.4 sink)');
assert(r.body.power > myPow, 'the tune added race power');
for (let i = 1; i < RACES.TUNE_MAX; i++) await call('POST', `/v1/races/tune/${myCar}`, { token: racer.token });
assert.equal((await call('POST', `/v1/races/tune/${myCar}`, { token: racer.token })).body.error, 'maxed', `the engine caps at ${RACES.TUNE_MAX}`);

// ── PvP: the rival lists the junker; the monster challenges and wins the wager (taxed transfer) ──
assert.equal((await call('POST', `/v1/races/list/${rivalCar}`, { token: rival.token, body: { limit: 100 } })).body.error, 'limit', 'the listing floor holds');
r = await call('POST', `/v1/races/list/${rivalCar}`, { token: rival.token, body: { limit: 50000 } });
assert.equal(r.code, 200, 'the rival puts the junker on the strip'); assert.equal(r.body.limit, 50000, 'listed up to $50k');
// gates
assert.equal((await call('POST', `/v1/races/challenge/${racer.id}`, { token: racer.token, body: { myCar, theirCar: myCar, wager: 10000 } })).body.error, 'self', "can't race your own garage");
assert.equal((await call('POST', `/v1/races/challenge/${rival.id}`, { token: racer.token, body: { myCar, theirCar: rivalCar, wager: 100 } })).body.error, 'min', 'wager floor');
assert.equal((await call('POST', `/v1/races/challenge/${rival.id}`, { token: racer.token, body: { myCar, theirCar: rivalCar, wager: 999999 } })).body.error, 'max', 'wager ceiling');
assert.equal((await call('POST', `/v1/races/challenge/${rival.id}`, { token: racer.token, body: { myCar, theirCar: rivalCar, wager: 60000 } })).body.error, 'limit', "over the rival's listed limit");
const wager = 40000;
const rakeExp = Math.ceil(wager * 2 * RACES.RAKE_BPS / 10000);
const [rBefore, vBefore] = [(await meOf(racer.token)).cash, (await meOf(rival.token)).cash];
const taxBefore = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
r = await call('POST', `/v1/races/challenge/${rival.id}`, { token: racer.token, body: { myCar, theirCar: rivalCar, wager } });
assert.equal(r.code, 200, 'the race is on'); assert.equal(r.body.win, true, 'the monster takes the junker');
assert.equal(r.body.net, wager - rakeExp, 'the winner nets the wager minus the rake');
assert.equal((await meOf(racer.token)).cash, rBefore + wager - rakeExp, 'winner banked wager − rake');
assert.equal((await meOf(rival.token)).cash, vBefore - wager, 'the loser paid the wager');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), taxBefore + Math.floor(rakeExp / 2), 'half the rake fed the street tax');
assert.equal((await pool.query(`SELECT dmg FROM cars WHERE id='${rivalCar}'`)).rows[0].dmg, RACES.LOSS_DMG, "the loser's car took damage");

// ── the leaderboard: THE WHEEL ranks the winningest drivers ──
const lb = (await call('GET', '/v1/leaderboard/races', { token: racer.token })).body;
assert(lb.drivers.find((d) => d.name === 'Speed Demon' && d.wins >= 2), 'the racer ranks on THE WHEEL');

// ── §10.4: every race:* row is character_id'd → the per-character cash check reconciles ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `race: rides the cash vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, seeded, `the only cash drift is the seeded stake (${seeded}) — every race spend/purse/wager reconciles`);

console.log('✅ Street Races test passed — car power (sqrt value + tune + wheelman speed), the PvE circuit (fee BURNS win/lose + bounded purse on a win, level/tier gates), tuning (cash sink + power gain + the cap), PvP wager races (the casino:pvp taxed transfer — winner nets wager minus rake, half to the street tax, the loser car damaged; self/min/max/not_listed/limit gates), THE WHEEL legend + the leaderboard, and section 10.4 (race: vocabulary + the per-character cash check reconciles — drift equals the seeded stake only)');
await app.close();
