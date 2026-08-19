// THE DAY — the returning player's one-glance checklist. The game grew SEVEN daily surfaces (the login
// streak, daily contracts, the hustle, the corner, trainer drills, the daily lead, the morning paper),
// each on its own tab, so "what should I do today" meant hunting through the whole console. This
// consolidates the actionable ones into a single ordered checklist — ready / in-progress / done, each
// with a one-tap jump — so a player who logs in for ten minutes can see and clear their day at once.
//
// PURE READ — it reuses the existing board readers (streak / daily / hustle / corner / drills), so the
// number here and the number on each tab can never disagree. ZERO §10.4 (no value moves, no row written).
import { streakBoard } from './streak.js';
import { getDaily } from './growth.js';
import { hustleBoard } from './hustle.js';
import { cornerBoard } from './corner.js';
import { regimenBoard } from './regimen.js';
import { dailyLiveFor } from './rules.js';

export async function dayBoard(client, ch, h) {
  // reuse the real board readers (DRY — the day-checklist and each tab read the same source).
  // SEQUENTIAL, not Promise.all: these all share ONE pooled client, and node-pg cannot run
  // concurrent queries on a single connection — it queues them behind a DeprecationWarning today
  // and THROWS from pg@9. So the parallel form bought no speed at all (the connection serializes
  // them either way) while carrying a latent break; the honest shape is to say so. Giving each
  // reader its own connection is the wrong fix twice over: it would read outside this request's
  // transaction snapshot, and acquiring N connections per request is the pool-exhaustion shape.
  const streak = await streakBoard(ch, client);
  const daily = await getDaily(client, ch.id);
  const hustle = await hustleBoard(ch, client);
  const corner = await cornerBoard(ch, client);
  const regimen = await regimenBoard(ch, client, h);
  const items = [];

  // 1) the login streak — the habit anchor
  items.push({ id: 'streak', label: 'Daily streak', tab: 'start',
    state: streak.claimedToday ? 'done' : 'ready',
    detail: streak.claimedToday ? `day ${streak.streak} claimed` : `claim day ${streak.todayDay} — $${streak.todayReward}` });

  // 2) daily contracts — count only the LIVE ones (a solo player's gang-gated tribute is not "todo",
    // it's out of reach — the coach work-board discipline, so the number never points at a dead task)
  const claimedIds = daily.jobs.filter((j) => j.claimed).map((j) => j.id);
  const live = dailyLiveFor(claimedIds, { gangId: h.owned.gangId });
  const liveIds = new Set(live.map((j) => j.id));
  const ready = daily.jobs.filter((j) => liveIds.has(j.id) && j.progress >= j.goal).length;
  const openN = live.length;
  items.push({ id: 'contracts', label: 'Daily contracts', tab: 'start', count: ready,
    state: openN === 0 ? 'done' : ready > 0 ? 'ready' : 'todo',
    detail: openN === 0 ? 'all claimed' : ready > 0 ? `${ready} ready to collect` : `${openN} in progress` });

  // 3) tonight's hustle — the three-stop chain that routes you around the map
  items.push({ id: 'hustle', label: "Tonight's hustle", tab: 'streets',
    state: hustle.done ? 'done' : hustle.here ? 'ready' : 'todo',
    detail: hustle.done ? 'payoff collected' : `step ${hustle.step + 1}/3 — ${hustle.what}` });

  // 4) word on the street — the district corner jobs
  items.push({ id: 'corner', label: 'Word on the street', tab: 'streets', count: corner.leftToday,
    state: corner.leftToday <= 0 ? 'done' : 'ready',
    detail: corner.leftToday <= 0 ? 'done for today' : `${corner.leftToday} corner job${corner.leftToday === 1 ? '' : 's'} available` });

  // 5) trainer drills — the fixtures' daily jobs (a drill is claimable when its task is DONE and unclaimed)
  const drills = regimen.drills || [];
  const claimable = drills.filter((d) => d.done && !d.claimed).length;
  const anyOpen = drills.some((d) => !d.claimed);
  items.push({ id: 'drills', label: 'Trainer drills', tab: 'life', count: claimable,
    state: !anyOpen ? 'done' : claimable > 0 ? 'ready' : 'todo',
    detail: !anyOpen ? 'all drills done' : claimable > 0 ? `${claimable} drill${claimable === 1 ? '' : 's'} ready` : 'drills in progress' });

  const readyN = items.filter((i) => i.state === 'ready').length;
  const doneN = items.filter((i) => i.state === 'done').length;
  return { items, ready: readyN, done: doneN, total: items.length };
}
