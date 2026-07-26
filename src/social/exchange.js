// The escrowed Exchange (§5.4) — cb and ammo listed between players.
//
// Self-contained and unrelated to the PvP layer around it; it shares this package only because
// it shipped in M3.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, ledger } from '../game.js';
import { CONSUMABLES } from '../rules.js';
import { takeHouse, uid } from './shared.js';

// ═══════════════════ THE EXCHANGE (§5.4 — escrowed order book) ═══════════════════
// cb, ammo, and crafted consumables only; product (drugs) is rejected as item_kind.
const KIND_OK = ['cb', 'ammo', 'item'];


export async function listItem(ch, kind, itemId, qty, unitPrice, client, h) {
  if (!KIND_OK.includes(kind)) throw new GameError('bad_kind', 'Sellable: cb, ammo, item. Product moves on the street, not the board.');
  const n = Math.max(1, Math.floor(Number(qty) || 0));
  const price = Math.max(1, Math.floor(Number(unitPrice) || 0));
  if (kind === 'item' && !CONSUMABLES.find((c) => c.id === itemId)) throw new GameError('bad_item', 'No such item.');
  const have = kind === 'cb' ? Number(ch.cb) : kind === 'ammo' ? Number(ch.ammo) : (h.owned.items[itemId] || 0);
  if (have < n) throw new GameError('short', "You can't sell what you don't have.");
  // Escrow moves goods character → the `listings` bucket, which the §10.4 job counts
  // as live inventory — so it is an INTERNAL transfer and must NOT be ledgered (a
  // ledger sink would double-count against the escrow bucket). Only forfeiture at
  // death removes cb/ammo from the system, and that path ledgers `death:escrow`.
  if (kind === 'cb') { ch.cb = Number(ch.cb) - n; }
  else if (kind === 'ammo') { ch.ammo = Number(ch.ammo) - n; }
  else {
    const left = (h.owned.items[itemId] || 0) - n;
    h.owned.items[itemId] = left;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, itemId]);
    if (left > 0) await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, itemId, left]);
  }
  const id = uid();
  await client.query('INSERT INTO listings (id, seller_character, item_kind, item_id, qty, unit_price) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, ch.id, kind, kind === 'item' ? itemId : kind, n, price]);
  return { ok: true, listingId: id };
}


export async function cancelListing(ch, listingId, client, h) {
  const l = (await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [listingId])).rows[0];
  if (!l || l.seller_character !== ch.id) throw new GameError('no_listing', 'Not your listing.');
  await client.query('DELETE FROM listings WHERE id=$1', [listingId]);
  await returnEscrow(ch, l, client, h);
  return { ok: true };
}


async function returnEscrow(ch, l, client, h) {
  const n = Number(l.qty);
  // internal transfer back from the escrow bucket — not ledgered (see listItem)
  if (l.item_kind === 'cb') { ch.cb = Number(ch.cb) + n; }
  else if (l.item_kind === 'ammo') { ch.ammo = Number(ch.ammo) + n; }
  else {
    const cur = (await client.query('SELECT qty FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id])).rows[0];
    const total = Number(cur?.qty || 0) + n;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id]);
    await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, l.item_id, total]);
    h.owned.items[l.item_id] = total;
  }
}

// Fill runs under withTwoCharacters(buyer, seller) — both rows locked (§10.1).

// Fill runs under withTwoCharacters(buyer, seller) — both rows locked (§10.1).
export async function buyListing(ch, seller, client, h, listingId) {
  const l = (await client.query('SELECT * FROM listings WHERE id=$1 FOR UPDATE', [listingId])).rows[0];
  if (!l) throw new GameError('gone', 'Too slow — someone else took that lot.');
  if (l.seller_character !== seller.id) throw new GameError('bad_seller', 'Listing/seller mismatch.');
  const total = Number(l.unit_price) * Number(l.qty);
  if (Number(ch.cash) < total) throw new GameError('cash', `That lot costs $${total}.`);
  // the 2% house take is paid by the seller (v24); on a tiny lot the take can exceed
  // the price — clamp so the seller is never DEBITED on a completed sale, and split
  // the actual take (never more than the buyer paid) between street tax and dev burn
  const fee = Math.ceil(total * 0.01), tax = Math.ceil(total * 0.01);
  const net = Math.max(0, total - fee - tax);
  const poolTax = Math.min(tax, total - net);
  await client.query('DELETE FROM listings WHERE id=$1', [listingId]);
  ch.cash = Number(ch.cash) - total;
  seller.cash = Number(seller.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -total, reason: 'exchange:buy', counterparty: seller.id });
  await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: net, reason: 'exchange:sale', counterparty: ch.id });
  await takeHouse(client, poolTax);
  const n = Number(l.qty);
  // delivery is an internal transfer out of the escrow bucket to the buyer — not ledgered
  if (l.item_kind === 'cb') { ch.cb = Number(ch.cb) + n; }
  else if (l.item_kind === 'ammo') { ch.ammo = Number(ch.ammo) + n; }
  else {
    const cur = (await client.query('SELECT qty FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id])).rows[0];
    const totalQty = Number(cur?.qty || 0) + n;
    await client.query('DELETE FROM character_items WHERE character_id=$1 AND item_id=$2', [ch.id, l.item_id]);
    await client.query('INSERT INTO character_items (character_id, item_id, qty) VALUES ($1,$2,$3)', [ch.id, l.item_id, totalQty]);
    h.owned.items[l.item_id] = totalQty;
  }
  await h.bumpDaily(client, ch.id, 'trade');
  await h.notify(client, seller.id, 'sale', { what: `${n}× ${l.item_id}`, amt: net, to: ch.name });
  return { ok: true, qty: n, paid: total };
}

