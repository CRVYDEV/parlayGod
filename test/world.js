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
import { LIVING, WORLD, WORLD_NPCS, worldNpcOf, worldRankOf, cityHourOf, cityForecast, regionShockOf, cityLawEventOf,
         cityEventOf, goodPriceOf, bustProbOf, priceBlock, dayOf, GOODS, DISTRICTS, hash01, MARKET_SEED } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

process.env.MOD_KEY = 'test-mod-key';   // for the co-op raid death regression (audit LOW-1)
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
// AUDIT REGRESSION: the rout bonus fires only on the CROSSING — raiding an outfit ALREADY below
// the floor pays loot but NOT another bonus (else a horde pinning a reservoir mints it every raid)
await pool.query(`UPDATE world_npcs SET strength=${Math.round(floor - 50)}, strength_at=now() WHERE npc_id='zappa'`);
await seedCh(raider.id, 'energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL, cash=1000');
r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.body.routed, false, 'an already-floored outfit does not re-rout');
assert.equal(r.body.routBonus, 0, 'no repeat rout bonus while the reservoir sits below the floor');
delete process.env.WORLD_RAID_P;
// AUDIT REGRESSION: a raid is an armed op — a hospitalized raider is turned away (parity w/ convoy/heist)
await seedCh(raider.id, "energy=200, ammo=100, world_raid_at=NULL, hosp_until = now() + interval '10 minutes'");
assert.equal((await call('POST', '/v1/world/zappa/raid', { token: raider.token })).body.error, 'hosp', 'no raiding from a hospital bed');
await seedCh(raider.id, 'hosp_until=NULL');

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
// STEP TWO — the roster, THE WAR EFFORT, and enraged cartels
// ─────────────────────────────────────────────────────────────────────────────
// roster expanded 3→5 (content), on-curve: a low-tier Dock Rats + a top-tier Volkov Bratva
assert.equal(WORLD_NPCS.length, 5, 'the roster grew to five outfits');
board = (await call('GET', '/v1/world', { token: raider.token })).body;
assert(board.npcs.find((n) => n.id === 'dockrats') && board.npcs.find((n) => n.id === 'volkov'), 'the new low + apex outfits are on the board');

// THE WAR EFFORT — lifetime cartel damage (account-level, survives death) == the raider's world:raid cash
const wonCash = await ledgerOf(raider.id, 'cash', 'world:raid');
assert(board.warEffort && board.warEffort.damage === wonCash, 'the war-effort damage == the lifetime world:raid loot banked');
assert.equal(board.warEffort.rank, worldRankOf(wonCash).name, 'the rank is derived from the lifetime damage');
const wlb = (await call('GET', '/v1/leaderboard/world', { token: raider.token })).body;
assert(wlb.hunters.find((x) => x.name === 'Raider Rae' && x.damage === wonCash), 'the raider ranks on the War Effort leaderboard');

// ENRAGED CARTELS — a rout puts the outfit on high alert; it defends harder (lower odds) until it lapses
process.env.WORLD_RAID_P = '1';
await seedCh(raider.id, 'muscle=50, speed=20, energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL'); // modest power so odds aren't clamped
await pool.query(`UPDATE world_npcs SET strength=${worldNpcOf('zappa').max}, strength_at=now(), enraged_until=NULL WHERE npc_id='zappa'`);
const calmOdds = (await call('GET', '/v1/world', { token: raider.token })).body.npcs.find((n) => n.id === 'zappa').odds;
await pool.query(`UPDATE world_npcs SET strength=${Math.round(floor + 100)}, strength_at=now(), enraged_until=NULL WHERE npc_id='zappa'`);
await seedCh(raider.id, 'energy=200, ammo=100, world_raid_at=NULL, hosp_until=NULL');
r = await call('POST', '/v1/world/zappa/raid', { token: raider.token });
assert.equal(r.body.routed, true, 'route the outfit to enrage it');
await seedCh(raider.id, 'world_raid_at=NULL');
await pool.query(`UPDATE world_npcs SET strength=${worldNpcOf('zappa').max}, strength_at=now() WHERE npc_id='zappa'`); // keep enraged_until, refill so odds compare cleanly
board = (await call('GET', '/v1/world', { token: raider.token })).body;
const zEn = board.npcs.find((n) => n.id === 'zappa');
assert.equal(zEn.enraged, true, 'a routed cartel is ENRAGED (on high alert)');
assert(zEn.odds < calmOdds, 'enraged: the cartel digs in — raid odds drop (emission-safe)');
await pool.query(`UPDATE world_npcs SET enraged_until = now() - interval '1 minute' WHERE npc_id='zappa'`);
assert.equal((await call('GET', '/v1/world', { token: raider.token })).body.npcs.find((n) => n.id === 'zappa').enraged, false, 'the alert lapses on its own');
delete process.env.WORLD_RAID_P;

