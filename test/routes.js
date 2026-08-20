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
import { randomUUID } from 'node:crypto';
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
  'GET /v1/arena': 'THE ARENA — the public agent showcase behind GET /arena; a shareable/indexable marketing surface + the agent-economy meta, banded so it never scans wealth',
  'GET /v1/art/motion': 'the motion manifest — which plates have a living clip; static asset metadata, no state, cacheable',
  'GET /v1/art/:kind/:id': 'card/profile art rendered into unfurls by crawlers with no token',
  'GET /v1/avatar/:seed': 'deterministic cosmetic portrait from a public seed (a character id); no auth, no state, cacheable',
  'GET /v1/auth/x/callback': 'the OAuth return leg — the caller has no token yet, by definition',
  'GET /v1/identity/:characterId/portrait.svg': 'THE MADE MAN — the bloodline portrait; the public collectible the token will point at, and an unfurl a crawler fetches with no token. Encodes only what publicDossier already discloses (portrait.js reads that shape and nothing else), so it is at most as revealing as the PAID Wire dossier',
  'GET /v1/identity/:characterId': 'the same portrait in ERC-721 metadata shape (identity design §5 phase 2) — served, reviewable, pointing at no token; wealth absent in any form',
  'GET /v1/catalog': 'the public item catalog (agent/LLM discovery surface, AGENTS.md)',
  'GET /v1/city': 'the city board the landing page shows before sign-in',
  'GET /v1/commission': 'public politics: seats, votes and the decree in force are on the record',
  'GET /v1/commission/ticker': 'THE TICKER BALLOT — the daily stock vote is public politics like the decree board above (the call-to-action is everyone reading it; a cast still needs a seated boss)',
  'GET /v1/districts': 'the map, incl. NPC occupation + liberation cost — shown pre-sign-in',
  'GET /v1/digest/confirm': 'THE DISPATCH — the double-opt-in confirmation link; keyless by the same argument as unsubscribe (an HMAC over account AND address is the auth). It is the ONLY thing that makes an address deliverable, so an address a player merely typed can never receive a digest (R32 F1)',
  'GET /v1/digest/unsubscribe': 'THE DISPATCH — the one-click email-unsubscribe link; keyless by design (an HMAC token is the auth, so a lapsed player unsubscribes without logging in)',
  'GET /v1/events': 'TONIGHT IN THE CITY — the live scheduled events, shown as anticipation before sign-in (the /v1/city precedent)',
  'GET /v1/results': 'THE RESULTS SHOW — the public "what just happened" board of marquee results; no private data (a payout rides the notification stream), so keyless like the events board',
  'GET /v1/exchange': 'the M3 cb/ammo barter board — a public order book',
  'GET /v1/gangs': 'the families board the landing page shows before sign-in',
  'GET /v1/gangs/:id': 'a family page is public (the /u/:name profile precedent)',
  'GET /v1/landmarks': 'district monuments are public by construction — the point is being seen',
  'GET /v1/market': 'the Black Market board is a public order book',
  'GET /v1/market/prices': 'the deterministic §7.11 price surface — knowable by design',
  'GET /v1/online': 'the "N in the city" presence badge on the landing page',
  'GET /v1/plex/price': 'the public PLEX quote — the respawn price in earned $OMR, and the mint stated ETH-only (moves nothing)',
  'GET /v1/rules': 'the public rulebook — server stays authoritative, odds knowledge moves no roll',
  'GET /v1/seasons': 'THE SEASON HAS AN ENDING — the clock and the roll of past champions. A deadline '
    + 'nobody can read is not a deadline, and the record is the whole point of the arc',
  'GET /v1/u/:name': 'THE BROADCAST public profile — a share link works without an account',
  'GET /v1/ws': 'authenticates IN-BAND on connect (JWT via Sec-WebSocket-Protocol), not by preHandler',
  'GET /v1/yield': 'TOKENOMICS v2 family-yield board — a public status board (the /v1/gangs precedent)',
  'GET /v1/desk': 'ECONOMY v3 the desk\'s shelf — published on purpose: a player told that every $OMR they '
    + 'spend comes back to the desk to be sold again is entitled to read the shelf and the sink list',
  'GET /v1/deeds/plate/:tokenId': 'STREET DEEDS — the on-chain deed\'s block-plate SVG, the ERC-721 tokenURI image a marketplace/crawler fetches with no token; the untrusted street name is escaped (the /v1/art precedent)',
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
// (blue-team H4, replacing red-team R28 MED-1/LOW-2) keyless /v1 GETs must be throttled BY DEFAULT, not
// by an allowlist. The old branch NAMED the keyless heavy boards (/v1/arena, /v1/events, …); anything
// omitted — above all GET /v1/gangs/:id, which opens a WRITE txn holding a pooled connection + row locks —
// hit ZERO buckets (unauthenticated pool exhaustion). Now the authed-read branch routes ANY keyless /v1
// GET to the per-IP public limiter, so a new keyless route can't ship unthrottled by omission. Source
// tripwire (the limiter isn't enabled in this suite): assert that default-throttle wiring is present.
{
  const srvSrc = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const anchor = srvSrc.indexOf('BLUE-TEAM H4: a KEYLESS');   // the authed-read branch itself (not the reference in the block above)
  assert(anchor > 0, 'the keyless-GET default-throttle (H4) exists');
  const branch = srvSrc.slice(anchor, anchor + 1400);
  assert(/authed[\s\S]*checkReadLimit[\s\S]*checkPublicRateLimit/.test(branch),
    'an authed /v1 GET hits the account read limiter and a KEYLESS /v1 GET falls to the per-IP public limiter — every keyless /v1 GET throttled without being named');
}

