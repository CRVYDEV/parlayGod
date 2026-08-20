// THE CLIENT'S WIRING (the 53rd suite).
//
// tools/mobile.js proves the screens LAY OUT. Nothing proved the buttons WORK. This does, for the
// three ways a control dies silently — all of which have shipped, repeatedly, and all of which were
// only ever caught by a person clicking through by hand:
//
//   1. THE ROUTE DOES NOT EXIST. The client calls `/v1/contracts/:id/cancel`, the server mounts
//      `/v1/contracts/:targetId/:kind/cancel`. The button 404s forever. Two deck entries were wrong
//      this way and were found by a manual verification pass; a rename on the server side would do
//      it again tomorrow, and nothing would notice.
//   2. THE VALUE IS NOT REAL. The client hardcodes a body the server rejects — `{path:'earner'}`
//      when the ids are `gun|brain|face`, or an npchit `tier:'local'` when the ladder is
//      `legbreaker|shooter|...`. The request is well-formed, the route exists, and it fails EVERY
//      time for every player.
//   3. THE FIELD IS NEVER READ. `{price: 50}` when the handler reads `req.body?.unitPrice`. Route
//      exists, value is sane, and the field is simply ignored — the server gets undefined on every
//      call. This is the `{drugId}` vs `{drug}` class, and checks 1 and 2 are both blind to it.
//   4. THE FIELD IS NEVER SENT — the mirror image, and the one the first three are blind to. The
//      client reads `b.book` off a board that returns `active`, or `SEC.windowHours` off a board
//      that never had it. No error is thrown: the screen renders `undefined`, or silently takes a
//      hardcoded fallback, or shows its empty-state coaching on a screen that is not empty. Both
//      of those shipped and are fixed; this now checks every field the client reads.
//
// Both the player console and /admin are covered. The dashboard is the one the founder would be
// holding during an incident, so a dead button there surfaces at the worst possible moment.
//
// Checks 1-3 are STATIC, against the server's own truth — fastify's mounted-route registry and the
// rules catalogs — so there are no side effects, no ordering, and no flake. Firing every control at
// a live server instead cannot tell "the client sent nonsense" apart from "you can't afford it",
// and a check that cannot tell those apart reports noise until someone deletes it.
//
// Check 4 is RUNTIME, by necessity: a response shape is assembled across many lines with spreads
// and conditionals, so reading it out of the source is guesswork, and guesswork here reports
// confident nonsense. It boots the server on pg-mem in-process, builds its own fixture, and looks
// at the actual JSON. No network, no shared state, deterministic.
//
// WHAT THIS DOES NOT CHECK, so a green run is not read as more than it is: whether a button is
// wired to the RIGHT route (only that its route exists — the four dead ones found on the first run
// were each traced to the correct HANDLER by hand), whether a REQUIRED field is missing rather than
// misnamed, or whether the action then behaves correctly. Those need the gameplay suites, which exist.
process.env.MOD_KEY = 'test-mod-key';
process.env.WORLD_RAID_P = '1';   // the rout driven below must land every run, not most runs
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { M3, M4, PATHS, NPC_HITMEN, HEIST_ROLES, HEIST_JOBS, DRUGS, GOODS, DISTRICTS,
  COMMISSION, CONVOY, DUELS, TERRITORY_TYPES, CARS, TRIMS, ASSETS, BUSINESSES, ESTATE, WIRE, SECRETS, STABLE, WORLD, WORLD_NPCS } from '../src/rules.js';

// A COMMENT IS NOT CODE, and this guard used to read it as if it were. The mirror resolves a field
// access as `<binding>.<name>`, and this file's comments are dense and name source files constantly
// — so `duels.js` inside a comment, in a renderer that binds `const duels = …` off /v1/duels, was
// reported as "renderPvp reads js off /v1/duels", a phantom field that does not exist. It bit on the
// first comment written after the check shipped. A guard's FALSE POSITIVE is as corrosive as a false
// pass: both teach the reader to stop believing it.
//
// Only WHOLE-LINE comments are blanked, deliberately. A trailing `// …` after code would need real
// quote tracking to strip safely (`https://`, and `//` inside the template literals this client is
// made of), and stripping one wrongly would delete code the checks must see. Conservative in the
// safe direction: every comment in this tree sits on its own line, so this catches them all, and
// anything it misses stays checked rather than silently dropped.
const decomment = (s) => s.replace(/^[ \t]*\/\/.*$/gm, '');
const html = decomment(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
const admin = decomment(readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8'));

// ── 0. THE CLIENT SCRIPT MUST PARSE ─────────────────────────────────────────────────────────────
// A syntax error in a client <script> — an apostrophe inside a single-quoted string, an unbalanced
// brace — breaks the ENTIRE console in a browser and takes every screen down with it. It has bitten
// twice (renderBoxing `managers\'`, `crew's ready`), and the checks BELOW read the script as TEXT, so
// they structurally cannot see it — only a real parse can. `vm.Script` COMPILES without running, so a
// browser global (document/window/fetch) is just an unresolved identifier (fine); an unterminated
// string or a stray brace is a SyntaxError at compile (caught). Checked on the RAW file (not the
// decommented copy the wiring checks use) so it's exactly what the browser parses. Runs FIRST, because
// a dead script makes every check below meaningless. The mobile harness catches this too — but only in
// CI's Chromium job, and this is a one-line, browser-free tripwire that names the file and the error.
{
  let checked = 0;
  for (const path of ['public/index.html', 'public/admin.html']) {
    const raw = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const blocks = [...raw.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    assert(blocks.length, `${path}: no <script> block found — did the file move?`);
    for (const [, attrs, code] of blocks) {
      if (/\bsrc\s*=/.test(attrs)) continue;                                                    // external script, no inline body
      if (/type\s*=\s*["'](?:application\/(?:ld\+)?json|importmap)["']/.test(attrs)) continue;  // data, not JS
      if (/type\s*=\s*["']module["']/.test(attrs)) continue;                                    // ESM — vm.Script is classic-only (none today; revisit if one is added)
      try { new vm.Script(code); checked++; }
      catch (e) { assert.fail(`${path}: the <script> has a SYNTAX ERROR — the whole page is DEAD in a browser: ${e.message}`); }
    }
  }
  assert(checked >= 2, `expected to parse-check both client scripts (console + admin), only checked ${checked} — a real script block was skipped`);
}

const app = await buildServer();

// ── 1. every route the client can call must be mounted ──────────────────────────────────────────
// Three ways the client names a route, all collected: the declarative attribute the curated screens
// use, the api()/act() calls in JS, and the raw deck's [METHOD, path, body] tuples.
const refs = new Map();                       // "METHOD /path" → where it was found
const addRef = (method, rawPath, where) => {
  if (!rawPath.startsWith('/v1')) return;     // /wiki, /agents, external links — not API surface
  // `${expr}` is a value the client fills at runtime; the server calls that segment a :param.
  let path = rawPath.replace(/\$\{[^}]*\}/g, ':p').split('?')[0];
  // a trailing slash means the id arrives by CONCATENATION (`'/v1/phone/dm/' + id`) rather than
  // interpolation. Without this the reference reads as the parent route and looks unmounted.
  path = path.endsWith('/') ? path + ':p' : path;
  const key = `${method.toUpperCase()} ${path}`;
  if (!refs.has(key)) refs.set(key, where);
};

// Reading the path out of `api('POST', ...)` needs a real scan, not a regex: a template literal can
// contain quotes INSIDE its `${}` (``/v1/streets/${t.querySelector('x').value}/jump``), and a regex
// that stops at the first quote truncates the path into something that looks unmounted. Consuming
// balanced braces is the difference between a finding and a false alarm.
const readLiteral = (src, i) => {
  const quote = src[i];
  if (quote !== '`' && quote !== "'" && quote !== '"') return null;
  let out = '', depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { out += src[j + 1] ?? ''; j++; continue; }
    if (quote === '`' && c === '$' && src[j + 1] === '{') { depth++; out += '${'; j++; continue; }
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; out += c; continue; }
    if (c === quote) return { value: out, end: j };
    if (c === '\n') return null;              // an unterminated literal is not a path
    out += c;
  }
  return null;
};

// Not every call NAMES its path with a literal. `api('GET', room === 'family' ? '/v1/gangs/chat'
// : '/v1/chat')` picks between two, and readLiteral returns null because the argument does not
// start with a quote. Silently skipping those is the worst possible failure for a coverage test —
// four chat routes went entirely unchecked and the run still printed "passed". So the whole
// argument expression is walked instead, collecting every /v1 literal it could evaluate to, and
// anything STILL unreadable is counted and asserted to be zero rather than dropped.
const pathsInArg = (src, i) => {
  const out = [];
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') {
      const lit = readLiteral(src, j);
      if (!lit) break;
      if (lit.value.startsWith('/v1')) out.push(lit.value);
      j = lit.end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; continue; }
    if (c === ',' && depth === 0) break;       // end of the path argument
  }
  return out;
};

let unreadable = 0;
const addCall = (src, m, where) => {
  const at = m.index + m[0].length;
  const lit = readLiteral(src, at);
  if (lit) { addRef(m[1], lit.value, where); return; }
  const branches = pathsInArg(src, at);
  if (!branches.length) { unreadable++; return; }
  for (const p of branches) addRef(m[1], p, `${where} (branch)`);
};

for (const m of html.matchAll(/data-do="(GET|POST|PUT|DELETE)\s+([^"]+)"/g)) addRef(m[1], m[2], 'data-do');
for (const m of html.matchAll(/\[\s*'(GET|POST|PUT|DELETE)'\s*,\s*'([^']+)'/g)) addRef(m[1], m[2], 'the deck');
for (const m of html.matchAll(/\b(?:api|act)\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) addCall(html, m, 'api()/act()');
// THE OPS DASHBOARD is a second client against the same server, and the one the founder would be
// holding during an incident — a dead button there is discovered at the worst possible moment. It
// calls through its own j(method, path) helper, so it needs its own extraction or it goes unchecked.
for (const m of admin.matchAll(/\bj\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g)) addCall(admin, m, '/admin');

assert.equal(unreadable, 0, `${unreadable} api()/act() call site(s) name their path in a way this ` +
  `cannot read, so those routes go UNCHECKED while the run still passes — extend pathsInArg()`);
assert(refs.size > 150, `only ${refs.size} client route references found — the extraction broke, ` +
  `which would make every assertion below vacuous`);

// A mounted route matches a reference when the segments line up and every server :param slot is
// filled by something. Compared segment-wise rather than by regex because a path like
// /v1/streets/:id/jump must not match /v1/streets/roster.
const mounted = app.routes.map((r) => ({ method: r.method, url: r.url, seg: r.url.split('/') }));
// STRICT: a server :param swallows anything, but a client :p must land where the server has a param.
// RELAXED additionally lets a client :p stand in for a server LITERAL — which is what a call like
// `/v1/garage/${id}/${action}` is: the client picks the ACTION at runtime, so no static check can
// name the route. Those match relaxed-but-not-strict and are counted as unverifiable, not failed.
// Reporting that count is the point: it says out loud how much of the surface this cannot cover.
const matches = (ref, relaxed) => {
  const [method, path] = ref.split(' ');
  const seg = path.split('/');
  return mounted.some((r) => {
    const rm = Array.isArray(r.method) ? r.method : [r.method];
    if (!rm.includes(method)) return false;
    if (r.seg.length !== seg.length) return false;
    return r.seg.every((s, i) => s.startsWith(':') || s === seg[i] || (relaxed && seg[i] === ':p'));
  });
};

const unresolved = [...refs.entries()].filter(([ref]) => !matches(ref, false));
const dynamic = unresolved.filter(([ref]) => matches(ref, true));
const dead = unresolved.filter(([ref]) => !matches(ref, true));
assert.deepEqual(dead.map(([r, w]) => `${r}  (${w})`), [],
  `the client calls ${dead.length} route(s) that are NOT mounted — those buttons 404 for every player`);

// ── 1b. the routes whose ACTION the client picks at runtime ─────────────────────────────────────
// `act('POST', `/v1/garage/${id}/${what}`)` cannot be named statically, so the check above could
// only count it as unverifiable — a polite way of saying five real surfaces went unchecked. They
// ARE enumerable: `what` comes from a data-attribute whose values are written in this same file.
// Each base path is listed with the source of its actions, every value is read out of the HTML, and
// every resulting CONCRETE route is checked. The unverifiable list must then come out EMPTY — so a
// new runtime-built call fails the run until it is listed here, rather than quietly going uncovered.
const attrValues = (name) => {
  const vals = [...new Set([...html.matchAll(new RegExp(`data-${name}="([a-z]+):`, 'g'))].map((m) => m[1]))];
  assert(vals.length, `no data-${name} values found — the action extraction broke, not the client`);
  return vals;
};
const RUNTIME_ACTIONS = new Map([
  ['POST /v1/garage/:p/:p',     () => attrValues('cardo')],
  ['POST /v1/armory/gun/:p/:p', () => attrValues('gundo')],
  ['POST /v1/heists/:p/:p',     () => attrValues('heistdo')],
  ['POST /v1/loans/:p/:p',      () => attrValues('loando')],
  // this one is a for-of over literal [attribute, path] pairs, not a data-attribute prefix
  ['POST /v1/underworld/:p/:p', () => [...html.matchAll(/\['uw[a-z]+', '([a-z]+)'\]/g)].map((m) => m[1])],
]);
const unlisted = dynamic.filter(([ref]) => !RUNTIME_ACTIONS.has(ref)).map(([r, w]) => `${r}  (${w})`);
assert.deepEqual(unlisted, [], `${unlisted.length} route(s) build their action at runtime and are ` +
  `not listed in RUNTIME_ACTIONS, so nothing checks them — add them there with the source of their actions`);
const runtimeDead = [], runtimeChecked = [];
for (const [ref, source] of RUNTIME_ACTIONS) {
  const actions = source();
  assert(actions.length, `${ref} resolved to zero actions — the extraction broke`);
  for (const a of actions) {
    const concrete = ref.replace(/:p$/, a);
    runtimeChecked.push(concrete);
    if (!matches(concrete, false)) runtimeDead.push(concrete);
  }
}
assert.deepEqual(runtimeDead, [], `${runtimeDead.length} runtime-built route(s) are NOT mounted`);

// ── 2. every value the client hardcodes must be one the server recognises ────────────────────────
// Only fields whose valid set is a CATALOG the server publishes. A field is listed here or it is
// skipped, and the count of skipped fields is printed, so the coverage this check has is visible
// rather than assumed. The map is the point of the test: adding a catalog-backed field to the
// client without adding it here is the gap that lets the next `{path:'earner'}` through.
// The catalogs come in both shapes — an array of {id,…} and an object keyed BY id. Reading an array
// with Object.keys() yields "0,1,2", which would have made every value here look bogus. Handle both,
// and assert the result is non-trivial so a shape change fails loudly instead of silently emptying.
const ids = (c) => {
  const set = new Set(Array.isArray(c) ? c.map((x) => x.id) : Object.keys(c));
  assert(set.size > 1 && !set.has(undefined) && !set.has('0'),
    `a catalog resolved to ${[...set].slice(0, 4).join(',')} — the id extraction is wrong, not the client`);
  return set;
};
const CATALOGS = {
  approach: ids(M3.CRIME_APPROACHES),          // the crime verb
  intent: ids(M3.JUMP_INTENTS),                // the jump verb
  play: ids(M4.DEAL_PLAYS),                    // the corner verb
  path: ids(PATHS),                            // shipped wrong once: {path:'earner'}
  tier: ids(NPC_HITMEN),                       // shipped wrong once: tier:'local'
  role: ids(HEIST_ROLES),
  job: ids(HEIST_JOBS),
  drugId: ids(DRUGS),                          // the drug/drugId rename class
  goodId: ids(GOODS),
  to: ids(DISTRICTS),                          // travel / convoy destination
  direction: new Set(['buy', 'sell']),         // the swap — server-side literals, not a catalog
  decree: new Set(COMMISSION.DECREES.map((d) => d.id)),
  guards: new Set(CONVOY.GUARD_TIERS.map((t) => t.id)),
  style: new Set(DUELS.STYLES.map((s) => s.id)),
  side: new Set(['a', 'b']),                   // the fight/main-event book — server-side literals
  // `kind` is POLYMORPHIC: contracts take kill|hospitalize, the exchange cb|ammo|item, territory a
  // racket type. Check 2 scans literals without route context, so this is the UNION — it catches
  // the real failure (a typo, `hospitalise`) but not a value that belongs to a different route.
  // Binding a value to its own route is check 3's job, and it does that for the field NAMES.
  kind: new Set(['kill', 'hospitalize', 'cb', 'ammo', 'item', ...TERRITORY_TYPES.map((t) => t.id)]),
};
// Everything else the two literal regexes pick up is NOT an API value: the i18n dictionary (k_*
// labels, b_* buttons — these grow with every translated string, so they go by prefix) and a
// handful of browser/client-internal keys. Listing them is the point: an unlisted field means
// somebody added a catalog-backed literal and it would otherwise be skipped in silence, which is
// exactly how `{path:'earner'}` survived. Catalog it, or declare it here as not-an-API-value.
const NOT_API = new Set([
  'block',      // scrollIntoView({block:'nearest'})
  'error',      // the client's own {error:'offline'} shape
  'inline',     // scrollIntoView({inline:'center'})
  'method',     // window.ethereum.request({method:'personal_sign'}) — EIP-1193, not our API
  'saved',      // the language picker's localStorage value
  'fx',         // cineFor()'s own spec — which flash/shake to play, never sent anywhere
  'no',         // ask()'s decline-button label
  'placeholder',// askNum()'s input placeholder
  'id',         // the milestone-TIPS registry key (localStorage suffix, client-internal)
  'tab',        // TIPS jump targets — setTab() destinations, never sent to the server
  'type',       // THE SOUNDTRACK's WebAudio oscillator type ('sine'/'triangle'/…) — synth-internal, never sent
  'met',        // the black book's HOW_CHIP display map ({met:'met', …}) — render labels, never sent
  'intel',      // ditto ({intel:'tapped'})
  'cls',        // heroBand()'s stat class ('neon'/'warn') — the focal-header CSS accent, never sent
  'label',      // heroBand()'s stat label — the render caption under the big number, never sent
]);
// `field: 'value'` (deck bodies, JS objects) and `"field":"value"` (data-body attributes).
const literals = [];
for (const m of html.matchAll(/([a-zA-Z_]+)\s*:\s*'([a-z0-9_]+)'/g)) literals.push([m[1], m[2]]);
for (const m of html.matchAll(/"([a-zA-Z_]+)"\s*:\s*"([a-z0-9_]+)"/g)) literals.push([m[1], m[2]]);

const checked = [], skipped = new Set(), bogus = [];
for (const [field, value] of literals) {
  const cat = CATALOGS[field];
  if (!cat) { skipped.add(field); continue; }
  checked.push(`${field}=${value}`);
  if (!cat.has(value)) bogus.push(`${field}: '${value}' — the server knows ${[...cat].slice(0, 6).join('|')}…`);
}
assert.deepEqual(bogus, [],
  `the client hardcodes ${bogus.length} value(s) the server does not recognise — those controls fail for every player`);
assert(checked.length > 10, `only ${checked.length} catalog values checked — the extraction broke`);
// i18n dictionary keys grow with every translated string, so they go by prefix; everything else
// has to be catalogued or declared. A field landing here is a decision to make, not a silent skip.
const undeclared = [...skipped].filter((f) => !NOT_API.has(f) && !/^[kb]_/.test(f)).sort();
assert.deepEqual(undeclared, [], `${undeclared.length} literal field(s) are neither catalog-backed ` +
  `nor declared as non-API, so their values go unchecked — add them to CATALOGS or to NOT_API`);

// ── 3. every body field the client sends must be one its route actually reads ────────────────────
// The class the two checks above CANNOT see: `{drug: 'vim'}` when the handler reads `req.body?.drugId`.
// The route exists, the value is a real drug id, and the field is simply never read — so the server
// receives undefined and refuses (or worse, proceeds with a default) on every single call.
//
// Resolved PER ROUTE, not against a global pool of field names, because `qty` being read *somewhere*
// says nothing about whether THIS handler reads it. Each registration's source text is sliced out and
// scanned for the shapes this codebase actually uses: `req.body?.x`, `req.body.x`, and destructuring.
const srcFiles = ['src/server.js', ...readdirSync(new URL('../src/routes', import.meta.url)).map((f) => `src/routes/${f}`)];
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// THE SECOND HOP. Some handlers hand the WHOLE `req.body` to a module — `Market.listItem(ch,
// req.body, …)` — so the fields are read a file away and the scan above sees none. Leaving those
// unresolved is leaving the exact place this bug class hides. So follow the call: the alias map
// comes off server.js's own imports, the function is located in that module, the argument POSITION
// says which parameter the body lands in, and that parameter's reads are what the route accepts.
const aliases = new Map([...read('src/server.js').matchAll(/import \* as (\w+) from '\.\/([\w.]+)'/g)]
  .map((m) => [m[1], `src/${m[2]}`]));
const cache = new Map();
const modSrc = (f) => { if (!cache.has(f)) { try { cache.set(f, read(f)); } catch { cache.set(f, null); } } return cache.get(f); };
const splitArgs = (s) => {                    // top-level commas only — `f(a, g(b, c), {d: 1})`
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((a) => a.trim());
};
const paramFields = (src, fn, argIdx, from = 'src/x.js', depth = 0) => {
  const def = new RegExp(`export (?:async )?function ${fn}\\s*\\(([^)]*)\\)`).exec(src);
  // social.js is a BARREL — `export { listItem } from './social/exchange.js'` — so the function is
  // one more file down. Following that is the difference between resolving a route and recording
  // it as unresolvable, and the barrel pattern spreads: miss it and coverage quietly shrinks.
  if (!def && depth < 3) {
    for (const re of src.matchAll(/export \{([^}]*)\} from '\.\/([\w./]+)'/g)) {
      if (!re[1].split(',').some((n) => n.trim() === fn)) continue;
      const dir = from.slice(0, from.lastIndexOf('/'));
      const sub = modSrc(`${dir}/${re[2]}`);
      if (sub) return paramFields(sub, fn, argIdx, `${dir}/${re[2]}`, depth + 1);
    }
  }
  if (!def) return null;
  const param = splitArgs(def[1])[argIdx]?.split('=')[0].trim();
  if (!param || !/^[a-zA-Z_$][\w$]*$/.test(param)) return null;
  const after = src.indexOf('\nexport ', def.index + 1);
  const fnBody = src.slice(def.index, after < 0 ? src.length : after);
  const fields = new Set();
  for (const f of fnBody.matchAll(new RegExp(`\\b${param}\\s*\\??\\.\\s*([a-zA-Z_][\\w]*)`, 'g'))) fields.add(f[1]);
  for (const d of fnBody.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${param}\\b`, 'g')))
    for (const n of d[1].split(',')) { const k = n.split(':')[0].trim(); if (k) fields.add(k); }
  // A COMPUTED read over a literal list is still a field set, just not spelled `param.field`:
  // `for (const s of ['muscle','cunning','speed']) … Number(alloc?.[s])` is exactly the three
  // fields /v1/respec accepts. Only counted when the loop variable is what indexes the parameter.
  for (const loop of fnBody.matchAll(/for \(const (\w+) of \[([^\]]*)\]\)/g)) {
    if (!new RegExp(`\\b${param}\\s*\\??\\.?\\s*\\[\\s*${loop[1]}\\s*\\]`).test(fnBody)) continue;
    for (const lit of loop[2].matchAll(/'([a-zA-Z_][\w]*)'/g)) fields.add(lit[1]);
  }
  return fields.size ? fields : null;
};
const followBody = (handler) => {
  const call = /(\w+)\.(\w+)\(([^)]*req\.body[^)]*)\)/.exec(handler);
  if (!call) return null;
  const file = aliases.get(call[1]) || '';
  const src = modSrc(file);
  if (!src) return null;
  const idx = splitArgs(call[3]).findIndex((a) => /req\.body/.test(a));
  return idx < 0 ? null : paramFields(src, call[2], idx, file);
};

// Self-check the two resolvers on shapes the tree does not currently contain, so they are not
// shipped unverified: no whole-body route goes through a barrel TODAY, and the day one does is
// exactly the day this would silently stop resolving. Synthetic sources primed into the cache.
cache.set('src/_barrel.js', "export { doThing } from './_sub/impl.js';\n");
cache.set('src/_sub/impl.js', 'export async function doThing(ch, opts, client) { return opts.alpha + opts?.beta; }\n');
assert.deepEqual([...(paramFields(cache.get('src/_barrel.js'), 'doThing', 1, 'src/_barrel.js') || [])].sort(),
  ['alpha', 'beta'], 'the barrel hop stopped resolving re-exported handlers');
cache.set('src/_loop.js', "export function f(ch, a) { for (const s of ['x', 'y']) g(a?.[s]); }\n");
assert.deepEqual([...(paramFields(cache.get('src/_loop.js'), 'f', 1, 'src/_loop.js') || [])].sort(), ['x', 'y'],
  'the computed-read resolver stopped reading fields indexed by a literal list');

// THE THIRD HOP — a route that delegates to a LOCAL helper taking `req`: `postChat(req, 'crew')`
// (the chat rooms all route through one `postChat(req, room)` in server.js). followBody only chases
// `Module.method(req.body, …)`; here `req` (not `req.body`) is handed to a same-file function that
// reads `req.body?.text` itself. Resolve it by scanning that local function's body for the field
// reads. Bounded window (the helper is a handful of lines) — approximate but it recovers `text`,
// which is exactly what the crew/family/city chat routes need to be checked at all.
const followLocal = (routeBody, src) => {
  // a CALL is `name(req` with NO space (the arrow param `async (req)` has one — and `async`/`await`
  // must never be mistaken for the delegate). Match the name tight against its paren.
  const call = /\b([a-z][a-zA-Z0-9_]*)\(\s*req\s*[,)]/.exec(routeBody.replace(/\basync\b|\bawait\b/g, ''));
  if (!call) return null;
  const def = new RegExp(`(?:const\\s+${call[1]}\\s*=|function\\s+${call[1]}\\b)`).exec(src);
  if (!def) return null;
  const win = src.slice(def.index, def.index + 1500);
  const fields = new Set();
  for (const f of win.matchAll(/req\.body\s*\??\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)) fields.add(f[1]);
  return fields.size ? fields : null;
};
const handlerFields = new Map();              // "METHOD /path" → Set(field) | null when unresolvable
for (const rel of srcFiles) {
  const src = read(rel);
  const regs = [...src.matchAll(/\bapp\.(get|post|put|delete)\(\s*'([^']+)'/g)];
  regs.forEach((m, i) => {
    const body = src.slice(m.index, i + 1 < regs.length ? regs[i + 1].index : src.length);
    const fields = new Set();
    for (const f of body.matchAll(/req\.body\s*\??\.\s*([a-zA-Z_][a-zA-Z0-9_]*)/g)) fields.add(f[1]);
    for (const d of body.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\.body/g)) {
      for (const name of d[1].split(',')) { const n = name.split(':')[0].trim(); if (n) fields.add(n); }
    }
    const wholeBody = /req\.body\s*(?:\|\|\s*\{\})?\s*[,)]/.test(body);
    const resolved = fields.size ? fields
      : wholeBody ? followBody(body)
      : (followLocal(body, src) ?? fields);   // a local req-delegating helper (the chat rooms) — else the empty set
    handlerFields.set(`${m[1].toUpperCase()} ${m[2]}`, resolved);
  });
}

// what the client SENDS: the deck's third tuple element, and data-body="{…}".
const sends = [];                             // [method, path, [field…], where]
// The keys of a body object — at the TOP level only. A regex over the object's text would report a
// nested object's keys as fields of the request (`{a:{b:1}}` → a,b), and `b` would then be compared
// against a handler that never sees it: a manufactured failure. Walked properly instead, so quoted
// keys, shorthand (`{amount}`), computed values and spreads all land where they belong.
const topKeys = (src, i) => {
  if (src[i] !== '{') return null;
  const out = [];
  let j = i + 1;
  const ws = () => { while (j < src.length && /\s/.test(src[j])) j++; };
  const skipValue = () => {                   // forward past one value to its ',' or the closing '}'
    let d = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "'" || c === '"' || c === '`') { const l = readLiteral(src, j); if (!l) return; j = l.end; continue; }
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') { if (d === 0) return; d--; }
      else if (c === ',' && d === 0) return;
    }
  };
  while (j < src.length) {
    ws();
    if (src[j] === '}' || j >= src.length) break;
    if (src[j] === ',') { j++; continue; }
    let key = null;
    if (src[j] === "'" || src[j] === '"' || src[j] === '`') {
      const l = readLiteral(src, j); if (!l) break; key = l.value; j = l.end + 1;
    } else if (/[a-zA-Z_$]/.test(src[j])) {
      const w = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(src.slice(j)); key = w[0]; j += w[0].length;
    } else { skipValue(); continue; }         // `...spread`, a computed key, anything else
    ws();
    out.push(key);
    if (src[j] === ':') { j++; ws(); skipValue(); }   // else shorthand `{amount}` — key is the field
  }
  return out;
};
for (const m of html.matchAll(/\[\s*'(GET|POST|PUT|DELETE)'\s*,\s*'([^']+)'\s*,\s*/g)) {
  const keys = topKeys(html, m.index + m[0].length);
  if (keys?.length) sends.push([m[1], m[2], keys, 'the deck']);
}
for (const m of html.matchAll(/data-do="(GET|POST|PUT|DELETE)\s+([^"]+)"[^>]*?data-body='(\{[^']*\})'/g)) {
  const keys = [...m[3].matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g)].map((k) => k[1]);
  if (keys.length) sends.push([m[1], m[2], keys, 'data-body']);
}
// AND the api()/act() calls — the third source, and the one the curated screens actually use. It
// was missing, and that hole was not theoretical: the Vault screen sent `{amount}` to /v1/unstake,
// whose handler takes no body and always unstakes EVERYTHING, so a player who typed a number into
// the box emptied their whole stake and the field was silently dropped. The deck and the
// attributes were checked; the buttons a player actually presses were not.
const callBodies = (src, re, where) => {
  for (const m of src.matchAll(re)) {
    const at = m.index + m[0].length;
    const lit = readLiteral(src, at);
    const paths = lit ? [lit.value] : pathsInArg(src, at);
    if (!paths.length) continue;
    let j = (lit ? lit.end + 1 : at);
    while (j < src.length && /[\s,]/.test(src[j])) j++;   // to the body argument
    const keys = topKeys(src, j);
    if (!keys?.length) continue;
    for (const p of paths) if (p.startsWith('/v1')) sends.push([m[1], p, keys, where]);
  }
};
callBodies(html, /\b(?:api|act)\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g, 'api()/act()');
// /admin's bodies too — the route check already covers the dashboard for the reason stated above,
// and a mod action that quietly drops its field is found during the incident it was meant to fix.
callBodies(admin, /\bj\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*/g, '/admin');
assert(sends.length > 20, `only ${sends.length} client bodies found — the extraction broke`);

// match a sent body to its route the same segment-wise way, then compare field by field
const unread = [], unresolvable = [];
for (const [method, rawPath, keys, where] of sends) {
  const path = rawPath.replace(/\$\{[^}]*\}/g, ':p').split('?')[0];
  const seg = path.split('/');
  // TWO handlers can match one path: `/v1/skills/respec` is shadowed by `/v1/skills/:id`, and
  // there are eight such pairs. fastify serves the most specific one, so this has to pick the same
  // one — taking the first match compares the body against the WRONG handler's fields, which is
  // both a missed bug and a possible false alarm depending on which way the file happens to be ordered.
  const params = (k) => k.split('/').filter((s) => s.startsWith(':')).length;
  const hit = [...handlerFields.entries()]
    .filter(([k]) => {
      const [hm, hp] = k.split(' ');
      if (hm !== method) return false;
      const hs = hp.split('/');
      return hs.length === seg.length && hs.every((s, i) => s.startsWith(':') || s === seg[i]);
    })
    .sort((a, b) => params(a[0]) - params(b[0]))[0];
  if (!hit) continue;                                    // route-existence is check 1's job
  if (hit[1] === null) { unresolvable.push(hit[0]); continue; }
  for (const k of keys) if (!hit[1].has(k)) unread.push(`${method} ${path} sends '${k}' — the handler reads ${[...hit[1]].join('|') || 'no body at all'}`);
}
assert.deepEqual(unread, [],
  `the client sends ${unread.length} body field(s) its route never reads — those actions get undefined every time`);
