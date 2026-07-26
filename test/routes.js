// THE MOUNTED SURFACE (the 48th suite).
//
// server.js registers ~279 routes in one 2,400-line file, and the thing that would actually hurt is
// not a route going missing — a missing route fails loudly the first time anything calls it. It is a
// route quietly losing its `auth` preHandler and becoming PUBLIC. Nothing else in the suite would
// notice: every other test authenticates, so an endpoint that stopped requiring a token still passes.
//
// So the invariant is stated the only way that catches it: every /v1 route is authenticated unless it
// is EXPLICITLY listed here as public. Adding a public route is then a deliberate act with a diff,
// which is the decision you want forced. This also guards the server.js split — a route that lands in
// the wrong module, or loses its preHandler on the way, shows up here rather than in production.
//
// The registry is fastify's own onRoute output (app.routes), so it reflects what is really mounted,
// not what a comment claims.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();

// Deliberately public. Boards and catalogs the console reads before sign-in, the auth entry points
// themselves, and the websocket — which authenticates IN-BAND on connect rather than by preHandler.
const PUBLIC = new Set([
  'GET /v1/art/:kind/:id',
  'GET /v1/auth/x/callback',
  'GET /v1/catalog',
  'GET /v1/city',
  'GET /v1/commission',
  'GET /v1/districts',
  'GET /v1/exchange',
  'GET /v1/gangs',
  'GET /v1/gangs/:id',
  'GET /v1/landmarks',
  'GET /v1/leaderboard/builders',
  'GET /v1/leaderboard/convoy',
  'GET /v1/leaderboard/family-build',
  'GET /v1/leaderboard/honor',
  'GET /v1/leaderboard/kingpins',
  'GET /v1/leaderboard/launderers',
  'GET /v1/leaderboard/statesmen',
  'GET /v1/leaderboard/tycoons',
  'GET /v1/market',
  'GET /v1/market/prices',
  'GET /v1/online',
  'GET /v1/plex/price',
  'GET /v1/rules',
  'GET /v1/u/:name',
  'GET /v1/ws',
  'POST /v1/auth/guest',
  'POST /v1/auth/privy',
  'POST /v1/auth/x',
  'POST /v1/auth/x/start',
]);

const v1 = app.routes.filter((r) => r.url.startsWith('/v1'));
const key = (r) => `${r.method} ${r.url}`;

// ── the invariant ──────────────────────────────────────────────────────────────────────────────
const unauthed = v1.filter((r) => !r.hasAuth).map(key).sort();
const surprises = unauthed.filter((k) => !PUBLIC.has(k));
assert.deepEqual(surprises, [],
  `these /v1 routes are PUBLIC and not declared so — if that is intended, add them to PUBLIC in this\n`
  + `file (a deliberate diff); if not, they have lost their auth preHandler:\n  ${surprises.join('\n  ')}`);

// …and the other direction: a declared-public route that no longer exists is stale bookkeeping, and
// a stale allowlist is how a future route silently inherits permission it was never granted.
const stale = [...PUBLIC].filter((k) => !unauthed.includes(k)).sort();
assert.deepEqual(stale, [],
  `declared public but not actually mounted-and-public (route renamed, removed, or since authed):\n  ${stale.join('\n  ')}`);

// ── mod tools are never merely authed ──────────────────────────────────────────────────────────
// modAuth is a SEPARATE key, not a player token. A /v1/mod route that carried only `auth` would be
// reachable by any signed-in player, which is the worst version of this mistake.
const modLeaks = v1.filter((r) => r.url.startsWith('/v1/mod') && !r.isMod).map(key).sort();
assert.deepEqual(modLeaks, [], `/v1/mod routes must use modAuth, not the player token:\n  ${modLeaks.join('\n  ')}`);

// ── no duplicate registrations ─────────────────────────────────────────────────────────────────
// Fastify throws on an exact duplicate, but a split that registers a module twice would surface here
// first and more legibly than as a boot crash in production.
const seen = new Map();
for (const r of app.routes) seen.set(key(r), (seen.get(key(r)) || 0) + 1);
const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
assert.deepEqual(dupes, [], `routes registered more than once: ${dupes.join(', ')}`);

console.log(`✅ Mounted-surface test passed — ${app.routes.length} registrations, ${v1.length} under /v1: `
  + `every one authenticated except the ${PUBLIC.size} declared public (checked BOTH ways, so neither a `
  + `dropped auth preHandler nor a stale allowlist entry can hide), every /v1/mod route behind modAuth `
  + `rather than a player token, and no route registered twice.`);
await app.close();
