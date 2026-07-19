// R1 — THE PORTFOLIO ("going legit") test — the RWA/blue-chip holdings layer. Covers: the market
// board (deterministic seed price + day-change), personal invest (share math + the ledgered
// 'rwa:invest' $OMR burn + bucket accounting), the ticker/amount gates, family invest (rank gate,
// empty-reserve rejection, reserve debit + ledger), DEATH SURVIVAL (the heir keeps the account-level
// book — the retirement fantasy), the leaderboard, and the §10.4 vocabulary + burn reconciliation.
// pg-mem, zero infra. SQL-granting $OMR is an unledgered mint (the skills.js precedent), so the
// $OMR-conservation DRIFT stays exactly the grant — proving rwa:invest reconciles as a burn, not the
// grant leaking through it.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { PORTFOLIO, tickerPriceOf, dayOf } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { runSeasonRollover } from '../src/worker.js';

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
const acctOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);

let grantDrift = 0; // running tally of every unledgered SQL $OMR grant (the only legit drift)

const boss = await mk('Legit Larry');   // the personal investor + a boss
const soldier = await mk('Grunt Gary');  // a non-boss member (rank gate)
const nobody = await mk('Broke Bob');    // no omr

// ── the market board: deterministic seed price, matches rules, day-change present ──
let r = await call('GET', '/v1/portfolio', { token: boss.token });
assert.equal(r.code, 200, 'the board is readable');
assert.equal(r.body.market.length, PORTFOLIO.TICKERS.length, 'every ticker on the board');
for (const m of r.body.market)
  assert.equal(m.price, tickerPriceOf(m.ticker, dayOf()), `${m.ticker} price is the server-authoritative daily seed price`);
assert.equal(r.body.portfolio.bookValue, 0, 'an empty book is worth nothing');
assert(typeof r.body.market[0].dayChange === 'number', 'day-over-day change surfaced');

// ── personal invest: share math + the ledgered $OMR burn ──
await acctOmr(boss.id, 10000); grantDrift += 10000;
const priceA = tickerPriceOf('AAPL', dayOf());
r = await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'AAPL', omr: 3000 } });
assert.equal(r.code, 200, 'invested in AAPL');
assert.equal(r.body.bought, Math.round((3000 / priceA) * 1e6) / 1e6, 'shares = omr / price (fractional)');
assert.equal(r.body.shares, r.body.bought, 'first buy, so total == bought');
// the $OMR left the account (a burn) and the ledger row is exact
assert.equal((await meOf(boss.token)).omr, 7000, 'the burn debited the account bucket by exactly the spend');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='rwa:invest'")).rows[0].s), -3000, 'the burn is ledgered rwa:invest');
// the character view carries the book
let me = await meOf(boss.token);
assert.equal(me.portfolio.holdings.length, 1, 'the view shows the holding');
assert.equal(me.portfolio.bookValue, Math.round(r.body.bought * priceA * 100) / 100, 'view book value at today\'s price');

// a second buy of the same ticker averages in
r = await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'AAPL', omr: 1000 } });
assert.equal(r.body.shares, Math.round(((3000 + 1000) / priceA) * 1e6) / 1e6, 'shares accumulate');
assert.equal(r.body.costBasis, 4000, 'cost basis is lifetime $OMR spent');

// a different ticker is its own line
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'SPCX', omr: 2000 } })).code, 200, 'bought the moonshot too');
r = await call('GET', '/v1/portfolio', { token: boss.token });
assert.equal(r.body.portfolio.holdings.length, 2, 'two lines on the book');
assert.equal(r.body.portfolio.costBasis, 6000, 'total cost basis across lines');

// ── the gates ──
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'NVDA', omr: 100 } })).body.error, 'ticker', 'no such stock');
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'AAPL', omr: 0 } })).body.error, 'amount', 'no dust buys');
assert.equal((await call('POST', '/v1/portfolio/invest', { token: nobody.token, body: { ticker: 'AAPL', omr: 100 } })).body.error, 'omr', 'no $OMR, no shares');

// ── the family book: rank gate, empty-reserve rejection, reserve debit + ledger ──
await pool.query(`UPDATE characters SET respect=2304, cash=100000 WHERE id='${boss.id}'`); // lvl 25 + founding cash
await pool.query(`UPDATE characters SET respect=2304 WHERE id='${soldier.id}'`);
const gangId = (await call('POST', '/v1/gangs', { token: boss.token, body: { name: 'The Blue Chips', tag: 'CHIP' } })).body.gangId;
assert(gangId, 'family founded');
await call('POST', `/v1/gangs/${gangId}/join`, { token: soldier.token });
assert.equal((await call('POST', '/v1/gangs/portfolio/invest', { token: soldier.token, body: { ticker: 'TSLA', omr: 100 } })).body.error, 'rank', 'a soldier does not spend the family money');
assert.equal((await call('POST', '/v1/gangs/portfolio/invest', { token: boss.token, body: { ticker: 'TSLA', omr: 5000 } })).body.error, 'reserve', 'an empty reserve buys nothing');
// seed the family $OMR reserve (unledgered grant → tallied into the expected drift)
await pool.query(`UPDATE gangs SET omr_reserve = 8000 WHERE id='${gangId}'`); grantDrift += 8000;
const priceT = tickerPriceOf('TSLA', dayOf());
r = await call('POST', '/v1/gangs/portfolio/invest', { token: boss.token, body: { ticker: 'TSLA', omr: 5000 } });
assert.equal(r.code, 200, 'the boss invests the family money');
assert.equal(r.body.reserve, 3000, 'the reserve paid for it');
assert.equal(r.body.bought, Math.round((5000 / priceT) * 1e6) / 1e6, 'family shares = omr / price');
assert.equal(Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve), 3000, 'reserve debited on the row');
// the family book surfaces on GET /v1/gangs/:id
const gv = (await call('GET', `/v1/gangs/${gangId}`)).body.gang;
assert.equal(gv.portfolio.holdings.length, 1, 'the family book shows on the gang page');
assert.equal(gv.portfolio.holdings[0].ticker, 'TSLA', 'the family holds TSLA');

