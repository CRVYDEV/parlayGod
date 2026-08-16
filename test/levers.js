// THE SIGNED LEVERS (the 56th suite) — ground rule #1, enforced instead of remembered.
//
// BALANCE.md and SIGN-OFF.md say the economy is SIGNED: "every KEEP row in BALANCE.md is production
// balance", the numbers were sim-audited, and CLAUDE.md's first ground rule is "do not invent
// mechanics or improve balance". Until now that was a promise in prose. The graph plane measured the
// gap: **182 levers named in those two documents that no suite asserted against**, meaning any of
// them could be retuned — by a future session, by me, by anyone — and the full suite would stay
// green. A signed number nothing checks is not signed, it is merely written down.
//
// This pins 369 of them to their signed values. Not just the 182: a lever a suite happens to
// MENTION is not value-pinned either, so the whole signed register is covered.
//
// HOW TO CHANGE A LEVER. Edit the value here as well as in src/rules.tail.js, in the same commit,
// and say why in BALANCE.md. That is the entire point — the edit becomes deliberate and reviewable
// rather than silent. This test is not an obstacle to retuning; it is the record that a retune
// happened.
//
// HONEST SCOPE. The values below were snapshotted from the tree on 2026-07-27, which is the state
// BALANCE.md and SIGN-OFF.md describe as signed (the 2026-07-16 sign-off plus the FINAL SWEEP). So
// this asserts the CURRENT values are preserved going forward; it does not independently re-derive
// that each number is correct — the sim and the audits do that. Its job is drift, and drift only.
import assert from 'node:assert';
import fs from 'node:fs';
import * as R from '../src/rules.js';
import { walkSrc } from './lib/srcfiles.js';

