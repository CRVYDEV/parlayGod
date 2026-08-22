// THE GATE MATRIX — sibling verbs must not forget a gate their twin enforces.
//
// This is the single most productive bug class in this project's history, and it keeps recurring
// because the gates live at each call site rather than in one place:
//   • `jump` was missing the unreachable-victim gates `fire` had (AUDIT-full-system-v3)
//   • `collectFrontier` was missing the signed D2 safehouse gate `collectTerritory` enforces
//     (AUDIT-world-frontier F1)
//   • `npcHit` was blind to the Pen shields, so a $25k burner beat the yard boss's protection
//     (AUDIT-the-pen-step-two)
//   • `payProtection` let a PROTECTED inmate shank with impunity (AUDIT-the-pen)
// Every one of those was found by a person noticing an asymmetry. This asserts the asymmetry away.
//
// WHAT IT CHECKS. Each FAMILY below declares the gates every member must enforce, and why. A gate
// counts as enforced if the function calls the helper, reaches it through an `assert*` helper it
// calls (the `assertStreetCrime` pattern — the RIGHT way to share a gate set), or writes the check
// INLINE against the same column. All three forms are live in the tree today; a matrix that saw
// only direct calls would report false positives and be ignored, which is worse than no check.
//
// AND IT CHECKS ITS OWN COMPLETENESS. A guard over a hand-written list quietly stops covering the
// code the moment somebody adds a verb — so the membership itself is derived and asserted: every
// street crime (anything routed through `assertStreetCrime`) and every `collect*` action must be
// declared in a family or exempted WITH a stated reason.
//
// Scope, honestly: this checks that a gate is REACHED, not that it is correct. `fire` calling
// `safeHoused(ch)` proves the shield is consulted, not that the comparison is the right way round.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const GATES = ['jailed', 'hospitalized', 'safeHoused', 'penSafe', 'inHole', 'witproActive'];
// The column each gate reads, so a hand-written inline check counts as enforcement. Matched as a
// PROPERTY ACCESS (`ch.safe_until`) rather than the bare column, because the bare name also appears
// in every `WHERE jail_until IS NULL` in the tree — and a query predicate is not a hand-rolled gate.
// Counting those would put two dozen board and sweep functions on the drift-hazard list, and an
// advisory that is mostly wrong gets ignored, which this file's own header calls worse than none.
// And matched as the gate's SHAPE — a date COMPARISON (`new Date(x.safe_until) > new Date()`),
// which is what the helper does. Display and pricing code reads the same column and SUBTRACTS
// (`(new Date(ch.safe_until) - Date.now()) / 1000`, `bribeGuard` costing a remaining sentence); that
// is not a second copy of the gate and listing it as one is how an advisory line becomes noise.
const shape = (col) => new RegExp(`new Date\\(\\s*[\\w.?\\[\\]'"]*\\.${col}\\s*\\)(\\.getTime\\(\\))?\\s*>`);
const INLINE = { safeHoused: shape('safe_until'), jailed: shape('jail_until'),
  hospitalized: shape('hosp_until'), penSafe: shape('pen_safe_until'),
  inHole: shape('hole_until'), witproActive: shape('witpro_until') };

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
}(SRC));

// A function's body is its BRACE-MATCHED extent, not "up to the next export". Slicing to the next
// marker over-reads badly — `referralXpBonus` is the last `export function` in a 4,606-line
// rules.tail.js, so it would swallow every gate helper's own DEFINITION and be credited with all
// six. And an over-read makes the requirement check MORE PERMISSIVE (a verb credited with a gate it
// never reaches), which is the failure direction that turns a green run into a false clean bill.
// Scanner skips strings, template literals, comments and regex literals, since a `[{]` inside a
// regex would otherwise unbalance the count.
function bodyOf(src, from) {
  // Skip the PARAMETER LIST first by paren-matching. Taking the first `{` instead finds the default
  // parameter in `npcHit(h, ch, targetId, tierId, opts = {})` and yields a two-character body — which
  // reads as "this verb enforces nothing" and would fire on correct code.
  let i = src.indexOf('(', from);
  if (i < 0) return src.slice(from, from + 4000);
  for (let d = 0; i < src.length; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')') { d--; if (!d) { i++; break; } }
  }
  i = src.indexOf('{', i);
  if (i < 0) return src.slice(from, from + 4000);
  const start = i;
  let depth = 0;
  let prev = '';                                     // last significant char, for regex-vs-divide
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; if (i < 1) break; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === q) break;
        // a `${…}` inside a template can hold anything, including quotes and braces
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1; i += 2;
          for (; i < src.length && d; i++) { if (src[i] === '{') d++; else if (src[i] === '}') d--; }
          i--;
        }
      }
      prev = q; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev)) {    // regex literal, not division
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '[') { for (i++; i < src.length && src[i] !== ']'; i++) if (src[i] === '\\') i++; continue; }
        if (src[i] === '/') break;
        if (src[i] === '\n') break;                   // not a regex after all; bail rather than run away
      }
      prev = '/'; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(from, i + 1); }
    if (!/\s/.test(c)) prev = c;
  }
  return src.slice(from, start + 4000);               // unbalanced: fall back, never run to EOF
}

// ── extract every exported function with the gates it can reach ──────────────────────────────────
const fns = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const marks = [];
  const re = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m; while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const body = bodyOf(src, marks[i].at);
    // comments stripped FIRST: a gate merely discussed in prose is not a gate enforced, and this
    // file is dense with prose about gates.
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    let scope = code;
    const helpers = [];
    // Helpers are brace-matched too, for the same reason the caller is: a fixed-size window spills
    // past the helper's end into whatever function is declared next, and if THAT one gates something
    // the helper does not, every caller silently inherits credit for a gate it never reaches.
    // Measured on `assertStreetCrime`: a 2,000-char window over a 1,072-char helper carried 928
    // characters of a neighbouring function. Nothing is mis-credited today — the spill happens to
    // hold no extra gate — which is exactly why it had to be checked rather than assumed.
    for (const hm of code.matchAll(/(?<![\w$])(assert\w+|require\w+)\s*\(/g)) {
      const hi = src.search(new RegExp(`function\\s+${hm[1]}\\s*\\(`));
      if (hi >= 0) { scope += bodyOf(src, hi); helpers.push(hm[1]); }
    }
    // A THIN WRAPPER delegates its gates to the one function it returns — `robBusiness` and
    // `shakedownBusiness` are both a single `return extortFront(...)`, which is the one-core
    // discipline working exactly as intended, so refusing to follow it would make the matrix report
    // the RIGHT structure as a defect. Deliberately narrow: only a body that is nothing but that
    // one call. Following any called function would let a verb inherit a gate it never reaches and
    // turn this guard's passes into false negatives, which is the worse failure by far.
    const thin = code.match(/\{\s*return\s+(\w+)\s*\([^;]*\);?\s*\}\s*$/);
    if (thin) {
      const ti = src.search(new RegExp(`function\\s+${thin[1]}\\s*\\(`));
      if (ti >= 0) { scope += bodyOf(src, ti); helpers.push(thin[1]); }
    }
    const has = (g) => new RegExp(`(?<![\\w$])${g}\\s*\\(`).test(scope) || (INLINE[g] && INLINE[g].test(scope));
    fns.set(marks[i].name, { file: path.basename(f), scope, gates: new Set(GATES.filter(has)), helpers,
      inline: GATES.filter((g) => INLINE[g] && INLINE[g].test(code) && !new RegExp(`(?<![\\w$])${g}\\s*\\(`).test(code)) });
  }
}

// ── the families, and what each one's members must all enforce ───────────────────────────────────
const FAMILIES = [
  { name: 'street crime (offensive PvP)',
    why: 'you cannot work the streets from lockup, a hospital bed, or a safehouse — P1.3, "a shield, not a bunker"',
    require: ['jailed', 'hospitalized', 'safeHoused'],
    members: ['jump', 'fire', 'npcHit', 'stealCar', 'stealBoat', 'robTrunk', 'sabotage', 'robBusiness',
      'shakedownBusiness', 'takeoverBusiness', 'standoverSpeakeasy', 'raidRivalRacket', 'ambushConvoy', 'interceptRun'] },

  { name: 'PERSON crime (the mark must be reachable)',
    why: 'jail must never be MORE dangerous than the street — the class AUDIT-full-system-v2/v3 closed on '
       + 'fire/npcHit and v3 then closed on jump. Property crimes are deliberately NOT here: the garage '
       + 'does not go to lockup with its owner.',
    require: ['penSafe', 'inHole', 'witproActive'],
    members: ['jump', 'fire', 'npcHit', 'robTrunk'] },

  { name: 'collect income',
    why: 'BALANCE D2, SIGNED — collecting is an EXPOSED act; a man to ground does not walk the district. '
       + 'This is the exact gate collectFrontier was shipped without (AUDIT-world-frontier F1).',
    require: ['safeHoused'],
    members: ['collectBusiness', 'collectTerritory', 'collectFrontier', 'collectSov', 'collectSpeakeasy', 'collectRun', 'collectFamilyTribute', 'collectCorner'] },

  { name: 'debt enforcement',
    why: 'a lender leaning on a defaulter is doing street work, so the ACTOR needs the street-work '
       + 'gates (AUDIT-loan-sharking MED: the dropped `hospitalized` helper betrayed the intent). '
       + 'The BORROWER stays reachable on purpose — this is a civil recovery, not an attack.',
    require: ['jailed', 'hospitalized', 'safeHoused'],
    members: ['collectLoan'] },

  { name: 'extraction / parking money out of reach',
    why: 'the loot-proof-vault rule: escrow a stranger cannot reach must not be openable from inside a '
       + 'safehouse, or wealth shelters itself and Make-Risk-Pay stops meaning anything',
    require: ['jailed', 'safeHoused'],
    // (D11 2026-08-05: `invest` left the family with the Portfolio — its tombstone throws
    //  before any gate could run, so there is no gate left to require of it)
    members: ['offerLoan', 'postOrder', 'claimVaulted', 'buyPaper'] },
];

let checked = 0;
for (const fam of FAMILIES) {
  for (const name of fam.members) {
    const fn = fns.get(name);
    assert(fn, `${fam.name}: declared member ${name}() is not an exported function any more — `
      + 'the family list has rotted, so this whole family is checking nothing');
    for (const g of fam.require) {
      assert(fn.gates.has(g),
        `${name}() [${fn.file}] does not enforce ${g}() — every other verb in "${fam.name}" does.\n`
        + `      why it matters: ${fam.why}`);
      checked++;
    }
  }
}
console.log(`✓ ${checked} gate requirements hold across ${FAMILIES.length} families`);

