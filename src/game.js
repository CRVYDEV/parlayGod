// M1 core + shared transaction machinery. Every formula cites spec §7 / prototype v24.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { CRIMES, DISTRICTS, DRUGS, RECRUIT_MILESTONES, CONSTANTS,
         levelOf, rankIdxOf, cityEventOf, dayOf,
         assetEnergyCap, effStat, assetsValue, cargoCapacity, tradeRankIdx,
         gangLevelOf, roleMultOf, weekOf, familyTaskOf, M3, M4,
         gunsValue, fleetValue, racketsValue, hitmanRankOf, sealOf, SKILLS, skillOf, UNDERWORLD, leadTaskOf, ONBOARD_TASKS,
         crewWageOwed, crewCold, LAW, rapStageOf, bribeCostOf, retainerActive, witproActive,
         cityHourOf, cityLawEventOf, tickerPriceOf, estateTierOf, foundationOf, campaignOf, honorTierOf,
         SOLDIERS, soldierFxOf } from './rules.js';
import { accrue } from './accrual.js';
import { logCollect } from './collection.js';
import { businessesOf } from './business.js';
import { speakeasyOwnedOf } from './speakeasy.js';
import { fightersOf } from './boxing.js';

const uid = () => crypto.randomUUID();
export class GameError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// (red-team R6 — stored-XSS fix) Player-controlled display strings (character/gang names, custom
// titles, contract reasons) render into the console's innerHTML, and the bearer token lives in the
// browser's localStorage — so unescaped markup here is STORED XSS → cross-user token theft → account
// takeover. Strip the HTML-injection set (< > " ` and control chars) at the DATA LAYER so no malicious
// markup ever enters the DB for any rendered field; the client also escapes on output (defense-in-depth).
// `'` and `&` are kept (legitimate in names — "D'Angelo", "Smith & Sons" — and the client escapes them).
export const cleanText = (s) => String(s == null ? '' : s).replace(/[<>"\x60\x00-\x1F\x7F]/g, '');

// Postgres resolves a rare lock-order cycle (e.g. a crew execute racing a member's own PvP
// action) by aborting one transaction with SQLSTATE 40P01. Nothing committed — surface it as a
// clean retryable error instead of a raw 500. pg-mem never deadlocks, so tests can't hit this.
// 23505 (unique_violation) belongs here too: a materialize-on-first-touch race (two concurrent
// FIRST bids on a fresh auction lot both lock nothing under FOR UPDATE, both INSERT, and the loser
// 23505s) — the losing txn rolled back cleanly (no §10.4 impact), so retrying finds the row present
// and proceeds through the raise path. Genuine business duplicates SELECT-check first and throw a
// specific error before the constraint, so a raw 23505 reaching a wrapper catch is a race.
export const deadlockToRetry = (e) =>
  (e?.code === '40P01' || e?.code === '23505')
    ? new GameError('contention', 'The streets got crowded for a second — try that again.') : e;

// In-process pub/sub feeding the websocket gateway (§5.6): 'me:{characterId}'
// for notifications, 'streets' for the public kill/bust feed, 'gang:{id}' updates.
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Write a notification row AND push it live if the player is connected.
// Delivery over the socket doesn't mark it delivered — GET /notifications does.
export async function notify(client, characterId, type, payload = {}) {
  await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
    [uid(), characterId, type, JSON.stringify(payload)]);
  bus.emit(`me:${characterId}`, { type, payload });
}

// §5.5 weekly family contracts — the same actions that call bumpFamilyTask in v24
// (tribute $, crime, melt rounds, gta, jump, deal, recruit) progress the gang's task.
// Goal scales with roster size; completion pays +15,000 standing and +5 $OMR to the
// family reserve IF the event fund covers it. Caller must hold the character lock;
// the gang row is updated atomically inside the same transaction.
export async function bumpFamilyTask(client, h, kind, amount) {
  const gangId = h.owned?.gangId;
  if (!gangId || !(amount > 0)) return;
  const wk = weekOf();
  const task = familyTaskOf(wk);
  if (task.key !== kind) return;
  const g = (await client.query('SELECT * FROM gangs WHERE id=$1 FOR UPDATE', [gangId])).rows[0];
  if (!g) return;
  let prog = Number(g.weekly_progress), done = g.weekly_done;
  if (g.weekly_week !== wk) { prog = 0; done = false; }             // new week, new contract
  if (done) return;
  const members = Number((await client.query('SELECT COUNT(*) n FROM gang_members WHERE gang_id=$1', [gangId])).rows[0].n);
  const effGoal = task.goal * Math.max(1, Math.ceil(members / 4));
  prog += amount;
  let completed = false, omrPaid = 0;
  if (prog >= effGoal) {
    completed = true; done = true;
    const fund = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    if (Number(fund.fund) >= M3.WEEKLY_OMR) {
      omrPaid = M3.WEEKLY_OMR;
      await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [omrPaid]);
    }
    await client.query(
      'UPDATE gangs SET weekly_week=$2, weekly_progress=$3, weekly_done=true, lifetime_tribute = lifetime_tribute + $4, season_tribute = season_tribute + $4, omr_reserve = omr_reserve + $5 WHERE id=$1',
      [gangId, wk, prog, M3.WEEKLY_STANDING, omrPaid]);
    // ground rule #4: ledger the fund→family $OMR transfer for the audit trail, at parity with
    // daily:all / referral (a recognized transfer reason, not a mint — both buckets are tracked).
    if (omrPaid > 0) await h.ledger(client, { currency: 'omr', amount: omrPaid, reason: 'family:weekly', counterparty: gangId });
    bus.emit(`gang:${gangId}`, { type: 'weekly_done', task: task.id, omr: omrPaid });
  } else {
    await client.query('UPDATE gangs SET weekly_week=$2, weekly_progress=$3, weekly_done=false WHERE id=$1', [gangId, wk, prog]);
  }
  return { completed, prog, effGoal, omrPaid };
}

export async function ledger(client, { characterId = null, accountId = null, currency, amount, reason, counterparty = null }) {
  await client.query(
    'INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [uid(), characterId, accountId, currency, amount, reason, counterparty]);
}
export async function rngLog(client, characterId, action, roll, outcome) {
  await client.query('INSERT INTO rng_audit (id, character_id, action, roll, outcome) VALUES ($1,$2,$3,$4,$5)',
    [uid(), characterId, action, roll, outcome]);
}

const idList = (rows, col) => rows.map((r) => r[col]);
const cargoMap = (rows) => Object.fromEntries(rows.map((r) => [r.good_id, Number(r.qty)]));
const itemMap = (rows) => Object.fromEntries(rows.map((r) => [r.item_id, Number(r.qty)]));

// Everything a character owns or belongs to, loaded inside the caller's txn.
export async function loadOwned(client, ch) {
  const [rk, as, cars, cargo, items, gear, guns, gm, mk, st, batch, sk, npc, grudge, pf, est] = await Promise.all([
    client.query('SELECT racket_id FROM character_rackets WHERE character_id=$1', [ch.id]),
    client.query('SELECT asset_id FROM character_assets WHERE character_id=$1', [ch.id]),
    client.query('SELECT * FROM cars WHERE character_id=$1 ORDER BY created_at', [ch.id]),
    client.query('SELECT good_id, qty FROM character_cargo WHERE character_id=$1 AND qty>0', [ch.id]),
    client.query('SELECT item_id, qty FROM character_items WHERE character_id=$1 AND qty>0', [ch.id]),
    client.query('SELECT gear_id FROM account_gear WHERE account_id=$1', [ch.account_id]),
    client.query('SELECT gun_id FROM character_guns WHERE character_id=$1', [ch.id]),
    client.query('SELECT gang_id, role, joined_at FROM gang_members WHERE character_id=$1', [ch.id]),
    client.query('SELECT drug_id, qty FROM makings WHERE character_id=$1 AND qty>0', [ch.id]),
    client.query('SELECT drug_id, qty, quality FROM stash WHERE character_id=$1', [ch.id]),
    client.query('SELECT * FROM batches WHERE character_id=$1', [ch.id]),
    client.query('SELECT skill_id FROM character_skills WHERE character_id=$1', [ch.id]),
    client.query('SELECT npc_id, standing, touched_at FROM npc_standing WHERE character_id=$1', [ch.id]),
    client.query('SELECT npc_id, count, since FROM npc_grudges WHERE character_id=$1 AND count > 0', [ch.id]),
    // R1 — the Portfolio: account-level (survives death), so keyed on account_id not character_id
    client.query('SELECT ticker, shares, cost_omr FROM portfolios WHERE account_id=$1 AND shares>0', [ch.account_id]),
    // THE ESTATE — account-level too (survives death; the heir inherits the compound)
    client.query('SELECT name, tier, spent_omr FROM estates WHERE account_id=$1', [ch.account_id]),
  ]);
  const gangId = gm.rows[0]?.gang_id || null;
  let gang = null, held = [];
  if (gangId) {
    gang = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0] || null;
    held = idList((await client.query('SELECT id FROM districts WHERE holder_gang=$1', [gangId])).rows, 'id');
  }
  const businesses = await businessesOf(client, ch.id); // late-game personal fronts (usually empty)
  const speakeasy = await speakeasyOwnedOf(client, ch.id); // the district's club, if this man runs one
  const fighters = await fightersOf(client, ch.id); // the fight-circuit STABLE, if this man manages one
  // active vendettas this bloodline holds — joined to the target bloodline's CURRENT street
  const vendettas = (await client.query(
    `SELECT v.sworn, v.expires_at, c.name AS target_name, c.id AS target_id
       FROM vendettas v LEFT JOIN characters c ON c.account_id = v.target_account AND c.alive
      WHERE v.avenger_account=$1 AND v.expires_at > now()`, [ch.account_id])).rows;
  return {
    businesses,
    speakeasy,
    fighters,
    vendettas,
    rackets: idList(rk.rows, 'racket_id'), assets: idList(as.rows, 'asset_id'),
    cars: cars.rows, cargo: cargoMap(cargo.rows), items: itemMap(items.rows),
    gear: idList(gear.rows, 'gear_id'), guns: idList(guns.rows, 'gun_id'),
    gangId, gangRole: gm.rows[0]?.role || null, gangJoinedAt: gm.rows[0]?.joined_at || null, gang, held,
    makings: Object.fromEntries(mk.rows.map((r) => [r.drug_id, Number(r.qty)])),
    stash: st.rows.map((r) => ({ drug_id: r.drug_id, qty: Number(r.qty), quality: Number(r.quality) })),
    batch: batch.rows[0] || null,
    skills: new Set(sk.rows.map((r) => r.skill_id)), // the build — dies with the street
    // who you know — dies with the street. Idle friendships COOL (Underworld step two): the
    // EFFECTIVE standing is what everyone reads; the stored row catches up on the next bump.
    npc: Object.fromEntries(npc.rows.map((r) => [r.npc_id, decayedStanding(Number(r.standing), r.touched_at)])),
    // step four: open grudges cap the tier; step five: time heals them — the EFFECTIVE count
    // is what everything reads, the stored row catches up on the next write
    grudges: Object.fromEntries(grudge.rows
      .map((r) => [r.npc_id, decayedGrudges(Number(r.count), r.since)])
      .filter(([, c]) => c > 0)),
    // R1 — the Portfolio: account-level legit holdings (survive death; the price values a status
    // collectible, so nothing here touches §10.4). Array of { ticker, shares, cost_omr } rows.
    portfolio: pf.rows.map((r) => ({ ticker: r.ticker, shares: Number(r.shares), cost_omr: Number(r.cost_omr) })),
    estate: est.rows[0] || null, // account-level compound (survives death) — a summary; the board is the full view
  };
}

