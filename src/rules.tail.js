// The HAND-WRITTEN half of the rules: every constant, catalog, ladder, helper and founder-signed
// lever that is not lifted from the prototype. The extractor never reads or writes this file, so
// nothing in here can be lost to a regeneration — which is exactly what used to be possible when
// both halves shared one file (a regeneration silently deleted recruitRankOf, and resurrected the
// retired "Star the repo" onboarding task).
//
// Import from './rules.js', not from here — that module re-exports both halves, so every existing
// import site is unchanged and callers need not know which half a name comes from.
import {
  ASSETS, CARS, CITY_EVENTS, CRIMES, DAILY_POOL, DISTRICTS, DRUGS, FAMILY_TASKS, GOODS, GUNS, KITCHENS, MARKET, RACKETS, RANKS, RECRUIT_MILESTONES, TRADE_RANKS, TRIMS, VESTS,
} from './rules.generated.js';

// The highest recruit milestone a recruiter has reached — a pure STATUS rank for the recruiters
// leaderboard (display-only; the payout still fires per-milestone in maybeQualifyReferral).
export function recruitRankOf(n) {
  let rank = null;
  for (const m of RECRUIT_MILESTONES) if (n >= m.n) rank = m.name;
  return rank;
}

export const CONSTANTS = {
  // Randomized starting build — every fresh character rolls a UNIQUE distribution of the SAME
  // fixed budget (no two the same, but the total is constant → zero power creep, so the
  // sim-audited stat economy is untouched). Each stat floors at CREATE_STAT_MIN and they always
  // sum to CREATE_STAT_TOTAL. The $OMR respec keeps its own ≥5 floor (RESPEC_STAT_MIN) — a
  // deliberate rebalance toward the middle — while a fresh roll or a paid re-roll can spike to 9.
  CREATE_STAT_MIN: 3, CREATE_STAT_TOTAL: 15,
  GARAGE_CAP: 12, GTA_CD_MS: 300000, MELT_TITHE: 0.25, TITHE_ROUND_VALUE: 30,
  SEARCH_MS: 3*3600*1000, SHOOT_CD_MS: 2*3600*1000, MIN_FIRE: 50,   // PRODUCTION timers
  COOK_MULT: 12, APY: 0.14, SWAP_MIN: 500, PATH_FIRST_COST: 10000, PATH_SWITCH_OMR: 25,
  ONBOARD_CAPSTONE: { cash: 5000, cb: 3, en: 25 },
  TRAVEL_COST: 250, BANK_RATE: 0.02, BANK_PERIOD_MS: 12*3600*1000, OFFLINE_CAP_MS: 8*3600*1000,
  // COACH_BANK_NUDGE (progression harness) — the coach's "you're carrying too much" floor. The old $25k
  // was a level-1-era number: the harness measured a mid-game session netting ~$360k, so it fired on
  // every read and, from its old position above the milestone rungs, masked them. It now lives in the
  // recurring tail (see coachOf/COACH_NUDGES) at a floor that still means something mid-game.
  COACH_BANK_NUDGE: 250000,
  // D2b racket/front income cap — rolling budget refills to this many hours of income per
  // real day (continuous online play tops out here); offline collect still bursts to
  // OFFLINE_CAP_MS. 12h is the generous end of the plan's 8-12h range; re-sim + founder
  // sign-off before tuning tighter (ground rule #1 — this bounds a faucet, not a mechanic).
  RACKET_DAILY_CAP_MS: 12*3600*1000,
  // Risk-to-Earn Phase 1 (new/tunable, sim + sign-off). P1.2 LAUNDERING: converting cash → $OMR
  // (extraction prep) is legal only at a wash-house district or on your family's turf, and draws
  // LAUNDER_HEAT — so extraction is a located, exposed act, not a free click. B2 BANK DAILY CAP:
  // bank interest is metered by a daily token bucket like racket income (BANK_DAILY_CAP_MS/day),
  // so continuous online play can't compound ~4%/day risk-free (the audit's #1 safe-beats-risky).
  // LAUNDER_HEAT / LAUNDER_DISTRICTS are DEAD as of tokenomics v2 step 2 — cash no longer converts
  // to $OMR by any route, so there is nothing to wash and no wash house to stand in.
  LAUNDER_HEAT: 15, LAUNDER_DISTRICTS: ['docks', 'canal'], BANK_DAILY_CAP_MS: 12*3600*1000,
  // Phase 3 — a territory racket's income accrues lazily up to this bound (collected on demand),
  // so an uncollected operation can't hoard unlimited income; uncollected income is forfeited to
  // the void when the district is seized (collect before you lose the turf).
  TERRITORY_CAP_MS: 24*3600*1000,
  // RECURRING SINKS — territory upkeep: an operation owes protection + payroll = TERRITORY_UPKEEP_BPS
  // of its income (the treasury pays), accrued on its OWN clock up to TERRITORY_UPKEEP_CAP_MS (7d) —
  // distinct from the 24h income cap, so a neglected operation owes more than it earns. Unpaid past
  // TERRITORY_UPKEEP_COLD_MS (3d) it goes COLD (no income / no upgrade) until squared; seizure hands
  // the victor a fresh clock. New/tunable — sim + founder sign-off (ground rule #1).
  TERRITORY_UPKEEP_BPS: 2000, TERRITORY_UPKEEP_CAP_MS: 7*24*3600*1000, TERRITORY_UPKEEP_COLD_MS: 3*24*3600*1000,
  // STEP THREE — the BUREAU CRACKDOWN (the business-raid pattern at the gang level): a hot-type operation
  // accrues scrutiny (net of decay); past the threshold, an owner-touch (collect/upgrade) rolls a raid over
  // the minutes-above that SEIZES the pending income (never banked, never ledgered — the seize precedent) and
  // FINES the treasury TERRITORY_RAID_FINE_RATE of the operation's build cost (a §10.4 sink `territory:raid`),
  // then the heat's off (scrutiny→0). TERRITORY_RAID_P is a TEST-ONLY roll knob (the BUSINESS_RAID_P precedent).
  TERRITORY_SCRUTINY_DECAY_HR: 4, TERRITORY_SCRUTINY_CAP: 100, TERRITORY_RAID_THRESHOLD: 60,
  TERRITORY_RAID_P_PER_MIN: 0.0015, TERRITORY_RAID_FINE_RATE: 0.10,
  // STEP FOUR — the RACKET-WARS layer (between-war contestability + a treasury defense sink). All
  // numbers are founder sign-off levers. (1) FORTIFY: a boss/underboss buys a defense level from the
  // treasury (`territory:fortify` cash SINK, cost climbs with the level × the tier), capped FORT_MAX —
  // each level lowers a RIVAL raid's success (it does NOT touch the signed Bureau-crackdown math). (2)
  // RIVAL RAID: a made man of ANOTHER family muscles a held operation for a CUT of its PENDING income
  // (`territory:muscle`, a treasury FAUCET that REDIRECTS uncollected income — the business-shakedown
  // pattern: the owner keeps the rest pending, so total territory:income+muscle emission is bounded by
  // the same signed curve → §10.4-neutral). A muscle/cunning contest vs the fortitude; a landed raid
  // draws law heat + sets a per-racket cooldown (win OR lose — the owner isn't ground down); a failed
  // raid costs the raider health. TERRITORY_RIVAL_RAID_P is a TEST-ONLY roll knob (the raid precedent).
  TERRITORY_FORT_MAX: 5, TERRITORY_FORT_COST_BASE: 100000,
  TERRITORY_RIVAL_CUT_BPS: 3000, TERRITORY_RIVAL_CD_MS: 8*3600*1000, TERRITORY_RIVAL_MIN_LVL: 8,
  TERRITORY_RIVAL_BASE_P: 0.6, TERRITORY_RIVAL_FORT_DEF: 0.08, TERRITORY_RIVAL_STAT_SCALE: 200,
  TERRITORY_RIVAL_MIN_P: 0.1, TERRITORY_RIVAL_MAX_P: 0.9,
  TERRITORY_RIVAL_ENERGY: 20, TERRITORY_RIVAL_HEAT: 12, TERRITORY_RIVAL_FAIL_DMG: 15,
  // STEP FIVE — RACKET SPECIALISTS + SPECIAL OPERATIONS. A boss/underboss assigns a family made-man
  // (level ≥ SPECIALIST_MIN_LVL) to a held operation: a passive FORTITUDE bonus (their effStat /
  // SPECIALIST_FORT_DIV, so assigning your muscle matters) + SCRUTINY resistance (net growth ×
  // SPECIALIST_SCRUTINY_MULT — a made man keeps it quiet). One racket per specialist. Pure defensive/
  // risk modifiers → ZERO §10.4 (no emission, no new faucet). The special op is racket-TYPE-specific,
  // requires a specialist, on a per-racket cooldown (TERRITORY_OP_CD_MS) — all §10.4-clean: numbers
  // "Cook the Books" clears scrutiny; protection "Show of Force" +TERRITORY_OP_FORT fortitude (capped
  // at FORT_MAX — a small free defensive gift, a sign-off lever); smuggling "Ghost the Route" clears
  // scrutiny AND suppresses accrual for TERRITORY_OP_GHOST_MS. All numbers are founder sign-off levers.
  SPECIALIST_MIN_LVL: 5, SPECIALIST_FORT_DIV: 8, SPECIALIST_SCRUTINY_MULT: 0.6,
  TERRITORY_OP_CD_MS: 12*3600*1000, TERRITORY_OP_FORT: 1, TERRITORY_OP_GHOST_MS: 6*3600*1000,
  // Risk-to-Earn Phase 4 — BACKED EMISSION. STAKE_POOL_BPS of every 12h buyback's bought $OMR is
  // routed to the staking reward pool (cash sinks → buyback → yield), so staking pays from a funded
  // pool instead of minting. APY stays the CEILING (you never earn more than the target rate; a thin
  // pool only throttles it down). New/tunable — sim + founder sign-off.
  // DEAD as of tokenomics v2 step 2 (red-team A3): the 12h buyback no longer acquires any $OMR, so
  // nothing reads this. Kept declared because it is a PINNED lever (test/levers.js) and a pin
  // dangling at a deleted constant fails the register — but tuning it now does nothing at all.
  // DEAD as of tokenomics v2 step 2: the buyback no longer buys $OMR, so there is no bought $OMR
  // to slice, and individual staking yield is retired. Kept for the record, read by nothing.
  STAKE_POOL_BPS: 3000,
  // Business Empire — a personal front's income accrues lazily up to this bound (collected on
  // demand → pocket cash), so an uncollected business can't hoard unbounded income (the
  // territory-racket pattern). Private laundering at your own front draws BUSINESS_LAUNDER_HEAT,
  // LOWER than the street's LAUNDER_HEAT (your own books are safer than a public wash house) —
  // gated by the front's per-tier daily capacity, not the wash-house district. New/tunable — sim
  // + founder sign-off before production (ground rule #1).
  // BUSINESS_LAUNDER_HEAT is DEAD (v2 step 2) — private laundering at your own front went with the
  // public wash house. Fronts still earn; they no longer wash.
  BUSINESS_CAP_MS: 24*3600*1000, BUSINESS_LAUNDER_HEAT: 8,
  // RECURRING SINKS — "the pad": every front owes protection + wages proportional to its income
  // (BUSINESS_UPKEEP_BPS of incomePerHr — a ~20% recurring tax that scales with the empire).
  // Upkeep accrues on its OWN clock up to BUSINESS_UPKEEP_CAP_MS (7d) — distinct from the 24h
  // income cap, so an ABSENT owner earns ≤24h but owes ≤7d: neglect bleeds. A front unpaid past
  // BUSINESS_UPKEEP_COLD_MS (3d) goes COLD (no income / no launder / no upgrade) until the pad is
  // paid. New/tunable — sim + founder sign-off before production (ground rule #1).
  BUSINESS_UPKEEP_BPS: 2000, BUSINESS_UPKEEP_CAP_MS: 7*24*3600*1000, BUSINESS_UPKEEP_COLD_MS: 3*24*3600*1000,
  // L1b — THE PROGRESSIVE PAD (stakes/spine review #1, founder-directed): the pad rate climbs with the
  // SIZE of the empire — each front you own adds BUSINESS_UPKEEP_PROG_BPS to EVERY front's upkeep rate, so
  // a 5-front stack pays 20% + 4×5% = 40% pad (vs a 1-front's 20%). Bounds the measured passive stack
  // without touching the on-ramp (a 1-front owner is unaffected). Sim-re-measured; a sign-off lever.
  BUSINESS_UPKEEP_PROG_BPS: 500,
  // Business Empire step two — the RISK layer (passive income you must protect). SCRUTINY: only
  // LAUNDERING draws the Bureau's eyes onto a front (PER_CAP points per full day-capacity washed,
  // decaying DECAY_HR/hour) — income-only fronts never get raided; their risk is rival shakedowns.
  // RAID: past the threshold, a lazy roll per elapsed minute (the §7.1 kitchen-raid pattern) can
  // seize ALL pending uncollected income + levy a fine of FINE_RATE × the current tier's cost
  // (clamped to pocket cash). SHAKEDOWN: a rival extorts SHAKEDOWN_RATE of a front's pending
  // income in a muscle/cunning contest — per-venue cooldown, energy cost, heat either way.
  // All new/tunable — sim + founder sign-off before production (ground rule #1).
  // SIM-AUDIT RETUNE: the original 25/2hr/60 triple made raids UNREACHABLE (max accrual +25/day
  // vs decay 48/day — the risk layer was dead code). Now a full day-cap wash adds 45 while only
  // 24 decays off, so sustained max-throughput extraction crosses the threshold in ~3 days and
  // sits hot (scrutiny caps at 100); moderate washing (≤ half cap/day) still never raids.
  // DEAD as a live mechanic (v2 step 2). Business scrutiny grew ONLY from laundering, so with that
  // retired nothing writes it: no front can be Bureau-raided any more, and the whole Business
  // Empire step-two risk layer is unreachable. A front's remaining risk is PvP (shakedown, hostile
  // takeover, the Sacking). Flagged for founder sign-off in BALANCE.md — passive fronts are now
  // strictly safer than the curve was balanced against.
  BUSINESS_SCRUTINY_PER_CAP: 45, BUSINESS_SCRUTINY_DECAY_HR: 1, BUSINESS_SCRUTINY_MAX: 100,
  BUSINESS_RAID_THRESHOLD: 60, BUSINESS_RAID_P_PER_MIN: 0.0005, BUSINESS_RAID_FINE_RATE: 0.10,
  SHAKEDOWN_RATE: 0.30, SHAKEDOWN_CD_MS: 8*3600*1000, SHAKEDOWN_ENERGY: 15, SHAKEDOWN_HEAT: 10,
  // MAKE RISK PAY (sim-audit package, founder-approved direction; numbers are sign-off levers).
  // BANK_CLEAR_MS: a fresh deposit stays "in transit" for this window — a fire-kill loots
  // CASH_LOOT_RATE of in-transit deposits too, so banking is a timed act, not an instant vault.
  // UNSTAKE_CD_MS: unstaked principal UNBONDS (no yield, lootable) before it's liquid — the
  // stake → extract path always crosses an exposure window; staking itself stays instant.
  BANK_CLEAR_MS: 2*3600*1000, UNSTAKE_CD_MS: 6*3600*1000,
  // WEALTH-SCALED SAFEHOUSE: cost = max(M3.SAFEHOUSE_COST, liquid wealth × NW_BPS/10000) per stay
  // — total immunity priced as a % of what it protects (the $25k flat fee was ~0.25%/day for an
  // endgame landlord). 100 bps = 1% of cash+bank per 4h stay.
  SAFEHOUSE_NW_BPS: 100,
  // ORGANIC AMM DEPTH: each 12h buyback carves this share of the street-tax pool into PROTOCOL-
  // OWNED LIQUIDITY — cash paired with event-fund $OMR at spot, deposited into BOTH reserves
  // (a §10.4 bucket transfer, fund → amm; nothing minted, price unmoved, depth compounds with
  // real activity). Skipped (falls through to the buyback) when the fund can't match the pair.
  // DEAD as of tokenomics v2 step 2 (red-team A3) — same reason: there is no AMM to deepen.
  AMM_LP_BPS: 2500,
  // KITCHEN ON-RAMP (sim-audit): the entry-tier margin measured ~$243/cycle — the first risky
  // loop barely beat petty crime. Rank-0 dealers get the CORNER PREMIUM on gross (+50%): small
  // quantities move at street prices. Phases out automatically at trade-rank 1, so it subsidizes
  // the on-ramp without touching the sim-audited mid/endgame deal curve. Founder sign-off lever.
  KITCHEN_ONRAMP_BONUS: 0.5,
  // BALANCE.md sign-off (founder-approved recs, 2026-07-16):
  // D3 — the PUBLIC wash route gets a per-account daily token bucket (= the top business tier's
  // launderCapDay): private infra is the best extraction rail, no longer the only sane one.
  // DEAD as of tokenomics v2 step 2 (the D3 wash cap) — it capped cash → $OMR on the AMM buy side,
  // which no longer exists. The window's own EXCHANGE.DAILY_CAP_OMR is the live cap now.
  PUBLIC_WASH_CAP_DAY: 2600000,
  // D5 — bank interest TAPERS above a threshold: full rate on the first BANK_TAPER_ABOVE, then
  // BANK_TAPER_KEEP of the rate beyond — the game's only exponential now flattens at whale scale.
  // (An explicit founder override of the prototype's flat 2%/12h.)
  BANK_TAPER_ABOVE: 10000000, BANK_TAPER_KEEP: 0.10,
};
// THE GAMBLING DEN — player-vs-house games at the Neon Mile. CASH ONLY (never $OMR — the
// regulatory line), server-rolled + rng_audit'd, every stake/payout ledgered casino:* so §10.4
// reconciles per character; 1% of every stake goes to the street-tax pool (the buyback loop),
// the rest of the house edge burns. Dice = the real pass-line (edge ~1.41%, entertainment-thin);
// the Numbers pays the historically accurate 600:1 on 999:1 odds (~40% edge — a daily flutter).
// All numbers are founder sign-off levers. Design: omerta-gambling-den-design.md.
export const CASINO = {
  DISTRICT: 'neon',            // the vice district — travel there to play
  MIN_BET: 100, MAX_BET: 250000, DICE_NERVE: 1,
  NUMBERS_MIN: 10, NUMBERS_MAX: 1000, NUMBERS_PAYOUT: 600,
  // ── step two (all founder sign-off levers) ──
  // The HIGH-STAKES ROOM: past HIGH_LVL the PvE dice table takes up to HIGH_MAX per roll, and
  // pots ≥ HIGH_FEED hit the public streets feed (whale theater).
  HIGH_LVL: 30, HIGH_MAX: 2000000, HIGH_FEED: 250000,
  // BACK-ROOM DICE (PvP): consent-by-listing (a fader posts an open limit, the fadeDice pattern
  // = the bodyguard market); one symmetric 2d6 hi-roll, ties reroll; the winner takes the pot
  // minus PVP_RAKE_BPS (half the rake → street tax, half burns — the exchange pattern, scaled).
  PVP_RAKE_BPS: 500,
  // THE FIGHT (weekly bout): one bet per street per week, capped small — the cap is the fix's
  // abuse bound (a fixed fight can mint at most FIGHT_MAX × payout per bettor). Favorite wins at
  // FAV_P off the seed draw; decimal payouts carry a ~6-9% book edge. The family holding neon can
  // FIX the result once a week for FIX_COST from the treasury — a turf perk with teeth.
  FIGHT_MAX: 5000, FIGHT_FAV_P: 0.65, FIGHT_FAV_PAYS: 1.45, FIGHT_DOG_PAYS: 2.6, FIGHT_FIX_COST: 50000,
  FIGHT_BET_MIN_LVL: 5,   // SIGN-OFF (2.5): an anti-alt floor on fight bets — raises a fix-Sybil ring's cost per disposable alt (the npcHit rookie-floor / WANTED_MIN_LVL precedent)
  // RAKEBACK: owners of a casino BUSINESS split RAKEBACK_BPS of den stake volume (claimed at
  // business collect, cursor-tracked) — the Den feeds the Business Empire layer.
  RAKEBACK_BPS: 100,
  // ── step three: the TABLE GAMES (all founder sign-off levers) ──
  // BLACKJACK (stateful PvE): a real hand you play out — deal/hit/stand/double. Infinite deck
  // (independent draws), dealer stands per DEALER_MIN and hits SOFT 17 (the authentic Vegas rule
  // → the standard ~0.6% edge; a natural pays 3:2 = BJ_PAYS_BPS). Same book accounting as dice
  // (casino:bet:blackjack sink at deal, casino:win:blackjack faucet at resolve, profit-capped
  // street tip). Bets ride the shared MIN_BET/MAX_BET (+ the HIGH_LVL room).
  BJ_PAYS_BPS: 15000,          // a natural (2-card 21) pays 3:2
  BJ_DEALER_MIN: 17, BJ_HIT_SOFT_17: true,
  BJ_NERVE: 1,                 // a hand costs a nerve at deal (Madame T1 comps it, like dice)
  // HEADS-UP HOLD'EM (PvP showdown): consent-by-listing (a dealer posts a poker_limit — the fade
  // pattern); a challenger antes an equal stake, both are dealt 2 hole + 5 community, best 5-of-7
  // wins the pot minus PVP_RAKE_BPS (half → street tax, half burns — the back-room-dice mechanism,
  // §10.4-exact per character). A tie splits (each stake returned, no rake). One atomic showdown
  // (true multi-street betting needs turn-based sessions this architecture defers).
  POKER_MIN: 100,
  // THE POKER TOURNAMENT (scheduled showdown) — a CASH buy-in escrows into a pool; the worker deals
  // every live entrant an independent 7-card hand and pays the top places a share of the pool net of
  // RAKE_BPS (half → street tax / half burns). A pure competitive redistribution (no new emission —
  // the field is net-negative by the rake). One open tournament at a time; a new one opens on the
  // next entry after the last settles. `TOURNEY_MS` env is TEST-ONLY (the SEARCH_MS pattern).
  TOURNEY: { BUYIN: 5000, REGISTER_MS: 86400000, MIN_ENTRANTS: 2, RAKE_BPS: 500, PAYOUTS: [0.5, 0.3, 0.2] },
  // step five — RING POKER (omerta-deep-deferred-design.md §D): true multi-way hold'em with betting
  // streets. THE TABLE IS AN ESCROW (cash moves only at sit/leave); raises cap at the smallest live
  // stack (no side pots); everyone antes the bb (ante poker — no blind positions). The SKILL game of
  // the den. RING_TURN_MS env is TEST-ONLY (the SEARCH_MS pattern). All sign-off levers.
  RING: { BLINDS: [100, 1000, 10000], SEATS: 6, BUYIN_MIN_BB: 20, BUYIN_MAX_BB: 200,
    RAKE_BPS: 300, RAKE_CAP_BB: 10, TURN_MS: 90 * 1000, IDLE_MS: 30 * 60 * 1000, MIN_LVL: 3 },
  // step five — THE BRACKET: the multi-table elimination tournament on the EXISTING tournament
  // escrow (same reasons → the escrow identity is untouched). Rounds of heats; the top ADVANCE of
  // each heat go through; the final heat pays TOURNEY.PAYOUTS net of the same rake. Still a
  // chance-based pooled draw per heat (the den's honest note) — the skill game is the ring table.
  // BRACKET_ROUND_MS env is TEST-ONLY.
  BRACKET: { HEAT_SIZE: 6, ADVANCE: 2, ROUND_MS: 10 * 60 * 1000 },
  // ── THE TRACK: the dogs & the ponies (all founder sign-off levers) ──
  // A daily race card — greyhounds and horses. Each race draws a FIELD of runners off the §7.11
  // seed, each with a true win probability p and posted decimal odds = (1/p)×(1−EDGE), so the
  // book takes a uniform EDGE takeout on every runner (the historically accurate ~15% track vig).
  // The winner is drawn from the seed weighted by the TRUE p (the odds carry the edge, the draw
  // does not). One WIN bet per race per street per day (up to 2/day — dogs + horses), resolved
  // lazily the next day (the numbers/fight pattern), CASH ONLY, small-capped → a bounded faucet
  // that's a NET SINK in expectation (like every den game). Fixed-odds + solo-playable + always
  // available: the classic day at the track, distinct from the parimutuel poker tournament.
  // FIELD must stay ≥ 4: the per-runner house edge is guaranteed only while the top runner's p can't
  // approach the odds floor — at FIELD 6 the max p is ~0.67 (edge safe by a wide margin); a field of ≤3
  // would push the favorite's p toward the 1.1 clamp/rounding zone and the edge would need re-deriving.
  // STEP THREE — RUN IN THE CARD: a player enters a fit racer into the day's card (its kind's race),
  // taking one of the last PLAYER_SLOTS posts. Its win weight is form-derived (0.2 + (form/75)×1.8, the
  // NPC weight band), so a trained animal is the favorite. A cash ENTRY_FEE (a §10.4 sink → the buyback,
  // the pen:commissary precedent) is the nomination fee; the town bets on it via the normal card. Fixed
  // odds are LOCKED on each ticket at bet time (track_bets.odds) — a bookmaker's board that shifts as
  // runners enter, so a bettor is paid at the price they took. The worker banks the racer's win the next
  // day (status: its record + the owner legend — no owner purse in step three; that's a sim-gated option).
  TRACK: { MIN_BET: 50, MAX_BET: 10000, FIELD: 6, EDGE: 0.15, MAX_ODDS: 25, PLAYER_SLOTS: 2, ENTRY_FEE: 5000 },
  // THE FUTURITY (Track step four): a scheduled marquee race where owners NOMINATE their player-owned
  // racers and the WHOLE TOWN bets parimutuel on the field (the boxing-main-event twin — spectator
  // betting — distinct from THE STAKES, where owners buy in and compete for the pooled buy-ins). A
  // NOMINATE_FEE burns to the buyback (the track-entry precedent, non-refundable); bets ESCROW into a
  // parimutuel pool; the worker races the field (form + rand(VARIANCE)) and pays winners the losing pool
  // net of RAKE_BPS (half → buyback, half burns — the boxing vig). A card with < MIN_RUNNERS live at
  // post is scrapped (every bet refunded). All sign-off levers.
  FUTURITY: { NOMINATE_FEE: 5000, FIELD_MAX: 8, MIN_RUNNERS: 3, REGISTER_MS: 30 * 60 * 1000,
    MIN_BET: 100, MAX_BET: 25000, RAKE_BPS: 500, VARIANCE: 22 },
};
// the day's winning number, drawn from the server-secret market seed (§7.11 machinery —
// unpredictable without the seed, verifiable after the fact)
export const numbersDrawOf = (day = dayOf()) => Math.floor(hash01(`numbers:${day}:${MARKET_SEED}`) * 1000);
export const btkOf=(lvl=1,m=5,vm=1)=>Math.round((250+lvl*80+m*12)*vm);
// PACING override (founder-directed, see the PACING block below): the prototype's `/4` made levels
// far too cheap. Reads PACING.LEVEL_DIVISOR at CALL time, so the const being declared later in the
// module is fine. This line used to warn that it must be re-applied by hand after every extractor run;
// that is no longer true — since the rules split, `levelOf` lives in the HAND-WRITTEN half, which the
// extractor never opens, so a regeneration cannot clobber it. test/docs.js fails if the warning returns.
export const levelOf=(respect)=>Math.floor(Math.sqrt(Math.max(0,respect)/PACING.LEVEL_DIVISOR))+1;
export const trimOf=(id)=>TRIMS.find(t=>t.id===id)||TRIMS[1];
export const carOf=(id)=>CARS.find(c=>c.id===id);
export const drugOf=(id)=>DRUGS.find(d=>d.id===id);
export const kitchenOf=(id)=>KITCHENS.find(k=>k.id===id);
export const assetOf=(id)=>ASSETS.find(a=>a.id===id);
export const gearOf=(id)=>MARKET.find(m=>m.id===id);
export const tradeRankIdx=(rep)=>{let i=0;TRADE_RANKS.forEach((r,j)=>{if((rep||0)>=r.at)i=j;});return i;};
export const rankIdxOf=(lvl)=>{let i=0;RANKS.forEach((r,j)=>{if(lvl>=r.lvl)i=j;});return i;};
export const cityEventOf=(day)=>CITY_EVENTS[((day%CITY_EVENTS.length)+CITY_EVENTS.length)%CITY_EVENTS.length];
export const dayOf=(t=Date.now())=>Math.floor(t/86400000);

// ── §7.11 deterministic markets — FNV-1a hash, ported byte-for-byte from v24 ──
// SEED is a per-season server secret so future price blocks can't be precomputed.
// GET /market/prices returns the current block's numbers; the client never hashes.
export const MARKET_SEED = process.env.MARKET_SEED || 'omerta-server-seed';
export const hash01=(s)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return ((h>>>0)%1000)/1000;};
export const priceBlock=(t=Date.now())=>Math.floor(t/(4*3600*1000));
// THE LIVING WORLD P3 — each district's daily supply SHOCK (regionShockOf, mean-neutral, defined in
// the tail) folds into the deterministic price so every reader (the prices board, buy/sell, convoy
// value) sees ONE consistent shocked surface. Keyed on the block's day (6 four-hour blocks/day).
export const goodPriceOf=(goodId,districtId,blk=priceBlock())=>{const g=GOODS.find(x=>x.id===goodId);if(!g)return 0;const shock=regionShockOf(districtId,Math.floor(blk/6));return Math.max(10,Math.round(g.base*(0.6+hash01(goodId+':'+districtId+':'+blk+':'+MARKET_SEED))*shock));};
export const demandOf=(drugId,districtId,blk=priceBlock())=>0.7+hash01(drugId+'@'+districtId+':'+blk+':'+MARKET_SEED)*0.8;
export const makingsPriceOf=(drugId,blk=priceBlock())=>Math.max(5,Math.round((drugOf(drugId)?.mk||0)*(0.75+hash01('mk:'+drugId+':'+blk+':'+MARKET_SEED)*0.5)));

// ── car value & melt yield (operate on a DB car row: {model_id, trim_id, dmg}) ──
export const carVal=(modelId,trimId)=>Math.floor((carOf(modelId)?.val||0)*trimOf(trimId).val);
export const carMelt=(modelId,trimId,dmg=0)=>Math.max(5,Math.round((carOf(modelId)?.melt||0)*trimOf(trimId).melt*(1-(dmg||0)/150)));
export const rollByWeight=(rows)=>{const total=rows.reduce((a,r)=>a+r.w,0);let r=Math.random()*total;for(const row of rows){r-=row.w;if(r<=0)return row;}return rows[rows.length-1];};
export const rollCar=()=>rollByWeight(CARS);
export const rollTrim=()=>rollByWeight(TRIMS);

// ── asset & gear aggregates (take arrays of owned ids) ──
export const assetIncome=(ids=[])=>ids.reduce((a,id)=>a+(assetOf(id)?.income||0),0);
export const assetEnergyCap=(ids=[])=>ids.reduce((a,id)=>a+(assetOf(id)?.energyCap||0),0);
export const assetStat=(ids=[],st)=>ids.reduce((a,id)=>{const it=assetOf(id);return a+(it?.stat===st?it.boost:0);},0);
export const assetsValue=(ids=[])=>ids.reduce((a,id)=>a+(assetOf(id)?.price||0),0);
export const gearStat=(ids=[],st)=>ids.reduce((a,id)=>{const g=gearOf(id);return a+(g?.stat===st?g.boost:0);},0);
export const cargoCapacity=(ids=[])=>10+ids.reduce((a,id)=>a+(assetOf(id)?.cargo||0),0);
// effective stat = base + owned gear boosts + owned asset boosts (spec §6)
export const effStat=(base,st,assetIds=[],gearIds=[])=>base+gearStat(gearIds,st)+assetStat(assetIds,st);

// Roll a UNIQUE starting/re-rolled build: each stat floors at CREATE_STAT_MIN, and the surplus
// (CREATE_STAT_TOTAL − 3×min) is scattered one point at a time across the three stats. The TOTAL
// is fixed, so every character carries the same power budget — only the SHAPE varies (a muscle
// spike costs speed) → no power creep, the sim-audited stat economy is untouched. Server-side +
// rng_audit'd at the call site. Accepts an injectable rng (defaults Math.random) for testability.
export function rollStats(rng = Math.random) {
  const min = CONSTANTS.CREATE_STAT_MIN;
  const stats = { muscle: min, cunning: min, speed: min };
  const keys = ['muscle', 'cunning', 'speed'];
  let surplus = CONSTANTS.CREATE_STAT_TOTAL - min * keys.length;
  while (surplus-- > 0) stats[keys[Math.floor(rng() * keys.length)]] += 1;
  return stats;
}

// ── M3 helpers (§7.6–7.9, §5.5) ──
export const gunObjOf=(id)=>GUNS.find(g=>g.id===id)||null;
export const vestMultOf=(id)=>VESTS.find(v=>v.id===id)?.mult||1;
// fleet value from actual cars rows [{model_id,trim_id,dmg}] — the whack chop base (§7.7)
export const fleetValue=(cars=[])=>cars.reduce((a,c)=>a+Math.floor(carVal(c.model_id,c.trim_id)*(1-(c.dmg||0)/100)),0);
export const gangLevelOf=(treasury)=>Math.min(5,Math.floor(Number(treasury||0)/50000));
export const roleMultOf=(role)=>role==='boss'||role==='underboss'?1.10:role==='capo'?1.05:1;
export const weekOf=(day=dayOf())=>Math.floor(day/7);
export const familyTaskOf=(wk=weekOf())=>FAMILY_TASKS[((wk%FAMILY_TASKS.length)+FAMILY_TASKS.length)%FAMILY_TASKS.length];
// ── M4 helpers (§7.10, §5.1, §7.13) ──
export const gunsValue=(ids=[])=>ids.reduce((a,id)=>a+(GUNS.find(g=>g.id===id)?.cash||0),0);
export const racketsValue=(ids=[])=>ids.reduce((a,id)=>a+(RACKETS.find(r=>r.id===id)?.cost||0),0);
export const dailyJobsOf=(day=dayOf())=>[0,1,2].map(i=>DAILY_POOL[(day+i*2)%DAILY_POOL.length]);
export const M4 = {
  CREW_MAX: 5, CREW_COST_STEP: 50000,          // $50k × (crew+1)
  // D6a step two — THE PLAY (the corner's decision axis). Dealing was the third shallow entry verb:
  // pick a line, pick a qty, collect. Now you choose HOW you move it — and the axis is deliberately
  // NOT price, because the deal cash curve is sim-audited (§7.10) and ground rule #1 stands: the
  // CASH PAID IS IDENTICAL on every play. What you trade is THROUGHPUT against THE LAW.
  //   • careful  — work your regulars: half the heat, but it takes patience (double nerve, the real
  //                throttle on the corner) and it builds a book of business (+10% trade rep).
  //   • standard — hit the corner: the signed baseline (all 1.0 → byte-identical to before).
  //   • flood    — move weight fast: half the nerve (double the throughput per bar) but DOUBLE the
  //                heat (feeding the RICO meter + the Bureau's kitchen raid), and churn burns your
  //                name (−10% trade rep, so the fast play never accelerates rank progression).
  // §10.4: ZERO cash change, zero new reason, zero faucet — heat/nerve are resources, trade_rep is a
  // progression axis. All numbers are founder sign-off levers.
  DEAL_PLAYS: {
    careful:  { id: 'careful',  name: 'Work the Regulars', heatMult: 0.5, nerveMult: 2.0, repMult: 1.10 },
    standard: { id: 'standard', name: 'Hit the Corner',    heatMult: 1.0, nerveMult: 1.0, repMult: 1.00 },
    flood:    { id: 'flood',    name: 'Move Weight',       heatMult: 2.0, nerveMult: 0.5, repMult: 0.90 },
  },
  // RECURRING SINKS — crew wages ("the nut"): each corner man draws CREW_WAGE_PER_HR whether the
  // stash moves or not (you pay them to stand the corner). Wages accrue on their own clock up to
  // CREW_WAGE_CAP_MS (7d); unpaid past CREW_WAGE_COLD_MS (3d) the crew DOWNS TOOLS (accrual stops
  // their offline sales) until the nut is paid. New/tunable — sim + founder sign-off (ground rule #1).
  CREW_WAGE_PER_HR: 1200, CREW_WAGE_CAP_MS: 7*24*3600*1000, CREW_WAGE_COLD_MS: 3*24*3600*1000,
  LAYLOW_CASH: 5000, LAYLOW_ENERGY: 25, LAYLOW_COOL: 25,
  CLEANPAPERS_OMR: 10,
  HEIST_CD_MS: 8*3600*1000,
  BATCH_CRATE_UNITS: 20,                        // 1 📦 per 20 units cooked
  DAILY_ALL_OMR: 0.5,                           // all-three bonus from the event fund
  REF_RECRUITER_CASH: 10000, REF_RECRUIT_CASH: 5000,
  REF_FUND_OMR: 4, REF_RECRUITER_OMR: 3, REF_RECRUIT_OMR: 1,  // fund ≥4 → 3 + 1 split (v24)
  REF_GATES: { level: 8, jobs: 40, checkins: 3, netWorth: 25000 },
  // STEPPED PAYOUT — "the spark": a small, EARLY cash payout the moment a recruit shows real early
  // engagement (level 3 + 10 jobs), so the referrer gets fast feedback long before the full
  // qualification (L8/40 jobs/3 check-ins/$25k). Cash only (never $OMR — that stays on the full
  // gate), agent-excluded, ONCE ever. Still requires real playtime, not raw signup → Sybil-bounded.
  REF_SPARK: { level: 3, jobs: 10, recruiterCash: 2500, recruitCash: 1500 },
  // TIER-2 ("the family tree", §7.13 addendum): when a recruit YOU brought in then brings in their
  // OWN qualified recruit, you earn a BOUNDED, ONE-TIME finder's fee. Deliberately a flat one-shot —
  // NOT an ongoing percentage of the grandrecruit's earnings — so it's a referral bonus, not a
  // revenue-share pyramid (the anti-MLM line). CASH ONLY, capped at depth 2 (no third level), agents
  // excluded at every level. Sensitive design: recorded as counsel-gated; founder green-lit.
  REF_TIER2_CASH: 5000,
  // Time-boxed RECRUITMENT DRIVE ("the push"): a mod starts a window during which every referral
  // CASH payout (spark + full + milestone + tier-2) is multiplied. $OMR is untouched (fund-bounded).
  // Bounded by real qualified recruits (each needs real playtime) → Sybil-bounded like the base loop.
  REF_PUSH_MAX_MULT: 5, REF_PUSH_MAX_HOURS: 336,
};
// crew wages ("the nut"): owed = crew × CREW_WAGE_PER_HR × elapsed-since-crew_paid_at (capped),
// and the crew goes COLD (accrual stops their sales) once the nut is unpaid past the cold window.
export const crewWageOwed = (ch, now = Date.now()) => {
  const crew = Number(ch.crew || 0);
  if (crew <= 0 || !ch.crew_paid_at) return 0; // no crew, or the clock was never started (hire stamps it)
  const elapsed = Math.min(now - new Date(ch.crew_paid_at).getTime(), M4.CREW_WAGE_CAP_MS);
  return Math.floor(crew * M4.CREW_WAGE_PER_HR * Math.max(0, elapsed) / 3600000);
};
export const crewCold = (ch, now = Date.now()) =>
  Number(ch.crew || 0) > 0 && !!ch.crew_paid_at && now - new Date(ch.crew_paid_at).getTime() >= M4.CREW_WAGE_COLD_MS;

