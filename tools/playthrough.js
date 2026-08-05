// OMERTÀ progression harness — simulates a REAL PLAYER's first days through the PUBLIC API.
//
// This is the PLAYER-EXPERIENCE twin of tools/sim.js. The sim answers "does the economy conserve
// and how big is each faucet"; this answers "what does a person actually experience" — what they
// can do in a sitting, what's gated, where they STALL with nothing to do, and how long a level takes.
// The level-240 speedrun was a progression bug, not an economy bug: the §10.4 sweep was drift-0 the
// whole time. This harness is how that class gets caught.
//
// THE RULES (same discipline as the sim):
//   • PUBLIC API ONLY. The player is a token; every action is a route call. No SQL shortcuts.
//   • NO VALUE IS SEEDED. Every dollar the simulated player holds was earned through a route.
//   • The only SQL is the CLOCK: advancing the wall clock by pulling this character's timestamps
//     back N minutes. That's the §7.1 lazy-accrual contract — regen and cooldowns are REAL, they
//     just happen in milliseconds.
//   • The player is PLAUSIBLE, not optimal: a fixed priority ladder anyone would follow, not a
//     solver. If a plausible player can speedrun, a real one certainly can.
//
// Run: node tools/playthrough.js            (default schedule)
//      node tools/playthrough.js --days 14  (longer horizon)
// SEASON PIN — the seasonal twist is ARMED in production since 2026-08-02 and its draw follows the
// real calendar (a Crackdown season changes laylow and law-gain; Blood in the Streets changes loot
// and the safehouse). A progression figure that means something different depending on the week it
// was run is not a measurement, so the baseline is pinned. Set SEASON_MOD=<id> to measure a season
// deliberately. Must be set BEFORE the server imports rules.
process.env.SEASON_MOD = process.env.SEASON_MOD || 'dead_quiet';
// …and the PHASE, for the same reason: THE SEASON HAS AN ENDING makes the last week of every
// season discount the turf floor and shorten the windows, derived from the real calendar. A run in
// the reckoning is measuring a different game than a run in week two.
process.env.SEASON_PHASE = process.env.SEASON_PHASE || 'long_game';
import { buildServer } from '../src/server.js';
import { opsEngagement } from '../src/engagement.js';
import { CRIMES, MISSIONS, GUNS, BUSINESSES, CONSTANTS, M3, PACING, RACKETS, PORT, POPULATION, nerveCapOf, DISTRICTS, STABLE } from '../src/rules.js';
import { runPopulation, runResidentBehaviour } from '../src/population.js';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const DAYS = argOf('days', 7);
const SESSIONS_PER_DAY = argOf('sessions', 2);
const SESSION_MIN = argOf('session', 45);     // minutes of continuous play per sitting
// --no-calendar / --no-newloops exist to SEPARATE the effects when comparing against an older run:
// a number that moved could be the game, the calendar fix, or the wider ladder, and a single figure
// cannot tell you which. Defaults are the honest current picture; the flags are for the A/B.
const ROLL_DAYS = !process.argv.includes('--no-calendar');
const NEW_LOOPS = !process.argv.includes('--no-newloops');
// THE CITY IS INHABITED. `runPopulation` is a worker job that ships ON (dormant only under
// POPULATION_OFF), so a server with nobody in it is the UNREALISTIC case — and this harness had
// been measuring exactly that. It matters here specifically: the residents are what make the
// PvP-flavoured daily contracts (jump, bust) doable by somebody playing alone, so without them the
// coach's "today's contracts unclaimed" rung can never clear and pins the whole ladder. Whether
// that rung is a real defect or an artifact of an empty world is not answerable without them.
const POPULATE = !process.argv.includes('--no-population');

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  let parsed = null;
  try { parsed = res.json(); } catch { parsed = null; }
  return { code: res.statusCode, body: parsed };
};
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const hhmm = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}m`;

// ── THE CLOCK ───────────────────────────────────────────────────────────────────────────────────
// Every character-scoped timestamp pulled back N minutes == the world advancing N minutes for this
// player. Listed explicitly (not information_schema) so a new column is a deliberate decision here.
const CLOCK_COLS = [
  'last_accrued_at', 'jail_until', 'hosp_until', 'gta_at', 'shoot_cd_until', 'crew_paid_at',
  'heist_at', 'npchit_at', 'safe_until', 'wash_at', 'safehouse_at', 'rwa_at', 'respec_at',
  'guarded_until', 'bank_intransit_at', 'retainer_until', 'witpro_until', 'world_raid_at',
  'pen_safe_until', 'hole_until', 'shank_at', 'train_at', 'mission_at', 'wanted_until',
  'envelope_until', 'wire_until', 'disinfo_until', 'active_at', 'race_at', 'port_at',
];
// …and the clocks that DON'T live on the character row. A sea run's arrival is on `boats.run_until`,
// so with only the character warped the Port loop could never land: the harness bought a boat, sailed
// it, and waited five hours of simulated play for a ship that would arrive on the real wall clock.
// That read as "the coach is stuck on the Port" when it was the harness holding its own watch. Scoped
// to THIS character's boats — residents own boats too, and warping theirs would move the world.
const OWNED_CLOCKS = [
  ['boats', 'character_id', ['run_until']],
  // THE DEEP CITY coach rungs (past ~24) put this player on the road and at the track, and both
  // loops keep their clocks on their own rows — without these the harness ships a convoy that
  // arrives on the wall clock and rests a racer on real hours, which reads as "the coach is stuck"
  // when it is the harness holding its own watch (the boats lesson, two more rows).
  ['convoys', 'owner_character', ['arrives_at']],
  ['racers', 'character_id', ['injured_until', 'circuit_at']],
];
// …and THE CALENDAR, which is a different kind of clock and was missing entirely. A growing set of
// loops is keyed on `dayOf()` rather than on a timestamp — the daily contracts, the corner and its
// chains, the hustle, the trainer drills, the fixture leads and the standing-gain bucket. Warping
// the character's timestamps advances the HOURS but never the DATE, so across a seven-day run the
// player got exactly ONE day of all of it: run A claimed 2 daily contracts in a week, when three a
// day are on offer. Every day-keyed loop was being measured at roughly a seventh of itself, which
// would have read as "these barely move the needle" — a limit of the harness reported as a finding
// about the game. Shifting a stored `day` DOWN is the same trick as pulling a timestamp back: to
// this character, yesterday's row is yesterday's.
//
// HONEST LIMIT: the CONTENT of a day is a seed function of the real `dayOf()`, so the drawn corner
// tasks, hustle stops and drills are the same every simulated day. That is fine for throughput and
// pacing, which is what this harness measures; it is not a test of variety.
// Two kinds, and the difference is the primary key. A table keyed ON the day (one row per day) is a
// LEDGER OF DAYS: shifting every row down one stacks yesterday onto the day before and breaks the
// key — which it did, immediately, on the third simulated day. Those tables get their spent history
// DROPPED and only the live day moved, which is also what the player experiences: yesterday's
// envelopes are gone, not archived. A table keyed on something else and merely CARRYING a day
// (a chain's `last_day`) is progress that must survive, and shifts safely.
const DAY_CYCLE = [   // PK includes the day → drop what's spent, then move today back
  ['daily_progress', 'character_id', ['day']],
  ['corner_jobs', 'character_id', ['day']],
  ['hustles', 'character_id', ['day']],
  ['npc_drills', 'character_id', ['day']],
  ['npc_leads', 'character_id', ['day']],
  ['npc_gain', 'character_id', ['day']],
  ['pen_talks', 'character_id', ['day']],
];
const DAY_SHIFT = [   // day is a field, not a key → carry the progress backwards
  ['corner_chains', 'character_id', ['last_day', 'started_day']],
  ['npc_errands', 'character_id', ['started_day', 'last_day']],
];
let simMinutes = 0; // wall-clock minutes elapsed since the character was born
let daysRolled = 0; // simulated calendar days already applied
const advance = async (id, minutes) => {
  simMinutes += minutes;
  const sets = CLOCK_COLS.map((c) => `${c} = ${c} - interval '${minutes} minutes'`).join(', ');
  await pool.query(`UPDATE characters SET ${sets} WHERE id='${id}'`);
  for (const [table, key, cols] of OWNED_CLOCKS) {
    const s = cols.map((c) => `${c} = ${c} - interval '${minutes} minutes'`).join(', ');
    await pool.query(`UPDATE ${table} SET ${s} WHERE ${key}=$1`, [id]);
  }
  const wantDays = Math.floor(simMinutes / 1440);
  if (ROLL_DAYS && wantDays > daysRolled) {
    const d = wantDays - daysRolled;
    const today = Math.floor(Date.now() / 86400000);
    daysRolled = wantDays;
    for (const [table, key] of DAY_CYCLE) {
      await pool.query(`DELETE FROM ${table} WHERE ${key}=$1 AND day < $2`, [id, today]);
      await pool.query(`UPDATE ${table} SET day = day - ${d} WHERE ${key}=$1`, [id]);
    }
    for (const [table, key, cols] of DAY_SHIFT) {
      const s = cols.map((c) => `${c} = ${c} - ${d}`).join(', ');
      await pool.query(`UPDATE ${table} SET ${s} WHERE ${key}=$1`, [id]);
    }
    await pool.query(`UPDATE characters SET checkin_day = checkin_day - ${d} WHERE id=$1`, [id]);
  }
};

// ── THE PLAYER ──────────────────────────────────────────────────────────────────────────────────
const { body: auth } = await call('POST', '/v1/auth/guest');
const token = auth.token;
const created = await call('POST', '/v1/character', { token, body: { name: 'Sal Fontana' } });
if (created.code !== 200) { console.error('character create failed', created.body); process.exit(1); }
const charId = created.body.id;
const me = async () => (await call('GET', '/v1/me', { token })).body.character;

// Fill the city before play starts, then keep the worker's beat once a sitting: `runPopulation`
// tops up by SPAWN_PER_TICK a call and also keeps a couple of inmates on the yard, and
// `runResidentBehaviour` is what puts their consent limits and offers on the boards.
const beat = async () => {
  if (!POPULATE) return;
  await runPopulation(pool);
  await runResidentBehaviour(pool);
};
if (POPULATE) {
  for (let i = 0; i < Math.ceil(POPULATION.TARGET / POPULATION.SPAWN_PER_TICK) + 1; i++) await beat();
  const n = (await pool.query('SELECT count(*)::int AS n FROM characters WHERE is_npc AND alive')).rows[0].n;
  console.log(`the city: ${n} residents on the streets before play starts`);
}

// tallies
const acted = {};            // action -> count
const blocked = {};          // "action:code" -> count
const firsts = {};           // milestone -> minutes
const levelAt = {};          // level -> { world, played } at first reach
const sessions = [];
let stallMin = 0, jailMin = 0, playedMin = 0;
let pvpTries = 0;   // PvP-contract attempts this sitting (a failed bust is a stretch in lockup)
// throttle telemetry — which resource actually limits a sitting
const pool_ = { nerveSum: 0, nerveCapSum: 0, nerveAtCap: 0, enAtCap: 0, ticks: 0 };
const did = (a) => { acted[a] = (acted[a] || 0) + 1; };
const hit = (a, code) => { const k = `${a}:${code}`; blocked[k] = (blocked[k] || 0) + 1; };
const first = (k) => { if (firsts[k] == null) firsts[k] = simMinutes; };

// crimes the player can legally attempt, richest first (respect is what gates progression)
const crimesFor = (lvl) => CRIMES.filter((c) => c.lvl <= lvl).sort((a, b) => b.respect - a.respect);
const fpOf = (m) => GUNS.find((g) => g.id === m.gun)?.fp || 0;
const missionReady = (x, m) => Object.entries(x.req).every(([k, v]) =>
  k === 'lvl' ? m.level >= v
  : k === 'fp' ? fpOf(m) >= v
  : k === 'trade' ? Number(m.tradeRep || 0) >= v
  : Number(m.eff?.[k] ?? m.stats?.[k] ?? 0) >= v);
// The mission a player is CHASING: the nearest undone one whose level is in reach, ignoring the
// Kitchen-gated trade line (a street player never touches it). This is what training is FOR.
const chasing = (m, done) => MISSIONS
  .filter((x) => !done.has(x.id) && !x.req.trade && (x.req.lvl || 0) <= m.level + 8)
  .sort((a, b) => (a.req.lvl || 0) - (b.req.lvl || 0))[0] || null;

const doneMissions = new Set();
let claimedOnboard = new Set();
let pathDeclared = false;

// ── THE COACH TRACE ─────────────────────────────────────────────────────────────────────────────
// `view.coach` is the game's own advice — the ▸ line the console renders and the plan box expands.
// The ladder below is a plausible player; this records what the COACH told them while they played,
// which measures the thing the ladder can't: does following the advice lead anywhere?
//
// The class this exists to catch has fired twice. A rung that cannot CLEAR sits at the top forever
// and MASKS every rung under it, so the coach becomes a single frozen sentence — measured once at
// level 128 after thirty days ("Finish your First Week", uncompletable because it counted socials
// that a default server refuses). The suite cannot see it: `coachOf` returns a string either way,
// and there is nothing to assert against without playing. So: count the minutes each distinct rung
// holds, and fail if any one of them holds most of the run.
const coachMin = new Map();       // label -> minutes it was the top rung
const coachPlanDepth = [];        // how many steps the plan box offered, per tick
let coachSilent = 0;              // minutes with no advice at all (a vet, correctly)
const coachObeyed = new Set();    // rungs the harness successfully DID what was asked
const coachCantAct = new Map();   // rung -> why this harness can't act on it (counted, not skipped)
// THE ON-RAMP. A rung is advice with a PRICE — "Cook up real money" wants $20,000 from a player the
// game first says it to at level 8. Recording when a rung is first ADVISED and when it is first
// CARRIED OUT (with the player's net worth at both moments) turns "the coach nags about the Kitchen"
// into the question that actually matters: how long does a player following the advice sit there
// unable to take it, and can they afford it at all when they're first told?
const rungFirst = new Map();      // label -> { at, worth, level } the first minute it was advised
const rungDone = new Map();       // label -> { at, worth, level } the first minute it was obeyed
function traceCoach(m) {
  const label = m.coach?.label;
  if (!label) { coachSilent++; return; }
  coachMin.set(label, (coachMin.get(label) || 0) + 1);
  if (!rungFirst.has(label)) rungFirst.set(label, { at: playedMin, worth: m.cash + m.bank, level: m.level });
  if (Array.isArray(m.coachPlan)) coachPlanDepth.push(m.coachPlan.length);
}

// FOLLOWING the advice, not just recording it. This is what makes the trace mean anything: a rung
// that persists AFTER the player did what it says is genuinely pinned; a rung that persists because
// this script ignores it is just a script that ignores it. The first cut of this harness conflated
// the two and reported a healthy rung ("Money while you sleep" — clearable by buying any racket) as
// a defect, which is the same false-alarm class the guards keep teaching: a false positive costs as
// much trust as a false pass.
//
// So: act on what is actionable through one route call, and COUNT what isn't rather than quietly
// dropping it (the honesty rule). Only the acted-on rungs are held to the anti-masking bound.
async function obeyCoach(m) {
  const label = m.coach?.label;
  // one place to record obedience, so a new branch can't forget the on-ramp half of it
  const obeyed = () => { coachObeyed.add(label); if (!rungDone.has(label)) rungDone.set(label, { at: playedMin, worth: m.cash + m.bank, level: m.level }); return true; };
  // Deliberately NOT once-per-label. A player following the coach keeps following it: some rungs
  // clear on one action ("buy a racket"), others need several ("you've earned skill points" recurs
  // every few levels as new points land, and one purchase does not spend three). Obeying once and
  // stopping made the skills rung LOOK pinned at 39% when it was simply being ignored after the
  // first buy — the same conflation this whole function exists to avoid, one level down.
  if (!label) return false;
  // "Money while you sleep" — buy the cheapest racket in reach. One call, and it flips `hasEarner`.
  if (label.startsWith('Money while you sleep')) {
    const buyable = RACKETS.filter((r) => r.lvl <= m.level && m.cash >= r.cost).sort((a, b) => a.cost - b.cost)[0];
    if (!buyable) return false;                       // not yet affordable — the advice is early, not stuck
    const r = await call('POST', `/v1/rackets/${buyable.id}/buy`, { token });
    if (r.code === 200) { did('coach:racket'); first('coach:racket'); return obeyed(); }
    hit('coach:racket', r.body?.error || r.code);
    return false;
  }
  // "You've earned skill points" — spend one. This rung is worth obeying specifically because it is
  // where the F1 bug LIVED: `owned.skills` is a Set, so the old `!owned.skills.length` was
  // `!undefined` — always true — and the rung fired forever no matter how many skills you had
  // bought, masking the two rungs below it. Buying one here regression-tests that fix through PLAY,
  // which is the only way it was ever going to be caught.
  if (label.startsWith('You\'ve earned skill points')) {
    const board = await call('GET', '/v1/skills', { token });
    // the board's own field is `tree`, each entry carrying `known` — cheapest unknown first, so the
    // harness always buys something a real player could afford with the points the rung is about
    const buyable = (board.body?.tree || []).filter((s) => !s.known).sort((a, b) => a.cost - b.cost)[0];
    if (!buyable) { coachCantAct.set(label, 'the skills board offered nothing unknown to buy'); return false; }
    const r = await call('POST', `/v1/skills/${buyable.id}`, { token });
    if (r.code === 200) { did('coach:skill'); first('coach:skill'); return obeyed(); }
    hit('coach:skill', r.body?.error || r.code);
    // a refusal is itself information — record WHY rather than falling through in silence, which is
    // how the first cut of this branch hid the fact that it was reading a field that doesn't exist
    coachCantAct.set(label, `tried ${buyable.id}, server said "${r.body?.error || r.code}"`);
    return false;
  }
  // "Learn the trade winds" — buy a trade good. The rung clears on ANY commerce mastery XP, so one
  // purchase is the whole instruction. Worth wiring because it is the rung that dominates the run
  // once the earlier ones clear, and an untested dominant rung is exactly the blind spot this
  // report exists to remove.
  if (label.startsWith('Learn the trade winds')) {
    // The rung's own copy is "buy something cheap where you stand, haul it where it's rich, sell
    // high", and it clears on COMMERCE mastery — which `economy.js` bumps on the SELL, not the buy.
    // So obedience is the whole round trip. Marking the rung obeyed after only BUYING made this
    // report fire a pin at 71% on a perfectly healthy rung: the player had done half the
    // instruction and the coach was right to keep asking. Sell first if we're holding, else buy.
    // (The board keys by DISTRICT then good under `goods` — the first cut guessed a flatter shape
    // and got a recorded "no price board for docks", which is the honesty rule paying for itself.)
    const cargo = Object.entries(m.cargo || {}).filter(([, q]) => q > 0)[0];
    if (cargo) {
      const r = await call('POST', '/v1/goods/sell', { token, body: { goodId: cargo[0], qty: cargo[1] } });
      if (r.code === 200) { did('coach:goods'); first('coach:goods'); return obeyed(); }
      hit('coach:goods', r.body?.error || r.code);
      coachCantAct.set(label, `held ${cargo[0]}, sell refused: "${r.body?.error || r.code}"`);
      return false;
    }
    const prices = await call('GET', '/v1/market/prices', { token });
    const here = prices.body?.goods?.[m.loc] || null;
    const good = here && Object.entries(here).sort((a, b) => a[1] - b[1])[0];
    if (!good) { coachCantAct.set(label, `no price board for ${m.loc}`); return false; }
    const r = await call('POST', '/v1/goods/buy', { token, body: { goodId: good[0], qty: 1 } });
    if (r.code === 200) { did('coach:goods:buy'); return true; }  // a step toward it, not obedience yet
    hit('coach:goods', r.body?.error || r.code);
    return false;
  }
  // "Get strapped" — buy the cheapest gun in reach and CARRY it. The mission ladder already buys
  // guns to clear fp gates, which is why this rung self-cleared before it was wired; obeying it
  // explicitly is what lets the anti-masking bound see it at all (an unobeyed rung is excluded).
  if (label.startsWith('Get strapped')) {
    const g = GUNS.filter((x) => x.cash <= m.cash && x.crates <= m.cb).sort((a, b) => a.cash - b.cash)[0];
    if (!g) return false;                              // can't cover it yet — early, not stuck
    const buy = await call('POST', `/v1/armory/gun/${g.id}/buy`, { token });
    if (buy.code !== 200) { hit('coach:gun', buy.body?.error || buy.code); return false; }
    await call('POST', `/v1/armory/gun/${g.id}/equip`, { token });
    did('coach:gun'); first('coach:gun'); return obeyed();
  }
  // "Cook up real money" — THE dominant rung: it held 70% of a seven-day run before this branch
  // existed, because the harness simply never bought a lab. That is the (b) case (advice ignored),
  // not the (a) case (advice uncompletable) — but nobody had checked which, and the two look
  // identical from outside. Buying the Bathtub Rig is one call once you can cover $20,000.
  if (label.startsWith('Cook up real money')) {
    const r = await call('POST', '/v1/kitchen/lab/upgrade', { token });
    if (r.code === 200) { did('coach:lab'); first('coach:lab'); return obeyed(); }
    // 'cash' is the honest EARLY answer — the rung is affordable-later, so it is not recorded as
    // untestable. Anything else is a real refusal worth naming in the report.
    if (r.body?.error !== 'cash') coachCantAct.set(label, `lab refused: "${r.body?.error || r.code}"`);
    hit('coach:lab', r.body?.error || r.code);
    return false;
  }
  // "A night at the Den" — clears on gambling mastery, which the den only stamps at or above
  // CASINO.GAMBLER_MIN_STAKE ($1,000). The rung's own copy says "bring a real stake ($1,000+)", so
  // obeying it means betting that much, at the Neon Mile, which is a district move first.
  if (label.startsWith('A night at the Den')) {
    if (m.cash < 1000) return false;
    if (m.loc !== 'neon') {
      const t = await call('POST', '/v1/travel/neon', { token });
      if (t.code !== 200) { coachCantAct.set(label, `travel to neon refused: "${t.body?.error || t.code}"`); return false; }
    }
    const r = await call('POST', '/v1/casino/dice', { token, body: { amount: 1000 } });
    if (r.code === 200) { did('coach:dice'); first('coach:dice'); return obeyed(); }
    hit('coach:dice', r.body?.error || r.code);
    coachCantAct.set(label, `dice refused: "${r.body?.error || r.code}"`);
    return false;
  }
  // "Get into the fight game" — sign a contender (BOXING.RECRUIT_COST). One call.
  if (label.startsWith('Get into the fight game')) {
    const r = await call('POST', '/v1/boxing/recruit', { token, body: { name: 'Kid Malone' } });
    if (r.code === 200) { did('coach:fighter'); first('coach:fighter'); return obeyed(); }
    if (r.body?.error !== 'cash') coachCantAct.set(label, `recruit refused: "${r.body?.error || r.code}"`);
    hit('coach:fighter', r.body?.error || r.code);
    return false;
  }
  // "Run the streets" — the PvE circuit needs a car, and the melt loop below now KEEPS the first one
  // for exactly this reason (a player following the coach would not scrap their only ride).
  if (label.startsWith('Run the streets')) {
    const car = (m.cars || []).find((c) => !c.listed && !c.pledged);
    if (!car) { coachCantAct.set(label, 'no car in the garage this tick — the boost loop had nothing to keep'); return false; }
    const r = await call('POST', '/v1/races/npc', { token, body: { car: car.id, tier: 'backalley' } });
    if (r.code === 200) { did('coach:race'); first('coach:race'); return obeyed(); }
    if (!['cash', 'cooldown'].includes(r.body?.error)) coachCantAct.set(label, `race refused: "${r.body?.error || r.code}"`);
    hit('coach:race', r.body?.error || r.code);
    return false;
  }
  // "You can get made for free" — the rung clears on acct.minted, and the free path is two calls:
  // burn earned $OMR for a mint credit (PLEX), then spend the credit. The price is the LIVE quote
  // (max(PLEX_MINT_OMR, feeEth × the latest buyback oracle × premium)), so this reads it rather than
  // assuming the pre-market floor — the same reason the rung's own copy stopped quoting a number.
  if (label.startsWith('You can get made for free')) {
    const q = await call('GET', '/v1/plex/price', { token });
    const price = Number(q.body?.mint?.price || 0);
    if (!price || Number(m.omr || 0) < price) return false;   // still earning it — not stuck
    const p = await call('POST', '/v1/plex/mint', { token });
    if (p.code !== 200) {
      hit('coach:plex', p.body?.error || p.code);
      coachCantAct.set(label, `plex mint refused: "${p.body?.error || p.code}"`);
      return false;
    }
    const r = await call('POST', '/v1/character/mint', { token });
    if (r.code === 200) { did('coach:made'); first('coach:made'); return obeyed(); }
    hit('coach:made', r.body?.error || r.code);
    coachCantAct.set(label, `mint refused: "${r.body?.error || r.code}"`);
    return false;
  }
  // "Open your first front" — the rung names the Laundromat and its live price; buy exactly that.
  if (label.startsWith('Open your first front')) {
    const front = BUSINESSES.find((b) => b.kind === 'laundromat');
    if (!front || m.cash < front.tiers[0].cost) return false;   // early, not stuck
    const r = await call('POST', `/v1/business/${front.kind}/buy`, { token });
    if (r.code === 200) { did('coach:front'); first('coach:front'); return obeyed(); }
    hit('coach:front', r.body?.error || r.code);
    coachCantAct.set(label, `front refused: "${r.body?.error || r.code}"`);
    return false;
  }
  // "Time to go legit" — the rung only fires when the player already HOLDS $OMR (missions pay it),
  // so obedience is one buy. Wired because it inherited the top of the ladder the moment the fights
  // rung cleared: half a seven-day run, with the Port and the Wire behind it.
  if (label.startsWith('Time to go legit')) {
    if (Number(m.omr || 0) < 1) return false;
    const r = await call('POST', '/v1/portfolio/invest', { token, body: { ticker: 'GLD', omr: 1 } });
    if (r.code === 200) { did('coach:legit'); first('coach:legit'); return obeyed(); }
    hit('coach:legit', r.body?.error || r.code);
    coachCantAct.set(label, `invest refused: "${r.body?.error || r.code}"`);
    return false;
  }
  // "Take it to the water" — the only multi-stage rung: it clears on lifetime SMUGGLED value, which
  // is stamped by a clean COLLECT, so obedience is buy-a-boat → sail → land it. Each tick advances
  // one stage; only the landing counts as obeyed.
  if (label.startsWith('Take it to the water')) {
    const board = await call('GET', '/v1/port', { token });
    const fleet = board.body?.fleet || [];
    const arrived = fleet.find((b) => b.status === 'arrived');
    if (arrived) {
      // COLLECT IS DISTRICT-PINNED TOO (port.js:183), and the hustle walks this player all over the
      // map between sittings — so without this the freight sat on the dock forever and the rung
      // held the top line while `district` piled up in the blocked table. A harness gap that reads
      // exactly like a stuck rung, which is why the blocked table is worth reading every run.
      if (m.loc !== 'docks') { const t = await call('POST', '/v1/travel/docks', { token }); if (t.code !== 200) return false; }
      const r = await call('POST', `/v1/port/collect/${arrived.id}`, { token });
      if (r.code === 200) { did('coach:port'); first('coach:port'); return obeyed(); }
      hit('coach:port', r.body?.error || r.code);
      return false;
    }
    if (fleet.some((b) => b.status === 'at_sea')) return false;   // en route — waiting is the action
    const docked = fleet.find((b) => b.status === 'docked');
    if (docked) {
      if (m.loc !== 'docks') { const t = await call('POST', '/v1/travel/docks', { token }); if (t.code !== 200) return false; }
      const route = (board.body?.routes || [])
        .filter((r2) => r2.minLvl <= m.level && r2.minSpeed <= docked.speed).sort((a, b) => b.margin - a.margin)[0];
      if (!route) { coachCantAct.set(label, 'no sea route this boat + level can attempt'); return false; }
      const r = await call('POST', `/v1/port/run/${docked.id}`, { token, body: { route: route.id } });
      if (r.code === 200) { did('coach:port:run'); return false; }   // a step toward it, not obedience
      if (r.body?.error !== 'cash') coachCantAct.set(label, `run refused: "${r.body?.error || r.code}"`);
      hit('coach:port', r.body?.error || r.code);
      return false;
    }
    const boat = PORT.BOATS.slice().sort((x, y) => x.cost - y.cost)[0];   // the cheapest hull — the Harbor Dinghy
    if (m.cash < boat.cost) return false;                          // early, not stuck
    if (m.loc !== 'docks') { const t = await call('POST', '/v1/travel/docks', { token }); if (t.code !== 200) return false; }
    const r = await call('POST', `/v1/port/boat/${boat.id}`, { token });   // the catalog key is `id`, not `kind`
    if (r.code === 200) { did('coach:port:boat'); return false; }
    if (r.body?.error !== 'cash') coachCantAct.set(label, `boat refused: "${r.body?.error || r.code}"`);
    hit('coach:port', r.body?.error || r.code);
    return false;
  }
  // ── THE WORK BOARD. These are the rungs that never run out (they refill daily), so they are what
  // the coach says for most of a long run — and they were the largest unwired block here: `tick`
  // already drives every one of these loops, but obeyCoach knew nothing about them, so a run that
  // genuinely followed the advice still reported them as "no action wired in this harness". An
  // untested rung and a broken rung look identical from the outside, which is the whole reason this
  // function counts what it cannot do rather than skipping it.
  if (label.startsWith('A job came in from the family')) {
    const ready = MISSIONS.filter((x) => !doneMissions.has(x.id) && missionReady(x, m))
      .sort((a, b) => b.reward.respect - a.reward.respect)[0];
    if (!ready) { coachCantAct.set(label, 'a mission is off cooldown but this player meets no remaining job\'s reqs'); return false; }
    const r = await call('POST', `/v1/missions/${ready.id}`, { token });
    if (r.code === 200) { doneMissions.add(ready.id); did('mission'); first(`mission:${ready.id}`); return obeyed(); }
    if (r.body?.error === 'done') doneMissions.add(ready.id);
    hit('mission', r.body?.error || r.code);
    return false;
  }
  if (label.endsWith("of today's contracts unclaimed")) {
    const d = await call('GET', '/v1/daily', { token });
    let took = false;
    for (const j of (d.body?.jobs || [])) {
      if (j.claimed || j.blocked || j.progress < j.goal) continue;   // `blocked` = the server says this street can't finish it
      const r = await call('POST', `/v1/daily/${j.id}/claim`, { token });
      if (r.code === 200) { did('coach:daily'); took = true; } else hit('coach:daily', r.body?.error || r.code);
    }
    return took ? obeyed() : false;   // nothing finished YET is early, not stuck — the grind does the work
  }
  if (label.startsWith("Tonight's hustle") || label.startsWith('Your hustle')) {
    const b = (await call('GET', '/v1/hustle', { token })).body;
    if (!b || b.done || !b.district) return false;
    if (!b.here) {
      const t = await call('POST', `/v1/travel/${b.district}`, { token });
      if (t.code !== 200) { coachCantAct.set(label, `travel to ${b.district} refused: "${t.body?.error || t.code}"`); return false; }
      did('hustle:travel'); return false;                            // a step toward it, not obedience yet
    }
    const r = await call('POST', '/v1/hustle/advance', { token });
    if (r.code === 200) { did(r.body.done ? 'hustle:payoff' : 'hustle:step'); first('hustle'); return r.body.done ? obeyed() : false; }
    hit('hustle', r.body?.error || r.code);                          // `legwork` until the work is done
    return false;
  }
  if (label.startsWith('The corner has an envelope')) {
    const c = await call('GET', '/v1/corner', { token });
    let took = false;
    for (const t of (c.body?.tasks || [])) {
      if (!t.accepted || t.claimed) continue;
      const r = await call('POST', `/v1/corner/${t.slot}/claim`, { token });
      if (r.code === 200) { did('corner:claim'); first('corner:claim'); took = true; } else hit('corner:claim', r.body?.error || r.code);
    }
    return took ? obeyed() : false;   // `not_done` is the normal case — the grind finishes it
  }
  if (label.startsWith('The trainers have work for you')) {
    const board = (await call('GET', '/v1/regimen', { token })).body;
    let took = false;
    for (const d of (board?.drills || [])) {
      if (d.claimed || !d.done) continue;
      const r = await call('POST', `/v1/regimen/drill/${d.npc}`, { token });
      if (r.code === 200) { did('drill'); first('drill'); took = true; } else hit('drill', r.body?.error || r.code);
    }
    return took ? obeyed() : false;
  }
  // ── THE DEEP CITY (the coach extension past ~24) — the five one-time rungs plus the Bureau tail
  // rung, wired the day they shipped: an untested rung and a broken rung look identical from the
  // outside, and the whole point of the extension is to measure whether a coached player now
  // REACHES these systems.
  if (label.startsWith('Put a truck on the road')) {
    const b = (await call('GET', '/v1/convoys', { token })).body;
    if (b?.mine) {
      if (b.mine.status !== 'arrived') return false;            // on the road — the clock warp lands it
      if (m.loc !== b.mine.to) {
        const t = await call('POST', `/v1/travel/${b.mine.to}`, { token });
        if (t.code !== 200) { coachCantAct.set(label, `travel to ${b.mine.to} refused: "${t.body?.error || t.code}"`); return false; }
        did('convoy:travel'); return false;                     // a step toward it, not obedience yet
      }
      const r = await call('POST', `/v1/convoy/${b.mine.id}/collect`, { token });
      if (r.code === 200) { did('convoy:collect'); first('convoy'); return obeyed(); }
      coachCantAct.set(label, `collect refused: "${r.body?.error || r.code}"`); hit('convoy', r.body?.error || r.code);
      return false;
    }
    // nothing on the road yet: a convoy is for BULK (CONVOY.MIN_QTY 5), so top the trunk up to five
    // units of the cheapest good here, send it one district over, ride cheap — the rung is about
    // REACHING the loop, not optimizing it
    const NEED = 5;
    let cargo = Object.entries(m.cargo || {}).find(([, q]) => Number(q) >= NEED);
    if (!cargo) {
      const prices = (await call('GET', '/v1/market/prices', { token })).body?.goods?.[m.loc] || {};
      const good = Object.entries(prices).sort((a, z) => Number(a[1]) - Number(z[1]))[0];
      const short = NEED - Number(m.cargo?.[good?.[0]] || 0);
      if (!good || m.cash < Number(good[1]) * short) { coachCantAct.set(label, 'no affordable bulk to load'); return false; }
      const br = await call('POST', '/v1/goods/buy', { token, body: { goodId: good[0], qty: short } });
      if (br.code !== 200) { hit('convoy', br.body?.error || br.code); return false; }
      cargo = [good[0], NEED];
    }
    const to = DISTRICTS.find((d) => d.id !== m.loc)?.id;
    const o = await call('POST', '/v1/convoy', { token, body: { to, goodId: cargo[0], qty: NEED } });
    if (o.code !== 200) { coachCantAct.set(label, `open refused: "${o.body?.error || o.code}"`); hit('convoy', o.body?.error || o.code); return false; }
    const dep = await call('POST', '/v1/convoy/depart', { token, body: { guards: 'none' } });
    if (dep.code === 200) { did('convoy:depart'); first('convoy'); return false; }   // it collects on a later tick
    coachCantAct.set(label, `depart refused: "${dep.body?.error || dep.code}"`); hit('convoy', dep.body?.error || dep.code);
    return false;
  }
  if (label.startsWith('Own the animals')) {
    const b = (await call('GET', '/v1/stable', { token })).body;
    let racer = (b?.stable || [])[0];
    if (!racer) {
      const r = await call('POST', '/v1/stable/buy', { token, body: { kind: 'dog', name: 'Harness Rocket' } });
      if (r.code !== 200) { coachCantAct.set(label, `buy refused: "${r.body?.error || r.code}"`); hit('stable', r.body?.error || r.code); return false; }
      did('stable:buy'); first('stable');
      racer = (await call('GET', '/v1/stable', { token })).body?.stable?.[0];
    }
    if (!racer) return false;
    if (racer.injured || racer.cooldownSeconds > 0) return false;   // the clock warp clears both
    const meet = (b?.meets?.dog || STABLE.MEETS.dog)[0];
    // train toward the maiden's form first — running a hopeless animal just burns the fee
    if (racer.form < meet.form && m.energy >= (b?.trainEnergy || STABLE.TRAIN_ENERGY)
        && m.cash >= (b?.trainCost || STABLE.TRAIN_COST) + meet.fee) {
      const t = await call('POST', `/v1/stable/train/${racer.id}`, { token, body: { stat: 'speed' } });
      if (t.code === 200) { did('stable:train'); return false; }
      hit('stable', t.body?.error || t.code);
    }
    if (m.cash < meet.fee) return false;                           // broke, not stuck — the grind funds it
    const r = await call('POST', `/v1/stable/circuit/${racer.id}`, { token, body: { meet: meet.id } });
    if (r.code === 200) { did(r.body?.won ? 'stable:win' : 'stable:loss'); first('stable:circuit'); return r.body?.won ? obeyed() : false; }
    hit('stable', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('Open a club of your own')) {
    // the rung only fires MADE and funded, so the one live question is a free district; try where
    // we stand first (no travel), then the first free district on the board
    const board = (await call('GET', '/v1/speakeasy', { token })).body;
    const open = board?.open || [];                              // the board names the free districts
    const target = open.includes(m.loc) ? m.loc : open[0];
    if (!target) { coachCantAct.set(label, 'every district already has a club'); return false; }
    const r = await call('POST', `/v1/speakeasy/${target}/open`, { token });
    if (r.code === 200) { did('speakeasy:open'); first('speakeasy'); return obeyed(); }
    coachCantAct.set(label, `open refused: "${r.body?.error || r.code}"`); hit('speakeasy', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('Put your name on the skyline')) {
    const amount = Math.max(100, Math.min(5000, Math.floor(m.cash * 0.05)));   // MEGAPROJECT.MIN_CASH floor
    if (m.cash < amount) return false;                             // broke, not stuck
    const r = await call('POST', '/v1/megaproject/cash', { token, body: { amount } });
    if (r.code === 200) { did('mega:brick'); first('mega'); return obeyed(); }
    coachCantAct.set(label, `brick refused: "${r.body?.error || r.code}"`); hit('mega', r.body?.error || r.code);
    return false;
  }
  // the earn→spend arc's two rungs — both fire only while HOLDING the price, so a refusal here is news
  if (label.startsWith('You can afford your dues')) {
    const r = await call('POST', '/v1/made', { token });
    if (r.code === 200) { did('made:dues'); first('made'); return obeyed(); }
    coachCantAct.set(label, `dues refused: "${r.body?.error || r.code}"`); hit('made', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('Put your $OMR to work')) {
    const amount = Math.floor(Number(m.omr) * 1e6) / 1e6;
    const r = await call('POST', '/v1/stake', { token, body: { amount } });
    if (r.code === 200) { did('stake'); first('stake'); return obeyed(); }
    coachCantAct.set(label, `stake refused: "${r.body?.error || r.code}"`); hit('stake', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('Buy the compound')) {
    const r = await call('POST', '/v1/estate/upgrade', { token });
    if (r.code === 200) { did('estate:tier'); first('estate'); return obeyed(); }
    coachCantAct.set(label, `upgrade refused: "${r.body?.error || r.code}"`); hit('estate', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('The Bureau is building a case')) {
    const r = await call('POST', '/v1/law/bribe', { token });
    if (r.code === 200) { did('law:bribe'); first('law:bribe'); return obeyed(); }
    // `cash` is the honest answer for a hot broke street — the exposure bleeds on its own
    coachCantAct.set(label, `bribe refused: "${r.body?.error || r.code}"`); hit('law:bribe', r.body?.error || r.code);
    return false;
  }
  // ── THE CITY IS NOT EMPTY ANY MORE. These three used to be recorded as "solo run — nobody else
  // exists", which was true when it was written and is now FALSE: NPC families found and recruit
  // (POPULATION.FAMILIES), residents list duel limits (POPULATION.BEHAVIOUR), and every resident is
  // a real character a wire can tap. Between them they held 44% of advised play in the run that
  // caught this — so the harness was declaring untestable the two things the coach spends most of
  // its breath on, which is the F2 masking class living in the INSTRUMENT rather than the game.
  // An untested rung and a permanently-stuck rung look identical from the outside; that is the
  // whole reason this function acts where it can and names what it cannot.
  if (label.startsWith('Nobody survives alone')) {
    const board = await call('GET', '/v1/gangs', { token });
    const open = (board.body?.gangs || board.body || [])
      .filter((g) => g.members < M3.GANG_MAX_MEMBERS)
      .sort((a, b) => a.members - b.members)[0];          // the thinnest crew has the most room
    if (!open) { coachCantAct.set(label, 'no family on the board has room'); return false; }
    const r = await call('POST', `/v1/gangs/${open.id}/join`, { token });
    if (r.code === 200) { did('coach:family'); first('coach:family'); return obeyed(); }
    coachCantAct.set(label, `join refused: "${r.body?.error || r.code}"`);
    hit('coach:family', r.body?.error || r.code);
    return false;
  }
  if (label.startsWith('Blood on the ledger') || label.startsWith('No blood on your ledger')) {
    const b = (await call('GET', '/v1/duels', { token })).body;
    const stake = b?.stakeMin || 0;
    // Cheapest live opponent whose posted limit clears the floor and whose stake we can cover. A
    // limit UNDER stakeMin sits in an empty window (the population step-two F2 finding), so those
    // rows are correctly skipped rather than attempted.
    const foes = (b?.duelists || []).filter((d) => !d.me && d.limit >= stake)
      .sort((x, y) => x.limit - y.limit);
    if (!foes.length) { coachCantAct.set(label, 'nobody on the ladder is listed above the stake floor'); return false; }
    // WALK the board rather than trying only the cheapest. Obeying the coach's OWN earlier rung puts
    // you in a family, and omertà then refuses a duel against your own people — so a single-candidate
    // handler retried the same blood relative forever and reported the ladder as untestable. The
    // board does not say who is off-limits (see the finding), so the only honest way to find out is
    // to ask, skip the refusal, and move down the list.
    let last = null;
    for (const foe of foes) {
      const amount = Math.min(foe.limit, Math.max(stake, Math.floor(m.cash * 0.02)));
      if (m.cash < amount) return false;                   // broke, not stuck — the grind funds it
      const r = await call('POST', `/v1/duels/${foe.id}`, { token, body: { amount } });
      if (r.code === 200) { did(r.body?.won ? 'duel:win' : 'duel:loss'); first('duel'); return obeyed(); }
      last = r.body?.error || r.code;
      hit('duel', last);
      if (last === 'cooldown' || last === 'level' || last === 'cash') break;   // about ME, not this foe
    }
    if (last && last !== 'cooldown') coachCantAct.set(label, `duel refused: "${last}"`);
    return false;
  }
  if (label.startsWith('Work the wires')) {
    const roster = (await call('GET', '/v1/streets', { token })).body?.streets || [];
    const mark = roster.filter((p) => !p.me)[0];
    if (!mark) { coachCantAct.set(label, 'nobody on the streets to tap'); return false; }
    const r = await call('POST', `/v1/wire/tap/${mark.id}`, { token });
    if (r.code === 200) { did('coach:wire'); first('coach:wire'); return obeyed(); }
    // `omr` is the honest answer for a solo grinder — the wire is a $OMR sink and nothing in this
    // ladder earns $OMR except the mission rewards. Recorded as the gate it is, not as "untestable".
    coachCantAct.set(label, `tap refused: "${r.body?.error || r.code}"`);
    hit('coach:wire', r.body?.error || r.code);
    return false;
  }
  // PULL A CREW SCORE — no longer untestable solo. The hired hand (residents-in-crews) fills the
  // entry 2-man job with an NPC body, so a solo player can plan → hire → execute. This is the
  // measurement half of that drop: the rung the harness named as the top masking friction now clears.
  if (label.startsWith('Pull a crew score') || label.startsWith('Find a crew')) {
    let hb = (await call('GET', '/v1/heists', { token })).body;
    let hid = hb?.mine?.leader ? hb.mine.id : null;
    if (!hid) {
      const fee = hb?.mine?.fillFee || 5000;
      const job = (hb?.jobs || []).filter((j) => j.crew === 2 && !j.locked && m.level >= j.lvl && m.cash >= j.stake + fee)
        .sort((a, b) => a.stake - b.stake)[0];              // cheapest entry co-op we can stake + hire for
      if (!job) { coachCantAct.set(label, m.level < 8 ? 'level too low for the entry crew job' : 'not enough cash for the stake + a hired hand'); return false; }
      const pr = await call('POST', '/v1/heists/plan', { token, body: { job: job.id } });
      if (pr.code !== 200) { coachCantAct.set(label, `plan refused: "${pr.body?.error || pr.code}"`); hit('heist', pr.body?.error || pr.code); return false; }
      hid = pr.body.id; hb = (await call('GET', '/v1/heists', { token })).body;
    }
    while (hb.mine && hb.mine.canHire) {                    // fill open seats with hired hands
      const fr = await call('POST', `/v1/heists/${hid}/fill`, { token });
      if (fr.code !== 200) { coachCantAct.set(label, `hire refused: "${fr.body?.error || fr.code}"`); hit('heist', fr.body?.error || fr.code); break; }
      did('heist:fill'); first('heist'); hb = (await call('GET', '/v1/heists', { token })).body;
    }
    if (hb.mine && hb.mine.crewNeeded > 0) { coachCantAct.set(label, 'still short a body after hiring (HEIST_FILL_MAX)'); return false; }
    const ex = await call('POST', `/v1/heists/${hid}/execute`, { token });
    if (ex.code === 200) { did(ex.body?.score ? 'heist:score' : 'heist:bust'); first('heist'); return obeyed(); }
    coachCantAct.set(label, `execute refused: "${ex.body?.error || ex.code}"`);
    hit('heist', ex.body?.error || ex.code);
    return false;
  }
  if (label.startsWith('Still running solo')) coachCantAct.set(label, 'solo run — the permanent tail nudge, correctly last');
  else if (!coachCantAct.has(label)) coachCantAct.set(label, 'no action wired in this harness');
  return false;
}

// ── ONE MINUTE OF PLAY ──────────────────────────────────────────────────────────────────────────
// A plausible ladder: free rewards first, then the big-ticket cooldown jobs, then train toward the
// gate you're chasing, then grind the best crime you can afford. Returns true if anything happened.
async function tick(dayIdx) {
  const m = await me();
  const lvl = m.level;
  if (levelAt[lvl] == null) levelAt[lvl] = { world: simMinutes, played: playedMin, worth: m.cash + m.bank };
  traceCoach(m);
  pool_.ticks++; pool_.nerveSum += m.nerve; pool_.nerveCapSum += m.maxNerve;
  if (m.nerve >= m.maxNerve) pool_.nerveAtCap++;
  if (m.energy >= m.maxEnergy) pool_.enAtCap++;
  if (m.jailSeconds > 0) { jailMin++; return false; }

  const winsBefore = acted['crime:win'] || 0;   // for 8b, below
  let didSomething = false;

  // 0. FOLLOW THE ADVICE — before the hand-written ladder gets a turn. The whole point of the
  // harness is a PLAUSIBLE player, and a plausible player does what the game tells them to do.
  if (await obeyCoach(m)) didSomething = true;

  // 1. the First Week checklist — free money sitting on the table
  const ob = await call('GET', '/v1/onboard', { token });
  for (const t of (ob.body?.tasks || [])) {
    if (t.claimed || !t.ready || t.social) continue;
    const r = await call('POST', `/v1/onboard/${t.id}/claim`, { token });
    if (r.code === 200) { did('onboard'); claimedOnboard.add(t.id); first(`onboard:${t.id}`); didSomething = true; }
    else hit('onboard', r.body?.error || r.code);
  }

  // 1b. THE CAREER — the post-First-Week ladder. Free money for work already done, so a plausible
  //     player collects it the same way they collect the checklist. Latched per ACCOUNT, once ever.
  if (NEW_LOOPS) {
    const c = await call('GET', '/v1/career', { token });
    for (const t of (c.body?.tiers || []).filter((x) => x.open).flatMap((x) => x.tasks)) {
      if (t.claimed || !t.ready) continue;
      const r = await call('POST', `/v1/career/${t.id}`, { token });
      if (r.code === 200) { did('career'); first(`career:${t.id}`); didSomething = true; }
      else hit('career', r.body?.error || r.code);
    }
  }

  // 2. declare a Path the moment it's affordable (level 5 + the fee)
  if (!pathDeclared && lvl >= 5 && m.cash >= CONSTANTS.PATH_FIRST_COST) {
    const r = await call('POST', '/v1/path', { token, body: { path: 'gun' } });
    if (r.code === 200) { pathDeclared = true; did('path'); first('path'); didSomething = true; }
    else hit('path', r.body?.error || r.code);
  }

  // 3. bank a float once (the checklist wants it, and pocket cash is lootable)
  if (m.bank === 0 && m.cash > 2000) {
    const r = await call('POST', '/v1/bank/deposit', { token, body: { amount: 1000 } });
    if (r.code === 200) { did('bank'); first('bank'); didSomething = true; } else hit('bank', r.body?.error || r.code);
  }

  // 3b. WORD ON THE STREET — the block's daily envelopes. A plausible player takes the work that is
  //     on offer where they stand and collects it when the day's play has done it. Accepting is free
  //     and snapshots the counters, so taking everything open here is what a person does; the day's
  //     allowance (CORNER.MAX_DAY) and the one-per-KIND rule are the server's to enforce, and this
  //     harness deliberately does NOT restate them — that is the F2 class, and letting the refusal
  //     come back is how the refusal itself gets measured.
  if (NEW_LOOPS) {
    const c = await call('GET', '/v1/corner', { token });
    for (const t of (c.body?.tasks || [])) {
      if (!t.accepted) {
        const r = await call('POST', `/v1/corner/${t.slot}/accept`, { token });
        if (r.code === 200) { did('corner:accept'); first('corner:accept'); didSomething = true; }
        else hit('corner:accept', r.body?.error || r.code);
      } else if (!t.claimed) {
        const r = await call('POST', `/v1/corner/${t.slot}/claim`, { token });
        if (r.code === 200) { did('corner:claim'); first('corner:claim'); didSomething = true; }
        else hit('corner:claim', r.body?.error || r.code);   // `not_done` is the normal case
      }
    }
  }

  // 3c. TONIGHT'S HUSTLE — the three-stop chain that walks you across the map. The board says where
  //     the next stop is and whether you're on it, so: travel there, then advance. The legwork stop
  //     additionally wants a real action done SINCE the meeting, which the grind below supplies.
  if (NEW_LOOPS) {
    const hb = await call('GET', '/v1/hustle', { token });
    const b = hb.body;
    if (b && !b.done && b.district) {
      if (!b.here) {
        const t = await call('POST', `/v1/travel/${b.district}`, { token });
        if (t.code === 200) { did('hustle:travel'); didSomething = true; }
        else hit('hustle:travel', t.body?.error || t.code);
      } else {
        const r = await call('POST', '/v1/hustle/advance', { token });
        if (r.code === 200) { did(r.body.done ? 'hustle:payoff' : 'hustle:step'); first('hustle'); didSomething = true; }
        else hit('hustle', r.body?.error || r.code);          // `legwork` until the work is done
      }
    }
  }

  // 4. THE GARAGE — boost whenever the heat's off, then melt it down. This is the crate pipeline:
  //    crates are what the armory takes, and the armory is what the mission ladder's fp gates want.
  if (m.energy >= 10) {
    const r = await call('POST', '/v1/garage/boost', { token });
    if (r.code === 200) {
      did(r.body.car ? 'boost' : 'boost:miss'); first('boost'); didSomething = true;
      // KEEP THE FIRST RIDE. Melting everything is what a cash-maximiser does; a player following
      // the coach keeps one car, because the coach tells them at level 14 to go race it. Scrapping
      // the only ride made the races rung structurally unobeyable and it would have read as
      // "the harness can't act on it" forever — a limit of the script masquerading as a measurement.
      if (r.body.car?.id && (m.cars || []).length >= 1) {
        const melt = await call('POST', `/v1/garage/${r.body.car.id}/melt`, { token });
        if (melt.code === 200) did('melt'); else hit('melt', melt.body?.error || melt.code);
      }
    } else if (r.body?.error !== 'cooldown') hit('boost', r.body?.error || r.code);
  }

  // 5. THE SCORE — the biggest single payout available, taken the instant it's off cooldown
  if (m.heistSeconds === 0 && m.health >= 20) {
    const r = await call('POST', '/v1/heist', { token });
    if (r.code === 200) { did('score'); first('score'); didSomething = true; }
    else hit('score', r.body?.error || r.code);
  }

  // 6. MISSIONS — the authored ladder: take the richest job you currently qualify for
  if (m.missionSeconds === 0) {
    const ready = MISSIONS.filter((x) => !doneMissions.has(x.id) && missionReady(x, m))
      .sort((a, b) => b.reward.respect - a.reward.respect)[0];
    if (ready) {
      const r = await call('POST', `/v1/missions/${ready.id}`, { token });
      if (r.code === 200) { doneMissions.add(ready.id); did('mission'); first(`mission:${ready.id}`); didSomething = true; }
      else { hit('mission', r.body?.error || r.code); if (r.body?.error === 'done') doneMissions.add(ready.id); }
    }
  }

  // 6b. ARM UP — the mission ladder gates on firepower, so a player buys the best gun they can
  //     cover in cash AND crates. Crates come from the checklist and the melt loop.
  const chase = chasing(m, doneMissions);
  if (chase?.req.fp && fpOf(m) < chase.req.fp) {
    const g = GUNS.filter((x) => x.fp >= chase.req.fp && x.cash <= m.cash && x.crates <= m.cb)
      .sort((a, b) => a.cash - b.cash)[0];
    if (g) {
      const buy = await call('POST', `/v1/armory/gun/${g.id}/buy`, { token });
      if (buy.code === 200) {
        await call('POST', `/v1/armory/gun/${g.id}/equip`, { token });
        did('gun'); first(`gun:${g.id}`); didSomething = true;
      } else hit('gun', buy.body?.error || buy.code);
    } else hit('gun', m.cb < 1 ? 'no_crates' : 'cash');
  }

  // 7. THE GYM — train the stat with the biggest deficit on the mission you're chasing.
  //    THE REGIMEN shares this one clock, which is the whole point of its design: a session spent on
  //    a discipline is a session NOT spent on muscle. So the plausible order is the honest one — the
  //    gate you are chasing first, and the disciplines only when there is no gate in sight (which is
  //    also what makes the trainer's drill claimable). Modelling it the other way round would be a
  //    harness that plays optimally for breadth, and would silently slow the mission ladder.
  if (m.trainSeconds === 0 && m.energy >= 10) {
    const gaps = chase ? ['muscle', 'cunning', 'speed']
      .map((k) => [k, (chase.req[k] || 0) - Number(m.stats[k])]).filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1]) : [];
    let trained = false;
    if (!gaps.length && NEW_LOOPS) {
      const reg = await call('GET', '/v1/regimen', { token });
      const want = (reg.body?.drills || []).find((d) => !d.claimed && !d.done)?.discipline
        || (reg.body?.disciplines || []).find((d) => d.level < d.cap)?.id;
      if (want) {
        const r = await call('POST', `/v1/regimen/${want}`, { token });
        if (r.code === 200) { did('regimen'); first('regimen'); didSomething = true; trained = true; }
        else hit('regimen', r.body?.error || r.code);
      }
    }
    if (!trained) {
      const stat = gaps.length ? gaps[0][0] : 'muscle';   // no gate in sight → keep building anyway
      const r = await call('POST', `/v1/train/${stat}`, { token });
      if (r.code === 200) { did('train'); didSomething = true; } else hit('train', r.body?.error || r.code);
    }
  }

  // 7b. THE DRILLS — the trainer's daily job, collected once the day's play has finished it.
  if (NEW_LOOPS) {
    const reg = await call('GET', '/v1/regimen', { token });
    for (const d of (reg.body?.drills || [])) {
      if (d.claimed || !d.done) continue;
      const r = await call('POST', `/v1/regimen/drill/${d.npc}`, { token });
      if (r.code === 200) { did('drill'); first('drill'); didSomething = true; }
      else hit('drill', r.body?.error || r.code);
    }
  }

  // 8. THE GRIND — a real player clicks far faster than once a minute, so they BURN THE NERVE POOL
  //    down and then wait for it. That drain-then-wait shape is the whole pacing question: if the
  //    pool never empties, nerve isn't a throttle and a session has no natural end.
  const menu = crimesFor(lvl);
  const cheapest = menu.length ? Math.min(...menu.map((c) => c.nerve)) : Infinity;
  let nerveLeft = m.nerve, jailedNow = false;
  while (nerveLeft >= cheapest && !jailedNow) {
    const c = menu.find((x) => x.nerve <= nerveLeft);
    const r = await call('POST', `/v1/crimes/${c.id}`, { token });
    if (r.code !== 200) { hit('crime', r.body?.error || r.code); break; }
    nerveLeft -= c.nerve;
    didSomething = true;
    if (r.body.success) did('crime:win');
    else { did('crime:bust'); if (r.body.jailSeconds > 0) jailedNow = true; }
  }

  // 8b. THE RUNGS THE ORDINARY LADDER OBEYS. Three early rungs ask for exactly what steps 2 and 8
  //     already do — "pull a job", "keep pulling jobs", "declare a Path". They cleared fine, but
  //     they were being reported as untested, which understates the trace: the anti-masking bound
  //     only looks at obeyed rungs, so an early rung that DID stick would have been invisible.
  //     Marked here rather than in obeyCoach because obedience happens after it runs.
  const grindLabel = m.coach?.label;
  if (grindLabel && (acted['crime:win'] || 0) > winsBefore) {
    if (grindLabel.startsWith('Pull your first job') || grindLabel.startsWith('Get to level 5')
      || grindLabel.startsWith('Out of nerve')) {
      coachObeyed.add(grindLabel);
      if (!rungDone.has(grindLabel)) rungDone.set(grindLabel, { at: playedMin, worth: m.cash + m.bank, level: m.level });
    }
  }
  if (grindLabel?.startsWith('You\'ve made rank') && pathDeclared) {
    coachObeyed.add(grindLabel);
    if (!rungDone.has(grindLabel)) rungDone.set(grindLabel, { at: playedMin, worth: m.cash + m.bank, level: m.level });
  }

  // 8c. THE PvP CONTRACTS. The daily pool draws `jump` and `bust` alongside the solo kinds, and this
  //     ladder had no way to do either — so on ~2 days in 3 the coach's "today's contracts unclaimed"
  //     rung could never clear and held ~40% of advised play, masking everything below it. Whether
  //     that is the coach's fault or the harness's is exactly the conflation the trace exists to
  //     avoid, and it cannot be answered without trying. A resident is a real character, so the
  //     ordinary verbs work on them: jump the weakest one standing here, spring the first inmate.
  //     A CAP, because the first cut had none and it made the player WORSE: a failed bust is a
  //     stretch in lockup, so retrying every minute put them in a cell 26% of the time and cost a
  //     quarter of the run's crimes. A person tries a couple of times and gets on with their day.
  if (NEW_LOOPS && POPULATE && pvpTries < 3) {
    const d = await call('GET', '/v1/daily', { token });
    // `kind`, not `k` — getDaily renames it on the way out, and reading the wrong field made this
    // whole branch a silent no-op that still printed a pass. That is the client-wiring guard's
    // check-3 class ("the route is right, the field is not real") landing in the harness itself.
    const want = (k) => (d.body?.jobs || []).some((j) => j.kind === k && !j.claimed && j.progress < j.goal);
    if (want('jump') && m.health > 40) {
      const roster = (await call('GET', '/v1/streets', { token })).body?.streets || [];
      const mark = roster.filter((s) => !s.jailed && !s.hospitalized && s.id !== charId)
        .sort((a, b) => a.level - b.level)[0];
      if (mark) {
        pvpTries++;
        const r = await call('POST', `/v1/streets/${mark.id}/jump`, { token });
        if (r.code === 200) { did('jump'); first('jump'); didSomething = true; }
        else hit('jump', r.body?.error || r.code);
      } else hit('jump', 'nobody_on_the_street');
    }
    if (want('bust')) {
      const roster = (await call('GET', '/v1/streets', { token })).body?.streets || [];
      const inmate = roster.find((s) => s.jailed && s.id !== charId);
      if (inmate) {
        pvpTries++;
        const r = await call('POST', `/v1/streets/${inmate.id}/bust`, { token });
        if (r.code === 200) { did(r.body.sprung ? 'bust' : 'bust:miss'); first('bust'); didSomething = true; }
        else hit('bust', r.body?.error || r.code);
      } else hit('bust', 'nobody_in_lockup');
    }
  }

  // 9. daily contracts — claim anything the day's play has already finished
  if (didSomething) {
    const d = await call('GET', '/v1/daily', { token });
    for (const j of (d.body?.jobs || [])) {
      if (j.claimed || j.progress < j.goal) continue;
      const r = await call('POST', `/v1/daily/${j.id}/claim`, { token });
      if (r.code === 200) { did('daily'); first(`daily:day${dayIdx}`); } else hit('daily', r.body?.error || r.code);
    }
  }
  return didSomething;
}

// ── THE SCHEDULE ────────────────────────────────────────────────────────────────────────────────
console.log(`\n━━ OMERTÀ PROGRESSION HARNESS ━━`);
console.log(`a plausible new player: ${SESSIONS_PER_DAY} sitting(s)/day × ${SESSION_MIN} min, over ${DAYS} days`);
console.log(`pacing: level=D(L-1)² D=${PACING.LEVEL_DIVISOR} · energy ${PACING.ENERGY_REGEN_PER_MIN}/min · nerve ${PACING.NERVE_REGEN_PER_MIN}/min`
  + ` · gym ${PACING.TRAIN_CD_MS / 60000}m · missions ${PACING.MISSION_CD_MS / 3600000}h\n`);

const gapMin = Math.max(1, Math.round((24 * 60 - SESSIONS_PER_DAY * SESSION_MIN) / SESSIONS_PER_DAY));
for (let day = 1; day <= DAYS; day++) {
  for (let s = 0; s < SESSIONS_PER_DAY; s++) {
    pvpTries = 0;
    await beat();   // the world kept turning between sittings — new faces, new inmates on the yard
    const before = await me();
    const mark = { ...acted };
    let stalls = 0;
    for (let t = 0; t < SESSION_MIN; t++) {
      const busy = await tick(day);
      if (!busy) stalls++;
      await advance(charId, 1);
      playedMin++;
    }
    stallMin += stalls;
    const after = await me();
    const delta = Object.fromEntries(Object.entries(acted)
      .map(([k, v]) => [k, v - (mark[k] || 0)]).filter(([, v]) => v > 0));
    sessions.push({ day, s: s + 1, lvl: [before.level, after.level], respect: after.respect - before.respect,
      cash: (after.cash + after.bank) - (before.cash + before.bank), stalls, delta });
    await advance(charId, gapMin);   // life happens
  }
}

// ── THE REPORT ──────────────────────────────────────────────────────────────────────────────────
const end = await me();
console.log('SESSION TIMELINE');
console.log('  day  sit   level        respect        net $     idle   what they did');
for (const s of sessions) {
  const acts = Object.entries(s.delta).map(([k, v]) => `${k}×${v}`).join(' ');
  console.log(`  ${String(s.day).padStart(3)}  ${s.s}    ${String(s.lvl[0]).padStart(3)}→${String(s.lvl[1]).padEnd(4)} `
    + `${String('+' + fmt(s.respect)).padStart(10)}  ${String('$' + fmt(s.cash)).padStart(11)}   `
    + `${String(Math.round(s.stalls / SESSION_MIN * 100) + '%').padStart(4)}   ${acts}`);
}

console.log('\nWHERE THE TIME WENT');
console.log(`  played                ${hhmm(playedMin)} across ${sessions.length} sittings`);
console.log(`  idle (nothing to do)  ${Math.round(stallMin / playedMin * 100)}% of played minutes`);
console.log(`  in lockup             ${Math.round(jailMin / playedMin * 100)}% of played minutes`);

console.log('\nWHAT ACTUALLY THROTTLES A SITTING');
const crimes = (acted['crime:win'] || 0) + (acted['crime:bust'] || 0);
console.log(`  crimes                ${(crimes / (playedMin / 60)).toFixed(1)}/hour played`
  + `   (nerve regen ${PACING.NERVE_REGEN_PER_MIN}/min funds the drip)`);
console.log(`  nerve pool            sat at ${Math.round(pool_.nerveSum / pool_.nerveCapSum * 100)}% of cap on average,`
  + ` full at ${Math.round(pool_.nerveAtCap / pool_.ticks * 100)}% of minutes`);
console.log(`  energy pool           full at ${Math.round(pool_.enAtCap / pool_.ticks * 100)}% of minutes`
  + `   (energy is spent by the gym + the garage only)`);
console.log(`  the gym               ${acted.train || 0} sessions — hard-capped at ${Math.floor(SESSION_MIN / (PACING.TRAIN_CD_MS / 60000))}/sitting by the ${PACING.TRAIN_CD_MS / 60000}m cooldown`);
console.log(`  the mission ladder    ${acted.mission || 0} jobs — the ${PACING.MISSION_CD_MS / 3600000}h cooldown is LONGER than a sitting,`
  + ` so it advances ~once per session no matter how long you play`);

console.log('\nACTIONS TAKEN');
for (const [k, v] of Object.entries(acted).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);

console.log('\nWHAT BLOCKED THEM  (the gate a real player hits, and how often)');
for (const [k, v] of Object.entries(blocked).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${k.padEnd(28)} ${v}`);

