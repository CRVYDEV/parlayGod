// THE LIVING WORLD Phase 2 — NPC RIVAL FAMILIES (design omerta-living-world-design.md).
// A server-wide common enemy: POSITIVE-sum co-op content (the whole base grinds the same reservoir),
// distinct from the zero-sum player turf war. Each fixture holds a shared CASH RESERVOIR (`strength`,
// dollars) that regenerates lazily toward its max; a raid loots a bounded slice and drains it. Total
// emission is bounded by REGEN — a metered world quantity — so `world:raid` is a §10.4-safe faucet
// (a ledgered cash faucet, character_id'd, capped by real activity). Routing an outfit (draining it
// to the floor) pays a one-time bonus + a streets event, then it rebuilds. The ONLY emission surface
// in this pillar — numbers are founder SIM sign-off levers (ground rule #1).
import crypto from 'node:crypto';
import { GameError, bus, assignedSoldier, soldierResult } from './game.js';
import { WORLD_NPCS, worldNpcOf, worldRankOf, WORLD, LIVING, levelOf, effStat, cityHourOf, frontierTributePerHr, cartelUprisingOf, dayOf, soldierFxOf } from './rules.js';

const uid = () => crypto.randomUUID();
const enragedNow = (enragedUntil, now = new Date()) => enragedUntil && new Date(enragedUntil) > now;
const risingNow = (fixture, day = dayOf()) => cartelUprisingOf(day)?.id === fixture.id; // step six: is this outfit rising today
const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';
// step four: a held outfit's accrued tribute to its overlord family (lazy §7.1, capped at TRIBUTE_CAP_MS).
// Only a gang-held outfit with a running clock owes tribute; an unheld/gangless outfit owes nothing.
function frontierTribute(fixture, tributeAt, now = Date.now()) {
  if (!tributeAt) return 0;
  const hrs = Math.min(WORLD.FRONTIER.TRIBUTE_CAP_MS, Math.max(0, now - new Date(tributeAt).getTime())) / 3600000;
  return Math.floor(frontierTributePerHr(fixture) * hrs);
}
// step four: the treasury cost to invade a held outpost — outbid the incumbent's garrison (the SEIZE twin).
const invadeCost = (garrison) => Math.max(WORLD.FRONTIER.INVADE_BASE, Math.floor(Number(garrison || 0) * WORLD.FRONTIER.INVADE_OUTBID));

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const cooling = (ch) => ch.world_raid_at && new Date(ch.world_raid_at) > new Date();