// ── COMPLETENESS: a new verb must not slip past the matrix by not being listed ───────────────────
// Anything routed through assertStreetCrime IS a street crime by construction.
const streetCrimes = [...fns].filter(([, v]) => v.helpers.includes('assertStreetCrime')).map(([k]) => k);
const declaredStreet = new Set(FAMILIES.find((f) => f.name.startsWith('street crime')).members);
const undeclared = streetCrimes.filter((n) => !declaredStreet.has(n));
assert.equal(undeclared.length, 0,
  `street crime(s) routed through assertStreetCrime but absent from the matrix: ${undeclared.join(', ')} — `
  + 'add them to the family (or the matrix silently stops covering the newest PvP verbs)');

// Every collect* action must be classified. EXEMPT needs a reason, so "it was inconvenient" cannot
// pass as one.
const COLLECT_EXEMPT = {
  collectConvoy: 'gated at the route by district — the freight lands where it lands, and the '
    + 'safehouse block is enforced separately in the collect path',
  collectFrontierTribute: 'not an exported action',
};
// Classified means declared in ANY family, not just the income one — `collectLoan` is a collect
// verb whose gates belong to debt enforcement, and forcing it into the income family to satisfy
// the counter would assert the wrong requirement about it.
const declared = new Set(FAMILIES.flatMap((f) => f.members));
const strayCollect = [...fns.keys()].filter((n) => /^collect[A-Z]/.test(n)
  && !declared.has(n) && !COLLECT_EXEMPT[n]);
assert.equal(strayCollect.length, 0,
  `collect action(s) neither in the family nor exempted with a reason: ${strayCollect.join(', ')}`);
console.log(`✓ completeness: ${streetCrimes.length} street crimes and every collect* action are classified`);

// ── FAMILY 6: AGENT-EXCLUDED CASH FAUCETS, ENFORCED AT THE POINT OF PAYMENT ──────────────────────
// Recommended by the night economy red-team after it found two instances the five families above
// structurally could not see, because they are about WHO is paid rather than about reachability.
//
// The rule, and why it is a rule rather than a list: a handful of cash faucets exist specifically to
// reward a HUMAN for showing up — a login streak, a mentor's protégé stake, a crew's weekly job, a
// nightly window, the corner, the hustle. Agents are excluded from every one of them by standing
// posture, and that exclusion is the whole anti-Sybil argument for those faucets existing at all.
//
// AND IT MUST BE CHECKED AT THE POINT OF PAYMENT, which is the finding worth keeping: `agent_flag`
// is set by the account's OWN call to /v1/auth/agent-key, so it is mutable at any moment. A gate at
// formation time — "you may not be offered a mentorship if you are an agent" — reads state that can
// change before the money moves, and `mentor` shipped exactly that: form the tie as a human, flip
// the flag, collect $20,000. So membership is derived from the LEDGER WRITE, not from a hand list:
// any function that writes one of these reasons must reference agent_flag in the same scope.
const REWARD_PREFIXES = ['streak:', 'mentor:protege', 'crew:objective', 'primetime:', 'corner:', 'hustle:', 'firstblood:'];
// DECLARE-or-WAIVE (the NOT_API / COLLECT_EXEMPT discipline): a faucet on these prefixes either
// excludes agents at the point of payment, or says here why it does not. What the check enforces is
// therefore not "every participation faucet excludes agents" — that was never the standing posture,
// and asserting it would be inventing policy — but the thing that actually generalises: **the
// decision is made explicitly, and where it is made, it is made where the money moves.**
const FAUCET_WAIVED = {
  // A TRANSFER between two players out of the mentor's own earned cash, not a faucet — nothing is
  // created, so there is nothing for an agent to farm.
  mentorGift: 'a two-party transfer of the mentor\'s own cash, not a faucet',
  // ⚑ FOUNDER CALL, flagged 2026-08-11 (BALANCE.md § AGENTS AND THE PARTICIPATION FAUCETS). These
  // three pay a participation reward and do NOT exclude agents, while streak / crew-objective /
  // primetime / mentor do. Neither posture is obviously right: an agent that plays the corner is
  // playing the game, and the cash is non-extractable since the severance (it can never become
  // $OMR). Left as they ship rather than changed unilaterally — but now they are a decision on the
  // record instead of an omission nobody had noticed.
  claimCorner: 'not agent-excluded — founder call (petty, capped 5/day, non-extractable)',
  advanceHustle: 'not agent-excluded — founder call (level-scaled daily, non-extractable)',
  settleFirstBlood: 'not agent-excluded — founder call (once ever per street, non-extractable)',
};
const paysReward = (v) => REWARD_PREFIXES.some((p) => new RegExp(`reason: ['\`]${p}`).test(v.scope || ''));
// The anti-vacuity guard measures what the EXTRACTOR finds, before waivers — otherwise waiving
// everything would silently satisfy it, which is the failure mode it exists to prevent.
const allFaucets = [...fns].filter(([, v]) => paysReward(v));
assert(allFaucets.length >= 7,
  `the reward-faucet scan found only ${allFaucets.length} function(s) — the extractor has stopped seeing `
  + 'the ledger writes it keys on, so this family is checking nothing');
const faucets = allFaucets.filter(([n]) => !FAUCET_WAIVED[n]);
const leaky = faucets.filter(([, v]) => !/agent_flag/.test(v.scope || ''));
assert.equal(leaky.length, 0,
  `participation cash faucet(s) that never read agent_flag: ${leaky.map(([n, v]) => `${n}() [${v.file}]`).join(', ')}\n`
  + '      why it matters: these faucets exist to reward a human for showing up, and agents are excluded\n'
  + '      from every one by standing posture. Check the flag WHERE THE MONEY MOVES — a gate at\n'
  + '      formation time reads state the account can flip before it collects.');
console.log(`✓ ${faucets.length} participation cash faucets exclude agents at the point of payment `
  + `(${allFaucets.length - faucets.length} waived with a stated reason)`);

// ── the inline copies, COUNTED rather than silently tolerated ────────────────────────────────────
// A hand-rolled `safe_until` comparison is byte-equivalent to safeHoused() today. That is exactly
// the shape the extortFront/sackEmpire "one core, not a copy" lesson is about: the day the shield
// grows a second condition (a decree, a new state), the helper learns it and the copies do not.
const inlineSites = [...fns].filter(([, v]) => v.inline.length)
  .map(([k, v]) => `${k}() [${v.file}] inlines ${v.inline.join(', ')}`);
console.log(inlineSites.length
  ? `⚠ ${inlineSites.length} site(s) hand-roll a gate instead of calling the helper (equivalent today, a drift hazard):\n   - ${inlineSites.join('\n   - ')}`
  : '✓ no site hand-rolls a gate');

// ── THE PRIVATE COPY — the blind spot the inline advisory could not see ──────────────────────────
// The advisory above finds a date comparison written AT THE CALL SITE. It cannot find the far more
// common shape: a module that opens with its own `const jailed = (ch) => ...` and then calls it.
// To the extractor that is indistinguishable from calling the shared helper — `has()` sees
// `jailed(` and credits the gate — so twenty-six modules carried fifty-three private copies while
// this file reported sixteen problems and passed. That is the over-read direction, which is the
// dangerous one: it makes a requirement check MORE permissive and turns a green run into a false
// clean bill.
//
// So the three canonical names are RESERVED. Only their definition site may bind them; every other
// module imports. This is a hard assertion rather than an advisory because the tree is clean now,
// and because the whole point of collapsing the copies is that the next one must not be quiet.
const CANON = ['jailed', 'hospitalized', 'safeHoused'];
const DEFINES_CANON = {                                 // file → why it may bind the name
  'src/rules.tail.js': 'the definition site (the universal leaf, beside penSafe/inHole/witproActive)',
};
const copies = [];
for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  if (DEFINES_CANON[rel]) continue;
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const g of CANON) {
    // any binding of the name — `const jailed =`, `function jailed(`, `let jailed =`. A re-export
    // (`export { jailed } from ...`) binds nothing locally and is how social/shared.js keeps its
    // ~100 call sites working, so it is correctly not matched here.
    if (new RegExp(`(?:const|let|var)\\s+${g}\\s*=|function\\s+${g}\\s*\\(`).test(src)) {
      copies.push(`${rel} defines its own ${g}`);
    }
  }
}
assert.equal(copies.length, 0,
  'a canonical status predicate must be IMPORTED, never re-defined — a private copy is invisible to '
  + `the inline check above and cannot be fixed by fixing the helper:\n   - ${copies.join('\n   - ')}`);
console.log(`✓ no module re-defines ${CANON.join('/')} — every gate resolves to the one definition`);

// ── EVERY LOCATION GATE NAMES THE WAY OUT ────────────────────────────────────────────────────────
// A refusal that only says WHERE you should be leaves the player to go find the travel control,
// which is one screen out of twenty-five. Tester feedback 2026-08-11, verbatim: "if I try to do
// something in foundry but I can't cause I was in docs, I have to click through half of the tabs
// [...] before I find the tab where I even can move to a different location."
//
// Prose cannot be turned into a button, so `GameError` carries the destination as DATA and the
// client renders a one-tap "go there" from it. That works only if EVERY gate carries it — a single
// site that forgets is a refusal with no way out, and it looks identical to the others until a
// player hits exactly that one. So the payload is required here rather than remembered at 27 call
// sites, and a 28th written next month fails by name instead of shipping mute.
const DISTRICT_WAIVED = {
  // Not a location gate at all: the argument is a district NAME that doesn't exist, so there is
  // nowhere to send anyone. Travelling cannot help, and offering to travel would be a lie.
  'src/landmarks.js': 'bad district argument, not a wrong-location refusal — nowhere to travel to',
  // STREET DEEDS: the player PICKS the district for their new street from a list; 'district' means
  // "pick a valid one", not "you're in the wrong place" — there is no single destination to offer.
  'src/deeds.js': 'the caller chooses which district to claim in — a bad pick, not a wrong-location refusal',
};
const mute = [];
let districtGates = 0;
for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/new GameError\(\s*'district'/g)) {
    districtGates++;
    // paren-match the whole argument list — the payload is the third argument and a `.slice(+200)`
    // window would run past the throw into the next statement's object literals and read as a pass.
    let i = src.indexOf('(', m.index);
    let d = 0; let end = i;
    for (; i < src.length; i++) {
      if (src[i] === '(') d++;
      else if (src[i] === ')') { d--; if (!d) { end = i; break; } }
    }
    const args = src.slice(m.index, end);
    if (!/district:/.test(args) && !DISTRICT_WAIVED[rel]) {
      mute.push(`${rel}:${src.slice(0, m.index).split('\n').length} — ${args.slice(0, 90)}…`);
    }
  }
}
// Anti-vacuity: if the extractor stops matching, "0 mute gates" is what a broken scan looks like.
assert(districtGates >= 20,
  `the location-gate scan found only ${districtGates} site(s) — the extractor has stopped seeing the `
  + 'throws it keys on, so this check is passing over code it never read');