console.log('\nTIME TO LEVEL');
console.log('  level      played (at the keyboard)      world (wall clock from birth)');
// a level can be SKIPPED (a mission payout jumps several at once) — report the first moment the
// player was AT OR ABOVE it, which is the honest "when did they get there".
const reached = (L) => Object.entries(levelAt).filter(([l]) => Number(l) >= L)
  .map(([, at]) => at).sort((a, b) => a.played - b.played)[0] || null;
for (const L of [2, 3, 5, 8, 10, 15, 20, 25, 30, 40, 50, 75, 100]) {
  const at = reached(L);
  if (at == null) { console.log(`  ${String(L).padStart(5)}      — not reached`); continue; }
  console.log(`  ${String(L).padStart(5)}      ${hhmm(at.played).padEnd(28)}  ${hhmm(at.world)}`);
}

// ── THE GATES ───────────────────────────────────────────────────────────────────────────────────
// Is a level-gated purchase a real milestone when you arrive at its gate, or already pocket change?
// A gate you can cover the moment you unlock it isn't pacing anything. Measured against net worth
// (cash + bank) at the first minute the player was AT the gate's level.
console.log('\nTHE GATES  (can you afford the front the moment you unlock it?)');
console.log('  front         gate   entry cost      net worth at the gate    covers');
for (const b of BUSINESSES) {
  const at = reached(b.lvl);
  const cost = b.tiers[0].cost;
  if (at == null) { console.log(`  ${b.kind.padEnd(12)} lvl ${String(b.lvl).padStart(3)}   $${fmt(cost).padEnd(13)} — never reached`); continue; }
  const pct = Math.round(at.worth / cost * 100);
  const verdict = pct >= 100 ? 'ALREADY AFFORDABLE — the gate paces nothing'
    : pct >= 60 ? 'a short save' : 'a real climb';
  console.log(`  ${b.kind.padEnd(12)} lvl ${String(b.lvl).padStart(3)}   $${fmt(cost).padEnd(13)} $${fmt(at.worth).padEnd(22)} ${String(pct + '%').padStart(5)}  ${verdict}`);
}

