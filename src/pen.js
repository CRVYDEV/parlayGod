// THE PEN — the prison meta-game (design omerta-the-pen-design.md). Turns `jail_until` dead time
// into a place: work the yard down (a bounded cash faucet + good-behaviour sentence cut), buy
// contraband, pay the yard boss for protection, bribe the guard for early release — and the marquee
// JAILHOUSE SHANK: reach an enemy who's ALSO inside, bypassing the street defenses (safehouse can't
// be entered from a cell; a street bodyguard isn't in the yard) but respecting paid revive insurance
// and witness-protection segregation. Every action REQUIRES being jailed. Numbers are sign-off levers.
import crypto from 'node:crypto';
import { GameError, bus, bumpMastery } from './game.js';
import { PEN, penContrabandOf, penFactionOf, jailSecondsLeft, penSafe, inHole, levelOf, effStat, witproActive,
         yardEventOf, yardEventById, dayOf, yardCharacterOf, MASTERY, disciplineLvlOf, usd } from './rules.js';
import { trainDiscipline, addXp } from './regimen.js';
import { runEstate, claimBounty, npcHit } from './social.js';
import { isWanted } from './social/shared.js';
import { bumpHonor } from './honor.js';
import { HONOR , jailed, hospitalized } from './rules.js';

const uid = () => crypto.randomUUID();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const insideOnly = (ch) => {
  if (!jailed(ch)) throw new GameError('free', "You're on the outside — the Pen is closed to you.");
  if (inHole(ch)) throw new GameError('hole', "You're in the hole — no yard, no commissary, no calls.");
};
// today's yard incident (seed-drawn, town-wide). PEN_YARD_EVENT is a TEST-ONLY override (the
// SEARCH_MS / LAW_BUST_P precedent) — never set in production.
const activeYardEvent = () => process.env.PEN_YARD_EVENT ? yardEventById(process.env.PEN_YARD_EVENT) : yardEventOf(dayOf());

// how many of a contraband item an inmate is holding
async function contrabandOf(client, chId) {
  const rows = (await client.query('SELECT item, qty FROM pen_contraband WHERE character_id=$1 AND qty>0', [chId])).rows;
  return Object.fromEntries(rows.map((r) => [r.item, Number(r.qty)]));
}
// absolute write (pg-mem mis-evaluates arithmetic UPDATEs on INT columns — the setCargo precedent)
async function setContraband(client, chId, item, qty) {
  if (qty <= 0) { await client.query('DELETE FROM pen_contraband WHERE character_id=$1 AND item=$2', [chId, item]); return; }
  const upd = await client.query('UPDATE pen_contraband SET qty=$3 WHERE character_id=$1 AND item=$2', [chId, item, qty]);
  if (!upd.rowCount) await client.query('INSERT INTO pen_contraband (character_id, item, qty) VALUES ($1,$2,$3)', [chId, item, qty]);
}

// ── STEP FIVE — PRISON FACTIONS: the crew an inmate runs with for cover (only functional while jailed).
// `pen_faction` is written by DIRECT SQL (outside persistCharacter's positional UPDATE, like active_at),
// so the write survives the persist; ch.pen_faction (loaded via SELECT *) reads it back in-txn.
export async function joinFaction(ch, factionId, client, h) {
  insideOnly(ch);
  const f = penFactionOf(factionId);
  if (!f) throw new GameError('bad_faction', 'No such crew runs this yard.');
  if (ch.pen_faction === f.id) throw new GameError('already', `You already run with ${f.name}.`);
  await client.query('UPDATE characters SET pen_faction=$2 WHERE id=$1', [ch.id, f.id]);
  ch.pen_faction = f.id;
  await h.track(client, ch.account_id, 'pen_faction_join', { faction: f.id });
  return { ok: true, faction: f.id, name: f.name };
}
export async function leaveFaction(ch, client, h) {
  insideOnly(ch);
  if (!ch.pen_faction) throw new GameError('none', "You don't run with anybody.");
  const was = ch.pen_faction;
  await client.query('UPDATE characters SET pen_faction=NULL WHERE id=$1', [ch.id]);
  ch.pen_faction = null;
  return { ok: true, left: was };
}
// the shank DEFENSE an inmate gets from their crew: FACTION_COVER per active jailed faction-mate (capped),
// plus SHOTCALLER_COVER if THEY are the shot-caller (top season_kills among the jailed crew). A read.
async function factionCover(client, target) {
  if (!target.pen_faction) return { cover: 0, mates: 0, shotCaller: false };
  const mates = (await client.query(
    'SELECT season_kills FROM characters WHERE alive AND jail_until > now() AND pen_faction=$1 AND id <> $2',
    [target.pen_faction, target.id])).rows;
  let cover = Math.min(PEN.FACTION_COVER_CAP, mates.length * PEN.FACTION_COVER);
  // the shot-caller = the most-feared jailed member of the crew; a lone inmate isn't a shot-caller
  const vsk = Number(target.season_kills || 0);
  const shotCaller = mates.length > 0 && mates.every((m) => vsk >= Number(m.season_kills || 0));
  if (shotCaller) cover += PEN.SHOTCALLER_COVER;
  return { cover, mates: mates.length, shotCaller };
}

