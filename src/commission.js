// THE COMMISSION (design: omerta-commission-design.md). The top-SEATS families by standing vote
// weekly on a city decree; the majority of week W−1's votes governs week W, tallied LAZILY by
// whoever asks (no ticks). One family one vote, changeable all week, and votes are PUBLIC — the
// politics is the content. Step two: votes are SEAT-WEIGHTED (the head of the table casts SEATS
// points, the last seat 1 — weight stamped at CAST time, so re-casting refreshes it and the
// tally freezes when the week does), and the head seat's BOSS may VETO the sitting decree once
// per week, on the public record. No decree moves money: effects are bounded one-week modifiers
// applied at exactly one touchpoint each (safehouse / declareWar / laylow / convoy defense).
import { GameError, bus } from './game.js';
import { COMMISSION, decreeOf, weekOf, dayOf } from './rules.js';

// the standing ladder — the same formula the buyback pays (lifetime tribute + 10k per war won)
export async function seatedGangs(db) {
  return (await db.query(
    `SELECT id, name, tag, lifetime_tribute + 10000 * wars_won AS standing FROM gangs
      WHERE lifetime_tribute + 10000 * wars_won > 0
      ORDER BY lifetime_tribute + 10000 * wars_won DESC LIMIT ${COMMISSION.SEATS}`)).rows;
}

// the decree in force for `week` = the WEIGHTED majority of week−1's votes (tie or silence →
// deadlock) — unless the head of the table killed it (the veto is keyed to the governed week)
export async function activeDecree(db, week = weekOf()) {
  const votes = (await db.query('SELECT decree, SUM(weight) n FROM commission_votes WHERE week=$1 GROUP BY decree', [week - 1])).rows;
  if (!votes.length) return null;
  const sorted = votes.map((v) => ({ decree: v.decree, n: Number(v.n) })).sort((a, b) => b.n - a.n);
  if (sorted.length > 1 && sorted[0].n === sorted[1].n) return null; // the Commission deadlocked
  if ((await db.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [week])).rows[0]) return null; // killed at the table
  return decreeOf(sorted[0].decree);
}

// cast (or change) the family's vote — boss/underboss of a SEATED family only. The vote carries
// the family's CURRENT seat weight (head = SEATS .. last = 1); re-casting refreshes it.
export async function castVote(ch, decreeId, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  if (!decreeOf(decreeId)) throw new GameError('bad_decree', 'No such motion before the Commission.');
  const seats = await seatedGangs(client);
  const seatIdx = seats.findIndex((s) => s.id === h.owned.gangId);
  if (seatIdx < 0)
    throw new GameError('no_seat', `The Commission seats the top ${COMMISSION.SEATS} families. Earn the standing.`);
  const weight = COMMISSION.SEATS - seatIdx;
  const week = weekOf();
  const cur = (await client.query('SELECT 1 FROM commission_votes WHERE week=$1 AND gang_id=$2', [week, h.owned.gangId])).rows[0];
  if (cur) await client.query('UPDATE commission_votes SET decree=$3, weight=$4 WHERE week=$1 AND gang_id=$2', [week, h.owned.gangId, decreeId, weight]);
  else await client.query('INSERT INTO commission_votes (week, gang_id, decree, weight) VALUES ($1,$2,$3,$4)', [week, h.owned.gangId, decreeId, weight]);
  bus.emit(`gang:${h.owned.gangId}`, { type: 'commission_vote', decree: decreeId });
  await h.track(client, ch.account_id, 'commission_vote', { decree: decreeId, week, weight });
  return { ok: true, week, decree: decreeId, weight, takesEffectWeek: week + 1 };
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
  await client.query('INSERT INTO commission_vetoes (week, gang_id, decree) VALUES ($1,$2,$3)', [week, h.owned.gangId, decree.id]);
  bus.emit('streets', { type: 'commission_veto', family: seats[0].name, decree: decree.id });
  await h.track(client, ch.account_id, 'commission_veto', { decree: decree.id, week });
  return { ok: true, vetoed: decree.id, week };
}

// the chamber: seats, this week's public votes (with weights), the decree in force, any veto, the book
export async function commissionBoard(pool) {
  const week = weekOf();
  const seats = await seatedGangs(pool);
  const votes = (await pool.query(
    `SELECT v.decree, v.weight, g.name, g.tag FROM commission_votes v JOIN gangs g ON g.id = v.gang_id WHERE v.week=$1`, [week])).rows;
  const decree = await activeDecree(pool, week);
  const vetoRow = (await pool.query(
    'SELECT x.decree, g.name FROM commission_vetoes x JOIN gangs g ON g.id = x.gang_id WHERE x.week=$1', [week])).rows[0] || null;
  // the decree lapses when the week does (weeks are 7-day windows off the day epoch)
  const lapsesMs = (week + 1) * 7 * 86400000 - dayOf() * 86400000 - (Date.now() % 86400000);
  return {
    seats: seats.map((s, i) => ({ name: s.name, tag: s.tag, standing: Number(s.standing), weight: COMMISSION.SEATS - i })),
    votes: votes.map((v) => ({ family: v.name, tag: v.tag, decree: v.decree, weight: Number(v.weight) })), // public — politics is the content
    decree: decree ? { ...decree, lapsesSeconds: Math.max(0, Math.ceil(lapsesMs / 1000)) } : null,
    veto: vetoRow ? { family: vetoRow.name, decree: vetoRow.decree } : null,
    book: COMMISSION.DECREES, seatsCount: COMMISSION.SEATS, week,
  };
}
