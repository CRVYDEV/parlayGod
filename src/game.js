// M1 core + shared transaction machinery. Every formula cites spec §7 / prototype v24.
import crypto from 'node:crypto';
import { recordMeeting } from './contacts.js';
import { EventEmitter } from 'node:events';
import { CRIMES, DISTRICTS, DRUGS, RECRUIT_MILESTONES, CONSTANTS, RANKS,
         levelOf, rankIdxOf, cityEventOf, dayOf, referralXpBonus,
         assetEnergyCap, effStat, assetsValue, cargoCapacity, tradeRankIdx,
         gangLevelOf, roleMultOf, weekOf, familyTaskOf, M3, M4,
         gunsValue, fleetValue, racketsValue, hitmanRankOf, sealOf, SKILLS, skillOf, UNDERWORLD, leadTaskOf, ONBOARD_TASKS,
         crewWageOwed, crewCold, LAW, rapStageOf, bribeCostOf, retainerActive, witproActive,
         cityHourOf, cityLawEventOf, estateTierOf, foundationOf, campaignOf, honorTierOf,
         SOLDIERS, soldierFxOf, CLUES, clueStepOf, rollClueTier, kingpinRankOf, tycoonRankOf, racketIncomeLeveled, empireTitles, launderRankOf, frontTitles, statesmanRankOf, seasonModOf, PACING,
         ACTIVITY, carCollateralValue, carOf, MASTERY, masteryLvlOf, masteryRankOf, masteryXpFor, pathFx, pathXpMult,
         REGIMEN, disciplineLvlOf, energyCapOf, nerveCapOf, BUSINESSES, WIRE, RIVALS, CORNER, cornerTasksOf,
         KITCHENS, labModuleCost, recyclesToDesk, DESK_RECYCLE_REASON, isMade, madeSeconds,
         MADE_LADDER, madeRungIdx, madeRungOf, ladderFx, STAKE_LOCKS, stakeLockActive, effectiveStake,
         ASSETS, OPERATIONS, opSlotsOf, nextOpSlotLevel, MISSIONS, dailyLiveFor, jailed, safeHoused,
         STABLE, SPEAKEASY, ESTATE, MADE, CREW, crewObjectiveOf, DEEDS, deedController , runOf, npcOf, usd, WALLET_FORGE } from './rules.js';
import { dbCaps } from './db.js';
import { accrue } from './accrual.js';
import { logCollect } from './collection.js';
import { claimFirst, firstTaken, __setAnnouncer } from './firsts.js';
import { businessesOf } from './business.js';
import { speakeasyOwnedOf } from './speakeasy.js';
import { fightersOf } from './boxing.js';

const uid = () => crypto.randomUUID();
import { startFirstBlood } from './firstblood.js';   // THE AHA MOMENT — assign a fresh player their first rival
// A refusal carries STRUCTURED data when the way out is a concrete thing the client can offer.
// The motivating case (tester feedback 2026-08-11): every location gate said "the den is on the Neon
// Mile" and left the player to go hunting for the travel control, which lived on one tab out of 25.
// Prose alone cannot be turned into a button. `data` is merged into the 400 body, so a gate that
// names `{ district }` gets a one-tap "go there" in the client for free — at every one of the 27
// sites, rather than each having to remember to wire its own.
export class GameError extends Error {
  constructor(code, msg, data) { super(msg); this.code = code; if (data) this.data = data; }
}

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
// 40P01 deadlock, 23505 a racing first-INSERT, and 55P03 lock_timeout (a request that waited out the
// pool's lock_timeout rather than queueing on a busy row forever) are all the SAME thing to a caller:
// transient contention, safe to retry, nothing committed. Give them one honest, retryable error.
export const deadlockToRetry = (e) =>
  (e?.code === '40P01' || e?.code === '23505' || e?.code === '55P03')
    ? new GameError('contention', 'The streets got crowded for a second — try that again.') : e;

// In-process pub/sub feeding the websocket gateway (§5.6): 'me:{characterId}'
// for notifications, 'streets' for the public kill/bust feed, 'gang:{id}' updates.
export const bus = new EventEmitter();
let clueSavepoints = null; // probed once: does this DB support SAVEPOINT? (pg-mem doesn't)
bus.setMaxListeners(0);

// Write a notification row AND push it live if the player is connected.
// Delivery over the socket doesn't mark it delivered — GET /notifications does.
export async function notify(client, characterId, type, payload = {}) {
  await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
    [uid(), characterId, type, JSON.stringify(payload)]);
  bus.emit(`me:${characterId}`, { type, payload });
}

// SOLICITATIONS — the notify variant for anything one player can send another AT WILL: a mentor
// offer, a vouch, a crew invite. These differ from an event notification in one way that matters:
// a kill or a raid happens TO you and every instance is real news, whereas a solicitation is a
// button, so the same one repeated is not news — it is a megaphone. Every such call site is a free,
// uncapped, no-counterplay ping at a chosen victim (the red-team's F1/F4 class), and the shape recurs
// because each one is individually reasonable.
//
// So: if the recipient still has an UNREAD notification identical to this one, say nothing more.
// Nothing is lost — the message they have not read yet says exactly what the new one would — and the
// loop collapses to one ping until they engage. Exact-payload match on a TEXT column, which is the
// same comparison on both engines (no JSON operators, which pg-mem is unreliable about).
export async function notifyOnce(client, characterId, type, payload = {}) {
  const body = JSON.stringify(payload);
  const seen = (await client.query(
    'SELECT 1 FROM notifications WHERE character_id=$1 AND type=$2 AND payload=$3 AND NOT delivered LIMIT 1',
    [characterId, type, body])).rows[0];
  if (seen) return false;
  await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
    [uid(), characterId, type, body]);
  bus.emit(`me:${characterId}`, { type, payload });
  return true;
}

