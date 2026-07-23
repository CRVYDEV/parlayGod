// THE STREET WAGE (the value-creation pivot, E1) — the scheduled, endowment-capped $OMR emission.
// Covers: enrollment (a first epoch pays nothing, it baselines), the pro-rata payout with the
// per-account cap, the level floor + minimum-score + agent exclusions (the anti-Sybil posture),
// per-epoch idempotency (a re-run pays nothing twice), the budget bound (Σ paid ≤ the epoch
// budget), the halving schedule, and §10.4 — every wage is a ledgered `emission:wage` mint, so
// $OMR conservation holds EXACTLY (no SQL grants in this test: zero expected drift), and the
// `emission within endowment` check stays green. pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { EMISSION, epochBudget } from '../src/rules.js';
import { runWageEpoch } from '../src/emission.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
// respect is NOT a §10.4 currency — setting it directly is a clean way to simulate a day's grind
const setRespect = (id, n) => pool.query(`UPDATE characters SET respect=${n} WHERE id='${id}'`);
const omrOf = async (id) => Number((await pool.query(
  `SELECT omr FROM account_persistent WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`)).rows[0].omr);

const E = EMISSION.EPOCH0 + 10; // a synthetic epoch line inside the FIRST halving window (full budget)

// ── the schedule itself ──
assert.equal(epochBudget(EMISSION.EPOCH0 - 1), 0, 'no budget before the first epoch');
assert.equal(epochBudget(EMISSION.EPOCH0), EMISSION.EPOCH_OMR, 'day one pays the full budget');
assert.equal(epochBudget(EMISSION.EPOCH0 + EMISSION.DECAY_EVERY), EMISSION.EPOCH_OMR * EMISSION.DECAY,
  'the halving lands on schedule');

// ── enrollment epoch: nobody has a baseline, so the first run pays nothing ──
const p1 = await mk('Wage Earner');
const p2 = await mk('Second Shift');
const p3 = await mk('Green Rookie');
await setRespect(p1.id, 200); await setRespect(p2.id, 200); await setRespect(p3.id, 10);
let r = await runWageEpoch(pool, { epoch: E });
assert.equal(r.workers, 0, 'the enrollment epoch pays nobody');
assert.equal((await pool.query('SELECT COUNT(*) c FROM wage_snapshots')).rows[0].c, '3', 'everyone is enrolled');

// ── a day of play → the wage: pro-rata, capped, floored ──
await setRespect(p1.id, 1200);  // +1000 — a heavy grind (will hit the per-account cap)
await setRespect(p2.id, 300);   // +100 — a normal shift (also capped at these budgets)
await setRespect(p3.id, 50);    // +40 clears MIN_SCORE but level 4 < the floor → excluded
r = await runWageEpoch(pool, { epoch: E + 1 });
assert.equal(r.workers, 2, 'two earners drew a wage');
const w1 = await omrOf(p1.id), w2 = await omrOf(p2.id);
assert.equal(w1, EMISSION.WAGE_CAP_OMR, 'the heavy grinder is capped at WAGE_CAP_OMR');
assert.equal(w2, EMISSION.WAGE_CAP_OMR, 'a big budget caps the second earner too');
assert.equal(await omrOf(p3.id), 0, 'below the level floor draws nothing');
const ledgered = Number((await pool.query(
  "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='emission:wage'")).rows[0].s);
assert.equal(ledgered, w1 + w2, 'every wage is a ledgered emission:wage mint');

// ── idempotency: the same epoch re-run pays nothing twice ──
r = await runWageEpoch(pool, { epoch: E + 1 });
assert.equal(r.workers, 0, 'a re-run of the same epoch pays nobody');
assert.equal(await omrOf(p1.id), w1, 'no double wage');

// ── the budget bound: Σ paid ≤ the epoch budget when the budget is tight ──
await setRespect(p1.id, 1500); await setRespect(p2.id, 600);
r = await runWageEpoch(pool, { epoch: E + 2, budget: 6 });
assert.ok(r.paid <= 6 + 1e-9, `a tight budget bounds the total paid (paid ${r.paid})`);
assert.ok(r.workers === 2, 'both earners still drew from the tight budget');

// ── agent exclusion (the referral/social posture) ──
await pool.query(`UPDATE account_persistent SET agent_flag=true
  WHERE account_id=(SELECT account_id FROM characters WHERE id='${p2.id}')`);
const before2 = await omrOf(p2.id);
await setRespect(p1.id, 1600); await setRespect(p2.id, 700);
r = await runWageEpoch(pool, { epoch: E + 3 });
assert.equal(await omrOf(p2.id), before2, 'an agent-flagged account draws no wage');
assert.equal(r.workers, 1, 'only the human earned');

// ── minimum score: a login without play pays nothing ──
await setRespect(p1.id, 1600 + EMISSION.WAGE_MIN_SCORE - 1); // below the bar
const before1 = await omrOf(p1.id);
r = await runWageEpoch(pool, { epoch: E + 4 });
assert.equal(await omrOf(p1.id), before1, 'under the minimum score draws nothing');

