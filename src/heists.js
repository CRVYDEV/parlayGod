// CREW HEISTS — THE BIG SCORE (design: omerta-crew-heists-design.md). The game's first co-op
// content: a leader fronts the stake, a crew fills off the open board, one server roll decides
// the job for everyone — shared take, shared jail, and the rat option. §10.4: the stake is a
// cash sink (heist:crew:stake, refunded only on pre-execution disband), every share/informant
// payout a per-character faucet (heist:crew / heist:crew:rat) riding the existing 'heist'
// vocabulary prefix. Lock discipline: leader (withCharacter) → member character rows in sorted
// id order → the heist row; one-active-heist-per-character makes concurrent executes disjoint,
// so the order is acyclic. Members are paid/jailed by direct row updates under lock (they are
// never in-memory in the leader's transaction — no persistCharacter clobber).
import crypto from 'node:crypto';
import { GameError, bus } from './game.js';
import { HEIST_JOBS, heistJobOf, HEIST_PLAN_TTL_MS, HEIST_RAT_BPS, HEIST_LEADER_WEIGHT,
         M4, levelOf } from './rules.js';

const uid = () => crypto.randomUUID();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const cooling = (ch) => ch.heist_at && new Date(ch.heist_at) > new Date();
const stale = (row) => Date.now() - new Date(row.created_at).getTime() > HEIST_PLAN_TTL_MS;

async function activeMembership(client, characterId) {
  return (await client.query(
    `SELECT m.heist_id FROM crew_heist_members m JOIN crew_heists ch ON ch.id = m.heist_id
      WHERE m.character_id=$1 AND ch.status='planning'`, [characterId])).rows[0] || null;
}

function gateJoiner(ch, job) {
  if (jailed(ch)) throw new GameError('jailed', 'Nobody plans a score from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "Not in your condition. See the Doc first.");
  if (cooling(ch)) throw new GameError('cooldown', 'Your next job lines up later — one Score per window.');
  if (levelOf(Number(ch.respect)) < job.lvl) throw new GameError('level', `${job.name} wants made players — level ${job.lvl}.`);
}

// PLAN — the leader picks the job and fronts the stake (tools & bribes; sunk once you go).
export async function planHeist(ch, jobId, client, h) {
  const job = heistJobOf(jobId);
  if (!job) throw new GameError('bad_job', 'No such job on the books.');
  gateJoiner(ch, job);
  if (await activeMembership(client, ch.id)) throw new GameError('busy', "You're already on a job.");
  if (Number(ch.cash) < job.stake) throw new GameError('cash', `${job.name} takes $${job.stake} up front — tools and bribes.`);
  ch.cash = Number(ch.cash) - job.stake;
  const id = uid();
  await client.query('INSERT INTO crew_heists (id, job, leader_character) VALUES ($1,$2,$3)', [id, job.id, ch.id]);
  await client.query('INSERT INTO crew_heist_members (heist_id, character_id, role) VALUES ($1,$2,$3)', [id, ch.id, 'leader']);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -job.stake, reason: 'heist:crew:stake' });
  await h.track(client, ch.account_id, 'heist_plan', { job: job.id });
  return { ok: true, id, job: job.id, name: job.name, crewNeeded: job.crew - 1, stake: job.stake };
}

