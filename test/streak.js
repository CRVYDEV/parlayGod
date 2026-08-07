// THE STREAK — the daily-login habit loop.
//
// Claim once a day; the cash escalates with the consecutive-day run (capped at MAX_DAY's value), a gap
// RESETS the run to 1, and the lifetime longest run (streak_best) is a status legend on a leaderboard.
// ACCOUNT-level → survives death. The centre of the test: the escalating reward, the consecutive/gap
// logic, the reward CAP (the run climbs, the cash flattens), and that the ONLY value that moves is the
// ledgered `streak:daily` faucet.
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { STREAK, streakReward, dayOf } from '../src/rules.js';

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
const acctOf = async (id) => (await pool.query('SELECT account_id a FROM characters WHERE id=$1', [id])).rows[0].a;
// seed the ACCOUNT streak state (login_day/login_streak are account-level status, not cash) to stand in
// for "the last claim was N days ago" — the only way to exercise consecutive/gap without warping time
const setDay = (acct, day, streak) => pool.query('UPDATE account_persistent SET login_day=$2, login_streak=$3 WHERE account_id=$1', [acct, day, streak]);
const driftOf = async (name) => Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === name).drift);

const p = await mk('Streak Guy');
const acct = await acctOf(p.id);
const today = dayOf();

// ════════════ the board before any claim — today pays day-1 ════════════
let b = (await call('GET', '/v1/streak', { token: p.token })).body;
assert.equal(b.claimedToday, false, 'not claimed yet');
assert.equal(b.streak, 0, 'no run yet');
assert.equal(b.todayReward, STREAK.REWARDS[0], 'today pays the day-1 reward');
assert.equal(b.best, 0, 'no best yet');

// ════════════ first claim — run 1, paid the day-1 reward, ledgered ════════════
const before = await driftOf('character cash');
let r = (await call('POST', '/v1/streak/claim', { token: p.token })).body;
assert.equal(r.streak, 1, 'the first claim is run 1');
assert.equal(r.cash, STREAK.REWARDS[0], 'paid exactly the day-1 reward');
assert.equal(r.best, 1, 'best is 1');
assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason='streak:daily'")).rows[0].n), 1, 'the reward is a ledgered streak:daily faucet');

// ════════════ once a day ════════════
assert.equal((await call('POST', '/v1/streak/claim', { token: p.token })).body.error, 'claimed', "you can't claim twice in a day");

// ════════════ a CONSECUTIVE day climbs the run + escalates the reward ════════════
await setDay(acct, today - 1, 1);   // last claim was yesterday, run 1
r = (await call('POST', '/v1/streak/claim', { token: p.token })).body;
assert.equal(r.streak, 2, 'a consecutive day is run 2');
assert.equal(r.cash, STREAK.REWARDS[1], 'and the reward escalates to day 2');

// ════════════ a GAP resets the run to 1 ════════════
await setDay(acct, today - 3, 5);   // last claim was 3 days ago, run had been 5
r = (await call('POST', '/v1/streak/claim', { token: p.token })).body;
assert.equal(r.streak, 1, 'a missed day resets the run to 1');
assert.equal(r.cash, STREAK.REWARDS[0], 'back to the day-1 reward');

// ════════════ the reward CAPS at MAX_DAY — the run keeps climbing (the legend), the cash flattens ════════════
await setDay(acct, today - 1, STREAK.MAX_DAY);   // yesterday, run already at the cap
r = (await call('POST', '/v1/streak/claim', { token: p.token })).body;
assert.equal(r.streak, STREAK.MAX_DAY + 1, 'the run climbs past the cap (the legend keeps counting)');
assert.equal(r.cash, streakReward(STREAK.MAX_DAY + 1), 'but the reward is the capped value');
assert.equal(r.cash, STREAK.REWARDS[STREAK.MAX_DAY - 1], 'the cap is the last reward in the table');
assert.equal(r.best, STREAK.MAX_DAY + 1, 'best tracks the high-water run');

// ════════════ the board reflects claimed-today + best/rank ════════════
b = (await call('GET', '/v1/streak', { token: p.token })).body;
assert.equal(b.claimedToday, true, 'the board knows today is done');
assert.equal(b.best, STREAK.MAX_DAY + 1, 'the best is surfaced');
assert.ok(b.rank, 'a rank is surfaced');

// ════════════ THE LEADERBOARD — by lifetime best; agents excluded ════════════
const lb = (await call('GET', '/v1/leaderboard/streak', { token: p.token })).body;
assert.equal(lb.some((x) => x.best === STREAK.MAX_DAY + 1), true, 'the player is on the streak board with their best');
{
  const bot = await mk('Streak Bot');
  await pool.query('UPDATE account_persistent SET agent_flag=true WHERE account_id=$1', [await acctOf(bot.id)]);
  await call('POST', '/v1/streak/claim', { token: bot.token });
  const lb2 = (await call('GET', '/v1/leaderboard/streak', { token: p.token })).body;
  assert.equal(lb2.some((x) => x.name === 'Streak Bot'), false, 'an agent is off the streak board');
}

// ════════════ §10.4 — every reward is a ledgered faucet ════════════
assert.equal(await driftOf('character cash'), before, 'the cash identity holds — every streak reward is a ledgered faucet');
{
  const vocab = (await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'reason vocabulary');
  assert.equal(vocab.ok, true, 'streak:daily is a recognized reason — no unknown-reason alarm');
}

console.log('streak: PASS');
await app.close();
process.exit(0);
