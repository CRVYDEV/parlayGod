// THE CREW (omerta-crew-design.md) — the lightweight 2-4 player mutual-aid pact.
//
// The social scale BETWEEN a lonely solo grind and a 20-person family: opt-in, low-commitment, no
// obligations. It is the on-ramp the progression harness kept landing short of (a plausible solo
// player reaches level 33 having never met another human), and the collective thing the read-only
// Cast/Story/Situation cohesion layer was missing.
//
// It is NOT a new pillar (breadth already exceeds depth). It is connective tissue, scoped to STATUS +
// COORDINATION: a small-group chat room (the missing tier between DM and family), a board of your
// crewmates, and a breakable mutual non-aggression. Deliberately NO treasury, NO turf, NO escrow — so
// **zero §10.4 surface**: nothing in this file moves value or writes a `transactions` row. The
// `crew:` word appears in no ledger vocabulary, and the lifecycle test proves it by counting rows.
//
// ACCOUNT-keyed on every table (`crews`/`crew_members`/`crew_invites`), because a crew is between
// PEOPLE not streets — so it SURVIVES DEATH (the heir stays in the crew), like contacts /
// dynasty_marriages / dm_blocks, and is outside the estate wipe + the migrate DISPOSITION guard by
// construction (that guard matches character-scoped columns; a crew has none).
//
// NON-AGGRESSION is NOT in this file — it is a one-line gate in social/combat.js, co-located with the
// family omertà it parallels (fire/jump/npcHit/shank), reading `h.owned.crewId` /
// `h.victimOwned.crewId` off loadOwned. A crew is mutual RESTRAINT, never immunity: a contract on a
// crewmate's head is still collectable by everyone else, and a rat / WANTED crewmate forfeits the
// shield exactly as they forfeit family omertà.
import crypto from 'node:crypto';
import { GameError, cleanText, notify, bus } from './game.js';
import { CREW, DISTRICTS, levelOf, weekOf, crewObjectiveOf } from './rules.js';

const uid = () => crypto.randomUUID();
const districtName = (id) => (DISTRICTS.find((d) => d.id === id) || {}).name || id;

// the crew this account belongs to (a plain read; null if solo). Used by the routes for gating.
export async function crewIdOf(client, accountId) {
  return (await client.query('SELECT crew_id FROM crew_members WHERE account_id=$1', [accountId])).rows[0]?.crew_id || null;
}

