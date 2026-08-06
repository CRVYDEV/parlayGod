// SEASONAL LEAGUE MODIFIERS test (the 42nd suite) — the PoE season twist (slate #6, design
// omerta-ladder-clues-seasons-design.md). THE ONE DROP THAT TOUCHES SIGNED LEVERS BY DESIGN —
// every touchpoint composes multiplicatively on an existing modifier site and the MODIFIED number
// is what's ledgered (the decree discipline). Covers: the deterministic seed draw + the SEASON_MOD
// test-only override, the /v1/city surface, and every touchpoint pinned: THE CRACKDOWN (laylow
// ×0.75 ledger-exact), BLOOD IN THE STREETS (safehouse cost ×1.25 ledger-exact + kill loot ×1.15),
// THE GOLD RUSH (goods sell ×1.03 vs the dead-quiet baseline), and DEAD QUIET (the vanilla
// baseline). §10.4 stays exact throughout (the modified numbers ride the normal ledger rails).
process.env.MOD_KEY = 'test-mod-key';
process.env.SEASON_MOD = 'dead_quiet'; // TEST-ONLY override (boot-guard rejects it in production)
process.env.SEARCH_MS = '50'; process.env.SHOOT_CD_MS = '1'; // the §9 hit timers (test-only)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { SEASON_MODS, seasonModOf, seasonPhaseOf, seasonPhaseLeft, seasonFx, cityHourOf, M3, M4 } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { onWatch } from '../src/social.js';
import { runSeasonRollover } from '../src/worker.js';

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
  const ch = await meOf(token);
  return { token, id: ch.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a };
};
const seedCh = (id, set) => pool.query(`UPDATE characters SET ${set} WHERE id='${id}'`);
const cashRow = async (id, reason) => (await pool.query(
  `SELECT amount FROM transactions WHERE character_id='${id}' AND reason='${reason}' ORDER BY at DESC LIMIT 1`)).rows[0];

// ── the draw: ARMED by default since 2026-08-02 (the strategy package — the founder signed the
// pool). The seed draw is deterministic per season index; SEASON_MODS=off still reverts to vanilla
// with no deploy, and the test-only SEASON_MOD override pins one season for a measurement ──
assert.equal(seasonModOf().id, 'dead_quiet', 'the test-only override pins the season');
{ delete process.env.SEASON_MOD;
  const drawn = seasonModOf(7);
  assert(SEASON_MODS.some((m) => m.id === drawn.id), 'armed by default, the seed draw lands in the pool');
  assert.equal(seasonModOf(7).id, drawn.id, 'the draw is deterministic per season index');
  // …and the kill switch still works, so a bad season is one env var away from vanilla
  process.env.SEASON_MODS = 'off';
  assert.equal(seasonModOf(7).id, 'dead_quiet', 'SEASON_MODS=off reverts to the signed baseline');
  delete process.env.SEASON_MODS;
  process.env.SEASON_MOD = 'dead_quiet'; }

// ── the public surface ──
let r = await call('GET', '/v1/city');
assert(r.body.season && r.body.season.mod.id === 'dead_quiet', '/v1/city carries the season');
assert(r.body.season.daysLeft >= 1 && r.body.season.daysLeft <= 28, 'the countdown is sane');
r = await call('GET', '/v1/rules');
assert.equal(r.body.seasonMods.pool.length, SEASON_MODS.length, 'the pool is a public catalog');

// ── BASELINE (dead quiet): laylow at the signed price; a goods sale at the vanilla unit ──
const vic = await mk('Season Vic');
await seedCh(vic.id, "cash=cash+2000000, energy=200, heat=60, loc='docks'");
r = await call('POST', '/v1/kitchen/laylow', { token: vic.token, body: {} });
assert.equal(r.code, 200, 'baseline laylow lands');
const baseLaylow = Math.abs(Number((await cashRow(vic.id, 'laylow')).amount));
await call('POST', '/v1/goods/buy', { token: vic.token, body: { goodId: 'gin', qty: 5 } });
r = await call('POST', '/v1/goods/sell', { token: vic.token, body: { goodId: 'gin', qty: 1 } });
const baseUnit = r.body.unit;

