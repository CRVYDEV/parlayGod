// CITYWIDE (/v1/citywide) — one read for the city screen's five AUTHED boards.
//
// The third of these, and the sibling of test/home.js and test/streets.js. It asserts the same three
// properties, because they are the three a consolidation can silently give up:
//   · THE CONTRACT — every key must be what that board's OWN route serves, value for value. The two
//     halves are checked by different things (the client mirror verifies the screen against
//     `/v1/citywide|<key>`; agents and /v1/screens use `/v1/<key>`), so a drift would leave one of
//     those audiences reading a board nothing has ever checked.
//   · ISOLATION — today a board that throws 500s its own request and the other four still render.
//   · READ-ONLY — the read path's client REFUSES writes, so a writing board cannot ride along at all.
//
// And one this file has that its siblings do not: `/v1/city` must STAY OUT. It is keyless and already
// carries two 30-second server-side caches, so folding it in would either duplicate those or recompute
// per player what is currently computed once for everybody — and it would close the door on
// edge-caching a public board. That is a decision, so it is pinned rather than left to a comment.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { CITYWIDE_BOARDS } from '../src/citywide.js';
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
// readCharacter merges `{character, events, ...board}` onto every authed board it serves.
const bare = (body) => { const b = { ...(body || {}) }; delete b.character; delete b.events; return b; };

const token = await mk('Citywide Board');
const me = (await call('GET', '/v1/me', { token })).body.character;

// ── THE AGGREGATE ANSWERS EVERY DECLARED BOARD ──────────────────────────────────────────────────
{
  const c = (await call('GET', '/v1/citywide', { token })).body;
  assert.equal(c.boards, CITYWIDE_BOARDS.length, 'the aggregate reports how many boards it folds in');
  assert.deepEqual(c.failed, [], 'a fresh street builds all five boards — a name here is a board that threw');
  assert(CITYWIDE_BOARDS.length >= 5, `only ${CITYWIDE_BOARDS.length} boards in the map — the extractor or the map shrank`);
  for (const [key] of CITYWIDE_BOARDS) {
    assert(c[key] !== undefined && c[key] !== null, `the aggregate is missing the "${key}" board`);
  }
}

// ── /v1/city STAYS OUT, and stays keyless ──────────────────────────────────────────────────────
// The reason it is excluded is a property somebody could undo by "finishing the job", so it is
// asserted rather than explained: it must not be a key here, and it must still answer with NO token.
{
  const keys = CITYWIDE_BOARDS.map(([k]) => k);
  const routes = CITYWIDE_BOARDS.map(([, r]) => r);
  assert(!routes.includes('/v1/city'), '/v1/city must not be folded in: it is keyless and already cached '
    + 'for everybody, which no per-player aggregate can beat, and folding it would duplicate its two caches');
  assert(!keys.includes('city'), '/v1/city must not be folded in under any key');
  const anon = await call('GET', '/v1/city');
  assert.equal(anon.code, 200, '/v1/city stays KEYLESS — that is the whole reason it is worth leaving out');
  assert(anon.body.skyline !== undefined && anon.body.season, 'the public city board still carries its cached halves');
}

// ── THE CONTRACT: every key IS its own route's answer ───────────────────────────────────────────
// Not "has the same fields" — the same VALUES, everywhere except the clocks. A `*Seconds` leaf is a
// countdown and the two fetches are two moments, so demanding byte equality of a ticking number is a
// deterministic assertion resting on a timing precondition — the flake shape this repo has paid for
// repeatedly. It is held to a tolerance rather than DROPPED: the key must still be present on both
// sides and agree to within a few seconds, which is orders of magnitude tighter than any real drift.
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
  const c = (await call('GET', '/v1/citywide', { token })).body;
  const drift = [];
  for (const [key, route] of CITYWIDE_BOARDS) {
    const solo = await call('GET', route, { token });
    assert.equal(solo.code, 200, `${route} must be mounted and answer on its own — the map is a contract with it`);
    compare(c[key], bare(solo.body), key, drift);
  }
  assert.deepEqual(drift, [], 'a board in the aggregate does not match what its own route serves:\n   - '
    + drift.join('\n   - '));
}

