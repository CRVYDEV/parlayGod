// What a marked man can buy — the safehouse and the bodyguard market.
//
// bodyguardAbsorbs is the shared absorb path: every lethal route (fire, npcHit, the NPC hunter)
// checks it before the estate runs, and it must stay the ONE implementation of that ordering.
//
// Split out of the 2,003-line src/social.js; every function below is byte-identical to what was
// there. Import from '../social.js' — it re-exports this package's public surface unchanged.
import { GameError, bus, ledger } from '../game.js';
import { M3, CONSTANTS, COMMISSION, HONOR, seasonModOf } from '../rules.js';
import { activeDecree } from '../commission.js';
import { isMadDog } from '../honor.js';
import { fire, npcHit } from './combat.js';
import { refundPot } from './contracts.js';
import { hospitalized, jailed, now, safeHoused } from './shared.js';

// ═══════════════════ SAFEHOUSE — EARNABLE DEFENSE (M7 Phase 4) ═══════════════════
// Pay cash to go to ground: for a window you can't be `fire`d on or NPC-hit — the in-game
// survival shield, so real-ETH revive insurance isn't the only way to weather a contract on
// your head. Jumps (non-lethal) still land. `safehouse` is a §10.4 cash sink.
export async function enterSafehouse(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No safehouse reaches into lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "You're already off the grid.");
  // Make-Risk-Pay: total immunity is priced as a share of the LIQUID WEALTH it protects —
  // max(flat floor, cash+bank × SAFEHOUSE_NW_BPS). The flat $25k was ~0.25%/day for an endgame
  // landlord (the audit's safehoused-landlord stack); a % keeps the shield real for street
  // players and expensive for whales. Paid from pocket — going to ground takes walking money.
  // SEASONAL MODIFIER (slate #6): BLOOD IN THE STREETS prices shelter up (composes like the decree).
  // The SIGNED $25k floor is re-asserted AFTER the multiplier (AUDIT-slate-drops #3): applying it
  // outside the max() meant a future sub-1 "cheap shelter" season could undercut the minimum the
  // Make-Risk-Pay pass signed. No current mod is <1, so this changes nothing today — it just makes
  // the floor un-breachable by any season we ship later.
  const cost = Math.max(M3.SAFEHOUSE_COST, Math.floor(Math.max(M3.SAFEHOUSE_COST,
    Math.floor((Number(ch.cash) + Number(ch.bank)) * CONSTANTS.SAFEHOUSE_NW_BPS / 10000))
    * (seasonModOf().safehouseMult || 1)));
  if (Number(ch.cash) < cost) throw new GameError('cash', `A safehouse runs $${cost} for a man of your means (1% of liquid wealth, $${M3.SAFEHOUSE_COST} minimum) — in pocket cash.`);
  // Commission decree: OPEN SEASON halves every stay — the knives are out this week
  const decree = await activeDecree(client);
  const ms = Math.floor(M3.SAFEHOUSE_MS * (decree?.id === 'open_season' ? COMMISSION.OPEN_SEASON_MULT : 1));
  // L3b — THE SHIELD CAP: a rolling-window token bucket on total off-grid TIME per day (the wash-cap twin),
  // so the earned survival shield can't keep a whale PERMANENTLY unreachable — the rich must surface. Charge
  // the granted stay against the bucket BEFORE spending the cash (so a capped-out player pays nothing).
  const cap = M3.SAFEHOUSE_DAILY_CAP_MS;
  if (cap > 0) {
    const refill = ch.safehouse_at ? (Date.now() - new Date(ch.safehouse_at).getTime()) / 86400000 * cap : cap;
    const used = Math.max(0, Number(ch.safehouse_used || 0) - Math.max(0, refill));
    if (used + ms > cap) {
      const leftMin = Math.max(0, Math.floor((cap - used) / 60000));
      throw new GameError('safe_cap', `You've been off the grid too long — ${leftMin} min of safehouse time left today. You have to surface. It refills over the day.`);
    }
    ch.safehouse_used = used + ms;
    ch.safehouse_at = new Date();
  }
  ch.cash = Number(ch.cash) - cost;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'safehouse' });
  ch.safe_until = new Date(Date.now() + ms);
  await h.track(client, ch.account_id, 'safehouse', { cost });
  return { ok: true, safeUntil: ch.safe_until, cost, ...(decree?.id === 'open_season' ? { openSeason: true } : {}) };
}

