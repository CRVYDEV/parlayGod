// THE AHA MOMENT — "First Blood" (src/firstblood.js). A guaranteed early dramatic beat: soon after a
// new player finds their feet, a nearby resident "makes a move" on them (recorded on the rivals ledger,
// delivered as a cinematic), the coach points them at hitting back, and SETTLING it (a JUMP — the
// accessible level-1 verb) pays a bounded once-ever bonus and teaches the whole rivalry loop.
// §10.4: the assignment moves no value; the settle pays ONE ledgered `firstblood:reward` cash faucet
// gated by aha_stage so it can NEVER pay twice on a street. Runs on pg-mem — zero infra.
process.env.SEARCH_MS = '0';
process.env.SEASON_MOD = 'dead_quiet';   // TEST-ONLY — pin the armed seasonal twist (the social.js flake class)
process.env.SEASON_PHASE = 'long_game';  // TEST-ONLY — pin the season phase

import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { spawnResident, retireResident } from '../src/population.js';
import { AHA, levelOf } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (token) => (await call('GET', '/v1/me', { token })).body.character;
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const rowOf = async (id) => (await pool.query('SELECT * FROM characters WHERE id=$1', [id])).rows[0];
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};

// ── a weak resident in the city, at the docks, so the beat has a body to point at ──
const res = await spawnResident(pool, { band: { id: 'corner', lvl: [1, 2], seed: [200, 400], stat: [1, 3] } });
assert.ok(res, 'a resident spawned');
const resident = res.id;
await seedCh(resident, "loc='docks', respect=100, muscle=1, cunning=1, speed=1");
const residentName = res.name;

// ── the player: level ~5 (past AHA.MIN_LVL), a bruiser, at the docks so they can reach the rival ──
const player = await mk('Fresh Meat');
await seedCh(player.id, "respect=200, cash=5000, muscle=400, speed=400, energy=200, ammo=200, cb=10, loc='docks', aha_stage=0");
assert.ok(levelOf(200) >= AHA.MIN_LVL, 'player is past the aha level floor');

// baseline §10.4 (SQL-seeded cash makes the drift non-zero — the scale/loadtest posture, so assert a DELTA)
const drift0 = (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === 'character cash').drift;

// ── ASSIGN: any authed action fires the post-commit hook. Pull a job. ──
let stage = Number((await rowOf(player.id)).aha_stage);
assert.equal(stage, 0, 'stage 0 before any action');
// a crime is an ordinary authed action → the withCharacter post-commit hook runs startFirstBlood
for (let i = 0; i < 3 && stage === 0; i++) {
  await call('POST', '/v1/crimes/pick', { token: player.token });
  stage = Number((await rowOf(player.id)).aha_stage);
}
assert.equal(stage, 1, 'the aha beat was assigned (stage 1) after acting');
const assigned = await rowOf(player.id);
assert.equal(assigned.aha_rival, resident, 'the assigned rival is the weak resident');
assert.equal(assigned.aha_rival_name, residentName, 'the rival name is stored');

// the rivals ledger carries the resident's "move" (aggressor = the resident, kind callout)
const rev = (await pool.query(
  'SELECT * FROM rival_events WHERE victim_account=(SELECT account_id FROM characters WHERE id=$1)', [player.id])).rows;
assert.ok(rev.some((e) => e.kind === 'callout'), 'a callout rival_event was recorded against the player');

// a first_blood notification is queued for the client cinematic
const notes = (await pool.query("SELECT * FROM notifications WHERE character_id=$1 AND type='first_blood'", [player.id])).rows;
assert.equal(notes.length, 1, 'one first_blood notification queued');
assert.equal(JSON.parse(notes[0].payload).rival, residentName, 'the notification names the rival');

// the coach points the player at settling it
const coach = (await meOf(player.token)).coach;
assert.ok(coach && /settle your first score/i.test(coach.label), 'the coach points at settling the first score');

// re-acting must NOT re-assign or duplicate the beat (idempotent — once ever per street)
await call('POST', '/v1/crimes/pick', { token: player.token });
const notes2 = (await pool.query("SELECT count(*)::int n FROM notifications WHERE character_id=$1 AND type='first_blood'", [player.id])).rows[0].n;
assert.equal(notes2, 1, 'the beat is assigned once — no duplicate on a second action');

// ── SETTLE: jump the assigned rival. The bruiser wins deterministically (400/400 vs 1/1). ──
const jr = await call('POST', `/v1/streets/${resident}/jump`, { token: player.token });
assert.equal(jr.code, 200, 'the jump lands');
assert.ok(jr.body.win, 'the player wins the jump');
assert.ok(jr.body.firstBlood, 'the response carries the first-blood settle');
assert.equal(jr.body.firstBlood.cash, AHA.REWARD_CASH, 'the once-ever cash bonus is paid');
assert.equal(jr.body.firstBlood.rep, AHA.REWARD_RESPECT, 'the once-ever respect bonus is paid');
assert.equal(jr.body.firstBlood.rival, residentName, 'the settle names the rival');

