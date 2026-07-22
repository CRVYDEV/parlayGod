// M3 social systems — gangs, wars, turf, jumps, bounties, hit contracts, death,
// busting, plus the escrowed Exchange (§5.4, deferred from M2 pending notifications).
// Every formula cites spec §7 / prototype v24. Two-party actions run under
// withTwoCharacters (game.js) which locks both rows in stable order (§10.1).
import crypto from 'node:crypto';
import { GameError, bumpFamilyTask, bus, ledger, notify, track, loadOwned, skillMult, npcMult, npcTier, bumpStanding } from './game.js';
import { rememberedSkills } from './skills.js';
import {
  DISTRICTS, CONSUMABLES, M3, M8, CONSTANTS, LOAN,
  levelOf, rankIdxOf, cityEventOf, dayOf, btkOf,
  gunObjOf, vestMultOf, fleetValue, effStat, hitmanRankOf, npcHitmanOf, territoryBuildCost,
  VENDETTA, feudTierOf, COMMISSION, SKILLS, UNDERWORLD, LAW, PORT, witproActive, penSafe, inHole, tickerPriceOf, estateTierOf,
  worldNpcOf, liberationCost,
} from './rules.js';
import { spendOmr } from './vanity.js';
import { seizeTerritoryRackets, releaseTerritoryRackets } from './territory.js';
import { releaseFrontierHolds, abandonRaidsAtDeath, outfitStrengthFrac } from './world.js';
import { activeDecree } from './commission.js';
import { voidListingsAtDeath, burnBidsAtDeath } from './market.js';
import { voidLoansAtDeath } from './loans.js';
import { wipeSpeakeasyAtDeath } from './speakeasy.js';
import { wipeFighterAtDeath, cancelMainEventsAtDeath } from './boxing.js';

const uid = () => crypto.randomUUID();
const now = () => new Date();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const isWanted = (ch) => ch && ch.wanted_until && new Date(ch.wanted_until) > new Date(); // LOAN step 4: a WANTED defaulter forfeits omertà (the rat precedent)
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// ═══════════════════ GANGS (§5.5) ═══════════════════
export async function createGang(ch, name, tag, client, h) {
  if (h.owned.gangId) throw new GameError('in_gang', 'You already have a family.');
  if (levelOf(Number(ch.respect)) < M3.GANG_FOUND_LEVEL) throw new GameError('level', `Level ${M3.GANG_FOUND_LEVEL} to found a family.`);
  name = String(name || '').trim(); tag = String(tag || '').trim().toUpperCase();
  if (name.length < 3 || name.length > 24) throw new GameError('name', 'Family name must be 3–24 characters.');
  if (!/^[A-Z0-9]{2,4}$/.test(tag)) throw new GameError('tag', 'Tag must be 2–4 letters or numbers.');
  if (Number(ch.cash) < M3.GANG_FOUND_COST) throw new GameError('cash', `Founding a family costs $${M3.GANG_FOUND_COST}.`);
  const clash = await client.query('SELECT id FROM gangs WHERE name=$1 OR tag=$2', [name, tag]);
  if (clash.rows.length) throw new GameError('taken', 'That name or tag is already claimed.');
  ch.cash = Number(ch.cash) - M3.GANG_FOUND_COST;
  const id = uid();
  // stamped with the CURRENT season so the rollover sweep never zeroes a mid-season founder's ladder
  await client.query('INSERT INTO gangs (id, name, tag, season) VALUES ($1,$2,$3,$4)', [id, name, tag, Math.floor(dayOf() / 28)]);
  await client.query('INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,$3)', [id, ch.id, 'boss']);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -M3.GANG_FOUND_COST, reason: 'gang:found' });
  h.owned.gangId = id; h.owned.gangRole = 'boss';
  h.owned.gang = { id, name, tag, treasury: 0, ammo_bank: 0 };
  return { ok: true, gangId: id };
}

export async function joinGang(ch, gangId, client, h) {
  if (h.owned.gangId) throw new GameError('in_gang', 'Leave your current family first.');
  // lock the gang row FOR UPDATE so concurrent joiners serialize — otherwise a
  // check-then-insert race lets N accounts blow past GANG_MAX_MEMBERS at once
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (!g) throw new GameError('no_gang', 'That family no longer exists.');
  const n = Number((await client.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [gangId])).rows[0].n);
  if (n >= M3.GANG_MAX_MEMBERS) throw new GameError('full', `That family is full (${M3.GANG_MAX_MEMBERS} made members max).`);
  await client.query('INSERT INTO gang_members (gang_id, character_id, role) VALUES ($1,$2,$3)', [gangId, ch.id, 'soldier']);
  h.owned.gangId = gangId; h.owned.gangRole = 'soldier'; h.owned.gang = g;
  return { ok: true, gangId, name: g.name };
}

// Boss succession on departure: the underboss inherits, then seniority (v24 rule).
// An emptied family dissolves — turf released, wars cleared.
export async function removeMember(client, gangId, characterId) {
  // LOCK THE GANG ROW FIRST (audit HIGH): the "last member" check below must be serialized, or two
  // simultaneous departures from a 2-member family each see the OTHER still present (READ COMMITTED),
  // neither runs dissolution, and the family is orphaned memberless forever — treasury/reserve/armory
  // stranded (never `gang:dissolved`-ledgered → permanent §10.4 treasury drift), turf + territory held
  // by a ghost. joinGang already locks the gang row for exactly this reason (the count invariant). The
  // txn already holds the actor's character/account locks, so gangs-after-characters order is kept.
  await client.query('SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE', [gangId]);
  await client.query('DELETE FROM gang_members WHERE gang_id=$1 AND character_id=$2', [gangId, characterId]);
  const left = (await client.query(
    "SELECT character_id, role FROM gang_members WHERE gang_id=$1 ORDER BY CASE role WHEN 'underboss' THEN 0 WHEN 'capo' THEN 1 ELSE 2 END, character_id", [gangId])).rows;
  if (!left.length) {
    // the family dies with its last member — remaining buckets burn, ledgered
    // so the §10.4 job can reconcile treasuries/reserves/armory exactly
    const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0];
    if (g) {
      if (Number(g.treasury) > 0) await ledger(client, { currency: 'cash', amount: -Number(g.treasury), reason: 'gang:dissolved', counterparty: gangId });
      if (Number(g.omr_reserve) > 0) await ledger(client, { currency: 'omr', amount: -Number(g.omr_reserve), reason: 'gang:dissolved', counterparty: gangId });
      if (Number(g.ammo_bank) > 0) await ledger(client, { currency: 'ammo', amount: -Number(g.ammo_bank), reason: 'gang:dissolved', counterparty: gangId });
    }
    await client.query('UPDATE districts SET holder_gang=NULL, garrison=0 WHERE holder_gang=$1', [gangId]);
    await releaseTerritoryRackets(client, gangId); // Phase 3: the operations die with the family (turf released)
    await releaseFrontierHolds(client, gangId);    // World step three: the frontier flags drop (the house takes its turf back)
    await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL WHERE war_with=$1', [gangId]);
    // the Commission forgets a dead family: its ballots die with it (audit H1 — a dissolved
    // gang's frozen vote must not govern next week from beyond the grave, invisible to the
    // board's join). Its VETO record stays — the decree it killed was killed while it lived.
    await client.query('DELETE FROM commission_votes WHERE gang_id=$1', [gangId]);
    // R1 — the family's legit book dies with the family (status only, no §10.4 currency: the $OMR
    // that bought the shares was already burned 'rwa:invest', so nothing is stranded).
    await client.query('DELETE FROM gang_portfolios WHERE gang_id=$1', [gangId]);
    await client.query('DELETE FROM gangs WHERE id=$1', [gangId]);
    return { dissolved: true };
  }
  const hasBoss = left.some((m) => m.role === 'boss');
  if (!hasBoss)
    await client.query('UPDATE gang_members SET role=$3 WHERE gang_id=$1 AND character_id=$2', [gangId, left[0].character_id, 'boss']);
  return { dissolved: false, newBoss: hasBoss ? null : left[0].character_id };
}

export async function leaveGang(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const r = await removeMember(client, h.owned.gangId, ch.id);
  h.owned.gangId = null; h.owned.gangRole = null; h.owned.gang = null; h.owned.held = [];
  return { ok: true, ...r };
}

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';

export async function kickMember(ch, targetCharacterId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss kicks members.');
  if (targetCharacterId === ch.id) throw new GameError('self', 'Use leave for that.');
  const m = (await client.query('SELECT role FROM gang_members WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId])).rows[0];
  if (!m) throw new GameError('no_member', 'Not one of yours.');
  if (m.role === 'boss') throw new GameError('rank', 'Nobody kicks the boss.');
  await removeMember(client, h.owned.gangId, targetCharacterId);
  return { ok: true };
}

export async function promoteMember(ch, targetCharacterId, role, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss hands out buttons.');
  if (!['underboss', 'capo', 'soldier'].includes(role)) throw new GameError('bad_role', 'Roles: underboss, capo, soldier.');
  if (targetCharacterId === ch.id) throw new GameError('self', 'The boss stays the boss.');
  const m = (await client.query('SELECT role FROM gang_members WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId])).rows[0];
  if (!m) throw new GameError('no_member', 'Not one of yours.');
  if (role === 'underboss') {
    const existing = (await client.query("SELECT character_id FROM gang_members WHERE gang_id=$1 AND role='underboss'", [h.owned.gangId])).rows[0];
    if (existing && existing.character_id !== targetCharacterId) throw new GameError('underboss', 'A family has exactly one underboss.');
  }
  await client.query('UPDATE gang_members SET role=$3 WHERE gang_id=$1 AND character_id=$2', [h.owned.gangId, targetCharacterId, role]);
  return { ok: true, role };
}

export async function tribute(ch, amount, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.TRIBUTE_MIN) throw new GameError('min', `Minimum tribute is $${M3.TRIBUTE_MIN}.`);
  if (Number(ch.cash) < amt) throw new GameError('cash', 'Not that much in pocket.');
  await resolveWarIfDue(client, h.owned.gangId);
  ch.cash = Number(ch.cash) - amt;
  // treasury is a §10.4 cash bucket, not a sink — the ledger row keeps Σ balanced
  // season_tribute rides along — the Commission's seasonal ladder (lifetime feeds the buyback split)
  await client.query('UPDATE gangs SET treasury = treasury + $2, lifetime_tribute = lifetime_tribute + $2, season_tribute = season_tribute + $2 WHERE id=$1', [h.owned.gangId, amt]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'gang:tribute', counterparty: h.owned.gangId });
  await h.bumpDaily(client, ch.id, 'tribute');
  await bumpFamilyTask(client, h, 'tribute', amt);
  bus.emit(`gang:${h.owned.gangId}`, { type: 'tribute', amount: amt });
  return { ok: true, amount: amt };
}

// M8 — $OMR TRIBUTE: any member pools tokens into the family's $OMR RESERVE (the bucket the
// buyback split + weekly bonuses feed), so a seal is a cooperative purchase, not a boss's
// wallet flex. A pure §10.4 bucket TRANSFER (account → reserve, both counted in conservation —
// the total moves nothing), same 'gang:tribute' reason as cash tribute, split by currency.
// It does NOT bump the weekly tribute task (that counts dollars, v24 rule).
export async function tributeOmr(ch, amount, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M8.TRIBUTE_OMR_MIN) throw new GameError('min', `Minimum $OMR tribute is ${M8.TRIBUTE_OMR_MIN}.`);
  if (Number(h.acct.omr) < amt) throw new GameError('omr', 'Not that many tokens in the vault.');
  h.acct.omr = Number(h.acct.omr) - amt;
  await client.query('UPDATE gangs SET omr_reserve = omr_reserve + $2 WHERE id=$1', [h.owned.gangId, amt]);
  await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -amt, reason: 'gang:tribute', counterparty: h.owned.gangId });
  bus.emit(`gang:${h.owned.gangId}`, { type: 'tribute_omr', amount: amt });
  return { ok: true, amount: amt };
}

// ═══════════════════ WARS (§5.5) ═══════════════════
const warActive = (g) => g && g.war_with && new Date(g.war_until) > new Date();

// Lazy war resolution: first touch after war_until settles it — winner takes 20%
// of the loser's treasury and a standing bump (wars_won). Locks both gang rows in
// stable id order (same discipline as character locks, §10.1).
export async function resolveWarIfDue(client, gangId) {
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0];
  if (!g || !g.war_with || new Date(g.war_until) > new Date()) return null;
  const [id1, id2] = [g.id, g.war_with].sort();
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === gangId ? g1 : g2, them = g1?.id === gangId ? g2 : g1;
  if (!us || !us.war_with || new Date(us.war_until) > new Date()) return null; // re-check under lock
  const ourScore = Number(us.war_score_us), theirScore = Number(us.war_score_them);
  let spoils = 0, winner = null;
  if (ourScore !== theirScore && them) {
    const w = ourScore > theirScore ? us : them;
    const l = w === us ? them : us;
    spoils = Math.floor(Number(l.treasury) * M3.WAR_SPOILS);
    winner = w.id;
    await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [l.id, spoils]);
    await client.query('UPDATE gangs SET treasury = treasury + $2, wars_won = wars_won + 1, season_wars = season_wars + 1 WHERE id=$1', [w.id, spoils]);
  }
  await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL, war_score_us=0, war_score_them=0 WHERE id=$1 OR id=$2', [us.id, them?.id || us.id]);
  bus.emit(`gang:${us.id}`, { type: 'war_over', winner, spoils });
  if (them) bus.emit(`gang:${them.id}`, { type: 'war_over', winner, spoils });
  return { winner, spoils };
}

export async function declareWar(ch, targetGangId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss declares war.');
  if (targetGangId === h.owned.gangId) throw new GameError('self', 'A family war with yourself is called Tuesday.');
  // Commission decree: THE PAX — no new wars this week (running wars still resolve)
  if ((await activeDecree(client))?.id === 'pax')
    throw new GameError('pax', 'The Commission has declared the Pax — no new wars this week.');
  await resolveWarIfDue(client, h.owned.gangId);
  await resolveWarIfDue(client, targetGangId);
  const [id1, id2] = [h.owned.gangId, targetGangId].sort();
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === h.owned.gangId ? g1 : g2, them = g1?.id === h.owned.gangId ? g2 : g1;
  if (!them) throw new GameError('no_gang', 'That family no longer exists.');
  if (warActive(us) || warActive(them)) throw new GameError('at_war', 'One of you is already at war.');
  if (Number(us.treasury) < M3.WAR_COST) throw new GameError('treasury', `War takes a $${M3.WAR_COST} war chest in the treasury.`);
  const until = new Date(Date.now() + M3.WAR_MS);
  // the war chest burns — a §10.4 cash sink out of the treasury bucket
  await client.query('UPDATE gangs SET treasury = treasury - $2, war_with=$3, war_until=$4, war_score_us=0, war_score_them=0 WHERE id=$1',
    [us.id, M3.WAR_COST, them.id, until]);
  await client.query('UPDATE gangs SET war_with=$2, war_until=$3, war_score_us=0, war_score_them=0 WHERE id=$1', [them.id, us.id, until]);
  await h.ledger(client, { currency: 'cash', amount: -M3.WAR_COST, reason: 'gang:war', counterparty: us.id });
  bus.emit(`gang:${them.id}`, { type: 'war_declared', by: us.name });
  return { ok: true, until, spoilsPct: M3.WAR_SPOILS };
}

