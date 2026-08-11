// ── THE TOKEN-HEALTH BOARD — five KPIs, each with the threshold that would make you act ──────────
// (founder-directed 2026-08-11, from the tokenomics review's "no external token-health dashboard".)
//
// The GAME is measured exhaustively — §10.4 nightly, the sim, the progression harness, the funnel,
// the coach census. The TOKEN is measured barely: the invariants prove the books cannot lie, which
// is not the same as knowing whether the economy is working. Conservation ≠ demand. This is the
// second instrument: read-only aggregation over tables that already exist, no writes, no §10.4
// surface, no new lever — five numbers and, next to each, the reading that would make a person do
// something about it.
//
// WHY EACH ONE, in the design's own terms:
//   1. RETURN VELOCITY — "revenue ≈ sink volume × price, and the KPI is how many times a year one
//      token comes home" (economy v3 §3.3/§4.2). It is THE revenue KPI, and it is also the
//      velocity-vs-holding instrument's numerator.
//   2. SINK VOLUME PER ACTIVE PLAYER — the same figure per head, which is what actually multiplies
//      by DAU into revenue. A token can have high velocity on ten whales and still have no business.
//   3. DESK CLEARANCE — a desk that collects and never sells is "indistinguishable, from the outside,
//      from a burn with extra steps" (step 2's own header). Clearance is what turns recycled supply
//      into ETH; if it stalls, the shelf grows and the revenue model is not running.
//   4. THE FLOAT SPLIT — committed (staked + unbonding) vs liquid. The D8=D ladder, the loot tiers
//      and the family yield all pay players to LOCK $OMR while the revenue model needs them to SPEND
//      it. Nobody has modelled that equilibrium; this measures it live.
//   5. QUEUE DEPTH vs RESERVE BACKING — the full-reserve queue means a demand shock shows up as a
//      QUEUE, never insolvency. So the queue is the shock gauge, and a standing queue is the signal
//      that extraction demand has outrun what the buybacks fund.
//
// DORMANT IS NOT A FAILING GRADE, and getting that wrong would make the board useless before launch:
// with no market there is no auction, no withdrawal and no float, so most of these are structurally
// zero. A zero that means "not launched" must never render as "the desk is starving" — every KPI
// reports `dormant` when its denominator does not exist yet, which is the same discipline the desk's
// own `no_price` (expected, quiet) vs `stale_price` (alarm) split already uses.
//
// The thresholds are OBSERVATION bands, not signed levers: they say what would make a person look,
// and they are stated here rather than left in someone's head. Moving one is a judgement call about
// what "healthy" means, not an economy change — nothing in the game reads this file.
import { DESK, DESK_RECYCLE_REASON, recyclesToDesk } from './rules.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);
const pct = (n) => Math.round(n * 1000) / 10;

// A KPI is a value + the reading that would make you act. `state` is one of:
//   dormant — the denominator does not exist yet (pre-market); nothing to judge, and saying so is
//             the whole point (a structural zero must not read as an alarm)
//   ok / watch / act — the observation bands below
const kpi = (key, label, value, unit, state, reads, threshold, why) =>
  ({ key, label, value, unit, state, reads, threshold, why });

