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
// THE DEFENCE (both paths built): a landed raid fires EXACTLY ONE retaliation — either the guns catch you
// AT THE SCENE now (COUNTER_P, an immediate hospitalization) OR you escape and the family REMEMBERS,
// sending someone after you later (THE MANHUNT — sweepFamilyAggro, a worker-resolved, shield-honouring
// strike; one pending per family). Chained so you're never double-punished. A raid is a real risk decision.
import { GameError, bus, notify } from './game.js';
import { FAMILY_WAR, familyWarRankOf, familyWarWinRankOf, levelOf, jailed, hospitalized, safeHoused, witproActive, penSafe, inHole } from './rules.js';

const cooling = (ch) => ch.family_raid_at && new Date(ch.family_raid_at) > new Date();
// boss/underboss gate (the world/sov/territory convention — gangs.js imports THIS module, so a local
// one-liner avoids the import cycle rather than reaching into social/gangs.js).
const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';

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
    'SELECT id, name, tag, war_pool, war_pool_at, held_by_gang, tribute_at FROM gangs WHERE npc_flag ORDER BY name')).rows;
  const counts = {};
  for (const m of (await db.query('SELECT gang_id, COUNT(*) n FROM gang_members GROUP BY gang_id')).rows) counts[m.gang_id] = Number(m.n);
  // holder family names (a flat lookup — no correlated subquery)
  const holderIds = [...new Set(rows.map((r) => r.held_by_gang).filter(Boolean))];
  const holders = {};
  if (holderIds.length) for (const hg of (await db.query('SELECT id, name, tag FROM gangs')).rows) if (holderIds.includes(hg.id)) holders[hg.id] = hg;
  const now = new Date();
  const myGang = ch ? (await db.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [ch.id])).rows[0]?.gang_id : null;
  const lvl = ch ? levelOf(Number(ch.respect)) : 0;
  // active FAMILY WARS this family is running (a flat read keyed by the NPC outfit — the board decorates
  // each family with its live campaign so the player sees the score and the clock where they raid).
  const wars = {};
  if (myGang) for (const w of (await db.query(
    'SELECT npc_gang, score, ends_at FROM npc_wars WHERE attacker_gang=$1 AND NOT resolved AND ends_at > now()', [myGang])).rows)
    wars[w.npc_gang] = w;
  const board = rows.filter((r) => r.id !== myGang).map((r) => {
    const p = regenPool(r, now);
    const holder = r.held_by_gang && holders[r.held_by_gang];
    const mine = !!(myGang && r.held_by_gang === myGang);
    const w = wars[r.id];
    return { id: r.id, name: r.name, tag: r.tag, members: counts[r.id] || 0,
      strengthPct: Math.round((p / FAMILY_WAR.POOL_MAX) * 100), defense: defenseOf(p),
      loot: Math.min(Math.floor(p * FAMILY_WAR.RAID_BPS / 10000), FAMILY_WAR.RAID_MAX, Math.floor(p)),
      canRaid: !!ch && lvl >= FAMILY_WAR.RAID_MIN_LVL,
      heldBy: holder ? { name: holder.name, tag: holder.tag, mine } : null,
      tributePending: mine ? familyTribute(r.tribute_at, now.getTime()) : null,
      atWar: w ? { score: Number(w.score), winScore: FAMILY_WAR.WAR.WIN_SCORE,
        endsSeconds: Math.max(0, Math.ceil((new Date(w.ends_at).getTime() - Date.now()) / 1000)) } : null };
  });
  let you = null;
  if (ch) {
    const acct = (await db.query('SELECT family_war, family_wars_won FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0] || {};
    const dmg = Number(acct.family_war || 0), wins = Number(acct.family_wars_won || 0);
    let held = 0, pending = 0;
    if (myGang) for (const r of rows) if (r.held_by_gang === myGang) { held++; pending += familyTribute(r.tribute_at, now.getTime()); }
    you = { war: dmg, rank: familyWarRankOf(dmg).name, minLvl: FAMILY_WAR.RAID_MIN_LVL,
      raidCdSeconds: cooling(ch) ? Math.ceil((new Date(ch.family_raid_at).getTime() - Date.now()) / 1000) : 0,
      vassals: held, tributePending: pending, tributePerHr: familyTributePerHr(),
      // THE FAMILY WAR (formal): the war-chief legend + the active-campaign count + the declaration terms
      warsWon: wins, warChief: familyWarWinRankOf(wins).name, activeWars: Object.keys(wars).length,
      warCost: FAMILY_WAR.WAR.COST, warWinScore: FAMILY_WAR.WAR.WIN_SCORE, warMaxPerFamily: FAMILY_WAR.WAR.MAX_PER_FAMILY };
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
  // own_vassal (the own_family sibling): you don't raid an outfit your OWN family already holds — the
  // loot is a bounded faucet either way (no §10.4/exploit), but self-raiding a vassal is a pointless,
  // confusing no-value action (and the board flags it heldBy.mine, so it's reachable). Gate it clean.
  if (myGang && g.held_by_gang === myGang) throw new GameError('own_vassal', "You already hold that outfit — you don't raid your own vassal.");

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
  const poolAfter = poolNow - loot;
  await client.query('UPDATE gangs SET war_pool=$2, war_pool_at=$3 WHERE id=$1', [gangId, poolAfter, now]);
  if (loot > 0) {
    ch.cash = Number(ch.cash) + loot;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: loot, reason: 'family:raid', counterparty: gangId });
    // THE BLOOD-WAR LEGEND — lifetime loot, account-level (survives death; direct SQL, off the positional
    // persist — the cartel_damage/kills precedent). NEVER season_wars: this buys no Commission seat.
    await client.query('UPDATE account_persistent SET family_war = family_war + $2 WHERE account_id=$1', [ch.account_id, loot]);
  }

  // THE FAMILY WAR (formal) — if the raider's family has an ACTIVE declared campaign against this outfit,
  // this landed raid SCORES. Crossing WIN_SCORE wins the war: a STATUS trophy to the DECLARER's account
  // (they committed the war chest and led it; survives death — the family_war/kills legend precedent),
  // NEVER season_wars. §10.4: zero — the score and the trophy move no currency. Lock the war row FOR
  // UPDATE so concurrent raids scoring the same war serialize and exactly one crosses the line.
  let warWon = false;
  if (myGang) {
    const w = (await client.query(
      'SELECT score, ends_at, declared_by FROM npc_wars WHERE attacker_gang=$1 AND npc_gang=$2 AND NOT resolved FOR UPDATE',
      [myGang, gangId])).rows[0];
    if (w && new Date(w.ends_at) > now) {
      const newScore = Number(w.score) + FAMILY_WAR.WAR.RAID_POINTS;
      if (newScore >= FAMILY_WAR.WAR.WIN_SCORE) {
        await client.query('UPDATE npc_wars SET score=$3, resolved=true WHERE attacker_gang=$1 AND npc_gang=$2', [myGang, gangId, newScore]);
        const dec = (await client.query('SELECT account_id FROM characters WHERE id=$1', [w.declared_by])).rows[0];
        if (dec) await client.query('UPDATE account_persistent SET family_wars_won = family_wars_won + 1 WHERE account_id=$1', [dec.account_id]);
        warWon = true;
        bus.emit('streets', { type: 'family_war_won', who: ch.name, family: g.name });
      } else {
        await client.query('UPDATE npc_wars SET score=$3 WHERE attacker_gang=$1 AND npc_gang=$2', [myGang, gangId, newScore]);
      }
    }
  }

  // THE CONQUEST — a raid that ROUTS the family (war_pool crosses below the floor) lets the raider's
  // FAMILY claim it as a vassal (the World-frontier pattern; only on the CROSSING — the routBonus re-farm
  // fix). The flag/tribute clock transfer; the incumbent's uncollected tribute forfeits (the clock reset).
  let conquered = false;
  const floor = FAMILY_WAR.POOL_MAX * FAMILY_WAR.ROUT_FLOOR_BPS / 10000;
  if (myGang && poolNow > floor && poolAfter <= floor && g.held_by_gang !== myGang) {
    conquered = true;
    await client.query('UPDATE gangs SET held_by_gang=$2, held_since=$3, tribute_at=$3 WHERE id=$1', [gangId, myGang, now]);
    bus.emit('streets', { type: 'family_conquered', who: ch.name, family: g.name });
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
  await h.track(client, ch.account_id, 'family_raid', { gang: gangId, success: true, loot, countered, conquered });
  bus.emit('streets', { type: 'family_raided', who: ch.name, family: g.name, loot });
  return { ok: true, success: true, family: g.name, loot, countered, conquered, warWon,
    hospSeconds: countered ? Math.round(FAMILY_WAR.COUNTER_HOSP_MS / 1000) : 0 };
}

// ══════════════════ THE FAMILY WAR (formal declaration) ══════════════════
// A meta-layer over the raid loop: declare a time-boxed, SCORED campaign against an NPC family. The
// reward is STATUS ONLY (an account-level `family_wars_won` trophy + a leaderboard) — the belt to the
// raid's bouts — plus the existing raid loot during the war. §10.4-NEUTRAL: the only value flow is the
// EXISTING `gang:war` treasury sink at declaration (no spoils, no NPC-treasury seed, no new faucet); the
// score/win are status, NEVER season_wars (severing the Commission-standing faucet by construction).
// Numbers are PROPOSED DEFAULTS — founder sim + sign-off (BALANCE.md).
export async function declareNpcWar(ch, gangId, client, h) {
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss declares a family war.');
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  const W = FAMILY_WAR.WAR;
  const g = (await client.query('SELECT id, name, npc_flag, held_by_gang FROM gangs WHERE id=$1', [gangId])).rows[0];
  if (!g || !g.npc_flag) throw new GameError('bad_target', 'No outfit by that name to war on.');
  if (g.held_by_gang === h.owned.gangId) throw new GameError('own_vassal', 'You already hold that outfit — no war to declare.');
  // Lock OUR gang row FIRST — it is both the treasury sink and the serialization point: two concurrent
  // declares block on it, and the second re-reads the active-wars set AFTER the first committed, so the
  // MAX_PER_FAMILY cap holds under a race (reading active before the lock would let both slip through).
  const us = (await client.query('SELECT id, treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (!us) throw new GameError('no_gang', "You're not in a family.");
  const active = (await client.query(
    'SELECT npc_gang FROM npc_wars WHERE attacker_gang=$1 AND NOT resolved AND ends_at > now()', [h.owned.gangId])).rows;
  if (active.some((r) => r.npc_gang === gangId)) throw new GameError('at_war', "You're already at war with that outfit.");
  if (active.length >= W.MAX_PER_FAMILY) throw new GameError('at_war', 'Your family is already running a campaign — finish it first.');
  if (Number(us.treasury) < W.COST) throw new GameError('treasury', `A family war takes a $${W.COST} war chest in the treasury.`);
  const now = new Date();
  const ms = process.env.NPC_WAR_MS != null ? Number(process.env.NPC_WAR_MS) : W.MS;
  const ends = new Date(now.getTime() + ms);
  // the war chest burns — the EXISTING gang:war treasury sink (no new §10.4 reason, no spoils)
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, W.COST]);
  await h.ledger(client, { currency: 'cash', amount: -W.COST, reason: 'gang:war', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(us.treasury) - W.COST;
  // one row per pair — a manual DELETE+INSERT replaces a resolved/expired prior war (pg-mem misreports
  // ON CONFLICT; the family_aggro precedent). An UNRESOLVED live one on this pair was rejected above.
  await client.query('DELETE FROM npc_wars WHERE attacker_gang=$1 AND npc_gang=$2', [h.owned.gangId, gangId]);
  await client.query('INSERT INTO npc_wars (attacker_gang, npc_gang, score, ends_at, declared_by) VALUES ($1,$2,0,$3,$4)',
    [h.owned.gangId, gangId, ends, ch.id]);
  bus.emit('streets', { type: 'family_war_declared', who: ch.name, family: g.name });
  return { ok: true, family: g.name, endsSeconds: Math.round(ms / 1000), winScore: W.WIN_SCORE, points: W.RAID_POINTS };
}

// THE FAMILY WAR — the worker closes EXPIRED campaigns. A win was already granted in raidFamily on the
// CROSSING (immediate feedback + resolved=true), so an expired-unresolved war has score < WIN_SCORE by
// construction: this only lapses it (no penalty — the war chest was the whole cost). §10.4: zero.
// Per-row txn isolation (the sweep precedent).
export async function sweepNpcWars(pool) {
  const due = (await pool.query(
    'SELECT attacker_gang, npc_gang FROM npc_wars WHERE NOT resolved AND ends_at <= now()')).rows;
  let lapsed = 0;
  for (const w of due) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(
        'SELECT score FROM npc_wars WHERE attacker_gang=$1 AND npc_gang=$2 AND NOT resolved FOR UPDATE',
        [w.attacker_gang, w.npc_gang])).rows[0];
      if (row) { await client.query('UPDATE npc_wars SET resolved=true WHERE attacker_gang=$1 AND npc_gang=$2', [w.attacker_gang, w.npc_gang]); lapsed++; }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('[sweepNpcWars]', w.attacker_gang, e?.message || e); }
  }
  return { lapsed, due: due.length };
}

