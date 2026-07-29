// Business Empire — the PREMIUM, acquired-later personal front layer. Distinct from the flat
// mid-game ASSETS/RACKETS (buy-once, drip-forever): these are level-gated, UPGRADEABLE venues
// (laundromat → casino) that farm pocket cash AND double as your PRIVATE money-laundering
// infrastructure — the endgame engine of the Risk-to-Earn loop. Per-INSTANCE state lives in the
// `businesses` table (one row per owned front). Income accrues lazily, capped at BUSINESS_CAP_MS,
// and is collected on demand → pocket cash (the territory-racket pattern). §10.4: `business:income`
// is a cash FAUCET, `business:buy`/`business:upgrade` cash SINKS — all carry the character_id, so
// the per-character cash check reconciles them automatically. Laundering rides the existing
// `swap:buy` ledger (no new reason). Step-two scrutiny/raid/extortion risk is deferred by design.
import crypto from 'node:crypto';
import { GameError, bus, skillMult, trunkCap, bumpMastery } from './game.js';
import { CONSTANTS, M3, CASINO, BUSINESSES, SKILLS, BUSINESS_EMPIRE, businessOf, businessTierOf, businessMaxTier,
  businessAssessedValue, launderRankOf, levelOf, effStat } from './rules.js';
import { denAvailable, denDistribute } from './casino.js';
import { spendOmr } from './vanity.js';

const uid = () => crypto.randomUUID();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// accrued income for one business up to the cap, in whole dollars (exported for the heist
// INSIDE JOB, which redirects the same bounded pending-income bucket — the shakedown argument)
export function accrued(row) {
  const tier = businessTierOf(row.kind, row.tier);
  if (!tier) return 0;
  const elapsed = Math.min(Date.now() - new Date(row.last_collect_at).getTime(), CONSTANTS.BUSINESS_CAP_MS);
  return Math.floor(tier.incomePerHr * Math.max(0, elapsed) / 3600000);
}

// L1b — THE PROGRESSIVE PAD: the upkeep rate climbs with the SIZE of the empire (BUSINESS_UPKEEP_PROG_BPS
// per front beyond the first) — a 5-front stack pays 40% pad vs a 1-front's 20%, bounding the passive
// stack without touching the on-ramp. `count` is the owner's total front count (defaults to 1 = the base
// 20% rate, so any legacy call is unchanged).
export const upkeepBps = (count = 1) =>
  CONSTANTS.BUSINESS_UPKEEP_BPS + CONSTANTS.BUSINESS_UPKEEP_PROG_BPS * Math.max(0, count - 1);

// RECURRING SINKS ("the pad"): upkeep owed on one front, in whole dollars — upkeepBps(count) of
// the tier's income per hour, accrued on its OWN clock (upkeep_at) up to BUSINESS_UPKEEP_CAP_MS.
// Distinct from the 24h income cap: an absent owner owes up to a week while earning at most a day.
export function upkeepOwed(row, count = 1, now = Date.now()) {
  const tier = businessTierOf(row.kind, row.tier);
  if (!tier) return 0;
  const elapsed = Math.min(now - new Date(row.upkeep_at).getTime(), CONSTANTS.BUSINESS_UPKEEP_CAP_MS);
  return Math.floor(tier.incomePerHr * (upkeepBps(count) / 10000) * Math.max(0, elapsed) / 3600000);
}
// a front whose pad has gone unpaid past the cold window produces nothing until squared
export const isCold = (row, now = Date.now()) =>
  now - new Date(row.upkeep_at).getTime() >= CONSTANTS.BUSINESS_UPKEEP_COLD_MS;

// The 1% street tax on the house-take feeds the 12h buyback (spec §7.12); mirrors economy.js.
async function takeHouse(client, tax) {
  if (tax > 0) await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]);
}

// ── step two: the RISK layer — scrutiny + Bureau raids (lazy, the §7.1 kitchen-raid pattern) ──
// Only LAUNDERING draws scrutiny onto a front; it decays hourly. Income-only fronts never get
// raided — their risk is rival shakedowns (PvP), so PvE risk tracks extraction, PvP tracks wealth.
// FRONT SPECIALIZATION (Tier-4): THE FIXER cools scrutiny 2× as fast (decayMult) — read off the row.
const specDecayMult = (row) => (row.spec && BUSINESS_EMPIRE.SPECS[row.spec]?.decayMult) || 1;
export function decayedScrutiny(row, now = Date.now()) {
  const hrs = Math.max(0, now - new Date(row.scrutiny_at).getTime()) / 3600000;
  return Math.max(0, Number(row.scrutiny) - hrs * CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR * specDecayMult(row));
}