// stage closed — a second jump does NOT pay again (gated by aha_stage)
assert.equal(Number((await rowOf(player.id)).aha_stage), 2, 'the beat is closed (stage 2)');
// heal the rival's hospital + refill the player so a second jump is possible, then confirm no re-pay
await seedCh(resident, "hosp_until=NULL, health=100");
await seedCh(player.id, "energy=200, ammo=200");
const jr2 = await call('POST', `/v1/streets/${resident}/jump`, { token: player.token });
assert.equal(jr2.code, 200, 'a second jump lands');
assert.ok(!jr2.body.firstBlood, 'the bonus is NOT paid a second time');

// ── §10.4: the ONLY new cash faucet is one bounded firstblood:reward row ──
const fb = (await pool.query("SELECT amount, reason FROM transactions WHERE reason='firstblood:reward'")).rows;
assert.equal(fb.length, 1, 'exactly one firstblood:reward faucet row');
assert.equal(Number(fb[0].amount), AHA.REWARD_CASH, 'the faucet amount matches the lever');

// conservation holds — the faucet is properly ledgered, so it adds NO drift over the SQL-seed baseline
// (the scale/loadtest posture: SQL-seeded cash makes the absolute drift non-zero, so assert the DELTA).
const checks = (await runLedgerInvariants(pool, { alert: false })).checks;
const cashCheck = checks.find((c) => c.name === 'character cash');
assert.equal(cashCheck.drift, drift0, 'the first-blood faucet is ledgered — no new §10.4 drift over the baseline');
// the reason vocabulary is closed (firstblood: is enumerated)
const vocab = checks.find((c) => c.name === 'reason vocabulary');
assert.equal(vocab.ok, true, 'the reason vocabulary is closed — firstblood: is enumerated');

// ── THE RIVAL CAN BE RETIRED OUT FROM UNDER THE POINTER ─────────────────────────────────────────
// The rung clears ONLY by jumping that exact character (settleFirstBlood checks `aha_rival ===
// victim.id`), and it sits ABOVE "Pull your first job" and the whole road to level 5. So a rival who
// is gone does not merely make the beat unreachable — it PINS THE COACH on an instruction the player
// cannot carry out, masking every rung below it for the rest of that street's life. Unrecoverable,
// unlike the masking cases found before, which at least cleared when the player did something.
//
// It is the most likely pointer to go stale, not the least: startFirstBlood picks the WEAKEST nearby
// resident, and the turnover loop retires exactly the residents players have picked clean.
// Found by tools/playthrough.js measuring the rung at 100% of advised play.
{
  // a fresh weak resident for this player's beat to point at, and a fresh player
  const r2 = await spawnResident(pool, { band: { id: 'corner', lvl: [1, 2], seed: [200, 400], stat: [1, 3] } });
  await seedCh(r2.id, "loc='neon', respect=100, muscle=1, cunning=1, speed=1");
  const p2 = await mk('Second Soul');
  await seedCh(p2.id, "respect=200, cash=5000, muscle=400, speed=400, energy=200, loc='neon', aha_stage=0");
  // drive the assignment the ordinary way
  let st = 0;
  for (let i = 0; i < 12 && st !== 1; i++) {
    await call('POST', '/v1/crimes/pick', { token: p2.token });
    st = Number((await rowOf(p2.id)).aha_stage);
  }
  assert.equal(st, 1, 'the beat was assigned');
  const rival = (await rowOf(p2.id)).aha_rival;
  assert(rival, 'and it names a rival');

  // the worker retires that resident — a routine event, not an exotic one
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await retireResident(client, rival);
    await client.query('COMMIT');
  } finally { client.release(); }

  const after = await rowOf(p2.id);
  assert.notEqual(Number(after.aha_stage), 1,
    'a retired rival must not leave the coach pinned on stage 1 forever — the rung sits above the '
    + 'whole on-ramp, so an unclearable stage 1 masks every rung below it for the rest of the street');
  assert.equal(after.aha_rival, null, 'and the dangling pointer is gone');

  // the beat is not silently CANCELLED either — it goes back to unassigned, so the player still gets
  // it, with somebody who exists. (Stage 2 would mean "settled": the reward skipped, the beat lost.)
  assert.equal(Number(after.aha_stage), 0, 'it resets to unassigned so a live rival is picked next');
  const me = await call('GET', '/v1/me', { token: p2.token });
  assert.notEqual(me.body?.character?.coach?.label, 'Settle your first score',
    'and the coach has moved on rather than naming somebody who is gone');
}

console.log('✅ THE AHA MOMENT (first blood): assign, coach, idempotent, settle, once-ever, §10.4');
process.exit(0);
