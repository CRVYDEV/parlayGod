// Drive the core loop against a REAL Postgres and fail on anything pg-mem cannot see.
//
// WHY THIS EXISTS. All 48 suites run on pg-mem. That has caught a lot (the INT-arithmetic quirk, the
// correlated-subquery gap, the missing `random()`), but it is by construction blind to node-pg's own
// contract — and a real deploy runs node-pg. A tester reporting "Internal on every crime" is exactly
// the shape of a bug that reproduces on Postgres and nowhere else, and chasing it turned up a live
// one: `loadOwned` issued 16 overlapping queries on a single pooled client, which node-pg deprecates
// and removes in pg@9.
//
// So: boot the real server against real Postgres, walk the loop a player actually walks, and treat
// ANY pg deprecation warning as a failure. Exits non-zero so it drops into CI.
//
//   createdb omerta_check
//   DATABASE_URL=postgres://localhost/omerta_check JWT_SECRET=x MOD_KEY=y \
//     MARKET_SEED='<32 random chars>' SOCIAL_VERIFY_MODE=off node tools/pgcheck.js
import crypto from 'node:crypto';

if (!process.env.DATABASE_URL) {
  console.error('pgcheck needs DATABASE_URL pointed at a real (throwaway) Postgres — that is the whole point.');
  process.exit(2);
}

// a pg deprecation is a FAILURE here, not a log line: it means we are using the driver in a way the
// next major removes, and pg-mem will never tell us
const deprecations = [];
process.on('warning', (w) => { if (/pg|client\.query/i.test(w.message)) deprecations.push(w.message); });

const { buildServer } = await import('../src/server.js');
const app = await buildServer();
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'idempotency-key': crypto.randomUUID() },
    payload: body });
  let json = null; try { json = res.json(); } catch {}
  return { code: res.statusCode, body: json };
};

const errors = [];
const step = async (label, method, url, opts) => {
  const r = await call(method, url, opts);
  if (r.code >= 500) errors.push(`${label}: ${method} ${url} → ${r.code} ${JSON.stringify(r.body)}`);
  return r;
};

const { body: { token } } = await call('POST', '/v1/auth/guest');
await step('create', 'POST', '/v1/character', { token, body: { name: `PgCheck ${Date.now() % 100000}` } });

// the core loop, every approach — this is what a tester actually clicks
const rules = (await call('GET', '/v1/rules')).body;
for (const c of rules.crimes.filter((c) => c.lvl <= 1)) {
  for (const approach of [undefined, 'quiet', 'standard', 'loud'])
    await step('crime', 'POST', `/v1/crimes/${c.id}`, { token, body: approach ? { approach } : undefined });
}
// and every read a fresh player's client fires on load
for (const url of ['/v1/me', '/v1/streets', '/v1/city', '/v1/onboard', '/v1/casino', '/v1/law',
                   '/v1/wire', '/v1/boxing', '/v1/races', '/v1/port', '/v1/market', '/v1/loans',
                   '/v1/business', '/v1/skills', '/v1/underworld', '/v1/estate', '/v1/portfolio'])
  await step('read', 'GET', url, { token });
for (const [url, body] of [['/v1/train', { stat: 'muscle' }], ['/v1/bank/deposit', { amount: 10 }],
                           ['/v1/travel', { to: 'neon' }]])
  await step('write', 'POST', url, { token, body });

await app.close();
await new Promise((r) => setTimeout(r, 100)); // let any late warning land

if (errors.length) { console.error(`\n${errors.length} server error(s) on real Postgres:`); for (const e of errors) console.error('  ' + e); }
if (deprecations.length) {
  console.error(`\n${deprecations.length} node-pg deprecation(s) — these break on the next pg major and pg-mem cannot see them:`);
  for (const d of new Set(deprecations)) console.error('  ' + d);
  console.error('  Re-run with --trace-deprecation to get the call site.');
}
if (errors.length || deprecations.length) process.exit(1);
console.log('✅ pgcheck passed — the core loop runs clean on real Postgres, with no node-pg deprecations.');
process.exit(0);