// Resolve the elapsed window on one (locked) business row: decay scrutiny, and if the front sat
// ABOVE the raid threshold for part of that window, roll one raid over those minutes. A raid
// seizes ALL pending uncollected income (clock reset — it was never minted, so no ledger row;
// the territory-seizure precedent) and levies a fine of FINE_RATE × the current tier's cost,
// clamped to pocket cash (`business:raid`, a §10.4 cash sink), then the heat's off (scrutiny 0).
// `BUSINESS_RAID_P` env overrides the per-minute p for deterministic tests (GEAR_LOOT_CHANCE
// precedent — never set it in production). Mutates `row` in memory so callers see fresh state.
async function resolveScrutiny(ch, row, client, h) {
  const now = Date.now();
  const scr0 = Number(row.scrutiny);
  const elapsedHrs = Math.max(0, now - new Date(row.scrutiny_at).getTime()) / 3600000;
  const scr = Math.max(0, scr0 - elapsedHrs * CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR * specDecayMult(row)); // THE FIXER cools 2×
  if (scr0 >= CONSTANTS.BUSINESS_RAID_THRESHOLD) {
    // roll over the minutes the front actually SAT above the threshold this window — it may have
    // cooled below since the last touch, but the hot stretch still gets its roll. The exponent is
    // the UNFLOORED minute count (capped at 24h): flooring let a 2-minute touch cadence count only
    // 1 minute per 2 elapsed, halving cumulative raid probability (audit MED-2) — with the real
    // number, N touches over T minutes total exactly 1−(1−p)^T however you pace them.
    const hrsAbove = Math.min(elapsedHrs, (scr0 - CONSTANTS.BUSINESS_RAID_THRESHOLD) / CONSTANTS.BUSINESS_SCRUTINY_DECAY_HR);
    const minAbove = Math.min(1440, hrsAbove * 60);
    const p = Number(process.env.BUSINESS_RAID_P ?? CONSTANTS.BUSINESS_RAID_P_PER_MIN);
    const pWindow = 1 - Math.pow(1 - p, minAbove);
    const roll = Math.random();
    if (roll < pWindow) {
      const seized = accrued(row);
      const tier = businessTierOf(row.kind, row.tier);
      // the fine reaches the BANK once the pocket is empty (audit F7: raids were trivially dodged
      // by banking before touching a hot front — the §10.4 character-cash check covers cash+bank,
      // so the single ledger row stays exact)
      // THE FIXER (spec) halves the raid fine (fineMult) — a defensive risk-shaper, not a faucet
      const fineMult = (row.spec && BUSINESS_EMPIRE.SPECS[row.spec]?.fineMult) || 1;
      const fine = Math.min(Math.floor(tier.cost * CONSTANTS.BUSINESS_RAID_FINE_RATE * fineMult),
        Math.max(0, Math.floor(Number(ch.cash) + Number(ch.bank))));
      const fromPocket = Math.min(fine, Math.max(0, Math.floor(Number(ch.cash))));
      ch.cash = Number(ch.cash) - fromPocket;
      ch.bank = Number(ch.bank) - (fine - fromPocket);
      row.scrutiny = 0; row.scrutiny_at = new Date(now); row.last_collect_at = new Date(now);
      await client.query('UPDATE businesses SET scrutiny=0, scrutiny_at=now(), last_collect_at=now() WHERE id=$1', [row.id]);
      if (fine > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fine, reason: 'business:raid' });
      await h.rngLog(client, ch.id, `business:raid:${row.kind}`, roll, `raided (P ${pWindow.toFixed(4)}, seized $${seized}, fined $${fine})`);
      await h.notify(client, ch.id, 'business_raid', { kind: row.kind, seized, fine });
      await h.track(client, ch.account_id, 'business_raid', { kind: row.kind, tier: Number(row.tier), seized, fine });
      return { raided: true, kind: row.kind, seized, fine };
    }
  }
  row.scrutiny = scr; row.scrutiny_at = new Date(now);
  await client.query('UPDATE businesses SET scrutiny=$2, scrutiny_at=now() WHERE id=$1', [row.id, scr]);
  return { raided: false };
}