// ─────────────────────────────────────────────────────────────────────────────
// STEP THREE — CO-OP CREW RAIDS on the apex outfits + THE FRONTIER (family conquest)
// ─────────────────────────────────────────────────────────────────────────────
const boss = await mk('Frontier Boss');
const soldier = await mk('Frontier Soldier');
await seedCh(boss.id, 'respect=2000, muscle=200, speed=100, energy=200, ammo=100, cash=100000');
await seedCh(soldier.id, 'respect=2000, muscle=200, speed=100, energy=200, ammo=100, cash=100000');
// the boss founds a family; the soldier joins it (the frontier flag is planted by the LEADER's family)
assert.equal((await call('POST', '/v1/gangs', { token: boss.token, body: { name: 'The Frontier Mob', tag: 'FRM' } })).code, 200, 'the family is founded');
const gangId = (await meOf(boss.token)).gang.id;
assert.equal((await call('POST', `/v1/gangs/${gangId}/join`, { token: soldier.token })).code, 200, 'the soldier joins the family');

// an apex outfit needs a crew — a SOLO-only outfit refuses a co-op plan
assert.equal((await call('POST', '/v1/world/dockrats/plan', { token: boss.token })).body.error, 'solo', 'the Dock Rats are a solo hit — no crew');
// plan a co-op raid on the Kryl Syndicate (apex); the open raid shows on the board
const plan = await call('POST', '/v1/world/kryl/plan', { token: boss.token });
assert.equal(plan.code, 200, 'the raid is planned');
const raidId = plan.body.id;
const rboard = (await call('GET', '/v1/world/raids', { token: soldier.token })).body;
assert(rboard.raids.find((x) => x.id === raidId && x.npc === 'kryl' && x.leader === 'Frontier Boss'), 'the open raid is on the board looking for crew');
// the leader can't go it alone — an apex crew needs at least COOP_MIN
assert.equal((await call('POST', `/v1/world/raids/${raidId}/go`, { token: boss.token })).body.error, 'crew_short', 'no apex raid short of a crew');
assert.equal((await call('POST', `/v1/world/raids/${raidId}/join`, { token: soldier.token })).code, 200, 'the soldier crews up');
// a non-leader can't call the go
assert.equal((await call('POST', `/v1/world/raids/${raidId}/go`, { token: soldier.token })).body.error, 'not_leader', 'the leader calls the go');