// THE FIRSTS — the announcer the leaf module calls when a trophy is claimed once, forever. Injected
// (not imported) because firsts.js sits outside this module's import graph on purpose; see its seam
// comment. A first is news the whole city should hear: the winner is told, and the streets carry it
// — this is the one achievement class where "somebody else got there" is itself the content.
__setAnnouncer(async (client, first, accountId) => {
  const who = (await client.query(
    'SELECT id, name FROM characters WHERE account_id=$1 AND alive', [accountId])).rows[0];
  if (who) await notify(client, who.id, 'first_claimed', { id: first.id, name: first.name, blurb: first.blurb });
  bus.emit('streets', { type: 'first_claimed', who: who?.name || 'somebody', first: first.name });
});

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
  // THE RECYCLE (economy v3 step 2). A $OMR sink no longer destroys the token — it hands it to the
  // desk, which sells it back at the daily auction. Design §3.3/§4.2: every sink is the house's cut,
  // so revenue ≈ sink volume × price and the KPI is how often a token comes home, not how few exist.
  //
  // It hooks HERE, at the one function every value movement passes through, and not at the ~60 sink
  // call sites. That is deliberate: a recycle you have to remember at each site is one a new sink
  // will forget, and forgetting it silently destroys supply the desk was supposed to sell — a defect
  // with no symptom until somebody asks why the auction has nothing in it. `recyclesToDesk` reads
  // the SAME `DESK.SINK_REASONS` list invariants.js builds the §10.4 burn term from, so the two can
  // never drift apart, and `withdraw:omr` is excluded because that token leaves for the chain rather
  // than into the house (see the rules block — it is the one exclusion that matters).
  //
  // §10.4: the pair (the player's −X spend, this +X) sums to ZERO inside the burn term while the
  // bucket holds the value, so conservation holds with no new term — and a HISTORICAL burn row, which
  // has no partner, still counts as the burn it was. That is what makes this safe on a live database.
  if (currency === 'omr' && amount < 0 && recyclesToDesk(reason)) {
    const back = -amount;
    await client.query('UPDATE desk_inventory SET balance = balance + $1, lifetime_in = lifetime_in + $1 WHERE id=1', [back]);
    await client.query(
      'INSERT INTO transactions (id, currency, amount, reason, counterparty) VALUES ($1,$2,$3,$4,$5)',
      [uid(), 'omr', back, DESK_RECYCLE_REASON, reason]);
  }
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
  const today = dayOf();   // bound as $4 below AND read by the work board's claimability rules
  // ONE ROUND TRIP FOR FOURTEEN LOOKUPS. This runs on EVERY authed request in the game, read or
  // write, so its round-trip count is the single largest lever on total database traffic — and
  // `tools/loadtest.js` measured the cost: `/v1/me` was ~3× a board read (15ms vs 5ms uncontended),
  // which is what a stack of sequential round trips looks like.
  //
  // Two earlier shapes, and why neither survived:
  //   * a `Promise.all` over ONE pooled client — node-pg deprecates overlapping queries on a single
  //     client and REMOVES them in pg@9, and it bought nothing anyway: one connection executes one
  //     query at a time, so pg was silently queueing them. Found by the real-Postgres probe; pg-mem
  //     has no such constraint, so the whole suite was blind to it. `tools/pgcheck.js` now FAILS on
  //     any pg deprecation warning, so that class cannot reach a deploy again.
  //   * sequential awaits — correct, but 16 network round trips to fetch 16 tiny result sets.
  //
  // So: fetch them in a single UNION ALL over a shared narrow shape and demultiplex in JS. The column
  // shape (src, k, k2, n, n2, ts) is padded with typed NULLs — proven to behave IDENTICALLY on pg-mem
  // and real Postgres. `json_agg` was the more obvious encoding and is a trap: pg-mem returns it
  // double-nested (`[[{…}]]` where Postgres gives `[{…}]`), so the suite would have passed over a
  // production bug. `to_jsonb`/`row_to_json` aren't implemented by pg-mem at all.
  //
  // Each group is mapped back to its ORIGINAL column names and types below, so `loadOwned`'s return
  // value is unchanged and no caller needed touching. The explicit `Number()` matters: a `numeric`
  // union column comes back from node-pg as a STRING (precision), where the original `int` columns
  // came back as numbers — coercing here keeps the shape identical instead of relying on all
  // fourteen downstream consumers to keep wrapping.
  //
  // `cars` and `batches` stay separate: both are `SELECT *`, so they do not fit a narrow shape, and
  // `cars` carries an ORDER BY that callers rely on.
  // EVERY null is cast, in EVERY branch — not just the first. pg-mem unifies UNION column types
  // PAIRWISE LEFT-TO-RIGHT and types a bare `NULL` as text, so a branch carrying a timestamp followed
  // by a branch with an untyped NULL in that position fails with "UNION types timestamp with time zone
  // and text cannot be matched". Postgres infers from the first branch and does not care. A 4-branch
  // spike passed precisely because its timestamp branch happened to be LAST — the shape only breaks at
  // the point where an untyped NULL follows a typed value. Casting everywhere removes the dependence on
  // either engine's inference rules, which is the only version that is safe to rely on.
  //
  // AND THE SAME LESSON A SECOND TIME, THE HARD WAY — `$3` IS `$2` AGAIN, DELIBERATELY.
  // Postgres resolves a PARAMETER's type once for the whole statement, from how it is used. `$2` is
  // first compared to `account_gear.account_id`, which this schema declares TEXT — so `$2` is text
  // everywhere, and `rival_events.victim_account = $2` is `uuid = text`, for which no operator exists.
  // The statement does not degrade: it fails to PARSE, so every branch of the union dies with it, and
  // since loadOwned runs on every authed request that is the entire game returning 500. pg-mem compares
  // uuid to text happily, so all 61 suites passed over a total production outage.
  //   The schema's account ids are genuinely mixed (28 text columns, 12 uuid), which is the underlying
  // defect; changing a live column's type is not an outage fix. So the uuid-typed branch gets its OWN
  // parameter carrying the SAME value: `$3` is inferred uuid from its only use, `$2` stays text, and
  // `ix_rival_events_victim` is still usable — casting the COLUMN instead (`victim_account::text=$2`)
  // would also parse but would throw the index away. Any future branch joining on a uuid-typed account
  // column must bind $3, not $2. `tools/pgquery.js` fails the build if this regresses.
  const bulk = await client.query(`
    SELECT 'rk' AS src, racket_id AS k, NULL::text AS k2, level::numeric AS n, NULL::numeric AS n2, NULL::timestamptz AS ts
      FROM character_rackets WHERE character_id=$1
    UNION ALL SELECT 'as', asset_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM character_assets WHERE character_id=$1
    UNION ALL SELECT 'cargo', good_id, NULL::text, qty::numeric, NULL::numeric, NULL::timestamptz FROM character_cargo WHERE character_id=$1 AND qty>0
    UNION ALL SELECT 'items', item_id, NULL::text, qty::numeric, NULL::numeric, NULL::timestamptz FROM character_items WHERE character_id=$1 AND qty>0
    -- gear splits IN-PLAY vs EXTRACTED (the owned.cars/nftCars pattern): an extracted piece is on the
    -- player's own ERC-1155 and has LEFT PLAY (rules.tail RARITY: "keep it in-game to use it (losable)
    -- or extract it on-chain (safe + tradeable, but it leaves play)") — before this split, extracted
    -- gear still fed effStat at every till, making extraction strictly free upside. The extracted list
    -- still matters: the account_gear row STAYS (PK-occupied), so re-mint and kill-loot must see it.
    UNION ALL SELECT 'gear', gear_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM account_gear WHERE account_id=$2 AND NOT minted_onchain
    UNION ALL SELECT 'gearnft', gear_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM account_gear WHERE account_id=$2 AND minted_onchain
    UNION ALL SELECT 'guns', gun_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM character_guns WHERE character_id=$1
    UNION ALL SELECT 'gm', gang_id, role, NULL::numeric, NULL::numeric, joined_at FROM gang_members WHERE character_id=$1
    UNION ALL SELECT 'mk', drug_id, NULL::text, qty::numeric, NULL::numeric, NULL::timestamptz FROM makings WHERE character_id=$1 AND qty>0
    UNION ALL SELECT 'st', drug_id, NULL::text, qty::numeric, quality::numeric, NULL::timestamptz FROM stash WHERE character_id=$1
    UNION ALL SELECT 'sk', skill_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM character_skills WHERE character_id=$1
    UNION ALL SELECT 'npc', npc_id, NULL::text, standing::numeric, NULL::numeric, touched_at FROM npc_standing WHERE character_id=$1
    UNION ALL SELECT 'grudge', npc_id, NULL::text, count::numeric, NULL::numeric, since FROM npc_grudges WHERE character_id=$1 AND count > 0
    UNION ALL SELECT 'my', track_id, NULL::text, xp::numeric, NULL::numeric, NULL::timestamptz FROM masteries WHERE character_id=$1
    UNION ALL SELECT 'trait', track_id, trait_id, NULL::numeric, NULL::numeric, NULL::timestamptz FROM character_traits WHERE character_id=$1
    UNION ALL SELECT 'est', name, NULL::text, tier::numeric, spent_omr::numeric, NULL::timestamptz FROM estates WHERE account_id=$2
    UNION ALL SELECT 'deed', name, district, NULL::numeric, NULL::numeric, claimed_at FROM street_deeds WHERE account_id=$2
    UNION ALL SELECT 'disc', discipline, NULL::text, xp::numeric, NULL::numeric, NULL::timestamptz FROM character_disciplines WHERE character_id=$1
    -- YOUR OWN TAIL. Found by playing: a placed search lived ONLY in the browser's localStorage, so a
    -- player on a second device — or one who cleared storage, or opened the installed PWA after
    -- searching on desktop — saw "nobody in the crosshairs — start a search", and starting one was
    -- refused "Your people are already out looking. Call them off first." Two surfaces flatly
    -- contradicting each other, with the one button that calls it off living on the card that no
    -- longer rendered. searches.hunter is the PK, so this branch is a free lookup; the LEFT JOIN
    -- keeps the row (and the way out) even if the mark somehow went missing.
    UNION ALL SELECT 'hunt', s.target, c.name, NULL::numeric, NULL::numeric, s.started_at
      FROM searches s LEFT JOIN characters c ON c.id = s.target WHERE s.hunter=$1
    UNION ALL SELECT 'rival', aggressor_account::text, NULL::text, NULL::numeric, NULL::numeric, at FROM rival_events WHERE victim_account=$3 AND at > now() - interval '48 hours'
    -- ...and MY OWN strikes in the same window, so the coach can tell "somebody moved on you" from
    -- "somebody moved on you AND YOU HAVE NOT ANSWERED". The rung's own hint promises that settling
    -- your scores is the move; without this branch it counted only incoming, so hitting back did not
    -- quiet it and the rung sat above the whole ladder for as long as the city kept touching you.
    -- Deliberately the SAME 48h window on both sides, which is NOT revengeOwed's semantics (that
    -- one judges honor over the full retention window): fresh malice answered a month ago is still
    -- fresh malice, and a score settled last week does not pay for a jumping this morning.
    UNION ALL SELECT 'rvback', victim_account::text, NULL::text, NULL::numeric, NULL::numeric, at FROM rival_events WHERE aggressor_account=$3 AND at > now() - interval '48 hours'
    -- THE CREW BONUS (M4.REF_XP): the CURRENT respect of every qualified recruit this account brought
    -- in. Read live rather than banked, so the bonus tracks how far the crew has actually got — a
    -- recruit who dies drops to their heir's level and the bonus falls with them. Agents and NPC
    -- residents are excluded here, at the source, so no caller can forget to.
    UNION ALL SELECT 'refx', NULL::text, NULL::text, rc.respect::numeric, NULL::numeric, NULL::timestamptz
      FROM referrals rf JOIN characters rc ON rc.account_id = rf.recruit_account AND rc.alive
      JOIN account_persistent rap ON rap.account_id = rf.recruit_account
      WHERE rf.recruiter_account = $2 AND rf.qualified_at IS NOT NULL
        AND NOT rap.agent_flag AND NOT rap.npc_flag
    -- THE WORK BOARD (omerta-early-game-design.md F1). The coach's guiding rungs are a chain of
    -- ONE-TIME milestones, so a player who follows it clears the last one around level 22 and the
    -- coach falls to four generic nudges — at exactly the level the content thins out too. These
    -- five branches are the repeatable work that is already on the table, already pays, and is
    -- currently invisible unless you go looking: today's daily contracts, tonight's hustle, the
    -- corner's envelopes, the trainers' drills, a clue in your pocket. Reading them here rather
    -- than in a second query keeps the one-round-trip property this function exists for.
    -- $4 is TODAY (int) — bound separately so its type is inferred from the day columns alone.
    -- (No backticks in here: this whole query is a JS template literal, and one would end it.)
    UNION ALL SELECT 'daily', NULL::text, claimed, NULL::numeric, NULL::numeric, NULL::timestamptz FROM daily_progress WHERE character_id=$1 AND day=$4
    UNION ALL SELECT 'hustle', NULL::text, NULL::text, step::numeric, NULL::numeric, NULL::timestamptz FROM hustles WHERE character_id=$1 AND day=$4
    UNION ALL SELECT 'corner', district, NULL::text, slot::numeric, CASE WHEN claimed THEN 1 ELSE 0 END::numeric, NULL::timestamptz FROM corner_jobs WHERE character_id=$1 AND day=$4
    UNION ALL SELECT 'drill', npc, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM npc_drills WHERE character_id=$1 AND day=$4
    -- THE CREW id, folded in here rather than its own round trip. account_id is TEXT (→ $2, like gear/
    -- est), so this branch is type-safe (the uuid=text outage class). Its only consumers are the crew
    -- non-aggression gate + the board, both reading h.owned.crewId; a scalar, so it fits the shape.
    UNION ALL SELECT 'crew', crew_id, NULL::text, NULL::numeric, NULL::numeric, NULL::timestamptz FROM crew_members WHERE account_id=$2
    UNION ALL SELECT 'clue', NULL::text, NULL::text, step::numeric, steps::numeric, NULL::timestamptz FROM clue_scrolls WHERE character_id=$1`,
  [ch.id, ch.account_id, ch.account_id, today]);
  // demultiplex — one entry per original query, in its original column names/types. Kept as
  // `{ rows: [...] }` so every reference below (`rk.rows`, `st.rows`, …) reads exactly as it did.
  const grp = new Map();
  for (const r of bulk.rows) (grp.get(r.src) || grp.set(r.src, []).get(r.src)).push(r);
  const of = (src, map) => ({ rows: (grp.get(src) || []).map(map) });
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const rk = of('rk', (r) => ({ racket_id: r.k, level: n(r.n) }));
  const as = of('as', (r) => ({ asset_id: r.k }));
  const cargo = of('cargo', (r) => ({ good_id: r.k, qty: n(r.n) }));
  const items = of('items', (r) => ({ item_id: r.k, qty: n(r.n) }));
  const gear = of('gear', (r) => ({ gear_id: r.k }));
  const gearnft = of('gearnft', (r) => ({ gear_id: r.k })); // extracted — out of play, but the PK slot is still held
  const guns = of('guns', (r) => ({ gun_id: r.k }));
  const gm = of('gm', (r) => ({ gang_id: r.k, role: r.k2, joined_at: r.ts }));
  const mk = of('mk', (r) => ({ drug_id: r.k, qty: n(r.n) }));
  const st = of('st', (r) => ({ drug_id: r.k, qty: n(r.n), quality: n(r.n2) }));
  const sk = of('sk', (r) => ({ skill_id: r.k }));
  const npc = of('npc', (r) => ({ npc_id: r.k, standing: n(r.n), touched_at: r.ts }));
  const grudge = of('grudge', (r) => ({ npc_id: r.k, count: n(r.n), since: r.ts }));
  const my = of('my', (r) => ({ track_id: r.k, xp: n(r.n) }));
  const trait = of('trait', (r) => ({ track_id: r.k, trait_id: r.k2 }));
  // THE ESTATE — account-level too (survives death; the heir inherits the compound)
  const est = of('est', (r) => ({ name: r.k, tier: n(r.n), spent_omr: n(r.n2) }));
  // STREET DEEDS — account-level too (survives death; the heir inherits the deed). A summary; the
  // /v1/deeds board is the full view (the legend + the map). Read here so runEstate's report.kept.deed
  // and the estate-report modal can name the street the bloodline keeps.
  const deed = of('deed', (r) => ({ name: r.k, district: r.k2, claimed_at: r.ts }));
  // THE REGIMEN — discipline xp per id (dies with the street; levels derived, never stored)
  const disc = of('disc', (r) => ({ discipline: r.k, xp: n(r.n) }));
  // YOUR OWN TAIL — the search you have out, read from the SERVER rather than the browser
  const hunt = of('hunt', (r) => ({ target: r.k, name: r.k2, started_at: r.ts }));
  // STREET WAR step two — fresh malice against this bloodline (last 48h): the coach's
  // someone-moved-on-you rung reads the COUNT (self-clears as the window rolls — the harness-F1
  // rule; a bounded read: shields/cooldowns bound how often anyone can be wronged in 48h)
  const rival = of('rival', (r) => ({ who: r.k, at: r.ts }));
  const rvback = of('rvback', (r) => ({ who: r.k, at: r.ts }));
  const refx = of('refx', (r) => ({ respect: Number(r.n) }));
  // THE WORK BOARD — today's repeatable work, folded into ONE shape the coach reads. Deliberately
  // COUNTS and FLAGS rather than the boards themselves: a rung only has to know there is unclaimed
  // work and what it pays, and re-deriving each system's full board here would put five modules'
  // logic in the hot path of every authed request. `claimed` is the daily-contract JSON array.
  const work = {
    // the claimed IDs, not just the count: the rung has to subtract contracts this player
    // STRUCTURALLY cannot clear (dailyBlockedFor), and doing that exactly needs to know WHICH of
    // the three are already done — a player who paid tribute and then left the family would
    // otherwise be double-counted against themselves.
    dailyClaimedIds: (() => { try { return JSON.parse(grp.get('daily')?.[0]?.k2 || '[]'); } catch { return []; } })(),
    hustleStep: grp.get('hustle')?.[0] ? Number(grp.get('hustle')[0].n) : null, // null = not started today
    // (red-team F2) OPEN is not the same as CLAIMABLE. `claimCorner` refuses on two counts, and a
    // rung that points at work the server will not pay is worse than no rung at all — it sits at the
    // head of the tail and masks every live rung under it for the rest of the day. Restated here
    // rather than imported: corner.js imports game.js, so the dependency only runs one way (the
    // advanceCampaignsInline precedent). test/growth.js pins the two against each other.
    cornerOpen: (() => {
      const rows = of('corner', (r) => ({ district: r.k, slot: Number(r.n), claimed: Number(r.n2) === 1 })).rows;
      const kindOf = (c) => (cornerTasksOf(c.district, today).find((t) => t.slot === c.slot) || {}).kind;
      const done = rows.filter((c) => c.claimed);
      if (done.length >= CORNER.MAX_DAY) return [];            // the day's allowance is spent
      const doneKinds = new Set(done.map(kindOf).filter(Boolean)); // one envelope per KIND of work
      return rows.filter((c) => !c.claimed && !doneKinds.has(kindOf(c)));
    })(),
    drillsTaken: (grp.get('drill') || []).length,
    clue: grp.get('clue')?.[0] ? { step: Number(grp.get('clue')[0].n), steps: Number(grp.get('clue')[0].n2) } : null,
  };
  const cars = await client.query('SELECT * FROM cars WHERE character_id=$1 ORDER BY created_at', [ch.id]);
  const batch = await client.query('SELECT * FROM batches WHERE character_id=$1', [ch.id]);
  const gangId = gm.rows[0]?.gang_id || null;
  // THE CREW — the lightweight social tie (account-keyed). Its only consumer is the crew
  // non-aggression gate in combat (h.owned.crewId / h.victimOwned.crewId) + the board; carried on
  // victimOwned wherever a PvP verb already reads it for family omertà.
  const crewId = grp.get('crew')?.[0]?.k || null; // folded into the UNION above (was its own query)
  // THE SHIPMENT (scarcity §3) — the bespoke pieces this bloodline has commissioned. Account-keyed,
  // so they outlive the street; read here so the board and the estate trophies see the same list.
  const bespoke = (await client.query(
    'SELECT commission_id, serial FROM bespoke_pieces WHERE account_id=$1 ORDER BY made_at', [ch.account_id])).rows;
  let gang = null, held = [];
  if (gangId) {
    gang = (await client.query('SELECT * FROM gangs WHERE id=$1', [gangId])).rows[0] || null;
    held = idList((await client.query('SELECT id FROM districts WHERE holder_gang=$1', [gangId])).rows, 'id');
  }
  // STREET DEEDS Phase 2C — the districts whose CORNER this account controls (the deed-vs-control
  // split: turf power follows CONTROL, not the paper — a rival who muscled in enjoys the perk, the
  // dispossessed owner does not). Fetched flat and filtered in JS with the SAME `deedController`
  // the corner till uses (board and till can never disagree about who runs a corner); an extracted
  // / extraction-pending deed is INERT (the car/boat rule) so it perks nobody. `deedPerk` is OR'd
  // with family turf by SET-UNION at every perk site — a district in both lists adds NOTHING —
  // and `deedSeat` (you control your OWN corner) is the +1 operation seat, capped at SLOTS_MAX.
  let deedPerk = [], deedSeat = false;
  if (DEEDS.PERK_TURF || DEEDS.PERK_OP_SLOTS) {
    const now = Date.now();
    const drows = (await client.query(
      'SELECT district, account_id, controller_account, control_until, onchain_token_id FROM street_deeds WHERE account_id=$1 OR controller_account=$1',
      [ch.account_id])).rows.filter((d) => !d.onchain_token_id && deedController(d, now) === ch.account_id);
    deedPerk = DEEDS.PERK_TURF ? [...new Set(drows.map((d) => d.district))] : [];
    deedSeat = drows.some((d) => d.account_id === ch.account_id);
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
    // ASSETS & RACKETS → Tier 4 — per-racket upgrade levels (folded into accrual income)
    racketLevels: Object.fromEntries(rk.rows.map((r) => [r.racket_id, Number(r.level || 0)])),
    // THE RARITY NFTs (v3 step 7) — THE ONE PLACE "extracted is inert" is enforced, and deliberately
    // so. An extracted car is an ERC-1155 in the player's own wallet; keeping it in `owned.cars`
    // would mean remembering a guard at melt, fence, repair, the garage cap, the vanity plate, the
    // strip, tuning, a pink-slip race, a loan pledge, a market listing, a chop and the net-worth
    // roll-up — and one forgotten site is a car that is safe AND still earning, which collapses the
    // choice the whole mechanic is. Filtering here makes every one of those refuse it by default
    // (`no_car`), including the ones written after this line. `victimOwned` is the same function, so
    // the chop and the death report inherit it: an extracted car is not in the fleet a killer values,
    // and not in the count the car-conservation invariant reads out of death telemetry.
    cars: cars.rows.filter((c) => !c.minted_onchain),
    nftCars: cars.rows.filter((c) => c.minted_onchain), // out of play: the board renders them, nothing else may touch them
    cargo: cargoMap(cargo.rows), items: itemMap(items.rows),
    gear: idList(gear.rows, 'gear_id'), guns: idList(guns.rows, 'gun_id'),
    gearOnchain: idList(gearnft.rows, 'gear_id'), // extracted gear: boosts nothing, but blocks a re-mint and dedupes kill-loot (the row still holds the PK)
    gangId, gangRole: gm.rows[0]?.role || null, gangJoinedAt: gm.rows[0]?.joined_at || null, gang, held,
    deedPerk, deedSeat, // STREET DEEDS 2C — controlled-corner districts (turf perk) + the own-corner op seat
    crewId,   // THE CREW — the non-aggression gate reads this off owned/victimOwned (combat.js)
    bespoke,  // THE SHIPMENT — commissioned pieces (account-level status, survives death)
    makings: Object.fromEntries(mk.rows.map((r) => [r.drug_id, Number(r.qty)])),
    stash: st.rows.map((r) => ({ drug_id: r.drug_id, qty: Number(r.qty), quality: Number(r.quality) })),
    batch: batch.rows[0] || null,
    skills: new Set(sk.rows.map((r) => r.skill_id)), // the build — dies with the street
    // THE REGIMEN — discipline xp map (id → xp); the cap helpers read it (dies with the street)
    disciplines: Object.fromEntries(disc.rows.map((r) => [r.discipline, Number(r.xp)])),
    // YOUR OWN TAIL — the one search you have out (searches.hunter is the PK, so at most one row).
    // The mark's name is a display convenience; a NULL one means the street is gone, and the card
    // still has to render, because the way to call the search off lives on it.
    hunt: hunt.rows[0] || null,
    // THE TRADES — use-XP per track (omerta-mastery-design.md). Dies with the street (a
    // HEIR_KEEP_BPS echo carries); XP is not a currency, so nothing here touches §10.4.
    mastery: Object.fromEntries(my.rows.map((r) => [r.track_id, Number(r.xp)])),
    traits: Object.fromEntries(trait.rows.map((r) => [r.track_id, r.trait_id])), // the level-50 choices (step two)
    // who you know — dies with the street. Idle friendships COOL (Underworld step two): the
    // EFFECTIVE standing is what everyone reads; the stored row catches up on the next bump.
    npc: Object.fromEntries(npc.rows.map((r) => [r.npc_id, decayedStanding(Number(r.standing), r.touched_at)])),
    // step four: open grudges cap the tier; step five: time heals them — the EFFECTIVE count
    // is what everything reads, the stored row catches up on the next write
    grudges: Object.fromEntries(grudge.rows
      .map((r) => [r.npc_id, decayedGrudges(Number(r.count), r.since)])
      .filter(([, c]) => c > 0)),
    work, // THE WORK BOARD — today's unclaimed repeatable work, for the coach's never-empty tail
    estate: est.rows[0] || null, // account-level compound (survives death) — a summary; the board is the full view
    deed: deed.rows[0] || null,  // account-level street deed (survives death) — a summary; /v1/deeds is the full view
    // STREET WAR step two — fresh malice in the last 48h that you have NOT answered. Counted per
    // aggressor (their strikes on me vs mine on them, same window) and folded in JS: two flat lists,
    // never a correlated subquery (the pg-mem posture). Answering every one of them takes the rung
    // to 0 and it goes quiet — which is what makes it safe to sit where it does, above the whole
    // ladder: a rung that never clears must never mask rungs that do.
    recentRivals: (() => {
      const back = new Map();
      for (const r of rvback.rows) back.set(r.who, (back.get(r.who) || 0) + 1);
      const hit = new Map();
      for (const r of rival.rows) hit.set(r.who, (hit.get(r.who) || 0) + 1);
      let owed = 0;
      for (const [who, n] of hit) if (n > (back.get(who) || 0)) owed++;
      return owed;
    })(),
    // THE CREW BONUS: computed once here, read synchronously by gainRespect at ~a dozen sites.
    refBonus: referralXpBonus(refx.rows.map((r) => levelOf(r.respect))),
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
    // THE REGIMEN — Work the Room: +1 daily standing budget per presence level (the cap is the
    // spammable-part bound; presence widens what an ENGAGED day can earn, never what a script can)
    const presenceLvl = disciplineLvlOf(Number(h.owned?.disciplines?.presence || 0));
    const capped = Math.min(pts, Math.max(0, UNDERWORLD.STANDING_DAILY_CAP + (presenceLvl - 1) - gained));
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
        await notify(client, ch.id, 'errand_done', { npc: npcOf(npcId)?.name || npcId, bonus: UNDERWORLD.STEP5.CHAIN_BONUS });
        bus.emit('streets', { type: 'errand_done', who: ch.name, npc: npcOf(npcId)?.name || npcId }); // the town hears who did right by whom
      } else {
        await client.query('UPDATE npc_errands SET step=$2, last_day=$3 WHERE character_id=$1', [ch.id, step, day]);
        await notify(client, ch.id, 'errand_step', { npc: npcOf(npcId)?.name || npcId, step, of: UNDERWORLD.STEP5.CHAIN_STEPS });
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

// ═══ THE TRADES — the mastery XP funnel (omerta-mastery-design.md) ═══
// The bumpStanding twin: ONE shared helper with action tags, called inline at the verb sites, so
// the rules live in exactly one place (path XP-rate mults land here in step 3, the stat drip in
// step 4 — every future modifier composes inside this funnel, never at a call site).
//
// XP is NOT a currency — this writes zero `transactions` rows, so §10.4 has no surface here. It
// pays ZERO respect and gates ZERO character levels (respect stays the only level currency — the
// level-240 speedrun class). Every award is throttled by the action's own nerve/energy/cash/
// cooldown cost: there is no new farm loop, only new reward for the existing ones.
//
// Storage is the npc_standing discipline: NUMERIC, absolute writes computed in JS under the
// caller's char lock, UPDATE-then-INSERT upsert, in-memory mirror so same-txn reads stay honest.
// `h` may be null for HEADLESS callers (crew members paid by direct row updates under lock — the
// heist-crew pattern): then `cur` is read by SQL and no mirror is written.
// THE TRADES step two — the milestone-perk reader (the skillMult twin). Returns the perk axis
// value for the highest milestone this street's TRACK LEVEL has reached (1 = no perk yet); the
// VIRTUOSO trait at level 50 deepens to fx[3]. Reads the loadOwned cache only — a caller without
// h (headless) gets the neutral 1, which is always safe (perks are strictly optional modifiers).
export function masteryFx(h, trackId) {
  const p = MASTERY.PERKS[trackId];
  if (!p || !h?.owned?.mastery) return 1;
  const lvl = masteryLvlOf(Number(h.owned.mastery[trackId] || 0));
  if (lvl >= MASTERY.MAX_LVL && h.owned.traits?.[trackId] === 'virtuoso') return p.fx[3];
  let i = -1;
  for (const m of MASTERY.MILESTONES) if (lvl >= m) i++;
  return i < 0 ? 1 : p.fx[i];
}

export async function bumpMastery(client, h, ch, trackId, action) {
  const track = MASTERY.TRACKS.find((t) => t.id === trackId);
  // PATHS v2 — a home trade schools ×1.5, a rival ×0.6 (fractional XP is fine: NUMERIC column,
  // and rounding would erase the rival penalty on 1-XP actions or zero them out entirely)
  const xp = Number(MASTERY.XP[action] || 0) * pathXpMult(ch, trackId);
  if (!track || !(xp > 0)) return null;   // defensive — a bad tag must never fail the action
  const cur = h?.owned?.mastery
    ? Number(h.owned.mastery[trackId] || 0)
    : Number((await client.query('SELECT xp FROM masteries WHERE character_id=$1 AND track_id=$2',
        [ch.id, trackId])).rows[0]?.xp || 0);
  const before = masteryLvlOf(cur);
  const next = cur + xp;
  const upd = await client.query('UPDATE masteries SET xp=$3 WHERE character_id=$1 AND track_id=$2',
    [ch.id, trackId, next]);
  if (!upd.rowCount) {
    await client.query('INSERT INTO masteries (character_id, track_id, xp) VALUES ($1,$2,$3)',
      [ch.id, trackId, next]);
  }
  if (h?.owned?.mastery) h.owned.mastery[trackId] = next;
  // the lifetime legend — account-level, survives death whole (pure status). NUMERIC + bound-param
  // ADDITION is pg-mem-safe (the quirk is INT subtraction only — AUDIT-full-sweep).
  const lu = await client.query('UPDATE mastery_legend SET xp = xp + $3 WHERE account_id=$1 AND track_id=$2',
    [ch.account_id, trackId, xp]);
  if (!lu.rowCount) {
    await client.query('INSERT INTO mastery_legend (account_id, track_id, xp) VALUES ($1,$2,$3)',
      [ch.account_id, trackId, xp]);
  }
  const after = masteryLvlOf(next);
  if (after > before) {
    await notify(client, ch.id, 'mastery_up', { track: trackId, name: track.name, lvl: after, rank: masteryRankOf(after) });
    // THE FIRSTS — the top of a trade is a race that ends. Hooked at the CROSSING (not at every
    // bump past the cap) so it costs one PK read on the single tick that reaches MAX_LVL, and never
    // again. Best-effort by construction: claimFirst can never fail the action that earned it.
    if (after >= MASTERY.MAX_LVL && ch.account_id) {
      await claimFirst(client, ch.account_id, `mastery:${trackId}`, { name: ch.name });
    }
  }
  // THE BROKERS — record the raw ACTION COUNT for the epoch allocator (omerta-brokers-design.md).
  //
  // Hooked HERE rather than at the 24 call sites, for the reason the desk recycle is hooked in
  // `ledger`: a recorder you have to remember at each site is one a new action will forget, and a
  // missed action is a player silently under-paid.
  //
  // ⚠ COUNTS, NOT `xp`. `xp` above has already been through `pathXpMult`, and ACTIVITY's whole
  // structural guarantee is that it reads action counts × the BASE award — never XP actually
  // granted — so no progression multiplier anywhere can propagate into the distribution key. Writing
  // `xp` here would breach the staking wall that `test/activity.js` pins.
  if (ACTIVITY.TAGS.includes(action) && ch.account_id) {
    const day = dayOf();
    const au = await client.query(
      'UPDATE activity_log SET n = n + 1 WHERE account_id=$1 AND day=$2 AND tag=$3',
      [ch.account_id, day, action]);
    if (!au.rowCount) {
      await client.query(
        'INSERT INTO activity_log (account_id, day, tag, n) VALUES ($1,$2,$3,1)',
        [ch.account_id, day, action]);
    }
  }
  // STEP FOUR — STATS BY USE (founder-signed: "yes, tightly capped"). Working the trade exercises
  // its stat: a small roll per XP-paying action, on the GYM'S OWN diminishing factor, metered by a
  // hard rolling daily bucket. Actor path (h) ONLY — headless callers (duel opponents, heist crew)
  // hold locked rows and write specific columns absolutely; a stat bump there would never persist,
  // so the drip is honestly skipped rather than silently lost.
  let statGain = 0;
  if (h && track.stat) {
    const now = Date.now();
    const refill = ch.statuse_at
      ? (now - new Date(ch.statuse_at).getTime()) / 86400000 * MASTERY.STAT_USE.CAP_DAY
      : MASTERY.STAT_USE.CAP_DAY;
    const used = Math.max(0, Number(ch.statuse_used || 0) - Math.max(0, refill));
    // charge only if the FULL unit fits (the D3 wash-gate form) — a strict `used < CAP` would pass
    // at 3−ε moments after the third gain, leaking a CAP+1 burst
    if (used + 1 <= MASTERY.STAT_USE.CAP_DAY) {
      // TEST-ONLY roll knob (the LAW_BUST_P precedent — never set in production); read per-call
      const dim = MASTERY.STAT_USE.GYM_DIM / (MASTERY.STAT_USE.GYM_DIM + Number(ch[track.stat] || 0));
      const p = process.env.STAT_USE_P != null
        ? Number(process.env.STAT_USE_P)
        : Math.min(0.5, MASTERY.STAT_USE.P_PER_XP * xp * dim);
      const roll = Math.random();
      await rngLog(client, ch.id, `statuse:${trackId}`, roll,
        `${roll < p ? `+1 ${track.stat}` : 'no gain'} (P ${p.toFixed(3)}, ${track.stat} ${ch[track.stat]})`);
      if (roll < p) {
        statGain = 1;
        ch[track.stat] = Number(ch[track.stat]) + 1; // persisted positionally by the caller (the train() shape)
        // charge the bucket — direct SQL under the held char lock (the port_used pattern) + ch mirror
        await client.query('UPDATE characters SET statuse_used=$2, statuse_at=$3 WHERE id=$1',
          [ch.id, used + 1, new Date(now)]);
        ch.statuse_used = used + 1; ch.statuse_at = new Date(now);
        await notify(client, ch.id, 'stat_use', { track: trackId, stat: track.stat, value: ch[track.stat] });
      }
    }
  }
  return { track: trackId, xp, lvl: after, leveled: after > before, statGain: statGain || undefined };
}

// ═══ THE CREW OBJECTIVE — the weekly shared goal, advanced by a crewmate's own play (the bumpMastery
// twin; lives here so the import graph stays acyclic — crew.js imports game.js one-way, and the three
// hook sites (doCrime, the fire kill in combat.js) call this). `deltas` is a contributions map
// {crimes?, kills?, earn?}; only the WEEK'S DRAWN kind increments, so each hook passes whatever it can
// offer and the draw decides what counts. Reads the loaded crewId off h.owned — solo/headless is a
// clean no-op. When the target is cracked, EVERY member is pinged (the synchronous "your crew is
// active" moment) and the crew legend is bumped once. ═══
export async function bumpCrewObjective(client, h, ch, deltas) {
  const crewId = h?.owned?.crewId;
  if (!crewId || !deltas) return null;
  const week = weekOf();
  // materialize this week's objective (deterministic kind+target, scaled by crew size) if absent —
  // idempotent INSERT (a concurrent first-touch loses the race harmlessly, the world_npcs precedent).
  // (red-team R28 #4) lock the objective row FOR UPDATE so two crewmates bumping concurrently (each under
  // its OWN char lock, so they don't otherwise serialize) can't both compute a stale SUM and store an
  // under-counted `progress` / delay the completion a bump. Consistent order: char (held) → crew_objectives.
  let obj = (await client.query('SELECT kind, target, progress, done FROM crew_objectives WHERE crew_id=$1 AND week=$2 FOR UPDATE', [crewId, week])).rows[0];
  if (!obj) {
    const members = Number((await client.query('SELECT COUNT(*) n FROM crew_members WHERE crew_id=$1', [crewId])).rows[0].n) || 1;
    const drawn = crewObjectiveOf(crewId, week, members);
    await client.query('INSERT INTO crew_objectives (crew_id, week, kind, target) VALUES ($1,$2,$3,$4) ON CONFLICT (crew_id, week) DO NOTHING', [crewId, week, drawn.kind, drawn.target]);
    obj = (await client.query('SELECT kind, target, progress, done FROM crew_objectives WHERE crew_id=$1 AND week=$2 FOR UPDATE', [crewId, week])).rows[0];
  }
  const add = Math.floor(Number(deltas[obj.kind] || 0));
  if (!(add > 0)) return null;   // this hook doesn't feed the drawn kind
  // The week's job is CRACKED — work done after it doesn't buy a share of it. A cut is earned by a
  // `crew_objective_progress` row, and that row was minted by ANY qualifying action, `done` or not: so a crew
  // could crack the objective shorthanded, fill the roster afterwards, and each arrival's single crime would
  // mint them a row and therefore a full REWARD share of a job they did nothing to finish. The claim gate
  // ("you didn't work this week's job") is what this restores — it was true only until the moment it stopped
  // being enforceable. Existing contributors keep the rows they earned.
  if (obj.done) return { kind: obj.kind, total: Number(obj.progress), target: Number(obj.target), done: true };
  // credit the member's contribution (the texture the board shows) — absolute-safe upsert
  const up = await client.query('UPDATE crew_objective_progress SET n = n + $4 WHERE crew_id=$1 AND week=$2 AND account_id=$3', [crewId, week, ch.account_id, add]);
  if (!up.rowCount) await client.query('INSERT INTO crew_objective_progress (crew_id, week, account_id, n) VALUES ($1,$2,$3,$4) ON CONFLICT (crew_id, week, account_id) DO UPDATE SET n = crew_objective_progress.n + $4', [crewId, week, ch.account_id, add]);
  // the crew total (= Σ contributions) — the authoritative progress the completion is judged on
  const total = Number((await client.query('SELECT COALESCE(SUM(n),0) s FROM crew_objective_progress WHERE crew_id=$1 AND week=$2', [crewId, week])).rows[0].s);
  await client.query('UPDATE crew_objectives SET progress=$3 WHERE crew_id=$1 AND week=$2', [crewId, week, total]);
  // crossing the target — fire the completion ONCE (the `done` latch), ping every living member, and
  // bump the crew legend. Pure notification here; the cash cut is CLAIMED per member (crew.js).
  if (!obj.done && total >= Number(obj.target)) {
    const claim = await client.query('UPDATE crew_objectives SET done=true WHERE crew_id=$1 AND week=$2 AND NOT done RETURNING crew_id', [crewId, week]);
    if (claim.rowCount) {
      await client.query('UPDATE crews SET objectives_done = objectives_done + 1 WHERE id=$1', [crewId]);
      const mem = (await client.query("SELECT c.id FROM crew_members cm JOIN characters c ON c.account_id=cm.account_id AND c.alive WHERE cm.crew_id=$1", [crewId])).rows;
      for (const m of mem) await notify(client, m.id, 'crew_objective_done', { reward: CREW.OBJECTIVE.REWARD }).catch(() => {});
      bus.emit(`crew:${crewId}`, { type: 'crew_objective_done' });
    }
  }
  return { kind: obj.kind, total, target: Number(obj.target) };
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
    // TIER-4 — THE COMMANDER LEGEND: a successful assisted job banks a lifetime notch (account-level,
    // survives death; direct SQL off the positional persist — the duel_wins/heists_pulled twin)
    await client.query('UPDATE account_persistent SET soldiers_led = soldiers_led + 1 WHERE account_id=$1', [ch.account_id]);
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
// §9 search clock — how long the hunter's people take to place a mark, the FOUR stacks and all.
// Lives here rather than in combat.js because THREE readers need it and one of them is the
// character view: startSearch quotes it back, fire enforces it, and the sheet counts it down.
// game.js cannot import combat.js (combat imports game, one way), and a second copy of a
// four-way stack is exactly how two clocks come to disagree — so the formula is here, where
// every term it multiplies already lives, and all three readers import the one implementation.
// SEARCH_MS is read per call: a TEST-ONLY knob, never set in production (preflight refuses it).
export const hunterSearchMs = (h, ch) => Math.floor(Number(process.env.SEARCH_MS || CONSTANTS.SEARCH_MS)
  * skillMult(h, 'executioner', SKILLS.FX.SEARCH_MULT)
  * npcMult(h, 'fixer', 3, UNDERWORLD.FX.SEARCH_MULT)
  * masteryFx(h, 'wetwork') // TRADES perk — a third stack on the clock (0.72 → 0.54 fully built; flagged)
  * pathFx(ch, 'searchClock')); // PATHS v2 — the Shadow's perk is a FOURTH stack (0.46 fully built; flagged)

// trunk capacity incl. the Pack Mule bonus — use this, not cargoCapacity(), on player paths
export const trunkCap = (h) => cargoCapacity(h.owned.assets)
  + (hasSkill(h, 'pack_mule') ? SKILLS.FX.TRUNK_BONUS : 0)
  + (hasSkill(h, 'road_boss') ? SKILLS.FX.ROAD_BOSS_TRUNK : 0) // step-two capstone: even bigger haul
  + ladderFx(h.acct, 'trunk');                                  // THE LADDER (D8=D) — held $OMR carries more

// The IN-MEMORY half of accrual. accrue() itself is pure — accrual.js makes zero database calls, it
// only mutates the loaded rows and leaves markers (_accruedIncome, _raid, …) for the caller to write.
// Splitting the two halves is what lets a pure read accrue without a transaction and decide, from the
// result, whether it has anything worth persisting at all.
export function accrueInMemory(ch, acct, owned) {
  accrue(ch, acct, { rackets: owned.rackets, assets: owned.assets, held: owned.held, stash: owned.stash,
    deedHeld: owned.deedPerk, // STREET DEEDS 2C — controlled corners count at accrual's two perk reads (cathedral nerve, neon income)
    racketLevels: owned.racketLevels, // Tier-4 — per-racket upgrade levels multiply the drip
    disciplines: owned.disciplines, // THE REGIMEN — stamina/composure raise the regen CAPS (pool, not rate)
    foundationTier: owned.gang?.foundation || 0 }); // THE FOUNDATION step two: the family charity speeds the exposure bleed
}

// Did accrual actually move anything? accrue() returns early under one second, so a client polling
// every few seconds changes NOTHING — but the two Make-Risk-Pay releases (a cleared bank deposit, an
// unbonded stake) sit ABOVE that early return and run on the wall clock, so "no time passed" is not
// the same question as "nothing happened". Fingerprint all three.
const accrualMark = (ch, acct) =>
  `${+new Date(ch.last_accrued_at)}|${Number(ch.bank_intransit || 0)}|${Number(acct?.unbonding || 0)}`;

async function accrueAndLedger(client, ch, acct, owned) {
  accrueInMemory(ch, acct, owned);
  // §7.1 accrued racket/front income is a faucet — record it so the ledger balances
  if (ch._accruedIncome > 0) {
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._accruedIncome, reason: 'racket:income' });
    // THE TYCOON LEGEND (Tier-4) — lifetime racket + front income (account-level, survives death;
    // NUMERIC arith → pg-mem-safe; off the persistAccount column list, so clobber-safe)
    await client.query('UPDATE account_persistent SET tycoon_earned = tycoon_earned + $1 WHERE account_id=$2',
      [ch._accruedIncome, ch.account_id]);
  }
  // ledger the EXACT interest applied (any positive delta) — gating at ≥ $0.01 left
  // sub-cent interest on the bank balance with no matching row, a slow §10.4 drift
  if (ch._bankInterest > 0)
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._bankInterest, reason: 'bank:interest' });
  // §7.1 crew sales are a faucet too; the raid is logged, notified, and telemetered
  if (ch._crewSale?.proceeds > 0) {
    await ledger(client, { characterId: ch.id, currency: 'cash', amount: ch._crewSale.proceeds, reason: 'crew:sales' });
    // THE KINGPIN LEGEND (Tier-4) — offline crew sales count toward lifetime product moved (status,
    // account-level, survives death; NUMERIC arith → pg-mem-safe; off the persistAccount column list)
    await client.query('UPDATE account_persistent SET product_moved = product_moved + $1 WHERE account_id=$2',
      [Math.floor(ch._crewSale.proceeds), ch.account_id]);
  }
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
  // perf: one multi-row INSERT per table instead of a per-drug-type INSERT loop (runs on every write).
  // Bounded by distinct drug types, but this collapses 2+N write statements to 2+2 (a delete + one
  // batched insert each, skipped entirely when there is nothing to write).
  await client.query('DELETE FROM stash WHERE character_id=$1', [ch.id]);
  const stashRows = owned.stash.filter((s) => Number(s.qty) > 0);
  if (stashRows.length) {
    const vals = [], params = [ch.id];
    for (const s of stashRows) { const b = params.length; params.push(s.drug_id, s.qty, s.quality); vals.push(`($1,$${b + 1},$${b + 2},$${b + 3})`); }
    await client.query(`INSERT INTO stash (character_id, drug_id, qty, quality) VALUES ${vals.join(',')}`, params);
  }
  await client.query('DELETE FROM makings WHERE character_id=$1', [ch.id]);
  const mkRows = Object.entries(owned.makings).filter(([, qty]) => qty > 0);
  if (mkRows.length) {
    const vals = [], params = [ch.id];
    for (const [drugId, qty] of mkRows) { const b = params.length; params.push(drugId, qty); vals.push(`($1,$${b + 1},$${b + 2})`); }
    await client.query(`INSERT INTO makings (character_id, drug_id, qty) VALUES ${vals.join(',')}`, params);
  }
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
// ── THE CREW BONUS applied (M4.REF_XP, founder-directed 2026-07-31) ──────────────────────────────
// Every respect gain in the game goes through here. A recruiter earns faster in proportion to how far
// the crew they brought in has got — the replacement for the retired referral $OMR.
//
// ONE helper rather than the multiplier inlined at a dozen sites: the sites are spread over six
// modules, and a bonus that some of them apply and others quietly do not is worse than no bonus at
// all (it makes the number on the board a lie). `h` is optional so the headless paths — a duel
// opponent, a heist crew member written under their own lock — degrade to the plain amount rather
// than throwing; they have no loaded context to read a bonus from, and inventing one would be worse
// than paying the base.
//
// Zero §10.4: respect is not a currency and writes no ledger row.
export function gainRespect(h, ch, rep) {
  const bonus = Number(h?.owned?.refBonus) || 0;
  const gained = bonus > 0 ? Math.round(Number(rep) * (1 + bonus)) : Number(rep);
  const before = levelOf(Number(ch.respect));
  ch.respect = Number(ch.respect) + gained;
  const after = levelOf(Number(ch.respect));
  // F4 — THE LEVEL-UP MOMENT (omerta-early-game-design.md). Crossing a level refills energy and
  // nerve to their newly-raised caps, so the moment you go up you can keep playing rather than
  // watch a bar. §10.4-FREE: both are pure regen resources (the skills `adrenaline` precedent) —
  // no currency moves, no faucet, no ledger row. Only on the ACTOR path (`h` present): a headless
  // grant — a heist crew member, a duel opponent — is written by absolute UPDATE on named columns,
  // so a refill of the in-memory row would be silently dropped, and a reward that sometimes
  // vanishes is worse than one that is consistently absent.
  //
  // THE CEILING (see PACING (6)). The refill is a nerve FAUCET — size = the cap, rate = how often
  // you level — and past level ~90 a crossing hands back more nerve than the next level costs, so
  // the wall this whole block builds stops existing. A rolling daily bucket (the wash-cap /
  // safehouse-cap pattern) bounds it by construction at MAX_DAY × cap nerve a day, which is ~1.35
  // levels per refill AT ANY LEVEL, while leaving the early sitting — where you cross several
  // levels an hour and the reward is the point — completely untouched. Spending the bucket is
  // SILENT: the refill is a gift, and a gift that scolds you for taking it too often is worse than
  // one that simply stops. Regen still runs; only the free top-up is metered.
  if (after > before && h && PACING.LEVEL_UP_REFILL) {
    const cap = PACING.LEVEL_UP_REFILL_MAX_DAY;
    let allow = true;
    if (cap > 0) {
      const refill = ch.refill_at ? (Date.now() - new Date(ch.refill_at).getTime()) / 86400000 * cap : cap;
      const used = Math.max(0, Number(ch.refill_used || 0) - Math.max(0, refill));
      allow = used + 1 <= cap;
      if (allow) { ch.refill_used = used + 1; ch.refill_at = new Date(); }
      else { ch.refill_used = used; ch.refill_at = new Date(); }
    }
    if (allow) {
      ch.energy = energyCapOf(after, assetEnergyCap(h.owned?.assets || []), h.owned?.disciplines, ladderFx(h?.acct, 'energy'));
      ch.nerve = nerveCapOf(after, h.owned?.disciplines, ladderFx(h?.acct, 'nerve'));
    }
  }
  if (after > before) ch._leveled = { from: before, to: after, rank: RANKS[rankIdxOf(after)].name };
  return gained;
}

