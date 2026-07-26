// THE GENERATED/HAND-WRITTEN SEAM.
//
// Ground rule #2 says src/rules.js is generated and never edited. For a long time that was a promise
// rather than a fact, because one file held both halves: tools/extract-rules.js re-emitted the
// prototype's tables and then re-appended everything from `export const CONSTANTS` onward, so
// anything living in the gap between the last table and CONSTANTS was silently destroyed by a
// regeneration — and the tables themselves were silently restored to whatever the prototype said.
// Both directions had actually bitten:
//
//   * recruitRankOf (used by the recruiters leaderboard) sat in that gap and would have been deleted.
//   * the retired "Star the repo" onboarding task would have been resurrected into ONBOARD_TASKS,
//     undoing a founder decision with no diff to notice.
//
// The seam is now a FILE boundary, and this file is what keeps it one. The assertions below are the
// deal: the generated file is machine-owned data only, the hand-written file is never machine-touched,
// and the facade exposes both without ambiguity.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { TABLES } from '../tools/extract-rules.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const gen = read('../src/rules.generated.js');
const tail = read('../src/rules.tail.js');
const facade = read('../src/rules.js');

// ── the generated file holds ONLY the tables ────────────────────────────────────────────────────
// Anything else in here is code that the next `node tools/extract-rules.js` run will delete without
// warning. Stated as an allowlist of exported names so that legitimately changing a TABLE (from a
// v25 prototype, say) passes, while hand-adding a helper fails.
const genExports = [...gen.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
assert.deepEqual(genExports.slice().sort(), TABLES.slice().sort(),
  'src/rules.generated.js must export exactly the extractor\'s tables and nothing else — anything\n'
  + 'hand-written here is destroyed by the next regeneration. Put it in src/rules.tail.js.\n'
  + `  found:    ${genExports.join(', ')}\n  expected: ${TABLES.join(', ')}`);

// Every export must be a plain array literal — a table, not logic wearing a table's name.
for (const t of TABLES)
  assert.match(gen, new RegExp(`^export const ${t} = \\[`, 'm'), `${t} must be a plain array literal in the generated file`);

// …and it must depend on NOTHING. An import here would make the machine-owned half reference the
// hand-written half, which is how you get a cycle that only breaks at some later call site.
assert.equal(/^\s*import\s/m.test(gen), false,
  'src/rules.generated.js must not import anything — it is data, and the extractor would drop the import anyway');

// ── the hand-written file is never machine-touched ──────────────────────────────────────────────
// Asserted on the paths the extractor ADDRESSES, not on any mention of the name — its own header
// explains this rule and its success message names the file it left alone, and a tripwire that fires
// on its own documentation is a tripwire nobody keeps.
const extractor = read('../tools/extract-rules.js');
const addressed = [...extractor.matchAll(/new URL\('([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(addressed, ['../src/rules.generated.js'],
  'tools/extract-rules.js may address exactly one file, src/rules.generated.js — the hand-written half\n'
  + `is off limits. It addresses: ${addressed.join(', ')}`);
assert.equal((extractor.match(/writeFileSync/g) || []).length, 1, 'the extractor writes exactly one file');
assert.match(extractor, /writeFileSync\(new URL\('\.\.\/src\/rules\.generated\.js'/,
  'the one file the extractor writes must be src/rules.generated.js');
// …and it reads only the prototype path handed to it on the command line.
assert.match(extractor, /readFileSync\(protoPath/, 'the extractor reads only the prototype it was given');

// ── the facade is unambiguous ───────────────────────────────────────────────────────────────────
// `export *` from two modules that both export the same name does not throw at boot: the name is
// simply excluded, and the failure surfaces as `undefined` at the first call site that reads it.
// So the overlap has to be checked here rather than discovered in production.
const names = (src) => new Set([...src.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
const overlap = [...names(gen)].filter((n) => names(tail).has(n));
assert.deepEqual(overlap, [], `the two halves both export: ${overlap.join(', ')} — an ambiguous star `
  + 're-export resolves to undefined at the call site, not an error at boot');
assert.match(facade, /export \* from '\.\/rules\.generated\.js';/, 'the facade re-exports the generated half');
assert.match(facade, /export \* from '\.\/rules\.tail\.js';/, 'the facade re-exports the hand-written half');

// ── and the whole thing still resolves ──────────────────────────────────────────────────────────
const R = await import('../src/rules.js');
for (const t of TABLES) assert(Array.isArray(R[t]) && R[t].length, `${t} reaches callers through the facade`);
// A helper from the tail that reads a table from the generated half — proves the seam is live, not
// just syntactically valid (this is the exact shape that a cycle would break).
assert.equal(typeof R.levelOf(1444), 'number', 'levelOf (tail) reads PACING (tail) and works');
assert.equal(R.recruitRankOf(5), 'The Talent Scout', 'recruitRankOf (tail) reads RECRUIT_MILESTONES (generated)');
assert.equal(R.crimeOf ? typeof R.crimeOf('pick') : 'object', 'object', 'a table lookup helper resolves');

// ── the founder decision that the old extractor would have undone ───────────────────────────────
assert.equal(R.ONBOARD_TASKS.some((t) => t.id === 'ob_repo'), false,
  'the retired "Star the repo" First-Week task must stay retired — it was removed from the PROTOTYPE, '
  + 'so a regeneration keeps it out; removing it only from the generated file would not have survived');

console.log(`✅ rules seam test passed — the generated half holds exactly the ${TABLES.length} extractor tables `
  + 'and imports nothing, the extractor writes only that file and never opens the hand-written half, the two '
  + 'halves share no export name (so no star re-export silently resolves to undefined), every table reaches '
  + 'callers through the facade, a tail helper reading a generated table proves the seam is live, and the '
  + 'retired "Star the repo" task stays retired across a regeneration.');