// lever path -> the value it is signed at. LITERALS on purpose: reading these from src/rules.js at
// runtime would assert that the code equals itself, which is exactly the vacuous check this suite
// exists to avoid.
const SIGNED = [
  ['AUCTION.CONSIGN.FEE_OMR', 12],
  ['AUCTION.CONSIGN.MAX_LIVE', 3],
  ['AUCTION.CONSIGN.MAX_RESERVE', 100000],
  ['AUCTION.CONSIGN.MIN_RAISE_BPS', 500],
  ['AUCTION.CONSIGN.MIN_RESERVE', 10],
  ['AUCTION.CONSIGN.TAKE_BPS', 500],
  ['AUCTION.LOTS_PER_WEEK', 3],
  ['AUCTION.MIN_RAISE_BPS', 500],
  ['BLACK_MARKET.LIST_FEE_BPS', 100],
  ['BLACK_MARKET.MAX_LISTINGS', 3],
  ['BLACK_MARKET.MAX_TTL_H', 48],
  ['BLACK_MARKET.MIN_PRICE', 50],
  ['BLACK_MARKET.MIN_RAISE_BPS', 500],
  ['BLACK_MARKET.SNIPE_WINDOW_MS', 300000],
  ['BLACK_MARKET.TAKE_BPS', 200],
  // The two the register check had been SHADOWING: it matches by LEAF name, so pinning
  // TRADE_FEE.MAX_BPS silently "covered" SELL_TAX.MAX_BPS, and retiring the trade fee exposed it.
  // Both are contract-mirrored ceilings the subtree's rules forbid raising — pinned properly now.
  ['SELL_TAX.MAX_BPS', 1000],       // OMR.sol MAX_SELL_TAX_BPS — the anti-rug/anti-honeypot ceiling
  ['BONDS.DISCOUNT_BPS', 800],      // must stay strictly UNDER SELL_TAX.BPS (§9.6) or a bond is an arbitrage
  ['BONDS.DEV_BPS', 1500],   // v2 step 3: 2000 -> 1500, the design's own number (BALANCE.md)
  ['BONDS.MAX_DISCOUNT_BPS', 2000],
  ['BONDS.POL_BPS', 3750],   // 5000 -> 3750: the remainder after the float slice, at the signed 5:3 POL:VIG
  ['BONDS.RWA_BPS', 2500],   // bond ETH's TREASURY slice (design 4; the stock float it once funded was retired 2026-07-31)
  ['BONDS.VIG_BPS', 2250],   // 3000 -> 2250: same remainder, ratio preserved rather than zeroed
  // THE LP LEAGUE — an ETH-DAY of canonical-pool depth scores 1% of a bonded ETH on the underwriter
  // axis. A PROPOSED default: size it properly once a real pool exists (BALANCE.md § THE LP LEAGUE).
  ['BONDS.LP_SCORE_PER_ETH_DAY', 300],
  ['BOXING.BET_MAX', 250000],
  ['BOXING.BET_RAKE_BPS', 800],
  ['BOXING.DEFENSE_MS', 604800000],
  ['BOXING.INJURY_MS', 14400000],
  ['BOXING.LEGEND_MIN_LVL', 10],
  ['BOXING.MAIN_EVENT_MS', 1800000],
  ['BOXING.MAX_STAKE', 500000],
  ['BOXING.RAKE_BPS', 500],
  ['BOXING.RECRUIT_COST', 50000],
  ['BOXING.STAT_CAP', 25],
  ['BOXING.STAT_MAX', 14],
  ['BOXING.TRAIN_ENERGY', 15],
  ['BOXING.TRAIN_GAIN', 1],
  ['BOXING.VARIANCE', 22],
  ['BUSINESS_EMPIRE.TAKEOVER.CD_MS', 86400000],
  ['BUSINESS_EMPIRE.TAKEOVER.HEAT', 12],
  ['BUSINESS_EMPIRE.TAKEOVER.MAX_P', 0.85],
  ['BUSINESS_EMPIRE.TAKEOVER.MIN_LEVEL', 20],
  ['BUSINESS_EMPIRE.TAKEOVER.MIN_P', 0.1],
  ['BUSINESS_EMPIRE.TAKEOVER.STAT_SCALE', 120],
  // THE CAPO'S LICENSE — agent recruiting perks (capability, never cash; BALANCE.md § THE CAPO'S LICENSE)
  ['CAPO.MIN_LVL', 8],
  ['CAPO.RETAIN_DAYS', 14],
  ['CAPO.TIERS', [{ n: 1, name: 'Street Captain', rate: 1 / 2.5, tapBonus: 0 },
    { n: 3, name: 'Capo', rate: 1 / 2, tapBonus: 1 },
    { n: 5, name: 'The Underboss', rate: 1 / 1.5, tapBonus: 2 }]],
  ['CASINO.BJ_DEALER_MIN', 17],
  ['CASINO.BJ_HIT_SOFT_17', true],
  ['CASINO.BRACKET.ADVANCE', 2],
  ['CASINO.BRACKET.ROUND_MS', 600000],
  ['CASINO.DICE_NERVE', 1],
  ['CASINO.FIGHT_BET_MIN_LVL', 5],
  ['CASINO.FIGHT_MAX', 5000],
  ['CASINO.FUTURITY.FIELD_MAX', 8],
  ['CASINO.FUTURITY.MAX_BET', 25000],
  ['CASINO.FUTURITY.MIN_RUNNERS', 3],
  ['CASINO.FUTURITY.RAKE_BPS', 500],
  ['CASINO.FUTURITY.REGISTER_MS', 1800000],
  ['CASINO.FUTURITY.VARIANCE', 22],
  ['CASINO.HIGH_FEED', 250000],
  ['CASINO.HIGH_LVL', 30],
  ['CASINO.HIGH_MAX', 2000000],
  ['CASINO.MAX_BET', 250000],
  ['CASINO.PVP_RAKE_BPS', 500],
  ['CASINO.RAKEBACK_BPS', 100],
  ['CASINO.RING.IDLE_MS', 1800000],
  ['CASINO.RING.MIN_LVL', 3],
  ['CASINO.RING.RAKE_BPS', 300],
  ['CASINO.RING.TURN_MS', 90000],
  ['CASINO.TOURNEY.MIN_ENTRANTS', 2],
  ['CASINO.TOURNEY.PAYOUTS', [0.5,0.3,0.2]],
  ['CASINO.TOURNEY.RAKE_BPS', 500],
  ['CASINO.TOURNEY.REGISTER_MS', 86400000],
  ['CASINO.TRACK.EDGE', 0.15],
  ['CASINO.TRACK.FIELD', 6],
  ['CASINO.TRACK.MAX_BET', 10000],
  ['COMMISSION.AMNESTY_MULT', 0.5],
  ['COMMISSION.BLOOD_OATH_LOOT_MULT', 1.25],
  ['COMMISSION.LOCKDOWN_DEF', 20],
  ['COMMISSION.OPEN_ROADS_MULT', 0.8],
  ['COMMISSION.OPEN_SEASON_MULT', 0.5],
  ['COMMISSION.OVERRIDE_WEIGHT', 7],
  ['COMMISSION.PORT_INTERDICT_MULT', 0.75],
  ['COMMISSION.PROPOSAL_DEPOSIT', 100000],
  ['CONSTANTS.AMM_LP_BPS', 2500],
  ['CONSTANTS.BANK_CLEAR_MS', 7200000],
  ['CONSTANTS.BANK_TAPER_ABOVE', 10000000],
  ['CONSTANTS.BANK_TAPER_KEEP', 0.1],
  ['CONSTANTS.BUSINESS_CAP_MS', 86400000],
  ['CONSTANTS.BUSINESS_LAUNDER_HEAT', 8],
  ['CONSTANTS.BUSINESS_RAID_P_PER_MIN', 0.0005],
  ['CONSTANTS.BUSINESS_RAID_THRESHOLD', 60],
  ['CONSTANTS.BUSINESS_SCRUTINY_PER_CAP', 45],
  ['CONSTANTS.BUSINESS_SCRUTINY_PER_INCOME_DAY', 30],
  ['CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR', 1],
  ['CONSTANTS.BUSINESS_RAID_FINE_RATE', 0.10],
  ['CONSTANTS.BUSINESS_UPKEEP_BPS', 2000],
  // D6=B (founder, 2026-08-02): 7d → 2d. At 7d the pad crossed over the till at five days away,
  // so abandoning an entry-tier front became the rational move after a normal week off.
  ['CONSTANTS.BUSINESS_UPKEEP_CAP_MS', 172800000],
  ['CONSTANTS.BUSINESS_UPKEEP_COLD_MS', 259200000],
  ['CONSTANTS.BUSINESS_UPKEEP_PROG_BPS', 500],
  ['CONSTANTS.BUSINESS_SHUTTER_BPS', 0],
  ['CONSTANTS.CREATE_STAT_MIN', 3],
  ['CONSTANTS.CREATE_STAT_TOTAL', 15],
  ['CONSTANTS.KITCHEN_ONRAMP_BONUS', 0.5],
  ['CONSTANTS.GARAGE_CAP', 12],
  ['CONSTANTS.LAUNDER_HEAT', 15],
  ['CONSTANTS.PUBLIC_WASH_CAP_DAY', 2600000],
  ['CONSTANTS.SAFEHOUSE_NW_BPS', 100],
  ['CONSTANTS.SEARCH_MS', 10800000],
  ['CONSTANTS.SHAKEDOWN_RATE', 0.3],
  ['CONSTANTS.STAKE_POOL_BPS', 3000],
  ['CONSTANTS.TERRITORY_CAP_MS', 86400000],
  ['CONSTANTS.TERRITORY_RAID_THRESHOLD', 60],
  ['CONSTANTS.TERRITORY_RIVAL_CUT_BPS', 3000],
  ['CONSTANTS.TERRITORY_SCRUTINY_DECAY_HR', 4],
  ['CONSTANTS.TERRITORY_UPKEEP_BPS', 2000],
  ['CONSTANTS.TERRITORY_UPKEEP_CAP_MS', 604800000],
  ['CONSTANTS.TERRITORY_UPKEEP_COLD_MS', 259200000],
  ['CONSTANTS.UNSTAKE_CD_MS', 21600000],
  ['CONVOY.GUARD_WEAR_BPS', 2500],
  ['CONVOY.INSURE_BPS', 1000],
  // pinned when STREET DEEDS 2C's exclusion list named it in BALANCE — the register-complete guard
  // caught the prose citing a lever nothing pinned (the WAR_MS/SEIZE_OUTBID class, third instance)
  ['CONVOY.TURF_DEF', 15],
  ['CONVOY.INSURE_PAYOUT_BPS', 5000],
  ['CONVOY.LEGEND_MIN_LVL', 10],
  ['CONVOY.MAX_AMBUSHES', 3],
  ['CONVOY.NPC.GOODS', ["gin","silk","cigars","coffee"]],
  ['CONVOY.NPC.MAX_QTY', 16],
  ['CONVOY.NPC.TARGET', 2],
  ['CONVOY.TOLL_BPS', 500],
  // ECONOMY v3 STEP 3 — THE BAND AND THE DAILY AUCTION (design §11.6/§11.7). The band's UPPER edge is
  // pinned for a second reason beyond "it is a signed number": the auction's RESERVE is derived from
  // it, so moving UPPER silently moves the price the desk will sell at. That is the whole mechanism.
  ['BAND.ANCHOR_DAYS', 30],
  ['BAND.UPPER_BPS', 10000],       // 1.00x anchor — sell at or above the 30-day average
  ['BAND.LOWER_BPS', 8000],        // 0.80x — the BUY edge (step 4); pinned now so the pair cannot drift
  ['DESK_AUCTION.DURATION_MS', 21600000],   // 6h
  ['DESK_AUCTION.OPEN_BPS', 15000],         // opens at 1.5x anchor, descending linearly to the reserve
  ['DESK_AUCTION.FLOAT_CAP_BPS', 100],      // 1% of float/day — a huge sink day must not become a dump
  ['DESK_AUCTION.FLOAT_CAP_MIN_OMR', 6000], // the bootstrap floor under that cap (float 0 would deadlock it)
  ['DESK_AUCTION.MIN_LOT', 1],
  ['DESK_AUCTION.ORACLE_MAX_AGE_MS', 172800000], // 48h, then FAIL-CLOSED — never a fallback price
  ['DESK_AUCTION.ETH_POL_BPS', 5000],       // the ETH proceeds split 50/50 POL / founder
  // step 4, the BUY side. MIN_ETH is pacing; PRICE_FLOOR_BPS is a SAFETY bound, not a balance one —
  // the shelf credit is eth/price, so it is what stops a mistyped decimal minting inventory.
  ['DESK_BUYBACK.MIN_ETH', 0.001],
  ['DESK_BUYBACK.PRICE_FLOOR_BPS', 2000],
  ['DUELS.GRUDGE_CD_MULT', 0.34],
  ['DUELS.LEGEND_MIN_LVL', 10],
  ['DUELS.MIN_LVL', 5],
  ['DUELS.RAKE_BPS', 500],
  ['DUELS.STYLE_EDGE', 1.15],
  ['DUELS.VARIANCE', 40],
  // TOKENOMICS v2 (the one-way window). OPEN is pinned FALSE deliberately: opening it is a real
  // economic event (it is what severs cash → $OMR), so it must be an explicit edit here, in the
  // same change — not a flag someone flips. FUND_BPS diverts 30% of the buyback the day it opens.
  ['EXCHANGE.OPEN', true],      // OPENED by tokenomics v2 step 2 (the interlock discharged — see BALANCE.md)
  ['EXCHANGE.RATE', 500],
  ['EXCHANGE.MIN_OMR', 6],
  ['EXCHANGE.DAILY_CAP_OMR', 1500],
  ['EXCHANGE.FUND_BPS', 10000], // the WHOLE street take — with the AMM retired it has nowhere else to go
  // the migration dial — 0 means the buyback splits exactly as before; raising it moves yield from
  // individuals to families and must happen as stake:reward/dividend:omr retire, or it pays twice
  ['FAMILY_YIELD.FUND_BPS', 500],   // re-homed 2026-07-29: 0 -> 500, and it now means a share of each
                                    // WINDOW REDEMPTION. The old source (a share of the 12h buyback's
                                    // bought $OMR) was deleted by v2 step 2 and nothing ever read it.
  ['FAMILY_YIELD.SEATS', 5],
  ['FAMILY_YIELD.WEIGHTS', [5, 4, 3, 2, 1]],
  // (the five EMISSION levers lived here — the Street Wage retired with economy v3 step 1, and the
  // constants went with it rather than being zeroed, so there is nothing left to pin. See BALANCE.md
  // § THE FARM for the measured Sybil economics that decided it.)
  ['ESTATE.GALA_MIN_TIER', 2],
  ['ESTATE.GALA_MS', 14400000],
  ['ESTATE.GALA_OMR', 90],
  ['ESTATE.STAFF_WALK_MS', 604800000],
  ['HEIST_FENCE_LO', 0.8],
  ['HEIST_FILL_FEE', 5000],
  ['HEIST_FILL_MAX', 1],
  ['HEIST_INSIDE_CD_MS', 86400000],
  ['HEIST_LEADER_WEIGHT', 1.2],
  ['HEIST_LOOT_RATE', 0.5],
  ['HEIST_PLAN_TTL_MS', 21600000],
  ['HEIST_RAT_BPS', 5000],
  ['HONOR.DREADED', -60],
  ['HONOR.TRUSTED', 60],
  ['KITCHEN.CUT_COST', 8000],
  ['KITCHEN.CUT_FLOOR', 0.55],
  ['KITCHEN.CUT_QUALITY', 0.15],
  ['KITCHEN.CUT_UNITS', 0.4],
  ['KITCHEN.MODULE_BASE_CASH', 60000],
  ['KITCHEN.MODULE_MAX', 5],
  ['KITCHEN.MODULE_OMR_FROM', 3],
  ['LAW.BUST_P_MIN', 0.15],
  ['LAW.ENVELOPE_GAIN_MULT', 0.5],
  ['LAW.ENVELOPE_MS', 604800000],
  ['LAW.ENVELOPE_OMR', 90],
  ['LAW.EXPOSURE_DECAY', 0.1],
  ['LAW.INDICT_AT', 3000],
  ['LAW.JURY_BUST_MULT', 0.5],
  ['LAW.RETAINER_BUST_MULT', 0.6],
  ['LAW.WATCH', 40],
  ['LOAN.COLLECT_HOSP_MS', 1800000],
  ['LOAN.GRACE_MS', 86400000],
  ['LOAN.HOUSE_MIN', 1000],
  ['LOAN.HOUSE_MIN_LVL', 10],
  ['LOAN.HOUSE_RATE', 0.35],
  ['LOAN.HOUSE_TERM_H', 24],
  ['LOAN.HOUSE_VIG_BPS', 5000],
  ['LOAN.MAX_ACTIVE', 1],
  ['LOAN.OFFER_TTL_MS', 172800000],
  ['LOAN.PAPER_MAX', 5000000],
  ['LOAN.PAPER_MIN', 1],
  ['LOAN.PAPER_TAKE_BPS', 200],
  ['LOAN.RATE_MAX', 0.5],
  ['LOAN.SQUARE_COST', 50000],
  ['LOAN.VIG_BPS', 500],
  ['LOAN.WANTED_BOUNTY', 25000],
  ['LOAN.WANTED_HUNT_P', 0.05],
  ['LOAN.WANTED_MIN_LVL', 20],
  // ECONOMY v3 step 5 — THE FLOAT (design §5/§11.2/§11.5). MADE_OMR/MS are the subscription that
  // creates CONTINUOUS $OMR demand; ACCESS_STAKE.HIGH_OMR is the held float the high-stakes seat wants.
  ['ACCESS_STAKE.HIGH_OMR', 300],
  ['MADE.ESTATE_TIER', 4],
  ['MADE.MS', 2592000000],
  ['M4.REF_LEGACY_RECRUIT_OMR', 1],
  ['BLOODLINE.SCORE.LEVEL', 10],
  // MUST NOT MOVE with a re-denomination: REF_LEGACY_RECRUIT_OMR exists to read PRE-retirement
  // referral rows honestly on My Profile, so scaling it makes the take box lie about money
  // already paid. Pinned so a blanket sweep cannot take it along.
  ['MADE.OMR', 120],
  // THE LADDER (D8=D) — power for HOLDING. RUNGS is pinned whole (bracket-accessed leaves are
  // invisible to the reader check, so the PARENT is the pin — the MASTERY.PERKS precedent).
  ['MADE_LADDER.RUNGS', [{"min":60,"name":"Earner","trunk":1,"energy":5,"nerve":1,"garage":1,"fenceBps":0},{"min":180,"name":"Operator","trunk":2,"energy":10,"nerve":2,"garage":2,"fenceBps":0},{"min":450,"name":"Capo","trunk":3,"energy":15,"nerve":3,"garage":3,"fenceBps":250},{"min":900,"name":"Kingmaker","trunk":4,"energy":20,"nerve":4,"garage":4,"fenceBps":500}]],
  ['MADE_LADDER.MADE_RUNGS', 1],
  // DYNASTY §9 — THE PROVENANCE WARDS. Fictional community names (the §9.5 guessability posture —
  // a renamed ward that starts identifying a real collection is a copy violation, so the whole map
  // is the pin; bracket-accessed leaves are invisible to the reader check, the MADE_LADDER.RUNGS
  // precedent). Display-only forever (§9.4) — no ward carries a gameplay number.
  ['PROVENANCE.WARDS', {"1":{"name":"the Meridian Rooms","color":"#c9a24b"},"2":{"name":"the Ironbridge Club","color":"#4fd6c2"},"3":{"name":"the Old Harbor Ward","color":"#5a8fd6"},"4":{"name":"the Lantern Quarter","color":"#b8504a"},"5":{"name":"the Granite Row","color":"#9aa4ad"},"6":{"name":"the Velvet Stair","color":"#8a5ac2"},"7":{"name":"the Corniche","color":"#c98a4b"},"8":{"name":"the Winter Garden","color":"#7fc24f"}}],
  // ECONOMY v3 step 7 — THE RARITY NFTs (design §7/§9.7). The tier weights decide how scarce a
  // legendary is (and therefore what one is worth on a secondary market); the upgrade ladder is the
  // only price money pays here, and it is DETERMINISTIC by design — see the RARITY block.
  ['RARITY.TIERS', [{ id: 'common', name: 'Common', w: 700 }, { id: 'rare', name: 'Rare', w: 220 },
    { id: 'legendary', name: 'Legendary', w: 65 }, { id: 'epic', name: 'Epic', w: 15 }]],
  ['RARITY.UPGRADE_OMR', [0,150,540,1800]],
  ['M3.BODYGUARD_MIN_PRICE', 10000],
  ['M3.CASH_LOOT_RATE', 0.25],
  ['M3.COACH_FAMILY_BAND_LVL', 12],   // the early band the 'join a family' rung leads inside
  // the window a MULTIPLAYER-ONLY rung (crew score, duel) leads for before it drops to the
  // recurring tail — measured at 77% of a solo run when it led forever (BALANCE: the social band)
  ['M3.COACH_SOCIAL_BAND_LVLS', 8],
  ['M3.CONTRACT_AMMO_REBATE', 0.5],
  ['M3.CRIME_LOUD_CASH_PREMIUM', 1],
  // D14 option A (SIGNED 2026-08-05) — the crime-roll stat coefficients, steepened EV-neutral at REF
  ['M3.CRIME_STAT.CUN', 0.008],
  ['M3.CRIME_STAT.SPD', 0.004],
  ['M3.CRIME_STAT.OFFSET', 0.072],
  ['M3.DEATH_DUTY_RATE', 0.25],
  ['M3.DIRECTED_MAX_H', 24],
  ['M3.DIRECTED_MIN', 10000],
  ['M3.FIRE_HEAT', 20],
  ['M3.GEAR_LOOT_CHANCE', 0.15],
  ['M3.JUMP_STEAL_CAP', 25000],
  ['M3.NPC_HIT_TARGET_CD_MS', 86400000],
  ['M3.OMR_LOOT_IDLE', 0.5],
  ['M3.OMR_LOOT_COMMITTED', 0.2],
  ['M3.SAFEHOUSE_COST', 25000],
  ['M3.SAFEHOUSE_MS', 14400000],
  ['M3.SEIZE_BASE', 30000],
  // THE WATCH (strategy package) — the holder's declared hour, and what a surprise costs
  ['M3.WAR_MS', 30*60*1000],
  ['M3.SEIZE_OUTBID', 1.5],
  ['M3.WATCH_WINDOW_H', 4],
  ['M3.WATCH_SURPRISE_MULT', 1.5],
  // THE SEALED BID (strategy step three) — the contest window, and the forfeit that stops
  // "always commit everything" from being the only line a family can play.
  ['M3.CONTEST_MS', 30*60*1000],
  ['M3.CONTEST_LOSS_BPS', 5000],
  // THE ROSTER (strategy step four) — the family's made men as scarce posts. Every effect is
  // ADDITIVE and single-touchpoint; the scarcity is that one man fills one chair.
  ['M3.ROSTER_MIN_LEVEL', 5],
  ['M3.ROSTER_REASSIGN_CD_MS', 6*60*60*1000],
  ['M3.ROSTER_POWER_DIV', 10],
  ['M3.ROSTER_POWER_MAX', 8],
  ['M3.ROSTER_MULT_FLOOR', 0.7],
  ['M3.ROSTER_ENFORCER_GARRISON', 6000],
  ['M3.ROSTER_CAPO_SCRUTINY_PER', 0.04],
  ['M3.ROSTER_STREETBOSS_WAR_PER', 0.03],
  ['M3.ROSTER_QM_GUARD_DEF', 3],
  ['M3.ROSTER_BAGMAN_UPKEEP_PER', 0.03],
  ['M3.TERRITORY_SEIZE_BPS', 5000],
  ['M3.WAR_COST', 10000],
  ['M3.WAR_COST_BPS', 200],
  ['M3.WAR_KILL_POINTS', 3],
  ['M3.WAR_SPOILS', 0.20],
  // THE CREW BONUS — what replaced the referral $OMR (founder-directed 2026-07-31). MAX_BONUS is
  // load-bearing: respect drives level, level gates everything, and the PACING pass deliberately
  // slowed levelling — an uncapped crew would walk straight through it.
  ['M4.DEAL_ENERGY', 4], // D13 (SIGNED 2026-08-05): the corner's energy cost
  ['M4.REF_XP.STEP_LEVELS', 5],
  ['M4.REF_XP.PER_STEP', 0.05],
  ['M4.REF_XP.MAX_BONUS', 1.0],
  // D7=C (founder, 2026-08-02): 7d → 2d. Chosen over raising OFFLINE_CAP_MS, which would have moved
  // every offline faucet in the game rather than just the kitchen's.
  ['M4.CREW_WAGE_CAP_MS', 172800000],
  ['M4.CREW_COST_STEP', 50000],
  ['M4.CREW_MAX', 5],
  ['CONSTANTS.OFFLINE_CAP_MS', 28800000],
  ['M4.CREW_WAGE_COLD_MS', 259200000],
  ['M4.CREW_WAGE_PER_HR', 1200],
  ['M4.LAYLOW_CASH', 5000],
  ['M4.REF_PUSH_MAX_HOURS', 336],
  ['M4.REF_PUSH_MAX_MULT', 5],
  ['M4.REF_TIER2_CASH', 5000],
  ['M8.RESPEC_CD_MS', 86400000],
  ['M8.RESPEC_OMR', 90],
  ['MEGAPROJECT.MIN_CASH', 100],
  ['MEGAPROJECT.MIN_OMR', 6],
  ['MEGAPROJECT.OMR_RATE', 83],
  // THE TRADES (mastery, step one 2026-07-29) — status-only today, load-bearing when the
  // milestone-perk / paths-v2 / stat-drip steps land (the curve + the death echo are the dials)
  ['MASTERY.XP_DIVISOR', 15],
  ['MASTERY.MAX_LVL', 50],
  ['MASTERY.HEIR_KEEP_BPS', 2500],
  // step two — the den XP floor + the dynast echo (the perk fx arrays live under lowercase track
  // keys, outside the walker's reach; the two UPPERCASE scalars named in BALANCE are pinned here)
  ['BLACK_MARKET.LIST_FEE_MIN', 10], // named by the step-2 BALANCE entry (the fee floor that re-asserts after the commerce perk)
  ['MASTERY.GAMBLER_MIN_STAKE', 1000],
  ['MASTERY.TRAIT_HEIR_BPS', 5000],
  ['MASTERY.STAT_USE.CAP_DAY', 3],
  ['MASTERY.STAT_USE.P_PER_XP', 0.02],
  ['MASTERY.STAT_USE.GYM_DIM', 200],
  ['M4.REF_CLAIM_WINDOW_MS', 259200000],
  // THE REGIMEN (2026-07-30) — five disciplines on the shared gym clock + NPC trainer drills.
  // Pacing/status only (XP is not a currency); the touchpoint dials are the levers.
  ['REGIMEN.CAP', 25],
  ['REGIMEN.XP_DIVISOR', 15],
  ['REGIMEN.XP_MIN', 8],
  ['REGIMEN.XP_MAX', 12],
  ['REGIMEN.ENERGY', 10],
  ['REGIMEN.DRILL_XP', 25],
  ['REGIMEN.CONDITIONING_BPS', 100],
  ['REGIMEN.CONDITIONING_FLOOR', 0.75],
  ['REGIMEN.DUEL_ADD', 0.6],
  // THE HUSTLE (2026-07-30) — the daily three-stop chain's completion faucet (once a day,
  // level-scaled; the clue-casket posture: petty by design, the MOVEMENT is the product)
  // THE CAREER — the post-First-Week ladder's unlock bar (task cash values live in the CAREER
  // catalog; the ladder is a fixed once-ever-per-account lifetime total — BALANCE.md)
  ['CAREER.NEED', 4],
  ['HUSTLE.PAY_PER_LVL', 200],
  ['HUSTLE.PAY_MIN', 600],
  // step three — PATHS v2 (the XP-rate axis + the switch throttle; the PATH_FX perk/handicap
  // mults live under lowercase path keys, outside the walker — the founder dials are these three)
  ['PATH_XP_HOME', 1.5],
  ['PATH_XP_RIVAL', 0.6],
  ['PATH_SWITCH_CD_MS', 604800000],
  ['NOTORIETY.CONVOY_DEF_CAP', 24],
  ['NOTORIETY.CONVOY_DEF_PER', 0.6],
  ['NOTORIETY.DECAY_PER_HR', 4],
  ['NOTORIETY.GAIN', 8],
  ['NOTORIETY.PORT_P_CAP', 0.16],
  ['NOTORIETY.PORT_P_PER', 0.004],
  ['NOTORIETY.REP_DECAY_MULT', 2],
  ['NOTORIETY.REP_GAIN_MULT', 0.5],
  ['NOTORIETY.REP_TOLL_MULT', 0.5],
  ['CONSTANTS.RACKET_DAILY_CAP_MS', 43200000],
  ['PACING.LEVEL_DIVISOR', 10],
  ['PACING.LEVEL_UP_REFILL', true],
  ['PACING.LEVEL_UP_REFILL_MAX_DAY', 10],
  ['PACING.MISSION_RESPECT_MULT', 0.25],
  ['PACING.MISSION_CD_MS', 14400000],
  ['PACING.TRAIN_CD_MS', 180000],
  // the PLEX rail's pricing. The mint is ETH ONLY (the Sybil bound + the extraction gate), so no
  // row here prices one — these price the RESPAWN and the Store SKUs, which are repeatable
  // consumables and access, where "pay your rent in ISK" applies cleanly. The genesis rate is the
  // pre-market anchor both the $OMR quote and the floor derive from; move it and every $OMR price
  // on the rail moves with it, which is the point of pinning it rather than the derived numbers.
  ['PLEX_GENESIS_OMR_PER_ETH', 205882],
  ['STORE.PLEX_PREMIUM_BPS', 10000],
  ['STORE.PLEX_FLOOR_OMR_PER_ETH', 205882],
  ['PEN.BREAK_CAUGHT_ADD_S', 900],
  ['PEN.BREAK_FAIL_DMG', [20,45]],
  ['PEN.BREAK_HEAT', 40],
  ['PEN.COOP_BASE', 0.4],
  ['PEN.COOP_MAX', 4],
  ['PEN.COOP_MIN', 2],
  ['PEN.COOP_MAX_P', 0.9],
  ['PEN.COOP_PER_EXTRA', 0.12],
  ['PEN.FACTION_COVER_CAP', 0.24],
  ['PEN.FUGITIVE_MS', 172800000],
  ['PEN.PROTECTION_COST', 15000],
  ['PEN.PROTECTION_NW_BPS', 50],
  ['PEN.SHOTCALLER_COVER', 0.1],
  ['PEN.WORK_CUT_S', 60],
  ['PEN.WORK_PAY', [200,600]],
  // step six — THE YARD LIVES (§10.4-free: XP + pacing only, zero ledger rows)
  ['PEN.CARDS_ENERGY', 5],
  ['PEN.TALK_WISDOM_XP', 15],
  ['PEN.TALK_CUT_S', 120],
  ['POPULATION.RETIRE_GENERATIONS', 6],
  ['POPULATION.SPAWN_PER_TICK', 4],
  ['POPULATION.TARGET', 48],
  ['POPULATION.TURNOVER.PER_DAY', 24],
  ['POPULATION.EVENTS.TOURNEY_FIELD', 6],
  ['POPULATION.EVENTS.GP_FIELD', 6],
  ['POPULATION.EVENTS.STAKES_FIELD', 6],
  ['POPULATION.EVENTS.FUTURITY_FIELD', 6],
  // NPC FAMILIES — the "Nobody survives alone" rung is uncompletable solo without somewhere to
  // join. §10.4-free by construction (a resident founder pays the SIGNED gang:found sink out of
  // its own seed cash), and deliberately powerless: excluded from the Commission and the family
  // yield, unwarrable, holds no turf. TARGET 0 turns the whole thing off.
  ['POPULATION.FAMILIES.TARGET', 3],
  ['POPULATION.FAMILIES.MIN_MEMBERS', 2],
  ['POPULATION.FAMILIES.MAX_MEMBERS', 5],
  ['POPULATION.FAMILIES.FOUND_BANDS', ['capo', 'boss']],
  // JAILBIRDS — makes the SIGNED §7.8 bust:reward faucet reachable solo (bounded by the refill)
  ['POPULATION.JAILBIRDS.TARGET', 2],
  ['POPULATION.JAILBIRDS.MIN_S', 240],
  ['POPULATION.JAILBIRDS.MAX_S', 400],   // 1200 → 400 SIGNED 2026-08-05 (Part B A5 — the camp-the-long-sentence EV cap)
  // …and the throttle on the other side of it. A failed bust is the ONLY cost of the loop (no
  // energy, no nerve, no ammo), so this number alone sets how many attempts a camper gets at a
  // bird before it walks — which is what P9.28 measures the faucet ceiling from. Pinned when that
  // probe was written, so the ceiling can't move by a quiet edit to the jail stretch.
  ['M3.BUST_FAIL_JAIL_S', 180],
  ['M3.BUST_ATTEMPTS_DAY', 5], // D15 (SIGNED 2026-08-05): the rolling-24h bust-attempt cap
  // THE TICKER BALLOT — the chamber's daily stock pick (§10.4-free: the ballot moves no value; the
  // Phase-B keeper consumes the record). TICKERS is a whole-array pin (the STREAK.MILESTONES shape).
  ['TICKER_BALLOT.TICKERS', ['SPY', 'AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT']],
  ['TICKER_BALLOT.DEFAULT', 'SPY'],
  // STREET LIFE (#318) — WORD ON THE STREET (the corner faucet is HARD-bounded MAX_DAY × CASH =
  // $2k/day + 75 respect/day; POOLS/CONFLICT are parent-object pins — the draw indexes them)
  ['CORNER.PER_DAY', 3],
  ['CORNER.MAX_DAY', 5],
  ['CORNER.CASH', 400],
  ['CORNER.RESPECT', 15],
  ['CORNER.CONFLICT', ['jump', 'bust']],
  ['CORNER.POOLS', { docks: ['goods', 'crime', 'jump', 'melt'], canal: ['deal', 'cook', 'crime', 'jump'],
    brick: ['crime', 'jump', 'bust', 'gta'], neon: ['dice', 'crime', 'jump', 'goods'],
    foundry: ['craft', 'gta', 'crime', 'melt'], cathedral: ['train', 'crime', 'goods', 'bust'] }],
  // THE CHAIN (step two) — the block's standing job. The bonus rides the COMPLETING claim's own
  // ledger row, so the faucet ceiling stays MAX_DAY claims a day; STEPS is what makes it a week.
  ['CORNER.CHAIN_STEPS', 3],
  ['CORNER.CHAIN_BONUS', 1500],
  ['CORNER.CHAIN_RESPECT', 40],
  // STREET DEEDS Phase 2 — the corner take (a bounded located cash faucet) + the control shakedown
  ['DEEDS.CORNER_PER_HR', 2000],
  ['DEEDS.CORNER_CAP_MS', 24 * 3600 * 1000],
  ['DEEDS.CONTROL_MS', 12 * 3600 * 1000],
  ['DEEDS.SHAKEDOWN_CD_MS', 6 * 3600 * 1000],
  ['DEEDS.SHAKEDOWN_ENERGY', 15],
  ['DEEDS.SHAKEDOWN_HEAT', 10],
  ['DEEDS.SHAKEDOWN_MIN_LVL', 8],
  ['DEEDS.SHAKE_BASE_P', 0.5],
  ['DEEDS.SHAKE_MIN_P', 0.15],
  ['DEEDS.SHAKE_MAX_P', 0.85],
  ['DEEDS.SHAKE_STAT_SCALE', 200],
  // Phase 2C — THE CONTROLLER'S PERKS: the district turf perk follows corner CONTROL (OR with family
  // turf by set-union, never stacks — the perk VALUES are the signed district perks unchanged) + one
  // extra op seat for your OWN corner, capped at SLOTS_MAX (parity). 0 disables each. Sim P9.38.
  // ═══ SCARCITY (omerta-scarcity-design.md) — three ways to make the city ITEM-scarce, not just
  // POSITION-scarce. None of them is a faucet: firsts are status, runs are ownership, and the
  // shipment's material gates a SINK. Setting any of these to 0/[] disables its feature cleanly.
  // §2 LIMITED RUNS — the caps are the scarcity; the roll is the drop (TEST-ONLY override).
  ['LIMITED_RUN_P', 0.004],
  ['LIMITED_RUNS', [
    { id: 'midnight',  model: 'nocturne',  cap: 25, name: 'The Midnight Series',
      blurb: 'Twenty-five left the coachbuilder in black. Nobody wrote down who ordered them.' },
    { id: 'ghostline', model: 'spectre',   cap: 12, name: 'The Ghost Line',
      blurb: 'Twelve chassis, twelve dead registrations. The paperwork was the point.' },
    { id: 'coronation', model: 'sovereign', cap: 9, name: 'The Coronation Nine',
      blurb: 'Nine were built for a coronation that never happened. They still gleam.' },
    { id: 'lastrun',   model: 'tsarina',   cap: 3,  name: "The Tsarina's Last Run",
      blurb: 'Three. The factory burned the week after, and the moulds with it.' },
  ]],
  // §3 THE SHIPMENT — the contested daily material. CITY_CAP is the contention (one shared quantity
  // for the whole town); PER_PLAYER stops a whale taking the lot; ROUT_UNITS is the apex-cartel drop;
  // LOOT_RATE is what a fire-kill takes off a stockpile. The COMMISSIONS are the sink it gates.
  ['SHIPMENT.CITY_CAP', 40],
  ['SHIPMENT.PER_PLAYER', 4],
  ['SHIPMENT.ROUT_UNITS', 6],
  ['SHIPMENT.LOOT_RATE', 0.5],
  ['SHIPMENT.COMMISSIONS', [
    { id: 'case',   units: 2,  cash: 120000,  name: 'A Gold Cigarette Case',
      blurb: 'Monogrammed, and heavy enough to stop a small calibre. It has, once.' },
    { id: 'watch',  units: 4,  cash: 400000,  name: 'A Perpetual Wristwatch',
      blurb: 'Swiss, and older than the family. It has not been wound since 1931 and keeps perfect time.' },
    { id: 'bust',   units: 8,  cash: 1200000, name: 'A Marble Bust of Yourself',
      blurb: 'Commissioned from a sculptor who does headstones. He said he saw no difference.' },
    { id: 'service', units: 16, cash: 4000000, name: 'The Silver Service',
      blurb: 'Fifty-two pieces for a table nobody in this city is brave enough to sit at.' },
  ]],
  ['DEEDS.PERK_TURF', 1],
  ['DEEDS.PERK_OP_SLOTS', 1],
  // Phase 3 — the deed market (a taxed cash transfer, the bodyguard:hire pattern) + Phase 4 — the growing map
  ['DEEDS.MARKET_MIN', 10000],
  ['DEEDS.SALE_FEE_BPS', 100],
  ['DEEDS.SALE_TAX_BPS', 100],
  ['DEEDS.EXPANSION_STEP', 8],
  // THE CALL — recycle-only transfers from the contact's own pocket (zero new faucet)
  ['CONTACTS.CALL_TTL_MS', 24 * 3600 * 1000],
  ['CONTACTS.CALL_FREIGHT_PREMIUM_BPS', 11500],
  ['CONTACTS.CALL_FREIGHT_MAX_QTY', 8],
  ['CONTACTS.VISIT_TIP', 750],
  ['CONTACTS.GEN_PER_TICK', 4],
  // THE BOOK (step two) — a status ladder on lines held (moves nothing) and the per-contact
  // STANDING that scales what a regular asks for. Recycle-only holds at every tier: the ask grows,
  // the source does not — generation still skips what the contact can't cover.
  ['CONTACTS.RANKS', [{ at: 0, title: 'Nobody Calls' }, { at: 5, title: 'A Few Numbers' },
    { at: 15, title: 'Well Connected' }, { at: 40, title: 'The Rolodex' },
    { at: 80, title: 'Everybody Knows You' }, { at: 150, title: 'The Switchboard' }]],
  ['CONTACTS.STANDING_TIERS', [{ at: 0, name: 'a stranger', qtyMult: 1.0, tipMult: 1.0 },
    { at: 3, name: 'a regular', qtyMult: 1.5, tipMult: 1.4 },
    { at: 8, name: 'a friend', qtyMult: 2.0, tipMult: 1.8 },
    { at: 20, name: 'family', qtyMult: 3.0, tipMult: 2.5 }]],
  // THE FAVOR (Street Life step two) — the player-posted call. The escrow bounds are what keep a
  // single poster from parking the bank in un-lootable rows; the take is what makes paying an alt lossy.
  ['FAVOR.MAX_OPEN', 3],
  ['FAVOR.MIN_PAY', 500],
  ['FAVOR.MAX_PAY', 250000],
  ['FAVOR.MAX_QTY', 20],
  ['FAVOR.TTL_MS', 24 * 3600 * 1000],
  ['FAVOR.TAKE_BPS', 200],
  // THE CREW (omerta-crew-design.md) — pure scope/pacing, no faucet
  ['CREW.MAX_MEMBERS', 4],
  ['CREW.MIN_LEVEL', 3],
  ['CREW.NAME_MAX', 24],
  ['CREW.INVITE_TTL_MS', 72 * 3600 * 1000],
  // THE CREW OBJECTIVE — the weekly shared goal (a bounded social cash faucet + the goal targets).
  // KINDS is pinned as the WHOLE array (deep-compared) — the base targets are bracket-accessed leaves
  // invisible to the reader check, so the PARENT is the pin (the RIVALS whole-map precedent).
  ['CREW.OBJECTIVE.REWARD', 5000],
  // BRING ONE — the first-crewmate incentive (a bounded cash faucet gated behind the §7.13 qualify wall)
  ['CREW.BRING_ONE.RECRUITER_CASH', 15000],
  ['CREW.BRING_ONE.RECRUIT_CASH', 7500],
  ['CREW.OBJECTIVE.KINDS', [
    { id: 'crimes', label: 'Pull jobs together', base: 40, unit: 'jobs' },
    { id: 'kills', label: 'Put bodies in the ground', base: 3, unit: 'kills' },
    { id: 'earn', label: 'Bring in the score', base: 200000, unit: '$' },
  ]],
  ['DISCOVERY.BAND', 10],
  ['DISCOVERY.LIMIT', 24],
  ['DISCOVERY.LFG_TTL_MS', 7 * 24 * 3600 * 1000],
  // IDENTITY — the free "about me" blurb length cap (pure scope/status, no faucet)
  ['IDENTITY.BIO_MAX', 200],
  // THE AHA MOMENT (src/firstblood.js) — the guaranteed early conflict beat. REWARD_CASH is the one
  // bounded once-ever faucet (gated by aha_stage → never twice a street; BALANCE.md § THE AHA MOMENT).
  ['AHA.MIN_LVL', 3],
  ['AHA.REWARD_CASH', 2500],
  ['AHA.REWARD_RESPECT', 40],
  // THE MENTOR (omerta-first-contact-and-events-design.md) — MILESTONES is the one faucet (sim + BALANCE.md)
  ['MENTOR.MIN_LVL', 20],
  ['MENTOR.PROTEGE_MAX_LVL', 10],
  ['MENTOR.ACTIVE_MAX', 3],
  ['MENTOR.OFFER_TTL_MS', 3 * 24 * 3600 * 1000],
  ['MENTOR.SEEKING_TTL_MS', 7 * 24 * 3600 * 1000],
  ['MENTOR.MILESTONES', [{ lvl: 5, cash: 2000 }, { lvl: 10, cash: 4000 }, { lvl: 15, cash: 6000 }, { lvl: 20, cash: 8000, graduate: true }]],
  ['MENTOR.RANKS', [{ at: 0, name: 'Unproven' }, { at: 1, name: 'A Made Teacher' }, { at: 3, name: 'The Counselor' }, { at: 7, name: 'The Godfather' }, { at: 15, name: 'The Old Don' }]],
  ['MENTOR.GIFT_CASH', 5000],
  ['MENTOR.GIFT_CD_MS', 24 * 3600 * 1000],
  ['STREAK.REWARDS', [500, 800, 1200, 1700, 2300, 3000, 4000]],
  ['STREAK.MAX_DAY', 7],
  ['STREAK.RANKS', [{ at: 0, name: 'Drifter' }, { at: 3, name: 'A Regular' }, { at: 7, name: 'A Face' }, { at: 14, name: 'A Fixture' }, { at: 30, name: 'The Neighborhood' }, { at: 90, name: 'A Made Institution' }]],
  // THE MILESTONES — the run-unlock ladder (title + bonus). Whole-array pin (bracket-accessed bonuses
  // are invisible to the reader check, so the PARENT is the pin — the RIVALS whole-map precedent).
  ['STREAK.MILESTONES', [
    { day: 7, title: 'The Regular', bonus: 10000 },
    { day: 14, title: 'The Fixture', bonus: 25000 },
    { day: 30, title: 'The Neighborhood', bonus: 75000 },
    { day: 60, title: 'The Institution', bonus: 150000 },
    { day: 100, title: 'The Immortal', bonus: 300000 },
  ]],
  // THE WEEKLY BULLETIN — the weekly spotlight challenge. `target` is the status-difficulty dial per
  // theme (no faucet — the reward is a rotating title). Whole-array pin (the bracket-accessed targets
  // are invisible to the reader check, so the PARENT is the pin — the STREAK.MILESTONES precedent).
  ['BULLETIN.THEMES', [
    { id: 'wetwork',   name: 'Blood Week',  word: 'The families are restless — bodies are the currency this week.',    tab: 'pvp',     spotlight: 'Wet Work',      metric: 'kills',         target: 2,      title: "The Week's Reaper" },
    { id: 'kitchen',   name: 'Cook Week',   word: 'The corners are hungry — product moves fast this week.',            tab: 'kitchen', spotlight: 'The Kitchen',   metric: 'product_moved', target: 250000, title: "The Week's Chemist" },
    { id: 'racing',    name: 'Race Week',   word: 'The strip is packed — engines screaming, pink slips on the line.',  tab: 'races',   spotlight: 'Street Races',  metric: 'race_wins',     target: 3,      title: "The Week's Wheelman" },
    { id: 'boxing',    name: 'Fight Week',  word: 'The crowd wants a show — the ring is the only place to be.',        tab: 'boxing',  spotlight: 'The Fights',    metric: 'boxing_wins',   target: 3,      title: "The Week's Contender" },
    { id: 'smuggling', name: 'Tide Week',   word: 'The docks never sleep this week — freight by the boatload.',        tab: 'scores',  spotlight: 'The Port',      metric: 'smuggled',      target: 300000, title: "The Week's Smuggler" },
    { id: 'heists',    name: 'Score Week',  word: 'Crews are assembling — the vaults are heavy this week.',            tab: 'scores',  spotlight: 'Crew Heists',   metric: 'heists_pulled', target: 2,      title: "The Week's Mastermind" },
    { id: 'world',     name: 'War Week',    word: 'The cartels are exposed — the whole city hunts them this week.',    tab: 'city',    spotlight: 'The Cartels',   metric: 'cartel_damage', target: 750000, title: "The Week's Warlord" },
  ]],
  // PRIME TIME — the nightly synchronous window (THE RALLY). RALLY_* are the value faucet's dials
  // (BASE + PER×min(turnout−1, CAP), the whole §10.4 exposure per row); the rest pace the window.
  // MECHANICS/TITLES are pinned as whole arrays (the bracket-accessed entries are invisible to the
  // reader check — the BULLETIN.THEMES precedent); MECHANICS grows as steps two/three land.
  ['PRIME_TIME.WINDOW_H', 1],
  ['PRIME_TIME.FORECAST_DAYS', 7],
  ['PRIME_TIME.RALLY_BASE', 2000],
  ['PRIME_TIME.RALLY_PER', 500],
  ['PRIME_TIME.RALLY_TURNOUT_CAP', 20],
  ['PRIME_TIME.RALLY_MIN_LVL', 5],
  ['PRIME_TIME.HAPPY_ROUNDS', 3],
  ['PRIME_TIME.HAPPY_CASH', 800],
  ['PRIME_TIME.SIEGE_STRIKE', 100],
  ['PRIME_TIME.SIEGE_NEED', 8],
  ['PRIME_TIME.SIEGE_CASH', 3000],
  ['PRIME_TIME.SIEGE_TITLE', 'Stormed the Gates'],
  ['PRIME_TIME.MECHANICS', ['rally', 'happyhour', 'siege']],
  ['PRIME_TIME.TITLES', ['Night Owl', 'The Faithful', 'Answered the Call', 'The Regular', 'First to the Bar', 'The Usual Suspect']],
  ['POPULATION.MARKS.CAR_P', { made: 0.6, capo: 0.8, boss: 0.9 }],
  ['POPULATION.MARKS.CAR_VAL', { made: [800, 2000], capo: [2000, 8000], boss: [5000, 20000] }],
  ['POPULATION.MARKS.FRONT_P', { made: 0.4, capo: 0.6, boss: 0.8 }],
  ['POPULATION.MARKS.FRONTS', { made: ['laundromat', 1], capo: ['laundromat', 2], boss: ['restaurant', 1] }],
  ['POPULATION.MARKS.BOAT_P', { capo: 0.35, boss: 0.6 }],
  ['POPULATION.MARKS.FRONT_INCOME_BPS', 500],
  ['POPULATION.MARKS.STAKE_BPS', 1500],           // step three — the resident's stable
  ['POPULATION.MARKS.FIGHTER_P', { capo: 0.4, boss: 0.6 }],
  ['POPULATION.MARKS.RACER_P', { capo: 0.4, boss: 0.6 }],
  ['POPULATION.MARKS.GOODS_BPS', 1000],
  ['POPULATION.MARKS.GOODS_MAX_UNITS', 10],
  ['PORT.ESCORT_COST', 15000],
  ['PORT.FINE_RATE', 0.5],
  ['PORT.FLEET_MAX', 5],
  ['PORT.INTERDICT_MAX', 0.85],
  ['PORT.INTERDICT_MIN', 0.03],
  ['PORT.MIN_LEVEL', 6],
  ['PORT.RESALE_BPS', 6000],
  ['PORT.SINK_P', 0.15],
  ['PORT.STEP2.ENGINE_STEP', 8],
  ['PORT.STEP2.PIRATE_TAKE_BPS', 6000],
  ['PORT.STEP2.UPGRADE_BASE', 30000],
  ['PORT.STEP3.TOLL_BPS', 500],
  ['PORT.STEP4.FENCE_LO', 0.85],
  ['PORT.STEP4.FENCE_SPAN', 0.4],
  ['PORT.SUPPLY_CAP_DAY', 400000],
  // (D11 2026-08-05: the Portfolio's DIVIDEND_*/FAMILY_DYNASTY_NAME_OMR pins retired with their
  // levers; the surviving SCRUTINY_* window is the VAULT's and pinned below)
  ['PORTFOLIO.SCRUTINY_HEAT', 12],
  ['PORTFOLIO.SCRUTINY_MIN_OMR', 6000],
  ['PORTFOLIO.SCRUTINY_WINDOW_MS', 86400000],
  ['RACES.CD_MS', 7200000],
  ['RACES.GP.MIN_ENTRANTS', 3],
  ['RACES.GP.MIN_LEVEL', 12],
  ['RACES.GP.PAYOUTS', [0.6,0.3,0.1]],
  ['RACES.GP.RAKE_BPS', 500],
  ['RACES.GP.REGISTER_MS', 1800000],
  ['RACES.LOSS_DMG', 8],
  ['RACES.MIN_LEVEL', 3],
  ['RACES.NOS_COST', 8000],
  ['RACES.NOS_MAX', 3],
  ['RACES.NOS_POWER', 60],
  ['RACES.RAKE_BPS', 500],
  ['RACES.TUNE_COST', 25000],
  ['RACES.TUNE_MAX', 5],
  ['RACES.VARIANCE', 40],
  ['RACES.WAGER_MIN', 500],
  ['RACES.WHEEL_MIN_LVL', 10],
  // THE MAP (strategy package) — geography's two effects on the price of turf. Multiplicative by the
  // P9.20d finding: a FLAT family cost becomes noise the moment a family is established.
  ['MAP.NEIGHBOUR_PREMIUM_MULT', 1.10],
  ['MAP.ADJACENT_MULT', 0.85],
  // the edge list itself is a lever — the layout decides which districts are chokepoints and which
  // are ends. A whole-object pin: the arrays are leaves, invisible to the reader check on their own.
  ['DISTRICT_ADJ', {
    docks: ['canal', 'brick'],
    canal: ['docks', 'foundry', 'neon'],
    foundry: ['canal', 'brick', 'neon'],
    brick: ['docks', 'foundry', 'cathedral'],
    neon: ['canal', 'foundry', 'cathedral'],
    cathedral: ['brick', 'neon'],
  }],
  // THE SEASON HAS AN ENDING (strategy package) — the phase boundaries + the reckoning's escalation.
  // A whole-object pin: the three multipliers are leaves on an array entry, invisible to the reader
  // check on their own, so the PARENT is what is pinned (the recorded map-lever discipline).
  ['SEASON_PHASES', [
    { id: 'opening', name: 'The Opening', from: 0,
      blurb: 'A fresh season. Positions are cheap and nothing is settled — take ground while it is quiet.' },
    { id: 'long_game', name: 'The Long Game', from: 7,
      blurb: 'The city has found its shape. Build, hold, and watch who is climbing.' },
    { id: 'reckoning', name: 'The Reckoning', from: 21,
      blurb: 'The last week. Turf is cheap to challenge, the windows are short and contests settle fast — whatever you are holding when the books close is what the city remembers.',
      contestMsMult: 0.5, floorMult: 0.75, watchWindowMult: 0.5 },
  ]],
  // THE TRANCHE SCHEDULE (dynasty §10 Shape D, ADOPTED 2026-08-10 — linear). A whole-array pin:
  // the schedule is a PUBLISHED COMMITMENT, so a quiet edit to any row is exactly what the pin
  // exists to catch. The row-level laws (one implied rate per row; the free-path headroom vs the
  // live mission table) are asserted in test/made.js beside the ladder's own ceiling claim.
  // THE CITY LEG'S ACTIVITY METRIC (THE BANK §4.2). Whole-object pins on both halves: TAGS is the
  // SEVERANCE WALL (an unthrottled tag added here lets cash buy a share of the bought-$OMR pool),
  // and TRACK_OF is what the breadth gate counts. MIN_TRACKS/MIN_SCORE are a GATE, never a cap —
  // a per-account cap is Sybil-POSITIVE and is the measured Street Wage bug (BALANCE § THE FARM).
  ['ACTIVITY.MIN_TRACKS', 3],
  ['ACTIVITY.MIN_SCORE', 25],
  ['ACTIVITY.TAGS', ['crime', 'jump', 'shakedown', 'standover', 'fire', 'shank', 'duel',
    'cook', 'deal', 'boost', 'race', 'port', 'piracy', 'score', 'heist', 'bout', 'exhibition',
    'cards', 'yardtale', 'primetime', 'numbers', 'trackbet']],

  // THE BROKERS (omerta-brokers-design.md). The tier ladder is a $OMR SINK and the mults are one
  // half of the distribution key — `weight = tier.mult x activityScore`. Pinned as the whole
  // catalog because a leaf buried in an array entry is invisible to the register's reader check
  // (the FAMILY_CHARTER_FX lesson). ACTIVATION_MS is what makes it RECURRING rather than a
  // one-time purchase, which is the whole reason it helps an economy that pools into staking.
  ['BROKERS.TIERS', [{"id":1,"name":"Runner","omr":150,"mult":1},{"id":2,"name":"Broker","omr":450,"mult":1.5},{"id":3,"name":"Floor Trader","omr":1200,"mult":2},{"id":4,"name":"Specialist","omr":3000,"mult":2.5},{"id":5,"name":"The Chairman","omr":9000,"mult":3}]],
  ['BROKERS.ACTIVATION_MS', 30 * 24 * 3600 * 1000],
  ['BROKERS.EPOCH_DAYS', 7],
  ['BROKERS.MIN_WEIGHT', 1],
  // ETH ONLY (2026-08-10). No $OMR column: the mint is the Sybil bound, and a fee with two rails is
  // always priced by the cheaper one. The schedule was always the ETH waves.
  ['MINT_TRANCHES', [{"through":1000,"eth":0.01},{"through":11000,"eth":0.025},{"through":36000,"eth":0.035},{"through":86000,"eth":0.045},{"through":186000,"eth":0.05}]],
  // The one rate every ETH-denominated fee converts through pre-market. Moving it re-prices EVERY
  // $OMR rail at once (mint, respawn, Store SKUs, the tranche column) — which is the point.
  // FAMILY CHARTERS (strategy package) — the asymmetry. Both halves of each trade are levers: the
  // handicap IS the mechanic, so a retune that quietly softened one side would turn a charter back
  // into a free upgrade. A whole-object pin (the multipliers are leaves on array entries).
  ['FAMILY_CHARTER_FX.EDGE', 0.85],
  ['FAMILY_CHARTER_FX.COST', 1.15],
  ['FAMILY_CHARTER_FX.HEAT_EDGE', 0.75],
  ['FAMILY_CHARTER_FX.LOSS_COST', 1.25],
  ['FAMILY_CHARTER.CHANGE_OMR', 240],
  ['FAMILY_CHARTER.CHANGE_CD_MS', 604800000],
  // THE BLOOD WAR (NPC families step two) — NPC families as a PvE antagonist. A bounded family:raid
  // faucet on a regen pool that sits BELOW the weakest World outfit; the war score never touches
  // Commission standing (the severance). All SIM sign-off levers. RANKS pinned whole (array leaves are
  // invisible to the reader check).
  ['FAMILY_WAR.POOL_MAX', 120000],
  ['FAMILY_WAR.POOL_REGEN_HR', 4000],
  ['FAMILY_WAR.RAID_BPS', 500],
  ['FAMILY_WAR.RAID_MAX', 20000],
  ['FAMILY_WAR.RAID_MIN_LVL', 8],
  ['FAMILY_WAR.RAID_ENERGY', 18],
  ['FAMILY_WAR.RAID_AMMO', 8],
  ['FAMILY_WAR.RAID_HEAT', 8],
  ['FAMILY_WAR.RAID_CD_MS', 14400000],
  ['FAMILY_WAR.BASE_P', 0.55],
  ['FAMILY_WAR.DEF_MAX', 60],
  ['FAMILY_WAR.DEF_SCALE', 300],
  ['FAMILY_WAR.MIN_P', 0.1],
  ['FAMILY_WAR.MAX_P', 0.9],
  ['FAMILY_WAR.COUNTER_P', 0.35],
  ['FAMILY_WAR.COUNTER_HOSP_MS', 1800000],
  ['FAMILY_WAR.AGGRO_DELAY_MS', 2700000],
  ['FAMILY_WAR.RETAL_P', 0.5],
  ['FAMILY_WAR.RETAL_HOSP_MS', 1800000],
  ['FAMILY_WAR.ROUT_FLOOR_BPS', 1000],
  ['FAMILY_WAR.TRIBUTE_BPS', 200],
  ['FAMILY_WAR.TRIBUTE_CAP_MS', 86400000],
  ['FAMILY_WAR.FAIL_HOSP_MS', 1800000],
  ['FAMILY_WAR.RANKS', [[0, 'Unblooded'], [25000, 'Button Man'], [150000, 'Warmaker'], [500000, 'Family Killer'], [2000000, 'The Exterminator']]],
  // THE FAMILY WAR (formal declaration) — status/pacing over the raid loop; §10.4-neutral (gang:war sink only)
  ['FAMILY_WAR.WAR.COST', 25000],
  ['FAMILY_WAR.WAR.MS', 86400000],
  ['FAMILY_WAR.WAR.RAID_POINTS', 1],
  ['FAMILY_WAR.WAR.WIN_SCORE', 5],
  ['FAMILY_WAR.WAR.MAX_PER_FAMILY', 1],
  ['FAMILY_WAR.WAR.WIN_RANKS', [[0, 'No Campaigns'], [1, 'Campaigner'], [5, 'War Chief'], [15, 'Warlord'], [40, 'The Scourge of Families']]],
  // THE OFFENSIVE (step four) — NPC families that declare first (§10.4-neutral pacing; sim sign-off levers)
  ['FAMILY_WAR.AGGRESSION.TARGET', 2],
  ['FAMILY_WAR.AGGRESSION.MS', 43200000],
  ['FAMILY_WAR.AGGRESSION.STRIKE_EVERY_MS', 10800000],
  ['FAMILY_WAR.AGGRESSION.COOLDOWN_MS', 86400000],
  ['FAMILY_WAR.AGGRESSION.MIN_MEMBERS', 2],
  ['FAMILY_WAR.AGGRESSION.MIN_LVL', 5],
  ['FAMILY_WAR.AGGRESSION.ALLY_JOIN_MAX', 2],   // the aggressor's NPC allies that join the OFFENSIVE per cycle
  // NPC-FAMILY DIPLOMACY — the worker maintains this many NPC↔NPC alliances (flavor, §10.4-neutral status)
  ['DIPLOMACY.NPC.ALLY_TARGET', 2],
  ['DIPLOMACY.PACT_MS', 7 * 86400000],   // a sworn peace runs a week (the player↔NPC peace duration)
  // THE OPERATION SLOTS (strategy package) — how much of the 31-entry income catalog one player runs
  ['OPERATIONS.SLOTS_BASE', 2],
  ['OPERATIONS.SLOTS_PER_LEVEL', 4],
  ['OPERATIONS.SLOTS_MAX', 12],
  ['OPERATIONS.RACKET_RETIRE_BPS', 0],
  ['RACKET_EMPIRE.UP_COST_MULT', 0.5],
  ['RACKET_EMPIRE.UP_MAX', 5],
  ['RACKET_EMPIRE.UP_STEP', 0.12],
  ['RIVALS.ROB_RATE_BPS', 1500],
  ['RIVALS.ROB_ENERGY', 8],
  ['RIVALS.ROB_HEAT', 6],
  ['RIVALS.ROB_JAIL_S', 300],
  ['RIVALS.VICTIM_MIN_LVL', 8],
  ['RIVALS.CAR_THEFT.BASE_P', 0.35],
  ['RIVALS.CAR_THEFT.STAT_SCALE', 300],
  ['RIVALS.CAR_THEFT.ALARM_DIV', 3000],
  ['RIVALS.CAR_THEFT.MIN_P', 0.05],
  ['RIVALS.CAR_THEFT.MAX_P', 0.7],
  ['RIVALS.CAR_THEFT.ENERGY', 10],
  ['RIVALS.CAR_THEFT.JAIL_S', 600],
  ['RIVALS.CAR_THEFT.HEAT', 10],
  ['RIVALS.CAR_THEFT.VICTIM_SHIELD_MS', 86400000],
  ['RIVALS.RETENTION_D', 90],
  ['RIVALS.TRUNK.ENERGY', 8],
  ['RIVALS.TRUNK.HEAT', 5],
  ['RIVALS.TRUNK.JAIL_S', 300],
  ['RIVALS.TRUNK.SHIELD_MS', 86400000],
  ['RIVALS.BOAT_THEFT.ENERGY', 10],
  ['RIVALS.BOAT_THEFT.JAIL_S', 600],
  ['RIVALS.BOAT_THEFT.HEAT', 10],
  ['RIVALS.SABOTAGE.ENERGY', 8],
  ['RIVALS.SABOTAGE.HEAT', 5],
  ['RIVALS.SABOTAGE.JAIL_S', 300],
  ['RIVALS.SABOTAGE.INJURY_MS', 14400000],
  ['RIVALS.SABOTAGE.SHIELD_MS', 43200000],
  ['RIVALS.REVENGE_HONOR', 2],
  ['RIVALS.WIRE_RIVAL_MULT', 0.5],
  // Street War step three (founder-directed 2026-07-30, incl. the transfer)
  ['RIVALS.TAKE.POCKET_BPS', 2500],
  ['RIVALS.TAKE.MIN', 50],
  ['RIVALS.REVENGE_ATK_MULT', 1.10],
  ['RIVALS.REVENGE_CUT_MULT', 1.5],
  ['SECRETS.DIG_OMR', 60],
  ['SECRETS.MAX_HELD', 5],
  ['SKILLS.ACTIVE_CD_MS', 28800000],
  ['SKILLS.CAPSTONE_COST', 4],
  ['SKILLS.FX.DOC_MULT', 0.75],
  ['SKILLS.FX.KINGPIN_MULT', 1.08],
  ['SKILLS.FX.MADE_MAN_MULT', 1.08],
  ['SKILLS.FX.ROAD_BOSS_TRUNK', 3],
  ['SKILLS.LVL_PER_POINT', 4],
  ['SKILLS.MEMORY_MAX', 3],
  ['SKILLS.PRESTIGE_PER_POINT', 10],
  ['SKILLS.PRESTIGE_PER_SLOT', 8],
  ['SKILLS.PRESTIGE_POINT_MAX', 3],
  ['SKILLS.RESPEC_OMR', 60],
  ['SKILLS.RESPEC_ONE_OMR', 30],
  ['SOCIAL_GAME_URL', "https://www.omerta.fun"],
  ['SOCIAL_TASKS.ALL_BONUS', 500],
  ['SOCIAL_TASKS.CASH', 300],
  ['SOCIAL_X_HANDLE', "OmertaOnRH"],
  ['SOLDIERS.FIRST', ["Sal","Vinny","Rocco","Lefty","Knuckles","Ade","Paulie","Frankie","Mo","Curly","Big Tony","Little Tony","Jimmy","Sticks","Doc","Ice","Roxie","Vera","Dot","Mabel"]],
  ['SOLDIERS.INJURY_MS', 14400000],
  ['SOV.INCOME_CAP_MS', 86400000],
  ['SOV.SIEGE_COST', 50000],
  ['SOV.SIEGE_COST_BPS', 300],
  ['SOV.SOV_POINTS', [0,10,25,60,120,220,400]],
  ['SPEAKEASY.INCOME_CAP_MS', 86400000],
  ['SPEAKEASY.MIN_LEVEL', 15],
  ['SPEAKEASY.NOTORIETY_DECAY_HR', 4],
  ['SPEAKEASY.RAID_THRESHOLD', 60],
  ['SPEAKEASY.RENOWN.OMR_WEIGHT', 8],
  ['SPEAKEASY.RENOWN.OWNER_WEIGHT', 0.5],
  ['SPEAKEASY.SALE_MAX', 50000000],
  ['SPEAKEASY.STANDOVER.CD_MS', 86400000],
  ['SPEAKEASY.STANDOVER.HEAT', 15],
  ['SPEAKEASY.STANDOVER.MAX_P', 0.75],
  ['SPEAKEASY.STANDOVER.MIN_P', 0.05],
  ['SPEAKEASY.STANDOVER.STAT_SCALE', 400],
  ['SPEAKEASY.TABLE.MAX_BET', 100000],
  ['SPEAKEASY.TABLE.NOTORIETY', 8],
  ['SPEAKEASY.TABLE.RAKE_BPS', 300],
  ['STABLE.INJURY_MS', 14400000],
  ['STABLE.LEGEND_MIN_LVL', 10],
  ['STABLE.MAX_STAKE', 500000],
  ['STABLE.MIN_LEVEL', 6],
  ['STABLE.RAKE_BPS', 500],
  ['STABLE.STAKES.MIN_ENTRANTS', 3],
  ['STABLE.STAKES.PAYOUTS', [0.6,0.3,0.1]],
  ['STABLE.STAKES.RAKE_BPS', 500],
  ['STABLE.STAKES.REGISTER_MS', 1800000],
  ['STABLE.STAT_CAP', 25],
  ['STABLE.TRAIN_ENERGY', 12],
  ['STABLE.TRAIN_GAIN', 1],
  ['STABLE.VARIANCE', 22],
  ['TAX.DEV_BPS', 5000],
  ['TERRITORY_SYNDICATE_MIN', 3],
  // THE VAULT — the founder kept the vault and backed it with ETH (2026-07-31). These meter the
  // $OMR claim rail, not the backing asset, so they survived the re-denomination unchanged.
  ['TREASURY.CLAIM_MIN_OMR', 150],
  ['TREASURY.CLAIM_DAILY_OMR', 12000],
  ['TREASURY.CLAIM_WINDOW_MS', 86400000],
  // THE BUY KEEPER's walls (brokers step 5) — sized by `npm run keeper-dials`, BALANCE § THE KEEPER'S WALLS
  ['TREASURY.KEEPER_MAX_PRICE_JUMP', 2],
  ['TREASURY.KEEPER_MIN_PRICE_FRAC', 0.2],
  ['TREASURY.KEEPER_MAX_PRICE_AGE_MS', 2592000000],
  ['UNDERWORLD.DISCHARGE_PER_MIN', 150],
  ['UNDERWORLD.FX.DOC_MULT', 0.9],
  ['UNDERWORLD.FX.GUN_MULT', 0.9],
  ['UNDERWORLD.GIFT_CAP', 50],
  ['UNDERWORLD.GIFT_COST', 5000],
  ['UNDERWORLD.GIFT_STANDING', 5],
  ['UNDERWORLD.GUN_BUYBACK', 0.3],
  ['UNDERWORLD.STEP2.DECAY_FLOOR', 25],
  ['UNDERWORLD.STEP2.DECAY_GRACE_DAYS', 7],
  ['UNDERWORLD.STEP2.DECAY_PER_DAY', 1],
  ['UNDERWORLD.STEP2.LEAD_BONUS', 5],
  ['UNDERWORLD.STEP2.LEAD_MIN', 25],
  ['UNDERWORLD.STEP2.MEMORY_BPS', 2500],
  ['UNDERWORLD.STEP2.RIVAL_LOSS', 2],
  ['UNDERWORLD.STEP3.AMBUSH_ARMORER', 2],
  ['UNDERWORLD.STEP3.AMBUSH_HARBOR', 2],
  ['UNDERWORLD.STEP3.GRUDGE_LOSS', 5],
  ['UNDERWORLD.STEP3.GRUDGE_MIN', 60],
  ['UNDERWORLD.STEP4.FAVOR_WEEKLY', 1],
  ['UNDERWORLD.STEP4.GRUDGE_TIER_CAP', 2],
  ['UNDERWORLD.STEP4.PENANCE_COST', 25000],
  ['UNDERWORLD.STEP4.STREAK_BONUS_CAP', 5],
  ['UNDERWORLD.STEP5.CHAIN_BONUS', 15],
  ['UNDERWORLD.STEP5.CHAIN_STEPS', 3],
  ['UNDERWORLD.STEP5.FIX_LOSS', 5],
  ['UNDERWORLD.STEP5.GRUDGE_DECAY_DAYS', 14],
  ['WIRE.SUB_MS', 604800000],
  ['WIRE.SUB_OMR', 72],
  ['WIRE.SWEEP_OMR', 30],
  ['WIRE.TAP_MAX', 5],
  ['WIRE.TAP_MS', 43200000],
  ['WIRE.TAP_OMR', 48],
  ['WORLD.COOP_MAX_CREW', 4],
  ['WORLD.COOP_MAX_P', 0.85],
  ['WORLD.COOP_MIN', 2],
  ['WORLD.ENRAGE_DEF', 60],
  ['WORLD.FRONTIER.INVADE_BASE', 50000],
  ['WORLD.FRONTIER.INVADE_BASE_BPS', 200],   // SIGNED 2026-08-05 (Part B A12 — value-at-stake indexing, the WAR_COST_BPS twin)
  ['WORLD.FRONTIER.INVADE_OUTBID', 1.5],
  ['WORLD.FRONTIER.ROUT_GARRISON', 25000],
  ['WORLD.FRONTIER.TRIBUTE_CAP_MS', 86400000],
  ['WORLD.GRAB_BPS', 500],
  ['WORLD.GRAB_MAX', 250000],
  ['WORLD.HIRE_FEE', 75000],
  ['WORLD.HIRE_MAX', 2],
  ['WORLD.OCCUPY_BPS', 3000],
  ['WORLD.OCCUPY_MIN', 30000],
  ['WORLD.UPRISING.CHANCE', 0.28],
  ['WORLD.UPRISING.REINFORCE_MIN', 10000],
  ['WORLD.UPRISING.THRESHOLD_BPS', 300],
];

