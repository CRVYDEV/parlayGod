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
  COMMISSION, CONVOY, DUELS, TERRITORY_TYPES, CARS, TRIMS, ASSETS, RACKETS, BUSINESSES, ESTATE, WIRE, SECRETS, STABLE, WORLD, WORLD_NPCS,
  PEN, HONOR, MARRIAGE, CAMPAIGNS, LIMITED_RUNS, VANITY } from '../src/rules.js';
import { bumpHonor } from '../src/honor.js';
import { mintLimitedRun } from '../src/economy.js';

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

// A gate is a CONDITION, so test conditions — not a byte window. Walk out through the enclosing
// `${...}` interpolations and at each level read only the HEAD: the text from `${` to where the
// branch body starts (its first backtick). That is exactly the expression that decided whether to
// draw this control, and nothing else. Two coarser cuts were tried and both were wrong in opposite
// directions: a fixed 1200-char window passed a mutation stripping the war button's rank test
// because the pact button one line above still carried one, and stopping at the innermost
// interpolation flagged seven controls correctly drawn inside an outer `${boss ? ...}` block.
// MODULE scope, shared by checks 10 and 11: it lived inside check 10's block and check 11's fallback
// path therefore threw ReferenceError instead of walking out — which the clean tree never reached, so
// the check passed while half of it was dead code. A mutation is what surfaced it.
// Same story, same mutation: `lineAt` was block-local to check 10 too, so check 11's FAILURE
// message — the only thing that names which line is ungated — threw instead of naming it. A
// failure that teaches nothing is barely better than no check at all.
const lineAt = (at) => html.slice(0, at).split('\n').length;
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
// A TERNARY's colon looks exactly like a key's: `alt: guest ? null : 'everywhere'` contains the
// substring `null : 'everywhere'`, which this pattern reads as a field called `null`. The JS
// keywords that can appear on a ternary's true-branch are never field names in this codebase, so
// dropping them removes the false positive without weakening what the check sees — the recorded
// ternary-extraction class, which has now bitten checks 1, 4 and this one.
const KEYWORD_LHS = new Set(['null', 'undefined', 'true', 'false']);
const literals = [];
for (const m of html.matchAll(/([a-zA-Z_]+)\s*:\s*'([a-z0-9_]+)'/g)) if (!KEYWORD_LHS.has(m[1])) literals.push([m[1], m[2]]);
for (const m of html.matchAll(/"([a-zA-Z_]+)"\s*:\s*"([a-z0-9_]+)"/g)) if (!KEYWORD_LHS.has(m[1])) literals.push([m[1], m[2]]);

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