// THE WAR-CHIEF LEADERBOARD — the most decorated family-war campaigners by lifetime wins (agents
// excluded, the hitman-rep precedent). Pure status.
export async function familyWarWinsLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.family_wars_won, c.name FROM account_persistent a JOIN characters c ON c.account_id=a.account_id AND c.alive
      WHERE a.family_wars_won > 0 AND NOT a.agent_flag AND NOT a.npc_flag ORDER BY a.family_wars_won DESC LIMIT 15`)).rows;
  return { chiefs: rows.map((r) => ({ name: r.name, wins: Number(r.family_wars_won), rank: familyWarWinRankOf(r.family_wars_won).name })) };
}

// tribute owed by a held NPC family, lazy-accrued on its tribute_at (the world frontier twin). A small
// bounded faucet (TRIBUTE_BPS of the regen rate, capped) — the point is turf worth HOLDING, not the money.
const familyTributePerHr = () => Math.floor(FAMILY_WAR.POOL_REGEN_HR * FAMILY_WAR.TRIBUTE_BPS / 10000);
function familyTribute(tributeAt, now = Date.now()) {
  if (tributeAt == null) return 0;
  const hrs = Math.min(FAMILY_WAR.TRIBUTE_CAP_MS, Math.max(0, now - new Date(tributeAt).getTime())) / 3600000;
  return Math.floor(familyTributePerHr() * hrs);
}

// COLLECT the conquest tribute from every NPC family your family holds → the treasury. Any member can
// collect (the collectFrontier precedent); D2 safehouse-blocked (banking a productive stream is exposed).
// §10.4: a treasury FAUCET `family:tribute` (character_id NULL, counterparty=gang) reconciled in the
// gang-treasuries check. Lock: own gang → the held NPC family rows (the collectFrontier posture).
export async function collectFamilyTribute(ch, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', "You're not in a family.");
  if (safeHoused(ch)) throw new GameError('safe', 'The runners report to a man on the street, not a ghost — collection waits until you surface.');
  const now = new Date();
  const g = (await client.query('SELECT treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  const held = (await client.query('SELECT id, name, tribute_at FROM gangs WHERE held_by_gang=$1 AND npc_flag FOR UPDATE', [h.owned.gangId])).rows;
  let total = 0; const collected = [];
  for (const r of held) {
    const owed = familyTribute(r.tribute_at, now.getTime());
    if (owed > 0) {
      total += owed; collected.push({ name: r.name, tribute: owed });
      await client.query('UPDATE gangs SET tribute_at=$2 WHERE id=$1', [r.id, now]);
    }
  }
  if (total <= 0) return { ok: true, collected: 0, vassals: held.length };
  await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [h.owned.gangId, total]);
  await h.ledger(client, { currency: 'cash', amount: total, reason: 'family:tribute', counterparty: h.owned.gangId });
  if (h.owned.gang) h.owned.gang.treasury = Number(g.treasury) + total;
  return { ok: true, collected: total, tributes: collected };
}

// a dissolved family drops its conquests — the NPC vassals go unheld (the releaseFrontierHolds twin).
// Called from gang dissolution under the gang lock; gangs is a leaf here (no cycle). A dissolving family
// also drops any FAMILY WAR it declared, and a dissolving NPC family drops any war fought against it —
// stale npc_wars rows harmlessly lapse otherwise (reads filter resolved/ends_at), but clear them so the
// board and the one-war-per-family cap never count a war whose party no longer exists.
export async function releaseFamilyHolds(client, gangId) {
  await client.query('UPDATE gangs SET held_by_gang=NULL, held_since=NULL, tribute_at=NULL WHERE held_by_gang=$1', [gangId]);
  await client.query('DELETE FROM npc_wars WHERE attacker_gang=$1 OR npc_gang=$1', [gangId]);
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

// THE CONQUEST BOARD — families ranked by NPC vassals held (two flat queries + a JS aggregate, the
// /v1/gangs precedent). Pure status.
export async function conquestLeaderboard(pool) {
  const held = (await pool.query('SELECT held_by_gang FROM gangs WHERE npc_flag AND held_by_gang IS NOT NULL')).rows;
  if (!held.length) return { families: [] };
  const by = {};
  for (const r of held) by[r.held_by_gang] = (by[r.held_by_gang] || 0) + 1;
  const names = {};
  for (const g of (await pool.query('SELECT id, name, tag FROM gangs')).rows) if (by[g.id]) names[g.id] = g;
  return { families: Object.entries(by).map(([id, n]) => ({ name: names[id]?.name, tag: names[id]?.tag, vassals: n }))
    .filter((f) => f.name).sort((a, b) => b.vassals - a.vassals).slice(0, 15) };
}
