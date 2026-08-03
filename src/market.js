// THE BLACK MARKET (design: omerta-market-design.md). P2P trade: cars by AUCTION (one standing
// bid, min-raise, optional buy-now), trade goods FIXED-PRICE with DISTRICT-PINNED pickup — the
// buyer stands at the listing's dock with trunk space, so the market creates demand without
// teleporting freight past the convoy game. Items escrow at list (cars: `cars.listed` flag —
// the row stays, car conservation counts rows; goods: qty deducted from the trunk into the
// listing). Cash escrow is the standing bid.
//
// §10.4 (`market:` vocabulary + the `market escrow` check): `list` fee is a plain sink; `bid`
// escrows in; `refund`/`sale`/`take`/`death` leave the escrow — standing bids on live listings
// reconcile as posted − refunded − sales − takes − deaths. The 2% take is carved FROM the
// hammer (half street tax, half burns — one character_id-NULL `market:take` row), never minted
// on top. Car transfers are conservation-neutral; goods are ownership, not currency.
//
// Locks: actor (withCharacter) → counterparty character read-UNLOCKED then locked then
// re-verified under the listing lock (the heist-execute pattern — a stale read retries clean)
// → market_listings (pot class) → street_tax singleton. Acyclic vs the global order; residual
// races fall back to the 40P01→contention mapping.
import crypto from 'node:crypto';
import { GameError, bus, ledger, notify, skillMult, trunkCap, npcTier, bumpStanding, bumpMastery, masteryFx } from './game.js';
import { BLACK_MARKET as MARKET, GOODS, SKILLS, UNDERWORLD , jailed, safeHoused } from './rules.js';
import { logCarCollect } from './collection.js';

const uid = () => crypto.randomUUID();
const expired = (l) => new Date(l.expires_at) <= new Date();
const cargoCount = (cargo) => Object.values(cargo).reduce((a, n) => a + (n || 0), 0);

async function setCargo(client, charId, goodId, qty) {
  await client.query('DELETE FROM character_cargo WHERE character_id=$1 AND good_id=$2', [charId, goodId]);
  if (qty > 0) await client.query('INSERT INTO character_cargo (character_id, good_id, qty) VALUES ($1,$2,$3)', [charId, goodId, qty]);
}
async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}
const listFee = (ask) => Math.max(MARKET.LIST_FEE_MIN, Math.ceil(ask * MARKET.LIST_FEE_BPS / 10000));
// BIG TUNA (underworld): T2 lets YOUR listings run the long TTL, T3 adds a listing slot —
// both are per-seller reads of the poster's standing, sign-off levers.
const maxTtlH = (h) => (npcTier(h, 'harbor') >= 2 ? UNDERWORLD.FX.TTL_H : MARKET.MAX_TTL_H);
const maxListings = (h) => MARKET.MAX_LISTINGS + (npcTier(h, 'harbor') >= 3 ? UNDERWORLD.FX.EXTRA_LISTING : 0);

// settle the money side of a sale: seller nets hammer − take; take half → street tax, half
// burns — the NULL `market:take` row is what closes the §10.4 escrow identity exactly.
// `inMemoryCh`: when the payee IS the transaction's actor (an order FILL pays the seller who is
// the withCharacter subject), credit in-memory — a SQL write would be clobbered by persist.
async function paySeller(client, h, sellerId, hammer, { reason = 'market:sale', inMemoryCh = null } = {}) {
  const take = Math.ceil(hammer * MARKET.TAKE_BPS / 10000);
  const net = hammer - take;
  if (inMemoryCh && inMemoryCh.id === sellerId) inMemoryCh.cash = Number(inMemoryCh.cash) + net;
  else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [sellerId, net]);
  await h.ledger(client, { characterId: sellerId, currency: 'cash', amount: net, reason });
  await h.ledger(client, { currency: 'cash', amount: -take, reason: 'market:take' });
  await takeHouse(client, Math.floor(take / 2));
  return { net, take };
}

