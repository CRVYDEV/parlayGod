// THE LIVING WORLD test — all four phases:
//   P1  the city you can SEE — GET /v1/city forecasts both event tracks a week out, the intraday
//       clock, and per-district weather; the view carries the same at a glance.
//   P3  economic weather — each district's goods price rides a deterministic, mean-neutral daily
//       shock (band-bounded, floor holds, varies by district, stable within a day).
//   P2  NPC rival families — the board (level-gated odds), the raid (bounded loot as a ledgered
//       world:raid faucet + ammo sink, drains the shared reservoir), lazy regen, the rout bonus,
//       and the gates (level/energy/ammo/cooldown). WORLD_RAID_P pins the roll.
//   P4  the day/night clock — patrol hours convict harder (bustProbOf), the small hours favour a raid.
// pg-mem, zero infra. §10.4 vocabulary stays closed (world:raid cash faucet + ammo sink).
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LIVING, WORLD, worldNpcOf, cityHourOf, cityForecast, regionShockOf, cityLawEventOf,
         cityEventOf, goodPriceOf, bustProbOf, priceBlock, dayOf, GOODS, DISTRICTS, hash01, MARKET_SEED } from '../src/rules.js';
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
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const rawCh = async (id) => (await pool.query(`SELECT * FROM characters WHERE id='${id}'`)).rows[0];
const npcStrength = async (npc) => Number((await pool.query(`SELECT strength FROM world_npcs WHERE npc_id='${npc}'`)).rows[0]?.strength ?? null);
const ledgerOf = async (chId, cur, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${chId}' AND currency='${cur}' AND reason='${reason}'`)).rows[0].s);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — the city you can see
// ─────────────────────────────────────────────────────────────────────────────
const alice = await mk('Living Alice');
const city = (await call('GET', '/v1/city')).body;
assert.equal(city.day, dayOf(), 'the board dates itself to today');
assert.equal(city.forecast.length, LIVING.FORECAST_DAYS, 'a 7-day forecast');
assert.equal(city.forecast[0].city, cityEventOf(dayOf()).id, 'the forecast head is today’s city event');
assert.equal(city.forecast[0].law, cityLawEventOf(dayOf()).id, 'the second (law) track is a distinct daily draw');
assert.notEqual(city.event, undefined, 'the city event is published');
assert.equal(city.forecast[1].city, cityEventOf(dayOf() + 1).id, 'the forecast is a pure function of the day — tomorrow is knowable');
assert(city.clock && typeof city.clock.patrol === 'boolean', 'the intraday clock is published');
// the view carries the city at a glance too
const av = await meOf(alice.token);
assert.equal(av.city.event, cityEventOf(dayOf()).id, 'the character view mirrors the city event');
assert.equal(av.city.phase, cityHourOf().phase, 'the view mirrors the clock phase');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — economic weather (regional supply shocks on the price hash)
// ─────────────────────────────────────────────────────────────────────────────
// every district's shock sits inside the mean-neutral band…
for (const d of DISTRICTS) {
  const s = regionShockOf(d.id, dayOf());
  assert(s >= LIVING.REGION_SHOCK_LO && s < LIVING.REGION_SHOCK_HI, `${d.id} shock in band (${s})`);
}
// …and it varies by district (real weather, not a global multiplier)
const shocks = new Set(DISTRICTS.map((d) => Math.round(regionShockOf(d.id, dayOf()) * 1000)));
assert(shocks.size > 1, 'districts have different weather');
// the shock is FOLDED into goodPriceOf (deterministic + floor holds), and the board surfaces it
const blk = priceBlock(), day = Math.floor(blk / 6);
const g = GOODS[0];
const expected = Math.max(10, Math.round(g.base * (0.6 + hash01(`${g.id}:docks:${blk}:${MARKET_SEED}`)) * regionShockOf('docks', day)));
assert.equal(goodPriceOf(g.id, 'docks', blk), expected, 'the price rides the district shock exactly');
assert.equal(city.weather.docks, Math.round(regionShockOf('docks', day) * 1000) / 1000, 'the board weather matches the shock applied to prices');
assert(goodPriceOf(g.id, 'docks', blk) >= 10, 'the price floor still holds under a bust');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — NPC rival families
// ─────────────────────────────────────────────────────────────────────────────
const raider = await mk('Raider Rae');
await seedCh(raider.id, 'respect=2000, muscle=200, speed=100, energy=200, ammo=100, cash=1000');
let board = (await call('GET', '/v1/world', { token: raider.token })).body;
const zappa = board.npcs.find((n) => n.id === 'zappa');
assert.equal(zappa.strengthPct, 100, 'an untouched outfit is at full strength');
assert.equal(zappa.canRaid, true, 'a level-8+ raider can hit the Zappa Crew');
assert(zappa.odds > 0, 'the board shows raid odds');
assert.equal(board.npcs.find((n) => n.id === 'moreau').canRaid, false, 'the cartel is out of a low-level raider’s reach');

// a LANDED raid loots a bounded slice (5% of the reservoir, capped) as a ledgered faucet
process.env.WORLD_RAID_P = '1';
let before = await rawCh(raider.id);
const zStr0 = worldNpcOf('zappa').max; // seeded to max on first touch
let r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.code, 200, 'raid ran');
assert.equal(r.body.success, true, 'the roll lands');
const loot = r.body.loot;
assert.equal(loot, Math.min(Math.floor(zStr0 * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX), 'loot is GRAB_BPS of the reservoir, capped');
let after = await rawCh(raider.id);
assert.equal(Number(after.cash) - Number(before.cash), loot, 'the raider pockets exactly the loot');
assert.equal(await ledgerOf(raider.id, 'cash', 'world:raid'), loot, 'the faucet is ledgered');
assert.equal(await ledgerOf(raider.id, 'ammo', 'world:raid'), -WORLD.RAID_AMMO, 'ammo spent on the raid is a ledgered sink');
assert.equal(Number(after.ammo), 100 - WORLD.RAID_AMMO, 'rounds were spent');
assert.equal(await npcStrength('zappa'), zStr0 - loot, 'the reservoir drained by exactly the loot');

// the per-character cooldown bites
r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.body.error, 'cooldown', 'a raider must regroup between hits');

