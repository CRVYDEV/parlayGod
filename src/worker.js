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
import { levelOf, dayOf, CONSTANTS, PORTFOLIO } from './rules.js';
import { grantShares } from './portfolio.js';
import { runLedgerInvariants, alertDrift } from './invariants.js';
import { runVigInvariants } from './vig.js';
import { runBondInvariants } from './bonds.js';
import { sweepExpiredBounties, huntWanted } from './social.js';
import { sweepUncreditedFees } from './fees.js';
import { runWageEpoch } from './emission.js';
import { sweepUncreditedStore } from './store.js';
import { sweepPassStipends } from './pass.js';
import { sweepStaleHeists } from './heists.js';
import { sweepStaleBreaks } from './pen.js';
import { sweepStaleRaids, sweepUprisings } from './world.js';
import { sweepWire, sweepWireAlerts, sweepStandingWatches } from './wire.js';
import { reclaimExpiredVouchers, assertChainId } from './chain.js';
import { sweepMarket } from './market.js';
import { sweepDiplomacy } from './diplomacy.js';
import { sweepSecrets } from './secrets.js';
import { spawnNpcConvoys, despawnArrivedNpc } from './convoy.js';
import { sweepLaw } from './law.js';
import { sweepLoans } from './loans.js';
import { sweepAuctions } from './auction.js';
import { sweepMainEvents, enforceBeltDefense } from './boxing.js';
import { sweepTournaments, sweepTrackEntries, sweepFuturity } from './casino.js';
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
    // lock order matches the swap path (amm_pool first) — no lock cycles
    const amm = (await client.query('SELECT * FROM amm_pool WHERE id=1 FOR UPDATE')).rows[0];
    // cheap unlocked due-check so a not-due tick doesn't lock the top-25 gangs for nothing. Two
    // buybacks can't both be here (they serialize on the amm_pool lock above), and the authoritative
    // pool value is re-read under lock below, so a tribute landing after this peek is not lost.
    const peek = (await client.query('SELECT pool, last_buyback FROM street_tax WHERE id=1')).rows[0];
    const dueMs = now.getTime() - new Date(peek.last_buyback).getTime();
    if (Number(peek.pool) <= 0 || (!opts.force && dueMs < BUYBACK_PERIOD_MS)) {
      await client.query('COMMIT');
      return null;
    }
    // Lock the payout gangs (sorted id order) BEFORE the street_tax singleton — the global order is
    // gangs → singletons, which bumpFamilyTask (gang, then street_tax on weekly completion) also
    // follows. The old code locked street_tax before the gangs, AB-BA deadlocking the buyback against
    // a family finishing its weekly contract. Ranking may go slightly stale between here and the
    // distribution; harmless (we lock and credit exactly the rows we ranked).
    const ranked = (await client.query(
      `SELECT id, lifetime_tribute, wars_won FROM gangs
        WHERE lifetime_tribute + 10000 * wars_won > 0
        ORDER BY lifetime_tribute + 10000 * wars_won DESC LIMIT 25`)).rows;
    for (const id of ranked.map((g) => g.id).sort())
      await client.query('SELECT 1 FROM gangs WHERE id=$1 FOR UPDATE', [id]);
    // now the singleton — authoritative pool under lock
    const tax = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    const cashPool = Number(tax.pool);
    if (cashPool <= 0) { await client.query('COMMIT'); return null; }
    let c = Number(amm.cash_reserve), o = Number(amm.omr_reserve);

    // ORGANIC AMM DEPTH (sim-audit F4): carve AMM_LP_BPS of the tax pool into PROTOCOL-OWNED
    // LIQUIDITY — the cash slice paired with event-fund $OMR at the CURRENT spot price, deposited
    // into BOTH reserves. Nothing mints (fund → amm is a bucket transfer inside the §10.4 $OMR
    // set), the price doesn't move (deposited at ratio), and k grows — slippage falls with real
    // economic activity. If the fund can't match the pair this cycle, the slice falls through to
    // the buyback (depth when we can afford it, yield-backing otherwise).
    let lpCash = 0, lpOmr = 0;
    const lpWant = cashPool * (CONSTANTS.AMM_LP_BPS || 0) / 10000;
    if (lpWant > 0) {
      const spot = c / o;
      const omrWant = lpWant / spot;
      if (Number(tax.fund) >= omrWant) {
        lpCash = lpWant; lpOmr = omrWant;
        c += lpCash; o += lpOmr;
        await client.query('UPDATE street_tax SET fund = fund - $1 WHERE id=1', [lpOmr]);
      }
    }
    const spendable = cashPool - lpCash;
    const k = c * o;
    const bought = o - k / (c + spendable);
    if (!(bought > 0) && lpCash <= 0) { await client.query('COMMIT'); return null; }
    await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + spendable, o - bought]);

    // Phase 4 (backed emission): carve a STAKE_POOL_BPS slice of the buyback off the top to fund
    // staking yield — so cash sinks (street tax) pay stakers via redistribution, not a new mint.
    // A bucket transfer within the §10.4 $OMR set (amm reserve → stake_pool); conserves, no ledger.
    const stakeShare = bought * (CONSTANTS.STAKE_POOL_BPS || 0) / 10000;
    if (stakeShare > 0)
      await client.query('UPDATE stake_pool SET balance = balance + $1, lifetime_funded = lifetime_funded + $1 WHERE id=1', [stakeShare]);
    const forSplit = bought - stakeShare;

    // remaining: 50% pro-rata to the top-25 families by standing; the rest (plus any
    // undistributed remainder) rolls to the event fund.
    const clanShare = forSplit / 2;
    let toFund = forSplit / 2, distributed = 0;
    const totalStanding = ranked.reduce((a, g) => a + Number(g.lifetime_tribute) + 10000 * Number(g.wars_won), 0);
    if (totalStanding > 0) {
      for (const g of ranked) {
        const share = clanShare * (Number(g.lifetime_tribute) + 10000 * Number(g.wars_won)) / totalStanding;
        await client.query('UPDATE gangs SET omr_reserve = omr_reserve + $2 WHERE id=$1', [g.id, share]);
        distributed += share;
      }
      toFund += clanShare - distributed;
    } else {
      toFund = forSplit; // no eligible families yet: the non-stake remainder to the event fund
    }
    await client.query('UPDATE street_tax SET pool=0, fund = fund + $1, last_buyback=$2 WHERE id=1', [toFund, now]);
    await client.query('COMMIT');
    return { spentCash: cashPool, boughtOmr: bought, toFund, toFamilies: distributed, families: ranked.length,
      lpCash, lpOmr };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// §8 SEASON ROLLOVER — seasons are 28-day windows from the epoch. Characters
