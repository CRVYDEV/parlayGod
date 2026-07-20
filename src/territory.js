// Risk-to-Earn Phase 3 — TERRITORY RACKETS: productive, SEIZABLE capital. ONE racket per district,
// owned by whoever holds the turf. Established on your own turf (the treasury pays), income accrues
// to the treasury (lazy, collected on demand, capped at TERRITORY_CAP_MS), and the whole operation
// TRANSFERS to the victor when the district is seized — so wars fight over income streams, not just
// a one-time treasury cut (the audit's B4/B7). §10.4: `territory:establish` is a treasury cash SINK,
// `territory:income` a treasury cash FAUCET — both character_id NULL (gang-level, like gang:war), so
// the character-cash check is untouched and the treasury check reconciles them. The on-chain
// tradeable-NFT layer (minted_onchain) is dormant/deferred, the M6 pattern.
import { GameError } from './game.js';
import { DISTRICTS, TERRITORY_RACKETS, territoryTierOf, territoryTypeOf, territoryBuildCost,
         territoryRankOf, CONSTANTS } from './rules.js';

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';

// the operation's hourly rate = the tier's base × the TYPE's income tilt (step three)
const ratePerHr = (racket) => (territoryTierOf(racket.tier)?.incomePerHr || 0) * territoryTypeOf(racket.kind).incomeMult;

// accrued income for one racket up to the cap, in whole dollars
function accrued(racket) {
  if (!territoryTierOf(racket.tier)) return 0;
  const elapsed = Math.min(Date.now() - new Date(racket.last_income_at).getTime(), CONSTANTS.TERRITORY_CAP_MS);
  return Math.floor(ratePerHr(racket) * Math.max(0, elapsed) / 3600000);
}

// RECURRING SINKS — the operation's pad: upkeep owed on one racket (TERRITORY_UPKEEP_BPS of the
// operation's income per hour — so a hotter/bigger op owes more), accrued on its OWN clock up to
// TERRITORY_UPKEEP_CAP_MS — distinct from the 24h income cap, so a neglected operation owes more than
// it earns. Paid from the treasury.
function upkeepOwed(racket, now = Date.now()) {
  if (!territoryTierOf(racket.tier)) return 0;
  const elapsed = Math.min(now - new Date(racket.upkeep_at).getTime(), CONSTANTS.TERRITORY_UPKEEP_CAP_MS);
  return Math.floor(ratePerHr(racket) * (CONSTANTS.TERRITORY_UPKEEP_BPS / 10000) * Math.max(0, elapsed) / 3600000);
}
const isCold = (racket, now = Date.now()) =>
  now - new Date(racket.upkeep_at).getTime() >= CONSTANTS.TERRITORY_UPKEEP_COLD_MS;

// STEP THREE — the BUREAU CRACKDOWN (the business-scrutiny pattern for a GANG operation). Scrutiny
// GROWS from operating a hot type (net of the decay) — a `numbers` op (scrutinyPerHr 0 < decay) never
// heats up, `smuggling` climbs fast. Effective (current) scrutiny, clamped:
function decayedScrutiny(r, now = Date.now()) {
  const net = territoryTypeOf(r.kind).scrutinyPerHr - CONSTANTS.TERRITORY_SCRUTINY_DECAY_HR;
  const hrs = Math.max(0, now - new Date(r.scrutiny_at).getTime()) / 3600000;
  return Math.max(0, Math.min(CONSTANTS.TERRITORY_SCRUTINY_CAP, Number(r.scrutiny) + net * hrs));
}

