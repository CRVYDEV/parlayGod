// ENGAGEMENT + RETENTION — which of the game's systems anyone actually uses, and whether players
// come back. Founder-facing, read-only, zero §10.4 surface.
//
// Why this exists: the game has 40+ systems and 134 distinct telemetry events across 185 call sites,
// and until now NOTHING read them for engagement. `opsOverview` reports counts, wealth and economy
// gauges; `funnelStats` reports onboarding steps. Neither answers the two questions that decide what
// to build next:
//
//   1. Which systems has a human ever opened?   (it is entirely possible a dozen never have been)
//   2. Do players come back on day 2?
//
// No new instrumentation — the events were already being written. This is the reader that was
// missing, which is why it is cheap.
//
// THE DEAD LIST is the point. A system with zero distinct accounts is either undiscoverable, not
// fun, or not reachable — and all three are worth knowing before building a 41st system. That
// requires enumerating systems that COULD emit, not just those that DID, so SYSTEMS below is a
// declared catalog rather than a GROUP BY over whatever happens to be in the table.
//
// pg-mem: every query here is flat (no correlated subqueries, no window functions) and aggregation
// happens in JS — the /v1/gangs precedent. Row reads are capped so a large alpha cannot make the
// dashboard the slowest thing in the process.

const num = (v) => Number(v || 0);
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// ── the system catalog ───────────────────────────────────────────────────────────────────────────
// system → the telemetry events that mean "a player used this system". Declared, not derived, so a
// system nobody has touched still appears (with zero) instead of vanishing from the report.
//
// `test/engagement.js` asserts this catalog claims EVERY `track()` event name in src/ and claims
// none that does not exist — the KNOWN_REASONS discipline. A new system whose events are missing
// here fails CI rather than silently reading as dead.
export const SYSTEMS = {
  'streets / crime': ['crime_attempt'],
  'the kitchen': ['deal', 'raid'],
  'wet work': ['kill', 'npchit', 'shank', 'respawn', 'safehouse', 'bodyguard_hire', 'bodyguard_absorb'],
  'contracts': ['family_contract'],
  'the dueling ladder': ['duel'],
  'crew heists': ['heist_plan', 'heist_join', 'heist_score', 'heist_case', 'heist_fence', 'heist_rat'],
  'clue scrolls': ['clue_casket'],
  'the family': ['gang_foundation', 'gang_seal', 'family_dynasty_name'],
  'the commission': ['commission_vote', 'commission_veto', 'commission_proposal', 'commission_override'],
  'territory': ['territory_raid', 'territory_op', 'territory_specialist', 'sov_income'],
  'the world': ['world_raid', 'world_raid_plan', 'world_raid_join'],
  'business empire': ['business_raid'],
  'convoys': ['convoy_depart', 'convoy_ambush'],
  'the port': ['port'],
  'the black market': [],
  'loan sharking': ['loan_collect', 'loan_house_take', 'loan_house_repay'],
  'the casino': ['casino', 'ring_sit', 'ring_deal', 'ring_act', 'ring_leave'],
  'the speakeasy': ['speakeasy_open', 'speakeasy_round', 'speakeasy_table', 'speakeasy_bottle',
    'speakeasy_upgrade', 'speakeasy_name', 'speakeasy_list', 'speakeasy_buyout', 'speakeasy_standover',
    'speakeasy_raid'],
  'boxing': ['boxing_recruit', 'boxing_train', 'boxing_bout', 'boxing_exhibition', 'boxing_bet',
    'boxing_main_event', 'boxing_callout', 'boxing_callout_accept'],
  'street races': ['race'],
  'the stable': ['stable_buy', 'stable_train', 'stable_circuit', 'stable_race', 'stable_breed', 'stable_stakes'],
  'the law': ['rico', 'indicted', 'flip', 'envelope'],
  'the pen': ['pen_break', 'pen_break_plan', 'pen_break_join', 'pen_break_rat', 'pen_coop_break', 'pen_faction_join'],
  'the wire': ['wiretap', 'wire_sub', 'wire_sweep', 'wire_trace', 'wire_dossier', 'wire_disinfo',
    'wire_informant', 'wire_watch', 'wire_watch_cancel', 'intel_peek'],
  'secrets': ['secret_exposed', 'hush_paid'],
  'skills': ['skill_learned', 'skill_active', 'skill_respec', 'skill_respec_one', 'respec'],
  'the underworld': ['underworld_gift', 'underworld_penance', 'underworld_favor', 'underworld_errand',
    'underworld_discharge', 'underworld_gunsale'],
  'the estate': ['estate_tier', 'estate_feature', 'estate_gala', 'estate_gala_attend', 'estate_staff_hire',
    'estate_staff_dismiss', 'estate_wages'],
  'the auction house': ['auction_bid', 'auction_consign', 'auction_consign_bid'],
  // ('rwa_dividend' retired with the personal dividend — tokenomics v2 step 2; the family one stays)
  'going legit (rwa)': ['rwa_invest', 'rwa_family_invest', 'rwa_family_dividend',
    'rwa_vault_claim', 'dynasty_name'],
  'the megaproject': ['megaproject_give'],
  'street life': ['corner', 'contact_call'], // #318: corner-board claims + settled contact calls
  'landmarks': ['landmark'],
  'vanity': ['vanity_name', 'vanity_gang_name'],
  'the store / pass': ['plex', 'plex_package', 'pass_claim'],
  'growth / social': ['social_task', 'social_post', 'broadcast_share', 'first_week_step',
    'referral_qualified', 'referral_spark', 'referral_same_ip_flag', 'referral_claim_late'],
};

// Events that exist but are NOT player engagement — moderator actions and anti-abuse flags. Declared
// so the catalog test can demand total coverage: every event is either a system's or explicitly not
// one. Silence is never allowed to be the answer.
export const NON_ENGAGEMENT = ['mod_kill_reason'];