assert.deepEqual(unresolvable, [], `${unresolvable.length} route(s) the client posts a body to hand ` +
  `that body to a module this cannot follow, so their fields go unchecked — teach followBody() the shape`);

// ── 3b. A QUANTITY THE PLAYER CHOOSES MUST BE ASKED FOR ─────────────────────────────────────────
// Check 3's exact inverse, and it made the game's heaviest verb INERT. `fire` takes a `rounds` count
// and floors it: `Math.max(50, Math.floor(Number(rounds) || 0))`. The console's FIRE button sent no
// body at all, so every shot it ever fired was exactly 50 rounds — and the best gun in the game turns
// 50 into 95 effective against a floor of ~390 for a LEVEL-1 mark. The button could not kill anybody,
// at any level, with any gun, ever: 3h of search, the energy, the ammo, a 2h trigger cooldown, and a
// success toast on a man still standing. Found by pressing it.
//
// Deliberately a NAMED regression rather than a general sweep, because the population is ONE and a
// guard for a class of one is a regression with extra steps. Every other floored quantity in src/
// either REFUSES loudly (`Number(x) || 0` → a validation error the player sees) or defaults to
// something usable (`Math.max(1, …)` on a qty means "buy one"). `Math.max(50, …)` on rounds is the
// only substitution that neither refuses nor works, which is exactly why it hid. If a second one is
// ever written, list it here beside this one.
const ASK_THE_PLAYER = [
  ['POST', '/v1/streets/:p/fire', 'rounds',
    'the server floors it to 50, which cannot kill a level-1 mark with the best gun in the game'],
];
// The two failures are kept DISTINCT on purpose. `sends` only carries calls with a non-empty body
// literal, so a control that regressed to `{}` — which is exactly what the bug was — simply vanishes
// from it and would fail the anti-vacuity line with "find where the control moved to", teaching the
// wrong thing about the one shape this exists to catch. So existence is proven against the client
// SOURCE and the field against the parsed body, and each says what really happened.
for (const [method, path, field, why] of ASK_THE_PLAYER) {
  const live = new RegExp(`'${method}'\\s*,\\s*[\`']${path.replace(/:p/g, '\\$\\{[^}]*\\}').replace(/\//g, '\\/')}[\`']`).test(html);
  assert(live, `no client control calls ${method} ${path} at all — this regression is vacuous. Find where ` +
    `the control moved to and point this at it (it must still send '${field}': ${why})`);
  const hits = sends.filter(([m, p]) => m === method && p.replace(/\$\{[^}]*\}/g, ':p').split('?')[0] === path);
  assert(hits.length, `the ${method} ${path} control sends NO body at all — so the server substitutes its ` +
    `own '${field}', and ${why}. The player has to be asked; a silent default here is a button that ` +
    `spends the search, the energy, the ammo and the cooldown, and does nothing.`);
  for (const [, , keys] of hits) assert(keys.includes(field),
    `the ${method} ${path} control sends ${JSON.stringify(keys)} and NOT '${field}' — ${why}.`);
}

// ── 4. every field the client READS must be one its route actually returns ───────────────────────
// The mirror of check 3, and the class the other three cannot see: the client reads `b.book` off a
// board that returns `active`. Nothing throws — the screen renders undefined, or quietly falls back
// to a hardcoded number, or shows its "nothing here yet" card on a screen full of the player's
// loans. Both of those were live and are fixed.
//
// Four extraction disciplines, each of which produced a FALSE finding before it was added, and any
// one of which missing turns this into noise:
//   · innermost-BLOCK scope, not the enclosing named function — a `const b` inside one arrow is
//     block-scoped, and reusing the name in a sibling arrow is ordinary JS.
//   · shadow blanking — `.map((b) => …)` and `for (const b of …)` re-bind the same short names.
//   · a `(?<![\w$.])` lookbehind — without it `m.b.pool` reads as `b.pool`.
//   · JS builtins excluded — `.map`/`.length` are not response fields.
// Anything still unattributable is COUNTED and asserted to be zero, never quietly dropped.
//
// This covers the TOP-LEVEL fields of each response; check 4b below covers the fields of LIST
// ELEMENTS, which is where most board rendering actually lives.
const BUILTIN = new Set(['map','length','sort','filter','slice','join','find','some','every','forEach','reduce',
  'includes','indexOf','toFixed','toLowerCase','toUpperCase','split','trim','concat','push','pop','shift','flat',
  'flatMap','keys','values','entries','hasOwnProperty','toString','then','catch','finally','padStart','padEnd',
  'replace','match','startsWith','endsWith','repeat','at','reverse','findIndex','charAt','substring','splice']);
// readLiteral() above stops at a newline — right for a PATH, which never spans lines, and it must
// keep doing that or an unterminated quote would swallow the rest of the file. But this client is
// built out of multi-line template literals, and every `{` inside one would be counted as a block,
// so scoping needs a reader that lets backticks run on. Same shape, one deliberate difference.
// It must also track `${}` depth: this client nests templates inside templates
// (`${rows.map((r) => `<div>${r.name}</div>`).join('')}`), and a reader that stops at the first
// backtick ends the outer literal in the middle, leaving its braces to corrupt the block map.
const strEnd = (src, i) => {
  const q = src[i];
  let d = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') { d++; j++; continue; }
    if (d > 0) { if (c === '{') d++; else if (c === '}') d--; continue; }
    if (c === q) return j;
    if (c === '\n' && q !== '`') return null;
  }
  return null;
};
const blocksOf = (src) => {                   // string-aware: the client is mostly template literals
  const out = [], stack = [];
  for (let j = 0; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { const e = strEnd(src, j); if (e == null) continue; j = e; continue; }
    if (c === '/' && src[j + 1] === '/') { const nl = src.indexOf('\n', j); if (nl < 0) break; j = nl; continue; }
    if (c === '{') stack.push(j);
    else if (c === '}') { const st = stack.pop(); if (st != null) out.push([st, j]); }
  }
  return out;
};
const blankShadows = (src, v) => {            // blank every region where `v` is RE-bound
  const esc = v.replace('$', '\\$');
  const binders = [new RegExp(`\\(\\s*${esc}\\s*(?:,[^)]*)?\\)\\s*=>`, 'g'), new RegExp(`(?<![\\w$.])${esc}\\s*=>`, 'g'),
    new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${esc}\\s+of`, 'g'), new RegExp(`catch\\s*\\(\\s*${esc}\\s*\\)`, 'g'),
    new RegExp(`function\\s*\\(\\s*${esc}\\s*(?:,[^)]*)?\\)`, 'g')];
  let out = src, unresolved = 0;
  for (const re of binders) {
    let m;
    while ((m = re.exec(out))) {
      let k = m.index + m[0].length;
      while (k < out.length && /\s/.test(out[k])) k++;
      let end = -1;
      if (out[k] === '{' || out[k] === '(') {
        const open = out[k], close = open === '{' ? '}' : ')';
        let d = 0;
        for (let j = k; j < out.length; j++) { if (out[j] === open) d++; else if (out[j] === close && --d === 0) { end = j + 1; break; } }
      } else {
        let d = 0;
        for (let j = k; j < out.length; j++) {
          const c = out[j];
          if ('([{'.includes(c)) d++;
          else if (')]}'.includes(c)) { if (d === 0) { end = j; break; } d--; }
          else if ((c === ',' || c === ';') && d === 0) { end = j; break; }
        }
        if (end < 0) end = out.length;
      }
      if (end < 0) { unresolved++; break; }
      out = out.slice(0, m.index) + ' '.repeat(end - m.index) + out.slice(end);
      re.lastIndex = m.index;
    }
  }
  return { src: out, unresolved };
};
// ── 4b. the fields of LIST ELEMENTS ──────────────────────────────────────────────────────────────
// Where most board rendering actually lives: `b.paper.map((p) => p.owed)`. The pass above cannot see
// these BY DESIGN — its shadow blanking deletes exactly these regions so a lambda parameter is not
// mistaken for the response binding. So this is the mirror of that: find the same regions and read
// what the element is asked for.
//
// Two iterable shapes, both real in this client:
//   · `b.listings.map((l) => …)` / `(b.listings || []).map(…)` / `for (const l of b.listings)`
//   · the binding IS the array — `const rows = (…).body.contracts; rows.map((c) => …)`
// Anything whose lambda body cannot be delimited is COUNTED and asserted zero, same rule as above.
const listReads = new Map(), listWhere = new Map();
// list keys whose row renders a clickable control (check 5 — a gate only matters on an ACTION)
const listActs = new Set();
// CHECK 9 needs the row TEMPLATE, not just the set of fields it reads — because the two defects it
// exists for both READ the level and simply do nothing with it, which check 5 is satisfied by. The
// region and the callback's param are already computed here; recording them costs nothing and means
// check 9 reuses this extractor rather than hand-rolling a third one (the shape that gave the mirror
// three separate blind spots).
const listRegion = new Map(), listParam = new Map(), listFn = new Map(), listSrc = new Map();
let listUnresolved = 0;
const bodyAfter = (src, from) => {             // extent of a lambda body starting at `from`
  let k = from;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] === '{' || src[k] === '(') {
    const open = src[k], close = open === '{' ? '}' : ')';
    let d = 0;
    for (let j = k; j < src.length; j++) { if (src[j] === open) d++; else if (src[j] === close && --d === 0) return [k, j + 1]; }
    return null;
  }
  // A lambda whose body is a TEMPLATE LITERAL — which is nearly every renderer in this client —
  // must be scanned to its matching backtick. The generic scanner below stops at the first ';' or
  // ',' at depth 0, and inside a template those are ordinary text: `style="color:var(--bad);
  // font-size:17px"`, `&nbsp;`, a comma in prose. That silently TRUNCATED the body, so every field
  // read past the first semicolon went unchecked while the run still reported a pass — found by a
  // mutation that should have failed and didn't.
  if (src[k] === '`') {
    const st = ['tpl'];
    for (let j = k + 1; j < src.length; j++) {
      const c = src[j], top = st[st.length - 1];
      if (c === '\\') { j++; continue; }                       // escape: skip the next char
      if (top === 'tpl') {
        if (c === '`') { st.pop(); if (!st.length) return [k, j + 1]; }
        else if (c === '$' && src[j + 1] === '{') { st.push('expr'); j++; }
      } else if (c === "'" || c === '"') {                     // a quoted string inside ${ … }
        const q = c; while (++j < src.length && src[j] !== q) if (src[j] === '\\') j++;
      } else if (c === '`') st.push('tpl');
      else if (c === '{') st.push('brace');
      else if (c === '}') st.pop();
    }
    return null;                                               // unterminated — counted, never skipped
  }
  let d = 0;
  for (let j = k; j < src.length; j++) {
    const c = src[j];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { if (d === 0) return [k, j]; d--; }
    else if ((c === ',' || c === ';') && d === 0) return [k, j];
  }
  return [k, src.length];
};
const collectList = (src, v, key, fn) => {
  // `<v>.<field>` (optionally `|| []`) piped into an iterator, or the binding itself
  const V = v.replace('$', '\\$');
  const ITER = new RegExp(
    `(?<![\\w$.])${V}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)(?:\\s*\\|\\|\\s*\\[\\]\\s*\\))?\\s*\\.\\s*`
    + '(?:map|forEach|flatMap|filter|find|some|every|sort|reduce)\\s*\\(\\s*\\(?\\s*([a-zA-Z_$][\\w$]*)\\s*\\)?\\s*=>', 'g');
  const SELF = new RegExp(
    `(?<![\\w$.])${V}\\s*\\.\\s*(?:map|forEach|flatMap|filter|find|some|every|sort)\\s*\\(\\s*\\(?\\s*([a-zA-Z_$][\\w$]*)\\s*\\)?\\s*=>`, 'g');
  const FOROF = new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s+of\\s+\\(?\\s*${V}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)`, 'g');
  // THE CHAINED ITERATOR. `(sov.structures || []).filter((s) => s.mine).map((s) => …)` matches ITER
  // at the FILTER — and the `.map` hangs off the filter's RESULT, not off `sov.structures`, so the
  // regex never reaches it and the whole rendered body goes unread. Measured on that exact line: the
  // extractor collected `mine,incomeOwed,vulnerable,district` (the short predicate bodies) and none
  // of the eight fields the card actually renders, which made check 4b silently thinner AND produced
  // a FALSE POSITIVE in check 6 against a screen that discloses correctly. 14 lists use the shape.
  //
  // So after a body is delimited, follow any iterator chained onto it and collect that body under
  // the SAME key — a loop, so `.filter().filter().map()` resolves too. The param is re-read each
  // hop because each callback binds its own.
  // …and the chain may pass through a NON-CALLBACK transform on the way. `.filter((x) => !x.me)
  // .slice(0, 8).map((x) => …)` is the commonest list idiom in this client, and `.slice` takes no
  // lambda — so the follow stopped dead at it and the `.map` body, which is the entire rendered
  // row, went unread. The list still LOOKED covered because the filter's one-token predicate had
  // been collected. Proven by mutation: a bogus field on a duelist row passed green even after the
  // list was made visible and non-empty. Transforms that return the same element type are skipped
  // over rather than treated as the end of the chain.
  const CHAIN = /^\s*\)(?:\s*\.\s*(?:slice|reverse|flat|concat)\s*\([^)]*\))*\s*\.\s*(?:map|forEach|flatMap|filter|find|some|every|sort|reduce)\s*\(\s*\(?\s*([a-zA-Z_$][\w$]*)\s*\)?\s*=>/;
  const add = (listField, param, at) => {
    const ext = bodyAfter(src, at);
    if (!ext) { listUnresolved++; return; }
    const k = `${key}|${listField}`;
    let region = src.slice(ext[0], ext[1]);
    // …and a VERBATIM copy for check 9. `region` is deliberately lossy past the first hop — a chained
    // body is collapsed to a ` data-x=` marker so check 5 can see "this row acts" without the source
    // confusing the field scan. Check 9 has to READ the comparison, so it needs the text; keeping both
    // is cheaper than making `region` lossless and re-teaching check 5 to ignore the extra.
    let regionFull = region;
    for (let end = ext[1], hops = 0; hops < 6; hops++) {
      const m2 = CHAIN.exec(src.slice(end, end + 200));
      if (!m2) break;
      const next = bodyAfter(src, end + m2[0].length);
      if (!next) { listUnresolved++; break; }
      // the chained callback's param may differ (`(s) => …).map((r) => …`), so normalise by
      // collecting that body against ITS OWN param and appending the matches to this region
      for (const r of src.slice(next[0], next[1])
        .matchAll(new RegExp(`(?<![\\w$.])${m2[1].replace('$', '\\$')}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)`, 'g'))) {
        if (!BUILTIN.has(r[1])) region += `\n${param}.${r[1]}`;   // re-expressed in this hop's param
      }
      region += src.slice(next[0], next[1]).replace(/[^]*/, (t) => (/data-[a-z]+\s*=|onclick\s*=|<option/.test(t) ? ' data-x=' : ''));
      regionFull += '\n' + src.slice(next[0], next[1]);
      end = next[1];
    }
    // check 5 needs to know whether this row RENDERS AN ACTION — a purely informational row has
    // nothing to gate. `data-<x>=` / `data-do=` / an inline onclick are the three ways this client
    // hangs a click on an element. `<option` is the fourth and it is the one that had a live defect:
    // a list mapped into a <select>'s options carries no data- attribute of its own, but the option
    // IS the choice — picking a locked one and pressing the neighbouring button is exactly the
    // "looks live, refuses on press" the tester reported.
    if (/data-[a-z]+\s*=|onclick\s*=|<option/.test(region)) listActs.add(k);
    // ACCUMULATE, never overwrite. A binding can be mapped in several places in one renderer (the
    // port's `routes` is mapped twice: once into the lane <select>, once into a notoriety line), and
    // `listReads` already UNIONs their fields under one key. Setting the region would keep only the
    // last map — which for the port is the notoriety line, so the lane picker's `canRun(r)` gate
    // vanished and check 9 reported a correctly-gated picker as a defect. The guard's granularity is
    // the key, so the region has to be the key's whole source too.
    listRegion.set(k, (listRegion.get(k) || '') + '\n' + regionFull);
    // the PARAM accumulates for the same reason the region does, and it bit twice: `hb.jobs` is mapped
    // into the picker as `jb` AND `.find()`-ed inside the open card as `jj`, so last-wins left check 9
    // hunting for `jj.lvl` in a region whose gate is written `jb.lvl` — reporting a freshly-fixed
    // picker as still broken. One key, every binding that iterates it.
    if (!listParam.has(k)) listParam.set(k, new Set());
    listParam.get(k).add(param);
    listFn.set(k, fn); listSrc.set(k, src);
    for (const r of region
      .matchAll(new RegExp(`(?<![\\w$.])${param.replace('$', '\\$')}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)`, 'g'))) {
      if (BUILTIN.has(r[1])) continue;
      if (!listReads.has(k)) { listReads.set(k, new Set()); listWhere.set(k, fn); }
      listReads.get(k).add(r[1]);
    }
  };
  let m;
  while ((m = ITER.exec(src))) add(m[1], m[2], m.index + m[0].length);
  while ((m = SELF.exec(src))) add('', m[1], m.index + m[0].length);
  while ((m = FOROF.exec(src))) {
    const close = src.indexOf(')', FOROF.lastIndex);
    if (close < 0) { listUnresolved++; continue; }
    add(m[2], m[1], close + 1);
  }
};

