// THE COMMISSION (design: omerta-commission-design.md). The top-SEATS families by standing vote
// weekly on a city decree; the majority of week W−1's votes governs week W, tallied LAZILY by
// whoever asks (no ticks). One family one vote, changeable all week, and votes are PUBLIC — the
// politics is the content. No decree moves money: effects are bounded one-week modifiers applied
// at exactly one touchpoint each (safehouse / declareWar / laylow / convoy defense).
import { GameError, bus } from './game.js';
import { COMMISSION, decreeOf, weekOf, dayOf } from './rules.js';

// the standing ladder — the same formula the buyback pays (lifetime tribute + 10k per war won)
export async function seatedGangs(db) {
  return (await db.query(
    `SELECT id, name, tag, lifetime_tribute + 10000 * wars_won AS standing FROM gangs
      WHERE lifetime_tribute + 10000 * wars_won > 0
      ORDER BY lifetime_tribute + 10000 * wars_won DESC LIMIT ${COMMISSION.SEATS}`)).rows;
}

// the decree in force for `week` = the majority of week−1's votes (tie or silence → deadlock)
export async function activeDecree(db, week = weekOf()) {
  const votes = (await db.query('SELECT decree, COUNT(*) n FROM commission_votes WHERE week=$1 GROUP BY decree', [week - 1])).rows;
  if (!votes.length) return null;
  const sorted = votes.map((v) => ({ decree: v.decree, n: Number(v.n) })).sort((a, b) => b.n - a.n);
  if (sorted.length > 1 && sorted[0].n === sorted[1].n) return null; // the Commission deadlocked
  return decreeOf(sorted[0].decree);
}

// cast (or change) the family's vote — boss/underboss of a SEATED family only
export async function castVote(ch, decreeId, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  if (!decreeOf(decreeId)) throw new GameError('bad_decree', 'No such motion before the Commission.');
  const seats = await seatedGangs(client);
  if (!seats.some((s) => s.id === h.owned.gangId))
    throw new GameError('no_seat', `The Commission seats the top ${COMMISSION.SEATS} families. Earn the standing.`);
  const week = weekOf();
  const cur = (await client.query('SELECT 1 FROM commission_votes WHERE week=$1 AND gang_id=$2', [week, h.owned.gangId])).rows[0];
  if (cur) await client.query('UPDATE commission_votes SET decree=$3 WHERE week=$1 AND gang_id=$2', [week, h.owned.gangId, decreeId]);
  else await client.query('INSERT INTO commission_votes (week, gang_id, decree) VALUES ($1,$2,$3)', [week, h.owned.gangId, decreeId]);
  bus.emit(`gang:${h.owned.gangId}`, { type: 'commission_vote', decree: decreeId });
  await h.track(client, ch.account_id, 'commission_vote', { decree: decreeId, week });
  return { ok: true, week, decree: decreeId, takesEffectWeek: week + 1 };
}

// the chamber: seats, this week's public votes, the decree in force, the book
export async function commissionBoard(pool) {
  const week = weekOf();
  const seats = await seatedGangs(pool);
  const votes = (await pool.query(
    `SELECT v.decree, g.name, g.tag FROM commission_votes v JOIN gangs g ON g.id = v.gang_id WHERE v.week=$1`, [week])).rows;
  const decree = await activeDecree(pool, week);
  // the decree lapses when the week does (weeks are 7-day windows off the day epoch)
  const lapsesMs = (week + 1) * 7 * 86400000 - dayOf() * 86400000 - (Date.now() % 86400000);
  return {
    seats: seats.map((s) => ({ name: s.name, tag: s.tag, standing: Number(s.standing) })),
    votes: votes.map((v) => ({ family: v.name, tag: v.tag, decree: v.decree })), // public — politics is the content
    decree: decree ? { ...decree, lapsesSeconds: Math.max(0, Math.ceil(lapsesMs / 1000)) } : null,
    book: COMMISSION.DECREES, seatsCount: COMMISSION.SEATS, week,
  };
}
