// THE REAL-POSTGRES GATE — everything the pg-mem suites are structurally blind to.
//
// All 48 suites run on pg-mem. That has earned its keep (it caught the INT-arithmetic quirk, the
// correlated-subquery gap, the missing random()), but it is by construction blind to node-pg's own
// contract and to Postgres's real concurrency — and production runs both. On 2026-07-25 that blind
// spot produced, in one night:
//
//   • the API process DYING on every database restart (an unhandled Pool 'error' event)
//   • `loadOwned` issuing 16 overlapping queries on one pooled client (deprecated; removed in pg@9)
//
// Neither was reachable from any pg-mem test. A tester reporting "Internal on every crime" was the
// only signal, and it pointed at the wrong file.
//
// So: boot the real server against real Postgres and assert the things only real Postgres can show.
// Each block below exists because of a specific bug or a specific property that cannot be faked.
// Exits non-zero, so CI fails on regression.
//
//   createdb omerta_check
//   DATABASE_URL=postgres://localhost/omerta_check JWT_SECRET=x MOD_KEY=yyyyyyyyyyyy \
//     MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off node tools/pgcheck.js
import crypto from 'node:crypto';

if (!process.env.DATABASE_URL) {
  console.error('pgcheck needs DATABASE_URL pointed at a real (throwaway) Postgres — that is the whole point.');
  process.exit(2);
}

// The throttle switches itself on whenever DATABASE_URL is set — correct for production, but it
// answers 429 before a request ever reaches the row lock, which is the one thing section 4 exists to
// measure. The buckets themselves are covered by the pg-mem suites; here they would only hide things.
process.env.RATE_LIMIT = 'off';

const fails = [];
const pass = [];
const check = (ok, label, detail = '') => {
  if (ok) { pass.push(label); console.log(`  ✓ ${label}`); }
  else { fails.push(`${label}${detail ? ` — ${detail}` : ''}`); console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

// A pg deprecation is a FAILURE here, not a log line: it means we are using the driver in a way the
// next major removes, and pg-mem will never tell us.
const deprecations = [];
process.on('warning', (w) => { if (/pg|client\.query/i.test(w.message)) deprecations.push(w.message); });

const { buildServer } = await import('../src/server.js');
const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'idempotency-key': crypto.randomUUID() },
    payload: body });
  let json = null; try { json = res.json(); } catch {}
  return { code: res.statusCode, body: json };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. THE SAFETY VALVES actually reach the server');