export async function withCharacter(pool, accountId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // THE DEATH RACE. Found by playing: get killed with the tab open and the very next request
    // comes back `400 no_character — "Create a character first."` to a player whose heir is
    // standing right there. It is not a logic bug, it is READ COMMITTED: a `SELECT … FOR UPDATE`
    // that BLOCKS on the dying row re-evaluates its WHERE against the NEW row version when the
    // killer commits — `alive` is now false so the row drops out — and the heir INSERTed by that
    // same commit is not in this statement's snapshot, so it is not picked up either. Zero rows.
    //
    // It fires at the worst moment (the client refreshes ON the `whacked` event, straight into the
    // window) and it LIES in the way this codebase has now corrected three times: an ordinary game
    // state reported as a broken one. `boot()` renders any non-2xx as THE LINE'S DEAD, so a player
    // who reloads there is told the city's records are unreachable; an agent is told to create a
    // character it already has. No suite can see it — pg-mem is single-caller.
    //
    // The remedy for the artifact is simply to look again: a second statement takes a fresh
    // snapshot and finds the heir. Nothing has happened in this transaction yet (this is its first
    // statement), so re-running is clean, and an action in flight when you die lands on your heir —
    // exactly as if it had been clicked a moment later, with every gate still applying. Only a
    // genuinely characterless account reaches the throw.
    //
    // THE CLASS WAS SWEPT, and this is its only instance (RT#7's rule — a class fixed only where it
    // was discovered is half-fixed). ~40 other `FOR UPDATE` selects in src/ carry a MUTABLE predicate
    // and could take the same artifact; every one is fail-safe, in three shapes. (a) The zero-row
    // answer is simply TRUE — the target really is dead (`id=$1 AND alive`), the lot really did
    // settle (`status='live'`), the pot really did expire (`expires_at > now()`) — so a correct
    // refusal, and a false negative is impossible: a blocker that rolls back leaves the pre-image,
    // which the re-evaluation sees. (b) The zero-row path PARKS the value rather than dropping it
    // (store.js's wire days → `wire_pending_days`, applied at the heir's birth). (c) It rolls back
    // with nothing consumed (mintCharacter/rerollCharacter leave the paid credit on the ACCOUNT, so
    // a retry works), or it is a worker sweep whose skipped row comes round again next tick. What
    // made THIS one a defect rather than a message is that withCharacter is the wrapper every authed
    // request passes through, so the artifact took the whole app to boot()'s dead-end screen.
    let r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive FOR UPDATE', [accountId]);
    if (!r.rows.length) r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive FOR UPDATE', [accountId]);
    if (!r.rows.length) throw new GameError('no_character', 'Create a character first.');
    const ch = r.rows[0];
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id = $1 FOR UPDATE', [accountId])).rows[0];
    const owned = await loadOwned(client, ch);
    await accrueAndLedger(client, ch, acct, owned);

    // `pool` is here for ONE purpose: an out-of-band write that must survive this transaction's
    // ROLLBACK (the X-check throttle — see verify.js:throttleXCheck for why). It autocommits,
    // because it is a DIFFERENT connection. That is also why it is a hazard: taking a second
    // connection while this one holds row locks can exhaust the pool under load and deadlock it
    // against itself. Use `client` for everything that belongs to the action.
    const h = { ledger, rngLog, notify, track, bumpDaily, events: [], acct, owned, accountId, pool };
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
    // THE AHA MOMENT — assign a fresh player their first rival once they find their feet (post-commit,
    // non-fatal — the referral-hook discipline; a cheap stage-0 pre-check makes the common case one read).
    // Fires for EVERY player (not just referred), so it sits outside the referral block. Emits live so
    // the cinematic lands promptly rather than on the next poll.
    try {
      const fb = await startFirstBlood(pool, accountId);
      if (fb) bus.emit(`me:${fb.characterId}`, { type: 'first_blood', payload: fb.payload });
    } catch (e) { console.error('first blood (post-commit, non-fatal)', e?.code || e); }
    // (red-team R4 idempotency finding-2) the action has COMMITTED — a post-commit RENDER failure
    // (view()/coachLadder on a corrupt column) must NOT surface a non-2xx, or the idempotency hook releases
    // the key → a retry re-executes the committed action (double-spend). Degrade the snapshot, never the
    // success — same discipline as the referral post-commit hooks above.
    let character = null;
    try { character = view(ch, acct, owned); } catch (e) { console.error('view render (post-commit, non-fatal)', e?.code || e); }
    return { character, events: h.events, ...result };
  } catch (e) { await client.query('ROLLBACK'); throw deadlockToRetry(e); }
  finally { client.release(); }
}

