// M4 — growth systems: paths, the Daily Score, missions, daily contracts, and
// the First Week (GRASSROOTS). Every formula cites spec §5.1/§7.3–7.4 / v24.
import { GameError, cleanText, assignedSoldier, soldierResult, bumpMastery } from './game.js';
import { soldierFxOf, SOLDIERS } from './rules.js';
import {
  PATHS, MISSIONS, ONBOARD_TASKS, CONSTANTS, M4, M8, SOCIAL_TASKS, socialShareUrl, SOCIAL_LINKS,
  levelOf, dayOf, dailyJobsOf, effStat, gunObjOf, assetEnergyCap, recruitRankOf, PACING,
} from './rules.js';
import { verifySocial, verifyPostUp, socialProviders, socialTaskAvailable, throttleXCheck } from './verify.js';
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
  let take = 1200 * lvl + Math.floor(Math.random() * (400 * lvl + 1));
  const rep = 8 * lvl;
  // SOLDIERS: a SAFECRACKER second lines the next Score up sooner (pacing, never the pot) — and,
  // like any assisted job, the second takes his CUT off the top before the books (audit: without it
  // the safecracker was the one pure-upside trait — zero risk, zero cost, +40% heist cadence; the
  // cut is the same pre-ledger shave as crime, so the heist faucet strictly SHRINKS — §10.4-safe)
  const second = await assignedSoldier(client, ch.id);
  let soldierCut = 0;
  if (second) { soldierCut = Math.floor(take * SOLDIERS.CUT_BPS / 10000); take -= soldierCut; }
  ch.cash = Number(ch.cash) + take;
  ch.respect = Number(ch.respect) + rep;
  const cdMs = Math.round(M4.HEIST_CD_MS
    * (second?.trait === 'safecracker' ? Math.max(0, 1 - soldierFxOf(second)) : 1));
  ch.heist_at = new Date(Date.now() + cdMs);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: 'heist' });
  await h.bumpDaily(client, ch.id, 'heist');
  await bumpMastery(client, h, ch, 'scores', 'score');
  const soldier = second ? await soldierResult(client, h, ch, second, { success: true }) : null;
  return { ok: true, take, rep, soldier: soldier ? { ...soldier, cut: soldierCut } : null };
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
  // PACING (founder-directed, from live alpha): the ladder SELF-UNLOCKS — from ~m6 on each reward
  // overshoots the next mission's level gate by 30-100 levels — so with no cooldown all 28 could be
  // claimed back to back for 239,200 respect (level 245) in one sitting. A cooldown between claims
  // makes the chain a story you walk over days, not a number you collect in an afternoon.
  // MISSION_CD_MS = 0 restores the old cascade. `mission_at` is direct-SQL (outside
  // persistCharacter's positional UPDATE — the active_at pattern), so it can't be clobbered.
  const missionCd = Number(process.env.MISSION_CD_MS ?? PACING.MISSION_CD_MS);
  if (missionCd > 0 && ch.mission_at && new Date(ch.mission_at) > new Date())
    throw new GameError('cooldown', `The family gives you one job at a time. Next one in ${Math.ceil((new Date(ch.mission_at) - Date.now()) / 60000)}m.`);
  await client.query('INSERT INTO missions_done (character_id, mission_id) VALUES ($1,$2)', [ch.id, missionId]);
  const missionAt = new Date(Date.now() + missionCd);
  await client.query('UPDATE characters SET mission_at=$2 WHERE id=$1', [ch.id, missionAt]);
  ch.mission_at = missionAt;
  // …and the RESPECT reward is scaled: missions are a supplement to the grind, not a replacement for
  // it. Cash / $OMR / titles are UNTOUCHED — the story still pays, it just stops being the fastest
  // path to a level. (At MISSION_RESPECT_MULT 0.25 the full ladder is worth a level ~78 character.)
  const missionRep = Math.round((m.reward.respect || 0) * PACING.MISSION_RESPECT_MULT);
  ch.cash = Number(ch.cash) + (m.reward.cash || 0);
  ch.respect = Number(ch.respect) + missionRep;
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
  return { ok: true, reward: { ...m.reward, respect: missionRep, omr: omrPaid }, title: m.title || null,
    nextMissionSeconds: missionCd > 0 ? Math.ceil(missionCd / 1000) : 0 };
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
  // THE POPULATION: the onboarding funnel measures REAL players moving through the first week —
  // NPC residents would silently inflate every stage and make drop-off analysis meaningless.
  const characters = {
    total: await one('SELECT COUNT(*) n FROM characters WHERE NOT is_npc'),
    alive: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc'),
    dead: await one('SELECT COUNT(*) n FROM characters WHERE NOT alive AND NOT is_npc'),
  };
  const levels = { // alive, by respect band
    lvl_1_4: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND respect < 64'),
    lvl_5_9: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND respect >= 64 AND respect < 324'),
    lvl_10_19: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND respect >= 324 AND respect < 1444'),
    lvl_20_plus: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND respect >= 1444'),
  };
  const progression = {
    pulled_a_job: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND lc_crime > 0'),
    declared_path: await one('SELECT COUNT(*) n FROM characters WHERE alive AND NOT is_npc AND path IS NOT NULL'),
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
  // REFERRAL FUNNEL + viral coefficient (K) — how the organic loop is compounding
  const accounts = await one('SELECT COUNT(*) n FROM account_persistent WHERE NOT npc_flag');
  const referral = {
    accounts,
    referred: await one('SELECT COUNT(*) n FROM account_persistent WHERE referred_by IS NOT NULL'), // came in on a code
    sparked: await one('SELECT COUNT(*) n FROM account_persistent WHERE ref_spark'),               // hit the early gate
    qualified: await one('SELECT COUNT(*) n FROM account_persistent WHERE ref_paid'),               // hit the full gate (paid out)
    recruiters: await one('SELECT COUNT(*) n FROM account_persistent WHERE recruits > 0'),          // brought at least one made man in
    totalRecruits: await one('SELECT COALESCE(SUM(recruits),0) n FROM account_persistent'),         // qualified recruits, all-time
    reReferred: await one('SELECT COUNT(*) n FROM account_persistent WHERE referred_by IS NOT NULL AND recruits > 0'), // a recruit who then recruited (viral depth)
  };
  // K-factor ≈ qualified recruits per account (>1 means the loop compounds); spark→qualify conversion
  referral.kFactor = accounts ? Math.round((referral.totalRecruits / accounts) * 100) / 100 : 0;
  referral.sparkToQualified = referral.sparked ? Math.round((referral.qualified / referral.sparked) * 100) / 100 : 0;
  // THE BROADCAST — the TOP of the organic funnel: share intents (from the beacon) feeding referred
  // signups. shareToReferred ties reach → conversion (how many shares it takes to land a recruit).
  const broadcast = { shares: 0, byKind: {} };
  const sh = (await pool.query("SELECT props FROM telemetry WHERE event='broadcast_share'")).rows;
  for (const r of sh) {
    const p = typeof r.props === 'string' ? JSON.parse(r.props) : (r.props || {});
    broadcast.shares++;
    const k = p.kind || 'dossier';
    broadcast.byKind[k] = (broadcast.byKind[k] || 0) + 1;
  }
  broadcast.sharers = await one("SELECT COUNT(DISTINCT account_id) n FROM telemetry WHERE event='broadcast_share'");
  broadcast.referredPerShare = broadcast.shares ? Math.round((referral.referred / broadcast.shares) * 100) / 100 : 0;
  return { characters, levels, progression, firstWeek: { ...firstWeek, capstone }, referral, broadcast };
}