// ── FORM A CREW ────────────────────────────────────────────────────────────────────────────────
export async function createCrew(ch, name, client, h) {
  if (await crewIdOf(client, ch.account_id)) throw new GameError('in_crew', "You already run with a crew.");
  if (levelOf(Number(ch.respect)) < CREW.MIN_LEVEL) throw new GameError('level', `Level ${CREW.MIN_LEVEL} to start a crew.`);
  name = cleanText(name).trim();   // strip HTML/control chars — the createGang stored-XSS discipline
  if (name.length < 3 || name.length > CREW.NAME_MAX) throw new GameError('name', `A crew name is 3–${CREW.NAME_MAX} characters.`);
  if (!/^[\w .,'&-]+$/.test(name)) throw new GameError('name', 'Crew name: letters, numbers and simple punctuation only.');
  const clash = (await client.query('SELECT id FROM crews WHERE name=$1', [name])).rows[0];
  if (clash) throw new GameError('taken', 'That name is already claimed.');
  const id = uid();
  await client.query('INSERT INTO crews (id, name, leader_account) VALUES ($1,$2,$3)', [id, name, ch.account_id]);
  await client.query('INSERT INTO crew_members (crew_id, account_id, name) VALUES ($1,$2,$3)', [id, ch.account_id, ch.name]);
  return { ok: true, crew: 'formed', id, name };
}

// ── INVITE — put a word in for a player BY NAME (living-name uniqueness makes a name resolve to one
// street; the console types a name, no roster lookup needed). A pending offer row; the target isn't
// locked (nothing moves until they accept), so this is single-party. ──
export async function inviteToCrew(ch, name, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const n = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n);
  if (n >= CREW.MAX_MEMBERS) throw new GameError('full', `Your crew is full (${CREW.MAX_MEMBERS}).`);
  const who = String(name || '').trim();
  if (!who) throw new GameError('name', 'Name the player you want to bring in.');
  const t = (await client.query('SELECT id, name, account_id FROM characters WHERE name=$1 AND alive AND NOT is_npc', [who])).rows[0];
  if (!t) throw new GameError('no_target', "Nobody by that name on the streets.");
  if (t.account_id === ch.account_id) throw new GameError('self', "You can't invite yourself.");
  if (await crewIdOf(client, t.account_id)) throw new GameError('has_crew', `${t.name} already runs with a crew.`);
  const dup = (await client.query('SELECT 1 FROM crew_invites WHERE crew_id=$1 AND account_id=$2', [crewId, t.account_id])).rows[0];
  if (dup) throw new GameError('already', `${t.name} has already been asked.`);
  // (red-team F3) cap OUTSTANDING invites so a crew of one can't blast distinct-player invite spam — a
  // crew can't have more pending invites than it could seat. The full-crew check above only counts real
  // members, so without this a 1-man crew could notify-spam the whole city one distinct name at a time.
  const pending = Number((await client.query('SELECT COUNT(*) n FROM crew_invites WHERE crew_id=$1', [crewId])).rows[0].n);
  if (pending >= CREW.MAX_MEMBERS) throw new GameError('too_many_pending', 'Too many invites out — wait for some to be answered.');
  await client.query('INSERT INTO crew_invites (crew_id, account_id, from_name) VALUES ($1,$2,$3)', [crewId, t.account_id, ch.name]);
  await notify(client, t.id, 'crew_invite', { from: ch.name, crewId }).catch(() => {});
  return { ok: true, crew: 'invited', to: t.name };
}

// ── ACCEPT — join. Lock the crew row (the joinGang discipline) so concurrent accepts can't blow the
// cap. Clears every OTHER pending invite too — you run with one crew. ──
export async function acceptInvite(ch, crewId, client, h) {
  if (await crewIdOf(client, ch.account_id)) throw new GameError('in_crew', "Leave your current crew first.");
  const inv = (await client.query('SELECT 1 FROM crew_invites WHERE crew_id=$1 AND account_id=$2', [crewId, ch.account_id])).rows[0];
  if (!inv) throw new GameError('no_invite', "You weren't asked to that crew.");
  const crew = (await client.query('SELECT * FROM crews WHERE id=$1 FOR UPDATE', [crewId])).rows[0];
  if (!crew) throw new GameError('gone', 'That crew no longer exists.');
  const n = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n);
  if (n >= CREW.MAX_MEMBERS) throw new GameError('full', 'That crew filled up.');
  await client.query('INSERT INTO crew_members (crew_id, account_id, name) VALUES ($1,$2,$3)', [crewId, ch.account_id, ch.name]);
  await client.query('DELETE FROM crew_invites WHERE account_id=$1', [ch.account_id]);   // one crew — drop all my offers
  bus.emit(`crew:${crewId}`, { type: 'crew_joined', who: ch.name });
  return { ok: true, crew: 'joined', name: crew.name };
}

export async function declineInvite(ch, crewId, client) {
  const r = await client.query('DELETE FROM crew_invites WHERE crew_id=$1 AND account_id=$2', [crewId, ch.account_id]);
  if (!r.rowCount) throw new GameError('no_invite', 'No such invite.');
  return { ok: true, crew: 'declined' };
}

// ── LEAVE — walk away. Leader leaves → the oldest remaining member succeeds; an empty crew is deleted
// (the removeMember shape). ──
export async function leaveCrew(ch, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  await client.query('SELECT id FROM crews WHERE id=$1 FOR UPDATE', [crewId]);   // serialize a concurrent leave/accept
  await client.query('DELETE FROM crew_members WHERE account_id=$1', [ch.account_id]);
  await settleCrew(client, crewId, ch.account_id);
  bus.emit(`crew:${crewId}`, { type: 'crew_left', who: ch.name });
  return { ok: true, crew: 'left' };
}

