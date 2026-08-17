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
