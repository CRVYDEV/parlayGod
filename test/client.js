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
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { M3, M4, PATHS, NPC_HITMEN, HEIST_ROLES, HEIST_JOBS, DRUGS, GOODS, DISTRICTS,
  COMMISSION, CONVOY, DUELS, TERRITORY_TYPES } from '../src/rules.js';

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
      end = next[1];
    }
    // check 5 needs to know whether this row RENDERS AN ACTION — a purely informational row has
    // nothing to gate. `data-<x>=` / `data-do=` / an inline onclick are the three ways this client
    // hangs a click on an element. `<option` is the fourth and it is the one that had a live defect:
    // a list mapped into a <select>'s options carries no data- attribute of its own, but the option
    // IS the choice — picking a locked one and pressing the neighbouring button is exactly the
    // "looks live, refuses on press" the tester reported.
    if (/data-[a-z]+\s*=|onclick\s*=|<option/.test(region)) listActs.add(k);
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
const GETBIND = /(?:(const|let|var)\s+)?([a-zA-Z_$][\w$]*)\s*=\s*\(await api\(\s*'GET'\s*,\s*([`'"])([^`'"]+)\3\s*\)\)\s*\.body(\s*\?\.\s*([a-zA-Z_$][\w$]*))?/g;
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
const GATE_FIELDS = new Set(['minLvl', 'minLevel', 'locked', 'canRaid', 'eligible', 'unlocked']);
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
    const blind = gates.filter((g) => !fields.has(g));
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
  `${Object.keys(CATALOGS).length} fields have ` +
  `catalogs and every other literal field is either an i18n key or declared not-an-API-value, so a ` +
  `new one forces that decision instead of being skipped in silence.`);