// force a ROUT: seed the reservoir just above the floor, pin the roll to a landed hit
process.env.WORLD_RAID_P = '1';
const kFloor = worldNpcOf('kryl').max * WORLD.ROUT_FLOOR_BPS / 10000;
// seed the Kryl reservoir just above the floor (DELETE+INSERT — the row may not exist yet, so an
// UPDATE would be a no-op and currentStrength would lazily seed it at MAX, defeating the rout setup)
await pool.query(`DELETE FROM world_npcs WHERE npc_id='kryl'`);
await pool.query(`INSERT INTO world_npcs (npc_id, strength, strength_at) VALUES ('kryl', ${Math.round(kFloor + 200)}, now())`);
const bBefore = await rawCh(boss.id), sBefore = await rawCh(soldier.id);
const go = await call('POST', `/v1/world/raids/${raidId}/go`, { token: boss.token });
assert.equal(go.code, 200, 'the go runs');
assert.equal(go.body.success, true, 'the crew lands the hit');
assert.equal(go.body.routed, true, 'the crew ROUTS the Kryl Syndicate');
assert.equal(go.body.frontier, true, 'the leader’s family plants the frontier flag on the rout');
// both crewmen bank a leader-weighted world:raid share, each ledgered + banked exactly
const bShare = await ledgerOf(boss.id, 'cash', 'world:raid');
const sShare = await ledgerOf(soldier.id, 'cash', 'world:raid');
assert(bShare > 0 && sShare > 0, 'both crewmen are paid a share');
assert(bShare > sShare, 'the leader who fronted the op takes the bigger cut');
assert.equal(Number((await rawCh(boss.id)).cash) - Number(bBefore.cash), bShare, 'the boss banks exactly his share');
assert.equal(Number((await rawCh(soldier.id)).cash) - Number(sBefore.cash), sShare, 'the soldier banks exactly his share');
assert.equal(await ledgerOf(boss.id, 'ammo', 'world:raid'), -WORLD.RAID_AMMO, 'the leader’s ammo is a ledgered sink');
assert.equal(await ledgerOf(soldier.id, 'ammo', 'world:raid'), -WORLD.RAID_AMMO, 'the crew’s ammo is a ledgered sink');
// the war effort is banked to BOTH accounts (== their co-op world:raid cash)
board = (await call('GET', '/v1/world', { token: boss.token })).body;
assert.equal(board.warEffort.damage, bShare, 'the boss’s war effort == his co-op loot');
// THE FRONTIER — the Kryl turf now flies the Frontier Mob’s flag, and the board + leaderboard say so
const kryl = board.npcs.find((n) => n.id === 'kryl');
assert(kryl.heldBy && kryl.heldBy.tag === 'FRM' && kryl.heldBy.mine === true, 'the board shows the Frontier Mob holds Kryl (and it’s mine)');
const flb = (await call('GET', '/v1/leaderboard/frontier', { token: boss.token })).body;
assert(flb.families.find((f) => f.tag === 'FRM' && f.held === 1 && f.outfits.includes('The Kryl Syndicate')), 'the family tops the Frontier leaderboard holding Kryl');
delete process.env.WORLD_RAID_P;