// ── KICK — the leader only, and never themselves (leaving is how a leader steps down). ──
export async function kickMember(ch, targetCharacterId, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT * FROM crews WHERE id=$1 FOR UPDATE', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss of the crew can cut a man loose.');
  const t = (await client.query('SELECT id, name, account_id FROM characters WHERE id=$1', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_target', 'No such member.');
  if (t.account_id === ch.account_id) throw new GameError('self', 'Leave the crew to step down.');
  const r = await client.query('DELETE FROM crew_members WHERE crew_id=$1 AND account_id=$2', [crewId, t.account_id]);
  if (!r.rowCount) throw new GameError('not_member', `${t.name} isn't in your crew.`);
  await notify(client, t.id, 'crew_kicked', { crew: crew.name }).catch(() => {});
  bus.emit(`crew:${crewId}`, { type: 'crew_kicked', who: t.name });
  return { ok: true, crew: 'kicked', who: t.name };
}

// ── THE ROLODEX step two — RECRUITING + JOIN REQUESTS. The push half of discovery: a crew advertises
// (`recruiting`), and a solo player ASKS to join (the invite twin, `crew_requests`) rather than waiting
// to be named. Status/coordination only — zero §10.4. ──
export async function setRecruiting(ch, on, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss opens the crew to new blood.');
  const flag = !!on;
  await client.query('UPDATE crews SET recruiting=$2, recruiting_at = CASE WHEN $2 THEN now() ELSE recruiting_at END WHERE id=$1', [crewId, flag]);
  return { ok: true, crew: flag ? 'recruiting' : 'closed' };
}

// a solo player asks to join a recruiting, non-full crew. A pending row (nothing moves until the leader
// accepts), so single-party. Gates mirror inviteToCrew from the other side.
export async function requestJoin(ch, crewId, client, h) {
  if (await crewIdOf(client, ch.account_id)) throw new GameError('in_crew', 'Leave your current crew first.');
  const crew = (await client.query('SELECT id, name, leader_account, recruiting FROM crews WHERE id=$1', [crewId])).rows[0];
  if (!crew) throw new GameError('gone', 'That crew no longer exists.');
  if (!crew.recruiting) throw new GameError('closed', "That crew isn't taking requests.");
  const n = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n);
  if (n >= CREW.MAX_MEMBERS) throw new GameError('full', 'That crew is full.');
  const dup = (await client.query('SELECT 1 FROM crew_requests WHERE crew_id=$1 AND account_id=$2', [crewId, ch.account_id])).rows[0];
  if (dup) throw new GameError('already', "You've already asked to join.");
  await client.query('INSERT INTO crew_requests (crew_id, account_id, from_name) VALUES ($1,$2,$3)', [crewId, ch.account_id, ch.name]);
  const boss = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [crew.leader_account])).rows[0];
  if (boss) await notify(client, boss.id, 'crew_request', { from: ch.name, crewId }).catch(() => {});
  return { ok: true, crew: 'requested', to: crew.name };
}