// Resolve a possible Bureau crackdown on one (locked) operation at an owner-touch (collect/upgrade).
// Above the threshold, roll 1−(1−p)^(minutes the op sat above it this window). A raid SEIZES the
// pending income (reset the clock, never banked/ledgered — the seize precedent) and returns a FINE the
// caller subtracts from the treasury (ledgered `territory:raid`, a §10.4 treasury sink). No treasury
// write here — the caller applies the net delta in one UPDATE. `treasury` is the running balance (for
// the fine clamp). TERRITORY_RAID_P pins the roll for tests (the BUSINESS_RAID_P precedent).
async function resolveTerritoryRaid(r, treasury, client, h, gangId, actorId) {
  const now = Date.now();
  const net = territoryTypeOf(r.kind).scrutinyPerHr - CONSTANTS.TERRITORY_SCRUTINY_DECAY_HR;
  const stored = Number(r.scrutiny);
  const hrs = Math.max(0, now - new Date(r.scrutiny_at).getTime()) / 3600000;
  const eff = Math.max(0, Math.min(CONSTANTS.TERRITORY_SCRUTINY_CAP, stored + net * hrs));
  if (net > 0 && eff >= CONSTANTS.TERRITORY_RAID_THRESHOLD) {
    // the hours the op actually sat above the threshold this window (linear growth from `stored`)
    const hrsAbove = stored >= CONSTANTS.TERRITORY_RAID_THRESHOLD ? hrs
      : Math.max(0, hrs - (CONSTANTS.TERRITORY_RAID_THRESHOLD - stored) / net);
    const minAbove = Math.min(1440, hrsAbove * 60);
    const p = Number(process.env.TERRITORY_RAID_P ?? CONSTANTS.TERRITORY_RAID_P_PER_MIN);
    const pWindow = 1 - Math.pow(1 - p, minAbove);
    const roll = Math.random();
    if (roll < pWindow) {
      const seized = accrued(r);
      const fine = Math.min(Math.floor(territoryBuildCost(r.tier) * CONSTANTS.TERRITORY_RAID_FINE_RATE), Math.max(0, Math.floor(treasury)));
      // seize the pending (clock reset) + cool the heat; the fine is ledgered here, applied to the treasury by the caller
      await client.query('UPDATE territory_rackets SET scrutiny=0, scrutiny_at=now(), last_income_at=now() WHERE district_id=$1', [r.district_id]);
      if (fine > 0) await h.ledger(client, { currency: 'cash', amount: -fine, reason: 'territory:raid', counterparty: gangId });
      await h.rngLog(client, actorId, `territory:raid:${r.district_id}`, roll, `raided (P ${pWindow.toFixed(4)}, seized $${seized}, fined $${fine})`);
      return { raided: true, district: r.district_id, seized, fine };
    }
  }
  await client.query('UPDATE territory_rackets SET scrutiny=$2, scrutiny_at=now() WHERE district_id=$1', [r.district_id, eff]);
  return { raided: false, fine: 0 };
}

