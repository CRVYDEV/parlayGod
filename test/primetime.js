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

console.log('primetime: PRIME TIME step one (THE RALLY) ok');
await app.close();
process.exit(0);
