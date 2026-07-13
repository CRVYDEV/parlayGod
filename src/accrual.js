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

  // bank interest: 2% per 12h, continuous approximation, income window cap
  const capped = Math.min(dtMs, CONSTANTS.OFFLINE_CAP_MS);
  ch.bank = Number(ch.bank) * (1 + CONSTANTS.BANK_RATE * (capped / CONSTANTS.BANK_PERIOD_MS));

  // §7.1 racket + front income — capped at the 8h offline window, never minted
  // without a matching ledger row (the caller records it, see game.withCharacter)
  const incPerMin = (rackets.reduce((a, id) => a + racketIncome(id), 0) + assetIncome(assets))
    * (ev.racketMult || 1) * (held.includes('neon') ? 1.15 : 1)   // Neon Mile turf
    * (ch.path === 'ledger' ? 1.1 : 1) * (rIdx >= 7 ? 1.1 : 1);
  const income = Math.floor(incPerMin * (capped / 60000));
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