// Lazy grudge healing (step five, §7.1 pattern): one grudge is forgiven per GRUDGE_DECAY_DAYS
// since the last write (a fresh offense — or a penance — restarts the clock).
function decayedGrudges(count, since) {
  // clamp days at 0: `since` is stamped with DB now() but read against the JS clock — if the app
  // clock lags the DB even a second, a fresh grudge would read `floor(negative)=-1` = count+1, a
  // PHANTOM grudge that caps the tier and inflates a penance charge (audit M1).
  const days = Math.max(0, (Date.now() - new Date(since).getTime()) / 86400000);
  return Math.max(0, count - Math.floor(days / UNDERWORLD.STEP5.GRUDGE_DECAY_DAYS));
}

// Lazy standing decay (§7.1 pattern — no cron): after DECAY_GRACE_DAYS without business, a
// standing cools DECAY_PER_DAY toward DECAY_FLOOR (tier 1 — old friends stay friends; the
// inner circle needs upkeep). Below the floor nothing decays. Sign-off levers.
function decayedStanding(s, touchedAt) {
  const { DECAY_GRACE_DAYS, DECAY_PER_DAY, DECAY_FLOOR } = UNDERWORLD.STEP2;
  if (s <= DECAY_FLOOR) return s;
  const days = (Date.now() - new Date(touchedAt).getTime()) / 86400000;
  if (days <= DECAY_GRACE_DAYS) return s;
  return Math.max(DECAY_FLOOR, s - Math.floor((days - DECAY_GRACE_DAYS) * DECAY_PER_DAY));
}

// Underworld touchpoint helpers — perks are NEW single-touchpoint modifiers (sign-off levers).
// Step four: an OPEN GRUDGE caps the tier a fixture will serve you at (they still do business
// — they just won't do favors) until it's squared by penance. Every perk site inherits this.
export const npcTier = (h, npcId) => {
  const s = Number(h?.owned?.npc?.[npcId] || 0);
  const t = UNDERWORLD.THRESHOLDS.filter((x) => s >= x).length; // 0..3
  return (h?.owned?.grudges?.[npcId] > 0) ? Math.min(t, UNDERWORLD.STEP4.GRUDGE_TIER_CAP) : t;
};
export const npcMult = (h, npcId, tier, mult) => (npcTier(h, npcId) >= tier ? mult : 1);

// Your best relationship (Underworld step two): the highest EFFECTIVE standing at or above
// LEAD_MIN, first in cast order on ties. Null while everyone is still a stranger.
export function bestNpc(h) {
  let best = null, bestS = UNDERWORLD.STEP2.LEAD_MIN - 1;
  for (const n of UNDERWORLD.NPCS) {
    const s = Number(h?.owned?.npc?.[n.id] || 0);
    if (s > bestS) { best = n.id; bestS = s; }
  }
  return best;
}

// Standing bumps are earned actor-side at the loop's touchpoints (design §3). Standing is a
// pure status axis — no §10.4 surface — so the write is a plain upsert under the actor's lock.
// Lives here (not underworld.js) because game.js's own heal() bumps the Doc.
// Step two: the write is ABSOLUTE from the effective (decayed) value, so cooling materializes
// on the next bump; every bump re-stamps touched_at (any contact, friendly or not, is contact).
// The daily LEAD rides in here too — step three made it a rotating TASK: the bonus pays only
// when today's drawn task for your BEST fixture matches the `action` this bump came from.
// Gifts (business:false) and rivalry/grudge losses (pts<0) never trigger it.
export async function bumpStanding(client, h, ch, npcId, pts, { business = true, action = null } = {}) {
  const cur = Number(h.owned.npc[npcId] || 0);
  const day = dayOf();
  // the intent to do positive business — drives the daily cap AND the once-daily bonuses below.
  // Captured BEFORE the cap clips `pts`, so a capped-out bump still lets you claim the lead/errand.
  const origPositive = business && pts > 0;
  // audit #3: a per-fixture DAILY CAP on the RAW bump — the spammable part. The lead/streak and
  // errand bonuses below ride on top, EXEMPT (they're already once-a-day bounded), so a scripter
  // hits the cap while an engaged player still collects their engagement rewards.
  if (origPositive) {
    const g = (await client.query('SELECT gained FROM npc_gain WHERE character_id=$1 AND npc_id=$2 AND day=$3', [ch.id, npcId, day])).rows[0];
    const gained = g ? Number(g.gained) : 0;
    const capped = Math.min(pts, Math.max(0, UNDERWORLD.STANDING_DAILY_CAP - gained));
    if (capped > 0) { // absolute write (pg-mem INT-arithmetic quirk)
      if (g) await client.query('UPDATE npc_gain SET gained=$4 WHERE character_id=$1 AND npc_id=$2 AND day=$3', [ch.id, npcId, day, gained + capped]);
      else await client.query('INSERT INTO npc_gain (character_id, npc_id, day, gained) VALUES ($1,$2,$3,$4)', [ch.id, npcId, day, capped]);
    }
    pts = capped; // the raw bump is now the daily allowance (may be 0)
  }
  let lead = false, streak = 0, bonus = 0;
  if (origPositive && action && action === leadTaskOf(day, npcId)) {
    if (bestNpc(h) === npcId) {
      const claimed = await client.query('SELECT 1 FROM npc_leads WHERE character_id=$1 AND day=$2', [ch.id, day]);
      if (!claimed.rowCount) {
        // step four: STREAKS — consecutive claimed days sweeten the bonus (+1/day, capped)
        const y = (await client.query('SELECT streak FROM npc_leads WHERE character_id=$1 AND day=$2', [ch.id, day - 1])).rows[0];
        streak = (y ? Number(y.streak) : 0) + 1;
        bonus = UNDERWORLD.STEP2.LEAD_BONUS + Math.min(streak - 1, UNDERWORLD.STEP4.STREAK_BONUS_CAP);
        await client.query('INSERT INTO npc_leads (character_id, day, npc_id, streak) VALUES ($1,$2,$3,$4)', [ch.id, day, npcId, streak]);
        pts += bonus;
        lead = true;
      }
    }
    // step five: the ERRAND CHAIN — the fixture's drawn task advances an active chain with
    // THAT fixture (best or not), one step per day; the last step pays the chain bonus.
    const er = (await client.query('SELECT * FROM npc_errands WHERE character_id=$1 AND npc_id=$2', [ch.id, npcId])).rows[0];
    if (er && Number(er.last_day ?? -1) < day) {
      const step = Number(er.step) + 1;
      if (step >= UNDERWORLD.STEP5.CHAIN_STEPS) {
        await client.query('DELETE FROM npc_errands WHERE character_id=$1', [ch.id]);
        pts += UNDERWORLD.STEP5.CHAIN_BONUS;
        await notify(client, ch.id, 'errand_done', { npc: npcId, bonus: UNDERWORLD.STEP5.CHAIN_BONUS });
        bus.emit('streets', { type: 'errand_done', who: ch.name, npc: npcId }); // the town hears who did right by whom
      } else {
        await client.query('UPDATE npc_errands SET step=$2, last_day=$3 WHERE character_id=$1', [ch.id, step, day]);
        await notify(client, ch.id, 'errand_step', { npc: npcId, step, of: UNDERWORLD.STEP5.CHAIN_STEPS });
      }
    }
  }
  const next = Math.max(0, Math.min(100, cur + pts));
  if (next !== cur || lead) {
    const upd = await client.query('UPDATE npc_standing SET standing=$3, touched_at=now() WHERE character_id=$1 AND npc_id=$2',
      [ch.id, npcId, next]);
    if (!upd.rowCount) {
      await client.query('INSERT INTO npc_standing (character_id, npc_id, standing) VALUES ($1,$2,$3)',
        [ch.id, npcId, next]);
    }
    h.owned.npc[npcId] = next;
    if (next >= 25) await logCollect(client, ch.account_id, 'fixtures', npcId); // THE COLLECTION — befriended (tier 1)
  } else if (origPositive) {
    // a positive business contact that didn't move standing (hit the 100 cap, or capped-out on the
    // daily allowance) still counts as CONTACT — re-stamp the decay clock so a daily-active maxed
    // player stays maxed (audit L1: else the clock ran from the day they capped and dipped after
    // the grace despite daily play).
    await client.query('UPDATE npc_standing SET touched_at=now() WHERE character_id=$1 AND npc_id=$2', [ch.id, npcId]);
  }
  if (lead) await notify(client, ch.id, 'lead_done', { npc: npcId, bonus, streak });
  // FIVE PILLARS #4 — the CAMPAIGN chains ride the same action stream (the errand precedent,
  // inline here to keep game.js import-acyclic). Any fixer's tagged action can advance any
  // active chain whose current step wants it; choice steps wait for the player.
  if (action) await advanceCampaignsInline(client, ch, action);
}