// GET /v1/pen — the yard (runs under withCharacter so it reads inside the caller's txn)
export async function penBoard(ch, client, h) {
  const held = await contrabandOf(client, ch.id);
  // The roster carries the state that decides whether a shank is even LEGAL — protection bought from
  // the yard boss, and segregation in the hole. Without it the board offered a shank against marks
  // the server was always going to refuse, so most attempts failed on a gate nobody could see. This
  // leaks nothing: a paid protection window exists precisely to be known — deterrence is what it buys.
  const roster = (await client.query(
    `SELECT c.id, c.name, c.respect, c.pen_faction, c.pen_safe_until, c.hole_until, gm.gang_id FROM characters c
       LEFT JOIN gang_members gm ON gm.character_id = c.id
      WHERE c.alive AND c.jail_until > now() AND c.id <> $1
      ORDER BY c.jail_until ASC LIMIT 30`, [ch.id])).rows
    .map((r) => ({ id: r.id, name: r.name, level: levelOf(Number(r.respect)), gang: r.gang_id || null,
      faction: r.pen_faction ? (penFactionOf(r.pen_faction)?.name || r.pen_faction) : null,
      protected: !!(r.pen_safe_until && new Date(r.pen_safe_until) > new Date()),
      inHole: !!(r.hole_until && new Date(r.hole_until) > new Date()),
      // your own crew — the yard omertà gate, which the client could not otherwise derive by name alone
      crew: !!(ch.pen_faction && r.pen_faction === ch.pen_faction) }));
  const ev = activeYardEvent();
  // step five — YOUR crew: your faction, the cover it gives you, and whether you're the shot-caller
  const myCover = jailed(ch) ? await factionCover(client, ch) : { cover: 0, mates: 0, shotCaller: false };
  return {
    inside: !!jailed(ch),
    sentenceSeconds: jailSecondsLeft(ch),
    protectedSeconds: penSafe(ch) ? Math.max(0, Math.ceil((new Date(ch.pen_safe_until) - Date.now()) / 1000)) : 0,
    holeSeconds: inHole(ch) ? Math.max(0, Math.ceil((new Date(ch.hole_until) - Date.now()) / 1000)) : 0,
    contraband: held,
    armed: (held.shiv || 0) > 0,
    commissary: PEN.CONTRABAND.map((c) => ({ id: c.id, name: c.name, cost: c.cost, desc: c.desc })),
    // the quote MIRRORS payProtection exactly (incl. the wealth scale + the incident mult)
    protectionCost: protectionCostOf(ch, ev.protMult || 1), bribePerSecond: Math.round(PEN.BRIBE_PER_S * (ev.bribeMult || 1)),
    shankCooldownSeconds: ch.shank_at && new Date(ch.shank_at) > new Date()
      ? Math.ceil((new Date(ch.shank_at) - Date.now()) / 1000) : 0,
    // step two: today's yard incident (the block-wide modifier everyone shares)
    incident: { id: ev.id, name: ev.name, desc: ev.desc },
    // step five: your yard crew + the cover it buys, the shot-caller status, and the roster of crews
    factions: PEN.FACTIONS.map((f) => ({ id: f.id, name: f.name })),
    faction: ch.pen_faction ? { id: ch.pen_faction, name: penFactionOf(ch.pen_faction)?.name || ch.pen_faction,
      mates: myCover.mates, cover: Math.round(myCover.cover * 100), shotCaller: myCover.shotCaller } : null,
    // step three: THE BREAKOUT — buy a cutkit, go over the wall (become a WANTED fugitive on a win)
    breakout: { cost: penContrabandOf('cutkit')?.cost || 0, ready: (held.cutkit || 0) > 0,
      blocked: !!ev.shankBlock, fugitiveHours: Math.round(PEN.FUGITIVE_MS / 3600000) },
    // step six — THE YARD LIVES: today's character + the in-sentence activities
    yardLife: {
      character: (() => { const c = yardCharacterOf(dayOf()); return { name: c.name, line: c.line, effect: c.effect }; })(),
      talked: !!(await client.query('SELECT 1 FROM pen_talks WHERE character_id=$1 AND day=$2', [ch.id, dayOf()])).rows[0],
      workoutDisciplines: PEN.YARD_DISCIPLINES,
      cardsEnergy: PEN.CARDS_ENERGY,
    },
    yard: roster,
  };
}

// POST /v1/pen/work — yard duty: energy → a little cash + shave WORK_CUT_S off the sentence
export async function workYard(ch, client, h) {
  insideOnly(ch);
  if (Number(ch.energy) < PEN.WORK_ENERGY) throw new GameError('energy', `Yard duty takes ${PEN.WORK_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - PEN.WORK_ENERGY;
  const pay = rand(PEN.WORK_PAY[0], PEN.WORK_PAY[1]);
  ch.cash = Number(ch.cash) + pay;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'pen:work' });
  // good behaviour shaves time (never below "just walked")
  const cutMs = PEN.WORK_CUT_S * 1000;
  const left = new Date(ch.jail_until).getTime() - Date.now();
  ch.jail_until = new Date(Date.now() + Math.max(0, left - cutMs));
  // report what was ACTUALLY shaved, not the nominal — the shave is clamped at "just walked", so a
  // man with 40s left is told a full minute came off a stretch that only had 40s in it. bribeGuard,
  // in this same file, already reports its clamped `cut`; these two sites did not.
  const cutSeconds = Math.min(PEN.WORK_CUT_S, Math.max(0, Math.round(left / 1000)));
  return { ok: true, pay, cutSeconds, sentenceSeconds: jailSecondsLeft(ch) };
}

// ── STEP SIX — THE YARD LIVES (founder: jail was Work-or-nothing) ── three in-sentence
// activities, all §10.4-free (XP/pacing, never currency — the whole step writes zero ledger rows).
// THE IRON PILE trains the PHYSICAL disciplines from the yard through the SAME regimen path on the
// SAME shared gym clock (the { fromYard } waiver — the burner precedent — so jail never trains
// faster than the street, it just stops being dead time).
export async function yardWorkout(ch, disciplineId, client, h) {
  insideOnly(ch);
  if (!PEN.YARD_DISCIPLINES.includes(disciplineId))
    throw new GameError('bad_discipline', 'The iron pile builds the BODY — stamina, conditioning or composure.');
  const r = await trainDiscipline(ch, disciplineId, client, h, { fromYard: true });
  return { ...r, yard: true };
}

// CARDS WITH THE CREW — no money on the blanket (the guards take real cash games), but the table
// still schools you: energy → gambling mastery XP (the Trades funnel, MASTERY.XP.cards).
export async function yardCards(ch, client, h) {
  insideOnly(ch);
  if (Number(ch.energy) < PEN.CARDS_ENERGY) throw new GameError('energy', `A seat at the blanket takes ${PEN.CARDS_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - PEN.CARDS_ENERGY;
  await bumpMastery(client, h, ch, 'gambling', 'cards');
  return { ok: true, cards: true, track: 'gambling', trackName: MASTERY.TRACKS.find((t) => t.id === 'gambling')?.name || 'gambling', xp: MASTERY.XP.cards };
}

// THE YARD CHARACTER — a seed-drawn fictional inmate to TALK to, once a day (the drill-claim
// shape). Wisdom pays a composure bump, the trusty shaves the sentence (the workYard
// good-behaviour shape — pacing, never currency), a war story schools the teller's trade.
export async function yardTalk(ch, client, h) {
  insideOnly(ch);
  const day = dayOf();
  const taken = await client.query('INSERT INTO pen_talks (character_id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ch.id, day]);
  if (!taken.rowCount) throw new GameError('talked', 'You already had that conversation today.');
  const c = yardCharacterOf(day);
  const out = { ok: true, npc: c.name, line: c.line, effect: c.effect };
  if (c.effect === 'wisdom') {
    const total = await addXp(client, ch.id, 'composure', PEN.TALK_WISDOM_XP);
    Object.assign(out, { xp: PEN.TALK_WISDOM_XP, discipline: 'composure', total, level: disciplineLvlOf(total) });
  } else if (c.effect === 'shortcut') {
    const left = new Date(ch.jail_until).getTime() - Date.now();
    ch.jail_until = new Date(Date.now() + Math.max(0, left - PEN.TALK_CUT_S * 1000));
    // the shaved time is clamped at "just walked" — report what came off, not what was offered
    Object.assign(out, { cutSeconds: Math.min(PEN.TALK_CUT_S, Math.max(0, Math.round(left / 1000))),
      sentenceSeconds: jailSecondsLeft(ch) });
  } else {
    await bumpMastery(client, h, ch, c.track, 'yardtale');
    Object.assign(out, { track: c.track, trackName: MASTERY.TRACKS.find((t) => t.id === c.track)?.name || c.track, xp: MASTERY.XP.yardtale });
  }
  return out;
}

// POST /v1/pen/buy/:item — the commissary (a cash sink → the corrupt guard's pocket, i.e. the buyback pool)
export async function buyContraband(ch, itemId, client, h) {
  insideOnly(ch);
  if (activeYardEvent().commissaryClosed) throw new GameError('toss', "Guards are tearing the block apart — the guard won't move contraband today.");
  const item = penContrabandOf(itemId);
  if (!item) throw new GameError('bad_item', 'The guard doesn’t move that.');
  if (Number(ch.cash) < item.cost) throw new GameError('cash', `The guard wants ${usd(item.cost)}.`);
  ch.cash = Number(ch.cash) - item.cost;
  const held = await contrabandOf(client, ch.id);
  await setContraband(client, ch.id, itemId, (held[itemId] || 0) + 1);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [item.cost]); // the guard's cut recycles into the pool
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -item.cost, reason: 'pen:commissary' });
  // `op` names the SYSTEM. {ok, item, cost} is byte-identical to what the WORKSHOP returns for a
  // crafted consumable, and this branch sits first — so a medkit rolled at the bench would read
  // "the guard slips you a medkit". Absence is not a discriminator either: the workshop reply had
  // no `cost` only until it needed to state its price.
  return { ok: true, op: 'commissary', item: itemId, name: item.name, cost: item.cost };
}

