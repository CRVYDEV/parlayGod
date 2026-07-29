// Violence — jumps, the search, the shot, NPC hits, the hunter, and busting.
//
// The top of the layering: this file reaches DOWN into contracts (a kill pays the pot), defense
// (a bodyguard absorbs it), the estate (the body) and families (war scoring), and nothing reaches
// back up into it.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bumpFamilyTask, bus, ledger, notify, track, loadOwned, skillMult, npcMult, npcTier, bumpStanding, bumpMastery } from '../game.js';
import { M3, CONSTANTS, LOAN, levelOf, rankIdxOf, cityEventOf, dayOf, btkOf, gunObjOf, vestMultOf, fleetValue, effStat, npcHitmanOf, VENDETTA, COMMISSION, SKILLS, UNDERWORLD, LAW, PORT, witproActive, penSafe, inHole, HONOR, HEIST_LOOT_RATE, BUSINESSES, seasonModOf } from '../rules.js';
import { activeDecree } from '../commission.js';
import { bumpHonor } from '../honor.js';
import { awardHitmanRep, claimBounty, postBounty, postFamilyContract, refundPot } from './contracts.js';
import { bodyguardAbsorbs } from './defense.js';
import { bearGrudges, runEstate } from './estate.js';
import { resolveWarIfDue } from './gangs.js';
import { hospitalized, isWanted, jailed, now, rand, safeHoused, warActive } from './shared.js';

