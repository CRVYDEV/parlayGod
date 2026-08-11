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
import { execFileSync } from 'node:child_process';
import { walkSrc } from './lib/srcfiles.js';
import { MINT_TRANCHES, STORE } from '../src/rules.js';

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

// The contracts row had drifted to "8 contracts, 107 tests" against a tree holding 9 and 128, and
// nothing caught it because `row()` only reads BOLDED numbers and only one of the three was bold.
// A number nobody checks is a number that will be wrong — so bold all three and check all three.
const solFiles = fs.readdirSync('omerta-contracts/src').filter((f) => f.endsWith('.sol'))
  .map((f) => `omerta-contracts/src/${f}`);
const [solCount, solLines, forgeTests] = row('Smart contracts');
assert.equal(solCount, solFiles.length, `SPEC says ${solCount} contracts; omerta-contracts/src has ${solFiles.length}`);
near(solLines, countLines(solFiles), 'lines of Solidity');
const forge = fs.readdirSync('omerta-contracts/test').filter((f) => f.endsWith('.sol'))
  .reduce((n, f) => n + (read(`omerta-contracts/test/${f}`).match(/function test/g) || []).length, 0);
assert.equal(forgeTests, forge, `SPEC says ${forgeTests} Foundry tests; the suite declares ${forge}`);

const schema = read('schema.sql');
const [tableCount] = row('Database tables');
const tables = (schema.match(/^CREATE TABLE IF NOT EXISTS \w+/gm) || []).length;
assert.equal(tableCount, tables, `SPEC says ${tableCount} tables; schema.sql creates ${tables}`);

// COUNT THE REPOSITORY, NOT THE WORKING TREE. SPEC describes what is committed; a walk of the disk
// describes whatever happens to be sitting there.
//
// The first version walked the tree, and it broke CI for ten commits — in the very commit that added
// this file to keep the docs honest. The sandbox it was written in had vendored OpenZeppelin sources
// (gitignored, fetched for tools/compile-contracts.js) carrying one README.md, so the tree held 127
// markdown files and a fresh clone held 126. It passed locally every single time and failed on every
// push. That is precisely the failure this file exists to catch — a claim that is true in one
// environment and false in another — and I did not notice because I never opened CI.
//
// `git ls-files` is the fix and the lesson: any guard that asserts a number about "the project" has
// to ask git what the project is. Falls back to the walk when git is unavailable (a tarball, a
// vendored copy), which is the only case where the disk is the best answer available.
//
// `--cached --others --exclude-standard`, and that is the SAME lesson in a second costume. Plain
// `git ls-files` lists only TRACKED files, so a brand-new doc does not count until it is `git add`ed
// — which means running this guard before committing and running it after committing give DIFFERENT
// answers, and the pre-commit one is the one a person actually runs. It bit on 2026-07-31: a new
// audit report passed locally at 142 and failed CI at 143, in a file whose whole purpose is catching
// claims that are true in one environment and false in another. The flags add untracked-but-not-
// ignored files, so the count is what the NEXT COMMIT will contain rather than what the last one did.
let mdFiles;
try {
  mdFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0').filter((f) => f.endsWith('.md'));
} catch {
  mdFiles = [];
  (function md(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) md(p); else if (e.name.endsWith('.md')) mdFiles.push(p);
    }
  }('.'));
}
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
// …and the same claim in ANY wording, in EVERY file that makes it. The first cut of this check
// matched one exact phrase, and a red-team found the identical false claim alive in two other
// places — including CLAUDE.md, which is loaded into every session, so every future reader was
// being told to perform a manual step that does not exist on the most dangerous file in the tree.
// Matching the CLAIM instead of the phrasing: the seam is settled by where `levelOf` is DEFINED,
// so any text putting it in the generated half is wrong however it is worded. The corrective
// wording ("lives in the HAND-WRITTEN half") is deliberately not caught — it says the opposite.
// Note the shape this forces: prose DESCRIBING the old bug must not use the collocation either,
// so say "the machine-owned half" when recounting it. That is the cost of matching a claim by
// its terms rather than its phrasing, and it is cheaper than the guard that missed it twice.
assert(/export const levelOf/.test(tail), 'levelOf is defined in the hand-written half');
assert(!/export const levelOf/.test(read('src/rules.generated.js')),
  'levelOf moved into the generated half — the seam changed, so every doc describing it must change too');