// ── THE RECRUITERS (§7.13 status boards — organic-growth hall of fame) ──
// Pure STATUS (recruit COUNT — display-only, outside §10.4 and the sim-audited balance, the
// hitmen-board precedent). An agent recruiter never bumps `recruits` (maybeQualifyReferral rolls
// back on recruiterAcct.agent_flag), so agents never appear — a made man's word brought these in.
export async function recruiterLeaderboard(pool, limit = 20) {
  const rows = (await pool.query(
    `SELECT a.recruits, a.agent_flag, c.name, g.name AS gang, g.tag
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
       LEFT JOIN gang_members gm ON gm.character_id = c.id
       LEFT JOIN gangs g ON g.id = gm.gang_id
      WHERE a.recruits > 0 AND NOT a.agent_flag
      ORDER BY a.recruits DESC LIMIT $1`, [limit])).rows;
  return rows.map((r) => ({ name: r.name, gang: r.gang || null, tag: r.tag || null,
    recruits: Number(r.recruits), rank: recruitRankOf(Number(r.recruits)), agent: !!r.agent_flag }));
}

// Family recruitment board — families ranked by the total qualified recruits their CURRENT roster
// has brought in (a collective organic-growth standing; a member who leaves takes their count with
// them — the roster's recruiting power, not a stored family tally). Pure STATUS, §10.4-free.
// Aggregated in JS (the /v1/gangs two-flat-queries precedent — pg-mem is unreliable on GROUP BY).
export async function recruitingFamilyLeaderboard(pool, limit = 20) {
  const rows = (await pool.query(
    `SELECT gm.gang_id, g.name, g.tag, a.recruits
       FROM gang_members gm
       JOIN gangs g ON g.id = gm.gang_id
       JOIN characters c ON c.id = gm.character_id AND c.alive
       JOIN account_persistent a ON a.account_id = c.account_id`)).rows;
  const byGang = new Map();
  for (const r of rows) {
    const e = byGang.get(r.gang_id) || { name: r.name, tag: r.tag, members: 0, recruits: 0 };
    e.members += 1; e.recruits += Number(r.recruits || 0);
    byGang.set(r.gang_id, e);
  }
  return [...byGang.values()].filter((e) => e.recruits > 0)
    .sort((x, y) => y.recruits - x.recruits).slice(0, limit);
}