// stamped with an older season convert level → prestige (floor(level/2), the
// §7.9 formula) and reset respect. Batched; each character is row-locked.
export async function runSeasonRollover(pool, opts = {}) {
  const current = opts.season ?? Math.floor(dayOf() / 28);
  let converted = 0;
  // R1 step-two — THE SEASON PRIZE: the top season grinders (by respect, snapshotted BEFORE the reset
  // below zeroes it) earn the champion's moonshot (SPCX) — a skill-ranked STATUS grant, so no §10.4
  // currency moves and no chance is involved (rank is earned). Account-level → survives death. Only
  // characters rolling over this season (season < current) with respect are eligible. The snapshot is
  // a read (order-independent); the GRANT is deferred into each winner's own locked per-char txn below
  // so it runs UNDER the winner's `char FOR UPDATE` (F3/F4 char→portfolios order).
  const s0 = await pool.connect();
  let leaders, rows;
  try {
    leaders = (await s0.query(
      'SELECT id FROM characters WHERE alive AND season < $1 AND respect > 0 ORDER BY respect DESC, id LIMIT $2',
      [current, PORTFOLIO.SEASON_PRIZES.length])).rows;
    rows = (await s0.query('SELECT id FROM characters WHERE alive AND season < $1 ORDER BY id', [current])).rows;
  } finally { s0.release(); }
  const prizeByChar = new Map(leaders.map((r, i) => [r.id, { rank: i + 1, omrWorth: PORTFOLIO.SEASON_PRIZES[i] }]));
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
      const prize = prizeByChar.get(id); // grant the season prize while THIS char row is locked (F3/F4)
      if (prize) {
        const g = await grantShares(client, ch.account_id, PORTFOLIO.SEASON_TICKER, prize.omrWorth);
        if (g) await client.query('INSERT INTO notifications (id, character_id, type, payload) VALUES ($1,$2,$3,$4)',
          [crypto.randomUUID(), id, 'season_prize', JSON.stringify({ rank: prize.rank, ticker: PORTFOLIO.SEASON_TICKER, shares: g.granted })]);
      }
      const legacy = Math.floor(levelOf(Number(ch.respect)) / 2);
      await client.query('UPDATE characters SET respect=0, season_kills=0, season=$2 WHERE id=$1', [id, current]);
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
  return { season: current, converted };
}