async function advanceCampaignsInline(client, ch, action) {
  const rows = (await client.query(
    'SELECT * FROM campaign_progress WHERE character_id=$1 AND NOT completed', [ch.id])).rows;
  for (const p of rows) {
    const c = campaignOf(p.campaign_id);
    const step = c?.steps[Number(p.step)];
    if (!step || !step.action || step.action !== action) continue;
    const done = Number(p.done) + 1;
    if (done >= (step.n || 1)) {
      const nextStep = Number(p.step) + 1;
      const finished = nextStep >= c.steps.length;
      await client.query(
        'UPDATE campaign_progress SET step=$3, done=0, completed=$4 WHERE character_id=$1 AND campaign_id=$2',
        [ch.id, p.campaign_id, nextStep, finished]);
      await notify(client, ch.id, finished ? 'campaign_done' : 'campaign_step',
        { campaign: c.name, step: nextStep, of: c.steps.length });
    } else {
      await client.query('UPDATE campaign_progress SET done=$3 WHERE character_id=$1 AND campaign_id=$2',
        [ch.id, p.campaign_id, done]);
    }
  }
}

// ═══ SOLDIERS (XCOM) — the assist touchpoints. Live here (not soldiers.js) to keep the import
// graph acyclic (the advanceCampaignsInline pattern): soldiers.js imports game.js one-way; the
// three assist sites (doCrime below, growth.js heist, world.js raidNpc) read these exports. ═══
// the actor's assigned, FIT second (alive, on the job, not laid up) — a point-in-time read under
// the caller's held char lock (soldier rows belong to the actor, so no extra locking)
export async function assignedSoldier(client, chId) {
  return (await client.query(
    `SELECT * FROM soldiers WHERE character_id=$1 AND alive AND on_job
       AND (injured_until IS NULL OR injured_until <= now()) LIMIT 1`, [chId])).rows[0] || null;
}
// resolve an assisted job. Success: +xp (the soldier learns). Risky failure: the soldier is
// INJURED (lookout's roll can dodge it) and rolls DEATH (lucky halves it) — dead is DEAD, the
// row stays as the memorial. Absolute writes (the pg-mem INT discipline); rng-audited.
export async function soldierResult(client, h, ch, s, { success, cause = 'a job gone wrong' }) {
  if (!s) return null;
  if (success) {
    await client.query('UPDATE soldiers SET xp=$2 WHERE id=$1', [s.id, Number(s.xp) + SOLDIERS.XP_PER_JOB]);
    return { name: s.name, xp: SOLDIERS.XP_PER_JOB };
  }
  const roll = Math.random();
  const deathP = (process.env.SOLDIER_DEATH_P != null ? Number(process.env.SOLDIER_DEATH_P) : SOLDIERS.DEATH_P)
    * (s.trait === 'lucky' ? Math.max(0, 1 - soldierFxOf(s)) : 1);
  if (roll < deathP) {
    await client.query(`UPDATE soldiers SET alive=false, on_job=false, died_at=now(), cause=$2 WHERE id=$1`, [s.id, cause]);
    await h.rngLog(client, ch.id, 'soldier:risk', roll, `${s.name} KILLED — ${cause} (P ${deathP.toFixed(3)})`);
    await notify(client, ch.id, 'soldier_down', { name: s.name, cause });
    return { name: s.name, died: true, cause };
  }
  const injuryP = s.trait === 'lookout' ? Math.max(0, 1 - soldierFxOf(s)) : 1;
  const injured = Math.random() < injuryP;
  if (injured) await client.query(
    'UPDATE soldiers SET injured_until=$2 WHERE id=$1', [s.id, new Date(Date.now() + SOLDIERS.INJURY_MS)]);
  await h.rngLog(client, ch.id, 'soldier:risk', roll, `${s.name} ${injured ? 'hurt' : 'walked away clean'} — ${cause}`);
  return { name: s.name, injured };
}

// Skill touchpoint helpers — every effect is a NEW single-touchpoint modifier (sign-off lever).
export const hasSkill = (h, id) => !!h?.owned?.skills?.has(id);
export const skillMult = (h, id, mult) => (hasSkill(h, id) ? mult : 1);
// trunk capacity incl. the Pack Mule bonus — use this, not cargoCapacity(), on player paths
export const trunkCap = (h) => cargoCapacity(h.owned.assets)
  + (hasSkill(h, 'pack_mule') ? SKILLS.FX.TRUNK_BONUS : 0)
  + (hasSkill(h, 'road_boss') ? SKILLS.FX.ROAD_BOSS_TRUNK : 0); // step-two capstone: even bigger haul

async function accrueAndLedger(client, ch, acct, owned) {
  accrue(ch, acct, { rackets: owned.rackets, assets: owned.assets, held: owned.held, stash: owned.stash,
    foundationTier: owned.gang?.foundation || 0 }); // THE FOUNDATION step two: the family charity speeds the exposure bleed
  // §7.1 accrued racket/front income is a faucet — record it so the ledger balances
  if (ch._accruedIncome > 0)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._accruedIncome, reason: 'racket:income' });
  // ledger the EXACT interest applied (any positive delta) — gating at ≥ $0.01 left
  // sub-cent interest on the bank balance with no matching row, a slow §10.4 drift
  if (ch._bankInterest > 0)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._bankInterest, reason: 'bank:interest' });
  // §7.1 crew sales are a faucet too; the raid is logged, notified, and telemetered
  if (ch._crewSale?.proceeds > 0)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._crewSale.proceeds, reason: 'crew:sales' });
  if (ch._raid) {
    await rngLog(client, ch.id, 'raid', ch._raid.roll, `raided (P ${ch._raid.pWindow.toFixed(4)}, kept ${ch._raid.keepPct}%)`);
    await notify(client, ch.id, 'raid', { lost: ch._raid.lost, keptPct: ch._raid.keepPct });
    await track(client, ch.account_id, 'raid', { lost: ch._raid.lost });
  }
  // THE LAW — an indictment was filed this accrual (exposure crossed LAW.INDICT_AT). No value
  // moves at indictment (§10.4-free); the mark is warned so they can lawyer/plea/flip/liquidate
  // before the grace window runs out and the worker (or a demanded trial) resolves the bust.
  if (ch._indicted) {
    await notify(client, ch.id, 'indicted', { graceHours: Math.round(LAW.INDICT_GRACE_MS / 3600000) });
    await track(client, ch.account_id, 'indicted', { exposure: Math.round(Number(ch.heat_exposure)) });
    delete ch._indicted;
  }
}

// Persist the in-memory stash/makings maps back to their tables (kitchen state
// is mutated by accrual and actions alike, so one uniform write path).
async function persistKitchen(client, ch, owned) {
  await client.query('DELETE FROM stash WHERE character_id=$1', [ch.id]);
  for (const s of owned.stash)
    if (Number(s.qty) > 0)
      await client.query('INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ($1,$2,$3,$4)', [ch.id, s.drug_id, s.qty, s.quality]);
  await client.query('DELETE FROM makings WHERE character_id=$1', [ch.id]);
  for (const [drugId, qty] of Object.entries(owned.makings))
    if (qty > 0)
      await client.query('INSERT INTO makings (character_id, drug_id, qty) VALUES ($1,$2,$3)', [ch.id, drugId, qty]);
}

// §12 telemetry — one row per event, queried by the mod dashboards.
export async function track(client, accountId, event, props = {}) {
  await client.query('INSERT INTO telemetry (id, account_id, event, props) VALUES ($1,$2,$3,$4)',
    [uid(), accountId, event, JSON.stringify(props)]);
}

// §7.4 daily-contract counters (drawn jobs claim against these in growth.js)
export async function bumpDaily(client, characterId, kind) {
  const day = dayOf();
  const row = (await client.query('SELECT * FROM daily_progress WHERE character_id=$1 AND day=$2 FOR UPDATE', [characterId, day])).rows[0];
  const counters = row ? JSON.parse(row.counters) : {};
  counters[kind] = (counters[kind] || 0) + 1;
  if (row) await client.query('UPDATE daily_progress SET counters=$3 WHERE character_id=$1 AND day=$2', [characterId, day, JSON.stringify(counters)]);
  else await client.query('INSERT INTO daily_progress (character_id, day, counters) VALUES ($1,$2,$3)', [characterId, day, JSON.stringify(counters)]);
}