// a REPELLED raid hospitalizes, takes no cash, leaves the reservoir alone
process.env.WORLD_RAID_P = '0';
await seedCh(raider.id, 'energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL, cash=1000');
const strBeforeRepel = await npcStrength('zappa');
before = await rawCh(raider.id);
r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.body.success, false, 'the roll is repelled');
assert(r.body.hospSeconds > 0, 'the outfit’s soldiers put the raider in a bed');
after = await rawCh(raider.id);
assert.equal(Number(after.cash), Number(before.cash), 'a repelled raid loots nothing');
assert(await npcStrength('zappa') >= strBeforeRepel, 'a failed raid drains nothing (only lazy regen moves the reservoir)');

// lazy REGEN toward the max
await pool.query(`UPDATE world_npcs SET strength=100000, strength_at = now() - interval '5 hours' WHERE npc_id='zappa'`);
await seedCh(raider.id, 'energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL');
board = (await call('GET', '/v1/world', { token: raider.token })).body;
const zPct = board.npcs.find((n) => n.id === 'zappa').strengthPct;
const expectRegen = Math.min(worldNpcOf('zappa').max, 100000 + worldNpcOf('zappa').regenPerHr * 5);
assert.equal(zPct, Math.round(expectRegen / worldNpcOf('zappa').max * 100), 'the reservoir regenerates lazily toward its max');

// ROUTING an outfit (draining below the floor) pays a one-time bonus
process.env.WORLD_RAID_P = '1';
const floor = worldNpcOf('zappa').max * WORLD.ROUT_FLOOR_BPS / 10000;
await pool.query(`UPDATE world_npcs SET strength=${Math.round(floor + 100)}, strength_at=now() WHERE npc_id='zappa'`);
await seedCh(raider.id, 'energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL, cash=1000');
before = await rawCh(raider.id);
r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.body.routed, true, 'draining the reservoir below the floor ROUTS the outfit');
assert.equal(r.body.routBonus, worldNpcOf('zappa').routBonus, 'routing pays a one-time bonus');
assert.equal(Number((await rawCh(raider.id)).cash) - Number(before.cash), r.body.loot + r.body.routBonus, 'the raider banks loot + the rout bonus');
delete process.env.WORLD_RAID_P;

// gates: level, energy, ammo
const rookie = await mk('Rookie Ron');
await seedCh(rookie.id, 'respect=0, energy=200, ammo=100');
assert.equal((await call('POST', '/v1/world/zappa/raid', { token: rookie.token })).body.error, 'level', 'a rookie can’t hit an outfit');
await seedCh(raider.id, "energy=5, world_raid_at=NULL");
assert.equal((await call('POST', '/v1/world/zappa/raid', { token: raider.token })).body.error, 'energy', 'no raid without the energy');
await seedCh(raider.id, 'energy=200, ammo=2, world_raid_at=NULL');
assert.equal((await call('POST', '/v1/world/zappa/raid', { token: raider.token })).body.error, 'ammo', 'no raid without the rounds');
assert.equal((await call('POST', '/v1/world/nope/raid', { token: raider.token })).body.error, 'bad_npc', 'no such outfit');

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — the day/night clock
// ─────────────────────────────────────────────────────────────────────────────
const noonUTC = Date.UTC(2026, 0, 1, 15, 0, 0);  // 15:00 UTC — inside the patrol window
const nightUTC = Date.UTC(2026, 0, 1, 3, 0, 0);   // 03:00 UTC — the small hours
assert.equal(cityHourOf(noonUTC).patrol, true, 'business hours are patrol hours');
assert.equal(cityHourOf(nightUTC).patrol, false, 'the small hours are off-patrol');
// the Bureau works business hours — a bust in the patrol window convicts a touch harder
const indicted = { heat_exposure: 5000 };
assert(bustProbOf(indicted, noonUTC) > bustProbOf(indicted, nightUTC), 'a patrol-hour trial convicts harder than a 3am one');
assert.equal(Math.round(bustProbOf(indicted, noonUTC) / bustProbOf(indicted, nightUTC) * 100) / 100, LIVING.PATROL_BUST_MULT, 'the patrol premium is exactly PATROL_BUST_MULT');

// ─────────────────────────────────────────────────────────────────────────────
// §10.4 — the Living World: vocabulary is closed (world:raid cash faucet + ammo sink)
// ─────────────────────────────────────────────────────────────────────────────
const vocab = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `world:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ test/world.js — the Living World across all four phases');
process.exit(0);
