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
import { TREASURY } from '../src/rules.js'; // read the claim floor, never restate it

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
// WAS THIS DATABASE ALREADY IN USE? Read before this harness creates anything, so it is a fact about
// what it was handed rather than about what it did. Only §6 cares: unlike the other harnesses, which
// SQL-seed and therefore assert a before/after DELTA, §6 asserts the ledger identities ABSOLUTELY —
// which is only meaningful on a database nothing has seeded value into behind its back.
const preExistingChars = Number((await pool.query('SELECT count(*) n FROM characters')).rows[0].n);
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
  // SKIPPED, LOUDLY, on a database that was already in use — never quietly reported as a bug.
  //
  // This leg asserts the identities ABSOLUTELY, so it only means anything on a database nothing has
  // seeded into. Point it at one `loadtest` or `chaos` has run against and it reports a nine-figure
  // "ledger failure" that is entirely their SQL seeding. That happened during this session and cost
  // real time chasing it — a false bug report is worse than no report.
  //
  // Detecting it by guessing at the drift was the first cut, and it was worse than useless: the
  // heuristic would have fired on a GENUINE drift too, printing "probably just seeding, ignore" over
  // the exact finding this harness exists to surface. Skipping on a fact known before the run starts
  // — the database was not empty — can't misclassify anything.
  if (preExistingChars > 0) {
    console.log(`  ⃠ SKIPPED — this database already held ${preExistingChars} character(s) when pgcheck`
      + ' started, so the absolute ledger identities are not meaningful here (another harness seeds by'
      + ' SQL). Run `createdb omerta_check` and point pgcheck at a FRESH database to exercise this.');
  } else {
    const inv = await runLedgerInvariants(pool, { alert: false });
    const broken = (inv.checks || []).filter((c) => !c.ok);
    check(inv.ok, `all ${(inv.checks || []).length} ledger identities hold`,
      broken.map((c) => `${c.name} drift ${c.drift}`).join('; '));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6b. loadOwned's UNION returns what the fourteen queries did");
// loadOwned fetches fourteen small result sets in ONE round trip, as a UNION ALL over a shared
// narrow shape with hand-written casts, demultiplexed in JS. It runs on every authed request, so it
// is the single most-executed query in the game — and it is exactly the kind of change pg-mem cannot
// police:
//
//   * pg-mem returns `numeric` as a NUMBER; node-pg returns it as a STRING. Every branch that
//     carries a number now goes through an explicit `Number()`, and whether that is right can only
//     be checked here.
//   * a branch whose typed NULLs are wrong fails at PARSE time on Postgres ("UNION types … cannot
//     be matched") — a 500 on every request — and pg-mem's pairwise left-to-right unification
//     accepts shapes Postgres rejects, and vice versa.
//   * the suites drive characters who own almost nothing, so twelve of the fourteen branches are
//     EMPTY in every existing test. An empty branch proves nothing about a populated one.
//
// So: seed a row in every branch and compare the demultiplexed output against the ORIGINAL query
// for that branch, field by field, INCLUDING the JS type. A future fifteenth branch that forgets a
// cast, or a field read raw where it used to be coerced, fails here.
{
  // its own character, made through the API like a player's — nothing here touches §6's fixtures
  const { body: { token: uTok } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: uTok, body: { name: `Union Uli ${Date.now() % 100000}` } });
  const A = { id: (await call('GET', '/v1/me', { token: uTok })).body.character.id };
  const accOf = (await pool.query('SELECT account_id FROM characters WHERE id=$1', [A.id])).rows[0].account_id;
  const gId = 'g-union-' + Date.now();
  await pool.query('INSERT INTO gangs (id, name, tag) VALUES ($1,$2,$3)', [gId, 'Union Family ' + Date.now(), 'UNI']);
  for (const [sql, params] of [
    ["INSERT INTO character_rackets (character_id, racket_id, level) VALUES ($1,'numbers',3)", [A.id]],
    ["INSERT INTO character_assets (character_id, asset_id) VALUES ($1,'watch')", [A.id]],
    ["INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,'cigs',7)", [A.id]],
    ["INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,'ammo',42)", [A.id]],
    ["INSERT INTO account_gear (account_id, gear_id) VALUES ($1,'ring')", [accOf]],
    ["INSERT INTO character_guns (character_id, gun_id) VALUES ($1,'pistol')", [A.id]],
    ['INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,$3)', [gId, A.id, 'boss']],
    ["INSERT INTO makings (character_id, drug_id, qty) VALUES ($1,'weed',12)", [A.id]],
    // two rows here, so a single-row group cannot hide a demultiplexing bug
    ["INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ($1,'weed',5,73)", [A.id]],
    ["INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ($1,'coke',3,88)", [A.id]],
    ["INSERT INTO character_skills (character_id, skill_id) VALUES ($1,'bruiser')", [A.id]],
    ["INSERT INTO npc_standing (character_id, npc_id, standing) VALUES ($1,'doc',44)", [A.id]],
    ["INSERT INTO npc_standing (character_id, npc_id, standing) VALUES ($1,'armorer',61)", [A.id]],
    ["INSERT INTO npc_grudges (character_id, npc_id, count) VALUES ($1,'doc',2)", [A.id]],
    // (D11 2026-08-05: the 'pf' UNION branch left loadOwned with the Portfolio — no seed, no count)
    ["INSERT INTO estates (account_id, name, tier, spent_omr) VALUES ($1,'The Villa',3,915.234567)", [accOf]],
  ]) await pool.query(sql, params);

  // the ORIGINAL per-branch queries, kept here deliberately: this section is a DIFFERENTIAL test,
  // so it needs the thing being differed against. If a branch's source table or filter changes, the
  // line below changes with it — which is the review moment the round-trip collapse should have.
  const originals = {
    rk: ['SELECT racket_id, level FROM character_rackets WHERE character_id=$1', A.id],
    as: ['SELECT asset_id FROM character_assets WHERE character_id=$1', A.id],
    cargo: ['SELECT good_id, qty FROM character_cargo WHERE character_id=$1 AND qty>0', A.id],
    items: ['SELECT item_id, qty FROM character_items WHERE character_id=$1 AND qty>0', A.id],
    gear: ['SELECT gear_id FROM account_gear WHERE account_id=$1', accOf],
    guns: ['SELECT gun_id FROM character_guns WHERE character_id=$1', A.id],
    gm: ['SELECT gang_id, role, joined_at FROM gang_members WHERE character_id=$1', A.id],
    mk: ['SELECT drug_id, qty FROM makings WHERE character_id=$1 AND qty>0', A.id],
    st: ['SELECT drug_id, qty, quality FROM stash WHERE character_id=$1', A.id],
    sk: ['SELECT skill_id FROM character_skills WHERE character_id=$1', A.id],
    npc: ['SELECT npc_id, standing, touched_at FROM npc_standing WHERE character_id=$1', A.id],
    grudge: ['SELECT npc_id, count, since FROM npc_grudges WHERE character_id=$1 AND count > 0', A.id],
    est: ['SELECT name, tier, spent_omr FROM estates WHERE account_id=$1', accOf],
  };

  const { loadOwned } = await import('../src/game.js');
  const ch = (await pool.query('SELECT * FROM characters WHERE id=$1', [A.id])).rows[0];
  const c = await pool.connect();
  let owned = null, boom = '';
  try { owned = await loadOwned(c, ch); } catch (e) { boom = e.message; }
  check(!!owned, 'the union PARSES and runs on real Postgres with every branch populated', boom);

  if (owned) {
    // each branch's rows survived the round trip, in the right numbers
    const counts = {
      rk: owned.rackets.length, as: owned.assets.length,
      cargo: Object.keys(owned.cargo).length, items: Object.keys(owned.items).length,
      gear: owned.gear.length, guns: owned.guns.length, gm: owned.gangId ? 1 : 0,
      mk: Object.keys(owned.makings).length, st: owned.stash.length, sk: owned.skills.size,
      npc: Object.keys(owned.npc).length, grudge: Object.keys(owned.grudges).length,
      est: owned.estate ? 1 : 0,
    };
    const wrong = [];
    for (const [g, [sql, param]] of Object.entries(originals)) {
      const want = (await pool.query(sql, [param])).rows.length;
      if (counts[g] !== want) wrong.push(`${g}: union ${counts[g]} vs original ${want}`);
    }
    check(wrong.length === 0, 'every branch returns the same rows the original query did', wrong.join('; '));

    // …and each VALUE came out of the right slot. This is the check that earns the section: the
    // union packs fourteen different row shapes into six generic columns, so a branch reading `n2`
    // where it means `n` silently swaps two fields — here, a stash line's quantity and its purity.
    // Row counts still match, no error is raised, and every existing suite passes, because they all
    // drive characters whose stash is EMPTY. Verified by mutation: swapping those two slots fails
    // exactly this line and nothing else in the tree.
    const slots = [
      ['cargo.cigs', owned.cargo.cigs, 7], ['items.ammo', owned.items.ammo, 42],
      ['makings.weed', owned.makings.weed, 12], ['racketLevels.numbers', owned.racketLevels.numbers, 3],
      ['stash[].qty', owned.stash.find((s) => s.drug_id === 'weed')?.qty, 5],
      ['stash[].quality', owned.stash.find((s) => s.drug_id === 'weed')?.quality, 73],
      ['grudges.doc', owned.grudges.doc, 2], ['estate.tier', Number(owned.estate?.tier), 3],
    ];
    const wrongSlot = slots.filter(([, v, want]) => v !== want).map(([k, v, want]) => `${k}=${v} (want ${want})`);
    check(wrongSlot.length === 0, 'every populated branch demultiplexes from the right slot', wrongSlot.join(', '));
    // (D11: the fractional-precision probe rode the retired 'pf' branch — the estate's spent_omr
    // is the same numeric slot through the same union, so the property is still exercised)
    check(Math.abs(Number(owned.estate?.spent_omr) - 915.234567) < 1e-9,
      'a fractional numeric keeps its precision through numeric→Number', `${owned.estate?.spent_omr}`);

    // THE FIELDS NOTHING DOWNSTREAM RE-WRAPS. Worth being precise about what this proves: node-pg
    // returns `numeric` as a STRING and pg-mem returns a number, so the union coerces — but every
    // map/reduce consumer of those branches ALSO wraps in Number(), so that coercion is currently
    // belt-and-braces, and asserting the type of a re-wrapped field proves nothing (checked by
    // mutation: dropping a coercion changes no observable value today).
    //
    // These three are the exceptions — raw pass-throughs with no second coercion behind them. A
    // timestamp arriving as a string would still compare truthy in `new Date(x) > y` while breaking
    // arithmetic on it, which is the quiet kind of wrong.
    check(owned.gangJoinedAt instanceof Date, 'gangJoinedAt is a Date, not a string', `${typeof owned.gangJoinedAt}`);
    check(owned.gangRole === 'boss', 'the text field riding a second generic column survives', `${owned.gangRole}`);
    check(typeof owned.estate?.tier === 'number', 'the estate row is handed over already coerced',
      `${typeof owned.estate?.tier}`);
  }
  c.release();
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
// THE VAULT (src/treasury.js) is the only rail that allocates REAL ETH, and its wall —
// `allocated <= held` — rests on a txn-scoped advisory lock, because two claims must not both read
// the same `available` and together allocate past what the treasury holds. pg-mem is single-caller,
// so the suite can only exercise the arithmetic; this is the serialization half.
//
// It is tested by HOLDING the lock, not by racing two requests. A first attempt did fire two
// concurrent claims and assert the wall held — and it passed with the lock DELETED, because two
// in-process injects simply never overlapped in the tiny read→write window. Timing luck reads
// exactly like a proof. Holding the lock from outside tests the actual claim, on demand.
console.log('\n9. THE VAULT SERIALIZES ON ITS ADVISORY LOCK');
{
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name: `Vault ${Date.now() % 100000}` } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  const acct = (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [me.id])).rows[0].a;
  await pool.query('UPDATE account_persistent SET minted=true, omr=100000 WHERE account_id=$1', [acct]);
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('tax',$1,1.0)", [`pgcheck-${Date.now()}`]);
  await pool.query(`INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize)
    VALUES ($1, 0, 0, 5000, 0, 0)`, [`pgcheck-price-${Date.now()}`]);
  const lockMs = Number((await pool.query("SELECT setting FROM pg_settings WHERE name='lock_timeout'")).rows[0].setting);
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock($1)', [0x45544856]); // 'ETHV' — the vault's key
    const t0 = Date.now();
    const blocked = await call('POST', '/v1/vault/claim', { token, body: { omr: TREASURY.CLAIM_MIN_OMR } });
    const ms = Date.now() - t0;
    check(blocked.code !== 200, 'a claim is NOT served while another holds the vault lock', `got ${blocked.code}`);
    check(ms >= lockMs * 0.5, 'and it waited on the lock rather than failing instantly', `waited ${ms}ms`);
  } finally { await holder.query('ROLLBACK').catch(() => {}); holder.release(); }
  const served = await call('POST', '/v1/vault/claim', { token, body: { omr: TREASURY.CLAIM_MIN_OMR } });
  check(served.code === 200, 'and the claim goes through once the lock is released', `got ${served.code} ${served.body?.error || ''}`);
  const held = Number((await pool.query('SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue')).rows[0].s);
  const alloc = Number((await pool.query('SELECT COALESCE(SUM(eth),0) s FROM eth_vault')).rows[0].s);
  check(alloc <= held + 1e-9, 'allocated <= held (ETH) — the vault never owes what it does not hold',
    `allocated ${alloc} vs held ${held}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n10. NO node-pg DEPRECATIONS');
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
// The summary must not claim what was skipped. Saying "the ledger holds" after §6 declined to run is
// exactly the overclaim this harness keeps catching elsewhere.
console.log(`✅ pgcheck passed — the loop, the locks, the safety valves, ${preExistingChars > 0
  ? 'the migration and the lock-free read path hold on real Postgres. THE LEDGER LEG WAS SKIPPED (this database was not fresh) — re-run against an empty database to check it'
  : 'the ledger, the migration and the lock-free read path all hold on real Postgres'}.`);
process.exit(0);