// Buy a tier-1 front (one per kind per character). Level-gated ("acquired later"). Pocket cash pays.
export async function buyBusiness(ch, kind, client, h) {
  const cat = businessOf(kind);
  if (!cat) throw new GameError('bad_business', 'No such business.');
  if (levelOf(Number(ch.respect)) < cat.lvl) throw new GameError('level', `The ${cat.name} opens up at level ${cat.lvl}.`);
  const existing = (await client.query('SELECT id FROM businesses WHERE character_id=$1 AND kind=$2', [ch.id, kind])).rows[0];
  if (existing) throw new GameError('exists', `You already run a ${cat.name} — upgrade it instead.`);
  const tier = cat.tiers[0];
  if (Number(ch.cash) < tier.cost) throw new GameError('cash', `The ${cat.name} costs $${tier.cost} to set up.`);
  ch.cash = Number(ch.cash) - tier.cost;
  const id = uid();
  await client.query('INSERT INTO businesses (id, character_id, kind, tier) VALUES ($1,$2,$3,1)', [id, ch.id, kind]);
  // Den rakeback (casino kind): the cursor starts at TODAY's den volume — a new owner earns
  // against future action, not history
  if (kind === 'casino') {
    const vol = (await client.query('SELECT total FROM den_volume WHERE id=1')).rows[0];
    await client.query('UPDATE businesses SET rake_cursor=$2 WHERE id=$1', [id, Number(vol?.total || 0)]);
  }
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -tier.cost, reason: 'business:buy' });
  h.owned.businesses = await businessesOf(client, ch.id); // keep the returned view fresh
  return { ok: true, id, kind, name: cat.name, tier: 1 };
}

// Collect the accrued income from EVERY front you own → pocket cash (lazy, capped, clock reset).
// Each row resolves its scrutiny window first — a raided front's pending is seized, not banked.
export async function collectBusiness(ch, client, h) {
  // BALANCE D2 — shield, not bunker: collecting the take is an EXPOSED act (you show up at your
  // own fronts). Income keeps accruing while you hide; you just can't bank it from the bunker.
  if (safeHoused(ch)) throw new GameError('safe', "Nobody hands the take to a ghost — collection waits until you surface.");
  const rows = (await client.query('SELECT * FROM businesses WHERE character_id=$1 FOR UPDATE', [ch.id])).rows;
  let total = 0, rakeback = 0; const raids = [];
  let cold = 0;
  for (const r of rows) {
    const res = await resolveScrutiny(ch, r, client, h);
    if (res.raided) { raids.push(res); continue; }
    // recurring sinks: a front whose pad went unpaid past the cold window produces nothing until
    // squared — its income clock stays put (the withheld take is lost to the 24h cap, not banked).
    if (isCold(r)) { cold++; continue; }
    const inc = accrued(r);
    if (inc > 0) { total += inc; await client.query('UPDATE businesses SET last_collect_at=now() WHERE id=$1', [r.id]); }
    // Den RAKEBACK (casino kind): owners split RAKEBACK_BPS of the den's stake volume since their
    // cursor — the split is by the CURRENT owner count, so total rakeback per unit of volume is
    // bounded by RAKEBACK_BPS however many fronts exist. A raided casino forfeits with the rest.
    if (r.kind === 'casino') {
      const vol = Number((await client.query('SELECT total FROM den_volume WHERE id=1')).rows[0]?.total || 0);
      const owners = Number((await client.query("SELECT COUNT(*) n FROM businesses WHERE kind='casino'")).rows[0].n) || 1;
      const share = Math.floor(Math.max(0, vol - Number(r.rake_cursor)) * (CASINO.RAKEBACK_BPS || 0) / 10000 / owners);
      // econ pass (mint-on-top fix): rakeback pays only out of the den's REALIZED profit net of open
      // liabilities — all-or-nothing per collect: when the house is under water the cursor doesn't
      // advance, so the owner's claim simply waits for the book to recover (nothing is forfeited).
      if (share > 0 && (await denAvailable(client)) >= share) {
        rakeback += share;
        await denDistribute(client, share);
        await client.query('UPDATE businesses SET rake_cursor=$2 WHERE id=$1', [r.id, vol]);
      }
    }
  }
  if (total > 0) {
    ch.cash = Number(ch.cash) + total;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: total, reason: 'business:income' });
    // TYCOON fold-in (Tier-4): business income counts toward the account-level tycoon_earned legend
    // (the comment gap the code never closed). Direct SQL, own account, OFF persistAccount → clobber-safe;
    // this is on-demand collect income, distinct from ch._accruedIncome — no double-count.
    await client.query('UPDATE account_persistent SET tycoon_earned = tycoon_earned + $1 WHERE account_id=$2', [total, ch.account_id]);
  }
  if (rakeback > 0) {
    ch.cash = Number(ch.cash) + rakeback;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: rakeback, reason: 'casino:rakeback' });
  }
  if (total <= 0 && rakeback <= 0 && !raids.length && !cold) return { ok: true, collected: 0 };
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, collected: total, businesses: rows.length,
    ...(rakeback > 0 ? { rakeback } : {}), ...(raids.length ? { raids } : {}),
    ...(cold ? { cold } : {}) };
}

