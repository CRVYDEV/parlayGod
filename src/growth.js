// M4 — growth systems: paths, the Daily Score, missions, daily contracts, and
// the First Week (GRASSROOTS). Every formula cites spec §5.1/§7.3–7.4 / v24.
import { GameError } from './game.js';
import {
  PATHS, MISSIONS, ONBOARD_TASKS, CONSTANTS, M4,
  levelOf, dayOf, dailyJobsOf, effStat, gunObjOf, assetEnergyCap,
} from './rules.js';
import { verifySocial } from './verify.js';

const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();

// ── PATHS (§5.1): first pick $10,000 at level ≥5; switching burns 25 $OMR ──
export async function choosePath(ch, pathId, client, h) {
  const pt = PATHS.find((x) => x.id === pathId);
  if (!pt) throw new GameError('bad_path', 'The Gun, The Ledger, or The Kitchen.');
  if (ch.path === pathId) throw new GameError('same', "That's already your trade.");
  if (levelOf(Number(ch.respect)) < 5) throw new GameError('level', 'Pick a career at level 5.');
  if (!ch.path) {
    if (Number(ch.cash) < CONSTANTS.PATH_FIRST_COST) throw new GameError('cash', `Declaring a path costs $${CONSTANTS.PATH_FIRST_COST}.`);
    ch.cash = Number(ch.cash) - CONSTANTS.PATH_FIRST_COST;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -CONSTANTS.PATH_FIRST_COST, reason: `path:${pathId}` });
  } else {
    if (Number(h.acct.omr) < CONSTANTS.PATH_SWITCH_OMR) throw new GameError('omr', `Changing careers costs ${CONSTANTS.PATH_SWITCH_OMR} $OMR.`);
    h.acct.omr = Number(h.acct.omr) - CONSTANTS.PATH_SWITCH_OMR;
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: -CONSTANTS.PATH_SWITCH_OMR, reason: `path:${pathId}` });
  }
  ch.path = pathId;
  return { ok: true, path: pathId };
}

// ── THE DAILY SCORE (§5.1): 8h cooldown, level-scaled faucet ──
export async function heist(ch, client, h) {
  if (jailed(ch)) throw new GameError('jailed', "The Score doesn't wait for jailbirds.");
  if (Number(ch.health) < 20) throw new GameError('health', 'Not in your condition. See the Doc.');
  if (ch.heist_at && new Date(ch.heist_at) > new Date())
    throw new GameError('cooldown', 'The next job lines up later.');
  const lvl = levelOf(Number(ch.respect));
  const take = 1200 * lvl + Math.floor(Math.random() * (400 * lvl + 1));
  const rep = 8 * lvl;
  ch.cash = Number(ch.cash) + take;
  ch.respect = Number(ch.respect) + rep;
  ch.heist_at = new Date(Date.now() + M4.HEIST_CD_MS);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: 'heist' });
  await h.bumpDaily(client, ch.id, 'heist');
  return { ok: true, take, rep };
}

// ── MISSIONS (§5.1): validate reqs (eff stats, fp, trade), pay once ──
export async function doMission(ch, missionId, client, h) {
  const m = MISSIONS.find((x) => x.id === missionId);
  if (!m) throw new GameError('bad_mission', 'No such job on the books.');
  const done = (await client.query('SELECT 1 FROM missions_done WHERE character_id=$1 AND mission_id=$2', [ch.id, missionId])).rows.length;
  if (done) throw new GameError('done', 'That chapter is closed.');
  const eff = (s) => effStat(ch[s], s, h.owned.assets, h.owned.gear);
  const gunFp = gunObjOf(ch.gun)?.fp || 0;
  const meets = Object.entries(m.req).every(([k, v]) =>
    k === 'lvl' ? levelOf(Number(ch.respect)) >= v
    : k === 'fp' ? gunFp >= v
    : k === 'trade' ? Number(ch.trade_rep || 0) >= v
    : eff(k) >= v);
  if (!meets) throw new GameError('reqs', "You're not ready. The family doesn't hand out second chances.");
  await client.query('INSERT INTO missions_done (character_id, mission_id) VALUES ($1,$2)', [ch.id, missionId]);
  ch.cash = Number(ch.cash) + (m.reward.cash || 0);
  ch.respect = Number(ch.respect) + (m.reward.respect || 0);
  if (m.title) ch.title = m.title;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: m.reward.cash || 0, reason: `mission:${missionId}` });
  if (m.reward.omr) { // an enumerated legal $OMR faucet (spec §2)
    h.acct.omr = Number(h.acct.omr) + m.reward.omr;
    await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: m.reward.omr, reason: `mission:${missionId}` });
  }
  return { ok: true, reward: m.reward, title: m.title || null };
}

// ── DAILY CONTRACTS (§7.4): 3 drawn by (day + 2i) mod pool — no draw storage ──
export async function getDaily(pool, characterId) {
  const day = dayOf();
  const jobs = dailyJobsOf(day);
  const row = (await pool.query('SELECT * FROM daily_progress WHERE character_id=$1 AND day=$2', [characterId, day])).rows[0];
  const counters = row ? JSON.parse(row.counters) : {};
  const claimed = row ? JSON.parse(row.claimed) : [];
  return { day, jobs: jobs.map((j) => ({ id: j.id, name: j.name, kind: j.k, goal: j.n,
    progress: Math.min(counters[j.k] || 0, j.n), claimed: claimed.includes(j.id) })) };
}