console.log('\nMILESTONES');
for (const [k, v] of Object.entries(firsts).filter(([k]) => !k.startsWith('daily:'))) {
  console.log(`  ${k.padEnd(22)} ${hhmm(v)}`);
}

console.log('\nWHERE THEY ENDED');
console.log(`  level ${end.level} · respect ${fmt(end.respect)} · $${fmt(end.cash + end.bank)}`
  + ` · stats ${end.stats.muscle}/${end.stats.cunning}/${end.stats.speed}`);
console.log(`  missions ${doneMissions.size}/${MISSIONS.length} · First Week ${claimedOnboard.size}/6 gameplay tasks`);
console.log(`  the coach says: "${end.coach?.label || '—'}"`);

// THE SOLO CEILING — this player used ONLY crime, the gym, the garage, the Score, the mission
// ladder and the checklist. Everything else in the game (family, Kitchen, PvP, the Den, fronts,
// crew heists, going legit) they never opened. What that ONE loop alone yields is the honest
// answer to "can a player who ignores the other 40 systems still progress?" — a retention read the
// breadth of the build can't give on its own. It is a POLICY BOUND, not a gate: the harness didn't
// try those systems, so this is what the narrowest plausible player gets, not what's reachable.
console.log(`\nTHE SOLO CEILING  (crime + gym + garage + Score + missions ONLY, ${DAYS} days)`);
console.log(`  level ${end.level} · $${fmt(end.cash + end.bank)} · ${doneMissions.size}/${MISSIONS.length} of the story`
  + ` — with zero contact with another player`);