// the leader accepts a pending request — the acceptInvite discipline (lock the crew row, re-check the
// cap), then add the requester and clear all their requests (one crew). Keyed on the requester's CURRENT
// living character (resolved to their account — the kickMember shape; no account UUID leaves the board).
export async function acceptRequest(ch, targetCharacterId, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT * FROM crews WHERE id=$1 FOR UPDATE', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss lets a man in.');
  const t = (await client.query('SELECT id, name, account_id FROM characters WHERE id=$1', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_request', 'No such player.');
  const req = (await client.query('SELECT from_name FROM crew_requests WHERE crew_id=$1 AND account_id=$2', [crewId, t.account_id])).rows[0];
  if (!req) throw new GameError('no_request', 'No such request.');
  if (await crewIdOf(client, t.account_id)) { await client.query('DELETE FROM crew_requests WHERE account_id=$1', [t.account_id]); throw new GameError('has_crew', `${t.name} already found a crew.`); }
  const n = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n);
  if (n >= CREW.MAX_MEMBERS) throw new GameError('full', 'Your crew is full.');
  await client.query('INSERT INTO crew_members (crew_id, account_id, name) VALUES ($1,$2,$3)', [crewId, t.account_id, t.name]);
  await client.query('DELETE FROM crew_requests WHERE account_id=$1', [t.account_id]);   // one crew — drop all their asks
  await notify(client, t.id, 'crew_accepted', { crew: crew.name }).catch(() => {});
  bus.emit(`crew:${crewId}`, { type: 'crew_joined', who: t.name });
  return { ok: true, crew: 'took_in', who: t.name };
}

export async function declineRequest(ch, targetCharacterId, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss turns a man away.');
  const t = (await client.query('SELECT account_id FROM characters WHERE id=$1', [targetCharacterId])).rows[0];
  if (!t) throw new GameError('no_request', 'No such player.');
  const r = await client.query('DELETE FROM crew_requests WHERE crew_id=$1 AND account_id=$2', [crewId, t.account_id]);
  if (!r.rowCount) throw new GameError('no_request', 'No such request.');
  return { ok: true, crew: 'turned_away' };
}

// succession + dissolution after a departure (leaver's account passed so we never re-pick them).
async function settleCrew(client, crewId, leftAccount) {
  const rest = (await client.query(
    'SELECT account_id FROM crew_members WHERE crew_id=$1 ORDER BY joined_at, account_id', [crewId])).rows;
  if (!rest.length) { await client.query('DELETE FROM crews WHERE id=$1', [crewId]);
    await client.query('DELETE FROM crew_invites WHERE crew_id=$1', [crewId]);
    await client.query('DELETE FROM crew_requests WHERE crew_id=$1', [crewId]);
    await client.query('DELETE FROM crew_objectives WHERE crew_id=$1', [crewId]);
    await client.query('DELETE FROM crew_objective_progress WHERE crew_id=$1', [crewId]);
    await client.query('DELETE FROM crew_targets WHERE crew_id=$1', [crewId]); return; }
  const crew = (await client.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0];
  if (crew && crew.leader_account === leftAccount)
    await client.query('UPDATE crews SET leader_account=$2 WHERE id=$1', [crewId, rest[0].account_id]);
}