// ═══════════════════ JUMPS (§7.6) ═══════════════════
export async function jump(ch, victim, client, h, intent) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't throw hands while you're to ground — a safehouse is a shield, not a bunker.");
  if (witproActive(ch)) throw new GameError('witpro', "You're in protective custody — the marshals didn't relocate you to work rivals. (witpro is a shield, not a free-kill window.)");
  // (R40 gate-matrix) a HOSPITALIZED actor can't launch offense — the symmetric action-lock every offense
  // sibling enforces (shakedownBusiness/standoverSpeakeasy/ambushConvoy/interceptRun/raidRivalRacket/raidNpc/
  // collectLoan + consensual PvP raceChallenge/fightBout/matchRace all gate `hosp_self`). Without it, `heal`
  // restores health=100 without clearing hosp_until, so the JUMP_MIN_HEALTH gate below is bypassable and a
  // laid-up player mugs/kills while still under the Doc's care — yet is itself untargetable (the victim gate).
  // A founder who wants hospitalized retaliation reverts this one line.
  if (hospitalized(ch)) throw new GameError('hosp_self', "You're in no shape for a fight — laid up under the Doc's care.");
  if (Number(ch.health) < M3.JUMP_MIN_HEALTH) throw new GameError('health', "You're in no shape for a fight.");
  // D6a step two — THE MESSAGE: what you came for (money vs reputation). An omitted/unknown intent
  // resolves to 'standard' (all mults 1.0), byte-identical to the pre-choice jump. Resolved HERE (above
  // the energy gate) because the intent prices its own energy: `message` costs 1.5× so its 1.5× rep and
  // 1.5× hospital blanket are rate-neutral per ENERGY too, not just per mark-clock (the red-team flag).
  const it = M3.JUMP_INTENTS[intent] || M3.JUMP_INTENTS.standard;
  const energyCost = Math.max(1, Math.round(M3.JUMP_ENERGY * (it.energyMult ?? 1)));
  if (Number(ch.energy) < energyCost) throw new GameError('energy', `Need ${energyCost} energy for that.`);
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
  ch.energy = Number(ch.energy) - energyCost;
  ch.ammo = Number(ch.ammo) - M3.JUMP_AMMO;
  // a public beating is noisy whether you win or lose — the Law hears about it either way (the
  // Go Loud precedent). Clamped [0,100] like every other heat bump.
  if (it.heat) ch.heat = Math.min(100, Number(ch.heat || 0) + it.heat);
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
    // THE MESSAGE folds in here: the steal is a pure TRANSFER (still capped by JUMP_STEAL_CAP, so
    // rolling them can never mint), rep is status, damage/hospital is pacing — zero §10.4 surface.
    const stealPct = ((war ? 0.25 : 0.15) + (ev.stealAdd || 0)) * it.stealMult;
    const stolen = Math.min(Math.floor(Number(victim.cash) * stealPct), M3.JUMP_STEAL_CAP);
    const crates = Math.min(Number(victim.cb) || 0, rand(1, 3));
    const rival = !!(h.victimOwned.gangId && h.owned.gangId && h.victimOwned.gangId !== h.owned.gangId);
    let rep = Math.max(3, Math.floor(Number(victim.respect) * 0.01 * (rival ? 1.5 : 1))) + (rival ? 2 : 0);
    if (war) rep *= 2;
    rep = Math.max(1, Math.floor(rep * (ev.jumpRep || 1) * it.repMult));
    const dmg = Math.max(1, Math.round(rand(20, 40) * it.dmgMult));

    ch.cash = Number(ch.cash) + stolen; ch.cb = (Number(ch.cb) || 0) + crates; ch.respect = Number(ch.respect) + rep;
    victim.cash = Number(victim.cash) - stolen; victim.cb = (Number(victim.cb) || 0) - crates;
    victim.health = Math.max(1, Number(victim.health) - dmg);
    // NOTE the hospital is PROTECTION in this game (a laid-up mark is untargetable), so a longer
    // stay from 'message' shields them from you too — the flex is self-limiting by design.
    const hospMs = Math.round(M3.JUMP_HOSP_MS * it.hospMult);
    victim.hosp_until = new Date(Date.now() + hospMs);
    if (stolen > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: stolen, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cash', amount: -stolen, reason: 'jump:stolen', counterparty: ch.id });
    }
    if (crates > 0) {
      await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: 'jump:steal', counterparty: victim.id });
      await h.ledger(client, { characterId: victim.id, currency: 'cb', amount: -crates, reason: 'jump:stolen', counterparty: ch.id });
    }
    // R22/R23 lock order: claim the victim's bounty pot BEFORE the war-score gang UPDATE — the
    // canonical characters → pots → gangs order that fire (claimBounty then war-score) and
    // postFamilyContract/refundPot all follow. Doing the gang UPDATE first inverted it (gangs → pot)
    // and AB-BA'd vs a concurrent fire/postFamilyContract on the same warring victim (retry-masked).
    const { total: bounty } = await claimBounty(client, h, ch, victim.id, ['hospitalize']); // a jump only fulfils hospitalize contracts
    if (war) {
      // both score updates in ONE statement (the fire-kill pattern) — two separate "my gang first"
      // UPDATEs acquire the rows unsorted, so simultaneous cross-jumps between the two warring
      // families AB-BA deadlock on real Postgres (invisible on pg-mem).
      await client.query(
        `UPDATE gangs SET war_score_us = war_score_us + CASE WHEN id=$1 THEN 1 ELSE 0 END,
                          war_score_them = war_score_them + CASE WHEN id=$2 THEN 1 ELSE 0 END
          WHERE id IN ($1,$2)`, [h.owned.gangId, h.victimOwned.gangId]);
    }
    await h.notify(client, victim.id, 'attack', { from: ch.name, stolen, cb: crates, dmg, hospMs });
    await h.bumpDaily(client, ch.id, 'jump');
    await bumpFamilyTask(client, h, 'jump', 1);
    await bumpMastery(client, h, ch, 'muscle', 'jump'); // THE TRADES — a won jump works the protection racketeer's craft
    bus.emit('streets', { type: 'jump', by: ch.name, on: victim.name, war: !!war });
    return { ok: true, win: true, intent: it.id, energy: energyCost, stolen, crates, rep, bounty, war: !!war };
  }
  const dmg = rand(10, 25);
  ch.health = Math.max(1, Number(ch.health) - dmg);
  return { ok: true, win: false, intent: it.id, energy: energyCost, dmg };
}

// ═══════════════════ BOUNTIES / THE CONTRACT BOARD (§5.2, M7 Phase 1) ═══════════════════
// Escrowed at post time (a §10.4 escrow bucket); paid to the fulfiller, NEVER a funder. 2%
// house take on top. One pot per (target, kind): a 'hospitalize' pot pays on a winning jump
// or a kill; a premium 'kill' pot pays ONLY on a completed hit. Contracts carry a reason +
// expiry; a funder can cancel their own share, and expired pots refund every funder.

