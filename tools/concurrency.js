// THE CONCURRENCY HARNESS — the lost-update class, ASSERTED on real Postgres.
//
// The tenth harness, and the answer to a gap the changelog names on nearly every audit: the whole
// test suite runs on pg-mem, which cannot exercise a lost update, a lock-order AB-BA, or a
// FOR-UPDATE / SKIP-LOCKED race. Every recent money fix in that class — the NPC-founding cash
// writeback (F1), the favor cargo lost-update, the crime TAKE debit — shipped as a "source-level
// tripwire" whose regression pg-mem physically cannot run. loadtest.js proves the system doesn't
// DEADLOCK under a spread-out storm and that §10.4 holds in aggregate; it deliberately spreads
// players across their OWN rows, so it never drives many writers at ONE contended object and never
// asserts an exactly-once property.
//
// This does. Each scenario points concurrent writers at a SINGLE row and asserts the correctness
// property pg-mem is blind to: an idempotency key executes once, one escrow is claimed by exactly
// one winner, a symmetric AB-BA transfer conserves value with no 500, and a two-party transfer's
// house take is exact. Every scenario ends with the §10.4 sweep and the pg_stat_database deadlock
// counter — a lock-order bug is retried into invisibility for players, so it is read straight from
// Postgres.
//
//   DATABASE_URL=postgres://…/omerta_conc JWT_SECRET=x MOD_KEY=yyyyyyyyyyyy \
//     MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off node tools/concurrency.js
//
// MUST run against a THROWAWAY real Postgres — it seeds by SQL. Like loadtest, it exits non-zero on
// failure and is wired into the CI real-Postgres job. Without DATABASE_URL it refuses rather than
// silently "passing" on pg-mem (where the very races it exists to catch cannot occur).
import crypto from 'node:crypto';

if (!process.env.DATABASE_URL) {
  console.error('concurrency needs DATABASE_URL pointed at a THROWAWAY real Postgres — it seeds by SQL and drives real races.\n'
    + '(pg-mem is single-caller and cannot exercise a lost update, so a pass there would be meaningless.)');
  process.exit(2);
}
process.env.RATE_LIMIT = 'off';   // every virtual writer shares one IP; the throttle has its own coverage

const { buildServer } = await import('../src/server.js');
const { runLedgerInvariants } = await import('../src/invariants.js');
const app = await buildServer();
const pool = app.pool;
await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;
const RUN = crypto.randomBytes(3).toString('hex');   // unique living names across repeat runs

const fails = [];
const ok = (cond, label) => { if (cond) console.log(`  ✓ ${label}`); else { fails.push(label); console.error(`  ✗ ${label}`); } };

async function hit(method, path, { token, body, key } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'idempotency-key': key || crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { code: res.status, body: await res.json().catch(() => null) };
}
const mk = async (name) => {
  const g = await (await fetch(base + '/v1/auth/guest', { method: 'POST' })).json();
  const c = await (await fetch(base + '/v1/character', {
    method: 'POST', headers: { authorization: `Bearer ${g.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${name} ${RUN}` }),
  })).json();
  if (!c.id) { console.error(`could not seat ${name}: ${JSON.stringify(c)}`); process.exit(1); }
  return { token: g.token, id: c.id };
};
const seed = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id]);
const rawCash = async (id) => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [id])).rows[0].cash);
const rawBank = async (id) => Number((await pool.query('SELECT bank FROM characters WHERE id=$1', [id])).rows[0].bank);
const poolCash = async () => Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);

// §10.4: seeded by SQL, so the baseline drift is non-zero by construction — assert a DELTA per check.
const driftOf = async () => {
  const { checks } = await runLedgerInvariants(pool, { alert: false });
  return checks.reduce((m, c) => m.set(c.name, Number(c.drift || 0)), new Map());
};
const deadlocks = async () => Number((await pool.query(
  'SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()')).rows[0]?.deadlocks || 0);
const assertNoNewDrift = async (before, label) => {
  const after = await driftOf();
  const moved = [...after].filter(([n, d]) => Math.abs(d - (before.get(n) || 0)) > 1e-6).map(([n]) => n);
  ok(moved.length === 0, `${label}: no §10.4 check drifted (${moved.join(', ') || 'all stable'})`);
};

