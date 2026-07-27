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
import { readFileSync, readdirSync } from 'node:fs';
import { buildServer } from '../src/server.js';

const app = await buildServer();

// Deliberately public — each with the REASON it is public, not just its name.
//
// This was a bare Set of strings, and the full-sweep red-team found what that costs: eight
// /v1/leaderboard/* routes sat in here while their 27 siblings required auth. All eight are read
// only from authed console tabs, so the header's stated rationale ("boards the console reads before
// sign-in") did not apply to any of them — they were added to the allowlist to make this test pass
// rather than given the auth their siblings have. The guard did its job: it forced a diff. But it
// could not tell a considered exemption from a silencing one, because a bare string carries no
// reason. Now an entry costs a sentence, so the cheapest way past this test is to add `auth`.
const PUBLIC = {
  'GET /v1/art/:kind/:id': 'card/profile art rendered into unfurls by crawlers with no token',
  'GET /v1/auth/x/callback': 'the OAuth return leg — the caller has no token yet, by definition',
  'GET /v1/catalog': 'the public item catalog (agent/LLM discovery surface, AGENTS.md)',
  'GET /v1/city': 'the city board the landing page shows before sign-in',
  'GET /v1/commission': 'public politics: seats, votes and the decree in force are on the record',
  'GET /v1/districts': 'the map, incl. NPC occupation + liberation cost — shown pre-sign-in',
  'GET /v1/exchange': 'the M3 cb/ammo barter board — a public order book',
  'GET /v1/gangs': 'the families board the landing page shows before sign-in',
  'GET /v1/gangs/:id': 'a family page is public (the /u/:name profile precedent)',
  'GET /v1/landmarks': 'district monuments are public by construction — the point is being seen',
  'GET /v1/market': 'the Black Market board is a public order book',
  'GET /v1/market/prices': 'the deterministic §7.11 price surface — knowable by design',
  'GET /v1/online': 'the "N in the city" presence badge on the landing page',
  'GET /v1/plex/price': 'the public PLEX quote (market-linked, moves nothing)',
  'GET /v1/rules': 'the public rulebook — server stays authoritative, odds knowledge moves no roll',
  'GET /v1/u/:name': 'THE BROADCAST public profile — a share link works without an account',
  'GET /v1/ws': 'authenticates IN-BAND on connect (JWT via Sec-WebSocket-Protocol), not by preHandler',
  'GET /v1/yield': 'TOKENOMICS v2 family-yield board — a public status board (the /v1/gangs precedent)',
  'POST /v1/auth/guest': 'an auth entry point — there is no token to present yet',
  'POST /v1/auth/privy': 'an auth entry point — there is no token to present yet',
  'POST /v1/auth/x': 'an auth entry point — there is no token to present yet',
  'POST /v1/auth/x/start': 'an auth entry point — there is no token to present yet',
};
for (const [route, why] of Object.entries(PUBLIC))
  assert(typeof why === 'string' && why.trim().length >= 20,
    `PUBLIC entry ${route} needs a real reason it is unauthenticated, not a placeholder`);

const v1 = app.routes.filter((r) => r.url.startsWith('/v1'));
const key = (r) => `${r.method} ${r.url}`;

// ── the invariant ──────────────────────────────────────────────────────────────────────────────
const unauthed = v1.filter((r) => !r.hasAuth).map(key).sort();
const surprises = unauthed.filter((k) => !(k in PUBLIC));
assert.deepEqual(surprises, [],
  `these /v1 routes are PUBLIC and not declared so — if that is intended, add them to PUBLIC in this\n`
  + `file (a deliberate diff); if not, they have lost their auth preHandler:\n  ${surprises.join('\n  ')}`);

// …and the other direction: a declared-public route that no longer exists is stale bookkeeping, and
// a stale allowlist is how a future route silently inherits permission it was never granted.
const stale = Object.keys(PUBLIC).filter((k) => !unauthed.includes(k)).sort();
assert.deepEqual(stale, [],
  `declared public but not actually mounted-and-public (route renamed, removed, or since authed):\n  ${stale.join('\n  ')}`);

// ── mod tools are never merely authed ──────────────────────────────────────────────────────────
// modAuth is a SEPARATE key, not a player token. A /v1/mod route that carried only `auth` would be
// reachable by any signed-in player, which is the worst version of this mistake.
const modLeaks = v1.filter((r) => r.url.startsWith('/v1/mod') && !r.isMod).map(key).sort();
assert.deepEqual(modLeaks, [], `/v1/mod routes must use modAuth, not the player token:\n  ${modLeaks.join('\n  ')}`);