// ═══════════════════ TURF (§5.5) ═══════════════════
export async function seizeDistrict(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss seizes turf.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (d.holder_gang === h.owned.gangId) throw new GameError('held', 'You already hold that district.');
  // STEP FIVE — THE OCCUPATION: an NPC-garrisoned district is LIBERATED (not seized from a player). The
  // cost scales with the occupying outfit's LIVE strength (a lockless quote — beat it down first and its
  // turf goes cheap), floored at OCCUPY_MIN. No territory racket transfers (an NPC district has none).
  const occupied = !!d.npc_holder;
  let base, premium = 0;
  if (occupied) {
    const fixture = worldNpcOf(d.npc_holder);
    // Frontier B1 precedent: you can only hold turf you could raid. A rookie can't free-ride
    // others' rout of an apex outfit to liberate its core district on the cheap.
    if (levelOf(Number(ch.respect)) < (fixture?.minLvl || 0))
      throw new GameError('level', `Taking ${fixture.name}'s turf takes level ${fixture.minLvl}.`);
    const frac = await outfitStrengthFrac(client, fixture);
    base = liberationCost(fixture, frac);
  } else {
    base = d.holder_gang ? Math.max(M3.SEIZE_BASE, Math.floor(Number(d.garrison) * M3.SEIZE_OUTBID)) : M3.SEIZE_BASE;
    // sim-audit F5: a district with a PRODUCTIVE OPERATION costs a war premium scaled to what's
    // being taken — TERRITORY_SEIZE_BPS of the operation's cumulative build cost. Seizing a maxed
    // Smuggling Front is no longer ~18× cheaper than building one; the snowball pays freight.
    const op = (await client.query('SELECT tier FROM territory_rackets WHERE district_id=$1', [districtId])).rows[0];
    premium = op ? Math.floor(territoryBuildCost(op.tier) * M3.TERRITORY_SEIZE_BPS / 10000) : 0;
  }
  const cost = base + premium;
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (Number(g.treasury) < cost)
    throw new GameError('treasury', occupied
      ? `Liberating that district from the ${worldNpcOf(d.npc_holder)?.name || 'occupiers'} takes $${cost} from the treasury (beat the outfit down to cheapen it).`
      : `Seizing that district takes $${cost} from the treasury${premium ? ` ($${premium} of it the war premium on its operation)` : ''}.`);
  // the garrison burns — turf costs the family real money (§10.4 sink); only the garrison part becomes the
  // new defense budget (the premium burned taking the operation). Liberation clears the NPC occupier.
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, cost]);
  await client.query('UPDATE districts SET holder_gang=$2, npc_holder=NULL, garrison=$3, seized_at=$4 WHERE id=$1', [districtId, h.owned.gangId, base, now()]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: `turf:seize:${districtId}`, counterparty: h.owned.gangId });
  // Phase 3: the district's productive operation (if any) transfers to the victor with the turf —
  // wars are now fought over income, not just a treasury cut. Uncollected income forfeits (clock resets).
  if (!occupied) await seizeTerritoryRackets(client, districtId, h.owned.gangId);
  if (!h.owned.held.includes(districtId)) h.owned.held.push(districtId);
  bus.emit('streets', occupied ? { type: 'liberated', district: districtId, gang: g.name, npc: worldNpcOf(d.npc_holder)?.name }
    : { type: 'seize', district: districtId, gang: g.name });
  return { ok: true, district: districtId, garrison: base, premium, cost, liberated: occupied };
}