assert.equal(mute.length, 0,
  `location refusal(s) that name the destination in prose but not in DATA, so the client cannot offer\n`
  + `      a one-tap way out (pass it as the third GameError argument: { district: <id> }):\n   - ${mute.join('\n   - ')}`);
console.log(`✓ all ${districtGates - Object.keys(DISTRICT_WAIVED).length} wrong-location refusals carry the `
  + 'destination as data — the client turns every one into a "go there" button');

console.log('✅ THE GATE MATRIX passed — every verb in a family enforces the gates its siblings do, '
  + 'checked through direct calls, shared assert helpers and inline column comparisons alike; the '
  + 'membership is derived from the code rather than trusted, so a new street crime or collect action '
  + 'cannot slip past unclassified; the sites that hand-roll a gate instead of calling the helper '
  + 'are named rather than quietly accepted; and no module may re-define a canonical predicate, which '
  + 'is the shape the inline check structurally cannot see. Scope: it proves a gate is REACHED, not '
  + 'that it is correct.');

// ── THE PRICE WALLS — every real-value rate, or a stated reason ─────────────────────────────────
// Four times now a caller-supplied price has reached a real-value ledger with nothing bounding it
// (the family buyback, the bank buy, the sell tax, the stock fill), and each time the fix was the
// same wall and each time the checks downstream read green throughout — because they compare two
// numbers BOTH derived from the bad price. That is the class this asserts away.
//
// The rule is narrow so it stays true rather than becoming noise: in the REAL-VALUE modules, an
// exported function that takes a price (or derives a rate from an amount and a quantity) must
// either enforce a continuity wall or be listed here WITH the bound that stands in its place. A
// player's asking price on a listing is in-game cash, not a rate against real value, so those
// modules are out of scope by construction rather than by waiver.
{
  const MODULES = ['treasury.js', 'community.js', 'bank.js', 'desk.js', 'vig.js', 'bonds.js'];
  // A function is walled if it throws/returns a price refusal, or reads a *_MAX_PRICE_JUMP bound.
  const WALLED = /price_sanity|price_unanchored|price_high|price_low|MAX_PRICE_JUMP|MIN_PRICE_FRAC|PRICE_FLOOR_BPS/;
  const WAIVED = {
    // Bounded by QUANTITY rather than rate, in two places at once: the anti-Ponzi tranche cap
    // (`committed + payout <= capacity`) bounds the off-chain path, and the REAL path books the
    // contract's own authoritative payout, which Solidity already bounded with `maxOmrPerEth`
    // (fail-closed at 0), MAX_DISCOUNT_BPS and dailyCapOMR. A rate wall here would be a fourth
    // bound on a path that has three.
    'bonds.js:recordBond': 'the tranche cap off-chain; maxOmrPerEth + discount ceiling + daily cap on-chain',
    // The price is not the caller's at all: it is the descending Dutch clock read off the auction
    // row (`auctionPriceAt`), clamped at both ends, so the reserve IS the floor. The caller supplies
    // a QUANTITY, itself clamped to the lot and the shelf. Nothing to be continuous with.
    'desk.js:recordAuctionBuy': 'the price is server-computed (the Dutch clock), not supplied',
  };
  const unwalled = [];
  let scanned = 0;
  // Comments OUT first. A body slice runs to the next `export`, which swallows THAT function's
  // leading doc comment — so prose about a price would put a neighbour in scope, and prose about a
  // wall would credit one that isn't there. (Both directions observed on the first run.) `//` is
  // left alone after a colon so a URL in an error string does not eat its own line.
  const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const rel of MODULES) {
    const src = decomment(fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'));
    // split on exported function boundaries so each body is read whole and no wall is credited to
    // its neighbour (the sliced-body lesson — an over-read makes the check MORE permissive, which
    // is the direction that turns a green run into a false clean bill of health).
    const marks = [...src.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)];
    for (let i = 0; i < marks.length; i++) {
      const name = marks[i][1];
      const body = src.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : src.length);
      const sig = body.slice(0, body.indexOf(')') + 1);
      // in scope: it is handed a price, or it derives a rate to store as one
      const takesPrice = /price/i.test(sig);
      const derivesRate = /price_(?:omr|eth)_per|round6\([a-z]+ \/ [a-z]+\)/.test(body) && /INSERT INTO/.test(body);
      if (!takesPrice && !derivesRate) continue;
      scanned++;
      if (WAIVED[`${rel}:${name}`] || WALLED.test(body)) continue;
      unwalled.push(`${rel}:${name}`);
    }
  }
  // Anti-vacuity: if the extractor stops matching, an empty `unwalled` is what a broken scan looks
  // like. Eight surfaces were walled by hand; the scan must still be finding them.
  assert(scanned >= 7,
    `the price-wall scan found only ${scanned} real-value rate surface(s) — the extractor has stopped `
    + 'seeing them, so this check is passing over code it never read');
  assert.equal(unwalled.length, 0,
    'real-value function(s) that take or derive a PRICE with nothing bounding it. A downstream check\n'
    + '      cannot catch this: it compares two numbers both derived from the bad price. Add a continuity\n'
    + `      wall against the last REAL print, or waive it here with the bound that replaces it:\n   - ${unwalled.join('\n   - ')}`);
  console.log(`✓ all ${scanned} real-value price surfaces are walled or waived with a stated bound`);
}

// ═══ THE CONNECTION LEDGER — a pooled client that is taken must be given back ═══
//
// Found by the red team of 2026-08-16, and it is this file's own class exactly: `sweepNpcWars` and
// `sweepFamilyAggro` each took a connection per due row and never released it, while the three
// sibling sweeps a few hundred lines DOWN THE SAME FILE all release in a `finally` — and so do the
// other 105 `pool.connect()` sites in src/. Two of 109.
//
// Why it earns a hard check rather than a note. A leaked pooled client is not one slow request: it
// is PERMANENT and CUMULATIVE for the life of the process, so the damage is not proportional to the
// mistake. Measured on real Postgres (pool max 3, five due rows): three connections leaked, the
// sweep then threw `timeout exceeded when trying to connect` ON ITSELF at row four, and the next
// job to ask for a connection failed the same way. In production the worker's pool is 20, and the
// worker is the process that owns the nightly §10.4 sweep, the drift alarm, the backup watchdog and
// every timed settlement — so the failure mode is the whole background half of the game stopping,
// silently, with the alarms that would have told you about it stopped too.
//
// The rule is deliberately narrow so it stays true: every `const x = await pool.connect()` must
// have an `x.release()` before its enclosing function ends. It does NOT check that the release is
// in a `finally` — a few sites legitimately hold a connection across a whole job (the advisory-lock
// pattern) and release it on a later path — because a rule that flagged those would be noise, and
// noise gets deleted. Taking one and never giving it back is the thing that has no defensible form.
{
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  } };
  walk(SRC);
  const leaked = [];
  let seen = 0;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+pool\.connect\(\)/.exec(lines[i]);
      if (!m) continue;
      seen++;
      const v = m[1];
      let released = false;
      // scan to the end of the enclosing top-level function: the next line that CLOSES at column 0
      for (let j = i + 1; j < lines.length && !/^\}/.test(lines[j]); j++) {
        if (new RegExp(`\\b${v}\\.release\\(\\)`).test(lines[j])) { released = true; break; }
      }
      if (!released) leaked.push(`${path.relative(SRC, f)}:${i + 1} (${v})`);
    }
  }
  // Anti-vacuity: an empty `leaked` is also what a broken scanner looks like. The tree has >100 of
  // these, so if the extractor stops finding them the guard is passing over code it never read.
  assert(seen >= 100,
    `the pooled-connection scan found only ${seen} \`pool.connect()\` site(s) — the extractor has `
    + 'stopped seeing them, so this check is vacuous rather than clean');
  assert.equal(leaked.length, 0,
    'pooled connection(s) taken and never released. This is permanent and cumulative: once the pool\n'
    + '      is exhausted the process can never open another transaction, and for the WORKER that means\n'
    + '      the §10.4 sweep, the drift alarm and every timed settlement stop — silently.\n'
    + `      Add a \`finally { ${'${client}'}.release(); }\`:\n   - ${leaked.join('\n   - ')}`);
  console.log(`✓ all ${seen} pooled connections are released before their function returns`);
}

// ═══ THE HANDOVER LEDGER — a car changes hands STOCK ═════════════════════════════════════════════
//
// Six places move a car between characters: a market buy-now, an auction settle, a loan collect, the
// grace-forfeit sweep, a pink-slip race, and a theft. A car carries two kinds of flag that must not
// survive the handover — CONSENT (`race_limit`, `pink_slip`: the owner offered THIS car on the strip
// or for pinks, and the new owner never agreed to either) and a CONSUMABLE (`nos`: charges the old
// owner paid for). Five sites clear all three. The theft cleared only the two consent flags, and it
// read as deliberate because its own comment named only "the consent flags" — which is exactly how a
// sixth site diverges quietly (red team #6; the consent half of the same class was found by
// AUDIT-street-races-step-two, so this is the second finding here and the reason it gets a check).
//
// The rule is narrow on purpose: it applies to a statement that RE-POINTS `character_id`, which is
// what a handover is. A waiver must say why. Scope: it proves the clause is PRESENT, not that the
// surrounding gate logic is right.
{
  const HANDOVER_WAIVED = {
    // The estate re-points only EXTRACTED cars/boats at the heir. Extraction already refuses a
    // listed or pledged row and clears the consent flags itself (`nft.js:KINDS[*].clear`), and an
    // extracted row is filtered out of `owned.cars` entirely — so there is no flag left to clear and
    // nothing that reads one.
    'social/estate.js': 'the estate moves only minted_onchain rows, which extraction already cleared',
  };
  const MUST_CLEAR = { cars: ['race_limit', 'pink_slip', 'nos'], boats: ['rendezvous'] };
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d)) {
    const p2 = path.join(d, e);
    if (fs.statSync(p2).isDirectory()) walk(p2); else if (p2.endsWith('.js')) files.push(p2);
  } };
  walk(SRC);
  const bad = [];
  let handovers = 0;
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /UPDATE (cars|boats) SET character_id\s*=/.exec(lines[i]);
      if (!m) continue;
      handovers++;
      if (HANDOVER_WAIVED[rel]) continue;
      const stmt = lines[i];
      const missing = MUST_CLEAR[m[1]].filter((c) => !new RegExp(`\\b${c}\\s*=`).test(stmt));
      if (missing.length) bad.push(`${rel}:${i + 1} keeps ${missing.join(', ')}`);
    }
  }
  assert(handovers >= 6,
    `the handover scan found only ${handovers} ownership transfer(s) — the extractor has stopped `
    + 'seeing them, so this check is vacuous rather than clean');
  assert.equal(bad.length, 0,
    'ownership transfer(s) that leave a flag behind. A car arrives on the strip its new owner never\n'
    + '      put it on, offered for pinks they never offered, or carrying nitrous somebody else paid for:\n'
    + `   - ${bad.join('\n   - ')}`);
  console.log(`✓ all ${handovers} vehicle handovers clear the consent flags and the consumable`);
}