// A pure-read GET does not need the write lock — but it cannot simply skip accrual either, because
// §7.1 accrual is GAMEPLAY, not bookkeeping: it fires the Bureau raid, which sets jail_until. Reads
// are what land that on an idle player. Two earlier designs tried to make reads never persist and
// both were rejected on measurement (see SPEC.md D1) — pg-mem implements no SAVEPOINT syntax at all,
// and pg-mem's ROLLBACK is a no-op, so a "roll the action back and re-settle" scheme applied accrual
// twice and drifted §10.4 in every suite while passing them.
//
// So this takes the cut that needs neither: accrue IN MEMORY with no lock, then look at what moved.
//
//   • Nothing moved  → there is nothing to persist. Return having taken NO lock and written NOTHING.
//   • Something moved → hand off to withCharacter, which re-reads under FOR UPDATE and behaves
//                       exactly as it always has, raid included.
//
// Every outcome is therefore either "changed nothing, wrote nothing" or "the audited path, verbatim".
// There is no third behaviour to reason about, no new schema, and no new failure mode.
//
// This is aimed squarely at the measured symptom: production showed four of ONE player's requests
// queued on their own row for 1.0s/2.1s/2.3s/4.3s. Requests that close together are precisely the
// case where accrue() hits its one-second early return and does nothing — so exactly the traffic that
// was piling up stops taking the lock. A read after a real gap still takes it, and is no worse than
// before. (A compare-and-swap could make even those lock-free; it needs a version column, because
// last_accrued_at round-trips through node-pg at millisecond precision and would never match
// Postgres's microseconds. Left for later — this cut carries the measured win without that risk.)
export async function withCharacterRead(pool, accountId, fn) {
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT * FROM characters WHERE account_id = $1 AND alive', [accountId]);
    if (!r.rows.length) throw new GameError('no_character', 'Create a character first.');
    const ch = r.rows[0];
    const acct = (await client.query('SELECT * FROM account_persistent WHERE account_id = $1', [accountId])).rows[0];
    const owned = await loadOwned(client, ch);

    const before = accrualMark(ch, acct);
    accrueInMemory(ch, acct, owned);
    if (accrualMark(ch, acct) !== before) return null; // caller re-runs under the lock (see below)

    // Nothing accrued, so nothing to write. The handler gets a client that REFUSES to write: these
    // routes are only ever registered here because they were verified side-effect free, and a guard
    // turns a future mistake into a loud failure instead of a silent unaudited write — one that
    // would land outside any transaction, since there is no BEGIN on this path.
    const h = { ledger, rngLog, notify, track, bumpDaily, events: [], acct, owned, accountId, readOnly: true };
    const result = await fn(ch, readOnlyClient(client), h);
    let character = null;
    try { character = view(ch, acct, owned); } catch (e) { console.error('view render (read, non-fatal)', e?.code || e); }
    return { character, events: h.events, ...result };
  } catch (e) { throw deadlockToRetry(e); }
  finally { client.release(); }
}

