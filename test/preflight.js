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

// THE TWO-RAILS GUARD IS GONE, and its absence is the fix rather than a gap. It compared a fee's ETH
// price against its $OMR price, because a fee payable two ways is always priced by the cheaper rail
// and the two diverge silently when only one is moved. Every fee is ETH only now (founder-directed
// 2026-08-10), so there is no second rail to disagree — the surest way to keep two rails in lockstep
// turned out to be having one. What is asserted is that nothing brings it back by accident.
{
  const psrc = fs.readFileSync('src/preflight.js', 'utf8');
  assert(!/PLEX/.test(psrc), 'preflight reads no $OMR rail — every fee is ETH, so there is nothing to compare');
  const vig = await import('../src/vig.js');
  assert.equal(vig.PLEX_MINT_OMR, undefined,
    'PLEX_MINT_OMR is DELETED, not zeroed — a rail that merely sleeps is one env var from being live again');
  assert.equal(vig.PLEX_RESPAWN_OMR, undefined, '…and so is the respawn floor');
  assert.deepEqual(preflight(GOOD).warnings.filter((w) => /rails disagree/.test(w)), [],
    'and no rate warning can fire — the check it came from no longer exists');
}

// THE TRANCHE SCHEDULE (Shape D, five waves capped at 0.05): the mint FEE must sit ON a published
// wave, not merely agree on a rate — 0.015 is rate-clean and still a price the published table never
// promised. Distinct message from the rate check, so the two guards stay independently testable.
// The $OMR side needs no separate schedule check now that it DERIVES from the fee.
assert.deepEqual(preflight(GOOD).warnings.filter((w) => /OFF the published tranche/.test(w)), [],
  'the shipped default fee (0.01 ETH) is wave 1 — on schedule');
assert.deepEqual(preflight({ ...GOOD, MINT_FEE_ETH: '0.025' }).warnings.filter((w) => /OFF the published tranche/.test(w)), [],
  'wave 2 (0.025 ETH) is on schedule — a boundary execution is clean');
assert(preflight({ ...GOOD, MINT_FEE_ETH: '0.015' }).warnings.some((w) => /OFF the published tranche/.test(w)),
  'a fee the table never promised (0.015 ETH) is caught — the schedule is a commitment, not a ratio');
// The check RESTATES the five waves. Pin the restatement to the real table so it cannot rot (the
// vig-defaults discipline, applied to the new guard).
{
  const { MINT_TRANCHES } = await import('../src/rules.js');
  assert.deepEqual(MINT_TRANCHES.map((t) => t.eth), [0.01, 0.025, 0.035, 0.045, 0.05],
    "the preflight schedule check's restated waves still match MINT_TRANCHES");
  assert(MINT_TRANCHES.every((t) => t.omr === undefined),
    '…and no row carries a $OMR price — the mint is ETH only, so there is one rail to check');
}
// The tranche check RESTATES the five waves (preflight cannot import rules.js — the one-way rule).
// That restatement is only safe while something checks it, so: check it. And pin the two ETH fee
// defaults it reads, which are module-private in vig.js.
{
  const vig = await import('../src/vig.js');
  const src = fs.readFileSync('src/vig.js', 'utf8');
  const def = (k) => Number((src.match(new RegExp(`${k} \\|\\| ([0-9.]+)`)) || [])[1]);
  assert.equal(def('MINT_FEE_ETH'), 0.01, 'MINT_FEE_ETH (module-private, so read from source)');
  assert.equal(def('RESPAWN_FEE_ETH'), 0.10, '…and RESPAWN_FEE_ETH');
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
