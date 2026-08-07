// PRIME TIME — the nightly synchronous window (step one: THE RALLY).
//
// The centre of the test: the window gates (you can only answer while it's live, once a night, past a
// level floor); the two modes (honor grants a rotating title immediately and moves NO value; value
// records the answer and the WORKER settles at final turnout, paying the co-present cash faucet); and
// §10.4 — an honor night writes zero ledger rows, a value night's only faucet is the bounded
// `primetime:rally`, reconciled by the per-character cash check.
//
// The window is forced live with PRIME_TIME_LIVE=on and the mode pinned with PRIME_TIME_MODE (the
// SEASON_MOD/BULLETIN_THEME TEST-ONLY precedent), so the test needn't warp the clock to the drawn hour.
process.env.PRIME_TIME_LIVE = 'on';
process.env.PRIME_TIME_MECH = 'rally';   // pin the mechanic for the rally block (the seed now draws rally OR happyhour)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { settlePrimeTime, rallyReward } from '../src/primetime.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { PRIME_TIME, primeTimeOf, dayOf } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const me = (await call('GET', '/v1/me', { token })).body.character;
  return { token, id: me.id, name };
};
const idOf = async (cid) => (await pool.query('SELECT id FROM characters WHERE id=$1', [cid])).rows[0].id;
// lift a street past the RALLY level floor (respect drives level; a generous seed clears level 5)
const levelUp = async (cid) => pool.query('UPDATE characters SET respect=$2 WHERE id=$1', [cid, 5000]);
const cashOf = async (cid) => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [cid])).rows[0].cash);
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);
const driftOf = async (name) => Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === name).drift);
const setMode = (m) => { process.env.PRIME_TIME_MODE = m; };

// ════════════ the board — the window is live (forced), forecast present ════════════
setMode('value');
const p = await mk('Prime Mover');
await levelUp(p.id);
let b = (await call('GET', '/v1/primetime', { token: p.token })).body;
assert.equal(b.mechanic, 'rally', 'step one is a rally');
assert.equal(b.live, true, 'the window is live (forced)');
assert.equal(b.answered, false, 'not answered yet');
assert.ok(Array.isArray(b.forecast) && b.forecast.length === PRIME_TIME.FORECAST_DAYS, 'a multi-night forecast is published');
assert.equal(b.minLevel, PRIME_TIME.RALLY_MIN_LVL, 'the level floor is surfaced');

// ════════════ the level floor — a rookie can't answer ════════════
const rook = await mk('Fresh Rook');   // level 1, below RALLY_MIN_LVL
let r = await call('POST', '/v1/primetime/answer', { token: rook.token });
assert.equal(r.body.error, 'rookie', 'a rookie is turned away at the level floor');

// ════════════ VALUE MODE — answer records, the worker settles at final turnout, §10.4 faucet ════════════
const before = await driftOf('character cash');
const pStart = await cashOf(p.id);
r = await call('POST', '/v1/primetime/answer', { token: p.token });
assert.equal(r.body.answered, true, 'answered on a value night');
assert.equal(r.body.mode, 'value', 'value mode');
assert.equal(r.body.pending, true, 'the cash is pending — settled at the window close');
assert.equal(await cashOf(p.id), pStart, 'no cash moves on a value answer (the worker pays at close)');
// once a night
r = await call('POST', '/v1/primetime/answer', { token: p.token });
assert.equal(r.body.error, 'already', 'you can only answer once a night');

// a second player answers the SAME night — turnout is now 2, so the reward scales up
const q = await mk('Second Soul');
await levelUp(q.id);
const qStart = await cashOf(q.id);
r = await call('POST', '/v1/primetime/answer', { token: q.token });
assert.equal(r.body.turnout, 2, 'turnout counts everyone who answered tonight');