// ── LIST — escrow the item, pay the fee, put it on the block ──
export async function listItem(ch, opts, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const live = Number((await client.query(
    "SELECT COUNT(*) n FROM market_listings WHERE seller_character=$1 AND (status='live' OR (kind='order' AND filled_qty > 0))", [ch.id])).rows[0].n); // audit #2: a cancelled order still holding warehouse goods keeps its slot
  if (live >= maxListings(h)) throw new GameError('max_listings', `The Market floors you at ${maxListings(h)} live listings.`);
  const hours = Math.min(maxTtlH(h), Math.max(1, Math.floor(Number(opts.hours) || MARKET.MAX_TTL_H)));
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  const id = uid();

  if (opts.carId) { // ── a car goes to AUCTION ──
    const car = h.owned.cars.find((c) => c.id === opts.carId);
    if (!car) throw new GameError('no_car', 'Not your iron.');
    if (car.listed) throw new GameError('listed', "It's already on the block.");
    if (car.pledged) throw new GameError('pledged', "That car's pledged as loan collateral — square the debt first."); // Loan step 2
    // NOTE: a race-flagged car MAY be listed — the transfer sinks clear race_limit/pink_slip on sale
    // (races step-two, the buyer gets a clean car), so no flag-time reject here (test/races.js:191).
    const minBid = Math.floor(Number(opts.minBid) || 0);
    if (minBid < MARKET.MIN_PRICE) throw new GameError('min_price', `The Market floor is $${MARKET.MIN_PRICE}.`);
    const buyNow = opts.buyNow != null ? Math.floor(Number(opts.buyNow)) : null;
    if (buyNow != null && buyNow < minBid) throw new GameError('bad_buy_now', 'Buy-now under the minimum bid makes no sense.');
    // step two: an optional HIDDEN reserve — bids under it never hammer (the auction lapses and
    // the seller reclaims). Must sit between the minimum bid and buy-now to be coherent.
    const reserve = opts.reserve != null ? Math.floor(Number(opts.reserve)) : null;
    if (reserve != null && (reserve < minBid || (buyNow != null && reserve > buyNow)))
      throw new GameError('bad_reserve', 'A reserve sits between the minimum bid and buy-now.');
    const fee = Math.max(MARKET.LIST_FEE_MIN, Math.floor(listFee(buyNow ?? reserve ?? minBid) * skillMult(h, 'broker', SKILLS.FX.BROKER_FEE_MULT) * masteryFx(h, 'commerce'))); // BROKER (skills) + TRADES stack; the floor re-asserts
    if (Number(ch.cash) < fee) throw new GameError('cash', `Listing runs $${fee} (1% of the ask).`);
    ch.cash = Number(ch.cash) - fee;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'market:list' });
    await client.query('UPDATE cars SET listed=true WHERE id=$1', [opts.carId]);
    car.listed = true; // keep the in-memory fleet honest (persist doesn't own car rows, but the view does)
    await client.query(
      'INSERT INTO market_listings (id, seller_character, kind, car_id, price, buy_now, reserve, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, ch.id, 'car', opts.carId, minBid, buyNow, reserve, expiresAt]);
    await bumpStanding(client, h, ch, 'harbor', 1, { action: 'list' }); // moving iron through the docks
    return { ok: true, id, kind: 'car', minBid, buyNow, reserve, fee, expiresSeconds: hours * 3600 };
  }

  // ── goods go FIXED-PRICE, pinned to this dock ──
  if (!GOODS.find((g) => g.id === opts.goodId)) throw new GameError('bad_good', 'No such good.');
  const have = h.owned.cargo[opts.goodId] || 0;
  const qty = Math.floor(Number(opts.qty) || 0);
  if (qty < 1 || qty > have) throw new GameError('qty', 'Not that much in the trunk.');
  const price = Math.floor(Number(opts.price) || 0);
  if (price < 1) throw new GameError('min_price', 'Unit price must be at least $1.');
  if (qty * price < MARKET.MIN_PRICE) throw new GameError('min_price', `The Market floor is $${MARKET.MIN_PRICE} an ask.`);
  const fee = Math.max(MARKET.LIST_FEE_MIN, Math.floor(listFee(qty * price) * skillMult(h, 'broker', SKILLS.FX.BROKER_FEE_MULT) * masteryFx(h, 'commerce')));
  if (Number(ch.cash) < fee) throw new GameError('cash', `Listing runs $${fee} (1% of the ask).`);
  ch.cash = Number(ch.cash) - fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'market:list' });
  h.owned.cargo[opts.goodId] = have - qty; // escrow OUT of the trunk (frees space — priced by the fee, bounded by MAX_LISTINGS)
  await setCargo(client, ch.id, opts.goodId, have - qty);
  await client.query(
    'INSERT INTO market_listings (id, seller_character, kind, good_id, qty, district, price, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, ch.id, 'good', opts.goodId, qty, ch.loc, price, expiresAt]);
  await bumpStanding(client, h, ch, 'harbor', 1, { action: 'list' }); // moving freight through the docks
  return { ok: true, id, kind: 'good', good: opts.goodId, qty, price, district: ch.loc, fee, expiresSeconds: hours * 3600 };
}

