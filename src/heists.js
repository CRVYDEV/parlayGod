// CREW HEISTS — THE BIG SCORE (design: omerta-crew-heists-design.md). The game's first co-op
// content: a leader fronts the stake, a crew fills off the open board, one server roll decides
// the job for everyone — shared take, shared jail, and the rat option. §10.4: the stake is a
// cash sink (heist:crew:stake, refunded only on pre-execution disband), every share/informant
// payout a per-character faucet (heist:crew / heist:crew:rat) riding the existing 'heist'
// vocabulary prefix. Step two: every crew slot is a ROLE (the success roll reads each member's
// stat FOR THEIR ROLE), and the INSIDE JOB raids a PLAYER's business — its pot is rateBps of
// the front's PENDING income redirected to the crew ('heist:inside', the shakedown argument:
// bounded by incomePerHr either way, the owner keeps the rest and the clock advances by only
// the stolen share — NOT a new faucet). Lock discipline: leader (withCharacter) → member
// character rows in sorted id order → the heist row → the target business row (terminal; the
// MARK's character row is never locked — the venue is the contested object, not the man);
// one-active-heist-per-character makes concurrent executes disjoint, so the order is acyclic.
// Members are paid/jailed by direct row updates under lock (they are never in-memory in the
// leader's transaction — no persistCharacter clobber).
import crypto from 'node:crypto';
import { GameError, bus, bumpMastery, gainRespect } from './game.js';
import { HEIST_JOBS, HEIST_ROLES, heistJobOf, HEIST_PLAN_TTL_MS, HEIST_RAT_BPS, HEIST_LEADER_WEIGHT,
         HEIST_INSIDE_CD_MS, HEIST_CASE_ENERGY, HEIST_CASE_STEP, HEIST_CASE_MAX, heistFenceMultOf,
         HEIST_FENCE_HEAT, HEIST_RANKS, heistRankOf, HEIST_FILL_MAX, HEIST_FILL_FEE,
         CONSTANTS, M4, levelOf, jailed, hospitalized, safeHoused, usd } from './rules.js';
import { accrued, decayedScrutiny, npcPendingScale } from './business.js';
import { dbCaps } from './db.js';

const uid = () => crypto.randomUUID();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const cooling = (ch) => ch.heist_at && new Date(ch.heist_at) > new Date();
const stale = (row) => Date.now() - new Date(row.created_at).getTime() > HEIST_PLAN_TTL_MS;

async function activeMembership(client, characterId) {
  return (await client.query(
    `SELECT m.heist_id FROM crew_heist_members m JOIN crew_heists ch ON ch.id = m.heist_id
      WHERE m.character_id=$1 AND ch.status='planning'`, [characterId])).rows[0] || null;
}

function gateJoiner(ch, job, pulled = 0) {
  if (jailed(ch)) throw new GameError('jailed', 'Nobody plans a score from lockup.');
  if (hospitalized(ch)) throw new GameError('hosp', "Not in your condition. See the Doc first.");
  // P1.3/D2 (audit H1): a safehouse is a shield, not a base of operations — no crew work from it
  if (safeHoused(ch)) throw new GameError('safe', "No jobs from a safehouse — a shield, not a bunker.");
  if (cooling(ch)) throw new GameError('cooldown', 'Your next job lines up later — one Score per window.');
  if (levelOf(Number(ch.respect)) < job.lvl) throw new GameError('level', `${job.name} wants made players — level ${job.lvl}.`);
  // Tier-4 §D: the marquee jobs are notoriety-gated — you earn your way up to the big scores
  if (job.minPulled && Number(pulled) < job.minPulled)
    throw new GameError('notoriety', `${job.name} only takes proven crews — pull ${job.minPulled} scores first (you have ${pulled}).`);
}
// lifetime successful heists (account-level, survives death) — for the minPulled notoriety gate
async function pulledOf(client, accountId) {
  return Number((await client.query('SELECT heists_pulled FROM account_persistent WHERE account_id=$1', [accountId])).rows[0]?.heists_pulled || 0);
}

// step two: every slot is a ROLE — pick one or take the first open seat; each claimed once.
function pickRole(job, want, taken) {
  if (want && !job.roles.includes(want))
    throw new GameError('bad_role', `${job.name} needs: ${job.roles.join(', ')}.`);
  const open = job.roles.filter((r) => !taken.includes(r));
  if (want && !open.includes(want)) throw new GameError('role_taken', `Someone already has the ${want} seat.`);
  return want || open[0];
}

