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

// ── THE GENESIS RATE — the ONE $OMR-per-ETH conversion ──────────────────────────────────────────
// 205,882 is the locked launch price (the raise ÷ the supply sold; BALANCE.md § THE GENESIS RAISE
// and the launch sequence's G-1). It exists so that a fee's $OMR price and its ETH price cannot
// silently disagree — the genesis-rate pass found three rails quoting three different rates, and
// since the effective price of anything is always the CHEAPER rail, a hand-set floor beside a
// market-linked path is not a second opinion, it is the real price.
//
// It was DELETED on 2026-08-10 when the whole PLEX bridge was retired ("nothing left to convert"),
// and RESTORED the same day when the founder read the cost that sweep had been flagged with and
// pulled it back to the mint alone. That reasoning is worth keeping rather than tidying away: the
// deletion was correct *given* its premise, and the premise stopped holding the moment a rail came
// back. Everything below derives from this ONE number, so a fee change moves the $OMR floor with it
// and there is no second value to set by hand — which was the actual finding, not the deletion.
//
// ETH-denominated: a fee is 0.01 ETH whatever that is in USD. Pegging a fee to a dollar value is a
// separate decision needing a USD oracle this game deliberately does not have.
export const PLEX_GENESIS_OMR_PER_ETH = Number(process.env.PLEX_GENESIS_OMR_PER_ETH || 205882);
// The pre-market quote for an ETH-denominated fee. `premiumBps` is the CALLER's premium — the ETH
// rail must stay the economical one (ETH funds the pool; $OMR recycles to the desk at a markup), so
// a floor that omitted it would hand the cheap rail straight back to $OMR by exactly the premium.
export const genesisOmrFor = (feeEth, premiumBps = 12000) =>
  Math.round(Number(feeEth) * PLEX_GENESIS_OMR_PER_ETH * Number(premiumBps) / 10000);

// ── THE STORED-NOT-SPENT BOUND ──────────────────────────────────────────────────────────────────
// A number the player SPENDS is bounded by their balance. A number they merely NAME — a listing
// price, a consent limit — is bounded by nothing but its own guard, and `Number.isFinite` is the
// wrong tool for that job: 3,000,000,000 and 1e308 are both perfectly finite, and both are past
// what the column holds. Found by DRIVING the routes, not by reading them: two live 500s where a
// clean refusal belonged (the deed's asking price on a bigint column, the duelling ladder's stake
// cap on an int4 one), and 3e9 is a number an ordinary player could type.
//
// The bound is a STORAGE fact, not a balance dial — a gameplay ceiling (the way SPEAKEASY.SALE_MAX
// caps a club at $50M) is a separate founder decision, and these deliberately do not make one:
// every value that works today still works.
//
// SAFE_STORED is MAX_SAFE_INTEGER rather than the bigint maximum on purpose, and the reason is
// stronger than the column: past 2^53 a JS number has already lost integer precision, so what
// would be stored is no longer the number the player typed. Refusing it is correct on its own
// terms — the column error is the symptom, not the argument.
export const PG_INT4_MAX = 2147483647;
export const SAFE_STORED = Number.MAX_SAFE_INTEGER;