// ═══════════════════ JUMPS (§7.6) ═══════════════════
export async function jump(ch, victim, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't throw hands while you're to ground — a safehouse is a shield, not a bunker.");
  if (Number(ch.health) < M3.JUMP_MIN_HEALTH) throw new GameError('health', "You're in no shape for a fight.");
  if (Number(ch.energy) < M3.JUMP_ENERGY) throw new GameError('energy', `Need ${M3.JUMP_ENERGY} energy to jump someone.`);
  if ((Number(ch.ammo) || 0) < M3.JUMP_AMMO) throw new GameError('ammo', `A jump takes ${M3.JUMP_AMMO} rounds.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  // an unreachable target can't be jumped either — jail/witness-protection/the Pen's yard-boss shield or
  // the hole put them beyond a street beating, exactly as fire/npcHit/shank gate (AUDIT-full-system v3:
  // jump was the one value-moving PvP path left un-gated, so jail was strictly more dangerous than the
  // street). safehouse stays intentionally omitted — a safe-housed man is still jumpable, non-lethally.
  if (jailed(victim)) throw new GameError('jailed', "They're in lockup — out of your reach.");
  if (witproActive(victim)) throw new GameError('witpro', 'They vanished into witness protection.');
  if (penSafe(victim) || inHole(victim)) throw new GameError('protected', "They're locked down where you can't reach.");
  // omertà holds inside the family — VOID for a rat OR a WANTED man (a defaulter/escapee under pursuit),
  // matching fire/npcHit/postBounty/startSearch so a fugitive forfeits protection on EVERY PvP path (the
  // non-lethal jump was the one gap; a hunted man's own family can lay hands on him too).
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId && !h.victimAcct.rat && !isWanted(victim)) throw new GameError('family', "They're family. Omertà.");
  ch.energy = Number(ch.energy) - M3.JUMP_ENERGY;
  ch.ammo = Number(ch.ammo) - M3.JUMP_AMMO;
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -M3.JUMP_AMMO, reason: 'jump' });

  if (h.owned.gangId) await resolveWarIfDue(client, h.owned.gangId);
  const ev = cityEventOf(dayOf());
  const myGang = h.owned.gangId ? (await client.query('SELECT * FROM gangs WHERE id=$1', [h.owned.gangId])).rows[0] : null;
  const war = warActive(myGang) && myGang.war_with === h.victimOwned.gangId;

  const rIdx = rankIdxOf(levelOf(Number(ch.respect)));
  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const vEff = (s) => effStat(victim[s], s, h.victimOwned.assets, h.victimOwned.gear);
  // BRUISER (skills): the enforcer hits harder — a new modifier on the attack term, sign-off lever
  const atk = (eff('muscle') + eff('speed') * 0.5 + (gunObjOf(ch.gun)?.fp || 0) * 0.4 + (rIdx >= 3 ? 5 : 0))
    * (ch.path === 'gun' ? 1.1 : 1) * skillMult(h, 'bruiser', SKILLS.FX.BRUISER_MULT) * skillMult(h, 'made_man', SKILLS.FX.MADE_MAN_MULT) + Math.random() * 25;
  const def = (vEff('muscle') + vEff('speed') * 0.5 + (gunObjOf(victim.gun)?.fp || 0) * 0.4) + Math.random() * 25;
  await h.rngLog(client, ch.id, `jump:${victim.id}`, Math.round(atk * 100) / 100, atk > def ? 'win' : 'loss');

  if (atk > def) {
    const stealPct = (war ? 0.25 : 0.15) + (ev.stealAdd || 0);
    const stolen = Math.min(Math.floor(Number(victim.cash) * stealPct), M3.JUMP_STEAL_CAP);
    const crates = Math.min(Number(victim.cb) || 0, rand(1, 3));
    const rival = !!(h.victimOwned.gangId && h.owned.gangId && h.victimOwned.gangId !== h.owned.gangId);
    let rep = Math.max(3, Math.floor(Number(victim.respect) * 0.01 * (rival ? 1.5 : 1))) + (rival ? 2 : 0);
    if (war) rep *= 2;
    rep = Math.floor(rep * (ev.jumpRep || 1));
    const dmg = rand(20, 40);

    ch.cash = Number(ch.cash) + stolen; ch.cb = (Number(ch.cb) || 0) + crates; ch.respect = Number(ch.respect) + rep;
    victim.cash = Number(victim.cash) - stolen; victim.cb = (Number(victim.cb) || 0) - crates;
    victim.health = Math.max(1, Number(victim.health) - dmg);
    victim.hosp_until = new Date(Date.now() + M3.JUMP_HOSP_MS);
    if (stolen > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: stolen, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -stolen, reason: 'jump:stolen', counterparty: ch.id });
    }
    if (crates > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cb', amount: -crates, reason: 'jump:stolen', counterparty: ch.id });
    }
    if (war) {
      // both score updates in ONE statement (the fire-kill pattern) — two separate "my gang first"
      // UPDATEs acquire the rows unsorted, so simultaneous cross-jumps between the two warring
      // families AB-BA deadlock on real Postgres (invisible on pg-mem).
      await client.query(
        `UPDATE gangs SET war_score_us = war_score_us + CASE WHEN id=$1 THEN 1 ELSE 0 END,
                          war_score_them = war_score_them + CASE WHEN id=$2 THEN 1 ELSE 0 END
          WHERE id IN ($1,$2)`, [h.owned.gangId, h.victimOwned.gangId]);
    }
    const { total: bounty } = await claimBounty(client, h, ch, victim.id, ['hospitalize']); // a jump only fulfils hospitalize contracts
    await h.notify(client, victim.id, 'attack', { from: ch.name, stolen, cb: crates, dmg, hospMs: M3.JUMP_HOSP_MS });
    await h.bumpDaily(client, ch.id, 'jump');
    await bumpFamilyTask(client, h, 'jump', 1);
    bus.emit('streets', { type: 'jump', by: ch.name, on: victim.name, war: !!war });
    return { ok: true, win: true, stolen, crates, rep, bounty, war: !!war };
  }
  const dmg = rand(10, 25);
  ch.health = Math.max(1, Number(ch.health) - dmg);
  return { ok: true, win: false, dmg };
}

// ═══════════════════ BOUNTIES / THE CONTRACT BOARD (§5.2, M7 Phase 1) ═══════════════════
// Escrowed at post time (a §10.4 escrow bucket); paid to the fulfiller, NEVER a funder. 2%
// house take on top. One pot per (target, kind): a 'hospitalize' pot pays on a winning jump
// or a kill; a premium 'kill' pot pays ONLY on a completed hit. Contracts carry a reason +
// expiry; a funder can cancel their own share, and expired pots refund every funder.
const BKINDS = new Set(['hospitalize', 'kill']);
const bountyReason = (r) => (r ? String(r).replace(/\s+/g, ' ').trim().slice(0, 140) || null : null);

export async function postBounty(ch, targetCharacterId, amount, client, h, opts = {}) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'A price on your own head? See the Doc.');
  const kind = opts.kind || 'kill';
  if (!BKINDS.has(kind)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const t = (await client.query('SELECT id, name, account_id, welsher, wanted_until FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  // a rat forfeits family protection (audit): fetched once, reused for the omertà void + the waiver
  const targetRat = !!(await client.query('SELECT rat FROM account_persistent WHERE account_id=$1', [t.account_id])).rows[0]?.rat;
  // Omertà: no open contracts on your own family (parity with searches/hits) — VOID for a rat OR a
  // WANTED welsher (a defaulter under pursuit is fair game even to their own family, step 4).
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === h.owned.gangId && !targetRat && !isWanted(t)) throw new GameError('family', "They're family. Omertà.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.BOUNTY_MIN) throw new GameError('min', `Minimum contract is $${M3.BOUNTY_MIN}.`);
  // VINNIE T2 (underworld): the Match waives HIS 1% posting fee for friends — the street
  // tax always stands. The discounted total is what's ledgered (decree/skill precedent).
  const fee = npcTier(h, 'fixer') >= 2 ? 0 : Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01);
  if (Number(ch.cash) < amt + fee + tax) throw new GameError('cash', `That contract costs $${amt + fee + tax} with the take.`);
  const ttlH = Math.min(M3.BOUNTY_MAX_TTL_H, Math.max(1, Math.floor(Number(opts.hours) || M3.BOUNTY_DEFAULT_TTL_H)));
  // directed contract: name a hitman who gets an exclusive window before it opens to all. Only
  // set on a FRESH pot (a top-up inherits the original's direction — you fund the standing job).
  let hitmanId = null, opensAt = null;
  if (opts.hitman) {
    if (opts.hitman === targetCharacterId) throw new GameError('bad_hitman', "You can't name the mark as the hitman.");
    if (opts.hitman === ch.id) throw new GameError('bad_hitman', "Name someone else — you can't collect your own contract anyway.");
    const hm = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [opts.hitman])).rows[0];
    if (!hm) throw new GameError('no_hitman', 'No such hitman on the streets.');
    // sim-audit F1 (squat resistance): exclusivity takes a real stake and a bounded window —
    // a $500 pot can't reserve a mark, and no window outlives DIRECTED_MAX_H. EXCEPTION: an
    // active VENDETTA against the target's bloodline waives the floor for KILL pots only —
    // vengeance posts at street rates (your money, your blood debt). Hospitalize pots never
    // get the waiver (audit F2: kill pots pay ANY killer inside the window so they can't be
    // squatted, but hospitalize pots stay exclusive — a manufactured vendetta + a $500
    // friendly hospitalize pot would re-open exactly the squat DIRECTED_MIN priced out).
    const vendetta = kind === 'kill' ? (await client.query(
      'SELECT 1 FROM vendettas WHERE avenger_account=$1 AND target_account=$2 AND expires_at > now()',
      [ch.account_id, t.account_id])).rows[0] : null;
    // THE LAW Phase 4: a RAT is fair game — the directed floor is waived on a KILL contract on an
    // informant, so the whole town can put a named gun on them cheaply (the vendetta-waiver twin).
    const ratWaiver = kind === 'kill' && targetRat;
    // LOAN step 2 (the welsher hunt): a defaulter's broken word makes them cheap to hunt — the
    // directed floor is waived on a KILL contract on a WELSHER (the rat-waiver twin; status
    // consequence, not a clawback — no money returns to any lender). Their family still shields
    // them from OPEN contracts (unlike a rat) — a welsher is a lesser offense than an informant.
    const welsherWaiver = kind === 'kill' && !!t.welsher;
    if (!vendetta && !ratWaiver && !welsherWaiver && amt < M3.DIRECTED_MIN) throw new GameError('directed_min', `Naming a hitman takes a serious stake — $${M3.DIRECTED_MIN} minimum.`);
    hitmanId = hm.id;
    const exH = Math.min(ttlH, M3.DIRECTED_MAX_H, Math.max(1, Math.floor(Number(opts.exclusiveHours) || 24)));
    opensAt = new Date(Date.now() + exH * 3600 * 1000);
  }
  ch.cash = Number(ch.cash) - amt - fee - tax;

  // Lock any existing pot for (target,kind) in ANY state (pot row BEFORE funder rows — the
  // stable order). A LIVE pot is topped up (keeping its first poster/reason/expiry — expiry
  // does NOT extend, so no grief-forever contracts). An EXPIRED-but-unswept pot is refunded to
  // its old funders and replaced by a fresh pot (matching "expired = gone"). None → a fresh pot.
  // (SELECT-then-write — pg-mem's ON CONFLICT is unreliable.)
  const existing = (await client.query('SELECT amount, expires_at FROM bounties WHERE target_character=$1 AND kind=$2 FOR UPDATE', [targetCharacterId, kind])).rows[0];
  const live = existing && !(existing.expires_at && new Date(existing.expires_at) <= new Date());
  // direction is set by the FIRST poster only — a top-up can't silently redirect (or fail to)
  if (hitmanId && live) throw new GameError('directed_exists', 'That mark already has a standing contract — only the first poster names the hitman.');
  if (existing && !live) { // clear the lapsed pot first, crediting the poster's own lapsed stake in-memory
    const { selfRefund } = await refundPot(client, targetCharacterId, kind, ch.id);
    ch.cash = Number(ch.cash) + selfRefund;
  }
  if (live) {
    await client.query('UPDATE bounties SET amount = amount + $3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, kind, amt]);
  } else {
    // M8: keeping your name off the board costs $OMR — charged only when the flag takes effect
    // (a fresh pot; top-ups inherit the standing pot's anonymity and are never charged). An
    // insufficient balance throws here and rolls the whole post back, cash included.
    if (opts.anon) await spendOmr(client, h, M8.BOARD_ANON_OMR, 'intel:anon');
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000);
    await client.query('INSERT INTO bounties (target_character, kind, amount, posted_by, anon, reason, hitman, opens_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [targetCharacterId, kind, amt, ch.id, !!opts.anon, bountyReason(opts.reason), hitmanId, opensAt, expiresAt]);
  }
  // track EVERY funder's share: none can collect (anti-self-pay), and a cancel/expiry refunds
  // each exactly what they put in.
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, ch.id])).rows[0];
  if (mine) await client.query('UPDATE bounty_contributors SET amount = amount + $4 WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, ch.id, amt]);
  else await client.query('INSERT INTO bounty_contributors (target_character, kind, contributor, amount) VALUES ($1,$2,$3,$4)', [targetCharacterId, kind, ch.id, amt]);

  // two ledger rows so §10.4 reconciles the escrow bucket vs the 2% house take separately
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amt, reason: 'bounty:post', counterparty: targetCharacterId });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -(fee + tax), reason: 'bounty:take', counterparty: targetCharacterId });
  await takeHouse(client, tax);
  await bumpStanding(client, h, ch, 'fixer', 3, { action: 'post' }); // posting work is doing business with the Match
  bus.emit('streets', { type: 'bounty', on: t.name, amount: amt, kind });
  await h.notify(client, targetCharacterId, 'bounty_on_you', { kind, amount: amt }); // the mark can react (lay low, etc.)
  if (hitmanId && !live) await h.notify(client, hitmanId, 'contract_offer', { target: t.name, kind, amount: amt }); // the named hitman is tapped
  return { ok: true, kind, total: (live ? Number(existing.amount) : 0) + amt, expiresHours: ttlH, hitman: hitmanId || undefined };
}

// Collect every claimable pot on the victim: `kinds` is what this takedown fulfils — a jump
// pays ['hospitalize']; a kill pays ['hospitalize','kill']. Skips a pot the collector funded
// (lock-out), a pot still inside another hitman's exclusive window, and an expired pot (left
// for the refund sweep). Returns { total, directed } — directed=true if a pot named to `ch`
// (a directed contract they were tapped for) was among those collected → bonus assassin rep.
export async function claimBounty(client, h, ch, victimId, kinds) {
  const pots = (await client.query('SELECT kind, amount, hitman, opens_at FROM bounties WHERE target_character=$1 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [victimId])).rows;
  let total = 0, directed = false;
  for (const p of pots) {
    if (!kinds.includes(p.kind)) continue;
    // directed contract still in its exclusive window → only the named hitman may collect —
    // EXCEPT on a completed KILL: the mark is dead, and the pot pays whoever did the job (the
    // named hitman keeps the exclusive 1.5× rep bonus, not the corpse). Without this, a mark's
    // confederate could squat a cheap directed pot on a friendly alt and every enemy kill would
    // refund instead of pay (sim-audit F1). Hospitalize pots (non-terminal) stay exclusive.
    if (p.kind !== 'kill' && p.hitman && p.opens_at && new Date(p.opens_at) > new Date() && p.hitman !== ch.id) continue;
    // a funder never collects; the pot stands (dies with the target). A family-funded share
    // (contributor = gang id) locks out EVERY member of that family — the family ordered the
    // job, so doing it is your duty, not a payday (and the boss can't pay himself from the pot).
    const contributed = (await client.query('SELECT 1 FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND (contributor=$3 OR contributor=$4)',
      [victimId, p.kind, ch.id, h.owned.gangId || ch.id])).rows.length;
    if (contributed) continue;
    if (p.hitman === ch.id) directed = true; // fulfilled a contract they were named on
    await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [victimId, p.kind]);
    await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2', [victimId, p.kind]);
    total += Math.floor(Number(p.amount));
  }
  if (total > 0) {
    ch.cash = Number(ch.cash) + total;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: total, reason: 'bounty:claim', counterparty: victimId });
  }
  return { total, directed };
}

// A funder withdraws their own share of a LIVE contract (the 2% take is non-refundable).
export async function cancelBounty(ch, targetCharacterId, kind, client, h) {
  const k = kind || 'kill';
  if (!BKINDS.has(k)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  // lock the POT row first, then the contributor row — the SAME order claim/sweep use, so a
  // cancel can never deadlock against a concurrent kill/jump or the expiry sweep. Live pots
  // only: a lapsed pot refunds itself via the sweep.
  const pot = (await client.query('SELECT amount FROM bounties WHERE target_character=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [targetCharacterId, k])).rows[0];
  if (!pot) throw new GameError('no_contract', 'No open contract of yours there (a lapsed one refunds itself).');
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3 FOR UPDATE', [targetCharacterId, k, ch.id])).rows[0];
  if (!mine || !(Number(mine.amount) > 0)) throw new GameError('no_contract', "You haven't funded that contract.");
  const refund = Math.floor(Number(mine.amount));
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, k, ch.id]);
  const remaining = Number(pot.amount) - refund;
  if (remaining > 0) await client.query('UPDATE bounties SET amount=$3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, k, remaining]);
  else await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [targetCharacterId, k]);
  ch.cash = Number(ch.cash) + refund;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: refund, reason: 'bounty:refund', counterparty: targetCharacterId });
  return { ok: true, refunded: refund, potRemaining: Math.max(0, remaining) };
}

// ═══════════════════ FAMILY CONTRACTS (M7 Phase 4) — the treasury orders the hit ═══════════════════
// The boss (or underboss) posts a contract funded from the GANG TREASURY — the first sanctioned
// player-directed outflow from the roach-motel treasury, tying the social layer to the kill layer.
// It rides the SAME (target, kind) pot as player bounties: the family's share is a
// bounty_contributors row with contributor = the GANG id + funder_gang, so the proven funder
// lockout extends to the whole family (no member collects the family's own money — the family
// ordered the job; doing it is your duty, not a payday) and a cancel/expiry refunds the treasury.
// §10.4: the escrow transfer is ledgered 'gang:contract' with NO character_id (treasury bucket →
// escrow bucket; character cash never moves), the 2% take as 'gang:contract:take'. Family
// contracts are always OPEN (no directed hitman) — the family taps no one, it taps everyone.
export async function postFamilyContract(ch, targetCharacterId, amount, client, h, opts = {}) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss spends family money.');
  const gangId = h.owned.gangId;
  if (targetCharacterId === ch.id) throw new GameError('self', 'A price on your own head? See the Doc.');
  const kind = opts.kind || 'kill';
  if (!BKINDS.has(kind)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const t = (await client.query('SELECT id, name FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === gangId) throw new GameError('family', "They're family. Omertà.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.BOUNTY_MIN) throw new GameError('min', `Minimum contract is $${M3.BOUNTY_MIN}.`);
  const fee = Math.ceil(amt * 0.01), tax = Math.ceil(amt * 0.01);
  const ttlH = Math.min(M3.BOUNTY_MAX_TTL_H, Math.max(1, Math.floor(Number(opts.hours) || M3.BOUNTY_DEFAULT_TTL_H)));
  // pot row locked FIRST, THEN the gang — the stable pot → gang order every other pot path uses
  // (cancelFamilyContract, the expiry sweep). Locking the gang first (as this did) inverts that
  // order and AB-BA deadlocks a repost against a concurrent cancel/sweep under real Postgres.
  // A live pot is topped up; an expired-unswept pot is refunded (skipId = the posting BOSS: if
  // they personally funded the old pot, their refund must land in-memory or persistCharacter
  // clobbers the SQL credit).
  const existing = (await client.query('SELECT amount, expires_at, anon FROM bounties WHERE target_character=$1 AND kind=$2 FOR UPDATE', [targetCharacterId, kind])).rows[0];
  const live = existing && !(existing.expires_at && new Date(existing.expires_at) <= new Date());
  if (existing && !live) {
    const { selfRefund } = await refundPot(client, targetCharacterId, kind, ch.id);
    ch.cash = Number(ch.cash) + selfRefund;
  }
  // a top-up inherits the standing pot's anonymity — the public emit below must respect the POT's
  // flag, not just this post's option, or topping up an anon pot would out the family
  const potAnon = live ? !!existing.anon : !!opts.anon;
  // gang row AFTER the pot (and after character/account rows) — the global lock order
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (Number(g.treasury) < amt + fee + tax) throw new GameError('treasury', `That contract takes $${amt + fee + tax} from the treasury (2% take included).`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [gangId, amt + fee + tax]);
  if (live) {
    await client.query('UPDATE bounties SET amount = amount + $3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, kind, amt]);
  } else {
    // M8: family anonymity costs the same as anyone's — the BOSS pays it personally (the
    // treasury holds cash, not $OMR; discretion is the officer's own expense).
    if (opts.anon) await spendOmr(client, h, M8.BOARD_ANON_OMR, 'intel:anon');
    const expiresAt = new Date(Date.now() + ttlH * 3600 * 1000);
    await client.query('INSERT INTO bounties (target_character, kind, amount, posted_by, anon, reason, posted_by_gang, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [targetCharacterId, kind, amt, ch.id, !!opts.anon, bountyReason(opts.reason), gangId, expiresAt]);
  }
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, gangId])).rows[0];
  if (mine) await client.query('UPDATE bounty_contributors SET amount = amount + $4 WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, kind, gangId, amt]);
  else await client.query('INSERT INTO bounty_contributors (target_character, kind, contributor, amount, funder_gang) VALUES ($1,$2,$3,$4,true)', [targetCharacterId, kind, gangId, amt]);

  await h.ledger(client, { currency: 'cash', amount: -amt, reason: 'gang:contract', counterparty: targetCharacterId });
  await h.ledger(client, { currency: 'cash', amount: -(fee + tax), reason: 'gang:contract:take', counterparty: targetCharacterId });
  await takeHouse(client, tax);
  await h.track(client, ch.account_id, 'family_contract', { target: targetCharacterId, kind, amount: amt });
  // an anon pot must not leak the family on the PUBLIC streets feed — the 3 $OMR bought silence
  // (the board already hides it; the private gang: channel emit below may still name it)
  bus.emit('streets', { type: 'bounty', on: t.name, amount: amt, kind, ...(potAnon ? {} : { family: g.name }) });
  bus.emit(`gang:${gangId}`, { type: 'family_contract', on: t.name, amount: amt, kind });
  await h.notify(client, targetCharacterId, 'bounty_on_you', { kind, amount: amt });
  // fresh read: an expired-repost may have refunded the old pot's gang share mid-flight
  const treasury = Number((await client.query('SELECT treasury FROM gangs WHERE id=$1', [gangId])).rows[0].treasury);
  if (h.owned.gang) h.owned.gang.treasury = treasury; // keep the view honest
  return { ok: true, kind, total: (live ? Number(existing.amount) : 0) + amt, expiresHours: ttlH, treasury };
}

// The boss calls the family's contract off — the family's share goes home to the treasury
// (the 2% take is spent). Pot row locked FIRST, same order as claim/sweep/cancel.
export async function cancelFamilyContract(ch, targetCharacterId, kind, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss calls off family business.');
  const gangId = h.owned.gangId;
  const k = kind || 'kill';
  if (!BKINDS.has(k)) throw new GameError('kind', "A contract is 'hospitalize' or 'kill'.");
  const pot = (await client.query('SELECT amount FROM bounties WHERE target_character=$1 AND kind=$2 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE', [targetCharacterId, k])).rows[0];
  if (!pot) throw new GameError('no_contract', 'No open family contract there (a lapsed one refunds itself).');
  const mine = (await client.query('SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3 FOR UPDATE', [targetCharacterId, k, gangId])).rows[0];
  if (!mine || !(Number(mine.amount) > 0)) throw new GameError('no_contract', "The family hasn't funded that contract.");
  const refund = Math.floor(Number(mine.amount));
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND contributor=$3', [targetCharacterId, k, gangId]);
  const remaining = Number(pot.amount) - refund;
  if (remaining > 0) await client.query('UPDATE bounties SET amount=$3 WHERE target_character=$1 AND kind=$2', [targetCharacterId, k, remaining]);
  else await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [targetCharacterId, k]);
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [gangId, refund]);
  await h.ledger(client, { currency: 'cash', amount: refund, reason: 'bounty:refund', counterparty: targetCharacterId });
  if (h.owned.gang) h.owned.gang.treasury = Number(h.owned.gang.treasury) + refund; // keep the view honest
  return { ok: true, refunded: refund, potRemaining: Math.max(0, remaining) };
}

// The public board — open (non-expired) contracts, richest first. A directed contract inside
// its exclusive window shows the named hitman + when it opens to everyone.
export async function listContracts(pool) {
  const rows = (await pool.query(
    `SELECT b.target_character, b.kind, b.amount, b.anon, b.reason, b.expires_at, b.opens_at,
            t.name AS target_name, p.name AS poster_name, hm.name AS hitman_name, fg.name AS family_name
       FROM bounties b
       JOIN characters t ON t.id = b.target_character
       LEFT JOIN characters p ON p.id = b.posted_by
       LEFT JOIN characters hm ON hm.id = b.hitman
       LEFT JOIN gangs fg ON fg.id = b.posted_by_gang
      WHERE b.expires_at IS NULL OR b.expires_at > now()
      ORDER BY b.amount DESC LIMIT 100`)).rows;
  const secsTo = (t) => (t ? Math.max(0, Math.ceil((new Date(t) - Date.now()) / 1000)) : null);
  return rows.map((r) => {
    const exclusive = r.hitman_name && r.opens_at && new Date(r.opens_at) > new Date();
    return {
      target: { id: r.target_character, name: r.target_name },
      kind: r.kind, pot: Math.floor(Number(r.amount)), reason: r.reason || null,
      // a family contract shows the FAMILY on the board (unless anon) — the message is the point
      poster: r.anon ? null : (r.family_name || r.poster_name || null),
      family: r.anon ? false : !!r.family_name,
      directedTo: exclusive ? r.hitman_name : null, // only while the exclusive window is open
      opensInSeconds: exclusive ? secsTo(r.opens_at) : null,
      expiresInSeconds: secsTo(r.expires_at),
    };
  });
}

// M8 — COUNTER-INTELLIGENCE: "who wants me dead?" The mark pays $OMR to read every funder on
// every open pot on their own head — names, shares, reasons, the named hitman — INCLUDING
// anonymous posters. Anonymity is purchasable (the anon fee), and so is piercing it: the two
// sinks feed each other, and neither moves a dollar of the escrow itself. Free when there is
// nothing to learn — the ear to the ground only charges when it hears something.
export async function peekContracts(ch, client, h) {
  const pots = (await client.query(
    `SELECT b.kind, b.amount, b.reason, b.expires_at, hm.name AS hitman_name
       FROM bounties b LEFT JOIN characters hm ON hm.id = b.hitman
      WHERE b.target_character=$1 AND (b.expires_at IS NULL OR b.expires_at > now())`, [ch.id])).rows;
  if (!pots.length) throw new GameError('no_contracts', 'Your ear to the ground hears nothing. Nobody has paper on you — today.');
  await spendOmr(client, h, M8.INTEL_PEEK_OMR, 'intel:peek');
  const funders = (await client.query(
    `SELECT bc.kind, bc.amount, bc.funder_gang, c.name AS char_name, g.name AS gang_name
       FROM bounty_contributors bc
       LEFT JOIN characters c ON c.id = bc.contributor
       LEFT JOIN gangs g ON g.id = bc.contributor
      WHERE bc.target_character=$1`, [ch.id])).rows;
  await h.track(client, ch.account_id, 'intel_peek', { pots: pots.length });
  return { ok: true, contracts: pots.map((p) => ({
    kind: p.kind, pot: Math.floor(Number(p.amount)), reason: p.reason || null,
    hitman: p.hitman_name || null,
    expiresInSeconds: p.expires_at ? Math.max(0, Math.ceil((new Date(p.expires_at) - Date.now()) / 1000)) : null,
    funders: funders.filter((f) => f.kind === p.kind).map((f) => ({
      name: f.funder_gang ? `${f.gang_name} (family)` : (f.char_name || 'a dead man'),
      amount: Math.floor(Number(f.amount)),
    })),
  })) };
}

// Refund one pot to its funders and delete it — shared by the expiry sweep and a repost that
// lands on an expired-unswept pot. A LIVING funder is credited (ledgered bounty:refund); a
// DEAD funder's stake is BURNED (death:bounty) rather than paid to their corpse — death
// forfeits escrowed stakes like the rest of a dead street's wealth. The caller must already
// hold the pot row lock; everyone locks the pot BEFORE funder rows (stable order).
// `skipId` is the LIVE poster's character id (postBounty): their own refund must NOT be written
// via SQL — the surrounding withCharacter txn persists the in-memory `ch` at commit and would
// clobber it — so it's returned as `selfRefund` for the caller to apply to `ch.cash`. The sweep
// passes no skipId. Returns { refunded (total leaving escrow), selfRefund }.
async function refundPot(client, target, kind, skipId = null) {
  // LEFT JOIN: a family-funded share (contributor = gang id, funder_gang) has no characters row —
  // an inner join would silently drop it from the refund and leak the escrow.
  // ORDER BY contributor (AUDIT-full-system-v2 B-M1): the loop's UPDATEs row-lock each funder in read
  // order, so a stable sort makes every refundPot acquire funder locks in the same order — no two
  // reposts (or a repost vs the worker sweep) can AB-BA on an overlapping funder set.
  const funders = (await client.query(
    'SELECT bc.contributor, bc.amount, bc.funder_gang, c.alive FROM bounty_contributors bc LEFT JOIN characters c ON c.id = bc.contributor WHERE bc.target_character=$1 AND bc.kind=$2 ORDER BY bc.contributor',
    [target, kind])).rows;
  let refunded = 0, selfRefund = 0;
  for (const f of funders) {
    const amt = Math.floor(Number(f.amount));
    if (amt <= 0) continue;
    if (f.funder_gang) {
      // a family's stake goes home to the treasury (a §10.4 bucket transfer, character_id NULL so
      // character-cash reconciliation is untouched); a DISSOLVED family's stake burns like a dead
      // funder's — there is no treasury left to take it home.
      const g = (await client.query('SELECT id FROM gangs WHERE id=$1', [f.contributor])).rows[0];
      if (g) {
        await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [f.contributor, amt]);
        await ledger(client, { currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
      } else {
        await ledger(client, { currency: 'cash', amount: -amt, reason: 'death:bounty', counterparty: target });
      }
    } else if (f.contributor === 'HOUSE') {
      // LOAN step 4: the underworld's WANTED_BOUNTY goes home to the confiscation POOL on expiry (a
      // §10.4 bucket transfer, character_id NULL). A DISTINCT reason (`bounty:wanted:refund`) — a plain
      // `bounty:refund` NULL row is indistinguishable from a family-contract refund and would drift the
      // gang-treasuries check (b), which sums NULL bounty:refund as treasury inflow (audit HIGH).
      await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [amt]);
      await ledger(client, { currency: 'cash', amount: amt, reason: 'bounty:wanted:refund', counterparty: target });
    } else if (f.contributor === skipId) {
      selfRefund += amt; // caller applies to the poster's in-memory cash
      await ledger(client, { characterId: f.contributor, currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
    } else if (f.alive) {
      await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [f.contributor, amt]);
      await ledger(client, { characterId: f.contributor, currency: 'cash', amount: amt, reason: 'bounty:refund', counterparty: target });
    } else {
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'death:bounty', counterparty: target }); // burn the dead man's stake
    }
    refunded += amt;
  }
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1 AND kind=$2', [target, kind]);
  await client.query('DELETE FROM bounties WHERE target_character=$1 AND kind=$2', [target, kind]);
  return { refunded, selfRefund };
}

// Worker sweep: refund every funder of an expired pot, then drop the pot. ONE POT PER TRANSACTION,
// funder character rows locked in sorted order BEFORE the pot row — the global lock order every
// player path follows (characters → pots → gangs). The old version locked all expired pots first
// and then wrote funder character rows (pots → characters), AB-BA deadlocking against a fire-kill
// or cancel that holds character locks and wants the same pot (invisible on pg-mem). If the funder
// set changes between the unlocked read and the pot lock (a racing top-up), retry once; a pot that
// won't settle keeps to the next sweep. Idempotent-safe: a pot is deleted in the txn it's refunded.
export async function sweepExpiredBounties(pool) {
  const client = await pool.connect();
  let pots = 0, refunded = 0;
  try {
    const expired = (await client.query(
      'SELECT target_character, kind FROM bounties WHERE expires_at IS NOT NULL AND expires_at <= now()')).rows;
    for (const b of expired) {
      for (let attempt = 0; attempt < 2; attempt++) {
        await client.query('BEGIN');
        try {
          // NOT funder_gang — the column is NOT NULL, so the old `IS NULL` matched nothing and
          // silently pre-locked zero funders (audit: the pots→characters inversion was still live)
          const readFunders = async () => (await client.query(
            'SELECT contributor FROM bounty_contributors WHERE target_character=$1 AND kind=$2 AND NOT funder_gang',
            [b.target_character, b.kind])).rows.map((r) => r.contributor).sort();
          const funderIds = await readFunders();
          for (const id of funderIds)
            await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [id]);
          // now the pot — and re-verify it's still there and still expired (a claim/cancel may
          // have raced us before we held any locks; then there's nothing left to refund)
          const pot = (await client.query(
            'SELECT 1 FROM bounties WHERE target_character=$1 AND kind=$2 AND expires_at IS NOT NULL AND expires_at <= now() FOR UPDATE',
            [b.target_character, b.kind])).rows[0];
          if (!pot) { await client.query('COMMIT'); break; }
          const now2 = await readFunders();
          if (JSON.stringify(now2) !== JSON.stringify(funderIds)) { await client.query('ROLLBACK'); continue; }
          refunded += (await refundPot(client, b.target_character, b.kind)).refunded;
          pots++;
          await client.query('COMMIT');
          break;
        // isolate per pot (audit L2): one genuinely-erroring expired pot must not abort the whole
        // batch and leave every OTHER expired pot unrefunded (a poison pot would block them forever)
        } catch (e) { await client.query('ROLLBACK'); console.error('bounty sweep: pot failed', b.target_character, b.kind, e?.code || e); break; }
      }
    }
    return { pots, refunded };
  } finally { client.release(); }
}

// ═══════════════════ THE ASSASSIN'S REPUTATION (M7 Phase 2) ═══════════════════
// A confirmed gameplay kill grows the killer's LEGEND (account-level lifetime kills + feared-rep,
// surviving death like prestige) and this STREET's season kill streak. Rep is a STATUS axis only
// (no gameplay power → no §10.4 / balance impact). Anti-abuse — a kill only COUNTS (kills,
// season_kills, AND rep) when the target is a real one (≥ MIN level): killing rookies/alts earns
// nothing on any board. Rep additionally: diminished 1/(prior REP-earning kills of that bloodline)
// to blunt bloodline farming, excluded for agents (they still tally kills, just not the feared
// board — like referral payouts), and ×HITMAN_DIRECTED_BONUS on a directed hit.
async function awardHitmanRep(client, h, ch, victim, vicLvl, directed, vendetta = false) {
  const qualifies = vicLvl >= M3.HITMAN_MIN_TARGET_LVL; // a real target, not rookie/alt farming
  let repGain = 0;
  if (qualifies) {
    h.acct.kills = Number(h.acct.kills || 0) + 1;
    ch.season_kills = Number(ch.season_kills || 0) + 1;
    if (!h.acct.agent_flag) {
      const prior = Number((await client.query(
        'SELECT COUNT(*) n FROM kill_log WHERE killer_account=$1 AND victim_account=$2 AND rep > 0', [ch.account_id, victim.account_id])).rows[0].n);
      // a settled VENDETTA pays 2x, a directed contract 1.5x — the LARGER applies, never a stack.
      // The bloodline diminishing below still divides it, which is the vendetta anti-farm: a
      // first revenge (1 prior against you) nets exactly full base rep; kill-trading decays.
      const mult = Math.max(directed ? M3.HITMAN_DIRECTED_BONUS : 1, vendetta ? VENDETTA.REP_BONUS : 1);
      repGain = Math.max(1, Math.floor(vicLvl * M3.HITMAN_REP_PER_LVL * mult / (prior + 1)));
      const before = Number(h.acct.hitman_rep || 0);
      h.acct.hitman_rep = before + repGain;
      if (hitmanRankOf(before + repGain).title !== hitmanRankOf(before).title)
        await h.notify(client, ch.id, 'hitman_rank', { title: hitmanRankOf(before + repGain).title, rep: before + repGain });
    }
  }
  // every kill is logged for the feed; rep>0 marks the ones that count for bloodline diminishing
  await client.query('INSERT INTO kill_log (id, killer_account, victim_account, victim_name, rep) VALUES ($1,$2,$3,$4,$5)',
    [uid(), ch.account_id, victim.account_id, victim.name, repGain]);
  return { repGain, qualified: qualifies, kills: Number(h.acct.kills || 0), title: hitmanRankOf(h.acct.hitman_rep).title };
}

// The feared-assassin leaderboard: the lifetime LEGEND (accounts by hitman_rep, with rank/title)
// and the SEASON board (living streets by this season's kill streak).
export async function hitmanLeaderboard(pool, limit = 20) {
  const legend = (await pool.query(
    `SELECT a.hitman_rep, a.kills, a.agent_flag, c.name FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
      WHERE a.hitman_rep > 0 ORDER BY a.hitman_rep DESC LIMIT $1`, [limit])).rows;
  const season = (await pool.query(
    `SELECT c.name, c.season_kills, a.agent_flag FROM characters c
       JOIN account_persistent a ON a.account_id = c.account_id
      WHERE c.alive AND c.season_kills > 0 AND NOT a.agent_flag
      ORDER BY c.season_kills DESC LIMIT $1`, [limit])).rows;
  return {
    legend: legend.map((r) => ({ name: r.name, rep: Number(r.hitman_rep), kills: Number(r.kills),
      title: hitmanRankOf(Number(r.hitman_rep)).title, agent: !!r.agent_flag })),
    season: season.map((r) => ({ name: r.name, kills: Number(r.season_kills), agent: !!r.agent_flag })),
  };
}

// ═══════════════════ HIT CONTRACTS (§7.7) ═══════════════════
export async function startSearch(ch, targetCharacterId, client, h) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'You know where you are.');
  const t = (await client.query('SELECT id, name, wanted_until FROM characters WHERE id=$1 AND alive', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  if (tg?.gang_id && tg.gang_id === h.owned.gangId && !isWanted(t)) throw new GameError('family', "They're family. Omertà."); // a WANTED welsher is fair game even to family
  const cur = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (cur) throw new GameError('searching', 'Your people are already out looking. Call them off first.');
  await client.query('INSERT INTO searches (hunter, target) VALUES ($1,$2)', [ch.id, targetCharacterId]);
  // EXECUTIONER (skills) × VINNIE T3 (underworld): the assassin's people work faster —
  // applied here AND at fire's readiness check via hunterSearchMs (both read the HUNTER's
  // build+standing, so the two clocks agree). Stacking flagged; both sign-off levers.
  return { ok: true, placedAt: new Date(Date.now() + hunterSearchMs(h)) };
}

// §9 production timers: search 3 h, failed-shot cooldown 2 h.
// Tests may shrink them via env — never set these in production configs.
const searchMs = () => Number(process.env.SEARCH_MS || (3 * 3600 * 1000));
const hunterSearchMs = (h) => Math.floor(searchMs()
  * skillMult(h, 'executioner', SKILLS.FX.SEARCH_MULT)
  * npcMult(h, 'fixer', 3, UNDERWORLD.FX.SEARCH_MULT));
const shootCdMs = () => Number(process.env.SHOOT_CD_MS || (2 * 3600 * 1000));

export async function callOffSearch(ch, client) {
  await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);
  return { ok: true };
}

export async function fire(ch, victim, client, h, rounds) {
  const s = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (!s || s.target !== victim.id) throw new GameError('no_search', 'Your people have no fix on them. Start a search.');
  // same clock as startSearch (executioner × fixer T3) — the hunter's two clocks agree
  if (new Date(s.started_at).getTime() + hunterSearchMs(h) > Date.now())
    throw new GameError('searching', "They haven't been placed yet. Patience is a caliber.");
  if (jailed(ch)) throw new GameError('jailed', 'No wet work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "No wet work while you're to ground — hiding, not hunting.");
  if (ch.shoot_cd_until && new Date(ch.shoot_cd_until) > new Date())
    throw new GameError('cooldown', "Your trigger's still hot.");
  const gun = gunObjOf(ch.gun);
  if (!gun) throw new GameError('gun', 'You need iron equipped for this kind of work.');
  if (Number(ch.energy) < M3.FIRE_ENERGY) throw new GameError('energy', `A hit takes ${M3.FIRE_ENERGY} energy.`);
  const fired = Math.max(50, Math.floor(Number(rounds) || 0)); // §7.7 rounds ≥ 50
  if ((Number(ch.ammo) || 0) < fired) throw new GameError('ammo', `Calling for ${fired} rounds with ${ch.ammo} on hand.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (safeHoused(victim)) throw new GameError('safe', "They've gone to ground — your people can't place them.");
  // THE LAW Phase 4: a rat in witness protection is beyond reach — the marshals have them.
  if (witproActive(victim)) throw new GameError('witpro', "The marshals have them. That one's untouchable for now.");
  // THE PEN's shields — parity with npcHit/huntWanted (AUDIT-full-system-v2 C-HIGH-1). A jailed man
  // is unreachable on the STREET; the shank (which requires the killer be jailed too) is the in-cell
  // path. Without these, jail is strictly MORE lethal than freedom — a jailed player can't safehouse.
  if (penSafe(victim)) throw new GameError('protected', "They're covered inside — you can't get to them in the yard.");
  if (inHole(victim)) throw new GameError('segregated', "They're in the hole — nobody reaches them there.");
  if (jailed(victim)) throw new GameError('jailed', "They're in lockup — no reaching them on the street. Shank them inside.");
  // family omertà — VOID for a rat (an informant has forfeited the family's protection; audit:
  // the rat badge must actually make them fair game, or a rat hiding in a strong family defeats
  // the contract-magnet the waiver promises).
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId && !h.victimAcct.rat && !isWanted(victim)) {
    await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);
    throw new GameError('family', "They've been made family since you took the contract. It's off.");
  }
  if (victim.loc !== ch.loc) throw new GameError('district', `They were placed in ${victim.loc} — you're in ${ch.loc}. Travel there, then fire.`);

  ch.energy = Number(ch.energy) - M3.FIRE_ENERGY;
  ch.ammo = Number(ch.ammo) - fired;
  ch.heat = Number(ch.heat || 0) + M3.FIRE_HEAT; // §7 interlock: wet work draws law heat, like a deal
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -fired, reason: 'fire' });

  const vicLvl = levelOf(Number(victim.respect));
  const btk = btkOf(vicLvl, victim.muscle, vestMultOf(victim.vest));
  const jamRoll = Math.random();
  const jammed = jamRoll > (gun.rel || 0.9);
  const effective = Math.floor(fired * (0.7 + (gun.fp || 0) / 50) * (jammed ? 0.75 : 1) * (ch.path === 'gun' ? 1.15 : 1));
  await h.rngLog(client, ch.id, `fire:${victim.id}`, jamRoll, effective >= btk ? `kill (eff ${effective} vs btk ${btk})` : `miss (eff ${effective} vs btk ${btk})`);
  await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);

  if (effective >= btk) {
    // ── THE BODYGUARD (M7 Phase 4) — the earnable shield burns BEFORE real-ETH insurance ──
    const guard = await bodyguardAbsorbs(client, h, ch, victim);
    if (guard) {
      await h.notify(client, ch.id, 'target_guarded', { victim: victim.name, guard: guard.name });
      return { ok: true, kill: false, absorbed: true, guard: guard.name, jammed };
    }
    // ── PRE-PAID REVIVE INSURANCE (§11) ──
    // A killing blow lands, but the target bought a respawn on-chain (0.10 ETH → dev wallet).
    // It's spent to pull them from the brink: full heal, keeps EVERYTHING, and the shooter's
    // blow lands on nothing — no rep, no chop, no bounty, no estate. Nothing here touches the
    // §10.4 ledger (no in-game value moves); the real ETH already left to the dev wallet.
    // Mod-kills call runEstate directly and bypass this — insurance stops players, not mods.
    if (Number(h.victimAcct.respawn_tokens || 0) > 0) {
      h.victimAcct.respawn_tokens = Number(h.victimAcct.respawn_tokens) - 1;
      victim.health = 100;
      // the shooter's own search was already spent above (line ~360). Do NOT wipe OTHER hunters'
      // searches — a target could otherwise bait the weakest hunter, burn one cheap token, and
      // reset the entire manhunt (each search is a 3h investment). The mark stays hunted.
      await h.notify(client, victim.id, 'revived', { from: ch.name });
      await h.notify(client, ch.id, 'target_revived', { victim: victim.name });
      await h.track(client, victim.account_id, 'respawn', { from: ch.id });
      bus.emit('streets', { type: 'revive', who: victim.name });
      return { ok: true, kill: false, revived: true, jammed };
    }
    // ── THE KILL ──
    const rep = Math.max(10, vicLvl * 2);
    // AUDIT R5 — the chop comes from the victim's ACTUAL cars rows; value transfers
    const chop = Math.floor(fleetValue(h.victimOwned.cars) * M3.CHOP_RATE);
    ch.respect = Number(ch.respect) + rep;
    if (chop > 0) {
      ch.cash = Number(ch.cash) + chop;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: chop, reason: 'whack:chop', counterparty: victim.id });
    }
    // ── LOOT THE LIVING (Risk-to-Earn P1.1) — the killer takes a cut of the victim's CARRIED value,
    // so wealth on the street is worth killing for and staking $OMR is the safe harbour. Pocket cash
    // and liquid (unstaked) $OMR only — bank cash and staked $OMR are out of a street hit's reach.
    // Both are TRANSFERS (whack:loot): the looted cash is carved out of what runEstate would burn
    // (reduce victim.cash first → its death:estate burn shrinks by exactly the loot), the looted $OMR
    // moves account→account (the heir keeps the rest). Only a PLAYER fire-kill reaches here — NPC/mod
    // kills call runEstate directly and don't loot, so skill + risk is what earns.
    // Make-Risk-Pay: the loot base is pocket PLUS the victim's IN-TRANSIT bank deposits (fresh
    // deposits within BANK_CLEAR_MS — the courier was hit on the way to the vault). Cleared bank
    // stays out of reach. One ledger pair covers both legs (the character-cash check spans
    // cash+bank, so a single whack:loot row per side stays exact).
    const inTransit = Math.min(Math.floor(Number(victim.bank_intransit || 0)), Math.floor(Number(victim.bank)));
    const pocketLoot = Math.floor(Number(victim.cash) * M3.CASH_LOOT_RATE);
    const transitLoot = Math.floor(inTransit * M3.CASH_LOOT_RATE);
    const loot = pocketLoot + transitLoot;
    if (loot > 0) {
      victim.cash = Number(victim.cash) - pocketLoot;      // the estate now burns only the remainder
      victim.bank = Number(victim.bank) - transitLoot;
      victim.bank_intransit = 0;
      ch.cash = Number(ch.cash) + loot;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: loot, reason: 'whack:loot', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -loot, reason: 'whack:loot', counterparty: ch.id });
    }
    // …and liquid $OMR PLUS unbonding principal (the unstake exposure window). Staked stays the
    // untouchable safe harbour; extraction is what crosses the street.
    const liquid = Number(h.victimAcct.omr), unbonding = Number(h.victimAcct.unbonding || 0);
    const omrLoot = Math.floor((liquid + unbonding) * M3.OMR_LOOT_RATE);
    if (omrLoot > 0) {
      const fromLiquid = Math.min(omrLoot, liquid);
      h.victimAcct.omr = liquid - fromLiquid;
      h.victimAcct.unbonding = unbonding - (omrLoot - fromLiquid);
      h.acct.omr = Number(h.acct.omr) + omrLoot;
      await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: omrLoot, reason: 'whack:loot', counterparty: victim.id });
      await h.ledger(client, { accountId: victim.account_id, currency: 'omr', amount: -omrLoot, reason: 'whack:loot', counterparty: ch.id });
    }
    // GEAR LOOT (Phase 3 remainder): a chance to strip ONE piece of the victim's IN-GAME gear —
    // on-chain-minted gear is safe (it's been extracted). Gear isn't a §10.4 currency, so this is
    // a pure ownership move (count conserved by the DELETE+INSERT). Skip a type the killer already
    // owns (account_gear is type-keyed, PK (account,gear) — can't stack a duplicate).
    let gearLoot = null;
    const gearRoll = Math.random();
    // env-overridable for tests (the SEARCH_MS pattern); production reads the M3 default
    if (gearRoll < Number(process.env.GEAR_LOOT_CHANCE ?? M3.GEAR_LOOT_CHANCE)) {
      const vg = (await client.query('SELECT gear_id FROM account_gear WHERE account_id=$1 AND NOT minted_onchain', [victim.account_id])).rows.map((x) => x.gear_id);
      const killerHas = new Set(h.owned.gear || []);
      const takeable = vg.filter((g) => !killerHas.has(g));
      if (takeable.length) {
        gearLoot = takeable[Math.floor(Math.random() * takeable.length)];
        await client.query('DELETE FROM account_gear WHERE account_id=$1 AND gear_id=$2', [victim.account_id, gearLoot]);
        await client.query('INSERT INTO account_gear (account_id, gear_id) VALUES ($1,$2)', [h.accountId, gearLoot]);
        h.victimOwned.gear = (h.victimOwned.gear || []).filter((g) => g !== gearLoot); // keep the estate report honest
        h.owned.gear = [...(h.owned.gear || []), gearLoot];                             // and the killer's effStat view
      }
    }
    // ground rule #3: log EVERY roll (pass or fail), not just the ones that strip gear
    await h.rngLog(client, ch.id, `gearloot:${victim.id}`, gearRoll, gearLoot ? `looted ${gearLoot}` : 'none');
    // PORT step five — WAREHOUSED CONTRABAND LOOT (the P1.1 loot-surface twin): a marked man risks the
    // stash he warehoused to fence later. A pure ownership move — contraband is a cash-book-value commodity,
    // NOT a §10.4 currency (the gear-loot precedent, no ledger row), bounded by what was legitimately
    // sourced under the supply cap. Absolute reads (NUMERIC, arith-safe); the remainder dies with the street.
    let contraLoot = 0;
    const vContra = Math.floor(Number(victim.contraband) || 0);
    if (vContra > 0) {
      contraLoot = Math.floor(vContra * PORT.STEP5.CONTRA_LOOT_RATE);
      if (contraLoot > 0) {
        await client.query('UPDATE characters SET contraband = contraband - $2 WHERE id=$1', [victim.id, contraLoot]);
        await client.query('UPDATE characters SET contraband = contraband + $2 WHERE id=$1', [ch.id, contraLoot]);
      }
    }
    const { total: bounty, directed } = await claimBounty(client, h, ch, victim.id, ['hospitalize', 'kill']); // a kill fulfils both
    // VENDETTA SETTLEMENT — if this kill answers a blood debt (my bloodline sworn against
    // theirs, inside the window), the vendetta is settled: the row closes, the street hears,
    // and the rep multiplier below pays vengeance rates.
    const vend = (await client.query(
      'SELECT sworn FROM vendettas WHERE avenger_account=$1 AND target_account=$2 AND expires_at > now()',
      [ch.account_id, victim.account_id])).rows[0];
    if (vend) {
      await client.query('DELETE FROM vendettas WHERE avenger_account=$1 AND target_account=$2', [ch.account_id, victim.account_id]);
      await h.notify(client, ch.id, 'vendetta_settled', { for: vend.sworn, killed: victim.name });
      bus.emit('streets', { type: 'vendetta_settled', by: ch.name, on: victim.name, for: vend.sworn });
    }
    // the assassin's legend grows (kills + feared-rep + season streak); directed hits pay a
    // bonus, a settled vendetta a bigger one
    const hit = await awardHitmanRep(client, h, ch, victim, vicLvl, directed, !!vend);
    await bumpStanding(client, h, ch, 'fixer', 5, { action: 'kill' }); // Vinnie hears about confirmed work
    // RIVALRY (step two): the Doc took an oath — blood work costs his goodwill
    await bumpStanding(client, h, ch, 'doc', -UNDERWORLD.STEP2.RIVAL_LOSS);
    // GRUDGES (step three): the names remember who you whack — every fixture the victim was a
    // real friend of (standing ≥ GRUDGE_MIN) docks the KILLER. Read from the victim's loaded
    // (effective) standings before runEstate wipes them; the loss echoes down the killer's
    // bloodline like any standing (step-two memory). Pure status — no money moves.
    const grudges = await bearGrudges(client, h, ch, h.victimOwned.npc);
    // war interlock: a kill on a family you're at war with scores war points (worth more than a
    // jump's 1) — the lethal layer finally decides wars, not just jump-spam. Done BEFORE the
    // estate vacates the victim's gang seat, while h.victimOwned.gangId is still known.
    let warKill = false;
    if (h.owned.gangId && h.victimOwned.gangId) {
      const myGang = (await client.query('SELECT * FROM gangs WHERE id=$1', [h.owned.gangId])).rows[0];
      if (warActive(myGang) && myGang.war_with === h.victimOwned.gangId) {
        // both score updates in ONE statement — two separate "my gang first" UPDATEs acquire the
        // rows unsorted, so a simultaneous cross-kill between the two families AB-BA deadlocks.
        await client.query(
          `UPDATE gangs SET war_score_us = war_score_us + CASE WHEN id=$1 THEN $3 ELSE 0 END,
                            war_score_them = war_score_them + CASE WHEN id=$2 THEN $3 ELSE 0 END
            WHERE id IN ($1,$2)`, [h.owned.gangId, h.victimOwned.gangId, M3.WAR_KILL_POINTS]);
        warKill = true;
      }
    }
    await h.notify(client, victim.id, 'whacked', { from: ch.name });
    // witnesses: 3 random living characters saw something (§7.7)
    const wits = (await client.query('SELECT id FROM characters WHERE alive AND id<>$1 AND id<>$2 LIMIT 20', [ch.id, victim.id])).rows;
    for (const w of wits.sort(() => Math.random() - 0.5).slice(0, 3))
      await h.notify(client, w.id, 'witness', { killer: ch.name, victim: victim.name });
    await h.track(client, ch.account_id, 'kill', { rounds: fired, btk, victim: victim.id, rep: hit.repGain, directed });
    const estate = await runEstate(client, h, victim, ch.name, { killerCh: ch, vendetta: true, loot: true });
    bus.emit('streets', { type: 'kill', by: ch.name, victim: victim.name });
    return { ok: true, kill: true, rep, chop, loot, omrLoot, gearLoot, contraLoot, orderLoot: estate.orderLoot || 0, bounty, jammed, warKill, hitman: hit,
      vendetta: !!vend, ...(grudges.length ? { grudges } : {}), estate: { heirId: estate.heirId } };
  }
  // ── THE MISS ──
  ch.shoot_cd_until = new Date(Date.now() + shootCdMs());
  const dmg = rand(5, 15);
  victim.health = Math.max(1, Number(victim.health) - dmg);
  await h.notify(client, victim.id, 'attempt', { from: ch.name, dmg });
  return { ok: true, kill: false, jammed, effective, btk };
}