// ── THE CRACKDOWN: laylow ×0.75, ledger-exact ──
process.env.SEASON_MOD = 'the_crackdown';
await seedCh(vic.id, 'heat=60');
r = await call('POST', '/v1/kitchen/laylow', { token: vic.token, body: {} });
assert.equal(r.code, 200, 'crackdown laylow lands');
const crackLaylow = Math.abs(Number((await cashRow(vic.id, 'laylow')).amount));
assert.equal(crackLaylow, Math.floor(M4.LAYLOW_CASH * 0.75), `the judges are cheap — ×0.75 ledgered exactly (${crackLaylow})`);
assert(crackLaylow < baseLaylow, 'cheaper than the vanilla season');

// ── THE GOLD RUSH: the same sale runs ×1.03 vs the dead-quiet baseline unit ──
// (retuned 1.05 → 1.03: at 1.05 the sell-only bonus flipped a same-district buy→sell round trip
// past the 4% fee wall — ~+1% riskless per cycle for a whole season. 1.03 sits under the wall.)
process.env.SEASON_MOD = 'the_gold_rush';
r = await call('POST', '/v1/goods/sell', { token: vic.token, body: { goodId: 'gin', qty: 1 } });
assert.equal(r.code, 200, 'the gold-rush sale lands');
assert(r.body.unit > baseUnit, `gold rush lifts the sale (${baseUnit} → ${r.body.unit})`);
assert(Math.abs(r.body.unit - baseUnit * 1.03) <= 1, 'by ~3% (rounding-exact)');
// and the lift must stay UNDER the 4% round-trip fee wall, or the season pays for standing still
assert(r.body.unit < baseUnit * 1.04, 'under the 4% fee wall — no riskless same-district round trip');

// ── BLOOD IN THE STREETS: the safehouse quote ×1.25 (ledger-exact) + kill loot ×1.15 ──
process.env.SEASON_MOD = 'blood_in_the_streets';
const shelter = await mk('Shelter Shane');
await seedCh(shelter.id, 'cash=cash+100000');
r = await call('POST', '/v1/safehouse', { token: shelter.token, body: {} });
assert.equal(r.code, 200, 'the stay is bought');
const paid = Math.abs(Number((await cashRow(shelter.id, 'safehouse')).amount));
const liquid = 100_500; // fresh $500 + the seed
const expect = Math.floor(Math.max(M3.SAFEHOUSE_COST, Math.floor(liquid * 100 / 10000)) * 1.25);
assert.equal(paid, expect, `shelter is priced up ×1.25, ledgered exactly (${paid})`);
// (red-team B) the VIEW quote mirrors the armed charge — quoted price == charged price
const quoteMark = await mk('Quote Quincy');
const qView = await meOf(quoteMark.token);
assert.equal(qView.safehouseCost, Math.floor(M3.SAFEHOUSE_COST * 1.25), 'the sheet quotes the season-armed price');
// the kill loot: a full §9 hit on a cash-fat mark loots cashLootRate = min(.5, .25×1.15) = .2875
const killer = await mk('Seasonal Sid');
const mark = await mk('Marked Mel');
await seedCh(killer.id, "respect=25000, muscle=120, energy=200, loc='docks', ammo=8000, cb=10, cash=cash+200000");
await seedCh(mark.id, "respect=3610, cash=cash+1000000, health=1, loc='docks'");
await call('POST', '/v1/armory/gun/lastresort/buy', { token: killer.token, body: {} });
await call('POST', `/v1/streets/${mark.id}/search`, { token: killer.token, body: {} });
await new Promise((res) => setTimeout(res, 120)); // SEARCH_MS=50 — the search places
const markCash = (await meOf(mark.token)).cash;
r = await call('POST', `/v1/streets/${mark.id}/fire`, { token: killer.token, body: { rounds: 6000 } });
assert.equal(r.body.kill, true, 'the hit lands');
const lootRow = await cashRow(killer.id, 'whack:loot');
assert(lootRow, 'the loot is ledgered');
assert.equal(Number(lootRow.amount), Math.floor(markCash * Math.min(0.5, M3.CASH_LOOT_RATE * 1.15)),
  `blood in the streets loots deeper — ×1.15 on the rate, exact (${lootRow.amount})`);