export const CONSTANTS = {
  // Randomized starting build — every fresh character rolls a UNIQUE distribution of the SAME
  // fixed budget (no two the same, but the total is constant → zero power creep, so the
  // sim-audited stat economy is untouched). Each stat floors at CREATE_STAT_MIN and they always
  // sum to CREATE_STAT_TOTAL. The $OMR respec keeps its own ≥5 floor (RESPEC_STAT_MIN) — a
  // deliberate rebalance toward the middle — while a fresh roll or a paid re-roll can spike to 9.
  CREATE_STAT_MIN: 3, CREATE_STAT_TOTAL: 15,
  GARAGE_CAP: 12, GTA_CD_MS: 300000, MELT_TITHE: 0.25, TITHE_ROUND_VALUE: 30,
  SEARCH_MS: 3*3600*1000, SHOOT_CD_MS: 2*3600*1000, MIN_FIRE: 50,   // PRODUCTION timers
  COOK_MULT: 12, APY: 0.14, SWAP_MIN: 500, PATH_FIRST_COST: 10000, PATH_SWITCH_OMR: 150,
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
  // Upkeep accrues on its OWN clock up to BUSINESS_UPKEEP_CAP_MS — an ABSENT owner earns ≤24h and
  // owes ≤ the cap, so neglect still bleeds. A front unpaid past BUSINESS_UPKEEP_COLD_MS (3d) goes
  // COLD (no income / no launder / no upgrade) until the pad is paid.
  //
  // D6=B (founder, 2026-08-02): the cap was 7d, which put the crossover at FIVE DAYS AWAY — past it,
  // squaring up cost more than the front could ever hand back, so the rational move on an entry-tier
  // asset was to abandon it, and a week off is a normal thing for a player to do. A tester found it
  // and their arithmetic was right. At 2d the pad tops out at 2× the till: neglect costs you real
  // income and can no longer go NEGATIVE, so the pressure survives and the trap does not.
  // BALANCE.md § THE PAD OUTRUNS THE TILL.
  BUSINESS_UPKEEP_BPS: 2000, BUSINESS_UPKEEP_CAP_MS: 2*24*3600*1000, BUSINESS_UPKEEP_COLD_MS: 3*24*3600*1000,
  // L1b — THE PROGRESSIVE PAD (stakes/spine review #1, founder-directed): the pad rate climbs with the
  // SIZE of the empire — each front you own adds BUSINESS_UPKEEP_PROG_BPS to EVERY front's upkeep rate, so
  // a 5-front stack pays 20% + 4×5% = 40% pad (vs a 1-front's 20%). Bounds the measured passive stack
  // without touching the on-ramp (a 1-front owner is unaffected). Sim-re-measured; a sign-off lever.
  BUSINESS_UPKEEP_PROG_BPS: 500,
  // WALKING AWAY. The asymmetry above is the point — a front demands attendance — but until now it
  // had no EXIT, and that was the real defect rather than the bleed. `businesses` is UNIQUE(character,
  // kind), so a cold front whose pad you cannot cover did not merely sit idle: it PERMANENTLY blocked
  // you from ever owning that kind of front again. A tester found the shape of it from the inside
  // ("how can it be that I owe more in wages than my laundromat brings in?") — measured, the pad
  // outruns what the front can ever hand back at five days away.
  // Shuttering hands the keys back: the row goes, the pad dies with the business, and the slot frees.
  // BUSINESS_SHUTTER_BPS is what you salvage of everything you sank into it (buy + every upgrade).
  // Shipped at 0 — walking away costs you the lot, which is the harshest reading and the one that
  // needs no sign-off, since it moves no value at all. Raise it and closing up returns something.
  BUSINESS_SHUTTER_BPS: 0,
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
  // THE BUREAU RETURNS (v2 knock-on RESOLVED — founder-directed option (b), 2026-07-30). Business
  // scrutiny grew ONLY from laundering, so v2 step 2's retirement left the whole Bureau-raid layer
  // unreachable (no front could ever be raided — passive fronts strictly SAFER than the L1a/L1b
  // curve assumed). Scrutiny is now RE-SOURCED FROM INCOME — a front HEATS BY EARNING: banking
  // income adds BUSINESS_SCRUTINY_PER_INCOME_DAY per full operating DAY's income collected
  // (tier-normalized, so every front runs the same heat-per-day; the raid's COST scales with the
  // size of the operation on its own — the seized pending + FINE_RATE × tier cost). MEASURED
  // (sim P9.24, re-run on any retune): a daily collector nets +30 heat vs −24 decay → a raid
  // ~every 10.1 days ≈ 11–12% of gross at every tier (the 5-front stack pays ~$4.2M/day on top of
  // the L1b pad); a vigilant collector who banks often faces only the fine floor (~2% of gross) —
  // the seized pending shrinks with cadence while the heat total is income-normalized, so cadence
  // can't game the heat itself (the territory smuggling pattern). BUSINESS_SCRUTINY_PER_CAP stays
  // DEAD (it metered the retired launder feed; kept for the historical record).
  BUSINESS_SCRUTINY_PER_CAP: 45, BUSINESS_SCRUTINY_PER_INCOME_DAY: 30,
  BUSINESS_SCRUTINY_DECAY_HR: 1, BUSINESS_SCRUTINY_MAX: 100,
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
// hard line), server-rolled + rng_audit'd, every stake/payout ledgered casino:* so §10.4
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
// A drawn contract the player STRUCTURALLY cannot complete, and why. `DAILY_POOL` is machine-owned
// and every kind but one is doable alone — the NPC residents supply the counterparty for `jump`
// (they walk the streets), `bust` (JAILBIRDS keeps some inside) and `dice` (they set a fade limit).
// `tribute` is the exception: it needs a FAMILY, and residents deliberately never found or join one
// (deferred when the population shipped, so the Commission and turf stay untouched). So on the ~2
// days in 31 that the draw lands a tribute contract, a family-less player has a card they cannot
// clear — and the work-board coach rung would sit on "N of today's contracts unclaimed" all day
// pointing at it. ONE helper so the coach's count and the card's copy can never disagree (the
// extortFront one-core lesson); a second gang-gated kind is a line here rather than a rediscovery.
//
// Deliberately NOT covered: `trade` needs a live Exchange listing, which is a LIQUIDITY condition
// that changes by the hour rather than a structural one — a static check would either lie when the
// book fills or need a query on the coach's hot path. That one is flagged, not faked.
export const dailyBlockedFor = (job, { gangId } = {}) =>
  (job?.k === 'tribute' && !gangId) ? 'you need a family to pay tribute' : null;
// The contracts still LIVE for this player today — what the coach's work-board rung counts. Shares
// dailyBlockedFor with the board that draws the cards, so the number in the rung and the cards on
// the screen can never disagree about which of the three are worth chasing.
export const dailyLiveFor = (claimedIds = [], ctx = {}, day = dayOf()) =>
  dailyJobsOf(day).filter((j) => !claimedIds.includes(j.id) && !dailyBlockedFor(j, ctx));
// THE CREW BONUS (M4.REF_XP) — a recruiter's respect multiplier, derived from the CURRENT levels of
// the recruits they brought in. Pure function of the levels, so the caller decides what counts as a
// recruit (qualified only, agents excluded) and this cannot drift from the gate that produced it.
// Returns the BONUS (0 = none), not the multiplier; callers apply `1 + bonus`.
export function referralXpBonus(recruitLevels = []) {
  const { STEP_LEVELS, PER_STEP, MAX_BONUS } = M4.REF_XP;
  let bonus = 0;
  for (const lvl of recruitLevels) {
    const steps = Math.floor(Math.max(0, Number(lvl) || 0) / STEP_LEVELS);
    bonus += steps * PER_STEP;
  }
  return Math.min(MAX_BONUS, Math.round(bonus * 1e6) / 1e6);
}

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
  // CREW_WAGE_CAP_MS; unpaid past CREW_WAGE_COLD_MS (3d) the crew DOWNS TOOLS (accrual stops their
  // offline sales) until the nut is paid.
  //
  // D7=C (founder, 2026-08-02): the cap was 7d against an 8h offline sales window — a 21× asymmetry,
  // sharper than the pad's, so three days away cost 0.40:1. Capping the WAGE CLOCK at 2d was chosen
  // over raising the sales window because the window (CONSTANTS.OFFLINE_CAP_MS) governs every offline
  // faucet in the game, so moving it is a whole-economy decision; this one is kitchen-local and
  // changes nothing else. An attentive owner is unaffected — they were never near the cap.
  // BALANCE.md § THE NUT.
  CREW_WAGE_PER_HR: 1200, CREW_WAGE_CAP_MS: 2*24*3600*1000, CREW_WAGE_COLD_MS: 3*24*3600*1000,
  LAYLOW_CASH: 5000, LAYLOW_ENERGY: 25, LAYLOW_COOL: 25,
  CLEANPAPERS_OMR: 60,
  HEIST_CD_MS: 8*3600*1000,
  BATCH_CRATE_UNITS: 20,                        // 1 📦 per 20 units cooked
  // D13 (SIGNED 2026-08-05, founder: "let's go with your recommendation"): the deal's ENERGY cost —
  // dealing is physical work, so the corner finally competes with the gym/crews/raids for the tank.
  // Flat per deal (nerve carries the play/throughput axis); energy is regen → zero §10.4 surface.
  DEAL_ENERGY: 4,
  DAILY_ALL_OMR: 3,                           // all-three bonus from the event fund
  REF_RECRUITER_CASH: 10000, REF_RECRUIT_CASH: 5000,
  // Retained ONLY to keep a historical figure honest: a database that predates the retirement has
  // real `referral:fund` rows on it, and My Profile subtracts the player's own welcome bonus so it
  // is not misread as recruiting income. Nothing pays it any more.
  REF_LEGACY_RECRUIT_OMR: 1,
  // (REF_FUND_OMR / REF_RECRUITER_OMR / REF_RECRUIT_OMR — RETIRED 2026-07-31, founder-directed:
  // "no longer promise to give away $OMR". A referral pays cash and THE CREW BONUS below instead.
  // The constants are gone rather than zeroed so nothing can quietly re-enable them; the milestone
  // ladder's `omr` field is still in RECRUIT_MILESTONES because that table is MACHINE-OWNED
  // (ground rule #2) — game.js simply stops reading it.)
  REF_GATES: { level: 8, jobs: 40, checkins: 3, netWorth: 25000 },
  // ── THE CREW BONUS (founder-directed 2026-07-31) ───────────────────────────────────────────────
  // What replaces the $OMR. Every QUALIFIED recruit makes their recruiter earn respect faster, and
  // by how much depends on HOW FAR THAT RECRUIT HAS GOT: level 5 → +5%, level 10 → +10%, level 15 →
  // +15%, and so on in steps.
  //
  // Why this shape rather than a payout:
  //   - It is NOT a currency. Respect has no ledger row, so this adds ZERO §10.4 surface — the
  //     referral system stops touching the token economy entirely.
  //   - It is LIVE, never banked. The bonus is recomputed from the recruits' CURRENT levels every
  //     time it is read, so a recruiter is rewarded for people who keep playing, not for a signup
  //     that happened once. A recruit who dies drops to their heir's level and the bonus falls with
  //     them; a recruit who quits stops paying.
  //   - It cannot be sold, gifted or laundered, which is exactly what made the $OMR version a
  //     Sybil target.
  // CAP is load-bearing: respect drives level, level gates everything, and the PACING pass
  // deliberately slowed levelling. Without a ceiling a large crew would blow straight through it.
  REF_XP: {
    STEP_LEVELS: 5,   // a recruit's level is counted in whole steps of this
    PER_STEP: 0.05,   // …and each step is worth this much of a multiplier
    MAX_BONUS: 1.0,   // hard ceiling on the SUM across every recruit (+100% at most, i.e. x2)
  },
  // STEPPED PAYOUT — "the spark": a small, EARLY cash payout the moment a recruit shows real early
  // engagement (level 3 + 10 jobs), so the referrer gets fast feedback long before the full
  // qualification (L8/40 jobs/3 check-ins/$25k). Cash only (never $OMR — that stays on the full
  // gate), agent-excluded, ONCE ever. Still requires real playtime, not raw signup → Sybil-bounded.
  REF_SPARK: { level: 3, jobs: 10, recruiterCash: 2500, recruitCash: 1500 },
  // THE LATE CLAIM (§7.13 funnel fix): a recruit who missed the referral field at creation (or
  // arrived without a ?ref link) can still name who sent them, within this window of ACCOUNT
  // creation and only while referred_by is unset. Same Sybil posture as at-creation attribution —
  // the payouts still ride the full qualification gates, this only decides WHO gets credited.
  REF_CLAIM_WINDOW_MS: 72 * 3600e3,
  // TIER-2 ("the family tree", §7.13 addendum): when a recruit YOU brought in then brings in their
  // OWN qualified recruit, you earn a BOUNDED, ONE-TIME finder's fee. Deliberately a flat one-shot —
  // NOT an ongoing percentage of the grandrecruit's earnings — so it's a referral bonus, not a
  // revenue-share pyramid (the anti-MLM line). CASH ONLY, capped at depth 2 (no third level), agents
  // excluded at every level. Sensitive design: recorded as gated; founder green-lit.
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
  MODULE_OMR_STEP: 24,        // omr = (resultLevel − MODULE_OMR_FROM + 1) × MODULE_OMR_STEP
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

// ═══ THE OPERATION SLOTS — scarce holdings (the strategy package, 2026-08-02) ═══
// The measured problem: 31 income holdings (18 RACKETS + the 13 'Legit Fronts' ASSETS) that every
// player buys ALL of, because nothing competes for the seat. The buy decision was "have I clicked it
// yet", not "which one". A shared SLOT pool makes it a CHOICE: you run at most `opSlotsOf(level)`
// income operations at once, so picking the numbers racket means NOT running the chop shop this week.
// Deliberately NOT metered: the Wheels and Property ASSET categories — those are stat/cargo/energy-cap
// progression, and capping them would be a pacing change wearing an economy change's clothes.
// Businesses are already capped at 5 by UNIQUE(character_id, kind), so they need no meter either.
// §10.4-FREE: a slot is a COUNT of rows you already own. Nothing moves; the sinks/faucets are unchanged.
export const OPERATIONS = {
  SLOTS_BASE: 2,          // your first two operations
  SLOTS_PER_LEVEL: 4,     // one more every 4 levels (the SKILLS.LVL_PER_POINT cadence)
  SLOTS_MAX: 12,          // …to a hard 12 of the 31 available — so ~⅓ of the catalog runs at once
  INCOME_ASSET_CAT: 'Legit Fronts',
  // What retiring an operation returns. Ships at 0 — the door exists so a bad pick isn't permanent
  // (the BUSINESS_SHUTTER_BPS argument: a door that refunds nothing moves no value and needs no
  // sign-off), and because at 0 nothing can pay for itself by churning through the catalog.
  RACKET_RETIRE_BPS: 0,
};
// `deedSeat` — STREET DEEDS Phase 2C: controlling your OWN corner seats one more operation
// (DEEDS.PERK_OP_SLOTS), still under the SAME SLOTS_MAX hard cap — free-player parity: the deed
// ACCELERATES the seat curve, it can never exceed what any player reaches by level alone. ONE
// implementation for the till (economy.assertSlot) and the board (the view's ops block), so the
// Empire card can never advertise a seat buyRacket refuses. (DEEDS is declared later in this file;
// the ternary only reads it when deedSeat is true, which never happens during module evaluation.)
export const opSlotsOf = (lvl, deedSeat = false) =>
  Math.min(OPERATIONS.SLOTS_MAX, OPERATIONS.SLOTS_BASE + Math.floor(Number(lvl || 0) / OPERATIONS.SLOTS_PER_LEVEL)
    + (deedSeat ? DEEDS.PERK_OP_SLOTS : 0));
// the level at which the NEXT slot opens — null once capped (the board says "that's all of them")
export const nextOpSlotLevel = (lvl) => {
  const cur = opSlotsOf(lvl);
  if (cur >= OPERATIONS.SLOTS_MAX) return null;
  return (cur - OPERATIONS.SLOTS_BASE + 1) * OPERATIONS.SLOTS_PER_LEVEL;
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
  // VALUE-AT-STAKE indexing (RE-SIM PASS 2 / P9.20d): a flat $10k war chest is pocket change for a
  // maxed family, so the declaration is not a decision. The chest now scales with the TARGET's
  // treasury — spoils are WAR_SPOILS (20%) of it, so you ante a fraction of what you stand to win.
  // Floored at WAR_COST so a broke target is unchanged; the coalition/streetboss discounts apply on
  // top (the discounted number is what burns, so `gang:war` still reconciles). Founder sign-off lever.
  WAR_COST_BPS: 200,                                          // 2% of the target family's treasury, floored at WAR_COST
  SEIZE_BASE: 30000, SEIZE_OUTBID: 1.5,
  JUMP_ENERGY: 25, JUMP_AMMO: 5, JUMP_MIN_HEALTH: 20, JUMP_HOSP_MS: 3*60*1000, JUMP_STEAL_CAP: 25000,
  FIRE_ENERGY: 40, KILL_HOSP_MS: 5*60*1000, CHOP_RATE: 0.40,
  BOUNTY_MIN: 500, BUST_FAIL_JAIL_S: 180,
  // D15 (SIGNED 2026-08-05, founder: "implement your recommendation"): the jailhouse only tolerates
  // so much — a rolling-24h cap on bust ATTEMPTS (win or lose, so a failed try is not a free retry).
  // The harness measured uncapped chasing at 26% of played minutes in lockup; the honest player
  // (the dailies want ≤2 busts) never feels 5. A gate on the signed §7.8 faucet — no §10.4 change.
  BUST_ATTEMPTS_DAY: 5,
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
  // ── THE WATCH (the strategy package's TIME WINDOW) ──
  // Turf changed hands as a one-sided instant purchase: the holder had no move and no reason to be
  // anywhere in particular. A holder now DECLARES the UTC hour their family stands ready
  // (`districts.watch_hour`), and taking the district OUTSIDE that window costs SURPRISE_MULT more
  // — you are dragging a family out of bed, and that takes more muscle than a fight they came to.
  //
  // Deliberately a PREMIUM, not a LOCKOUT (the EVE window, softened for a small alpha). A hard
  // window would make turf untakeable 20 hours a day and stall the whole war loop in a thin
  // population; a premium keeps every hour playable while making WHEN a real decision on both
  // sides — the holder picks a window they will actually be online for (attacks concentrate where
  // they can answer), the attacker chooses between the plain price and paying to catch them cold.
  // §10.4: it scales the EXISTING `turf:seize:` treasury sink — no new reason, no new faucet.
  // NULL watch_hour = no watch declared = the plain price at every hour (a family that never says
  // when it is home is never surprised, and never gets to concentrate the fight either).
  WATCH_WINDOW_H: 4, WATCH_SURPRISE_MULT: 1.5,
  // ── THE SEALED BID (the strategy package's SIMULTANEOUS DECISION) ──
  // Turf's price was PUBLIC and known: read `garrison` off the board, pay max(SEIZE_BASE, garrison ×
  // SEIZE_OUTBID), done. No simultaneous decision, no bluff, no commitment — the attacker always
  // moved last with perfect information and the holder never moved at all.
  //
  // A PLAYER-HELD district now changes hands ONLY through a sealed contest: every family commits a
  // SECRET stake from the treasury, the highest commitment takes the district when the window
  // closes, and the holder wins ties (the defender's advantage). Unheld and NPC-occupied districts
  // still fall to an outright claim — there is nobody on the other side to contest with, and an
  // instant buyout CANNOT coexist with a sealed contest on the same district (if the district is
  // purchasable at price P, nobody bids above P and the contest is theatre).
  //
  // CONTEST_LOSS_BPS is what makes it a real sealed bid rather than "always commit everything": a
  // loser gets the rest back but forfeits this share, so over-committing against a family that was
  // never coming costs you money. Escrowed at stake time, so a bid is a COMMITMENT — you cannot
  // bluff with treasury you have already spent.
  CONTEST_MS: 30*60*1000, CONTEST_LOSS_BPS: 5000,
  // ── THE ROSTER (the strategy package's SCARCE PEOPLE) ──
  // Steps two and three made turf a decision about WHEN and HOW MUCH. This one is about WHO.
  //
  // A family's made men were interchangeable: a 20-man family and a 3-man family differed only in
  // raw stats, and every collective system (turf, war, freight, the Bureau, the pad) ran with no
  // allocation decision at all. Now the family fills POSTS — one post per man, one man per post —
  // so your best cunning can keep the Bureau off your operations OR keep the pad cheap, never both.
  //
  // The teeth are the LIVE gate, not the numbers: a post only counts while its holder is alive,
  // out of lockup and out of the hospital. Kill or jail a family's Enforcer and their turf gets
  // cheaper to take until they put somebody else in the chair — which costs them that man's post
  // elsewhere. That is what makes this strategy rather than a settings screen: the existing PvP
  // layer is how you contest it.
  //
  // Every effect is ONE touchpoint and is ADDITIVE — nothing a family has today gets worse. The
  // scarcity is that filling one post means not filling another, not that the baseline moved.
  ROSTER_MIN_LEVEL: 5,                 // a made man has to be somebody before he holds a post
  ROSTER_REASSIGN_CD_MS: 6*60*60*1000, // …and you cannot shuffle the SAME man between posts on a whim
  ROSTER_POWER_DIV: 10, ROSTER_POWER_MAX: 8,  // power = min(MAX, floor(stat / DIV)) — the man matters, but bounded
  ROSTER_MULT_FLOOR: 0.7,              // no discount goes below this however good the man is
  ROSTER_ENFORCER_GARRISON: 6000,      // + per power onto what a RIVAL must stake to contest your turf
  ROSTER_CAPO_SCRUTINY_PER: 0.04,      // Bureau scrutiny on your operations grows slower, per power
  ROSTER_STREETBOSS_WAR_PER: 0.03,     // the war chest costs less, per power (the discounted number is ledgered)
  ROSTER_QM_GUARD_DEF: 3,              // + per power onto your family's convoy guards
  ROSTER_BAGMAN_UPKEEP_PER: 0.03,      // the operations pad comes cheaper, per power (discounted number ledgered)
  WEEKLY_STANDING: 15000, WEEKLY_OMR: 30,
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
  // the killer takes CASH_LOOT_RATE of the victim's POCKET cash (bank untouched) plus a share of
  // their $OMR — both TRANSFERS (whack:loot), the rest still burns/survives.
  CASH_LOOT_RATE: 0.25,
  // ECONOMY v3 §11.1 — THE LOOT RATE IS TIERED, and the flat OMR_LOOT_RATE (0.20) is RETIRED.
  //
  // The old rate was sized when the Street Wage was the main source of $OMR. As the ONLY source it
  // is too low — five kills to break even on a purchase, assuming you can even find a holder. But a
  // flat 0.50 fails the OTHER way: too high and holding is suicide, so nobody carries a float and
  // there is nothing to loot. Both failure modes end with the extraction path dead.
  //
  // The move is that EXPOSURE IS PROPORTIONAL TO IDLENESS, NOT TO WEALTH. $OMR sitting doing nothing
  // is dead capital that suppresses velocity — the one KPI. $OMR committed to a purpose is already
  // working, and the commitment is itself a cost. So:
  //
  //   IDLE      (a loose balance, and everything fresh — bonded, bought at the desk, just unbonded)
  //             → OMR_LOOT_IDLE. Hoarding is the punished behaviour.
  //   COMMITTED (an access stake — §11.5) → OMR_LOOT_COMMITTED. Already working; less exposed, NEVER safe.
  //
  // Three consequences worth naming. It gives a holder a genuine choice with a real tradeoff (commit
  // and be safer, or stay liquid and be a target) and BOTH answers help — committing drives velocity,
  // staying liquid feeds the hunters. It makes whales the rational prey and automatically protects a
  // new player (a fresh street holding nothing is worth nothing to hunt) with no rule required. And it
  // is self-balancing: as whales learn to commit, typical scores fall and hunters must hunt more.
  //
  // NOTE WHAT THIS REVERSES. Staked $OMR was a SAFE HARBOUR and is not one any more — §4.1 says $OMR
  // moves three ways and a protected tier would be a fourth. Defending your seat is the game. The
  // player-facing promise in both codices was corrected in the same commit.
  //
  // §11.1 says "no cap, no floor, no safe harbour", so unlike the CASH rate these are NOT clamped at
  // half — only at 1 (a rate above 1 would be a mint, not a loot). Both are sign-off dials; setting
  // COMMITTED to 0 restores staking as a safe harbour, setting IDLE to 0.20 restores the flat rate.
  OMR_LOOT_IDLE: 0.50, OMR_LOOT_COMMITTED: 0.20,
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
  // COACH_SOCIAL_BAND_LVLS (progression harness, second run) — the same class one rung down. Two
  // milestones are MULTIPLAYER-ONLY: a crew score needs another player to fill a role, and the
  // duelling ladder needs somebody listed on it. Wiring the harness to obey the solo rungs made this
  // visible immediately — with the Kitchen rung cleared, "Pull a crew score" took 77% of a seven-day
  // run and masked EIGHT downstream rungs (the Den, the fights, the races, the first front, the Port,
  // the Wire, going legit) that the same player could have acted on that minute. It is not the F1
  // defect — the rung is honest advice and clears the moment there is a crew — but on a thin alpha,
  // which is exactly what THE POPULATION exists for, "wait for company" outranking every solo system
  // is the wrong ladder. So each leads for this many levels after it first applies, then drops to the
  // recurring tail where it still gets said. 0 disables the demotion (they lead forever).
  COACH_SOCIAL_BAND_LVLS: 8,
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
  // D14 (SIGNED 2026-08-05, founder chose OPTION A — steepen, EV-NEUTRAL at the mid build): how much
  // a stat investment moves the §7.2 crime roll. The OLD signed coefficients (cunning 0.004 / speed
  // 0.002) gave a barely-felt +12-point swing across the WHOLE trainable range (fresh 5/5 → maxed
  // 25/25). Doubling them widens the felt spread to +24, and the OFFSET keeps a reference MID build
  // (cunning=speed=REF) unchanged so the signed faucet stays ~neutral at the median: a maxed street
  // gains success, an UNtrained one on a HARD job loses a little — a pure redistribution ALONG the
  // investment axis, which is what "builds matter" means. MUSCLE stays 0 (the jump/shakedown/PvP
  // axis — adding it to crime would homogenize builds). chance contribution =
  //   cunning×CUN + speed×SPD − OFFSET   (OFFSET = REF×(CUN+SPD), so the REF/REF build is unchanged).
  // Reverting to {CUN:0.004, SPD:0.002, OFFSET:0} restores the pre-D14 signed curve byte-for-byte.
  CRIME_STAT: { CUN: 0.008, SPD: 0.004, OFFSET: 0.072 }, // OFFSET cancels only the EXTRA the doubled coefficients add at a REF=12 mid build (12×((0.008−0.004)+(0.004−0.002)) = 0.072), so the mid build's success is unchanged to the dollar
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

// ── THE ROSTER — the five posts a family can fill (the strategy package's SCARCE PEOPLE) ──
// The catalog is deliberately SHORT: five posts against a 20-man cap means the decision is which
// FIVE of your men are worth taking off the street, not a spreadsheet. Each post reads ONE stat, so
// a family with one great all-rounder still has to choose what he does with himself.
export const ROSTER_POSTS = [
  { id: 'enforcer', name: 'The Enforcer', stat: 'muscle',
    what: 'a rival stakes more to come for your turf' },
  { id: 'capo', name: 'The Caporegime', stat: 'cunning',
    what: 'the Bureau builds its file on your operations more slowly' },
  { id: 'streetboss', name: 'The Streetboss', stat: 'muscle',
    what: 'declaring war costs the treasury less' },
  { id: 'quartermaster', name: 'The Quartermaster', stat: 'speed',
    what: "the family's freight rides with better guns" },
  { id: 'bagman', name: 'The Bagman', stat: 'cunning',
    what: 'the pad on your operations comes cheaper' },
];
export const rosterPostOf = (id) => ROSTER_POSTS.find((p) => p.id === id) || null;
// what one man is worth in a post — bounded, so a maxed officer is a real edge and never a wall
export const rosterPower = (stat) => Math.min(M3.ROSTER_POWER_MAX, Math.floor(Math.max(0, Number(stat) || 0) / M3.ROSTER_POWER_DIV));
// the discount shape every "costs less" post shares: 1 − power×per, never under the floor
export const rosterMult = (power, per) => Math.max(M3.ROSTER_MULT_FLOOR, 1 - Math.max(0, Number(power) || 0) * per);

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
// `levelOf` reads LEVEL_DIVISOR from here — a deliberate founder override of the prototype's `/4`
// (the D5 bank-taper precedent). It is defined in THIS file, the half the extractor never opens, so
// a regeneration cannot clobber it and there is nothing to re-apply by hand. (This comment used to
// say the opposite; test/docs.js now fails if that claim returns, in either wording.)
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

  // (5) THE LEVEL-UP MOMENT (omerta-early-game-design.md F4). Levelling up was a number changing on
  // a bar: the one event the whole progression is built around handed you nothing. Crossing a level
  // now refills ENERGY and NERVE to their (newly raised) caps — so the moment you level you can keep
  // playing, which is the hook. Deliberately the §10.4-FREE version: energy and nerve are pure regen
  // resources (the skills `adrenaline` active is the precedent), so this moves no currency and needs
  // no faucet. It IS a pacing lever, and an honest one: levels come fast early and quadratically
  // slower later, so the refill is frequent in the 1-16 band this is meant to smooth and rare by 30.
  // Measured with `npm run playthrough` before and after. Set false to revert to the bare number.
  LEVEL_UP_REFILL: true,

  // (6) …AND ITS CEILING. The refill is a NERVE FAUCET whose size is the cap and whose rate is how
  // often you level — and nerve is the wall this whole block exists to build. Measured: from level
  // ~90 a crossing hands back MORE nerve than the next level costs (at 110, "depository" pays 950
  // respect for 35 nerve = 27:1, so the next level wants ~81 nerve and the crossing returns 120).
  // Past that point the wall is gone. PROVEN live: at level 115 with the clock FROZEN so regen is
  // exactly zero, a pool funding 3 jobs funded 3000 and reached level 656 in one sitting; thirty
  // simulated days reached level 1636 and $7.5B. That is the alpha's level-240 speedrun reborn.
  //
  // The honest part: the refill's benefit and the runaway are the SAME mechanism at different
  // scales, so no dial keeps all of one and none of the other. A rolling daily bucket (the wash-cap
  // / stat-use / safehouse pattern) is the shape that keeps what the feature is FOR — you level
  // several times in an early sitting and get every one of them — while bounding the late game by
  // construction: refills contribute at most MAX_DAY × cap nerve a day, which at the top crime's
  // respect-per-nerve is ~1.35 levels per refill AT ANY LEVEL. Bounded and level-independent,
  // instead of "as fast as you can click". 10/day is above what a real early sitting uses.
  // `tools/playthrough.js` prints THE REFILL CEILING every run, so a change here re-measures it.
  LEVEL_UP_REFILL_MAX_DAY: 10,

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
  NAME_CHANGE_OMR: 30,   // a new street name (living-name uniqueness still enforced; your referral code follows it)
  TITLE_OMR: 60,        // a custom title — the same display slot mission titles use; clearing it is free
  PLATE_OMR: 12,         // a vanity plate for one car in the garage
  GANG_COLOR_OMR: 60,   // the family crest color (boss only)
  GANG_RENAME_OMR: 150,  // family rename/retag (boss only; founding-rules validation + uniqueness)
  TITLE_MAX: 24, PLATE_MAX: 8,
};
// M8 second drop — sinks tied to the game's loops (not pure vanity, so each carries a note on
// what it buys). ANON: posting a contract with your name off the board is INFORMATION hiding,
// not power — the mark still sees the pot, the hit works the same. PEEK: the counter to anon —
// the mark pays to read every funder on their own head (anonymity is purchasable, so is piercing
// it; the two sinks feed each other). RESPEC: redistributes ALREADY-TRAINED stat points, total
// conserved, none below the creation base — convenience over re-grinding, zero new power (the
// path-switch precedent). Prices new/tunable — founder sign-off before production.
export const M8 = {
  BOARD_ANON_OMR: 18,   // anonymity on a FRESH contract pot (top-ups inherit the pot's flag, never charged)
  INTEL_PEEK_OMR: 30,   // "who wants me dead?" — funder names + shares on every open pot on you
  RESPEC_OMR: 90,      // redistribute muscle/cunning/speed; sum must match, each ≥ RESPEC_STAT_MIN
  RESPEC_STAT_MIN: 5,  // the creation base — respec never drops a stat below the man you started as
  RESPEC_CD_MS: 24 * 3600 * 1000, // D7: opposed rolls are shape-sensitive — no re-shaping between fights
  TRIBUTE_OMR_MIN: 6,  // minimum $OMR tribute into the family reserve
};
// M8 — FAMILY SEALS: the gang-prestige ladder, the family-level $OMR sink. Pure STATUS (a badge
// on the family's name everywhere it appears — no member cap, no combat edge, no income). Bought
// SEQUENTIALLY by the boss from the family's $OMR RESERVE — the bucket the buyback split and
// weekly-contract bonuses already feed, now also fed by member $OMR tribute — so a seal is a
// COOPERATIVE purchase: the family pools tokens for its colors. Escalating prices make the top
// seals genuinely rare. Prices new/tunable — founder sign-off before production.
export const GANG_SEALS = [
  { tier: 1, id: 'wax',      name: 'Wax Seal',      omr: 150 },
  { tier: 2, id: 'brass',    name: 'Brass Seal',    omr: 450 },
  { tier: 3, id: 'silver',   name: 'Silver Seal',   omr: 1200 },
  { tier: 4, id: 'gold',     name: 'Gold Seal',     omr: 3000 },
  { tier: 5, id: 'obsidian', name: 'Obsidian Seal', omr: 9000 },
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
  JURY_COST_OMR: 120, JURY_BUST_MULT: 0.5,    // buy the jury once → conviction P × this (a $OMR sink — the war chest beats the rap)
  // ── Phase 4 — informants ──
  FLIP_SEED: 1500,             // exposure the rat's testimony adds to the named target
  FLIP_JAIL_S: 120,            // the rat does a short, soft stretch
  WITPRO_MS: 48 * 3600 * 1000, // witness protection: a one-time (per street) untargetable relocation window
  // ── THE ENVELOPE (going-legit sink) — the standing graft you slip the cops so they bury your file.
  // PROACTIVE (vs the reactive one-shot bribe): pay $OMR to keep the envelope current for a window;
  // while current, the investigation meter GAINS at ENVELOPE_GAIN_MULT rate (the cops write less
  // down). NOT immunity — a reckless player still builds a case, just slower. A $OMR sink (law:envelope).
  ENVELOPE_OMR: 90,                     // $OMR to keep the envelope current
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
    { tier: 1, name: 'Community Fund', omr: 360,   bustMult: 0.97, bleedMult: 1.15, blurb: 'A soup kitchen, a little goodwill.' },
    { tier: 2, name: 'Youth League',   omr: 1080,  bustMult: 0.93, bleedMult: 1.30, blurb: 'Ball fields with the family name on them.' },
    { tier: 3, name: 'City Trust',     omr: 3000,  bustMult: 0.88, bleedMult: 1.50, blurb: 'Grants, ribbons, a friend on the council.' },
    { tier: 4, name: 'The Institute',  omr: 7200, bustMult: 0.82, bleedMult: 1.75, blurb: 'A wing at the hospital. Judges attend the galas.' },
    { tier: 5, name: 'The Legacy',     omr: 18000, bustMult: 0.75, bleedMult: 2.00, blurb: 'Pillars of the community. The DA takes the call.' },
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

// NPC FAMILIES step two — THE BLOOD WAR (omerta-npc-families-defend-design.md). An NPC family is an
// attackable outfit on the WORLD-raid pattern: a `war_pool` strength/loot reservoir (regen-bounded, a
// bounded cash faucet — NOT the player-gang war system, so NO season_wars/Commission standing). The war
// score is a SEPARATE account-level legend, severing the flagged standing faucet by construction. THE
// DEFENCE: a landed raid rolls a counter (COUNTER_P) that hospitalizes the raider — they hit back, so a
// raid is a real risk, not a fixed-price standing buy. All numbers are founder SIM sign-off levers; the
// pool sits BELOW the weakest World outfit (Dock Rats, max 150k) since it is turnover-seeded, not designed.
export const FAMILY_WAR = {
  POOL_MAX: 120000,               // an NPC family's loot reservoir at full strength (< Dock Rats 150k)
  POOL_REGEN_HR: 4000,            // lazy regen toward POOL_MAX (the world regenPerHr twin)
  RAID_BPS: 500,                  // a landed raid loots 5% of the current pool (the GRAB_BPS twin)…
  RAID_MAX: 20000,                // …capped
  RAID_MIN_LVL: 8,                // a made man's op (the world/heist floor)
  RAID_ENERGY: 18, RAID_AMMO: 8, RAID_HEAT: 8,
  RAID_CD_MS: 4 * 3600 * 1000,    // per-ATTACKER cooldown (characters.family_raid_at) — bounds farming across all families
  BASE_P: 0.55,                   // base raid success…
  DEF_MAX: 60, DEF_SCALE: 300,    // …def scales with the pool fraction (a full family defends harder + pays more); p = clamp(BASE_P + (power − def)/DEF_SCALE, MIN_P, MAX_P)
  MIN_P: 0.1, MAX_P: 0.9,
  COUNTER_P: 0.35,                // THE DEFENCE (immediate): chance the family's guns catch the raider AT THE SCENE on a landed raid
  COUNTER_HOSP_MS: 30 * 60 * 1000,
  // THE MANHUNT (built — shield-honouring): a raider who ESCAPED the scene counter is remembered, and the
  // family sends someone after them later (npcwar.js sweepFamilyAggro). Chained, so exactly one retaliation
  // path fires per raid (caught now OR hunted later — never both). Honours the earned shields at resolve time.
  AGGRO_DELAY_MS: 45 * 60 * 1000, // they come for you ~45 min after the raid…
  RETAL_P: 0.5,                   // …and find you half the time (a clean miss if you were hiding, or you dodged)
  RETAL_HOSP_MS: 30 * 60 * 1000,
  // THE CONQUEST (step three): routing an NPC family (war_pool below the floor) on a raid lets the
  // raider's FAMILY hold it as a vassal — a bounded tribute to the treasury, contestable by re-routing
  // (the World-frontier pattern). NO core-district turf (avoids the OCCUPATION overlap).
  ROUT_FLOOR_BPS: 1000,           // routed when war_pool drops below 10% of POOL_MAX
  TRIBUTE_BPS: 200,               // tribute/hr = POOL_REGEN_HR × this/10000 (2% — a small vassal cut, the world FRONTIER twin)
  TRIBUTE_CAP_MS: 24 * 3600 * 1000,
  FAIL_HOSP_MS: 30 * 60 * 1000,   // a repelled raid hospitalizes the raider (the world FAIL_HOSP_MS twin)
  RANKS: [
    [0, 'Unblooded'], [25000, 'Button Man'], [150000, 'Warmaker'],
    [500000, 'Family Killer'], [2000000, 'The Exterminator'],
  ],
  // THE FAMILY WAR (formal declaration — omerta-npc-family-wars-design.md). A meta-layer over the
  // Blood War raid loop: a boss/underboss DECLARES war on an NPC family for a treasury cash sink, opens
  // a time-boxed SCORED campaign (each landed raid on that family scores), and WINS by reaching the
  // score before the window closes. The reward is STATUS ONLY — an account-level `family_wars_won`
  // trophy + a leaderboard, the belt to the Blood War's bouts — plus the existing raid loot faucet
  // during the war. §10.4-NEUTRAL by construction: the ONLY value flow is the EXISTING `gang:war`
  // treasury sink (no spoils, no NPC-treasury seed, no new faucet); the score/win are status, NEVER
  // season_wars (severing the Commission-standing faucet the design's constraint #1 names). The family
  // already RETALIATES (the shipped DEFENCE), so a war is not a free repeatable standing buy.
  // All numbers PROPOSED DEFAULTS — founder SIM + sign-off before production (BALANCE.md).
  WAR: {
    COST: 25000,                  // the declaration war-chest sink from the treasury (a real commitment; the WAR_COST twin)
    MS: 24 * 3600 * 1000,         // the campaign window (test-only override NPC_WAR_MS)
    RAID_POINTS: 1,               // score per landed raid on the family you're at war with
    WIN_SCORE: 5,                 // land this many raids inside the window to WIN (≈5 raids × 4h cd ≈ a real campaign)
    MAX_PER_FAMILY: 1,            // one active NPC war per attacker family (bounds farming)
    WIN_RANKS: [
      [0, 'No Campaigns'], [1, 'Campaigner'], [5, 'War Chief'], [15, 'Warlord'], [40, 'The Scourge of Families'],
    ],
  },
  // THE OFFENSIVE (step four) — NPC families that DECLARE FIRST. A worker opens a time-boxed HOSTILITY
  // from an NPC family onto a real player family with nobody having poked them, so the low-population
  // world feels alive. While live it enqueues a family_aggro strike on the strike cadence — the SHIPPED,
  // shield-honouring hospitalization primitive (sweepFamilyAggro re-checks jailed/hosp/safehouse/witpro/
  // pen/hole + RETAL_P at resolve). §10.4-NEUTRAL: a strike is pure pacing, no currency, no new reason.
  // Counterplay is the EXISTING loop — rout the outfit (its war_pool below the rout floor) and the CONQUEST
  // ends its aggression (a vassal doesn't war its overlord). Anti-grief: one campaign per NPC family, a
  // target can't be piled on by two at once, MIN_MEMBERS keeps it off solo alts, MIN_LVL keeps it off fresh
  // rookies, and COOLDOWN_MS buys a harassed family peace. All numbers PROPOSED DEFAULTS — sim + sign-off.
  AGGRESSION: {
    TARGET: 2,                      // NPC families on the warpath at once (worker tops up to this)
    MS: 12 * 3600 * 1000,           // how long a hostility runs before it lapses on its own (test-only NPC_AGGRO_MS)
    STRIKE_EVERY_MS: 3 * 3600 * 1000, // a strike is enqueued on this cadence (each a shield-honouring family_aggro hit)
    COOLDOWN_MS: 24 * 3600 * 1000,  // a harassed family's peace window before it can be targeted anew
    MIN_MEMBERS: 2,                 // only open on a REAL player family (≥ this many living made men — not a solo alt)
    MIN_LVL: 5,                     // only strike a member at/above this level (don't hunt fresh rookies)
    // ALLIES JOIN (2026-08-06): the aggressor's NPC allies send guns at the same target on each strike
    // cycle (each its own family_aggro slot) — up to this many. An ally at PEACE with the target (a
    // player↔NPC pact) stays out, and one already hunting elsewhere sits the cycle out. Still §10.4-neutral
    // (pacing over the shield-honouring family_aggro primitive). 0 disables the alliance teeth.
    ALLY_JOIN_MAX: 2,
  },
};
export const familyWarRankOf = (dmg) => {
  const d = Number(dmg) || 0; let r = FAMILY_WAR.RANKS[0];
  for (const t of FAMILY_WAR.RANKS) if (d >= t[0]) r = t;
  return { name: r[1] };
};
export const familyWarWinRankOf = (wins) => {
  const w = Number(wins) || 0; let r = FAMILY_WAR.WAR.WIN_RANKS[0];
  for (const t of FAMILY_WAR.WAR.WIN_RANKS) if (w >= t[0]) r = t;
  return { name: r[1] };
};
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
  // THE HIRED GUNS (residents-in-crews, the fillHeist twin): a leader hires an NPC resident merc into an
  // open raid seat. A hired gun's FIREPOWER COUNTS in the combined roll (this is the unblock — a soloist in
  // a thin alpha can crack an apex outfit), but its pot share is FORFEITED and it pays no energy/ammo — so
  // the co-op faucet only SHRINKS per real head and §10.4 is untouched (`world:hire` is a cash SINK riding
  // the existing `world:` prefix). HIRE_MAX bounds it so a real crew still beats a bought one; HIRE_FEE
  // makes hiring a real decision against the apex pot it unlocks. FOUNDER SIGN-OFF: this makes the apex
  // reservoirs SOLO-realizable (previously coop-only → untappable in a thin alpha) — a new emission surface,
  // measured in sim P9.31 and bounded by REGEN (the base-wide ceiling is unchanged; only WHO can tap it).
  HIRE_MAX: 2, HIRE_FEE: 75000,
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
    // SIGN-OFF 2026-08-05 (Part B row A12) — VALUE-AT-STAKE INDEXING, the WAR_COST_BPS twin at the
    // same 200 bps: the flat $50k floor was noise to a maxed family (0.08% of a day), so the floor
    // now also scales with the OUTFIT'S SIZE (outfit.max × this/10000 — volkov $240k, moreau $100k;
    // the small outfits stay on the $50k on-ramp floor, which is the point of leaving it flat).
    INVADE_BASE_BPS: 200,
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
  // ── STEP SIX — THE YARD LIVES (founder: "Jail gets really repetitive when the only action is
  // Work — more interactions with NPCs or more actions during the time in the Pen"). Three
  // in-sentence activities, ALL §10.4-free (XP/pacing, never currency): the iron pile (train the
  // PHYSICAL disciplines from the yard, on the SAME shared gym clock — jail is where hard men get
  // harder), cards with the crew (gambling schooling for a little energy — no money at stake, the
  // guards take real cash games), and the daily YARD CHARACTER (a seed-drawn fictional inmate to
  // TALK to once a day — wisdom pays discipline XP, a shortcut shaves the sentence, a war story
  // pays trade schooling). All numbers founder sign-off levers.
  YARD_DISCIPLINES: ['stamina', 'conditioning', 'composure'], // the iron pile trains the BODY only
  CARDS_ENERGY: 5,                       // cards with the crew: energy → gambling schooling (MASTERY.XP.cards)
  TALK_WISDOM_XP: 15,                    // the Old Timer's lesson (a drill-sized composure bump)
  TALK_CUT_S: 120,                       // the trusty's shortcut (the workYard good-behaviour shape)
  YARD_CAST: [                           // fictional only (the Broadcast posture); effect drawn with the day
    { id: 'oldtimer', name: 'The Old Timer',      effect: 'wisdom',   line: 'Forty years inside. He shows you how to hold yourself.' },
    { id: 'trusty',   name: 'Eddie the Trusty',   effect: 'shortcut', line: 'Mops the warden\'s office. Knows which forms move a release date.' },
    { id: 'bookie',   name: 'Sid the Book',       effect: 'story',    track: 'gambling', line: 'Ran every number in the city once. Talks odds in his sleep.' },
    { id: 'ghostman', name: 'Quiet Pete',         effect: 'story',    track: 'larceny',  line: 'Nobody ever saw Pete work. That\'s the lesson.' },
    { id: 'wheels',   name: 'Wheels McGee',       effect: 'story',    track: 'wheels',   line: 'Drove for three crews. Walked from every wreck.' },
  ],
};
// today's yard character — seed-drawn, town-wide (the yardEventOf shape; knowable, verifiable)
export const yardCharacterOf = (day = dayOf()) =>
  PEN.YARD_CAST[Math.floor(hash01('yardcast:' + day + ':' + MARKET_SEED) * PEN.YARD_CAST.length) % PEN.YARD_CAST.length];
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
// (red team 2026-08-16) THE YARD BOSS'S MEN ARE IN THE YARD. `penSafe` gates `fire`, `jump`, `npcHit`,
// `shank`, the wanted-hunter and the NPC-family strike — so an unbounded window was a STREET shield:
// $15,000 (PROTECTION_COST) bought 2h untouchable, against a safehouse's $25,000 floor for 4h that ALSO
// stops you acting (the signed D2/P1.3 "shield, not bunker" rule). Reproduced: a 3-minute sentence, buy
// protection, walk out, and jump/npcHit both refuse `protected` while the mark pulls jobs freely — a
// cheaper safehouse with none of its cost. Its sibling `inHole` was already capped at `jail_until` by an
// earlier audit for exactly this reason; this one was missed. Scoping the PREDICATE (rather than
// shortening the stored window) keeps what a player paid for — re-jailed inside it, they are still
// covered — and can never reach the street. `payProtection`'s own actor guard still reads true inside.
export const penSafe = (ch, now = Date.now()) =>
  !!ch.pen_safe_until && new Date(ch.pen_safe_until).getTime() > now && jailed(ch, now);
export const inHole = (ch, now = Date.now()) => !!ch.hole_until && new Date(ch.hole_until).getTime() > now;

// THE THREE UNIVERSAL STATUS PREDICATES — and why they live HERE rather than in the social package.
//
// `jailed` / `hospitalized` / `safeHoused` are the gates almost every verb in the game consults, and
// they were defined in `src/social/shared.js` — the SOCIAL package's leaf. That reads fine from inside
// social/, and wrong from `portfolio.js` or `estate.js`, so sixteen sites outside that package wrote
// the date comparison INLINE instead of reaching across. Each copy was correct; the hazard is that a
// copy cannot be updated by fixing the helper, and the forgotten-gate class is this project's most
// productive bug family (jump vs fire, collectFrontier vs collectTerritory, npcHit blind to the Pen
// shields). So the definitions move to the universal leaf beside their five siblings — `penSafe`,
// `inHole`, `witproActive`, `crewCold`, `isMade` — which every module already imports, and
// `social/shared.js` re-exports them so its ~100 existing call sites are untouched.
//
// Behaviour is byte-identical: `ch.jail_until && new Date(ch.jail_until) > new Date()` and
// `!!ch.jail_until && new Date(ch.jail_until).getTime() > now` agree on every input, since Date
// comparison with `>` coerces through valueOf() — the same number getTime() returns. The `now`
// parameter is new and defaulted, matching the siblings, so a caller that passes nothing is unchanged.
export const jailed = (ch, now = Date.now()) => !!ch?.jail_until && new Date(ch.jail_until).getTime() > now;
export const hospitalized = (ch, now = Date.now()) => !!ch?.hosp_until && new Date(ch.hosp_until).getTime() > now;
export const safeHoused = (ch, now = Date.now()) => !!ch?.safe_until && new Date(ch.safe_until).getTime() > now;

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
// THE HIRED HAND (residents-in-crews, omerta-residents-in-crews-design.md): a leader with no real
// crewmate hires an NPC resident into an open seat. The hand's pot share is FORFEITED (never minted →
// the co-op faucet only shrinks, §10.4-neutral), so a solo-NPC crew nets less than a full human crew.
// HEIST_FILL_MAX caps fillers per heist so the marquee 4-5-man jobs stay genuinely multiplayer.
export const HEIST_FILL_MAX = 1;                    // fillers per heist (0 disables; 1 = only the 2-man entry job is solo-reachable)
export const HEIST_FILL_FEE = 5000;                 // cash SINK to hire a hand (tools + the hand's cut up front) — heist:hire
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
    { id: 'the_levy',    name: 'The Levy',    desc: 'The family yield is levied by the chamber — the seated families collect it, by seat, instead of the standing board.' },
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
  RESPEC_OMR: 60,       // burn to unlearn everything (shared respec cooldown)
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
  RESPEC_ONE_OMR: 30,               // step two: unlearn ONE skill (leaf-first) for less than a full respec
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
  SPEC_OMR: 240, // $OMR burned to specialize / re-specialize a MAX-TIER front (deflationary sink)
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

// ── THE PORTFOLIO — RETIRED (D11, founder-directed 2026-08-05; src/portfolio.js is the record) ──
// The tickers, the invests, the Dynasty Fund and its dividends are gone — the city sells no shares.
// What survives is the RICO-graduation window THE VAULT (treasury.js) shares with the old paper
// book: a BIG legit move — CUMULATIVE over a rolling window (the D3 wash-bucket precedent, so
// structuring still trips it) — draws heat and can't be done from a safehouse (P1.3). Historical
// ledger rows keep their reasons in invariants.js; nothing writes a new one.
export const PORTFOLIO = {
  SCRUTINY_MIN_OMR: 6000, SCRUTINY_HEAT: 12, SCRUTINY_WINDOW_MS: 24 * 3600 * 1000,
};
// ── THE TREASURY & THE VAULT (omerta-stock-layer-retirement.md) ────────────────────────────────
// Was RWA_FLOAT. The founder retired the STOCK layer on 2026-07-31 and kept the vault, BACKED WITH
// ETH: nothing buys stock and nothing owes stock, but a player can still burn earned $OMR to claim
// allocation out of what the treasury actually holds — now ETH on both sides of `allocated <= held`,
// which is what makes that wall unbreakable rather than merely stated. The claim levers survive the
// re-denomination unchanged (they meter $OMR, not the backing asset).
export const TREASURY = {
  FEE_TREASURY_BPS: () => Number(process.env.FEE_RWA_BPS ?? 1000), // 10% of gameplay fees → the treasury ledger. Env name kept: renaming it would silently reset a configured deploy to the default.
  CLAIM_MIN_OMR: 150,          // floor on a claim — below this the round6 grid and the ledger row cost more than the claim is worth
  CLAIM_DAILY_OMR: 12000,      // per-ACCOUNT rolling-window cap: one house cannot sweep the vault in a day
  CLAIM_WINDOW_MS: 86400000,  // the bucket refills continuously over 24h (the D3 wash-cap shape)
  // THE PRICE IS NOW THE PRICE OF REAL ETH, so it gets the OmrTwapOracle treatment. Once the vault
  // owes ETH, a stale or absent OMR/ETH price is a FREE OPTION on the treasury: claim at yesterday's
  // rate, keep the difference. Two guards, both fail-closed:
  ORACLE_MAX_AGE_MS: 172800000, // 48h. Older than this and the vault REFUSES rather than guessing.
                                // There is deliberately no fallback price: pre-market, before any
                                // buyback has printed, the vault does not open. "We do not know what
                                // ETH costs" must never resolve to "sell it at the default".
  CLAIM_PREMIUM_BPS: 500,     // +5% over spot. The vault is not a market maker: it should never hand
                              // out ETH at exactly the price a player could get elsewhere, or every
                              // claim is a risk-free skim on whichever side the oracle lags.

  // ── THE BUY KEEPER'S WALLS (brokers step 5, §3.2 wall 3) — sized by `npm run keeper-dials` ──────
  // The keeper spends treasury ETH on tokenized stock. Wall 3 is a per-buy PRICE CONTINUITY bound so
  // a fat-finger, a stale feed or a leaked keeper key cannot buy at an absurd rate.
  //
  // The sizing produced one finding worth keeping at the definition, because it inverts the obvious
  // instinct. **A false halt is cheap; a loose bound is expensive** — and asymmetrically so:
  //   • bound fires wrongly → the keeper skips an epoch and a human looks. The ETH is still there.
  //   • bound is too loose  → real ETH buys few units, permanently, and NO INVARIANT CATCHES IT:
  //     `allocated ≤ held` is in UNITS, so buying few units for much ETH leaves every wall true.
  // So the bound is deliberately NOT sized to accommodate every honest move. A first cut scaled it
  // with the gap since the last print (`BASE^sqrt(Δ/epoch)`) and had to be thrown away — it yields
  // 6.7× at a month and 26.7× at a quarter, and a 26× bound is a formality with a comment attached.
  // Bound the ORDINARY case; let the extraordinary one stop the bot and fetch a human.
  //
  // The bounded quantity is stock/ETH, a RATIO, so ETH's volatility sets it even for a blue chip:
  // a "calm" large-cap still moves ~4.7%/day against ETH. 2× covers 3σ over an epoch (1.57×) and an
  // ETH-halving week (2.00×), and wastes at most 50% of a single buy in the worst allowed case.
  KEEPER_MAX_PRICE_JUMP: 2,      // refuse a fill above this × the last real print for that ticker
  KEEPER_MIN_PRICE_FRAC: 0.2,    // …and below this × it. A rate an order of magnitude cheap is a
                                 // broken feed or a fake token, not a bargain (the desk's
                                 // PRICE_FLOOR_BPS precedent — the RWA float shipped this bug).
  KEEPER_MAX_PRICE_AGE_MS: 2592000000, // 30d. A stale print does NOT earn a wider bound — it earns a
                                 // halt. Widening with age is precisely what makes a bound stop being
                                 // fail-closed (the OmrTwapOracle discipline, where having no
                                 // fallback price is the entire point).
};
// AUDIT F5 — fail fast on a misconfigured fee split: the Vig slice (vig.js, env VIG_BPS default
// 6000) + the treasury slice book each real fee into two independently-recorded buckets; if they
// summed past 100% the books would claim more than the payment (the BONDS/STORE load-time
// sum-validation precedent).
{
  // FEE_COMMUNITY_BPS read directly here (the COMMUNITY block is defined later in this file — the
  // guard runs at load, before it exists; same default, commented at COMMUNITY.FEE_BPS).
  const vig = Number(process.env.VIG_BPS || 6000), tre = TREASURY.FEE_TREASURY_BPS();
  const community = Number(process.env.FEE_COMMUNITY_BPS ?? 0);
  if (vig + tre + community > 10000)
    throw new Error(`VIG_BPS (${vig}) + FEE_RWA_BPS (${tre}) + FEE_COMMUNITY_BPS (${community}) exceed 10000 — the fee split would book >100% of each real payment as revenue.`);
}
// ── THE WIRE — the intelligence terminal (design omerta-the-wire-and-revenue-design.md) ──
// Information as a spendable resource. WIRETAPS (a $OMR sink, intel:wiretap) surveil a rival for a
// window — their Law heat, wealth/ops, and whether they're hunting you. SWEEP (intel:sweep) clears
// taps on you. The STREET WIRE (a recurring $OMR subscription, intel:wire) upgrades the feed into an
// intelligence service (forecasts, threat chatter, the ticker tape, the war room). All numbers are
// founder sign-off levers; every burn rides the existing intel:* omr vocabulary (zero invariant changes).
export const WIRE = {
  TAP_OMR: 48, TAP_MS: 12 * 3600 * 1000, TAP_MAX: 5, // place a wire: cost, window, concurrent cap
  SWEEP_OMR: 30,                                     // sweep your lines clean of bugs
  SUB_OMR: 72, SUB_MS: 7 * 24 * 3600 * 1000,        // the Street Wire premium feed: cost, window (== SUB_TIERS[0], kept for back-compat)
  // ── STEP FIVE — the TIERED SUBSCRIPTION ladder + the STANDING WATCH automation (all $OMR sinks via the
  // intel: vocabulary — ZERO invariant changes). The flat Street Wire becomes a ladder: a higher tier
  // costs more $OMR (a bigger intel:wire burn), unlocks more of the premium feed (the war room), and —
  // the headline — grants STANDING-WATCH slots: the worker AUTO-RENEWS a tap on an enrolled mark (burning
  // intel:watch from your $OMR each cycle, bounded by your balance + the tier's slots), so surveillance
  // runs while you're offline without manual re-tapping. The watch pauses if the sub lapses or you go
  // broke (the taps lapse naturally). All access/status/pacing — no new bucket, no faucet. Sign-off levers.
  SUB_TIERS: [
    { tier: 1, name: 'Street Wire',    omr: 72, ms: 7 * 24 * 3600 * 1000, watchSlots: 0, warRoom: false }, // the feed: forecast + threats + tape
    { tier: 2, name: 'The Wire Room',  omr: 180, ms: 7 * 24 * 3600 * 1000, watchSlots: 2, warRoom: true },  // + the war room + 2 standing watches
    { tier: 3, name: 'The Switchboard',omr: 360, ms: 7 * 24 * 3600 * 1000, watchSlots: 5, warRoom: true },  // + 5 standing watches
  ],
  // ── STEP TWO (all $OMR sinks through the intel: vocabulary — ZERO invariant changes; + a status axis) ──
  TRACE_OMR: 90,                                    // THE BUG TRACE — sweep NAMES the watchers (counter-intel); free when clean
  DOSSIER_OMR: 120,                                  // THE DOSSIER — a one-shot deep read (kills/flags/role/who-they-tap; NO exact cash — banding holds)
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
  DISINFO_OMR: 60, DISINFO_MS: 12 * 3600 * 1000,   // plant false intel: any WIRETAP reading you gets cooked private signals for a window
  INFORMANT_OMR: 150, INFORMANT_MS: 7 * 24 * 3600 * 1000, INFORMANT_MAX: 3, // a standing HUMAN source: recurring retainer, deeper read, pierces disinfo
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
    // applied to your club (display-only, zero gameplay). Payable in ETH (dormant paywall).
    { sku: 'decor_deco', name: 'Art Deco Decor', priceEth: 0.02, grant: { cosmetic: 'deco' },
      blurb: 'A sunburst-and-chrome Art Deco fit-out for your club — pure style, no power.' },
    { sku: 'decor_gilded', name: 'Gilded Age Decor', priceEth: 0.04, grant: { cosmetic: 'gilded' },
      blurb: 'Gold leaf and crystal — the Gilded Age look. A cosmetic skin for the house.' },
    { sku: 'decor_midnight', name: 'Midnight Velvet Decor', priceEth: 0.06, grant: { cosmetic: 'midnight' },
      blurb: 'Deep velvet and low light — the Midnight room. Cosmetic only.' },
  ],
};
// PLEX-for-packages: pay a Store SKU's fee from EARNED $OMR instead of ETH. Market-linked like the
// vig's rail — max(floor, feeEth × the latest buyback oracle × premium) — with the floor derived from
// the ONE genesis rate rather than hand-set, because a hand-set floor beside a market path is not a
// second opinion: the effective price is always the cheaper rail, which is what the genesis-rate pass
// found when three rails quoted three rates. (Retired wholesale on 2026-08-10 and pulled back to the
// mint alone the same day — see the note in store.js for which half of that argument survived.)
// Moves in LOCKSTEP with vig.js's PLEX_PREMIUM_BPS — the two price the same thing on two surfaces,
// so a split between them is a price difference nobody decided on.
STORE.PLEX_PREMIUM_BPS = Number(process.env.STORE_PLEX_PREMIUM_BPS || 10000); // 1.0× the ETH-equivalent
STORE.PLEX_FLOOR_OMR_PER_ETH = Number(process.env.STORE_PLEX_FLOOR
  || PLEX_GENESIS_OMR_PER_ETH * STORE.PLEX_PREMIUM_BPS / 10000);
