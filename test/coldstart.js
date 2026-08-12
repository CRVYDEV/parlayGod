// ── LAUNCH DAY, SCALE 1 — the first player on a world with no history ───────────────────────────
//
// Every other guard here checks a system that HAS data. This one checks the opposite, because it is
// the state the game is actually in the hour it opens: no season has ended, no monument has been
// funded, no event has resolved, no leaderboard has anyone on it, and — with POPULATION_OFF — there
// is not even scenery to fill the boards. A board that divides by a total of zero, or reads `[0]` of
// an empty ranking, or assumes a `current` row exists, is correct in every test that seeds a fixture
// and 500s on the first person through the door.
//
// So: boot the emptiest possible world, create ONE character, and issue every authed GET the server
// mounts. Every one must answer 2xx, or be a DECLARED tombstone — a route deliberately kept mounted
// so a client that still calls it learns what happened instead of 404-guessing (the /v1/wage
// precedent). Catalog-or-declare, the same discipline as the client guard's NOT_API list: a new
// refusal is a decision on the record rather than a silent regression.
//
// This is deliberately the SERVER's half of a pair. `tools/mobile.js` drives the screens in a real
// browser and would catch a page that renders `undefined`; nothing before this asserted that the
// endpoints behind them answer at all when the world is empty.
process.env.MOD_KEY = 'test-mod-key';
process.env.POPULATION_OFF = 'on';   // no residents: the emptiest world the game can be in
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();

const j = async (method, url, token, payload) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await app.inject({ method, url, headers, payload });
  let body = null;
  try { body = res.json(); } catch { /* a static/HTML route */ }
  return { code: res.statusCode, body };
};

// ── A DECLARED refusal, with the reason it is not a defect ──────────────────────────────────────
// The rule for adding a line here: the refusal must be something a player is SUPPOSED to see. A
// route that refuses because the world is empty does not belong here — that is the bug this file
// exists to find.
const DECLARED = {
  '/v1/wage': 'retired — the Street Wage faucet is gone (economy v3 step 1); the route stays mounted so a polling client learns that instead of 404-guessing',
  '/v1/portfolio': 'retired — D11 removed the stock layer; the tombstone tells a stale client why',
  '/v1/leaderboard/portfolio': 'retired with the portfolio (D11)',
  '/v1/leaderboard/family-portfolio': 'retired with the portfolio (D11)',
  // Not an endpoint: the websocket upgrade path. A plain GET is correctly not a thing it serves.
  '/v1/ws': 'the websocket upgrade path, not a GET endpoint',
};

// ── the first player, on an empty world ─────────────────────────────────────────────────────────
const guest = await j('POST', '/v1/auth/guest', null, {});
assert.equal(guest.code, 200, 'a guest can sign in on an empty world');
const token = guest.body?.token;
assert(token, 'and gets a token');

const made = await j('POST', '/v1/character', token, { name: 'Cold Start' });
assert(made.code < 400, `the first character can be created (got ${made.code} ${JSON.stringify(made.body)})`);

// Every mounted authed GET, minus the mod perimeter (its own credential) and param routes (they need
// an id, which by definition means data exists — that is what the client guard's fixtures cover).
const paths = [...new Set((app.routes || [])
  .filter((r) => r.method === 'GET')
  .map((r) => r.url)
  .filter((u) => u.startsWith('/v1/'))
  .filter((u) => !u.includes('/mod/'))
  .filter((u) => !u.includes(':')))].sort();

// Anti-vacuity: an empty list is what a broken route registry looks like, and it would pass silently.
assert(paths.length >= 120,
  `only ${paths.length} parameterless authed GET route(s) found — the route registry has stopped `
  + 'reporting them, so this check is passing over endpoints it never called');

const broke = [];
const declaredHit = new Set();
for (const p of paths) {
  const r = await j('GET', p, token);
  if (r.code < 400) continue;
  if (DECLARED[p]) { declaredHit.add(p); continue; }
  broke.push(`${p} → ${r.code} ${JSON.stringify(r.body).slice(0, 120)}`);
}

assert.equal(broke.length, 0,
  'endpoint(s) that fail for the FIRST player on an empty world. This is the launch-hour state, so a\n'
  + '      refusal here is a defect unless it is something the player is supposed to see — in which case\n'
  + `      declare it in DECLARED with the reason:\n   - ${broke.join('\n   - ')}`);

// The declaration list is checked in BOTH directions: a stale entry is a route that has quietly come
// back to life (or been renamed), and leaving it listed would waive a future regression on that path.
const stale = Object.keys(DECLARED).filter((p) => paths.includes(p) && !declaredHit.has(p));
assert.equal(stale.length, 0,
  `DECLARED lists route(s) that no longer refuse — remove them, or the waiver hides the next regression:\n   - ${stale.join('\n   - ')}`);

await app.close();
console.log(`✅ cold start passed — all ${paths.length - declaredHit.size} parameterless authed GET routes answer for `
  + 'the FIRST player on a world with no season, no monument, no event, no leaderboard and not even a '
  + `resident to fill the boards; the ${declaredHit.size} that refuse are declared tombstones, checked in `
  + 'both directions so a waiver cannot outlive the thing it waives.');