for (const f of ['src/rules.tail.js', 'CLAUDE.md', 'SPEC.md']) {
  const body = read(f);
  for (const m of body.matchAll(/levelOf/g)) {
    const around = body.slice(Math.max(0, m.index - 220), m.index + 220);
    assert(!/AUTO-GENERATED/i.test(around),
      `${f} still says levelOf lives in the AUTO-GENERATED half. It does not — it is defined in `
      + 'src/rules.tail.js, which the extractor never opens. A reader who believes this goes looking '
      + 'for a line to re-apply after every regeneration, finds none, and either thinks the extract '
      + 'broke or adds one that the NEXT run silently clobbers back to the prototype\'s /4.');
  }
}

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

// ── the counsel memo must not state a fee the game does not charge ──────────────────────────────
// This one is here because it FAILED in the field, and its failure mode is the expensive kind: a
// same-day founder reversal (the PLEX rail retired, then restored an hour later for everything but
// the mint) left the memo telling counsel the product had ONE payment rail across every real-money
// price. The row's own analysis was unaffected — it concerns the identity sale, which really is
// ETH-only — but a memo's entire value is that it is accurate about the product, and a lawyer
// opining on a wrong fact pattern is worse than no memo.
//
// The narrow, durable thing to check is the FEE FIGURES, because those are levers and levers move.
// Every "<n> ETH" the memo states as a price must be a live fee: a published tranche wave, the
// respawn fee, or a Store SKU price. Prose and legal reasoning are deliberately NOT checked — a
// guard over an argument would be noise, and noise gets deleted.
{
  const memo = read('omerta-counsel-memo.md');
  const live = new Set([
    ...MINT_TRANCHES.map((t) => t.eth),                  // the published mint schedule
    Number(process.env.RESPAWN_FEE_ETH || 0.10),         // the respawn fee
    ...STORE.PACKAGES.map((p) => p.priceEth),            // every SKU on the shelf
  ].map((n) => Number(n)));
  const quoted = [...memo.matchAll(/([0-9]+\.[0-9]+)\s*ETH/g)].map((m) => Number(m[1]));
  const bogus = [...new Set(quoted)].filter((n) => !live.has(n));
  assert.deepEqual(bogus, [], `omerta-counsel-memo.md quotes ETH fees the game does not charge: `
    + `${bogus.join(', ')}. Live fees are ${[...live].sort((a, b) => a - b).join(', ')}. A memo that `
    + 'misstates a price is a lawyer opining on the wrong product — restate it or remove the figure.');
}

