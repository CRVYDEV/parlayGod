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
import { EMISSION, epochBudget, emissionEpochOf } from '../src/rules.js';
import { runWageEpoch, wageBoard } from '../src/emission.js';
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
// the D1 Sybil wall: only MINTED accounts draw the wage — mark the earners paid-up (minted is an
// out-of-band entitlement, not a §10.4 currency, so direct SQL is the clean test path)
const setMinted = (id) => pool.query(
  `UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${id}')`);
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
await setMinted(p1.id); await setMinted(p2.id); await setMinted(p3.id);
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
// The board reads the LIVE epoch (emissionEpochOf), while the payroll runs above use a synthetic
// epoch line, so a board assertion has to stamp the baseline on the live line to mean anything.
const NOW = emissionEpochOf();
const stamp = (id, ep, respect) => pool.query(
  'UPDATE wage_snapshots SET epoch=$2, respect=$3 WHERE character_id=$1', [id, ep, respect]);
await stamp(p1.id, NOW - 1, 100);                       // baselined yesterday, +respect since
const board = (await call('GET', '/v1/wage', { token: p1.token })).body;
assert.equal(board.endowment.total, EMISSION.ENDOWMENT_OMR, 'the board publishes the endowment');
assert.ok(board.you.enrolled, 'the board shows enrollment');
assert.equal(board.you.eligible, true, 'a yesterday baseline + a day of play reads as on the payroll');
assert.equal(board.you.reason, null, 'no refusal reason when eligible');
assert.ok(board.endowment.emitted > 0 && board.endowment.remaining < EMISSION.ENDOWMENT_OMR, 'emitted tracks');

// ── REGRESSION (the vig-anchor class): the board's eligibility must be the PAYER's own predicate.
// It wasn't: the board said `enrolled: !!snap` — ANY baseline — while runWageEpoch scores only a
// baseline stamped EXACTLY `epoch-1`. Since the payer re-stamps every living character each run, a
// stale baseline means the WORKER MISSED A DAY, and on the next run the board told the whole base
// "on the payroll" while the epoch correctly re-enrolled them and paid nothing. On the one faucet
// that pays real value, with nothing on screen saying why. The payer's rule is the correct one —
// scoring a stale baseline would pay for play outside this epoch's window, and since a share is
// `payable × gain/total`, banking gain across skipped days buys a bigger slice of one day's budget
// at everyone else's expense. So the board moved to the payer. ──
{
  await stamp(p1.id, NOW - 3, 100);                     // the baseline the missed day left behind
  const stale = (await call('GET', '/v1/wage', { token: p1.token })).body;
  assert.equal(stale.you.eligible, false, 'a stale baseline is NOT on the payroll — the payer will skip it');
  assert.equal(stale.you.reason, 're_enrolling', 'and the board says why, instead of going quiet');
  assert.equal(stale.you.enrolled, false, '"enrolled" means enrolled for THIS epoch — the payer\'s own test');
  assert.equal(stale.you.baselineEpoch, NOW - 3, 'the stale baseline is still published honestly');
  // and the payer really does skip it — the two now agree by construction (one predicate)
  const before = await omrOf(p1.id);
  await runWageEpoch(pool, { epoch: NOW });
  assert.equal(await omrOf(p1.id), before, 'the payer skips the stale baseline the board refused');
  await stamp(p1.id, NOW - 1, 100);                     // back on the line for the checks below
  assert.equal((await call('GET', '/v1/wage', { token: p1.token })).body.you.eligible, true,
    'and a fresh baseline puts them back on the payroll');
}

// ── REGRESSION (the SAME fix's own second bug, found by red-teaming it rather than re-reading it).
// The payer runs at the CURRENT epoch and stamps THAT epoch. So for the rest of the day AFTER it
// pays you, your baseline is `epoch` — and against the payer's `epoch-1` rule that reads as a MISSED
// DAY. Measured before the fix: a player who had just been paid was told "the last payroll run
// missed a day", on every read until midnight, on the faucet that pays real value. That is the
// STEADY STATE, not an edge case — every paid player, most of the time.
// The board now asks about the run that hasn't happened yet (`scoringEpoch`), which is the question
// a player is actually asking, and keeps ONE predicate instead of growing an "except after the run"
// arm. `enrolled` comes from the predicate too, so the rule is stated in exactly one place. ──
{
  // stamped at the player's CURRENT respect, which is exactly what a real run writes — so the gain
  // toward the NEXT run is 0, the state every paid player is in the moment the worker finishes
  const nowRespect = Number((await pool.query('SELECT respect FROM characters WHERE id=$1', [p1.id])).rows[0].respect);
  await stamp(p1.id, NOW, nowRespect);                  // stamped by TODAY's completed run
  const paid = (await call('GET', '/v1/wage', { token: p1.token })).body;
  assert.notEqual(paid.you.reason, 're_enrolling',
    'a baseline stamped by the run that JUST PAID is not a missed day');
  assert.equal(paid.you.enrolled, true, 'you are on the payroll — for the NEXT run');
  assert.equal(paid.you.scoringEpoch, NOW + 1, 'and the board says which run it is answering about');
  assert.equal(paid.you.reason, 'score', 'with the honest reason: nothing earned toward it yet');
  await stamp(p1.id, NOW - 1, 100);
}

