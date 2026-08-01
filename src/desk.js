// ── src/desk.js — THE DESK (economy v3 steps 2–3: where a spent $OMR goes, and how it comes back) ──
// Design: omerta-economy-v3-design.md §3, §4.2, §11.6, §11.7. A sink used to destroy the token; now it
// hands it to the desk, and the desk sells it back to the market. The whole economic argument in one
// line:
//
//   annual revenue ≈ annual $OMR sink volume × price
//
// so the number that matters is RETURN VELOCITY — how many times a year one token comes home — rather
// than how few tokens exist. You cannot burn AND recycle the same unit; the founder chose revenue,
// which is also why nothing here may be described as deflationary (design §10 risk B).
//
// STEP 2 built the inbound half (the recycle, hooked in `game.js:ledger` so a sink added later cannot
// forget to feed the desk). STEP 3 is the outbound half, and it closes the honest gap that step 2's
// header named out loud: a desk that accumulates and never sells is indistinguishable, from the
// outside, from a burn with extra steps.
//
// ── THE SALE IS A TRANSFER, NOT A MINT ──────────────────────────────────────────────────────────
// This is the load-bearing §10.4 fact and it is worth stating before any code. The desk sells $OMR it
// already HOLDS: `desk_inventory.balance` goes down by exactly what the buyer's account goes up by,
// and both are inside `omrBuckets`. So conservation needs no new term, no new mint reason, and no new
// burn reason — the identity is untouched because the total did not move. `desk:sale` is written for
// AUDITABILITY (and because it is what makes the vest work — see below), not because conservation
// requires it. That is wall 2 ("the desk never sells inventory it does not hold") holding by
// construction rather than by assertion: there is no code path here that can credit a buyer without
// decrementing the shelf, because it is one clamped subtraction.
//
// ── THE VEST IS ALREADY BUILT, AND THAT IS THE POINT ────────────────────────────────────────────
// Design §11.7 asks for a 48h vest on auction purchases. We do not build one. A `desk:sale` credit is
// a positive $OMR row on the buyer's account, and `tax.js:earlySurcharge` replays exactly those rows
// as FIFO lots — so bought $OMR is already priced at the full early-exit surcharge decaying to zero
// over `FRESH_WINDOW_MS`, which is 48h. One concept, one constant: simultaneously the anti-dump, the
// float creator, and the §5(ii) loot exposure window. A second timer beside it would only give the
// two a way to disagree. `test/desk.js` asserts this rather than assuming it.
//
// ── WHY THE FILL COMES IN THROUGH AN INGEST ────────────────────────────────────────────────────
// A purchase is an ETH payment, and ETH arrives on a chain. So the fill follows the M6 pattern every
// other real-value rail here uses (Store, bonds, the sell tax): the backend books an episode that is
// idempotent on a `ref`, and `txHash` marks it REAL. Chain-dormant until the on-chain leg is wired;
// a mod/QA route can drive it meanwhile and books ZERO ETH — "the desk received this much ETH" must
// never be assertable by a comp call. The $OMR side of a comp fill is real (it has to be, or QA is
// testing nothing), which is safe precisely because that side is a transfer.
//
// ── LOCK ORDER: accounts → desk_inventory → desk_auctions ──────────────────────────────────────
// The recycle path already holds `account_persistent` (the spend) before it touches `desk_inventory`,
// so a fill that took the shelf first and then reached for the buyer's account would be an AB-BA
// against every sink in the game. Buyer first, shelf second, the auction row last.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { BAND, DESK, DESK_AUCTION, DESK_RECYCLE_REASON, auctionPriceAt, dayOf } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round8 = (n) => Math.round(n * 1e8) / 1e8;
const DESK_SALE_REASON = 'desk:sale';

export async function deskInventory(client) {
  return (await client.query('SELECT balance, lifetime_in, lifetime_sold FROM desk_inventory WHERE id=1')).rows[0]
    || { balance: 0, lifetime_in: 0, lifetime_sold: 0 };
}

