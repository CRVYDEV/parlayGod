// THE BASELINE — capture launch-night zero before anyone arrives, and re-read it each morning.
//
// Week two tells us nothing without week one: every "is retention working / where do players
// stall / did the economy move" question is a DELTA, and a delta needs a floor written down
// BEFORE the first player walks in. This snapshots every read-only founder instrument in one
// run and writes a timestamped JSON beside a human summary, so the morning-after read is
// `node tools/baseline.js` again + a diff, not archaeology.
//
// Usage:
//   MOD_KEY=<the real mod key> node tools/baseline.js https://www.omerta.fun
//   (second arg optional — defaults to production; writes ./baselines/baseline-<ts>.json)
//
// Read-only by construction: every route here is a GET and the script sends nothing else.
// It never prints the MOD_KEY back, and the snapshot file carries data only, no credentials.
const BASE = (process.argv[2] || 'https://www.omerta.fun').replace(/\/+$/, '');
const KEY = process.env.MOD_KEY;
if (!KEY) { console.error('MOD_KEY env is required (the x-mod-key credential). Nothing was fetched.'); process.exit(1); }

// The instruments, in the order a person reads them the morning after.
const READS = [
  ['health', '/health', false],                    // is the box up, is the worker beating
  ['overview', '/v1/mod/overview', true],          // players / economy / top boards
  ['funnel', '/v1/mod/funnel', true],              // onboarding + referral + career + screen reach
  ['coach', '/v1/mod/coach', true],                // where the coach has the base — the drop-off, named
  ['engagement', '/v1/mod/engagement', true],      // who did what, how recently
  ['invariants', '/v1/mod/invariants', true],      // §10.4 — must be drift-0 at the baseline too
  ['tokenhealth', '/v1/mod/tokenhealth', true],    // the five KPIs (mostly dormant pre-market: expected)
  ['integrations', '/v1/mod/integrations', true],  // which retention/funnel switches are LIVE
  ['online', '/v1/online', false],                 // live humans right now
];

const out = { capturedAt: new Date().toISOString(), base: BASE, reads: {} };
let failed = 0;
for (const [name, path, mod] of READS) {
  try {
    const r = await fetch(BASE + path, { headers: mod ? { 'x-mod-key': KEY } : {} });
    out.reads[name] = { code: r.status, body: r.ok ? await r.json() : await r.text().catch(() => null) };
    if (!r.ok) { failed++; console.error(`  ✗ ${name} → ${r.status}`); }
  } catch (e) {
    failed++; out.reads[name] = { error: String(e.message || e) };
    console.error(`  ✗ ${name} → ${e.message}`);
  }
}

// ── the summary a person actually reads ──────────────────────────────────────────────────────
const g = (n, p, d = undefined) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), out.reads[n]?.body) ?? d;
const lines = [];
lines.push(`BASELINE ${out.capturedAt} against ${BASE}`);
lines.push(`  health: ${g('health', 'ok', false) ? 'UP' : 'DOWN'} · worker beat ${g('health', 'worker.beatAgoSeconds', '?')}s ago${g('health', 'worker.stale') ? ' ⚠ STALE' : ''}`);
lines.push(`  players: accounts ${g('overview', 'players.accounts', '?')} · alive ${g('overview', 'players.alive', '?')} · active24h ${g('overview', 'players.active24h', '?')} · online now ${g('online', 'online', g('online', 'count', '?'))}`);
const inv = g('invariants', 'checks') || g('invariants', 'results');
if (Array.isArray(inv)) {
  const bad = inv.filter((c) => c && c.ok === false);
  lines.push(`  §10.4: ${bad.length === 0 ? `all ${inv.length} checks clean` : `⚠ ${bad.length} DRIFTING — ${bad.map((c) => c.name).join(', ')}`}`);
} else lines.push('  §10.4: (shape unrecognized — read the JSON)');
const integ = g('integrations', 'integrations');
if (Array.isArray(integ)) lines.push(`  switches: ${integ.map((i) => `${i.name || i.id}=${i.live ? 'LIVE' : 'off'}`).join(' · ')}`);
lines.push(`  reads that failed: ${failed}${failed ? ' ⚠ (a baseline with holes is a baseline — but note WHICH holes)' : ''}`);

const fs = await import('node:fs');
fs.mkdirSync('./baselines', { recursive: true });
const file = `./baselines/baseline-${out.capturedAt.replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(lines.join('\n'));
console.log(`\nwrote ${file}`);
process.exit(failed && !out.reads.health?.body?.ok ? 1 : 0);