// ═══════════════════ BODYGUARDS — TWO-PARTY PROTECTION (M7 Phase 4) ═══════════════════
// The player-to-player defense market: a guard LISTS a price (consent-by-listing), a principal
// HIRES them for a window. While guarded, ONE lethal blow (fire or NPC hit) is absorbed — the
// guard takes the bullet (hospitalized in the principal's place) and the contract is consumed.
// The hire is a pure ledgered transfer ('bodyguard:hire' ±price) — no escrow, no §10.4 bucket:
// the guard is paid up front for the risk, saved or not. Checked BEFORE real-ETH revive
// insurance: the earnable shield burns first, the paid one stays in your pocket.

// Opt in (or out) of the protection racket: price <= 0 clears the listing.

// ═══════════════════ BODYGUARDS — TWO-PARTY PROTECTION (M7 Phase 4) ═══════════════════
// The player-to-player defense market: a guard LISTS a price (consent-by-listing), a principal
// HIRES them for a window. While guarded, ONE lethal blow (fire or NPC hit) is absorbed — the
// guard takes the bullet (hospitalized in the principal's place) and the contract is consumed.
// The hire is a pure ledgered transfer ('bodyguard:hire' ±price) — no escrow, no §10.4 bucket:
// the guard is paid up front for the risk, saved or not. Checked BEFORE real-ETH revive
// insurance: the earnable shield burns first, the paid one stays in your pocket.

// Opt in (or out) of the protection racket: price <= 0 clears the listing.
export async function offerBodyguard(ch, price, client, h) {
  const p = Math.floor(Number(price) || 0);
  if (p <= 0) { ch.guard_price = null; return { ok: true, offering: false }; }
  if (!Number.isFinite(p)) throw new GameError('price', 'Name a real number.'); // Infinity/NaN → NUMERIC write 500
  if (p < M3.BODYGUARD_MIN_PRICE) throw new GameError('min', `Nobody stands in front of a bullet for less than $${M3.BODYGUARD_MIN_PRICE}.`);
  ch.guard_price = p;
  return { ok: true, offering: true, price: p };
}

// Two-party (withTwoCharacters): `guard` arrives locked as the second row.

// Two-party (withTwoCharacters): `guard` arrives locked as the second row.
export async function hireBodyguard(ch, guard, client, h) {
  const price = guard.guard_price != null ? Math.floor(Number(guard.guard_price)) : 0;
  if (!(price > 0)) throw new GameError('not_offering', "They're not in the protection business.");
  // FIVE PILLARS #1: nobody takes a bullet for a MAD DOG — infamy shuts the protection market
  // (a new lever off every signed surface; the Fable "your legend precedes you" tooth).
  if (isMadDog(ch)) throw new GameError('mad_dog', 'No guard alive steps in front of a mad dog. Earn some honor first.');
  if (ch.guarded_by && ch.guarded_until && new Date(ch.guarded_until) > new Date())
    throw new GameError('guarded', 'You already have a shadow. One bullet-catcher at a time.');
  if (jailed(guard) || hospitalized(guard)) throw new GameError('unavailable', "They can't watch your back from where they are.");
  if (Number(ch.cash) < price) throw new GameError('cash', `Their rate is $${price}.`);
  // the standard 2% house take (1% dev off-ledger + 1% street tax → buyback), at parity with the
  // exchange and the AMM — an untaxed unlimited P2P transfer was the cheapest value pipe in the
  // game (alt consolidation / referral net-worth pumping at 0%, audit F5). The guard nets 98%.
  const fee = Math.ceil(price * 0.01), tax = Math.ceil(price * 0.01);
  const net = price - fee - tax;
  ch.cash = Number(ch.cash) - price;
  guard.cash = Number(guard.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'bodyguard:hire', counterparty: guard.id });
  await h.ledger(client, { characterId: guard.id, currency: 'cash', amount: net, reason: 'bodyguard:hire', counterparty: ch.id });
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
  ch.guarded_by = guard.id;
  ch.guarded_until = new Date(Date.now() + M3.BODYGUARD_MS);
  await h.notify(client, guard.id, 'bodyguard_hired', { by: ch.name, price, hours: M3.BODYGUARD_MS / 3600000 });
  await h.track(client, ch.account_id, 'bodyguard_hire', { guard: guard.id, price });
  return { ok: true, guard: guard.id, price, until: ch.guarded_until };
}