// PLAN — the leader picks the job and fronts the stake (tools & bribes; sunk once you go).
// Step two: `role` claims the leader's seat; the INSIDE JOB takes a `businessId` mark.
export async function planHeist(ch, jobId, opts, client, h) {
  const { role: wantRole, businessId, fence } = opts || {};
  const job = heistJobOf(jobId);
  if (!job) throw new GameError('bad_job', 'No such job on the books.');
  gateJoiner(ch, job, await pulledOf(client, ch.account_id));
  if (await activeMembership(client, ch.id)) throw new GameError('busy', "You're already on a job.");
  if (Number(ch.cash) < job.stake) throw new GameError('cash', `${job.name} takes ${usd(job.stake)} up front — tools and bribes.`);
  let target = null;
  if (job.rateBps) { // the inside job wants a mark — a PLAYER's front (light checks now, the real gates at execute)
    if (!businessId) throw new GameError('no_mark', 'An inside job needs a mark — name the front.');
    const biz = (await client.query('SELECT character_id FROM businesses WHERE id=$1', [businessId])).rows[0];
    if (!biz) throw new GameError('no_mark', 'No such front in town.');
    if (biz.character_id === ch.id) throw new GameError('own_mark', "Robbing your own till isn't a job, it's an accounting problem.");
    target = businessId;
  }
  const role = pickRole(job, wantRole, []);
  // Tier-4 §C: the leader can elect to take a STANDARD score HOT (banked as fenceable loot, not cash) —
  // never for an inside job (its pot is a shakedown of pending income, always cash)
  const fenced = !!fence && !job.rateBps;
  ch.cash = Number(ch.cash) - job.stake;
  const id = uid();
  await client.query('INSERT INTO crew_heists (id, job, leader_character, target_business, fenced) VALUES ($1,$2,$3,$4,$5)', [id, job.id, ch.id, target, fenced]);
  await client.query('INSERT INTO crew_heist_members (heist_id, character_id, role) VALUES ($1,$2,$3)', [id, ch.id, role]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -job.stake, reason: 'heist:crew:stake' });
  await h.track(client, ch.account_id, 'heist_plan', { job: job.id });
  // `op` names the SYSTEM, because three of them (a crew heist, a world raid, a prison break) all
  // answer plan/join with an id and a crew count, and a client keyed on the FIELDS renders whichever
  // branch it reaches first. Absence is not a discriminator: it holds only until a sibling adds the
  // field you were relying on being missing. The disband/leave replies below already carry it.
  return { ok: true, op: 'heist', id, job: job.id, name: job.name, role, crewNeeded: job.crew - 1, stake: job.stake, fenced };
}

