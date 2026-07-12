// §7.1 of the spec — lazy accrual. Runs inside the caller's transaction,
// BEFORE any ⏱ action. M1 scope: regen + bank interest (rackets land in M2).
import { CONSTANTS, levelOf } from './rules.js';

export function accrue(ch, now = new Date()) {
  const last = new Date(ch.last_accrued_at);
  const dtMs = Math.max(0, now - last);
  if (dtMs < 1000) return ch;
  const dtMin = dtMs / 60000;
  const lvl = levelOf(Number(ch.respect));
  const maxEnergy = 50 + 2 * lvl;            // + assetEnergyCap in M2
  const maxNerve = 10 + lvl;
  const rIdx = lvl >= 22 ? 1 : 0;            // Runner+ energy regen bump (simplified rank check M1)
  ch.energy = Math.min(maxEnergy, Number(ch.energy) + (40 + rIdx * 20) * dtMin);
  ch.nerve = Math.min(maxNerve, Number(ch.nerve) + 20 * dtMin);
  ch.health = Math.min(100, Number(ch.health) + 20 * dtMin);
  // bank interest: 2% per 12h, continuous approximation, offline cap
  const capped = Math.min(dtMs, CONSTANTS.OFFLINE_CAP_MS);
  ch.bank = Number(ch.bank) * (1 + CONSTANTS.BANK_RATE * (capped / CONSTANTS.BANK_PERIOD_MS));
  ch.last_accrued_at = now;
  return ch;
}