// ── READ-ONLY: the fast path refuses writes, so this proves all five are side-effect free ───────
// `readCharacter` only takes the locked path when accrual MOVED. Touch the character first so the
// next read is guaranteed to take the FAST path — otherwise a green run here proves nothing, because
// the write-refusing client was never the one handed to the boards.
{
  await call('GET', '/v1/me', { token });                 // settle any pending accrual
  const c = (await call('GET', '/v1/citywide', { token }));
  assert.equal(c.code, 200, 'the aggregate answers on the write-REFUSING read path — a board that wrote would throw here');
  assert.deepEqual(c.body.failed, [], 'a board that WRITES cannot ride in the aggregate: readCharacter hands the fast '
    + 'path a client that refuses writes, so it would land in `failed`');
  // megaBoard is the one that reads through its querier argument rather than readCharacter. Handing
  // it the request's own client is what makes the line above cover it too.
  assert(c.body.mega && typeof c.body.mega === 'object', 'the monument board comes back through the same client');
}

// ── THE LOCKED PATH — where the savepoints live, and the common one after any gap ───────────────
{
  await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
  const c = (await call('GET', '/v1/citywide', { token }));
  assert.equal(c.code, 200, 'the aggregate answers on the LOCKED path too (readCharacter falls back whenever accrual moved)');
  assert.deepEqual(c.body.failed, [], 'every board builds inside the transaction');
  for (const [key] of CITYWIDE_BOARDS) assert(c.body[key] != null, `"${key}" is missing on the locked path`);
}

// ── ISOLATION: one broken board must not blank the screen ──────────────────────────────────────
// Driven on BOTH paths because they use different mechanics — a plain catch where there is no BEGIN,
// a SAVEPOINT inside the transaction (a failed statement aborts the WHOLE transaction under real
// Postgres, 25P02, which is why the savepoint is not decoration). The break is a real failing query,
// not a thrown literal: a synthetic throw would never poison a transaction and so would test the
// catch while leaving the thing the savepoint exists for unproven.
{
  const entry = CITYWIDE_BOARDS.find(([k]) => k === 'npcfamily');
  const real = entry[2];
  entry[2] = async (ch, client) => { await client.query('SELECT * FROM zz_no_such_table_citywide'); };
  try {
    for (const path of ['locked', 'read']) {
      if (path === 'locked') await pool.query("UPDATE characters SET last_accrued_at = now() - interval '3 hours' WHERE id=$1", [me.id]);
      else await call('GET', '/v1/me', { token });
      const c = await call('GET', '/v1/citywide', { token });
      assert.equal(c.code, 200, `one broken board must not 500 the whole screen (${path} path)`);
      assert.deepEqual(c.body.failed, ['npcfamily'], `the failure is COUNTED and NAMED, never silently nothing (${path} path)`);
      assert.equal(c.body.npcfamily, null, `the broken board is null so its card renders empty (${path} path)`);
      for (const [key] of CITYWIDE_BOARDS) {
        if (key === 'npcfamily') continue;
        assert(c.body[key] != null, `"${key}" was lost to an unrelated board's failure (${path} path)`);
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
  await call('GET', '/v1/citywide', { token });
  await call('GET', '/v1/citywide', { token });
  assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n, before,
    'the citywide aggregate is a pure read — it must write no ledger row');
  assert.equal(await drift(), driftBefore, 'the citywide aggregate is §10.4-neutral');
}

console.log(`✓ CITYWIDE — ${CITYWIDE_BOARDS.length} boards in one read, each value for value what its own route serves `
  + '(a ticking *Seconds leaf is held to a few seconds rather than exact equality — two fetches are two moments); '
  + '/v1/city deliberately STAYS OUT and stays keyless, pinned rather than explained, because it is already cached '
  + 'for everybody and no per-player aggregate can beat that; every board side-effect free, proven by the '
  + 'write-REFUSING read path answering — which covers the one that does not arrive through readCharacter as well; '
  + 'the whole set builds inside the locked transaction too; one broken board is isolated, NAMED and leaves the '
  + 'other four standing on BOTH paths; and the read moves no value');
process.exit(0);