// ═══ THE KITCHEN → Tier 4 (omerta-tier2-deepening-design.md) ═══
// Orthogonal depth on the M4 drug loop: LAB MODULES (a purity/yield/stealth upgrade axis, cash+$OMR
// sinks), CUTTING AGENTS (stretch a stash line — more units at a quality cost, the risk lever), and
// THE KINGPIN LEGEND (account-level lifetime product moved, survives death → a status ladder + board).
export const KITCHEN = {
  // LAB MODULES — three leveled upgrades layered on the lab tier (each capped, cost climbs with level
  // AND the lab tier; the top levels burn $OMR — the lab-ladder precedent). Fold into ONE touchpoint
  // each: purity→cook quality, yield→batch cap, stealth→the accrual Bureau-raid probability.
  MODULES: {
    purity:  { name: 'Purity Rig',     step: 0.03, desc: 'Cleaner product — +3% cook quality per level.' },
    yield:   { name: 'Yield Manifold', step: 0.15, desc: 'Bigger batches — +15% cook cap per level.' },
    stealth: { name: 'Ghost Vents',    step: 0.14, desc: 'Quieter cook — −14% offline raid odds per level.' },
  },
  MODULE_MAX: 5,
  MODULE_BASE_CASH: 60000,   // cash = BASE_CASH × (curLevel+1) × (labIdx+1)
  MODULE_OMR_FROM: 3,        // module levels whose RESULT ≥ this also burn $OMR
  MODULE_OMR_STEP: 4,        // omr = (resultLevel − MODULE_OMR_FROM + 1) × MODULE_OMR_STEP
  // CUTTING AGENTS — stretch a stash line: +CUT_UNITS of its own qty at −CUT_QUALITY, floored at
  // CUT_FLOOR (over-cut is near worthless — the deal price scales on quality). A cash sink.
  CUT_COST: 8000, CUT_UNITS: 0.4, CUT_QUALITY: 0.15, CUT_FLOOR: 0.55,
  // THE KINGPIN LEGEND — lifetime GROSS product moved (deal + offline crew sales), account-level,
  // survives death (the boxing-wins/wheel precedent). Pure STATUS, outside §10.4.
  KINGPIN_RANKS: [
    { at: 0,         name: 'Nobody' },
    { at: 250000,    name: 'Corner Fixture' },
    { at: 2000000,   name: 'Block Captain' },
    { at: 15000000,  name: 'The Connect' },
    { at: 80000000,  name: 'Cartel Boss' },
    { at: 400000000, name: 'The Kingpin of the City' },
  ],
};
export const kingpinRankOf = (moved = 0) => {
  const m = Number(moved) || 0;
  return [...KITCHEN.KINGPIN_RANKS].reverse().find((r) => m >= r.at) || KITCHEN.KINGPIN_RANKS[0];
};

// ═══ ASSETS & RACKETS → Tier 4 (omerta-tier2-deepening-design.md §2) ═══
// The buy-once/drip-forever personal-income layer gets: RACKET UPGRADES (a per-racket level that
// multiplies its accrual income — the management axis; a cash sink), THE TYCOON LEGEND (account-level
// lifetime racket+front income, survives death → a ladder + board), and EMPIRE SETS (own a full
// category → a pure-STATUS title; the completion meta). §10.4: `racket:upgrade` is a cash sink;
// tycoon/sets are status axes outside the ledger.
export const RACKET_EMPIRE = {
  UP_MAX: 5, UP_STEP: 0.12,       // +12% income/level, capped at 5 → +60% on that racket's drip
  UP_COST_MULT: 0.5,             // an upgrade to level L costs racket.cost × UP_COST_MULT × L
  // THE TYCOON LEGEND — lifetime racket + front income earned (account-level, survives death).
  TYCOON_RANKS: [
    { at: 0,          name: 'Hustler' },
    { at: 500000,     name: 'Operator' },
    { at: 5000000,    name: 'Businessman' },
    { at: 40000000,   name: 'Magnate' },
    { at: 250000000,  name: 'Tycoon' },
    { at: 1000000000, name: 'The Invisible Hand' },
  ],
  // EMPIRE SETS — own every member of a category for a pure-status title (the completion meta).
  SETS: [
    { id: 'rackets',  name: 'The Racket King', kind: 'rackets' },
    { id: 'fronts',   name: 'The Legit Baron', kind: 'asset', cat: 'Legit Fronts' },
    { id: 'property', name: 'The Landlord',    kind: 'asset', cat: 'Property' },
    { id: 'wheels',   name: 'The Collector',   kind: 'asset', cat: 'Wheels' },
  ],
};
export const tycoonRankOf = (earned = 0) => {
  const e = Number(earned) || 0;
  return [...RACKET_EMPIRE.TYCOON_RANKS].reverse().find((r) => e >= r.at) || RACKET_EMPIRE.TYCOON_RANKS[0];
};
export const racketUpgradeCost = (racketId, curLevel) => {
  const r = RACKETS.find((x) => x.id === racketId);
  return r ? Math.floor(r.cost * RACKET_EMPIRE.UP_COST_MULT * (curLevel + 1)) : 0;
};
// the leveled per-minute income of a single racket (the accrual multiplier)
export const racketIncomeLeveled = (racketId, level = 0) => {
  const r = RACKETS.find((x) => x.id === racketId);
  return r ? (r.income || 0) * (1 + Math.max(0, Number(level) || 0) * RACKET_EMPIRE.UP_STEP) : 0;
};
// the earned EMPIRE-SET titles for a holding (pure status — completion meta)
export const empireTitles = (rackets = [], assets = []) => {
  const owned = new Set(assets);
  return RACKET_EMPIRE.SETS.filter((set) => {
    if (set.kind === 'rackets') return RACKETS.every((r) => rackets.includes(r.id));
    return ASSETS.filter((a) => a.cat === set.cat).every((a) => owned.has(a.id));
  }).map((set) => set.name);
};
export const labModuleCost = (modId, curLevel, labIdx) => {
  const cash = KITCHEN.MODULE_BASE_CASH * (curLevel + 1) * (Math.max(0, labIdx) + 1);
  const result = curLevel + 1;
  const omr = result >= KITCHEN.MODULE_OMR_FROM ? (result - KITCHEN.MODULE_OMR_FROM + 1) * KITCHEN.MODULE_OMR_STEP : 0;
  return { cash, omr };
};
export const M3 = {
  GANG_FOUND_COST: 25000, GANG_FOUND_LEVEL: 5, GANG_MAX_MEMBERS: 20, TRIBUTE_MIN: 100,
  WAR_COST: 10000, WAR_MS: 30*60*1000, WAR_SPOILS: 0.20,      // §5.5 (30 min pending design call, spec §9)
  SEIZE_BASE: 30000, SEIZE_OUTBID: 1.5,
  JUMP_ENERGY: 25, JUMP_AMMO: 5, JUMP_MIN_HEALTH: 20, JUMP_HOSP_MS: 3*60*1000, JUMP_STEAL_CAP: 25000,
  FIRE_ENERGY: 40, KILL_HOSP_MS: 5*60*1000, CHOP_RATE: 0.40,
  BOUNTY_MIN: 500, BUST_FAIL_JAIL_S: 180,
  BOUNTY_DEFAULT_TTL_H: 72, BOUNTY_MAX_TTL_H: 168, // contract board: default 3d, max 7d
  // sim-audit F1 (directed squatting): exclusivity is a PREMIUM product — a directed pot takes a
  // real stake (DIRECTED_MIN, 20× the open-pot minimum) and the window caps at DIRECTED_MAX_H
  // (was the full 7-day TTL). Combined with kill-pays-any-killer (claimBounty), a $500 friendly
  // squat on your own head is dead: it now takes $10k+ and FUNDS whoever actually lands the kill.
  DIRECTED_MIN: 10000, DIRECTED_MAX_H: 24,
  // sim-audit F5 (seizure snowball): taking a district WITH a productive operation costs a war
  // premium scaled to what's being taken — TERRITORY_SEIZE_BPS of the operation's cumulative
  // build cost (seizing a maxed racket is no longer ~18× cheaper than building one).
  TERRITORY_SEIZE_BPS: 5000,
  WEEKLY_STANDING: 15000, WEEKLY_OMR: 5,
  // M7 Phase 2 assassin rep (a STATUS ladder — no gameplay power, so it doesn't touch
  // sim-audited balance): a kill earns vicLvl × REP_PER_LVL feared-rep, only from targets at
  // or above MIN_TARGET_LVL, diminished 1/(priorBloodlineKills+1). Directed-contract kills add
  // a BONUS multiplier. Numbers are cosmetic-tunable (no economy effect).
  HITMAN_MIN_TARGET_LVL: 5, HITMAN_REP_PER_LVL: 3, HITMAN_DIRECTED_BONUS: 1.5,
  // M7 Phase 3 NPC-hitmen (a paid, rolled cash SINK — new numbers, tunable, need sim sign-off
  // before production). Success = tier.base − targetLvl×NPC_DEF_PER_LVL, clamped [MIN,MAX]:
  // paying more buys a better base, a higher-level mark defends it down — so the weak can buy a
  // CHANCE at the strong, never a certainty. Fee burns win or lose; heat + a cooldown throttle it.
  NPC_HIT_HEAT: 25, NPC_HIT_CD_MS: 6 * 3600 * 1000, NPC_MIN_TARGET_LVL: 5,
  NPC_HIT_TARGET_CD_MS: 24 * 3600 * 1000, // D4: per (payer, target) — no repeat-resetting one rival

  // NPC_MAX_SUCCESS is headroom for future high-base tiers (today's top base 0.55 < 0.60, so the
  // floor is the clamp that bites); NPC_MIN_SUCCESS keeps even a whale at a small standing risk.
  NPC_DEF_PER_LVL: 0.005, NPC_MAX_SUCCESS: 0.60, NPC_MIN_SUCCESS: 0.02,
  // M7 Phase 4 — earnable defense + PvP interlocks (new/tunable numbers, sim + sign-off before
  // production). SAFEHOUSE: pay cash to go to ground → untargetable by fire/NPC-hit for a window
  // (the in-game shield, so real-ETH respawn isn't the only survival). FIRE_HEAT: a hit draws law
  // heat like a deal. WAR_KILL_POINTS: a kill on a family at war scores war points (the lethal
  // layer finally feeds war resolution, not just jumps).
  SAFEHOUSE_COST: 25000, SAFEHOUSE_MS: 4 * 3600 * 1000, FIRE_HEAT: 20, WAR_KILL_POINTS: 3,
  // M7 Phase 4 remainder (new/tunable, sim + sign-off before production). BODYGUARD: a guard
  // lists a price; a principal hires them for a window — the guard absorbs ONE lethal hit
  // (hospitalized in the principal's place, contract consumed). Checked BEFORE real-ETH revive
  // insurance: the earnable shield burns first.
  // Risk-to-Earn Phase 1 P1.3 — the bodyguard was a tenth the price of a safehouse for comparable
  // cover, so cheap defense cancelled the kill economy. Repriced toward safehouse parity, and the
  // guard's absorbed-hit cost (their hospital stay) raised so bullet-catching is a real risk.
  BODYGUARD_MIN_PRICE: 10000, BODYGUARD_MS: 24 * 3600 * 1000, BODYGUARD_HOSP_MS: 4 * 3600 * 1000,
  // Risk-to-Earn Phase 1 P1.1 — LOOT THE LIVING (new/tunable, sim + sign-off). On a PLAYER fire-kill
  // the killer takes CASH_LOOT_RATE of the victim's POCKET cash (bank untouched) and OMR_LOOT_RATE of
  // their LIQUID (unstaked) $OMR (staked untouched) — both TRANSFERS (whack:loot), the rest still
  // burns/survives. Makes killing +EV, the rich into targets, and staking a real safe harbour.
  // OMR_LOOT_RATE is the dial: set to 0 to ship a cash-only version first.
  CASH_LOOT_RATE: 0.25, OMR_LOOT_RATE: 0.20,
  // LOOT_MIN_LVL (SIGN-OFF 2.3): a fire-kill only LOOTS a mark at/above this level. Below it the kill
  // still runs the full estate (death is death) — it just pays no cash/$OMR/gear/contraband, closing
  // the "funnel value through disposable low-level alts onto one main" concentration rail. Nothing is
  // minted either way, so this is a fairness floor, not a §10.4 fix; the whale-hunting economics D1
  // signed are untouched (a real mark is far past level 10). The WANTED_MIN_LVL / npcHit-rookie /
  // legend-floor posture, applied to the one loot surface that lacked it.
  LOOT_MIN_LVL: 10,
  // Phase 3 remainder — GEAR LOOT: on a player fire-kill, a chance to strip ONE piece of the
  // victim's IN-GAME gear to the killer. On-chain-minted gear (minted_onchain) is SAFE — it's been
  // extracted to the player's own ERC-1155, out of the game's reach — so gear is a real risk
  // tradeoff: keep it in-game to use it (losable) or extract it on-chain (safe + tradeable, but
  // it leaves play). New/tunable — sim + sign-off.
  GEAR_LOOT_CHANCE: 0.15,
  // L2a — THE DEATH DUTY (stakes/spine review #2, founder-directed): the account-level wealth survives
  // death, so dying cost the established dynasty almost nothing. A succession tax burns DEATH_DUTY_RATE of
  // the heir's inherited LIQUID $OMR (staked $OMR, the RWA portfolio, the estate — all safe harbours — are
  // untouched, keeping the "put your money to work / go legit" pitch intact) so death finally costs the
  // bloodline its extractable hoard. A §10.4 $OMR BURN (`death:duty`); applies to EVERY death (a respawn-
  // token save skips the estate → no duty). Sign-off lever (0 disables).
  DEATH_DUTY_RATE: 0.25,
  // L3b — THE SHIELD CAP (stakes/spine review). The earned safehouse is capped at SAFEHOUSE_DAILY_CAP_MS
  // of off-grid time per rolling day (a token bucket, the wash-cap twin) — you can shelter to weather a
  // specific contract, but you can't live permanently unreachable. Closes the "eight untouchable states"
  // gap: the rich must surface. Founder sign-off lever (tune the cap; 0 to disable = uncapped as before).
  SAFEHOUSE_DAILY_CAP_MS: 12 * 3600 * 1000,
  // L3c — THE CONTRACT'S BULLETS (stakes/spine review). Ammo is the −EV driver on a kill; when a kill
  // fulfils a PAID contract (any pool/directed/family/WANTED bounty), the contract covers CONTRACT_AMMO_REBATE
  // of the rounds spent (a bounded ammo faucet `contract:rebate`) — so the pot doesn't have to carry the
  // whole loss and a smaller contract turns a hit +EV. Only on a contracted kill; a standalone kill pays no
  // rebate (the standalone −EV stays). Founder sign-off lever (0 to disable).
  CONTRACT_AMMO_REBATE: 0.5,
  // L3a — THE SACKING (stakes/spine review, the keystone lever). On a PLAYER fire-kill the killer SEIZES
  // one of the victim's business fronts (the endgame passive-income engine) instead of it dying with the
  // street — making the passive empire genuine PvP RISK CAPITAL and giving the kill a prize worth the ammo.
  // A pure OWNERSHIP move (a front is NOT a §10.4 currency; the territory-seize precedent), gated so the
  // killer can only HOLD a front they could run (level + an empty kind slot). Set false to disable.
  // Founder sign-off lever (new/tunable — sim the concentration effect before production).
  SACK_ON_KILL: true,
  // COACH_FAMILY_BAND_LVL (progression harness F1) — the "join a family" coach rung is a HIGH-priority
  // nudge only inside the early band (lvl 3..this). Past it the player has plainly decided to run solo,
  // and the rung drops to the recurring tail of the ladder. Above the band it must NOT sit over the
  // one-time milestone rungs: a rung a player can decline forever masks every rung below it forever
  // (the harness pinned a 7-day solo player on it, hiding the earner/skills/Kitchen/legit/energy rungs).
  COACH_FAMILY_BAND_LVL: 12,
  // D6a — THE APPROACH (stakes/spine review #6: deepen the core crime verb). Every job now takes a
  // risk/reward CHOICE — Case It (quiet), Standard, or Go Loud — a real per-job decision instead of a
  // single click + RNG. The design constraint: the CASH faucet stays EV-NEUTRAL by construction
  // (payMult = ~1/successMult), so the signed §7.2 crime cash curve is UNTOUCHED (the sim measures
  // 'standard'; the default/omitted approach IS standard, byte-identical to the old behaviour). The
  // choice is real because the SECONDARY axes shift: LOUD trades success for a bigger single score +
  // more contraband/makings + rep, but draws LAW HEAT and a harsher bust; QUIET is the safe, low-heat,
  // soft-bust play when you're near a RICO indictment or can't afford lockup. successMult is clamped to
  // the same 0.97 ceiling, so quiet's edge tapers for a maxed street (it's a caution tool, not free EV).
  // Materials (cb/makings) + rep + heat shifts are founder SIGN-OFF LEVERS (sim before production);
  // CRIME_LOUD_CASH_PREMIUM (default 1.0 = EV-neutral) is the dial if loud should pay a real cash premium.
  CRIME_APPROACHES: {
    quiet:    { id: 'quiet',    name: 'Case It',  successMult: 1.12, payMult: 0.89, crateMult: 0.5, makingsMult: 0.5, repMult: 1.0,  heat: 0,  jailMult: 0.8 },
    standard: { id: 'standard', name: 'Standard', successMult: 1.0,  payMult: 1.0,  crateMult: 1.0, makingsMult: 1.0, repMult: 1.0,  heat: 0,  jailMult: 1.0 },
    loud:     { id: 'loud',     name: 'Go Loud',  successMult: 0.82, payMult: 1.22, crateMult: 1.6, makingsMult: 1.5, repMult: 1.15, heat: 6,  jailMult: 1.4 },
  },
  CRIME_LOUD_CASH_PREMIUM: 1.0, // multiplies loud's payMult; >1 makes Go Loud pay a genuine cash premium (a faucet change → sign-off)
  // D6a step two — THE MESSAGE (the jump's decision axis). A mugging is the game's second entry verb and
  // was one click + a stat roll. Now you choose WHAT YOU CAME FOR: money or reputation. Deliberately NOT a
  // copy of the crime picker — each shallow verb gets its own thematic axis.
  //   • rob      — you're there for the wallet: a bigger cut, but nobody's impressed (less rep, less damage,
  //                and they're back on their feet sooner, so a shorter hospital shield on your mark).
  //   • standard — the signed baseline (all 1.0 → byte-identical to the pre-choice behaviour).
  //   • message  — you're there to be SEEN: big rep + a real beating, but you're not there to rob them
  //                (a fraction of the cash), it draws LAW HEAT, and the longer hospital stay shields the
  //                mark from you too (the hospital is protection in this game) — a self-limiting flex.
  // energyMult (red-team): `message` scales rep AND the hospital blanket by 1.5, which is rate-neutral
  // against ONE repeatedly-jumped mark — but ENERGY, not the mark's hospital clock, is the real binding
  // constraint across MANY marks, so a flat energy price made it a straight 1.5× rep-per-energy lever AND
  // a 1.5×-better "jump an ally to shield them" play. Charging 1.5× energy restores neutrality on BOTH
  // axes at once: the intent now buys CONCENTRATION (one big statement instead of two small ones) plus
  // damage, paid for in law heat — never a free multiplier.
  // §10.4: the steal is a pure TRANSFER (jump:steal/jump:stolen, still bounded by JUMP_STEAL_CAP), so
  // scaling it moves who holds the cash and NEVER creates any — zero faucet, zero new reason. Rep is a
  // status axis; damage/hospital/energy is pacing; heat is a Law lever. All founder sign-off levers.
  JUMP_INTENTS: {
    rob:      { id: 'rob',      name: 'Roll Them',      stealMult: 1.35, repMult: 0.6, dmgMult: 0.7, hospMult: 0.7, heat: 0, energyMult: 1.0 },
    standard: { id: 'standard', name: 'Jump Them',      stealMult: 1.0,  repMult: 1.0, dmgMult: 1.0, hospMult: 1.0, heat: 0, energyMult: 1.0 },
    message:  { id: 'message',  name: 'Send a Message', stealMult: 0.4,  repMult: 1.5, dmgMult: 1.4, hospMult: 1.5, heat: 5, energyMult: 1.5 },
  },
};
// ── THE PACING BLOCK (founder-directed 2026-07-24, from live alpha) ────────────────────────────
// An alpha tester reached LEVEL 240 in a couple of hours. The diagnosis (measured, not guessed):
//
//   1. `train` had NO cooldown and NO cash cost — 10 energy against a 40/min regen = ~240 sessions
//      an hour, so every mission STAT gate (muscle/cunning/speed up to 155) fell in one sitting.
//   2. MISSIONS had no cooldown either, and the ladder SELF-UNLOCKS: from ~m6 on, each mission's
//      respect reward overshoots the NEXT mission's level gate by 30–100 levels, so once the stats
//      were up all 28 could be claimed back-to-back.
//   3. The ladder pays **239,200 respect** end to end, and `levelOf` needed only 228,484 for L240.
//      The mission chain alone WAS levels 1→245; the rest of the game never entered into it.
//
// For scale: the best sustained crime grind is ~3,257 respect/hr, so the ladder handed over
// roughly three days of hard grinding in one uninterrupted sitting.
//
// Every dial the fix uses lives here so the whole pacing curve is one block to tune. NOTE:
// `levelOf` lives in the AUTO-GENERATED section and now reads LEVEL_DIVISOR from here — this is a
// deliberate founder override of the prototype's `/4` (the D5 bank-taper precedent). A future
// `tools/extract-rules.js` run must re-apply that one-line reference.
export const PACING = {
  // (1) THE LEVEL CURVE. respect(L) = LEVEL_DIVISOR × (L−1)². The prototype's 4 made levels far too
  // cheap at the top (L240 = 228k respect ≈ 70h of grinding even before the mission ladder short-cut
  // it). 10 costs 2.5× more respect at every level — the same shape, stretched.
  LEVEL_DIVISOR: 10,

  // (2) THE MASTER CLOCK — regen. This is the real "cooldown on activities": at 40 energy/min a
  // 50-point tank refilled in ~75 seconds, so energy never actually paced anything. Cutting energy
  // to 12/min and nerve to 6/min makes a tank a ~15-20 minute affair — you play in bursts and come
  // back, which is the genre's whole rhythm. Health is untouched (the Doc is a cash sink, not a gate).
  ENERGY_REGEN_PER_MIN: 12,
  ENERGY_REGEN_RANK_BONUS: 4,   // Runner+ bump (was +20 on top of 40)
  NERVE_REGEN_PER_MIN: 6,

  // (3) MISSIONS are a STORY LADDER, not the levelling curve. A cooldown between claims stops the
  // whole chain being cascaded in one sitting (28 × 4h ≈ 5 days minimum to walk it), and the respect
  // rewards are scaled to 25% so finishing the ladder is a meaningful boost — worth roughly a level
  // 70-80 character — instead of the entire game. Cash/$OMR/title rewards are UNTOUCHED: the story
  // still pays, it just stops being the fastest way to a number.
  MISSION_CD_MS: 4 * 3600 * 1000,
  MISSION_RESPECT_MULT: 0.25,

  // (4) THE GYM. A per-session cooldown on top of the energy cost, so stat gates take days rather
  // than an afternoon. 3 min → ~20 sessions/hr; the ~500 sessions the top mission tier demands is
  // now a ~25-hour investment spread over real days instead of one sitting.
  TRAIN_CD_MS: 3 * 60 * 1000,
};

// M8 — the TAILOR & ENGRAVER (the vanity/identity shop). Pure STATUS purchases: every item is
// display-only — no stat, no formula, no gameplay power — so nothing here touches the sim-audited
// balance or §10.4 value flows beyond its own enumerated $OMR burn ('vanity:*'). These are the
// RECURRING utility sinks the token economy was missing (the framing rule holds: utility only).
// Prices are new/tunable — sim + founder sign-off before production.
export const VANITY = {
  NAME_CHANGE_OMR: 5,   // a new street name (living-name uniqueness still enforced; your referral code follows it)
  TITLE_OMR: 10,        // a custom title — the same display slot mission titles use; clearing it is free
  PLATE_OMR: 2,         // a vanity plate for one car in the garage
  GANG_COLOR_OMR: 10,   // the family crest color (boss only)
  GANG_RENAME_OMR: 25,  // family rename/retag (boss only; founding-rules validation + uniqueness)
  TITLE_MAX: 24, PLATE_MAX: 8,
};
// M8 second drop — sinks tied to the game's loops (not pure vanity, so each carries a note on
// what it buys). ANON: posting a contract with your name off the board is INFORMATION hiding,
// not power — the mark still sees the pot, the hit works the same. PEEK: the counter to anon —
// the mark pays to read every funder on their own head (anonymity is purchasable, so is piercing
// it; the two sinks feed each other). RESPEC: redistributes ALREADY-TRAINED stat points, total
// conserved, none below the creation base — convenience over re-grinding, zero new power (the
// path-switch precedent at 25 $OMR). Prices new/tunable — founder sign-off before production.
export const M8 = {
  BOARD_ANON_OMR: 3,   // anonymity on a FRESH contract pot (top-ups inherit the pot's flag, never charged)
  INTEL_PEEK_OMR: 5,   // "who wants me dead?" — funder names + shares on every open pot on you
  RESPEC_OMR: 15,      // redistribute muscle/cunning/speed; sum must match, each ≥ RESPEC_STAT_MIN
  RESPEC_STAT_MIN: 5,  // the creation base — respec never drops a stat below the man you started as
  RESPEC_CD_MS: 24 * 3600 * 1000, // D7: opposed rolls are shape-sensitive — no re-shaping between fights
  TRIBUTE_OMR_MIN: 1,  // minimum $OMR tribute into the family reserve
};
// M8 — FAMILY SEALS: the gang-prestige ladder, the family-level $OMR sink. Pure STATUS (a badge
// on the family's name everywhere it appears — no member cap, no combat edge, no income). Bought
// SEQUENTIALLY by the boss from the family's $OMR RESERVE — the bucket the buyback split and
// weekly-contract bonuses already feed, now also fed by member $OMR tribute — so a seal is a
// COOPERATIVE purchase: the family pools tokens for its colors. Escalating prices make the top
// seals genuinely rare. Prices new/tunable — founder sign-off before production.
export const GANG_SEALS = [
  { tier: 1, id: 'wax',      name: 'Wax Seal',      omr: 25 },
  { tier: 2, id: 'brass',    name: 'Brass Seal',    omr: 75 },
  { tier: 3, id: 'silver',   name: 'Silver Seal',   omr: 200 },
  { tier: 4, id: 'gold',     name: 'Gold Seal',     omr: 500 },
  { tier: 5, id: 'obsidian', name: 'Obsidian Seal', omr: 1500 },
];
export const sealOf = (tier = 0) => GANG_SEALS.find((s) => s.tier === Number(tier)) || null;
// VENDETTAS — a status axis (no gameplay power beyond the rep multiplier + the KILL-only
// directed-floor waiver, no money flows): the TTL and the settlement bonus. The diminishing
// divisor counts the avenger's own prior kills of that bloodline (0 on a first revenge), so a
// first revenge pays a ONE-TIME 2x base per feud direction and repeat trading decays 2/k —
// bounded by the decay + the economics (level floor, ammo, searches). Founder dial: divide by
// priors+2 on vendetta kills to make revenge rep-neutral.
export const VENDETTA = { TTL_MS: 7 * 24 * 3600 * 1000, REP_BONUS: 2,
  // step two — ESCALATION: each time the target's line bleeds the avenger's again the feud DEEPENS
  // (kills++). A deeper feud carries a higher TIER (pure STATUS — a badge on the ledger/leaderboard)
  // and a longer TTL (ttlMult — access/timing only, off §10.4 + the sim-audited balance): a War of
  // Extinction won't lapse from waiting, so you must settle it or sue for peace. The REP_BONUS on
  // settlement is unchanged (the signed status lever). Founder sign-off levers.
  TIERS: [{ min: 1, name: 'Vendetta', ttlMult: 1 }, { min: 2, name: 'Blood Feud', ttlMult: 1.5 },
          { min: 4, name: 'War of Extinction', ttlMult: 2 }] };
export const feudTierOf = (kills) =>
  [...VENDETTA.TIERS].reverse().find((t) => Number(kills || 1) >= t.min) || VENDETTA.TIERS[0];
// THE LAW / RICO / INFORMANTS — the state-run PvE antagonist (design omerta-law-rico-design.md).
// Heat already ACCRUES all over the game (deals, fire, npchit, launder, shakedown); nothing about
// that changes (sim-audited surfaces stay put, ground rule #1). THE LAW is everything DOWNSTREAM of
// the number: an investigation meter that builds while heat is high, a bust that can reach BANKED
// wealth (the safehoused-hoard the sim flagged), a courtroom, and the flip. Every value movement is
// a SINK to the confiscation buffer (street_tax.pool — the `mod:confiscate` precedent); the Law only
// DRAINS, never mints, so it's the counterweight to the Risk-to-Earn faucets. ALL numbers are
// founder sign-off levers — proposed defaults, sim + sign-off before production.
export const LAW = {
  // ── Phase 1 — the investigation meter (heat_exposure) ──
  WATCH: 40,                    // heat above this feeds the case; below it the meter bleeds off
  // exposure builds only while heat is ACTIVELY high (accrual decays heat first, so a long offline
  // gap builds ~nothing — you commit no crimes while away). At pinned heat 100 that's ~6/min net;
  // WATCHED ~30min, INVESTIGATION ~3h, INDICT ~8h of reckless active play. Sign-off levers.
  EXPOSURE_RATE: 0.1,           // exposure gained per (heat − WATCH) per minute above WATCH
  EXPOSURE_DECAY: 0.1,          // exposure bled per minute, always (a spike-and-decay costs little)
  EXPOSURE_EVENT: { crackdown: 1.5, sweep: 1.3, visit: 0.5, opencity: 0.5 }, // crackdown weather scales GAIN (CITY_EVENTS is generated — key on id here, hands off the table)
  WATCHED_AT: 200, INVESTIGATE_AT: 1000, INDICT_AT: 3000, // stage thresholds on the meter
  BRIBE_MIN: 25000, BRIBE_BPS: 2000,   // bribe cost = max(MIN, exposure × BPS/1e4) — wealth-scaled cash sink
  BRIBE_CLEAR: 800,                    // exposure knocked down per bribe
  RETAINER_COST: 150000, RETAINER_MS: 3 * 24 * 3600 * 1000, // the lawyer: a time-boxed retainer…
  RETAINER_BUST_MULT: 0.6, RETAINER_FORFEIT_MULT: 0.7,      // …softens the bust P and the seizure
  // ── Phase 2 — the RICO bust + asset forfeiture ──
  BUST_P_MIN: 0.15, BUST_P_MAX: 0.85, BUST_P_PER: 0.0002,   // conviction P = MIN + (exposure − INDICT_AT) × PER
  FORFEIT_RATE: 0.30,          // fraction of pocket+bank seized on conviction (staked $OMR + minted gear are SAFE)
  BUST_JAIL_S: 600,            // lockup on a landed bust
  INDICT_GRACE_MS: 6 * 3600 * 1000, // the worker force-busts an indicted player this long after the indictment (reaches the offline whale)
  ACQUIT_TO: 1000,             // on acquittal the case collapses — exposure resets to this (not re-indicted next tick)
  // ── Phase 3 — the courtroom ──
  PLEA_FORFEIT_RATE: 0.15, PLEA_JAIL_S: 240, // settle: a certain, smaller loss + a short stretch
  JURY_COST_OMR: 20, JURY_BUST_MULT: 0.5,    // buy the jury once → conviction P × this (a $OMR sink — the war chest beats the rap)
  // ── Phase 4 — informants ──
  FLIP_SEED: 1500,             // exposure the rat's testimony adds to the named target
  FLIP_JAIL_S: 120,            // the rat does a short, soft stretch
  WITPRO_MS: 48 * 3600 * 1000, // witness protection: a one-time (per street) untargetable relocation window
  // ── THE ENVELOPE (going-legit sink) — the standing graft you slip the cops so they bury your file.
  // PROACTIVE (vs the reactive one-shot bribe): pay $OMR to keep the envelope current for a window;
  // while current, the investigation meter GAINS at ENVELOPE_GAIN_MULT rate (the cops write less
  // down). NOT immunity — a reckless player still builds a case, just slower. A $OMR sink (law:envelope).
  ENVELOPE_OMR: 15,                     // $OMR to keep the envelope current
  ENVELOPE_MS: 7 * 24 * 3600 * 1000,    // how long one payment buys
  ENVELOPE_GAIN_MULT: 0.5,              // exposure gain scaled by this while the envelope is current
  ENVELOPE_BLEED_MULT: 2,               // step two: the meter also BLEEDS this much faster while current
};
// the rap sheet's stage — a pure function of the meter, except INDICTED which LATCHES (an
// indictment doesn't un-file when heat drops; only a bust/plea/flip clears it).
export const rapStageOf = (exposure, indictedAt = null) => {
  if (indictedAt) return 'indicted';
  const e = Number(exposure || 0);
  if (e >= LAW.INVESTIGATE_AT) return 'investigation';
  if (e >= LAW.WATCHED_AT) return 'watched';
  return 'clean';
};
// the bribe quote: wealth-scaled so the busiest (hottest) players pay most (a recurring drain)
export const bribeCostOf = (exposure) => Math.max(LAW.BRIBE_MIN, Math.floor(Number(exposure || 0) * LAW.BRIBE_BPS / 10000));
export const retainerActive = (ch, now = Date.now()) => !!ch.retainer_until && new Date(ch.retainer_until).getTime() > now;
export const witproActive = (ch, now = Date.now()) => !!ch.witpro_until && new Date(ch.witpro_until).getTime() > now;
export const envelopeActive = (ch, now = Date.now()) => !!ch.envelope_until && new Date(ch.envelope_until).getTime() > now;
// ── THE FOUNDATION (the family charity) — a tiered institution the boss buys sequentially from the
// gang $OMR reserve (the GANG_SEALS precedent). Public philanthropy STATUS (gangs.foundation) + it
// launders the family's collective RICO exposure: every member's conviction odds × the tier bustMult.
// A NEW Law lever (real power, not pure status) — founder sign-off levers, sim before production.
// `bustMult` softens a member's RICO trial (step one); `bleedMult` (step two) speeds every member's
// investigation-meter BLEED — the charity keeps everyone's files thin, so the Foundation PREVENTS the
// case, not just softens the bust once filed. Both are founder sign-off levers (a Law surface).
export const FOUNDATION = {
  TIERS: [
    { tier: 1, name: 'Community Fund', omr: 60,   bustMult: 0.97, bleedMult: 1.15, blurb: 'A soup kitchen, a little goodwill.' },
    { tier: 2, name: 'Youth League',   omr: 180,  bustMult: 0.93, bleedMult: 1.30, blurb: 'Ball fields with the family name on them.' },
    { tier: 3, name: 'City Trust',     omr: 500,  bustMult: 0.88, bleedMult: 1.50, blurb: 'Grants, ribbons, a friend on the council.' },
    { tier: 4, name: 'The Institute',  omr: 1200, bustMult: 0.82, bleedMult: 1.75, blurb: 'A wing at the hospital. Judges attend the galas.' },
    { tier: 5, name: 'The Legacy',     omr: 3000, bustMult: 0.75, bleedMult: 2.00, blurb: 'Pillars of the community. The DA takes the call.' },
  ],
};
export const foundationOf = (tier) => FOUNDATION.TIERS.find((t) => t.tier === Number(tier)) || null;
export const foundationBustMult = (tier) => foundationOf(tier)?.bustMult ?? 1;
export const foundationBleedMult = (tier) => foundationOf(tier)?.bleedMult ?? 1;
// conviction probability for the current case (Phase 2/3): scales with exposure over the
// indictment threshold, softened by an active lawyer retainer, (once) a bought jury, and the
// family's FOUNDATION tier (the charity buys softer trials — sourced at the two bust call sites).
export const bustProbOf = (ch, now = Date.now(), foundationTier = 0) => {
  let p = LAW.BUST_P_MIN + Math.max(0, Number(ch.heat_exposure || 0) - LAW.INDICT_AT) * LAW.BUST_P_PER;
  if (retainerActive(ch)) p *= LAW.RETAINER_BUST_MULT;
  if (ch.jury_bought) p *= LAW.JURY_BUST_MULT;
  if (foundationTier) p *= foundationBustMult(foundationTier); // THE FOUNDATION: the family charity softens the trial
  if (cityHourOf(now).patrol) p *= LIVING.PATROL_BUST_MULT; // THE LIVING WORLD P4: the Bureau works business hours
  return Math.min(LAW.BUST_P_MAX, Math.max(LAW.BUST_P_MIN * LAW.RETAINER_BUST_MULT * LAW.JURY_BUST_MULT, p));
};

// ═══════════════════ THE LIVING WORLD (design omerta-living-world-design.md) ═══════════════════
// CITY_EVENTS + cityEventOf already drive every economy loop. This layers what the design calls for:
// VISIBLE forecasts, a SECOND event track, per-district economic WEATHER, an intraday CLOCK, and
// (src/world.js) NPC RIVAL FAMILIES. CITY_EVENTS is GENERATED (extract-rules.js) — everything new
// keys off the event id here, never a new field on the table (ground rule #2). Numbers are founder
// sign-off levers (ground rule #1).
export const LIVING = {
  FORECAST_DAYS: 7,          // the city board publishes a week ahead (cityEventOf is a pure fn of the day)
  LAW_TRACK_OFFSET: 8,       // the second "law" event track is cityEventOf(day + this) — a distinct daily draw
  // Phase 3 — regional economic weather: each district draws its own daily goods SHOCK band,
  // amplifying the existing per-district variance. MEAN-NEUTRAL (0.9–1.1, avg 1.0) so it adds only
  // texture, not inflation — and deliberately NARROW so it can't widen the audited trade-goods
  // arbitrage. Deterministic (§7.11 hash), no state. Sim sign-off lever.
  REGION_SHOCK_LO: 0.9, REGION_SHOCK_HI: 1.1,
  // Phase 4 — the intraday clock. Small, symmetric, texture-not-power: applied ONLY to NEW levers
  // (the Law bust "patrol" + the NPC raid), never a signed BALANCE surface. PATROL_HOURS (UTC) are
  // the Bureau's business hours; the small hours favour a raid. Sign-off levers.
  PATROL_HOURS: [13, 22], PATROL_BUST_MULT: 1.15, NIGHT_RAID_MULT: 0.9,
};
// the intraday clock — a pure function of the UTC hour (the cityEventOf shape). No state.
export const cityHourOf = (t = Date.now()) => {
  const h = new Date(t).getUTCHours();
  const patrol = h >= LIVING.PATROL_HOURS[0] && h < LIVING.PATROL_HOURS[1];
  return { hour: h, patrol, phase: patrol ? 'day' : 'night' };
};
// the second daily event track (Phase 1 layering) — an independent draw, so the city runs two dials
export const cityLawEventOf = (day = dayOf()) => cityEventOf(day + LIVING.LAW_TRACK_OFFSET);
// Phase 3 — the per-district daily goods shock (a deterministic mean-neutral band). Keyed on the
// block's DAY so it's stable across a day's four-hour price blocks. Folded into goodPriceOf below.
export const regionShockOf = (districtId, day = dayOf()) =>
  LIVING.REGION_SHOCK_LO + hash01('region:' + districtId + ':' + day + ':' + MARKET_SEED) * (LIVING.REGION_SHOCK_HI - LIVING.REGION_SHOCK_LO);