// ── THE ENVELOPE SURVIVES EVERY ROUTE ──────────────────────────────────────────────────────────
// `readCharacter` returns `{ character, events: h.events, ...result }` with the spread LAST, so a
// handler whose own top-level key is `character` or `events` REPLACES the envelope's field — on that
// route alone, silently, and invisibly to every per-route check, because those compare a board
// against its own route where both sides are the board and agree perfectly.
//
// This is not hypothetical: the Home aggregate shipped keyed `events` and shadowed it for an hour.
// It was found by reading a PRODUCTION response and counting (15 boards, 14 keys), and it was
// harmless only because `h.events` has no writer anywhere in src/. `src/aggregate.js` now refuses a
// reserved key, which closes the aggregate path structurally — this closes the REST of the class,
// which that guard cannot see: any handler at all, by any mechanism, now or later.
//
// EMPIRICAL on purpose. The shape is built across many lines in many modules, so reading the source
// for it is guesswork, and guesswork here reports confident nonsense. This asks the running server.
{
  const call = async (m, u, o = {}) => {
    const r = await app.inject({ method: m, url: u, headers: o.token ? { authorization: `Bearer ${o.token}` } : {}, payload: o.body });
    let b = null; try { b = r.json(); } catch { /* not JSON */ }
    return { code: r.statusCode, body: b };
  };
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name: 'Envelope Probe' } });
  const meId = (await call('GET', '/v1/me', { token })).body.character.id;
  // A SECOND street, so the `:characterId` routes resolve a real counterparty rather than 404ing —
  // a param route that answers 404 is a route this sweep never actually looked at.
  const { body: { token: token2 } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token: token2, body: { name: 'Envelope Mark' } });
  const themId = (await call('GET', '/v1/me', { token: token2 })).body.character.id;
  // and a REAL recorded strike between them, so the one board that owns `events` actually returns a
  // NON-EMPTY one. Without this the declaration below is never exercised and the whole check passes
  // for the wrong reason — an empty board's `events` is indistinguishable from the envelope's.
  const accOf = async (id) => (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id;
  await app.pool.query(
    "INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,'jump','{}')",
    [randomUUID(), await accOf(meId), await accOf(themId)]);

  // THE ENVELOPE'S `events` IS ALWAYS `[]`. It is initialised at three sites in game.js and has NO
  // writer anywhere in src/, so a route whose `events` is anything else has had it replaced by a
  // board's own key of that name. Type-checking it as an array is far too weak to see that: a board
  // whose `events` is a list of history rows is an array too, and passes. Deep equality against the
  // empty envelope is the real check — and a board that legitimately owns the name is DECLARED here
  // with its reason, catalogue-or-declare, so it is a decision on the record rather than a silent
  // pass. (Renaming those is the wrong fix: `events` is the right word for a timeline, agents read
  // these boards, and the envelope slot being shadowed is dead.)
  const EVENTS_OWNED_BY_BOARD = new Map([
    ['/v1/people/history/:characterId', "the pair-history board's own timeline — the client renders it "
      + 'as the story of two bloodlines, and what it shadows is the dead envelope slot'],
  ]);

  // Param routes were the other half of the gap, and the bigger one: the first cut of this sweep
  // filtered them out wholesale, so the one live shadowing instance outside the aggregates sat in a
  // route the check could not reach. Substitute what we can and COUNT what we cannot — a param this
  // cannot synthesise is reported, never silently skipped.
  const FILL = { ':characterId': themId, ':targetId': themId, ':id': meId, ':accountId': themId };
  const unfillable = [];
  const urls = [...new Set(app.routes
    .filter((r) => r.method === 'GET' && r.url.startsWith('/v1/'))
    .map((r) => r.url))].sort();

  let checked = 0;
  let paramChecked = 0;
  const declaredSeen = new Set();     // a declaration only counts once it has actually been exercised
  const shadowed = [];
  for (const u of urls) {
    let target = u;
    for (const [p, v] of Object.entries(FILL)) target = target.split(p).join(v);
    if (target.includes(':')) { unfillable.push(u); continue; }
    const r = await call('GET', target, { token });
    if (r.code !== 200 || !r.body || typeof r.body !== 'object') continue;
    if (!Object.prototype.hasOwnProperty.call(r.body, 'character')) continue;  // keyless / non-enveloped
    checked++;
    if (u !== target) paramChecked++;
    if (!r.body.character || typeof r.body.character !== 'object' || !r.body.character.id) {
      shadowed.push(`${u}: \`character\` is not a character — ${JSON.stringify(r.body.character).slice(0, 70)}`);
    }
    if (Object.prototype.hasOwnProperty.call(r.body, 'events') && JSON.stringify(r.body.events) !== '[]') {
      if (EVENTS_OWNED_BY_BOARD.has(u)) declaredSeen.add(u);
      else {
        shadowed.push(`${u}: \`events\` is the BOARD's, not the envelope's — ${JSON.stringify(r.body.events).slice(0, 70)}`
          + '\n      (if the board legitimately owns that name, declare it in EVENTS_OWNED_BY_BOARD with the reason)');
      }
    }
  }
  // ANTI-VACUITY, both halves. A sweep that reaches nothing reports exactly like a clean sweep —
  // this probe's own first run said "0 routes checked, CLEAN" because it read a registry field that
  // does not exist. The param floor is here for the same reason one level down: the param half is
  // where the one real instance lives, so "it ran" is not the same as "it ran over params".
  assert(checked >= 40, `the envelope sweep only reached ${checked} enveloped routes — it is not looking at the surface it claims to`);
  assert(paramChecked >= 1, `the sweep reached ${paramChecked} PARAM routes — the one shadowing instance outside the aggregates lives in a param route, so a sweep that filters them out (as the first cut did) is exactly the gap that let it ship`);
  // A declaration must be REAL and EXERCISED. Real, or a stale waiver quietly re-opens the hole it
  // documents; exercised, or the whole check passes on an empty board and proves nothing — which is
  // what it did before the seed above, in the same shape as this probe's first vacuous run.
  for (const [u] of EVENTS_OWNED_BY_BOARD) {
    assert(urls.includes(u), `EVENTS_OWNED_BY_BOARD declares ${u}, which is not a mounted route — a stale waiver`);
    assert(declaredSeen.has(u), `EVENTS_OWNED_BY_BOARD declares ${u}, but this run never saw it return a non-empty `
      + '`events` — so the declaration is untested and the check would pass even if the board stopped shadowing '
      + '(or never started). Seed the state that makes that board answer.');
  }
  assert.deepEqual(shadowed, [], 'a route\'s own response REPLACES a readCharacter envelope field:\n  ' + shadowed.join('\n  '));
  console.log(`✅ the envelope survives all ${checked} enveloped routes (${paramChecked} of them param routes; `
    + `${unfillable.length} params this cannot synthesise are named, not skipped) — none replaces \`character\`, and `
    + `\`events\` is the envelope's empty slot everywhere except ${EVENTS_OWNED_BY_BOARD.size} board that owns the name by declaration`);
}

await app.close();
