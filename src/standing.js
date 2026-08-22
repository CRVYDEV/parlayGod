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
// construction (your standing among the living) and nothing is stored — it is recomputed from the
// living population, cached server-wide for a short window (see the memo below, which is why that
// sentence no longer reads "on every read").
import { levelOf } from './rules.js';
import { memo } from './memo.js';

// The six pillars — every account-level legend grouped into a legible theme. Columns are all NUMERIC
// survives-death legends on account_persistent (kills/hitman_rep included — used by hitmanLeaderboard).
export const STANDING_PILLARS = [
  { key: 'blood',  name: 'Blood',   cols: ['kills', 'hitman_rep', 'boxing_wins', 'duel_wins', 'cartel_damage', 'soldiers_led'] },
  { key: 'empire', name: 'Empire',  cols: ['tycoon_earned', 'laundered_lifetime', 'smuggled', 'product_moved', 'freight_delivered', 'heists_pulled'] },
  { key: 'power',  name: 'Power',   cols: ['statecraft', 'recruits', 'prestige'] },
  { key: 'legit',  name: 'Legit',   cols: ['monument_built', 'prestige_sunk'] }, // (D11: rwa_invested dropped — the column froze with the Portfolio, and a frozen legend grandfathers old accounts against new ones)
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
      WHERE NOT a.agent_flag AND NOT a.npc_flag AND ac.status <> 'banned'`)).rows;
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

// THE SCORED POPULATION IS THE SAME ARRAY FOR EVERY PLAYER, so computing one per caller is that scan
// N times over — and this was the most expensive polled read in the game. Measured on real Postgres at
// a 3,000-player population: 57ms per /v1/leaderboard/city call, because the route ran this scan TWICE
// (once for the board, once to find the caller's rank). Every idle player on the landing screen polls
// it, so the SERVER-WIDE total is quadratic: at the poll-cost ceiling (~4,350 concurrent) that is ~180
// seconds of database time a minute — three CPU cores for one card, on the half the scaling
// measurement already calls binding. pg-mem reported a super-linear curve here and real Postgres a
// linear one; the linear figure is the real one, and it is still quadratic in TOTAL because each of N
// players pays cost(N).
//
// So the shared half is memoized and the PERSONAL half is not, and that split is the whole correctness
// argument: myStanding still computes its own answer out of the shared array, so nothing belonging to
// one player is ever handed to another. Caching the route's {board, you} payload instead would be the
// classic leak, and `you` is exactly the field that makes it tempting.
//
// The cost of the window is honest and small: for up to STANDING_CACHE_MS a brand-new account can read
// `rank: null` — which is already what an account outside the population reads, and a new account's
// standing is 0 either way. A cache-bypass for the not-found case was considered and rejected: it hands
// every caller a way to force the full scan, which is the amplification this exists to remove.
//
// The window, exported so the recruiters board on the same landing screen shares ONE definition of it
// rather than restating the default — two copies of a number is how the two come to disagree.
export const standingCacheMs = () => Number(process.env.STANDING_CACHE_MS ?? 30000);
const scoredPopulation = memo(async (pool) => scoreAll(await population(pool)), standingCacheMs);

// GET /v1/leaderboard/city — the master board. Top N by City Standing with the pillar breakdown, so a
// reader sees not just the rank but WHY (top in Blood, thin in Legit…). The one place that answers
// "who is actually winning this city."
export async function cityStanding(pool, limit = 25) {
  const scored = await scoredPopulation(pool);
  return scored.slice(0, limit).map((r, i) => ({
    rank: i + 1, name: r.name, level: r.level, standing: r.standing,
    title: rankTitle(r.standing), pillars: r.pillars,
  }));
}

// a single player's own City Standing + pillar breakdown + where they place — surfaced on the view and
// the console so the spine is personal, not just a board you scroll. Computed against the full
// population (rank is real), so an account with no legends yet reads 0 / unranked.
export async function myStanding(pool, accountId) {
  const scored = await scoredPopulation(pool);
  const idx = scored.findIndex((r) => r.accountId === accountId);
  if (idx < 0) return { standing: 0, title: rankTitle(0), rank: null, of: scored.length,
    pillars: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, 0])),
    pillarNames: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, p.name])) };
  const me = scored[idx];
  return { standing: me.standing, title: rankTitle(me.standing), rank: idx + 1, of: scored.length, pillars: me.pillars,
    pillarNames: Object.fromEntries(STANDING_PILLARS.map((p) => [p.key, p.name])) };
}