// the 7-day forecast — both tracks, pure functions of the day (knowable, so players can plan)
export const cityForecast = (day = dayOf()) => Array.from({ length: LIVING.FORECAST_DAYS }, (_, i) => ({
  day: day + i, city: cityEventOf(day + i).id, law: cityLawEventOf(day + i).id,
  uprising: cartelUprisingOf(day + i)?.id || null })); // step six: the cartel uprising is forecast-able

// NPC RIVAL FAMILIES (Phase 2) — a server-wide common enemy (positive-sum co-op). `strength` is a
// shared CASH RESERVOIR (dollars) that regenerates lazily toward its max; a raid loots a bounded
// slice (GRAB_BPS of the reservoir, capped) and drains it — so total emission is bounded by REGEN,
// a metered world quantity (§10.4-safe: `world:raid` is a ledgered faucet, capped by real activity).
// The whole server grinds the same pool; routing it (strength → floor) pays a one-time bonus + a
// streets event. Numbers are founder SIM sign-off levers (the only emission surface in this pillar).
// Roster (step two expanded the set 3→5, on-curve — the car-catalog precedent: content, not a rebalance).
// `coop`: the APEX outfits (step three) — too well-defended to solo reliably, so a crew's combined
// firepower is the practical way to crack (and ROUT) them. Solo raids still work on any outfit; co-op
// is the alternative that carries a crew of qualified raiders past a heavy defense (never an auto-win).
export const WORLD_NPCS = [
  { id: 'dockrats', name: 'The Dock Rats',      minLvl: 4,  max: 150000,   regenPerHr: 5000,   base: 0.60, def: 20,  routBonus: 5000 },
  { id: 'zappa',    name: 'The Zappa Crew',     minLvl: 8,  max: 400000,   regenPerHr: 12000,  base: 0.55, def: 40,  routBonus: 15000 },
  { id: 'kryl',     name: 'The Kryl Syndicate', minLvl: 20, max: 1500000,  regenPerHr: 40000,  base: 0.45, def: 90,  routBonus: 60000,  coop: true },
  { id: 'moreau',   name: 'The Moreau Cartel',  minLvl: 40, max: 5000000,  regenPerHr: 90000,  base: 0.35, def: 150, routBonus: 200000, coop: true },
  { id: 'volkov',   name: 'The Volkov Bratva',  minLvl: 55, max: 12000000, regenPerHr: 180000, base: 0.30, def: 220, routBonus: 500000, coop: true },
];
export const worldNpcOf = (id) => WORLD_NPCS.find((n) => n.id === id) || null;
export const WORLD = {
  RAID_ENERGY: 30, RAID_AMMO: 15, RAID_HEAT: 12,   // a raid costs energy + ammo (a §10.4 ammo sink) + heat
  RAID_CD_MS: 2 * 3600 * 1000,                     // per-character cooldown between raids
  GRAB_BPS: 500,                                   // a landed raid takes 5% of the reservoir…
  GRAB_MAX: 250000,                                // …capped per raid (so a whale can't one-shot a full cartel)
  FAIL_HOSP_MS: 20 * 60 * 1000,                    // a repelled raid hospitalizes
  ROUT_FLOOR_BPS: 200,                             // "routed" once the reservoir is drained below 2% of max
  // ── STEP TWO — THE CARTELS FIGHT BACK (pure pacing/def modifier, EMISSION-SAFE) ──
  // Routing a cartel puts it on HIGH ALERT: it defends +ENRAGE_DEF for ENRAGE_MS, so it can't be
  // farmed to the floor over and over. Raises DEFENSE (lowers odds) → REDUCES throughput, so §10.4 is
  // helped, never widened. No new value — just a harder raid for a window.
  ENRAGE_MS: 3 * 3600 * 1000, ENRAGE_DEF: 60,
  // THE WAR EFFORT (status axis, survives death — the hitman-rep precedent): lifetime cash looted from
  // NPC outfits ranks the base's most feared cartel-hunters. Pure status — no §10.4 surface.
  WAR_RANKS: [
    { min: 0, name: 'Civilian' }, { min: 100000, name: 'Cartel Raider' }, { min: 1000000, name: 'Kingpin Hunter' },
    { min: 10000000, name: 'Warlord' }, { min: 50000000, name: 'The Scourge' },
  ],
  // ── STEP THREE — CO-OP CREW RAIDS + THE FRONTIER ──
  // The crew-heist machinery applied to an apex-outfit raid: a leader opens the op, made raiders join
  // off the board, the leader calls the go and ONE roll pays the whole crew. Combined firepower (SUM of
  // raider power, not avg) is what beats a heavy apex defense — so it stacks, but the clamp keeps even a
  // full crew short of a sure thing. No stake: each raider pays their OWN energy/ammo/heat at execute
  // (the solo-raid cost), so the loot is the SAME bounded reservoir slice, just shared. §10.4-neutral vs
  // solo — every share/ammo row rides the existing `world:raid` vocabulary.
  COOP_MIN: 2, COOP_MAX_CREW: 4,          // a raid crew is 2–4 made raiders
  COOP_SCALE: 600,                        // combined firepower over the outfit's defense (higher than solo's 400 — many guns)
  COOP_MAX_P: 0.85,                       // even a full crew is never certain
  COOP_LEADER_WEIGHT: 1.2,                // the leader who fronts the op takes a bigger cut (the heist precedent)
  COOP_TTL_MS: 60 * 60 * 1000,            // a stale plan is swept (nothing staked → nothing to refund)
  // THE FRONTIER (family conquest): whoever lands the ROUT (solo or co-op) plants their FAMILY'S flag on
  // the outfit's turf; the next rout topples it. A dominance leaderboard (families ranked by outfits held,
  // weighted by the outfit's scale). Dies with the family.
  // ── STEP FOUR — THE FRONTIER MADE REAL (productive + contestable outposts) ──
  // A held outfit is a conquered vassal: it pays its overlord family a bounded, lazy-accrued TRIBUTE to the
  // treasury (a §10.4 faucet `world:tribute`, NOT drawn from the shared reservoir — the vassal's protection
  // money — metered by the outfit's regen + hard-capped, so total base-wide emission is small + well-defended).
  // A rival family INVADES a held outpost by outbidding its GARRISON from the treasury (`world:invade` sink —
  // the seizeDistrict pattern); routing installs a base garrison + starts the tribute clock. Uncollected
  // tribute forfeits on any flag transfer (rout or invasion), like territory seizure. Numbers are founder
  // SIM sign-off levers (a NEW emission surface — ground rule #1).
  FRONTIER: {
    TRIBUTE_BPS: 200,                 // tribute/hr = the outfit's regenPerHr × this/10000 (2% — a small vassal cut)
    TRIBUTE_CAP_MS: 24 * 3600 * 1000, // accrual caps at a day (the territory-income precedent)
    ROUT_GARRISON: 25000,             // the base defense installed when a family takes an outpost by routing it
    INVADE_BASE: 50000,               // the floor treasury cost to invade a held outpost…
    INVADE_OUTBID: 1.5,               // …or 1.5× the incumbent's garrison, whichever is higher (the SEIZE_OUTBID twin)
  },
  // ── STEP SIX — THE UPRISING (the cartels PUSH BACK — the world's first proactive threat) ──
  // A seed-drawn, forecast-able event: on some days ONE outfit RISES UP. While rising it defends
  // +UPRISING.DEF (can't be farmed during its own revolt — the ENRAGE precedent) and its frontier
  // tribute is SUSPENDED (a rebelling vassal doesn't pay). At the reckoning (the worker, once the
  // uprising's day has passed) a rising outfit that a family HOLDS attempts to BREAK FREE: if the
  // outpost's garrison is below `outfit.max × THRESHOLD_BPS/10000 × its live strength fraction`, it
  // RECLAIMS its turf (held_by_gang→NULL, garrison reset, uncollected tribute forfeits — the
  // releaseFrontierHolds/seizure precedent, §10.4-NEUTRAL ownership move). A REINFORCED outpost repels
  // it. The interlock: keep the outfit BEATEN DOWN (low strength → low threshold) and even a thin
  // garrison holds — so the raid loop and the frontier defend each other. §10.4: `world:reinforce` is a
  // treasury cash SINK (no new faucet); the reclaim moves no value. All numbers are founder sign-off
  // levers (pacing + a sink — no emission surface).
  UPRISING: {
    CHANCE: 0.28,           // ~28% of days one outfit rises (seed-drawn: unpredictable without the seed, verifiable after)
    DEF: 50,                // +defense while rising (the ENRAGE_DEF twin — no farming its own revolt)
    THRESHOLD_BPS: 300,     // breaks a held outpost free if garrison < outfit.max × 3% × live strength fraction
    REINFORCE_MIN: 10000,   // the floor a boss/underboss pays the treasury to stiffen a garrison (vs the uprising AND rival invasions)
  },
};
export const worldRankOf = (dmg) =>
  [...WORLD.WAR_RANKS].reverse().find((r) => Number(dmg) >= r.min) || WORLD.WAR_RANKS[0];
// step four: a held outfit's tribute-per-hour to its overlord family (a bounded slice of the outfit's regen).
export const frontierTributePerHr = (fixture) => Math.floor((fixture?.regenPerHr || 0) * WORLD.FRONTIER.TRIBUTE_BPS / 10000);
// step six: the seed-drawn UPRISING for a given day — which outfit (if any) rises up. Pure function of the
// day (forecast-able, verifiable after; unpredictable without the server seed — the §7.11 machinery).
export const cartelUprisingOf = (day = dayOf()) => {
  // TEST-ONLY override (the SEARCH_MS/LAW_BUST_P knob precedent): 'none' forces no uprising, an outfit
  // id forces that outfit to rise. Never set in production — the real schedule is the seed draw below.
  if (process.env.WORLD_UPRISING) return process.env.WORLD_UPRISING === 'none' ? null : (worldNpcOf(process.env.WORLD_UPRISING) || null);
  if (hash01(`uprising:${day}:${MARKET_SEED}`) >= WORLD.UPRISING.CHANCE) return null;
  return WORLD_NPCS[Math.floor(hash01(`uprisingpick:${day}:${MARKET_SEED}`) * WORLD_NPCS.length)] || null;
};
// ── STEP FIVE — THE OCCUPATION: apex outfits garrison the CORE player-map districts ──
// An occupied district can't be freely seized — a family LIBERATES it (seizeDistrict's npc branch), and
// the cost SCALES WITH THE OUTFIT'S LIVE STRENGTH, so the World raid loop is the path to core turf (beat
// the outfit down → its district goes cheap). The signed district PERKS are UNTOUCHED (dormant while
// occupied; active once a family holds it). §10.4: liberation is the existing `turf:seize:` treasury sink.
// The mapping + numbers are founder SIM sign-off levers (a change to the signed turf ON-RAMP, ground rule
// #1). `cathedral` stays FREE as the fallback on-ramp; a dissolved family's district goes unowned (not re-
// occupied). 5 of 6 core districts start occupied, difficulty scaling with the outfit tier.
WORLD.OCCUPATION = { docks: 'dockrats', brick: 'zappa', canal: 'kryl', foundry: 'moreau', neon: 'volkov' };
WORLD.OCCUPY_BPS = 3000;    // liberation cost at FULL strength = outfit.max × this/10000 (× the live strength fraction)
WORLD.OCCUPY_MIN = 30000;   // …floored (a routed outfit's turf is cheap, not free — the SEIZE_BASE floor)
export const occupierOf = (districtId) => WORLD.OCCUPATION[districtId] || null;
// the treasury cost to liberate an occupied district, given the outfit and its live strength fraction [0..1]
export const liberationCost = (fixture, strengthFrac) =>
  Math.max(WORLD.OCCUPY_MIN, Math.floor((fixture?.max || 0) * WORLD.OCCUPY_BPS / 10000 * Math.max(0, Math.min(1, strengthFrac))));

// THE PEN — the prison meta-game (design omerta-the-pen-design.md). Turns `jail_until` dead time into
// a place: work the yard down, buy contraband, pay for protection, bribe out — and the marquee
// JAILHOUSE SHANK, reaching an enemy who's ALSO inside (bypassing the street defenses). Every Pen
// action REQUIRES being jailed. Numbers are founder sign-off levers (ground rule #1).
export const PEN = {
  WORK_ENERGY: 15, WORK_PAY: [200, 600], WORK_CUT_S: 60,   // yard duty: energy → a little cash + shave 60s off the sentence
  CONTRABAND: [
    { id: 'shiv',   name: 'Sharpened Toothbrush', cost: 5000,  desc: 'The price of admission to a conversation nobody walks away from.' },
    { id: 'burner', name: 'Burner Phone',         cost: 25000, desc: "Locked up, not out of the game. One call, one contract — then you eat the SIM." },
    { id: 'cutkit', name: 'Hacksaw & Rope',       cost: 50000, desc: 'A blade for the bars, a rope for the wall. The long way out — if you make it.' },
  ],
  PROTECTION_COST: 15000, PROTECTION_MS: 2 * 3600 * 1000,   // pay the yard boss for a no-shank window
  // PROTECTION_NW_BPS (SIGN-OFF Tier 3): the yard boss charges what the man is worth, not a flat rate —
  // max(floor, (cash+bank) × 50bps) per 2h stay, the SAFEHOUSE_NW_BPS pattern at half the rate for half
  // the window. A flat $15k sold a jailed whale shank-immunity for pocket change; a street inmate pays
  // exactly what they paid before (the floor). Ledgered on the same `pen:protection` sink.
  PROTECTION_NW_BPS: 50,
  BRIBE_PER_S: 200,                                         // bribe the guard: $/second shaved off the remaining sentence
  SHANK_ENERGY: 25, SHANK_BASE: 0.5, SHANK_SCALE: 200,      // the shank contest: base + (musc edge)/scale, clamped
  SHANK_MIN: 0.15, SHANK_MAX: 0.9,
  // SHANK_CD_MS (SIGN-OFF Tier 3): a per-attacker cooldown between yard hits. The shank was soft-limited
  // by energy + a shiv + a sentence extension only, so a stocked-up inmate could work down a whole wing
  // in one sitting. 30 min is short enough that a real feud still resolves inside a normal sentence.
  SHANK_CD_MS: 30 * 60 * 1000,
  KILL_ADD_S: 600, CAUGHT_ADD_S: 300, FAIL_DMG: [15, 35],   // a body / getting caught both add time; a miss hurts
  HOLE_MS: 30 * 60 * 1000,                                  // step two: solitary — a caught shank throws you in the hole (no yard actions, untouchable)
  // step three — THE BREAKOUT: a high-risk escape. Needs a 'cutkit' (bought from the commissary),
  // burns it win or lose. Success CLEARS the sentence but makes you a WANTED fugitive (omertà stripped
  // + NPC bounty hunters — the loan-WANTED machinery); failure = the hole + a long added stretch + a
  // beating. §10.4-clean (no currency moves — the kit was already a ledgered commissary sink). You
  // trade a cell for a manhunt, so it never trivialises the RICO sink. PEN_BREAK_P is a TEST-ONLY roll
  // knob (the SHANK_P / LAW_BUST_P precedent). All numbers are founder sign-off levers.
  BREAK_ENERGY: 30, BREAK_P: 0.35, BREAK_HEAT: 40,
  BREAK_CAUGHT_ADD_S: 900, BREAK_FAIL_DMG: [20, 45],
  FUGITIVE_MS: 2 * 24 * 3600 * 1000,                        // how long an escapee stays a hunted fugitive (reuses characters.wanted_until)
  // step four — the CO-OP BREAKOUT (the crew-heist pattern, inside): a jailed leader stakes a cutkit,
  // jailed inmates join, the leader calls the go — ONE roll for the whole crew, odds scaling with crew
  // size (more hands = lookouts + diversion). Win = everyone's sentence clears + everyone WANTED; loss
  // = the whole crew eats the hole + BREAK_CAUGHT_ADD_S + a beating. §10.4-clean (the cutkit is
  // contraband, not currency; refunded to a LIVING leader on disband/stale). Numbers are sign-off levers.
  COOP_MIN: 2, COOP_MAX: 4,                                 // crew size bounds (leader + 1..3)
  COOP_BASE: 0.4, COOP_PER_EXTRA: 0.12, COOP_MAX_P: 0.9,    // p = COOP_BASE + (crew−1)×COOP_PER_EXTRA, clamped [.05, COOP_MAX_P] (+ riot shankAdd)
  COOP_TTL_MS: 60 * 60 * 1000,                              // a plan goes cold after an hour (the worker sweeps it, refunds a living leader's cutkit)
  // step two — YARD INCIDENTS: a deterministic daily draw (the §7.11 seed) the whole block shares,
  // a modifier layer on the Pen (the cityEventOf pattern). Each is ONE touchpoint. Sign-off levers.
  QUIET_WEIGHT: 0.45,   // SIGN-OFF (Pen T3): 'quiet' is weighted up so the yard isn't hard-blocked ~40% of days
  YARD_EVENTS: [
    { id: 'quiet',    name: 'Quiet Day',          desc: 'The block is calm. Business as usual.' },
    { id: 'lockdown', name: 'Lockdown',           shankBlock: true,               desc: 'Cells locked, guards on every tier — nobody moves on anybody today.' },
    { id: 'riot',     name: 'Riot in the Block',  shankAdd: 0.2, protMult: 0.5,   desc: 'The yard is up. Blood is cheap and the boss cuts a deal on cover.' },
    { id: 'visit',    name: 'Family Visit Day',   bribeMult: 0.5,                 desc: 'Brass wants the place looking civilised — the guard takes less to look away.' },
    { id: 'toss',     name: 'Cell Toss',          commissaryClosed: true,         desc: 'Guards are tearing the block apart — the guard won’t move contraband today.' },
    // step five — two more incidents (reuse the existing touchpoint fields; no new plumbing)
    { id: 'gangwar',  name: 'War in the Yard',    shankAdd: 0.15, bribeMult: 1.5, desc: 'The crews are at each other — blood in the dust, and the guards want more to look away.' },
    { id: 'newfish',  name: 'A Bus of New Fish',  protMult: 1.5,                  desc: 'Fresh transfers off the bus — the yard boss charges a premium while he sizes them up.' },
  ],
  // step five — PRISON FACTIONS: yard crews an inmate runs with for cover. Joining is free; while jailed
  // in a faction with fellow inmates, incoming shanks are HARDER (the crew watches your back) and you
  // can't be shanked BY your own crew (omertà inside). The SHOT-CALLER — the most-feared jailed member
  // (by this street's season_kills) — leads: they're individually harder to touch. Pure status + a shank
  // modifier; zero §10.4. The BREAK RAT (the heist-rat twin): a co-op-break crew member silently tips the
  // guards — the break blows, the crew eats the hole + a longer stretch, the rat cuts a deal (a sentence
  // cut) and is NEVER named. All numbers are sign-off levers.
  FACTIONS: [
    { id: 'northside', name: 'The Northside Crew' },
    { id: 'dixie',     name: 'The Dixie Mob' },
    { id: 'muertos',   name: 'Los Muertos' },
    { id: 'brand',     name: 'The Brand' },
  ],
  FACTION_COVER: 0.08,        // shank-defense per active jailed faction-mate…
  FACTION_COVER_CAP: 0.24,    // …capped (a crew, not an army)
  SHOTCALLER_COVER: 0.1,      // the shot-caller (top season_kills, jailed) is individually harder to touch
  // (the break rat's deal is relief-only — dodge the crew's added stretch + beating, no absolute sentence
  // cut — so a Sybil main+alt can't farm a cheap trim; see executeBreak's ratted branch)
};
export const penFactionOf = (id) => PEN.FACTIONS.find((f) => f.id === id) || null;
export const penContrabandOf = (id) => PEN.CONTRABAND.find((c) => c.id === id) || null;
export const yardEventById = (id) => PEN.YARD_EVENTS.find((e) => e.id === id) || PEN.YARD_EVENTS[0];
// today's yard incident — seed-drawn, town-wide, deterministic (the cityEventOf shape)
export const yardEventOf = (day = dayOf()) => {
  // SIGN-OFF (Pen T3): 'quiet' (index 0) is weighted up to PEN.QUIET_WEIGHT so the yard isn't
  // hard-blocked (lockdown/toss) ~40% of days; the remaining incidents share the rest uniformly.
  const r = hash01('yard:' + day + ':' + MARKET_SEED);
  if (r < PEN.QUIET_WEIGHT) return PEN.YARD_EVENTS[0]; // 'quiet'
  const rest = PEN.YARD_EVENTS.slice(1);
  return rest[Math.min(rest.length - 1, Math.floor(((r - PEN.QUIET_WEIGHT) / (1 - PEN.QUIET_WEIGHT)) * rest.length))];
};
// seconds left on a sentence (0 if free) — the Pen's clock
export const jailSecondsLeft = (ch, now = Date.now()) =>
  ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until).getTime() - now) / 1000)) : 0;
export const penSafe = (ch, now = Date.now()) => !!ch.pen_safe_until && new Date(ch.pen_safe_until).getTime() > now;
export const inHole = (ch, now = Date.now()) => !!ch.hole_until && new Date(ch.hole_until).getTime() > now;

// LOAN SHARKING — the Shylock (design omerta-loan-sharking-design.md). The game's first player-to-
// player CASH primitive: a lender escrows capital at usurious interest (the bounty-escrow pattern), a
// borrower takes it and must repay by a deadline, and a DEFAULT is enforced (the seizure + the beating
// + the welsher mark). Every value movement is a §10.4-ledgered transfer; only the house vig leaves
// the economy (a sink → the buyback pool). Numbers are founder sign-off levers (ground rule #1).
export const LOAN = {
  MIN: 5000, MAX: 1000000,             // loan size bounds
  RATE_MAX: 0.5,                        // interest cap — loan sharking is usurious (50%)
  TERM_MIN_H: 1, TERM_MAX_H: 72,        // repayment window (hours)
  OFFER_TTL_MS: 48 * 3600 * 1000,       // an untaken offer expires + refunds the lender (worker sweep)
  VIG_BPS: 500,                         // 5% house take on repayment/collection → the street-tax pool
  COLLECT_HOSP_MS: 30 * 60 * 1000,      // the leg-breaking: collection hospitalizes the deadbeat
  MAX_ACTIVE: 1,                        // one active loan at a time per borrower (no debt-stacking)
  // step 2 (secured credit): a lender may require collateral — a car worth ≥ collateral_min (its
  // damage-adjusted book value). On default the shark SEIZES the car (ownership move, §10.4-neutral —
  // cars conserve by row count) on top of the cash. COLLATERAL_MAX bounds the lender's asking figure.
  COLLATERAL_MAX: 5000000,
  // step 2 audit F1: a SECURED loan left un-collected past `due_at + GRACE_MS` auto-forfeits its
  // collateral car to the lender (the worker sweep) — so a spiteful/absent lender can't freeze the
  // borrower's car forever. The borrower always had the grace window to repay; the lender had it to
  // collect cash+car manually. The forfeit is collateral-only (no cash seized) — a pure ownership move.
  GRACE_MS: 24 * 3600 * 1000,
  // step 3 (the paper market): a lender can SELL an active loan's claim to another player at an ask
  // price. The buyer becomes the new lender (the debt/collateral unchanged); the sale is a taxed cash
  // transfer — PAPER_TAKE_BPS (2%) → the buyback pool (never a free alt-rail). Price is bounded.
  PAPER_TAKE_BPS: 200, PAPER_MIN: 1, PAPER_MAX: 5000000,
  // step 4 (WANTED — the defaulter's pursuit): welshing marks you WANTED for WANTED_MS — omertà is
  // stripped (even your own family can hit you, the rat precedent), the underworld posts a
  // WANTED_BOUNTY on your head from the confiscation pool (any player collects it by killing you),
  // and NPC bounty hunters roll WANTED_HUNT_P each worker tick to whack you. SQUARE_COST squares your
  // name — clears WANTED + the welsher mark + refunds the pool bounty (a cash sink → the pool).
  WANTED_MS: 3 * 24 * 3600 * 1000, WANTED_BOUNTY: 25000, WANTED_HUNT_P: 0.05, SQUARE_COST: 50000,
  // alt-farm mitigation (audit F2): the pool-funded cash bounty only lands on a defaulter at or above
  // this level — a throwaway alt (the cheap farm fodder) gets NO pool price, though they're still
  // WANTED (omertà stripped + NPC hunters). The npcHit "no hits on nobodies" rookie-floor precedent.
  // Raised 10→20 (founder call): level 20 (respect 1444) is ~4.5× the respect grind of level 10 (324)
  // per DISPOSABLE alt — since the borrower alt DIES each farm cycle, the floor is a recurring cost, so
  // a higher one directly taxes the Sybil ring while a real predatory-lending target (a mid-game player
  // taking a $25k+ loan) is comfortably past it. Founder sign-off lever — raise further if farmed.
  WANTED_MIN_LVL: 20,
  // step 5 (THE LOAN HOUSE — the backed NPC lender, omerta-deep-deferred-design.md §C): the lender
  // of last resort, deliberately WORSE than the P2P market (the house prices in the risk it can't
  // vet): a fixed usurious rate, a short fixed term, a level-scaled cap. The house lends ONLY what
  // its sink-fed pool holds (full-reserve — never a mint); HOUSE_VIG_BPS of every P2P vig feeds the
  // window. Defaults are auto-collected by the sweep (seize → pool + the standard welsher/WANTED
  // machinery — the house always enforces). All founder sign-off levers.
  // HOUSE_MIN_LVL 3 → 10 (AUDIT-deep-deferred, the loan-house death cycle): at 3 a throwaway alt
  // could borrow the per-level cap, extract, and die — the heir repeats, a recurring net drain on a
  // pool that only sinks refill. Level 10 (respect 324 vs 36) is the codebase's standing anti-Sybil
  // floor — the same WANTED_MIN_LVL / npcHit-rookie / legend-floor posture — so each disposable
  // borrower now costs a real grind. Genuine new players reach the window a little later; the P2P
  // market (no level floor) is still open to them from the start.
  HOUSE_RATE: 0.35, HOUSE_TERM_H: 24, HOUSE_MIN: 1000,
  HOUSE_MAX_PER_LVL: 2000, HOUSE_MAX: 50000, HOUSE_MIN_LVL: 10,
  HOUSE_VIG_BPS: 5000, // half of every P2P loan vig → the house window (the rest → the buyback pool)
};
export const loanVig = (amt) => Math.ceil(Math.max(0, Number(amt)) * LOAN.VIG_BPS / 10000);
// step 3: the house take on a paper (loan-claim) sale — the market/bodyguard 2% precedent → the pool
export const paperTake = (price) => Math.ceil(Math.max(0, Number(price)) * LOAN.PAPER_TAKE_BPS / 10000);
// outstanding debt on an active loan = principal × (1 + rate), floored to whole dollars
export const loanOwed = (principal, rate) => Math.floor(Number(principal) * (1 + Number(rate)));
// step 2: a car's collateral (book) value = its cash value taken down by damage. Deterministic +
// server-authoritative — the figure a secured offer's collateral_min is checked against at take.
export const carCollateralValue = (modelId, trimId, dmg = 0) =>
  Math.floor(carVal(modelId, trimId) * (1 - Math.min(100, Math.max(0, Number(dmg) || 0)) / 100));
// CREW HEISTS (THE BIG SCORE) — the co-op layer. Pot scales with the AVERAGE crew level (a low
// alt shrinks everyone's take), split evenly with a 1.2x leader weight (they fronted the stake).
// Per-member EV targets ~1.3-2.1x the solo heist (1200/lvl guaranteed) with real jail risk —
// a NEW faucet: numbers are founder sign-off levers (BALANCE.md addendum) — sim before retuning.
// Step two: every crew slot is a ROLE (each claimed exactly once — crew size == roles length) and
// the success roll reads each member's stat FOR THEIR ROLE (x3, so a full specialist crew matches
// a full generalist crew stat-for-stat; specialists get there cheaper — respec has a use). The
// INSIDE JOB is the co-op raid on a PLAYER's business: the pot is rateBps of the front's PENDING
// income redirected to the crew (the shakedown argument — bounded by incomePerHr either way, the
// owner keeps the rest and the clock advances by only the stolen share). NOT a new faucet.
// TIER-4: two more role kinds (lookout/hacker) let the biggest jobs field a 5-man crew of DISTINCT
// roles (the UNIQUE(heist_id, role) seat rule). Each maps to a stat the success roll reads (x3).
export const HEIST_ROLES = { brains: 'cunning', muscle: 'muscle', wheelman: 'speed', gun: 'muscle', lookout: 'speed', hacker: 'cunning' };
// THE JOB LADDER (Tier-4 §A) — 4 → 12 on the SAME ROI curve as the original four (the car-catalog
// precedent: executeHeist already handles any job, so extending the array is CONTENT not a rebalance;
// the takePerLvl bands are the sim-signed faucet — flagged in BALANCE.md). `minPulled` is the notoriety
// soft-gate on the marquee jobs (Tier-4 §D — you earn your way up to the Federal Reserve).
export const HEIST_JOBS = [
  { id: 'corner',    name: 'The Corner Store',    crew: 2, lvl: 4,  base: 0.70, stake: 4000,   takePerLvl: [2200, 3600],   jailS: 90,  rep: 15,  roles: ['muscle', 'wheelman'] },
  { id: 'payroll',   name: 'The Payroll Office',  crew: 2, lvl: 8,  base: 0.65, stake: 10000,  takePerLvl: [4400, 7000],   jailS: 120, rep: 30,  roles: ['muscle', 'wheelman'] },
  { id: 'inside',    name: 'The Inside Job',      crew: 2, lvl: 12, base: 0.55, stake: 15000,  rateBps: 6000,              jailS: 180, rep: 40,  roles: ['brains', 'muscle'] },
  { id: 'jewel',     name: 'The Jewel Heist',     crew: 3, lvl: 15, base: 0.52, stake: 22000,  takePerLvl: [8000, 12500],  jailS: 210, rep: 60,  roles: ['brains', 'muscle', 'wheelman'] },
  { id: 'vault',     name: 'The Bank Vault',      crew: 3, lvl: 20, base: 0.50, stake: 30000,  takePerLvl: [11000, 17000], jailS: 240, rep: 80,  roles: ['brains', 'muscle', 'wheelman'] },
  { id: 'armored',   name: 'The Armored Car',     crew: 3, lvl: 26, base: 0.46, stake: 42000,  takePerLvl: [14000, 21000], jailS: 300, rep: 110, roles: ['gun', 'muscle', 'wheelman'] },
  { id: 'casino',    name: 'The Casino Count Room', crew: 4, lvl: 33, base: 0.42, stake: 62000, takePerLvl: [20000, 29000], jailS: 360, rep: 160, roles: ['brains', 'hacker', 'muscle', 'wheelman'] },
  { id: 'fedtrain',  name: 'The Reserve Train',   crew: 4, lvl: 40, base: 0.38, stake: 80000,  takePerLvl: [26000, 37000], jailS: 420, rep: 200, roles: ['brains', 'muscle', 'gun', 'wheelman'] },
  { id: 'diamond',   name: 'The Diamond District', crew: 4, lvl: 48, base: 0.36, stake: 110000, takePerLvl: [32000, 45000], jailS: 480, rep: 260, roles: ['brains', 'hacker', 'gun', 'wheelman'] },
  { id: 'museum',    name: 'The Art Museum',      crew: 5, lvl: 56, base: 0.34, stake: 150000, takePerLvl: [40000, 56000], jailS: 540, rep: 340, roles: ['brains', 'hacker', 'muscle', 'gun', 'wheelman'], minPulled: 5 },
  { id: 'goldvault', name: 'The Gold Depository', crew: 5, lvl: 68, base: 0.31, stake: 220000, takePerLvl: [52000, 72000], jailS: 600, rep: 440, roles: ['brains', 'hacker', 'muscle', 'gun', 'lookout'], minPulled: 12 },
  { id: 'thefed',    name: 'The Federal Reserve', crew: 5, lvl: 80, base: 0.28, stake: 320000, takePerLvl: [70000, 95000], jailS: 720, rep: 600, roles: ['brains', 'hacker', 'muscle', 'gun', 'wheelman'], minPulled: 25 },
];
export const heistJobOf = (id) => HEIST_JOBS.find((j) => j.id === id) || null;
export const HEIST_PLAN_TTL_MS = 6 * 3600 * 1000;  // a plan goes stale after 6h (sweep refunds a living leader)
export const HEIST_RAT_BPS = 5000;                  // the informant's payout: 50% of the stake (self-rat is -EV)
export const HEIST_LEADER_WEIGHT = 1.2;             // the leader's split weight (fronted the stake)
export const HEIST_INSIDE_CD_MS = 24 * 3600 * 1000; // per-VENUE inside-job cooldown (win or lose)
// TIER-4 §B — THE CASING PHASE: a crew member spends energy to case the job (once each), each casing
// adds a bounded bump to the success roll — prep rewards patience, capped so it never guarantees a score.
export const HEIST_CASE_ENERGY = 10;
export const HEIST_CASE_STEP = 0.03;   // per cased member
export const HEIST_CASE_MAX = 0.15;    // the ceiling on the total casing bonus to p
// TIER-4 §C — THE FENCE: a standard score can be taken HOT (banked as fenceable book value instead of
// cash) then moved through a fence at a DRIFTING daily rate. The band is centered BELOW 1.0 — taking it
// hot is on average WORSE than cash (so it's never a net faucet increase, §10.4-safe) but a good fence
// day beats the cash rate: a market-timing gamble. Hot loot draws heat + a marked man's stash is loot-able.
export const HEIST_FENCE_LO = 0.80, HEIST_FENCE_SPAN = 0.30;   // rate ∈ [0.80, 1.10], mean ~0.95
export const HEIST_FENCE_HEAT = 8;
export const heistFenceMultOf = (day = dayOf()) => HEIST_FENCE_LO + hash01(`heistfence:${day}:${MARKET_SEED}`) * HEIST_FENCE_SPAN;
export const HEIST_LOOT_RATE = 0.5;    // a fire-kill loots this much of the victim's HOT heist loot (P1.1 twin)
// TIER-4 §D — CREW NOTORIETY: lifetime successful heists (account-level, survives death — the boxing/
// hitman-rep legend twin). Ranks are status; the count also soft-gates the marquee jobs (minPulled).
export const HEIST_RANKS = [
  { pulled: 0,   name: 'Small-Timer' },
  { pulled: 3,   name: 'Blagger' },
  { pulled: 10,  name: 'Box Man' },
  { pulled: 25,  name: 'Master Thief' },
  { pulled: 60,  name: 'The Ghost' },
];
export const heistRankOf = (n) => [...HEIST_RANKS].reverse().find((r) => Number(n) >= r.pulled) || HEIST_RANKS[0];
// SMUGGLING CONVOYS — bulk goods on a real clock: visible, ambushable, turf-sheltered. The only
// new money flow is the guard fee (a cash sink); an ambush is a pure goods TRANSFER (trunk-capped)
// and goods aren't a §10.4 currency. Numbers are founder sign-off levers. TEST-ONLY: CONVOY_MS
// env shrinks the transit clock (the SEARCH_MS pattern — never set in production).
export const CONVOY = {
  MIN_QTY: 5, MS: 30 * 60 * 1000,
  GUARD_TIERS: [
    { id: 'none',  fee: 0,     def: 10 },
    { id: 'crew',  fee: 5000,  def: 35 },
    { id: 'heavy', fee: 20000, def: 60 },
  ],
  AMBUSH_ENERGY: 20, AMBUSH_AMMO: 10, AMBUSH_HEAT: 15,
  FAIL_HOSP_MS: 30 * 60 * 1000, TURF_DEF: 15,
  // ── step two (all founder sign-off levers) ──
  TOLL_BPS: 500,            // 5% of collected goods' base value → the DESTINATION holder's treasury (a transfer; own turf/unheld = free)
  MAX_AMBUSHES: 3,          // attempts per convoy (one per character); each fight WEARS the guards
  GUARD_WEAR_BPS: 2500,     // each prior fight strips 25% off the GUARD tier's defense (turf/lockdown never wear)
  INSURE_BPS: 1000,         // premium at depart: 10% of the manifest's base value (convoy:insure → the pool)
  INSURE_PAYOUT_BPS: 5000,  // claim at collect: 50% of the base value LOST to hijacks, CAPPED at the pool
  // ── step three: NPC TRUCKING (worker-run convoys players can hijack — the ambush loop's PvE target
  // so it's live even when no players are shipping). Goods hijacked from an NPC convoy are the one new
  // faucet (sold via the market) — bounded by TARGET × the manifest × hijack success × the trunk cap,
  // sim-measured (the World-raid precedent). All founder sign-off levers. ──
  NPC: {
    TARGET: 2,                                 // keep this many NPC convoys on the road at once
    GOODS: ['gin', 'silk', 'cigars', 'coffee'], // the loot table (a subset of the trade catalog)
    MIN_QTY: 6, MAX_QTY: 16,                    // units of one good on an NPC truck (a modest manifest)
    GUARDS: ['none', 'crew', 'heavy'],         // guard tier drawn uniformly (the run's defense)
  },
  // ── Tier-4 (omerta-tier3-deepening-design.md §Convoys) — all founder sign-off levers ──
  // THE RIG: a scaling shipper-side catalog (the Port-boats/car precedent). One rig per character;
  // ARMOR folds into the convoy's guard defense at depart, ENGINE cuts transit time. Cash SINKS only.
  RIGS: [
    { id: 'van',     name: 'Panel Van',      cost: 40000,   minLvl: 6,  armor: 8,  speedBps: 500 },
    { id: 'box',     name: 'Box Truck',      cost: 180000,  minLvl: 14, armor: 18, speedBps: 1000 },
    { id: 'armored', name: 'Armored Hauler', cost: 600000,  minLvl: 28, armor: 32, speedBps: 1500 },
    { id: 'semi',    name: 'The Semi',       cost: 2000000, minLvl: 42, armor: 50, speedBps: 2000 },
  ],
  RIG_UPGRADE_MAX: 5,          // per-track (armor/engine) level cap
  RIG_ARMOR_STEP: 6,           // +guard-def per armor level (folds into c.guards at depart)
  RIG_ENGINE_STEP_BPS: 400,    // +transit-cut bps per engine level
  RIG_SPEED_CAP_BPS: 4000,     // hard cap on total rig transit cut (40%) — a run is never instant
  RIG_UP_COST_BPS: 3000,       // an upgrade costs 30% of the rig's base cost × (level+1)
  LEGEND_MIN_LVL: 10,          // anti-Sybil floor: deliver/hijack bumps the legend + logs a haul only at/above this level
  HAULER_RANKS: [ { at: 0, title: 'Gofer' }, { at: 250000, title: 'Teamster' }, { at: 2000000, title: 'Dispatcher' },
                  { at: 10000000, title: 'Freight Boss' }, { at: 50000000, title: 'The Baron of the Roads' } ],
  BANDIT_RANKS: [ { at: 0, title: 'Footpad' }, { at: 250000, title: 'Highwayman' }, { at: 2000000, title: 'Road Agent' },
                  { at: 10000000, title: 'The Terror of the Turnpike' }, { at: 50000000, title: 'The Highway King' } ],
  CONTEST_WINDOW_MS: 7 * 24 * 3600 * 1000,   // rolling week for the Road Boss / Teamster-of-the-Week
  HAULS_RETENTION_MS: 8 * 24 * 3600 * 1000,  // worker sweep drops older haul-log rows
};
export const guardTierOf = (id) => CONVOY.GUARD_TIERS.find((t) => t.id === id) || null;
export const rigOf = (id) => CONVOY.RIGS.find((r) => r.id === id) || null;
export const rigUpgradeCost = (rig, curLvl) => rig ? Math.floor(rig.cost * CONVOY.RIG_UP_COST_BPS / 10000 * (Number(curLvl) + 1)) : 0;
export const haulerRankOf = (v) => [...CONVOY.HAULER_RANKS].reverse().find((r) => Number(v || 0) >= r.at) || CONVOY.HAULER_RANKS[0];
export const banditRankOf = (v) => [...CONVOY.BANDIT_RANKS].reverse().find((r) => Number(v || 0) >= r.at) || CONVOY.BANDIT_RANKS[0];
// THE COMMISSION — the top-SEATS families vote weekly on a city decree (majority of last week's
// votes governs this week; ties deadlock). Effects are bounded one-week MODIFIERS on signed
// levers — the modifiers are founder sign-off levers themselves. No decree moves money (§10.4
// untouched by construction). Design: omerta-commission-design.md.
export const COMMISSION = {
  SEATS: 5,
  // step two: votes are SEAT-WEIGHTED — the head of the table casts SEATS points, the last seat 1.
  // A ballot stamps the family's STANDING at cast (re-cast refreshes); the tally ranks the week's
  // frozen ballots by the stamp, counts only the top SEATS of them, and derives weights from the
  // rank (audit-hardened: the electorate is bounded, transit/stale ballots rank where they belong).
  // The head seat's BOSS can also VETO the sitting decree, once per week, on the public record.
  OPEN_SEASON_MULT: 0.5,  // safehouse stays halved
  AMNESTY_MULT: 0.5,      // laylow at half price
  LOCKDOWN_DEF: 20,       // every convoy fights +20 defense
  // Tier-4 decree modifiers (each a bounded ONE-WEEK, ONE-TOUCHPOINT modifier on a signed lever — the
  // modifier is itself a founder sign-off lever, not a retune of the underlying number)
  OPEN_ROADS_MULT: 0.8,        // open_roads: convoy arrival clock ×0.8 (already wired at convoy depart)
  PORT_INTERDICT_MULT: 0.75,   // smugglers_moon: the Coast Guard eases off ×0.75
  BLOOD_OATH_LOOT_MULT: 1.25,  // blood_oath: a fire-kill loots more cash (clamped at the 0.5 loot ceiling)
  DECREES: [
    { id: 'open_season', name: 'Open Season', desc: 'Safehouse stays are halved city-wide. The knives come out.' },
    { id: 'pax',         name: 'The Pax',     desc: 'No new wars may be declared. Consolidation week.' },
    { id: 'amnesty',     name: 'Amnesty',     desc: 'Laying low costs half. The Commission paid the judges.' },
    { id: 'lockdown',    name: 'Lockdown',    desc: 'Every convoy rides with extra guns. The freight is protected.' },
    // Tier-4 catalog expansion (5 → 8): three more one-week, one-touchpoint modifiers
    { id: 'smugglers_moon', name: "Smuggler's Moon", desc: 'The Coast Guard looks the other way — sea runs land easier.' },
    { id: 'open_roads',     name: 'Open Roads',      desc: 'The freight moves fast — convoys arrive quicker.' },
    { id: 'blood_oath',     name: 'Blood Oath',      desc: 'A blood week — a fresh kill takes more off the body.' },
    // step three — THE LEVY: the chamber's first decree with financial teeth, built as a PURE
    // REDIRECT (zero new money): while in force, the 12h buyback's EXISTING family split (normally
    // pro-rata to the top-25 by lifetime standing) pays the SEATED chamber instead, weighted by
    // seat (5..1). One touchpoint (worker.js runBuyback); amounts and §10.4 posture unchanged.
    { id: 'the_levy',    name: 'The Levy',    desc: "The buyback's family cut is levied by the chamber — the five seated families collect it, by seat." },
  ],
  // step three — PROPOSALS WITH DEPOSITS (design omerta-deep-deferred-design.md §B): a seated
  // family may PROPOSE a decree for the week being voted, staking a treasury CASH deposit. When any
  // proposals exist for a week, the tally counts ONLY proposed decrees (skin in the game sets the
  // ballot); with none, the chamber votes freely (backward-compatible). The proposal matching the
  // TALLY-ENACTED decree refunds at settle; every other forfeits to the street-tax pool. Founder
  // sign-off lever.
  PROPOSAL_DEPOSIT: 100000,
  // Tier-4 — THE STATESMAN (a survives-death political-capital legend) + THE OVERRIDE (the floor's
  // parliamentary check on the head veto) + THE RECORD (chamber history). All status/politics — §10.4-neutral.
  STATECRAFT_VOTE: 2, STATECRAFT_VETO: 5, STATECRAFT_PROPOSE: 3, STATECRAFT_OVERRIDE: 3, STATECRAFT_ENACTED: 15,
  STATESMAN_RANKS: [
    { min: 0, name: 'Ward Heeler' }, { min: 25, name: 'Fixer' }, { min: 75, name: 'Power Broker' },
    { min: 200, name: 'Boss of Bosses' }, { min: 500, name: 'Kingmaker' }, { min: 1200, name: 'Il Capo di Tutti Capi' },
  ],
  OVERRIDE_WEIGHT: 7, // of the 10 non-head floor weight (4+3+2+1) — a floor supermajority overrides the head veto
  RECORD_WEEKS: 8,    // the chamber-history scan window
};
export const decreeOf = (id) => COMMISSION.DECREES.find((d) => d.id === id) || null;
export const statesmanRankOf = (n) => {
  let r = COMMISSION.STATESMAN_RANKS[0];
  for (const t of COMMISSION.STATESMAN_RANKS) if (Number(n || 0) >= t.min) r = t; return r;
};
// THE BLACK MARKET — P2P trade: cars by AUCTION (single standing bid, min-raise, optional
// buy-now), goods FIXED-PRICE with district-pinned pickup (the market must not teleport freight
// past the convoy game). The 2% take is carved FROM the hammer (half street tax, half burns) —
// never minted on top. Gear deliberately excluded (its market IS the on-chain rail). All
// numbers are founder sign-off levers. Design: omerta-market-design.md.
// SKILLS & SPECIALIZATIONS — the character BUILD layer. Three branches (Enforcer/Operator/
// Wheelman), three tiers each (cost 1/2/3 points, previous tier required); points derive from
// LEVEL (1 per LVL_PER_POINT — never a currency, no §10.4 surface). Maxing one branch = lvl 24,
// two = lvl 48 — real specialization. Skills DIE WITH THE STREET (like stats; the heir starts
// fresh); respec burns $OMR (`respec:skills`) on the shared M8 respec cooldown. Every effect is
// a NEW single-touchpoint modifier — deliberately OFF the audit-locked surfaces (no heat
// deterrent discounts, no loot-exposure windows, no extraction caps). ALL numbers (FX + costs)
// are founder sign-off levers — sim before production. Design: omerta-skills-design.md.
// The tier-4 capstone point cost, hoisted so the TREE entries below and `SKILLS.CAPSTONE_COST`
// are the SAME number. They used to be two literal 4s, which made the signed lever decorative:
// nothing read it, and retuning it changed no cost anywhere.
const CAPSTONE_COST = 4;

