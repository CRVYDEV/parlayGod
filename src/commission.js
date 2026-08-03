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
import { GameError, bus, ledger } from './game.js';
import { COMMISSION, decreeOf, weekOf, dayOf, statesmanRankOf } from './rules.js';

// THE STATESMAN (Tier-4) — bump the account's lifetime political-capital legend by DIRECT SQL (additive,
// NUMERIC → pg-mem-safe; OFF persistAccount's positional list → clobber-safe, the hitman_rep precedent).
const bumpStatecraft = (client, accountId, n) =>
  client.query('UPDATE account_persistent SET statecraft = statecraft + $2 WHERE account_id=$1', [accountId, n]);

// THE OVERRIDE — the CURRENT seated FLOOR (non-head) families' summed seat-weight that voted to override
// the head veto this week. Uses live seats (a family that overrode then lost its seat contributes 0).
async function overrideWeightOf(db, week) {
  const seats = await seatedGangs(db);
  // gang_id is TEXT here vs the gangs UUID column — coerce both to strings so the set lookup is exact
  const ov = new Set((await db.query('SELECT gang_id FROM commission_overrides WHERE week=$1', [week])).rows.map((r) => String(r.gang_id)));
  let w = 0;
  for (let i = 1; i < seats.length; i++) if (ov.has(String(seats[i].id))) w += (COMMISSION.SEATS - i); // exclude the head seat (i=0)
  return w;
}

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
    // NPC FAMILIES: never seated, EXPLICITLY. A resident-run family cannot vote, and a silent
    // ballot is not neutral — it shrinks the effective electorate and makes deadlock likelier, on a
    // chamber whose decrees modify signed surfaces (safehouse cost, war cost, laylow, convoy
    // defence, the loot rate). Today it is also true by accident, since the `standing > 0` filter
    // below excludes a family that neither pays tribute nor wins a war; the flag is what makes it a
    // promise a test can pin, and what stops a later step (residents paying tribute) re-opening it
    // in silence. NOTE the invariants deliberately do NOT exclude them — their treasuries are real
    // §10.4 buckets, and filtering there would manufacture the drift the check exists to catch.
    `SELECT id, name, tag, season_tribute + 10000 * season_wars AS standing FROM gangs
      WHERE NOT npc_flag AND season_tribute + 10000 * season_wars > 0
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

// step three — the TALLY winner of voting-week `week` (the decree its ballots enact). When any
// PROPOSALS exist for that week, only votes for PROPOSED decrees count (skin in the game sets the
// ballot — omerta-deep-deferred-design.md §B); with none, the chamber votes freely (backward-
// compatible). Tie or silence → deadlock (null). Shared by activeDecree (which adds the veto) and
// settleProposals (which pays on the TALLY — a veto kills the decree, not the vote).
export async function tallyWinner(db, week) {
  let ballots = await rankedBallots(db, week);
  const proposed = new Set((await db.query('SELECT decree FROM commission_proposals WHERE week=$1', [week])).rows.map((r) => r.decree));
  if (proposed.size) ballots = ballots.filter((b) => proposed.has(b.decree));
  if (!ballots.length) return null;
  const tally = {};
  for (const b of ballots) tally[b.decree] = (tally[b.decree] || 0) + b.weight;
  const sorted = Object.entries(tally).map(([decree, n]) => ({ decree, n })).sort((a, b) => b.n - a.n);
  if (sorted.length > 1 && sorted[0].n === sorted[1].n) return null; // the Commission deadlocked
  return decreeOf(sorted[0].decree);
}

// the decree in force for `week` = the weighted majority of week−1's top-ranked ballots (tie or
// silence → deadlock) — unless the head of the table killed it (the veto keys the governed week)
export async function activeDecree(db, week = weekOf()) {
  const winner = await tallyWinner(db, week - 1);
  if (!winner) return null;
  if ((await db.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [week])).rows[0]) {
    // killed at the table — UNLESS the floor mustered a supermajority OVERRIDE (Tier-4), which restores it
    if ((await overrideWeightOf(db, week)) < COMMISSION.OVERRIDE_WEIGHT) return null;
  }
  return winner;
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
      // THE STATESMAN — the FIRST cast of the week earns political capital (only the INSERT branch, so a
      // boss can't farm by re-casting — the earn is once/week/family, seat-gated). Own account, no cross-lock.
      await bumpStatecraft(client, ch.account_id, COMMISSION.STATECRAFT_VOTE);
    } catch { throw new GameError('again', 'The family just spoke — cast again to change the vote.'); }
  }
  bus.emit(`gang:${h.owned.gangId}`, { type: 'commission_vote', decree: decreeId });
  await h.track(client, ch.account_id, 'commission_vote', { decree: decreeId, week, standing });
  return { ok: true, week, decree: decreeId, weight: COMMISSION.SEATS - seatIdx, takesEffectWeek: week + 1 };
}

// step three — PROPOSE a decree for the week being voted, staking a treasury CASH deposit
// (`commission:proposal` — treasury → escrow, character_id NULL + counterparty=gang, the
// family-contract ledger pattern). One proposal per family per week; proposing sets the ballot
// (see tallyWinner). Settlement is the worker's settleProposals once the voting week freezes.
export async function proposeDecree(ch, decreeId, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss moves a motion for the family.');
  if (!decreeOf(decreeId)) throw new GameError('bad_decree', 'No such motion before the Commission.');
  const seats = await seatedGangs(client);
  if (!seats.some((s) => s.id === h.owned.gangId))
    throw new GameError('no_seat', `The Commission seats the top ${COMMISSION.SEATS} families. Earn the standing.`);
  const week = weekOf();
  const deposit = COMMISSION.PROPOSAL_DEPOSIT;
  // THE STATESMAN — bump the mover's political capital BEFORE the gang FOR UPDATE (keeps the canonical
  // accounts-before-gangs order; a failed propose rolls the whole withCharacter txn back, so no free earn).
  await bumpStatecraft(client, ch.account_id, COMMISSION.STATECRAFT_PROPOSE);
  // lock the family row (the postFamilyContract order: char → account → gang; no other locks follow)
  const g = (await client.query('SELECT id, treasury FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (!g) throw new GameError('no_gang', 'The family is gone.');
  if (Number(g.treasury) < deposit)
    throw new GameError('treasury', `A motion takes a $${deposit.toLocaleString()} deposit from the treasury.`);
  try {
    await client.query('INSERT INTO commission_proposals (week, gang_id, decree, deposit, proposer_account) VALUES ($1,$2,$3,$4,$5)',
      [week, h.owned.gangId, decreeId, deposit, ch.account_id]);
  } catch { throw new GameError('proposed', 'The family already has a motion on the table this week.'); }
  await client.query('UPDATE gangs SET treasury = treasury - $2 WHERE id=$1', [h.owned.gangId, deposit]);
  await h.ledger(client, { currency: 'cash', amount: -deposit, reason: 'commission:proposal', counterparty: h.owned.gangId });
  bus.emit('streets', { type: 'commission_proposal', family: seats.find((s) => s.id === h.owned.gangId)?.name, decree: decreeId });
  await h.track(client, ch.account_id, 'commission_proposal', { decree: decreeId, week, deposit });
  return { ok: true, week, decree: decreeId, deposit, takesEffectWeek: week + 1 };
}

// worker sweep — settle every proposal whose voting week has FROZEN: the proposal matching the
// TALLY-enacted decree refunds to its treasury (`commission:refund`); every other — including a
// deadlocked week's and a dissolved family's (dead-funder precedent) — FORFEITS to the street-tax
// pool (`commission:forfeit`, the confiscation pattern). Per-week txn; lock order gangs (sorted) →
// street_tax singleton (the canonical gangs→singletons order).
export async function settleProposals(pool, opts = {}) {
  const now = opts.week ?? weekOf();
  const dueWeeks = [...new Set((await pool.query(
    "SELECT week FROM commission_proposals WHERE status='open' AND week < $1", [now])).rows.map((r) => Number(r.week)))].sort();
  let refunded = 0, forfeited = 0;
  const enacted = []; // proposer accounts of motions that ENACTED — bonused POST-COMMIT (own-txn) below
  for (const week of dueWeeks) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // SINGLE-SOURCE the outcome through activeDecree(week+1): it computes the tally of `week` AND
      // applies the head veto AND the floor override on the GOVERNED week (week+1). So a vetoed-then-
      // overridden motion correctly ENACTS (refunds), a vetoed-not-overridden week hangs (all forfeit),
      // and a plain tally winner refunds — one code path, no drift vs the veto/override the players saw.
      const winner = await activeDecree(client, week + 1);
      const rows = (await client.query(
        "SELECT p.week, p.gang_id, p.decree, p.deposit, p.proposer_account FROM commission_proposals p WHERE p.status='open' AND p.week=$1", [week])).rows;
      // lock every proposer gang under FOR UPDATE and record which still EXIST — a dissolved winner
      // can't be refunded (the UPDATE would affect 0 rows while commission:refund credits a ghost →
      // treasury §10.4 drift); its deposit forfeits instead (the dead-funder precedent, matching the doc).
      const liveGang = new Set();
      for (const gid of rows.map((r) => r.gang_id).sort())
        if ((await client.query('SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE', [gid])).rows[0]) liveGang.add(gid);
      await client.query('SELECT 1 FROM street_tax WHERE id=1 FOR UPDATE');
      for (const p of rows) {
        const dep = Number(p.deposit);
        const won = liveGang.has(p.gang_id) && winner && p.decree === winner.id;
        if (won) {
          await client.query('UPDATE gangs SET treasury = treasury + $2 WHERE id=$1', [p.gang_id, dep]);
          await ledger(client, { currency: 'cash', amount: dep, reason: 'commission:refund', counterparty: p.gang_id });
          if (p.proposer_account) enacted.push(p.proposer_account); // political capital, paid post-commit
          refunded++;
        } else {
          await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [dep]);
          await ledger(client, { currency: 'cash', amount: -dep, reason: 'commission:forfeit', counterparty: p.gang_id });
          forfeited++;
        }
        await client.query("UPDATE commission_proposals SET status=$3 WHERE week=$1 AND gang_id=$2",
          [p.week, p.gang_id, won ? 'refunded' : 'forfeited']);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); console.error('[settleProposals]', week, e?.code || e?.message || e); }
    finally { client.release(); }
  }
  // THE STATESMAN — the proposer whose motion ENACTED earns the big political-capital prize. POST-COMMIT,
  // own-txn: an in-txn account bump under the held gangs+street_tax locks would invert accounts-before-gangs
  // (a real deadlock risk). A missed bump on a crash is a lost status point, not a §10.4 event — safe to retry-less.
  for (const acct of enacted) {
    try { await pool.query('UPDATE account_persistent SET statecraft = statecraft + $2 WHERE account_id=$1', [acct, COMMISSION.STATECRAFT_ENACTED]); }
    catch (e) { console.error('[settleProposals enacted]', acct, e?.message || e); }
  }
  return { refunded, forfeited };
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
  await bumpStatecraft(client, ch.account_id, COMMISSION.STATECRAFT_VETO); // wielding the veto is political capital
  bus.emit('streets', { type: 'commission_veto', family: seats[0].name, decree: decree.id });
  await h.track(client, ch.account_id, 'commission_veto', { decree: decree.id, week });
  return { ok: true, vetoed: decree.id, week };
}

// THE OVERRIDE (Tier-4) — the parliamentary check on the head veto. A SEATED FLOOR family (any seat
// but the head) moves to override; when the floor's summed seat-weight reaches OVERRIDE_WEIGHT the
// killed decree is RESTORED for the week (activeDecree reads this). Pure politics — no money, no lock
// beyond the row insert. One override per family per week; earns political capital either way.
export async function overrideVeto(ch, client, h) {
  if (h.owned.gangRole !== 'boss' && h.owned.gangRole !== 'underboss')
    throw new GameError('rank', 'Only the boss or underboss moves the family to override.');
  const week = weekOf();
  const seats = await seatedGangs(client);
  const seatIdx = seats.findIndex((s) => s.id === h.owned.gangId);
  if (seatIdx < 0)
    throw new GameError('no_seat', `The Commission seats the top ${COMMISSION.SEATS} families. Earn the standing.`);
  if (seatIdx === 0) throw new GameError('head', 'The head chair cast the veto — it cannot vote to override itself.');
  if (!(await client.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [week])).rows[0])
    throw new GameError('no_veto', 'There is no veto on the record to override.');
  try {
    await client.query('INSERT INTO commission_overrides (week, gang_id) VALUES ($1,$2)', [week, h.owned.gangId]);
  } catch { throw new GameError('again', 'The family has already moved to override this week.'); } // race loses cleanly on the PK
  await bumpStatecraft(client, ch.account_id, COMMISSION.STATECRAFT_OVERRIDE);
  const weight = await overrideWeightOf(client, week);
  const restored = weight >= COMMISSION.OVERRIDE_WEIGHT;
  bus.emit('streets', { type: 'commission_override', family: seats[seatIdx].name, restored });
  await h.track(client, ch.account_id, 'commission_override', { week, weight, restored });
  return { ok: true, week, weight, need: COMMISSION.OVERRIDE_WEIGHT, restored };
}

// THE STATESMEN — the survives-death political-capital board (account-level; the hitman-rep/world-hunter
// leaderboard twin: scan the legend, JOIN a living street for the name, agents excluded, status only).
export async function statesmenLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT a.statecraft, c.name FROM account_persistent a JOIN characters c ON c.account_id = a.account_id AND c.alive
      WHERE a.statecraft > 0 AND NOT a.agent_flag ORDER BY a.statecraft DESC LIMIT 25`)).rows;
  return { statesmen: rows.map((r) => ({ name: r.name, statecraft: Number(r.statecraft), rank: statesmanRankOf(r.statecraft).name })) };
}