// RETIRED SKUS — a package that once existed and no longer sells. Kept by NAME so the routes can say
// what happened instead of "unknown package", which would be a lie about a sku somebody may have a
// bookmark or a client card for (the /v1/wage tombstone discipline).
//
// `made_man` sold ONE thing — a mint credit — for a hardcoded 0.01 ETH, which made it a SECOND ETH
// rail on the mint that did not move with MINT_TRANCHES. Nothing priced it from the schedule (the
// only readers are the admin display and preflight's warning, both on MINT_FEE_ETH), so from wave 2
// the published price would have been 0.025 while this door still sold the same entitlement for
// 0.01 — the cheaper-rail rule routed around by a second ETH rail rather than a $OMR one. The mint
// already has its own rail with a published schedule, a Safe-settable price and a preflight guard;
// a duplicate storefront for the same entitlement is one more thing to keep in lockstep forever,
// and the lesson this economy keeps re-learning is that the surest way to keep two rails in
// lockstep is to have one. Retired 2026-08-10, before wave 2 made the gap live.
// A retired entry keeps its PRICE and its GRANT, not just its epitaph, because retiring a package
// must not cancel a purchase somebody already paid for. A payment recorded before the retirement (or
// one parked pre-link that reconciles after it) is money that already moved, so `grantPackage`
// resolves it here and honors exactly what was bought. Buying it ANEW is what stops: the ingest and
// the $OMR rail both refuse. Without this the retirement would also crash `sweepUncreditedStore` for
// every OTHER parked payment queued behind it — a retired sku is not an emergency for the sweep.
export const RETIRED_PACKAGES = {
  made_man: {
    priceEth: 0.01, grant: { mintCredits: 1 }, name: 'Made Man',
    // reads in BOTH contexts — an API error and a card on the shelf — so it names no route.
    why: 'Getting made has its own rail: pay the published fee on-chain, or earn a credit off the '
      + 'mission ladder, which grants one outright.',
    where: '/v1/character/mint',
  },
};
export const packageOf = (sku) => STORE.PACKAGES.find((p) => p.sku === sku) || null;
export const passActive = (a, now = Date.now()) => !!a?.pass_until && new Date(a.pass_until).getTime() > now;

// ── THE PATRON PROGRAM (Store Tier-4) — the off-chain backer-prestige ladder over the Store. patron_spent
// is a lifetime ETH-equivalent contribution meter (bumped only on REAL contributions — a txHash'd ETH
// purchase — the txHash-gate precedent, so a comp can't fabricate a top benefactor). PURE STATUS: no new
// §10.4 reason. `plexDiscountBps` ships at 0, so the tier NAMES are the program — but the rail it would
// discount is LIVE again (everything but the mint), so arming it is a real lever rather than dead weight.
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
  RWA_BPS: Number(process.env.BOND_RWA_BPS || 2500),           // 25% → the treasury (v2 §6 — primary inflow;
                                                               // the stock float it once funded was retired 2026-07-31,
                                                               // env name kept to avoid a config migration)
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
// ── D1 (SIGNED 2026-08-05, founder: "Max fee for D1") — THE TRADE FEE, folded into OmertaHook ──
// THE SWAP TRADE FEE IS RETIRED (founder-directed 2026-08-11: "get rid of the Vig trade fee").
//
// It was a small fee on EVERY swap (buys included), 100% to the Vig, and it was never armed — the
// backend was built and chain-dormant, so not one real row was ever written. What retired it is the
// decision it was blocking: a `PoolKey` holds exactly ONE hook address, and TWO hooks wanted the
// canonical OMR/ETH pool — this one (an afterSwap cut of every swap's ETH leg → the Vig) and
// `OmertaHook`'s four-slice SELL TAX (dev / treasury / LP / vig). They cannot both serve it. The
// sell tax wins on three counts: it is the one the money router already declares end to end, it
// taxes SELLING rather than all trading (so it never prices the buy side of the market we want
// deep), and it is what makes a bond a hold rather than an arbitrage (§9.6 — `DISCOUNT_BPS` must
// stay strictly under `sellTaxBps`, a relation a separate trade fee does nothing for).
//
// Retired the standard way (the emission.js / PLEX-mint discipline): the PAYER is DELETED, not left
// dormant behind a flag — `recordTradeFee`, `syncTradeFees`, the watcher's `tradeFeeLogs` and the
// worker's wiring are gone, and `TRADE_FEE` no longer exists, so nothing is one env var from live.
// What STAYS is the history half: `'trade'` remains in the router's `VIG_SOURCES` forever (a source
// removed from membership is the loudest alarm the router has, and conservation is a claim about the
// WHOLE ledger), the waterfall still declares the row marked retired so "where a dollar goes" makes
// the POSITIVE claim rather than going silent, and a freshness check asserts nothing new writes it.

export const SELL_TAX = {
  BPS: Number(process.env.SELL_TAX_BPS || 900),                // 9% on a sell (contract cap: 1000)
  DEV_BPS: Number(process.env.SELL_TAX_DEV_BPS || 200),        // 2% of the trade → founder revenue
  RWA_BPS: Number(process.env.SELL_TAX_RWA_BPS || 400),        // 4% → the treasury (was the stock float)
  LP_BPS: Number(process.env.SELL_TAX_LP_BPS || 300),          // 3% → LP depth / buybacks. the three sum to BPS
  MAX_BPS: 1000,                                               // OMR.sol's MAX_SELL_TAX_BPS — kept in lockstep
};
(() => {
  // The equality is FOUR-way since the family buyback (Phase 1, 2026-08-11): the community slice
  // (SELL_TAX_COMMUNITY_BPS, env read directly — COMMUNITY.TAX_BPS is defined later in this file,
  // after this guard runs) sits BEFORE the LP remainder in recordSellTax. At the default 0 the sum
  // is the original three-way 900. The guard is what makes the Phase-2 flip honest: turning the
  // slice on REQUIRES lowering a sibling scalar in the same deploy (the locked design lowers
  // SELL_TAX_RWA_BPS 400→160 as SELL_TAX_COMMUNITY_BPS goes 0→240) or the module refuses to load —
  // never a silent squeeze of the LP remainder.
  const community = Number(process.env.SELL_TAX_COMMUNITY_BPS ?? 0);
  const t = SELL_TAX.DEV_BPS + SELL_TAX.RWA_BPS + SELL_TAX.LP_BPS + community;
  if (t !== SELL_TAX.BPS) throw new Error(`SELL_TAX DEV+RWA+LP+COMMUNITY must sum to BPS ${SELL_TAX.BPS} (got ${t})`);
  if (SELL_TAX.BPS > SELL_TAX.MAX_BPS) throw new Error(`SELL_TAX.BPS ${SELL_TAX.BPS} exceeds the contract cap ${SELL_TAX.MAX_BPS}`); })();

// ── THE UNDERWRITER — the off-chain backer-prestige pillar layered over the chain bond. Purely
// STATUS + $OMR sinks (zero new faucet, zero chain touch). The UNDERWRITER SCORE combines the
// real-ETH axis (bonded_eth, read-derived from the bonds table) with an earn-in-game pledge axis
// (pledged_omr, an account column bumped by a $OMR burn), so a player reaches backer status in
// alpha via THE PLEDGE while the ETH axis lights up at mainnet. All numbers are sign-off levers.
BONDS.ETH_SCORE_OMR = Number(process.env.BOND_ETH_SCORE_OMR || 30000);  // $OMR-equiv per bonded ETH for the STATUS score (deterministic, NOT the live oracle — the R1-Portfolio precedent)
BONDS.PLEDGE_MIN = Number(process.env.BOND_PLEDGE_MIN || 60);          // min in-game $OMR pledge
// THE LP LEAGUE (hook-blocks design, the deferred status block): LP depth held OVER TIME in the
// canonical OMR pool joins the underwriter score — depth is the binding constraint on the bond
// daily cap (tools/bond-dials.js), so the players providing it earn the status axis that already
// honors backers. An ETH-DAY of depth scores 1% of a bonded ETH (≈100 days of 1 ETH depth ≈ one
// bonded ETH) — a PROPOSED default, sized properly once a real pool exists (BALANCE.md § THE LP
// LEAGUE). Status-only: no payout attaches, the Sybil posture holds.
BONDS.LP_SCORE_PER_ETH_DAY = Number(process.env.BOND_LP_SCORE_PER_ETH_DAY || 300);
BONDS.BACKER_TIERS = [
  { min: 0, name: 'Depositor' }, { min: 600, name: 'Patron' }, { min: 6000, name: 'Underwriter' },
  { min: 60000, name: 'Financier' }, { min: 300000, name: 'Kingmaker' }, { min: 1500000, name: 'The Reserve' },
];
BONDS.CHARTER_TIERS = [
  { tier: 1, name: 'Bronze Charter', omr: 150 }, { tier: 2, name: 'Silver Charter', omr: 450 },
  { tier: 3, name: 'Gold Charter', omr: 1200 }, { tier: 4, name: 'Platinum Charter', omr: 3600 },
  { tier: 5, name: 'The Founding Charter', omr: 9000 },
];
export const underwriterScore = (bondedEth, pledgedOmr, lpEthDays = 0) =>
  Math.round((Number(bondedEth || 0) * BONDS.ETH_SCORE_OMR + Number(pledgedOmr || 0)
    + Number(lpEthDays || 0) * BONDS.LP_SCORE_PER_ETH_DAY) * 1e6) / 1e6;
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
    { tier: 4, reward: { omr: 12 } },
    { tier: 5, reward: { title: 'Bag Man' } },
    { tier: 6, reward: { respawnTokens: 1 } },
    { tier: 7, reward: { energy: true } },
    { tier: 8, reward: { omr: 18 } },
    { tier: 9, reward: { title: 'The Bookkeeper' } },
    { tier: 10, reward: { respawnTokens: 2 } },
    { tier: 11, reward: { energy: true } },
    { tier: 12, reward: { title: 'Made of the Ledger', omr: 30 } }, // the capstone
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
  if (t !== 10000) throw new Error(`REVENUE_SPLIT_BPS must sum to 10000 (got ${t})`);
  // (red team 2026-08-16) …AND the community carve must fit inside the share it comes out of. The
  // Store's community slice is carved from the FOUNDER remainder, which nothing validated: the sum
  // check above cannot catch it because the remainder is computed as `founder - carve` and therefore
  // sums to 10000 for ANY carve, including a negative one. Measured with STORE_COMMUNITY_BPS=5000:
  // the module boots clean and the store row reads `[vig 4000, treasury 2000, community 5000,
  // operations -1000] sum 10000` — real ETH earmarked to the dev wallet booked as another system's
  // spendable budget. The fee split (above) already guards its own three-way sum; this is the same
  // guard for the shape that hides behind an implicit remainder.
  const commStore = Number(process.env.STORE_COMMUNITY_BPS ?? 0);
  if (commStore > s.founder)
    throw new Error(`STORE_COMMUNITY_BPS (${commStore}) exceeds the founder share it is carved from (${s.founder}) — the operations remainder would go negative and real revenue would be double-booked.`);
  const commHarvest = Number(process.env.HARVEST_COMMUNITY_BPS ?? 0);
  if (commHarvest > 10000)
    throw new Error(`HARVEST_COMMUNITY_BPS (${commHarvest}) exceeds 10000 — the treasury remainder in recordHarvestFee would go negative.`);
})();