// AUDIT LOW-1 regression — a dead co-op raid LEADER's plan is abandoned AND the stranded crew's member
// rows are cleared (no orphan bloat the sweep never reaps; the pen-break death precedent)
const doomed = await mk('Doomed Leader');
const stranded = await mk('Stranded Soldier');
await seedCh(doomed.id, 'respect=2000, energy=200, ammo=100');
await seedCh(stranded.id, 'respect=2000, energy=200, ammo=100');
const dplan = await call('POST', '/v1/world/kryl/plan', { token: doomed.token });
assert.equal(dplan.code, 200, 'the raid is planned');
assert.equal((await call('POST', `/v1/world/raids/${dplan.body.id}/join`, { token: stranded.token })).code, 200, 'the soldier crews up');
const retired = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: doomed.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(retired.statusCode, 200, 'the Commission retires the leader mid-plan');
assert.equal((await pool.query(`SELECT status FROM world_raids WHERE id='${dplan.body.id}'`)).rows[0].status, 'abandoned', 'the dead leader’s raid is abandoned');
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM world_raid_members WHERE raid_id='${dplan.body.id}'`)).rows[0].n), 0, 'the stranded crew rows are cleared — no orphan bloat');
assert.equal((await call('POST', '/v1/world/kryl/plan', { token: stranded.token })).code, 200, 'and the freed soldier can plan a fresh raid');

// ─────────────────────────────────────────────────────────────────────────────
// STEP FOUR — THE FRONTIER MADE REAL (productive + contestable outposts)
// ─────────────────────────────────────────────────────────────────────────────
// the step-three rout left the Frontier Mob (FRM, gangId) holding Kryl — now it's REAL turf.
const kf = worldNpcOf('kryl');
const kTributePerHr = Math.floor(kf.regenPerHr * WORLD.FRONTIER.TRIBUTE_BPS / 10000);
// (1) the rout installed a base GARRISON + started the TRIBUTE clock
let kRow = (await pool.query(`SELECT garrison, tribute_at, held_by_gang FROM world_npcs WHERE npc_id='kryl'`)).rows[0];
assert.equal(Number(kRow.garrison), WORLD.FRONTIER.ROUT_GARRISON, 'the rout installed the base garrison');
assert(kRow.tribute_at, 'and started the tribute clock');
assert.equal(kRow.held_by_gang, gangId, 'the Frontier Mob holds the outpost');
// the board surfaces the outpost economics to the holder
board = (await call('GET', '/v1/world', { token: boss.token })).body;
let kb = board.npcs.find((n) => n.id === 'kryl');
assert.equal(kb.tributePerHr, kTributePerHr, 'the board shows the tribute rate');
assert.equal(kb.garrison, WORLD.FRONTIER.ROUT_GARRISON, 'and the garrison a rival must outbid');
assert.equal(board.frontier.held, 1, 'the family holds one outpost');

// (2) collect the tribute — warp the clock back 5h; a MEMBER banks it to the treasury (a ledgered faucet)
await pool.query(`UPDATE world_npcs SET tribute_at = now() - interval '5 hours' WHERE npc_id='kryl'`);
const treas0 = Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${gangId}'`)).rows[0].treasury);
const col = await call('POST', '/v1/world/collect', { token: soldier.token });   // any member collects → treasury
assert.equal(col.code, 200, 'a member collects the frontier tribute');
assert.equal(col.body.collected, kTributePerHr * 5, 'tribute == rate × hours held');
const treas1 = Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${gangId}'`)).rows[0].treasury);
assert.equal(treas1 - treas0, kTributePerHr * 5, 'the treasury banks exactly the tribute');
assert.equal(await ledgerOf(soldier.id, 'cash', 'world:tribute'), 0, 'the tribute is character_id NULL (gang-level) — not on the collector');
const tributeLedgered = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND reason='world:tribute'`)).rows[0].s);
assert.equal(tributeLedgered, kTributePerHr * 5, 'the tribute is ledgered world:tribute (a treasury faucet)');
// the 24h CAP — warp back 48h, collect only a day's worth
await pool.query(`UPDATE world_npcs SET tribute_at = now() - interval '48 hours' WHERE npc_id='kryl'`);
const cap = await call('POST', '/v1/world/collect', { token: soldier.token });
assert.equal(cap.body.collected, kTributePerHr * 24, 'tribute accrual caps at 24h');
// BALANCE D2 (SIGNED) — collecting tribute is an EXPOSED act: a safehoused member can't bank it (audit F1)
await pool.query(`UPDATE world_npcs SET tribute_at = now() - interval '3 hours' WHERE npc_id='kryl'`);
await seedCh(soldier.id, "safe_until = now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/world/collect', { token: soldier.token })).body.error, 'safe', 'no collecting the frontier from a safehouse (shield, not bunker)');
await seedCh(soldier.id, 'safe_until = NULL');
assert.equal((await call('POST', '/v1/world/collect', { token: soldier.token })).body.collected, kTributePerHr * 3, 'once he surfaces, the tribute is still there to collect');

// (3) invasion gates
assert.equal((await call('POST', '/v1/world/kryl/invade', { token: soldier.token })).body.error, 'rank', 'only the boss/underboss marches on the frontier');
assert.equal((await call('POST', '/v1/world/dockrats/invade', { token: boss.token })).body.error, 'unheld', 'you rout an UNHELD outfit — you don’t invade it');
assert.equal((await call('POST', '/v1/world/kryl/invade', { token: boss.token })).body.error, 'held', 'you don’t invade your own outpost');

// (4) a RIVAL family invades the Frontier Mob's Kryl — outbids the garrison from the treasury
const rboss = await mk('Rival Don');
await seedCh(rboss.id, 'respect=2000, cash=100000');
assert.equal((await call('POST', '/v1/gangs', { token: rboss.token, body: { name: 'The Usurpers', tag: 'USR' } })).code, 200, 'the rival family is founded');
const rivalGang = (await meOf(rboss.token)).gang.id;
const RIVAL_SEED = 500000;
await pool.query(`UPDATE gangs SET treasury=${RIVAL_SEED} WHERE id='${rivalGang}'`);
const expectCost = Math.max(WORLD.FRONTIER.INVADE_BASE, Math.floor(WORLD.FRONTIER.ROUT_GARRISON * WORLD.FRONTIER.INVADE_OUTBID));
const inv = await call('POST', '/v1/world/kryl/invade', { token: rboss.token });
assert.equal(inv.code, 200, 'the rival marches on the outpost');
assert.equal(inv.body.cost, expectCost, 'the cost outbids the incumbent garrison (max of base, 1.5× garrison)');
assert.equal(Number((await pool.query(`SELECT treasury FROM gangs WHERE id='${rivalGang}'`)).rows[0].treasury), RIVAL_SEED - expectCost, 'the treasury pays the war chest');
assert.equal(await ledgerOf(rboss.id, 'cash', 'world:invade'), 0, 'the invade cost is character_id NULL (gang-level)');
const invadeLedgered = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash' AND reason='world:invade'`)).rows[0].s);
assert.equal(invadeLedgered, -expectCost, 'the invade cost is a ledgered treasury SINK');
kRow = (await pool.query(`SELECT held_by_gang, garrison FROM world_npcs WHERE npc_id='kryl'`)).rows[0];
assert.equal(kRow.held_by_gang, rivalGang, 'the outpost flies the Usurpers’ flag now');
assert.equal(Number(kRow.garrison), expectCost, 'the invader’s stake is the new garrison');
board = (await call('GET', '/v1/world', { token: boss.token })).body;
kb = board.npcs.find((n) => n.id === 'kryl');
assert.equal(kb.heldBy.mine, false, 'the Frontier Mob no longer holds Kryl');
assert.equal(kb.invadeCost, Math.max(WORLD.FRONTIER.INVADE_BASE, Math.floor(expectCost * WORLD.FRONTIER.INVADE_OUTBID)), 'the board quotes what it’d cost to take it back');

