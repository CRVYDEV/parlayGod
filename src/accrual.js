// §7.1 of the spec — lazy accrual. Runs inside the caller's transaction,
// BEFORE any ⏱ action. M1: regen + bank interest. M2: racket/asset income,
// staking rewards, heat decay. M4: crew sales and Bureau raids.
import { CONSTANTS, RACKETS, LAW, levelOf, rankIdxOf, cityEventOf, dayOf,
         assetIncome, assetEnergyCap, drugOf, crewCold, envelopeActive, foundationBleedMult , seasonModOf, KITCHEN, RACKET_EMPIRE, PACING, pathFx,
         energyCapOf, nerveCapOf } from './rules.js';

const racketIncome = (id) => RACKETS.find((r) => r.id === id)?.income || 0;

// ch is the character row (mutated in place); acct is account_persistent (mutated);
// ctx carries the owned racket/asset id lists (income) and ctx.held — the district
// ids the character's gang holds (turf perks: cathedral nerve, neon income).
export function accrue(ch, acct = null, ctx = {}, now = new Date()) {
  // Make-Risk-Pay releases run on the WALL CLOCK, not the accrual delta — they sit above the
  // 1-second early return so a rapid re-touch still clears a lapsed window.
  // Fresh bank deposits clear once BANK_CLEAR_MS passes (the courier reached the vault):
  if (Number(ch.bank_intransit) > 0 && ch.bank_intransit_at
      && now - new Date(ch.bank_intransit_at) >= CONSTANTS.BANK_CLEAR_MS) {
    ch.bank_intransit = 0; ch.bank_intransit_at = null;
  }
  // Unbonded stake principal goes liquid once its window passes (a move within the same account
  // bucket — omr + staked + unbonding are all in the §10.4 sum, so no ledger row):
  if (acct && Number(acct.unbonding) > 0 && acct.unbond_at && now >= new Date(acct.unbond_at)) {
    acct.omr = Number(acct.omr) + Number(acct.unbonding);
    acct.unbonding = 0; acct.unbond_at = null;
  }

  const last = new Date(ch.last_accrued_at);
  const dtMs = Math.max(0, now - last);
  if (dtMs < 1000) return ch;
  const dtMin = dtMs / 60000;
  const lvl = levelOf(Number(ch.respect));
  const rIdx = rankIdxOf(lvl);
  const assets = ctx.assets || [];
  const rackets = ctx.rackets || [];
  const ev = cityEventOf(dayOf());

  const held = ctx.held || [];
  // THE REGIMEN — stamina/composure raise the CAPS (pool, not rate: the pacing pass's regen
  // numbers are untouched). Same helpers as view/coachOf, so the three sites cannot disagree.
  const maxEnergy = energyCapOf(lvl, assetEnergyCap(assets), ctx.disciplines);
  const maxNerve = nerveCapOf(lvl, ctx.disciplines);
  // PACING (founder-directed): energy/nerve regen is the game's master clock — at the prototype's
  // 40/min a full tank refilled in ~75 seconds, so it paced nothing and the whole progression ran
  // as fast as a player could click. Both rates now live in PACING.
  ch.energy = Math.min(maxEnergy, Number(ch.energy) + (PACING.ENERGY_REGEN_PER_MIN + (rIdx >= 2 ? PACING.ENERGY_REGEN_RANK_BONUS : 0)) * dtMin); // Runner+ regen bump
  ch.nerve = Math.min(maxNerve, Number(ch.nerve) + PACING.NERVE_REGEN_PER_MIN * (held.includes('cathedral') ? 2 : 1) * dtMin); // Cathedral Hill turf
  ch.health = Math.min(100, Number(ch.health) + 20 * dtMin);

  // bank interest: 2% per 12h, continuous approximation, income window cap.
  // The delta is surfaced so the caller ledgers it (§10.4: every faucet has a row).
  const capped = Math.min(dtMs, CONSTANTS.OFFLINE_CAP_MS);
  // Risk-to-Earn B2: meter interest by a daily token bucket (BANK_DAILY_CAP_MS/day, bursts to the
  // 8h offline window) exactly like racket income below — so a continuously-online player can't
  // compound the full ~4%/day risk-free. An offline returner still gets one full burst; only the
  // "poke an action every few minutes to bank 24h of interest a day" exploit is closed.
  const bankRefillPerMs = CONSTANTS.BANK_DAILY_CAP_MS / 86400000;
  let bankCredit = Math.min(CONSTANTS.OFFLINE_CAP_MS, Number(ch.bank_credit_ms ?? CONSTANTS.OFFLINE_CAP_MS) + dtMs * bankRefillPerMs);
  const bankEligibleMs = Math.min(capped, bankCredit);
  bankCredit -= bankEligibleMs;
  ch.bank_credit_ms = Math.round(bankCredit);
  const bankBefore = Number(ch.bank);
  // BALANCE D5 (founder override of the prototype flat rate): interest TAPERS at whale scale —
  // the full rate on the first BANK_TAPER_ABOVE, BANK_TAPER_KEEP of it beyond. The bank stops
  // being the game's only unbounded exponential; street money out-earns vault money at the top.
  const effPrincipal = Math.min(bankBefore, CONSTANTS.BANK_TAPER_ABOVE)
    + Math.max(0, bankBefore - CONSTANTS.BANK_TAPER_ABOVE) * CONSTANTS.BANK_TAPER_KEEP;
  ch.bank = bankBefore + effPrincipal * CONSTANTS.BANK_RATE * (bankEligibleMs / CONSTANTS.BANK_PERIOD_MS);
  ch._bankInterest = Number(ch.bank) - bankBefore;

  // §7.1 racket + front income — capped at the 8h offline window, never minted
  // without a matching ledger row (the caller records it, see game.withCharacter).
  //
  // D2b rolling cap: the raw §7.1 window (`capped`) still bursts to OFFLINE_CAP_MS, but
  // income is metered by a refilling token bucket of *eligible* ms (`racket_credit_ms`).
  // The bucket refills at RACKET_DAILY_CAP_MS per real day (up to an OFFLINE_CAP_MS burst)
  // and each collect spends from it — so continuous play tops out at the daily cap while a
  // returning offline player still gets one full 8h burst. Closes the pre-D2b exploit where
  // touching an action every <8h collected ~24h/day (the per-gap cap never engaged).
  const refillPerMs = CONSTANTS.RACKET_DAILY_CAP_MS / 86400000;
  const burst = CONSTANTS.OFFLINE_CAP_MS;
  let credit = Math.min(burst, Number(ch.racket_credit_ms ?? burst) + dtMs * refillPerMs);
  const eligibleMs = Math.min(capped, credit); // income-eligible time this accrual
  credit -= eligibleMs;
  ch.racket_credit_ms = Math.round(credit);
  // Tier-4 — a racket's accrual income is multiplied by its upgrade level (RACKET_EMPIRE.UP_STEP)
  const rlv = ctx.racketLevels || {};
  const incPerMin = (rackets.reduce((a, id) => a + racketIncome(id) * (1 + Math.max(0, Number(rlv[id] || 0)) * RACKET_EMPIRE.UP_STEP), 0) + assetIncome(assets))
    * (ev.racketMult || 1) * (held.includes('neon') ? 1.15 : 1)   // Neon Mile turf
    * pathFx(ch, 'racketIncome') * (rIdx >= 7 ? 1.1 : 1); // PATHS v2 — the ternary → the matrix (ledger keeps its exact 1.1)
  const income = Math.floor(incPerMin * (eligibleMs / 60000));
  ch._accruedIncome = income;                 // surfaced so the caller ledgers it
  if (income > 0) ch.cash = Number(ch.cash) + income;

  // §7.1 heat decays first, then the crew's round-the-clock work adds it back
  ch.heat = Math.max(0, Number(ch.heat || 0) - 1 * dtMin * (ev.heatDecay || 1));

  // §7.1 CREW — each member moves ~1 unit/min from the stash (income window cap),
  // cheapest lines first, at base × quality × 0.8 (demand pinned to 1.0 offline).
  // Proceeds are cash + trade_rep; every unit moved generates heat.
  const stash = ctx.stash || [];
  const cappedMin = capped / 60000;
  const crew = Number(ch.crew || 0);
  const stashTotal = stash.reduce((a, s) => a + Number(s.qty), 0);
  // recurring sinks: an unpaid crew (the nut past the cold window) DOWNS TOOLS — no offline sales
  // until the wages are covered. The stash just sits (nothing minted, nothing lost but the sales).
  if (crew > 0 && stashTotal > 0 && !crewCold(ch)) {
    let toSell = Math.min(stashTotal, Math.max(1, Math.round(crew * cappedMin)));
    let proceeds = 0, moved = 0, heatAdd = 0;
    const byPrice = [...stash].sort((a, b) => (drugOf(a.drug_id)?.base || 0) - (drugOf(b.drug_id)?.base || 0));
    for (const s of byPrice) {
      if (toSell <= 0) break;
      const d = drugOf(s.drug_id);
      if (!d || Number(s.qty) <= 0) continue;
      const n = Math.min(Number(s.qty), toSell);
      toSell -= n; moved += n;
      proceeds += Math.floor(n * d.base * Number(s.quality || 1) * 0.8);
      heatAdd += d.heat * n * 0.1 * (ev.drugHeat || 1) * pathFx(ch, 'dealHeat'); // PATHS v2 (kitchen keeps its exact 0.75)
      s.qty = Number(s.qty) - n;
    }
    ch.cash = Number(ch.cash) + proceeds;
    ch.trade_rep = Number(ch.trade_rep || 0) + proceeds;
    ch.heat = Number(ch.heat) + heatAdd;
    ch._crewSale = { units: moved, proceeds };            // caller ledgers the faucet
  }

  // §7.1 RAID — sustained heat past 60 draws the Bureau: one roll per accrued
  // window with P = 1 − (1−p)^minutes, p = (heat−60)/2000 per minute.
  // S1 (SIGN-OFF addendum): read the CLAMPED heat. The crew's own sales re-add heat inside this same
  // accrual pass, so an untouched hot stash could carry `ch.heat` past 100 and face worse odds than
  // the heat-100 ceiling implies — while the sibling Law-exposure path above deliberately clamps.
  // Player-favourable and parity-restoring: the raid can never be harsher than a maxed-out heat bar.
  const raidHeat = Math.min(100, Number(ch.heat));
  if (raidHeat > 60 && stash.reduce((a, s) => a + Number(s.qty), 0) > 0) {
    // LAB MODULE (Tier-4) — Ghost Vents cut the per-minute raid probability
    const p = ((raidHeat - 60) / 2000) * Math.max(0, 1 - Number(ch.lab_stealth || 0) * KITCHEN.MODULES.stealth.step);
    const pWindow = 1 - Math.pow(1 - p, Math.max(1, cappedMin));
    const roll = Math.random();
    if (roll < pWindow) {
      const keep = 0.30 + Math.random() * 0.30;           // stash ×= uniform(0.30, 0.60)
      let lost = 0;
      for (const s of stash) {
        const kept = Math.floor(Number(s.qty) * keep);
        lost += Number(s.qty) - kept;
        s.qty = kept;
      }
      ch.jail_until = new Date(now.getTime() + (60 + Math.floor(Math.random() * 61)) * 1000); // 60–120 s
      ch.heat = Math.max(0, Number(ch.heat) - 40);
      ch._raid = { roll, pWindow, lost, keepPct: Math.round(keep * 100) };  // caller notifies + logs
    }
  }
  ch.heat = Math.min(100, Number(ch.heat));

  // §7.1 THE LAW — the investigation meter (heat_exposure). Heat sustained above LAW.WATCH builds
  // a case lazily (the business-scrutiny precedent); a spike-and-decay costs little because the
  // meter also bleeds passively toward 0. Crackdown weather (crackdown/sweep) builds it faster; a
  // commissioner's visit / open city bleeds it (keyed on the event id — CITY_EVENTS is generated).
  // Crossing LAW.INDICT_AT files an indictment (a latch); surfaced so the caller notifies the mark.
  {
    const hv = Number(ch.heat);
    const evMult = LAW.EXPOSURE_EVENT[ev.id] ?? 1;
    // audit: the GAIN time factor is CAPPED at the offline window (like income), or a kitchen crew
    // (which re-adds heat during THIS accrual, then clamps to 100) would feed heat 100 over an entire
    // multi-day gap and instant-indict an offline dealer on login — the opposite of "active play".
    // The BLEED stays uncapped (player-favourable, no exploit — a long absence bleeds a case off).
    // THE ENVELOPE: while the standing graft is paid up the cops bury the file — the meter builds
    // at ENVELOPE_GAIN_MULT rate. Not immunity. Step two: the envelope AND the family FOUNDATION also
    // speed the BLEED (foundationBleedMult, sourced from ctx.foundationTier — the family's lawyers keep
    // every member's file thin), so both PREVENT the case, not just soften a filed one. Composed.
    const enveloped = envelopeActive(ch, now.getTime());
    // SEASONAL MODIFIER (slate #6): THE CRACKDOWN builds cases faster (composes like the envelope)
    const gain = Math.max(0, hv - LAW.WATCH) * cappedMin * LAW.EXPOSURE_RATE * evMult * (enveloped ? LAW.ENVELOPE_GAIN_MULT : 1)
      * (seasonModOf().lawGainMult || 1);
    const bleedMult = (enveloped ? LAW.ENVELOPE_BLEED_MULT : 1) * foundationBleedMult(ctx.foundationTier || 0);
    const bleed = dtMin * LAW.EXPOSURE_DECAY * bleedMult;
    ch.heat_exposure = Math.max(0, Number(ch.heat_exposure || 0) + gain - bleed);
    if (ch.heat_exposure >= LAW.INDICT_AT && !ch.indicted_at) {
      ch.indicted_at = now;
      ch._indicted = true; // caller notifies + telemeters (§10.4-free — no value moves at indictment)
    }
  }

  // §7.1 staking rewards — real 14% APY, accrued lazily on the account row
  if (acct && Number(acct.staked) > 0) {
    const gain = Number(acct.staked) * CONSTANTS.APY / (365 * 24 * 60) * dtMin;
    acct.rewards = Number(acct.rewards) + gain;
    acct._accruedRewards = gain;
  }

  ch.last_accrued_at = now;
  return ch;
}