// Load-and-lock the living character + its account, accrue both, hand to fn, persist.
// One DB transaction per action (spec §10.1). Child tables are loaded for the action
// to read; the action mutates them via `client` and updates h.owned so the view is fresh.
export async function withCharacter(pool, accountId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive FOR UPDATE', [accountId]);
    if (!r.rows.length) throw new GameError('no_character', 'Create a character first.');
    const ch = r.rows[0];
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id = $1 FOR UPDATE', [accountId])).rows[0];
    const owned = await loadOwned(client, ch);
    await accrueAndLedger(client, ch, acct, owned);

    const h = { ledger, rngLog, notify, track, bumpDaily, events: [], acct, owned, accountId };
    const result = await fn(ch, client, h);

    if (ch.alive !== false) await persistCharacter(client, ch); // a killed row is finalized by the estate
    await persistKitchen(client, ch, owned);
    await persistAccount(client, accountId, acct);
    await client.query('COMMIT');
    // §7.13 — qualification is re-checked after any action by a referred, unpaid account; it runs
    // in its OWN transaction so its two-party locks stay sorted. It is a POST-COMMIT side effect,
    // so it must NEVER fail the request (audit M1): if it threw here — a 40P01 on street_tax under
    // load, any DB error — the outer catch would surface a non-2xx AFTER the action already
    // committed, and the idempotency hook would release the key → a retry re-executes the action
    // (double-spend). It's idempotent (ref_paid-guarded, re-checks every gate), so swallow failures.
    if (acct.referred_by && !acct.ref_paid && !acct.agent_flag) {
      try { await maybeSparkReferral(pool, accountId); }
      catch (e) { console.error('referral spark (post-commit, non-fatal)', e?.code || e); }
      try { await maybeQualifyReferral(pool, accountId); }
      catch (e) { console.error('referral qualification (post-commit, non-fatal)', e?.code || e); }
      // tier-2 "family tree": if this action just qualified a referred recruit, pay their grandrecruiter
      try { await maybeGrandReferral(pool, accountId); }
      catch (e) { console.error('referral tier-2 (post-commit, non-fatal)', e?.code || e); }
    }
    // (red-team R4 idempotency finding-2) the action has COMMITTED — a post-commit RENDER failure
    // (view()/coachOf on a corrupt column) must NOT surface a non-2xx, or the idempotency hook releases
    // the key → a retry re-executes the committed action (double-spend). Degrade the snapshot, never the
    // success — same discipline as the referral post-commit hooks above.
    let character = null;
    try { character = view(ch, acct, owned); } catch (e) { console.error('view render (post-commit, non-fatal)', e?.code || e); }
    return { character, events: h.events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

async function persistAccount(client, accountId, a) {
  await client.query(
    `UPDATE account_persistent SET omr=$2, staked=$3, rewards=$4, prestige=$5, deaths=$6,
      recruits=$7, checkins_lifetime=$8, ref_paid=$9, onboard=$10, wallet_address=$11,
      minted=$12, mint_credits=$13, respawn_tokens=$14, hitman_rep=$15, kills=$16,
      unbonding=$17, unbond_at=$18, rat=$19 WHERE account_id=$1`,
    [accountId, a.omr, a.staked, a.rewards, a.prestige, a.deaths,
     a.recruits, a.checkins_lifetime, a.ref_paid, a.onboard, a.wallet_address,
     a.minted ?? false, a.mint_credits ?? 0, a.respawn_tokens ?? 0, a.hitman_rep ?? 0, a.kills ?? 0,
     a.unbonding ?? 0, a.unbond_at ?? null, a.rat ?? false]);
}

// Two-party actions (§10.1): lock BOTH character rows in stable id order, then both
// account rows in stable id order — every multi-lock txn follows characters-then-
// accounts so lock acquisition can never cycle. Both sides accrue (§7.1: a player is
// "touched" when targeted). fn gets (ch, victim, client, h) with h.victimOwned loaded.
export async function withTwoCharacters(pool, accountId, targetCharacterId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mine = await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [accountId]);
    if (!mine.rows.length) throw new GameError('no_character', 'Create a character first.');
    const myId = mine.rows[0].id;
    if (myId === targetCharacterId) throw new GameError('self', 'Not on yourself.');

    const lockChar = async (id) =>
      (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    const [firstId, secondId] = [myId, targetCharacterId].sort();
    const first = await lockChar(firstId), second = await lockChar(secondId);
    const ch = firstId === myId ? first : second;
    const victim = firstId === myId ? second : first;
    if (!ch) throw new GameError('no_character', 'Create a character first.');
    if (!victim) throw new GameError('no_target', "They're gone — nobody by that name on the streets.");

    const lockAcct = async (accId) =>
      (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [accId])).rows[0];
    const [a1, a2] = [ch.account_id, victim.account_id].sort();
    const accts = { [a1]: await lockAcct(a1), [a2]: await lockAcct(a2) };
    const acct = accts[ch.account_id], victimAcct = accts[victim.account_id];

    const owned = await loadOwned(client, ch);
    const victimOwned = await loadOwned(client, victim);
    await accrueAndLedger(client, ch, acct, owned);
    await accrueAndLedger(client, victim, victimAcct, victimOwned);

    const h = { ledger, rngLog, notify, track, bumpDaily, events: [], acct, owned, accountId,
                victimAcct, victimOwned };
    const result = await fn(ch, victim, client, h);

    await persistCharacter(client, ch);
    await persistKitchen(client, ch, owned);
    if (victim.alive !== false) { // death finalizes its own row and wipes the tables
      await persistCharacter(client, victim);
      await persistKitchen(client, victim, victimOwned);
    }
    for (const [accId, a] of Object.entries(accts)) await persistAccount(client, accId, a);
    await client.query('COMMIT');
    if (acct.referred_by && !acct.ref_paid && !acct.agent_flag) {
      try { await maybeSparkReferral(pool, accountId); } catch (e) { console.error('referral spark (post-commit, non-fatal)', e?.code || e); }
      // post-commit + non-fatal: a throw here (a 40P01 on the char/street_tax locks under load, any
      // DB error) after the two-party action already COMMITTED would surface a non-2xx → idempotency
      // release → retry re-executes the action = double-spend. Swallow, exactly like the solo path.
      try { await maybeQualifyReferral(pool, accountId); } catch (e) { console.error('referral qualification (post-commit, non-fatal)', e?.code || e); }
      try { await maybeGrandReferral(pool, accountId); } catch (e) { console.error('referral tier-2 (post-commit, non-fatal)', e?.code || e); }
    }
    // (red-team R4 idempotency finding-2) a post-commit render failure must never surface a non-2xx —
    // the two-party action already COMMITTED; degrade the snapshot, not the success (see withCharacter).
    let character = null;
    try { character = view(ch, acct, owned); } catch (e) { console.error('view render (post-commit, non-fatal)', e?.code || e); }
    return { character, events: h.events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

async function persistCharacter(client, ch) {
  await client.query(
    `UPDATE characters SET respect=$2, energy=$3, nerve=$4, health=$5, cash=$6, bank=$7,
      muscle=$8, cunning=$9, speed=$10, jail_until=$11, loc=$12, streak=$13, checkin_day=$14,
      lc_crime=$15, ammo=$16, cb=$17, heat=$18, trade_rep=$19, gta_at=$20, path=$21,
      gun=$22, vest=$23, shoot_cd_until=$24, busts=$25, hosp_until=$26,
      lab=$27, crew=$28, heist_at=$29, title=$30,
      racket_credit_ms=$31, season_kills=$32, npchit_at=$33, safe_until=$34,
      guard_price=$35, guarded_by=$36, guarded_until=$37, bank_credit_ms=$38, last_accrued_at=$39,
      bank_intransit=$40, bank_intransit_at=$41, fade_limit=$42, wash_used=$43, wash_at=$44, respec_at=$45,
      crew_paid_at=$46, heat_exposure=$47, indicted_at=$48, retainer_until=$49, jury_bought=$50, witpro_until=$51,
      world_raid_at=$52, pen_safe_until=$53, hole_until=$54, welsher=$55, wanted_until=$56,
      rwa_used=$57, rwa_at=$58, envelope_until=$59, wire_until=$60, poker_limit=$61 WHERE id=$1`,
    [ch.id, ch.respect, ch.energy, ch.nerve, ch.health, ch.cash, ch.bank,
     ch.muscle, ch.cunning, ch.speed, ch.jail_until, ch.loc, ch.streak, ch.checkin_day,
     ch.lc_crime, ch.ammo, ch.cb, ch.heat, ch.trade_rep, ch.gta_at, ch.path,
     ch.gun, ch.vest, ch.shoot_cd_until, ch.busts, ch.hosp_until,
     ch.lab, ch.crew, ch.heist_at, ch.title, ch.racket_credit_ms, ch.season_kills ?? 0, ch.npchit_at, ch.safe_until,
     ch.guard_price, ch.guarded_by, ch.guarded_until, ch.bank_credit_ms, ch.last_accrued_at,
     ch.bank_intransit ?? 0, ch.bank_intransit_at, ch.fade_limit ?? null,
     ch.wash_used ?? 0, ch.wash_at ?? null, ch.respec_at ?? null, ch.crew_paid_at ?? null,
     ch.heat_exposure ?? 0, ch.indicted_at ?? null, ch.retainer_until ?? null, ch.jury_bought ?? false, ch.witpro_until ?? null,
     ch.world_raid_at ?? null, ch.pen_safe_until ?? null, ch.hole_until ?? null, ch.welsher ?? false, ch.wanted_until ?? null,
     ch.rwa_used ?? 0, ch.rwa_at ?? null, ch.envelope_until ?? null, ch.wire_until ?? null,
     ch.poker_limit ?? null]);
}

// THE COACH — the single highest-value next step for THIS player, server-authoritative so the client
// never guesses. A priority ladder: emergencies first (lockup, hospital, bleeding), then the big
// progression unlocks (a Path, a family), then safety (bank your cash), then finishing the First Week,
// then just staying active. Pure guidance — reads state, moves nothing. Returns { label, hint, tab }.
function coachOf(ch, acct, owned) {
  const lvl = levelOf(Number(ch.respect));
  const maxEnergy = 50 + 2 * lvl + assetEnergyCap(owned.assets || []);
  const now = Date.now();
  const future = (t) => t && new Date(t) > new Date(now);
  const onboard = typeof acct.onboard === 'string' ? JSON.parse(acct.onboard || '{}') : (acct.onboard || {});
  const obDone = ONBOARD_TASKS.filter((t) => onboard[t.id]).length;
  if (future(ch.jail_until)) return { label: 'You\'re in lockup', hint: 'Sit it out — or work the Pen: bribe the guard, work the yard, watch your back.', tab: 'pen' };
  if (future(ch.hosp_until)) return { label: 'Laid up in the hospital', hint: 'Patched up soon. Nothing to do but heal and wait.', tab: 'streets' };
  if (Number(ch.health) < 30) return { label: 'You\'re bleeding out', hint: 'Heal up before someone finishes the job (the Heal button, top-left).', tab: 'streets' };
  // urgent, time-boxed threats — these cost you if you sit on them (all false for a fresh street)
  if (future(ch.wanted_until)) return { label: 'There\'s a price on you', hint: 'You\'re WANTED — even your family can hunt you and NPC guns are out. Square your name at the Shylock, or lie low.', tab: 'loans' };
  if (ch.indicted_at) return { label: 'The Bureau indicted you', hint: 'A RICO case is filed — the grace clock is running. Take a plea, buy the jury, or demand trial in The Law.', tab: 'law' };
  if (ch.welsher) return { label: 'Your name is mud', hint: 'You welshed on a debt — nobody lends to you. Square it at the Shylock to borrow again.', tab: 'loans' };
  if (Number(ch.lc_crime || 0) < 1) return { label: 'Pull your first job', hint: 'Head to the Streets and run any crime — it\'s how everything starts. Then follow Start Here.', tab: 'streets' };
  if (lvl >= 5 && !ch.path) return { label: 'You\'ve made rank', hint: 'Declare a Path — The Gun, The Ledger, or The Kitchen. It shapes how you earn.', tab: 'streets' };
  if (!owned.gangId && lvl >= 3) return { label: 'Nobody survives alone', hint: 'Join a family or found your own — turf, tribute, wars, and backup.', tab: 'family' };
  if (Number(ch.cash) > 25000 && Number(ch.cash) > Number(ch.bank)) return { label: 'You\'re carrying too much', hint: 'Bank your pocket cash before someone jumps you for it — the streets are watching.', tab: 'streets' };
  // (audit F1) Only the GAMEPLAY First-Week tasks gate the coach. The 3 socials + the wallet link are
  // OPTIONAL bonuses on Start Here — they throw `verify_unavailable` when SOCIAL_VERIFY_MODE is off
  // (the default), so counting them would pin the coach at "Finish your First Week" forever and mask
  // every mid-game rung below. Gate on the five completable gameplay tasks instead.
  const obGameplay = ONBOARD_TASKS.filter((t) => !t.social && t.id !== 'ob_wallet');
  if (obGameplay.some((t) => !onboard[t.id]))
    return { label: `Finish your First Week (${obDone}/${ONBOARD_TASKS.length})`, hint: 'The checklist pays cash to teach you the ropes — claim what\'s ready over on Start Here.', tab: 'start' };
  // the bridge into the deep game — a ladder of "what next" so the coach never goes silent mid-game
  const hasEarner = !!ch.lab || (owned.businesses || []).length || (owned.rackets || []).length
    || (owned.assets || []).length || (owned.fighters || []).length || !!owned.speakeasy;
  if (!hasEarner && lvl >= 3) return { label: 'Money while you sleep', hint: 'Buy a racket in The Empire — cheap passive income that pays while you\'re offline. Kitchens and fronts come later.', tab: 'empire' };
  if (lvl >= 4 && !(owned.skills || []).length) return { label: 'You\'ve earned skill points', hint: 'Spend them in The Life on a branch — Enforcer, Operator, or Wheelman — for permanent edges.', tab: 'life' };
  if (!ch.lab && lvl >= 8 && !(owned.businesses || []).length) return { label: 'Cook up real money', hint: 'Set up a Kitchen — the drug trade is the deepest earner in the game.', tab: 'kitchen' };
  if (lvl >= 15 && Number(acct.omr || 0) > 0 && !(owned.portfolio || []).length) return { label: 'Time to go legit', hint: 'Wash $OMR into a real blue-chip book — it survives your death and pays a dividend. Going Legit.', tab: 'portfolio' };
  if (Number(ch.energy) >= maxEnergy * 0.75) return { label: 'Full tank', hint: 'You\'ve got energy to burn — go pull a job on the Streets, or try the Den, the Fights, or a heist crew.', tab: 'streets' };
  return null; // an established player who knows the ropes — no nag
}

export function view(ch, acct = {}, owned = {}) {
  const lvl = levelOf(Number(ch.respect));
  const assets = owned.assets || [];
  const gear = owned.gear || [];
  const eff = (s) => effStat(ch[s], s, assets, gear);
  return { id: ch.id, name: ch.name, generation: ch.generation, level: lvl,
    respect: Number(ch.respect), energy: Math.floor(Number(ch.energy)), nerve: Math.floor(Number(ch.nerve)),
    health: Math.floor(Number(ch.health)), cash: Math.floor(Number(ch.cash)), bank: Math.floor(Number(ch.bank)),
    omr: Number(acct.omr || 0), staked: Number(acct.staked || 0), rewards: Number(acct.rewards || 0),
    unbonding: Number(acct.unbonding || 0),
    unbondSeconds: (Number(acct.unbonding || 0) > 0 && acct.unbond_at) ? Math.max(0, Math.ceil((new Date(acct.unbond_at) - Date.now()) / 1000)) : 0,
    bankInTransit: Math.min(Math.floor(Number(ch.bank_intransit || 0)), Math.floor(Number(ch.bank))),
    bankClearSeconds: (Number(ch.bank_intransit || 0) > 0 && ch.bank_intransit_at)
      ? Math.max(0, Math.ceil((new Date(ch.bank_intransit_at).getTime() + CONSTANTS.BANK_CLEAR_MS - Date.now()) / 1000)) : 0,
    safehouseCost: Math.max(M3.SAFEHOUSE_COST, Math.floor((Number(ch.cash) + Number(ch.bank)) * CONSTANTS.SAFEHOUSE_NW_BPS / 10000)),
    stats: { muscle: ch.muscle, cunning: ch.cunning, speed: ch.speed },
    eff: { muscle: eff('muscle'), cunning: eff('cunning'), speed: eff('speed') },
    rerollCredits: Number(acct.reroll_credits || 0), // paid 0.01-ETH stat re-rolls in hand
    statTotal: Number(ch.muscle) + Number(ch.cunning) + Number(ch.speed), // fixed budget — a re-roll only reshapes it
    ammo: Number(ch.ammo || 0), cb: Number(ch.cb || 0), heat: Math.round(Number(ch.heat || 0)),
    welsher: !!ch.welsher, // LOAN SHARKING: defaulted on a debt — can't borrow again (dies with the street)
    // LOAN step 4 — WANTED: a defaulter under active pursuit (omertà stripped + NPC hunters + a pool bounty)
    wanted: !!(ch.wanted_until && new Date(ch.wanted_until) > new Date()),
    wantedSeconds: ch.wanted_until && new Date(ch.wanted_until) > new Date() ? Math.ceil((new Date(ch.wanted_until) - Date.now()) / 1000) : 0,
    // THE LAW — the rap sheet at a glance (GET /v1/law is the full docket). Pure status.
    law: { stage: rapStageOf(ch.heat_exposure, ch.indicted_at), exposure: Math.round(Number(ch.heat_exposure || 0)),
      indicted: !!ch.indicted_at,
      retainerSeconds: retainerActive(ch) ? Math.max(0, Math.ceil((new Date(ch.retainer_until) - Date.now()) / 1000)) : 0,
      witproSeconds: witproActive(ch) ? Math.max(0, Math.ceil((new Date(ch.witpro_until) - Date.now()) / 1000)) : 0,
      rat: !!acct.rat },
    tradeRep: Number(ch.trade_rep || 0), busts: Number(ch.busts || 0),
    gun: ch.gun || null, vest: ch.vest || null, guns: owned.guns || [],
    jailSeconds: ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until) - Date.now()) / 1000)) : 0,
    hospSeconds: ch.hosp_until ? Math.max(0, Math.ceil((new Date(ch.hosp_until) - Date.now()) / 1000)) : 0,
    shootCdSeconds: ch.shoot_cd_until ? Math.max(0, Math.ceil((new Date(ch.shoot_cd_until) - Date.now()) / 1000)) : 0,
    safeSeconds: ch.safe_until ? Math.max(0, Math.ceil((new Date(ch.safe_until) - Date.now()) / 1000)) : 0,
    guardPrice: ch.guard_price != null ? Math.floor(Number(ch.guard_price)) : null,
    fadeLimit: ch.fade_limit != null ? Math.floor(Number(ch.fade_limit)) : null,
    pokerLimit: ch.poker_limit != null ? Math.floor(Number(ch.poker_limit)) : null,
    vendettas: (owned.vendettas || []).map((v) => ({ target: v.target_name || null, targetId: v.target_id || null,
      sworn: v.sworn, expiresSeconds: Math.max(0, Math.ceil((new Date(v.expires_at) - Date.now()) / 1000)) })),
    guardedBy: (ch.guarded_by && ch.guarded_until && new Date(ch.guarded_until) > new Date()) ? ch.guarded_by : null,
    guardSeconds: (ch.guarded_by && ch.guarded_until) ? Math.max(0, Math.ceil((new Date(ch.guarded_until) - Date.now()) / 1000)) : 0,
    loc: ch.loc, path: ch.path, title: ch.title, streak: ch.streak,
    maxEnergy: 50 + 2 * lvl + assetEnergyCap(assets), maxNerve: 10 + lvl,
    // (red-team R5) mirror the canonical trunkCap() exactly — the display had omitted the road_boss
    // capstone's +trunk, showing a maxed Wheelman a smaller trunk than the enforcement actually gives.
    cargoCap: cargoCapacity(assets)
      + (owned.skills?.has('pack_mule') ? SKILLS.FX.TRUNK_BONUS : 0)
      + (owned.skills?.has('road_boss') ? SKILLS.FX.ROAD_BOSS_TRUNK : 0),
    skills: [...(owned.skills || [])],
    // FIVE PILLARS #1 — the honor axis (Fable): the value + tier the world reads you by
    honor: { value: Number(ch.honor || 0), tier: honorTierOf(ch.honor || 0).name },
    // (red-team R5) mirror pointsOf() — total = level-derived + the prestige bonus the learn-gate grants;
    // the display had omitted the prestige points, under-reporting a prestiged bloodline's real budget.
    skillPoints: (() => {
      const fromLevel = Math.floor(lvl / SKILLS.LVL_PER_POINT);
      const prestigeBonus = Math.min(SKILLS.PRESTIGE_POINT_MAX, Math.floor(Number(acct?.prestige || 0) / SKILLS.PRESTIGE_PER_POINT));
      const total = fromLevel + prestigeBonus;
      const spent = [...(owned.skills || [])].reduce((a, id) => a + (skillOf(id)?.cost || 0), 0);
      return { total, spent, available: Math.max(0, total - spent) }; })(),
    rackets: owned.rackets || [], assets, businesses: owned.businesses || [], speakeasy: owned.speakeasy || null, fighters: owned.fighters || [], cargo: owned.cargo || {}, items: owned.items || {}, gear,
    cars: (owned.cars || []).map((c) => ({ id: c.id, model: c.model_id, trim: c.trim_id, dmg: c.dmg, plate: c.plate || null, listed: !!c.listed, pledged: !!c.pledged, tune: Number(c.tune || 0), raceLimit: c.race_limit != null ? Math.floor(Number(c.race_limit)) : null })),
    gang: owned.gang ? { id: owned.gang.id, name: owned.gang.name, tag: owned.gang.tag, role: owned.gangRole,
      color: owned.gang.color || null, seal: sealOf(owned.gang.seal)?.name || null,
      foundation: foundationOf(owned.gang.foundation)?.name || null, foundationTier: Number(owned.gang.foundation || 0),
      treasury: Math.floor(Number(owned.gang.treasury)), ammoBank: Number(owned.gang.ammo_bank),
      held: owned.held } : null,
    lab: ch.lab || null, crew: Number(ch.crew || 0),
    // recurring sinks — the crew's nut: what's owed, the hourly rate, and whether they've downed tools
    crewWageOwed: crewWageOwed(ch), crewWagePerHr: Number(ch.crew || 0) * M4.CREW_WAGE_PER_HR, crewCold: crewCold(ch),
    makings: owned.makings || {},
    stash: (owned.stash || []).filter((s) => Number(s.qty) > 0)
      .map((s) => ({ drug: s.drug_id, qty: Number(s.qty), quality: Math.round(Number(s.quality) * 100) / 100 })),
    batch: owned.batch ? { drug: owned.batch.drug_id, qty: Number(owned.batch.qty),
      readySeconds: Math.max(0, Math.ceil((new Date(owned.batch.done_at) - Date.now()) / 1000)) } : null,
    tradeRank: tradeRankIdx(Number(ch.trade_rep || 0)),
    heistSeconds: ch.heist_at ? Math.max(0, Math.ceil((new Date(ch.heist_at) - Date.now()) / 1000)) : 0,
    prestige: Number(acct.prestige || 0), recruits: Number(acct.recruits || 0),
    // R1 — THE PORTFOLIO: your legit book at a glance (GET /v1/portfolio is the full board). Pure
    // status — the price values a collectible; it survives death (account-level), so it's the one
    // wealth line an heir keeps. Book value at today's deterministic price.
    portfolio: (() => { const pf = owned.portfolio || [];
      const holdings = pf.map((r) => { const price = tickerPriceOf(r.ticker);
        return { ticker: r.ticker, shares: Number(r.shares), price, bookValue: Math.round(Number(r.shares) * price * 100) / 100 }; });
      return { holdings, bookValue: Math.round(holdings.reduce((a, r) => a + r.bookValue, 0) * 100) / 100 }; })(),
    // THE ESTATE — your compound at a glance (GET /v1/estate is the full house). Account-level status,
    // survives death (the heir inherits it). Null until you buy your first place.
    estate: owned.estate ? { name: owned.estate.name || null, tier: Number(owned.estate.tier || 0),
      tierName: estateTierOf(Number(owned.estate.tier || 0))?.name || null } : null,
    wallet: acct.wallet_address || null,
    minted: !!acct.minted, respawnTokens: Number(acct.respawn_tokens || 0), mintCredits: Number(acct.mint_credits || 0),
    hitmanRep: Number(acct.hitman_rep || 0), kills: Number(acct.kills || 0), seasonKills: Number(ch.season_kills || 0),
    hitmanTitle: hitmanRankOf(Number(acct.hitman_rep || 0)).title,
    onboard: typeof acct.onboard === 'string' ? JSON.parse(acct.onboard || '{}') : (acct.onboard || {}),
    coach: coachOf(ch, acct, owned), // the guided next-step advisor (the sheet surfaces it)
    netWorth: Math.floor(Number(ch.cash) + Number(ch.bank) + assetsValue(assets)),
    cityEvent: cityEventOf(dayOf()).id,
    // THE LIVING WORLD — the city at a glance: the two event tracks + the intraday clock (GET /v1/city
    // is the full forecast). Kept beside the legacy `cityEvent` id (unchanged for back-compat).
    city: (() => { const ev = cityEventOf(dayOf()), law = cityLawEventOf(dayOf()), hr = cityHourOf();
      return { event: ev.id, name: ev.name, lawEvent: law.id, hour: hr.hour, phase: hr.phase, patrol: hr.patrol }; })() };
}

