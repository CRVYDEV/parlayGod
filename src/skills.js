// SKILLS & SPECIALIZATIONS (design: omerta-skills-design.md). The character BUILD layer: three
// branches × three tiers, points derived from LEVEL (1 per LVL_PER_POINT — points are never
// stored or granted, so there is no currency and no §10.4 surface). Tier costs 1/2/3 and the
// previous tier is required, so maxing one branch = lvl 24 and two = lvl 48 — a real
// specialization choice, and the M8 stat-respec finally has a companion: skill respec burns
// $OMR (`respec:skills`, riding the `respec` vocabulary prefix + the LIKE'd burn term) on the
// SHARED respec cooldown (`characters.respec_at` — the trainer sees you once a day).
//
// Skills DIE WITH THE STREET (estate wipes character_skills — like stats, unlike prestige).
// Every effect is a NEW single-touchpoint modifier read via game.js `hasSkill`/`skillMult`/
// `trunkCap` — deliberately OFF the audit-locked surfaces. All numbers are sign-off levers.
import { GameError } from './game.js';
import { SKILLS, skillOf, levelOf, M8 } from './rules.js';
import { spendOmr } from './vanity.js';

const pointsOf = (ch, owned) => {
  const total = Math.floor(levelOf(Number(ch.respect)) / SKILLS.LVL_PER_POINT);
  const spent = [...(owned.skills || [])].reduce((a, id) => a + (skillOf(id)?.cost || 0), 0);
  return { total, spent, available: Math.max(0, total - spent) };
};

// LEARN — spend derived points; previous tier in the branch is the prerequisite.
export async function learnSkill(ch, skillId, client, h) {
  const s = skillOf(skillId);
  if (!s) throw new GameError('bad_skill', 'Nobody teaches that around here.');
  if (h.owned.skills.has(s.id)) throw new GameError('owned', 'You already know it.');
  if (s.tier > 1) {
    const prereq = SKILLS.TREE.find((x) => x.branch === s.branch && x.tier === s.tier - 1);
    if (!h.owned.skills.has(prereq.id))
      throw new GameError('prereq', `${s.name} builds on ${prereq.name} — learn that first.`);
  }
  const pts = pointsOf(ch, h.owned);
  if (s.cost > pts.available)
    throw new GameError('points', `${s.name} takes ${s.cost} point(s) — you have ${pts.available}. Points come with levels.`);
  await client.query('INSERT INTO character_skills (character_id, skill_id) VALUES ($1,$2)', [ch.id, s.id]);
  h.owned.skills.add(s.id); // the view (and any same-txn touchpoint) sees it immediately
  await h.track(client, ch.account_id, 'skill_learned', { skill: s.id });
  return { ok: true, learned: s.id, name: s.name, points: pointsOf(ch, h.owned) };
}

// RESPEC — unlearn everything for RESPEC_OMR (a §10.4 burn), on the shared respec cooldown.
export async function respecSkills(ch, client, h) {
  if (!h.owned.skills.size) throw new GameError('none', 'Nothing to unlearn.');
  if (ch.respec_at && Date.now() - new Date(ch.respec_at).getTime() < M8.RESPEC_CD_MS)
    throw new GameError('cooldown', 'The trainer sees you once a day.');
  await spendOmr(client, h, SKILLS.RESPEC_OMR, 'respec:skills'); // balance-guarded burn
  await client.query('DELETE FROM character_skills WHERE character_id=$1', [ch.id]);
  const unlearned = [...h.owned.skills];
  h.owned.skills = new Set();
  ch.respec_at = new Date();
  await h.track(client, ch.account_id, 'skill_respec', { unlearned });
  return { ok: true, unlearned, omr: SKILLS.RESPEC_OMR, points: pointsOf(ch, h.owned) };
}

// The board — the full tree, what this street knows, and the point budget.
export function skillsBoard(ch, h) {
  return {
    lvlPerPoint: SKILLS.LVL_PER_POINT, respecOmr: SKILLS.RESPEC_OMR,
    points: pointsOf(ch, h.owned),
    tree: SKILLS.TREE.map((s) => ({ ...s, known: h.owned.skills.has(s.id) })),
  };
}