// the yard boss prices cover off the man's liquid wealth (the SAFEHOUSE_NW_BPS pattern) — a flat rate
// sold a jailed whale immunity for pocket change. The floor guards the WEALTH SCALE only; the yard
// incident's mult then applies on top, because a riot's half-price cover is a DESIGNED discount below
// the flat rate (unlike the safehouse's season mults, which are all ≥1 and re-floored).
export const protectionCostOf = (ch, mult = 1) => Math.round(
  Math.max(PEN.PROTECTION_COST,
    Math.floor((Number(ch.cash) + Number(ch.bank)) * PEN.PROTECTION_NW_BPS / 10000)) * mult);

// POST /v1/pen/protection — pay the yard boss for a no-shank window (the in-jail safehouse)
export async function payProtection(ch, client, h) {
  insideOnly(ch);
  const cost = protectionCostOf(ch, activeYardEvent().protMult || 1); // a riot puts cover on sale
  if (Number(ch.cash) < cost) throw new GameError('cash', `The yard boss wants ${usd(cost)}.`);
  ch.cash = Number(ch.cash) - cost;
  const base = penSafe(ch) ? new Date(ch.pen_safe_until).getTime() : Date.now();
  ch.pen_safe_until = new Date(base + PEN.PROTECTION_MS);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'pen:protection' });
  return { ok: true, cost, protectedSeconds: Math.ceil((new Date(ch.pen_safe_until) - Date.now()) / 1000) };
}