const resolve = (path) => path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), R);

// ── (1) every signed lever still holds its signed value ─────────────────────────────────────────
const drifted = [];
const missing = [];
for (const [path, want] of SIGNED) {
  const got = resolve(path);
  if (got === undefined) { missing.push(path); continue; }
  const same = Array.isArray(want)
    ? Array.isArray(got) && want.length === got.length && JSON.stringify(want) === JSON.stringify(got)
    : (want !== null && typeof want === 'object')
      ? JSON.stringify(want) === JSON.stringify(got)  // whole-map pins (bracket-accessed leaves are invisible to the reader check, so the PARENT is the pin)
      : got === want;
  if (!same) drifted.push(`${path}: signed ${JSON.stringify(want)}, code has ${JSON.stringify(got)}`);
}
assert.equal(missing.length, 0,
  `${missing.length} pinned lever(s) no longer exist in src/rules.js — a rename left a dangling pin, so `
  + `that number is now unpinned and can drift silently: ${missing.join(', ')}`);
assert.equal(drifted.length, 0,
  `${drifted.length} SIGNED lever(s) changed value without the pin being updated:\n  `
  + drifted.join('\n  ')
  + '\n  → if the retune is intended, update the value here in the same commit and record why in BALANCE.md.');
console.log(`✓ ${SIGNED.length} signed levers hold their signed values`);

