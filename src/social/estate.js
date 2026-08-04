// Death — the estate, the grudges it settles, and the blood feuds it swears.
//
// runEstate is the most consequential function in the game: it wipes ~35 character-scoped
// tables, carries the account-level legends that survive, refunds still-exclusive contract pots,
// and hands the bloodline to an heir. It is isolated here so that changing anything else in the
// PvP layer cannot touch it by accident.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bus, ledger, notify, npcTier, bumpStanding } from '../game.js';
import { rememberedSkills } from '../skills.js';
import { M3, LOAN, levelOf, dayOf, VENDETTA, feudTierOf, UNDERWORLD, LAW, MASTERY, tickerPriceOf, estateTierOf, HONOR, seasonModOf } from '../rules.js';
import { abandonRaidsAtDeath } from '../world.js';
import { voidListingsAtDeath, burnBidsAtDeath } from '../market.js';
import { voidLoansAtDeath } from '../loans.js';
import { voidFavorsAtDeath } from '../favors.js';
import { wipeSpeakeasyAtDeath } from '../speakeasy.js';
import { wipeRingAtDeath } from '../ring.js';
import { wipeFighterAtDeath, cancelMainEventsAtDeath } from '../boxing.js';
import { recordDeath } from '../bloodline.js';
import { checkScandal } from '../dynasty.js';
import { fire, huntWanted, npcHit } from './combat.js';
import { claimBounty, postBounty, refundPot } from './contracts.js';
import { bodyguardAbsorbs } from './defense.js';
import { removeMember } from './gangs.js';
import { now, uid } from './shared.js';