// ═══════════════════ SAFEHOUSE — EARNABLE DEFENSE (M7 Phase 4) ═══════════════════
// Pay cash to go to ground: for a window you can't be `fire`d on or NPC-hit — the in-game
// survival shield, so real-ETH revive insurance isn't the only way to weather a contract on
// your head. Jumps (non-lethal) still land. `safehouse` is a §10.4 cash sink.
export async function enterSafehouse(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No safehouse reaches into lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "You're already off the grid.");
  // Make-Risk-Pay: total immunity is priced as a share of the LIQUID WEALTH it protects —
  // max(flat floor, cash+bank × SAFEHOUSE_NW_BPS). The flat $25k was ~0.25%/day for an endgame
  // landlord (the audit's safehoused-landlord stack); a % keeps the shield real for street
  // players and expensive for whales. Paid from pocket — going to ground takes walking money.
  const cost = Math.max(M3.SAFEHOUSE_COST,
    Math.floor((Number(ch.cash) + Number(ch.bank)) * CONSTANTS.SAFEHOUSE_NW_BPS / 10000));
  if (Number(ch.cash) < cost) throw new GameError('cash', `A safehouse runs $${cost} for a man of your means (1% of liquid wealth, $${M3.SAFEHOUSE_COST} minimum) — in pocket cash.`);
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'safehouse' });
  // Commission decree: OPEN SEASON halves every stay — the knives are out this week
  const decree = await activeDecree(client);
  const ms = Math.floor(M3.SAFEHOUSE_MS * (decree?.id === 'open_season' ? COMMISSION.OPEN_SEASON_MULT : 1));
  ch.safe_until = new Date(Date.now() + ms);
  await h.track(client, ch.account_id, 'safehouse', { cost });
  return { ok: true, safeUntil: ch.safe_until, cost, ...(decree?.id === 'open_season' ? { openSeason: true } : {}) };
}

