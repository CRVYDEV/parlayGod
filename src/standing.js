// THE CITY STANDING — the unifying "who's winning" spine over the 35 status axes.
//
// The game grew ~35 separate leaderboards, each its own island with its own legend column and rank
// ladder, so a player had no single answer to "what am I climbing." This is that answer: ONE aggregate
// metric that folds every account-level legend into six legible PILLARS, so the endgame finally has a
// spine. Pure STATUS aggregation — read-only SELECTs over the survives-death `account_persistent`
// legends, ZERO §10.4 surface (no currency, no faucet, no ledger row; the hitman-rep/portfolio board
// precedent). Agents are excluded like every other status board.
//
// Scoring: each pillar sums its member columns, then scores LOG-SHARE vs the population max
// (log(1+v)/log(1+max) × 100) so breadth across many axes beats maxing one, and a linear whale can't
// swamp the board. City Standing = the sum of the six pillar scores (0–600). It's RELATIVE by
// construction (your standing among the living), recomputed on every read — nothing is stored.
import { levelOf } from './rules.js';

// The six pillars — every account-level legend grouped into a legible theme. Columns are all NUMERIC
// survives-death legends on account_persistent (kills/hitman_rep included — used by hitmanLeaderboard).
export const STANDING_PILLARS = [
  { key: 'blood',  name: 'Blood',   cols: ['kills', 'hitman_rep', 'boxing_wins', 'duel_wins', 'cartel_damage', 'soldiers_led'] },
  { key: 'empire', name: 'Empire',  cols: ['tycoon_earned', 'laundered_lifetime', 'smuggled', 'product_moved', 'freight_delivered', 'heists_pulled'] },
  { key: 'power',  name: 'Power',   cols: ['statecraft', 'recruits', 'prestige'] },
  { key: 'legit',  name: 'Legit',   cols: ['rwa_invested', 'monument_built', 'prestige_sunk'] },
  { key: 'hustle', name: 'Hustle',  cols: ['race_wins', 'racer_wins', 'caskets', 'intel_ops'] },
  { key: 'honor',  name: 'Honor',   cols: ['honor_peak'] },
];

const ALL_COLS = [...new Set(STANDING_PILLARS.flatMap((p) => p.cols))];
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const logShare = (v, max) => (max <= 0 || v <= 0) ? 0 : Math.round(100 * Math.log1p(v) / Math.log1p(max));

// The living, non-agent, non-banned population with their legends + living street (one flat query —
// the /v1/gangs two-queries precedent; pg-mem can't do the correlated version). Banned accounts and
// agents are excluded (the agentLeaderboard posture — a status board is for the human game).
async function population(pool) {
  const sel = ALL_COLS.map((c) => `COALESCE(a.${c},0) AS ${c}`).join(', ');
  return (await pool.query(
    `SELECT a.account_id, ${sel}, c.name, c.respect
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
       JOIN accounts ac ON ac.id = a.account_id
      WHERE NOT a.agent_flag AND ac.status <> 'banned'`)).rows;
}

// score every account: per-pillar log-share of the population max, summed into City Standing.
function scoreAll(rows) {
  // population max per column (for the log-share denominator)
  const colMax = {};
  for (const col of ALL_COLS) colMax[col] = Math.max(0, ...rows.map((r) => num(r[col])));
  return rows.map((r) => {
    const pillars = {};
    let total = 0;
    for (const p of STANDING_PILLARS) {
      const raw = p.cols.reduce((s, c) => s + num(r[c]), 0);
      const pmax = p.cols.reduce((s, c) => s + colMax[c], 0);
      const score = logShare(raw, pmax);
      pillars[p.key] = score;
      total += score;
    }
    return { accountId: r.account_id, name: r.name, level: levelOf(Number(r.respect)),
      standing: total, pillars };
  }).sort((a, b) => b.standing - a.standing);
}

const rankTitle = (s) => s >= 480 ? 'Capo di Tutti Capi' : s >= 360 ? 'Boss of the City' : s >= 240 ? 'Made Legend' :
  s >= 120 ? 'Rising Name' : s >= 40 ? 'Known on the Street' : 'Nobody Yet';

// GET /v1/leaderboard/city — the master board. Top N by City Standing with the pillar breakdown, so a
// reader sees not just the rank but WHY (top in Blood, thin in Legit…). The one place that answers
// "who is actually winning this city."
export async function cityStanding(pool, limit = 25) {
  const scored = scoreAll(await population(pool));
  return scored.slice(0, limit).map((r, i) => ({
    rank: i + 1, name: r.name, level: r.level, standing: r.standing,
    title: rankTitle(r.standing), pillars: r.pillars,
  }));
}

// a single player's own City Standing + pillar breakdown + where they place — surfaced on the view and
// the console so the spine is personal, not just a board you scroll. Computed against the full
// population (rank is real), so an account with no legends yet reads 0 / unranked.
export async function myStanding(pool, accountId) {
  const scored = scoreAll(await population(pool));
  const idx = scored.findIndex((r) => r.accountId === accountId);
  if (idx < 0) return { standing: 0, title: rankTitle(0), rank: null, of: scored.length,
    pillars: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, 0])),
    pillarNames: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, p.name])) };
  const me = scored[idx];
  return { standing: me.standing, title: rankTitle(me.standing), rank: idx + 1, of: scored.length, pillars: me.pillars,
    pillarNames: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, p.name])) };
}
