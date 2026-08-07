// THE WEEKLY BULLETIN — "the word this week". The weekly-cadence sibling of the daily city event and
// the 28-day season mod: a server-wide SPOTLIGHT that rotates each week (deterministic from the week +
// seed), naming a pillar to focus on and a CHALLENGE tied to it. The reward is a rotating weekly TITLE
// — PURE STATUS (the streak-milestone / hitman-rep precedent): no currency, no ledger row, ZERO §10.4
// surface, and it touches NO signed lever (unlike SEASON_MODS, which twists the economy). It exists to
// give a returning player a fresh weekly FRAME and a shared talking point, not to move value.
//
// The challenge metric is an account-level LEGEND that survives death (kills, product_moved, …),
// measured as a DELTA from a snapshot taken when the player picks up the bulletin — a fresh goal from
// the moment you check in each week. The snapshot lives in weekly_bulletin (account_id, week).
import { BULLETIN, bulletinOf, weekOf } from './rules.js';
import { GameError } from './game.js';

// The SELECT lists a FIXED set of legend columns (all account_persistent, all survive death) and the
// theme's `metric` only ever indexes this already-fetched row — so there is no dynamic column name in
// SQL (a STATIC string pgquery can prepare) and no injection surface even though `metric` is data.
async function legendRow(client, accountId) {
  const r = await client.query(
    `SELECT kills, product_moved, race_wins, boxing_wins, smuggled, heists_pulled, cartel_damage
       FROM account_persistent WHERE account_id=$1`, [accountId]);
  return r.rows[0] || {};
}

// The public half of the board — the week's theme, no per-player state. Keyless-safe (surfaced on
// GET /v1/city). Pure function of the week + seed.
export function bulletinPublic(wk = weekOf()) {
  const t = bulletinOf(wk);
  return { week: wk, id: t.id, name: t.name, word: t.word, spotlight: t.spotlight, tab: t.tab,
    challenge: `Rack up ${t.target.toLocaleString()} ${challengeNoun(t.metric)} this week for the title "${t.title}".`,
    title: t.title };
}

// A human noun for the metric (the challenge line).
function challengeNoun(metric) {
  return { kills: 'kills', product_moved: 'in product moved', race_wins: 'race wins', boxing_wins: 'ring wins',
    smuggled: 'in contraband landed', heists_pulled: 'crew scores', cartel_damage: 'in cartel damage' }[metric] || metric;
}

// The player's board: the week's theme + THEIR challenge progress. Snapshots the legend on first pickup
// this week (the season-recap snapshot pattern), so progress = current legend − snapshot, clamped ≥ 0.
export async function bulletinBoard(client, accountId) {
  const wk = weekOf();
  const t = bulletinOf(wk);
  const legend = await legendRow(client, accountId);
  const now = Number(legend[t.metric] || 0);
  // upsert the snapshot ONCE per (account, week) — the first pickup sets the baseline; later reads
  // never move it. ON CONFLICT DO NOTHING is the materialize-once latch (a fresh row snapshots `now`).
  await client.query(
    `INSERT INTO weekly_bulletin (account_id, week, snapshot) VALUES ($1,$2,$3)
       ON CONFLICT (account_id, week) DO NOTHING`, [accountId, wk, now]);
  const row = (await client.query(
    'SELECT snapshot, claimed FROM weekly_bulletin WHERE account_id=$1 AND week=$2', [accountId, wk])).rows[0]
    || { snapshot: now, claimed: false };
  const progress = Math.max(0, now - Number(row.snapshot));
  return {
    ...bulletinPublic(wk),
    metric: t.metric, target: t.target,
    progress, done: progress >= t.target, claimed: !!row.claimed,
    claimable: progress >= t.target && !row.claimed,
  };
}

// Claim the week's title — status only, once per (account, week). Sets the living character's title
// slot (the streak-milestone precedent). ZERO §10.4: no currency moves, no ledger row.
export async function claimBulletin(ch, client, h) {
  const wk = weekOf();
  const t = bulletinOf(wk);
  const legend = await legendRow(client, ch.account_id);
  const now = Number(legend[t.metric] || 0);
  // ensure the snapshot exists (a player who never opened the board this week still has a baseline)
  await client.query(
    `INSERT INTO weekly_bulletin (account_id, week, snapshot) VALUES ($1,$2,$3)
       ON CONFLICT (account_id, week) DO NOTHING`, [ch.account_id, wk, now]);
  // atomic claim-then-set: only the first claim wins (the push/store discipline), so a double-tap or a
  // concurrent request can't set the title twice or throw.
  const claim = await client.query(
    `UPDATE weekly_bulletin SET claimed=true
       WHERE account_id=$1 AND week=$2 AND NOT claimed AND (snapshot + $3) <= $4
       RETURNING account_id`, [ch.account_id, wk, t.target, now]);
  if (!claim.rows.length) {
    // distinguish already-claimed from not-yet-done for a clean error
    const row = (await client.query('SELECT claimed, snapshot FROM weekly_bulletin WHERE account_id=$1 AND week=$2', [ch.account_id, wk])).rows[0];
    if (row?.claimed) throw new GameError('claimed', "You've already claimed this week's title.");
    throw new GameError('not_done', "You haven't hit this week's target yet.");
  }
  ch.title = t.title;               // status — persisted by withCharacter ($30 title slot)
  return { title: t.title, theme: t.name };
}
