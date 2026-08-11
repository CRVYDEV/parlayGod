// ── THE MONEY ROUTER — one declared waterfall over every real-value inflow ────────────────────────
// (founder-directed 2026-08-09: "#2 begin" — consolidate the money router before mainnet.)
//
// The split landscape grew a slice at a time: the sell tax splits three ways, bonds four, the Store
// three, gameplay fees three, the exit toll two, the desk auction two — each individually
// invariant-checked, but nothing stated the WHOLE map in one place, nothing verified the map is
// COMPLETE (an unknown `source` row in vig_revenue/rwa_revenue loosened every unfiltered SUM those
// ledgers feed), and two mirrors ('fee' and 'store') were inserted but never reconciled anywhere.
//
// THIS MODULE MOVES NO MONEY. Three jobs:
//   1. DECLARE  — waterfall(): every real-value inflow and its split, DERIVED from the live signed
//                 constants (STORE.SPLIT_BPS, BONDS.*, SELL_TAX.*, VIG_BPS, TAX.*,
//                 DESK_AUCTION.*) so the declaration structurally cannot drift from the code that
//                 books the slices. Unifying the PERCENTAGES across sources is a separate balance
//                 decision (BALANCE.md § THE MONEY ROUTER) — deliberately NOT made here: folding
//                 rates silently moves real money between destinations (the stock-layer-retirement
//                 lesson, recorded 2026-07-31).
//   2. VERIFY   — runRouterInvariants(): the CROSS-SOURCE layer the five per-system runners
//                 (vig/bond/treasury/desk/exchange) structurally cannot see — source membership on
//                 both revenue ledgers, the two orphan mirrors reconciled, the retired trade rail
//                 staying retired, and the dev_fund balance identity (the one revenue bucket that
//                 had no balance==ledger check).
//   3. DISPLAY  — routerBoard(): WHERE A DOLLAR GOES — the whole waterfall with lifetime figures
//                 per source × destination, one screen (GET /v1/mod/router + the /admin panel).
//
// Import discipline: rules.js (the universal leaf) + vig.js (which imports game/rules — router sits
// at the worker/server layer, so no cycle). Nothing imports router.js except server/worker/tests.
import { STORE, BONDS, SELL_TAX, TAX, TREASURY, DESK_AUCTION, withdrawTaxBps } from './rules.js';
import { VIG_BPS } from './vig.js';
import { bankRevenueByAsset } from './treasury.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ── 1. THE DECLARATION ────────────────────────────────────────────────────────────────────────────
// One row per inflow. `splits` name every destination with its bps OF THE GROSS and where the slice
// LANDS (the table/bucket an auditor reconciles against). `implicit: true` marks a remainder share
// that is never stored anywhere (GAP-1 of the mapping pass — the operations shares of the fee + Store
// splits exist only as arithmetic; the board computes them and says so rather than hiding it).
// A function, not a const: TREASURY.FEE_TREASURY_BPS() and withdrawTaxBps() are env-read per call.
export function waterfall() {
  const feeTreasury = TREASURY.FEE_TREASURY_BPS();
  return [
    { id: 'fee', name: 'Gameplay fees (mint / respawn / reroll — OmertaFees)', currency: 'eth', totalBps: 10000,
      splits: [
        { dest: 'vig', bps: VIG_BPS, lands: "vig_revenue source='fee'" },
        { dest: 'treasury', bps: feeTreasury, lands: "rwa_revenue source='fee'" },
        { dest: 'operations', bps: 10000 - VIG_BPS - feeTreasury, lands: 'dev wallet (on-chain, implicit remainder)', implicit: true },
      ] },
    { id: 'store', name: 'The Store (ETH packages)', currency: 'eth', totalBps: 10000,
      splits: [
        { dest: 'vig', bps: STORE.SPLIT_BPS.buyback, lands: "vig_revenue source='store'" },
        { dest: 'treasury', bps: STORE.SPLIT_BPS.rwa, lands: "rwa_revenue source='store'" },
        { dest: 'operations', bps: STORE.SPLIT_BPS.founder, lands: 'dev wallet (on-chain, implicit remainder)', implicit: true },
      ] },
    { id: 'bond', name: 'Reserve Bonds (ETH principal)', currency: 'eth', totalBps: 10000,
      splits: [
        { dest: 'pol', bps: BONDS.POL_BPS, lands: 'bond_reserve.pol_eth' },
        { dest: 'vig', bps: BONDS.VIG_BPS, lands: "vig_revenue source='bond'" },
        { dest: 'treasury', bps: BONDS.RWA_BPS, lands: "bond_reserve.rwa_eth + rwa_revenue source='bond'" },
        { dest: 'operations', bps: BONDS.DEV_BPS, lands: 'bond_reserve.dev_eth' },
      ] },
    // The sell tax's slices are declared as bps OF THE TAXED GROSS (DEV_BPS/RWA_BPS/LP_BPS sum to
    // SELL_TAX.BPS, not 10000) — normalized here to shares-of-the-inflow so every row reads alike.
    { id: 'tax', name: `DEX sell tax (${SELL_TAX.BPS} bps of every OMR sell)`, currency: 'eth', totalBps: 10000,
      splits: [
        { dest: 'operations', bps: Math.round(SELL_TAX.DEV_BPS / SELL_TAX.BPS * 10000), lands: 'sell_tax_events.dev_eth' },
        { dest: 'treasury', bps: Math.round(SELL_TAX.RWA_BPS / SELL_TAX.BPS * 10000), lands: "sell_tax_events.rwa_eth + rwa_revenue source='tax'" },
        { dest: 'pol', bps: 10000 - Math.round(SELL_TAX.DEV_BPS / SELL_TAX.BPS * 10000) - Math.round(SELL_TAX.RWA_BPS / SELL_TAX.BPS * 10000),
          lands: 'sell_tax_events.lp_eth (the remainder rule sits on LP)' },
      ] },
    // RETIRED 2026-08-11 (founder-directed). The row STAYS so the map makes the positive claim —
    // a retired rail that simply vanishes from the board says nothing, and any historical row would
    // then have no declaration to reconcile against. Two hooks wanted one canonical pool; the
    // four-slice sell tax won. It never fired in production, so `lifetime.trade` reads zero forever.
    { id: 'trade', name: 'Swap trade fee — RETIRED (the sell tax is the canonical pool’s one hook)',
      currency: 'eth', totalBps: 10000, retired: true,
      splits: [{ dest: 'vig', bps: 10000, lands: "vig_revenue source='trade' (historical only)" }] },
    { id: 'auction', name: "The Desk's daily Dutch auction (ETH proceeds)", currency: 'eth', totalBps: 10000,
      splits: [
        { dest: 'pol', bps: DESK_AUCTION.ETH_POL_BPS, lands: 'desk_sales.pol_eth' },
        { dest: 'operations', bps: 10000 - DESK_AUCTION.ETH_POL_BPS, lands: 'desk_sales.founder_eth (remainder)' },
      ] },
    { id: 'polfees', name: 'POL trading fees (the LP position earns)', currency: 'eth', totalBps: 10000,
      splits: [{ dest: 'desk-buyback', bps: 10000, lands: 'pol_fees (the buyback budget — exclusively)' }] },
    // THE BANK's 20% harvest performance fee. Denominated in the MARKET'S UNDERLYING (USDC), not ETH
    // — hence its own ledger and its own currency here, rather than a row in the ETH-denominated
    // rwa_revenue whose sum IS the vault's `held` wall. Destination: the treasury Safe, because §4's
    // three legs (stakers / NFT holders / the city) are unbuilt, at zero, and design respectively —
    // so this records the money now and splits it when there is something to split it into.
    { id: 'harvest', name: `THE BANK — harvest performance fee (${BANK_HARVEST_FEE_BPS} bps of yield that serviced debt)`,
      currency: 'usd', totalBps: 10000,
      splits: [{ dest: 'treasury', bps: 10000, lands: "bank_revenue source='harvest' (in the market's underlying)" }] },
    // The one non-ETH revenue line: the $OMR exit toll (+ the early-exit surcharge, which rides the
    // SAME split). Declared here because "where a dollar goes" must include operations' other
    // revenue bucket, or the map is not the map.
    { id: 'toll', name: `$OMR exit toll (${withdrawTaxBps()} bps) + early-exit surcharge`, currency: 'omr', totalBps: 10000,
      splits: [
        { dest: 'operations', bps: TAX.DEV_BPS, lands: "dev_fund (ledger reason tax:dev)" },
        { dest: 'community', bps: 10000 - TAX.DEV_BPS, lands: "family_yield_pool (ledger reason tax:buyback)" },
      ] },
  ];
}

