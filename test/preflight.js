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
  JWT_SECRET: 'a-real-secret-value',
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

// ── THE TWO FEE RAILS AGREE ─────────────────────────────────────────────────────────────────────
// Every fee is payable in ETH or in earned $OMR (PLEX), and pre-market the $OMR price is the STATIC
// floor — it ignores the ETH fee entirely. So raising one without the other silently makes the other
// rail the cheap way to buy an identity, which is the Sybil bound. The invariant is the implied
// RATE, and today both pairs imply 500 $OMR/ETH.
assert.deepEqual(preflight(GOOD).warnings.filter((w) => /rails disagree/.test(w)), [],
  'the shipped defaults agree — 5/0.01 and 50/0.10 both imply 500 $OMR/ETH');
assert(preflight({ ...GOOD, MINT_FEE_ETH: '0.025' }).warnings.some((w) => /rails disagree/.test(w)),
  'raising the ETH mint fee alone is caught — the $OMR rail would still sell an identity at the old price');
assert.deepEqual(
  preflight({ ...GOOD, MINT_FEE_ETH: '0.025', PLEX_MINT_OMR: '12.5' }).warnings.filter((w) => /rails disagree/.test(w)),
  [], 'moving both together is clean — the guard is about agreement, not about any particular price');
assert.deepEqual(preflight({ ...GOOD, MINT_FEE_ETH: '0.025', PLEX_MINT_OMR: '12' }).warnings.filter((w) => /rails disagree/.test(w)),
  [], 'and a rounded-off price is fine — the band is 5%, so nobody is nagged for picking 12 over 12.5');
// The guard restates vig.js's defaults (preflight cannot import it — vig imports game.js, the
// one-way rule). That restatement is only safe while something checks it, so: check it.
{
  const vig = await import('../src/vig.js');
  const src = fs.readFileSync('src/vig.js', 'utf8');
  const def = (k) => Number((src.match(new RegExp(`${k} \\|\\| ([0-9.]+)`)) || [])[1]);
  assert.equal(vig.PLEX_MINT_OMR, 5, "preflight's restated PLEX_MINT_OMR default still matches vig.js");
  assert.equal(vig.PLEX_RESPAWN_OMR, 50, "…and PLEX_RESPAWN_OMR");
  assert.equal(def('MINT_FEE_ETH'), 0.01, '…and MINT_FEE_ETH (module-private, so read from source)');
  assert.equal(def('RESPAWN_FEE_ETH'), 0.10, '…and RESPAWN_FEE_ETH');
}

console.log('✅ PREFLIGHT passed — every env var in src/ is classified (the drift that shipped the pacing knobs unguarded is now caught by a test), the required secrets and the public dev fallbacks fail closed, every test-only roll/timer knob refuses a production boot, and a dev-safe default that is wrong in production must be stated rather than inherited');