// THE AGENT LEADERBOARD — a SEPARATE machine hall of fame for agent_flag players. Agents are
// excluded from the human status axes (referral, assassin-rep) by design; this is their OWN board,
// so competition drives the agent economy WITHOUT touching the human game. Ranked by net worth
// (the Risk-to-Earn signal), with kills + $OMR extracted on-chain (the "earned a living" metric).
// Pure STATUS, read-only, §10.4-free.
export async function agentLeaderboard(pool, limit = 25) {
  const rows = (await pool.query(
    `SELECT c.name, c.respect, c.cash, c.bank, a.omr, a.kills, a.account_id
       FROM account_persistent a
       JOIN characters c ON c.account_id = a.account_id AND c.alive
      WHERE a.agent_flag
      ORDER BY (c.cash + c.bank) DESC LIMIT $1`, [limit])).rows;
  // $OMR extracted on-chain per account (withdraw:omr is a §10.4 burn — the true extraction signal).
  // Aggregate in JS: pg-mem lacks ABS(), and the withdraw debit is a negative ledger amount.
  // (red-team R7 DoS) scope to the returned top-25 accounts AND include currency='omr' so the query
  // uses ix_tx_currency_reason (currency,reason) — the reason-only predicate seq-scanned the whole
  // append-only ledger (the largest, forever-growing table) on every hit.
  const ext = {};
  const acctIds = rows.map((r) => r.account_id);
  if (acctIds.length) for (const r of (await pool.query(
    "SELECT account_id, amount FROM transactions WHERE currency='omr' AND reason='withdraw:omr' AND account_id = ANY($1)", [acctIds])).rows)
    ext[r.account_id] = (ext[r.account_id] || 0) + Math.abs(Number(r.amount));
  // audit: publish BANDS, not exact liquid — an exact net worth lets a hunter compute precise kill-EV
  // on a named agent (the convoy value-band precedent). Rank still uses the exact figure server-side.
  const cashBand = (n) => n < 1e4 ? '<$10k' : n < 1e5 ? '$10k–100k' : n < 1e6 ? '$100k–1M' : n < 1e7 ? '$1M–10M' : '$10M+';
  const omrBand = (n) => n < 100 ? '<100' : n < 1000 ? '100–1k' : n < 10000 ? '1k–10k' : '10k+';
  return rows.map((r) => ({ name: r.name, level: levelOf(Number(r.respect)),
    wealthBand: cashBand(Number(r.cash) + Number(r.bank)), omrBand: omrBand(Number(r.omr)),
    kills: Number(r.kills || 0), extracted: Math.round((ext[r.account_id] || 0) * 100) / 100 }));
}

