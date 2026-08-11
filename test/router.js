// ── THE MONEY ROUTER — declare / verify / display (moves NO money) ────────────────────────────────
// The split landscape grew a slice at a time (sell tax 3-way, bonds 4, Store 3, fees 3, toll 2,
// auction 2), each individually checked but with NO statement of the whole map, NO source-membership
// check on either revenue ledger, TWO mirrors ('fee'/'store') never reconciled anywhere, NO dev_fund
// balance identity — and one live constant-vs-wiring drift: recordTradeFee booked VIG_BPS (60%)
// while TRADE_FEE.VIG_BPS declares 100% (F1, fixed with this suite). This proves the router closes
// every one of those, and that a mutation to any of them fails BY NAME.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA gate: the mod ingest routes may carry a txHash here
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { waterfall, runRouterInvariants, routerBoard, VIG_SOURCES, TREASURY_SOURCES } from '../src/router.js';
import { recordTradeFee, VIG_BPS } from '../src/vig.js';
import { TRADE_FEE, STORE, TREASURY } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const mod = async (method, url, body) => {
  const res = await app.inject({ method, url, headers: { 'x-mod-key': 'test-mod-key', 'content-type': 'application/json' }, payload: body });
  return { code: res.statusCode, body: res.json() };
};

// ── 1. THE DECLARATION — every source sums, and the shape is what the board serves ──
{
  const wf = waterfall();
  assert.deepEqual(wf.map((s) => s.id), ['fee', 'store', 'bond', 'tax', 'trade', 'auction', 'polfees', 'toll'],
    'the waterfall declares every real-value inflow, in one place');
  for (const s of wf)
    assert.equal(s.splits.reduce((a, x) => a + x.bps, 0), s.totalBps, `source '${s.id}' splits sum exactly`);
  // the declaration derives from the LIVE constants — spot-pin two so a lever move shows up here
  const store = wf.find((s) => s.id === 'store');
  assert.equal(store.splits.find((x) => x.dest === 'vig').bps, STORE.SPLIT_BPS.buyback, 'store vig slice reads the live lever');
  const fee = wf.find((s) => s.id === 'fee');
  assert.equal(fee.splits.find((x) => x.dest === 'treasury').bps, TREASURY.FEE_TREASURY_BPS(), 'fee treasury slice reads the live lever');
}