// The membership sets the VERIFY layer holds the ledgers to. Extending a ledger with a new source
// means extending the waterfall — a decision on the record, not a quiet INSERT (schema comments
// name 'cosmetic' | 'rent' | 'pass' as future sources; they join HERE when they are built).
// 'trade' is RETIRED but stays a member FOREVER: membership is what makes an unknown source the
// loudest alarm, so deleting a retired one would make its historical rows read as the alarm instead.
export const VIG_SOURCES = ['fee', 'store', 'bond', 'trade'];
export const TREASURY_SOURCES = ['fee', 'store', 'tax', 'bond'];
// The bank's own ledger, in the market's underlying rather than ETH. Same membership discipline.
export const BANK_SOURCES = ['harvest'];
// Mirrors Alchemist.harvestFeeBps. A RESTATEMENT (the contract is the authority and this layer
// cannot import Solidity), so it is pinned against the contract source in test/router.js — the
// preflight vig-defaults discipline, applied to a number that decides what the board claims.
export const BANK_HARVEST_FEE_BPS = 2000;

// Load-time guard: every declared source's splits sum to exactly its total. A waterfall that does
// not sum is a config error worth refusing to boot over (the STORE.SPLIT_BPS precedent).
for (const src of waterfall()) {
  const sum = src.splits.reduce((a, s) => a + s.bps, 0);
  if (sum !== src.totalBps) throw new Error(`money router: source '${src.id}' splits sum to ${sum}, not ${src.totalBps}`);
}