// ── §7.2 CRIME ──
export function doCrime(ch, crimeId, client, h) {
  const c = CRIMES.find((x) => x.id === crimeId);
  if (!c) throw new GameError('bad_crime', 'No such job.');
  const lvl = levelOf(Number(ch.respect));
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'You are in lockup.');
  if (lvl < c.lvl) throw new GameError('level', `That job needs level ${c.lvl}.`);
  if (Number(ch.nerve) < c.nerve) throw new GameError('nerve', `Takes ${c.nerve} nerve.`);
  ch.nerve = Number(ch.nerve) - c.nerve;
  const ev = cityEventOf(dayOf());
  const rIdx = rankIdxOf(lvl);
  const held = h.owned?.held || [];
  const eff = (s) => effStat(ch[s], s, h.owned?.assets || [], h.owned?.gear || []);
  // §7.2 full chance: stats + gang level (treasury tiers) + Brick Yards turf + rank
  const gangLevel = h.owned?.gang ? gangLevelOf(h.owned.gang.treasury) : 0;
  const chance = Math.min(0.97, c.base + eff('cunning') * 0.004 + eff('speed') * 0.002
    + gangLevel * 0.02 + (held.includes('brick') ? 0.02 : 0) + (rIdx >= 9 ? 0.02 : 0));
  const roll = Math.random();
  return (async () => {
    // SOLDIERS: the assigned, fit second rides along (assists + takes a cut + carries the risk)
    const second = await assignedSoldier(client, ch.id);
    if (roll < chance) {
      let take = Math.floor((c.cash[0] + Math.random() * (c.cash[1] - c.cash[0]))
        * (held.includes('canal') ? 1.1 : 1)                       // Canal Row turf +10%
        * (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1)
        * roleMultOf(h.owned?.gangRole) * (ev.jobPay || 1));
      // the second's cut comes OFF THE TOP before the books — the crime faucet only SHRINKS
      // (ledgered amount == credited amount; strictly §10.4-safe, no new reason)
      let soldierCut = 0;
      if (second) { soldierCut = Math.floor(take * SOLDIERS.CUT_BPS / 10000); take -= soldierCut; }
      const rep = Math.round(c.respect * (ev.crimeRep || 1));
      ch.cash = Number(ch.cash) + take; ch.respect = Number(ch.respect) + rep; ch.lc_crime += 1;
      await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take, reason: `crime:${c.id}` });
      // §7.2 contraband crates: Docks turf ×1.5, event cbMult; feed the workshop/exchange
      const pCrate = (0.25 + Number(ch.nerve) * 0.02) * (ev.cbMult || 1) * (held.includes('docks') ? 1.5 : 1);
      let crates = 0;
      if (Math.random() < pCrate) {
        crates = 1 + Math.floor(Number(ch.nerve) / 8);
        ch.cb = Number(ch.cb || 0) + crates;
        await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: `crime:${c.id}:cb` });
      }
      // §7.2 makings drop: P = 0.15, a random unlocked line, 1 + floor(nerve/6) units
      let makingsDrop = null;
      if (Math.random() < 0.15) {
        const unlocked = DRUGS.filter((d) => tradeRankIdx(Number(ch.trade_rep || 0)) >= d.unlock);
        if (unlocked.length) {
          const d = unlocked[Math.floor(Math.random() * unlocked.length)];
          const n = 1 + Math.floor(Number(ch.nerve) / 6);
          h.owned.makings[d.id] = (h.owned.makings[d.id] || 0) + n;
          makingsDrop = { drug: d.id, qty: n };
        }
      }
      await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'success');
      await h.track(client, ch.account_id, 'crime_attempt', { id: c.id, success: true });
      await h.bumpDaily(client, ch.id, 'crime');
      await bumpFamilyTask(client, h, 'crime', 1);
      await logCollect(client, ch.account_id, 'crimes', c.id); // THE COLLECTION — first pull of each job
      const soldier = second ? await soldierResult(client, h, ch, second, { success: true }) : null;
      return { ok: true, success: true, take, rep, crates, makingsDrop,
        soldier: soldier ? { ...soldier, cut: soldierCut } : null };
    }
    // GETAWAY (skills): the wheelman's stints run shorter — a new modifier, sign-off lever.
    // A WHEELMAN soldier stacks the same way (a second behind the wheel — SOLDIERS sign-off lever).
    const jailS = Math.round(c.jail * (ev.jailMult || 1) * (rIdx >= 5 ? 0.8 : 1)
      * skillMult(h, 'getaway', SKILLS.FX.JAIL_MULT)
      * (second?.trait === 'wheelman' ? Math.max(0, 1 - soldierFxOf(second)) : 1));
    if (jailS > 0) ch.jail_until = new Date(Date.now() + jailS * 1000);
    await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'fail');
    await h.track(client, ch.account_id, 'crime_attempt', { id: c.id, success: false });
    // the bust is the RISKY outcome — the second can get hurt, or worse
    const soldier = second ? await soldierResult(client, h, ch, second, { success: false, cause: 'busted on a job' }) : null;
    return { ok: true, success: false, jailSeconds: jailS, soldier };
  })();
}

