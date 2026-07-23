// ═══ FIVE PILLARS #2 — DIPLOMACY & COALITIONS (the EU4 layer) ═══
// Formal treaties between families + the anti-hegemon coalition. ZERO new money: a pact is a status
// row whose one touchpoint is `declareWar` throwing 'pact' (the Commission-pax precedent); breaking
// a sworn pact early marks the family OATHBREAKER (no new proposals while it stands) and costs the
// breaking boss HONOR.OATHBREAK. A coalition against a DOMINANT family gives members the two
// anti-snowball discounts — war chest ×COALITION_WAR_MULT and seize outbid ×COALITION_SEIZE_MULT vs
// the target — both riding EXISTING ledgered sinks at the discounted number (decree precedent).
//
// Lock order: char (withCharacter) → the two gang rows SORTED (the declareWar convention) →
// relation/coalition rows (leaves). The coalition read helpers are UNLOCKED point-in-time reads
// (a lockless quote, the outfitStrengthFrac precedent) — the discount is priced at the moment of
// the act, exactly like every other modifier.
import crypto from 'node:crypto';
import { GameError, bus, notify } from './game.js';
import { DIPLOMACY, HONOR, DISTRICTS } from './rules.js';
import { bumpHonor, isMadDog } from './honor.js';

const canCommand = (h) => h.owned.gangRole === 'boss' || h.owned.gangRole === 'underboss';
const pair = (a, b) => [a, b].sort();
const active = (r) => r && r.accepted && r.until && new Date(r.until) > new Date();

// ── reads (unlocked — safe as quotes, the modifier convention) ──
export async function relationBetween(client, a, b) {
  if (!a || !b) return null;
  const [ga, gb] = pair(a, b);
  return (await client.query('SELECT * FROM gang_relations WHERE gang_a=$1 AND gang_b=$2', [ga, gb])).rows[0] || null;
}
export const pactActive = async (client, a, b) => active(await relationBetween(client, a, b));

// an ACTIVE coalition (unexpired, ≥ COALITION_MIN member families) that `gangId` belongs to,
// targeting `targetGangId` — the teeth switch. Point-in-time read.
export async function coalitionDiscountActive(client, gangId, targetGangId) {
  if (!gangId || !targetGangId) return false;
  // flat queries — pg-mem can't parse the correlated subquery (the /v1/gangs precedent)
  const mine = (await client.query(
    `SELECT c.id FROM coalitions c JOIN coalition_members m ON m.coalition_id=c.id
      WHERE c.target_gang=$1 AND m.gang_id=$2 AND c.expires_at > now()`, [targetGangId, gangId])).rows;
  if (!mine.length) return false;
  for (const c of mine) {
    const n = Number((await client.query(
      'SELECT COUNT(*) cnt FROM coalition_members WHERE coalition_id=$1', [c.id])).rows[0].cnt);
    if (n >= DIPLOMACY.COALITION_MIN) return true;
  }
  return false;
}

// DOMINANCE — the EU4 aggressive-expansion test, computed live (never stored): a family is dominant
// when it holds ≥ DOMINANCE_DISTRICTS core districts OR its standing (the documented formula:
// lifetime_tribute + 10000×wars_won) is ≥ DOMINANCE_STANDING_MULT × the runner-up's.
export async function dominanceOf(client, gangId) {
  const gangs = (await client.query('SELECT id, lifetime_tribute, wars_won FROM gangs')).rows
    .map((g) => ({ id: g.id, standing: Number(g.lifetime_tribute) + 10000 * Number(g.wars_won) }))
    .sort((a, b) => b.standing - a.standing);
  const mine = gangs.find((g) => g.id === gangId);
  if (!mine) return { dominant: false, districts: 0, standing: 0 };
  const runnerUp = gangs.filter((g) => g.id !== gangId)[0];
  const held = (await client.query('SELECT COUNT(*) c FROM districts WHERE holder_gang=$1', [gangId])).rows[0];
  const districts = Number(held.c);
  const byTurf = districts >= DIPLOMACY.DOMINANCE_DISTRICTS;
  const byStanding = mine.standing > 0 && (!runnerUp || mine.standing >= DIPLOMACY.DOMINANCE_STANDING_MULT * Math.max(1, runnerUp.standing));
  return { dominant: byTurf || byStanding, districts, standing: mine.standing, byTurf, byStanding };
}