// Reads are declared side-effect free; this makes the declaration enforceable rather than a comment.
// Anchoring at the start of the statement is not enough on its own: a leading SELECT does not make a
// statement a read, and both `SELECT 1; INSERT …` and `WITH x AS (…) INSERT …` sail straight past an
// anchored check. So look for the write forms ANYWHERE too — in their multi-word shapes, which do not
// appear by accident in a SELECT the way a bare `update` can (a column named `last_update` is safe:
// the `_` is a word character, so \b does not match inside it).
//
// The list below is deliberately wider than "the SQL the handlers happen to contain today". A backstop
// that only catches the mistakes you already thought of is a comment with extra steps, so it was
// probed: MERGE, COPY … FROM, SELECT … INTO, setval/nextval, an advisory lock and `SELECT … FOR UPDATE`
// all sailed straight past the first version. FOR UPDATE is not a write, but on this path there is no
// BEGIN, so the lock is taken and dropped in the same statement — it looks like protection and is not,
// which is worse than not having it.
const WRITE_HEAD = /^\s*(?:insert|update|delete|truncate|drop|alter|create|grant|revoke|merge|copy)\b/i;
const WRITE_ANY = /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|truncate\b|merge\s+into|copy\s+\w+\s+from|\binto\s+\w+\s+from|for\s+update\b|for\s+no\s+key\s+update\b|for\s+share\b|setval\s*\(|nextval\s*\(|pg_advisory_(?:xact_)?lock\s*\()/i;
function readOnlyClient(client) {
  return {
    query: (text, params) => {
      const sql = typeof text === 'string' ? text : text?.text || '';
      if (WRITE_HEAD.test(sql) || WRITE_ANY.test(sql)) {
        throw new Error(`read path attempted a write: ${sql.slice(0, 80)}`);
      }
      return client.query(text, params);
    },
  };
}

// The wrapper routes actually use: try the lock-free path, fall back to the locked one when accrual
// moved. Kept as one call so a route cannot accidentally take only half of the contract.
export async function readCharacter(pool, accountId, fn) {
  const fast = await withCharacterRead(pool, accountId, fn);
  return fast !== null ? fast : withCharacter(pool, accountId, fn);
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
// opts.meet=false: COVERT actions (an anonymous NPC hit, a burner-phone hire, a wire-blamed secret
// exposure) opt OUT of the black-book meeting grant — the actor never openly met the victim, and
// granting the victim their number would reveal exactly what those mechanics sell as hidden
// (AUDIT-street-life HIGH-1). The route declares covertness; every named/consensual action defaults in.
export async function withTwoCharacters(pool, accountId, targetCharacterId, fn, { meet = true } = {}) {
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

    // STREET LIFE (the black book): a COMPLETED two-party action is a MEETING — both sides walk
    // away with the other's number (the founder's discoverability rule: numbers come from meeting
    // or intel, never free). Best-effort leaf insert; a gate refusal (a thrown GameError) never
    // reaches here, so a refused approach is not a meeting — and a COVERT action (opts.meet=false)
    // is not one either: the victim met a hired gun / "the wire", never the actor.
    if (meet) await recordMeeting(client, ch.account_id, victim.account_id);

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
    // THE AHA MOMENT — assign the acting player their first rival (post-commit, non-fatal; the referral
    // discipline). The two-party actor is `accountId`; the cheap pre-check no-ops the common case.
    try {
      const fb = await startFirstBlood(pool, accountId);
      if (fb) bus.emit(`me:${fb.characterId}`, { type: 'first_blood', payload: fb.payload });
    } catch (e) { console.error('first blood (post-commit, non-fatal)', e?.code || e); }
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
      rwa_used=$57, rwa_at=$58, envelope_until=$59, wire_until=$60, poker_limit=$61,
      safehouse_used=$62, safehouse_at=$63, refill_used=$64, refill_at=$65, family_raid_at=$66,
      shipment=$67 WHERE id=$1`,
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
     ch.poker_limit ?? null, ch.safehouse_used ?? 0, ch.safehouse_at ?? null,
     ch.refill_used ?? 0, ch.refill_at ?? null, ch.family_raid_at ?? null,
     ch.shipment ?? 0]);
}

// THE COACH — the single highest-value next step for THIS player, server-authoritative so the client
// never guesses. A priority ladder: emergencies first (lockup, hospital, bleeding), then the big
// progression unlocks (a Path, a family), then safety (bank your cash), then finishing the First Week,
// then just staying active. Pure guidance — reads state, moves nothing.
// coachLadder returns UP TO FIVE applicable rungs in priority order (founder-directed "the next 5
// things to do, always" — the client renders the queue); view.coach = ladder[0], so every existing
// consumer (the sheet banner, onboardBoard, the tests) sees the same single next step as before.
function coachLadder(ch, acct, owned) {
  const rungs = [];
  // collects a rung; returns TRUE when the plan is full so the caller can stop evaluating
  const add = (label, hint, tab) => { rungs.push({ label, hint, tab }); return rungs.length >= 5; };
  const lvl = levelOf(Number(ch.respect));
  // A MULTIPLAYER-ONLY milestone leads only for a window after it first applies (COACH_SOCIAL_BAND_LVLS);
  // past it, it moves to the recurring tail. Nothing here decides whether the advice is GOOD — it is —
  // only whether it may sit on top of rungs the same player could act on alone.
  const inSocialBand = (l, from) => !M3.COACH_SOCIAL_BAND_LVLS || l <= from + M3.COACH_SOCIAL_BAND_LVLS;
  const maxEnergy = energyCapOf(lvl, assetEnergyCap(owned.assets || []), owned.disciplines, ladderFx(acct, 'energy'));
  const now = Date.now();
  const future = (t) => t && new Date(t) > new Date(now);
  const onboard = typeof acct.onboard === 'string' ? JSON.parse(acct.onboard || '{}') : (acct.onboard || {});
  const obDone = ONBOARD_TASKS.filter((t) => onboard[t.id]).length;
  if (future(ch.jail_until) && add('You\'re in lockup', 'Sit it out — or work the Pen: bribe the guard, work the yard, watch your back.', 'pen')) return rungs;
  if (future(ch.hosp_until) && add('Under the Doc\'s care', 'You\'re healing up and UNTOUCHABLE — rivals can\'t jump or shoot you. You can still work jobs and run your rackets; only fighting is off.', 'streets')) return rungs;
  if (Number(ch.health) < 30 && add('You\'re bleeding out', 'Heal up before someone finishes the job (the Heal button, top-left).', 'streets')) return rungs;
  // urgent, time-boxed threats — these cost you if you sit on them (all false for a fresh street)
  if (future(ch.wanted_until) && add('There\'s a price on you', 'You\'re WANTED — even your family can hunt you and NPC guns are out. Square your name at the Shylock, or lie low.', 'loans')) return rungs;
  if (ch.indicted_at && add('The Bureau indicted you', 'A RICO case is filed — the grace clock is running. Take a plea, buy the jury, or demand trial in The Law.', 'law')) return rungs;
  if (ch.welsher && add('Your name is mud', 'You welshed on a debt — nobody lends to you. Square it at the Shylock to borrow again.', 'loans')) return rungs;
  // STREET WAR step two — the city remembers who moved on you. Self-clears as the 48h window
  // rolls (the harness-F1 rule); under constant predation it stays lit, which is the news.
  // THE HEIR'S ARRIVAL (cohesion step three) — the two beats after the death modal closes. Both sit
  // ABOVE the generic "someone moved on you" rung ON PURPOSE: a murdered heir's kill IS a recorded
  // rival event, so the generic rung would mask exactly these two for the 48h window — and for that
  // player, these ARE the specific version of it.
  // (1) THE SWORN VENDETTA finally gets a voice on the ladder: runEstate swears it and notifies
  // ONCE, then nothing ever mentioned it again — the game's sharpest revenge hook sat silent in a
  // view field. Window-bound, so it self-clears by settling OR lapsing (the wanted/indicted class),
  // and it names what settling PAYS. Fires for any vendetta holder, not just a fresh heir.
  {
    const v = (owned.vendettas || [])[0];
    if (v && add('Blood is owed', `${v.sworn ? `${v.sworn} was put in the ground` : 'Your blood was spilled'}${v.target_name ? ` — ${v.target_name} walks the streets` : ''}. The bloodline swore vengeance: a revenge kill inside the window pays DOUBLE feared-rep, and naming a gun on their head waives the directed floor. Wet Work — before it lapses.`, 'pvp')) return rungs;
  }
  // (2) YOU RISE AGAIN — the heir's first minutes. The modal said what carried; this rung makes it
  // the NEXT STEP: the account survived, the street starts over, the coach picks up from here.
  // Self-clears at level 3 (the road-to-5 shape — a fresh heir crosses it in one short sitting).
  if (Number(ch.generation) > 1 && lvl < 3) {
    const kept = [
      Number(acct.staked || 0) > 0 ? `${Math.floor(Number(acct.staked))} $OMR staked` : null,
      Number(acct.omr || 0) > 0 ? `${Math.floor(Number(acct.omr))} $OMR liquid` : null,
      owned.estate ? 'the compound' : null,
      Number(acct.prestige || 0) > 0 ? `prestige ${acct.prestige}` : null,
    ].filter(Boolean);
    if (add('You rise again', `Generation ${ch.generation}. The street died; the BLOODLINE didn't — ${kept.length ? `the account kept ${kept.join(', ')}` : 'the account, the name and the ledger all carried'}. The street starts at level 1: pull jobs, and everything you built at the account level is still working for you.`, 'start')) return rungs;
  }
  // THE AHA MOMENT — the scripted first rival. Sits ABOVE the generic "someone moved on you" (the aha
  // IS a recorded rival event, so that rung would otherwise fire) — for a fresh player this IS the
  // specific, urgent version of it. Self-clears at stage 2 (settled): a winnable jump in Wet Work.
  if (Number(ch.aha_stage) === 1 && add('Settle your first score', `${ch.aha_rival_name || 'Somebody'} put the word out that you're nobody — and the street is listening. Find them on the Wet Work roster and JUMP them. Hit back and you've made your bones.`, 'pvp')) return rungs;
  if ((owned.recentRivals || 0) > 0
    && add(`${owned.recentRivals > 1 ? `${owned.recentRivals} people` : 'Someone'} moved on you`, `You were robbed, jumped or hit inside the last two days and haven't answered ${owned.recentRivals > 1 ? 'them' : 'it'}. YOUR RIVALS on Wet Work names who — hit back and it pays honor. This clears when you've settled with every one of them.`, 'pvp')) return rungs;
  if (Number(ch.lc_crime || 0) < 1 && add('Pull your first job', 'Head to the Streets. Pick any crime and press DO IT. That\'s the whole move — it pays cash and respect.', 'streets')) return rungs;
  // ── THE ROAD TO LEVEL 5 (founder-directed: walk a brand-new player there, no exploring needed).
  // Two rungs, both clear on their own: the nerve-wait clears in minutes, the level rung at 5 —
  // so neither can mask the ladder below (the harness-F1 rule).
  if (lvl < 5) {
    if (Number(ch.nerve) < 2 && add('Out of nerve — it comes back by itself', 'Nerve is what jobs cost, and it refills on its own (a few points a minute). While you wait: collect anything marked READY on Start Here — that\'s free money — or train at the gym on the Streets.', 'start')) return rungs;
    const need = Math.max(0, PACING.LEVEL_DIVISOR * 16 - Number(ch.respect));
    if (add('Get to level 5', `Keep pulling jobs. Every job pays respect, and respect IS your level — ${need} more respect reaches level 5, where you choose your Path. That\'s the whole plan: do a job, wait for nerve, do another.`, 'streets')) return rungs;
  }
  if (lvl >= 5 && !ch.path && add('You\'ve made rank', 'Declare a Path — six careers are on the board, from The Gun to The Ring. It shapes how you earn.', 'streets')) return rungs;
  // (harness F1) A rung that a player can DECLINE forever, or one that RE-ARMS every few minutes,
  // must never sit above the one-time milestone rungs — it masks all of them permanently. The
  // progression harness caught exactly that: a solo player who never joined a family was pinned on
  // "Nobody survives alone" for a whole simulated week, so the earner/skills/Kitchen/legit/full-tank
  // rungs below were unreachable. Same class as the First-Week bug in the note below. Both recurring
  // nudges now sit at the BOTTOM of the ladder (see COACH_NUDGES), where they fill the quiet moments
  // instead of blocking the ladder. The early band is kept: for a brand-new street, joining a family
  // genuinely IS the next thing.
  if (!owned.gangId && lvl >= 3 && lvl <= M3.COACH_FAMILY_BAND_LVL
    && add('Nobody survives alone', 'Join a family or found your own — turf, tribute, wars, and backup.', 'family')) return rungs;
  // (audit F1) Only the GAMEPLAY First-Week tasks gate the coach. The 3 socials + the wallet link are
  // OPTIONAL bonuses on Start Here — they throw `verify_unavailable` when SOCIAL_VERIFY_MODE is off
  // (the default), so counting them would pin the coach at "Finish your First Week" forever and mask
  // every mid-game rung below. Gate on the five completable gameplay tasks instead.
  // (harness F1b) `ob_family` belongs in the same exclusion: joining a family is DECLINABLE, so for a
  // solo player it never completes and this rung would pin the coach exactly like the socials did —
  // masking the whole mid-game ladder below. The task still exists and still pays on Start Here; it
  // just can't be a gate. What's left is the four tasks any player can finish alone.
  const obGameplay = ONBOARD_TASKS.filter((t) => !t.social && t.id !== 'ob_wallet' && t.id !== 'ob_family');
  // The count quotes the tasks this rung actually GATES on, not `ONBOARD_TASKS.length`. Two reasons:
  // a player who claimed the socials but no gameplay task read "3/8" while the gate was elsewhere,
  // and on a server without X configured that task is not offered at all, so the old
  // denominator promised a total nobody could reach. Counting the gate is true under every config
  // (and needs no import from verify.js, which imports game.js — the one-way rule holds).
  const obGameplayDone = obGameplay.filter((t) => onboard[t.id]).length;
  if (obGameplay.some((t) => !onboard[t.id])
    && add(`Finish your First Week (${obGameplayDone}/${obGameplay.length})`, 'The checklist pays cash to teach you the ropes — claim what\'s ready over on Start Here.', 'start')) return rungs;
  // ── THE BRIDGE INTO THE DEEP GAME — a banded ladder of one-time milestones all the way to level
  // 30 (founder-directed "continue coaching… on a plethora of possible actions all the way up to
  // level 30"), so the coach never goes silent mid-game. EVERY rung self-clears by DOING the thing
  // once (the harness-F1 rule): the clearing signals are ownership (guns/fronts/fighters), the
  // account-level legends (heists_pulled/boxing_wins/race_wins/smuggled — survive death, so a
  // veteran heir is never re-schooled), and mastery XP (any single action in that loop stamps it).
  const hasEarner = !!ch.lab || (owned.businesses || []).length || (owned.rackets || []).length
    || (owned.assets || []).length || (owned.fighters || []).length || !!owned.speakeasy;
  if (!hasEarner && lvl >= 3 && add('Money while you sleep', 'Buy a racket in The Empire — cheap passive income that pays while you\'re offline. Kitchens and fronts come later.', 'empire')) return rungs;
  // (harness F1c) `owned.skills` is a SET (loadOwned:159), so `.length` is undefined and `!undefined`
  // is always true — this rung fired forever no matter how many skills you'd bought, masking the two
  // rungs below it. Count the Set properly. (Every other collection here is a real array.)
  // (founder: "not obvious how to use your skill points once you get there") — the rung now fires
  // on UNSPENT points, not just never-learned: parity with skills.js pointsOf (which game.js cannot
  // import — the one-way rule — so the small formula is restated here; skillOf reads the same TREE).
  // The hoarder guard: banking ≤ CAPSTONE_COST points is CORRECT play (capstones cost 4), so a
  // veteran saving for one is not nagged — the rung re-fires only never-learned or ≥5 idle points.
  const skillSet = owned.skills instanceof Set ? owned.skills : new Set(owned.skills || []);
  const skillSpent = [...skillSet].reduce((a, id) => a + (skillOf(id)?.cost || 0), 0);
  const skillPts = Math.floor(lvl / SKILLS.LVL_PER_POINT)
    + Math.min(SKILLS.PRESTIGE_POINT_MAX, Math.floor(Number(acct.prestige || 0) / SKILLS.PRESTIGE_PER_POINT))
    - skillSpent;
  // …and it must go SILENT when there is nothing left to buy. The tree is 12 skills for 30 points
  // total and points are floor(level/4), so from level ~120 every skill is owned while the points
  // keep accruing — the rung would fire forever pointing at a finished tree, which is the same
  // never-clearing class the two fixes above closed. `SKILLS.TREE.length` is the honest gate.
  const treeDone = skillSet.size >= SKILLS.TREE.length;
  if (lvl >= 4 && !treeDone && skillPts >= 1 && (skillSet.size === 0 || skillPts >= 5)
    && add('You\'ve earned skill points', `You have ${skillPts} unspent point${skillPts === 1 ? '' : 's'}. The Life ▸ Skills: press LEARN on a tier-1 skill — Bruiser (hit harder), Fast Talker (lay low cheaper), Pack Mule (bigger trunk). Tier-1s cost 1 point.`, 'life')) return rungs;
  if (lvl >= 6 && !(owned.guns || []).length && add('Get strapped', 'The Garage ▸ Armory: buy a pistol and CARRY it. A gun backs every fight in this city — jumps, hits, standing over rivals.', 'garage')) return rungs;
  if (lvl >= 7 && !Number(owned.mastery?.commerce || 0) && add('Learn the trade winds', 'Streets ▸ Trade Goods: buy something cheap where you stand, haul it where it\'s rich (The City ▸ Trade Winds shows the spread), sell high. This is the on-ramp to convoys and the Black Market.', 'streets')) return rungs;
  if (!ch.lab && lvl >= 8 && !(owned.businesses || []).length && add('Cook up real money', 'Set up a Kitchen — the drug trade is the deepest earner in the game.', 'kitchen')) return rungs;
  // MULTIPLAYER-ONLY, so BANDED (COACH_SOCIAL_BAND_LVLS): a crew score cannot be pulled alone, and on
  // a thin server this rung otherwise leads forever and masks every solo system under it.
  if (lvl >= 9 && !Number(acct.heists_pulled || 0) && inSocialBand(lvl, 9)
    && add('Pull a crew score', 'Big Scores ▸ Crew Heists: plan a job or join one off the open board. One roll pays the whole crew — bigger than anything you can pull alone.', 'scores')) return rungs;
  if (lvl >= 10 && !Number(owned.mastery?.gambling || 0) && add('A night at the Den', 'The Den at the Neon Mile — craps, blackjack, the numbers. Bring a real stake ($1,000+): the table doesn\'t respect small money.', 'den')) return rungs;
  if (lvl >= 12 && !(owned.fighters || []).length && !Number(acct.boxing_wins || 0) && add('Get into the fight game', 'The Fights: sign a contender, train them up, stake them against other managers\' fighters. The crowd bets your main events.', 'boxing')) return rungs;
  if (lvl >= 14 && !Number(acct.race_wins || 0) && !Number(owned.mastery?.wheels || 0) && add('Run the streets', 'Street Races: tune a car from your garage and run the PvE circuit — fee up front, purse on a win. Fast iron finally earns.', 'races')) return rungs;
  // ── YOU CAN GET MADE FOR FREE. An alpha tester read the game as pay-to-win ("we can't earn OMR in
  // game anymore?"), and the mechanics say otherwise: $OMR is still earned by playing — the mission
  // ladder alone pays 220 across nine jobs — and MINTING (the gate on withdrawing and on the Street
  // Wage) is HANDED OVER by the ladder itself, so the road to it costs nothing but play.
  // Nothing was missing but the sentence saying so, so this is the sentence. Fires at the level of
  // the first mission that pays $OMR (read from the catalog, so a re-extract can never leave the
  // rung firing before the job it points at exists) and self-clears the moment they're minted.
  // The MINT PRICE is deliberately NOT quoted: it moves with the published tranche schedule, so a
  // hardcoded figure here would be a lie the player only discovers at the till. THE FIX (2026-08-10)
  // removes the arithmetic from the promise entirely:
  // the mission the rung names GRANTS the mint credit, so the rung states a fact rather than a
  // price, and it stays true at any token price. Read off the catalog so it can never fire before
  // the job it names exists.
  const freeMintMission = MISSIONS.find((m) => Number(m.reward?.mintCredit) > 0);
  if (freeMintMission && lvl >= (freeMintMission.req?.lvl || 14) && !acct.minted && !Number(acct.mint_credits || 0)
    && add('You can get made for free', `Getting MADE unlocks withdrawing and the Street Wage, and it does not cost you a penny: the mission "${freeMintMission.name}" hands you the credit outright. Pull that job, then spend the credit on Going Legit ▸ Extraction. (You can also buy it with ETH — the mission is the free road.)`, 'portfolio')) return rungs;
  if (Number(acct.mint_credits || 0) > 0 && !acct.minted
    && add('Spend your mint credit', 'You are holding a credit that makes you a MADE MAN — withdrawals and the Street Wage open the moment you spend it. It costs nothing to use. Going Legit ▸ Extraction.', 'portfolio')) return rungs;
  // (founder: "not obvious… the steps you need to take to buy your first business") — concrete steps,
  // priced off the live catalog so the hint can never drift from what the buy button charges.
  const firstFront = BUSINESSES.find((b) => b.kind === 'laundromat');
  if (lvl >= 15 && !(owned.businesses || []).length
    && add('Open your first front', `The Empire ▸ The Catalog: hit BUY on the ${firstFront?.name || 'Laundromat'} ($${firstFront?.tiers?.[0]?.cost?.toLocaleString?.() || '250,000'}). It farms cash around the clock — come back daily to COLLECT, and pay the pad (upkeep) or it goes cold. Your first real empire piece.`, 'empire')) return rungs;
  // D11 (2026-08-05): the paper book is retired — going legit IS the stake ladder now. Moved down
  // from 27 so the earn→spend arc keeps its lvl-15 anchor; clears on staking anything.
  if (lvl >= 15 && !Number(acct.staked || 0) && Number(acct.omr || 0) >= (MADE_LADDER.RUNGS[0]?.min || 10)
    && add('Put your $OMR to work', `$OMR you STAKE is power for holding it — ${MADE_LADDER.RUNGS[0]?.min || 10} staked reaches the ladder's first rung (a bigger trunk, deeper tanks, a bigger garage) — and a committed balance is looted at the COMMITTED rate, not the idle one, when you die. Going Legit ▸ THE LADDER.`, 'portfolio')) return rungs;
  if (lvl >= 16 && !Number(acct.smuggled || 0) && add('Take it to the water', 'The Port at the docks: buy a boat and run contraband in from offshore. The margins beat the streets — the Coast Guard is the risk.', 'port')) return rungs;
  if (lvl >= 18 && !Number(acct.intel_ops || 0) && Number(acct.omr || 0) >= WIRE.TAP_OMR && add('Work the wires', 'The Wire: burn a little $OMR to tap a rival — their heat, their wealth band, whether they\'re hunting YOU. Information is the sharpest weapon in the city.', 'wire')) return rungs;
  if (lvl >= 22 && !Number(owned.mastery?.wetwork || 0) && inSocialBand(lvl, 22)
    && add('Blood on the ledger', 'Wet Work: the contract board pays real pots for real bodies. Start on the Dueling Circuit — challenge a listed duelist, win the stake, build the name.', 'pvp')) return rungs;
  // ── THE DEEP CITY (founder-directed: "extend the coach past ~24 into the mid-game systems it
  // currently never names"). The 7-day progression harness measured a plausible solo player touching
  // 10 of 39 systems, with the milestone ladder above ending at level 22 — from there the coach fell
  // to the daily work board and the permanent nudges, and the convoy/stable/nightlife/monument/estate
  // layers were never once named. Same discipline as the band above: every rung is ONE-TIME and
  // SELF-CLEARS on a signal that cannot regress — an account legend that survives death
  // (freight_delivered/racer_wins/monument_built) or ownership (speakeasy/estate) — and any rung
  // whose action costs money gates on HOLDING the price (the work-the-wires rule), so a broke street
  // is never pinned on advice it cannot act on (the harness-F1 masking rule).
  if (lvl >= 24 && !Number(acct.freight_delivered || 0)
    && add('Put a truck on the road', 'Big Scores ▸ Convoys: load trade goods, hire guards, send the shipment across the map. Bulk freight beats anything your trunk can carry — and collecting at the far end starts the Teamster legend. Bandits are the risk; guards are the answer.', 'scores')) return rungs;
  // gate on the CHEAP animal's price — the hint quotes the live catalog (the first-front rule:
  // price off the live surface or don't state a price), so a retune can never make the copy a lie.
  if (lvl >= 25 && !Number(acct.racer_wins || 0) && Number(ch.cash) + Number(ch.bank) >= STABLE.KINDS.dog.cost
    && add('Own the animals', `The Stable: buy a ${STABLE.KINDS.dog.name} ($${STABLE.KINDS.dog.cost.toLocaleString()}), train its legs, and run the circuit until it takes a purse. A racer you own can even run in the town's daily card — the whole city bets on your animal.`, 'stable')) return rungs;
  // ── THE EARN→SPEND ARC (founder-directed pairing: "so the earn to spend arc closes"). $OMR's
  // sinks are all built — but a player was never routed from HOLDING $OMR to SPENDING it on
  // something they want, so the token read as a number with nowhere to go. Two rungs close it:
  // DUES (the Made Man — which is also what the club rung below gates on, so without this a funded
  // unmade player would simply never see the club) and the STAKE (the D8=D ladder pays power for
  // HOLDING). Both $OMR-gated on holding the price (the work-the-wires rule); both self-clear on
  // an account-level signal (made_until / staked — both survive death).
  if (lvl >= 26 && !isMade(acct) && Number(acct.omr || 0) >= MADE.OMR
    && add('You can afford your dues', `${MADE.OMR} $OMR a month makes you a MADE MAN: the badge, the upper compound, a club of your own, a seat in the high-stakes room, and your fronts pay their own pad. You're holding the price — Going Legit ▸ THE MADE MAN.`, 'portfolio')) return rungs;
  // one club per district, so on a full map this could linger — acceptable on a thin alpha (six
  // districts, and residents never open clubs); the cash gate keeps it off a broke street's plan,
  // and the MADE gate mirrors openSpeakeasy's own D8=D door — without it an unmade funded player
  // would be pinned on a rung the server refuses forever (the refuse-on-press class, as a mask).
  if (lvl >= 26 && !owned.speakeasy && isMade(acct) && Number(ch.cash) + Number(ch.bank) >= SPEAKEASY.OPEN_COST
    && add('Open a club of your own', `The Speakeasy: as a made man, $${SPEAKEASY.OPEN_COST.toLocaleString()} opens a nightclub in any free district. The bar take drips around the clock, and every round a patron buys is buying YOUR prestige — the nightlife board ranks the city's clubs.`, 'speakeasy')) return rungs;
  if (lvl >= 28 && !Number(acct.monument_built || 0)
    && add('Put your name on the skyline', 'The City is raising a monument, and every dollar you brick in goes on the plaque FOREVER — it survives your death, your heir\'s death, everything. The cheapest immortality in town, and the whole base builds it together.', 'city')) return rungs;
  // the $OMR-sink arc (estate → auction block) — gated on HOLDING tier 1's price, read live off the
  // catalog. Clears by buying the first place; the estate row is account-level so an heir who
  // inherits the compound is never re-schooled.
  if (lvl >= 30 && !owned.estate && Number(acct.omr || 0) >= (ESTATE.TIERS[0]?.omr || 40)
    && add('Buy the compound', `The Estate: ${ESTATE.TIERS[0]?.omr || 40} $OMR buys the ${ESTATE.TIERS[0]?.name || 'Safe House'} — a home that survives death, mounts your trophies, and gives your $OMR something permanent to become. The Auction Block next door sells one-of-a-kind pieces weekly.`, 'estate')) return rungs;
  // ── THE RECURRING NUDGES ── (COACH_NUDGES) Everything above is a ONE-TIME milestone that clears
  // for good once done. These three never clear, so they live down here where they fill the quiet
  // moments instead of masking the ladder. The SAME rule orders the tail itself: most-clearable
  // first, permanent LAST — otherwise the permanent one masks the actionable ones (a solo player
  // would never be told to bank a fat pocket).
  // A COLD FRONT is the most actionable thing on this list when it happens: the place earns NOTHING
  // while the pad keeps running, so every hour it stays dark costs more than it did the hour before.
  // It self-clears two ways — pay it, or close it up — which is exactly why it belongs at the head of
  // the tail rather than in the one-time ladder above (a front can go cold again and again).
  {
    const cold = (owned.businesses || []).filter((b) => b.cold);
    if (cold.length && add(`${cold.length === 1 ? 'A front has' : `${cold.length} fronts have`} gone cold`,
      `${cold.length === 1 ? `Your ${cold[0].name} pays` : 'They pay'} nothing until the pad is square — and the pad keeps running whether ${cold.length === 1 ? 'it earns' : 'they earn'} or not. Pay it (The Empire ▸ pay the pad) or close ${cold.length === 1 ? 'it' : 'them'} up and stop the bleeding.`,
      'empire')) return rungs;
  }
  // THE BUREAU, before the indictment. The urgent rung at the top of the ladder fires only once a
  // case is FILED — by which point the cheap outs (the bribe, laying low early) are mostly gone.
  // This one fires while the meter is still climbable-down (stage 'investigation', pre-indictment)
  // and SELF-CLEARS as the exposure bleeds, gets bribed off, or crosses into the indictment rung —
  // the cold-front class exactly: reactive, actionable, recurring by nature, so it lives in the
  // tail where it can fill a quiet moment without masking a milestone.
  if (!ch.indicted_at && rapStageOf(ch.heat_exposure, null) === 'investigation'
    && add('The Bureau is building a case', 'Your file is thick and getting thicker — cross the line and they indict. The Law: pay a bribe to thin the file, put a lawyer on retainer, or run quiet until it cools. Once a case is FILED the price goes way up.', 'law')) return rungs;
  // ── THE WORK BOARD (omerta-early-game-design.md F1) ──
  // The rungs above are one-time milestones, so a player who follows the coach clears the last of
  // them around level 22 — at exactly the level the CONTENT thins out too (7 of the levels from 17
  // to 31 unlock nothing at all). The coach then fell to three generic nudges and effectively went
  // quiet, which is the opposite of what it is for.
  //
  // These rungs never run out, because they refill every day. Every one of them points at work that
  // ALREADY EXISTS, ALREADY PAYS, and is currently invisible unless the player goes looking for it —
  // so this adds no faucet and no §10.4 surface; it points at faucets the game already has. Each
  // names WHAT IT PAYS, so a player learns what is worth their nerve.
  //
  // Ordered by what it pays, richest first, so the plan box reads as a shift worth working. They sit
  // above the permanent nudges (bank/tank/solo) for the tail's own rule: most-clearable first.
  {
    const w = owned.work || {};
    // A MISSION is the single biggest respect payout in the game and it is on a 4h clock, so the
    // moment it comes off cooldown it is the best thing on the board, every time.
    const missionReady = !ch.mission_at || Date.now() - new Date(ch.mission_at).getTime() >= PACING.MISSION_CD_MS;
    if (missionReady && lvl >= 2
      && add('A job came in from the family', 'The story missions pay the biggest respect in the game and one just came off cooldown. Take it — it is the fastest level you will get today.', 'start')) return rungs;
    // Count only what this player can actually FINISH. A drawn `tribute` contract is dead to a
    // family-less street (dailyBlockedFor), and a rung that says "1 of today's contracts unclaimed"
    // while pointing at a card they can never clear sits at the head of the tail all day and masks
    // every live rung under it — the F2 masking class, in the one place the pool can still produce
    // it. The same helper marks the card on the board, so the count and the copy cannot disagree.
    const dailiesLeft = dailyLiveFor(w.dailyClaimedIds || [], { gangId: owned.gangId }).length;
    if (dailiesLeft && add(`${dailiesLeft} of today's contracts unclaimed`,
      'Daily contracts pay cash for work you were going to do anyway — pull jobs, boost cars, move product. Claim them before the day rolls over and they are gone.', 'streets')) return rungs;
    if (w.hustleStep !== 3 && add(w.hustleStep === null ? "Tonight's hustle is waiting" : 'Your hustle is half-finished',
      'Three stops, three districts, one payoff that scales with your level — and it walks you round the map while it pays. It resets at the end of the day whether you finish it or not.', 'streets')) return rungs;
    if ((w.cornerOpen || []).length && add(`The corner has an envelope for you`,
      'You took work on a corner and it is still open. Finish it and collect — corner jobs are the only daily work that pays RESPECT as well as cash.', 'streets')) return rungs;
    if (w.clue && add(`You're carrying a clue scroll (step ${w.clue.step} of ${w.clue.steps})`,
      'Somebody left you a trail. Follow it to the end and the casket pays — and it costs nothing but the walking.', 'streets')) return rungs;
    if ((w.drillsTaken || 0) < 2 && lvl >= 3
      && add('The trainers have work for you', 'Every fixture in town sets a job each day. Do theirs and they school you for it — free discipline XP, and it lifts caps the rest of your game runs on.', 'life')) return rungs;
    // F6 — THE TRADES, named at the moment they pay off. Mastery XP accrues from level 1 on every
    // action and the perks at 10/25/40 are real, but the board lives on the Life tab and the coach
    // has never once mentioned it — so 200 crime clicks read as repetition rather than a ladder.
    // Fires only when a trade is ONE level short of a milestone: rare, and it self-clears by
    // playing that loop (the harness-F1 rule). Status only — no faucet, no §10.4 surface.
    const near = MASTERY.TRACKS
      .map((t) => { const l = masteryLvlOf(Number(owned.mastery?.[t.id] || 0));
        return MASTERY.MILESTONES.includes(l + 1) ? { t, at: l + 1 } : null; })
      .filter(Boolean)[0];
    if (near && add(`One level off a ${near.t.name} perk`,
      `Keep working that trade — at ${near.t.name} L${near.at} it starts paying you in ${MASTERY.PERKS[near.t.id]?.what || 'a standing edge'}. The Trades board on The Life tab shows every track you're building.`, 'life')) return rungs;
  }
  if (Number(ch.cash) > CONSTANTS.COACH_BANK_NUDGE && Number(ch.cash) > Number(ch.bank)
    && add('You\'re carrying too much', 'Bank your pocket cash before someone jumps you for it — the streets are watching.', 'streets')) return rungs;
  // (harness) A street player runs on NERVE, never energy — the bar sits full ~94% of the time, so
  // a full tank isn't idle capacity, it's UNSPENT ACCESS to the physical content. Name what spends
  // it, or the bar reads as broken.
  if (Number(ch.energy) >= maxEnergy * 0.75 && add('Full tank', 'Crime runs on nerve — energy is what the PHYSICAL work costs: the gym, boosting cars, heist crews, cartel raids, convoy ambushes, shakedowns. You\'ve got a full tank going unspent.', 'streets')) return rungs;
  // The two BANDED multiplayer milestones, demoted here rather than dropped: still worth saying, but
  // below every rung a player can act on by themselves. They clear for good the moment they're done.
  if (lvl > 9 + M3.COACH_SOCIAL_BAND_LVLS && !Number(acct.heists_pulled || 0)
    && add('Find a crew', 'You still haven\'t pulled a crew score. Big Scores ▸ Crew Heists — the pot beats anything you can take alone, but it takes a second body.', 'scores')) return rungs;
  if (lvl > 22 + M3.COACH_SOCIAL_BAND_LVLS && !Number(owned.mastery?.wetwork || 0)
    && add('No blood on your ledger', 'You\'ve never taken a contract. Wet Work — the Dueling Circuit is the way in, when somebody\'s listed.', 'pvp')) return rungs;
  // the one a player can decline forever — so it sits at the very bottom, never masking anything
  if (!owned.gangId && lvl >= 3 && add('Still running solo', 'You can play the whole game alone, but a family is turf, tribute, wars and backup — worth a look.', 'family')) return rungs;
  return rungs; // possibly empty — an established player who knows the ropes gets no nag
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
    // THE MADE MAN (economy v3 §11.2) — the badge. Account-level, so it survives death; buys standing
    // and convenience, never power.
    made: isMade(acct), madeSeconds: madeSeconds(acct),
    unbondSeconds: (Number(acct.unbonding || 0) > 0 && acct.unbond_at) ? Math.max(0, Math.ceil((new Date(acct.unbond_at) - Date.now()) / 1000)) : 0,
    bankInTransit: Math.min(Math.floor(Number(ch.bank_intransit || 0)), Math.floor(Number(ch.bank))),
    bankClearSeconds: (Number(ch.bank_intransit || 0) > 0 && ch.bank_intransit_at)
      ? Math.max(0, Math.ceil((new Date(ch.bank_intransit_at).getTime() + CONSTANTS.BANK_CLEAR_MS - Date.now()) / 1000)) : 0,
    // (red-team) the live quote MIRRORS enterSafehouse exactly — incl. the season mult when armed
    safehouseCost: Math.max(M3.SAFEHOUSE_COST, Math.floor(Math.max(M3.SAFEHOUSE_COST, Math.floor((Number(ch.cash) + Number(ch.bank)) * CONSTANTS.SAFEHOUSE_NW_BPS / 10000))
      * (seasonModOf().safehouseMult || 1))),
    stats: { muscle: ch.muscle, cunning: ch.cunning, speed: ch.speed },
    eff: { muscle: eff('muscle'), cunning: eff('cunning'), speed: eff('speed') },
    rerollCredits: Number(acct.reroll_credits || 0), // paid 0.01-ETH stat re-rolls in hand
    // The base budget every roll shares; a WALLET FORGE may sit up to WALLET_FORGE.BONUS_MAX above
    // it (the founder-signed depth-B grant) — so the total is no longer a constant across streets.
    statTotal: Number(ch.muscle) + Number(ch.cunning) + Number(ch.speed),
    forged: ch.forged || null, // THE WALLET FORGE archetype, if this street was ledger-born
    // the DISPLAY name (never the raw key on a player surface — the F12 raw-key lesson)
    forgedName: ch.forged && WALLET_FORGE.ARCHETYPES[ch.forged] ? WALLET_FORGE.ARCHETYPES[ch.forged].name : null,
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
    // YOUR OWN TAIL — the search you have out, from the SERVER. The browser used to be the only
    // place this was written down, so a second device (or cleared storage, or the installed PWA
    // after searching on desktop) showed "nobody in the crosshairs" while startSearch refused with
    // "Your people are already out looking. Call them off first." — and the only button that calls
    // it off lived on the card that no longer rendered. `placedSeconds` counts down the SAME
    // hunterSearchMs the shot is gated on, so the sheet and the trigger can never disagree.
    hunt: owned.hunt ? {
      targetId: owned.hunt.target,
      name: owned.hunt.name || null, // NULL if the mark's street is gone — the card still renders
      placedSeconds: Math.max(0, Math.ceil((new Date(owned.hunt.started_at).getTime()
        + hunterSearchMs({ owned, acct }, ch) - Date.now()) / 1000)),
    } : null,
    tradeRep: Number(ch.trade_rep || 0), busts: Number(ch.busts || 0),
    gun: ch.gun || null, vest: ch.vest || null, guns: owned.guns || [],
    jailSeconds: ch.jail_until ? Math.max(0, Math.ceil((new Date(ch.jail_until) - Date.now()) / 1000)) : 0,
    hospSeconds: ch.hosp_until ? Math.max(0, Math.ceil((new Date(ch.hosp_until) - Date.now()) / 1000)) : 0,
    shootCdSeconds: ch.shoot_cd_until ? Math.max(0, Math.ceil((new Date(ch.shoot_cd_until) - Date.now()) / 1000)) : 0,
    // the GTA/theft window — ONE clock shared by a garage boost, a car theft and a boat theft (an
    // attempt burns it win or lose). Surfaced so the client can DISABLE those controls while it cools
    // instead of letting a tester eat a refuse-on-press (test/client.js check 5).
    gtaSeconds: ch.gta_at && Date.now() < new Date(ch.gta_at).getTime() + CONSTANTS.GTA_CD_MS
      ? Math.ceil((new Date(ch.gta_at).getTime() + CONSTANTS.GTA_CD_MS - Date.now()) / 1000) : 0,
    safeSeconds: ch.safe_until ? Math.max(0, Math.ceil((new Date(ch.safe_until) - Date.now()) / 1000)) : 0,
    // L3b — the safehouse daily-cap bucket remaining (seconds of off-grid time left today; the wash-cap twin)
    safeCapSeconds: (() => { const cap = M3.SAFEHOUSE_DAILY_CAP_MS; if (!cap) return null;
      const refill = ch.safehouse_at ? (Date.now() - new Date(ch.safehouse_at).getTime()) / 86400000 * cap : cap;
      const used = Math.max(0, Number(ch.safehouse_used || 0) - Math.max(0, refill));
      return Math.max(0, Math.floor((cap - used) / 1000)); })(),
    // D15 — bust attempts left today (the rolling-24h bucket; same math the till charges)
    bustAttemptsLeft: (() => { const cap = M3.BUST_ATTEMPTS_DAY || 0; if (!cap) return null;
      const refill = ch.bust_at ? (Date.now() - new Date(ch.bust_at).getTime()) / 86400000 * cap : cap;
      const used = Math.max(0, Number(ch.bust_used || 0) - Math.max(0, refill));
      return Math.max(0, Math.floor(cap - used)); })(),
    guardPrice: ch.guard_price != null ? Math.floor(Number(ch.guard_price)) : null,
    fadeLimit: ch.fade_limit != null ? Math.floor(Number(ch.fade_limit)) : null,
    pokerLimit: ch.poker_limit != null ? Math.floor(Number(ch.poker_limit)) : null,
    duelElo: Number(ch.duel_elo || 1000),
    duelLimit: ch.duel_limit != null ? Math.floor(Number(ch.duel_limit)) : null,
    vendettas: (owned.vendettas || []).map((v) => ({ target: v.target_name || null, targetId: v.target_id || null,
      sworn: v.sworn, expiresSeconds: Math.max(0, Math.ceil((new Date(v.expires_at) - Date.now()) / 1000)) })),
    guardedBy: (ch.guarded_by && ch.guarded_until && new Date(ch.guarded_until) > new Date()) ? ch.guarded_by : null,
    guardSeconds: (ch.guarded_by && ch.guarded_until) ? Math.max(0, Math.ceil((new Date(ch.guarded_until) - Date.now()) / 1000)) : 0,
    loc: ch.loc, path: ch.path, title: ch.title, bio: ch.bio || null, streak: ch.streak,
    // THE SHEET'S TWO CHROME BUTTONS, quoted before the press. Both sat in the always-visible row
    // beside the money figure saying only "heal" and "check in" — a price with the purchase left
    // off, and a ladder invisible until after the money landed. Neither figure is derivable
    // client-side (the bill stacks five modifiers, the ladder is level-scaled), and both are read
    // out of the SAME function the till charges from, so the button and the till cannot disagree.
    healCost: healCostOf(ch, owned) || null,   // null when there is nothing to patch up
    checkin: checkinQuoteOf(ch),
    // THE REGIMEN — stamina/composure raise the caps; one helper pair, so view/coach/accrual agree
    maxEnergy: energyCapOf(lvl, assetEnergyCap(assets), owned.disciplines, ladderFx(acct, 'energy')),
    maxNerve: nerveCapOf(lvl, owned.disciplines, ladderFx(acct, 'nerve')),
    // THE LADDER (D8=D) — power for HOLDING. Server-computed (the tradeRank precedent: the client
    // never re-derives the curve), and `next` states the exact stake the next rung wants so the
    // board can say what it costs rather than making the player work it out.
    ladder: (() => {
      const idx = madeRungIdx(acct), cur = madeRungOf(acct);
      const next = MADE_LADDER.RUNGS[idx + 1] || null;
      // THE COMMITMENT: the ladder reads the EFFECTIVE stake (locked ×mult) through the SAME
      // effectiveStake the till uses, so the rung the sheet shows and the rung the perks grant
      // cannot disagree. `staked` stays the raw balance (the number a killer's loot reads);
      // `effective` is what the rungs measure; `lock` states the live commitment + what's on offer.
      const eff = effectiveStake(acct);
      const locked = stakeLockActive(acct);
      return { rung: idx + 1, of: MADE_LADDER.RUNGS.length, name: cur?.name || null,
        staked: Number(acct?.staked || 0), effective: eff, madeRungs: MADE_LADDER.MADE_RUNGS,
        lock: locked ? { mult: Number(acct.stake_lock_mult || 1),
          seconds: Math.max(0, Math.ceil((new Date(acct.stake_lock_until) - Date.now()) / 1000)) } : null,
        lockTiers: STAKE_LOCKS.TIERS,
        fx: cur ? { trunk: cur.trunk, energy: cur.energy, nerve: cur.nerve, garage: cur.garage, fenceBps: cur.fenceBps } : null,
        next: next ? { name: next.name, min: next.min, need: Math.max(0, next.min - eff) } : null };
    })(),
    disciplines: Object.fromEntries(REGIMEN.DISCIPLINES.map((d) =>
      [d.id, disciplineLvlOf(Number(owned.disciplines?.[d.id] || 0))])),
    // (red-team R5) mirror the canonical trunkCap() exactly — the display had omitted the road_boss
    // capstone's +trunk, showing a maxed Wheelman a smaller trunk than the enforcement actually gives.
    // THE CREW BONUS — the respect multiplier every recruit you brought in is currently worth.
    // Shown as a percentage so the sheet can say "+15% respect" rather than a bare float.
    crewBonusPct: Math.round((Number(owned.refBonus) || 0) * 100),
    cargoCap: cargoCapacity(assets)
      + (owned.skills?.has('pack_mule') ? SKILLS.FX.TRUNK_BONUS : 0)
      + (owned.skills?.has('road_boss') ? SKILLS.FX.ROAD_BOSS_TRUNK : 0)
      + ladderFx(acct, 'trunk'),   // mirror trunkCap() exactly — the R5 lesson
    skills: [...(owned.skills || [])],
    // FIVE PILLARS #1 — the honor axis (Fable): the value + tier the world reads you by, plus the
    // Tier-4 bloodline LEGEND (the dynasty's high-water honor + deepest infamy — survives death)
    honor: { value: Number(ch.honor || 0), tier: honorTierOf(ch.honor || 0).name,
      peak: Number(acct?.honor_peak || 0), peakTier: honorTierOf(acct?.honor_peak || 0).name,
      low: Number(acct?.honor_low || 0), lowTier: honorTierOf(acct?.honor_low || 0).name },
    // (red-team R5) mirror pointsOf() — total = level-derived + the prestige bonus the learn-gate grants;
    // the display had omitted the prestige points, under-reporting a prestiged bloodline's real budget.
    skillPoints: (() => {
      const fromLevel = Math.floor(lvl / SKILLS.LVL_PER_POINT);
      const prestigeBonus = Math.min(SKILLS.PRESTIGE_POINT_MAX, Math.floor(Number(acct?.prestige || 0) / SKILLS.PRESTIGE_PER_POINT));
      const total = fromLevel + prestigeBonus;
      const spent = [...(owned.skills || [])].reduce((a, id) => a + (skillOf(id)?.cost || 0), 0);
      return { total, spent, available: Math.max(0, total - spent) }; })(),
    rackets: owned.rackets || [], assets, businesses: owned.businesses || [], speakeasy: owned.speakeasy || null, fighters: owned.fighters || [], cargo: owned.cargo || {}, items: owned.items || {}, gear,
    // ASSETS & RACKETS → Tier 4 — per-racket upgrade levels, THE TYCOON legend, the EMPIRE-SET titles
    racketLevels: owned.racketLevels || {},
    // …and what each owned racket actually EARNS at its level, computed HERE off the same
    // `racketIncomeLeveled` the accrual pays from. The console used to derive this itself —
    // `income × (1 + lvl × (rules.empire.upStep || 0.12))`, rounded, with a hardcoded fallback for
    // a lever the founder can retune. The client never re-derives game math is a rule this file
    // states and nothing enforced; this is the number the Empire card wants, so send it.
    racketIncomePerHr: Object.fromEntries((owned.rackets || []).map((id) =>
      [id, Math.floor(racketIncomeLeveled(id, owned.racketLevels?.[id]) * 60)])),
    tycoon: { earned: Number(acct?.tycoon_earned || 0), rank: tycoonRankOf(acct?.tycoon_earned).name },
    empireTitles: empireTitles(owned.rackets || [], assets),
    // THE OPERATION SLOTS — how many income operations you may run at once, and how many you're
    // running. Computed HERE from the same helpers the tills gate on (rules-level `opSlotsOf` +
    // the income-asset category), so the Empire card can never advertise a seat buyRacket refuses.
    ops: (() => {
      const incomeAssets = assets.filter((id) => ASSETS.find((a) => a.id === id)?.cat === OPERATIONS.INCOME_ASSET_CAT);
      // STREET DEEDS 2C — the own-corner op seat rides the SAME opSlotsOf the till gates on
      const slots = opSlotsOf(lvl, !!owned.deedSeat);
      const used = (owned.rackets || []).length + incomeAssets.length;
      return { used, slots, free: Math.max(0, slots - used), nextAt: nextOpSlotLevel(lvl),
        max: OPERATIONS.SLOTS_MAX, incomeAssets, meteredCat: OPERATIONS.INCOME_ASSET_CAT };
    })(),
    // BUSINESS EMPIRE → Tier 4 — THE LAUNDERER legend (lifetime washed, survives death) + the fronts set titles
    launderer: { washed: Number(acct?.laundered_lifetime || 0), rank: launderRankOf(acct?.laundered_lifetime).name },
    frontTitles: frontTitles(owned.businesses || []),
    // THE COMMISSION → Tier 4 — THE STATESMAN legend (lifetime political capital, survives death)
    statesman: { statecraft: Number(acct?.statecraft || 0), rank: statesmanRankOf(acct?.statecraft).name },
    // `value` is the SAME damage-adjusted book figure loans.js checks a pledge against, so the
    // client's collateral picker and the server's floor can never disagree about what a car is worth.
    cars: (owned.cars || []).map((c) => ({ id: c.id, model: c.model_id, trim: c.trim_id, dmg: c.dmg, plate: c.plate || null, listed: !!c.listed, pledged: !!c.pledged, tune: Number(c.tune || 0), raceLimit: c.race_limit != null ? Math.floor(Number(c.race_limit)) : null, value: carCollateralValue(c.model_id, c.trim_id, c.dmg), rarity: String(c.rarity || 'common'), run: c.run_id || null, runName: c.run_id ? (runOf(c.run_id)?.name || c.run_id) : null, serial: c.serial != null ? Number(c.serial) : null, runCap: c.run_id ? (runOf(c.run_id)?.cap || null) : null })),
    // v3 step 7: extracted cars are NOT in `cars` (loadOwned filters them so they are inert) — the
    // sheet still names them, because a player who paid to take one on-chain should see it.
    // THE SHIPMENT (scarcity §3) — the contested material you're holding, and the pieces it bought
    shipment: Number(ch.shipment || 0),
    bespoke: (owned.bespoke || []).map((b) => ({ id: b.commission_id, serial: Number(b.serial) })),
    nftCars: (owned.nftCars || []).map((c) => ({ id: c.id, model: c.model_id, name: carOf(c.model_id)?.name || c.model_id, rarity: String(c.rarity || 'common') })),
    gang: owned.gang ? { id: owned.gang.id, name: owned.gang.name, tag: owned.gang.tag, role: owned.gangRole,
      color: owned.gang.color || null, seal: sealOf(owned.gang.seal)?.name || null,
      foundation: foundationOf(owned.gang.foundation)?.name || null, foundationTier: Number(owned.gang.foundation || 0),
      treasury: Math.floor(Number(owned.gang.treasury)), ammoBank: Number(owned.gang.ammo_bank),
      held: owned.held } : null,
    lab: ch.lab || null, crew: Number(ch.crew || 0),
    // LAB MODULES (Tier-4) — the purity/yield/stealth upgrade axis.
    // The NEXT price rides along, because the cost is a function of the module's own level AND the
    // lab tier (labModuleCost), so the client cannot derive it — and a tester who could not see it
    // upgraded blind and asked "doesn't say price / 100k I just spent?". The lab-tier button two
    // lines above in the same card has always priced itself; this makes the pair honest.
    labModules: { purity: Number(ch.lab_purity || 0), yield: Number(ch.lab_yield || 0), stealth: Number(ch.lab_stealth || 0) },
    labModuleNext: Object.fromEntries(['purity', 'yield', 'stealth'].map((id) =>
      [id, labModuleCost(id, Number(ch[`lab_${id}`] || 0), KITCHENS.findIndex((k) => k.id === ch.lab))])),
    // THE KINGPIN LEGEND (Tier-4) — lifetime product moved (account-level, survives death)
    kingpin: { moved: Number(acct?.product_moved || 0), rank: kingpinRankOf(acct?.product_moved).name },
    // recurring sinks — the crew's nut: what's owed, the hourly rate, and whether they've downed tools
    // THE NUT, MADE LEGIBLE (the pad precedent, same defect class): a hand costs a flat wage on the
    // wall clock but only EARNS while there is stash to move, so the terms have to ride with the
    // price — the per-head rate, the countdown to downed tools, and the door out.
    crewWageOwed: crewWageOwed(ch), crewWagePerHr: Number(ch.crew || 0) * M4.CREW_WAGE_PER_HR, crewCold: crewCold(ch),
    crewWagePerHead: M4.CREW_WAGE_PER_HR, crewMax: M4.CREW_MAX, crewCostStep: M4.CREW_COST_STEP,
    // WHAT THE NEXT HAND COSTS, from the side that charges it. The hire price CLIMBS with headcount,
    // and the board published only the STEP — so the console restated the ladder (`step × (crew+1)`)
    // with a hardcoded `|| 50000` under it, and an agent reading the view could not know the formula
    // at all. Two restatements of one rule, which is how they come to disagree (the jailed/penSafe
    // collapse); and a hardcoded price behind a missing field is the guessed number wearing a hat
    // (the ALCHEMIST_ASSET_DECIMALS fallback RT#6 deleted). One field, computed where it is charged.
    crewNextCost: Number(ch.crew || 0) >= M4.CREW_MAX ? null : M4.CREW_COST_STEP * (Number(ch.crew || 0) + 1),
    crewColdSeconds: Number(ch.crew || 0) > 0 && ch.crew_paid_at
      ? Math.max(0, Math.ceil((new Date(ch.crew_paid_at).getTime() + M4.CREW_WAGE_COLD_MS - Date.now()) / 1000)) : null,
    makings: owned.makings || {},
    stash: (owned.stash || []).filter((s) => Number(s.qty) > 0)
      .map((s) => ({ drug: s.drug_id, qty: Number(s.qty), quality: Math.round(Number(s.quality) * 100) / 100 })),
    batch: owned.batch ? { drug: owned.batch.drug_id, qty: Number(owned.batch.qty),
      readySeconds: Math.max(0, Math.ceil((new Date(owned.batch.done_at) - Date.now()) / 1000)) } : null,
    tradeRank: tradeRankIdx(Number(ch.trade_rep || 0)),
    // F6 — THE TRADES, ON EVERY SCREEN THAT FEEDS THEM. The full board is GET /v1/mastery; this is
    // the compact twin, computed off the SAME helpers (so board and sheet can never disagree) and
    // carried on the view because loadOwned already holds the XP map — a screen showing "this job
    // is schooling you" costs zero extra queries and zero extra round trips. Levels/ranks are
    // SERVER-computed (the tradeRank precedent — the client never re-derives game math).
    // Pure status: XP is not a currency and nothing here writes a ledger row.
    trades: MASTERY.TRACKS.map((t) => {
      const xp = Number((owned.mastery || {})[t.id] || 0);
      const lvl = masteryLvlOf(xp);
      let mi = -1; for (const m of MASTERY.MILESTONES) if (lvl >= m) mi++;
      const perk = MASTERY.PERKS[t.id];
      const capped = lvl >= MASTERY.MAX_LVL;
      const at = lvl > 1 ? masteryXpFor(lvl) : 0, next = capped ? null : masteryXpFor(lvl + 1);
      return { id: t.id, name: t.name, xp, lvl, rank: masteryRankOf(lvl),
        nextAt: next,
        // the bar the client draws — progress THROUGH the current level, not from zero
        pct: capped ? 100 : Math.max(0, Math.min(100, Math.round((xp - at) / Math.max(1, next - at) * 100))),
        perkWhat: perk ? perk.what : null,
        // the next milestone that deepens the perk (null once every rung is behind you)
        perkNextAt: mi < MASTERY.MILESTONES.length - 1 ? MASTERY.MILESTONES[mi + 1] : null };
    }),
    // F4 — set only on the response to the action that CROSSED a level (never on a plain read), so
    // the client can name the rank and what just opened instead of noticing a number moved.
    ...(ch._leveled ? { leveled: ch._leveled } : {}),
    heistSeconds: ch.heist_at ? Math.max(0, Math.ceil((new Date(ch.heist_at) - Date.now()) / 1000)) : 0,
    // PACING: the two new activity cooldowns, so the client can show a live timer instead of
    // surfacing a bare `cooldown` error when a player hits the gym or the family's next job.
    trainSeconds: ch.train_at ? Math.max(0, Math.ceil((new Date(ch.train_at) - Date.now()) / 1000)) : 0,
    missionSeconds: ch.mission_at ? Math.max(0, Math.ceil((new Date(ch.mission_at) - Date.now()) / 1000)) : 0,
    prestige: Number(acct.prestige || 0), recruits: Number(acct.recruits || 0),
    // THE ESTATE — your compound at a glance (GET /v1/estate is the full house). Account-level status,
    // survives death (the heir inherits it). Null until you buy your first place.
    estate: owned.estate ? { name: owned.estate.name || null, tier: Number(owned.estate.tier || 0),
      tierName: estateTierOf(Number(owned.estate.tier || 0))?.name || null } : null,
    wallet: acct.wallet_address || null,
    minted: !!acct.minted, respawnTokens: Number(acct.respawn_tokens || 0), mintCredits: Number(acct.mint_credits || 0),
    hitmanRep: Number(acct.hitman_rep || 0), kills: Number(acct.kills || 0), seasonKills: Number(ch.season_kills || 0),
    hitmanTitle: hitmanRankOf(Number(acct.hitman_rep || 0)).title,
    onboard: typeof acct.onboard === 'string' ? JSON.parse(acct.onboard || '{}') : (acct.onboard || {}),
    // the guided next-step advisor: `coach` is THE next move (unchanged shape), `coachPlan` is the
    // whole queue — up to 5 applicable rungs in priority order (the client's "your next moves" box)
    ...(() => { const plan = coachLadder(ch, acct, owned); return { coach: plan[0] || null, coachPlan: plan }; })(),
    netWorth: Math.floor(Number(ch.cash) + Number(ch.bank) + assetsValue(assets)),
    cityEvent: cityEventOf(dayOf()).id,
    // THE LIVING WORLD — the city at a glance: the two event tracks + the intraday clock (GET /v1/city
    // is the full forecast). Kept beside the legacy `cityEvent` id (unchanged for back-compat).
    city: (() => { const ev = cityEventOf(dayOf()), law = cityLawEventOf(dayOf()), hr = cityHourOf();
      return { event: ev.id, name: ev.name, lawEvent: law.id, hour: hr.hour, phase: hr.phase, patrol: hr.patrol }; })() };
}

// THE TAKE (Street War step three, founder-directed) — debit the drawn mark for what their pocket
// can cover, so a job's cash comes off SOMEBODY instead of out of nowhere. Returns the funded
// amount (0 when there was nobody to take from, they were too poor, or their row was busy).
//
// It NEVER BLOCKS, by construction, and that is the whole lock argument. withCharacter already
// holds the actor's row, so any second character lock taken here would invert against every
// two-party path that locks its pair SORTED (a duel, a bout, a hire, a favor run) — an AB-BA the
// 40P01 retry would merely paper over. So the debit runs behind `FOR UPDATE SKIP LOCKED`: a
// contended mark is simply SKIPPED and the faucet pays the whole take, which is an independently
// correct outcome, so the fallback costs the player nothing.
//
// pg-mem parses neither SKIP LOCKED nor NOWAIT, so the suite exercises the plain conditional
// UPDATE — IDENTICAL accounting, only a different blocking posture (it can wait). The capability
// is read from dbCaps, decided once at makeDb, rather than probed mid-transaction: a failed probe
// would abort the enclosing txn in real Postgres (the SAVEPOINT lesson). The no-block property is
// verified against a real Postgres, never against pg-mem.
async function takeFromMark(client, h, ch, markRow, take) {
  const T = RIVALS.TAKE;
  const pocket = Math.floor(Number(markRow.cash) || 0);
  const want = Math.min(take, Math.floor(pocket * T.POCKET_BPS / 10000));
  if (!(want >= T.MIN)) return 0; // dust, or a mark with nothing on them — the faucet pays
  const sql = dbCaps.skipLocked
    ? `UPDATE characters SET cash = cash - $2 WHERE id = (
         SELECT id FROM characters WHERE id=$1 AND alive AND is_npc AND cash >= $2
         FOR UPDATE SKIP LOCKED
       ) RETURNING id`
    : 'UPDATE characters SET cash = cash - $2 WHERE id=$1 AND alive AND is_npc AND cash >= $2 RETURNING id';
  let hit = 0;
  // (audit F5) HONEST about what this catch buys. It stops a client-side throw escaping, and that is
  // ALL: in real Postgres a failed statement aborts the ENCLOSING transaction (25P02), so if the
  // server ever rejects this one, swallowing it does not keep the job alive — the next `h.ledger` dies
  // too and withCharacter rolls the action back. Making the claim literally true needs a SAVEPOINT,
  // which pg-mem cannot parse, so it would ship a path no suite can reach (the recordRival lesson).
  // Left as-is deliberately: with SKIP LOCKED this statement does not wait, so it has no deadlock and
  // no lock_timeout to hit, and the only realistic error is a statement_timeout on a request that was
  // already 15s deep and failing anyway. Do NOT copy this catch to a path that can genuinely error.
  try { hit = (await client.query(sql, [markRow.id, want])).rowCount; }
  catch { return 0; }
  if (!hit) return 0;
  await h.ledger(client, { characterId: markRow.id, currency: 'cash', amount: -want, reason: 'crime:take', counterparty: ch.id });
  return want;
}

// ── §7.2 CRIME ──
export function doCrime(ch, crimeId, client, h, approach) {
  const c = CRIMES.find((x) => x.id === crimeId);
  if (!c) throw new GameError('bad_crime', 'No such job.');
  const lvl = levelOf(Number(ch.respect));
  if (jailed(ch)) throw new GameError('jailed', 'You are in lockup.');
  if (lvl < c.lvl) throw new GameError('level', `That job needs level ${c.lvl}.`);
  if (Number(ch.nerve) < c.nerve) throw new GameError('nerve', `Takes ${c.nerve} nerve.`);
  // D6a — THE APPROACH: the per-job risk/reward choice. An unknown/omitted approach falls back to
  // 'standard' (the signed baseline, byte-identical to the old single-click behaviour). Cash EV is
  // held ~flat by payMult ≈ 1/successMult, so the §7.2 cash faucet is untouched; the choice moves the
  // secondary axes (variance, materials, rep, heat, bust severity).
  const ap = M3.CRIME_APPROACHES[approach] || M3.CRIME_APPROACHES.standard;
  ch.nerve = Number(ch.nerve) - c.nerve;
  // Going LOUD is noisy whether you get away or not — it draws law heat on the attempt (feeds the RICO
  // meter). Quiet/standard add none. Clamped [0,100] like every other heat bump.
  if (ap.heat) ch.heat = Math.min(100, Number(ch.heat || 0) + ap.heat);
  const ev = cityEventOf(dayOf());
  const rIdx = rankIdxOf(lvl);
  // STREET DEEDS 2C — the controller's turf perk: districts whose corner you control count like
  // family turf at the three PERK reads below (brick success / canal cash / docks crates). OR by
  // SET-UNION — every site is an `.includes(x)`, so a district in both lists applies its perk
  // exactly once (never stacks). Family-only machinery (war, seizure, boards) never reads this.
  const held = [...(h.owned?.held || []), ...(h.owned?.deedPerk || [])];
  const eff = (s) => effStat(ch[s], s, h.owned?.assets || [], h.owned?.gear || []);
  // §7.2 full chance: stats + gang level (treasury tiers) + Brick Yards turf + rank, then the approach
  // (quiet safer / loud riskier), all under the same 0.97 ceiling so quiet's edge tapers for a maxed street.
  const gangLevel = h.owned?.gang ? gangLevelOf(h.owned.gang.treasury) : 0;
  // D14 (SIGNED — option A): the stat contribution is a lever (M3.CRIME_STAT), steepened + offset so
  // a mid build is unchanged and the investment is felt. MUSCLE stays out of crime by design. The
  // OFFSET can push the pre-mult sum below 0 for an untrained street on a hard job — that is the
  // intended "an unskilled crook fumbles the hard score"; the final chance is a probability, and
  // Math.random() < (negative) is simply never true, so it needs no extra clamp.
  const cs = M3.CRIME_STAT;
  const statEdge = eff('cunning') * cs.CUN + eff('speed') * cs.SPD - cs.OFFSET;
  const chance = Math.min(0.97, (c.base + statEdge
    + gangLevel * 0.02 + (held.includes('brick') ? 0.02 : 0) + (rIdx >= 9 ? 0.02 : 0)) * ap.successMult);
  const roll = Math.random();
  return (async () => {
    // SOLDIERS: the assigned, fit second rides along (assists + takes a cut + carries the risk)
    const second = await assignedSoldier(client, ch.id);
    // THE MARK (founder: "crimes can't just be committed against nobody") — every job names a
    // victim drawn from the NPC RESIDENTS standing in your district (real characters, the
    // population layer), falling back to the fictional noir pool. STEP THREE (founder-directed,
    // explicitly including the transfer) makes the mark a real SOURCE: see takeFromMark below.
    // Never a real PLAYER — a stranger's crime roll gives them no consent, no notification and no
    // counterplay; taking from a player is what the gated PvP asset crimes are for.
    const markRow = await (async () => {
      try {
        const r = (await client.query(
          'SELECT id, name, cash FROM characters WHERE alive AND is_npc AND loc=$1 AND id<>$2 ORDER BY id LIMIT 8',
          [ch.loc, ch.id])).rows;
        // (audit F4) its OWN draw, NOT `roll`. `roll` is the success die and the branch below reads
        // `roll < chance`, so reusing it CONDITIONS the victim on the outcome: on a SUCCESS the index
        // can only ever land in [0, chance × 8), i.e. the first few residents by id — and `ORDER BY id`
        // is stable, so THE TAKE debited the same two or three residents in a district forever while
        // the rest were never touched. Harmless to §10.4 (the unfunded remainder is just paid by the
        // faucet), but it concentrated the drain onto a handful of marks, picked them clean, and left
        // the measured emission reduction well below what P9.27 models across the whole district.
        if (r.length) return r[Math.floor(Math.random() * r.length) % r.length];
      } catch { /* the mark is never allowed to fail a job */ }
      return null;
    })();
    const mark = markRow ? markRow.name
      : `${SOLDIERS.FIRST[Math.floor(roll * 1000) % SOLDIERS.FIRST.length]} ${SOLDIERS.LAST[Math.floor(roll * 100000) % SOLDIERS.LAST.length]}`;
    if (roll < chance) {
      // THE APPROACH pay: payMult ≈ 1/successMult keeps cash EV flat; loud may carry a founder-set
      // cash premium (default 1.0 = EV-neutral). Rides the same crime:<id> faucet (ledgered==credited).
      const payM = ap.payMult * (ap.id === 'loud' ? (M3.CRIME_LOUD_CASH_PREMIUM ?? 1) : 1);
      let take = Math.floor((c.cash[0] + Math.random() * (c.cash[1] - c.cash[0]))
        * (held.includes('canal') ? 1.1 : 1)                       // Canal Row turf +10%
        * (rIdx >= 1 ? 1.05 : 1) * (rIdx >= 8 ? 1.10 : 1)
        * roleMultOf(h.owned?.gangRole) * (ev.jobPay || 1) * payM);
      // the second's cut comes OFF THE TOP before the books — the crime faucet only SHRINKS
      // (ledgered amount == credited amount; strictly §10.4-safe, no new reason)
      let soldierCut = 0;
      if (second) { soldierCut = Math.floor(take * SOLDIERS.CUT_BPS / 10000); take -= soldierCut; }
      const rep = Math.round(c.respect * (ev.crimeRep || 1) * ap.repMult);
      ch.cash = Number(ch.cash) + take; gainRespect(h, ch, rep); ch.lc_crime += 1;
      // THE TAKE (step three) — the mark funds what their pocket covers; the §7.2 faucet pays only
      // the REMAINDER. The player's payout is IDENTICAL either way, so this re-SOURCES crime rather
      // than retuning it — and it strictly REDUCES emission, because the funded share is a TRANSFER
      // (both legs ledgered, netting zero) instead of a mint.
      const funded = markRow ? await takeFromMark(client, h, ch, markRow, take) : 0;
      if (funded > 0)
        await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: funded, reason: 'crime:take', counterparty: markRow.id });
      if (take - funded > 0)
        await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: take - funded, reason: `crime:${c.id}` });
      // §7.2 contraband crates: Docks turf ×1.5, event cbMult, the approach (loud grabs more, quiet less)
      const pCrate = (0.25 + Number(ch.nerve) * 0.02) * (ev.cbMult || 1) * (held.includes('docks') ? 1.5 : 1) * ap.crateMult;
      let crates = 0;
      if (Math.random() < pCrate) {
        crates = 1 + Math.floor(Number(ch.nerve) / 8);
        ch.cb = Number(ch.cb || 0) + crates;
        await h.ledger(client, { characterId: ch.id, currency: 'cb', amount: crates, reason: `crime:${c.id}:cb` });
      }
      // §7.2 makings drop: P = 0.15 × the approach (loud +50% / quiet −50%), a random unlocked line
      let makingsDrop = null;
      if (Math.random() < 0.15 * ap.makingsMult) {
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
      await bumpMastery(client, h, ch, 'larceny', 'crime'); // THE TRADES — a pulled job is the larceny grind
      await bumpCrewObjective(client, h, ch, { crimes: 1, earn: take }); // THE CREW OBJECTIVE — a job feeds the crimes/earn goals
      await logCollect(client, ch.account_id, 'crimes', c.id); // THE COLLECTION — first pull of each job
      const soldier = second ? await soldierResult(client, h, ch, second, { success: true }) : null;
      // CLUE SCROLLS (slate #4): a rare treasure-trail drop — decorative on the crime path
      // (a scroll isn't currency, §10.4-free; never fail a job for it). One active hunt per
      // street + the post-casket cooldown bound it. CLUE_DROP_P is a TEST-ONLY roll knob.
      let clue = null;
      try {
        const clueP = process.env.CLUE_DROP_P != null ? Number(process.env.CLUE_DROP_P) : CLUES.DROP_P;
        const clueRoll = Math.random();
        if (!(ch.clue_at && new Date(ch.clue_at) > new Date()) && clueRoll < clueP) {
          // (red-team) a bare swallow can't keep a REAL-Postgres txn healthy if a statement in here
          // errors — guard the writes with a SAVEPOINT where supported (the collection.js probe
          // pattern; pg-mem lacks SAVEPOINT and also doesn't poison txns, so bare is safe there)
          if (clueSavepoints === null) {
            try { await client.query('SAVEPOINT clue_probe'); await client.query('RELEASE SAVEPOINT clue_probe'); clueSavepoints = true; }
            catch { clueSavepoints = false; }
          }
          if (clueSavepoints) await client.query('SAVEPOINT clue_drop');
          try {
            const held = (await client.query('SELECT 1 FROM clue_scrolls WHERE character_id=$1', [ch.id])).rows[0];
            if (!held) {
              const salt = crypto.randomUUID();
              // TIER-4 §A: roll the trail TIER (weighted — harder is rarer); it sets the step count
              const tier = rollClueTier(Math.random());
              const nSteps = tier.steps;
              await client.query('INSERT INTO clue_scrolls (character_id, salt, step, steps, tier) VALUES ($1,$2,1,$3,$4)', [ch.id, salt, nSteps, tier.id]);
              // (red-team flag) the entry ticket to a cash faucet is audited randomness
              await h.rngLog(client, ch.id, 'clue:drop', clueRoll, `${tier.id} scroll dropped (${nSteps} steps)`);
              clue = { steps: nSteps, tier: tier.id, tierName: tier.name, riddle: clueStepOf(salt, 1).riddle };
              await notify(client, ch.id, 'clue_found', clue);
            }
            if (clueSavepoints) await client.query('RELEASE SAVEPOINT clue_drop');
          } catch (e) {
            if (clueSavepoints) await client.query('ROLLBACK TO SAVEPOINT clue_drop').catch(() => {});
            clue = null;
          }
        }
      } catch { /* the trail is a bonus, never a blocker */ }
      return { ok: true, success: true, approach: ap.id, take, rep, crates, makingsDrop, clue,
        victim: mark, markTook: funded, soldier: soldier ? { ...soldier, cut: soldierCut } : null };
    }
    // GETAWAY (skills): the wheelman's stints run shorter — a new modifier, sign-off lever.
    // A WHEELMAN soldier stacks the same way (a second behind the wheel — SOLDIERS sign-off lever).
    // THE APPROACH: a loud bust does harder time (jailMult 1.4), a cased job softer (0.8).
    const jailS = Math.round(c.jail * (ev.jailMult || 1) * (rIdx >= 5 ? 0.8 : 1) * ap.jailMult
      * skillMult(h, 'getaway', SKILLS.FX.JAIL_MULT)
      * masteryFx(h, 'larceny') // TRADES perk (pacing — stacks with getaway; flagged in BALANCE)
      * pathFx(ch, 'jailStint') // PATHS v2 — the Kitchen's handicap (the Bureau knows a cook)
      * (second?.trait === 'wheelman' ? Math.max(0, 1 - soldierFxOf(second)) : 1));
    if (jailS > 0) ch.jail_until = new Date(Date.now() + jailS * 1000);
    await h.rngLog(client, ch.id, `crime:${c.id}`, roll, 'fail');
    await h.track(client, ch.account_id, 'crime_attempt', { id: c.id, success: false });
    // the bust is the RISKY outcome — the second can get hurt, or worse
    const soldier = second ? await soldierResult(client, h, ch, second, { success: false, cause: 'busted on a job' }) : null;
    return { ok: true, success: false, approach: ap.id, jailSeconds: jailS, victim: mark, soldier };
  })();
}

