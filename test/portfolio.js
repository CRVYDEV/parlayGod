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
// the full $OMR left the account; of it, DIVIDEND_BPS funded the dividend pool (a transfer) and the
// rest burned (rwa:invest) — the Dynasty Fund split
assert.equal((await meOf(boss.token)).omr, 7000, 'the account paid the full spend (3000)');
const divCut = Math.floor(3000 * PORTFOLIO.DIVIDEND_BPS / 10000);
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='rwa:invest'")).rows[0].s), -(3000 - divCut), 'the burn portion is ledgered rwa:invest');
assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='dividend:fund'")).rows[0].s), -divCut, 'the dividend slice is a ledgered dividend:fund transfer');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), divCut, 'and it landed in the dividend pool');
// the character view carries the book
let me = await meOf(boss.token);
assert.equal(me.portfolio.holdings.length, 1, 'the view shows the holding');
assert.equal(me.portfolio.bookValue, Math.round(r.body.bought * priceA * 100) / 100, 'view book value at today\'s price');

// a second buy of the same ticker averages in. The server rounds EACH buy's shares to 6dp then
// sums (round6(cur + round6(amt/price))), so the expectation must add the per-buy rounded shares —
// NOT round6(total/price), which differs by 1 ULP on some days' prices (an otherwise date-flaky equality).
const bought1 = r.body.bought;
r = await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'AAPL', omr: 1000 } });
assert.equal(r.body.shares, Math.round((bought1 + r.body.bought) * 1e6) / 1e6, 'shares accumulate');
assert.equal(r.body.costBasis, 4000, 'cost basis is lifetime $OMR spent');

// a different ticker is its own line
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'SPCX', omr: 2000 } })).code, 200, 'bought the moonshot too');
r = await call('GET', '/v1/portfolio', { token: boss.token });
assert.equal(r.body.portfolio.holdings.length, 2, 'two lines on the book');
assert.equal(r.body.portfolio.costBasis, 6000, 'total cost basis across lines');

// ── the gates ──
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'ZZZZ', omr: 100 } })).body.error, 'ticker', 'no such stock');
assert.equal((await call('POST', '/v1/portfolio/invest', { token: boss.token, body: { ticker: 'AAPL', omr: 0 } })).body.error, 'amount', 'no dust buys');
assert.equal((await call('POST', '/v1/portfolio/invest', { token: nobody.token, body: { ticker: 'AAPL', omr: 100 } })).body.error, 'omr', 'no $OMR, no shares');

// ── the family book: rank gate, empty-reserve rejection, reserve debit + ledger ──
await pool.query(`UPDATE characters SET respect=5760, cash=100000 WHERE id='${boss.id}'`); // lvl 25 + founding cash
await pool.query(`UPDATE characters SET respect=5760 WHERE id='${soldier.id}'`);
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

// ── FAMILY DIVIDEND (Dynasty step two): the gang book yields to the RESERVE, boss/underboss only ──
const famBoard = (await call('GET', '/v1/portfolio', { token: boss.token })).body.family;
assert(famBoard.dividend, 'the family dividend surfaces on the board');
assert.equal(famBoard.dividend.claimable, true, 'the boss can draw it (book funded, no cooldown)');
assert.equal((await call('POST', '/v1/gangs/portfolio/dividend', { token: soldier.token })).body.error, 'rank', 'a soldier does not draw the family dividend');
const gResBefore = Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve);
const gPoolBefore = Number((await pool.query('SELECT pool FROM rwa_family_dividend_pool WHERE id=1')).rows[0].pool);
assert(gPoolBefore > 0, 'the SEPARATE family pool was fed by the family invest (audit MED: reserve $OMR never reaches the personal pool)');
const famDiv = await call('POST', '/v1/gangs/portfolio/dividend', { token: boss.token });
assert.equal(famDiv.code, 200, 'the boss drew the family dividend');
assert(famDiv.body.paid > 0, 'it paid $OMR into the reserve');
assert.equal(Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve), gResBefore + famDiv.body.paid, 'the reserve grew by exactly the dividend');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_family_dividend_pool WHERE id=1')).rows[0].pool), Math.round((gPoolBefore - famDiv.body.paid) * 1e6) / 1e6, 'paid from the FAMILY pool (a transfer, not a mint)');
assert.equal((await call('POST', '/v1/gangs/portfolio/dividend', { token: boss.token })).body.error, 'cooldown', 'the family dividend pays about once a day');