// Every fixture the victim was a REAL friend of (effective standing ≥ GRUDGE_MIN) docks the
// killer GRUDGE_LOSS — whacking a connected man burns your own bridges. Shared by the player
// kill (fire) and the arranged one (npcHit — the payer wears it); mod-kills have no killer and
// bear no grudge. Step four gives the grudge TEETH: an `npc_grudges` row (count > 0) caps the
// killer's tier with that fixture (game.js npcTier) until squared by penance. Absolute count
// writes (read-then-write) — pg-mem mis-evaluates arithmetic UPDATEs on INT columns.
// Returns the fixture ids that now hold one.
export async function bearGrudges(client, h, killerCh, victimNpc) {
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

// ═══════════════════ DEATH — THE ESTATE (§7.9, atomic) ═══════════════════
// The street dies: character row closed, possessions wiped, gang seat vacated,
// bounty cleared. The account survives: $OMR, staked, rewards, wallet, gear,
// prestige (+floor(level/2)), recruits, onboard, checkins, deaths+1. The heir
// row starts at generation+1 with the legacy stake.

// Rows OTHER players/families created ABOUT this character — pointers that must die when the
// character LEAVES PLAY, whether by DEATH (runEstate) or RETIREMENT (a walked NPC resident, which
// runEstate never sees). The two paths used to diverge here (retireResident cleaned up only the rows
// the resident OWNED), stranding a hired bodyguard's principal, a watcher's tap slot, and more — one
// shared helper so the retirement path can't drift from the death path again (AUDIT-street-war-street-
// life F1/F2/F4). Deliberately NOT bounty escrow: a gone target's pots resolve via the expiry sweep
// (a refund), which is fairer than a death-burn for a retirement, and stays §10.4-exact either way.
export async function clearInboundPointers(client, charId, accountId) {
  // a paid bodyguard whose principal is this character: released — and the stale pointer no longer
  // BLOCKS the principal hiring a replacement for the rest of the window (paid, unprotected, locked
  // out — the audit-F8 class). A killer who hired their own victim as guard is mirrored in memory by
  // the CALLER (persistCharacter would clobber a direct SQL update to the killer's own row).
  await client.query('UPDATE characters SET guarded_by=NULL, guarded_until=NULL WHERE guarded_by=$1', [charId]);
  // wire surveillance pointed at this character: a dead/gone TARGET frees the watcher's concurrency
  // slot (with no untap route otherwise); a dead WATCHER's rows are dead-code hygiene.
  await client.query('DELETE FROM wiretaps WHERE watcher_character=$1 OR target_character=$1', [charId]);
  await client.query('DELETE FROM wire_watches WHERE watcher_character=$1 OR target_character=$1', [charId]);
  await client.query('DELETE FROM wire_informants WHERE watcher_character=$1 OR target_character=$1', [charId]);
  // a pending family retaliation on a gone raider (THE MANHUNT); a hunter's search on a gone target
  await client.query('DELETE FROM family_aggro WHERE target_character=$1', [charId]);
  await client.query('DELETE FROM searches WHERE hunter=$1 OR target=$1', [charId]);
  // secrets die with the spy (holder) AND with the mark (dirt on the gone is worthless); digs
  // TARGETING the account persist as a bloodline throttle (the 7-day hygiene sweep reaps them).
  await client.query('DELETE FROM secrets WHERE holder_character=$1 OR target_account=$2', [charId, accountId]);
  // per-(payer,target) NPC-hit cooldown rows both ways — harmless hygiene, no orphans left behind
  await client.query('DELETE FROM npc_hits WHERE payer=$1 OR target=$1', [charId]);
}

export async function runEstate(client, h, victim, killerName, opts = {}) {
  const acct = h.victimAcct;
  const lvl = levelOf(Number(victim.respect));
  const legacy = Math.floor(lvl / 2);
  const priorPrestige = Number(acct.prestige);  // muscle memory reads the bloodline's ACCUMULATED prestige (pre-death) — a fresh line's skills still fully die
  acct.prestige = Number(acct.prestige) + legacy;
  acct.deaths = Number(acct.deaths) + 1;
  // L2a — THE DEATH DUTY (stakes/spine review #2): the account-level wealth survives death, so dying cost
  // the established dynasty almost nothing. A succession tax burns DEATH_DUTY_RATE of the heir's inherited
  // EXTRACTABLE $OMR — liquid PLUS unbonding principal, the exact base the sibling P1.1 whack:loot
  // takes (a red-team flag: taxing liquid only let a dynasty shelter its hoard from the duty by dying
  // inside the 6h unbond window). Staked $OMR / the RWA portfolio / the estate stay safe harbours —
  // untouched — so death costs the bloodline its extractable hoard, never what it committed. A §10.4
  // $OMR BURN (`death:duty`); runs on EVERY death path (a respawn-token save skips the estate entirely
  // → no duty). Liquid is drained first (the loot ordering). acct.omr/unbonding are persisted by
  // persistAccount at the end of the wrapper (the whack:loot $OMR precedent); the two hand-rolled
  // headless persists (mod-kill, huntWanted) carry both columns for the same reason.
  const dutyLiquid = Number(acct.omr), dutyUnbond = Number(acct.unbonding || 0);
  const deathDuty = Math.floor((dutyLiquid + dutyUnbond) * (M3.DEATH_DUTY_RATE || 0));
  if (deathDuty > 0) {
    const fromLiquid = Math.min(dutyLiquid, deathDuty);
    acct.omr = dutyLiquid - fromLiquid;
    if (deathDuty > fromLiquid) acct.unbonding = dutyUnbond - (deathDuty - fromLiquid);
    await h.ledger(client, { accountId: victim.account_id, currency: 'omr', amount: -deathDuty, reason: 'death:duty' });
  }

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

  // FIVE PILLARS #5 — THE BLOODLINE: every generation gets its line in the family book (account-level,
  // written BEFORE the wipe, idempotent per generation — the ancestral hall + dynasty score read it).
  await recordDeath(client, victim, {
    cause: killerName, level: lvl, kills: Number(victim.season_kills || 0), honor: Number(victim.honor || 0) });
  // THE SCANDAL (dynastic marriage) — a direct player kill on your IN-LAW: the marriage dissolves and
  // the killer eats MARRIAGE.SCANDAL honor. Runs under the killer's held char lock (fire/shank/npc-hit
  // all pass killerCh); mod-kills and NPC hunters carry no killer → no scandal. Never a kill-BLOCK.
  const scandal = opts.killerCh ? await checkScandal(client, opts.killerCh, victim) : null;
  if (scandal) report.scandal = scandal;

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
  // THE TRADES (bloodline echo — founder rule 2026-07-29): mastery levels die with the street, but
  // the heir inherits HEIR_KEEP_BPS (25%) of each track's XP — the npc-memory/honor echo shape.
  // Read from h.victimOwned.mastery BEFORE the masteries wipe below; sub-1 remainders forgotten;
  // the account-level mastery_legend survives whole by construction (never touched here). Dial 0
  // restores the hard rule. Pure status — XP is not a currency, zero §10.4 surface.
  // The DYNAST trait (step two, read BEFORE character_traits is wiped below) deepens that one
  // trade's echo to TRAIT_HEIR_BPS — the legacy half of the level-50 choice.
  const echoedMastery = Object.entries(h.victimOwned.mastery || {})
    .map(([t, xp]) => ({ t, xp: Math.floor(Number(xp)
      * (h.victimOwned.traits?.[t] === 'dynast' ? MASTERY.TRAIT_HEIR_BPS : MASTERY.HEIR_KEEP_BPS) / 10000) }))
    .filter((r) => r.xp >= 1);
  // port_intercepts keys on (boat_id, pirate character_id): the loop below wipes the dead PIRATE's
  // attempts (character_id), but rows keyed on a dead RUNNER's boats would orphan once `boats` is
  // deleted — so sweep them by the runner's boats FIRST (before the loop removes the boats). Pure
  // row-hygiene (boat_id never re-collides), the npc_hits both-sides precedent.
  await client.query('DELETE FROM port_intercepts WHERE boat_id IN (SELECT id FROM boats WHERE character_id=$1)', [victim.id]);
  // territory step five: a dead made-man can't keep running an operation — clear their specialist post,
  // so the family's rackets don't keep his (snapshot) fortitude/scrutiny bonus after he's gone (RED-TEAM
  // fix: the passive bonus is a snapshot, so a dead specialist would otherwise buff forever).
  await client.query('UPDATE territory_rackets SET specialist=NULL, spec_power=0 WHERE specialist=$1', [victim.id]);
  // THE RARITY NFTs (v3 step 7) — cars and boats are pulled OUT of the blanket wipe: an EXTRACTED
  // one is an ERC-1155 the player already holds in their own wallet, so destroying the row would
  // leave the token pointing at nothing and break the half of the bargain they paid for ("safe but
  // inert"). Everything still in play dies exactly as before; the survivors are re-pointed at the
  // heir after the INSERT below. The invariant needs no change either way — the rows persist, so
  // `car conservation` still counts them, and `lost.cars` reads the loadOwned-FILTERED fleet, which
  // is the same set this DELETE takes.
  for (const t of ['cars', 'boats'])
    await client.query(`DELETE FROM ${t} WHERE character_id=$1 AND NOT minted_onchain`, [victim.id]);
  for (const table of ['rigs', 'character_rackets', 'character_assets', 'character_cargo', 'character_items', 'character_guns', 'makings', 'stash', 'batches', 'businesses', 'numbers_tickets', 'fight_bets', 'track_bets', 'racers', 'blackjack_hands', 'crew_heist_members', 'pen_break_members', 'world_raid_members', 'character_skills', 'npc_standing', 'npc_leads', 'npc_grudges', 'npc_favors', 'npc_errands', 'npc_gain', 'pen_contraband', 'convoy_ambushes', 'port_intercepts', 'route_notoriety', 'daily_progress', 'missions_done', 'wage_snapshots', 'campaign_progress', 'soldiers', 'digs', 'clue_scrolls', 'masteries', 'character_traits', 'character_disciplines', 'npc_drills', 'hustles', 'pen_talks', 'corner_jobs', 'corner_chains', 'contact_calls'])
    await client.query(`DELETE FROM ${table} WHERE character_id=$1`, [victim.id]);
  // (npc_hits, wiretaps, family_aggro, searches, secrets, the bodyguard pointer — all rows OTHERS
  // pointed at this street — are cleared by clearInboundPointers below, shared with retireResident.)
  // (AUDIT-street-life F5) a pending contact call FROM the dead street (npc_character side — the
  // loop above wipes only the character_id side) dies with them: the caller is gone, so the call
  // would only jam the other player's one-open-call slot until the TTL sweep.
  await client.query('DELETE FROM contact_calls WHERE npc_character=$1', [victim.id]);
  // World step three: a dead co-op raid leader's plan is abandoned so the crew can recrew (the
  // crew_heists precedent — the member rows above are already wiped; this frees the leadership).
  // (R42) notify the stranded crew like the heist/break paths do — capture them BEFORE the abandon
  // deletes their rows, so a dead leader's raiders hear about it instead of finding an empty board.
  const raidOrphans = (await client.query(
    `SELECT m.character_id FROM world_raids wr JOIN world_raid_members m ON m.raid_id = wr.id
      WHERE wr.leader_character=$1 AND wr.status='planning' AND m.character_id != $1`, [victim.id])).rows;
  await abandonRaidsAtDeath(client, victim.id);
  for (const o of raidOrphans) await h.notify(client, o.character_id, 'raid_abandoned', { reason: 'leader_dead' });
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
  // rows OTHERS pointed at this street — the bodyguard principal, wire taps/watches/informants,
  // family aggro, hunter searches, secrets, npc-hit cooldowns — all die with the man, through the
  // helper shared with retireResident (so the retirement path can't drift). The killer-as-principal
  // in-memory mirror follows the loot block below.
  await clearInboundPointers(client, victim.id, victim.account_id);
  // a dead proprietor's club goes dark (+ its guest list); the man's patronage at other clubs clears too
  await wipeSpeakeasyAtDeath(client, victim.id);
  // RING POKER: fold the dead player's seat + BURN their stack (casino:ring:death — the dead-funder
  // rule; their chips already in a live pot ride to whoever wins the hand, escrow-conserving)
  await wipeRingAtDeath(client, victim.id, h);
  // (boxing step three) a dead manager's booked MAIN EVENTS are cancelled — the crowd is refunded (dead
  // bettors burn) BEFORE the fighters are deleted; the killer, if they bet this card, is mirrored in memory
  await cancelMainEventsAtDeath(client, victim.id, opts.killerCh);
  await wipeFighterAtDeath(client, victim.id);
  // a dead shipper's freight is scattered on the highway — goods die with the street
  await client.query("DELETE FROM convoy_cargo WHERE convoy_id IN (SELECT id FROM convoys WHERE owner_character=$1)", [victim.id]);
  await client.query("UPDATE convoys SET status='lost' WHERE owner_character=$1 AND status IN ('loading','transit')", [victim.id]);
  // clearInboundPointers (above) released the dead guard's principals in SQL; one principal may be
  // IN-MEMORY in THIS txn — the killer, if they'd hired their own victim as guard (betrayal beats
  // protection) — mirror the clear or persistCharacter clobbers the SQL update back to the dead guard.
  if (opts.killerCh && opts.killerCh.guarded_by === victim.id) {
    opts.killerCh.guarded_by = null; opts.killerCh.guarded_until = null;
  }
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
  await client.query('DELETE FROM bounty_gang_roster WHERE target_character=$1', [victim.id]);
  // …and any DIRECTED pot that named the DECEASED as its exclusive hitman (on a LIVING mark) OPENS to
  // all claimers — otherwise `claimBounty` skips a hospitalize pot in its window for anyone but the named
  // hitman, so a dead man's contract would lock the pot (and `postBounty` blocks re-naming) for up to
  // DIRECTED_MAX_H, handing the mark a free hospitalize-immunity window (RED-TEAM: the specialist
  // dangling-pointer sibling — a dead character can't hold an exclusive claim). §10.4-neutral (the escrow
  // stays; only the exclusivity pointer clears — kill pots already pay any killer, this fixes hospitalize).
  await client.query('UPDATE bounties SET hitman=NULL, opens_at=NULL WHERE hitman=$1', [victim.id]);
  // Exchange escrow forfeits with the man (v24 rule) — bucket rows keep cb/ammo conservation exact
  // (red-team R18) lock the seller's listing rows BEFORE the SUM — the bounty-pot FOR-UPDATE-before-SUM
  // precedent. Today this is incidentally safe (every listings mutation holds the seller char lock the
  // estate already holds), but an explicit lock makes the cb/ammo death:escrow burn robust to any future
  // path that touches a listings row without that char lock (else SUM-then-DELETE could strand/double it).
  await client.query("SELECT 1 FROM listings WHERE seller_character=$1 AND item_kind IN ('cb','ammo') FOR UPDATE", [victim.id]);
  const escrowed = (await client.query("SELECT item_kind, SUM(qty) q FROM listings WHERE seller_character=$1 AND item_kind IN ('cb','ammo') GROUP BY item_kind", [victim.id])).rows;
  for (const e of escrowed)
    await h.ledger(client, { currency: e.item_kind, amount: -Number(e.q), reason: 'death:escrow', counterparty: victim.id });
  await client.query('DELETE FROM listings WHERE seller_character=$1', [victim.id]);
  // Black Market: the dead man's LISTINGS void with standing bids refunded (a killer who held
  // the bid takes it in-memory via killerCh — the refundPot discipline, no persist clobber);
  // his own standing BIDS burn (the dead-funder precedent) and those auctions reopen.
  // audit #1: a PLAYER fire-kill (opts.loot) loots CASH_LOOT_RATE of the victim's live order
  // escrow to the killer — parked liquid is no longer a loot-proof vault. NPC/mod kills pass 0.
  // (red-team) the seasonal lootMult covers EVERY fire-kill loot surface — escrow legs included; the
  // BLOOD OATH decree mult (threaded from fire) rides the SAME clamp so the escrow legs match the pocket loot.
  const estateLootRate = opts.loot ? Math.min(0.5, M3.CASH_LOOT_RATE * (seasonModOf().lootMult || 1) * (opts.bloodOathMult || 1)) : 0;
  const mkt = await voidListingsAtDeath(client, victim.id, opts.killerCh, estateLootRate);
  if (opts.killerCh && mkt.selfRefund) opts.killerCh.cash = Number(opts.killerCh.cash) + mkt.selfRefund;
  await burnBidsAtDeath(client, victim.id);
  // the heir id (generated early so the lender-death loan claim can pass to it below — the debt survives)
  const heirId = uid();
  // LOAN SHARKING: a PLAYER fire-kill (opts.loot) loots CASH_LOOT_RATE of the dead lender's OPEN-offer
  // escrow to the killer (parked capital is no longer a loot-proof vault, the market-order precedent);
  // the rest burns (loan:death). An active loan the DEAD LENDER made passes to the HEIR (the debt
  // survives — SIGN-OFF Tier 4, §10.4-neutral); a debt owed BY the dead borrower is uncollectable.
  const ln = await voidLoansAtDeath(client, victim.id, h, opts.killerCh, estateLootRate, heirId);
  if (opts.killerCh && ln.looted) report.loanLoot = ln.looted;
  // THE FAVOR: a dead poster's open escrow is the same loot surface as a market order or a loan
  // offer — a PLAYER fire-kill takes its share, the rest burns (never a loot-proof vault).
  const fv = await voidFavorsAtDeath(client, victim.id, opts.killerCh, estateLootRate);
  if (opts.killerCh && fv.looted) report.favorLoot = fv.looted;
  if (h.victimOwned.gangId) await removeMember(client, h.victimOwned.gangId, victim.id);

  victim.alive = false;
  await client.query('UPDATE characters SET alive=false, cash=0, bank=0, cb=0, ammo=0, gun=NULL, vest=NULL WHERE id=$1', [victim.id]);

  // the heir — same name (the bloodline), next generation, legacy stake (heirId generated above)
  const stake = 500 + 100 * Number(acct.prestige);
  // the bloodline stays "made" — a paid mint (§11) carries down the estate to the heir
  // THE POPULATION: the heir inherits `is_npc`. A killed resident's line continues as a resident —
  // that IS the respawn, which is why the estate needs no NPC branch at all. Without carrying the
  // flag the heir would be born a "player": headcount would never self-heal, and every real-player
  // count (ops, the onboarding funnel) would quietly start counting scenery.
  // (red-team, THE TURNOVER) …and with it the arrival stake, which is what lets the worker tell a
  // resident players have picked clean from one who was born poor. Backfilling it lazily on the
  // heir's first worker turn left a window — up to a full sweep of the city — in which a player
  // could drain the heir first, so the backfill would record the DRAINED cash as their stake and
  // that resident could never be recycled. The stake is known here; record it here.
  await client.query(
    'INSERT INTO characters (id, account_id, name, generation, season, cash, minted, honor, is_npc, npc_seed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [heirId, victim.account_id, victim.name, Number(victim.generation) + 1, Math.floor(dayOf() / 28), stake, !!acct.minted,
     // FIVE PILLARS #1: the honor ECHO — identity shadows the name at a quarter strength (the
     // npc-memory precedent; a Mad Dog's heir starts under the cloud, a Man of Honor's with a nod)
     Math.round(Number(victim.honor || 0) * HONOR.HEIR_KEEP), !!victim.is_npc, victim.is_npc ? stake : 0]);
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
  // THE TRADES echo — the heir is born a quarter-schooled in the bloodline's trades
  for (const m of echoedMastery)
    await client.query('INSERT INTO masteries (character_id, track_id, xp) VALUES ($1,$2,$3)', [heirId, m.t, m.xp]);
  report.kept.masteries = echoedMastery.length;
  // …and the extracted property follows the name. Not a mercy — it is what extraction BOUGHT, and
  // the reason a player would give up a car that races for one that only sits in a wallet.
  const keptCars = (await client.query('UPDATE cars SET character_id=$2 WHERE character_id=$1 AND minted_onchain', [victim.id, heirId])).rowCount;
  const keptBoats = (await client.query('UPDATE boats SET character_id=$2 WHERE character_id=$1 AND minted_onchain', [victim.id, heirId])).rowCount;
  report.kept.nft = Number(keptCars || 0) + Number(keptBoats || 0);
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
