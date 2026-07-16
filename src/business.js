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
import { GameError, bus } from './game.js';
import { CONSTANTS, M3, BUSINESSES, businessOf, businessTierOf, levelOf, effStat } from './rules.js';

const uid = () => crypto.randomUUID();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

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

// ── step two: the RISK layer — scrutiny + Bureau raids (lazy, the §7.1 kitchen-raid pattern) ──
// Only LAUNDERING draws scrutiny onto a front; it decays hourly. Income-only fronts never get
// raided — their risk is rival shakedowns (PvP), so PvE risk tracks extraction, PvP tracks wealth.
function decayedScrutiny(row, now = Date.now()) {
  const hrs = Math.max(0, now - new Date(row.scrutiny_at).getTime()) / 3600000;
  return Math.max(0, Number(row.scrutiny) - hrs * CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR);
}

// Resolve the elapsed window on one (locked) business row: decay scrutiny, and if the front sat
// ABOVE the raid threshold for part of that window, roll one raid over those minutes. A raid
// seizes ALL pending uncollected income (clock reset — it was never minted, so no ledger row;
// the territory-seizure precedent) and levies a fine of FINE_RATE × the current tier's cost,
// clamped to pocket cash (`business:raid`, a §10.4 cash sink), then the heat's off (scrutiny 0).
// `BUSINESS_RAID_P` env overrides the per-minute p for deterministic tests (GEAR_LOOT_CHANCE
// precedent — never set it in production). Mutates `row` in memory so callers see fresh state.
async function resolveScrutiny(ch, row, client, h) {
  const now = Date.now();
  const scr0 = Number(row.scrutiny);
  const elapsedHrs = Math.max(0, now - new Date(row.scrutiny_at).getTime()) / 3600000;
  const scr = Math.max(0, scr0 - elapsedHrs * CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR);
  if (scr0 >= CONSTANTS.BUSINESS_RAID_THRESHOLD) {
    // roll over the minutes the front actually SAT above the threshold this window — it may have
    // cooled below since the last touch, but the hot stretch still gets its roll. The exponent is
    // the UNFLOORED minute count (capped at 24h): flooring let a 2-minute touch cadence count only
    // 1 minute per 2 elapsed, halving cumulative raid probability (audit MED-2) — with the real
    // number, N touches over T minutes total exactly 1−(1−p)^T however you pace them.
    const hrsAbove = Math.min(elapsedHrs, (scr0 - CONSTANTS.BUSINESS_RAID_THRESHOLD) / CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR);
    const minAbove = Math.min(1440, hrsAbove * 60);
    const p = Number(process.env.BUSINESS_RAID_P ?? CONSTANTS.BUSINESS_RAID_P_PER_MIN);
    const pWindow = 1 - Math.pow(1 - p, minAbove);
    const roll = Math.random();
    if (roll < pWindow) {
      const seized = accrued(row);
      const tier = businessTierOf(row.kind, row.tier);
      // the fine reaches the BANK once the pocket is empty (audit F7: raids were trivially dodged
      // by banking before touching a hot front — the §10.4 character-cash check covers cash+bank,
      // so the single ledger row stays exact)
      const fine = Math.min(Math.floor(tier.cost * CONSTANTS.BUSINESS_RAID_FINE_RATE),
        Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
      const fromPocket = Math.min(fine, Math.max(0, Math.floor(Number(ch.cash))));
      ch.cash = Number(ch.cash) - fromPocket;
      ch.bank = Number(ch.bank) - (fine - fromPocket);
      row.scrutiny = 0; row.scrutiny_at = new Date(now); row.last_collect_at = new Date(now);
      await client.query('UPDATE businesses SET scrutiny=0, scrutiny_at=now(), last_collect_at=now() WHERE id=$1', [row.id]);
      if (fine > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fine, reason: 'business:raid' });
      await h.rngLog(client, ch.id, `business:raid:${row.kind}`, roll, `raided (P ${pWindow.toFixed(4)}, seized $${seized}, fined $${fine})`);
      await h.notify(client, ch.id, 'business_raid', { kind: row.kind, seized, fine });
      await h.track(client, ch.account_id, 'business_raid', { kind: row.kind, tier: Number(row.tier), seized, fine });
      return { raided: true, kind: row.kind, seized, fine };
    }
  }
  row.scrutiny = scr; row.scrutiny_at = new Date(now);
  await client.query('UPDATE businesses SET scrutiny=$2, scrutiny_at=now() WHERE id=$1', [row.id, scr]);
  return { raided: false };
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
// Each row resolves its scrutiny window first — a raided front's pending is seized, not banked.
export async function collectBusiness(ch, client, h) {
  const rows = (await client.query('SELECT * FROM businesses WHERE character_id=$1 FOR UPDATE', [ch.id])).rows;
  let total = 0; const raids = [];
  for (const r of rows) {
    const res = await resolveScrutiny(ch, r, client, h);
    if (res.raided) { raids.push(res); continue; }
    const inc = accrued(r);
    if (inc > 0) { total += inc; await client.query('UPDATE businesses SET last_collect_at=now() WHERE id=$1', [r.id]); }
  }
  if (total > 0) {
    ch.cash = Number(ch.cash) + total;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: total, reason: 'business:income' });
  }
  if (total <= 0 && !raids.length) return { ok: true, collected: 0 };
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, collected: total, businesses: rows.length, ...(raids.length ? { raids } : {}) };
}

