// THE AUCTION HOUSE ("the sit-down") — the COMPETITIVE, RECURRING $OMR sink. Weekly server-drawn lots
// of unique numbered prestige items; highest $OMR bid wins, the winning bid BURNS (deflationary).
// Status-only (won items are account-level trophies, no gameplay power → outside the sim-audited
// balance). Bids ESCROW $OMR — the bounty/loan/market-escrow twin on the $OMR side:
//   auction:bid    account → escrow (a TRANSFER; escrow is in omrBuckets)
//   auction:refund escrow  → account (outbid → the previous bidder gets their $OMR back; a TRANSFER)
//   auction:win    escrow  → burn    (the winning bid leaves the game; the ONLY deflation)
// $OMR is account-level (survives death) so a live bid needs NO death handling. Lots settle in the
// worker (`sweepAuctions`) once their week is over — the loser was already refunded on every outbid.
import crypto from 'node:crypto';
import { GameError, ledger, notify } from './game.js';
import { AUCTION, auctionLotsOf, weekOf, collectionSetsOf, collectorRankOf } from './rules.js';
import { spendOmr } from './vanity.js';
import { bumpPrestige, patronOfSeason } from './estate.js';

// The block: this week's lots (with any live bid), plus your won trophies. Read-only.
export async function auctionBoard(ch, client, h) {
  const week = weekOf();
  const lots = auctionLotsOf(week);
  const rows = (await client.query("SELECT lot_id, current_bid, bidder, status FROM auctions WHERE week=$1", [week])).rows;
  const byLot = Object.fromEntries(rows.map((r) => [r.lot_id, r]));
  const board = lots.map((l) => {
    const r = byLot[l.id];
    const bid = r ? Number(r.current_bid) : 0;
    const minNext = bid > 0 ? Math.ceil(bid * (1 + AUCTION.MIN_RAISE_BPS / 10000)) : l.min;
    return { id: l.id, name: l.name, serial: l.serial, blurb: l.blurb, minBid: l.min,
      currentBid: bid, minNext, youLead: !!(r && r.bidder === ch.account_id), status: r?.status || 'open' };
  });
  const winRows = (await client.query('SELECT lot_id, archetype, name, serial, price, listed, won_at FROM auction_wins WHERE account_id=$1 ORDER BY won_at DESC', [ch.account_id])).rows;
  const wins = winRows.map((w) => ({ lot: w.lot_id, name: w.name, serial: w.serial, price: Math.floor(Number(w.price)),
    archetype: w.archetype, listed: !!w.listed }));
  // Tier-4 — THE BLOCK (RESALE): every LIVE consignment on the floor (yours flagged), your read-derived
  // COLLECTION SETS, the Patron of the Season, and your Collector legend.
  const consignments = (await client.query(
    "SELECT id, seller_account, name, serial, reserve, current_bid, bidder, closes_at FROM auction_consignments WHERE status='live' ORDER BY closes_at")).rows
    .map((c) => { const bid = Number(c.current_bid);
      return { id: c.id, name: c.name, serial: c.serial, currentBid: bid,
        minNext: bid > 0 ? Math.ceil(bid * (1 + AUCTION.CONSIGN.MIN_RAISE_BPS / 10000)) : AUCTION.CONSIGN.MIN_RESERVE,
        reserveMet: c.bidder ? bid >= Number(c.reserve) : false, // hide the exact reserve; show only whether it's met
        youLead: c.bidder === ch.account_id, mine: c.seller_account === ch.account_id,
        closesSeconds: Math.max(0, Math.ceil((new Date(c.closes_at) - Date.now()) / 1000)) }; });
  const sunk = Number(h.acct?.prestige_sunk || 0);
  return { week, closesInSeconds: Math.max(0, (week + 1) * 7 * 86400 - Math.floor(Date.now() / 1000)),
    lots: board, wins, consignments, sets: collectionSetsOf(winRows), patron: await patronOfSeason(client),
    collector: { sunk: Math.floor(sunk), rank: collectorRankOf(sunk).name, seasonSunk: Math.floor(Number(h.acct?.season_sunk || 0)) },
    consign: AUCTION.CONSIGN, omr: Number(h.acct.omr || 0) };
}