// ── the board ──
const board = (await call('GET', '/v1/wage', { token: p1.token })).body;
assert.equal(board.endowment.total, EMISSION.ENDOWMENT_OMR, 'the board publishes the endowment');
assert.ok(board.you.enrolled, 'the board shows enrollment');
assert.ok(board.endowment.emitted > 0 && board.endowment.remaining < EMISSION.ENDOWMENT_OMR, 'emitted tracks');

// ── §10.4: EXACT conservation (no SQL $OMR grants in this test) + the endowment ceiling check ──
const inv = await runLedgerInvariants(pool);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.ok(omrCheck.ok, `$OMR conservation holds with emission ledgered as a mint (drift ${omrCheck.drift})`);
const endow = inv.checks.find((c) => c.name === 'emission within endowment');
assert.ok(endow && endow.ok, 'lifetime emission stays inside the endowment');
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert.ok(!vocab || vocab.ok, 'emission:wage is in the reason vocabulary');

// ── THE EARLY-EXIT SURCHARGE meets the wage: freshly-earned wage $OMR sold on the AMM inside the
// 48h window pays the linearly-decaying anti-dump toll (default ON — 50% at age 0), split half →
// the dev fund / half → the buyback/yield pool, with $OMR conservation still EXACT (transfers). ──
{
  const devBefore = Number((await pool.query('SELECT omr FROM dev_fund WHERE id=1')).rows[0].omr);
  const poolBefore = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
  const sell = (await call('POST', '/v1/swap', { token: p1.token, body: { direction: 'sell', amount: 2 } })).body;
  assert.ok(sell.gotCash > 0, 'the fresh sale still clears');
  assert.ok(Math.abs(sell.earlyTax - 1) < 0.02, `~50% early surcharge on just-earned wage $OMR (got ${sell.earlyTax})`);
  const devAfter = Number((await pool.query('SELECT omr FROM dev_fund WHERE id=1')).rows[0].omr);
  const poolAfter = Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance);
  assert.ok(Math.abs((devAfter - devBefore) - sell.earlyTax / 2) < 0.01, 'half the surcharge → the dev fund');
  assert.ok(Math.abs((poolAfter - poolBefore) - sell.earlyTax / 2) < 0.01, 'half the surcharge → the buyback/yield pool');
  const inv2 = await runLedgerInvariants(pool);
  const omr2 = inv2.checks.find((c) => c.name === '$OMR conservation');
  assert.ok(omr2.ok, `conservation exact with the surcharge as bucket transfers (drift ${omr2.drift})`);
}

// ── REGRESSION (AUDIT-value-creation.md F1): a mid-epoch worker crash must NOT re-grant the whole
// per-epoch budget to the survivors. Simulate run-1 of epoch RE paying pA (4 $OMR) then the process
// dying before pB (pA stamped RE, its wage row dated inside RE's window). The resume run must TOP UP
// toward the budget (8), so pB — the only remaining candidate — draws budget − already-minted = 4,
// NOT the full-budget share of 5. Without the emittedThisEpoch guard pB draws 5 and the epoch mints
// 9 > 8, silently breaching the signed per-epoch schedule (invisible to the endowment invariant). ──
{
  const RE = E + 20; // a fresh epoch line, clear of the earlier assertions
  const pA = await mk('Crash Casualty');
  const pB = await mk('The Survivor');
  await setRespect(pA.id, 200); await setRespect(pB.id, 200);
  await runWageEpoch(pool, { epoch: RE - 1 });          // enroll both (stamped RE-1, baseline 200)
  await setRespect(pB.id, 230);                         // +30 clears MIN_SCORE for the resume run
  // simulate run-1 of epoch RE: pA was paid 4 and stamped, then the box died before reaching pB
  const accA = (await pool.query(`SELECT account_id a FROM characters WHERE id='${pA.id}'`)).rows[0].a;
  await pool.query('UPDATE wage_snapshots SET epoch=$2 WHERE character_id=$1', [pA.id, RE]);
  await pool.query('UPDATE account_persistent SET omr = omr + 4 WHERE account_id=$1', [accA]);
  await pool.query(
    "INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty, at) VALUES ($1,$2,$3,'omr',4,'emission:wage','emission',$4)",
    ['reg-crash-pa', pA.id, accA, new Date(RE * 86400000 + 1000)]);
  const rr = await runWageEpoch(pool, { epoch: RE, budget: 8 }); // the resume run, same epoch, tight budget
  assert.equal(await omrOf(pB.id), 4, 'the survivor draws budget − already-minted (4), not the full-budget share (5)');
  const epochMint = 4 + Number(rr.paid); // pA's simulated 4 + what the resume actually paid
  assert.ok(epochMint <= 8 + 1e-9, `a crash-resume never mints past the epoch budget (minted ${epochMint})`);
  const inv3 = await runLedgerInvariants(pool);
  assert.ok(inv3.checks.find((c) => c.name === '$OMR conservation').ok, 'conservation stays exact across the resume');
}

console.log('✅ Street Wage test passed — schedule (halvings), enrollment→wage flow (pro-rata + cap), '
  + 'level/score/agent gates, per-epoch idempotency, tight-budget bound, the public board, and §10.4 '
  + '(ledgered emission mint, exact conservation, endowment ceiling), plus the EARLY-EXIT surcharge '
  + 'on fresh wage $OMR (~50% at age 0, half dev / half buybacks, conservation exact).');
process.exit(0);
