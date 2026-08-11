// THE HUSTLE — the daily three-stop job chain (founder-directed 2026-07-30: the crime loop must
// route the player AROUND the town — travel, talk to somebody, do the work, collect). The chain is
// seed-drawn per street per day (rules.js `hustleOf` — deterministic + verifiable), every stop is
// SERVER-VERIFIED (you must be standing in the named district to CHECK IN; the legwork stop
// additionally requires a REAL action done since you met the contact, proven by a daily-counter
// DELTA against a baseline snapshot — the counter is global, so where the work happened is not
// knowable and the copy does not claim it is; the routing comes from the three check-ins),
// and the payoff is a bounded once-a-day cash faucet (`hustle:payoff` — the clue-casket posture:
// petty by design, the movement is the product). §10.4: `hustle:` joins the cash vocabulary; the
// payoff is character_id'd so the per-character cash check reconciles. Dies with the street.
import { HUSTLE, hustleOf, dayOf, levelOf, DISTRICTS, jailed } from './rules.js';
import { GameError } from './game.js';

const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

async function countersOf(client, chId, day) {
  const row = (await client.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [chId, day])).rows[0];
  return row ? JSON.parse(row.counters) : {};
}

async function rowOf(client, chId, day) {
  return (await client.query('SELECT * FROM hustles WHERE character_id=$1 AND day=$2', [chId, day])).rows[0] || null;
}

export const hustlePay = (lvl) => Math.max(HUSTLE.PAY_MIN, HUSTLE.PAY_PER_LVL * lvl);

// step copy — one place so the board and the errors always agree
function stepOf(h, row) {
  const step = row ? Number(row.step) : 0;
  const [a, b, c] = h.stops;
  if (step === 0) return { step, district: a, what: `Meet the contact — ${h.contact} is waiting at ${districtName(a)}. Travel there and check in.` };
  if (step === 1) return { step, district: b, what: `The legwork — ${h.leg.how}, then check in at ${districtName(b)}.` };
  if (step === 2) return { step, district: c, what: `The payoff — bring it home at ${districtName(c)}.` };
  return { step: 3, district: null, what: 'Done for the day — fresh work tomorrow.' };
}

// ── the board: today's chain + where you are on it ──
export async function hustleBoard(ch, client) {
  const day = dayOf();
  const h = hustleOf(ch.id, day);
  const row = await rowOf(client, ch.id, day);
  const cur = stepOf(h, row);
  return {
    day,
    contact: h.contact,
    stops: h.stops.map((id) => ({ id, name: districtName(id) })),
    legwork: h.leg.how,
    step: cur.step,
    of: 3,
    district: cur.district,
    districtName: cur.district ? districtName(cur.district) : null,
    what: cur.what,
    here: cur.district ? ch.loc === cur.district : false,
    done: cur.step >= 3,
    pay: hustlePay(levelOf(Number(ch.respect))),
  };
}

// ── advance the chain: claim the CURRENT stop (location-gated; the legwork stop also needs the
// drawn action done SINCE the contact meeting — a counter delta, never a re-countable total) ──
export async function advanceHustle(ch, client, h2) {
  if (jailed(ch)) throw new GameError('jailed', 'No working the streets from lockup.');
  const day = dayOf();
  const h = hustleOf(ch.id, day);
  const row = await rowOf(client, ch.id, day);
  const cur = stepOf(h, row);
  if (cur.step >= 3) throw new GameError('done', 'Today\'s hustle is done — fresh work tomorrow.');
  if (ch.loc !== cur.district)
    throw new GameError('district', `Not here — this stop is at ${districtName(cur.district)}. Travel there first.`, { district: cur.district });
  const counters = await countersOf(client, ch.id, day);
  if (cur.step === 1) {
    const base = JSON.parse(row?.baseline || '{}');
    const need = h.leg.kind;
    if (Number(counters[need] || 0) <= Number(base[need] || 0))
      throw new GameError('legwork', `The contact wants the work done first — ${h.leg.how}.`);
  }
  const next = cur.step + 1;
  // the baseline snapshots the counters at the moment the LEGWORK stop opens, so only work done
  // AFTER meeting the contact counts (a morning's stockpiled jobs can't pre-pay the chain)
  const baseline = cur.step === 0 ? JSON.stringify(counters) : (row?.baseline || '{}');
  if (row) await client.query('UPDATE hustles SET step=$3, baseline=$4 WHERE character_id=$1 AND day=$2', [ch.id, day, next, baseline]);
  else await client.query('INSERT INTO hustles (character_id, day, step, baseline) VALUES ($1,$2,$3,$4)', [ch.id, day, next, baseline]);
  let pay = 0;
  if (next === 3) {
    pay = hustlePay(levelOf(Number(ch.respect)));
    ch.cash = Number(ch.cash) + pay;
    await h2.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'hustle:payoff' });
    await h2.notify(client, ch.id, 'hustle_paid', { pay });
  }
  const after = stepOf(h, { step: next });
  return { ok: true, step: next, of: 3, pay: pay || undefined,
    what: after.what, district: after.district, contact: h.contact };
}
