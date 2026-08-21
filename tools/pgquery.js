// EVERY QUERY IN THE TREE MUST PARSE ON REAL POSTGRES.
//
// This exists because of a total production outage on 2026-07-30. `loadOwned`'s UNION took `$1` and
// `$2`; Postgres resolves a parameter's type ONCE per statement from how it is used, `$2` was first
// compared to `account_gear.account_id` (TEXT in this schema), and a later branch compared it to
// `rival_events.victim_account` (UUID). `uuid = text` has no operator. The statement did not degrade —
// it failed to PARSE, so every branch died with it, and since loadOwned runs on every authed request
// that was the whole game returning 500 for hours.
//
// All 61 suites passed. They run on pg-mem, which compares uuid to text happily. `tools/pgcheck.js`
// DID catch it — but only because it happens to call `/v1/me`; a query on a path pgcheck does not
// enumerate would still be invisible. That is the gap this closes.
//
// THE MECHANISM: Postgres `PREPARE` does full parse + type resolution and NOTHING ELSE. No rows are
// read, no data is needed, no side effects occur — so every SQL string in `src/` can be checked
// against the real engine in about a second. It catches the whole class, not just the instance:
// uuid-vs-text, misspelled columns, wrong arity, ambiguous casts, UNION type mismatches, bad operator
// resolution. Anything Postgres would refuse at parse time fails here instead of in front of a player.
//
// HONESTY RULE (the one this repo keeps re-learning): a query built with `${...}` interpolation cannot
// be prepared without knowing the interpolated value, so those are COUNTED AND LISTED, never silently
// skipped. A guard that quietly ignores what it cannot read reports a pass over exactly the code it
// failed to check. The count is asserted against a known ceiling so the unreadable set cannot grow
// unnoticed.
//
//   createdb omerta_query
//   DATABASE_URL=postgres://localhost/omerta_query node tools/pgquery.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.DATABASE_URL) {
  // Deliberately fatal rather than a skip. This guard is meaningless on pg-mem — the engine it exists
  // to disagree with — so a silent no-op here would be a green run over an unchecked tree.
  console.error('pgquery needs DATABASE_URL pointed at a real (throwaway) Postgres — that is the whole point.');
  process.exit(2);
}

// ── 1. EXTRACT ───────────────────────────────────────────────────────────────────────────────────
// Every `.query(` call site, then the first string literal that follows. Hand-rolled rather than
// regex because the argument may be a template literal spanning many lines and containing quotes,
// braces and nested templates — the exact shape a regex reads wrong (test/client.js learned this the
// expensive way, twice).
function firstStringArg(src, from) {
  let i = from;
  while (i < src.length && /[\s\n]/.test(src[i])) i++;
  const q = src[i];
  if (q !== '`' && q !== "'" && q !== '"') return null;   // a variable, a function call, or SCHEMA
  let out = '', depth = 0, interpolated = false;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { out += src[i + 1]; i++; continue; }
    if (q === '`' && c === '$' && src[i + 1] === '{') { interpolated = true; depth++; i++; continue; }
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
    if (c === q) return { sql: out, interpolated };
    out += c;
  }
  return null;
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'src'));

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
// PREPARE handles DML only. DDL, transaction control and session commands are not preparable and are
// not what this guard is about — they are counted as skipped, not as passes.
const DML = /^\s*(select|insert|update|delete|with|values)\b/i;

const stmts = [], interpolated = [], unreadable = [], skipped = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of src.matchAll(/\.query\(/g)) {
    const at = m.index + m[0].length;
    const got = firstStringArg(src, at);
    const where = `${rel}:${lineOf(src, m.index)}`;
    if (!got) { unreadable.push(where); continue; }
    if (got.interpolated) { interpolated.push({ where, sql: got.sql }); continue; }
    if (!DML.test(got.sql)) { skipped.push(where); continue; }
    stmts.push({ where, sql: got.sql });
  }
}

// ── 2. PREPARE ───────────────────────────────────────────────────────────────────────────────────
const { makeDb } = await import('../src/db.js');
const pool = await makeDb();           // applies schema.sql, so the tables exist to resolve against

const failures = [];
let n = 0;
for (const s of stmts) {
  const name = `pgq_${n++}`;
  // A parse failure aborts the transaction it is in, so each PREPARE gets its own clean connection
  // state via an explicit rollback-free path: no transaction is opened at all, so a failed PREPARE
  // leaves nothing to clean up.
  try {
    await pool.query(`PREPARE ${name} AS ${s.sql}`);
    await pool.query(`DEALLOCATE ${name}`);
  } catch (e) {
    failures.push({ ...s, error: e.message, hint: e.hint || '' });
  }
}

// ── 3. REPORT ────────────────────────────────────────────────────────────────────────────────────
console.log(`\npgquery — ${stmts.length} static statements prepared against real Postgres`);
console.log(`  ${interpolated.length} interpolated (cannot be prepared — counted, never silently passed; PGQUERY_LIST=1 to list)`);
console.log(`  ${skipped.length} non-DML (DDL / transaction control — not preparable by design)`);
console.log(`  ${unreadable.length} call sites whose argument is not a literal (a variable or a helper)\n`);

if (failures.length) {
  console.error(`✗ ${failures.length} statement(s) DO NOT PARSE on real Postgres:\n`);
  for (const f of failures) {
    console.error(`  ${f.where}`);
    console.error(`    ${f.error}${f.hint ? `\n    HINT: ${f.hint}` : ''}`);
    console.error(`    ${f.sql.replace(/\s+/g, ' ').slice(0, 220)}\n`);
  }
}