export const SKILLS = {
  LVL_PER_POINT: 4,     // one skill point per four levels
  RESPEC_OMR: 10,       // burn to unlearn everything (shared respec cooldown)
  TREE: [
    { id: 'bruiser',        branch: 'enforcer', tier: 1, cost: 1, name: 'Bruiser',          desc: 'Jumps and shakedowns hit 8% harder.' },
    { id: 'doctors_friend', branch: 'enforcer', tier: 2, cost: 2, name: "The Doc's Friend", desc: 'Healing costs 25% less.' },
    { id: 'executioner',    branch: 'enforcer', tier: 3, cost: 3, name: 'Executioner',      desc: 'Hit searches take 20% less time.' },
    { id: 'fast_talker',    branch: 'operator', tier: 1, cost: 1, name: 'Fast Talker',      desc: 'Laying low costs 20% less.' },
    { id: 'fence_network',  branch: 'operator', tier: 2, cost: 2, name: 'Fence Network',    desc: 'Fencing and melting yield 8% more.' },
    { id: 'broker',         branch: 'operator', tier: 3, cost: 3, name: 'Broker',           desc: 'Black Market listing fees are halved.' },
    { id: 'pack_mule',      branch: 'wheelman', tier: 1, cost: 1, name: 'Pack Mule',        desc: 'The trunk holds 3 more units.' },
    { id: 'getaway',        branch: 'wheelman', tier: 2, cost: 2, name: 'Getaway',          desc: 'Crime stints run 20% shorter.' },
    { id: 'road_captain',   branch: 'wheelman', tier: 3, cost: 3, name: 'Road Captain',     desc: 'Your convoys run 20% faster.' },
    // ── STEP TWO — TIER-4 CAPSTONES (cost 4, the tier-3 skill is the prereq → a full branch = lvl 40).
    // Each is a strong PASSIVE that stacks on its branch's signature effect AND unlocks an ACTIVE ability.
    { id: 'made_man',  branch: 'enforcer', tier: 4, cost: CAPSTONE_COST, name: 'Made Man',    desc: 'Jumps + shakedowns hit another 8% harder — and unlocks Adrenaline Rush (energy to the max).' },
    { id: 'kingpin',   branch: 'operator', tier: 4, cost: CAPSTONE_COST, name: 'Kingpin',     desc: 'Fencing + melting yield another 8% — and unlocks Moxie (nerve to the max).' },
    { id: 'road_boss', branch: 'wheelman', tier: 4, cost: CAPSTONE_COST, name: 'Road Boss',   desc: 'The trunk holds 3 more still — and unlocks Hot Wire (clears your heist + world-raid cooldowns).' },
  ],
  CAPSTONE_COST,
  ACTIVE_CD_MS: 8 * 3600 * 1000,   // shared cooldown across your unlocked ACTIVE abilities
  RESPEC_ONE_OMR: 5,               // step two: unlearn ONE skill (leaf-first) for less than a full respec
  // capstone-unlocked ACTIVE abilities (the new mechanic): resource/cooldown bursts, off every §10.4 +
  // audit-locked surface (energy/nerve are pure regen resources; heist/world cooldowns are op pacing).
  ACTIVES: [
    { id: 'adrenaline', req: 'made_man',  name: 'Adrenaline Rush', desc: 'Energy to the max — push through.' },
    { id: 'moxie',      req: 'kingpin',   name: 'Moxie',           desc: 'Nerve to the max — the guts for one more play.' },
    { id: 'hot_wire',   req: 'road_boss', name: 'Hot Wire',        desc: 'Clears your heist + world-raid cooldowns — back on the job.' },
  ],
  // ── STEP FOUR — GRANDMASTERY: the capstone-of-capstones. Owning BOTH tier-4 capstones of a pair
  // (the deepest build — two maxed branches, ~lvl 48) DERIVES a Grandmastery (no cost — the natural
  // reward) that unlocks a combined ULTIMATE active (both bursts in ONE cast, where the two single
  // actives share a cooldown so you'd otherwise pick just one) AND cuts the shared active cooldown
  // (GRANDMASTER_CD_MS < ACTIVE_CD_MS). Pure QoL/pacing on the step-two active mechanic — energy/nerve
  // are regen resources, heist/world cooldowns are op pacing → ZERO §10.4, off every audit-locked
  // surface. Derived from OWNED capstones, so the heir only gets it by re-earning both (muscle memory
  // carries tier-1 only) — no death-softening. GRANDMASTER_CD_MS = ACTIVE_CD_MS reverts the pacing edge.
  GRANDMASTER_CD_MS: 4 * 3600 * 1000,
  GRANDMASTERIES: [
    { id: 'the_boss',    reqs: ['made_man', 'kingpin'],   name: 'The Boss',
      active: { id: 'kingpins_rush', name: "Kingpin's Rush", desc: 'Energy AND nerve to the max — total command of the table.' } },
    { id: 'the_warlord', reqs: ['made_man', 'road_boss'],  name: 'The Warlord',
      active: { id: 'full_throttle', name: 'Full Throttle',  desc: 'Energy to the max AND clears your heist + world-raid cooldowns.' } },
    { id: 'the_shadow',  reqs: ['kingpin',  'road_boss'],  name: 'The Shadow',
      active: { id: 'ghost_protocol', name: 'Ghost Protocol', desc: 'Nerve to the max AND clears your heist + world-raid cooldowns.' } },
  ],
  FX: { BRUISER_MULT: 1.08, DOC_MULT: 0.75, SEARCH_MULT: 0.8, LAYLOW_MULT: 0.8,
        FENCE_MULT: 1.08, BROKER_FEE_MULT: 0.5, TRUNK_BONUS: 3, JAIL_MULT: 0.8, CONVOY_MULT: 0.8,
        // step-two capstone stacks (multiplicative on the branch signature; the prereq chain guarantees the base skill is owned)
        MADE_MAN_MULT: 1.08, KINGPIN_MULT: 1.08, ROAD_BOSS_TRUNK: 3 },
  // STEP THREE — PRESTIGE carries into the build (the deferred founder call; softens death, so a
  // SIGN-OFF lever). Skills still DIE with the street, BUT: (1) MUSCLE MEMORY — the heir is born
  // remembering up to min(MEMORY_MAX, floor(prestige/PRESTIGE_PER_SLOT)) of the deceased's FOUNDATION
  // skills (lowest tiers first, so a prefix of the tree — prereq-safe; a veteran's basics carry). (2)
  // PRESTIGE POINTS — a long-lived bloodline gets floor(prestige/PRESTIGE_PER_POINT) bonus skill points
  // (capped PRESTIGE_POINT_MAX) on top of the level-derived budget — a small head start, not a currency
  // (no §10.4 surface). MEMORY_MAX 0 / PRESTIGE_POINT_MAX 0 restores the hard "skills die" rule.
  MEMORY_MAX: 3, PRESTIGE_PER_SLOT: 8, PRESTIGE_PER_POINT: 10, PRESTIGE_POINT_MAX: 3,
};
export const activeOf = (id) => SKILLS.ACTIVES.find((a) => a.id === id) || null;
export const skillOf = (id) => SKILLS.TREE.find((s) => s.id === id) || null;
// step four — GRANDMASTERY helpers. `owned` is a Set or array of owned skill ids.
const hasSkillId = (owned, id) => (owned?.has ? owned.has(id) : (owned || []).includes(id));
export const grandmasteriesFor = (owned) => SKILLS.GRANDMASTERIES.filter((g) => g.reqs.every((r) => hasSkillId(owned, r)));
export const ultimateOf = (id) => SKILLS.GRANDMASTERIES.find((g) => g.active.id === id) || null;
export const activeCdFor = (owned) => grandmasteriesFor(owned).length ? SKILLS.GRANDMASTER_CD_MS : SKILLS.ACTIVE_CD_MS;
// THE UNDERWORLD — the named NPC cast (design: omerta-underworld-design.md). Standing 0-100
// per character per NPC, earned by doing business (actor-side bumps), gift-greasable only
// below GIFT_CAP — top tiers are EARNED. Perks are NEW single-touchpoint modifiers (the
// skills/decree precedent), deliberately off $OMR burns, ammo prices, and every audit-locked
// surface. ALL numbers are founder sign-off levers.
export const UNDERWORLD = {
  THRESHOLDS: [25, 60, 90],           // standing for tier 1 / 2 / 3
  // audit #3: a per-fixture DAILY cap on RAW actor-side bumps (the spammable ones) — the
  // once-a-day lead/streak and errand bonuses ride ON TOP, exempt (already daily-bounded). Set
  // just above the honest lead+streak+errand ceiling so real play is never clipped but scripting
  // to tier 3 in minutes is dead: 0→90 now takes days of active raw play, not a session.
  STANDING_DAILY_CAP: 25,
  GIFT_COST: 5000, GIFT_STANDING: 5, GIFT_CAP: 50,
  DISCHARGE_PER_MIN: 150,             // the Doc's early-discharge rate ($/remaining minute)
  GUN_BUYBACK: 0.3,                   // the Armorer's buy-back (share of the gun's cash price)
  // `tasks` are the daily-lead rotation (step three) — only actions a player can ALWAYS
  // repeat (no finite purchases, no luck-gated windows), so no day draws a dead lead.
  NPCS: [
    { id: 'doc',     name: 'Doc Moretti',      earn: 'heals + discharges', tasks: ['heal'],
      perks: ['House rates — healing ×0.9', 'Early discharge — pay to HALVE a hospital stay', 'Walk-outs — discharges release in full'] },
    { id: 'fixer',   name: 'Vinnie the Match', earn: 'contracts posted + NPC hits + confirmed kills', tasks: ['post', 'hire'],
      perks: ['NPC hitmen ×0.9', 'Your contract-post fee is waived (the street tax stands)', 'Your searches place ×0.9 faster'] },
    { id: 'armorer', name: 'Bella Bang-Bang',  earn: 'guns + crafts + ammo boxes', tasks: ['craft', 'ammo'],
      perks: ['Guns ×0.9 cash', 'Workshop crafts ×0.9 cash', 'She buys guns back at 30%'] },
    { id: 'harbor',  name: 'Big Tuna',         earn: 'convoys + market listings', tasks: ['depart', 'list'],
      perks: ['Guard fees ×0.9', 'Your listings run 72h', 'A fourth market listing slot'] },
    { id: 'madame',  name: 'The Madame',       earn: 'den play + back-room fades + fight bets', tasks: ['dice', 'numbers'],
      perks: ['The house comps your seat — dice cost no nerve', 'The velvet rope — the high-stakes room opens at any level',
              "Pillow talk — she tells you how many hunters have been asking around about you"] },
    { id: 'cornerman', name: 'Mickey the Corner', earn: 'signings + training + exhibitions', tasks: ['train'],
      perks: ['Gym rates — training ×0.9 cash', 'A good cutman — your fighters rest less (exhibition cooldown ×0.8)',
              'Sharper work — training builds +2 a session'] },
  ],
  FX: { DOC_MULT: 0.9, NPCHIT_MULT: 0.9, SEARCH_MULT: 0.9, GUN_MULT: 0.9, CRAFT_MULT: 0.9,
        GUARD_MULT: 0.9, TTL_H: 72, EXTRA_LISTING: 1,
        // the Cornerman (boxing step four) — all actor-local pacing/discount perks (no fight-outcome
        // tampering, no §10.4): T1 a training cash discount, T2 a shorter exhibition rest, T3 +1 build.
        CORNER_TRAIN_MULT: 0.9, CORNER_CD_MULT: 0.8, CORNER_GAIN: 1 },
  // step two (all founder sign-off levers): relationships that live — daily leads, cooling,
  // inherited memory, and one rivalry. Zero money flows; every number is a status-axis dial.
  STEP2: {
    LEAD_BONUS: 5, LEAD_MIN: 25,      // first business each day with your BEST fixture (≥25) pays +5
    DECAY_GRACE_DAYS: 7, DECAY_PER_DAY: 1, DECAY_FLOOR: 25, // idle friendships cool to tier 1, never below
    MEMORY_BPS: 2500,                 // the heir inherits 25% of each standing (floored; <1 forgotten)
    RIVAL_LOSS: 2,                    // blood work (fire-kill, NPC hire) costs the Doc's goodwill
  },
  // step three (all founder sign-off levers): the lead becomes a rotating TASK (drawn per day,
  // above), road piracy picks a side, and killing a fixture's friend burns the killer's bridge.
  STEP3: {
    GRUDGE_MIN: 60, GRUDGE_LOSS: 5,   // whack a T2+ friend of the house → that fixture docks the killer 5
    AMBUSH_ARMORER: 2, AMBUSH_HARBOR: 2, // an ambush (win or lose): Bella +2, Big Tuna −2
  },
  // step four (all founder sign-off levers): grudges get TEETH (and a way out), loyalty gets
  // a streak, and the top of a relationship finally gives something back.
  STEP4: {
    GRUDGE_TIER_CAP: 2,               // a grudged fixture still does business — but no tier-3 favors
    PENANCE_COST: 25000,              // squaring ONE grudge ($ sink, underworld:penance)
    STREAK_BONUS_CAP: 5,              // lead streak: +1/consecutive day on the +5, capped (day 6+ pays +10)
    FAVOR_WEEKLY: 1,                  // one favor a week per street, from any UN-grudged tier-3 fixture
  },
  // step five (all founder sign-off levers): time heals what money can't, storylines arrive,
  // and the Madame learns who bought her referee.
  STEP5: {
    GRUDGE_DECAY_DAYS: 14,            // one grudge forgiven per 14 days without a fresh offense
    CHAIN_STEPS: 3, CHAIN_BONUS: 15,  // the errand chain: the fixture's drawn task on 3 separate days → +15
    FIX_LOSS: 5,                      // rivalry #3: buying the fight referee costs the Madame's book its pride
  },
};
export const npcOf = (id) => UNDERWORLD.NPCS.find((n) => n.id === id) || null;
// The daily lead TASK for a fixture — deterministic off the §7.11 seed machinery, same for
// everyone (the whole town hears what the Doc needs today).
export const leadTaskOf = (day, npcId) => {
  const n = npcOf(npcId);
  if (!n?.tasks?.length) return null;
  return n.tasks[Math.floor(hash01(`lead:${day}:${npcId}:${MARKET_SEED}`) * n.tasks.length) % n.tasks.length];
};
export const BLACK_MARKET = {           // (MARKET is the generated §5 goods catalog — hands off)
  LIST_FEE_BPS: 100, LIST_FEE_MIN: 10,  // 1% of the ask (min $10) to list — prices the "free warehouse" angle
  MIN_PRICE: 50,                         // no penny listings
  MIN_RAISE_BPS: 500,                    // a new bid beats the standing one by ≥5%
  TAKE_BPS: 200,                         // 2% of the hammer: half → street tax, half burns
  MAX_TTL_H: 48,                         // listings run at most two days
  MAX_LISTINGS: 3,                       // live listings per character — orders share the cap (bounds warehouse storage + fake WTB walls)
  // step two (all founder sign-off levers):
  SNIPE_WINDOW_MS: 5 * 60 * 1000,        // a bid inside the last 5 min soft-closes: the clock resets to +5 min
  ORDER_MAX_QTY: 200,                     // audit #2: a buy-order's units are capped so the warehouse can't be unbounded off-trunk storage
};
// Risk-to-Earn Phase 3 — TERRITORY RACKETS: productive, SEIZABLE capital anchored to a district.
// Established on your own turf (cost from the treasury), income accrues to the treasury (lazy,
// capped at TERRITORY_CAP_MS so it can't hoard unboundedly), and the whole operation transfers to
// the victor when the district is seized — so families fight wars over income streams, not just a
// one-time treasury cut. New/tunable numbers — sim + founder sign-off before production.
// sim-audit F5 retune: marginal ROI now TAPERS up the ladder (t1 ~192%/day → t2 ~115% → t3 ~106%)
// instead of staying flat — max-tier-everything is no longer strictly correct, and the entry tier
// stays the hook. Founder sign-off levers, like everything on this ladder.
// The tier ladder (step two extended it 3→5, on the ROI taper — content, the car-catalog precedent:
// upgradeRacket/territoryTierOf already handle any tier, so the extension is zero-code).
// The tier ladder is the operation's SCALE (income magnitude — UNCHANGED from the sim-signed curve;
// step three only renamed the tiers to scale labels so the old racket names could move to the TYPE
// axis below). incomePerHr is the BASE — the type's incomeMult tilts it.
export const TERRITORY_RACKETS = [
  { tier: 1, name: 'Corner',        cost: 50000,    incomePerHr: 4000 },
  { tier: 2, name: 'Neighborhood',  cost: 250000,   incomePerHr: 16000 },
  { tier: 3, name: 'District',      cost: 1000000,  incomePerHr: 60000 },
  { tier: 4, name: 'Citywide',      cost: 4000000,  incomePerHr: 200000 },  // marginal ROI ~112%/day
  { tier: 5, name: 'The Syndicate', cost: 15000000, incomePerHr: 600000 },  // marginal ROI ~87%/day — the endgame operation
];
export const territoryTierOf = (tier = 0) => TERRITORY_RACKETS.find((t) => t.tier === Number(tier)) || null;
// ── STEP THREE — per-district racket TYPE: the operation's BUSINESS, chosen at establish. A real
// risk/reward choice orthogonal to scale — a hotter type earns MORE but draws Bureau crackdowns
// (scrutinyPerHr net of the decay below). numbers is the safe baseline (×1.0, never raided); the
// income mults + risk are NEW founder sign-off levers (numbers keeps parity with the signed curve).
// TIER-4 §B — the TYPE catalog 3 → 6: three more businesses on the risk/income curve (loansharking,
// chop-shop, counterfeiting — the hottest). All ride the existing incomeMult/scrutinyPerHr mechanism
// (zero territory.js code — the type is data), so it's content, not a rebalance; the income mults +
// scrutiny are NEW founder sign-off levers (numbers keeps parity with the signed curve). `syndicate`
// is the same-type meta title (Tier-4 §D).
// (AUDIT-full-product #3) Numbers LAZY-dominates: for a once-a-day collector the hot types heat past
// the raid threshold before the collect, so their higher take is eaten by crackdowns — they only win
// if you collect INSIDE their heat window. Rather than flatten the (signed) curve, each type now says
// so in its own description, so the choice at establish is informed instead of a trap.
export const TERRITORY_TYPES = [
  { id: 'numbers',        name: 'Numbers Game',       incomeMult: 1.0,  scrutinyPerHr: 0,  syndicate: 'The Numbers Syndicate',   desc: 'Bookmaking — steady and quiet. The Bureau never comes: the best type if you collect once a day.' },
  { id: 'protection',     name: 'Protection Racket',   incomeMult: 1.15, scrutinyPerHr: 10, syndicate: 'The Protection Combine',   desc: 'Muscle on the block — more take, more heat. Collect inside ~10h or the Bureau eats the gain.' },
  { id: 'loansharking',   name: 'Loansharking Book',   incomeMult: 1.20, scrutinyPerHr: 11, syndicate: 'The Shylock Ring',         desc: 'Vig on the street — good money, watched books. Needs collecting inside ~9h.' },
  { id: 'chop_shop',      name: 'Chop Shop',           incomeMult: 1.25, scrutinyPerHr: 12, syndicate: 'The Chop Cartel',          desc: 'Stolen iron parted out — fast cash, hot plates. Needs collecting inside ~8h.' },
  { id: 'smuggling',      name: 'Smuggling Ring',      incomeMult: 1.35, scrutinyPerHr: 14, syndicate: 'The Smuggling Syndicate',   desc: 'Contraband moves big money — and brings the Feds. Needs collecting inside ~7h.' },
  { id: 'counterfeiting', name: 'Counterfeiting Plant', incomeMult: 1.45, scrutinyPerHr: 18, syndicate: 'The Forgers Guild',        desc: 'Printing money is the biggest take — and the biggest heat. Needs collecting inside ~5h.' },
];
export const territoryTypeOf = (id) => TERRITORY_TYPES.find((t) => t.id === id) || TERRITORY_TYPES[0];
// TIER-4 §D — THE SYNDICATE: a family running ≥ TERRITORY_SYNDICATE_MIN operations of ONE type earns
// that type's syndicate title (pure STATUS — specialization prestige, no §10.4/income change; the
// Empire precedent). syndicateOf reads the family's held rackets and returns the dominant type if it
// clears the floor (ties → the higher-income type, so the deepest specialization wins).
export const TERRITORY_SYNDICATE_MIN = 3;
export const syndicateOf = (rackets = []) => {
  const by = {};
  for (const r of rackets) by[r.kind] = (by[r.kind] || 0) + 1;
  let best = null;
  for (const [kind, n] of Object.entries(by)) {
    if (n < TERRITORY_SYNDICATE_MIN) continue;
    const t = territoryTypeOf(kind);
    if (!best || n > best.count || (n === best.count && t.incomeMult > best.incomeMult))
      best = { kind, count: n, name: t.syndicate, incomeMult: t.incomeMult };
  }
  return best ? { kind: best.kind, count: best.count, name: best.name } : null;
};
// THE EMPIRE (step two) — a gang-level status axis off lifetime territory income (dies with the family).
// Pure status: no §10.4 surface (the income still rides territory:income; this is a separate counter).
export const TERRITORY_RANKS = [
  { min: 0, name: 'Corner Crew' }, { min: 1000000, name: 'Neighborhood Outfit' }, { min: 10000000, name: 'Borough Power' },
  { min: 100000000, name: 'City Syndicate' }, { min: 500000000, name: 'The Cosa Nostra' },
];
export const territoryRankOf = (earned) =>
  [...TERRITORY_RANKS].reverse().find((r) => Number(earned) >= r.min) || TERRITORY_RANKS[0];
// cumulative build cost of an operation at `tier` — the basis for the seizure war premium
export const territoryBuildCost = (tier = 0) =>
  TERRITORY_RACKETS.filter((t) => t.tier <= Number(tier)).reduce((a, t) => a + t.cost, 0);
// STEP FOUR — the treasury cost to raise a racket's fortitude to `level` (climbs with the level and
// the operation's tier — a bigger, more valuable op costs more to defend). Founder sign-off lever.
export const territoryFortCost = (level, tier = 1) =>
  Math.floor(CONSTANTS.TERRITORY_FORT_COST_BASE * (Number(level) + 1) * Number(tier));
// Business Empire — the PREMIUM, acquired-later personal front layer (distinct from the flat
// mid-game ASSETS/RACKETS). Each kind is level-gated ("acquired later"), with a tier ladder:
//   cost          — cash to BUY tier 1 / UPGRADE to the next tier
//   incomePerHr   — lazy cash income (→ pocket, capped at BUSINESS_CAP_MS between collects)
//   launderCapDay — private cash→$OMR laundering capacity per 24h window at this tier
// A bigger, higher-tier empire = more passive cash AND more (safer) extraction throughput — the
// endgame engine of the Risk-to-Earn loop. Numbers are proposed defaults — sim + founder sign-off
// before production (ground rule #1). Step-two scrutiny/raid/extortion risk is deferred by design.
export const BUSINESSES = [
  { kind: 'laundromat', name: 'Laundromat', lvl: 15, tiers: [
    { tier: 1, cost: 250000,   incomePerHr: 12000,  launderCapDay: 20000 },
    { tier: 2, cost: 600000,   incomePerHr: 28000,  launderCapDay: 50000 },
    { tier: 3, cost: 1500000,  incomePerHr: 65000,  launderCapDay: 120000 },
  ] },
  { kind: 'restaurant', name: 'Restaurant', lvl: 22, tiers: [
    { tier: 1, cost: 500000,   incomePerHr: 22000,  launderCapDay: 40000 },
    { tier: 2, cost: 1200000,  incomePerHr: 52000,  launderCapDay: 95000 },
    { tier: 3, cost: 3000000,  incomePerHr: 125000, launderCapDay: 230000 },
  ] },
  { kind: 'nightclub', name: 'Nightclub', lvl: 30, tiers: [
    { tier: 1, cost: 1200000,  incomePerHr: 48000,  launderCapDay: 90000 },
    { tier: 2, cost: 2800000,  incomePerHr: 110000, launderCapDay: 210000 },
    { tier: 3, cost: 6500000,  incomePerHr: 260000, launderCapDay: 480000 },
  ] },
  // L1a — FLATTEN THE TOP FRONT CURVE (stakes/spine review #1, founder-directed): the two apex fronts
  // (hotel lvl42 / casino lvl58) had incomePerHr ×0.5'd at EVERY tier — they dominated the measured
  // ~$49M/day passive stack (P9.20). Late-game only (lvl42+), so the on-ramp fronts (laundro/restaurant/
  // nightclub) are untouched; tier progression stays monotonic (same ×0.5 across each ladder). launderCap
  // is a separate laundering-throughput lever (unchanged). Sim-re-measured; a sign-off lever.
  { kind: 'hotel', name: 'Hotel', lvl: 42, tiers: [
    { tier: 1, cost: 3000000,  incomePerHr: 55000,  launderCapDay: 200000 },
    { tier: 2, cost: 7000000,  incomePerHr: 128000, launderCapDay: 460000 },
    { tier: 3, cost: 16000000, incomePerHr: 300000, launderCapDay: 1050000 },
  ] },
  { kind: 'casino', name: 'Casino', lvl: 58, tiers: [
    { tier: 1, cost: 8000000,  incomePerHr: 140000, launderCapDay: 500000 },
    { tier: 2, cost: 18000000, incomePerHr: 320000, launderCapDay: 1150000 },
    { tier: 3, cost: 40000000, incomePerHr: 750000, launderCapDay: 2600000 },
  ] },
];
export const businessOf = (kind) => BUSINESSES.find((b) => b.kind === kind) || null;
export const businessTierOf = (kind, tier = 1) => businessOf(kind)?.tiers.find((t) => t.tier === Number(tier)) || null;
export const businessMaxTier = (kind) => businessOf(kind)?.tiers.length || 0;

// ── BUSINESS EMPIRE Tier-4 — the backer/legend/PvP-endgame layer over the premium fronts. ALL founder
// sign-off levers (the RACKET_EMPIRE precedent). Status axes move ZERO §10.4 currency; the specialize burn
// is deflationary $OMR (business:spec); the takeover fee is a cash sink + the buyout a taxed transfer.
export const BUSINESS_EMPIRE = {
  // THE LAUNDERER legend — lifetime cash washed through OWN fronts (survives death). Scaled to endgame
  // wash throughput (~0.5M–2.6M/day/front); thresholds cosmetic.
  LAUNDERER_RANKS: [
    { at: 0, name: 'Bagman' }, { at: 1_000_000, name: 'The Washman' }, { at: 20_000_000, name: 'The Rinse Cycle' },
    { at: 200_000_000, name: 'The Cleaner' }, { at: 2_000_000_000, name: 'The Bleach King' }, { at: 20_000_000_000, name: 'The Holy See' },
  ],
  SPEC_OMR: 40, // $OMR burned to specialize / re-specialize a MAX-TIER front (deflationary sink)
  SPECS: {
    accountant: { name: 'The Accountant', scrutinyMult: 0.5 },  // washing draws half the Bureau's eye
    fortress: { name: 'The Fortress', defBonus: 40 },           // a hostile takeover defends +40
    fixer: { name: 'The Fixer', fineMult: 0.5, decayMult: 2 },  // a raid fine halved + scrutiny cools 2×
  },
  SET_FRONTMAN: 'The Front Man',   // own all 5 kinds (read-derived completion title)
  SET_MOGUL: 'The Mogul',          // own all 5 at max tier
  TAKEOVER: { FEE: 500_000, CD_MS: 24 * 3600 * 1000, HEAT: 12, MIN_LEVEL: 20, BASE_P: 0.4, MIN_P: 0.1, MAX_P: 0.85, STAT_SCALE: 120 },
};
export const launderRankOf = (v) => {
  let r = BUSINESS_EMPIRE.LAUNDERER_RANKS[0];
  for (const t of BUSINESS_EMPIRE.LAUNDERER_RANKS) if (Number(v || 0) >= t.at) r = t; return r;
};
// read-derived completion titles from the CURRENT holdings (the empireTitles precedent, zero ledger)
export const frontTitles = (businesses = []) => {
  const kinds = new Set(businesses.map((b) => b.kind));
  const titles = [];
  if (kinds.size >= BUSINESSES.length) titles.push(BUSINESS_EMPIRE.SET_FRONTMAN);
  if (BUSINESSES.every((b) => businesses.some((x) => x.kind === b.kind && Number(x.tier) >= businessMaxTier(b.kind)))) titles.push(BUSINESS_EMPIRE.SET_MOGUL);
  return titles;
};
// the assessed build value of a front = Σ tier.cost for tiers 1..tier (the speakeasy assessedValueOf pattern)
export const businessAssessedValue = (kind, tier) => {
  const b = businessOf(kind); if (!b) return 0;
  return b.tiers.filter((t) => t.tier <= Number(tier)).reduce((a, t) => a + t.cost, 0);
};
// M7 Phase 2 — the feared-assassin rank ladder (thresholds on lifetime hitman_rep).
export const HITMAN_RANKS = [
  { at: 0, title: 'Associate' },      // hasn't made his bones yet
  { at: 50, title: 'Button Man' },
  { at: 250, title: 'Mechanic' },
  { at: 1000, title: 'Ghost' },
  { at: 5000, title: 'The Undertaker' },
];
export const hitmanRankOf = (rep = 0) => { let r = HITMAN_RANKS[0]; for (const h of HITMAN_RANKS) if (rep >= h.at) r = h; return r; };
// M7 Phase 3 — NPC hitmen for hire (fixed fee → a rolled attempt; the fee is a §10.4 sink).
export const NPC_HITMEN = [
  { id: 'legbreaker', name: 'Leg-Breaker', cost: 50000, base: 0.25, desc: 'Cheap muscle. More enthusiasm than aim.' },
  { id: 'journeyman', name: 'Journeyman', cost: 250000, base: 0.40, desc: 'Does clean work, most of the time.' },
  { id: 'professional', name: 'The Professional', cost: 1000000, base: 0.55, desc: 'Expensive. Worth it. Ask around — you can\'t.' },
];
export const npcHitmanOf = (id) => NPC_HITMEN.find((n) => n.id === id);