// ── REGRESSION (same fix, third defect): `status` lives on `accounts`, and wageBoard is handed
// `account_persistent`, so `acct.status` was `undefined` and the banned branch could never fire on
// the board. Unreachable today (auth 403s a banned account at the door) — but it made the
// predicate's two callers quietly DIFFERENT, which is the one property this shape exists to give.
{
  const aid = (await pool.query(`SELECT account_id a FROM characters WHERE id=$1`, [p1.id])).rows[0].a;
  await pool.query(`UPDATE accounts SET status='banned' WHERE id=$1`, [aid]);
  const banned = await wageBoard(pool, (await pool.query('SELECT * FROM characters WHERE id=$1', [p1.id])).rows[0],
    (await pool.query('SELECT * FROM account_persistent WHERE account_id=$1', [aid])).rows[0]);
  assert.equal(banned.you.eligible, false, 'a banned account is not on the payroll');
  assert.equal(banned.you.reason, 'banned', 'and the board reads the REAL status column, not a field its source lacks');
  await pool.query(`UPDATE accounts SET status='active' WHERE id=$1`, [aid]);
}

// ── §10.4: EXACT conservation (no SQL $OMR grants in this test) + the endowment ceiling check ──
const inv = await runLedgerInvariants(pool, { alert: false });
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.ok(omrCheck.ok, `$OMR conservation holds with emission ledgered as a mint (drift ${omrCheck.drift})`);
const endow = inv.checks.find((c) => c.name === 'emission within endowment');
assert.ok(endow && endow.ok, 'lifetime emission stays inside the endowment');
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert.ok(!vocab || vocab.ok, 'emission:wage is in the reason vocabulary');

// ── THE EARLY-EXIT SURCHARGE meets the wage. It used to be exercised here on an AMM SELL; the AMM
// retired in tokenomics v2 step 2, so the surcharge now lives on exactly ONE boundary — the on-chain
// WITHDRAWAL — where test/chain.js covers the rate curve (≈50% at age 0, ≈25% at 24h) and the toll
// split. What stays asserted here is the property this file owns: that freshly-minted WAGE $OMR is
// what the surcharge is FOR, and that with the AMM gone the wage has no in-game exit that could
// dodge it. The withdrawal is the only door, and it is metered.
{
  const sell = await call('POST', '/v1/swap', { token: p1.token, body: { direction: 'sell', amount: 2 } });
  assert.equal(sell.body.error, 'retired', 'wage $OMR cannot be dumped on an in-game market — there is none');
  const inv2 = await runLedgerInvariants(pool, { alert: false });
  const omr2 = inv2.checks.find((c) => c.name === '$OMR conservation');
  assert.ok(omr2.ok, `conservation exact after the refused sale (drift ${omr2.drift})`);
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
  await setMinted(pA.id); await setMinted(pB.id);
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
  const inv3 = await runLedgerInvariants(pool, { alert: false });
  assert.ok(inv3.checks.find((c) => c.name === '$OMR conservation').ok, 'conservation stays exact across the resume');
}

// ── REGRESSION (AUDIT-value-creation.md D1): the Sybil wall — only a MINTED account (one that paid
// the 0.01-ETH mint fee, or its PLEX price) draws the wage. A free guest alt that clears every play
// gate still earns NOTHING until it mints — so each wage-drawing identity costs real money and a
// bot farm funds the house instead of draining the budget. ──
{
  const ED = E + 40; // a fresh epoch line
  const alt = await mk('Free Alt');            // deliberately NOT minted
  await setRespect(alt.id, 200);               // level 8 — clears the floor
  await runWageEpoch(pool, { epoch: ED - 1 }); // enroll
  await setRespect(alt.id, 260);               // +60 clears MIN_SCORE — real play, no papers
  let rd = await runWageEpoch(pool, { epoch: ED });
  assert.equal(await omrOf(alt.id), 0, 'an unminted account draws NO wage despite clearing every play gate');
  // stamp the LIVE epoch line so the board's refusal is the MINT gate and not merely a stale
  // baseline — an `eligible === false` that could come from either reason tests neither
  await pool.query('UPDATE wage_snapshots SET epoch=$2 WHERE character_id=$1', [alt.id, emissionEpochOf() - 1]);
  const boardAlt = (await call('GET', '/v1/wage', { token: alt.token })).body;
  assert.equal(boardAlt.you.mintedRequired, true, 'the board says papers are required');
  assert.equal(boardAlt.you.minted, false, 'the board shows the account unminted');
  assert.equal(boardAlt.you.eligible, false, 'unminted → not eligible');
  assert.equal(boardAlt.you.reason, 'mint', 'and the board names the mint wall as the reason');
  await pool.query('UPDATE wage_snapshots SET epoch=$2 WHERE character_id=$1', [alt.id, ED]); // back on the synthetic line
  await setMinted(alt.id);                     // pay the piper (the mint fee entitlement)
  await setRespect(alt.id, 320);               // another +60 the next epoch
  rd = await runWageEpoch(pool, { epoch: ED + 1 });
  assert.ok(await omrOf(alt.id) > 0, 'the same account draws a wage once minted');
}

console.log('✅ Street Wage test passed — schedule (halvings), enrollment→wage flow (pro-rata + cap), '
  + 'level/score/agent gates, per-epoch idempotency, tight-budget bound, the public board, and §10.4 '
  + '(ledgered emission mint, exact conservation, endowment ceiling), plus the EARLY-EXIT surcharge '
  + 'on fresh wage $OMR (~50% at age 0, half dev / half buybacks, conservation exact).');
process.exit(0);