// The keyword is CAPTURED (group 1) because its absence changes where the binding's scope is. A
// renderer that wants the card to survive a failed fetch writes the board as a declare-then-assign:
//   let book = { contacts: [] };
//   try { book = (await api('GET','/v1/contacts')).body || book; } catch { /* still renders */ }
// The assignment sits inside the TRY block, so the innermost block containing it ends before the
// markup that reads the board — and taking that block as the scope finds zero reads while looking
// exactly like a pass. (Third member of this family, after the raw-bind and promise-callback holes:
// a bare `x =` is scoped to x's DECLARATION, which is the variable's real scope.)
// FIFTH member of the family, found by playing: a renderer that narrows the board as it binds wraps
// the whole unwrap in one more paren —
//   const streets = ((await api('GET','/v1/streets')).body?.streets || []).filter((s) => s.id !== me.id);
// — and the leading `(` meant the binding was not recognised AT ALL, so `streets` bound to no route
// and every field the row rendered went unchecked. That hid the four busiest rosters in the game
// (Wet Work, the Blood War, the Family and the Deeds board all narrow this way) plus two more, and
// it is the same shape as the 2026-08-08 `.filter(...).map(...)` fix one position earlier: there the
// chain sat on a bound list, here it sits on the binding itself. `\(*` with backtracking takes the
// extra parens and leaves the one that belongs to `(await`.
const GETBIND = /(?:(const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*=\s*\(*\(await api\(\s*'GET'\s*,\s*([`'"])([^`'"]+)\3\s*\)\)\s*\.body(\s*\?\.\s*([a-zA-Z_$][\w$]*))?/g;
const reads = new Map(), readWhere = new Map();
let unscoped = 0, shadowUnresolved = 0;
for (const m of html.matchAll(/\b(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) {
  const open = html.indexOf('{', m.index + m[0].length);
  if (open < 0) continue;
  let d = 0, body = null;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) { body = html.slice(open, j + 1); break; }
  }
  if (!body) continue;
  const blks = blocksOf(body);
  // A renderer that fetches many boards at once writes them as a Promise.all, which GETBIND cannot
  // read — the boards would then fall out of coverage SILENTLY (a green run over unchecked screens,
  // the exact failure this file exists to prevent). Resolve the idiom to the same (name → path) map
  // GETBIND produces, and count anything in it that can't be resolved rather than dropping it.
  //   const [aR, bR] = await Promise.all([ api('GET','/x'), api('GET','/y') ]);
  //   const a = aR.body || {}, b = bR.body || {};
  const viaAll = [];   // [bindingName, path, indexAfterTheAlias]
  for (const pa of body.matchAll(/(?:const|let|var)\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\s*\[([\s\S]*?)\]\s*\)\s*;/g)) {
    const names = pa[1].split(',').map((x) => x.trim()).filter(Boolean);
    const calls = [...pa[2].matchAll(/api\(\s*'GET'\s*,\s*([`'"])([^`'"]+)\1/g)].map((c) => c[2]);
    if (names.length !== calls.length) { unscoped += names.length; continue; }  // never silently skip
    const after = pa.index + pa[0].length;
    for (let i = 0; i < names.length; i++) {
      // find the alias that unwraps .body — `const a = aR.body || {}` — and bind THAT name
      const al = new RegExp(`(?:const|let|var|,)\\s*([a-zA-Z_$][\\w$]*)\\s*=\\s*${names[i].replace('$', '\\$')}\\s*\\.body`).exec(body.slice(after, after + 900));
      if (!al) { unscoped++; continue; }
      viaAll.push([al[1], calls[i], after + al.index + al[0].length]);
    }
  }
  // THE RAW-BIND IDIOM — `const r = await api('GET', '/p'); … const b = r.body || {};` — is how
  // 14 renderers hold their board (they need r.code for the error card before unwrapping). GETBIND
  // cannot see it, so those screens' displayed fields fell out of coverage SILENTLY — proven when a
  // brand-new board's planted mutations survived a green run. Resolve it to the same bindings:
  //   · the path may be a literal, a `'lit/' + id` concat (→ the parent route with :p), or a
  //     ternary of two literals (the chat room picker — the reads then bind to BOTH boards)
  //   · the `.body` unwrap alias — plain, `|| {}`, or the `r.code < 400 ? r.body : {}` guard —
  //     optionally one sub-object deep (`const notes = r.body?.notifications || []`)
  //   · direct `r.body?.field` reads. `error`/`message` are excluded BY NAME: they are the error
  //     ENVELOPE (present only on a non-2xx), so demanding them of the happy-path board would be a
  //     standing false positive on every renderer's error guard.
  // HONESTY: every `.body` touch in the bind's region must be consumed by one of those shapes or
  // be a bare pass-through (`describe(r.body)`, `!r.body`) — anything else is COUNTED, not skipped.
  const viaRaw = [];
  // ONE resolver for both idioms (RAWBIND below + THENBIND after it) — a copied block here would
  // drift exactly the way the sackEmpire rake-cursor copy drifted; the shapes must stay identical.
  const resolveBodyRegion = (V, paths, rStart, rEnd) => {
    const region = body.slice(rStart, rEnd);
    const spans = [];   // [start, end) offsets within region already consumed by a recognised shape
    // 1) the unwrap alias (optionally guarded / defaulted / one sub deep)
    const aliasRe = new RegExp(
      `(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*(?:${V}\\s*\\.\\s*code\\b[^?\\n]*\\?\\s*)?`
      + `${V}\\s*\\.\\s*body(\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*))?`
      + `(?:\\s*\\|\\|\\s*(?:\\{\\}|\\[\\]|null))?(?:\\s*:\\s*(?:\\{\\}|\\[\\]|null))?\\s*[;,\\n)]`, 'g');
    for (const am of region.matchAll(aliasRe)) {
      if (am[3] && BUILTIN.has(am[3])) continue;
      // index = match START, not end: the alias terminator can be the `,` of a same-statement
      // follow-on alias (`const S = r.body, o = S.owned;`), and the sub-alias scan needs to SEE
      // that comma — anchoring past it made the `o` binding invisible and its reads vanished
      // silently (caught by mutation: a planted bogus field on the Store's `owned` survived).
      for (const p of paths) viaRaw.push({ v: am[1], path: p, sub: am[3] || '', index: rStart + am.index });
      spans.push([am.index, am.index + am[0].length]);
    }
    // 2) direct field reads off r.body (minus the error envelope)
    for (const dm of region.matchAll(new RegExp(`(?<![\\w$.])${V}\\s*\\.\\s*body\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)`, 'g'))) {
      spans.push([dm.index, dm.index + dm[0].length]);
      if (BUILTIN.has(dm[1]) || dm[1] === 'error' || dm[1] === 'message') continue;
      for (const p of paths) {
        const key = `${p}|`;
        if (!reads.has(key)) { reads.set(key, new Set()); readWhere.set(key, m[1]); }
        reads.get(key).add(dm[1]);
      }
    }
    // 3) the honesty scan: any `.body` touch not inside a consumed span must be a bare pass-through
    for (const bt of region.matchAll(new RegExp(`(?<![\\w$.])${V}\\s*\\.\\s*body\\b`, 'g'))) {
      if (spans.some(([s, e]) => bt.index >= s && bt.index < e)) continue;
      const tail = region.slice(bt.index + bt[0].length).match(/^\s*(\S{0,2})/)?.[1] ?? '';
      if (/^(\)|,|;|\|\||&&|\?\s|$)/.test(tail) || tail === '' || tail === '?)' ) continue;  // pass-through / truthiness (`r.body && …` reads no field)
      unscoped++;
    }
  };
  const RAWBIND = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*await\s+api\(\s*'GET'\s*,\s*([^)]*?)\)\s*;/g;
  for (const rb of body.matchAll(RAWBIND)) {
    const rv = rb[1], V = rv.replace('$', '\\$');
    const lits = [...rb[2].matchAll(/([`'"])((?:\\.|(?!\1).)*?)\1/g)].map((x) => x[2]).filter((s) => s.startsWith('/v1'));
    if (!lits.length) { unscoped++; continue; }   // a path built some way we cannot read
    const paths = lits.map((p) => {
      let out = p.replace(/\$\{[^}]*\}/g, ':p');
      if (/\+\s*[a-zA-Z_$(]/.test(rb[2]) && out.endsWith('/')) out += ':p';   // '/v1/x/' + id
      return out;
    });
    // the bind's region: to the next redeclaration of the same name, or the end of the renderer
    const redecl = new RegExp(`(?:const|let|var)\\s+${V}\\s*=`, 'g');
    redecl.lastIndex = rb.index + rb[0].length;
    const nxt = redecl.exec(body);
    resolveBodyRegion(V, paths, rb.index + rb[0].length, nxt ? nxt.index : body.length);
  }
  // ── THE PROMISE-CALLBACK IDIOM (task #311) — `api('GET','/p').then((r) => { … r.body … })`.
  // The mirror could not see this shape AT ALL: a planted bogus field inside a .then callback
  // SURVIVED a green run (the regimen slot loader, rebuilt onto the covered idiom; the clue-slot
  // and three leaderboard loaders shipped on it with every displayed field unchecked). Resolved
  // with the SAME shapes as RAWBIND over the callback's balanced-brace body — via blocksOf's
  // string-aware brace index, because these callbacks are made of multi-line template HTML where
  // a naive "to the next }" truncates at the first interpolation (the bodyAfter lesson). A .then
  // whose callback is NOT the `(r) => { … }` form is COUNTED (unscoped), never silently skipped.
  const THENBIND = /api\(\s*'GET'\s*,\s*([^)]*?)\)\s*\.then\(\s*(?:async\s*)?\(\s*([a-zA-Z_$][\w$]*)\s*\)\s*=>\s*/g;
  for (const tb of body.matchAll(THENBIND)) {
    const lits = [...tb[1].matchAll(/([`'"])((?:\\.|(?!\1).)*?)\1/g)].map((x) => x[2]).filter((s) => s.startsWith('/v1'));
    if (!lits.length) { unscoped++; continue; }
    const paths = lits.map((p) => p.replace(/\$\{[^}]*\}/g, ':p'));
    const at = tb.index + tb[0].length;
    if (body[at] !== '{') { unscoped++; continue; }   // a bare-expression callback — counted, not resolved
    const blk = blks.find(([s]) => s === at);
    if (!blk) { unscoped++; continue; }
    resolveBodyRegion(tb[2].replace('$', '\\$'), paths, at + 1, blk[1]);
  }
  const binds = [...body.matchAll(GETBIND)].map((b) => ({ v: b[2], path: b[4], sub: b[6] || '', index: b.index, bare: !b[1] }))
    .concat(viaAll.map(([v, path, idx]) => ({ v, path, sub: '', index: idx })))
    .concat(viaRaw);
  for (const b of binds) {
    const v = b.v, path = b.path.replace(/\$\{[^}]*\}/g, ':p');
    // A bare `x = (await api(...)).body` re-assigns a variable declared elsewhere, so the block
    // holding the ASSIGNMENT (typically a try) is not the block the reads live in — scope it to the
    // DECLARATION instead. No declaration found means the shape is one this cannot resolve, and an
    // unresolvable binding is COUNTED, never quietly given the wrong block.
    let at = b.index, moduleScoped = false;
    if (b.bare) {
      const dre = new RegExp(`(?:const|let|var)\\s+${v.replace('$', '\\$')}\\b`, 'g');
      let d = null, mm; while ((mm = dre.exec(body)) && mm.index < b.index) d = mm.index;
      // no declaration in this function ⇒ a module-scope global (`session`, `rules`). Its reads span
      // the whole app, which a per-function scan cannot model — so cover the ones IN THIS FUNCTION
      // (real reads, correctly attributed) rather than dropping the binding.
      if (d === null) moduleScoped = true; else at = d;
    }
    let scope = moduleScoped ? [0, body.length] : null;
    if (!scope) for (const [s, e] of blks) if (s < at && at < e && (!scope || (e - s) < (scope[1] - scope[0]))) scope = [s, e];
    if (!scope) { unscoped++; continue; }
    const { src, unresolved } = blankShadows(body.slice(b.index, scope[1]), v);
    shadowUnresolved += unresolved;
    const re2 = new RegExp(`(?:const|let|var)\\s+${v.replace('$', '\\$')}\\s*=`, 'g'); re2.lastIndex = 1;
    const nxt = re2.exec(src);
    const key = `${path}|${b.sub}`;
    // the list pass reads the UNBLANKED region — the lambdas blanking removes are exactly its subject
    const region = body.slice(b.index, scope[1]);
    collectList(region, v, key, m[1]);
    // A screen that splits one board into two lists writes `const onMe = board.filter(...)` and maps
    // each separately. The derived array holds the SAME elements, so it inherits the source's key —
    // without this those reads simply vanish from the count, which is a silent coverage hole, not a
    // pass. (Writing `board.filter(f).map(g)` instead does NOT help: collectList reads the FIRST
    // iterator's lambda, which is the predicate, not the renderer.)
    for (const d of region.matchAll(new RegExp(
      `(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*${v.replace('$', '\\$')}\\s*(?:\\??\\.\\s*([a-zA-Z_$][\\w$]*)\\s*(?:\\|\\|\\s*\\[\\]\\s*)?)?\\.\\s*(?:filter|slice|sort|concat)\\s*\\(`, 'g'))) {
      collectList(region, d[1], d[2] ? `${key}|${d[2]}`.replace(/\|\|/, '|') : key, m[1]);
    }
    // A BARE RE-BIND OF THE BOARD ITSELF — `${(() => { const d = duels; if (!d) return ''; …})()}`,
    // which is how a screen guards a whole section behind one null check. `d` IS the board, but the
    // two loops above only follow a re-bind that derives an ARRAY (`.filter`) or a SUB-OBJECT
    // (`.property`), so a plain one matched neither and every list hanging off it vanished — not
    // checked, and not counted as an empty list either, so it did not even reach the honesty rule
    // that says an empty list must never read as a pass. Found by mutation: a bogus field planted on
    // a duelist row passed green. The alias inherits the SAME key, because it is the same board.
    for (const re of region.matchAll(new RegExp(
      `(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*${v.replace('$', '\\$')}\\s*(?:\\|\\|\\s*\\{\\}\\s*)?(?=[;,\\n])`, 'g'))) {
      collectList(region, re[1], key, m[1]);
    }
    // ONE level of object alias — `const S = r.body, o = S.owned;` / `const id = b.identity;` —
    // the alias holds a sub-object of the board, so its reads are that sub-object's fields. Only
    // followed off a sub-less binding (the key format carries one sub level; deeper chains remain
    // the mirror's stated out-of-scope, same as nested reads everywhere). An alias that never has
    // properties read off it creates no key, so `const n = b.count` is harmless.
    // The terminator is a LOOKAHEAD, not a consumed character, and that is load-bearing: a
    // comma-chained declaration — `const fleet = b.fleet || [], routes = b.routes || [], cat = …` —
    // separates each binding from the next with ONE comma, which is simultaneously the terminator of
    // the binding before it and the lead of the binding after. Consume it and matchAll cannot start
    // the next match there, so EVERY OTHER binding in the chain silently disappears. Found by check 5:
    // the Port declares its three lists on one line and `routes` was the one in the middle, so its
    // element reads had never been checked by 4b either.
    if (!b.sub) {
      for (const al of region.matchAll(new RegExp(
        `(?:const|let|var|,)\\s*([a-zA-Z_$][\\w$]*)\\s*=\\s*${v.replace('$', '\\$')}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)\\s*(?:\\|\\|\\s*(?:\\{\\}|\\[\\]))?\\s*(?=[;,\\n])`, 'g'))) {
        if (BUILTIN.has(al[2])) continue;
        binds.push({ v: al[1], path: b.path, sub: al[2], index: b.index + al.index + al[0].length });
      }
    }
    for (const r of (nxt ? src.slice(0, nxt.index) : src)
      .matchAll(new RegExp(`(?<![\\w$.])${v.replace('$', '\\$')}\\s*\\??\\.\\s*([a-zA-Z_$][\\w$]*)`, 'g'))) {
      if (BUILTIN.has(r[1])) continue;
      if (!reads.has(key)) { reads.set(key, new Set()); readWhere.set(key, m[1]); }
      reads.get(key).add(r[1]);
    }
  }
}
assert.equal(unscoped, 0, `${unscoped} response binding(s) could not be scoped to a block, so their reads go unchecked`);
assert.equal(shadowUnresolved, 0, `${shadowUnresolved} shadow region(s) could not be resolved, so reads may be misattributed`);
assert(reads.size > 40, `only ${reads.size} (route, binding) pairs found — the read extraction broke`);


const inject = async (method, url, token, payload) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
  try { return { code: res.statusCode, body: res.json() }; } catch { return { code: res.statusCode, body: null }; }
};
const token = (await inject('POST', '/v1/auth/guest')).body.token;
await inject('POST', '/v1/character', token, { name: 'Mirror ' + Math.random().toString(36).slice(2, 8) });
const meRes = await inject('GET', '/v1/me', token);
const charId = meRes.body.character.id;
// A fresh street cannot found a family or sit at a ring table — both are level-gated, and the
// fixture exists to REACH boards, not to earn its way there. Seeded directly; check 4 asserts no
// ledger identity, so this cannot mask an economy defect the way seeding in the sim would.
await app.pool.query('UPDATE characters SET cash=50000000, respect=500000, loc=$2 WHERE id=$1', [charId, 'neon']);
// Routes whose path carries an id cannot be fetched without one. Each is listed with how to get a
// real one, and the list must COVER them — an unlisted param route fails the run rather than being
// counted as unverifiable, the same rule check 1b applies to runtime-built paths.
const PARAM_FIXTURES = new Map([
  ['/v1/gangs/:p', async () => (await inject('POST', '/v1/gangs', token,
    { name: 'Mirror Family ' + Math.random().toString(36).slice(2, 6), tag: 'MR' + Math.floor(Math.random() * 90 + 10) })).body?.gangId],
  ['/v1/feud/:p', async () => charId],
  // THE DEED VAULT CONFIRM READ is keyed on the SELLER's character (exactly like the buy it precedes),
  // so the fixture is a second player holding a LISTED street — with a real delivery on it, or the
  // vault half of the response would be null and its fields would go unchecked (the empty-list rule).
  ['/v1/deeds/vault/:p', async () => {
    const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: 'Mirror Steward ' + Math.random().toString(36).slice(2, 6) });
    const cid = (await inject('GET', '/v1/me', t)).body.character.id;
    const acc = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [cid])).rows[0].account_id;
    const street = 'Mirror Row ' + Math.random().toString(36).slice(2, 6);
    await app.pool.query(
      'INSERT INTO street_deeds (account_id, name, name_lc, district, sale_price) VALUES ($1,$2,$3,$4,$5)',
      [acc, street, street.toLowerCase(), 'docks', 50000]);
    const { deedTokenId } = await import('../src/chain.js');
    await app.pool.query(
      `INSERT INTO stock_deliveries (delivery_id, epoch_id, account_id, ticker, units, deed_token_id, tba, tx_hash, status)
         VALUES ($1,'mirror-ep',$2,'TSLA',2,$3,'0xMIRRORVAULT','0xmirrortx','delivered')`,
      ['mirror-' + street, acc, deedTokenId(street)]);
    return cid;
  }],
  // The den's gates are covered in test/casino.js; here they are only a PRECONDITION, so they are
  // GUARANTEED rather than left likely — CI caught this failing once (`produced no id`) against ten
  // clean local runs, which is the recorded flake shape: a deterministic assertion resting on a
  // probabilistic precondition (the seed above ends with a boost loop that leaves the fixture JAILED
  // if every attempt busts, and a long seed can leave it short of the buy-in). The refusal is also
  // PRINTED now, so a future failure names the server's reason instead of leaving it to be guessed.
  ['/v1/casino/ring/:p', async () => {
    await app.pool.query("UPDATE characters SET jail_until=NULL, hosp_until=NULL, loc='neon', cash=GREATEST(cash, 1000000) WHERE id=$1", [charId]);
    const r = await inject('POST', '/v1/casino/ring/open', token, { bb: 100, buyin: 20000 });
    if (!r.body?.tableId) console.log(`  the ring fixture was refused: ${r.code} ${JSON.stringify(r.body)}`);
    return r.body?.tableId;
  }],
  // a DM thread needs a counterpart WITH a message on the line — make both here (memoized).
  // STREET LIFE: numbers are earned, so the fixture seeds the contacts row (a meeting) first —
  // the no_number gate itself is covered in test/hardening.js.
  ['/v1/phone/thread/:p', async () => {
    const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: 'Mirror Caller ' + Math.random().toString(36).slice(2, 6) });
    const cid = (await inject('GET', '/v1/me', t)).body.character.id;
    // VALUES with prefetched accounts — a two-table INSERT…SELECT writes the WRONG pair under
    // pg-mem (the wire-test lesson from #317)
    const [aA, aB] = await Promise.all([charId, cid].map(async (id) =>
      (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id));
    await app.pool.query("INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met') ON CONFLICT DO NOTHING", [aA, aB]);
    await inject('POST', '/v1/phone/dm/' + cid, token, { text: 'you there?' });
    await inject('POST', '/v1/phone/dm/' + charId, t, { text: 'always.' });
    return cid;
  }],
  // THE STORY needs a counterpart WITH history — a strike and a kill seed the events list, so the
  // dossier's element fields are compared against rows rather than passing on emptiness
  ['/v1/people/history/:p', async () => {
    const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: 'Mirror Nemesis ' + Math.random().toString(36).slice(2, 6) });
    const cid = (await inject('GET', '/v1/me', t)).body.character.id;
    const [aA, aB] = await Promise.all([charId, cid].map(async (id) =>
      (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id));
    await app.pool.query("INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,'jump','{}')",
      [crypto.randomUUID(), aA, aB]);
    await app.pool.query("INSERT INTO kill_log (id, killer_account, victim_account, victim_name) VALUES ($1,$2,$3,'Mirror Fallen')",
      [crypto.randomUUID(), aB, aA]);
    return cid;
  }],
]);
// Check 4b needs every list to HAVE a row, or its fields are never compared. This is the price of
// that check being honest — each entry exists because a list came back empty and the run said so.
// Check 4b needs every list to HAVE a row or its element fields are never compared, and an empty
// list must never read as a pass. So this makes one of everything. It is long because the game is
// large; each line exists because a specific list came back empty and the run said which.
//
// Two kinds of seeding, both legitimate here:
//   · API calls, which is most of it — found a family, buy a front, recruit a fighter.
//   · direct SQL for the account-level LEGEND columns the leaderboards rank by. Those are status
//     counters, not currency, and 4b asserts no ledger identity, so this cannot mask an economy
//     defect the way seeding in the sim would.
const seedNotes = [];
// mod routes take the key header, not a bearer token
const modInject = async (method, url, payload) => {
  const res = await app.inject({ method, url, headers: { 'x-mod-key': process.env.MOD_KEY }, payload });
  let out; try { out = { code: res.statusCode, body: res.json() }; } catch { out = { code: res.statusCode, body: null }; }
  // a mod seed that 4xx's must name itself too — a silent one cost a debugging round
  if (out.code >= 400) seedNotes.push(`${seedTag}: ${method} ${url} → ${out.code} ${out.body?.error || ''}`);
  return out;
};
const trySeed = async (what, fn) => { seedTag = what; try { await fn(); } catch (e) { seedNotes.push(`${what}: threw ${e.message}`); } };
// A seed step that 4xx's does not throw — it just quietly seeds nothing, and the list stays empty
// with no clue why. Every seed call goes through this so a refused step names itself.
let seedTag = '';
const si = async (method, url, token, payload) => {
  const r = await inject(method, url, token, payload);
  if (r.code >= 400) seedNotes.push(`${seedTag}: ${method} ${url} → ${r.code} ${r.body?.error || ''}`);
  return r;
};
async function seedLists() {
  const q = (sql, args) => app.pool.query(sql, args);
  const acct = (await q('SELECT account_id FROM characters WHERE id=$1', [charId])).rows[0].account_id;

  // a second street, so two-party boards (offers made TO you, contracts on someone else) have rows
  const t2 = (await si('POST', '/v1/auth/guest')).body.token;
  await si('POST', '/v1/character', t2, { name: 'Mirror Two ' + Math.random().toString(36).slice(2, 6) });
  const two = (await si('GET', '/v1/me', t2)).body.character.id;
  const acct2 = (await q('SELECT account_id FROM characters WHERE id=$1', [two])).rows[0].account_id;
  await q('UPDATE characters SET cash=50000000, respect=500000, loc=$2 WHERE id=$1', [two, 'neon']);
  // THE VOUCH — a MUTUAL vouch between the two streets, so /v1/vouches (given/mutuals/vouchers) and the
  // vouches leaderboard all come back non-empty (an empty list is never a pass — the mirror rule).
  await q(`INSERT INTO vouches (voucher_account, target_account, from_name) VALUES ($1,$2,'Me'),($2,$1,'Mirror Two') ON CONFLICT DO NOTHING`, [acct, acct2]);

  // an NPC family for THE BLOOD WAR board (npc_flag + a war_pool to raid) — a third street founds it so
  // `two` stays gangless for the two-party board seeds below
  const t3 = (await si('POST', '/v1/auth/guest')).body.token;
  await si('POST', '/v1/character', t3, { name: 'Mirror Mob ' + Math.random().toString(36).slice(2, 6) });
  const three = (await si('GET', '/v1/me', t3)).body.character.id;
  await q('UPDATE characters SET cash=100000, respect=500000 WHERE id=$1', [three]);
  const fg = await si('POST', '/v1/gangs', t3, { name: 'The Mirror Mob ' + Math.random().toString(36).slice(2, 5), tag: 'MOB' });
  if (fg.body?.ok !== false) {
    const mgid = (await q('SELECT gang_id FROM gang_members WHERE character_id=$1', [three])).rows[0]?.gang_id;
    if (mgid) await q('UPDATE gangs SET npc_flag=true, war_pool=120000, war_pool_at=now() WHERE id=$1', [mgid]);
    // THE TICKER BALLOT — a family pick for TODAY, so /v1/city's tickerBallot.votes list has a row
    // (the family/ticker element reads); the board's LEFT JOIN resolves the family name
    if (mgid) await q('INSERT INTO commission_ticker_votes (day, gang_id, ticker, standing) VALUES ($1,$2,$3,600)',
      [Math.floor(Date.now() / 86400000), mgid, 'TSLA']);
  }
  {
    // THE DAILY OFFERING — a window for today, so /v1/bonds.daily is non-null (the empty-object
    // rule: a null board never proves its reads)
    await q('INSERT INTO bond_offerings (day, offered_omr, quoted_omr) VALUES ($1, 100000, 250)',
      [Math.floor(Date.now() / 86400000)]);
  }

  // the LEGEND columns every "biggest ever" board ranks by — status counters, never currency
  await q(`UPDATE account_persistent SET product_moved=5000000, tycoon_earned=4000000, monument_built=900000,
             freight_delivered=800000, freight_hijacked=700000, prestige_sunk=600, season_sunk=300,
             honor_peak=70, honor_low=-70, statecraft=40, racer_wins=3, boxing_wins=3, smuggled=900000,
             heists_pulled=4, caskets=3, duel_wins=3, intel_ops=12, cartel_damage=500000, soldiers_led=4,
             race_wins=5
           WHERE account_id IN ($1,$2)`, [acct, acct2]);
  await q(`UPDATE characters SET honor=70 WHERE id=$1`, [charId]);
  // A LISTED DUELIST, so /v1/duels.duelists has a row. That list was invisible to 4b until the
  // bare-rebind alias was followed (the screen guards the whole section behind `const d = duels`),
  // so it never even reached the empty-list rule — it was neither checked nor counted. Through the
  // real route rather than SQL, so the stake floor and the consent listing are the game's own.
  await si('POST', '/v1/duels/list', t2, { limit: 25000 });
  // THE TRADES legend board ranks lifetime mastery XP per account
  await q(`INSERT INTO mastery_legend (account_id, track_id, xp) VALUES ($1, 'larceny', 5000)`, [acct]);
  // STREET DEEDS — the primary character HOLDS a claimed deed + a legend row, so /v1/deeds returns the
  // "you hold a deed" branch with a non-empty history, and the great-streets leaderboard has a row (an
  // empty list is never a pass — the mirror rule; a null `deed` would leave its fields unverifiable).
  await q(`INSERT INTO street_deeds (account_id, name, name_lc, district) VALUES ($1,'Corvino Way','corvino way','neon') ON CONFLICT DO NOTHING`, [acct]);
  await q(`INSERT INTO street_deed_history (account_id, kind, detail) VALUES ($1,'claim','claimed by you'),($1,'fell','a bloodline fell here')`, [acct]);
  // THE SHIPMENT — a commissioned piece, so /v1/shipment's `mine` has a row (an empty list is not a
  // pass; the piece is account-keyed, so seeding it here is exactly what a real commission writes).
  await q(`INSERT INTO bespoke_pieces (account_id, commission_id, serial, holder_name) VALUES ($1,'case',1,'You') ON CONFLICT DO NOTHING`, [acct]);

  // ── THE CAST (/v1/people): a nemesis (recorded malice + a kill), a worked-for bond, and a
  // guarded principal, so the Situation card's lists and the nemesis fields all have rows
  await q("INSERT INTO rival_events (id, victim_account, aggressor_account, kind, detail) VALUES ($1,$2,$3,'jump','{}')",
    [crypto.randomUUID(), acct, acct2]);
  await q("INSERT INTO kill_log (id, killer_account, victim_account, victim_name) VALUES ($1,$2,$3,'Mirror Fallen')",
    [crypto.randomUUID(), acct2, acct]);
  await q("INSERT INTO contacts (owner_account, contact_account, how, jobs) VALUES ($1,$2,'met',2) ON CONFLICT (owner_account, contact_account) DO UPDATE SET jobs=2",
    [acct, acct2]);
  await q("UPDATE characters SET guarded_by=$1, guarded_until = now() + interval '2 hours' WHERE id=$2", [charId, two]);

  // ── THE CREW (/v1/crew): the probe LEADS a crew (so crew.members[] is observable) with a
  // snapshot-only second member (NOT acct2 — the contracts fixture puts a bounty on acct2, which the
  // step-two non-aggression would block), holds a pending invite (invites[]), and has a CREW HIT
  // called on acct2 (a rival — crew.target). Account-keyed rows, seeded directly.
  {
    const acct3 = (await q('SELECT account_id FROM characters WHERE id=$1', [three])).rows[0].account_id;
    const c1 = crypto.randomUUID(), c2 = crypto.randomUUID(), ghost = crypto.randomUUID();
    await q("INSERT INTO crews (id, name, leader_account) VALUES ($1,'The Mirror Crew',$2),($3,'The Rival Crew',$4) ON CONFLICT DO NOTHING",
      [c1, acct, c2, acct3]);
    await q(`INSERT INTO crew_members (crew_id, account_id, name) VALUES
             ($1,$2,'Mirror One'),($1,$3,'Mirror Ghost'),($4,$5,'Mirror Mob') ON CONFLICT DO NOTHING`,
      [c1, acct, ghost, c2, acct3]);
    await q("INSERT INTO crew_invites (crew_id, account_id, from_name) VALUES ($1,$2,'Mirror Mob') ON CONFLICT DO NOTHING",
      [c2, acct]);
    // THE CREW HIT — a shared target on acct2 (a rival, not a crewmate), so crew.target is observable
    const twoName = (await q('SELECT name FROM characters WHERE id=$1', [two])).rows[0].name;
    await q("INSERT INTO crew_targets (crew_id, target_account, target_name, kind, set_by) VALUES ($1,$2,$3,'kill',$4) ON CONFLICT DO NOTHING",
      [c1, acct2, twoName, acct]);
    // a line in the crew room, and backdate the join so the read floor (messages after you joined) lets it through
    await q("UPDATE crew_members SET joined_at = now() - interval '1 hour' WHERE crew_id=$1", [c1]);
    await q("INSERT INTO chat_messages (id, channel, character_id, name, body) VALUES ($1,$2,$3,'Mirror One','meet at the docks')",
      [crypto.randomUUID(), 'crew:' + c1, charId]);
    // THE ROLODEX step two — the Rival Crew is RECRUITING (so it shows on the probe's discovery `crews`
    // list — near-level, not full, not the probe's own crew), and a join REQUEST sits on the probe's own
    // crew (so the crewBoard `requests` list is observable by the mirror).
    await q("UPDATE crews SET recruiting=true WHERE id=$1", [c2]);
    await q("INSERT INTO crew_requests (crew_id, account_id, from_name) VALUES ($1,$2,'Mirror Two') ON CONFLICT DO NOTHING", [c1, acct2]);
  }

  // ── THE SEASON RECAP (/v1/season/recap): a closed-season keepsake so recaps[] element fields render
  await q("INSERT INTO season_recaps (account_id, season, level, kills, prestige_gained, title) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
    [acct, 0, 22, 3, 11, 'A Made Man']);

  // ── TONIGHT IN THE CITY (/v1/events): an open tournament (a clocked event) + a building megaproject
  // (the only source of `pct`), so both event shapes are observable by the mirror.
  await q("INSERT INTO poker_tournaments (id, status, opened_at, resolves_at, pool) VALUES ('mirror-tourney','open',now(),now()+interval '1 hour',75000) ON CONFLICT DO NOTHING");
  // a COMPLETED monument (seq 0) + a plaque row → renderCity's `skyline` list has an element to check;
  // and a separate BUILDING monument (seq 1, target high enough the later $25M contribution won't
  // complete it) → /v1/events keeps returning the pct-bearing megaproject element.
  await q("INSERT INTO megaprojects (id, monument, seq, target, progress, status, completed_at) VALUES ('mirror-mp-done','cathedral',0,25000000,25000000,'complete',now()) ON CONFLICT DO NOTHING");
  await q("INSERT INTO megaproject_contributions (project_id, account_id, contributed) VALUES ('mirror-mp-done',$1,25000000) ON CONFLICT DO NOTHING", [acct]);
  await q("INSERT INTO megaprojects (id, monument, seq, target, progress, status) VALUES ('mirror-mp','citadel',1,100000000,300000,'building') ON CONFLICT DO NOTHING");
  // ── THE MENTOR (/v1/mentor): the probe HAS a mentor (mm.mentor), IS a mentor (proteges[]), and has an
  // incoming offer (offers[]) — so every mentor list element field is observable (acct2 fills all three)
  await q("INSERT INTO mentorships (protege_account, mentor_account) VALUES ($1,$2) ON CONFLICT DO NOTHING", [acct, acct2]);
  await q("INSERT INTO mentorships (protege_account, mentor_account) VALUES ($1,$2) ON CONFLICT DO NOTHING", [acct2, acct]);
  await q("INSERT INTO mentor_offers (mentor_account, protege_account, from_name) VALUES ($1,$2,'Mirror Two') ON CONFLICT DO NOTHING", [acct2, acct]);

  // ── the family, and everything that hangs off holding turf ──
  const gid = await paramId('/v1/gangs/:p');
  await trySeed('territory', async () => {
    await q("UPDATE districts SET holder_gang=$1, npc_holder=NULL WHERE id='neon'", [gid]);
    await q('UPDATE gangs SET treasury=90000000, omr_reserve=5000 WHERE id=$1', [gid]);
    await si('POST', '/v1/territory/neon/establish', token, { kind: 'numbers' });
    await si('POST', '/v1/sov/neon/build', token, { windowHour: new Date().getUTCHours() });
    // THE EMPIRE board ranks on lifetime territory income; establishing alone banks none
    await q('UPDATE gangs SET territory_earned=7500000 WHERE id=$1', [gid]);
    // THE FRONTIER board ranks families holding NPC outposts (normally won by routing one)
    await q("UPDATE world_npcs SET held_by_gang=$1 WHERE npc_id='dockrats'", [gid]);
    await q("INSERT INTO world_npcs (npc_id, strength, held_by_gang) VALUES ('dockrats',0,$1) ON CONFLICT (npc_id) DO UPDATE SET held_by_gang=$1", [gid]);
  });
  await trySeed('commission', async () => {
    await q('UPDATE gangs SET lifetime_tribute=9000000, season_tribute=9000000, wars_won=5, season_wars=5 WHERE id=$1', [gid]);
    await si('POST', '/v1/commission/propose', token, { decree: 'open_season' });
    await si('POST', '/v1/commission/vote', token, { decree: 'open_season' });
  });
  await trySeed('diplomacy', async () => {
    const g2 = (await si('POST', '/v1/gangs', t2,
      { name: 'Mirror Rival ' + Math.random().toString(36).slice(2, 6), tag: 'RV' + Math.floor(Math.random() * 90 + 10) })).body?.gangId;
    await q('UPDATE gangs SET treasury=9000000, lifetime_tribute=100000, season_tribute=100000 WHERE id=$1', [g2]);
    await q('UPDATE gangs SET lifetime_tribute=90000000, season_tribute=90000000 WHERE id=$1', [gid]);
    await si('POST', `/v1/diplomacy/pact/${g2}`, token, {});
    await si('POST', `/v1/diplomacy/coalition/${gid}`, t2, {});
  });

  // ── the personal empire, the vices, the crews ──
  await trySeed('business', () => si('POST', '/v1/business/laundromat/buy', token, {}));
  // a club needs standing (economy v3 step 5) — set directly; the dues path is proven in test/made.js
  await trySeed('speakeasy', async () => {
    await app.pool.query(`UPDATE account_persistent SET made_until = now() + interval '30 days'
      WHERE account_id = (SELECT account_id FROM characters WHERE id=$1)`, [charId]);
    await si('POST', '/v1/speakeasy/neon/open', token, {});
  });
  await trySeed('soldiers', async () => {
    await si('POST', '/v1/soldiers/hire', token, {});
    await si('POST', '/v1/soldiers/hire', token, {});
    // the memorial keeps only the DEAD, and permadeath needs a failed job — pin one directly
    const dead = (await q('SELECT id FROM soldiers WHERE character_id=$1 ORDER BY id LIMIT 1', [charId])).rows[0];
    if (dead) await q("UPDATE soldiers SET alive=false, cause='a job that went wrong' WHERE id=$1", [dead.id]);
  });
  await trySeed('boxing', async () => {
    await si('POST', '/v1/boxing/recruit', token, { name: 'Mirror Kid' });
    const f2 = (await si('POST', '/v1/boxing/recruit', t2, { name: 'Rival Kid' })).body?.id
      ?? (await si('GET', '/v1/boxing', t2)).body?.stable?.[0]?.id;
    await si('POST', '/v1/boxing/list', t2, { fighter: f2, stake: 50000 });
    const f1 = (await si('GET', '/v1/boxing', token)).body?.stable?.[0]?.id;
    await si('POST', `/v1/boxing/announce/${two}`, token, { myFighter: f1, theirFighter: f2 });
  });
  // THE STRIP — a rival's car taking a wager. Newly reachable: the comma-chain alias fix exposed
  // three Port/races lists that had been invisible, and an invisible list is not a covered list.
  await trySeed('races strip', async () => {
    for (let i = 0; i < 12; i++) {
      await q("UPDATE characters SET energy=200, nerve=50, jail_until=NULL, gta_at=NULL WHERE id=$1", [two]);
      const r = await si('POST', '/v1/garage/boost', t2, {});
      if (r.code < 400 && r.body?.success !== false) break;
    }
    const car2 = (await si('GET', '/v1/races', t2)).body?.cars?.[0]?.id;
    if (car2) await si('POST', `/v1/races/list/${car2}`, t2, { limit: 50000 });
  });
  // THE GALA — a live party in the city, so the guest-side list has a row to render. The host needs
  // a Row House (tier 2 — two upgrades, the ladder is sequential) AND a Butler on the door, and the
  // household must be square, which is why this is four calls rather than one.
  await trySeed('estate gala', async () => {
    await q("UPDATE account_persistent SET omr = omr + 4000 WHERE account_id=$1", [acct2]);
    await si('POST', '/v1/estate/upgrade', t2, {});
    await si('POST', '/v1/estate/upgrade', t2, {});
    await si('POST', '/v1/estate/staff/butler', t2, {});
    await si('POST', '/v1/estate/gala', t2, {});
  });
  await trySeed('stable', async () => {
    await si('POST', '/v1/stable/buy', t2, { kind: 'dog', name: 'Mirror Runner' });
    const r2 = (await si('POST', '/v1/stable/buy', t2, { kind: 'dog', name: 'Second Runner' })).body?.id;
    await si('POST', `/v1/stable/list/${r2}`, t2, { limit: 50000 });
  });
  // ── the LIVE events — several boards are two-shape (base config vs open-event), and the
  // renderers read the OPEN fields, so one of everything must be running when the boards are read
  let flyer; // the fixture's racer — the track-entry seed below reuses it
  await trySeed('live events', async () => {
    await q('UPDATE account_persistent SET omr=500 WHERE account_id=$1', [acct]);
    await q("UPDATE characters SET loc='neon' WHERE id=$1", [charId]);
    await si('POST', '/v1/wire/subscribe', token, { tier: 2 });          // → board.premium
    await si('POST', '/v1/casino/tournament', token, {});                // → den.tournament open
    flyer = (await si('POST', '/v1/stable/buy', token, { kind: 'dog', name: 'Mirror Flyer' })).body?.id;
    await si('POST', `/v1/casino/futurity/nominate/${flyer}`, token, {});   // → den.futurity open
    await si('POST', `/v1/stable/stakes/${flyer}`, token, {});              // → stable.stakes open
  });
  await trySeed('port', async () => {
    await q("UPDATE characters SET loc='docks' WHERE id=$1", [two]);
    await si('POST', '/v1/port/boat/skiff', t2, {});
    const b = (await si('GET', '/v1/port', t2)).body?.fleet?.[0]?.id;
    await si('POST', `/v1/port/run/${b}`, t2, { route: 'coastal' });
  });
  await trySeed('heists', () => si('POST', '/v1/heists/plan', token, { job: 'payroll', role: 'muscle' }));
  // an OPEN crew raid, so the City board's raids list has a row. Needed only once the chained-
  // iterator fix taught 4b to read that renderer's map body — before it, the list registered no
  // fields and its emptiness went unnoticed, which is the coverage this seeds back.
  // `t2` plans it: the fixture character already has an active heist and one crew op is the cap.
  // `two` is already seeded to respect 500000, comfortably past kryl's level-20 floor
  await trySeed('world raid', () => si('POST', '/v1/world/kryl/plan', t2, {}));
  await trySeed('convoy', async () => {
    await q("UPDATE characters SET loc='docks' WHERE id=$1", [charId]);
    await si('POST', '/v1/goods/buy', token, { goodId: 'gin', qty: 8 });
    await si('POST', '/v1/convoy', token, { to: 'neon', goodId: 'gin', qty: 8 });
    await si('POST', '/v1/convoy/depart', token, { guards: 'none' });
    await q("UPDATE characters SET loc='neon' WHERE id=$1", [charId]);
  });
  await trySeed('pen break', async () => {
    // PIN THE YARD INCIDENT. It is a seed-drawn DAILY event, and one of the six ('toss') closes the
    // commissary — so on those days the cutkit can't be bought, the break is never planned, and this
    // fixture silently loses a list. That is a date-flake, not a finding: the run went red on a toss
    // day having been green the day before. `test/pen.js` pins it to 'quiet' for exactly this reason
    // (and exercises each incident deliberately, which is where that coverage belongs). Read
    // per-call by `activeYardEvent()`, so setting it here is enough.
    const yard = process.env.PEN_YARD_EVENT;
    process.env.PEN_YARD_EVENT = 'quiet';
    try {
      await q("UPDATE characters SET jail_until = now() + interval '2 hours' WHERE id=$1", [two]);
      await si('POST', '/v1/pen/buy/cutkit', t2, {});
      await si('POST', '/v1/pen/break/plan', t2, {});
      await q('UPDATE characters SET jail_until=NULL WHERE id=$1', [two]);
    } finally {
      if (yard === undefined) delete process.env.PEN_YARD_EVENT; else process.env.PEN_YARD_EVENT = yard;
    }
  });

  // ── the boards that need another player to have acted ──
  // MY PROFILE's Top 8 reads elements of `recruits` — a bare referral-graph row is enough for the
  // element shape (earnedCash is computed and always present, 0 with no ledger rows behind it)
  await trySeed('profile', () => q(
    `INSERT INTO referrals (recruit_account, recruiter_account, qualified_at) VALUES ($1, $2, now())
       ON CONFLICT (recruit_account) DO NOTHING`, [acct2, acct]));
  await trySeed('contracts', () => si('POST', `/v1/streets/${two}/bounty`, token, { amount: 5000, kind: 'hospitalize' }));
  await trySeed('loans', async () => {
    await si('POST', '/v1/loans', t2, { amount: 20000, rate: 0.25, hours: 24 });   // an offer from someone else
    await si('POST', '/v1/loans', token, { amount: 30000, rate: 0.2, hours: 24 }); // one of ours to sell as paper
    const mine = (await si('GET', '/v1/loans', token)).body?.offers?.find((o) => o.mine);
    if (mine) { await si('POST', `/v1/loans/${mine.id}/take`, t2); await si('POST', `/v1/loans/${mine.id}/sell`, token, { price: 25000 }); }
  });
  await trySeed('secrets', async () => {
    await q('UPDATE account_persistent SET omr=500 WHERE account_id IN ($1,$2)', [acct, acct2]);
    await q('UPDATE characters SET bank=900000, season_kills=3 WHERE id=$1', [two]);
    await si('POST', `/v1/wire/dig/${two}`, token, {});
    const s = (await si('GET', '/v1/secrets', token)).body?.held?.[0];
    if (s) await si('POST', `/v1/secrets/${s.id}/extort`, token, { demand: 5000 });
    await q('UPDATE characters SET bank=900000, season_kills=3 WHERE id=$1', [charId]);
    await si('POST', `/v1/wire/dig/${charId}`, t2, {});
    const s2 = (await si('GET', '/v1/secrets', t2)).body?.held?.[0];
    if (s2) await si('POST', `/v1/secrets/${s2.id}/extort`, t2, { demand: 5000 });   // one ON us
  });
  await trySeed('dynasty', async () => {
    await si('POST', `/v1/dynasty/propose/${two}`, token, {});      // a proposal we made
    await si('POST', `/v1/dynasty/consigliere/${two}`, token, {});
    await si('POST', `/v1/dynasty/consigliere/${charId}`, t2, {});  // one where we are the adviser
    await si('POST', `/v1/dynasty/consigliere/accept/${acct2}`, token, {});
    const t3 = (await si('POST', '/v1/auth/guest')).body.token;
    await si('POST', '/v1/character', t3, { name: 'Mirror Three ' + Math.random().toString(36).slice(2, 6) });
    const three = (await si('GET', '/v1/me', t3)).body.character.id;
    await q('UPDATE characters SET cash=9000000, respect=200000 WHERE id=$1', [three]);
    await si('POST', `/v1/dynasty/consigliere/${charId}`, t3, {});   // an offer left STANDING, unaccepted
  });

  // ── going legit: the treasury ledger, the bonds, the block ──
  // (the VAULT seed retired 2026-07-31 with the stock layer — omerta-stock-layer-retirement.md.
  // Nothing owes stock, so there is no claim rail to exercise; the ETH ledger it fed remains.)
  await trySeed('treasury', async () => {
    await q("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('seed', 'mirror-rev', 5)");
    await q('UPDATE account_persistent SET minted=true, omr=5000 WHERE account_id=$1', [acct]);
  });
  await trySeed('bonds', async () => {
    await modInject('POST', '/v1/mod/bond/fund', { omr: 100000 });
    await modInject('POST', '/v1/mod/bond/simulate', { account: acct, principalEth: 1, price: 1000, nonce: 1 });
  });
  await trySeed('auction', async () => {
    await q('UPDATE account_persistent SET omr=200000 WHERE account_id=$1', [acct]);
    const lots = (await si('GET', '/v1/auction', token)).body?.lots || [];
    if (lots[0]) await si('POST', `/v1/auction/${lots[0].id}/bid`, token, { amount: lots[0].minNext });
    // a WON trophy, so `wins` has a row, then consigned so `consignments` does too
    await q(`INSERT INTO auction_wins (account_id, lot_id, archetype, name, serial, price, won_at)
             VALUES ($1,'mirror:w','crown','A Mirror Crown','W0-M',500,now())`, [acct]);
    await si('POST', '/v1/auction/consign', token, { lotId: 'mirror:w', reserve: 100 });
  });
  await trySeed('estate', async () => {
    await q('UPDATE account_persistent SET omr=200000 WHERE account_id=$1', [acct]);
    await si('POST', '/v1/estate/upgrade', token, {});   // the board joins `estates`, so one must exist
  });
  await trySeed('megaproject', () => si('POST', '/v1/megaproject/cash', token, { amount: 25000000 }));
  await trySeed('kitchen', () => q('UPDATE characters SET trade_rep=5000 WHERE id=$1', [charId]));

  // ── the raw-bind renderers' lists — the mirror extension exposed these ten; each needs a row ──
  await trySeed('wire intel', async () => {
    await si('POST', `/v1/wire/tap/${two}`, token, {});        // → board.taps
    await si('POST', `/v1/wire/informant/${two}`, token, {});  // → board.informants
    await si('POST', `/v1/wire/watch/${two}`, token, {});      // → board.watches (needs the tier-2 sub above)
  });
  await trySeed('phone block', () => si('POST', `/v1/phone/block/${two}`, token, {}));  // blocks gate only DMs
  await trySeed('market listing', async () => {
    await q("UPDATE characters SET loc='neon' WHERE id=$1", [charId]);
    await si('POST', '/v1/goods/buy', token, { goodId: 'gin', qty: 3 });
    await si('POST', '/v1/market', token, { goodId: 'gin', qty: 3, price: 500 });
  });
  await trySeed('track entry', () => si('POST', `/v1/casino/track/enter/${flyer}`, token, {}));
  await trySeed('races car', async () => {   // the races board lists YOUR cars — boost one (retry the odd bust)
    for (let i = 0; i < 12; i++) {
      // gta_at too: a FAILED boost still arms the boost cooldown, so a reset that only refills
      // energy/nerve/jail leaves every retry bouncing off `cooldown` (seen flaky under the full suite)
      await q("UPDATE characters SET energy=200, nerve=50, jail_until=NULL, gta_at=NULL WHERE id=$1", [charId]);
      const r = await si('POST', '/v1/garage/boost', token, {});
      if (r.code < 400 && r.body?.success !== false) break;
    }
  });
  await trySeed('fixture boat', async () => {
    await q("UPDATE characters SET loc='docks' WHERE id=$1", [charId]);
    await si('POST', '/v1/port/boat/dinghy', token, {});
  });
  // v3 step 7 — an EXTRACTED item, so the Collection's on-chain list has a row to check. Flagged
  // directly rather than driven through the withdrawal, which needs a minted account, a linked
  // wallet and a configured signing chain — none of which this fixture has and none of which the
  // mirror is checking. What has to be non-empty is the LIST.
  await trySeed('an on-chain trophy', () => q(
    "UPDATE boats SET minted_onchain=true WHERE character_id=$1", [charId]));
  await trySeed('estate staff', async () => {
    const cat = (await si('GET', '/v1/estate', token)).body?.household?.catalog || [];
    const s = cat.find((x) => !x.locked);
    await si('POST', `/v1/estate/staff/${s?.id}`, token, {});
  });
  // STREET LIFE — the phone's three lists. `book.call` and the favor board are only reachable
  // through the black book, so the contacts row comes first: a favor is visible to whoever holds
  // the POSTER's number, which is the entire point of the mechanic.
  await trySeed('phone contacts', () => q(
    "INSERT INTO contacts (owner_account, contact_account, how) VALUES ($1,$2,'met'), ($2,$1,'met') ON CONFLICT DO NOTHING",
    [acct, acct2]));
  await trySeed('contact call', () => q(
    `INSERT INTO contact_calls (character_id, npc_character, kind, good_id, qty, district, pay, expires_at)
     VALUES ($1,$2,'freight','gin',3,'neon',9000, now() + interval '6 hours') ON CONFLICT DO NOTHING`,
    [charId, two]));
  await trySeed('favor (theirs)', () => si('POST', '/v1/favors', t2, { goodId: 'gin', qty: 3, pay: 9000, district: 'neon', note: 'quietly' }));
  await trySeed('favor (mine)', () => si('POST', '/v1/favors', token, { goodId: 'gin', qty: 2, pay: 4000, district: 'docks' }));
  // THE EXCHANGE (M3 cb/ammo order book, promoted out of the raw deck) — a listing through the real
  // route so the Garage card's list has a row; the fixture needs the ammo it escrows.
  await q('UPDATE characters SET ammo=200 WHERE id=$1', [charId]);
  await trySeed('exchange listing', () => si('POST', '/v1/exchange/list', token, { kind: 'ammo', qty: 20, unitPrice: 45 }));
  // A QUEUED VOUCHER at the window (the Extraction card's cancel list) — SQL, since a real withdrawal
  // needs the chain signer configured; the row is what the screen reads, not the rail.
  await trySeed('queued voucher', () => q(
    `INSERT INTO vouchers (id, account_id, kind, amount, nonce, to_address, deadline, status)
     VALUES ($1,$2,'omr',12,990001,'0x00000000000000000000000000000000000000aa',9999999999,'queued') ON CONFLICT DO NOTHING`,
    [crypto.randomUUID(), acct]));
  // Warm the LAZY single-use param fixtures before the jail below — they memoize at first use,
  // which is now after seedLists, and a jailed fixture can't open a ring table or place a call.
  // (Back to neon first: the boat seed above left the fixture at the docks, and the ring is a den game.)
  await q("UPDATE characters SET loc='neon' WHERE id=$1", [charId]);
  await paramId('/v1/casino/ring/:p');
  await paramId('/v1/phone/thread/:p');
  // THE COLLISION — /v1/live.here is "real humans in YOUR district", so a real (non-npc, non-agent)
  // human must stand in the fixture's district (neon, its loc above) or that list comes back empty and
  // its element field (`online`) is never compared (nearby + hotDistricts populate from the other
  // seeded streets). A dedicated co-located street, near the fixture's level.
  const tC = (await si('POST', '/v1/auth/guest')).body.token;
  await si('POST', '/v1/character', tC, { name: 'Neon Neighbor ' + Math.random().toString(36).slice(2, 6) });
  const cNbr = (await si('GET', '/v1/me', tC)).body.character.id;
  await q("UPDATE characters SET respect=500000, loc='neon' WHERE id=$1", [cNbr]);
  // THE PEN'S YARD — must be LAST: /v1/pen only shows the yard from a cell, so the fixture ends the
  // seed JAILED (with `two` on the roster). Board fetches happen after this; jail gates ACTIONS,
  // never a board's shape, so every other read is unaffected.
  await trySeed('pen yard', () => q(
    "UPDATE characters SET jail_until = now() + interval '2 hours' WHERE id IN ($1, $2)", [charId, two]));
}

// Fixtures are memoized because several are SINGLE-USE — a player may only have one ring table open,
// so calling the fixture a second time (check 4b re-resolving the same path) returns undefined and
// the run fails on a URL with `undefined` in it rather than on anything about the client.
const paramCache = new Map();
const paramId = async (rawPath) => {
  if (!paramCache.has(rawPath)) paramCache.set(rawPath, await PARAM_FIXTURES.get(rawPath)());
  return paramCache.get(rawPath);
};

const unlistedParam = [...reads.keys()].filter((k) => k.split('|')[0].includes(':p') && !PARAM_FIXTURES.has(k.split('|')[0]));
assert.deepEqual(unlistedParam, [], `${unlistedParam.length} route(s) the client reads from carry an id ` +
  `with no way to obtain one listed in PARAM_FIXTURES, so their fields go unchecked — add a fixture`);

// The fixture runs BEFORE the top-level reads too (it used to run only before the list pass):
// several boards are TWO-SHAPE — a base config object that gains its live fields only while an
// event is OPEN (a registering poker tournament, a nominated futurity, an open stakes race, the
// wire's subscriber-only premium block). The renderers read the LIVE fields, so the fixture must
// make one of everything or those reads fail as "not returned" against the dormant shape.
await seedLists();
// ── CHECK 6 vocabulary: THE TERMS RIDE WITH THE PRICE ───────────────────────────────────────────
// The fifth way is a control that refuses on press. The SIXTH is a screen that takes your money and
// does not mention what it will keep costing — which is the class every tester report so far has
// belonged to. "How can I owe more in wages than my laundromat brings in?" and "no way a 25k runner
// costs 8k in 5h" are the same defect twice: the pad and the nut were both DISCLOSED nowhere and
// EXITED nowhere, and each got fixed only because somebody complained. Nothing stops the next
// recurring cost shipping the same way.
//
// So: when a board sends a field that names an ONGOING OBLIGATION, the screen rendering that board
// must read it. Not "display it prettily" — that is the renderer's business, and unenforceable — but
// LOOK AT IT, which is the difference between a card that can tell you and one that structurally
// cannot.
//
// Explicit vocabulary, swept off the tree rather than pattern-matched, for exactly the reason
// GATE_FIELDS is: `cold` is an obligation state, `coldSeconds` is the countdown to it, and a
// pattern like /cost|owed/ would drag in every one-off price in the game and make the check noise.
// A new recurring cost has to be added here — which is the point: that is the moment somebody
// decides whether it needs disclosing.
const OBLIGATION_FIELDS = new Set([
  'upkeepPerHr', 'upkeepOwed',        // the pad — a front's protection + wages
  'crewWagePerHr', 'crewWageOwed',    // the nut — the kitchen crew, paid whether the stash moves or not
  'cold', 'crewCold', 'coldSeconds',  // the shut-off, and the countdown to it
  'padOutran',                        // the crossover: the envelope now exceeds what the till can hand back
]);
const undisclosed = [];
const allFieldsSeen = new Set();  // check 7: the whole field universe, for the completeness sweep
const noteObligations = (where, key, have, fields) => {
  const owed = [...have].filter((f) => OBLIGATION_FIELDS.has(f));
  const blind = owed.filter((f) => !fields.has(f));
  if (blind.length) undisclosed.push(`${where} renders ${key} but never reads ${blind.join(',')} — the board `
    + `states an ongoing cost the screen does not, which is how the pad and the nut both reached a tester`);
};
const notReturned = [], unobservable = [];
for (const [key, fields] of reads) {
  const [rawPath, sub] = key.split('|');
  let path = rawPath;
  if (rawPath.includes(':p')) {
    const id = await paramId(rawPath);
    assert(id, `the PARAM_FIXTURES entry for ${rawPath} produced no id — the fixture broke, not the client`);
    path = rawPath.replace(':p', id);
  }
  const r = await inject('GET', path, token);
  assert(r.code < 400 && r.body, `${path} answered ${r.code} for the fixture character — check 4 cannot read a board it cannot fetch`);
  const obj = sub ? r.body[sub] : r.body;
  const target = Array.isArray(obj) ? obj[0] : obj;
  if (!target || typeof target !== 'object') { unobservable.push(`${key} (${readWhere.get(key)})`); continue; }
  const have = new Set(Object.keys(target));
  for (const f of have) allFieldsSeen.add(f);
  const gone = [...fields].filter((f) => !have.has(f));
  if (gone.length) notReturned.push(`${readWhere.get(key)} reads ${gone.join(',')} off ${key} — the route returns ${[...have].slice(0, 8).join(',')}…`);
  noteObligations(readWhere.get(key), key, have, fields);
}
assert.deepEqual(notReturned, [], `the client reads ${notReturned.length} field(s) its route does not return — ` +
  `those render as undefined, or silently take a fallback, with no error anywhere`);
assert.deepEqual(unobservable, [], `${unobservable.length} binding(s) resolved to an empty list or a non-object, ` +
  `so their fields could not be observed — enrich the fixture above rather than leaving them unchecked`);
const readCount = [...reads.values()].reduce((n, s) => n + s.size, 0);

// ── 4b verification: fetch each list and compare an ELEMENT ──────────────────────────────────────
// This is where a green run stops being cheap: a list that comes back EMPTY has no element to check,
// so the fixture below has to make one exist. An empty list is NOT a pass — it is recorded and the
// run fails, because "we looked and there was nothing there" reading as "verified" is the exact
// dishonesty this file exists to prevent.
assert.equal(listUnresolved, 0, `${listUnresolved} iterator body/bodies could not be delimited, so element reads go unchecked`);
assert(listReads.size > 15, `only ${listReads.size} list bindings found — the element extraction broke`);
const listMissing = [], listEmpty = [], listUngated = [];
// The gate vocabulary, as the boards actually name it (swept live off every board, not guessed):
// `minLvl`/`minLevel`/`lvl` are the level a row needs; `locked`/`canRaid`/`eligible` are the server
// having already decided. A board that adds a new gate name has to be added here — deliberately a
// short explicit list rather than a pattern, so a field called `level` (the row's OWN level, not a
// requirement) is never mistaken for a gate.
// `unlocked` was ADDED here by check 7's completeness sweep (below): skills' actives + grandmasteries
// gate a per-row control on it, so it belongs in check 5's enforced set — the sweep is what found it.
// `jailed`/`hospitalized` were ADDED by a play session: /v1/streets sends both on every row, the Wet
// Work roster rendered them as CHIPS and then hung ten live attack buttons beside them that the server
// refuses on exactly those flags. Neither name is gate-SHAPED, so check 7's sweep could not see them
// either — a gate reads like a gate only if you already know its vocabulary, which is why this list
// grows from play as well as from the sweep.
//   AND THE LIMIT, because it would otherwise read as more protection than it is: this check could
//   NOT have caught that bug and cannot catch its shape. The rule is "read it somewhere", and the
//   CHIPS on the same row read both flags — mutation-verified: strip the gating from all ten buttons,
//   leave the chips, and this passes. What it does catch is the narrower case of a clickable row that
//   reads them NOWHERE. Reading a gate for DECORATION while the control stays live is invisible to a
//   static check (the link runs through a computed variable, and "did that variable reach a disabled
//   attribute" is rendering semantics this guard deliberately does not model); it needs eyes, or a
//   behavioural probe that presses each control against a seeded mark and compares.
const GATE_FIELDS = new Set(['minLvl', 'minLevel', 'locked', 'canRaid', 'eligible', 'unlocked',
  'jailed', 'hospitalized']);
// …and the waiver, because those last two are not gates the way the others are. `minLvl` gates ANY
// control on the row; `jailed`/`hospitalized` gate only controls that REACH THE PERSON. A picker
// that merely NAMES somebody is not reaching them, and gating it would hide a legitimate move — the
// over-gating failure, which is as much a lie as the under-gating one. So a renderer may waive a
// (renderer|board|field) here WITH the reason, and anything not waived must be read: catalogue-or-
// declare, so the next roster that hangs an attack on these flags fails rather than passing quietly.
const GATE_WAIVED = {
  // The Life tab reads /v1/streets only to fill the marriage + consigliere target pickers. Checked
  // at the source: proposeMarriage and nameConsigliere gate mad-dog, self, already-wed, pending, the
  // annulment cooldown and cash — and NOTHING about where the target is. You can propose to someone
  // in lockup, which is both correct and in character.
  'renderLife|/v1/streets|streets||jailed': 'a marriage/consigliere proposal never reaches the target — the server does not gate it on their state',
  'renderLife|/v1/streets|streets||hospitalized': 'a marriage/consigliere proposal never reaches the target — the server does not gate it on their state',
};
for (const [key, fields] of listReads) {
  const [rawPath, sub, listField] = key.split('|');
  let path = rawPath;
  if (rawPath.includes(':p')) path = rawPath.replace(':p', await paramId(rawPath));
  const r = await inject('GET', path, token);
  assert(r.code < 400 && r.body, `${path} answered ${r.code} — 4b cannot read a board it cannot fetch`);
  let arr = sub ? r.body[sub] : r.body;
  if (listField) arr = arr?.[listField];
  if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== 'object' || arr[0] === null) {
    listEmpty.push(`${key} (${listWhere.get(key)}) — reads ${[...fields].slice(0, 5).join(',')}`); continue;
  }
  // a list is heterogeneous often enough (market listings are car|good|order) that one element is
  // not the population — a field present on ANY element is a field the route really returns
  const have = new Set(arr.flatMap((e) => (e && typeof e === 'object' ? Object.keys(e) : [])));
  for (const f of have) allFieldsSeen.add(f);
  const gone = [...fields].filter((f) => !have.has(f));
  if (gone.length) listMissing.push(`${listWhere.get(key)} reads ${gone.join(',')} off each element of ${key} — the elements carry ${[...have].slice(0, 8).join(',')}…`);
  noteObligations(listWhere.get(key), `each element of ${key}`, have, fields);
  // ── CHECK 5: a control the player cannot use must SAY SO ──
  // The fourth way a button lies. Checks 1-3 cover the way out (does the route exist, is the value
  // real, does the handler read the field) and check 4 covers the way back (is the field real). None
  // catches a control that is perfectly wired and simply REFUSES — the tester's report was "I tab to
  // the run it button and it says I can't till level 6", which is the same defect class as the pad:
  // the game not telling you the rule until after you act.
  //
  // The rule is narrow on purpose, so it stays true rather than becoming noise: when the SERVER
  // sends a gate on a row's elements AND the client hangs a CLICK on that row, the client must READ
  // the gate. What it does with it — disable the button, swap in a "need lvl N" chip, filter the row
  // out — is the renderer's business; not looking at all is the bug. A row with no action needs
  // nothing (nothing to refuse), and a board that never sends a gate is not this check's business.
  if (listActs.has(key)) {
    const gates = [...have].filter((f) => GATE_FIELDS.has(f));
    const blind = gates.filter((g) => !fields.has(g) && !GATE_WAIVED[`${listWhere.get(key)}|${key}|${g}`]);
    if (blind.length) listUngated.push(`${listWhere.get(key)} renders a control per row of ${key} but never reads ` +
      `${blind.join(',')} — the row's own elements carry it, so the button looks live and refuses on press`);
  }
}
assert.deepEqual(listMissing, [], `the client reads ${listMissing.length} field(s) off list elements that the ` +
  `route's elements do not carry — every row renders that as undefined`);
// A REFUSED SEED IS A FINDING, not a note. Every step in seedLists() is meant to succeed; when one
// 4xx's the fixture quietly loses whatever it was going to make, and the only symptom is an empty
// list further down — which is a much longer walk from the failure to the cause. Worse, a refusal
// whose list happens to be non-empty for some OTHER reason reduces coverage with no symptom at all.
// (Found the hard way: a seed-drawn DAILY yard incident closes the Pen commissary one day in six, so
// the co-op-break fixture worked on the 28th and not on the 29th. Assert the refusals directly and
// the run names the route, the code and the reason on the day it happens.)
assert.deepEqual(seedNotes, [], `${seedNotes.length} fixture seed step(s) were REFUSED, so whatever ` +
  `they were going to create does not exist and the coverage below is quietly thinner than it reads:\n  ` +
  `${seedNotes.join('\n  ')}`);
assert.deepEqual(listUngated, [], `${listUngated.length} clickable row(s) ignore a gate their own elements ` +
  `carry, so the control looks usable and only refuses once pressed:\n  ${listUngated.join('\n  ')}`);
// CHECK 6 — the terms ride with the price (see OBLIGATION_FIELDS above)
assert.deepEqual(undisclosed, [], `${undisclosed.length} screen(s) render a board that states an ONGOING COST ` +
  `without reading it, so the player learns the terms from their balance instead of the card:\n  ` +
  `${undisclosed.join('\n  ')}`);
assert.deepEqual(listEmpty, [], `${listEmpty.length} list(s) came back EMPTY, so their element fields were ` +
  `never actually compared. An empty list is not a pass — extend seedLists() so each has a row:\n  ` +
  `${listEmpty.join('\n  ')}`);
const listCount = [...listReads.values()].reduce((n, s) => n + s.size, 0);

// ── CHECK 7: THE VOCABULARY IS COMPLETE — no gate or ongoing cost hides under a new NAME ─────────
// Checks 5 and 6 enforce a TIGHT allowlist on purpose: a loose /lock|cost/ pattern would drag in
// every one-off price and status in the game and make the enforcement noise. The hole that tight
// allowlist leaves is the exact one the design review named — a future board can ship a gate or a
// recurring cost under a name NOT in either set, and the enforcement silently never runs; it only
// starts once somebody remembers to add the name. So the enforced sets stay tight, and a SEPARATE
// completeness sweep makes the omission LOUD: any field across every board whose NAME reads like a
// gate or an ongoing cost must be either ENFORCED (in check 5/6's set) or explicitly REVIEWED-and-
// waived here with a reason. A new such field forces that decision at add-time instead of shipping
// unchecked — the same catalog-or-declare discipline NOT_API already uses for the way OUT. This does
// NOT loosen 5/6 (they still enforce only their tight sets); it closes the "unknown name" regression.
// Precise on purpose: `Locked$`/`^(un)?locked$` catches locked/unlocked/carLocked but NOT "blocked"
// (a DM line-status, not a lock — the first cut's `.*[lL]ocked` over-matched "b·locked").
const GATE_SHAPE = /(^min(Lvl|Level)$|Locked$|^(un)?locked$|^gated?$|^eligible$|^can[A-Z]|^unmet$|Req$|^requires?$)/;
const COST_SHAPE = /(upkeep|^wages?$|Wage[A-Z]|arrears|^rent|dues|^nut$|Owed$|^owed$|^cold|Cold$|padOutran)/;
// Reviewed and deliberately NOT enforced — a field whose NAME matches the shape but which is NOT a
// player-facing gate or a recurring cost the card must disclose. Kept with a reason so the waiver is
// a decision on the record, not a blind spot. The enforced RECURRING costs (the pad, the nut) live
// under their precise names in OBLIGATION_FIELDS; these are their parameters, their credits, or
// generic debts disclosed per-board.
const REVIEWED_NOT_ENFORCED = new Map([
  ['owed', 'a one-off debt (loan / house marker / estate staff) — disclosed per board; too generic to enforce globally without false trips. The recurring costs are enforced under their precise names.'],
  ['bloodOwed', 'the feud ledger — bodies owed between bloodlines, a status not currency.'],
  ['incomeOwed', 'sov tribute owed TO the player (collect → treasury) — income, not a cost you pay.'],
  ['stipendOwed', 'the pass stipend owed TO the player, paid as the backed pool funds — a credit, not a cost.'],
  ['coldHours', 'a TERM of the pad/nut (the shut-off window), shown in the terms copy; the owed cost itself is enforced as upkeep*/crewWage*/cold(Seconds).'],
  ['upkeepBps', 'a pad RATE parameter (% of the take); the owed amount is enforced as upkeepPerHr/upkeepOwed.'],
  ['upkeepCapHours', 'a pad RATE parameter (how long the pad keeps running); the owed amount is enforced as upkeepPerHr/upkeepOwed.'],
  ['upkeepMult', 'a roster/charter upkeep MULTIPLIER (a modifier the cost derives from), not a displayed owed amount.'],
  // The top-level `canX` family — the SINGLETON analogue of check 5's per-row gate (the server decided
  // whether one control shows). Each is verified READ by its renderer (and discloses the reason when
  // false); check 5 enforces the per-ROW version, so these are waived from IT but still forced through
  // the sweep, so a new `canFoo` is a decision on the record rather than a silent singleton.
  ['canChooseTrait', 'action gate — mastery "choose your legacy" control (renderLife), shown only when true.'],
  ['canHire', 'action gate — world/heist co-op "hire a gun/hand" control, shown only when true.'],
  ['canMentor', 'action gate — mentor "offer to guide" control (renderDiscovery), with eligibility copy.'],
  ['canSeek', 'action gate — "seek a mentor" control (renderDiscovery).'],
  ['canThrow', 'action gate — estate gala control; discloses the tier/Butler/square-book requirement when false.'],
  ['canClaim', 'action gate — Street Deeds claim control (renderDeeds), shown only when true (one deed per account).'],
  ['canExtract', 'action gate — the Street Deed on-chain extract button (renderDeeds chainCard), shown only when true (made + wallet-linked + unlisted + chain configured); the reason is disclosed when false.'],
  // THE PAYROLL (/v1/payroll) — the one-page obligations surface. Its `owed`/`cold`/`coldSeconds`
  // ride the ENFORCED names; these three are its display companions:
  ['canPay', 'THE PAYROLL per-row pay gate (family rows are boss/underboss-only) — the renderer gates the pay button on it and the till enforces regardless; the row itself is always shown (you should know the family\'s books).'],
  ['anyCold', 'THE PAYROLL summary chip (SOMETHING WENT COLD vs all warm) — the per-row cold state is the enforced `cold` name.'],
  ['coldCount', 'THE PAYROLL — how many fronts/operations in a summed row are cold; the state itself is the enforced `cold`.'],
  ['coldWord', 'THE PAYROLL — each book\'s own noir word for its cold state (downed tools / gone cold / they walk), display vocabulary only.'],
]);
const shapeFlags = [];
for (const f of allFieldsSeen) {
  const gate = GATE_SHAPE.test(f), cost = COST_SHAPE.test(f);
  if (!gate && !cost) continue;
  if (GATE_FIELDS.has(f) || OBLIGATION_FIELDS.has(f)) continue;   // already ENFORCED by check 5/6
  if (REVIEWED_NOT_ENFORCED.has(f)) continue;                     // reviewed and waived, with a reason
  shapeFlags.push(`${f} (${gate ? 'gate' : 'cost'}-shaped)`);
}
shapeFlags.sort();
assert.deepEqual(shapeFlags, [], `${shapeFlags.length} field name(s) read like a GATE or an ONGOING COST but ` +
  `are neither ENFORCED (checks 5/6) nor explicitly REVIEWED — a new gate/cost under an unknown name ships ` +
  `UNCHECKED until someone adds it. Either enforce it (add to GATE_FIELDS/OBLIGATION_FIELDS and read it in ` +
  `the client) or waive it in REVIEWED_NOT_ENFORCED with a reason:\n  ${shapeFlags.join('\n  ')}`);

// ── CHECK 9: THE LEVEL LEDGER — reading a wall is not enforcing it ──────────────────────────────
// Check 5's rule is that the renderer must READ the gate; what it then does is the renderer's
// business. That is the right rule for gates whose shape varies (a chip, a filter, a disable) — and
// it is exactly why it cannot see this: the two defects found by playing BOTH read the level and did
// nothing with it, because they printed it in the LABEL. A level-1 player picked "The Corner Store —
// 2 crew, lvl 4" out of a live <select>, pressed plan it, and was refused; the Empire catalog stated
// "level 15+" over a live [buy] and refused the same way. Requirement stated, control live — which is
// worse than silence, because the player reads the number as information rather than as a wall.
//
// A LEVEL gate is the one kind narrow enough to demand more of, and that narrowness is the whole
// reason this can be a hard check rather than an advisory: it is permanent (not "come back with
// money"), it is one number, and it is compared one way. So: where a clickable row's elements carry
// a level requirement, the row must COMPARE it against the player's level — directly, or through a
// helper its own renderer defines.
//
// It deliberately does NOT accept "the row carries some other gate field, so presumably that covers
// it". A first cut did, and the M1 mutation walked straight through: the heist row carries `locked`,
// which is the NOTORIETY wall, so neutering the level gate still passed on an unrelated one. Two
// walls on one row are two walls. The one row that genuinely defers to a server-derived boolean is
// waived below by name, which turns a loophole into a decision on the record.
//
// Four families already do this and are what the two broken ones were measured against: the races
// tiers, the convoy routes and rigs, and the port lanes all disable with a 🔒. The gate rides under
// two different names (`lvl` and `minLvl`), which is precisely how the two instances slipped the
// tight allowlist — so the ledger keys on the SHAPE of the requirement, not on one spelling.
const LVL_FIELDS = new Set(['lvl', 'minLvl', 'minLevel']);
// Waived: a clickable row that carries a level field which is NOT a wall on THIS control. Each needs
// a property of the row, not a promise to look later.
const LVL_WAIVED = new Map([
  // `lvl` is the ONE ambiguous spelling in this client: on a catalog row it is the requirement, on a
  // progression row it is the level ATTAINED. The mastery tracks are the second kind — the row carries
  // `xp`/`rank`/`nextAt` beside it and `lvl` is what the player has reached in that trade, so there is
  // no wall to enforce and the control (choose your legacy) is gated by the server's own
  // `canChooseTrait`. Waived here rather than by narrowing the field set, because the narrowing that
  // would exclude it (drop `lvl`) is exactly what let two of the four real instances through.
  ['renderLife|/v1/mastery||tracks|lvl', 'the trade level ATTAINED, not a requirement — the row is a '
    + 'progress card (xp/rank/nextAt) and its control is gated by the server-sent canChooseTrait.'],
  // The one row that genuinely defers to the server. `worldBoard` computes canRaid from THIS level
  // (plus the coop/solo split, which the client cannot derive), so the renderer swaps the raid button
  // for a "need lvl N" chip on it. Named rather than accepted by a blanket "some gate is present"
  // rule, which is what let the M1 mutation through the first cut.
  ['renderCity|/v1/world||npcs|minLvl', 'gated on the server-sent canRaid, which worldBoard derives '
    + 'from this exact minLvl (and the solo/coop split the client cannot compute) — the row renders a '
    + '"need lvl N" chip in place of the button when it is false.'],
]);
const lvlUngated = [];
let lvlChecked = 0;
for (const [k, fields] of listReads) {
  if (!listActs.has(k)) continue;                       // nothing to refuse
  const region = listRegion.get(k), params = listParam.get(k), fn = listFn.get(k);
  if (!region || !params) continue;
  for (const f of fields) {
    if (!LVL_FIELDS.has(f)) continue;
    // the field has to be a REQUIREMENT, not the row's own level. A roster row carrying `level` is
    // describing the man, not gating the button — `lvl`/`minLvl`/`minLevel` are the requirement
    // spellings this client uses, and `level` is deliberately absent from the set for that reason.
    lvlChecked++;
    if (LVL_WAIVED.has(`${fn}|${k}|${f}`)) continue;
    const F = f.replace('$', '\\$');
    const fnSrc = listSrc.get(k);
    let direct = false, helper = false;
    for (const param of params) {
      const P = param.replace('$', '\\$');
      // (a) compared against the player's level right here, either order
      if (new RegExp(`me\\s*\\??\\.\\s*level[^;{}]{0,80}${P}\\s*\\??\\.\\s*${F}\\b`
        + `|${P}\\s*\\??\\.\\s*${F}\\b[^;{}]{0,80}me\\s*\\??\\.\\s*level`).test(region)) { direct = true; break; }
      // (b) compared inside a helper THIS renderer defines and the row calls — the commonest shape
      // (`const canRun = (r) => (me.level || 0) >= (r.minLvl || 0)` sits above the map that uses it),
      // and a region-only scan would report both of those correct pickers as defects.
      for (const c of region.matchAll(new RegExp(`([a-zA-Z_$][\\w$]*)\\s*\\(\\s*${P}\\s*\\)`, 'g'))) {
        const h = new RegExp(`${c[1].replace('$', '\\$')}\\s*=\\s*\\(?[^)]*\\)?\\s*=>[^;]{0,160}\\.\\s*${F}\\b`);
        if (fnSrc && h.test(fnSrc) && /me\s*\??\.\s*level/.test(fnSrc)) { helper = true; break; }
      }
      if (helper) break;
    }
    if (!direct && !helper) lvlUngated.push(
      `${fn} renders a control per row of ${k} and states the row's ${f}, but never compares it to the `
      + `player's level — the requirement is shown and the control stays live, so it refuses on press`);
  }
}
assert(lvlChecked >= 6, `THE LEVEL LEDGER found only ${lvlChecked} level-gated clickable row(s) — the `
  + 'extractor has stopped seeing them, so a green run here means nothing. Fix the scan, not the floor.');
assert.deepEqual(lvlUngated, [], `${lvlUngated.length} clickable row(s) STATE a level requirement and do not `
  + `enforce it, so the control looks usable at any level and only refuses once pressed:\n  ${lvlUngated.join('\n  ')}`);

const rankStats = { routes: 0, markup: 0, wired: 0 };
// ── CHECK 10: THE RANK LEDGER — the same class on the family's other axis ───────────────────────
// Check 9 covers the LEVEL wall. Playing found the identical shape on RANK, and in the sharpest
// possible place: `renderCity` gates the frontier's reinforce/invade on the server's own
// `w.frontier.canCommand` — and THIRTY LINES BELOW, in the same renderer, shipped three
// boss-or-underboss controls with no rank test at all, each stating "Boss or underboss only" inside
// its own confirm dialog. A soldier in a family was offered "sue for peace" and "declare a family
// war ($250,000 — boss only)"; both were driven and both answered 400 rank. Forgotten sibling,
// one screen, thirty lines apart.
//
// The rule: a control whose route can refuse `rank` must be rendered behind a rank test. It is a
// hard check for the same reason check 9's is — the wall is BINARY and PERMANENT-until-promoted,
// so the honest render is to withhold the control and say who it belongs to, never to draw it live.
// Derived from the tree on both sides (the routes from the handlers that throw, the call sites from
// the client) so a new boss-only verb is covered the day it ships.
{
  const srcFiles = ['src/server.js', ...readdirSync('src/routes').map((f) => 'src/routes/' + f)];
  // 1. every exported function that can throw GameError('rank') — the FAMILY-rank axis only. The
  //    kitchen's cook/buyMakings throw 'rank' for TRADE rank, which is not a permission at all (it
  //    rises by playing and has no holder), so they are excluded by name rather than by pattern.
  const TRADE_RANK = new Set(['cook', 'buyMakings']);
  //    Keyed MODULE:FN, not by bare name — `upgradeRacket` is exported by BOTH economy.js (a personal
  //    racket, no rank gate at all) and territory.js (a family operation, boss-only), so a name-keyed
  //    scan attributes territory's gate to the personal route and reports a control that is correctly
  //    live. Driven to be sure: a player with no family upgrades a personal racket and gets 200.
  const rankFns = new Map();                                  // module path -> Set(fn)
  const scanDir = (dir) => {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(dir + '/' + f, 'utf8');
      const re = /export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g;
      const idx = []; let m;
      while ((m = re.exec(src))) idx.push([m[1], m.index]);
      for (let i = 0; i < idx.length; i++) {
        const body = src.slice(idx[i][1], i + 1 < idx.length ? idx[i + 1][1] : src.length);
        if (!/GameError\('rank'/.test(body) || TRADE_RANK.has(idx[i][0])) continue;
        const key = dir + '/' + f;
        if (!rankFns.has(key)) rankFns.set(key, new Set());
        rankFns.get(key).add(idx[i][0]);
      }
    }
  };
  scanDir('src'); scanDir('src/social');

  // 2. the routes those functions are reached through, resolved through each route file's OWN imports
  //    so a namespace alias (`E.` vs `Territory.`) decides which module a call really lands in.
  const rankRoutes = [];
  for (const f of srcFiles) {
    const src = readFileSync(f, 'utf8');
    const alias = new Map();                                  // local name -> resolved module path
    for (const im of src.matchAll(/import\s+(?:\*\s+as\s+([A-Za-z0-9_$]+)|\{([^}]*)\})\s+from\s+'([^']+)'/g)) {
      const mod = 'src/' + im[3].replace(/^\.\//, '').replace(/^\.\.\//, '');
      if (im[1]) alias.set(im[1], mod);
      else for (const n of im[2].split(',')) { const nm = n.trim().split(/\s+as\s+/).pop().trim(); if (nm) alias.set(nm, mod); }
    }
    const re = /\.(get|post|delete|put)\(\s*['"](\/v1\/[^'"]*)['"]/g;
    const marks = []; let m;
    while ((m = re.exec(src))) marks.push([m[1].toUpperCase(), m[2], m.index]);
    for (let i = 0; i < marks.length; i++) {
      const body = src.slice(marks[i][2], i + 1 < marks.length ? marks[i + 1][2] : Math.min(src.length, marks[i][2] + 2500));
      let hit = null;
      for (const [mod, fns] of rankFns) for (const fn of fns) {
        for (const call of body.matchAll(new RegExp('(?:([A-Za-z0-9_$]+)\\.)?' + fn + '\\s*\\(', 'g'))) {
          // an unqualified call resolves through a named import; a qualified one through its namespace
          if (alias.get(call[1] || fn) === mod) { hit = fn; break; }
        }
        if (hit) break;
      }
      if (hit) rankRoutes.push([marks[i][0], marks[i][1], hit]);
    }
  }
  assert(rankRoutes.length >= 20, `THE RANK LEDGER found only ${rankRoutes.length} rank-gated route(s) — the `
    + 'extractor has stopped seeing them, so a green run here means nothing. Fix the scan, not the floor.');

  // 3. the client controls that reach one, and whether each is DRAWN behind a rank test.
  //    Two passes, because the client draws a button two ways and only one of them names its route
  //    in the markup:
  //      A. `data-do="POST /v1/..."` — the route is IN the markup, so the site and the gate are one
  //         window. This is where the three Blood-War defects lived.
  //      B. `$('#id')` / `querySelectorAll('[data-x]')` + `.onclick` + act(...) — the route is in a
  //         wiring block at the foot of the renderer, attached to an element the MARKUP already chose
  //         whether to draw. Gating the wiring block would gate the wrong thing (a soldier's `$()`
  //         returns null because the render withheld the button), so resolve the selector forward
  //         from the lookup to its markup and test the gate THERE.
  //    Pass B is built FORWARD from the selector — an earlier cut scanned backward from the route and
  //    kept pairing an input read inside one handler with the next handler's `.onclick`, reporting
  //    four gated controls as ungated. A finding produced by a tool you did not check is not a finding.
  const RANK_TEST = /role\s*===\s*'boss'|role\s*===\s*'underboss'|canCommand|\bboss\b|\bcityBoss\b/;
  // A gate is a CONDITION, so test conditions — not a byte window. Walk out through the enclosing
  // `${...}` interpolations and at each level read only the HEAD: the text from `${` to where the
  // branch body starts (its first backtick). That is exactly the expression that decided whether to
  // draw this control, and nothing else. Two coarser cuts were tried and both were wrong in opposite
  // directions: a fixed 1200-char window passed a mutation stripping the war button's rank test
  // because the pact button one line above still carried one, and stopping at the innermost
  // interpolation flagged seven controls correctly drawn inside an outer `${boss ? ...}` block.
  const enclosing = (at) => {
    const levels = []; let depth = 0;
    for (let i = at; i > 1 && levels.length < 8; i--) {
      if (html[i] === '}') depth++;
      else if (html[i] === '{') {
        // EVERY brace closes the counter, not just `${` — a `${(() => { ... })()}` IIFE in the middle
        // of a template carries plain braces, and counting only `${` let them swallow the enclosing
        // `${boss ? ...}` and flag two controls that are correctly drawn inside it.
        if (depth === 0 && html[i - 1] === '$') levels.push(i + 1); else depth--;
      }
    }
    return levels;
  };
  const gatedAt = (at) => enclosing(at).some((start) => {
    const head = html.slice(start, at);
    const body = head.indexOf('`');
    return RANK_TEST.test(body >= 0 ? head.slice(0, body) : head);
  });
  const lineAt = (at) => html.slice(0, at).split('\n').length;
  const routeRe = (path) => new RegExp(path.split('/').filter(Boolean).filter((x) => !x.startsWith(':'))
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join("/(?:[^'\"`\\s]*/)?"));
  const rankUngated = []; let rankDo = 0, rankWired = 0;

  // pass A — data-do markup
  for (const m of html.matchAll(/data-do="(GET|POST|DELETE|PUT) (\/v1\/[^"]*)"/g)) {
    const hit = rankRoutes.find(([meth, path]) => meth === m[1] && routeRe(path).test(m[2]));
    if (!hit) continue;
    rankDo++;
    if (!gatedAt(m.index)) rankUngated.push(`line ${lineAt(m.index)}  ${m[1]} ${hit[1]} (data-do)`);
  }

  // pass B — the two wiring idioms the client really uses, each matched with its RECEIVER, because
  // that is what makes a lookup and an `.onclick` the SAME handler. A looser pair-them-if-they-are-near
  // version matched `$('#sov-lb')` (an innerHTML target with no handler of its own) against the NEXT
  // handler's onclick and blamed the sovereignty board for the crest-colour route.
  const wireHits = [];
  for (const w of html.matchAll(/const\s+(\w+)\s*=\s*\$\(\s*'#([\w-]+)'\s*\)[\s\S]{0,120}?\b\1\.onclick\s*=(?=((?:(?!\.onclick)[\s\S]){0,700}))/g))
    wireHits.push([`id="${w[2]}"`, w[3] || '']);
  for (const w of html.matchAll(/querySelectorAll\(\s*'\[([\w-]+)\]'\s*\)\s*\.forEach\(\s*\(?\s*(\w+)[^)]*\)?\s*=>\s*\2\.onclick\s*=(?=((?:(?!\.onclick)[\s\S]){0,700}))/g))
    wireHits.push([`${w[1]}=`, w[3] || '']);
  for (const [sel, body] of wireHits) {
    for (const [meth, path] of rankRoutes) {
      if (!routeRe(path).test(body)) continue;
      const drawn = html.indexOf(sel);
      if (drawn < 0) break;                                  // nothing in the markup draws it
      rankWired++;
      if (!gatedAt(drawn)) rankUngated.push(`line ${lineAt(drawn)}  ${meth} ${path} (wired via ${sel})`);
      break;
    }
  }
  assert(rankDo >= 8, `THE RANK LEDGER matched only ${rankDo} data-do control(s) against `
    + `${rankRoutes.length} rank-gated routes — the markup pass has drifted. Fix the scan, not the floor.`);
  assert(rankWired >= 12, `THE RANK LEDGER resolved only ${rankWired} wired control(s) back to their markup — `
    + 'the selector resolver has stopped working, which silently drops that whole half of the surface. '
    + 'Fix the resolver, not the floor.');
  Object.assign(rankStats, { routes: rankRoutes.length, markup: rankDo, wired: rankWired });
  assert.deepEqual(rankUngated, [], `${rankUngated.length} control(s) reach a route that can refuse \`rank\` `
    + `without being rendered behind a rank test, so a soldier is shown a boss-only button and learns it is `
    + `not his only by pressing it:\n  ${rankUngated.join('\n  ')}`);
}

// ── CHECK 8 — THE ACTION LEDGER ────────────────────────────────────────────────────────────────
// The EIGHTH way a button lies, and the quietest: it works, and then says nothing about what it did.
// `act()` toasts describe(r.body) with no override, so every one of the ~380 routes a player presses
// reads back exactly what describe() makes of the response — and describe()'s fallback is the bare
// word "done." A play session drove these for real and found 26 of them saying it, among them a
// stake, an unstake that had just started a SIX-HOUR window in which that $OMR can be looted off
// you, a bank deposit that rides in transit and is lootable until it clears, founding a family,
// signing a fighter, buying a racket, selling a car, and going MADE. Two of those are withheld
// TERMS, not missing flavour — the same class as the pad and the nut.
//
// So: DRIVE each route against the real server and require describe() to say something. The route
// list is declared (catalogue-or-declare) but every RESPONSE is real, so a shape that changes
// server-side fails here rather than drifting. describe() is hosted from the client's own source
// with its real helpers — a missing dependency surfaces as a throw, not a silent pass. `rules` is
// SUPPLIED because describe()'s regimen branch legitimately reads it (hosting it standalone without
// it reads as a page bug and is a probe bug — that mistake cost a false finding while writing this).
const rulesBody = (await inject('GET', '/v1/rules', token)).body;
const describeFn = (() => {
  const L = html.split('\n');
  // Take each helper as a WHOLE DECLARATION rather than a line, or a fixed count of them. All the
  // shapes it must handle are live in the client right now: `esc`/`nth` are one line, `minsTxt` is a
  // four-line ternary, and `fmt` is a six-line block. A one-line grab silently truncates the block
  // ones (it threw the day `fmt` grew a body, which is the good failure); a fixed slice is worse,
  // because it goes on "working" while quietly taking a neighbour's code with it — the fixed-window
  // class this repo has been bitten by twice. Don't hand-roll a tokenizer either: `esc` holds a
  // regex literal containing both quote characters, which defeats naive quote tracking (that cost a
  // false "never terminates" here). Use the real parser as the oracle — grow the slice until it
  // COMPILES, which is exactly the question being asked.
  const decl = (re) => {
    const i = L.findIndex((l) => re.test(l));
    assert(i >= 0, `describe() helper not found: ${re}`);
    for (let n = i; n < Math.min(L.length, i + 40); n++) {
      const src = L.slice(i, n + 1).join('\n');
      try { new vm.Script(src); return src; } catch { /* still an incomplete statement */ }
    }
    assert(false, `describe() helper never parses as a complete statement: ${re}`);
  };
  const dStart = L.findIndex((l) => l.includes('function describe(body, code)'));
  assert(dStart >= 0, 'describe() not found in the client — the action ledger cannot run');
  let dEnd = dStart; for (let i = dStart + 1; i < L.length; i++) if (L[i] === '  }') { dEnd = i; break; }
  // WHICH helpers to host is DERIVED, not hand-listed. A hand-list is a second copy of describe()'s
  // dependencies, and it went stale exactly the way a second copy always does: `goodName` was added
  // to three branches (the call-fulfil line and both favor lines) and never to the list, so any
  // ACTIONS row reaching one of them threw `goodName is not defined` — which does not read as a
  // missing helper, it reads as a client bug, and it made those three branches structurally
  // UNDRIVABLE by the very ledger that exists to drive them.
  //
  // Do NOT hand-roll a tokenizer to work out which identifiers are "free" — that is the trap this
  // file already records one screen up, and it sprang again while this was being written: a
  // string-stripper that looks correct desynced on one nested template and swallowed 86,000 of
  // describe()'s 88,000 characters, reporting a confident, clean, empty sweep. The direction of the
  // error is what decides the design: hosting a helper describe() never calls costs nothing, while
  // MISSING one is the defect. So be deliberately over-inclusive — take every sibling helper the
  // client declares at describe()'s own scope and host the ones whose name appears as a call in
  // describe()'s text. `html` is already decommented at the top of this file, so a name that appears
  // only in prose is not even visible here — which is how this scan established that describe()
  // deliberately does NOT call `esc` (it uses its own `txt`, and says so). The old hand-list was
  // both: it hosted `esc`, which is never called, and missed `goodName`, which is.
  const rawBody = L.slice(dStart, dEnd + 1).join('\n');
  const siblings = [...new Set(L.flatMap((l) => {
    const m = /^  const ([A-Za-z_$][\w$]*) = (?:\(|[A-Za-z_$][\w$]*\s*=>)/.exec(l);   // arrow helpers only:
    return m ? [m[1]] : [];                                                            // inert to declare
  }))];
  const needed = siblings.filter((n) => new RegExp(`(?<![\\w$.])${n.replace('$', '\\$')}\\s*\\(`).test(rawBody));
  // anti-vacuity: if the sibling scan or the call scan breaks, `needed` empties and every helper
  // silently stops being hosted while this reads exactly as green. These five are load-bearing in
  // describe() today and cannot go away without the lines that use them going away first.
  for (const must of ['fmt', 'nth', 'minsTxt', 'goodName'])
    assert(needed.includes(must), `the helper sweep lost ${must} — the scan is broken, not describe()`);
  const helpers = needed.map((n) => decl(new RegExp(`^  const ${n.replace('$', '\\$')} = `)));
  // a truncated grab is still valid JS often enough to run and quietly answer wrong, so pin one
  // load-bearing token per known helper. (`fmt` reads back its own rounding, which is what a
  // sub-cent bank balance and a dust $OMR payment both depend on.)
  for (const [name, tok] of [['fmt', 'toLocaleString'], ['nth', 'th'], ['minsTxt', 'Math.ceil']])
    assert(helpers[needed.indexOf(name)].includes(tok), `describe() helper ${name} came out truncated (no ${tok})`);
  const src = `((rules) => { ${helpers.join('\n')}\n${L.slice(dStart, dEnd + 1).join('\n')}\n return describe; })`;
  return vm.runInNewContext(src)(rulesBody);
})();

// each entry is a route a player PRESSES (act()/data-do) whose success shape must read as something.
// Bodies are whatever makes the call succeed for a fresh character; a 4xx is skipped, not asserted —
// this check is about what a WORKING action says, and the gates have their own suites.
// A formatted-money matcher. Assertions here compare a rendered LINE against the figure the SERVER
// actually sent, never against a literal — a literal passes while the two drift, which is the whole
// class this file exists to catch. `fmt` groups thousands, so the raw number never appears verbatim.
const fmtLike = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ACTIONS = [
  ['POST', '/v1/travel/neon', null],
  // found by playing: the numbers ticket said "done." — neither the number taken, the stake, nor the
  // odds, on a bet whose stake is gone the moment it is placed
  ['POST', '/v1/casino/numbers', { pick: 123, amount: 50 }],
  // the weekly fight is the numbers ticket's neighbour and read "done." — a stake on a NAMED fighter
  // at stated odds, every field already in the reply
  ['POST', '/v1/casino/fight', { side: 'a', amount: 2000 }],
  // the standing graft: a RECURRING $OMR sink that named neither its price nor when it lapses
  ['POST', '/v1/law/envelope', null],
  // "paid $140" — the price with the purchase left off, on the buy that feeds every cook
  ['POST', '/v1/kitchen/makings/vim', { qty: 1 }],
  // a permanent build decision that said "done."
  ['POST', '/v1/skills/bruiser', null],
  ['POST', '/v1/bank/deposit', { amount: 100 }],
  ['POST', '/v1/bank/withdraw', { amount: 50 }],
  ['POST', '/v1/armory/ammo', null],
  ['POST', '/v1/armory/unequip', null],
  ['POST', '/v1/goods/buy', { goodId: GOODS[0].id, qty: 1 }],
  ['POST', '/v1/goods/sell', { goodId: GOODS[0].id, qty: 1 }],
  // JOINING a family, which the FOUNDING line below excludes by name (`name === undefined`) and
  // nothing then picked up. It is a one-way move that puts you under omertà, and it read "done."
  // THREE rows, and the order is the whole reason it drives at all: the fixture arrives here ALREADY
  // in a family (seeded upstream), so the first cut's join answered 400 `in_gang`, was skipped, and
  // its assertion read `undefined` — the declared-but-never-driven class this list has now been
  // bitten by three times. Leave what we're in, join something else, leave that, then found our own,
  // because every row below wants us as a boss.
  ['POST', '/v1/gangs/leave', null],
  ['POST', async () => {
    const g = (await app.pool.query(
      `SELECT id FROM gangs WHERE id NOT IN (SELECT gang_id FROM gang_members WHERE character_id=$1) LIMIT 1`,
      [charId])).rows[0];
    return g ? `/v1/gangs/${g.id}/join` : null;
  }, null],
  ['POST', '/v1/gangs/leave', null],
  ['POST', '/v1/gangs', { name: 'Ledger ' + Math.random().toString(36).slice(2, 7), tag: 'LDG' }],
  // TAKING TURF, NAMING THE WATCH, and the whole TERRITORY LADDER — five family verbs that moved
  // six and seven figures out of the treasury and said nothing, and one (the upgrade) that said the
  // CLUB's line and printed "$undefined" for the price. The treasury is funded in the first row's
  // resolver rather than in the pre-seed because the family does not exist until the row above runs
  // — the same drive-time resolution every dynamic row in this list uses, with the side effect
  // stated rather than hidden. Order is the order written: hold the ground, then name the hour,
  // then put an operation on it, then climb.
  ['POST', async () => {
    const g = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [charId])).rows[0];
    if (!g) return null;
    await app.pool.query('UPDATE gangs SET treasury=50000000 WHERE id=$1', [g.gang_id]);
    return '/v1/districts/docks/seize';
  }, null],
  ['POST', '/v1/districts/docks/watch', { hour: 3 }],
  ['POST', '/v1/territory/docks/establish', { kind: 'protection' }],
  ['POST', '/v1/territory/docks/upgrade', null],
  ['POST', '/v1/gangs/tribute', { amount: 5000 }],       // cash and $OMR tribute share one shape —
  ['POST', '/v1/gangs/tribute/omr', { amount: 10 }],      // the currency marker is what tells them apart
  ['POST', '/v1/gangs/vanity/color', { color: '#3a5f7d' }],
  // THE SEAL AND THE RENAME sat on that same card and both said "done." — the crest one line up is
  // the sibling that got it right. Both are $OMR: the seal from the family's POOLED reserve (so the
  // tribute below fills it first — the ladder's first rung is 150), the rename from the boss's own.
  ['POST', '/v1/gangs/tribute/omr', { amount: 200 }],
  ['POST', '/v1/gangs/vanity/seal', null],
  ['POST', '/v1/gangs/vanity/name', { name: 'Ledger Two ' + Math.random().toString(36).slice(2, 5), tag: 'LD2' }],
  // OPENING and JOINING a crew raid on an APEX outfit both said "done." — on the game's hardest
  // targets, where the crew MINIMUM is the number that decides whether the op can go at all. Both
  // are driven here: JOIN the open raid the seed planted on another token, LEAVE it, then open one
  // of our own — a character may only be on one crew op at a time, so the order is what makes all
  // three land. They come BEFORE the rout below, which is what puts the raid cooldown on.
  ['POST', async () => {
    const r = (await app.pool.query("SELECT id FROM world_raids WHERE status='planning' AND leader_character <> $1 LIMIT 1", [charId])).rows[0];
    return r ? `/v1/world/raids/${r.id}/join` : null;
  }, null],
  ['POST', async () => {
    const r = (await app.pool.query(
      "SELECT raid_id FROM world_raid_members WHERE character_id=$1 LIMIT 1", [charId])).rows[0];
    return r ? `/v1/world/raids/${r.raid_id}/leave` : null;
  }, null],
  ['POST', '/v1/world/kryl/plan', null],
  // ...and then CALL OFF OUR OWN, because a LEADER disbanding sends {disbanded} where a member sends
  // {left} — the two senses that collide with the heist's disband. Without this row the collision
  // path is never driven and its mutation SURVIVES, which is how it was caught.
  ['POST', async () => {
    const r = (await app.pool.query(
      "SELECT id FROM world_raids WHERE leader_character=$1 AND status='planning' LIMIT 1", [charId])).rows[0];
    return r ? `/v1/world/raids/${r.id}/leave` : null;
  }, null],
  // A ROUT THAT TAKES THE OUTFIT'S TURF, driven from INSIDE the family — `frontier` is only ever true
  // for a raider who has one, which is exactly the term the solo line dropped: a rout that planted the
  // family's flag read byte-for-byte like a rout by a man with no family at all. The outfit's strength
  // is parked just above the rout floor in the seed so this raid CROSSES it (a raid at or below the
  // floor pays nothing and routs nothing — the audit's own crossing guard).
  ['POST', '/v1/world/dockrats/raid', null],
  ['POST', '/v1/gangs/leave', null],
  ['POST', '/v1/path', { path: PATHS[0].id }],
  ['POST', '/v1/identity/bio', { bio: 'a quiet man' }],
  ['POST', '/v1/vanity/title', { title: 'The Quiet Man' }],
  ['POST', '/v1/duels/list', { limit: 1000 }],
  ['POST', '/v1/casino/fade', { limit: 0 }],
  ['POST', '/v1/casino/poker/deal', { limit: 0 }],
  ['POST', '/v1/casino/numbers/claim', null],
  ['POST', '/v1/paper/read', null],
  ['POST', '/v1/soldiers/unassign', null],
  ['POST', '/v1/business/collect', null],
  // the deeper drive: the four fixture buttons all route through one act() handler, the two
  // tributes are different currencies behind one shape, and a front / a berth / a soldier / a
  // retainer are all real money leaving the pocket
  ['POST', '/v1/underworld/fixer/gift', null],
  ['POST', '/v1/business/restaurant/buy', null],
  ['POST', '/v1/travel/docks', null],                    // the harbormaster is at the docks, and this
  ['POST', '/v1/port/berth', null],                      // is also the only entry that drives travel
                                                         // for real (the fixture starts at neon)
  ['POST', '/v1/soldiers/hire', null],
  ['POST', '/v1/law/retainer', null],
  // consent-by-listing: the price IS the offer
  ['POST', '/v1/bodyguard/offer', { price: 25000 }],
  // the duel style triangle, where the counter is public and picking is the skill
  ['POST', '/v1/duels/style', { style: 'brawler' }],
  // three rails feed one monument and all three come back with the same dollar-valued `credited`,
  // so the $OMR rail read "laid $830" for a 10 $OMR burn — the wrong unit AND the wrong number
  ['POST', '/v1/megaproject/omr', { amount: 10 }],
  // "paid $924,759" — a six-figure sum with no mention that it also stops you hitting, dealing,
  // laundering or collecting for as long as it lasts. LAST in this list on purpose: going to ground
  // refuses every offensive and extractive action above it (the signed D2 shield-not-bunker rule),
  // so anywhere earlier it would silently skip its own neighbours.
  ['POST', '/v1/safehouse', null],
];
// GOING TO GROUND IS LAST FOR A REASON (see above) — so anything pushed later runs AFTER it and is
// refused by the very rule that entry exists to exercise. Four of the actions below were appended
// and silently never drove; their fixes then survived mutation, which reads exactly like a fix that
// holds. Everything added from here splices in BEFORE the safehouse instead of appending after it.
const SAFEHOUSE_AT = ACTIONS.length - 1;
const addAction = (...rows) => ACTIONS.splice(SAFEHOUSE_AT, 0, ...rows);
// The fixture must be able to AFFORD what it drives. The first cut left it on a fresh guest's $500
// and five of the money actions 4xx'd, so they were skipped — and a mutation that stripped a fixture's
// name off the gift response SURVIVED, because that action had never once run. A declared-but-never-
// driven entry is worse than no entry: it reads on the summary line as covered.
await app.pool.query("UPDATE characters SET cash=5000000, respect=500000, jail_until=NULL, hosp_until=NULL WHERE id=$1", [charId]);
await app.pool.query('UPDATE characters SET ammo=600, energy=100 WHERE id=$1', [charId]);
{ const dr = WORLD_NPCS.find((f) => f.id === 'dockrats');
  await app.pool.query(
    `INSERT INTO world_npcs (npc_id, strength, strength_at) VALUES ('dockrats', $1, now())
       ON CONFLICT (npc_id) DO UPDATE SET strength = $1, strength_at = now(), enraged_until = NULL`,
    [Math.ceil(dr.max * WORLD.ROUT_FLOOR_BPS / 10000) + 20]); }
await app.pool.query('UPDATE account_persistent SET omr=1000 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [charId]);
// The two loudest PvP actions need somebody to aim at, and the fixture's second street is scoped to
// the seed block — so resolve one here rather than restructure the file. Found by playing: putting a
// price on another player's head, and starting the 3h hunt that every shot is gated on, BOTH said
// "done." — the first is the loudest thing you can do to another player (the escrow posts, the take
// is kept, the MARK IS TOLD), the second is the most expensive prerequisite in the game.
const mark = (await app.pool.query(
  "SELECT id FROM characters WHERE alive AND id <> $1 AND NOT is_npc ORDER BY created_at LIMIT 1", [charId])).rows[0];
if (mark) addAction(
  ['POST', `/v1/streets/${mark.id}/bounty`, { amount: 6000, kind: 'kill' }],
  ['POST', `/v1/streets/${mark.id}/search`, null]);
// A TAP ON OUR OWN LINE, so the TRACE runs in its paid shape rather than its empty one. The trace
// and the sweep both answer {spent, bugsFound} and the client read them as one line, so a 90 $OMR
// trace — which NAMES the watcher and deliberately leaves the tap live — reported "swept 1 bug(s)
// off your line": the wrong action, the paid-for name thrown away, and a false all-clear over a tap
// that was still listening (driven: 1 on the line after a trace, 0 after a sweep). Seeded directly
// because placing it through the route needs the other player's token, which is scoped elsewhere.
if (mark) {
  await app.pool.query(
    `INSERT INTO wiretaps (watcher_character, target_character, expires_at) VALUES ($1,$2, now() + interval '12 hours')
       ON CONFLICT (watcher_character, target_character) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    [mark.id, charId]);
  // FUNDED HERE, and that is a fix rather than a convenience. The trace entry below has been in this
  // list since the trace/sweep discrimination shipped, and it has NEVER DRIVEN: by the time the loop
  // reaches it the fixture's 1000 $OMR is spent, the route answers 400 `omr`, a 4xx is skipped, and
  // the ledger prints ✅ over an entry proving nothing (checked against main before saying so). That
  // is the declared-but-never-driven class this file has been bitten by twice already — it reads on
  // the summary line as covered. The floor below now counts the trace, so it cannot go quiet again.
  await app.pool.query('UPDATE account_persistent SET omr = omr + 2000 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [charId]);
  // A MARK WE HOLD NOTHING ON. An earlier block in this file already dug on `mark`, and one holder
  // may hold one secret per house — so the dig 4xx'd `already` and skipped, which is the silence the
  // floor below exists to break. Seeded with a laundering trail so the dig runs in its FOUND shape;
  // the empty shape has its own line and its own coverage in test/wire.js.
  // two flat queries and a JS filter, never a correlated subquery — pg-mem cannot parse one
  const held = new Set((await app.pool.query('SELECT target_name FROM secrets WHERE holder_character=$1', [charId]))
    .rows.map((r) => r.target_name));
  const digMark = (await app.pool.query(
    'SELECT id, name FROM characters WHERE alive AND NOT is_npc AND id <> $1 ORDER BY created_at DESC', [charId]))
    .rows.find((c) => !held.has(c.name)) || mark;
  await app.pool.query("UPDATE characters SET wash_used=500000, wash_at=now() WHERE id=$1", [digMark.id]);
  // ONE CALL, and that matters: addAction SPLICES AT A FIXED INDEX, so a later call lands BEFORE an
  // earlier one rather than after it. Split across two calls, the sweep below ran first and cleared
  // the line, and the trace — the entry that exists to prove the paid shape — then found nobody and
  // failed its own assertion. Within a single splice the order is the order written.
  // THE REST OF THE WIRE, because six things on that screen cost $OMR and exactly ONE of them named
  // its price. Driven: the informant (150) and the dig (60) both read "done."; the tap (48, 12h) read
  // "wire's live — you'll hear everything", naming neither and OVERCLAIMING besides (a tap is foiled
  // by cooked books; the informant is the one that hears everything, which is what the extra 100
  // buys); the subscription and the standing watch named neither. `disinfo`, three lines away in the
  // same describe() block, states both — the forgotten-sibling shape with its own good sibling in
  // frame. The standing watch also needed a SERVER field: it charges on the spot and keeps charging
  // every renewal, and its reply carried no `spent` at all, so the client could not have said so.
  // Ordered after the trace so that still runs in its paid shape; the sweep then clears the line.
  addAction(
    ['POST', '/v1/wire/trace', null],
    ['POST', '/v1/wire/subscribe', { tier: 2 }],
    ['POST', `/v1/wire/tap/${mark.id}`, null],
    ['POST', `/v1/wire/watch/${mark.id}`, null],
    ['POST', `/v1/wire/informant/${mark.id}`, null],
    ['POST', `/v1/wire/dig/${digMark.id}`, null],
    ['POST', '/v1/wire/sweep', null]);
  // THE DEMAND AND THE BURN, both of which read "done." An extortion is the moment the mark FINDS OUT
  // (an un-extorted secret is invisible to them — the demand IS the reveal) and it starts a 24h clock;
  // the expose spends the leverage for good and thickens their federal file. Dug here rather than in
  // the list because the id is only known once it runs, and a second secret is inside MAX_HELD.
  const dug = await inject('POST', `/v1/wire/dig/${mark.id}`, token, {});
  if (dug.code < 400 && dug.body.id) addAction(
    ['POST', `/v1/secrets/${dug.body.id}/extort`, { demand: 25000 }],
    ['POST', `/v1/secrets/${dug.body.id}/expose`, null]);
}

// THE DISPOSE-AND-TRADE FAMILY. describe() is a flat chain over field NAMES, and as the game grew the
// names collided — so a whole screen's verbs landed on a branch written for a different system. Driven,
// every one of these: SELLING an asset said "the beater is yours" (the BUY line — the exact inverse,
// price discarded); a $50,000 buy-now and a $60,000 loan repayment both said "the pad is square"
// (a bill on a screen the player was nowhere near); posting a loan OFFER told the LENDER they had
// "taken" the loan and owed $60,000; HIRING household staff read as FIRING a kitchen hand and printed
// the word "undefined" at the player twice; filling a market order read as dealing drugs on a corner;
// and listing, ordering, claiming, pulling and melting all said "done." — discarding a listing fee, a
// 48h expiry, a $4,500 ESCROW, and 152 rounds of ammo plus the family's tithe on them.
// Driven here so check 8 owns the silences; the INVERSIONS are asserted by name below, because a
// wrong line is a real sentence and every silence pattern reads straight past it.
{
  const asset = ASSETS.find((a) => a.price < 200000) || ASSETS[0];
  const good = GOODS[0];
  // the seed fixture already runs a laundromat and already hired the first staffer, and a REFUSED
  // action is skipped — which is exactly how two of these fixes survived their own mutation. Pick
  // ones nothing else has claimed, and prove they drove by their line appearing in `said`.
  const owned = new Set((await app.pool.query('SELECT kind FROM businesses WHERE character_id=$1', [charId])).rows.map((r) => r.kind));
  const front = BUSINESSES.find((b) => !owned.has(b.kind));
  const hired = new Set((await app.pool.query(
    'SELECT staff_id FROM estate_staff WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [charId])).rows.map((r) => r.staff_id));
  const staff = (ESTATE.STAFF || []).find((x) => !hired.has(x.id));
  await app.pool.query(`INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,8)
     ON CONFLICT (character_id, good_id) DO UPDATE SET qty=8`, [charId, good.id]);
  const carId = 'guardcar' + Date.now();
  await app.pool.query('INSERT INTO cars (id, character_id, model_id, trim_id) VALUES ($1,$2,$3,$4)',
    [carId, charId, CARS.find((c) => c.val > 20000).id, TRIMS[1].id]);
  if (asset) addAction(['POST', `/v1/assets/${asset.id}/buy`, null], ['POST', `/v1/assets/${asset.id}/sell`, null]);
  addAction(['POST', `/v1/garage/${carId}/melt`, null]);
  if (good) addAction(['POST', '/v1/market', { kind: 'good', goodId: good.id, qty: 3, price: 800 }],
                         ['POST', '/v1/market/order', { goodId: good.id, qty: 4, price: 900 }]);
  if (front) addAction(['POST', `/v1/business/${front.kind}/buy`, null]);
  if (staff) addAction(['POST', '/v1/estate/upgrade', null], ['POST', `/v1/estate/staff/${staff.id}`, null]);
  addAction(['POST', '/v1/loans', { amount: 5000, rate: 0.2, hours: 24 }]);
  // THE KITCHEN'S TWO PURCHASES. The lab MODULE ($60k of bench, and $OMR at the top levels) said
  // "done."; hiring a corner man landed on the catch-all `paid $50,000` — the up-front price with no
  // word on the WAGE it starts, which is the whole tradeoff. The lab has to climb first: a module is
  // fitted to a bench, so without this row the module SKIPS and reads as covered.
  addAction(['POST', '/v1/kitchen/lab/upgrade', null], ['POST', '/v1/kitchen/module/purity', null],
    ['POST', '/v1/kitchen/crew/hire', null]);
  // THE PAD is the branch `paid` was taken away from, so it has to be driven with a real bill owed —
  // otherwise the rescoping is unproven and five other obligations quietly claim its line back.
  await app.pool.query("UPDATE businesses SET upkeep_at = now() - interval '30 hours' WHERE character_id=$1", [charId]);
  addAction(['POST', '/v1/business/upkeep', null]);
  // STAFF WAGES is one of the five obligations `paid` was being claimed from, and the only one this
  // fixture can reach on its own token — so it is what makes the rescoping mutation-provable: take
  // the pad's `fronts` guard away and this reply matches the pad's branch first and reads an array
  // it never sends. Backdated so there is really something owed.
  await app.pool.query("UPDATE estates SET staff_paid_at = now() - interval '3 days' WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)", [charId]);
  addAction(['POST', '/v1/estate/wages', null]);
  // CASING and DISBANDING the score. Resolved here rather than written as static rows because both
  // need the planned job's id, and the plan lands earlier in this same list — addAction splices in
  // BEFORE the safehouse, so these run after it. The disband is the one that matters: it hands the
  // fronted stake back, and the plan line PROMISES exactly that ("the stake comes back only if you
  // disband first"), so the game made the promise and then never confirmed it was kept.
  const openJob = (verb) => async () => {
    const row = (await app.pool.query(
      "SELECT id FROM crew_heists WHERE leader_character=$1 AND status='planning' ORDER BY created_at DESC LIMIT 1",
      [charId])).rows[0];
    return row ? `/v1/heists/${row.id}/${verb}` : null;
  };
  addAction(['POST', openJob('case'), null], ['POST', openJob('leave'), null]);
}

// THE COAST GUARD, because `seized` is sent by two systems in two DIFFERENT UNITS. A lender collecting
// a defaulted marker sends it in DOLLARS; an interdicted smuggling run sends it in UNITS OF CARGO — so
// a bust that took the whole hold read "collected $20", a real sentence, a real number, and the wrong
// quantity entirely (driven: {"interdicted":true,"seized":20,"fine":1200}). The knob pins the roll so
// the bust is the shape under test; nothing else in the game reads it, and the collect runs after the
// travel entry above, so the captain is on the dock.
{
  // a FRESH hull: the seed's own dinghy is flagged minted_onchain for the Collection's on-chain list,
  // and an extracted boat is inert by the v3-step-7 rule — so reusing it launches nothing and the
  // collect never drives, which is exactly how this assertion first passed while proving nothing.
  await app.pool.query("UPDATE characters SET loc='docks', cash=5000000, jail_until=NULL, hosp_until=NULL WHERE id=$1", [charId]);
  await inject('POST', '/v1/port/boat/dinghy', token, {});
  const boat = (await app.pool.query(
    'SELECT id FROM boats WHERE character_id=$1 AND NOT minted_onchain ORDER BY created_at DESC LIMIT 1', [charId])).rows[0];
  if (boat) {
    const launched = await inject('POST', `/v1/port/run/${boat.id}`, token, { route: 'coastal' });
    if (launched.code < 400) {
      await app.pool.query("UPDATE boats SET run_until = now() - interval '1 minute' WHERE id=$1", [boat.id]);
      process.env.PORT_INTERDICT_P = '1';
      addAction(['POST', `/v1/port/collect/${boat.id}`, null]);
    }
  }
}

// THE TRAINING CAMP, THE STRIP AND THE ROAD. Signing a fighter read well and every OTHER verb on
// both training screens said "done." — the forgotten-sibling shape three lines apart in the same
// block. On the strip only tuning read; PINKS — the highest-stakes consent in the game, where a loss
// hands over the car — said "done." too. And a convoy said nothing at the load (where the BULK
// minimum is the term a player used to first hear at departure) or at the departure itself (which
// puts the route and a value band on the public feed and opens the run to three ambushes).
// ONE addAction call: it splices at a FIXED index, so a second call would land BEFORE this one.
{
  await app.pool.query(
    "UPDATE characters SET cash=9000000, respect=2000000, energy=900, jail_until=NULL, hosp_until=NULL, loc='docks' WHERE id=$1", [charId]);
  // an earlier block already put this fixture on a job and a shipment on the road, and BOTH verbs
  // refuse one at a time — so the plan and the whole convoy leg answered `busy`/`no_convoy` and were
  // SKIPPED, which is the same silence as covering them (four fixes survived their own mutation that
  // way once already). Clear the seat and the road so these really drive.
  await app.pool.query('DELETE FROM crew_heist_members WHERE character_id=$1', [charId]);
  await app.pool.query("UPDATE convoys SET status='done' WHERE owner_character=$1 AND status IN ('loading','transit')", [charId]);
  // seed-drive one of each so train/list have something to name; the BUY of each is driven below too
  await inject('POST', '/v1/boxing/recruit', token, { name: 'Kid Ledger' });
  await inject('POST', '/v1/stable/buy', token, { kind: 'dog', name: 'Ledger Lass' });
  const fighter = (await app.pool.query('SELECT id FROM fighters WHERE character_id=$1 ORDER BY created_at DESC LIMIT 1', [charId])).rows[0];
  const racer = (await app.pool.query('SELECT id FROM racers WHERE character_id=$1 ORDER BY created_at DESC LIMIT 1', [charId])).rows[0];
  // GUARANTEE the circuit WIN rather than hope for it: the maiden's field is 24 and both rolls add
  // rand(0..22), so two maxed stats put this dog past it every time. A win-only assertion behind a
  // coin flip is the recorded flake class — a deterministic check resting on a probable precondition.
  // `speed` is left short of the cap on purpose so the TRAIN action above it still has room to run.
  if (racer) await app.pool.query('UPDATE racers SET stamina=$2, heart=$2 WHERE id=$1', [racer.id, STABLE.STAT_CAP]);
  // a FRESH hull for the strip — the block above melts its own car, and a listed/pledged one is refused
  const raceCar = 'ledgercar' + Date.now();
  await app.pool.query('INSERT INTO cars (id, character_id, model_id, trim_id) VALUES ($1,$2,$3,$4)',
    [raceCar, charId, CARS.find((c) => c.val > 20000).id, TRIMS[1].id]);
  const freight = GOODS[1] || GOODS[0];
  await app.pool.query(`INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,9)
     ON CONFLICT (character_id, good_id) DO UPDATE SET qty=9`, [charId, freight.id]);
  // ROOM TO TAKE IT BACK. A convoy's manifest is deliberately allowed to beat the trunk cap (that is
  // the bulk unlock), so CANCELLING is refused when the freight has nowhere to return to — correct
  // game behaviour, and it would have left the cancel below refused and silently SKIPPED, which
  // reads on the summary line exactly like a covered action. `muscle71` is granted rather than the
  // `beater` the asset rows below BUY, or that buy would answer "already owned" and skip in turn.
  await app.pool.query(`INSERT INTO character_assets (character_id, asset_id) VALUES ($1,'muscle71')
     ON CONFLICT DO NOTHING`, [charId]);
  addAction(
    ['POST', '/v1/boxing/recruit', { name: 'Kid Second' }],
    ...(fighter ? [['POST', '/v1/boxing/train', { fighter: fighter.id, stat: 'power' }],
                   ['POST', '/v1/boxing/list', { fighter: fighter.id, stake: 20000 }]] : []),
    ['POST', '/v1/stable/buy', { kind: 'horse', name: 'Ledger Colt' }],
    ...(racer ? [['POST', `/v1/stable/train/${racer.id}`, { stat: 'speed' }],
                 ['POST', `/v1/stable/list/${racer.id}`, { limit: 20000 }],
                 // a race result lands the SHARED score line plus the sport's own — so a greyhound
                 // came back stamped with a boxing glove and the purse was stated twice
                 ['POST', `/v1/stable/circuit/${racer.id}`, { meet: 'maiden' }]] : []),
    ['POST', `/v1/races/tune/${raceCar}`, null],
    ['POST', `/v1/races/nos/${raceCar}`, null],
    ['POST', `/v1/races/list/${raceCar}`, { limit: 25000 }],
    ['POST', `/v1/races/unlist/${raceCar}`, null],
    ['POST', `/v1/races/pinkslip/${raceCar}`, { on: true }],
    ['POST', '/v1/heists/plan', { job: 'payroll', role: 'muscle' }],
    // CASING spends energy for a per-member bump on the roll and said "done."; DISBANDING refunded
    // the whole $10,000 stake and said "done." too — while the plan line one row up PROMISES that
    // refund ("the stake comes back only if you disband first"), so the game made the promise and
    // never confirmed it was kept. The id is resolved after the plan lands, below.
    // CALLING IT OFF comes FIRST so the under-minimum open below is the one `said` keeps (the map is
    // keyed by url, so a second open would overwrite the "how far short" line asserted further down).
    // Cancelling put the whole manifest back in the trunk and said "done." — neither half.
    ['POST', '/v1/convoy', { to: 'neon', goodId: freight.id, qty: 4 }],
    ['POST', '/v1/convoy/cancel', null],
    // the manifest minimum is only sayable by the server (the total lives on the convoy, not the
    // character), so open BELOW it and load ABOVE it — both halves of the term in one drive
    ['POST', '/v1/convoy', { to: 'neon', goodId: freight.id, qty: 2 }],
    ['POST', '/v1/convoy/load', { goodId: freight.id, qty: 5 }],
    ['POST', '/v1/convoy/depart', { guards: 'crew' }],
    // PUTTING WORK OUT — the pay is escrowed out of pocket the moment it posts, and the line names
    // the good and the district. It is also the branch that proved this block's own host was
    // incomplete: it calls goodName(), which the hand-written helper list had never carried, so
    // driving it threw `goodName is not defined` — a missing dependency reading as a client bug.
    ['POST', '/v1/favors', { goodId: freight.id, qty: 2, pay: 3000, district: 'neon' }]);
}

const mute = [];
const said = new Map();   // url → the line a player reads, so a WRONG one can be asserted, not just a missing one
const paidBody = new Map();  // url → the reply that produced it
let described = 0;
// A row may name its path LAZILY. Most can be written flat, but a follow-on whose id is created by
// an EARLIER ROW IN THIS LIST cannot: resolving it at setup time reads a row that the drive then
// replaces, and the stale id 4xx's — which is a skip, and a skip reads on the summary line exactly
// like a covered action. (Found doing precisely that: the seeded heist was resolved up front, the
// list's own plan row then created a new one, and casing it silently never ran.)
for (const [m, url0, payload] of ACTIONS) {
  const url = typeof url0 === 'function' ? await url0() : url0;
  if (!url) continue;
  const r = await inject(m, url, token, payload);
  if (r.code >= 400 || !r.body) continue;              // a refusal is another suite's business
  described++;
  let line;
  try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
  // Two shapes count as silence, not one. "done." is the obvious fallback; the other is describe()'s
  // LAST-RESORT `paid $N` — a price with the purchase left off, which reads as an answer and is not
  // one. Both of the routes that taught me this survived a mutation of their own fix while this
  // check watched, because removing their branch dropped them into that fallback rather than into
  // "done." — a guard that cannot see half the class it was written for. The pattern is exact (a
  // money figure and nothing else), so it matches the catch-all's own output and no real line.
  said.set(url, line);
  paidBody.set(url, r.body);   // the REPLY, so a price can be crossed against what was really charged
  if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
    mute.push(`${m} ${url} → ${JSON.stringify(line)}`);
}
// WAVE 10 — the three screens the main fixture structurally cannot reach, on their own tokens (the
// hush-line precedent below). The PEN needs a sentence, and jail refuses nearly everything, so a
// jailed character cannot sit in ACTIONS at all: it would silence every row after it and those rows
// would then read on the summary line as covered. The CLUB needs `made` and one district's only club
// slot. Their lines are folded into `said` rather than asserted in isolation, so the class sweeps
// below (no "undefined", no stacked article) cover them for free — a sweep is a net, and a line that
// never enters it is a line nobody is checking.
{
  const mk10 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id; return { t, id }; };
  const club = await mk10('Ledger Club '), con = await mk10('Ledger Con '), dd = await mk10('Ledger Deed ');
  // THE PROTÉGÉ is deliberately OUTSIDE the levelling loop below: the mentor arc only exists for a
  // player under MENTOR.PROTEGE_MAX_LVL, so a fixture raised to level 3000000 with the others would
  // 4xx every mentor row and read on the summary line as covered.
  const prot = await mk10('Ledger New ');
  for (const p of [club, con, dd]) {
    await app.pool.query("UPDATE characters SET cash=90000000, respect=3000000, energy=900, loc='cathedral' WHERE id=$1", [p.id]);
    await app.pool.query("UPDATE account_persistent SET omr=9000, minted=true, made_until=now() + interval '30 days' " +
      'WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [p.id]);
  }
  // crates for the workshop bench, and a protégé seeded at LEVEL 6 — inside the newcomer window so
  // the tie can form, and past the first milestone so the CLAIM has cash to pay. Both halves matter:
  // a claim with nothing owed 4xxs, and a skipped row reads on the summary line as covered.
  await app.pool.query('UPDATE characters SET cb=40 WHERE id=$1', [club.id]);
  await app.pool.query('UPDATE characters SET respect=300, cash=200000 WHERE id=$1', [prot.id]);
  // hurt on purpose: the Doc refuses a healthy man, so a full-health fixture would SKIP the heal
  // and it would read on the summary line as covered
  await app.pool.query("UPDATE characters SET jail_until=now() + interval '40 minutes', health=60 WHERE id=$1", [con.id]);
  const w10 = [
    // the club: the biggest single purchase on that screen said "done.", and the decor UPGRADE carried
    // `collected` so it landed on the empty-till line and reported a $600k renovation as nothing coming in
    [club.t, 'POST', '/v1/speakeasy/cathedral/open', null],
    [club.t, 'POST', '/v1/speakeasy/name', { name: 'Ledger Room' }],
    [club.t, 'POST', '/v1/speakeasy/upgrade', null],
    // LISTING the club read fine and PULLING IT BACK said "done." — the reply was `{ok, district}`,
    // indistinguishable from any other district-scoped acknowledgement, so the server now sends
    // `salePrice: null` and ONE branch renders both senses (the pinkSlip / boutLimit shape).
    [club.t, 'POST', '/v1/speakeasy/list', { price: 900000 }],
    [club.t, 'POST', '/v1/speakeasy/unlist', null],
    // THE MENTOR — the whole arc was mute, and it is the system built to make a newcomer's first
    // contact with a real player a good one. Both claims MOVE MONEY and both said "done.". Driven in
    // order: the newcomer flags, the veteran offers, the newcomer accepts, the veteran gifts.
    [prot.t, 'POST', '/v1/mentor/seeking', { on: true }],
    [club.t, 'POST', `/v1/mentor/offer/${prot.id}`, null],
    [prot.t, 'POST', `/v1/mentor/accept/${club.id}`, null],
    [club.t, 'POST', `/v1/mentor/gift/${prot.id}`, null],
    [prot.t, 'POST', '/v1/mentor/claim', null],
    // THE WORKSHOP: rolling ammo named the rounds and crafting a consumable said "done." — and USING
    // one is worse, because the reply carries the effect verbatim and the player was told nothing.
    [club.t, 'POST', '/v1/workshop/craft/medkit', null],
    [club.t, 'POST', '/v1/items/medkit/use', null],
    // CONSENT-BY-LISTING, the off direction: the branch required a `price` the OFF reply does not
    // carry, so its own comment claimed both directions while the code admitted one.
    [club.t, 'POST', '/v1/bodyguard/offer', { price: 40000 }],
    [club.t, 'POST', '/v1/bodyguard/offer', { price: 0 }],
    // the yard: a sentence is where a player has the least to do and the most to read
    [con.t, 'POST', '/v1/pen/work', null],
    [con.t, 'POST', '/v1/pen/buy/shiv', null],
    [con.t, 'POST', '/v1/pen/protection', null],
    [con.t, 'POST', '/v1/pen/bribe', { seconds: 300 }],
    [con.t, 'POST', '/v1/pen/faction/northside', null],
    // the Law's own escape, which fell into the catch-all `paid $N` — a price with the purchase left off
    [club.t, 'POST', '/v1/law/bribe', null],
    // the skill tree: learning one read well and UNLEARNING one — three lines away, on the same shared
    // 24h respec clock, burning $OMR — said "done." The pair also keeps the entity sweep below honest:
    // "The Doc's Friend" is a catalog name with an apostrophe in it, and it was reaching the player as
    // "The Doc&#39;s Friend" because describe() HTML-escaped a string bound for textContent.
    // the Doc's bill, which landed on the catch-all `paid $N` — a price with the purchase left off,
    // on the one screen a player reaches while bleeding. Driven on the CON, who is seeded hurt.
    [con.t, 'POST', '/v1/heal', null],
    [club.t, 'POST', '/v1/skills/bruiser', null],
    [club.t, 'POST', '/v1/skills/doctors_friend', null],
    [club.t, 'POST', '/v1/skills/respec/doctors_friend', null],
    // and the deed's own market. Pulling a street off it answered a BARE {ok, name} — which is the
    // shape a RENAME answers with — so it told the player they had just named the place; the marker
    // that fixed it then had to name the SYSTEM rather than the state, because a bare `listed:false`
    // is what a duel DE-listing sends ("off the ladder"). Two collisions, one verb.
    [dd.t, 'POST', '/v1/deeds/claim', { district: 'docks', name: 'Ledger Row ' + Math.random().toString(36).slice(2, 6) }],
    [dd.t, 'POST', '/v1/deeds/list', { price: 400000 }],
    [dd.t, 'POST', '/v1/deeds/unlist', null],
  ];
  await app.pool.query('UPDATE characters SET heat_exposure=800, heat=70 WHERE id=$1', [club.id]);
  for (const [t, m, url, payload] of w10) {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `the wave-10 ledger could not drive ${url} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    said.set(url, line); paidBody.set(url, r.body);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} → ${JSON.stringify(line)}`);
  }
}

// WAVE 13 — THE EXCHANGE (the M3 barter board), which needs a BUYER and so cannot sit in ACTIONS at
// all. All three of its verbs were mute or half-mute: listing and pulling read "done.", and buying
// read the catch-all `paid $6,000`, so a buyer of rounds and a buyer of crates got the same sentence.
// Listing is the terms class as well as the silence class — the goods LEAVE your hands into escrow
// the moment you post, and nothing said so.
{
  const mkEx = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=9000000, ammo=400 WHERE id=$1', [id]);
    return t; };
  const sell = await mkEx('Ledger Ex '), buy = await mkEx('Ledger Buy ');
  const drive = async (t, m, url, payload) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `the wave-13 ledger could not drive ${url} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    said.set(url, line); paidBody.set(url, r.body);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} → ${JSON.stringify(line)}`);
    return r; };
  const l1 = await drive(sell, 'POST', '/v1/exchange/list', { kind: 'ammo', qty: 50, unitPrice: 120 });
  await drive(sell, 'DELETE', `/v1/exchange/${l1.body.listingId}`, null);
  const l2 = await drive(sell, 'POST', '/v1/exchange/list', { kind: 'ammo', qty: 50, unitPrice: 120 });
  await drive(buy, 'POST', `/v1/exchange/${l2.body.listingId}/buy`, null);
  // the three named claims. `said` is keyed by URL and the buy/cancel URLs carry an id, so they are
  // read back by prefix rather than by key.
  const at = (pre) => [...said].filter(([u]) => u.startsWith(pre)).map(([, l]) => l);
  const listed = said.get('/v1/exchange/list');
  assert(/\brounds\b/.test(listed) && /escrow|out of your hands/i.test(listed),
    'listing on the Exchange must name the goods AND say they leave your hands into escrow — the ' +
    `terms ride with the price: ${JSON.stringify(listed)}`);
  const pulled = at('/v1/exchange/').find((l) => /back in your hands/i.test(l));
  assert(pulled && /\b50 rounds\b/.test(pulled),
    `pulling a lot must say what came back out of escrow: ${JSON.stringify(at('/v1/exchange/'))}`);
  const bought = at('/v1/exchange/').find((l) => /^\u{1F4CB} bought/u.test(l));
  assert(bought && /\b50 rounds\b/.test(bought),
    'buying a lot must name what ARRIVED, not just the price — rounds and crates read identically ' +
    `while it was the catch-all: ${JSON.stringify(at('/v1/exchange/'))}`);
}
// WAVE 30 — THE PAYROLL'S TOASTS. Six recurring obligations share one board (THE PAYROLL unified
// them there); their TOASTS were never swept, and driving them found the family split three ways.
//
// (1) Four of the six ECHOED. The bare catch-all `paid $N` was `else if`-chained to the EXPOSE line,
//     a different chain entirely — so it fired a SECOND time after the pad, the shark, the window and
//     the estate's staff had each already named the figure ("…square, and they keep earning · paid
//     $41,500"). Every one of those four lines was written in an earlier wave of this same session
//     and verified with `.includes()`, which cannot see a trailing echo. Worse on the estate, whose
//     money is $OMR: twelve tokens echoed back as "$12".
// (2) Two shapes of `payStaffWages` pay NOTHING, so every guard in the obligations chain (all
//     `paid > 0`) skips them — including THE WALK, the loudest thing the household can do.
// (3) The nut and the gala fell to that same catch-all: a price with the purchase left off, and for
//     the gala the wrong CURRENCY on top (the catch-all assumes cash).
//
// Driven on its own tokens because `said` is keyed by URL and the walk needs THREE presses of
// `/v1/estate/wages` against different arrears — so the lines are captured locally and asserted
// directly, while still counting into `described` and the mute sweep like every other row.
{
  const mkP = async (n, sql) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const c = (await inject('GET', '/v1/me', t)).body.character;
    await app.pool.query('UPDATE characters SET cash=9000000, respect=3000000 WHERE id=$1', [c.id]);
    await app.pool.query('UPDATE account_persistent SET omr=9000 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [c.id]);
    if (sql) await app.pool.query(sql, [c.id]);
    return { t, id: c.id }; };
  const lines = [];
  const drive = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `the wave-30 ledger could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    lines.push([label, line]);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };
  const est = await mkP('Ledger Est ');
  const back = (d) => app.pool.query(
    `UPDATE estates SET staff_paid_at = now() - interval '${d}' WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)`, [est.id]);
  await drive(est.t, 'POST', '/v1/estate/upgrade', null, 'estate tier 1');
  await drive(est.t, 'POST', '/v1/estate/upgrade', null, 'estate tier 2');   // the gala needs GALA_MIN_TIER
  await drive(est.t, 'POST', '/v1/estate/staff/butler', null, 'hire the butler');
  await drive(est.t, 'POST', '/v1/estate/wages', null, 'wages: nothing owed');
  await back('2 days');
  await drive(est.t, 'POST', '/v1/estate/wages', null, 'wages: settled');
  await back('9 days');                                                      // past ESTATE.STAFF_WALK_MS
  await drive(est.t, 'POST', '/v1/estate/wages', null, 'wages: THE WALK');
  await drive(est.t, 'POST', '/v1/estate/staff/butler', null, 'rehire the butler');
  const galaR = await drive(est.t, 'POST', '/v1/estate/gala', null, 'the gala');
  const nut = await mkP('Ledger Nut ');
  await drive(nut.t, 'POST', '/v1/kitchen/crew/hire', null, 'hire a hand');
  await app.pool.query("UPDATE characters SET crew_paid_at = now() - interval '2 days' WHERE id=$1", [nut.id]);
  await drive(nut.t, 'POST', '/v1/kitchen/crew/wages', null, 'the nut');
  const L30 = new Map(lines);
  // THE WALK. The card's own chip warns, but the toast is the moment the player is looking, and the
  // money NOT moving is exactly what needs explaining — so the line has to say they are gone AND
  // that nothing was charged, or "your staff walked" reads as a bill.
  const walk = L30.get('wages: THE WALK');
  assert(/walked|gone/i.test(walk) && /nothing charged|no(thing)? (was )?charged/i.test(walk),
    'the household walking out must say they are GONE and that nothing was charged — it is the one ' +
    `branch that pays nothing, so every paid-above-zero guard skips it: ${JSON.stringify(walk)}`);
  assert(!/let one go|corner/i.test(walk),
    `the estate walk must not read as the kitchen's crew-dismiss line — one field name, two systems: ${JSON.stringify(walk)}`);
  // THE ECHO, asserted on the one obligation this guard can drive end to end. The pattern is the
  // catch-all's own output appended to a line that already named the figure.
  const settled = L30.get('wages: settled');
  assert(/\$OMR/.test(settled) && !/ · paid \$[\d,.]+$/.test(settled),
    'the estate wage line must state the figure ONCE, in $OMR — the catch-all was chained to the ' +
    `wrong if-chain and echoed it back in dollars: ${JSON.stringify(settled)}`);
  const square = L30.get('wages: nothing owed') || '';
  assert(/square|nothing owed/i.test(square) && /\$OMR/.test(square),
    'a square book must SAY it is square and name the daily rate — reachable by pressing twice, or ' +
    `off a card that rendered before somebody else paid: ${JSON.stringify(square)}`);
  // THE GALA and THE NUT — both fluent-and-incomplete under the catch-all, so only a named claim
  // holds them: the gala's purchase is the open-doors WINDOW (and it is billed in tokens, not cash),
  // the nut's is the crew WORKING.
  const gala = L30.get('the gala'), galaBody = galaR.body;   // the reply itself: this block keeps its own, since `paidBody` is keyed by URL and wave 30 presses one URL three times
  assert(/\$OMR/.test(gala) && !/\$\d/.test(gala),
    `the gala is billed in $OMR — the catch-all assumed cash and printed a dollar sign: ${JSON.stringify(gala)}`);
  assert(gala.includes(String(galaBody?.hoursOpen ?? -1)),
    `the gala must name the window it bought, not just the price: ${JSON.stringify(gala)}`);
  const theNut = L30.get('the nut');
  assert(/nut/i.test(theNut) && /work|corner/i.test(theNut),
    `paying the nut must name what it buys — the crew working: ${JSON.stringify(theNut)}`);
}
// WAVE 34 — THE COURTROOM and THE TREATY TABLE, two whole screens on their own tokens. Neither can
// sit in ACTIONS: the courtroom needs a live indictment (and three of its five verbs END the case,
// so each press needs the case re-armed), and a treaty needs three families with two commanders.
//
// Every one of the nine was silent, and they are the two surfaces where silence costs most, because
// none of them is really about money: a plea forfeits a share of pocket AND bank — driven at
// $13,500,000 — and what it BUYS is the case being dropped; a verdict is the arc's whole point and
// read "done." either way; turning rat is a one-way, bloodline-deep brand; and a pact CHANGES THE
// RULES between two families for a week, with an honor price for breaking it early.
{
  const mkC = async (n, cash) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const c = (await inject('GET', '/v1/me', t)).body.character;
    await app.pool.query('UPDATE characters SET cash=$2, respect=3000000, energy=900, health=100 WHERE id=$1', [c.id, cash ?? 9000000]);
    await app.pool.query('UPDATE account_persistent SET omr=9000 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [c.id]);
    return { t, id: c.id }; };
  const lines = [];
  const drive = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `the wave-34 ledger could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    lines.push([label, line]);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };
  // ── the courtroom ──
  const acc = await mkC('Ledger Acc '), rival = await mkC('Ledger Rival ');
  const indict = () => app.pool.query(
    'UPDATE characters SET heat_exposure=3200, indicted_at=now(), jail_until=NULL, jury_bought=false WHERE id=$1', [acc.id]);
  await indict();
  await drive(acc.t, 'POST', '/v1/law/jury', null, 'buy the jury');
  await drive(acc.t, 'POST', '/v1/law/plea', null, 'take the plea');
  // BOTH verdicts, because the acquittal is what caught the collision the plea line introduced: the
  // trial answers the SAME {forfeited, jailSeconds} pair, so before `convicted` was made the
  // discriminator an acquittal read "you took the deal — $0 forfeited and 0s inside".
  await indict(); process.env.LAW_BUST_P = '0';
  await drive(acc.t, 'POST', '/v1/law/trial', null, 'the verdict: ACQUITTED');
  await indict(); process.env.LAW_BUST_P = '1';
  await drive(acc.t, 'POST', '/v1/law/trial', null, 'the verdict: CONVICTED');
  delete process.env.LAW_BUST_P;
  await indict();
  await drive(acc.t, 'POST', `/v1/law/flip/${rival.id}`, null, 'turn rat');
  // ── the treaty table ──
  const bossA = await mkC('Ledger Dip A '), bossB = await mkC('Ledger Dip B '), bossC = await mkC('Ledger Dip C ');
  const found = async (b, tag) => { await inject('POST', '/v1/gangs', b.t,
    { name: 'Ledger ' + tag + ' ' + Math.random().toString(36).slice(2, 6), tag });
    return (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [b.id])).rows[0]?.gang_id; };
  const gA = await found(bossA, 'DPA'), gB = await found(bossB, 'DPB'), gC = await found(bossC, 'DPC');
  await app.pool.query('UPDATE gangs SET treasury=90000000, omr_reserve=90000');
  await drive(bossA.t, 'POST', `/v1/diplomacy/pact/${gB}`, null, 'offer a pact');
  await drive(bossB.t, 'POST', `/v1/diplomacy/pact/${gA}/accept`, null, 'sign the pact');
  // the COALITION is driven BEFORE the break, because breaking a sworn pact marks the family an
  // oathbreaker and an oathbreaker cannot rally the city — found by driving them the other way round.
  await app.pool.query('UPDATE gangs SET lifetime_tribute=90000000, wars_won=500 WHERE id=$1', [gC]);
  const co = await drive(bossA.t, 'POST', `/v1/diplomacy/coalition/${gC}`, null, 'form a coalition');
  await drive(bossB.t, 'POST', `/v1/diplomacy/coalition/${co.body.id}/join`, null, 'join the coalition');
  await drive(bossB.t, 'DELETE', `/v1/diplomacy/coalition/${co.body.id}`, null, 'walk out of it');
  await drive(bossA.t, 'DELETE', `/v1/diplomacy/pact/${gB}`, null, 'break the pact');
  const L34 = new Map(lines);
  // THE PLEA — the money is only half of it, and the half a player cannot see is the case dropping.
  const plea = L34.get('take the plea');
  assert(/forfeit/i.test(plea) && /\$[\d,]{7,}/.test(plea) && /case|dropped|file/i.test(plea),
    `the plea must name the forfeiture AND that it buys the case being dropped: ${JSON.stringify(plea)}`);
  // THE VERDICT, both ways — and the acquittal must NOT read as the plea, which is the collision.
  const acq = L34.get('the verdict: ACQUITTED'), con = L34.get('the verdict: CONVICTED');
  assert(/acquit/i.test(acq) && !/took the deal/i.test(acq),
    'an acquittal must read as an acquittal — the trial answers the same {forfeited, jailSeconds} as ' +
    `the plea, so without a discriminator the best outcome in the arc reads as a plea deal: ${JSON.stringify(acq)}`);
  assert(/convicted/i.test(con) && /\$[\d,]/.test(con),
    `a conviction must name what it cost: ${JSON.stringify(con)}`);
  assert(acq !== con, 'the two verdicts must not read identically');
  // TURNING RAT — a one-way brand, and the brand is the part worth stating.
  const rat = L34.get('turn rat');
  assert(/rat/i.test(rat) && /omert|price on your head/i.test(rat),
    `flipping must name the permanent brand and what it costs you, not just that it happened: ${JSON.stringify(rat)}`);
  // THE PACT — a rule change with a term and an exit price. The accept line is the one that had no
  // counterparty at all in its reply (a bare {ok, until}), so it also pins that the NAME arrives.
  const signed = L34.get('sign the pact');
  assert(/Ledger DPA/.test(signed) && /declare|war/i.test(signed) && /oathbreak/i.test(signed),
    'signing a pact must name WHO it is with, what it forbids, and the price of breaking it — the ' +
    `reply carried only a date until the name was added at the source: ${JSON.stringify(signed)}`);
  const broke = L34.get('break the pact');
  assert(/broke|sworn/i.test(broke) && /honor/i.test(broke),
    'breaking a sworn treaty must say it was broken AND name the honor it cost — the oathbreak is a ' +
    `public, permanent mark, not a cancellation: ${JSON.stringify(broke)}`);
  assert(/coalition/i.test(L34.get('walk out of it')),
    'walking out of a coalition answered a bare {ok} — indistinguishable from every other bare ' +
    `acknowledgement in the game — so it needed a marker at the source: ${JSON.stringify(L34.get('walk out of it'))}`);
}
// WAVE 35 — THE CHAMBER'S THREE GOVERNING VERBS, and the raid that put you in hospital without
// saying so. Both halves are here because both are the same failure seen from opposite sides: a
// reply that carries the fact and a line that does not read it.
//
// The chamber needs a SEATED family (top-N by standing) and the raid needs a pinned roll, so neither
// can sit in ACTIONS — a seat is a fixture, and a raid left to the dice is the recorded flake class
// (a deterministic assertion resting on a probabilistic precondition). The rolls are pinned with the
// module's own TEST-ONLY knobs rather than by retrying until the wanted outcome turns up.
{
  const L35 = new Map();
  const mk35 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=90000000, respect=800000, health=100, loc=$2 WHERE id=$1', [id, 'neon']);
    const acc = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [id])).rows[0].account_id;
    await app.pool.query('UPDATE account_persistent SET omr=200000 WHERE account_id=$1', [acc]);
    return { t, id, acc }; };
  const drive35 = async (m, u, t, p, label) => {
    const r = await inject(m, u, t, p);
    if (r.code >= 400 || !r.body) return r;
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    L35.set(label, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${u} (${label}) → ${JSON.stringify(line)}`);
    return r; };

  const boss = await mk35('Chamber');
  await inject('POST', '/v1/gangs', boss.t, { name: 'Ledger Chamber ' + Math.random().toString(36).slice(2, 5), tag: 'LCH' });
  const cg = (await app.pool.query('SELECT id FROM gangs ORDER BY created_at DESC LIMIT 1')).rows[0];
  // seat it: `seatedGangs` ranks on THIS season's showing, so both columns are set (the econ-pass fix
  // made the ladder seasonal precisely so a seat has to be re-bought — seeding only the lifetime one
  // leaves the family unseated and all three verbs 4xx into a silent skip)
  await app.pool.query('UPDATE gangs SET treasury=50000000, lifetime_tribute=90000000, season_tribute=90000000, wars_won=9, season_wars=9 WHERE id=$1', [cg.id]);
  await drive35('POST', '/v1/commission/vote', boss.t, { decree: 'pax' }, 'the ballot');
  await drive35('POST', '/v1/commission/ticker', boss.t, { ticker: 'AAPL' }, 'the stock pick');
  await drive35('POST', '/v1/commission/propose', boss.t, { decree: 'amnesty' }, 'move a motion');

  const ballot = L35.get('the ballot');
  // The timing is the load-bearing half: the chamber tallies THIS week to govern the NEXT, so a
  // player who votes and then reads the decree in force sees the old one and concludes it did not
  // land. The seat WEIGHT is the other fact a bare acknowledgement cannot carry.
  assert(/pax/.test(ballot) && /next week/i.test(ballot) && /weight/i.test(ballot),
    'the ballot must name the decree, the seat weight it carries, and that it governs NEXT week — ' +
    `all three are in the reply and none of them were read: ${JSON.stringify(ballot)}`);
  const pick = L35.get('the stock pick');
  assert(/AAPL/.test(pick) && /tomorrow|buys/i.test(pick),
    `the daily stock ballot must name the pick and when the treasury acts on it: ${JSON.stringify(pick)}`);
  const motion = L35.get('move a motion');
  // A six-figure TREASURY stake with a forfeit condition, and — the part invisible from the button —
  // once any motion is on the table the tally filters ballots to what was MOVED, so proposing sets
  // the ballot rather than merely adding to it.
  assert(/\$[\d,]/.test(motion) && /treasury/i.test(motion) && /forfeit/i.test(motion) && /moved/i.test(motion),
    'moving a motion stakes the TREASURY and only comes back if this motion is the one enacted — and ' +
    `it sets the ballot. A cash figure must also carry its $: ${JSON.stringify(motion)}`);

  // THE REPEL. Three shapes, one generic fallback. The solo world raid dropped the hospital term its
  // own CO-OP sibling states; the NPC-family repel had that fallback stapled in front of its real
  // sentence; and a successful counter-raid ran two sentences together with no stop between them.
  const raider = await mk35('Repelled');
  process.env.WORLD_RAID_P = '0';
  await drive35('POST', '/v1/world/dockrats/raid', raider.t, null, 'the raid that failed');
  delete process.env.WORLD_RAID_P;
  const solo = L35.get('the raid that failed');
  assert(/hospital/i.test(solo) && /\d+m/.test(solo) && !/it went sideways/.test(solo),
    'a repelled raid puts you in hospital for twenty minutes — the reply says so and the line said ' +
    `only "it went sideways", so you found out when the next thing you tried refused: ${JSON.stringify(solo)}`);

  const warrior = await mk35('Warlike');
  await inject('POST', '/v1/gangs', warrior.t, { name: 'Ledger War ' + Math.random().toString(36).slice(2, 5), tag: 'LWR' });
  const wg = (await app.pool.query('SELECT id FROM gangs ORDER BY created_at DESC LIMIT 1')).rows[0];
  await app.pool.query('UPDATE gangs SET treasury=9000000 WHERE id=$1', [wg.id]);
  // An NPC family is a WORKER artifact (runPopulation founds them), and the worker never runs here,
  // so one is seeded when the fixture has none — otherwise both drives below 404 and both assertions
  // skip in SILENCE, which is exactly what happened: the first cut of this block also had the route
  // wrong (/v1/npcwar/ where the server mounts /v1/npcfamily/), and BOTH mutations survived a green
  // run, because a skipped assertion reads on the summary line exactly like a covered one. Nothing
  // in this block is conditional now — a drive that does not land is a failure, not a shrug.
  const npcFam = (await app.pool.query('SELECT id FROM gangs WHERE npc_flag LIMIT 1')).rows[0]
    || await (async () => {
      const ghost = await mk35('Ghostfam');
      await inject('POST', '/v1/gangs', ghost.t, { name: 'The Ledger Ghosts ' + Math.random().toString(36).slice(2, 5), tag: 'LGH' });
      const row = (await app.pool.query('SELECT id FROM gangs ORDER BY created_at DESC LIMIT 1')).rows[0];
      await app.pool.query('UPDATE gangs SET npc_flag=true, treasury=9000000 WHERE id=$1', [row.id]);
      return row;
    })();
  assert(npcFam, 'no NPC family to raid — both repel assertions below would skip in silence');
  process.env.FAMILY_RAID_P = '0';
  await drive35('POST', `/v1/npcfamily/${npcFam.id}/raid`, warrior.t, null, 'repelled by the family');
  process.env.FAMILY_RAID_P = '1'; process.env.FAMILY_COUNTER = 'on';
  // the raid charges energy, ammo and a per-crew COOLDOWN win or lose, so a second drive is
  // refused unless all three are put back — and a refusal here is a silent skip, which is the whole
  // reason this block stopped being conditional
  await app.pool.query('UPDATE characters SET hosp_until=NULL, energy=50, health=100, ammo=500, family_raid_at=NULL WHERE id=$1', [warrior.id]);
  await drive35('POST', `/v1/npcfamily/${npcFam.id}/raid`, warrior.t, null, 'raided and caught leaving');
  delete process.env.FAMILY_RAID_P; delete process.env.FAMILY_COUNTER;
  const rep = L35.get('repelled by the family');
  assert(rep, 'the repelled raid never drove — a skipped drive reads exactly like a covered one');
  // Assert the PROPERTY, not the wording. The first cut tested for the old filler text — but the
  // OTHER half of this fix changed what that branch emits, so the echo came back saying something
  // else and the check read clean over it. What is wrong is that one event is narrated TWICE, so
  // count the hospital: a repel says it once.
  assert((rep.match(/hospital/gi) || []).length === 1 && /repelled/i.test(rep) && /\d+m/.test(rep),
    'an NPC-family repel has its OWN sentence, so the generic filler was stapled in front of it ' +
    '("it went sideways · X repelled the raid") — the hospital must be narrated ONCE, and with the ' +
    `number the reply already carries: ${JSON.stringify(rep)}`);
  const caught = L35.get('raided and caught leaving');
  assert(caught, 'the counter-raid never drove — a skipped drive reads exactly like a covered one');
  // the run-on: the `countered` clause opens with a space and what precedes it ends with no stop,
  // so the ordinary success reads "…off their war chest Their guns caught you leaving"
  assert(!/chest Their/.test(caught) && /hospital/i.test(caught),
    `a successful raid whose counter caught you must not run two sentences together: ${JSON.stringify(caught)}`);
}