// Set in db.js as connection `options`. If a future refactor drops them, nothing else notices until
// a stuck query pins a connection — or a row lock freezes a character — in production.
{
  const s = (await pool.query(`SELECT current_setting('statement_timeout') a,
                                      current_setting('lock_timeout') b,
                                      current_setting('idle_in_transaction_session_timeout') c`)).rows[0];
  check(s.a !== '0', 'statement_timeout is set', `got ${s.a}`);
  check(s.b !== '0', 'lock_timeout is set', `got ${s.b}`);
  check(s.c !== '0', 'idle_in_transaction_session_timeout is set', `got ${s.c}`);

  // …and lock_timeout genuinely FIRES rather than queueing forever. pg-mem has no row locks at all,
  // so this property is invisible to every suite.
  // Deliberately NOT `SET lock_timeout` here: setting our own would prove only that Postgres has the
  // feature, while the thing that matters is that OUR pooled connection carries it. So we block on a
  // real row and wait out the configured value — which costs a few seconds and is worth them.
  // pg_settings.setting, not current_setting: the latter renders "8s" and any unit-stripping parse of
  // that reads as 8ms, which would make the deadline assertion below fail against a healthy config.
  const budget = Number((await pool.query(
    "SELECT setting FROM pg_settings WHERE name='lock_timeout'")).rows[0]?.setting) || 0;
  let code = 'none', waited = 0;
  if (budget <= 0) {
    // Never actually block here without a timeout to end it: the query would queue forever and CI
    // would burn its whole job budget on a hang. A hang is a worse failure signal than a failure.
    check(false, "the pool's own lock_timeout aborts a blocked lock", 'lock_timeout is 0 — not probing, that would hang');
  } else {
    const a = await pool.connect(), b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE');
      const t0 = Date.now();
      try { await b.query('BEGIN'); await b.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE'); }
      catch (e) { code = e.code; }
      waited = Date.now() - t0;
    } finally {
      await a.query('ROLLBACK').catch(() => {}); await b.query('ROLLBACK').catch(() => {});
      a.release(); b.release();
    }
    check(code === '55P03', "the pool's own lock_timeout aborts a blocked lock", `waited ${waited}ms, code ${code}`);
    check(waited < budget * 2, 'it gives up on schedule', `waited ${waited}ms against a ${budget}ms budget`);
  }
  const { deadlockToRetry } = await import('../src/game.js');
  check(deadlockToRetry({ code: '55P03' })?.code === 'contention', 'lock_timeout maps to a retryable error');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. THE PROCESS SURVIVES ITS CONNECTIONS BEING KILLED');
// The 2026-07-25 crash: node-pg emits 'error' on the Pool when an IDLE connection dies (a database
// restart, a failover, an idle reaper). An EventEmitter with no 'error' listener THROWS, and an
// uncaught exception kills Node — so the whole API died on every database bounce.
//
// Killing our own idle backends reproduces exactly that event. If the handler in db.js is ever
// removed, THIS PROCESS DIES HERE and CI goes red, which is the entire point.
{
  await pool.query('SELECT 1');                              // ensure at least one pooled connection exists
  const killed = (await pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'idle'`)).rowCount;
  await new Promise((r) => setTimeout(r, 300));              // let the 'error' events land
  let recovered = false;
  for (let i = 0; i < 3 && !recovered; i++) {                // node-pg discards dead clients on checkout
    try { await pool.query('SELECT 1'); recovered = true; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  check(recovered, 'the pool recovers after its connections are killed', `terminated ${killed} backend(s)`);
  const me = await call('GET', '/v1/session');
  check(me.code < 500, 'the server still serves after a connection kill', `got ${me.code}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. THE CORE LOOP, on real Postgres');
const { body: { token } } = await call('POST', '/v1/auth/guest');
{
  const c = await call('POST', '/v1/character', { token, body: { name: `PgCheck ${Date.now() % 100000}` } });
  check(c.code < 500, 'character creation', `${c.code} ${JSON.stringify(c.body).slice(0, 120)}`);

  const rules = (await call('GET', '/v1/rules')).body;
  let bad = null;
  for (const crime of rules.crimes.filter((x) => x.lvl <= 1)) {
    for (const approach of [undefined, 'quiet', 'standard', 'loud']) {
      const r = await call('POST', `/v1/crimes/${crime.id}`, { token, body: approach ? { approach } : undefined });
      if (r.code >= 500) bad ||= `${crime.id}/${approach || 'none'} → ${r.code} ${JSON.stringify(r.body)}`;
    }
  }
  check(!bad, 'every crime, every approach, no 500', bad || '');

  // every read a fresh client fires on load — these run withCharacter, so they exercise the row lock,
  // the accrual, three persists and a commit against real Postgres
  bad = null;
  for (const url of ['/v1/me', '/v1/streets', '/v1/city', '/v1/onboard', '/v1/casino', '/v1/law', '/v1/wire',
                     '/v1/boxing', '/v1/races', '/v1/port', '/v1/market', '/v1/loans', '/v1/business',
                     '/v1/skills', '/v1/underworld', '/v1/estate', '/v1/portfolio', '/v1/pen', '/v1/world']) {
    const r = await call('GET', url, { token });
    if (r.code >= 500) bad ||= `${url} → ${r.code} ${JSON.stringify(r.body)}`;
  }
  check(!bad, 'every board read, no 500', bad || '');

  bad = null;
  for (const [url, body] of [['/v1/train', { stat: 'muscle' }], ['/v1/bank/deposit', { amount: 10 }],
                             ['/v1/travel/neon', undefined]]) {
    const r = await call('POST', url, { token, body });
    if (r.code >= 500) bad ||= `${url} → ${r.code} ${JSON.stringify(r.body)}`;
  }
  check(!bad, 'write actions, no 500', bad || '');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. THE ROW LOCK ACTUALLY SERIALIZES (no lost update)');
// pg-mem's locking is effectively a no-op, so a lost update is INVISIBLE to every suite. Here,
// concurrent same-account deposits must serialize on `SELECT … FOR UPDATE` and sum exactly. If the
// lock were ever weakened, or a read-modify-write slipped outside it, this is where it shows.
{
  const cid = (await call('GET', '/v1/me', { token })).body.character.id;
  // Cash is EARNED, never SQL-injected. Seeding it unledgered would break §10.4 in section 5 below —
  // the codebase's own rule, and this probe has to live by it. Jail/energy are not currency, so those
  // are fair to set; lockup would just make every deposit refuse and pass the check vacuously.
  for (let i = 0; i < 40; i++) {
    await pool.query("UPDATE characters SET nerve=60, energy=200, jail_until=NULL, health=100 WHERE id=$1", [cid]);
    await call('POST', '/v1/crimes/pick', { token });
    if (Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cid])).rows[0].cash) > 5000) break;
  }
  // Measure the DELTA, never a zeroed balance: `SET bank=0` would silently destroy ledgered value
  // and drift §10.4 in section 5 — which is exactly what the first draft of this probe did.
  await pool.query("UPDATE characters SET jail_until=NULL WHERE id=$1", [cid]);
  const bankOf = async () => Number((await pool.query('SELECT bank FROM characters WHERE id=$1', [cid])).rows[0].bank);
  const before = await bankOf();
  const cash = Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cid])).rows[0].cash);
  const N = 8, AMT = Math.floor(cash / (N + 1));
  check(AMT > 0, 'earned enough cash to test concurrent deposits', `cash ${cash}`);
  const results = await Promise.all(Array.from({ length: N }, () =>
    call('POST', '/v1/bank/deposit', { token, body: { amount: AMT } })));
  const ok = results.filter((r) => r.code === 200).length;
  const moved = (await bankOf()) - before;
  // ok MUST be non-zero, or this check passes by doing nothing — the failure mode of the first draft
  check(ok === N, `all ${N} concurrent deposits landed`, `${ok}/${N}: ${results.filter((r) => r.code !== 200).map((r) => JSON.stringify(r.body)).join(' ')}`);
  // Bank interest accrues fractionally on every touch, so the delta carries sub-dollar dust — and
  // `moved` is a float subtraction of two interest-bearing balances, so the dust lands on EITHER side
  // of the sum. A bare `moved >= ok * AMT` therefore fails on a delta of 3383.9999999999995 against
  // an expected 3384, which is a rounding artifact and not a lost update. The thing being detected is
  // off by a WHOLE DEPOSIT (hundreds or thousands), so a cent of tolerance keeps the check exact in
  // every sense that matters while giving the float arithmetic room to be itself.
  const dust = 0.01;
  check(ok > 0 && moved >= ok * AMT - dust && moved < (ok + 1) * AMT,
    `${ok} concurrent deposits summed exactly (no lost update)`, `bank moved ${moved}, expected ${ok * AMT}`);
  check(results.every((r) => r.code < 500), 'concurrency produced no 500s',
    results.filter((r) => r.code >= 500).map((r) => JSON.stringify(r.body)).join(' '));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. A REFUSED ACTION LEAVES NO TRACE');
