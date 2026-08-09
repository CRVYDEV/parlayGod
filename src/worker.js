// §7.12 buyback worker. Every 12h the accumulated street tax buys $OMR through the
// same AMM curve as player swaps: 50% → event fund, 50% split pro-rata across the
// top-25 families by standing (lifetime tribute + 10,000 per war won) into their
// omr_reserve; the undistributed remainder rolls to the fund.
//
// Run standalone: `node src/worker.js` (checks hourly, fires when a cycle is due).
// The hourly tick also runs the §8 season rollover and, once a day, the §10.4
// ledger-invariant sweep. All three are exported for the tests.
import crypto from 'node:crypto';
import { makeDb } from './db.js';
import { testOnlyLeaks } from './preflight.js';
import { pingDb, archiverHealth } from './dbhealth.js';
import { levelOf, dayOf, CONSTANTS, DUELS, COMMISSION, POPULATION, FAMILY_YIELD, recapTitleOf } from './rules.js';
import { recordReckoning } from './season.js';
import { runLedgerInvariants, alertDrift } from './invariants.js';
import { runVigInvariants } from './vig.js';
import { carveExchange, mergeLegacyYieldPools, payFamilyYield, runExchangeInvariants } from './exchange.js';
import { runBondInvariants } from './bonds.js';
import { runTreasuryInvariants } from './treasury.js';
import { openAuction, closeExpired, runDeskInvariants } from './desk.js';
import { sweepExpiredBounties, huntWanted, sweepContests } from './social.js';
import { sweepUncreditedFees } from './fees.js';
import { sweepGrandReferrals } from './game.js';
import { sweepSocialClaims, sweepCapoLicense } from './growth.js';
import { sweepUncreditedStore } from './store.js';
import { sweepPassStipends } from './pass.js';
import { sweepStaleHeists } from './heists.js';
import { sweepStaleBreaks } from './pen.js';
import { sweepStaleRaids, sweepUprisings } from './world.js';
import { sweepFamilyAggro, sweepNpcWars, sweepNpcAggression } from './npcwar.js';
import { sweepWire, sweepWireAlerts, sweepStandingWatches } from './wire.js';
import { reclaimExpiredVouchers, assertChainId, bondOracleHealth } from './chain.js';
import { sweepMarket } from './market.js';
import { sweepDiplomacy, sweepNpcDiplomacy } from './diplomacy.js';
import { settleProposals, activeDecree, seatedGangs } from './commission.js';
import { sweepSecrets } from './secrets.js';
import { sweepRivals } from './rivals.js';
import { generateContactCalls, sweepCalls } from './contacts.js';
import { sweepFavors } from './favors.js';
import { sweepCrewInvites } from './crew.js';
import { sweepMentorOffers } from './mentor.js';
import { settlePrimeTime } from './primetime.js';
import { sweepPush } from './push.js';
import { sweepDispatch } from './dispatch.js';
import { spawnNpcConvoys, despawnArrivedNpc, sweepConvoyHauls } from './convoy.js';
import { runPopulation, runResidentBehaviour } from './population.js';
import { sweepLaw } from './law.js';
import { sweepLoans } from './loans.js';
import { sweepAuctions, sweepConsignments } from './auction.js';
import { sweepMainEvents, enforceBeltDefense } from './boxing.js';
import { sweepTournaments, sweepTrackEntries, sweepFuturity } from './casino.js';
import { sweepRingTables } from './ring.js';
import { sweepGrandPrix } from './races.js';
import { sweepStakes } from './stable.js';
import { syncFeeEvents, syncClaimedEvents, syncTradeFees, syncBondEvents, makeViemSource, DEFAULT_CONFIRMATIONS } from './watcher.js';

const BUYBACK_PERIOD_MS = 12 * 3600 * 1000;