// Establish a new operation on a district your family holds (one per district). Treasury pays.
// Step three: `kind` picks the operation's BUSINESS (numbers/protection/smuggling) — income + risk.
export async function establishRacket(ch, districtId, kind, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss runs the rackets.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const type = territoryTypeOf(kind);
  if (kind && type.id !== kind) throw new GameError('bad_kind', 'Run a Numbers Game, a Protection Racket, or a Smuggling Ring.');
  // LOCK + re-read the district row (not the stale cached h.owned.held) FIRST, in the same
  // district → gang order seizeDistrict uses — otherwise a concurrent seizure of this turf could
  // land an operation owned by us on a district the rival now holds (an orphaned, unseizable racket).
  const d = (await client.query('SELECT holder_gang FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!d || d.holder_gang !== h.owned.gangId) throw new GameError('turf', 'Your family must hold that district first.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const existing = (await client.query('SELECT district_id FROM territory_rackets WHERE district_id=$1', [districtId])).rows[0];
  if (existing) throw new GameError('exists', 'An operation already runs there — upgrade it instead.');
  const tier = TERRITORY_RACKETS[0];
  if (Number(g.treasury) < tier.cost) throw new GameError('treasury', `Setting up an operation takes $${tier.cost} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, tier.cost]);
  await client.query('INSERT INTO territory_rackets (district_id, owner_gang, tier, kind) VALUES ($1,$2,1,$3)', [districtId, h.owned.gangId, type.id]);
  await h.ledger(client, { currency: 'cash', amount: -tier.cost, reason: 'territory:establish', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - tier.cost;
  return { ok: true, district: districtId, tier: 1, kind: type.id, name: `${tier.name} ${type.name}` };
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
  return { ok: true, district: districtId, tier: next.tier, kind: r.kind, name: `${next.name} ${territoryTypeOf(r.kind).name}`, collected: pending };
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
  let total = 0, cold = 0, fines = 0; const raids = [];
  let running = Number(g.treasury);   // the running treasury (for each raid's fine clamp)
  for (const r of rackets) {
    // recurring sinks: an operation whose pad went unpaid past the cold window produces nothing
    // until squared — the withheld take is lost to the 24h cap, not banked to the treasury.
    if (isCold(r)) { cold++; continue; }
    // STEP THREE — the Bureau crackdown resolves at the collect touch FIRST: a raid seizes the pending
    // income (never banked) + fines the treasury, before any income lands (the business-raid precedent).
    const raid = await resolveTerritoryRaid(r, running, client, h, h.owned.gangId, ch.id);
    if (raid.raided) { fines += raid.fine; running -= raid.fine; raids.push({ district: raid.district, seized: raid.seized, fine: raid.fine }); continue; }
    const inc = accrued(r);
    if (inc > 0) { total += inc; running += inc; await client.query('UPDATE territory_rackets SET last_income_at=now() WHERE district_id=$1', [r.district_id]); }
  }
  if (total <= 0 && fines <= 0) return { ok: true, collected: 0, ...(cold ? { cold } : {}) };
  // apply the NET treasury delta in one UPDATE (income − fines); THE EMPIRE banks lifetime income only
  // (fines don't reduce it). Each fine was already ledgered `territory:raid` inside resolveTerritoryRaid.
  await client.query('UPDATE gangs SET treasury = treasury + $2 - $3, territory_earned = territory_earned + $2 WHERE id=$1', [h.owned.gangId, total, fines]);
  if (total > 0) await h.ledger(client, { currency: 'cash', amount: total, reason: 'territory:income', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + total - fines;
  return { ok: true, collected: total, rackets: rackets.length, ...(cold ? { cold } : {}), ...(raids.length ? { raided: raids } : {}) };
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
  // the victor inherits a fresh operation — clocks reset (uncollected income forfeits), the pad is
  // squared (they didn't run up the old owner's arrears; a cold seized racket isn't born cold), AND the
  // heat's off (scrutiny=0 — a seized op isn't born hot; the type/business carries with the turf).
  await client.query('UPDATE territory_rackets SET owner_gang=$2, last_income_at=now(), upkeep_at=now(), scrutiny=0, scrutiny_at=now() WHERE district_id=$1', [districtId, newGang]);
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
    const type = territoryTypeOf(r.kind);
    const scr = decayedScrutiny(r);
    return { district: r.district_id, tier: Number(r.tier), kind: type.id, typeName: type.name,
      name: `${t?.name || '—'} ${type.name}`, incomePerHr: Math.floor((t?.incomePerHr || 0) * type.incomeMult), pending: accrued(r),
      // recurring sinks ("the pad"): the hourly rate, what's owed from the treasury, and cold?
      upkeepPerHr: Math.floor((t?.incomePerHr || 0) * type.incomeMult * (CONSTANTS.TERRITORY_UPKEEP_BPS / 10000)),
      upkeepOwed: upkeepOwed(r), cold: isCold(r),
      // step three — the Bureau: current scrutiny + whether it's raid-eligible (a hot type over the line)
      scrutiny: Math.round(scr), raidThreshold: CONSTANTS.TERRITORY_RAID_THRESHOLD, raidRisk: scr >= CONSTANTS.TERRITORY_RAID_THRESHOLD };
  });
}