// **pg-mem's ROLLBACK is a no-op.** Measured: BEGIN, INSERT, ROLLBACK, and the row is still there.
// So every "the action was refused, therefore nothing changed" assertion across all 47 suites is
// vacuous — they pass whether or not the transaction actually unwinds. That is not a small gap: the
// entire economy rests on one-transaction-per-action, and until this check existed, nothing anywhere
// verified that an action which throws mid-flight takes its partial writes with it.
{
  const cid = (await call('GET', '/v1/me', { token })).body.character.id;
  const rows = async (t) => Number((await pool.query(`SELECT COUNT(*) n FROM ${t} WHERE character_id=$1`, [cid])).rows[0].n);
  const cashOf = async () => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cid])).rows[0].cash);

  // Jail them, then attempt a crime. The gate throws AFTER §7.1 accrual has already run and written
  // its ledger rows inside the same transaction — so if the rollback were not real, those rows (and
  // any partial mutation) would survive a refusal.
  await pool.query(`UPDATE characters SET jail_until = now() + interval '10 minutes',
    last_accrued_at = now() - interval '6 hours' WHERE id=$1`, [cid]);
  const [txBefore, cashBefore] = [await rows('transactions'), await cashOf()];
  const refused = await call('POST', '/v1/crimes/pick', { token });
  check(refused.code === 400, 'a jailed crime is refused', `${refused.code} ${JSON.stringify(refused.body)}`);
  check(await rows('transactions') === txBefore, 'the refusal wrote no ledger rows',
    `${await rows('transactions')} vs ${txBefore}`);
  check(await cashOf() === cashBefore, 'the refusal moved no money', `${await cashOf()} vs ${cashBefore}`);

  // and the clock did not advance either — the accrual is deferred, not consumed
  const stale = (await pool.query(
    "SELECT last_accrued_at < now() - interval '5 hours' old FROM characters WHERE id=$1", [cid])).rows[0].old;
  check(stale === true, 'the accrual clock is untouched, so the window is re-accrued on the next touch');
  await pool.query('UPDATE characters SET jail_until=NULL WHERE id=$1', [cid]);
}

