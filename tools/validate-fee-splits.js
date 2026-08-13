// ── PATH A FEE-SPLIT VALIDATOR ────────────────────────────────────────────────────────────────────
// Loads the router with the levers in deploy/fee-splits.env and asserts they reproduce the
// founder-signed split in deploy/fee-splits.json — AND that every rules.tail.js load guard accepts
// the config (a bad sum throws at import, which this catches and reports).
//
// WHY A DEPLOY-TIME VALIDATOR, NOT A SUITE: this is go-live config, not runtime code. The community
// half of Path A is already regression-pinned in test/community.js (block "flip"); this proves the
// WHOLE waterfall — including the non-community reallocations (fee vig, store, bond) that have no
// byte-identity concern — reproduces the exported JSON exactly. Run it before every chain-deploy that
// touches the split; CHAIN-DEPLOY.md references it.
//
// Run:  node tools/validate-fee-splits.js
//
// The env is set BEFORE importing the router, because VIG_BPS / STORE.SPLIT_BPS / BONDS.* / SELL_TAX.*
// are module-load consts (COMMUNITY.* / TREASURY.* are per-call functions). So this is a fresh load.
import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envText = fs.readFileSync(path.join(ROOT, 'deploy/fee-splits.env'), 'utf8');
const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/fee-splits.json'), 'utf8'));

// Parse KEY=VALUE lines (skip comments/blanks), set them on the environment.
let set = 0;
for (const raw of envText.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  const val = line.slice(eq + 1).replace(/\s+#.*$/, '').trim(); // strip trailing inline comment
  process.env[key] = val;
  set++;
}
console.log(`loaded ${set} levers from deploy/fee-splits.env`);

let router, rules;
try {
  router = await import(path.join(ROOT, 'src/router.js'));
  rules = await import(path.join(ROOT, 'src/rules.js'));
} catch (e) {
  console.error('\n❌ A LOAD GUARD REJECTED THE CONFIG (a split does not sum) — fee-splits.env is invalid:');
  console.error('   ' + e.message);
  process.exit(1);
}

const wf = router.waterfall();
const bySource = Object.fromEntries(wf.map((s) => [s.id, s]));
let fails = 0;
const fail = (msg) => { console.error('  ❌ ' + msg); fails++; };
const ok = (msg) => console.log('  ✓ ' + msg);

for (const src of json.sources) {
  if (src.retired) continue;
  const got = bySource[src.id];
  if (!got) { fail(`source '${src.id}' is in the JSON but not the waterfall`); continue; }

  if (src.id === 'tax') {
    // The sell tax is declared as bps OF THE TAX in the JSON and normalized to bps-of-gross in the
    // router — the two normalizations can differ by ±1 bps in how they distribute the rounding dust
    // between community and the LP remainder. That is cosmetic; the REAL money split is the of-TRADE
    // sub-bps, so we assert THOSE exactly (they must sum to SELL_TAX.BPS).
    const { SELL_TAX, COMMUNITY } = rules;
    const real = { dev: SELL_TAX.DEV_BPS, rwa: SELL_TAX.RWA_BPS, community: COMMUNITY.TAX_BPS(), lp: SELL_TAX.LP_BPS };
    // JSON of-tax bps → of-trade bps for comparison (dest names: operations=dev, treasury=rwa, pol=lp)
    const map = { operations: 'dev', treasury: 'rwa', community: 'community', pol: 'lp' };
    const want = {};
    for (const s of src.splits) want[map[s.dest]] = Math.round(s.bps / 10000 * SELL_TAX.BPS);
    for (const k of ['dev', 'rwa', 'community', 'lp']) {
      if (real[k] === want[k]) ok(`tax ${k} = ${real[k]} bps of trade`);
      else fail(`tax ${k}: levers give ${real[k]} bps of trade, JSON wants ${want[k]}`);
    }
    const sum = real.dev + real.rwa + real.community + real.lp;
    if (sum === SELL_TAX.BPS) ok(`tax sub-bps sum to SELL_TAX.BPS ${SELL_TAX.BPS}`);
    else fail(`tax sub-bps sum to ${sum}, not SELL_TAX.BPS ${SELL_TAX.BPS}`);
    continue;
  }

  // Every other source: the waterfall's bps-of-gross must match the JSON exactly.
  const gotSplits = Object.fromEntries(got.splits.map((x) => [x.dest, x.bps]));
  const wantSplits = Object.fromEntries(src.splits.map((x) => [x.dest, x.bps]));
  const dests = new Set([...Object.keys(gotSplits), ...Object.keys(wantSplits)]);
  for (const d of dests) {
    const g = gotSplits[d] ?? 0, w = wantSplits[d] ?? 0;
    if (g === w) ok(`${src.id} ${d} = ${g} bps`);
    else fail(`${src.id} ${d}: waterfall gives ${g} bps, JSON wants ${w}`);
  }
}

// The waterfall's own per-source sum guard (declared totalBps) — a belt over the load guards.
for (const s of wf) {
  const sum = s.splits.reduce((a, x) => a + x.bps, 0);
  if (sum !== s.totalBps) fail(`source '${s.id}' splits sum to ${sum}, not ${s.totalBps}`);
}

if (fails) { console.error(`\n❌ ${fails} mismatch(es) — deploy/fee-splits.env does NOT reproduce fee-splits.json`); process.exit(1); }
console.log('\n✅ deploy/fee-splits.env reproduces deploy/fee-splits.json exactly, and every load guard accepts it.');
console.log('   Contract args to set in lockstep at deploy (see CHAIN-DEPLOY.md):');
console.log('     OmertaFees vigBps = 2500');
console.log('     OmertaBond polBps = 7500, devBps = 1500, rwaBps = 500  (vig = on-chain remainder 500)');
console.log('     OMR / OmertaHook setSellTax(dev=200, rwa=160, lp=remainder)  [community is a backend carve]');
