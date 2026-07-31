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
import * as Treasury from '../src/treasury.js';
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
// (tokenomics v2 step 2) …and it lands in the FAMILY yield pot, not a personal dividend pool.
// Same reason, same transfer, same §10.4 posture — only the destination moved, because personal
// yield is retired and standing is what earns it now (design §3).
assert.equal(Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance), divCut, 'and it landed in the FAMILY yield pot');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), 0, 'the retired personal dividend pool stays empty');
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
// THE PERSONAL DIVIDEND — RETIRED (tokenomics v2 step 2, design §3). Everything that made the
// Dynasty Fund an endgame survives: the book, the tier ladder, the crest, the leaderboard, and the
// fact that it outlives the man. What it loses is the personal payout — the yield is the FAMILY
// yield now, so standing earns it into the family reserve instead.
assert.equal(board.dividend, undefined, 'the board no longer advertises a personal dividend');
assert.equal((await call('POST', '/v1/portfolio/dividend', { token: boss.token })).body.error, 'retired',
  'and claiming it is refused');
// the slice of each invest that used to fill the personal pool now fills the family pot — same
// transfer, same §10.4 posture, different destination (asserted at the invest site above too)
assert(Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance) > 0,
  'the invests fed the FAMILY pot');
assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), 0,
  'and the retired personal pool stays empty — nothing feeds it and nothing pays from it');

