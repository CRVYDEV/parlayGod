// THE BLOCK (/v1/block) — one read for the streets screen's seven boards.
//
// This is test/home.js's sibling and asserts the same three properties, because they are the three a
// consolidation can silently give up:
//   · THE CONTRACT — every key must be what that board's OWN route serves, value for value. The two
//     halves are checked by different things (the client mirror verifies the screen against
//     `/v1/block|<key>`; agents and /v1/screens use `/v1/<key>`), so a drift would leave one of those
//     audiences reading a board nothing has ever checked.
//   · ISOLATION — today a board that throws 500s its own request and the other six still render.
//   · READ-ONLY — the read path's client REFUSES writes, so a writing board cannot ride along at all.
//
// It also pins the two boards that do NOT arrive through `readCharacter`, since both are exceptions
// somebody could later "tidy up" into a bug: `/v1/market/prices` is keyless and pure (in the map
// because the ceiling is measured in requests), and `/v1/daily` reads through its querier argument —
// handing it the request's own write-refusing client is stricter than the route it mirrors.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { STREETS_BOARDS, marketPrices } from '../src/streets.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return token;
};
// readCharacter merges `{character, events, ...board}` onto every authed board it serves. The keyless
// price board does not go through it, so stripping the envelope there would compare the wrong thing.
const AUTHED = (route) => route !== '/v1/market/prices';
const bare = (body, route) => {
  const b = { ...(body || {}) };
  if (AUTHED(route)) { delete b.character; delete b.events; }
  return b;
};

const token = await mk('Block Aggregate');
const me = (await call('GET', '/v1/me', { token })).body.character;

// ── THE AGGREGATE ANSWERS EVERY DECLARED BOARD ──────────────────────────────────────────────────
{
  const b = (await call('GET', '/v1/block', { token })).body;
  assert.equal(b.boards, STREETS_BOARDS.length, 'the aggregate reports how many boards it folds in');
  assert.deepEqual(b.failed, [], 'a fresh street builds all seven boards — a name here is a board that threw');
  assert(STREETS_BOARDS.length >= 7, `only ${STREETS_BOARDS.length} boards in the map — the extractor or the map shrank`);
  for (const [key] of STREETS_BOARDS) {
    assert(b[key] !== undefined && b[key] !== null, `the aggregate is missing the "${key}" board`);
  }
}