// the worker CANNOT settle a still-open night (the window is live) — force the day CLOSED by moving the
// two rows to YESTERDAY (a closed value night: the seed makes yesterday a value night too via the pin).
const today = dayOf();
await pool.query('UPDATE primetime_rally SET day=$1 WHERE day=$2', [today - 1, today]);
// yesterday's mode must be value for the settle to fire — the pin (PRIME_TIME_MODE) makes it so.
assert.equal(primeTimeOf(today - 1).mode, 'value', 'the pinned mode makes yesterday a value night');
const paidBefore = await cashOf(p.id);
const res = await settlePrimeTime(pool);
assert.ok(res.paid >= 2, 'the worker settled both answerers');
const reward = rallyReward(2);   // BASE + PER×min(2-1, CAP)
assert.equal(await cashOf(p.id), paidBefore + reward, 'each answerer is paid the turnout-scaled reward');
assert.equal(await cashOf(q.id), qStart + reward, 'both get the SAME final-turnout reward (nobody punished for coming early)');
// idempotent — a second settle pays nothing more (claim-then-pay on the settled flag)
const again = await settlePrimeTime(pool);
assert.equal(await cashOf(p.id), paidBefore + reward, 'a second settle pays nothing more (idempotent)');

// §10.4 — the value faucet reconciles by the per-character cash check (drift unchanged by the reward)
assert.equal(await driftOf('character cash'), before, 'the value-rally faucet reconciles — no §10.4 drift');
// the reward is the enumerated `primetime:rally` reason, character_id'd
const led = (await pool.query("SELECT reason, amount, character_id FROM transactions WHERE reason='primetime:rally' ORDER BY amount")).rows;
assert.ok(led.length >= 2 && led.every((x) => x.character_id && Number(x.amount) === reward), 'each faucet row is character_id\'d primetime:rally');

// ════════════ HONOR MODE — a rotating title, zero §10.4 ════════════
setMode('honor');
const h = await mk('Badge Hunter');
await levelUp(h.id);
const txBefore = await txnCount();
r = await call('POST', '/v1/primetime/answer', { token: h.token });
assert.equal(r.body.mode, 'honor', 'honor night');
assert.equal(r.body.answered, true, 'answered for the badge');
const pt = primeTimeOf(dayOf());
assert.equal(r.body.title, pt.title, 'the response carries tonight\'s rotating badge');
// the living street wears the title
const worn = (await pool.query('SELECT title FROM characters WHERE id=$1', [await idOf(h.id)])).rows[0].title;
assert.equal(worn, pt.title, 'the badge is written to the title slot');
// an honor night moves NO value — zero new ledger rows, and the worker pays nothing
assert.equal(await txnCount(), txBefore, 'answering on an honor night writes zero transactions rows');
const hCash = await cashOf(h.id);
await pool.query('UPDATE primetime_rally SET day=$1 WHERE character_id=$2', [dayOf() - 1, await idOf(h.id)]);
await settlePrimeTime(pool);
assert.equal(await cashOf(h.id), hCash, 'the worker pays an honor answerer NOTHING (the badge was the whole reward)');
assert.equal(await txnCount(), txBefore, 'and the honor settle wrote no ledger row');

// ════════════ STEP TWO — HAPPY HOUR (a repeatable window action; value → cash/round, honor → XP) ════════════
process.env.PRIME_TIME_MECH = 'happyhour';
// a rally answer is refused on a happy-hour night (and vice-versa) — the mechanic gates the action
setMode('value');
const hh = await mk('Happy Hour Hank');
await levelUp(hh.id);
let hb = (await call('GET', '/v1/primetime', { token: hh.token })).body;
assert.equal(hb.mechanic, 'happyhour', 'the night is a happy hour');
assert.equal(hb.roundsLeft, PRIME_TIME.HAPPY_ROUNDS, 'all rounds available');
assert.equal(hb.roundCash, PRIME_TIME.HAPPY_CASH, 'the value round pays HAPPY_CASH');
assert.equal((await call('POST', '/v1/primetime/answer', { token: hh.token })).body.error, 'not_rally', 'you can\'t answer a call on a happy-hour night');