// ── §7.3 TRAIN ──
export async function train(ch, stat, client, h) {
  if (!['muscle', 'cunning', 'speed'].includes(stat)) throw new GameError('bad_stat', 'No such stat.');
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'No gym in lockup.');
  if (Number(ch.energy) < 10) throw new GameError('energy', 'Too tired to train.');
  ch.energy = Number(ch.energy) - 10;
  const gain = Math.max(1, Math.round((1 + Math.random() * 2) * (200 / (200 + ch[stat]))));
  ch[stat] += gain;
  await h.bumpDaily(client, ch.id, 'train');
  return { ok: true, stat, gain };
}

// ── §5.1 HEAL ──
export async function heal(ch, client, h) {
  const lvl = levelOf(Number(ch.respect));
  // THE DOC'S FRIEND (skills) and DOC MORETTI T1 (underworld) both discount the bill —
  // new modifiers stacking multiplicatively (0.75 × 0.9), both sign-off levers
  const cost = Math.floor((100 - Math.floor(Number(ch.health))) * 15 * (rankIdxOf(lvl) >= 4 ? 0.9 : 1)
    * skillMult(h, 'doctors_friend', SKILLS.FX.DOC_MULT)
    * npcMult(h, 'doc', 1, UNDERWORLD.FX.DOC_MULT));
  if (cost <= 0) throw new GameError('healthy', 'Already healthy.');
  if (Number(ch.cash) < cost) throw new GameError('cash', `The Doc wants $${cost}.`);
  ch.cash = Number(ch.cash) - cost; ch.health = 100;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'heal' });
  await bumpStanding(client, h, ch, 'doc', 2, { action: 'heal' }); // doing business with the Doc
  return { ok: true, cost };
}

// ── §7.4 CHECK-IN ──
export async function checkin(ch, client, h) {
  const today = dayOf();
  if (ch.checkin_day === today) throw new GameError('done', 'Already checked in today.');
  ch.streak = ch.checkin_day === today - 1 ? ch.streak + 1 : Math.max(1, Math.floor(ch.streak / 2)); // miss halves, never zero
  ch.checkin_day = today;
  const lvl = levelOf(Number(ch.respect));
  const pay = 250 * lvl + 100 * lvl * Math.min(ch.streak, 7);
  ch.cash = Number(ch.cash) + pay;
  ch.energy = Math.min(50 + 2 * lvl, Number(ch.energy) + 20);
  h.acct.checkins_lifetime = Number(h.acct.checkins_lifetime || 0) + 1; // referral gate §7.13
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'checkin' });
  return { ok: true, pay, streak: ch.streak };
}

