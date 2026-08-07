// THE STREAK — the daily-login habit loop (the retention cadence the game structurally lacked).
//
// Rich CATCH-UP (the Morning Paper) and rich ANTICIPATION (the events strip) both existed, but nothing
// rewarded coming back TOMORROW specifically. THE STREAK is the habit carrot: claim once a day, the cash
// ESCALATES with the consecutive-day run (capped at MAX_DAY's value), a gap RESETS the run to 1, and the
// lifetime longest run (`streak_best`) is a status legend ranked on a leaderboard — a "who keeps showing
// up" competition.
//
// ACCOUNT-level (login_streak/login_day/streak_best on account_persistent) → SURVIVES DEATH: the heir
// keeps the streak (the referral/mentor posture; not estate-wiped, outside the migrate DISPOSITION guard
// by construction — no character_id column). Written by DIRECT SQL, so it is off persistAccount's
// positional list and clobber-safe.
//
// §10.4: ONE cash faucet `streak:daily`, character_id'd → the per-character cash check reconciles. The
// faucet is bounded HARD — once per day (the login_day guard) × a capped reward — so the ceiling is
// REWARDS[last]/day for a perfect attender (petty vs the passive stack). The test proves the vocabulary
// is closed and the faucet is the reward table.
import { GameError } from './game.js';
import { STREAK, streakReward, streakRankOf, dayOf } from './rules.js';

// ── CLAIM — collect today's login reward. Consecutive (yesterday) → the run +1; a gap (or first ever) →
// the run resets to 1. Once per day (login_day is the day-number of the last claim). §10.4: a ledgered
// `streak:daily` cash faucet. The run count climbs past MAX_DAY (the legend) while the reward flattens. ──
export async function claimStreak(ch, client, h) {
  const acct = ch.account_id;
  const row = (await client.query(
    'SELECT login_streak, login_day, streak_best, agent_flag FROM account_persistent WHERE account_id=$1 FOR UPDATE', [acct])).rows[0];
  // (red-team F5) agents don't draw the daily cash faucet — consistent with the Street Wage / referral /
  // most faucets excluding agent accounts. They still play; they just don't farm the check-in reward.
  if (row.agent_flag) throw new GameError('agent', 'Agent accounts do not draw the daily check-in.');
  const today = dayOf();
  const lastDay = Number(row.login_day || 0);
  if (lastDay === today) throw new GameError('claimed', 'You already checked in today — come back tomorrow.');
  // consecutive if the last claim was YESTERDAY; otherwise the run starts fresh at 1
  const run = (lastDay === today - 1) ? Number(row.login_streak || 0) + 1 : 1;
  const best = Math.max(Number(row.streak_best || 0), run);
  const cash = streakReward(run);
  ch.cash = Number(ch.cash) + cash;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: 'streak:daily' });
  await client.query(
    'UPDATE account_persistent SET login_streak=$2, login_day=$3, streak_best=$4 WHERE account_id=$1',
    [acct, run, today, best]);
  return { ok: true, streak: run, cash, best, rank: streakRankOf(best).name };
}

// ── THE BOARD — your current run, whether today's claim is still open, what today pays, your lifetime
// best + rank, and the reward table so the client renders the ladder. A pure read; single-party. ──
export async function streakBoard(ch, client) {
  const acct = (await client.query(
    'SELECT login_streak, login_day, streak_best FROM account_persistent WHERE account_id=$1', [ch.account_id])).rows[0] || {};
  const today = dayOf();
  const lastDay = Number(acct?.login_day || 0);
  const run = Number(acct?.login_streak || 0);
  const claimedToday = lastDay === today;
  // if today's claim is still open, what run day would it land on (consecutive vs a reset to 1)
  const nextRun = claimedToday ? run : (lastDay === today - 1 ? run + 1 : 1);
  const best = Number(acct?.streak_best || 0);
  return {
    streak: run,
    claimedToday,
    // the run breaks if you don't come back TOMORROW (surfaced so the stakes are legible)
    atRisk: !claimedToday && lastDay > 0 && lastDay < today - 1,
    todayReward: claimedToday ? 0 : streakReward(nextRun),
    todayDay: nextRun,
    best, rank: streakRankOf(best).name,
    maxDay: STREAK.MAX_DAY,
    rewards: STREAK.REWARDS,
  };
}

// ── THE LEADERBOARD — by lifetime longest run (streak_best). Pure status, survives death; agents + NPC
// residents excluded (the mentors/hitman-rep board twin). ──
export async function streakLeaderboard(pool) {
  const rows = (await pool.query(
    `SELECT ap.account_id, ap.streak_best, ap.login_streak, c.name
       FROM account_persistent ap
       LEFT JOIN characters c ON c.account_id=ap.account_id AND c.alive
      WHERE ap.streak_best > 0 AND NOT ap.agent_flag AND NOT ap.npc_flag
      ORDER BY ap.streak_best DESC, ap.login_streak DESC LIMIT 25`)).rows;
  return rows.map((r) => ({
    name: r.name || 'a ghost', best: Number(r.streak_best), current: Number(r.login_streak),
    rank: streakRankOf(Number(r.streak_best)).name,
  }));
}