console.log('\n6. §10.4 HOLDS on real Postgres');
// The suites prove this on pg-mem, where NUMERIC is JavaScript arithmetic. Real Postgres uses true
// arbitrary-precision NUMERIC with different rounding — so the conservation identities deserve to be
// re-asserted on the engine that actually stores the money.
{
  const { runLedgerInvariants } = await import('../src/invariants.js');
  const inv = await runLedgerInvariants(pool);
  const broken = (inv.checks || []).filter((c) => !c.ok);
  check(inv.ok, `all ${(inv.checks || []).length} ledger identities hold`,
    broken.map((c) => `${c.name} drift ${c.drift}`).join('; '));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. THE SCHEMA IS RE-APPLIABLE (in-place upgrade)');
// Boot applies schema.sql then a derived ADD COLUMN IF NOT EXISTS pass. A second boot against the
// SAME database must be a clean no-op — that is what makes deploying a new build to a live database
// safe. pg-mem always starts empty, so it can never exercise the second boot.
{
  const { makeDb } = await import('../src/db.js');
  let ok = true, err = '';
  try { const p2 = await makeDb(); await p2.query('SELECT 1'); await p2.end(); }
  catch (e) { ok = false; err = e.message; }
  check(ok, 'schema + column migration re-apply cleanly to an existing database', err);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8. A READ DOES NOT WAIT FOR THE WRITE LOCK (D1)');
// The whole point of the lock-free read path, and a property pg-mem cannot express: it has no real
// row locks, so on the suites a read "not blocking" is true whether or not the code takes the lock.
// Here a second session holds SELECT … FOR UPDATE on the player's own character row — exactly what a
// concurrent action does — and the read must still answer. Before D1 it would have queued behind it
// (production measured 1.0s/2.1s/2.3s/4.3s waits) and, past the pool's lock_timeout, failed outright.
{
  const cid = (await call('GET', '/v1/me', { token })).body.character.id;
  // section 5 left them in a cell; the write below must be refused by the LOCK, not by the jail gate
  await pool.query('UPDATE characters SET jail_until = NULL, nerve = 20 WHERE id=$1', [cid]);
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT * FROM characters WHERE id=$1 FOR UPDATE', [cid]);

    const t0 = Date.now();
    const me = await call('GET', '/v1/me', { token });
    const ms = Date.now() - t0;
    check(me.code === 200, 'a read answers while another session holds the row lock', `got ${me.code}`);
    // the pool's lock_timeout is the floor a blocked read would have hit; well under it means it
    // never queued at all rather than merely getting lucky.
    const lockMs = Number((await pool.query("SELECT setting FROM pg_settings WHERE name='lock_timeout'")).rows[0].setting);
    check(ms < Math.max(500, lockMs / 4), 'and answers promptly — it never queued on the lock',
      `took ${ms}ms, lock_timeout ${lockMs}ms`);

    // The board routes moved onto the same path, and answering at all while the row is locked is
    // itself the proof that the lock-free branch is the one being taken — a delegated read would be
    // sitting in the queue behind this holder, not returning.
    for (const url of ['/v1/skills', '/v1/law', '/v1/wire', '/v1/estate', '/v1/world']) {
      const t = Date.now();
      const r = await call('GET', url, { token });
      check(r.code === 200 && Date.now() - t < Math.max(500, lockMs / 4),
        `${url} answers without the lock`, `got ${r.code} in ${Date.now() - t}ms`);
    }

    // the contrast that proves the lock is genuinely held: a WRITE against the same row does wait,
    // and gives up on the pool's own lock_timeout rather than hanging forever.
    const t1 = Date.now();
    const act = await call('POST', '/v1/crimes/pick', { token, body: {} });
    const actMs = Date.now() - t1;
    check(act.code !== 200, 'a write against the same locked row is refused, not served', `got ${act.code}`);
    check(actMs >= lockMs * 0.5, 'and it waited on the lock before giving up', `waited ${actMs}ms`);
  } finally {
    await holder.query('ROLLBACK').catch(() => {});
    holder.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n9. NO node-pg DEPRECATIONS');
await app.close();
await new Promise((r) => setTimeout(r, 200));                // let any late warning land
check(deprecations.length === 0, 'no deprecated driver usage',
  [...new Set(deprecations)].join(' | '));

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${pass.length} passed, ${fails.length} failed`);
if (fails.length) {
  console.error('\nreal-Postgres failures (invisible to the pg-mem suites):');
  for (const f of fails) console.error('  • ' + f);
  process.exit(1);
}
console.log('✅ pgcheck passed — the loop, the locks, the safety valves, the ledger, the migration and the lock-free read path all hold on real Postgres.');
process.exit(0);