// ── (red-team H) THE CRACKDOWN's lawGainMult: the investigation meter builds ×1.25 (direct accrue) ──
{ const { accrue } = await import('../src/accrual.js');
  // the test/law.js direct-accrue mock, verbatim — the crew + hot stash PIN heat at 100 across the
  // gap (accrue decays heat first; a bare mock cools below LAW.WATCH and builds nothing). The
  // dead_quiet vs the_crackdown RATIO isolates lawGainMult: the event/crew terms cancel.
  const hot = (await import('../src/rules.js')).DRUGS.slice(-1)[0].id;
  const run = () => { const c = { respect: 2000, energy: 0, nerve: 0, health: 0, cash: 0, bank: 0, heat: 100,
    heat_exposure: 0, crew: 5, crew_paid_at: new Date(Date.now() - 3600000), racket_credit_ms: 0, bank_credit_ms: 0,
    last_accrued_at: new Date(Date.now() - 8 * 3600000), path: 'kitchen', loc: 'docks', indicted_at: null };
    accrue(c, { staked: 0 }, { stash: [{ drug_id: hot, qty: 100000, quality: 1 }], rackets: [], assets: [], held: [] }); return c; };
  process.env.SEASON_MOD = 'dead_quiet';
  const quiet = run();
  process.env.SEASON_MOD = 'the_crackdown';
  const crack = run();
  assert(quiet.heat_exposure > 0, 'the meter builds at heat 100');
  const ratio = crack.heat_exposure / quiet.heat_exposure;
  assert(Math.abs(ratio - 1.25) < 0.02, `THE CRACKDOWN builds the case ×1.25 (${ratio.toFixed(3)})`);
  process.env.SEASON_MOD = 'blood_in_the_streets'; }