// ── NAMED LANDMARKS — one dedicable plaque per district (a deflationary $OMR STATUS sink). Dedicate
// by burning $OMR; a bigger flex takes the plaque. The name borne is the account's dynasty (or street).
// Pure status — outside §10.4 (the burn rides vanity:%) and outside the sim-audited balance. Levers.
export const LANDMARKS = {
  MIN_DEDICATE: 120, // the first-dedication floor; a takeover must strictly exceed the current flex
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
  NAME_OMR: 48,               // name the club ($OMR vanity burn)
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
    { id: 'bottle',  name: 'bottle service',            omr: 18,  prestige: 12 },
    { id: 'magnum',  name: 'a magnum of champagne',     omr: 48,  prestige: 35 },
    { id: 'reserve', name: 'the reserve — top of the top', omr: 120, prestige: 90 },
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
    CASH_PER: 10000, OMR_WEIGHT: 8, OWNER_WEIGHT: 0.5,
    RANKS: [
      { min: 0, name: 'Nobody' }, { min: 25, name: 'A Face' }, { min: 100, name: 'A Regular' },
      { min: 300, name: 'High Roller' }, { min: 800, name: 'Big Shot' }, { min: 2000, name: 'King of the Night' },
    ],
    // ── step four — renown PERK (access/status, never power): EARNED decor styles unlocked by renown (no
    // ETH — a cosmetic you earn by being seen). id → the renown threshold to apply it. Style-name in DECOR_STYLES.
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

// ── THE ESTATE ("the compound"): the deep PERSONAL $OMR sink + a new "home" surface ──
// The don's mansion — a tiered, furnishable home that DISPLAYS your legend. Pure STATUS (display-only,
// no gameplay power → outside the sim-audited balance, the vanity/seal/Portfolio precedent); the only
// §10.4 flow is the enumerated `estate:*` $OMR BURN through the vanity `spendOmr` till. Account-level,
// so it SURVIVES DEATH — the compound passes to the heir. TIERS are bought SEQUENTIALLY (the seal
// ladder); FEATURES are one-time unlocks gated by `minTier`. All numbers are founder sign-off levers.
export const ESTATE = {
  NAME_OMR: 18, // name / rename your compound
  TIERS: [
    { tier: 1, name: 'Safe House',        omr: 240,   blurb: 'A room over a social club. It\'s a start.' },
    { tier: 2, name: 'Row House',         omr: 720,  blurb: 'Your name on the deed. Respectable.' },
    { tier: 3, name: 'Uptown Brownstone', omr: 2100,  blurb: 'Doormen who forget what they see.' },
    { tier: 4, name: 'Country Estate',    omr: 5400,  blurb: 'Gates, dogs, and a long driveway.' },
    { tier: 5, name: 'The Compound',      omr: 15000, blurb: 'The kind of place they make movies about.' },
  ],
  FEATURES: [ // one-time $OMR unlocks; cosmetic, some display a real trophy. minTier gates each.
    { id: 'trophy_room', name: 'Trophy Room',    omr: 360,  minTier: 2, blurb: 'Your rarest iron and finest guns, mounted.' },
    { id: 'wine_cellar', name: 'Wine Cellar',    omr: 240,  minTier: 2, blurb: 'Vintages older than most grudges.' },
    { id: 'garden',      name: 'Rose Garden',    omr: 180,  minTier: 2, blurb: 'Where quiet conversations happen.' },
    { id: 'show_garage', name: 'Show Garage',    omr: 480,  minTier: 3, blurb: 'Glass walls for the collection.' },
    { id: 'study',       name: 'The Study',      omr: 300,  minTier: 3, blurb: 'Leather, brass, and the family books.' },
    { id: 'chapel',      name: 'Private Chapel', omr: 600, minTier: 4, blurb: 'Absolution, in-house.' },
    { id: 'vault',       name: 'The Vault',      omr: 900, minTier: 4, blurb: 'What survives you sits behind a foot of steel.' },
    { id: 'panic_room',  name: 'Panic Room',     omr: 720, minTier: 4, blurb: 'For when the doors come down.' },
    { id: 'ballroom',    name: 'Grand Ballroom', omr: 1200, minTier: 5, blurb: 'For weddings, wakes, and sit-downs.' },
    { id: 'menagerie',   name: 'The Menagerie',  omr: 1500, minTier: 5, blurb: 'A tiger. Because you can.' },
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
  { id: 'groundskeeper', name: 'Groundskeeper',     wageOmrDay: 3, hireOmr: 30,  minTier: 1, blurb: 'The roses never say what they saw.' },
  { id: 'butler',        name: 'The Butler',        wageOmrDay: 6,   hireOmr: 60, minTier: 2, blurb: 'Runs the house. Required to host a gala.' },
  { id: 'sommelier',     name: 'Sommelier',         wageOmrDay: 9, hireOmr: 90, minTier: 3, blurb: 'Pours vintages older than most grudges.' },
  { id: 'curator',       name: 'Curator',           wageOmrDay: 12,   hireOmr: 120, minTier: 3, blurb: 'Keeps the trophies gleaming and the books straight.' },
  { id: 'house_capo',    name: 'Capo of the House', wageOmrDay: 18,   hireOmr: 180, minTier: 4, blurb: 'Security, discretion, and a very short memory.' },
];
ESTATE.STAFF_WALK_MS = 7 * 24 * 3600 * 1000;   // arrears older than this → the staff WALK (bounds owed)
ESTATE.GALA_OMR = 90;                           // × the estate tier — the host's burn
ESTATE.GALA_MIN_TIER = 2;                       // a Row House can host; a Safe House can't
ESTATE.GALA_MS = 4 * 3600 * 1000;               // the open-doors window
export const estateStaffOf = (id) => ESTATE.STAFF.find((s) => s.id === id) || null;
// ── ESTATE Tier-4 catalog growth (content only — estateTierOf/upgradeEstate/unlockFeature/hireStaff
// already iterate the catalog, so the additions are zero-logic; the gala cost = GALA_OMR×tier scales
// itself). A 6th tier, 2 tier-gated features (the home of the collection), 1 staff. Sign-off levers.
ESTATE.TIERS.push({ tier: 6, name: 'The Palazzo', omr: 36000, blurb: 'A city block that answers to your name.' });
ESTATE.FEATURES.push(
  { id: 'gallery',     name: 'The Gallery',     omr: 1800, minTier: 5, blurb: 'Your auction trophies, lit and labelled.' },
  { id: 'observatory', name: 'The Observatory', omr: 2100, minTier: 6, blurb: 'You watch the whole city from up here.' });
ESTATE.STAFF.push(
  { id: 'archivist', name: 'The Archivist', wageOmrDay: 24, hireOmr: 240, minTier: 5, blurb: 'Keeps the provenance and the collection catalog.' });

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
  FEE_OMR: 12,             // the anti-spam listing fee (BURNS — auction:consign:fee)
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
export const SOCIAL_GAME_URL = process.env.SOCIAL_GAME_URL || process.env.PUBLIC_URL || 'https://www.omerta.fun'
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

// ═══ EMISSION — RETIRED (economy v3 step 1: kill the faucet) ═══
// The Street Wage lived here: a hard-capped endowment releasing a halving daily budget, paid
// pro-rata to respect gained. v3's first wall is "no faucet" — zero mint reasons that pay a player,
// so in-game $OMR can never exceed what was DEPOSITED and "extraction <= inflow" stops being a
// constraint the reserve queue enforces and becomes an identity the ledger exhibits. A scheduled
// printer is precisely what that wall forbids, so the block and its helpers are gone rather than
// zeroed: a dormant faucet is one env var away from being a live one.
//
// The reason `emission:wage` is NOT gone — `invariants.js` still counts the rows it wrote (a live
// database holds them and conservation is a whole-ledger claim) and asserts that no NEW one appears.
// See src/emission.js for the tombstone and BALANCE.md § THE FARM for the measured Sybil economics
// that made a per-account-capped wage pay a farm of cheap identities better than a real player.

// ═══ THE DESK — where a spent $OMR goes (economy v3 step 2: recycle instead of burn) ═══
// Design: omerta-economy-v3-design.md §3.3, §4.1, §4.2. A sink used to DESTROY the token. Now it
// hands it to the desk, which sells it back to the market at the daily auction. The reasoning, in
// the design's own words: "every OMR sink is the house's cut", so annual revenue ≈ annual sink
// volume × price, and the KPI is RETURN VELOCITY — how many times a year one token comes home —
// rather than supply. You cannot burn AND recycle the same unit: burning supports price, recycling
// produces revenue. The founder chose revenue, which also means the pitch must never call this
// deflationary (design §10 risk B).
//
// `SINK_REASONS` is the SINGLE list of $OMR sink reasons: `invariants.js` builds the §10.4 burn term
// from it, and the ledger hook in game.js decides what feeds the desk from it. Two copies of this
// list is the drift that would quietly destroy supply the desk was supposed to sell, so there is
// one. (Trailing `%` = a LIKE prefix, otherwise an exact reason.)
export const DESK = {
  SINK_REASONS: ['vest:%', 'cleanpapers', 'lab:%', 'gear:mint:%', 'path:%', 'gang:dissolved',
    'withdraw:omr', 'vanity:%', 'intel:%', 'respec%', 'plex:%', 'law:jury', 'law:envelope',
    'foundation:%', 'rwa:%', 'estate:%', 'auction:win', 'auction:take', 'auction:consign:fee',
    'megaproject:omr', 'bond:%', 'business:spec%', 'death:duty', 'window:burn', 'made:%', 'brokers:%',
    // THE LAB MODULE (kitchen.js:301) is a $OMR sink — but it ledgers `kitchen:module`, not `lab:*`,
    // so it was in the omr VOCABULARY yet MISSING from this burn term, and every purchase drifted the
    // §10.4 $OMR conservation check (a stable −N = the total ever spent on modules; found live via the
    // Discord alert 2026-08-07). Adding it here counts the burn AND (via the shared recyclesToDesk)
    // feeds the shelf like every other sink — and because it now counts the HISTORICAL rows, the live
    // drift resolves to 0 on the next check with no migration. The paired CASH `kitchen:module` row is
    // untouched: burnSql is `currency='omr'` and the recycle hook guards on `currency==='omr'`.
    'kitchen:module',
    // ECONOMY v3 step 7 — the DETERMINISTIC rarity upgrade. A sink like any other, so it recycles
    // to the shelf rather than burning; that is the design's "bridge between the two markets",
    // since ETH-priced NFT demand pulls on OMR without the game ever selling a random outcome.
    'rarity:%'],
  // THE ONE EXCLUSION, and it is the whole point of the step. `withdraw:omr` is not the house taking
  // a cut — it is the token LEAVING the game to exist on-chain in the player's own wallet, backed by
  // the reserve. Recycle it and the same unit exists twice: once as a real ERC-20 the player holds,
  // once as desk inventory we sell to somebody else. That is an unbacked mint wearing a recycle
  // costume, and it is exactly what wall 3 ("extraction ≤ deposits") forbids. Every other sink is
  // the house's cut and feeds the desk.
  NOT_RECYCLED: ['withdraw:omr'],
};
// One row per recycled sink, so the pair (the player's −X spend, this +X) nets to zero inside the
// burn term while the bucket holds the value. A DISTINCT reason on purpose: reusing the sink's own
// reason would silently corrupt every escrow check that sums by reason (auction:win, window:burn…).
export const DESK_RECYCLE_REASON = 'desk:recycle'
const deskMatch = (pat, reason) => (pat.endsWith('%') ? reason.startsWith(pat.slice(0, -1)) : reason === pat)
export const recyclesToDesk = (reason) => !!reason
  && DESK.SINK_REASONS.some((p) => deskMatch(p, reason))
  && !DESK.NOT_RECYCLED.some((p) => deskMatch(p, reason))

// ═══ THE BAND AND THE AUCTION (economy v3 step 3) ═══
// Design §3.1, §3.2, §11.6, §11.7. The desk now SELLS what step 2 taught it to collect.
//
// PRICES HERE ARE **ETH PER $OMR**, so "descending" is literal and a Dutch clock reads the way a
// Dutch clock should. The oracle quotes the inverse (`price_omr_per_eth`, the same print the vault
// reads), so the anchor is 1/that — inverted once, at the edge, and never again.
//
// THE ELEGANT PART, and the reason the band and the auction are ONE block: the auction's RESERVE is
// the band's upper edge. Above `UPPER` the desk should be selling, below it should not, and a Dutch
// auction that will not clear under its reserve enforces exactly that with no second "should we sell
// today?" decision to write, forget, or get wrong. Unsold inventory simply rolls to tomorrow.
export const BAND = {
  ANCHOR_DAYS: 30,   // the TWAP window the anchor comes from. Manipulation cost scales with the
                     // window; shorter and a whale sets our price. (Mainnet: OmrTwapOracle's own
                     // period. Off-chain here we read the latest print, which IS that average.)
  UPPER_BPS: 10000,  // 1.00× anchor — SELL at or above the 30-day average. Roughly half of all days,
                     // which is the cadence of a seller who wants turnover rather than market timing.
  LOWER_BPS: 8000,   // 0.80× anchor — BUY 20% below. The buy side is step 4; the constant lives here
                     // because the band is one object and splitting it invites the two halves to drift.
  // The 20%-wide dead zone is the point: narrower and the desk churns on ordinary noise, paying gas
  // and spread to trade with itself; wider and it sits idle through conditions it should act on.
};
// (named DESK_AUCTION, not AUCTION — that name is the Auction House's weekly $OMR trophy lots, a
// different market entirely, and two `AUCTION`s in one namespace is a bug waiting for a hurry.)
export const DESK_AUCTION = {
  DURATION_MS: 6 * 3600000,  // 6h — long enough for a global player base to see one.
  OPEN_BPS: 15000,           // opens at 1.5× anchor and descends LINEARLY to the reserve. High enough
                             // that a genuine squeeze can clear up there; nobody is forced to bid it.
  FLOAT_CAP_BPS: 100,        // 1% of float per day. Yesterday's sink volume is the lot size, but a
                             // huge sink day must not become a dump — the cap is what makes that true.
  FLOAT_CAP_MIN_OMR: 6000,   // the BOOTSTRAP floor under that cap, and it is not decoration: with a
                             // float of zero the 1% cap is zero, so no auction opens, so nobody can
                             // buy, so the float stays zero. A cold start would deadlock without it.
  MIN_LOT: 1,                // below this the desk does not bother opening; a dust auction is noise.
  // VEST: there isn't a separate one, and that is deliberate. A `desk:sale` credit appends a FRESH
  // FIFO lot, so `tax.js:earlySurcharge` already prices anything sold here at the full early-exit
  // rate decaying to zero over `FRESH_WINDOW_MS` (48h) — design §11.7's vest, already implemented.
  // One concept, one constant: simultaneously the anti-dump, the float creator, and the §5(ii) loot
  // exposure window. Building a second timer beside it would only give the two a way to disagree.
  ORACLE_MAX_AGE_MS: 172800000, // 48h. FAIL-CLOSED (the vault's ethPrice precedent): no print, or one
                             // older than this, and NO AUCTION OPENS. It must never fall back to a
                             // default price — "we don't know what $OMR costs" resolving to "sell it
                             // at the default" is a standing free option on the desk's whole shelf.
  ETH_POL_BPS: 5000,         // the ETH proceeds split 50/50 POL / founder (design §3.1, founder spec).
};
// THE BUY SIDE (economy v3 step 4). The band's other edge: below `LOWER` the desk RESTOCKS from the
// open market, because buying inventory back is sometimes cheaper than waiting for the sinks to
// return it. Bought $OMR goes to the SHELF, not the fire (design §3.3) — the desk is a rental
// business, and this is buying stock.
//
// THE BUDGET IS POL TRADING FEES, EXCLUSIVELY (design §11.10), and the exclusivity is the point:
// not the founder half (not ours to spend), not the LP half (POL depth is the binding constraint),
// and NEVER by minting — that last one is wall 4, the single line between this and Olympus. Fees are
// self-limiting (you cannot spend what the pool did not earn), they scale with real activity rather
// than with price, and they compound correctly: the sell tax grows POL, deeper POL earns more fees,
// more fees buy back more.
export const DESK_BUYBACK = {
  MIN_ETH: 0.001,            // below this it is not worth a transaction
  // FAT-FINGER FLOOR, and it is a real guard rather than paranoia: the shelf credit is
  // `eth / price`, so a price a decimal place too low mints inventory out of a typo. The RWA float
  // shipped exactly that bug and fixed it with a continuity bound; this is the same bound, expressed
  // against the band's own anchor. An execution below 0.20x anchor is not a dip, it is a broken feed.
  PRICE_FLOOR_BPS: 2000,
};
// The Dutch clock: linear from OPEN down to RESERVE across DURATION_MS, then flat at RESERVE.
// Returns ETH per $OMR. Clamped at both ends so a late/early call can never quote outside the band.
const round8 = (n) => Math.round(n * 1e8) / 1e8
export const auctionPriceAt = (a, now) => {
  const open = Number(a.open_price), reserve = Number(a.reserve_price)
  const t0 = new Date(a.opens_at).getTime(), t1 = new Date(a.closes_at).getTime()
  if (!(t1 > t0)) return reserve
  const frac = Math.min(1, Math.max(0, (now - t0) / (t1 - t0)))
  return round8(open - (open - reserve) * frac)
};

// ═══ THE FLOAT (economy v3 step 5) — THE MADE MAN and THE ACCESS STAKE ═══
// Design §5 (the holding problem), §11.2, §11.5.
//
// THE PROBLEM THIS SOLVES, stated plainly: a consumable you should never HOLD cannot be the loot
// that makes killing worth it. If the rational play is buy-and-spend-instantly, nobody carries a
// balance, there is nothing on the body, and the extraction path is empty. Forcing a FLOAT is
// therefore the central mechanic, not a detail. Two mechanisms, both reusing shipped systems.
//
// (1) THE MADE MAN — a recurring $OMR subscription that buys STANDING, not power. It is the
//     strongest of the two because it creates CONTINUOUS demand rather than one-off demand.
//
//     WHAT THIS DELIBERATELY IS NOT, and the reasoning matters (§11.2). The obvious move is to
//     re-denominate operating costs — business upkeep, crew wages, territory upkeep — from cash into
//     $OMR. That is REJECTED: it would mean a player MUST buy real money to keep earning, which is a
//     subscription wall on the core loop rather than a premium tier, and it converts a free game into
//     a rented one. **OPERATING COSTS STAY IN CASH. ALL OF THEM.** That is the line that keeps the
//     game free, and it is the binding constraint (§4.3: $OMR buys TIME, ACCESS and STATUS — never POWER).
//
//     So being made gates the SOCIAL AND PRESTIGE layer plus pure convenience, and gates no earning
//     loop's POWER: a free player runs a complete empire — streets, crime, kitchen, family, PvP, the
//     Law, the Pen, the market, the fronts — at full strength, and can hunt made men for their $OMR.
//     That is RuneScape membership and EVE PLEX, and it is the honest answer to "is this pay-to-win":
//     paying buys you a seat at tables where you can LOSE money. It buys no advantage at any of them.
//
//     ── §4.3 IS RETIRED. $OMR MAY BUY POWER (founder directive, 2026-08-02). ──
//     This paragraph and the two above are kept as the RECORD of what the rule was, because ~15 sites
//     cite it and a reader who finds one needs to know it no longer binds. D8=C had briefly narrowed
//     the gates to status only; the founder then retired the underlying rule outright and answered
//     D8=D, so both retired ACCESS gates are BACK (speakeasy, the high-stakes stake) and the ladder
//     below is the power layer. What replaces §4.3 is not "anything goes" — it is a CEILING:
//
//       (a) POWER IS CAPPED, and the cap is reachable without paying. That is the whole claim the
//           player-facing copy now makes, and it is checkable rather than rhetorical — see MADE_LADDER.
//       (b) NO POWER IN COMBAT. Not on p2w grounds, on LOOP grounds. Offensive power makes paying
//           players predators on free ones, which empties the free population that makes the streets
//           worth walking. Defensive power makes made men harder to rob, which directly undercuts
//           "a free man can hunt you for your $OMR" — the loop the whole float exists to create.
//           Combat is the one axis where power costs you the thing power is supposed to feed.
//       (c) OPERATING COSTS STAY IN CASH. §11.2's line survives untouched: nobody must buy real
//           money to keep earning. A ladder you may climb is a premium tier; a bill you must pay is
//           a rented game.
export const MADE = {
  OMR: 120,                        // the dues
  MS: 30 * 24 * 3600 * 1000,      // 30 days, extended from later-of(now, current end) — the retainer/wire-sub precedent
  ESTATE_TIER: 4,                 // the UPPER estate tiers (Country Estate and above) want standing
};
// A made man is an ACCOUNT-level status (it is paid for with real value, so it survives death and
// carries to the heir — the Store's `patron`/`pass_until` precedent), and this reader is a pure
// function so every gate can import it with no module cycle.
export const isMade = (acct, now = Date.now()) =>
  !!(acct?.made_until && new Date(acct.made_until).getTime() > now);
export const madeSeconds = (acct, now = Date.now()) =>
  isMade(acct, now) ? Math.ceil((new Date(acct.made_until).getTime() - now) / 1000) : 0;

// (2) THE ACCESS STAKE (§5 iii, §11.5) — access requires a HELD balance, not a spend. Hold N $OMR
//     staked to sit at the high-stakes table. Held, not spent, so it generates no revenue — its whole
//     job is to create permanent, VISIBLE, LOOTABLE float attached to exactly the players worth
//     hunting. It rides the existing `account_persistent.staked` bucket, so there is no new schema
//     and no new §10.4 surface; staking in is instant and unstaking still crosses the unbond window.
//
//     IN-GAME, UNAMBIGUOUSLY (§11.5). An on-chain stake would be a safe harbour, and §4.1 admits no
//     fourth way for $OMR to move. The "on-chain is trustless" objection does not survive inspection:
//     the in-game balance is ALREADY custodial the moment a player deposits, so an on-chain stake
//     would not change the trust model — only add gas to the loop it exists to create. Staked $OMR is
//     lootable at the COMMITTED rate above; defending your seat is the game.
export const ACCESS_STAKE = {
  HIGH_OMR: 300,   // the high-stakes room (CASINO.HIGH_MAX per roll) wants this much staked
};

// ═══ THE LADDER — power for HOLDING (founder decision D8=D, 2026-08-02) ═══
// With §4.3 retired, the question stopped being "may $OMR buy power" and became "attached to WHAT".
// The two answers do OPPOSITE things to the float, which is the problem step 5 exists to solve:
//   • attached to the SUBSCRIPTION (spend 20, get X) → demand to SPEND. Revenue and deflation, no float.
//   • attached to the STAKED BALANCE (hold N, get X) → demand to HOLD. That IS the float, and it is
//     what makes OMR_LOOT_COMMITTED mean anything and killing a made man worth the ammo.
// So the ladder keys on `account_persistent.staked`, and being made climbs it by MADE_RUNGS.
//
// WHY BEING MADE IS A SHORTCUT AND NOT A GATE, which is a deliberate deviation from the shape first
// proposed to the founder and is driven by a MEASUREMENT rather than taste. $OMR has no faucet since
// v3 step 1; a free player's lifetime supply is the mission ladder — 9 jobs, and the last two need
// level 100. Requiring BOTH a recurring dues burn AND a held stake would put the ladder out of a
// free player's reach entirely, which would break the one claim the new player-facing copy makes.
// As a shortcut, dues buy a real rung AND the ceiling stays reachable without paying.
//
// THE CEILING IS THE CLAIM, and it is checkable rather than rhetorical: the top rung's `min` sits
// under what the mission ladder pays lifetime, so a free player who works it clears the whole ladder.
// Paying gets you there sooner and for less held; it does not get you higher. `test/made.js` pins
// that RELATION against the live MISSIONS and MADE_LADDER tables so a retune of either cannot quietly
// make the copy false — which is not hypothetical: both have since been rescaled ~6× together, and
// the relation held while every literal that had been written into a comment went stale.
//
// WHAT IS DELIBERATELY ABSENT: anything in COMBAT — see the §4.3 note above for why that is a loop
// argument, not a p2w one. The perks are CAPACITY (carry more, hold more energy/nerve, park more) plus
// ONE economic edge at the top rung on the FENCE — an ACTIVE loop you have to boost cars to use,
// not a passive drip, so the ladder rewards playing rather than idling. Every number is a founder
// sign-off lever; `fenceBps` is the only one that moves a signed faucet and is sim-measured (P9.28).
export const MADE_LADDER = {
  // cumulative (absolute) values per rung, the GANG_SEALS/tier-ladder shape — not additive steps
  RUNGS: [
    { min: 60,  name: 'Earner',    trunk: 1, energy: 5,  nerve: 1, garage: 1, fenceBps: 0 },
    { min: 180,  name: 'Operator',  trunk: 2, energy: 10, nerve: 2, garage: 2, fenceBps: 0 },
    { min: 450,  name: 'Capo',      trunk: 3, energy: 15, nerve: 3, garage: 3, fenceBps: 250 },
    { min: 900, name: 'Kingmaker', trunk: 4, energy: 20, nerve: 4, garage: 4, fenceBps: 500 },
  ],
  MADE_RUNGS: 1,   // dues climb the ladder by this many rungs — the shortcut, never a gate
};
// The rung INDEX (-1 = none). Pure, account-in / number-out, so every touchpoint reads one function
// and they cannot disagree — the energyCapOf/view/accrual discipline.
export const madeRungIdx = (acct, now = Date.now()) => {
  const staked = Number(acct?.staked || 0);
  let idx = -1;
  MADE_LADDER.RUNGS.forEach((r, i) => { if (staked >= r.min) idx = i; });
  if (isMade(acct, now)) idx += MADE_LADDER.MADE_RUNGS;
  return Math.min(idx, MADE_LADDER.RUNGS.length - 1);
};
export const madeRungOf = (acct, now = Date.now()) => MADE_LADDER.RUNGS[madeRungIdx(acct, now)] || null;
// the one accessor every perk site calls: ladderFx(acct, 'trunk') etc. 0 when off the ladder.
export const ladderFx = (acct, key, now = Date.now()) => Number(madeRungOf(acct, now)?.[key] || 0);
// the fence/melt multiplier, as a multiplier so it composes with the skill chain unchanged
export const ladderFenceMult = (acct, now = Date.now()) => 1 + ladderFx(acct, 'fenceBps', now) / 10000;

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
  // NPC-FAMILY DIPLOMACY (2026-08-06) — the diplomacy board stops being all-human. A player can sue an
  // NPC family for PEACE (propose a pact through the existing route); the worker signs the NPC's side and
  // signing ENDS its live OFFENSIVE on you (making peace stops the guns). While the pact stands the
  // OFFENSIVE won't target you AND you can't raid them (the existing `pact` touchpoint) — break it (the
  // oathbreak) to resume the war. §10.4-NEUTRAL: a pact is a status row, the peace is pure pacing. Plus
  // FLAVOR: the worker maintains a few NPC↔NPC alliances (pure status, surfaced on the war board) so the
  // landscape isn't all-human. All sign-off levers.
  NPC: {
    ALLY_TARGET: 2,                 // live NPC↔NPC alliances the worker maintains (flavor — war-board only)
  },
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
  // VALUE-AT-STAKE indexing (RE-SIM PASS 2 / P9.20d): the chest scales with the TARGET stronghold's
  // build cost (TIERS[tier-1].cost) — tearing down The Iron Capital ($40M built) is a war, not a $50k
  // errand — floored at SIEGE_COST so the low-tier on-ramp is unchanged (3% only clears the floor at
  // Bastion tier 4 and above). Burns win or lose. Founder sign-off lever.
  SIEGE_COST_BPS: 300,              // 3% of the target stronghold's build cost, floored at SIEGE_COST
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
  DIG_OMR: 60,                 // the shovel — burns win or lose (the npchit-fee posture)
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
  runs:      { name: 'The Limited Runs',   items: LIMITED_RUNS.map((r) => ({ id: r.id, name: r.name })) }, // scarcity §2 — N of each, ever
  bespoke:   { name: 'The Bespoke',        items: SHIPMENT.COMMISSIONS.map((c) => ({ id: c.id, name: c.name })) }, // scarcity §3 — commissioned from the shipment
})

// ═══ THE FIRSTS (omerta-scarcity-design.md §1) — the one trophy that can only ever be won once.
// The luxury layer had quantity (140 collection items, 10 trades, 35+ boards) and no SCARCITY: two
// players can hold the same complete collection, so a completionist's trophy says "I did the work"
// and never "and you cannot have it". A FIRST is claimed by the first ACCOUNT in the server's life
// to cross the line, and nobody can take it or earn it again — everyone else can still finish
// everything, only the FIRST is gone. Account-keyed → survives death (the deed/legend posture).
//
// PURE STATUS: no currency, no reason, no ledger row, no gameplay power. It is unbuyable BY
// CONSTRUCTION — every crossing below is earned play, and there is no path that sells one.
//
// The catalog DERIVES from the live catalogs (content, never stored — the collectionCatalog rule),
// so adding a mastery track or a collection category adds its FIRST the day it ships.
export const firstsCatalog = () => {
  const out = {};
  for (const [id, c] of Object.entries(collectionCatalog()))
    out[`collection:${id}`] = { kind: 'collection', name: `The Complete ${c.name}`,
      blurb: `First in the city to own every last one — all ${c.items.length}.` };
  for (const t of MASTERY.TRACKS)
    out[`mastery:${t.id}`] = { kind: 'mastery', name: `Master of ${t.name}`,
      blurb: `First to take ${t.name} all the way to ${MASTERY.MAX_LVL}.` };
  for (const g of SKILLS.GRANDMASTERIES)
    out[`grandmastery:${g.id}`] = { kind: 'grandmastery', name: g.name,
      blurb: `First to walk two branches to the end and earn ${g.name}.` };
  out['clue:master'] = { kind: 'clue', name: 'The Master Trail',
    blurb: 'First to dig up a master casket at the end of the hardest trail in the city.' };
  return out;
};
export const firstOf = (id) => firstsCatalog()[id] || null;

// ═══ LIMITED RUNS (omerta-scarcity-design.md §2) — N of them exist, ever ═══
// Every item in this game is infinite-supply at a deterministic price: two players wanting the same
// car both get one, and nobody has ever queued for anything. A limited run is the first object whose
// price is set by other players WANTING it rather than by a hash.
//
// A run is a NAMED VARIANT layered on an existing catalog model, never a new model: the car is
// mechanically identical (value, melt, race power, insurance — all read `model_id`), so a run adds
// ZERO balance surface and needs no prototype edit (CARS is MACHINE-OWNED — ground rule #2). What it
// adds is a serial and a hard city-wide cap.
//
// ⚠ MINTED BY A RARE ROLL ON A SUCCESSFUL BOOST — never sold, and there is no purchase path anywhere.
// That is the standing rarity rule and it binds here with full force: **sell deterministic, drop
// random.** Money may buy exactly what it is quoted; a random outcome may be DROPPED, never SOLD.
// You steal cars; sometimes the car you steal turns out to be one of twenty-five.
//
// The cap is real and one-directional: a melted run car is DESTROYED and the counter never
// decrements, so supply only ever falls. That makes the melt decision a real one and hands the
// remaining holders something they did not have before.
export const LIMITED_RUNS = [
  { id: 'midnight',  model: 'nocturne',  cap: 25, name: 'The Midnight Series',
    blurb: 'Twenty-five left the coachbuilder in black. Nobody wrote down who ordered them.' },
  { id: 'ghostline', model: 'spectre',   cap: 12, name: 'The Ghost Line',
    blurb: 'Twelve chassis, twelve dead registrations. The paperwork was the point.' },
  { id: 'coronation', model: 'sovereign', cap: 9, name: 'The Coronation Nine',
    blurb: 'Nine were built for a coronation that never happened. They still gleam.' },
  { id: 'lastrun',   model: 'tsarina',   cap: 3,  name: "The Tsarina's Last Run",
    blurb: 'Three. The factory burned the week after, and the moulds with it.' },
];
export const runOf = (id) => LIMITED_RUNS.find((r) => r.id === id) || null;
// The drop chance on a SUCCESSFUL boost, per run still open. Deliberately small — a run should be
// a story, not a grind target. TEST-ONLY override (the BUSINESS_RAID_P / CAR_THEFT_P precedent).
export const LIMITED_RUN_P = 0.004;
export const limitedRunP = () =>
  (process.env.LIMITED_RUN_P != null ? Number(process.env.LIMITED_RUN_P) : LIMITED_RUN_P);

