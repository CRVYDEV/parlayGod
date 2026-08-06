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
import { CREW, DISTRICTS, levelOf } from './rules.js';

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

// succession + dissolution after a departure (leaver's account passed so we never re-pick them).
async function settleCrew(client, crewId, leftAccount) {
  const rest = (await client.query(
    'SELECT account_id FROM crew_members WHERE crew_id=$1 ORDER BY joined_at, account_id', [crewId])).rows;
  if (!rest.length) { await client.query('DELETE FROM crews WHERE id=$1', [crewId]);
    await client.query('DELETE FROM crew_invites WHERE crew_id=$1', [crewId]);
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
  if (!crewId) return { crew: null, invites, maxMembers: CREW.MAX_MEMBERS, minLevel: CREW.MIN_LEVEL, nameMax: CREW.NAME_MAX };

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
  const target = await crewTargetOf(client, crewId);   // THE CREW HIT — the shared mark, if the leader called one
  return {
    crew: { id: crewId, name: crew.name, leader: crew.leader_account === ch.account_id, members, pending, target },
    invites, maxMembers: CREW.MAX_MEMBERS, minLevel: CREW.MIN_LEVEL, nameMax: CREW.NAME_MAX,
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

// ── the worker sweep — a pending invite nobody answered goes stale. Row hygiene only (the board reads
// filter on nothing here, but an unbounded invite table is untidy). ──
export async function sweepCrewInvites(pool) {
  const r = await pool.query('DELETE FROM crew_invites WHERE at < $1', [new Date(Date.now() - CREW.INVITE_TTL_MS)]);
  return { swept: r.rowCount || 0 };
}