// ── BANK & TRAVEL ──
export async function bank(ch, dir, amount, client, h) {
  amount = Math.floor(Number(amount));
  if (!(Number.isFinite(amount) && amount > 0)) throw new GameError('amount', 'Positive amounts only.'); // Number.isFinite rejects Infinity/NaN (E-L3 defense-in-depth)
  if (dir === 'deposit') {
    // BALANCE D2 — shield, not bunker: banking is an EXPOSED act (the courier walks). You can't
    // move money into the vault from inside a safehouse; withdrawing (bringing cash to hand) is fine.
    if (ch.safe_until && new Date(ch.safe_until) > new Date())
      throw new GameError('safe', "The courier won't come to a safehouse — banking waits until you surface.");
    if (Number(ch.cash) < amount) throw new GameError('cash', 'Not that much in pocket.');
    ch.cash = Number(ch.cash) - amount; ch.bank = Number(ch.bank) + amount;
    // Make-Risk-Pay: the deposit rides "in transit" for BANK_CLEAR_MS — lootable on a fire-kill
    // until it clears (lazily, in accrual). A follow-up deposit joins the courier: the amounts
    // stack and the clock resets, so split deposits can't shave the window.
    ch.bank_intransit = Number(ch.bank_intransit || 0) + amount;
    ch.bank_intransit_at = new Date();
  } else {
    if (Number(ch.bank) < amount) throw new GameError('bank', 'Not that much banked.');
    ch.bank = Number(ch.bank) - amount; ch.cash = Number(ch.cash) + amount;
    // a withdrawal can't leave the in-transit marker above the remaining balance
    ch.bank_intransit = Math.min(Number(ch.bank_intransit || 0), Number(ch.bank));
  }
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: 0, reason: `bank:${dir}:${amount}` });
  return { ok: true };
}
export async function travel(ch, district, client, h) {
  if (!DISTRICTS.find((d) => d.id === district)) throw new GameError('bad_district', 'No such district.');
  if (ch.loc === district) throw new GameError('there', 'You are already there.');
  if (ch.jail_until && new Date(ch.jail_until) > new Date()) throw new GameError('jailed', 'No travel from lockup.');
  if (Number(ch.cash) < CONSTANTS.TRAVEL_COST) throw new GameError('cash', `A ride costs $${CONSTANTS.TRAVEL_COST}.`);
  ch.cash = Number(ch.cash) - CONSTANTS.TRAVEL_COST; ch.loc = district;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -CONSTANTS.TRAVEL_COST, reason: 'travel' });
  await logCollect(client, ch.account_id, 'districts', district); // THE COLLECTION — set foot everywhere
  return { ok: true, loc: district };
}

// ── §7.13 REFERRAL QUALIFICATION ──
// Runs in its own transaction after any action by a referred, unpaid account.
// All four gates required (level 8, 40 jobs, 3 check-ins, $25k net worth), once
// ever. Pays recruiter + recruit atomically, bumps milestones and the recruiter
// gang's weekly `recruit` progress, notifies both. Agent-flagged accounts are
// excluded on both sides; same-IP pairs are flagged for review (§10.3).
export async function maybeQualifyReferral(pool, recruitAccountId) {
  // cheap unlocked pre-check to avoid opening a transaction for the common no-op
  const pre = (await pool.query('SELECT referred_by, ref_paid, agent_flag FROM account_persistent WHERE account_id=$1', [recruitAccountId])).rows[0];
  if (!pre || !pre.referred_by || pre.ref_paid || pre.agent_flag) return null;
  const recruiterAccountId = pre.referred_by;
  if (recruiterAccountId === recruitAccountId) return null; // never self-refer (defense-in-depth)

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // GLOBAL LOCK ORDER (§10.1): characters (sorted id) THEN accounts (sorted id),
    // matching withTwoCharacters so the two paths can never deadlock each other.
    const ids = (await client.query('SELECT id, account_id FROM characters WHERE account_id = ANY($1) AND alive', [[recruitAccountId, recruiterAccountId]])).rows;
    const recruitId = ids.find((r) => r.account_id === recruitAccountId)?.id;
    const recruiterId = ids.find((r) => r.account_id === recruiterAccountId)?.id;
    if (!recruitId || !recruiterId) { await client.query('ROLLBACK'); return null; }
    const lockedC = {};
    for (const id of [recruitId, recruiterId].sort())
      lockedC[id] = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    const lockedA = {};
    for (const id of [recruitAccountId, recruiterAccountId].sort())
      lockedA[id] = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [id])).rows[0];
    const recruit = lockedC[recruitId], recruiter = lockedC[recruiterId];
    const acct = lockedA[recruitAccountId], recruiterAcct = lockedA[recruiterAccountId];
    // re-validate every gate under the locks (state may have changed since the pre-check)
    if (!recruit || !recruiter || !acct || !recruiterAcct) { await client.query('ROLLBACK'); return null; }
    if (acct.referred_by !== recruiterAccountId || acct.ref_paid || acct.agent_flag || recruiterAcct.agent_flag) { await client.query('ROLLBACK'); return null; }

    // the four gates, all required
    const owned = await loadOwned(client, recruit);
    const netWorth = Number(recruit.cash) + Number(recruit.bank) + assetsValue(owned.assets)
      + gunsValue(owned.guns) + fleetValue(owned.cars) + racketsValue(owned.rackets);
    const qualified = levelOf(Number(recruit.respect)) >= M4.REF_GATES.level
      && Number(recruit.lc_crime) >= M4.REF_GATES.jobs
      && Number(acct.checkins_lifetime) >= M4.REF_GATES.checkins
      && netWorth >= M4.REF_GATES.netWorth;
    if (!qualified) { await client.query('ROLLBACK'); return null; }

    // $OMR side only if the event fund covers the full 4 (3 recruiter + 1 recruit, v24)
    const fund = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    const funded = Number(fund.fund) >= M4.REF_FUND_OMR;
    if (funded) await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [M4.REF_FUND_OMR]);

    const mult = await referralPushMult(client); // recruitment-drive CASH multiplier (1 when no push); $OMR untouched
    const recruitCash = Math.round(M4.REF_RECRUIT_CASH * mult), recruiterCash = Math.round(M4.REF_RECRUITER_CASH * mult);
    recruit.cash = Number(recruit.cash) + recruitCash;
    recruiter.cash = Number(recruiter.cash) + recruiterCash;
    await ledger(client, { characterId: recruit.id, currency: 'cash', amount: recruitCash, reason: 'referral:recruit' });
    await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: recruiterCash, reason: 'referral:recruiter', counterparty: recruit.id });
    if (funded) {
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [recruitAccountId, M4.REF_RECRUIT_OMR]);
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acct.referred_by, M4.REF_RECRUITER_OMR]);
      await ledger(client, { accountId: recruitAccountId, currency: 'omr', amount: M4.REF_RECRUIT_OMR, reason: 'referral:fund' });
      await ledger(client, { accountId: acct.referred_by, currency: 'omr', amount: M4.REF_RECRUITER_OMR, reason: 'referral:fund' });
    }

    // recruiter ladder: recruits++ and any milestones crossed (cash faucet;
    // milestone $OMR pays only what the event fund still covers)
    const before = Number(recruiterAcct.recruits), after = before + 1;
    let milestoneCash = 0, milestoneOmr = 0, title = null;
    let fundLeft = Number(fund.fund) - (funded ? M4.REF_FUND_OMR : 0);
    for (const m of RECRUIT_MILESTONES.filter((m) => m.n > before && m.n <= after)) {
      milestoneCash += Math.round((m.cash || 0) * mult); // the drive multiplies milestone cash too; $OMR stays fund-bounded
      if (m.omr && fundLeft >= m.omr) { milestoneOmr += m.omr; fundLeft -= m.omr; }
      if (m.title) title = m.title;
    }
    if (milestoneCash > 0) {
      recruiter.cash = Number(recruiter.cash) + milestoneCash;
      await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: milestoneCash, reason: 'referral:milestone' });
    }
    if (milestoneOmr > 0) {
      await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [milestoneOmr]);
      await client.query('UPDATE account_persistent SET omr = omr + $2 WHERE account_id=$1', [acct.referred_by, milestoneOmr]);
      await ledger(client, { accountId: acct.referred_by, currency: 'omr', amount: milestoneOmr, reason: 'referral:milestone' });
    }
    if (title) recruiter.title = title;
    await client.query('UPDATE account_persistent SET recruits=$2 WHERE account_id=$1', [acct.referred_by, after]);
    await client.query('UPDATE account_persistent SET ref_paid=true WHERE account_id=$1', [recruitAccountId]);
    await client.query('UPDATE referrals SET qualified_at=now() WHERE recruit_account=$1', [recruitAccountId]);

    // recruiter's family gets weekly `recruit` progress
    const rGang = (await client.query('SELECT gang_id FROM gang_members WHERE character_id=$1', [recruiter.id])).rows[0];
    if (rGang?.gang_id) await bumpFamilyTask(client, { owned: { gangId: rGang.gang_id } }, 'recruit', 1);

    // §10.3 — same-IP recruiter/recruit pairs auto-flag for review
    // IN ($1,$2) not ANY($1)-of-array: node-postgres serializes a JS array for ANY, but pg-mem returns
    // ZERO rows for it — so the ANY form made this flag silently untestable (and never exercised). IN is
    // identical in production and pg-mem-portable. The self-referral guard above ensures the two ids differ.
    const ips = (await client.query('SELECT id, created_ip FROM accounts WHERE id IN ($1,$2)', [recruitAccountId, acct.referred_by])).rows;
    if (ips.length === 2 && ips[0].created_ip && ips[0].created_ip === ips[1].created_ip)
      await track(client, recruitAccountId, 'referral_same_ip_flag', { recruiter: acct.referred_by });

    await client.query(
      `UPDATE characters SET cash=$2, title=COALESCE($3, title) WHERE id=$1`, [recruiter.id, recruiter.cash, title]);
    await client.query('UPDATE characters SET cash=$2 WHERE id=$1', [recruit.id, recruit.cash]);
    await notify(client, recruiter.id, 'ref', { from: recruit.name, amt: recruiterCash + milestoneCash, omr: (funded ? M4.REF_RECRUITER_OMR : 0) + milestoneOmr, recruits: after });
    await notify(client, recruit.id, 'ref', { made: true, amt: recruitCash, omr: funded ? M4.REF_RECRUIT_OMR : 0 });
    await track(client, recruitAccountId, 'referral_qualified', { recruiter: acct.referred_by, funded, mult });
    await client.query('COMMIT');
    return { qualified: true, funded };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// STEPPED PAYOUT — "the spark" (§7.13 addendum): a small EARLY cash bonus the moment a referred