// The guided First-Week board (read-only) — the client's "Start Here" funnel. Server-authoritative
// readiness (the same CHECKS claimOnboard enforces) so the client never re-derives game state:
// each task carries claimed (paid already), ready (the gate passes — claim now), and the social url.
// THE CHECKLIST THIS SERVER CAN ACTUALLY OFFER. A social task whose PROVIDER is not configured is
// dropped entirely — not listed-and-unclaimable. Offering a reward that always throws is worse than
// not offering it: the player reads it as a bug, and it made the all-done capstone unreachable,
// which is the state the live server shipped in (SOCIAL_VERIFY_MODE=live with no X token). A task ALREADY CLAIMED stays on the list whatever the config now says, so nobody's
// completed checklist silently shrinks if a token is later removed.
//
// ONE function, because the board and the PAYOUT must agree. They did not: the board filtered and
// the claim path computed its capstone over the unfiltered `ONBOARD_TASKS`, so on a server that
// could not verify X the checklist read "complete" and the capstone bonus never fired. A promise the UI makes
// and the ledger never keeps is worse than the unreachable capstone it replaced.
const offeredTasks = (onboard, ident) => ONBOARD_TASKS.filter((t) => !!onboard[t.id] || socialTaskAvailable(t.id, ident));

// THE SIGN-IN IDENTITY, which is NOT on `h.acct`. `h.acct` is the `account_persistent` row — prestige,
// $OMR, the onboard blob — and the provider lives on `accounts`. That mismatch was a real bug, not a
// tidiness point: `verifySocial` reads `acct.auth_provider` and `acct.auth_subject` off whatever it is
// handed, and handed `h.acct` both are `undefined`. So in live mode the follow check compared
// `undefined !== 'x'` and threw `verify_provider` at EVERY player, including genuine X accounts — and
// had it got past that it would have fetched `/2/users/undefined/following`. "Follow on X" was
// unclaimable by anyone, and nothing said so, because the suite only ever ran `trust` (which returns
// before either field is touched). `verifyPostUp` already reads the row directly; this does the same.
// One indexed PK lookup, only on the social paths — never on the hot per-request path.
async function signInIdentity(client, accountId) {
  return (await client.query('SELECT auth_provider, auth_subject FROM accounts WHERE id=$1', [accountId])).rows[0] || null;
}