// VALUE — each round pays HAPPY_CASH immediately, up to HAPPY_ROUNDS
const hhStart = await cashOf(hh.id);
const beforeHH = await driftOf('character cash');
for (let i = 1; i <= PRIME_TIME.HAPPY_ROUNDS; i++) {
  const rr = await call('POST', '/v1/primetime/round', { token: hh.token });
  assert.equal(rr.body.round, i, `round ${i} recorded`);
  assert.equal(rr.body.cash, PRIME_TIME.HAPPY_CASH, 'each round pays HAPPY_CASH immediately');
}
assert.equal(await cashOf(hh.id), hhStart + PRIME_TIME.HAPPY_ROUNDS * PRIME_TIME.HAPPY_CASH, 'total = ROUNDS × CASH, paid up front');
// capped at HAPPY_ROUNDS
assert.equal((await call('POST', '/v1/primetime/round', { token: hh.token })).body.error, 'done', 'no more than HAPPY_ROUNDS a night');
// §10.4 — the happy-hour faucet reconciles by the per-character cash check
assert.equal(await driftOf('character cash'), beforeHH, 'the happy-hour faucet reconciles — no §10.4 drift');
const hled = (await pool.query("SELECT amount, character_id FROM transactions WHERE reason='primetime:happy'")).rows;
assert.ok(hled.length === PRIME_TIME.HAPPY_ROUNDS && hled.every((x) => x.character_id && Number(x.amount) === PRIME_TIME.HAPPY_CASH), 'each round is a character_id\'d primetime:happy row');

// HONOR — each round bumps gambling mastery XP, moves NO value
setMode('honor');
const hg = await mk('Card Sharp');
await levelUp(hg.id);
const hgTx = await txnCount();
const rr2 = await call('POST', '/v1/primetime/round', { token: hg.token });
assert.equal(rr2.body.mode, 'honor', 'honor happy hour');
assert.equal(rr2.body.round, 1, 'a round recorded');
assert.equal(rr2.body.cash, undefined, 'no cash on an honor round');
assert.equal(await txnCount(), hgTx, 'an honor round writes zero transactions rows');
const gxp = Number((await pool.query('SELECT xp FROM masteries WHERE character_id=$1 AND track_id=$2', [await idOf(hg.id), 'gambling'])).rows[0]?.xp || 0);
assert.ok(gxp > 0, 'the honor round schooled the gambling track (mastery XP, not cash)');

// ════════════ STEP THREE — THE SIEGE (co-present shared damage bar; cracked → cash/badge, else nothing) ════════════
process.env.PRIME_TIME_MECH = 'siege';
// pad the night to (SIEGE_NEED - 1) ghost fighters so ONE real join cracks the bar. Ghost rows aren't
// characters (the settle JOIN excludes them), but turnoutOf counts every row — the co-present padding.
const padSiege = async (day, n, from = 0) => {
  for (let i = from; i < from + n; i++) await pool.query('INSERT INTO primetime_rally (day, character_id, settled) VALUES ($1,$2,false)', [day, `ghost-${day}-${i}`]);
};

// VALUE SIEGE — join in-window, worker pays SIEGE_CASH on a crack
setMode('value');
const sg = await mk('Siege Breaker');
await levelUp(sg.id);
let sb = (await call('GET', '/v1/primetime', { token: sg.token })).body;
assert.equal(sb.mechanic, 'siege', 'the night is a siege');
assert.equal(sb.joined, false, 'not joined yet');
assert.equal(sb.target, PRIME_TIME.SIEGE_NEED * PRIME_TIME.SIEGE_STRIKE, 'the shared target is surfaced');
assert.equal(sb.siegeCash, PRIME_TIME.SIEGE_CASH, 'the crack reward is surfaced');
// a rally answer / happy round is refused on a siege night — the mechanic gates the action
assert.equal((await call('POST', '/v1/primetime/answer', { token: sg.token })).body.error, 'not_rally', 'no rally answer on a siege night');
assert.equal((await call('POST', '/v1/primetime/round', { token: sg.token })).body.error, 'not_happy', 'no happy round on a siege night');

const sgToday = dayOf();
const sgJoinCash = await cashOf(sg.id);
await padSiege(sgToday, PRIME_TIME.SIEGE_NEED - 1);   // (NEED-1) ghosts + 1 real join = NEED fighters = a crack
let sr = await call('POST', '/v1/primetime/siege', { token: sg.token });
assert.equal(sr.body.joined, true, 'joined the siege');
assert.equal(sr.body.fighters, PRIME_TIME.SIEGE_NEED, 'turnout counts the ghosts + you');
assert.equal(sr.body.cracked, true, 'the bar is cracked (target met)');
assert.equal(sr.body.pending, true, 'no cash at join — the worker settles at close');
assert.equal(await cashOf(sg.id), sgJoinCash, 'no cash moves on a join');
// once a night
assert.equal((await call('POST', '/v1/primetime/siege', { token: sg.token })).body.error, 'already', 'one run on the gates a night');