// THE RECORD — the chamber's recent history (the last RECORD_WEEKS governed weeks): what decree held
// (or deadlock/vetoed), read-derived per week (no stored column — the read is cheap, Family-tab-cached).
async function chamberRecord(pool) {
  const cur = weekOf();
  const out = [];
  for (let w = cur; w > cur - COMMISSION.RECORD_WEEKS && w > 0; w--) {
    const decree = await activeDecree(pool, w);
    const vetoed = !!(await pool.query('SELECT 1 FROM commission_vetoes WHERE week=$1', [w])).rows[0];
    out.push({ week: w, decree: decree ? decree.id : null, name: decree ? decree.name : (vetoed ? 'Vetoed' : 'Deadlock'), vetoed });
  }
  return out;
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
  // step three — the week's motions on the table (public; when any exist, ONLY they are votable)
  const proposals = (await pool.query(
    // `::text` because `commission_proposals.gang_id` is the ONE gang_id in this schema declared UUID —
    // every sibling (commission_votes, commission_vetoes) is TEXT, like `gangs.id` itself. `text = uuid`
    // has no operator, so this whole board 500'd from the day proposals shipped and nobody noticed,
    // because pg-mem compares the two happily. Cast the proposals side: `gangs.id` is the PK doing the
    // lookup, and the proposals row set is already narrowed to one week. (`tools/pgquery.js` found this.)
    `SELECT p.decree, p.deposit, g.name, g.tag FROM commission_proposals p LEFT JOIN gangs g ON g.id = p.gang_id::text
      WHERE p.week=$1 ORDER BY p.at`, [week])).rows
    .map((p) => ({ family: p.name || '(a family now dissolved)', tag: p.tag || null, decree: p.decree, deposit: Number(p.deposit) }));
  // Tier-4 — the OVERRIDE state (only meaningful while a veto sits on the record), the RECORD (chamber
  // history), and the top STATESMEN (the survives-death political legend, public on the board)
  const ovWeight = vetoRow ? await overrideWeightOf(pool, week) : 0;
  const record = await chamberRecord(pool);
  const statesmenTop = (await statesmenLeaderboard(pool)).statesmen.slice(0, 5);
  // the decree lapses when the week does (weeks are 7-day windows off the day epoch)
  const lapsesMs = (week + 1) * 7 * 86400000 - dayOf() * 86400000 - (Date.now() % 86400000);
  return {
    seats: seats.map((s, i) => ({ name: s.name, tag: s.tag, standing: Number(s.standing), weight: COMMISSION.SEATS - i })),
    votes: votes.map((v) => ({ family: v.name, tag: v.tag, decree: v.decree, standing: Number(v.standing),
      weight: provisional[v.gang_id] || 0 })), // public — politics is the content
    decree: decree ? { ...decree, lapsesSeconds: Math.max(0, Math.ceil(lapsesMs / 1000)) } : null,
    veto: vetoRow ? { family: vetoRow.name || '(a family now dissolved)', decree: vetoRow.decree } : null,
    override: vetoRow ? { weight: ovWeight, need: COMMISSION.OVERRIDE_WEIGHT, restored: ovWeight >= COMMISSION.OVERRIDE_WEIGHT } : null,
    proposals, proposalDeposit: COMMISSION.PROPOSAL_DEPOSIT,
    record, statesmenTop, statesmanRanks: COMMISSION.STATESMAN_RANKS,
    book: COMMISSION.DECREES, seatsCount: COMMISSION.SEATS, week,
  };
}