// ── THE CONTRACT: every key IS its own route's answer ───────────────────────────────────────────
// Not "has the same fields" — the same VALUES, everywhere except the clocks. A `*Seconds` leaf is a
// countdown and the two fetches are two moments, so demanding byte equality of a ticking number is a
// deterministic assertion resting on a timing precondition — the flake shape this repo has paid for
// repeatedly. It is held to a tolerance rather than DROPPED: the key must still be present on both
// sides and agree to within a few seconds, which is orders of magnitude tighter than any real drift
// (a wrong board is a different number entirely, or absent).
{
  const CLOCK_TOL_S = 5;
  const compare = (a, b, path, out) => {
    const leaf = path.split('.').pop();
    if (typeof a === 'number' && typeof b === 'number' && /seconds$/i.test(leaf)) {
      if (Math.abs(a - b) > CLOCK_TOL_S) out.push(`${path}: a clock drifted ${Math.abs(a - b)}s (${a} vs ${b})`);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[k], b[k], `${path}.${k}`, out);
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: aggregate ${JSON.stringify(a)} vs route ${JSON.stringify(b)}`);
  };
  const b = (await call('GET', '/v1/block', { token })).body;
  const drift = [];
  for (const [key, route] of STREETS_BOARDS) {
    const solo = await call('GET', route, { token });
    assert.equal(solo.code, 200, `${route} must be mounted and answer on its own — the map is a contract with it`);
    compare(b[key], bare(solo.body, route), key, drift);
  }
  assert.deepEqual(drift, [], 'a board in the aggregate does not match what its own route serves:\n   - '
    + drift.join('\n   - '));
}

// ── THE PRICE BOARD HAS ONE IMPLEMENTATION ─────────────────────────────────────────────────────
// The route built this inline before there was a second caller. Two copies of one board is how the
// two ends of a mirror come to disagree, so the route calls the same function the map does — and
// this asserts it by VALUE rather than by reading the source, which a refactor could satisfy while
// changing what either one returns.
{
  const solo = (await call('GET', '/v1/market/prices', { token })).body;
  const direct = marketPrices(solo.block);
  assert.deepEqual(solo, direct, 'the /v1/market/prices route and the shared core must be one implementation');
  assert(Object.keys(solo.goods).length >= 6 && Object.keys(solo.makings).length >= 1,
    'the price board is non-trivial — an empty board would satisfy the comparison above vacuously');
}

// ── READ-ONLY: the fast path refuses writes, so this proves all seven are side-effect free ──────
// `readCharacter` only takes the locked path when accrual MOVED. Touch the character first so the
// next read is guaranteed to take the FAST path — otherwise a green run here proves nothing, because
// the write-refusing client was never the one handed to the boards.
{
  await call('GET', '/v1/me', { token });                 // settle any pending accrual
  const b = (await call('GET', '/v1/block', { token }));
  assert.equal(b.code, 200, 'the aggregate answers on the write-REFUSING read path — a board that wrote would throw here');
  assert.deepEqual(b.body.failed, [], 'a board that WRITES cannot ride in the aggregate: readCharacter hands the fast '
    + 'path a client that refuses writes, so it would land in `failed`');
  // /v1/daily is the one that reads through its querier argument rather than readCharacter. Handing
  // it the request's own client is what makes the line above cover it too.
  assert(b.body.daily && Array.isArray(b.body.daily.jobs), "the day's contracts come back through the same client");
}

// ── THE LOCKED PATH — where the savepoints live, and the common one after any gap ───────────────
{
  await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
  const b = (await call('GET', '/v1/block', { token }));
  assert.equal(b.code, 200, 'the aggregate answers on the LOCKED path too (readCharacter falls back whenever accrual moved)');
  assert.deepEqual(b.body.failed, [], 'every board builds inside the transaction');
  for (const [key] of STREETS_BOARDS) assert(b.body[key] != null, `"${key}" is missing on the locked path`);
}

// ── ISOLATION: one broken board must not blank the screen ──────────────────────────────────────
// Driven on BOTH paths because they use different mechanics — a plain catch where there is no BEGIN,
// a SAVEPOINT inside the transaction (a failed statement aborts the WHOLE transaction under real
// Postgres, 25P02, which is why the savepoint is not decoration). The break is a real failing query,
// not a thrown literal: a synthetic throw would never poison a transaction and so would test the
// catch while leaving the thing the savepoint exists for unproven.
{
  const entry = STREETS_BOARDS.find(([k]) => k === 'corner');
  const real = entry[2];
  entry[2] = async (ch, client) => { await client.query('SELECT * FROM zz_no_such_table_block'); };
  try {
    for (const path of ['locked', 'read']) {
      if (path === 'locked') await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
      else await call('GET', '/v1/me', { token });
      const b = await call('GET', '/v1/block', { token });
      assert.equal(b.code, 200, `one broken board must not 500 the whole screen (${path} path)`);
      assert.deepEqual(b.body.failed, ['corner'], `the failure is COUNTED and NAMED, never silently nothing (${path} path)`);
      assert.equal(b.body.corner, null, `the broken board is null so its card renders empty (${path} path)`);
      for (const [key] of STREETS_BOARDS) {
        if (key === 'corner') continue;
        assert(b.body[key] != null, `"${key}" was lost to an unrelated board's failure (${path} path)`);
      }
    }
  } finally { entry[2] = real; }
}

// ── §10.4: a read moves no value ────────────────────────────────────────────────────────────────
// A DELTA, not an absolute: other blocks in this file (and any suite sharing the database) move
// value legitimately, so what must not move is the drift ACROSS the read.
{
  const drift = async () => Number((await runLedgerInvariants(pool, { alert: false }))
    .checks.find((x) => x.name === 'character cash').drift);
  const before = (await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n;
  const driftBefore = await drift();
  await call('GET', '/v1/block', { token });
  await call('GET', '/v1/block', { token });
  assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n, before,
    'the block aggregate is a pure read — it must write no ledger row');
  assert.equal(await drift(), driftBefore, 'the block aggregate is §10.4-neutral');
}

console.log(`✓ THE BLOCK — ${STREETS_BOARDS.length} boards in one read for the screen players live on, each value for `
  + 'value what its own route serves (a ticking *Seconds leaf is held to a few seconds rather than exact equality — '
  + 'two fetches are two moments); the price board has ONE implementation, asserted by value rather than by reading '
  + 'the source; every board side-effect free, proven by the write-REFUSING read path answering — which covers the two '
  + 'that do not arrive through readCharacter as well; the whole set builds inside the locked transaction too; one '
  + 'broken board is isolated, NAMED and leaves the other six standing on BOTH paths; and the read moves no value');
process.exit(0);