// ── THE BOARD — your crew (members with live public state), plus pending invites both directions.
// A read; single-party. Members' state is joined to their CURRENT living street (account-keyed), so a
// dead member shows as their heir; a between-lives account falls back to the snapshot name. ──
export async function crewBoard(ch, client) {
  const crewId = await crewIdOf(client, ch.account_id);
  // invites TO me (whether or not I'm in a crew) — the join offers on my plate. Flat query + a JS
  // headcount fold — never a correlated subquery (pg-mem cannot resolve it; the /v1/gangs precedent).
  const invited = (await client.query(
    `SELECT ci.crew_id, ci.from_name, cr.name AS crew_name FROM crew_invites ci
       JOIN crews cr ON cr.id=ci.crew_id WHERE ci.account_id=$1 ORDER BY ci.at DESC`, [ch.account_id])).rows;
  const counts = new Map();
  if (invited.length) {
    for (const row of (await client.query('SELECT crew_id, COUNT(*) n FROM crew_members GROUP BY crew_id')).rows)
      counts.set(row.crew_id, Number(row.n));
  }
  const invites = invited.map((r) => ({ crewId: r.crew_id, name: r.crew_name, from: r.from_name, members: counts.get(r.crew_id) || 0 }));
  if (!crewId) return { crew: null, invites, maxMembers: CREW.MAX_MEMBERS, minLevel: CREW.MIN_LEVEL, nameMax: CREW.NAME_MAX, bringOne: CREW.BRING_ONE };

  const crew = (await client.query('SELECT * FROM crews WHERE id=$1', [crewId])).rows[0];
  // members' live state — flat JOIN, never `= ANY($1)` (pg-mem returns zero rows for it — the rivals lesson)
  const mem = (await client.query(
    `SELECT cm.account_id, cm.name AS snap, cm.joined_at, c.id AS char_id, c.name, c.loc, c.respect,
            gm.gang_id, g.name AS gang_name
       FROM crew_members cm
       LEFT JOIN characters c ON c.account_id=cm.account_id AND c.alive
       LEFT JOIN gang_members gm ON gm.character_id=c.id
       LEFT JOIN gangs g ON g.id=gm.gang_id
      WHERE cm.crew_id=$1 ORDER BY cm.joined_at, cm.account_id`, [crewId])).rows;
  const members = mem.map((m) => ({
    characterId: m.char_id || null,
    name: m.name || m.snap,
    level: m.respect != null ? levelOf(Number(m.respect)) : null,
    district: m.loc || null, districtName: m.loc ? districtName(m.loc) : null,
    family: m.gang_name || null,
    leader: m.account_id === crew.leader_account,
    isMe: m.account_id === ch.account_id,
  }));
  // pending offers OUT of my crew (so the crew can see who's been asked)
  const pending = (await client.query(
    'SELECT account_id, from_name FROM crew_invites WHERE crew_id=$1 ORDER BY at DESC', [crewId])).rows.length;
  // THE ROLODEX step two — join REQUESTS on the crew's plate (the leader accepts/declines), keyed on the
  // requester's CURRENT living character (a flat JOIN, no account UUID leaves — the /v1/gangs precedent).
  const requests = (await client.query(
    `SELECT c.id AS char_id, COALESCE(c.name, cr.from_name) AS name, c.respect
       FROM crew_requests cr LEFT JOIN characters c ON c.account_id=cr.account_id AND c.alive
      WHERE cr.crew_id=$1 ORDER BY cr.at DESC`, [crewId])).rows
    .map((r) => ({ characterId: r.char_id || null, name: r.name, level: r.respect != null ? levelOf(Number(r.respect)) : null }));
  const target = await crewTargetOf(client, crewId);   // THE CREW HIT — the shared mark, if the leader called one
  const objective = await crewObjective(client, crewId, ch.account_id);   // THE CREW OBJECTIVE — the weekly shared goal
  return {
    crew: { id: crewId, name: crew.name, leader: crew.leader_account === ch.account_id, members, pending,
      recruiting: !!crew.recruiting, requests, target, objective, objectivesDone: Number(crew.objectives_done || 0) },
    invites, maxMembers: CREW.MAX_MEMBERS, minLevel: CREW.MIN_LEVEL, nameMax: CREW.NAME_MAX, bringOne: CREW.BRING_ONE,
  };
}

// ── THE CREW HIT (step two) — the leader calls a shared target the whole crew rallies a contract
// behind. This sets a POINTER only; the funding rides the AUDITED bounty escrow (postBounty), so it
// moves NO value and adds ZERO §10.4 surface. ──
const BKINDS = new Set(['kill', 'hospitalize']);
export async function setCrewTarget(ch, name, kind, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss of the crew calls the target.');
  const k = kind === 'hospitalize' ? 'hospitalize' : 'kill';
  if (!BKINDS.has(k)) throw new GameError('kind', "A hit is 'kill' or 'hospitalize'.");
  const who = String(name || '').trim();
  if (!who) throw new GameError('name', 'Name the mark.');
  const t = (await client.query('SELECT id, name, account_id FROM characters WHERE name=$1 AND alive AND NOT is_npc', [who])).rows[0];
  if (!t) throw new GameError('no_target', 'Nobody by that name on the streets.');
  if (t.account_id === ch.account_id) throw new GameError('self', "You can't call a hit on yourself.");
  // the non-aggression pact — a crew never calls a hit on its own
  const tcrew = await crewIdOf(client, t.account_id);
  if (tcrew === crewId) throw new GameError('crew', "They run with your crew. Not them.");
  await client.query('DELETE FROM crew_targets WHERE crew_id=$1', [crewId]);   // one target at a time
  await client.query('INSERT INTO crew_targets (crew_id, target_account, target_name, kind, set_by) VALUES ($1,$2,$3,$4,$5)',
    [crewId, t.account_id, t.name, k, ch.account_id]);
  bus.emit(`crew:${crewId}`, { type: 'crew_target', who: ch.name, target: t.name, kind: k });
  return { ok: true, crew: 'target', target: t.name, kind: k };
}