// ── §7.3 TRAIN ──
export async function train(ch, stat, client, h) {
  if (!['muscle', 'cunning', 'speed'].includes(stat)) throw new GameError('bad_stat', 'No such stat.');
  if (jailed(ch)) throw new GameError('jailed', 'No gym in lockup.');
  if (Number(ch.energy) < 10) throw new GameError('energy', 'Too tired to train.');
  // PACING (founder-directed, from live alpha): the gym had NO cooldown and no cash cost, so at the
  // old 40/min energy regen it ran ~240 sessions an hour — which is how a tester cleared every
  // mission STAT gate (up to 155 in three stats) in one sitting and cascaded the whole ladder.
  // A per-session cooldown makes stat gates a multi-day investment. TRAIN_CD_MS = 0 disables it;
  // `train_at` is direct-SQL (outside persistCharacter's positional UPDATE — the active_at pattern).
  const trainCd = Number(process.env.TRAIN_CD_MS ?? PACING.TRAIN_CD_MS);
  if (trainCd > 0 && ch.train_at && new Date(ch.train_at) > new Date())
    throw new GameError('cooldown', `The body needs a minute. Back to the gym in ${Math.max(1, Math.ceil((new Date(ch.train_at) - Date.now()) / 60000))}m.`);
  ch.energy = Number(ch.energy) - 10;
  const trainAt = new Date(Date.now() + trainCd);
  await client.query('UPDATE characters SET train_at=$2 WHERE id=$1', [ch.id, trainAt]);
  ch.train_at = trainAt;
  const gain = Math.max(1, Math.round((1 + Math.random() * 2) * (200 / (200 + ch[stat]))));
  ch[stat] += gain;
  await h.bumpDaily(client, ch.id, 'train');
  return { ok: true, stat, gain, nextTrainSeconds: trainCd > 0 ? Math.ceil(trainCd / 1000) : 0 };
}

