// M4 — growth systems: paths, the Daily Score, missions, daily contracts, and
// the First Week (GRASSROOTS). Every formula cites spec §5.1/§7.3–7.4 / v24.
import { GameError } from './game.js';
import {
  PATHS, MISSIONS, ONBOARD_TASKS, CONSTANTS, M4, M8,
  levelOf, dayOf, dailyJobsOf, effStat, gunObjOf, assetEnergyCap,
} from './rules.js';
import { verifySocial } from './verify.js';
import { spendOmr } from './vanity.js';

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

// M8 — STAT RESPEC: redistribute the points you already trained (§5.1 stats). The TOTAL is
// conserved exactly and no stat lands below the creation base, so this mints zero power — it
// converts re-grinding time into an $OMR burn, the same convenience-not-power argument as the
// path switch above. Same total is rejected only when nothing changes (no charge for a no-op).
export async function respec(ch, alloc, client, h) {
  const want = {};
  for (const s of ['muscle', 'cunning', 'speed']) {
    want[s] = Math.floor(Number(alloc?.[s]));
    if (!Number.isFinite(want[s]) || want[s] < M8.RESPEC_STAT_MIN)
      throw new GameError('alloc', `Each stat needs at least ${M8.RESPEC_STAT_MIN} — nobody forgets how to walk.`);
  }
  const total = Number(ch.muscle) + Number(ch.cunning) + Number(ch.speed);
  if (want.muscle + want.cunning + want.speed !== total)
    throw new GameError('alloc', `Redistribute exactly what you trained: ${total} points.`);
  if (want.muscle === Number(ch.muscle) && want.cunning === Number(ch.cunning) && want.speed === Number(ch.speed))
    throw new GameError('same', "That's already you.");
  // BALANCE D7 — opposed rolls (shakedowns, jumps) are shape-sensitive: no re-shaping between
  // fights. One respec a day; failed attempts above never arm the clock.
  if (ch.respec_at && Date.now() - new Date(ch.respec_at).getTime() < M8.RESPEC_CD_MS)
    throw new GameError('cooldown', 'The trainer works miracles, not shift changes — one re-shaping a day.');
  await spendOmr(client, h, M8.RESPEC_OMR, 'respec');
  ch.respec_at = new Date();
  ch.muscle = want.muscle; ch.cunning = want.cunning; ch.speed = want.speed;
  await h.track(client, ch.account_id, 'respec', want);
  return { ok: true, stats: want };
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
  // $OMR pays ONCE PER ACCOUNT (it survives death; missions_done is per-character, so a
  // per-character check would re-mint it on every heir). cash/respect/title can be
  // re-earned each life — they're street progression and cost a full re-grind.
  let omrPaid = 0;
  if (m.reward.omr) {
    const claimed = (await client.query('SELECT 1 FROM mission_omr_claimed WHERE account_id=$1 AND mission_id=$2', [h.accountId, missionId])).rows.length;
    if (!claimed) {
      await client.query('INSERT INTO mission_omr_claimed (account_id, mission_id) VALUES ($1,$2)', [h.accountId, missionId]);
      omrPaid = m.reward.omr;
      h.acct.omr = Number(h.acct.omr) + omrPaid;
      await h.ledger(client, { accountId: h.accountId, currency: 'omr', amount: omrPaid, reason: `mission:${missionId}` }); // enumerated legal faucet (§2)
    }
  }
  return { ok: true, reward: { ...m.reward, omr: omrPaid }, title: m.title || null };
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

// FOUNDER FUNNEL ANALYTICS (mod-gated) — where new players get stuck. Pure read aggregation over the
// tables + the first_week_step telemetry the checklist already emits; no PII, no §10.4 surface. Level
// buckets use the respect thresholds (levelOf = floor(sqrt(respect/4))+1: lvl5=respect 64, 10=324, 20=1444).
export async function funnelStats(pool) {
  const one = async (q, p = []) => Number((await pool.query(q, p)).rows[0].n);
  const characters = {
    total: await one('SELECT COUNT(*) n FROM characters'),
    alive: await one('SELECT COUNT(*) n FROM characters WHERE alive'),
    dead: await one('SELECT COUNT(*) n FROM characters WHERE NOT alive'),
  };
  const levels = { // alive, by respect band
    lvl_1_4: await one('SELECT COUNT(*) n FROM characters WHERE alive AND respect < 64'),
    lvl_5_9: await one('SELECT COUNT(*) n FROM characters WHERE alive AND respect >= 64 AND respect < 324'),
    lvl_10_19: await one('SELECT COUNT(*) n FROM characters WHERE alive AND respect >= 324 AND respect < 1444'),
    lvl_20_plus: await one('SELECT COUNT(*) n FROM characters WHERE alive AND respect >= 1444'),
  };
  const progression = {
    pulled_a_job: await one('SELECT COUNT(*) n FROM characters WHERE alive AND lc_crime > 0'),
    declared_path: await one('SELECT COUNT(*) n FROM characters WHERE alive AND path IS NOT NULL'),
    in_a_family: await one('SELECT COUNT(DISTINCT character_id) n FROM gang_members'),
    linked_wallet: await one('SELECT COUNT(*) n FROM account_persistent WHERE wallet_address IS NOT NULL'),
  };
  // First-Week claims per task (+ capstone completions), from the telemetry the checklist emits
  const firstWeek = {};
  let capstone = 0;
  for (const t of ONBOARD_TASKS) firstWeek[t.id] = 0;
  const fw = (await pool.query("SELECT props FROM telemetry WHERE event='first_week_step'")).rows;
  for (const r of fw) {
    const p = typeof r.props === 'string' ? JSON.parse(r.props) : (r.props || {});
    if (p.task && firstWeek[p.task] !== undefined) firstWeek[p.task]++;
    if (p.capstone) capstone++;
  }
  return { characters, levels, progression, firstWeek: { ...firstWeek, capstone } };
}

// The guided First-Week board (read-only) — the client's "Start Here" funnel. Server-authoritative
// readiness (the same CHECKS claimOnboard enforces) so the client never re-derives game state:
// each task carries claimed (paid already), ready (the gate passes — claim now), and the social url.
export function onboardBoard(ch, h) {
  const onboard = typeof h.acct.onboard === 'string' ? JSON.parse(h.acct.onboard || '{}') : (h.acct.onboard || {});
  const tasks = ONBOARD_TASKS.map((t) => ({
    id: t.id, name: t.name, desc: t.desc, reward: t.reward, social: t.social || null,
    claimed: !!onboard[t.id],
    ready: t.social ? true : !!(CHECKS[t.id] && CHECKS[t.id](ch, h)), // social tasks verify at claim time
  }));
  return { tasks, claimed: tasks.filter((t) => t.claimed).length, total: tasks.length,
    allDone: tasks.every((t) => t.claimed), capstone: CONSTANTS.ONBOARD_CAPSTONE };
}

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

// WALLET LINK is SIWE now — see chain.js walletChallenge/walletVerify. The legacy
// base58/no-proof linkWallet was RETIRED in the EVM migration (it satisfied the ob_wallet
// reward without proving key control, and wrote a wrong-chain address the withdraw path
// can't use). `ob_wallet` (CHECKS above) gates on wallet_address, which now only a verified
// 0x SIWE link sets. Nothing exported here — POST /v1/wallet returns a redirect to SIWE.