// ── 3c. THE SELF-SERVE REVOCATION MUST HAVE A BUTTON ────────────────────────────────────────────
// The orphan-route class INVERTED: not a control that calls a route the server never mounted, but a
// route the server mounts that NO control ever reaches. `POST /v1/auth/logout-all` bumps
// token_version and cuts the live sockets — it is the answer to "someone has my session" — and it
// was built, red-teamed twice, and had no button anywhere in the game. Meanwhile the button that
// LOOKS like it does that job only dropped the token from localStorage, so a player whose session
// was stolen pressed sign-out and the thief kept playing.
//
// A NAMED regression rather than a sweep, for the FIRE reason: most unbuttoned routes are legitimate
// (mod, chain, and the raw Console covers them by design), so a general "every route needs a button"
// check would be mostly waivers. What makes this one different is that it is a SECURITY control
// whose entire premise is that a compromised player can reach it themselves — the Console is not an
// answer for someone who is being locked out. Anchored on the sign-out handler specifically, because
// "reachable from the raw deck" would satisfy a laxer check and miss the whole point.
{
  const i = html.indexOf("$('#btn-logout').onclick");
  assert(i > -1, 'the sign-out control moved — this regression is vacuous. Find it and re-anchor.');
  const handler = html.slice(i, html.indexOf("$('#btn-", i + 30));
  assert(/\/v1\/auth\/logout-all/.test(handler),
    'the sign-out handler never calls POST /v1/auth/logout-all — so the ONLY control a player can ' +
    'reach kills this device and leaves a stolen session live. The revocation route exists; give it ' +
    'a button here, or a compromised player has no self-serve way to cut the thief off.');
  assert(/\balt\s*:/.test(handler),
    'the sign-out dialog offers no third choice, so "everywhere" is unreachable from it. A second ' +
    'chained dialog is not a fix: it makes the rarer, MORE URGENT answer the harder one to reach.');
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
  // The key names the BINDING, so folding a board into an aggregate re-keys its waiver — which is
  // the guard working: a waiver is a decision about one board on one screen, and it should have to
  // be re-stated rather than following a field around by name.
  ['renderCity|/v1/citywide|world|npcs|minLvl', 'gated on the server-sent canRaid, which worldBoard '
    + 'derives from this exact minLvl (and the solo/coop split the client cannot compute) — the row '
    + 'renders a "need lvl N" chip in place of the button when it is false.'],
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
const shieldStats = { routes: 0, markup: 0, wired: 0 };
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
  const gatedAt = (at) => enclosing(at).some((start) => {
    const head = html.slice(start, at);
    const body = head.indexOf('`');
    return RANK_TEST.test(body >= 0 ? head.slice(0, body) : head);
  });
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

// ── CHECK 11: THE SHIELD LEDGER — a take-button offered to a man who is to ground ───────────────
// Checks 9 and 10 cover walls a player can't cross YET (level, rank). This is the same class on a
// wall they put up THEMSELVES: the signed D2 rule — a safehouse is "a shield, not a bunker" — freezes
// every verb that turns something you already own into money in your pocket.
//
// Played it. Went to ground with a laundromat running, opened The Empire, and the screen read
//   "$120,017 READY TO COLLECT · collect before the pad or a raid eats it"
// over a LIVE button, and the server answered 400 `safe`. The same screen's own warning advises
// "defend yourself (a safehouse, a bodyguard)" — so it urges the state that freezes the take, urges
// the take, and never connects the two. Driven and confirmed across five modules: the front, the
// corner, the club, the port, the fence.
//
// The state was never hidden (the SAFEHOUSE chip counts down on the sheet) and the refusals read
// well — what was missing is that TWELVE take-buttons never asked. And the shape is the familiar
// one: `renderPvp`'s own "go to ground" button ALREADY reads `me.safeSeconds`, and it was the only
// thing in the whole client that did.
//
// The set is DERIVED, not listed: an exported function that (a) gates on `safeHoused(ch)` — the
// ACTOR's own row, never `safeHoused(victim)`, which is a different rule about somebody else — and
// (b) is named collect*/claim*/fence*, i.e. turns what you own into money. That is a principled
// subset with a stated edge: the OFFENSE half of the D2 rule (fire, jump, raid, a round at the club)
// is deliberately out of scope here — those live on screens that carry the safehouse card itself,
// and gating them unplayed would be speculation. A future wave that plays them can widen the name
// filter and the guard will name whatever it finds.
{
  const srcFiles = ['src/server.js', ...readdirSync('src/routes').map((f) => 'src/routes/' + f)];
  const safeFns = new Map();                                  // module path -> Set(fn)
  const scanSafe = (dir) => {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(dir + '/' + f, 'utf8');
      const re = /export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g;
      const idx = []; let m;
      while ((m = re.exec(src))) idx.push([m[1], m.index]);
      for (let i = 0; i < idx.length; i++) {
        const body = src.slice(idx[i][1], i + 1 < idx.length ? idx[i + 1][1] : src.length);
        if (!/safeHoused\(ch\)/.test(body) || !/^(collect|claim|fence)/.test(idx[i][0])) continue;
        const key = dir + '/' + f;
        if (!safeFns.has(key)) safeFns.set(key, new Set());
        safeFns.get(key).add(idx[i][0]);
      }
    }
  };
  scanSafe('src'); scanSafe('src/social');

  // Every route in the registry, and which of them reach one of those functions. BOTH lists matter:
  // resolving a client path against the GATED subset alone lets a non-gated route lose a match it
  // would really win (`/v1/convoy/rig/${id}` resolved to `/v1/convoy/:id/collect` because
  // `/v1/convoy/rig/:id` was not a candidate at all).
  const allRoutes = [], safeRoutes = [];
  for (const f of srcFiles) {
    const src = readFileSync(f, 'utf8');
    const alias = new Map();
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
      for (const [mod, fns] of safeFns) for (const fn of fns) {
        for (const call of body.matchAll(new RegExp('(?:([A-Za-z0-9_$]+)\\.)?' + fn + '\\s*\\(', 'g')))
          if (alias.get(call[1] || fn) === mod) { hit = fn; break; }
        if (hit) break;
      }
      allRoutes.push([marks[i][0], marks[i][1]]);
      if (hit) safeRoutes.push([marks[i][0], marks[i][1], hit]);
    }
  }
  assert(safeRoutes.length >= 10, `THE SHIELD LEDGER found only ${safeRoutes.length} safe-gated take-route(s) — `
    + 'the extractor has stopped seeing them, so a green run here means nothing. Fix the scan, not the floor.');

  // Segment-wise most-specific-wins, scored by what a client `${}` actually IS: a runtime value, so
  // a route :param facing one beats a route LITERAL facing one. Without that ranking
  // `/v1/loans/house/repay` outranks `/v1/loans/:id/collect` for `/v1/loans/${id}/${what}`, which is
  // not how fastify would route it.
  const segScore = (meth, path, r) => {
    if (r[0] !== meth) return 0;
    const a = r[1].split('/'), b = path.split('/');
    if (a.length !== b.length) return 0;
    let score = 1;
    for (let i = 0; i < a.length; i++) {
      const wild = b[i] === '*', par = a[i].startsWith(':');
      if (!wild && !par) { if (a[i] !== b[i]) return 0; score += 4; continue; }
      if (par && wild) { score += 3; continue; }
      if (par) { score += 2; continue; }
      score += 1;                                             // a route literal facing a `${}`
    }
    return score;
  };
  const resolveSafe = (meth, path) => {
    let bs = 0; const tied = [];
    for (const r of allRoutes) { const sc = segScore(meth, path, r); if (!sc) continue; if (sc > bs) { bs = sc; tied.length = 0; } if (sc === bs) tied.push(r); }
    // a `${}` in the ACTION segment genuinely reaches several routes at one specificity, so every
    // tied winner counts — flag if ANY of them is safe-gated
    for (const t of tied) { const hit = safeRoutes.find((r) => r[0] === t[0] && r[1] === t[1]); if (hit) return hit; }
    return null;
  };

  const SAFE_TEST = /safeSeconds|safeHoused|toGround|groundOff/;
  const shieldGated = (at) => {
    // The control's OWN tag counts. A take-button reads the state in its attributes, not in a
    // condition deciding whether to draw it at all: the figure STAYS on screen (it is the reason to
    // surface), the button just stops being pressable — the Port-lane precedent.
    const tag = html.lastIndexOf('<button', at);
    if (tag >= 0 && at - tag < 600 && SAFE_TEST.test(html.slice(tag, at + 400))) return true;
    return enclosing(at).some((start) => {
      const head = html.slice(start, at); const b = head.indexOf('`');
      return SAFE_TEST.test(b >= 0 ? head.slice(0, b) : head);
    });
  };

  const shieldUngated = []; let shieldDo = 0, shieldWired = 0;
  for (const m of html.matchAll(/data-do="(GET|POST|DELETE|PUT) (\/v1\/[^"]*)"/g)) {
    const hit = resolveSafe(m[1], m[2].replace(/\$\{[^}]*\}/g, '*'));
    if (!hit) continue;
    shieldDo++;
    if (!shieldGated(m.index)) shieldUngated.push(`line ${lineAt(m.index)}  ${m[1]} ${hit[1]} -> ${hit[2]}() (data-do)`);
  }
  const shieldWire = [];
  for (const w of html.matchAll(/const\s+(\w+)\s*=\s*\$\(\s*'#([\w-]+)'\s*\)[\s\S]{0,120}?\b\1\.onclick\s*=(?=((?:(?!\.onclick)[\s\S]){0,700}))/g))
    shieldWire.push([`id="${w[2]}"`, w[3] || '']);
  for (const w of html.matchAll(/querySelectorAll\(\s*'\[([\w-]+)\]'\s*\)\s*\.forEach\(\s*\(?\s*(\w+)[^)]*\)?\s*=>\s*\2\.onclick\s*=(?=((?:(?!\.onclick)[\s\S]){0,700}))/g))
    shieldWire.push([`${w[1]}=`, w[3] || '']);
  for (const [sel, body] of shieldWire) {
    const seen = new Set();
    for (const c of body.matchAll(/act\(\s*'(GET|POST|DELETE|PUT)'\s*,\s*[`']([^`']*\/v1\/[^`']*)[`']/g)) {
      const hit = resolveSafe(c[1], c[2].replace(/\$\{[^}]*\}/g, '*'));
      if (!hit) continue;
      const k = hit[0] + hit[1]; if (seen.has(k)) continue; seen.add(k);
      // One attribute can draw SEVERAL buttons (`data-loando` draws cancel/repay/collect/unsell/buy)
      // and only some reach a safe-gated route. Prefer the occurrence whose attribute VALUE names the
      // route's own action segment, so the guard checks the button that really goes there rather than
      // whichever happens to sit first in the file.
      const act0 = hit[1].split('/').filter((x) => x && !x.startsWith(':')).pop();
      let drawn = -1;
      for (let k2 = html.indexOf(sel); k2 >= 0; k2 = html.indexOf(sel, k2 + 1)) {
        if (drawn < 0) drawn = k2;
        if (html.slice(k2, k2 + 60).includes(act0)) { drawn = k2; break; }
      }
      if (drawn < 0) continue;
      shieldWired++;
      if (!shieldGated(drawn)) shieldUngated.push(`line ${lineAt(drawn)}  ${hit[0]} ${hit[1]} -> ${hit[2]}() (wired via ${sel})`);
    }
  }
  assert(shieldDo + shieldWired >= 10, `THE SHIELD LEDGER matched only ${shieldDo + shieldWired} client control(s) `
    + `against ${safeRoutes.length} safe-gated take-routes — a pass has drifted. Fix the scan, not the floor.`);
  Object.assign(shieldStats, { routes: safeRoutes.length, markup: shieldDo, wired: shieldWired });
  assert.deepEqual(shieldUngated, [], `${shieldUngated.length} take-control(s) reach a route that refuses \`safe\` `
    + `without reading the state, so a man who is to ground is shown a live button over money he cannot have, `
    + `and learns it by pressing:\n  ${shieldUngated.join('\n  ')}`);

  // The sweep above covers the CONTROL. The other half of what was played is COPY: the Empire's hero
  // band read "$120,017 READY TO COLLECT · collect before the pad or a raid eats it" — a call to action
  // for a button the server was refusing, on the same screen. That is a class of ONE (heroBand is used
  // on three screens and only this one urges a take-verb), and the FIRE precedent says a class of one
  // gets a NAMED regression rather than a sweep that would have to waive every other sub-line.
  // Lazy TO THE CLOSING BRACE, not to a newline: `[\s\S]{0,400}?\n` matches zero characters and stops
  // at the newline right after the label, so it never reaches the `sub:` line it is about — the check
  // failed on the CLEAN tree, which is the good direction to get a regex wrong in.
  // And one control the derivable subset deliberately EXCLUDES: banking. `bank()` is gated on
  // `safeHoused(ch)` like the take-verbs, but it is not a take — the D2 comment at the gate calls a
  // deposit an EXPOSED act ("the courier walks"), and its name matches no collect/claim/fence rule.
  // So the sweep cannot reach it and it is pinned by name, which is also what keeps the safehouse
  // card honest: that card promises "no banking a deposit", and a promise nothing enforces rots.
  const dep = html.match(/id="bank-dep"[^>]*>/);
  assert(dep && SAFE_TEST.test(dep[0]),
    `the deposit button never asks whether the player is to ground, while bank() refuses \`safe\` on a `
    + `deposit and the safehouse card promises exactly that:\n  ${dep ? dep[0] : '(the button moved)'}`);

  const heroSub = html.match(/label: 'ready to collect'[\s\S]*?\},/);
  assert(heroSub && SAFE_TEST.test(heroSub[0]),
    `the Empire hero band's "ready to collect" sub urges the take without reading whether the player is to `
    + `ground — a call to action must be answerable, and while you are under, that button is refused:\n  `
    + `${heroSub ? heroSub[0].trim() : '(the band moved — find it and re-point this)'}`);
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
const DESCRIBE = (() => {
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
  // check 13 needs the SAME describe with its branches instrumented, so the pieces are returned
  // rather than only the function — a second extraction here would be a second copy of the trap
  // list above, which is how a copied dependency list goes stale (this file records that happening).
  return { fn: vm.runInNewContext(src)(rulesBody), helpers, lines: L.slice(dStart, dEnd + 1), dStart, rulesBody };
})();
const describeFn = DESCRIBE.fn;

// each entry is a route a player PRESSES (act()/data-do) whose success shape must read as something.
// Bodies are whatever makes the call succeed for a fresh character; a 4xx is skipped, not asserted —
// this check is about what a WORKING action says, and the gates have their own suites.
// A formatted-money matcher. Assertions here compare a rendered LINE against the figure the SERVER
// actually sent, never against a literal — a literal passes while the two drift, which is the whole
// class this file exists to catch. `fmt` groups thousands, so the raw number never appears verbatim.
const fmtLike = (n) => String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let respecWant = null;   // WAVE 55: the respec row computes its own conserving swap at drive time
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
  // WAVE 55 — two of the most-pressed verbs in the game, neither of which the ledger had ever
  // driven. THE REBUILD said "done." over a paid, once-a-day reshaping of the three numbers every
  // opposed roll reads. THE BOOST said "boosted a rare ride" over iron it never named — including,
  // silently, a numbered 1-of-N car, which is the single rarest thing that can happen to a player.
  // Both seed their own precondition at drive time: a respec that lands on the same build 4xxs
  // `same`, and boosting needs the cooldown clear and the garage under its cap.
  ['POST', async () => {
    // The build is SEEDED rather than read, because the conserving swap below needs headroom the
    // fixture may not have: a 5/5/5 character is already on the per-stat floor, so every legal
    // redistribution of 15 points is 5/5/5 — the server answers `same`, the row skips, and the
    // assertions read `undefined` while the summary line calls it covered.
    await app.pool.query('UPDATE characters SET muscle=20, cunning=10, speed=10, respec_at=NULL WHERE id=$1', [charId]);
    respecWant = { muscle: 10, cunning: 20, speed: 10 };   // conserves 40, every stat clear of the floor
    await app.pool.query('UPDATE account_persistent SET omr=9000 WHERE account_id=' +
      '(SELECT account_id FROM characters WHERE id=$1)', [charId]);
    return '/v1/respec';
  }, () => respecWant],
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
  // THE SEVENTH OBLIGATION. The pad branch enumerated six things that use the word `paid` and
  // claimed `fronts` as the pad's alone — and the FAMILY's territory upkeep is a byte-shape twin
  // (`{paid, fronts, stillOwed}`), so a boss settling the family's books out of the TREASURY read
  // "paid $24,000 of the pad across 1 front — square": a bill on a screen he was nowhere near,
  // naming fronts he may not own, while his own pad sat unpaid. Both replies name their SYSTEM now.
  // Arrears are backdated at drive time because the nothing-owed path returns a different shape and
  // would test neither line.
  ['POST', async () => {
    // two flat queries, never a subquery in the WHERE — pg-mem cannot parse one (the /v1/gangs posture)
    const g = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [charId])).rows[0];
    if (!g) return null;
    await app.pool.query("UPDATE territory_rackets SET upkeep_at = now() - interval '30 hours' WHERE owner_gang=$1", [g.gang_id]);
    return '/v1/territory/upkeep';
  }, null],
  ['POST', '/v1/gangs/tribute', { amount: 5000 }],       // cash and $OMR tribute share one shape —
  ['POST', '/v1/gangs/tribute/omr', { amount: 10 }],      // the currency marker is what tells them apart
  ['POST', '/v1/gangs/vanity/color', { color: '#3a5f7d' }],
  // THE SEAL AND THE RENAME sat on that same card and both said "done." — the crest one line up is
  // the sibling that got it right. Both are $OMR: the seal from the family's POOLED reserve (so the
  // tribute below fills it first — the ladder's first rung is 150), the rename from the boss's own.
  ['POST', '/v1/gangs/tribute/omr', { amount: 200 }],
  ['POST', '/v1/gangs/vanity/seal', null],
  // THE FOUNDATION sits ONE LINE from that seal in describe(), comes out of the SAME pooled reserve,
  // and named neither what was left nor what comes next — though the reply carries both. It also
  // stated half its effect: the tier softens a filed case AND bleeds the meter faster, and the
  // second half is the one that PREVENTS a case. The tribute above fills the reserve for both.
  ['POST', '/v1/gangs/tribute/omr', { amount: 400 }],
  ['POST', '/v1/gangs/foundation', null],
  ['POST', '/v1/gangs/vanity/name', { name: 'Ledger Two ' + Math.random().toString(36).slice(2, 5), tag: 'LD2' }],
  // THE VAULT, and it is here because NEITHER stake NOR unstake was ever driven — which is exactly
  // how the stake line survived every wave of this sweep saying "safe from a killer's hands" while
  // the Vault card one screen over said "cheaper cover, not a safe harbour", the server's own
  // published note said "but nothing is safe", and the rules file said "NEVER safe" in those words.
  // Economy v3 step 5 reversed the protected tier on purpose. A fluent, confident, FALSE claim about
  // the player's money is worse than silence, because a player stakes on it BELIEVING it — and no
  // silence pattern can see it. An earlier wave fixed the UNSTAKE line by inspection; driving is
  // what found its neighbour. $OMR from the tribute rows above.
  ['POST', '/v1/stake', { amount: 25 }],
  // THE COMMITMENT (2026-08-21): lock the stake, then expire the window by SQL before unstake —
  // the lock is ONE-WAY by design, so without the expiry the unstake row below would be REFUSED
  // (`locked`) and read on the summary line exactly like a covered action (the recorded
  // declared-but-never-driven class). The lazy resolver is the established mechanism for a row
  // whose precondition an earlier row created.
  ['POST', '/v1/stake/lock', { tier: 'week' }],
  ['POST', async () => {
    await app.pool.query('UPDATE account_persistent SET stake_lock_until = now() - interval \'1 minute\' '
      + 'WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [charId]);
    return '/v1/unstake';
  }, null],
  // THE SAME NEIGHBOURHOOD, DRIVEN THE SAME WAY, and it found two more. GETTING MADE is a
  // SUBSCRIPTION — dues in $OMR, thirty days, then it lapses — and it read like a one-time ceremony
  // because describe() falls through to the server's own `message` when nothing matches. The reply
  // has carried `omr` and `madeSeconds` all along. And THE STORE'S $OMR RAIL — the one that lets a
  // player pay a real-money price out of what they earned — said "done.", though its sibling THREE
  // LINES UP (`payPlex`, which answers `kind` where this answers `sku`) has read since it shipped.
  // Both are real buttons: the Store shelf's pay-in-$OMR control and the Made card.
  ['POST', '/v1/made', null],
  ['POST', '/v1/store/plex/wire_month', null],
  // THE TWO COOLING VERBS, and the worse of the two is why this sweep stopped hunting silence. The
  // reply field `heat` means a DELTA — the deal returns what a sale ADDED, and the client renders
  // any `heat` as "heat +N". LAY LOW returned the resulting LEVEL under that same name, so the
  // game's primary way DOWN from the Bureau told a player who had just paid $4,500 and 25 energy to
  // cool off that their heat had gone UP by what was left: "heat +55". Not silence — a confident,
  // WRONG line, on the button a panicking player presses, and the mute check cannot see it because
  // it reads as an answer. Its neighbour CLEAN PAPERS said "done." while burning 60 $OMR whose
  // price appeared on no screen in the game. One field with two meanings, one formatter that could
  // not tell them apart, and the whole thing invisible because neither route was ever driven.
  // Seeded here because both refuse below their heat floor, and clean papers must run SECOND — it
  // wipes to zero, which would starve lay low of anything to cool.
  ['POST', async () => { await app.pool.query('UPDATE characters SET heat=80 WHERE id=$1', [charId]); return '/v1/kitchen/laylow'; }, null],
  ['POST', '/v1/kitchen/cleanpapers', null],
  // DECLARING WAR said "done." — the loudest thing a boss can do, in a block where the pact, the
  // treaty and the oathbreak all state their terms in full. Resolved at drive time because the
  // TARGET has to be chosen against live state: the seeded rival is under a sworn pact with the
  // family this fixture ARRIVED in (which it left four rows up), and a pact, an NPC family or a war
  // already running each refuse — so the row picks a family that can actually be fought rather than
  // naming one and hoping. The war chest comes from the treasury the seize row funded.
  ['POST', async () => {
    const g = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [charId])).rows[0];
    if (!g) return null;
    const t = (await app.pool.query(
      `SELECT id FROM gangs WHERE id <> $1 AND NOT npc_flag
         AND (war_until IS NULL OR war_until < now())
         AND id NOT IN (SELECT gang_b FROM gang_relations WHERE gang_a=$1)
         AND id NOT IN (SELECT gang_a FROM gang_relations WHERE gang_b=$1) LIMIT 1`,
      [g.gang_id])).rows[0];
    return t ? `/v1/gangs/war/${t.id}` : null;
  }, null],
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
// 20,000 rather than 1,000 because the Store's $OMR rail is priced off the ETH fee at the market
// rate — a month of the Street Wire runs ~6,200 — and an action that cannot be afforded is SKIPPED,
// which reads on the summary line exactly like a covered one (the lesson two comments up).
await app.pool.query('UPDATE account_persistent SET omr=20000 WHERE account_id=(SELECT account_id FROM characters WHERE id=$1)', [charId]);
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
  // ...and a kind ACTIONS does not ALREADY buy. It did: the seed owns the laundromat, so this
  // resolved to `restaurant` — which the main list buys first — and the row 400'd `exists` and was
  // skipped, reading on the summary line exactly like a covered action. It was the ONLY skip in the
  // whole 217-action run, found by instrumenting the loop rather than by reading it.
  const claimed = new Set(ACTIONS.map(([, u]) => /^\/v1\/business\/([a-z]+)\/buy$/.exec(u)?.[1]).filter(Boolean));
  const front = BUSINESSES.find((b) => !owned.has(b.kind) && !claimed.has(b.kind));
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
  // THE FRONT'S UPGRADE — the racket's story one system over, and found the same way. LAZY, because
  // the id is created by the row right above it: resolving up front reads a row the drive then
  // replaces. A resolver returning falsy SKIPS in silence, so the named assertion below is what
  // actually holds this — it fails if the line never appeared, whatever the reason.
  if (front) addAction(['POST', `/v1/business/${front.kind}/buy`, null],
    ['POST', async () => {
      const row = (await app.pool.query('SELECT id FROM businesses WHERE character_id=$1 AND kind=$2',
        [charId, front.kind])).rows[0];
      return row ? `/v1/business/${row.id}/upgrade` : null;
    }, null]);
  if (staff) addAction(['POST', '/v1/estate/upgrade', null], ['POST', `/v1/estate/staff/${staff.id}`, null]);
  addAction(['POST', '/v1/loans', { amount: 5000, rate: 0.2, hours: 24 }]);
  // THE DAILY CHECK-IN — the streak is the money MULTIPLIER, not a counter, and the line rendered
  // it as a bare parenthetical. Driven here so check 8 owns its silence; the numbers are asserted
  // by name below, because "+$105,350 (day 1)" is a fluent sentence no silence pattern can see.
  addAction(['POST', '/v1/checkin', null]);
  // THE DAILY CONTRACT — the most-repeated reward button in the game, and it said "done." The
  // counters are seeded so the CLAIM is what drives; doing the work is another suite's business,
  // and a job whose work this fixture cannot reach would 4xx and read as covered. LAZY, because
  // the board is drawn per DAY and the id cannot be written down here.
  addAction(['POST', async () => {
    const day = Math.floor(Date.now() / 86400000);
    const board = (await inject('GET', '/v1/daily', token)).body?.jobs || [];
    if (!board.length) return null;
    const ctr = {}; for (const j of board) ctr[j.kind] = j.goal;
    await app.pool.query(`INSERT INTO daily_progress (character_id, day, counters, claimed) VALUES ($1,$2,$3,'[]')
      ON CONFLICT (character_id, day) DO UPDATE SET counters=$3, claimed='[]'`, [charId, day, JSON.stringify(ctr)]);
    // GUARANTEE the state the assertion is about, rather than hope for it. Which jobs the board
    // draws is a function of the real DAY, and a family-gated one on a family-less fixture leaves
    // the envelope out of reach — so the claim would land in a different branch on some calendar
    // days and the same assertion would pass or fail by the date (the recorded flake shape).
    // Pre-claiming the blocked ones here leaves the envelope open every day of the year, and the
    // driven claim below is still a real server reply.
    for (const j of board.filter((x) => x.blocked)) await inject('POST', `/v1/daily/${j.id}/claim`, token, null);
    const rest = board.filter((j) => !j.blocked);
    return rest.length >= 2 ? `/v1/daily/${rest[0].id}/claim` : null;
  }, null]);
  // THE RACKET UPGRADE. The BUY has read an hourly rate since it shipped; the UPGRADE three lines
  // below it landed on the bare catch-all `paid $6,250` — the forgotten sibling, and the worst of
  // the pair to leave mute, because the whole POINT of an upgrade is the NEW number. Both are
  // driven, and the buy MUST come first: an upgrade with no seat under it answers 400 and SKIPS,
  // which reads on the summary line exactly like a covered action.
  // The seat is cleared rather than hoped for — this fixture already runs a front and an asset, and
  // the op-slot cap is level-derived, so a full board would have made the buy 400 and taken the
  // upgrade's coverage with it. `character_rackets` is nothing else's fixture (the territory ladder
  // above is a different table and a different system), so clearing it costs no other assertion.
  const rack = RACKETS[0];                     // the cheapest rung — level 3, $12,500
  await app.pool.query('DELETE FROM character_rackets WHERE character_id=$1', [charId]);
  await app.pool.query('UPDATE characters SET cash = cash + 200000 WHERE id=$1', [charId]);
  addAction(['POST', `/v1/rackets/${rack.id}/buy`, null], ['POST', `/v1/rackets/${rack.id}/upgrade`, null]);
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
  const r = await inject(m, url, token, typeof payload === 'function' ? payload() : payload);
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
// WAVE 55 — THE BOOST, driven on its OWN token and AFTER the loop above, for the reason the loop's
// own header gives: a failed boost JAILS you, and a jailed fixture silences every row that follows
// while each of them still reads on the summary line as covered. It is also the only row here that
// must be driven TWICE: the ordinary success and the LIMITED RUN are different lines, and the run —
// a numbered 1-of-N car, the rarest thing that can happen to a player — is the one that was silent.
// The run roll is pinned through its TEST-ONLY knob rather than looped for, because looping for a
// 0.4% event is a flake with extra steps.
{
  const bt = (await inject('POST', '/v1/auth/guest')).body.token;
  await inject('POST', '/v1/character', bt, { name: 'Ledger Boost ' + Math.random().toString(36).slice(2, 6) });
  const bid = (await inject('GET', '/v1/me', bt)).body.character.id;
  await app.pool.query("UPDATE characters SET cash=900000, respect=2000000, energy=900, speed=40, cunning=40 WHERE id=$1", [bid]);
  const tryBoost = async () => {
    for (let i = 0; i < 40; i++) {                      // the roll caps at 0.9 — retry, never assume
      await app.pool.query('UPDATE characters SET gta_at=NULL, jail_until=NULL, energy=900 WHERE id=$1', [bid]);
      const r = await inject('POST', '/v1/garage/boost', bt);
      if (r.code === 200 && r.body?.success === true) return r.body;
      // a full garage would 4xx forever rather than flake, so make room and keep going
      await app.pool.query('DELETE FROM cars WHERE character_id=$1', [bid]);
    }
    assert(false, 'the boost never landed in 40 tries — the fixture is wrong, not the dice');
  };
  const plain = await tryBoost();
  const plainLine = String(describeFn(plain, 200));
  said.set('/v1/garage/boost', plainLine);
  assert(plain.car && plain.car.name, 'the boost reply must NAME the iron it just handed over — the model ' +
    'id alone (`junker`) is what the art route keys on, not something to show a player');
  assert(plainLine.includes(plain.car.name), 'THE BOOST DID NOT NAME THE CAR. The most-repeated money verb ' +
    `in the game read ${JSON.stringify(plainLine)} over a ${plain.car.name} — a player had to open the ` +
    'Garage to find out what they had just stolen');
  assert(!/ride/.test(plainLine) || plainLine.includes(plain.car.name),
    'a generic "ride" is what this line said before it said anything');

  // THE NUMBERED CAR — and a correction, recorded because a sweep that publishes only its hits
  // cannot be audited. The wave that found the boost silent claimed the 1-of-N car was silent with
  // it, and that was WRONG: `car.run` returns on its own dedicated line ~700 lines earlier in
  // describe(), and the mutation written to prove otherwise passed. (It passed twice, in fact —
  // the first attempt was a python replace with no anchor assert, so it never applied at all and
  // read exactly like a clean bill of health. The second one really applied, and the branch it
  // removed turned out to be dead code I had just added.) What stays is a REGRESSION guard on the
  // line that was already right, because the ordering is what makes it right and ordering is what
  // a future edit moves.
  //
  // A run only exists on FOUR of the sixty catalog models and `rollCar` reaches them 0.93% of the
  // time — measured, not guessed — so 99% confidence needs ~500 boosts, which is a flake with extra
  // steps. The run therefore comes from the server's own minter (roll pinned through its TEST-ONLY
  // knob) spliced into the REAL boost reply: every value asserted below is still server-produced.
  // Stated rather than hidden: the DRAW is not driven here, only the line that renders it.
  process.env.LIMITED_RUN_P = '1';                      // TEST-ONLY (preflight classifies it)
  const cl = await app.pool.connect();
  let mintedRun;
  try { mintedRun = await mintLimitedRun(cl, LIMITED_RUNS[0].model, 0); } finally { cl.release(); }
  delete process.env.LIMITED_RUN_P;
  assert(mintedRun && mintedRun.serial, 'the minter must return a real numbered run, or the line below is checked against nothing');
  const runBody = { ...plain, car: { ...plain.car, run: mintedRun } };
  const runLine = String(describeFn(runBody, 200));
  said.set('/v1/garage/boost#run', runLine);
  const { serial, cap, name: runName } = runBody.car.run;
  assert(runLine.includes(String(serial)) && runLine.includes(String(cap)) && runLine.includes(runName),
    `THE NUMBERED CAR MUST OUTRANK THE BOOST. Number ${serial} of ${cap} of ${runName} is the rarest `
    + 'thing that can happen to a player, and it reads on its own line — which only works while that '
    + `line RETURNS ahead of the ordinary boost bit. Got: ${JSON.stringify(runLine)}`);
  assert(!runLine.includes(plain.car.name),
    'and it must not degrade into the ordinary line, which names the model and buries the serial');
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
// DECLARING WAR. The pact, the treaty and the oathbreak all state their terms four lines apart in
// the same block; war — a treasury spend that starts a shooting match a rival is notified of — read
// "done." The two facts a boss decides on are what it now carries: what it COST, and what the winner
// takes. The cost is crossed against the SERVER's own figure rather than a catalog literal, because
// the war chest is the base through the coalition discount, the family charter and the Streetboss
// post — a line quoting a catalog price would quote a price nobody paid.
{
  const warUrl = [...said.keys()].find((u) => /^\/v1\/gangs\/war\//.test(u));
  const warLine = said.get(warUrl || ''), warBody = paidBody.get(warUrl || '');
  assert(warLine && warBody, 'the war row never drove — every family able to be fought was pacted, ' +
    'NPC-run or already at war, so this assertion proves nothing. Free a target in the fixture.');
  assert(warLine.includes(asMoney(warBody.cost)) && /war chest|treasury/i.test(warLine),
    `war states what it took out of the war chest — and states the SERVER's figure, since every ` +
    `discount a family brings moves it. Got: ${JSON.stringify(warLine)} over cost ${warBody.cost}`);
  assert(new RegExp(`\\b${Math.round(warBody.spoilsPct * 100)}%`).test(warLine),
    `…and what the winner takes, which is the whole reason to declare. Got: ${JSON.stringify(warLine)}`);
}
// THE RACKET UPGRADE — the forgotten sibling of a buy that has read an hourly rate since it shipped.
// The NEW rate is the point of the purchase, so the line is crossed against `incomePerHr` (already
// per-hour on the reply) and not against the buy's `income`, which is per-MINUTE: the two fields are
// what keep the two branches from cross-firing, and asserting the wrong one would pass on either.
{
  const bUrl = `/v1/rackets/${RACKETS[0].id}/buy`, uUrl = `/v1/rackets/${RACKETS[0].id}/upgrade`;
  const buyLine = said.get(bUrl), upLine = said.get(uUrl), upBody = paidBody.get(uUrl);
  assert(buyLine && upLine && upBody, `the racket pair never drove — an upgrade with no seat under ` +
    `it answers 400 and is skipped, which reads as covered. Got buy=${JSON.stringify(buyLine)} ` +
    `upgrade=${JSON.stringify(upLine)}`);
  assert(upLine.includes(asMoney(upBody.incomePerHr)) && /hour/i.test(upLine),
    `an upgrade is bought FOR the new number and it read a bare price. Got: ${JSON.stringify(upLine)} ` +
    `over incomePerHr ${upBody.incomePerHr}`);
  assert(upLine.includes(String(upBody.level)),
    `…and which rung it now stands on. Got: ${JSON.stringify(upLine)} over level ${upBody.level}`);
}
// THE FRONT'S UPGRADE — the same story on the personal side, found the same way and worse in one
// respect: the reply did not carry the price AT ALL, so a $600,000 move read "the Laundromat moves
// up to tier 2" and the client could not have said otherwise. The pad is the half that matters —
// it is a PERCENTAGE of income, so a tier raises the recurring bill for good, and the buy line one
// branch away has said "mind the pad" since it shipped. Crossed against what the SERVER sent, never
// a literal: a literal passes while the two drift, which is the class this file exists to catch.
{
  const upUrl = [...said.keys()].find((u) => /^\/v1\/business\/[0-9a-f-]+\/upgrade$/.test(u));
  const upLine = said.get(upUrl), upBody = paidBody.get(upUrl);
  assert(upUrl && upLine && upBody, 'the front upgrade never drove — an upgrade with no front under '
    + 'it answers 400 and is skipped, which reads on the summary line exactly like a covered action');
  assert(upLine.includes(asMoney(upBody.cost)),
    `a six-figure purchase must name its price. Got: ${JSON.stringify(upLine)} over cost ${upBody.cost}`);
  assert(upLine.includes(asMoney(upBody.upkeepPerHr)) && /pad/i.test(upLine),
    '…and the pad it just RAISED, which is the recurring bill a tester asked about. Got: '
    + `${JSON.stringify(upLine)} over upkeepPerHr ${upBody.upkeepPerHr}`);
}
// THE DAILY CONTRACT — the most-repeated reward button in the game, and it read "done." over a
// five-figure payout. The ENVELOPE is what it withheld: all three pays 3.5× the cash, 4× the
// respect, refills energy and draws $OMR — one of only TWO ways to earn the token — so a player
// two-for-three has to be told what the third is worth. Both figures come from the server because
// both are level-scaled; the promise is worded "if the fund covers it" because it is drawn from the
// event fund, not minted, and a promise the game cannot keep is worse than a silent one.
{
  const dcUrl = [...said.keys()].find((u) => /^\/v1\/daily\/[a-z0-9]+\/claim$/.test(u));
  const dc = said.get(dcUrl), dcBody = paidBody.get(dcUrl);
  assert(dcUrl && dc && dcBody, 'the daily contract never drove — an unfinished contract answers 400 '
    + 'and is skipped, which reads on the summary line exactly like a covered action');
  assert(dc.includes(asMoney(dcBody.payout)) && dc.includes(asMoney(dcBody.rep)),
    `the day's take and the respect with it. Got: ${JSON.stringify(dc)}`);
  // The fixture GUARANTEES the state this block is about — the claim leaves the set unfinished and
  // the blocked jobs are pre-claimed — so those two are the precondition, and the SERVER'S contract
  // is asserted separately and by name. Ordering matters: put the vacuity relation first and a
  // dropped field blames the FIXTURE for something the server had stopped sending.
  assert(dcBody.all === false && !dcBody.envelopeOutOfReach,
    'this block is vacuous unless the claim leaves the envelope OPEN — the resolver pre-claims the '
    + `blocked jobs to make that true every day of the year. Got: ${JSON.stringify(dcBody)}`);
  assert(dcBody.remaining > 0 && dcBody.allBonus,
    'with the envelope still open the reply must carry the hook — how many are left and what they '
    + `are worth. Both are level-scaled, so the client cannot derive either. Got: ${JSON.stringify(dcBody)}`);
  assert(dc.includes(asMoney(dcBody.allBonus.cash)) && /envelope/i.test(dc),
    '…and what clearing the rest is worth, which is the whole hook and is level-scaled, so the '
    + `client cannot derive it. Got: ${JSON.stringify(dc)} over ${dcBody.allBonus.cash}`);
  assert(/if the event fund covers it/i.test(dc),
    'the $OMR is DRAWN from the event fund and a dry fund pays nothing, so the promise has to be the '
    + `one the game can keep. Got: ${JSON.stringify(dc)}`);
}
// THE DAILY CHECK-IN — the reply carried `pay` and `streak` and nothing else, so the line read
// "+$105,350 (day 1)": the STREAK rendered as a counter when it is the multiplier. Pay climbs
// 100×level for every consecutive day to seven, so day 2 was worth +$30,100 more and the player had
// no way to know — the whole reason to come back, and uncomputable client-side because the formula
// lives on the server. Crossed against what the SERVER sent: `next` is the figure it promises and a
// literal would pass while the two drift.
{
  const ci = said.get('/v1/checkin'), ciBody = paidBody.get('/v1/checkin');
  assert(ci && ciBody, 'the check-in never drove — a second check-in the same day answers 400 and is '
    + 'skipped, which reads on the summary line exactly like a covered action');
  // the SERVER'S contract first, and by name: below the top of the ladder there is always a
  // tomorrow figure, and it is the one number the client cannot derive. Asserting the vacuity
  // relation first would blame the FIXTURE for a field the server had stopped sending.
  assert(ciBody.streak >= 7 || typeof ciBody.next === 'number',
    'the reply must carry what tomorrow pays — the client cannot derive it, the formula is '
    + `level-scaled and lives on the server. Got: ${JSON.stringify(ciBody)}`);
  assert(ciBody.next > ciBody.pay,
    'this block is vacuous unless tomorrow really pays MORE — the whole claim is that the streak is a '
    + `multiplier. Got pay ${ciBody.pay} next ${ciBody.next}`);
  assert(ci.includes(asMoney(ciBody.pay)) && new RegExp(`day ${ciBody.streak}\\b`).test(ci),
    `the day's take and which day it is. Got: ${JSON.stringify(ci)}`);
  assert(ci.includes(asMoney(ciBody.next)) && /tomorrow/i.test(ci),
    '…and what coming back tomorrow is worth, which is the entire hook and the one number the client '
    + `cannot derive. Got: ${JSON.stringify(ci)} over next ${ciBody.next}`);
  // the energy is a DELTA, so a line claiming a constant would be a wrong number at the cap
  if (ciBody.energyGained) assert(new RegExp(`\\+${ciBody.energyGained} energy`).test(ci),
    `…and the energy that really landed. Got: ${JSON.stringify(ci)} over ${ciBody.energyGained}`);
}
// ── THE SHEET LEDGER (12) — the mirror's blind spot, and it is the most-read board in the game.
// The mirror checks what a screen reads off a board it FETCHED, and `me` is not one: it is a module
// global assigned in refresh()/boot(), so every `me.X` read in all ~25 renderers — the money figure,
// the vitals, the chips, the cooldowns, the coach — has never been checked against what /v1/me
// really returns. Found by mutation: renaming a view field left the whole guard green.
//   The tree is CLEAN through the hole (93 reads, 93 real fields), which is what makes this a guard
// rather than a bug report — a renamed or dropped view field would render `undefined` on the sheet
// and on every screen, and nothing would fail. Catalogue-or-declare, like the nine ledgers before it,
// because the one thing a regex cannot tell from a property read is a string that looks like one.
{
  const meNow = (await inject('GET', '/v1/me', token)).body?.character;
  assert(meNow && typeof meNow.name === 'string', 'the sheet ledger needs a real /v1/me to cross against');
  // a quoted literal that HAPPENS to read like a property access. The one in the tree is the Rainbow
  // wallet's EIP-6963 rdns, which is genuinely the string "me.rainbow" and not a field at all.
  const NOT_A_READ = new Set(['rainbow']);
  const reads = new Set();
  for (const m of html.matchAll(/(?<![\w$.])me\??\.([A-Za-z_$][\w$]*)/g)) reads.add(m[1]);
  assert(reads.size >= 80, `the sheet-read extractor found only ${reads.size} — it has stopped `
    + 'reading the client, and a sweep that reaches nothing reads exactly like a sweep that passes');
  const strays = [...reads].filter((k) => !NOT_A_READ.has(k) && !(k in meNow));
  assert(strays.length === 0, `the sheet reads ${strays.length} field(s) /v1/me does not return, so they `
    + `render as undefined on every screen that shows them: ${strays.join(', ')}. Either the view stopped `
    + 'sending them, or they are quoted strings that only look like reads — in which case declare them '
    + 'in NOT_A_READ with the reason, so it is a decision on the record.');
  // the two chrome buttons this ledger was written for: they sit in the always-visible row beside
  // the money figure and said only "heal" and "check in" — a price with the purchase left off, and
  // a ladder invisible until after the money landed. Both are quoted out of the SAME function the
  // till charges from, so what the sheet promises is by construction what the till pays.
  assert(reads.has('healCost') && reads.has('checkin'),
    'the sheet has to quote the Doc\'s bill and the check-in ladder BEFORE the press — neither is '
    + 'derivable client-side (five modifiers on one, a level-scaled ladder on the other)');
  // and the quote AGREES with the till — this fixture has already pressed it (the wave-49 block
  // above), so the sheet is in the state a player sees for the rest of the day, and the hook has to
  // survive it: `next` stands all day, which is the whole "come back tomorrow". Crossed against the
  // reply rather than a literal, because a literal passes while the two drift.
  const ciReply = paidBody.get('/v1/checkin');
  assert(meNow.checkin?.done === true && meNow.checkin.streak === ciReply.streak
    && meNow.checkin.next === ciReply.next,
    'once today is claimed the sheet must say so and still carry tomorrow\'s figure — the quote and '
    // NAME the three fields rather than dumping the reply: an action response carries the whole
    // character envelope, so JSON.stringify(reply) buries the point in kilobytes of unrelated sheet
    + `the till read the same function, so they cannot disagree. Got: ${JSON.stringify(meNow.checkin)} `
    + `against till {streak:${ciReply.streak}, next:${ciReply.next}}`);
  assert(typeof meNow.healCost === 'number' || meNow.healCost === null,
    `the Doc's bill is a number while there is something to patch up and null when there is not — `
    + `never absent, or the button has nothing to quote. Got: ${JSON.stringify(meNow.healCost)}`);
}
// ── WAVE 51: THE SEVENTH OBLIGATION ─────────────────────────────────────────
// The pad branch's own comment enumerated six things that use the word `paid` and claimed `fronts`
// as the pad's alone. There were SEVEN: the FAMILY's territory upkeep is a byte-shape twin
// (`{paid, fronts, stillOwed}`), so a boss settling the family's books out of the TREASURY read
// "paid $24,000 of the pad across 1 front — square" — a bill on a screen they were nowhere near,
// naming fronts they may not own, while their own pad sat unpaid. Found by driving it.
//
// Both replies name their SYSTEM now, because a marker that names the STATE holds only until a
// sibling adds the same field, and absence is no discriminator at all. Driven on the main token
// (which founds a family in ACTIONS) with real arrears, because the nothing-owed path returns a
// different shape and would test neither line.
{
  const upLine = said.get('/v1/territory/upkeep'), up = paidBody.get('/v1/territory/upkeep');
  assert(up && up.paid > 0, 'the family upkeep row must actually have PAID for this to test anything — '
    + 'the nothing-owed path returns a different shape and would assert over the wrong line');
  assert(/famil|treasury/i.test(upLine) && /operation/i.test(upLine),
    'the FAMILY pays its upkeep out of the TREASURY, across OPERATIONS — the personal pad is a '
    + `different book and a different pocket. Got: ${JSON.stringify(upLine)}`);
  assert(!/\bfronts?\b/i.test(upLine),
    'a territory racket is not a front — that word belongs to the personal pad, and printing it here '
    + `is the collision this block exists to catch. Got: ${JSON.stringify(upLine)}`);
  assert(upLine.includes(fmtLike(up.paid)),
    `the line must name what left the treasury (${up.paid}). Got: ${JSON.stringify(upLine)}`);

  const fLine = said.get('/v1/gangs/foundation'), fnd = paidBody.get('/v1/gangs/foundation');
  assert(fnd && fnd.foundation, 'the foundation row must actually have endowed — a skipped row reads '
    + 'on the summary line exactly like a covered one');
  assert(fLine.includes(fmtLike(fnd.reserve)),
    'money out of a POOLED reserve every member tributed into has to say what is left — its own '
    + `sibling the seal does, one line up. Reserve ${fnd.reserve}, got: ${JSON.stringify(fLine)}`);
  assert(fnd.nextFoundation && fLine.includes(fmtLike(fnd.nextFoundation.omr)),
    `and what the next rung costs (${fnd.nextFoundation?.omr}), so the ladder is visible from `
    + `the rung you just bought. Got: ${JSON.stringify(fLine)}`);
}
// THE VAULT — a line that is not silent but FALSE, which is the class no silence pattern can see.
// The rates are asserted against the SERVER's own published `rules.loot` rather than against the
// numbers, so a founder retune moves the assertion with the game; and the prohibition is separate
// from the statement, because a line could drop the claim and still say nothing useful.
{
  const stLine = said.get('/v1/stake'), st = paidBody.get('/v1/stake');
  assert(st && st.staked > 0, 'the stake row must actually have staked for this to test anything — '
    + 'a refused row reads on the summary line exactly like a covered one');
  assert(!/\bsafe\b(?!\w)/i.test(stLine.replace(/never safe|not safe|cheaper cover, never safe/gi, '')),
    'staking is CHEAPER COVER, never safety — the Vault card, the server\'s published note and the '
    + `rules file all say so, and this line said the opposite. Got: ${JSON.stringify(stLine)}`);
  const lootIdle = Math.round((rulesBody.loot?.omrIdle ?? 0) * 100);
  const lootComm = Math.round((rulesBody.loot?.omrCommitted ?? 0) * 100);
  assert(lootIdle > lootComm && lootComm > 0,
    'this block is meaningless unless a staked balance really is looted LESS than a loose one and '
    + `still looted at all — got committed ${lootComm}% against idle ${lootIdle}%`);
  assert(stLine.includes(String(lootComm)) && stLine.includes(String(lootIdle)),
    'and it has to state the real relation off the live rates rather than a mood — a player deciding '
    + `whether to commit needs both numbers. Expected ${lootComm}/${lootIdle}, got: ${JSON.stringify(stLine)}`);
}
// THE COMMITMENT — the lock line must state all three terms: the boost, the one-way window, and
// that it is NOT a loot shield (the retired "staked is safe" harbour must not come back through a
// toast, which is exactly how the stake line above shipped its false claim).
{
  const lkLine = said.get('/v1/stake/lock'), lk = paidBody.get('/v1/stake/lock');
  assert(lk && lk.lock === 'week' && lk.mult > 1, 'the lock row must actually have locked for this '
    + 'to test anything — a refused row reads on the summary line exactly like a covered one');
  assert(lkLine.includes(`×${lk.mult}`) && lkLine.includes(fmtLike(lk.effectiveStake)),
    `the line states the boost — ×${lk.mult} and the effective figure the ladder now reads. Got: ${JSON.stringify(lkLine)}`);
  assert(/cannot come out|stays put/i.test(lkLine),
    `and the one-way window — the whole price of the deal. Got: ${JSON.stringify(lkLine)}`);
  assert(/committed rate/i.test(lkLine) && !/\bsafe\b/i.test(lkLine),
    `and that a killer still loots it — commitment buys rungs, never safety. Got: ${JSON.stringify(lkLine)}`);
}
// THE SAME NEIGHBOURHOOD's other two, found by driving the routes beside the one that was wrong.
// GETTING MADE is a subscription and its line has to carry BOTH terms — the dues and the window —
// because describe() falls through to the server's flavour `message` when nothing matches, and that
// sentence names neither. THE STORE'S $OMR RAIL had no branch at all: a purchase that BURNS $OMR
// reporting neither the price nor what arrived, three lines from a sibling that reads.
{
  const mLine = said.get('/v1/made'), made = paidBody.get('/v1/made');
  assert(made && made.made === true && made.omr > 0,
    'the made row must actually have paid dues — a skipped row reads on the summary line exactly '
    + 'like a covered one, which is how the line beside it stayed wrong for fifty waves');
  assert(mLine.includes(fmtLike(made.omr)),
    `a RECURRING obligation has to name what it just cost (${made.omr} $OMR). Got: ${JSON.stringify(mLine)}`);
  assert(made.madeSeconds > 0 && /\d+\s*[dhm]/.test(mLine),
    'and when it LAPSES — the pad, the nut and the envelope are all here because a recurring cost '
    + `that never states its clock is the game withholding its own terms. Got: ${JSON.stringify(mLine)}`);

  const pLine = said.get('/v1/store/plex/wire_month'), plex = paidBody.get('/v1/store/plex/wire_month');
  assert(plex && plex.omrSpent > 0 && plex.sku,
    'the PLEX row must actually have bought something — the shelf is priced off the ETH fee at the '
    + 'market rate, so an under-funded fixture skips it and the skip reads as coverage');
  assert(pLine.includes(fmtLike(plex.omrSpent)),
    `earned $OMR just burned — the line has to say how much (${plex.omrSpent}). Got: ${JSON.stringify(pLine)}`);
  const grant = (rulesBody.store || []).find((p) => p.sku === plex.sku)?.grant || {};
  assert(grant.wireDays > 0, 'this assertion is meaningless unless the sku actually grants something '
    + `— /v1/rules publishes no wireDays for ${plex.sku}`);
  // ASSERTED AGAINST THE GRANT CLAUSE, not the whole line — the first cut looked for the number
  // anywhere and PASSED under the mutation that deleted the clause, because the sku is NAMED "The
  // Street Wire (30d)" and carries its own 30. A substring that the flavour already supplies proves
  // nothing about the field the fix reads. The clause is what follows the price separator.
  const gotClause = pLine.split('·').slice(1).join('·');
  assert(!gotClause.includes(String(plex.omrSpent).slice(0, 4)),
    'this split is meant to isolate the GRANT from the price — if the price landed in it the check '
    + `below is measuring the wrong half. Got: ${JSON.stringify(gotClause)}`);
  assert(gotClause.includes(String(grant.wireDays)),
    'and WHAT it bought, off the catalog the server already publishes — a player who has just spent '
    + `earned $OMR should not have to go and look it up. Expected ${grant.wireDays} in the clause after `
    + `the price, got: ${JSON.stringify(pLine)}`);
}
// THE COOLING VERBS. The mute check is structurally blind to this one: "heat +55" reads as an
// answer, so nothing here would have caught the game's primary heat-REDUCTION verb reporting an
// INCREASE. What is asserted is the property that was false — the line must describe a DROP, and
// it must cross against the server's own two numbers rather than a literal.
{
  const lay = paidBody.get('/v1/kitchen/laylow');
  const layLine = said.get('/v1/kitchen/laylow') || '';
  // The precondition proves the row RAN, and is deliberately independent of the field naming below —
  // asserting the new fields here would make every mutation fail on the precondition instead of on
  // the assertion that names the class, which is a failure that teaches nothing.
  assert(lay && lay.cost > 0,
    `the laylow row must actually run, or every assertion below is vacuous. Got: ${JSON.stringify(lay && lay.cost)}`);
  assert(lay.cooled > 0 && lay.heatNow !== undefined,
    'lay low must report the DROP (`cooled`) and where it LANDED (`heatNow`). Reporting the level in '
    + 'a field named `heat` is what made this line read as an increase — that name means a delta. '
    + `Got keys: ${JSON.stringify(Object.keys(lay).filter((k) => k !== 'character' && k !== 'events'))}`);
  assert(!/heat \+|\+\d+ heat/.test(layLine),
    'LAY LOW READ AS AN INCREASE. `heat` in a reply means a DELTA (what an action ADDED); this route '
    + 'reported the resulting LEVEL under that name, so the generic formatter rendered the heat left '
    + `OVER as heat gained. Got: ${JSON.stringify(layLine)}`);
  assert(layLine.includes(String(lay.cooled)) && layLine.includes(String(lay.heatNow)),
    'a player who just paid to cool off needs both numbers the server sent — how much came off '
    + `(${lay.cooled}) and where it landed (${lay.heatNow}). Got: ${JSON.stringify(layLine)}`);
  assert(layLine.includes(fmtLike(lay.cost)),
    `…and what it cost (${lay.cost}). Got: ${JSON.stringify(layLine)}`);
  // Clean papers burns the PREMIUM currency, and its price appeared on no screen in the game — not
  // the button, not a confirm, not the reply. The reply carries it now, so the line can state it.
  const cp = paidBody.get('/v1/kitchen/cleanpapers');
  const cpLine = said.get('/v1/kitchen/cleanpapers') || '';
  assert(cp && cp.omr > 0 && cp.cooled > 0,
    `the cleanpapers row must run with real heat to wipe. Got: ${JSON.stringify(cp)}`);
  assert(cpLine.includes(String(cp.omr)) && cpLine.includes(String(cp.cooled)),
    `a $OMR burn must name the spend (${cp.omr}) and what it bought (${cp.cooled} heat wiped). `
    + `Got: ${JSON.stringify(cpLine)}`);
  // and the terms ride with the price: both buttons were unpriced before this wave.
  assert(/rules\?\.cooling/.test(html),
    'the Kitchen buttons must quote the LIVE cooling levers — restating $5,000 or 60 $OMR in the '
    + 'client is how a price drifts from the till that charges it');
}
// WAVE 55 — THE REBUILD. `/v1/respec` burns the premium currency to reshape the three numbers every
// opposed roll in the game reads, and it said "done." Worse than the silence: the 24h cooldown was
// stated on NO screen — the card priced the burn and named no cadence — so a player learned the
// term from the refusal on the tweak they immediately wanted. The reply carries both now, and the
// card states the cadence before you commit (the terms-ride-with-the-price discipline).
{
  const rs = paidBody.get('/v1/respec');
  const rsLine = said.get('/v1/respec') || '';
  assert(rs && rs.stats, `the respec row must actually run, or every assertion below is vacuous. Got: ${JSON.stringify(rs)}`);
  assert(rs.omr > 0 && rs.cooldownSeconds > 0,
    'a paid, rate-limited rebuild must send back what it COST and when the trainer reopens — both '
    + 'were absent, which is why the line could only say "done.". Got keys: '
    + JSON.stringify(Object.keys(rs).filter((k) => k !== 'character' && k !== 'events')));
  assert(rsLine.includes(String(rs.stats.muscle)) && rsLine.includes(String(rs.stats.cunning))
    && rsLine.includes(String(rs.stats.speed)),
    `THE REBUILD SAID NOTHING. A player who just redistributed their build needs to read the build. Got: ${JSON.stringify(rsLine)}`);
  assert(rsLine.includes(fmtLike(rs.omr)), `…and what it cost (${rs.omr} $OMR). Got: ${JSON.stringify(rsLine)}`);
  assert(/reopens|hour|h\b|d\b/.test(rsLine),
    `…and that it is the only one today — the term nobody could see before they spent. Got: ${JSON.stringify(rsLine)}`);
  assert(/rules\?\.respecCdHours/.test(html),
    'the respec card must state the ONCE-A-DAY term before the button is pressed, off the live lever '
    + '— a cadence a player can only discover by being refused is a term withheld from the price');
}
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

// ── WAVE 43 — SOVEREIGNTY END TO END, and the mute line that was hiding a WRONG NUMBER.
// Every stronghold verb was mute or worse: build read `paid $100,000`, upgrade `paid $400,000`,
// collect and the upkeep settle said nothing, and a failed siege rendered the JUMP-failure line
// (both replies carry `dmg`, so the flat if-chain took whichever came first). Two of the four
// facts they withhold are the whole mechanic: `windowHour` is the ONE hour a day the walls can be
// stormed, and `overextension` is the EU4 empire tax that makes holding more ground cost more per
// stronghold.
//
// The sharpest finding is underneath the silence. `siegeSov` DEBITS and LEDGERS a tier-scaled cost
// and returned the flat base — at tier 6 that is $50,000 reported against $1,200,000 actually
// taken, a 24× understatement — and it survived only because the line never printed it. That is
// the strongest argument in this file for reading every reply back rather than only the empty ones:
// a mute line was hiding a wrong number, and no silence pattern can see a figure nobody prints.
//
// Its own block because sovereignty needs a family HOLDING a district, and the siege needs a
// SECOND family standing on it — neither is a thing the shared fixture is or can become.
{
  const mk43 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=90000000, respect=3000000, muscle=90, cunning=90, ' +
      'speed=90, energy=300, health=100 WHERE id=$1', [id]);
    return { t, id }; };
  const L43 = new Map();
  const drive43 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 43 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    L43.set(label, line); said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };

  const hold = await mk43('Ledger Wall '), storm = await mk43('Ledger Storm ');
  const freeD = (await app.pool.query(
    'SELECT id FROM districts WHERE holder_gang IS NULL AND npc_holder IS NULL ORDER BY id LIMIT 1')).rows[0];
  assert(freeD, 'WAVE 43: no unheld district to build a stronghold on');
  const D = freeD.id;
  for (const p of [hold, storm]) await app.pool.query('UPDATE characters SET loc=$2 WHERE id=$1', [p.id, D]);
  const rnd = () => Math.random().toString(36).slice(2, 5).toUpperCase();
  await inject('POST', '/v1/gangs', hold.t, { name: 'Ledger Wall ' + rnd(), tag: 'W' + rnd() });
  const hg = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [hold.id])).rows[0];
  assert(hg, 'WAVE 43: the holding family never founded');
  await app.pool.query('UPDATE gangs SET treasury=900000000 WHERE id=$1', [hg.gang_id]);
  const seized = await inject('POST', `/v1/districts/${D}/seize`, hold.t, null);
  assert.equal(seized.code, 200, `WAVE 43: could not take ${D} (${JSON.stringify(seized.body)})`);

  // the window hour is the DEFENSIVE mechanic — pinned to now so the siege below is inside it
  const nowHour = new Date().getUTCHours();
  await drive43(hold.t, 'POST', `/v1/sov/${D}/build`, { windowHour: nowHour }, 'raise the walls');
  await drive43(hold.t, 'POST', `/v1/sov/${D}/upgrade`, null, 'raise them higher');
  await app.pool.query("UPDATE sov_structures SET income_at = now() - interval '20 hours' WHERE district_id=$1", [D]);
  await drive43(hold.t, 'POST', '/v1/sov/collect', null, 'bank the strongholds');
  await app.pool.query("UPDATE sov_structures SET upkeep_at = now() - interval '40 hours' WHERE district_id=$1", [D]);
  await drive43(hold.t, 'POST', '/v1/sov/upkeep', null, 'keep the walls');

  const built = L43.get('raise the walls');
  assert(/\$[\d,]/.test(built) && /\d\d:00/.test(built),
    `raising a stronghold is a six-figure TREASURY purchase whose defining term is the one hour a day ` +
    `it can be stormed — the reply carries windowHour and the line read "paid $100,000". ` +
    `Got: ${JSON.stringify(built)}`);
  const higher = L43.get('raise them higher');
  assert(/\$[\d,]/.test(higher) && /tier 2|\btier\b/i.test(higher),
    `an upgrade names the tier it bought, or the player cannot tell it from the build. ` +
    `Got: ${JSON.stringify(higher)}`);
  const banked = L43.get('bank the strongholds');
  assert(/\$[\d,]/.test(banked) && /treasur/i.test(banked),
    `collecting names the money and where it went — it is TREASURY income, not the player's own ` +
    `pocket, which is the half a member cannot see on their sheet. Got: ${JSON.stringify(banked)}`);
  const kept = L43.get('keep the walls');
  assert(/\$[\d,]/.test(kept) && /stronghold/i.test(kept),
    `the upkeep settle says what was kept standing for the money. Got: ${JSON.stringify(kept)}`);
  // district NAMES, not ids: `$dist` is declared at the top of describe()'s body for exactly this,
  // and the first cut of these five lines printed the raw id ("cathedral") at the player
  for (const [label, line] of L43)
    assert(!/\b(docks|canal|brick|neon|cathedral|foundry)\b/.test(line),
      `WAVE 43: "${label}" printed a raw district id — every sibling renders the district's NAME ` +
      `through $dist(). Got: ${JSON.stringify(line)}`);

  // ── THE SIEGE, both ways, at the top tier where the cost error is largest. The roll is not pinned
  // (SOV_SIEGE_P is TEST-ONLY and preflight refuses it beside a DATABASE_URL) so both outcomes are
  // driven by retrying with the per-family cooldown cleared — and the TREASURY DELTA is measured on
  // each, because the claim is not "the line mentions money" but "the number it states is the number
  // that left". A literal would pass while the two drifted, which is the class being fixed.
  await inject('POST', '/v1/gangs', storm.t, { name: 'Ledger Storm ' + rnd(), tag: 'S' + rnd() });
  const sg = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [storm.id])).rows[0];
  assert(sg, 'WAVE 43: the storming family never founded');
  await app.pool.query('UPDATE gangs SET treasury=900000000 WHERE id=$1', [sg.gang_id]);
  const outcomes = new Map();
  for (let i = 0; i < 40 && outcomes.size < 2; i++) {
    await app.pool.query('UPDATE sov_structures SET tier=6 WHERE district_id=$1', [D]);
    await app.pool.query('DELETE FROM sov_siege_cooldowns WHERE district_id=$1', [D]);
    await app.pool.query('UPDATE characters SET health=100, energy=300 WHERE id=$1', [storm.id]);
    const before = Number((await app.pool.query('SELECT treasury FROM gangs WHERE id=$1', [sg.gang_id])).rows[0].treasury);
    const r = await inject('POST', `/v1/sov/${D}/siege`, storm.t, null);
    if (r.code >= 400) continue;
    const after = Number((await app.pool.query('SELECT treasury FROM gangs WHERE id=$1', [sg.gang_id])).rows[0].treasury);
    const key = r.body.win ? 'won' : 'lost';
    if (outcomes.has(key)) continue;
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    outcomes.set(key, { line, moved: before - after, said: Number(r.body.cost) });
    said.set(`/v1/sov/${D}/siege#${key}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`POST /v1/sov/:d/siege (${key}) → ${JSON.stringify(line)}`);
  }
  assert(outcomes.size === 2, `WAVE 43: both siege outcomes have to drive — a win-only or loss-only ` +
    `run leaves half the cost fix unexercised and its mutation survives. Got: ${[...outcomes.keys()]}`);
  // the LOSS is the collision: both a failed siege and a failed jump carry `dmg`, and the jump's
  // branch came first, so storming a fortified district read "the jump went bad"
  const lost = outcomes.get('lost').line;
  // `/wall/`, not `/held/`: the fall-through the collision produces is "they held the block", which a
  // loose test for "held" accepts word for word — an assertion that accepts the exact wrong output is
  // not an assertion. The WALLS are the system, and no line in the jump family names them.
  assert(/wall/i.test(lost) && !/jump|the block/i.test(lost),
    `a failed SIEGE is not a failed jump — both replies carry \`dmg\` and the jump's line came first ` +
    `in the chain, so a six-figure assault on a fortified district read as a mugging gone wrong. ` +
    `Got: ${JSON.stringify(lost)}`);

  for (const [key, o] of outcomes) {
    // the finding itself: the reply must state the cost that was actually taken, not the flat base
    assert.equal(o.said, o.moved, `WAVE 43: a siege ${key} reported ${o.said} against a war chest that ` +
      `actually fell by ${o.moved} — the cost is tier-SCALED and the reply returned the flat base, so a ` +
      `family reading its own toast was told a fraction of what a siege cost them`);
    assert(/\$[\d,]/.test(o.line), `a siege ${key} names what it cost the war chest. Got: ${JSON.stringify(o.line)}`);
  }
  assert(/razed|breach|tier/i.test(outcomes.get('won').line) && /sovereign/i.test(outcomes.get('won').line),
    `a won siege says what it did to the walls and what it scored. Got: ${JSON.stringify(outcomes.get('won').line)}`);

  // ── THE SECOND, the third and the fourth: three byte-shape collisions in one wave.
  // A soldier ASSIGN answered a bare {ok, name} — byte-identical to what naming your estate returns,
  // and the estate's branch guards on "exactly one field besides ok" — so putting a man on a job read
  // "the place has a name now". Dismissing him said "done." over the one action that ENDS a paid
  // relationship. And a CONSIGLIERE offer is {ok, to, cost}, which is the MARRIAGE proposal's shape
  // exactly, so hiring an adviser proposed marriage. Each fix names the SYSTEM rather than the state,
  // which is the lesson the deed unlist paid for twice.
  await drive43(storm.t, 'POST', '/v1/soldiers/hire', null, 'hire a soldier');
  const roster = (await inject('GET', '/v1/soldiers', storm.t)).body?.roster || [];
  assert(roster[0], 'WAVE 43: no soldier on the payroll — the two assertions below would skip in silence');
  await drive43(storm.t, 'POST', `/v1/soldiers/${roster[0].id}/assign`, null, 'put him on the job');
  await drive43(storm.t, 'DELETE', `/v1/soldiers/${roster[0].id}`, null, 'off the payroll');
  const onJob = L43.get('put him on the job');
  assert(!/the place has a name/i.test(onJob) && /%/.test(onJob),
    `assigning a second is not naming your estate — and his CUT is the term that makes assigning THIS ` +
    `man a decision. Got: ${JSON.stringify(onJob)}`);
  const gone = L43.get('off the payroll');
  assert(/payroll|walked|gone/i.test(gone) && !/crew/i.test(gone),
    `dismissing a soldier is not dismissing a hired gun from a world raid — that branch reads ` +
    `crew/crewMax alongside and printed "crew undefined/undefined" at the player. ` +
    `Got: ${JSON.stringify(gone)}`);

  await drive43(storm.t, 'POST', `/v1/dynasty/propose/${hold.id}`, null, 'propose a marriage');
  const stormAcc = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [storm.id])).rows[0].account_id;
  await drive43(hold.t, 'POST', `/v1/dynasty/accept/${stormAcc}`, null, 'accept it');
  await drive43(storm.t, 'POST', `/v1/dynasty/consigliere/${hold.id}`, null, 'name a consigliere');
  await drive43(storm.t, 'POST', '/v1/dynasty/divorce', null, 'call it off');
  const proposed = L43.get('propose a marriage');
  assert(/nothing binds|accept/i.test(proposed) && /\$[\d,]/.test(proposed),
    `a proposal costs money NOW and binds nothing until the other side takes it — both halves are ` +
    `terms. Got: ${JSON.stringify(proposed)}`);
  const consig = L43.get('name a consigliere');
  assert(/advis|counsel|envoy/i.test(consig) && !/marriage|bloodline/i.test(consig),
    `hiring an adviser is {ok, to, cost} — byte-identical to a MARRIAGE proposal — so it proposed ` +
    `marriage to them. The marker has to name the system. Got: ${JSON.stringify(consig)}`);
  const divorced = L43.get('call it off');
  assert(/honor|-\d/.test(divorced),
    `walking away from a marriage costs the initiator honor, and that is the whole decision. ` +
    `Got: ${JSON.stringify(divorced)}`);

  // ENDING the arrangement is the FOURTH instance of the same collision, and it is the one that made
  // the fix above unreachable: `endConsigliere` answered a bare {ok, dismissed:true}, and the world
  // raid's hired-gun line fires on ANY truthy `dismissed` and reads crew/crewMax alongside — so a
  // house dismissing its adviser was told "sent a gun home — crew undefined/undefined". Fixed at BOTH
  // halves, the way the previous waves did it: the source names the system, AND the hired-gun branch
  // now requires the crew count it prints, so the NEXT system to answer `dismissed` is not claimed by
  // it either. Both senses are driven, because a branch that renders only one of them is the same bug
  // facing the other way — and `resigned` is reached only from a house that keeps no adviser itself.
  await drive43(hold.t, 'POST', `/v1/dynasty/consigliere/accept/${stormAcc}`, null, 'take the chair');
  await drive43(storm.t, 'DELETE', '/v1/dynasty/consigliere', null, 'dismiss the adviser');
  const third = await mk43('Ledger House ');
  await drive43(third.t, 'POST', `/v1/dynasty/consigliere/${storm.id}`, null, 'a third house asks');
  const thirdAcc = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [third.id])).rows[0].account_id;
  await drive43(storm.t, 'POST', `/v1/dynasty/consigliere/accept/${thirdAcc}`, null, 'counsel them');
  await drive43(storm.t, 'DELETE', '/v1/dynasty/consigliere', null, 'step down');
  for (const label of ['dismiss the adviser', 'step down']) {
    const line = L43.get(label);
    assert(/advis|chair|counsel|house/i.test(line) && !/gun|crew/i.test(line),
      `"${label}" is not sending a hired gun home from a world raid — that branch fires on any truthy ` +
      `\`dismissed\` and prints a crew count this reply has never had. Got: ${JSON.stringify(line)}`);
  }
  assert(L43.get('dismiss the adviser') !== L43.get('step down'),
    `dismissing YOUR adviser and resigning a post you hold in somebody else's house are opposite ` +
    `directions and must not read as the same sentence`);

  // …and the FIFTH: the ESTATE answered `dismissed` too — a staff SLUG, with no crew count — so
  // letting the groundskeeper go read "sent a gun home — crew undefined/undefined".
  const house = await mk43('Ledger Staff ');
  await app.pool.query("UPDATE account_persistent SET omr=900000 WHERE account_id=" +
    '(SELECT account_id FROM characters WHERE id=$1)', [house.id]);
  await drive43(house.t, 'POST', '/v1/estate/upgrade', null, 'buy a place');
  await drive43(house.t, 'POST', '/v1/estate/staff/groundskeeper', null, 'take on a groundskeeper');
  await drive43(house.t, 'DELETE', '/v1/estate/staff/groundskeeper', null, 'let him go');
  const letGo = L43.get('let him go');
  assert(/household/i.test(letGo) && !/gun|crew/i.test(letGo),
    `letting household staff go is not sending a hired gun home from a world raid — the estate sent ` +
    `a bare \`dismissed\` slug and the raid branch claims any truthy one. Got: ${JSON.stringify(letGo)}`);

  // THE DEFENSIVE HALF, and it is honestly UNREACHABLE today. Each of the three collisions above was
  // fixed at its SOURCE, so nothing in the tree sends a truthy `dismissed` without a crew count any
  // more and the guard on the raid branch can no longer fire — a mutation removing it is silent
  // against all three drives above, which is exactly what a first run of it showed. It is kept as
  // defence in depth (the desk's shelf clamp is the precedent: an unreachable guard is worth keeping,
  // an untested one that READS as tested is not), so it is exercised against a labelled SYNTHETIC
  // shape rather than left to look covered by drives that cannot reach it.
  {
    const synthetic = describeFn({ ok: true, dismissed: 'somebody' }, 200);
    assert(!/gun|crew/i.test(synthetic),
      `SYNTHETIC (no route sends this today): a reply carrying \`dismissed\` with no crew count must ` +
      `not be claimed by the world raid's hired-gun line, which prints a crew count it does not have. ` +
      `Three systems shipped that shape and all three were fixed at the source; this holds the branch ` +
      `for the fourth. Got: ${JSON.stringify(synthetic)}`);
  }

  // and the fixers' storylines: STARTING one said "done." while the reply carried the fixer's own
  // opening words verbatim
  // one row at a time, and DELETE-then-INSERT rather than ON CONFLICT: pg-mem parses neither
  // `unnest(ARRAY[...])` nor an upsert reliably (the recorded posture — it reports a conflicting
  // insert as a success), and a seed that silently does nothing leaves the campaign board empty
  await app.pool.query('DELETE FROM npc_standing WHERE character_id=$1', [storm.id]);
  for (const npc of ['doc', 'fixer', 'armorer', 'harbor', 'madame', 'corner'])
    await app.pool.query('INSERT INTO npc_standing (character_id, npc_id, standing, touched_at) ' +
      'VALUES ($1,$2,100,now())', [storm.id, npc]);
  const camp = ((await inject('GET', '/v1/campaigns', storm.t)).body?.campaigns || [])[0];
  assert(camp, 'WAVE 43: no campaign on offer — the assertion below would skip in silence');
  await drive43(storm.t, 'POST', `/v1/campaigns/${camp.id}/start`, null, 'take the fixer\'s job');
  const started = L43.get('take the fixer\'s job');
  assert(started.length > 40 && /"/.test(started),
    `a fixer's storyline opens with what he SAYS — the reply carries it verbatim and the line said ` +
    `"done." Got: ${JSON.stringify(started)}`);
}

