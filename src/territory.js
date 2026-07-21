// Risk-to-Earn Phase 3 — TERRITORY RACKETS: productive, SEIZABLE capital. ONE racket per district,
// owned by whoever holds the turf. Established on your own turf (the treasury pays), income accrues
// to the treasury (lazy, collected on demand, capped at TERRITORY_CAP_MS), and the whole operation
// TRANSFERS to the victor when the district is seized — so wars fight over income streams, not just
// a one-time treasury cut (the audit's B4/B7). §10.4: `territory:establish` is a treasury cash SINK,
// `territory:income` a treasury cash FAUCET — both character_id NULL (gang-level, like gang:war), so
// the character-cash check is untouched and the treasury check reconciles them. The on-chain
// tradeable-NFT layer (minted_onchain) is dormant/deferred, the M6 pattern.
import { GameError, bus } from './game.js';
import { DISTRICTS, TERRITORY_RACKETS, territoryTierOf, territoryTypeOf, territoryBuildCost,
         territoryFortCost, territoryRankOf, levelOf, CONSTANTS } from './rules.js';

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// the operation's hourly rate = the tier's base × the TYPE's income tilt (step three)
const ratePerHr = (racket) => (territoryTierOf(racket.tier)?.incomePerHr || 0) * territoryTypeOf(racket.kind).incomeMult;

// STEP FIVE — a specialist's passive fortitude bonus (from the effStat snapshot at assign), and the
// net scrutiny growth-rate net of a specialist's resistance. All defensive/risk — no §10.4.
const specFort = (r) => r.specialist ? Math.floor(Number(r.spec_power || 0) / CONSTANTS.SPECIALIST_FORT_DIV) : 0;
const scrutinyNet = (r) => {
  const mult = r.specialist ? CONSTANTS.SPECIALIST_SCRUTINY_MULT : 1;
  return territoryTypeOf(r.kind).scrutinyPerHr * mult - CONSTANTS.TERRITORY_SCRUTINY_DECAY_HR;
};
// the effective START of the scrutiny accrual clock — the LATER of the stored `scrutiny_at` and any
// "Ghost the Route" window end. RED-TEAM FIX: suppressing accrual by returning net=0 during the window
// (the first cut) was wrong — once the window ended, `hrs` since `scrutiny_at` still spanned the ghosted
// hours, so the op silently CAUGHT UP (accruing over the window it was supposed to skip). Starting the
// clock at max(scrutiny_at, op_ghost_until) instead skips the window for real: DURING it the start is in
// the future (hrs=0, no growth) and AFTER it accrual counts only post-window time — robust even if a
// collect writes scrutiny_at=now() mid-window (op_ghost_until still wins), and a stale past window is
// harmless (a later collect's fresh scrutiny_at exceeds it).
const scrutinyStartMs = (r) => Math.max(new Date(r.scrutiny_at).getTime(), r.op_ghost_until ? new Date(r.op_ghost_until).getTime() : 0);

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
  const net = scrutinyNet(r); // step five: a specialist's resistance folds into the rate
  const hrs = Math.max(0, now - scrutinyStartMs(r)) / 3600000; // …and a ghost window skips its hours entirely
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
  const net = scrutinyNet(r); // step five: a specialist dropping net ≤ 0 means no crackdown
  const stored = Number(r.scrutiny);
  // …and a ghost window contributes zero hours (start clock at max(scrutiny_at, op_ghost_until)), so
  // during it hrs=0 → no above-threshold time → the roll below can't fire; after it, only post-window time counts
  const hrs = Math.max(0, now - scrutinyStartMs(r)) / 3600000;
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

