// PREFLIGHT test (the 48th suite) — the deploy perimeter.
//
// The point of this file is the FIRST assertion: every `process.env.X` read anywhere in src/ must be
// classified in src/preflight.js. That is the durable fix for the thing this pass was written to
// find — the guards were fine, but the LIST of test-only knobs was a literal that drops kept
// forgetting to update. The pacing pass shipped TRAIN_CD_MS and MISSION_CD_MS (the two knobs that
// collapse the timers that stopped "level 240 in two hours") and neither was guarded; SOV_SIEGE_P,
// SOV_WINDOW_OPEN, SOLDIER_DEATH_P, BUSINESS_TAKEOVER_P, PEN_SHANK_CD_MS and SOCIAL_MATURE_MS had
// the same gap. Now a new knob cannot be forgotten — only classified.
//
// This is the test/migrate.js DISPOSITION guard applied to config instead of tables.
import assert from 'node:assert';
import fs from 'node:fs';
import { preflight, isHardened, CLASSIFIED, TEST_ONLY_ENV, REQUIRED_ENV, EXPLICIT_ENV } from '../src/preflight.js';
import { walkSrc } from './lib/srcfiles.js';

// ════════════ THE DRIFT DETECTOR ════════════
const used = new Set();
// preflight.js is the classifier, not a consumer — it only ever reads the `env` object it is
// handed, and its prose mentions `process.env.X` generically, which the scanner would take literally
// Walked RECURSIVELY via the shared helper — a flat listing of src/ stops seeing a file the moment
// it moves into a subdirectory, which is the exact drift this detector exists to catch.
for (const f of walkSrc('src', { exclude: ['src/preflight.js'] }))
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z_0-9]+)/g)) used.add(m[1]);

const unclassified = [...used].filter((v) => !CLASSIFIED.has(v)).sort();
assert.deepEqual(unclassified, [],
  `unclassified environment variable(s): ${unclassified.join(', ')}. Add each to src/preflight.js — ` +
  'TEST_ONLY_ENV if it pins a roll or collapses a timer (it will then refuse to boot in production), ' +
  'REQUIRED_ENV / EXPLICIT_ENV if a live server needs it, else OPERATIONAL_ENV. This guard exists ' +
  'because the pacing-pass knobs shipped unguarded — a knob must not be able to reach production by ' +
  'being forgotten.');

// and the reverse: a classification for a variable nobody reads is dead weight that reads as coverage
const stale = [...CLASSIFIED].filter((v) => !used.has(v)).sort();
assert.deepEqual(stale, [], `classified but never read in src/ — stale entries: ${stale.join(', ')}`);

// the specific regression: the pacing knobs ARE guarded now
for (const k of ['TRAIN_CD_MS', 'MISSION_CD_MS'])
  assert(TEST_ONLY_ENV.includes(k), `${k} collapses a pacing timer — it must be blocked in production`);

// ════════════ DEV IS UNTOUCHED ════════════
// pg-mem/CI sets neither NODE_ENV nor DATABASE_URL, so nothing below may fire there.
assert.equal(isHardened({}), false, 'a bare dev environment is not "hardened"');
assert.deepEqual(preflight({}), { errors: [], warnings: [] }, 'dev keeps every convenient fallback');
assert.equal(isHardened({ DATABASE_URL: 'postgres://x' }), true,
  'a real Postgres hardens the server even without NODE_ENV — `npm start` never sets it');

// ════════════ PRODUCTION ════════════
const GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-real-jwt-secret-value-long-enough',   // ≥24 chars, ≥8 distinct (blue-team H1 floor)
  MARKET_SEED: 'YqB7#tR2vLx9Kp4Wm6Zn8Cf3Hj5Ds1Ge',
  MOD_KEY: 'another-real-secret-value-here',
  SOCIAL_VERIFY_MODE: 'live',
  TRUST_PROXY: 'on',
};
assert.deepEqual(preflight(GOOD).errors, [], 'a correctly configured production server boots clean');

// required secrets fail CLOSED
for (const key of Object.keys(REQUIRED_ENV)) {
  const { [key]: _drop, ...missing } = GOOD;
  assert(preflight(missing).errors.some((e) => e.startsWith(`${key} must be set`)),
    `${key} missing must refuse the boot`);
}