// ── WAVE 44 — THE ARMORY, AND THREE CO-OP SYSTEMS THAT ALL ANSWER "id + a crew count".
// The armory half is the forgotten sibling at its plainest: UNEQUIPPING a piece has always read,
// and EQUIPPING one three lines away said "done." — while BUYING one did not even reach the
// catch-all, because the reply says `price` and the catch-all reads `cost`. So the loudest purchase
// on the screen reported nothing: not the iron, not the money, not the CRATES it also costs (iron
// is the one buy that debits two currencies), and not that the first piece you buy goes on your hip.
//
// The co-op half is the byte-shape collision class at its widest. A crew HEIST, a world RAID and a
// prison BREAK all answer plan/join with an id and a crew count, and describe() is a flat if-chain,
// so whichever branch comes first claims all three. Three separate defects fell out of that:
//   · the break's plan and join said "done." — a plan STAKES a $50,000 cutkit and names the crew
//     the wall needs; both are what a man in a cell wants to know;
//   · leaving and disbanding a break read "the RAID goes on without you" / "you called the RAID
//     off", wrong system both ways, with the staked kit's return unmentioned;
//   · and JOINING a heist rendered the heist PLAN line — "$undefined fronted" for an unnamed job —
//     because the plan branch guarded on `role`, which the join also carries. That one has been
//     live since the plan line shipped, and it is here because the join had never been driven.
//
// The first cut of the break fix keyed on the FIELDS (a crew count and an id) and read
// "you're in on the break" for a world RAID — the collision being fixed, reintroduced while fixing
// it, and caught only by driving the sibling shapes. So all six replies now name their own `op` at
// the SOURCE and every branch keys on that: absence is not a discriminator, it holds only until a
// sibling adds the field you were relying on being missing.
//
// Its own block because the break needs two men in CELLS, and jail refuses nearly everything the
// shared fixture goes on to drive.
{
  const mk44 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=90000000, respect=3000000, muscle=90, cunning=90, ' +
      'speed=90, energy=300, health=100, cb=500 WHERE id=$1', [id]);
    return { t, id }; };
  const L44 = new Map();
  const drive44 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 44 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    L44.set(label, line); said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };

  // ── THE ARMORY. Two guns, because the FIRST auto-equips and the second does not, and the line
  // says which — a receipt that claims the wrong one is worse than the silence it replaced.
  const shooter = await mk44('Ledger Iron ');
  const rules44 = (await inject('GET', '/v1/rules')).body;
  const guns44 = rules44.guns || [];
  assert(guns44.length >= 2, 'WAVE 44: the gun catalog is too small to drive first-vs-second');
  await drive44(shooter.t, 'POST', `/v1/armory/gun/${guns44[0].id}/buy`, null, 'buy the first piece');
  await drive44(shooter.t, 'POST', `/v1/armory/gun/${guns44[1].id}/buy`, null, 'buy a second');
  await drive44(shooter.t, 'POST', `/v1/armory/gun/${guns44[1].id}/equip`, null, 'carry the second');
  await drive44(shooter.t, 'POST', '/v1/armory/unequip', null, 'put it away');
  const bought1 = L44.get('buy the first piece');
  assert(/\$[\d,]/.test(bought1) && /crate/i.test(bought1) && /hip/i.test(bought1),
    `iron is the one purchase that debits TWO currencies, and the first piece you buy goes straight ` +
    `on your hip — the reply carries price, crates and equipped, and the line read "done." because ` +
    `the catch-all reads \`cost\` and this reply says \`price\`. Got: ${JSON.stringify(bought1)}`);
  const bought2 = L44.get('buy a second');
  assert(!/hip/i.test(bought2) && /carrying/i.test(bought2),
    `the SECOND piece does not auto-equip — \`equipped\` is the difference between walking out armed ` +
    `and walking out holding it, and a receipt that claims the wrong one is worse than silence. ` +
    `Got: ${JSON.stringify(bought2)}`);
  const carried = L44.get('carry the second');
  assert(/carrying/i.test(carried) && /firepower|\bfp\b/i.test(carried),
    `equipping said "done." while UNEQUIPPING three lines away has always read — and firepower is ` +
    `the only reason to switch. Got: ${JSON.stringify(carried)}`);

  // ── BELLA'S BUYBACK. Her card advertises the tier-3 perk and no button in the game collected it,
  // so the route existed and was unreachable — the orphan-route class, inverted. The reply was also
  // byte-identical to a gun BUY, so selling iron and buying it would have read the same line.
  await app.pool.query(`INSERT INTO npc_standing (character_id, npc_id, standing, touched_at)
    VALUES ($1,'armorer',95,now()) ON CONFLICT (character_id,npc_id)
    DO UPDATE SET standing=95, touched_at=now()`, [shooter.id]);
  await drive44(shooter.t, 'POST', `/v1/underworld/gun/${guns44[1].id}/sell`, null, 'sell it back to Bella');
  const soldBack = L44.get('sell it back to Bella');
  assert(/\$[\d,]/.test(soldBack) && /bella/i.test(soldBack) && !/crate/i.test(soldBack),
    `Bella PAYS you — a buyback is not a purchase, and the two replies were byte-identical. ` +
    `Got: ${JSON.stringify(soldBack)}`);

  // ── THE CREW HEIST. The join is the pre-existing one: it carries a role and a crewNeeded, which
  // is exactly what the PLAN branch guarded on, so it rendered the plan's sentence with the plan's
  // fields missing — "$undefined fronted" for a job with no name.
  const boss = await mk44('Ledger Score '), hand = await mk44('Ledger Hand ');
  const jobs44 = (await inject('GET', '/v1/heists', boss.t)).body?.jobs || [];
  const job44 = jobs44.find((j) => (j.crew || 0) >= 2) || jobs44[0];
  assert(job44, 'WAVE 44: no crew job on the board — both heist assertions would skip in silence');
  const planned = await drive44(boss.t, 'POST', '/v1/heists/plan', { job: job44.id }, 'plan a score');
  await drive44(hand.t, 'POST', `/v1/heists/${planned.body.id}/join`, {}, 'get in on the score');
  const planLine = L44.get('plan a score');
  assert(/\$[\d,]/.test(planLine) && /fronted/i.test(planLine),
    `the score's stake is FRONTED and that term rides the line the leader reads when they pay. ` +
    `Got: ${JSON.stringify(planLine)}`);
  const joinLine = L44.get('get in on the score');
  // The literal "in on the job" was a PROXY for the property; wave 60 gave the join the job's NAME
  // (the reply carried only `job.id`, so it could not say which score you were in on), so the check
  // asserts what it always meant: the join is not the plan's sentence, and carries none of its terms.
  assert(joinLine !== planLine && /in on /i.test(joinLine) && !/fronted/i.test(joinLine),
    `JOINING a score is not planning one — the join carries a role and a crewNeeded, which is what ` +
    `the plan branch guarded on, so it printed the plan's sentence with the plan's fields missing. ` +
    `Got: ${JSON.stringify(joinLine)}`);

  // ── THE BREAK, all four verbs, with a real cutkit staked so the disband's refund is real.
  const lead = await mk44('Ledger Wall2 '), inmate = await mk44('Ledger Cell ');
  for (const p of [lead, inmate])
    await app.pool.query("UPDATE characters SET jail_until = now() + interval '1 hour' WHERE id=$1", [p.id]);
  await app.pool.query(`INSERT INTO pen_contraband (character_id,item,qty) VALUES ($1,'cutkit',2)
    ON CONFLICT (character_id,item) DO UPDATE SET qty=2`, [lead.id]);
  const brk = await drive44(lead.t, 'POST', '/v1/pen/break/plan', null, 'plan the break');
  await drive44(inmate.t, 'POST', `/v1/pen/break/${brk.body.id}/join`, null, 'get in on the break');
  await drive44(inmate.t, 'POST', `/v1/pen/break/${brk.body.id}/leave`, null, 'walk off the break');
  await drive44(lead.t, 'POST', `/v1/pen/break/${brk.body.id}/leave`, null, 'call the break off');
  const brkPlan = L44.get('plan the break');
  assert(/cutkit|kit/i.test(brkPlan) && /\d/.test(brkPlan),
    `planning a break STAKES the cutkit and names the crew the wall needs — both are what a man in ` +
    `a cell is deciding on. Got: ${JSON.stringify(brkPlan)}`);
  // the collision, both verbs, both directions: a break is not a raid and is not a job
  for (const label of ['plan the break', 'get in on the break', 'walk off the break', 'call the break off']) {
    const line = L44.get(label);
    assert(/break/i.test(line) && !/\braid\b/i.test(line) && !/\bthe job\b/i.test(line),
      `"${label}" is a PRISON BREAK — three systems answer plan/join/leave with an id and a crew ` +
      `count, and the flat if-chain gave all three to whichever branch came first, so a jailbreak ` +
      `read as a world raid. Got: ${JSON.stringify(line)}`);
  }
  const called = L44.get('call the break off');
  assert(/hacksaw|rope|kit/i.test(called),
    `disbanding before the go returns the staked cutkit — $50,000 of contraband, unmentioned. ` +
    `Got: ${JSON.stringify(called)}`);
  assert(L44.get('walk off the break') !== called,
    `a MEMBER walking off leaves the break standing and the LEADER calling it off ends it for ` +
    `everyone — opposite senses that must not read as the same sentence`);

  // ── THE DEFENSIVE HALF: the sibling shapes the break's first cut stole. These are SYNTHETIC on
  // purpose — a world raid needs an apex outfit and a co-op crew, which this block is not — and each
  // is the exact reply its route returns, so the guard holds the ordering that a fields-keyed branch
  // broke once already. Without them the mutation that reverts to field-keying is silent here.
  {
    const raidJoin = describeFn({ ok: true, op: 'raid', id: 'r1', npc: 'volkov', crew: 2, crewMax: 4 }, 200);
    assert(/\braid\b|volkov/i.test(raidJoin) && !/break/i.test(raidJoin),
      `SYNTHETIC (the shape /v1/world/raids/:id/join returns): a world raid's join carries an id and ` +
      `a crew count, which is what the break's first cut keyed on — so it read "you're in on the ` +
      `break" for a raid. Got: ${JSON.stringify(raidJoin)}`);
    const raidPlan = describeFn({ ok: true, op: 'raid', id: 'r1', npc: 'volkov', name: 'Volkov', crewMin: 2, crewMax: 4 }, 200);
    assert(/volkov/i.test(raidPlan) && !/break/i.test(raidPlan),
      `SYNTHETIC: opening a raid is not planning a break. Got: ${JSON.stringify(raidPlan)}`);
    const heistJoinFull = describeFn({ ok: true, op: 'heist', id: 'h1', job: 'vault', role: 'muscle', crew: 3, crewNeeded: 0 }, 200);
    assert(/ready to go/i.test(heistJoinFull) && !/undefined/.test(heistJoinFull),
      `SYNTHETIC: the join that FILLS a crew says so — and never renders the plan's missing fields. ` +
      `Got: ${JSON.stringify(heistJoinFull)}`);
  }
}


