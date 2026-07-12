// §7.12 buyback worker. Every 12h the accumulated street tax buys $OMR through the
// same AMM curve as player swaps: 50% → event fund, 50% split pro-rata across the
// top-25 families' omr_reserve, remainder → fund. Families arrive in M3, so until
// then the whole buyback rolls to the event fund.
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
    const tax = (await client.query('SELECT * FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
    const cashPool = Number(tax.pool);
    const dueMs = now.getTime() - new Date(tax.last_buyback).getTime();
    if (cashPool <= 0 || (!opts.force && dueMs < BUYBACK_PERIOD_MS)) {
      await client.query('COMMIT');
      return null;
    }
    // Claim the cycle first (pool→0) so a second runner can't double-distribute.
    const amm = (await client.query('SELECT * FROM amm_pool WHERE id=1 FOR UPDATE')).rows[0];
    const c = Number(amm.cash_reserve), o = Number(amm.omr_reserve), k = c * o;
    const bought = o - k / (c + cashPool);
    if (!(bought > 0)) { await client.query('COMMIT'); return null; }
    await client.query('UPDATE amm_pool SET cash_reserve=$1, omr_reserve=$2 WHERE id=1', [c + cashPool, o - bought]);

    // 50% to families by standing (M3), 50% to the fund. No families yet → all to fund.
    // The family split will subtract its distributed share here once gangs exist.
    const toFund = bought;
    await client.query('UPDATE street_tax SET pool=0, fund = fund + $1, last_buyback=$2 WHERE id=1', [toFund, now]);
    await client.query('COMMIT');
    return { spentCash: cashPool, boughtOmr: bought, toFund, toFamilies: bought - toFund };
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