// ── FAMILY DYNASTY (F4): name the fund + the crest tier + the family-legit leaderboard ──
assert.equal((await call('POST', '/v1/gangs/portfolio/name', { token: soldier.token, body: { name: 'The Empire' } })).body.error, 'rank', 'a soldier does not name the family fund');
const gResPreName = Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve);
const fn = await call('POST', '/v1/gangs/portfolio/name', { token: boss.token, body: { name: 'The Blue Chip Fund' } });
assert.equal(fn.code, 200, 'the boss named the family fund');
assert.equal(Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve), gResPreName - PORTFOLIO.FAMILY_DYNASTY_NAME_OMR, 'the naming burned from the reserve');
assert.equal((await pool.query(`SELECT dynasty_name FROM gangs WHERE id='${gangId}'`)).rows[0].dynasty_name, 'The Blue Chip Fund', 'the fund name took');
const fBoard = (await call('GET', '/v1/portfolio', { token: boss.token })).body.family;
assert.equal(fBoard.fundName, 'The Blue Chip Fund', 'the board shows the fund name');
assert(fBoard.crest, 'the family crest tier is surfaced (family invested 5000 → a tier)');
assert.equal(fBoard.invested, 5000, 'cumulative family invested tracked');
const flb = (await call('GET', '/v1/leaderboard/family-portfolio', { token: boss.token })).body;
assert(flb.board.find((e) => e.name === 'The Blue Chip Fund'), 'the fund heads the family-legit leaderboard');
// MED-1 regression: re-naming to the SAME name is a no-op that must NOT re-burn the shared reserve
const gResPreNoop = Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve);
assert.equal((await call('POST', '/v1/gangs/portfolio/name', { token: boss.token, body: { name: 'The Blue Chip Fund' } })).body.error, 'same', 'a same-name re-name is refused');
assert.equal(Number((await pool.query(`SELECT omr_reserve FROM gangs WHERE id='${gangId}'`)).rows[0].omr_reserve), gResPreNoop, 'the no-op re-name burned nothing from the reserve');
// LOW-2 coverage: an empty reserve is rejected (drain it §10.4-cleanly — an unledgered negative grant, tallied)
await pool.query(`UPDATE gangs SET omr_reserve=0 WHERE id='${gangId}'`); grantDrift -= gResPreNoop; // destroying reserve $OMR is a negative grant
assert.equal((await call('POST', '/v1/gangs/portfolio/name', { token: boss.token, body: { name: 'Broke Money' } })).body.error, 'reserve', 'an empty reserve cannot name the fund');

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

// ── THE DYNASTY: the account-level book is generational — name it (a $OMR vanity sink; the name heads the board) ──
await acctOmr(heir.id, 10); grantDrift += 10;
let dyn = (await call('GET', '/v1/portfolio', { token: boss.token })).body.dynasty;
assert.equal(dyn.name, null, 'the dynasty starts unnamed');
assert(dyn.generation >= 2, 'the bloodline has weathered a death — generation ≥ 2');
const omrPre = (await meOf(boss.token)).omr;
r = await call('POST', '/v1/dynasty/name', { token: boss.token, body: { name: 'The Medici' } });
assert.equal(r.code, 200, 'the dynasty is named'); assert.equal(r.body.spent, PORTFOLIO.DYNASTY_NAME_OMR, 'a $OMR vanity sink');
assert.equal((await meOf(boss.token)).omr, omrPre - PORTFOLIO.DYNASTY_NAME_OMR, 'the naming fee burned from the account');
assert.equal((await call('GET', '/v1/portfolio', { token: boss.token })).body.dynasty.name, 'The Medici', 'the book carries the dynasty name');
assert.equal((await call('GET', '/v1/leaderboard/portfolio', { token: soldier.token })).body.board[0].name, 'The Medici', 'the dynasty name heads the legit-legend board');
assert.equal((await call('POST', '/v1/dynasty/name', { token: boss.token, body: { name: 'x' } })).body.error, 'name', 'a too-short name is rejected');

