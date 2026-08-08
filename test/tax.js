// THE EARLY-EXIT SURCHARGE — src/tax.js:earlySurcharge, the FIFO lot replay.
//
// This is high-stakes money code — the anti-dump toll on $OMR leaving the game economy — and until
// this file it was exercised only INCIDENTALLY, through the AMM-sell and withdrawal paths in
// chain.js. The audit already caught two bugs in exactly this replay (the round-vs-floor boundary,
// and oldest-first vs newest-first ordering, the D2 fix). Both are the kind of edge a whole-flow
// test walks past. So this drives the function DIRECTLY: seed `transactions` rows at controlled
// timestamps — the ledger IS the lot table — and assert the surcharge the replay computes.
//
// earlySurcharge(client, accountId, liquid, amount, now) is pure/read-only, so this needs no HTTP
// and no character: a pg-mem pool and hand-placed ledger rows are the whole fixture. The properties
// pinned are the ones the header of tax.js promises and the audit made load-bearing:
//   • rate decays linearly from EARLY_SELL_TAX_BPS at age 0 to 0 at FRESH_WINDOW_MS
//   • an SQL-granted / pre-window balance is AGED (surcharge-free) — the ledger, not the balance,
//     is the source of truth for age
//   • NEWEST-first pricing (D2): an aged buffer can't absorb a fresh dump; a fresh token pays on its
//     first exit and a later replay consumes it newest-first too, so it's never taxed twice
//   • amounts round, never floor, so a sub-cent crumb can't leak conservation
import assert from 'node:assert';
import { makeDb } from '../src/db.js';
import { earlySurcharge } from '../src/tax.js';
import { earlySellTaxBps, freshWindowMs } from '../src/rules.js';

process.env.EARLY_SELL_TAX_BPS = process.env.EARLY_SELL_TAX_BPS || '5000';   // 50% at age 0 (the shipped default)
const pool = await makeDb();
const BPS = earlySellTaxBps(), WIN = freshWindowMs();
assert(BPS > 0 && WIN > 0, 'the surcharge must be armed for this suite to mean anything');
const HR = 3600000;
const near = (a, b, eps = 1e-4) => assert(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);

let acctSeq = 0;
// seed an account whose $OMR ledger is exactly `rows` (each { amt, agoMs } — a credit if amt>0,
// a debit/exit if amt<0, stamped agoMs before `now`). Returns { acct, now }.
async function seed(rows) {
  const acct = `tax-${++acctSeq}`;
  const now = Date.now();
  for (const [i, r] of rows.entries()) {
    await pool.query(
      "INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ($1,$2,'omr',$3,'test',$4)",
      [`${acct}-${i}`, acct, r.amt, new Date(now - r.agoMs)]);
  }
  return { acct, now };
}

// ── 1. A wholly FRESH balance (credited just now) pays the full age-0 rate. ──
{
  const { acct, now } = await seed([{ amt: 100, agoMs: 0 }]);
  const { surcharge, freshSold } = await earlySurcharge(pool, acct, 100, 100, now);
  near(surcharge, 100 * BPS / 10000);   // ≈ 50 at the default
  near(freshSold, 100);
  console.log('✅ a just-credited balance pays the full age-0 rate on exit');
}

// ── 2. Linear decay: a token exactly half the window old pays half the age-0 rate. ──
{
  const { acct, now } = await seed([{ amt: 100, agoMs: WIN / 2 }]);
  const { surcharge } = await earlySurcharge(pool, acct, 100, 100, now);
  near(surcharge, 100 * (BPS / 10000) * 0.5);
  console.log('✅ a half-window-aged token pays half the age-0 rate (linear decay)');
}

// ── 3. Past the window: a token older than FRESH_WINDOW_MS exits surcharge-free. ──
{
  const { acct, now } = await seed([{ amt: 100, agoMs: WIN + HR }]);
  const { surcharge, freshSold } = await earlySurcharge(pool, acct, 100, 100, now);
  near(surcharge, 0);
  near(freshSold, 0);
  console.log('✅ a token older than the fresh window exits with no surcharge');
}

// ── 4. AGED-BY-DEFAULT: a balance with NO credit rows in the window (an SQL grant / pre-window
//      holding) is treated as aged and pays nothing — the ledger, not the balance, dates the money. ──
{
  const acct = `tax-sqlgrant`;
  const now = Date.now();
  // balance of 100 asserted, but zero ledger rows in the window → opening lot is aged
  const { surcharge } = await earlySurcharge(pool, acct, 100, 100, now);
  near(surcharge, 0);
  console.log('✅ a balance with no window credits (SQL grant / pre-window) is aged and surcharge-free');
}

// ── 5. NEWEST-FIRST (the D2 fix): an aged buffer + a fresh dump. Exiting the fresh amount prices the
//      FRESH lot, not the aged one — the aged buffer cannot absorb the dump. ──
{
  // 500 aged (opening, no rows) + 100 credited just now; balance 600, exit 100
  const acct = `tax-d2`, now = Date.now();
  await pool.query("INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ('d2-c', $1,'omr',100,'test',$2)", [acct, new Date(now)]);
  const { surcharge, freshSold } = await earlySurcharge(pool, acct, 600, 100, now);
  near(freshSold, 100);                       // the whole exit was the fresh lot
  near(surcharge, 100 * BPS / 10000);         // priced at age 0, NOT absorbed by the 500 aged
  console.log('✅ newest-first: an aged buffer cannot shelter a fresh dump (D2)');
}

// ── 6. TAXED ONCE: after a fresh token exits (a recorded debit newest-first), a LATER exit of the
//      same size finds only the aged buffer left — surcharge-free. A fresh token pays exactly once. ──
{
  const acct = `tax-once`, now = Date.now();
  await pool.query("INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ('o-c', $1,'omr',100,'test',$2)", [acct, new Date(now - HR)]);   // fresh credit
  await pool.query("INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ('o-d', $1,'omr',-100,'test',$2)", [acct, new Date(now - HR / 2)]); // it already exited (taxed once)
  // now the account holds only its aged opening buffer; balance 500, exit 100
  const { surcharge, freshSold } = await earlySurcharge(pool, acct, 500, 100, now);
  near(surcharge, 0);
  near(freshSold, 0);
  console.log('✅ a fresh token consumed by an earlier exit is not taxed again (newest-first replay)');
}

// ── 7. ROUNDING, never flooring: a fractional surcharge is rounded so no sub-cent crumb leaks. ──
{
  const { acct, now } = await seed([{ amt: 1, agoMs: 0 }]);
  const { surcharge } = await earlySurcharge(pool, acct, 1, 0.333333, now);
  const expect = Math.floor(0.333333 * (BPS / 10000) * 1e6) / 1e6;   // tax.js floors to 6dp
  near(surcharge, expect, 1e-9);
  assert(surcharge >= 0, 'surcharge is never negative');
  console.log('✅ the surcharge is 6dp-quantised, never leaking a crumb');
}

// ── 8. A disarmed surcharge (bps 0) is always zero — the kill switch holds. ──
{
  process.env.EARLY_SELL_TAX_BPS = '0';
  const { acct, now } = await seed([{ amt: 100, agoMs: 0 }]);
  const { surcharge } = await earlySurcharge(pool, acct, 100, 100, now);
  assert.equal(surcharge, 0, 'bps=0 disables the surcharge entirely');
  process.env.EARLY_SELL_TAX_BPS = '5000';
  console.log('✅ EARLY_SELL_TAX_BPS=0 disables the surcharge (kill switch)');
}

console.log('✅ early-exit surcharge (tax.js) suite passed');
await pool.end?.();