// The unreadable set is BOUNDED, not ignored. If a refactor pushes more queries behind variables or
// interpolation, this fails and forces a decision — either make them readable or raise the ceiling
// deliberately, with the reason written down.
// 60 → 63 (2026-08-09): sweepCapoLicense's three dynamic-IN fan-outs (agents → recruits →
// levelled/retained). Dynamic IN lists are the recorded pg-mem posture (`= ANY($1)` returns zero
// rows there), so these are interpolated by necessity; each is parameterized except the IN
// placeholders + two Number()-coerced constants.
// 65 → 66 (2026-08-11): THE BANK's harvest-fee source-membership check, the third instance of the
// same generated-NOT-IN shape — `BANK_SOURCES` is exported and the SQL is built from it, so the
// guard and the declaration cannot drift. (Found by re-running this after the commit that added it
// rather than before, which is ground rule #8's whole point: `npm test` cannot see this class.)
// 63 → 65 (2026-08-09): the money router's two source-membership queries — their NOT-IN lists are
// GENERATED from the exported VIG_SOURCES/TREASURY_SOURCES sets so the check and the declaration
// structurally cannot drift apart (the DESK.SINK_REASONS generated-SQL precedent).
// 66 → 67 (2026-08-11): the family buyback's `community_revenue` source-membership check — the
// FOURTH instance of the same generated-NOT-IN shape, built from the exported COMMUNITY_SOURCES.
// (The keeper's own dynamic-SQL helper was the first cut's OTHER new interpolated site and was
// inlined to literal query() calls instead — a ceiling raise is for shapes that cannot be literal,
// never for ones that merely happen not to be.)
// 67 → 71 (2026-08-14): the backend perf pass added four dynamic-SHAPE queries, each
// placeholder/constant-only with no user input (so injection-safe, but not preparable): honorLeaderboard's
// board helper (`${col}`/`${dir}`/`${cond}` are hardcoded column/direction/predicate strings), the
// /v1/streets fronts scan restricted to a parameterized IN-list of the board's own 100 char ids, and
// persistKitchen's two multi-row `INSERT ... VALUES (...),(...)` batches (placeholders built from the
// row count, values bound). All four are exercised by the suite; none can be literal (the shape is
// dynamic), which is exactly when a ceiling raise is warranted.
// 71 → 72 (2026-08-16, red-team F5): firstsBoard's steward lookup, a per-holder N+1 folded into ONE
// parameterized IN list (`$1,$2,…` built from the holder count, every value bound). Same shape and
// same reason as the /v1/streets fronts scan above — pg-mem returns zero rows for `= ANY($1::text[])`
// (the MY PROFILE lesson), so an IN list is the only portable form, and it is not preparable.
// 72 → 73 (2026-08-16, the deed-vault disclosure): `vaultHistoryFor`'s lookup of what a street's
// on-chain vault has received, an IN list over the deed token ids derived from the names on the board
// (`$1,$2,…` built from the count, every value bound). The SAME shape and the same reason as the two
// above — `= ANY($1::text[])` returns zero rows on pg-mem, so an IN list is the only portable form.
// Worth recording HOW it first showed up: a trailing comment on the `client.query(` line made the
// argument unreadable, so it landed in the *unreadable* bucket instead — counted either way (the
// honesty rule held), but filed under "we couldn't read this" rather than "this is an IN list", which
// is a worse record. The comment moved above the call so it is catalogued as what it actually is.
// 73 → 74 (2026-08-16, the stranded-vault recovery): `strandedDeeds`' street lookup, an IN list over the
// token ids of the pending re-imports (`$1,$2,…` built from the count, every value bound). Same shape
// and same reason as the three above — a read-only operator board, so the alternative (`= ANY`) would
// return zero rows on pg-mem and the board would silently report every stranded deed as nameless.
// 74 → 75 (2026-08-21, the bulletproof batch): `sweepTelemetry`'s keep-list NOT IN — a placeholder
// fan-out over TELEMETRY_KEEP_EVENTS ($2..$n), every value a bound parameter, never a user string.
const CEILING = { interpolated: 75, unreadable: 40 };
const overflow = [];
if (interpolated.length > CEILING.interpolated)
  overflow.push(`interpolated queries grew to ${interpolated.length} (ceiling ${CEILING.interpolated}) — these are UNCHECKED by this guard`);
if (unreadable.length > CEILING.unreadable)
  overflow.push(`non-literal query arguments grew to ${unreadable.length} (ceiling ${CEILING.unreadable}) — these are UNCHECKED by this guard`);

if (process.env.PGQUERY_LIST) {
  console.log('interpolated (unchecked):'); for (const i of interpolated) console.log(`  ${i.where}`);
  console.log('non-literal (unchecked):'); for (const u of unreadable) console.log(`  ${u}`);
}

await pool.end();
if (failures.length || overflow.length) {
  for (const o of overflow) console.error(`✗ ${o}`);
  // The whole point of an overflow is that somebody has to look at what grew, so print it here
  // rather than only behind PGQUERY_LIST — a message that says "listed below" and lists nothing
  // sends the reader hunting for a flag it never names.
  if (overflow.length && !process.env.PGQUERY_LIST) {
    console.error('\ninterpolated (unchecked):'); for (const i of interpolated) console.error(`  ${i.where}`);
    console.error('non-literal (unchecked):'); for (const u of unreadable) console.error(`  ${u}`);
  }
  console.error('\nA statement that does not parse is a 500 on every request that reaches it.');
  process.exit(1);
}
console.log('✅ pgquery passed — every static SQL string in src/ parses and type-resolves on real Postgres.');