// The absorb: called at the top of every lethal kill branch. Returns the guard ({name}) if the
// bullet was taken, else null. The guard is a THIRD character — a plain relative UPDATE (the
// same discipline as refundPot's funder credits: no in-memory copy exists, so nothing clobbers).
// No ledger rows — health and hospital time aren't currency; §10.4 is untouched.
// `attacker` is the shooter (fire) or the paying client (npcHit): if the victim's own guard is
// behind the attempt, they simply step aside — the bodyguard turning on you is the oldest move
// in the book, and it means the contract was never protection at all.

// The absorb: called at the top of every lethal kill branch. Returns the guard ({name}) if the
// bullet was taken, else null. The guard is a THIRD character — a plain relative UPDATE (the
// same discipline as refundPot's funder credits: no in-memory copy exists, so nothing clobbers).
// No ledger rows — health and hospital time aren't currency; §10.4 is untouched.
// `attacker` is the shooter (fire) or the paying client (npcHit): if the victim's own guard is
// behind the attempt, they simply step aside — the bodyguard turning on you is the oldest move
// in the book, and it means the contract was never protection at all.
export async function bodyguardAbsorbs(client, h, attacker, victim) {
  if (!victim.guarded_by || !victim.guarded_until || new Date(victim.guarded_until) <= new Date()) return null;
  if (victim.guarded_by === attacker.id) return null; // the betrayal
  // (red-team R11) The guard is a THIRD character (never a locked party — not the attacker by the
  // betrayal check, not the victim who can't self-guard), and it was READ here UNLOCKED then written —
  // so a guard shared across principals could absorb N simultaneous cross-victim hits for a SINGLE
  // hospitalization (both concurrent hits saw them un-hospitalized before either committed). Claim the
  // guard ATOMICALLY instead: the conditional UPDATE takes the guard row lock (the same lock the final
  // write already took — no NEW lock/cycle) and its WHERE lets exactly ONE concurrent absorb win (the
  // second blocks on the row, re-reads hosp_until in the future → no match → no absorb). Clobber-safe:
  // no in-memory copy of the guard exists, so direct SQL is the record of truth (the refundPot rule).
  const g = (await client.query(
    `UPDATE characters SET health=10, hosp_until=$2,
            honor = LEAST(${HONOR.MAX}, honor + ${HONOR.BODYGUARD_SAVE}) -- #1: taking the bullet is the honorable deed (set-based, NUMERIC-safe, same guarded write)
      WHERE id=$1 AND alive
       AND (hosp_until IS NULL OR hosp_until <= now()) AND (jail_until IS NULL OR jail_until <= now())
     RETURNING id, name`,
    [victim.guarded_by, new Date(Date.now() + M3.BODYGUARD_HOSP_MS)])).rows[0];
  if (!g) return null; // guard gone/jailed/or already took a bullet this instant — nobody between you and it
  victim.guarded_by = null; victim.guarded_until = null; // one bullet per contract
  await h.notify(client, g.id, 'took_bullet', { for: victim.name });
  await h.notify(client, victim.id, 'guard_saved_you', { guard: g.name });
  await h.track(client, victim.account_id, 'bodyguard_absorb', { guard: g.id });
  bus.emit('streets', { type: 'bodyguard', guard: g.name, saved: victim.name });
  return { name: g.name };
}

// ═══════════════════ NPC HITMEN FOR HIRE (M7 Phase 3) ═══════════════════
// Pay cash to a contractor for a ROLLED attempt on a target — the mechanic that lets a weak
// player buy a CHANCE at a strong one, and a ledgered wealth SINK. The fee burns win or lose
// (`npchit:hire`), the payer takes law heat + a cooldown, and it pays ZERO rep (no player
// killer). On a landed hit the estate runs (no chop/bounty — nobody fulfilled a contract);
// pre-paid revive insurance absorbs it exactly like a player hit.