// PAY THE PAD (recurring sinks) — settle the upkeep owed on every front you can afford (greedy,
// so a cash-strapped owner can reactivate what matters most first). A §10.4 cash sink
// `business:upkeep` per front (rides the `business:` vocabulary — no invariant change);
// paying resets that front's upkeep clock and thaws a cold one. Blocked from a safehouse only
// insofar as it's just spending — no gate needed (paying protection isn't extraction or offense).
export async function payBusinessUpkeep(ch, client, h) {
  const rows = (await client.query('SELECT * FROM businesses WHERE character_id=$1 FOR UPDATE', [ch.id])).rows;
  if (!rows.length) throw new GameError('none', 'You run no fronts — no pad to pay.');
  let paid = 0; const settled = []; let stillOwed = 0;
  for (const r of rows) {
    const owed = upkeepOwed(r, rows.length); // L1b: the pad rate scales with the empire's front count
    if (owed <= 0) continue;
    if (Number(ch.cash) >= owed) {
      ch.cash = Number(ch.cash) - owed;
      paid += owed;
      await client.query('UPDATE businesses SET upkeep_at=now() WHERE id=$1', [r.id]);
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -owed, reason: 'business:upkeep' });
      settled.push({ kind: r.kind, paid: owed });
    } else stillOwed += owed; // couldn't cover this one — it stays owed (and cold if past the window)
  }
  if (paid <= 0 && stillOwed <= 0) return { ok: true, paid: 0, message: 'The pad is square.' };
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, paid, fronts: settled, ...(stillOwed > 0 ? { stillOwed } : {}) };
}

// Upgrade a front to the next tier — collects the pending income at the OLD rate first (so an
// upgrade never wipes uncollected earnings), then pays the next tier's cost and resets the clock.
export async function upgradeBusiness(ch, businessId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "You can't run the books from a cell.");
  // (red-team R3, D2 parity) upgrading BANKS the pending income at line ~217 — the same income-realizing
  // act collectBusiness gates. A safehoused (untargetable) player must not run their economy from the bunker.
  if (safeHoused(ch)) throw new GameError('safe', "Nobody hands the take to a ghost — the books wait until you surface.");
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 AND character_id=$2 FOR UPDATE', [businessId, ch.id])).rows[0];
  if (!r) throw new GameError('not_yours', "That's not your business.");
  const cat = businessOf(r.kind);
  const next = businessTierOf(r.kind, Number(r.tier) + 1);
  if (!next) throw new GameError('maxed', `Your ${cat.name} already runs at full strength.`);
  if (isCold(r)) throw new GameError('cold', `The ${cat.name} is dark — pay the pad before you pour money into it.`);
  const raid = await resolveScrutiny(ch, r, client, h); // a raid seizes the pending before it banks
  const pending = raid.raided ? 0 : accrued(r);
  if (Number(ch.cash) + pending < next.cost) throw new GameError('cash', `Upgrading the ${cat.name} costs $${next.cost}.`);
  // bank the pending at the old rate, then debit the upgrade — net in one cash figure. The upgrade
  // also squares the pad (upkeep_at=now): a fresh clock at the new rate, no retroactive rate bump.
  ch.cash = Number(ch.cash) + pending - next.cost;
  await client.query('UPDATE businesses SET tier=$2, last_collect_at=now(), upkeep_at=now() WHERE id=$1', [businessId, next.tier]);
  if (pending > 0) await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pending, reason: 'business:income' });
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -next.cost, reason: 'business:upgrade' });
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, id: businessId, kind: r.kind, name: cat.name, tier: next.tier, collected: pending,
    ...(raid.raided ? { raid } : {}) };
}