// ── WAVE 36 — THE SPEAKEASY'S FOUR, THE TUNE, AND THE THREE ESCROWS THAT CAME BACK IN SILENCE.
// Everything here was found by opening a club and running it for a night. It sits in its own block
// rather than in ACTIONS because the cluster is TWO-PARTY (a patron is not the owner, and the owner
// cannot buy a round at his own joint) and needs a second funded, MADE token — ACTIONS drives one.
//
// The four in the club are one class each. The bar take is NET of a twenty-percent cut for
// protection and wages that the reply has always carried and the line never said — the pad and the
// nut exactly, on the button an owner presses daily. The round and the bottle are prices left off a
// purchase. And the round, the standover and the buyout were all ECHOES: the bare-figure catch-all
// fired alongside a branch that had already spoken, so the standover and the buyout each printed
// the same number twice in one sentence. That catch-all is now guarded on `!bits.length` at the very
// end of describe(), which is why this block asserts the SHAPE ("no line may open with a bare price
// followed by a separator") rather than three separate wordings: the guard is against the class.
{
  const L36 = new Map();
  const mk36 = async (name) => {
    const g = await inject('POST', '/v1/auth/guest', null, {});
    const c = await inject('POST', '/v1/character', g.body.token, { name });
    return { t: g.body.token, id: c.body?.character?.id || c.body?.id };
  };
  const drive36 = async (m, p, t, body, label) => {
    const r = await inject(m, p, t, body);
    assert(r.code < 400, `WAVE 36: ${label} did not drive (${r.code} ${r.body?.error || ''}) — a skipped drive reads exactly like a covered one`);
    const line = describeFn(r.body, r.code);
    L36.set(label, line); described++;
    if (line === '\u2713 done.' || /^paid \$[\d,.]+$/.test(line)) mute.push(`${m} ${p}`);
    return r;
  };
  // `neon` and `cathedral` already have clubs by the time this block runs (two earlier blocks open
  // them), and a district holds ONE — so a fixed district here answers `taken` and the whole block
  // skips. Take the first district still free rather than hard-coding a fourth guess that the next
  // block to open a club will invalidate.
  const CLUB_D = (await (async () => {
    const held = new Set((await app.pool.query('SELECT district_id FROM speakeasies')).rows.map((r) => r.district_id));
    return ['foundry', 'brick', 'canal', 'docks', 'neon', 'cathedral'].find((d) => !held.has(d));
  })());
  assert(CLUB_D, 'WAVE 36: every district already has a club — nowhere to open one');
  const owner = await mk36('Club ' + Math.random().toString(36).slice(2, 7));
  const patron = await mk36('Patron ' + Math.random().toString(36).slice(2, 7));
  // A club needs a MADE owner (the D8=D door), so the subscription is seeded rather than bought —
  // buying it is its own tested path and is not what this block is about.
  for (const who of [owner, patron]) {
    await app.pool.query('UPDATE characters SET cash=90000000, respect=9000000, energy=200, nerve=200, health=100, loc=$2 WHERE id=$1', [who.id, CLUB_D]);
    await app.pool.query('UPDATE account_persistent SET omr=90000, minted=true, made_until=$2 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [who.id, new Date(Date.now() + 60 * 864e5)]);
  }
  await drive36('POST', `/v1/speakeasy/${CLUB_D}/open`, owner.t, null, 'open the club');
  // ten hours of takings, so the cut is a real number rather than a rounding artifact
  await app.pool.query("UPDATE speakeasies SET income_at=now() - interval '10 hours' WHERE district_id=$1", [CLUB_D]);
  const take = await drive36('POST', '/v1/speakeasy/collect', owner.t, null, 'collect the bar take');
  assert(take.body.upkeep > 0 && take.body.gross > take.body.collected,
    'WAVE 36 precondition: the club must actually owe a cut on this take, or the assertion below is vacuous');
  assert(new RegExp(fmtLike(take.body.upkeep)).test(L36.get('collect the bar take')) &&
         new RegExp(fmtLike(take.body.gross)).test(L36.get('collect the bar take')),
    'the bar take is NET of a standing cut for protection and wages, and the owner was shown only ' +
    'the net — the same withheld term as the pad and the nut, on a daily button: ' + JSON.stringify(L36.get('collect the bar take')));
  const round = await drive36('POST', `/v1/speakeasy/${CLUB_D}/round`, patron.t, { round: 'topshelf' }, 'buy a round');
  assert(new RegExp(fmtLike(round.body.paid)).test(L36.get('buy a round')),
    `a round must name what LEFT YOUR POCKET, not only the owner's cut: ${JSON.stringify(L36.get('buy a round'))}`);
  const bottle = await drive36('POST', `/v1/speakeasy/${CLUB_D}/bottle`, patron.t, { bottle: 'magnum' }, 'bottle service');
  assert(new RegExp(`${fmtLike(bottle.body.spent)}\\s*\\$OMR`).test(L36.get('bottle service')),
    `bottle service is a $OMR burn and named no price at all: ${JSON.stringify(L36.get('bottle service'))}`);
  // THE ECHO, asserted as a class. Every line in this block goes through the same check: a bare
  // price followed by a separator is the catch-all having spoken over a branch that already had.
  for (const [label, line] of L36)
    assert(!/^paid \$[\d,]+ \u00b7 /.test(line), `WAVE 36: "${label}" opens with the bare-figure catch-all ` +
      `stapled in front of a line that already spoke — that fallback must be a LAST resort: ${JSON.stringify(line)}`);

  // THE TUNE — the one buy in the racing system that named no price, while its own neighbours (the
  // nitrous, the boat refit) both do. It is not a constant either: the Wheelman mastery discounts it.
  const driver = await mk36('Driver ' + Math.random().toString(36).slice(2, 7));
  await app.pool.query('UPDATE characters SET cash=90000000, respect=9000000, energy=200, nerve=200, health=100, loc=$2 WHERE id=$1', [driver.id, 'docks']);
  for (let i = 0; i < 30 && !(await app.pool.query('SELECT 1 FROM cars WHERE character_id=$1', [driver.id])).rowCount; i++) {
    await inject('POST', '/v1/garage/boost', driver.t, null);
    await app.pool.query('UPDATE characters SET gta_at=NULL, jail_until=NULL, energy=200 WHERE id=$1', [driver.id]);
  }
  const wheels = (await app.pool.query('SELECT id FROM cars WHERE character_id=$1 LIMIT 1', [driver.id])).rows[0];
  assert(wheels, 'WAVE 36: no car to tune — the assertion below would skip in silence');
  const tuned = await drive36('POST', `/v1/races/tune/${wheels.id}`, driver.t, null, 'tune the car');
  assert(new RegExp(fmtLike(tuned.body.spent)).test(L36.get('tune the car')),
    `a tune is a repeatable cash sink whose price climbs, and it named none: ${JSON.stringify(L36.get('tune the car'))}`);

  // THREE ESCROWS COMING BACK. The market's was the only one that spoke; the shark's offer and a hit
  // contract's stake each said "done." over five and six figures, and a queued $OMR withdrawal was
  // WORSE than silent — `cancelled` reads as truthy, so the market's branch claimed it and rendered
  // TOKENS as DOLLARS in the market's own words. Each is asserted for its own currency and voice.
  const offer = await inject('POST', '/v1/loans', owner.t, { amount: 50000, rate: 0.2, hours: 24 });
  assert(offer.code < 400 && offer.body.id, 'WAVE 36: the loan offer never posted');
  const pulled = await drive36('POST', `/v1/loans/${offer.body.id}/cancel`, owner.t, null, 'pull a loan offer');
  assert(new RegExp(fmtLike(pulled.body.refunded)).test(L36.get('pull a loan offer')),
    `pulling a loan offer returns the whole escrowed principal and said nothing: ${JSON.stringify(L36.get('pull a loan offer'))}`);
  const mark = await mk36('Mark ' + Math.random().toString(36).slice(2, 7));
  await app.pool.query('UPDATE characters SET respect=900000 WHERE id=$1', [mark.id]);
  const posted = await inject('POST', `/v1/streets/${mark.id}/bounty`, owner.t, { amount: 60000, kind: 'kill' });
  assert(posted.code < 400, `WAVE 36: the contract never posted (${posted.body?.error})`);
  const stake = await drive36('POST', `/v1/contracts/${mark.id}/kill/cancel`, owner.t, null, 'pull a contract stake');
  assert(new RegExp(fmtLike(stake.body.refunded)).test(L36.get('pull a contract stake')),
    `pulling your stake off a hit contract said nothing about the money: ${JSON.stringify(L36.get('pull a contract stake'))}`);
  // The withdrawal is seeded as a row rather than driven through /v1/withdraw, which needs a live
  // chain — the route under test only reads the row, and what is being asserted is the SENTENCE.
  const acct = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [owner.id])).rows[0].account_id;
  await app.pool.query(
    `INSERT INTO vouchers (id, account_id, kind, amount, nonce, deadline, status, to_address)
     VALUES ($1,$2,'omr',12,987654,$3,'queued','0x0000000000000000000000000000000000000001')`,
    ['wave36-voucher', acct, new Date(Date.now() + 864e5)]);
  await drive36('POST', '/v1/withdraw/wave36-voucher/cancel', owner.t, null, 'cancel a queued withdrawal');
  const wd = L36.get('cancel a queued withdrawal');
  assert(/\$OMR/.test(wd) && !/\$12\b/.test(wd) && !/off the board/.test(wd),
    'a cancelled $OMR withdrawal rendered its TOKENS as DOLLARS, in the Black Market\'s words, ' +
    `because \`cancelled\` is truthy and the market's branch claimed the shape: ${JSON.stringify(wd)}`);
}
// THE KITCHEN'S TWO PURCHASES, driven in ACTIONS above. Both are named claims because both silence
// patterns read straight past a line that is fluent: a hire that says only what it cost is a true
// sentence about an ongoing obligation it never mentions.
{
  const hire = said.get('/v1/kitchen/crew/hire');
  assert(hire && /nut/i.test(hire) && /\/hr/.test(hire),
    'hiring a corner man must name the NUT it starts — the wage runs whether the stash moves or ' +
    `not, and three days unpaid they down tools: ${JSON.stringify(hire)}`);
  const mod = said.get('/v1/kitchen/module/purity');
  assert(mod && /cook quality/i.test(mod),
    `a lab module must say what it buys, not just what it cost: ${JSON.stringify(mod)}`);
}