const EVENT_TO_SYSTEM = (() => {
  const m = new Map();
  for (const [sys, evs] of Object.entries(SYSTEMS)) for (const e of evs) m.set(e, sys);
  return m;
})();

const MAX_ROWS = 200000;   // a hard read cap so the dashboard cannot become the slowest thing here

/**
 * @param {number} days rolling window for activity/engagement (retention cohorts use account age)
 */
export async function opsEngagement(pool, days = 14) {
  const win = Math.min(90, Math.max(1, Math.floor(Number(days) || 14)));
  const since = new Date(Date.now() - win * 864e5);

  // Real players only. NPC residents are flagged accounts that emit no telemetry by design, but
  // agents DO play and DO emit — they are counted separately rather than mixed into "do humans
  // come back", because an agent returning says nothing about whether the game is fun.
  const accounts = (await pool.query(
    `SELECT a.id, a.created_at, COALESCE(p.agent_flag,false) AS agent, COALESCE(p.npc_flag,false) AS npc
       FROM accounts a LEFT JOIN account_persistent p ON p.account_id = a.id
      WHERE a.status <> 'banned' LIMIT $1`, [MAX_ROWS])).rows;
  const human = new Map();
  let agents = 0;
  for (const a of accounts) {
    if (a.npc) continue;
    if (a.agent) { agents++; continue; }
    human.set(a.id, { created: a.created_at, days: new Set() });
  }

  // Flat read, JS aggregation (pg-mem). Windowed, so this scales with activity not with history.
  const rows = (await pool.query(
    'SELECT account_id, event, at FROM telemetry WHERE at >= $1 LIMIT $2', [since, MAX_ROWS])).rows;

  const perSystem = new Map();          // system -> {accounts:Set, events:n, last:Date}
  const uncatalogued = new Map();       // event -> count (never silently dropped)
  const nonEng = new Set(NON_ENGAGEMENT);

  for (const r of rows) {
    const h = human.get(r.account_id);
    if (h) h.days.add(dayKey(r.at));    // activity day, for DAU + retention
    if (nonEng.has(r.event)) continue;
    const sys = EVENT_TO_SYSTEM.get(r.event);
    if (!sys) { uncatalogued.set(r.event, (uncatalogued.get(r.event) || 0) + 1); continue; }
    if (!perSystem.has(sys)) perSystem.set(sys, { accounts: new Set(), events: 0, last: null });
    const s = perSystem.get(sys);
    s.events++;
    if (h) s.accounts.add(r.account_id);   // DISTINCT HUMANS — one player hammering a system is not adoption
    if (!s.last || new Date(r.at) > new Date(s.last)) s.last = r.at;
  }

  // ── systems, including the ones nobody has touched ─────────────────────────────────────────────
  const systems = Object.keys(SYSTEMS).map((sys) => {
    const s = perSystem.get(sys) || { accounts: new Set(), events: 0, last: null };
    return { system: sys, accounts: s.accounts.size, events: s.events, last: s.last };
  }).sort((a, b) => b.accounts - a.accounts || b.events - a.events);

  // A system with no events AND no declared events is untracked, not dead — say which it is rather
  // than reporting an instrumentation gap as a player verdict.
  const dead = systems.filter((s) => s.accounts === 0 && SYSTEMS[s.system].length > 0).map((s) => s.system);
  const untracked = Object.keys(SYSTEMS).filter((s) => SYSTEMS[s].length === 0);

  // ── retention ─────────────────────────────────────────────────────────────────────────────────
  // Cohort by ACCOUNT CREATION day (accounts.created_at), retained if the account has any telemetry
  // on a later day. Bounded and honest: a cohort whose window has not elapsed yet is reported as
  // pending rather than counted as churned, which is the classic way to make retention look worse
  // than it is on a young alpha.
  const now = Date.now();
  const cohort = (offset) => {
    let eligible = 0, returned = 0, pending = 0;
    for (const [, h] of human) {
      const born = new Date(h.created).getTime();
      const ageDays = (now - born) / 864e5;
      if (ageDays < offset) { pending++; continue; }
      eligible++;
      const bornDay = dayKey(born);
      // returned = active on any day at least `offset` days after signup
      for (const d of h.days) {
        if ((new Date(d).getTime() - new Date(bornDay).getTime()) / 864e5 >= offset) { returned++; break; }
      }
    }
    return { eligible, returned, pending, rate: eligible ? Math.round((returned / eligible) * 1000) / 10 : null };
  };

  // DAU by day across the window
  const daily = [];
  for (let i = win - 1; i >= 0; i--) {
    const d = dayKey(now - i * 864e5);
    let active = 0, fresh = 0;
    for (const [, h] of human) {
      if (h.days.has(d)) active++;
      if (dayKey(h.created) === d) fresh++;
    }
    daily.push({ day: d, active, new: fresh });
  }

  const activeDayCounts = [...human.values()].map((h) => h.days.size).filter((n) => n > 0).sort((a, b) => a - b);
  const median = activeDayCounts.length ? activeDayCounts[Math.floor(activeDayCounts.length / 2)] : 0;

  return {
    window: win,
    players: {
      humans: human.size,
      agents,
      activeInWindow: activeDayCounts.length,
      neverActive: human.size - activeDayCounts.length,
    },
    retention: { d1: cohort(1), d7: cohort(7), medianActiveDays: median, daily },
    systems,
    dead,
    untracked,
    // Events in the table that no system claims. Counted and surfaced — an instrumentation drift
    // that silently vanished would make the dead list a lie.
    uncatalogued: [...uncatalogued.entries()].map(([event, count]) => ({ event, count })).sort((a, b) => b.count - a.count),
  };
}