// POST /v1/pen/bribe — bribe the guard to cut the remaining sentence (the fast, expensive way out)
export async function bribeGuard(ch, seconds, client, h) {
  insideOnly(ch);
  const left = jailSecondsLeft(ch);
  // ABSENT (null/undefined) means "buy the whole sentence"; an EXPLICIT number is honoured — a
  // non-positive/NaN value is a clean 400, never the silent full-sentence charge (audit LOW footgun).
  let cut;
  if (seconds === undefined || seconds === null || seconds === '') cut = left;
  else { const n = Math.floor(Number(seconds)); if (!Number.isFinite(n) || n <= 0) throw new GameError('seconds', 'Ask for a positive number of seconds to cut.'); cut = Math.min(left, n); }
  const perSecond = Math.round(PEN.BRIBE_PER_S * (activeYardEvent().bribeMult || 1)); // a visit day, the guard takes less
  const cost = cut * perSecond;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Cutting ${cut}s costs ${usd(cost)}.`);
  ch.cash = Number(ch.cash) - cost;
  ch.jail_until = new Date(new Date(ch.jail_until).getTime() - cut * 1000);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'pen:bribe' });
  return { ok: true, cost, cutSeconds: cut, sentenceSeconds: jailSecondsLeft(ch) };
}

// POST /v1/pen/break — THE BREAKOUT (step three): a solo high-risk escape. Burn a cutkit; on a win
// the sentence CLEARS but you walk out a WANTED fugitive (omertà stripped + NPC bounty hunters — the
// loan-WANTED machinery); on a loss you're caught, thrown in the hole with a long added stretch and a
// beating. §10.4-clean — no currency moves here (the kit was a ledgered commissary sink); the escape
// trades a cell for a manhunt, so it never trivialises the RICO sink. Squaring the warrant later is the
// existing POST /v1/loans/square ($50k → the pool), or you wait out FUGITIVE_MS lying low.
export async function attemptBreak(ch, client, h) {
  insideOnly(ch);
  const ev = activeYardEvent();
  if (ev.shankBlock) throw new GameError('lockdown', 'Lockdown — guards on every tier, wall to wall. No wall to go over today.');
  const held = await contrabandOf(client, ch.id);
  if (!(held.cutkit > 0)) throw new GameError('no_kit', 'You need a hacksaw and rope — see the guard at the commissary.');
  if (Number(ch.energy) < PEN.BREAK_ENERGY) throw new GameError('energy', `Going over the wall takes ${PEN.BREAK_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - PEN.BREAK_ENERGY;
  await setContraband(client, ch.id, 'cutkit', held.cutkit - 1); // the kit is spent whether you make it or not
  // PEN_BREAK_P is a TEST-ONLY knob (the SHANK_P precedent). A riot's chaos is cover for a run.
  const p = process.env.PEN_BREAK_P != null ? Number(process.env.PEN_BREAK_P)
    : Math.max(0.05, Math.min(0.9, PEN.BREAK_P + (ev.shankAdd || 0)));
  const roll = Math.random();
  const made = roll < p;
  await h.rngLog(client, ch.id, 'pen:break', roll, made ? 'over the wall' : 'caught at the fence');
  ch.heat = Math.min(100, Number(ch.heat || 0) + PEN.BREAK_HEAT); // the alarm goes up either way
  if (!made) {
    // caught at the fence — a beating, a long added stretch, and the hole (capped at the new sentence)
    const dmg = rand(PEN.BREAK_FAIL_DMG[0], PEN.BREAK_FAIL_DMG[1]);
    ch.health = Math.max(1, Number(ch.health) - dmg);
    ch.jail_until = new Date(new Date(ch.jail_until).getTime() + PEN.BREAK_CAUGHT_ADD_S * 1000);
    ch.hole_until = new Date(Math.min(Date.now() + PEN.HOLE_MS, new Date(ch.jail_until).getTime()));
    await h.notify(client, ch.id, 'break_failed', { addSeconds: PEN.BREAK_CAUGHT_ADD_S });
    return { ok: true, escaped: false, caught: true, dmg,
      holeSeconds: Math.max(0, Math.ceil((new Date(ch.hole_until) - Date.now()) / 1000)), sentenceSeconds: jailSecondsLeft(ch) };
  }
  // over the wall — the sentence is cleared, but you're a fugitive now (WANTED: omertà stripped + NPC
  // hunters). Refresh, never shorten, an existing warrant. No pool bounty here (§10.4-clean); anyone
  // can still post one on a wanted man.
  ch.jail_until = null;
  const fug = Date.now() + PEN.FUGITIVE_MS;
  ch.wanted_until = new Date(Math.max(fug, ch.wanted_until ? new Date(ch.wanted_until).getTime() : 0));
  await h.notify(client, ch.id, 'escaped', { wantedHours: Math.round(PEN.FUGITIVE_MS / 3600000) });
  bus.emit('streets', { type: 'escape', who: ch.name });
  await h.track(client, ch.account_id, 'pen_break', { made: true });
  return { ok: true, escaped: true, wantedSeconds: Math.ceil(PEN.FUGITIVE_MS / 1000) };
}

// ── STEP FOUR — THE CO-OP BREAKOUT (the crew-heist pattern, inside) ──
// A jailed leader stakes a cutkit and opens a break; jailed inmates join off the board; the leader
// calls the go — ONE roll for the whole crew, odds scaling with crew size. Win = everyone's sentence
// clears + everyone WANTED; loss = the whole crew eats the hole + a longer stretch + a beating.
// §10.4-clean (the cutkit is contraband, not currency; refunded to a LIVING leader on disband/stale).
// Lock discipline mirrors executeHeist exactly: leader (withCharacter) → member char rows SORTED →
// the break row; one-active-break (UNIQUE character_id) makes concurrent executes disjoint (acyclic);
// members are written by absolute UPDATEs under lock (never in-memory — no persistCharacter clobber).
const coopStale = (row) => Date.now() - new Date(row.created_at).getTime() > PEN.COOP_TTL_MS;
async function activeBreak(client, chId) {
  return (await client.query(
    `SELECT m.break_id FROM pen_break_members m JOIN pen_breaks b ON b.id = m.break_id
      WHERE m.character_id=$1 AND b.status='planning'`, [chId])).rows[0] || null;
}

// POST /v1/pen/break/plan — a jailed leader stakes a cutkit and opens a break for the yard
export async function planBreak(ch, client, h) {
  insideOnly(ch);
  if (await activeBreak(client, ch.id)) throw new GameError('busy', "You're already in on a break.");
  const held = await contrabandOf(client, ch.id);
  if (!(held.cutkit > 0)) throw new GameError('no_kit', 'A crew break needs a hacksaw & rope — see the commissary.');
  await setContraband(client, ch.id, 'cutkit', held.cutkit - 1); // staked (refunded on disband/stale to a LIVING leader)
  const id = uid();
  await client.query('INSERT INTO pen_breaks (id, leader_character) VALUES ($1,$2)', [id, ch.id]);
  await client.query('INSERT INTO pen_break_members (break_id, character_id) VALUES ($1,$2)', [id, ch.id]);
  await h.track(client, ch.account_id, 'pen_break_plan', {});
  return { ok: true, op: 'breakout', id, crewNeeded: PEN.COOP_MIN - 1, crewMax: PEN.COOP_MAX };
}

// POST /v1/pen/break/:id/join — a jailed inmate joins an open break
export async function joinBreak(ch, breakId, client, h) {
  insideOnly(ch);
  const row = (await client.query("SELECT * FROM pen_breaks WHERE id=$1 AND status='planning' FOR UPDATE", [breakId])).rows[0];
  if (!row) throw new GameError('no_break', 'That break is gone.');
  if (coopStale(row)) throw new GameError('stale', 'That plan went cold.');
  if (await activeBreak(client, ch.id)) throw new GameError('busy', "You're already in on a break.");
  const crew = (await client.query('SELECT character_id FROM pen_break_members WHERE break_id=$1', [breakId])).rows;
  if (crew.length >= PEN.COOP_MAX) throw new GameError('full', 'The crew is set — no room on this one.');
  await client.query('INSERT INTO pen_break_members (break_id, character_id) VALUES ($1,$2)', [breakId, ch.id]);
  await h.track(client, ch.account_id, 'pen_break_join', {});
  return { ok: true, op: 'breakout', id: breakId, crew: crew.length + 1 };
}

// POST /v1/pen/break/:id/leave — a member walks; the LEADER walking disbands and takes the kit back
export async function leaveBreak(ch, breakId, client, h) {
  const row = (await client.query("SELECT * FROM pen_breaks WHERE id=$1 AND status='planning' FOR UPDATE", [breakId])).rows[0];
  if (!row) throw new GameError('no_break', 'That break is gone.');
  const mine = (await client.query('SELECT 1 FROM pen_break_members WHERE break_id=$1 AND character_id=$2', [breakId, ch.id])).rows[0];
  if (!mine) throw new GameError('not_crew', "You're not in on that break.");
  // `op: 'breakout'` names the SYSTEM. A bare {ok, disbanded} / {ok, left} is byte-identical to what a
  // crew RAID answers, and that line owned the guard — so calling off a jailbreak read "you called the
  // raid off" and walking away from one read "the raid goes on without you". Wrong system, both ways.
  // `cutkit` is the other half: the staked kit really does come back, and the reply never said so, so a
  // leader could not tell whether $50k of contraband had been forfeited or returned.
  if (row.leader_character === ch.id) {
    const held = await contrabandOf(client, ch.id);
    await setContraband(client, ch.id, 'cutkit', (held.cutkit || 0) + 1); // the staked kit comes back to a living leader
    await client.query("UPDATE pen_breaks SET status='abandoned' WHERE id=$1", [breakId]);
    await client.query('DELETE FROM pen_break_members WHERE break_id=$1', [breakId]);
    return { ok: true, op: 'breakout', disbanded: true, cutkit: 1 };
  }
  await client.query('DELETE FROM pen_break_members WHERE break_id=$1 AND character_id=$2', [breakId, ch.id]);
  return { ok: true, op: 'breakout', left: true };
}

// POST /v1/pen/break/:id/go — leader-only. One roll for the whole crew.
// POST /v1/pen/break/:id/rat — a crew member silently tips the guards (the heist-rat twin). Never named.
export async function ratBreak(ch, breakId, client, h) {
  insideOnly(ch); // you tip the guards from inside the yard (consistency with every other break action)
  const row = (await client.query("SELECT * FROM pen_breaks WHERE id=$1 AND status='planning'", [breakId])).rows[0];
  if (!row) throw new GameError('no_break', 'That break is gone.');
  const upd = await client.query('UPDATE pen_break_members SET ratted=true WHERE break_id=$1 AND character_id=$2', [breakId, ch.id]);
  if (!upd.rowCount) throw new GameError('not_crew', "You're not on that break.");
  await h.track(client, ch.account_id, 'pen_break_rat', {});
  return { ok: true }; // as quiet as the act
}

export async function executeBreak(ch, breakId, client, h) {
  insideOnly(ch); // the leader must be inside + out of the hole
  const ev = activeYardEvent();
  if (ev.shankBlock) throw new GameError('lockdown', 'Lockdown — guards on every tier. No wall to go over today.');
  const pre = (await client.query("SELECT * FROM pen_breaks WHERE id=$1 AND status='planning'", [breakId])).rows[0];
  if (!pre) throw new GameError('no_break', 'That break is gone.');
  if (pre.leader_character !== ch.id) throw new GameError('not_leader', 'The one who planned it calls the go.');
  if (coopStale(pre)) throw new GameError('stale', 'That plan went cold — walk away and start fresh.');
  const preIds = (await client.query('SELECT character_id FROM pen_break_members WHERE break_id=$1', [breakId])).rows.map((r) => r.character_id);
  // member character rows first, SORTED (leader already held by withCharacter; one-active-break keeps
  // concurrent executes disjoint → acyclic; the residual leader-vs-PvP 40P01 maps to `contention`)
  const others = {};
  for (const id of preIds.filter((id) => id !== ch.id).sort()) {
    const r = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    if (!r) throw new GameError('crew_gone', 'One of the crew is in the ground. Recrew.');
    others[id] = r;
  }
  const row = (await client.query("SELECT * FROM pen_breaks WHERE id=$1 AND status='planning' FOR UPDATE", [breakId])).rows[0];
  if (!row) throw new GameError('no_break', 'That break is gone.');
  const members = (await client.query('SELECT character_id FROM pen_break_members WHERE break_id=$1', [breakId])).rows.map((r) => r.character_id);
  if (members.slice().sort().join() !== [...preIds].sort().join())
    throw new GameError('crew_changed', 'The crew shifted under you — call the go again.');
  if (members.length < PEN.COOP_MIN) throw new GameError('crew_short', `A break needs at least ${PEN.COOP_MIN} — you have ${members.length}.`);
  const crewRows = [ch, ...Object.values(others)];
  for (const m of crewRows) {
    if (!jailed(m)) throw new GameError('crew_free', 'One of the crew already walked — recrew.');
    if (inHole(m)) throw new GameError('crew_hole', "One of the crew is in the hole — nobody moves without them.");
    if (hospitalized(m)) throw new GameError('crew_hurt', 'One of the crew is in the infirmary. Wait for them.');
  }
  // step five — THE RAT: read the silent flags BEFORE the membership rows are cleared.
  const rats = (await client.query('SELECT character_id FROM pen_break_members WHERE break_id=$1 AND ratted', [breakId])).rows.map((r) => r.character_id);
  // resolve: the kit was already spent at PLAN (removed from inventory; never refunded once we're 'done').
  // DELETE the member rows so the crew can break again — `pen_break_members.character_id` is UNIQUE, so
  // leaving stale 'done' rows would trip 23505 on a survivor's NEXT plan/join (audit HIGH). The character
  // outcomes below are written to the CHARACTER rows, not these membership rows.
  await client.query("UPDATE pen_breaks SET status='done' WHERE id=$1", [breakId]);
  await client.query('DELETE FROM pen_break_members WHERE break_id=$1', [breakId]);
  const setMemberRat = async (id, cols, params) => client.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id, ...params]);
  if (rats.length) {
    // THE GUARDS WERE WAITING: the break blows before the roll. The crew eats the hole + a longer stretch
    // + a beating; the rat(s) DODGE the added stretch and the beating (their deal) — but never serve LESS
    // than their OWN sentence. An absolute cut let a Sybil pair (a main leader + a throwaway alt joiner)
    // farm a cheap sentence trim ($50k cutkit → an hour off, ~14× under the bribe sink), so "self-rat is
    // −EV by construction" was false against alts (audit). Relief-only makes join-and-rat never better
    // than abstaining — a legit saboteur still dodges the crew's penalty and denies them the escape, but
    // nobody time-travels below their sentence. Everyone (incl. the rat) is holed WITH the crew so the
    // roster never outs the only free man (the anonymity fix); the feed only says "somebody talked".
    for (const m of crewRows) {
      const isRat = rats.includes(m.id);
      const baseJail = new Date(m.jail_until).getTime();
      const newJail = isRat ? new Date(baseJail) // relief-only: dodge the added stretch + beating, but no cut below your own sentence
        : new Date(baseJail + PEN.BREAK_CAUGHT_ADD_S * 1000);
      const hole = new Date(Math.min(Date.now() + PEN.HOLE_MS, newJail.getTime()));
      const health = isRat ? Number(m.health) : Math.max(1, Number(m.health) - rand(PEN.BREAK_FAIL_DMG[0], PEN.BREAK_FAIL_DMG[1]));
      if (m.id === ch.id) { ch.health = health; ch.jail_until = newJail; ch.hole_until = hole; }
      else { await setMemberRat(m.id, 'health=$2, jail_until=$3, hole_until=$4', [health, newJail, hole]); await h.notify(client, m.id, 'break_failed', { reason: 'talked' }); }
    }
    await h.rngLog(client, ch.id, 'pen:coopbreak', 0, `blown — somebody talked (crew ${crewRows.length})`);
    bus.emit('streets', { type: 'breakout_foiled', crew: crewRows.length });
    await h.track(client, ch.account_id, 'pen_coop_break', { made: false, ratted: true, crew: crewRows.length });
    return { ok: true, escaped: false, blown: true, message: 'The guards were waiting at the fence. Somebody talked.' };
  }
  // PEN_BREAK_P is a TEST-ONLY knob (the SHANK_P precedent). Odds scale with crew + a riot's chaos.
  const p = process.env.PEN_BREAK_P != null ? Number(process.env.PEN_BREAK_P)
    : Math.max(0.05, Math.min(PEN.COOP_MAX_P, PEN.COOP_BASE + (crewRows.length - 1) * PEN.COOP_PER_EXTRA + (ev.shankAdd || 0)));
  const roll = Math.random();
  const made = roll < p;
  await h.rngLog(client, ch.id, 'pen:coopbreak', roll, made ? `over the wall (crew ${crewRows.length})` : 'caught at the fence');
  const setMember = async (id, cols, params) => client.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id, ...params]);
  if (made) {
    const fug = Date.now() + PEN.FUGITIVE_MS;
    for (const m of crewRows) {
      const wanted = new Date(Math.max(fug, m.wanted_until ? new Date(m.wanted_until).getTime() : 0));
      const heat = Math.min(100, Number(m.heat || 0) + PEN.BREAK_HEAT);
      if (m.id === ch.id) { ch.jail_until = null; ch.wanted_until = wanted; ch.heat = heat; }
      else { await setMember(m.id, 'jail_until=NULL, wanted_until=$2, heat=$3', [wanted, heat]); await h.notify(client, m.id, 'escaped', { wantedHours: Math.round(PEN.FUGITIVE_MS / 3600000) }); }
    }
    bus.emit('streets', { type: 'breakout', crew: crewRows.length });
    await h.track(client, ch.account_id, 'pen_coop_break', { made: true, crew: crewRows.length });
    return { ok: true, escaped: true, crew: crewRows.length, wantedSeconds: Math.ceil(PEN.FUGITIVE_MS / 1000) };
  }
  // caught — the whole crew eats the hole + a longer stretch + a beating
  for (const m of crewRows) {
    const dmg = rand(PEN.BREAK_FAIL_DMG[0], PEN.BREAK_FAIL_DMG[1]);
    const health = Math.max(1, Number(m.health) - dmg);
    const newJail = new Date(new Date(m.jail_until).getTime() + PEN.BREAK_CAUGHT_ADD_S * 1000);
    const hole = new Date(Math.min(Date.now() + PEN.HOLE_MS, newJail.getTime())); // capped at the (extended) sentence
    if (m.id === ch.id) { ch.health = health; ch.jail_until = newJail; ch.hole_until = hole; }
    else { await setMember(m.id, 'health=$2, jail_until=$3, hole_until=$4', [health, newJail, hole]); await h.notify(client, m.id, 'break_failed', { addSeconds: PEN.BREAK_CAUGHT_ADD_S }); }
  }
  await h.track(client, ch.account_id, 'pen_coop_break', { made: false, crew: crewRows.length });
  return { ok: true, escaped: false, caught: true, crew: crewRows.length };
}

