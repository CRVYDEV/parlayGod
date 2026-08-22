// BOARD COST — what each polled board COSTS the database, which is the half tools/pollcost.js says
// out loud it cannot see: "this counts REQUESTS, not their cost. A board that runs one indexed lookup
// and a board that scans a table both count 1."
//
// That blind spot hid a real one. /v1/leaderboard/city ran an unbounded population scan TWICE per
// call — 57ms at 3,000 players — while pollcost counted it as 1, the same as a six-row lookup. Per
// call it is linear in the population; the SERVER-WIDE total is quadratic, because each of N idle
// players polls it and pays cost(N). At the poll-cost ceiling that was ~180 seconds of database time
// a minute, roughly three CPU cores for one card, on the half `npm run loadtest` already measured as
// binding (~1.9 cores of database against node's ~1 at 284 req/s).
//
// So this sizes every board a polled screen fetches, at a population big enough for the difference
// between an indexed lookup and a scan to be visible, and prints them worst-first. It is a
// MEASUREMENT, not a pass/fail: a board being expensive is a finding for a person, and a threshold
// that fails the build would either be set so high it never fires or so low it fires on the flat ones
// and gets routed around.
//
// REAL POSTGRES ONLY, and that is load-bearing rather than fussy: pg-mem is a different engine with a
// different planner, and it disagrees about exactly this. Measuring the standing scan there reported
// a SUPER-LINEAR curve where real Postgres is linear — a wrong shape, confidently, in the direction
// that would have made the write-up overstate the problem.
//
// NOT IN CI, and deliberately so — like pollcost and mobile it is a measurement rather than a gate,
// it wants a big seeded database, and a threshold that failed the build would either sit so high it
// never fires or so low it fires on the flat boards and gets routed around. What it FINDS gets a real
// guard: the sequential scan it turned up on the per-request character lookup is now pgcheck §9c,
// which does run in CI and fails by name if the index goes.
//
// Run:  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg -o '-p 5433 -k /tmp' start"
//       DATABASE_URL='postgres://postgres@/board?host=/tmp&port=5433' node tools/boardcost.js [players]
import { buildServer } from '../src/server.js';
import * as G from '../src/game.js';
import { HOME_BOARDS } from '../src/home.js';
import { STREETS_BOARDS } from '../src/streets.js';
import { CITYWIDE_BOARDS } from '../src/citywide.js';
import * as Standing from '../src/standing.js';
import * as W from '../src/growth.js';

if (!process.env.DATABASE_URL) {
  console.error('boardcost needs real Postgres — pg-mem is a different planner and disagrees about\n' +
    'exactly the shape being measured here (it reported super-linear where Postgres is linear).');
  process.exit(1);
}
process.env.RATE_LIMIT = 'off';

const PLAYERS = Number(process.argv[2] || 3000);
const app = await buildServer();
// The caches are what this measures the effect OF, so they are off while sizing: a warm memo reports
// 0.05ms for a board that costs 57ms cold, which is the answer to a different question. Set AFTER the
// boot on purpose — STANDING_CACHE_MS is classified TEST_ONLY and preflight treats a DATABASE_URL as
// production, so setting it earlier refuses the boot. That it works at all here is the memo reading
// its window PER CALL rather than capturing it at import.
process.env.STANDING_CACHE_MS = '0';
const pool = app.pool;

// ── a real player, through the real routes, so every board has a live character to read ──
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const { body: { token } } = await call('POST', '/v1/auth/guest');
await call('POST', '/v1/character', { token, body: { name: 'Cost Probe' } });
const me = (await call('GET', '/v1/me', { token })).body.character;
// Name loudly rather than TypeError'ing three lines down: the one way this fails is a DIRTY database
// (living-name uniqueness refuses the second 'Cost Probe'), and a fresh throwaway per run is the rule.
if (!me?.id) { console.error('no probe character — is the database dirty? create a fresh one per run.'); process.exit(1); }
const acctId = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [me.id])).rows[0].a;

// ── the population: synthetic, bulk, and only as deep as the boards being measured actually read ──
// (accounts + account_persistent + characters is what every population scan in the game joins over;
// a board that reads further than that is sized against a thin tail, which is stated in the verdict.)
process.stdout.write(`seeding ${PLAYERS} players… `);
const t0 = Date.now();
await pool.query(`
  INSERT INTO accounts (id, auth_provider, auth_subject)
  SELECT gen_random_uuid(), 'guest', 'cost-' || g FROM generate_series(1, $1) g`, [PLAYERS]);
await pool.query(`
  INSERT INTO account_persistent (account_id, kills, tycoon_earned, prestige, race_wins, honor_peak, statecraft)
  SELECT id, (random()*200)::int, (random()*5000000)::numeric, (random()*40)::int,
         (random()*90)::int, (random()*100)::int, (random()*300)::int
    FROM accounts WHERE auth_subject LIKE 'cost-%'`);