// ── WAVE 45 — THE KITCHEN'S TWO ENDS, AND A RECEIPT WITH THE PURCHASE LEFT OFF.
// The core drug loop had the same defect at both ends of the burner. COOKING a batch — which debits
// a second currency (crates), the only other action that does being the armory — answered "the batch
// is on the burner" and named none of it: not what was cooking, not how much, not the crates, and
// not WHEN, which is the one thing you need to come back for. And CUTTING the stash rendered the
// COLLECT's line, because both answer with a qty and a quality: the byte-shape collision class, with
// the sting that the two mean opposite things about where that quality went. Cutting is a TRADE —
// more units, weaker product — so a line reporting only the new totals is a receipt for a decision
// it never mentions you made.
//
// The convoy's rig is the catch-all `paid $N`: a price with the purchase left off. A $2m Semi and a
// $40k Panel Van read identically but for the figure, and the UPGRADE named neither which half of
// the truck it built nor how far — which matters most there, because armor and engine are a CHOICE
// and anything not exactly 'engine' falls to armor, so a mistyped track spends the money on the
// other half and reads the same.
//
// Two more that only a drive would find: the Wire's DOSSIER is rendered as a case file on its own
// card and never passes through describe() there — but the raw console posts the same route and
// toasts whatever this makes of it, so the priciest read on the screen answered "done." for a player
// using it. And a world raid's JOIN carried the outfit's ID where its NAME belongs, so the same
// screen read "The Volkov Bratva" when you opened the raid and the raw `volkov` when you joined it.
{
  const mk45 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=900000000, respect=5000000, muscle=90, cunning=90, ' +
      "speed=90, energy=300, health=100, cb=900, loc='docks' WHERE id=$1", [id]);
    return { t, id }; };
  const L45 = new Map();
  // `new RegExp(undefined)` is /(?:)/ — the EMPTY pattern, which matches EVERYTHING. So an assertion
  // of the shape `new RegExp(server.field).test(line)` passes silently the moment that field goes
  // missing, which is the exact mutation it exists to catch: a check that cannot fail reads exactly
  // like a clean bill of health. Found by mutation — stripping the rig's `name` left this block green
  // and the failure fell through to check 8. So every "the line carries what the server sent" test
  // goes through here, which asserts the SERVER SENT IT first and only then that the line says it.
  const carries = (line, value, what, why) => {
    assert(value !== undefined && value !== null && String(value) !== '',
      `WAVE 45: the server sent no ${what} — the line cannot name what was never returned, and an ` +
      `assertion built from an absent value silently matches anything`);
    assert(new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(line)),
      `${why} (server sent ${what}=${JSON.stringify(value)}). Got: ${JSON.stringify(line)}`);
  };
  const drive45 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 45 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    L45.set(label, line); said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };

  // ── THE BURNER. Drive the whole loop, because the cut can only be reached through a batch that
  // did not catch fire — and the fire roll is real, so the collect is retried rather than assumed.
  const cook = await mk45('Ledger Cook ');
  for (let i = 0; i < 4; i++) await inject('POST', '/v1/kitchen/lab/upgrade', cook.t, null);
  await inject('POST', '/v1/kitchen/makings/vim', cook.t, { qty: 60 });
  const cookR = await drive45(cook.t, 'POST', '/v1/kitchen/cook', { drugId: 'vim', qty: 20 }, 'put a batch on');
  const cookLine = L45.get('put a batch on');
  // Every claim is measured against what the SERVER sent, never a literal — a literal passes while
  // the two drift, which is the class this file exists to catch.
  assert(new RegExp(`\\b${cookR.body.qty}\\b`).test(cookLine),
    `the cook says how much is on the burner (server sent qty=${cookR.body.qty}). Got: ${JSON.stringify(cookLine)}`);
  carries(cookLine, cookR.body.name, 'name',
    'the cook says WHAT is on the burner — a drug id and its street name are different words');
  assert(/crate/.test(cookLine),
    `the cook names the CRATES it also spent — iron and the burner are the only two actions that ` +
    `debit a second currency, so a receipt omitting it under-reports the cost. Got: ${JSON.stringify(cookLine)}`);
  assert(/ready in|\d+[hm]/.test(cookLine),
    `the cook says WHEN to come back — the batch is the one thing you have to return for. ` +
    `Got: ${JSON.stringify(cookLine)}`);
  assert(!/\b1 crates\b/.test(cookLine), `"1 crates" — the crate count is pluralised. Got: ${JSON.stringify(cookLine)}`);

  await app.pool.query("UPDATE batches SET done_at = now() - interval '1 hour' WHERE character_id=$1", [cook.id]);
  const got = await drive45(cook.t, 'POST', '/v1/kitchen/collect', null, 'pull it off the burner');
  // The fire roll can take the batch; when it does there is no stash and the cut cannot be driven.
  // Re-cook rather than skip — a skipped assertion reads on the summary line exactly like a passing one.
  if (got.body.fire) {
    await inject('POST', '/v1/kitchen/makings/vim', cook.t, { qty: 60 });
    for (let n = 0; n < 12 && !(await app.pool.query('SELECT 1 FROM stash WHERE character_id=$1', [cook.id])).rows[0]; n++) {
      await inject('POST', '/v1/kitchen/cook', cook.t, { drugId: 'vim', qty: 20 });
      await app.pool.query("UPDATE batches SET done_at = now() - interval '1 hour' WHERE character_id=$1", [cook.id]);
      await inject('POST', '/v1/kitchen/collect', cook.t, null);
      await inject('POST', '/v1/kitchen/makings/vim', cook.t, { qty: 60 });
    }
  }
  assert((await app.pool.query('SELECT 1 FROM stash WHERE character_id=$1', [cook.id])).rows[0],
    'WAVE 45: could not land a batch in the stash — the cut is undrivable, and skipping it would read as covered');
  const cutR = await drive45(cook.t, 'POST', '/v1/kitchen/cut/vim', null, 'step on the product');
  const cutLine = L45.get('step on the product');
  const collectLine = L45.get('pull it off the burner');
  // THE COLLISION, stated as the property rather than as one phrasing: the two actions must not read
  // as each other. Both carry a qty and a quality, which is exactly what a fields-keyed branch sees.
  assert(cutLine !== collectLine,
    `cutting the stash and pulling a batch off the burner rendered the SAME line — they answer with ` +
    `the same two fields and mean opposite things about the quality. Got: ${JSON.stringify(cutLine)}`);
  assert(new RegExp(`\\+${cutR.body.added}\\b`).test(cutLine),
    `the cut says what it ADDED (server sent added=${cutR.body.added}) — the trade is the mechanic. ` +
    `Got: ${JSON.stringify(cutLine)}`);
  assert(new RegExp(fmtLike(cutR.body.cost)).test(cutLine),
    `the cut says what the agent cost (server sent ${cutR.body.cost}). Got: ${JSON.stringify(cutLine)}`);
  assert(String(cutLine).includes(String(cutR.body.quality)),
    `the cut says where the quality LANDED (server sent ${cutR.body.quality}) — that fall is what you ` +
    `paid for the units. Got: ${JSON.stringify(cutLine)}`);

  // ── THE RIG. Both halves fell to `paid $N`, which drive45 itself now treats as mute.
  const hauler = await mk45('Ledger Rig ');
  const rigR = await drive45(hauler.t, 'POST', '/v1/convoy/rig/van', null, 'buy the truck');
  const rigLine = L45.get('buy the truck');
  carries(rigLine, rigR.body.name, 'name',
    'the rig receipt names the truck — a Semi and a Panel Van read identically but for the figure');
  assert(new RegExp(fmtLike(rigR.body.cost)).test(rigLine),
    `the rig receipt states what left the pocket (server sent ${rigR.body.cost}). Got: ${JSON.stringify(rigLine)}`);
  const upR = await drive45(hauler.t, 'POST', '/v1/convoy/rig/upgrade', { track: 'engine' }, 'build the engine');
  const upLine = L45.get('build the engine');
  assert.equal(upR.body.track, 'engine', 'WAVE 45: the fixture asked for the engine and the server built something else');
  assert(/engine/i.test(upLine),
    `the upgrade names WHICH half it built (server sent track=${upR.body.track}) — anything not ` +
    `exactly 'engine' falls to armor, so a mistyped track buys the other half and reads the same. ` +
    `Got: ${JSON.stringify(upLine)}`);
  assert(new RegExp(`\\b${upR.body.level}\\b`).test(upLine),
    `the upgrade says how far it got (server sent level=${upR.body.level}). Got: ${JSON.stringify(upLine)}`);

  // ── THE DOSSIER, driven through the route the raw console posts. The Wire's own card renders a
  // case file and never reaches describe(), so this is the ONLY surface that would have caught it.
  const spy = await mk45('Ledger Spy ');
  const mark = await mk45('Ledger Mark ');
  await app.pool.query('UPDATE account_persistent SET omr=100000 WHERE account_id=' +
    '(SELECT account_id FROM characters WHERE id=$1)', [spy.id]);
  await inject('POST', '/v1/wire/subscribe', spy.t, { tier: 1 });
  const dosR = await drive45(spy.t, 'POST', `/v1/wire/dossier/${mark.id}`, null, 'pull the file');
  const dosLine = L45.get('pull the file');
  assert(String(dosLine).includes(dosR.body.dossier.name),
    `the dossier names the mark (server sent ${dosR.body.dossier.name}). Got: ${JSON.stringify(dosLine)}`);
  assert(String(dosLine).includes(dosR.body.dossier.wealth),
    `the dossier carries the money BAND the server sent (${dosR.body.dossier.wealth}) — banded, never ` +
    `a figure, because an exact one on a read anyone can buy hands a hunter precise kill-EV. ` +
    `Got: ${JSON.stringify(dosLine)}`);
  assert(!/\$[\d,]/.test(String(dosLine).replace(/\d+ \$OMR/, '')),
    `the dossier must never render an exact cash figure — the server sends none and one here would ` +
    `breach the banded-wealth rule. Got: ${JSON.stringify(dosLine)}`);

  // ── THE RAID JOIN, driven for real on BOTH players. The first cut asserted this against a literal
  // object and a mutation stripping the server's `name` SURVIVED — a synthetic passes while the two
  // drift, which is the whole reason the rule is "assert against what the server sent, never a
  // literal". kryl is the cheapest co-op outfit (level 20), so the block's own fixture can reach it.
  const boss = await mk45('Ledger Boss ');
  const gun = await mk45('Ledger Gun ');
  const planR = await drive45(boss.t, 'POST', '/v1/world/kryl/plan', null, 'plan the crew raid');
  const joinR = await drive45(gun.t, 'POST', `/v1/world/raids/${planR.body.id}/join`, null, 'join the crew raid');
  const raidJoin = L45.get('join the crew raid');
  carries(raidJoin, joinR.body.name, 'outfit name',
    'joining a raid names the OUTFIT, not its id — the plan line one screen up reads its name');
  assert(!/\bthe The \b/.test(raidJoin),
    `every outfit's name already carries its article, so "the ${'${name}'} job" doubles it. ` +
    `Got: ${JSON.stringify(raidJoin)}`);
  carries(raidJoin, joinR.body.crew, 'crew size',
    'the join says how many guns are on it — the crew is the whole reason to co-ordinate');

  // and the collision the cut now sits in front of, held from the other side
  {
    const collectShape = describeFn({ ok: true, op: 'collect', fire: false, qty: 20, quality: 0.9 }, 200);
    assert(/pulled 20 units/.test(collectShape) && !/stepped on/.test(collectShape),
      `SYNTHETIC: pulling a batch off the burner is not cutting it. Got: ${JSON.stringify(collectShape)}`);
  }
}

