// §7.1 of the spec — lazy accrual. Runs inside the caller's transaction,
// BEFORE any ⏱ action. M1: regen + bank interest. M2 adds racket/asset income,
// staking rewards, and heat decay. Crew sales + raids land with the Kitchen (M4).
import { CONSTANTS, RACKETS, levelOf, rankIdxOf, cityEventOf, dayOf,
         assetIncome, assetEnergyCap } from './rules.js';

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

  // §7.1 heat decay (crew sales + raids arrive with the Kitchen, M4)
  ch.heat = Math.max(0, Number(ch.heat || 0) - 1 * dtMin * (ev.heatDecay || 1));

  // §7.1 staking rewards — real 14% APY, accrued lazily on the account row
  if (acct && Number(acct.staked) > 0) {
    const gain = Number(acct.staked) * CONSTANTS.APY / (365 * 24 * 60) * dtMin;
    acct.rewards = Number(acct.rewards) + gain;
    acct._accruedRewards = gain;
  }

  ch.last_accrued_at = now;
  return ch;
}
