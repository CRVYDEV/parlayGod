// THE HOME AGGREGATE (/v1/home) — one read for the landing screen's fifteen read-only boards.
//
// The centre of this file is a CONTRACT, not a shape: every key the aggregate returns must be byte
// for byte what that board's OWN route serves. It matters because the two halves are checked by
// different things — the client mirror verifies the screen's reads against `/v1/home|<key>`, while
// agents and `/v1/screens` still use `/v1/<key>` — so a drift between them would leave one of those
// two audiences reading a board nothing has ever checked.
//
// The other two claims are the ones a consolidation can silently give up:
//   · ISOLATION — today a board that throws 500s its own request and the other fifteen cards still
//     render. Consolidating without isolation makes one broken board blank the landing screen.
//   · READ-ONLY — `readCharacter` prefers a no-BEGIN path whose client REFUSES writes, so a writing
//     board cannot ride in the aggregate at all. That is why `/v1/bulletin` is deliberately NOT in
//     it (it materialises the week's snapshot), and the read path succeeding is what proves the
//     property for every board that IS — a claim about all fifteen, not a comment about one.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { HOME_BOARDS } from '../src/home.js';
import { runBoards } from '../src/aggregate.js';
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
// readCharacter merges `{character, events, ...board}` onto every authed board it serves. The two
// KEYLESS routes do not go through it — and `/v1/events`' own top-level `events` is BOARD DATA, so
// stripping the envelope there compares the wrong thing (it read as a drift on the first probe).
const AUTHED = (route) => route !== '/v1/events' && route !== '/v1/results';
const bare = (body, route) => {
  const b = { ...(body || {}) };
  if (AUTHED(route)) { delete b.character; delete b.events; }
  return b;
};

const token = await mk('Home Aggregate');
const me = (await call('GET', '/v1/me', { token })).body.character;

// ── THE AGGREGATE ANSWERS EVERY DECLARED BOARD ──────────────────────────────────────────────────
{
  const h = (await call('GET', '/v1/home', { token })).body;
  assert.equal(h.boards, HOME_BOARDS.length, 'the aggregate reports how many boards it folds in');
  assert.deepEqual(h.failed, [], 'a fresh street builds all fifteen boards — a name here is a board that threw');
  assert(HOME_BOARDS.length >= 15, `only ${HOME_BOARDS.length} boards in the map — the extractor or the map shrank`);
  for (const [key] of HOME_BOARDS) {
    assert(h[key] !== undefined && h[key] !== null, `the aggregate is missing the "${key}" board`);
  }
}

// ── THE CONTRACT: every key IS its own route's answer ───────────────────────────────────────────
// Not "has the same fields" — the same VALUES, everywhere except the clocks. The client mirror
// checks the screen's reads against the aggregate; the agent manual points at the solo routes.
// Anything less than equality means one of those two is checking a shape the other does not serve.
//
// THE CLOCKS ARE THE ONE EXCEPTION AND THEY ARE STILL CHECKED. Several boards carry a countdown
// (`opensSeconds`, `closesSeconds`, `matureSeconds`), and the two fetches happen at two different
// moments — so demanding byte equality of a ticking number is a deterministic assertion resting on
// a timing precondition, the flake shape this repo has paid for repeatedly. Found by looping the
// comparison rather than by guessing: `events.primetime.opensSeconds` drifts by one. So a `*Seconds`
// leaf is compared with a tolerance instead of being DROPPED — the key must still be present on both
// sides and the values must still agree to within a few seconds, which is orders of magnitude
// tighter than any real drift (a wrong board is a different number entirely, or absent).
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
  const h = (await call('GET', '/v1/home', { token })).body;
  const drift = [];
  for (const [key, route] of HOME_BOARDS) {
    const solo = await call('GET', route, { token });
    assert.equal(solo.code, 200, `${route} must be mounted and answer on its own — the map is a contract with it`);
    compare(h[key], bare(solo.body, route), key, drift);
  }
  assert.deepEqual(drift, [], 'a board in the aggregate does not match what its own route serves:\n   - '
    + drift.join('\n   - '));
}

// ── READ-ONLY: the fast path refuses writes, so this proves all fifteen are side-effect free ────
// `readCharacter` only takes the locked path when accrual MOVED. Touch the character first so the
// next read is guaranteed to take the FAST path — otherwise a green run here proves nothing, because
// the write-refusing client was never the one handed to the boards.
{
  await call('GET', '/v1/me', { token });                 // settle any pending accrual
  const h = (await call('GET', '/v1/home', { token }));
  assert.equal(h.code, 200, 'the aggregate answers on the write-REFUSING read path — a board that wrote would throw here');
  assert.deepEqual(h.body.failed, [], 'a board that WRITES cannot ride in the aggregate: readCharacter hands the fast '
    + "path a client that refuses writes, so it would land in `failed`. That is why /v1/bulletin is not in the map");
}

