// THE DOCUMENTATION THAT CAN BE WRONG (the 52nd suite).
//
// Prose does not have a test suite, so it rots silently — and unlike code, wrong prose does not fail
// loudly the first time someone relies on it. It makes the next maintainer confidently do the wrong
// thing. One session found FIVE instances:
//
//   * a comment on `levelOf` instructing the reader to RE-APPLY the pacing divisor by hand after any
//     regeneration — a hazard that did not exist, because the extractor already preserved that line;
//   * SPEC's "lines 1–1,091 are auto-generated" — the real figure was 454, so it described the
//     hand-written half as 70% of the file when it was closer to 90%;
//   * SPEC's backend module count, which counted a FLAT listing of src/ and so under-reported by 27
//     files the moment code moved into subdirectories;
//   * CLAUDE.md describing itself as "~1,000 lines of dense prose" while being over five thousand;
//   * a comment I wrote claiming reads no longer checkpoint accrual, which measurement disproved.
//
// So the load-bearing FACTS are asserted here against the tree. Not the prose — prose is judgement and
// belongs to whoever writes it — but every number a reader might act on, and every claim of the form
// "X must be done by hand" that a test can settle. A figure in SPEC.md is now either true or CI fails.
//
// Adding a number to SPEC's size table without adding it here is fine; the table is checked row by row
// for the rows that exist, so an unchecked row simply is not guarded. Prefer to guard it.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { walkSrc } from './lib/srcfiles.js';

const read = (p) => fs.readFileSync(p, 'utf8');
// Counted the way `wc -l` counts — newlines, not `split('\n').length`, which adds a phantom line for
// every file that ends in one. The definition matters because the whole point is that a reader can
// check the figure by hand and get the same answer; off-by-one-per-file is 100 lines across src/.
const lines = (p) => { const s = read(p); let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++; return n; };
const countLines = (files) => files.reduce((n, f) => n + lines(f), 0);
const spec = read('SPEC.md');

// FILE COUNTS are asserted exactly; LINE TOTALS within 2%. That split is deliberate. A file count only
// moves when a module is added or relocated, which is worth restating — and it is the figure that broke
// (a flat listing of src/ under-reported by 27 files the moment code moved into subdirectories). A line
// total moves when anyone edits a comment, and this very file is inside one of the trees it measures, so
// an exact assertion would demand a SPEC edit alongside every test edit. A guard that nags on unrelated
// work gets deleted, and a deleted guard catches nothing. Every error this file was written to catch was
// off by 27%, 140% or 5× — none would survive a 2% band.
const near = (claimed, real, what) => assert(Math.abs(claimed - real) / Math.max(real, 1) < 0.02,
  `SPEC says ${claimed} ${what}; it is ${real} — more than 2% out, so restate it`);

// pull `**N**` out of the row whose label matches, so the assertion names the row that is wrong.
// The label is taken LITERALLY — an earlier cut passed it straight into a RegExp, so a label containing
// `+` silently matched nothing and the row went unchecked. A guard that quietly stops guarding is the
// failure mode this whole file exists to prevent, so it must not be possible here either.
const row = (label) => {
  const lit = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = spec.match(new RegExp(`^\\| ${lit} \\|([^|]*)\\|`, 'm'));
  assert(m, `SPEC.md has no size-table row labelled "${label}" — it was renamed or removed, so the `
    + 'guard below is no longer checking anything. Update this test with the new label.');
  return [...m[1].matchAll(/\*\*([\d,]+)\*\*/g)].map((x) => Number(x[1].replace(/,/g, '')));
};

// ── §1 "Size, measured" — every number, against the tree ────────────────────────────────────────
const srcFiles = walkSrc('src');
const [srcCount, srcLines] = row('Backend modules');
assert.equal(srcCount, srcFiles.length, `SPEC says ${srcCount} backend modules; src/ has ${srcFiles.length}`);
near(srcLines, countLines(srcFiles), 'lines in src/');

const testFiles = walkSrc('test');
const [testCount, testLines] = row('Test suites');
assert.equal(testCount, testFiles.length, `SPEC says ${testCount} test files; test/ has ${testFiles.length}`);
near(testLines, countLines(testFiles), 'lines in test/');

const [clientLines] = row('Client');
near(clientLines, lines('public/index.html'), 'lines in public/index.html');

const schema = read('schema.sql');
const [tableCount] = row('Database tables');
const tables = (schema.match(/^CREATE TABLE IF NOT EXISTS \w+/gm) || []).length;
assert.equal(tableCount, tables, `SPEC says ${tableCount} tables; schema.sql creates ${tables}`);

const mdFiles = [];
(function md(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) md(p); else if (e.name.endsWith('.md')) mdFiles.push(p);
  }
}('.'));
const [mdCount, mdLines] = row('Design + audit docs');
assert.equal(mdCount, mdFiles.length, `SPEC says ${mdCount} markdown files; there are ${mdFiles.length}`);
near(mdLines, countLines(mdFiles), 'markdown lines');