// ═══ THE SHIPMENT (omerta-scarcity-design.md §3) — the contested material ═══
// The runite-ore answer, built as a MATERIAL and never a currency. Once a day the city gets a
// shipment of something the catalogs cannot produce, landing at a seed-drawn district (forecastable
// like every §7.11 draw — you can plan for it, you cannot manufacture it), first-come against a
// CITY-WIDE daily cap with a per-player cap so one whale cannot take the lot.
//
// Every part of this is chosen against the failure it would otherwise cause:
//  · NOT A CURRENCY — an owned quantity on the character, like trunk cargo or contraband: LOOTABLE
//    on a fire-kill, dies with the street, never touches §10.4.
//  · AN INPUT, NEVER AN OUTPUT — it pays no cash. Its only use is COMMISSIONING a bespoke piece,
//    which is a cash SINK. So the drop is emission-safe BY CONSTRUCTION: nothing about it can
//    inflate anything, and the material's whole economic role is to gate a sink.
//  · CONTENTION IS THE FEATURE — a city-wide cap plus a drawn location is the "swarm contention on a
//    limited respawn" this was designed from, and the first thing here where being THERE and being
//    EARLY beats being rich.
//  · THE APEX CARTELS DROP IT — routing an apex outfit yields units, so the reservoir loop finally
//    pays in the scarce thing rather than the abundant one.
//
// The commissions are BESPOKE PIECES: numbered, account-level, purely cosmetic status objects. That
// is deliberate — a material that bought POWER would make a contested drop pay-to-win for whoever
// can camp a district, and the whole point of a luxury layer is that surplus wealth buys standing,
// never advantage.
export const SHIPMENT = {
  NAME: 'the shipment',
  MATERIAL: 'Cut Swiss steel',      // what the crates hold — flavour, used in every player-facing line
  // THE CITY STOCK SCALES WITH THE CITY. A fixed daily quantity is wrong at BOTH ends: at three
  // players it never empties, so contention — the entire feature — never happens; at five hundred it
  // is gone in the first minute of the landing hour and everybody else learns to stop looking. So the
  // day's stock is a FLOOR plus a step off the living-player count (the deedNeighborhoodsOpen /
  // EXPANSION_STEP precedent). The shape is deliberate: the FLOOR dominates a thin city (so the loop
  // is playable when there is nobody to contend with) and the STEP dominates a full one (so the day
  // is exhausted by a fraction of the base, whatever the base is).
  CITY_BASE: 40,                    // the floor — a thin city's day, at any population
  CITY_STEP: 10,                    // living players per step
  CITY_PER_STEP: 8,                 // units added per step (0.8/player ⇒ ~20% of the city gets a full share)
  CITY_MAX: 400,                    // the ceiling. HONEST FLAG: this is the one number that puts the
                                    // fixed-cap problem back at very high population — revisit it there.
  PER_PLAYER: 4,                    // one player's daily take — deliberately NOT scaled. This is what
                                    // stops one whale taking the lot, and it should get RELATIVELY
                                    // tighter as the city grows, which a fixed number does by itself.
  ROUT_UNITS: 6,                    // what routing an APEX cartel outfit yields (coop fixtures only)
  LOOT_RATE: 0.5,                   // a fire-kill takes half the victim's held units (the contraband twin)
  // THE COMMISSIONS — the sink. Cash is the §10.4 sink; the units are the gate. Pure status.
  COMMISSIONS: [
    { id: 'case',   units: 2,  cash: 120000,  name: 'A Gold Cigarette Case',
      blurb: 'Monogrammed, and heavy enough to stop a small calibre. It has, once.' },
    { id: 'watch',  units: 4,  cash: 400000,  name: 'A Perpetual Wristwatch',
      blurb: 'Swiss, and older than the family. It has not been wound since 1931 and keeps perfect time.' },
    { id: 'bust',   units: 8,  cash: 1200000, name: 'A Marble Bust of Yourself',
      blurb: 'Commissioned from a sculptor who does headstones. He said he saw no difference.' },
    { id: 'service', units: 16, cash: 4000000, name: 'The Silver Service',
      blurb: 'Fifty-two pieces for a table nobody in this city is brave enough to sit at.' },
  ],
};
export const commissionOf = (id) => SHIPMENT.COMMISSIONS.find((c) => c.id === id) || null;
// the day's city stock at a given living-player population. Stamped onto the day row when the day
// materializes, so it is STABLE for the whole day — a player who reads "12 left" and then takes can
// never find the cap moved under them by a signup.
export const shipmentCityCap = (population) => Math.max(SHIPMENT.CITY_BASE, Math.min(SHIPMENT.CITY_MAX,
  SHIPMENT.CITY_BASE + Math.floor(Math.max(0, Number(population) || 0) / SHIPMENT.CITY_STEP) * SHIPMENT.CITY_PER_STEP));
// WHERE it lands today — the §7.11 seed, so the whole town reads the same answer and can forecast it.
export const shipmentDistrictOf = (day = dayOf()) =>
  DISTRICTS[Math.floor(hash01(`shipment:${day}:${MARKET_SEED}`) * DISTRICTS.length) % DISTRICTS.length].id;
// the next few days, so a player can plan a trip (the cityForecast precedent)
export const shipmentForecast = (days = 5, day = dayOf()) =>
  Array.from({ length: days }, (_, i) => ({ day: day + i, district: shipmentDistrictOf(day + i) }));

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
  MIN_OMR: 6,             // smallest $OMR brick
  OMR_RATE: 83,          // $-value credited per donated $OMR (fixed lever, genesis AMM rate)
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
  // ARMED (founder-directed 2026-08-02, the strategy package). This drop twists SIGNED levers, so
  // it shipped dormant until the pool was production-signed; the founder signed it as the cheapest
  // strategic lever the game has — the whole base re-plans its season around the same twist, which
  // is exactly the "scarcity of OPTIONS" the strategy diagnosis said the game lacks, and it reuses
  // content that already exists. Read PER CALL (the RATE_LIMIT posture), so `SEASON_MODS=off`
  // reverts to vanilla with no deploy — the twists are additive to a season that still works.
  if ((process.env.SEASON_MODS || 'on') !== 'on') return SEASON_MODS[0];
  return SEASON_MODS[Math.floor(hash01(`seasonmod:${seasonIdx}:${MARKET_SEED}`) * SEASON_MODS.length)];
};
export const seasonDaysLeft = (day = dayOf()) => 28 - (day % 28);

// ═══ THE WEEKLY BULLETIN — "the word this week" ══════════════════════════════════════════════════
// The game has three cadences of "what's happening" — daily city events, the 28-day season mod — but
// nothing WEEKLY, so a returning player met the same daily shapes with no fresh frame. THE BULLETIN
// rotates a server-wide SPOTLIGHT each week (deterministic from the week + seed, like every other
// draw), naming a pillar to focus on and a CHALLENGE tied to it. PURE STATUS: the reward is a rotating
// weekly TITLE (the streak-milestone / hitman-rep precedent) — no currency, no §10.4 surface, no
// signed lever (unlike SEASON_MODS, which twists the economy; this only reframes and rewards a badge).
// The challenge METRIC is an account-level legend that SURVIVES DEATH, measured as a DELTA from a
// snapshot taken when you pick up the bulletin — a fresh goal from the moment you check in each week.
export const BULLETIN = {
  THEMES: [
    { id: 'wetwork',   name: 'Blood Week',  word: 'The families are restless — bodies are the currency this week.',    tab: 'pvp',     spotlight: 'Wet Work',      metric: 'kills',         target: 2,      title: "The Week's Reaper" },
    { id: 'kitchen',   name: 'Cook Week',   word: 'The corners are hungry — product moves fast this week.',            tab: 'kitchen', spotlight: 'The Kitchen',   metric: 'product_moved', target: 250000, title: "The Week's Chemist" },
    { id: 'racing',    name: 'Race Week',   word: 'The strip is packed — engines screaming, pink slips on the line.',  tab: 'races',   spotlight: 'Street Races',  metric: 'race_wins',     target: 3,      title: "The Week's Wheelman" },
    { id: 'boxing',    name: 'Fight Week',  word: 'The crowd wants a show — the ring is the only place to be.',        tab: 'boxing',  spotlight: 'The Fights',    metric: 'boxing_wins',   target: 3,      title: "The Week's Contender" },
    { id: 'smuggling', name: 'Tide Week',   word: 'The docks never sleep this week — freight by the boatload.',        tab: 'scores',  spotlight: 'The Port',      metric: 'smuggled',      target: 300000, title: "The Week's Smuggler" },
    { id: 'heists',    name: 'Score Week',  word: 'Crews are assembling — the vaults are heavy this week.',            tab: 'scores',  spotlight: 'Crew Heists',   metric: 'heists_pulled', target: 2,      title: "The Week's Mastermind" },
    { id: 'world',     name: 'War Week',    word: 'The cartels are exposed — the whole city hunts them this week.',    tab: 'city',    spotlight: 'The Cartels',   metric: 'cartel_damage', target: 750000, title: "The Week's Warlord" },
  ],
  // TEST-ONLY override (the SEASON_MOD precedent) — pin the week's theme so a suite is deterministic.
};
export const bulletinOf = (wk = weekOf()) => {
  const ov = process.env.BULLETIN_THEME; // TEST-ONLY (boot-guard listed)
  if (ov != null) return BULLETIN.THEMES.find((t) => t.id === ov) || BULLETIN.THEMES[0];
  return BULLETIN.THEMES[Math.floor(hash01(`bulletin:${wk}:${MARKET_SEED}`) * BULLETIN.THEMES.length)];
};

// ═══ PRIME TIME — the nightly synchronous window ═════════════════════════════════════════════════
// The game is a deep MULTIPLAYER built for a population it has never met (the harness lands a plausible
// solo player at level 33 in a week with no human contact), and everything social so far is ASYNC —
// nothing gives a reason to be online AT THE SAME TIME as other players. PRIME TIME is that reason: one
// forecastable window each day (a rotating UTC hour, so every timezone gets its turn over a week) that
// CONCENTRATES the base into one hour. Both axes rotate off the §7.11 seed, so the night is a surprise:
//   · the MECHANIC — step one ships THE RALLY (answer the call); step two adds HAPPY HOUR, step three
//     THE SIEGE. MECHANICS grows as each is built, so there is never a dead night.
//   · the MODE — `value` (the reward is bounded cash) or `honor` (the reward is a rotating status title),
//     drawn independently, so some nights pay and some nights are pure bragging rights.
// THE RALLY is co-present by construction: the value reward SCALES WITH TURNOUT (more people answering
// = bigger reward each, capped), settled at window close by the worker so everyone gets the FINAL count.
// The value faucet is bounded (BASE + PER×min(turnout−1, CAP), once/day, level-floored, agent-excluded)
// — a §10.4 cash faucet `primetime:rally`, sim-flagged; all numbers are founder sign-off levers.
export const PRIME_TIME = {
  MECHANICS: ['rally', 'happyhour', 'siege'],  // the seed draws among the BUILT mechanics (never a dead night)
  WINDOW_H: 1,                    // the window is one UTC hour
  FORECAST_DAYS: 7,              // how many nights ahead the board shows (anticipation — players plan)
  RALLY_BASE: 2000,             // value-rally: cash for answering the call (the floor at turnout 1)
  RALLY_PER: 500,               // + per OTHER head that answered — turnout-scaled → co-present
  RALLY_TURNOUT_CAP: 20,        // turnout counted up to here (bounds the faucet: max BASE + PER×CAP)
  RALLY_MIN_LVL: 5,             // anti-Sybil floor (the WANTED_MIN_LVL/npcHit-rookie precedent)
  TITLES: ['Night Owl', 'The Faithful', 'Answered the Call', 'The Regular', 'First to the Bar', 'The Usual Suspect'],
  // HAPPY HOUR (step two) — "the house is buying rounds": a REPEATABLE window action (up to ROUNDS a
  // night), so the night FEELS different from the once-a-night rally. value → petty cash per round
  // (a bounded faucet `primetime:happy`, max ROUNDS×CASH/night); honor → gambling mastery XP per round
  // (drinking sharpens the card sense — status, zero §10.4 via bumpMastery's `primetime` action tag).
  HAPPY_ROUNDS: 3,              // rounds you can buy per night
  HAPPY_CASH: 800,             // value: cash per round (max HAPPY_ROUNDS×HAPPY_CASH = $2,400/night)
  // THE SIEGE (step three) — the whole city rallies against a shared target for one hour. Each fighter
  // lands ONE strike (once/night); the siege FALLS only if the crowd's cumulative damage crosses the
  // target by close — so you NEED others there (the strongest co-presence of the three). Settled at
  // close by the worker: on a WON siege every fighter shares the spoils (value → flat cash / honor →
  // a badge); a siege that DIDN'T fall pays nobody (a real collective-stakes moment). Reuses the
  // primetime_rally participation table (a night is ONE mechanic, so no row collision).
  SIEGE_STRIKE: 100,           // damage one fighter lands
  SIEGE_NEED: 8,               // fighters needed to crack it → target = SIEGE_NEED × SIEGE_STRIKE
  SIEGE_CASH: 3000,            // value: the spoils each fighter takes on a WON siege (bounded, once/night)
  SIEGE_TITLE: 'Stormed the Gates',   // honor: the badge for cracking it
};
// The night's draw — mechanic + mode + the UTC hour + the honor title, all a pure function of the day.
// PRIME_TIME_MECH / PRIME_TIME_MODE are TEST-ONLY overrides (the SEASON_MOD/BULLETIN_THEME precedent).
export const primeTimeOf = (day = dayOf()) => {
  const M = PRIME_TIME.MECHANICS;
  const mech = process.env.PRIME_TIME_MECH || M[Math.floor(hash01(`pt:mech:${day}:${MARKET_SEED}`) * M.length)];
  const mode = process.env.PRIME_TIME_MODE || (hash01(`pt:mode:${day}:${MARKET_SEED}`) < 0.5 ? 'value' : 'honor');
  const hour = Math.floor(hash01(`pt:hour:${day}:${MARKET_SEED}`) * 24);
  const title = PRIME_TIME.TITLES[Math.floor(hash01(`pt:title:${day}:${MARKET_SEED}`) * PRIME_TIME.TITLES.length)];
  return { day, mechanic: mech, mode, hour, title };
};

// ═══ FAMILY CHARTERS (the strategy package's ASYMMETRY) ══════════════════════════════════════════
// Every family was mechanically IDENTICAL — a 20-man family and a 3-man family differed only in what
// they happened to hold, so "who are we" was not a question anybody could answer differently. A
// charter makes it one: pick what your family is GOOD at and, in the same breath, what it gives up.
//
// THE HANDICAP IS THE MECHANIC. A charter with only an upside is a free upgrade everybody takes, and
// then nothing is asymmetric again — so every charter trades one axis for another, and NO CHARTER is
// a legitimate fourth answer (a family that has not chosen gets neither, which is what makes choosing
// a real bet rather than a formality).
//
// The Syndicate and the Outfit are deliberate MIRRORS on the same two axes — do you earn or do you
// fight — which is what makes an alliance between them complementary rather than merely additive: a
// Syndicate family funds an Outfit family's wars. The Fixers sit on different axes entirely and are
// the interesting third pick.
//
// Every effect is ONE touchpoint on an EXISTING modifier site, and the modified number is what is
// charged AND what is ledgered (the decree/roster discipline). Deliberately NO faucet is touched:
// two are sink discounts, one is a contest-price multiplier, one is Bureau pacing, one is how much a
// losing stake forfeits. So this needed no economy retune and breaks no existing family.
// The four numbers are named ONCE here rather than written into each entry, so each is a scalar the
// lever register can pin on its own — a multiplier buried inside an array entry is invisible to the
// reader check, and pinning the whole catalog would mean pinning its prose too.
export const FAMILY_CHARTER_FX = {
  EDGE: 0.85,        // what your strong axis costs you
  COST: 1.15,        // …and what the axis you gave up costs you
  HEAT_EDGE: 0.75,   // the Fixers' Bureau pace
  LOSS_COST: 1.25,   // …paid for when a hedge fails
};
export const CHARTERS = [
  { id: 'syndicate', name: 'The Syndicate', blurb: 'Merchants first. Your operations run lean — but you buy peace rather than fight for it, and taking ground costs you more.',
    good: 'operations cost 15% less to run', bad: 'taking turf costs you 15% more',
    upkeepMult: FAMILY_CHARTER_FX.EDGE, turfMult: FAMILY_CHARTER_FX.COST },
  { id: 'outfit', name: 'The Outfit', blurb: 'Soldiers first. You take ground cheaper than anyone — but nobody in this family keeps the books, and the pad runs dear.',
    good: 'taking turf costs you 15% less', bad: 'operations cost 15% more to run',
    turfMult: FAMILY_CHARTER_FX.EDGE, upkeepMult: FAMILY_CHARTER_FX.COST },
  { id: 'fixers', name: 'The Fixers', blurb: 'Politicians first. The Bureau builds its file on your operations slowly — but you hedge, and a stake you lose is mostly gone.',
    good: 'the Bureau heats your operations 25% slower', bad: 'a losing contest stake forfeits 25% more',
    scrutinyMult: FAMILY_CHARTER_FX.HEAT_EDGE, contestLossMult: FAMILY_CHARTER_FX.LOSS_COST },
];
// NAMED `familyCharterOf`, not `charterOf` — the bond programme's treasury seal ladder already owns
// that name in this same file (BONDS.CHARTER_TIERS), and two `export const charterOf` in one module
// is a SyntaxError that takes the whole server down at import.
export const familyCharterOf = (id) => CHARTERS.find((c) => c.id === id) || null;
// the reader every touchpoint uses — 1 for a family that has not chosen, so an unchartered family is
// exactly today's family and the site needs no branch
export const charterFx = (id, key) => Number(familyCharterOf(id)?.[key]) || 1;
export const FAMILY_CHARTER = {
  // free the first time — an alpha family should not be trapped by a decision made before they knew
  // what they were. Changing it is a real $OMR sink from the family reserve on a long cooldown (the
  // seal/foundation precedent), so a charter stays a commitment without being a life sentence.
  CHANGE_OMR: 240,
  CHANGE_CD_MS: 7 * 24 * 60 * 60 * 1000,
};

// ═══ THE MAP (the strategy package's GEOGRAPHY) ══════════════════════════════════════════════════
// The six core districts were a flat SET. Every strategy game's map IS its strategy, and this one
// had none: no adjacency, no chokepoints, no "you cannot hold that because it is cut off." Holdings
// were interchangeable, so THE WATCH and THE SEALED BID were independent decisions about unrelated
// squares rather than moves on a board.
//
// DISTRICTS is MACHINE-OWNED (rules.generated.js — edit the prototype and re-extract), so the edge
// list lives HERE, in the hand-written half, keyed by district id. That is the right seam anyway:
// geography is a hand-authored layout, not a table the prototype has an opinion about.
//
// The layout, read as a city: the waterfront (docks) runs past the yards and up the canal; the canal
// feeds the foundry and the strip; the foundry backs onto the yards and the strip; the yards climb to
// the hill; the strip runs up to the hill. Two ENDS (docks, cathedral, degree 2) which are the
// natural on-ramps, and a dense middle. Symmetry is asserted in test/social.js — an edge list that
// disagrees with itself would make the same border cost two different prices depending on which side
// you read it from.
export const DISTRICT_ADJ = {
  docks:     ['canal', 'brick'],
  canal:     ['docks', 'foundry', 'neon'],
  foundry:   ['canal', 'brick', 'neon'],
  brick:     ['docks', 'foundry', 'cathedral'],
  neon:      ['canal', 'foundry', 'cathedral'],
  cathedral: ['brick', 'neon'],
};
export const districtNeighbours = (id) => DISTRICT_ADJ[id] || [];
// Both effects are MULTIPLICATIVE on purpose. The family-ledger measurement (sim P9.20d) found that
// every FLAT family cost becomes noise the moment a family is established — raising a constant only
// moves which week it stops mattering — so anything added to the turf price from here indexes to the
// price rather than sitting beside it.
export const MAP = {
  // a held district is dearer to come for once per FRIENDLY district bordering it: the holder can
  // reinforce across their own ground, so contiguous turf genuinely defends itself
  NEIGHBOUR_PREMIUM_MULT: 1.10,
  // …and cheaper to take when the ATTACKER already holds something next door — your men are already
  // on that side of the river. One discount however many borders you share: this is a foothold, not
  // a stacking bonus for encirclement.
  ADJACENT_MULT: 0.85,
};

// ═══ THE SEASON HAS AN ENDING (the strategy package's ARC) ═══════════════════════════════════════
// The diagnosis the strategy package answered was "no scarcity of OPTIONS". The next one is that
// nothing collects them: every system ran forever at the same tempo, a season RESET rather than
// CONCLUDED, and a clock nobody can see makes "not yet" free. Strategy gets most of its tension
// from a deadline, so the 28 days now have a SHAPE.
//
// Three phases. The last one — THE RECKONING — is where the map is allowed to move: an incumbent
// who has been sitting on turf since week one has to hold it while it is cheap to challenge, the
// windows are short, and contests resolve fast enough that several can land in a night.
//
// The escalation rides ON the phase object, exactly like SEASON_MODS: each field is ONE touchpoint
// composing multiplicatively on an EXISTING site, and the modified number is what is charged AND
// what is ledgered (the decree/amnesty discipline). Deliberately turf-only and deliberately no
// FAUCET — the reckoning makes turf CHEAPER to fight over and FASTER to settle; it never pays more.
// Nothing here resets or seizes anything: a season ends with a crown and a record, not a wrecking
// ball, which is the call that keeps this shippable into a thin alpha.
//
// SEASON_PHASE is a TEST-ONLY override (the SEASON_MOD precedent) — without it the reckoning is
// reachable 7 days in 28 and no assertion about it could be deterministic.
const SEASON_LEN = 28;   // MUST match seasonIdxOf above AND worker.js runSeasonRollover (`dayOf()/28`)
export const SEASON_PHASES = [
  { id: 'opening', name: 'The Opening', from: 0,
    blurb: 'A fresh season. Positions are cheap and nothing is settled — take ground while it is quiet.' },
  { id: 'long_game', name: 'The Long Game', from: 7,
    blurb: 'The city has found its shape. Build, hold, and watch who is climbing.' },
  { id: 'reckoning', name: 'The Reckoning', from: 21,
    blurb: 'The last week. Turf is cheap to challenge, the windows are short and contests settle fast — whatever you are holding when the books close is what the city remembers.',
    // THE ESCALATION — three touchpoints, all pacing/price, all on turf, none a faucet:
    contestMsMult: 0.5,      // sealed contests resolve twice as fast → several can land in a night
    floorMult: 0.75,         // the price of challenging held turf drops → incumbents get contested
    watchWindowMult: 0.5 },  // a holder's cheap window halves → you cannot hide behind a declared hour
];
export const seasonDayOf = (day = dayOf()) => day % SEASON_LEN;
export const seasonPhaseOf = (day = dayOf()) => {
  const ov = process.env.SEASON_PHASE; // TEST-ONLY (boot-guard listed)
  if (ov != null) return SEASON_PHASES.find((p) => p.id === ov) || SEASON_PHASES[0];
  const d = seasonDayOf(day);
  let p = SEASON_PHASES[0];
  for (const x of SEASON_PHASES) if (d >= x.from) p = x;
  return p;
};
// the escalation reader every touchpoint uses — 1 outside the reckoning, so the site is a no-op
// eleven months of the year and needs no branch (the seasonModOf posture).
export const seasonFx = (key, day = dayOf()) => Number(seasonPhaseOf(day)[key]) || 1;
// how many days until the books close — the number the clock actually shows a player
export const seasonPhaseLeft = (day = dayOf()) => {
  const d = seasonDayOf(day);
  const i = SEASON_PHASES.findIndex((p) => p.id === seasonPhaseOf(day).id);
  const next = i + 1 < SEASON_PHASES.length ? SEASON_PHASES[i + 1].from : SEASON_LEN;
  return next - d;
};

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
  // JAILBIRDS (founder: the daily "Bust a player out of lockup" contract was uncompletable on a
  // solo run — residents never went to jail, so the §7.8 bust verb had no target). The worker keeps
  // TARGET residents serving a sentence; a bust frees a real character through the unchanged §7.8
  // path (its curve makes long sentences near-impossible and short tails worthwhile, so the play is
  // catching one near the end). Pure jail_until pacing — zero §10.4; the bust:reward faucet it makes
  // reachable is the SIGNED §7.8 one, bounded by the refill rate (BALANCE flag).
  // MAX_S 1200 → 400 (SIGN-OFF 2026-08-05, Part B row A5): the bust reward is LINEAR in the
  // sentence while the §7.8 chance FLOORS at 10% above 240s, so camping the longest spawn was
  // always strictly best — a ~$463k/day city ceiling on the ONE loop that spends no signed
  // resource. Capping the spawn at 400s caps the camp reward at ~$6.5k and cuts the ceiling ~⅔;
  // availability (the daily contract's completability) is untouched.
  JAILBIRDS: { TARGET: 2, MIN_S: 240, MAX_S: 400 },
  // STEP TWO of THE STREET WAR (omerta-street-rivals-design.md §4): residents OWN things worth
  // taking, so the asset-crime loop is live in an empty alpha. Every mark is a DELIBERATE, bounded
  // faucet flagged in BALANCE.md (the npc:seed / NPC-trucking posture):
  //  · CARS spawn as cheap band-priced beaters (steal → melt/fence is petty), counted into the car
  //    conservation invariant via rng_audit 'npc:car' grant/retire rows (the boost precedent).
  //  · FRONTS run at FRONT_INCOME_BPS of the catalog curve (a resident runs a SLEEPY joint) — the
  //    only realization is a player's rob/shakedown/inside-job REDIRECT, so per-front emission is
  //    bounded by the scaled curve; residents never collect. The Sacking SKIPS npc victims (a free
  //    catalog front on a kill would skip the buy sink and then earn the FULL curve).
  //  · BOATS: a dinghy at the docks for some capo/boss residents (steal → resale is the flag).
  //  · GOODS: a resident sometimes carries freight bought with its OWN seed cash at the real
  //    market price + take (recycle-only — the robbery realizes what the resident already paid).
  MARKS: {
    CAR_P:   { made: 0.6, capo: 0.8, boss: 0.9 },
    CAR_VAL: { made: [800, 2000], capo: [2000, 8000], boss: [5000, 20000] },  // catalog value band per band
    FRONT_P: { made: 0.4, capo: 0.6, boss: 0.8 },
    FRONTS:  { made: ['laundromat', 1], capo: ['laundromat', 2], boss: ['restaurant', 1] },  // [kind, tier]
    BOAT_P:  { capo: 0.35, boss: 0.6 },   // always the dinghy — the resale faucet stays petty
    FRONT_INCOME_BPS: 500,                // the sleepy-joint scale on the catalog income curve (sim P9.25 sized 1000→500: the shakedown-cadence ceiling ran ~$683k/day at 10%, ~2× the NPC-trucking parity band — 5% lands ~$342k worst case)
    GOODS_BPS: 1000, GOODS_MAX_UNITS: 10, // freight budget: ≤10% of cash, ≤10 units, spendable-floored
    // ── STEP THREE: the resident's STABLE. Residents field fighters and racers so the PvP boards
    // (the Circuit, the strip, the stable field) are LIVE in an empty alpha — the same reason step
    // two gave them consent limits. The wager is the audited casino:pvp taxed TRANSFER, so a
    // resident may only ever stake what they already hold: the limit is a share of their own cash,
    // and a resident who cannot reach the system's own MIN_STAKE simply DOESN'T LIST (the step-two
    // F2 lesson — a limit under the floor sits in an empty window and reads as a dead board).
    // capo/boss only for that reason: a `made` resident's seed can't cover a $5k stake.
    FIGHTER_P: { capo: 0.4, boss: 0.6 },
    RACER_P:   { capo: 0.4, boss: 0.6 },
    STAKE_BPS: 1500,                      // what a resident will put on one bout/match: 15% of pocket
  },
  // ── NPC FAMILIES (omerta-npc-families-design.md). The coach's first social rung — "Nobody
  // survives alone" — held 43% of a 7-day solo run and could never be acted on, because on a thin
  // server there is nothing to JOIN: the only actionable half is founding one, at level 5 and
  // $25,000, which a level-3 player does not have. Residents found and fill families through the
  // AUDITED createGang/joinGang, so a real player can walk into one.
  //
  // The founding cost comes out of the founder's own npc:seed cash, so this is a SINK — the feature
  // adds no faucet at all. §10.4 surface is exactly two already-audited reasons: `gang:found` and
  // (on the last member leaving) the existing `gang:dissolved` burn.
  //
  // What an NPC family may NEVER do, each decided in the design doc rather than left to an accident:
  // hold a COMMISSION seat (it cannot vote, and a silent ballot shrinks the electorate and deadlocks
  // decrees that modify signed surfaces), draw the FAMILY YIELD (real player-funded $OMR into a
  // reserve nobody can spend from), be DECLARED WAR on (a family that never retaliates is a
  // fixed-price standing farm with treasury spoils on top), or hold TURF. The invariants
  // deliberately still count their treasuries — those are real §10.4 buckets.
  FAMILIES: {
    TARGET: 3,          // families the worker keeps alive. 0 disables the feature entirely.
    MIN_MEMBERS: 2,     // below this the worker recruits another resident into it
    MAX_MEMBERS: 5,     // far below M3.GANG_MAX_MEMBERS (20), so a player always has room to walk in
    FOUND_BANDS: ['capo', 'boss'],   // the bands that can carry the $25,000 founding cost
    // Fictional only (the Broadcast posture). Must clear createGang's own validation: 3-24 chars,
    // ASCII `[\w .,'&-]`, and a 2-4 character A-Z0-9 tag.
    NAMES: [
      ['The Calabrese Ring', 'CAL'], ['Sorrento Social Club', 'SORR'], ['The Ardizzone Crew', 'ARDZ'],
      ['Pellegrino Brothers', 'PELL'], ['The Anselmi Outfit', 'ANSL'], ['Ferrante Trading Co', 'FERR'],
      ['The Vaccaro Family', 'VACC'], ['Lombardo Associates', 'LOMB'],
    ],
  },
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
// A resident FIGHTER's ring name and RACER's name (step three) — pure flavor beside NPC_FIRST/LAST,
// fictional only (the Broadcast posture: no real person's name anywhere in the city).
export const FIGHTER_MONIKERS = ['The Hammer', 'Ironjaw', 'Lefty', 'The Butcher', 'Two-Ton', 'Sandman',
  'The Wall', 'Cutter', 'Boom-Boom', 'The Ox', 'Nightstick', 'Glass Joe', 'Bulldog', 'The Anvil'];
