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
import { sweepGrandPrix } from '../src/races.js';
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
await pool.query(`UPDATE characters SET respect=9000, speed=200 WHERE id='${racer.id}'`); // level 30 — every tier open
await pool.query(`UPDATE characters SET respect=9000, speed=5 WHERE id='${rival.id}'`);
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

// ── AUDIT LOW-1: the WINNER is cooled down too (an owner can't be fed WHEEL wins by alt challengers) ──
process.env.RACE_CD_MS = '3600000'; // a real 1h cooldown for this one race
const champ = await mk('Champ Owner'); const chump = await mk('Chump Challenger');
await pool.query(`UPDATE characters SET respect=9000, speed=200 WHERE id='${champ.id}'`); // strong wheelman
await pool.query(`UPDATE characters SET respect=9000, speed=5 WHERE id='${chump.id}'`);   // weak
await seedCash(champ.id, 200000); await seedCash(chump.id, 200000);
const champCar = await mkCar(champ.id, 'pigeon', 'stock', 0); // power ~144
await mkCar(chump.id, 'junker', 'stock', 0);
await call('POST', `/v1/races/list/${champCar}`, { token: champ.token, body: { limit: 50000 } });
const chumpCar = (await pool.query(`SELECT id FROM cars WHERE character_id='${chump.id}'`)).rows[0].id;
r = await call('POST', `/v1/races/challenge/${champ.id}`, { token: chump.token, body: { myCar: chumpCar, theirCar: champCar, wager: 20000 } });
assert.equal(r.body.win, false, 'the weak challenger loses to the strong owner');
assert((await pool.query(`SELECT race_at FROM characters WHERE id='${champ.id}' AND race_at > now()`)).rows.length === 1, 'the WINNING OWNER is cooled down (LOW-1: no throttle-free WHEEL farming)');
assert((await pool.query(`SELECT race_at FROM characters WHERE id='${chump.id}' AND race_at > now()`)).rows.length === 1, 'the challenger is cooled down too');

// ── F-MED1: a WHEEL win against a SUB-FLOOR (rookie) loser earns NO credit — the anti-Sybil level floor ──
const wheelWins = async () => Number((await pool.query(`SELECT race_wins FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${champ.id}')`)).rows[0].race_wins);
const winsBefore = await wheelWins();
const rkRacer = await mk('Rookie Racer');
await pool.query(`UPDATE characters SET respect=250, speed=5 WHERE id='${rkRacer.id}'`); // level ~6, below WHEEL_MIN_LVL (10)
await seedCash(rkRacer.id, 200000);
await mkCar(rkRacer.id, 'junker', 'stock', 0);
const rkCar = (await pool.query(`SELECT id FROM cars WHERE character_id='${rkRacer.id}'`)).rows[0].id;
const rr = await call('POST', `/v1/races/challenge/${champ.id}`, { token: rkRacer.token, body: { myCar: rkCar, theirCar: champCar, wager: 20000 } });
assert.equal(rr.body.win, false, 'the rookie loses to the strong owner');
assert.equal(await wheelWins(), winsBefore, 'a win over a sub-level-floor loser earns NO WHEEL credit (F-MED1 anti-Sybil)');
process.env.RACE_CD_MS = '0'; // restore for the rest of the suite

// ── STEP TWO — NITROUS: buy a charge (a cash sink, capped), spend one on a race for a power bump ──
const nosPre = (await meOf(racer.token)).cash;
r = await call('POST', `/v1/races/nos/${myCar}`, { token: racer.token });
assert.equal(r.code, 200, 'a nitrous charge bought'); assert.equal(r.body.nos, 1, 'one charge on the car'); assert.equal(r.body.spent, RACES.NOS_COST, 'the charge cost cash');
assert.equal((await meOf(racer.token)).cash, nosPre - RACES.NOS_COST, 'the NOS burned cash (a §10.4 sink)');
assert(board = (await call('GET', '/v1/races', { token: racer.token })).body, 'board reads');
assert.equal(board.cars.find((c) => c.id === myCar).nos, 1, 'the board surfaces the NOS charge');
// fill to the cap, then refuse
for (let i = 1; i < RACES.NOS_MAX; i++) await call('POST', `/v1/races/nos/${myCar}`, { token: racer.token });
assert.equal((await call('POST', `/v1/races/nos/${myCar}`, { token: racer.token })).body.error, 'maxed', `NOS caps at ${RACES.NOS_MAX}`);
// spend one on a PvE race — a charge is consumed win/lose
const nosCarPre = (await pool.query(`SELECT nos FROM cars WHERE id='${myCar}'`)).rows[0].nos;
r = await call('POST', '/v1/races/npc', { token: racer.token, body: { car: myCar, tier: 'backalley', nos: true } });
assert.equal(r.code, 200, 'the nitrous run runs'); assert.equal(r.body.nos, true, 'the response flags the NOS burn');
assert.equal((await pool.query(`SELECT nos FROM cars WHERE id='${myCar}'`)).rows[0].nos, nosCarPre - 1, 'one charge consumed (win or lose)');

