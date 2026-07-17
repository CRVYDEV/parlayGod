// THE LAW / RICO / INFORMANTS — the state-run PvE antagonist (design omerta-law-rico-design.md).
// Heat accrues everywhere (unchanged, sim-audited); THE LAW is what lies DOWNSTREAM of the number.
//
// Phase 1  the investigation meter (accrual.js) + the two escapes here: the BRIBE (knock the case
//          down) and the LAWYER retainer (soften the coming bust). Pure metered cash sinks.
// Phase 2  the RICO bust — a conviction seizes FORFEIT_RATE of pocket+bank into the confiscation
//          buffer (street_tax.pool — the `mod:confiscate` precedent). Staked $OMR + minted gear are
//          SAFE. It reaches the OFFLINE whale via the worker sweep. NOT death — the street survives.
// Phase 3  the courtroom — plea (a certain, smaller loss), buy the jury (a $OMR sink that cuts the
//          odds once), or demand trial now.
// Phase 4  the flip — turn state's evidence: the case is dropped, you name a rival (seeding THEIR
//          case), and you're branded a rat (a bloodline badge + a contract magnet). Witness
//          protection is a one-time untargetable relocation window.
//
// §10.4: every ledgered event is a SINK (law:bribe/retainer/forfeit/plea → the pool; law:jury burns
// $OMR). The Law only DRAINS — it's the counterweight to the Risk-to-Earn faucets. All numbers are
// founder sign-off levers (ground rule #1).
import crypto from 'node:crypto';
import { GameError, ledger, rngLog, notify, track, bus } from './game.js';
import { LAW, rapStageOf, bribeCostOf, retainerActive, witproActive, bustProbOf,
         cityEventOf, dayOf, cityHourOf } from './rules.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// ── GET /v1/law — the public rap sheet + docket ──
export function lawBoard(ch, h) {
  const acct = h.acct || {};
  const exposure = Number(ch.heat_exposure || 0);
  const ev = cityEventOf(dayOf());
  const indicted = !!ch.indicted_at;
  return {
    stage: rapStageOf(exposure, ch.indicted_at),
    exposure: Math.round(exposure),
    thresholds: { watched: LAW.WATCHED_AT, investigation: LAW.INVESTIGATE_AT, indict: LAW.INDICT_AT },
    watch: LAW.WATCH,                                   // heat above this feeds the case
    // Phase 1 escapes
    bribeCost: indicted ? null : bribeCostOf(exposure), // the beat cop can't drop a filed case
    bribeClears: LAW.BRIBE_CLEAR,
    retainer: { cost: LAW.RETAINER_COST,
      active: retainerActive(ch),
      seconds: retainerActive(ch) ? Math.max(0, Math.ceil((new Date(ch.retainer_until) - Date.now()) / 1000)) : 0 },
    // Phase 2/3 — the case, once filed
    indicted,
    graceSeconds: indicted ? Math.max(0, Math.ceil((new Date(ch.indicted_at).getTime() + LAW.INDICT_GRACE_MS - Date.now()) / 1000)) : 0,
    convictionOdds: indicted ? Math.round(bustProbOf(ch) * 100) : null,
    forfeitRate: LAW.FORFEIT_RATE,
    plea: indicted ? { forfeitRate: LAW.PLEA_FORFEIT_RATE, jailSeconds: LAW.PLEA_JAIL_S } : null,
    jury: { bought: !!ch.jury_bought, cost: LAW.JURY_COST_OMR, cuts: LAW.JURY_BUST_MULT },
    // Phase 4 — the informant path
    rat: !!acct.rat,
    witpro: { active: witproActive(ch),
      seconds: witproActive(ch) ? Math.max(0, Math.ceil((new Date(ch.witpro_until) - Date.now()) / 1000)) : 0,
      available: !!acct.rat && !ch.witpro_until },
    // the weather that drives the pressure (crackdown builds the case faster, a visit bleeds it)
    cityEvent: { id: ev.id, name: ev.name, exposureMult: LAW.EXPOSURE_EVENT[ev.id] ?? 1 },
    // THE LIVING WORLD P4: the Bureau works business hours — a trial/bust in the patrol window
    // convicts a touch harder (already folded into convictionOdds above).
    patrol: cityHourOf().patrol,
  };
}

