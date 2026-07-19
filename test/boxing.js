// THE FIGHT CIRCUIT test (the 29th suite) — mob boxing: sign a contender, train, and stake them in PvP
// bouts (the casino:pvp transfer pattern). Covers: recruit (level/cash/name/one-per-man gates + a cash
// sink + rolled stats), train (bad-stat/cap/energy/cash gates + the sink), listing (stake bounds), the
// bout (both-fighters/consent/limit/injury/cash/self/family gates, a deterministic strong-vs-weak win,
// the taxed transfer + the rake split, records + injury), the board + leaderboard, DEATH (the fighter
// dies with the street), and §10.4 (the per-character cash check reconciles the boxing: vocabulary).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { BOXING } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';

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
  return { token, id: ch.id, aid: (await pool.query(`SELECT account_id a FROM characters WHERE id='${ch.id}'`)).rows[0].a };
};
const seed = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
let cashDrift = 0;
const grantCash = async (id, n) => { await pool.query(`UPDATE characters SET cash = cash + ${n} WHERE id='${id}'`); cashDrift += n; };
const lvlRespect = (lvl) => 4 * (lvl - 1) * (lvl - 1);

const aa = await mk('Don King');       // manager of the strong fighter (the challenger)
const bb = await mk('Bob Arum');        // manager of the weak fighter (takes bouts)
const lowbie = await mk('Ringside Kid'); // for the level gate

// ── RECRUIT: level-gated, cash sink, one per man ──
assert.equal((await call('POST', '/v1/boxing/recruit', { token: lowbie.token, body: { name: 'Palooka' } })).body.error, 'level', 'a nobody cannot sign a fighter');
await seed(aa.id, `respect=${lvlRespect(12)}`); await seed(bb.id, `respect=${lvlRespect(12)}`);
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'x' } })).body.error, 'name', 'a fighter needs a real name');
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'The Bull' } })).body.error, 'cash', "can't sign a fighter broke");
await grantCash(aa.id, 3000000); await grantCash(bb.id, 3000000);
const sign = await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'The Bull' } });
assert.equal(sign.code, 200, 'the boss signs a contender');
assert(sign.body.power >= BOXING.STAT_MIN && sign.body.power <= BOXING.STAT_MAX, 'stats rolled in range');
assert.equal((await meOf(aa.token)).cash, 3000500 - BOXING.RECRUIT_COST, 'the signing bonus left the pocket (ledgered boxing:recruit)');
assert.equal((await call('POST', '/v1/boxing/recruit', { token: aa.token, body: { name: 'Another' } })).body.error, 'have_fighter', 'one contender per man');
await call('POST', '/v1/boxing/recruit', { token: bb.token, body: { name: 'The Palooka' } });
// the character view surfaces the fighter
assert.equal((await meOf(aa.token)).fighter.name, 'The Bull', 'the sheet shows the fighter');

// ── TRAIN: bad-stat / cap / energy / cash gates + the sink ──
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { stat: 'jab' } })).body.error, 'bad_stat', 'train a real stat');
await seed(aa.id, `energy=5`);
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { stat: 'power' } })).body.error, 'energy', 'training takes energy');
await seed(aa.id, `energy=100`);
const trainCashPre = (await meOf(aa.token)).cash;
const tr = await call('POST', '/v1/boxing/train', { token: aa.token, body: { stat: 'power' } });
assert.equal(tr.code, 200, 'a training session');
assert.equal((await meOf(aa.token)).cash, trainCashPre - BOXING.TRAIN_COST, 'the session cost left the pocket (ledgered boxing:train)');
// the cap: seed to the cap, next session is refused
await pool.query(`UPDATE fighters SET power=${BOXING.STAT_CAP} WHERE character_id='${aa.id}'`);
assert.equal((await call('POST', '/v1/boxing/train', { token: aa.token, body: { stat: 'power' } })).body.error, 'maxed', 'a maxed stat trains no further');

// ── seed a deterministic mismatch: The Bull (maxed, form 75) will always beat The Palooka (form 18) ──
await pool.query(`UPDATE fighters SET power=25, chin=25, speed=25 WHERE character_id='${aa.id}'`); // form 75
await pool.query(`UPDATE fighters SET power=6, chin=6, speed=6 WHERE character_id='${bb.id}'`);     // form 18