// ── the codices must not quote a price the game does not charge ─────────────────────────────────
// The 2026-08-10 re-denomination moved 145 $OMR constants x6, and BOTH codices were left quoting the
// old prices — 17 of them, and `public/wiki.html` was materially behind `docs/WIKI.md` because the
// existing drift-detector checks only that a system is MENTIONED in both, never that the numbers
// agree. It was found by a hand-run scan, twice, after a spot-check had already reported success.
//
// So the check is: every "<n> $OMR" in either codex must equal SOME live lever. That is deliberately
// LOOSE — it cannot tell the peek price from the sweep price when both are 30 — and it is still the
// right net for the failure that occurs, because a whole-tree re-denomination leaves the stale
// figures at 1/6th of every live value, where they match nothing. It is a regression guard on the
// class, not a claim that each figure is quoted against the correct lever.
{
  const R = await import('../src/rules.js');
  // Only $OMR-DENOMINATED numbers count as live prices. The first cut of this guard swept every
  // number in the rules module, and the mutation SURVIVED — restoring the old "5 $OMR" sweep price
  // passed, because 5 is some unrelated count somewhere in rules.js. A set that broad matches any
  // small integer and asserts nothing.
  // A PRICE, specifically. Two things in rules.js are $OMR-keyed and are not prices, and both were
  // letting a stale figure through: an INVERSE lever (SPEAKEASY.RENOWN.OMR_WEIGHT, game-value per
  // $OMR, correctly divided rather than multiplied by the re-denomination) and RETIRED data
  // (RECRUIT_MILESTONES[].omr, which game.js stopped reading when referrals went to a respect bonus).
  const NOT_A_PRICE = /WEIGHT|RATE|MULT|BPS|DIV|PER_|_PER|MIN_LVL|LEVEL/i;
  const RETIRED = new Set(['RECRUIT_MILESTONES']);
  const live = new Set();
  const seen = new Set();
  const walk = (v, keyed) => {
    if (typeof v === 'number') { if (keyed && Number.isFinite(v) && v > 0) live.add(v); return; }
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x, keyed); return; }
    for (const [k, x] of Object.entries(v)) {
      if (RETIRED.has(k)) continue;
      walk(x, NOT_A_PRICE.test(k) ? false : (/omr/i.test(k) || keyed));
    }
  };
  walk(R, false);
  assert(live.size > 40, `expected many $OMR-denominated levers, saw ${live.size}`);
  const stale = [];
  for (const f of ['docs/WIKI.md', 'public/wiki.html'])
    read(f).split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/([0-9][0-9,]*) \$OMR/g)) {
        const n = Number(m[1].replace(/,/g, ''));
        if (!live.has(n)) stale.push(`${f}:${i + 1} quotes ${n} $OMR`);
      }
    });
  assert.deepEqual(stale, [], 'a codex quotes a $OMR price that matches no live lever — the game '
    + `charges something else and the player finds out at the till:\n  ${stale.join('\n  ')}`);
}