// Lazy §7.1 strength regen toward the fixture max. Seeds the row (at max) on first touch. Returns
// the current strength; the caller writes it back inside its own transaction (or here, under lock).
async function currentStrength(client, fixture, now = new Date()) {
  let row = (await client.query('SELECT strength, strength_at, enraged_until FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [fixture.id])).rows[0];
  if (!row) {
    // seed lazily; a concurrent first-touch may INSERT first — swallow the dup and re-read under
    // lock (audit: FOR UPDATE locks nothing on a missing row, so two first raids both INSERT and
    // the loser 23505'd into a raw 500 instead of a clean retry).
    try {
      await client.query('INSERT INTO world_npcs (npc_id, strength, strength_at) VALUES ($1,$2,$3)', [fixture.id, fixture.max, now]);
      return { strength: fixture.max, enragedUntil: null };
    } catch (e) {
      if (e?.code !== '23505') throw e;
      row = (await client.query('SELECT strength, strength_at, enraged_until FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [fixture.id])).rows[0];
    }
  }
  const hrs = Math.max(0, (now - new Date(row.strength_at)) / 3600000);
  const regened = Math.min(fixture.max, Number(row.strength) + fixture.regenPerHr * hrs);
  return { strength: regened, enragedUntil: row.enraged_until };
}

// STEP FIVE (THE OCCUPATION): the outfit's LIVE strength as a fraction of max — a LOCKLESS read used to
// price a core-district LIBERATION (seizeDistrict), so beating the outfit down cheapens its turf in real
// time. No FOR UPDATE (it's a cost quote; the district-row lock serializes the actual transfer). An
// un-touched outfit (no row yet — seeded at max on its first raid) reads at full strength.
export async function outfitStrengthFrac(client, fixture) {
  if (!fixture) return 1;
  const row = (await client.query('SELECT strength, strength_at FROM world_npcs WHERE npc_id=$1', [fixture.id])).rows[0];
  if (!row) return 1;
  const hrs = Math.max(0, (Date.now() - new Date(row.strength_at).getTime()) / 3600000);
  const strength = Math.min(fixture.max, Number(row.strength) + fixture.regenPerHr * hrs);
  return Math.max(0, Math.min(1, strength / fixture.max));
}

// GET /v1/world — the NPC board (public read: each outfit's status band + your raid odds tonight).
// Uses a fresh connection so a read doesn't lock; strength is the regened (effective) value.
export async function worldBoard(pool, ch = null, h = null) {
  const now = new Date();
  const today = dayOf();
  const rising = cartelUprisingOf(today); // step six: the outfit rising up today (or null)
  const patrol = cityHourOf(now.getTime()).patrol;
  const rows = Object.fromEntries((await pool.query('SELECT npc_id, strength, strength_at, enraged_until, held_by_gang, held_since, garrison, tribute_at FROM world_npcs')).rows
    .map((r) => [r.npc_id, r]));
  const lvl = ch ? levelOf(Number(ch.respect)) : 0;
  const power = ch ? raiderPower(ch, h) : 0;
  // frontier holders — a name per held outfit (LEFT JOIN so a dissolved family shows as open)
  const heldIds = [...new Set(Object.values(rows).map((r) => r.held_by_gang).filter(Boolean))];
  const gangNames = {};
  if (heldIds.length) {
    const ph = heldIds.map((_, i) => `$${i + 1}`).join(',');
    for (const g of (await pool.query(`SELECT id, name, tag FROM gangs WHERE id IN (${ph})`, heldIds)).rows) gangNames[g.id] = g;
  }
  // THE WAR EFFORT — your lifetime cartel damage + rank (account-level, survives death)
  let effort = null, myRaid = null;
  if (ch) {
    const dmg = Number((await pool.query('SELECT cartel_damage FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.cartel_damage || 0);
    effort = { damage: dmg, rank: worldRankOf(dmg).name };
    // the crew raid this street is currently on, if any (the co-op board is a separate read)
    const r = (await pool.query(
      `SELECT r.id, r.npc_id, r.leader_character FROM world_raid_members m JOIN world_raids r ON r.id=m.raid_id
        WHERE m.character_id=$1 AND r.status='planning'`, [ch.id])).rows[0];
    if (r) {
      const crew = Number((await pool.query('SELECT COUNT(*) n FROM world_raid_members WHERE raid_id=$1', [r.id])).rows[0].n);
      myRaid = { id: r.id, npc: r.npc_id, leader: r.leader_character === ch.id, crew };
    }
  }
  return {
    phase: patrol ? 'day' : 'night',
    nightRaidBonus: !patrol,                       // the small hours favour a raid (NPCs -10% defense)
    warEffort: effort,
    myRaid,                                        // step three: your active co-op raid, if any
    coop: { min: WORLD.COOP_MIN, max: WORLD.COOP_MAX_CREW },
    npcs: WORLD_NPCS.map((f) => {
      const row = rows[f.id];
      const strength = row
        ? Math.min(f.max, Number(row.strength) + f.regenPerHr * Math.max(0, (now - new Date(row.strength_at)) / 3600000))
        : f.max;
      const routed = strength <= f.max * WORLD.ROUT_FLOOR_BPS / 10000;
      const enraged = enragedNow(row?.enraged_until, now); // a routed cartel on high alert defends harder
      const isRising = rising?.id === f.id;               // step six: this outfit is in revolt today
      const holder = row?.held_by_gang && gangNames[row.held_by_gang];
      const mine = !!(h?.owned?.gangId && h.owned.gangId === row?.held_by_gang);
      // step four — the outpost economics: a held outfit pays TRIBUTE + carries a garrison a rival outbids
      const tributePerHr = frontierTributePerHr(f);
      return {
        id: f.id, name: f.name, minLvl: f.minLvl, coop: !!f.coop,
        // never the exact reservoir (like the convoy value band) — a status read
        strengthPct: Math.round(strength / f.max * 100),
        routed, enraged, rising: isRising,               // step six: RISING flag (heightened defense + tribute suspended)
        heldBy: holder ? { name: holder.name, tag: holder.tag, mine } : null,
        tributePerHr,
        tributePending: mine ? (isRising ? 0 : frontierTribute(f, row.tribute_at, now.getTime())) : null, // a rebelling vassal pays no tribute
        garrison: holder ? Math.floor(Number(row.garrison || 0)) : null,
        // step six: the garrison a HELD outpost needs to GUARANTEE a repel at the reckoning. Red-team LOW-1:
        // the reckoning scales `need` by the outfit's RESOLVE-time strength (higher after regen than at this
        // read), so surface the FULL-STRENGTH (worst-case) need — reinforce to this and you can't be caught
        // out by regen. A beaten-down outfit's real need is lower (the interlock still holds at the reckoning),
        // so this is the conservative safe target, never an under-statement that traps the defender.
        upriseNeed: mine && isRising ? Math.floor(f.max * WORLD.UPRISING.THRESHOLD_BPS / 10000) : null,
        reinforceMin: mine ? WORLD.UPRISING.REINFORCE_MIN : null, // the floor to stiffen your garrison
        invadeCost: holder && !mine ? invadeCost(row.garrison) : null, // what it'd cost your family to take it
        canRaid: !!ch && lvl >= f.minLvl && !f.coop, // SIGN-OFF (1.3): apex (coop) outfits need a crew, not a solo hit
        odds: ch && lvl >= f.minLvl ? Math.round(raidChance(f, power, patrol, enraged, isRising) * 100) : null,
      };
    }),
    // step four: your family's total collectable tribute across every outpost it holds (a treasury faucet)
    frontier: h?.owned?.gangId ? (() => {
      let pending = 0, held = 0;
      for (const f of WORLD_NPCS) { const row = rows[f.id]; if (row?.held_by_gang === h.owned.gangId) { held++; if (rising?.id !== f.id) pending += frontierTribute(f, row.tribute_at, now.getTime()); } }
      return { held, tributePending: pending, canCommand: canCommand({ owned: { gangRole: h.owned.gangRole } }) };
    })() : null,
    // step six: the day's cartel uprising (forecast-able; the reckoning hits an undefended held outpost)
    uprising: rising ? { npc: rising.id, name: rising.name } : null,
  };
}

// GET /v1/world/raids — the open co-op raid board (planning raids looking for crew). Two flat queries
// (pg-mem can't parse a correlated subquery — the heistBoard/GET-/v1/gangs precedent).
export async function raidBoard(pool, characterId = null) {
  const raids = (await pool.query(
    `SELECT r.id, r.npc_id, r.leader_character, r.created_at, c.name AS leader_name
       FROM world_raids r JOIN characters c ON c.id=r.leader_character
      WHERE r.status='planning' AND r.created_at > $1 ORDER BY r.created_at DESC`,
    [new Date(Date.now() - WORLD.COOP_TTL_MS)])).rows;
  if (!raids.length) return { raids: [] };
  const ph = raids.map((_, i) => `$${i + 1}`).join(',');
  const counts = {};
  for (const m of (await pool.query(`SELECT raid_id, COUNT(*) n FROM world_raid_members WHERE raid_id IN (${ph}) GROUP BY raid_id`,
    raids.map((r) => r.id))).rows) counts[m.raid_id] = Number(m.n);
  return {
    raids: raids.map((r) => {
      const f = worldNpcOf(r.npc_id);
      return { id: r.id, npc: r.npc_id, name: f?.name, minLvl: f?.minLvl, leader: r.leader_name,
        mine: characterId === r.leader_character, crew: counts[r.id] || 0, crewMax: WORLD.COOP_MAX_CREW };
    }),
  };
}

// GET /v1/leaderboard/frontier — THE FRONTIER board: families ranked by outfits held, weighted by the
// outfit's scale (holding Volkov outranks holding the Dock Rats). Pure status — dies with the family.
export async function frontierLeaderboard(pool) {
  const held = (await pool.query('SELECT npc_id, held_by_gang FROM world_npcs WHERE held_by_gang IS NOT NULL')).rows;
  const by = {};
  for (const r of held) {
    const f = worldNpcOf(r.npc_id);
    (by[r.held_by_gang] = by[r.held_by_gang] || { outfits: [], weight: 0 });
    by[r.held_by_gang].outfits.push(f?.name || r.npc_id);
    by[r.held_by_gang].weight += f?.max || 0; // the reservoir max as a scale weight
  }
  const ids = Object.keys(by);
  if (!ids.length) return { families: [] };
  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  const names = Object.fromEntries((await pool.query(`SELECT id, name, tag FROM gangs WHERE id IN (${ph})`, ids)).rows.map((g) => [g.id, g]));
  return {
    families: ids.filter((id) => names[id])   // a dissolved family drops off (its holds read open elsewhere)
      .map((id) => ({ name: names[id].name, tag: names[id].tag, held: by[id].outfits.length, outfits: by[id].outfits, weight: by[id].weight }))
      .sort((a, b) => b.held - a.held || b.weight - a.weight).slice(0, 15),
  };
}

// GET /v1/leaderboard/world — THE WAR EFFORT board: the base's most feared cartel-hunters by lifetime
// cash looted from NPC outfits (living stewards of an account-level, death-surviving status axis).
export async function worldLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.cartel_damage, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.cartel_damage > 0 ORDER BY a.cartel_damage DESC LIMIT 15`)).rows;
  return { hunters: rows.map((r) => ({ name: r.name, damage: Number(r.cartel_damage), rank: worldRankOf(r.cartel_damage).name })) };
}

// the raider's muscle behind a raid — effective muscle + half effective speed (a jump-shaped stat mix)
function raiderPower(ch, h) {
  const assets = h?.owned?.assets || [], gear = h?.owned?.gear || [];
  return effStat(Number(ch.muscle), 'muscle', assets, gear) + effStat(Number(ch.speed), 'speed', assets, gear) / 2;
}
// success chance — the fixture's base + the raider's edge over its defense; night eases the defense,
// an ENRAGED cartel (recently routed) defends harder (step two), and an outfit mid-UPRISING defends
// harder still (step six — both emission-safe: lower odds, can't be farmed during its own revolt).
function raidChance(fixture, power, patrol, enraged = false, rising = false) {
  const def = fixture.def * (patrol ? 1 : LIVING.NIGHT_RAID_MULT) + (enraged ? WORLD.ENRAGE_DEF : 0) + (rising ? WORLD.UPRISING.DEF : 0);
  return Math.max(0.1, Math.min(0.9, fixture.base + (power - def) / 400));
}

// POST /v1/world/:npcId/raid — hit an NPC outfit. Runs under withCharacter (ch locked). The NPC row
// is locked here (characters → singletons order — world_npcs is a singleton-class row, no cycle).
export async function raidNpc(ch, npcId, client, h) {
  const fixture = worldNpcOf(npcId);
  if (!fixture) throw new GameError('bad_npc', 'No outfit by that name to hit.');
  // SIGN-OFF (1.3): an apex outfit is too heavy to SOLO — it must be hit with a crew (planRaid → executeRaid).
  // Closes the min-level-whale-solos-an-apex floor (the audit's B1); the crew path gates the inverse (`solo`).
  if (fixture.coop) throw new GameError('crew', `${fixture.name} is too well-defended to hit alone — put a crew together (plan a raid).`);
  if (jailed(ch)) throw new GameError('jailed', 'No moves from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't run an op from a safehouse.");
  if (hospitalized(ch)) throw new GameError('hosp', 'Not in any shape to run an op — see the Doc first.'); // parity with convoy/heist ambush
  const lvl = levelOf(Number(ch.respect));
  if (lvl < fixture.minLvl) throw new GameError('level', `Hitting ${fixture.name} takes level ${fixture.minLvl}.`);
  if (ch.world_raid_at && new Date(ch.world_raid_at) > new Date()) throw new GameError('cooldown', 'Your crew needs to regroup before the next hit.');
  if (Number(ch.energy) < WORLD.RAID_ENERGY) throw new GameError('energy', `A raid takes ${WORLD.RAID_ENERGY} energy.`);
  if (Number(ch.ammo) < WORLD.RAID_AMMO) throw new GameError('ammo', `Bring at least ${WORLD.RAID_AMMO} rounds.`);

  const now = new Date();
  const patrol = cityHourOf(now.getTime()).patrol;
  const { strength, enragedUntil } = await currentStrength(client, fixture, now); // regened + row-locked
  const enraged = enragedNow(enragedUntil, now); // a recently-routed cartel defends harder
  const rising = risingNow(fixture); // step six: an outfit mid-uprising defends harder

  // pay the price up front (energy + ammo + heat + cooldown), win or lose
  ch.energy = Number(ch.energy) - WORLD.RAID_ENERGY;
  ch.ammo = Number(ch.ammo) - WORLD.RAID_AMMO;
  ch.heat = Math.min(100, Number(ch.heat || 0) + WORLD.RAID_HEAT);
  ch.world_raid_at = new Date(now.getTime() + WORLD.RAID_CD_MS);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -WORLD.RAID_AMMO, reason: 'world:raid' });

  // SOLDIERS: a GUNNER second adds firepower (a modifier on the reservoir-BOUNDED faucet — sim +
  // sign-off, the co-op-raid precedent); a repel is the risky outcome for whoever rides along
  const second = await assignedSoldier(client, ch.id);
  const power = raiderPower(ch, h)
    + (second?.trait === 'gunner' ? soldierFxOf(second) : 0);
  // WORLD_RAID_P is a TEST-ONLY knob (the LAW_BUST_P / GEAR_LOOT_CHANCE precedent) that pins the raid
  // outcome so loot/rout/repel are deterministic in tests — never set in production.
  const p = process.env.WORLD_RAID_P != null ? Number(process.env.WORLD_RAID_P) : raidChance(fixture, power, patrol, enraged, rising);
  const roll = Math.random();
  await h.rngLog(client, ch.id, `world:${fixture.id}`, roll, roll < p ? 'raid' : 'repelled');

  if (roll >= p) {
    // repelled — the NPC's soldiers hospitalize the raider; the reservoir is untouched (regen stamped)
    ch.hosp_until = new Date(now.getTime() + WORLD.FAIL_HOSP_MS);
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3 WHERE npc_id=$1', [fixture.id, strength, now]);
    await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: false });
    const soldier = second ? await soldierResult(client, h, ch, second, { success: false, cause: `repelled by ${fixture.name}` }) : null;
    return { ok: true, success: false, npc: fixture.id, enraged, hospSeconds: Math.round(WORLD.FAIL_HOSP_MS / 1000), soldier };
  }

  // landed — loot a bounded slice of the reservoir (GRAB_BPS, capped), draining it by exactly the loot
  const loot = Math.min(Math.floor(strength * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX, Math.floor(strength));
  let after = strength - loot;
  ch.cash = Number(ch.cash) + loot;
  if (loot > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: loot, reason: 'world:raid', counterparty: fixture.id });
  // THE WAR EFFORT — bank the lifetime cartel damage (account-level, survives death — the kills/boxing
  // precedent; direct SQL on account_persistent so persistAccount can't clobber it; NUMERIC = arith-safe)
  if (loot > 0) await client.query('UPDATE account_persistent SET cartel_damage = cartel_damage + $2 WHERE account_id=$1', [ch.account_id, loot]);

  // routing an outfit pays a one-time bonus + tells the streets — ONLY on the floor CROSSING
  // (audit: without the `strength > floorVal` guard, every raid while the shared reservoir sits
  // pinned below the floor re-paid the flat bonus — an unbounded mint not backed by regen).
  const floorVal = fixture.max * WORLD.ROUT_FLOOR_BPS / 10000;
  let routed = false, routBonus = 0, newEnraged = enragedUntil;
  if (strength > floorVal && after <= floorVal) {
    routed = true; routBonus = fixture.routBonus;
    ch.cash = Number(ch.cash) + routBonus;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: routBonus, reason: 'world:raid', counterparty: fixture.id });
    await client.query('UPDATE account_persistent SET cartel_damage = cartel_damage + $2 WHERE account_id=$1', [ch.account_id, routBonus]);
    newEnraged = new Date(now.getTime() + WORLD.ENRAGE_MS); // the cartel goes to high alert — harder to raid for a window
    bus.emit('streets', { type: 'world_routed', who: ch.name, npc: fixture.name });
  }
  // THE FRONTIER (step three): a ROUT topples the incumbent and plants the router's FAMILY flag
  // (pure status; a gangless router leaves it UNHELD/open). Only changes on the crossing.
  if (routed) {
    const heldGang = h.owned.gangId || null;
    // step four: taking the outpost installs a base GARRISON (a rival must outbid it to invade) and starts
    // the TRIBUTE clock; the old holder's uncollected tribute forfeits (a fresh clock). A gangless router
    // leaves it open (garrison 0, no tribute clock).
    const garrison = heldGang ? WORLD.FRONTIER.ROUT_GARRISON : 0;
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3, enraged_until=$4, held_by_gang=$5, held_since=$6, garrison=$7, tribute_at=$8 WHERE npc_id=$1',
      [fixture.id, after, now, newEnraged, heldGang, now, garrison, heldGang ? now : null]);
    if (heldGang) bus.emit('streets', { type: 'frontier_seized', gang: h.owned.gang?.name, npc: fixture.name });
  } else {
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3, enraged_until=$4 WHERE npc_id=$1', [fixture.id, after, now, newEnraged]);
  }
  await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: true, loot, routed });
  const soldier = second ? await soldierResult(client, h, ch, second, { success: true }) : null;
  return { ok: true, success: true, npc: fixture.id, loot, routed, routBonus, enraged, frontier: routed && !!h.owned.gangId, strengthPct: Math.round(Math.max(0, after) / fixture.max * 100), soldier };
}

// ── STEP THREE — CO-OP CREW RAIDS on the apex outfits (the crew-heist machinery) ──
// A leader opens the op, made raiders join off the board, the leader calls the go and ONE roll pays
// the whole crew. NO stake (each raider pays their own energy/ammo/heat at execute — the solo-raid
// cost), so the loot is the SAME bounded reservoir slice, just split; §10.4-neutral vs solo.
const staleRaid = (row) => Date.now() - new Date(row.created_at).getTime() > WORLD.COOP_TTL_MS;

async function activeRaidMembership(client, characterId) {
  return (await client.query(
    `SELECT m.raid_id FROM world_raid_members m JOIN world_raids r ON r.id = m.raid_id
      WHERE m.character_id=$1 AND r.status='planning'`, [characterId])).rows[0] || null;
}
// the raider must show up clean, armed, rested, and made for this outfit (the heist gateJoiner twin)
function gateRaider(ch, fixture) {
  if (jailed(ch)) throw new GameError('jailed', 'No raids from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', 'Not in any shape to run an op — see the Doc first.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't run an op from a safehouse.");
  if (cooling(ch)) throw new GameError('cooldown', 'Your crew needs to regroup before the next hit.');
  if (levelOf(Number(ch.respect)) < fixture.minLvl) throw new GameError('level', `Hitting ${fixture.name} takes level ${fixture.minLvl}.`);
  if (Number(ch.energy) < WORLD.RAID_ENERGY) throw new GameError('energy', `A raid takes ${WORLD.RAID_ENERGY} energy.`);
  if (Number(ch.ammo) < WORLD.RAID_AMMO) throw new GameError('ammo', `Bring at least ${WORLD.RAID_AMMO} rounds.`);
}

// POST /v1/world/:npcId/plan — open a co-op raid (apex outfits only; they're too well-defended to solo).
export async function planRaid(ch, npcId, client, h) {
  const fixture = worldNpcOf(npcId);
  if (!fixture) throw new GameError('bad_npc', 'No outfit by that name to hit.');
  if (!fixture.coop) throw new GameError('solo', `${fixture.name} is a solo hit — no crew needed.`);
  gateRaider(ch, fixture);
  if (await activeRaidMembership(client, ch.id)) throw new GameError('busy', "You're already on a raid.");
  const id = uid();
  await client.query('INSERT INTO world_raids (id, npc_id, leader_character) VALUES ($1,$2,$3)', [id, fixture.id, ch.id]);
  await client.query('INSERT INTO world_raid_members (raid_id, character_id) VALUES ($1,$2)', [id, ch.id]);
  await h.track(client, ch.account_id, 'world_raid_plan', { npc: fixture.id });
  return { ok: true, id, npc: fixture.id, name: fixture.name, crewMin: WORLD.COOP_MIN, crewMax: WORLD.COOP_MAX_CREW };
}

// POST /v1/world/raids/:id/join — off the open board; the outfit's gates apply to every raider.
export async function joinRaid(ch, raidId, client, h) {
  const row = (await client.query("SELECT * FROM world_raids WHERE id=$1 AND status='planning' FOR UPDATE", [raidId])).rows[0];
  if (!row) throw new GameError('no_raid', 'That raid is gone.');
  if (staleRaid(row)) throw new GameError('stale', 'That plan went cold.');
  const fixture = worldNpcOf(row.npc_id);
  gateRaider(ch, fixture);
  if (await activeRaidMembership(client, ch.id)) throw new GameError('busy', "You're already on a raid.");
  const crew = (await client.query('SELECT 1 FROM world_raid_members WHERE raid_id=$1', [raidId])).rows.length;
  if (crew >= WORLD.COOP_MAX_CREW) throw new GameError('full', 'The crew is set.');
  await client.query('INSERT INTO world_raid_members (raid_id, character_id) VALUES ($1,$2)', [raidId, ch.id]);
  await h.track(client, ch.account_id, 'world_raid_join', { npc: fixture.id });
  return { ok: true, id: raidId, npc: fixture.id, crew: crew + 1, crewMax: WORLD.COOP_MAX_CREW };
}

// POST /v1/world/raids/:id/leave — a raider walks; the LEADER walking disbands the op (no stake to refund).
export async function leaveRaid(ch, raidId, client, h) {
  const row = (await client.query("SELECT * FROM world_raids WHERE id=$1 AND status='planning' FOR UPDATE", [raidId])).rows[0];
  if (!row) throw new GameError('no_raid', 'That raid is gone.');
  const mine = (await client.query('SELECT 1 FROM world_raid_members WHERE raid_id=$1 AND character_id=$2', [raidId, ch.id])).rows[0];
  if (!mine) throw new GameError('not_crew', "You're not on that raid.");
  if (row.leader_character === ch.id) {
    await client.query("UPDATE world_raids SET status='abandoned' WHERE id=$1", [raidId]);
    await client.query('DELETE FROM world_raid_members WHERE raid_id=$1', [raidId]);
    return { ok: true, disbanded: true };
  }
  await client.query('DELETE FROM world_raid_members WHERE raid_id=$1 AND character_id=$2', [raidId, ch.id]);
  return { ok: true, left: true };
}

// POST /v1/world/raids/:id/go — leader-only, crew ready. ONE roll on COMBINED firepower for everyone.
// Lock order (the executeHeist twin): leader (withCharacter) → member character rows SORTED → the raid
// row → world_npcs (singleton). One-active-raid-per-character keeps concurrent executes disjoint (acyclic);
// members are paid/costed by direct row UPDATE under lock (never in-memory — no persistCharacter clobber).
export async function executeRaid(ch, raidId, client, h) {
  if (safeHoused(ch)) throw new GameError('safe', "You can't run an op from a safehouse.");
  const pre = (await client.query("SELECT * FROM world_raids WHERE id=$1 AND status='planning'", [raidId])).rows[0];
  if (!pre) throw new GameError('no_raid', 'That raid is gone.');
  if (pre.leader_character !== ch.id) throw new GameError('not_leader', 'The leader calls the go.');
  if (staleRaid(pre)) throw new GameError('stale', 'That plan went cold — walk away and start fresh.');
  const fixture = worldNpcOf(pre.npc_id);
  const preIds = (await client.query('SELECT character_id FROM world_raid_members WHERE raid_id=$1', [raidId])).rows.map((r) => r.character_id);
  const others = {};
  for (const id of preIds.filter((id) => id !== ch.id).sort()) {
    const r = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    if (!r) throw new GameError('crew_not_ready', 'One of the crew is in the ground. Recrew.');
    others[id] = r;
  }
  // NOW the raid row — verify the crew we locked is still the crew
  const row = (await client.query("SELECT * FROM world_raids WHERE id=$1 AND status='planning' FOR UPDATE", [raidId])).rows[0];
  if (!row) throw new GameError('no_raid', 'That raid is gone.');
  const members = (await client.query('SELECT character_id FROM world_raid_members WHERE raid_id=$1', [raidId])).rows.map((r) => r.character_id);
  if (members.slice().sort().join() !== [...preIds].sort().join()) throw new GameError('crew_changed', 'The crew shifted under you — call the go again.');
  if (members.length < WORLD.COOP_MIN) throw new GameError('crew_short', `A raid on ${fixture.name} needs at least ${WORLD.COOP_MIN} — you have ${members.length}.`);
  const crewRows = [ch, ...Object.values(others)];
  for (const m of crewRows) {
    if (jailed(m) || hospitalized(m) || safeHoused(m) || (m.id !== ch.id && cooling(m)))
      throw new GameError('crew_not_ready', 'The whole crew shows up clean, healthy, rested, and OUT of hiding — or nobody goes.');
    if (levelOf(Number(m.respect)) < fixture.minLvl) throw new GameError('crew_not_ready', `Every raider needs level ${fixture.minLvl} for ${fixture.name}.`);
    if (Number(m.energy) < WORLD.RAID_ENERGY || Number(m.ammo) < WORLD.RAID_AMMO)
      throw new GameError('crew_not_ready', 'Every raider brings the energy and the rounds.');
  }
  if (cooling(ch)) throw new GameError('cooldown', 'Your next raid lines up later.');

  const now = new Date();
  const patrol = cityHourOf(now.getTime()).patrol;
  const { strength, enragedUntil } = await currentStrength(client, fixture, now); // regened + row-locked (singleton, last)
  const enraged = enragedNow(enragedUntil, now);
  await client.query("UPDATE world_raids SET status='done' WHERE id=$1", [raidId]);

  // each raider pays their OWN cost + cooldown up front, win or lose; the ammo is a §10.4 sink per head
  const cd = new Date(now.getTime() + WORLD.RAID_CD_MS);
  const setMember = async (id, cols, params) => client.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id, ...params]);
  for (const m of crewRows) {
    if (m.id === ch.id) { ch.energy = Number(ch.energy) - WORLD.RAID_ENERGY; ch.ammo = Number(ch.ammo) - WORLD.RAID_AMMO; ch.heat = Math.min(100, Number(ch.heat || 0) + WORLD.RAID_HEAT); ch.world_raid_at = cd; }
    else await setMember(m.id, 'energy=$2, ammo=$3, heat=$4, world_raid_at=$5',
      [Number(m.energy) - WORLD.RAID_ENERGY, Number(m.ammo) - WORLD.RAID_AMMO, Math.min(100, Number(m.heat || 0) + WORLD.RAID_HEAT), cd]);
    await h.ledger(client, { characterId: m.id, currency: 'ammo', amount: -WORLD.RAID_AMMO, reason: 'world:raid' });
  }

  // COMBINED firepower (SUM, not avg — many guns) over the (enraged?) defense is how a crew cracks an apex.
  // Members' gear/assets aren't loaded here (only the leader's h), so member power reads base stats — the
  // COOP_SCALE is tuned for that; a geared member is a small bonus not counted, never a penalty.
  const sumPower = crewRows.reduce((a, m) => a + raiderPower(m, m.id === ch.id ? h : null), 0);
  const def = fixture.def * (patrol ? 1 : LIVING.NIGHT_RAID_MULT) + (enraged ? WORLD.ENRAGE_DEF : 0);
  // WORLD_RAID_P is a TEST-ONLY knob (the solo-raid precedent) pinning the outcome for deterministic tests.
  const p = process.env.WORLD_RAID_P != null ? Number(process.env.WORLD_RAID_P)
    : Math.max(0.1, Math.min(WORLD.COOP_MAX_P, fixture.base + (sumPower - def) / WORLD.COOP_SCALE));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `world:coop:${fixture.id}`, roll, `${roll < p ? 'raid' : 'repelled'} (crew ${crewRows.length})`);

  if (roll >= p) {
    // repelled — the WHOLE crew is hospitalized together; the reservoir is untouched (regen stamped)
    const hospTo = new Date(now.getTime() + WORLD.FAIL_HOSP_MS);
    for (const m of crewRows) {
      if (m.id === ch.id) ch.hosp_until = hospTo;
      else { await setMember(m.id, 'hosp_until=$2', [hospTo]); await h.notify(client, m.id, 'world_raid_fail', { npc: fixture.id }); }
    }
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3 WHERE npc_id=$1', [fixture.id, strength, now]);
    await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: false, crew: crewRows.length });
    return { ok: true, success: false, npc: fixture.id, crew: crewRows.length, hospSeconds: Math.round(WORLD.FAIL_HOSP_MS / 1000) };
  }

  // landed — the bounded reservoir slice is the pot (+ the rout windfall if this crossing routs it)
  let pot = Math.min(Math.floor(strength * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX, Math.floor(strength));
  const after = strength - pot;
  const floorVal = fixture.max * WORLD.ROUT_FLOOR_BPS / 10000;
  let routed = false, newEnraged = enragedUntil;
  if (strength > floorVal && after <= floorVal) { routed = true; pot += fixture.routBonus; newEnraged = new Date(now.getTime() + WORLD.ENRAGE_MS); }

  // split like a heist pot (leader weight); each share a world:raid faucet + a cartel_damage bump (war effort)
  const unit = pot / (WORLD.COOP_LEADER_WEIGHT + (crewRows.length - 1));
  const shares = {};
  for (const m of crewRows) shares[m.id] = Math.floor(unit * (m.id === ch.id ? WORLD.COOP_LEADER_WEIGHT : 1));
  for (const m of crewRows) {
    const share = shares[m.id];
    if (m.id === ch.id) ch.cash = Number(ch.cash) + share;
    else { await setMember(m.id, 'cash=$2', [Number(m.cash) + share]); await h.notify(client, m.id, 'world_raid_score', { npc: fixture.id, share, routed }); }
    if (share > 0) {
      await h.ledger(client, { characterId: m.id, currency: 'cash', amount: share, reason: 'world:raid', counterparty: fixture.id });
      await client.query('UPDATE account_persistent SET cartel_damage = cartel_damage + $2 WHERE account_id=$1', [m.account_id, share]);
    }
  }
  // THE FRONTIER — a rout plants the LEADER's family flag (pure status; gangless leader leaves it open)
  const heldGang = routed ? (h.owned.gangId || null) : undefined;
  if (routed) {
    // step four: the rout installs the leader's family garrison + starts the tribute clock (see raidNpc)
    const garrison = heldGang ? WORLD.FRONTIER.ROUT_GARRISON : 0;
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3, enraged_until=$4, held_by_gang=$5, held_since=$6, garrison=$7, tribute_at=$8 WHERE npc_id=$1',
      [fixture.id, after, now, newEnraged, heldGang, now, garrison, heldGang ? now : null]);
    bus.emit('streets', { type: 'world_routed', who: ch.name, npc: fixture.name, crew: crewRows.length });
    if (heldGang) bus.emit('streets', { type: 'frontier_seized', gang: h.owned.gang?.name, npc: fixture.name });
  } else {
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3, enraged_until=$4 WHERE npc_id=$1', [fixture.id, after, now, newEnraged]);
  }
  await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: true, pot, routed, crew: crewRows.length });
  return { ok: true, success: true, npc: fixture.id, crew: crewRows.length, pot, share: shares[ch.id], routed,
    frontier: routed && !!heldGang, strengthPct: Math.round(Math.max(0, after) / fixture.max * 100) };
}

// worker: sweep stale co-op raid plans (nothing staked → just clear the board). Leader-before-raid-row
// lock order (no character locks, so no cycle). Per-raid txn (a poison row can't starve the sweep).
export async function sweepStaleRaids(pool) {
  const stale = (await pool.query(
    "SELECT id FROM world_raids WHERE status='planning' AND created_at < $1",
    [new Date(Date.now() - WORLD.COOP_TTL_MS)])).rows;
  let swept = 0;
  for (const { id } of stale) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query("SELECT id FROM world_raids WHERE id=$1 AND status='planning' FOR UPDATE", [id])).rows[0];
      if (row) {
        await client.query("UPDATE world_raids SET status='abandoned' WHERE id=$1", [id]);
        await client.query('DELETE FROM world_raid_members WHERE raid_id=$1', [id]);
        swept++;
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepStaleRaids]', id, e?.code || e?.message || e); } finally { client.release(); }
  }
  return { swept };
}

// A dissolving family drops every frontier flag it holds (the outfits read open — the house takes its
// turf back). Called from gang dissolution, under the gang-row lock (no character/npc lock → no cycle).
// Step four: the garrison + tribute clock reset too (uncollected tribute dies with the family).
export async function releaseFrontierHolds(client, gangId) {
  await client.query('UPDATE world_npcs SET held_by_gang=NULL, held_since=NULL, garrison=0, tribute_at=NULL WHERE held_by_gang=$1', [gangId]);
}

// ── STEP FOUR — THE FRONTIER MADE REAL (productive + contestable outposts) ──
// POST /v1/world/collect — bank the accrued TRIBUTE from every outfit the family holds → the treasury.
// Any member can (the income is the family's — the collectTerritory precedent). Lock order: gang (own,
// treasury) → world_npcs rows (singletons, last). A §10.4 treasury FAUCET `world:tribute` (character_id
// NULL, counterparty = the gang — added to the treasury check's IN terms), bounded by the outfit's regen
// + the 24h cap. Uncollected tribute forfeits on a flag transfer (rout/invasion), so this is pull-or-lose.
export async function collectFrontier(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  // BALANCE D2 (SIGNED) — shield, not bunker: banking a productive income stream is an EXPOSED act,
  // blocked while safehoused, exactly like collectTerritory/business/convoy collection (audit F1).
  if (safeHoused(ch)) throw new GameError('safe', 'The runners report to a man on the street, not a ghost — collection waits until you surface.');
  const now = new Date();
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const held = (await client.query('SELECT npc_id, tribute_at FROM world_npcs WHERE held_by_gang=$1 FOR UPDATE', [h.owned.gangId])).rows;
  let total = 0; const collected = [];
  for (const r of held) {
    const fixture = worldNpcOf(r.npc_id);
    if (!fixture) continue;
    if (risingNow(fixture)) continue; // step six: a rebelling vassal pays no tribute — wait out the uprising (the clock keeps running, capped)
    const owed = frontierTribute(fixture, r.tribute_at, now.getTime());
    if (owed > 0) {
      total += owed;
      collected.push({ npc: r.npc_id, name: fixture.name, tribute: owed });
      await client.query('UPDATE world_npcs SET tribute_at=$2 WHERE npc_id=$1', [r.npc_id, now]);
    }
  }
  if (total <= 0) return { ok: true, collected: 0, outposts: held.length };
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [h.owned.gangId, total]);
  await h.ledger(client, { currency: 'cash', amount: total, reason: 'world:tribute', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + total;
  return { ok: true, collected: total, tributes: collected };
}

// POST /v1/world/:npcId/invade — a boss/underboss takes a RIVAL-held outpost by outbidding its garrison
// from the treasury (the seizeDistrict pattern — a §10.4 treasury SINK `world:invade`). The flag, a fresh
// garrison, and the tribute clock transfer; the incumbent's uncollected tribute forfeits. You take an
// UNHELD outfit by ROUTING it (this is only for taking one from another family). Lock: own gang → world_npcs.
export async function invadeOutpost(ch, npcId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss marches on the frontier.');
  const fixture = worldNpcOf(npcId);
  if (!fixture) throw new GameError('bad_npc', 'No outfit by that name.');
  // B1 (audit) — you can only HOLD turf you could RAID: the invader must clear the outfit's raid level,
  // so money alone can't seat a rookie family on an apex outpost (consistency with the rout minLvl gate).
  if (levelOf(Number(ch.respect)) < fixture.minLvl) throw new GameError('level', `Holding ${fixture.name}'s turf takes level ${fixture.minLvl}.`);
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const row = (await client.query('SELECT held_by_gang, garrison FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [npcId])).rows[0];
  if (!row || !row.held_by_gang) throw new GameError('unheld', `Nobody holds ${fixture.name} — rout it to take the turf.`);
  if (row.held_by_gang === h.owned.gangId) throw new GameError('held', 'Your family already holds that outpost.');
  const cost = invadeCost(row.garrison);
  if (Number(g.treasury) < cost) throw new GameError('treasury', `Marching on ${fixture.name} takes $${cost} from the treasury.`);
  const now = new Date();
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, cost]);
  // the invader installs a fresh garrison (their stake becomes the new defense budget); the old holder's
  // uncollected tribute forfeits (fresh clock). §10.4: the whole cost BURNS as the war chest (the seize
  // precedent — only the base garrison is the new budget; here the stake IS the garrison, all one sink).
  await client.query('UPDATE world_npcs SET held_by_gang=$2, held_since=$3, garrison=$4, tribute_at=$3 WHERE npc_id=$1',
    [npcId, h.owned.gangId, now, cost]);
  await h.ledger(client, { currency: 'cash', amount: -cost, reason: 'world:invade', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - cost;
  bus.emit('streets', { type: 'frontier_seized', gang: h.owned.gang?.name, npc: fixture.name });
  return { ok: true, npc: npcId, name: fixture.name, cost, garrison: cost };
}

// ── STEP SIX — THE UPRISING (the world pushes back) ──
// POST /v1/world/:npcId/reinforce {amount} — a boss/underboss pays the TREASURY to stiffen a held
// outpost's garrison (a §10.4 treasury cash SINK `world:reinforce` — the territory-fortify twin). The
// garrison defends against BOTH the cartel uprising's reckoning AND a rival family's invasion (invadeCost
// outbids it), so it's never wasted. Lock: own gang → world_npcs (the invadeOutpost order).
export async function reinforceOutpost(ch, npcId, amount, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss funds the garrison.');
  const fixture = worldNpcOf(npcId);
  if (!fixture) throw new GameError('bad_npc', 'No outfit by that name.');
  const amt = Math.floor(Number(amount));
  if (!(Number.isFinite(amt) && amt >= WORLD.UPRISING.REINFORCE_MIN)) throw new GameError('amount', `Reinforcing the garrison takes at least $${WORLD.UPRISING.REINFORCE_MIN}.`);
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const row = (await client.query('SELECT held_by_gang, garrison FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [npcId])).rows[0];
  if (!row || row.held_by_gang !== h.owned.gangId) throw new GameError('not_held', "Your family doesn't hold that outpost.");
  if (Number(g.treasury) < amt) throw new GameError('treasury', `That's more than the treasury holds.`);
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, amt]);
  const garrison = Math.floor(Number(row.garrison || 0)) + amt;
  await client.query('UPDATE world_npcs SET garrison=$2 WHERE npc_id=$1', [npcId, garrison]);
  await h.ledger(client, { currency: 'cash', amount: -amt, reason: 'world:reinforce', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) - amt;
  return { ok: true, npc: npcId, name: fixture.name, spent: amt, garrison };
}

// THE RECKONING — resolve one PAST-DAY uprising (idempotent, status-latched). A rising outfit HELD by a
// family attempts to BREAK FREE: if the outpost garrison is below `outfit.max × THRESHOLD_BPS/10000 × its
// live strength fraction`, it RECLAIMS its turf (§10.4-NEUTRAL — held_by_gang→NULL, garrison reset,
// uncollected tribute forfeits, the releaseFrontierHolds/seizure precedent). A REINFORCED outpost repels
// it (the family keeps it). No holder → quiet. Lock: world_uprisings row → world_npcs row (no char lock,
// no cycle). WORLD_UPRISING_FORCE (test-only) pins the outcome for a deterministic test.
export async function resolveUprising(client, day, npcId) {
  const u = (await client.query("SELECT status FROM world_uprisings WHERE day=$1 FOR UPDATE", [day])).rows[0];
  if (!u || u.status !== 'active') return null; // already resolved (idempotent)
  const fixture = worldNpcOf(npcId);
  let outcome = 'quiet';
  if (fixture) {
    const row = (await client.query('SELECT held_by_gang, garrison, strength, strength_at FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [npcId])).rows[0];
    if (row?.held_by_gang) {
      const hrs = Math.max(0, (Date.now() - new Date(row.strength_at).getTime()) / 3600000);
      const strength = Math.min(fixture.max, Number(row.strength) + fixture.regenPerHr * hrs);
      const frac = Math.max(0, Math.min(1, strength / fixture.max));
      const need = Math.floor(fixture.max * WORLD.UPRISING.THRESHOLD_BPS / 10000 * frac);
      const broke = process.env.WORLD_UPRISING_FORCE != null
        ? process.env.WORLD_UPRISING_FORCE === 'break'
        : Number(row.garrison || 0) < need;
      if (broke) {
        // BREAK FREE — reclaim the outpost; uncollected tribute forfeits (the release/seize precedent)
        await client.query('UPDATE world_npcs SET held_by_gang=NULL, held_since=NULL, garrison=0, tribute_at=NULL WHERE npc_id=$1', [npcId]);
        outcome = 'broke_free';
        bus.emit('streets', { type: 'uprising_broke_free', npc: fixture.name });
      } else {
        outcome = 'repelled';
        bus.emit('streets', { type: 'uprising_repelled', npc: fixture.name });
      }
    }
  }
  await client.query("UPDATE world_uprisings SET status='resolved' WHERE day=$1", [day]);
  return { day, npc: npcId, outcome };
}

// worker: materialize TODAY's uprising (idempotent — PK on day) so the reckoning is scheduled, then
// resolve any PAST-day active uprising (its window has ended). The "materialize → resolve when the window
// passes" pattern (futurity/stakes). Per-uprising txn; a poison row can't starve the rest.
export async function sweepUprisings(pool) {
  const today = dayOf();
  const up = cartelUprisingOf(today);
  if (up) {
    try { await pool.query("INSERT INTO world_uprisings (day, npc_id, status) VALUES ($1,$2,'active')", [today, up.id]); }
    catch (e) { if (e?.code !== '23505') throw e; } // already materialized this day
  }
  const due = (await pool.query("SELECT day, npc_id FROM world_uprisings WHERE day < $1 AND status='active' ORDER BY day", [today])).rows;
  let resolved = 0;
  for (const u of due) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await resolveUprising(client, Number(u.day), u.npc_id); await client.query('COMMIT'); resolved++; }
    catch (e) { await client.query('ROLLBACK'); console.error(`uprising sweep failed (day ${u.day}, ${u.npc_id}):`, e?.message || e); } // transient → next tick retries; a persistent failure is logged (the sweepAuctions poison-row precedent)
    finally { client.release(); }
  }
  return { resolved, active: up ? up.id : null };
}

// runEstate: a dead co-op raid leader's plan is abandoned (the crew_heists precedent) so its crew can
// recrew. The dead leader's own membership is wiped by the estate table sweep; this also clears the
// STRANDED crew's member rows (audit LOW-1 — else they linger forever in an abandoned raid the sweep
// never touches, since sweepStaleRaids only reaps status='planning'; the pen-break death precedent).
export async function abandonRaidsAtDeath(client, characterId) {
  await client.query("UPDATE world_raids SET status='abandoned' WHERE leader_character=$1 AND status='planning'", [characterId]);
  await client.query(
    "DELETE FROM world_raid_members WHERE raid_id IN (SELECT id FROM world_raids WHERE leader_character=$1 AND status='abandoned')", [characterId]);
}
