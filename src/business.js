// Business Empire — the PREMIUM, acquired-later personal front layer. Distinct from the flat
// mid-game ASSETS/RACKETS (buy-once, drip-forever): these are level-gated, UPGRADEABLE venues
// (laundromat → casino) that farm pocket cash AND double as your PRIVATE money-laundering
// infrastructure — the endgame engine of the Risk-to-Earn loop. Per-INSTANCE state lives in the
// `businesses` table (one row per owned front). Income accrues lazily, capped at BUSINESS_CAP_MS,
// and is collected on demand → pocket cash (the territory-racket pattern). §10.4: `business:income`
// is a cash FAUCET, `business:buy`/`business:upgrade` cash SINKS — all carry the character_id, so
// the per-character cash check reconciles them automatically. Laundering rides the existing
// `swap:buy` ledger (no new reason). Step-two scrutiny/raid/extortion risk is deferred by design.
import crypto from 'node:crypto';
import { GameError } from './game.js';
import { CONSTANTS, BUSINESSES, businessOf, businessTierOf, levelOf } from './rules.js';

const uid = () => crypto.randomUUID();

// accrued income for one business up to the cap, in whole dollars
function accrued(row) {
  const tier = businessTierOf(row.kind, row.tier);
  if (!tier) return 0;
  const elapsed = Math.min(Date.now() - new Date(row.last_collect_at).getTime(), CONSTANTS.BUSINESS_CAP_MS);
  return Math.floor(tier.incomePerHr * Math.max(0, elapsed) / 3600000);
}

// The 1% street tax on the house-take feeds the 12h buyback (spec §7.12); mirrors economy.js.
async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// Buy a tier-1 front (one per kind per character). Level-gated ("acquired later"). Pocket cash pays.
export async function buyBusiness(ch, kind, client, h) {
  const cat = businessOf(kind);
  if (!cat) throw new GameError('bad_business', 'No such business.');
  if (levelOf(Number(ch.respect)) < cat.lvl) throw new GameError('level', `The ${cat.name} opens up at level ${cat.lvl}.`);
  const existing = (await client.query('SELECT id FROM businesses WHERE character_id=$1 AND kind=$2', [ch.id, kind])).rows[0];
  if (existing) throw new GameError('exists', `You already run a ${cat.name} — upgrade it instead.`);
  const tier = cat.tiers[0];
  if (Number(ch.cash) < tier.cost) throw new GameError('cash', `The ${cat.name} costs $${tier.cost} to set up.`);
  ch.cash = Number(ch.cash) - tier.cost;
  const id = uid();
  await client.query('INSERT INTO businesses (id, character_id, kind, tier) VALUES ($1,$2,$3,1)', [id, ch.id, kind]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -tier.cost, reason: 'business:buy' });
  h.owned.businesses = await businessesOf(client, ch.id); // keep the returned view fresh
  return { ok: true, id, kind, name: cat.name, tier: 1 };
}

// Collect the accrued income from EVERY front you own → pocket cash (lazy, capped, clock reset).
export async function collectBusiness(ch, client, h) {
  const rows = (await client.query('SELECT * FROM businesses WHERE character_id=$1 FOR UPDATE', [ch.id])).rows;
  let total = 0;
  for (const r of rows) {
    const inc = accrued(r);
    if (inc > 0) { total += inc; await client.query('UPDATE businesses SET last_collect_at=now() WHERE id=$1', [r.id]); }
  }
  if (total <= 0) return { ok: true, collected: 0 };
  ch.cash = Number(ch.cash) + total;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: total, reason: 'business:income' });
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, collected: total, businesses: rows.length };
}

// Upgrade a front to the next tier — collects the pending income at the OLD rate first (so an
// upgrade never wipes uncollected earnings), then pays the next tier's cost and resets the clock.
export async function upgradeBusiness(ch, businessId, client, h) {
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])).rows[0];
  if (!r || r.character_id !== ch.id) throw new GameError('not_yours', "That's not your business.");
  const cat = businessOf(r.kind);
  const next = businessTierOf(r.kind, Number(r.tier) + 1);
  if (!next) throw new GameError('maxed', `Your ${cat.name} already runs at full strength.`);
  const pending = accrued(r);
  if (Number(ch.cash) + pending < next.cost) throw new GameError('cash', `Upgrading the ${cat.name} costs $${next.cost}.`);
  // bank the pending at the old rate, then debit the upgrade — net in one cash figure
  ch.cash = Number(ch.cash) + pending - next.cost;
  await client.query('UPDATE businesses SET tier=$2, last_collect_at=now() WHERE id=$1', [businessId, next.tier]);
  if (pending > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pending, reason: 'business:income' });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -next.cost, reason: 'business:upgrade' });
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, id: businessId, kind: r.kind, name: cat.name, tier: next.tier, collected: pending };
}