// ── STEP TWO — PINK SLIPS: race for the car itself (a §10.4-neutral ownership transfer) ──
// a fresh pair — the shark (monster) vs the mark (junker); the mark puts his junker up for pinks
const shark = await mk('Pink Shark'); const mark = await mk('Pinkslip Mark');
await pool.query(`UPDATE characters SET respect=9000, speed=200 WHERE id='${shark.id}'`);
await pool.query(`UPDATE characters SET respect=9000, speed=5 WHERE id='${mark.id}'`);
await seedCash(shark.id, 100000); await seedCash(mark.id, 100000);
const sharkCar = await mkCar(shark.id, 'pigeon', 'stock', 0);
const markCar = await mkCar(mark.id, 'junker', 'stock', 0);
const carsBefore = Number((await pool.query('SELECT COUNT(*) s FROM cars')).rows[0].s); // car conservation baseline (both cars now exist)
// gate: can't race for pinks a car that isn't offered
assert.equal((await call('POST', `/v1/races/pinks/${mark.id}`, { token: shark.token, body: { myCar: sharkCar, theirCar: markCar } })).body.error, 'not_offered', "can't take a car that isn't up for pinks");
// the mark offers his junker for pinks (consent-by-listing)
r = await call('POST', `/v1/races/pinkslip/${markCar}`, { token: mark.token, body: { on: true } });
assert.equal(r.code, 200, 'the junker is up for pinks'); assert.equal(r.body.pinkSlip, true, 'flagged for pinks');
assert((await call('GET', '/v1/races', { token: shark.token })).body.strip.find((s) => s.carId === markCar && s.forPinks), 'the strip shows the pink-slip car');
// the shark wins the pink-slip race → TAKES the mark's junker (ownership transfer)
r = await call('POST', `/v1/races/pinks/${mark.id}`, { token: shark.token, body: { myCar: sharkCar, theirCar: markCar } });
assert.equal(r.code, 200, 'the pink-slip race runs'); assert.equal(r.body.win, true, 'the monster takes the pinks');
assert.equal(r.body.forPinks, true, 'flagged a pink-slip race'); assert.equal(r.body.wonCar.id, markCar, "won the mark's car");
assert.equal((await pool.query(`SELECT character_id FROM cars WHERE id='${markCar}'`)).rows[0].character_id, shark.id, "the mark's junker changed hands to the shark");
assert.equal((await pool.query(`SELECT pink_slip FROM cars WHERE id='${markCar}'`)).rows[0].pink_slip, false, 'the pink-slip flag cleared on transfer');
// THE TRADES — a pinks race is seat time like any race: the challenger schooled Wheels
const pinkXp = (await pool.query(`SELECT xp FROM masteries WHERE character_id='${shark.id ?? shark}' AND track_id='wheels'`)).rows[0];
assert(pinkXp && Number(pinkXp.xp) > 0, 'the pink-slip race paid wheels mastery XP (the raceNpc/raceChallenge hook)');
assert.equal(Number((await pool.query('SELECT COUNT(*) s FROM cars')).rows[0].s), carsBefore, 'car conservation holds — a pink-slip win moves a car, never mints one');
// no cash moved (a pink-slip race is pure ownership — no wager, no ledger)
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='race:pink'")).rows[0].s), 0, 'no race:pink ledger row — cars transfer by ownership, §10.4-neutral');
// the shark now has two cars; the mark has none
assert.equal(Number((await pool.query(`SELECT COUNT(*) s FROM cars WHERE character_id='${shark.id}'`)).rows[0].s), 2, 'the shark holds both cars');
assert.equal(Number((await pool.query(`SELECT COUNT(*) s FROM cars WHERE character_id='${mark.id}'`)).rows[0].s), 0, 'the mark walks home');