export async function clearCrewTarget(ch, client, h) {
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const crew = (await client.query('SELECT leader_account FROM crews WHERE id=$1', [crewId])).rows[0];
  if (crew.leader_account !== ch.account_id) throw new GameError('not_leader', 'Only the boss calls it off.');
  await client.query('DELETE FROM crew_targets WHERE crew_id=$1', [crewId]);
  return { ok: true, crew: 'target_cleared' };
}

// resolve the crew's shared target into something the board can render + the client can chip in on:
// the mark's CURRENT living street (the pot is on that character) + the standing pot on (target, kind).
async function crewTargetOf(client, crewId) {
  const tg = (await client.query('SELECT * FROM crew_targets WHERE crew_id=$1', [crewId])).rows[0];
  if (!tg) return null;
  const live = (await client.query('SELECT id, name FROM characters WHERE account_id=$1 AND alive AND NOT is_npc', [tg.target_account])).rows[0];
  let pot = 0;
  if (live) {
    const b = (await client.query('SELECT amount FROM bounties WHERE target_character=$1 AND kind=$2', [live.id, tg.kind])).rows[0];
    pot = b ? Number(b.amount) : 0;
  }
  return { name: live?.name || tg.target_name, kind: tg.kind, characterId: live?.id || null, alive: !!live, pot };
}

// ── THE CREW LEADERBOARD (step two) — the deadliest crews, by combined lifetime kills (account-level,
// survives death). Pure STATUS, agents excluded. Flat queries + a JS fold (pg-mem — the /v1/gangs
// precedent). ──
export async function crewLeaderboard(pool, limit = 20) {
  const crews = (await pool.query('SELECT id, name FROM crews')).rows;
  if (!crews.length) return { crews: [] };
  const mem = (await pool.query(
    `SELECT cm.crew_id, COALESCE(ap.kills,0) kills FROM crew_members cm
       LEFT JOIN account_persistent ap ON ap.account_id = cm.account_id
      WHERE NOT COALESCE(ap.agent_flag, false)`)).rows;
  const agg = new Map();
  for (const m of mem) { const a = agg.get(m.crew_id) || { kills: 0, members: 0 }; a.kills += Number(m.kills); a.members += 1; agg.set(m.crew_id, a); }
  return {
    crews: crews.map((c) => ({ name: c.name, kills: (agg.get(c.id) || {}).kills || 0, members: (agg.get(c.id) || {}).members || 0 }))
      .sort((a, b) => b.kills - a.kills || b.members - a.members).slice(0, limit),
  };
}

// ── THE CREW OBJECTIVE — the weekly shared goal (bumped by a crewmate's own play in game.js
// bumpCrewObjective; completed → everyone pinged → each contributor claims a cut here). This is the
// synchronous "log in because your crew is active" hook. ──