// ── STEP TWO (1) — the RICO GRADUATION + audit F1 (STRUCTURING is caught) + F4 (jail gate) ──
const whale = await mk('Made Man Moe');
await acctOmr(whale.id, 6000); grantDrift += 6000;
await pool.query(`UPDATE characters SET heat=0, safe_until=NULL, rwa_used=0, rwa_at=NULL WHERE id='${whale.id}'`);
// a single SMALL buy flies under the radar
r = await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR - 1 } });
assert.equal(r.body.scrutiny, false, 'one small buy goes unnoticed');
assert.equal((await meOf(whale.token)).heat, 0, 'no heat under the radar');
// STRUCTURING: a SECOND sub-threshold buy crosses the ROLLING-WINDOW sum → scrutiny trips (F1 fix —
// the per-call-only threshold used to let 999-on-repeat convert unlimited $OMR heat-free)
r = await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR - 1 } });
assert.equal(r.body.scrutiny, true, 'structuring is caught — the windowed sum crossed the line');
assert((await meOf(whale.token)).heat > 0, 'the paper trail finally raised heat');
// once flagged (windowed sum still over), even a small follow-up from a safehouse is blocked (P1.3)
await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${whale.id}'`);
assert.equal((await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: 10 } })).body.error, 'safe', 'no moving money into fronts from a safehouse once under the microscope');
// F4 — a jailed player can't invest at all (consistency with other extraction-adjacent acts)
await pool.query(`UPDATE characters SET safe_until=NULL, jail_until = now() + interval '1 hour' WHERE id='${whale.id}'`);
assert.equal((await call('POST', '/v1/portfolio/invest', { token: whale.token, body: { ticker: 'AAPL', omr: 10 } })).body.error, 'jailed', "can't move money into fronts from a cell");
// a FRESH account: a single BIG buy trips scrutiny at once
const bigshot = await mk('Big Sal');
await acctOmr(bigshot.id, 3000); grantDrift += 3000;
assert.equal((await call('POST', '/v1/portfolio/invest', { token: bigshot.token, body: { ticker: 'AAPL', omr: PORTFOLIO.SCRUTINY_MIN_OMR } })).body.scrutiny, true, 'a single big move trips it immediately');

// ── STEP TWO (2) — the SEASON PRIZE: the top season grinder earns the champion's moonshot (SPCX) ──
const champ = await mk('Season King Sal');
const cur = Math.floor(dayOf() / 28);
await pool.query(`UPDATE characters SET respect=24998, season=${cur - 1} WHERE id='${champ.id}'`);
const before = (await pool.query(`SELECT COALESCE(SUM(shares),0) s FROM portfolios p JOIN characters c ON c.account_id=p.account_id WHERE c.id='${champ.id}' AND p.ticker='SPCX'`)).rows[0].s;
await runSeasonRollover(pool, { season: cur });
const spcx = Number((await pool.query(`SELECT COALESCE(SUM(shares),0) s FROM portfolios p JOIN characters c ON c.account_id=p.account_id WHERE c.id='${champ.id}' AND p.ticker='SPCX'`)).rows[0].s);
assert(spcx > Number(before), 'the season\'s top grinder was granted SPCX at rollover (a skill-ranked status prize — no $OMR spent)');
assert.equal(spcx, Math.round((PORTFOLIO.SEASON_PRIZES[0] / tickerPriceOf('SPCX')) * 1e6) / 1e6, 'rank-1 prize = SEASON_PRIZES[0] $OMR-worth of SPCX');