// WHICH SYSTEMS DID THEY EVER SEE? The paragraph above ASSERTS the player never opened the family,
// the Kitchen, the Den or going-legit — true, because the ladder above never calls them. This
// MEASURES it instead, off the same telemetry the ops dashboard reads, so the claim is evidence
// rather than a restatement of the script.
//
// READ THE CAVEAT: this is partly a measurement of the ladder, not only of the game. A system the
// ladder never tries cannot show up. What it is genuinely evidence FOR is the funnel — a plausible
// player, following the coach and the checklist, arrives at a small number of the built systems and
// nothing pushes them toward the rest. That is a discoverability read, not a verdict on the content.
{
  const eng = await opsEngagement(pool, Math.max(30, DAYS + 2));
  const touched = eng.systems.filter((s) => s.events > 0);
  console.log(`\nSYSTEMS THEY ACTUALLY TOUCHED  (measured from telemetry, ${touched.length} of ${eng.systems.length})`);
  for (const s of touched) console.log(`  ${s.system.padEnd(24)} ${String(s.events).padStart(5)} events`);
  const never = eng.systems.filter((s) => !s.events).map((s) => s.system);
  console.log(`  never opened: ${never.length ? never.join(' · ') : 'none'}`);
  console.log('  (this measures the LADDER as much as the game — a system this harness never tries');
  console.log('   cannot appear. What it is evidence for is the FUNNEL: what a plausible player,');
  console.log('   following the coach and the checklist, actually arrives at.)');
}