// ═══════════════════ BODYGUARDS — TWO-PARTY PROTECTION (M7 Phase 4) ═══════════════════
// The player-to-player defense market: a guard LISTS a price (consent-by-listing), a principal
// HIRES them for a window. While guarded, ONE lethal blow (fire or NPC hit) is absorbed — the
// guard takes the bullet (hospitalized in the principal's place) and the contract is consumed.
// The hire is a pure ledgered transfer ('bodyguard:hire' ±price) — no escrow, no §10.4 bucket:
// the guard is paid up front for the risk, saved or not. Checked BEFORE real-ETH revive
// insurance: the earnable shield burns first, the paid one stays in your pocket.

// Opt in (or out) of the protection racket: price <= 0 clears the listing.
export async function offerBodyguard(ch, price, client, h) {
  const p = Math.floor(Number(price) || 0);
  if (p <= 0) { ch.guard_price = null; return { ok: true, offering: false }; }
  if (!Number.isFinite(p)) throw new GameError('price', 'Name a real number.'); // Infinity/NaN → NUMERIC write 500
  if (p < M3.BODYGUARD_MIN_PRICE) throw new GameError('min', `Nobody stands in front of a bullet for less than $${M3.BODYGUARD_MIN_PRICE}.`);
  ch.guard_price = p;
  return { ok: true, offering: true, price: p };
}

