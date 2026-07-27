// ENGAGEMENT + RETENTION test (the 55th suite) — guards src/engagement.js.
//
// The thing that would quietly break this report is catalog drift: someone adds a system, its
// `track()` events are not in SYSTEMS, and the dashboard reports the new system as DEAD forever
// while its events pile up unread. That is worse than no report, because "nobody uses this" is a
// claim the founder would act on. So the first and most important assertion here is TOTAL COVERAGE
// of every track() event name in src/ — the KNOWN_REASONS discipline.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { opsEngagement, SYSTEMS, NON_ENGAGEMENT } from '../src/engagement.js';

// ── (1) the catalog covers src/, exactly ────────────────────────────────────────────────────────
// Read the real track() call sites rather than a hand-list, so this cannot drift from the code.
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else if (f.endsWith('.js')) out.push(f);
  }
  return out;
};
const emitted = new Set();
for (const f of walk('src')) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/track\([^,]+,[^,]+,\s*'([a-z_]+)'/g)) emitted.add(m[1]);
}
assert(emitted.size >= 130, `expected 130+ distinct track() events in src/, found ${emitted.size} — the reader regex broke`);

const claimed = new Map();
for (const [sys, evs] of Object.entries(SYSTEMS)) {
  for (const e of evs) {
    assert(!claimed.has(e), `event '${e}' is claimed by two systems: ${claimed.get(e)} and ${sys}`);
    claimed.set(e, sys);
  }
}
for (const e of NON_ENGAGEMENT) {
  assert(!claimed.has(e), `'${e}' is both a system event and declared non-engagement`);
  claimed.set(e, '(non-engagement)');
}

const unclaimed = [...emitted].filter((e) => !claimed.has(e)).sort();
assert.equal(unclaimed.length, 0,
  `${unclaimed.length} telemetry events are emitted by src/ but claimed by no system, so they would be `
  + `invisible in the engagement report and their systems would read as DEAD: ${unclaimed.join(', ')}\n`
  + '  → add each to SYSTEMS in src/engagement.js, or to NON_ENGAGEMENT if it is not player engagement.');

const phantom = [...claimed.keys()].filter((e) => !emitted.has(e)).sort();
assert.equal(phantom.length, 0,
  `${phantom.length} catalogued events are emitted nowhere in src/ — a rename left the catalog `
  + `pointing at nothing, so that system will read as dead forever: ${phantom.join(', ')}`);
console.log(`✓ catalog: all ${emitted.size} track() events in src/ are claimed by exactly one of `
  + `${Object.keys(SYSTEMS).length} systems (or declared non-engagement); no phantoms`);