// Place / raise a bid on one of THIS week's lots. Escrows the bid, refunds the previous top bidder.
export async function bidAuction(ch, lotId, amount, client, h) {
  const week = weekOf();
  const lot = auctionLotsOf(week).find((l) => l.id === lotId);
  if (!lot) throw new GameError('lot', "That lot isn't on this week's block.");
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new GameError('amount', 'Name a real number.');
  // lock the lot row (materialize on first bid) — characters→accounts (held by withCharacter)→auctions
  const row = (await client.query('SELECT * FROM auctions WHERE lot_id=$1 FOR UPDATE', [lotId])).rows[0];
  if (row && row.status !== 'live') throw new GameError('closed', 'That lot already went under the hammer.');
  const curBid = row ? Number(row.current_bid) : 0;
  const curBidder = row ? row.bidder : null;
  const minBid = curBidder ? Math.ceil(curBid * (1 + AUCTION.MIN_RAISE_BPS / 10000)) : lot.min;
  if (amt < minBid) throw new GameError('low', `The bid to beat is ${minBid} $OMR.`);
  if (Number(h.acct.omr) < amt) throw new GameError('omr', `You're ${amt - Math.floor(Number(h.acct.omr))} $OMR short.`);
  // escrow the new bid from the actor (account → escrow)
  h.acct.omr = Number(h.acct.omr) - amt;
  await ledger(client, { accountId: ch.account_id, currency: 'omr', amount: -amt, reason: 'auction:bid' });
  // refund the previous top bidder (escrow → account). Self-raise refunds in-memory (persistAccount
  // commits h.acct); a DIFFERENT account is credited by direct SQL (a third party — not clobbered).
  if (curBidder && curBid > 0) {
    if (curBidder === ch.account_id) h.acct.omr = Number(h.acct.omr) + curBid;
    else {
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [curBidder, curBid]);
      const ob = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [curBidder])).rows[0];
      if (ob) await notify(client, ob.id, 'outbid', { name: lot.name, by: amt });
    }
    await ledger(client, { accountId: curBidder, currency: 'omr', amount: curBid, reason: 'auction:refund' });
  }
  if (row) await client.query('UPDATE auctions SET current_bid=$2, bidder=$3 WHERE lot_id=$1', [lotId, amt, ch.account_id]);
  else await client.query('INSERT INTO auctions (lot_id, week, archetype, current_bid, bidder) VALUES ($1,$2,$3,$4,$5)',
    [lotId, week, lot.archetype, amt, ch.account_id]);
  await h.track(client, ch.account_id, 'auction_bid', { lot: lotId, amt });
  return { ok: true, lot: lotId, name: lot.name, bid: amt,
    minNext: Math.ceil(amt * (1 + AUCTION.MIN_RAISE_BPS / 10000)), youLead: true };
}

// The worker settles lots whose week is over: the top bidder WINS the trophy, the winning bid BURNS.
// Per-lot txn, lot row locked (serializes vs a late bid — though bids can't land on a past-week lot).
export async function sweepAuctions(pool) {
  const cur = weekOf();
  const due = (await pool.query("SELECT lot_id FROM auctions WHERE status='live' AND week < $1 ORDER BY lot_id", [cur])).rows;
  let settled = 0, burned = 0;
  for (const { lot_id } of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query("SELECT * FROM auctions WHERE lot_id=$1 AND status='live' FOR UPDATE", [lot_id])).rows[0];
      if (!row) { await client.query('ROLLBACK'); continue; }
      const bid = Number(row.current_bid);
      if (row.bidder && bid > 0) {
        const lot = auctionLotsOf(row.week).find((l) => l.id === lot_id) || { name: row.archetype, serial: '' };
        // burn the winning bid (escrow → gone) — the only $OMR the auction removes
        await ledger(client, { accountId: row.bidder, currency: 'omr', amount: -bid, reason: 'auction:win' });
        await bumpPrestige(client, row.bidder, bid); // THE COLLECTOR legend — the winner sank the bid
        await client.query('INSERT INTO auction_wins (account_id, lot_id, archetype, name, serial, price) VALUES ($1,$2,$3,$4,$5,$6)',
          [row.bidder, lot_id, row.archetype, lot.name, lot.serial, bid]);
        const wc = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [row.bidder])).rows[0];
        if (wc) await notify(client, wc.id, 'auction_won', { name: lot.name, serial: lot.serial, price: bid });
        burned += bid;
      }
      await client.query("UPDATE auctions SET status='settled' WHERE lot_id=$1", [lot_id]);
      await client.query('COMMIT');
      settled++;
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepAuctions] lot', lot_id, e?.message || e); } // observability (B-L9): a poison lot no longer settles silently
    finally { client.release(); }
  }
  return { settled, burned };
}

