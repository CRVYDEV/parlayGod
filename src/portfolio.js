// R1 — THE PORTFOLIO ("going legit"): the RWA / blue-chip holdings layer. The narrative apex of the
// laundering arc — clean $OMR washed into legitimate, DEATH-PROOF equity. In R1 this is PURE STATUS:
// a ticker-denominated collectible with a deterministic display price (§7.11 seed machinery), no
// sell and no cash-out, so it touches NO securities/derivative law (the hitman-rep / family-seal
// precedent — a status axis outside §10.4 and outside the sim-audited balance). The ONLY §10.4 flow
// is the 'rwa:invest' $OMR BURN, paid through the vanity `spendOmr` till so the burn discipline
// lives in one place. R2 will back the shares with a real RWA reserve; R3 opens the KYC'd on-chain
// extraction — both legal-gated. Holdings live at the ACCOUNT level (survive death → the heir keeps
// the book, the retirement fantasy); the family book lives on the gang and dies with the family.
import { GameError } from './game.js';
import { PORTFOLIO, tickerOf, tickerPriceOf, dayOf } from './rules.js';
import { spendOmr } from './vanity.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6; // fractional shares to 6 places

function validAmount(omr) {
  const amt = Math.floor(Number(omr));
  if (!Number.isFinite(amt) || amt < PORTFOLIO.MIN_INVEST_OMR)
    throw new GameError('amount', `Invest at least ${PORTFOLIO.MIN_INVEST_OMR} $OMR.`);
  return amt;
}

// One book row valued at the current display price (holdings summary shape, reused across the board,
// the leaderboard and the character view).
function bookRow(row, priceMap) {
  const shares = Number(row.shares);
  const price = priceMap[row.ticker];
  return { ticker: row.ticker, name: tickerOf(row.ticker)?.name || row.ticker,
    shares: round6(shares), price, bookValue: round2(shares * price), costBasis: Math.floor(Number(row.cost_omr)) };
}

// A STATUS GRANT of shares (step two — earned exposure): shares = omrWorth / price, cost basis 0
// (a free legit kickback — season prizes, the big-score cut). Not a §10.4 currency, so no ledger.
// A plain DB helper (no `h`) so headless callers (the season worker) and under-lock member payouts
// (the heist crew) can grant directly. Returns the updated { ticker, shares, cost_omr } row.
export async function grantShares(client, accountId, ticker, omrWorth) {
  if (!tickerOf(ticker) || !(Number(omrWorth) > 0)) return null;
  const granted = round6(Number(omrWorth) / tickerPriceOf(ticker));
  if (!(granted > 0)) return null;
  const cur = (await client.query('SELECT shares, cost_omr FROM portfolios WHERE account_id=$1 AND ticker=$2', [accountId, ticker])).rows[0];
  const shares = round6(Number(cur?.shares || 0) + granted);
  const cost = Number(cur?.cost_omr || 0); // a grant costs nothing — cost basis unchanged (pure gain)
  if (cur) await client.query('UPDATE portfolios SET shares=$3 WHERE account_id=$1 AND ticker=$2', [accountId, ticker, shares]);
  else await client.query('INSERT INTO portfolios (account_id, ticker, shares, cost_omr) VALUES ($1,$2,$3,0)', [accountId, ticker, shares]);
  return { ticker, shares, cost_omr: cost, granted };
}

// PERSONAL invest: burn clean $OMR → fractional shares at today's price. A §10.4 $OMR burn
// ('rwa:invest', account bucket) — the shares are pure status, so nothing else moves value.
// Step two — the RICO GRADUATION: a BIG legit move draws heat and can't be done from a safehouse.
export async function invest(ch, ticker, omr, client, h) {
  const t = tickerOf(ticker);
  if (!t) throw new GameError('ticker', 'No such stock on the board.');
  const amt = validAmount(omr);
  // the classic laundering red flag: moving a big sum into legit fronts gets noticed (the launder
  // precedent). Small buys fly under the radar. Checked BEFORE the burn so a blocked move is clean.
  const scrutiny = amt >= PORTFOLIO.SCRUTINY_MIN_OMR;
  if (scrutiny && ch.safe_until && new Date(ch.safe_until) > new Date())
    throw new GameError('safe', "You can't move big money into legit fronts while you're to ground.");
  const price = tickerPriceOf(ticker);
  const bought = round6(amt / price);
  await spendOmr(client, h, amt, 'rwa:invest'); // gates on h.acct.omr, debits in-memory, ledgers the burn
  if (scrutiny) ch.heat = Number(ch.heat || 0) + PORTFOLIO.SCRUTINY_HEAT; // going legit in a big way draws the law
  const cur = (await client.query('SELECT shares, cost_omr FROM portfolios WHERE account_id=$1 AND ticker=$2', [ch.account_id, ticker])).rows[0];
  const shares = round6(Number(cur?.shares || 0) + bought);
  const cost = Number(cur?.cost_omr || 0) + amt;
  if (cur) await client.query('UPDATE portfolios SET shares=$3, cost_omr=$4 WHERE account_id=$1 AND ticker=$2', [ch.account_id, ticker, shares, cost]);
  else await client.query('INSERT INTO portfolios (account_id, ticker, shares, cost_omr) VALUES ($1,$2,$3,$4)', [ch.account_id, ticker, shares, cost]);
  // keep this txn's account-level view fresh (loadOwned loads owned.portfolio as an array of rows)
  const pf = (h.owned.portfolio || []).filter((r) => r.ticker !== ticker);
  pf.push({ ticker, shares, cost_omr: cost });
  h.owned.portfolio = pf;
  await h.track(client, ch.account_id, 'rwa_invest', { ticker, omr: amt, shares: bought });
  return { ok: true, ticker, name: t.name, price, bought, shares,
    bookValue: round2(shares * price), costBasis: cost, scrutiny };
}

