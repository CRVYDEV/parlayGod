// THE LIVING WORLD Phase 2 — NPC RIVAL FAMILIES (design omerta-living-world-design.md).
// A server-wide common enemy: POSITIVE-sum co-op content (the whole base grinds the same reservoir),
// distinct from the zero-sum player turf war. Each fixture holds a shared CASH RESERVOIR (`strength`,
// dollars) that regenerates lazily toward its max; a raid loots a bounded slice and drains it. Total
// emission is bounded by REGEN — a metered world quantity — so `world:raid` is a §10.4-safe faucet
// (a ledgered cash faucet, character_id'd, capped by real activity). Routing an outfit (draining it
// to the floor) pays a one-time bonus + a streets event, then it rebuilds. The ONLY emission surface
// in this pillar — numbers are founder SIM sign-off levers (ground rule #1).
import { GameError, bus } from './game.js';
import { WORLD_NPCS, worldNpcOf, WORLD, LIVING, levelOf, effStat, cityHourOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// Lazy §7.1 strength regen toward the fixture max. Seeds the row (at max) on first touch. Returns
// the current strength; the caller writes it back inside its own transaction (or here, under lock).
async function currentStrength(client, fixture, now = new Date()) {
  const row = (await client.query('SELECT strength, strength_at FROM world_npcs WHERE npc_id=$1 FOR UPDATE', [fixture.id])).rows[0];
  if (!row) {
    await client.query('INSERT INTO world_npcs (npc_id, strength, strength_at) VALUES ($1,$2,$3)', [fixture.id, fixture.max, now]);
    return fixture.max;
  }
  const hrs = Math.max(0, (now - new Date(row.strength_at)) / 3600000);
  const regened = Math.min(fixture.max, Number(row.strength) + fixture.regenPerHr * hrs);
  return regened;
}

// GET /v1/world — the NPC board (public read: each outfit's status band + your raid odds tonight).
// Uses a fresh connection so a read doesn't lock; strength is the regened (effective) value.
export async function worldBoard(pool, ch = null, h = null) {
  const now = new Date();
  const patrol = cityHourOf(now.getTime()).patrol;
  const rows = Object.fromEntries((await pool.query('SELECT npc_id, strength, strength_at FROM world_npcs')).rows
    .map((r) => [r.npc_id, r]));
  const lvl = ch ? levelOf(Number(ch.respect)) : 0;
  const power = ch ? raiderPower(ch, h) : 0;
  return {
    phase: patrol ? 'day' : 'night',
    nightRaidBonus: !patrol,                       // the small hours favour a raid (NPCs -10% defense)
    npcs: WORLD_NPCS.map((f) => {
      const row = rows[f.id];
      const strength = row
        ? Math.min(f.max, Number(row.strength) + f.regenPerHr * Math.max(0, (now - new Date(row.strength_at)) / 3600000))
        : f.max;
      const routed = strength <= f.max * WORLD.ROUT_FLOOR_BPS / 10000;
      return {
        id: f.id, name: f.name, minLvl: f.minLvl,
        // never the exact reservoir (like the convoy value band) — a status read
        strengthPct: Math.round(strength / f.max * 100),
        routed,
        canRaid: !!ch && lvl >= f.minLvl,
        odds: ch && lvl >= f.minLvl ? Math.round(raidChance(f, power, patrol) * 100) : null,
      };
    }),
  };
}

// the raider's muscle behind a raid — effective muscle + half effective speed (a jump-shaped stat mix)
function raiderPower(ch, h) {
  const assets = h?.owned?.assets || [], gear = h?.owned?.gear || [];
  return effStat(Number(ch.muscle), 'muscle', assets, gear) + effStat(Number(ch.speed), 'speed', assets, gear) / 2;
}
// success chance — the fixture's base + the raider's edge over its defense; night eases the defense
function raidChance(fixture, power, patrol) {
  const def = fixture.def * (patrol ? 1 : LIVING.NIGHT_RAID_MULT);
  return Math.max(0.1, Math.min(0.9, fixture.base + (power - def) / 400));
}

// POST /v1/world/:npcId/raid — hit an NPC outfit. Runs under withCharacter (ch locked). The NPC row
// is locked here (characters → singletons order — world_npcs is a singleton-class row, no cycle).
export async function raidNpc(ch, npcId, client, h) {
  const fixture = worldNpcOf(npcId);
  if (!fixture) throw new GameError('bad_npc', 'No outfit by that name to hit.');
  if (jailed(ch)) throw new GameError('jailed', 'No moves from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't run an op from a safehouse.");
  const lvl = levelOf(Number(ch.respect));
  if (lvl < fixture.minLvl) throw new GameError('level', `Hitting ${fixture.name} takes level ${fixture.minLvl}.`);
  if (ch.world_raid_at && new Date(ch.world_raid_at) > new Date()) throw new GameError('cooldown', 'Your crew needs to regroup before the next hit.');
  if (Number(ch.energy) < WORLD.RAID_ENERGY) throw new GameError('energy', `A raid takes ${WORLD.RAID_ENERGY} energy.`);
  if (Number(ch.ammo) < WORLD.RAID_AMMO) throw new GameError('ammo', `Bring at least ${WORLD.RAID_AMMO} rounds.`);

  const now = new Date();
  const patrol = cityHourOf(now.getTime()).patrol;
  const strength = await currentStrength(client, fixture, now); // regened + row-locked

  // pay the price up front (energy + ammo + heat + cooldown), win or lose
  ch.energy = Number(ch.energy) - WORLD.RAID_ENERGY;
  ch.ammo = Number(ch.ammo) - WORLD.RAID_AMMO;
  ch.heat = Number(ch.heat || 0) + WORLD.RAID_HEAT;
  ch.world_raid_at = new Date(now.getTime() + WORLD.RAID_CD_MS);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -WORLD.RAID_AMMO, reason: 'world:raid' });

  const power = raiderPower(ch, h);
  // WORLD_RAID_P is a TEST-ONLY knob (the LAW_BUST_P / GEAR_LOOT_CHANCE precedent) that pins the raid
  // outcome so loot/rout/repel are deterministic in tests — never set in production.
  const p = process.env.WORLD_RAID_P != null ? Number(process.env.WORLD_RAID_P) : raidChance(fixture, power, patrol);
  const roll = Math.random();
  await h.rngLog(client, ch.id, `world:${fixture.id}`, roll, roll < p ? 'raid' : 'repelled');

  if (roll >= p) {
    // repelled — the NPC's soldiers hospitalize the raider; the reservoir is untouched (regen stamped)
    ch.hosp_until = new Date(now.getTime() + WORLD.FAIL_HOSP_MS);
    await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3 WHERE npc_id=$1', [fixture.id, strength, now]);
    await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: false });
    return { ok: true, success: false, npc: fixture.id, hospSeconds: Math.round(WORLD.FAIL_HOSP_MS / 1000) };
  }

  // landed — loot a bounded slice of the reservoir (GRAB_BPS, capped), draining it by exactly the loot
  const loot = Math.min(Math.floor(strength * WORLD.GRAB_BPS / 10000), WORLD.GRAB_MAX, Math.floor(strength));
  let after = strength - loot;
  ch.cash = Number(ch.cash) + loot;
  if (loot > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: loot, reason: 'world:raid', counterparty: fixture.id });

  // routing an outfit (draining it below the floor) pays a one-time bonus + tells the streets
  let routed = false, routBonus = 0;
  if (after <= fixture.max * WORLD.ROUT_FLOOR_BPS / 10000) {
    routed = true; routBonus = fixture.routBonus;
    ch.cash = Number(ch.cash) + routBonus;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: routBonus, reason: 'world:raid', counterparty: fixture.id });
    bus.emit('streets', { type: 'world_routed', who: ch.name, npc: fixture.name });
  }
  await client.query('UPDATE world_npcs SET strength=$2, strength_at=$3 WHERE npc_id=$1', [fixture.id, after, now]);
  await h.track(client, ch.account_id, 'world_raid', { npc: fixture.id, success: true, loot, routed });
  return { ok: true, success: true, npc: fixture.id, loot, routed, routBonus, strengthPct: Math.round(Math.max(0, after) / fixture.max * 100) };
}