// Upgrade a front to the next tier — collects the pending income at the OLD rate first (so an
// upgrade never wipes uncollected earnings), then pays the next tier's cost and resets the clock.
export async function upgradeBusiness(ch, businessId, client, h) {
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 AND character_id=$2 FOR UPDATE', [businessId, ch.id])).rows[0];
  if (!r) throw new GameError('not_yours', "That's not your business.");
  const cat = businessOf(r.kind);
  const next = businessTierOf(r.kind, Number(r.tier) + 1);
  if (!next) throw new GameError('maxed', `Your ${cat.name} already runs at full strength.`);
  const raid = await resolveScrutiny(ch, r, client, h); // a raid seizes the pending before it banks
  const pending = raid.raided ? 0 : accrued(r);
  if (Number(ch.cash) + pending < next.cost) throw new GameError('cash', `Upgrading the ${cat.name} costs $${next.cost}.`);
  // bank the pending at the old rate, then debit the upgrade — net in one cash figure
  ch.cash = Number(ch.cash) + pending - next.cost;
  await client.query('UPDATE businesses SET tier=$2, last_collect_at=now() WHERE id=$1', [businessId, next.tier]);
  if (pending > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pending, reason: 'business:income' });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -next.cost, reason: 'business:upgrade' });
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, id: businessId, kind: r.kind, name: cat.name, tier: next.tier, collected: pending,
    ...(raid.raided ? { raid } : {}) };
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
  // lock scoped to the owner so a rival can't even briefly hold your row (audit LOW-3)
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 AND character_id=$2 FOR UPDATE', [businessId, ch.id])).rows[0];
  if (!r) throw new GameError('not_yours', "That's not your business.");
  // resolve the scrutiny window first — a raid seizes pending income + fines (the wash itself
  // still proceeds, the §7.1 kitchen precedent: the Bureau's visit doesn't undo your next move)
  const raid = await resolveScrutiny(ch, r, client, h);
  const tier = businessTierOf(r.kind, r.tier);
  // capacity is a TOKEN BUCKET refilling launderCapDay per 24h continuously — the old fixed
  // window reset in full at its boundary, letting ~2× the "daily" cap through in minutes at every
  // boundary straddle (audit MED-1); a bucket bounds any rolling day at cap + refill, no cliff
  const refill = (Date.now() - new Date(r.launder_at).getTime()) / (24 * 3600 * 1000) * tier.launderCapDay;
  const usedBefore = Math.max(0, Number(r.launder_used) - Math.max(0, refill));
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
  // settle the bucket: store the post-refill usage + stamp the refill clock
  await client.query('UPDATE businesses SET launder_used=$2, launder_at=now() WHERE id=$1',
    [businessId, usedBefore + amt]);
  // step two: washing draws Bureau SCRUTINY onto the front, pro-rated by how hard you push its
  // capacity (a full day-cap = BUSINESS_SCRUTINY_PER_CAP points), capped like heat —
  // resolveScrutiny just stamped the decay clock, so this bump starts a fresh window
  const scrAdd = amt / tier.launderCapDay * CONSTANTS.BUSINESS_SCRUTINY_PER_CAP;
  await client.query('UPDATE businesses SET scrutiny = LEAST($3, scrutiny + $2) WHERE id=$1',
    [businessId, scrAdd, CONSTANTS.BUSINESS_SCRUTINY_MAX]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'swap:buy' });
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: out, reason: 'swap:buy' });
  await takeHouse(client, tax);
  h.owned.businesses = await businessesOf(client, ch.id); // refresh launder headroom in the view
  return { ok: true, spentCash: amt, gotOmr: out, price: (c + netIn) / (o - out),
    launderedToday: usedBefore + amt, capDay: tier.launderCapDay, ...(raid.raided ? { raid } : {}) };
}

