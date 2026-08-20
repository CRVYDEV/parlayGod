// Families — founding, membership, tribute, wars and turf.
//
// Below the contract board and the estate, both of which reach in here (removeMember runs on
// death; canCommand gates a treasury-funded contract). Nothing in this file calls into them,
// which is what keeps the package acyclic.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bumpFamilyTask, bus, ledger, cleanText, notify } from '../game.js';
import { DISTRICTS, M3, M8, MAP, districtNeighbours, ROSTER_POSTS, rosterPostOf, rosterMult, levelOf, dayOf, territoryBuildCost, worldNpcOf, liberationCost, DIPLOMACY, cityHourOf, seasonFx, CHARTERS, familyCharterOf, charterFx, FAMILY_CHARTER, usd } from '../rules.js';
import { seizeTerritoryRackets, releaseTerritoryRackets } from '../territory.js';
import { releaseFrontierHolds, outfitStrengthFrac } from '../world.js';
import { releaseFamilyHolds } from '../npcwar.js';
import { activeDecree } from '../commission.js';
import { pactActive, coalitionDiscountActive, dissolveDiplomacy } from '../diplomacy.js';
import { sovGarrisonBonus, razeSov, dissolveSov } from '../sov.js';
import { runEstate } from './estate.js';
import { canCommand, now, uid, warActive } from './shared.js';
import { postPower, rosterBoard, rosterEffects } from '../roster.js';

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
  if (Number(ch.cash) < M3.GANG_FOUND_COST) throw new GameError('cash', `Founding a family costs ${usd(M3.GANG_FOUND_COST)}.`);
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
    // THE WATCH goes with the turf: a released district has no holder, so there is nobody standing
    // ready on it and the public board must not advertise a dead family's hour as a live window.
    // `contest_until` is deliberately NOT cleared — a live contest may hold OTHER families' escrow,
    // and only the sweep (which selects on contest_until) can resolve it and give that money back.
    await client.query('UPDATE districts SET holder_gang=NULL, garrison=0, watch_hour=NULL WHERE holder_gang=$1', [gangId]);
    await releaseTerritoryRackets(client, gangId); // Phase 3: the operations die with the family (turf released)
    await releaseFrontierHolds(client, gangId);    // World step three: the frontier flags drop (the house takes its turf back)
    await releaseFamilyHolds(client, gangId);       // BLOOD WAR conquest: a dead family's NPC vassals go unheld
    await dissolveDiplomacy(client, gangId);       // FIVE PILLARS #2: a dead family's treaties + coalition seats go with it
    await dissolveSov(client, gangId);             // FIVE PILLARS #3: its strongholds are razed (nobody inherits walls)
    await client.query('UPDATE gangs SET war_with=NULL, war_until=NULL WHERE war_with=$1', [gangId]);
    // the Commission forgets a dead family: its ballots die with it (audit H1 — a dissolved
    // gang's frozen vote must not govern next week from beyond the grave, invisible to the
    // board's join). Its VETO record stays — the decree it killed was killed while it lived.
    await client.query('DELETE FROM commission_votes WHERE gang_id=$1', [gangId]);
    await client.query('DELETE FROM commission_ticker_votes WHERE gang_id=$1', [gangId]); // the ticker ballot follows the same rule: no ghost governance
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
  // NPC FAMILIES: the flag is about who RUNS it, so it is re-DERIVED from the new chair rather than
  // cleared one way. Succession can hand the chair to a PLAYER who joined as a soldier, and a
  // player-run family carrying the flag would be barred from the Commission and the family yield —
  // a penalty applied to a player by a flag that was never about them. But the reverse matters just
  // as much: clearing only would leave a family that briefly had a player boss permanently
  // unflagged, and then a RESIDENT inherits it back and it is a resident-run family that CAN be
  // declared war on — the fixed-price standing farm the war block exists to stop. Symmetric closes
  // that. (A player joining as a soldier changes nothing: the house still runs the family. And a
  // real player family can never hand the chair to a resident, since residents only ever join
  // flagged ones, so this is a no-op there.)
  if (!hasBoss) await client.query(
    `UPDATE gangs SET npc_flag = COALESCE((SELECT c.is_npc FROM characters c WHERE c.id=$2), npc_flag)
       WHERE id=$1`, [gangId, left[0].character_id]);
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