// ── (2) the register is complete — a newly-signed lever cannot skip the pin ─────────────────────
// Without this the suite decays: someone signs a new number in BALANCE.md, never adds it here, and
// the "signed levers are pinned" claim quietly stops being true for everything added after today.
const docs = fs.readFileSync('BALANCE.md', 'utf8') + fs.readFileSync('SIGN-OFF.md', 'utf8');
const named = new Set([...docs.matchAll(/(?<![\w$.])([A-Z][A-Z0-9_]{3,})(?![\w$])/g)].map((x) => x[1]));
const pinnedLeaf = new Set(SIGNED.map(([p]) => p.split('.').pop()));

const scalar = (v) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string';
const unpinned = [];
const walk = (obj, path, depth) => {
  if (depth > 3 || !obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
    const p = path ? `${path}.${k}` : k;
    if (scalar(v) || (Array.isArray(v) && v.every(scalar))) {
      if (named.has(k) && !pinnedLeaf.has(k)) unpinned.push(p);
    } else if (!Array.isArray(v)) walk(v, p, depth + 1);
  }
};
for (const [name, val] of Object.entries(R)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
  if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, name, 1);
  else if (scalar(val) && named.has(name) && !pinnedLeaf.has(name)) unpinned.push(name);
}
assert.equal(unpinned.length, 0,
  `${unpinned.length} lever(s) are named in BALANCE.md/SIGN-OFF.md but pinned by nothing, so they can `
  + `be retuned with the whole suite still green: ${unpinned.join(', ')}\n`
  + '  → add each to SIGNED above with its current value.');