// ── 2. THE VERIFICATION ───────────────────────────────────────────────────────────────────────────
// The cross-source checks the per-system runners cannot see. Aggregate tolerance is per-row
// rounding (each booked slice rounds at 1e-6), so the bound scales with row count.
export async function runRouterInvariants(pool) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, ...(ok ? {} : { detail }) });
  const num = (r) => Number(r || 0);

  // (1) the declaration itself (re-asserted at run time — env-read levers can move between boots)
  const bad = waterfall().filter((s) => s.splits.reduce((a, x) => a + x.bps, 0) !== s.totalBps);
  push('waterfall splits sum exact', bad.length === 0, bad.map((s) => s.id).join(','));

  // (2)+(3) SOURCE MEMBERSHIP — an unknown source is revenue outside the declared map: it inflates
  // every unfiltered SUM (runVigBuyback's spend budget; the treasury's `held`) without belonging to
  // any declared inflow. The loudest possible router alarm.
  const vigUnknown = (await pool.query(
    `SELECT DISTINCT source FROM vig_revenue WHERE source NOT IN (${VIG_SOURCES.map((_, i) => `$${i + 1}`).join(',')})`,
    VIG_SOURCES)).rows.map((r) => r.source);
  push('vig_revenue sources are declared', vigUnknown.length === 0, `unknown: ${vigUnknown.join(',')}`);
  const treUnknown = (await pool.query(
    `SELECT DISTINCT source FROM rwa_revenue WHERE source NOT IN (${TREASURY_SOURCES.map((_, i) => `$${i + 1}`).join(',')})`,
    TREASURY_SOURCES)).rows.map((r) => r.source);
  push('treasury (rwa_revenue) sources are declared', treUnknown.length === 0, `unknown: ${treUnknown.join(',')}`);

  // (4)+(5) THE FEE MIRRORS — Σ booked slices == Σ real fee gross × the declared bps. 'fee' rows
  // were inserted by recordFeePayment and reconciled NOWHERE (the mapping pass's GAP-2 half).
  const feeRows = (await pool.query(
    'SELECT amount_wei FROM fee_payments WHERE tx_hash IS NOT NULL')).rows;
  const feeGross = feeRows.reduce((a, r) => { try { return a + Number(BigInt(r.amount_wei)) / 1e18; } catch { return a; } }, 0);
  const feeTol = 2e-6 * (feeRows.length + 1);
  const feeVig = num((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='fee'")).rows[0].s);
  push('fee → vig mirror matches the declared split', Math.abs(feeVig - feeGross * VIG_BPS / 10000) <= feeTol,
    `booked ${feeVig} vs declared ${round6(feeGross * VIG_BPS / 10000)}`);
  const feeTre = num((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='fee'")).rows[0].s);
  push('fee → treasury mirror matches the declared split', Math.abs(feeTre - feeGross * TREASURY.FEE_TREASURY_BPS() / 10000) <= feeTol,
    `booked ${feeTre} vs declared ${round6(feeGross * TREASURY.FEE_TREASURY_BPS() / 10000)}`);

  // (6)+(7) THE STORE MIRRORS — same shape over store_payments (real only).
  const storeRows = (await pool.query('SELECT amount_wei FROM store_payments WHERE tx_hash IS NOT NULL')).rows;
  const storeGross = storeRows.reduce((a, r) => { try { return a + Number(BigInt(r.amount_wei)) / 1e18; } catch { return a; } }, 0);
  const storeTol = 2e-6 * (storeRows.length + 1);
  const storeVig = num((await pool.query("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='store'")).rows[0].s);
  push('store → vig mirror matches the declared split', Math.abs(storeVig - storeGross * STORE.SPLIT_BPS.buyback / 10000) <= storeTol,
    `booked ${storeVig} vs declared ${round6(storeGross * STORE.SPLIT_BPS.buyback / 10000)}`);
  const storeTre = num((await pool.query("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='store'")).rows[0].s);
  push('store → treasury mirror matches the declared split', Math.abs(storeTre - storeGross * STORE.SPLIT_BPS.rwa / 10000) <= storeTol,
    `booked ${storeTre} vs declared ${round6(storeGross * STORE.SPLIT_BPS.rwa / 10000)}`);

  // (8) THE TRADE RAIL IS RETIRED — the freshness shape (emission.js's `emission faucet retired`).
  // The check that lived here held the booking to its declared lever, which caught the F1 drift; with
  // the payer deleted there is no booking left to hold, and the thing worth asserting inverts: that
  // nothing writes it AGAIN. Deliberately NOT a membership deletion — `'trade'` stays a declared
  // VIG_SOURCE forever, because conservation is a claim about the whole ledger and a source removed
  // from membership is the loudest alarm this module has. Scoped to the last day so a historical row
  // (none exist — it never fired in production) still reconciles rather than alarming forever.
  const trFresh = Number((await pool.query(
    "SELECT COUNT(*) n FROM vig_revenue WHERE source='trade' AND created_at > now() - interval '1 day'")).rows[0].n);
  push('trade fee retired (nothing new books it)', trFresh === 0, `${trFresh} fresh source='trade' row(s)`);

  // (9) BANK SOURCE MEMBERSHIP — the same rule as the two ETH ledgers: revenue outside the declared
  // map inflates any unfiltered SUM over it. Cheap, and it is what makes adding a bank revenue line
  // a decision on the record rather than a quiet INSERT.
  const bankUnknown = (await pool.query(
    `SELECT DISTINCT source FROM bank_revenue WHERE source NOT IN (${BANK_SOURCES.map((_, i) => `$${i + 1}`).join(',')})`,
    BANK_SOURCES)).rows.map((r) => r.source);
  push('bank_revenue sources are declared', bankUnknown.length === 0, `unknown: ${bankUnknown.join(',')}`);

  // (10) THE DEV FUND identity — the one revenue bucket with no balance==ledger check (GAP-1's
  // checkable half; the exchange/family-yield pools have this, dev_fund did not): the balance is
  // exactly what tax:dev put in minus what tax:dev:claim took out, and lifetime never moves down.
  const df = (await pool.query('SELECT omr, lifetime FROM dev_fund WHERE id=1')).rows[0] || { omr: 0, lifetime: 0 };
  const devIn = num((await pool.query("SELECT COALESCE(SUM(-amount),0) s FROM transactions WHERE reason='tax:dev'")).rows[0].s);
  const devOut = num((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='tax:dev:claim'")).rows[0].s);
  push('dev fund balance == ledger (tax:dev − claims)', Math.abs(num(df.omr) - (devIn - devOut)) < 0.000002,
    `bucket ${df.omr} vs ledger ${round6(devIn - devOut)}`);
  push('dev fund lifetime == Σ tax:dev', Math.abs(num(df.lifetime) - devIn) < 0.000002,
    `lifetime ${df.lifetime} vs ledger ${round6(devIn)}`);

  return { ok: checks.every((c) => c.ok), checks };
}

// ── 3. THE DISPLAY — WHERE A DOLLAR GOES ──────────────────────────────────────────────────────────
// The whole waterfall with lifetime booked figures per slice. Implicit (never-stored) remainders
// are COMPUTED and labelled so — the board never pretends arithmetic is a ledger.
export async function routerBoard(pool) {
  const num = (r) => Number(r || 0);
  const one = async (q, p = []) => num((await pool.query(q, p)).rows[0]?.s);
  const wf = waterfall();
  const lifetime = {};

  const feeRows = (await pool.query('SELECT amount_wei FROM fee_payments WHERE tx_hash IS NOT NULL')).rows;
  const feeGross = feeRows.reduce((a, r) => { try { return a + Number(BigInt(r.amount_wei)) / 1e18; } catch { return a; } }, 0);
  lifetime.fee = { gross: round6(feeGross),
    vig: await one("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='fee'"),
    treasury: await one("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='fee'") };
  lifetime.fee.operations = round6(Math.max(0, feeGross - lifetime.fee.vig - lifetime.fee.treasury));

  const storeRows = (await pool.query('SELECT amount_wei FROM store_payments WHERE tx_hash IS NOT NULL')).rows;
  const storeGross = storeRows.reduce((a, r) => { try { return a + Number(BigInt(r.amount_wei)) / 1e18; } catch { return a; } }, 0);
  lifetime.store = { gross: round6(storeGross),
    vig: await one("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='store'"),
    treasury: await one("SELECT COALESCE(SUM(rwa_eth),0) s FROM rwa_revenue WHERE source='store'") };
  lifetime.store.operations = round6(Math.max(0, storeGross - lifetime.store.vig - lifetime.store.treasury));

  const br = (await pool.query('SELECT pol_eth, dev_eth, rwa_eth FROM bond_reserve WHERE id=1')).rows[0] || {};
  lifetime.bond = { pol: num(br.pol_eth), operations: num(br.dev_eth), treasury: num(br.rwa_eth),
    vig: await one("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='bond'") };
  lifetime.bond.gross = round6(lifetime.bond.pol + lifetime.bond.operations + lifetime.bond.treasury + lifetime.bond.vig);

  lifetime.tax = { gross: await one('SELECT COALESCE(SUM(gross_eth),0) s FROM sell_tax_events WHERE real'),
    operations: await one('SELECT COALESCE(SUM(dev_eth),0) s FROM sell_tax_events WHERE real'),
    treasury: await one('SELECT COALESCE(SUM(rwa_eth),0) s FROM sell_tax_events WHERE real'),
    pol: await one('SELECT COALESCE(SUM(lp_eth),0) s FROM sell_tax_events WHERE real') };

  lifetime.trade = { gross: await one("SELECT COALESCE(SUM(gross_eth),0) s FROM vig_revenue WHERE source='trade'"),
    vig: await one("SELECT COALESCE(SUM(vig_eth),0) s FROM vig_revenue WHERE source='trade'") };

  lifetime.auction = { gross: await one('SELECT COALESCE(SUM(eth),0) s FROM desk_sales WHERE real'),
    pol: await one('SELECT COALESCE(SUM(pol_eth),0) s FROM desk_sales WHERE real'),
    operations: await one('SELECT COALESCE(SUM(founder_eth),0) s FROM desk_sales WHERE real') };

  lifetime.harvest = { byAsset: await bankRevenueByAsset(pool) };

  lifetime.polfees = { gross: await one('SELECT COALESCE(SUM(eth),0) s FROM pol_fees WHERE real'),
    spent: await one('SELECT COALESCE(SUM(eth_spent),0) s FROM desk_buys WHERE real') };

  const df = (await pool.query('SELECT omr, lifetime FROM dev_fund WHERE id=1')).rows[0] || { omr: 0, lifetime: 0 };
  lifetime.toll = { operations: num(df.lifetime), operationsUnclaimed: num(df.omr),
    community: await one("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='tax:buyback' AND amount < 0") * -1 };

  return { waterfall: wf, lifetime, invariants: await runRouterInvariants(pool) };
}
