// THE BLOOD WAR — NPC families as a PvE antagonist (omerta-npc-families-defend-design.md).
//
// NPC families (step one: joinable shells) become attackable OUTFITS on the WORLD-raid pattern, NOT the
// player-gang war system. That choice is the whole design: `declareWar` feeds season_wars → Commission
// standing, so an NPC family that never retaliates would be a fixed-price purchase of standing. Here a
// raid loots a bounded `war_pool` reservoir and banks a SEPARATE account-level `family_war` legend that
// NEVER touches Commission standing — the flagged faucet is severed by construction.
//
// §10.4: `family:raid` is a bounded cash FAUCET (attacker character_id'd, capped by RAID_BPS × the
// regen-bounded pool — the world:raid twin) + an ammo SINK. `war_pool` is a strength reservoir, NOT a
// §10.4 bucket (the world strength precedent), so the only invariant surface is the vocabulary.
//
// THE DEFENCE: a landed raid rolls a counter (COUNTER_P) that hospitalizes the raider — the family hits
// back, so a raid is a real risk decision. (Deferred step two: a scheduled, shield-honouring retaliation.)
import { GameError, bus, notify } from './game.js';
import { FAMILY_WAR, familyWarRankOf, levelOf, jailed, hospitalized, safeHoused, witproActive, penSafe, inHole } from './rules.js';

const cooling = (ch) => ch.family_raid_at && new Date(ch.family_raid_at) > new Date();

// lazy §7.1 regen of an NPC family's war_pool toward POOL_MAX; seeds an untouched row at max (a fresh
// outfit is at full strength — the founding path seeds it, this catches any row that missed it). Returns
// the effective pool AFTER regen; the caller has the gang row locked.
function regenPool(row, now = new Date()) {
  if (row.war_pool_at == null) return FAMILY_WAR.POOL_MAX;
  const hrs = Math.max(0, (now.getTime() - new Date(row.war_pool_at).getTime()) / 3600000);
  return Math.min(FAMILY_WAR.POOL_MAX, Number(row.war_pool) + FAMILY_WAR.POOL_REGEN_HR * hrs);
}

// a full-pool family defends at DEF_MAX; a beaten-down one defends near 0 — so grinding it down makes it
// both easier to hit AND lower-loot (the world enrage/strength interlock).
const defenseOf = (pool) => Math.round(FAMILY_WAR.DEF_MAX * Math.min(1, pool / FAMILY_WAR.POOL_MAX));
const raiderPower = (ch) => Number(ch.muscle) + Number(ch.cunning) / 2; // the standover/shakedown contest shape

