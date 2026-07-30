// WORD ON THE STREET (STREET LIFE, task #318 — founder-directed "more tasks located in each area
// that send you on quests to gain xp and levels... certain tasks should push you into conflict or
// meet other players").
//
// Every district posts CORNER.PER_DAY seed-drawn tasks a day (town-wide per district — everyone
// standing there sees the same work), drawn from that district's flavored pool of EXISTING
// bumpDaily kinds (zero new counting surface, the drill rule), with one CONFLICT kind guaranteed.
// ACCEPT at the district snapshots the daily counters (the hustle baseline rule — a morning's
// stockpiled jobs can't pre-pay a task); do the work; CLAIM at the district pays CORNER.CASH
// (`corner:job`, a small character_id'd §10.4 faucet) + CORNER.RESPECT (the XP — respect IS
// levels). Bounded HARD by CORNER.MAX_DAY claims per street per day across all districts.
import { GameError } from './game.js';
import { CORNER, DISTRICTS, cornerTasksOf, dayOf } from './rules.js';
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

async function countersOf(client, chId, day) {
  const row = (await client.query('SELECT counters FROM daily_progress WHERE character_id=$1 AND day=$2', [chId, day])).rows[0];
  return row ? JSON.parse(row.counters) : {};
}

// the board for the district you're STANDING in — the work is located, that's the point
export async function cornerBoard(ch, client) {
  const day = dayOf();
  const tasks = cornerTasksOf(ch.loc, day);
  const jobs = (await client.query(
    'SELECT district, slot, claimed FROM corner_jobs WHERE character_id=$1 AND day=$2', [ch.id, day])).rows;
  const here = new Map(jobs.filter((j) => j.district === ch.loc).map((j) => [Number(j.slot), j]));
  const claimedToday = jobs.filter((j) => j.claimed).length;
  return {
    district: ch.loc, districtName: districtName(ch.loc),
    cash: CORNER.CASH, respect: CORNER.RESPECT,
    maxDay: CORNER.MAX_DAY, claimedToday, leftToday: Math.max(0, CORNER.MAX_DAY - claimedToday),
    tasks: tasks.map((t) => ({
      ...t,
      accepted: here.has(t.slot),
      claimed: !!here.get(t.slot)?.claimed,
    })),
  };
}

// take the job — snapshots the counters so only work done AFTER counts
export async function acceptCorner(ch, slot, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No working the corner from lockup.');
  const day = dayOf();
  const tasks = cornerTasksOf(ch.loc, day);
  const t = tasks.find((x) => x.slot === Number(slot));
  if (!t) throw new GameError('bad_slot', "No such job on this corner today.");
  const counters = await countersOf(client, ch.id, day);
  const ins = await client.query(
    `INSERT INTO corner_jobs (character_id, day, district, slot, baseline)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [ch.id, day, ch.loc, t.slot, JSON.stringify(counters)]);
  if (!ins.rowCount) throw new GameError('taken', 'You already took that job.');
  return { ok: true, corner: 'accepted', kind: t.kind, how: t.how, district: ch.loc };
}

// collect — the counter DELTA proves the work (the hustle rule), the claim pays cash + respect
export async function claimCorner(ch, slot, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No collecting from lockup.');
  const day = dayOf();
  const tasks = cornerTasksOf(ch.loc, day);
  const t = tasks.find((x) => x.slot === Number(slot));
  if (!t) throw new GameError('bad_slot', 'No such job on this corner today.');
  const job = (await client.query(
    'SELECT * FROM corner_jobs WHERE character_id=$1 AND day=$2 AND district=$3 AND slot=$4 FOR UPDATE',
    [ch.id, day, ch.loc, t.slot])).rows[0];
  if (!job) throw new GameError('not_taken', 'Take the job first — then do the work.');
  if (job.claimed) throw new GameError('claimed', 'That envelope is already in your pocket.');
  const claimedRows = (await client.query(
    'SELECT district, slot FROM corner_jobs WHERE character_id=$1 AND day=$2 AND claimed', [ch.id, day])).rows;
  const claimedToday = claimedRows.length;
  if (claimedToday >= CORNER.MAX_DAY)
    throw new GameError('capped', `The corner pays ${CORNER.MAX_DAY} envelopes a day — fresh work tomorrow.`);
  // (AUDIT-street-life, Lens D LOW-1) one envelope per KIND of work per day: the same kind sits in
  // several districts' pools and every accepted slot snapshots the SAME shared daily counter, so
  // without this five same-kind slots were all satisfied by ONE action ($2k for one jump). The
  // corner pays for work, not for walking the map — a second same-kind envelope needs tomorrow's draw.
  if (claimedRows.some((j) =>
    (cornerTasksOf(j.district, day).find((x) => x.slot === Number(j.slot)) || {}).kind === t.kind))
    throw new GameError('done_kind', 'The corner already paid you for that kind of work today — different job, different envelope.');
  const counters = await countersOf(client, ch.id, day);
  const base = JSON.parse(job.baseline || '{}');
  if (Number(counters[t.kind] || 0) <= Number(base[t.kind] || 0))
    throw new GameError('not_done', `The work comes first — ${t.how}.`);
  await client.query(
    'UPDATE corner_jobs SET claimed=true WHERE character_id=$1 AND day=$2 AND district=$3 AND slot=$4',
    [ch.id, day, ch.loc, t.slot]);
  ch.cash = Number(ch.cash) + CORNER.CASH;
  ch.respect = Number(ch.respect) + CORNER.RESPECT;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: CORNER.CASH, reason: 'corner:job' });
  await h.track(client, ch.account_id, 'corner', { kind: t.kind, district: ch.loc });
  return { ok: true, corner: 'claimed', kind: t.kind, cash: CORNER.CASH, respect: CORNER.RESPECT,
    claimedToday: claimedToday + 1, maxDay: CORNER.MAX_DAY };
}
