// ── src/desk.js — THE DESK (economy v3 steps 2–4: where a spent $OMR goes, and how it comes back) ──
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
// ── STEP 4 IS THE OTHER EDGE OF THE BAND ───────────────────────────────────────────────────────
// Below `LOWER` the desk RESTOCKS from the open market, funded exclusively by POL trading fees and
// never by minting (design §11.10; that exclusion is wall 4). Its §10.4 shape is the exact inverse
// of a withdrawal — see `runDeskBuyback` below, which is where the argument belongs.
//
// ── LOCK ORDER: accounts → desk_inventory → desk_auctions ──────────────────────────────────────
// The recycle path already holds `account_persistent` (the spend) before it touches `desk_inventory`,
// so a fill that took the shelf first and then reached for the buyer's account would be an AB-BA
// against every sink in the game. Buyer first, shelf second, the auction row last. The buyback takes
// only `desk_inventory` (and `chain_reserve` under it), so it sits inside that same order.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { drainQueue } from './chain.js';
import { BAND, DESK, DESK_AUCTION, DESK_BUYBACK, DESK_RECYCLE_REASON, COMMUNITY, auctionPriceAt, dayOf } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round8 = (n) => Math.round(n * 1e8) / 1e8;
const DESK_SALE_REASON = 'desk:sale';
const DESK_BUYBACK_REASON = 'desk:buyback';

export async function deskInventory(client) {
  return (await client.query('SELECT balance, lifetime_in, lifetime_sold, lifetime_bought FROM desk_inventory WHERE id=1')).rows[0]
    || { balance: 0, lifetime_in: 0, lifetime_sold: 0, lifetime_bought: 0 };
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

// ══ THE BUY SIDE (economy v3 step 4) ═════════════════════════════════════════════════════════
// Design §3.2/§3.3/§11.10. Below the band's LOWER edge the desk RESTOCKS from the open market,
// because buying inventory back is sometimes cheaper than waiting for the sinks to return it.
//
// THE BUDGET, and why it is the only one. `pol_fees` — the fees protocol-owned liquidity earned.
// Not the founder half (not ours to spend), not the LP half (POL depth is the binding constraint),
// and NEVER by minting. That last exclusion is wall 4, and it is the single line between this design
// and Olympus: a buyback funded by minting is a flywheel with nothing outside it.
//
// THE §10.4 SHAPE, which is the interesting part and the inverse of a withdrawal. `withdraw:omr` is
// an in-game BURN paired with hard OMR leaving the reserve — supply exits the game. This is the
// mirror: an in-game MINT (`desk:buyback`, crediting the SHELF and never a player) paired with hard
// OMR entering the reserve — supply re-enters. It is admissible exactly to the extent that the hard
// token really arrived, so that is CHECKED rather than claimed: `runDeskInvariants` asserts the soft
// credit equals the hard delivery, and the Vig's two-sided `reserve fully backed` / `not
// under-funded` pair now carries the desk's contribution so the reserve's backing sources stay
// enumerated instead of one of them being invisible.
//
// The reserve is funded IN THE SAME TRANSACTION as the credit — deliberately not through
// `fundReserve`, which opens its own. The Vig funds post-commit and its own audit note calls the gap
// a LOST-FUNDING alarm; here the direction of that gap is worse (soft supply existing before its
// backing does), so the two move together or neither moves. `drainQueue` runs after, and is
// idempotent.
export async function recordPolFees(pool, { ref, eth, txHash = null } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'A fee episode needs a ref (mainnet: the collect txHash).');
  const amt = Number(eth);
  if (!(Number.isFinite(amt) && amt > 0)) throw new GameError('amount', 'eth must be > 0');
  const real = !!txHash;
  // SELECT-then-INSERT (pg-mem does not report a suppressed conflict's rowCount — the sell-tax note).
  if ((await pool.query('SELECT 1 FROM pol_fees WHERE ref=$1', [key])).rows[0]) return { recorded: false, duplicate: true };
  // THE VIG DIVERSION (the locked treasury→family split, Phase 1 — ships at 0): POL_FEES_VIG_BPS of
  // each real fee books to the Vig instead of the buyback budget (the design doc's Wall-4
  // relaxation, recorded there with the ops-slice alternative). Carved AT THE INGEST so polBudget —
  // which sums pol_fees with no other term — is automatically right; pol_fees books the NET.
  // Ordered vig-INSERT FIRST: this recorder is non-transactional (its one pre-existing statement
  // never needed a txn), so a crash between the two inserts must leave a state a re-delivered event
  // heals — vig booked + pol_fees missing re-runs cleanly (both sides idempotent on ref), whereas
  // the reverse order would strand a permanently under-booked vig share.
  const vigShare = real ? round6(amt * COMMUNITY.POLFEES_VIG_BPS() / 10000) : 0;
  const netEth = real ? round6(amt - vigShare) : 0;
  if (vigShare > 0 && !(await pool.query(
    "SELECT 1 FROM vig_revenue WHERE source='polfees' AND ref=$1", [key])).rows[0])
    await pool.query(
      "INSERT INTO vig_revenue (source, ref, kind, gross_eth, vig_eth) VALUES ('polfees',$1,'polfees',$2,$3)",
      [key, round6(amt), vigShare]);
  try {
    await pool.query('INSERT INTO pol_fees (ref, eth, tx_hash, real) VALUES ($1,$2,$3,$4)',
      [key, netEth, txHash, real]);   // a comp books ZERO — the anti-fabrication gate
  } catch (e) {
    if (e.code === '23505') return { recorded: false, duplicate: true };
    throw e;
  }
  return { recorded: true, eth: netEth, vigEth: vigShare, real };
}