// ── WAVE 46 — A WRONG NUMBER ON THE ONE FIGURE YOU CHECK BEFORE A HIT.
// Every mute line so far has been a line that said nothing. This wave's headline says something and
// it is FALSE: buying ammo answered `{ok, ammo: 30}` where 30 is what the BOX ADDED, and the line
// renders it as a total — "30 on you" — so a player holding 55 rounds was told he had 30. Wrong in
// the direction that gets somebody killed, and invisible to every mute sweep, because a line that
// reads well is exactly what a sweep for silence walks past. The delta and the total were ONE field;
// they are two now, and the fixture below buys twice so they DIFFER — with a fixture that starts at
// zero the two are equal and the assertion passes under the mutation it exists to catch.
//
// Both ammo boxes and the workshop bench also spend CRATES, the second currency, and named neither
// it nor the cash. And fixing the bench nearly shipped a collision: adding `cost` to the craft reply
// makes it byte-identical to the Pen commissary's `{ok, item, cost}`, whose branch sits FIRST — so a
// medkit rolled at the bench would have read "the guard slips you a medkit". Absence is not a
// discriminator: the workshop reply had no `cost` only until it needed to state its price. Both key
// on `op` now, and the assertion below holds the pair from BOTH sides.
//
// The family's two command verbs — promote and kick — both answered "done." A boss with five
// soldiers pressed kick and had to go and re-read the roster to learn which one he had just put on
// the street; a promotion named neither the man nor which way he moved, and demotion runs the same
// route, so up and down read identically.
{
  const mk46 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=900000000, respect=5000000, muscle=90, cunning=90, ' +
      "speed=90, energy=300, health=100, cb=900, loc='docks' WHERE id=$1", [id]);
    return { t, id }; };
  const L46 = new Map();
  const carries46 = (line, value, what, why) => {
    assert(value !== undefined && value !== null && String(value) !== '',
      `WAVE 46: the server sent no ${what} — the line cannot name what was never returned, and an ` +
      `assertion built from an absent value silently matches anything (new RegExp(undefined) is /(?:)/)`);
    assert(new RegExp(String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(String(line)),
      `${why} (server sent ${what}=${JSON.stringify(value)}). Got: ${JSON.stringify(line)}`);
  };
  // the same presence check for a FIGURE — the line thousands-separates, so a raw 2000 never matches
  // the rendered "$2,000" and the assertion fails on its own formatting rather than on the claim.
  const carriesNum46 = (line, value, what, why) => {
    assert(value !== undefined && value !== null && Number.isFinite(Number(value)),
      `WAVE 46: the server sent no ${what} — an assertion built from an absent figure matches anything`);
    assert(new RegExp(fmtLike(value)).test(String(line)),
      `${why} (server sent ${what}=${JSON.stringify(value)}). Got: ${JSON.stringify(line)}`);
  };
  const drive46 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 46 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    L46.set(label, line); said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return r; };

  // ── THE ROUNDS. Buy at the armory FIRST so the bench's box lands on a non-empty belt: with a
  // fixture starting at zero the delta and the total are the same number, and a line rendering the
  // delta as a total passes. The fixture asserts they differ before asserting the line tells them
  // apart — a guard whose precondition it never checked is the vacuity class in its own right.
  const shooter = await mk46('Ledger Rounds ');
  const boxA = await drive46(shooter.t, 'POST', '/v1/armory/ammo', null, 'buy a box at the armory');
  const armLine = L46.get('buy a box at the armory');
  carriesNum46(armLine, boxA.body.cost, 'cost', 'the armory box states what left the pocket');
  const boxB = await drive46(shooter.t, 'POST', '/v1/workshop/ammo', null, 'roll rounds at the bench');
  const benchLine = L46.get('roll rounds at the bench');
  // GROUND TRUTH IS THE DATABASE, not the reply under test. The first cut checked the fixture's
  // precondition against `body.ammo` — so the mutation that restores the bug (report the delta as the
  // total) made the two equal and tripped the PRECONDITION, which then blamed the fixture for a belt
  // that was in fact full. A failure that names the wrong thing is barely better than no failure.
  const belt = Number((await app.pool.query('SELECT ammo FROM characters WHERE id=$1', [shooter.id])).rows[0].ammo);
  assert(belt !== Number(boxB.body.rolled),
    `WAVE 46 fixture: the belt holds exactly what this box added (${belt}), so a total and a delta ` +
    `are the same number here and this block cannot tell them apart`);
  assert.equal(Number(boxB.body.ammo), belt,
    `the reply's total is not what the belt HOLDS (reply ammo=${boxB.body.ammo}, database=${belt}) — ` +
    `the delta and the total were one field, and the line renders it as a total`);
  assert(new RegExp(`\\b${fmtLike(belt)}\\b`).test(benchLine),
    `the rounds line states what you are CARRYING (the belt holds ${belt}) — it renders as a total, ` +
    `and rendering the box's delta there tells a man holding ${belt} rounds he has ` +
    `${boxB.body.rolled}. Got: ${JSON.stringify(benchLine)}`);
  assert(new RegExp(`\\+${fmtLike(boxB.body.rolled)}\\b`).test(benchLine),
    `the rounds line also states what this box ADDED (server sent rolled=${boxB.body.rolled}) — the ` +
    `delta is the receipt. Got: ${JSON.stringify(benchLine)}`);
  assert(/crate/.test(benchLine),
    `rolling rounds at the bench spends a CRATE as well as cash — the second currency, and a receipt ` +
    `omitting it under-reports what the box cost. Got: ${JSON.stringify(benchLine)}`);
  carriesNum46(benchLine, boxB.body.cost, 'cost', 'the bench box states the cash it spent too');

  // ── THE BENCH, and the collision it now sits in front of. Both sides are DRIVEN: the synthetic
  // half of this pair is what let the shape drift in the first place.
  const smith = await mk46('Ledger Smith ');
  const kitR = await drive46(smith.t, 'POST', '/v1/workshop/craft/medkit', null, 'roll a field kit');
  const kitLine = L46.get('roll a field kit');
  carriesNum46(kitLine, kitR.body.cost,
    'cost', 'the bench receipt states the cash — and it is the DISCOUNTED figure, since foundry turf ' +
    'and Bella both cut it before the charge');
  assert(Number.isFinite(Number(kitR.body.crates)),
    `WAVE 46: the bench sent no crate count — crates are the second currency it spends`);
  assert(new RegExp(`\\b${kitR.body.crates}\\b.*crate`).test(kitLine),
    `the bench receipt states the CRATES (server sent crates=${kitR.body.crates}). ` +
    `Got: ${JSON.stringify(kitLine)}`);
  assert(!/\b1 crates\b/.test(kitLine), `"1 crates" — the crate count is pluralised. Got: ${JSON.stringify(kitLine)}`);

  const inmate = await mk46('Ledger Inmate ');
  await app.pool.query("UPDATE characters SET jail_until = now() + interval '2 hours' WHERE id=$1", [inmate.id]);
  const shivR = await drive46(inmate.t, 'POST', '/v1/pen/buy/shiv', null, 'buy from the commissary');
  const shivLine = L46.get('buy from the commissary');
  assert(/guard/i.test(shivLine),
    `the commissary line is the GUARD's, not the bench's — {ok, item, cost} is byte-identical to a ` +
    `crafted consumable and this branch sits first. Got: ${JSON.stringify(shivLine)}`);
  assert(!/guard/i.test(kitLine),
    `the BENCH read as the commissary — the two replies carry the same three fields, so a branch ` +
    `keyed on the fields rather than on the system renders whichever it reaches first. ` +
    `Got: ${JSON.stringify(kitLine)}`);
  carriesNum46(shivLine, shivR.body.cost, 'cost', 'the commissary states the price the guard took');

  // ── THE FAMILY'S TWO COMMAND VERBS, driven on a real two-man roster.
  const don = await mk46('Ledger Don ');
  const sol = await mk46('Ledger Sol ');
  const founded = await inject('POST', '/v1/gangs', don.t,
    { name: 'Ledger Family ' + Math.random().toString(36).slice(2, 6), tag: 'L' + Math.floor(Math.random() * 900 + 100) });
  assert.equal(founded.code, 200, `WAVE 46 could not found the family (${JSON.stringify(founded.body)})`);
  const joined = await inject('POST', `/v1/gangs/${founded.body.gangId}/join`, sol.t, null);
  assert.equal(joined.code, 200, `WAVE 46 could not put a soldier on the roster (${JSON.stringify(joined.body)})`);
  const solName = (await inject('GET', '/v1/me', sol.t)).body.character.name;

  const promR = await drive46(don.t, 'POST', '/v1/gangs/promote',
    { characterId: sol.id, role: 'underboss' }, 'raise a man');
  const promLine = L46.get('raise a man');
  carries46(promLine, promR.body.name, 'name',
    'the promotion NAMES the man — a boss with five soldiers cannot tell which one moved otherwise');
  assert(String(promLine).includes(solName),
    `the promotion names the man the fixture actually raised (${solName}) — the server's own name ` +
    `field is the one the roster shows. Got: ${JSON.stringify(promLine)}`);
  carries46(promLine, promR.body.role, 'role', 'the promotion says what he is now');
  carries46(promLine, promR.body.was, 'former role',
    'the promotion states BOTH ends of the change — demotion runs this identical route, so a line ' +
    'carrying only the new role reads the same whether the man went up or down');

  const kickR = await drive46(don.t, 'POST', '/v1/gangs/kick', { characterId: sol.id }, 'put a man on the street');
  const kickLine = L46.get('put a man on the street');
  carries46(kickLine, kickR.body.name, 'name',
    'the kick NAMES the man — this is the one action whose target you cannot re-read afterwards, ' +
    'because the roster you would check it against is exactly what it just changed');
  assert(String(kickLine).includes(solName),
    `the kick names the man the fixture actually removed (${solName}). Got: ${JSON.stringify(kickLine)}`);
  assert(promLine !== kickLine,
    `raising a man and putting him on the street rendered the SAME line. Got: ${JSON.stringify(kickLine)}`);
}

