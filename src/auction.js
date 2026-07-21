// THE AUCTION HOUSE ("the sit-down") — the COMPETITIVE, RECURRING $OMR sink. Weekly server-drawn lots
// of unique numbered prestige items; highest $OMR bid wins, the winning bid BURNS (deflationary).
// Status-only (won items are account-level trophies, no gameplay power → outside the sim-audited
// balance). Bids ESCROW $OMR — the bounty/loan/market-escrow twin on the $OMR side:
//   auction:bid    account → escrow (a TRANSFER; escrow is in omrBuckets)
//   auction:refund escrow  → account (outbid → the previous bidder gets their $OMR back; a TRANSFER)
//   auction:win    escrow  → burn    (the winning bid leaves the game; the ONLY deflation)
// $OMR is account-level (survives death) so a live bid needs NO death handling. Lots settle in the
// worker (`sweepAuctions`) once their week is over — the loser was already refunded on every outbid.
import { GameError, ledger, notify } from './game.js';
import { AUCTION, auctionLotsOf, weekOf } from './rules.js';

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
  const wins = (await client.query('SELECT lot_id, name, serial, price, won_at FROM auction_wins WHERE account_id=$1 ORDER BY won_at DESC', [ch.account_id])).rows
    .map((w) => ({ lot: w.lot_id, name: w.name, serial: w.serial, price: Math.floor(Number(w.price)) }));
  return { week, closesInSeconds: Math.max(0, (week + 1) * 7 * 86400 - Math.floor(Date.now() / 1000)),
    lots: board, wins, omr: Number(h.acct.omr || 0) };
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