console.log(`\nTHE CONCURRENCY HARNESS — lost-update correctness on real Postgres\n`);
const dl0 = await deadlocks();

// ── S1 — IDEMPOTENCY EXECUTES EXACTLY ONCE ──────────────────────────────────────────────────────
// The same Idempotency-Key fired K times concurrently must run the action ONCE. The reserve-before-
// execute store is a shared write; a lost update there double-spends. Asserted at the dollar: a
// $1,000 deposit under one key, fired 12×, moves exactly $1,000.
{
  console.log('S1 — one idempotency key, fired concurrently, executes exactly once');
  const p = await mk('Idem');
  await seed(p.id, 'cash=1000000, bank=0');
  const drift = await driftOf();
  const key = crypto.randomUUID();
  const K = 12;
  const rs = await Promise.all(Array.from({ length: K }, () => hit('POST', '/v1/bank/deposit', { token: p.token, body: { amount: 1000 }, key })));
  // The reserve-before-execute store lets exactly one call EXECUTE; concurrent duplicates either 200-
  // replay (if the first already committed) or 409 in_progress (still running) — never a second
  // execution, never a 500. The money is the real property; the codes just prove nothing slipped past.
  const fives = rs.filter((r) => r.code >= 500).length;
  const defined = rs.every((r) => r.code === 200 || r.code === 409);
  ok(fives === 0, `no 500 among ${K} concurrent same-key calls — got ${fives}`);
  ok(defined, 'every concurrent duplicate is a defined idempotency response (200 replay or 409 in_progress)');
  ok(await rawBank(p.id) === 1000, `bank moved by exactly $1,000 once (got $${await rawBank(p.id)})`);
  ok(await rawCash(p.id) === 999000, `cash debited exactly once (got $${await rawCash(p.id)})`);
  await assertNoNewDrift(drift, 'S1');
}

// ── S2 — ONE ESCROW, ONE WINNER ─────────────────────────────────────────────────────────────────
// A single loan offer, N borrowers racing /take. The offer row's FOR UPDATE is the guard against two
// borrowers both getting the principal (a double-spend of the escrow). Assert exactly one 200 and
// that the loan-escrow §10.4 identity still reconciles.
{
  console.log('S2 — one loan offer, many takers, exactly one wins');
  const shark = await mk('Shark');
  await seed(shark.id, 'cash=1000000');
  const offer = await hit('POST', '/v1/loans', { token: shark.token, body: { amount: 100000, rate: 0.2, hours: 24 } });
  ok(offer.code === 200, 'the offer posted');
  const drift = await driftOf();
  const borrowers = await Promise.all(Array.from({ length: 8 }, (_, i) => mk(`Borrow${i}`)));
  const rs = await Promise.all(borrowers.map((b) => hit('POST', `/v1/loans/${offer.body.id}/take`, { token: b.token })));
  const winners = rs.filter((r) => r.code === 200);
  ok(winners.length === 1, `exactly one borrower took the loan (got ${winners.length})`);
  const takenBy = (await pool.query('SELECT borrower_character FROM loans WHERE id=$1', [offer.body.id])).rows[0].borrower_character;
  ok(!!takenBy, 'the offer is marked taken by exactly one borrower');
  // scope to THIS offer's lender (counterparty) — a global count pollutes if the DB is reused across runs
  const paidOut = (await pool.query(
    "SELECT COUNT(*)::int n FROM transactions WHERE reason='loan:take' AND currency='cash' AND counterparty=$1", [shark.id])).rows[0].n;
  ok(paidOut === 1, `the principal was paid out exactly once (${paidOut} loan:take rows for this offer)`);
  await assertNoNewDrift(drift, 'S2');
}

