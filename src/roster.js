// THE ROSTER — the family's made men as a scarce, assignable resource (the strategy package's
// SCARCE PEOPLE; the WHO to steps two and three's WHEN and HOW MUCH).
//
// This module is deliberately READ-ONLY and leaf: it imports only rules, so gangs.js, territory.js
// and convoy.js can all reach it without a cycle. The mutations (assign / vacate) live in
// src/social/gangs.js beside promoteMember and kickMember, which is where family membership lives.
//
// THE LIVE GATE IS THE WHOLE MECHANIC. A post counts only while its holder is alive, out of lockup
// and out of the hospital — so a rival takes a family's Enforcer off the board with the PvP layer
// that already exists, and the family either gets him out or spends a SECOND made man on the chair.
// That is the interlock; the numbers underneath are small on purpose.
import { M3, ROSTER_POSTS, rosterPostOf, rosterPower, rosterMult } from './rules.js';

// The power of the man holding one post for one family, or 0 if the post is empty OR its holder is
// dead / jailed / hospitalized. One indexed query; the availability test is IN the query, so no
// caller can forget it.
export async function postPower(client, gangId, postId) {
  const post = rosterPostOf(postId);
  if (!gangId || !post) return 0;
  const r = (await client.query(
    `SELECT c.muscle, c.cunning, c.speed FROM gang_members m JOIN characters c ON c.id = m.character_id
     WHERE m.gang_id = $1 AND m.post = $2 AND c.alive
       AND (c.jail_until IS NULL OR c.jail_until <= now())
       AND (c.hosp_until IS NULL OR c.hosp_until <= now())`, [gangId, postId])).rows[0];
  return r ? rosterPower(r[post.stat]) : 0;
}

// The whole table for one family, for the board: who holds what, whether he is ON HIS FEET right
// now, and what the post is currently worth. A holder who is away is reported WITH the reason — a
// family staring at a dead post should be told why it is dead, not left to work it out.
export async function rosterBoard(client, gangId) {
  if (!gangId) return [];
  const rows = (await client.query(
    `SELECT m.character_id, m.post, m.post_at, c.name, c.alive, c.jail_until, c.hosp_until, c.muscle, c.cunning, c.speed
     FROM gang_members m JOIN characters c ON c.id = m.character_id
     WHERE m.gang_id = $1 AND m.post IS NOT NULL`, [gangId])).rows;
  const now = Date.now();
  const held = new Map();
  for (const r of rows) {
    const jailed = r.jail_until && new Date(r.jail_until).getTime() > now;
    const hurt = r.hosp_until && new Date(r.hosp_until).getTime() > now;
    const away = !r.alive ? 'gone' : jailed ? 'in lockup' : hurt ? 'in the hospital' : null;
    held.set(r.post, { characterId: r.character_id, name: r.name, away,
      power: away ? 0 : rosterPower(r[rosterPostOf(r.post)?.stat]),
      sinceSeconds: r.post_at ? Math.max(0, Math.round((now - new Date(r.post_at).getTime()) / 1000)) : null });
  }
  return ROSTER_POSTS.map((p) => ({ id: p.id, name: p.name, stat: p.stat, what: p.what,
    holder: held.get(p.id) || null, power: held.get(p.id)?.power || 0 }));
}

// What each post is worth to the family RIGHT NOW — one round trip, so the console can show the
// consequence of an empty chair rather than a name and a shrug. Mirrors the same helpers the tills
// read, so the board and the game can never disagree about what a post is doing.
export async function rosterEffects(client, gangId) {
  const [enforcer, capo, streetboss, quartermaster, bagman] = await Promise.all(
    ROSTER_POSTS.map((p) => postPower(client, gangId, p.id)));
  return {
    enforcer: { power: enforcer, turfPremium: enforcer * M3.ROSTER_ENFORCER_GARRISON },
    capo: { power: capo, scrutinyMult: rosterMult(capo, M3.ROSTER_CAPO_SCRUTINY_PER) },
    streetboss: { power: streetboss, warMult: rosterMult(streetboss, M3.ROSTER_STREETBOSS_WAR_PER) },
    quartermaster: { power: quartermaster, guardDef: quartermaster * M3.ROSTER_QM_GUARD_DEF },
    bagman: { power: bagman, upkeepMult: rosterMult(bagman, M3.ROSTER_BAGMAN_UPKEEP_PER) },
  };
}
