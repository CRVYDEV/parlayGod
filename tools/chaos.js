// THE CHAOS HARNESS — what survives being interrupted.
//
// The fifth harness. The other four all measure a system that is allowed to FINISH:
//
//   tools/sim.js         — does the economy conserve                    (nothing interrupts it)
//   tools/playthrough.js — what one player experiences                  (nothing interrupts it)
//   tools/pgcheck.js     — the node-pg + real-Postgres contract         (nothing interrupts it)
//   tools/loadtest.js    — many players at once                         (nothing interrupts it)
//   tools/chaos.js       — WHAT HAPPENS WHEN SOMETHING DIES MID-WAY     (this file)
//
// Roughly twenty worker sweeps in this codebase carry a comment claiming they are idempotent, or
// per-row transactional, or safe to re-run. Not one of them has ever been interrupted and then run
// again. "Idempotent" is a claim about a code path that only becomes true when something kills it in
// the middle and the second run is checked — which is what this does.
//
// The other half is the outage the game already had. On 2026-07-25 the API process DIED on every
// database restart (an unhandled Pool 'error' event), and a tester reporting "Internal on every crime"
// was the only signal. That was found by accident. Scenario 3 does it deliberately.
//
// MUST run against real Postgres, and against one this harness is allowed to STOP AND START — it kills
// backends and (optionally) bounces the server. Never point it at anything you care about.
//
//   DATABASE_URL=postgres://…/omerta_chaos JWT_SECRET=x MOD_KEY=yyyyyyyyyyyy \
//     MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off \
//     PG_CTL='/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgl/d' node tools/chaos.js
//
// PG_CTL is optional: without it scenario 3 (full database restart) is SKIPPED rather than faked, and
// says so. A skipped scenario that announces itself is honest; one that silently passes is the failure
// mode this whole repo keeps finding. (CI skips it — a service container gives no pg_ctl on the
// database host — so scenario 3 only ever runs when someone points this at a local Postgres.)
//
// On a Debian/Ubuntu package install, pg_ctl must run as the postgres user and be told where the
// config lives, which the packaged layout separates from the data directory. A two-line wrapper does
// it, and PG_CTL takes any command, not just a literal pg_ctl:
//
//   printf '%s\n' '#!/bin/sh' \
//     'exec su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
//        -o \x27-c config_file=/etc/postgresql/16/main/postgresql.conf\x27 $*"' > /tmp/pgctl.sh
//   chmod +x /tmp/pgctl.sh && PG_CTL=/tmp/pgctl.sh npm run chaos
//
// Run it that way before any deploy that touches the pool, a transaction boundary, or db.js. It is the
// only check that exercises the 2026-07-25 outage end to end: the process surviving the database going
// away, 503 rather than 500 while it is gone, and recovery with no redeploy.
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('chaos needs DATABASE_URL pointed at a THROWAWAY Postgres — it kills backends and may restart the server.');
  process.exit(2);
}
process.env.RATE_LIMIT = 'off';