// ── R1 — THE PORTFOLIO ("going legit"): the RWA / blue-chip holdings layer ──
// The narrative apex of the laundering arc — clean $OMR → legitimate, death-proof equity. PURE
// STATUS in R1 (no sell, no cash-out): a ticker-denominated collectible that survives the street
// (account-level, like prestige), OUTSIDE §10.4 on the reward side and outside the sim-audited
// balance (the hitman-rep / family-seal precedent — shares are not currency; their $ display is
// cosmetic; the price moves no value). The ONLY §10.4 flow is the enumerated 'rwa:invest' $OMR BURN
// (the vanity/cleanpapers till). R2 backs the shares with a real RWA reserve; R3 opens the KYC'd
// on-chain extraction — both legal-gated (Robinhood partnership + securities counsel). R1 touches
// NO securities. Tickers are flavored to districts (fiction only). base = the day-0 display floor;
// drift = the ± band the daily seed hash swings it. ALL numbers are founder sign-off levers.
export const PORTFOLIO = {
  MIN_INVEST_OMR: 1, // no dust buys
  // The board — a spread from a safe store of value (GLD, drift .05) to a volatile meme-stock (GME,
  // drift .30). Every ticker id is a REAL Robinhood tokenized stock trading on Uniswap (Robinhood
  // Chain / Arbitrum) — so R2/R3 map each 1:1 to an actual on-chain token (see the RWA design doc).
  // BTC was dropped (crypto, not a tokenized STOCK); SPCX (SpaceX private-co token) + GLD (an ETF) are
  // the two to VERIFY against the live catalog — private-company tokens + ETFs are the uncertain edge.
  // All DISPLAY-ONLY status collectibles (deterministic seed price, no sell, no cash-out — the R1
  // regulatory line). Names are lightly fictionalised (the AAPL→"Atlas Apple" house style). New
  // tickers are drop-in — the board/leaderboard/view iterate TICKERS generically. Sign-off levers.
  TICKERS: [
    { id: 'GLD',  name: 'The Vault',           base: 190, drift: 0.05, blurb: 'Bricks of gold in a hole in the ground. When the city burns, this holds.' },
    { id: 'AAPL', name: 'Atlas Apple',         base: 220, drift: 0.06, blurb: 'Old money. The tech district washes clean here.' },
    { id: 'AMZN', name: 'The Everything Store', base: 175, drift: 0.10, blurb: 'They deliver. Everything. Everywhere. Nobody asks what.' },
    { id: 'TSLA', name: 'Tesla Motors',        base: 250, drift: 0.14, blurb: 'The docks and the wheelmen buy the cars.' },
    { id: 'HOOD', name: 'The Green House',     base: 90,  drift: 0.16, blurb: 'The house that lets everybody play. You take a piece of the action.' },
    { id: 'NVDA', name: 'Nero Graphics',       base: 300, drift: 0.18, blurb: 'The chip runners. The whole city wants what they make.' },
    { id: 'SPCX', name: 'SpaceX',              base: 180, drift: 0.22, blurb: 'The moonshot. High risk, high status.' },
    { id: 'GME',  name: 'The Arcade',          base: 25,  drift: 0.30, blurb: 'The people’s revolt — squeeze the shorts, crown the degens.' },
  ],
  // THE DYNASTY — your account-level book survives death (the heir inherits), so it IS a generational
  // fund. Name it (a $OMR vanity sink, ledgered under the existing rwa:% burn term — zero invariant
  // changes): the name outlives every character and heads the legit-legend leaderboard.
  DYNASTY_NAME_OMR: 5,
  // R1 STEP TWO — EARNED exposure (never by chance; each is a deterministic cut of a realized win,
  // a skill-ranked season prize, or a purchase that draws heat — so the R3 "never distribute
  // securities by chance" rule is respected by construction). Grants are $OMR-WORTH denominated
  // (shares = omrWorth / price, the invest formula) with cost basis 0 — a free legit kickback.
  // (1) the BIG-SCORE CUT: a completed standard heist parks a legit sliver for every crewman,
  // scaled by the crew's standing (avg level) — the family accountant washes a cut of the score.
  SCORE_CUT_PER_LVL: 2, SCORE_TICKER: 'AAPL',
  // (2) the SEASON PRIZE: at rollover the top season grinders (by respect, before the reset) earn
  // the champion's moonshot — a skill-ranked status prize (omrWorth by rank 1..N).
  SEASON_PRIZES: [500, 250, 100], SEASON_TICKER: 'SPCX',
  // (3) the RICO GRADUATION: a BIG legit move is the classic laundering red flag — it draws heat
  // (the launder-heat precedent) and can't be done from a safehouse (P1.3 — hiding, not moving
  // money). "Big" is CUMULATIVE over a rolling window (the D3 wash-bucket precedent), so STRUCTURING
  // — many sub-threshold buys — still trips it once the window sum crosses SCRUTINY_MIN_OMR. Ties RWA
  // to the Law. (audit F1: a per-call-only threshold was trivially dodged by investing 999 on repeat.)
  SCRUTINY_MIN_OMR: 1000, SCRUTINY_HEAT: 12, SCRUTINY_WINDOW_MS: 24 * 3600 * 1000,
  // ── THE DYNASTY FUND (dividends + tiers) — RWA becomes a PRODUCTIVE, generational asset. A slice of
  // every personal invest (DIVIDEND_BPS) feeds the rwa_dividend_pool (a §10.4 transfer, not a burn);
  // holders claim a ~daily dividend = DIVIDEND_DAILY_BPS of their book value, POOL-BOUNDED (the
  // stake-pool "backed emission" rule — never mints, so the fund pays only what investment funds it).
  // So spenders (investors) fund holders' yield: new capital pays the dividend, like a real fund. TIERS
  // are pure STATUS on cumulative $OMR invested (the estate/seal precedent — outside §10.4). All levers.
  FAMILY_DYNASTY_NAME_OMR: 15,   // name the FAMILY fund from the reserve (boss/underboss; rwa:dynasty burn)
  DIVIDEND_BPS: 1500,            // 15% of each personal invest → the dividend pool (85% still burns)
  DIVIDEND_DAILY_BPS: 30,        // a claim pays 0.30% of book value, capped by the pool
  DIVIDEND_MS: 20 * 3600 * 1000, // the ~daily claim cooldown (DIVIDEND_MS test knob? no — fixed lever)
  DYNASTY_TIERS: [
    { tier: 1, name: 'Nest Egg', min: 100 },
    { tier: 2, name: 'Trust Fund', min: 500 },
    { tier: 3, name: 'Blue Blood', min: 2500 },
    { tier: 4, name: 'Old Money', min: 10000 },
    { tier: 5, name: 'The Dynasty', min: 50000 },
  ],
};
// the status tier for a given cumulative $OMR invested (highest tier whose floor you've crossed)
export const dynastyTierOf = (invested = 0) => {
  const n = Number(invested || 0); let cur = null;
  for (const t of PORTFOLIO.DYNASTY_TIERS) if (n >= t.min) cur = t;
  return cur;
};
// ── THE FLOAT (omerta-rwa-float-design.md) — the full-reserve RWA layer. The founder-approved
// redesign of R2: OMR never CONVERTS to stock (a burn funds nothing); ETH tax slices fund a buy-bot
// reserve of REAL tokenized stocks (units held in the Safe on mainnet; chain-dormant here), and
// players burn earned $OMR to CLAIM allocation from that float at the REAL oracle price —
// $OMR is the rationing ticket, ETH the funding. allocated ≤ held BY CONSTRUCTION (the bond
// anti-Ponzi cap / full-reserve-queue discipline, in UNITS so price moves can't create shortfall).
// The legacy hash-priced book stays as the PAPER tier (pure status). ALL numbers sign-off levers.
export const RWA_FLOAT = {
  FEE_RWA_BPS: () => Number(process.env.FEE_RWA_BPS ?? 1000), // 10% of gameplay fees → rwa_revenue (carved from the founder share; Vig 60% untouched). Read per-call (the RATE_LIMIT precedent).
  CLAIM_MIN_OMR: 5,              // smallest vault claim
  CLAIM_DAILY_OMR: 500,          // per-account rolling-24h claim cap (the D3 wash-bucket pattern) — no float-sweeping
  CLAIM_WINDOW_MS: 24 * 3600 * 1000,
};
// AUDIT F5 — fail fast on a misconfigured fee split: the Vig slice (vig.js, env VIG_BPS default
// 6000) + the RWA slice book each real fee into TWO independently-capped revenue buckets; if they
// summed past 100%, combined ETH spend could exceed ETH received while BOTH per-bucket
// `spend ≤ revenue` invariants stayed green (the BONDS/STORE load-time sum-validation precedent).
{
  const vig = Number(process.env.VIG_BPS || 6000), rwa = RWA_FLOAT.FEE_RWA_BPS();
  if (vig + rwa > 10000)
    throw new Error(`VIG_BPS (${vig}) + FEE_RWA_BPS (${rwa}) exceed 10000 — the fee split would book >100% of each real payment as spendable revenue.`);
}
// ── THE WIRE — the intelligence terminal (design omerta-the-wire-and-revenue-design.md) ──
// Information as a spendable resource. WIRETAPS (a $OMR sink, intel:wiretap) surveil a rival for a
// window — their Law heat, wealth/ops, and whether they're hunting you. SWEEP (intel:sweep) clears
// taps on you. The STREET WIRE (a recurring $OMR subscription, intel:wire) upgrades the feed into an
// intelligence service (forecasts, threat chatter, the ticker tape, the war room). All numbers are
// founder sign-off levers; every burn rides the existing intel:* omr vocabulary (zero invariant changes).
export const WIRE = {
  TAP_OMR: 8, TAP_MS: 12 * 3600 * 1000, TAP_MAX: 5, // place a wire: cost, window, concurrent cap
  SWEEP_OMR: 5,                                     // sweep your lines clean of bugs
  SUB_OMR: 12, SUB_MS: 7 * 24 * 3600 * 1000,        // the Street Wire premium feed: cost, window (== SUB_TIERS[0], kept for back-compat)
  // ── STEP FIVE — the TIERED SUBSCRIPTION ladder + the STANDING WATCH automation (all $OMR sinks via the
  // intel: vocabulary — ZERO invariant changes). The flat Street Wire becomes a ladder: a higher tier
  // costs more $OMR (a bigger intel:wire burn), unlocks more of the premium feed (the war room), and —
  // the headline — grants STANDING-WATCH slots: the worker AUTO-RENEWS a tap on an enrolled mark (burning
  // intel:watch from your $OMR each cycle, bounded by your balance + the tier's slots), so surveillance
  // runs while you're offline without manual re-tapping. The watch pauses if the sub lapses or you go
  // broke (the taps lapse naturally). All access/status/pacing — no new bucket, no faucet. Sign-off levers.
  SUB_TIERS: [
    { tier: 1, name: 'Street Wire',    omr: 12, ms: 7 * 24 * 3600 * 1000, watchSlots: 0, warRoom: false }, // the feed: forecast + threats + tape
    { tier: 2, name: 'The Wire Room',  omr: 30, ms: 7 * 24 * 3600 * 1000, watchSlots: 2, warRoom: true },  // + the war room + 2 standing watches
    { tier: 3, name: 'The Switchboard',omr: 60, ms: 7 * 24 * 3600 * 1000, watchSlots: 5, warRoom: true },  // + 5 standing watches
  ],
  // ── STEP TWO (all $OMR sinks through the intel: vocabulary — ZERO invariant changes; + a status axis) ──
  TRACE_OMR: 15,                                    // THE BUG TRACE — sweep NAMES the watchers (counter-intel); free when clean
  DOSSIER_OMR: 20,                                  // THE DOSSIER — a one-shot deep read (kills/flags/role/who-they-tap; NO exact cash — banding holds)
  // THE SPYMASTER — a lifetime intel-ops status axis (account-level, survives death — the war-effort
  // precedent). Pure status: a count of intel actions run, ranked. No §10.4 surface.
  // STEP FOUR — THE TRADECRAFT: the SPY_RANKS ladder now grants PERKS (the earned status axis finally
  // gives power — the Underworld-tier / skills precedent; a single-touchpoint modifier off §10.4, the
  // discounted amount is what's ledgered). `tapBonus` = extra concurrent WIRE slots; `discountBps` =
  // cost off every offensive intel READ (tap/informant/dossier). Cumulative at your rank. Sign-off levers.
  SPY_RANKS: [
    { min: 0, name: 'Eavesdropper', tapBonus: 0, discountBps: 0 },
    { min: 25, name: 'Wireman', tapBonus: 1, discountBps: 500 },
    { min: 100, name: 'Spymaster', tapBonus: 2, discountBps: 1000 },
    { min: 400, name: 'The Listener', tapBonus: 3, discountBps: 2000 },
    { min: 1500, name: 'The Oracle', tapBonus: 5, discountBps: 3000 },
  ],
  // ── STEP THREE — the counter-intel triad (all $OMR sinks via the intel: vocabulary — ZERO invariant
  // changes). A rock-paper-scissors: a cheap WIRETAP is machine surveillance → foiled by DISINFORMATION;
  // an expensive INFORMANT is a HUMAN source → sees THROUGH the disinfo (a mole can't be fed lies). ──
  DISINFO_OMR: 10, DISINFO_MS: 12 * 3600 * 1000,   // plant false intel: any WIRETAP reading you gets cooked private signals for a window
  INFORMANT_OMR: 25, INFORMANT_MS: 7 * 24 * 3600 * 1000, INFORMANT_MAX: 3, // a standing HUMAN source: recurring retainer, deeper read, pierces disinfo
};
export const disinfoActive = (ch, now = Date.now()) => !!ch.disinfo_until && new Date(ch.disinfo_until).getTime() > now;
export const spyRankOf = (ops) =>
  [...WIRE.SPY_RANKS].reverse().find((r) => Number(ops) >= r.min) || WIRE.SPY_RANKS[0];
// STEP FOUR — the tradecraft perks at your spymaster rank (extra wire slots + an intel-read discount)
export const spyPerksOf = (ops) => { const r = spyRankOf(ops); return { tapBonus: r.tapBonus || 0, discountBps: r.discountBps || 0 }; };
// the discounted cost of an intel read at your rank (the discounted amount is what's ledgered)
export const intelCost = (base, ops) => Math.max(1, Math.floor(Number(base) * (1 - (spyPerksOf(ops).discountBps / 10000))));
export const wireActive = (ch, now = Date.now()) => !!ch.wire_until && new Date(ch.wire_until).getTime() > now;
// STEP FIVE — your active subscription TIER (0 = lapsed/none), and the tier config lookup
export const wireTierOf = (ch, now = Date.now()) => (wireActive(ch, now) ? Math.max(1, Number(ch.wire_tier) || 1) : 0);
export const wireSubTier = (tier) => WIRE.SUB_TIERS.find((t) => t.tier === Number(tier)) || WIRE.SUB_TIERS[0];

// ── THE STORE (ETH revenue packages) — real-money purchases that grant ONLY non-§10.4 things
// (entitlements / access windows / status), so §10.4 is untouched by construction (design
// omerta-eth-store-design.md). Each SKU's ETH price is enforced ON-CHAIN by the OmertaFees tollbooth
// (dormant); the backend records the payment (three-way revenue split) + grants the entitlement.
// `grant` is a spec the backend applies: mintCredits/respawnTokens ADD; wireDays/passDays EXTEND;
// patron SETS true. All numbers are founder sign-off levers. NB anti-pay-to-win: nothing here grants
// cash / $OMR / gear / sim-audited power — only convenience, access, consumables, and status.
export const STORE = {
  // the founder's three-way revenue split (must sum to 10000): founder profit / $OMR buyback
  // flywheel / RWA reserve (R2, dormant). Env-overridable; validated at module load.
  SPLIT_BPS: {
    founder: Number(process.env.REVENUE_FOUNDER_BPS || 4000),
    buyback: Number(process.env.REVENUE_BUYBACK_BPS || 4000),
    rwa: Number(process.env.REVENUE_RWA_BPS || 2000),
  },
  PACKAGES: [
    { sku: 'made_man', name: 'Made Man', priceEth: 0.01, grant: { mintCredits: 1 },
      blurb: 'Get made — a mint credit unlocks on-chain extraction (withdraw $OMR, take gear).' },
    { sku: 'revive_3', name: 'Revive Bundle (3)', priceEth: 0.25, grant: { respawnTokens: 3 },
      blurb: 'Three pre-paid revives — a killing blow is absorbed, you keep everything.' },
    { sku: 'revive_5', name: 'Revive Bundle (5)', priceEth: 0.40, grant: { respawnTokens: 5 },
      blurb: 'Five pre-paid revives, the bulk rate.' },
    { sku: 'wire_month', name: 'The Street Wire (30d)', priceEth: 0.03, grant: { wireDays: 30 },
      blurb: 'A month on the premium intelligence feed — forecasts, threat chatter, the war room.' },
    { sku: 'season_pass', name: 'The Ledger (Season Pass)', priceEth: 0.05,
      grant: { passDays: 30, respawnTokens: 2, patron: true },
      blurb: 'A month as a made patron — the badge, two revives, and the season track.' },
    { sku: 'patron', name: "Patron's Ring", priceEth: 0.10, grant: { patron: true },
      blurb: 'A permanent patron badge — a quiet flex on every screen you appear.' },
    // ── the Speakeasy COSMETIC DECOR tier (step three) — an account-level style unlock (survives death),
    // applied to your club (display-only, zero gameplay). Payable in ETH (dormant paywall) or PLEX ($OMR).
    { sku: 'decor_deco', name: 'Art Deco Decor', priceEth: 0.02, grant: { cosmetic: 'deco' },
      blurb: 'A sunburst-and-chrome Art Deco fit-out for your club — pure style, no power.' },
    { sku: 'decor_gilded', name: 'Gilded Age Decor', priceEth: 0.04, grant: { cosmetic: 'gilded' },
      blurb: 'Gold leaf and crystal — the Gilded Age look. A cosmetic skin for the house.' },
    { sku: 'decor_midnight', name: 'Midnight Velvet Decor', priceEth: 0.06, grant: { cosmetic: 'midnight' },
      blurb: 'Deep velvet and low light — the Midnight room. Cosmetic only.' },
  ],
};
// PLEX-for-packages: pay a Store SKU's fee from EARNED $OMR instead of ETH (the EVE "pay your rent in
// ISK" path — ETH payers fund the Vig, $OMR payers BURN supply; both get the same entitlement). Price =
// max(floor, feeEth × latest-buyback-oracle × premium) — market-linked like the vig PLEX, with a static
// $OMR-per-ETH floor before the market prints a price. Sign-off levers.
STORE.PLEX_FLOOR_OMR_PER_ETH = Number(process.env.STORE_PLEX_FLOOR || 5000); // 0.01 ETH → 50 $OMR floor
STORE.PLEX_PREMIUM_BPS = Number(process.env.STORE_PLEX_PREMIUM_BPS || 12000); // 1.2× the ETH-equivalent
export const packageOf = (sku) => STORE.PACKAGES.find((p) => p.sku === sku) || null;
export const passActive = (a, now = Date.now()) => !!a?.pass_until && new Date(a.pass_until).getTime() > now;

// ── THE PATRON PROGRAM (Store Tier-4) — the off-chain backer-prestige ladder over the Store. patron_spent
// is a lifetime ETH-equivalent contribution meter (bumped only on REAL contributions — a txHash'd ETH
// purchase or a PLEX burn — the txHash-gate precedent, so a comp can't fabricate a top benefactor). PURE
// STATUS: no new §10.4 reason (the PLEX discount rides the EXISTING plex:% burn — a smaller sink, no mint).
// plexDiscountBps SHIPS AT 0 (pure status); the armed values are the one flagged sign-off lever. All numbers
// are founder sign-off levers (cosmetic-axis, the family-seal/hitman-rep precedent).
export const PATRON = {
  TIERS: [
    { name: 'Friend', minEth: 0, plexDiscountBps: 0 },
    { name: 'Associate', minEth: 0.05, plexDiscountBps: 0 },
    { name: 'Benefactor', minEth: 0.25, plexDiscountBps: 0 },
    { name: 'Patron', minEth: 1.0, plexDiscountBps: 0 },
    { name: 'Grand Patron', minEth: 5.0, plexDiscountBps: 0 },
    { name: "The Family's Patron", minEth: 20.0, plexDiscountBps: 0 },
  ],
};
export const patronTierOf = (spentEth) => {
  let t = 0; for (let i = 0; i < PATRON.TIERS.length; i++) if (Number(spentEth || 0) >= PATRON.TIERS[i].minEth) t = i; return t;
};
export const patronTierName = (s) => PATRON.TIERS[patronTierOf(s)].name;

// ── THE RESERVE BOND (omerta-reserve-bond-design.md) — Protocol-Owned Liquidity via a budgeted treasury
// bond (Olympus Pro, disciplined: a SALE of budgeted treasury OMR, NEVER a mint; real-value/out-of-band, so
// §10.4 is untouched). The bonder deposits ETH → gets discounted OMR vested; the ETH deepens the pool (POL)
// + feeds the Vig. Bounded by the tranche capacity. Chain layer DORMANT (mainnet-gated). Sign-off levers.
export const BONDS = {
  DISCOUNT_BPS: Number(process.env.BOND_DISCOUNT_BPS || 800),   // 8% bonus OMR (the incentive)
  MAX_DISCOUNT_BPS: 2000,                                       // 20% hard cap (a rogue-discount backstop)
  VEST_HOURS: Number(process.env.BOND_VEST_HOURS || 120),      // 5-day linear vest (the Olympus default)
  // ── THE FOUR-WAY ETH SPLIT (tokenomics v2 §4/§6, step 3) ──────────────────────────────────
  // v2 gave bond ETH a fourth destination: the STOCK FLOAT. Bond ETH is PRIMARY inflow — it arrives
  // whether or not anyone is trading — so it is what keeps the float growing when DEX volume is thin,
  // and a quiet market is exactly what the one-way conversion produces (gameplay no longer makes
  // sellers). The design calls this "the single largest gap in the original proposal".
  //
  // RWA 2500 and DEV 1500 are the design's own numbers, taken as written. The design's table then
  // puts the whole remaining 6000 in LP and shows no Vig slice at all — but the sentence directly
  // under that table names `BONDS.POL/VIG/DEV_BPS`, so the omission reads as an oversight rather than
  // a decision, and taking it literally would DEFUND the withdrawal reserve (`vig_revenue` →
  // runVigBuyback → fundReserve → the full-reserve queue), which in v2 is the only real-value exit a
  // player has. So the remaining 6000 keeps the signed 5:3 POL:VIG relationship instead of zeroing
  // one side of it. FOUNDER CALL, flagged in BALANCE.md — if the Vig slice really is meant to go, it
  // is one env var (BOND_POL_BPS=6000 BOND_VIG_BPS=0), and the load-time sum check keeps it honest.
  POL_BPS: Number(process.env.BOND_POL_BPS || 3750),           // 37.5% of bonded ETH → Protocol-Owned Liquidity
  VIG_BPS: Number(process.env.BOND_VIG_BPS || 2250),           // 22.5% → the Vig buyback (reserve + prizes)
  RWA_BPS: Number(process.env.BOND_RWA_BPS || 2500),           // 25% → the stock float (v2 §6 — primary inflow)
  DEV_BPS: Number(process.env.BOND_DEV_BPS || 1500),           // 15% → the dev wallet (founder revenue). sum 10000
  MIN_PRINCIPAL_ETH: 0.01,
};
// the discounted OMR a bond pays: principal's market OMR value, scaled UP by the discount (cheaper OMR)
export const bondPayout = (principalEth, price, discountBps) =>
  Math.round((Number(principalEth) * Number(price) / (1 - Number(discountBps) / 10000)) * 1e6) / 1e6;
// validate the ETH split sums to 10000 at load (a misconfig would mis-route real revenue)
(() => { const t = BONDS.POL_BPS + BONDS.VIG_BPS + BONDS.RWA_BPS + BONDS.DEV_BPS;
  if (t !== 10000) throw new Error(`BOND POL_BPS + VIG_BPS + RWA_BPS + DEV_BPS must sum to 10000 (got ${t})`); })();

// ── THE DEX SELL TAX (tokenomics v2 §5) — the OTHER float source ────────────────────────────────
// `OMR.sol` already taxes transfers INTO registered AMM pairs (sell-only; buys and wallet→wallet stay
// 1:1; hard-capped at MAX_SELL_TAX_BPS 1000; off until the Safe arms it). v2 sets the rate at 9% and
// splits it THREE ways instead of the contract's current 50/50 dev/buyback. These constants are the
// single source of truth BOTH layers read — the same discipline OmertaBond's immutable `polBps` has
// with BONDS.POL_BPS — so the contract change (step 4) and this accounting can't silently diverge.
//
// Why sell-only, and no buy tax: a 10/10 is a 19% round trip, which kills price discovery, and taxing
// entry taxes the money you most want to arrive. Bond ETH already captures 100% of primary inflow.
//
// DORMANT until step 4 arms the contract and a `SellTaxTaken` watcher records episodes; the ingest
// (`recordSellTax`) and the mod/QA seat exist now so the accounting is testable ahead of the chain.
export const SELL_TAX = {
  BPS: Number(process.env.SELL_TAX_BPS || 900),                // 9% on a sell (contract cap: 1000)
  DEV_BPS: Number(process.env.SELL_TAX_DEV_BPS || 200),        // 2% of the trade → founder revenue
  RWA_BPS: Number(process.env.SELL_TAX_RWA_BPS || 400),        // 4% → the stock float
  LP_BPS: Number(process.env.SELL_TAX_LP_BPS || 300),          // 3% → LP depth / buybacks. the three sum to BPS
  MAX_BPS: 1000,                                               // OMR.sol's MAX_SELL_TAX_BPS — kept in lockstep
};
(() => { const t = SELL_TAX.DEV_BPS + SELL_TAX.RWA_BPS + SELL_TAX.LP_BPS;
  if (t !== SELL_TAX.BPS) throw new Error(`SELL_TAX DEV+RWA+LP must sum to BPS ${SELL_TAX.BPS} (got ${t})`);
  if (SELL_TAX.BPS > SELL_TAX.MAX_BPS) throw new Error(`SELL_TAX.BPS ${SELL_TAX.BPS} exceeds the contract cap ${SELL_TAX.MAX_BPS}`); })();

// ── THE UNDERWRITER — the off-chain backer-prestige pillar layered over the chain bond. Purely
// STATUS + $OMR sinks (zero new faucet, zero chain touch). The UNDERWRITER SCORE combines the
// real-ETH axis (bonded_eth, read-derived from the bonds table) with an earn-in-game pledge axis
// (pledged_omr, an account column bumped by a $OMR burn), so a player reaches backer status in
// alpha via THE PLEDGE while the ETH axis lights up at mainnet. All numbers are sign-off levers.
BONDS.ETH_SCORE_OMR = Number(process.env.BOND_ETH_SCORE_OMR || 5000);  // $OMR-equiv per bonded ETH for the STATUS score (deterministic, NOT the live oracle — the R1-Portfolio precedent)
BONDS.PLEDGE_MIN = Number(process.env.BOND_PLEDGE_MIN || 10);          // min in-game $OMR pledge
BONDS.BACKER_TIERS = [
  { min: 0, name: 'Depositor' }, { min: 100, name: 'Patron' }, { min: 1000, name: 'Underwriter' },
  { min: 10000, name: 'Financier' }, { min: 50000, name: 'Kingmaker' }, { min: 250000, name: 'The Reserve' },
];
BONDS.CHARTER_TIERS = [
  { tier: 1, name: 'Bronze Charter', omr: 25 }, { tier: 2, name: 'Silver Charter', omr: 75 },
  { tier: 3, name: 'Gold Charter', omr: 200 }, { tier: 4, name: 'Platinum Charter', omr: 600 },
  { tier: 5, name: 'The Founding Charter', omr: 1500 },
];
export const underwriterScore = (bondedEth, pledgedOmr) =>
  Math.round((Number(bondedEth || 0) * BONDS.ETH_SCORE_OMR + Number(pledgedOmr || 0)) * 1e6) / 1e6;
export const backerTierOf = (score) => {
  let t = BONDS.BACKER_TIERS[0];
  for (const r of BONDS.BACKER_TIERS) if (Number(score || 0) >= r.min) t = r;
  return t;
};
export const nextBackerTier = (score) => BONDS.BACKER_TIERS.find((r) => r.min > Number(score || 0)) || null;
export const charterOf = (tier) => BONDS.CHARTER_TIERS.find((c) => c.tier === Number(tier)) || null;

// ── THE LEDGER — the Season Pass reward track. A daily-claim track (the genre-standard "battle
// pass"): while the pass is active, claim the NEXT tier once per CLAIM window, escalating rewards.
// Anti-pay-to-win + §10.4-safe: rewards are STATUS (a street title), CONSUMABLES (revives out-of-band,
// an energy refill — not currency), and a small $OMR STIPEND on a few tiers paid through the EXISTING
// backed prize-pool rail (`prize:omr`, pool-bounded — never a mint). The track is account-level (it
// survives death — the heir keeps claiming). All numbers are founder sign-off levers.
export const PASS = {
  TRACK: [
    { tier: 1, reward: { title: 'Ledger Initiate' } },
    { tier: 2, reward: { respawnTokens: 1 } },
    { tier: 3, reward: { energy: true } },
    { tier: 4, reward: { omr: 2 } },
    { tier: 5, reward: { title: 'Bag Man' } },
    { tier: 6, reward: { respawnTokens: 1 } },
    { tier: 7, reward: { energy: true } },
    { tier: 8, reward: { omr: 3 } },
    { tier: 9, reward: { title: 'The Bookkeeper' } },
    { tier: 10, reward: { respawnTokens: 2 } },
    { tier: 11, reward: { energy: true } },
    { tier: 12, reward: { title: 'Made of the Ledger', omr: 5 } }, // the capstone
  ],
};
// the per-tier claim cooldown (~daily). A TEST-ONLY env knob shrinks it (the SEARCH_MS precedent) —
// read per-call so a test can toggle it; NEVER set PASS_CLAIM_MS in production.
export const passClaimMs = () => Number(process.env.PASS_CLAIM_MS ?? (20 * 3600 * 1000));
// THE LEDGER PRESTIGE (Store Tier-4) — a death-proof status axis: lifetime Ledger tracks COMPLETED
// (a returning supporter accumulates prestige across seasons — the PoE-league precedent). A player who
// FINISHED a 12-tier track then buys a fresh pass bumps pass_seasons. Cosmetic-axis sign-off levers.
PASS.PRESTIGE_RANKS = [
  { name: 'First Season', min: 0 }, { name: 'Regular', min: 1 }, { name: 'Season Veteran', min: 3 },
  { name: 'Old Hand', min: 6 }, { name: 'Ledger Legend', min: 12 },
];
export const passPrestigeOf = (seasons) => {
  let r = 0; for (let i = 0; i < PASS.PRESTIGE_RANKS.length; i++) if (Number(seasons || 0) >= PASS.PRESTIGE_RANKS[i].min) r = i; return r;
};
// validate the split sums to 10000 at load — a misconfig would silently mis-earmark real revenue
(() => { const s = STORE.SPLIT_BPS; const t = s.founder + s.buyback + s.rwa;
  if (t !== 10000) throw new Error(`REVENUE_SPLIT_BPS must sum to 10000 (got ${t})`); })();

// ── NAMED LANDMARKS — one dedicable plaque per district (a deflationary $OMR STATUS sink). Dedicate
// by burning $OMR; a bigger flex takes the plaque. The name borne is the account's dynasty (or street).
// Pure status — outside §10.4 (the burn rides vanity:%) and outside the sim-audited balance. Levers.
export const LANDMARKS = {
  MIN_DEDICATE: 20, // the first-dedication floor; a takeover must strictly exceed the current flex
  PLACES: {
    docks: 'The Harbor Gate', neon: 'The Neon Arch', foundry: 'The Ironworks Obelisk',
    brick: 'The Brickyard Monument', canal: 'The Canal Bridge', cathedral: 'The Cathedral Steps',
  },
};
// own-property lookup only — else '__proto__'/'constructor'/'toString' would resolve inherited members
// and slip past the "no such district" gate (audit LOW: a junk row + a self-inflicted $OMR burn).
export const landmarkOf = (districtId) =>
  (Object.prototype.hasOwnProperty.call(LANDMARKS.PLACES, districtId) ? LANDMARKS.PLACES[districtId] : null);

// ── THE SPEAKEASY: the social hub (omerta-speakeasy-design.md) ──
// ONE club per district, opened by a made man (MIN_LEVEL). The base bar take drips lazily (capped 24h)
// to the owner; patrons buy ROUNDS (cash → the owner, a taxed transfer) and bottle service (a pure-status
// $OMR burn), both flexed on the club's guest list. Prestige (TIERS floor + round/bottle bumps) ranks the
// nightlife. All numbers are founder sign-off levers — sim before production.
export const SPEAKEASY = {
  MIN_LEVEL: 15,             // a made man's venue
  OPEN_COST: 750000,         // $ to establish the club (a cash sink)
  INCOME_CAP_MS: 86400000,   // 24h base bar-take cap (the business pattern)
  UPKEEP_BPS: 2000,          // SIGN-OFF (net-EV): protection + wages come off the top of every collect (the business-'pad' 20% rate) — the bar take is no longer a risk-free faucet; a §10.4 speakeasy: cash sink
  VISIT_CD_MS: 3600000,      // 1h per-(patron,club) round cooldown
  NAME_OMR: 8,               // name the club ($OMR vanity burn)
  REGULAR_VISITS: 10,        // visits to become a "regular" (status)
  TIERS: [
    { tier: 0, name: 'The Backroom',  cost: 0,        incomePerHr: 8000,   prestige: 10 },  // as opened
    { tier: 1, name: 'The Lounge',    cost: 600000,   incomePerHr: 16000,  prestige: 30 },
    { tier: 2, name: 'The Blue Room', cost: 1800000,  incomePerHr: 34000,  prestige: 80 },
    { tier: 3, name: 'The Copa',      cost: 4500000,  incomePerHr: 68000,  prestige: 175 },
    { tier: 4, name: 'The Cathedral', cost: 11000000, incomePerHr: 130000, prestige: 375 },
  ],
  ROUNDS: [ // buying a round — CASH to the owner (taxed transfer) + a flex
    { id: 'round',    name: 'a round for the house', cost: 8000,  prestige: 1 },
    { id: 'topshelf', name: 'top-shelf all night',   cost: 40000, prestige: 4 },
  ],
  BOTTLES: [ // bottle service — $OMR, a PURE-STATUS deflationary burn (rides vanity:%), no owner cut
    { id: 'bottle',  name: 'bottle service',            omr: 3,  prestige: 12 },
    { id: 'magnum',  name: 'a magnum of champagne',     omr: 8,  prestige: 35 },
    { id: 'reserve', name: 'the reserve — top of the top', omr: 20, prestige: 90 },
  ],
  // ── step two — THE BACK-ROOM TABLE: the club hosts a house game (the wheel). A patron plays, the OWNER
  // takes a RAKE (carved from the stake, a transfer — never minted on top; the casino discipline), the
  // rest wagers at WIN_P and the edge BURNS (deflationary, CASH only — the Den's hard rule). Draws heat.
  TABLE: { MIN_BET: 1000, MAX_BET: 100000, RAKE_BPS: 300, WIN_P: 0.48, NOTORIETY: 8 },
  ROUND_NOTORIETY: 2,          // a busy bar draws a little heat too
  // ── step two — THE PROHIBITION RAID (the business-raid pattern): notoriety past the threshold rolls a
  // lazy raid on the owner's collect — seizes pending income (never minted, no ledger row), fines the
  // owner (a §10.4 sink), and SHUTTERS the club for RAID_SHUT_MS (no income / table / rounds until it
  // reopens). `SPEAKEASY_RAID_P` env overrides the per-minute p for tests (the BUSINESS_RAID_P precedent).
  RAID_THRESHOLD: 60, RAID_P_PER_MIN: 0.0025, RAID_FINE_RATE: 0.15, RAID_SHUT_MS: 7200000,
  NOTORIETY_DECAY_HR: 4, NOTORIETY_MAX: 100,
  // anti-grief: one patron can add at most this much notoriety to a club per rolling 24h (a token bucket).
  // Deliberately < RAID_THRESHOLD so no single account can force a raid — it takes distinct patron traffic.
  PATRON_NOTORIETY_CAP: 24,
  // ── step three — the P2P BUYOUT (districts clear without a death). The owner lists a sale price; a
  // buyer completes a consensual, TAXED cash transfer (the round pattern) to take the keys. Price bounds.
  SALE_MIN: 100000, SALE_MAX: 50000000,
  // ── step three — cross-club RENOWN (the nightlife legend, pure DERIVED status — no column, dies with the
  // street). renown = floor(Σ spent_cash / CASH_PER + Σ spent_omr × OMR_WEIGHT + ownClubPrestige × OWNER_WEIGHT).
  // Bottle-service ($OMR) is weighted heaviest — the flex is worth the most. RANKS is a display ladder.
  RENOWN: {
    CASH_PER: 10000, OMR_WEIGHT: 50, OWNER_WEIGHT: 0.5,
    RANKS: [
      { min: 0, name: 'Nobody' }, { min: 25, name: 'A Face' }, { min: 100, name: 'A Regular' },
      { min: 300, name: 'High Roller' }, { min: 800, name: 'Big Shot' }, { min: 2000, name: 'King of the Night' },
    ],
    // ── step four — renown PERK (access/status, never power): EARNED decor styles unlocked by renown (no
    // ETH/PLEX — a cosmetic you earn by being seen). id → the renown threshold to apply it. Style-name in DECOR_STYLES.
    STYLE_UNLOCKS: { house: 800, crown: 2000 },
  },
  // ── step three — the ETH COSMETIC DECOR styles (Store SKUs grant the account-level unlock; the owner
  // applies one to their club) + step-four renown-EARNED styles (house/crown, gated by RENOWN.STYLE_UNLOCKS).
  // Display-only — zero gameplay effect (the vanity/status posture). id → name.
  DECOR_STYLES: { deco: 'Art Deco', gilded: 'Gilded Age', midnight: 'Midnight Velvet', house: 'House Favorite', crown: 'The Crown' },
  // ── step four — the STANDOVER (a hostile forced-sale). A challenger pays a FEE (burns win or lose) and
  // rolls a muscle/cunning contest vs the owner; a WIN forces the owner to SELL at the club's ASSESSED
  // (build) value — the owner is PAID (taxed, the buyout pattern), so it's a forced sale, never theft. The
  // challenger risks the fee + must carry the full assessed price. Per-club cooldown bounds spam. Levers.
  STANDOVER: { FEE: 250000, BASE_P: 0.35, STAT_SCALE: 400, MIN_P: 0.05, MAX_P: 0.75, HEAT: 15, CD_MS: 86400000 },
};
export const speakeasyTierOf = (tier) => SPEAKEASY.TIERS.find((t) => t.tier === Number(tier)) || null;
export const speakeasyRoundOf = (id) => SPEAKEASY.ROUNDS.find((r) => r.id === id) || null;
export const speakeasyBottleOf = (id) => SPEAKEASY.BOTTLES.find((b) => b.id === id) || null;
export const renownRankOf = (score) =>
  [...SPEAKEASY.RENOWN.RANKS].reverse().find((r) => Number(score) >= r.min) || SPEAKEASY.RENOWN.RANKS[0];
// own-property lookup only (the landmarkOf precedent — else '__proto__'/'constructor' slip the validation gate)
export const decorStyleOf = (id) =>
  (Object.prototype.hasOwnProperty.call(SPEAKEASY.DECOR_STYLES, id) ? SPEAKEASY.DECOR_STYLES[id] : null);