// ══════════ TIER-4 — THE BLOCK (RESALE): PLAYER CONSIGNMENT ══════════
// Put an OWNED auction trophy back on the block for a player-set reserve. Bidders escrow $OMR (the exact
// bid machinery — reasons auction:bid/auction:refund, transfers inside omrBuckets); at settle the winning
// bid TRANSFERS to the seller minus a house TAKE that BURNS (deflationary — the auction house's vig), and
// the trophy (auction_wins row) reassigns to the buyer (a pure ownership move). Unsold → bidder refunded,
// trophy returns. Lock order = the audited auction posture: actor account (withCharacter) → the leaf
// consignment/auction_wins rows. §10.4: escrow spans BOTH tables; auction:consign is a transfer OUT of
// escrow, auction:take + auction:consign:fee are burns.

// List a won trophy for resale. A §10.4 `auction:consign:fee` $OMR burn (anti-spam), no escrow yet.
export async function consignTrophy(ch, lotId, reserve, client, h) {
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', "No dealing from a cell.");
  const res = Math.floor(Number(reserve));
  if (!Number.isFinite(res) || res < AUCTION.CONSIGN.MIN_RESERVE || res > AUCTION.CONSIGN.MAX_RESERVE)
    throw new GameError('reserve', `Set a reserve between ${AUCTION.CONSIGN.MIN_RESERVE} and ${AUCTION.CONSIGN.MAX_RESERVE} $OMR.`);
  const w = (await client.query('SELECT * FROM auction_wins WHERE account_id=$1 AND lot_id=$2 FOR UPDATE', [ch.account_id, lotId])).rows[0];
  if (!w) throw new GameError('not_owned', "That trophy isn't in your collection.");
  if (w.listed) throw new GameError('listed', "That trophy is already on the block.");
  const live = Number((await client.query("SELECT COUNT(*) n FROM auction_consignments WHERE seller_account=$1 AND status='live'", [ch.account_id])).rows[0].n);
  if (live >= AUCTION.CONSIGN.MAX_LIVE) throw new GameError('max_live', `You can only run ${AUCTION.CONSIGN.MAX_LIVE} lots at once.`);
  await spendOmr(client, h, AUCTION.CONSIGN.FEE_OMR, 'auction:consign:fee'); // the listing fee BURNS
  await bumpPrestige(client, ch.account_id, AUCTION.CONSIGN.FEE_OMR);        // the fee counts toward the Collector legend
  await client.query('UPDATE auction_wins SET listed=true WHERE account_id=$1 AND lot_id=$2', [ch.account_id, lotId]);
  const id = crypto.randomUUID();
  const closesAt = new Date(Date.now() + AUCTION.CONSIGN.MS); // JS-computed (pg-mem interval arithmetic is dicey)
  await client.query(
    `INSERT INTO auction_consignments (id, seller_account, trophy_lot_id, archetype, name, serial, reserve, closes_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, ch.account_id, lotId, w.archetype, w.name, w.serial, res, closesAt]);
  await h.track(client, ch.account_id, 'auction_consign', { lot: lotId, reserve: res });
  return { ok: true, id, name: w.name, serial: w.serial, reserve: res, fee: AUCTION.CONSIGN.FEE_OMR,
    closesHours: Math.round(AUCTION.CONSIGN.MS / 3600000) };
}

// Bid / raise on a live consignment — the bidAuction twin (escrow the bid, refund the previous top bidder).
export async function bidConsignment(ch, id, amount, client, h) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new GameError('amount', 'Name a real number.');
  const row = (await client.query('SELECT * FROM auction_consignments WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new GameError('lot', "That lot isn't on the block.");
  if (row.status !== 'live' || new Date(row.closes_at) <= new Date()) throw new GameError('closed', 'That lot already closed.');
  if (row.seller_account === ch.account_id) throw new GameError('own', "You can't bid on your own consignment.");
  const curBid = Number(row.current_bid), curBidder = row.bidder;
  const minBid = curBidder ? Math.ceil(curBid * (1 + AUCTION.CONSIGN.MIN_RAISE_BPS / 10000)) : Math.max(AUCTION.CONSIGN.MIN_RESERVE, 1);
  if (amt < minBid) throw new GameError('low', `The bid to beat is ${minBid} $OMR.`);
  if (Number(h.acct.omr) < amt) throw new GameError('omr', `You're ${amt - Math.floor(Number(h.acct.omr))} $OMR short.`);
  h.acct.omr = Number(h.acct.omr) - amt;
  await ledger(client, { accountId: ch.account_id, currency: 'omr', amount: -amt, reason: 'auction:bid' });
  if (curBidder && curBid > 0) {
    if (curBidder === ch.account_id) h.acct.omr = Number(h.acct.omr) + curBid; // (own-bid can't happen — self is blocked above — but mirror bidAuction)
    else {
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [curBidder, curBid]);
      const ob = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [curBidder])).rows[0];
      if (ob) await notify(client, ob.id, 'outbid', { name: row.name, by: amt });
    }
    await ledger(client, { accountId: curBidder, currency: 'omr', amount: curBid, reason: 'auction:refund' });
  }
  await client.query('UPDATE auction_consignments SET current_bid=$2, bidder=$3 WHERE id=$1', [id, amt, ch.account_id]);
  await h.track(client, ch.account_id, 'auction_consign_bid', { id, amt });
  return { ok: true, id, name: row.name, bid: amt, minNext: Math.ceil(amt * (1 + AUCTION.CONSIGN.MIN_RAISE_BPS / 10000)), youLead: true };
}