const PG_CTL = process.env.PG_CTL || null;
const fails = [];
const notes = [];
const check = (ok, label, detail = '') => {
  if (ok) console.log(`  ✓ ${label}`);
  else { fails.push(`${label}${detail ? ` — ${detail}` : ''}`); console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The server under test runs IN THIS PROCESS, which is the point: the failure this harness exists to
// catch is the process DYING, and a child process would let it die quietly behind a socket error.
// The cost is that a real crash takes the harness with it before any ✗ line prints — a raw node stack
// where a verdict belongs. So name it, then die anyway.
//
// It must EXIT NON-ZERO. An uncaughtException handler that swallows the throw would keep the process
// alive and every check would pass — it would convert the one finding this harness has ever made into
// a green run. Verified by removing the src/db.js client-error handler and confirming this fires.
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (err) => {
  console.error(`\n❌ chaos FAILED — THE PROCESS DIED (${ev}). In production this is the whole API going`
    + ` down, not one request failing.\n   ${err?.stack || err}`);
  process.exit(1);
});

const { buildServer } = await import('../src/server.js');
const { runLedgerInvariants } = await import('../src/invariants.js');
let app = await buildServer();
let pool = app.pool;
await app.listen({ port: 0, host: '127.0.0.1' });
let base = `http://127.0.0.1:${app.server.address().port}`;

const api = async (method, path, { token, body } = {}) => {
  try {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { code: res.status, body: await res.json().catch(() => null) };
  } catch (e) { return { code: 0, body: null, err: e.code || e.message }; }
};

// §10.4, as a map, so scenarios can assert a DELTA rather than an absolute (the harness seeds by SQL,
// so the baseline is non-zero by construction — the question is only whether chaos moved it).
const drift = async () => {
  const { checks } = await runLedgerInvariants(pool, { alert: false });
  return checks.reduce((m, c) => m.set(c.name, Number(c.drift || 0)), new Map());
};
const deltas = (a, b) => [...a].filter(([k, v]) => (b.get(k) ?? 0) !== v)
  .map(([k, v]) => `${k}: ${v} → ${b.get(k)}`);

// Ledger rows grouped by reason — the double-payout detector. If an interrupted sweep re-pays on the
// second run, the row COUNT for its reason goes up without any new work existing to justify it.
const ledgerCounts = async () => {
  const r = await pool.query('SELECT reason, count(*)::int n, sum(amount)::numeric s FROM transactions GROUP BY reason');
  return new Map(r.rows.map((x) => [x.reason, { n: x.n, s: Number(x.s) }]));
};

const mk = async (name) => {
  const g = await (await fetch(base + '/v1/auth/guest', { method: 'POST' })).json();
  const c = await (await fetch(base + '/v1/character', { method: 'POST',
    headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }) })).json();
  if (!c.id) { console.error(`could not create ${name}: ${JSON.stringify(c)}`); process.exit(1); }
  await pool.query(`UPDATE characters SET cash=5000000, bank=1000000, energy=500, nerve=100, ammo=5000,
    respect=250000, health=100, jail_until=NULL, hosp_until=NULL, loc='neon' WHERE id=$1`, [c.id]);
  return { ...c, token: g.token };
};
const RUN = crypto.randomBytes(3).toString('hex');