export async function claimDaily(ch, jobId, client, h) {
  const day = dayOf();
  const job = dailyJobsOf(day).find((j) => j.id === jobId);
  if (!job) throw new GameError('bad_job', "That contract isn't on today's board.");
  const row = (await client.query('SELECT * FROM daily_progress WHERE character_id=$1 AND day=$2 FOR UPDATE', [ch.id, day])).rows[0];
  const counters = row ? JSON.parse(row.counters) : {};
  const claimed = row ? JSON.parse(row.claimed) : [];
  if (claimed.includes(jobId)) throw new GameError('claimed', 'Already paid out.');
  if ((counters[job.k] || 0) < job.n) throw new GameError('unfinished', "Contract's not finished yet.");
  claimed.push(jobId);
  const all = dailyJobsOf(day).every((j) => claimed.includes(j.id));
  const lvl = levelOf(Number(ch.respect));
  const payout = 200 * lvl + (all ? 500 * lvl : 0);
  const rep = 5 * lvl + (all ? 15 * lvl : 0);
  ch.cash = Number(ch.cash) + payout;
  ch.respect = Number(ch.respect) + rep;
  let omrBonus = 0;
  if (all) { // full envelope: energy refill + a little extra if the event fund covers it
    ch.energy = 50 + 2 * lvl + assetEnergyCap(h.owned.assets);
    const fund = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    if (Number(fund.fund) >= M4.DAILY_ALL_OMR) {
      omrBonus = M4.DAILY_ALL_OMR;
      await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [omrBonus]);
      h.acct.omr = Number(h.acct.omr) + omrBonus;
      await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: omrBonus, reason: 'daily:all' });
    }
  }
  if (row) await client.query('UPDATE daily_progress SET claimed=$3 WHERE character_id=$1 AND day=$2', [ch.id, day, JSON.stringify(claimed)]);
  else await client.query('INSERT INTO daily_progress (character_id, day, counters, claimed) VALUES ($1,$2,$3,$4)', [ch.id, day, '{}', JSON.stringify(claimed)]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: payout, reason: `daily:${jobId}` });
  return { ok: true, payout, rep, all, omrBonus };
}

// ── FIRST WEEK — GRASSROOTS (§5.1, §4). Server-checked; social tasks verify
// through verify.js (mode 'live' hits the real APIs; alpha may run 'trust').
// Rewards pay in-game cash/crates/energy ONLY — never $OMR (v24 rule).
const CHECKS = {
  ob_crime: (ch) => Number(ch.lc_crime) >= 1,
  ob_boost: (ch) => !!ch.gta_at,
  ob_bank: (ch) => Number(ch.bank) > 0,
  ob_path: (ch) => !!ch.path,
  ob_family: (ch, h) => !!h.owned.gangId,
  ob_wallet: (ch, h) => !!h.acct.wallet_address,
};

export async function claimOnboard(ch, taskId, client, h) {
  const t = ONBOARD_TASKS.find((x) => x.id === taskId);
  if (!t) throw new GameError('bad_task', 'Not on the checklist.');
  const onboard = typeof h.acct.onboard === 'string' ? JSON.parse(h.acct.onboard || '{}') : (h.acct.onboard || {});
  if (onboard[taskId]) throw new GameError('claimed', 'Already claimed.');
  if (t.social) await verifySocial(taskId, h.acct);         // §4: verifies once
  else if (!CHECKS[taskId] || !CHECKS[taskId](ch, h)) throw new GameError('unfinished', 'Not done yet — the checklist pays on completion.');
  onboard[taskId] = true;
  h.acct.onboard = JSON.stringify(onboard);
  const allDone = ONBOARD_TASKS.every((x) => onboard[x.id]);
  const cash = (t.reward.cash || 0) + (allDone ? CONSTANTS.ONBOARD_CAPSTONE.cash : 0);
  const cb = (t.reward.cb || 0) + (allDone ? CONSTANTS.ONBOARD_CAPSTONE.cb : 0);
  const en = (t.reward.en || 0) + (allDone ? CONSTANTS.ONBOARD_CAPSTONE.en : 0);
  const lvl = levelOf(Number(ch.respect));
  ch.cash = Number(ch.cash) + cash;
  ch.cb = Number(ch.cb || 0) + cb;
  ch.energy = Math.min(50 + 2 * lvl + assetEnergyCap(h.owned.assets), Number(ch.energy) + en);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: `onboard:${taskId}` });
  if (cb > 0) await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: cb, reason: `onboard:${taskId}` });
  await h.track(client, h.accountId, 'first_week_step', { task: taskId, capstone: allDone });
  return { ok: true, task: taskId, cash, cb, en, capstone: allDone };
}

// ── WALLET LINK (§4): sets the account's wallet; DAS holdings verify in phase 2 ──
export async function linkWallet(ch, address, client, h) {
  const a = String(address || '').trim();
  if (a.length < 32 || a.length > 44) throw new GameError('bad_address', "That doesn't look like a Solana address.");
  h.acct.wallet_address = a;
  return { ok: true, wallet: a };
}