// JOIN — off the open board; the job's gates apply to every member.
export async function joinHeist(ch, heistId, client, h) {
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  if (stale(row)) throw new GameError('stale', 'That plan went cold.');
  const job = heistJobOf(row.job);
  gateJoiner(ch, job);
  if (await activeMembership(client, ch.id)) throw new GameError('busy', "You're already on a job.");
  const n = Number((await client.query('SELECT COUNT(*) n FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows[0].n);
  if (n >= job.crew) throw new GameError('full', 'The crew is set.');
  await client.query('INSERT INTO crew_heist_members (heist_id, character_id) VALUES ($1,$2)', [heistId, ch.id]);
  await h.track(client, ch.account_id, 'heist_join', { job: job.id });
  return { ok: true, id: heistId, job: job.id, crew: n + 1, crewNeeded: job.crew - n - 1 };
}

// LEAVE — a member walks; the LEADER walking disbands the job and takes the stake back whole.
export async function leaveHeist(ch, heistId, client, h) {
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  const mine = (await client.query('SELECT 1 FROM crew_heist_members WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id])).rows[0];
  if (!mine) throw new GameError('not_crew', "You're not on that job.");
  if (row.leader_character === ch.id) {
    const job = heistJobOf(row.job);
    ch.cash = Number(ch.cash) + job.stake; // pre-execution disband: the stake comes back whole
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: job.stake, reason: 'heist:crew:stake' });
    await client.query("UPDATE crew_heists SET status='abandoned' WHERE id=$1", [heistId]);
    await client.query('DELETE FROM crew_heist_members WHERE heist_id=$1', [heistId]);
    return { ok: true, disbanded: true, refunded: job.stake };
  }
  await client.query('DELETE FROM crew_heist_members WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id]);
  return { ok: true, left: true };
}

// THE RAT — a silent flag during planning. Never surfaced by name, not even after.
export async function ratHeist(ch, heistId, client, h) {
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning'", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  const upd = await client.query('UPDATE crew_heist_members SET ratted=true WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id]);
  if (!upd.rowCount) throw new GameError('not_crew', "You're not on that job.");
  await h.track(client, ch.account_id, 'heist_rat', { job: row.job });
  return { ok: true }; // the response is as quiet as the act
}

// EXECUTE — leader-only, crew full, everyone ready. One roll for everyone.
export async function executeHeist(ch, heistId, client, h) {
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  if (row.leader_character !== ch.id) throw new GameError('not_leader', 'The leader calls the go.');
  if (stale(row)) throw new GameError('stale', 'That plan went cold — walk away and start fresh.');
  const job = heistJobOf(row.job);
  const members = (await client.query('SELECT character_id, ratted FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows;
  if (members.length < job.crew) throw new GameError('crew_short', `${job.name} needs ${job.crew} — you have ${members.length}.`);
  // lock every OTHER member's character row in sorted id order (the leader is already held by
  // withCharacter; one-active-heist keeps concurrent executes disjoint, so this can't cycle)
  const others = {};
  for (const id of members.map((m) => m.character_id).filter((id) => id !== ch.id).sort()) {
    const r = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    if (!r) throw new GameError('crew_not_ready', 'One of the crew is in the ground. Recrew.');
    others[id] = r;
  }
  const crewRows = [ch, ...Object.values(others)];
  for (const m of crewRows)
    if (jailed(m) || hospitalized(m) || (m.id !== ch.id && cooling(m)))
      throw new GameError('crew_not_ready', 'The whole crew shows up clean, healthy, and rested — or nobody goes.');
  if (cooling(ch)) throw new GameError('cooldown', 'Your next job lines up later.');

  const doneAt = new Date(Date.now() + M4.HEIST_CD_MS);
  const setMember = async (id, cols, params) => client.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id, ...params]);
  await client.query("UPDATE crew_heists SET status='done' WHERE id=$1", [heistId]);

  // THE RAT WINS FIRST: a flagged job never fires — the informer walks with the payout, the
  // rest eat double time, and the street only ever hears that somebody talked.
  const rats = members.filter((m) => m.ratted).map((m) => m.character_id);
  if (rats.length) {
    const payoutTotal = Math.floor(job.stake * HEIST_RAT_BPS / 10000);
    const share = Math.floor(payoutTotal / rats.length);
    for (const m of crewRows) {
      const isRat = rats.includes(m.id);
      if (isRat && share > 0) {
        if (m.id === ch.id) ch.cash = Number(ch.cash) + share;
        else await setMember(m.id, 'cash = cash + $2, heist_at=$3', [share, doneAt]);
        await h.ledger(client, { characterId: m.id, currency: 'cash', amount: share, reason: 'heist:crew:rat' });
      }
      const jailTo = new Date(Date.now() + job.jailS * 2 * 1000);
      if (m.id === ch.id) { ch.heist_at = doneAt; if (!isRat) ch.jail_until = jailTo; }
      else if (isRat) { if (share <= 0) await setMember(m.id, 'heist_at=$2', [doneAt]); }
      else await setMember(m.id, 'jail_until=$2, heist_at=$3', [jailTo, doneAt]);
      if (m.id !== ch.id) await h.notify(client, m.id, 'heist_blown', { job: job.name });
    }
    await h.rngLog(client, ch.id, `heist:${job.id}`, 0, 'blown — somebody talked');
    bus.emit('streets', { type: 'heist_blown', job: job.name });
    return { ok: true, blown: true, job: job.id, message: 'The law was waiting. Somebody talked.' };
  }

  // the roll — crew stats move the needle, the job sets the floor
  const avgStats = crewRows.reduce((a, m) => a + Number(m.muscle) + Number(m.cunning) + Number(m.speed), 0) / crewRows.length;
  const p = Math.min(0.92, Math.max(0.15, job.base + (avgStats - 30) / 1000));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `heist:${job.id}`, roll, `${roll < p ? 'score' : 'bust'} (P ${p.toFixed(3)}, crew ${crewRows.length})`);

  if (roll < p) {
    const avgLvl = crewRows.reduce((a, m) => a + levelOf(Number(m.respect)), 0) / crewRows.length;
    const pot = Math.floor(rand(job.takePerLvl[0], job.takePerLvl[1]) * avgLvl);
    const unit = pot / (HEIST_LEADER_WEIGHT + (crewRows.length - 1));
    const shares = {};
    for (const m of crewRows) shares[m.id] = Math.floor(unit * (m.id === ch.id ? HEIST_LEADER_WEIGHT : 1));
    for (const m of crewRows) {
      if (m.id === ch.id) { ch.cash = Number(ch.cash) + shares[m.id]; ch.respect = Number(ch.respect) + job.rep; ch.heist_at = doneAt; }
      else {
        await setMember(m.id, 'cash = cash + $2, respect = respect + $3, heist_at=$4', [shares[m.id], job.rep, doneAt]);
        await h.notify(client, m.id, 'heist_score', { job: job.name, share: shares[m.id] });
      }
      await h.ledger(client, { characterId: m.id, currency: 'cash', amount: shares[m.id], reason: 'heist:crew' });
    }
    await h.track(client, ch.account_id, 'heist_score', { job: job.id, pot, crew: crewRows.length });
    bus.emit('streets', { type: 'heist_score', job: job.name, pot, crew: crewRows.length });
    return { ok: true, score: true, job: job.id, pot, share: shares[ch.id], rep: job.rep };
  }

  // the bust — the whole crew goes down together
  const jailTo = new Date(Date.now() + job.jailS * 1000);
  for (const m of crewRows) {
    if (m.id === ch.id) { ch.jail_until = jailTo; ch.heist_at = doneAt; }
    else { await setMember(m.id, 'jail_until=$2, heist_at=$3', [jailTo, doneAt]); await h.notify(client, m.id, 'heist_bust', { job: job.name, jailS: job.jailS }); }
  }
  bus.emit('streets', { type: 'heist_bust', job: job.name, crew: crewRows.length });
  return { ok: true, score: false, job: job.id, jailSeconds: job.jailS };
}

// The board: the catalog, open jobs looking for crew, and my active job (rat flags NEVER surface).
export async function heistBoard(pool, characterId) {
  // two flat queries instead of a correlated subquery — pg-mem (the test db) can't parse the
  // latter (the GET /v1/gangs precedent), and the flat form is fine on real Postgres too
  const openRows = (await pool.query(
    `SELECT ch.id, ch.job, ch.created_at, c.name AS leader
       FROM crew_heists ch JOIN characters c ON c.id = ch.leader_character
      WHERE ch.status='planning' ORDER BY ch.created_at DESC LIMIT 30`)).rows;
  const counts = (await pool.query('SELECT heist_id, COUNT(*) n FROM crew_heist_members GROUP BY heist_id')).rows;
  const nOf = Object.fromEntries(counts.map((r) => [r.heist_id, Number(r.n)]));
  const open = openRows.filter((r) => !stale(r))
    .map((r) => { const j = heistJobOf(r.job); return { id: r.id, job: r.job, name: j.name, leader: r.leader,
      crew: nOf[r.id] || 0, crewNeeded: j.crew - (nOf[r.id] || 0), lvl: j.lvl, stake: j.stake }; });
  const mine = (await pool.query(
    `SELECT ch.id, ch.job, ch.leader_character FROM crew_heists ch
       JOIN crew_heist_members m ON m.heist_id = ch.id
      WHERE m.character_id=$1 AND ch.status='planning'`, [characterId])).rows[0] || null;
  let my = null;
  if (mine) {
    const crew = (await pool.query(
      'SELECT c.name, m.role FROM crew_heist_members m JOIN characters c ON c.id = m.character_id WHERE m.heist_id=$1', [mine.id])).rows;
    const j = heistJobOf(mine.job);
    my = { id: mine.id, job: mine.job, name: j.name, leader: mine.leader_character === characterId,
      crew: crew.map((c) => ({ name: c.name, role: c.role })), crewNeeded: j.crew - crew.length };
  }
  return { jobs: HEIST_JOBS.map((j) => ({ id: j.id, name: j.name, crew: j.crew, lvl: j.lvl, stake: j.stake,
    base: j.base, takePerLvl: j.takePerLvl, jailS: j.jailS })), open, mine: my };
}

// Worker sweep: stale plans are abandoned and a LIVING leader takes the stake back (per-heist
// transaction, leader character row locked BEFORE the heist row — the bounty-sweep discipline).
export async function sweepStaleHeists(pool) {
  const client = await pool.connect();
  let swept = 0;
  try {
    const staleRows = (await client.query(
      `SELECT id, job, leader_character FROM crew_heists WHERE status='planning' AND created_at < now() - interval '${Math.floor(HEIST_PLAN_TTL_MS / 1000)} seconds'`)).rows;
    for (const s of staleRows) {
      await client.query('BEGIN');
      try {
        const leader = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive FOR UPDATE', [s.leader_character])).rows[0];
        const again = (await client.query("SELECT 1 FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [s.id])).rows[0];
        if (!again) { await client.query('COMMIT'); continue; }
        const job = heistJobOf(s.job);
        if (leader && job) {
          await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [s.leader_character, job.stake]);
          await client.query('INSERT INTO transactions (id, character_id, currency, amount, reason) VALUES ($1,$2,$3,$4,$5)',
            [uid(), s.leader_character, 'cash', job.stake, 'heist:crew:stake']);
        } // a dead leader's stake stays sunk — no corpse refunds
        await client.query("UPDATE crew_heists SET status='abandoned' WHERE id=$1", [s.id]);
        await client.query('DELETE FROM crew_heist_members WHERE heist_id=$1', [s.id]);
        await client.query('COMMIT');
        swept++;
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    return { swept };
  } finally { client.release(); }
}