// ── §5.1 HEAL ──
// THE DOC'S BILL, quoted where the money moves so the SHEET and the till can never disagree — the
// hunterSearchMs shape (several readers, one implementation). The button beside the money figure
// said only "heal": a price with the purchase left off, BEFORE the press rather than after it, on
// the one screen a player reaches while bleeding. The client cannot supply it either — the bill
// stacks FIVE independent modifiers (street rank, doctors_friend, the Doc's own standing, Iron
// Chin, the Ring's handicap), so only the server knows what the Doc actually wants right now.
// Takes `owned` rather than `h` because the view has no handle, and the two touchpoint helpers it
// calls read nothing else off one.
export function healCostOf(ch, owned = {}) {
  const lvl = levelOf(Number(ch.respect));
  // THE DOC'S FRIEND (skills) and DOC MORETTI T1 (underworld) both discount the bill —
  // new modifiers stacking multiplicatively (0.75 × 0.9), both sign-off levers
  // THE REGIMEN — Iron Chin: 1%/level off the bill, floored (a new stack, the doctors_friend shape)
  const chinLvl = disciplineLvlOf(Number(owned.disciplines?.conditioning || 0));
  const chin = Math.max(REGIMEN.CONDITIONING_FLOOR, 1 - REGIMEN.CONDITIONING_BPS * (chinLvl - 1) / 10000);
  return Math.floor((100 - Math.floor(Number(ch.health))) * 15 * (rankIdxOf(lvl) >= 4 ? 0.9 : 1)
    * skillMult({ owned }, 'doctors_friend', SKILLS.FX.DOC_MULT)
    * npcMult({ owned }, 'doc', 1, UNDERWORLD.FX.DOC_MULT)
    * chin
    * pathFx(ch, 'healCost')); // PATHS v2 — the Ring's handicap (a brawler's medical bills)
}
export async function heal(ch, client, h) {
  const cost = healCostOf(ch, h.owned);
  if (cost <= 0) throw new GameError('healthy', 'Already healthy.');
  if (Number(ch.cash) < cost) throw new GameError('cash', `The Doc wants ${usd(cost)}.`);
  // WHAT THE BILL BOUGHT. The reply carried the price alone, so the toast read a bare "paid $540" —
  // a price with the purchase left off, on the one screen a player reaches while bleeding. The client
  // cannot supply the missing half either way: the bill is scaled by FIVE independent modifiers
  // (street rank, doctors_friend, the Doc's own standing, Iron Chin, the Ring's handicap), so only
  // the server knows both what was restored and what it really charged for it.
  const healed = 100 - Math.floor(Number(ch.health));
  ch.cash = Number(ch.cash) - cost; ch.health = 100;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'heal' });
  await bumpStanding(client, h, ch, 'doc', 2, { action: 'heal' }); // doing business with the Doc
  return { ok: true, cost, healed, health: 100 };
}

