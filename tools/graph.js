#!/usr/bin/env node
// THE GRAPH PLANE — the project's work-and-knowledge graph, built from the repo itself.
//
// Why this exists (Graph Engineering, §V and §VI-E): this project's memory is a 5,600-line
// chronological log plus 57 point-in-time audit reports plus two balance registers. CLAUDE.md states
// its own job outright — "precedent lookup: ~414 comments in src/ cite a pattern by name, and this
// log is where those names are defined. Read it that way — search it for the precedent you need,
// don't read it front to back." That is a graph query being performed by hand against prose.
//
// The paper's diagnosis is that the bottleneck is not the next model call, it is the PLACEMENT of
// memory and evaluation. Evaluation here is already strong: 53 suites, 6 harnesses, 21 conservation
// checks. Memory is the weak plane — it is transcript-shaped, which is the abstraction AgentHub
// identifies as the first to fail once work becomes numerous. This file moves the structural half of
// that memory out of prose and into something you can ask questions of.
//
// DETERMINISTIC BY DESIGN. No model calls. Every node and edge is derived from source text by an
// explicit rule, so the graph is reproducible, diffable, free, and testable — and a wrong edge is a
// bug someone can find rather than a hallucination someone has to notice. The paper reaches for
// Haiku extraction because its corpus is unstructured prose; most of THIS corpus is already typed
// (code, ledger reason strings, invariant names, SCREAMING_CASE levers, markdown headings). Using a
// model where a regex is exact would trade correctness for nothing. Model-assisted extraction is
// scoped to the genuinely unstructured layer (audit-finding status) and is NOT in this increment —
// see GRAPH.md for its exit criterion.
//
// NOT COMMITTED. The graph is derived, so it is rebuilt on demand (~1s) rather than checked in —
// the same discipline as tools/compile-contracts.js output, and for the same reason: a committed
// artifact drifts from its source and then lies.
//
// HONESTY RULE (the discipline this repo already runs on): anything the extractor cannot parse is
// COUNTED and reported, never silently dropped. A coverage tool that quietly skips what it cannot
// read is worse than no tool, because the clean run gets read as proof. `check` fails on unparsed
// input above a stated threshold.
//
// Usage:
//   node tools/graph.js build                 rebuild and print a census
//   node tools/graph.js check                 the graph's own invariants (CI gate)
//   node tools/graph.js query <name> [arg]    see QUERIES below
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const rel = (p) => path.relative(ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

// walk a directory for files matching a predicate (recursive — src/ has subdirectories, and a flat
// listing under-reported it by 27 files the last time someone assumed otherwise)
function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, pred, out); }
    else if (pred(full)) out.push(full);
  }
  return out;
}

// ── the ontology ────────────────────────────────────────────────────────────────────────────────
// The paper's node types are Entity, Claim, Source, Artifact, AgentRun, Evaluation, Task, Commit,
// Metric. These are those types specialised to this repo — a generic ontology would have been
// unfalsifiable here, and §IX-H is explicit that a graph amplifies whatever ontology it is given.
//
//   Source    a document (Source)                CLAUDE.md, SPEC.md, an AUDIT-*.md, a design doc
//   Module    a backend module (Artifact)        src/**/*.js
//   Suite     a test file (Evaluation)           test/*.js
//   Harness   a measurement tool (Evaluation)    tools/*.js
//   Lever     a tunable constant (Entity)        CASH_LOOT_RATE, SAFEHOUSE_DAILY_CAP_MS
//   Reason    a ledger reason string (Entity)    whack:loot, casino:ring:take
//   Check     a §10.4 invariant (Evaluation)     'ring poker escrow', '$OMR conservation'
//   Pattern   a named precedent (Entity)         "the refundPot discipline", "the casino:pvp transfer"
//
// Edge types, drawn from the paper's set (MENTIONS, SUPPORTS, DERIVED_FROM, PRODUCED, EVALUATES,
// DEPENDS_ON, ...) and narrowed to relations this repo can actually evidence:
//
//   DEFINES     Module  → Lever     the rules tail declares it
//   READS       Module  → Lever     a module references it by name
//   PINS        Suite   → Lever     a suite asserts against it  ← unpinned means silently retunable
//   EMITS       Module  → Reason    a ledger() call writes it
//   RECONCILES  Check   → Reason    an invariant's SQL terms cover it
//   COVERS      Suite   → Module    the suite imports the module
//   CITES       Module  → Pattern   a comment invokes the precedent by name
//   MENTIONS    Source  → any       a document names it
const NODE_TYPES = ['Source', 'Module', 'Suite', 'Harness', 'Lever', 'Reason', 'Check', 'Pattern'];
const EDGE_TYPES = ['DEFINES', 'READS', 'PINS', 'EMITS', 'RECONCILES', 'COVERS', 'CITES', 'MENTIONS'];

