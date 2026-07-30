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
  ['AUCTION.CONSIGN.FEE_OMR', 2],
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
  ['BONDS.DEV_BPS', 1500],   // v2 step 3: 2000 -> 1500, the design's own number (BALANCE.md)
  ['BONDS.MAX_DISCOUNT_BPS', 2000],
  ['BONDS.POL_BPS', 3750],   // 5000 -> 3750: the remainder after the float slice, at the signed 5:3 POL:VIG
  ['BONDS.RWA_BPS', 2500],   // NEW: bond ETH's stock-float slice (design 4)
  ['BONDS.VIG_BPS', 2250],   // 3000 -> 2250: same remainder, ratio preserved rather than zeroed
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
  ['CASINO.BJ_DEALER_MIN', 17],
  ['CASINO.BJ_HIT_SOFT_17', true],
  ['CASINO.BRACKET.ADVANCE', 2],
  ['CASINO.BRACKET.ROUND_MS', 600000],
  ['CASINO.DICE_NERVE', 1],
  ['CASINO.FIGHT_BET_MIN_LVL', 5],
  ['CASINO.FIGHT_MAX', 5000],
  ['CASINO.FUTURITY.MAX_BET', 25000],
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
  ['CONSTANTS.BUSINESS_UPKEEP_CAP_MS', 604800000],
  ['CONSTANTS.BUSINESS_UPKEEP_COLD_MS', 259200000],
  ['CONSTANTS.BUSINESS_UPKEEP_PROG_BPS', 500],
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
  ['CONVOY.INSURE_PAYOUT_BPS', 5000],
  ['CONVOY.LEGEND_MIN_LVL', 10],
  ['CONVOY.MAX_AMBUSHES', 3],
  ['CONVOY.NPC.GOODS', ["gin","silk","cigars","coffee"]],
  ['CONVOY.NPC.MAX_QTY', 16],
  ['CONVOY.NPC.TARGET', 2],
  ['CONVOY.TOLL_BPS', 500],
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
  ['EXCHANGE.MIN_OMR', 1],
  ['EXCHANGE.DAILY_CAP_OMR', 250],
  ['EXCHANGE.FUND_BPS', 10000], // the WHOLE street take — with the AMM retired it has nowhere else to go
  // the migration dial — 0 means the buyback splits exactly as before; raising it moves yield from
  // individuals to families and must happen as stake:reward/dividend:omr retire, or it pays twice
  ['FAMILY_YIELD.FUND_BPS', 500],   // re-homed 2026-07-29: 0 -> 500, and it now means a share of each
                                    // WINDOW REDEMPTION. The old source (a share of the 12h buyback's
                                    // bought $OMR) was deleted by v2 step 2 and nothing ever read it.
  ['FAMILY_YIELD.SEATS', 5],
  ['FAMILY_YIELD.WEIGHTS', [5, 4, 3, 2, 1]],
  ['EMISSION.DECAY_EVERY', 180],
  ['EMISSION.EPOCH_OMR', 500],
  ['EMISSION.WAGE_CAP_OMR', 5],
  ['EMISSION.WAGE_MIN_LVL', 5],
  ['EMISSION.WAGE_MIN_SCORE', 25],
  ['ESTATE.GALA_MIN_TIER', 2],
  ['ESTATE.GALA_MS', 14400000],
  ['ESTATE.GALA_OMR', 15],
  ['ESTATE.STAFF_WALK_MS', 604800000],
  ['HEIST_FENCE_LO', 0.8],
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
  ['LAW.ENVELOPE_OMR', 15],
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
  ['M3.BODYGUARD_MIN_PRICE', 10000],
  ['M3.CASH_LOOT_RATE', 0.25],
  ['M3.CONTRACT_AMMO_REBATE', 0.5],
  ['M3.CRIME_LOUD_CASH_PREMIUM', 1],
  ['M3.DEATH_DUTY_RATE', 0.25],
  ['M3.DIRECTED_MAX_H', 24],
  ['M3.DIRECTED_MIN', 10000],
  ['M3.FIRE_HEAT', 20],
  ['M3.GEAR_LOOT_CHANCE', 0.15],
  ['M3.JUMP_STEAL_CAP', 25000],
  ['M3.NPC_HIT_TARGET_CD_MS', 86400000],
  ['M3.OMR_LOOT_RATE', 0.2],
  ['M3.SAFEHOUSE_COST', 25000],
  ['M3.SAFEHOUSE_MS', 14400000],
  ['M3.SEIZE_BASE', 30000],
  ['M3.TERRITORY_SEIZE_BPS', 5000],
  ['M3.WAR_COST', 10000],
  ['M3.WAR_KILL_POINTS', 3],
  ['M4.CREW_WAGE_CAP_MS', 604800000],
  ['M4.CREW_WAGE_COLD_MS', 259200000],
  ['M4.CREW_WAGE_PER_HR', 1200],
  ['M4.LAYLOW_CASH', 5000],
  ['M4.REF_PUSH_MAX_HOURS', 336],
  ['M4.REF_PUSH_MAX_MULT', 5],
  ['M4.REF_TIER2_CASH', 5000],
  ['M8.RESPEC_CD_MS', 86400000],
  ['M8.RESPEC_OMR', 15],
  ['MEGAPROJECT.MIN_CASH', 100],
  ['MEGAPROJECT.MIN_OMR', 1],
  ['MEGAPROJECT.OMR_RATE', 500],
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
  ['PACING.MISSION_CD_MS', 14400000],
  ['PACING.TRAIN_CD_MS', 180000],
  ['PEN.BREAK_CAUGHT_ADD_S', 900],
  ['PEN.BREAK_FAIL_DMG', [20,45]],
  ['PEN.BREAK_HEAT', 40],
  ['PEN.COOP_BASE', 0.4],
  ['PEN.COOP_MAX', 4],
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
  // JAILBIRDS — makes the SIGNED §7.8 bust:reward faucet reachable solo (bounded by the refill)
  ['POPULATION.JAILBIRDS.TARGET', 2],
  ['POPULATION.JAILBIRDS.MIN_S', 240],
  ['POPULATION.JAILBIRDS.MAX_S', 1200],
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
  // THE CALL — recycle-only transfers from the contact's own pocket (zero new faucet)
  ['CONTACTS.CALL_TTL_MS', 24 * 3600 * 1000],
  ['CONTACTS.CALL_FREIGHT_PREMIUM_BPS', 11500],
  ['CONTACTS.CALL_FREIGHT_MAX_QTY', 8],
  ['CONTACTS.VISIT_TIP', 750],
  ['CONTACTS.GEN_PER_TICK', 4],
  // THE FAVOR (Street Life step two) — the player-posted call. The escrow bounds are what keep a
  // single poster from parking the bank in un-lootable rows; the take is what makes paying an alt lossy.
  ['FAVOR.MAX_OPEN', 3],
  ['FAVOR.MIN_PAY', 500],
  ['FAVOR.MAX_PAY', 250000],
  ['FAVOR.MAX_QTY', 20],
  ['FAVOR.TTL_MS', 24 * 3600 * 1000],
  ['FAVOR.TAKE_BPS', 200],
  ['POPULATION.MARKS.CAR_P', { made: 0.6, capo: 0.8, boss: 0.9 }],
  ['POPULATION.MARKS.CAR_VAL', { made: [800, 2000], capo: [2000, 8000], boss: [5000, 20000] }],
  ['POPULATION.MARKS.FRONT_P', { made: 0.4, capo: 0.6, boss: 0.8 }],
  ['POPULATION.MARKS.FRONTS', { made: ['laundromat', 1], capo: ['laundromat', 2], boss: ['restaurant', 1] }],
  ['POPULATION.MARKS.BOAT_P', { capo: 0.35, boss: 0.6 }],
  ['POPULATION.MARKS.FRONT_INCOME_BPS', 500],
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
  ['PORTFOLIO.DIVIDEND_BPS', 1500],
  ['PORTFOLIO.DIVIDEND_DAILY_BPS', 30],
  ['PORTFOLIO.DIVIDEND_MS', 72000000],
  ['PORTFOLIO.FAMILY_DYNASTY_NAME_OMR', 15],
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
  ['SECRETS.DIG_OMR', 10],
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
  ['SKILLS.RESPEC_OMR', 10],
  ['SKILLS.RESPEC_ONE_OMR', 5],
  ['SOCIAL_GAME_URL', "https://playomerta.com"],
  ['SOCIAL_TASKS.ALL_BONUS', 500],
  ['SOCIAL_TASKS.CASH', 300],
  ['SOCIAL_X_HANDLE', "OmertaOnRH"],
  ['SOLDIERS.FIRST', ["Sal","Vinny","Rocco","Lefty","Knuckles","Ade","Paulie","Frankie","Mo","Curly","Big Tony","Little Tony","Jimmy","Sticks","Doc","Ice","Roxie","Vera","Dot","Mabel"]],
  ['SOLDIERS.INJURY_MS', 14400000],
  ['SOV.INCOME_CAP_MS', 86400000],
  ['SOV.SOV_POINTS', [0,10,25,60,120,220,400]],
  ['SPEAKEASY.INCOME_CAP_MS', 86400000],
  ['SPEAKEASY.MIN_LEVEL', 15],
  ['SPEAKEASY.NOTORIETY_DECAY_HR', 4],
  ['SPEAKEASY.RAID_THRESHOLD', 60],
  ['SPEAKEASY.RENOWN.OMR_WEIGHT', 50],
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
  ['STORE.PLEX_FLOOR_OMR_PER_ETH', 5000],
  ['STORE.PLEX_PREMIUM_BPS', 12000],
  ['TAX.DEV_BPS', 5000],
  ['TERRITORY_SYNDICATE_MIN', 3],
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
  ['WIRE.SUB_OMR', 12],
  ['WIRE.SWEEP_OMR', 5],
  ['WIRE.TAP_MAX', 5],
  ['WIRE.TAP_MS', 43200000],
  ['WIRE.TAP_OMR', 8],
  ['WORLD.COOP_MAX_CREW', 4],
  ['WORLD.COOP_MAX_P', 0.85],
  ['WORLD.ENRAGE_DEF', 60],
  ['WORLD.FRONTIER.INVADE_BASE', 50000],
  ['WORLD.FRONTIER.INVADE_OUTBID', 1.5],
  ['WORLD.FRONTIER.ROUT_GARRISON', 25000],
  ['WORLD.FRONTIER.TRIBUTE_CAP_MS', 86400000],
  ['WORLD.GRAB_BPS', 500],
  ['WORLD.GRAB_MAX', 250000],
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