// ── WHAT THE COACH SAID, AND WHETHER IT MOVED ───────────────────────────────────────────────────
// The ladder above is what the player DID; this is what the game TOLD them to do while they did it.
// A healthy coach walks: each rung is cleared by doing the thing, then the next one appears. A sick
// coach pins — one rung the player cannot clear sits on top and hides the rest.
let coachVerdict = 'ok';
{
  const advised = [...coachMin.entries()].sort((a, b) => b[1] - a[1]);
  const totalAdvised = advised.reduce((a, [, v]) => a + v, 0);
  console.log(`\nTHE COACH  (${advised.length} distinct rungs across ${hhmm(totalAdvised)} of advised play,`
    + ` ${hhmm(coachSilent)} silent)`);
  for (const [label, mins] of advised) {
    const pct = totalAdvised ? Math.round(mins / totalAdvised * 100) : 0;
    console.log(`  ${String(pct + '%').padStart(4)}  ${hhmm(mins).padStart(7)}  ${label}`);
  }
  if (coachPlanDepth.length) {
    const avg = coachPlanDepth.reduce((a, b) => a + b, 0) / coachPlanDepth.length;
    console.log(`  the plan box offered ${avg.toFixed(1)} steps on average (max ${Math.max(...coachPlanDepth)})`);
  }
  // What the player was TOLD vs what they could act on. Stated plainly rather than folded into a
  // pass/fail, because a rung this harness can't reach is a limit of the harness, not of the game.
  console.log(`  obeyed: ${coachObeyed.size ? [...coachObeyed].join(' · ') : 'none'}`);
  // a label that was later obeyed is NOT untested — obeyCoach records a reason before the ordinary
  // ladder gets its turn (8b), so without this the same rung prints in both lists and reads as a bug
  for (const [label, why] of coachCantAct) {
    if (!coachObeyed.has(label)) console.log(`  not tested: "${label}" — ${why}`);
  }
  // the honesty rule, applied to the trace itself: a rung that is in neither list is a rung the
  // harness started and never finished (the Port is multi-stage), and must not vanish from the report
  for (const [label] of advised) {
    if (!coachObeyed.has(label) && !coachCantAct.has(label)) console.log(`  in progress when the run ended: "${label}"`);
  }

  // THE ON-RAMP. Every rung the harness obeyed, with the WAIT between being told and being able to
  // act. This is the question the percentages can't answer: a rung at 70% might be a defect, or it
  // might be an honest "you cannot afford this yet" — and the difference is whether the price is
  // reachable from where the game first says it. Reported, never judged: how long a player should
  // save for their first Kitchen is the founder's call.
  const ramp = [...rungDone.entries()].sort((a, b) => a[1].at - b[1].at);
  if (ramp.length) {
    console.log('\n  THE ON-RAMP  (told → done, and what it cost to get there)');
    for (const [label, done] of ramp) {
      const told = rungFirst.get(label) || done;
      const wait = Math.max(0, done.at - told.at);
      console.log(`    ${label}`);
      console.log(`      told at ${hhmm(told.at).padStart(7)} played (lvl ${told.level}, worth $${fmt(told.worth)})`
        + `  →  done ${hhmm(done.at).padStart(7)} (lvl ${done.level}, worth $${fmt(done.worth)})`
        + `  ·  waited ${hhmm(wait)}`);
    }
  }

  // THE ANTI-MASKING BOUND, applied ONLY to rungs the player actually obeyed. That scoping is the
  // whole correctness of this check. A rung can hold the top spot for two very different reasons:
  //   (a) the player did what it says and it STILL didn't clear  → the F1 defect, uncompletable,
  //       masking every rung below it (measured once at level 128 after thirty days);
  //   (b) the player never did what it says                      → the coach working exactly right,
  //       patiently repeating the highest-value thing left undone.
  // Only (a) is a bug. The first cut of this check didn't distinguish them and duly reported a
  // perfectly healthy rung as a defect on its first run.
  const PIN_PCT = 40;   // an obeyed rung should clear within a few ticks; 40% of a multi-day run is
                        // far past "the player is on their way there" and squarely at "it never went away"
  const pinned = advised.filter(([label, mins]) =>
    coachObeyed.has(label) && totalAdvised && (mins / totalAdvised) * 100 > PIN_PCT);
  if (pinned.length) {
    coachVerdict = `PINNED — "${pinned[0][0]}" held ${Math.round(pinned[0][1] / totalAdvised * 100)}%`
      + ' of advised play AFTER the player did what it says';
    console.log(`\n  ❌ ${coachVerdict}`);
    console.log('     The rung did not clear when its own instruction was carried out, so it masks');
    console.log('     every rung below it. Check that the condition goes FALSE once the thing is done.');
  } else if (advised.length <= 1 && totalAdvised > 60) {
    coachVerdict = 'ONE RUNG — the coach never advanced across the whole run';
    console.log(`\n  ❌ ${coachVerdict}`);
  } else {
    console.log(`\n  ✓ the coach walked: ${advised.length} rungs; every rung the player obeyed cleared`);
  }

  // …and the case the bound deliberately cannot fail on: a rung this harness could NOT act on that
  // still dominated the run. That is not proof of a defect — a solo harness on a solo server is a
  // narrow population — but it IS the shape of one, and it is the population an alpha actually has.
  // Reported loudly, never failed on, because whether "wait for company" should outrank every solo
  // system is a design call and not this script's to make.
  const stuck = advised.filter(([label, mins]) =>
    !coachObeyed.has(label) && coachCantAct.has(label) && totalAdvised && (mins / totalAdvised) * 100 > PIN_PCT);
  for (const [label, mins] of stuck) {
    console.log(`\n  ⚠ "${label}" held ${Math.round(mins / totalAdvised * 100)}% of advised play and this`);
    console.log(`     player could never act on it — ${coachCantAct.get(label)}.`);
    console.log('     Every rung below it went unseen for that whole stretch. On a populated server it');
    console.log('     clears; on a thin one it is a wall. Band it or demote it if that is not intended.');
  }
}