// ── 2. REAL INGESTS through the audited rails, then the invariants hold over them ──
{
  // a real gameplay fee (mint 0.01 ETH), a comp fee (no txHash — books ZERO revenue),
  // a real Store purchase, a real sell-tax episode — each through its mod route.
  const r1 = await mod('POST', '/v1/mod/fees/record',
    { nonce: 910001, kind: 'mint', payer: '0x' + 'a'.repeat(40), amountWei: (10n ** 16n).toString(), txHash: '0x' + 'f'.repeat(64) });
  assert.equal(r1.code, 200, 'real fee ingests');
  await mod('POST', '/v1/mod/fees/record',
    { nonce: 910002, kind: 'mint', payer: '0x' + 'b'.repeat(40), amountWei: (10n ** 16n).toString() }); // comp — no txHash
  const r2 = await mod('POST', '/v1/mod/store/grant',
    { nonce: 910003, sku: 'decor_deco', payer: '0x' + 'c'.repeat(40), amountWei: (10n ** 16n).toString(), txHash: '0x' + 'e'.repeat(64) });
  assert.equal(r2.code, 200, 'real store purchase ingests');
  const r3 = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'rt-tax-1', omrTaxed: 90, price: 500, txHash: '0x' + 'd'.repeat(64) });
  assert.equal(r3.code, 200, 'real sell-tax episode ingests');
  // a trade fee through the REAL producer path (no mod route exists BY DESIGN — zero fabrication
  // surface; the watcher is the sole caller in production, recordTradeFee is its exact entry)
  await recordTradeFee(pool, { nonce: 910004, amountWei: (10n ** 15n).toString() }); // 0.001 ETH

  const inv = await runRouterInvariants(pool);
  assert(inv.ok, `router invariants hold over real ingests: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);

  // F1 REGRESSION — the trade fee books its DECLARED split (TRADE_FEE.VIG_BPS 10000, the signed D1
  // lever), not the gameplay-fee VIG_BPS (6000) it silently rode before. Asserted at the ROW so the
  // aggregate check can't mask a compensating error. MUTATION: revert recordTradeFee to omit
  // `bps: TRADE_FEE.VIG_BPS` and BOTH this and the 'trade fee books its declared split' check fail.
  const tr = (await pool.query("SELECT gross_eth, vig_eth FROM vig_revenue WHERE source='trade' AND ref='910004'")).rows[0];
  assert(tr, 'the trade fee row landed');
  assert.equal(Number(tr.vig_eth), Number(tr.gross_eth) * TRADE_FEE.VIG_BPS / 10000,
    'the trade fee books the DECLARED 100% to the Vig — the booking path reads the lever (F1)');
  assert.notEqual(TRADE_FEE.VIG_BPS, VIG_BPS, 'the two levers genuinely differ, so the assertion above is not vacuous');

  // the comp booked ZERO revenue on both ledgers (the txHash gate — restated here because the
  // router's mirrors would drift if a comp ever booked)
  const compVig = (await pool.query("SELECT 1 FROM vig_revenue WHERE source='fee' AND ref='910002'")).rows[0];
  const compTre = (await pool.query("SELECT 1 FROM rwa_revenue WHERE source='fee' AND ref='910002'")).rows[0];
  assert(!compVig && !compTre, 'a comp fee books zero revenue on both ledgers');
}

// ── 3. THE BOARD — where a dollar goes, lifetime, with implicit remainders labelled ──
{
  const b = await routerBoard(pool);
  assert(b.waterfall.length === 8 && b.invariants.ok, 'the board carries the waterfall + a passing verdict');
  assert.equal(b.lifetime.fee.gross, 0.01, 'the fee gross counts ONLY the real payment (the comp is excluded)');
  assert.equal(b.lifetime.fee.vig, 0.01 * VIG_BPS / 10000, 'the fee vig slice matches the declared split');
  assert.equal(b.lifetime.store.treasury, 0.01 * STORE.SPLIT_BPS.rwa / 10000, 'the store treasury slice matches');
  assert(b.lifetime.tax.gross > 0 && Math.abs(b.lifetime.tax.founder + b.lifetime.tax.treasury + b.lifetime.tax.pol - b.lifetime.tax.gross) < 1e-6,
    'the sell-tax slices sum to the taxed gross (the remainder rule holds on the board)');
  const feeDecl = b.waterfall.find((s) => s.id === 'fee');
  assert(feeDecl.splits.find((x) => x.dest === 'founder').implicit === true,
    'the never-stored founder remainder is LABELLED implicit — arithmetic is not a ledger');
}

// ── 4. THE CROSS-SOURCE CHECKS each catch their own class (attack, assert, restore) ──
{
  // (a) SOURCE MEMBERSHIP — revenue outside the declared map is the loudest router alarm.
  await pool.query("INSERT INTO vig_revenue (source, ref, gross_eth, vig_eth) VALUES ('mystery','rt-x-1',1,0.6)");
  let inv = await runRouterInvariants(pool);
  const memb = inv.checks.find((c) => c.name === 'vig_revenue sources are declared');
  assert(!inv.ok && memb && !memb.ok && /mystery/.test(memb.detail || ''),
    'an unknown vig_revenue source fails BY NAME, naming the source');
  await pool.query("DELETE FROM vig_revenue WHERE source='mystery'");
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('sidechannel','rt-x-2',1)");
  inv = await runRouterInvariants(pool);
  const memb2 = inv.checks.find((c) => c.name === 'treasury (rwa_revenue) sources are declared');
  assert(!inv.ok && memb2 && !memb2.ok && /sidechannel/.test(memb2.detail || ''),
    'an unknown treasury source fails BY NAME');
  await pool.query("DELETE FROM rwa_revenue WHERE source='sidechannel'");

  // (b) THE ORPHAN MIRRORS — 'fee'/'store' rows were inserted and reconciled NOWHERE (the mapping
  // pass's gap). Delete a mirror row: the ledger now disagrees with the declared split over the
  // real gross, and the check says so.
  await pool.query("DELETE FROM rwa_revenue WHERE source='fee' AND ref='910001'");
  inv = await runRouterInvariants(pool);
  const mir = inv.checks.find((c) => c.name === 'fee → treasury mirror matches the declared split');
  assert(!inv.ok && mir && !mir.ok, 'a dropped fee→treasury mirror fails BY NAME');
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('fee','910001',$1)",
    [0.01 * TREASURY.FEE_TREASURY_BPS() / 10000]);
  assert((await runRouterInvariants(pool)).ok, 'restored — green again');

  // (c) THE DEV-FUND IDENTITY — the one revenue bucket that had no balance==ledger check. Credit
  // the bucket with no tax:dev row behind it: the identity fails on both legs.
  await pool.query('UPDATE dev_fund SET omr = omr + 5, lifetime = lifetime + 5 WHERE id=1');
  inv = await runRouterInvariants(pool);
  const dev = inv.checks.find((c) => c.name === 'dev fund balance == ledger (tax:dev − claims)');
  const devL = inv.checks.find((c) => c.name === 'dev fund lifetime == Σ tax:dev');
  assert(!inv.ok && dev && !dev.ok && devL && !devL.ok, 'an unledgered dev_fund credit fails BOTH identity legs by name');
  await pool.query('UPDATE dev_fund SET omr = omr - 5, lifetime = lifetime - 5 WHERE id=1');
  assert((await runRouterInvariants(pool)).ok, 'restored — green again');
}

// ── 5. THE SURFACES — the mod route serves the board; the panel's endpoint is real ──
{
  const r = await mod('GET', '/v1/mod/router');
  assert.equal(r.code, 200, 'GET /v1/mod/router serves');
  assert(r.body.waterfall && r.body.lifetime && r.body.invariants, 'the route carries all three layers');
  const noKey = await app.inject({ method: 'GET', url: '/v1/mod/router' });
  assert.equal(noKey.statusCode, 401, 'and it is mod-gated');
}

console.log("✅ THE MONEY ROUTER test passed — one declared waterfall over every real-value inflow (8 sources, each summing exactly, derived from the LIVE levers), the cross-source invariants the five per-system runners cannot see (source membership on both revenue ledgers naming an unknown source, the two orphan 'fee'/'store' mirrors reconciled against the declared splits, the trade fee held to its DECLARED lever — the F1 constant-vs-wiring drift that booked 60% against a signed 100%, now fixed and regression-pinned at the ROW, non-vacuous by construction — and the dev-fund balance==ledger identity on both legs), the WHERE-A-DOLLAR-GOES board (real-only grosses, implicit remainders labelled, the sell-tax remainder rule summing exactly), and the mod-gated surface. The router moves NO money — declare, verify, display.");
await app.close();