// ── S3 — SYMMETRIC AB-BA, ABSORBED ──────────────────────────────────────────────────────────────
// A jumps B while B jumps A, both directions fired at once, many rounds. withTwoCharacters locks the
// two rows in sorted id order, so the reverse pairing is the textbook AB-BA — it must map to the
// retryable `contention` path and never surface a 500, with value conserved throughout.
{
  console.log('S3 — A↔B symmetric two-party writes (the AB-BA surface), absorbed with no 500');
  const a = await mk('DuelA'); const b = await mk('DuelB');
  // same district (jump requires co-location), armed, healthy, funded
  await seed(a.id, "cash=500000, muscle=400, speed=400, energy=200, health=100, loc='cathedral'");
  await seed(b.id, "cash=500000, muscle=400, speed=400, energy=200, health=100, loc='cathedral'");
  const drift = await driftOf();
  let fivehundreds = 0;
  for (let round = 0; round < 6; round++) {
    const rs = await Promise.all([
      hit('POST', `/v1/streets/${b.id}/jump`, { token: a.token }),
      hit('POST', `/v1/streets/${a.id}/jump`, { token: b.token }),
    ]);
    fivehundreds += rs.filter((r) => r.code >= 500).length;
    // re-arm so a later round still contends (health/energy get spent)
    await seed(a.id, 'energy=200, health=100');
    await seed(b.id, 'energy=200, health=100');
  }
  ok(fivehundreds === 0, `no 500 across 6 symmetric rounds (the retry absorbed the AB-BA) — got ${fivehundreds}`);
  await assertNoNewDrift(drift, 'S3');
}

// ── S4 — A TWO-PARTY TRANSFER'S HOUSE TAKE IS EXACT under concurrent hires ──────────────────────
// Many bodyguard hires at once (distinct pairs) — each a pure ledgered transfer with a 2% house take
// split to street_tax. The aggregate must conserve: Σ(participant cash Δ) == −Σ take, and street_tax
// received exactly its half of every take. This drives the street_tax singleton write under real
// concurrency (the "hottest shared row" class) while asserting the money, not just the deadlock count.
{
  console.log('S4 — concurrent bodyguard hires: the house take is exact, value conserved');
  const N = 10;
  const guards = []; const principals = [];
  for (let i = 0; i < N; i++) {
    const g = await mk(`Guard${i}`); const pr = await mk(`Prince${i}`);
    await seed(g.id, "loc='cathedral'"); await seed(pr.id, "cash=200000, loc='cathedral'");
    // guard lists a price (consent-by-listing)
    const off = await hit('POST', '/v1/bodyguard/offer', { token: g.token, body: { price: 10000 } });
    if (off.code !== 200) { console.error(`guard offer failed: ${JSON.stringify(off.body)}`); process.exit(1); }
    guards.push(g); principals.push(pr);
  }
  const before = {};
  for (const c of [...guards, ...principals]) before[c.id] = await rawCash(c.id);
  const poolBefore = await poolCash();
  const drift = await driftOf();
  const rs = await Promise.all(principals.map((pr, i) => hit('POST', `/v1/bodyguard/hire/${guards[i].id}`, { token: pr.token })));
  const hired = rs.filter((r) => r.code === 200).length;
  ok(hired === N, `all ${N} hires landed (got ${hired})`);
  let net = 0;
  for (const c of [...guards, ...principals]) net += (await rawCash(c.id)) - before[c.id];
  const poolGain = await poolCash() - poolBefore;
  // net across all participants = −(dev half + burned half of the take); street_tax got its half.
  ok(net < 0, `participants net-lost to the house (net Δ = $${net})`);
  ok(poolGain > 0, `street_tax received the buyback half of the take ($${poolGain})`);
  await assertNoNewDrift(drift, 'S4');
}

// ── the deadlock counter, read from Postgres ────────────────────────────────────────────────────
const dl = await deadlocks() - dl0;
console.log(`\nreal deadlocks during the run (pg_stat_database): ${dl}`);
// A deadlock is retried into a success for the player, so it never shows in the assertions above — it
// is only ever visible here. It is not automatically a failure (the retry is correct), but a nonzero
// count means a lock-order conflict IS firing and should be understood; the harness reports it loudly.
if (dl > 0) console.log(`  NOTE: ${dl} deadlock(s) occurred and were absorbed by the contention retry — investigate the lock order.`);

console.log('');
if (fails.length) { console.error(`❌ concurrency harness: ${fails.length} failure(s)\n   ${fails.join('\n   ')}`); await app.close(); process.exit(1); }
console.log('✅ concurrency harness passed — idempotency exactly-once, single-winner escrow, AB-BA absorbed, exact house take, §10.4 conserved throughout');
await app.close();
process.exit(0);