// A WRONG line is invisible to the two silence patterns above: "laid $830" is a real sentence, it is
// simply not true of a 10 $OMR spend. The monument takes cash, freight and $OMR and credits all three
// in dollars, so the rail that is not cash has to name what actually left the player.
const traceLine = said.get('/v1/wire/trace');
if (traceLine) assert(/still listening/i.test(traceLine) && !/swept/i.test(traceLine),
  `the trace must say the taps are still live and name who is on the line — it is not the sweep, and it costs three times as much: ${JSON.stringify(traceLine)}`);

// The four INVERSIONS. Each is a real sentence about a real system — just not the one the player is
// looking at — so both silence patterns read straight past them and only a named claim can hold them.
const invert = [
  [/\/v1\/assets\/[^/]+\/sell$/, /is yours/i, 'selling an asset must not say it is YOURS — that is the buy line, and the sale price goes with it'],
  ['/v1/loans', /took the loan/i, 'posting an offer is the LENDER escrowing their own money — it must not tell them they took a loan and owe it back'],
  [/\/v1\/estate\/staff\/[^/]+$/, /let one go|walks/i, 'hiring household staff must not read as firing a kitchen hand'],
  [/\/v1\/port\/collect\//, /collected \$/i, 'a Coast Guard interdiction seizes CARGO — reporting it as dollars collected is the loan shark\'s line and the wrong unit'],
  // TWO wrong lines on one verb, in sequence — which is why both are pinned rather than just the
  // second: pulling a street off the market first read as a RENAME (a bare {ok, name}), and the
  // obvious fix (a bare `listed:false`) then read as leaving the DUELLING LADDER. A marker only
  // disambiguates if it names the system, not the state.
  ['/v1/deeds/unlist', /has a name now|off the ladder/i,
    'pulling a deed off the market is neither a rename nor leaving the duelling ladder — it collided with both'],
];
for (const [key, wrong, why] of invert) {
  for (const [url, line] of said) {
    if (typeof key === 'string' ? url !== key : !key.test(url)) continue;
    assert(!wrong.test(line), `${why} — got: ${JSON.stringify(line)}`);
  }
}
// Nothing a player reads may ever contain the literal word "undefined". Hiring staff printed it twice,
// because the branch it landed on read two fields that shape never sends.
for (const [url, line] of said) assert(!/undefined/.test(line),
  `describe() rendered the literal word "undefined" to the player for ${url}: ${JSON.stringify(line)}`);
// Nor may a line stack an article on a name that already carries one. Every secret in the game is
// called "The <something>" (The Wash Records, The Bodies, The Kitchen Books, The Second Ledger), so
// the hush line's own "The ${kind}" read "The The Wash Records" on every payment ever made — not an
// edge case, and invisible to every pattern above because it is fluent. Swept rather than pinned at
// the one site: the catalogs that start with an article are not going to stop growing.
// NOR AN HTML ENTITY. Every consumer of describe() is toast(), which assigns to textContent — so an
// HTML-escaped string is not safer there, it is simply WRONG, and it lands on exactly the names that
// most need to read right: 94 catalog names carry an apostrophe or an ampersand (Motorcycle 'Wasp',
// A Dead Don's Watch, The Doc's Friend) and the street-name charset guard allows both, so a player
// called O'Malley was toasted as O&#39;Malley on every line that named them. Swept rather than pinned
// at the one site that surfaced it, because the catalogs are not going to stop growing.
for (const [url, line] of said) assert(!/&(?:amp|lt|gt|quot|#\d+);/.test(line),
  `describe() rendered an HTML entity to the player for ${url} — its output goes to textContent, so ` +
  `escaping corrupts the name instead of protecting anything: ${JSON.stringify(line)}`);
for (const [url, line] of said) assert(!/\bThe The\b/i.test(line),
  `describe() stacked an article on a name that already had one for ${url} — the catalog entry ` +
  `already begins with "The": ${JSON.stringify(line)}`);

// THE PRICE IS A TERM. Six Wire actions burn $OMR and five of them named nothing, so a player pressed
// them without ever learning what a tap or a dig had just cost — the pad-and-nut shape on a screen
// where every button spends. `disinfo` already did it right, which is what makes the other five a
// drift rather than a design.
//
// Crossed against the REPLY'S OWN `spent`, never against the lever — and that distinction is not
// pedantry, it is what the first cut of this assertion got wrong and what the run then taught me:
// the spymaster's rank discount is live, so a tap billed at a list price of 48 actually charged 24
// on a character who had already worked the wires. Pinning the lever would have demanded the line
// state a price the till does not charge, which is the restatement class arriving inside the guard
// meant to catch it. The line must name what LEFT, so the same regex holds at any rank.
const priced = [
  ['/v1/wire/subscribe', 'a Wire subscription'], ['/v1/wire/tap/', 'a wiretap'],
  ['/v1/wire/informant/', 'an informant retainer'], ['/v1/wire/dig/', 'a dig through their trash'],
  // the watch is here to pin the SERVER half: its reply carried no `spent` at all, so the client was
  // structurally unable to name the price. Guarding only the client's wording left that mutation
  // alive — the sentence still read fine with the number gone.
  ['/v1/wire/watch/', 'a standing watch'],
  ['/v1/wire/sweep', 'a sweep of your own lines'],
  // the trace is here for the OTHER reason: it is the entry that was silently skipped, and counting
  // it in the floor is what stops that recurring. Its own wrong-line assertion lives in `invert`.
  ['/v1/wire/trace', 'a trace of who is listening'],
];
let pricedSeen = 0;
for (const [key, what] of priced) {
  for (const [url, line] of said) {
    if (!url.startsWith(key)) continue;
    const spent = Number(paidBody.get(url)?.spent);
    assert(spent > 0, `${what} was expected to CHARGE and did not (spent=${JSON.stringify(paidBody.get(url)?.spent)}) — ` +
      'a free action proves nothing about whether a paid one names its price');
    pricedSeen++;
    assert(new RegExp(`\\b${spent}\\b`).test(line),
      `${what} just cost ${spent} $OMR and the line a player reads never says so — a price is a TERM, not ` +
      `flavour, and its own sibling (disinfo) has stated both price and clock all along. Got: ${JSON.stringify(line)}`);
  }
}
assert(pricedSeen >= priced.length, `only ${pricedSeen} of the ${priced.length} priced Wire actions drove — ` +
  'a skipped action reads on the summary line as covered, which is how two fixes in this file survived their own mutation');
// AND THE UNIT. minsTxt stopped at hours, so a 7-day informant retainer read "168h" and a 14-day
// subscription "336h" — right numbers, in a unit nobody counts in at that scale (found by reading the
// Wire's own toasts). Under 48h hours ARE how people think, so the tier starts there; this pins the
// long end, where the whole point is that a player can tell a week from a fortnight at a glance.
const infLine = [...said].find(([u]) => u.startsWith('/v1/wire/informant/'))?.[1];
assert(infLine && /\d+d\b/.test(infLine) && !/\b1\d\dh\b/.test(infLine),
  `a week-long retainer must read in DAYS, not in three digits of hours. Got: ${JSON.stringify(infLine)}`);
// and the standing watch's own term: it is the only one that keeps spending after you press it
const watchLine = [...said].find(([u]) => u.startsWith('/v1/wire/watch/'))?.[1];
assert(watchLine && /keeps? spending|renew/i.test(watchLine),
  `a standing watch burns the tap price again on every renewal — an ongoing cost the player has to be ` +
  `told at the moment they take it on. Got: ${JSON.stringify(watchLine)}`);

const megaLine = said.get('/v1/megaproject/omr');
if (megaLine) assert(/\$OMR/.test(megaLine) && /\b10\b/.test(megaLine),
  `the $OMR rail into the monument must name the $OMR that left, not the wall's dollar credit — got: ${JSON.stringify(megaLine)}`);

// THE TERMS on the three highest-stakes consents wave 9 found silent. A silence pattern reads
// straight past a line that is fluent and INCOMPLETE, which is why each of these is named: pinks is
// the one consent in the game where losing hands over the car, the manifest minimum is what a
// shipper used to first hear at departure (after the trunk was already spent), and a crew score's
// stake is fronted and comes back only on a pre-execution disband.
const pinkLine = [...said].find(([u]) => u.includes('/races/pinkslip/'))?.[1];
assert(pinkLine && /lose/i.test(pinkLine) && /THEIRS|title/i.test(pinkLine),
  `putting a car up for PINKS is the only consent in the game where a loss hands the car over — the ` +
  `line has to say so. Got: ${JSON.stringify(pinkLine)}`);
const loadLine = said.get('/v1/convoy');
assert(loadLine && /\b5\b/.test(loadLine) && /short|needs/i.test(loadLine),
  `a convoy refuses to roll under the BULK minimum, and the manifest total lives on the convoy — only ` +
  `the server can say how far short a load is, so it has to. Got: ${JSON.stringify(loadLine)}`);
// CALLED IT OFF. Two things happen and the player was told neither: the whole manifest comes back
// off the truck into the trunk, and nothing is on the road any more.
const cancelLine = said.get('/v1/convoy/cancel');
assert(cancelLine && /\b4\b/.test(cancelLine) && /trunk/i.test(cancelLine),
  `calling off a shipment puts the manifest back in the trunk — the line has to say how much came ` +
  `back, not "done." Got: ${JSON.stringify(cancelLine)}`);
// A DISTRICT ID IS NOT A DISTRICT. describe() resolves ids to names through $dist() at three sites
// and printed a raw one here — because $dist was DECLARED BELOW this branch, so it sat in the TDZ
// and could not have been called from it. A helper declared after its first would-be caller is a
// helper that silently is not available to it.
const favorLine = said.get('/v1/favors');
assert(favorLine && new RegExp(GOODS[1] ? GOODS[1].name : GOODS[0].name).test(favorLine),
  `putting work out must name the GOOD, which only the catalog knows. Got: ${JSON.stringify(favorLine)}`);
assert(favorLine && /Neon/i.test(favorLine) && !/\bneon\b/.test(favorLine),
  `a player reads district NAMES — "The Neon Mile", never the wire's id. Got: ${JSON.stringify(favorLine)}`);
// A RACE IS NOT A FIGHT, AND THE PURSE IS ONE NUMBER. The score line is shared across three sports
// (deliberately — it carries the margin, which is what a manager acts on), so it stamped a
// greyhound's win with a boxing glove; and the sport's own line then repeated the same money, so the
// toast read "+$4,000 · … +$4,000 purse". Both halves asserted, because the icon fix leaves the echo.
const circuitLine = [...said].find(([u]) => u.includes('/stable/circuit/'))?.[1];
assert(circuitLine && /WON/.test(circuitLine),
  `the circuit action must have DRIVEN and WON — the dog is seeded past the maiden's field on purpose, ` +
  `because a win-only assertion behind a coin flip is a check that can decline to run. Got: ${JSON.stringify(circuitLine)}`);
{
  assert(!/\u{1F94A}/u.test(circuitLine),
    `a greyhound's race must not be stamped with a boxing glove — the score line is shared across ` +
    `sports, so it has to follow the game. Got: ${JSON.stringify(circuitLine)}`);
  const money = circuitLine.match(/\$[\d,]+/g) || [];
  assert(new Set(money).size === money.length,
    `the purse is stated once — the shared score line already carries it, so the sport's own line must ` +
    `not repeat the same figure. Got: ${JSON.stringify(circuitLine)}`);
}
// WAVE 10's OWN TERMS. Each is fluent-and-incomplete rather than silent, so only a named claim holds it.
// Protection is the sharpest: it is the yard's safehouse, and it carries the same shield-NOT-bunker rule
// the street one does — six figures buys immunity AND takes your own shank away, which a player has to
// be told before they press it, not after they try to use the shiv they just bought.
const protLine = said.get('/v1/pen/protection');
assert(protLine && /can'?t shank|not shank/i.test(protLine),
  `the yard boss's protection is shield-not-bunker — it stops you shanking anybody too, the same rule ` +
  `the street safehouse carries. Got: ${JSON.stringify(protLine)}`);
// Working the yard pays money AND time, and the TIME is the whole point of good behaviour — the line
// stated the cash alone, which is the half a player already sees on their sheet.
const yardLine = said.get('/v1/pen/work');
assert(yardLine && /off the stretch|off the sentence/i.test(yardLine) && /left/i.test(yardLine),
  `working the yard shaves the sentence — the money is the half a player can already see, the clock is ` +
  `the half only the server knows. Got: ${JSON.stringify(yardLine)}`);
// The club's decor upgrade sweeps the till at the OLD rate before it charges. Both halves are terms,
// and this is the one that landed on the collect branch and read as an empty till.
const decorLine = said.get('/v1/speakeasy/upgrade');
assert(decorLine && /\$/.test(decorLine) && !/nothing in the till/i.test(decorLine),
  `a decor build-out is a six-figure purchase, not a collect — it carries \`collected\` (the pending ` +
  `swept at the old rate) and fell into the empty-till line. Got: ${JSON.stringify(decorLine)}`);
// PULLING THE CLUB OFF THE MARKET. Listing it read fine; the reply to the pull was `{ok, district}`
// and nothing else, so the branch could not tell it from any other district-scoped acknowledgement
// and a nine-figure listing came off the market reading "done." The fix is at the SOURCE — the
// server sends `salePrice: null` so one branch renders both senses — and BOTH are asserted, because
// a branch that renders only the off direction is the same bug facing the other way.
const clubOn = said.get('/v1/speakeasy/list'), clubOff = said.get('/v1/speakeasy/unlist');
assert(clubOn && /on the market/i.test(clubOn) && /\$/.test(clubOn),
  `listing the club has to name the price it is listed at. Got: ${JSON.stringify(clubOn)}`);
assert(clubOff && /off the market/i.test(clubOff) && !/\$[0-9]/.test(clubOff),
  `pulling the club back is the opposite of listing it and must read that way, with no price left ` +
  `standing in the line. Got: ${JSON.stringify(clubOff)}`);
// THE MENTOR — the arc that exists to make a newcomer's first contact with a real player a good one,
// and every route in it said "done." The two that MOVE MONEY are asserted hardest: a claim pays cash
// and a graduation ends the tie, and both were reporting nothing at all.
const mSeek = said.get('/v1/mentor/seeking'), mAcc = [...said].find(([u]) => u.startsWith('/v1/mentor/accept/'));
const mGift = [...said].find(([u]) => u.startsWith('/v1/mentor/gift/')), mClaim = said.get('/v1/mentor/claim');
assert(mSeek && /looking/i.test(mSeek), `flagging for a mentor has to say the word is out. Got: ${JSON.stringify(mSeek)}`);
assert(mAcc && /mentor/i.test(mAcc[1]) && !/^\W*done/i.test(mAcc[1]),
  `accepting a mentor forms a permanent account-level tie and names who it is with. Got: ${JSON.stringify(mAcc && mAcc[1])}`);
assert(mGift && /\$/.test(mGift[1]),
  `a care package is the mentor's OWN cash — the line names what left their pocket. Got: ${JSON.stringify(mGift && mGift[1])}`);
assert(mClaim && /\$/.test(mClaim) && /level/i.test(mClaim),
  `the protégé's claim PAYS, and says which rung it paid for — it was reporting a real payment as ` +
  `"done." Got: ${JSON.stringify(mClaim)}`);
// THE WORKSHOP. Rolling ammo named the rounds; crafting a consumable and USING one both said "done.",
// and the use reply carries the effect verbatim — the player was told nothing while holding the answer.
const craftLine = said.get('/v1/workshop/craft/medkit'), useLine = said.get('/v1/items/medkit/use');
assert(craftLine && /field kit/i.test(craftLine) && /heal/i.test(craftLine),
  `crafting names what was made and what it does — the catalog is already client-side. Got: ${JSON.stringify(craftLine)}`);
assert(useLine && /heal/i.test(useLine),
  `using a consumable states the effect the reply already carries. Got: ${JSON.stringify(useLine)}`);
// CONSENT-BY-LISTING, both directions — the guard once required a `price` the OFF reply does not
// carry, so the comment claimed both and the code admitted one.
const bgOff = paidBody.get('/v1/bodyguard/offer') && said.get('/v1/bodyguard/offer');
assert(bgOff && /off the market|nobody can hire/i.test(bgOff),
  `taking yourself off the protection market is the whole difference between being for hire and not, ` +
  `and it read "done." Got: ${JSON.stringify(bgOff)}`);
// THE FAMILY VERBS. Joining is a ONE-WAY move under omertà; taking turf and naming the watch each
// moved six figures and carried four terms apiece; and the territory ladder both said nothing at
// tier 1 and, at tier 2, said the SPEAKEASY's line — the two upgrade replies are one field apart
// ({district,tier,name,collected} + `spent` for the club, + `kind` for the racket), so the club's
// guard matched both and printed the club's own `spent` as "$undefined" over a racket.
// the client's own `fmt` — grouped, at most two decimals — so a figure is crossed against the line
// in the shape the player actually reads, not the raw integer
const asMoney = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const joinLine = said.get([...said.keys()].find((u) => /^\/v1\/gangs\/[^/]+\/join$/.test(u)) || '');
assert(joinLine && /omert/i.test(joinLine),
  `joining a family puts you under omertà — a rule about what you can no longer do, and the one term ` +
  `nothing else on that screen states. It read "done." Got: ${JSON.stringify(joinLine)}`);
const seizeLine = said.get('/v1/districts/docks/seize'), seizeBody = paidBody.get('/v1/districts/docks/seize');
assert(seizeLine && /garrison/i.test(seizeLine) && seizeLine.includes(asMoney(seizeBody.cost)),
  `taking turf states what left the treasury AND the garrison that now stands behind it. Got: ${JSON.stringify(seizeLine)}`);
// …and states them as TWO FACTS. `cost` is the base+premium AFTER every discount the attacker
// brought; `garrison` is the UNDISCOUNTED base, so a cheap liberation installs a garrison LARGER
// than it paid and the first draft's "$45,000 of that" read against a $33,750 cost. Fluent and
// false is worse than silent, and only driving it catches the arithmetic.
assert(!/of (that|it)\b/i.test(seizeLine),
  `the garrison is not a PART of what was paid — a discount prices the conquest, not the ground, so ` +
  `the two figures are independent and "of that" is false whenever any discount applied. ` +
  `Got: ${JSON.stringify(seizeLine)} over cost ${seizeBody.cost} / garrison ${seizeBody.garrison}`);
const turfWatchLine = said.get('/v1/districts/docks/watch'), watchBody = paidBody.get('/v1/districts/docks/watch');
assert(turfWatchLine && turfWatchLine.includes(String(watchBody.surpriseMult)),
  `the watch is a COMMITMENT and the surprise premium is the whole point of making it — a line that ` +
  `stops at "watch set" withholds the number that makes it a decision. Got: ${JSON.stringify(turfWatchLine)}`);
const estLine = said.get('/v1/territory/docks/establish'), estBody = paidBody.get('/v1/territory/docks/establish');
assert(estLine && estLine.includes(asMoney(estBody.spent)) && estLine.includes(asMoney(estBody.incomePerHr)),
  `establishing an operation is a five-figure treasury spend and the income is the thing bought — ` +
  `both ride with the price. Got: ${JSON.stringify(estLine)}`);
const upgLine = said.get('/v1/territory/docks/upgrade'), upgBody = paidBody.get('/v1/territory/docks/upgrade');
assert(upgLine && /\u{1F3D9}/u.test(upgLine) && upgLine.includes(asMoney(upgBody.spent)),
  `the racket upgrade must read as the RACKET, not the club — the club's branch matched it and ` +
  `printed a price the racket never sends. Got: ${JSON.stringify(upgLine)}`);
// and the CLUB's own line, driven on its own token in the wave-10 block, must still read as the club
assert((said.get('/v1/speakeasy/upgrade') || '').includes('\u{1F37E}'),
  `…and the fix must not have taken the club's own upgrade line with it. Got: ${JSON.stringify(said.get('/v1/speakeasy/upgrade'))}`);
// MUTUALLY EXCLUSIVE, not merely ordered. Giving the racket the `spent` it was missing fixes the
// "$undefined" and NOT the collision: the club's guard still matches a racket reply, so the two
// would be separated only by which line sits higher — a property nobody can see while editing one of
// them. Asserted at the source because line order is exactly what a future edit moves.
assert(/body\.district && !body\.kind && body\.collected !== undefined && body\.spent !== undefined/.test(html),
  "the club's upgrade branch must EXCLUDE a business `kind` — a racket reply matches every other " +
  'clause it tests, so without that the two lines are one reordering away from colliding again');
// THE LADDER HAS A CONTROL AT ALL. `fortify` was priced on the family card and `upgrade` reachable
// only through the raw API deck, so a family that established at tier 1 had no way in the game to
// climb. A priced button needs its price from the SAME ladder the till charges from.
assert(/data-do="POST \/v1\/territory\/\$\{op\.district\}\/upgrade"/.test(html),
  'the territory tier ladder has no client control — the operation can be established and fortified but never climbed');
assert(/op\.nextTier\.cost/.test(html),
  'the upgrade button must quote the price the server publishes on the same board, not a constant');

// and the club NAME burns $OMR while every other `spent` in the game is dollars — the unit rides with it
const clubNameLine = said.get('/v1/speakeasy/name');
assert(clubNameLine && /\$OMR/.test(clubNameLine),
  `naming the house is a $OMR burn and "spent" is DOLLARS everywhere else it appears — the line has to ` +
  `name the unit, or it reads as a 48-dollar spend. Got: ${JSON.stringify(clubNameLine)}`);

// The entity sweep above is only a net over what was DRIVEN, so it needs one line that really carries
// an escapable character — otherwise it passes over a tree where every name happens to be plain and
// reads exactly like a clean bill of health. This is that line, asserted directly.
// The Doc states BOTH halves or neither is useful: the bill is scaled by five independent modifiers
// (street rank, doctors_friend, the Doc's standing, Iron Chin, the Ring's handicap), so a player who
// only sees the number cannot tell a discount from a rise, and the health restored is the purchase.
const healLine = said.get('/v1/heal');
assert(healLine && /\$/.test(healLine) && /\b100\b/.test(healLine),
  `getting patched up must name what it restored, not just what it cost — it landed on the catch-all ` +
  `"paid $N", a price with the purchase left off. Got: ${JSON.stringify(healLine)}`);
const skillLine = said.get('/v1/skills/doctors_friend');
assert(skillLine && /Doc's Friend/.test(skillLine),
  `the catalog name is "The Doc's Friend" and it must reach the player with an apostrophe in it — ` +
  `describe()'s output goes to textContent, so escaping it produces "Doc&#39;s". Got: ${JSON.stringify(skillLine)}`);
// and its mute sibling: unlearning ONE skill burns $OMR on a shared daily clock and gives a point back
const unlearnLine = said.get('/v1/skills/respec/doctors_friend');
assert(unlearnLine && /\$OMR/.test(unlearnLine) && /point/i.test(unlearnLine),
  `unlearning a skill burns $OMR and hands the point back — both are terms, and the verb three lines ` +
  `from it in describe() has stated its own all along. Got: ${JSON.stringify(unlearnLine)}`);

const planLine = said.get('/v1/heists/plan');
assert(planLine && /fronted|stake/i.test(planLine) && /crew|more/i.test(planLine),
  `planning a score fronts the stake and cannot go until the crew fills — both are terms the leader ` +
  `pays for at that moment. Got: ${JSON.stringify(planLine)}`);

// ── the wave-15 lines, each pinned rather than counted: a row that 4xx'd is SKIPPED, and a skip
// reads on the summary line exactly like a covered action (the recorded declared-but-never-driven
// lesson). Every one of these was found saying "done." while a sibling on the same card said it right.
const sealLine = said.get('/v1/gangs/vanity/seal');
assert(sealLine && /Wax Seal/.test(sealLine) && /reserve/i.test(sealLine),
  `the seal is bought from the family's POOLED $OMR reserve — it names the seal and what is left, ` +
  `the way the Foundation one line under it in describe() always has. Got: ${JSON.stringify(sealLine)}`);
const gnameLine = said.get('/v1/gangs/vanity/name');
assert(gnameLine && /LD2/.test(gnameLine),
  `renaming the family costs 150 $OMR and changes the name and TAG on every surface — the crest, ` +
  `same card and same till, has always said its own. Got: ${JSON.stringify(gnameLine)}`);
const envLine = said.get('/v1/law/envelope');
assert(envLine && /\$OMR/.test(envLine) && /\dd|\dh/.test(envLine),
  `the envelope is a RECURRING sink: what it cost and when it LAPSES are the two things a player has ` +
  `to know to renew it, and five siblings in that block state one or both. Got: ${JSON.stringify(envLine)}`);
const fightLine = said.get('/v1/casino/fight');
assert(fightLine && /pays \$/.test(fightLine) && /\$2,000/.test(fightLine),
  `a stake on a NAMED fighter at stated odds — the payout is what the bettor is deciding on, and the ` +
  `track bet one line up in describe() has stated its own all along. Got: ${JSON.stringify(fightLine)}`);
const planRaidLine = said.get('/v1/world/kryl/plan');
assert(planRaidLine && /\bcrew|guns|minimum\b/i.test(planRaidLine),
  `opening a crew raid on an apex outfit says the target and the crew MINIMUM — the number that ` +
  `decides whether the op can go at all. Got: ${JSON.stringify(planRaidLine)}`);
const joinRaidLine = [...said].find(([u]) => /world\/raids\/.*\/join$/.test(u))?.[1];
assert(joinRaidLine && /\d of \d/.test(joinRaidLine),
  `joining one says how far the crew has left to fill. Got: ${JSON.stringify(joinRaidLine)}`);
// `disbanded` is sent by two systems in OPPOSITE senses — a raid leader's kills the op for everyone,
// a heist member's leaves it standing — so both are pinned, or reading them as one says the reverse.
const raidLeaves = [...said].filter(([u]) => /world\/raids\/.*\/leave$/.test(u)).map(([, l]) => l);
assert(raidLeaves.length === 2, `both senses of leaving a raid have to drive — a MEMBER walking off ` +
  `({left}) and the LEADER calling it off ({disbanded}) — or the half that collides with the heist's ` +
  `own disband is never exercised and its mutation survives. Got: ${JSON.stringify(raidLeaves)}`);
// The two senses must read OPPOSITE, and the first cut of this assertion did not test that: it
// asked only for /raid|crew/ and no /stake/, which the collided heist line ("you walked away from
// the job — the crew goes on without you") satisfies word for word — so the mutation that
// reintroduced the collision PASSED. An assertion that accepts the exact wrong output is not an
// assertion. Driven in order, so [0] is the member walking and [1] is the leader calling it off.
assert(/goes on without you/i.test(raidLeaves[0]),
  `a MEMBER walking off leaves the raid standing. Got: ${JSON.stringify(raidLeaves[0])}`);
assert(/stood down|op is gone/i.test(raidLeaves[1]),
  `a LEADER calling it off ends the op for the whole crew — the opposite of a member walking, and ` +
  `exactly what the heist's own disband line says in reverse. Got: ${JSON.stringify(raidLeaves[1])}`);
for (const l of raidLeaves) assert(!/stake|the job/i.test(l),
  `a crew raid has no stake and is not "the job" — those are the heist's words, and borrowing them ` +
  `is the collision itself. Got: ${JSON.stringify(l)}`);
const leftRaidLine = raidLeaves[0];
assert(leftRaidLine && /raid|crew/i.test(leftRaidLine) && !/stake/i.test(leftRaidLine),
  `walking off a crew raid is not disbanding a heist — a raid carries no stake, and reading the two ` +
  `as one line tells the wrong man the wrong thing. Got: ${JSON.stringify(leftRaidLine)}`);
const routLine = said.get('/v1/world/dockrats/raid');
assert(routLine && /ROUTED/.test(routLine) && /flag|turf/i.test(routLine),
  `a rout by a man WITH a family plants its flag on the outfit's turf — that starts tribute and can ` +
  `be invaded, and without it the line reads byte-for-byte like a rout by a man with none. The co-op ` +
  `sibling seven lines down has read that field all along. Got: ${JSON.stringify(routLine)}`);
const caseLine = [...said].find(([u]) => /\/case$/.test(u))?.[1];
assert(caseLine && /\+\d/.test(caseLine),
  `casing spends energy for the one number it buys — the bump every man on the crew rolls. ` +
  `Got: ${JSON.stringify(caseLine)}`);
const offLine = [...said].find(([u]) => /heists\/.*\/leave$/.test(u))?.[1];
assert(offLine && /\$10,000|stake/i.test(offLine),
  `disbanding hands the fronted stake BACK, and the plan line PROMISES exactly that — so the game ` +
  `made the promise and then never confirmed it was kept. Got: ${JSON.stringify(offLine)}`);

const describedCount = described;
assert(described >= 100, `only ${described} of ${ACTIONS.length} actions succeeded — the ledger is measuring almost nothing`);
assert.deepEqual(mute, [], `${mute.length} action(s) a player PRESSES say nothing about what just happened ` +
  `(describe() fell through to "done." or rendered a hole). Every one of these moves money, an asset or a ` +
  `status — write the line, or the game is keeping its own result from the player:\n  ${mute.join('\n  ')}`);
// the TERM this check exists to keep on screen: a deposit rides in transit and is LOOTABLE until it
// clears. Asserted UNCONDITIONALLY — the first cut guarded it behind `if (dep.code < 400)` and by
// this point the fixture has spent its cash, so it skipped in silence and a mutation that stripped
// the warning SURVIVED. A check that can decline to run reads exactly like a check that passed.
// THE HUSH PAYMENT, driven on BOTH tokens the way the deposit check below does — because the class
// sweep above can only see lines that were driven, and this route needs the mark's own token, so the
// mutation restoring "The The Wash Records" walked straight past it. A sweep is a net, not a proof of
// the site it was written for.
{
  const mk = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id; return { t, id }; };
  const spy = await mk('Hush Spy '), tgt = await mk('Hush Mark ');
  await app.pool.query("UPDATE characters SET cash=2000000, wash_used=500000, wash_at=now() WHERE id IN ($1,$2)", [spy.id, tgt.id]);
  await app.pool.query('UPDATE account_persistent SET omr=500 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [spy.id]);
  const dig = await inject('POST', `/v1/wire/dig/${tgt.id}`, spy.t, {});
  assert.equal(dig.code, 200, `the hush-line check could not dig (${JSON.stringify(dig.body)}) — fix the fixture rather than letting this skip`);
  assert.equal(dig.body.found, true, 'the mark was seeded with a laundering trail — a clean dig proves nothing about the hush line');
  await inject('POST', `/v1/secrets/${dig.body.id}/extort`, spy.t, { demand: 4000 });
  const hush = await inject('POST', `/v1/secrets/${dig.body.id}/pay`, tgt.t, {});
  assert.equal(hush.code, 200, `the hush-line check could not pay (${JSON.stringify(hush.body)})`);
  const hushLine = String(describeFn(hush.body, 200));
  assert(!/\bThe The\b/i.test(hushLine),
    `every secret is named "The <something>", so an added article reads "The The Wash Records" — on ` +
    `every hush payment in the game, not an edge case. Got: ${JSON.stringify(hushLine)}`);
  assert(/\$4,000/.test(hushLine), `the hush line must name what was paid. Got: ${JSON.stringify(hushLine)}`);
}

const depositor = (await inject('POST', '/v1/auth/guest')).body.token;
await inject('POST', '/v1/character', depositor, { name: 'Ledger Dep ' + Math.random().toString(36).slice(2, 7) });
const dep = await inject('POST', '/v1/bank/deposit', depositor, { amount: 100 });
assert.equal(dep.code, 200, `the terms check could not bank $100 on a fresh character (${JSON.stringify(dep.body)}) — ` +
  'fix the fixture rather than letting this skip, or the assertion below never runs');
assert.match(String(describeFn(dep.body, 200)), /transit/i,
  'a deposit must say the money rides IN TRANSIT and can be looted until it clears — that is a TERM, not flavour, ' +
  'and it is the reason this ledger exists');

await app.close();
console.log(`✅ client wiring test passed — across the console AND /admin: of ${refs.size} routes they can ` +
  `call, ${refs.size - dynamic.length} resolve to a really-mounted route (segment-wise, so ` +
  `/v1/streets/:id/jump cannot match /v1/streets/roster) and the ${dynamic.length} that build their ` +
  `action at runtime are expanded over every value the client can pick — ${runtimeChecked.length} ` +
  `concrete routes, all mounted, none left unverifiable; all ${checked.length} catalog-backed values they hardcode ` +
  `are ids the server recognises; and every field in ${sends.length} request bodies is one its own ` +
  `route actually reads — including the ones that hand the whole body to a module, followed a file ` +
  `deeper to the parameter it lands in — through a barrel re-export if it takes one. And the mirror: ` +
  `the ${readCount} TOP-LEVEL fields the screens read off ${reads.size} boards are fields those ` +
  `boards really return, observed by fetching each one — plus the ${listCount} fields they read off ` +
  `the ELEMENTS of ${listReads.size} lists, which is where most board rendering lives and which needed ` +
  `a fixture that makes one of everything, because an empty list must never read as a pass. ` +
  `And the fifth way, which is not death but a lie: of those lists, ${[...listActs].length} hang a ` +
  `CLICK on each row, and where the server sends that row a gate the renderer has to read it — a ` +
  `control that looks live and only refuses once pressed is the game withholding its own rule. ` +
  `And the SIXTH, which is not a lie but a silence: where a board states an ONGOING cost — the pad, the nut, the cold clock — the screen rendering it has to read that too, because a card that takes your money without mentioning what it keeps costing is how both of those reached a tester. Those are the ways a button lies — this has found four dead routes, seven ` +
  `ignored fields, two element fields the board never sent (a LEGENDARY chip that had never ` +
  `once rendered) and a lane picker that offered every route to a level-6 player and refused on ` +
  `press, among them a broken action, an ammo box sold by a control that asked for a ` +
  `quantity it could not honour, and an unstake box that emptied the whole stake whatever you typed. ` +
  `And the SEVENTH, which is not a bug but the door one walks through: the tight allowlists 5 and 6 ` +
  `enforce cannot see a gate or a cost shipped under a name they do not yet know, so a completeness ` +
  `sweep flags every field across all ${reads.size} boards whose NAME reads like a gate or an ongoing ` +
  `cost — each must be enforced above or waived here with a reason (${REVIEWED_NOT_ENFORCED.size} are), ` +
  `so a new one is a decision on the record, not a silent regression. ` +
  `And the EIGHTH, which is not a lie but a shrug: a button that works and then says nothing. ` +
  `act() toasts describe() with no override, so ${describedCount} driven actions must each read back ` +
  `as something a player can act on — a play session found 65 that said nothing usable, among them ` +
  `an unstake that had just opened a six-hour window in which that $OMR can be looted off you, and a ` +
  `bank deposit that rides in transit and is lootable until it clears — both TERMS, not flavour — and an ` +
  `errand that signs a player up for a THREE-DAY job while carrying the very task it would not name. ` +
  `${Object.keys(CATALOGS).length} fields have ` +
  `catalogs and every other literal field is either an i18n key or declared not-an-API-value, so a ` +
  `new one forces that decision instead of being skipped in silence. And the NINTH, which check 5 is ` +
  `satisfied by and cannot see: reading a wall is not enforcing it. ${lvlChecked} clickable rows state a ` +
  `LEVEL requirement, and each must compare it to the player's level — directly, through a helper its ` +
  `renderer defines, or by deferring to a boolean the server derived from it. Printing the number in the ` +
  `label satisfies "the renderer reads the gate" while leaving the control live, which is worse than ` +
  `silence because the player reads a wall as trivia: a play session found four that way — the heist ` +
  `picker, the open crew board, the world crew raid and the Empire catalog all stated a level over a ` +
  `live button and refused on press. And the TENTH, the same class on the family's other axis: ` +
  `${rankStats.routes} routes can refuse rank, and the ${rankStats.markup} data-do controls and `+
  `${rankStats.wired} wired controls reaching one are each drawn behind a rank test — checked at the `+
  `CONDITION that drew them, walking out through the enclosing interpolations, because a byte window `+
  `reads the neighbouring button's gate as this one's. A soldier was offered "sue for peace" and `+
  `"declare a family war (boss only)" thirty lines below the frontier controls that read the `+
  `server's own canCommand, and both answered 400 rank.`);