// ═══════════════════ HIT CONTRACTS (§7.7) ═══════════════════
export async function startSearch(ch, targetCharacterId, client, h) {
  if (targetCharacterId === ch.id) throw new GameError('self', 'You know where you are.');
  const t = (await client.query(
    `SELECT c.id, c.name, c.wanted_until, a.rat FROM characters c JOIN account_persistent a ON a.account_id=c.account_id
      WHERE c.id=$1 AND c.alive`, [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  const tg = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [targetCharacterId])).rows[0];
  // a rat OR a WANTED welsher forfeits family omertà — same exception fire/jump/npcHit/postBounty carry
  // (red-team R1: startSearch had omitted the rat flag, so the fire rat-waiver was unreachable to same-family hunters)
  if (tg?.gang_id && tg.gang_id === h.owned.gangId && !t.rat && !isWanted(t)) throw new GameError('family', "They're family. Omertà.");
  const cur = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (cur) throw new GameError('searching', 'Your people are already out looking. Call them off first.');
  // (red-team R14 F2) set started_at from the JS clock, not the DB `now()` default — the fire-readiness
  // gate below reads it back with `Date.now()` (as does the placedAt countdown), and every other timer in
  // the codebase (shoot_cd_until, bank_intransit_at, unbond_at, last_accrued_at) is JS-set AND JS-read.
  // A persistent DB-behind-app skew on the DB default would otherwise let a hunter fire that skew early.
  await client.query('INSERT INTO searches (hunter, target, started_at) VALUES ($1,$2,$3)', [ch.id, targetCharacterId, new Date(Date.now())]);
  // EXECUTIONER (skills) × VINNIE T3 (underworld): the assassin's people work faster —
  // applied here AND at fire's readiness check via hunterSearchMs (both read the HUNTER's
  // build+standing, so the two clocks agree). Stacking flagged; both sign-off levers.
  return { ok: true, placedAt: new Date(Date.now() + hunterSearchMs(h)) };
}

// §9 production timers: search 3 h, failed-shot cooldown 2 h.
// Tests may shrink them via env — never set these in production configs.

// §9 production timers: search 3 h, failed-shot cooldown 2 h.
// Tests may shrink them via env — never set these in production configs.
const searchMs = () => Number(process.env.SEARCH_MS || CONSTANTS.SEARCH_MS);

const hunterSearchMs = (h) => Math.floor(searchMs()
  * skillMult(h, 'executioner', SKILLS.FX.SEARCH_MULT)
  * npcMult(h, 'fixer', 3, UNDERWORLD.FX.SEARCH_MULT));

const shootCdMs = () => Number(process.env.SHOOT_CD_MS || (2 * 3600 * 1000));


export async function callOffSearch(ch, client) {
  await client.query('DELETE FROM searches WHERE hunter=$1', [ch.id]);
  return { ok: true };
}

// L3a — THE SACKING: on a PLAYER fire-kill the killer SEIZES one of the victim's business fronts (the
// endgame passive-income engine) instead of it dying with the street — the review's keystone lever that
// turns the passive empire into genuine PvP RISK CAPITAL and gives the kill a prize worth the ammo. A pure
// OWNERSHIP move: a front is NOT a §10.4 currency (no business-conservation check — the territory-seize/
// gear-loot precedent), pending forfeits, clocks/scrutiny reset (the takeover resetFrontToNewOwner
// precedent). Gated so the killer can only HOLD a front they could run — level ≥ the front's lvl gate AND
// an empty kind slot (UNIQUE(character_id,kind); the frontier-B1 "hold only what you could raid" rule). If
// they can hold none, nothing extra happens (the empire dies with the street as normal — no free destroy).
// MUST run in the loot block BEFORE runEstate's `DELETE businesses WHERE character_id=victim`, so the
// seized front (now killer-owned) survives the wipe while the rest die. Only fire (a real player kill)
// sacks — NPC/mod kills don't (the whack:loot precedent).

// L3a — THE SACKING: on a PLAYER fire-kill the killer SEIZES one of the victim's business fronts (the
// endgame passive-income engine) instead of it dying with the street — the review's keystone lever that
// turns the passive empire into genuine PvP RISK CAPITAL and gives the kill a prize worth the ammo. A pure
// OWNERSHIP move: a front is NOT a §10.4 currency (no business-conservation check — the territory-seize/
// gear-loot precedent), pending forfeits, clocks/scrutiny reset (the takeover resetFrontToNewOwner
// precedent). Gated so the killer can only HOLD a front they could run — level ≥ the front's lvl gate AND
// an empty kind slot (UNIQUE(character_id,kind); the frontier-B1 "hold only what you could raid" rule). If
// they can hold none, nothing extra happens (the empire dies with the street as normal — no free destroy).
// MUST run in the loot block BEFORE runEstate's `DELETE businesses WHERE character_id=victim`, so the
// seized front (now killer-owned) survives the wipe while the rest die. Only fire (a real player kill)
// sacks — NPC/mod kills don't (the whack:loot precedent).
async function sackEmpire(client, ch, victim, h) {
  if (!M3.SACK_ON_KILL) return null;
  const fronts = (await client.query('SELECT id, kind, tier FROM businesses WHERE character_id=$1', [victim.id])).rows;
  if (!fronts.length) return null;
  const killerLvl = levelOf(Number(ch.respect));
  const killerKinds = new Set((await client.query('SELECT kind FROM businesses WHERE character_id=$1', [ch.id])).rows.map((r) => r.kind));
  // the most VALUABLE front the killer can actually hold (level gate + an empty kind slot)
  let best = null;
  for (const f of fronts) {
    const cat = BUSINESSES.find((b) => b.kind === f.kind); if (!cat) continue;
    if (killerLvl < cat.lvl || killerKinds.has(f.kind)) continue;
    const income = cat.tiers[f.tier - 1]?.incomePerHr || 0;
    if (!best || income > best.income) best = { id: f.id, kind: f.kind, tier: f.tier, name: cat.name, income };
  }
  if (!best) return null;
  // reset ALL mutable front state on the change of hands (the takeover resetFrontToNewOwner columns) — a
  // seized front is never born hot/pending-full/specialized; pending income forfeits (clock reset).
  // (red-team) rake_cursor moves to TODAY's den volume, NOT 0 — the buyBusiness rule ("a new owner earns
  // against future action, not history"); a 0 cursor let a killer claim rakeback on the ENTIRE lifetime
  // den volume, draining the shared profit-capped pool ahead of every honest casino-front owner.
  const denVol = Number((await client.query('SELECT total FROM den_volume WHERE id=1')).rows[0]?.total || 0);
  await client.query(
    `UPDATE businesses SET character_id=$2, spec=NULL, spec_at=NULL, scrutiny=0, scrutiny_at=now(),
       last_collect_at=now(), launder_used=0, launder_at=now(), upkeep_at=now(), shakedown_at=NULL, rake_cursor=$3
     WHERE id=$1`, [best.id, ch.id, denVol]);
  // keep the victim's loaded fronts honest so the estate report doesn't double-count the seized one
  if (h.victimOwned?.businesses) h.victimOwned.businesses = h.victimOwned.businesses.filter((b) => b.id !== best.id);
  return { kind: best.kind, tier: best.tier, name: best.name };
}


export async function fire(ch, victim, client, h, rounds) {
  const s = (await client.query('SELECT * FROM searches WHERE hunter=$1', [ch.id])).rows[0];
  if (!s || s.target !== victim.id) throw new GameError('no_search', 'Your people have no fix on them. Start a search.');
  // same clock as startSearch (executioner × fixer T3) — the hunter's two clocks agree
  if (new Date(s.started_at).getTime() + hunterSearchMs(h) > Date.now())
    throw new GameError('searching', "They haven't been placed yet. Patience is a caliber.");
  if (jailed(ch)) throw new GameError('jailed', 'No wet work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "No wet work while you're to ground — hiding, not hunting.");
  if (witproActive(ch)) throw new GameError('witpro', "No wet work from witness protection — untargetable is a shield, not a licence to kill.");
  if (hospitalized(ch)) throw new GameError('hosp_self', "You're laid up under the Doc's care — no wet work from a hospital bed. (R40: the offense action-lock every sibling enforces.)");
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
  ch.heat = Math.min(100, Number(ch.heat || 0) + M3.FIRE_HEAT); // §7 interlock: wet work draws law heat, like a deal
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
    // ANTI-SYBIL FLOOR (SIGN-OFF 2.3): loot only comes off a mark who was worth hunting. Below
    // LOOT_MIN_LVL a kill still runs the full estate — it just pays no cash/$OMR/gear — which closes
    // the "funnel value through disposable low-level alts onto one main" concentration rail without
    // touching the whale-hunting economics D1 signed. The npcHit-rookie / WANTED_MIN_LVL / legend-floor
    // posture, now on the one loot surface that was missing it.
    const lootable = vicLvl >= (M3.LOOT_MIN_LVL || 0);
    // SEASONAL MODIFIER (slate #6): BLOOD IN THE STREETS loots deeper (clamped — never past half)
    const seasonLootMult = seasonModOf().lootMult || 1;
    // BLOOD OATH (Commission Tier-4 decree): a blood week — a fresh kill takes more off the body. One
    // touchpoint on the CASH loot rate, threaded into runEstate so the escrow legs share the exact mult
    // (the critique's dual-loot-site fix). Clamped ≤ 0.5 at every site so the deepen never breaches the ceiling.
    const bloodOath = (await activeDecree(client))?.id === 'blood_oath' ? (COMMISSION.BLOOD_OATH_LOOT_MULT || 1) : 1;
    const cashLootRate = Math.min(0.5, M3.CASH_LOOT_RATE * seasonLootMult * bloodOath);
    const pocketLoot = lootable ? Math.floor(Number(victim.cash) * cashLootRate) : 0;
    const transitLoot = lootable ? Math.floor(inTransit * cashLootRate) : 0;
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
    const omrLoot = lootable ? Math.floor((liquid + unbonding) * Math.min(0.5, M3.OMR_LOOT_RATE * seasonLootMult)) : 0;
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
    if (lootable && gearRoll < Number(process.env.GEAR_LOOT_CHANCE ?? M3.GEAR_LOOT_CHANCE)) {
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
    const vContra = lootable ? Math.floor(Number(victim.contraband) || 0) : 0;
    if (vContra > 0) {
      contraLoot = Math.floor(vContra * PORT.STEP5.CONTRA_LOOT_RATE);
      if (contraLoot > 0) {
        await client.query('UPDATE characters SET contraband = contraband - $2 WHERE id=$1', [victim.id, contraLoot]);
        await client.query('UPDATE characters SET contraband = contraband + $2 WHERE id=$1', [ch.id, contraLoot]);
      }
    }
    // HEIST TIER-4 — HOT LOOT LOOT (the same P1.1 twin): a marked thief risks the score he took HOT to
    // fence later. heist_loot is a cash-book-value commodity, NOT a §10.4 currency (no ledger row); the
    // remainder dies with the street. Absolute reads (NUMERIC, arith-safe).
    let hotLoot = 0;
    const vHot = Math.floor(Number(victim.heist_loot) || 0);
    if (vHot > 0) {
      hotLoot = Math.floor(vHot * HEIST_LOOT_RATE);
      if (hotLoot > 0) {
        await client.query('UPDATE characters SET heist_loot = heist_loot - $2 WHERE id=$1', [victim.id, hotLoot]);
        await client.query('UPDATE characters SET heist_loot = heist_loot + $2 WHERE id=$1', [ch.id, hotLoot]);
      }
    }
    // L3a — THE SACKING: the killer takes over one of the victim's fronts (the passive-income prize).
    // Ownership move only, §10.4-neutral; runs BEFORE runEstate wipes the rest of the empire.
    const empireLoot = await sackEmpire(client, ch, victim, h);
    if (empireLoot) {
      await h.notify(client, ch.id, 'sacked', { kind: empireLoot.kind, name: empireLoot.name, from: victim.name });
      bus.emit('streets', { type: 'sacked', by: ch.name, on: victim.name, front: empireLoot.name });
    }
    const { total: bounty, directed } = await claimBounty(client, h, ch, victim.id, ['hospitalize', 'kill']); // a kill fulfils both
    // L3c — THE CONTRACT'S BULLETS: ammo is the −EV driver on a hit, so when a kill fulfils a PAID contract
    // (any pool/directed/family/WANTED bounty → bounty > 0) the contract covers CONTRACT_AMMO_REBATE of the
    // rounds spent — the pot no longer has to carry the whole loss, and a smaller contract turns a hit +EV.
    // A bounded ammo FAUCET (`contract:rebate`, in the ammo vocabulary), only on a contracted kill.
    let ammoBack = 0;
    if (bounty > 0 && M3.CONTRACT_AMMO_REBATE > 0) {
      ammoBack = Math.floor(fired * M3.CONTRACT_AMMO_REBATE);
      if (ammoBack > 0) {
        ch.ammo = Number(ch.ammo) + ammoBack;
        await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: ammoBack, reason: 'contract:rebate', counterparty: victim.id });
      }
    }
    // VENDETTA SETTLEMENT — if this kill answers a blood debt (my bloodline sworn against
    // theirs, inside the window), the vendetta is settled: the row closes, the street hears,
    // and the rep multiplier below pays vengeance rates.
    const vend = (await client.query(
      'SELECT sworn FROM vendettas WHERE avenger_account=$1 AND target_account=$2 AND expires_at > now()',
      [ch.account_id, victim.account_id])).rows[0];
    if (vend) {
      await client.query('DELETE FROM vendettas WHERE avenger_account=$1 AND target_account=$2', [ch.account_id, victim.account_id]);
      await bumpHonor(client, ch, HONOR.VENDETTA_SETTLE); // #1: blood answered for blood — the honorable kill
      await h.notify(client, ch.id, 'vendetta_settled', { for: vend.sworn, killed: victim.name });
      bus.emit('streets', { type: 'vendetta_settled', by: ch.name, on: victim.name, for: vend.sworn });
    }
    // the assassin's legend grows (kills + feared-rep + season streak); directed hits pay a
    // bonus, a settled vendetta a bigger one
    const hit = await awardHitmanRep(client, h, ch, victim, vicLvl, directed, !!vend);
    await bumpMastery(client, h, ch, 'wetwork', 'fire'); // THE TRADES — a confirmed kill is the lethal art
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
    const estate = await runEstate(client, h, victim, ch.name, { killerCh: ch, vendetta: true, loot: true, bloodOathMult: bloodOath });
    bus.emit('streets', { type: 'kill', by: ch.name, victim: victim.name });
    return { ok: true, kill: true, rep, chop, loot, omrLoot, gearLoot, contraLoot, orderLoot: estate.orderLoot || 0, bounty, jammed, warKill, hitman: hit,
      ...(empireLoot ? { empireLoot } : {}), ...(ammoBack ? { ammoBack } : {}), vendetta: !!vend, ...(grudges.length ? { grudges } : {}), estate: { heirId: estate.heirId } };
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
  if (witproActive(ch)) throw new GameError('witpro', "You can't run contractors from witness protection — untargetable is a shield, not a licence to kill.");
  if (hospitalized(ch)) throw new GameError('hosp_self', "You're laid up under the Doc's care — no arranging wet work from a hospital bed. (R40: the offense action-lock, symmetric with the victim gate.)");
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
  await bumpHonor(client, ch, HONOR.NPC_HIT); // #1: paying strangers for your killing is cowards' work
  await bumpStanding(client, h, ch, 'fixer', 4, { action: 'hire' }); // arranged work is business with the Match
  // RIVALRY (step two): the Doc hears who sent the man with the bag
  await bumpStanding(client, h, ch, 'doc', -UNDERWORLD.STEP2.RIVAL_LOSS);
  ch.heat = Math.min(100, Number(ch.heat || 0) + M3.NPC_HIT_HEAT);
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
      // narrow hand-rolled persist (no persistAccount here): must carry every account field runEstate
      // mutates — prestige, deaths, and (L2a) the death-duty $OMR burn (ledgered inside runEstate),
      // which reaches liquid AND unbonding, so both columns ride or the burn drifts §10.4.
      await client.query('UPDATE account_persistent SET prestige=$2, deaths=$3, omr=$4, unbonding=$5 WHERE account_id=$1',
        [victim.account_id, victimAcct.prestige, victimAcct.deaths, victimAcct.omr, victimAcct.unbonding ?? 0]);
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