// ═══ THE SCENERY LEDGER — a human status board must not rank NPCs ═════════════════════════════════
//
// The population layer makes a resident a REAL character: real `accounts`, real `characters`, real
// legends, dying through the ORDINARY estate. That is what lights up every board at once, and it is
// also what puts scenery on the boards meant to rank PEOPLE. The rule was already written down —
// "a future step that gives residents a legend must exclude them on that board at the same time" —
// and it was followed on five boards and forgotten on the rest, of which four were reachable:
//
//   • duels     — the ONE board with no `> 0` threshold: it ranks every living character on raw elo,
//                 and a resident's `duel_elo` DEFAULTS to ELO_START. Reproduced at 6 of 7 entries.
//   • bloodline — residents die normally, so each death writes a `bloodline` row; six generations of
//                 a boss-band line out-scored the only human on the server. Reproduced at score 520.
//   • heists    — `fillHeist` hires resident hands so a solo player can run crew content, and the
//                 success loop bumps `heists_pulled` for EVERY member row, hired ones included.
//   • feuds     — had NEITHER exclusion, and nothing in the vendetta swear consults `is_npc`.
//
// So this is catalogue-or-declare on the class rather than four patches: every exported *Leaderboard
// must exclude residents (`is_npc` / `npc_flag`), or be waived HERE with the reason it cannot rank
// one. It proves the exclusion is REACHED, not that the whole query is right — the same scope as the
// gate matrix. Agents are deliberately NOT part of this check: wire/world include them by a recorded
// decision, so folding the two rules together would make this one fire on a settled question.
const SCENERY_WAIVED = {
  // ranks GANGS, never characters — an NPC family is the scenery here, and each of these is already
  // bounded by a quantity a resident-run family cannot accrue (standing, turf, strongholds, $OMR).
  'sov.js:sovLeaderboard': 'ranks gangs by stronghold points; NPC families build none',
  'territory.js:territoryLeaderboard': 'ranks gangs by territory income; NPC families hold no turf',
  'world.js:frontierLeaderboard': 'ranks gangs by outposts held; NPC families hold none',
  'vanity.js:foundationLeaderboard': 'ranks gangs by foundation tier; NPC families hold no $OMR',
  'megaproject.js:familyBuildLeaderboard': 'ranks gangs by monument value; NPC families build none',
  'npcwar.js:conquestLeaderboard': 'ranks player gangs BY conquering NPC outfits — the NPCs are the subject',
  // account-only boards with no character join and no resident-reachable quantity
  'megaproject.js:builderLeaderboard': 'ranks accounts by monument value laid; residents contribute none',
  'crew.js:crewLeaderboard': 'ranks crews by member kills; residents never join a crew',
  'portfolio.js:portfolioLeaderboard': 'retired with D11 — the paper book no longer exists',
  'portfolio.js:familyPortfolioLeaderboard': 'retired with D11 — the paper book no longer exists',
  // the agent board's POSITIVE filter is the exclusion: a resident is not agent-flagged
  'growth.js:agentLeaderboard': 'ranks agent_flag accounts only, so a resident cannot appear',
};