const oathbroken = (g) => g.oathbreaker_until && new Date(g.oathbreaker_until) > new Date();

// ── PACTS ──
export async function proposePact(ch, targetGangId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Treaties are family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  if (targetGangId === h.owned.gangId) throw new GameError('self', 'A treaty with yourself is called a diary.');
  if (isMadDog(ch)) throw new GameError('mad_dog', 'No family shakes a mad dog\'s hand. Earn some honor first.');
  const [id1, id2] = pair(h.owned.gangId, targetGangId);
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === h.owned.gangId ? g1 : g2, them = g1?.id === h.owned.gangId ? g2 : g1;
  if (!them) throw new GameError('no_gang', 'That family no longer exists.');
  if (oathbroken(us)) throw new GameError('oathbreaker', 'Your family\'s word is mud right now — the mark has to fade first.');
  const existing = await relationBetween(client, us.id, them.id);
  if (active(existing)) throw new GameError('already', 'A treaty already stands between the families.');
  if (existing && !existing.accepted && existing.proposed_by === us.id) throw new GameError('pending', 'Your offer is already on their table.');
  // a stale/expired/pending-from-them row is replaced by this fresh proposal (UPDATE-then-INSERT, sweep-race-proof)
  const up = await client.query(
    'UPDATE gang_relations SET kind=$3, proposed_by=$4, accepted=false, until=NULL, created_at=now() WHERE gang_a=$1 AND gang_b=$2',
    [id1, id2, 'pact', us.id]);
  if (!up.rowCount) await client.query(
    'INSERT INTO gang_relations (gang_a, gang_b, kind, proposed_by) VALUES ($1,$2,$3,$4)', [id1, id2, 'pact', us.id]);
  bus.emit(`gang:${them.id}`, { type: 'pact_offered', by: us.name });
  return { ok: true, pending: true, to: them.name };
}

export async function acceptPact(ch, targetGangId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Treaties are family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  if (isMadDog(ch)) throw new GameError('mad_dog', "No family shakes a mad dog's hand — accepting the pact doesn't dodge that.");
  const [id1, id2] = pair(h.owned.gangId, targetGangId);
  await client.query('SELECT id FROM gangs WHERE id=$1 FOR UPDATE', [id1]);
  await client.query('SELECT id FROM gangs WHERE id=$1 FOR UPDATE', [id2]);
  const r = (await client.query('SELECT * FROM gang_relations WHERE gang_a=$1 AND gang_b=$2 FOR UPDATE', [id1, id2])).rows[0];
  if (!r || r.proposed_by === h.owned.gangId) throw new GameError('no_offer', 'There\'s no offer on your table from them.');
  if (active(r)) throw new GameError('already', 'The treaty already stands.');
  const until = new Date(Date.now() + DIPLOMACY.PACT_MS);
  await client.query('UPDATE gang_relations SET accepted=true, until=$3 WHERE gang_a=$1 AND gang_b=$2', [id1, id2, until]);
  bus.emit('streets', { type: 'pact_signed', a: h.owned.gangName, b: targetGangId });
  return { ok: true, until };
}

export async function breakPact(ch, targetGangId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Treaties are family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss speaks for the family.');
  const [id1, id2] = pair(h.owned.gangId, targetGangId);
  const g1 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id1])).rows[0];
  const g2 = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [id2])).rows[0];
  const us = g1?.id === h.owned.gangId ? g1 : g2, them = g1?.id === h.owned.gangId ? g2 : g1;
  const r = (await client.query('SELECT * FROM gang_relations WHERE gang_a=$1 AND gang_b=$2 FOR UPDATE', [id1, id2])).rows[0];
  if (!r) throw new GameError('no_pact', 'There\'s nothing between the families to break.');
  const sworn = active(r); // breaking a mere pending offer is free; breaking a SWORN pact is the oathbreak
  await client.query('DELETE FROM gang_relations WHERE gang_a=$1 AND gang_b=$2', [id1, id2]);
  if (sworn) {
    await client.query('UPDATE gangs SET oathbreaker_until=$2 WHERE id=$1',
      [us.id, new Date(Date.now() + DIPLOMACY.OATHBREAK_MS)]);
    await bumpHonor(client, ch, HONOR.OATHBREAK);
    bus.emit('streets', { type: 'oathbreak', gang: us.name, on: them?.name });
    if (them) bus.emit(`gang:${them.id}`, { type: 'pact_broken', by: us.name });
  }
  return { ok: true, oathbreak: sworn, honor: ch.honor };
}