// the renown threshold to APPLY an earned style (undefined → a bought/Store style, gated by store_cosmetics)
export const styleUnlockOf = (id) =>
  (Object.prototype.hasOwnProperty.call(SPEAKEASY.RENOWN.STYLE_UNLOCKS, id) ? SPEAKEASY.RENOWN.STYLE_UNLOCKS[id] : null);
// the STANDOVER forced-sale price = what the owner sank into the club (open cost + every tier build climbed)
export const assessedValueOf = (tier) => {
  let v = SPEAKEASY.OPEN_COST;
  for (const t of SPEAKEASY.TIERS) if (t.tier > 0 && t.tier <= Number(tier)) v += t.cost;
  return v;
};

// ── THE FIGHT CIRCUIT (omerta-fight-circuit-design.md): sign a contender, train them up, stake them in PvP
// bouts (the casino:pvp transfer pattern — a taxed contest, never a new faucet). All numbers are sign-off levers.
export const BOXING = {
  MANAGER_MIN_LEVEL: 8,      // sign a fighter at level 8+
  RECRUIT_COST: 50000,       // signing bonus (a cash sink)
  STAT_MIN: 6, STAT_MAX: 14, // stats rolled at signing (power/chin/speed)
  STAT_CAP: 25,              // training ceiling per stat
  TRAIN_COST: 20000,         // per session (a cash sink)
  TRAIN_ENERGY: 15,
  TRAIN_GAIN: 1,             // +1 to the chosen stat per session
  MIN_STAKE: 5000, MAX_STAKE: 500000,
  RAKE_BPS: 500,             // 5% vig off the pot (half → the buyback pool, half burns — the casino:pvp rate)
  VARIANCE: 22,              // rng added to each fighter's score — enough for upsets, form still tells
  INJURY_MS: 14400000,      // 4h — a lost bout lays the fighter up
  STATS: ['power', 'chin', 'speed'],
  LEGEND_MIN_LVL: 10,        // (red-team R18) a PvP bout/main-event win only banks the manager LEGEND (boxing_wins, survives death) vs a loser at/above this level — anti-Sybil, the STABLE.LEGEND_MIN_LVL / RACES.WHEEL_MIN_LVL / npcHit-rookie-floor precedent (a status board can't be farmed against fresh alts). Sign-off lever.
  // ── STEP TWO ──
  STABLE_MAX: 3,             // fighters a manager can run at once (the stable)
  EXHIBITION_CD_MS: 6*3600*1000, // 6h per-fighter cooldown on NPC exhibition bouts
  // NPC exhibition opponents — a bounded PvE purse so a solo manager can build a record + earn (the fee
  // is a cash SINK win or lose; the purse a cash FAUCET only on a win → net-positive only vs a beatable
  // NPC). Bounded by the cooldown + the fee + needing the FORM to win. New faucet — sim + sign-off.
  NPC_TIERS: [
    { id: 'clubfighter', name: 'Club Fighter',  form: 26, fee: 3000,  purse: 9000 },
    { id: 'journeyman',  name: 'Journeyman',    form: 42, fee: 15000, purse: 26000 },
    { id: 'gatekeeper',  name: 'The Gatekeeper', form: 62, fee: 45000, purse: 78000 },
  ],
  // the record ladder (by a single fighter's wins) — pure status
  RANKS: [
    { min: 0, name: 'Prospect' }, { min: 3, name: 'Contender' }, { min: 8, name: 'Ranked' },
    { min: 15, name: 'Champion' }, { min: 30, name: 'Hall of Famer' },
  ],
  // the MANAGER's career legend (lifetime fighter wins across the whole stable, SURVIVES DEATH) — status
  LEGEND_RANKS: [
    { min: 0, name: 'Unknown' }, { min: 10, name: 'Cornerman' }, { min: 25, name: 'Fight Fixer' },
    { min: 60, name: 'Boxing Kingpin' }, { min: 120, name: 'The Don of the Ring' },
  ],
  // ── STEP THREE — THE MAIN EVENT (spectator betting) ──
  // A scheduled prestige bout the crowd bets on. No principal cash wager (the fighters fight for the
  // belt/legend/record); the money is a CASH parimutuel among spectators. The worker resolves it at
  // window close (the auction-settle model). All numbers are sim + founder sign-off levers.
  MAIN_EVENT_MS: 30 * 60 * 1000,   // the betting window (MAIN_EVENT_MS env override is TEST-ONLY)
  BET_MIN: 500, BET_MAX: 250000,   // a single spectator bet's bounds (CASH only)
  // the house vig on the LOSING pot — half → the winning manager's promoter purse, half → the house
  // (of which half street-tax buyback, half burns). A pure taxed TRANSFER (redistribution), never a mint.
  BET_RAKE_BPS: 800,
  // ── STEP FOUR — BELT DEFENSE (pure status, no §10.4) ──
  // The belt tracks a REIGN (defenses since winning it) and carries a MANDATORY-DEFENSE clock: a champ
  // who doesn't win a bout within DEFENSE_MS is STRIPPED (the belt goes vacant — hold it or fight).
  DEFENSE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days to defend or forfeit
  // ── STEP FIVE — THE CALLOUT (the mandatory #1-contender challenge; pure status, no §10.4) ──
  // The #1 contender forces a title fight. The champ has CALLOUT_MS to ACCEPT (books a title main event)
  // or DUCK it — a ducked callout past the deadline forfeits the belt straight to the challenger.
  CALLOUT_MS: 48 * 60 * 60 * 1000,   // the champ's window to accept a callout (CALLOUT_MS env is TEST-ONLY)
};
export const boxerRankOf = (wins) =>
  [...BOXING.RANKS].reverse().find((r) => Number(wins) >= r.min) || BOXING.RANKS[0];
export const boxerLegendOf = (wins) =>
  [...BOXING.LEGEND_RANKS].reverse().find((r) => Number(wins) >= r.min) || BOXING.LEGEND_RANKS[0];
export const npcBoxerOf = (id) => BOXING.NPC_TIERS.find((t) => t.id === id) || null;

// ── THE STABLE (own the dogs & the ponies) — the ownership layer under The Track's betting card.
// The boxing-stable pattern applied to racing animals: buy a young racer (a cash SINK), train up its
// speed/stamina/heart (a cash+energy SINK, capped), and RACE it — the PvE circuit (a fee BURNS win or
// lose, a purse pays only on a win; the ONE new faucet, the boxing-exhibition twin) or a PvP MATCH RACE
// (the audited casino:pvp taxed transfer, never a new faucet, never an escrow). A racer's SPEED FORM =
// speed + stamina + heart + rand(VARIANCE) — fast animals win, but variance leaves room for an upset.
// Dogs race dogs, horses race horses. Racers DIE WITH THE STREET (the racers rows join the runEstate
// wipe — the fighters precedent); the owner's lifetime wins are an account-level LEGEND (survives death,
// the boxing-legend/hitman-rep precedent). CASH ONLY (the Den's rule). All numbers are founder sign-off
// levers — the stable:purse circuit faucet is the one new emission surface (sim + sign-off, BALANCE.md).
export const STABLE = {
  MIN_LEVEL: 6,                       // a track owner's game, opens after the early loop
  STAT_CAP: 25,                       // training ceiling per stat
  TRAIN_COST: 15000, TRAIN_ENERGY: 12, TRAIN_GAIN: 1,   // a session: +1 to the chosen stat
  STATS: ['speed', 'stamina', 'heart'],
  STABLE_MAX: 3,                      // racers you can run at once — aligned with BOXING.STABLE_MAX
                                      // (AUDIT-full-product #4): the circuit purse and the exhibition
                                      // purse are the identical bounded-PvE-faucet mechanic, so a 4th
                                      // slot was a free +33% racing ceiling for no design reason.
  MIN_STAKE: 5000, MAX_STAKE: 500000, // PvP match-race wager bounds
  RAKE_BPS: 500,                      // 5% vig off the match pot (half → buyback, half burns — casino:pvp)
  VARIANCE: 22,                       // rng added to each racer's form — enough for upsets
  INJURY_MS: 4 * 3600 * 1000,         // a lost race lays the animal up 4h
  CIRCUIT_CD_MS: 6 * 3600 * 1000,     // per-racer cooldown on the PvE circuit
  LEGEND_MIN_LVL: 10,                 // a PvP match-race win only banks the owner LEGEND (racer_wins) vs a loser at/above this level (anti-Sybil — the RACES.WHEEL_MIN_LVL/npcHit-rookie-floor precedent; a status board can't be farmed against fresh alts). Sign-off lever.
  // the two kinds — a dog is the cheap early animal, a horse the prestige investment (pricier, rolls a
  // touch higher, races a richer circuit). statMin/statMax are the roll range at purchase.
  KINDS: {
    dog:   { name: 'Greyhound', cost: 30000,  statMin: 5, statMax: 12 },
    horse: { name: 'Racehorse', cost: 120000, statMin: 7, statMax: 15 },
  },
  // the PvE circuit per kind — a bounded purse (fee BURNS win/lose; purse a FAUCET only on a win → net
  // positive only vs a beatable field). Bounded by the cooldown + the fee + needing the FORM to win.
  MEETS: {
    dog: [
      { id: 'maiden', name: 'Maiden Sprint',  form: 24, fee: 2000,  purse: 6000 },
      { id: 'graded', name: 'Graded Stakes',  form: 40, fee: 12000, purse: 22000 },
      { id: 'derby',  name: 'The City Derby',  form: 60, fee: 40000, purse: 70000 },
    ],
    horse: [
      { id: 'maiden',    name: 'Maiden Special', form: 28, fee: 5000,  purse: 15000 },
      { id: 'allowance', name: 'Allowance',      form: 46, fee: 22000, purse: 42000 },
      { id: 'goldcup',   name: 'The Gold Cup',   form: 68, fee: 65000, purse: 115000 },
    ],
  },
  // the record ladder (a single racer's wins) — pure status
  RANKS: [
    { min: 0, name: 'Unraced' }, { min: 3, name: 'Winner' }, { min: 8, name: 'Stakes Winner' },
    { min: 15, name: 'Champion' }, { min: 30, name: 'Triple Crown' },
  ],
  // the OWNER's lifetime wins across the whole stable (account-level, SURVIVES DEATH) — status
  LEGEND_RANKS: [
    { min: 0, name: 'Railbird' }, { min: 10, name: 'Owner' }, { min: 25, name: 'The Silks' },
    { min: 60, name: 'Racing Baron' }, { min: 120, name: 'Lord of the Turf' },
  ],
  // ── STEP TWO ──
  // BREEDING: retire two same-kind racers into stud → a FOAL that inherits a fraction of the parents'
  // average stat (a head start, NOT a cap-skip: floor(avg × INHERIT) + rand(0,VARIANCE), clamped to the
  // kind's floor..STAT_CAP). A cash SINK; the two parents are CONSUMED (2 racers + cash → 1 foal). So a
  // veteran can consolidate two trained runners into a promising foal — a genuine build lever, bounded.
  BREED_COST: 60000, BREED_INHERIT: 0.6, BREED_VARIANCE: 5,
  // THE STAKES: a scheduled marquee race owners ENTER their racer into (the Grand-Prix/poker-tournament
  // escrow twin, on the animal side). A CASH buy-in ESCROWS into a purse; the worker races every live
  // entrant's SNAPSHOTTED form (form + rand(VARIANCE)) and pays the top places a share net of RAKE_BPS
  // (half → the buyback, half burns). A pure competitive REDISTRIBUTION — NO new faucet. One open stakes
  // at a time; a new one materializes on the next entry after the last settles. `STAKES_MS` env is
  // TEST-ONLY (the SEARCH_MS pattern). The racer isn't escrowed (only the cash) — you race the form you
  // entered, and the animal is free to run/breed after. The best animal in town wins, dog or horse.
  STAKES: { BUYIN: 20000, REGISTER_MS: 30 * 60 * 1000, MIN_ENTRANTS: 3, RAKE_BPS: 500, PAYOUTS: [0.6, 0.3, 0.1] },
};
// own-property lookup only (the decorStyleOf/landmarkOf precedent — else '__proto__'/'constructor' return
// Object.prototype (truthy), slip the enum gate, and reach NaN stats → a 500 on the INT INSERT)
export const stableKindOf = (kind) => (Object.prototype.hasOwnProperty.call(STABLE.KINDS, kind) ? STABLE.KINDS[kind] : null);
export const stableMeetOf = (kind, id) => (STABLE.MEETS[kind] || []).find((m) => m.id === id) || null;
export const racerRankOf = (wins) =>
  [...STABLE.RANKS].reverse().find((r) => Number(wins) >= r.min) || STABLE.RANKS[0];
export const racerLegendOf = (wins) =>
  [...STABLE.LEGEND_RANKS].reverse().find((r) => Number(wins) >= r.min) || STABLE.LEGEND_RANKS[0];

// ── STREET RACES (omerta-street-races-design) — the deep 60-car catalog becomes a competitive loop ──
// A car's RACE POWER = sqrt(book value) + tune×TUNE_POWER + driver speed/SPEED_DIV − damage. Fast/valuable
// iron wins, but tuning + the wheelman's speed decide close races. PvE circuit (fee BURNS win/lose, purse
// on a win — a bounded faucet, the boxing-exhibition precedent); PvP wager races (the audited casino:pvp
// taxed transfer). Tuning is a cash sink. Lifetime wins are an account-level legend (survives death). CASH
// only (the Den's rule). All numbers are founder sign-off levers — sim before production.
export const RACES = {
  MIN_LEVEL: 3,                        // a wheelman's game, open early
  VARIANCE: 40,                        // the road is fickle — rand(0,VARIANCE) added to each side
  TUNE_POWER: 15, TUNE_MAX: 5, TUNE_COST: 25000,   // engine tune: +power per level, capped, a cash sink
  // step 2 — NITROUS (NOS): a per-car consumable, the COMEBACK tool. Buy a charge (a cash SINK), spend ONE
  // on a race for a one-race power bump (rng-audited). Sim-tuned (P9.13): the cost is set so burning a
  // charge is +EV for an UNDERDOG on a mid/high-purse race (flip a likely loss to a win) but WASTED on a
  // car already winning (ΔP≈0) and not worth it on the cheap races — a viable comeback, still a sink on
  // average (gone win/lose). NOS_COST $15k→$8k (founder-directed): at $15k it only paid on the top tier;
  // $8k makes the Ghost comeback genuinely rewarding (+$7.6k absolute) + viable on Midnight.
  NOS_COST: 8000, NOS_MAX: 3, NOS_POWER: 60,
  // step 2 — PINK SLIPS: race for the car itself (consent-by-listing via cars.pink_slip). The winner TAKES
  // the loser's raced car — a §10.4-NEUTRAL ownership transfer (cars conserve by ROW COUNT, no ledger — the
  // chop/market-seize precedent), can push the winner past GARAGE_CAP (the market-win precedent). No numeric
  // lever — it rides the same power/variance/cooldown/WHEEL machinery as a cash wager race.
  SPEED_DIV: 2, DMG_PEN_DIV: 4,        // driver speed/2 into power; damage/4 off it
  CD_MS: 2 * 60 * 60 * 1000,           // 2h per-driver cooldown (RACE_CD_MS env overrides for tests) — bounds the PvE faucet to boxing-exhibition parity
  LOSS_DMG: 8,                         // a lost race dings the car (the existing damage mechanic — repair is a real cost on a loss)
  RAKE_BPS: 500,                       // PvP: 5% off the pot (half → street tax/buyback, half burns — casino:pvp)
  WAGER_MIN: 500, WAGER_MAX: 250000,
  WHEEL_MIN_LVL: 10,                   // a PvP WHEEL win only counts vs a loser at/above this level (anti-Sybil — the WANTED_MIN_LVL/npcHit-rookie-floor precedent; a status board can't be farmed against fresh alts). Sign-off lever.
  // PvE circuit — fieldPower is the NPC pack; fee burns win/lose; purse pays only on a win (a bounded
  // faucet). A matched car (power ≈ field) is roughly break-even; an OVER-POWERED car wins its tier
  // deterministically for up to purse−fee (top tier +$18k/win = +60% of the fee), so it's a gear/skill
  // earner bounded by the per-driver cooldown (~12/day ≈ +$216k/day at the top — boxing-exhibition
  // parity, NOT risk-free: a lost race dings the car). All sign-off levers.
  TIERS: [
    { id: 'backalley', name: 'Back-Alley Sprint', minLvl: 3,  fieldPower: 45,  fee: 2000,  purse: 3200 },
    { id: 'midnight',  name: 'Midnight Run',       minLvl: 12, fieldPower: 140, fee: 8000,  purse: 13000 },
    { id: 'grandprix', name: 'The Ghost Circuit',  minLvl: 30, fieldPower: 320, fee: 30000, purse: 48000 },
  ],
  RANKS: [
    { min: 0, name: 'Sunday Driver' }, { min: 10, name: 'Street Racer' }, { min: 40, name: 'The Wheelman' },
    { min: 120, name: 'King of the Strip' }, { min: 400, name: 'The Phantom' },
  ],
  // step 3 — THE GRAND PRIX: a scheduled, worker-resolved CASH parimutuel (the boxing-main-event / poker-
  // tournament escrow twin). Drivers buy in (cash ESCROWS into a pool during an open window), the worker
  // races every live entrant (their car's snapshotted power + rand(VARIANCE)) and pays the top places a
  // RENORMALIZED share of the pool net of the rake (half → street tax/buyback, half burns). A pure
  // competitive REDISTRIBUTION — no new faucet (unlike the PvE purse). §10.4: a new `grand prix escrow`
  // check. All numbers are founder sign-off levers.
  GP: {
    MIN_LEVEL: 12,             // the big race — a made wheelman's game
    BUYIN: 25000,              // cash escrowed per entry
    RAKE_BPS: 500,             // 5% off the pool at settle (half → street tax, half burns — the casino:pvp/tourney split)
    MIN_ENTRANTS: 3,           // fewer live runners → the whole field is refunded
    PAYOUTS: [0.6, 0.3, 0.1],  // top-3 split (renormalized to the field so the edge stays the rake at any turnout)
    REGISTER_MS: 30 * 60 * 1000, // registration window (GRAND_PRIX_MS env overrides for tests — the SEARCH_MS pattern)
  },
};
export const raceTierOf = (id) => RACES.TIERS.find((t) => t.id === id) || null;
export const raceRankOf = (wins) =>
  [...RACES.RANKS].reverse().find((r) => Number(wins) >= r.min) || RACES.RANKS[0];
// a car's race power (deterministic; the car dominates, tune + wheelman speed decide close ones)
export const carPower = (modelId, trimId, tune = 0, speed = 0, dmg = 0) =>
  Math.max(1, Math.floor(Math.sqrt(carVal(modelId, trimId)))
    + Number(tune) * RACES.TUNE_POWER + Math.floor(Number(speed) / RACES.SPEED_DIV)
    - Math.floor(Number(dmg) / RACES.DMG_PEN_DIV));

// ── THE PORT — maritime smuggling (omerta-the-port-design.md) ──
// Boats are an ownable vessel class (bought like cars): a HOLD (cargo scale) + SPEED (Coast Guard evasion).
// A run sources contraband offshore (a cash SINK), sails a real clock, and — if it slips the COAST GUARD —
// lands the goods for the smuggling margin (a cash FAUCET). Interdiction SEIZES the cargo + FINES + may SINK
// the boat. All CASH. The one faucet (port:sale) is bounded by the run clock, interdiction, and a daily
// SUPPLY CAP (the wash-cap token bucket). All numbers are founder sign-off levers — sim before production.
export const PORT = {
  MIN_LEVEL: 6, DISTRICT: 'docks', FLEET_MAX: 5, RESALE_BPS: 6000, // boats resell at 60% of cost
  ESCORT_COST: 15000, ESCORT_DEF: 25,          // hire an escort: a cash sink that subtracts from interdiction
  INTERDICT_MIN: 0.03, INTERDICT_MAX: 0.85, FINE_RATE: 0.5, SINK_P: 0.15, // Coast Guard: caught-odds clamp, fine, boat-loss sub-roll
  RUN_HEAT: 6, BUST_HEAT: 25,                   // heat drawn on launch / on a bust
  SUPPLY_CAP_DAY: 400000,                       // rolling-24h cap on contraband COST sourced — the D3 wash-cap bound on the faucet (sim-tuned to boxing/territory parity)
  BOATS: [
    { id: 'dinghy',    name: 'Harbor Dinghy',      cost: 40000,    hold: 20,  speed: 25 },
    { id: 'skiff',     name: "Runner's Skiff",     cost: 150000,   hold: 50,  speed: 45 },
    { id: 'trawler',   name: 'Converted Trawler',  cost: 500000,   hold: 120, speed: 40 },
    { id: 'cutter',    name: 'Fast Cutter',        cost: 1500000,  hold: 200, speed: 75 },
    { id: 'freighter', name: 'Coastal Freighter',  cost: 5000000,  hold: 500, speed: 35 }, // huge hold, slow — high-variance
    { id: 'cigarette', name: 'Cigarette Boat',     cost: 12000000, hold: 160, speed: 120 }, // the evasion king
  ],
  // routes = risk tiers: buy/sell per unit, Coast Guard patrol, run time, a minimum boat speed to attempt.
  // The gradient is DEEPER = richer margin ratio BUT heavier patrol (higher-variance, the territory-type
  // philosophy): coastal is a safe thin baseline; the deep run pays best but is a real gamble even for the
  // fastest boat (patrol 150 > the top speed 120 → the cigarette boat still eats ~30% out there).
  ROUTES: [
    { id: 'coastal',   name: 'Coastal Hop',  minLvl: 6,  buy: 120, sell: 200,  patrol: 30,  ms: 60 * 60 * 1000,  minSpeed: 0 },  // ×1.67, safe
    { id: 'openwater', name: 'Open Water',   minLvl: 16, buy: 350, sell: 640,  patrol: 90,  ms: 90 * 60 * 1000,  minSpeed: 40 }, // ×1.83, medium
    // deeprun sell 1900 → 2700 (AUDIT-full-product #2): at 1900 the deepest route was a TRAP — realized
    // $131k/day vs Open Water's $303k, so unlocking it at L32 was a downgrade. Realized/day with the
    // SUPPLY_CAP binding is `cap × [(sell/buy − 1)×P(clean) − P(caught) − ½·P(caught)]` (cargo cost is
    // lost on a bust and the fine is ½ of it): at ×2.11/30% that is 0.33×cap, at Open Water's ×1.83/3%
    // it is 0.76×cap. The audit's "~$2,400" guess still lands UNDER Open Water (0.72×cap) — ×3.0 is the
    // honest floor, giving 0.95×cap ≈ $380k/day: ~25% over the safe route for 30% bust odds, the
    // boat-sinking exposure, a 150-min leg and an L32 gate. Still bounded by the same daily supply cap.
    { id: 'deeprun',   name: 'The Deep Run', minLvl: 32, buy: 900, sell: 2700, patrol: 150, ms: 150 * 60 * 1000, minSpeed: 70 }, // ×3.0, high-variance
  ],
};
export const boatOf = (id) => PORT.BOATS.find((b) => b.id === id) || null;
export const portRouteOf = (id) => PORT.ROUTES.find((r) => r.id === id) || null;
export const boatResale = (kind) => Math.floor((boatOf(kind)?.cost || 0) * PORT.RESALE_BPS / 10000);
// the Coast Guard's interdiction chance: route patrol (+ a day/night patrol modifier) minus boat speed
// and any escort, clamped. A fast boat / escort on a low route ≈ safe; a slow freighter on the deep run ≈ dice.
export const interdictChance = (route, boat, escort, patrolMod = 0) => Math.max(PORT.INTERDICT_MIN,
  Math.min(PORT.INTERDICT_MAX, (route.patrol + patrolMod - (boat?.speed || 0) - (escort ? PORT.ESCORT_DEF : 0)) / 100));
// ── THE PORT step two: NAVAL UPGRADES + PIRACY + RENDEZVOUS ── (all numbers founder sign-off levers)
PORT.STEP2 = {
  HULL_STEP: 15, ENGINE_STEP: 8, UPGRADE_MAX: 5,        // +cargo / +knots per level, capped like car tune
  UPGRADE_BASE: 30000,                                  // cost = BASE × (level+1) × boat-tier multiple (bigger hulls cost more)
  // PIRACY (the convoy-ambush twin at sea): a pirate needs their own fast boat + guns; a WIN redirects
  // the run's would-be landing to the pirate at a CUT (< 100%), so total port emission can only FALL.
  PIRATE_MIN_LEVEL: 10, PIRATE_ENERGY: 12, PIRATE_AMMO: 4, PIRATE_HEAT: 15,
  PIRATE_TAKE_BPS: 6000,                                // 60% of the seized cargo's landing value; the rest scatters
  ESCORT_VS_PIRATE: 30, FAIL_HOSP_MS: 30 * 60 * 1000,   // an escort fights pirates too; a repelled pirate is laid up
};
// effective hold/speed with naval upgrades folded in
export const effHold = (boat, spec) => (spec?.hold || 0) + (Number(boat?.hull) || 0) * PORT.STEP2.HULL_STEP;
export const effSpeed = (boat, spec) => (spec?.speed || 0) + (Number(boat?.engine) || 0) * PORT.STEP2.ENGINE_STEP;
// upgrade cost climbs with the level AND the boat's tier (a freighter's hull costs more than a dinghy's)
export const boatUpgradeCost = (boat, spec, part) => {
  const lvl = Number(part === 'hull' ? boat?.hull : boat?.engine) || 0;
  const tier = Math.max(1, Math.round((spec?.cost || 0) / 500000));   // ~1 (dinghy) … ~24 (cigarette)
  return PORT.STEP2.UPGRADE_BASE * (lvl + 1) * Math.max(1, Math.min(tier, 12));
};
// ── THE PORT step three: THE SMUGGLER'S LEGEND + THE HARBORMASTER (docks-holder toll) ──
PORT.STEP3 = {
  TOLL_BPS: 500,   // 5% of a clean landing to the family that HOLDS the docks (the convoy-toll twin); NPC-held / your own = free
  // lifetime landed contraband value → a status rank (survives death — the boxing/wheel/war-effort precedent)
  LEGEND_RANKS: [
    { at: 0, title: 'Deckhand' }, { at: 250000, title: 'Runner' }, { at: 2000000, title: 'Smuggler' },
    { at: 10000000, title: 'Blockade Runner' }, { at: 50000000, title: 'The Baron of the Bay' },
    { at: 200000000, title: 'The Kingpin of the Coast' },
  ],
};
export const portRankOf = (smuggled) => {
  let cur = PORT.STEP3.LEGEND_RANKS[0];
  for (const r of PORT.STEP3.LEGEND_RANKS) if (Number(smuggled || 0) >= r.at) cur = r;
  return cur;
};
// ── THE PORT step four: THE CONTRABAND MARKET (warehouse + fence at a drifting daily price) + BERTHS ──
PORT.STEP4 = {
  FENCE_LO: 0.85, FENCE_SPAN: 0.40,   // the fence pays BOOK VALUE × a multiplier drifting 0.85–1.25 (mean ~1.05)
  BERTH_COST: 500000, BERTH_MAX: 3,   // a rented harbor slip: +1 fleet cap, one-time cash sink, capped
};
// today's fence multiplier — a deterministic §7.11 daily drift (a smuggler times the market: warehouse, fence high)
export const fenceMultOf = (day = dayOf()) => PORT.STEP4.FENCE_LO + hash01('fence:' + day + ':' + MARKET_SEED) * PORT.STEP4.FENCE_SPAN;
// ── THE PORT step five: the Coast Guard feeds the LAW meter + warehoused contraband is a LOOT surface ──
PORT.STEP5 = {
  // a Coast Guard BUST (interdiction) now also builds a federal case: it adds to the RICO investigation
  // meter (heat_exposure), not just the volatile heat number — so repeat smuggling draws the Bureau (ties
  // the Port's PvE antagonist into the Law/RICO system). Tunable; off the signed heat curve, a NEW Law lever.
  BUST_EXPOSURE: 25,
  // a player FIRE-kill loots this fraction of the victim's WAREHOUSED contraband (the P1.1 loot-surface
  // twin): warehousing to fence later is now a RISK for a marked man. A pure ownership move (contraband is
  // a cash-book-value commodity, not a §10.4 currency — the gear-loot precedent), bounded by the supply cap.
  CONTRA_LOOT_RATE: 0.5,
};

// ── TIER C — ROUTE NOTORIETY + THE SMUGGLER'S REPUTATION (omerta-transport-depth-design.md) ──
// A per-(character, lane) heat that GROWS each run of the same lane and DECAYS lazily (the
// business-scrutiny pattern), pushing route variety so the transport loops aren't "farm one optimal
// lane forever." EMISSION-SAFE by construction: on the PORT the heat only RAISES interdiction (fewer
// clean landings → LESS emission); on CONVOYS it only LOWERS the shipper's own guard defense (an ambush
// is a pure ownership transfer, not a §10.4 faucet). The existing Teamster / Smuggler LEGENDS (pure
// status until now) grant a REPUTATION that MANAGES the heat (faster decay / lower gain) plus a docks-toll
// break (a redistribution, not a faucet) — the Underworld-tier status→access precedent. All numbers are
// founder sign-off levers; nothing here touches a signed FAUCET curve (only risk + a transfer discount).
export const NOTORIETY = {
  GAIN: 8,             // +heat per depart (convoy) / launch (port) on that same lane
  DECAY_PER_HR: 4,     // lazy cool-down toward 0 (a lane you leave alone goes quiet in ~10h from the cap)
  MAX: 40,             // heat cap on one lane
  CONVOY_DEF_PER: 0.6, CONVOY_DEF_CAP: 24,   // a hot land lane SHEDS guard def (bandits have it cased): −def per point, capped
  PORT_P_PER: 0.004,   PORT_P_CAP: 0.16,     // a hot sea lane DRAWS the Coast Guard: +interdiction p per point, capped
  // reputation perks, keyed off the existing legend rank TIER (index into the rank ladder):
  REP_DECAY_TIER: 1, REP_DECAY_MULT: 2,      // T1 (Teamster/Runner, ≥$250k): your lanes cool 2× faster
  REP_TOLL_TIER: 2,  REP_TOLL_MULT: 0.5,     // T2 (Dispatcher/Smuggler, ≥$2M): the docks toll you at half (a known face)
  REP_GAIN_TIER: 3,  REP_GAIN_MULT: 0.5,     // T3 (Freight Boss/Blockade Runner, ≥$10M): low profile — lanes heat half as fast
};
// legend rank TIER = index into the ladder (0 = base … so ≥1 is the 2nd rank, etc.)
export const haulerTierOf = (v) => CONVOY.HAULER_RANKS.reduce((t, r, i) => (Number(v || 0) >= r.at ? i : t), 0);
export const smugglerTierOf = (v) => PORT.STEP3.LEGEND_RANKS.reduce((t, r, i) => (Number(v || 0) >= r.at ? i : t), 0);
// the decayed heat on a lane RIGHT NOW (decayMult = REP_DECAY_MULT if the runner has the T1 rep, else 1)
export const notorietyNow = (stored, notedAt, decayMult = 1) =>
  Math.max(0, Number(stored || 0) - (notedAt ? Math.max(0, (Date.now() - new Date(notedAt).getTime()) / 3600000) : 0) * NOTORIETY.DECAY_PER_HR * decayMult);
// the reputation perks a runner of the given legend tier enjoys (decay/gain manage the heat; toll is a transfer break)
export const smuggleRepPerks = (tier) => ({
  tier: Number(tier) || 0,
  decayMult: (Number(tier) || 0) >= NOTORIETY.REP_DECAY_TIER ? NOTORIETY.REP_DECAY_MULT : 1,
  tollMult:  (Number(tier) || 0) >= NOTORIETY.REP_TOLL_TIER  ? NOTORIETY.REP_TOLL_MULT  : 1,
  gainMult:  (Number(tier) || 0) >= NOTORIETY.REP_GAIN_TIER  ? NOTORIETY.REP_GAIN_MULT  : 1,
});

export const tickerOf = (id) => PORTFOLIO.TICKERS.find((t) => t.id === id) || null;
// The day's price: base × (1 ± drift·hash), deterministic per UTC day off the server-secret market
// seed (§7.11 machinery — unpredictable without the seed, verifiable after). DISPLAY-ONLY — it
// values a status collectible and moves no §10.4 currency, so R1 stays fully outside the ledger.
export const tickerPriceOf = (id, day = dayOf()) => {
  const t = tickerOf(id); if (!t) return 0;
  const swing = (hash01(`rwa:${id}:${day}:${MARKET_SEED}`) * 2 - 1) * t.drift;
  return Math.max(1, Math.round(t.base * (1 + swing) * 100) / 100);
};

// ── THE ESTATE ("the compound"): the deep PERSONAL $OMR sink + a new "home" surface ──
// The don's mansion — a tiered, furnishable home that DISPLAYS your legend. Pure STATUS (display-only,
// no gameplay power → outside the sim-audited balance, the vanity/seal/Portfolio precedent); the only
// §10.4 flow is the enumerated `estate:*` $OMR BURN through the vanity `spendOmr` till. Account-level,
// so it SURVIVES DEATH — the compound passes to the heir. TIERS are bought SEQUENTIALLY (the seal
// ladder); FEATURES are one-time unlocks gated by `minTier`. All numbers are founder sign-off levers.
export const ESTATE = {
  NAME_OMR: 3, // name / rename your compound
  TIERS: [
    { tier: 1, name: 'Safe House',        omr: 40,   blurb: 'A room over a social club. It\'s a start.' },
    { tier: 2, name: 'Row House',         omr: 120,  blurb: 'Your name on the deed. Respectable.' },
    { tier: 3, name: 'Uptown Brownstone', omr: 350,  blurb: 'Doormen who forget what they see.' },
    { tier: 4, name: 'Country Estate',    omr: 900,  blurb: 'Gates, dogs, and a long driveway.' },
    { tier: 5, name: 'The Compound',      omr: 2500, blurb: 'The kind of place they make movies about.' },
  ],
  FEATURES: [ // one-time $OMR unlocks; cosmetic, some display a real trophy. minTier gates each.
    { id: 'trophy_room', name: 'Trophy Room',    omr: 60,  minTier: 2, blurb: 'Your rarest iron and finest guns, mounted.' },
    { id: 'wine_cellar', name: 'Wine Cellar',    omr: 40,  minTier: 2, blurb: 'Vintages older than most grudges.' },
    { id: 'garden',      name: 'Rose Garden',    omr: 30,  minTier: 2, blurb: 'Where quiet conversations happen.' },
    { id: 'show_garage', name: 'Show Garage',    omr: 80,  minTier: 3, blurb: 'Glass walls for the collection.' },
    { id: 'study',       name: 'The Study',      omr: 50,  minTier: 3, blurb: 'Leather, brass, and the family books.' },
    { id: 'chapel',      name: 'Private Chapel', omr: 100, minTier: 4, blurb: 'Absolution, in-house.' },
    { id: 'vault',       name: 'The Vault',      omr: 150, minTier: 4, blurb: 'What survives you sits behind a foot of steel.' },
    { id: 'panic_room',  name: 'Panic Room',     omr: 120, minTier: 4, blurb: 'For when the doors come down.' },
    { id: 'ballroom',    name: 'Grand Ballroom', omr: 200, minTier: 5, blurb: 'For weddings, wakes, and sit-downs.' },
    { id: 'menagerie',   name: 'The Menagerie',  omr: 250, minTier: 5, blurb: 'A tiger. Because you can.' },
  ],
};
export const estateTierOf = (tier) => ESTATE.TIERS.find((t) => t.tier === Number(tier)) || null;
export const estateFeatureOf = (id) => ESTATE.FEATURES.find((f) => f.id === id) || null;
// ── ESTATE STEP TWO — THE STAFF & THE GALA (design omerta-deep-deferred-design.md §A) ──
// The recurring $OMR drain the one-time burns lacked: a household PAYROLL (wages accrue lazily on
// one clock, settled all-or-nothing as an `estate:staff` burn — the business-pad/crew-nut pattern;
// unpaid past WALK_MS the staff WALK, arrears cleared, rehire from scratch) + THE GALA (a big
// tier-scaled burn that opens a be-seen window — the speakeasy fantasy at the compound). PURE
// STATUS both (prestige + guest lists, zero gameplay power). All numbers sign-off levers.
// Hire fees are 10× the daily wage, so the dismiss-before-payday dodge is always −EV vs the
// 7-day walk window (you save ≤7 days' wage and pay 10 to restaff).
ESTATE.STAFF = [
  { id: 'groundskeeper', name: 'Groundskeeper',     wageOmrDay: 0.5, hireOmr: 5,  minTier: 1, blurb: 'The roses never say what they saw.' },
  { id: 'butler',        name: 'The Butler',        wageOmrDay: 1,   hireOmr: 10, minTier: 2, blurb: 'Runs the house. Required to host a gala.' },
  { id: 'sommelier',     name: 'Sommelier',         wageOmrDay: 1.5, hireOmr: 15, minTier: 3, blurb: 'Pours vintages older than most grudges.' },
  { id: 'curator',       name: 'Curator',           wageOmrDay: 2,   hireOmr: 20, minTier: 3, blurb: 'Keeps the trophies gleaming and the books straight.' },
  { id: 'house_capo',    name: 'Capo of the House', wageOmrDay: 3,   hireOmr: 30, minTier: 4, blurb: 'Security, discretion, and a very short memory.' },
];
ESTATE.STAFF_WALK_MS = 7 * 24 * 3600 * 1000;   // arrears older than this → the staff WALK (bounds owed)
ESTATE.GALA_OMR = 15;                           // × the estate tier — the host's burn
ESTATE.GALA_MIN_TIER = 2;                       // a Row House can host; a Safe House can't
ESTATE.GALA_MS = 4 * 3600 * 1000;               // the open-doors window
export const estateStaffOf = (id) => ESTATE.STAFF.find((s) => s.id === id) || null;
// ── ESTATE Tier-4 catalog growth (content only — estateTierOf/upgradeEstate/unlockFeature/hireStaff
// already iterate the catalog, so the additions are zero-logic; the gala cost = GALA_OMR×tier scales
// itself). A 6th tier, 2 tier-gated features (the home of the collection), 1 staff. Sign-off levers.
ESTATE.TIERS.push({ tier: 6, name: 'The Palazzo', omr: 6000, blurb: 'A city block that answers to your name.' });
ESTATE.FEATURES.push(
  { id: 'gallery',     name: 'The Gallery',     omr: 300, minTier: 5, blurb: 'Your auction trophies, lit and labelled.' },
  { id: 'observatory', name: 'The Observatory', omr: 350, minTier: 6, blurb: 'You watch the whole city from up here.' });
ESTATE.STAFF.push(
  { id: 'archivist', name: 'The Archivist', wageOmrDay: 4, hireOmr: 40, minTier: 5, blurb: 'Keeps the provenance and the collection catalog.' });