console.log(`✓ register complete: every lever named in BALANCE.md/SIGN-OFF.md that resolves to a value is pinned`);

// ── (3) the pins are real values, not undefined-matching-undefined ──────────────────────────────
assert(SIGNED.length >= 300, `expected 300+ signed levers, manifest has ${SIGNED.length}`);
const distinct = new Set(SIGNED.map(([p]) => p));
assert.equal(distinct.size, SIGNED.length, 'the manifest contains a duplicate path');
for (const [path, want] of SIGNED.slice(0, 5)) assert(want !== undefined, `${path} pinned to undefined`);
console.log('✓ manifest is well-formed (no duplicate paths, no undefined pins)');

console.log(`✅ THE SIGNED LEVERS test passed — ${SIGNED.length} founder-signed numbers are pinned to the `
  + 'values BALANCE.md and SIGN-OFF.md sign off on, so a retune can no longer happen silently: changing one '
  + 'now requires editing the pin in the same commit. The register is also asserted COMPLETE, so a newly '
  + 'signed lever cannot skip the pin and quietly reopen the gap, and no pin dangles at a renamed constant.');

// ── (4) EVERY PINNED LEVER IS ACTUALLY READ BY SOMETHING ────────────────────────────────────────
// Check (2) catches a pin dangling at a RENAMED constant. It cannot catch the opposite: a constant
// that exists, is pinned, is documented as a live dial — and that nothing in src/ reads. That lever
// is DECORATIVE. Retuning it changes nothing, and the pin gives false assurance that a signed number
// is under control when it is inert.
//
// FOUND BY THIS, on its first run (2026-07-29): FAMILY_YIELD.FUND_BPS, whose funding source was
// deleted by tokenomics v2 step 2 and which nothing had read since — the family yield shipped, was
// tested and audited, and paid out of a one-time drain and then nothing, forever. Plus four levers
// duplicated as magic numbers elsewhere (the 3h search timer hardcoded in combat.js, the tier-4
// capstone cost hardcoded in the skill tree, ring poker's idle timeout hardcoded as a SQL literal,
// and the weekly-favor count enforced structurally by a primary key).
//
// HOW IT READS SOURCE. Comments are stripped first — a lever "mentioned" only in prose is not wired,
// and FAMILY_YIELD.FUND_BPS was named in exactly one worker.js comment, which is what let it look
// alive. Then per file it resolves ALIASES, because the codebase routinely renames a block on import
// (`BLACK_MARKET as MARKET`) or pulls a sub-block out (`const R = SPEAKEASY.RENOWN`); without that,
// a third of the register reads as dead. A bare-identifier fallback covers destructuring, but it
// excludes rules.tail.js (declarations live there, and its helpers use dotted access anyway) and
// requires the name NOT be preceded by a dot — otherwise `EXCHANGE.FUND_BPS` answers a search for
// FAMILY_YIELD's, which is the specific false pass that hid the headline finding.
// HONEST SCOPE. This proves a lever is REFERENCED, not that it GOVERNS. A lever that is only
// published — surfaced on a board, echoed in /v1/rules — counts as read here and would pass even if
// no mechanic consulted it. Measured while mutation-testing this check: unwiring FAMILY_YIELD.FUND_BPS
// from `redeem` alone left the guard GREEN, because the board still named it; only removing every
// reference fired it. So this catches the lever nothing touches at all (which is what shipped), not
// the lever that is merely decorative-but-displayed. Tightening that means distinguishing a
// behavioural read from a display read, which needs more than a text scan.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const bodies = walkSrc('src').map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))]);

