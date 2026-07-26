// THE CONCURRENCY HARNESS — what happens when many people play at once.
//
// The fourth harness, and it measures the one axis the other three cannot:
//
//   tools/sim.js         — does the economy conserve, and how big is each faucet   (sequential)
//   tools/playthrough.js — what does one person actually experience               (sequential)
//   tools/pgcheck.js     — the node-pg + real-Postgres contract                   (a few pairs)
//   tools/loadtest.js    — MANY PLAYERS AT ONCE                                   (this file)
//
// Why it exists. Every §10.4 proof in this repo is sequential. Conservation under a single actor is a
// weaker claim than it sounds: lost updates, double-spends and torn two-party transfers live entirely
// in the overlap between requests. And production has already shown contention is real — four of one
// player's requests queued on their own character row for 1.0s / 2.1s / 2.3s / 4.3s, which is what
// motivated the D1 lock-free read path. Nobody has ever measured what this game does with 30 people
// in it.
//
// MUST run against real Postgres. pg-mem is single-threaded and implements no row locks, so it cannot
// express contention at all — a green pg-mem run would be evidence of nothing. This refuses to start
// without DATABASE_URL, for the same reason pgcheck does.
//
//   createdb omerta_load
//   DATABASE_URL=postgres://localhost/omerta_load JWT_SECRET=x MOD_KEY=yyyyyyyyyyyy \
//     MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off node tools/loadtest.js
//
// Knobs: LOAD_PLAYERS (30), LOAD_SECONDS (20), LOAD_PVP_BPS (2500 = a quarter of writes are two-party).
//
// THE HEADLINE ASSERTION is §10.4 drift DELTA — measured before the storm and after, and required to
// be zero. Not "drift is zero" (the harness SQL-seeds spending money, so the baseline is non-zero by
// construction), but "the storm did not move it by one cent". A lost update or a double-spend shows up
// there and nowhere else. Everything else the harness prints is diagnosis for when that fails, plus
// the latency and error picture a player would actually feel.
//
// ── FIRST MEASUREMENT (2026-07-26, one shared container: server + Postgres + all clients) ─────────
//
//   players   req/s    /v1/me p50/p95   board p50/p95   jump p50/p95   deadlocks   §10.4
//        5     156          15 /  31         5 /   8       53 / 100           0    clean
//       15     163          43 / 109        10 /  20      166 / 298           0    clean
//       30     178          92 / 213        42 /  95      257 / 413           0    clean
//       50     179         163 / 330       108 / 168      402 / 581           0    clean
//
// TWO THINGS THAT MATTER, and one that does not.
//
// (1) ZERO deadlocks at every level, including 50 players converging on a handful of victims — 658
//     two-party `withTwoCharacters` lock acquisitions in a 15s run at N=30 alone. The sorted-id lock
//     order holds under real contention. Nobody ever saw a `contention` retry either. This is the
//     result the ~30 red-team passes on lock order were arguing for, now measured instead of reasoned.
//
// (2) The SHAPE is throughput-bound, not lock-bound: req/s is FLAT (~160–180) from 5 players to 50,
//     while latency rises about linearly with player count. That is a saturated queue — the box is out
//     of CPU and requests wait their turn. A lock-contention wall looks completely different
//     (superlinear latency, deadlocks, retries). So the answer to more players here is more CPU, not a
//     locking rewrite. Which of the two it was could not be known without measuring.
//
// (3) The absolute req/s is a property of THIS BOX and means nothing for production — server, database
//     and 50 clients were all competing for the same cores. Do not quote it as capacity.
//
// THE FINDING THIS PRODUCED, AND WHAT IT WAS WORTH. The first run showed `/v1/me` costing ~3× a board
// read uncontended (15ms vs 5ms at N=5) — the most-called endpoint in the game, and `loadOwned` was
// issuing 16 sequential round trips to build it. Folding those into ONE union query, measured with this
// harness on the same box back to back:
//
//                     before      after
//   N=5   req/s          188        246   (+31%)
//         /v1/me p50      14          9   (−36%)
//   N=30  req/s          222        296   (+33%)
//         /v1/me p50      74         47   (−36%)
//         /v1/me p95     175        103   (−41%)
//         board  p50      37         28   (boards call loadOwned too, so they moved as well)
//
// Note the throughput number moved, not just the latency: `loadOwned` runs on EVERY authed request, so
// its round-trip count was a third of the server's total database traffic. That is the value of having
// an instrument — the change was one function, and without measuring it there would be no way to tell
// a real 30% from a plausible-sounding refactor. Run the A/B (stash the change, same box, same run) for
// any future change to this path.
import crypto from 'node:crypto';