// Returns null when nothing was due, else a summary of the executed buyback.
// `opts.force` ignores the 12h timer (tests); `opts.now` overrides the clock.
export async function runBuyback(pool, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // cheap unlocked due-check so a not-due tick locks nothing. The authoritative pool value is
    // re-read under the lock below, so a take landing between the peek and the lock is not lost.
    const peek = (await client.query('SELECT pool, last_buyback FROM street_tax WHERE id=1')).rows[0];
    const dueMs = now.getTime() - new Date(peek.last_buyback).getTime();
    if (Number(peek.pool) <= 0 || (!opts.force && dueMs < BUYBACK_PERIOD_MS)) {
      await client.query('COMMIT');
      return null;
    }
    // now the singleton, authoritative under lock
    const tax = (await client.query('SELECT pool FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    // THE WINDOW takes the take. With the AMM retired (tokenomics v2 step 2) there is no longer any
    // way to convert cash into $OMR, so this tick no longer buys anything — the street tax's only
    // destination is the redemption window, and `EXCHANGE.FUND_BPS` is 10000 so the whole take goes
    // across. Every cut the house takes in the city is what the window pays out.
    //
    // Gone with the AMM: the $OMR the buyback used to acquire, and therefore the event-fund share,
    // the top-25 family split, the Phase-4 `stake_pool` carve and the protocol-owned-liquidity
    // carve. The family split's successor is the FAMILY YIELD (`payFamilyYield`), which pays $OMR
    // that reaches the pot through the exit toll and the RWA invest slice instead of through a market.
    const toWindow = await carveExchange(client, Number(tax.pool));
    if (toWindow <= 0) { await client.query('COMMIT'); return null; }
    await client.query('UPDATE street_tax SET last_buyback=$1 WHERE id=1', [now]);
    await client.query('COMMIT');
    return { toWindow };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// THE LEGACY POOL MERGE (design §3, "merge into"). `stake_pool` (Phase-4 backed staking yield) and
// `rwa_dividend_pool` (the personal Dynasty dividend) paid INDIVIDUALS. Both payouts retired in step
// 2, and nothing refills either, so whatever they still hold belongs to the family pot.
//
// (red-team A1) This ran INSIDE runBuyback, which returns early unless `street_tax.pool > 0` AND the
// 12h buyback is due — so a $OMR migration was gated behind an unrelated CASH condition. Those two
// pools now have no other drain at all (`claimDividend` is retired and `payStakeRewards` went with
// it), so on a server whose take happens to be quiet the merge would never run and real,
// player-earned $OMR would sit stranded forever. Nothing would alarm: both pools are inside
// `omrBuckets`, so conservation stays exact the whole time it is unreachable. It gets its own tick
// step, which is also what it always should have been — it is not the buyback's business.
//
// Deliberately a DRAIN, not a one-shot migration: draining an empty pool is a no-op, so running it
// every tick is idempotent by construction — no migration flag to get wrong, no way to double-apply,
// and it self-heals if a balance somehow lands in an old pool later. All three singletons are inside
// `omrBuckets`, so this is a bucket-to-bucket TRANSFER: no ledger row, conservation untouched.
//
// Locks stake_pool → rwa_dividend_pool → family_yield_pool. Nothing else locks the first two (their
// only other reader retired with them), and every other family_yield_pool writer takes it LAST, so
// there is no cycle with payFamilyYield (gangs → pot) or the toll credit (account → pot).
export async function mergeLegacyPools(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moved = await mergeLegacyYieldPools(client);
    if (moved <= 0) { await client.query('COMMIT'); return null; }
    await client.query('COMMIT');
    return { merged: moved };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// §8 SEASON ROLLOVER — seasons are 28-day windows from the epoch. Characters
// stamped with an older season convert level → prestige (floor(level/2), the
// §7.9 formula) and reset respect. Batched; each character is row-locked.
export async function runSeasonRollover(pool, opts = {}) {
  const current = opts.season ?? Math.floor(dayOf() / 28); // MUST match rules.js seasonIdxOf (the same 28-day clock)
  let converted = 0;
  // (D11 2026-08-05: the SPCX season prize retired with the Portfolio — the rollover keeps
  // converting level → prestige; the dueling belt below is the season's surviving crown.)
  const s0 = await pool.connect();
  let rows;
  try {
    rows = (await s0.query('SELECT id FROM characters WHERE alive AND season < $1 ORDER BY id', [current])).rows;
  } finally { s0.release(); }
  // THE RECKONING — close the books on the season that just ENDED (current − 1) before anything is
  // reset, so the record reads the city as it stood. Idempotent on the season PK; run only when a
  // population actually lived through it (a fresh boot in season 100 should not invent a record for
  // 99). Pure status — the whole write moves no currency, so it needs no txn of the loop's.
  let reckoning = null;
  if (rows.length && current > 0) {
    try { reckoning = await recordReckoning(pool, current - 1); }
    catch (e) { console.error('reckoning:', e.message); }   // a failed record must never stall the rollover
  }
  // THE DUELING BELT — the season CHAMPION (highest-ELO active LISTED duelist rolling over this season)
  // is crowned into the account-level `duel_titles` legend (survives death, the boxing-belt precedent).
  // Snapshot the id here (a read, order-independent); the bump runs UNDER the champ's own char lock below.
  const champ = (await pool.query(
    `SELECT id FROM characters WHERE alive AND season < $1 AND duel_limit IS NOT NULL
      ORDER BY duel_elo DESC, id ASC LIMIT 1`, [current])).rows[0];
  const champId = champ ? champ.id : null;
  // R22 (worker-sweep-isolation lens): ONE txn per character — the monolithic single-txn rollover was
  // the lone value-moving sweep without per-row isolation, so a single persistently-throwing row would
  // roll back the WHOLE batch every tick and stall the season for EVERYONE. Per-char txn matches every
  // sibling sweep: a poison row is skipped (logged), the rest convert; the `season < current` marker +
  // per-row FOR UPDATE re-check keep it idempotent + resumable (partial progress persists across a crash).
  for (const { id } of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
      if (!ch || ch.season >= current) { await client.query('ROLLBACK'); continue; }
      const seasonLevel = levelOf(Number(ch.respect));
      const legacy = Math.floor(seasonLevel / 2);
      // THE SEASON RECAP — the individual's "your season" keepsake, captured BEFORE the reset zeroes
      // respect/season_kills. Account-keyed (survives death), idempotent on the PK. Pure status, no
      // §10.4. Records the just-CLOSED season (current − 1), matching the reckoning.
      await client.query(
        `INSERT INTO season_recaps (account_id, season, level, kills, prestige_gained, title)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id, season) DO NOTHING`,
        [ch.account_id, current - 1, seasonLevel, Number(ch.season_kills || 0), legacy, recapTitleOf(seasonLevel)]);
      // THE DUELING BELT: crown the season champion into their lifetime titles BEFORE the elo reset
      if (id === champId) {
        await client.query('UPDATE account_persistent SET duel_titles = duel_titles + 1 WHERE account_id=$1', [ch.account_id]);
        await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
          [crypto.randomUUID(), id, 'duel_champion', JSON.stringify({ season: current, elo: Number(ch.duel_elo) })]);
      }
      // THE DUELING LADDER: the elo race resets with the season (a fresh 28-day climb)
      await client.query('UPDATE characters SET respect=0, season_kills=0, duel_elo=$3, season=$2 WHERE id=$1', [id, current, DUELS.ELO_START]);
      // THE ESTATE/AUCTION Tier-4: the PATRON crown is seasonal — the account's this-season prestige
      // spend resets with the character's season (account-level, but zeroed here under the char lock,
      // gated by season<current so it's idempotent — the same account write the prestige/title bumps use).
      await client.query('UPDATE account_persistent SET season_sunk=0 WHERE account_id=$1', [ch.account_id]);
      if (legacy > 0)
        await client.query('UPDATE account_persistent SET prestige = prestige + $2 WHERE account_id=$1', [ch.account_id, legacy]);
      await client.query('INSERT INTO telemetry (id, account_id, event, props) VALUES ($1,$2,$3,$4)',
        [crypto.randomUUID(), ch.account_id, 'season_convert', JSON.stringify({ season: current, legacy })]);
      await client.query('COMMIT');
      converted++;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); } // poison row skipped, batch continues
    finally { client.release(); }
  }
  // econ pass: the COMMISSION ladder is seasonal — a new season re-contests the chamber. gangs.season
  // is the lazy marker (the character-conversion pattern above), so the reset is idempotent per season
  // and a fresh gang (season 0) is stamped current on its first sweep. Own txn (isolated from the loop).
  const sg = await pool.connect();
  try {
    // (R35 concurrency lens) reset each gang in SORTED id order via one autocommit UPDATE apiece, NOT a
    // single set-based statement. The set-based `UPDATE … WHERE season < $1` acquires gang row-locks in
    // scan order (ctid), which at a season boundary — when every active gang matches — could AB-BA with a
    // war op that locks two gangs in sorted id order (declareWar/resolveWar, social.js). Per-gang autocommit
    // UPDATEs hold at most ONE gang lock at a time, so the reset can't be a party to any lock cycle; and
    // `season < $1` keeps each idempotent (a re-run after a crash skips the already-stamped gangs).
    const gs = (await sg.query('SELECT id FROM gangs WHERE season < $1 ORDER BY id', [current])).rows;
    for (const { id } of gs)
      await sg.query('UPDATE gangs SET season_tribute=0, season_wars=0, season=$1 WHERE id=$2 AND season < $1', [current, id]);
  } finally { sg.release(); }
  return { season: current, converted, reckoning };
}

if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  // BLUE-TEAM M1: the worker never ran preflight, so a TEST_ONLY roll/timer knob set only on the
  // worker's env would reach production unseen and drive the kill sweeps (WANTED_HUNT_P) / force-bust
  // (LAW_BUST_P) at call time. Refuse to start if any is set in a real deployment.
  const _leaks = testOnlyLeaks();
  if (_leaks.length) {
    console.error('Refusing to start worker — test-only roll/timer overrides are set in a real deployment '
      + '(they pin money rolls to always-win and collapse pacing timers): ' + _leaks.join(', '));
    process.exit(1);
  }
  const pool = await makeDb();
  console.log('OMERTÀ worker up — hourly: buyback + season check; daily: §10.4 invariant sweep.');
  let lastInvariantDay = -1;
  // Each job is individually transactional, so a failure in one must NOT starve the others —
  // above all the nightly §10.4 drift monitor (a non-technical founder relies on that alarm).
  // Isolate every job in its own try/catch so a poison row can't take the whole tick down.
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { console.error(`worker: ${label} failed`, e); return null; } };
  // How many consecutive ticks have found the database unreachable — used only to keep the log honest
  // (say it once, then say how long it has been going on) rather than to change what we do about it.
  let dbDownTicks = 0;
  // latched so a still-broken archive doesn't re-alert every hour; cleared on recovery so the NEXT
  // episode alerts again (two separate outages in one day is exactly the pattern that matters).
  let archiverAlerted = false;
  let oracleKeeperAlerted = false; // the bond-oracle keeper watchdog, same latch discipline
  let deskDarkAlerted = false;     // the desk's anchor went stale — same latch, same reason
  const tick = async () => {
    // A tick fans out to ~60 independent jobs. `safe()` isolates them so one poison row cannot starve
    // the §10.4 drift monitor — but when the DATABASE is what is unreachable, every one of those 60
    // fails identically and dumps a stack trace, so an outage buries its own cause under a wall of
    // noise. That is precisely what made 2026-07-25 hard to read. Check reachability once up front and,
    // if the database is gone, say so in ONE line and come back next tick. Nothing here is urgent to
    // the minute; every sweep is idempotent and catches up on the next run.
    const health = await pingDb(pool);
    if (!health.ok) {
      dbDownTicks++;
      console.error(`worker: database unreachable (${health.error}) — skipping this tick; ${dbDownTicks} tick(s) so far`);
      return;
    }
    if (dbDownTicks) { console.log(`worker: database back after ${dbDownTicks} skipped tick(s) — resuming`); dbDownTicks = 0; }
    // BLUE-TEAM C2: stamp the liveness beat now that the DB is reachable this tick — /health and the ops
    // dashboard read its age so a monitor can catch the worker going dark (it is the sole alarm source).
    await safe('heartbeat', () => pool.query('UPDATE worker_heartbeat SET beat_at = now() WHERE id = 1'));
    const r = await safe('buyback', () => runBuyback(pool));
    if (r) console.log(`🔁 street take: window +$${Math.round(r.toWindow)}`);
    // the legacy-pool merge is its OWN step, not the buyback's: gating a $OMR migration behind the
    // cash pool being non-empty is how it never runs on a quiet server (red-team A1).
    const lm = await safe('legacy pools', () => mergeLegacyPools(pool));
    if (lm) console.log(`🔁 legacy yield pools merged: ${lm.merged.toFixed(3)} $OMR → the family pot`);
    // THE DESK'S DAILY AUCTION (economy v3 step 3). Closing first is deliberate: an expired lot must
    // stop being sellable before a fresh one opens, and both are idempotent (the day is a unique key,
    // the close is a predicated UPDATE), so running them every hourly tick is how the auction survives
    // worker downtime — the first tick of a new day opens it, whenever that tick happens to be.
    await safe('desk auction close', () => closeExpired(pool));
    const da = await safe('desk auction', () => openAuction(pool));
    if (da?.opened) console.log(`🔨 the desk opens: ${da.qty} $OMR from ${da.open} down to ${da.reserve} ETH each`);
    else if (da && da.reason !== 'already') console.log(`🔨 no auction today (${da.reason})`);
    // THE DESK GOING DARK IS A REVENUE OUTAGE, and it must reach a human (AUDIT-desk F1 — the
    // archiver/oracle-keeper watchdogs' third sibling). The anchor is fail-closed on purpose: no
    // price print, or one past ORACLE_MAX_AGE_MS, and no auction opens, in EITHER direction. That is
    // correct, and it is also the desk's entire revenue mechanism stopping — "revenue ≈ sink volume
    // × price" goes to zero — while every §10.4 check stays green, because nothing is wrong with
    // conservation when nothing trades. It reached an hourly log line and nowhere else, and a line
    // repeated every hour forever fails the same way silence does: nobody reads it. `no_lot` and
    // `already` are NORMAL (a quiet sink day, a second tick inside the day) and never alarm.
    // Only `stale_price` is an OUTAGE worth a human: a price WAS printing and then aged out. `no_price`
    // means the Vig buyback has NEVER printed — the pre-mainnet DORMANT state, expected and permanent
    // until the chain goes live — so it is a quiet log line, not a Discord alarm every worker restart.
    // A watchdog that cries wolf pre-launch is the "alarm nobody reads" failure this system warns about.
    const deskDark = da && !da.opened && da.reason === 'stale_price';
    if (da && !da.opened && da.reason === 'no_price') console.log('the desk is dormant (no $OMR price print yet — expected pre-mainnet)');
    if (deskDark && !deskDarkAlerted) {
      deskDarkAlerted = true;
      console.error(`🚨 THE DESK IS DARK (${da.reason}) — no usable $OMR anchor, so it can neither sell nor buy back. Check that the Vig buyback is still printing a price.`);
      await safe('desk dark alert', () => alertDrift(pool, [{
        name: `desk anchor ${da.reason}`, reason: da.reason,
        note: 'The daily auction cannot open and the band buyback refuses: no fresh price print to anchor on. Revenue is stopped until it returns.',
      }], 'desk'));
    } else if (da?.opened && deskDarkAlerted) {
      deskDarkAlerted = false;
      console.log('✅ the desk is trading again — the anchor is fresh');
    }
    // TOKENOMICS v2 — THE FAMILY YIELD. A no-op on an empty pot, so this is safe to run every tick
    // and is live the moment FAMILY_YIELD.FUND_BPS is turned up (design §3).
    const fy = await safe('family yield', () => payFamilyYield(pool));
    if (fy?.paid > 0) console.log(`👑 family yield: ${fy.paid} $OMR split across ${fy.families.length} famil${fy.families.length === 1 ? 'y' : 'ies'}`);
    const s = await safe('season rollover', () => runSeasonRollover(pool));
    if (s?.converted > 0) console.log(`📅 season ${s.season}: converted ${s.converted} characters`);
    if (s?.reckoning) console.log(`🏆 season ${s.reckoning.season} closed — ${s.reckoning.champion || 'nobody'} took the city` +
      (s.reckoning.family ? `, ${s.reckoning.family} held ${s.reckoning.districts} district(s)` : ''));
    // (economy v3 step 1: the daily street-wage epoch ran here. The faucet is retired — the game
    // prints no $OMR at all now, so there is nothing for a worker tick to pay. See src/emission.js.)
    const sw = await safe('bounty sweep', () => sweepExpiredBounties(pool));
    if (sw?.pots > 0) console.log(`📜 contracts: refunded ${sw.pots} expired pot(s) → $${sw.refunded}`);
    const fs = await safe('fee reconcile', () => sweepUncreditedFees(pool));
    if (fs?.credited > 0) console.log(`💳 fees: reconciled ${fs.credited} stranded payment(s) to linked wallets`);
    // THE STORE: grant any ETH-package purchases whose wallet linked after the payment landed
    const st = await safe('store reconcile', () => sweepUncreditedStore(pool));
    if (st?.granted > 0) console.log(`🛒 store: granted ${st.granted} stranded purchase(s) to linked wallets`);
    // THE LEDGER: pay down any owed Season Pass stipend as the prize pool funds (backed, pool-bounded)
    const ps = await safe('pass stipend sweep', () => sweepPassStipends(pool));
    if (ps?.paid > 0) console.log(`🎟  pass: paid ${ps.paid} $OMR of owed Ledger stipend`);
    // lapsed vendettas grant nothing (reads filter on expires_at); this is just row hygiene
    await safe('vendetta prune', () => pool.query('DELETE FROM vendettas WHERE expires_at <= now()'));
    await safe('troll box retention', () => pool.query('DELETE FROM chat_messages WHERE at < $1',
      [new Date(Date.now() - 7 * 86400000)])); // 7-day chat retention — talk is ephemeral, not a ledger
    await safe('cellphone retention', () => pool.query('DELETE FROM dm_messages WHERE at < $1',
      [new Date(Date.now() - 30 * 86400000)])); // 30-day DM retention — a phone, not an archive
    await safe('results retention', () => pool.query('DELETE FROM event_results WHERE resolved_at < $1',
      [new Date(Date.now() - 7 * 86400000)])); // 7-day results retention — a board of last night's outcomes, not a ledger
    await safe('duel log retention', () => pool.query('DELETE FROM duels WHERE at < $1',
      [new Date(Date.now() - 60 * 86400000)])); // the pair K-decay reads only TODAY — old rows are noise
    await safe('gala guest retention', () => pool.query('DELETE FROM gala_guests WHERE at < $1',
      [new Date(Date.now() - 7 * 86400000)])); // (red-team LOW) a gala is a 4h window — old guest lists are noise
    await safe('oauth state sweep', () => pool.query('DELETE FROM oauth_states WHERE created_at < $1',
      [new Date(Date.now() - 30 * 60000)])); // single-use PKCE states die in 30 min regardless
    // §7.13 tier-2 reconcile: pay the "family tree" fee the post-commit hook couldn't (grandrecruiter
    // had no living character at the qualifying instant); idempotent, pays A once A has a living heir
    const gr = await safe('grand-referral reconcile', () => sweepGrandReferrals(pool));
    if (gr?.paid > 0) console.log(`🌳 referral: reconciled ${gr.paid} tier-2 fee(s)`);
    await safe('social claims sweep', () => sweepSocialClaims(pool)); // drop spent Spread-the-Word rows (housekeeping)
    // THE CAPO'S LICENSE — recompute each agent's minted+retained+levelled recruit count (the perk
    // gate the throttle + wire board read). Retention is a moving window, so this must re-run.
    await safe('capo license', () => sweepCapoLicense(pool));
    // FIVE PILLARS #2: lapsed coalitions dissolve (reads filter on expires_at — row hygiene)
    await safe('diplomacy sweep', () => sweepDiplomacy(pool));
    // NPC-FAMILY DIPLOMACY: NPC families accept a player's peace offer (ending their OFFENSIVE) + form
    // alliances among themselves (flavor). §10.4-neutral — status rows only.
    const nd = await safe('npc diplomacy', () => sweepNpcDiplomacy(pool));
    if (nd && (nd.signed > 0 || nd.allied > 0)) console.log(`🕊️ npc diplomacy: signed ${nd.signed} peace, ${nd.allied} alliance(s)`);
    await safe('secrets sweep', () => sweepSecrets(pool)); // unpaid demands blow at the deadline; stale dirt reaped
    await safe('rivals sweep', () => sweepRivals(pool)); // grudges older than RETENTION_D fade off the ledger
    // THE CALL (STREET LIFE): NPC contacts ring the players who know them with paid requests —
    // paid from the CONTACT'S OWN pocket at fulfilment (recycle-only, zero new faucet); lapsed
    // requests fade. Bounded GEN_PER_TICK placements a tick, one open call per street (the PK).
    await safe('contact calls sweep', () => sweepCalls(pool));
    const cc = await safe('contact calls', () => generateContactCalls(pool));
    if (cc?.placed > 0) console.log(`📞 contacts: ${cc.placed} call(s) placed`);
    // THE FAVOR: nobody ran it before the TTL, so the escrowed pay goes home (per-favor txn,
    // characters-before-favors lock order — the loan/bounty sweep posture).
    // THE SEALED BID: a closed contest is resolved by the worker — single-writer, one txn per
    // district (districts → gangs, the seizeDistrict order), so no player action races the outcome.
    const ct = await safe('turf contest sweep', () => sweepContests(pool));
    if (ct?.resolved > 0) console.log(`🏙  turf: resolved ${ct.resolved} contest(s), ${ct.seized} district(s) changed hands`);
    const fv = await safe('favor sweep', () => sweepFavors(pool));
    if (fv?.refunded > 0) console.log(`🤝 favors: ${fv.refunded} expired, escrow refunded to the posters`);
    const cw = await safe('crew invite sweep', () => sweepCrewInvites(pool));
    if (cw?.swept > 0) console.log(`👥 crew: swept ${cw.swept} stale invite(s)`);
    await safe('mentor offer sweep', () => sweepMentorOffers(pool));
    const pt = await safe('prime time settle', () => settlePrimeTime(pool));  // pay closed value-rally nights at final turnout
    if (pt?.paid > 0) console.log(`🌃 prime time: paid ${pt.paid} answerer(s) the turnout-scaled rally reward`);
    await safe('web push sweep', () => sweepPush(pool));  // push URGENT undelivered notifications to away players (dormant unless VAPID configured)
    await safe('email digest sweep', () => sweepDispatch(pool));  // THE DISPATCH — email lapsed opted-in players a "while you were gone" digest (dormant unless EMAIL_API_KEY configured)
    const hs = await safe('heist sweep', () => sweepStaleHeists(pool));
    if (hs?.swept > 0) console.log(`🗺  heists: swept ${hs.swept} stale plan(s), stakes refunded to living leaders`);
    // THE PEN co-op breakout: stale break plans abandoned, a living leader's staked cutkit refunded
    const pb = await safe('pen break sweep', () => sweepStaleBreaks(pool));
    if (pb?.swept > 0) console.log(`🔓 pen: swept ${pb.swept} stale break plan(s), cutkits returned to living leaders`);
    // THE FRONTIER co-op raids: stale raid plans cleared off the board (no stake — nothing to refund)
    const wrd = await safe('world raid sweep', () => sweepStaleRaids(pool));
    if (wrd?.swept > 0) console.log(`🗡  world: swept ${wrd.swept} stale co-op raid plan(s)`);
    // THE UPRISING (step six): materialize today's cartel uprising + resolve any past-day reckoning
    const upr = await safe('world uprising sweep', () => sweepUprisings(pool));
    if (upr?.resolved > 0) console.log(`🔥 world: resolved ${upr.resolved} cartel uprising(s)`);
    // THE MANHUNT (blood war step three): NPC families hunt down raiders who escaped the scene counter
    const bwh = await safe('blood war manhunt', () => sweepFamilyAggro(pool));
    if (bwh?.struck > 0) console.log(`🩸 blood war: ${bwh.struck} raider(s) hunted down`);
    // THE FAMILY WAR (formal): close expired campaigns (a win was granted on the crossing; this lapses the rest)
    const fw = await safe('family war sweep', () => sweepNpcWars(pool));
    if (fw?.lapsed > 0) console.log(`⚔️ family war: ${fw.lapsed} campaign(s) lapsed`);
    // THE OFFENSIVE (blood war step four): NPC families open hostilities on player families unprompted —
    // open up to TARGET, strike on cadence (a shield-honouring family_aggro hit), lapse the expired.
    const off = await safe('npc offensive', () => sweepNpcAggression(pool));
    if (off && (off.opened > 0 || off.struck > 0)) console.log(`🎯 npc offensive: opened ${off.opened}, struck ${off.struck}, lapsed ${off.lapsed}`);
    const mk = await safe('market sweep', () => sweepMarket(pool));
    if (mk && (mk.settled > 0 || mk.lapsed > 0)) console.log(`🔨 market: hammered ${mk.settled} auction(s), lapsed ${mk.lapsed}`);
    // CONVOY step three: NPC TRUCKING — despawn arrived NPC trucks, then top the road back up to TARGET
    const npcGone = await safe('npc convoy despawn', () => despawnArrivedNpc(pool));
    const npcNew = await safe('npc convoy spawn', () => spawnNpcConvoys(pool));
    if ((npcGone?.despawned > 0) || (npcNew?.spawned > 0)) console.log(`🚚 convoy: NPC trucks −${npcGone?.despawned || 0} +${npcNew?.spawned || 0}`);
    await safe('convoy hauls sweep', () => sweepConvoyHauls(pool)); // Tier-4: drop stale Road-Boss/Teamster haul-log rows
    // THE POPULATION: keep the city inhabited — top headcount up to TARGET and retire old bloodlines.
    // Dormant when POPULATION_OFF is set (the deploy switch for a server with real players).
    if ((process.env.POPULATION_OFF || 'off') !== 'on') {
      const pop = await safe('population', () => runPopulation(pool));
      if (pop && (pop.spawned > 0 || pop.retired > 0))
        console.log(`🏙️  population: +${pop.spawned} −${pop.retired} residents (${pop.drained} picked clean; ${pop.population} on the streets, ${pop.turnoverLeft} replacements left today)`);
      // step three: the turnover cap is a ceiling, not a rate — say so plainly when it binds, since
      // a city full of drained residents looks like a bug if the operator can't see why.
      if (pop && pop.turnoverLeft <= 0 && pop.drained === 0)
        console.log('🏙️  population: the day\'s replacement allowance is spent — picked-clean residents stay put until it rolls');
      // step two: the city ACTS — consent limits, secured loan offers, standing buy orders, drift.
      // Pure recycling of cash they already hold, so no new faucet (design doc §"the one rule").
      const beh = await safe('resident behaviour', () => runResidentBehaviour(pool));
      if (beh && beh.acted > 0)
        console.log(`🏙️  residents: ${Object.entries(beh.actions).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    }
    // THE COMMISSION (step three): settle frozen-week proposals — the enacted motion refunds, the rest forfeit
    const cp = await safe('commission proposals', () => settleProposals(pool));
    if (cp && (cp.refunded || cp.forfeited)) console.log(`\u2696\ufe0f commission: settled proposals (${cp.refunded} refunded, ${cp.forfeited} forfeited)`);
    // THE AUCTION HOUSE: settle last week's lots — the top bidder wins the trophy, the winning bid burns
    const auc = await safe('auction sweep', () => sweepAuctions(pool));
    if (auc && auc.settled > 0) console.log(`🎩 auction: settled ${auc.settled} lot(s), burned ${auc.burned} $OMR`);
    // Tier-4 THE BLOCK — RESALE: settle expired player consignments (reserve met → buyer takes the trophy,
    // the cut burns as the house take; reserve unmet → the top bidder refunded, the trophy returns)
    const con = await safe('consignment sweep', () => sweepConsignments(pool));
    if (con && con.sold > 0) console.log(`🔨 consignments: ${con.sold} sold, ${con.burned} $OMR taken`);
    // THE FIGHT CIRCUIT (step three): resolve any past-window MAIN EVENT card — roll the fight + pay the crowd
    const me = await safe('main event sweep', () => sweepMainEvents(pool));
    if (me && me.resolved > 0) console.log(`🥊 boxing: resolved ${me.resolved} main event(s)`);
    // THE GAMBLING DEN (step four): settle any poker TOURNAMENT past its registration window — deal + pay
    // RING POKER: fold out stalled hands (the never-wedge rule) + fold up idle tables (stacks cash out)
    const rng2 = await safe('ring sweep', () => sweepRingTables(pool));
    if (rng2 && (rng2.resolvedStalls || rng2.foldedTables)) console.log(`\u2660\ufe0f ring: ${rng2.resolvedStalls} stall(s) resolved, ${rng2.foldedTables} idle table(s) folded up`);
    const trn = await safe('tournament sweep', () => sweepTournaments(pool));
    if (trn && trn.resolved > 0) console.log(`🃏 den: settled ${trn.resolved} poker tournament(s)`);
    // THE TRACK (step three): the day after, bank each entered racer's card result (status only)
    const trk = await safe('track entries sweep', () => sweepTrackEntries(pool));
    if (trk && trk.settled > 0) console.log(`🏇 track: settled ${trk.settled} card entr${trk.settled === 1 ? 'y' : 'ies'}`);
    // THE FUTURITY (Track step four): settle any futurity past its window — race the field + pay the crowd
    const fut = await safe('futurity sweep', () => sweepFuturity(pool));
    if (fut && fut.resolved > 0) console.log(`🏆 futurity: settled ${fut.resolved} race(s)`);
    // STREET RACES (step three): settle any GRAND PRIX past its window — race the grid + pay the top places
    const gp = await safe('grand prix sweep', () => sweepGrandPrix(pool));
    if (gp && gp.resolved > 0) console.log(`🏁 races: settled ${gp.resolved} grand prix`);
    // THE STABLE (step two): settle any STAKES race past its window — race the field + pay the top places
    const stk = await safe('stakes sweep', () => sweepStakes(pool));
    if (stk && stk.resolved > 0) console.log(`🐎 stable: settled ${stk.resolved} stakes race(s)`);
    // THE FIGHT CIRCUIT (step four): strip an inactive champion who hasn't defended the belt in time
    const bd = await safe('belt defense', () => enforceBeltDefense(pool));
    if (bd && bd.stripped) console.log(`🥊 boxing: stripped an inactive champion (${bd.fighter})`);
    // THE WIRE: expire stale wiretaps (row hygiene — reads already filter expires_at)
    const wr = await safe('wire sweep', () => sweepWire(pool));
    if (wr?.swept > 0) console.log(`📡 wire: swept ${wr.swept} expired wiretap(s)`);
    // THE WIRE step four THE WATCHDOG: push alerts to subscribers when a tapped mark turns hot
    const wa = await safe('wire alerts', () => sweepWireAlerts(pool));
    if (wa?.fired > 0) console.log(`📡 wire: fired ${wa.fired} watchdog alert(s)`);
    // THE WIRE step five THE STANDING WATCH: auto-renew enrolled taps from the watcher's $OMR
    const ww = await safe('wire watches', () => sweepStandingWatches(pool));
    if (ww?.renewed > 0 || ww?.paused > 0) console.log(`📡 wire: renewed ${ww.renewed} standing watch(es), paused ${ww.paused}`);
    // THE LAW: force the RICO bust on an indicted player past the grace window (reaches the offline whale)
    const law = await safe('law sweep', () => sweepLaw(pool));
    if (law && law.cases > 0) console.log(`⚖️  law: tried ${law.cases} case(s) — ${law.convicted} convicted ($${Math.round(law.seized)} seized), ${law.acquitted} walked`);
    // LOAN SHARKING: refund expired offers to the lender; mark overdue borrowers welshers
    const ln = await safe('loan sweep', () => sweepLoans(pool));
    if (ln && (ln.refunded > 0 || ln.welshed > 0 || ln.forfeited > 0)) console.log(`💵 loans: refunded ${ln.refunded} stale offer(s), flagged ${ln.welshed} welsher(s), forfeited ${ln.forfeited} collateral car(s)`);
    // LOAN step 4 — NPC bounty hunters come for WANTED defaulters (a landed hit runs the estate)
    const hw = await safe('wanted hunt', () => huntWanted(pool));
    if (hw && (hw.killed > 0 || hw.absorbed > 0 || hw.revived > 0)) console.log(`🎯 wanted: ${hw.killed} whacked, ${hw.absorbed} guarded, ${hw.revived} revived (${hw.marks} marked)`);
    // §11: reverse expired-unclaimed withdrawal vouchers — refund the burned $OMR (freeing the
    // otherwise-permanently-committed reserve capacity) and restore optimistically-removed gear.
    const vr = await safe('voucher reclaim', () => reclaimExpiredVouchers(pool));
    if (vr && (vr.omrReclaimed > 0 || vr.gearRestored > 0)) console.log(`♻️  vouchers: reclaimed ${vr.omrReclaimed.toFixed(3)} $OMR + restored ${vr.gearRestored} gear from expired claims`);
    // ARE THE BACKUPS ACTUALLY RUNNING? Checked EVERY tick, not nightly, because this is the one
    // failure that is invisible from inside the game: the database serves perfectly while its
    // point-in-time-recovery chain rots. It broke twice on 2026-07-25 and the only evidence was in
    // the hosting provider's log stream, where nobody was looking. Now the game watches its own
    // backups and shouts through the SAME channel as a §10.4 drift (telemetry + the founder webhook),
    // once per episode — a healed-then-broken-again outage alerts again, a still-broken one does not
    // re-nag every hour.
    const arch = await safe('archiver health', () => archiverHealth(pool));
    // BOTH bad states alarm — `off` (archive_mode disabled: no recovery chain exists at all) as well
    // as `failing`. `off` is arguably the worse of the two precisely because it looks calm: zero
    // failures forever, because nothing is even being attempted.
    const archBad = arch && (arch.state === 'failing' || arch.state === 'off');
    if (arch && arch.state !== 'unsupported') {
      if (archBad && !archiverAlerted) {
        archiverAlerted = true;
        const detail = arch.state === 'off'
          ? 'archive_mode is OFF — this database has NO point-in-time recovery.'
          : `Last success: ${arch.lastArchivedWal || 'never'} (${arch.secondsSinceArchived ?? '?'}s ago); last failure: ${arch.lastFailedWal} (${arch.secondsSinceFailed}s ago), ${arch.failedCount} total.`;
        console.error(`🚨 BACKUPS ARE NOT RUNNING (${arch.state}) — ${detail} TAKE A MANUAL DUMP (npm run backup) and raise it with your database host.`);
        await safe('archiver alert', () => alertDrift(pool, [{
          name: `wal archiving ${arch.state}`, archiveMode: arch.archiveMode,
          lastArchivedWal: arch.lastArchivedWal, lastFailedWal: arch.lastFailedWal,
          secondsSinceArchived: arch.secondsSinceArchived, failedCount: arch.failedCount,
          note: 'Backups are not being shipped. The database is fine; RESTORING it may not be. Take a manual dump.',
        }, ], 'backup'));
      } else if (!archBad && archiverAlerted) {
        archiverAlerted = false;
        console.log(`✅ WAL archiving recovered — last shipped ${arch.lastArchivedWal} (${arch.secondsSinceArchived}s ago)`);
      }
    }
    // IS THE ORACLE KEEPER ALIVE? (AUDIT-oracle.md's one open flag — the archiver watchdog's
    // chain-side twin.) The TWAP only moves when someone pokes update(), and a silent keeper halt
    // is indistinguishable from low demand right up until bonds start refusing — which is also
    // exactly the F2 attack window. Checked hourly, dormant without a bond chain, latched per
    // episode; 'unreachable' never alarms (not knowing is not the same as broken — a dead RPC
    // already fails the chain sync loudly).
    const oh = await safe('oracle keeper health', () => bondOracleHealth());
    if (oh && oh.state !== 'dormant' && oh.state !== 'unreachable') {
      const ohBad = oh.state !== 'ok';
      if (ohBad && !oracleKeeperAlerted) {
        oracleKeeperAlerted = true;
        console.error(`🚨 BOND ORACLE ${oh.state.toUpperCase()} — ${oh.note || ''} (age ${oh.ageS ?? '?'}s, period ${oh.periodS ?? '?'}s). Poke the keeper; bonding degrades from here.`);
        await safe('oracle alert', () => alertDrift(pool, [{
          name: `bond oracle ${oh.state}`, oracle: oh.oracleAddr, ageSeconds: oh.ageS,
          periodSeconds: oh.periodS, lateAfterSeconds: oh.lateAfterS,
          note: oh.note || 'The TWAP keeper looks halted. Bonding will refuse quotes when staleness bites.',
        }], 'oracle'));
      } else if (!ohBad && oracleKeeperAlerted) {
        oracleKeeperAlerted = false;
        console.log(`✅ bond oracle recovered — keeper poked ${oh.ageS}s ago (period ${oh.periodS}s)`);
      }
    }
    if (dayOf() !== lastInvariantDay) {
      lastInvariantDay = dayOf();
      // (red-team R15 F1) Prune on TWO horizons. COMPLETED rows (status<>0, holding a stored response)
      // prune at 24h — the replay window. ORPHAN reservations (status=0) prune at a MUCH longer 7-day
      // horizon: a status=0 row is ambiguous between "handler never committed" (safe to reclaim) and
      // "handler COMMITTED value but the onSend store never landed" (a crash, or a swallowed store-UPDATE
      // failure). Reclaiming the LATTER lets a same-key retry re-execute the already-committed action (a
      // double-spend). Keeping status=0 rows for a week means that key keeps 409'ing long past any real
      // client retry, while a genuinely-dead reservation is still eventually reclaimed (never 409s forever).
      await safe('idempotency prune (completed)', () => pool.query("DELETE FROM idempotency WHERE status <> 0 AND created_at < now() - interval '24 hours'"));
      await safe('idempotency prune (orphan reservations)', () => pool.query("DELETE FROM idempotency WHERE status = 0 AND created_at < now() - interval '7 days'"));
      const inv = await safe('§10.4 invariants', () => runLedgerInvariants(pool));
      if (inv) console.log(inv.ok ? '✅ §10.4 ledger invariants hold' : '🚨 §10.4 DRIFT — see alert above');
      // (red-team R6 A) also run the real-VALUE invariants nightly and route drift through the SAME
      // founder alarm — they self-alert nowhere and were only reachable behind mod routes, so a live
      // unbacked withdrawal reserve or over-committed bond tranche would drift SILENTLY until poked.
      const vinv = await safe('vig invariants', () => runVigInvariants(pool));
      if (vinv && !vinv.ok) await safe('vig alert', () => alertDrift(pool, vinv.checks.filter((c) => !c.ok), 'vig'));
      const binv = await safe('bond invariants', () => runBondInvariants(pool));
      if (binv && !binv.ok) await safe('bond alert', () => alertDrift(pool, binv.checks.filter((c) => !c.ok), 'bond'));
      // THE VAULT's wall — `allocated <= held`, in ETH on both sides. It was stated in code from the
      // day the vault was backed with ETH but watched by nobody, which is the same failure mode as a
      // §10.4 drift alarm firing into an unread log: the check exists and the breach still ships.
      const tinv = await safe('treasury invariants', () => runTreasuryInvariants(pool));
      if (tinv && !tinv.ok) await safe('treasury alert', () => alertDrift(pool, tinv.checks.filter((c) => !c.ok), 'treasury'));
      // THE DESK's ETH side (economy v3 step 3). §10.4 reconciles the $OMR the auction handed over;
      // this reconciles the money it took for it, and asserts a comp booked none — same reason as
      // the three above, and the same alarm channel, because a check nobody reads is not a check.
      const dinv = await safe('desk invariants', () => runDeskInvariants(pool));
      if (dinv && !dinv.ok) await safe('desk alert', () => alertDrift(pool, dinv.checks.filter((c) => !c.ok), 'desk'));
      // BLUE-TEAM M7: THE REDEMPTION WINDOW's backing proof (paid ≤ funded — "redistribution, not
      // inflation"). It was reachable only via GET /v1/mod/exchange — the pre-R6-A state the vig/bond
      // checks were pulled OUT of. The exchange_pool cash buffer is OUTSIDE §10.4's counted buckets, so
      // this is the ONLY automated check that the window can't mint cash — now on the same nightly alarm.
      const einv = await safe('exchange invariants', () => runExchangeInvariants(pool));
      if (einv && !einv.ok) await safe('exchange alert', () => alertDrift(pool, einv.checks.filter((c) => !c.ok), 'exchange'));
      if (vinv && binv) console.log((vinv.ok && binv.ok) ? '✅ vig + bond (real-value) invariants hold' : '🚨 VIG/BOND DRIFT — see alert above');
    }
  };
  // (red-team R14 F3) setInterval does NOT wait for an async callback — if a tick runs long
  // (a big season rollover, a slow DB), the next interval fires while it's still going, so two
  // ticks run concurrently in-process (a self-inflicted double-worker: double buyback, racing
  // sweeps). Guard with an in-flight flag so a slow tick just skips the next fire, not overlaps it.
  let ticking = false;
  const guardedTick = async () => {
    if (ticking) { console.warn('worker: previous tick still running — skipping this interval'); return; }
    ticking = true;
    try { await tick(); } finally { ticking = false; }
  };
  await guardedTick();
  setInterval(guardedTick, 3600 * 1000);

  // §11 chain-event sync (audit F2/F3): POLL getLogs over a persisted block cursor, staying
  // CHAIN_CONFIRMATIONS behind head — so worker downtime backfills (no lost fee credits) and a
  // shallow reorg is never acted on (no premature reserve free). Idempotent, so overlapping
  // reprocessing on restart is harmless. Dormant (source=null) without CHAIN_RPC_URL. Seed
  // CHAIN_START_BLOCK to the contracts' deploy block so the first run doesn't scan from genesis.
  const source = await makeViemSource();
  if (source) {
    // deploy hardening (audit): a wrong-but-nonzero CHAIN_ID would sign every voucher under the wrong
    // EIP-712 domain. AUDIT-full-system-v2 B-L8: a mismatch DISABLES the chain sync (fail-closed — never
    // sync under the wrong domain) but must NOT crash the worker, or a poison chain config takes down the
    // nightly §10.4 drift monitor + buyback + sweeps with it. Wrap it; on mismatch, skip chain sync only.
    let chainOk = true;
    try { await assertChainId(); }
    catch (e) { chainOk = false; console.error('🚨 CHAIN SYNC DISABLED — ', e.message); }
    if (chainOk) {
      const startBlock = process.env.CHAIN_START_BLOCK ? Number(process.env.CHAIN_START_BLOCK) : undefined;
      const syncTick = async () => {
        try {
          if (process.env.OMERTA_FEES_ADDRESS) {
            const f = await syncFeeEvents(pool, source, { startBlock });
            if (f.processed) console.log(`💰 fee sync: credited ${f.processed} payment(s) (blocks ${f.from}–${f.to})`);
          }
          if (process.env.VOUCHER_CLAIM_ADDRESS) {
            const c = await syncClaimedEvents(pool, source, { startBlock });
            if (c.processed) console.log(`👁  claimed sync: freed ${c.processed} voucher(s) (blocks ${c.from}–${c.to})`);
          }
          // afterSwap→Vig trade-fee hook (design §2). Dormant unless TRADE_FEE_HOOK_ADDRESS is set;
          // the watcher is the SOLE producer of source='trade' revenue (no mod route — zero fabrication).
          if (process.env.TRADE_FEE_HOOK_ADDRESS) {
            const t = await syncTradeFees(pool, source, { startBlock });
            if (t.processed) console.log(`💱 trade-fee sync: booked ${t.processed} swap fee(s) to the Vig (blocks ${t.from}–${t.to})`);
          }
          // THE RESERVE BOND (OmertaBond): Bonded → recordBond (POL + the Vig buyback basis). Dormant
          // unless OMERTA_BOND_ADDRESS is set; the on-chain event is authoritative + idempotent on nonce.
          if (process.env.OMERTA_BOND_ADDRESS) {
            const b = await syncBondEvents(pool, source, { startBlock });
            if (b.processed) console.log(`🏦 bond sync: booked ${b.processed} bond(s) → reserve/POL/Vig (blocks ${b.from}–${b.to})`);
          }
        } catch (e) { console.error('chain sync error', e.message); }
      };
      // (red-team R14 F3) same re-entrancy guard as the hourly tick — a slow getLogs sweep (a big
      // backfill after downtime) must not overlap the next 30s poll and double-process a block range.
      let syncing = false;
      const guardedSync = async () => {
        if (syncing) return;
        syncing = true;
        try { await syncTick(); } finally { syncing = false; }
      };
      await guardedSync();
      setInterval(guardedSync, Number(process.env.CHAIN_POLL_MS || 30000));
      console.log(`⛓  chain sync polling every ${Number(process.env.CHAIN_POLL_MS || 30000) / 1000}s, ${DEFAULT_CONFIRMATIONS} confirmations behind head`);
    }
  }
}
