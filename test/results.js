// THE RESULTS SHOW (the payoff beat) — the marquee events resolve in the worker and now (a) write a
// server-wide `event_results` log (the public "what just happened" board) and (b) notify each BETTING
// stakeholder their personalized outcome. This suite proves: the events.js helpers (record + board),
// the keyless /v1/results route, the boxing main event delivering the board row + the bettors' outcome
// notifications (won/lost), and §10.4-NEUTRALITY — a result is a log + a notification, never a ledger row.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { PACING, BOXING } from '../src/rules.js';
import { recordEventResult, resultsBoard } from '../src/events.js';
import { sweepMainEvents } from '../src/boxing.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  const ch = await meOf(token);
  return { token, id: ch.id };
};
const seed = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const grantCash = (id, n) => pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`);
const lvlRespect = (lvl) => PACING.LEVEL_DIVISOR * (lvl - 1) * (lvl - 1);
const notesFor = async (id, type) => (await pool.query(
  "SELECT payload FROM notifications WHERE character_id=$1 AND type=$2 ORDER BY id", [id, type]))
  .rows.map((r) => (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload));
const txCount = async () => Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);

// ════════════ UNIT — recordEventResult writes a log row; resultsBoard reads it newest-first ════════════
{
  const before = await txCount();
  const c = await pool.connect();
  await c.query('BEGIN');
  await recordEventResult(c, { kind: 'poker', icon: '🃏', headline: 'Ace High takes the Tournament', winnerName: 'Ace High', pool: 12345, detail: { runners: 6 } });
  await c.query('COMMIT'); c.release();
  const board = await resultsBoard(pool, 5);
  assert(board.length >= 1, 'the board returns the recorded result');
  assert.equal(board[0].headline, 'Ace High takes the Tournament', 'newest-first, the headline round-trips');
  assert.equal(board[0].pool, 12345, 'the pool round-trips');
  assert.equal(board[0].winner, 'Ace High', 'the winner round-trips');
  assert(board[0].agoSeconds >= 0, 'a fresh result reads ~0s ago');
  assert.equal(await txCount(), before, '§10.4: recording a result writes ZERO ledger rows — a log, not a ledger');
}

// ════════════ ROUTE — /v1/results is a keyless public board ════════════
{
  const r = await call('GET', '/v1/results');           // no token
  assert.equal(r.code, 200, 'the results board is keyless (a spectator surface, no private data)');
  assert(Array.isArray(r.body.results) && r.body.results.length >= 1, 'the public board carries the recorded results');
}

// ════════════ INTEGRATION — a boxing main event delivers the board row + the bettors' outcome beats ════════════
const cc = await mk('Don King'), dd = await mk('Bob Arum');
await seed(cc.id, `respect=${lvlRespect(12)}`); await seed(dd.id, `respect=${lvlRespect(12)}`);
await grantCash(cc.id, 3000000); await grantCash(dd.id, 3000000);
const goliath = (await call('POST', '/v1/boxing/recruit', { token: cc.token, body: { name: 'Goliath' } })).body.id;
const david = (await call('POST', '/v1/boxing/recruit', { token: dd.token, body: { name: 'David' } })).body.id;
await pool.query(`UPDATE fighters SET power=25,chin=25,speed=25 WHERE id='${goliath}'`); // form 75 — a lock
await pool.query(`UPDATE fighters SET power=6,chin=6,speed=6 WHERE id='${david}'`);        // form 18
await call('POST', '/v1/boxing/list', { token: dd.token, body: { fighter: david, stake: 50000 } });
const boutId = (await call('POST', `/v1/boxing/announce/${dd.id}`, { token: cc.token, body: { myFighter: goliath, theirFighter: david } })).body.bout;

// the crowd bets — two on the lock (Goliath), one on the underdog (David → loses)
const winner = await mk('Sharp Bettor'), loser = await mk('Sucker Bettor');
await grantCash(winner.id, 500000); await grantCash(loser.id, 500000);
const winStake = 20000, loseStake = 40000;
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: winner.token, body: { fighter: goliath, amount: winStake } })).code, 200, 'the sharp backs the lock');
assert.equal((await call('POST', `/v1/boxing/bout/${boutId}/bet`, { token: loser.token, body: { fighter: david, amount: loseStake } })).code, 200, 'the sucker backs the underdog');

// close the window (SQL clock warp) + resolve via the worker
await pool.query(`UPDATE boxing_bouts SET resolves_at = now() - interval '1 hour' WHERE id='${boutId}'`);
const txPre = await txCount();
const swept = await sweepMainEvents(pool);
assert.equal(swept.resolved, 1, 'the worker resolved the card');

// (a) THE BOARD — a server-wide 'boxing' result row, newest-first, with the headline naming the winner
const board = await resultsBoard(pool, 5);
const bx = board.find((r) => r.kind === 'boxing');
assert(bx, 'a boxing result landed on the public board');
assert(/Goliath/.test(bx.headline) && /Main Event/.test(bx.headline), 'the headline names the winner + the event');
assert.equal(bx.winner, 'Goliath', 'the winner is recorded');
assert.equal(bx.pool, winStake + loseStake, 'the pool is the crowd total');

// (b) THE PERSONAL BEAT — each bettor got an event_result notification with their real outcome
const winNotes = await notesFor(winner.id, 'event_result');
assert.equal(winNotes.length, 1, 'the winning bettor got exactly one result beat');
assert.equal(winNotes[0].outcome, 'won', 'their outcome is a win');
assert.equal(winNotes[0].stake, winStake, 'the beat carries their stake');
assert(winNotes[0].payout > winStake, 'a winning bettor is paid MORE than their stake (stake back + the losers, net of vig)');
assert.equal(winNotes[0].kind, 'boxing', 'the beat is tagged boxing so the client can theme it');
const loseNotes = await notesFor(loser.id, 'event_result');
assert.equal(loseNotes.length, 1, 'the losing bettor got one result beat too');
assert.equal(loseNotes[0].outcome, 'lost', 'their outcome is a loss');
assert.equal(loseNotes[0].payout, 0, 'a losing bettor is paid nothing');

// (c) §10.4-NEUTRAL — the boxing payout ledger rows are pre-existing (bet:win/take/etc.); the RESULTS
// SHOW itself (recordEventResult + the notifies) introduced NO 'result' reason to the ledger.
const resultReasons = Number((await pool.query("SELECT COUNT(*) n FROM transactions WHERE reason ILIKE '%result%'")).rows[0].n);
assert.equal(resultReasons, 0, 'no ledger reason mentions a result — a result is a log + a notification, never value');
assert(await txCount() >= txPre, 'the boxing payout ledgered as before (unchanged by the results layer)');

console.log('results: PASS');
await app.close();
process.exit(0);