// ── THE ANCHOR (the band's centre, and the only oracle on the path) ──
// The oracle quotes $OMR per ETH (the same print `treasury.js` reads; mainnet, the OmrTwapOracle's
// 30-day average). The auction quotes ETH per $OMR, so this inverts it ONCE, here, at the edge.
//
// FAIL-CLOSED, verbatim from the vault's `ethPrice` and for the same reason: a stale price is a free
// option, and the desk's whole shelf is on the other side of it. No print, or one older than
// `ORACLE_MAX_AGE_MS`, and NO AUCTION OPENS — it must never fall back to a default, because
// "we don't know what $OMR costs" resolving to "sell it at the default" is the entire hole. `stale`
// is RETURNED rather than thrown so the public board can render an honest "closed, and here is why"
// off the same read the open path refuses on — one source of truth for both.
export async function bandAnchor(db, now = Date.now()) {
  const last = (await db.query(
    'SELECT price_omr_per_eth, created_at FROM vig_buyback ORDER BY created_at DESC LIMIT 1')).rows[0];
  if (!last) return { anchor: null, stale: true, reason: 'no_price' };
  const omrPerEth = Number(last.price_omr_per_eth);
  if (!(omrPerEth > 0)) return { anchor: null, stale: true, reason: 'no_price' };
  const ageMs = now - new Date(last.created_at).getTime();
  if (ageMs > DESK_AUCTION.ORACLE_MAX_AGE_MS) return { anchor: null, stale: true, reason: 'stale_price', ageMs, omrPerEth };
  return { anchor: round8(1 / omrPerEth), omrPerEth, stale: false, ageMs, windowDays: BAND.ANCHOR_DAYS };
}

// THE FLOAT — $OMR in PLAYER hands. Not the shelf (that is what we are selling), not the house pools.
// It is the denominator of the 1%/day cap, i.e. the thing a dump would land on.
export async function floatOmr(db) {
  const held = Number((await db.query(
    'SELECT COALESCE(SUM(omr+staked+unbonding),0) s FROM account_persistent')).rows[0].s);
  const family = Number((await db.query('SELECT COALESCE(SUM(omr_reserve),0) s FROM gangs')).rows[0].s);
  return round6(held + family);
}