// Two-party (withTwoCharacters): `guard` arrives locked as the second row.
export async function hireBodyguard(ch, guard, client, h) {
  const price = guard.guard_price != null ? Math.floor(Number(guard.guard_price)) : 0;
  if (!(price > 0)) throw new GameError('not_offering', "They're not in the protection business.");
  if (ch.guarded_by && ch.guarded_until && new Date(ch.guarded_until) > new Date())
    throw new GameError('guarded', 'You already have a shadow. One bullet-catcher at a time.');
  if (jailed(guard) || hospitalized(guard)) throw new GameError('unavailable', "They can't watch your back from where they are.");
  if (Number(ch.cash) < price) throw new GameError('cash', `Their rate is $${price}.`);
  // the standard 2% house take (1% dev off-ledger + 1% street tax → buyback), at parity with the
  // exchange and the AMM — an untaxed unlimited P2P transfer was the cheapest value pipe in the
  // game (alt consolidation / referral net-worth pumping at 0%, audit F5). The guard nets 98%.
  const fee = Math.ceil(price * 0.01), tax = Math.ceil(price * 0.01);
  const net = price - fee - tax;
  ch.cash = Number(ch.cash) - price;
  guard.cash = Number(guard.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'bodyguard:hire', counterparty: guard.id });
  await h.ledger(client, { characterId: guard.id, currency: 'cash', amount: net, reason: 'bodyguard:hire', counterparty: ch.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
  ch.guarded_by = guard.id;
  ch.guarded_until = new Date(Date.now() + M3.BODYGUARD_MS);
  await h.notify(client, guard.id, 'bodyguard_hired', { by: ch.name, price, hours: M3.BODYGUARD_MS / 3600000 });
  await h.track(client, ch.account_id, 'bodyguard_hire', { guard: guard.id, price });
  return { ok: true, guard: guard.id, price, until: ch.guarded_until };
}

// The absorb: called at the top of every lethal kill branch. Returns the guard ({name}) if the
// bullet was taken, else null. The guard is a THIRD character — a plain relative UPDATE (the
// same discipline as refundPot's funder credits: no in-memory copy exists, so nothing clobbers).
// No ledger rows — health and hospital time aren't currency; §10.4 is untouched.
// `attacker` is the shooter (fire) or the paying client (npcHit): if the victim's own guard is
// behind the attempt, they simply step aside — the bodyguard turning on you is the oldest move
// in the book, and it means the contract was never protection at all.
async function bodyguardAbsorbs(client, h, attacker, victim) {
  if (!victim.guarded_by || !victim.guarded_until || new Date(victim.guarded_until) <= new Date()) return null;
  if (victim.guarded_by === attacker.id) return null; // the betrayal
  const g = (await client.query('SELECT id, name, jail_until, hosp_until FROM characters WHERE id=$1 AND alive', [victim.guarded_by])).rows[0];
  if (!g || jailed(g) || hospitalized(g)) return null; // nobody between you and the bullet right now
  victim.guarded_by = null; victim.guarded_until = null; // one bullet per contract
  await client.query('UPDATE characters SET health=$2, hosp_until=$3 WHERE id=$1',
    [g.id, 10, new Date(Date.now() + M3.BODYGUARD_HOSP_MS)]);
  await h.notify(client, g.id, 'took_bullet', { for: victim.name });
  await h.notify(client, victim.id, 'guard_saved_you', { guard: g.name });
  await h.track(client, victim.account_id, 'bodyguard_absorb', { guard: g.id });
  bus.emit('streets', { type: 'bodyguard', guard: g.name, saved: victim.name });
  return { name: g.name };
}

// ═══════════════════ NPC HITMEN FOR HIRE (M7 Phase 3) ═══════════════════
// Pay cash to a contractor for a ROLLED attempt on a target — the mechanic that lets a weak
// player buy a CHANCE at a strong one, and a ledgered wealth SINK. The fee burns win or lose
// (`npchit:hire`), the payer takes law heat + a cooldown, and it pays ZERO rep (no player
// killer). On a landed hit the estate runs (no chop/bounty — nobody fulfilled a contract);
// pre-paid revive insurance absorbs it exactly like a player hit.
export async function npcHit(ch, victim, client, h, tierId, opts = {}) {
  const tier = npcHitmanOf(tierId);
  if (!tier) throw new GameError('bad_tier', 'No such contractor for hire.');
  // THE PEN step two: a burner phone (opts.fromBurner) is the ONE way to arrange wet work from a
  // cell — pen.js consumes the burner first, then calls in with the jail gate waived.
  if (!opts.fromBurner && jailed(ch)) throw new GameError('jailed', 'No arranging wet work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't reach your contacts from a safehouse.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId && !h.victimAcct.rat && !isWanted(victim)) throw new GameError('family', "They're family. Omertà."); // a rat OR a WANTED welsher forfeits family protection
  const vicLvl = levelOf(Number(victim.respect));
  if (vicLvl < M3.NPC_MIN_TARGET_LVL) throw new GameError('newbie', "The Commission doesn't sanction hits on nobodies.");
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (safeHoused(victim)) throw new GameError('safe', "The contractor can't find them — they've gone to ground.");
  // THE PEN (audit): a contractor can't reach a jailed target under the yard boss's protection or in
  // the hole any more than a shank can — the burner route (and a street hire) honours the Pen's
  // own in-jail defenses, parity with the street safeHoused/witpro gates above.
  if (penSafe(victim)) throw new GameError('protected', "They're covered inside — no contractor gets to them.");
  if (inHole(victim)) throw new GameError('segregated', "They're in the hole — nobody reaches them there.");
  if (witproActive(victim)) throw new GameError('witpro', "The marshals have them locked away — no contractor gets near.");
  // a bare jailed inmate is street-unreachable too (parity with fire/huntWanted; AUDIT-full-system-v2
  // C-MED-1) — a contractor can't walk into a cell; the shank is the in-jail path.
  if (jailed(victim)) throw new GameError('jailed', "They're in lockup — no contractor reaches them on the street.");
  if (ch.npchit_at && new Date(ch.npchit_at) > new Date()) throw new GameError('cooldown', 'Your contact needs time between jobs.');
  // BALANCE D4 — per-TARGET cooldown: a whale could repeat-reset ONE rival every 6h by cycling
  // the payer cooldown; now each (payer, target) pair rests NPC_HIT_TARGET_CD_MS between attempts
  // (stamped win or lose — the griefing is the attempt cadence, not the kill).
  const pair = (await client.query('SELECT last_at FROM npc_hits WHERE payer=$1 AND target=$2', [ch.id, victim.id])).rows[0];
  if (pair && Date.now() - new Date(pair.last_at).getTime() < M3.NPC_HIT_TARGET_CD_MS)
    throw new GameError('target_cd', 'The contractors already went at them for you — pick another mark or wait a day.');
  // VINNIE T1 (underworld): the Match brokers contractor work at a friend's rate — the
  // discounted fee is what's ledgered (decree/skill precedent). Sign-off lever.
  const cost = Math.floor(tier.cost * npcMult(h, 'fixer', 1, UNDERWORLD.FX.NPCHIT_MULT));
  if (Number(ch.cash) < cost) throw new GameError('cash', `${tier.name} charges $${cost}.`);

  // pay the contractor — cash BURNED (a §10.4 sink), win or lose — then heat + cooldown
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'npchit:hire', counterparty: victim.id });
  await bumpStanding(client, h, ch, 'fixer', 4, { action: 'hire' }); // arranged work is business with the Match
  // RIVALRY (step two): the Doc hears who sent the man with the bag
  await bumpStanding(client, h, ch, 'doc', -UNDERWORLD.STEP2.RIVAL_LOSS);
  ch.heat = Number(ch.heat || 0) + M3.NPC_HIT_HEAT;
  ch.npchit_at = new Date(Date.now() + M3.NPC_HIT_CD_MS);
  if (pair) await client.query('UPDATE npc_hits SET last_at=now() WHERE payer=$1 AND target=$2', [ch.id, victim.id]);
  else await client.query('INSERT INTO npc_hits (payer, target) VALUES ($1,$2)', [ch.id, victim.id]);

  const success = Math.min(M3.NPC_MAX_SUCCESS, Math.max(M3.NPC_MIN_SUCCESS, tier.base - vicLvl * M3.NPC_DEF_PER_LVL));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `npchit:${victim.id}`, roll, roll < success ? `hit (p=${success.toFixed(2)})` : `miss (p=${success.toFixed(2)})`);
  await h.track(client, ch.account_id, 'npchit', { tier: tierId, target: victim.id, success: roll < success });
  if (roll >= success) {
    await h.notify(client, victim.id, 'npchit_survived', {}); // "you feel someone wants you dead" — nudge to insure
    return { ok: true, hit: false, success, cost };
  }
  // ── the contractor lands the kill ──
  // the bodyguard steps in first (earnable shield before real-ETH insurance). The PAYER is the
  // attacker for the betrayal check: a guard who hires out the job on their own principal has
  // already stepped aside.
  const guard = await bodyguardAbsorbs(client, h, ch, victim);
  if (guard) return { ok: true, hit: true, absorbed: true, guard: guard.name, success, cost };
  if (Number(h.victimAcct.respawn_tokens || 0) > 0) { // pre-paid insurance absorbs it (like a player hit)
    h.victimAcct.respawn_tokens = Number(h.victimAcct.respawn_tokens) - 1;
    victim.health = 100;
    await h.notify(client, victim.id, 'revived', { from: 'a hired gun' });
    return { ok: true, hit: true, revived: true, success, cost };
  }
  // GRUDGES (step three): the fixtures know who sent the man with the bag — the PAYER wears
  // the loss for every friend of the house the contractor drops (read before the estate wipe).
  const grudges = await bearGrudges(client, h, ch, h.victimOwned.npc);
  // pass the PAYER as killerCh so that if THEY funded a still-exclusive directed pot on this
  // victim, refundPot's refund lands on their in-memory cash (else persistCharacter clobbers the
  // SQL credit → §10.4 drift + the payer loses their escrow). killerCh drives no chop/rep here.
  const estate = await runEstate(client, h, victim, 'A HIRED GUN', { killerCh: ch });
  await h.notify(client, victim.id, 'whacked', { from: 'a hired gun' });
  bus.emit('streets', { type: 'kill', by: 'a hired gun', victim: victim.name });
  return { ok: true, hit: true, killed: true, success, cost, ...(grudges.length ? { grudges } : {}),
    estate: { heirId: estate.heirId } };
}

// LOAN step 4 — the worker's NPC bounty-hunter sweep. Each WANTED defaulter is rolled WANTED_HUNT_P
// per tick; a landed hit runs the estate with NO killer (no chop/loot/rep — the mod-kill/npcHit
// precedent; the wanted pool bounty burns as death:bounty). A safehouse / witpro / pen shield / a
// hospital bed / lockup blocks the hunter this tick; a bodyguard or a pre-paid revive token absorbs
// the blow (the shields the mark paid for still hold — hide or square your name). Headless (its own
// per-victim txn), so third-party rows are persisted by raw SQL, never an in-memory clobber.
export async function huntWanted(pool) {
  const p = Number(process.env.WANTED_HUNT_P ?? LOAN.WANTED_HUNT_P);
  const marks = (await pool.query("SELECT id FROM characters WHERE alive AND wanted_until > now()")).rows;
  let killed = 0, absorbed = 0, revived = 0;
  for (const m of marks) {
    if (Math.random() >= p) continue; // no hunter came for them this tick
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const victim = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [m.id])).rows[0];
      if (!victim || !isWanted(victim)) { await client.query('ROLLBACK'); continue; } // squared up / lapsed under the lock
      // the hunter can't reach a hidden mark this tick (the npcHit victim gates)
      if (safeHoused(victim) || witproActive(victim) || penSafe(victim) || inHole(victim) || hospitalized(victim) || jailed(victim)) { await client.query('ROLLBACK'); continue; }
      const victimAcct = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [victim.account_id])).rows[0];
      const victimOwned = await loadOwned(client, victim);
      const h = { ledger, notify, track, victimAcct, victimOwned };
      // a bodyguard steps in (no player attacker → id null is never the betrayal); persist the cleared
      // guard on the mark's row directly (headless — no withCharacter to write it back).
      const guard = await bodyguardAbsorbs(client, h, { id: null }, victim);
      if (guard) {
        await client.query('UPDATE characters SET guarded_by=NULL, guarded_until=NULL WHERE id=$1', [victim.id]);
        await client.query('COMMIT'); absorbed++; continue;
      }
      if (Number(victimAcct.respawn_tokens || 0) > 0) { // pre-paid insurance absorbs it
        await client.query('UPDATE account_persistent SET respawn_tokens = respawn_tokens - 1 WHERE account_id=$1', [victim.account_id]);
        await client.query('UPDATE characters SET health=100 WHERE id=$1', [victim.id]);
        await notify(client, victim.id, 'revived', { from: 'a bounty hunter' });
        await client.query('COMMIT'); revived++; continue;
      }
      // the hunter lands it — the estate runs (no killerCh: no chop/loot/rep; the pool bounty burns)
      await runEstate(client, h, victim, 'A BOUNTY HUNTER');
      await client.query('UPDATE account_persistent SET prestige=$2, deaths=$3 WHERE account_id=$1', [victim.account_id, victimAcct.prestige, victimAcct.deaths]);
      bus.emit('streets', { type: 'kill', by: 'a bounty hunter', victim: victim.name });
      await client.query('COMMIT'); killed++;
    } catch (e) { await client.query('ROLLBACK'); console.error('huntWanted', m.id, e.message); }
    finally { client.release(); }
  }
  return { killed, absorbed, revived, marks: marks.length };
}