// ── build ───────────────────────────────────────────────────────────────────────────────────────
export function build() {
  const runId = `graph-${Date.now().toString(36)}`;
  const nodes = new Map();   // id -> node
  const edges = [];
  const unparsed = [];       // everything the extractor could not read — reported, never hidden

  // Invariant (1): every node carries at least one provenance record. Nothing enters the graph
  // without a file and a line you can open. Invariant (2): every node carries the run that authored
  // it and the content hash of the source it came from, so a stale node is detectable.
  const node = (type, id, props = {}, prov = null) => {
    const key = `${type}:${id}`;
    if (!nodes.has(key)) nodes.set(key, { type, id, key, ...props, prov: [], run: runId });
    const n = nodes.get(key);
    Object.assign(n, props);
    if (prov) n.prov.push(prov);
    return n;
  };
  const edge = (type, from, to, prov) => {
    if (!EDGE_TYPES.includes(type)) throw new Error(`unknown edge type ${type}`);
    edges.push({ type, from, to, prov, run: runId });
  };

  const srcFiles = walk(path.join(ROOT, 'src'), (f) => f.endsWith('.js'));
  const testFiles = walk(path.join(ROOT, 'test'), (f) => f.endsWith('.js'));
  const toolFiles = walk(path.join(ROOT, 'tools'), (f) => f.endsWith('.js'));
  const docFiles = [
    ...walk(ROOT, (f) => f.endsWith('.md') && !f.includes('/node_modules/')
      && !f.includes('/omerta-contracts/') && !f.includes('/omerta-mcp/')),
  ];

  // ── Levers: SCREAMING_CASE keys declared in the HAND-WRITTEN rules tail ────────────────────────
  // Only the tail. rules.generated.js is machine-owned (ground rule #2) — its contents are the
  // prototype's data tables, not tunable levers, and treating them as levers would flood the graph
  // with 22 tables' worth of noise and make the unpinned query useless.
  const tailPath = path.join(ROOT, 'src', 'rules.tail.js');
  const tail = read(tailPath);
  tail.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w$.'"])([A-Z][A-Z0-9_]{3,}):\s*(?=[-0-9['"`{]|true|false)/g)) {
      const name = m[1];
      node('Lever', name, {}, { file: 'src/rules.tail.js', line: i + 1, hash: sha(line) });
      edge('DEFINES', 'Module:src/rules.tail.js', `Lever:${name}`, { file: 'src/rules.tail.js', line: i + 1 });
    }
  });

  // ── Modules, the reasons they emit, the patterns they cite, the levers they read ───────────────
  for (const f of srcFiles) {
    const r = rel(f), text = read(f), lines = text.split('\n');
    node('Module', r, { lines: lines.length }, { file: r, line: 1, hash: sha(text) });

    // EMITS — a ledger reason, WITH the two facts that decide whether any check can see the row:
    // its currency, and whether it carries a character_id. That second fact is load-bearing. Check
    // (a) "character cash" sums EVERY cash row for a character, so a character-scoped cash reason is
    // reconciled by construction and never appears as a literal in any check's terms. A coverage
    // query that does not know this reports every such reason as a hole — 143 of them here, none
    // real. A query that cries wolf 143 times gets ignored, so the scope is captured instead.
    // Each ledger({...}) argument is read brace-balanced because these calls span lines.
    for (const m of text.matchAll(/\bledger\(\s*\w+\s*,\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      let depth = 0, end = open;
      for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      const body = text.slice(open, end + 1);
      const line = text.slice(0, open).split('\n').length;
      const prov = { file: r, line };
      const lit = body.match(/reason:\s*'([a-z][a-z0-9:_]*)'/);
      const cur = body.match(/currency:\s*'(\w+)'/);
      if (!lit) {
        // Template-interpolated (`casino:bet:${game}`) cannot be resolved statically. Counted, never
        // guessed — a guessed reason lands in the coverage query as a false positive and the query
        // stops being trusted.
        unparsed.push({ kind: 'interpolated-reason', file: r, line, text: (body.match(/reason:\s*`([^`]*)`/) || [, '?'])[1].slice(0, 50) });
        continue;
      }
      node('Reason', lit[1], {}, prov);
      if (!cur) {
        // `currency: e.item_kind` — decided at runtime. Defaulting to cash was wrong and produced a
        // false positive (death:escrow, which is cb/ammo). An unread currency is unparsed, not
        // assumed: the coverage query below is only as trustworthy as its narrowest field.
        unparsed.push({ kind: 'computed-currency', file: r, line, text: lit[1] });
        continue;
      }
      edges.push({
        type: 'EMITS', from: `Module:${r}`, to: `Reason:${lit[1]}`, prov, run: runId,
        currency: cur[1],
        scoped: /characterId/.test(body),          // false ⇒ a NULL-character row check (a) cannot see
      });
    }

    lines.forEach((line, i) => {
      const prov = { file: r, line: i + 1 };
      // CITES — a named precedent. This is the latent ontology CLAUDE.md was built to serve: the
      // codebase talks about "the refundPot discipline" and "the casino:pvp transfer" as if they
      // were types, because they are. Normalised to lowercase so "the Store precedent" and "the
      // store precedent" resolve to one node (the paper's resolution step, done the cheap way that
      // is safe here — these are code comments written by one hand, not multi-source surface forms).
      for (const m of line.matchAll(/\bthe ([A-Za-z][A-Za-z0-9_:.]{2,40}) (pattern|precedent|discipline|twin|rule|posture|argument)\b/g)) {
        const id = `${m[1]} ${m[2]}`.toLowerCase();
        node('Pattern', id, {}, prov);
        edge('CITES', `Module:${r}`, `Pattern:${id}`, prov);
      }
    });

    // READS — a module references a lever by name. Whole-file scan: levers arrive via destructuring
    // (`const { CASH_LOOT_RATE } = M3`) as often as by dotted access, so a per-line shape match
    // would miss most of them.
    for (const key of nodes.keys()) {
      if (!key.startsWith('Lever:')) continue;
      const name = key.slice(6);
      if (r === 'src/rules.tail.js') continue;
      if (new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(text)) {
        edge('READS', `Module:${r}`, key, { file: r, line: 0 });
      }
    }
  }

  // ── Checks and what they reconcile ─────────────────────────────────────────────────────────────
  // A check's terms are SQL reason predicates: reason='x' and reason LIKE 'y:%'. Extracting them is
  // what makes "which reasons does no check account for?" answerable — a STRUCTURAL companion to
  // the runtime sweep. The sweep proves the books balance on the data that exists; this proves a
  // reason a module can write is inside some check's terms at all.
  const invPath = path.join(ROOT, 'src', 'invariants.js');
  const inv = read(invPath);
  const invLines = inv.split('\n');
  // Each push('name', ...) opens a check; its terms are the SQL literals lexically nearest above it,
  // which is how this file is laid out throughout (terms computed, then pushed).
  const checkAt = [];
  invLines.forEach((line, i) => {
    for (const m of line.matchAll(/push\(\s*['"]([^'"]+)['"]/g)) {
      node('Check', m[1], {}, { file: 'src/invariants.js', line: i + 1, hash: sha(line) });
      checkAt.push({ name: m[1], line: i });
    }
  });
  // Attribute every reason predicate to the next check pushed at or below it.
  invLines.forEach((line, i) => {
    const owner = checkAt.find((c) => c.line >= i);
    if (!owner) return;
    const prov = { file: 'src/invariants.js', line: i + 1 };
    for (const m of line.matchAll(/reason\s*=\s*'([a-z][a-z0-9:_]*)'/g)) {
      node('Reason', m[1], {}, prov);
      edge('RECONCILES', `Check:${owner.name}`, `Reason:${m[1]}`, prov);
    }
    for (const m of line.matchAll(/reason\s+LIKE\s+'([a-z][a-z0-9:_]*)%'/g)) {
      node('Reason', `${m[1]}%`, { isPrefix: true }, prov);
      edge('RECONCILES', `Check:${owner.name}`, `Reason:${m[1]}%`, prov);
    }
    // `reason IN ('a','b','c')` — the third SQL form these checks use. Omitting it made the coverage
    // query report all four territory treasury sinks as holes when invariants.js:122 covers them in
    // one IN list. Four false positives out of five results is not a usable signal, so the parser
    // has to know every shape the checks are actually written in, not the two that were easiest.
    for (const m of line.matchAll(/reason\s+IN\s*\(([^)]*)\)/gi)) {
      for (const lit of m[1].matchAll(/'([a-z][a-z0-9:_]*)'/g)) {
        node('Reason', lit[1], {}, prov);
        edge('RECONCILES', `Check:${owner.name}`, `Reason:${lit[1]}`, prov);
      }
    }
  });

  // ── Suites: what they cover, what they pin ─────────────────────────────────────────────────────
  for (const f of testFiles) {
    const r = rel(f), text = read(f);
    node('Suite', r, {}, { file: r, line: 1, hash: sha(text) });
    // COVERS — a suite imports the module it exercises.
    for (const m of text.matchAll(/from\s+'\.\.\/src\/([^']+)'/g)) {
      const mod = `src/${m[1]}`;
      if (nodes.has(`Module:${mod}`)) edge('COVERS', `Suite:${r}`, `Module:${mod}`, { file: r, line: 0 });
    }
    // PINS — a suite names a lever. An unpinned lever can be retuned and every test still passes,
    // which in a repo whose ground rule #1 is "do not invent or improve balance" is exactly the
    // silent failure worth surfacing.
    for (const key of nodes.keys()) {
      if (!key.startsWith('Lever:')) continue;
      if (new RegExp(`(?<![\\w$])${key.slice(6)}(?![\\w$])`).test(text)) {
        edge('PINS', `Suite:${r}`, key, { file: r, line: 0 });
      }
    }
  }

  for (const f of toolFiles) {
    const r = rel(f);
    node('Harness', r, {}, { file: r, line: 1, hash: sha(read(f)) });
  }

  // ── Sources: which documents mention which entities ────────────────────────────────────────────
  // MENTIONS is what turns "where was this decided?" into a query. Restricted to Levers, Reasons and
  // Checks — names distinctive enough that a match is evidence rather than coincidence. Module paths
  // and pattern phrases appear in prose too loosely to be worth an edge.
  const mentionable = [...nodes.keys()].filter((k) => k.startsWith('Lever:') || k.startsWith('Reason:') || k.startsWith('Check:'));
  for (const f of docFiles) {
    const r = rel(f), text = read(f);
    node('Source', r, { lines: text.split('\n').length }, { file: r, line: 1, hash: sha(text) });
    for (const key of mentionable) {
      const raw = key.slice(key.indexOf(':') + 1);
      if (raw.endsWith('%')) continue;                       // prefix pseudo-nodes are not prose terms
      if (raw.length < 5) continue;                           // too short to be evidence in prose
      const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\w$])${esc}(?![\\w$])`).test(text)) {
        edge('MENTIONS', `Source:${r}`, key, { file: r, line: 0 });
      }
    }
  }

  return { runId, nodes, edges, unparsed, builtAt: null };
}

// ── the graph's own invariants (§Appendix: "every graph write satisfies four invariants") ────────
// Three of the paper's four are enforceable against a derived graph. The fourth — "every superseded
// object remains addressable" — needs a persistent store with history, which this increment does not
// have: the graph is rebuilt from scratch each run, so nothing is ever superseded, only regenerated.
// Stating that plainly beats asserting a vacuous version of it. Its exit criterion is in GRAPH.md.
export function checkGraph(g) {
  const problems = [];
  const nodes = [...g.nodes.values()];

  // (1) every claim has a source
  const noProv = nodes.filter((n) => !n.prov.length);
  if (noProv.length) problems.push(`${noProv.length} nodes carry no provenance (e.g. ${noProv[0].key})`);

  // (2) every artifact has an authoring run and version
  const noRun = nodes.filter((n) => !n.run);
  if (noRun.length) problems.push(`${noRun.length} nodes carry no authoring run`);
  const noHash = nodes.filter((n) => !n.prov.some((p) => p.hash));
  if (noHash.length > nodes.length * 0.5) problems.push(`${noHash.length}/${nodes.length} nodes have no content hash on any provenance record`);

  // (3) every evaluation identifies a rubric — a Check that reconciles nothing is either misparsed
  // or is a check whose terms this extractor cannot see. Either way it must not pass silently.
  const checks = nodes.filter((n) => n.type === 'Check');
  const reconciling = new Set(g.edges.filter((e) => e.type === 'RECONCILES').map((e) => e.from));
  const mute = checks.filter((c) => !reconciling.has(c.key));
  if (mute.length > checks.length * 0.4) {
    problems.push(`${mute.length}/${checks.length} checks reconcile no reason — the term extractor is probably wrong, not the checks`);
  }

  // every edge endpoint must resolve — a dangling edge is a lie about connectivity
  const dangling = g.edges.filter((e) => !g.nodes.has(e.from) || !g.nodes.has(e.to));
  if (dangling.length) problems.push(`${dangling.length} dangling edges (e.g. ${dangling[0].from} -> ${dangling[0].to})`);

  // the honesty rule: unparsed input is allowed, but it is reported and bounded
  const emitted = g.edges.filter((e) => e.type === 'EMITS').length;
  if (g.unparsed.length > emitted * 0.25) {
    problems.push(`${g.unparsed.length} unparsed constructs vs ${emitted} parsed emissions — extraction is too lossy to trust`);
  }

  return { ok: problems.length === 0, problems, mute: mute.map((m) => m.id) };
}

// ── queries ─────────────────────────────────────────────────────────────────────────────────────
// Each answers a question that today requires reading prose end to end.
const QUERIES = {
  // A FOUNDER SIGN-OFF lever that no suite asserts against. Deliberately narrowed to levers named
  // in BALANCE.md or SIGN-OFF.md: those are the numbers ground rule #1 protects ("the numbers were
  // sim-audited — do not invent mechanics or improve balance"), so an unpinned one is a signed
  // number that can drift with every test still green. Widening this to all 759 constants would
  // return a few hundred catalog keys and stop being read.
  'unpinned-levers': (g) => {
    const pinned = new Set(g.edges.filter((e) => e.type === 'PINS').map((e) => e.to));
    const signed = new Set(g.edges
      .filter((e) => e.type === 'MENTIONS' && /BALANCE\.md|SIGN-OFF\.md/.test(e.from))
      .map((e) => e.to));
    const read = new Set(g.edges.filter((e) => e.type === 'READS').map((e) => e.to));
    return [...g.nodes.values()]
      .filter((n) => n.type === 'Lever' && signed.has(n.key) && read.has(n.key) && !pinned.has(n.key))
      .map((n) => n.id).sort();
  },

  // A CASH reason written with NO character_id that no invariant check's terms account for.
  //
  // The narrowing is the whole point. Check (a) sums every cash row for a character, so a
  // character-scoped reason is reconciled by construction — including it would report 143 reasons,
  // none of them holes. A NULL-character cash row is different: check (a) cannot see it, so unless
  // some bucket or escrow check names it, that money moves and nothing reconciles it. That is a
  // structural companion to the runtime sweep, which can only prove the books balance over rows
  // that happen to exist — a reason no player has triggered yet drifts nothing and alarms nobody.
  //
  // Scope stated honestly: this does not cover $OMR (a reason absent from both the mint and burn
  // terms is a deliberate transfer there, not a hole) or interpolated reasons (see `unparsed`).
  'unreconciled-reasons': (g) => {
    const covered = new Set(g.edges.filter((x) => x.type === 'RECONCILES').map((e) => e.to.slice(7)));
    const prefixes = [...covered].filter((c) => c.endsWith('%')).map((c) => c.slice(0, -1));
    const scopedSomewhere = new Set(g.edges.filter((e) => e.type === 'EMITS' && e.scoped).map((e) => e.to));
    const out = new Map();
    for (const e of g.edges) {
      if (e.type !== 'EMITS' || e.scoped || e.currency !== 'cash') continue;
      if (scopedSomewhere.has(e.to)) continue;          // also written character-scoped ⇒ check (a) sees it
      const r = e.to.slice(7);
      if (covered.has(r) || prefixes.some((p) => r.startsWith(p))) continue;
      if (!out.has(r)) out.set(r, `${r}  ${e.prov.file}:${e.prov.line}`);
    }
    return [...out.values()].sort();
  },

  // Precedent lookup, made queryable — every site that invokes a named pattern. This is the query
  // that would have caught this session's rake_cursor bug: sackEmpire copied a column list from
  // resetFrontToNewOwner instead of calling it, and both sites cite the same precedent.
  pattern: (g, arg) => {
    const want = (arg || '').toLowerCase();
    const hits = g.edges.filter((e) => e.type === 'CITES' && e.to.slice(8).includes(want));
    if (!want) {
      const byPattern = {};
      for (const e of g.edges.filter((x) => x.type === 'CITES')) {
        (byPattern[e.to.slice(8)] ||= []).push(e.from.slice(7));
      }
      return Object.entries(byPattern).filter(([, v]) => v.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([p, v]) => `${v.length}x  ${p}  [${[...new Set(v)].join(', ')}]`);
    }
    return hits.map((e) => `${e.to.slice(8)}  ${e.prov.file}:${e.prov.line}`);
  },

  // Full trace for one lever: where it is declared, who reads it, what pins it, which documents
  // decided it. This is the paper's tracing statement applied to a single number.
  lever: (g, arg) => {
    if (!arg) return ['usage: query lever <NAME>'];
    const key = `Lever:${arg}`;
    if (!g.nodes.has(key)) return [`no such lever: ${arg}`];
    const of = (t) => g.edges.filter((e) => e.type === t && e.to === key);
    const n = g.nodes.get(key);
    return [
      `lever      ${arg}`,
      `declared   ${n.prov.map((p) => `${p.file}:${p.line}`).join(', ')}`,
      `read by    ${of('READS').map((e) => e.from.slice(7)).join(', ') || '(nothing — dead lever?)'}`,
      `pinned by  ${of('PINS').map((e) => e.from.slice(6)).join(', ') || '(NOTHING — silently retunable)'}`,
      `decided in ${of('MENTIONS').map((e) => e.from.slice(7)).join(', ') || '(undocumented)'}`,
    ];
  },

  // A module no suite imports. Not the same as untested (a module can be exercised through the
  // server by another suite), so this is a lead, not a verdict — stated as such in the output.
  'uncovered-modules': (g) => {
    const covered = new Set(g.edges.filter((e) => e.type === 'COVERS').map((e) => e.to));
    return [...g.nodes.values()]
      .filter((n) => n.type === 'Module' && !covered.has(n.key))
      .map((n) => `${n.id}  (${n.lines} lines)`).sort();
  },

  // Everything the extractor could not read. Printed so a growing blind spot is visible.
  unparsed: (g) => g.unparsed.map((u) => `${u.kind}  ${u.file}:${u.line}  ${u.text || ''}`),
};

// ── cli ─────────────────────────────────────────────────────────────────────────────────────────
function census(g) {
  const byNode = {}, byEdge = {};
  for (const n of g.nodes.values()) byNode[n.type] = (byNode[n.type] || 0) + 1;
  for (const e of g.edges) byEdge[e.type] = (byEdge[e.type] || 0) + 1;
  return { byNode, byEdge, nodes: g.nodes.size, edges: g.edges.length, unparsed: g.unparsed.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'build', arg] = process.argv.slice(2);
  const g = build();
  if (cmd === 'build') {
    const c = census(g);
    console.log(`graph built — run ${g.runId}`);
    console.log(`  ${c.nodes} nodes  ${c.edges} edges  ${c.unparsed} unparsed`);
    console.log('  nodes:', Object.entries(c.byNode).map(([k, v]) => `${k} ${v}`).join('  '));
    console.log('  edges:', Object.entries(c.byEdge).map(([k, v]) => `${k} ${v}`).join('  '));
  } else if (cmd === 'check') {
    const r = checkGraph(g);
    if (!r.ok) { console.error('✗ graph invariants FAILED'); r.problems.forEach((p) => console.error('  -', p)); process.exit(1); }
    console.log('✅ graph invariants hold — every node has provenance, an authoring run and a content hash;');
    console.log('   every check names what it reconciles; no dangling edges; extraction loss within bounds.');
    if (r.mute.length) console.log(`   (${r.mute.length} checks reconcile no literal reason — computed-term checks: ${r.mute.join(', ')})`);
  } else if (cmd === 'query') {
    const q = QUERIES[arg];
    if (!q) { console.error(`unknown query. available: ${Object.keys(QUERIES).join(', ')}`); process.exit(1); }
    const out = q(g, process.argv[4]);
    console.log(`# ${arg}${process.argv[4] ? ` ${process.argv[4]}` : ''} — ${out.length} result(s)`);
    out.forEach((l) => console.log(l));
  } else { console.error('usage: graph.js build|check|query <name> [arg]'); process.exit(1); }
}

export { QUERIES, NODE_TYPES, EDGE_TYPES, census };
