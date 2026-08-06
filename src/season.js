// THE SEASON HAS AN ENDING — the arc over the 28-day season.
//
// The strategy package gave the game scarcity (which holdings, when, how much, who). This gives it
// an ARC. Before this, every system ran forever at the same tempo and a season RESET rather than
// CONCLUDED — nothing expired, nothing was decided, no position was ever cashed out. Strategy gets
// most of its tension from a clock that makes "not yet" cost something, and there was no clock a
// player could see.
//
// Three parts, and only the first two are in this file:
//   1. THE CLOCK   — a published phase (opening / long game / reckoning) with the days left, so a
//                    player can plan against a deadline. `seasonPhaseOf` in rules.js.
//   2. THE ESCALATION — the reckoning's three touchpoints, which live at their own sites in
//                    social/gangs.js (contest window, turf floor, watch window). All pacing/price,
//                    all turf, NONE a faucet: the last week makes the map cheap to fight over and
//                    fast to settle; it never pays more.
//   3. THE RECKONING — this file's `recordReckoning`, called from the worker's rollover: one row
//                    per closed season naming who ended it on top, and a crown on the champion's
//                    bloodline. PURE STATUS, zero §10.4 — nothing is reset or seized. That is the
//                    deliberate call: a wrecking-ball ending is wrong for a thin alpha, and a crown
//                    plus a permanent record gives the arc without one.
import { SEASON_PHASES, seasonPhaseOf, seasonPhaseLeft, seasonDayOf, seasonDaysLeft,
         seasonIdxOf, seasonModOf, DISTRICTS } from './rules.js';
import { cityStanding } from './standing.js';
import crypto from 'node:crypto';

// ── THE CLOCK, published ──────────────────────────────────────────────────────────────────────
// GET /v1/seasons. Keyless: the clock and the roll of past seasons are public by design — a
// deadline nobody can read is not a deadline, and the record is the point of the whole arc.
export async function seasonBoard(pool, limit = 12) {
  const season = seasonIdxOf();
  const phase = seasonPhaseOf();
  const mod = seasonModOf();
  const past = (await pool.query(
    'SELECT * FROM season_records ORDER BY season DESC LIMIT $1', [limit])).rows;
  return {
    season,
    day: seasonDayOf() + 1, of: 28,
    daysLeft: seasonDaysLeft(),
    twist: { id: mod.id, name: mod.name, blurb: mod.blurb },
    phase: { id: phase.id, name: phase.name, blurb: phase.blurb, daysLeft: seasonPhaseLeft() },
    // the escalation, stated rather than hidden — a player should be able to see WHY turf is moving
    reckoning: phase.id === 'reckoning' ? {
      contestMsMult: phase.contestMsMult, floorMult: phase.floorMult, watchWindowMult: phase.watchWindowMult,
    } : null,
    phases: SEASON_PHASES.map((p) => ({ id: p.id, name: p.name, from: p.from + 1, blurb: p.blurb })),
    roll: past.map((r) => ({
      season: r.season, twist: r.mod_id,
      champion: r.champion_name ? { name: r.champion_name, standing: r.champion_standing } : null,
      family: r.family_name ? { name: r.family_name, tag: r.family_tag, districts: r.family_districts } : null,
      at: r.at,
    })),
  };
}

// ── THE SEASON RECAP (per-account) ──────────────────────────────────────────────────────────────
// GET /v1/season/recap (authed). The individual's "your season" keepsake — one row per closed season,
// account-keyed so it survives death (the heir keeps the bloodline's seasons). Pure status.
export async function seasonRecaps(pool, accountId, limit = 8) {
  const rows = (await pool.query(
    'SELECT season, level, kills, prestige_gained, title, at FROM season_recaps WHERE account_id=$1 ORDER BY season DESC LIMIT $2',
    [accountId, limit])).rows;
  return {
    season: seasonIdxOf(),
    recaps: rows.map((r) => ({ season: r.season, level: r.level, kills: r.kills,
      prestigeGained: r.prestige_gained, title: r.title, at: r.at })),
  };
}