// ── step two: SHAKEDOWN — the PvP risk on passive income (runs under withTwoCharacters) ──
// A rival extorts a front for SHAKEDOWN_RATE of its PENDING income in a muscle/cunning contest.
// The cut is the same bounded income faucet as a collect (`business:shakedown`, character_id =
// the attacker), just redirected — total income per front stays bounded by incomePerHr either
// way; the owner keeps the rest pending (the clock advances by only the stolen share). Per-venue
// cooldown protects the front from spam; heat lands on the attacker win or lose (extortion is
// exposure); family is off-limits; a safehouse blocks offense (P1.3), never defense here — the
// venue is a street address, not the man.
export async function shakedownBusiness(ch, victim, businessId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't run extortion while you're to ground — a safehouse is a shield, not a bunker.");
  if (hospitalized(ch)) throw new GameError('hosp_self', 'No leaning on anyone from a hospital bed.');
  if (Number(ch.health) < M3.JUMP_MIN_HEALTH) throw new GameError('health', "You're in no shape to lean on anyone.");
  if (Number(ch.energy) < CONSTANTS.SHAKEDOWN_ENERGY) throw new GameError('energy', `Need ${CONSTANTS.SHAKEDOWN_ENERGY} energy to lean on a front.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])).rows[0];
  if (!r || r.character_id !== victim.id) throw new GameError('bad_business', 'No such front on them.');
  if (r.shakedown_at && Date.now() - new Date(r.shakedown_at).getTime() < CONSTANTS.SHAKEDOWN_CD_MS)
    throw new GameError('cooldown', 'That front just had a visit — let the dust settle.');
  ch.energy = Number(ch.energy) - CONSTANTS.SHAKEDOWN_ENERGY;
  ch.heat = Number(ch.heat || 0) + CONSTANTS.SHAKEDOWN_HEAT; // extortion is exposure, win or lose
  await client.query('UPDATE businesses SET shakedown_at=now() WHERE id=$1', [businessId]);

  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const vEff = (s) => effStat(victim[s], s, h.victimOwned.assets, h.victimOwned.gear);
  const atk = eff('muscle') + eff('cunning') * 0.5 + Math.random() * 25;
  const def = vEff('muscle') + vEff('cunning') * 0.5 + Math.random() * 25;
  await h.rngLog(client, ch.id, `shakedown:${victim.id}`, Math.round(atk * 100) / 100, atk > def ? 'win' : 'loss');

  if (atk > def) {
    const pending = accrued(r);
    const cut = Math.floor(pending * CONSTANTS.SHAKEDOWN_RATE);
    // advance the clock by only the STOLEN share — the owner keeps the rest pending
    const elapsed = Math.min(Date.now() - new Date(r.last_collect_at).getTime(), CONSTANTS.BUSINESS_CAP_MS);
    await client.query('UPDATE businesses SET last_collect_at=$2 WHERE id=$1',
      [businessId, new Date(Date.now() - Math.floor(Math.max(0, elapsed) * (1 - CONSTANTS.SHAKEDOWN_RATE)))]);
    if (cut > 0) {
      ch.cash = Number(ch.cash) + cut;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cut, reason: 'business:shakedown', counterparty: victim.id });
    }
    await h.notify(client, victim.id, 'shakedown', { from: ch.name, kind: r.kind, cut });
    bus.emit('streets', { type: 'shakedown', by: ch.name, on: victim.name, kind: r.kind });
    return { ok: true, win: true, kind: r.kind, cut };
  }
  // the front's security saw you off
  ch.health = Math.max(1, Number(ch.health) - rand(10, 25));
  await h.notify(client, victim.id, 'shakedown_failed', { from: ch.name, kind: r.kind });
  return { ok: true, win: false, kind: r.kind, cut: 0 };
}

// Reader for GET /v1/business + the character view — your empire, pending income, launder headroom.
export async function businessesOf(pool, characterId) {
  const rows = (await pool.query('SELECT * FROM businesses WHERE character_id=$1 ORDER BY acquired_at', [characterId])).rows;
  return rows.map((r) => {
    const cat = businessOf(r.kind), tier = businessTierOf(r.kind, r.tier);
    // mirror launderAtBusiness's token-bucket math so the displayed headroom is what a wash would see
    const refill = (Date.now() - new Date(r.launder_at).getTime()) / (24 * 3600 * 1000) * (tier?.launderCapDay || 0);
    const usedToday = Math.max(0, Number(r.launder_used) - Math.max(0, refill));
    return {
      id: r.id, kind: r.kind, name: cat?.name || r.kind, tier: Number(r.tier),
      incomePerHr: tier?.incomePerHr || 0, pending: accrued(r),
      launderCapDay: tier?.launderCapDay || 0, launderHeadroom: Math.max(0, (tier?.launderCapDay || 0) - usedToday),
      scrutiny: Math.round(decayedScrutiny(r)), raidRisk: decayedScrutiny(r) >= CONSTANTS.BUSINESS_RAID_THRESHOLD,
      shakedownCdSeconds: r.shakedown_at ? Math.max(0, Math.ceil((new Date(r.shakedown_at).getTime() + CONSTANTS.SHAKEDOWN_CD_MS - Date.now()) / 1000)) : 0,
      nextTier: businessTierOf(r.kind, Number(r.tier) + 1) || null,
    };
  });
}

// The full discoverable catalog (also closes the audit's API-discoverability gap).
export function catalog() {
  return BUSINESSES.map((b) => ({ kind: b.kind, name: b.name, lvl: b.lvl, tiers: b.tiers }));
}