// recruit shows real early engagement (REF_SPARK gates: level 3 + 10 jobs) — long before the full
// qualification — so the referrer gets fast feedback and keeps referring. CASH ONLY (never $OMR,
// which stays on the full gate), ONCE ever (ref_spark), agent-excluded, same sorted two-party lock
// as maybeQualifyReferral so the two can't deadlock. Called post-commit, non-fatal (swallowed).
export async function maybeSparkReferral(pool, recruitAccountId) {
  const pre = (await pool.query('SELECT referred_by, ref_spark, ref_paid, agent_flag FROM account_persistent WHERE account_id=$1', [recruitAccountId])).rows[0];
  if (!pre || !pre.referred_by || pre.ref_spark || pre.ref_paid || pre.agent_flag) return null;
  const recruiterAccountId = pre.referred_by;
  if (recruiterAccountId === recruitAccountId) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = (await client.query('SELECT id, account_id FROM characters WHERE account_id = ANY($1) AND alive', [[recruitAccountId, recruiterAccountId]])).rows;
    const recruitId = ids.find((r) => r.account_id === recruitAccountId)?.id;
    const recruiterId = ids.find((r) => r.account_id === recruiterAccountId)?.id;
    if (!recruitId || !recruiterId) { await client.query('ROLLBACK'); return null; }
    const lockedC = {};
    for (const id of [recruitId, recruiterId].sort()) // characters → accounts, sorted (the qualify path's order)
      lockedC[id] = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
    const lockedA = {};
    for (const id of [recruitAccountId, recruiterAccountId].sort())
      lockedA[id] = (await client.query('SELECT * FROM account_persistent WHERE account_id=$1 FOR UPDATE', [id])).rows[0];
    const recruit = lockedC[recruitId], recruiter = lockedC[recruiterId];
    const acct = lockedA[recruitAccountId], recruiterAcct = lockedA[recruiterAccountId];
    if (!recruit || !recruiter || !acct || !recruiterAcct) { await client.query('ROLLBACK'); return null; }
    if (acct.referred_by !== recruiterAccountId || acct.ref_spark || acct.ref_paid || acct.agent_flag || recruiterAcct.agent_flag) { await client.query('ROLLBACK'); return null; }
    // the early gate — real playtime, well short of full qualification (keeps it Sybil-bounded)
    if (!(levelOf(Number(recruit.respect)) >= M4.REF_SPARK.level && Number(recruit.lc_crime) >= M4.REF_SPARK.jobs)) { await client.query('ROLLBACK'); return null; }
    // §10.3 — same-IP recruiter/recruit pairs auto-flag for review (parity with maybeQualifyReferral).
    // The spark is the CHEAPEST referral cash faucet (no check-in/net-worth floor), so a same-machine ring
    // must produce the same mod-review signal the expensive qualify path already emits (red-team R28 MED).
    const sparkIps = (await client.query('SELECT id, created_ip FROM accounts WHERE id IN ($1,$2)', [recruitAccountId, recruiterAccountId])).rows;
    if (sparkIps.length === 2 && sparkIps[0].created_ip && sparkIps[0].created_ip === sparkIps[1].created_ip)
      await track(client, recruitAccountId, 'referral_same_ip_flag', { recruiter: recruiterAccountId, spark: true });
    const mult = await referralPushMult(client); // recruitment-drive CASH multiplier (1 when no push)
    const recruitCash = Math.round(M4.REF_SPARK.recruitCash * mult), recruiterCash = Math.round(M4.REF_SPARK.recruiterCash * mult);
    recruit.cash = Number(recruit.cash) + recruitCash;
    recruiter.cash = Number(recruiter.cash) + recruiterCash;
    await ledger(client, { characterId: recruit.id, currency: 'cash', amount: recruitCash, reason: 'referral:spark' });
    await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: recruiterCash, reason: 'referral:spark', counterparty: recruit.id });
    await client.query('UPDATE characters SET cash=$2 WHERE id=$1', [recruit.id, recruit.cash]);
    await client.query('UPDATE characters SET cash=$2 WHERE id=$1', [recruiter.id, recruiter.cash]);
    await client.query('UPDATE account_persistent SET ref_spark=true WHERE account_id=$1', [recruitAccountId]);
    await notify(client, recruiter.id, 'ref', { from: recruit.name, amt: recruiterCash, spark: true });
    await notify(client, recruit.id, 'ref', { made: true, amt: recruitCash, spark: true });
    await track(client, recruitAccountId, 'referral_spark', { recruiter: recruiterAccountId });
    await client.query('COMMIT');
    return { sparked: true };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// ── THE RECRUITMENT DRIVE ("the push") — a time-boxed CASH multiplier on every referral payout ──
// The $OMR side is untouched (fund-bounded). Bounded by real qualified recruits → Sybil-bounded.
export async function referralPushMult(client) {
  const r = (await client.query('SELECT until, mult FROM referral_push WHERE id=1')).rows[0];
  return (r && r.until && new Date(r.until) > new Date()) ? (Number(r.mult) || 1) : 1;
}
export async function referralPushStatus(pool) {
  const r = (await pool.query('SELECT until, mult FROM referral_push WHERE id=1')).rows[0];
  const active = !!(r && r.until && new Date(r.until) > new Date());
  return { active, mult: active ? Number(r.mult) : 1, until: active ? r.until : null,
    seconds: active ? Math.max(0, Math.floor((new Date(r.until) - new Date()) / 1000)) : 0 };
}
export async function startReferralPush(pool, hours, mult) {
  const h = Math.min(M4.REF_PUSH_MAX_HOURS, Math.max(1, Math.floor(Number(hours) || 0)));
  const m = Math.min(M4.REF_PUSH_MAX_MULT, Math.max(1, Number(mult) || 1));
  const until = new Date(Date.now() + h * 3600 * 1000);
  await pool.query('UPDATE referral_push SET until=$1, mult=$2 WHERE id=1', [until, m]);
  return { active: true, mult: m, until, hours: h };
}

// TIER-2 "the family tree" (§7.13 addendum): when a recruit YOU brought in (R) then brings in their
// OWN qualified recruit (R2), you — the grandrecruiter (A) — earn a BOUNDED, ONE-TIME finder's fee.
// Deliberately a FLAT one-shot cash bonus, NOT an ongoing percentage of R2's earnings — that's the
// anti-MLM line (a referral bonus, not a revenue-share pyramid). CASH ONLY, capped at DEPTH 2 (no
// third level), agents excluded at EVERY level, once ever per R2 (ref_l2_paid). Keyed on R2's full
// qualification (so it fires inside the same post-commit block that just set R2.ref_paid — the hook
// stops firing for R2 once paid). Its OWN transaction; locks A's char then the two accounts sorted
// (characters → accounts, the qualify path's order); the flag flip is an atomic claim (no double-pay).
export async function maybeGrandReferral(pool, r2AccountId) {
  const r2 = (await pool.query('SELECT referred_by, ref_paid, ref_l2_paid, agent_flag FROM account_persistent WHERE account_id=$1', [r2AccountId])).rows[0];
  if (!r2 || !r2.ref_paid || r2.ref_l2_paid || r2.agent_flag || !r2.referred_by) return null; // only a QUALIFIED, non-agent recruit; once ever
  const rAccountId = r2.referred_by; // the direct recruiter (the "parent")
  const r = (await pool.query('SELECT referred_by, agent_flag, ref_paid FROM account_persistent WHERE account_id=$1', [rAccountId])).rows[0];
  // the middle link (R) must exist, be human, themselves have a referrer, AND be a QUALIFIED recruit
  // (audit: every level of the tree must be a real made man — a dead-signup middle link earns nobody)
  if (!r || r.agent_flag || !r.referred_by || !r.ref_paid) return null;
  const aAccountId = r.referred_by; // the grandrecruiter — the one we pay
  if (aAccountId === r2AccountId || aAccountId === rAccountId) return null; // distinct chain (defense-in-depth vs a cycle)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const aChar = (await client.query('SELECT id FROM characters WHERE account_id=$1 AND alive', [aAccountId])).rows[0];
    if (!aChar) { await client.query('ROLLBACK'); return null; } // grandrecruiter has no living street — nobody to pay
    await client.query('SELECT id FROM characters WHERE id=$1 FOR UPDATE', [aChar.id]); // lock the payee char (characters first)
    const lockedA = {}; // accounts sorted — the global lock order
    for (const id of [aAccountId, r2AccountId].sort())
      lockedA[id] = (await client.query('SELECT agent_flag, ref_paid, ref_l2_paid, referred_by FROM account_persistent WHERE account_id=$1 FOR UPDATE', [id])).rows[0];
    const A = lockedA[aAccountId], R2 = lockedA[r2AccountId];
    if (!A || !R2 || A.agent_flag) { await client.query('ROLLBACK'); return null; }
    if (!R2.ref_paid || R2.ref_l2_paid || R2.agent_flag || R2.referred_by !== rAccountId) { await client.query('ROLLBACK'); return null; } // re-verify under lock
    const claim = await client.query('UPDATE account_persistent SET ref_l2_paid=true WHERE account_id=$1 AND ref_paid AND NOT ref_l2_paid', [r2AccountId]);
    if (claim.rowCount !== 1) { await client.query('ROLLBACK'); return null; } // a concurrent run already paid it
    const mult = await referralPushMult(client);
    const bonus = Math.round(M4.REF_TIER2_CASH * mult);
    const aRow = (await client.query('SELECT cash FROM characters WHERE id=$1', [aChar.id])).rows[0];
    await ledger(client, { characterId: aChar.id, currency: 'cash', amount: bonus, reason: 'referral:tier2' });
    await client.query('UPDATE characters SET cash=$2 WHERE id=$1', [aChar.id, Number(aRow.cash) + bonus]);
    await notify(client, aChar.id, 'ref', { tier2: true, amt: bonus });
    await track(client, aAccountId, 'referral_tier2', { via: rAccountId, grandrecruit: r2AccountId });
    await client.query('COMMIT');
    return { tier2: true, amt: bonus };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