// the dev fallbacks are worse than absent — they LOOK configured
assert(preflight({ ...GOOD, JWT_SECRET: 'dev-secret-change-me' }).errors.some((e) => /forge a token/.test(e)),
  'the public dev JWT secret is refused');
assert(preflight({ ...GOOD, MARKET_SEED: 'omerta-server-seed' }).errors.some((e) => /predictable/.test(e)),
  'the public default MARKET_SEED is refused');
assert(preflight({ ...GOOD, MARKET_SEED: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' }).errors.some((e) => /too weak/.test(e)),
  'a long but low-entropy seed is refused — it is offline-recoverable from the public prices board');
assert(preflight({ ...GOOD, MARKET_SEED: 'short' }).errors.some((e) => /too weak/.test(e)),
  'a short seed is refused');

// BLUE-TEAM H1: the same floor on JWT_SECRET — the ONE secret that authenticates every session and
// had no entropy check. HS256 over a weak-but-non-default secret is offline-forgeable → any account.
assert(preflight({ ...GOOD, JWT_SECRET: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' }).errors.some((e) => /JWT_SECRET is too weak/.test(e)),
  'a long but low-entropy JWT secret is refused — HS256 over it is offline-forgeable (H1)');
assert(preflight({ ...GOOD, JWT_SECRET: 'short' }).errors.some((e) => /JWT_SECRET is too weak/.test(e)),
  'a short JWT secret is refused (H1)');

// BLUE-TEAM H5: the money-drift alarm channel, unset, is called out (not fatal — it must never take a
// live server down, matching SOCIAL_VERIFY_MODE); set, it is silent.
assert(preflight(GOOD).warnings.some((w) => /INVARIANT_WEBHOOK_URL is not set/.test(w)),
  'an unset money-drift alarm channel is called out (H5)');
assert.deepEqual(
  preflight({ ...GOOD, INVARIANT_WEBHOOK_URL: 'https://hook' }).warnings.filter((w) => /INVARIANT_WEBHOOK_URL is not set/.test(w)),
  [], '…and once set, the webhook warning is silent (H5)');

// BLUE-TEAM M8: the private ops alarm and the public city-wire must be DISTINCT channels, or drama
// buries a drift line. Fatal only on the exact misconfiguration (both set AND equal).
assert(preflight({ ...GOOD, INVARIANT_WEBHOOK_URL: 'https://h', CITY_WIRE_WEBHOOK_URL: 'https://h' }).errors.some((e) => /same channel/i.test(e)),
  'the ops alarm and the public city-wire pointing at one channel is refused (M8)');
assert.deepEqual(
  preflight({ ...GOOD, INVARIANT_WEBHOOK_URL: 'https://a', CITY_WIRE_WEBHOOK_URL: 'https://b' }).errors.filter((e) => /same channel/i.test(e)),
  [], '…distinct channels boot clean (M8)');

// EVERY test-only knob individually refuses the boot
for (const knob of TEST_ONLY_ENV) {
  const errs = preflight({ ...GOOD, [knob]: '1' }).errors;
  assert(errs.some((e) => e.includes(knob)), `${knob} must refuse the boot in production`);
}
// including the two that would reinstate the speedrun
const speedrun = preflight({ ...GOOD, TRAIN_CD_MS: '0', MISSION_CD_MS: '0' }).errors.join(' ');
assert(/TRAIN_CD_MS/.test(speedrun) && /MISSION_CD_MS/.test(speedrun),
  'the pacing knobs are named in the refusal, together');

// the silent-failure class: a default that is right for dev and wrong for production must be STATED
const [explicitKey, explicitSpec] = Object.entries(EXPLICIT_ENV)[0];
const { [explicitKey]: _omit, ...unstated } = GOOD;
assert(preflight(unstated).errors.some((e) => e.includes(`${explicitKey} must be set explicitly`)),
  `${explicitKey} must be stated in production — this is the class that let Spread-the-Word pay nobody on a live server`);
assert(preflight({ ...GOOD, SOCIAL_VERIFY_MODE: 'nonsense' }).errors.some((e) => /is not valid/.test(e)),
  'an invalid value is refused, not silently treated as off');
assert.deepEqual(preflight({ ...GOOD, SOCIAL_VERIFY_MODE: 'off' }).errors, [],
  "…but 'off' stays a legitimate CHOICE — the requirement is that a human made it");

// warnings inform without blocking
const warn = preflight({ ...GOOD, SOCIAL_VERIFY_MODE: 'trust', WS_ALLOW_QUERY_TOKEN: 'on', MOD_KEY: 'short' });
assert.deepEqual(warn.errors, [], 'warnings never block a boot');
assert(warn.warnings.some((w) => /trust/.test(w)), 'trust mode is called out');
assert(warn.warnings.some((w) => /URLs/.test(w)), 'tokens-in-URLs is called out');
assert(warn.warnings.some((w) => /MOD_KEY is short/.test(w)), 'a weak mod key is called out');
assert(preflight({ ...GOOD, TRUST_PROXY: undefined }).warnings.some((w) => /shared bucket/.test(w)),
  'the collapsed per-IP throttle behind a proxy is called out');

// THE TWO-RAILS GUARD, and the asymmetry that IS the rule. A fee payable two ways is always priced
// by the CHEAPER rail, so two rails must agree or the cheap one simply is the price. The MINT has
// ONE rail (it is the Sybil bound and the extraction gate) — so `PLEX_MINT_OMR` must not exist at
// all, DELETED rather than zeroed, because a rail that merely sleeps is one env var from live. The
// RESPAWN is a repeatable consumable, so it keeps its $OMR rail — and therefore keeps the guard,
// because its price is env-settable and can silently drift off the ETH fee it is meant to mirror.
{
  const vig = await import('../src/vig.js');
  assert.equal(vig.PLEX_MINT_OMR, undefined,
    'PLEX_MINT_OMR is DELETED, not zeroed — a rail that merely sleeps is one env var from being live again');
  assert(!/PLEX_MINT_OMR/.test(fs.readFileSync('src/preflight.js', 'utf8')),
    '…and preflight has nothing to compare for the mint, because the mint has no second rail');
  assert(typeof vig.PLEX_RESPAWN_OMR === 'number' && vig.PLEX_RESPAWN_OMR > 0,
    'the respawn DOES have a $OMR rail — a consumable is not the bound, so "pay your rent in ISK" applies');

  // NOT the bare-defaults case: preflight derives its own expected $OMR price from its own restated
  // rate, so with nothing set it agrees with itself whatever the rate is — silent, and vacuous as a
  // rot check. The rot check is feeding it vig.js's REAL default and requiring silence, which is the
  // only comparison that crosses the restatement. Premium-agnostic on purpose: the literal 1.2 that
  // used to sit here would have made moving the lever fail this test for no reason.
  assert.deepEqual(preflight({ ...GOOD, PLEX_RESPAWN_OMR: String(vig.PLEX_RESPAWN_OMR) })
    .warnings.filter((w) => /rails disagree/.test(w)), [],
    "preflight's restated genesis rate must equal vig.js's, or the guard checks a price nobody charges");
  // Raising ONE rail is exactly the divergence this exists to catch.
  assert(preflight({ ...GOOD, RESPAWN_FEE_ETH: '0.30' }).warnings.some((w) => /rails disagree/.test(w)),
    'raise the ETH fee alone and the $OMR rail becomes the cheap price — that must be called out');
  // 0.30 is 3× the shipped fee, so 3× the shipped $OMR price is the SAME ratio — stated as a multiple
  // rather than recomputed, so it holds at any premium and any genesis rate.
  assert.deepEqual(preflight({ ...GOOD, RESPAWN_FEE_ETH: '0.30', PLEX_RESPAWN_OMR: String(vig.PLEX_RESPAWN_OMR * 3) })
    .warnings.filter((w) => /rails disagree/.test(w)), [],
    '…and moving both together is silent, so the guard checks the RATIO rather than a fixed price');
}

// THE TRANCHE SCHEDULE (Shape D, five waves capped at 0.05): the mint FEE must sit ON a published
// wave, not merely agree on a rate — 0.015 is rate-clean and still a price the published table never
// promised. Distinct message from the rate check, so the two guards stay independently testable.
// The $OMR side needs no separate schedule check now that it DERIVES from the fee.
// Driven off the REAL table rather than three literal fees: a literal probe fails when the SCHEDULE
// changes as well as when the guard breaks, which makes it a brittle test rather than a guard — and
// it would then be demanding a table the founder has deliberately replaced.
{
  const { MINT_TRANCHES } = await import('../src/rules.js');
  const waves = MINT_TRANCHES.map((t) => t.eth);
  for (const w of waves)
    assert.deepEqual(preflight({ ...GOOD, MINT_FEE_ETH: String(w) }).warnings.filter((x) => /OFF the published tranche/.test(x)), [],
      `${w} ETH is a published wave — a boundary execution must be clean`);
  const off = (waves[0] + waves[1]) / 2; // between two waves, so on neither
  assert(!waves.some((w) => Math.abs(w - off) < 1e-9), 'the off-schedule probe must genuinely be off schedule');
  assert(preflight({ ...GOOD, MINT_FEE_ETH: String(off) }).warnings.some((w) => /OFF the published tranche/.test(w)),
    'a fee the table never promised is caught — the schedule is a commitment, not a ratio');
}
// ── THE RESTATEMENT LEDGER ──────────────────────────────────────────────────────────────────────
// preflight cannot import rules.js or vig.js (the one-way rule), so every default it names is a
// COPY — and a copy is only safe while something compares it to the ORIGINAL.
//
// What used to sit here did not. It asserted `MINT_TRANCHES.map(t=>t.eth) === [0.01, …]` and
// `BONDS.DISCOUNT_BPS === 800`: the SOURCE against a literal in this file. That detects a lever
// MOVING — which is levers.js's job and it already does it — and cannot detect the COPY going
// stale, which is the only reason these pins exist. Edit preflight's own `?? 800` and every one of
// them passed.
//
// So: extract each literal from preflight's OWN source and cross it against the value it stands in
// for. This is the check that would have caught PLEX_PREMIUM_BPS being baked in at 1.2, where the
// symptom was the guard firing on a legitimate lever move and the reflex fix was to widen it.
{
  const { MINT_TRANCHES, BONDS, SELL_TAX, STORE, PLEX_GENESIS_OMR_PER_ETH } = await import('../src/rules.js');
  const vig = await import('../src/vig.js');
  const pre = fs.readFileSync('src/preflight.js', 'utf8');
  const vsrc = fs.readFileSync('src/vig.js', 'utf8');
  // preflight's restated default for an env var, read out of its source.
  const restated = (k) => Number((pre.match(new RegExp(`env\\.${k} \\?\\? ([0-9.]+)`)) || [])[1]);
  // vig.js keeps several of these module-private, so its own defaults come from source too.
  const vigDef = (k) => Number((vsrc.match(new RegExp(`${k} \\|\\| ([0-9.]+)`)) || [])[1]);

  const LEDGER = [
    ['PLEX_PREMIUM_BPS', () => vigDef('PLEX_PREMIUM_BPS'), 'the premium is the deliberate wedge the rails guard measures against, so baking it in makes a lever move look like a fault'],
    ['PLEX_GENESIS_OMR_PER_ETH', () => PLEX_GENESIS_OMR_PER_ETH, 'the one conversion every $OMR rail uses pre-market'],
    ['RESPAWN_FEE_ETH', () => vigDef('RESPAWN_FEE_ETH'), 'the ETH side of the pair the rails guard compares'],
    ['MINT_FEE_ETH', () => MINT_TRANCHES[0].eth, 'the founding wave — the live fee is checked against the schedule, so the default must BE a wave'],
    ['BOND_DISCOUNT_BPS', () => BONDS.DISCOUNT_BPS, 'half of the relation that keeps a bond a hold rather than a subsidy on selling'],
    ['SELL_TAX_BPS', () => SELL_TAX.BPS, '…and the other half'],
  ];
  for (const [k, real, why] of LEDGER) {
    const copy = restated(k);
    assert(Number.isFinite(copy), `preflight no longer restates ${k} in the \`env.${k} ?? N\` shape the ledger reads — re-point the extraction or drop the row`);
    assert.equal(copy, real(), `preflight's restated ${k} default (${copy}) has drifted from the real ${real()} — ${why}`);
  }

  // COMPLETENESS: a restatement added later must be pinned or waived WITH a reason, or this ledger
  // silently stops covering the file it is about (the catalog-or-declare discipline).
  const WAIVED = {
    // Derived from two rows already in the ledger, so it cannot drift independently of them.
    PLEX_RESPAWN_OMR: 'computed from the genesis rate and the ETH fee above, not restated',
  };
  const found = [...pre.matchAll(/env\.([A-Z_]+) \?\? /g)].map((m) => m[1]);
  const unpinned = [...new Set(found)].filter((k) => !LEDGER.some(([n]) => n === k) && !WAIVED[k]);
  assert.deepEqual(unpinned, [],
    `preflight restates ${unpinned.join(', ')} with nothing checking the copy against the original. `
    + 'Add a ledger row, or waive it with the reason it cannot drift.');

  // The WAVES array is a restatement too, and an array needs its own comparison.
  const waves = JSON.parse((pre.match(/const WAVES = (\[[^\]]*\])/) || [])[1] || 'null');
  assert.deepEqual(waves, MINT_TRANCHES.map((t) => t.eth),
    "preflight's restated tranche waves have drifted from MINT_TRANCHES — the guard would then warn on a "
    + 'legitimate wave, and the reflex fix for a guard that cries wolf is to delete it');
  assert(MINT_TRANCHES.every((t) => t.omr === undefined),
    '…and no row carries a $OMR price — the mint is ETH only, so there is one rail to check');

  // The two premiums price the same thing on two surfaces, so a split between them is a price
  // difference nobody decided on. Asserted rather than merely commented.
  assert.equal(vigDef('PLEX_PREMIUM_BPS'), STORE.PLEX_PREMIUM_BPS,
    'the respawn and Store PLEX premiums must move in lockstep');
  assert.equal(typeof vig.payPlex, 'function', 'the payer is still exported — as a tombstone that refuses');
}

// ── A BOND MUST STAY A HOLD, NOT AN ARBITRAGE ───────────────────────────────────────────────────
// The bond discount and the DEX sell tax are set independently, in different layers, and their
// RELATION is what makes a bond capital formation instead of a subsidy on selling: at 800 vs 900 an
// immediate flip returns 1.08 x 0.91 = 0.983 and loses money. A bonder holds known size on a known
// schedule, so if that inverts they are the most motivated bypass-seeker on the chain.
assert.deepEqual(preflight(GOOD).warnings.filter((w) => /subsidy on selling/.test(w)), [],
  'the shipped 800 / 900 is a losing flip, so a bond is a hold');
assert(preflight({ ...GOOD, SELL_TAX_BPS: '700', SELL_TAX_DEV_BPS: '200', SELL_TAX_RWA_BPS: '300', SELL_TAX_LP_BPS: '200' })
  .warnings.some((w) => /subsidy on selling/.test(w)),
  'lowering the sell tax under the discount is caught — the relation is the invariant, not either number');
assert(preflight({ ...GOOD, BOND_DISCOUNT_BPS: '900' }).warnings.some((w) => /subsidy on selling/.test(w)),
  'and equality is not good enough — a break-even flip still has the vest as a free option');
{
  const { BONDS, SELL_TAX } = await import('../src/rules.js');
  assert.equal(BONDS.DISCOUNT_BPS, 800, "preflight's restated BOND_DISCOUNT_BPS default still matches the rules tail");
  assert.equal(SELL_TAX.BPS, 900, '…and SELL_TAX.BPS');
}

console.log('✅ PREFLIGHT passed — every env var in src/ is classified (the drift that shipped the pacing knobs unguarded is now caught by a test), the required secrets and the public dev fallbacks fail closed, every test-only roll/timer knob refuses a production boot, and a dev-safe default that is wrong in production must be stated rather than inherited');
