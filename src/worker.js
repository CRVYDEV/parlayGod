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
import { levelOf, dayOf } from './rules.js';
import { runLedgerInvariants } from './invariants.js';
import { sweepExpiredBounties } from './social.js';
import { syncFeeEvents, syncClaimedEvents, makeViemSource, DEFAULT_CONFIRMATIONS } from './watcher.js';

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
    const c = Number(amm.cash_reserve), o = Number(amm.omr_reserve), k = c * o;
    const bought = o - k / (c + cashPool);
    if (!(bought > 0)) { await client.query('COMMIT'); return null; }
    await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + cashPool, o - bought]);

    // 50% pro-rata to the top-25 families by standing; the rest (plus any
    // undistributed remainder) rolls to the event fund.
    const clanShare = bought / 2;
    let toFund = bought / 2, distributed = 0;
    const totalStanding = ranked.reduce((a, g) => a + Number(g.lifetime_tribute) + 10000 * Number(g.wars_won), 0);
    if (totalStanding > 0) {
      for (const g of ranked) {
        const share = clanShare * (Number(g.lifetime_tribute) + 10000 * Number(g.wars_won)) / totalStanding;
        await client.query('UPDATE gangs SET omr_reserve = omr_reserve + $2 WHERE id=$1', [g.id, share]);
        distributed += share;
      }
      toFund += clanShare - distributed;
    } else {
      toFund = bought; // no eligible families yet: whole buyback to the event fund
    }
    await client.query('UPDATE street_tax SET pool=0, fund = fund + $1, last_buyback=$2 WHERE id=1', [toFund, now]);
    await client.query('COMMIT');
    return { spentCash: cashPool, boughtOmr: bought, toFund, toFamilies: distributed, families: ranked.length };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

// §8 SEASON ROLLOVER — seasons are 28-day windows from the epoch. Characters
// stamped with an older season convert level → prestige (floor(level/2), the
// §7.9 formula) and reset respect. Batched; each character is row-locked.
export async function runSeasonRollover(pool, opts = {}) {
  const current = opts.season ?? Math.floor(dayOf() / 28);
  const client = await pool.connect();
  let converted = 0;
  try {
    await client.query('BEGIN');
    const rows = (await client.query('SELECT id FROM characters WHERE alive AND season < $1 ORDER BY id', [current])).rows;
    for (const { id } of rows) {
      const ch = (await client.query('SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE', [id])).rows[0];
      if (!ch || ch.season >= current) continue;
      const legacy = Math.floor(levelOf(Number(ch.respect)) / 2);
      await client.query('UPDATE characters SET respect=0, season_kills=0, season=$2 WHERE id=$1', [id, current]);
      if (legacy > 0)
        await client.query('UPDATE account_persistent SET prestige = prestige + $2 WHERE account_id=$1', [ch.account_id, legacy]);
      await client.query('INSERT INTO telemetry (id, account_id, event, props) VALUES ($1,$2,$3,$4)',
        [crypto.randomUUID(), ch.account_id, 'season_convert', JSON.stringify({ season: current, legacy })]);
      converted++;
    }
    await client.query('COMMIT');
    return { season: current, converted };
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  const pool = await makeDb();
  console.log('OMERTÀ worker up — hourly: buyback + season check; daily: §10.4 invariant sweep.');
  let lastInvariantDay = -1;
  const tick = async () => {
    try {
      const r = await runBuyback(pool);
      if (r) console.log(`🔁 buyback: $${Math.round(r.spentCash)} → ${r.boughtOmr.toFixed(3)} $OMR (fund +${r.toFund.toFixed(3)}, families +${r.toFamilies.toFixed(3)})`);
      const s = await runSeasonRollover(pool);
      if (s.converted > 0) console.log(`📅 season ${s.season}: converted ${s.converted} characters`);
      const sw = await sweepExpiredBounties(pool);
      if (sw.pots > 0) console.log(`📜 contracts: refunded ${sw.pots} expired pot(s) → $${sw.refunded}`);
      if (dayOf() !== lastInvariantDay) {
        lastInvariantDay = dayOf();
        // prune idempotency keys older than a day (incl. any reservation orphaned by a
        // crash between reserve and response, which would otherwise 409 that key forever)
        await pool.query("DELETE FROM idempotency WHERE created_at < now() - interval '24 hours'");
        const inv = await runLedgerInvariants(pool);
        console.log(inv.ok ? '✅ §10.4 ledger invariants hold' : '🚨 §10.4 DRIFT — see alert above');
      }
    } catch (e) { console.error('worker tick error', e); }
  };
  await tick();
  setInterval(tick, 3600 * 1000);

  // §11 chain-event sync (audit F2/F3): POLL getLogs over a persisted block cursor, staying
  // CHAIN_CONFIRMATIONS behind head — so worker downtime backfills (no lost fee credits) and a
  // shallow reorg is never acted on (no premature reserve free). Idempotent, so overlapping
  // reprocessing on restart is harmless. Dormant (source=null) without CHAIN_RPC_URL. Seed
  // CHAIN_START_BLOCK to the contracts' deploy block so the first run doesn't scan from genesis.
  const source = await makeViemSource();
  if (source) {
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
      } catch (e) { console.error('chain sync error', e.message); }
    };
    await syncTick();
    setInterval(syncTick, Number(process.env.CHAIN_POLL_MS || 30000));
    console.log(`⛓  chain sync polling every ${Number(process.env.CHAIN_POLL_MS || 30000) / 1000}s, ${DEFAULT_CONFIRMATIONS} confirmations behind head`);
  }
}