// GET /v1/pen/breaks — the co-op board (open plans + your active break). Pool-level (the heist precedent).
export async function breakBoard(pool, characterId) {
  const openRows = (await pool.query(
    `SELECT b.id, b.created_at, c.name AS leader FROM pen_breaks b JOIN characters c ON c.id = b.leader_character
      WHERE b.status='planning' ORDER BY b.created_at DESC LIMIT 30`)).rows;
  const memberRows = (await pool.query(
    "SELECT m.break_id FROM pen_break_members m JOIN pen_breaks b2 ON b2.id = m.break_id AND b2.status='planning'")).rows;
  const countBy = {};
  for (const r of memberRows) countBy[r.break_id] = (countBy[r.break_id] || 0) + 1;
  const open = openRows.filter((r) => Date.now() - new Date(r.created_at).getTime() <= PEN.COOP_TTL_MS)
    .map((r) => ({ id: r.id, leader: r.leader, crew: countBy[r.id] || 0, crewMax: PEN.COOP_MAX }));
  const mineRow = (await pool.query(
    `SELECT b.id, b.leader_character FROM pen_breaks b JOIN pen_break_members m ON m.break_id = b.id
      WHERE m.character_id=$1 AND b.status='planning'`, [characterId])).rows[0] || null;
  let mine = null;
  if (mineRow) {
    const crew = (await pool.query('SELECT c.name FROM pen_break_members m JOIN characters c ON c.id = m.character_id WHERE m.break_id=$1', [mineRow.id])).rows;
    mine = { id: mineRow.id, leader: mineRow.leader_character === characterId, crew: crew.map((c) => c.name) };
  }
  return { open, mine, min: PEN.COOP_MIN, max: PEN.COOP_MAX };
}