// Every fixture the victim was a REAL friend of (effective standing ≥ GRUDGE_MIN) docks the
// killer GRUDGE_LOSS — whacking a connected man burns your own bridges. Shared by the player
// kill (fire) and the arranged one (npcHit — the payer wears it); mod-kills have no killer and
// bear no grudge. Step four gives the grudge TEETH: an `npc_grudges` row (count > 0) caps the
// killer's tier with that fixture (game.js npcTier) until squared by penance. Absolute count
// writes (read-then-write) — pg-mem mis-evaluates arithmetic UPDATEs on INT columns.
// Returns the fixture ids that now hold one.
async function bearGrudges(client, h, killerCh, victimNpc) {
  const grudges = [];
  for (const [npcId, s] of Object.entries(victimNpc || {})) {
    // Vinnie the Match brokers wet work — arranged or answered, a kill is business, never a
    // grudge (docs + tests state this; the code now enforces it — audit L3).
    if (npcId === 'fixer') continue;
    if (Number(s) >= UNDERWORLD.STEP3.GRUDGE_MIN) {
      await bumpStanding(client, h, killerCh, npcId, -UNDERWORLD.STEP3.GRUDGE_LOSS);
      // absolute-from-EFFECTIVE (step five: healed grudges materialize here) + a fresh offense
      // restarts the healing clock (since=now)
      const count = Number(h.owned?.grudges?.[npcId] || 0) + 1;
      const upd = await client.query('UPDATE npc_grudges SET count=$3, since=now() WHERE character_id=$1 AND npc_id=$2', [killerCh.id, npcId, count]);
      if (!upd.rowCount) await client.query('INSERT INTO npc_grudges (character_id, npc_id, count) VALUES ($1,$2,$3)', [killerCh.id, npcId, count]);
      if (h.owned?.grudges) h.owned.grudges[npcId] = count; // the cap bites within this very transaction
      grudges.push(npcId);
    }
  }
  return grudges;
}

// ═══════════════════ DEATH — THE ESTATE (§7.9, atomic) ═══════════════════
// The street dies: character row closed, possessions wiped, gang seat vacated,
// bounty cleared. The account survives: $OMR, staked, rewards, wallet, gear,
// prestige (+floor(level/2)), recruits, onboard, checkins, deaths+1. The heir
// row starts at generation+1 with the legacy stake.
export async function runEstate(client, h, victim, killerName, opts = {}) {
  const acct = h.victimAcct;
  const lvl = levelOf(Number(victim.respect));
  const legacy = Math.floor(lvl / 2);
  const priorPrestige = Number(acct.prestige);  // muscle memory reads the bloodline's ACCUMULATED prestige (pre-death) — a fresh line's skills still fully die
  acct.prestige = Number(acct.prestige) + legacy;
  acct.deaths = Number(acct.deaths) + 1;

  // burn the EXACT cash+bank (both NUMERIC — bank interest accrues fractionally), not a floored
  // integer: the row is zeroed below, so flooring the ledger sink destroyed frac(cash+bank) ∈
  // [0,1) unledgered on every death → a slow, permanent §10.4 check-(a) drift (the sub-cent bank
  // interest bug, reintroduced at the estate boundary). Report keeps the whole-dollar figure.
  const exactCash = Number(victim.cash) + Number(victim.bank);
  const lostCash = Math.floor(exactCash);
  const report = {
    by: killerName, legacy,
    kept: { omr: Number(acct.omr), staked: Number(acct.staked), rewards: Number(acct.rewards),
            gear: h.victimOwned.gear.length, prestige: acct.prestige,
            // R1 — the Portfolio is LEGIT money: account-level, never in the wipe below, so the heir
            // keeps the book (the retirement fantasy, made legible at the moment of death). Its value
            // at today's price — a status figure, no §10.4 currency moves.
            portfolio: Math.round(((h.victimOwned.portfolio || []).reduce((a, r) => a + Number(r.shares) * tickerPriceOf(r.ticker), 0)) * 100) / 100,
            // THE ESTATE — account-level (keyed on account_id), never in the wipe: the heir inherits the
            // compound. Report the tier name the bloodline keeps.
            estate: h.victimOwned.estate ? (estateTierOf(Number(h.victimOwned.estate.tier || 0))?.name || null) : null },
    lost: { cash: lostCash, cars: h.victimOwned.cars.length, guns: h.victimOwned.guns.length,
            rackets: h.victimOwned.rackets.length, assets: h.victimOwned.assets.length, lvl },
  };

  // §10.4: the estate burns street value — every currency leaves through a ledgered sink
  if (exactCash > 0) await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -exactCash, reason: 'death:estate' });
  if (Number(victim.cb) > 0) await h.ledger(client, { characterId: victim.id, currency: 'cb', amount: -Number(victim.cb), reason: 'death:estate' });
  if (Number(victim.ammo) > 0) await h.ledger(client, { characterId: victim.id, currency: 'ammo', amount: -Number(victim.ammo), reason: 'death:estate' });

  // BLOODLINE MEMORY (Underworld step two): the heir inherits MEMORY_BPS of each standing
  // ("the Doc remembers your father"), floored, sub-1 remainders forgotten. Read from
  // h.victimOwned.npc — the EFFECTIVE (decay-applied) values, same as every perk site — not
  // the stored rows, which sit stale-high for an idle street until a bump materializes the
  // cooling (audit: a lapsed stored 90 must hand down floor(25×25%), not floor(90×25%)).
  // Founder-dialed: MEMORY_BPS 0 restores the hard rule.
  const remembered = Object.entries(h.victimOwned.npc || {})
    .map(([npc, s]) => ({ npc, s: Math.floor(Number(s) * UNDERWORLD.STEP2.MEMORY_BPS / 10000) }))
    .filter((r) => r.s >= 1);
  // MUSCLE MEMORY (Skills step three): a long bloodline is born remembering a lowest-tier-first
  // PREFIX of the deceased's skills — up to min(MEMORY_MAX, floor(prestige/PRESTIGE_PER_SLOT))
  // slots. Read from the loaded set BEFORE the character_skills wipe below; sorting tier-ASC
  // makes the prefix prereq-safe (any skill's tier-(t−1) same-branch prereq sorts earlier).
  // Skills still DIE with the street (this is a small head start, not survival); MEMORY_MAX 0 or
  // a short bloodline (prestige < PRESTIGE_PER_SLOT) restores the hard rule. Pure build, no §10.4.
  const rememberedSkillIds = rememberedSkills([...(h.victimOwned.skills || [])], priorPrestige);
  // port_intercepts keys on (boat_id, pirate character_id): the loop below wipes the dead PIRATE's
  // attempts (character_id), but rows keyed on a dead RUNNER's boats would orphan once `boats` is
  // deleted — so sweep them by the runner's boats FIRST (before the loop removes the boats). Pure
  // row-hygiene (boat_id never re-collides), the npc_hits both-sides precedent.
  await client.query('DELETE FROM port_intercepts WHERE boat_id IN (SELECT id FROM boats WHERE character_id=$1)', [victim.id]);
  // territory step five: a dead made-man can't keep running an operation — clear their specialist post,
  // so the family's rackets don't keep his (snapshot) fortitude/scrutiny bonus after he's gone (RED-TEAM
  // fix: the passive bonus is a snapshot, so a dead specialist would otherwise buff forever).
  await client.query('UPDATE territory_rackets SET specialist=NULL, spec_power=0 WHERE specialist=$1', [victim.id]);
  for (const table of ['cars', 'boats', 'character_rackets', 'character_assets', 'character_cargo', 'character_items', 'character_guns', 'makings', 'stash', 'batches', 'businesses', 'numbers_tickets', 'fight_bets', 'track_bets', 'racers', 'blackjack_hands', 'crew_heist_members', 'pen_break_members', 'world_raid_members', 'character_skills', 'npc_standing', 'npc_leads', 'npc_grudges', 'npc_favors', 'npc_errands', 'npc_gain', 'pen_contraband', 'convoy_ambushes', 'port_intercepts'])
    await client.query(`DELETE FROM ${table} WHERE character_id=$1`, [victim.id]);
  // npc_hits keys on (payer, target) not character_id — wipe the dead street's per-pair NPC-hit
  // cooldown rows both ways (AUDIT-full-system-v2 C-LOW-2; harmless row-hygiene, the heir's fresh id
  // never inherits them, but no orphans left behind).
  await client.query('DELETE FROM npc_hits WHERE payer=$1 OR target=$1', [victim.id]);
  // World step three: a dead co-op raid leader's plan is abandoned so the crew can recrew (the
  // crew_heists precedent — the member rows above are already wiped; this frees the leadership).
  await abandonRaidsAtDeath(client, victim.id);
  // a dead leader's planned job is abandoned (the stake is sunk — no corpse refunds); the
  // stranded crew hear about it instead of finding an empty board (audit L5)
  const orphaned = (await client.query(
    `SELECT m.character_id, ch.job FROM crew_heists ch JOIN crew_heist_members m ON m.heist_id = ch.id
      WHERE ch.leader_character=$1 AND ch.status='planning' AND m.character_id != $1`, [victim.id])).rows;
  await client.query("UPDATE crew_heists SET status='abandoned' WHERE leader_character=$1 AND status='planning'", [victim.id]);
  for (const o of orphaned) await h.notify(client, o.character_id, 'heist_abandoned', { job: o.job, reason: 'leader_dead' });
  // a dead break-leader's plan is abandoned NOW (the crew_heists precedent — audit L2): the stranded
  // crew hear about it and are freed to plan a fresh break instead of waiting on the 1h stale-sweep
  // (the cutkit stays sunk for a dead leader, as the sweep already enforces)
  const brOrphans = (await client.query(
    `SELECT m.character_id FROM pen_breaks b JOIN pen_break_members m ON m.break_id = b.id
      WHERE b.leader_character=$1 AND b.status='planning' AND m.character_id != $1`, [victim.id])).rows;
  await client.query("UPDATE pen_breaks SET status='abandoned' WHERE leader_character=$1 AND status='planning'", [victim.id]);
  // free the crew cleanly — the disband precedent DELETEs member rows (UNIQUE(character_id) would else
  // block a stranded member from planning a fresh break, the resolve-path bug the co-op test caught)
  await client.query(
    "DELETE FROM pen_break_members WHERE break_id IN (SELECT id FROM pen_breaks WHERE leader_character=$1 AND status='abandoned')", [victim.id]);
  for (const o of brOrphans) await h.notify(client, o.character_id, 'break_abandoned', { reason: 'leader_dead' });
  // wiretaps die with either party (audit: a dead WATCHER's taps are dead-code row-leak; a dead TARGET's
  // taps wasted a live watcher's concurrency slot with no untap route — deleting the target's frees it)
  await client.query('DELETE FROM wiretaps WHERE watcher_character=$1 OR target_character=$1', [victim.id]);
  // step three: a dead party's informant retainers die too (disinfo_until rides the character row → gone with it)
  await client.query('DELETE FROM wire_informants WHERE watcher_character=$1 OR target_character=$1', [victim.id]);
  // step five: a dead party's standing watches die too (the wiretap precedent — a dead watcher stops watching, a dead target frees the slot)
  await client.query('DELETE FROM wire_watches WHERE watcher_character=$1 OR target_character=$1', [victim.id]);
  // a dead proprietor's club goes dark (+ its guest list); the man's patronage at other clubs clears too
  await wipeSpeakeasyAtDeath(client, victim.id);
  // (boxing step three) a dead manager's booked MAIN EVENTS are cancelled — the crowd is refunded (dead
  // bettors burn) BEFORE the fighters are deleted; the killer, if they bet this card, is mirrored in memory
  await cancelMainEventsAtDeath(client, victim.id, opts.killerCh);
  await wipeFighterAtDeath(client, victim.id);
  // a dead shipper's freight is scattered on the highway — goods die with the street
  await client.query("DELETE FROM convoy_cargo WHERE convoy_id IN (SELECT id FROM convoys WHERE owner_character=$1)", [victim.id]);
  await client.query("UPDATE convoys SET status='lost' WHERE owner_character=$1 AND status IN ('loading','transit')", [victim.id]);
  // a dead guard's principals are released: bodyguardAbsorbs already refuses a dead guard, but the
  // stale pointer also BLOCKED hiring a replacement for the rest of the window (paid, unprotected,
  // locked out — audit F8). One principal row may be IN-MEMORY in this very transaction: the
  // killer, if they'd hired their own victim as guard (betrayal beats protection) — mirror the
  // clear on that object or persistCharacter clobbers the SQL update back to the dead guard.
  await client.query('UPDATE characters SET guarded_by=NULL, guarded_until=NULL WHERE guarded_by=$1', [victim.id]);
  if (opts.killerCh && opts.killerCh.guarded_by === victim.id) {
    opts.killerCh.guarded_by = null; opts.killerCh.guarded_until = null;
  }
  await client.query('DELETE FROM searches WHERE hunter=$1 OR target=$1', [victim.id]);
  // THE LAW Phase 4 — THE WITNESS IS DOWN. If the dead man was an informant, the cases his
  // testimony built collapse: each target he named has the seed exposure lifted back off (a
  // bounded NUMERIC update — no INT-arithmetic quirk; the target row isn't locked, but a single
  // GREATEST statement is atomic), which drops their conviction odds / can keep them off an
  // indictment. His own file (if he was ALSO a named target) dies with him. Pure exposure — no §10.4.
  const seededByHim = (await client.query('SELECT target_character, seed FROM informants WHERE witness_character=$1', [victim.id])).rows;
  const collapsed = [];
  for (const s of seededByHim) {
    // lift the seed AND clear the indictment IT caused (a self-earned indictment — exposure still
    // ≥ INDICT after the seed comes off — survives; the CASE reads the pre-update row). Clearing
    // the case is the marquee "kill the witness → the case collapses" mechanic (schema/design).
    const upd = await client.query(
      `UPDATE characters SET heat_exposure = GREATEST(0, heat_exposure - $2),
         indicted_at = CASE WHEN heat_exposure - $2 < $3 THEN NULL ELSE indicted_at END,
         jury_bought = CASE WHEN heat_exposure - $2 < $3 THEN false ELSE jury_bought END
       WHERE id=$1 AND alive RETURNING id`, [s.target_character, Number(s.seed), LAW.INDICT_AT]);
    // persist-clobber discipline: if the KILLER is the named target (the rat named YOU — the whole
    // point of the waiver), the SQL write above would be clobbered by persistCharacter(killerCh).
    // Mirror the relief onto the in-memory killer instead (the refundPot/guarded_by precedent).
    if (opts.killerCh && s.target_character === opts.killerCh.id) {
      const ex = Math.max(0, Number(opts.killerCh.heat_exposure || 0) - Number(s.seed));
      opts.killerCh.heat_exposure = ex;
      if (ex < LAW.INDICT_AT) { opts.killerCh.indicted_at = null; opts.killerCh.jury_bought = false; }
    }
    if (upd.rowCount) collapsed.push(s.target_character); // only LIVING targets got the update (AND alive)
  }
  for (const tid of [...new Set(collapsed)]) await h.notify(client, tid, 'witness_down', {});
  await client.query('DELETE FROM informants WHERE witness_character=$1 OR target_character=$1', [victim.id]);
  // M7: a directed contract still in its EXCLUSIVE window is REFUNDED, not burned — an outsider
  // killing the mark first shouldn't torch the poster's stake (the named hitman never got their
  // shot). killerCh lets a killer who also funded such a pot take their own refund in-memory
  // (persistCharacter would clobber a direct SQL credit to the killer's row → §10.4 drift).
  const exclusive = (await client.query("SELECT kind FROM bounties WHERE target_character=$1 AND hitman IS NOT NULL AND opens_at > now()", [victim.id])).rows;
  for (const p of exclusive) {
    const { selfRefund } = await refundPot(client, victim.id, p.kind, opts.killerCh?.id);
    if (opts.killerCh && selfRefund) opts.killerCh.cash = Number(opts.killerCh.cash) + selfRefund;
  }
  // any remaining unclaimed contracts (open / past-window) die with the target — ledgered so escrow reconciles.
  // Lock the pot rows FIRST (a plain SELECT — Postgres forbids FOR UPDATE on an aggregate) so the burn
  // serializes with the expiry sweep's refundPot (which also locks characters→pot): without it the sweep
  // could refund a pot between our SUM read and our DELETE, double-resolving the same escrow → §10.4 drift.
  await client.query('SELECT 1 FROM bounties WHERE target_character=$1 FOR UPDATE', [victim.id]);
  const openBounty = Number((await client.query('SELECT COALESCE(SUM(amount),0) s FROM bounties WHERE target_character=$1', [victim.id])).rows[0].s);
  if (openBounty > 0)
    await h.ledger(client, { currency: 'cash', amount: -openBounty, reason: 'death:bounty', counterparty: victim.id });
  await client.query('DELETE FROM bounties WHERE target_character=$1', [victim.id]);
  await client.query('DELETE FROM bounty_contributors WHERE target_character=$1', [victim.id]);
  // …and any DIRECTED pot that named the DECEASED as its exclusive hitman (on a LIVING mark) OPENS to
  // all claimers — otherwise `claimBounty` skips a hospitalize pot in its window for anyone but the named
  // hitman, so a dead man's contract would lock the pot (and `postBounty` blocks re-naming) for up to
  // DIRECTED_MAX_H, handing the mark a free hospitalize-immunity window (RED-TEAM: the specialist
  // dangling-pointer sibling — a dead character can't hold an exclusive claim). §10.4-neutral (the escrow
  // stays; only the exclusivity pointer clears — kill pots already pay any killer, this fixes hospitalize).
  await client.query('UPDATE bounties SET hitman=NULL, opens_at=NULL WHERE hitman=$1', [victim.id]);
  // Exchange escrow forfeits with the man (v24 rule) — bucket rows keep cb/ammo conservation exact
  const escrowed = (await client.query("SELECT item_kind, SUM(qty) q FROM listings WHERE seller_character=$1 AND item_kind IN ('cb','ammo') GROUP BY item_kind", [victim.id])).rows;
  for (const e of escrowed)
    await h.ledger(client, { currency: e.item_kind, amount: -Number(e.q), reason: 'death:escrow', counterparty: victim.id });
  await client.query('DELETE FROM listings WHERE seller_character=$1', [victim.id]);
  // Black Market: the dead man's LISTINGS void with standing bids refunded (a killer who held
  // the bid takes it in-memory via killerCh — the refundPot discipline, no persist clobber);
  // his own standing BIDS burn (the dead-funder precedent) and those auctions reopen.
  // audit #1: a PLAYER fire-kill (opts.loot) loots CASH_LOOT_RATE of the victim's live order
  // escrow to the killer — parked liquid is no longer a loot-proof vault. NPC/mod kills pass 0.
  const mkt = await voidListingsAtDeath(client, victim.id, opts.killerCh, opts.loot ? M3.CASH_LOOT_RATE : 0);
  if (opts.killerCh && mkt.selfRefund) opts.killerCh.cash = Number(opts.killerCh.cash) + mkt.selfRefund;
  await burnBidsAtDeath(client, victim.id);
  // the heir id (generated early so the lender-death loan claim can pass to it below — the debt survives)
  const heirId = uid();
  // LOAN SHARKING: a PLAYER fire-kill (opts.loot) loots CASH_LOOT_RATE of the dead lender's OPEN-offer
  // escrow to the killer (parked capital is no longer a loot-proof vault, the market-order precedent);
  // the rest burns (loan:death). An active loan the DEAD LENDER made passes to the HEIR (the debt
  // survives — SIGN-OFF Tier 4, §10.4-neutral); a debt owed BY the dead borrower is uncollectable.
  const ln = await voidLoansAtDeath(client, victim.id, h, opts.killerCh, opts.loot ? M3.CASH_LOOT_RATE : 0, heirId);
  if (opts.killerCh && ln.looted) report.loanLoot = ln.looted;
  if (h.victimOwned.gangId) await removeMember(client, h.victimOwned.gangId, victim.id);

  victim.alive = false;
  await client.query('UPDATE characters SET alive=false, cash=0, bank=0, cb=0, ammo=0, gun=NULL, vest=NULL WHERE id=$1', [victim.id]);

  // the heir — same name (the bloodline), next generation, legacy stake (heirId generated above)
  const stake = 500 + 100 * Number(acct.prestige);
  // the bloodline stays "made" — a paid mint (§11) carries down the estate to the heir
  await client.query(
    'INSERT INTO characters (id, account_id, name, generation, season, cash, minted) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [heirId, victim.account_id, victim.name, Number(victim.generation) + 1, Math.floor(dayOf() / 28), stake, !!acct.minted]);
  // legacy stake above the base 500 is a ledgered faucet (base 500 matches every fresh character)
  if (stake > 500) await h.ledger(client, { characterId: heirId, currency: 'cash', amount: stake - 500, reason: 'death:legacy' });
  // …and the names that remember the bloodline follow the heir (fresh touched_at — the clock restarts)
  for (const m of remembered)
    await client.query('INSERT INTO npc_standing (character_id, npc_id, standing) VALUES ($1,$2,$3)', [heirId, m.npc, m.s]);
  report.kept.memory = remembered.length;
  // MUSCLE MEMORY — the heir is born knowing a prereq-safe prefix of the bloodline's skills
  for (const sid of rememberedSkillIds)
    await client.query('INSERT INTO character_skills (character_id, skill_id) VALUES ($1,$2)', [heirId, sid]);
  report.kept.skills = rememberedSkillIds.length;
  await h.notify(client, heirId, 'estate', report);
  // VENDETTA — a player fire-kill swears the bloodline against the killer's (NPC/mod deaths
  // don't: no street to swear against). One active vendetta per account pair; a repeat kill
  // refreshes the clock. The heir is born owing blood.
  if (opts.vendetta && opts.killerCh) {
    // step two — ESCALATION: a repeat kill DEEPENS the feud (kills++), and a deeper feud carries a
    // longer TTL (feudTierOf(kills).ttlMult — access/timing only, off §10.4 + the sim balance) so a
    // War of Extinction won't lapse from waiting. UPDATE-first, INSERT on zero rows (audit F3): the
    // hourly sweep can DELETE an expired row between a SELECT and its UPDATE — the UPDATE either locks
    // the row (the sweep's re-check then skips it) or touches nothing and the INSERT writes fresh at 1.
    const prior = Number((await client.query('SELECT kills FROM vendettas WHERE avenger_account=$1 AND target_account=$2',
      [victim.account_id, opts.killerCh.account_id])).rows[0]?.kills || 0);
    const kills = prior + 1;
    const tier = feudTierOf(kills);
    const until = new Date(Date.now() + VENDETTA.TTL_MS * tier.ttlMult);
    const upd = await client.query('UPDATE vendettas SET sworn=$3, expires_at=$4, kills=$5 WHERE avenger_account=$1 AND target_account=$2',
      [victim.account_id, opts.killerCh.account_id, victim.name, until, kills]);
    if (!upd.rowCount) await client.query('INSERT INTO vendettas (avenger_account, target_account, sworn, expires_at, kills) VALUES ($1,$2,$3,$4,$5)',
      [victim.account_id, opts.killerCh.account_id, victim.name, until, kills]);
    // a fresh vendetta ends any pending sit-down between the two lines — blood reopens the books
    await client.query('DELETE FROM feud_peace_offers WHERE (from_account=$1 AND target_account=$2) OR (from_account=$2 AND target_account=$1)',
      [victim.account_id, opts.killerCh.account_id]);
    await h.notify(client, heirId, 'vendetta', { against: killerName, for: victim.name, tier: tier.name,
      days: Math.round(VENDETTA.TTL_MS * tier.ttlMult / 86400000) });
  }
  // §12 + §10.4: the death event carries the destroyed fleet size for car conservation
  await client.query('INSERT INTO telemetry (id, account_id, event, props) VALUES ($1,$2,$3,$4)',
    [uid(), victim.account_id, 'death', JSON.stringify({ by: killerName, cars: h.victimOwned.cars.length, lvl })]);
  return { heirId, report, orderLoot: mkt.looted };
}

