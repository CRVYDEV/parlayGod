// ═══ FIVE PILLARS #4 — UNDERWORLD CAMPAIGNS (RuneScape quests × Fable choices) ═══
// The game's first AUTHORED narrative: each fixer offers a story chain (the CAMPAIGNS catalog in
// rules.js — the content is data). Task steps advance automatically on the Underworld ACTION stream
// (advanceCampaigns is called from game.js bumpStanding — the errand-chain precedent, same action
// vocabulary); choice steps are the Fable branch (honor now, a ruthless-cash branch sweetens the
// final claim). The one-time reward is claimed explicitly (the missions pay-once precedent):
// cash (`campaign:reward` — an enumerated, once-per-street-per-chain faucet at mission scale),
// fixer standing, honor, and on some finales a TITLE. `campaign_progress` DIES with the street
// (estate-wiped) — a fresh street walks the stories again, the roguelike spine.
import { GameError, bumpStanding } from './game.js';
import { CAMPAIGNS, campaignOf, CAMPAIGN_MIN_STANDING } from './rules.js';
import { bumpHonor } from './honor.js';

const stepOf = (c, i) => c.steps[i] || null;
// NOTE: the action-stream advance (advanceCampaignsInline) lives in game.js bumpStanding — inline
// there to keep the import graph acyclic (this module imports game.js one-way).

export async function startCampaign(ch, campaignId, client, h) {
  const c = campaignOf(campaignId);
  if (!c) throw new GameError('bad_campaign', 'No such story.');
  const standing = Number(h.owned.npc?.[c.npc] || 0);
  if (standing < CAMPAIGN_MIN_STANDING)
    throw new GameError('standing', `${c.name} opens at standing ${CAMPAIGN_MIN_STANDING} with the fixer — do some business first.`);
  const existing = (await client.query(
    'SELECT * FROM campaign_progress WHERE character_id=$1 AND campaign_id=$2', [ch.id, campaignId])).rows[0];
  if (existing) throw new GameError(existing.claimed ? 'done' : 'already', existing.claimed
    ? 'That story is already told — it lives in your legend now.' : 'You\'re already in that story.');
  await client.query('INSERT INTO campaign_progress (character_id, campaign_id) VALUES ($1,$2)', [ch.id, campaignId]);
  return { ok: true, campaign: c.name, say: c.steps[0].say };
}

export async function chooseCampaign(ch, campaignId, branchId, client, h) {
  const c = campaignOf(campaignId);
  if (!c) throw new GameError('bad_campaign', 'No such story.');
  const p = (await client.query(
    'SELECT * FROM campaign_progress WHERE character_id=$1 AND campaign_id=$2', [ch.id, campaignId])).rows[0];
  if (!p || p.completed) throw new GameError('no_choice', 'No fork in the road right now.');
  const step = stepOf(c, Number(p.step));
  if (!step?.choice) throw new GameError('no_choice', 'This part of the story is walked, not chosen.');
  const pick = step.choice.find((b) => b.id === branchId);
  if (!pick) throw new GameError('bad_branch', 'That was never on the table.');
  const nextStep = Number(p.step) + 1;
  const finished = nextStep >= c.steps.length;
  await client.query(
    'UPDATE campaign_progress SET step=$3, done=0, branch=$4, completed=$5 WHERE character_id=$1 AND campaign_id=$2',
    [ch.id, campaignId, nextStep, pick.id, finished]);
  // the APPLIED honor, not the nominal — honor clamps at [MIN, MAX], so a +10 choice at 96 moves you
  // 4 and a reader told "+10" is told something the game did not do. (bumpHonor returns the pair.)
  const hit = pick.honor ? await bumpHonor(client, ch, pick.honor) : null;
  return { ok: true, chose: pick.label, honor: hit ? hit.applied : 0,
    honorNow: hit ? hit.honor : Number(ch.honor || 0), honorAsked: pick.honor || 0, completed: finished,
    say: finished ? null : stepOf(c, nextStep)?.say };
}

export async function claimCampaign(ch, campaignId, client, h) {
  const c = campaignOf(campaignId);
  if (!c) throw new GameError('bad_campaign', 'No such story.');
  const p = (await client.query(
    'SELECT * FROM campaign_progress WHERE character_id=$1 AND campaign_id=$2', [ch.id, campaignId])).rows[0];
  if (!p || !p.completed) throw new GameError('not_done', 'The story isn\'t over yet.');
  if (p.claimed) throw new GameError('claimed', 'You already collected on that one.');
  await client.query(
    'UPDATE campaign_progress SET claimed=true WHERE character_id=$1 AND campaign_id=$2', [ch.id, campaignId]);
  // the branch's cash sweetener (the ruthless path pays) folds into the one ledger row. Key it to the
  // choice STEP that actually offered the branch (not a global id scan) so a future multi-choice chain
  // reusing a branch id can't pay the wrong sweetener (audit LOW-4 hardening).
  const branchCash = p.branch
    ? (c.steps.find((s) => s.choice?.some((b) => b.id === p.branch))?.choice
        .find((b) => b.id === p.branch)?.cash || 0) : 0;
  const cash = Number(c.reward.cash || 0) + branchCash;
  if (cash > 0) {
    ch.cash = Number(ch.cash) + cash;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'campaign:reward', counterparty: c.npc });
  }
  const hit = c.reward.honor ? await bumpHonor(client, ch, c.reward.honor) : null;
  if (c.reward.standing) await bumpStanding(client, h, ch, c.npc, c.reward.standing, { business: false });
  if (c.reward.title) ch.title = c.reward.title;
  return { ok: true, campaign: c.name, cash, honor: hit ? hit.applied : 0,
    honorNow: hit ? hit.honor : Number(ch.honor || 0), honorAsked: c.reward.honor || 0,
    standing: c.reward.standing || 0, title: c.reward.title || null };
}

export async function campaignBoard(ch, client, h) {
  const progress = Object.fromEntries((await client.query(
    'SELECT * FROM campaign_progress WHERE character_id=$1', [ch.id])).rows.map((p) => [p.campaign_id, p]));
  return {
    minStanding: CAMPAIGN_MIN_STANDING,
    campaigns: CAMPAIGNS.map((c) => {
      const p = progress[c.id];
      const standing = Number(h.owned.npc?.[c.npc] || 0);
      const step = p && !p.completed ? stepOf(c, Number(p.step)) : null;
      return {
        id: c.id, npc: c.npc, name: c.name, blurb: c.blurb, steps: c.steps.length,
        available: !p && standing >= CAMPAIGN_MIN_STANDING,
        locked: !p && standing < CAMPAIGN_MIN_STANDING, standing,
        active: !!p && !p.completed, step: p ? Number(p.step) : 0,
        done: p ? Number(p.done) : 0, need: step?.n || null,
        say: step?.say || null,
        choice: step?.choice ? step.choice.map((b) => ({ id: b.id, label: b.label, honor: b.honor || 0 })) : null,
        action: step?.action || null,
        completed: !!p?.completed, claimed: !!p?.claimed,
        reward: { cash: c.reward.cash, standing: c.reward.standing, honor: c.reward.honor, title: c.reward.title },
      };
    }),
  };
}