// ── (2) the report reads a real database ────────────────────────────────────────────────────────
const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, mod } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (mod) headers['x-mod-key'] = 'test-mod-key';
  const res = await app.inject({ method, url, headers });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await app.inject({ method: 'POST', url: '/v1/character', headers: { authorization: `Bearer ${token}` }, payload: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  // /v1/me deliberately does not expose the account id, so read it off the character row. A first
  // cut used `me.accountId` (undefined), the UPDATE below matched nothing, and the retention
  // assertion failed against a fixture that had never actually aged anything.
  const acct = (await pool.query('SELECT account_id FROM characters WHERE id=$1', [me.id])).rows[0].account_id;
  return { token, id: me.id, account: acct };
};

const a = await mk('Engage Ann');
const b = await mk('Engage Bob');
// A real action, through the public API, so the event is written the way the game writes it.
await call('POST', '/v1/crimes/pick', { token: a.token });
await app.inject({ method: 'POST', url: '/v1/crimes/pick', headers: { authorization: `Bearer ${a.token}` } });

let r = await opsEngagement(pool, 14);
assert(r.players.humans >= 2, `both guests counted as humans, got ${r.players.humans}`);
const streets = r.systems.find((s) => s.system === 'streets / crime');
assert(streets.accounts >= 1, 'the crime a player actually pulled shows up under streets / crime');
assert(streets.events >= 1, 'and its events are counted');
assert.equal(r.uncatalogued.length, 0, `uncatalogued events present: ${JSON.stringify(r.uncatalogued)}`);
console.log(`✓ live read: ${r.players.humans} humans, streets/crime shows ${streets.accounts} account(s) / ${streets.events} event(s)`);

// ── (3) THE DEAD LIST — the whole point ─────────────────────────────────────────────────────────
// Nobody in this fixture has opened boxing, so it must appear as dead. If the dead list were empty
// here the report would be incapable of ever telling the founder a system is unused.
assert(r.dead.includes('boxing'), 'a system nobody touched must appear on the dead list');
assert(!r.dead.includes('streets / crime'), 'a system someone used must NOT appear on the dead list');
assert(r.dead.length > 20, `most systems are untouched in this fixture; dead list has only ${r.dead.length}`);
// A system with no declared events is untracked, not dead — the two must not be conflated, or an
// instrumentation gap gets reported to the founder as a player verdict.
assert(r.untracked.includes('the black market'), 'a system with no telemetry is reported untracked, not dead');
assert(!r.dead.includes('the black market'), 'and is kept off the dead list');
console.log(`✓ dead list: ${r.dead.length} systems with zero distinct players; ${r.untracked.length} untracked (no events declared)`);

// ── (4) distinct-humans, not event volume ───────────────────────────────────────────────────────
// One player hammering a system is not adoption. Ann pulled two crimes; the system must show one
// account, not two.
assert.equal(streets.accounts, 1, `one player pulling two jobs is ONE adopting account, got ${streets.accounts}`);
assert(streets.events >= 2, 'while the event count reflects both actions');
console.log('✓ adoption is distinct accounts, not event volume');

// ── (5) retention cohorts are honest about young accounts ───────────────────────────────────────
// Both accounts were created seconds ago, so the D1 and D7 windows have not elapsed. They must be
// PENDING, not counted as churned — the classic way a young alpha's retention looks fake-terrible.
assert.equal(r.retention.d1.eligible, 0, 'accounts younger than the window are not yet eligible');
assert(r.retention.d1.pending >= 2, 'they are reported pending instead');
assert.equal(r.retention.d1.rate, null, 'and the rate is null rather than a misleading 0%');
// Age one account past the D1 window without it returning → eligible, not returned, 0%.
await pool.query("UPDATE accounts SET created_at = now() - interval '3 days' WHERE id=$1", [b.account]);
r = await opsEngagement(pool, 14);
assert.equal(r.retention.d1.eligible, 1, 'an aged account becomes eligible for D1');
assert.equal(r.retention.d1.returned, 0, 'it never came back, so it did not retain');
assert.equal(r.retention.d1.rate, 0, 'and the rate is a real 0%, not null');
assert.equal(r.retention.daily.length, 14, 'DAU series covers the window');
console.log(`✓ retention: young accounts pending (not churned); an aged no-show reports a real 0% D1`);

// ── (6) agents and NPC residents are excluded from "do humans come back" ────────────────────────
await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [b.account]);
const withAgent = await opsEngagement(pool, 14);
assert.equal(withAgent.players.agents, 1, 'the agent is counted separately');
assert.equal(withAgent.players.humans, r.players.humans - 1, 'and removed from the human population');
console.log('✓ agents counted separately — an agent returning says nothing about whether the game is fun');

// ── (7) the route is mod-gated ──────────────────────────────────────────────────────────────────
assert.equal((await call('GET', '/v1/mod/engagement')).code, 401, 'the endpoint refuses a keyless caller');
assert.equal((await call('GET', '/v1/mod/engagement', { token: a.token })).code, 401, 'and a player token');
const ok = await call('GET', '/v1/mod/engagement', { mod: true });
assert.equal(ok.code, 200, 'and serves the mod key');
assert(Array.isArray(ok.body.systems) && ok.body.dead, 'returning the systems table and the dead list');
console.log('✓ GET /v1/mod/engagement is mod-gated and serves the report');

await app.close();
console.log('✅ ENGAGEMENT test passed — the system catalog claims every one of '
  + `${emitted.size} track() events in src/ exactly once (so a new system cannot silently read as dead, `
  + 'and a renamed event cannot leave a phantom), the report reads real telemetry through the public API, '
  + 'THE DEAD LIST names systems with zero distinct players while keeping untracked systems separate from '
  + 'unused ones, adoption counts distinct humans rather than event volume, retention reports young cohorts '
  + 'as pending instead of churned, agents and NPC residents are excluded from the human population, and the '
  + 'endpoint is mod-gated');
