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
//
// Both the player console and /admin are covered. The dashboard is the one the founder would be
// holding during an incident, so a dead button there surfaces at the worst possible moment.
//
// Both are checked STATICALLY against the server's own truth — fastify's mounted-route registry and
// the rules catalogs — so there are no side effects, no ordering, and no flake. The alternative,
// firing every control at a live server, cannot tell "the client sent nonsense" apart from "you
// can't afford it", and a check that cannot tell those apart reports noise until someone deletes it.
//
// WHAT THIS DOES NOT CHECK, so a green run is not read as more than it is: whether a button is
// wired to the RIGHT route (only that its route exists — the four dead ones found on the first run
// were each traced to the correct HANDLER by hand), whether a REQUIRED field is missing rather than
// misnamed, or whether the action then behaves correctly. Those need the gameplay suites, which exist.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { M3, M4, PATHS, NPC_HITMEN, HEIST_ROLES, HEIST_JOBS, DRUGS, GOODS, DISTRICTS,
  COMMISSION, CONVOY, DUELS, TERRITORY_TYPES } from '../src/rules.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
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
    handlerFields.set(`${m[1].toUpperCase()} ${m[2]}`, wholeBody && !fields.size ? followBody(body) : fields);
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

await app.close();
console.log(`✅ client wiring test passed — across the console AND /admin: of ${refs.size} routes they can ` +
  `call, ${refs.size - dynamic.length} resolve to a really-mounted route (segment-wise, so ` +
  `/v1/streets/:id/jump cannot match /v1/streets/roster) and the ${dynamic.length} that build their ` +
  `action at runtime are expanded over every value the client can pick — ${runtimeChecked.length} ` +
  `concrete routes, all mounted, none left unverifiable; all ${checked.length} catalog-backed values they hardcode ` +
  `are ids the server recognises; and every field in ${sends.length} request bodies is one its own ` +
  `route actually reads — including the ones that hand the whole body to a module, followed a file ` +
  `deeper to the parameter it lands in — through a barrel re-export if it takes one. ` +
  `Those are the three ways a button dies silently — this has found four dead routes and seven ` +
  `ignored fields, among them a broken action, an ammo box sold by a control that asked for a ` +
  `quantity it could not honour, and an unstake box that emptied the whole stake whatever you typed. ` +
  `${Object.keys(CATALOGS).length} fields have ` +
  `catalogs and every other literal field is either an i18n key or declared not-an-API-value, so a ` +
  `new one forces that decision instead of being skipped in silence.`);
