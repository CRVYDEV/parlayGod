// THE COMMISSION (design: omerta-commission-design.md). The top-SEATS families by standing vote
// weekly on a city decree; the majority of week W−1's votes governs week W, tallied LAZILY by
// whoever asks (no ticks). One family one vote, changeable all week, and votes are PUBLIC — the
// politics is the content. Step two (audit-hardened): a ballot stamps the family's STANDING at
// cast time (re-casting refreshes it); the tally ranks the week's FROZEN ballots by that stamp,
// counts only the top SEATS of them, and derives the weights (head = SEATS … last = 1) from the
// rank — so the electorate is bounded at the seat count no matter how many families transited
// the table mid-week, stale "I held the head seat for a minute" ballots rank where they belong,
// and the result never moves once the week freezes. A dissolved family's ballots die with it
// (social.js removeMember). The head seat's BOSS may VETO the sitting decree once per week, on
// the public record. No decree moves money: effects are bounded one-week modifiers applied at
// exactly one touchpoint each (safehouse / declareWar / laylow / convoy defense).
import { GameError, bus } from './game.js';
import { COMMISSION, decreeOf, weekOf, dayOf } from './rules.js';

// the CHAMBER's ladder — THIS SEASON's showing (tribute since rollover + 10k per war won this
// season). Econ pass (flagged in three audits: purchasable standing): lifetime tribute never
// decayed, so a parked whale owned the head seat + veto forever at ~zero net cost — the chamber
// now re-contests every season (the hitman legend/season precedent; season_tribute/season_wars
// reset in runSeasonRollover). Buying a seat still works — but it must be re-bought each season,
// and the parked treasury is war-lootable all the while. The buyback family split keeps the
// LIFETIME formula (a different, signed surface — worker.js).
// Deterministic tiebreak on id: tied families must not flap seats (or the head chair) per read.
export async function seatedGangs(db) {
  return (await db.query(
    `SELECT id, name, tag, season_tribute + 10000 * season_wars AS standing FROM gangs
      WHERE season_tribute + 10000 * season_wars > 0
      ORDER BY season_tribute + 10000 * season_wars DESC, id ASC LIMIT ${COMMISSION.SEATS}`)).rows;
}

// rank week-`week` ballots by stamped standing and derive seat weights — the frozen electorate
async function rankedBallots(db, week) {
  const rows = (await db.query('SELECT gang_id, decree, standing FROM commission_votes WHERE week=$1', [week])).rows;
  return rows
    .map((r) => ({ gang_id: r.gang_id, decree: r.decree, standing: Number(r.standing) }))
    .sort((a, b) => b.standing - a.standing || (a.gang_id < b.gang_id ? -1 : 1))
    .slice(0, COMMISSION.SEATS)
    .map((r, i) => ({ ...r, weight: COMMISSION.SEATS - i }));
}

// the decree in force for `week` = the weighted majority of week−1's top-ranked ballots (tie or
// silence → deadlock) — unless the head of the table killed it (the veto keys the governed week)
export async function activeDecree(db, week = weekOf()) {
  const ballots = await rankedBallots(db, week - 1);
  if (!ballots.length) return null;
  const tally = {};
  for (const b of ballots) tally[b.decree] = (tally[b.decree] || 0) + b.weight;
  const sorted = Object.entries(tally).map(([decree, n]) => ({ decree, n })).sort((a, b) => b.n - a.n);
  if (sorted.length > 1 && sorted[0].n === sorted[1].n) return null; // the Commission deadlocked
  if ((await db.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [week])).rows[0]) return null; // killed at the table
  return decreeOf(sorted[0].decree);
}