// (5) §10.4 — the gang-treasuries check reconciles world:tribute (+) and world:invade (−); the only
// unexplained drift is the SQL-seeded rival treasury (fully-earned tribute needs no seed)
const gt = (await runLedgerInvariants(pool)).checks.find((c) => c.name === 'gang treasuries');
assert.equal(gt.lhs - gt.rhs, RIVAL_SEED, 'gang treasuries reconcile world:tribute/world:invade — drift == the rival seed only');

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

console.log('✅ test/world.js — the Living World across all four phases + STEP TWO (roster 3→5, THE WAR EFFORT, ENRAGED CARTELS) + STEP THREE — CO-OP CREW RAIDS (plan/board/join/go, solo-outfit + crew_short + not_leader gates, a crew ROUTS an apex outfit, leader-weighted world:raid shares ledgered per head + ammo sink, war effort banked to both) + THE FRONTIER (the routing family plants its flag — board heldBy + the conquest leaderboard, dies with the family) + STEP FOUR — THE FRONTIER MADE REAL (a rout installs a garrison + tribute clock; a member collects the outpost’s TRIBUTE to the treasury — a ledgered world:tribute faucet capped at 24h; a rival INVADES by outbidding the garrison — a ledgered world:invade sink transferring the flag/garrison/clock; rank/unheld/held gates; the gang-treasuries §10.4 check reconciles both)');
process.exit(0);