export const RACER_NAMES = ['Midnight Runner', 'Ash Widow', 'Grey Ghost', 'Lucky Penny', 'Iron Duchess',
  'Smoke Signal', 'Copper Kettle', 'Silent Partner', 'Dark Horse', 'Tin Star', 'Red Vendetta',
  'Paper Moon', 'Quick Nickel', 'Long Shadow', 'Bootleg Bess', 'Cinder Lane'];

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

// ── THE POPULATION step four — RESIDENTS FILL THE SCHEDULED FIELDS ──────────────────────────────
// The crew co-op loops (heists → fillHeist, world raids → hireRaid) already let a solo player hire NPC
// bodies. The SCHEDULED-FIELD co-op games did not: a solo player who entered the poker tournament waited
// out the window and got REFUNDED for lack of a field (< MIN_ENTRANTS). Now residents standing at the
// Neon Mile fill a human-started tournament — a warm body paying its OWN buy-in into the SAME escrow the
// human path uses (recycle-only; §10.4 untouched, the 'poker tourney escrow' identity holds). REACTIVE
// ONLY: a resident enters a tournament a HUMAN already materialized and never spins one up itself, so the
// city never manufactures fake events and /v1/online stays an honest human count. A retired/killed
// resident's entry auto-burns as casino:tourney:death at resolve (the LEFT-JOIN dead path), so no escrow
// cleanup is needed on retirement. Bounded so a solo human always gets a playable field but residents
// don't flood it. Founder sign-off lever.
POPULATION.EVENTS = {
  TOURNEY_FIELD: 6,   // residents fill an open poker tournament up to this many entrants (PAYOUTS is 3 places)
  GP_FIELD: 6,        // …an open Grand Prix (residents race their beaters; PAYOUTS is 3 places)
  STAKES_FIELD: 6,    // …an open Stakes (residents with a stable racer; PAYOUTS is 3 places)
  FUTURITY_FIELD: 6,  // …nominate into an open Futurity up to this many RUNNERS (FIELD_MAX is 8 — room for humans)
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
  MIN_OMR: 6,                  // no dust redemptions
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
  DAILY_CAP_OMR: 1500,          // per account, rolling 24h — the wash-cap token-bucket pattern
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
    cards: 4, yardtale: 10,                      // PEN step six — cards with the crew / a yard war story
    primetime: 6,                                // PRIME TIME HAPPY HOUR (honor night) — a round with the crew schools the card sense (gambling)
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
                                                       // (XP-rate arbitrage made the switch burn too cheap a throttle)
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

// ── THE REGIMEN (omerta-training-expansion-design.md, founder-directed 2026-07-30) ──
// Five trainable DISCIPLINES beyond muscle/cunning/speed. Each has EXACTLY ONE named touchpoint
// (the skills/decree discipline — a new single-site modifier, never a retune of a signed formula),
// and training rides the SAME gym cooldown clock as the core stats — breadth, never rate, so the
// pacing pass's throughput bound holds by construction. XP is not a currency: zero §10.4 surface.
// ALL numbers are founder sign-off levers (BALANCE.md).
export const REGIMEN = {
  CAP: 25,                 // discipline level ceiling
  XP_DIVISOR: 15,          // level = floor(√(xp/DIVISOR)) + 1 — the masteryLvlOf curve
  XP_MIN: 8, XP_MAX: 12,   // xp per gym session (rng-audited roll)
  ENERGY: 10,              // same as a core-stat session
  DRILL_XP: 25,            // a claimed trainer drill ≈ 2.5 sessions — drills stay the efficient path
  // the five disciplines + their one touchpoint each
  DISCIPLINES: [
    { id: 'stamina',      name: 'Roadwork',     desc: 'Every level adds +1 to your MAX energy — more gym, garage and crew work per day.' },
    { id: 'composure',    name: 'Steady Hands', desc: 'Every 2 levels add +1 to your MAX nerve — a deeper pool for the crime loop.' },
    { id: 'conditioning', name: 'Iron Chin',    desc: 'Healing up costs less — 1% off the Doc\'s bill per level (floor 25% off).' },
    { id: 'marksmanship', name: 'The Range',    desc: 'A steadier shot in a DUEL — a small edge on the rated ladder per level.' },
    { id: 'presence',     name: 'Work the Room', desc: 'The city remembers you — +1 to your DAILY Underworld standing budget per level.' },
  ],
  CONDITIONING_BPS: 100,   // heal ×(1 − bps·lvl/10⁴), floored…
  CONDITIONING_FLOOR: 0.75,
  DUEL_ADD: 0.6,           // marksmanship: + lvl × this to YOUR duel score (ELO self-corrects)
  // THE TRAINER DRILLS — each fixture's daily quest trains ITS discipline; Mickey rounds out your weakest
  TRAINERS: { doc: 'conditioning', armorer: 'marksmanship', harbor: 'stamina', madame: 'presence', fixer: 'composure', cornerman: 'lowest' },
  // drill tasks draw ONLY from self-sufficient bumpDaily kinds — every drill is doable alone on day one
  DRILL_TASKS: [
    { kind: 'crime', n: [3, 5], how: 'pull clean jobs on the Streets' },
    { kind: 'train', n: [2, 3], how: 'gym sessions (any stat or discipline)' },
    { kind: 'gta',   n: [1, 1], how: 'boost a car in The Garage' },
    { kind: 'goods', n: [2, 4], how: 'buy or sell trade goods on the Streets' },
    { kind: 'melt',  n: [1, 1], how: 'melt a car down in The Garage' },
    { kind: 'heist', n: [1, 1], how: 'pull the Daily Score' },
  ],
};
export const disciplineLvlOf = (xp) =>
  Math.min(REGIMEN.CAP, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / REGIMEN.XP_DIVISOR)) + 1);
// THE CAP HELPERS — view, the coach and accrual all read these, so the three sites cannot disagree.
// disc is the owned.disciplines xp map (or absent — a headless caller gets the base formula).
// `ladder` is the MADE_LADDER bonus (D8=D) — passed explicitly rather than read off an account here,
// because these are pure functions a headless caller uses with no account in hand.
export const energyCapOf = (lvl, assetCap = 0, disc = null, ladder = 0) =>
  50 + 2 * lvl + assetCap + (disc ? disciplineLvlOf(disc.stamina || 0) - 1 : 0) + (Number(ladder) || 0);
export const nerveCapOf = (lvl, disc = null, ladder = 0) =>
  10 + lvl + (disc ? Math.floor((disciplineLvlOf(disc.composure || 0) - 1) / 2) : 0) + (Number(ladder) || 0);
// the day's drill for one fixture — seed-drawn, town-wide, forecastable (the §7.11 machinery)
export const drillOf = (npc, day = dayOf()) => {
  const t = REGIMEN.DRILL_TASKS[Math.floor(hash01(`drill:${npc}:${day}`) * REGIMEN.DRILL_TASKS.length) % REGIMEN.DRILL_TASKS.length];
  const n = t.n[0] + Math.floor(hash01(`drilln:${npc}:${day}`) * (t.n[1] - t.n[0] + 1));
  return { kind: t.kind, n, how: t.how };
};

// ── THE HUSTLE (crime-loop interactivity, founder-directed 2026-07-30: "send the user down a
// checklist of things to do around the town… move around the map and talk to NPCs and move across
// the gameboards") ── A daily seed-drawn THREE-STOP job chain that physically routes a player
// around the city: meet the contact (travel + talk), do the legwork (travel + a REAL action at
// that district), collect the payoff (travel + claim). Steps are server-verified (location +
// counter deltas); the payoff is a bounded once-a-day cash faucet (BALANCE flag — the clue-casket
// posture: petty by design, the ENGAGEMENT is the product). All numbers founder sign-off levers.
export const HUSTLE = {
  PAY_PER_LVL: 200,     // payoff = max(PAY_MIN, PAY_PER_LVL × level) — once a day
  PAY_MIN: 600,
  // step-2 kinds — a real action done AFTER meeting the contact, then checked in at the named
  // district. The WORK itself is not location-gated and the copy must not claim it is: the proof is
  // a delta on the DAILY counter, which is global, so there is no way to tell where the job was
  // pulled. Enforcing it would need per-district counters (a schema change) and would buy nothing —
  // the routing this mechanic exists for is already forced by the check-in, which IS location-gated
  // at all three stops. The old copy said "while you're standing there", which was simply untrue.
  LEGWORK: [
    { kind: 'crime', how: 'pull a job' },
    { kind: 'goods', how: 'move trade goods (buy or sell on the Streets)' },
    { kind: 'train', how: 'put in a session at the gym' },
  ],
};
// The day's chain for one street — three DISTINCT stops + a (fictional) contact + the legwork,
// all off the §7.11 hash: deterministic and verifiable, and PER-STREET so the whole town isn't
// standing on the same corner. The contact draws from the SOLDIERS noir name pool (fictional
// only — the Broadcast posture).
export const hustleOf = (chId, day = dayOf()) => {
  const pick = (s, n) => Math.floor(hash01(`hustle:${chId}:${day}:${s}`) * n) % n;
  const rest = DISTRICTS.map((d) => d.id);
  const stops = ['a', 'b', 'c'].map((s) => rest.splice(pick(s, rest.length), 1)[0]);
  const contact = `${SOLDIERS.FIRST[pick('f', SOLDIERS.FIRST.length)]} ${SOLDIERS.LAST[pick('l', SOLDIERS.LAST.length)]}`;
  return { stops, contact, leg: HUSTLE.LEGWORK[pick('k', HUSTLE.LEGWORK.length)] };
};

// ═══════════ THE CAREER — the post-First-Week progression ladder (task #308) ═══════════
// Founder: "Once you complete The First Week there should be another list of tasks in progression
// for the user to set out to do and receive bonuses upon completion that takes them throughout the
// game." Five tiers, six tasks each. Rewards are CASH ONLY (the v24 social-reward rule), latched
// ONCE per ACCOUNT (career_claims PK — the ladder survives death; the heir doesn't re-farm it), so
// the whole faucet is bounded at the lifetime total per account. Tiers unlock at NEED claims (not
// all six) so a declinable task — joining a family, spilling blood — never WALLS a solo player (the
// coach harness-F1 lesson applied to a checklist); the capstone pays only on all six (the
// completionist bonus rides the last claim's row, the First-Week pattern). The CHECK for each task
// lives in career.js keyed by id (rules is data); every check is a server-verifiable signal —
// ownership, an account legend, mastery XP — never client-claimed.
export const CAREER = {
  NEED: 4,             // claims that open the next tier
  TIERS: [
    { id: 'associate', name: 'Associate', capstone: 3000, tasks: [
      { id: 'ca_path',    name: 'Declare your Path',        cash: 1000, how: 'At level 5 — the Declare Your Path card on the Streets.', tab: 'streets' },
      { id: 'ca_strap',   name: 'Get strapped',             cash: 1000, how: 'Buy any gun at the Garage armory.', tab: 'garage' },
      { id: 'ca_wheels',  name: 'Get wheels',               cash: 1000, how: 'Boost a car — The Garage.', tab: 'garage' },
      { id: 'ca_bank',    name: 'Bank $25,000',             cash: 1000, how: 'The Bank on the Streets — pocket cash is lootable, banked clears in 2h.', tab: 'streets' },
      { id: 'ca_regimen', name: 'Train a discipline',       cash: 1000, how: 'The Gym & The Regimen drawer on the Streets — any of the five.', tab: 'streets' },
      { id: 'ca_hustle',  name: 'Complete a daily hustle',  cash: 1000, how: "TONIGHT'S HUSTLE card on the Streets — three stops across town.", tab: 'streets' },
    ] },
    { id: 'soldier', name: 'Soldier', capstone: 7500, tasks: [
      { id: 'so_jump',    name: 'Win a jump',               cash: 2500, how: 'Wet Work → The Streets roster → jump somebody (a win schools your muscle).', tab: 'pvp' },
      { id: 'so_earner',  name: 'Buy an earner',            cash: 2500, how: 'A racket or asset — The Empire catalogs.', tab: 'empire' },
      { id: 'so_crew',    name: 'Pull a crew heist',        cash: 2500, how: 'Big Scores — plan one or join an open crew.', tab: 'scores' },
      { id: 'so_product', name: 'Move product',             cash: 2500, how: 'The Kitchen — cook a batch, deal it on the corner.', tab: 'kitchen' },
      { id: 'so_fight',   name: 'Win a fight',              cash: 2500, how: 'A duel (Wet Work) or a boxing bout (The Fights) — winning is what counts.', tab: 'pvp' },
      { id: 'so_trade',   name: 'Turn a trade profit',      cash: 2500, how: 'Buy trade goods cheap, sell them dear — the Trade Winds board on The City shows the spread.', tab: 'streets' },
    ] },
    { id: 'made', name: 'Made Man', capstone: 15000, tasks: [
      { id: 'md_front',   name: 'Open a front',             cash: 5000, how: 'A business front — The Empire (level 15 for the Laundromat).', tab: 'empire' },
      { id: 'md_family',  name: 'Join a family',            cash: 5000, how: 'The Family — join one off the board, or found your own.', tab: 'family' },
      { id: 'md_freight', name: 'Land a shipment',          cash: 5000, how: 'A Port run (The Port) or a convoy delivered (Big Scores).', tab: 'port' },
      { id: 'md_stable',  name: 'Sign a fighter or racer',  cash: 5000, how: 'The Fights (a boxer) or The Stable (a dog or a horse).', tab: 'boxing' },
      { id: 'md_legit',   name: 'Put $OMR to work',         cash: 5000, how: 'Going Legit — stake any amount; a committed balance climbs the ladder.', tab: 'portfolio' },
      { id: 'md_shield',  name: 'Buy protection',           cash: 5000, how: 'A safehouse stay or a bodyguard — Wet Work → Your Defenses.', tab: 'pvp' },
    ] },
    { id: 'capo', name: 'Capo', capstone: 30000, tasks: [
      { id: 'cp_vice',    name: 'Beat the odds',            cash: 10000, how: 'A real stake at the Den ($1,000+ schools you), a race win, or a purse at the Fights.', tab: 'den' },
      { id: 'cp_kingpin', name: 'Move serious weight',      cash: 10000, how: 'Lifetime product moved past $50,000 — the Kitchen legend.', tab: 'kitchen' },
      { id: 'cp_spy',     name: 'Work the wires',           cash: 10000, how: 'The Wire — a tap, a sweep, a dossier. Any intel op.', tab: 'wire' },
      { id: 'cp_blood',   name: 'Draw blood',               cash: 10000, how: 'A landed hit — search, then fire. Wetwork is a trade like any other.', tab: 'pvp' },
      { id: 'cp_empire',  name: 'Own three income streams', cash: 10000, how: 'Fronts, rackets, assets — any three earners at once.', tab: 'empire' },
      { id: 'cp_estate',  name: 'Buy a place',              cash: 10000, how: 'The Estate — a Safe House deed to start. It survives death.', tab: 'estate' },
    ] },
    { id: 'don', name: 'The Don', capstone: 60000, tasks: [
      { id: 'dn_legend',  name: 'Build a legend',           cash: 20000, how: 'Any lifetime legend past $250,000 — smuggled, product moved, or racket income.', tab: 'city' },
      { id: 'dn_master',  name: 'Master a trade',           cash: 20000, how: 'Any trade to level 25 — The Trades on The Life.', tab: 'life' },
      { id: 'dn_dynasty', name: 'Get made for good',        cash: 20000, how: 'Mint the identity — the bloodline made permanent. The fee is ETH; the mission ladder grants a credit outright.', tab: 'portfolio' },
      { id: 'dn_monument',name: 'Put your name in stone',   cash: 20000, how: 'Contribute to the Megaproject — The City. The plaque is forever.', tab: 'city' },
      { id: 'dn_champ',   name: 'Take a crown',             cash: 20000, how: '10 boxing wins, 10 race wins, or 5 duel wins — any champion’s record.', tab: 'boxing' },
      { id: 'dn_name',    name: 'Become a level-40 name',   cash: 20000, how: 'Level 40. The city knows who you are.', tab: 'streets' },
    ] },
  ],
};

// ══════════ THE STREET WAR + THE RIVALS LEDGER (omerta-street-rivals-design.md) ══════════
// Founder-directed: crimes that directly target player ASSETS, and a ledger of who has shown you
// malice. Every mechanic is a REDIRECT or an OWNERSHIP MOVE — zero new emission (the design's §0
// constraint): robbing a front takes a cut of its PENDING income on the audited shakedown
// mechanism at HALF the rate on the SAME shared per-venue window (so the signed per-venue
// extraction bound is unchanged); stealing a car moves a row (cars conserve by row count).
// ALL numbers are founder sign-off levers (pinned in test/levers.js, tabled in BALANCE.md).
export const RIVALS = {
  // rob a front — the shakedown's petty sibling: stealth build (cunning+speed/2), smaller cut,
  // a failed attempt is JAIL (it's a crime), sharing the shakedown's 8h per-venue window
  ROB_RATE_BPS: 1500, ROB_ENERGY: 8, ROB_HEAT: 6, ROB_JAIL_S: 300,
  VICTIM_MIN_LVL: 8,                 // rookie protection — both verbs (the LOOT_MIN_LVL posture)
  CAR_THEFT: {
    // p = clamp(BASE_P + (cunning + speed/2)/STAT_SCALE − sqrt(carVal)/ALARM_DIV, MIN_P, MAX_P)
    // — expensive iron protects itself (a $5k beater ~0.45 for a mid thief, an apex car floors
    // at MIN_P). The thief's clock is the GTA clock (gta_at — the signed §7.5 pacing, no new farm
    // cadence); the victim loses at most one car per VICTIM_SHIELD_MS. CAR_THEFT_P is TEST-ONLY.
    BASE_P: 0.35, STAT_SCALE: 300, ALARM_DIV: 3000, MIN_P: 0.05, MAX_P: 0.7,
    ENERGY: 10, JAIL_S: 600, HEAT: 10, VICTIM_SHIELD_MS: 24 * 3600 * 1000,
  },
  RETENTION_D: 90,                   // the rivals ledger's memory (worker sweep)

  // ══ STEP TWO (design §4, founder-directed) — the rest of the asset-crime surface ══
  // TRUNK ROBBERY — mug the freight off a man's back: an OWNERSHIP MOVE of trade goods (goods are
  // not a §10.4 currency — the convoy-hijack transfer precedent), bounded by the robber's free
  // trunk space, the stealth contest, and the victim's own 24h shield. A miss is jail.
  TRUNK: { ENERGY: 8, HEAT: 5, JAIL_S: 300, SHIELD_MS: 24 * 3600 * 1000 },
  // BOAT THEFT at the docks — a docked boat's ROW moves (boats have no conservation check; the
  // resale faucet is the BALANCE flag). Shares the CAR_THEFT p-curve (boat cost as the alarm
  // value), the GTA clock, the CAR_THEFT_P test knob, AND the victim's VEHICLE shield
  // (car_stolen_at — one vehicle lost per day, car OR boat, however many thieves try).
  BOAT_THEFT: { ENERGY: 10, JAIL_S: 600, HEAT: 10 },
  // SABOTAGE — wreck a rival's stable: lays up ONE random fit racer/fighter (pacing, never
  // ownership — injured_until, the existing lay-up mechanic). Booked fighters are untouchable
  // (a main-event card's frozen form stays honest). A miss is jail; per-victim 12h shield.
  SABOTAGE: { ENERGY: 8, HEAT: 5, JAIL_S: 300, INJURY_MS: 4 * 3600 * 1000, SHIELD_MS: 12 * 3600 * 1000 },
  // REVENGE TEETH — striking a recorded rival you are still NET OWED against (their ledger count
  // vs yours) pays honor (the code respects a man who settles his own scores). Honor is a pure
  // status axis (zero §10.4); kills are deliberately excluded — the vendetta system owns those.
  REVENGE_HONOR: 2,
  // RIVAL-AWARE WIRE — tapping a man who wronged you costs less (the discounted number is what's
  // burned/ledgered, the tradecraft-discount discipline).
  WIRE_RIVAL_MULT: 0.5,

  // ══ STEP THREE (design §4, founder-directed 2026-07-30 — explicitly INCLUDING the transfer) ══
  // THE TAKE — victim-funded crime. A pulled job's cash no longer appears out of nowhere when there
  // is somebody in the district to take it FROM: the drawn mark funds what their pocket can cover and
  // the §7.2 faucet covers only the REMAINDER. The PAYOUT is unchanged (the sim-signed §7.2 band), so
  // this re-SOURCES crime, it does not retune it — and it strictly REDUCES emission, because the
  // funded share is a TRANSFER (ledgered both sides, netting zero) instead of a mint.
  //
  // Marks are NPC RESIDENTS only, and that line is deliberate: a real player gets no consent, no
  // notification and no counterplay from a stranger's crime roll. Taking from a PLAYER is what the
  // PvP asset crimes are for (rob a front, steal a car, mug the trunk) — gated, shielded, and written
  // into the rivals ledger so the victim knows who to answer.
  TAKE: {
    POCKET_BPS: 2500, // at most 25% of the mark's pocket per job — a rich mark funds more of the
                      // take, a poor one a little, and nobody is cleaned out in a single hit. The
                      // decay is geometric, so crime alone never walks a resident to the turnover
                      // threshold; total extraction stays bounded by the metered seed pool (P9.21).
    MIN: 50,          // below this the transfer is dust and the faucet just pays it
  },
  // REVENGE, WITH TEETH — striking a rival you are still NET OWED against now moves the CONTEST, not
  // only the honor ledger: your attack carries REVENGE_ATK_MULT, and a landed robbery takes
  // REVENGE_CUT_MULT of the usual cut (rob 15% → 22.5%, still under the shakedown's signed 30%, on
  // the SAME shared per-venue window — so the signed per-venue extraction bound is untouched).
  // Self-limiting by construction: landing the strike RECORDS it, which settles the debt.
  REVENGE_ATK_MULT: 1.10,
  REVENGE_CUT_MULT: 1.5,
};