// ── COALITIONS ──
export async function formCoalition(ch, targetGangId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Coalitions are family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss commits the family.');
  if (targetGangId === h.owned.gangId) throw new GameError('self', 'You can\'t coalition against yourself.');
  if (isMadDog(ch)) throw new GameError('mad_dog', 'Nobody follows a mad dog into a coalition.');
  const us = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId])).rows[0];
  if (oathbroken(us)) throw new GameError('oathbreaker', 'An oathbreaker family can\'t rally the city.');
  const them = (await client.query('SELECT id, name FROM gangs WHERE id=$1', [targetGangId])).rows[0];
  if (!them) throw new GameError('no_gang', 'That family no longer exists.');
  if (await pactActive(client, h.owned.gangId, targetGangId))
    throw new GameError('pact', 'You have a sworn treaty with them — break it first (and wear the mark).');
  const dom = await dominanceOf(client, targetGangId);
  if (!dom.dominant) throw new GameError('not_dominant', 'The city only rallies against a DOMINANT family (2+ districts, or standing 2× the runner-up).');
  const existing = (await client.query('SELECT * FROM coalitions WHERE target_gang=$1 AND expires_at > now()', [targetGangId])).rows[0];
  if (existing) throw new GameError('exists', 'A coalition against them already stands — join it.');
  const id = crypto.randomUUID();
  await client.query('INSERT INTO coalitions (id, target_gang, formed_by, expires_at) VALUES ($1,$2,$3,$4)',
    [id, targetGangId, h.owned.gangId, new Date(Date.now() + DIPLOMACY.COALITION_MS)]);
  await client.query('INSERT INTO coalition_members (coalition_id, gang_id) VALUES ($1,$2)', [id, h.owned.gangId]);
  bus.emit('streets', { type: 'coalition_formed', against: them.name, by: us.name });
  return { ok: true, id, against: them.name, needed: DIPLOMACY.COALITION_MIN };
}

export async function joinCoalition(ch, coalitionId, client, h) {
  if (!h.owned.gangId) throw new GameError('no_gang', 'Coalitions are family business.');
  if (!canCommand(h)) throw new GameError('rank', 'Only the boss or underboss commits the family.');
  if (isMadDog(ch)) throw new GameError('mad_dog', "Nobody stands beside a mad dog — joining doesn't dodge that.");
  await client.query('SELECT id FROM gangs WHERE id=$1 FOR UPDATE', [h.owned.gangId]);
  const c = (await client.query('SELECT * FROM coalitions WHERE id=$1 AND expires_at > now() FOR UPDATE', [coalitionId])).rows[0];
  if (!c) throw new GameError('no_coalition', 'That coalition has dissolved.');
  if (c.target_gang === h.owned.gangId) throw new GameError('self', 'It\'s aimed at YOU.');
  if (await pactActive(client, h.owned.gangId, c.target_gang))
    throw new GameError('pact', 'You have a sworn treaty with the target — break it first.');
  const dup = (await client.query('SELECT 1 FROM coalition_members WHERE coalition_id=$1 AND gang_id=$2', [coalitionId, h.owned.gangId])).rows[0];
  if (dup) throw new GameError('already', 'Your family already stands in it.');
  await client.query('INSERT INTO coalition_members (coalition_id, gang_id) VALUES ($1,$2)', [coalitionId, h.owned.gangId]);
  const n = Number((await client.query('SELECT COUNT(*) c FROM coalition_members WHERE coalition_id=$1', [coalitionId])).rows[0].c);
  if (n === DIPLOMACY.COALITION_MIN) bus.emit('streets', { type: 'coalition_armed', coalition: coalitionId });
  return { ok: true, members: n, armed: n >= DIPLOMACY.COALITION_MIN };
}

export async function leaveCoalition(ch, coalitionId, client, h) {
  if (!h.owned.gangId || !canCommand(h)) throw new GameError('rank', 'Only the boss or underboss walks the family out.');
  const r = await client.query('DELETE FROM coalition_members WHERE coalition_id=$1 AND gang_id=$2', [coalitionId, h.owned.gangId]);
  if (!r.rowCount) throw new GameError('no_coalition', 'You weren\'t in it.');
  return { ok: true };
}