const aliasesOf = (body) => {
  const a = new Map();
  for (const m of body.matchAll(/\b(\w+)\s+as\s+(\w+)/g)) a.set(m[2], m[1]);
  for (let pass = 0; pass < 3; pass++) {           // transitive: `const T = M.TAKEOVER` after an aliased import
    for (const m of body.matchAll(/\bconst\s+(\w+)\s*=\s*([A-Z][\w.]*)\s*[;,\n]/g)) {
      const head = m[2].split('.')[0];
      a.set(m[1], (a.get(head) ?? head) + m[2].slice(head.length));
    }
    for (const m of body.matchAll(/\bconst\s*\{([^}]+)\}\s*=\s*([A-Z][\w.]*)\s*[;,\n]/g)) {
      const head = m[2].split('.')[0], full = (a.get(head) ?? head) + m[2].slice(head.length);
      for (const raw of m[1].split(',')) {
        const [k, v] = raw.split(':').map((x) => x.trim());
        if (k) a.set(v || k, `${full}.${k}`);
      }
    }
  }
  return a;
};
const files = bodies.map(([f, b]) => [f, b, aliasesOf(b)]);

const readsIn = (file, body, alias, path) => {
  const seg = path.split('.');
  // a TOP-LEVEL export is read as a bare identifier and never dotted, so the suffix loop below
  // cannot run for it at all — which silently exempted every HEIST_* lever on the first cut.
  // rules.tail.js is NOT excluded here, unlike the bare-leaf fallback below: a top-level export's
  // DECLARATION is `export const X = v`, which the `[:=]` lookahead already rules out, and its
  // helpers legitimately live beside it (`heistFenceMultOf` reads HEIST_FENCE_LO). Excluding the
  // file wholesale made that read invisible and reported a live lever as dead — a false positive in
  // the guard is as corrosive here as a false pass.
  if (seg.length === 1) return new RegExp(`(^|[^.\\w])${path}\\b(?!\\s*[:=][^=])`, 'm').test(body);
  for (let i = 0; i < seg.length - 1; i++) if (body.includes(seg.slice(i).join('.'))) return true;
  for (const [local, target] of alias) {
    if (path === target) { if (new RegExp(`(^|[^.\\w])${local}\\b`, 'm').test(body)) return true; continue; }
    if (path.startsWith(target + '.') && body.includes(local + '.' + path.slice(target.length + 1))) return true;
  }
  return false;
};