// ═══ THE VAULT — BACKED WITH ETH (omerta-stock-layer-retirement.md) ═══
// The founder retired the STOCK layer on 2026-07-31 and kept the vault, backed with ETH. What that
// buys is not a smaller wall but a stronger one: `allocated <= held` protects a claim only while both
// sides are the SAME asset, so ETH-for-ETH restores the float's original property exactly and there is
// no second asset whose price can put the treasury short. Proved here: the anti-Ponzi wall holds at
// the margin, the claim is a ledgered rwa:vault burn, the daily bucket bounds a sweep, the clamp never
// overcharges, and the RICO graduation still shares the paper window.
{
  // no revenue → nothing to claim (the wall at zero: the treasury cannot owe what it does not hold)
  const early = await mk('Vault Vinny');
  await acctOmr(early.id, 3000); grantDrift += 3000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${early.id}')`);
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'vault_dry', 'an empty treasury has nothing to allocate');
  // 1.0 ETH of real revenue lands (out-of-band real-value accounting — the vig/bond test precedent)
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('store','vault-test-1',1.0)");
  // …and it STILL refuses, because no ETH price has printed. This is the guard that matters most now
  // that the vault owes real ETH: with no oracle the old code fell back to a FIXED floor, which turns
  // "we don't know what ETH costs" into "sell it at the default" — a standing free option on the
  // treasury. Fail-closed, no fallback.
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'no_price', 'a funded vault with no ETH price REFUSES rather than guessing one');
  let vb = (await call('GET', '/v1/vault', { token: early.token })).body;
  assert.equal(vb.open, false, 'and the board says closed rather than advertising a price the claim would refuse');
  // a buyback prints the OMR/ETH oracle (mainnet: the DEX TWAP)
  await pool.query("INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize) VALUES ('bb-vault', 1, 5000, 5000, 0, 0)");
  // …and a STALE print is refused too — the same hole with a timestamp on it
  await pool.query("UPDATE vig_buyback SET created_at = now() - interval '5 days' WHERE id='bb-vault'");
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'stale_price', 'a stale ETH price is refused, not used');
  await pool.query("UPDATE vig_buyback SET created_at = now() WHERE id='bb-vault'");
  vb = (await call('GET', '/v1/vault', { token: early.token })).body;
  assert.equal(vb.heldEth, 1, 'the board shows what the treasury holds');
  assert.equal(vb.availableEth, 1, 'nothing allocated yet');
  assert.equal(vb.spotOmrPerEth, 5000, 'spot is the oracle print');
  assert.equal(vb.omrPerEth, 5250, 'a claim pays spot + the 5% premium — the vault is not a market maker');
  assert.equal(vb.open, true, 'and now it is open');
  // MINTED-ONLY: a claiming identity pays the mint fee first, so the per-account cap is a real bound
  const free = await mk('Free Freddie');
  await acctOmr(free.id, 500); grantDrift += 500;
  r = await call('POST', '/v1/vault/claim', { token: free.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'mint', 'a free-trial character cannot claim from the vault');
  // the claim: burn $OMR at the oracle → allocated ETH
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 525 } });
  assert.equal(r.code, 200, `claimed: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.eth, 0.1, '525 $OMR at 5250/ETH (spot + premium) = 0.1 ETH');
  assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='rwa:vault'")).rows[0].s),
    -525, 'the claim is a ledgered rwa:vault burn — $OMR is the rationing ticket, the ETH was already paid for');
  // the rolling-24h per-account cap (anti-sweep)
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 1600 } });
  assert.equal(r.body.error, 'daily_cap', 'the daily bucket refuses a sweep (525 + 1600 > 2000)');
  // THE WALL, at the margin: a second house claims and the vault clamps to what is left rather than
  // promising ETH the treasury does not hold. 0.9 ETH remain = 4500 $OMR worth; ask for more.
  const whale = await mk('Clamp Carl');
  await acctOmr(whale.id, 3000); grantDrift += 3000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${whale.id}')`);
  await pool.query("UPDATE rwa_revenue SET rwa_eth=0.12 WHERE ref='vault-test-1'"); // held 0.12, 0.1 already owed
  r = await call('POST', '/v1/vault/claim', { token: whale.token, body: { omr: 2000 } });
  assert.equal(r.code, 200, 'the clamped claim lands');
  assert.equal(r.body.clamped, true, 'the treasury ran short of the ask');
  assert.equal(r.body.eth, 0.02, 'clamped to the 0.02 ETH that was unallocated');
  assert.equal(r.body.spent, 105, 'and charged only for what was got (never an IOU, never overpaid)');
  r = await call('POST', '/v1/vault/claim', { token: whale.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'vault_dry', 'a fully-allocated vault refuses cleanly');
  // THE ANTI-PONZI CHECK, in ETH on both sides
  const ti = await Treasury.runTreasuryInvariants(pool);
  const wall = ti.checks.find((c) => c.name === 'allocated <= held (ETH)');
  assert(wall && wall.ok, 'allocated <= held holds');
  assert.equal(wall.lhs, 0.12, 'and it is watching the real allocation');
  assert.equal(wall.rhs, 0.12, 'against the real holding');
  // the RICO graduation SHARES the paper window: paper 990 then a vault claim crosses 1000 → blocked
  const launderer = await mk('Sly Sal');
  await acctOmr(launderer.id, 2000); grantDrift += 2000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${launderer.id}')`);
  await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${launderer.id}'`);
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('bond','vault-test-2',1.0)");
  r = await call('POST', '/v1/portfolio/invest', { token: launderer.token, body: { ticker: 'GLD', omr: 990 } });
  assert.equal(r.code, 200, 'a sub-threshold paper buy flies from a safehouse');
  r = await call('POST', '/v1/vault/claim', { token: launderer.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'safe',
    'the vault claim that crosses the SHARED window is blocked from a safehouse (structuring-proof across both books)');
  console.log('✓ THE VAULT — backed with ETH: allocated <= held on both sides, the ledgered burn, the daily cap, the honest clamp, the shared RICO window');
}

// ── §10.4: rwa:invest is a recognized burn; dividend:* are TRANSFERS (pool ↔ account, both inside
// omrBuckets), so the ONLY drift is the unledgered SQL grants ──
const inv = await runLedgerInvariants(pool, { alert: false });
const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
assert(vocab.ok, `rwa: rides the omr vocabulary (${JSON.stringify(vocab.unknown || [])})`);
const omrCheck = inv.checks.find((c) => c.name === '$OMR conservation');
assert.equal(omrCheck.drift, grantDrift, `the only $OMR drift is the test's unledgered grants (${grantDrift}) — rwa:invest reconciles as a burn, not a leak`);

console.log('✅ Portfolio (R1 "going legit") test passed — the market board (deterministic seed price + day-change), personal invest (fractional share math + ledgered rwa:invest $OMR burn + bucket accounting + averaging), ticker/amount/no-omr gates, the family book (rank gate, empty-reserve rejection, reserve debit + ledger + gang-page surfacing), DEATH SURVIVAL (the heir keeps the account-level book), the status leaderboard, and §10.4 (rwa: vocabulary + burn reconciles — drift == the test grant only)');
await app.close();