if (!process.env.DATABASE_URL) {
  console.error('loadtest needs DATABASE_URL pointed at a real (throwaway) Postgres.');
  console.error('pg-mem has no row locks and one thread — it cannot express contention, so a green run there would mean nothing.');
  process.exit(2);
}
// The per-IP and per-token throttles switch themselves on when DATABASE_URL is set. Correct for
// production; here every virtual player shares one IP, so they would 429 long before reaching a row
// lock — measuring the bucket instead of the database. The buckets have their own coverage.
process.env.RATE_LIMIT = 'off';

const PLAYERS = Number(process.env.LOAD_PLAYERS || 30);
const SECONDS = Number(process.env.LOAD_SECONDS || 20);
const PVP_BPS = Number(process.env.LOAD_PVP_BPS || 2500);

const { buildServer } = await import('../src/server.js');
const { runLedgerInvariants } = await import('../src/invariants.js');
const app = await buildServer();
const pool = app.pool;

// Real HTTP over a real socket, not app.inject(). inject() bypasses the server's own connection
// handling, and connection behaviour under load is part of what is being measured.
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;

const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0);
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

// ── the metric sink ─────────────────────────────────────────────────────────────────────────────
// Errors are bucketed by MEANING, not by status code. `contention` is the codebase's retryable
// deadlock/lock-timeout mapping and is a legitimate (if unpleasant) outcome; `db_down` and a pool
// timeout are infrastructure; a 500 is a bug. Lumping them together would hide the only one that is
// actually alarming.
const stats = { calls: 0, byClass: new Map(), errors: new Map(), statuses: new Map() };
const note = (cls, ms) => {
  if (!stats.byClass.has(cls)) stats.byClass.set(cls, []);
  stats.byClass.get(cls).push(ms);
  stats.calls++;
};
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

async function hit(cls, method, path, { token, body } = {}) {
  const t0 = performance.now();
  let code = 0; let json = null;
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        // every mutation carries one, exactly as the console does — so the idempotency store is
        // under load too, which is itself a shared-write surface
        ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    code = res.status;
    json = await res.json().catch(() => null);
  } catch (e) {
    bump(stats.errors, `fetch:${e.code || e.message}`);
    note(cls, performance.now() - t0);
    return { code: 0, body: null };
  }
  note(cls, performance.now() - t0);
  bump(stats.statuses, code);
  if (code >= 500) bump(stats.errors, `HTTP ${code}: ${json?.error || 'unknown'}`);
  else if (json?.error) bump(stats.errors, json.error);
  return { code, body: json };
}