// Worker sweep: stale plans are abandoned and a LIVING leader's staked cutkit comes back (per-break
// txn, leader row locked BEFORE the break row — the sweepStaleHeists discipline).
export async function sweepStaleBreaks(pool) {
  const client = await pool.connect();
  let swept = 0;
  try {
    const staleRows = (await client.query(
      `SELECT id, leader_character FROM pen_breaks WHERE status='planning' AND created_at < now() - interval '${Math.floor(PEN.COOP_TTL_MS / 1000)} seconds'`)).rows;
    for (const s of staleRows) {
      await client.query('BEGIN');
      try {
        const leader = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive FOR UPDATE', [s.leader_character])).rows[0];
        const again = (await client.query("SELECT 1 FROM pen_breaks WHERE id=$1 AND status='planning' FOR UPDATE", [s.id])).rows[0];
        if (!again) { await client.query('COMMIT'); continue; }
        if (leader) { // refund the staked cutkit to a LIVING leader (a dead leader's kit stays sunk)
          const cur = (await client.query("SELECT qty FROM pen_contraband WHERE character_id=$1 AND item='cutkit'", [s.leader_character])).rows[0];
          const q = Number(cur?.qty || 0) + 1;
          if (cur) await client.query("UPDATE pen_contraband SET qty=$2 WHERE character_id=$1 AND item='cutkit'", [s.leader_character, q]);
          else await client.query("INSERT INTO pen_contraband (character_id, item, qty) VALUES ($1,'cutkit',$2)", [s.leader_character, q]);
        }
        await client.query("UPDATE pen_breaks SET status='abandoned' WHERE id=$1", [s.id]);
        await client.query('DELETE FROM pen_break_members WHERE break_id=$1', [s.id]);
        await client.query('COMMIT');
        swept++;
      } catch (e) { await client.query('ROLLBACK'); console.error('[sweepStaleBreaks] break', s.id, e?.message || e); } // per-row isolation (AUDIT-full-system-v2 I-LOW): a poison break no longer aborts the rest of the tick
    }
    return { swept };
  } finally { client.release(); }
}