// PRIVATE laundering — RETIRED (tokenomics v2 step 2). Cash no longer converts to $OMR by any
// route, so there is nothing left to wash into. This was the Business Empire's SECOND value
// proposition (fronts farmed cash AND were private laundering infrastructure at a lower heat than
// the street); losing it is real content coming out, and the design accepts that deliberately
// rather than pretending the change is free.
//
// KNOCK-ON, flagged rather than papered over: front SCRUTINY came only from laundering — an
// income-only front was already explicitly never raided ("their risk is PvP"). With the wash gone
// every front is income-only, so the Bureau-raid layer built in Business Empire step two is still
// present and simply never fires. That is coherent and invents nothing, so it is what ships, but
// it means personal fronts now carry NO PvE risk at all — only shakedown, takeover and the
// Sacking. Giving scrutiny a new feed (income volume is the obvious one) would be new content, so
// it is a founder call, recorded in the design doc's §7.2.
//
// The route stays mounted and answers with this rather than 404ing (the retired-swap precedent),
// and `launder_used`/`launder_at` stay on the row: they are harmless, and dropping columns from a
// live table is a migration this change does not need to take on.
export async function launderAtBusiness() {
  throw new GameError('retired',
    'Nothing to wash any more — cash and $OMR no longer trade. Your fronts still earn; $OMR is redeemed for cash at the Exchange window.');
}

// ── step two: SHAKEDOWN — the PvP risk on passive income (runs under withTwoCharacters) ──
// A rival extorts a front for SHAKEDOWN_RATE of its PENDING income in a muscle/cunning contest.
// The cut is the same bounded income faucet as a collect (`business:shakedown`, character_id =
// the attacker), just redirected — total income per front stays bounded by incomePerHr either
// way; the owner keeps the rest pending (the clock advances by only the stolen share). Per-venue
// cooldown protects the front from spam; heat lands on the attacker win or lose (extortion is
// exposure); family is off-limits; a safehouse blocks offense (P1.3), never defense here — the
// venue is a street address, not the man.
export async function shakedownBusiness(ch, victim, businessId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No street work from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't run extortion while you're to ground — a safehouse is a shield, not a bunker.");
  if (hospitalized(ch)) throw new GameError('hosp_self', 'No leaning on anyone from a hospital bed.');
  if (Number(ch.health) < M3.JUMP_MIN_HEALTH) throw new GameError('health', "You're in no shape to lean on anyone.");
  if (Number(ch.energy) < CONSTANTS.SHAKEDOWN_ENERGY) throw new GameError('energy', `Need ${CONSTANTS.SHAKEDOWN_ENERGY} energy to lean on a front.`);
  if (hospitalized(victim)) throw new GameError('hosp', "They're under the Doc's care. Even we have rules.");
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])).rows[0];
  if (!r || r.character_id !== victim.id) throw new GameError('bad_business', 'No such front on them.');
  if (r.shakedown_at && Date.now() - new Date(r.shakedown_at).getTime() < CONSTANTS.SHAKEDOWN_CD_MS)
    throw new GameError('cooldown', 'That front just had a visit — let the dust settle.');
  ch.energy = Number(ch.energy) - CONSTANTS.SHAKEDOWN_ENERGY;
  ch.heat = Math.min(100, Number(ch.heat || 0) + CONSTANTS.SHAKEDOWN_HEAT); // extortion is exposure, win or lose (clamp 100, audit LOW-2)
  await client.query('UPDATE businesses SET shakedown_at=now() WHERE id=$1', [businessId]);

  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const vEff = (s) => effStat(victim[s], s, h.victimOwned.assets, h.victimOwned.gear);
  // BRUISER (skills): the enforcer leans harder — a new modifier, sign-off lever
  const atk = (eff('muscle') + eff('cunning') * 0.5) * skillMult(h, 'bruiser', SKILLS.FX.BRUISER_MULT) * skillMult(h, 'made_man', SKILLS.FX.MADE_MAN_MULT) + Math.random() * 25;
  const def = vEff('muscle') + vEff('cunning') * 0.5 + Math.random() * 25;
  await h.rngLog(client, ch.id, `shakedown:${victim.id}`, Math.round(atk * 100) / 100, atk > def ? 'win' : 'loss');

  if (atk > def) {
    const pending = accrued(r);
    const cut = Math.floor(pending * CONSTANTS.SHAKEDOWN_RATE);
    // advance the clock by only the STOLEN share — the owner keeps the rest pending
    const elapsed = Math.min(Date.now() - new Date(r.last_collect_at).getTime(), CONSTANTS.BUSINESS_CAP_MS);
    await client.query('UPDATE businesses SET last_collect_at=$2 WHERE id=$1',
      [businessId, new Date(Date.now() - Math.floor(Math.max(0, elapsed) * (1 - CONSTANTS.SHAKEDOWN_RATE)))]);
    if (cut > 0) {
      ch.cash = Number(ch.cash) + cut;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cut, reason: 'business:shakedown', counterparty: victim.id });
    }
    await h.notify(client, victim.id, 'shakedown', { from: ch.name, kind: r.kind, cut });
    await bumpMastery(client, h, ch, 'muscle', 'shakedown'); // THE TRADES — extortion is the protection craft
    bus.emit('streets', { type: 'shakedown', by: ch.name, on: victim.name, kind: r.kind });
    return { ok: true, win: true, kind: r.kind, cut };
  }
  // the front's security saw you off
  ch.health = Math.max(1, Number(ch.health) - rand(10, 25));
  await h.notify(client, victim.id, 'shakedown_failed', { from: ch.name, kind: r.kind });
  return { ok: true, win: false, kind: r.kind, cut: 0 };
}