// ═══════════════ VENDETTA step two — THE SIT-DOWN (consensual peace) + the blood-debt board ═══════════════
// Both are PURE STATUS (no money, no currency — §10.4 untouched by construction). A feud is a two-way
// affair; peace clears BOTH directions between the two bloodlines. No lock beyond the actor's char row
// (the vendetta/offer rows are account-keyed and the writes are idempotent).
const acctOfTarget = async (client, targetCharId) =>
  (await client.query('SELECT account_id, name FROM characters WHERE id=$1', [targetCharId])).rows[0] || null;
const activeFeudBetween = async (client, a, b) => !!(await client.query(
  `SELECT 1 FROM vendettas WHERE ((avenger_account=$1 AND target_account=$2) OR (avenger_account=$2 AND target_account=$1))
     AND expires_at > now() LIMIT 1`, [a, b])).rows[0];

// POST /v1/feud/:targetId/peace — offer to bury the hatchet with the target's bloodline.
export async function proposePeace(ch, targetId, client, h) {
  const t = await acctOfTarget(client, targetId);
  if (!t) throw new GameError('no_target', 'Nobody by that name.');
  if (t.account_id === ch.account_id) throw new GameError('self', 'You are not at war with yourself.');
  if (!(await activeFeudBetween(client, ch.account_id, t.account_id))) throw new GameError('no_feud', 'No blood between your lines to settle.');
  // UPDATE-first / INSERT (a re-offer just refreshes the timestamp; the PK stops a dup)
  const upd = await client.query('UPDATE feud_peace_offers SET at=now() WHERE from_account=$1 AND target_account=$2', [ch.account_id, t.account_id]);
  if (!upd.rowCount) {
    try { await client.query('INSERT INTO feud_peace_offers (from_account, target_account) VALUES ($1,$2)', [ch.account_id, t.account_id]); }
    catch { /* raced to the same offer — already standing */ }
  }
  await h.notify(client, targetId, 'feud_peace_offer', { from: ch.name });
  return { ok: true, proposedTo: t.name };
}

// POST /v1/feud/:targetId/peace/accept — accept the target's standing offer; clears BOTH-direction feuds.
export async function acceptPeace(ch, targetId, client, h) {
  const t = await acctOfTarget(client, targetId);
  if (!t) throw new GameError('no_target', 'Nobody by that name.');
  const offer = (await client.query('SELECT 1 FROM feud_peace_offers WHERE from_account=$1 AND target_account=$2', [t.account_id, ch.account_id])).rows[0];
  if (!offer) throw new GameError('no_offer', "They haven't offered peace.");
  // the sit-down: clear every vendetta between the two lines (both directions) + all offers
  await client.query('DELETE FROM vendettas WHERE (avenger_account=$1 AND target_account=$2) OR (avenger_account=$2 AND target_account=$1)', [ch.account_id, t.account_id]);
  await client.query('DELETE FROM feud_peace_offers WHERE (from_account=$1 AND target_account=$2) OR (from_account=$2 AND target_account=$1)', [ch.account_id, t.account_id]);
  await h.notify(client, targetId, 'feud_peace_made', { with: ch.name });
  bus.emit('streets', { type: 'vendetta_peace', a: ch.name, b: t.name });
  return { ok: true, peaceWith: t.name };
}

// GET /v1/leaderboard/feuds — the deadliest ACTIVE blood feuds across the base (by kills). Pure status:
// each side is the bloodline's CURRENT living street; a line with no living character is skipped.
export async function feudLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT v.avenger_account, v.target_account, v.kills, v.expires_at,
            av.name AS avenger, tg.name AS target
       FROM vendettas v
       JOIN characters av ON av.account_id = v.avenger_account AND av.alive
       JOIN characters tg ON tg.account_id = v.target_account AND tg.alive
      WHERE v.expires_at > now()
      ORDER BY v.kills DESC, v.expires_at DESC LIMIT 15`)).rows;
  return { feuds: rows.map((r) => ({ avenger: r.avenger, target: r.target, kills: Number(r.kills),
    tier: feudTierOf(r.kills).name, expiresSeconds: Math.max(0, Math.ceil((new Date(r.expires_at) - Date.now()) / 1000)) })) };
}

// ═══════════════════ BUSTING (§7.8) ═══════════════════
export async function bust(ch, victim, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You're in the same cage.");
  const remaining = victim.jail_until ? Math.max(0, (new Date(victim.jail_until) - Date.now()) / 1000) : 0;
  if (remaining <= 0) throw new GameError('free', 'They already walked.');
  const ev = cityEventOf(dayOf());
  const chance = Math.max(0.10, Math.min(0.90, 0.7 - remaining / 400 + (Number(ch.busts) || 0) * 0.03 + (ev.bustAdd || 0)));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `bust:${victim.id}`, roll, roll < chance ? 'success' : 'fail');
  if (roll < chance) {
    const reward = Math.floor(500 + remaining * 15); // §7.8 faucet
    ch.cash = Number(ch.cash) + reward;
    ch.respect = Number(ch.respect) + 3;
    ch.busts = (Number(ch.busts) || 0) + 1;
    victim.jail_until = null;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: reward, reason: 'bust:reward' });
    await h.bumpDaily(client, ch.id, 'bust');
    await h.notify(client, victim.id, 'busted', { from: ch.name });
    bus.emit('streets', { type: 'bust', by: ch.name, freed: victim.name });
    return { ok: true, success: true, reward, busts: ch.busts };
  }
  ch.jail_until = new Date(Date.now() + M3.BUST_FAIL_JAIL_S * 1000);
  return { ok: true, success: false, jailSeconds: M3.BUST_FAIL_JAIL_S };
}

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