// ── phase 1: a population ───────────────────────────────────────────────────────────────────────
console.log(`\nTHE CONCURRENCY HARNESS — ${PLAYERS} players, ${SECONDS}s storm, real Postgres\n`);
process.stdout.write(`  seating ${PLAYERS} players… `);
// Living names are unique among the living (§7.13 resolves referral codes by name), and this harness is
// meant to be run repeatedly against the SAME throwaway database — so the names have to be unique per
// run, not per index, or the second run dies on `name_taken` before it measures anything.
const RUN = crypto.randomBytes(3).toString('hex');
const players = [];
for (let i = 0; i < PLAYERS; i++) {
  const g = await (await fetch(base + '/v1/auth/guest', { method: 'POST' })).json();
  const c = await (await fetch(base + '/v1/character', {
    method: 'POST',
    headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Hand ${RUN}${i}` }),
  })).json();
  if (!c.id) { console.error(`\ncould not create player ${i}: ${JSON.stringify(c)}`); process.exit(1); }
  players.push({ token: g.token, id: c.id });
}
// Spending money, seeded by SQL. This is the one place the harness breaks the sim's no-seeding rule,
// and it is safe BECAUSE the headline assertion is a before/after DELTA: the seed lands in the
// baseline, and the storm still has to leave the number untouched. Earning it honestly would take
// hours of simulated grinding to measure a 20-second window.
// Everyone starts in ONE district on purpose: `jump` requires co-location, so a randomly-scattered
// population spends the storm collecting `district` refusals and the two-party lock — the single most
// valuable thing here — is barely taken. (First run: 101 of 280 PvP attempts died on `district`.)
//
// And specifically the NEON MILE, because the Den lives there (`CASINO.DISTRICT`). Seeding everyone to
// the docks instead cost the whole singleton leg: every dice call died on the district gate before it
// ever touched `den_volume` or `street_tax`, so the two hottest shared rows in the game were measured
// at zero contention. Same class of instrument error as the medic — a leg that silently measures
// nothing reads exactly like a leg that passes.
const ids = players.map((p) => p.id);
await pool.query(
// Ammo matters more than it looks. A jump costs 5 rounds and the gate is INSIDE withTwoCharacters, so an
// unarmed attacker still locks both character rows and then rolls back — which exercises lock ORDERING
// but releases almost immediately. A run without ammo showed 531 of 722 PvP calls refused that way, so
// the locks were being taken and dropped rather than held across a real two-party write. Arming everyone
// is what makes the contention measurement worth anything.
  `UPDATE characters SET cash = 5000000, bank = 1000000, health = 100, energy = 500, nerve = 100,
     ammo = 20000, respect = 250000, jail_until = NULL, hosp_until = NULL, loc = 'neon'
   WHERE id = ANY($1::text[])`, [ids]);
console.log('done');

// THE MEDIC — the other half of keeping the contended path hot. A jump hospitalizes its loser, and a
// hospitalized player cannot jump, so within seconds the whole population is in the ward and PvP stops
// (first run: 219 `hosp_self` + 44 `hosp` refusals). A real server at this concurrency has fresh
// attackers arriving constantly; here that is simulated by topping everyone back up.
//
// IT MUST NEVER TOUCH CURRENCY. cash / bank / $OMR / cb / ammo are what the §10.4 delta assertion
// watches, and writing them mid-storm would MASK exactly the lost update this harness exists to find.
// Vitals and timers are not §10.4 surfaces, so resetting them is free.
//
// ONE ROW PER STATEMENT, and this is not a style choice — it is the difference between measuring the
// game and measuring the harness. The first version was a single bulk `UPDATE … WHERE id = ANY($1)`,
// which locks 30 rows in whatever order Postgres picks while the game locks rows individually in
// sorted id order. That is a textbook lock-order conflict, and it produced 94 deadlocks in a 15-second
// run — every one of which I initially read as a finding about the game's PvP path. Postgres's own log
// named the culprit: all 94 reports contained this UPDATE. Zero involved only game statements.
//
// A single-row UPDATE in its own implicit transaction cannot participate in a cycle: it never holds one
// lock while waiting for another. So the medic can no longer be the deadlocking party, and any deadlock
// this harness now reports belongs to the game.
const medic = setInterval(() => {
  for (const id of ids)
    pool.query(`UPDATE characters SET health = 100, energy = 500, nerve = 100, hosp_until = NULL,
      jail_until = NULL WHERE id = $1`, [id]).catch(() => {});
}, 400);

// ── the §10.4 baseline + the deadlock counter ───────────────────────────────────────────────────
const driftOf = async () => {
  const { checks } = await runLedgerInvariants(pool);
  return checks.reduce((m, c) => m.set(c.name, Number(c.drift || 0)), new Map());
};
// pg_stat_database.deadlocks is the only place a real deadlock is VISIBLE. The codebase maps 40P01 to
// a retryable `contention` error and retries it, which is correct for players and completely opaque
// for us: a lock-order bug can be firing hundreds of times a minute and every request still succeeds.
// So this number is read straight from Postgres, before and after.
const dbStats = async () => (await pool.query(
  `SELECT deadlocks, xact_rollback, blks_read FROM pg_stat_database WHERE datname = current_database()`)).rows[0] || {};

const before = await driftOf();
const statsBefore = await dbStats();

// ── phase 2: the storm ──────────────────────────────────────────────────────────────────────────
// Each virtual player loops a realistic mix until the clock runs out. The mix is deliberately
// contention-heavy — it is not a throughput benchmark, it is a lock-order and conservation probe:
//
//   READS       the D1 lock-free path (a player's own row, no FOR UPDATE) — the console polls these
//   SOLO WRITE  crime / bank / gym: one character row locked
//   PVP         jump: withTwoCharacters, TWO character rows in sorted order — the AB-BA surface
//   SINGLETON   casino dice: character + den_volume + street_tax, the hottest shared rows in the game
//
// Everyone shares one small pool of targets on purpose. Spreading PvP across 30 players makes
// collisions rare; the interesting case is many attackers converging on the same rows.
const deadline = Date.now() + SECONDS * 1000;
let ops = 0;
const roll = () => Math.random() * 10000;

async function virtualPlayer(me, idx) {
  while (Date.now() < deadline) {
    const r = roll();
    if (r < 3500) {                                   // 35% reads
      await hit('read', 'GET', '/v1/me', { token: me.token });
    } else if (r < 5000) {
      await hit('read:board', 'GET', '/v1/streets', { token: me.token });
    } else if (r < 5000 + PVP_BPS) {                  // two-party writes
      // converge on a few victims so the two-row lock actually contends
      const victim = players[(idx + 1 + Math.floor(Math.random() * 3)) % players.length];
      if (victim.id !== me.id) await hit('write:pvp', 'POST', `/v1/streets/${victim.id}/jump`, { token: me.token });
    } else if (r < 8000) {
      await hit('write:crime', 'POST', '/v1/crimes/pick', { token: me.token });
    } else if (r < 9000) {
      // the singleton surface: den_volume + street_tax are shared by every gambler in the game
      await hit('write:casino', 'POST', '/v1/casino/dice', { token: me.token, body: { amount: 100, bet: 'pass' } });
    } else {
      const dir = Math.random() < 0.5 ? 'deposit' : 'withdraw';
      await hit('write:bank', 'POST', `/v1/bank/${dir}`, { token: me.token, body: { amount: 1000 } });
    }
    ops++;
  }
}

process.stdout.write(`  storm running (${SECONDS}s)… `);
const t0 = performance.now();
await Promise.all(players.map((p, i) => virtualPlayer(p, i)));
const elapsed = (performance.now() - t0) / 1000;
clearInterval(medic);
console.log(`done — ${ops} operations in ${elapsed.toFixed(1)}s`);

// ── phase 3: what happened ──────────────────────────────────────────────────────────────────────
const after = await driftOf();
const statsAfter = await dbStats();

console.log(`\nTHROUGHPUT`);
console.log(`  ${(stats.calls / elapsed).toFixed(0)} requests/sec sustained across ${PLAYERS} concurrent players`);

console.log(`\nLATENCY (ms) — what a player feels`);
console.log(`  (absolute values depend on the machine — server, database and ${PLAYERS} clients all share this`);
console.log(`   box. The RATIOS between classes are the signal, and so is the shape as PLAYERS rises.)`);
console.log(`  ${'class'.padEnd(14)} ${'n'.padStart(6)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}`);
for (const [cls, xs] of [...stats.byClass].sort())
  console.log(`  ${cls.padEnd(14)} ${String(xs.length).padStart(6)} ${pct(xs, 0.5).toFixed(0).padStart(7)} `
    + `${pct(xs, 0.95).toFixed(0).padStart(7)} ${pct(xs, 0.99).toFixed(0).padStart(7)} ${Math.max(...xs).toFixed(0).padStart(7)}`);

console.log(`\nOUTCOMES`);
const statusList = [...stats.statuses].sort((a, b) => b[1] - a[1]);
console.log('  ' + statusList.map(([c, n]) => `${c}×${n}`).join('  '));
// A 400 is the game refusing an action (no nerve, in hospital, jailed) — expected and healthy under a
// blind random mix. What must not appear is a 500, or a pool/connection failure.
const sorted = [...stats.errors].sort((a, b) => b[1] - a[1]);
if (sorted.length) {
  console.log(`\n  error taxonomy (top 12):`);
  for (const [k, n] of sorted.slice(0, 12)) console.log(`    ${String(n).padStart(6)} × ${k}`);
} else console.log('\n  no errors at all');

const contention = stats.errors.get('contention') || 0;
const fives = statusList.filter(([c]) => c >= 500).reduce((s, [, n]) => s + n, 0);
const dbDown = stats.errors.get('db_down') || 0;

console.log(`\nCONTENTION, measured at the database`);
const dl = Number(statsAfter.deadlocks || 0) - Number(statsBefore.deadlocks || 0);
const rb = Number(statsAfter.xact_rollback || 0) - Number(statsBefore.xact_rollback || 0);
console.log(`  real deadlocks (pg_stat_database):        ${dl}`);
// Rollbacks track REFUSED ACTIONS, not failures: every GameError (no nerve, wrong district, target in
// hospital) aborts its transaction by design. Expect this to land near the 4xx count — it is only
// interesting if it greatly EXCEEDS it, which would mean transactions are dying for some other reason.
const refused = statusList.filter(([c]) => c >= 400 && c < 500).reduce((s, [, n]) => s + n, 0);
console.log(`  transaction rollbacks:                    ${rb}  (vs ${refused} refused actions — a refusal `
  + `rolls back by design, so these should track each other)`);
console.log(`  players who SAW a 'contention' retry:     ${contention}`);
console.log(`  pool/connection failures:                 ${[...stats.errors].filter(([k]) => /fetch:|timeout|pool/i.test(k)).reduce((s, [, n]) => s + n, 0)}`);
if (dl > 0 && contention === 0)
  console.log(`  NOTE: ${dl} deadlock(s) happened and NO player saw an error — the retry absorbed them.`
    + ` That is the mapping working, and also why this number has to be read from Postgres directly.`);

// ── the headline: did concurrency move the ledger? ──────────────────────────────────────────────
console.log(`\n§10.4 UNDER CONCURRENCY — the delta must be zero`);
let drifted = 0;
for (const [name, d0] of before) {
  const d1 = after.get(name) ?? 0;
  const delta = d1 - d0;
  if (delta !== 0) {
    drifted++;
    console.log(`  ✗ ${name}: moved by ${money(delta)} (${money(d0)} → ${money(d1)})`);
  }
}
if (!drifted) console.log(`  ✓ all ${before.size} checks unmoved by ${ops} concurrent operations`);

await app.close();

// ── the verdict ─────────────────────────────────────────────────────────────────────────────────
const problems = [];
if (drifted) problems.push(`${drifted} §10.4 check(s) drifted under concurrency — a lost update or double-spend`);
if (fives) problems.push(`${fives} server error(s) (5xx) — a bug, not contention`);
if (dbDown) problems.push(`${dbDown} db_down response(s) — the pool could not get a connection`);

if (problems.length) {
  console.error(`\n❌ loadtest FAILED\n   - ${problems.join('\n   - ')}`);
  process.exit(1);
}
console.log(`\n✅ loadtest passed — ${PLAYERS} concurrent players, ${ops} operations, `
  + `${(stats.calls / elapsed).toFixed(0)} req/s: no 5xx, no pool exhaustion, and §10.4 conservation `
  + `unmoved (${dl} real deadlock(s) absorbed by the retry mapping).`);