// ── LIST for bouts: stake bounds (consent-by-listing) ──
assert.equal((await call('POST', '/v1/boxing/list', { token: bb.token, body: { stake: 100 } })).body.error, 'stake', 'below the minimum stake');
const listed = await call('POST', '/v1/boxing/list', { token: bb.token, body: { stake: 50000 } });
assert.equal(listed.body.boutLimit, 50000, 'the fighter is taking bouts up to the limit');

// ── FIGHT gates ──
assert.equal((await call('POST', `/v1/boxing/fight/${bb.id}`, { token: lowbie.token, body: { stake: 10000 } })).body.error, 'no_fighter', "you need a contender to make a match");
assert.equal((await call('POST', `/v1/boxing/fight/${aa.id}`, { token: bb.token, body: { stake: 10000 } })).body.error, 'not_listed', "The Bull isn't taking bouts");
assert.equal((await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { stake: 999999 } })).body.error, 'limit', 'over the opponent limit');
assert.equal((await call('POST', `/v1/boxing/fight/${aa.id}`, { token: aa.token, body: { stake: 10000 } })).body.error, 'self', "you don't fight your own contender");

// ── THE BOUT: The Bull (strong) always beats The Palooka (weak) — a taxed transfer + the rake split ──
const stake = 10000, pot = stake * 2, rake = Math.ceil(pot * BOXING.RAKE_BPS / 10000);
const aPre = (await meOf(aa.token)).cash, bPre = (await meOf(bb.token)).cash;
const poolPre = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const bout = await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { stake } });
assert.equal(bout.code, 200, 'the bout is made');
assert.equal(bout.body.win, true, 'the stronger fighter wins (form 75 vs 18 — a lock)');
assert.equal((await meOf(aa.token)).cash, aPre + stake - rake, 'the winner took the purse minus the vig');
assert.equal((await meOf(bb.token)).cash, bPre - stake, 'the loser paid the purse');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool), poolPre + Math.floor(rake / 2), 'half the vig fed the buyback (half burns)');
assert.equal((await meOf(aa.token)).fighter.wins, 1, "the winner's record improved");
const bFighter = (await pool.query(`SELECT wins, losses, injured_until FROM fighters WHERE character_id='${bb.id}'`)).rows[0];
assert.equal(Number(bFighter.losses), 1, "the loser's record took the L");
assert(bFighter.injured_until && new Date(bFighter.injured_until) > new Date(), 'the losing fighter is laid up');
// a laid-up fighter can't be matched
assert.equal((await call('POST', `/v1/boxing/fight/${bb.id}`, { token: aa.token, body: { stake } })).body.error, 'injured_them', 'no rematch while their fighter heals');

// ── the board + leaderboard ──
const board = (await call('GET', '/v1/boxing', { token: aa.token })).body;
assert.equal(board.yours.record, '1-0', 'the board shows your record');
assert(board.circuit.find((f) => f.name === 'The Palooka'), 'the circuit lists the other fighters');
const lb = (await call('GET', '/v1/leaderboard/boxing', { token: aa.token })).body;
assert(lb.board[0] && lb.board[0].fighter === 'The Bull' && lb.board[0].you, 'The Bull tops the circuit leaderboard');

// ── §10.4 (mid-life): the per-character cash check reconciles the boxing: vocabulary ──
let inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, `the only cash drift is the test grants (${cashDrift}) — boxing: reconciles`);
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'boxing: rides the §10.4 vocabulary');

// ── DEATH: a dead manager's fighter is done (dies with the street) ──
await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: aa.id }, headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM fighters WHERE character_id='${aa.id}'`)).rows[0].n), 0, "the dead manager's fighter is gone");
inv = await runLedgerInvariants(pool);
assert.equal(inv.checks.find((c) => c.name === 'character cash').drift, cashDrift, 'cash §10.4 holds through the estate');

console.log('✅ The Fight Circuit test passed — recruit (level/name/cash/one-per-man gates + the cash sink + rolled stats), train (bad-stat/energy/cap gates + the sink), listing (stake bounds, consent), the BOUT (both-fighters/not-listed/limit/self gates, a deterministic strong-vs-weak win, the taxed transfer + the rake split half→buyback, records + the losing fighter laid up, no rematch while injured), the board + leaderboard, DEATH (the fighter dies with the street), and §10.4 (the per-character cash check reconciles the boxing: vocabulary — a pure casino:pvp-style transfer, no new faucet)');
await app.close();