if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  const pool = await makeDb();
  console.log('OMERTÀ worker up — hourly: buyback + season check; daily: §10.4 invariant sweep.');
  let lastInvariantDay = -1;
  // Each job is individually transactional, so a failure in one must NOT starve the others —
  // above all the nightly §10.4 drift monitor (a non-technical founder relies on that alarm).
  // Isolate every job in its own try/catch so a poison row can't take the whole tick down.
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { console.error(`worker: ${label} failed`, e); return null; } };
  const tick = async () => {
    const r = await safe('buyback', () => runBuyback(pool));
    if (r) console.log(`🔁 buyback: $${Math.round(r.spentCash)} → ${r.boughtOmr.toFixed(3)} $OMR (fund +${r.toFund.toFixed(3)}, families +${r.toFamilies.toFixed(3)})`);
    const s = await safe('season rollover', () => runSeasonRollover(pool));
    if (s?.converted > 0) console.log(`📅 season ${s.season}: converted ${s.converted} characters`);
    // THE STREET WAGE — the daily emission epoch (idempotent per epoch, safe at any tick frequency)
    const wg = await safe('street wage epoch', () => runWageEpoch(pool));
    if (wg?.workers > 0) console.log(`💰 street wage: epoch ${wg.epoch} paid ${wg.paid} $OMR to ${wg.workers} of ${wg.candidates} earners (budget ${wg.budget})`);
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
    await safe('oauth state sweep', () => pool.query('DELETE FROM oauth_states WHERE created_at < $1',
      [new Date(Date.now() - 30 * 60000)])); // single-use PKCE states die in 30 min regardless
    // FIVE PILLARS #2: lapsed coalitions dissolve (reads filter on expires_at — row hygiene)
    await safe('diplomacy sweep', () => sweepDiplomacy(pool));
    await safe('secrets sweep', () => sweepSecrets(pool)); // unpaid demands blow at the deadline; stale dirt reaped
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
    const mk = await safe('market sweep', () => sweepMarket(pool));
    if (mk && (mk.settled > 0 || mk.lapsed > 0)) console.log(`🔨 market: hammered ${mk.settled} auction(s), lapsed ${mk.lapsed}`);
    // CONVOY step three: NPC TRUCKING — despawn arrived NPC trucks, then top the road back up to TARGET
    const npcGone = await safe('npc convoy despawn', () => despawnArrivedNpc(pool));
    const npcNew = await safe('npc convoy spawn', () => spawnNpcConvoys(pool));
    if ((npcGone?.despawned > 0) || (npcNew?.spawned > 0)) console.log(`🚚 convoy: NPC trucks −${npcGone?.despawned || 0} +${npcNew?.spawned || 0}`);
    // THE AUCTION HOUSE: settle last week's lots — the top bidder wins the trophy, the winning bid burns
    const auc = await safe('auction sweep', () => sweepAuctions(pool));
    if (auc && auc.settled > 0) console.log(`🎩 auction: settled ${auc.settled} lot(s), burned ${auc.burned} $OMR`);
    // THE FIGHT CIRCUIT (step three): resolve any past-window MAIN EVENT card — roll the fight + pay the crowd
    const me = await safe('main event sweep', () => sweepMainEvents(pool));
    if (me && me.resolved > 0) console.log(`🥊 boxing: resolved ${me.resolved} main event(s)`);
    // THE GAMBLING DEN (step four): settle any poker TOURNAMENT past its registration window — deal + pay
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