// STEP FOUR — FORTIFY: a boss/underboss buys a defense level for an operation from the treasury (a
// §10.4 `territory:fortify` cash SINK, cost climbing with the level × the tier). Each level lowers a
// RIVAL raid's success — it does NOT touch the signed Bureau-crackdown math. Capped at FORT_MAX.
export async function fortifyRacket(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss fortifies the rackets.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const r = (await client.query('SELECT * FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r) throw new GameError('no_racket', 'No operation there to fortify.');
  if (r.owner_gang !== h.owned.gangId) throw new GameError('not_yours', "That's not your operation.");
  const level = Number(r.fortitude);
  if (level >= CONSTANTS.TERRITORY_FORT_MAX) throw new GameError('maxed', 'That operation is dug in as deep as it goes.');
  const cost = territoryFortCost(level, Number(r.tier));
  if (Number(g.treasury) < cost) throw new GameError('treasury', `Fortifying to level ${level + 1} takes $${cost} from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, cost]);
  await client.query('UPDATE territory_rackets SET fortitude=$2 WHERE district_id=$1', [districtId, level + 1]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: 'territory:fortify', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - cost;
  return { ok: true, district: districtId, fortitude: level + 1, cost };
}

// STEP FOUR — RIVAL RAID: a made man of ANOTHER family muscles a held operation for a CUT of its
// PENDING income (the business-shakedown pattern at the gang level). A muscle/cunning contest vs the
// operation's fortitude; a landed raid REDIRECTS the cut to the raider's treasury (`territory:muscle`,
// a treasury FAUCET — the owner's clock advances so they keep the rest pending, and total
// income+muscle stays bounded by the signed curve → §10.4-neutral), draws law heat, and sets a
// per-racket cooldown (win OR lose — the owner isn't ground down). A failed raid costs the raider
// health. LOCK ORDER: attacker char (withCharacter) → attacker gang → target racket (the territory
// gang-before-racket convention; the DEFENDER gang is never locked — only the contested racket row).
export async function raidRivalRacket(ch, districtId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'You need a family to bank the take.');
  // the raid is location-pinned muscle work (the convoy-ambush / business-shakedown pattern + counterplay:
  // you must travel to and expose yourself at the target's district) — red-team: the client always said so,
  // the server didn't enforce it, letting a raid launch from anywhere.
  if (ch.loc !== districtId) throw new GameError('district', "You have to be on their block to muscle in.");
  if (jailed(ch)) throw new GameError('jailed', 'Not from lockup.');
  if (hospitalized(ch)) throw new GameError('hospitalized', "You're in no shape for muscle work.");
  if (safeHoused(ch)) throw new GameError('safe', "You can't run a raid from a safehouse.");  // P1.3
  if (levelOf(Number(ch.respect)) < CONSTANTS.TERRITORY_RIVAL_MIN_LVL)
    throw new GameError('rookie', `Muscling a rival operation takes level ${CONSTANTS.TERRITORY_RIVAL_MIN_LVL}.`);
  if (Number(ch.energy) < CONSTANTS.TERRITORY_RIVAL_ENERGY) throw new GameError('energy', 'Not enough energy for a raid.');
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const r = (await client.query('SELECT * FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r) throw new GameError('no_racket', 'No operation runs there.');
  if (r.owner_gang === h.owned.gangId) throw new GameError('own', "That's your own family's operation.");
  const now = Date.now();
  if (r.raid_cd_until && new Date(r.raid_cd_until) > new Date(now)) throw new GameError('cooldown', 'That operation is on alert — muscle in later.');
  const pending = accrued(r);
  if (pending <= 0) throw new GameError('nothing', "There's nothing in the till to grab right now.");
  const eff = Number(ch.muscle) + Number(ch.cunning) / 2;
  const effFort = Number(r.fortitude) + specFort(r); // step five: a specialist stiffens the defense on top of bought fortitude
  const p = Math.max(CONSTANTS.TERRITORY_RIVAL_MIN_P, Math.min(CONSTANTS.TERRITORY_RIVAL_MAX_P,
    CONSTANTS.TERRITORY_RIVAL_BASE_P + (eff - 30) / CONSTANTS.TERRITORY_RIVAL_STAT_SCALE - effFort * CONSTANTS.TERRITORY_RIVAL_FORT_DEF));
  const pEff = process.env.TERRITORY_RIVAL_RAID_P != null ? Number(process.env.TERRITORY_RIVAL_RAID_P) : p; // TEST-ONLY roll knob
  const roll = Math.random();
  const win = roll < pEff;
  ch.energy = Number(ch.energy) - CONSTANTS.TERRITORY_RIVAL_ENERGY;
  ch.heat = Math.min(100, Number(ch.heat) + CONSTANTS.TERRITORY_RIVAL_HEAT);
  await client.query('UPDATE territory_rackets SET raid_cd_until=$2 WHERE district_id=$1', [districtId, new Date(now + CONSTANTS.TERRITORY_RIVAL_CD_MS)]);
  await h.rngLog(client, ch.id, `territory:raid:${districtId}`, roll, `${win ? 'muscled' : 'repelled'} (P ${pEff.toFixed(3)}, fort ${effFort})`);
  if (!win) {
    ch.health = Math.max(1, Number(ch.health) - CONSTANTS.TERRITORY_RIVAL_FAIL_DMG);
    bus.emit(`gang:${r.owner_gang}`, { type: 'racket_defended', district: districtId });
    await h.track(client, ch.account_id, 'territory_raid', { district: districtId, win: false });
    return { ok: true, district: districtId, win: false, dmg: CONSTANTS.TERRITORY_RIVAL_FAIL_DMG };
  }
  const cut = Math.floor(pending * CONSTANTS.TERRITORY_RIVAL_CUT_BPS / 10000);
  // advance the owner's clock so their remaining pending = pending − cut (the shakedown/convoy pattern)
  const rate = ratePerHr(r);
  const remainMs = rate > 0 ? Math.floor((pending - cut) / rate * 3600000) : 0;
  await client.query('UPDATE territory_rackets SET last_income_at=$2 WHERE district_id=$1', [districtId, new Date(now - remainMs)]);
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [h.owned.gangId, cut]);
  await h.ledger(client, { currency: 'cash', amount: cut, reason: 'territory:muscle', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + cut;
  bus.emit(`gang:${r.owner_gang}`, { type: 'racket_raided', district: districtId, lost: cut });
  await h.track(client, ch.account_id, 'territory_raid', { district: districtId, win: true, cut });
  return { ok: true, district: districtId, win: true, cut };
}

// ── STEP FIVE — RACKET SPECIALISTS + SPECIAL OPERATIONS ──
// Assign a family made-man to run a held operation. Passive: a fortitude bonus (their effStat snapshot
// / SPECIALIST_FORT_DIV) + scrutiny resistance. One racket per specialist. Pure defensive → no §10.4.
export async function assignSpecialist(ch, districtId, memberId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss assigns the crew.');
  if (!memberId) throw new GameError('member', 'Name a made man to run it.');
  // LOCK the GANG row first (char → gang → racket, the territory convention) — this SERIALIZES two
  // concurrent commanders (boss + underboss) assigning the SAME member to two different rackets, which
  // the unlocked one-per-specialist `busy` check below can't catch under READ COMMITTED (both would
  // read the last-committed snapshot and both write). Defensive-only (no §10.4), but a clean fix.
  await client.query('SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId]);
  const r = (await client.query('SELECT * FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r || r.owner_gang !== h.owned.gangId) throw new GameError('no_racket', "Your family doesn't run that operation.");
  // the assignee must be a LIVING made-man of YOUR family (snapshot their stats; re-assign to refresh)
  const m = (await client.query(
    `SELECT c.id, c.muscle, c.cunning, c.respect, c.name FROM characters c
       JOIN gang_members gm ON gm.character_id = c.id
      WHERE c.id=$1 AND c.alive AND gm.gang_id=$2`, [memberId, h.owned.gangId])).rows[0];
  if (!m) throw new GameError('not_member', "That's not one of your made men.");
  if (levelOf(Number(m.respect)) < CONSTANTS.SPECIALIST_MIN_LVL)
    throw new GameError('rookie', `A specialist has to be at least level ${CONSTANTS.SPECIALIST_MIN_LVL}.`);
  // one racket per specialist — a made man can't run two operations at once
  const busy = (await client.query('SELECT district_id FROM territory_rackets WHERE owner_gang=$1 AND specialist=$2 AND district_id<>$3',
    [h.owned.gangId, memberId, districtId])).rows[0];
  if (busy) throw new GameError('assigned', `${m.name} is already running the ${busy.district_id} operation.`);
  const power = Number(m.muscle) + Number(m.cunning);
  await client.query('UPDATE territory_rackets SET specialist=$2, spec_power=$3 WHERE district_id=$1', [districtId, memberId, power]);
  await h.track(client, ch.account_id, 'territory_specialist', { district: districtId, member: memberId });
  return { ok: true, district: districtId, specialist: m.name, fortBonus: Math.floor(power / CONSTANTS.SPECIALIST_FORT_DIV) };
}

// Pull the specialist off an operation (free them for another).
export async function unassignSpecialist(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss assigns the crew.');
  const r = (await client.query('SELECT owner_gang, specialist FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r || r.owner_gang !== h.owned.gangId) throw new GameError('no_racket', "Your family doesn't run that operation.");
  if (!r.specialist) throw new GameError('none', 'No specialist runs that operation.');
  await client.query('UPDATE territory_rackets SET specialist=NULL, spec_power=0 WHERE district_id=$1', [districtId]);
  return { ok: true, district: districtId };
}

// Run the operation's TYPE-specific special operation (requires a specialist), on a per-racket cooldown.
// All §10.4-clean utilities (scrutiny/fortitude — no cash, no faucet): numbers "Cook the Books" clears
// the heat; protection "Show of Force" +TERRITORY_OP_FORT fortitude (capped); smuggling "Ghost the Route"
// clears the heat AND suppresses accrual for a window.
export async function runTerritoryOp(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss calls a special operation.');
  const r = (await client.query('SELECT * FROM territory_rackets WHERE district_id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!r || r.owner_gang !== h.owned.gangId) throw new GameError('no_racket', "Your family doesn't run that operation.");
  if (!r.specialist) throw new GameError('no_specialist', 'Assign a specialist to run a special operation.');
  const now = Date.now();
  if (r.op_at && now - new Date(r.op_at).getTime() < CONSTANTS.TERRITORY_OP_CD_MS)
    throw new GameError('cooldown', 'That operation just ran a special job — give it time.');
  let op, result;
  if (r.kind === 'protection') {
    const lvl = Math.min(CONSTANTS.TERRITORY_FORT_MAX, Number(r.fortitude) + CONSTANTS.TERRITORY_OP_FORT);
    await client.query('UPDATE territory_rackets SET fortitude=$2, op_at=now() WHERE district_id=$1', [districtId, lvl]);
    op = 'show_of_force'; result = { fortitude: lvl };
  } else if (r.kind === 'smuggling') {
    const until = new Date(now + CONSTANTS.TERRITORY_OP_GHOST_MS);
    await client.query('UPDATE territory_rackets SET scrutiny=0, scrutiny_at=now(), op_ghost_until=$2, op_at=now() WHERE district_id=$1', [districtId, until]);
    op = 'ghost_route'; result = { scrutiny: 0, ghostSeconds: Math.ceil(CONSTANTS.TERRITORY_OP_GHOST_MS / 1000) };
  } else { // numbers (or any other) — cook the books: clear the heat
    await client.query('UPDATE territory_rackets SET scrutiny=0, scrutiny_at=now(), op_at=now() WHERE district_id=$1', [districtId]);
    op = 'cook_books'; result = { scrutiny: 0 };
  }
  await h.track(client, ch.account_id, 'territory_op', { district: districtId, op });
  return { ok: true, district: districtId, op, ...result };
}

// SEIZURE hook — called inside seizeDistrict when a district changes hands. The operation transfers
// to the victor; uncollected income is FORFEITED (clock resets) — collect before you lose the turf.
export async function seizeTerritoryRackets(client, districtId, newGang) {
  // the victor inherits a fresh operation — clocks reset (uncollected income forfeits), the pad is
  // squared (they didn't run up the old owner's arrears; a cold seized racket isn't born cold), AND the
  // heat's off (scrutiny=0 — a seized op isn't born hot; the type/business carries with the turf).
  // step four: a seized op isn't born fortified or on alert — the victor starts fresh on defense too.
  // step five: the old crew scatters — the specialist + any special-op state clear with the turf.
  await client.query('UPDATE territory_rackets SET owner_gang=$2, last_income_at=now(), upkeep_at=now(), scrutiny=0, scrutiny_at=now(), fortitude=0, raid_cd_until=NULL, specialist=NULL, spec_power=0, op_at=NULL, op_ghost_until=NULL WHERE district_id=$1', [districtId, newGang]);
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
      scrutiny: Math.round(scr), raidThreshold: CONSTANTS.TERRITORY_RAID_THRESHOLD, raidRisk: scr >= CONSTANTS.TERRITORY_RAID_THRESHOLD,
      // step four — the racket-wars layer: defense level + the next fortify cost + rival-raid cooldown
      fortitude: Number(r.fortitude), fortMax: CONSTANTS.TERRITORY_FORT_MAX,
      fortCost: Number(r.fortitude) < CONSTANTS.TERRITORY_FORT_MAX ? territoryFortCost(Number(r.fortitude), Number(r.tier)) : null,
      raidCdSeconds: r.raid_cd_until ? Math.max(0, Math.ceil((new Date(r.raid_cd_until) - Date.now()) / 1000)) : 0,
      // step five — the crew: the assigned specialist (+ their fortitude bonus) and the special-op cooldown
      specialist: r.specialist || null, specFortBonus: specFort(r),
      opId: r.kind === 'protection' ? 'show_of_force' : r.kind === 'smuggling' ? 'ghost_route' : 'cook_books',
      opReady: !!r.specialist && !(r.op_at && Date.now() - new Date(r.op_at).getTime() < CONSTANTS.TERRITORY_OP_CD_MS),
      opCdSeconds: r.op_at ? Math.max(0, Math.ceil((new Date(r.op_at).getTime() + CONSTANTS.TERRITORY_OP_CD_MS - Date.now()) / 1000)) : 0,
      ghostSeconds: r.op_ghost_until ? Math.max(0, Math.ceil((new Date(r.op_ghost_until) - Date.now()) / 1000)) : 0 };
  });
}