// ── Tier-4: FRONT SPECIALIZATION — a MAX-TIER front can be given ONE build-identity spec for a $OMR
// burn (deflationary sink). Three defensive/risk-shaping branches (NOT a faucet — income + launder
// throughput untouched). Re-specializing overwrites (a fresh $OMR burn). §10.4: `business:spec` omr burn. ──
export async function specializeBusiness(ch, businessId, spec, client, h) {
  if (!BUSINESS_EMPIRE.SPECS[spec]) throw new GameError('bad_spec', 'Pick The Fortress.');
  // (tokenomics v2 step 2) THE ACCOUNTANT (scrutiny ×0.5) and THE FIXER (raid fine ×0.5, scrutiny
  // decay ×2) both act only on the Bureau-raid layer, and that layer's only feed was laundering.
  // With the wash retired they buy NOTHING — and they cost real $OMR, so leaving them on the shelf
  // would be selling a dead effect. Refused rather than silently inert; THE FORTRESS (+40 defence
  // against a hostile takeover) is untouched because takeovers still happen.
  if (spec === 'accountant' || spec === 'fixer') {
    throw new GameError('retired',
      `${BUSINESS_EMPIRE.SPECS[spec].name} worked the Bureau, and the Bureau has nothing on your books now that cash can't be washed. Take The Fortress.`);
  }
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 AND character_id=$2 FOR UPDATE', [businessId, ch.id])).rows[0];
  if (!r) throw new GameError('not_yours', "That's not your business.");
  if (Number(r.tier) < businessMaxTier(r.kind)) throw new GameError('not_maxed', 'Only a fully-built front can specialize — max the tier first.');
  await spendOmr(client, h, BUSINESS_EMPIRE.SPEC_OMR, 'business:spec'); // throws 'omr' if short
  await client.query('UPDATE businesses SET spec=$2, spec_at=now() WHERE id=$1', [businessId, spec]);
  h.owned.businesses = await businessesOf(client, ch.id);
  return { ok: true, kind: r.kind, spec, name: BUSINESS_EMPIRE.SPECS[spec].name, spent: BUSINESS_EMPIRE.SPEC_OMR };
}

// reset ALL mutable front state on a change of hands — a seized/bought front is never born hot/cold/
// pending-full/specialized (the speakeasy resetClubToNewOwner precedent). takeover_cd_until is set by the
// caller BEFORE this (win OR lose) and is deliberately NOT reset here so it survives the handover.
async function resetFrontToNewOwner(client, businessId, newOwnerId) {
  // (red-team) Den rakeback: the cursor moves to TODAY's volume on a change of hands — the SAME rule
  // buyBusiness states ("a new owner earns against future action, not history"). Leaving it at 0 handed
  // the new owner a claim on the ENTIRE lifetime den volume: not a mint (denAvailable caps every payout
  // at realized profit) but a queue-jump that drains the shared, profit-bounded rakeback pool at the
  // expense of every honest casino-front owner, whose claims then wait for the book to recover.
  const vol = Number((await client.query('SELECT total FROM den_volume WHERE id=1')).rows[0]?.total || 0);
  await client.query(
    `UPDATE businesses SET character_id=$2, tier=tier, spec=NULL, spec_at=NULL, scrutiny=0, scrutiny_at=now(),
       last_collect_at=now(), launder_used=0, launder_at=now(), upkeep_at=now(), shakedown_at=NULL, rake_cursor=$3
     WHERE id=$1`, [businessId, newOwnerId, vol]);
}

