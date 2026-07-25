// Check a deploy's configuration WITHOUT booting the server: `npm run preflight`.
//
// Same checks buildServer() runs at startup, so a green run here means the server will boot. Meant to
// be run on the box with the real environment loaded — the point is that an operator can find out
// what is wrong from a readable list instead of a stack trace at 3am, and can check BEFORE cutting
// traffic over. Exits non-zero when anything would refuse the boot, so it drops into a deploy script.
import { preflight, isHardened, TEST_ONLY_ENV, REQUIRED_ENV, EXPLICIT_ENV } from '../src/preflight.js';

const { errors, warnings } = preflight();

console.log(`\nOMERTÀ preflight — ${isHardened()
  ? 'REAL DEPLOYMENT (NODE_ENV=production or DATABASE_URL set): every guard is active'
  : 'development (no NODE_ENV=production, no DATABASE_URL): guards are off and the convenient fallbacks apply'}\n`);

if (!isHardened()) {
  console.log('Nothing to check — a dev box is allowed the dev JWT secret, the public MARKET_SEED and');
  console.log('the test-only knobs. Set DATABASE_URL (or NODE_ENV=production) to check a real config.\n');
  process.exit(0);
}

for (const w of warnings) console.log(`  ⚠  ${w}`);
if (warnings.length) console.log('');
for (const e of errors) console.log(`  ✖  ${e}`);

if (!errors.length) {
  console.log('  ✔  configuration OK — this server will boot.\n');
  console.log(`Reminders for a live alpha:`);
  console.log(`  · required secrets set: ${Object.keys(REQUIRED_ENV).join(', ')}`);
  console.log(`  · ${Object.keys(EXPLICIT_ENV).map((k) => `${k}=${process.env[k]}`).join(', ')}`);
  console.log(`  · none of the ${TEST_ONLY_ENV.length} test-only roll/timer knobs are set`);
  console.log(`  · run the worker too (\`npm run worker\`) — accrual is lazy, but the sweeps, the`);
  console.log(`    nightly §10.4 drift check and the city's population all live there.\n`);
  process.exit(0);
}

console.log(`\n${errors.length} error(s) — this server will REFUSE to boot until they are fixed.\n`);
process.exit(1);
