// Risk-to-Earn Phase 3 — TERRITORY RACKETS: productive, SEIZABLE capital. ONE racket per district,
// owned by whoever holds the turf. Established on your own turf (the treasury pays), income accrues
// to the treasury (lazy, collected on demand, capped at TERRITORY_CAP_MS), and the whole operation
// TRANSFERS to the victor when the district is seized — so wars fight over income streams, not just
// a one-time treasury cut (the audit's B4/B7). §10.4: `territory:establish` is a treasury cash SINK,
// `territory:income` a treasury cash FAUCET — both character_id NULL (gang-level, like gang:war), so
// the character-cash check is untouched and the treasury check reconciles them. The on-chain
// tradeable-NFT layer (minted_onchain) is dormant/deferred, the M6 pattern.
import { GameError } from './game.js';
import { DISTRICTS, TERRITORY_RACKETS, territoryTierOf, territoryRankOf, CONSTANTS } from './rules.js';

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';

// accrued income for one racket up to the cap, in whole dollars
function accrued(racket) {
  const tier = territoryTierOf(racket.tier);
  if (!tier) return 0;
  const elapsed = Math.min(Date.now() - new Date(racket.last_income_at).getTime(), CONSTANTS.TERRITORY_CAP_MS);
  return Math.floor(tier.incomePerHr * Math.max(0, elapsed) / 3600000);
}

// RECURRING SINKS — the operation's pad: upkeep owed on one racket (TERRITORY_UPKEEP_BPS of the
// tier's income per hour), accrued on its OWN clock up to TERRITORY_UPKEEP_CAP_MS — distinct from
// the 24h income cap, so a neglected operation owes more than it earns. Paid from the treasury.
function upkeepOwed(racket, now = Date.now()) {
  const tier = territoryTierOf(racket.tier);
  if (!tier) return 0;
  const elapsed = Math.min(now - new Date(racket.upkeep_at).getTime(), CONSTANTS.TERRITORY_UPKEEP_CAP_MS);
  return Math.floor(tier.incomePerHr * (CONSTANTS.TERRITORY_UPKEEP_BPS / 10000) * Math.max(0, elapsed) / 3600000);
}
const isCold = (racket, now = Date.now()) =>
  now - new Date(racket.upkeep_at).getTime() >= CONSTANTS.TERRITORY_UPKEEP_COLD_MS;