// JOIN — off the open board; the job's gates apply to every member. `role` picks your seat.
export async function joinHeist(ch, heistId, wantRole, client, h) {
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  if (stale(row)) throw new GameError('stale', 'That plan went cold.');
  const job = heistJobOf(row.job);
  gateJoiner(ch, job, await pulledOf(client, ch.account_id));
  if (await activeMembership(client, ch.id)) throw new GameError('busy', "You're already on a job.");
  const taken = (await client.query('SELECT role FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows.map((r) => r.role);
  if (taken.length >= job.crew) throw new GameError('full', 'The crew is set.');
  if (row.target_business) { // nobody robs their own till from the inside of the crew
    const biz = (await client.query('SELECT character_id FROM businesses WHERE id=$1', [row.target_business])).rows[0];
    if (biz && biz.character_id === ch.id) throw new GameError('own_mark', "That's YOUR front they're casing.");
  }
  const role = pickRole(job, wantRole, taken);
  await client.query('INSERT INTO crew_heist_members (heist_id, character_id, role) VALUES ($1,$2,$3)', [heistId, ch.id, role]);
  await h.track(client, ch.account_id, 'heist_join', { job: job.id });
  return { ok: true, op: 'heist', id: heistId, job: job.id, name: job.name, role, crew: taken.length + 1, crewNeeded: job.crew - taken.length - 1 };
}

// FILL — the leader hires an NPC RESIDENT into an open seat (residents-in-crews). A hired hand is a
// real is_npc character (so executeHeist's per-member lock/roll/gates are unchanged), but its pot
// share is FORFEITED at execute — never minted, so the co-op faucet only shrinks and §10.4 is
// untouched. HEIST_FILL_MAX caps fillers so the marquee jobs stay multiplayer; a HEIST_FILL_FEE cash
// sink makes hiring a real decision. A hand never rats and earns no legend/xp/rwa/respect.
export async function fillHeist(ch, heistId, wantRole, client, h) {
  if (HEIST_FILL_MAX <= 0) throw new GameError('no_fill', 'The crews want real bodies.');
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  if (row.leader_character !== ch.id) throw new GameError('not_leader', 'Only the leader hires the crew.');
  if (stale(row)) throw new GameError('stale', 'That plan went cold.');
  const job = heistJobOf(row.job);
  const members = (await client.query('SELECT role, hired FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows;
  if (members.length >= job.crew) throw new GameError('full', 'The crew is set.');
  const hiredCount = members.filter((m) => m.hired).length;
  if (hiredCount >= HEIST_FILL_MAX)
    throw new GameError('fill_capped', `${job.name} takes at most ${HEIST_FILL_MAX} hired hand${HEIST_FILL_MAX === 1 ? '' : 's'} — the rest are real bodies.`);
  if (Number(ch.cash) < HEIST_FILL_FEE) throw new GameError('cash', `A hand wants ${usd(HEIST_FILL_FEE)} up front — tools and their cut.`);
  const role = pickRole(job, wantRole, members.map((m) => m.role));
  // pick a FREE resident — same readiness a real crewman needs at execute, so a hand can never be the
  // reason a go fails; and NOT already on a live plan (residentAct/retire skip committed residents).
  // prefer a resident standing in the leader's district (flavour), else any free body. Two flat
  // queries — pg-mem can't parse a CASE-in-ORDER-BY over an alias (the /v1/gangs precedent).
  // AUDIT-hired-hand LOW: FOR UPDATE SKIP LOCKED so two concurrent fills take DIFFERENT bodies (the
  // chosen resident is locked until this txn commits; a racing fill skips it — the THE TAKE / dbCaps
  // pattern). pg-mem parses neither, so its fallback picks correctly and just doesn't prevent the race
  // (which pg-mem, single-caller, cannot exercise). Locking the resident LAST (after leader + heist row)
  // can't cycle: a candidate is by definition NOT in any planning heist, so executeHeist never holds it.
  const lock = dbCaps.skipLocked ? 'FOR UPDATE SKIP LOCKED' : '';
  const freeQ = (extra, params) => client.query(
    `SELECT id FROM characters WHERE is_npc AND alive
       AND (jail_until IS NULL OR jail_until < now())
       AND (hosp_until IS NULL OR hosp_until < now())
       AND (safe_until IS NULL OR safe_until < now())
       AND id NOT IN (SELECT m.character_id FROM crew_heist_members m
                        JOIN crew_heists ch2 ON ch2.id = m.heist_id WHERE ch2.status='planning')
       ${extra} ORDER BY id LIMIT 1 ${lock}`, params);
  const free = (await freeQ('AND loc = $1', [ch.loc])).rows[0] || (await freeQ('', [])).rows[0];
  if (!free) throw new GameError('no_hand', 'Nobody on the street will take the job right now.');
  ch.cash = Number(ch.cash) - HEIST_FILL_FEE;
  await client.query('INSERT INTO crew_heist_members (heist_id, character_id, role, hired) VALUES ($1,$2,$3,true)', [heistId, free.id, role]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -HEIST_FILL_FEE, reason: 'heist:hire' });
  await h.track(client, ch.account_id, 'heist_fill', { job: job.id, role });
  return { ok: true, id: heistId, job: job.id, name: job.name, role, hired: true, fee: HEIST_FILL_FEE,
           crew: members.length + 1, crewMax: job.crew, crewNeeded: job.crew - members.length - 1 };
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
    return { ok: true, op: 'heist', disbanded: true, refunded: job.stake };
  }
  await client.query('DELETE FROM crew_heist_members WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id]);
  return { ok: true, op: 'heist', left: true };
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

// THE CASING PHASE (Tier-4 §B) — a crew member spends energy to case the job (once each); every
// cased member raises the crew's success roll a notch, capped so casing never guarantees a score.
export async function caseJob(ch, heistId, client, h) {
  const row = (await client.query("SELECT id FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  const mine = (await client.query('SELECT cased FROM crew_heist_members WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id])).rows[0];
  if (!mine) throw new GameError('not_crew', "You're not on that job.");
  if (mine.cased) throw new GameError('cased', "You've already cased this one — you can't case it twice.");
  if (Number(ch.energy) < HEIST_CASE_ENERGY) throw new GameError('energy', `Casing the joint takes ${HEIST_CASE_ENERGY} energy.`);
  ch.energy = Number(ch.energy) - HEIST_CASE_ENERGY; // energy IS persisted positionally — no clobber
  await client.query('UPDATE crew_heist_members SET cased=true WHERE heist_id=$1 AND character_id=$2', [heistId, ch.id]);
  await h.track(client, ch.account_id, 'heist_case', { heist: heistId });
  return { ok: true, cased: true, bonusStep: HEIST_CASE_STEP };
}

// THE FENCE (Tier-4 §C) — sell ALL warehoused HOT LOOT at today's drifting fence rate (a bounded cash
// faucet centered below 1.0, so it's a variance play, never a net faucet increase). Draws heat — moving
// hot goods is exposure. A marked man's stash can be looted on a fire-kill (P1.1 twin, in social.js).
export async function fenceLoot(ch, client, h) {
  // D2 parity (AUDIT-tier1-deepening): fencing is an income-REALIZING act, so it can't be run from a
  // safehouse — otherwise a crew takes a score HOT, goes to ground, and converts it from cover, dodging
  // the fire-kill hot-loot exposure the risk layer is for. Matches every other collect/realize gate.
  if (safeHoused(ch)) throw new GameError('safe', "No fence takes a meeting with a ghost — the loot waits until you surface.");
  const loot = Math.floor(Number(ch.heist_loot || 0));
  if (loot <= 0) throw new GameError('nothing', "You've got no hot loot to move.");
  const mult = heistFenceMultOf();
  const paid = Math.floor(loot * mult);
  ch.cash = Number(ch.cash) + paid;                    // cash + heat ARE persisted positionally
  ch.heat = Math.min(100, Number(ch.heat) + HEIST_FENCE_HEAT);
  ch.heist_loot = 0;                                    // keep the in-memory view honest (direct-SQL column)
  await client.query('UPDATE characters SET heist_loot = 0 WHERE id=$1', [ch.id]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: paid, reason: 'heist:fence' });
  await h.track(client, ch.account_id, 'heist_fence', { loot, paid });
  return { ok: true, loot, mult: +mult.toFixed(3), paid };
}

// EXECUTE — leader-only, crew full, everyone ready. One roll for everyone.
// Lock order (audit M1): leader (withCharacter) → member character rows SORTED → the heist row
// → the target business row. The heist row is read UNLOCKED first to learn the crew, then
// re-read under its lock — if the crew shifted in between, the call retries cleanly. This keeps
// characters-before-pots global order (leave/join lock own char → heist row).
export async function executeHeist(ch, heistId, client, h) {
  if (safeHoused(ch)) throw new GameError('safe', "No jobs from a safehouse — a shield, not a bunker.");
  const pre = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning'", [heistId])).rows[0];
  if (!pre) throw new GameError('no_heist', 'That job is gone.');
  if (pre.leader_character !== ch.id) throw new GameError('not_leader', 'The leader calls the go.');
  if (stale(pre)) throw new GameError('stale', 'That plan went cold — walk away and start fresh.');
  const job = heistJobOf(pre.job);
  const preIds = (await client.query('SELECT character_id FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows
    .map((r) => r.character_id);
  // member character rows first, sorted (the leader is already held by withCharacter;
  // one-active-heist keeps concurrent executes disjoint, so this can't cycle among executes)
  const others = {};
  for (const id of preIds.filter((id) => id !== ch.id).sort()) {
    const r = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    if (!r) throw new GameError('crew_not_ready', 'One of the crew is in the ground. Recrew.');
    others[id] = r;
  }
  // NOW the heist row — and verify the crew we locked is still the crew
  const row = (await client.query("SELECT * FROM crew_heists WHERE id=$1 AND status='planning' FOR UPDATE", [heistId])).rows[0];
  if (!row) throw new GameError('no_heist', 'That job is gone.');
  const members = (await client.query('SELECT character_id, ratted, role, cased, hired FROM crew_heist_members WHERE heist_id=$1', [heistId])).rows;
  const hiredIds = new Set(members.filter((m) => m.hired).map((m) => m.character_id)); // hired hands: forfeit their cut, no legend/xp/rwa/respect (residents-in-crews)
  if (members.map((m) => m.character_id).sort().join() !== [...preIds].sort().join())
    throw new GameError('crew_changed', 'The crew shifted under you — call the go again.');
  if (members.length < job.crew) throw new GameError('crew_short', `${job.name} needs ${job.crew} — you have ${members.length}.`);
  const crewRows = [ch, ...Object.values(others)];
  for (const m of crewRows)
    if (jailed(m) || hospitalized(m) || safeHoused(m) || (m.id !== ch.id && cooling(m)))
      throw new GameError('crew_not_ready', 'The whole crew shows up clean, healthy, rested, and OUT of hiding — or nobody goes.');
  if (cooling(ch)) throw new GameError('cooldown', 'Your next job lines up later.');

  // INSIDE JOB gates — validated (and the venue locked) BEFORE the job fires, so a failed gate
  // leaves the plan intact. Lock order: member characters → heist row → the business row
  // (terminal — the MARK's character row is never locked; the venue is the contested object).
  let biz = null;
  if (row.target_business) {
    biz = (await client.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [row.target_business])).rows[0];
    if (!biz) throw new GameError('mark_gone', 'The mark folded — that front is no more. Walk away.');
    if (members.some((m) => m.character_id === biz.character_id))
      throw new GameError('own_mark', "The mark is standing IN your crew.");
    if (biz.inside_at && Date.now() - new Date(biz.inside_at).getTime() < HEIST_INSIDE_CD_MS)
      throw new GameError('mark_hot', 'That front just got hit — the books are locked down. Give it a day.');
    // audit H2: a raid-eligible front can't be crewed to spirit the pending income away from
    // the Bureau — the owner must touch it (and eat the raid roll) before anyone can rob it
    if (decayedScrutiny(biz) >= CONSTANTS.BUSINESS_RAID_THRESHOLD)
      throw new GameError('feds_watching', 'The Bureau is parked outside that front. No crew goes near it.');
    const ownerGang = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [biz.character_id])).rows[0]?.gang_id;
    if (ownerGang) {
      const ids = members.map((m) => m.character_id);
      const inList = ids.map((_, i) => `$${i + 2}`).join(','); // explicit placeholders — pg-mem can't bind ANY(array)
      if ((await client.query(`SELECT 1 FROM gang_members WHERE gang_id=$1 AND character_id IN (${inList})`, [ownerGang, ...ids])).rows[0])
        throw new GameError('family', "That front flies the crew's own flag. Omertà.");
    }
  }

  const doneAt = new Date(Date.now() + M4.HEIST_CD_MS);
  const setMember = async (id, cols, params) => client.query(`UPDATE characters SET ${cols} WHERE id=$1`, [id, ...params]);
  await client.query("UPDATE crew_heists SET status='done' WHERE id=$1", [heistId]);

  // THE RAT WINS FIRST: a flagged job never fires — the informer walks with the payout, the
  // rest eat double time, and the street only ever hears that somebody talked.
  const rats = members.filter((m) => m.ratted).map((m) => m.character_id);
  if (rats.length) {
    const payoutTotal = Math.floor(job.stake * HEIST_RAT_BPS / 10000);
    const share = Math.floor(payoutTotal / rats.length);
    // EVERYONE eats the double stretch — the informer included: the law hauls the whole crew
    // in, so the public jail roster can't out the rat (audit M3 — the only un-jailed member
    // was trivially identified). The informer's pay lands quietly all the same.
    const jailTo = new Date(Date.now() + job.jailS * 2 * 1000);
    for (const m of crewRows) {
      const isRat = rats.includes(m.id);
      const pay = isRat && share > 0 ? share : 0;
      if (m.id === ch.id) {
        ch.heist_at = doneAt; ch.jail_until = jailTo;
        if (pay) ch.cash = Number(ch.cash) + pay;
      } else {
        // absolute writes off the locked row (the pg-mem arithmetic discipline)
        await setMember(m.id, 'cash=$2, jail_until=$3, heist_at=$4', [Number(m.cash) + pay, jailTo, doneAt]);
        await h.notify(client, m.id, 'heist_blown', { job: job.name });
      }
      if (pay) await h.ledger(client, { characterId: m.id, currency: 'cash', amount: pay, reason: 'heist:crew:rat' });
    }
    await h.rngLog(client, ch.id, `heist:${job.id}`, 0, 'blown — somebody talked');
    bus.emit('streets', { type: 'heist_blown', job: job.name });
    return { ok: true, blown: true, job: job.id, name: job.name, message: 'The law was waiting. Somebody talked.' };
  }

  // the roll — the job sets the floor; step two reads each member's stat FOR THEIR ROLE (x3, so
  // a crew of true specialists matches a crew of all-rounders — they just got there cheaper)
  const roleOf = Object.fromEntries(members.map((m) => [m.character_id, m.role]));
  // a hired hand is stat-NEUTRAL: excluded from the average so a resident's real stats never leak
  // into the roll (hiring a body is not a free success bonus). The leader is never hired, so the
  // real-crew list is always non-empty.
  const realCrew = crewRows.filter((m) => !hiredIds.has(m.id));
  const avgRoleStat = realCrew.reduce((a, m) => a + Number(m[HEIST_ROLES[roleOf[m.id]] || 'muscle']), 0) / realCrew.length;
  // Tier-4 §B: every cased member raises the roll a notch, capped (casing never guarantees a score)
  const caseBonus = Math.min(HEIST_CASE_MAX, members.filter((m) => m.cased).length * HEIST_CASE_STEP);
  // HEIST_P is a TEST-ONLY roll knob (the SHANK_P / BUSINESS_RAID_P precedent — never set in production):
  // it pins the success probability so a suite can force a score or a bust deterministically instead of
  // looping on the RNG, which flakes at the .92 clamp (P(no bust over 60 tries) ≈ 0.7%).
  const p = process.env.HEIST_P != null ? Number(process.env.HEIST_P)
    : Math.min(0.92, Math.max(0.15, job.base + (avgRoleStat * 3 - 30) / 1000 + caseBonus));
  const roll = Math.random();
  await h.rngLog(client, ch.id, `heist:${job.id}`, roll, `${roll < p ? 'score' : 'bust'} (P ${p.toFixed(3)}, crew ${crewRows.length}${caseBonus ? `, cased +${caseBonus.toFixed(2)}` : ''})`);
  // an INSIDE JOB marks the venue win or lose — the attempt is what locks the books down
  if (biz) await client.query('UPDATE businesses SET inside_at=now() WHERE id=$1', [biz.id]);

  if (roll < p) {
    let pot;
    if (biz) {
      // the pot is the front's PENDING income redirected (rateBps of it) — the owner keeps the
      // rest pending, the clock advances by only the stolen share (the shakedown discipline)
      // STEP TWO (residents-as-marks): a resident front's pending realizes at the sleepy-joint scale
      const markNpc = (await client.query('SELECT is_npc FROM characters WHERE id=$1', [biz.character_id])).rows[0]?.is_npc;
      const pending = npcPendingScale(!!markNpc, accrued(biz));
      pot = Math.floor(pending * job.rateBps / 10000);
      const elapsed = Math.min(Date.now() - new Date(biz.last_collect_at).getTime(), CONSTANTS.BUSINESS_CAP_MS);
      await client.query('UPDATE businesses SET last_collect_at=$2 WHERE id=$1',
        [biz.id, new Date(Date.now() - Math.floor(Math.max(0, elapsed) * (1 - job.rateBps / 10000)))]);
      await h.notify(client, biz.character_id, 'inside_job', { kind: biz.kind, pot });
    } else {
      const avgLvl = realCrew.reduce((a, m) => a + levelOf(Number(m.respect)), 0) / realCrew.length; // hired hands don't set the pot's caliber (roll-neutral)
      pot = Math.floor(rand(job.takePerLvl[0], job.takePerLvl[1]) * avgLvl);
    }
    const unit = pot / (HEIST_LEADER_WEIGHT + (crewRows.length - 1));
    const shares = {};
    for (const m of crewRows) shares[m.id] = Math.floor(unit * (m.id === ch.id ? HEIST_LEADER_WEIGHT : 1));
    const reason = biz ? 'heist:inside' : 'heist:crew';
    // an inside job that cracked an EMPTY till earns nothing to brag about (audit L4 —
    // zero-pot rep farming); standard jobs always carry a pot
    const rep = biz && pot === 0 ? 0 : job.rep;
    // Tier-4 §C: a standard score flagged HOT banks each share as fenceable loot (book value, NOT
    // a §10.4 currency — no ledger row; the Port contraband twin) instead of cash. The clock/rep still
    // apply; the crew fences it later at the drifting rate (a market-timing gamble, loot-able if marked).
    const hot = row.fenced && !biz;
    for (const m of crewRows) {
      // A HIRED HAND takes no cut and earns nothing — its share is FORFEITED (never minted, so the
      // faucet only shrinks), and no legend/xp/rwa/respect (a body, not a made man). The denominator
      // still counted it above, so the real crew's slices already shrank around it.
      if (hiredIds.has(m.id)) continue;
      if (hot) {
        // hot loot is a direct-SQL column (not in the positional persist) → write it for EVERYONE incl. the leader
        await client.query('UPDATE characters SET heist_loot = heist_loot + $2 WHERE id=$1', [m.id, shares[m.id]]);
        if (m.id === ch.id) { gainRespect(h, ch, rep); ch.heist_at = doneAt; }
        else { await setMember(m.id, 'respect=$2, heist_at=$3', [Number(m.respect) + rep, doneAt]);
          await h.notify(client, m.id, 'heist_score', { job: job.name, hot: shares[m.id] }); }
      } else {
        if (m.id === ch.id) { ch.cash = Number(ch.cash) + shares[m.id]; gainRespect(h, ch, rep); ch.heist_at = doneAt; }
        else {
          // absolute writes off the locked row (the pg-mem arithmetic discipline)
          await setMember(m.id, 'cash=$2, respect=$3, heist_at=$4',
            [Number(m.cash) + shares[m.id], Number(m.respect) + rep, doneAt]);
          await h.notify(client, m.id, 'heist_score', { job: job.name, share: shares[m.id] });
        }
        await h.ledger(client, { characterId: m.id, currency: 'cash', amount: shares[m.id], reason });
      }
      // Tier-4 §D — THE CREW LEGEND: a successful heist banks a lifetime notch for every crewman
      // (account-level, survives death — direct SQL, off the positional persist; the duel_wins twin)
      await client.query('UPDATE account_persistent SET heists_pulled = heists_pulled + 1 WHERE account_id=$1', [m.account_id]);
      // THE TRADES: a pulled score schools the whole crew — the leader through his loaded h (cache
      // mirror), members HEADLESS (h=null → bumpMastery reads/writes their rows directly under the
      // crew lock already held above; the heists_pulled twin, but per-character so it dies with them)
      await bumpMastery(client, m.id === ch.id ? h : null, m, 'scores', 'heist');
    }
    await h.track(client, ch.account_id, 'heist_score', { job: job.id, pot, crew: crewRows.length, hot });
    bus.emit('streets', { type: 'heist_score', job: job.name, pot, crew: crewRows.length });
    return { ok: true, score: true, job: job.id, name: job.name, pot, share: hot ? 0 : shares[ch.id], hot: hot ? shares[ch.id] : 0, rep: job.rep };
  }

  // the bust — the whole crew goes down together (an inside-job mark hears about the attempt)
  const jailTo = new Date(Date.now() + job.jailS * 1000);
  for (const m of crewRows) {
    if (m.id === ch.id) { ch.jail_until = jailTo; ch.heist_at = doneAt; }
    else { await setMember(m.id, 'jail_until=$2, heist_at=$3', [jailTo, doneAt]); await h.notify(client, m.id, 'heist_bust', { job: job.name, jailS: job.jailS }); }
  }
  if (biz) await h.notify(client, biz.character_id, 'inside_job_failed', { kind: biz.kind });
  bus.emit('streets', { type: 'heist_bust', job: job.name, crew: crewRows.length });
  return { ok: true, score: false, job: job.id, name: job.name, jailSeconds: job.jailS };
}

// The board: the catalog, open jobs looking for crew, and my active job (rat flags NEVER surface).
export async function heistBoard(pool, characterId) {
  // two flat queries instead of a correlated subquery — pg-mem (the test db) can't parse the
  // latter (the GET /v1/gangs precedent), and the flat form is fine on real Postgres too
  const openRows = (await pool.query(
    `SELECT ch.id, ch.job, ch.created_at, c.name AS leader
       FROM crew_heists ch JOIN characters c ON c.id = ch.leader_character
      WHERE ch.status='planning' ORDER BY ch.created_at DESC LIMIT 30`)).rows;
  const memberRows = (await pool.query(
    `SELECT m.heist_id, m.role FROM crew_heist_members m
       JOIN crew_heists ch2 ON ch2.id = m.heist_id AND ch2.status='planning'`)).rows;
  const rolesOf = {};
  for (const r of memberRows) (rolesOf[r.heist_id] = rolesOf[r.heist_id] || []).push(r.role);
  const open = openRows.filter((r) => !stale(r))
    .map((r) => { const j = heistJobOf(r.job); const taken = rolesOf[r.id] || []; return { id: r.id, job: r.job, name: j.name, leader: r.leader,
      crew: taken.length, crewNeeded: j.crew - taken.length, rolesOpen: j.roles.filter((x) => !taken.includes(x)), lvl: j.lvl, stake: j.stake }; });
  const mine = (await pool.query(
    `SELECT ch.id, ch.job, ch.leader_character FROM crew_heists ch
       JOIN crew_heist_members m ON m.heist_id = ch.id
      WHERE m.character_id=$1 AND ch.status='planning'`, [characterId])).rows[0] || null;
  let my = null;
  if (mine) {
    const crew = (await pool.query(
      'SELECT c.name, m.role, m.cased, m.hired FROM crew_heist_members m JOIN characters c ON c.id = m.character_id WHERE m.heist_id=$1', [mine.id])).rows;
    const j = heistJobOf(mine.job);
    const row = (await pool.query('SELECT fenced FROM crew_heists WHERE id=$1', [mine.id])).rows[0];
    const isLeader = mine.leader_character === characterId;
    const hiredNow = crew.filter((c) => c.hired).length;
    // THE HIRED HAND: the leader can fill an open seat with an NPC body (a hand takes a cut but earns
    // you nothing extra), capped at HEIST_FILL_MAX so the marquee jobs stay multiplayer.
    my = { id: mine.id, job: mine.job, name: j.name, leader: isLeader, fenced: !!row?.fenced,
      crew: crew.map((c) => ({ name: c.name, role: c.role, cased: !!c.cased, hired: !!c.hired })), crewNeeded: j.crew - crew.length,
      canHire: isLeader && crew.length < j.crew && hiredNow < HEIST_FILL_MAX, fillFee: HEIST_FILL_FEE, fillMax: HEIST_FILL_MAX,
      rolesOpen: j.roles.filter((x) => !crew.map((c) => c.role).includes(x)) };
  }
  // Tier-4: the actor's hot loot + lifetime notoriety (account-level, survives death)
  const meRow = (await pool.query(
    `SELECT c.heist_loot, ap.heists_pulled FROM characters c JOIN account_persistent ap ON ap.account_id=c.account_id WHERE c.id=$1`, [characterId])).rows[0] || {};
  const pulled = Number(meRow.heists_pulled || 0);
  return { jobs: HEIST_JOBS.map((j) => ({ id: j.id, name: j.name, crew: j.crew, lvl: j.lvl, stake: j.stake,
    base: j.base, takePerLvl: j.takePerLvl || null, rateBps: j.rateBps || null, roles: j.roles, jailS: j.jailS, minPulled: j.minPulled || 0,
    locked: !!(j.minPulled && pulled < j.minPulled) })),
    roleStats: HEIST_ROLES, open, mine: my,
    you: { hotLoot: Math.floor(Number(meRow.heist_loot || 0)), pulled, rank: heistRankOf(pulled).name },
    caseEnergy: HEIST_CASE_ENERGY, ranks: HEIST_RANKS };
}

// THE CREW LEADERBOARD (Tier-4 §D) — the most notorious thieves by lifetime scores (agents excluded).
// (red-team R31 F1) RESIDENTS excluded — reachable through THE FILL: `fillHeist` hires resident hands
// so a solo player can run crew content, and the success loop bumps `heists_pulled` for EVERY member
// row, hired ones included. The feature that makes the crew loop soloable was feeding scenery onto
// the crew legend.
export async function heistLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT c.name, ap.heists_pulled FROM account_persistent ap
       JOIN characters c ON c.account_id = ap.account_id AND c.alive
      WHERE NOT ap.agent_flag AND NOT c.is_npc AND ap.heists_pulled > 0
      ORDER BY ap.heists_pulled DESC, c.name LIMIT 20`)).rows;
  return { crews: rows.map((r, i) => ({ pos: i + 1, name: r.name, pulled: Number(r.heists_pulled),
    rank: heistRankOf(r.heists_pulled).name })) };
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
      } catch (e) { await client.query('ROLLBACK'); console.error('[sweepStaleHeists] plan', s.id, e?.message || e); } // per-row isolation (AUDIT-full-system-v2 I-LOW): a poison plan no longer aborts the rest of the tick
    }
    return { swept };
  } finally { client.release(); }
}