// PRIVATE laundering — cash → $OMR through the SAME AMM as the public wash house (swap:buy ledger),
// but gated by this front's per-tier DAILY capacity (a rolling 24h window on launder_used) instead
// of the wash-house district, and drawing LESS heat (BUSINESS_LAUNDER_HEAT < LAUNDER_HEAT) — your
// own books are safer than the street. Still an extraction act: blocked from a safehouse (P1.3).
export async function launderAtBusiness(ch, businessId, amount, client, h) {
  if (ch.safe_until && new Date(ch.safe_until) > new Date()) throw new GameError('safe', "You can't move money while you're to ground.");
  const amt = Math.floor(Number(amount));
  if (!(amt > 0)) throw new GameError('amount', 'Positive amounts only.');
  if (amt < CONSTANTS.SWAP_MIN) throw new GameError('min', `Minimum wash is $${CONSTANTS.SWAP_MIN}.`);
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])).rows[0];
  if (!r || r.character_id !== ch.id) throw new GameError('not_yours', "That's not your business.");
  const tier = businessTierOf(r.kind, r.tier);
  // roll the daily window if it has lapsed, then check remaining capacity
  const windowOpen = new Date(r.launder_at).getTime();
  const fresh = Date.now() - windowOpen >= 24 * 3600 * 1000;
  const usedBefore = fresh ? 0 : Number(r.launder_used);
  const remaining = tier.launderCapDay - usedBefore;
  if (amt > remaining) throw new GameError('capacity', `This ${businessOf(r.kind).name} can wash $${Math.max(0, Math.floor(remaining))} more today.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');

  const pool = (await client.query('SELECT * FROM amm_pool WHERE id=1 FOR UPDATE')).rows[0];
  const c = Number(pool.cash_reserve), o = Number(pool.omr_reserve), k = c * o;
  const fee = Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01), netIn = amt - fee - tax;
  const out = o - k / (c + netIn);
  if (!(out > 0)) throw new GameError('pool', "The pool couldn't fill that.");
  await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + netIn, o - out]);
  ch.cash = Number(ch.cash) - amt;
  ch.heat = Number(ch.heat || 0) + CONSTANTS.BUSINESS_LAUNDER_HEAT; // washing draws the law — but less at your own front
  h.acct.omr = Number(h.acct.omr) + out;
  // advance the daily window: keep the window start if still open, reset it if it had lapsed
  await client.query('UPDATE businesses SET launder_used=$2, launder_at=$3 WHERE id=$1',
    [businessId, usedBefore + amt, fresh ? new Date() : r.launder_at]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'swap:buy' });
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: out, reason: 'swap:buy' });
  await takeHouse(client, tax);
  h.owned.businesses = await businessesOf(client, ch.id); // refresh launder headroom in the view
  return { ok: true, spentCash: amt, gotOmr: out, price: (c + netIn) / (o - out),
    launderedToday: usedBefore + amt, capDay: tier.launderCapDay };
}

// Reader for GET /v1/business + the character view — your empire, pending income, launder headroom.
export async function businessesOf(pool, characterId) {
  const rows = (await pool.query('SELECT * FROM businesses WHERE character_id=$1 ORDER BY acquired_at', [characterId])).rows;
  return rows.map((r) => {
    const cat = businessOf(r.kind), tier = businessTierOf(r.kind, r.tier);
    const fresh = Date.now() - new Date(r.launder_at).getTime() >= 24 * 3600 * 1000;
    const usedToday = fresh ? 0 : Number(r.launder_used);
    return {
      id: r.id, kind: r.kind, name: cat?.name || r.kind, tier: Number(r.tier),
      incomePerHr: tier?.incomePerHr || 0, pending: accrued(r),
      launderCapDay: tier?.launderCapDay || 0, launderHeadroom: Math.max(0, (tier?.launderCapDay || 0) - usedToday),
      nextTier: businessTierOf(r.kind, Number(r.tier) + 1) || null,
    };
  });
}

// The full discoverable catalog (also closes the audit's API-discoverability gap).
export function catalog() {
  return BUSINESSES.map((b) => ({ kind: b.kind, name: b.name, lvl: b.lvl, tiers: b.tiers }));
}
