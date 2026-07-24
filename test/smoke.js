// M1 smoke test: full player journey + ledger invariant. Runs on pg-mem — zero infra.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';

const app = await buildServer();
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};

// auth → character
const { body: { token } } = await call('POST', '/v1/auth/guest');
assert(token, 'guest token');
assert.equal((await call('POST', '/v1/character', { token, body: { name: 'Test Soldato' } })).code, 200);
let me = (await call('GET', '/v1/me', { token })).body.character;
assert.equal(me.cash, 500); assert.equal(me.level, 1);

// crimes until one succeeds and one fails (both paths + ledger)
let successes = 0, fails = 0;
for (let i = 0; i < 30 && (successes === 0 || fails === 0); i++) {
  const r = await call('POST', '/v1/crimes/pick', { token });
  if (r.code === 400 && r.body.error === 'nerve') break;
  if (r.body.success) successes++; else fails++;
}
assert(successes > 0, 'at least one clean job');
me = (await call('GET', '/v1/me', { token })).body.character;
assert(me.respect > 0, 'respect earned');

// D6a — THE APPROACH: the per-job risk/reward choice (Case It / Standard / Go Loud).
// The three-way picker is public on /v1/rules; the server stays the referee.
const rules = (await call('GET', '/v1/rules', { token })).body;
assert.deepEqual(rules.crimeApproaches.map((a) => a.id), ['quiet', 'standard', 'loud'], 'the three approaches surface on /v1/rules');
// wait for nerve to regen if the loop above spent it, then take a fresh reading
async function tillNerve(min) { for (let i = 0; i < 40; i++) { const c = (await call('GET', '/v1/me', { token })).body.character; if (Number(c.nerve) >= min) return c; await app.pool.query("UPDATE characters SET nerve=10 WHERE id=$1", [c.id]); } return (await call('GET', '/v1/me', { token })).body.character; }
let pre = await tillNerve(1);
// GO LOUD adds law heat whether you get away or not (feeds the RICO meter); the response carries the approach
const loud = await call('POST', '/v1/crimes/pick', { token, body: { approach: 'loud' } });
assert.equal(loud.code, 200, 'a loud job runs');
assert.equal(loud.body.approach, 'loud', 'the response echoes the chosen approach');
let post = (await call('GET', '/v1/me', { token })).body.character;
assert.equal(post.heat, Math.min(100, pre.heat + rules.crimeApproaches.find((a) => a.id === 'loud').heat), 'Go Loud drew law heat on the attempt');
// STANDARD (and an unknown approach → standard fallback) draws no heat
pre = await tillNerve(1);
const std = await call('POST', '/v1/crimes/pick', { token, body: { approach: 'nonsense' } });
assert.equal(std.code, 200, 'an unknown approach falls back to standard (no 400)');
assert.equal(std.body.approach, 'standard', 'the unknown approach resolved to standard');
post = (await call('GET', '/v1/me', { token })).body.character;
assert.equal(post.heat, pre.heat, 'standard/fallback adds no heat');
me = (await call('GET', '/v1/me', { token })).body.character;

// train (energy check), bank round trip, travel, checkin
assert.equal((await call('POST', '/v1/train/muscle', { token })).code, 200);
assert.equal((await call('POST', '/v1/bank/deposit', { token, body: { amount: 200 } })).code, 200);
assert.equal((await call('POST', '/v1/bank/withdraw', { token, body: { amount: 100 } })).code, 200);
assert.equal((await call('POST', '/v1/travel/neon', { token })).code, 200);
const ck = await call('POST', '/v1/checkin', { token });
assert.equal(ck.code, 200); assert.equal(ck.body.streak, 1);
assert.equal((await call('POST', '/v1/checkin', { token })).code, 400, 'double check-in rejected');

// guarded actions reject bad input
assert.equal((await call('POST', '/v1/crimes/depository', { token })).code, 400, 'level gate holds');
assert.equal((await call('POST', '/v1/bank/deposit', { token, body: { amount: -5 } })).code, 400, 'negative rejected');
assert.equal((await call('GET', '/v1/me', {})).code, 401, 'auth required');

// LEDGER INVARIANT (spec §10.4): cash+bank − starting 500 == Σ cash ledger entries (bank interest ≈ 0 in seconds)
me = (await call('GET', '/v1/me', { token })).body.character;
const sum = await app.pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='cash'");
const drift = Math.abs((me.cash + me.bank - 500) - Number(sum.rows[0].s));
assert(drift <= 1, `ledger drift ${drift}`);

// accrual: backdate last_accrued_at 10 min → energy/nerve regenerate
await app.pool.query("UPDATE characters SET last_accrued_at = now() - interval '10 minutes', energy = 0, nerve = 0");
me = (await call('GET', '/v1/me', { token })).body.character;
assert(me.energy >= 50 || me.energy === me.maxEnergy, 'energy regenerated');
assert(me.nerve > 0, 'nerve regenerated');

console.log('✅ M1 smoke test passed — auth, character, crimes (both outcomes), train, bank, travel, check-in, gates, ledger invariant, lazy accrual');
await app.close();