// ═══════════ STREET LIFE (task #318, founder-directed) — the corner, the black book, the call ═══════════
// Three pieces: WORD ON THE STREET (per-district daily tasks paying cash + respect — the founder's
// "more tasks located in each area that send you on quests to gain xp and levels", some of which
// deliberately push you into CONFLICT/meeting other players), THE BLACK BOOK (phone numbers are
// DISCOVERABLE, never free — a meeting or intel earns the line), and THE CALL (contacts you've met
// ring you with requests). All numbers founder sign-off levers.
export const CORNER = {
  PER_DAY: 3,     // tasks each district posts per day (seed-drawn, town-wide per district)
  MAX_DAY: 5,     // total claims per street per day ACROSS districts — the hard faucet bound
  CASH: 400,      // per claim (petty — the POINTER is the product, the social-tasks posture)
  RESPECT: 15,    // per claim — the XP; meaningful early (level 5 = 160 respect), garnish later
  // per-district flavored pools — bumpDaily kinds ONLY (zero new counting surface, the drill rule);
  // every pool carries at least one CONFLICT kind and the draw GUARANTEES one lands each day
  POOLS: {
    docks:     ['goods', 'crime', 'jump', 'melt'],
    canal:     ['deal', 'cook', 'crime', 'jump'],
    brick:     ['crime', 'jump', 'bust', 'gta'],
    neon:      ['dice', 'crime', 'jump', 'goods'],
    foundry:   ['craft', 'gta', 'crime', 'melt'],
    cathedral: ['train', 'crime', 'goods', 'bust'],
  },
  CONFLICT: ['jump', 'bust'],   // the kinds that put you FACE TO FACE (a jump meets a player; a bust springs one)
  // THE CHAIN (step two) — the district's standing job. Work a corner on STEPS separate days and
  // the block pays a bonus on the last one. It rides the CLAIM (never its own counter), at most one
  // step a day, so a chain is three days of showing up in the same place — the thing a one-shot
  // daily board could not ask for. The bonus folds INTO the completing claim's ledger row (the
  // First-Week capstone precedent), so it never adds a claim and stays inside MAX_DAY: the ceiling
  // is MAX_DAY × (CASH + CHAIN_BONUS) a day, and reaching it needs STEPS days of work per district.
  CHAIN_STEPS: 3,
  CHAIN_BONUS: 1500,            // the block's thank-you — 3.75× a single envelope for 3 days of it
  CHAIN_RESPECT: 40,
  HOW: {
    crime: 'pull a job', jump: 'jump somebody — conflict pays, and you walk away with their number',
    bust: 'spring somebody from lockup', goods: 'move trade goods (buy or sell)',
    deal: 'move product on the corner', cook: 'run a batch on the burner', dice: 'roll in the back room',
    gta: 'boost a car', melt: 'melt one down', craft: 'work the bench', train: 'put in a session',
  },
};
// The district's word for the day — PER_DAY distinct kinds off the §7.11 hash (deterministic,
// town-wide: everyone standing there sees the same work), with one CONFLICT kind GUARANTEED (the
// founder's "certain tasks should push you into conflict or meet other players" — if the draw came
// up all-quiet, the last slot becomes a seeded conflict pick).
export const cornerTasksOf = (district, day = dayOf()) => {
  const pool = [...(CORNER.POOLS[district] || CORNER.POOLS.brick)];
  const picks = [];
  for (let i = 0; i < CORNER.PER_DAY && pool.length; i++)
    picks.push(pool.splice(Math.floor(hash01(`corner:${district}:${day}:${i}`) * pool.length) % pool.length, 1)[0]);
  if (!picks.some((k) => CORNER.CONFLICT.includes(k)))
    picks[picks.length - 1] = CORNER.CONFLICT[Math.floor(hash01(`corner:${district}:${day}:c`) * CORNER.CONFLICT.length) % CORNER.CONFLICT.length];
  return picks.map((kind, slot) => ({ slot, kind, how: CORNER.HOW[kind] || kind, conflict: CORNER.CONFLICT.includes(kind) }));
};
export const CONTACTS = {
  CALL_TTL_MS: 24 * 3600 * 1000,     // an unanswered request lapses in a day
  CALL_FREIGHT_PREMIUM_BPS: 11500,   // the contact pays base × 1.15 for delivery — THEIR OWN cash (recycle-only)
  CALL_FREIGHT_MAX_QTY: 8,
  VISIT_TIP: 750,                    // "come see me" — a tip from the contact's own pocket (recycle-only)
  GEN_PER_TICK: 4,                   // how many calls the worker tries to place per tick

  // ── STREET LIFE step two ────────────────────────────────────────────────────────────────────
  // THE BOOK — a status ladder on how many numbers you hold. Pure display: a rank moves nothing,
  // gates nothing, and is derived on read from COUNT(contacts), so there is no §10.4 surface and
  // nothing to farm beyond actually meeting people. (The hitman-rep / spymaster board posture.)
  RANKS: [
    { at: 0, title: 'Nobody Calls' }, { at: 5, title: 'A Few Numbers' },
    { at: 15, title: 'Well Connected' }, { at: 40, title: 'The Rolodex' },
    { at: 80, title: 'Everybody Knows You' }, { at: 150, title: 'The Switchboard' },
  ],
  // STANDING — the relationship with ONE contact, counted in jobs finished for them. A resident who
  // has watched you deliver six times asks for a bigger load and pays for it. The tier scales what
  // they ASK (qty) and what they TIP, never where the money comes from: generation still skips a
  // request the contact cannot cover, and fulfilment still re-clamps to their live pocket, so
  // recycle-only holds at every tier — a deep relationship moves more of the SAME bounded pool.
  STANDING_TIERS: [
    { at: 0, name: 'a stranger', qtyMult: 1.0, tipMult: 1.0 },
    { at: 3, name: 'a regular', qtyMult: 1.5, tipMult: 1.4 },
    { at: 8, name: 'a friend', qtyMult: 2.0, tipMult: 1.8 },
    { at: 20, name: 'family', qtyMult: 3.0, tipMult: 2.5 },
  ],
};
// how many numbers you hold → the badge (derived on read, never stored)
export const contactRankOf = (n) => {
  let r = CONTACTS.RANKS[0];
  for (const x of CONTACTS.RANKS) if (Number(n) >= x.at) r = x;
  return r.title;
};
export const contactNextRank = (n) => CONTACTS.RANKS.find((x) => x.at > Number(n)) || null;
// jobs finished for ONE contact → how they treat you
export const contactStandingOf = (jobs) => {
  let t = CONTACTS.STANDING_TIERS[0];
  for (const x of CONTACTS.STANDING_TIERS) if (Number(jobs || 0) >= x.at) t = x;
  return t;
};

// THE FAVOR (STREET LIFE step two) — the PLAYER-posted call. The NPC version pays out of a live
// pocket; a player's pay is ESCROWED at post, so a runner who hauls freight across town can never
// arrive to find the money spent. That makes it the same shape as every other P2P rail here: an
// escrow with its own §10.4 check, and a house TAKE carved from the pay (never minted on top), so
// paying your own alt is strictly lossy. All numbers founder sign-off levers.
export const FAVOR = {
  MAX_OPEN: 3,             // open requests per poster — bounds the escrow a single player can park
  MIN_PAY: 500,
  MAX_PAY: 250000,         // a favor is an errand, not a wire transfer (the untaxed-rail bound)
  MAX_QTY: 20,             // units of one good per request
  TTL_MS: 24 * 3600 * 1000,
  TAKE_BPS: 200,           // 2% off the pay — half to the street tax, half burns (the market:take shape)
  NOTE_MAX: 90,
};

// ═══ THE CREW (omerta-crew-design.md) ═══
// The lightweight 2-4 player mutual-aid pact — the social scale between solo and a 20-person family.
// Status + coordination only (chat, a board, breakable non-aggression): NO treasury/turf/escrow, so
// ZERO §10.4 surface. Account-keyed → survives death. All numbers pure pacing/scope (no faucet).
export const CREW = {
  MAX_MEMBERS: 4,          // the cap — deliberately tiny vs a family's 20; a crew, not an outfit
  MIN_LEVEL: 3,            // low bar: this IS the early-game social on-ramp
  NAME_MAX: 24,            // the createGang name bound, so a crew reads like a family
  INVITE_TTL_MS: 72 * 3600 * 1000,   // a pending invite the worker sweeps if never answered
  // ── THE WEEKLY OBJECTIVE — the shared goal the crew cracks together (the synchronous "log in
  // because your crew is active" hook). A kind is drawn per crew per week off the §7.11 seed; the
  // target scales with crew size (base × members at materialize); a completed objective pays each
  // contributing member REWARD cash once. Founder sign-off levers (a bounded social cash faucet). ──
  OBJECTIVE: {
    REWARD: 5000,          // cash per member on claiming a completed objective (v24: social rewards are cash)
    KINDS: [
      { id: 'crimes', label: 'Pull jobs together', base: 40, unit: 'jobs' },   // combined crimes pulled
      { id: 'kills',  label: 'Put bodies in the ground', base: 3, unit: 'kills' }, // combined player kills
      { id: 'earn',   label: 'Bring in the score', base: 200000, unit: '$' },   // combined dirty cash from crimes
    ],
  },
  // ── BRING ONE (the first-crewmate incentive; founder-directed retention/funnel drop) ───────────
  // The friction the ROLODEX/discovery layer can't fix alone: founding a crew and getting a REAL
  // friend to actually PLAY has no concrete payoff — the crew is all status/coordination. So a
  // referral who QUALIFIES (the audited §7.13 anti-Sybil wall — L8/40 jobs/3 check-ins/$25k, once
  // ever, agent-excluded) AND runs in their recruiter's crew earns BOTH a bonus, paid inside the
  // same qualify transaction. It is a bounded cash FAUCET that inherits every anti-Sybil property of
  // the qualification wall (an alt farm can't earn it any faster than a real recruit who levelled to
  // 8, pulled 40 jobs and banked $25k), on top of the crew co-membership check — so it rewards the
  // recruiter who both brought a friend AND ran with them. v24: social rewards are cash, never $OMR.
  BRING_ONE: { RECRUITER_CASH: 15000, RECRUIT_CASH: 7500 },
};
// the deterministic weekly draw — same crew + week → the same objective, town-wide verifiable (the
// corner/hustle §7.11 pattern). Kind off the seed; target = kind.base × crew size (min 1). `weekOf`
// is defined earlier in this file (and imported by game.js); we reuse it here.
export function crewObjectiveOf(crewId, week, members = 1) {
  const kinds = CREW.OBJECTIVE.KINDS;
  const k = kinds[Math.floor(hash01('crewobj:' + crewId + ':' + week + ':' + (process.env.MARKET_SEED || '')) * kinds.length) % kinds.length];
  return { kind: k.id, label: k.label, unit: k.unit, base: k.base, target: k.base * Math.max(1, members) };
}

// ═══ THE AHA MOMENT — "First Blood" ═══ (the guaranteed early conflict; onboards the PvP/revenge loop)
// A new player is handed their first rival soon after finding their feet (MIN_LVL), delivered as a
// cinematic; settling it (a JUMP) pays a bounded ONCE-EVER bonus. The reward is gated by aha_stage, so
// it can never pay twice on a street — a petty, bounded cash faucet (`firstblood:reward`, BALANCE.md).
export const AHA = { MIN_LVL: 3, REWARD_CASH: 2500, REWARD_RESPECT: 40 };

// ═══ IDENTITY ═══ (thin character customization — a free "about me" blurb; the MySpace-page element)
// The expression hook the profile lacked: a player-chosen bio shown on their public page (the funnel)
// and My Profile. Deliberately FREE and text-only — distinct from the paid vanity TITLE ($OMR sink) and
// the honor-derived epithet, so it competes with no sink. Status, ZERO §10.4. Dies with the street.
export const IDENTITY = { BIO_MAX: 200 };

// ═══ THE SEASON RECAP ═══ (the individual "your season" wrap — pure status, no faucet)
// A keepsake title by the level a street reached that season, written at rollover into season_recaps
// (account-level → survives death). The bands are cosmetic (a status axis, the hitman-rep argument),
// not a signed economy lever — but pinned like everything named in a ladder.
export const SEASON_RECAP = {
  TITLES: [[0, 'Nobody'], [8, 'An Earner'], [16, 'A Made Man'], [28, 'A Capo'], [42, 'A Boss'], [60, 'A Legend']],
};
export const recapTitleOf = (level) => {
  let t = SEASON_RECAP.TITLES[0][1];
  for (const [min, name] of SEASON_RECAP.TITLES) if (level >= min) t = name;
  return t;
};

// ═══ THE ROLODEX ═══ (player discovery — the front door the social layer lacked; §10.4-free)
// A new/mid player has no way to FIND peers to crew with: invites are by exact name, the streets
// roster is the top-100 whales, contacts are earned. This surfaces humans near your level + a
// "looking for a crew" flag so THE CREW is reachable by strangers. Pure pacing/scope — no faucet.
export const DISCOVERY = {
  BAND: 10,                          // ± levels: a fresh player sees PEERS, not the whales the streets roster shows
  LIMIT: 24,                         // rows per list
  LFG_TTL_MS: 7 * 24 * 3600 * 1000,  // a "looking for a crew" flag older than a week is stale — dropped from the recruit list
};

// ═══ THE MENTOR (omerta-first-contact-and-events-design.md, MOVE 1) ═══
// The positive first interaction: a veteran takes a newcomer under their wing. The mentor's reward is
// STATUS ONLY (proteges_raised — Sybil-proof, no payout attaches); the protégé gets a bounded onboarding
// cash faucet at level milestones. All numbers are founder sign-off levers; MILESTONES is the one faucet
// to sim (bounded by real leveling × once-ever-per-account).
export const MENTOR = {
  MIN_LVL: 20,            // a mentor must have made their bones
  PROTEGE_MAX_LVL: 10,    // you can only be taken under a wing while you're still new
  ACTIVE_MAX: 3,          // a mentor's active-protégé cap (a Sybil raising 50 alts is bounded; status-only anyway)
  OFFER_TTL_MS: 3 * 24 * 3600 * 1000,  // an unanswered offer lapses (the crew-invite TTL)
  SEEKING_TTL_MS: 7 * 24 * 3600 * 1000, // a stale "seeking a mentor" flag drops off the board
  // level milestone → protégé onboarding cash (once-ever per milestone, level-real). ~$20k lifetime — petty,
  // the onboarding/career faucet scale; bounded by new accounts that reach lvl 20 WITH a mentor. The last
  // milestone is GRADUATION: the protégé claims at level 20 and that bumps the mentor's legend +1 (a claim,
  // so the transition is transactional). Days of real play per unit → an alt farm is deeply unprofitable.
  MILESTONES: [{ lvl: 5, cash: 2000 }, { lvl: 10, cash: 4000 }, { lvl: 15, cash: 6000 }, { lvl: 20, cash: 8000, graduate: true }],
  // step two — THE CARE PACKAGE: the mentor sends a protégé a bounded cash gift from their OWN pocket (a
  // ledgered TRANSFER `mentor:gift`, §10.4-neutral — the had-my-back ACTION). Once per protégé per CD; the
  // cap + one-mentor-ever + ≤ACTIVE_MAX protégés make it petty ($15k/day max), not a laundering rail.
  GIFT_CASH: 5000,
  GIFT_CD_MS: 24 * 3600 * 1000,
  RANKS: [ // by proteges_raised — pure status, survives death (the hitman-rep board twin)
    { at: 0, name: 'Unproven' }, { at: 1, name: 'A Made Teacher' }, { at: 3, name: 'The Counselor' },
    { at: 7, name: 'The Godfather' }, { at: 15, name: 'The Old Don' },
  ],
};
export const mentorRankOf = (n) => MENTOR.RANKS.reduce((a, r) => (Number(n) >= r.at ? r : a), MENTOR.RANKS[0]);

// ═══ THE STREAK (the daily-login habit loop) ═══
// The game had rich CATCH-UP (the Morning Paper) and rich ANTICIPATION (the events strip), but no reason
// to come back TOMORROW specifically — no habit cadence. THE STREAK is the missing carrot: a once-a-day
// login claim whose CASH escalates with the consecutive-day run (capped at MAX_DAY's value), a gap RESETS
// the run to 1, and the lifetime high-water (`streak_best`) is a status legend that survives death.
// §10.4: ONE cash faucet `streak:daily`, character_id'd, bounded HARD (once/day × capped reward). The
// run COUNT keeps climbing past MAX_DAY (a satisfying "23 days" number) but the reward flattens, so the
// faucet ceiling is REWARDS[last]/day for a perfect attender — petty vs the passive stack. All levers.
export const STREAK = {
  // consecutive-day reward curve: day 1 → $500 … day 7+ → $4,000 (flat past MAX_DAY). Escalating so the
  // habit compounds; capped so a perfect run is ~$4k/day (onboarding-faucet scale, sign-off).
  REWARDS: [500, 800, 1200, 1700, 2300, 3000, 4000],
  MAX_DAY: 7,   // the reward caps at REWARDS[MAX_DAY-1]; the streak COUNT still climbs (for the legend)
  RANKS: [ // by streak_best (lifetime longest run) — pure status, survives death
    { at: 0, name: 'Drifter' }, { at: 3, name: 'A Regular' }, { at: 7, name: 'A Face' },
    { at: 14, name: 'A Fixture' }, { at: 30, name: 'The Neighborhood' }, { at: 90, name: 'A Made Institution' },
  ],
  // MILESTONES — the run-unlock ladder (so the streak itself is worth PROTECTING, not just the petty
  // daily cash). Keyed off `best` (lifetime longest run, monotonic — never a re-grant on a rebuilt run);
  // each crossing grants a one-time TITLE (the flex) + a bounded cash BONUS. Total lifetime = Σ bonus
  // (560k over a 100-day run), a finite ladder → a bounded §10.4 faucet (`streak:milestone`).
  MILESTONES: [
    { day: 7,   title: 'The Regular',      bonus: 10000 },
    { day: 14,  title: 'The Fixture',      bonus: 25000 },
    { day: 30,  title: 'The Neighborhood', bonus: 75000 },
    { day: 60,  title: 'The Institution',  bonus: 150000 },
    { day: 100, title: 'The Immortal',     bonus: 300000 },
  ],
};
// reward for landing on day N of a run (1-based); flat at REWARDS[MAX_DAY-1] past the cap
export const streakReward = (day) => STREAK.REWARDS[Math.min(Math.max(1, day), STREAK.MAX_DAY) - 1];
export const streakRankOf = (n) => STREAK.RANKS.reduce((a, r) => (Number(n) >= r.at ? r : a), STREAK.RANKS[0]);
// milestones newly crossed by a run `best` beyond the highest-`awarded` day (once-ever, monotonic)
export const streakMilestonesNew = (best, awarded) =>
  STREAK.MILESTONES.filter((m) => m.day <= Number(best) && m.day > Number(awarded || 0));

// ═══ THE VOUCH — the symmetric peer bond ═══
// Pure status (no payout, §10.4-free). MAX_OUT is the whole balance: a vouch is scarce, so it means
// something. Raising it makes vouches cheaper (more noise); lowering it makes them a rarer endorsement.
export const VOUCH = { MAX_OUT: 12 };
export const VOUCH_RANKS = [ // by inbound vouch count — the "trusted" status axis
  { at: 0, name: 'Unknown' }, { at: 1, name: 'Vouched For' }, { at: 5, name: 'Well Regarded' },
  { at: 15, name: 'Respected' }, { at: 40, name: 'A Name You Trust' }, { at: 100, name: 'The Word on the Street' },
];
export const vouchRankOf = (n) => VOUCH_RANKS.reduce((a, r) => (Number(n) >= r.at ? r : a), VOUCH_RANKS[0]);

// ═══ THE RARITY NFTs (economy v3 step 7) ═══
// Design §7 + §9.7. Cars and boats carry a rarity, and an owned one can be EXTRACTED on-chain as a
// tradeable ERC-1155 through the EXISTING GearVault rail. Two rules from the design are load-bearing
// and both are enforced here rather than remembered:
//
//   1. SELL DETERMINISTIC, DROP RANDOM. Rarity is rolled server-side and rng_audit'd when an item is
//      EARNED IN PLAY — a boosted car, a bought boat, a resident's ride you steal. **No ETH path
//      anywhere in this game grants or re-rolls a rarity**, because selling random traits for real
//      money is a loot box and is genuinely contested in the EU/UK. The `rarity:upgrade` sink below
//      is the reason that line survives contact with the OMR bridge: it is a KNOWN outcome for a
//      KNOWN price (pay, get exactly the next tier), never a roll. Do not make it random "for
//      excitement" — that one change converts a cosmetic into a gambling product.
//   2. IN-GAME ITEMS ARE LOOTABLE; EXTRACTED NFTs ARE SAFE BUT INERT. Extraction takes the item OUT
//      OF PLAY: it stops racing, melting, fencing, hauling and being stolen, and in exchange it stops
//      dying with the street. That is the existing gear precedent applied to property, and it is what
//      preserves EVE's destruction engine while still giving a real NFT market — the choice is the
//      product, so neither half may be softened (a safe item that still earns is a strictly-dominant
//      option and the tradeoff disappears).
//
// RARITY IS PURE STATUS. It touches no power curve — not `carPower`, not `carVal`, not a boat's hold
// or speed — because the races/port curves are sim-signed and a rarity multiplier on them would be an
// unsigned balance change wearing a cosmetic's clothes. What it buys is scarcity, which is the whole
// basis of a collectible market.
export const RARITY = {
  // Weights are a draw, not a ladder — `w` is relative, so the four need not sum to anything.
  // The design names four tiers in this order (epic above legendary), and that ordering IS the
  // upgrade path, so the array order is authoritative.
  TIERS: [
    { id: 'common',    name: 'Common',    w: 700 },
    { id: 'rare',      name: 'Rare',      w: 220 },
    { id: 'legendary', name: 'Legendary', w: 65 },
    { id: 'epic',      name: 'Epic',      w: 15 },
  ],
  // $OMR to buy the NEXT tier, indexed by the tier you are buying INTO (so [0] is unused — nothing
  // upgrades into common). Deterministic: this price, that tier, no roll. A §10.4 SINK that recycles
  // to the desk like every other, which is the design's "bridge between the two markets" — ETH-priced
  // NFT demand pulls on OMR without the game ever selling a random outcome for money.
  UPGRADE_OMR: [0, 150, 540, 1800],
  // On-chain tokenId spaces. GearVault's id is just a uint256 with a per-id lifetime cap, so cars and
  // boats need no contract change at all — only disjoint ranges and a Safe-set cap per id at deploy.
  // tokenId = BASE + catalogIndex * STRIDE + rarityIndex. Gear keeps 1..N (its 1-based catalog index),
  // so the three spaces cannot collide. STRIDE 10 leaves headroom for a fifth tier without a re-map.
  TOKEN: { CAR_BASE: 100000, BOAT_BASE: 200000, STRIDE: 10 },
  // ── D5=B (founder, 2026-08-02) — THE LIFETIME SUPPLY CAP, PER TOKEN ID ────────────────────────
  // GearVault caps every id for life and FAILS CLOSED at 0 (an uncapped class simply cannot mint),
  // so this table is what actually bounds scarcity — the draw weights only decide how OFTEN a
  // rarity is earned, never how many can exist. Scaled by rarity, which is the point: a cap that
  // is generous everywhere makes the tiers cosmetic on a secondary market.
  //
  // This is DEPLOY CONFIG, not runtime logic — nothing in the backend reads it to gate a mint (the
  // contract does that). It lives here so the deploy table is generated from one source rather
  // than hand-typed 264 times, and so a new car or boat cannot ship without a cap decision.
  // `tools/gearcaps.js` prints the table; CHAIN-DEPLOY.md §0.6 is the runbook step.
  SUPPLY_CAP: { common: 1000, rare: 300, legendary: 60, epic: 10 },
};
export const rarityIdx = (id) => Math.max(0, RARITY.TIERS.findIndex((t) => t.id === id));
export const rarityOf = (id) => RARITY.TIERS[rarityIdx(id)];
// Roll a rarity from a [0,1) roll. Passed the roll (never rolling itself) so every caller can
// rng_audit the exact number — server-authoritative and replayable, the §7.11/den discipline.
export const rollRarity = (roll) => {
  const total = RARITY.TIERS.reduce((a, t) => a + t.w, 0);
  let x = Math.max(0, Math.min(0.999999, Number(roll))) * total;
  for (const t of RARITY.TIERS) { x -= t.w; if (x < 0) return t.id; }
  return RARITY.TIERS[0].id;
};
// The on-chain tokenId for an extractable item. Throws on an unknown catalog id rather than
// returning a plausible number — a wrong id here mints the wrong NFT, and the fail-closed rule that
// governs every other chain surface applies with more force to something a player then sells.
export const nftTokenId = (kind, catalogId, rarity) => {
  const { CAR_BASE, BOAT_BASE, STRIDE } = RARITY.TOKEN;
  const idx = kind === 'car' ? CARS.findIndex((c) => c.id === catalogId)
    : kind === 'boat' ? PORT.BOATS.findIndex((b) => b.id === catalogId) : -1;
  if (idx < 0) throw new Error(`nftTokenId: no such ${kind} class ${catalogId}`);
  return (kind === 'car' ? CAR_BASE : BOAT_BASE) + idx * STRIDE + rarityIdx(rarity);
};
// The inverse of nftTokenId — a burned tokenId → { kind, catalogId, rarity } — used by the re-import
// watcher (omerta-nft-reimport-design.md) to turn a `Redeemed` event back into the exact catalog class
// and rarity to re-create in-game. CAR/BOAT ONLY: gear (below CAR_BASE) is not re-importable (its
// in-game form is account-level set membership, the same reason character_assets are deferred; the
// contract's redeem() rejects it), so a gear/out-of-range token throws — fail-closed, matching
// nftTokenId. Never trusts the id blindly: an index past the catalog throws rather than pointing at a
// plausible-but-wrong class, because this re-creates a real asset a player then owns.
export const nftDecode = (tokenId) => {
  const id = Number(tokenId);
  const { CAR_BASE, BOAT_BASE, STRIDE } = RARITY.TOKEN;
  if (!Number.isInteger(id) || id < CAR_BASE) throw new Error(`nftDecode: token ${tokenId} is not a re-importable car/boat`);
  const isBoat = id >= BOAT_BASE;
  const base = isBoat ? BOAT_BASE : CAR_BASE;
  const idx = Math.floor((id - base) / STRIDE);
  const rIdx = (id - base) % STRIDE;
  const cat = isBoat ? PORT.BOATS[idx] : CARS[idx];
  const tier = RARITY.TIERS[rIdx];
  if (!cat || !tier) throw new Error(`nftDecode: no ${isBoat ? 'boat' : 'car'}/rarity for token ${id}`);
  return { kind: isBoat ? 'boat' : 'car', catalogId: cat.id, rarity: tier.id };
};

// ── THE CAPO'S LICENSE — agent recruiting perks (capability, never cash) ──────────────────────────
// Agents are excluded from every referral CASH faucet by design (the anti-Sybil wall — an agent can
// manufacture accounts, so cash rewards would be farmed). The License rewards recruiting through the
// three signals a Sybil ring CANNOT fake cheaply: the recruit is MINTED (paid the 0.01-ETH identity
// fee — real money per head), RETAINED (telemetry inside RETAIN_DAYS — still actually playing), and
// LEVELLED (≥ MIN_LVL — genuinely played, not a parked signup). What it grants is worth something
// only to an agent and worthless to an alt farm: a faster action cadence (the §10.2 agent throttle
// eases from the hard 1/3s) and extra standing-wiretap slots. ZERO §10.4 surface — no currency
// moves; the perks are pacing/access. The count is computed by the worker (sweepCapoLicense) onto
// account_persistent.capo_recruits, read per-request from the SAME account row the throttle already
// loads (no extra round-trip). All numbers are founder sign-off levers.
export const CAPO = {
  RETAIN_DAYS: 14,     // a recruit counts only while they've played inside this window
  MIN_LVL: 8,          // ...and their street has genuinely levelled (the REF_GATES.level twin)
  TIERS: [             // sequential by qualifying recruits; rate = actions/second for the agent bucket
    { n: 1, name: 'Street Captain', rate: 1 / 2.5, tapBonus: 0 },
    { n: 3, name: 'Capo',           rate: 1 / 2,   tapBonus: 1 },
    { n: 5, name: 'The Underboss',  rate: 1 / 1.5, tapBonus: 2 },
  ],
};
// The perk reader — null rate means "no license, use the base agent cadence". Monotone by
// construction (TIERS is ascending), so more real recruits never reads as fewer perks.
export function capoPerksOf(count) {
  let out = { tier: null, rate: null, tapBonus: 0 };
  for (const t of CAPO.TIERS) if (Number(count || 0) >= t.n) out = { tier: t.name, rate: t.rate, tapBonus: t.tapBonus };
  return out;
}

