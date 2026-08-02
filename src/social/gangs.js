// Families — founding, membership, tribute, wars and turf.
//
// Below the contract board and the estate, both of which reach in here (removeMember runs on
// death; canCommand gates a treasury-funded contract). Nothing in this file calls into them,
// which is what keeps the package acyclic.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bumpFamilyTask, bus, ledger, cleanText } from '../game.js';
import { DISTRICTS, M3, M8, levelOf, dayOf, territoryBuildCost, worldNpcOf, liberationCost, DIPLOMACY, cityHourOf } from '../rules.js';
import { seizeTerritoryRackets, releaseTerritoryRackets } from '../territory.js';
import { releaseFrontierHolds, outfitStrengthFrac } from '../world.js';
import { activeDecree } from '../commission.js';
import { pactActive, coalitionDiscountActive, dissolveDiplomacy } from '../diplomacy.js';
import { sovGarrisonBonus, razeSov, dissolveSov } from '../sov.js';
import { runEstate } from './estate.js';
import { canCommand, now, uid, warActive } from './shared.js';

// ═══════════════════ GANGS (§5.5) ═══════════════════
export async function createGang(ch, name, tag, client, h) {
  if (h.owned.gangId) throw new GameError('in_gang', 'You already have a family.');
  if (levelOf(Number(ch.respect)) < M3.GANG_FOUND_LEVEL) throw new GameError('level', `Level ${M3.GANG_FOUND_LEVEL} to found a family.`);
  name = cleanText(name).trim(); tag = String(tag || '').trim().toUpperCase(); // strip HTML-injection chars (stored-XSS fix, R6)
  if (name.length < 3 || name.length > 24) throw new GameError('name', 'Family name must be 3–24 characters.');
  // (red-team R8) ASCII-only charset (the cosmetic-field guard) — a homoglyph/zero-width family name
  // that renders like another's impersonates it across the streets feed, leaderboards, and gang board.
  if (!/^[\w .,'&-]+$/.test(name)) throw new GameError('name', 'Family name: letters, numbers and simple punctuation only (no look-alike unicode).');
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
  // territory step five (red-team R32): a departed/kicked made-man can't keep running the family's
  // operation either — mirror the death-path clear (runEstate) so a leaver's snapshot specialist bonus
  // (fortitude/scrutiny resistance) doesn't buff a racket he no longer defends (worse: after he joins a
  // rival, his stats would shield the operation his new family raids). On dissolution the rackets are
  // released below anyway; in the survive path this clears exactly the departing specialist.
  await client.query('UPDATE territory_rackets SET specialist=NULL, spec_power=0 WHERE specialist=$1', [characterId]);
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
    await dissolveDiplomacy(client, gangId);       // FIVE PILLARS #2: a dead family's treaties + coalition seats go with it
    await dissolveSov(client, gangId);             // FIVE PILLARS #3: its strongholds are razed (nobody inherits walls)
    await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL WHERE war_with=$1', [gangId]);
    // the Commission forgets a dead family: its ballots die with it (audit H1 — a dissolved
    // gang's frozen vote must not govern next week from beyond the grave, invisible to the
    // board's join). Its VETO record stays — the decree it killed was killed while it lived.
    await client.query('DELETE FROM commission_votes WHERE gang_id=$1', [gangId]);
    // Tier-4 — its OVERRIDE ballots die with it too (a dead family can't muster against the head veto).
    // overrideWeightOf already filters by live seats so a stale row scores 0, but keep the table honest.
    await client.query('DELETE FROM commission_overrides WHERE gang_id=$1', [gangId]);
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
  // FIVE PILLARS #2: a SWORN pact blocks war between the two families (the pax precedent — one
  // touchpoint). Break the treaty first, and wear the oathbreaker mark for it.
  if (await pactActive(client, h.owned.gangId, targetGangId))
    throw new GameError('pact', 'A sworn treaty stands between the families — break it first (and wear the mark).');
  await resolveWarIfDue(client, h.owned.gangId);
  await resolveWarIfDue(client, targetGangId);
  const [id1, id2] = [h.owned.gangId, targetGangId].sort();
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === h.owned.gangId ? g1 : g2, them = g1?.id === h.owned.gangId ? g2 : g1;
  if (!them) throw new GameError('no_gang', 'That family no longer exists.');
  if (warActive(us) || warActive(them)) throw new GameError('at_war', 'One of you is already at war.');
  // FIVE PILLARS #2: an ARMED coalition against the target halves a member's war chest — the EU4
  // anti-hegemon tooth. The DISCOUNTED number is what's deducted AND ledgered (the decree precedent).
  const coalition = await coalitionDiscountActive(client, us.id, them.id);
  const warCost = coalition ? Math.floor(M3.WAR_COST * DIPLOMACY.COALITION_WAR_MULT) : M3.WAR_COST;
  if (Number(us.treasury) < warCost) throw new GameError('treasury', `War takes a $${warCost} war chest in the treasury.`);
  const until = new Date(Date.now() + M3.WAR_MS);
  // the war chest burns — a §10.4 cash sink out of the treasury bucket
  await client.query('UPDATE gangs SET treasury = treasury - $2, war_with=$3, war_until=$4, war_score_us=0, war_score_them=0 WHERE id=$1',
    [us.id, warCost, them.id, until]);
  await client.query('UPDATE gangs SET war_with=$2, war_until=$3, war_score_us=0, war_score_them=0 WHERE id=$1', [them.id, us.id, until]);
  await h.ledger(client, { currency: 'cash', amount: -warCost, reason: 'gang:war', counterparty: us.id });
  bus.emit(`gang:${them.id}`, { type: 'war_declared', by: us.name });
  return { ok: true, until, spoilsPct: M3.WAR_SPOILS };
}

// ═══════════════════ TURF (§5.5) ═══════════════════

// ═══════════════════ TURF (§5.5) ═══════════════════
// ── THE WATCH (the strategy package's TIME WINDOW) ──
// Is the holder's declared window open right now? A district with no declared watch is NEVER on
// watch, so every hour is a surprise — which is the honest reading: a family that never says when
// it is home cannot claim to have been caught off guard, and gets no cheap hour either.
export const onWatch = (d, now = Date.now()) => {
  if (d?.watch_hour == null) return false;
  // cityHourOf returns {hour, patrol, phase} — read the FIELD. (The sov window shipped reading the
  // object as a number, which is NaN arithmetic and left that window permanently shut; fixed there too.)
  return ((cityHourOf(now).hour - Number(d.watch_hour) + 24) % 24) < M3.WATCH_WINDOW_H;
};
// The multiplier the ATTACKER pays. Off-watch is a surprise and costs more; a family that declared
// no watch is surprised at every hour, so an undeclared district is always the dearer price — the
// declaration is what BUYS you a cheap window, and it costs you having to be there for it.
export const watchMult = (d, now = Date.now()) => (onWatch(d, now) ? 1 : M3.WATCH_SURPRISE_MULT);

// A boss/underboss sets the hour their family stands ready on turf they hold. Free, changeable —
// the cost of the decision is having to BE there, not a fee. Zero §10.4 surface.
export async function setWatch(ch, districtId, hour, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss sets the watch.');
  const hr = Number(hour);
  if (!Number.isInteger(hr) || hr < 0 || hr > 23) throw new GameError('bad_hour', 'Pick the hour your family stands ready (0–23 UTC).');
  const d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!d) throw new GameError('bad_district', 'No such district.');
  if (d.holder_gang !== h.owned.gangId) throw new GameError('not_held', "You don't hold that district.");
  await client.query('UPDATE districts SET watch_hour=$2 WHERE id=$1', [districtId, hr]);
  return { ok: true, district: districtId, watchHour: hr, windowH: M3.WATCH_WINDOW_H,
    onWatchNow: onWatch({ watch_hour: hr }), surpriseMult: M3.WATCH_SURPRISE_MULT };
}

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
  // FIVE PILLARS #3: a standing (non-crumbling) STRONGHOLD stiffens the price of taking the district
  // — its garrison joins the outbid COST (never the stored garrison — the defense budget stays the
  // plain quote). #2: an ARMED coalition vs the holder discounts the whole bill ×COALITION_SEIZE_MULT
  // (the anti-hegemon tooth; the discounted number is what's deducted AND ledgered).
  const sovBonus = occupied ? 0 : await sovGarrisonBonus(client, districtId);
  const coalitionVsHolder = !occupied && d.holder_gang
    && await coalitionDiscountActive(client, h.owned.gangId, d.holder_gang);
  // THE WATCH: a player-held district taken OUTSIDE the holder's declared window costs the surprise
  // premium. An NPC-occupied district has no watch to keep (outfits don't sleep) and an unheld one
  // has nobody to surprise, so both stay at the plain price.
  const surprise = (!occupied && d.holder_gang) ? watchMult(d) : 1;
  const cost = Math.floor((base + sovBonus + premium) * (coalitionVsHolder ? DIPLOMACY.COALITION_SEIZE_MULT : 1) * surprise);
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
  // FIVE PILLARS #3: the fallen holder's stronghold is RAZED with the turf (destruction, never a
  // transfer — the EVE anti-snowball; you build your own walls on conquered ground).
  const razed = occupied ? false : await razeSov(client, districtId);
  if (!h.owned.held.includes(districtId)) h.owned.held.push(districtId);
  bus.emit('streets', occupied ? { type: 'liberated', district: districtId, gang: g.name, npc: worldNpcOf(d.npc_holder)?.name }
    : { type: 'seize', district: districtId, gang: g.name });
  return { ok: true, district: districtId, garrison: base, premium, cost, liberated: occupied, razedStronghold: razed };
}

// ═══════════════════ JUMPS (§7.6) ═══════════════════