// ── THE AUCTION HOUSE ("the sit-down"): the COMPETITIVE, RECURRING $OMR sink ──
// Server-run weekly auctions of UNIQUE, numbered prestige items — highest $OMR bid wins, the winning
// bid BURNS (deflationary). Competitive (whales bid each other up), recurring (fresh lots each week),
// self-balancing (scales with wealth), status-only (won items are account-level trophies, no gameplay
// power → outside the sim-audited balance). Bids escrow $OMR (the bounty/loan/market-escrow twin, on
// the $OMR side); §10.4: auction:bid (account→escrow) + auction:refund (escrow→account) are TRANSFERS
// (both inside omrBuckets via the escrow term), auction:win (escrow→burn) is the only deflation. $OMR
// is account-level (survives death) → a bid needs NO death handling. All numbers are sign-off levers.
export const AUCTION = {
  LOTS_PER_WEEK: 3,
  MIN_RAISE_BPS: 500, // a raise must beat the standing bid by ≥ 5%
  ARCHETYPES: [
    { id: 'plate',    name: 'Numbered Vanity Plate', min: 20,  blurb: 'A single-digit plate. Everyone knows what it cost.' },
    { id: 'watch',    name: "A Dead Don's Watch",    min: 30,  blurb: 'Still keeps perfect time.' },
    { id: 'pistol',   name: 'Engraved Sidearm',      min: 40,  blurb: 'A one-off, gold-inlaid. Never fired, always shown.' },
    { id: 'ring',     name: "A Made Man's Ring",     min: 60,  blurb: 'Heavy gold. It opens doors.' },
    { id: 'painting', name: 'A Stolen Masterwork',   min: 100, blurb: 'It "fell off a truck" at the Met.' },
    { id: 'car',      name: 'A Concours Classic',    min: 150, blurb: 'Too beautiful to drive. So you don\'t.' },
  ],
};
export const auctionArchetypeOf = (id) => AUCTION.ARCHETYPES.find((a) => a.id === id) || null;
// ── THE AUCTION HOUSE Tier-4 (the deepening) ──
// (1) 3 LEGENDARY rare archetypes + a weekly MARQUEE lot drawn from them (bigger auction:bid/win burns
// — a deeper sink, existing reasons). (2) THE COLLECTOR legend: lifetime $OMR sunk, ranked. (3) COLLECTION
// SETS: read-derived completion goals over the archetypes you've won. (4) player CONSIGNMENT: resell a
// won trophy for a $OMR bidder→seller transfer with a house TAKE that BURNS (deflationary — the house vig).
AUCTION.RARE_ARCHETYPES = [
  { id: 'crown',  name: "A Deposed King's Crown", min: 400,  rarity: 'legendary', blurb: 'It sat on a real head, once.' },
  { id: 'ledger', name: 'The Original Ledger',    min: 600,  rarity: 'legendary', blurb: 'Every debt the old city owed, in one book.' },
  { id: 'idol',   name: 'The Golden Idol',        min: 1000, rarity: 'legendary', blurb: 'Solid. Cursed, they say. You keep it anyway.' },
];
AUCTION.CONSIGN = {
  FEE_OMR: 2,             // the anti-spam listing fee (BURNS — auction:consign:fee)
  TAKE_BPS: 500,          // the house cut on a sale (5%, BURNS — auction:take)
  MIN_RESERVE: 10, MAX_RESERVE: 100000,
  MAX_LIVE: 3,            // concurrent live consignments per seller (the MAX_LISTINGS precedent)
  MS: 48 * 3600 * 1000,   // the block window
  MIN_RAISE_BPS: AUCTION.MIN_RAISE_BPS,
};
AUCTION.SETS = [
  { id: 'full_house', name: 'The Full House',         need: ['plate', 'watch', 'pistol', 'ring', 'painting', 'car'] },
  { id: 'trove',      name: "The Collector's Trove",  need: ['crown', 'ledger', 'idol'] },
];
AUCTION.COLLECTOR_RANKS = [
  { min: 0, name: 'Onlooker' }, { min: 100, name: 'Aficionado' }, { min: 500, name: 'Connoisseur' },
  { min: 2000, name: 'The Curator' }, { min: 8000, name: 'The Grandee' }, { min: 25000, name: 'The Medici' },
];
export const collectorRankOf = (sunk) => {
  let r = AUCTION.COLLECTOR_RANKS[0];
  for (const t of AUCTION.COLLECTOR_RANKS) if (Number(sunk || 0) >= t.min) r = t; return r;
};
// Read-derived collection sets from the DISTINCT archetypes an account has won (rows: [{archetype}]).
export const collectionSetsOf = (winRows) => {
  const have = new Set((winRows || []).map((w) => w.archetype));
  return AUCTION.SETS.map((s) => {
    const got = s.need.filter((a) => have.has(a));
    return { id: s.id, name: s.name, have: got.length, total: s.need.length, complete: got.length === s.need.length,
      missing: s.need.filter((a) => !have.has(a)) };
  });
};
export const auctionRareOf = (id) => AUCTION.RARE_ARCHETYPES.find((a) => a.id === id) || null;
// This week's block: LOTS_PER_WEEK lots drawn deterministically off the §7.11 seed (the same set
// town-wide, verifiable after). Each lot is a unique NUMBERED instance (id '<week>:<slot>', serial
// 'W<week>-<n>') — duplicate archetypes across a week are fine, the serial keeps each one distinct.
export const auctionLotsOf = (week = weekOf()) => {
  const lots = [];
  for (let slot = 0; slot < AUCTION.LOTS_PER_WEEK; slot++) {
    const a = AUCTION.ARCHETYPES[Math.floor(hash01(`auction:${week}:${slot}:${MARKET_SEED}`) * AUCTION.ARCHETYPES.length) % AUCTION.ARCHETYPES.length];
    lots.push({ id: `${week}:${slot}`, week, slot, archetype: a.id, name: a.name, serial: `W${week}-${slot + 1}`, min: a.min, blurb: a.blurb });
  }
  // Tier-4 — THE MARQUEE: one always-legendary lot appended each week, drawn from RARE_ARCHETYPES off the
  // same §7.11 seed (deterministic town-wide). A bigger auction:bid/win sink + the target of the Trove set.
  const rare = AUCTION.RARE_ARCHETYPES;
  if (rare && rare.length) {
    const m = rare[Math.floor(hash01(`auction:${week}:marquee:${MARKET_SEED}`) * rare.length) % rare.length];
    lots.push({ id: `${week}:m`, week, slot: 'm', archetype: m.id, name: m.name, serial: `W${week}-M`, min: m.min, blurb: m.blurb, rarity: 'legendary' });
  }
  return lots;
};

// ── DAILY SOCIAL TASKS ("Spread the Word") ────────────────────────────────────────────────────
// Recurring petty-cash nudges that grow ORGANIC word-of-mouth + referral volume. CASH ONLY (the
// v24 social-reward rule; farmed cash must be laundered — heat + the $2.6M/day wash cap — to
// extract, which bounds its value), petty per task, once/day/account, agent-flagged accounts
// EXCLUDED (the referral precedent), and the reward is gated behind SOCIAL_VERIFY_MODE!=='off' so
// a default/misconfigured server never leaks. The share URLs carry the player's LIVING NAME as
// their referral code (referrals resolve by name, §7.13) — a recruit who uses it pays the sharer
// real referral cash + $OMR on qualification, so this feeds the existing referral loop. ALL
// numbers are founder sign-off levers. Deploy sets SOCIAL_GAME_URL / SOCIAL_X_HANDLE.
// FALLS BACK TO PUBLIC_URL, and that is not tidiness — it is the difference between a working
// referral loop and a dead one. Every share link, brag prompt, profile deep link and card URL is
// built from this. A live server had PUBLIC_URL set (for X sign-in) and SOCIAL_GAME_URL unset, so
// every one of them pointed at the hardcoded default below — a domain that did not resolve. The
// growth loop looked healthy from the inside and sent every recruit into thin air. Nothing could
// have caught it in-process: the string is well-formed, the routes all work, and only DNS disagrees.
// PUBLIC_URL is already the server's own origin (the OAuth callback is derived from it), so
// preferring it means the common single-domain deploy is correct with nothing extra to remember.
export const SOCIAL_GAME_URL = process.env.SOCIAL_GAME_URL || process.env.PUBLIC_URL || 'https://playomerta.com'
export const SOCIAL_X_HANDLE = (process.env.SOCIAL_X_HANDLE || 'OmertaOnRH').replace(/^@/, '')
export const SOCIAL_TASKS = {
  CASH: 300,       // petty cash per task
  ALL_BONUS: 500,  // a small bonus for doing every task in a day
  TASKS: [
    { id: 'sw_post',   name: 'Post about the family', kind: 'tweet',
      desc: 'Tweet about OMERTÀ — tag us and drop your name as a referral code.' },
    { id: 'sw_invite', name: 'Send out your code',    kind: 'referral',
      desc: 'Share your street name as a referral code — a recruit who sticks pays you real cash + $OMR.' },
    { id: 'sw_boost',  name: 'Boost the word',        kind: 'boost',
      desc: 'Follow, retweet, or like the pinned post to push OMERTÀ up the timeline.' },
  ],
}
// Prefilled share intents (client opens these in a new tab). code = the player's living name.
// The share URL is the FRICTIONLESS profile deep link `/u/<code>?ref=<code>` (the BROADCAST rail) —
// a recruit who taps it lands on the profile page whose "ENTER THE CITY →" CTA carries ?ref, so the
// console auto-fills the referral code at sign-up (they type NOTHING). Was the bare domain, which made
// a daily-task tweet require the recruit to manually type the code — the attribution leak this closes.
export const socialShareUrl = (kind, code = '') => {
  const h = SOCIAL_X_HANDLE
  const c = String(code || '').trim()
  const link = c ? `${SOCIAL_GAME_URL}/u/${encodeURIComponent(c)}?ref=${encodeURIComponent(c)}` : SOCIAL_GAME_URL
  const tweet = (text) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`
  if (kind === 'tweet') return tweet(`I'm running the streets in OMERTÀ — a noir mob RPG. Come take the city with me. @${h}`)
  if (kind === 'referral') return tweet(`Come earn with me in OMERTÀ — tap in and I get the credit for bringing you in. @${h}`)
  return `https://x.com/${h}` // boost: the profile / pinned post
}
// The real First-Week social DESTINATIONS (deploy-configurable) — the OMERTÀ handle / community /
// repo, not the bare platform homepages (the L1 fix). ob_x always resolves to the known handle;
// (Discord was retired as a growth funnel — it was never verifiable: there is no Discord sign-in.)
export const SOCIAL_LINKS = {
  ob_x: `https://x.com/${SOCIAL_X_HANDLE}`,
}

// ═══ EMISSION — THE STREET WAGE (the value-creation pivot, founder-directed 2026-07-23;
// design: omerta-value-creation-design.md). The game now CREATES value on a fixed, transparent,
// decaying schedule: a hard-capped Emission Endowment (a tranche of the fixed $OMR supply —
// mirrored on-chain in E2) releases a daily epoch budget that HALVES on a schedule, paid pro-rata
// to measured play (respect gained that epoch), per-account-capped, level-floored, agent-excluded,
// never by chance. The budget is a CEILING, not an obligation — what isn't earned isn't minted.
// Every wage is a ledgered §10.4 mint (`emission:wage`) bounded by the `emission within endowment`
// invariant. ALL numbers are founder sign-off levers — sim + re-derive real-money sizing before
// any launch copy mentions earning. ═══
export const EMISSION = {
  ENDOWMENT_OMR: 1000000,  // lifetime emission ceiling, ever (mirror as the on-chain tranche in E2)
  EPOCH0: Number(process.env.EMISSION_EPOCH0 || 20657), // the first epoch (day number) — halvings count from here
  EPOCH_OMR: 500,          // day-one epoch budget ($OMR/day, a ceiling not an obligation)
  DECAY: 0.5,              // budget multiplier applied every DECAY_EVERY epochs (the halving)
  DECAY_EVERY: 180,        // epochs between halvings (~6 months)
  WAGE_CAP_OMR: 5,         // max wage per account per epoch (anti-concentration / anti-Sybil)
  WAGE_MIN_LVL: 5,         // level floor to draw a wage (the npcHit/WANTED rookie-floor precedent)
  WAGE_MIN_SCORE: 25,      // respect gained in the epoch must clear this — real play, not a login
}
// The Sybil wall (AUDIT-value-creation.md D1, founder-directed): the wage pays only MINTED
// accounts — ones that paid the 0.01-ETH mint fee (or its PLEX price in earned $OMR). The agent
// flag is voluntary and guest accounts are free, so level/score floors alone cost a bot farm
// ~a minute of automation per alt; the mint fee makes every wage-drawing identity cost real
// money (paid to the dev wallet — a Sybil farm funds the house). Free-trial players still play
// and earn everything else; minting was already the extraction gate, so "paid identities earn
// the extractable wage" closes the loop coherently. Env-overridable per-call (the RATE_LIMIT
// precedent) so a closed playtest can waive it: WAGE_REQUIRE_MINTED=off.
export const wageRequireMinted = () => (process.env.WAGE_REQUIRE_MINTED ?? 'on') !== 'off'
export const emissionEpochOf = (ms = Date.now()) => Math.floor(ms / 86400000)
export const epochBudget = (epoch, e = EMISSION) => epoch < e.EPOCH0 ? 0
  : e.EPOCH_OMR * Math.pow(e.DECAY, Math.floor((epoch - e.EPOCH0) / e.DECAY_EVERY))

// ═══ TAX — the transaction tolls on the REAL-value boundary (founder-directed 2026-07-23).
// Complements the existing tax map: in-game P2P takes already feed street_tax → the 12h BUYBACK;
// ETH Store revenue already splits founder/buyback/rwa (STORE.SPLIT_BPS); bonds split POL/Vig.
// This block adds the missing boundary: EXTRACTION. Every $OMR withdrawal pays an exit toll that
// splits DEV revenue + the community BUYBACK pool. Non-refundable (paid at the gate — a cancelled
// queued withdrawal refunds the NET only). Rate read per-call (the RATE_LIMIT precedent) so ops
// can retune without a deploy; numbers are founder sign-off levers. ═══
export const TAX = {
  DEV_BPS: 5000,            // the dev share of each toll (50%); the rest → the buyback/yield pool
}
export const withdrawTaxBps = () => Number(process.env.WITHDRAW_TAX_BPS ?? 200)  // 2% exit toll
// THE EARLY-EXIT SURCHARGE (founder-directed): $OMR younger than FRESH_WINDOW_MS pays an extra,
// LINEARLY-DECAYING toll when it exits (AMM sell or withdrawal) — 50% at hour 0 → 0% at hour 48,
// NO exemptions, split like the exit toll (half dev / half buybacks). Rates read per-call (ops levers).
export const earlySellTaxBps = () => Number(process.env.EARLY_SELL_TAX_BPS ?? 5000)  // 50% at age 0
export const freshWindowMs = () => Number(process.env.FRESH_WINDOW_MS ?? 48 * 3600000) // 48h fade

// ═══ THE FIVE PILLARS (content expansion — omerta-five-pillars-design.md). Every number below is
// a founder sign-off lever. #1 honor / #2 diplomacy / #3 sovereignty / #4 campaigns / #5 bloodline. ═══
export const HONOR = {
  MIN: -100, MAX: 100,
  // Tier-4 — the ladder scales 5→7 (Monster / The Untouchable at the extremes; the middle five
  // are unchanged, so the DREADED −60 / TRUSTED 60 teeth thresholds still land on the same tiers).
  TIERS: [ { min: -100, name: 'Monster' }, { min: -80, name: 'Mad Dog' }, { min: -60, name: 'Ruthless' },
           { min: -20, name: 'Unproven' }, { min: 20, name: 'Respected' }, { min: 60, name: 'Man of Honor' },
           { min: 90, name: 'The Untouchable' } ],
  // deed deltas — single touchpoints at existing sites (the discounted/bumped number is the event)
  REPAY: 2, BODYGUARD_SAVE: 8, VENDETTA_SETTLE: 10,
  WELSH: -15, RAT: -30, SHANK: -12, NPC_HIT: -5, OATHBREAK: -20,
  TRUSTED: 60, DREADED: -60,        // the two teeth thresholds (Man of Honor / Mad Dog)
  LAYLOW_MULT: 0.9,                 // Man of Honor: the judges go easier (stacks multiplicatively)
  HEIR_KEEP: 0.25,                  // the bloodline echo — the heir inherits a quarter of the name's honor
}
export const honorTierOf = (h) => [...HONOR.TIERS].reverse().find((t) => Number(h) >= t.min) || HONOR.TIERS[0]

export const DIPLOMACY = {
  PACT_MS: 7 * 86400000,            // a sworn pact runs a week
  OATHBREAK_MS: 3 * 86400000,       // the oathbreaker mark (no new proposals while it stands)
  COALITION_MS: 7 * 86400000,       // a coalition's mandate (re-form if the target is still dominant)
  DOMINANCE_DISTRICTS: 2,           // holding ≥2 core districts marks a family DOMINANT…
  DOMINANCE_STANDING_MULT: 2,       // …or standing ≥ 2× the runner-up family
  COALITION_MIN: 2,                 // the teeth switch on at 2+ member families
  COALITION_WAR_MULT: 0.5,          // members' war chest vs the target (discounted number ledgered)
  COALITION_SEIZE_MULT: 0.85,       // members' garrison outbid vs the target's districts
}

export const SOV = {
  // TIER-4 §A — the stronghold ladder 3 → 6 (on the cost/garrison/upkeep curve; upgradeSov/tierOf handle
  // any tier, so the extension is content). §C — each tier yields a lazy `incomePerDay` to the treasury
  // (the territory-income pattern): a held stronghold is now a PRODUCTIVE, defensible asset, not a pure
  // sink. The income is a NEW treasury faucet (sim sign-off); garrison/upkeep are treasury sinks (§10.4-safe).
  TIERS: [ { name: 'Outpost', cost: 100000, garrison: 15000, upkeepPerDay: 5000, incomePerDay: 8000 },
           { name: 'Fort', cost: 400000, garrison: 60000, upkeepPerDay: 15000, incomePerDay: 24000 },
           { name: 'Citadel', cost: 1500000, garrison: 250000, upkeepPerDay: 40000, incomePerDay: 65000 },
           { name: 'Bastion', cost: 5000000, garrison: 700000, upkeepPerDay: 90000, incomePerDay: 150000 },
           { name: 'Fortress-City', cost: 15000000, garrison: 2000000, upkeepPerDay: 200000, incomePerDay: 340000 },
           { name: 'The Iron Capital', cost: 40000000, garrison: 5000000, upkeepPerDay: 450000, incomePerDay: 780000 } ],
  WINDOW_H: 2,                      // the daily vulnerability window (UTC, chosen at build)
  SIEGE_COST: 50000,                // the assault chest — burns win or lose (the npchit-fee posture)
  SIEGE_CD_MS: 24 * 3600000,        // per-structure, win or lose (the owner isn't ground down)
  SIEGE_BASE_P: 0.35, SIEGE_STAT_SCALE: 400, SIEGE_TIER_P: 0.08, // p = BASE + atk/SCALE − (tier−1)×TIER_P
  SIEGE_MIN_P: 0.10, SIEGE_MAX_P: 0.75,
  SIEGE_FAIL_DMG: 20,
  OVEREXT_BPS: 5000,                // +50% upkeep per EXTRA district held (EU4 overextension — the anti-snowball)
  UPKEEP_CAP_MS: 7 * 86400000, CRUMBLE_MS: 3 * 86400000, // the pad/cold pattern
  INCOME_CAP_MS: 24 * 3600000,      // TIER-4 §C — the lazy income cap (≤ one day's take per collect)
  SOV_POINTS: [0, 10, 25, 60, 120, 220, 400], // razing a tier-N stronghold scores SOV_POINTS[N] (index by tier)
  RANKS: [ { min: 0, name: 'Street Corner' }, { min: 25, name: 'A Name on the Block' },
           { min: 100, name: 'The Iron Grip' }, { min: 300, name: 'Lords of the City' },
           { min: 800, name: 'The Sovereign' } ],   // Tier-4 §D — the deep rung
}
export const sovRankOf = (p) => [...SOV.RANKS].reverse().find((r) => Number(p) >= r.min) || SOV.RANKS[0]

// #4 — the authored chains. Steps: {say, action, n} advance on the Underworld ACTION stream (the
// errand vocabulary — heal/hire/post/craft/ammo/gun/deal/dice/numbers/train/list/depart/sign/fight);
// {say, choice:[{id,label,honor,cash?}]} is the Fable branch (honor now; a cash branch sweetens the
// final claim). Reward pays ONCE per street per chain (the missions precedent).
export const CAMPAIGN_MIN_STANDING = 25
export const CAMPAIGN_REWARD_TITLE_FINAL = true
export const CAMPAIGNS = [
  { id: 'doc_oath', npc: 'doc', name: 'The Hippocratic Oath',
    blurb: "Doc Moretti's hands shake these days. He needs someone who can keep a secret — and keep men breathing.",
    steps: [
      { say: 'The Doc slides a list across the table. "Three of ours are bleeding out in flophouses. Patch yourself up where I can watch your hands work."', action: 'heal', n: 2 },
      { say: 'A man on the table is a made man from a RIVAL family. The Doc looks at you: "He dies, we lose nothing. He lives, maybe the city owes us one."',
        choice: [ { id: 'save', label: 'Every man on the table is just a man. Save him.', honor: 8 },
                  { id: 'walk', label: 'Walk out. Let the Doc decide alone.', honor: -6, cash: 5000 } ] },
      { say: '"Word got around," the Doc says. "Whichever way it went. One more night on the ward and we\'re square."', action: 'heal', n: 2 },
    ],
    reward: { cash: 10000, standing: 15, honor: 5, title: null } },
  { id: 'vinnie_debt', npc: 'fixer', name: 'A Debt of Blood',
    blurb: 'Vinnie the Match owes somebody an ending. He wants it arranged clean — through the board, like civilized people.',
    steps: [
      { say: '"First, prove you know how the board works. Put paper on somebody — anybody. The pot\'s the message."', action: 'post', n: 1 },
      { say: '"Now the hard part. My debt needs professionals." Hire the work out — the trade has to move through hands like yours.', action: 'hire', n: 1 },
      { say: 'Vinnie lights the match he never strikes. "The man I owed is settled. But there was a witness. A kid."',
        choice: [ { id: 'spare', label: 'A kid is a kid. Walk him home and buy his silence with kindness.', honor: 10 },
                  { id: 'scare', label: 'Scare him so deep he forgets his own name. Cheaper. Uglier.', honor: -10, cash: 8000 } ] },
    ],
    reward: { cash: 12000, standing: 15, honor: 0, title: null } },
  { id: 'bella_daughter', npc: 'armorer', name: "The Gunsmith's Daughter",
    blurb: "Bella Bang-Bang's kid wants into the family business. Bella wants her taught RIGHT — steel first, blood never.",
    steps: [
      { say: '"Show the kid the trade. Work the bench with her watching — crates, powder, the smell of oil."', action: 'craft', n: 1 },
      { say: '"Now the counter. Buy ammo like a professional — count it twice, pay in full, thank the house."', action: 'ammo', n: 2 },
      { say: 'The daughter asks you, quiet, when Bella steps out: "Is there a version of this life that doesn\'t end on a slab?"',
        choice: [ { id: 'truth', label: 'Tell her the truth: no. And that\'s why you bank every dollar.', honor: 6 },
                  { id: 'lie', label: 'Tell her what she wants to hear. Kids fight harder with hope.', honor: -4, cash: 4000 } ] },
    ],
    reward: { cash: 9000, standing: 15, honor: 3, title: null } },
  { id: 'tuna_haul', npc: 'harbor', name: 'The Long Haul',
    blurb: 'Big Tuna has one shipment he cannot lose, and a harbor full of people he cannot trust. Except maybe you.',
    steps: [
      { say: '"Run something first. Anything. I want to see how you handle a manifest before I hand you MINE."', action: 'depart', n: 1 },
      { say: '"Good. Now the market side — list goods on the board. A smuggler who can\'t SELL is just a courier."', action: 'list', n: 1 },
      { say: 'The big shipment lands. Inside the crates: not goods. People. Families, paying their way into the city.',
        choice: [ { id: 'harbor', label: 'Get them somewhere warm. This one\'s free.', honor: 12 },
                  { id: 'fee', label: 'Everyone pays the toll. Everyone.', honor: -12, cash: 10000 } ] },
    ],
    reward: { cash: 12000, standing: 15, honor: 0, title: null } },
  { id: 'madame_house', npc: 'madame', name: 'The House Always Knows',
    blurb: 'The Madame hears everything at the tables. Someone is bleeding her house from the inside, and she wants ears she owns.',
    steps: [
      { say: '"Sit. Play. Watch the dealer\'s left hand." Lose a little money like a gentleman while you watch.', action: 'dice', n: 2 },
      { say: '"The numbers runner. He\'s the leak." Play his game — get close, get the pattern.', action: 'numbers', n: 1 },
      { say: 'You catch the runner skimming — a sick mother, a debt to the wrong people. The Madame wants a NAME tonight.',
        choice: [ { id: 'mercy', label: 'Pay his skim back yourself and tell the Madame the trail went cold.', honor: 10 },
                  { id: 'name', label: 'Give him up. The house is the house.', honor: -8, cash: 7500 } ] },
    ],
    reward: { cash: 11000, standing: 15, honor: 0, title: 'FRIEND OF THE HOUSE' } },
]
export const campaignOf = (id) => CAMPAIGNS.find((c) => c.id === id)

export const BLOODLINE = {
  SCORE: { LEVEL: 10, KILL: 25, HONOR_ABS: 1 },  // dynasty score weights (pure status)
  NUMERALS: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
}
// the epithet a generation earns — first match wins (data-driven, derived at read, never stored)
export const bloodlineEpithet = (g) => {
  if (Number(g.kills) >= 10) return 'the Butcher'
  if (Number(g.honor) >= 60) return 'the Honorable'
  if (Number(g.honor) <= -60) return 'the Mad Dog'
  if (Number(g.level) >= 40) return 'the Great'
  if (Number(g.level) >= 20) return 'the Made'
  if (Number(g.level) <= 3) return 'the Brief'
  return null
}

// ═══ MARRIAGES & SOLDIERS (founder picks #2+#3 — omerta-marriage-soldiers-design.md). Every
// number is a founder sign-off lever. ═══
// Drop A — DYNASTIC MARRIAGE (CK3): account×account ties on the Bloodline. Ceremony fees are
// character_id'd `dynasty:` cash SINKS; the scandal/divorce honor deltas are status.
export const MARRIAGE = {
  PROPOSE_COST: 25000,        // the proposer's half of the ceremony (paid at propose, non-refundable)
  ACCEPT_COST: 25000,         // the acceptor's half (paid at accept — completes the wedding)
  CONSIGLIERE_COST: 10000,    // naming an adviser (the envoy fee, paid at propose)
  SCANDAL: -30,               // killing your in-law — the honor hit; the marriage dissolves on the spot
  DIVORCE: -10,               // walking out on your vows — the initiator's honor hit
  // audit MED-2: the scandal still fires on a kill within this window of divorcing that same house
  // (closes the divorce-one-action-before-the-kill dodge), and the same pair can't RE-marry inside
  // it (slows marry/divorce vendetta-laundering cycles). One tombstone powers both.
  SCANDAL_GRACE_MS: 48 * 3600e3,
}
// Drop B — NAMED SOLDIERS (XCOM): recruit named muscle with ONE trait; they assist jobs, take a
// cut, get injured, and DIE for good. Traits are single-touchpoint modifiers (the skills/decree
// precedent); the gunner world-raid bump is the one emission-adjacent lever (reservoir-bounded).
export const SOLDIERS = {
  MAX: 3,                     // roster cap
  HIRE_COST: 25000,           // `soldier:hire` cash sink
  CUT_BPS: 500,               // the soldier's 5% cut of assisted crime gross (pre-ledger shave — faucet shrinks)
  INJURY_MS: 4 * 3600e3,      // a hurt soldier sits out 4h
  DEATH_P: 0.12,              // death roll on a risky failure (SOLDIER_DEATH_P env is TEST-ONLY)
  XP_PER_JOB: 1, LVL_XP: 10, LVL_CAP: 10,
  SCALE_PER_LVL: 0.10,        // trait strength grows +10%/level above 1 (capped at LVL_CAP)
  TRAITS: {                   // one rolled at hire (uniform), each fires at EXACTLY one site
    wheelman:   { name: 'Wheelman',    fx: 0.15, desc: 'busted crime stints run 15% shorter' },
    safecracker:{ name: 'Safecracker', fx: 0.15, desc: 'The Score lines up 15% sooner' },
    gunner:     { name: 'Gunner',      fx: 20,   desc: '+20 power on cartel raids' },
    lucky:      { name: 'Lucky',       fx: 0.5,  desc: 'half as likely to die when a job goes wrong' },
    lookout:    { name: 'Lookout',     fx: 0.5,  desc: 'half as likely to get hurt when a job goes wrong' },
  },
  FIRST: ['Sal', 'Vinny', 'Rocco', 'Lefty', 'Knuckles', 'Ade', 'Paulie', 'Frankie', 'Mo', 'Curly',
          'Big Tony', 'Little Tony', 'Jimmy', 'Sticks', 'Doc', 'Ice', 'Roxie', 'Vera', 'Dot', 'Mabel'],
  LAST: ['the Hammer', 'Two-Fingers', 'from Canal', 'the Quiet', 'No-Neck', 'the Saint', 'Deuce',
         'the Ghost', 'from the Docks', 'Butterbean', 'the Wrench', 'Half-Pint', 'the Undertow'],
}
export const soldierLevelOf = (xp) => Math.min(SOLDIERS.LVL_CAP, 1 + Math.floor(Number(xp || 0) / SOLDIERS.LVL_XP))
// TIER-4 §soldiers — RANKS (a soldier's grade grows with jobs, the recruit→capo ladder; status only,
// derived from level) + THE COMMANDER LEGEND (lifetime jobs led with a soldier, account-level → survives
// death, the boxing-legend twin; bumped in game.js soldierResult on a successful assist).
SOLDIERS.RANKS = [
  { lvl: 1, name: 'Associate' }, { lvl: 3, name: 'Soldier' }, { lvl: 5, name: 'Enforcer' },
  { lvl: 7, name: 'Capo' }, { lvl: 10, name: 'Caporegime' },
]
export const soldierRankOf = (xp) => { const l = soldierLevelOf(xp); return [...SOLDIERS.RANKS].reverse().find((r) => l >= r.lvl) || SOLDIERS.RANKS[0] }
SOLDIERS.COMMANDER_RANKS = [
  { led: 0, name: 'Street Boss' }, { led: 25, name: 'Field Commander' }, { led: 100, name: 'The General' },
  { led: 300, name: 'The Warlord' },
]
export const commanderRankOf = (led) => [...SOLDIERS.COMMANDER_RANKS].reverse().find((r) => Number(led) >= r.led) || SOLDIERS.COMMANDER_RANKS[0]
// trait strength at a level — linear growth, capped; multiplicative fx (wheelman/safecracker/lucky/
// lookout) scale the REDUCTION, additive fx (gunner) scale the bonus
export const soldierFxOf = (s) => {
  const t = SOLDIERS.TRAITS[s.trait]; if (!t) return 0
  return t.fx * (1 + SOLDIERS.SCALE_PER_LVL * (soldierLevelOf(s.xp) - 1))
}
export const rollSoldierName = () =>
  `${SOLDIERS.FIRST[Math.floor(Math.random() * SOLDIERS.FIRST.length)]} ${SOLDIERS.LAST[Math.floor(Math.random() * SOLDIERS.LAST.length)]}`

// ═══ SECRETS & THE COLLECTION (founder picks #7+#8 — omerta-secrets-collection-design.md).
// Every number is a founder sign-off lever. ═══
// Drop A — BLACKMAIL & SECRETS (CK3 intrigue): dirt as a HELD asset. The dig fee rides the
// existing `intel:` $OMR burn term; the hush payment is the audited taxed two-party transfer
// (`secret:` cash prefix); exposure feeds the RICO meter (the Port BUST_EXPOSURE precedent —
// the exposeHeat set is the one Law-surface lever).
export const SECRETS = {
  DIG_OMR: 10,                 // the shovel — burns win or lose (the npchit-fee posture)
  DIG_CD_MS: 24 * 3600e3,      // per (digger, target)
  TTL_MS: 7 * 86400e3,         // dirt goes stale
  EXTORT_WINDOW_MS: 24 * 3600e3, // pay the hush or it blows
  MAX_HELD: 5,                 // a spy's pocketbook only holds so much
  // dig priority = object order (juiciest first); wealth is BANDED (never an exact figure)
  KINDS: {
    launderer: { name: 'The Wash Records',  hushCap: 250000, exposeHeat: 25 },
    killer:    { name: 'The Bodies',        hushCap: 200000, exposeHeat: 20 },
    cook:      { name: 'The Kitchen Books', hushCap: 150000, exposeHeat: 20 },
    moneybags: { name: 'The Second Ledger', hushCap: 100000, exposeHeat: 12 },
  },
  MONEYBAGS_MIN: 500000,       // the bank floor that makes a second ledger worth keeping
  DEMAND_MIN: 100,             // hush floor — the 2% take never nets the holder ≤ 0 (BODYGUARD_MIN_PRICE precedent)
}
export const secretKindOf = (id) => SECRETS.KINDS[id] || null
// Drop B — THE COLLECTION: category totals derive from the live catalogs (content, never stored).
export const collectionCatalog = () => ({
  crimes:    { name: 'Jobs Pulled',        items: CRIMES.map((c) => ({ id: c.id, name: c.name })) },
  districts: { name: 'The City',           items: DISTRICTS.map((d) => ({ id: d.id, name: d.name || d.id })) },
  cars:      { name: 'The Garage',         items: CARS.map((c) => ({ id: c.id, name: c.name })) },
  guns:      { name: 'The Armory',         items: GUNS.map((g) => ({ id: g.id, name: g.name })) },
  drugs:     { name: 'The Kitchen',        items: DRUGS.map((d) => ({ id: d.id, name: d.name })) },
  boats:     { name: 'The Marina',         items: Object.entries(PORT.BOATS).map(([id, b]) => ({ id, name: b.name })) },
  goods:     { name: 'The Trade',          items: GOODS.map((g) => ({ id: g.id, name: g.name })) },
  fixtures:  { name: 'The Underworld',     items: Object.entries(UNDERWORLD.NPCS).map(([id, n]) => ({ id, name: n.name })) },
  relics:    { name: 'The Relics',         items: CLUES.RELICS.map((r) => ({ id: r.id, name: r.name })) }, // Tier-4 §C — casket trophies
})

// ═══ THE MEGAPROJECT (founder pick #1 — the collective monument). ALL numbers are founder
// sign-off levers. Targets are sized for the alpha base (a shared weeks-long goal, not an
// afternoon); OMR_RATE is the FIXED $-credit per donated $OMR (the genesis AMM rate — never the
// live spot, so the credit is deterministic and unmanipulable). Pure sinks + status. ═══
export const MEGAPROJECT = {
  MONUMENTS: [
    { id: 'cathedral_restoration', name: 'The Cathedral Restoration', district: 'cathedral',
      target: 25_000_000, blurb: 'The old church kept every secret this city ever whispered. Put her spire back against the sky.' },
    { id: 'grand_casino', name: 'The Grand Casino', district: 'neon',
      target: 60_000_000, blurb: 'A palace of vice with your name in the lobby marble. The Mile deserves a crown.' },
    { id: 'founders_bridge', name: "The Founder's Bridge", district: 'docks',
      target: 150_000_000, blurb: 'Steel across the bay — every crate in the city will roll over it, forever.' },
    { id: 'colossus', name: 'The Colossus of the Docks', district: 'docks',
      target: 400_000_000, blurb: 'A statue taller than the cranes, facing the sea. Let the next boat in know whose town this is.' },
    // ── Tier-4 catalog expansion (on-curve; the city keeps growing) ──
    { id: 'opera_house', name: 'The Grand Opera House', district: 'cathedral',
      target: 900_000_000, blurb: 'A thousand seats under a painted heaven. The city will finally have somewhere to be seen.' },
    { id: 'skyway', name: 'The Elevated Skyway', district: 'canal',
      target: 2_000_000_000, blurb: 'A rail line above the flood — the whole town rides over the water your grandfather drowned in.' },
    { id: 'central_tower', name: 'Central Tower', district: 'neon',
      target: 5_000_000_000, blurb: 'A hundred floors of glass and money. From the top you can see every corner you own.' },
    { id: 'eternal_flame', name: 'The Eternal Flame', district: 'cathedral',
      target: 12_000_000_000, blurb: "A fire that never goes out, for the ones who built this city and never got their names in stone. Now they will." },
  ],
  MIN_CASH: 100,          // smallest cash brick
  MIN_OMR: 1,             // smallest $OMR brick
  OMR_RATE: 500,          // $-value credited per donated $OMR (fixed lever, genesis AMM rate)
  MILESTONES: [0.25, 0.5, 0.75],  // streets-feed scaffolding announcements
  TIERS: [                // plaque tiers by contribution RANK (computed at read, pure status)
    { rank: 1,  title: 'The Architect' },
    { rank: 3,  title: 'Foreman' },
    { rank: 10, title: 'Patron' },
    { rank: Infinity, title: 'Builder' },
  ],
  // Tier-4 — THE BUILDER LEGEND: lifetime $-value contributed to monuments (account-level, survives
  // death — the plaque records a single monument; this is the dynasty's whole-city legacy). Status.
  BUILDER_RANKS: [
    { at: 0,             name: 'Bystander' },
    { at: 100000,        name: 'Bricklayer' },
    { at: 5000000,       name: 'Mason' },
    { at: 50000000,      name: 'Builder' },
    { at: 500000000,     name: 'City Father' },
    { at: 5000000000,    name: 'The Founder' },
  ],
};
export const megaMonumentAt = (seq) => MEGAPROJECT.MONUMENTS[seq] || null;
export const megaTierOf = (rank) => (MEGAPROJECT.TIERS.find((t) => rank <= t.rank) || MEGAPROJECT.TIERS.at(-1)).title;
export const builderRankOf = (built = 0) => {
  const b = Number(built) || 0;
  return [...MEGAPROJECT.BUILDER_RANKS].reverse().find((r) => b >= r.at) || MEGAPROJECT.BUILDER_RANKS[0];
};