// ── RED-TEAM (step-two consent bypass): a car listed for a wager/pinks, then SOLD on the market, must
// arrive at the BUYER with the race flags CLEARED — else it's on the strip (raceable / cash-exposed)
// without the new owner's consent. The four ownership-transfer sites now reset race_limit + pink_slip. ──
const seller = await mk('Flag Seller'); const buyer = await mk('Clean Buyer');
await pool.query(`UPDATE characters SET respect=9000 WHERE id='${seller.id}'`);
await pool.query(`UPDATE characters SET respect=9000 WHERE id='${buyer.id}'`);
await seedCash(seller.id, 200000); await seedCash(buyer.id, 200000);
const flagCar = await mkCar(seller.id, 'pigeon', 'stock', 0);
// the seller flags it for a $50k wager AND for pinks, THEN lists it on the Black Market with a buy-now
await call('POST', `/v1/races/list/${flagCar}`, { token: seller.token, body: { limit: 50000 } });
await call('POST', `/v1/races/pinkslip/${flagCar}`, { token: seller.token, body: { on: true } });
assert.equal((await pool.query(`SELECT race_limit, pink_slip FROM cars WHERE id='${flagCar}'`)).rows[0].pink_slip, true, 'the car is flagged for pinks pre-sale');
const ml = await call('POST', '/v1/market', { token: seller.token, body: { carId: flagCar, minBid: 5000, buyNow: 20000 } });
assert.equal(ml.code, 200, 'the flagged car lists on the market'); const listingId = ml.body.id;
r = await call('POST', `/v1/market/${listingId}/buy`, { token: buyer.token });
assert.equal(r.code, 200, 'the buyer buys it now');
const bought = (await pool.query(`SELECT character_id, race_limit, pink_slip FROM cars WHERE id='${flagCar}'`)).rows[0];
assert.equal(bought.character_id, buyer.id, 'the car changed hands');
assert.equal(bought.race_limit, null, 'the wager listing was CLEARED on transfer (no unconsented cash exposure)');
assert.equal(bought.pink_slip, false, 'the pink-slip flag was CLEARED on transfer (no unconsented car loss)');
assert(!(await call('GET', '/v1/races', { token: seller.token })).body.strip.find((s) => s.carId === flagCar), "the sold car is off the strip — the buyer must opt in themselves");