// ── Tier-4: THE HOSTILE TAKEOVER — the speakeasy-standover twin, applied to fronts (they change hands,
// not just get skimmed). A rival ≥ MIN_LEVEL who does NOT already run that kind fronts a FEE (burns win or
// lose — `business:takeover` cash SINK, the npchit-fee posture) and rolls a muscle/cunning contest vs the
// owner (fortress def bonus applies). A WIN forces a SALE at the front's assessed build value (owner PAID,
// taxed — the `business:buyout` transfer, identical to the club buyout), the front handed over reset. Runs
// under withTwoCharacters(raider, owner). BUSINESS_TAKEOVER_P pins the roll for tests (the standover precedent). ──
export async function takeoverBusiness(ch, owner, businessId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No moves from lockup.');
  if (safeHoused(ch)) throw new GameError('safe', "Can't run a takeover from a safehouse — a shield, not a bunker.");
  if (hospitalized(ch)) throw new GameError('hosp_self', 'No muscle from a hospital bed.');
  if (levelOf(ch.respect) < BUSINESS_EMPIRE.TAKEOVER.MIN_LEVEL) throw new GameError('level', `Takeovers open at level ${BUSINESS_EMPIRE.TAKEOVER.MIN_LEVEL}.`);
  if (h.owned.gangId && h.victimOwned.gangId === h.owned.gangId) throw new GameError('family', "They're family. Omertà.");
  const r = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [businessId])).rows[0];
  if (!r || r.character_id !== owner.id) throw new GameError('bad_business', 'No such front on them.');
  // you can't run two of one kind — a UNIQUE(character_id,kind) collision would 500; gate before the roll
  if ((await client.query('SELECT 1 FROM businesses WHERE character_id=$1 AND kind=$2', [ch.id, r.kind])).rows[0])
    throw new GameError('have_kind', `You already run a ${businessOf(r.kind).name} — you can only hold one.`);
  if (r.takeover_cd_until && new Date(r.takeover_cd_until) > new Date())
    throw new GameError('cooldown', 'That front just fought off a move — let it settle.');
  const fee = BUSINESS_EMPIRE.TAKEOVER.FEE;
  const price = businessAssessedValue(r.kind, r.tier);
  if (Number(ch.cash) < fee + price) throw new GameError('cash', `A takeover runs $${fee} fee + $${price} to buy it out.`);
  // the FEE burns win OR lose (a §10.4 cash sink) + the per-front cooldown is set either way
  ch.cash = Number(ch.cash) - fee;
  ch.heat = Math.min(100, Number(ch.heat || 0) + BUSINESS_EMPIRE.TAKEOVER.HEAT);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -fee, reason: 'business:takeover' });
  await client.query('UPDATE businesses SET takeover_cd_until=$2 WHERE id=$1',
    [businessId, new Date(Date.now() + BUSINESS_EMPIRE.TAKEOVER.CD_MS)]);

  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const vEff = (s) => effStat(owner[s], s, h.victimOwned.assets, h.victimOwned.gear);
  const atk = (eff('muscle') + eff('cunning') * 0.5) * skillMult(h, 'bruiser', SKILLS.FX.BRUISER_MULT);
  const defBonus = (r.spec && BUSINESS_EMPIRE.SPECS[r.spec]?.defBonus) || 0; // THE FORTRESS
  const def = vEff('muscle') + vEff('cunning') * 0.5 + defBonus;
  const T = BUSINESS_EMPIRE.TAKEOVER;
  let p = Math.max(T.MIN_P, Math.min(T.MAX_P, T.BASE_P + (atk - def) / T.STAT_SCALE));
  if (process.env.BUSINESS_TAKEOVER_P != null) p = Number(process.env.BUSINESS_TAKEOVER_P); // TEST-ONLY (the standover/raid precedent — pins p)
  const roll = Math.random();
  const won = roll < p;
  await h.rngLog(client, ch.id, `business:takeover:${owner.id}`, Math.round(p * 10000) / 10000, won ? 'takeover' : 'repelled');

  if (!won) {
    ch.health = Math.max(1, Number(ch.health) - rand(10, 25));
    await h.notify(client, owner.id, 'takeover_failed', { from: ch.name, kind: r.kind });
    return { ok: true, won: false, kind: r.kind, feeBurned: fee };
  }
  // WON — settle the owner's pending scrutiny FIRST (a friendly takeover must not wash a pending fine),
  // then the taxed buyout transfer + the reset handover (the club-buyout mechanism verbatim)
  await resolveScrutiny(owner, r, client, h);
  const buyFee = Math.ceil(price * 0.01), tax = Math.ceil(price * 0.01), net = price - buyFee - tax;
  ch.cash = Number(ch.cash) - price;
  owner.cash = Number(owner.cash) + net;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'business:buyout', counterparty: owner.id });
  await h.ledger(client, { characterId: owner.id, currency: 'cash', amount: net, reason: 'business:buyout', counterparty: ch.id });
  await resetFrontToNewOwner(client, businessId, ch.id); // fresh: scrutiny 0, spec cleared, clocks reset
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [tax]); // singleton LAST (canonical order)
  h.owned.businesses = await businessesOf(client, ch.id);
  await h.notify(client, owner.id, 'takeover', { from: ch.name, kind: r.kind, net });
  bus.emit('streets', { type: 'business_takeover', by: ch.name, from: owner.name, kind: r.kind });
  return { ok: true, won: true, kind: r.kind, price, net, feeBurned: fee };
}