// ── the public board ──
export async function diplomacyBoard(client, h) {
  const gid = h.owned.gangId || null;
  const names = Object.fromEntries((await client.query('SELECT id, name, tag FROM gangs')).rows.map((g) => [g.id, { name: g.name, tag: g.tag }]));
  const rel = gid ? (await client.query(
    'SELECT * FROM gang_relations WHERE gang_a=$1 OR gang_b=$1 ORDER BY created_at DESC', [gid])).rows : [];
  // two flat queries — pg-mem can't parse a correlated subquery (the /v1/gangs precedent)
  const coalRows = (await client.query(
    'SELECT * FROM coalitions WHERE expires_at > now() ORDER BY created_at DESC')).rows;
  const memberCounts = {};
  for (const m of (await client.query('SELECT coalition_id FROM coalition_members')).rows)
    memberCounts[m.coalition_id] = (memberCounts[m.coalition_id] || 0) + 1;
  const coals = coalRows.map((c) => ({ ...c, members: memberCounts[c.id] || 0 }));
  const myMemberships = gid ? new Set((await client.query(
    'SELECT coalition_id FROM coalition_members WHERE gang_id=$1', [gid])).rows.map((r) => r.coalition_id)) : new Set();
  const dom = [];
  for (const g of Object.keys(names)) { // small N (families) — the commission-seats read precedent
    const d = await dominanceOf(client, g);
    if (d.dominant) dom.push({ gangId: g, ...names[g], districts: d.districts, standing: d.standing });
  }
  const my = gid ? (await client.query('SELECT oathbreaker_until FROM gangs WHERE id=$1', [gid])).rows[0] : null;
  return {
    relations: rel.map((r) => {
      const other = r.gang_a === gid ? r.gang_b : r.gang_a;
      return { with: names[other]?.name || 'a dissolved family', withId: other, kind: r.kind,
        pending: !r.accepted, mine: r.proposed_by === gid,
        active: active(r), until: r.until,
        seconds: r.until ? Math.max(0, Math.floor((new Date(r.until) - Date.now()) / 1000)) : null };
    }),
    coalitions: coals.map((c) => ({ id: c.id, against: names[c.target_gang]?.name || '?', againstId: c.target_gang,
      members: Number(c.members), armed: Number(c.members) >= DIPLOMACY.COALITION_MIN,
      mine: myMemberships.has(c.id), targetsMe: c.target_gang === gid,
      seconds: Math.max(0, Math.floor((new Date(c.expires_at) - Date.now()) / 1000)) })),
    dominant: dom,
    oathbreaker: my?.oathbreaker_until && new Date(my.oathbreaker_until) > new Date()
      ? { seconds: Math.floor((new Date(my.oathbreaker_until) - Date.now()) / 1000) } : null,
    levers: { pactDays: DIPLOMACY.PACT_MS / 86400000, coalitionMin: DIPLOMACY.COALITION_MIN,
      warMult: DIPLOMACY.COALITION_WAR_MULT, seizeMult: DIPLOMACY.COALITION_SEIZE_MULT },
  };
}

// dissolution hygiene — a dead family's treaties + coalition seats go with it (no ghost governance,
// the commission-votes precedent). Called from the dissolution site under the gang lock.
export async function dissolveDiplomacy(client, gangId) {
  await client.query('DELETE FROM gang_relations WHERE gang_a=$1 OR gang_b=$1', [gangId]);
  await client.query('DELETE FROM coalition_members WHERE gang_id=$1', [gangId]);
  await client.query('DELETE FROM coalitions WHERE target_gang=$1 OR formed_by=$1', [gangId]);
  // memberships of coalitions this family FORMED stay pruned via the coalition delete; orphan member
  // rows (coalition gone) are invisible to every JOIN-based read and reaped by the worker sweep.
  await client.query('DELETE FROM coalition_members WHERE coalition_id NOT IN (SELECT id FROM coalitions)');
}

// the worker sweep: lapse expired coalitions + orphaned member rows (reads filter anyway — hygiene)
export async function sweepDiplomacy(pool) {
  await pool.query('DELETE FROM coalition_members WHERE coalition_id IN (SELECT id FROM coalitions WHERE expires_at <= now())');
  await pool.query('DELETE FROM coalitions WHERE expires_at <= now()');
}