// Establish a new operation on a district your family holds (one per district). Treasury pays.
export async function establishRacket(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss runs the rackets.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  // LOCK + re-read the district row (not the stale cached h.owned.held) FIRST, in the same
  // district → gang order seizeDistrict uses — otherwise a concurrent seizure of this turf could
  // land an operation owned by us on a district the rival now holds (an orphaned, unseizable racket).
  const d = (await client.query('SELECT holder_gang FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!d || d.holder_gang !== h.owned.gangId) throw new GameError('turf', 'Your family must hold that district first.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const existing = (await client.query('SELECT district_id FROM territory_rackets WHERE district_id=$1', [districtId])).rows[0];
  if (existing) throw new GameError('exists', 'An operation already runs there — upgrade it instead.');
  const tier = TERRITORY_RACKETS[0];
  if (Number(g.treasury) < tier.cost) throw new GameError('treasury', `Setting up the ${tier.name} takes $${tier.cost} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, tier.cost]);
  await client.query('INSERT INTO territory_rackets (district_id, owner_gang, tier) VALUES ($1,$2,1)', [districtId, h.owned.gangId]);
  await h.ledger(client, { currency: 'cash', amount: -tier.cost, reason: 'territory:establish', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - tier.cost;
  return { ok: true, district: districtId, tier: 1, name: tier.name };
}

// Upgrade the operation on a district you hold to the next tier — collects the pending income at
// the OLD rate first (so an upgrade never wipes uncollected earnings), then resets the clock.
export async function upgradeRacket(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss runs the rackets.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const r = (await client.query('SELECT * FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r) throw new GameError('no_racket', 'No operation there to upgrade.');
  if (r.owner_gang !== h.owned.gangId) throw new GameError('not_yours', "That's not your operation.");
  const next = territoryTierOf(Number(r.tier) + 1);
  if (!next) throw new GameError('maxed', 'That operation already runs at full strength.');
  if (isCold(r)) throw new GameError('cold', 'That operation is dark — pay its pad before you pour money into it.');
  if (Number(g.treasury) < next.cost) throw new GameError('treasury', `The ${next.name} takes $${next.cost} from the treasury.`);
  const pending = accrued(r);
  // the upgrade squares the pad too (upkeep_at=now): a fresh clock at the new rate, no retroactive bump.
  // the pending collect also banks lifetime territory income (THE EMPIRE — step two).
  await client.query('UPDATE gangs SET treasury = treasury - $2 + $3, territory_earned = territory_earned + $3 WHERE id=$1', [h.owned.gangId, next.cost, pending]);
  await client.query('UPDATE territory_rackets SET tier=$2, last_income_at=now(), upkeep_at=now() WHERE district_id=$1', [districtId, next.tier]);
  await h.ledger(client, { currency: 'cash', amount: -next.cost, reason: 'territory:establish', counterparty: h.owned.gangId });
  if (pending > 0) await h.ledger(client, { currency: 'cash', amount: pending, reason: 'territory:income', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - next.cost + pending;
  return { ok: true, district: districtId, tier: next.tier, name: next.name, collected: pending };
}

// Collect the accrued income from every operation the family runs → the treasury. Any member can
// (the income is the family's); gang locked first (global order characters → accounts → gangs).
export async function collectTerritory(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  // BALANCE D2 — shield, not bunker: walking the district to collect is an exposed act
  if (ch.safe_until && new Date(ch.safe_until) > new Date())
    throw new GameError('safe', 'The runners report to a man on the street, not a ghost — collection waits until you surface.');
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const rackets = (await client.query('SELECT * FROM territory_rackets WHERE owner_gang=$1 FOR UPDATE', [h.owned.gangId])).rows;
  let total = 0, cold = 0;
  for (const r of rackets) {
    // recurring sinks: an operation whose pad went unpaid past the cold window produces nothing
    // until squared — the withheld take is lost to the 24h cap, not banked to the treasury.
    if (isCold(r)) { cold++; continue; }
    const inc = accrued(r);
    if (inc > 0) { total += inc; await client.query('UPDATE territory_rackets SET last_income_at=now() WHERE district_id=$1', [r.district_id]); }
  }
  if (total <= 0) return { ok: true, collected: 0, ...(cold ? { cold } : {}) };
  // THE EMPIRE (step two): bank the lifetime territory income too (a gang status axis, NUMERIC = arith-safe)
  await client.query('UPDATE gangs SET treasury = treasury + $2, territory_earned = territory_earned + $2 WHERE id=$1', [h.owned.gangId, total]);
  await h.ledger(client, { currency: 'cash', amount: total, reason: 'territory:income', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + total;
  return { ok: true, collected: total, rackets: rackets.length, ...(cold ? { cold } : {}) };
}

// PAY THE PAD (recurring sinks) — a boss/underboss settles the upkeep owed on every operation the
// treasury can afford (greedy). A §10.4 treasury cash SINK `territory:upkeep` (character_id NULL,
// counterparty = the gang — the treasury check subtracts it, like `territory:establish`); paying
// resets that operation's clock and thaws a cold one.
export async function payTerritoryUpkeep(ch, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss squares the pad.');
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const rackets = (await client.query('SELECT * FROM territory_rackets WHERE owner_gang=$1 FOR UPDATE', [h.owned.gangId])).rows;
  if (!rackets.length) throw new GameError('none', 'Your family runs no operations — no pad to pay.');
  let treasury = Number(g.treasury), paid = 0, stillOwed = 0; const settled = [];
  for (const r of rackets) {
    const owed = upkeepOwed(r);
    if (owed <= 0) continue;
    if (treasury >= owed) {
      treasury -= owed; paid += owed;
      await client.query('UPDATE territory_rackets SET upkeep_at=now() WHERE district_id=$1', [r.district_id]);
      settled.push({ district: r.district_id, paid: owed });
    } else stillOwed += owed;
  }
  if (paid > 0) {
    await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, paid]);
    await h.ledger(client, { currency: 'cash', amount: -paid, reason: 'territory:upkeep', counterparty: h.owned.gangId });
    if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - paid;
  }
  if (paid <= 0 && stillOwed <= 0) return { ok: true, paid: 0, message: 'The pad is square.' };
  return { ok: true, paid, fronts: settled, ...(stillOwed > 0 ? { stillOwed } : {}) };
}

// SEIZURE hook — called inside seizeDistrict when a district changes hands. The operation transfers
// to the victor; uncollected income is FORFEITED (clock resets) — collect before you lose the turf.
export async function seizeTerritoryRackets(client, districtId, newGang) {
  // the victor inherits a fresh operation — clocks reset (uncollected income forfeits) AND the pad
  // is squared (they didn't run up the old owner's arrears; a cold seized racket isn't born cold).
  await client.query('UPDATE territory_rackets SET owner_gang=$2, last_income_at=now(), upkeep_at=now() WHERE district_id=$1', [districtId, newGang]);
}

// Dissolution hook — a family's operations die with it (the district is released; a new holder
// re-establishes). Called from removeMember's dissolution branch.
export async function releaseTerritoryRackets(client, gangId) {
  await client.query('DELETE FROM territory_rackets WHERE owner_gang=$1', [gangId]);
}

// GET /v1/leaderboard/territory — THE EMPIRE board: the biggest territorial families by lifetime
// territory-racket income (a gang-level status axis; dies with the family). Pure status.
export async function territoryLeaderboard(pool) {
  const rows = (await pool.query(
    'SELECT name, territory_earned FROM gangs WHERE territory_earned > 0 ORDER BY territory_earned DESC LIMIT 15')).rows;
  return { empires: rows.map((r) => ({ family: r.name, earned: Number(r.territory_earned), rank: territoryRankOf(r.territory_earned).name })) };
}

// list a family's operations (for the gang/district views)
export async function territoryOf(pool, gangId) {
  const rows = (await pool.query('SELECT * FROM territory_rackets WHERE owner_gang=$1', [gangId])).rows;
  return rows.map((r) => {
    const t = territoryTierOf(r.tier);
    return { district: r.district_id, tier: Number(r.tier), name: t?.name || null, incomePerHr: t?.incomePerHr || 0, pending: accrued(r),
      // recurring sinks ("the pad"): the hourly rate, what's owed from the treasury, and cold?
      upkeepPerHr: Math.floor((t?.incomePerHr || 0) * (CONSTANTS.TERRITORY_UPKEEP_BPS / 10000)),
      upkeepOwed: upkeepOwed(r), cold: isCold(r) };
  });
}