// read the current week's objective for a crew (materialize-on-read is done by the bump; here we only
// REPORT — if nobody's acted yet the row is absent and we show the drawn goal at 0 progress). Returns
// the goal + this member's contribution/claim + the per-member contribution texture.
async function crewObjective(client, crewId, accountId) {
  const week = weekOf();
  const row = (await client.query('SELECT kind, target, progress, done FROM crew_objectives WHERE crew_id=$1 AND week=$2', [crewId, week])).rows[0];
  const members = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n) || 1;
  const drawn = crewObjectiveOf(crewId, week, members);
  const kind = row?.kind || drawn.kind;
  const target = row ? Number(row.target) : drawn.target;
  const progress = row ? Number(row.progress) : 0;
  const done = !!row?.done;
  // per-member contributions (the "what your crew did this week" texture), joined to living names
  const contrib = (await client.query(
    `SELECT p.account_id, p.n, p.claimed, COALESCE(c.name, cm.name) AS name
       FROM crew_objective_progress p
       JOIN crew_members cm ON cm.crew_id=p.crew_id AND cm.account_id=p.account_id
       LEFT JOIN characters c ON c.account_id=p.account_id AND c.alive
      WHERE p.crew_id=$1 AND p.week=$2 ORDER BY p.n DESC`, [crewId, week])).rows;
  const mine = contrib.find((r) => r.account_id === accountId);
  const meta = CREW.OBJECTIVE.KINDS.find((k) => k.id === kind) || {};
  return {
    kind, label: meta.label || kind, unit: meta.unit || '', target, progress,
    pct: target ? Math.min(100, Math.round(progress / target * 100)) : 0,
    done, reward: CREW.OBJECTIVE.REWARD,
    mine: mine ? Number(mine.n) : 0,
    claimed: !!mine?.claimed,
    claimable: done && !mine?.claimed,   // you must have contributed to claim (a progress row exists)
    contributions: contrib.map((r) => ({ name: r.name, n: Number(r.n), claimed: !!r.claimed })),
  };
}

// claim your cut of a COMPLETED objective — once per member per week. §10.4: a ledgered `crew:objective`
// cash faucet (bounded: REWARD × contributing members, once per week per crew). You must have a
// contribution row (you helped) — a member who did nothing this week has nothing to claim.
export async function claimObjective(ch, client, h) {
  // (red-team R28 F1) agents don't draw the crew cash faucet — its siblings streak:daily / mentor:protege
  // exclude agents, and this one didn't. They still play + contribute; they just don't farm the cut.
  if (h.acct?.agent_flag) throw new GameError('agent', 'Agent accounts do not draw the crew cut.');
  const crewId = await crewIdOf(client, ch.account_id);
  if (!crewId) throw new GameError('no_crew', "You're not in a crew.");
  const week = weekOf();
  const obj = (await client.query('SELECT done FROM crew_objectives WHERE crew_id=$1 AND week=$2 FOR UPDATE', [crewId, week])).rows[0];
  if (!obj || !obj.done) throw new GameError('not_done', "The week's job isn't cracked yet.");
  // atomic claim — the row must exist (you contributed) AND be unclaimed; exactly one pass credits.
  const claim = await client.query(
    'UPDATE crew_objective_progress SET claimed=true WHERE crew_id=$1 AND week=$2 AND account_id=$3 AND NOT claimed RETURNING n',
    [crewId, week, ch.account_id]);
  if (!claim.rowCount) {
    const has = (await client.query('SELECT claimed FROM crew_objective_progress WHERE crew_id=$1 AND week=$2 AND account_id=$3', [crewId, week, ch.account_id])).rows[0];
    if (!has) throw new GameError('no_share', "You didn't work this week's job — no cut to collect.");
    throw new GameError('claimed', "You already collected your cut this week.");
  }
  const reward = CREW.OBJECTIVE.REWARD;
  ch.cash = Number(ch.cash) + reward;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: reward, reason: 'crew:objective' });
  return { ok: true, crew: 'objective_claimed', reward };
}

// ── the worker sweep — a pending invite nobody answered goes stale. Row hygiene only (the board reads
// filter on nothing here, but an unbounded invite table is untidy). ──
export async function sweepCrewInvites(pool) {
  const cut = new Date(Date.now() - CREW.INVITE_TTL_MS);
  const r = await pool.query('DELETE FROM crew_invites WHERE at < $1', [cut]);
  const q = await pool.query('DELETE FROM crew_requests WHERE at < $1', [cut]);   // join requests share the TTL
  return { swept: (r.rowCount || 0) + (q.rowCount || 0) };
}
