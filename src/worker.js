// §7.12 buyback worker. Every 12h the accumulated street tax buys $OMR through the
// same AMM curve as player swaps: 50% → event fund, 50% split pro-rata across the
// top-25 families by standing (lifetime tribute + 10,000 per war won) into their
// omr_reserve; the undistributed remainder rolls to the fund.
//
// Run standalone: `node src/worker.js` (checks hourly, fires when a cycle is due).
// Exported `runBuyback` is called by the worker loop and exercised by the tests.
import { makeDb } from './db.js';

const BUYBACK_PERIOD_MS = 12 * 3600 * 1000;

// Returns null when nothing was due, else a summary of the executed buyback.
// `opts.force` ignores the 12h timer (tests); `opts.now` overrides the clock.
export async function runBuyback(pool, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock order matches the swap path (amm_pool before street_tax) — no lock cycles
    const amm = (await client.query('SELECT * FROM amm_pool WHERE id=1 FOR UPDATE')).rows[0];
    const tax = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    const cashPool = Number(tax.pool);
    const dueMs = now.getTime() - new Date(tax.last_buyback).getTime();
    if (cashPool <= 0 || (!opts.force && dueMs < BUYBACK_PERIOD_MS)) {
      await client.query('COMMIT');
      return null;
    }
    const c = Number(amm.cash_reserve), o = Number(amm.omr_reserve), k = c * o;
    const bought = o - k / (c + cashPool);
    if (!(bought > 0)) { await client.query('COMMIT'); return null; }
    await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + cashPool, o - bought]);

    // 50% pro-rata to the top-25 families by standing; the rest (plus any
    // undistributed remainder) rolls to the event fund.
    const clanShare = bought / 2;
    let toFund = bought / 2, distributed = 0;
    const ranked = (await client.query(
      `SELECT id, lifetime_tribute, wars_won FROM gangs
        WHERE lifetime_tribute + 10000 * wars_won > 0
        ORDER BY lifetime_tribute + 10000 * wars_won DESC LIMIT 25`)).rows;
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

if (process.argv[1] && process.argv[1].endsWith('worker.js')) {
  const pool = await makeDb();
  console.log('OMERTÀ buyback worker up — checking hourly for a due 12h cycle.');
  const tick = async () => {
    try {
      const r = await runBuyback(pool);
      if (r) console.log(`🔁 buyback: $${Math.round(r.spentCash)} → ${r.boughtOmr.toFixed(3)} $OMR (fund +${r.toFund.toFixed(3)})`);
    } catch (e) { console.error('buyback error', e); }
  };
  await tick();
  setInterval(tick, 3600 * 1000);
}