// THE LOT — what goes up for sale today. Three bounds, and each is a different claim:
//   • yesterday's returned inventory  — the design's rule: the desk sells what came home, not a
//     quantity somebody picked. Turnover, not issuance.
//   • 1% of float                     — a huge sink day must not become a dump.
//   • whatever is actually on the shelf — wall 2, and the only one of the three that is not a policy.
// The float cap carries a FLOOR because a cold start would otherwise deadlock: float 0 → cap 0 → the
// auction never opens → nobody can buy → float stays 0.
export async function lotSize(db, now = Date.now()) {
  const since = new Date(now - 24 * 3600000);
  const returned = Number((await db.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason=$1 AND at >= $2`,
    [DESK_RECYCLE_REASON, since])).rows[0].s);
  const float = await floatOmr(db);
  const floatCap = Math.max(DESK_AUCTION.FLOAT_CAP_MIN_OMR, float * DESK_AUCTION.FLOAT_CAP_BPS / 10000);
  const shelf = Number((await deskInventory(db)).balance);
  return {
    qty: round6(Math.max(0, Math.min(returned, floatCap, shelf))),
    returned: round6(returned), float, floatCap: round6(floatCap), shelf: round6(shelf),
  };
}

// ── OPEN (the worker, once a day) ──
// The day is the primary key, so a double open is a unique violation rather than a second lot on the
// same shelf. The anchor is SNAPSHOTTED here: the whole session prices off one reading, and a
// mid-auction oracle move cannot re-price a lot somebody is already bidding into.
export async function openAuction(pool, now = Date.now()) {
  const day = dayOf(now);
  if ((await pool.query('SELECT 1 FROM desk_auctions WHERE day=$1', [day])).rows[0]) return { opened: false, reason: 'already' };
  const band = await bandAnchor(pool, now);
  if (band.stale) return { opened: false, reason: band.reason };  // fail-closed: no price, no auction
  const lot = await lotSize(pool, now);
  if (lot.qty < DESK_AUCTION.MIN_LOT) return { opened: false, reason: 'no_lot', ...lot };
  const open = round8(band.anchor * DESK_AUCTION.OPEN_BPS / 10000);
  const reserve = round8(band.anchor * BAND.UPPER_BPS / 10000);   // the reserve IS the band's sell edge
  const id = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO desk_auctions (id, day, qty_omr, anchor_eth_per_omr, open_price, reserve_price, opens_at, closes_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, day, lot.qty, band.anchor, open, reserve, new Date(now), new Date(now + DESK_AUCTION.DURATION_MS)]);
  } catch (e) {
    if (e.code === '23505') return { opened: false, reason: 'already' };  // a concurrent worker won
    throw e;
  }
  return { opened: true, id, day, qty: lot.qty, anchor: band.anchor, open, reserve };
}

// Unsold inventory ROLLS — there is nothing to give back, because the lot never left the shelf. The
// quantity is a right to sell, not an escrow, which is why an unsold auction needs no unwind path.
export async function closeExpired(pool, now = Date.now()) {
  const { rowCount } = await pool.query(
    "UPDATE desk_auctions SET status='closed' WHERE status='live' AND closes_at <= $1", [new Date(now)]);
  return { closed: rowCount || 0 };
}

// ── THE FILL ──
// `omr` is what the buyer is taking; the price is the Dutch clock's reading at this moment, and the
// ETH follows from the two. Idempotent on `ref` (a re-delivered log is a clean no-op); `txHash` marks
// a REAL payment and is what gates the ETH accounting.
export async function recordAuctionBuy(pool, { ref, accountId, omr, txHash = null, now = Date.now() } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'A fill needs a ref (mainnet: txHash:logIndex).');
  const want = Number(omr);
  if (!(Number.isFinite(want) && want > 0)) throw new GameError('amount', 'omr must be > 0');
  if (!accountId) throw new GameError('account', 'A fill needs a buyer.');
  const real = !!txHash;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SELECT-then-INSERT, not ON CONFLICT DO NOTHING + rowCount: pg-mem does not report the rowCount
    // of a suppressed conflict, so the tidier idiom reports every duplicate as a fresh booking.
    // (The sell-tax ingest carries the same note — do not "improve" either back.)
    if ((await client.query('SELECT 1 FROM desk_sales WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { filled: false, duplicate: true };
    }
    // LOCK ORDER: buyer → shelf → auction (see the header — the recycle path holds the account first).
    const acct = (await client.query(
      'SELECT account_id, omr FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
    if (!acct) throw new GameError('account', 'No such buyer.');
    const shelf = (await client.query('SELECT balance FROM desk_inventory WHERE id=1 FOR UPDATE')).rows[0];
    const a = (await client.query(
      "SELECT * FROM desk_auctions WHERE status='live' AND opens_at <= $1 AND closes_at > $1 FOR UPDATE",
      [new Date(now)])).rows[0];
    if (!a) throw new GameError('closed', 'No auction is running. The desk sells once a day, and only above the band.');
    // Three clamps, and the third is wall 2: never sell what is not on the shelf. They are applied
    // rather than rejected so a race for the last of a lot fills partially instead of 500ing.
    const left = Number(a.qty_omr) - Number(a.sold_omr);
    const take = round6(Math.min(want, left, Number(shelf.balance)));
    if (!(take > 0)) throw new GameError('sold_out', 'That lot is gone. The desk opens a fresh one tomorrow.');
    const price = auctionPriceAt(a, now);
    const eth = round8(take * price);
    const polEth = real ? round8(eth * DESK_AUCTION.ETH_POL_BPS / 10000) : 0;
    // the remainder rule sits on the FOUNDER slice so the two shares sum to the gross EXACTLY (a
    // "natural" second division strands wei belonging to nobody — the sell-tax LP-slice precedent).
    const founderEth = real ? round8(eth - polEth) : 0;

    await client.query('UPDATE desk_inventory SET balance = balance - $1, lifetime_sold = lifetime_sold + $1 WHERE id=1', [take]);
    await client.query('UPDATE account_persistent SET omr = omr + $1 WHERE account_id=$2', [take, accountId]);
    await client.query('UPDATE desk_auctions SET sold_omr = sold_omr + $1, eth_taken = eth_taken + $2 WHERE id=$3',
      [take, real ? eth : 0, a.id]);
    await client.query(
      `INSERT INTO desk_sales (ref, auction_id, account_id, omr, price_eth_per_omr, eth, pol_eth, founder_eth, tx_hash, real)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [key, a.id, accountId, take, price, real ? eth : 0, polEth, founderEth, txHash, real]);
    // ONE row, on the buyer's account. Conservation does not need it (shelf and account are both
    // inside omrBuckets, so the total never moved) — but the ledger is the lot table, and this row is
    // what makes the purchase VEST: `tax.js:earlySurcharge` replays it as a fresh FIFO lot.
    await client.query(
      'INSERT INTO transactions (id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6)',
      [crypto.randomUUID(), accountId, 'omr', take, DESK_SALE_REASON, 'desk']);
    await client.query('COMMIT');
    return { filled: true, omr: take, price, eth: real ? eth : 0, polEth, founderEth, real, auctionId: a.id,
      partial: take < want };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { filled: false, duplicate: true };  // concurrent re-delivery
    throw e;
  } finally { client.release(); }
}

export async function liveAuction(db, now = Date.now()) {
  return (await db.query(
    "SELECT * FROM desk_auctions WHERE status='live' AND opens_at <= $1 AND closes_at > $1", [new Date(now)])).rows[0] || null;
}