// ═══════════ THE SEASON HAS AN ENDING (the strategy package's ARC) ═══════════
// The twist above says WHAT a season is. This says a season HAS A SHAPE and CONCLUDES: a published
// phase clock, an escalation in the final week that lets the map actually move, and a permanent
// record of who ended it on top. The phases are a pure function of the day, so every assertion here
// pins SEASON_PHASE (test-only) — an exact-number claim resting on today's date is the recorded
// date-flake class.
{
  // ── THE CLOCK: the phase derives from the day inside the 28, and the boundaries are the pins ──
  delete process.env.SEASON_PHASE;
  assert.equal(seasonPhaseOf(0).id, 'opening', 'day 1 of a season opens it');
  assert.equal(seasonPhaseOf(6).id, 'opening', 'the opening runs to day 7');
  assert.equal(seasonPhaseOf(7).id, 'long_game', 'day 8 is the long game');
  assert.equal(seasonPhaseOf(20).id, 'long_game', 'the long game runs to day 21');
  assert.equal(seasonPhaseOf(21).id, 'reckoning', 'the last week is the reckoning');
  assert.equal(seasonPhaseOf(27).id, 'reckoning', 'and it runs to the close');
  assert.equal(seasonPhaseOf(28).id, 'opening', 'then the next season opens');
  assert.equal(seasonPhaseLeft(21), 7, 'a week to go when the reckoning opens');
  assert.equal(seasonPhaseLeft(27), 1, 'one day left at the close');

  // the escalation reader is a NO-OP outside the reckoning, which is what lets every touchpoint be
  // an unbranched multiply
  process.env.SEASON_PHASE = 'long_game';
  assert.equal(seasonFx('floorMult'), 1, 'the long game changes nothing');
  assert.equal(seasonFx('contestMsMult'), 1, 'nor the contest window');
  process.env.SEASON_PHASE = 'reckoning';
  assert.equal(seasonFx('floorMult'), 0.75, 'the reckoning discounts the turf floor');
  assert.equal(seasonFx('watchWindowMult'), 0.5, 'and halves the watch window');

  // ── THE ESCALATION, at the three real sites ──
  // (a) THE WATCH narrows. Declare an hour exactly 2 back from now: inside the plain 4h window,
  //     OUTSIDE the reckoning's halved 2h one. The holder cannot hide behind a declared hour.
  const hr = cityHourOf().hour;
  const twoBack = { watch_hour: (hr - 2 + 24) % 24 };
  process.env.SEASON_PHASE = 'long_game';
  assert.equal(onWatch(twoBack), true, 'two hours into a four-hour watch, the family is home');
  process.env.SEASON_PHASE = 'reckoning';
  assert.equal(onWatch(twoBack), false, 'in the reckoning that same hour is already outside the window');

  // (b) THE FLOOR drops. Same district, same garrison, same everything — only the phase moves.
  const { token: holdT } = await mk('Reckoning Holder');
  await seedCh((await meOf(holdT)).id, 'respect=5000, cash=cash+900000');
  const rg = (await call('POST', '/v1/gangs', { token: holdT, body: { name: 'The Bookkeepers', tag: 'BKS' } })).body.gangId;
  await pool.query(`UPDATE districts SET holder_gang='${rg}', garrison=200000, npc_holder=NULL, watch_hour=NULL WHERE id='cathedral'`);
  const floorNow = async () => (await call('GET', '/v1/districts', {})).body.districts.find((d) => d.id === 'cathedral').claimFloor;
  process.env.SEASON_PHASE = 'long_game';
  const plainFloor = await floorNow();
  process.env.SEASON_PHASE = 'reckoning';
  const cheapFloor = await floorNow();
  assert(plainFloor > 0, 'the board quotes a floor for held turf');
  assert.equal(cheapFloor, Math.floor(plainFloor * 0.75), `the reckoning discounts the floor exactly (${plainFloor} → ${cheapFloor})`);

  // (c) THE CONTEST WINDOW halves, so several can settle in a night. Read the stamped deadline.
  const { token: grabT } = await mk('Reckoning Raider');
  await seedCh((await meOf(grabT)).id, 'respect=5000, cash=cash+900000');
  const gg = (await call('POST', '/v1/gangs', { token: grabT, body: { name: 'The Late Callers', tag: 'LTC' } })).body.gangId;
  await call('POST', '/v1/gangs/tribute', { token: grabT, body: { amount: 700000 } });
  const t0 = Date.now();
  const stake = await call('POST', '/v1/districts/cathedral/claim', { token: grabT, body: { amount: cheapFloor } });
  assert.equal(stake.code, 200, `the raider staked at the reckoning floor (${JSON.stringify(stake.body)})`);
  const until = new Date((await pool.query(`SELECT contest_until u FROM districts WHERE id='cathedral'`)).rows[0].u).getTime();
  const windowMs = until - t0;
  assert(Math.abs(windowMs - M3.CONTEST_MS * 0.5) < 5000,
    `the reckoning's contest window is half the usual (${Math.round(windowMs / 60000)}m vs ${M3.CONTEST_MS / 60000}m)`);

  // ── THE RECKONING: the books close, and the city remembers ──
  // Drive the rollover for a season the population lived through. Everything below is pure STATUS —
  // the whole write moves no currency, which the §10.4 sweep at the end of this file proves.
  const cur = Number((await pool.query('SELECT MAX(season) s FROM characters')).rows[0].s) + 1;
  await pool.query(`UPDATE districts SET holder_gang='${gg}' WHERE id IN ('docks','canal')`);
  // seed the raider decisively across several pillars — City Standing is log-share over the whole
  // population, and the rollover itself bumps prestige, so a one-column lead can flip under it
  await pool.query(`UPDATE account_persistent SET kills=400, prestige=300, hitman_rep=500, tycoon_earned=9000000,
    statecraft=400, race_wins=200 WHERE account_id=(SELECT account_id FROM characters WHERE name='Reckoning Raider')`);
  const roll = await runSeasonRollover(pool, { season: cur });
  assert(roll.converted > 0, 'the rollover converted the population');
  assert(roll.reckoning, 'and closed the books on the season that ended');
  assert.equal(roll.reckoning.season, cur - 1, 'the record names the season that CLOSED, not the one starting');
  assert.equal(roll.reckoning.champion, 'Reckoning Raider', 'the individual with the top City Standing took the city');
  assert.equal(roll.reckoning.family, 'The Late Callers', 'and the family holding the most core turf is on the record');
  assert.equal(roll.reckoning.districts, 2, 'with what it held when the books closed');
  // THE CROWN — a lifetime legend on the bloodline (survives death, the duel_titles precedent)
  const crowns = async (n) => Number((await pool.query(
    `SELECT season_crowns c FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE name='${n}')`)).rows[0].c);
  assert.equal(await crowns('Reckoning Raider'), 1, 'the champion is crowned');
  assert.equal(await crowns('Reckoning Holder'), 0, 'nobody else is');
  // IDEMPOTENT: a second tick, a crash mid-rollover and a worker restart all land on the same row
  await pool.query(`UPDATE characters SET season = ${cur - 1}`);
  const again = await runSeasonRollover(pool, { season: cur });
  assert.equal(again.reckoning, null, 'a re-run records nothing — the season PK is the latch');
  assert.equal(await crowns('Reckoning Raider'), 1, 'and cannot double-crown');

  // ── THE SEASON RECAP — every converted player gets a personal "your season" keepsake (not just the
  //    one champion). Account-level → survives death; pure status, no §10.4. ──
  const raiderAcct = (await pool.query("SELECT account_id a FROM characters WHERE name='Reckoning Raider'")).rows[0].a;
  const srec = (await pool.query('SELECT * FROM season_recaps WHERE account_id=$1 AND season=$2', [raiderAcct, cur - 1])).rows[0];
  assert(srec, 'the rollover wrote the individual a season recap');
  assert.equal(srec.season, cur - 1, 'for the season that CLOSED');
  assert(srec.level >= 1 && srec.title, 'with the level they reached and a keepsake title');
  // the read endpoint surfaces the player their own seasons
  const myRecap = (await call('GET', '/v1/season/recap', { token: grabT })).body;
  assert(myRecap.recaps.some((x) => x.season === cur - 1 && x.title), "and /v1/season/recap serves the player their season");

  // ── THE ROLL, published: the clock and the record are keyless, because a deadline nobody can
  //    read is not a deadline ──
  process.env.SEASON_PHASE = 'reckoning';
  const sb = (await call('GET', '/v1/seasons', {})).body;
  assert.equal(sb.of, 28, 'the board publishes the season length');
  assert.equal(sb.phase.id, 'reckoning', 'and which phase the city is in');
  assert(sb.reckoning && sb.reckoning.floorMult === 0.75, 'the escalation is stated, not hidden');
  assert.equal(sb.phases.length, 3, 'the whole shape of a season is published up front');
  const rec = sb.roll.find((r) => r.season === cur - 1);
  assert(rec, 'the closed season is on the roll');
  assert.equal(rec.champion.name, 'Reckoning Raider', 'with its champion');
  assert.equal(rec.family.tag, 'LTC', 'and the family that held the ground');
  process.env.SEASON_PHASE = 'long_game';   // leave the world neutral for the §10.4 sweep below
}

// ── §10.4: every modified number rode the normal rails — the sweep stays exact ──
const inv = await runLedgerInvariants(pool, { alert: false });
const cash = inv.checks.find((c) => c.name === 'character cash');
assert.equal(cash.drift, 5_100_000, `cash drift == the SQL seeds only (modified prices ledger exactly): ${cash.drift}`);

await app.close();
console.log('✅ SEASONAL MODIFIERS test passed — the deterministic seed draw + the SEASON_MOD test-only override, the /v1/city + /v1/rules surfaces, THE CRACKDOWN (laylow ×0.75 ledger-exact), THE GOLD RUSH (goods sell ×1.03 vs the vanilla baseline, under the 4% round-trip fee wall), BLOOD IN THE STREETS (safehouse ×1.25 ledger-exact + a real §9 kill looting at the ×1.15 rate, clamped), and §10.4 exact throughout (the modified numbers ride the normal ledger rails — drift == the SQL seeds only)');
