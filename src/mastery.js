// THE TRADES — the mastery board + the lifetime legend leaderboard (design: omerta-mastery-design.md).
//
// Pure STATUS reads over the two step-1 tables: `masteries` (character-keyed — this street's
// levels, wiped at the estate with a HEIR_KEEP_BPS echo) and `mastery_legend` (account-keyed —
// lifetime XP per track, survives death whole; rank titles + the leaderboard only). XP is not a
// currency: nothing here (or in bumpMastery) writes a `transactions` row, so §10.4 never sees it.
import { MASTERY, masteryLvlOf, masteryXpFor, masteryRankOf, masteryLegendRankOf } from './rules.js';
import { GameError, masteryFx } from './game.js';

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
    const perk = MASTERY.PERKS[t.id];
    // the milestone reached (index into fx, −1 = none yet) — display twin of game.js masteryFx
    let mi = -1;
    for (const m of MASTERY.MILESTONES) if (lvl >= m) mi++;
    const trait = (h.owned.traits || {})[t.id] || null;
    return {
      id: t.id, name: t.name, desc: t.desc, stat: t.stat,
      xp, lvl, rank: masteryRankOf(lvl),
      // distance to the next level (null at the cap) — the client renders the progress bar off this
      nextAt: lvl >= MASTERY.MAX_LVL ? null : masteryXpFor(lvl + 1),
      legendXp: Number(legend[t.id] || 0),
      // STEP TWO — the perk axis: the live value (via the same reader every touchpoint uses, so the
      // board can never disagree with the game), plus what the next milestone deepens it to
      perk: perk ? {
        what: perk.what,
        now: masteryFx(h, t.id),
        nextAt: mi < MASTERY.MILESTONES.length - 1 ? MASTERY.MILESTONES[mi + 1] : null,
        next: mi < MASTERY.MILESTONES.length - 1 ? perk.fx[mi + 1] : null,
      } : null,
      trait,
      canChooseTrait: lvl >= MASTERY.MAX_LVL && !trait,
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
    milestones: MASTERY.MILESTONES,
    traits: MASTERY.TRAITS,
    traitHeirBps: MASTERY.TRAIT_HEIR_BPS,
  };
}

// STEP TWO — THE TRAIT (the Fable moment): at level 50 in a trade, choose ONCE, permanently —
// VIRTUOSO (the perk deepens to fx[3], power now) or DYNAST (the heir keeps HALF this trade's
// schooling, legacy). Dies with the street like the levels themselves; no respec, no refund —
// a permanent choice is only a choice if it can't be unpicked.
export async function chooseTrait(ch, trackId, traitId, client, h) {
  const track = MASTERY.TRACKS.find((t) => t.id === trackId);
  if (!track) throw new GameError('bad_track', 'No such trade.');
  if (!MASTERY.TRAITS[traitId]) throw new GameError('bad_trait', 'Pick virtuoso or dynast.');
  const lvl = masteryLvlOf(Number(h.owned.mastery?.[trackId] || 0));
  if (lvl < MASTERY.MAX_LVL) throw new GameError('level', `Master the trade first (L${MASTERY.MAX_LVL}).`);
  if (h.owned.traits?.[trackId]) throw new GameError('chosen', 'That die is already cast.');
  await client.query('INSERT INTO character_traits (character_id, track_id, trait_id) VALUES ($1,$2,$3)',
    [ch.id, trackId, traitId]);
  if (h.owned.traits) h.owned.traits[trackId] = traitId; // keep the returned view honest (in-txn mirror)
  return { ok: true, track: trackId, trait: traitId, name: MASTERY.TRAITS[traitId].name };
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