// Levers that are deliberately inert. Each needs a REASON, not just an entry — an exempt list with
// no justification is how a dead lever hides in plain sight, which is the whole failure being fixed.
const DECORATIVE = new Map([
  ['CONSTANTS.AMM_LP_BPS',              'DEAD: v2 step 2 retired the AMM — there is no pool to deepen.'],
  ['CONSTANTS.STAKE_POOL_BPS',          'DEAD: v2 step 2 — the buyback buys no $OMR, and individual staking yield is retired.'],
  ['CONSTANTS.LAUNDER_HEAT',            'DEAD: v2 step 2 retired laundering — nothing to wash.'],
  ['CONSTANTS.BUSINESS_LAUNDER_HEAT',   'DEAD: v2 step 2 — private laundering went with the public wash house.'],
  ['CONSTANTS.BUSINESS_SCRUTINY_PER_CAP', 'DEAD: scrutiny grew ONLY from laundering, so nothing writes it — no front can be raided.'],
  ['CONSTANTS.PUBLIC_WASH_CAP_DAY',     'DEAD: v2 step 2 — it capped the AMM buy side; EXCHANGE.DAILY_CAP_OMR is the live cap.'],
  ['SKILLS.CAPSTONE_COST',              'MIRROR: the field is shorthand for the hoisted `const CAPSTONE_COST`, which the TREE entries read — editing it does change every capstone cost.'],
  ['UNDERWORLD.STEP4.FAVOR_WEEKLY',     'STRUCTURAL: one favor a week is enforced by the npc_favors week primary key, not by a read.'],
]);

const unread = [];
for (const [path] of SIGNED) {
  if (DECORATIVE.has(path)) continue;
  if (!files.some(([f, b, a]) => readsIn(f, b, a, path))) unread.push(path);
}
assert.equal(unread.length, 0,
  `${unread.length} signed lever(s) are pinned but READ BY NOTHING in src/, so retuning them changes `
  + `nothing and the pin is false assurance: ${unread.join(', ')}\n`
  + '  → wire it to the code that duplicates its value, or add it to DECORATIVE above WITH A REASON.');
// and the exempt list cannot rot either: a lever listed as dead that someone later wires, or renames
// away, is itself a lie about the state of the tree.
for (const [path, why] of DECORATIVE) {
  assert(SIGNED.some(([p]) => p === path), `DECORATIVE lists ${path}, which is not a pinned lever any more`);
  assert(why.length > 20, `DECORATIVE needs a real reason for ${path}`);
  assert(!files.some(([f, b, a]) => readsIn(f, b, a, path)),
    `${path} is listed as DECORATIVE but something now READS it — delete the exemption, it is alive again`);
}
console.log(`✓ readers: all ${SIGNED.length - DECORATIVE.size} live levers are read by src/; `
  + `${DECORATIVE.size} are inert with a stated reason`);