// ── DEATH SURVIVAL: the legit book is account-level, so the heir keeps it (the retirement fantasy) ──
const bookBefore = (await call('GET', '/v1/portfolio', { token: boss.token })).body.portfolio;
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: boss.id },
  headers: { 'x-mod-key': 'test-mod-key' } });
assert.equal(kill.statusCode, 200, 'the boss is retired');
const heir = await meOf(boss.token);
assert.notEqual(heir.id, boss.id, 'a new street — the man is dead');
assert.equal(heir.portfolio.holdings.length, bookBefore.holdings.length, 'the heir inherits the legit book — untouchable by death');
assert.equal(heir.portfolio.bookValue, bookBefore.bookValue, 'and every share of it');

// ── the leaderboard: the biggest legit book leads ──
r = await call('GET', '/v1/leaderboard/portfolio', { token: soldier.token });
assert.equal(r.code, 200, 'the board is public');
assert(r.body.board.length >= 1, 'the investor is on it');
assert.equal(r.body.board[0].name, heir.name, 'the heir\'s book leads (it carried over)');
assert(r.body.board[0].bookValue > 0, 'valued at the daily price');

// ── STEP TWO (1) — the RICO GRADUATION: a BIG legit move draws heat + is safehouse-blocked ──
const whale = await mk('Made Man Moe');
await acctOmr(whale.id, 6000); grantDrift += 6000;
await pool.query(`UPDATE characters SET heat=0, safe_until=NULL WHERE id='${whale.id}'`);
r = await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR } });
assert.equal(r.code, 200, 'a big legit move goes through');
assert.equal(r.body.scrutiny, true, 'but it draws scrutiny');
assert((await meOf(whale.token)).heat > 0, 'the paper trail raised heat');
// a small buy flies under the radar (no scrutiny flag)
assert.equal((await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR - 1 } })).body.scrutiny, false, 'small buys go unnoticed');
// a big move from a safehouse is blocked (P1.3 — hiding, not moving money); a small one is fine
await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${whale.id}'`);
assert.equal((await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR } })).body.error, 'safe', 'no big legit moves from the safehouse');
assert.equal((await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: 10 } })).code, 200, 'a small buy still flies under the radar');

// ── STEP TWO (2) — the SEASON PRIZE: the top season grinder earns the champion's moonshot (SPCX) ──
const champ = await mk('Season King Sal');
const cur = Math.floor(dayOf() / 28);
await pool.query(`UPDATE characters SET respect=9999, season=${cur - 1} WHERE id='${champ.id}'`);
const before = (await pool.query(`SELECT COALESCE(SUM(shares),0) s FROM portfolios p JOIN characters c ON c.account_id=p.account_id WHERE c.id='${champ.id}' AND p.ticker='SPCX'`)).rows[0].s;
await runSeasonRollover(pool, { season: cur });
const spcx = Number((await pool.query(`SELECT COALESCE(SUM(shares),0) s FROM portfolios p JOIN characters c ON c.account_id=p.account_id WHERE c.id='${champ.id}' AND p.ticker='SPCX'`)).rows[0].s);
assert(spcx > Number(before), 'the season\'s top grinder was granted SPCX at rollover (a skill-ranked status prize — no $OMR spent)');
assert.equal(spcx, Math.round((PORTFOLIO.SEASON_PRIZES[0] / tickerPriceOf('SPCX')) * 1e6) / 1e6, 'rank-1 prize = SEASON_PRIZES[0] $OMR-worth of SPCX');

// ── §10.4: rwa:invest is a recognized burn; the ONLY drift is the unledgered SQL grants ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `rwa: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test's unledgered grants (${grantDrift}) — rwa:invest reconciles as a burn, not a leak`);

console.log('✅ Portfolio (R1 "going legit") test passed — the market board (deterministic seed price + day-change), personal invest (fractional share math + ledgered rwa:invest $OMR burn + bucket accounting + averaging), ticker/amount/no-omr gates, the family book (rank gate, empty-reserve rejection, reserve debit + ledger + gang-page surfacing), DEATH SURVIVAL (the heir keeps the account-level book), the status leaderboard, and §10.4 (rwa: vocabulary + burn reconciles — drift == the test grant only)');
await app.close();