// ── SPEC.md's stated route count ────────────────────────────────────────────────────────────────
// test/docs.js machine-checks every other figure in SPEC's size table against the tree, but this one
// needs the app booted to know it — so it lives here, where the real number already exists. Within 2%,
// the same band docs.js uses for figures that move on ordinary work: the error worth catching is a
// count that has drifted by dozens, not by one route added this morning.
{
  const specRoutes = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8')
    .match(/^\| HTTP routes \|[^|]*?\*\*([\d,]+)\*\*/m);
  assert(specRoutes, 'SPEC.md must state the route count in its size table (row "HTTP routes")');
  const claimed = Number(specRoutes[1].replace(/,/g, ''));
  assert(Math.abs(claimed - app.routes.length) / app.routes.length < 0.02,
    `SPEC says ${claimed} route registrations; there are ${app.routes.length} — restate it`);
}

// ── no duplicate registrations ─────────────────────────────────────────────────────────────────
// Fastify throws on an exact duplicate, but a split that registers a module twice would surface here
// first and more legibly than as a boot crash in production.
const seen = new Map();
for (const r of app.routes) seen.set(key(r), (seen.get(key(r)) || 0) + 1);
const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
assert.deepEqual(dupes, [], `routes registered more than once: ${dupes.join(', ')}`);

// ── every route module must be self-contained ──────────────────────────────────────────────────
// The surface check above cannot see this one: a handler MOVED out of server.js that still reads
// something only server.js imported registers perfectly and throws the first time a player calls it.
// So each src/routes/*.js is scanned for identifiers it reads but never binds.
//
// This is a lexical scan, not a full parser — it strips comments and string bodies, collects every
// binding form this codebase actually uses (imports, const/let/var, function and arrow params,
// destructuring, catch), and reports the rest. It is here because it found four real breaks when the
// modules were first extracted (crypto, TAX, withdrawTaxBps and the two websocket close helpers).
const GLOBALS = new Set(['console','process','Math','JSON','Date','Number','String','Boolean','Object','Array','Map','Set',
  'Promise','Error','TypeError','RangeError','RegExp','Symbol','BigInt','parseInt','parseFloat','isNaN','isFinite',
  'encodeURIComponent','decodeURIComponent','setTimeout','setInterval','clearTimeout','clearInterval','Buffer',
  'URL','URLSearchParams','fetch','structuredClone','globalThis','undefined','null','true','false','NaN','Infinity',
  'this','arguments','new','typeof','instanceof','void','delete','in','of','return','if','else','for','while','do',
  'switch','case','break','continue','function','class','const','let','var','async','await','try','catch','finally',
  'throw','yield','import','export','default','extends','super','static','get','set','from','as','with','TextEncoder',
  'TextDecoder','AbortController','queueMicrotask','WeakMap','WeakSet','Proxy','Reflect','Intl','Uint8Array']);

const stripCode = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, (m) => m.replace(/[^$\{\}\s]/g, ' '))
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""');

function boundNames(src) {
  const b = new Set();
  const param = (list, into) => { for (const p of list.split(',')) {
    const n = p.replace(/[{}[\]]/g, ' ').trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
    if (/^[A-Za-z_$][\w$]*$/.test(n)) into.add(n); } };
  for (const m of src.matchAll(/^import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from/gm)) b.add(m[1]);
  for (const m of src.matchAll(/^import\s*\{([\s\S]*?)\}\s*from/gm)) param(m[1], b);
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) b.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) b.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var|function\s*\w*)\s*[({[]([^)}\]]*)[)}\]]/g)) param(m[1], b);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) param(m[1], b);
  for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) b.add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) b.add(m[1]);
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=/g)) param(m[1], b);
  return b;
}

const unbound = [];
for (const f of readdirSync(new URL('../src/routes', import.meta.url)).filter((n) => n.endsWith('.js')).sort()) {
  const src = stripCode(readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8'));
  const bound = boundNames(src);
  const free = new Set();
  for (const m of src.matchAll(/(?:^|[^\w$.\'"`])([A-Za-z_$][\w$]*)\s*(?=[.([])/g))
    if (!bound.has(m[1]) && !GLOBALS.has(m[1])) free.add(m[1]);
  for (const n of free) if (new RegExp(`(^|[^\\w$.\'"\`])${n}\\s*[.(]`).test(src)) unbound.push(`${f}: ${n}`);
}
assert.deepEqual(unbound, [],
  `route modules reading identifiers they never bind — import them into the module, or pass them in\n`
  + `through the register() deps if they are buildServer closures:\n  ${unbound.join('\n  ')}`);

console.log(`✅ Mounted-surface test passed — ${app.routes.length} registrations, ${v1.length} under /v1: `
  + `every one authenticated except the ${Object.keys(PUBLIC).length} declared public, each with a stated reason, (checked BOTH ways, so neither a `
  + `dropped auth preHandler nor a stale allowlist entry can hide), every /v1/mod route behind modAuth `
  + `rather than a player token, and no route registered twice; plus every src/routes module self-contained (no identifier read that it never binds).`);
await app.close();