export async function tokenHealth(pool, { days = 7, now = Date.now() } = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(days) || 7));
  const since = new Date(now - windowDays * 24 * 3600 * 1000);
  const one = async (sql, args = []) => num((await pool.query(sql, args)).rows[0]?.s);

  // ── THE FLOAT ─────────────────────────────────────────────────────────────────────────────────
  // What players and their organisations HOLD (the tokens that can come home), split by whether the
  // holder has committed them. Deliberately separate from the SYSTEM pools below: a token sitting in
  // the desk's shelf or the family pot is not a player deciding to hold, and folding the two would
  // make the velocity denominator grow every time the house collected a sink.
  const liquid = await one('SELECT COALESCE(SUM(omr),0) s FROM account_persistent');
  const staked = await one('SELECT COALESCE(SUM(staked),0) s FROM account_persistent');
  const unbonding = await one('SELECT COALESCE(SUM(unbonding),0) s FROM account_persistent');
  const gangReserves = await one('SELECT COALESCE(SUM(omr_reserve),0) s FROM gangs');
  const committed = round6(staked + unbonding);
  const playerFloat = round6(liquid + committed + gangReserves);

  // the house's own pools — reported so the board's float and the §10.4 bucket sum are reconcilable
  // by eye, and because a growing shelf against a flat clearance rate is the step-3 failure picture.
  const shelf = await one('SELECT COALESCE(SUM(balance),0) s FROM desk_inventory');
  const familyPot = await one('SELECT COALESCE(SUM(balance),0) s FROM family_yield_pool');
  const eventFund = await one('SELECT COALESCE(SUM(fund),0) s FROM street_tax');
  const devFund = await one('SELECT COALESCE(SUM(omr),0) s FROM dev_fund');
  const systemPools = round6(shelf + familyPot + eventFund + devFund);

  // ── SINK VOLUME ───────────────────────────────────────────────────────────────────────────────
  // Measured off the `desk:recycle` rows, which is drift-proof BY CONSTRUCTION: the ledger hook
  // writes exactly one per recycled sink and reads the same DESK.SINK_REASONS list the §10.4 burn
  // term is generated from, so a sink added tomorrow is counted here the day it ships without this
  // file knowing it exists. (Restating the list here is what would rot.)
  const recycled = await one(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason=$1 AND at > $2",
    [DESK_RECYCLE_REASON, since]);
  // The one sink that does NOT feed the desk: the token left for the chain. Read from the rules'
  // own NOT_RECYCLED list, so if that list ever grows this follows it.
  const notRecycled = DESK.NOT_RECYCLED || ['withdraw:omr'];
  let withdrawn = 0;
  for (const r of notRecycled)
    withdrawn += await one(
      "SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE currency='omr' AND reason=$1 AND amount < 0 AND at > $2",
      [r, since]);
  const sinkVolume = round6(recycled + withdrawn);

  // ── WHO IS SPENDING — the agent-vs-human composition (the review's angle 5) ────────────────────
  // One grouped query, then filtered in JS through `recyclesToDesk` — the SAME predicate the ledger
  // hook uses to decide what feeds the desk, so "what counts as a sink" cannot drift between the
  // dashboard and the game. Doing it this way also avoids a generated NOT-IN (pgquery's interpolated
  // ceiling) and gives the per-reason breakdown, which is the actually-useful half: the question is
  // not how much agents spend, it is WHICH sinks an EV optimizer routes around.
  const byReason = (await pool.query(
    `SELECT t.reason, ap.agent_flag, COALESCE(SUM(-t.amount),0) s
       FROM transactions t JOIN account_persistent ap ON ap.account_id = t.account_id
      WHERE t.currency='omr' AND t.amount < 0 AND t.at > $1
      GROUP BY t.reason, ap.agent_flag`, [since])).rows;
  const cohort = { human: 0, agent: 0 };
  const reasons = new Map();
  for (const r of byReason) {
    if (!recyclesToDesk(r.reason)) continue;          // sinks only — a transfer out is not spend
    const who = r.agent_flag ? 'agent' : 'human';
    cohort[who] = round6(cohort[who] + num(r.s));
    const e = reasons.get(r.reason) || { reason: r.reason, human: 0, agent: 0 };
    e[who] = round6(e[who] + num(r.s));
    reasons.set(r.reason, e);
  }
  const topSinks = [...reasons.values()]
    .sort((a, b) => (b.human + b.agent) - (a.human + a.agent)).slice(0, 12);

  // ── ACTIVE PLAYERS ────────────────────────────────────────────────────────────────────────────
  // The ops `active24h` shape, widened to the window and split by cohort. Residents are excluded
  // (scenery, not demand); agents are counted as players because they ARE players and their spend
  // is real revenue — the split above is what separates the two stories.
  const activeHumans = await one(
    `SELECT COUNT(*) s FROM characters c JOIN account_persistent ap ON ap.account_id = c.account_id
      WHERE c.alive AND NOT c.is_npc AND NOT ap.agent_flag AND c.last_accrued_at > $1`, [since]);
  const activeAgents = await one(
    `SELECT COUNT(*) s FROM characters c JOIN account_persistent ap ON ap.account_id = c.account_id
      WHERE c.alive AND NOT c.is_npc AND ap.agent_flag AND c.last_accrued_at > $1`, [since]);
  const active = activeHumans + activeAgents;

  // ── THE DESK'S CLEARANCE ──────────────────────────────────────────────────────────────────────
  const auctions = (await pool.query(
    "SELECT qty_omr, sold_omr FROM desk_auctions WHERE status='closed' AND closes_at > $1", [since])).rows;
  const offered = round6(auctions.reduce((a, r) => a + num(r.qty_omr), 0));
  const sold = round6(auctions.reduce((a, r) => a + num(r.sold_omr), 0));

  // ── THE WITHDRAWAL QUEUE ──────────────────────────────────────────────────────────────────────
  // Reuses chain.js's own reserveStatus rather than recomputing it — one implementation, so the
  // board and the rail can never disagree about what is outstanding (the extortFront one-core rule).
  const { reserveStatus } = await import('./chain.js');
  const reserve = await reserveStatus(pool);

  // ── THE FIVE ─────────────────────────────────────────────────────────────────────────────────
  const perYear = 365 / windowDays;
  const velocity = playerFloat > 0 ? round2(sinkVolume * perYear / playerFloat) : null;
  const perPlayerDay = active > 0 ? round2(sinkVolume / active / windowDays) : null;
  const clearance = offered > 0 ? sold / offered : null;
  const committedShare = playerFloat > 0 ? committed / playerFloat : null;

  const kpis = [
    kpi('velocity', 'return velocity', velocity, 'turns/year',
      velocity === null ? 'dormant' : velocity < 2 ? 'act' : velocity < 4 ? 'watch' : 'ok',
      `${round6(sinkVolume)} $OMR of sinks over ${windowDays}d against a ${round6(playerFloat)} $OMR player float`,
      'watch under 4 turns/year · act under 2',
      'Revenue is sink volume x price, so this IS the revenue engine expressed per token held. Low '
      + 'velocity means the float is idle: the shelf starves, the auction has nothing to sell, and the '
      + 'business is thin however many tokens exist. Read it beside the float split — idle-because-'
      + 'committed and idle-because-disengaged are different problems with different fixes.'),

    kpi('sinkPerPlayer', 'sink volume per active player', perPlayerDay, '$OMR/player/day',
      perPlayerDay === null ? 'dormant' : perPlayerDay < 0.5 ? 'act' : perPlayerDay < 2 ? 'watch' : 'ok',
      `${round6(sinkVolume)} $OMR over ${windowDays}d across ${active} active (${activeHumans} human, ${activeAgents} agent)`,
      'watch under 2 $OMR/player/day · act under 0.5',
      'What multiplies by headcount into revenue. This is the number to multiply out before believing '
      + 'any revenue target: target ÷ this = the DAU required. If it is low while velocity is fine, '
      + 'the economy is running on a few whales rather than a population.'),

    kpi('clearance', 'desk clearance rate', clearance === null ? null : pct(clearance), '%',
      clearance === null ? 'dormant' : clearance < 0.25 ? 'act' : clearance < 0.6 ? 'watch' : 'ok',
      offered > 0 ? `${round6(sold)} of ${round6(offered)} $OMR offered cleared over ${windowDays}d`
                  : 'no auction has closed in the window (pre-market, or the anchor is unavailable)',
      'watch under 60% cleared · act under 25%',
      'The desk collects every sink and sells it back for ETH; if it does not clear, recycled supply '
      + 'is not converting to revenue and the shelf grows without bound. A low rate means either the '
      + 'reserve (the band) sits above what the market will pay, or there is no demand at any price — '
      + 'the shelf balance beside it tells you which.'),

    kpi('committedShare', 'float committed (staked + unbonding)',
      committedShare === null ? null : pct(committedShare), '% of player float',
      committedShare === null ? 'dormant' : committedShare > 0.8 ? 'watch' : committedShare < 0.15 ? 'watch' : 'ok',
      `${round6(committed)} committed of ${round6(playerFloat)} held (${round6(liquid)} liquid, ${round6(gangReserves)} in family reserves)`,
      'watch above 80% (holding wins, the shelf starves) or below 15% (nothing is at stake)',
      'THE CONTRADICTION MADE VISIBLE: the made ladder, the loot tiers and the family yield pay '
      + 'players to lock $OMR, while the revenue model needs them to spend it. Neither extreme is '
      + 'healthy. If holding runs away the dial is OMR_LOOT_COMMITTED (raise it and a staked hoard '
      + 'stops being a shelter) or the ladder rung heights; if nothing is committed, the ladder is '
      + 'not worth climbing at current prices.'),

    kpi('queue', 'withdrawal queue vs reserve', round6(reserve.queuedOmr),
      '$OMR queued, unsigned',
      reserve.fundedOmr <= 0 && reserve.queuedOmr <= 0 ? 'dormant'
        : reserve.queuedOmr > reserve.fundedOmr ? 'act' : reserve.queuedOmr > 0 ? 'watch' : 'ok',
      `${round6(reserve.queuedOmr)} queued · ${round6(reserve.committedOutstanding)} committed of ${round6(reserve.fundedOmr)} funded`
        + (reserve.reserveRatio !== null ? ` · backing ${round2(reserve.reserveRatio)}x` : ''),
      'watch on any standing queue · act when queued exceeds the whole funded reserve',
      'The full-reserve rail turns a demand shock into a QUEUE rather than insolvency, which makes '
      + 'the queue the shock gauge. A standing queue is extraction demand outrunning what the Vig and '
      + 'community buybacks fund — the answer is funding cadence, never signing past the reserve.'),
  ];

  const worst = kpis.some((k) => k.state === 'act') ? 'act'
    : kpis.some((k) => k.state === 'watch') ? 'watch'
    : kpis.every((k) => k.state === 'dormant') ? 'dormant' : 'ok';

  return {
    window: { days: windowDays, since: since.toISOString() },
    verdict: worst,
    kpis,
    float: {
      player: { liquid: round6(liquid), staked: round6(staked), unbonding: round6(unbonding),
        gangReserves: round6(gangReserves), total: playerFloat },
      system: { shelf: round6(shelf), familyPot: round6(familyPot), eventFund: round6(eventFund),
        devFund: round6(devFund), total: systemPools },
    },
    sinks: { windowVolume: sinkVolume, recycled: round6(recycled), withdrawn: round6(withdrawn),
      // WHO is spending — the composition readout, not a graded KPI. An agent share climbing is the
      // "agents may be the actual demand engine" story becoming measurable; a sink with human volume
      // and near-zero agent volume is one an EV optimizer has decided is not worth paying for.
      byCohort: cohort, topSinks },
    players: { active, humans: activeHumans, agents: activeAgents },
    desk: { offered, sold, shelf: round6(shelf) },
    reserve,
  };
}