{
  const bad = [], boards = [];
  for (const f of files) {
    const rel = path.relative(SRC, f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/export async function (\w*[Ll]eaderboard)\s*\(/g)) {
      const name = `${rel}:${m[1]}`;
      boards.push(name);
      if (SCENERY_WAIVED[name]) continue;
      const body = bodyOf(src, m.index);
      // PER RANKING STATEMENT, not per body — the first cut asked only whether the exclusion appeared
      // ANYWHERE in the function, and a board with two queries (duels ranks an elo ladder AND a titles
      // board) passed with one of them guarded. That is the exact shape of the bug being fixed, so the
      // check has to be at least as fine-grained as the defect. A RANKING statement is one that reads
      // `characters` and ORDERs — which excludes the per-account steward lookups the JS-aggregating
      // boards do inside a loop over an already-filtered set, where demanding the clause is noise.
      const stmts = [...body.matchAll(/`([^`]+)`/g)].map((q) => q[1])
        .filter((q) => /\b(FROM|JOIN)\s+characters\b/i.test(q) && /ORDER\s+BY/i.test(q));
      const unguarded = stmts.filter((q) => !/is_npc|npc_flag/.test(q));
      if (unguarded.length) bad.push(`${name} (${unguarded.length} of ${stmts.length} ranking queries)`);
      else if (!stmts.length && !/is_npc|npc_flag/.test(body)) bad.push(name);
    }
  }
  // the waiver list is data too: a waived board that no longer exists is a stale exemption, and a
  // stale exemption is how a real board later inherits somebody else's reason.
  const stale = Object.keys(SCENERY_WAIVED).filter((k) => !boards.includes(k));
  assert.equal(stale.length, 0,
    `waived board(s) that no longer exist — stale exemption(s):\n   - ${stale.join('\n   - ')}`);
  assert(boards.length >= 40,
    `the leaderboard scan found only ${boards.length} board(s) — the extractor has stopped seeing them, `
    + 'so this check is vacuous rather than clean');
  assert.equal(bad.length, 0,
    'human status board(s) that do not exclude residents. The population layer makes a resident a real\n'
    + '      character with real legends, so scenery ranks on a board meant for people:\n'
    + `   - ${bad.join('\n   - ')}`);
  console.log(`✓ all ${boards.length - Object.keys(SCENERY_WAIVED).length} human status boards exclude `
    + `residents (${Object.keys(SCENERY_WAIVED).length} waived with a stated reason)`);
}

// ═══ THE WATCHER POISON LEDGER — a malformed log must never wedge a stream ════════════════════════
// The chain watchers share ONE isolation rule (`src/watcher.js:isolate`): a DETERMINISTIC data fault
// in a log is skipped so the cursor advances past it, and anything else re-throws so the cursor does
// NOT advance past a good event. That rule is only as good as the POISON list, and the list had been
// grown once, for the stream that prompted it — so `recordHarvestFee`'s codes sat outside it while
// `syncHarvestFees`' own comment promised the protection. Reproduced (red-team R31 F3): a dust
// harvest whose fee rounds to zero re-threw every tick, the cursor never moved, the good fee behind
// it never booked, and the Bank's revenue stopped permanently.
//
// So the list is catalogued rather than remembered: every GameError code a watcher recorder can
// throw is either POISON (skip it — it can never succeed) or waived HERE with the reason it must
// re-throw. A new recorder, or a new code on an existing one, fails this until somebody decides
// which it is. Scope: it proves each code is CLASSIFIED, not that the classification is right.
{
  const WATCHER = fs.readFileSync(path.join(SRC, 'watcher.js'), 'utf8');
  const poison = new Set(
    (WATCHER.match(/const POISON = new Set\(\[([\s\S]*?)\]\)/)?.[1] || '')
      .replace(/\/\/[^\n]*/g, '').match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) || []);
  assert(poison.size >= 6, 'the POISON set could not be read out of src/watcher.js — this check is vacuous');

  // A code that MUST re-throw, with the reason. These are not data faults: retrying is the point.
  const WAIVED = {
    // recordStorePurchase deliberately HOLDS the cursor on a sku we no longer sell: real money
    // arrived for something unknown, so a human looks rather than the payment being skipped past.
    retired: 'a real payment for a retired sku must stop the stream, not be skipped',
    bad_sku: 'same — money arrived for a package this build does not know',
    // recordBond guards BOTH of these on `!onchain`, and the watcher always passes `onchainPayout`
    // (the chain is the source of truth for a real bond, and bypassing the backend tranche cap is
    // deliberately what stops a real bond stalling this very cursor). Unreachable from a log.
    price: 'recordBond: !onchain only — the watcher books the event\'s own payout',
    over_capacity: 'recordBond: !onchain only — a real bond deliberately bypasses the backend tranche cap',
  };

  // the recorders each stream hands to isolate(), then every GameError code in their bodies
  const recorders = [...WATCHER.matchAll(/isolate\('[^']+',\s*\(\)\s*=>\s*([A-Za-z_]+)\(/g)].map((m) => m[1]);
  assert(recorders.length >= 10, `only ${recorders.length} watcher recorders found — the extractor is broken`);
  const unclassified = [];
  for (const fn of new Set(recorders)) {
    let src = null;
    for (const f of files) {                  // the tree-wide list built at the top of this file
      const text = fs.readFileSync(f, 'utf8');
      const at = text.search(new RegExp(`(export\\s+)?async function ${fn}\\s*\\(`));
      if (at >= 0) { src = bodyOf(text, at); break; }
    }
    assert(src, `watcher recorder ${fn} could not be located — the extractor is broken, not the code`);
    for (const m of src.matchAll(/GameError\('([a-z_]+)'/g)) {
      const code = m[1];
      if (!poison.has(code) && !WAIVED[code]) unclassified.push(`${fn} → '${code}'`);
    }
  }
  assert.equal(unclassified.length, 0,
    'watcher recorder(s) can throw a code that is neither POISON nor waived. Whichever it is, decide:\n'
    + '      POISON = the log can never succeed, skip it and advance the cursor;\n'
    + '      waived = it must re-throw, and the stream stalls until a human looks.\n'
    + '      Leaving it unclassified means it re-throws by default, which wedges the stream forever:\n'
    + `   - ${unclassified.join('\n   - ')}`);
  console.log(`✓ every code ${new Set(recorders).size} watcher recorders can throw is classified poison or waived`);
}

// ═══ THE ISOLATION LEDGER — one poison stream must not starve the other ten ══════════════════════
//
// The worker tick fans out to ~60 independent jobs and isolates each one with `safe()`, so a poison
// row in one cannot starve the rest. The CHAIN-SYNC tick did not: eleven watcher syncs, the stock
// delivery keeper, and the two DEX bots all sat inside ONE try/catch. A throw in the first sync
// skipped every job below it — including the two bots that RT#4 had individually `safe()`-wrapped
// for exactly this reason, so that fix was silently bypassed by an outer catch one level up (red
// team #8). The failure mode is the recorded one: the fee stream wedges, and the bond sync, the
// deed transfers, the delivery keeper and both real-money keepers stop with it, every tick, quietly.
//
// The rule is narrow so it stays true: inside `startWorker`, every awaited call to a `sync*` /
// `run*` / `sweep*` job must be wrapped in `safe(...)`. It says nothing about what a job does with
// its own errors — only that ONE job's throw cannot take its siblings down with it.
//
// The second half is what makes the first half real: `safe()` returns NULL on failure, so a caller
// that immediately dereferences the result (`c.processed`) turns a contained failure back into an
// uncontained TypeError, landing in the same outer catch the wrap was meant to avoid. Every read of
// a wrapped result must be optional-chained.
{
  const src = fs.readFileSync(path.join(SRC, 'worker.js'), 'utf8');
  // the worker's two ticks live inside the main-module guard, not a named export
  const at = src.search(/if \(process\.argv\[1\] && process\.argv\[1\]\.endsWith\('worker\.js'\)\)/);
  assert(at >= 0, 'the worker main-module block could not be located — the extractor is broken, not the code');
  const body = bodyOf(src, at);

  // the tick harnesses themselves (`syncTick`, `guardedTick`, …) are declared IN this block; a job
  // is imported from a module, so anything locally declared is the harness and not a job.
  const local = new Set([...body.matchAll(/(?:const|let)\s+(\w+)\s*=/g)].map((m) => m[1]));
  const bare = [];
  let jobs = 0;
  for (const line of body.split('\n')) {
    if (!/\bawait\b/.test(line)) continue;
    for (const m of line.matchAll(/\b((?:sync|run|sweep)[A-Z]\w*)\s*\(/g)) {
      if (local.has(m[1])) continue;
      jobs++;
      if (!/\bsafe\(/.test(line)) bare.push(`${m[1]}()`);
    }
  }
  assert(jobs >= 60,
    `the worker-job scan found only ${jobs} job call(s) — the extractor has stopped seeing them, so `
    + 'this check is vacuous rather than clean');
  assert.equal(bare.length, 0,
    'worker job(s) run outside `safe()`. One throw then skips every job BELOW it in the same tick —\n'
    + '      which is how a wedged stream silently stops the settlements and keepers that follow it:\n'
    + `   - ${bare.join('\n   - ')}`);

  // and the null-deref half: a `safe()`-wrapped result read without `?.`
  const unsafeRead = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+safe\(/.exec(lines[i]);
    if (!m) continue;
    const v = m[1];
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (new RegExp(`(?:const|let)\\s+${v}\\s*=`).test(lines[j])) break;   // rebound
      const hit = new RegExp(`\\b${v}\\.\\w`).exec(lines[j]);
      if (!hit) continue;
      // What is unsafe is a deref that runs UNCONDITIONALLY. `?.` is one way to be safe; a
      // truthiness test between the binding and the read is the other, and it takes several shapes
      // here (`if (r) …r.toWindow`, `if (s?.converted > 0) …s.season`, `arch && arch.state`,
      // and multi-line `if (pop && …)`). So scope to the enclosing statement — walk back to the
      // and multi-line `if (pop && …)`, and derefs inside an `if (oh && …) {` block). So look at
      // everything between the binding and the read: if the code tested `v` anywhere in that span
      // it cannot be null at the deref. Scope limit: a deref that falls OUTSIDE an earlier guard's
      // block reads as guarded — the shape this catches is bind-then-deref, which is the one that
      // shipped.
      const stmt = lines.slice(i + 1, j).join('\n') + lines[j].slice(0, hit.index);
      const guarded = new RegExp(`\\b${v}\\s*(?:\\?\\.|&&)`).test(stmt)
        || new RegExp(`if\\s*\\(\\s*${v}\\s*[)&?]`).test(stmt);
      if (!guarded) unsafeRead.push(`${v} at line ${j + 1} of the worker main block`);
    }
  }
  assert.equal(unsafeRead.length, 0,
    '`safe()` returns NULL on failure, and these read the result without `?.` — so a CONTAINED\n'
    + '      failure becomes an uncontained TypeError in the very next statement, landing in the\n'
    + '      outer catch the wrap exists to avoid:\n'
    + `   - ${unsafeRead.join('\n   - ')}`);
  console.log(`✓ all ${jobs} worker jobs are isolated and every wrapped result is read null-safely`);
}

// ═══ THE CATALOG LEDGER — an object index is not an allowlist ════════════════════════════════════
//
// `if (!CATALOG[userInput]) throw` reads like a membership test and is not one: every JavaScript
// object inherits `__proto__`, `constructor`, `toString`, `valueOf` and `hasOwnProperty`, and each
// of those indexes TRUTHY. So the gate passes for exactly those keys and the value flows on.
//
// Found by the red team of 2026-08-17, driven through the real routes. Two of the five
// user-reachable gates were live defects: `KITCHEN.MODULES[modId]` reached a `lab_${modId}` COLUMN
// NAME and 500'd on it, and `MASTERY.TRAITS[traitId]` returned 200 and WROTE `trait_id='__proto__'`
// — permanently consuming the once-ever level-50 choice with a trait that then grants nothing.
// Injection was never possible (a quoted payload is not a prototype key, so the gate catches it),
// which is precisely what made the gate look adequate.
//
// The rule: a gate of the form `CATALOG[key]` where CATALOG is a module-level (SHOUTY) catalog and
// `key` is a variable must use `Object.hasOwn`. A waiver must say why the key cannot be
// user-supplied — a numeric index, a column read back out of our own database, a route name we
// generated. Scope: it proves the PREDICATE is right, not that the surrounding logic is.
{
  const CATALOG_WAIVED = {
    // key is a loop index over our own array, never a request field
    'chainparams.js:CHAIN_PARAMS': 'the key is a numeric index into our own array',
    // tier is an integer column read back out of account_persistent
    'pass.js:PASS.TRACK': 'the key is an integer tier read out of our own row',
    // district ids are validated upstream against DISTRICTS; the `|| []` fallback is already safe
    'rules.tail.js:DEEDS.NEIGHBORHOODS': 'district is validated upstream and the || [] fallback is safe',
    // the key is the route name WE registered, never a request field
    'server.js:ACTIVITY_WIRE': 'the key is a route name the server itself emitted',
    // trackId comes from MASTERY.TRACKS.find() at every call site; returns a neutral 1 either way
    'game.js:MASTERY.PERKS': 'trackId is resolved from the TRACKS catalog before it reaches here, and the miss path returns a neutral 1',
    // taskId is gated by the ONBOARD_TASKS lookup above it; returns a boolean, touches no SQL
    'verify.js:TASK_PROVIDER': 'taskId is gated upstream and the result is a boolean, never a column or a write',
  };
  const bare = [];
  const seenKeys = new Set();
  let gates = 0;
  for (const f of files) {                       // the tree-wide list built at the top of this file
    const rel = path.relative(SRC, f);
    // line-based, so drop whole-line comments: prose about a gate is not a gate (the gate-matrix
    // extractor learned this the expensive way — an over-read is the permissive direction).
    const lines = fs.readFileSync(f, 'utf8').split('\n').map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l));
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // A gate reads one of two ways, and the extractor must see BOTH — a scanner that only knows
      // the broken form stops counting a site the moment it is fixed, so the guard silently shrinks
      // to nothing as the tree gets healthier. That is the vacuity trap wearing a new hat.
      const safe = [...l.matchAll(/Object\.hasOwn\(\s*([A-Z][\w.]*)\s*,\s*([a-z]\w*)\s*\)/g)];
      for (const m of safe) {
        gates++;
        seenKeys.add(`${path.basename(rel)}:${m[1]}`);
      }
      // …and the bare index form: `const x = CAT[key]` with an `if (!x)` in the next three lines,
      // or an inline `if (!CAT[key])`.
      const decl = /(?:const|let)\s+(\w+)\s*=\s*([A-Z][\w.]*)\[([a-z]\w*)\]/.exec(l);
      const inline = /if\s*\(\s*!\s*([A-Z][\w.]*)\[([a-z]\w*)\]/.exec(l);
      let cat = null; let key = null;
      if (inline) { cat = inline[1]; key = inline[2]; }
      else if (decl && new RegExp(`if\\s*\\(\\s*!\\s*${decl[1]}\\b`).test(lines.slice(i + 1, i + 4).join('\n'))) {
        cat = decl[2]; key = decl[3];
      }
      if (!cat) continue;
      const id = `${path.basename(rel)}:${cat}`;
      if (safe.some((m) => m[1] === cat)) continue;   // already counted above, and it IS the fix
      gates++;
      seenKeys.add(id);
      if (CATALOG_WAIVED[id]) continue;
      bare.push(`${rel}:${i + 1}  ${cat}[${key}]`);
    }
  }
  assert(gates >= 8,
    `the catalog-gate scan found only ${gates} gate(s) — the extractor has stopped seeing them, so `
    + 'this check is vacuous rather than clean');
  assert.equal(bare.length, 0,
    'catalog membership tested by INDEX rather than `Object.hasOwn`. `__proto__`, `constructor`,\n'
    + '      `toString`, `valueOf` and `hasOwnProperty` all index truthy, so the gate is decorative for\n'
    + '      exactly those keys — and what flows past it has reached a column name (a 500) and a write\n'
    + '      (permanent data corruption) before:\n'
    + `   - ${bare.join('\n   - ')}`);
  const stale = Object.keys(CATALOG_WAIVED).filter((k) => !seenKeys.has(k));
  assert.equal(stale.length, 0,
    `catalog gate waiver(s) for a gate that no longer exists — drop them: ${stale.join(', ')}`);
  console.log(`✓ all ${gates} catalog gates test membership, not truthiness `
    + `(${Object.keys(CATALOG_WAIVED).length} waived with a stated reason)`);
}

// ═══ THE ABI LEDGER — the backend's event signatures must match the contracts' ════════════════════
//
// Every watcher decodes a log through a `parseAbiItem('event …')` string written by hand, against a
// declaration that lives in a different language in a different directory. Nothing crossed them
// until RT#9 did it once, by eye, and found a drift: `HarvestFeeTaken`'s third parameter is `assets`
// on-chain and was `amount` in the backend. That one was inert — viem decodes POSITIONALLY, so both
// sides being wrong together still worked — which is exactly why it survived: it could only be
// caught by comparing the two declarations, never by running either.
//
// WHY THE PARAMETER NAME IS THE POINT. A type-only comparison passes the drift that actually hurts:
// a SAME-TYPED ADJACENT SWAP. `Bonded` has six adjacent non-indexed `uint256` (principal, payout,
// toPol, toDev, toRwa, toVig); `Delivered` has two adjacent `address indexed`; `Extracted` has two
// adjacent `string`. Swap any neighbouring pair and every type still lines up, the topic hash is
// unchanged, viem decodes without complaint — and the backend books the POL slice as the dev slice,
// or delivers stock to the token instead of the recipient. Only the names disagree, so the names are
// what this checks.
//
// The indexed flag is checked for a different reason: it decides whether a field arrives in `topics`
// or in `data`, so getting it wrong is not a mis-labelling, it is a decode that silently yields the
// wrong value for every field after it.
//
// AND THE READER, which is the half a declaration check cannot see. `parseAbiItem` says what the
// log contains; the mapper below it says which field to take. Fix one and not the other and the
// read is `undefined` — silently, since viem returns no such key rather than throwing. So the
// second half binds every `l.args.X` to the event its own `getLogs({ event: … })` names, and
// requires X to be a parameter that event declares. That is what makes the rename above safe to
// have done: the ABI and its reader are now checked against each other, not merely each against
// itself.
{
  // an event the backend watches that no contract in this repo declares. Each must name its real
  // source, because "not ours" is the only honest reason a signature has nothing to be checked
  // against — and an unexplained miss is how a typo'd event name would hide here forever.
  const ABI_EXTERNAL = {
    ModifyLiquidity: 'Uniswap v4-core IPoolManager — vendored dependency, not a contract of ours',
    Transfer: 'the ERC-721 standard event (OpenZeppelin IERC721), not declared in our sources',
  };

  const SOL = new URL('../omerta-contracts/src/', import.meta.url).pathname;
  const walkSol = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walkSol(path.join(d, e.name)) : [path.join(d, e.name)]));

  // "event Name(type indexed name, …)" → a comparable shape. Solidity and the viem string use the
  // same grammar here, so ONE parser reads both — which is the point: two parsers could disagree
  // about the thing they exist to compare.
  const parseEvt = (sig) => {
    const m = /^\s*event\s+(\w+)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(sig);
    if (!m) return null;
    const body = m[2].trim();
    const params = body ? body.split(',').map((p) => {
      const t = p.trim().split(/\s+/);
      return { type: t[0], indexed: t.includes('indexed'), pname: t[t.length - 1] === 'indexed' ? '' : (t.length > 1 ? t[t.length - 1] : '') };
    }) : [];
    return { name: m[1], params };
  };
  const fmt = (e) => `${e.name}(${e.params.map((p) => `${p.type}${p.indexed ? ' indexed' : ''} ${p.pname}`).join(', ')})`;

  const backendEvents = [];
  for (const f of files) {                       // the tree-wide src list built at the top of this file
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/parseAbiItem\(\s*'(event [^']+)'\s*\)/g)) {
      const e = parseEvt(m[1]);
      if (e) backendEvents.push({ file: path.relative(SRC, f), ...e });
    }
  }
  const onchain = new Map();
  for (const f of walkSol(SOL).filter((f) => f.endsWith('.sol'))) {
    // strip line comments: a commented-out event declaration is not a declaration
    const s = fs.readFileSync(f, 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const m of s.matchAll(/\bevent\s+\w+\s*\([\s\S]*?\)\s*;/g)) {
      const e = parseEvt(m[0]);
      if (!e) continue;
      if (!onchain.has(e.name)) onchain.set(e.name, []);
      onchain.get(e.name).push({ file: path.basename(f), ...e });
    }
  }

  assert(backendEvents.length >= 12,
    `the ABI scan found only ${backendEvents.length} backend event signature(s) — the extractor has `
    + 'stopped seeing them, so this check is vacuous rather than clean');
  assert(onchain.size >= 40,
    `the ABI scan found only ${onchain.size} contract event declaration(s) — it is not reading the `
    + 'Solidity sources, so every comparison below is against nothing');

  const drift = [];
  const unexplained = [];
  const seenExternal = new Set();
  for (const b of backendEvents) {
    const cands = onchain.get(b.name) || [];
    if (!cands.length) {
      if (ABI_EXTERNAL[b.name]) { seenExternal.add(b.name); continue; }
      unexplained.push(`${b.file}  ${fmt(b)}`);
      continue;
    }
    if (cands.some((c) => fmt(c) === fmt(b))) continue;
    drift.push(`${b.file}\n       backend: ${fmt(b)}\n       onchain: ${cands.map((c) => `${fmt(c)}  [${c.file}]`).join('\n       onchain: ')}`);
  }

  assert.equal(drift.length, 0,
    'a watcher decodes a log against a signature the contract does not declare. viem decodes\n'
    + '      POSITIONALLY, so a name drift is silent until somebody renames one side and the reader\n'
    + '      destructures `undefined`; a same-typed ADJACENT SWAP is silent forever and books the\n'
    + '      wrong field:\n'
    + `   - ${drift.join('\n   - ')}`);
  assert.equal(unexplained.length, 0,
    'a watched event matches no contract declaration and is not listed as external. Either the name\n'
    + '      is a typo (in which case the stream is dead and nothing says so) or it belongs to a\n'
    + '      dependency and must say which:\n'
    + `   - ${unexplained.join('\n   - ')}`);
  const staleExternal = Object.keys(ABI_EXTERNAL).filter((k) => !seenExternal.has(k));
  assert.equal(staleExternal.length, 0,
    `external-event waiver(s) for an event nothing watches — drop them: ${staleExternal.join(', ')}`);

  console.log(`✓ all ${backendEvents.length - seenExternal.size} watched event signatures match their `
    + `contract declaration on type, indexed-ness AND parameter name (${seenExternal.size} external)`);

  // ── the reader half: every `l.args.X` must be a field the event it decodes actually declares ────
  // Both decoders in the tree share one idiom — `getLogs({ …, event: someEv })` and then `l.args.X`
  // below it — so a read binds to the nearest event named before it.
  const argDrift = [];
  let argReads = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const declared = new Map();                  // local var → the params its event declares
    for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*parseAbiItem\(\s*'event \w+\(([^']*)\)'\s*\)/g)) {
      const ps = m[2].trim() ? m[2].split(',').map((p) => p.trim().split(/\s+/).pop()) : [];
      declared.set(m[1], ps);
    }
    if (!declared.size) continue;
    const lines = src.split('\n').map((l) => (/^\s*(\/\/|\*)/.test(l) ? '' : l));
    let bound = null;
    for (let i = 0; i < lines.length; i++) {
      const e = /event:\s*(\w+)/.exec(lines[i]);
      if (e && declared.has(e[1])) bound = e[1];
      for (const m of lines[i].matchAll(/\b\w+\.args\.(\w+)/g)) {
        if (!bound) continue;                    // nothing named an event yet — not a decode we can bind
        argReads++;
        if (!declared.get(bound).includes(m[1]))
          argDrift.push(`${path.relative(SRC, f)}:${i + 1}  reads .args.${m[1]}, but ${bound} declares (${declared.get(bound).join(', ')})`);
      }
    }
  }
  assert(argReads >= 20,
    `the log-reader scan found only ${argReads} \`.args.\` read(s) — the extractor has stopped seeing `
    + 'them, so the reader half of this ledger is vacuous rather than clean');
  assert.equal(argDrift.length, 0,
    'a log mapper reads a field its own event does not declare. viem returns no such key rather than\n'
    + '      throwing, so the value is `undefined` and books as NaN — a stream that looks quiet, not broken:\n'
    + `   - ${argDrift.join('\n   - ')}`);
  console.log(`✓ all ${argReads} decoded-log field reads name a parameter their own event declares`);
}

// ═══ THE LOCK LEDGER — one pair of rows, one order, everywhere ═══════════════════════════════════
//
// The most productive deadlock class in this project, and the only one that has been fixed the same
// way four separate times: two code paths take the same two `FOR UPDATE` locks in opposite orders.
// `pvpDice` locked street_tax before den_volume where the rest of the den locked them the other way;
// `refundPot` iterated funders unsorted; `payFamilyYield` locked the pool before the gangs while
// `runBuyback` writes it after them; the poker tournament locked its row before `poker_state`. Each
// was found by a person noticing an asymmetry, and each fix stated the canonical order in a comment —
// which is exactly as durable as the next person reading that comment.
//
// The sweep that produced this ledger found ONE surviving pair on a tree that had already had nine
// red teams over it: `callOutChamp` locked boxing_title→fighters where `acceptCallout` locks
// fighters→title. Its comment argued that was safe, on a precondition — "any counter-path that would
// lock this fighter must first block on the held caller char" — that `acceptCallout`, a function the
// same comment NAMED as canonical, violates in its own explicit words. Both were right about
// themselves and wrong about each other, which is the shape a per-site comment cannot catch.
//
// TWO RULES, and the second exists because the first is blind to it. (1) No pair of tables may be
// locked in both orders by any two transactions. (2) No SINGLETON may be locked before a `characters`
// row — because every player action already holds its own character via withCharacter before it ever
// reaches a pot, that implicit lock makes characters→singleton the universal order, and rule (1)
// cannot see a lock the enclosing wrapper took.
//
// SPLITTING ON TRANSACTION BOUNDARIES IS WHAT MAKES IT USABLE. A function may open several
// independent transactions — the ring sweep has two, a route-registration function has dozens — and
// concatenating them invents pairs no single transaction ever holds together. Without the split this
// sweep reported two false positives out of three, and a mostly-wrong advisory is worse than none.
{
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
    }
  })(SRC);

  // the global pots and singletons a player path reaches while already holding its own character row
  const SINGLETON = /^(street_tax|den_volume|desk_inventory|chain_reserve|bond_reserve|family_yield_pool|vig_prize_pool|stake_pool|event_fund|dev_fund|world_npcs|poker_state|stakes_state|futurity_state|population_state|loan_house|convoy_insurance|megaprojects|boxing_title|rwa_dividend_pool|rwa_family_dividend_pool|community_revenue|exchange_pool)$/;

  // A pair may be waived only with a reason that is a PROPERTY of the pair — never "it's rare" or
  // "the retry catches it", which are true of every deadlock and would waive the whole ledger.
  const WAIVED = new Map([]);

  const order = new Map();          // "a|b" → Set(sites that lock a before b)
  let segments = 0, singletonSites = 0, sequences = 0;
  const singletonFirst = [];

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const marks = [];
    for (const m of src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) marks.push({ name: m[1], at: m.index });
    for (let i = 0; i < marks.length; i++) {
      const body = src.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : src.length);
      for (const part of body.split(/query\(\s*['"`]BEGIN/)) {
        const seg = part.split(/query\(\s*['"`](?:COMMIT|ROLLBACK)/)[0];
        const locks = [];
        for (const q of seg.matchAll(/FROM\s+([a-z_]+)[^'`"]*?FOR\s+UPDATE/gi)) locks.push(q[1].toLowerCase());
        if (!locks.length) continue;
        segments++;
        singletonSites += locks.filter((t) => SINGLETON.test(t)).length;
        const site = `${path.relative(SRC, f)}:${marks[i].name}`;
        // rule 2 — a pot taken before a character row, inside one transaction
        const firstChar = locks.indexOf('characters');
        if (firstChar > 0) {
          const early = [...new Set(locks.slice(0, firstChar).filter((t) => SINGLETON.test(t)))];
          if (early.length) singletonFirst.push(`${site} — ${early.join(', ')} before characters (${locks.join(' → ')})`);
        }
        // rule 1 — every ordered pair this transaction establishes
        if (locks.length < 2) continue;
        sequences++;
        const seen = [];
        for (const t of locks) {
          for (const p of seen) if (p !== t) {
            const k = `${p}|${t}`;
            if (!order.has(k)) order.set(k, new Set());
            order.get(k).add(site);
          }
          seen.push(t);
        }
      }
    }
  }

  // ANTI-VACUITY. Both floors matter and they fail differently: the first catches an extractor that
  // has stopped seeing `FOR UPDATE` at all, the second catches a SINGLETON list that has drifted off
  // the real table names — which would make rule 2 pass over every pot in the game while looking
  // exactly as clean as it does when it holds.
  assert(sequences >= 40,
    `the lock scan found only ${sequences} transaction(s) holding two or more locks — the extractor has `
    + 'stopped reading them, so this ledger is vacuous rather than clean');
  assert(singletonSites >= 30,
    `the lock scan matched only ${singletonSites} singleton lock site(s) — the SINGLETON list has drifted `
    + 'off the real table names, so rule 2 is checking nothing');

  const conflicts = [];
  for (const k of order.keys()) {
    const [a, b] = k.split('|');
    if (a >= b) continue;                                  // report each pair once
    const rev = `${b}|${a}`;
    if (!order.has(rev)) continue;
    if (WAIVED.has(`${a}|${b}`)) continue;
    conflicts.push(`${a} ↔ ${b}\n       ${a} first: ${[...order.get(k)].join(', ')}`
      + `\n       ${b} first: ${[...order.get(rev)].join(', ')}`);
  }
  assert.equal(conflicts.length, 0,
    'two transactions take the same pair of locks in opposite orders — an AB-BA deadlock. Postgres\n'
    + '      catches it and `deadlockToRetry` maps it to a retryable `contention`, so it costs a retry\n'
    + '      rather than money; what it costs for certain is that the canonical order is no longer one\n'
    + '      thing anybody can state. Take the order rather than argue for it — read the second row\n'
    + '      unlocked, lock in the canonical order, then re-verify under the lock:\n'
    + `   - ${conflicts.join('\n   - ')}`);

  assert.equal(singletonFirst.length, 0,
    'a singleton pot is locked BEFORE a character row. Every player action already holds its own\n'
    + '      character via withCharacter before it reaches a pot, so this inverts against every one of\n'
    + '      them at once — and the wrapper\'s lock is invisible to the pairwise rule above:\n'
    + `   - ${singletonFirst.join('\n   - ')}`);

  console.log(`✓ all ${sequences} multi-lock transactions agree on one order for each of ${order.size} pairs`
    + `, and no singleton (${singletonSites} lock sites) is taken before a character row`);
}

// ═══ THE CONNECTION-SHARING LEDGER — one client cannot run two queries at once ═══════════════════
//
// Found by PLAYING (2026-08-18): the hustle card offered a CHECK IN that always refused, and adding
// the missing gate to `hustleBoard` surfaced a DeprecationWarning that traced straight into
// `dayBoard`'s `Promise.all` — five board readers issued CONCURRENTLY on ONE pooled client.
//
// node-pg cannot execute concurrent queries on a single connection. It queues them today behind
// `Calling client.query() when the client is already executing a query is deprecated`, and it
// THROWS from pg@9. So the parallel form is a false optimisation in both directions: it buys no
// speed (the one connection serializes them regardless) and it carries a latent hard break. It is
// also self-disguising — `career.js`'s own comment called it "one batched pass", which is precisely
// the belief that makes somebody write the next one.
//
// The fix is never "give each reader its own connection": these run inside a request's transaction,
// so a second connection reads outside its snapshot, and acquiring N per request is the
// pool-exhaustion shape this project has already been bitten by twice (`bankPosition`, `/v1/bank`).
// Sequential is correct AND identical in speed.
//
// Scope, stated honestly: this matches a `Promise.all` whose ELEMENTS mention an identifier the
// enclosing function takes as a pg client. A viem client (`watcher.js`'s `getLogs` batch) is
// genuinely concurrent and is not matched — it is not a pg connection. A `pool` is not matched
// either: `pool.query()` acquires its own connection per call, so that form is safe by design.
{
  // catalogue-or-declare: a `client` that is NOT a pg connection. viem batches real network reads
  // concurrently and is the whole point of a Promise.all there, so each is waived BY SITE with the
  // reason — a new one has to be classified rather than silently inheriting the exemption.
  // Keyed on FILE + a CONTENT mark inside the call's own argument, never a line number: the first
  // cut waived `src/chain.js:1533`, and a two-line COMMENT added 1,200 lines above it shifted the
  // site to :1535 and failed the build on an edit that changed nothing — a line-keyed waiver rots
  // on any edit above it (the preflight-restatement class, in a guard). Every waiver must MATCH
  // (the stale-waiver assert below), so a mark that stops matching fails loudly instead of leaving
  // a real pg site quietly waived.
  const VIEM_CLIENTS = [
    { file: 'src/bank.js', mark: 'readContract', why: 'viem, reading the Alchemist market' },
    { file: 'src/watcher.js', mark: 'getLogs', why: 'viem, three fee-event streams over one range' },
    { file: 'src/chain.js', mark: "functionName: 'PERIOD'", why: "viem, the oracle's PERIOD + lastUpdate" },
    { file: 'src/chain.js', mark: "functionName: 'polBps'", why: "viem, OmertaBond's three immutable bps" },
    { file: 'src/chainparams.js', mark: 'readContract', why: 'viem, the control-room live-value sweep' },
  ];
  const waiverHits = new Map(VIEM_CLIENTS.map((w) => [`${w.file}#${w.mark}`, 0]));
  const offenders = [];
  let scanned = 0;
  // balanced-paren extraction, not a fixed window: a `.slice(+N)` runs past the call into the next
  // statement and reads as a finding, and a short one truncates the argument and reads as a pass.
  const argOf = (src, i) => {
    let d = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '(') d++;
      else if (src[j] === ')') { d--; if (!d) return src.slice(i + 1, j); }
    }
    return '';
  };
  for (const f of files) {
    // deliberately NOT comment-stripped: a string-aware stripper is its own trap here (backticks in
    // SQL comments, `https://` inside a literal — both have bitten this repo), and the pattern being
    // matched is a call, which prose does not contain.
    const src = fs.readFileSync(f, 'utf8');
    const re = /Promise\.all\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      scanned++;
      const arg = argOf(src, m.index + m[0].length - 1);
      const site = `${f.replace(/^.*\/src\//, 'src/')}:${src.slice(0, m.index).split('\n').length}`;
      // ANY mention of the identifier, not just `client.query(` or a literal `f(client, …)` argument.
      // The narrow forms were the first cut and they had THREE false negatives — `roster.js` hands
      // the client to a reader inside a `.map`, and `dynasty.js` calls a closure that captures it —
      // and a guard that misses the sites it exists for is worse than no guard.
      if (!/\bclient\b/.test(arg)) continue;
      const shortFile = f.replace(/^.*\/src\//, 'src/');
      const waiver = VIEM_CLIENTS.find((w) => w.file === shortFile && arg.includes(w.mark));
      if (waiver) { waiverHits.set(`${waiver.file}#${waiver.mark}`, waiverHits.get(`${waiver.file}#${waiver.mark}`) + 1); continue; }
      offenders.push(site);
    }
  }
  assert(scanned >= 8, `the Promise.all scan found only ${scanned} sites — the extractor has stopped `
    + 'reading src/, so a green run here would mean nothing');
  // a waiver that matches NOTHING is stale — either the site changed shape (re-classify it) or it
  // is gone (delete the waiver); leaving it standing is how a future pg site inherits the exemption
  for (const [key, hits] of waiverHits) assert(hits >= 1,
    `the viem waiver "${key}" matched no Promise.all site — stale: the site moved or changed shape; re-classify or delete it`);
  assert.deepEqual(offenders, [], 'a Promise.all issues CONCURRENT queries on a SHARED pg client. One '
    + 'connection cannot do that: node-pg queues them behind a deprecation warning today and THROWS '
    + 'from pg@9, and the parallel form buys no speed because the connection serializes them either '
    + 'way. Await them in sequence — do NOT hand each one its own connection (it would read outside '
    + `the request's transaction, and N connections per request is the pool-exhaustion shape):\n   - ${offenders.join('\n   - ')}`);
  console.log(`✓ no Promise.all shares one pg client across concurrent queries (${scanned} sites scanned)`);
}

// ═══ THE WIRE LEDGER — a notification a player cannot read is a notification they never got ═══════
//
// `feedText` renders the wire, and its fallback prints the TYPE NAME: an unmapped `extortion` (a
// money demand with a deadline, on the URGENT tier) rendered as the literal word "extortion", and
// `witpro` as "witpro". Ninety-eight types were dark. Worse than dark is WRONG: several types are
// emitted with TWO shapes — the `me` NOTIFY (what happened to YOU) and the `streets` shout (what the
// town hears) — and a template written for one renders the other as `undefined`. `busted {from}` is
// somebody springing you from lockup; against the streets template it read "undefined got hauled in",
// telling a freed player they had been arrested.
//
// Two rules, and the second exists because the first is blind to it:
//   1. every notify() type has a feedText entry (catalogue-or-declare);
//   2. a type emitted with two DIFFERENT key sets must BRANCH — one template cannot honestly render
//      two shapes, and the failure is silent.
// Scope: it proves an entry EXISTS and BRANCHES, not that the sentence is right. That still needs a
// person reading the wire — which is how these were found.
{
  const CLIENT = new URL('../public/index.html', import.meta.url).pathname;
  const html = fs.readFileSync(CLIENT, 'utf8');
  const start = html.indexOf('function feedText(');
  assert(start > 0, 'feedText not found in the client — this check cannot run');
  const body = html.slice(start, html.indexOf('\n  }', html.indexOf('    };', start)));
  const known = new Set([...body.matchAll(/^\s{6}([a-z_0-9]+):\s*\(\)/gm)].map((m) => m[1]));
  assert(known.size > 150, `feedText yielded only ${known.size} templates — the extractor has stopped `
    + 'reading the client, so a green run here would mean nothing');

  // every notify(client, <who>, '<type>', <payload>) in src/, with its payload key set
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d)) {
    const p2 = path.join(d, e);
    if (fs.statSync(p2).isDirectory()) walk(p2); else if (p2.endsWith('.js')) files.push(p2);
  } };
  walk(SRC);
  const keysOf = (lit) => {
    let depth = 0, cur = '', parts = [];
    for (const ch of lit.replace(/^\{/, '')) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts.map((p2) => (p2.match(/^\s*([a-zA-Z_$][\w$]*)\s*(?::|$)/) || [])[1]).filter(Boolean).sort();
  };
  const shapes = new Map();   // type -> Set of "k1,k2" key signatures (both channels)
  const personal = new Set();  // types that reach the `me` channel — these MUST have a template
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const scan = (re, mine) => {
      let m;
      while ((m = re.exec(src))) {
        sites++;
        if (mine) personal.add(m[1]);
        const raw = m[2].startsWith('{') ? m[2] : '{' + m[2];
        const sig = keysOf(raw).filter((k) => k !== 'type').join(',');
        if (!shapes.has(m[1])) shapes.set(m[1], new Set());
        shapes.get(m[1]).add(sig);
        re.lastIndex = m.index + m[0].indexOf(m[1]) + m[1].length;   // never run past a later call
      }
    };
    scan(/notify\(\s*[a-zA-Z_$][\w$]*\s*,[^,]+,\s*'([a-z_0-9]+)'\s*,\s*(\{[\s\S]{0,400})/g, true);
    scan(/bus\.emit\(\s*'streets'\s*,\s*\{\s*type:\s*'([a-z_0-9]+)'([\s\S]{0,300})/g, false);
  }
  assert(sites >= 200, `the emit scan found only ${sites} sites — the extractor has stopped reading `
    + 'src/, so a green run here would mean nothing');

  // Rule 1 is scoped to the `me` channel ON PURPOSE. The field-stitcher (`who + type + target`) is
  // the DESIGNED renderer for ambient street news and reads acceptably there ("Vella seized docks").
  // It does not for a notification ABOUT YOU, where there is no who/target to stitch and the player
  // is simply shown the type name — which is how "extortion", "witpro" and "flipped" shipped.
  const dark = [...personal].filter((t) => !known.has(t)).sort();
  assert.deepEqual(dark, [], 'notification type(s) sent to a PLAYER that the wire cannot render — '
    + 'they are shown the literal type name instead of a sentence about what happened to them:'
    + `\n   - ${dark.join('\n   - ')}`);

  // rule 2: two distinct shapes need a branching template
  const MULTI_WAIVED = {
    // one shape carries a superset of the other's keys and the template reads only the shared ones,
    // so both render the same true sentence.
    world_raid_fail: 'both shapes carry npc; the template reads nothing else',
    heist_blown: 'both shapes carry job; the template reads nothing else',
    belt_ducked: 'both shapes carry challenger; the template reads nothing else',
    market_sold: 'both shapes carry kind and net; the template reads nothing else',
    family_retaliation: 'both shapes carry family; the template reads nothing else',
    vendetta_settled: 'the template reads no field at all',
    npc_pact_signed: "the template already falls back (`d.npc || 'an outfit'`)",
  };
  const unbranched = [];
  for (const [t, sigs] of shapes) {
    if (sigs.size < 2 || MULTI_WAIVED[t]) continue;
    if (!known.has(t)) continue;   // no template → the stitcher handles it, which is its job
    const tpl = (body.match(new RegExp(`^\\s{6}${t}:\\s*\\(\\)[\\s\\S]*?(?=\\n\\s{6}[a-z_0-9]+:\\s*\\(\\)|\\n\\s{4}\\};)`, 'm')) || [''])[0];
    if (!tpl.includes('?')) unbranched.push(`${t} — ${[...sigs].map((s) => `{${s}}`).join(' vs ')}`);
  }
  assert.deepEqual(unbranched, [], 'type(s) emitted with two DIFFERENT payload shapes whose feedText '
    + 'template does not branch. One template cannot render both, and the loser renders `undefined` '
    + '(`busted {from}` — somebody springing you from lockup — read as "undefined got hauled in"). '
    + `Branch on a key unique to each shape, or waive with the reason both are the same sentence:\n   - ${unbranched.join('\n   - ')}`);
  console.log(`✓ all ${personal.size} personal notification types render a sentence, and every `
    + `multi-shape type branches (${sites} emit sites, ${shapes.size} types)`);
}

// ═══ THE MONEY LEDGER — a refusal is the most-read line in the game ═══════════════════════════════
// `describe()` shows `body.message` FIRST, so the server's own sentence is what a player reads every
// time they cannot afford something — the single most common refusal there is. 158 of them
// interpolated the raw number, so the retainer read "$150000" and signing a fighter "$25000": debug
// output in a game that formats money on every other surface, and at that many digits genuinely hard
// to tell an order of magnitude apart at a glance. Driven and read out of the real client before it
// was called a defect.
//
// The rule is narrow on purpose: inside a GameError MESSAGE, a `$` immediately followed by an
// interpolation is a figure the player reads, and it must go through `usd()` — the one helper, which
// mirrors the client's own `fmt` so the two surfaces cannot disagree about the same number. 158
// copies of a formatting rule is how they came to disagree in the first place (the jailed/penSafe
// collapse, at 69 copies of three predicates).
{
  const raw = [];
  let messages = 0;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/GameError\('[a-z_]+',\s*`([^`]*)`/g)) {
      messages++;
      for (const d of m[1].matchAll(/\$\$\{([^}]*)\}/g))
        raw.push(`${f}:${s.slice(0, m.index).split('\n').length} — $\${${d[1]}}`);
    }
  }
  // anti-vacuity: an extractor that has stopped seeing GameError messages reports zero problems and
  // reads exactly like a clean bill of health (the fourth time that shape has cost this project a
  // session). The tree carries hundreds; a handful means the reader broke, not that the code got tidy.
  assert(messages > 300, `THE MONEY LEDGER read only ${messages} GameError messages — the extractor is broken, `
    + 'not the tree. A scan that sees nothing passes for a clean sweep.');
  assert.deepEqual(raw, [], 'refusal message(s) interpolating a RAW money figure. A player reads this '
    + 'sentence — "$150000" is debug output, and at that many digits it is hard to tell from $1,500,000 '
    + `at a glance. Use \`usd(x)\` (one helper, mirroring the client's fmt) instead of \`$\${x}\`:
   - ${raw.join('\n   - ')}`);
  console.log(`✓ every money figure in all ${messages} refusal messages is formatted for a player`);
}

// ═══ THE ARTICLE LEDGER — a name that already carries its own article ═════════════════════════════
// Same corpus, same reason: a refusal is the most-read line in the game, and a player reads the whole
// sentence rather than the figure alone. `The ${cfg.name} runs …` reads "The The Semi runs $2,000,000"
// on the apex rig, "The The Deep Run needs a boat that makes 24+ knots" on the deepest lane, and the
// PUBLIC Discord wire said "The The Volkov Bratva was routed on the frontier". It is not one typo:
// 105 of this game's catalogs hold at least one rung whose name begins with "The", so any catalog
// that grows one tomorrow breaks every sentence that names it — which is why the rule is a guard
// rather than a sweep of the instances that happened to surface.
//
// Narrow on purpose. Only an interpolated `.name`/`.title` counts — a catalog NAME is the thing that
// can supply its own article. A district id, a track word ("The engine is as built as it gets"), a
// role id and a money figure all read as an article followed by an interpolation and are none of them
// names, so a rule wide enough to catch them would be a rule people route around. The fix is
// `art(x)` / `art(x, 'A')` — ONE helper mirroring the client's own, because a judgement call per site
// is how the wave-10 attempt (drop the article on speakeasy tiers) failed to generalise: most rungs
// do NOT begin with "The", and "Panel Van runs $40,000" reads clipped.
{
  const bad = [];
  let names = 0;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/GameError\('[a-z_]+',\s*`([^`]*)`/g)) {
      const line = () => s.slice(0, m.index).split('\n').length;
      // The corpus is the SENTENCES this rule governs — the ones already routed through the helper
      // PLUS the ones still hardcoding an article. Counting violations alone would floor at zero the
      // moment the tree is clean, so the anti-vacuity check below would be measuring nothing.
      for (const _ of m[1].matchAll(/\bart\(/g)) names++;
      for (const d of m[1].matchAll(/(^|[^\w])(the|a|an)\s+\$\{([^}]*)\}/gi)) {
        if (!/\.(name|title)\b/.test(d[3])) continue;           // not a catalog name — see above
        names++;
        bad.push(`${f}:${line()} — ${d[2]} $\{${d[3]}}`);
      }
    }
  }
  // anti-vacuity, and it fails differently from the money ledger's: that one catches an extractor
  // that has stopped seeing GameError at all, this one catches a NARROWING that has stopped seeing
  // interpolated names — after which every article in the tree passes and it reads as a clean sweep.
  assert(names > 20, `THE ARTICLE LEDGER found only ${names} article+name interpolations — the ` +
    'narrowing is broken, not the tree. A scan that matches nothing passes for a clean bill of health.');
  assert.deepEqual(bad, [], 'refusal message(s) hardcoding an article before a catalog NAME. 105 ' +
    'catalogs carry a rung that begins with "The", so this reads "The The Semi runs $2,000,000" the ' +
    'day that rung is the one refused. Use `art(x)` / `art(x, \'A\')`:\n   - ' + bad.join('\n   - '));
  console.log(`✓ all ${names} refusal messages naming a catalog rung let the NAME supply its own article`);
}