// close the night → the worker pays SIEGE_CASH to the cracker
const sgBeforeDrift = await driftOf('character cash');
const sgStart = await cashOf(sg.id);
await pool.query('UPDATE primetime_rally SET day=$1 WHERE day=$2', [sgToday - 1, sgToday]);
const sres = await settlePrimeTime(pool);
assert.ok(sres.paid >= 1, 'the worker paid the cracked siege');
assert.equal(await cashOf(sg.id), sgStart + PRIME_TIME.SIEGE_CASH, 'each fighter on a cracked siege takes SIEGE_CASH');
// idempotent
await settlePrimeTime(pool);
assert.equal(await cashOf(sg.id), sgStart + PRIME_TIME.SIEGE_CASH, 'a second settle pays nothing more');
// §10.4 — the siege faucet reconciles, the reason is character_id'd primetime:siege
assert.equal(await driftOf('character cash'), sgBeforeDrift, 'the siege faucet reconciles — no §10.4 drift');
const sled = (await pool.query("SELECT amount, character_id FROM transactions WHERE reason='primetime:siege'")).rows;
assert.ok(sled.length >= 1 && sled.every((x) => x.character_id && Number(x.amount) === PRIME_TIME.SIEGE_CASH), 'each faucet row is character_id\'d primetime:siege');

// FAILED SIEGE — too few fighters, nobody paid (but all settled). A DISTINCT closed day (today-2) so the
// value-siege crowd already parked at today-1 can't pad this night's turnout into a crack.
const sg2 = await mk('Lone Stormer');
await levelUp(sg2.id);
const sg2Today = dayOf();
// only this one real fighter, no ghosts → damage 100 < target 800 → not cracked
sr = await call('POST', '/v1/primetime/siege', { token: sg2.token });
assert.equal(sr.body.cracked, false, 'a lone fighter can\'t crack the gates');
const sg2Start = await cashOf(sg2.id);
await pool.query('UPDATE primetime_rally SET day=$1 WHERE character_id=$2', [sg2Today - 2, await idOf(sg2.id)]);
await settlePrimeTime(pool);
assert.equal(await cashOf(sg2.id), sg2Start, 'a failed siege pays nobody');
assert.equal(Number((await pool.query('SELECT settled FROM primetime_rally WHERE character_id=$1', [await idOf(sg2.id)])).rows[0]?.settled ?? 1), 1, 'but the row is settled (won\'t re-process)');

// HONOR SIEGE — a crack grants the badge, moves NO value. Its own closed day (today-3).
setMode('honor');
const sgh = await mk('Badge Stormer');
await levelUp(sgh.id);
const sghToday = dayOf();
await padSiege(sghToday, PRIME_TIME.SIEGE_NEED - 1, 100);   // ghosts to crack it
sr = await call('POST', '/v1/primetime/siege', { token: sgh.token });
assert.equal(sr.body.cracked, true, 'the honor siege cracks with the crowd');
const sghTx = await txnCount();
const sghCash = await cashOf(sgh.id);
await pool.query('UPDATE primetime_rally SET day=$1 WHERE day=$2', [sghToday - 3, sghToday]);
await settlePrimeTime(pool);
const wornSiege = (await pool.query('SELECT title FROM characters WHERE id=$1', [await idOf(sgh.id)])).rows[0].title;
assert.equal(wornSiege, PRIME_TIME.SIEGE_TITLE, 'a cracked honor siege writes the badge to the title slot');
assert.equal(await cashOf(sgh.id), sghCash, 'an honor siege pays no cash');
assert.equal(await txnCount(), sghTx, 'and the honor siege settle wrote no ledger row');

console.log('primetime: PRIME TIME step one (THE RALLY) + step two (HAPPY HOUR) + step three (THE SIEGE) ok');
await app.close();
process.exit(0);