// ═══ THE DUELING LADDER (slate #5 — ranked ELO). ALL numbers are founder sign-off levers.
// The money is the audited casino:pvp taxed transfer (zero new emission); the rating is pure
// status, seasonal (reset to ELO_START at rollover), Sybil-damped by the per-pair daily K decay. ═══
export const DUELS = {
  ELO_START: 1000, ELO_K: 32, ELO_FLOOR: 100,
  VARIANCE: 40,            // the roll on top of the eff-stat sum (build decides, dice flavor)
  MIN_LVL: 5,              // both parties — the rating floor (anti-alt)
  LEGEND_MIN_LVL: 10,      // lifetime duel_wins credit needs a real opponent (the WHEEL floor)
  STAKE_MIN: 1000, RAKE_BPS: 500,
  CHALLENGE_CD_MS: 10 * 60 * 1000,   // the challenger cools between duels (the races precedent)
  RANKS: [
    { elo: 0,    title: 'Street Fighter' },
    { elo: 1050, title: 'Contender' },
    { elo: 1150, title: 'Enforcer' },
    { elo: 1300, title: 'Duelist' },
    { elo: 1450, title: 'Il Campione' },
  ],
};
export const duelRankOf = (elo) => [...DUELS.RANKS].reverse().find((r) => Number(elo) >= r.elo) || DUELS.RANKS[0];
// ── DUELS TIER-4 DEEPENING (design omerta-tier1-deepening-design.md §1) ──
// DIVISIONS (a competitive ladder over the raw ELO — the boxing-rank/league shape), WEAPON STYLES
// (a rock-paper-scissors combat axis so the BUILD isn't the only thing that decides), the season
// BELT + account-level TITLES (survive death — the boxing-belt/hitman-rep precedent), and GRUDGE
// rematches (a beaten duelist chases redemption on a shorter cooldown). All status/combat — the
// wager stays the audited casino:pvp transfer, so §10.4 is UNTOUCHED. All numbers sign-off levers.
DUELS.DIVISIONS = [
  { elo: 0,    name: 'Bronze',  tag: 'B' },
  { elo: 1100, name: 'Silver',  tag: 'S' },
  { elo: 1250, name: 'Gold',    tag: 'G' },
  { elo: 1400, name: 'Platinum', tag: 'P' },
  { elo: 1550, name: 'Diamond', tag: 'D' },
  { elo: 1700, name: 'Master',  tag: 'M' },
];
export const duelDivisionOf = (elo) => [...DUELS.DIVISIONS].reverse().find((d) => Number(elo) >= d.elo) || DUELS.DIVISIONS[0];
// STYLES: each beats one, loses to another (the classic triangle). Brawler > Gunslinger > Fencer >
// Brawler. A matched-up style gets STYLE_EDGE on its contest roll; a mirror is neutral. Reading the
// board (an opponent's listed style is public) and counter-picking is the skill.
DUELS.STYLES = [
  { id: 'brawler',    name: 'Brawler',    beats: 'gunslinger', blurb: 'Close the distance and swing.' },
  { id: 'gunslinger', name: 'Gunslinger', beats: 'fencer',     blurb: 'Fast hands, faster iron.' },
  { id: 'fencer',     name: 'Fencer',     beats: 'brawler',    blurb: 'Footwork and the point.' },
];
export const duelStyleOf = (id) => DUELS.STYLES.find((s) => s.id === id) || null;
DUELS.STYLE_EDGE = 1.15;        // the favorable-matchup multiplier on the contest roll (combat, no §10.4)
DUELS.GRUDGE_CD_MULT = 0.34;    // a REMATCH vs someone who last beat you cools ~⅓ as long (chase it back)
export const DUEL_TITLE_RANKS = [
  { titles: 1, name: 'Belt Holder' },
  { titles: 3, name: 'Repeat Champion' },
  { titles: 6, name: 'Dynasty of the Ring' },
  { titles: 12, name: 'The Immortal Duelist' },
];
export const duelTitleRankOf = (n) => [...DUEL_TITLE_RANKS].reverse().find((r) => Number(n) >= r.titles) || null;

// ═══ CLUE SCROLLS (slate #4 — treasure trails). ALL numbers are founder sign-off levers.
// The casket is the drop's ONE new faucet, bounded three ways (the 2% drop × one active hunt ×
// the 8h post-casket cooldown → ≤ ~3 caskets/day ≈ $36k/day hard ceiling — sim probe P9.19). ═══
export const CLUES = {
  DROP_P: 0.02,            // per successful crime (only with no active scroll + cooldown clear)
  STEPS_MIN: 3, STEPS_MAX: 5,
  DIG_ENERGY: 5,
  CASKET_MIN: 3000, CASKET_MAX: 12000,
  CLUE_CD_MS: 8 * 3600 * 1000,       // after a casket, the streets go quiet for a spell
  TIMED_P: 0.35,           // some steps only answer in a 6h city-hour window
  RIDDLES: {               // district flavor — the riddle text derives from these
    docks: 'Dig where the cranes bow to the sea.',
    canal: 'Under the bridge where the water keeps secrets.',
    brick: 'Between the kilns, where the clay remembers.',
    neon: 'Beneath the sign that never sleeps.',
    cathedral: 'In the shadow of the spire, third stone from grace.',
    foundry: 'Where the slag cools and nobody asks questions.',
  },
  WINDOWS: [               // the timed variants ("when the city sleeps")
    { lo: 0, hi: 5, text: 'when the city sleeps' },
    { lo: 6, hi: 11, text: 'in the working morning' },
    { lo: 12, hi: 17, text: 'in the loud afternoon' },
    { lo: 18, hi: 23, text: 'after the lamps come on' },
  ],
  RANKS: [
    { caskets: 0, title: 'Mudlark' },
    { caskets: 5, title: 'Digger' },
    { caskets: 20, title: 'Treasure Hunter' },
    { caskets: 60, title: 'The Cartographer' },
    { caskets: 150, title: 'Master of the Trail' },   // Tier-4 §D — the deep-legend rung
  ],
};
export const clueRankOf = (n) => [...CLUES.RANKS].reverse().find((r) => Number(n) >= r.caskets) || CLUES.RANKS[0];
// ── TIER-4 §A — TRAIL TIERS: longer trails, bigger caskets, rarer drops. The tier is rolled at drop
// (weighted — harder is rarer) and stored on the scroll; it sets the step count, the casket band
// (the FAUCET — flag master for sim), and the relic rarity. numbers keeps the entry hook cheap. ──
CLUES.TIERS = [
  { id: 'easy',   name: 'a Sealed Scroll',    steps: 3, casketMin: 3000,  casketMax: 9000,   weight: 45, relicP: 0.02 },
  { id: 'medium', name: 'a Coded Scroll',     steps: 4, casketMin: 7000,  casketMax: 18000,  weight: 30, relicP: 0.04 },
  { id: 'hard',   name: 'a Cryptic Scroll',   steps: 5, casketMin: 14000, casketMax: 34000,  weight: 16, relicP: 0.08 },
  { id: 'elite',  name: 'a Sovereign Scroll', steps: 6, casketMin: 28000, casketMax: 62000,  weight: 7,  relicP: 0.15 },
  { id: 'master', name: 'a Master Scroll',    steps: 7, casketMin: 55000, casketMax: 120000, weight: 2,  relicP: 0.30 },
];
export const clueTierOf = (id) => CLUES.TIERS.find((t) => t.id === id) || CLUES.TIERS[0];
export const rollClueTier = (r) => {   // r ∈ [0,1) from the caller (game.js) — weighted pick
  const total = CLUES.TIERS.reduce((a, t) => a + t.weight, 0);
  let x = r * total;
  for (const t of CLUES.TIERS) { if (x < t.weight) return t; x -= t.weight; }
  return CLUES.TIERS[0];
};
// §C — RELICS: status collectibles a casket can yield (rarity scaled by tier). NEVER $OMR (the RWA
// rule) — logged to the Collection ('relics' category), the rare-drop chase off the sim economy.
CLUES.RELICS = [
  { id: 'brass_compass', name: 'A Brass Compass' }, { id: 'smugglers_map', name: "A Smuggler's Map" },
  { id: 'silver_doubloon', name: 'A Silver Doubloon' }, { id: 'jade_idol', name: 'A Jade Idol' },
  { id: 'crown_shard', name: 'A Shard of the Old Crown' }, { id: 'ledger_page', name: "A Page of the Founder's Ledger" },
  { id: 'ivory_die', name: 'A Loaded Ivory Die' }, { id: 'blood_ruby', name: 'The Blood Ruby' },
];
export const clueRelicOf = (id) => CLUES.RELICS.find((r) => r.id === id) || null;
// §B — the PUZZLE KIND: the same ANSWER (stand in district d) dressed as a richer riddle. The dig
// check is unchanged; only the riddle TEXT decodes to the district. Deterministic off the salt.
const clueScramble = (s, salt) => {   // a deterministic anagram of the district name
  const a = s.split('');
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(hash01(`clue:scr:${salt}:${s}:${i}`) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join('').toUpperCase();
};
const clueCaesar = (s, k) => s.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 65 + k) % 26 + 65));
// the deterministic hunt: every step of a scroll derives from its stored salt (server-verifiable,
// no stored answers — the §7.11 machinery). Returns {district, window|null, kind, riddle}.
export const clueStepOf = (salt, step) => {
  const d = DISTRICTS[Math.floor(hash01(`clue:${salt}:${step}:d`) * DISTRICTS.length)].id;
  const timed = hash01(`clue:${salt}:${step}:t`) < CLUES.TIMED_P;
  const w = timed ? CLUES.WINDOWS[Math.floor(hash01(`clue:${salt}:${step}:w`) * CLUES.WINDOWS.length)] : null;
  const k = hash01(`clue:${salt}:${step}:k`);
  let kind = 'riddle', riddle;
  if (k < 0.30) { kind = 'anagram'; riddle = `Unscramble the ground — "${clueScramble(d, salt)}" — and dig there.`; }
  else if (k < 0.55) { const sh = 1 + Math.floor(hash01(`clue:${salt}:${step}:cs`) * 24); kind = 'cipher'; riddle = `A word shifted (Caesar +${sh}): "${clueCaesar(d, sh)}". Decode it and dig.`; }
  else { riddle = CLUES.RIDDLES[d] || `Dig in ${d}.`; }
  return { district: d, window: w, kind, riddle: riddle + (w ? ` Come ${w.text}.` : '') };
};

// ═══ SEASONAL LEAGUE MODIFIERS (slate #6 — the PoE league twist). THE ONE DROP THAT TOUCHES
// SIGNED LEVERS BY DESIGN: each 28-day season draws ONE modifier from this small founder-approved
// pool, deterministically off the season index + MARKET_SEED (the §7.11 ethos — no state, no
// cron; every touchpoint COMPOSES multiplicatively on an EXISTING modifier site, the decree
// pattern, and the modified number is what's ledgered). ALL multipliers are sign-off levers;
// one season in four is vanilla so the baseline stays felt. SEASON_MOD is a TEST-ONLY override. ═══
export const SEASON_MODS = [
  { id: 'dead_quiet', name: 'Dead Quiet', blurb: 'The city holds its breath. No twist this season — play it straight.' },
  { id: 'the_crackdown', name: 'The Crackdown', blurb: 'The Bureau is everywhere. Cases build faster; the judges are cheap.',
    lawGainMult: 1.25, laylowMult: 0.75 },
  { id: 'blood_in_the_streets', name: 'Blood in the Streets', blurb: 'The knives are out. Kills loot deeper; going to ground costs more.',
    lootMult: 1.15, safehouseMult: 1.25 },
  // tradeSellMult 1.05 → 1.03 (AUDIT-slate-drops #1): at ×1.05 the sell-only bonus flipped a
  // SAME-DISTRICT buy→sell round trip past the 4% fee wall — ~+1% riskless per cycle, trunk-bounded
  // but repeatable for a whole 28-day season. 1.03 sits under the wall, so the season still pays
  // traders who actually MOVE freight (the arbitrage spread is what it rewards) and pays nothing for
  // standing still. The alternative dial (make the mult buy+sell symmetric) kills the flavour.
  { id: 'the_gold_rush', name: 'The Gold Rush', blurb: 'Trade fever. Every good sells rich — move freight while it lasts.',
    tradeSellMult: 1.03 },
];
// NOTE: this 28-day clock is textually duplicated in worker.js runSeasonRollover (`dayOf()/28`) —
// they MUST agree; if the 28 ever becomes a lever, change BOTH (red-team flag, AUDIT-slate-drops.md).
export const seasonIdxOf = (day = dayOf()) => Math.floor(day / 28);
export const seasonModOf = (seasonIdx = seasonIdxOf()) => {
  const ov = process.env.SEASON_MOD; // TEST-ONLY (boot-guard listed)
  if (ov != null) return SEASON_MODS.find((m) => m.id === ov) || SEASON_MODS[0];
  // DORMANT until the founder arms it (SEASON_MODS=on, read per call — the SOCIAL_VERIFY_MODE
  // posture): this is the one drop that twists SIGNED levers, so it ships vanilla until the
  // pool is production-signed. Dormant == Dead Quiet everywhere.
  if ((process.env.SEASON_MODS || 'off') !== 'on') return SEASON_MODS[0];
  return SEASON_MODS[Math.floor(hash01(`seasonmod:${seasonIdx}:${MARKET_SEED}`) * SEASON_MODS.length)];
};
export const seasonDaysLeft = (day = dayOf()) => 28 - (day % 28);

// ── THE POPULATION (NPC residents) ─────────────────────────────────────────────────────────────
// Design: omerta-npc-population-design.md. OMERTÀ is a multiplayer game launching with ~zero players,
// so every board that reads `characters` is dead in an empty alpha. A living NPC population fills all
// of them at once, because they are REAL characters (the convoys.is_npc precedent) — jumpable,
// contractable, tappable, robbable through the SAME audited code paths a real player uses.
// ALL numbers are founder sign-off levers; `npc:seed` is the one new cash faucet (sim P9.21).
export const POPULATION = {
  TARGET: 48,              // headcount the worker keeps the city topped up to
  SPAWN_PER_TICK: 4,       // the city fills in visibly instead of appearing all at once
  RETIRE_GENERATIONS: 6,   // a resident's bloodline is retired past this many deaths (caps death:legacy creep)
  // Level bands. `w` is the spawn weight, so the roster spans the range instead of clustering at the
  // bottom. `seed` is the cash a resident is spawned holding — the FAUCET, deliberately modest: a
  // resident is scenery with a wallet, not a treasure chest. M3.LOOT_MIN_LVL (10) already means the
  // bottom two bands carry NOTHING lootable, so the cheap end of the population can't be farmed.
  BANDS: [
    { id: 'corner',  w: 34, lvl: [2, 9],   seed: [200, 1200],     stat: [4, 12] },
    { id: 'made',    w: 38, lvl: [10, 24], seed: [2000, 12000],   stat: [10, 30] },
    { id: 'capo',    w: 20, lvl: [25, 44], seed: [15000, 60000],  stat: [28, 60] },
    { id: 'boss',    w: 8,  lvl: [45, 70], seed: [60000, 200000], stat: [55, 110] },
  ],
};
// A resident's name: noir first + last, drawn from pools. Uniqueness is enforced by the caller
// (living names are unique game-wide), which retries on a collision.
export const NPC_FIRST = ['Sal', 'Vito', 'Carmine', 'Rocco', 'Nunzio', 'Gino', 'Aldo', 'Silvio',
  'Marco', 'Enzo', 'Bruno', 'Dario', 'Franco', 'Lorenzo', 'Matteo', 'Nico', 'Paulie', 'Renzo',
  'Tommy', 'Vinnie', 'Angelo', 'Bobby', 'Cesare', 'Donnie', 'Emilio', 'Fausto', 'Gaetano', 'Hugo',
  'Ivo', 'Joey', 'Luca', 'Mario', 'Otto', 'Pino', 'Remo', 'Santo', 'Turi', 'Umberto'];
export const NPC_LAST = ['Fontana', 'Marchetti', 'Bellini', 'Corsaro', 'Battaglia', 'Ricci',
  'Moretti', 'Gallo', 'Rizzo', 'Bruno', 'Ferraro', 'Greco', 'Conti', 'Costa', 'Vitale', 'Serra',
  'Pagano', 'Sorrentino', 'Barone', 'Palumbo', 'Longo', 'Farina', 'Grasso', 'Rinaldi', 'Damico',
  'Testa', 'Fabbri', 'Orlando', 'Bianchi', 'Riva', 'Milano', 'Napoli', 'Sciarra', 'Tumbarello'];
// pick a band by weight from a [0,1) roll
export const npcBandOf = (roll) => {
  const total = POPULATION.BANDS.reduce((a, b) => a + b.w, 0);
  let x = roll * total;
  for (const b of POPULATION.BANDS) { x -= b.w; if (x < 0) return b; }
  return POPULATION.BANDS[0];
};
// ── THE POPULATION step two — BEHAVIOURS ───────────────────────────────────────────────────────
// The city ACTS. Every behaviour below obeys one rule: a resident may only ever RECYCLE value it
// already holds, never conjure it at the point of sale. So there is NO new faucet in step two —
// each behaviour either moves zero value (drift, consent limits) or parks cash the resident was
// already seeded with into an EXISTING audited escrow (the loan offer, the market buy-order), which
// the existing sweeps refund on expiry. All numbers are founder sign-off levers.
POPULATION.BEHAVIOUR = {
  ACT_PER_TICK: 6,          // residents that get a turn each worker tick — the city stirs, it doesn't stampede
  KEEP_FLOOR: 0.35,         // never park more than (1 − this) of a resident's cash: they stay lootable and can back their limits
  // consent-by-listing: what a resident is willing to be challenged for. Sized to holdings so a
  // resident can always cover what they've advertised.
  //
  // (red-team) There is deliberately NO population-owned floor here. These three columns are
  // written by direct SQL, which bypasses offerBodyguard / listDuel / setFadeLimit — and with them
  // every bound those routes enforce. So each limit is gated by ITS OWN system's constant
  // (M3.BODYGUARD_MIN_PRICE, DUELS.STAKE_MIN, CASINO.MIN_BET/MAX_BET) and a resident that can't
  // reach one simply doesn't offer that service. Those constants stay the single source of truth,
  // so moving one moves the residents with it.
  GUARD_BPS: 1200,          // bodyguard asking price, as bps of cash (floored at BODYGUARD_MIN_PRICE)
  FADE_BPS: 800,            // back-room dice fade limit (bounded by CASINO.MIN_BET/MAX_BET)
  DUEL_BPS: 900,            // duelling-ladder stake limit (floored at DUELS.STAKE_MIN)
  // the Shylock: residents lend SECURED only, so a defaulter forfeits a pledged car worth more than
  // the debt (the audited grace-forfeit sweep is the enforcement — an NPC never calls collectLoan).
  LOAN_BPS: 3000,           // principal as bps of cash
  LOAN_RATE: [0.15, 0.45],  // the vig they ask
  LOAN_HOURS: [12, 72],
  LOAN_COLLATERAL_MULT: 1.3, // pledged-car floor as a multiple of what's OWED — defaulting always costs more than the loan
  // the Black Market: a standing buy order gives players a reliable cash buyer for goods they
  // actually hold. A fair exchange, bounded by the resident's own cash.
  ORDER_BPS: 2500,          // escrow as bps of cash
  ORDER_PRICE_BPS: [9000, 11000], // they bid 90–110% of a good's base — sometimes a bargain, sometimes not
};
// ── THE POPULATION step three — THE TURNOVER ───────────────────────────────────────────────────
// Steps one/two lit the city up ONCE: residents have no income, so the seed pool is a STOCK, not a
// flow (the red-team's correction to the sim's own claim). Once players drain it — duels, fades,
// order-fills, kills — the stake-backed boards go quiet again and the alpha is back where it
// started. So the worker now RETIRES a resident players have picked clean and lets the top-up put a
// fresh face in their place: the city renews itself.
//
// That makes `npc:seed` a RECURRING faucet rather than a one-shot, which is exactly why it gets an
// explicit ceiling — and the ceiling meters RETIREMENTS, not seeding. Every retirement is what
// creates the vacancy a fresh seed pays for, so counting them bounds the faucet exactly; counting
// dollars seeded does not, because the day-one fill of an empty city is ~48 seeds that replace
// nobody and would eat the whole allowance before a single resident had been drained.
//
// So the rule reads plainly: **at most PER_DAY residents are replaced in a day** — a headcount, held
// in the `population_state` singleton (restart-proof, and free of any genesis interaction). At the
// weighted mean seed that bounds the faucet at roughly $500k/day, the same band as a territory
// racket or the boxing purse. Spent, the city simply keeps its drained residents until the day rolls.
POPULATION.TURNOVER = {
  // "picked clean" = holding less than this share of what they ARRIVED with. Compared against
  // `characters.npc_seed`, never a flat cash floor: a flat floor can't tell a drained boss from a
  // corner kid who was BORN with $200, and would respawn the cheap bands forever — an infinite
  // faucet loop. The margin is deliberate: a resident who has parked the maximum in escrow (a loan
  // offer plus a buy order) still holds ~52% of their stake, well clear of this line.
  DRAINED_BPS: 1500,  // 15% of what they arrived with
  PER_DAY: 24,        // residents replaced per day — half the city, ≈$500k/day of npc:seed at the mean
};

// ── TOKENOMICS v2 (founder-directed 2026-07-27) ──────────────────────────────────────────────────
// The thesis: cash → OMR is severed, so in-game cash inflation stops being a token-price decision.
// Design: omerta-tokenomics-v2-design.md. Every number here is a founder sign-off lever.
export const EXCHANGE = {
  // Cash paid per OMR burned. Anchored at the retired AMM's genesis spot. THE NUMBER THAT WILL NEED
  // REVISITING: it is fixed while cash inflates (a maxed passive stack measures $21.6M/day), so the
  // window gets progressively less attractive in real terms. That self-limits rather than breaking,
  // but it wants a look each season — indexing it to the pool's own growth is the obvious v2.1.
  RATE: 500,
  MIN_OMR: 1,                  // no dust redemptions
  // THE INTERLOCK. The design's claim that "arbitrage is impossible by construction" holds ONLY
  // once cash → OMR is severed (design §2): while the AMM buy side is still live and spot sits
  // below RATE, anyone can buy $OMR with cash and redeem it here for more cash — a money pump.
  // So the window stays SHUT until step 2 retires the buy direction, and this flips true in that
  // same commit. `test/tokenomics.js` asserts the interlock directly (it tries a swap buy: if
  // cash → $OMR still works, the window MUST be closed), so opening it early fails the suite
  // rather than quietly printing money. `EXCHANGE_OPEN=on` overrides for tests — never production.
  //
  // OPENED in tokenomics v2 step 2 — the SAME change that retired the AMM in both directions and
  // with it `launderAtBusiness`. That is the interlock DISCHARGED, not bypassed: with no way to turn
  // cash into $OMR there is no outside price to pump the fixed rate against, so "arbitrage is
  // impossible by construction" is now true rather than aspirational. The test that enforced it
  // flips with the code — it now asserts the buy side really is gone AND the window really is open,
  // so re-introducing cash → $OMR without shutting the window fails the suite.
  OPEN: true,
  DAILY_CAP_OMR: 250,          // per account, rolling 24h — the wash-cap token-bucket pattern
  // The pool is FED, never created: this share of the street-tax pool (which every in-game take
  // already feeds) moves across on the same 12h tick the buyback runs on. A dry pool refuses
  // cleanly and burns nothing — the Phase-4 stake-pool discipline: a claim on what was funded,
  // never a promise.
  //
  // 10000 since step 2: with the AMM retired the street take has NOWHERE else to go — it used to be
  // spent buying $OMR off the pool, and there is no pool. Leaving a share behind would just grow a
  // pile of dead cash and make the window needlessly thinner. So the rule is simple and honest:
  // every cut the house takes in the city is what the window pays out.
  FUND_BPS: 10000,
};

// What individual staking rewards and personal RWA dividends are repurposed into. Standing already
// buys Commission seats (status); now it pays, so tribute, wars and the seasonal standing reset
// carry a real economic prize — and OMR gains a reason to be held by an ORGANISATION rather than
// sold by a person. Paid into gangs.omr_reserve, which already funds seals, foundations and the
// family RWA book. A pure TRANSFER (pool → reserve, both in omrBuckets) — nothing is minted.
// Read PER CALL, never at import (the RATE_LIMIT / SEASON_MODS precedent) so a test can open the
// window without a module-cache reload. Production runs on EXCHANGE.OPEN alone.
export const exchangeOpen = () => EXCHANGE.OPEN || process.env.EXCHANGE_OPEN === 'on';

export const FAMILY_YIELD = {
  SEATS: 5,
  WEIGHTS: [5, 4, 3, 2, 1],    // descending by standing rank (the Commission-levy pattern)
  MIN_PAYOUT: 0.01,            // don't write dust rows
  // THE FAMILY'S CUT of every redemption at the Exchange window: this share of what a player burns
  // is TRANSFERRED to the family pot instead of leaving supply (`exchange.js:redeem`).
  //
  // RE-HOMED 2026-07-29. It used to read "a share of each 12h buyback", shipped at 0 as a migration
  // dial, and said to raise it once individual yield retired. Step 2 retired individual yield AND
  // rewrote the buyback so it no longer buys $OMR — so the source this was a share OF ceased to
  // exist, nothing ever read the constant, and turning it up would have done nothing. The family
  // yield's only inflow was the one-time legacy drain. Redemption is now the only place $OMR goes
  // to die, which makes it the only honest thing to fund the families from, and it is self-funding:
  // the cut scales with real redemption volume rather than being a subsidy.
  //
  // §10.4-neutral: `window:burn` is in `omrBurns`, `yield:` is in neither the mint nor the burn
  // term, so this reclassifies part of an existing debit — no new reason, no invariant change.
  // The honest cost is LESS DEFLATION, which is why it ships small. Founder sign-off lever.
  FUND_BPS: 500,   // 5% of each redemption
};

// ═══════════════ THE TRADES — the mastery expansion (omerta-mastery-design.md) ═══════════════
// RuneScape-style use-XP, pointed at the verbs the game already has. Founder-directed 2026-07-29;
// founder decisions recorded in the design doc: (1) death rule = die + bloodline echo (HEIR_KEEP_BPS,
// dial to 0 for hard death) + an account-level lifetime legend; (2) path disadvantages = progression
// speed (step 3); (3) stats-by-use tightly capped (step 4).
//
// THE CONSTRAINT SET (from the design map — each is load-bearing):
//  - Masteries pay ZERO respect and gate ZERO character levels. Respect stays the only level
//    currency (the level-240 speedrun class). A trade is the trade_rep class: a domain track.
//  - XP is NOT a currency: bumpMastery writes zero transactions rows, so §10.4 has no surface here.
//  - Every XP source is an action that already paid its nerve/energy/cash/cooldown — no new farm
//    loop exists, only new reward for the existing ones. Awards are sized so XP-per-resource stays
//    comparable across tracks (no one true farm).
//  - No purchased XP, ever (the GIFT_CAP structural rule taken to 100%).
// ALL numbers below are founder sign-off levers (BALANCE.md — THE TRADES).
export const MASTERY = {
  // The ten trades. `stat` is the step-4 stat-by-use target (which core stat this trade exercises);
  // it is DATA today — step 1 wires no stat drip.
  TRACKS: [
    { id: 'larceny',    name: 'Larceny',    stat: 'cunning', desc: 'Every job pulled on the streets.' },
    { id: 'wetwork',    name: 'Wet Work',   stat: 'muscle',  desc: 'Kills, shanks, and duels — the lethal arts.' },
    { id: 'chemistry',  name: 'The Cook',   stat: 'cunning', desc: 'Batches cooked and product moved.' },
    { id: 'wheels',     name: 'Wheels',     stat: 'speed',   desc: 'Cars boosted and races run.' },
    { id: 'seamanship', name: 'Seamanship', stat: 'speed',   desc: 'Contraband landed and prizes taken at sea.' },
    { id: 'gambling',   name: 'The Gambler', stat: 'cunning', desc: 'Action at the tables and the windows.' },
    { id: 'muscle',     name: 'Protection', stat: 'muscle',  desc: 'Jumps, shakedowns, and standovers.' },
    { id: 'commerce',   name: 'Commerce',   stat: 'cunning', desc: 'Goods moved and markets worked.' },
    { id: 'scores',     name: 'Big Scores', stat: 'speed',   desc: 'Heists cased and pulled.' },
    { id: 'fists',      name: 'Fisticuffs', stat: 'muscle',  desc: 'The fight game, corner to canvas.' },
  ],
  // The curve — the game's own quadratic (the levelOf shape): lvl = floor(sqrt(xp/DIV)) + 1, capped.
  // At the measured crime pace (~60/hr) larceny reads ~L10 in ~7h of focused grind, ~L25 across a
  // couple of dedicated days, L50 in RuneScape-99 territory. Founder levers.
  XP_DIVISOR: 15,
  MAX_LVL: 50,
  // XP per action, keyed by the bumpMastery action tag (the bumpStanding shape — flat awards; the
  // action's own resource cost is the throttle). Sized ~proportional to that cost so no track is
  // the one true farm: crime ~3/2 nerve, deal ~4/1 nerve+goods, a kill is rare and expensive.
  // RETUNED at the step-2 gate (the BALANCE flag): once milestone perks exist, XP/hr is a power
  // number — the analytic pace check found the den 4-40x faster than larceny (1 nerve/play, and the
  // Madame comps even that) while the cooldown-gated tracks starved (scores L25 measured ~4,700h).
  // Den awards halved + gated behind GAMBLER_MIN_STAKE; cooldown tracks sized so a level rewards the
  // loop's NATURAL daily cadence (an exhibition every 6h, a Score every 8h), not an impossible grind.
  XP: {
    crime: 3,                  // per SUCCESSFUL §7.2 job (nerve-throttled, the core grind ~180xp/hr)
    jump: 4, shakedown: 6, standover: 10,        // muscle — contest WINS only
    fire: 25, shank: 20, duel: 10,               // wetwork — a kill is rare, gated, expensive
    cook: 12, deal: 6,                           // chemistry — batches are slow clocks
    boost: 5, race: 15,                          // wheels — races ride a 2h cooldown
    port: 20, piracy: 25,                        // seamanship — a run is a long clock + supply-capped
    dice: 1, blackjack: 1, numbers: 1, trackbet: 1, // gambling — per resolved play AT A REAL STAKE (below)
    sell: 2, fill: 3,                            // commerce — per goods sale / market fill
    score: 25, heist: 60,                        // scores — 8h/daily cooldown ops
    bout: 25, exhibition: 20,                    // fists — 6h exhibition cd, bouts need a willing rival
  },
  // The den floor: a play below this stake schools nothing — without it a min-bet ($100) spammer
  // with the Madame's comped seat farms The Gambler at the rate limit for ~free; at $1,000+ the
  // house edge makes the fast track genuinely expensive (the "no free farm loop" rule, priced).
  GAMBLER_MIN_STAKE: 1000,
  // Rank bands (display names by level — the TRADE_RANKS shape, status only)
  RANKS: [
    { at: 1,  name: 'Green' },
    { at: 10, name: 'Apprentice' },
    { at: 20, name: 'Made' },
    { at: 30, name: 'Craftsman' },
    { at: 40, name: 'Expert' },
    { at: 50, name: 'Master of the Trade' },
  ],
  // THE DEATH RULE (founder-signed): the street's levels die; the heir inherits this share of each
  // track's XP (the honor HEIR_KEEP / Underworld MEMORY_BPS echo pattern — 0 restores hard death).
  // Softens death → a flagged founder sign-off lever by the standing rule.
  HEIR_KEEP_BPS: 2500,
  // ── STEP TWO: MILESTONE PERKS + THE LEVEL-50 TRAIT ──
  // Each trade has ONE perk axis that deepens at the milestone levels — every effect a NEW
  // single-touchpoint multiplicative modifier OFF the audit-locked list (pacing clocks, sink
  // discounts where the DISCOUNTED number is what's ledgered, contest mults on the bruiser
  // precedent, table-limit ACCESS with odds untouched). fx[0..2] = L10/25/40; fx[3] is the
  // VIRTUOSO trait's deepening (level 50 + the choice). Signed floors re-assert after mults.
  MILESTONES: [10, 25, 40],
  PERKS: {
    larceny:    { what: 'jail stints on a busted job',        fx: [0.95, 0.90, 0.85, 0.75] }, // getaway-stack (pacing)
    wetwork:    { what: 'your search clock on a mark',        fx: [0.95, 0.90, 0.85, 0.75] }, // executioner/Vinnie-stack (pacing)
    chemistry:  { what: 'cook time on a batch',               fx: [0.95, 0.90, 0.85, 0.75] }, // throughput still nerve-bounded at the corner
    wheels:     { what: 'tuning prices at the garage',        fx: [0.95, 0.90, 0.85, 0.75] }, // sink discount — the discounted number is ledgered
    seamanship: { what: 'hull & engine work at the boatyard', fx: [0.95, 0.90, 0.85, 0.75] }, // sink discount
    gambling:   { what: 'your PvE table limit at the den',    fx: [1.10, 1.25, 1.50, 2.00] }, // ACCESS only — odds untouched, liability-capped
    muscle:     { what: 'jump & shakedown muscle',            fx: [1.02, 1.04, 1.06, 1.10] }, // the bruiser contest-mult precedent
    commerce:   { what: 'Black Market listing fees',          fx: [0.90, 0.80, 0.70, 0.50] }, // broker-stack; LIST_FEE_MIN re-asserts after
    scores:     { what: 'the Score lines up sooner',          fx: [0.95, 0.90, 0.85, 0.75] }, // pacing (the safecracker axis, unpaid)
    fists:      { what: 'your fighters heal faster',          fx: [0.90, 0.80, 0.70, 0.50] }, // pacing (the cornerman-cutman axis)
  },
  // THE TRAIT (level 50, once, permanent, dies with the street): power now, or legacy.
  TRAITS: {
    virtuoso: { name: 'Virtuoso', desc: "The trade's perk deepens to its mastered strength." },
    dynast:   { name: 'Dynast',   desc: 'Your heir inherits HALF this trade\'s schooling instead of a quarter.' },
  },
  TRAIT_HEIR_BPS: 5000, // the dynast echo (vs HEIR_KEEP_BPS for everyone else) — a death-softening dial
  // ── STEP FOUR: STATS BY USE (founder-signed fork: "yes, tightly capped") ──
  // Working a trade also exercises its core stat: each XP-paying action rolls a small chance of
  // +1 to the track's stat, on THE GYM'S OWN diminishing curve (200/(200+stat) — the exact factor
  // train() uses, so use-training can never outpace the gym's shape), metered by a hard rolling
  // daily bucket (the D3 wash/port token-bucket pattern). The gym stays the FAST lane (~40
  // pts/hr at the 3-min cooldown vs ≤CAP_DAY/day here) — this makes playing your trade FEEL like
  // training it, never a second gym. Signed contest formulas can't inflate past the cap.
  STAT_USE: {
    CAP_DAY: 3,      // hard ceiling on use-trained stat points per rolling day
    P_PER_XP: 0.02,  // roll chance per point of mastery XP the action paid (before the gym dim)
    GYM_DIM: 200,    // the gym's own diminishing base — gain chance scales by GYM_DIM/(GYM_DIM+stat)
  },
  // Legend rank ladder (lifetime account XP across ALL trades — pure status, survives death)
  LEGEND_RANKS: [
    { at: 0,       name: 'Dabbler' },
    { at: 5000,    name: 'Journeyman of the City' },
    { at: 25000,   name: 'Man of Many Trades' },
    { at: 100000,  name: 'The Complete Criminal' },
    { at: 400000,  name: 'A Legend of the Life' },
  ],
};
// ══ PATHS v2 (TRADES step three) — the specialties AND the disadvantages ══
// The PATHS catalog (ids/names/descs) is MACHINE-OWNED in rules.generated.js (prototype +
// re-extract, the car-catalog precedent); this matrix is the HAND-WRITTEN teeth. Per path:
//   home  — trades that farm ×PATH_XP_HOME faster (progression speed, the founder's chosen axis);
//   rival — trades that farm ×PATH_XP_RIVAL slower (the disadvantage that makes it a choice);
//   fx    — the signature perk(s) + ONE handicap, each a named single-touchpoint multiplier
//           (the masteryFx/skillMult class, off the audit-locked list; the money-adjacent ones
//           are flagged in BALANCE.md). The three ORIGINAL paths keep their exact pre-v2 numbers
//           (gun 1.1/1.15, ledger 1.1/1.05, kitchen +0.15/×0.75 — the ternary conversion is
//           byte-identical for them) and each GAINS its handicap as a new lever. `frontIncome`
//           makes the Ledger's long-advertised "+10% front income" REAL at last (flagged — it
//           widens the L1a-flattened front curve ~10% for one path choice).
// XP mults apply INSIDE bumpMastery, so fractional XP is deliberate (a rival 1-XP den play pays
// 0.6, not a rounded-away 0 or a rounded-up 1 — the masteries column is NUMERIC).
export const PATH_XP_HOME = 1.5;
export const PATH_XP_RIVAL = 0.6;
export const PATH_SWITCH_CD_MS = 7 * 24 * 3600 * 1000; // switching careers needs a week between moves
                                                       // (XP-rate arbitrage made the 25 $OMR burn too cheap a throttle)
export const PATH_FX = {
  gun:     { home: ['wetwork', 'muscle'],     rival: ['commerce', 'chemistry'],
             fx: { jumpAtk: 1.1, hitEff: 1.15, goodsSell: 0.95 } },
  ledger:  { home: ['commerce', 'scores'],    rival: ['wetwork', 'muscle'],
             fx: { racketIncome: 1.1, frontIncome: 1.1, goodsSell: 1.05, jumpAtk: 0.95 } },
  kitchen: { home: ['chemistry', 'larceny'],  rival: ['gambling', 'fists'],
             fx: { dealHeat: 0.75, jailStint: 1.1 }, add: { cookQuality: 0.15 } },
  wheel:   { home: ['wheels', 'seamanship'],  rival: ['chemistry', 'gambling'],
             fx: { convoyTime: 0.9, cookTime: 1.15 } },
  shadow:  { home: ['larceny', 'wetwork'],    rival: ['fists', 'commerce'],
             fx: { searchClock: 0.85, contest: 0.95 } },
  ring:    { home: ['fists', 'gambling'],     rival: ['seamanship', 'scores'],
             fx: { contest: 1.05, healCost: 1.15 } },
};
// The readers — pathless (or an unknown key) is always the neutral value, so every touchpoint is
// safe for a fresh street and for headless callers that only hold the character row (ch.path is a
// COLUMN, not loadOwned state — no h needed anywhere).
export const pathFx = (ch, key) => PATH_FX[ch?.path]?.fx?.[key] ?? 1;
export const pathAdd = (ch, key) => PATH_FX[ch?.path]?.add?.[key] ?? 0;
export const pathXpMult = (ch, trackId) => {
  const p = PATH_FX[ch?.path];
  if (!p) return 1;
  if (p.home.includes(trackId)) return PATH_XP_HOME;
  if (p.rival.includes(trackId)) return PATH_XP_RIVAL;
  return 1;
};

export const masteryLvlOf = (xp) =>
  Math.min(MASTERY.MAX_LVL, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / MASTERY.XP_DIVISOR)) + 1);
export const masteryXpFor = (lvl) => MASTERY.XP_DIVISOR * (lvl - 1) * (lvl - 1);
export const masteryRankOf = (lvl) => { let n = MASTERY.RANKS[0].name; for (const r of MASTERY.RANKS) if (lvl >= r.at) n = r.name; return n; };
export const masteryLegendRankOf = (xp) => { let n = MASTERY.LEGEND_RANKS[0].name; for (const r of MASTERY.LEGEND_RANKS) if (Number(xp) >= r.at) n = r.name; return n; };