// ── THE RECKONING ─────────────────────────────────────────────────────────────────────────────
// Called from runSeasonRollover for the season that just CLOSED (current − 1). Writes one row and
// crowns the champion's bloodline. Idempotent by the season PK: a second tick, a crash mid-rollover
// and a worker restart all land on ON CONFLICT DO NOTHING, and the crown bump is gated on the
// INSERT having actually inserted, so it is exactly-once.
//
// Deliberately NOT run for a season nobody lived through: the caller passes `lived` (there were
// characters to convert), because an empty season has nothing to record and a fresh boot in season
// 100 should not manufacture 99 records.
export async function recordReckoning(pool, season) {
  // The individual: highest City Standing among the living. Read BEFORE the rollover zeroes respect
  // — City Standing reads only the survives-death legends plus respect for LEVEL display, so the
  // reset cannot move it, but reading first keeps this honest if that ever changes.
  const top = (await cityStanding(pool, 1))[0] || null;
  let championAccount = null;
  if (top) {
    const r = (await pool.query(
      'SELECT account_id FROM characters WHERE name=$1 AND alive LIMIT 1', [top.name])).rows[0];
    championAccount = r ? r.account_id : null;
  }

  // The family: most CORE districts held when the books closed. Two flat queries + a JS aggregate —
  // pg-mem cannot parse the correlated version (the /v1/gangs precedent).
  const coreIds = DISTRICTS.map((d) => d.id);
  const held = (await pool.query('SELECT id, holder_gang FROM districts WHERE holder_gang IS NOT NULL')).rows
    .filter((d) => coreIds.includes(d.id));
  const byGang = new Map();
  for (const d of held) byGang.set(d.holder_gang, (byGang.get(d.holder_gang) || 0) + 1);
  let fam = null;
  if (byGang.size) {
    const gangs = (await pool.query('SELECT id, name, tag, season_tribute, season_wars FROM gangs')).rows;
    const ranked = gangs
      .filter((g) => byGang.has(g.id))
      .map((g) => ({ ...g, districts: byGang.get(g.id),
        // the tiebreak is the SEASON's showing (the econ-pass formula), not lifetime — a family that
        // parked a treasury three seasons ago does not out-rank one that fought for this one
        standing: Number(g.season_tribute || 0) + 10000 * Number(g.season_wars || 0) }))
      .sort((a, b) => b.districts - a.districts || b.standing - a.standing || (a.id < b.id ? -1 : 1));
    fam = ranked[0] || null;
  }

  await pool.query(
    `INSERT INTO season_records (season, mod_id, champion_account, champion_name, champion_standing,
                                 family_gang, family_name, family_tag, family_districts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (season) DO NOTHING`,
    [season, seasonModOf(season).id, championAccount, top?.name || null, top?.standing || null,
     fam?.id || null, fam?.name || null, fam?.tag || null, fam?.districts || null]);

  // CLAIM-THEN-ACT, and the insert's own result is deliberately NOT what latches it. A pg-mem
  // `INSERT … ON CONFLICT DO NOTHING` reports rowCount 1 AND returns a RETURNING row even when it
  // wrote nothing (verified against the engine) — so gating the crown on "did my insert land" would
  // double-crown on every retry. A conditional UPDATE latches correctly on both engines, which is
  // the same discipline the watchdog alerts and the fee credits use.
  //
  // It is also the more correct shape: the crown is bumped from the STORED record rather than from
  // this call's freshly-computed standings, so a retry that runs after the board has shifted still
  // crowns whoever is ON the record. The record and the crown can never disagree.
  const claim = (await pool.query(
    `UPDATE season_records SET crowned = true WHERE season=$1 AND NOT crowned
     RETURNING champion_account, champion_name, champion_standing, family_name, family_districts`, [season])).rows[0];
  if (!claim) return null;   // already closed — a retry, not a second season

  // THE CROWN — a lifetime legend on the champion's bloodline (survives death, the duel_titles
  // precedent).
  if (claim.champion_account) {
    await pool.query('UPDATE account_persistent SET season_crowns = season_crowns + 1 WHERE account_id=$1', [claim.champion_account]);
    const liv = (await pool.query('SELECT id FROM characters WHERE account_id=$1 AND alive LIMIT 1', [claim.champion_account])).rows[0];
    if (liv) await pool.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
      [crypto.randomUUID(), liv.id, 'season_crown', JSON.stringify({ season, standing: claim.champion_standing })]);
  }
  return { season, champion: claim.champion_name, family: claim.family_name, districts: claim.family_districts };
}