// ── THE DYNASTY FUND (dividends + tiers) ──
// the status TIER: boss invested 4000 personal → Blue Blood (min 2500), next is Old Money (10000)
let board = (await call('GET', '/v1/portfolio', { token: boss.token })).body;
assert.equal(board.dynasty.invested, 6000, 'cumulative invested tracked (3000 + 1000 + 2000)');
assert.equal(board.dynasty.tier.name, 'Blue Blood', 'crossed the tier-3 floor');
assert.equal(board.dynasty.nextTier.name, 'Old Money', 'the next rung is named');
// the dividend: the pool is fed by every personal invest; a claim pays min(book × rate, pool)
assert(board.dividend.pool > 0, 'the dividend pool was fed by the invests');
assert.equal(board.dividend.claimable, true, 'a holder can claim (no cooldown yet)');
const omrPreDiv = (await meOf(boss.token)).omr;
const poolPre = Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool);
let dr = await call('POST', '/v1/portfolio/dividend', { token: boss.token });
assert.equal(dr.code, 200, 'claimed the dividend');
assert(dr.body.paid > 0, 'the dividend paid $OMR');
assert.equal((await meOf(boss.token)).omr, omrPreDiv + dr.body.paid, 'the yield landed in the account');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), Math.round((poolPre - dr.body.paid) * 1e6) / 1e6, 'paid from the pool (a transfer, not a mint)');
// the ~daily cooldown blocks an immediate re-claim
assert.equal((await call('POST', '/v1/portfolio/dividend', { token: boss.token })).body.error, 'cooldown', 'the dividend pays about once a day');
// cross-system audit HIGH: a FREE granted book (cost_omr=0 — the heist cut / season prize) earns NO
// dividend — the yield is on invested principal, so a free-rider can't skim the pool investors fill
const freebie = await mk('Freebie Fred');
const ffid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${freebie.id}'`)).rows[0].a;
await pool.query(`INSERT INTO portfolios (account_id, ticker, shares, cost_omr) VALUES ('${ffid}','AAPL',50,0)`); // a granted book, cost basis 0
const ffBoard = (await call('GET', '/v1/portfolio', { token: freebie.token })).body;
assert(ffBoard.portfolio.bookValue > 0, 'the free grant has market book value (a status holding)');
assert.equal(ffBoard.dividend.claimable, false, 'but it is NOT dividend-claimable (no invested basis)');
assert.equal((await call('POST', '/v1/portfolio/dividend', { token: freebie.token })).body.error, 'nothing', 'a free-grant book earns no dividend — the yield is on invested principal only');
// the DRY-pool refusal — drained the §10.4-clean way (a whale claims the pool empty via a ledgered
// transfer; shares aren't §10.4 currency, so the big book is a status grant with no ledger row)
const drainer = await mk('Vault Vic');
const daid = (await pool.query(`SELECT account_id a FROM characters WHERE id='${drainer.id}'`)).rows[0].a;
// cost_omr is NOT a §10.4 currency (just the invested-basis metric the dividend now accrues on) — seed a
// huge basis so gross > pool and the whale drains it via a legit ledgered transfer (audit HIGH: the yield
// is on invested principal, so a cost_omr=0 free-grant book would earn NOTHING — that's the point)
await pool.query(`INSERT INTO portfolios (account_id, ticker, shares, cost_omr) VALUES ('${daid}','GLD',100000,10000000)`);
assert(Number((await call('POST', '/v1/portfolio/dividend', { token: drainer.token })).body.paid) > 0, 'the whale drew a dividend');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), 0, 'the whale drained the pool (a ledgered transfer, not a mint)');
// a fresh holder now finds it dry — a clean refusal, not a wasted claim (the cooldown isn't burned)
const latecomer = await mk('Late Larry');
await acctOmr(latecomer.id, 200); grantDrift += 200;
await call('POST', '/v1/portfolio/invest', { token: latecomer.token, body: { ticker: 'GLD', omr: 100 } }); // re-funds the pool a little
await pool.query(`UPDATE account_persistent SET dividend_at=NULL WHERE account_id='${daid}'`); // reset the whale's cooldown to drain it again
await call('POST', '/v1/portfolio/dividend', { token: drainer.token });
assert.equal((await call('POST', '/v1/portfolio/dividend', { token: latecomer.token })).body.error, 'dry', 'a dry pool is a clean refusal');