// Pull your own consignment — ONLY when there's no standing bid (nothing to refund). Clears listed.
export async function reclaimConsignment(ch, id, client, h) {
  const row = (await client.query('SELECT * FROM auction_consignments WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new GameError('lot', 'No such consignment.');
  if (row.seller_account !== ch.account_id) throw new GameError('not_yours', "That's not your lot.");
  if (row.status !== 'live') throw new GameError('closed', 'That lot already closed.');
  if (row.bidder && Number(row.current_bid) > 0) throw new GameError('has_bid', "There's a bid on it — you can't pull it now.");
  await client.query("UPDATE auction_consignments SET status='cancelled' WHERE id=$1", [id]);
  await client.query('UPDATE auction_wins SET listed=false WHERE account_id=$1 AND lot_id=$2', [ch.account_id, row.trophy_lot_id]);
  return { ok: true, id, name: row.name };
}

// The worker settles expired consignments: reserve MET → the buyer takes the trophy, the seller is paid
// net, the house take BURNS; reserve UNMET / no bid → the top bidder refunded, the trophy returns. Per-lot
// txn, consignment row locked. The live-vs-closed partition (bids only while live; settle only after
// closes_at) means no same-row AB-BA with bidConsignment (the sweepAuctions precedent).
export async function sweepConsignments(pool) {
  const due = (await pool.query("SELECT id FROM auction_consignments WHERE status='live' AND closes_at <= now() ORDER BY id")).rows;
  let sold = 0, unsold = 0, burned = 0;
  for (const { id } of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query("SELECT * FROM auction_consignments WHERE id=$1 AND status='live' FOR UPDATE", [id])).rows[0];
      if (!row) { await client.query('ROLLBACK'); continue; }
      const bid = Number(row.current_bid);
      const met = row.bidder && bid >= Number(row.reserve);
      if (met) {
        const net = Math.floor(bid * (1 - AUCTION.CONSIGN.TAKE_BPS / 10000));
        const take = bid - net;
        // the seller is paid net (escrow → seller, a TRANSFER); the take BURNS (escrow → gone)
        await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [row.seller_account, net]);
        await ledger(client, { accountId: row.seller_account, currency: 'omr', amount: net, reason: 'auction:consign' });
        if (take > 0) await ledger(client, { accountId: row.bidder, currency: 'omr', amount: -take, reason: 'auction:take' });
        // the trophy reassigns to the buyer (a pure ownership move; the only writer of this row in the txn)
        await client.query('UPDATE auction_wins SET account_id=$1, listed=false WHERE lot_id=$2 AND account_id=$3',
          [row.bidder, row.trophy_lot_id, row.seller_account]);
        await bumpPrestige(client, row.bidder, bid); // the buyer sank the winning bid (Collector legend)
        const bc = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [row.bidder])).rows[0];
        if (bc) await notify(client, bc.id, 'consign_won', { name: row.name, serial: row.serial, price: bid });
        const sc = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [row.seller_account])).rows[0];
        if (sc) await notify(client, sc.id, 'consign_sold', { name: row.name, net });
        await client.query("UPDATE auction_consignments SET status='sold' WHERE id=$1", [id]);
        burned += take; sold++;
      } else {
        // no bid or reserve unmet — refund the top bidder (if any), the trophy returns to the seller
        if (row.bidder && bid > 0) {
          await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [row.bidder, bid]);
          await ledger(client, { accountId: row.bidder, currency: 'omr', amount: bid, reason: 'auction:refund' });
          const rb = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [row.bidder])).rows[0];
          if (rb) await notify(client, rb.id, 'consign_lost', { name: row.name });
        }
        await client.query('UPDATE auction_wins SET listed=false WHERE lot_id=$1 AND account_id=$2', [row.trophy_lot_id, row.seller_account]);
        await client.query("UPDATE auction_consignments SET status='unsold' WHERE id=$1", [id]);
        unsold++;
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepConsignments]', id, e?.message || e); }
    finally { client.release(); }
  }
  return { sold, unsold, burned };
}