// ── THE ROSTER (the strategy package's SCARCE PEOPLE) ──
// Put a made man in a post. ONE post per man and ONE man per post, so a family with one great
// all-rounder still has to decide what he does with himself — that is the whole mechanic, and the
// numbers underneath are deliberately small.
//
// Zero §10.4: an assignment moves no currency and writes no ledger row. The gang row is locked so
// two officers cannot fill the same chair at once; the post is then cleared from whoever held it,
// which makes the whole thing idempotent.
export async function assignPost(ch, targetCharacterId, postId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss hands out posts.');
  const post = rosterPostOf(postId);
  if (!post) throw new GameError('bad_post', `Posts: ${ROSTER_POSTS.map((p) => p.id).join(', ')}.`);
  // gang row first — the family is the thing two officers race over (the joinGang precedent)
  const g = (await client.query('SELECT id FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (!g) throw new GameError('no_gang', 'That family no longer exists.');
  const m = (await client.query(
    `SELECT m.post, m.post_at, c.name, c.respect, c.alive FROM gang_members m JOIN characters c ON c.id = m.character_id
     WHERE m.gang_id=$1 AND m.character_id=$2`, [h.owned.gangId, targetCharacterId])).rows[0];
  if (!m || !m.alive) throw new GameError('no_member', 'Not one of yours.');
  if (levelOf(Number(m.respect)) < M3.ROSTER_MIN_LEVEL)
    throw new GameError('level', `A man has to make level ${M3.ROSTER_MIN_LEVEL} before he holds a post.`);
  if (m.post === postId) throw new GameError('already', `${m.name} already holds that post.`);
  // the cooldown is on the MAN, not the chair. A family whose officer is taken off the board can
  // put somebody else in immediately — and that costs them a SECOND made man, which is the point.
  // What it stops is shuffling one good man between posts to be everywhere at once.
  //
  // `post_at` is when he last CHANGED posting and is never cleared — not when he took up the chair he
  // is sitting in. Read the other way (`m.post && …`) the rule was one `DELETE /v1/roster/:post` away
  // from nothing: stand him down (free and instant), his stamp goes with the chair, and he walks into
  // the next one the same second. The reactive flip that buys — Bagman all week, Enforcer the moment
  // a contest opens — is exactly the shuffle the cooldown exists to price.
  if (m.post_at && Date.now() - new Date(m.post_at).getTime() < M3.ROSTER_REASSIGN_CD_MS)
    throw new GameError('settled', `${m.name} was only just moved — give him time before you post him again.`);
  await client.query('UPDATE gang_members SET post=NULL WHERE gang_id=$1 AND post=$2', [h.owned.gangId, postId]);
  await client.query('UPDATE gang_members SET post=$3, post_at=$4 WHERE gang_id=$1 AND character_id=$2',
    [h.owned.gangId, targetCharacterId, postId, now()]);
  await notify(client, targetCharacterId, 'post_given', { post: postId, name: post.name });
  bus.emit('streets', { type: 'post', gang: h.owned.gang?.name, post: post.name, who: m.name });
  return { ok: true, post: postId, postName: post.name, who: m.name,
    power: await postPower(client, h.owned.gangId, postId) };
}

// Take a man off a post — free and instant. Standing a post down is never the thing you have to be
// talked out of; putting a man IN one is.
export async function vacatePost(ch, postId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss hands out posts.');
  const post = rosterPostOf(postId);
  if (!post) throw new GameError('bad_post', `Posts: ${ROSTER_POSTS.map((p) => p.id).join(', ')}.`);
  // …but his stamp stays. Standing a man down and walking him into the next chair is the same
  // shuffle as moving him straight across, and clearing post_at here made the reassign cooldown
  // optional (see assignPost).
  const r = await client.query('UPDATE gang_members SET post=NULL WHERE gang_id=$1 AND post=$2', [h.owned.gangId, postId]);
  if (!r.rowCount) throw new GameError('empty', 'Nobody holds that post.');
  return { ok: true, post: postId, postName: post.name, vacated: true };
}

// The family's table of posts + what each is worth right now (one round trip each).
export async function rosterOf(client, gangId) {
  return { posts: await rosterBoard(client, gangId), effects: await rosterEffects(client, gangId),
    minLevel: M3.ROSTER_MIN_LEVEL, reassignSeconds: Math.round(M3.ROSTER_REASSIGN_CD_MS / 1000) };
}


export async function tribute(ch, amount, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const amt = Math.floor(Number(amount) || 0);
  if (amt < M3.TRIBUTE_MIN) throw new GameError('min', `Minimum tribute is ${usd(M3.TRIBUTE_MIN)}.`);
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
  // `currency` is what tells the two tributes apart. Both returned a bare {ok, amount}, so
  // $25,000 of cash and 25 $OMR were byte-identical on the wire and the toast could only guess
  // — it said "done." for both rather than name the wrong one.
  return { ok: true, amount: amt, currency: 'cash' };
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
  return { ok: true, amount: amt, currency: 'omr' };
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
  // NPC FAMILIES: not a war target. A resident-run family never declares, never scores and never
  // retaliates, so a war against one is a fixed-price purchase of standing — `season_wars` is half
  // the Commission ladder — with 20% of their treasury as spoils on top, repeatable. The same
  // argument that stops a corpse being farmed. (Deferred to a step two with its own sizing: an NPC
  // family that DEFENDS is real content — the World's cartel outfits are the precedent.)
  if (them.npc_flag) throw new GameError('npc', "They're nobody's rivals — that outfit won't put up a fight worth having.");
  if (warActive(us) || warActive(them)) throw new GameError('at_war', 'One of you is already at war.');
  // FIVE PILLARS #2: an ARMED coalition against the target halves a member's war chest — the EU4
  // anti-hegemon tooth. The DISCOUNTED number is what's deducted AND ledgered (the decree precedent).
  const coalition = await coalitionDiscountActive(client, us.id, them.id);
  // THE ROSTER — THE STREETBOSS: a family with a war man in the chair declares cheaper. Composes
  // multiplicatively with the coalition discount, and the DISCOUNTED number is what is deducted AND
  // ledgered (the decree/amnesty discipline) — so `gang:war` still reconciles to the dollar.
  const warMult = rosterMult(await postPower(client, h.owned.gangId, 'streetboss'), M3.ROSTER_STREETBOSS_WAR_PER);
  // VALUE-AT-STAKE: the war chest scales with what you stand to WIN — WAR_SPOILS (20%) of the target's
  // treasury — floored at WAR_COST so a broke target is unchanged. `them` is FOR UPDATE-locked above, so
  // the treasury read is consistent. The coalition/streetboss discounts multiply the scaled base (the
  // discounted number is what burns AND is ledgered — the decree/amnesty discipline, so gang:war reconciles).
  const warBase = Math.max(M3.WAR_COST, Math.floor(Number(them.treasury) * M3.WAR_COST_BPS / 10000));
  const warCost = Math.floor((coalition ? warBase * DIPLOMACY.COALITION_WAR_MULT : warBase) * warMult);
  if (Number(us.treasury) < warCost) throw new GameError('treasury', `War takes a ${usd(warCost)} war chest in the treasury.`);
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
// THE RECKONING narrows it (seasonFx is 1 outside the final week, so this is a no-op eleven months
// of the year): in the last stretch of a season you cannot hide behind a declared hour.
export const watchWindowH = () => Math.max(1, Math.round(M3.WATCH_WINDOW_H * seasonFx('watchWindowMult')));
export const onWatch = (d, now = Date.now()) => {
  if (d?.watch_hour == null) return false;
  // cityHourOf returns {hour, patrol, phase} — read the FIELD. (The sov window shipped reading the
  // object as a number, which is NaN arithmetic and left that window permanently shut; fixed there too.)
  return ((cityHourOf(now).hour - Number(d.watch_hour) + 24) % 24) < watchWindowH();
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
  // …but NOT once somebody is at the door. The watch is a COMMITMENT — you name the hour your family
  // stands ready and a rival pays the surprise premium outside it. A contest is public the moment the
  // first stake lands, so a holder who could still move the hour would simply flip it away from NOW
  // and make every subsequent stake 1.5× dearer: a free instant reaction, not a commitment. Frozen
  // for the window; the ordinary "our schedule changed" move is untouched the rest of the time.
  if (contestLive(d)) throw new GameError('contested', 'Not with a contest running on it — the watch is what you committed to.');
  await client.query('UPDATE districts SET watch_hour=$2 WHERE id=$1', [districtId, hr]);
  return { ok: true, district: districtId, watchHour: hr, windowH: watchWindowH(),
    onWatchNow: onWatch({ watch_hour: hr }), surpriseMult: M3.WATCH_SURPRISE_MULT };
}

// ═══ FAMILY CHARTERS — what the family IS ════════════════════════════════════════════════════════
// Every family was mechanically identical apart from what it happened to hold, so "who are we" had
// no answer anybody could give differently. The boss picks a charter and takes its handicap with it;
// see CHARTERS in rules.tail.js for why the handicap is the whole mechanic.
//
// FREE THE FIRST TIME, then a $OMR sink from the family reserve on a cooldown (the buySeal/foundation
// precedent — `vanity:charter` rides the existing `vanity:%` burn term and vocabulary, so §10.4 needs
// no change at all). An alpha boss should not be trapped by a decision made before they knew what the
// choices meant; a boss who wants to re-found the family every week should pay for the privilege.
export async function chooseCharter(ch, charterId, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'Only the boss says what the family is.');
  const pick = familyCharterOf(charterId);
  if (!pick) throw new GameError('bad_charter', 'No such charter.');
  // the gang row is the source of truth for the current charter, the reserve and the cooldown, and
  // all three are read-then-written here — so it locks first (the buySeal discipline).
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (!g) throw new GameError('gang', 'No family to charter.');
  if (g.charter === pick.id) throw new GameError('already', `The family already runs as ${pick.name}.`);
  const first = !g.charter;
  let cost = 0;
  if (!first) {
    const since = g.charter_at ? Date.now() - new Date(g.charter_at).getTime() : Infinity;
    if (since < FAMILY_CHARTER.CHANGE_CD_MS)
      throw new GameError('cooldown', `The family only re-founds itself so often — ${Math.ceil((FAMILY_CHARTER.CHANGE_CD_MS - since) / 3600000)}h to go.`);
    cost = FAMILY_CHARTER.CHANGE_OMR;
    if (Number(g.omr_reserve) < cost)
      throw new GameError('reserve', `Re-founding the family takes ${cost} $OMR from the reserve (${Math.floor(Number(g.omr_reserve))} on hand).`);
  }
  // the cooldown is armed by a PAID re-founding, never by the free first pick — the trap the free
  // pick exists to avoid is the decision made before you knew what the choices meant, and a week's
  // lock on correcting it would put that trap straight back.
  await client.query(`UPDATE gangs SET charter=$2, omr_reserve = omr_reserve - $3${cost > 0 ? ', charter_at=now()' : ''} WHERE id=$1`,
    [g.id, pick.id, cost]);
  if (cost > 0) await h.ledger(client, { currency: 'omr', amount: -cost, reason: 'vanity:charter', counterparty: g.id });
  if (h.owned.gang) { h.owned.gang.charter = pick.id; h.owned.gang.omr_reserve = Number(g.omr_reserve) - cost; }
  bus.emit('streets', { type: 'charter', gang: g.name, charter: pick.name });
  await h.track(client, ch.account_id, 'gang_charter', { charter: pick.id, cost });
  return { ok: true, charter: { id: pick.id, name: pick.name, good: pick.good, bad: pick.bad },
    cost, free: first, reserve: Number(g.omr_reserve) - cost, changeOmr: FAMILY_CHARTER.CHANGE_OMR,
    changeAfterH: Math.round(FAMILY_CHARTER.CHANGE_CD_MS / 3600000) };
}

// ── THE PRICE OF TURF — the ONE computation the outright claim and the sealed contest's floor
// both read, so the two can never drift apart (the extortFront one-core lesson: a copied block is
// how the sackEmpire rake-cursor drifted). Throws the level gate; returns every component so a
// caller can explain the bill.
//
// `gangId` is the family DOING the taking. A DEFENDER (the current holder, raising their own stake
// in a contest) is never surprised on their own turf and never coalitions against themselves, so
// both modifiers are the attacker's alone.
export async function turfQuote(client, ch, d, gangId) {
  // STEP FIVE — THE OCCUPATION: an NPC-garrisoned district is LIBERATED (not seized from a player). The
  // cost scales with the occupying outfit's LIVE strength (a lockless quote — beat it down first and its
  // turf goes cheap), floored at OCCUPY_MIN. No territory racket transfers (an NPC district has none).
  const occupied = !!d.npc_holder;
  const defending = !!d.holder_gang && d.holder_gang === gangId;
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
    const op = (await client.query('SELECT tier FROM territory_rackets WHERE district_id=$1', [d.id])).rows[0];
    premium = op ? Math.floor(territoryBuildCost(op.tier) * M3.TERRITORY_SEIZE_BPS / 10000) : 0;
  }
  // FIVE PILLARS #3: a standing (non-crumbling) STRONGHOLD stiffens the price of taking the district
  // — its garrison joins the outbid COST (never the stored garrison — the defense budget stays the
  // plain quote). #2: an ARMED coalition vs the holder discounts the whole bill ×COALITION_SEIZE_MULT
  // (the anti-hegemon tooth; the discounted number is what's deducted AND ledgered).
  const sovBonus = occupied ? 0 : await sovGarrisonBonus(client, d.id);
  // THE ROSTER — THE ENFORCER: a family with a man posted on the door is dearer to come for. The
  // bonus is the ATTACKER's price only; it never enters the stored garrison (the sovBonus rule), and
  // it is zero the moment the Enforcer is dead, in lockup or in the hospital — which is how a rival
  // takes it off the board without touching the district at all.
  const enforcer = (!occupied && !defending && d.holder_gang)
    ? await postPower(client, d.holder_gang, 'enforcer') * M3.ROSTER_ENFORCER_GARRISON : 0;
  const coalition = !occupied && !defending && !!d.holder_gang
    && !!(await coalitionDiscountActive(client, gangId, d.holder_gang));
  // THE WATCH: a player-held district taken OUTSIDE the holder's declared window costs the surprise
  // premium. An NPC-occupied district has no watch to keep (outfits don't sleep) and an unheld one
  // has nobody to surprise, so both stay at the plain price.
  const surprise = (!occupied && !defending && d.holder_gang) ? watchMult(d) : 1;
  // THE MAP: turf is no longer a flat set of squares. One query reads who holds what, and geography
  // prices the door from both sides — the holder's CONTIGUOUS ground stiffens it (they can reinforce
  // across their own turf), and an attacker with a district NEXT DOOR gets a foothold discount. Both
  // are the attacker's price only, and both are zero on an unheld or NPC-occupied district — there is
  // no line to hold and nobody to reinforce. Multiplicative by the P9.20d finding (a flat add becomes
  // noise the moment a family is established).
  let contiguity = 1, foothold = 1;
  if (!occupied && !defending && d.holder_gang) {
    const nb = districtNeighbours(d.id);
    // One flat read + a JS filter, NOT `WHERE id = ANY($1)` — pg-mem returns ZERO ROWS for that
    // form (the recorded MY PROFILE quirk), which would silently make geography a no-op in every
    // suite while parsing fine on real Postgres. The whole table is six rows.
    const all = (await client.query('SELECT id, holder_gang FROM districts')).rows;
    const held = all.filter((x) => nb.includes(x.id) && x.holder_gang);
    contiguity = MAP.NEIGHBOUR_PREMIUM_MULT ** held.filter((x) => x.holder_gang === d.holder_gang).length;
    // ONE discount however many borders you share — a foothold, not a bonus for encirclement
    if (gangId && held.some((x) => x.holder_gang === gangId)) foothold = MAP.ADJACENT_MULT;
  }
  // THE RECKONING: in a season's last stretch held turf is CHEAPER to come for, so an incumbent who
  // has been sitting on it since week one has to defend it while the door is open. 1 the rest of the
  // time. Applied last so it discounts everything above it, and the discounted number is what is
  // charged AND what is ledgered (the decree/amnesty discipline).
  const reckoning = seasonFx('floorMult');
  // THE CHARTER: what the ATTACKING family is — the Outfit takes ground cheaper than anyone, the
  // Syndicate pays over the odds for it. A lockless read (this is a quote; nothing is written here —
  // the outfitStrengthFrac precedent), 1 for a family that hasn't chosen, and never the defender's:
  // a charter says what YOU are good at, not what your enemy is bad at.
  let charterMult = 1;
  if (gangId && !defending) {
    const me = (await client.query('SELECT charter FROM gangs WHERE id=$1', [gangId])).rows[0];
    charterMult = charterFx(me?.charter, 'turfMult');
  }
  const cost = Math.floor((base + sovBonus + premium + enforcer)
    * (coalition ? DIPLOMACY.COALITION_SEIZE_MULT : 1) * surprise * contiguity * foothold * reckoning * charterMult);
  return { occupied, defending, base, premium, sovBonus, enforcer, coalition, surprise, contiguity, foothold, reckoning, charterMult, cost };
}

const contestLive = (d, at = Date.now()) => !!d.contest_until && new Date(d.contest_until).getTime() > at;

export async function seizeDistrict(ch, districtId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss seizes turf.');
  if (!DISTRICTS.find((d) => d.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (d.holder_gang === h.owned.gangId) throw new GameError('held', 'You already hold that district.');
  // THE SEALED BID: turf ANOTHER FAMILY holds is no longer purchasable at a published price — it
  // changes hands through the sealed contest (stakeClaim). The two CANNOT coexist on the same
  // district: if a buyout is available at price P, nobody bids above P and the contest is theatre.
  if (d.holder_gang)
    throw new GameError('contested', 'That district belongs to a family. You take it by staking a claim — a sealed contest — not by buying it.');
  // A live contest also freezes an UNHELD district: the incumbent can dissolve mid-window, and
  // without this a family that had already staked could be undercut by an outright claim at the
  // base price the moment that happened.
  if (contestLive(d))
    throw new GameError('contested', 'A contest is already running on that district — stake a claim.');
  const { occupied, base, premium, cost } = await turfQuote(client, ch, d, h.owned.gangId);
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (Number(g.treasury) < cost)
    throw new GameError('treasury', occupied
      ? `Liberating that district from ${worldNpcOf(d.npc_holder)?.name || 'the occupiers'} takes ${usd(cost)} from the treasury (beat the outfit down to cheapen it).`
      : `Seizing that district takes ${usd(cost)} from the treasury${premium ? ` (${usd(premium)} of it the war premium on its operation)` : ''}.`);
  // the garrison burns — turf costs the family real money (§10.4 sink); only the garrison part becomes the
  // new defense budget (the premium burned taking the operation). Liberation clears the NPC occupier.
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, cost]);
  // …and the watch is cleared with the turf here too (the resolveContest rule, which said it and
  // then only applied it on one of the three paths ground can change hands): an inherited hour is a
  // window your ENEMY chose, published on the board, at a time you are probably not online for.
  await client.query('UPDATE districts SET holder_gang=$2, npc_holder=NULL, garrison=$3, seized_at=$4, watch_hour=NULL WHERE id=$1', [districtId, h.owned.gangId, base, now()]);
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

// ── THE SEALED BID (the strategy package's SIMULTANEOUS DECISION) ──
// Commit a SECRET stake from the treasury on a district a family holds. Everyone in the contest
// moves at once and nobody sees another number until it closes; the highest commitment takes the
// district, the holder wins ties, and every loser forfeits CONTEST_LOSS_BPS of what they put up —
// which is what stops "always commit everything" from being the only line.
//
// The holder's stake is a DEFENCE and a rival's is a CLAIM; the meaning is derived from who holds
// the district, never passed in, so there is no way to declare yourself the defender.
export async function stakeClaim(ch, districtId, amount, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss stakes a claim.');
  if (!DISTRICTS.find((x) => x.id === districtId)) throw new GameError('bad_district', 'No such district.');
  const total = Math.floor(Number(amount));
  if (!Number.isFinite(total) || total <= 0) throw new GameError('amount', 'Name what you are putting up.');
  let d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  // A contest that has RUN OUT but not yet been swept is SETTLED here before a new one opens on the
  // same ground. This used to delete the stale bids instead, on the reasoning that a leftover row
  // would be free money for its owner — but a lapsed contest is not stale rows, it is other families'
  // ESCROW, and deleting it vaporized their money with no refund and no burn row: a silent theft and
  // a permanent drift in the `turf contest escrow` identity. The window is real (the contest expires
  // on its own clock, the sweep runs on the worker's), so any claim landing in between hit it. One
  // implementation settles it — the sweep's — and the district row is already locked, which is the
  // same mutex resolveContest takes, in the same districts → gangs order.
  if (d && d.contest_until && !contestLive(d)) {
    const settled = await settleContest(client, districtId);
    // the settlement is a public event whoever triggered it — the sweep would have said so, and a
    // district changing hands silently because a rival happened to walk in first reads as a bug
    if (settled?.emit) bus.emit('streets', settled.emit);
    d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  }
  if (!d.holder_gang) throw new GameError('not_contested', d.npc_holder
    ? 'An outfit garrisons that district — you liberate it outright, there is nobody to bargain with.'
    : 'Nobody holds that district. Take it outright.');
  const gangId = h.owned.gangId;
  const q = await turfQuote(client, ch, d, gangId);
  // The floor rides as DATA as well as prose (the district-refusal payload precedent). It is a price
  // the caller must meet exactly, and until now it existed only inside a sentence — so the only way to
  // act on it was to parse English, which the suite was doing in three places and an agent would have
  // had to do too. Formatting the figure for a player is what surfaced that: `$501,393` parses as 501.
  if (total < q.cost) throw new GameError('floor', `A stake on that district starts at ${usd(q.cost)}.`, { floor: q.cost });
  const nowMs = Date.now();
  const open = contestLive(d, nowMs);
  // THE RECKONING shortens the window, so several contests can land in a night and the map genuinely
  // turns over in the final week instead of settling in week one.
  const until = open ? new Date(d.contest_until) : new Date(nowMs + Math.round(M3.CONTEST_MS * seasonFx('contestMsMult')));
  // anything lapsed was settled at the top of this function, so a fresh window opens on an empty table
  if (!open) await client.query('UPDATE districts SET contest_until=$2 WHERE id=$1', [districtId, until]);
  const prior = Number((await client.query('SELECT amount FROM district_bids WHERE district_id=$1 AND gang_id=$2',
    [districtId, gangId])).rows[0]?.amount || 0);
  // a stake only ever goes UP — you cannot pull money out of a contest you are losing your nerve on
  if (total <= prior) throw new GameError('raise', `You already have ${usd(Math.floor(prior))} on that district. A stake only goes up.`);
  const delta = total - prior;
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (Number(g.treasury) < delta) throw new GameError('treasury', `Raising that stake takes ${usd(delta)} more from the treasury.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [gangId, delta]);
  if (prior) await client.query('UPDATE district_bids SET amount=$3, at=$4 WHERE district_id=$1 AND gang_id=$2', [districtId, gangId, total, now()]);
  else await client.query('INSERT INTO district_bids (district_id, gang_id, amount, at) VALUES ($1,$2,$3,$4)', [districtId, gangId, total, now()]);
  // treasury → escrow. The row sits in district_bids until the contest resolves; the `turf contest
  // escrow` §10.4 check reconciles the open pot against exactly this.
  await h.ledger(client, { currency: 'cash', amount: -delta, reason: 'turf:claim', counterparty: gangId });
  const families = Number((await client.query('SELECT COUNT(*) n FROM district_bids WHERE district_id=$1', [districtId])).rows[0].n);
  if (!open) bus.emit('streets', { type: 'contest', district: districtId, holder: (await client.query('SELECT name FROM gangs WHERE id=$1', [d.holder_gang])).rows[0]?.name });
  return { ok: true, district: districtId, staked: total, added: delta, floor: q.cost,
    defending: q.defending, families,
    resolvesSeconds: Math.max(0, Math.round((until.getTime() - nowMs) / 1000)),
    lossBps: M3.CONTEST_LOSS_BPS };
}

// The settlement itself, inside whatever transaction the caller is already running. TWO callers
// reach it — the worker's sweep and a challenger opening a fresh contest on ground whose last one
// lapsed unresolved — and they must not drift apart, so there is exactly one of these (the
// extortFront one-core lesson). It takes the district row lock itself; that is re-entrant for the
// claim path, which already holds it, and is the mutex for the sweep. Then every bidding gang in id
// order — the districts → gangs order seizeDistrict already establishes, so no new cycle.
//
// Returns null if there is nothing to settle (no district, or its window is still open).
export async function settleContest(client, districtId) {
  const d = (await client.query('SELECT * FROM districts WHERE id=$1 FOR UPDATE', [districtId])).rows[0];
  if (!d || contestLive(d)) return null;
  const bids = (await client.query('SELECT * FROM district_bids WHERE district_id=$1 ORDER BY gang_id', [districtId])).rows;
  if (!bids.length) {
    await client.query('UPDATE districts SET contest_until=NULL WHERE id=$1', [districtId]);
    return { district: districtId, bids: 0, emit: null };
  }
  const live = new Map();
  for (const b of bids) {
    const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [b.gang_id])).rows[0];
    if (g) live.set(b.gang_id, g);
  }
  // Highest commitment wins. The DEFENDER takes a tie — you have to beat a family off its own
  // turf, not merely match it. A family that dissolved mid-contest cannot win what it can no
  // longer hold; its stake burns (the dead-funder precedent) and is scanned past here.
  let win = null;
  for (const b of bids) {
    if (!live.has(b.gang_id)) continue;
    if (!win) { win = b; continue; }
    const a = Number(b.amount), w = Number(win.amount);
    if (a > w || (a === w && b.gang_id === d.holder_gang)) win = b;
  }
  const results = [];
  for (const b of bids) {
    const amt = Number(b.amount);
    const alive = live.get(b.gang_id);
    if (win && b.gang_id === win.gang_id) {
      // the winner's whole stake burns into the garrison — the seizure price, paid in advance
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'turf:claim:burn', counterparty: b.gang_id });
      results.push({ gangId: b.gang_id, staked: amt, won: true, back: 0 });
      continue;
    }
    if (!alive) {
      await ledger(client, { currency: 'cash', amount: -amt, reason: 'turf:claim:burn', counterparty: b.gang_id });
      results.push({ gangId: b.gang_id, staked: amt, won: false, back: 0, dissolved: true });
      continue;
    }
    // THE CHARTER: what a losing stake forfeits is the loser's OWN business — the Fixers hedge in
    // ways that cost them more when the hedge fails. Clamped under 10000 so a stake can never
    // forfeit more than itself, and the escrow identity holds either way (refund + burn == stake).
    const lossBps = Math.min(9999, Math.round(M3.CONTEST_LOSS_BPS * charterFx(alive.charter, 'contestLossMult')));
    const back = Math.floor(amt * (10000 - lossBps) / 10000);
    const burn = amt - back;
    if (back > 0) {
      await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [b.gang_id, back]);
      await ledger(client, { currency: 'cash', amount: back, reason: 'turf:claim:refund', counterparty: b.gang_id });
    }
    if (burn > 0) await ledger(client, { currency: 'cash', amount: -burn, reason: 'turf:claim:burn', counterparty: b.gang_id });
    results.push({ gangId: b.gang_id, staked: amt, won: false, back });
  }
  const winAmt = win ? Number(win.amount) : 0;
  const changed = !!win && win.gang_id !== d.holder_gang;
  // WHAT THE GROUND IS WORTH TO HOLD, not a receipt. The winning stake becomes the garrison, and a
  // stake only has to clear turfQuote's cost — which is the outbid price times every discount that
  // happened to apply to that attacker at that moment (a coalition against a hegemon, a foothold next
  // door, the reckoning, an Outfit charter). Stored raw, those discounts stopped pricing the CONQUEST
  // and became the DISTRICT's standing value: the next attacker's floor is computed from this number,
  // so a chain of favourable conquests walked the price down. Floored at what it was worth before, so
  // a discount stays the one-time reward it was written to be — you paid less for the same ground, and
  // your enemies do not inherit your bargain. A stake ABOVE the old garrison still counts in full, so
  // a hard-fought district keeps every dollar of what it took to win it.
  const heldGarrison = Math.max(winAmt, Number(d.garrison) || 0);
  if (changed) {
    // The watch is cleared with the turf: the new holder declares their own hour.
    await client.query('UPDATE districts SET holder_gang=$2, npc_holder=NULL, garrison=$3, seized_at=$4, watch_hour=NULL, contest_until=NULL WHERE id=$1',
      [districtId, win.gang_id, heldGarrison, now()]);
    await seizeTerritoryRackets(client, districtId, win.gang_id);
    await razeSov(client, districtId);
  } else if (win) {
    // the holder held it — what they put up becomes the new garrison (they reinforced). A defender is
    // never discounted, so their stake always clears the old garrison and the floor is a no-op here.
    await client.query('UPDATE districts SET garrison=$2, contest_until=NULL WHERE id=$1', [districtId, heldGarrison]);
  } else {
    await client.query('UPDATE districts SET contest_until=NULL WHERE id=$1', [districtId]);
  }
  await client.query('DELETE FROM district_bids WHERE district_id=$1', [districtId]);
  const winner = win ? live.get(win.gang_id) : null;
  for (const r of results) {
    if (r.dissolved) continue;
    const members = (await client.query('SELECT character_id FROM gang_members WHERE gang_id=$1', [r.gangId])).rows;
    for (const m of members) {
      await notify(client, m.character_id, 'contest_resolved',
        { district: districtId, won: r.won, staked: r.staked, back: r.back, winner: winner?.name || null });
    }
  }
  // the caller owns the transaction, so the feed line rides back as data and is emitted AFTER the
  // commit — a streets event for a settlement that then rolled back is a lie nobody can retract
  const emit = changed ? { type: 'seize', district: districtId, gang: winner?.name, contested: true }
    : win ? { type: 'held', district: districtId, gang: winner?.name } : null;
  return { district: districtId, bids: bids.length, winner: win?.gang_id || null, amount: winAmt, changed, emit };
}

// The worker's wrapper: one transaction per district.
export async function resolveContest(pool, districtId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await settleContest(client, districtId);
    if (!out) { await client.query('ROLLBACK'); return null; }
    await client.query('COMMIT');
    if (out.emit) bus.emit('streets', out.emit);
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already gone */ }
    throw e;
  } finally { client.release(); }
}

export async function sweepContests(pool) {
  const due = (await pool.query('SELECT id FROM districts WHERE contest_until IS NOT NULL AND contest_until <= $1', [now()])).rows;
  let resolved = 0, seized = 0;
  for (const r of due) {
    // per-district transaction: one poison district must not stall the rest (the auction-sweep rule)
    try {
      const res = await resolveContest(pool, r.id);
      if (res) { resolved++; if (res.changed) seized++; }
    } catch (e) { console.error('contest sweep', r.id, e.message); }
  }
  return { resolved, seized };
}

// ═══════════════════ JUMPS (§7.6) ═══════════════════
