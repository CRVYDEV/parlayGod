// ── THE PAYROLL — every crew you owe, on one page, in one vocabulary ──
//
// Tester feedback (2026-08-15): "paying the guys in the kitchen is not the same as paying the guys
// in the empire etc. it's not consistent." He is right, and the inconsistency is structural: the
// game grew FOUR separate "pay your people" surfaces — the kitchen crew's NUT, the business fronts'
// PAD, the family's territory/sovereignty upkeep, the estate's household wages — each on its own
// tab, each with its own vocabulary, and (deliberately, per each system's signed design) different
// settlement semantics. The MECHANICS are not the bug — all-or-nothing for the nut vs greedy for
// the pad vs treasury-paid for the family are each documented, tested decisions. What was missing
// is ONE surface that shows them all the same way and SAYS how each one pays.
//
// So this is THE DAY's shape applied to obligations (the day.js precedent verbatim): a PURE READ
// that REUSES each module's own board readers — businessesOf, territoryOf, sovBoard, the estate's
// wage state, the view's own crew helpers — so the number here and the number on each tab can
// NEVER disagree (the extortFront one-core discipline; a payroll that re-derived a formula would
// drift the first time a lever moved). Every row carries the same fields: what / rate / owed /
// cold state + countdown / HOW it pays (the semantics stated, not hidden) / the pay route + the
// tab. ZERO §10.4 — no value moves, no row written; the pay buttons route to the EXISTING audited
// tills.
import { businessesOf } from './business.js';
import { territoryOf } from './territory.js';
import { sovBoard } from './sov.js';
import { staffWagesOf } from './estate.js';
import { M4, crewWageOwed, crewCold } from './rules.js';

const num = (v) => Number(v || 0);

export async function payrollBoard(ch, client, h) {
  const items = [];

  // 1) THE KITCHEN CREW — the nut. All-or-nothing from pocket cash (the signed design: one crew,
  //    one book — you square the whole nut or none of it).
  const crew = num(ch.crew);
  if (crew > 0) {
    items.push({
      id: 'crew', label: 'The kitchen crew', flavor: 'the nut', tab: 'kitchen', currency: 'cash',
      perHr: crew * M4.CREW_WAGE_PER_HR, perDay: null, owed: crewWageOwed(ch),
      cold: crewCold(ch), coldCount: 0,
      coldSeconds: ch.crew_paid_at
        ? Math.max(0, Math.ceil((new Date(ch.crew_paid_at).getTime() + M4.CREW_WAGE_COLD_MS - Date.now()) / 1000)) : null,
      coldWord: 'downed tools',
      pay: 'POST /v1/kitchen/crew/wages', how: 'all at once, from pocket cash', canPay: true,
    });
  }

  // 2) THE FRONTS — the pad, summed across the empire. Greedy (the signed design: each front's
  //    book settles independently — you pay whatever you can cover, front by front).
  const fronts = await businessesOf(client, ch.id);
  if (fronts.length) {
    const owed = fronts.reduce((a, b) => a + num(b.upkeepOwed), 0);
    const coldN = fronts.filter((b) => b.cold).length;
    const clocks = fronts.map((b) => b.coldSeconds).filter((s) => s != null && s > 0);
    items.push({
      id: 'fronts', label: `The fronts (${fronts.length})`, flavor: 'the pad', tab: 'empire', currency: 'cash',
      perHr: fronts.reduce((a, b) => a + num(b.upkeepPerHr), 0), perDay: null, owed,
      cold: coldN > 0, coldCount: coldN,
      coldSeconds: clocks.length ? Math.min(...clocks) : null, coldWord: 'gone cold',
      pay: 'POST /v1/business/upkeep', how: 'whatever you can cover, front by front', canPay: true,
    });
  }

  // 3) THE HOUSEHOLD — the estate staff, in $OMR. All-or-nothing (one household book); unpaid past
  //    the walk window they LEAVE (the arrears die with the insult — estate.js).
  const hh = await staffWagesOf(client, ch.account_id);
  if (hh.staffCount > 0) {
    items.push({
      id: 'household', label: `The household (${hh.staffCount})`, flavor: 'staff wages', tab: 'estate', currency: 'omr',
      perHr: null, perDay: hh.perDay, owed: hh.owed,
      cold: false, coldCount: 0, coldSeconds: hh.walkInSeconds, coldWord: 'they walk',
      pay: 'POST /v1/estate/wages', how: 'all at once, in $OMR', canPay: true,
    });
  }

  // 4) THE FAMILY'S BOOKS — territory operations + sovereignty strongholds, paid from the TREASURY
  //    by a boss/underboss. Shown to every made man (you should know the family's books); the pay
  //    button is rank-gated on the client and the till enforces it regardless.
  if (h.owned.gangId) {
    const canPay = ['boss', 'underboss'].includes(h.owned.gangRole);
    const ops = await territoryOf(client, h.owned.gangId);
    if (ops.length) {
      const owed = ops.reduce((a, o) => a + num(o.upkeepOwed), 0);
      const coldN = ops.filter((o) => o.cold).length;
      if (owed > 0 || coldN > 0) items.push({
        id: 'territory', label: `The territory (${ops.length} operation${ops.length === 1 ? '' : 's'})`,
        flavor: 'upkeep', tab: 'family', currency: 'treasury',
        perHr: ops.reduce((a, o) => a + num(o.upkeepPerHr), 0), perDay: null, owed,
        cold: coldN > 0, coldCount: coldN, coldSeconds: null, coldWord: 'gone cold',
        pay: 'POST /v1/territory/upkeep', how: 'from the family treasury (boss/underboss)', canPay,
      });
    }
    const sov = await sovBoard(client, h);
    const mine = (sov.structures || []).filter((s) => s.mine && num(s.upkeepOwed) > 0);
    if (mine.length) items.push({
      id: 'sov', label: `The strongholds (${mine.length})`, flavor: 'upkeep', tab: 'family', currency: 'treasury',
      perHr: null, perDay: null, owed: mine.reduce((a, s) => a + num(s.upkeepOwed), 0),
      cold: false, coldCount: 0, coldSeconds: null, coldWord: 'crumbling',
      pay: 'POST /v1/sov/upkeep', how: 'from the family treasury (boss/underboss)', canPay,
    });
  }

  return {
    items,
    // one-glance totals per till — a payroll is read as "what do I owe", so say it in each currency
    owedCash: items.filter((i) => i.currency === 'cash').reduce((a, i) => a + num(i.owed), 0),
    owedOmr: items.filter((i) => i.currency === 'omr').reduce((a, i) => a + num(i.owed), 0),
    owedTreasury: items.filter((i) => i.currency === 'treasury').reduce((a, i) => a + num(i.owed), 0),
    anyCold: items.some((i) => i.cold),
  };
}