// POST /v1/pen/shank/:targetId — the jailhouse hit (two-party: both must be inside)
export async function shank(ch, victim, client, h) {
  insideOnly(ch);
  // shield-not-bunker (P1.3, audit): the yard boss's protection is a SHIELD — you can't hunt from
  // under it. Mirrors the street safeHoused(ch) actor-guards on fire/jump.
  if (penSafe(ch)) throw new GameError('safe', "You're under the yard boss's protection — take it or hunt, not both.");
  // (red team 2026-08-16) …and not from a hospital bed either. `hospitalized(victim)` is refused three
  // lines down ("They're in the infirmary — out of reach"), so the game already holds that the infirmary
  // is off the yard — it just never said you can't walk OUT of one to kill somebody. The actor gate is
  // near-universal (boxing, business, casino, convoy, deeds, duels, heists all carry it) and the game's
  // most lethal verb was the one without it. Reachable with no exploit: `sweepLaw` force-busts an
  // offline player whatever condition he's in, and a lost break is a beating. Reproduced.
  if (hospitalized(ch)) throw new GameError('hosp_self', "You're on the infirmary cot — you're not walking the yard tonight.");
  if (!jailed(victim)) throw new GameError('target_free', "They've walked — you can't reach them out there.");
  // family omertà holds inside too — VOID for a rat OR a WANTED target (the street fire/jump/npcHit
  // precedent; red-team R28 F2 — the isWanted exception was missing here, shielding a must-kill man
  // from his own family while both are jailed, though on the street they could freely fire on him).
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId && !h.victimAcct.rat && !isWanted(victim))
    throw new GameError('family', "They're family. Even in here.");
  // THE CREW (the account-level mutual-aid pact — distinct from the prison faction "yard crew" below):
  // you don't put a shiv in your own crew either. The omertà twin; a rat OR a WANTED target forfeits it.
  if (h.owned.crewId && h.victimOwned.crewId === h.owned.crewId && !h.victimAcct.rat && !isWanted(victim))
    throw new GameError('crew', "They run with your crew. Not in here either.");
  // step five — yard omertà: you don't move on your own crew (a rat forfeits it, like family)
  if (ch.pen_faction && ch.pen_faction === victim.pen_faction && !h.victimAcct.rat)
    throw new GameError('crew', "They run with your crew. You don't move on your own.");
  if (hospitalized(victim)) throw new GameError('hosp', "They're in the infirmary — out of reach.");
  if (penSafe(victim)) throw new GameError('protected', 'The yard boss has them covered right now.');
  if (inHole(victim)) throw new GameError('segregated', "They're in the hole — nobody reaches them there.");
  if (witproActive(victim)) throw new GameError('witpro', "They're in protective custody — segregated. No reach.");
  // step two: a LOCKDOWN freezes the yard — no moves on anybody today
  const ev = activeYardEvent();
  if (ev.shankBlock) throw new GameError('lockdown', "Lockdown — the guards have every tier. Not today.");
  const held = await contrabandOf(client, ch.id);
  if (!(held.shiv > 0)) throw new GameError('no_shiv', 'You need a shiv for that kind of talk.');
  if (Number(ch.energy) < PEN.SHANK_ENERGY) throw new GameError('energy', `A move like that takes ${PEN.SHANK_ENERGY} energy.`);
  // per-attacker cooldown (SIGN-OFF Tier 3): energy + a shiv + the sentence extension were the only
  // brakes, so a stocked-up inmate could work down a whole wing in one sitting. Direct-SQL column
  // (outside persistCharacter's positional UPDATE — the active_at pattern), set win OR lose below.
  // PEN_SHANK_CD_MS is a TEST-ONLY knob (the SEARCH_MS / SHOOT_CD_MS precedent) — never in production.
  const shankCd = Number(process.env.PEN_SHANK_CD_MS ?? PEN.SHANK_CD_MS);
  if (ch.shank_at && new Date(ch.shank_at) > new Date())
    throw new GameError('cooldown', `Too soon — the guards are still watching you. ${Math.ceil((new Date(ch.shank_at) - Date.now()) / 60000)}m.`);

  ch.energy = Number(ch.energy) - PEN.SHANK_ENERGY;
  const shankUntil = new Date(Date.now() + shankCd);
  await client.query('UPDATE characters SET shank_at=$2 WHERE id=$1', [ch.id, shankUntil]);
  ch.shank_at = shankUntil;
  await setContraband(client, ch.id, 'shiv', held.shiv - 1); // the shiv is spent whether it lands or not
  const km = effStat(Number(ch.muscle), 'muscle', h.owned.assets || [], h.owned.gear || []);
  const vm = effStat(Number(victim.muscle), 'muscle', h.victimOwned.assets || [], h.victimOwned.gear || []);
  // step five: the victim's CREW watches their back — faction cover (+ shot-caller leadership) is a
  // defense modifier that lowers the shank's odds (a NEW sign-off lever on the contest, off SHANK_P).
  const cov = await factionCover(client, victim);
  // SHANK_P is a TEST-ONLY knob (the LAW_BUST_P / WORLD_RAID_P precedent) — never set in production.
  const p = process.env.SHANK_P != null ? Number(process.env.SHANK_P)
    : Math.max(PEN.SHANK_MIN, Math.min(PEN.SHANK_MAX, PEN.SHANK_BASE + (km - vm) / PEN.SHANK_SCALE + (ev.shankAdd || 0) - cov.cover)); // a riot makes blood cheap; a crew makes it dear
  const roll = Math.random();
  await h.rngLog(client, ch.id, `shank:${victim.id}`, roll, roll < p ? 'landed' : 'missed');

  if (roll >= p) {
    // caught fumbling — the shiv's gone, the killer eats damage + more time, AND does a stretch in
    // THE HOLE (step two): solitary, no yard actions and untouchable, until it lifts.
    const dmg = rand(PEN.FAIL_DMG[0], PEN.FAIL_DMG[1]);
    ch.health = Math.max(1, Number(ch.health) - dmg);
    ch.jail_until = new Date(new Date(ch.jail_until).getTime() + PEN.CAUGHT_ADD_S * 1000);
    // the hole can't outlast the sentence (audit: an unbounded hole_until survived release and
    // reactivated on a FUTURE re-jail, blocking an unrelated stretch) — cap it at jail_until.
    ch.hole_until = new Date(Math.min(Date.now() + PEN.HOLE_MS, new Date(ch.jail_until).getTime()));
    await h.notify(client, victim.id, 'shank_survived', { from: ch.name });
    return { ok: true, kill: false, caught: true, dmg, holeSeconds: Math.round(PEN.HOLE_MS / 1000), sentenceSeconds: jailSecondsLeft(ch) };
  }

  // ── the blade lands ── real-ETH revive insurance still pulls them from the brink (paid anywhere)
  if (Number(h.victimAcct.respawn_tokens || 0) > 0) {
    h.victimAcct.respawn_tokens = Number(h.victimAcct.respawn_tokens) - 1;
    victim.health = 100;
    await h.notify(client, victim.id, 'revived', { from: ch.name });
    await h.notify(client, ch.id, 'target_revived', { victim: victim.name });
    return { ok: true, kill: false, revived: true };
  }
  // a body in the yard — the full estate (heir, prestige, a sworn bloodline), but no loot/chop (you
  // can't strip a fleet from a cell) and no feared-rep (a shanking is dishonorable — the npcHit rule)
  await h.notify(client, victim.id, 'shanked', { from: ch.name });
  // a shank is a DIRECT player kill (like fire, not the hired npcHit) — it FULFILS open kill
  // contracts on the mark (audit: else a random shiv burned the funder's escrow for free). Paid
  // BEFORE the estate vacates the bounties. Cash only (still no loot, no chop, no feared-rep).
  const { total: bounty } = await claimBounty(client, h, ch, victim.id, ['hospitalize', 'kill']);
  // (cohesion step two) the RECORD, not the rep: a shank paid zero feared-rep AND wrote no kill_log
  // row, so a yard kill was invisible to the feud ledger, the nemesis card and the pair story — the
  // relationship layer undercounted real bodies. rep=0 keeps every rep surface exactly as it was
  // (the bloodline-diminishing prior count filters rep>0); the ledger just stops forgetting.
  await client.query('INSERT INTO kill_log (id, killer_account, victim_account, victim_name, rep) VALUES ($1,$2,$3,$4,0)',
    [crypto.randomUUID(), ch.account_id, victim.account_id, victim.name]);
  const estate = await runEstate(client, h, victim, ch.name, { killerCh: ch, vendetta: true });
  await bumpMastery(client, h, ch, 'wetwork', 'shank'); // THE TRADES — a yard kill is still the lethal art
  await bumpHonor(client, ch, HONOR.SHANK); // #1: a shiv in the yard is a coward's kill — the street remembers
  ch.jail_until = new Date(new Date(ch.jail_until).getTime() + PEN.KILL_ADD_S * 1000); // a body means more time
  bus.emit('streets', { type: 'shank', by: ch.name, victim: victim.name });
  await h.track(client, ch.account_id, 'shank', { victim: victim.id, bounty });
  return { ok: true, kill: true, bounty, sentenceSeconds: jailSecondsLeft(ch), estate: { heirId: estate.heirId } };
}

