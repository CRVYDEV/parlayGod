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
import { GameError, bus, ledger, notify } from './game.js';
import { BLACK_MARKET as MARKET, GOODS, cargoCapacity } from './rules.js';

const uid = () => crypto.randomUUID();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
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

// settle the money side of a sale: seller nets hammer − take; take half → street tax, half
// burns — the NULL `market:take` row is what closes the §10.4 escrow identity exactly.
async function paySeller(client, h, sellerId, hammer) {
  const take = Math.ceil(hammer * MARKET.TAKE_BPS / 10000);
  const net = hammer - take;
  await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [sellerId, net]);
  await h.ledger(client, { characterId: sellerId, currency: 'cash', amount: net, reason: 'market:sale' });
  await h.ledger(client, { currency: 'cash', amount: -take, reason: 'market:take' });
  await takeHouse(client, Math.floor(take / 2));
  return { net, take };
}

// ── LIST — escrow the item, pay the fee, put it on the block ──
export async function listItem(ch, opts, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const live = Number((await client.query(
    "SELECT COUNT(*) n FROM market_listings WHERE seller_character=$1 AND status='live'", [ch.id])).rows[0].n);
  if (live >= MARKET.MAX_LISTINGS) throw new GameError('max_listings', `The Market floors you at ${MARKET.MAX_LISTINGS} live listings.`);
  const hours = Math.min(MARKET.MAX_TTL_H, Math.max(1, Math.floor(Number(opts.hours) || MARKET.MAX_TTL_H)));
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000);
  const id = uid();

  if (opts.carId) { // ── a car goes to AUCTION ──
    const car = h.owned.cars.find((c) => c.id === opts.carId);
    if (!car) throw new GameError('no_car', 'Not your iron.');
    if (car.listed) throw new GameError('listed', "It's already on the block.");
    const minBid = Math.floor(Number(opts.minBid) || 0);
    if (minBid < MARKET.MIN_PRICE) throw new GameError('min_price', `The Market floor is $${MARKET.MIN_PRICE}.`);
    const buyNow = opts.buyNow != null ? Math.floor(Number(opts.buyNow)) : null;
    if (buyNow != null && buyNow < minBid) throw new GameError('bad_buy_now', 'Buy-now under the minimum bid makes no sense.');
    const fee = listFee(buyNow ?? minBid);
    if (Number(ch.cash) < fee) throw new GameError('cash', `Listing runs $${fee} (1% of the ask).`);
    ch.cash = Number(ch.cash) - fee;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'market:list' });
    await client.query('UPDATE cars SET listed=true WHERE id=$1', [opts.carId]);
    car.listed = true; // keep the in-memory fleet honest (persist doesn't own car rows, but the view does)
    await client.query(
      'INSERT INTO market_listings (id, seller_character, kind, car_id, price, buy_now, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, ch.id, 'car', opts.carId, minBid, buyNow, expiresAt]);
    return { ok: true, id, kind: 'car', minBid, buyNow, fee, expiresSeconds: hours * 3600 };
  }

  // ── goods go FIXED-PRICE, pinned to this dock ──
  if (!GOODS.find((g) => g.id === opts.goodId)) throw new GameError('bad_good', 'No such good.');
  const have = h.owned.cargo[opts.goodId] || 0;
  const qty = Math.floor(Number(opts.qty) || 0);
  if (qty < 1 || qty > have) throw new GameError('qty', 'Not that much in the trunk.');
  const price = Math.floor(Number(opts.price) || 0);
  if (price < 1) throw new GameError('min_price', 'Unit price must be at least $1.');
  if (qty * price < MARKET.MIN_PRICE) throw new GameError('min_price', `The Market floor is $${MARKET.MIN_PRICE} an ask.`);
  const fee = listFee(qty * price);
  if (Number(ch.cash) < fee) throw new GameError('cash', `Listing runs $${fee} (1% of the ask).`);
  ch.cash = Number(ch.cash) - fee;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'market:list' });
  h.owned.cargo[opts.goodId] = have - qty; // escrow OUT of the trunk (frees space — priced by the fee, bounded by MAX_LISTINGS)
  await setCargo(client, ch.id, opts.goodId, have - qty);
  await client.query(
    'INSERT INTO market_listings (id, seller_character, kind, good_id, qty, district, price, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, ch.id, 'good', opts.goodId, qty, ch.loc, price, expiresAt]);
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
  return { ok: true, id: listingId, bid: amt };
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
    await client.query('UPDATE cars SET character_id=$2, listed=false WHERE id=$1', [l.car_id, ch.id]);
    const row = (await client.query('SELECT * FROM cars WHERE id=$1', [l.car_id])).rows[0];
    if (row) h.owned.cars.push(row); // the buyer's view sees the new iron this response
    await client.query("UPDATE market_listings SET status='sold', bid=NULL, bidder=NULL WHERE id=$1", [listingId]);
    await h.notify(client, l.seller_character, 'market_sold', { listing: l.id, kind: 'car', net });
    bus.emit('streets', { type: 'market_sale', kind: 'car' });
    return { ok: true, bought: 'car', carId: l.car_id, paid: price };
  }

  // goods: stand at the dock, take what your trunk holds, pay unit price
  if (ch.loc !== l.district) throw new GameError('district', `Pickup is at ${l.district} — be there.`);
  const want = Math.max(1, Math.floor(Number(qty) || Number(l.qty)));
  const space = Math.max(0, cargoCapacity(h.owned.assets) - cargoCount(h.owned.cargo));
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