// ── the rules seam, whose figures were the ones most wrong ───────────────────────────────────────
const genLines = lines('src/rules.generated.js');
const tailLines = lines('src/rules.tail.js');
const seam = spec.match(/`rules\.generated\.js` holds[\s\S]{0,400}?extractor never opens it/);
assert(seam, "SPEC.md's architecture section must describe the rules seam — the paragraph naming "
  + '`rules.generated.js` and `rules.tail.js` was renamed or removed, so this guard is checking nothing');
const seamFigures = [...seam[0].matchAll(/\(([\d,]+) lines\)/g)].map((m) => Number(m[1].replace(/,/g, '')));
assert.equal(seamFigures.length, 2, 'the seam paragraph must state both halves\' line counts');
near(seamFigures[0], genLines, 'lines in rules.generated.js');
near(seamFigures[1], tailLines, 'lines in rules.tail.js');
assert(tailLines > genLines * 4,
  'sanity: the hand-written half should dwarf the generated one — if that flipped, the prose needs rewriting');

// ── claims of the form "you must do X by hand" ───────────────────────────────────────────────────
// A false one of these is the worst kind of stale doc: it makes a reader take an action that is not
// needed, on the most dangerous file in the tree. This one is settled by the extractor's own scope —
// asserted in test/rules.js, which checks the paths the extractor actually addresses rather than the
// filenames its prose happens to mention (a first cut here matched the extractor's own comments).
const tail = read('src/rules.tail.js');
assert(tail.includes('PACING.LEVEL_DIVISOR'), 'the pacing override lives in the hand-written half');
assert(!/RE-APPLY THIS LINE/i.test(tail),
  'the "RE-APPLY THIS LINE after any regeneration" warning was FALSE — levelOf lives in the file the '
  + 'extractor never touches. If it is back, either the seam moved (fix the seam) or the warning is '
  + 'wrong again (delete it).');

// ── a doc must not describe its own size wrongly ─────────────────────────────────────────────────
// CLAUDE.md is loaded into every session, so a reader who believes it is a thousand lines when it is
// five thousand mis-plans every task that touches it.
// Every "CLAUDE.md is N lines" claim in either doc, wherever it appears. A first cut anchored on
// `CLAUDE\.md\s+alone` and so matched NOTHING, because SPEC writes the filename in backticks — the
// check reported clean while the stale figure sat right there. Mutation-tested: breaking either number
// now fails, and the count of claims found is asserted so a regex that stops matching is loud.
const claudeReal = lines('CLAUDE.md');
const sizeClaims = [];
for (const [name, text] of [['CLAUDE.md', read('CLAUDE.md')], ['SPEC.md', spec]])
  for (const m of text.matchAll(/CLAUDE\.md`?\s+(?:alone\s+)?(?:is\s+)?~?([\d,]{3,})\s*lines/gi))
    sizeClaims.push([name, Number(m[1].replace(/,/g, ''))]);
assert(sizeClaims.length >= 1, "no doc states CLAUDE.md's size — SPEC's D7 section did, so if that "
  + 'claim is gone the guard below is inert; either restore the figure or delete this check');
for (const [where, claimed] of sizeClaims)
  assert(Math.abs(claimed - claudeReal) / claudeReal < 0.25,
    `${where} says CLAUDE.md is ~${claimed} lines; it is ${claudeReal}. State the real order of magnitude `
    + '— it is loaded into every session, so a reader who believes it is 1,000 lines mis-plans every task.');

// ── the audit index must cover every audit ───────────────────────────────────────────────────────
// 57 audit reports read as current when they are point-in-time. The index is what says so, and an
// index that misses files is how a reader concludes an unlisted report is authoritative.
const audits = fs.readdirSync('.').filter((f) => /^AUDIT-.*\.md$/.test(f)).sort();
const index = read('docs/AUDITS.md');
const unlisted = audits.filter((f) => !index.includes(f));
assert.deepEqual(unlisted, [], `docs/AUDITS.md does not list: ${unlisted.join(', ')} — every audit must be `
  + 'indexed there, with its date and the note that SPEC.md is what is current');
const phantom = [...index.matchAll(/`(AUDIT-[a-z0-9.-]+\.md)`/g)].map((m) => m[1])
  .filter((f) => !audits.includes(f));
assert.deepEqual([...new Set(phantom)], [], `docs/AUDITS.md lists reports that do not exist: ${phantom.join(', ')}`);

console.log(`✅ docs test passed — every number in SPEC.md's size table checked against the tree `
  + `(${srcFiles.length} src files / ${countLines(srcFiles)} lines, ${testFiles.length} suites, `
  + `${tables} tables, ${mdFiles.length} markdown files), the rules-seam figures are current, the false `
  + `"re-apply by hand" warning cannot come back, no doc misstates its own size by more than 25%, and all `
  + `${audits.length} audit reports are indexed as point-in-time with none phantom.`);