// ── THE REAL-VALUE INVARIANT (the ETH side, the vig/bond/treasury twin) ──
// §10.4 covers the $OMR. This covers the money: that what the desk booked as revenue matches what it
// sold, and that the 50/50 split reconciles. Wired into the worker's nightly drift alert, because a
// check nobody reads is the failure mode this project has already lived through once.
export async function runDeskInvariants(pool) {
  const checks = [];
  const push = (name, actual, expected, tol = 0.000001, extra = {}) =>
    checks.push({ name, actual: round8(actual), expected: round8(expected),
      drift: round8(actual - expected), ok: Math.abs(actual - expected) <= tol, ...extra });

  const sold = Number((await pool.query('SELECT COALESCE(SUM(sold_omr),0) s FROM desk_auctions')).rows[0].s);
  const fills = Number((await pool.query('SELECT COALESCE(SUM(omr),0) s FROM desk_sales')).rows[0].s);
  push('auction books', fills, sold, 0.000001);

  const eth = Number((await pool.query('SELECT COALESCE(SUM(eth),0) s FROM desk_sales')).rows[0].s);
  const split = Number((await pool.query(
    'SELECT COALESCE(SUM(pol_eth),0) + COALESCE(SUM(founder_eth),0) s FROM desk_sales')).rows[0].s);
  push('eth split reconciles', split, eth, 0.000001);

  // A comp must never look like revenue. This is the anti-fabrication gate stated as a check rather
  // than trusted as a code path — the store/bond/sell-tax discipline, on the desk's own books.
  const fake = Number((await pool.query(
    'SELECT COALESCE(SUM(eth),0) s FROM desk_sales WHERE real = false')).rows[0].s);
  push('comps book no revenue', fake, 0, 0.000001);

  return { ok: checks.every((c) => c.ok), checks, sold: round6(sold), eth: round8(eth) };
}

// The public board. Published rather than hidden for the same reason the emission schedule was: a
// player who is told "every token you spend comes back to the desk and is sold again" is entitled to
// read the shelf, the clock and the price. `sinks` names WHICH spends feed it, so the claim is
// checkable and not just stated.
export async function deskBoard(pool, now = Date.now()) {
  const d = await deskInventory(pool);
  const recycledToday = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason=$1 AND at >= now() - interval '1 day'`,
    [DESK_RECYCLE_REASON])).rows[0].s);
  const band = await bandAnchor(pool, now);
  const a = await liveAuction(pool, now);
  const auction = a ? {
    day: a.day,
    lot: round6(Number(a.qty_omr)),
    sold: round6(Number(a.sold_omr)),
    left: round6(Number(a.qty_omr) - Number(a.sold_omr)),
    priceEthPerOmr: auctionPriceAt(a, now),
    openPrice: round8(Number(a.open_price)),
    reservePrice: round8(Number(a.reserve_price)),
    anchor: round8(Number(a.anchor_eth_per_omr)),
    closesSeconds: Math.max(0, Math.round((new Date(a.closes_at).getTime() - now) / 1000)),
  } : null;
  return {
    inventory: Number(d.balance),
    lifetimeIn: Number(d.lifetime_in),
    lifetimeSold: Number(d.lifetime_sold),
    recycledToday,
    auction,
    // why there ISN'T one, when there isn't — the board must never read as "broken" when it is
    // fail-closed on purpose, and must never read as "closed for price reasons" when the oracle died.
    closed: auction ? null : (band.stale ? band.reason : 'between_auctions'),
    band: {
      anchorEthPerOmr: band.anchor,
      windowDays: BAND.ANCHOR_DAYS,
      sellAbove: band.anchor === null ? null : round8(band.anchor * BAND.UPPER_BPS / 10000),
      buyBelow: band.anchor === null ? null : round8(band.anchor * BAND.LOWER_BPS / 10000),
      stale: band.stale, reason: band.stale ? band.reason : null,
    },
    schedule: {
      durationMs: DESK_AUCTION.DURATION_MS,
      openBps: DESK_AUCTION.OPEN_BPS,
      floatCapBps: DESK_AUCTION.FLOAT_CAP_BPS,
    },
    sinks: DESK.SINK_REASONS.filter((r) => !DESK.NOT_RECYCLED.includes(r)),
    notRecycled: DESK.NOT_RECYCLED,
    note: 'Every $OMR a sink takes lands on the desk and goes back up for sale the next day, in a '
      + 'descending auction that will not clear below the band. Nothing is printed: what you buy here '
      + 'is somebody else\'s spent chips. Withdrawing to the chain is the one spend that does NOT '
      + 'come back — that token leaves the game rather than coming to the house.',
  };
}
