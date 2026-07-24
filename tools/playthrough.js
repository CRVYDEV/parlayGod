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
import { buildServer } from '../src/server.js';
import { CRIMES, MISSIONS, GUNS, CONSTANTS, PACING } from '../src/rules.js';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const DAYS = argOf('days', 7);
const SESSIONS_PER_DAY = argOf('sessions', 2);
const SESSION_MIN = argOf('session', 45);     // minutes of continuous play per sitting

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
let simMinutes = 0; // wall-clock minutes elapsed since the character was born
const advance = async (id, minutes) => {
  simMinutes += minutes;
  const sets = CLOCK_COLS.map((c) => `${c} = ${c} - interval '${minutes} minutes'`).join(', ');
  await pool.query(`UPDATE characters SET ${sets} WHERE id='${id}'`);
};

// ── THE PLAYER ──────────────────────────────────────────────────────────────────────────────────
const { body: auth } = await call('POST', '/v1/auth/guest');
const token = auth.token;
const created = await call('POST', '/v1/character', { token, body: { name: 'Sal Fontana' } });
if (created.code !== 200) { console.error('character create failed', created.body); process.exit(1); }
const charId = created.body.id;
const me = async () => (await call('GET', '/v1/me', { token })).body.character;

// tallies
const acted = {};            // action -> count
const blocked = {};          // "action:code" -> count
const firsts = {};           // milestone -> minutes
const levelAt = {};          // level -> { world, played } at first reach
const sessions = [];
let stallMin = 0, jailMin = 0, playedMin = 0;
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

// ── ONE MINUTE OF PLAY ──────────────────────────────────────────────────────────────────────────
// A plausible ladder: free rewards first, then the big-ticket cooldown jobs, then train toward the
// gate you're chasing, then grind the best crime you can afford. Returns true if anything happened.
async function tick(dayIdx) {
  const m = await me();
  const lvl = m.level;
  if (levelAt[lvl] == null) levelAt[lvl] = { world: simMinutes, played: playedMin };
  pool_.ticks++; pool_.nerveSum += m.nerve; pool_.nerveCapSum += m.maxNerve;
  if (m.nerve >= m.maxNerve) pool_.nerveAtCap++;
  if (m.energy >= m.maxEnergy) pool_.enAtCap++;
  if (m.jailSeconds > 0) { jailMin++; return false; }

  let didSomething = false;

  // 1. the First Week checklist — free money sitting on the table
  const ob = await call('GET', '/v1/onboard', { token });
  for (const t of (ob.body?.tasks || [])) {
    if (t.claimed || !t.ready || t.social) continue;
    const r = await call('POST', `/v1/onboard/${t.id}/claim`, { token });
    if (r.code === 200) { did('onboard'); claimedOnboard.add(t.id); first(`onboard:${t.id}`); didSomething = true; }
    else hit('onboard', r.body?.error || r.code);
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

  // 4. THE GARAGE — boost whenever the heat's off, then melt it down. This is the crate pipeline:
  //    crates are what the armory takes, and the armory is what the mission ladder's fp gates want.
  if (m.energy >= 10) {
    const r = await call('POST', '/v1/garage/boost', { token });
    if (r.code === 200) {
      did(r.body.car ? 'boost' : 'boost:miss'); first('boost'); didSomething = true;
      if (r.body.car?.id) {
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

  // 7. THE GYM — train the stat with the biggest deficit on the mission you're chasing
  if (m.trainSeconds === 0 && m.energy >= 10) {
    const gaps = chase ? ['muscle', 'cunning', 'speed']
      .map((k) => [k, (chase.req[k] || 0) - Number(m.stats[k])]).filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1]) : [];
    const stat = gaps.length ? gaps[0][0] : 'muscle';   // no gate in sight → keep building anyway
    const r = await call('POST', `/v1/train/${stat}`, { token });
    if (r.code === 200) { did('train'); didSomething = true; } else hit('train', r.body?.error || r.code);
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

// the headline: the alpha speedrun metric, measured
const atPlayed = (mins) => {
  const hits = Object.entries(levelAt).filter(([, at]) => at.played <= mins).map(([L]) => Number(L));
  return hits.length ? Math.max(...hits) : 1;
};
console.log(`\n  ▸ AFTER 2 HOURS AT THE KEYBOARD: level ${atPlayed(120)}   (the alpha speedrun reached 240)`);
console.log(`  ▸ after 5 hours: level ${atPlayed(300)}   ·   after 10 hours: level ${atPlayed(600)}`);
process.exit(0);