// ── THE TICKER BALLOT — the Commission's daily stock vote (the Stock Machine, Phase A) ────────────
// (founder-directed 2026-08-09: "Begin The Ticker Ballot"; design omerta-rwa-stock-machine-design.md
// §3.) The seated families vote DAILY on WHICH stock token the treasury's RWA slice buys — a
// treasury operation turned into a server-wide political event. CHAIN-DORMANT: no keeper buys yet;
// the ballot runs, resolves and publishes NOW (the daily beat), and the buy keeper (Phase B) will
// consume ticker_ballot_results when it ships. Manipulation-safe by construction: the vote chooses
// WHICH ticker only — never whether, how much, or to whom (the budget is the accrued slice, the
// destination is the vault, both outside the ballot). Deadlock or silence resolves to DEFAULT (the
// broad-market ETF) so a quiet chamber never stalls the daily beat. TICKERS are REAL Robinhood
// Chain stock-token symbols (the treasury would buy the actual tokens); the catalog + DEFAULT are
// founder sign-off levers. Zero §10.4 surface — a vote moves nothing.
export const TICKER_BALLOT = {
  TICKERS: ['SPY', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'],  // the supported buy list (small + liquid to start)
  DEFAULT: 'SPY',                                             // deadlock/silence buys the broad market
};

// ═══ THE TRANCHE SCHEDULE (dynasty-machine §10 Shape D — ADOPTED, founder-directed 2026-08-10:
// "first 1000 mints are .01 ETH or x OMR … next 2000 are .02 ETH and 2x OMR"; REVISED the same day
// to FIVE WAVES WITH A HARD CEILING — "cap it at 5 waves so by wave 5 the maximum mint price anyone
// can pay would be .05"). The identity mint's published price table, indexed to CUMULATIVE minted
// identities.
//
// WHY THE CEILING IS THE IMPROVEMENT, not a softening. The open LINEAR ladder it replaces was
// defensible but had two costs the cap removes outright:
//   - THE FREE-PATH LAW BECOMES STRUCTURAL. On the old ladder the dearest row was an open-ended
//     number and the law held by arithmetic that had to be re-checked at every extension. Here the
//     dearest row sits under the lifetime mission payout and no future row can ever exceed it, so
//     "you can get made for free" is now guaranteed by the SHAPE rather than re-derived per table.
//   - THE GROWTH HEADWIND GOES. The waves widen (1k → 100k) while the increments SHRINK
//     (+0.015, +0.010, +0.010, +0.006), so the curve flattens exactly where a game gets crowded.
//     Past the first thousand it is cheaper than the ladder it replaces at every point — #5,000
//     pays 0.025 where the old table charged 0.03, #20,000 pays 0.035 against 0.06.
// The ceiling is what makes it a founding-era discount rather than an escalator: the most anyone
// ever pays for an identity is 0.05 ETH, and that is true on the day the table is published.
//
// The RULES, each load-bearing:
//   - ONE implied rate per row, every row (omr/eth == 3,000 — the preflight two-rails guard's own
//     number): the effective price is the CHEAPER rail, so a row that broke rank would silently
//     become the real price. Pinned by test.
//   - THE FLAT TAIL: past the last row the LAST price HOLDS until the founder publishes an
//     extension — the schedule is a finite commitment, never an open-ended escalator.
//   - THE FREE-PATH LAW: no row's omr may reach the mission ladder's lifetime $OMR payout (the
//     "get made for free" promise, test-pinned in test/made.js against the LIVE MISSIONS table —
//     dearest row 150 vs ~220 earnable, and with the ceiling it can never rise again).
//   - EXECUTION is the existing machinery, BY HAND at each boundary: one Safe `setFees` tx +
//     MINT_FEE_ETH/PLEX_MINT_OMR env — plexQuote already scales the $OMR rail off MINT_FEE_ETH, so
//     no code runs a boundary. The admin chain panel shows tier progress + flags a live pair that
//     is OFF this schedule; preflight warns on an off-schedule pair at boot.
// Adoption re-opened a launch-checklist row (a published forward schedule on a tradeable asset).
// Copy rules ride with it: founding-era frame only, never a countdown/"N remaining" counter, the
// banned lexicon verbatim.
// The founder's waves are 1k / 10k / 25k / 50k / 100k at .01 / .025 / .0333 / .0444 / .05 ETH.
// Waves 3 and 4 are rounded to .035 / .045 (+5.1% / +1.4%) so both waves land on tidy numbers.
//
// THE SCHEDULE IS ETH, AND ONLY ETH (founder-directed 2026-08-10: "Make the mint ETH only no OMR").
// There is no $OMR column because there is no $OMR rail: minting gates extraction, so it is the one
// price that must never be ambiguous, and a fee with two rails is always priced by the cheaper one.
// One rail, in real money, at the published wave — nothing to keep in lockstep and nothing to
// diverge. The free path is untouched: the mission grants a mint credit outright.
export const MINT_TRANCHES = [
  { through: 1000,   eth: 0.01  },  // wave 1 — the first thousand
  { through: 11000,  eth: 0.025 },  // wave 2 — next 10,000
  { through: 36000,  eth: 0.035 },  // wave 3 — next 25,000
  { through: 86000,  eth: 0.045 },  // wave 4 — next 50,000
  { through: 186000, eth: 0.05   },  // wave 5 — next 100,000, and the CEILING: the flat tail holds
                                     // here, so 0.05 ETH is the most anyone ever pays
];
// The current tier for a cumulative minted-identity count. Past the table: the flat tail (the last
// row holds, `flat: true` so a surface can say "the published schedule is fully minted").
export const mintTierOf = (minted) => {
  const i = MINT_TRANCHES.findIndex((t) => Number(minted) < t.through);
  const last = MINT_TRANCHES.length - 1;
  return i === -1
    ? { tier: MINT_TRANCHES.length, ...MINT_TRANCHES[last], flat: true }
    : { tier: i + 1, ...MINT_TRANCHES[i], flat: false };
};

// ── THE CITY LEG'S ACTIVITY METRIC (THE BANK, `omerta-bank-protocol-design.md` §4.2) ────────────
// Protocol profit buys $OMR on the open market and hands it to "the players who play"
// (founder-directed 2026-08-10). This block is the definition of that phrase, and every rule in it
// exists because of something this project already measured or verified.
//
// THE WEIGHT IS LINEAR AND UNCAPPED, and that is the correction to a measured bug rather than a
// preference. `BALANCE.md` § THE FARM, on the Street Wage: "`WAGE_CAP_OMR` is commented
// 'anti-concentration / anti-Sybil', but concentration is the OPPOSITE of Sybil. It clips the
// honest whale and hands the remainder to whoever runs more accounts — the only way around a
// per-individual cap is to be several individuals." Stated as the general law:
//     concave score (a per-account cap, or log-share)  →  splitting effort across N accounts GAINS
//     linear score                                     →  splitting gains nothing   ← what we want
//     convex score                                     →  splitting loses, but whales concentrate
// So: linear, uncapped. "Plays more, receives more" is the founder's intent, not a leak.
//
// A GATE IS NOT A CAP, and the difference is the whole trick. MIN_TRACKS is an ELIGIBILITY gate, so
// it imposes a FIXED COST PER ACCOUNT without ever clipping an honest player's payout. A farm with N
// accounts pays that cost N times while its reward stays linear — Sybil-NEGATIVE. A per-account cap
// does the exact opposite. Both "limit" something; they point in opposite directions.
//
// TAGS IS FAIL-CLOSED, AND IT IS THE SEVERANCE WALL. Tokenomics v2 severed cash from $OMR ("cash
// cannot become $OMR at any price"). Raw mastery XP would reopen it: verified in `src/casino.js`,
// the Madame's T1 perk COMPS THE NERVE on both dice (:116) and blackjack (:844), and `sellGood`
// carries no nerve/energy/cooldown check at all — so for anyone with Madame standing, den and
// commerce XP are bounded only by cash and HTTP round trips. Cash would buy a larger share of the
// bought-$OMR pool. (The pool is fixed, so nothing is CREATED and the landing page's claim stays
// true — but the wall's own language is "at any price", and it should stay crisp.)
//   THE RULE: an action scores only if the GAME throttles it — nerve, energy, a cooldown, or a hard
//   per-day cap. Nobody can buy wall-clock. A tag absent from this list scores ZERO, so a new action
//   added later contributes nothing until somebody deliberately adds it (the DESK.SINK_REASONS
//   discipline: one explicit list, and the default is "no").
export const ACTIVITY = {
  // The epoch — the day, matching the ballot's clock and the activation model's.
  EPOCH: 'day',
  // Game-throttled action tags (the keys of MASTERY.XP). Scored at that tag's own XP value, so the
  // relative weighting is the one already sized against each action's resource cost.
  TAGS: [
    'crime',                                  // nerve
    'jump', 'shakedown', 'standover',         // energy
    'fire', 'shank', 'duel',                  // nerve/ammo/cooldown, and rare by construction
    'cook', 'deal',                           // a batch clock; deal costs nerve
    'boost', 'race',                          // energy + the gta_at window; races on a 2h cooldown
    'port', 'piracy',                         // a run clock + the daily supply cap; energy + ammo
    'score', 'heist',                         // 8h / daily cooldowns
    'bout', 'exhibition',                     // a willing rival; a 6h cooldown
    'cards', 'yardtale',                      // pen: energy; once a day
    'primetime',                              // capped at HAPPY_ROUNDS a night
    'numbers', 'trackbet',                    // the den's THROTTLED draws: one ticket/day, one bet/race/day
  ],
  // DELIBERATELY ABSENT, each with its reason — this list is the audit trail for the wall above:
  //   dice, blackjack — the Madame comps their nerve, so they carry NO game throttle (verified).
  //   sell, fill      — no per-action throttle; a cash-funded arbitrage loop. Reviewable the day
  //                     commerce grows a real throttle, and not before.
  // THE BREADTH GATE (Sybil-NEGATIVE, per the note above): score in at least this many distinct
  // trades in the epoch to qualify at all. Raises a farm's per-account cost; costs an engaged
  // player nothing.
  MIN_TRACKS: 3,
  // Which trade each throttled tag belongs to — the breadth gate counts DISTINCT values here.
  // `yardtale` is deliberately absent: it schools the teller's OWN track, which is variable, so it
  // scores but cannot be a static member of any one trade (counting it under a fixed track would be
  // a lie the gate then rewards).
  TRACK_OF: {
    crime: 'larceny',
    jump: 'muscle', shakedown: 'muscle', standover: 'muscle',
    fire: 'wetwork', shank: 'wetwork', duel: 'wetwork',
    cook: 'chemistry', deal: 'chemistry',
    boost: 'wheels', race: 'wheels',
    port: 'seamanship', piracy: 'seamanship',
    score: 'scores', heist: 'scores',
    bout: 'fists', exhibition: 'fists',
    cards: 'gambling', primetime: 'gambling', numbers: 'gambling', trackbet: 'gambling',
  },
  // A floor purely to refuse dust rows (the ACTIVATION.MIN_OMR shape). NOT a cap and never a cap.
  MIN_SCORE: 25,
  // Excluded from the distribution entirely — the standing exclusion on every legend surface.
  EXCLUDE_AGENTS: true,
  EXCLUDE_NPC: true,
};
// A player's epoch score: Σ over their throttled actions of that tag's XP. Linear by construction.
export const activityScore = (gains = {}) => ACTIVITY.TAGS
  .reduce((n, t) => n + (Number(gains[t]) || 0) * (Number(MASTERY.XP[t]) || 0), 0);
// How many distinct trades those actions touched (the MIN_TRACKS gate reads this).
export const activityTracks = (gains = {}) => new Set(ACTIVITY.TAGS
  .filter((t) => (Number(gains[t]) || 0) > 0)
  .map((t) => ACTIVITY.TRACK_OF[t]).filter(Boolean)).size;
// Does this account qualify for the epoch's distribution at all? Breadth gate + the dust floor.
// NOTE there is no cap here and there must never be one — see the block header.
export const activityQualifies = (gains = {}) =>
  activityTracks(gains) >= ACTIVITY.MIN_TRACKS && activityScore(gains) >= ACTIVITY.MIN_SCORE;

// ── THE BROKERS — treasury-funded RWA rewards to NFT holders ──────────────────────────────────────
// Design: `omerta-brokers-design.md`. Founder-directed 2026-08-10, funded from the TREASURY slice
// (which carries no promise to anyone) so the withdrawal reserve is untouched.
//
// THE WEIGHT IS THE WHOLE DESIGN:
//
//     weight = activationMult(tier) x activityScore(actions in the epoch)
//
// The first term is Stonkbrokers' (a token burn buys you a bigger share). The second is the one they
// do not have, and it is why this is a game mechanic rather than a yield product: their weight is a
// pure function of tokens burned, so the largest holder is BY CONSTRUCTION the largest earner —
// capital, not participation. Multiplying by ACTIVITY makes a zero on EITHER term a zero, so an
// activated NFT owned by somebody who did not play earns nothing. Do not soften that later.
//
// ACTIVATION LAPSES ON PURPOSE. A permanent one-time burn is what the economy already has too much
// of — every prior sink was one-time, which is exactly why supply pooled into staking (the standing
// audit finding). A window that must be renewed is a RECURRING sink, and it also makes "you must
// commit to be paid" true continuously rather than once.
export const BROKERS = {
  TIERS: [
    { id: 1, name: 'Runner',       omr: 150,   mult: 1.0 },
    { id: 2, name: 'Broker',       omr: 450,   mult: 1.5 },
    { id: 3, name: 'Floor Trader', omr: 1200,  mult: 2.0 },
    { id: 4, name: 'Specialist',   omr: 3000,  mult: 2.5 },
    { id: 5, name: 'The Chairman', omr: 9000, mult: 3.0 },
  ],
  ACTIVATION_MS: 30 * 24 * 3600 * 1000,  // a window, not a purchase — see above
  EPOCH_DAYS: 7,                          // the allocator's window
  MIN_WEIGHT: 1,                          // dust floor: a weight under this is not worth a row
};

export const brokerTier = (id) => BROKERS.TIERS.find((t) => t.id === Number(id)) || null;
export const brokerActive = (until, now = Date.now()) => !!until && new Date(until).getTime() > now;

/// The published weight. Deterministic in both terms — NEVER by chance, which is the standing rule
/// that keeps a stock distribution out of loot-box territory entirely.
export const brokerWeight = (tierId, gains = {}) => {
  const t = brokerTier(tierId);
  if (!t) return 0;
  return t.mult * activityScore(gains);
};

// ── THE COMMUNITY EARMARK — the family buyback's revenue slices (omerta-treasury-to-family-design.md
// §4/§8, Phase 1). Every lever here is a FUNCTION (env read per call — the FEE_TREASURY_BPS shape) and
// every default is ZERO, which is the Phase-1 guarantee: with no env set, every ingest books
// byte-identically to the day before this shipped. Phase 2 (the founder's lever flip, BALANCE.md
// § THE FAMILY BUYBACK) turns them on: the locked targets are FEE 1500 / STORE 1500 / TAX 2666-of-gross
// (= 240 of the 900-bps tax) / HARVEST 6280 / POLFEES_VIG 2500. Where each slice comes FROM is part of
// the machinery: fee + store carve the implicit founder (operations) remainder at booking time; the
// sell-tax slice sits BEFORE the LP remainder (so Phase 2 lowers SELL_TAX_RWA_BPS in the same flip and
// LP stays ≈300); harvest splits the bank_revenue booking (which also shrinks the city leg's budget —
// flagged in BALANCE.md); POLFEES_VIG diverts POL fees to the Vig reserve (the Wall-4 relaxation the
// design doc records, with the ops-slice alternative if the founder wants the buyback budget pure).
export const COMMUNITY = {
  FEE_BPS: () => Number(process.env.FEE_COMMUNITY_BPS ?? 0),          // of each gameplay fee's gross
  STORE_BPS: () => Number(process.env.STORE_COMMUNITY_BPS ?? 0),      // of each Store payment's gross
  TAX_BPS: () => Number(process.env.SELL_TAX_COMMUNITY_BPS ?? 0),     // of the TAX (out of SELL_TAX.BPS, not 10000)
  HARVEST_BPS: () => Number(process.env.HARVEST_COMMUNITY_BPS ?? 0),  // of each harvest fee (in the market's underlying)
  POLFEES_VIG_BPS: () => Number(process.env.POL_FEES_VIG_BPS ?? 0),   // POL fees diverted to the Vig (not community — the same locked package)
};

// ── STREET DEEDS (omerta-street-deeds-design.md) — the Monopoly layer. A named, mapped plot of the
// world a player OWNS and builds a legend on. Phase 1 is PURE STATUS (account-level → survives death,
// the estate/portfolio precedent; ZERO §10.4 — no currency, no faucet, no new reason). The deed is
// the permanent property; CONTROL (rent/turf, Phase 2) is earned and defended in-game; the on-chain
// tradeable token is Phase 3 (audit + counsel gated). These numbers are display/scope only — never a
// balance lever, so they are NOT tabled in BALANCE.md and carry no test/levers.js pin.
export const DEEDS = {
  NAME_MIN: 3, NAME_MAX: 28,        // a street name: "Corvino Way", "Ash Street", "Nine Fingers Row"
  HISTORY_MAX: 40,                  // events on a deed's dossier (the legend, newest first)
  // renown = Σ event weights. A deed's legend is the RECORD OF REAL PLAY on it — unforgeable, unfarmable,
  // the driver of what one street is worth over another (§4/§5). Weighted by how notable the event is.
  EVENT_WEIGHT: { claim: 1, fell: 5, blood: 4, empire: 3, title: 4, war: 6, sold: 2 },
  RANKS: [
    { min: 0, name: 'A Nameless Block' }, { min: 5, name: 'Known Ground' },
    { min: 20, name: 'A Storied Corner' }, { min: 50, name: 'Bloody Ground' },
    { min: 120, name: 'A Legend of the City' },
  ],
};
export const deedRankOf = (renown) => { let r = DEEDS.RANKS[0]; for (const t of DEEDS.RANKS) if (Number(renown) >= t.min) r = t; return r; };
export const deedRenown = (history) => (history || []).reduce((a, e) => a + (DEEDS.EVENT_WEIGHT[e.kind] || 1), 0);
// ── STREET DEEDS Phase 2 — CONTROL + THE CORNER TAKE (omerta-street-deeds-design.md §2/§3). The deed
// is permanent property (A, Phase 1); CONTROL is the contestable RENT layer (B). THE CORNER TAKE is a
// small, HARD-CAPPED, lazy cash faucet (`deed:corner`, character_id'd → the per-character cash check
// reconciles; ONE deed per account → the base-wide ceiling is (deed holders) × PER_HR × 24h, petty vs
// the passive stack) collected only by whoever CONTROLS the deed. THE SHAKEDOWN moves control, not
// money (§10.4-neutral). Turf perks (C) are Phase 2C below (founder-signed 2026-08-16 — the perk
// VALUES are the signed district perks unchanged; only WHO carries them widened, OR never stacking).
// Every number here is a founder SIM sign-off lever (BALANCE.md), NOT a
// signed value — the design's "redirect not faucet" ideal is a genuine small faucet in engineering
// terms (a true redirect needs a cross-character lock on a hot path or a new §10.4 bucket; the
// bounded-faucet-measured-and-flagged precedent — territory/business/port/world — is cleaner), so the
// corner take is measured in tools/sim.js and kept petty.
DEEDS.CORNER_PER_HR = 2000;                 // cash/hr the corner take accrues (sign-off lever)
DEEDS.CORNER_CAP_MS = 24 * 3600 * 1000;     // hard cap (an absent controller earns ≤ 24h)
DEEDS.CONTROL_MS = 12 * 3600 * 1000;        // a rival's control window before it lapses back to the owner
DEEDS.SHAKEDOWN_CD_MS = 6 * 3600 * 1000;    // per-deed cooldown (bounds spam/grief)
DEEDS.SHAKEDOWN_ENERGY = 15;
DEEDS.SHAKEDOWN_HEAT = 10;                  // exposure win or lose (leaning on a corner is exposure)
DEEDS.SHAKEDOWN_MIN_LVL = 8;                // anti-alt floor (the RIVALS/npcHit precedent)
// (red team 2026-08-16) THE SAME ANTI-ALT FLOOR ON THE MONEY. Claiming a deed is free and ungated by
// design (Phase 1 is pure status — naming your street is a good day-one moment), but the CORNER TAKE
// hung off it with no floor at all: a brand-new level-1 account with $500 claimed a street for $0 and
// drew $48,000/day — 96× its starting cash, forever, for no play. Reproduced. Two things make it a
// defect rather than the accepted petty-faucet posture: the system contradicted itself (level 8 to
// MUSCLE a corner, level 1 to OWN one and collect from it), and the sim's own model (P9.37) sizes this
// as "ONE deed per account, linear in the playerbase" — an assumption Sybil multiplication breaks.
// The gate is on the MONEY, not the claim, so a new player still names their street and builds its
// legend; the income waits until they're somebody. Exactly the WANTED_MIN_LVL shape — below the floor a
// defaulter is still WANTED, just with no pool cash on his head.
DEEDS.CORNER_MIN_LVL = 8;                   // == SHAKEDOWN_MIN_LVL: you can earn a corner when you could take one
DEEDS.SHAKE_BASE_P = 0.5; DEEDS.SHAKE_MIN_P = 0.15; DEEDS.SHAKE_MAX_P = 0.85; DEEDS.SHAKE_STAT_SCALE = 200;
// the corner take owed on a deed (capped) — a pure function of its accrual clock
export const deedCornerOwed = (deed, now = Date.now()) => {
  if (!deed || !deed.corner_at) return 0;
  const ms = Math.min(Math.max(0, now - new Date(deed.corner_at).getTime()), DEEDS.CORNER_CAP_MS);
  return Math.floor(DEEDS.CORNER_PER_HR * ms / 3600000);
};
// who currently CONTROLS a deed (collects its corner take): a rival inside their window, else the owner
export const deedController = (deed, now = Date.now()) =>
  (deed && deed.controller_account && deed.control_until && new Date(deed.control_until).getTime() > now)
    ? deed.controller_account : (deed ? deed.account_id : null);
// ── STREET DEEDS Phase 2C — THE CONTROLLER'S PERKS (founder-directed 2026-08-16 "Build it now").
// The deed-vs-control split applied to TURF POWER: whoever CONTROLS a corner (the owner when no
// rival has muscled in, or the usurper inside their window) personally enjoys that district's
// SIGNED turf perk — OR'd with family turf by SET-UNION at every perk site, so a district counted
// twice (family holds it AND you control a corner there) adds NOTHING (never stacks; free-player
// parity: the perk VALUES are the signed district perks, unchanged). PERK_TURF: 0 disables the
// turf half; PERK_OP_SLOTS: 0 disables the seat. Both are founder SIM sign-off levers (BALANCE.md
// § STREET DEEDS 2C). Deliberately EXCLUDED (family machinery, not district perks): convoy
// TURF_DEF, the neon fight fix, the docks harbormaster toll, sovereignty — those key on the GANG
// holding the district, which a deed never is.
DEEDS.PERK_TURF = 1;      // 1 = the controller enjoys the district perk (OR, never stacks); 0 = off
DEEDS.PERK_OP_SLOTS = 1;  // extra operation seats while you control your OWN corner (capped at SLOTS_MAX)
// ── STREET DEEDS Phase 3 — THE SECONDARY MARKET (off-chain core; the on-chain tradeable NFT is
// AUDIT + securities-counsel gated, design-only). A deed holder LISTS their street for sale; a DEEDLESS
// buyer buys it → the deed + its whole PROVENANCE (the legend) transfer to the buyer, and CONTROL RESETS
// (the identity-NFT lesson: the paper + the legend travel, the corner-take control does NOT — the buyer
// must shake for the corner). §10.4: `deed:sale` is the audited bodyguard:hire non-escrow taxed transfer
// (seller nets 98%, 1% dev off-ledger + 1% street tax → buyback), riding the existing `deed:` cash prefix.
DEEDS.MARKET_MIN = 10000;               // floor sale price (a street is a real asset, not a $1 flip)
DEEDS.SALE_FEE_BPS = 100;               // 1% dev (off-ledger — the bodyguard:hire pattern)
DEEDS.SALE_TAX_BPS = 100;               // 1% street tax → buyback (the standard 2% house take)
// ── STREET DEEDS Phase 4 — THE GROWING MAP (§10.4-ZERO — pure render off the living-player count). The
// city EXPANDS as users join: each district's neighborhoods OPEN in order as the population crosses
// EXPANSION_STEP thresholds. Late joiners get FRESH GROUND on the frontier. Marketed as a living, growing
// world — NEVER as scarce/appreciating land (design §6). A deed's neighborhood is DERIVED (stable, no
// column); a not-yet-open one reads as the FRONTIER (you claimed ground before it was even a neighborhood).
DEEDS.NEIGHBORHOODS = {
  docks:     ['Wharf Side', 'The Cannery', 'Saltwater Row', "Dead Man's Pier", 'The Breakwater'],
  neon:      ['The Strip', 'Ruby Lane', 'Midnight Row', 'The Velvet Blocks', 'Chinatown Gate'],
  foundry:   ['The Slag', 'Ironside', 'Furnace Row', 'The Coke Yards', 'Cinder Flats'],
  brick:     ['The Kilns', 'Mortar Row', 'Red Hollow', 'The Claypits', 'Bricktown'],
  canal:     ['Lockgate', 'The Towpath', 'Barge End', 'Willow Bend', 'The Cut'],
  cathedral: ['The Spire', 'Rosary Row', "Saint's Rest", 'The Cloisters', 'Gallows Hill'],
};
DEEDS.EXPANSION_STEP = 8;               // living players per new neighborhood opening (per district)
// how many of a district's neighborhoods are OPEN at a given living-player population (the first is always
// open; one more per EXPANSION_STEP players, capped at the district's neighborhood count)
export const deedNeighborhoodsOpen = (population, district) => {
  const list = DEEDS.NEIGHBORHOODS[district] || [];
  return Math.max(1, Math.min(list.length, 1 + Math.floor(Math.max(0, Number(population) || 0) / DEEDS.EXPANSION_STEP)));
};
// a deed's neighborhood — DERIVED from its name (stable, no column). Returns { name, index, frontier }
// where `frontier` = not-yet-open at this population (a pioneer on the edge of the growing city).
export const deedNeighborhoodOf = (name, district, population) => {
  const list = DEEDS.NEIGHBORHOODS[district] || [];
  if (!list.length) return null;
  const idx = Math.floor(hash01('deednbr:' + String(name)) * list.length) % list.length;
  return { name: list[idx], index: idx, frontier: idx >= deedNeighborhoodsOpen(population, district) };
};

// ── THE PROVENANCE COLORS (dynasty §9, built off the G-3 snapshots — the wards are FICTIONAL noir
// inventions, the §9.5 two-vocabularies rule: the community→ward mapping is server-side only, the
// numeric ids never surface with a real collection's name anywhere in game copy or metadata, and
// every name below must pass the GUESSABILITY TEST (a reviewer who has not seen the mapping must be
// unable to identify the source community from name + art — no pixel/ape/frog/broker/cat lexemes).
// DISPLAY-ONLY FOREVER (§9.4, the wall): a ward moves NOTHING — no stat, no cap, no discount, no
// access, no activation weight — it is a birthmark on the portrait and a `genesis_provenance`
// metadata attribute, nothing else, ever. Names + colors are founder levers (pinned whole).
export const PROVENANCE = {
  WARDS: {
    1: { name: 'the Meridian Rooms',   color: '#c9a24b' },
    2: { name: 'the Ironbridge Club',  color: '#4fd6c2' },
    3: { name: 'the Old Harbor Ward',  color: '#5a8fd6' },
    4: { name: 'the Lantern Quarter',  color: '#b8504a' },
    5: { name: 'the Granite Row',      color: '#9aa4ad' },
    6: { name: 'the Velvet Stair',     color: '#8a5ac2' },
    7: { name: 'the Corniche',         color: '#c98a4b' },
    8: { name: 'the Winter Garden',    color: '#7fc24f' },
  },
};
export const wardOf = (id) => PROVENANCE.WARDS[Number(id)] || null;