// ═══ THE FLOAT (omerta-rwa-float-design.md) — the full-reserve VAULTED book ═══
// ETH tax revenue → buyback → real units held → players burn $OMR to claim allocation.
// allocated ≤ held BY CONSTRUCTION; spend ≤ revenue; the burn rides rwa:% (§10.4 clean).
{
  const modCall = (method, url, payload) => app.inject({ method, url, payload, headers: { 'x-mod-key': 'test-mod-key' } });
  // no revenue yet → the buy bot has no budget (the anti-Ponzi root cap)
  let b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 0.5, priceEth: 0.001 });
  assert.equal(b.json().error, 'over_budget', 'the float can only spend what the taxes brought in');
  // 1.0 ETH of tax revenue lands (out-of-band real-value accounting — the vig/bond test precedent)
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('store','float-test-1',1.0)");
  b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 0.5, priceEth: 0.001 });
  assert.equal(b.statusCode, 200, `the buyback lands: ${b.body}`);
  assert.equal(b.json().units, 500, 'eth / price = units into the reserve');
  assert.equal(b.json().real, false, 'no txHash → a SIMULATED buy (flagged, never claimed as real)');
  b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 0.6, priceEth: 0.001 });
  assert.equal(b.json().error, 'over_budget', 'spend ≤ revenue holds on the margin (0.5 left, 0.6 refused)');
  // the board shows the float
  const claimer = await mk('Vault Vinny');
  await acctOmr(claimer.id, 2000); grantDrift += 2000;
  // MINTED-ONLY (AUDIT-rwa-float #2): the float is the on-ramp to the KYC-gated extraction, so a
  // claiming identity must have paid the mint fee — the Street Wage D1 anti-Sybil precedent.
  r = await call('POST', '/v1/vault/claim', { token: claimer.token, body: { ticker: 'AAPL', omr: 50 } });
  assert.equal(r.body.error, 'mint', 'a free-trial character cannot claim from the float');
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${claimer.id}')`);
  let vb = (await call('GET', '/v1/vault', { token: claimer.token })).body;
  const aapl = vb.float.find((f) => f.ticker === 'AAPL');
  assert.equal(aapl.held, 500, 'the float shows held units');
  assert.equal(aapl.available, 500, 'nothing allocated yet');
  assert.equal(aapl.omrPerUnit, 5, 'price = priceEth × the OMR/ETH floor oracle (0.001 × 5000)');
  // the claim: burn $OMR at the real price → allocated units
  r = await call('POST', '/v1/vault/claim', { token: claimer.token, body: { ticker: 'AAPL', omr: 50 } });
  assert.equal(r.code, 200, `claimed: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.units, 10, '50 $OMR at 5/unit = 10 units');
  assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='rwa:vault'")).rows[0].s), -50, 'the claim is a ledgered rwa:vault burn');
  // the rolling-24h per-account cap (anti-float-sweep)
  r = await call('POST', '/v1/vault/claim', { token: claimer.token, body: { ticker: 'AAPL', omr: 460 } });
  assert.equal(r.body.error, 'daily_cap', 'the daily bucket refuses a sweep (50 + 460 > 500)');
  r = await call('POST', '/v1/vault/claim', { token: claimer.token, body: { ticker: 'AAPL', omr: 450 } });
  assert.equal(r.code, 200, 'a claim inside the bucket lands');
  // clamp-to-available: a thin TSLA float (10 units = 50 $OMR worth)
  await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'TSLA', eth: 0.01, priceEth: 0.001 });
  const clamper = await mk('Clamp Carl');
  await acctOmr(clamper.id, 500); grantDrift += 500;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${clamper.id}')`);
  r = await call('POST', '/v1/vault/claim', { token: clamper.token, body: { ticker: 'TSLA', omr: 100 } });
  assert.equal(r.code, 200, 'the clamped claim lands');
  assert.equal(r.body.clamped, true, 'the float ran short of the ask');
  assert.equal(r.body.units, 10, 'clamped to the 10 available units');
  assert.equal(r.body.spent, 50, 'and charged only for what was got (never an IOU, never overpaid)');
  r = await call('POST', '/v1/vault/claim', { token: clamper.token, body: { ticker: 'TSLA', omr: 50 } });
  assert.equal(r.body.error, 'float_dry', 'a fully-claimed float refuses cleanly');
  // the RICO graduation SHARES the paper window: paper 990 then a vault 50 crosses 1000 → safehouse-blocked
  const launderer = await mk('Sly Sal');
  await acctOmr(launderer.id, 2000); grantDrift += 2000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${launderer.id}')`);
  await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${launderer.id}'`);
  r = await call('POST', '/v1/portfolio/invest', { token: launderer.token, body: { ticker: 'GLD', omr: 990 } });
  assert.equal(r.code, 200, 'a sub-threshold paper buy flies from a safehouse');
  r = await call('POST', '/v1/vault/claim', { token: launderer.token, body: { ticker: 'AAPL', omr: 50 } });
  assert.equal(r.body.error, 'safe', 'the vault claim that crosses the SHARED window is blocked from a safehouse (structuring-proof across both books)');
  // AUDIT F1: a mod buy carrying a txHash is STRIPPED (ALLOW_MOD_REAL_REVENUE off) — real=false,
  // so a comp can never poison the real-vs-simulated unit ledger R3 reconciles against
  b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'GLD', eth: 0.001, priceEth: 0.001, txHash: '0xfaked' });
  assert.equal(b.json().real, false, 'the modRealTxHash gate strips a caller-supplied txHash');
  // AUDIT F3: price continuity — a dust buy can't reprice the whole float (>10× off the last refused)
  b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 0.000001, priceEth: 0.000000001 });
  assert.equal(b.json().error, 'price_sanity', 'a typo/fat-finger price is refused (the vig VIG_MAX_PRICE_JUMP twin)');
  // AUDIT B-F1: a claim whose ask rounds to ZERO units is refused BEFORE the burn — never pay for nothing
  b = await modCall('POST', '/v1/mod/rwa/buy', { ticker: 'HOOD', eth: 0.4, priceEth: 100000 }); // absurdly expensive unit (first buy = no continuity ref)
  assert.equal(b.statusCode, 200, 'the expensive-ticker buy lands');
  const tiny = await mk('Tiny Tim');
  await acctOmr(tiny.id, 100); grantDrift += 100;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${tiny.id}')`);
  r = await call('POST', '/v1/vault/claim', { token: tiny.token, body: { ticker: 'HOOD', omr: 5 } });
  assert.equal(r.body.error, 'amount', 'a zero-unit ask is refused (no burn-for-nothing)');
  assert.equal((await meOf(tiny.token)).omr, 100, 'and not a single $OMR moved');
  // the fee slice end-to-end: a REAL gameplay fee routes FEE_RWA_BPS into rwa_revenue (source=fee)
  const { recordFeePayment } = await import('../src/fees.js');
  await recordFeePayment(pool, { nonce: 991001, kind: 'mint', payer: '0x' + '11'.repeat(20),
    amountWei: (10n ** 18n).toString(), txHash: '0x' + 'ab'.repeat(32) }); // 1 ETH real fee
  const feeRwa = Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='fee'")).rows[0].s);
  assert.equal(feeRwa, 0.1, 'FEE_RWA_BPS (10%) of a real 1-ETH fee funds the float budget');
  await recordFeePayment(pool, { nonce: 991001, kind: 'mint', payer: '0x' + '11'.repeat(20),
    amountWei: (10n ** 18n).toString(), txHash: '0x' + 'ab'.repeat(32) }); // re-delivered event
  assert.equal(Number((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='fee'")).rows[0].s), 0.1,
    'a re-delivered fee event books the slice exactly once');
  // the real-value invariant: allocated ≤ held, spend ≤ revenue, unit sums exact
  const inv2 = (await modCall('GET', '/v1/mod/rwa')).json();
  assert.equal(inv2.ok, true, `the RWA invariants hold: ${JSON.stringify(inv2.checks.filter((c) => !c.ok))}`);
  assert(inv2.checks.find((c) => c.name === 'allocated <= held (AAPL)')?.ok, 'THE anti-Ponzi check present + green');
  assert.equal(inv2.simulatedUnits, 511.000004, 'the real-vs-simulated gap is visible (all pre-mainnet buys are simulated)');
  // DEATH SURVIVAL: the vaulted book is account-level — the heir keeps it
  const vaultedBefore = (await call('GET', '/v1/vault', { token: claimer.token })).body.mine;
  await app.inject({ method: 'POST', url: '/v1/mod/kill', payload: { characterId: claimer.id }, headers: { 'x-mod-key': 'test-mod-key' } });
  const vaultedAfter = (await call('GET', '/v1/vault', { token: claimer.token })).body.mine;
  assert.deepEqual(vaultedAfter, vaultedBefore, 'the VAULTED book survives death — the heir inherits the backed units');
  console.log('✓ THE FLOAT: tax-funded buyback (spend ≤ revenue), the $OMR claim rail (ledgered rwa:vault burn), the daily bucket, clamp-to-available + float_dry, the shared RICO window, allocated ≤ held, death survival');
}

// ── §10.4: rwa:invest is a recognized burn; dividend:* are TRANSFERS (pool ↔ account, both inside
// omrBuckets), so the ONLY drift is the unledgered SQL grants ──
const inv = await runLedgerInvariants(pool);
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `rwa: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test's unledgered grants (${grantDrift}) — rwa:invest reconciles as a burn, not a leak`);

console.log('✅ Portfolio (R1 "going legit") test passed — the market board (deterministic seed price + day-change), personal invest (fractional share math + ledgered rwa:invest $OMR burn + bucket accounting + averaging), ticker/amount/no-omr gates, the family book (rank gate, empty-reserve rejection, reserve debit + ledger + gang-page surfacing), DEATH SURVIVAL (the heir keeps the account-level book), the status leaderboard, and §10.4 (rwa: vocabulary + burn reconciles — drift == the test grant only)');
await app.close();