// ── §7.4 CHECK-IN ──
// THE CHECK-IN'S TERMS, quoted BEFORE the press for the same reason as the Doc's bill: the button
// beside it said only "check in", so the whole ladder was invisible until after the money landed.
// ONE implementation for the quote and the till — `checkin` runs on this too, so what the sheet
// promises is by construction what the till pays. Neither figure is derivable client-side: the
// ladder is level-scaled and the streak rule lives here.
export function checkinQuoteOf(ch, today = dayOf()) {
  const lvl = levelOf(Number(ch.respect));
  const payAt = (s) => 250 * lvl + 100 * lvl * Math.min(s, 7);
  const cur = Number(ch.streak) || 0;
  const done = ch.checkin_day === today;
  // what a press TODAY would make the streak — the rule is kinder than a player will assume (a miss
  // HALVES it, it never zeroes it), so `lapsed` rides only when a gap has actually cost days and the
  // sheet can say so before the press instead of leaving them to think the game ate the run.
  const streak = done ? cur : (ch.checkin_day === today - 1 ? cur + 1 : Math.max(1, Math.floor(cur / 2)));
  return { done, streak,
    pay: done ? null : payAt(streak),
    // the hook stands all day: even once today is claimed, this is what coming back tomorrow pays
    next: streak < 7 ? payAt(streak + 1) : null,
    ...(!done && streak < cur ? { lapsed: cur } : {}) };
}
export async function checkin(ch, client, h) {
  const today = dayOf();
  if (ch.checkin_day === today) throw new GameError('done', 'Already checked in today.');
  const q = checkinQuoteOf(ch, today);
  const was = Number(ch.streak) || 0;
  ch.streak = q.streak; // miss halves, never zero — the rule lives in the quote, so both agree
  ch.checkin_day = today;
  const pay = q.pay;
  ch.cash = Number(ch.cash) + pay;
  const energyBefore = Number(ch.energy);
  ch.energy = Math.min(50 + 2 * levelOf(Number(ch.respect)), Number(ch.energy) + 20);
  h.acct.checkins_lifetime = Number(h.acct.checkins_lifetime || 0) + 1; // referral gate §7.13
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: pay, reason: 'checkin' });
  // FOUND BY PLAYING: this reply carried `pay` and `streak` and nothing else, so the line read
  // "+$105,350 (day 1)" — the streak rendered as a bare COUNTER when it is the money MULTIPLIER:
  // pay climbs 100×lvl for every consecutive day to seven, so day 2 was worth +$30,100 more and the
  // player had no way to know. That is the whole reason to come back tomorrow, and the client cannot
  // compute it — the formula is here and published nowhere (the `crewNextCost` case). Its own
  // sibling one system over (/v1/streak/claim) has stated day/best/rank all along.
  //   `next` is null once the ladder tops out, so the line stops promising a rise that cannot come.
  //   `energyGained` is a DELTA, not the constant: at the cap the top-up grants nothing and a line
  // claiming +20 would be a wrong number, which is worse than a silent one.
  //   `wasStreak` rides only when a gap actually COST days — a run of 6 coming back as 3 reads like
  // the game ate it, and the real rule is kinder than the player will assume (a miss HALVES the
  // streak, it never zeroes it), so the one moment worth saying it is the moment it bites.
  return { ok: true, pay, streak: ch.streak,
    next: q.next,
    // clamped at 0, and not defensively: the cap is LEVEL-scaled and the season rollover resets
    // respect, so a returning player's stored energy can sit ABOVE the new cap — `Math.min` then
    // clamps DOWN and the raw delta is NEGATIVE. "+-99,347 energy" is a wrong number where a silent
    // one would do, which is the thing this whole sweep is about.
    energyGained: Math.max(0, Number(ch.energy) - energyBefore),
    ...(ch.streak < was ? { wasStreak: was } : {}) };
}

// ── BANK & TRAVEL ──
export async function bank(ch, dir, amount, client, h) {
  amount = Math.floor(Number(amount));
  if (!(Number.isFinite(amount) && amount > 0)) throw new GameError('amount', 'Positive amounts only.'); // Number.isFinite rejects Infinity/NaN (E-L3 defense-in-depth)
  if (dir === 'deposit') {
    // BALANCE D2 — shield, not bunker: banking is an EXPOSED act (the courier walks). You can't
    // move money into the vault from inside a safehouse; withdrawing (bringing cash to hand) is fine.
    if (safeHoused(ch))
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
  // A bare {ok:true} told the player nothing — and on a DEPOSIT the thing it withheld is a TERM, not
  // a nicety: the money rides in transit and is lootable off a corpse for the whole window (the
  // comment above says so; the player was never told). Same class as the pad and the nut. Return the
  // figures so the client can say it; `banked`/`withdrew` are distinct names so nothing else's
  // describe() branch can cross-fire on a generic `amount`.
  // FLOORED, because the character sheet floors it (view(), `bank: Math.floor(...)`) and bank interest
  // is genuinely sub-cent. Sent raw, the same balance read two ways depending on which surface you
  // looked at — the sheet said $5,005,565 while the toast said $5,005,065.955 — and a toast is what
  // you read right after moving money. The ledger keeps the exact figure; the display agrees with
  // itself. (board and till can never disagree.)
  const shown = Math.floor(Number(ch.bank));
  return dir === 'deposit'
    ? { ok: true, banked: amount, bank: shown, intransit: Number(ch.bank_intransit || 0), clearSeconds: Math.ceil(CONSTANTS.BANK_CLEAR_MS / 1000) }
    : { ok: true, withdrew: amount, bank: shown };
}
export async function travel(ch, district, client, h) {
  if (!DISTRICTS.find((d) => d.id === district)) throw new GameError('bad_district', 'No such district.');
  if (ch.loc === district) throw new GameError('there', 'You are already there.');
  if (jailed(ch)) throw new GameError('jailed', 'No travel from lockup.');
  if (Number(ch.cash) < CONSTANTS.TRAVEL_COST) throw new GameError('cash', `A ride costs ${usd(CONSTANTS.TRAVEL_COST)}.`);
  ch.cash = Number(ch.cash) - CONSTANTS.TRAVEL_COST; ch.loc = district;
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -CONSTANTS.TRAVEL_COST, reason: 'travel' });
  await logCollect(client, ch.account_id, 'districts', district); // THE COLLECTION — set foot everywhere
  // THE CONVERGENCE NUDGE — a real human just walked into a district. Announce it on the streets
  // channel so anyone STANDING there gets a live "someone real just showed up" push (the collision
  // Home card + the 30s poll surface presence otherwise; this is the instant signal). Presence is
  // already public (/v1/live shows who's in a district), so this leaks nothing. Real humans only —
  // NPC residents move via residentAct (no emit), and agents are excluded like every other human
  // presence surface (the collision board's rule). Best-effort, post-state.
  if (!ch.is_npc && !h?.acct?.agent_flag) bus.emit('streets', { type: 'arrival', who: ch.name, cid: ch.id, district });
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

    // THE $OMR IS RETIRED (founder-directed 2026-07-31: "no longer promise to give away $OMR").
    // What a referral pays now is cash + THE CREW BONUS — a respect multiplier that scales with how
    // far the recruit has got (M4.REF_XP, applied at every respect grant via gainRespect). The bonus
    // needs nothing here: it is derived live in loadOwned from `referrals.qualified_at`, which the
    // line below is what sets. So qualifying a recruit turns the bonus on and this function does not
    // have to hand anything over for it.
    const mult = await referralPushMult(client); // recruitment-drive CASH multiplier (1 when no push)
    const recruitCash = Math.round(M4.REF_RECRUIT_CASH * mult), recruiterCash = Math.round(M4.REF_RECRUITER_CASH * mult);
    recruit.cash = Number(recruit.cash) + recruitCash;
    recruiter.cash = Number(recruiter.cash) + recruiterCash;
    await ledger(client, { characterId: recruit.id, currency: 'cash', amount: recruitCash, reason: 'referral:recruit' });
    await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: recruiterCash, reason: 'referral:recruiter', counterparty: recruit.id });

    // recruiter ladder: recruits++ and any milestones crossed (cash faucet).
    // `m.omr` is deliberately NOT read: RECRUIT_MILESTONES is MACHINE-OWNED (ground rule #2), so the
    // field stays in the generated table and this simply stops paying it. Deleting it would mean
    // editing the prototype and re-extracting for no behavioural gain.
    const before = Number(recruiterAcct.recruits), after = before + 1;
    let milestoneCash = 0, title = null;
    for (const m of RECRUIT_MILESTONES.filter((m) => m.n > before && m.n <= after)) {
      milestoneCash += Math.round((m.cash || 0) * mult); // the drive multiplies milestone cash too
      if (m.title) title = m.title;
    }
    if (milestoneCash > 0) {
      recruiter.cash = Number(recruiter.cash) + milestoneCash;
      await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: milestoneCash, reason: 'referral:milestone' });
    }
    if (title) recruiter.title = title;

    // BRING ONE — the first-crewmate incentive. A qualified recruit who runs in their recruiter's
    // crew earns both a bonus (rewarding the recruiter who brought a friend AND ran with them).
    // crew_members is account-keyed; a plain read — no FOR UPDATE (a leaf in this transaction, so no
    // lock-order concern). Bounded: gated behind the entire qualification wall, so it inherits every
    // anti-Sybil property (once ever, agent-excluded, L8/40 jobs/3 check-ins/$25k). IN($1,$2) not
    // ANY(array) — pg-mem returns zero rows for ANY-of-array (the same-IP flag lesson below).
    let bringOne = false;
    const crews = (await client.query('SELECT account_id, crew_id FROM crew_members WHERE account_id IN ($1,$2)', [recruitAccountId, recruiterAccountId])).rows;
    const rcCrew = crews.find((r) => r.account_id === recruitAccountId)?.crew_id;
    const rrCrew = crews.find((r) => r.account_id === recruiterAccountId)?.crew_id;
    if (rcCrew && rrCrew && rcCrew === rrCrew) {
      const bRecruit = Math.round(CREW.BRING_ONE.RECRUIT_CASH * mult), bRecruiter = Math.round(CREW.BRING_ONE.RECRUITER_CASH * mult);
      recruit.cash = Number(recruit.cash) + bRecruit;
      recruiter.cash = Number(recruiter.cash) + bRecruiter;
      await ledger(client, { characterId: recruit.id, currency: 'cash', amount: bRecruit, reason: 'crew:bringone' });
      await ledger(client, { characterId: recruiter.id, currency: 'cash', amount: bRecruiter, reason: 'crew:bringone', counterparty: recruit.id });
      bringOne = true;
    }

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
    await notify(client, recruiter.id, 'ref', { from: recruit.name, amt: recruiterCash + milestoneCash, recruits: after, bringOne });
    await notify(client, recruit.id, 'ref', { made: true, amt: recruitCash, bringOne });
    await track(client, recruitAccountId, 'referral_qualified', { recruiter: acct.referred_by, mult, bringOne });
    await client.query('COMMIT');
    return { qualified: true, bringOne };
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

// RECONCILE the tier-2 "family tree" fee (the worker sweep). maybeGrandReferral fires ONCE, from the
// post-commit hook, on the same action that qualified R2 — and that hook never runs again for R2
// (it's gated on `!ref_paid`). So if the grandrecruiter A had NO living character at that instant
// (dead / between heirs), maybeGrandReferral returned null WITHOUT setting the ref_l2_paid latch, and
// the $5k finder's fee was lost forever. This sweep finds every qualified recruit whose whole 2-level
// chain is qualified but ref_l2_paid is still unset, and retries maybeGrandReferral — which pays A the
// moment A next has a living heir, idempotently (the latch + the re-verified gates under lock). The
// candidate set is small (only ref_paid && !ref_l2_paid recruits with a qualified middle link).
export async function sweepGrandReferrals(pool) {
  const cand = (await pool.query(
    `SELECT r2.account_id AS r2 FROM account_persistent r2
       JOIN account_persistent r ON r.account_id = r2.referred_by
      WHERE r2.ref_paid AND NOT r2.ref_l2_paid AND NOT r2.agent_flag AND r2.referred_by IS NOT NULL
        AND r.ref_paid AND NOT r.agent_flag AND r.referred_by IS NOT NULL
      LIMIT 1000`)).rows;
  let paid = 0;
  for (const { r2 } of cand) {
    try { if (await maybeGrandReferral(pool, r2)) paid++; }
    catch (e) { console.error('[sweepGrandReferrals]', r2, e?.code || e?.message || e); }
  }
  return { candidates: cand.length, paid };
}