// What the bot may still spend: fees earned minus fees already spent. Self-limiting by construction —
// there is no other term, which is the whole of §11.10.
export async function polBudget(db) {
  const earned = Number((await db.query('SELECT COALESCE(SUM(eth),0) s FROM pol_fees')).rows[0].s);
  const spent = Number((await db.query('SELECT COALESCE(SUM(eth_spent),0) s FROM desk_buys')).rows[0].s);
  return { earned: round6(earned), spent: round6(spent), left: round6(Math.max(0, earned - spent)) };
}

export async function runDeskBuyback(pool, { ref, ethToSpend, priceEthPerOmr, txHash = null, now = Date.now() } = {}) {
  const key = String(ref || '').trim();
  if (!key) throw new GameError('ref', 'A buyback needs a ref (mainnet: the swap txHash).');
  const real = !!txHash;   // marks a genuine on-chain swap — see the reserve gate below
  const eth = Number(ethToSpend), price = Number(priceEthPerOmr);
  if (!(Number.isFinite(eth) && eth >= DESK_BUYBACK.MIN_ETH)) throw new GameError('amount', `Spend at least ${DESK_BUYBACK.MIN_ETH} ETH.`);
  if (!(Number.isFinite(price) && price > 0)) throw new GameError('price', 'priceEthPerOmr must be > 0 (mainnet: what the bot executed at).');
  const band = await bandAnchor(pool, now);
  if (band.stale) throw new GameError(band.reason, 'No usable anchor — the desk does not trade blind, in either direction.');
  const buyBelow = round8(band.anchor * BAND.LOWER_BPS / 10000);
  // THE BAND, on the buy side. Above this the desk does NOTHING — running both sides at once is a
  // losing round trip wearing a flywheel costume (design §3.2), and the dead zone is what prevents it.
  if (price > buyBelow) throw new GameError('band', `The desk buys below ${buyBelow} ETH per $OMR; the market is at ${price}.`);
  // …and the fat-finger floor. The shelf credit is eth/price, so a price a decimal place too low
  // mints inventory out of a typo. Fail-closed rather than clamped: a price we do not believe is not
  // a price to trade at (the RWA float's continuity bound, against the band's own anchor).
  const floor = round8(band.anchor * DESK_BUYBACK.PRICE_FLOOR_BPS / 10000);
  if (price < floor) throw new GameError('price', `That execution (${price}) is below the sanity floor ${floor} — the desk refuses rather than guessing.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query('SELECT 1 FROM desk_buys WHERE ref=$1', [key])).rows[0]) {
      await client.query('COMMIT');
      return { bought: false, duplicate: true };
    }
    // THE ROOT CAP: never spend more than the pool earned. Read under a lock on the budget's own
    // table so two concurrent buys cannot each see the whole of it (the runVigBuyback discipline).
    await client.query('SELECT 1 FROM desk_inventory WHERE id=1 FOR UPDATE');
    const budget = await polBudget(client);
    if (eth > budget.left + 1e-9) throw new GameError('budget', `The buyback has ${budget.left} ETH of POL fees left; it never spends more than the pool earned.`);
    const omr = round6(eth / price);
    if (!(omr > 0)) throw new GameError('amount', 'That buys nothing at this price.');

    await client.query(
      `INSERT INTO desk_buys (ref, eth_spent, omr_bought, price_eth_per_omr, anchor_eth_per_omr, tx_hash, real)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [key, round6(eth), omr, price, band.anchor, txHash, real]);
    await client.query('UPDATE desk_inventory SET balance = balance + $1, lifetime_bought = lifetime_bought + $1 WHERE id=1', [omr]);
    // THE ANTI-FABRICATION GATE, and it belongs on THIS line more than on any other in the file.
    // The shelf credit above is soft supply sitting inside `omrBuckets`, so a comp may have it (QA
    // needs inventory to test the sell side, and the shelf can only reach a player through a fill).
    // `chain_reserve.funded_omr` is a different kind of thing entirely: it is what `signVoucher`
    // checks before signing a REAL on-chain withdrawal, so crediting it asserts "hard OMR arrived".
    // A comp must never be able to assert that — it is the store/bond/sell-tax discipline, one step
    // further along, because here the fabrication would let the server sign against backing that
    // does not exist. Until this gate the credit was unconditional and the only thing stopping a
    // comp was that `polBudget` is zero without real fees — a defence by accident, and one that
    // evaporates the moment `ALLOW_MOD_REAL_REVENUE=on` for QA. `runVigInvariants` counts only
    // `desk_buys WHERE real` for the same reason: with both halves gated its two-sided sandwich
    // CATCHES a mismatch, where before it absorbed one.
    if (real) {
      await client.query('UPDATE chain_reserve SET funded_omr = funded_omr + $1, last_funded_at = now() WHERE id=1', [omr]);
    }
    await client.query(
      'INSERT INTO transactions (id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), 'omr', omr, DESK_BUYBACK_REASON, 'pol_fees']);
    await client.query('COMMIT');
    // The reserve just grew, so a withdrawal that was queued for want of backing may now be
    // signable. Best-effort and post-commit: draining is idempotent (it signs whatever the reserve
    // covers, FIFO), so a failure here loses nothing a later drain will not pick up — and it must
    // never roll back a purchase that really happened.
    try { await drainQueue(pool); } catch { /* the next fund or withdrawal drains it */ }
    return { bought: true, omr, eth: round6(eth), price, anchor: band.anchor, buyBelow, real };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return { bought: false, duplicate: true };
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

  // ── THE BUY SIDE (step 4) ──
  // (a) THE ROOT CAP, and it is the whole of §11.10: the bot cannot spend what the pool did not earn.
  // This is what makes the buyback self-limiting rather than a budget somebody sets.
  const budget = await polBudget(pool);
  push('spend ≤ POL fees', budget.spent, Math.min(budget.spent, budget.earned), 0.000001,
    { earned: budget.earned, spent: budget.spent });
  // (b) THE BACKING, and it is the reason `desk:buyback` is allowed to be a mint at all. Every soft
  // $OMR credited to the shelf must correspond to a hard OMR the bot really bought. Conservation
  // cannot see this — it counts the mint and moves on — so if the credit were ever computed from
  // something other than the purchase, THIS is the check that says so.
  const buybackMinted = Number((await pool.query(
    `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='desk:buyback'`)).rows[0].s);
  const hardBought = Number((await pool.query('SELECT COALESCE(SUM(omr_bought),0) s FROM desk_buys')).rows[0].s);
  push('buyback backed by a real purchase', buybackMinted, hardBought, 0.000001, { hardBought });
  const desk = await deskInventory(pool);
  push('desk books the buyback', Number(desk.lifetime_bought), hardBought, 0.000001);

  return { ok: checks.every((c) => c.ok), checks,
    sold: round6(sold), eth: round8(eth), bought: round6(hardBought), budget };
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
  const budget = await polBudget(pool);
  return {
    inventory: Number(d.balance),
    lifetimeIn: Number(d.lifetime_in),
    lifetimeSold: Number(d.lifetime_sold),
    lifetimeBought: Number(d.lifetime_bought),
    recycledToday,
    auction,
    // the buy side, published for the same reason the sell side is: a player told "the desk restocks
    // from the market when that is cheaper than waiting" is entitled to see the budget it does it with.
    buyback: {
      budgetEth: budget.left, earnedEth: budget.earned, spentEth: budget.spent,
      buyBelow: band.anchor === null ? null : round8(band.anchor * BAND.LOWER_BPS / 10000),
      fundedBy: 'POL trading fees — never by minting',
    },
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