// THE BOARD — NPC families you can raid (an unlocked read; the pool is the regened value). A raider's
// own family is excluded (you don't hit your own people, even if it went NPC via succession — it can't).
export async function warBoard(db, ch = null) {
  // `db` is the guarded readCharacter client (the D1 tripwire — a read board never takes the raw pool).
  // two flat queries + a JS join — pg-mem drops non-grouped columns to null under GROUP BY (so a
  // war_pool_at read as null makes regen see a full pool), the /v1/gangs precedent.
  const rows = (await db.query(
    'SELECT id, name, tag, war_pool, war_pool_at FROM gangs WHERE npc_flag ORDER BY name')).rows;
  const counts = {};
  for (const m of (await db.query('SELECT gang_id, COUNT(*) n FROM gang_members GROUP BY gang_id')).rows) counts[m.gang_id] = Number(m.n);
  const now = new Date();
  const myGang = ch ? (await db.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [ch.id])).rows[0]?.gang_id : null;
  const lvl = ch ? levelOf(Number(ch.respect)) : 0;
  const board = rows.filter((r) => r.id !== myGang).map((r) => {
    const p = regenPool(r, now);
    return { id: r.id, name: r.name, tag: r.tag, members: counts[r.id] || 0,
      strengthPct: Math.round((p / FAMILY_WAR.POOL_MAX) * 100), defense: defenseOf(p),
      loot: Math.min(Math.floor(p * FAMILY_WAR.RAID_BPS / 10000), FAMILY_WAR.RAID_MAX, Math.floor(p)),
      canRaid: !!ch && lvl >= FAMILY_WAR.RAID_MIN_LVL };
  });
  let you = null;
  if (ch) {
    const dmg = Number((await db.query('SELECT family_war FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0]?.family_war || 0);
    you = { war: dmg, rank: familyWarRankOf(dmg).name, minLvl: FAMILY_WAR.RAID_MIN_LVL,
      raidCdSeconds: cooling(ch) ? Math.ceil((new Date(ch.family_raid_at).getTime() - Date.now()) / 1000) : 0 };
  }
  return { families: board, you };
}

// RAID an NPC family — loot a bounded slice of its war_pool, bank the blood-war legend, and risk a
// counter (the DEFENCE). Lock order: the raider is held by withCharacter; we lock only the target gang
// row (a singleton-style leaf — the raider's family is never a party, so no two-gang cycle).
export async function raidFamily(ch, gangId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No moves from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', 'Not in any shape to run an op — see the Doc first.');
  if (safeHoused(ch)) throw new GameError('safe', "You can't run an op from a safehouse.");
  if (levelOf(Number(ch.respect)) < FAMILY_WAR.RAID_MIN_LVL) throw new GameError('level', `A blood-war raid takes level ${FAMILY_WAR.RAID_MIN_LVL}.`);
  if (cooling(ch)) throw new GameError('cooldown', 'Your crew needs to regroup before the next hit.');
  if (Number(ch.energy) < FAMILY_WAR.RAID_ENERGY) throw new GameError('energy', `A raid takes ${FAMILY_WAR.RAID_ENERGY} energy.`);
  if (Number(ch.ammo) < FAMILY_WAR.RAID_AMMO) throw new GameError('ammo', `Bring at least ${FAMILY_WAR.RAID_AMMO} rounds.`);

  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (!g || !g.npc_flag) throw new GameError('bad_target', 'No outfit by that name to hit.');
  const myGang = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [ch.id])).rows[0]?.gang_id;
  if (myGang && myGang === gangId) throw new GameError('own_family', "That's your own family.");

  const now = new Date();
  const poolNow = regenPool(g, now);
  // pay the price up front (energy + ammo + heat + cooldown), win or lose
  ch.energy = Number(ch.energy) - FAMILY_WAR.RAID_ENERGY;
  ch.ammo = Number(ch.ammo) - FAMILY_WAR.RAID_AMMO;
  ch.heat = Math.min(100, Number(ch.heat || 0) + FAMILY_WAR.RAID_HEAT);
  ch.family_raid_at = new Date(now.getTime() + FAMILY_WAR.RAID_CD_MS);
  await h.ledger(client, { characterId: ch.id, currency: 'ammo', amount: -FAMILY_WAR.RAID_AMMO, reason: 'family:raid' });

  const def = defenseOf(poolNow);
  // FAMILY_RAID_P is a TEST-ONLY roll knob (the WORLD_RAID_P / LAW_BUST_P precedent) — never in production.
  const p = process.env.FAMILY_RAID_P != null ? Number(process.env.FAMILY_RAID_P)
    : Math.min(FAMILY_WAR.MAX_P, Math.max(FAMILY_WAR.MIN_P, FAMILY_WAR.BASE_P + (raiderPower(ch) - def) / FAMILY_WAR.DEF_SCALE));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `family:${gangId}`, roll, roll < p ? 'raid' : 'repelled');

  if (roll >= p) {
    // repelled — the family's guns hospitalize the raider; the pool is untouched (regen stamped)
    ch.hosp_until = new Date(now.getTime() + FAMILY_WAR.FAIL_HOSP_MS);
    await client.query('UPDATE gangs SET war_pool=$2, war_pool_at=$3 WHERE id=$1', [gangId, poolNow, now]);
    await h.track(client, ch.account_id, 'family_raid', { gang: gangId, success: false });
    return { ok: true, success: false, family: g.name, hospSeconds: Math.round(FAMILY_WAR.FAIL_HOSP_MS / 1000) };
  }

  // landed — loot a bounded slice, draining the pool by exactly the loot (a §10.4-clean bounded faucet)
  const loot = Math.min(Math.floor(poolNow * FAMILY_WAR.RAID_BPS / 10000), FAMILY_WAR.RAID_MAX, Math.floor(poolNow));
  await client.query('UPDATE gangs SET war_pool=$2, war_pool_at=$3 WHERE id=$1', [gangId, poolNow - loot, now]);
  if (loot > 0) {
    ch.cash = Number(ch.cash) + loot;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: loot, reason: 'family:raid', counterparty: gangId });
    // THE BLOOD-WAR LEGEND — lifetime loot, account-level (survives death; direct SQL, off the positional
    // persist — the cartel_damage/kills precedent). NEVER season_wars: this buys no Commission seat.
    await client.query('UPDATE account_persistent SET family_war = family_war + $2 WHERE account_id=$1', [ch.account_id, loot]);
  }

  // THE DEFENCE — the family fights back. Exactly ONE retaliation path fires: either the guns catch you
  // AT THE SCENE now (COUNTER_P, an immediate hospitalization — never a kill, the npcHit precedent), OR
  // you escape and the family REMEMBERS, sending someone after you later (THE MANHUNT — a worker-resolved,
  // shield-honouring strike; one pending per family, the latest raider). Chained, so never double-punished.
  let countered = false;
  const cRoll = process.env.FAMILY_RAID_P != null ? (process.env.FAMILY_COUNTER === 'on' ? 0 : 1) : Math.random();
  if (cRoll < FAMILY_WAR.COUNTER_P) {
    countered = true;
    ch.hosp_until = new Date(now.getTime() + FAMILY_WAR.COUNTER_HOSP_MS);
    bus.emit('streets', { type: 'family_counter', who: ch.name, family: g.name });
  } else {
    // escaped the scene — schedule the manhunt (one pending per family; a manual upsert since pg-mem
    // misreports ON CONFLICT). The raider is remembered as the latest threat.
    await client.query('DELETE FROM family_aggro WHERE gang_id=$1', [gangId]);
    await client.query('INSERT INTO family_aggro (gang_id, target_character, scheduled_at) VALUES ($1,$2,$3)',
      [gangId, ch.id, new Date(now.getTime() + FAMILY_WAR.AGGRO_DELAY_MS)]);
  }
  await h.track(client, ch.account_id, 'family_raid', { gang: gangId, success: true, loot, countered });
  bus.emit('streets', { type: 'family_raided', who: ch.name, family: g.name, loot });
  return { ok: true, success: true, family: g.name, loot, countered,
    hospSeconds: countered ? Math.round(FAMILY_WAR.COUNTER_HOSP_MS / 1000) : 0 };
}