// POST /v1/pen/burner/:targetId — the BURNER PHONE (step two): the ONE way to reach the outside from
// a cell. Consume a burner and call in an NPC hit (jail-gated everywhere else) — two-party. The
// burner is spent only if the call goes through (a bad target etc. throws → the whole txn rolls back,
// so nothing's consumed); the NPC-hit fee burns win or lose, exactly like a street npcHit.
export async function burnerHit(ch, victim, client, h, tierId) {
  insideOnly(ch);
  // shield-not-bunker (audit): a protected inmate can't hunt from under the yard boss's cover — even
  // by phone. Mirrors the shank's penSafe(ch) guard. (npcHit itself gates penSafe/inHole on the TARGET.)
  if (penSafe(ch)) throw new GameError('safe', "You're under the yard boss's protection — take it or hunt, not both.");
  // a LOCKDOWN that freezes the yard freezes an INSIDE kill too — the burner can still reach an
  // OUTSIDE target (a phone call), but it can't route around "no moves on anybody" for a cellmate.
  if (jailed(victim) && activeYardEvent().shankBlock) throw new GameError('lockdown', "Lockdown — no moves on anybody inside today.");
  const held = await contrabandOf(client, ch.id);
  if (!(held.burner > 0)) throw new GameError('no_burner', 'You need a burner phone to reach the outside.');
  // place the call FIRST — npcHit gates the target (family/level/protected/segregated/witpro/cooldown)
  // and throws on a bad call; consume the burner only once it goes through, so a refused call never
  // spends it (no reliance on txn rollback). The NPC-hit fee still burns inside npcHit, win or lose.
  const res = await npcHit(ch, victim, client, h, tierId, { fromBurner: true }); // jail gate waived for the call
  await setContraband(client, ch.id, 'burner', held.burner - 1); // one call, then you eat the SIM
  return { ok: true, burner: true, ...res };
}