// ── THE REFILL CEILING ──────────────────────────────────────────────────────────────────────────
// Nerve is the pacing wall: the PACING pass made it the limiter deliberately. The level-up refill
// sets nerve to CAP on every crossing, so it is a nerve faucet whose size is the cap and whose rate
// is how often you level. Past the point where the refill returns MORE than the next level costs,
// the wall is gone — you level as fast as you can click, with regen irrelevant. Proven live: at
// level 115 with trained stats and THE CLOCK FROZEN, a pool funding 3 jobs funded 3000, taking the
// player to level 656 and ending at full nerve.
//
// This is arithmetic over the signed constants, so it costs nothing and runs every time. It exists
// because the A/B taken when the refill shipped measured 2h/5h/10h — all of it under level 50, all
// of it below where this turns. A lever measured in the wrong RANGE reads as safe.
{
  const worst = [];
  for (let L = 20; L <= 1500; L += 5) {
    const best = CRIMES.filter((c) => c.lvl <= L).sort((a, b) => b.respect / b.nerve - a.respect / a.nerve)[0];
    if (!best) continue;
    const needNerve = (PACING.LEVEL_DIVISOR * (2 * L - 1)) / (best.respect / best.nerve);
    if (nerveCapOf(L) > needNerve) { worst.push({ L, best: best.id, needNerve, cap: nerveCapOf(L) }); break; }
  }
  console.log('\nTHE REFILL CEILING  (does levelling up hand back more nerve than the level cost?)');
  if (!PACING.LEVEL_UP_REFILL) console.log('  refill is OFF — nerve is bounded by regen at every level.');
  else if (!worst.length) console.log('  bounded at every level up to 1500 — the refill never outruns the curve.');
  else {
    const w = worst[0];
    const day = PACING.LEVEL_UP_REFILL_MAX_DAY;
    console.log(`  RAW CROSSING GOES SELF-SUSTAINING AT LEVEL ${w.L}: the next level costs ~${w.needNerve.toFixed(0)} nerve`
      + ` (via "${w.best}") and a crossing refills ${w.cap}.`);
    // …which is why the bucket exists. Report the BOUNDED contribution, not the raw crossing, or the
    // probe keeps printing an alarm about a hole that is closed and the reader learns to ignore it.
    if (day > 0) {
      console.log(`  ✔ BOUNDED: at most ${day} refills/day (PACING.LEVEL_UP_REFILL_MAX_DAY), so the refill`);
      console.log(`    contributes ≤ ${(day * w.cap / w.needNerve).toFixed(2)} levels/day at level ${w.L}`
        + ' — and the ratio is flat in L (both terms are linear),');
      console.log('    so it stays that bounded at every level above. Regen does the rest, as intended.');
    } else {
      console.log('    ⚠ THE BUCKET IS OFF (MAX_DAY 0): past here nerve stops being a throttle — a player');
      console.log('    levels as fast as they can click and regen is irrelevant. Dials: MAX_DAY, or');
      console.log("    PACING.LEVEL_UP_REFILL false, or the top of the CRIMES respect/nerve curve.");
    }
  }
}

// the headline: the alpha speedrun metric, measured
const atPlayed = (mins) => {
  const hits = Object.entries(levelAt).filter(([, at]) => at.played <= mins).map(([L]) => Number(L));
  return hits.length ? Math.max(...hits) : 1;
};
console.log(`\n  ▸ AFTER 2 HOURS AT THE KEYBOARD: level ${atPlayed(120)}   (the alpha speedrun reached 240)`);
console.log(`  ▸ after 5 hours: level ${atPlayed(300)}   ·   after 10 hours: level ${atPlayed(600)}`);
// Everything above is a MEASUREMENT and reports rather than judges — pacing is the founder's call.
// The coach trace is the exception: a pinned rung is a defect with a right answer, not a dial, so it
// is the one thing this harness fails on.
if (coachVerdict !== 'ok') { console.error(`\nplaythrough FAILED: ${coachVerdict}`); process.exit(1); }
process.exit(0);