// ── THE LOCKED PATH — where the savepoints live, and the common one after any gap ───────────────
{
  await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
  const h = (await call('GET', '/v1/home', { token }));
  assert.equal(h.code, 200, 'the aggregate answers on the LOCKED path too (readCharacter falls back whenever accrual moved)');
  assert.deepEqual(h.body.failed, [], 'every board builds inside the transaction');
  for (const [key] of HOME_BOARDS) assert(h.body[key] != null, `"${key}" is missing on the locked path`);
}

// ── ISOLATION: one broken board must not blank the landing screen ───────────────────────────────
// Driven on BOTH paths because they use different mechanics — a plain catch where there is no BEGIN,
// a SAVEPOINT inside the transaction (a failed statement aborts the WHOLE transaction under real
// Postgres, 25P02, which is why the savepoint is not decoration). The break is a real failing query,
// not a thrown literal: a synthetic throw would never poison a transaction and so would test the
// catch while leaving the thing the savepoint exists for unproven.
{
  const entry = HOME_BOARDS.find(([k]) => k === 'crew');
  const real = entry[2];
  entry[2] = async (ch, client) => { await client.query('SELECT * FROM zz_no_such_table_home'); };
  try {
    for (const path of ['locked', 'read']) {
      if (path === 'locked') await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
      else await call('GET', '/v1/me', { token });
      const h = await call('GET', '/v1/home', { token });
      assert.equal(h.code, 200, `one broken board must not 500 the whole screen (${path} path)`);
      assert.deepEqual(h.body.failed, ['crew'], `the failure is COUNTED and NAMED, never silently nothing (${path} path)`);
      assert.equal(h.body.crew, null, `the broken board is null so its card renders empty (${path} path)`);
      for (const [key] of HOME_BOARDS) {
        if (key === 'crew') continue;
        assert(h.body[key] != null, `"${key}" was lost to an unrelated board's failure (${path} path)`);
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
  await call('GET', '/v1/home', { token });
  await call('GET', '/v1/home', { token });
  assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n, before,
    'the Home aggregate is a pure read — it must write no ledger row');
  assert.equal(await drift(), driftBefore, 'the Home aggregate is §10.4-neutral');
}

// ── THE ENVELOPE'S NAMES ARE RESERVED ───────────────────────────────────────────────────────────
// `readCharacter` returns `{ character, events: h.events, ...board }` and the spread is LAST, so a
// board keyed on one of its fields REPLACES it — on that screen only, silently, and invisibly to the
// contract block above, which compares the key against its own route where both sides are the board
// and agree perfectly. This map really did ship keyed `events` for an hour; it was found by counting
// a production response (15 boards, 14 keys) and it was harmless ONLY because `h.events` has no
// writer anywhere in src/. The guard is what makes that a build failure instead of a coin flip on
// whoever writes to `h.events` first.
{
  for (const bad of ['character', 'events', 'boards', 'failed']) {
    await assert.rejects(
      () => runBoards([[bad, '/v1/whatever', async () => ({})]], {}, {}, { readOnly: true }),
      /collides with the readCharacter envelope/,
      `a board keyed "${bad}" must be REFUSED — it would shadow the envelope field of the same name`);
  }
  await assert.rejects(
    () => runBoards([['a', '/v1/a', async () => ({})], ['a', '/v1/b', async () => ({})]], {}, {}, { readOnly: true }),
    /duplicate board key/, 'two boards on one key must be refused — one would shadow the other');
  // And the guard must not refuse a LEGAL map, or it would simply be an outage with a good excuse.
  const ok = await runBoards([['fine', '/v1/fine', async () => ({ n: 1 })]], {}, {}, { readOnly: true });
  assert.deepEqual(ok.fine, { n: 1 }, 'a legal map still runs');
  assert.deepEqual(HOME_BOARDS.map(([k]) => k).filter((k) => ['character', 'events', 'boards', 'failed'].includes(k)),
    [], 'the live Home map uses no reserved key');
}

console.log(`✓ THE HOME AGGREGATE — ${HOME_BOARDS.length} boards in one read, each value for value what its own `
  + 'route serves (a ticking *Seconds leaf is held to a few seconds rather than exact equality — two fetches '
  + 'are two moments, and demanding byte equality of a countdown is a flake, not a check); every board '
  + 'side-effect free, proven by the write-REFUSING read path answering, which is also what keeps the writing '
  + '/v1/bulletin out; the whole set builds inside the locked transaction too; one broken board is isolated, '
  + 'NAMED and leaves the other fourteen standing on BOTH paths; and the read moves no value');
process.exit(0);