// FAMILY invest: the boss/underboss commissions the family's legit holdings from the $OMR RESERVE
// (the seal precedent — the reserve is its own §10.4 bucket, so the burn is ledgered directly
// against it with counterparty = the gang id, no account_id). Gang row LOCKED: reserve read-and-spend
// must be atomic under concurrent buys.
export async function familyInvest(ch, ticker, omr, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss invests the family money.');
  const t = tickerOf(ticker);
  if (!t) throw new GameError('ticker', 'No such stock on the board.');
  const amt = validAmount(omr);
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (Number(g.omr_reserve) < amt)
    throw new GameError('reserve', `The family reserve holds ${Math.floor(Number(g.omr_reserve))} $OMR. Tribute $OMR to fill it.`);
  const price = tickerPriceOf(ticker);
  const bought = round6(amt / price);
  await client.query('UPDATE gangs SET omr_reserve = omr_reserve - $2 WHERE id=$1', [g.id, amt]);
  await h.ledger(client, { currency: 'omr', amount: -amt, reason: 'rwa:invest', counterparty: g.id });
  const cur = (await client.query('SELECT shares, cost_omr FROM gang_portfolios WHERE gang_id=$1 AND ticker=$2', [g.id, ticker])).rows[0];
  const shares = round6(Number(cur?.shares || 0) + bought);
  const cost = Number(cur?.cost_omr || 0) + amt;
  if (cur) await client.query('UPDATE gang_portfolios SET shares=$3, cost_omr=$4 WHERE gang_id=$1 AND ticker=$2', [g.id, ticker, shares, cost]);
  else await client.query('INSERT INTO gang_portfolios (gang_id, ticker, shares, cost_omr) VALUES ($1,$2,$3,$4)', [g.id, ticker, shares, cost]);
  if (h.owned.gang) h.owned.gang.omr_reserve = Number(g.omr_reserve) - amt;
  await h.track(client, ch.account_id, 'rwa_family_invest', { ticker, omr: amt, shares: bought });
  return { ok: true, ticker, name: t.name, price, bought, shares,
    bookValue: round2(shares * price), reserve: Math.floor(Number(g.omr_reserve) - amt) };
}

// The board: today's market (price + day-over-day change), your book, and the family book if you're
// in a gang. Prices are deterministic (the daily seed hash) — the client never computes game math.
export async function portfolioBoard(ch, client, h) {
  const day = dayOf();
  const market = PORTFOLIO.TICKERS.map((t) => {
    const price = tickerPriceOf(t.id, day);
    const prev = tickerPriceOf(t.id, day - 1);
    return { ticker: t.id, name: t.name, blurb: t.blurb, price,
      dayChange: prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0 };
  });
  const priceMap = Object.fromEntries(market.map((m) => [m.ticker, m.price]));
  const mine = (await client.query('SELECT ticker, shares, cost_omr FROM portfolios WHERE account_id=$1 AND shares>0 ORDER BY ticker', [ch.account_id])).rows;
  const holdings = mine.map((r) => bookRow(r, priceMap));
  const portfolio = { holdings, bookValue: round2(holdings.reduce((a, r) => a + r.bookValue, 0)),
    costBasis: holdings.reduce((a, r) => a + r.costBasis, 0) };
  let family = null;
  if (h.owned.gangId) {
    const fam = (await client.query('SELECT ticker, shares, cost_omr FROM gang_portfolios WHERE gang_id=$1 AND shares>0 ORDER BY ticker', [h.owned.gangId])).rows;
    const fh = fam.map((r) => bookRow(r, priceMap));
    family = { name: h.owned.gang?.name || null,
      canInvest: h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss',
      reserve: Math.floor(Number(h.owned.gang?.omr_reserve || 0)),
      holdings: fh, bookValue: round2(fh.reduce((a, r) => a + r.bookValue, 0)) };
  }
  return { market, portfolio, family };
}

// The biggest legit books (a STATUS leaderboard — the hitmen-board precedent). Book value is the
// deterministic display price × shares, summed per account in JS across the 3 tickers, joined to the
// account's CURRENT living street. Full-scan, fine for alpha (the hitman/portfolio boards are small).
export async function portfolioLeaderboard(pool) {
  const day = dayOf();
  const priceMap = Object.fromEntries(PORTFOLIO.TICKERS.map((t) => [t.id, tickerPriceOf(t.id, day)]));
  const rows = (await pool.query(
    `SELECT p.account_id, p.ticker, p.shares, c.name
       FROM portfolios p LEFT JOIN characters c ON c.account_id = p.account_id AND c.alive
      WHERE p.shares > 0`)).rows;
  const byAccount = new Map();
  for (const r of rows) {
    const e = byAccount.get(r.account_id) || { name: r.name || null, bookValue: 0 };
    if (r.name && !e.name) e.name = r.name;
    e.bookValue += Number(r.shares) * (priceMap[r.ticker] || 0);
    byAccount.set(r.account_id, e);
  }
  const board = [...byAccount.values()]
    .map((e) => ({ name: e.name, bookValue: round2(e.bookValue) }))
    .filter((e) => e.bookValue > 0)
    .sort((a, b) => b.bookValue - a.bookValue)
    .slice(0, 25);
  return { day, prices: priceMap, board };
}

// Book value of a loaded portfolio array (loadOwned shape) at today's price — used by the character
// view and the estate `kept.portfolio` report (the moment the heir sees the book that survived).
export function portfolioValue(portfolio = []) {
  return round2((portfolio || []).reduce((a, r) => a + Number(r.shares) * tickerPriceOf(r.ticker), 0));
}