// ── CANCEL / RECLAIM — seller only, never over a standing bid; goods need trunk space ──
export async function cancelListing(ch, listingId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No dealing from lockup.');
  const l = (await client.query(
    "SELECT * FROM market_listings WHERE id=$1 AND status IN ('live','expired') FOR UPDATE", [listingId])).rows[0];
  if (!l || l.seller_character !== ch.id) throw new GameError('no_listing', 'Not your listing.');
  if (l.bidder) throw new GameError('bid_standing', 'Someone holds a bid — the hammer decides now.');
  if (l.kind === 'car') {
    await client.query('UPDATE cars SET listed=false WHERE id=$1', [l.car_id]);
    const car = h.owned.cars.find((c) => c.id === l.car_id);
    if (car) car.listed = false;
  } else {
    const back = (h.owned.cargo[l.good_id] || 0) + Number(l.qty);
    if (cargoCount(h.owned.cargo) + Number(l.qty) > cargoCapacity(h.owned.assets))
      throw new GameError('cargo', 'The trunk cannot take it all back — sell or make room first.');
    h.owned.cargo[l.good_id] = back;
    await setCargo(client, ch.id, l.good_id, back);
  }
  await client.query("UPDATE market_listings SET status='cancelled' WHERE id=$1", [listingId]);
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
      } : {}),
      ...(l.kind === 'good' ? { good: l.good_id, qty: Number(l.qty), unitPrice: Number(l.price), district: l.district } : {}),
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
        if (l.kind === 'car' && l.bidder && Number(l.bid) > 0) {
          // the hammer falls: highest bid wins
          const seller = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [l.seller_character])).rows[0];
          const winner = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [l.bidder])).rows[0];
          const car = (await client.query('SELECT id FROM cars WHERE id=$1', [l.car_id])).rows[0];
          if (seller && winner && car) {
            const bid = Number(l.bid);
            await paySeller(client, h, l.seller_character, bid);
            await client.query('UPDATE cars SET character_id=$2, listed=false WHERE id=$1', [l.car_id, l.bidder]);
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
export async function voidListingsAtDeath(client, victimId, killerCh) {
  let selfRefund = 0;
  const rows = (await client.query(
    "SELECT * FROM market_listings WHERE seller_character=$1 AND status IN ('live','expired') FOR UPDATE", [victimId])).rows;
  for (const l of rows) {
    if (l.bidder && Number(l.bid) > 0) {
      if (killerCh && l.bidder === killerCh.id) selfRefund += Number(l.bid);
      else await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [l.bidder, Number(l.bid)]);
      await ledger(client, { characterId: l.bidder, currency: 'cash', amount: Number(l.bid), reason: 'market:refund' });
      await notify(client, l.bidder, 'market_outbid', { listing: l.id, voided: true });
    }
  }
  await client.query("DELETE FROM market_listings WHERE seller_character=$1", [victimId]);
  return { selfRefund };
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