// THE LAUNDERER leaderboard — the biggest money-men by lifetime cash washed through their fronts (survives
// death, agent-excluded — the tycoon/hitmen board precedent). A full account scan, LIMIT 20.
export async function laundererLeaderboard(pool, limit = 20) {
  const rows = (await pool.query(
    `SELECT a.laundered_lifetime, c.name, g.name AS gang, g.tag
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE a.laundered_lifetime > 0 AND NOT a.agent_flag
      ORDER BY a.laundered_lifetime DESC LIMIT $1`, [limit])).rows;
  return rows.map((r, i) => ({ rank: i + 1, name: r.name, gang: r.gang || null, tag: r.tag || null,
    washed: Math.floor(Number(r.laundered_lifetime)), title: launderRankOf(r.laundered_lifetime).name }));
}

// Reader for GET /v1/business + the character view — your empire, pending income, launder headroom.
export async function businessesOf(pool, characterId) {
  const rows = (await pool.query('SELECT * FROM businesses WHERE character_id=$1 ORDER BY acquired_at', [characterId])).rows;
  return rows.map((r) => {
    const cat = businessOf(r.kind), tier = businessTierOf(r.kind, r.tier);
    // mirror launderAtBusiness's token-bucket math so the displayed headroom is what a wash would see
    const refill = (Date.now() - new Date(r.launder_at).getTime()) / (24 * 3600 * 1000) * (tier?.launderCapDay || 0);
    const usedToday = Math.max(0, Number(r.launder_used) - Math.max(0, refill));
    return {
      id: r.id, kind: r.kind, name: cat?.name || r.kind, tier: Number(r.tier),
      incomePerHr: tier?.incomePerHr || 0, pending: accrued(r),
      // recurring sinks ("the pad"): what's owed, the hourly rate, and whether the front's gone cold
      upkeepOwed: upkeepOwed(r, rows.length), upkeepPerHr: Math.floor((tier?.incomePerHr || 0) * (upkeepBps(rows.length) / 10000)),
      cold: isCold(r),
      launderCapDay: tier?.launderCapDay || 0, launderHeadroom: Math.max(0, (tier?.launderCapDay || 0) - usedToday),
      scrutiny: Math.round(decayedScrutiny(r)), raidRisk: decayedScrutiny(r) >= CONSTANTS.BUSINESS_RAID_THRESHOLD,
      shakedownCdSeconds: r.shakedown_at ? Math.max(0, Math.ceil((new Date(r.shakedown_at).getTime() + CONSTANTS.SHAKEDOWN_CD_MS - Date.now()) / 1000)) : 0,
      nextTier: businessTierOf(r.kind, Number(r.tier) + 1) || null,
      // Tier-4: the specialization + the hostile-takeover surface
      maxed: Number(r.tier) >= businessMaxTier(r.kind), spec: r.spec || null, specName: r.spec ? BUSINESS_EMPIRE.SPECS[r.spec]?.name : null,
      specOmr: BUSINESS_EMPIRE.SPEC_OMR,
      takeoverFee: BUSINESS_EMPIRE.TAKEOVER.FEE, buyoutPrice: businessAssessedValue(r.kind, r.tier),
      takeoverCdSeconds: r.takeover_cd_until ? Math.max(0, Math.ceil((new Date(r.takeover_cd_until).getTime() - Date.now()) / 1000)) : 0,
    };
  });
}

// The full discoverable catalog (also closes the audit's API-discoverability gap).
export function catalog() {
  return BUSINESSES.map((b) => ({ kind: b.kind, name: b.name, lvl: b.lvl, tiers: b.tiers }));
}