// ── Phase 1 — the bribe (knock the case down a band) ──
export async function bribe(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No reaching the beat cop from lockup.');
  if (ch.indicted_at) throw new GameError('indicted', 'The case is filed — the beat cop is off it. See a lawyer.');
  // D2 — bribery is an EXPOSED act (you meet the man), like laundering. Not from a safehouse.
  if (safeHoused(ch)) throw new GameError('safe', "You won't meet a cop while you're to ground.");
  const exposure = Number(ch.heat_exposure || 0);
  if (exposure < LAW.WATCH) throw new GameError('clean', "Nothing to bribe away — you're not on anyone's radar.");
  const cost = bribeCostOf(exposure);
  if (Number(ch.cash) < cost) throw new GameError('cash', `The envelope needs $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  ch.heat_exposure = Math.max(0, exposure - LAW.BRIBE_CLEAR);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]); // seized cash → the buyback pool
  await ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'law:bribe' });
  return { ok: true, cost, exposure: Math.round(ch.heat_exposure), stage: rapStageOf(ch.heat_exposure, ch.indicted_at) };
}

// ── Phase 1 — the lawyer (a time-boxed retainer that softens the bust) ──
export async function retainer(ch, client, h) {
  const cost = LAW.RETAINER_COST;
  if (Number(ch.cash) < cost) throw new GameError('cash', `The retainer is $${cost}.`);
  ch.cash = Number(ch.cash) - cost;
  // extend from the later of now / the current retainer end (paying twice buys two windows)
  const base = retainerActive(ch) ? new Date(ch.retainer_until).getTime() : Date.now();
  ch.retainer_until = new Date(base + LAW.RETAINER_MS);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]);
  await ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'law:retainer' });
  return { ok: true, cost, retainerSeconds: Math.ceil((new Date(ch.retainer_until) - Date.now()) / 1000) };
}

// ── the §10.4 heart: a conviction seizes pocket+bank into the confiscation buffer ──
// Shared by the worker sweep (forced), a demanded trial, and any future lazy resolve. Mutates ch;
// the caller persists it (withCharacter → persistCharacter; the worker → persistBust below).
async function resolveBust(client, h, ch, { forced = false } = {}) {
  // LAW_BUST_P is a TEST-ONLY knob (the BUSINESS_RAID_P / GEAR_LOOT_CHANCE precedent) that pins the
  // conviction probability so the courtroom is deterministic in tests — never set in production.
  const p = process.env.LAW_BUST_P != null ? Number(process.env.LAW_BUST_P) : bustProbOf(ch);
  const roll = Math.random();
  const convicted = roll < p;
  await rngLog(client, ch.id, 'rico', roll, convicted ? `convicted (P ${p.toFixed(3)})` : `acquitted (P ${p.toFixed(3)})`);
  ch.indicted_at = null;            // the case resolves either way
  ch.jury_bought = false;           // a bought jury is spent on this trial
  if (!convicted) {
    // the case collapses — exposure drops so they aren't re-indicted on the very next tick
    ch.heat_exposure = Math.min(Number(ch.heat_exposure || 0), LAW.ACQUIT_TO);
    await notify(client, ch.id, 'acquitted', {});
    await track(client, ch.account_id, 'rico', { convicted: false, forced });
    return { convicted: false, forfeited: 0, roll, p, jailSeconds: 0 };
  }
  // FORFEITURE — FORFEIT_RATE of pocket+bank (a lawyer shrinks it), reaching pocket THEN bank, into
  // the confiscation buffer (the `mod:confiscate` §10.4 pattern). Staked $OMR + gear are untouched.
  const rate = LAW.FORFEIT_RATE * (retainerActive(ch) ? LAW.RETAINER_FORFEIT_MULT : 1);
  const total = Math.floor((Number(ch.cash) + Number(ch.bank)) * rate);
  const fromPocket = Math.min(total, Math.floor(Number(ch.cash)));
  const fromBank = total - fromPocket;
  if (total > 0) {
    ch.cash = Number(ch.cash) - fromPocket;
    ch.bank = Number(ch.bank) - fromBank;
    ch.bank_intransit = Math.min(Number(ch.bank_intransit || 0), Number(ch.bank)); // marker can't exceed the balance
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [total]);
    // one row spans cash+bank (the char-cash check (a) is on cash+bank — the whack:loot precedent)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: -total, reason: 'law:forfeit' });
  }
  ch.heat_exposure = 0;             // the sheet is spent (they can be built up and busted again)
  ch.jail_until = new Date(Date.now() + LAW.BUST_JAIL_S * 1000);
  await notify(client, ch.id, 'busted', { forfeited: total, jailSeconds: LAW.BUST_JAIL_S });
  bus.emit('streets', { type: 'busted', who: ch.name, forfeited: total });
  await track(client, ch.account_id, 'rico', { convicted: true, forfeited: total, forced });
  return { convicted: true, forfeited: total, roll, p, jailSeconds: LAW.BUST_JAIL_S };
}

// ── Phase 3 — plea: settle for a certain, smaller loss + a short stretch ──
export async function plea(ch, client, h) {
  if (!ch.indicted_at) throw new GameError('not_indicted', 'No case to settle.');
  const total = Math.floor((Number(ch.cash) + Number(ch.bank)) * LAW.PLEA_FORFEIT_RATE);
  const fromPocket = Math.min(total, Math.floor(Number(ch.cash)));
  const fromBank = total - fromPocket;
  if (total > 0) {
    ch.cash = Number(ch.cash) - fromPocket;
    ch.bank = Number(ch.bank) - fromBank;
    ch.bank_intransit = Math.min(Number(ch.bank_intransit || 0), Number(ch.bank));
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [total]);
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: -total, reason: 'law:plea' });
  }
  ch.indicted_at = null; ch.heat_exposure = 0; ch.jury_bought = false;
  ch.jail_until = new Date(Date.now() + LAW.PLEA_JAIL_S * 1000);
  await track(client, ch.account_id, 'rico', { plea: true, forfeited: total });
  return { ok: true, forfeited: total, jailSeconds: LAW.PLEA_JAIL_S };
}

// ── Phase 3 — buy the jury (a $OMR sink that cuts conviction odds once) ──
export async function buyJury(ch, client, h) {
  if (!ch.indicted_at) throw new GameError('not_indicted', 'No trial to fix.');
  if (ch.jury_bought) throw new GameError('done', 'The jury is already seen to.');
  const acct = h.acct;
  if (Number(acct.omr) < LAW.JURY_COST_OMR) throw new GameError('omr', `Reaching the jury costs ${LAW.JURY_COST_OMR} $OMR.`);
  acct.omr = Number(acct.omr) - LAW.JURY_COST_OMR;
  ch.jury_bought = true;
  await ledger(client, { accountId: ch.account_id, currency: 'omr', amount: -LAW.JURY_COST_OMR, reason: 'law:jury' });
  return { ok: true, spent: LAW.JURY_COST_OMR, convictionOdds: Math.round(bustProbOf(ch) * 100) };
}

// ── Phase 3 — demand trial now (resolve the indictment immediately, player agency) ──
export async function demandTrial(ch, client, h) {
  if (!ch.indicted_at) throw new GameError('not_indicted', 'No case against you.');
  const res = await resolveBust(client, h, ch, { forced: false });
  return { ok: true, ...res };
}

// ── Phase 4 — the flip: turn state's evidence (two-party — names a rival) ──
export async function flip(ch, victim, client, h) {
  if (!ch.indicted_at) throw new GameError('not_indicted', "You've nothing to trade — no case against you.");
  if (h.acct.rat) throw new GameError('already_rat', "You've already turned. There's no lower to go.");
  // the deal: your case is DROPPED, you do a short soft stretch, and you name a name
  ch.indicted_at = null; ch.heat_exposure = 0; ch.jury_bought = false;
  ch.jail_until = new Date(Date.now() + LAW.FLIP_JAIL_S * 1000);
  h.acct.rat = true; // the permanent badge — follows the bloodline (persistAccount)
  // the named rival's case grows — seed their meter; if it crosses the line, they're indicted too
  victim.heat_exposure = Number(victim.heat_exposure || 0) + LAW.FLIP_SEED;
  let namedIndicted = false;
  if (victim.heat_exposure >= LAW.INDICT_AT && !victim.indicted_at) {
    victim.indicted_at = new Date(); namedIndicted = true;
    await notify(client, victim.id, 'indicted', { graceHours: Math.round(LAW.INDICT_GRACE_MS / 3600000) });
  }
  await client.query(
    'INSERT INTO informants (id, witness_character, witness_account, target_character, target_account, seed) VALUES ($1,$2,$3,$4,$5,$6)',
    [crypto.randomUUID(), ch.id, ch.account_id, victim.id, victim.account_id, LAW.FLIP_SEED]);
  await notify(client, victim.id, 'named', { by: ch.name, seed: LAW.FLIP_SEED });
  await notify(client, ch.id, 'flipped', { named: victim.name });
  bus.emit('streets', { type: 'rat', who: ch.name }); // the town learns there's a rat (never the mark's name)
  await track(client, ch.account_id, 'flip', { named: victim.id });
  return { ok: true, named: victim.name, namedIndicted };
}

// ── Phase 4 — witness protection (a one-time untargetable relocation window) ──
export async function enterWitpro(ch, client, h) {
  if (!h.acct.rat) throw new GameError('not_rat', 'Witness protection is for those who talked.');
  if (jailed(ch)) throw new GameError('jailed', 'The marshals collect you when you walk, not before.');
  if (ch.witpro_until) throw new GameError('done', "You've already used your relocation.");
  ch.witpro_until = new Date(Date.now() + LAW.WITPRO_MS);
  await notify(client, ch.id, 'witpro', { hours: Math.round(LAW.WITPRO_MS / 3600000) });
  return { ok: true, witproSeconds: Math.ceil(LAW.WITPRO_MS / 1000) };
}

// ── the worker sweep — force the bust on an indicted player past the grace window ──
// Reaches the OFFLINE whale who never surfaces to plea/lawyer/flip. Per-character txn (lock the
// character, resolve, persist the touched columns). resolveBust updates street_tax.pool itself.
export async function sweepLaw(pool, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const cutoff = new Date(now.getTime() - LAW.INDICT_GRACE_MS);
  const rows = (await pool.query(
    'SELECT id FROM characters WHERE alive AND indicted_at IS NOT NULL AND indicted_at <= $1 ORDER BY id', [cutoff])).rows;
  let convicted = 0, acquitted = 0, seized = 0;
  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
      if (!ch || !ch.indicted_at || new Date(ch.indicted_at) > cutoff) { await client.query('ROLLBACK'); continue; }
      const h = { ledger, rngLog, notify, track };
      const res = await resolveBust(client, h, ch, { forced: true });
      await client.query(
        `UPDATE characters SET cash=$2, bank=$3, bank_intransit=$4, jail_until=$5,
           heat_exposure=$6, indicted_at=$7, jury_bought=$8 WHERE id=$1`,
        [id, ch.cash, ch.bank, ch.bank_intransit ?? 0, ch.jail_until, ch.heat_exposure, ch.indicted_at, ch.jury_bought]);
      await client.query('COMMIT');
      if (res.convicted) { convicted++; seized += res.forfeited; } else acquitted++;
    } catch (e) { await client.query('ROLLBACK'); console.error('sweepLaw', id, e.message); }
    finally { client.release(); }
  }
  return { convicted, acquitted, seized, cases: rows.length };
}