// ── BID (cars) — one standing bid; the outbid player is refunded on the spot ──
export async function bidListing(ch, listingId, amount, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const amt = Math.floor(Number(amount) || 0);
  // read UNLOCKED to learn the counterparty, lock THEIR character row, then the listing, then
  // re-verify — the heist-execute pattern (characters before pots, stale reads retry clean)
  const pre = (await client.query("SELECT * FROM market_listings WHERE id=$1 AND status='live'", [listingId])).rows[0];
  if (!pre || pre.kind !== 'car') throw new GameError('no_listing', 'Nothing on the block by that number.');
  if (pre.seller_character === ch.id) throw new GameError('own', "Bidding up your own iron? The Market isn't blind.");
  const prevBidder = pre.bidder && pre.bidder !== ch.id ? pre.bidder : null;
  if (prevBidder) {
    const alive = (await client.query('SELECT 1 FROM characters WHERE id=$1 AND alive FOR UPDATE', [prevBidder])).rows[0];
    if (!alive) throw new GameError('again', 'The board moved — bid again.'); // estate is clearing their bid
  }
  const l = (await client.query("SELECT * FROM market_listings WHERE id=$1 AND status='live' FOR UPDATE", [listingId])).rows[0];
  if (!l || expired(l)) throw new GameError('no_listing', 'That auction is over.');
  if ((l.bidder || null) !== (pre.bidder || null)) throw new GameError('again', 'The board moved — bid again.');
  const floor = l.bid != null
    ? Math.ceil(Number(l.bid) * (1 + MARKET.MIN_RAISE_BPS / 10000))
    : Number(l.price);
  if (amt < floor) throw new GameError('low', `The book wants $${floor} or better.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Your pocket is lighter than your mouth.');

  // refund whoever held it (self-raise refunds in-memory — never SQL-touch the actor's own row)
  if (l.bidder && Number(l.bid) > 0) {
    if (l.bidder === ch.id) ch.cash = Number(ch.cash) + Number(l.bid);
    else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
    await h.ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
    if (l.bidder !== ch.id) await h.notify(client, l.bidder, 'market_outbid', { listing: l.id, bid: amt });
  }
  ch.cash = Number(ch.cash) - amt;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'market:bid' });
  await client.query('UPDATE market_listings SET bid=$2, bidder=$3 WHERE id=$1', [listingId, amt, ch.id]);
  // step two — ANTI-SNIPE soft close: a GENUINE outbid inside the last window resets the clock
  // to a full window, so the last word goes to whoever wants it most, not whoever times the
  // buzzer. A self-raise by the current high bidder does NOT extend (audit M2: it's pointless
  // griefing — there's no snipe to guard against when you already hold the lead).
  let extended = false;
  if ((l.bidder || null) !== ch.id && new Date(l.expires_at).getTime() - Date.now() < MARKET.SNIPE_WINDOW_MS) {
    await client.query('UPDATE market_listings SET expires_at=$2 WHERE id=$1',
      [listingId, new Date(Date.now() + MARKET.SNIPE_WINDOW_MS)]);
    extended = true;
  }
  return { ok: true, id: listingId, bid: amt, extended };
}

// ── STEP TWO: standing BUY ORDERS (WTB) — the inverted listing ──
// The buyer escrows cash at THEIR dock; sellers standing there fill it from the trunk and are
// paid on the spot; the goods wait in the order's WAREHOUSE until the buyer claims them into
// trunk space. Lock shape is the simplest on the board: a fill touches ONLY the actor (seller,
// in-memory) and the order row — the buyer's character is never locked (their cash left at post).
export async function postOrder(ch, opts, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  // audit #1(b): posting a buy-order parks liquid in escrow — an extraction-prep act, so it's
  // blocked from a safehouse (the D2 discipline: a safehouse is a shield, not a money bunker).
  if (safeHoused(ch)) throw new GameError('safe', "No parking cash on the docks from a safehouse — come out first.");
  const live = Number((await client.query(
    "SELECT COUNT(*) n FROM market_listings WHERE seller_character=$1 AND (status='live' OR (kind='order' AND filled_qty > 0))", [ch.id])).rows[0].n); // audit #2: a cancelled order still holding warehouse goods keeps its slot
  if (live >= maxListings(h)) throw new GameError('max_listings', `The Market floors you at ${maxListings(h)} live listings.`);
  if (!GOODS.find((g) => g.id === opts.goodId)) throw new GameError('bad_good', 'No such good.');
  const qty = Math.floor(Number(opts.qty) || 0);
  const price = Math.floor(Number(opts.price) || 0);
  if (qty < 1) throw new GameError('qty', 'Order at least one unit.');
  // audit #2: cap the order size — an unbounded qty made the warehouse infinite off-trunk storage
  if (qty > MARKET.ORDER_MAX_QTY) throw new GameError('qty', `An order tops out at ${MARKET.ORDER_MAX_QTY} units.`);
  if (price < 1) throw new GameError('min_price', 'Unit price must be at least $1.');
  const escrow = qty * price;
  if (escrow < MARKET.MIN_PRICE) throw new GameError('min_price', `The Market floor is $${MARKET.MIN_PRICE} an ask.`);
  const fee = Math.max(MARKET.LIST_FEE_MIN, Math.floor(listFee(escrow) * skillMult(h, 'broker', SKILLS.FX.BROKER_FEE_MULT) * masteryFx(h, 'commerce')));
  if (Number(ch.cash) < escrow + fee) throw new GameError('cash', `The order escrows $${escrow} plus a $${fee} fee.`);
  const hours = Math.min(maxTtlH(h), Math.max(1, Math.floor(Number(opts.hours) || MARKET.MAX_TTL_H)));
  ch.cash = Number(ch.cash) - fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'market:list' });
  ch.cash = Number(ch.cash) - escrow;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -escrow, reason: 'market:order' });
  const id = uid();
  await client.query(
    'INSERT INTO market_listings (id, seller_character, kind, good_id, qty, district, price, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, ch.id, 'order', opts.goodId, qty, ch.loc, price, new Date(Date.now() + hours * 3600 * 1000)]);
  await bumpStanding(client, h, ch, 'harbor', 1, { action: 'list' }); // standing paper at the docks is still dock business
  return { ok: true, id, kind: 'order', good: opts.goodId, wanted: qty, price, district: ch.loc, escrow, fee, expiresSeconds: hours * 3600 };
}

// FILL — a seller at the dock delivers into the order and is paid from its escrow, minus the take.
export async function fillOrder(ch, listingId, qty, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const l = (await client.query(
    "SELECT * FROM market_listings WHERE id=$1 AND kind='order' AND status='live' FOR UPDATE", [listingId])).rows[0];
  if (!l || expired(l)) throw new GameError('no_order', 'No such order on the board.');
  if (l.seller_character === ch.id) throw new GameError('own', 'Filling your own order is just feeding the house 2%.');
  if (ch.loc !== l.district) throw new GameError('district', `Delivery is at ${l.district} — be there.`);
  const have = h.owned.cargo[l.good_id] || 0;
  const n = Math.min(Math.max(1, Math.floor(Number(qty) || have)), Number(l.qty), have);
  if (n <= 0) throw new GameError('qty', 'Nothing to deliver.');
  const gross = n * Number(l.price);
  h.owned.cargo[l.good_id] = have - n; // trunk → the order's warehouse
  await setCargo(client, ch.id, l.good_id, have - n);
  const { net } = await paySeller(client, h, ch.id, gross, { reason: 'market:fill', inMemoryCh: ch });
  await bumpMastery(client, h, ch, 'commerce', 'fill');
  // absolute writes (the pg-mem INT quirk); the row stays live at qty=0 until the buyer claims
  await client.query('UPDATE market_listings SET qty=$2, filled_qty=$3 WHERE id=$1',
    [listingId, Number(l.qty) - n, Number(l.filled_qty) + n]);
  await h.notify(client, l.seller_character, 'order_filled', { listing: l.id, good: l.good_id, qty: n });
  bus.emit('streets', { type: 'market_sale', kind: 'order' });
  return { ok: true, delivered: n, earned: net, remaining: Number(l.qty) - n };
}

// CLAIM — the buyer collects delivered goods from the warehouse, at the dock, into trunk space.
// Claimable even after cancel/expiry (the goods were bought and paid for — they never vanish
// while the street lives; they scatter only with the estate).
export async function claimOrder(ch, listingId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const l = (await client.query(
    "SELECT * FROM market_listings WHERE id=$1 AND kind='order' AND seller_character=$2 FOR UPDATE", [listingId, ch.id])).rows[0];
  if (!l) throw new GameError('no_order', 'Not your order.');
  if (ch.loc !== l.district) throw new GameError('district', `The warehouse is at ${l.district} — be there.`);
  const avail = Number(l.filled_qty);
  if (avail <= 0) throw new GameError('empty', 'Nothing delivered yet.');
  const space = Math.max(0, trunkCap(h) - cargoCount(h.owned.cargo));
  const n = Math.min(avail, space);
  if (n <= 0) throw new GameError('cargo', 'No room in the trunk.');
  h.owned.cargo[l.good_id] = (h.owned.cargo[l.good_id] || 0) + n;
  await setCargo(client, ch.id, l.good_id, h.owned.cargo[l.good_id]);
  const left = avail - n;
  await client.query('UPDATE market_listings SET filled_qty=$2 WHERE id=$1', [listingId, left]);
  if (l.status === 'live' && Number(l.qty) === 0 && left === 0)
    await client.query("UPDATE market_listings SET status='sold' WHERE id=$1", [listingId]);
  return { ok: true, claimed: n, awaiting: left };
}

// ── BUY — cars at buy-now (instant settle); goods at the dock (partial, trunk-clamped) ──
export async function buyListing(ch, listingId, qty, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const pre = (await client.query("SELECT * FROM market_listings WHERE id=$1 AND status='live'", [listingId])).rows[0];
  if (!pre) throw new GameError('no_listing', 'Nothing on the block by that number.');
  if (pre.seller_character === ch.id) throw new GameError('own', "It's already yours.");
  // lock the counterparties first (seller always; a standing bidder too on buy-now), sorted
  const toLock = [pre.seller_character, ...(pre.kind === 'car' && pre.bidder && pre.bidder !== ch.id ? [pre.bidder] : [])]
    .filter((id) => id !== ch.id).sort();
  for (const cid of toLock) {
    const alive = (await client.query('SELECT 1 FROM characters WHERE id=$1 AND alive FOR UPDATE', [cid])).rows[0];
    if (!alive) throw new GameError('again', 'The board moved — try again.');
  }
  const l = (await client.query("SELECT * FROM market_listings WHERE id=$1 AND status='live' FOR UPDATE", [listingId])).rows[0];
  if (!l || expired(l)) throw new GameError('no_listing', 'That listing is gone.');
  if ((l.bidder || null) !== (pre.bidder || null)) throw new GameError('again', 'The board moved — try again.');

  if (l.kind === 'car') {
    if (l.buy_now == null) throw new GameError('no_buy_now', 'That one goes to the hammer — bid.');
    const price = Number(l.buy_now);
    if (Number(ch.cash) < price) throw new GameError('cash', `Buy-now is $${price}.`);
    const car = (await client.query('SELECT id FROM cars WHERE id=$1', [l.car_id])).rows[0];
    if (!car) throw new GameError('again', 'The board moved — try again.');
    // refund the standing bidder — their auction just got bought out from over them
    if (l.bidder && Number(l.bid) > 0) {
      if (l.bidder === ch.id) ch.cash = Number(ch.cash) + Number(l.bid);
      else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
      await h.ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
      if (l.bidder !== ch.id) await h.notify(client, l.bidder, 'market_outbid', { listing: l.id, buyNow: true });
    }
    ch.cash = Number(ch.cash) - price;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'market:bid' });
    const { net } = await paySeller(client, h, l.seller_character, price);
    // clear the seller's RACE flags on transfer — a bought car must not arrive still on the strip for a
    // wager/pinks without the BUYER's consent (RED-TEAM: race_limit/pink_slip survived ownership change).
    await client.query('UPDATE cars SET character_id=$2, listed=false, race_limit=NULL, pink_slip=false, nos=0 WHERE id=$1', [l.car_id, ch.id]);
    await logCarCollect(client, ch.id, l.car_id); // THE COLLECTION
    const row = (await client.query('SELECT * FROM cars WHERE id=$1', [l.car_id])).rows[0];
    if (row) h.owned.cars.push(row); // the buyer's view sees the new iron this response
    await client.query("UPDATE market_listings SET status='sold', bid=NULL, bidder=NULL WHERE id=$1", [listingId]);
    await h.notify(client, l.seller_character, 'market_sold', { listing: l.id, kind: 'car', net });
    bus.emit('streets', { type: 'market_sale', kind: 'car' });
    return { ok: true, bought: 'car', carId: l.car_id, paid: price };
  }

  // ONLY sale listings (kind='good') can be bought here. A buy-ORDER (kind='order') carries a
  // qty of units WANTED backed by cash escrow, not goods — falling through to the goods branch
  // would pay the order's poster AND mint the buyer un-escrowed units (audit C1). Orders are
  // filled at the dock via fillOrder, never bought.
  if (l.kind !== 'good') throw new GameError('not_for_sale', "That's a buy-order — fill it at the dock, you don't buy it.");
  // goods: stand at the dock, take what your trunk holds, pay unit price
  if (ch.loc !== l.district) throw new GameError('district', `Pickup is at ${l.district} — be there.`);
  const want = Math.max(1, Math.floor(Number(qty) || Number(l.qty)));
  const space = Math.max(0, trunkCap(h) - cargoCount(h.owned.cargo));
  const n = Math.min(want, Number(l.qty), space);
  if (n <= 0) throw new GameError('cargo', 'No room in the trunk.');
  const gross = n * Number(l.price);
  if (Number(ch.cash) < gross) throw new GameError('cash', `${n} units run $${gross}.`);
  ch.cash = Number(ch.cash) - gross;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -gross, reason: 'market:bid' });
  const { net } = await paySeller(client, h, l.seller_character, gross);
  h.owned.cargo[l.good_id] = (h.owned.cargo[l.good_id] || 0) + n;
  await setCargo(client, ch.id, l.good_id, h.owned.cargo[l.good_id]);
  const left = Number(l.qty) - n; // absolute write — the pg-mem INT quirk
  if (left > 0) await client.query('UPDATE market_listings SET qty=$2 WHERE id=$1', [listingId, left]);
  else await client.query("UPDATE market_listings SET qty=0, status='sold' WHERE id=$1", [listingId]);
  await h.notify(client, l.seller_character, 'market_sold', { listing: l.id, kind: 'good', good: l.good_id, qty: n, net });
  bus.emit('streets', { type: 'market_sale', kind: 'good' });
  return { ok: true, bought: l.good_id, qty: n, paid: gross, remaining: left };
}

// ── CANCEL / RECLAIM — poster only, never over a standing bid; goods need trunk space;
// an order refunds its REMAINING escrow (delivered goods stay claimable — they're paid for) ──
export async function cancelListing(ch, listingId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const l = (await client.query(
    "SELECT * FROM market_listings WHERE id=$1 AND status IN ('live','expired') FOR UPDATE", [listingId])).rows[0];
  if (!l || l.seller_character !== ch.id) throw new GameError('no_listing', 'Not your listing.');
  // audit #5 (reserve-lock grief): a standing bid holds the hammer — EXCEPT a bid that can never
  // clear an unmet hidden reserve, which was only ever a lock on your iron. That one you can pull
  // out from under (the bidder is refunded), so a $50 min-bid can't freeze a reserved car for the
  // whole TTL. A bid that CAN win (no reserve, or ≥ reserve) still blocks — the hammer decides.
  const belowUnmetReserve = l.kind === 'car' && l.reserve != null && l.bidder && Number(l.bid) < Number(l.reserve);
  if (l.bidder && !belowUnmetReserve) throw new GameError('bid_standing', 'Someone holds a bid that can take it — the hammer decides now.');
  if (l.kind === 'car') {
    if (l.bidder && Number(l.bid) > 0) { // refund the locked-out under-reserve bidder (third party → SQL)
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
      await h.ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
      await notify(client, l.bidder, 'market_outbid', { listing: l.id, cancelled: true });
    }
    await client.query('UPDATE cars SET listed=false WHERE id=$1', [l.car_id]);
    const car = h.owned.cars.find((c) => c.id === l.car_id);
    if (car) car.listed = false;
  } else if (l.kind === 'order') {
    // the poster IS the actor — refund the un-filled escrow in-memory (only 'live' still holds
    // escrow; an 'expired' order was already refunded by the sweep)
    const remaining = l.status === 'live' ? Number(l.qty) * Number(l.price) : 0;
    if (remaining > 0) {
      ch.cash = Number(ch.cash) + remaining;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: remaining, reason: 'market:refund' });
    }
    await client.query("UPDATE market_listings SET qty=0, status='cancelled' WHERE id=$1", [listingId]);
    return { ok: true, cancelled: l.id, refunded: remaining, awaiting: Number(l.filled_qty) };
  } else {
    const back = (h.owned.cargo[l.good_id] || 0) + Number(l.qty);
    if (cargoCount(h.owned.cargo) + Number(l.qty) > trunkCap(h))
      throw new GameError('cargo', 'The trunk cannot take it all back — sell or make room first.');
    h.owned.cargo[l.good_id] = back;
    await setCargo(client, ch.id, l.good_id, back);
  }
  await client.query("UPDATE market_listings SET status='cancelled', bid=NULL, bidder=NULL WHERE id=$1", [listingId]);
  return { ok: true, cancelled: l.id };
}

// ── The board — public; car listings show the iron, goods show the dock ──
// Two flat queries (pg-mem can't parse correlated subqueries — the /v1/gangs precedent).
export async function marketBoard(pool) {
  const rows = (await pool.query(
    `SELECT l.*, c.name AS seller FROM market_listings l JOIN characters c ON c.id = l.seller_character
      WHERE l.status='live' ORDER BY l.expires_at ASC LIMIT 100`)).rows;
  const carRows = (await pool.query('SELECT id, model_id, trim_id, dmg, plate FROM cars WHERE listed = true')).rows;
  const carOfId = Object.fromEntries(carRows.map((c) => [c.id, c]));
  return {
    levers: { minPrice: MARKET.MIN_PRICE, minRaiseBps: MARKET.MIN_RAISE_BPS, takeBps: MARKET.TAKE_BPS,
      listFeeBps: MARKET.LIST_FEE_BPS, maxTtlH: MARKET.MAX_TTL_H, maxListings: MARKET.MAX_LISTINGS },
    listings: rows.filter((l) => !expired(l)).map((l) => ({
      id: l.id, kind: l.kind, seller: l.seller,
      ...(l.kind === 'car' ? {
        car: carOfId[l.car_id]
          ? { model: carOfId[l.car_id].model_id, trim: carOfId[l.car_id].trim_id,
              dmg: Number(carOfId[l.car_id].dmg || 0), plate: carOfId[l.car_id].plate || null }
          : null,
        minBid: Number(l.price), buyNow: l.buy_now != null ? Number(l.buy_now) : null,
        bid: l.bid != null ? Number(l.bid) : null, // the standing bid is PUBLIC; the bidder is not
        // the reserve AMOUNT stays hidden — the board only says whether the hammer would fall
        reserveMet: l.reserve == null ? null : (l.bid != null && Number(l.bid) >= Number(l.reserve)),
      } : {}),
      ...(l.kind === 'good' ? { good: l.good_id, qty: Number(l.qty), unitPrice: Number(l.price), district: l.district } : {}),
      ...(l.kind === 'order' ? { good: l.good_id, wanted: Number(l.qty), unitPrice: Number(l.price), district: l.district } : {}),
      expiresSeconds: Math.max(0, Math.ceil((new Date(l.expires_at) - Date.now()) / 1000)),
    })),
  };
}

// ── Worker sweep — settle expired car auctions; unlist everything else past its clock ──
// Per-listing txn: counterparty characters sorted FOR UPDATE → the listing (chars before pots).
export async function sweepMarket(pool) {
  const client = await pool.connect();
  let settled = 0, lapsed = 0;
  try {
    const due = (await client.query(
      "SELECT id, kind, seller_character, bidder FROM market_listings WHERE status='live' AND expires_at <= now()")).rows;
    for (const d of due) {
      await client.query('BEGIN');
      try {
        for (const cid of [d.seller_character, d.bidder].filter(Boolean).sort())
          await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
        const l = (await client.query(
          "SELECT * FROM market_listings WHERE id=$1 AND status='live' AND expires_at <= now() FOR UPDATE", [d.id])).rows[0];
        if (!l) { await client.query('COMMIT'); continue; } // raced a buy/cancel — nothing to do
        const h = { ledger, notify };
        if (l.kind === 'order') {
          // an expired order refunds its un-filled escrow to a LIVING poster (a dead poster's
          // escrow already burned in the estate — this is only a race guard); deliveries stay
          // claimable, so the row flips to 'expired' rather than vanishing.
          const remaining = Number(l.qty) * Number(l.price);
          if (remaining > 0) {
            const poster = (await client.query('SELECT 1 FROM characters WHERE id=$1 AND alive', [l.seller_character])).rows[0];
            if (poster) {
              await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.seller_character, remaining]);
              await ledger(client, { characterId: l.seller_character, currency: 'cash', amount: remaining, reason: 'market:refund' });
            } else await ledger(client, { currency: 'cash', amount: -remaining, reason: 'market:death' });
          }
          await client.query("UPDATE market_listings SET qty=0, status='expired' WHERE id=$1", [l.id]);
          await notify(client, l.seller_character, 'order_expired', { listing: l.id, refunded: remaining, awaiting: Number(l.filled_qty) });
          lapsed++;
        } else if (l.kind === 'car' && l.bidder && Number(l.bid) > 0 &&
                   l.reserve != null && Number(l.bid) < Number(l.reserve)) {
          // step two: the RESERVE was never met — the hammer stays up; the bidder is refunded
          // (or burned if the estate is racing us) and the seller reclaims via cancel.
          const bidderAlive = (await client.query('SELECT 1 FROM characters WHERE id=$1 AND alive', [l.bidder])).rows[0];
          if (bidderAlive) {
            await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
            await ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
            await notify(client, l.bidder, 'market_reserve', { listing: l.id, bid: Number(l.bid) });
          } else await ledger(client, { currency: 'cash', amount: -Number(l.bid), reason: 'market:death' });
          await client.query("UPDATE market_listings SET status='expired', bid=NULL, bidder=NULL WHERE id=$1", [l.id]);
          await notify(client, l.seller_character, 'market_reserve', { listing: l.id, seller: true });
          lapsed++;
        } else if (l.kind === 'car' && l.bidder && Number(l.bid) > 0) {
          // the hammer falls: highest bid wins
          const seller = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [l.seller_character])).rows[0];
          const winner = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [l.bidder])).rows[0];
          const car = (await client.query('SELECT id FROM cars WHERE id=$1', [l.car_id])).rows[0];
          if (seller && winner && car) {
            const bid = Number(l.bid);
            await paySeller(client, h, l.seller_character, bid);
            await client.query('UPDATE cars SET character_id=$2, listed=false, race_limit=NULL, pink_slip=false, nos=0 WHERE id=$1', [l.car_id, l.bidder]); // clear race flags on transfer (buyer consent)
            await logCarCollect(client, l.bidder, l.car_id); // THE COLLECTION
            await client.query("UPDATE market_listings SET status='sold', bid=NULL, bidder=NULL WHERE id=$1", [l.id]);
            await notify(client, l.seller_character, 'market_sold', { listing: l.id, kind: 'car', net: bid - Math.ceil(bid * MARKET.TAKE_BPS / 10000) });
            await notify(client, l.bidder, 'market_won', { listing: l.id, carId: l.car_id, bid });
            settled++;
          } else {
            // a party or the iron died since — refund a living winner, void the listing
            if (winner) {
              await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
              await ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
            } else if (Number(l.bid) > 0) {
              await ledger(client, { currency: 'cash', amount: -Number(l.bid), reason: 'market:death' });
            }
            if (car) await client.query('UPDATE cars SET listed=false WHERE id=$1', [l.car_id]);
            await client.query("UPDATE market_listings SET status='cancelled', bid=NULL, bidder=NULL WHERE id=$1", [l.id]);
            lapsed++;
          }
        } else {
          // no bid (or goods): flip to 'expired' — the seller reclaims via cancel (goods are
          // space-gated there; cars could auto-unlist but one pull-based path keeps it simple)
          await client.query("UPDATE market_listings SET status='expired' WHERE id=$1", [l.id]);
          lapsed++;
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); console.error('market sweep: listing failed', d.id, e?.code || e); }
    }
    return { settled, lapsed };
  } finally { client.release(); }
}

// runEstate hooks (called with the estate's client, chars already locked):
// the dead man's LISTINGS die — standing bids refunded (killer-as-bidder threads in-memory via
// killerCh, the refundPot discipline); goods scatter, cars fall with the fleet wipe anyway.
export async function voidListingsAtDeath(client, victimId, killerCh, lootRate = 0) {
  let selfRefund = 0, looted = 0;
  const rows = (await client.query(
    "SELECT * FROM market_listings WHERE seller_character=$1 AND status IN ('live','expired') FOR UPDATE", [victimId])).rows;
  for (const l of rows) {
    if (l.kind === 'order') {
      // the dead poster's un-filled escrow leaves the market. On a PLAYER fire-kill (lootRate > 0)
      // the killer takes CASH_LOOT_RATE of it — liquid parked in a WTB is lootable like pocket
      // cash (audit #1: else it was a loot-proof vault). The rest BURNS (the dead-funder
      // precedent); undelivered warehouse goods scatter with the row. NPC/mod kills don't loot.
      const remaining = l.status === 'live' ? Number(l.qty) * Number(l.price) : 0;
      if (remaining > 0) {
        const loot = killerCh && lootRate > 0 ? Math.floor(remaining * lootRate) : 0;
        if (loot > 0) {
          killerCh.cash = Number(killerCh.cash) + loot; // the killer is the in-memory actor — never SQL (persist clobber)
          looted += loot;
          await ledger(client, { characterId: killerCh.id, currency: 'cash', amount: loot, reason: 'whack:loot', counterparty: victimId });
          await ledger(client, { currency: 'cash', amount: -loot, reason: 'market:loot', counterparty: victimId }); // escrow-side outflow
        }
        const burn = remaining - loot;
        if (burn > 0) await ledger(client, { currency: 'cash', amount: -burn, reason: 'market:death', counterparty: victimId });
      }
    } else if (l.bidder && Number(l.bid) > 0) {
      if (killerCh && l.bidder === killerCh.id) selfRefund += Number(l.bid);
      else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
      await ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
      await notify(client, l.bidder, 'market_outbid', { listing: l.id, voided: true });
    }
  }
  await client.query("DELETE FROM market_listings WHERE seller_character=$1", [victimId]);
  return { selfRefund, looted };
}
// the dead man's standing BIDS burn (the dead-funder precedent) — the auctions reopen.
export async function burnBidsAtDeath(client, victimId) {
  const rows = (await client.query(
    "SELECT id, bid FROM market_listings WHERE bidder=$1 AND status='live' FOR UPDATE", [victimId])).rows;
  for (const l of rows) {
    if (Number(l.bid) > 0) await ledger(client, { currency: 'cash', amount: -Number(l.bid), reason: 'market:death' });
    await client.query('UPDATE market_listings SET bid=NULL, bidder=NULL WHERE id=$1', [l.id]);
  }
  return { burned: rows.length };
}