// ── STEP THREE — THE GRAND PRIX (a scheduled cash parimutuel; the poker-tournament twin) ──
process.env.GRAND_PRIX_MS = '3600000'; // a 1h window so the whole grid can enter before it runs
const GP = RACES.GP;
const gpSum = async (reason) => Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='${reason}'`)).rows[0].s);
// four drivers (level 30), each with a car; one will die before the flag drops
const gpd = [];
for (let i = 0; i < 4; i++) {
  const d = await mk(`GP Driver ${i}`);
  await pool.query(`UPDATE characters SET respect=9000, speed=${200 - i * 30} WHERE id='${d.id}'`);
  await seedCash(d.id, 200000);
  gpd.push({ ...d, car: await mkCar(d.id, 'pigeon', 'stock', 0) });
}
// gates: a rookie is under the level floor; you must enter with a car you own
const gpRk = await mk('GP Rookie'); await pool.query(`UPDATE characters SET respect=250 WHERE id='${gpRk.id}'`); await seedCash(gpRk.id, 200000);
const gpRkCar = await mkCar(gpRk.id, 'junker', 'stock', 0);
assert.equal((await call('POST', '/v1/races/gp', { token: gpRk.token, body: { car: gpRkCar } })).body.error, 'level', `the Grand Prix has a level ${GP.MIN_LEVEL} floor`);
assert.equal((await call('POST', '/v1/races/gp', { token: gpd[0].token, body: { car: 'nope' } })).body.error, 'no_car', 'must enter with a car you own');
// all four buy into the same open grand prix
for (const d of gpd) assert.equal((await call('POST', '/v1/races/gp', { token: d.token, body: { car: d.car } })).code, 200, `${d.id} on the grid`);
assert.equal((await call('POST', '/v1/races/gp', { token: gpd[0].token, body: { car: gpd[0].car } })).body.error, 'entered', 'no double entry');
const gpId = (await pool.query("SELECT id FROM grand_prix WHERE status='open'")).rows[0].id;
assert.equal(Number((await pool.query(`SELECT pool FROM grand_prix WHERE id='${gpId}'`)).rows[0].pool), 4 * GP.BUYIN, 'the pool holds all four buy-ins');
// escrow mid-open: the §10.4 grand-prix-escrow check reconciles
assert((await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'grand prix escrow')?.ok, 'the grand-prix escrow reconciles mid-open');
// one driver's street DIES before the flag — his stake burns at settle
await pool.query(`UPDATE characters SET alive=false WHERE id='${gpd[3].id}'`);
const winPre = await gpSum('race:gp:win'), takePre = -(await gpSum('race:gp:take')), deathPre = -(await gpSum('race:gp:death'));
await pool.query(`UPDATE grand_prix SET resolves_at = now() - interval '1 minute' WHERE id='${gpId}'`);
await sweepGrandPrix(pool);
assert.equal((await pool.query(`SELECT status FROM grand_prix WHERE id='${gpId}'`)).rows[0].status, 'resolved', 'the grand prix settled');
const win2 = await gpSum('race:gp:win') - winPre, take2 = -(await gpSum('race:gp:take')) + takePre, death2 = -(await gpSum('race:gp:death')) + deathPre;
assert.equal(death2, GP.BUYIN, "the dead entrant's stake burned (race:gp:death)");
assert.equal(win2 + take2 + death2, 4 * GP.BUYIN, 'buy-ins == prizes + house take + the dead burn (escrow closes)');
const placed = (await pool.query(`SELECT place FROM grand_prix_entries WHERE gp_id='${gpId}' AND place IS NOT NULL ORDER BY place`)).rows;
assert.equal(placed.length, 3, 'the three LIVE runners were ranked (the dead man is not)');
assert((await pool.query('SELECT current FROM grand_prix_state WHERE id=1')).rows[0].current === null, 'the state cleared for the next race');
assert((await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'grand prix escrow')?.ok, 'the grand-prix escrow holds after settle');
// a SHORT grid (< MIN_ENTRANTS) is refunded, not raced
const sf1 = await mk('Short Grid 1'); const sf2 = await mk('Short Grid 2');
for (const d of [sf1, sf2]) { await pool.query(`UPDATE characters SET respect=9000 WHERE id='${d.id}'`); await seedCash(d.id, 100000); }
await call('POST', '/v1/races/gp', { token: sf1.token, body: { car: await mkCar(sf1.id, 'junker', 'stock', 0) } });
await call('POST', '/v1/races/gp', { token: sf2.token, body: { car: await mkCar(sf2.id, 'junker', 'stock', 0) } });
const sfId = (await pool.query("SELECT id FROM grand_prix WHERE status='open'")).rows[0].id;
const sf1Pre = (await meOf(sf1.token)).cash;
await pool.query(`UPDATE grand_prix SET resolves_at = now() - interval '1 minute' WHERE id='${sfId}'`);
await sweepGrandPrix(pool);
assert.equal((await pool.query(`SELECT status FROM grand_prix WHERE id='${sfId}'`)).rows[0].status, 'refunded', 'a short grid is refunded');
assert.equal((await meOf(sf1.token)).cash, sf1Pre + GP.BUYIN, 'the buy-in was refunded whole');

// ── the leaderboard: THE WHEEL ranks the winningest drivers ──
const lb = (await call('GET', '/v1/leaderboard/races', { token: racer.token })).body;
assert(lb.drivers.find((d) => d.name === 'Speed Demon' && d.wins >= 2), 'the racer ranks on THE WHEEL');

// ── §10.4: every race:* row is character_id'd → the per-character cash check reconciles ──
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `race: rides the cash vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const cashCheck = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, seeded, `the only cash drift is the seeded stake (${seeded}) — every race spend/purse/wager reconciles`);

console.log('✅ Street Races test passed — car power (sqrt value + tune + wheelman speed), the PvE circuit (fee BURNS win/lose + bounded purse on a win, level/tier gates), tuning (cash sink + power gain + the cap), PvP wager races (the casino:pvp taxed transfer — winner nets wager minus rake, half to the street tax, the loser car damaged; self/min/max/not_listed/limit gates), THE WHEEL legend + the leaderboard; STEP TWO: NITROUS (a per-car cash-sink charge, capped, consumed win/lose for a power bump) and PINK SLIPS (race for the car itself — the winner TAKES the loser car, a §10.4-neutral ownership transfer: car conservation holds, no ledger row, no cash moves); STEP THREE: THE GRAND PRIX (a scheduled cash parimutuel — the poker-tournament twin: buy-in escrow, level/no-car/double-entry gates, a full grid settled by the worker with a dead entrant\'s stake burned + the top places splitting net of rake, a short grid refunded, and the new grand-prix-escrow §10.4 check), and section 10.4 (race: vocabulary + the per-character cash check reconciles — drift equals the seeded stake only)');
await app.close();