// ── WAVE 47 — THE NOMINAL AND THE ACTUAL.
// Wave 46 found the first line in this sweep that was not silent but WRONG, and the shape it found —
// a reply field that reports what was ASKED FOR rather than what LANDED — turns out to be a class.
// Two systems clamp, and three sites reported the constant they clamped:
//
//   the yard shave  — a stretch shaves at most to "just walked", so a man with 40 seconds left is
//                     told a full minute came off a sentence that never had a minute in it;
//   the divorce     — honor clamps at HONOR.MIN, so calling it off at -98 costs 2 and the line said
//                     you wore 10; and
//   a campaign vow  — same clamp at the other end: a branch offering +10 honor at 96 moves you 4.
//
// The correct pattern was already in the tree twice over, which is what makes this the forgotten-
// sibling shape rather than an oversight: `bribeGuard` — in the SAME FILE as the yard shave — reports
// the clamped `cut` it actually took, and `breakPact` reports `ch.honor`, the true post-state. So the
// fix goes in the shared function: bumpHonor now returns { honor, applied } — where you landed and
// what actually landed on you — so the truthful pair is the default at all 18 call sites and a
// nineteenth cannot get it wrong by omission. Nothing read the old numeric return.
//
// Two things this block does deliberately. It measures against the DATABASE, never the reply under
// test, because wave 46's first cut checked its own precondition against the reply and the mutation
// that restored the bug tripped the PRECONDITION — blaming the fixture for a belt that was in fact
// full. And it drives each fix from BOTH ends: at the clamp, where the nominal is a lie, and clear of
// it, where the nominal is the truth — a fix that reports zero everywhere would pass a one-sided test.
{
  const mk47 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=900000000, respect=5000000, muscle=90, cunning=90, ' +
      "speed=90, energy=300, health=100, cb=900, loc='docks' WHERE id=$1", [id]);
    return { t, id }; };
  const drive47 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 47 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return { r, line }; };
  const jailLeft = async (id) => {
    const row = (await app.pool.query('SELECT jail_until FROM characters WHERE id=$1', [id])).rows[0];
    return Math.max(0, Math.round((new Date(row.jail_until).getTime() - Date.now()) / 1000)); };

  // ── THE YARD SHAVE, at the clamp. A 40-second stretch cannot give up a full minute.
  const shortCon = await mk47('Nominal Con ');
  await app.pool.query("UPDATE characters SET jail_until = now() + interval '40 seconds' WHERE id=$1", [shortCon.id]);
  const wasLeft = await jailLeft(shortCon.id);
  assert(wasLeft > 0 && wasLeft < PEN.WORK_CUT_S,
    `WAVE 47 fixture: the stretch (${wasLeft}s) must be SHORTER than a work session's nominal cut ` +
    `(${PEN.WORK_CUT_S}s), or the clamp never binds and this block proves nothing`);
  const { r: workR, line: workLine } = await drive47(shortCon.t, 'POST', '/v1/pen/work', null, 'work the yard, nearly out');
  const nowLeft = await jailLeft(shortCon.id);
  const reallyCut = wasLeft - nowLeft;
  assert.equal(Number(workR.body.cutSeconds), reallyCut,
    `the yard shave reports what it ACTUALLY took off — the stretch went ${wasLeft}s → ${nowLeft}s, so ` +
    `${reallyCut}s came off, and it reported ${workR.body.cutSeconds}s. (The nominal is ` +
    `${PEN.WORK_CUT_S}s; reporting THAT tells a man a minute came off a sentence that never had a ` +
    `minute in it — but any other figure is wrong too, which is why this names what it got.)`);
  assert(!/\bTHREW|undefined/.test(workLine), `the yard line rendered a hole. Got: ${JSON.stringify(workLine)}`);

  // ── and clear of the clamp, where the nominal IS the truth. Without this half, a fix that always
  // reported 0 would pass the assertion above.
  const longCon = await mk47('Nominal Con2 ');
  await app.pool.query("UPDATE characters SET jail_until = now() + interval '2 hours' WHERE id=$1", [longCon.id]);
  const { r: work2 } = await drive47(longCon.t, 'POST', '/v1/pen/work', null, 'work the yard, long stretch');
  assert.equal(Number(work2.body.cutSeconds), PEN.WORK_CUT_S,
    `a full stretch gives up the full shave (${PEN.WORK_CUT_S}s) — the clamp must only bite when there ` +
    `is less time left than the shave, never otherwise`);

  // ── THE DIVORCE, at the honor floor and clear of it.
  const marry47 = async (a, b) => {
    const acct = (await app.pool.query('SELECT account_id FROM characters WHERE id=$1', [a.id])).rows[0].account_id;
    const p = await inject('POST', `/v1/dynasty/propose/${b.id}`, a.t, null);
    assert.equal(p.code, 200, `WAVE 47 could not propose (${JSON.stringify(p.body)})`);
    const acc = await inject('POST', `/v1/dynasty/accept/${acct}`, b.t, null);
    assert.equal(acc.code, 200, `WAVE 47 could not accept (${JSON.stringify(acc.body)})`);
  };
  const honorOf = async (id) =>
    Number((await app.pool.query('SELECT honor FROM characters WHERE id=$1', [id])).rows[0].honor);

  const sunk = await mk47('Nominal Wed '), sunkTo = await mk47('Nominal Bride ');
  await marry47(sunk, sunkTo);
  const nearFloor = HONOR.MIN - MARRIAGE.DIVORCE - 2; // two points of room against a ten-point hit
  await app.pool.query('UPDATE characters SET honor=$2 WHERE id=$1', [sunk.id, nearFloor]);
  const hWas = await honorOf(sunk.id);
  assert(hWas + MARRIAGE.DIVORCE < HONOR.MIN,
    `WAVE 47 fixture: honor ${hWas} with a ${MARRIAGE.DIVORCE} hit must cross HONOR.MIN (${HONOR.MIN}), ` +
    `or the clamp never binds and this block proves nothing`);
  const { r: divR, line: divLine } = await drive47(sunk.t, 'POST', '/v1/dynasty/divorce', null, 'call it off, already sunk');
  const hNow = await honorOf(sunk.id);
  assert.equal(Number(divR.body.honor), hNow - hWas,
    `the divorce reports the honor that ACTUALLY landed (${hWas} → ${hNow}, so ${hNow - hWas}) — the ` +
    `flat ${MARRIAGE.DIVORCE} is a thing the game did not do to them`);
  assert.equal(Number(divR.body.honorNow), hNow,
    `the divorce says where they LANDED (database says ${hNow}) — a bare delta at the floor tells you ` +
    `nothing about why it was small`);
  // `\b` does not apply before a minus sign (both sides are non-word), so a negative honor needs an
  // explicit boundary — the first cut asserted \b-100\b against a line that plainly said -100.
  assert(new RegExp(`(^|[^\\d-])${hNow}(?![\\d])`).test(divLine),
    `the line carries where they stand now (${hNow}). Got: ${JSON.stringify(divLine)}`);

  const clear = await mk47('Nominal W2 '), clearTo = await mk47('Nominal B2 ');
  await marry47(clear, clearTo);
  const { r: div2 } = await drive47(clear.t, 'POST', '/v1/dynasty/divorce', null, 'call it off, room to fall');
  assert.equal(Number(div2.body.honor), MARRIAGE.DIVORCE,
    `an unsunk man wears the FULL ${MARRIAGE.DIVORCE} — the clamp must only bite at the floor`);

  // ── THE CAMPAIGN VOW, at the CEILING — the other end of the same clamp, and a different system,
  // so the fix is held at both signs rather than only where it was found. The chain is walked to its
  // choice step directly: reaching it through play needs standing bumps this block has no business
  // manufacturing, and the property under test is what the branch REPORTS, not how you got there.
  {
    const oath = CAMPAIGNS.find((c) => c.steps.some((s) => s.choice && s.choice.some((b) => b.honor > 0)));
    assert(oath, 'WAVE 47: no campaign offers honor on a branch — this block would prove nothing');
    const stepIx = oath.steps.findIndex((s) => s.choice);
    const good = oath.steps[stepIx].choice.find((b) => b.honor > 0);
    const vow = await mk47('Nominal Vow ');
    // the story opens at a standing with its fixer — seed it, and ASSERT the start, because an
    // unasserted setup step that quietly fails leaves the drive below refusing for the wrong reason
    // (it did: `no_choice`, which reads like the fix is broken and is really a missing fixture).
    await app.pool.query(
      'INSERT INTO npc_standing (character_id, npc_id, standing, touched_at) VALUES ($1,$2,100,now()) ' +
      'ON CONFLICT (character_id, npc_id) DO UPDATE SET standing=100', [vow.id, oath.npc]);
    const started = await inject('POST', `/v1/campaigns/${oath.id}/start`, vow.t, null);
    assert.equal(started.code, 200, `WAVE 47 could not start ${oath.id} (${JSON.stringify(started.body)})`);
    const moved = await app.pool.query(
      'UPDATE campaign_progress SET step=$3, done=0 WHERE character_id=$1 AND campaign_id=$2',
      [vow.id, oath.id, stepIx]);
    assert.equal(moved.rowCount, 1, 'WAVE 47: no campaign progress row to walk to the fork');
    // one point of room against a branch worth more than one
    await app.pool.query('UPDATE characters SET honor=$2 WHERE id=$1', [vow.id, HONOR.MAX - 1]);
    assert(good.honor > 1, `WAVE 47 fixture: the branch must offer more honor (${good.honor}) than the ` +
      'single point of room left, or the clamp never binds');
    const hBefore = await honorOf(vow.id);
    const { r: choseR, line: choseLine } = await drive47(vow.t, 'POST',
      `/v1/campaigns/${oath.id}/choose`, { branch: good.id }, 'take the honourable branch, already at the top');
    const hAfter = await honorOf(vow.id);
    assert.equal(hAfter, HONOR.MAX, 'the vow lands you at the ceiling, not past it');
    assert.equal(Number(choseR.body.honor), hAfter - hBefore,
      `the vow reports the honor that ACTUALLY landed (${hBefore} → ${hAfter}, so ${hAfter - hBefore}) — ` +
      `the branch offered ${good.honor}, and it reported ${choseR.body.honor}`);
    assert(!/\+?${good.honor} honor/.test(choseLine) || Number(choseR.body.honor) === good.honor,
      `the line must not advertise the branch's nominal when less landed. Got: ${JSON.stringify(choseLine)}`);
  }

  // ── and the shared function itself, which is where the class was actually fixed: the applied
  // delta and the landing point, from one call, so a nineteenth caller cannot get it wrong.
  {
    const probe = await mk47('Nominal Probe ');
    await app.pool.query('UPDATE characters SET honor=$2 WHERE id=$1', [probe.id, HONOR.MAX - 1]);
    const row = (await app.pool.query('SELECT * FROM characters WHERE id=$1', [probe.id])).rows[0];
    const client = await app.pool.connect();
    try {
      const hit = await bumpHonor(client, row, 50);
      assert.equal(hit.honor, HONOR.MAX, 'bumpHonor lands you at the ceiling, not past it');
      assert.equal(hit.applied, 1, 'bumpHonor reports the ONE point that landed, not the 50 asked for');
    } finally { client.release(); }
  }
}