await pool.query(`
  INSERT INTO characters (id, account_id, name, respect, cash, loc, season)
  SELECT gen_random_uuid(), id, 'Filler ' || substr(id::text, 1, 8), (random()*400000)::int,
         (random()*100000)::numeric, 'docks', 1
    FROM accounts WHERE auth_subject LIKE 'cost-%'`);
console.log(`${Date.now() - t0}ms`);
await pool.query('ANALYZE');

// ── the boards ──
// the three aggregates fan in 28 of them; the rest are the standalone fetches a polled screen makes
// (pollcost's own per-screen request lists are where these come from).
//
// THE WRAPPER IS PAID ONCE, NOT PER BOARD, and getting that wrong is how the first run of this file
// lied: it opened a readCharacter around EVERY board, so all 28 carried one character read apiece and
// the floor sat at ~6.6ms — visible only because `streets.prices` is a PURE function with no database
// access at all and reported 6.63ms. An aggregate opens the context once and runs its whole map
// inside it, so that is what is measured here, with the wrapper itself sized separately as /v1/me.
const inner = [
  ...HOME_BOARDS.map(([k, route, fn]) => [`home.${k}`, route, fn]),
  ...STREETS_BOARDS.map(([k, route, fn]) => [`streets.${k}`, route, fn]),
  ...CITYWIDE_BOARDS.map(([k, route, fn]) => [`citywide.${k}`, route, fn]),
];
const standalone = [
  ['me (the readCharacter wrapper)', '/v1/me', async () => (await call('GET', '/v1/me', { token })).body],
  ['bulletin', '/v1/bulletin', async () => (await call('GET', '/v1/bulletin', { token })).body],
  // these two are inline handlers rather than exported functions, so they are driven through the real
  // route — which also carries routing overhead, a constant few hundred microseconds either way.
  ['gangs', '/v1/gangs', async () => (await call('GET', '/v1/gangs')).body],
  ['city', '/v1/city', async () => (await call('GET', '/v1/city')).body],
  ['leaderboard.city', '/v1/leaderboard/city', async () => ({
    board: await Standing.cityStanding(pool), you: await Standing.myStanding(pool, acctId) })],
  ['leaderboard.recruiters', '/v1/leaderboard/recruiters', async () => ({
    recruiters: await W.recruiterLeaderboard(pool), families: await W.recruitingFamilyLeaderboard(pool) })],
];

const REPS = 7;
const median = (ms) => { ms.sort((a, b) => a - b); return ms[Math.floor(ms.length / 2)]; };
const results = [];

// the aggregate boards: one context, every board timed inside it, REPS times over
const samples = new Map(inner.map(([name]) => [name, []]));
const errs = new Map();
for (let i = 0; i < REPS + 1; i++) {
  await G.readCharacter(pool, acctId, async (ch, client, h) => {
    for (const [name, , fn] of inner) {
      const t = process.hrtime.bigint();
      try { await fn(ch, client, h, { online: [] }); } catch (e) { errs.set(name, String(e.message || e).slice(0, 60)); continue; }
      if (i > 0) samples.get(name).push(Number(process.hrtime.bigint() - t) / 1e6); // i===0 warms
    }
    return {};
  });
}
for (const [name, route] of inner.map(([n, r]) => [n, r])) {
  // a board that could not run is REPORTED, never silently dropped — a missing row in the table reads
  // exactly like a cheap board.
  results.push(errs.has(name) ? { name, route, median: null, err: errs.get(name) }
    : { name, route, median: median(samples.get(name)) });
}

for (const [name, route, fn] of standalone) {
  try {
    await fn();
    const ms = [];
    for (let i = 0; i < REPS; i++) { const t = process.hrtime.bigint(); await fn(); ms.push(Number(process.hrtime.bigint() - t) / 1e6); }
    results.push({ name, route, median: median(ms) });
  } catch (e) {
    results.push({ name, route, median: null, err: String(e.message || e).slice(0, 60) });
  }
}

results.sort((a, b) => (b.median ?? -1) - (a.median ?? -1));
console.log(`\n  BOARD COST at ${PLAYERS} players (median of ${REPS}, caches off)\n`);
for (const r of results) {
  const cost = r.median === null ? `— ${r.err}` : `${r.median.toFixed(2).padStart(7)} ms`;
  console.log(`  ${cost}  ${r.name.padEnd(24)} ${r.route}`);
}
const failed = results.filter((r) => r.median === null);
const heavy = results.filter((r) => r.median !== null && r.median >= 5);
console.log(`\n  ${heavy.length} board(s) at 5ms or more — these are the ones whose cost grows with the`);
console.log(`  playerbase, and each is paid once per polling player per window.`);
if (failed.length) console.log(`  ${failed.length} board(s) could not be measured here (listed above, not skipped silently).`);
console.log('\n✅ boardcost — what each polled board costs the database. A measurement, not a gate.');
await app.close();
process.exit(0);
