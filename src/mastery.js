// THE TRADES — the mastery board + the lifetime legend leaderboard (design: omerta-mastery-design.md).
//
// Pure STATUS reads over the two step-1 tables: `masteries` (character-keyed — this street's
// levels, wiped at the estate with a HEIR_KEEP_BPS echo) and `mastery_legend` (account-keyed —
// lifetime XP per track, survives death whole; rank titles + the leaderboard only). XP is not a
// currency: nothing here (or in bumpMastery) writes a `transactions` row, so §10.4 never sees it.
import { MASTERY, masteryLvlOf, masteryXpFor, masteryRankOf, masteryLegendRankOf } from './rules.js';

// The board: every track with this street's level/xp/next-level distance + the bloodline's
// lifetime legend beside it. `h.owned.mastery` is the loadOwned map (track_id → xp); the legend
// is read fresh (account-level, not part of the character's owned set).
export async function masteryBoard(ch, client, h) {
  const legend = Object.fromEntries((await client.query(
    'SELECT track_id, xp FROM mastery_legend WHERE account_id=$1', [ch.account_id]))
    .rows.map((r) => [r.track_id, Number(r.xp)]));
  const mine = h.owned.mastery || {};
  const tracks = MASTERY.TRACKS.map((t) => {
    const xp = Number(mine[t.id] || 0);
    const lvl = masteryLvlOf(xp);
    return {
      id: t.id, name: t.name, desc: t.desc, stat: t.stat,
      xp, lvl, rank: masteryRankOf(lvl),
      // distance to the next level (null at the cap) — the client renders the progress bar off this
      nextAt: lvl >= MASTERY.MAX_LVL ? null : masteryXpFor(lvl + 1),
      legendXp: Number(legend[t.id] || 0),
    };
  });
  const legendTotal = Object.values(legend).reduce((a, b) => a + b, 0);
  return {
    ok: true, tracks,
    maxLvl: MASTERY.MAX_LVL,
    // published so the client's progress-bar math reads the LIVE curve, not a hardcoded fallback
    xpDivisor: MASTERY.XP_DIVISOR,
    heirKeepBps: MASTERY.HEIR_KEEP_BPS,
    legend: { total: legendTotal, rank: masteryLegendRankOf(legendTotal) },
  };
}

// THE TRADES legend leaderboard — lifetime XP across every track (account-level, survives death),
// ranked with the bloodline's deepest trade beside the total. Agents excluded (the kingpin/boxing
// posture: a payout-free status board still doesn't seat machines).
export async function tradesLeaderboard(pool) {
  // flat aggregate then a per-account best-track pick in JS (the /v1/gangs two-flat-queries
  // precedent — pg-mem chokes on correlated subqueries and DISTINCT ON)
  const rows = (await pool.query(
    `SELECT ml.account_id, ml.track_id, ml.xp, c.name FROM mastery_legend ml
       JOIN account_persistent ap ON ap.account_id = ml.account_id AND NOT ap.agent_flag
       JOIN characters c ON c.account_id = ml.account_id AND c.alive
      WHERE ml.xp > 0`)).rows;
  const byAcct = new Map();
  for (const r of rows) {
    const a = byAcct.get(r.account_id) || { name: r.name, total: 0, best: null };
    a.total += Number(r.xp);
    if (!a.best || Number(r.xp) > a.best.xp) a.best = { track: r.track_id, xp: Number(r.xp) };
    byAcct.set(r.account_id, a);
  }
  const ranked = [...byAcct.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 20);
  return { trades: ranked.map((r, i) => ({
    pos: i + 1, name: r.name, xp: r.total, rank: masteryLegendRankOf(r.total),
    bestTrade: MASTERY.TRACKS.find((t) => t.id === r.best.track)?.name || r.best.track,
  })) };
}