// THE MANHUNT — the worker resolves scheduled retaliations: a family sends someone after a raider who
// escaped the scene. Shield-honouring (safehouse/witpro/pen/hospital/jail make you unreachable → a clean
// miss), one shot per raid (the row is deleted win OR miss), rolls RETAL_P. §10.4: zero — a hospitalization
// moves no currency. The uprising/huntWanted worker precedent: per-row txn isolation, direct-SQL headless.
export async function sweepFamilyAggro(pool) {
  const due = (await pool.query('SELECT gang_id, target_character FROM family_aggro WHERE scheduled_at <= now()')).rows;
  let struck = 0;
  for (const a of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const g = (await client.query('SELECT name FROM gangs WHERE id=$1 AND npc_flag', [a.gang_id])).rows[0];
      const t = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [a.target_character])).rows[0];
      await client.query('DELETE FROM family_aggro WHERE gang_id=$1', [a.gang_id]); // one shot — hit or lost trail
      if (g && t) {
        const reachable = !jailed(t) && !hospitalized(t) && !safeHoused(t) && !witproActive(t) && !penSafe(t) && !inHole(t);
        const hit = reachable && (process.env.FAMILY_RETAL_P != null ? Number(process.env.FAMILY_RETAL_P) >= 1 : Math.random() < FAMILY_WAR.RETAL_P);
        if (hit) {
          await client.query('UPDATE characters SET hosp_until=$2 WHERE id=$1', [t.id, new Date(Date.now() + FAMILY_WAR.RETAL_HOSP_MS)]);
          await notify(client, t.id, 'family_retaliation', { family: g.name });
          bus.emit('streets', { type: 'family_retaliation', who: t.name, family: g.name });
          struck++;
        }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepFamilyAggro]', a.gang_id, e?.message || e); }
  }
  return { struck, due: due.length };
}

// THE BLOOD-WAR LEADERBOARD — the most feared family-killers by lifetime loot (agents excluded, the
// hitman-rep/war-effort precedent). Pure status.
export async function bloodWarLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.family_war, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.family_war > 0 AND NOT a.agent_flag AND NOT a.npc_flag ORDER BY a.family_war DESC LIMIT 15`)).rows;
  return { warmakers: rows.map((r) => ({ name: r.name, war: Number(r.family_war), rank: familyWarRankOf(r.family_war).name })) };
}