export async function onboardBoard(ch, h, client) {
  const onboard = typeof h.acct.onboard === 'string' ? JSON.parse(h.acct.onboard || '{}') : (h.acct.onboard || {});
  const ident = client ? await signInIdentity(client, h.accountId) : null;
  const tasks = offeredTasks(onboard, ident)
    .map((t) => ({
      id: t.id, name: t.name, desc: t.desc, reward: t.reward, social: SOCIAL_LINKS[t.id] || t.social || null,
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
  // the board hides an unconfigured provider's task, but the route is public — say WHY rather than
  // letting verifySocial's generic `verify_unavailable` stand in for "not on this server"
  // the sign-in identity, read from `accounts` — see signInIdentity. Both the availability gate and
  // verifySocial itself need the real provider/subject; `h.acct` carries neither.
  const ident = await signInIdentity(client, h.accountId);
  if (!socialTaskAvailable(taskId, ident))
    throw new GameError('task_unavailable', "That one isn't part of the checklist on this server.");
  // one outbound X call per player per window — see throttleXCheck. Skipped entirely outside live
  // mode, where verifySocial answers without touching the network.
  if (t.social && (process.env.SOCIAL_VERIFY_MODE || 'off') === 'live')
    await throttleXCheck(client, h.accountId, 'follow');
  if (t.social) await verifySocial(taskId, ident);          // §4: verifies once
  else if (!CHECKS[taskId] || !CHECKS[taskId](ch, h)) throw new GameError('unfinished', 'Not done yet — the checklist pays on completion.');
  onboard[taskId] = true;
  h.acct.onboard = JSON.stringify(onboard);
  // the same list the board showed — see offeredTasks. `onboard` already carries THIS claim, so a
  // task just completed counts, and an unofferable task is not held against the player.
  const allDone = offeredTasks(onboard, ident).every((x) => onboard[x.id]);
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

// ── DAILY SOCIAL TASKS ("Spread the Word") — the organic-growth petty-cash faucet ──────────────
// The reward is gated behind SOCIAL_VERIFY_MODE!=='off' (the verify.js philosophy: never pay a
// social-task faucet with no verification configured), agent-flagged accounts are excluded, and
// each task pays ONCE per (account, day). Cash only — never $OMR (the v24 rule). Share URLs carry
// the player's living name as their referral code, so sharing feeds the §7.13 referral loop.
export function socialRewardsLive() {
  const mode = process.env.SOCIAL_VERIFY_MODE || 'off';
  if (mode === 'off') return false;
  // (red-team R20) 'trust' is an honor-system faucet — NEVER live in production (mirror verify.js's own
  // production guard, so the two readers of SOCIAL_VERIFY_MODE agree). A prod server that forgot to set
  // 'live' pays NOBODY the Spread-the-Word cash rather than paying the whole base on zero proof; the alpha
  // (non-production) keeps 'trust' live as documented.
  if (mode === 'trust' && process.env.NODE_ENV === 'production') return false;
  // …and in LIVE mode the check has to be PERFORMABLE. `live` with no X_BEARER_TOKEN reached
  // verifyPostUp and threw `verify_unavailable` on every claim — the faucet was advertised, players
  // registered shares against it, and nobody was ever paid. That is the state the production
  // blueprint shipped in (render.yaml sets SOCIAL_VERIFY_MODE=live and no token). Reporting the
  // faucet as OFF is honest and the client already handles it; the alternative was a route that
  // takes a registration it can never settle.
  if (mode === 'live' && !socialProviders().posts) return false;
  return true;
}

// THE 4-HOUR STAND (founder-directed anti-abuse): a share pays in TWO steps. Step one REGISTERS
// it (a social_claims row, paid=false, proof stored) — no cash. Step two, after SOCIAL_MATURE_MS
// (4h; env is the test knob), the claim PAYS — and in live verify mode the stored proof is
// re-checked against X first, so post-and-delete earns nothing. A registration unclaimed for
// PENDING_TTL (48h) lapses (which also retires any pre-maturity historical rows cleanly).
const socialMatureMs = () => Number(process.env.SOCIAL_MATURE_MS ?? 4 * 3600000);
const SOCIAL_PENDING_TTL = 48 * 3600000;

export async function socialBoard(pool, accountId, ch) {
  const day = dayOf();
  const rows = accountId
    ? (await pool.query(
        'SELECT task_id, day, posted_at, paid FROM social_claims WHERE account_id=$1 AND (day=$2 OR (NOT paid AND posted_at > $3))',
        [accountId, day, new Date(Date.now() - SOCIAL_PENDING_TTL)])).rows
    : [];
  const code = ch?.name || '';
  const mature = socialMatureMs();
  const tasks = SOCIAL_TASKS.TASKS.map((t) => {
    const pend = rows.filter((r) => r.task_id === t.id && !r.paid)
      .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))[0];
    const paidToday = rows.some((r) => r.task_id === t.id && Number(r.day) === day && r.paid);
    const age = pend ? Date.now() - new Date(pend.posted_at).getTime() : 0;
    const state = paidToday ? 'claimed' : pend ? (age >= mature ? 'ready' : 'pending') : 'todo';
    return { id: t.id, name: t.name, desc: t.desc, cash: SOCIAL_TASKS.CASH,
      claimed: paidToday, state,
      matureSeconds: state === 'pending' ? Math.ceil((mature - age) / 1000) : 0,
      share: socialShareUrl(t.kind, code) };
  });
  return { enabled: socialRewardsLive(), code, cash: SOCIAL_TASKS.CASH, allBonus: SOCIAL_TASKS.ALL_BONUS,
    matureHours: Math.round(mature / 360000) / 10,
    tasks, allDone: tasks.length > 0 && tasks.every((t) => t.claimed) };
}

export async function claimSocial(ch, taskId, proof, client, h) {
  if (!socialRewardsLive()) throw new GameError('social_off', "Word-of-mouth rewards aren't live on this server yet — but sharing still helps.");
  if (h.acct.agent_flag) throw new GameError('agent', "Agent accounts don't earn word-of-mouth rewards.");
  const t = SOCIAL_TASKS.TASKS.find((x) => x.id === taskId);
  if (!t) throw new GameError('bad_task', 'Not a word-of-mouth task.');
  const day = dayOf();
  const mature = socialMatureMs();
  // withCharacter row-locks the character (one living character per account), so an account's
  // claims serialize — the SELECT-then-INSERT/UPDATE can't double-pay; the PK is the backstop.
  // (1) a live registration in the window? pay it if matured, else report the clock
  const pend = (await client.query(
    'SELECT day, posted_at, proof FROM social_claims WHERE account_id=$1 AND task_id=$2 AND NOT paid AND posted_at > $3 ORDER BY posted_at DESC LIMIT 1',
    [h.accountId, taskId, new Date(Date.now() - SOCIAL_PENDING_TTL)])).rows[0];
  if (pend) {
    const age = Date.now() - new Date(pend.posted_at).getTime();
    if (age < mature) {
      return { ok: true, kind: 'social', task: taskId, pending: true,
        matureSeconds: Math.ceil((mature - age) / 1000) };
    }
    // live mode: the post must STILL be up AND (for an X-linked account) come from THEIR handle —
    // pass ctx so verifyPostUp's D2 author-binding activates on the real claim path (was dead code:
    // it only fired via a direct unit call). Trust mode short-circuits before touching ctx.
    if ((process.env.SOCIAL_VERIFY_MODE || 'off') === 'live')
      await throttleXCheck(client, h.accountId, 'post');    // the retry loop, not the happy path
    await verifyPostUp(pend.proof ?? proof, { client, accountId: h.accountId });
    await client.query('UPDATE social_claims SET paid=true WHERE account_id=$1 AND day=$2 AND task_id=$3',
      [h.accountId, pend.day, taskId]);
    const paidIds = (await client.query(
      'SELECT task_id FROM social_claims WHERE account_id=$1 AND day=$2 AND paid', [h.accountId, pend.day])).rows.map((r) => r.task_id);
    const allDone = SOCIAL_TASKS.TASKS.every((x) => paidIds.includes(x.id));
    const cash = SOCIAL_TASKS.CASH + (allDone ? SOCIAL_TASKS.ALL_BONUS : 0); // the all-done bonus folds into the last payout (the onboard-capstone precedent)
    ch.cash = Number(ch.cash) + cash;
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: cash, reason: `social:${taskId}` });
    await h.track(client, h.accountId, 'social_task', { task: taskId, allDone, proof: cleanText(pend.proof ?? proof).slice(0, 300) });
    return { ok: true, kind: 'social', task: taskId, cash, allDone };
  }
  // (2) no live registration → register today's share (once per task per day)
  const dup = await client.query('SELECT 1 FROM social_claims WHERE account_id=$1 AND day=$2 AND task_id=$3', [h.accountId, day, taskId]);
  if (dup.rowCount) throw new GameError('claimed', 'Already spread that word today — come back tomorrow.');
  // (red-team R7 HIGH) cleanText the proof — it's player free-text surfaced verbatim on the mod /admin
  // activity feed (innerHTML), where the mod key lives in sessionStorage → unescaped markup was a
  // mod-side stored XSS → root escalation. Strip < > " ` at the source like every other display field.
  const cleanProof = cleanText(proof).slice(0, 300);
  await client.query('INSERT INTO social_claims (account_id, day, task_id, paid, proof) VALUES ($1,$2,$3,false,$4)',
    [h.accountId, day, taskId, cleanProof || null]);
  await h.track(client, h.accountId, 'social_post', { task: taskId, proof: cleanProof });
  return { ok: true, kind: 'social', task: taskId, pending: true, registered: true,
    matureSeconds: Math.ceil(mature / 1000) };
}

// worker housekeeping (L5): drop spent social_claims rows so the table doesn't grow forever. The
// board/claim queries already FILTER on today / the 48h pending window, so this only trims what's
// no longer readable: PAID rows older than a week and UNPAID registrations past the pending TTL.
export async function sweepSocialClaims(pool) {
  const paidCut = new Date(Date.now() - 7 * 24 * 3600000);
  const pendCut = new Date(Date.now() - SOCIAL_PENDING_TTL);
  const r = await pool.query(
    'DELETE FROM social_claims WHERE (paid AND posted_at < $1) OR (NOT paid AND posted_at < $2)',
    [paidCut, pendCut]);
  return { swept: r.rowCount || 0 };
}

// WALLET LINK is SIWE now — see chain.js walletChallenge/walletVerify. The legacy
// base58/no-proof linkWallet was RETIRED in the EVM migration (it satisfied the ob_wallet
// reward without proving key control, and wrote a wrong-chain address the withdraw path
// can't use). `ob_wallet` (CHECKS above) gates on wallet_address, which now only a verified
// 0x SIWE link sets. Nothing exported here — POST /v1/wallet returns a redirect to SIWE.