// ── §6 must not send anyone back to finished work ────────────────────────────────────────────────
// SPEC has two places that talk about the same debt items: §4 describes each one's state, and §6 is
// the "do this next" list. They drifted: §6 said "Finish the lock-free read path (D1) — blocked on a
// design choice" for a while AFTER D1 was shipped, wired to all 24 read GETs, verified on real
// Postgres and red-teamed twice. The figures in this file were all correct; the two sections simply
// disagreed, which is the kind of staleness that costs a developer a day re-doing finished work.
//
// The rule is mechanical: if §4's entry for an item announces **Shipped:** / **DONE** / **RESOLVED**
// in its BODY, §6's entry for the same item must be struck through. Keying on the item's HEADING was
// the first attempt and it was pure decoration — D1's heading reads "**(HIGH → PARTLY ADDRESSED)**",
// which no reasonable "is it done" pattern matches, so the guard skipped the one case it was written
// for and passed the mutation test. The body marker is what actually distinguishes shipped work, and
// it fires on D1 exactly (verified by re-staling the entry and watching it fail).
{
  const section = (from, to) => spec.slice(spec.indexOf(from), to ? spec.indexOf(to) : undefined);
  const debt = section('## 4. Technical debt register', '## 5.');
  const next = section('## 6. Recommended sequence');
  const heads = [...debt.matchAll(/^### (D\d+) — (.+)$/gm)];
  let checked = 0;
  for (const [i, m] of heads.entries()) {
    const [, id, headline] = m;
    const body = debt.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined);
    if (!/\*\*(Shipped|DONE|RESOLVED)\b/.test(body)) continue;
    const entry = next.split('\n').find((l) => new RegExp(`\\(${id}\\)`).test(l));
    if (!entry) continue; // §6 has no opinion about this item — nothing to contradict
    checked++;
    assert(entry.includes('~~') || /\*\*DONE\*\*/.test(entry),
      `SPEC §4 says ${id} is shipped ("${headline.trim()}") but §6 still lists it as work to do:\n    ${entry.trim()}\n`
      + '  Strike it through. A "what to do next" list that points at finished work sends the next reader to re-do it.');
  }
  assert(checked >= 3, `only ${checked} debt items were cross-checked between §4 and §6 — the pairing `
    + 'broke (a heading format or an item numbering changed), so this guard is no longer guarding anything.');
}

// ── a harness that stops running protects nothing ────────────────────────────────────────────────
// Every harness here exists because something it checks was once broken, and two of chaos's checks
// are mutation-verified against real regressions (the wage-epoch resume guard; the checked-out-client
// error handler). None of that matters if CI quietly stops invoking them, so the workflow is checked
// for each one by name.
{
  const ci = read('.github/workflows/ci.yml');
  for (const script of ['npm test', 'npm run sim', 'npm run pgcheck', 'npm run chaos', 'npm run loadtest',
    'npm run scale'])
    assert(ci.includes(script), `.github/workflows/ci.yml no longer runs \`${script}\` — a harness that `
      + 'does not run is not a guard, it is a file. Re-add it or delete the harness honestly.');
}

// ── and neither does a gate that fails on its own dependency list ────────────────────────────────
// `forge test` is the pre-mainnet gate. Economy v3 step 6 added the v4 hook, added v4-core to
// `run-forge-test.sh`, and did NOT add it to the workflow — so on GitHub `forge build` failed to
// PARSE, and because parsing is all-or-nothing that skipped every step below it: not just the hook's
// tests but the OMR, bond, oracle, VoucherClaim and GearVault suites that had been green for months.
// The job went red and stayed red, which is the worst state for a gate to be in, because a red that
// is always red is read as noise. So the two fetch lists must agree with what the compiler is
// actually told to look for.
{
  const toml = read('omerta-contracts/foundry.toml');
  const local = read('omerta-contracts/run-forge-test.sh');
  const wf = read('.github/workflows/forge.yml');
  // Every remapping points at lib/<dir>/… — take the first segment, since a nested one
  // (solmate/=lib/v4-core/lib/solmate/) is shipped by its parent rather than fetched on its own.
  const needed = new Set([...toml.matchAll(/=lib\/([\w.-]+)\//g)].map((m) => m[1]));
  // forge-std is auto-discovered rather than remapped, but the tests import it, so it is a real
  // dependency and belongs in the same check.
  if (fs.readdirSync('omerta-contracts/test').some((f) => read(`omerta-contracts/test/${f}`).includes('forge-std/')))
    needed.add('forge-std');
  assert(needed.size >= 3, `expected the contracts to need at least 3 lib deps, found ${[...needed]}`);
  for (const dep of needed) {
    assert(local.includes(`lib/${dep}`),
      `omerta-contracts/run-forge-test.sh never fetches lib/${dep}, which foundry.toml remaps — `
      + 'the local run would fail to compile.');
    assert(wf.includes(`lib/${dep}`),
      `.github/workflows/forge.yml never fetches lib/${dep}, which the contracts need — forge build `
      + 'will fail to PARSE on CI and skip the ENTIRE contract suite, not just whatever needs it. '
      + 'Keep the workflow in lockstep with run-forge-test.sh.');
  }
}

console.log(`✅ docs test passed — every number in SPEC.md's size table checked against the tree `
  + `(${srcFiles.length} src files / ${countLines(srcFiles)} lines, ${testFiles.length} suites, `
  + `${tables} tables, ${mdFiles.length} markdown files), the rules-seam figures are current, the false `
  + `"re-apply by hand" warning cannot come back, no doc misstates its own size by more than 25%, and all `
  + `${audits.length} audit reports are indexed as point-in-time with none phantom.`);
