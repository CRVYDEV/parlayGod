// §7.1 of the spec — lazy accrual. Runs inside the caller's transaction,
// BEFORE any ⏱ action. M1: regen + bank interest. M2: racket/asset income,
// staking rewards, heat decay. M4: crew sales and Bureau raids.
import { CONSTANTS, RACKETS, levelOf, rankIdxOf, cityEventOf, dayOf,
         assetIncome, assetEnergyCap, drugOf } from './rules.js';

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
  const maxEnergy = 50 + 2 * lvl + assetEnergyCap(assets);
  const maxNerve = 10 + lvl;
  ch.energy = Math.min(maxEnergy, Number(ch.energy) + (40 + (rIdx >= 2 ? 20 : 0)) * dtMin); // Runner+ regen bump
  ch.nerve = Math.min(maxNerve, Number(ch.nerve) + 20 * (held.includes('cathedral') ? 2 : 1) * dtMin); // Cathedral Hill turf
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
  const incPerMin = (rackets.reduce((a, id) => a + racketIncome(id), 0) + assetIncome(assets))
    * (ev.racketMult || 1) * (held.includes('neon') ? 1.15 : 1)   // Neon Mile turf
    * (ch.path === 'ledger' ? 1.1 : 1) * (rIdx >= 7 ? 1.1 : 1);
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
  if (crew > 0 && stashTotal > 0) {
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
      heatAdd += d.heat * n * 0.1 * (ev.drugHeat || 1) * (ch.path === 'kitchen' ? 0.75 : 1);
      s.qty = Number(s.qty) - n;
    }
    ch.cash = Number(ch.cash) + proceeds;
    ch.trade_rep = Number(ch.trade_rep || 0) + proceeds;
    ch.heat = Number(ch.heat) + heatAdd;
    ch._crewSale = { units: moved, proceeds };            // caller ledgers the faucet
  }

  // §7.1 RAID — sustained heat past 60 draws the Bureau: one roll per accrued
  // window with P = 1 − (1−p)^minutes, p = (heat−60)/2000 per minute.
  if (Number(ch.heat) > 60 && stash.reduce((a, s) => a + Number(s.qty), 0) > 0) {
    const p = (Number(ch.heat) - 60) / 2000;
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

  // §7.1 staking rewards — real 14% APY, accrued lazily on the account row
  if (acct && Number(acct.staked) > 0) {
    const gain = Number(acct.staked) * CONSTANTS.APY / (365 * 24 * 60) * dtMin;
    acct.rewards = Number(acct.rewards) + gain;
    acct._accruedRewards = gain;
  }

  ch.last_accrued_at = now;
  return ch;
}