// cast (or change) the family's vote — boss/underboss of a SEATED family only. The ballot stamps
// the family's CURRENT standing (re-casting refreshes it); the returned weight is the seat the
// family speaks from today — the tally derives the final weights when the week freezes.
export async function castVote(ch, decreeId, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  if (!decreeOf(decreeId)) throw new GameError('bad_decree', 'No such motion before the Commission.');
  const seats = await seatedGangs(client);
  const seatIdx = seats.findIndex((s) => s.id === h.owned.gangId);
  if (seatIdx < 0)
    throw new GameError('no_seat', `The Commission seats the top ${COMMISSION.SEATS} families. Earn the standing.`);
  const standing = Number(seats[seatIdx].standing);
  const week = weekOf();
  // UPDATE-first, INSERT on zero rows; a concurrent first-cast race (boss + underboss) loses
  // cleanly on the (week, gang_id) PK instead of surfacing a raw 500
  const upd = await client.query('UPDATE commission_votes SET decree=$3, standing=$4 WHERE week=$1 AND gang_id=$2',
    [week, h.owned.gangId, decreeId, standing]);
  if (!upd.rowCount) {
    try {
      await client.query('INSERT INTO commission_votes (week, gang_id, decree, standing) VALUES ($1,$2,$3,$4)',
        [week, h.owned.gangId, decreeId, standing]);
    } catch { throw new GameError('again', 'The family just spoke — cast again to change the vote.'); }
  }
  bus.emit(`gang:${h.owned.gangId}`, { type: 'commission_vote', decree: decreeId });
  await h.track(client, ch.account_id, 'commission_vote', { decree: decreeId, week, standing });
  return { ok: true, week, decree: decreeId, weight: COMMISSION.SEATS - seatIdx, takesEffectWeek: week + 1 };
}

// THE VETO — the head of the table (seat 1's BOSS, and nobody else) kills the decree in force,
// once per week, on the public record. Pure politics: no money, no lock beyond the row insert.
export async function vetoDecree(ch, client, h) {
  if (h.owned.gangRole !== 'boss') throw new GameError('rank', 'The veto is the boss chair speaking — nobody speaks for it.');
  const seats = await seatedGangs(client);
  if (!seats.length || seats[0].id !== h.owned.gangId)
    throw new GameError('head', 'Only the head of the table kills a decree.');
  const week = weekOf();
  if ((await client.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [week])).rows[0])
    throw new GameError('vetoed', 'The table already heard a veto this week.');
  const decree = await activeDecree(client, week);
  if (!decree) throw new GameError('no_decree', 'There is nothing in force to kill.');
  try {
    await client.query('INSERT INTO commission_vetoes (week, gang_id, decree) VALUES ($1,$2,$3)', [week, h.owned.gangId, decree.id]);
  } catch { throw new GameError('vetoed', 'The table already heard a veto this week.'); } // race loses cleanly on the week PK
  bus.emit('streets', { type: 'commission_veto', family: seats[0].name, decree: decree.id });
  await h.track(client, ch.account_id, 'commission_veto', { decree: decree.id, week });
  return { ok: true, vetoed: decree.id, week };
}

// the chamber: seats, this week's public votes (stamped standing + provisional rank-derived
// weight), the decree in force, any veto on the record, and the book. The veto row LEFT JOINs
// gangs — a family that vetoed and then dissolved stays on the record (the decree stayed dead).
export async function commissionBoard(pool) {
  const week = weekOf();
  const seats = await seatedGangs(pool);
  const ballots = await rankedBallots(pool, week); // provisional — more casts may still land this week
  const votes = (await pool.query(
    `SELECT v.decree, v.standing, v.gang_id, g.name, g.tag FROM commission_votes v JOIN gangs g ON g.id = v.gang_id WHERE v.week=$1`, [week])).rows;
  const provisional = Object.fromEntries(ballots.map((b) => [b.gang_id, b.weight]));
  const decree = await activeDecree(pool, week);
  const vetoRow = (await pool.query(
    'SELECT x.decree, g.name FROM commission_vetoes x LEFT JOIN gangs g ON g.id = x.gang_id WHERE x.week=$1', [week])).rows[0] || null;
  // the decree lapses when the week does (weeks are 7-day windows off the day epoch)
  const lapsesMs = (week + 1) * 7 * 86400000 - dayOf() * 86400000 - (Date.now() % 86400000);
  return {
    seats: seats.map((s, i) => ({ name: s.name, tag: s.tag, standing: Number(s.standing), weight: COMMISSION.SEATS - i })),
    votes: votes.map((v) => ({ family: v.name, tag: v.tag, decree: v.decree, standing: Number(v.standing),
      weight: provisional[v.gang_id] || 0 })), // public — politics is the content
    decree: decree ? { ...decree, lapsesSeconds: Math.max(0, Math.ceil(lapsesMs / 1000)) } : null,
    veto: vetoRow ? { family: vetoRow.name || '(a family now dissolved)', decree: vetoRow.decree } : null,
    book: COMMISSION.DECREES, seatsCount: COMMISSION.SEATS, week,
  };
}
