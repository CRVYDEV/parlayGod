// THE FAUCET IS RETIRED (economy v3 step 1) — this file used to prove the Street Wage paid
// correctly; it now proves it cannot pay at all, which is the stronger claim and the one v3's
// first wall rests on: **no faucet**. Zero mint reasons that pay a player means in-game $OMR can
// never exceed what was deposited, so "extraction ≤ inflow" is an identity the ledger exhibits
// rather than a constraint the withdrawal queue has to enforce.
//
// A retirement is only real if something FAILS when it is undone, so this covers all four ways the
// printer could come back: the module, the schedule constants, the worker, and the invariant.
// pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import * as R from '../src/rules.js';
import * as Emission from '../src/emission.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return token;
};

// ── (1) THE MODULE — the wage machinery is gone, not disabled ──────────────────────────────────
// A dormant faucet is one env var away from a live one, so the functions themselves must not exist.
for (const gone of ['runWageEpoch', 'wageEligibility', 'emittedThisEpoch', 'emittedTotal']) {
  assert.equal(Emission[gone], undefined,
    `src/emission.js still exports ${gone} — the wage machinery must be DELETED, not left dormant`);
}
console.log('✓ the wage machinery is gone (no payer, no eligibility predicate, no epoch accounting)');

// ── (2) THE SCHEDULE — the constants that priced the printer are gone too ──────────────────────
// Left behind, they read as a live schedule to anyone opening rules.js, and the levers register
// would keep pinning numbers nothing honours.
for (const gone of ['EMISSION', 'epochBudget', 'emissionEpochOf', 'wageRequireMinted']) {
  assert.equal(R[gone], undefined, `rules.js still exports ${gone} — the emission schedule is retired`);
}
console.log('✓ the emission schedule is gone from rules.js (no endowment, no epoch budget, no halving)');

// ── (3) THE WORKER — no tick pays a wage ───────────────────────────────────────────────────────
// The worker is the only thing that ever CALLED the payer, and it runs on a live server every hour.
const worker = fs.readFileSync('src/worker.js', 'utf8');
assert.ok(!/runWageEpoch/.test(worker), 'src/worker.js still calls runWageEpoch — the printer still runs hourly');
console.log('✓ no worker tick pays a wage');

// ── (4) THE BOARD — a caller learns what happened instead of getting a 404 ─────────────────────
// Ours and any agent that has been polling /v1/wage (the v2 swap/launder retirement precedent).
const t = await mk('Sal Tombstone');
const wage = await call('GET', '/v1/wage', { token: t });
assert.equal(wage.code, 400, `/v1/wage should refuse cleanly, got ${wage.code}`);
assert.equal(wage.body.error, 'retired', `expected a 'retired' error, got ${wage.body.error}`);
// Two properties, not a phrase — the previous version word-matched "bought or taken" and broke on a
// comma. (a) it must say where $OMR actually comes from, so a caller learns something; and (b) it
// must NOT describe a past state, because a player who never knew the wage reads "no longer" as a
// change they missed. The second is a founder rule for all player-facing copy (2026-08-11) and it is
// cheapest to hold at the one place a retired route still talks to a human.
{
  const msg = wage.body.message || '';
  assert.ok(/bought/i.test(msg),
    'the refusal must say where $OMR comes from, not just that there is no wage');
  assert.ok(!/no longer|used to|previously|formerly|is gone|was retired/i.test(msg),
    `the refusal must describe the game as it IS, with no reference to how it was — got: "${msg}"`);
}
// and the public rulebook makes the same positive claim, so a client can render it
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.emission.faucet, null, '/v1/rules must state that there is no faucet');
console.log('✓ /v1/wage and /v1/rules both say the printer is off, and why');

// ── (5) §10.4 — historical rows still count, and a NEW one is an alarm ─────────────────────────
// The subtle half of the retirement. `emission:wage` stays in the vocabulary AND the mint term
// because a live database holds the rows the wage already wrote and conservation is a claim about
// the WHOLE ledger — drop the reason and every server that ever paid a wage drifts by what it paid.
// So: seed an OLD wage row + its $OMR, prove conservation still reconciles it, then seed a FRESH
// one and prove the new check fires. Both halves matter; only asserting the second would let the
// reason be deleted from omrMints with the suite still green.
const acct = (await pool.query('SELECT account_id FROM characters LIMIT 1')).rows[0].account_id;
const ledgerWage = async (amount, at) => pool.query(
  'INSERT INTO transactions (id, account_id, currency, amount, reason, counterparty, at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
  [crypto.randomUUID(), acct, 'omr', amount, 'emission:wage', 'emission', at]);

const old = new Date(Date.now() - 30 * 86400000);
await ledgerWage(7, old);
await pool.query('UPDATE account_persistent SET omr = omr + 7 WHERE account_id=$1', [acct]);
let inv = await runLedgerInvariants(pool, { alert: false });
const conservation = inv.checks.find((c) => c.name === '$OMR conservation');
assert.ok(conservation.ok,
  `a historical wage row broke $OMR conservation (drift ${conservation.drift}) — emission:% must stay in omrMints`);
const retired = inv.checks.find((c) => c.name === 'emission faucet retired');
assert.ok(retired, 'the `emission faucet retired` check is missing — wall 1 is unasserted');
assert.ok(retired.ok, `an old wage row should not trip the retirement check (drift ${retired.drift})`);
console.log('✓ historical wage rows still reconcile, and do not trip the retirement check');

await ledgerWage(3, new Date());   // somebody re-armed the printer an hour ago
await pool.query('UPDATE account_persistent SET omr = omr + 3 WHERE account_id=$1', [acct]);
inv = await runLedgerInvariants(pool, { alert: false });
const fired = inv.checks.find((c) => c.name === 'emission faucet retired');
assert.equal(fired.ok, false, 'a FRESH emission row must trip the retirement check — otherwise wall 1 is a promise, not a check');
assert.equal(fired.drift, 3, `the check should report what was printed, got ${fired.drift}`);
// and conservation is still exact with the new row, because the reason is still in the mint term
assert.ok(inv.checks.find((c) => c.name === '$OMR conservation').ok, 'conservation must hold either way');
console.log('✓ a NEW emission row trips `emission faucet retired` while conservation stays exact');

await app.close();
console.log('\n✅ THE FAUCET IS RETIRED — the wage machinery, its schedule and its worker tick are gone; '
  + '/v1/wage and /v1/rules say so and say what replaced it; and §10.4 keeps counting the rows it '
  + 'already wrote while a single NEW one now trips an alarm. That is v3 wall 1 (no faucet) made '
  + 'checkable rather than promised.');