// ── WAVE 55 — FIVE VERBS, ONE FIELD, AND THE WRONG POCKET.
// `collected` is sent by five income verbs and only TWO of them pay a POCKET. describe() is a flat
// chain over field NAMES, so the three FAMILY collects — territory operations, frontier outposts and
// vassal tribute, every dollar of which lands in the TREASURY — all fell into the personal-business
// line: a boss banking $40,000 of operations income was told he had "collected" it, when he cannot
// spend a dollar of it himself. Frontier and vassals additionally shared one `tributes` line further
// down, so the same figure printed TWICE in one sentence (the wave-36 echo) and a cartel outpost's
// tribute was called "vassal tribute", which is a different system entirely.
//
// The fix is at the SOURCE, on all five: each reply names its own system (`collect: 'business' |
// 'club' | 'territory' | 'frontier' | 'vassals'`) and each branch keys on that. Absence is not a
// discriminator — these five were told apart by which fields they happened to omit, which holds
// exactly until one of them grows a field, and that is how they came to collide.
//
// This block drives all five for real and asserts the PROPERTY rather than the wording: a pocket
// collect must not claim a treasury, a treasury collect must SAY treasury, and no line may print its
// own figure twice. It also carries wave 55's two silences — an estate wing (up to 1,500 $OMR, and
// the line named no price) and the vanity plate (12 $OMR, which read "done." outright).
{
  const mk55 = async (n) => { const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query('UPDATE characters SET cash=900000000, respect=5000000, energy=300, ' +
      "health=100, loc='docks' WHERE id=$1", [id]);
    await app.pool.query('UPDATE account_persistent SET omr=90000 WHERE account_id=' +
      '(SELECT account_id FROM characters WHERE id=$1)', [id]);
    return { t, id }; };
  const drive55 = async (t, m, url, payload, label) => {
    const r = await inject(m, url, t, payload);
    assert.equal(r.code, 200, `WAVE 55 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    said.set(`${url}#${label}`, line);
    if (line === 'done.' || /^paid \$[\d,.]+$/.test(line) || /undefined|NaN|\[object|^THREW/.test(line))
      mute.push(`${m} ${url} (${label}) → ${JSON.stringify(line)}`);
    return { r, line }; };
  // the echo test, and the reason it is a COUNT rather than a wording match: the two shapes that
  // collided both carried the figure, so the failure a player saw was the number stated twice.
  const times = (line, n) => (String(line).match(new RegExp('\\$' + asMoney(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  // ── THE POCKET. A personal front pays the man, and its line must not have picked up a treasury.
  const owner55 = await mk55('Wave55 Owner ');
  const front55 = BUSINESSES[0];
  const bought55 = await inject('POST', `/v1/business/${front55.kind}/buy`, owner55.t, {});
  assert.equal(bought55.code, 200, `WAVE 55 could not buy a ${front55.kind} (${JSON.stringify(bought55.body)})`);
  await app.pool.query("UPDATE businesses SET last_collect_at = now() - interval '6 hours', " +
    "upkeep_at = now() WHERE character_id=$1", [owner55.id]);
  const { r: pocketR, line: pocketLine } = await drive55(owner55.t, 'POST', '/v1/business/collect', null, 'collect a personal front');
  assert(pocketR.body.collected > 0, 'WAVE 55 fixture: the front banked nothing, so the pocket line proves nothing');
  assert.equal(pocketR.body.collect, 'business', 'the personal front must NAME its system — the five collects are told apart by it');
  assert(/collected \$/.test(pocketLine) && !/TREASURY/i.test(pocketLine),
    `a personal front pays the MAN. Got: ${JSON.stringify(pocketLine)}`);

  // ── THE TREASURY, three times. Each must SAY where the money went, and say its figure ONCE.
  const boss55 = await mk55('Wave55 Boss ');
  const founded55 = await inject('POST', '/v1/gangs', boss55.t, { name: 'Wave55 Family ' + Math.random().toString(36).slice(2, 6), tag: 'W' + Math.random().toString(36).slice(2, 5).toUpperCase() });
  assert.equal(founded55.code, 200, `WAVE 55 could not found a family (${JSON.stringify(founded55.body)})`);
  const gang55 = (await app.pool.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [boss55.id])).rows[0].gang_id;
  await app.pool.query('UPDATE gangs SET treasury=90000000 WHERE id=$1', [gang55]);

  // territory: hold the turf, stand up an operation, let a day run.
  const dist55 = DISTRICTS[0].id;
  await app.pool.query('UPDATE districts SET holder_gang=$2 WHERE id=$1', [dist55, gang55]);
  const est55 = await inject('POST', `/v1/territory/${dist55}/establish`, boss55.t, { kind: 'numbers' });
  assert.equal(est55.code, 200, `WAVE 55 could not establish an operation (${JSON.stringify(est55.body)})`);
  await app.pool.query("UPDATE territory_rackets SET last_income_at = now() - interval '10 hours', " +
    'upkeep_at = now(), scrutiny = 0 WHERE district_id=$1', [dist55]);
  const { r: terrR, line: terrLine } = await drive55(boss55.t, 'POST', '/v1/territory/collect', null, 'collect the family operations');
  assert(terrR.body.collected > 0, 'WAVE 55 fixture: the operation banked nothing, so the treasury line proves nothing');
  assert.equal(terrR.body.collect, 'territory', 'the operations collect must NAME its system');
  assert(/TREASURY/i.test(terrLine),
    `family operations pay the TREASURY, not the man — a boss can bank it and still not spend a dollar ` +
    `of it himself, and the line is where he learns that. Got: ${JSON.stringify(terrLine)}`);
  assert.equal(times(terrLine, terrR.body.collected), 1,
    `one collect, one figure. Got: ${JSON.stringify(terrLine)}`);

  // frontier: a held cartel outpost, tribute accrued. Seeded, because routing an apex outfit is a
  // whole co-op raid and what is under test is the LINE, not the rout.
  const outfit55 = WORLD_NPCS[0].id;
  await app.pool.query('INSERT INTO world_npcs (npc_id, strength, held_by_gang, tribute_at) ' +
    "VALUES ($1, 0, $2, now() - interval '20 hours') ON CONFLICT (npc_id) DO UPDATE SET " +
    "held_by_gang=$2, tribute_at = now() - interval '20 hours'", [outfit55, gang55]);
  const { r: frontR, line: frontLine } = await drive55(boss55.t, 'POST', '/v1/world/collect', null, 'collect frontier tribute');
  assert(frontR.body.collected > 0, 'WAVE 55 fixture: no tribute owed, so the frontier line proves nothing');
  assert.equal(frontR.body.collect, 'frontier', 'the frontier collect must NAME its system');
  assert(/TREASURY/i.test(frontLine) && /frontier/i.test(frontLine) && !/vassal/i.test(frontLine),
    `a cartel OUTPOST's tribute is not "vassal tribute" — that is a different system, and the two ` +
    `shared one line. Got: ${JSON.stringify(frontLine)}`);
  assert.equal(times(frontLine, frontR.body.collected), 1,
    `THE ECHO: frontier used to hit the pocket line AND a shared tributes line, printing its figure ` +
    `twice in one sentence. Got: ${JSON.stringify(frontLine)}`);

  // vassals: a conquered NPC family. Seeded for the same reason.
  const vassalId = 'w55vassal' + Math.random().toString(36).slice(2, 6);
  await app.pool.query('INSERT INTO gangs (id, name, tag, npc_flag, held_by_gang, tribute_at, treasury) ' +
    "VALUES ($1, $2, $3, true, $4, now() - interval '20 hours', 0)",
    [vassalId, 'W55 Vassals ' + vassalId.slice(-4), 'V' + vassalId.slice(-3).toUpperCase(), gang55]);
  const { r: vasR, line: vasLine } = await drive55(boss55.t, 'POST', '/v1/npcfamily/collect', null, 'collect vassal tribute');
  assert(vasR.body.collected > 0, 'WAVE 55 fixture: no vassal tribute owed, so this line proves nothing');
  assert.equal(vasR.body.collect, 'vassals', 'the vassal collect must NAME its system');
  assert(/TREASURY/i.test(vasLine),
    `vassal tribute lands in the TREASURY. Got: ${JSON.stringify(vasLine)}`);
  assert.equal(times(vasLine, vasR.body.collected), 1,
    `THE ECHO: vassals hit BOTH the new treasury line and the old shared one. Got: ${JSON.stringify(vasLine)}`);

  // ── THE ESTATE WING. A $OMR burn that named its wing and no price, three lines from a tier line
  // that names three numbers — the forgotten-sibling shape.
  const heir55 = await mk55('Wave55 Heir ');
  const wing55 = ESTATE.FEATURES.slice().sort((a, b) => (a.minTier || 1) - (b.minTier || 1) || a.omr - b.omr)[0];
  assert(wing55, 'WAVE 55: no estate wing in the catalog — this assertion would skip in silence');
  // wings are gated on the compound's TIER, so climb to the cheapest one's floor first. The ladder
  // is sequential, so this is one call per rung — and it must SUCCEED, or the wing below skips and
  // reads on the summary line as covered.
  for (let tier = 1; tier <= (wing55.minTier || 1); tier++) {
    const up = await inject('POST', '/v1/estate/upgrade', heir55.t, {});
    assert.equal(up.code, 200, `WAVE 55 could not climb to estate tier ${tier} (${JSON.stringify(up.body)})`);
  }
  const { r: wingR, line: wingLine } = await drive55(heir55.t, 'POST', `/v1/estate/feature/${wing55.id}`, null, 'build an estate wing');
  assert(wingR.body.omr > 0, `WAVE 55: the server sent no price for the ${wing55.name} — the line cannot ` +
    'name what was never returned, and an assertion built off an absent figure matches anything');
  assert(new RegExp(asMoney(wingR.body.omr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\$OMR').test(wingLine),
    `a wing is a $OMR burn and the line must say what it cost. Got: ${JSON.stringify(wingLine)}`);

  // ── THE VANITY PLATE. It read "done." — 12 $OMR, and describe() has no handle on the garage, so
  // the CAR's name has to ride with the reply (h.owned.cars holds RAW rows, so it is `model_id`).
  const driver55 = await mk55('Wave55 Driver ');
  const carModel = CARS[0].id;
  const carId55 = 'w55car' + Math.random().toString(36).slice(2, 8);
  await app.pool.query('INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ($1,$2,$3,$4,0)',
    [carId55, driver55.id, carModel, TRIMS[0].id]);
  const { r: plateR, line: plateLine } = await drive55(driver55.t, 'POST', `/v1/vanity/plate/${carId55}`, { plate: 'SIX GUN' }, 'engrave a vanity plate');
  assert.equal(plateR.body.car, CARS[0].name,
    `WAVE 55: the plate reply must name the CAR — describe() sees a carId and nothing that can turn ` +
    `one into iron, and reading the VIEW's \`model\` instead of the raw \`model_id\` degrades this to ` +
    `null silently, which is the class this reply exists to close. Got: ${JSON.stringify(plateR.body.car)}`);
  assert(plateLine.includes('SIX GUN') && plateLine.includes(CARS[0].name) &&
    new RegExp(asMoney(VANITY.PLATE_OMR) + ' \\$OMR').test(plateLine),
    `the plate line must name the plate, the iron it went on, and what it cost. Got: ${JSON.stringify(plateLine)}`);
}

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

// ── WAVE 56: THE MISSION LADDER READ AS A TITLE BEING STRIPPED. Driving the undriven routes found
// the byte-shape collision class at its widest yet. `doMission` answers `title: m.title || null`,
// and 27 of the 36 missions carry NO title — so three claims in four fell into describe()'s vanity
// title-CLEAR branch and read "title dropped — just your name from here": the OPPOSITE of what
// happened, at the moment the game paid the biggest respect award it has, and discarding the cash,
// the $OMR (one of only two ways to earn it) and — on the Dockside Heist — the mint credit that IS
// the free path to getting made. The nine that DO carry a title reported the title alone and threw
// the pay away. Fixed at the SOURCE: the reply names its own system (`mission: {id, name}`), which
// is what a discriminator has to be — absence held only until this reply needed a marker.
//
// With it, the freight rail into a monument: the server CLAMPS the units it takes to what the wall
// still needs, and the line read "1 units of freight" — the wrong plural, and naming neither which
// line left the trunk nor which of several goods it was. Every other freight line in the game names
// the good; this one now carries `good` and reads it through goodName.
{
  const mtok = (await inject('POST', '/v1/auth/guest')).body.token;
  await inject('POST', '/v1/character', mtok, { name: 'Wave56 ' + Math.random().toString(36).slice(2, 6) });
  const mid = (await inject('GET', '/v1/me', mtok)).body.character.id;
  const cat56 = (await inject('GET', '/v1/rules', mtok)).body;
  const gun56 = (cat56.guns || []).slice().sort((a, b) => b.fp - a.fp)[0];
  assert(gun56, 'WAVE 56: no gun catalog — the fp-gated missions could not be reached');
  await app.pool.query('INSERT INTO character_guns (character_id, gun_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [mid, gun56.id]);
  await app.pool.query('UPDATE characters SET gun=$2, cash=900000000, respect=5000000, muscle=99, ' +
    "cunning=99, speed=99, energy=300, health=100, loc='docks' WHERE id=$1", [mid, gun56.id]);
  const claim56 = async (id) => {
    await app.pool.query('UPDATE characters SET mission_at=NULL WHERE id=$1', [mid]);
    const r = await inject('POST', `/v1/missions/${id}`, mtok, {});
    assert.equal(r.code, 200, `WAVE 56 could not claim ${id} (${JSON.stringify(r.body)}) — fix the fixture ` +
      'rather than letting it skip, because a skipped claim reads on the summary line as covered');
    described++;
    let line; try { line = String(describeFn(r.body, r.code)); } catch (e) { line = 'THREW: ' + e.message; }
    said.set(`/v1/missions/${id}`, line);
    return { r, line };
  };

  // THE PRECONDITION, asserted rather than assumed: this block is only about a collision that needs
  // an UNTITLED mission, so if the catalog ever carries a title on every rung the check below would
  // pass while proving nothing.
  const cats = (cat56.missions || []);
  const untitled = cats.find((m) => m.id === 'm1');
  assert(untitled && !untitled.title, 'WAVE 56: m1 is expected to carry NO title — that is the case the collision needed');

  const one = await claim56('m1');
  assert(!/title dropped/i.test(one.line),
    'WAVE 56: an untitled mission must not read as a title being STRIPPED — 27 of 36 rungs carry no ' +
    `title, so this was three claims in four telling a player their name was taken as they were paid. Got: ${JSON.stringify(one.line)}`);
  assert(one.r.body.mission && one.r.body.mission.name,
    'WAVE 56: the mission reply must NAME its own system — absence is not a discriminator, and the ' +
    'vanity title branch claimed this reply only because it had no marker of its own');
  assert(one.line.includes(one.r.body.mission.name),
    `WAVE 56: the line must name the job it just paid for. Got: ${JSON.stringify(one.line)}`);
  // asserted against what the SERVER sent, never a literal — the pay is level-scaled and a lever moves it
  assert(one.line.replace(/,/g, '').includes(String(one.r.body.reward.cash)),
    `WAVE 56: the line must name what the mission PAID. Got: ${JSON.stringify(one.line)}`);

  // THE DOCKSIDE HEIST — the rung the coach names as the free path to getting made. It pays $OMR
  // AND a mint credit, and both were being discarded. The account is fresh, so the credit is live.
  const dock = cats.find((m) => m.reward && m.reward.mintCredit);
  assert(dock, 'WAVE 56: no mission grants a mint credit — the free-path assertion would be vacuous');
  const four = await claim56(dock.id);
  assert(four.r.body.reward.mintCredit > 0,
    'WAVE 56 fixture: the account is already minted, so the mint-credit half of this line proves nothing');
  assert(four.r.body.reward.omr > 0, 'WAVE 56 fixture: this rung paid no $OMR, so that half proves nothing');
  assert(/mint credit/i.test(four.line) && /\$OMR/.test(four.line),
    'WAVE 56: the Dockside Heist pays $OMR and the mint credit that is the free path to getting made — ' +
    `both have to reach the player. Got: ${JSON.stringify(four.line)}`);

  // A TITLED rung: the title was the ONE thing the old branch got right, so it must survive the fix,
  // and the pay it used to throw away must arrive with it.
  // `/v1/rules.missions` deliberately does not publish `title` (it is the reward, not the brief), so
  // the precondition comes from the SERVER'S OWN REPLY rather than the catalog: claim the rung and
  // assert it really carried one, or this half would prove nothing about a titled claim.
  const five = await claim56('m5');
  assert(five.r.body.title,
    'WAVE 56 fixture: m5 was expected to award a title — without one, the titled half of this ' +
    'collision is untested and would pass in silence');
  assert(five.line.includes(five.r.body.title),
    `WAVE 56: a titled rung must still name the title. Got: ${JSON.stringify(five.line)}`);
  assert(/respect/i.test(five.line),
    'WAVE 56: the nine titled rungs reported the title ALONE and discarded the pay — the biggest ' +
    `respect award in the game went unmentioned. Got: ${JSON.stringify(five.line)}`);

  // THE FREIGHT RAIL into a monument.
  const good56 = (cat56.goods || [])[0];
  assert(good56, 'WAVE 56: no goods catalog — the freight line could not be driven');
  await app.pool.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,50) ' +
    'ON CONFLICT (character_id, good_id) DO UPDATE SET qty=50', [mid, good56.id]);
  const mega = await inject('POST', '/v1/megaproject/goods', mtok, { goodId: good56.id, qty: 3 });
  assert.equal(mega.code, 200, `WAVE 56 could not lay freight into the wall (${JSON.stringify(mega.body)})`);
  described++;
  const megaLine = String(describeFn(mega.body, 200));
  said.set('/v1/megaproject/goods', megaLine);
  assert(mega.body.good === good56.id,
    'WAVE 56: the freight reply must carry the good — the server clamps the units it takes, so the ' +
    'player needs to know WHICH line left the trunk as well as how many');
  assert(megaLine.includes(good56.name),
    `WAVE 56: the freight line must name the good rather than "units of freight". Got: ${JSON.stringify(megaLine)}`);
  assert(!/\bunits of freight\b/.test(megaLine),
    `WAVE 56: "1 units of freight" was the wrong plural and named nothing. Got: ${JSON.stringify(megaLine)}`);
}

// ── WAVE 57: "THE THE SEMI IS IN THE YARD." A catalog name may carry its own article — 105 of this
// game's catalogs hold at least one rung that begins with "The" — so a line written as `the ${name}`
// doubles it, and it does so on exactly the APEX rung, which is the priciest thing on its screen. The
// $2,000,000 rig read "the The Semi is in the yard"; the server's own refusals read "The The Semi is
// for level 42+" and "The The Semi runs $2,000,000".
//
// It survived every earlier wave for the recorded reason: the ledger DOES drive the rig — with the
// Panel Van, the one rung that cannot show the bug. A driven route is not a read route if the fixture
// picks the case that reads fine either way. So this drives BOTH ends, and the second half is the one
// that matters: the article must still APPEAR on a name that does not supply its own, or the fix is
// wave 10's (drop the article outright) which reads clipped everywhere else.
{
  const apex = CONVOY.RIGS.filter((r) => /^the\s/i.test(r.name)).slice(-1)[0];
  const plain = CONVOY.RIGS.filter((r) => !/^the\s/i.test(r.name))[0];
  // A precondition, not a decoration: with no article-bearing rung in the catalog this whole block
  // passes over a tree where the bug is fully present, which reads exactly like a clean bill of health.
  assert(apex && plain, 'WAVE 57: the rig catalog must carry BOTH an article-bearing rung and a plain ' +
    'one, or neither half of the doubled-article rule is under test');

  const mk57 = async (n) => {
    const t = (await inject('POST', '/v1/auth/guest')).body.token;
    await inject('POST', '/v1/character', t, { name: n + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t)).body.character.id;
    await app.pool.query("UPDATE characters SET cash=900000000, respect=5000000, loc='docks' WHERE id=$1", [id]);
    return { t, id };
  };
  const drive57 = async (t, url, label) => {
    const r = await inject('POST', url, t, null);
    assert.equal(r.code, 200, `WAVE 57 could not drive ${label} (${JSON.stringify(r.body)}) — fix the ` +
      'fixture rather than letting it skip, because a skipped action reads on the summary line as covered');
    described++;
    const line = String(describeFn(r.body, 200));
    said.set(`${url}#${label}`, line);
    return { r, line };
  };

  // ONE rig per character, so the two rungs need two fixtures.
  const rich = await mk57('Ledger Apex ');
  const apexDrive = await drive57(rich.t, `/v1/convoy/rig/${apex.id}`, 'buy the apex rig');
  assert.equal(apexDrive.r.body.name, apex.name,
    'WAVE 57 fixture: the server did not sell the article-bearing rung, so the doubled article is untested');
  assert(!/\bthe\s+the\s/i.test(apexDrive.line),
    `WAVE 57: a name that already carries "The" must not be given a second one — the apex rig read ` +
    `"the The Semi is in the yard". Got: ${JSON.stringify(apexDrive.line)}`);
  assert(apexDrive.line.includes(apex.name),
    `WAVE 57: the line must still NAME the rig. Got: ${JSON.stringify(apexDrive.line)}`);

  const poor = await mk57('Ledger Plain ');
  const plainDrive = await drive57(poor.t, `/v1/convoy/rig/${plain.id}`, 'buy the plain rig');
  assert(new RegExp(`\\bthe ${plain.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(plainDrive.line),
    `WAVE 57: the article must still appear on a name that does NOT supply one — dropping it outright ` +
    `is the wave-10 fix and reads clipped ("Panel Van is in the yard"). Got: ${JSON.stringify(plainDrive.line)}`);

  // THE SERVER'S OWN REFUSALS, which a player reads far more often than the receipt: describe() shows
  // body.message first, so these ARE the line. Driven from a fixture that can afford neither.
  const broke = await mk57('Ledger Broke ');
  await app.pool.query('UPDATE characters SET cash=100, respect=100 WHERE id=$1', [broke.id]);
  const lvl = await inject('POST', `/v1/convoy/rig/${apex.id}`, broke.t, null);
  assert.equal(lvl.body.error, 'level', `WAVE 57 fixture: expected the level refusal (${JSON.stringify(lvl.body)})`);
  assert(!/\bthe\s+the\s/i.test(lvl.body.message),
    `WAVE 57: the level refusal doubled the article. Got: ${JSON.stringify(lvl.body.message)}`);
  await app.pool.query('UPDATE characters SET respect=5000000 WHERE id=$1', [broke.id]);
  const cash = await inject('POST', `/v1/convoy/rig/${apex.id}`, broke.t, null);
  assert.equal(cash.body.error, 'cash', `WAVE 57 fixture: expected the cash refusal (${JSON.stringify(cash.body)})`);
  assert(!/\bthe\s+the\s/i.test(cash.body.message),
    `WAVE 57: the cash refusal doubled the article. Got: ${JSON.stringify(cash.body.message)}`);
  assert(cash.body.message.includes(apex.name),
    `WAVE 57: the refusal must name the rung it refused. Got: ${JSON.stringify(cash.body.message)}`);
}

// ── WAVE 58: THE EDGE RUNG. Wave 57's real finding was not a mute button — it was that a DRIVEN
// route can still be an UNREAD route, because the fixture picked the one rung that reads fine
// either way (the Panel Van, never The Semi). That is a class, not an instance, so this wave asked
// the question of every catalog-backed value this ledger drives: where does the rung it picks sit
// in its own catalog? Seven of them drive the FIRST rung, and two of those catalogs turned out to
// be identified by their KEY rather than their name on every line that reports a result.
//
// THE CARTEL OUTFITS. `raidNpc` and the co-op `executeRaid` answered `npc: fixture.id`, and four
// describe() lines plus four feed lines rendered it — so the deepest PvE content in the game read
// "raided the dockrats", "cracked the kryl 3-handed", "the volkov held". All FIVE outfit names
// begin with "The" (The Dock Rats … The Volkov Bratva), so this is wave 57's class arriving from
// underneath: naming them naively would have read "raided the The Dock Rats". The plan line nine
// lines up already knew — its own comment says every outfit's name carries its own article — while
// its three siblings printed a raw key. Two of the four FEED lines (world_routed, frontier_seized)
// already shipped the name, so the same feed named the same outfit two different ways.
//
// THE PORT ROUTES, the same shape with a second edge on top: `launchRun` answered `route: route.id`
// and the line appended a noun — "cast off on the coastal run" — so the apex rung, whose real name
// is "The Deep Run", would have read "the The Deep Run run" the moment it was named. The name says
// it; the noun goes.
//
// Both are fixed at the SOURCE (the reply names the outfit and the route) because the client has no
// catalog of either — the same reason `npcName`/`taskLabel`/`goodName` ship from the server. The
// outfit key is `outfit` and NOT `npcName`: that one is claimed by an early Underworld branch in
// describe() (`body.ok && body.npcName` returns a FAVOR line), which is the collision this sweep
// keeps finding — so the marker names the system rather than reusing a word already spoken for.
{
  const { WORLD_NPCS, PORT } = await import('../src/rules.js');
  const outfits = Object.values(WORLD_NPCS);
  const solo = outfits.find((f) => !f.coop);
  const routes = Object.values(PORT.ROUTES);
  const firstRoute = routes[0];
  const apexRoute = routes[routes.length - 1];
  // The preconditions, asserted rather than assumed: without an article-bearing outfit name and a
  // pair of routes where ONE carries its own article and one does not, every claim below passes
  // over a tree where the whole class is present.
  assert(solo && /^the\s/i.test(solo.name),
    'WAVE 58: the solo outfit must carry its own article, or the doubling half is untested');
  assert(apexRoute && /^the\s/i.test(apexRoute.name) && !/^the\s/i.test(firstRoute.name),
    'WAVE 58: the port catalog must hold BOTH an article-bearing route and a plain one, or one half ' +
    'of the article rule is untested');

  const mk58 = async (prefix) => {
    const g = await inject('POST', '/v1/auth/guest', null, {});
    const t = g.body.token;
    await inject('POST', '/v1/character', t, { name: prefix + Math.random().toString(36).slice(2, 6) });
    const id = (await inject('GET', '/v1/me', t, null)).body.character.id;
    await app.pool.query(
      'UPDATE characters SET cash=900000000, respect=6000000, energy=999, nerve=999, ammo=99999, ' +
      'muscle=200, cunning=200, speed=200, world_raid_at=NULL, hosp_until=NULL WHERE id=$1', [id]);
    return { t, id };
  };
  const drive58 = async (t, url, label, payload) => {
    const r = await inject('POST', url, t, payload || null);
    assert.equal(r.code, 200, `WAVE 58 could not drive ${label} (${JSON.stringify(r.body)}) — a skipped ` +
      `row reads on the summary line exactly like a covered one`);
    described++;
    const line = String(describeFn(r.body, 200));
    said.set(`${url}#${label}`, line);
    return { r, line };
  };

  const hunter = await mk58('Ledger Outfit ');
  // The roll is PINNED, and that is not a convenience. Driven live, this block passed on luck: a raid
  // that FAILS renders a different branch entirely, so the assertion below rested on a probabilistic
  // precondition — the recorded flake shape, and the mutation run is what exposed it (M1 failed
  // reporting "driven off — 20m in the hospital", a line with no outfit in it at all). Both outcomes
  // are driven, because a name dropped on the losing line is the same defect as one dropped on the
  // winning line and only one of them was ever going to turn up by chance.
  const clearRaid = () => app.pool.query(
    'UPDATE characters SET world_raid_at=NULL, hosp_until=NULL, energy=999, ammo=99999 WHERE id=$1', [hunter.id]);
  process.env.WORLD_RAID_P = '1';
  await clearRaid();
  const raid = await drive58(hunter.t, `/v1/world/${solo.id}/raid`, 'raid the outfit');
  assert.equal(raid.r.body.success, true,
    'WAVE 58 fixture: the roll is pinned to a win, so a loss here means the knob stopped being read');
  process.env.WORLD_RAID_P = '0';
  await clearRaid();
  const repel = await drive58(hunter.t, `/v1/world/${solo.id}/raid`, 'get driven off the outfit');
  delete process.env.WORLD_RAID_P;
  assert.equal(repel.r.body.success, false, 'WAVE 58 fixture: the repel roll is pinned to a loss');
  assert(repel.line.includes(solo.name),
    `WAVE 58: the LOSING line drops the outfit too — a repel read "driven off" and named nobody, ` +
    `while the reply carried the name all along. Got: ${JSON.stringify(repel.line)}`);
  assert(!/\bthe\s+the\s/i.test(repel.line),
    `WAVE 58: the repel line doubles the article. Got: ${JSON.stringify(repel.line)}`);
  assert.equal(raid.r.body.outfit, solo.name,
    `WAVE 58: the raid reply must NAME the outfit — the client has no catalog of the cartels, so with ` +
    `only the key it can print nothing but the key. Got: ${JSON.stringify(raid.r.body.outfit)}`);
  assert(raid.line.includes(solo.name),
    `WAVE 58: the deepest PvE content in the game read "raided the ${solo.id}" — a raw key where a ` +
    `name belongs. Got: ${JSON.stringify(raid.line)}`);
  assert(!/\bthe\s+the\s/i.test(raid.line),
    `WAVE 58: every outfit's name already carries its own article, so naming it naively reads ` +
    `"raided the ${solo.name}". Got: ${JSON.stringify(raid.line)}`);

  // THE PORT, at BOTH edges — because the two rungs prove different halves of the same rule, and
  // either one alone passes over the other's failure.
  const captain = await mk58('Ledger Port ');
  await inject('POST', '/v1/port/boat/cigarette', captain.t, null);
  await inject('POST', '/v1/travel/docks', captain.t, null);
  const boatId = (await app.pool.query('SELECT id FROM boats WHERE character_id=$1 LIMIT 1', [captain.id])).rows[0]?.id;
  assert(boatId, 'WAVE 58 fixture: no boat, so neither route can be driven');
  const runs = {};
  for (const route of [firstRoute, apexRoute]) {
    await app.pool.query('UPDATE boats SET run_until=NULL, run_route=NULL WHERE character_id=$1', [captain.id]);
    await app.pool.query('UPDATE characters SET hosp_until=NULL, health=100, energy=999 WHERE id=$1', [captain.id]);
    runs[route.id] = await drive58(captain.t, `/v1/port/run/${boatId}`, `cast off on ${route.id}`, { route: route.id });
  }
  assert.equal(runs[apexRoute.id].r.body.routeName, apexRoute.name,
    `WAVE 58: the launch reply must NAME the route — the client has no catalog of the sea lanes`);
  assert(runs[apexRoute.id].line.includes(apexRoute.name) && !/\bthe\s+the\s/i.test(runs[apexRoute.id].line),
    `WAVE 58: the apex lane is "${apexRoute.name}" and the line read "cast off on the ${apexRoute.id} run" — ` +
    `a key, and one that reads "the ${apexRoute.name} run" the moment it is named. ` +
    `Got: ${JSON.stringify(runs[apexRoute.id].line)}`);
  assert(new RegExp(`\\bthe ${firstRoute.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(runs[firstRoute.id].line),
    `WAVE 58: the article must still appear on a lane whose name does NOT supply one — dropping it ` +
    `outright is the wave-10 fix and reads clipped. Got: ${JSON.stringify(runs[firstRoute.id].line)}`);
}

// ── WAVE 59: THE EDGE RUNG, CONTINUED. Wave 58 fixed two of the seven catalogs its extractor found
// driven at rung 1. These are two more, and they are the same shape one loop over: `cook` has NAMED
// its drug since wave 45 and its three siblings never did, so the whole kitchen — buy the makings,
// pull the batch, work the corner — read one sentence whichever of the EIGHT lines you were running,
// and the ten trade goods read "bought 2 at $190 a unit" whether it was the $190 crate or the $2,249
// one. Neither client line could have said otherwise: `describe()` has no drug catalog at all, and
// the goods reply carried no id to resolve. So the fix is at the SOURCE on all five replies, and the
// regression drives BOTH edges of each catalog, because driving one rung is exactly what let this
// hide for as long as it did.
{
  const { DRUGS, GOODS, TRADE_RANKS, KITCHENS } = await import('../src/rules.js');
  const cheapDrug = DRUGS[0], apexDrug = DRUGS[DRUGS.length - 1];
  const cheapGood = GOODS[0], apexGood = GOODS[GOODS.length - 1];
  assert(cheapDrug.id !== apexDrug.id && cheapGood.id !== apexGood.id,
    'WAVE 59: both catalogs must hold two distinct rungs, or driving "both edges" drives one');
  assert(apexDrug.unlock > 0,
    'WAVE 59 fixture: the apex drug is rank-gated, so the fixture must buy that rank — if this ever ' +
    'stops being true the setup below is doing nothing and the apex rung is untested');

  const g = await inject('POST', '/v1/auth/guest', null, {});
  const t59 = g.body.token;
  await inject('POST', '/v1/character', t59, { name: 'Ledger Lines ' + Math.random().toString(36).slice(2, 6) });
  const id59 = (await inject('GET', '/v1/me', t59, null)).body.character.id;
  const topRank = TRADE_RANKS[TRADE_RANKS.length - 1].at;
  const topLab = KITCHENS[KITCHENS.length - 1].id;
  await app.pool.query(
    "UPDATE characters SET cash=900000000, respect=6000000, energy=999, nerve=999, cb=500, " +
    "trade_rep=$2, lab=$3, loc='canal' WHERE id=$1", [id59, topRank * 2, topLab]);

  const drive59 = async (url, label, payload) => {
    const r = await inject('POST', url, t59, payload || null);
    assert.equal(r.code, 200, `WAVE 59 could not drive ${label} (${JSON.stringify(r.body)}) — a skipped ` +
      `row reads on the summary line exactly like a covered one`);
    described++;
    const line = String(describeFn(r.body, 200));
    said.set(`${url}#${label}`, line);
    return { r, line };
  };

  // THE KITCHEN, at the cheapest line and the apex line.
  for (const d of [cheapDrug, apexDrug]) {
    const mk = await drive59(`/v1/kitchen/makings/${d.id}`, `makings ${d.id}`, { qty: 20 });
    assert.equal(mk.r.body.name, d.name,
      `WAVE 59: the Supplier's reply must NAME the line — the client has no drug catalog, so with only ` +
      `the price it can print nothing but "lots of makings". Got: ${JSON.stringify(mk.r.body.name)}`);
    assert(mk.line.includes(d.name),
      `WAVE 59: buying makings read "20 lots of makings" for every one of the ${DRUGS.length} lines. ` +
      `Got: ${JSON.stringify(mk.line)}`);

    await drive59('/v1/kitchen/cook', `cook ${d.id}`, { drugId: d.id, qty: 5 });
    await app.pool.query("UPDATE batches SET done_at=now() - interval '1 hour' WHERE character_id=$1", [id59]);
    const col = await drive59('/v1/kitchen/collect', `collect ${d.id}`, null);
    assert.equal(col.r.body.name, d.name,
      `WAVE 59: pulling the batch must NAME what came off the burner. Got: ${JSON.stringify(col.r.body.name)}`);
    assert(col.line.includes(d.name),
      `WAVE 59: the collect read "pulled 5 units at q1.1" — the same sentence for every line. ` +
      `Got: ${JSON.stringify(col.line)}`);

    await app.pool.query('UPDATE characters SET nerve=999, heat=0 WHERE id=$1', [id59]);
    const deal = await drive59('/v1/kitchen/deal', `deal ${d.id}`, { drugId: d.id, qty: 3 });
    assert.equal(deal.r.body.name, d.name,
      `WAVE 59: the corner deal must NAME what moved. Got: ${JSON.stringify(deal.r.body.name)}`);
    assert(deal.line.includes(d.name) && /\b3\b/.test(deal.line),
      `WAVE 59: the deal read "moved product — +$470" — neither the line nor the units. ` +
      `Got: ${JSON.stringify(deal.line)}`);
  }

  // THE TRADE GOODS, at both edges. The id is enough here — the client resolves it through goodName
  // off the published catalog, which is why this asserts the reply carries the ID and the LINE
  // carries the NAME: two different claims, and only the pair proves the resolution actually happens.
  await app.pool.query("UPDATE characters SET loc='docks', cash=900000000 WHERE id=$1", [id59]);
  for (const gd of [cheapGood, apexGood]) {
    const buy = await drive59('/v1/goods/buy', `buy ${gd.id}`, { goodId: gd.id, qty: 2 });
    assert.equal(buy.r.body.good, gd.id,
      `WAVE 59: the goods reply carried NO id at all, so the client could not have named it. ` +
      `Got: ${JSON.stringify(buy.r.body.good)}`);
    assert(buy.line.includes(gd.name),
      `WAVE 59: buying read "bought 2 at $190 a unit" for all ${GOODS.length} lines. ` +
      `Got: ${JSON.stringify(buy.line)}`);
    const sell = await drive59('/v1/goods/sell', `sell ${gd.id}`, { goodId: gd.id, qty: 1 });
    assert.equal(sell.r.body.good, gd.id, `WAVE 59: the sell reply must carry the id too`);
    assert(sell.line.includes(gd.name),
      `WAVE 59: selling read "sold 1 at $190 a unit". Got: ${JSON.stringify(sell.line)}`);
  }
}

// ── WAVE 60: THE RAW-KEY CLASS, on lines the ledger ALREADY DRIVES. Every one of these routes has
// been in ACTIONS for waves, and every one passed check 8 — because check 8 catches a line that says
// NOTHING, and these said something fluent and wrong. `the laundro is yours` on a racket purchase
// (the client's "resolver" was `String(id).replace(/_/g,' ')`, which resolves nothing: 18 of 18
// racket ids have no underscore at all, so it printed the lowercase key); `the payroll came off HOT`
// on the biggest co-op payout in the game; `you're walking the gun path`. The source-side guard is
// THE RAW-KEY LEDGER in test/gates.js; this is the other half — it reads the rendered line back.
//
// The precondition is asserted for each: a catalog whose name EQUALS its id would make the assertion
// vacuous, and it would pass over a tree with the bug fully present.
{
  const pairs = [
    ['racket buy',    [...said.keys()].find((u) => /^\/v1\/rackets\/.+\/buy$/.test(u)),     RACKETS],
    ['racket upgrade',[...said.keys()].find((u) => /^\/v1\/rackets\/.+\/upgrade$/.test(u)), RACKETS],
    ['asset buy',     [...said.keys()].find((u) => /^\/v1\/assets\/.+\/buy$/.test(u)),      ASSETS],
    ['asset sell',    [...said.keys()].find((u) => /^\/v1\/assets\/.+\/sell$/.test(u)),     ASSETS],
  ];
  let checked = 0;
  for (const [label, url, catalog] of pairs) {
    if (!url) continue;                       // the fixture may not reach it; the floor below bites
    const id = url.split('/')[3];
    const entry = catalog.find((x) => x.id === id);
    assert(entry, `WAVE 60: ${label} drove ${url} but ${id} is in no catalog — the fixture moved`);
    assert.notEqual(entry.name.toLowerCase(), id.replace(/_/g, ' '),
      `WAVE 60 precondition: ${label}'s catalog rung is named the same as its id, so this assertion `
      + 'cannot tell a name from a key. Pick a rung whose name differs.');
    const line = said.get(url);
    assert(line && line.includes(entry.name), `WAVE 60: ${label} must NAME the rung — the client has no `
      + `catalog handle, so with only the id it can print nothing but "${id}". Got: ${JSON.stringify(line)}`);
    assert(!new RegExp(`\\b${id}\\b`).test(line), `WAVE 60: ${label} still renders the raw id `
      + `"${id}" at the player. Got: ${JSON.stringify(line)}`);
    checked++;
  }
  const pathLine = said.get('/v1/path');
  if (pathLine) {
    const p = PATHS[0];
    assert(pathLine.includes(p.name), `WAVE 60: declaring a Path read "the ${p.id} path" — the trade `
      + `has a NAME (${p.name}) and the reply now carries it. Got: ${JSON.stringify(pathLine)}`);
    checked++;
  }
  const labLine = said.get('/v1/kitchen/lab/upgrade');
  if (labLine) {
    assert(!/\b(bathtub|cellar|basement)\b/.test(labLine), `WAVE 60: the lab line renders the raw bench `
      + `key. Got: ${JSON.stringify(labLine)}`);
    checked++;
  }
  // The WIRE half, as a labelled SOURCE tripwire: `port_bust` is a notification, so it cannot be
  // driven through act() — and it printed "the Coast Guard took the deeprun run", a raw lane key on
  // the one line that tells a smuggler what the Coast Guard just cost them.
  assert(/port_bust:.*routeName/.test(html), 'the port_bust wire line must read the route NAME the '
    + 'reply now carries — with only the id it prints "the deeprun run" at the player');
  // anti-vacuity: with none of these driven the loop above asserts nothing and the block reads as a
  // pass — the declared-but-never-driven shape this file has been bitten by three times.
  assert(checked >= 5, `WAVE 60 checked only ${checked} raw-key lines — the fixture stopped driving `
    + 'them, and an undriven row reads on the summary line exactly like a covered one.');
  console.log(`  ✓ wave 60: ${checked} catalog lines name the rung instead of its key`);
}

// ── check 13: THE COLLISION LEDGER ─────────────────────────────────────────────────────────────
// The eleventh catalogue-or-declare ledger, over the class this file has fixed BY HAND fifteen times
// and never swept: describe() is a flat chain over field NAMES, so a reply whose field-set happens to
// satisfy another system's branch gets that system's line. The failures are FLUENT AND FALSE — a
// booked title fight read "they call you true now", buying a loan claim read "took over the club —
// $undefined paid", a rival racket raid read "$undefined out of the war chest" for a bill it never
// charges — so no silence sweep can see them, and every one was found by a person driving that one
// route. The rule: run every act()-reachable reply shape through the REAL describe() and record which
// branch claimed it. A branch claimed by replies from more than one MODULE is either a line the game
// deliberately shares (declared here, with the property that makes it safe) or a collision.
//
// THE CORPUS BOUND IS LOAD-BEARING, and the first cut had none: sweeping every `return {` in src/
// drags in board rows, mod reads and internal helpers — replies that can never reach describe() at
// all — and ~40% of the candidates were that noise, which is the state that makes a guard people
// route around. The bound is decidable: a reply describe() renders is the reply of a route the
// console POSTs or DELETEs, so the corpus is literals returned by a function CALLED inside a
// mutating route registration. 508 of 1218 literals; the 710 dropped are exactly the boards.
//
// Shapes come from the REAL PARSER (a Proxy global + sentinel values), never a hand-rolled key
// scanner — the one written first invented keys that no module sends, because it walked template
// literals naively. Waivers are keyed on the branch's own SOURCE TEXT, never its line number: a
// line-keyed waiver rots on any edit above it, which this repo has paid for once already.
{
  const routeSrc = [...readdirSync('src/routes').map((f) => `src/routes/${f}`), 'src/server.js'];
  const MUT = new Set();
  for (const f of routeSrc) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/app\.(post|delete)\(\s*'([^']+)'/g)) {
      let d = 0, end = m.index;
      for (let j = t.indexOf('(', m.index); j < Math.min(t.length, m.index + 6000); j++) {
        if (t[j] === '(') d++; else if (t[j] === ')' && --d === 0) { end = j; break; }
      }
      for (const c of t.slice(m.index, end).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) MUT.add(c[1]);
    }
  }
  assert(MUT.size > 200, `the mutating-route scan found only ${MUT.size} handlers — it is broken, not the routes`);

  // top-level function spans by brace matching, so a literal is credited to the function that really
  // encloses it. The first cut took the nearest PRECEDING declaration and credited replies to inner
  // helpers (`uid`, `deadlockToRetry`), which dropped 92% of the corpus and every real finding.
  const spans = (t) => {
    const out = [];
    for (const m of t.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/gm)) {
      const i = t.indexOf('{', m.index); if (i < 0) continue;
      let d = 0, end = -1;
      for (let j = i; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}' && --d === 0) { end = j; break; } }
      if (end > 0) out.push({ name: m[1] || m[2], start: m.index, end });
    }
    return out;
  };
  const MARK = Symbol('sentinel');
  const mk = () => new Proxy(function () {}, {
    get: (t, k) => (k === MARK ? true : k === Symbol.toPrimitive ? () => 1 : mk()),
    apply: () => mk(), construct: () => mk(),
  });
  const shapeOf = (lit) => {
    try {
      const g = new Proxy({}, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : mk()) });
      const o = vm.runInNewContext(`with (g) { (${lit}) }`, { g }, { timeout: 300 });
      if (!o || typeof o !== 'object') return null;
      const out = {}; for (const k of Object.keys(o)) out[k] = o[k];
      return out;
    } catch { return null; }
  };
  const isSentinel = (v) => (typeof v === 'function' || (v && typeof v === 'object')) && v[MARK] === true;

  // the same describe(), with every `return` and every `bits.push` reporting which one fired.
  const hits = [];
  const dLines = DESCRIBE.lines.map((l, n) => l
    .replace(/\breturn (?!;)/g, `return __hit(${DESCRIBE.dStart + n}),`)
    .replace(/\bbits\.push\(/g, `__bp(${DESCRIBE.dStart + n},bits)(`));
  const traced = vm.runInNewContext(
    `((rules, __hit, __bp) => { ${DESCRIBE.helpers.join('\n')}\n${dLines.join('\n')}\n return describe; })`,
  )(DESCRIBE.rulesBody,
    (n) => { hits.push(n); return undefined; },
    (n, b) => (...a) => { hits.push(n); return b.push(...a); });

  const files = [...readdirSync('src').filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
    ...readdirSync('src/social').map((f) => `src/social/${f}`)];
  const claims = new Map();   // branch line → module → { at, line }
  let corpus = 0;
  for (const f of files) {
    const base = f.split('/').pop();
    const t = readFileSync(f, 'utf8');
    const sp = spans(t);
    for (const m of t.matchAll(/return\s*\{/g)) {
      const i = t.indexOf('{', m.index);
      let d = 0, lit = null;
      for (let j = i; j < Math.min(t.length, i + 6000); j++) {
        if (t[j] === '{') d++; else if (t[j] === '}' && --d === 0) { lit = t.slice(i, j + 1); break; }
      }
      if (!lit) continue;
      const fn = (sp.filter((x) => i >= x.start && i <= x.end)[0] || {}).name;
      if (!fn || !MUT.has(fn)) continue;
      corpus++;
      const shape = shapeOf(lit); if (!shape) continue;
      const keys = Object.keys(shape); if (keys.length < 2) continue;
      const at = `${base}:${t.slice(0, i).split('\n').length} ${fn}()`;
      // three sentinel substitutions, because a branch can test the TYPE as well as the presence
      for (const sent of [1, 'x', [1]]) {
        const body = {}; for (const k of keys) body[k] = isSentinel(shape[k]) ? sent : shape[k];
        hits.length = 0;
        let line; try { line = traced(body); } catch { continue; }
        for (const h of new Set(hits)) {
          if (!claims.has(h)) claims.set(h, new Map());
          if (!claims.get(h).has(base)) claims.get(h).set(base, { at, line });
        }
      }
    }
  }
  assert(corpus > 300, `the collision corpus fell to ${corpus} replies — the route-reachability bound `
    + 'is over-tight and the sweep is measuring almost nothing, which reads exactly like a clean tree');
  assert(claims.size > 200, `only ${claims.size} describe() branches ever fired — the instrumentation `
    + 'is broken, not the client');

  // DELIBERATELY SHARED LINES. Each is a decision on the record: the property that makes the line
  // right for every system that lands on it. A branch NOT in here that two modules reach is either a
  // new collision or a new shared line — and either way somebody has to say which.
  const SHARED = new Map([
    ["return bits.length ? bits.join(' · ')", 'the final catch-all — by design the last resort for every system'],
    ["if (body.paid > 0 && body.bought === undefined", 'the bare-price catch-all: every obligation that has said nothing else'],
    ["if (body.cost && body.fixed === undefined", 'the same catch-all on the other field name'],
    ["return body.collect === 'territory' ?", 'the empty-till family — each collect names its own system in the line'],
    ["} else if (body.collected && (body.collect === 'business'", 'the pocket collects: the marker enumerates both deliberately'],
    ['bits.push((body.jailSeconds ?', 'BUSTED is one outcome shared by every crime; the raid adds its own hospital line'],
    ['bits.push(`${won} ${body.you.score}', 'the score line carries the MARGIN, which is what a manager acts on in any sport'],
    ["return `${body.op === 'breakout' ?", 'crew disband — each op names itself through `op` (wave 44)'],
    ['if (body.left === true) return', 'crew leave — same marker, same reason'],
    ['return body.value >= body.cap', 'the trainer is one man for the fighter and the animal alike'],
    ['if (body.win === false && body.hospSeconds !== undefined)', 'guards drove you off — the convoy and the port both have guards'],
    ['if (body && body.hired && body.fee != null) return', "the hired gun is one market; each op sends its own crew/crewMax"],
    ['if (body.revived) bits.push', 'a revive token absorbs a killing blow the same way in a cell or on the street'],
    ["if (body.kill) bits.push(`THEY'RE DONE."], // a shank and a shot both end a street
  ]);
  const used = new Set();
  const declared = (src) => { const k = [...SHARED.keys()].find((x) => src.includes(x)); if (k) used.add(k); return !!k; };
  const bad = [];
  let sharedSeen = 0;
  for (const [h, mods] of claims) {
    if (mods.size < 2) continue;
    const src = (DESCRIBE.lines[h - DESCRIBE.dStart] || '').trim();
    if (declared(src)) { sharedSeen++; continue; }
    bad.push(`\n  ${src.slice(0, 110)}\n    claimed by ${[...mods].map(([m, v]) => `${v.at} → ${JSON.stringify(v.line).slice(0, 70)}`).join('\n                ')}`);
  }
  assert(bad.length === 0, 'THE COLLISION LEDGER: a describe() branch is claimed by replies from more '
    + 'than one system. Either the reply needs a marker naming its OWN system (never the absence of a '
    + "field — absence holds only until a sibling grows it), or the line is deliberately shared and "
    + `belongs in SHARED with the reason:${bad.join('')}`);
  // anti-vacuity, two of them because they fail differently: the first catches a corpus/instrumentation
  // break (nothing is being compared), the second a SHARED list that has drifted off the branches it
  // names — a stale key silently stops waiving and a rewritten branch silently stops being governed.
  const stale = [...SHARED.keys()].filter((k) => !used.has(k));
  assert(stale.length === 0, `these declarations match no shared branch any more — a rewritten branch `
    + `silently stops being governed, and a stale key waives nothing:\n  ${stale.join('\n  ')}`);
  console.log(`  ✓ collision ledger: ${corpus} act()-reachable replies over ${claims.size} describe() `
    + `branches — ${sharedSeen} deliberately shared, none colliding`);
}

// ── WAVE 61 — the lines the collision ledger's fixes now produce. The ledger above proves each is
// claimed by ONE system; these pin what it SAYS, because a marker that routes a reply to a branch
// saying the wrong thing is the same defect one step later. Synthetic on the exact shapes the
// servers return (the shapes themselves are what the ledger walks out of src/), because setting up a
// title bout, a two-family racket raid and a rival's run at sea for one sentence each is a fixture
// bigger than the wave.
{
  const say = (b) => describeFn(b, 200);
  // the booked card — announce and the accepted callout. `title: true` used to land on VANITY's
  // title-clear branch and render the boolean: "they call you true now".
  const bout = say({ ok: true, bout: 'b1', card: 'Kid Malone vs Bo Dunn', titleBout: true, closesSeconds: 1800 });
  assert(/TITLE FIGHT/.test(bout) && /Kid Malone vs Bo Dunn/.test(bout) && /closes in/i.test(bout),
    `the accepted callout must name the CARD and when betting closes. Got: ${bout}`);
  assert(!/they call you/.test(bout), `a booked bout is not a nickname. Got: ${bout}`);
  assert(/they call you The Undertaker/.test(say({ ok: true, title: 'The Undertaker' })),
    'the vanity title line still reads for the system it was written for');
  // buying loan PAPER read as taking over a speakeasy, with $undefined for a price it never sends
  const paper = say({ ok: true, paper: 'bought', price: 50000, toSeller: 49000, take: 1000, owed: 60000 });
  assert(/50,000/.test(paper) && /60,000/.test(paper) && !/club/.test(paper) && !/undefined/.test(paper),
    `buying paper must state what it cost and what the debt now owes YOU. Got: ${paper}`);
  // the rival racket raid charges no war chest; it read "$undefined out of the war chest"
  const raid = say({ ok: true, op: 'racket', district: 'docks', win: false, dmg: 12 });
  assert(!/war chest/.test(raid) && !/undefined/.test(raid) && /12 damage/.test(raid),
    `a rival racket raid must not bill a war chest it never charges. Got: ${raid}`);
  assert(/war chest/.test(say({ ok: true, win: false, district: 'docks', dmg: 15, cost: 1200000 })),
    'the SOV siege — which does charge one — still says so');
  // piracy fell to the generic WIN, which reads `net`: an $88,000 haul rendered "+$0"
  const pir = say({ ok: true, op: 'piracy', win: true, take: 88000, route: 'deeprun', routeName: 'The Deep Run' });
  assert(/88,000/.test(pir) && /The Deep Run/.test(pir) && !/\+\$0\b/.test(pir),
    `a hijack at sea must state the haul. Got: ${pir}`);
  // the shared hired-gun line renders crew/crewMax and the heist sent no crewMax
  const gun = say({ ok: true, id: 'h', job: 'payroll', name: 'Payroll Van', role: 'gun', hired: true, fee: 20000, crew: 2, crewMax: 3, crewNeeded: 1 });
  assert(/crew 2\/3/.test(gun), `the hired gun states the crew it filled out of. Got: ${gun}`);
  assert(/crewMax: job\.crew/.test(readFileSync(new URL('../src/heists.js', import.meta.url), 'utf8')),
    'fillHeist sends crewMax — without it the shared line reads "crew 2/undefined"');
  // a street race wore a boxing glove (the wave-58 class), and stated its money twice
  const race = say({ ok: true, game: 'street', win: true, wager: 5000, rake: 250, net: 4750, you: { car: 'x', score: 88 }, them: { score: 80 } });
  assert(/\u{1F3C1}/u.test(race) && !/\u{1F94A}/u.test(race), `a car race is not a bout. Got: ${race}`);
  assert(race.match(/4,750/g).length === 1, `the net is stated ONCE, not by every branch that lands. Got: ${race}`);
  // the club lines hardcoded "the " in front of a name that already carries one (the wave-57 class)
  const club = say({ ok: true, district: 'neon', paid: 600000, toSeller: 588000, tier: 2, name: 'The Copa' });
  assert(/over The Copa/.test(club) && !/the The/.test(club), `the article rides with the name. Got: ${club}`);
  console.log('  ✓ wave 61: eight lines the collision fixes now produce read for their own system');
}

// ── WS RECONNECT BACKOFF (bulletproof audit) — a labelled SOURCE tripwire. A fixed 4s retry made
// every open tab re-dial IN STEP after a server restart: a reconnect herd of simultaneous WS
// upgrades at exactly the moment the box is coldest. The client must retry on a JITTERED
// EXPONENTIAL schedule and reset it on a successful open. Source-level because a real WS close
// cannot be manufactured through inject — the mobile harness owns the browser; this guards the
// backoff against silent deletion.
{
  assert(!/setTimeout\(connectWs,\s*\d+\)/.test(html),
    'the WS reconnect must not be a fixed-delay retry — that is the reconnect herd the backoff replaced');
  assert(/wsRetryMs/.test(html) && /Math\.pow\(/.test(html.slice(html.indexOf('wsRetryMs'), html.indexOf('wsRetryMs') + 400)),
    'the WS reconnect uses the jittered exponential wsRetryMs schedule');
  assert(/onopen\s*=\s*\(\)\s*=>\s*\{\s*wsRetries\s*=\s*0/.test(html),
    'a successful open RESETS the backoff — an ordinary blip must still reconnect fast');
}

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
  `server's own canCommand, and both answered 400 rank. And the ELEVENTH, the same class on a wall `+
  `a player raises themselves: a safehouse is a shield, not a bunker, so ${shieldStats.routes} routes `+
  `that turn what you own into money refuse while you are to ground — and the ${shieldStats.markup} `+
  `data-do plus ${shieldStats.wired} wired take-controls reaching one now each read that state, the `+
  `figure still on screen because it is the reason to surface. The Empire read "$120,017 READY TO `+
  `COLLECT - collect before the pad or a raid eats it" over a live button while the server answered `+
  `safe, on a screen whose own warning advises going to ground.`);