console.log(`\nTHE CHAOS HARNESS — interrupting things on purpose\n`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('1. THE WORKER IS KILLED MID-SWEEP, THEN RUNS AGAIN');
// The claim under test: every sweep is idempotent and per-row transactional, so a worker that dies
// halfway leaves no half-settled state and the next run finishes the job without paying twice.
{
  // Build real settle-able work: expired auction lots carrying live bids. sweepAuctions hammers them,
  // pays out and burns — exactly the shape where a double-run would double-pay.
  const alice = await mk(`Chaos A${RUN}`);
  const bob = await mk(`Chaos B${RUN}`);
  await pool.query(`UPDATE account_persistent SET omr = 5000 WHERE account_id IN
    (SELECT account_id FROM characters WHERE id = ANY($1::text[]))`, [[alice.id, bob.id]]);

  // Clear this week's lots first. Lots are drawn per week and settle once, so a SECOND run against the
  // same throwaway database finds them already settled and sets up nothing — and the double-payout
  // check below would then pass on zero work, which reads exactly like passing on real work. (That is
  // the same trap the load harness hit twice; a fixture that silently empties is worse than one that
  // errors.) The harness owns this fixture on a throwaway DB, so re-materialising is fair game.
  await pool.query('DELETE FROM auctions');
  const board = (await api('GET', '/v1/auction', { token: alice.token })).body;
  const lots = (board?.lots || []).slice(0, 3);
  const bidLots = [];
  for (const [i, lot] of lots.entries()) {
    const who = i % 2 ? bob : alice;
    const r = await api('POST', `/v1/auction/${lot.id}/bid`, { token: who.token, body: { amount: lot.minBid || 10 } });
    if (r.code === 200) bidLots.push(lot.id);
  }
  // ...and make them due: the sweep only settles lots whose week is over.
  await pool.query(`UPDATE auctions SET week = week - 2 WHERE status='live'`);
  check(bidLots.length > 0, `set up ${bidLots.length} live auction lot(s) with real bids to settle`);

  const before = await drift();
  const ledgerBefore = await ledgerCounts();

  // Kill the worker at three different points in its first tick. SIGKILL, not SIGTERM: no cleanup
  // handler, no graceful drain — the way a container dies.
  const killAt = [120, 400, 900];
  for (const ms of killAt) {
    const w = spawn('node', ['src/worker.js'], { env: process.env, stdio: 'ignore' });
    await sleep(ms);
    w.kill('SIGKILL');
    await new Promise((r) => w.on('exit', r));
  }
  console.log(`  … worker SIGKILLed mid-tick at ${killAt.join('ms, ')}ms`);

  // now let one run to completion — POLLED, not a fixed sleep. A flat timeout has to be sized for the
  // slowest machine that will ever run this, and if it is wrong the harness fails for being slow
  // rather than for being broken. A CI check that goes flaky gets ignored, which is worse than not
  // having it: the worker boots the whole schema (~1,035 ALTERs) before it sweeps anything, and that
  // alone can outlast a naive 6s window on a shared runner. So: wait for the WORK to be done, with a
  // generous ceiling for the case where it genuinely never completes.
  const done = spawn('node', ['src/worker.js'], { env: process.env, stdio: 'ignore' });
  const settledCount = async () => Number((await pool.query(
    `SELECT count(*) n FROM auctions WHERE status='settled' AND lot_id = ANY($1::text[])`, [bidLots])).rows[0].n);
  for (let waited = 0; waited < 60000 && await settledCount() < bidLots.length; waited += 500) await sleep(500);
  done.kill('SIGKILL');
  await new Promise((r) => done.on('exit', r));

  const after = await drift();
  const ledgerAfter = await ledgerCounts();
  const moved = deltas(before, after);
  check(moved.length === 0, '§10.4 unmoved by three interrupted sweeps plus a full one', moved.join('; '));

  // THE DOUBLE-PAYOUT CHECK, as an EQUALITY. Each lot that carried a bid must produce EXACTLY ONE
  // `auction:win`: more means an interrupted run left something half-settled and the next run paid it
  // again; fewer means a kill lost a settlement the resume never picked up. An inequality (`wins <=
  // settled`) was the first version and it passes at zero, which is no test at all.
  const settled = (await pool.query(
    `SELECT count(*)::int n FROM auctions WHERE status='settled' AND lot_id = ANY($1::text[])`, [bidLots])).rows[0].n;
  const wins = (ledgerAfter.get('auction:win')?.n || 0) - (ledgerBefore.get('auction:win')?.n || 0);
  check(wins === bidLots.length && settled === bidLots.length,
    `each bid lot settled EXACTLY once: ${wins} payout(s), ${settled} settled, ${bidLots.length} bid on`,
    `expected ${bidLots.length} of each`);

  // and nothing is left in an impossible in-between state
  const stuck = (await pool.query(
    `SELECT count(*)::int n FROM auctions WHERE status NOT IN ('live','settled','lapsed')`)).rows[0].n;
  check(stuck === 0, 'no lot left in a half-settled state', `${stuck} lot(s) in limbo`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n2. BACKENDS TERMINATED MID-TRANSACTION, UNDER LOAD');
// pg_terminate_backend on a connection that is *inside* a transaction is the cheap version of a
// crash: the transaction is rolled back by Postgres, the client sees a broken connection. The
// question is whether the app double-applies anything while retrying, and whether the pool recovers.
{
  const crew = [];
  for (let i = 0; i < 6; i++) crew.push(await mk(`Chaos K${RUN}${i}`));
  const before = await drift();
  let kills = 0;
  const reaper = setInterval(async () => {
    try {
      const r = await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND state IN ('active','idle in transaction') LIMIT 2`);
      kills += r.rowCount;
    } catch { /* the reaper's own connection can be the casualty */ }
  }, 150);

  const deadline = Date.now() + 6000;
  const codes = new Map();
  const bump = (k) => codes.set(k, (codes.get(k) || 0) + 1);
  await Promise.all(crew.map(async (p) => {
    while (Date.now() < deadline) {
      const r = await api('POST', '/v1/casino/dice', { token: p.token, body: { amount: 100, bet: 'pass' } });
      bump(r.err ? `net:${r.err}` : (r.body?.error ? `${r.code}:${r.body.error}` : String(r.code)));
    }
  }));
  clearInterval(reaper);
  await sleep(500);

  const after = await drift();
  const moved = deltas(before, after);
  check(moved.length === 0, `§10.4 unmoved while ${kills} backend(s) were killed mid-transaction`, moved.join('; '));
  console.log(`     outcomes: ${[...codes].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join('  ')}`);
  // the server must still be answering at all
  const alive = await api('GET', '/v1/city');
  check(alive.code === 200, 'the server is still serving after the reaper');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n3. THE DATABASE IS STOPPED AND RESTARTED UNDER LOAD');
// The 2026-07-25 incident, deliberately. Before the Pool 'error' handler was added, this KILLED the
// API process — the visible symptom being "Internal on every button" on the platform's auto-restart.
// What must be true now: the process survives, players get a legible 503 rather than a 500 that reads
// like a bug, /health agrees, and it recovers by itself with no redeploy.
if (!PG_CTL) {
  notes.push('scenario 3 SKIPPED — set PG_CTL to a pg_ctl command with -D to let the harness stop/start Postgres');
  console.log('  ⊘ skipped (no PG_CTL) — not faked; the outage path is genuinely unmeasured in this run');
} else {
  const player = await mk(`Chaos D${RUN}`);
  const before = await drift();
  const seen = { during: new Map(), after: new Map() };
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  execSync(`${PG_CTL} stop -m fast`, { stdio: 'ignore' });
  await sleep(400);
  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/v1/crimes/pick', { token: player.token });
    bump(seen.during, r.err ? `net:${r.err}` : `${r.code}:${r.body?.error || 'ok'}`);
    await sleep(120);
  }
  const health = await api('GET', '/health');
  const processAlive = health.code !== 0; // a dead process refuses the connection outright

  execSync(`${PG_CTL} start`, { stdio: 'ignore' });
  // wait for Postgres to accept connections again
  for (let i = 0; i < 40; i++) { const h = await api('GET', '/health'); if (h.code === 200) break; await sleep(250); }

  for (let i = 0; i < 6; i++) {
    const r = await api('POST', '/v1/crimes/pick', { token: player.token });
    bump(seen.after, r.err ? `net:${r.err}` : `${r.code}:${r.body?.error || 'ok'}`);
    await sleep(100);
  }

  const during = [...seen.during];
  const dbDown = during.filter(([k]) => k.includes('db_down')).reduce((s, [, n]) => s + n, 0);
  const internal = during.filter(([k]) => k.includes('internal')).reduce((s, [, n]) => s + n, 0);
  console.log(`     during outage: ${during.map(([k, n]) => `${k}×${n}`).join('  ')}`);
  console.log(`     after restart: ${[...seen.after].map(([k, n]) => `${k}×${n}`).join('  ')}`);

  check(processAlive, 'THE API PROCESS SURVIVED the database going away');
  check(health.code === 503, '/health answers 503 during the outage (a monitor can alert on the code alone)',
    `got ${health.code}`);
  check(dbDown > 0 && internal === 0,
    'players get 503 db_down, never a 500 that reads like a bug', `${dbDown} db_down, ${internal} internal`);
  const recovered = [...seen.after].some(([k]) => k.startsWith('200'));
  check(recovered, 'RECOVERED BY ITSELF after Postgres returned — no redeploy, no restart');
  const moved = deltas(before, await drift());
  check(moved.length === 0, '§10.4 unmoved across the whole outage', moved.join('; '));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n4. (RETIRED) THE WAGE EPOCH');
// This scenario killed `runWageEpoch` mid-loop and proved the crash-resume arithmetic minted exactly
// the uninterrupted amount — the highest-stakes resume in the codebase, because it MINTED $OMR.
// Economy v3 step 1 retired the faucet outright: there is no payer to interrupt, and the property it
// protected (a crash cannot over-emit) is now guaranteed by there being no emission at all.
//
// Kept as a line rather than deleted so the numbering of the scenarios below does not shift under
// anyone reading an older run, and so the reason is visible where the test used to be.
console.log('   ⏭  skipped — the Street Wage is retired (economy v3 step 1); nothing mints $OMR in game.');

// ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n5. TWO-PARTY TRANSFERS, INTERRUPTED');
// Scenario 2 kills backends under a PvE load. This aims the same weapon at the two-party path
// specifically, where a torn transaction is not merely a failed request but MONEY IN ONE PLACE AND
// NOT THE OTHER: `withTwoCharacters` debits one player and credits another inside a single
// transaction, and the whole §10.4 argument rests on that being atomic under interruption.
{
  const a = await mk(`Chaos T${RUN}a`);
  const b = await mk(`Chaos T${RUN}b`);
  // The back-room dice: a taxed player-to-player transfer, consent by listing, and REPEATABLE.
  // The bodyguard market was the first choice and it measured almost nothing — a hire persists until
  // a lethal hit consumes it, so 229 of 230 attempts came back `guarded` and exactly ONE transfer
  // actually happened while the reaper ran. A scenario that lands one sample reads exactly like a
  // scenario that passes.
  await api('POST', '/v1/casino/fade', { token: b.token, body: { limit: 5000 } });

  const startA = Number((await pool.query('SELECT cash + bank AS w FROM characters WHERE id=$1', [a.id])).rows[0].w);
  const before = await drift();
  let kills = 0;
  const reaper = setInterval(async () => {
    try {
      const r = await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND state IN ('active','idle in transaction') LIMIT 2`);
      kills += r.rowCount;
    } catch { /* the reaper's own connection can be the casualty */ }
  }, 120);

  // nerve is the back room's throttle. Topping it up keeps the transfer path saturated, and nerve is
  // not a §10.4 currency, so seeding it cannot contaminate the ledger assertion below — which is the
  // whole reason the medic touches nerve and never cash.
  const medic = setInterval(() => {
    pool.query('UPDATE characters SET nerve = 100 WHERE id = $1', [a.id]).catch(() => {});
  }, 300);

  const codes = new Map();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await api('POST', `/v1/casino/dice/${b.id}`, { token: a.token, body: { amount: 500 } });
    const k = r.err ? `net:${r.err}` : (r.body?.error ? `${r.code}:${r.body.error}` : String(r.code));
    codes.set(k, (codes.get(k) || 0) + 1);
  }
  clearInterval(medic);
  clearInterval(reaper);
  await sleep(500);

  console.log(`     outcomes: ${[...codes].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}×${n}`).join('  ')}`);
  const ok = codes.get('200') || 0;
  check(ok > 0, `${ok} two-party transfer(s) completed while ${kills} backend(s) were being killed`,
    'none completed — the scenario proved nothing');
  const moved = deltas(before, await drift());
  check(moved.length === 0, '§10.4 unmoved: no transfer was left half-applied', moved.join('; '));
  // and the payer's books agree with their ledger to the cent — the §10.4 sweep above is the formal
  // version over every character at once; this is the same claim for one player, in a form a human
  // can read. It is CASH + BANK, matching invariant (a): the cash-currency ledger spans both, so
  // bank interest is a cash-currency row that lands in `bank`. Comparing against `cash` alone was
  // the first cut, and it "failed" by exactly the ~$2.36 of interest that five seconds pays on a
  // $1M balance — an instrument disagreeing with the authoritative check, which is always the way
  // round to bet: the sweep was right and the reading was wrong.
  const endA = Number((await pool.query('SELECT cash + bank AS w FROM characters WHERE id=$1', [a.id])).rows[0].w);
  const ledgerA = Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id=$1 AND currency='cash'", [a.id])).rows[0].s);
  check(Math.abs((startA + ledgerA) - endA) < 0.01,
    `the payer's books match their ledger exactly after the killings ($${Math.round(endA)})`,
    `start ${startA} + ledger ${ledgerA} != ${endA}`);
}

await app.close();
for (const n of notes) console.log(`\nNOTE: ${n}`);
if (fails.length) {
  console.error(`\n❌ chaos FAILED\n   - ${fails.join('\n   - ')}`);
  process.exit(1);
}
// The summary must not claim what was skipped. Without PG_CTL the outage scenario never ran, and
// saying "the API survives a database restart" on the back of a skipped test is the same overclaim
// this harness exists to catch — it would read as green for the exact failure that started all this.
console.log(`\n✅ chaos passed — interrupted sweeps resume without paying twice, killed backends leave `
  + `no transfer half-applied, `
  + (PG_CTL
    ? 'and the API survives a database restart with a legible 503 and recovers unaided.'
    : 'and §10.4 is unmoved throughout. THE FULL-OUTAGE SCENARIO DID NOT RUN (no PG_CTL) — that path is unmeasured here.'));
