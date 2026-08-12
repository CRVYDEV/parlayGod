// ── THE MONEY ROUTER — declare / verify / display (moves NO money) ────────────────────────────────
// The split landscape grew a slice at a time (sell tax 3-way, bonds 4, Store 3, fees 3, toll 2,
// auction 2), each individually checked but with NO statement of the whole map, NO source-membership
// check on either revenue ledger, TWO mirrors ('fee'/'store') never reconciled anywhere, NO dev_fund
// balance identity — and one live constant-vs-wiring drift: the trade fee's booking path read no
// lever at all, so it booked 60% against a declared 100% with both invariants green (F1, fixed with
// this suite; the rail itself was retired 2026-08-11 and the check inverted to a freshness check).
// This proves the router closes every one of those, and that a mutation to any fails BY NAME.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA gate: the mod ingest routes may carry a txHash here
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import fs from 'node:fs';
import { waterfall, runRouterInvariants, routerBoard, VIG_SOURCES, TREASURY_SOURCES, BANK_SOURCES, BANK_HARVEST_FEE_BPS } from '../src/router.js';
import { VIG_BPS } from '../src/vig.js';
import { STORE, TREASURY } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const mod = async (method, url, body) => {
  const res = await app.inject({ method, url, headers: { 'x-mod-key': 'test-mod-key', 'content-type': 'application/json' }, payload: body });
  return { code: res.statusCode, body: res.json() };
};

// ── 1. THE DECLARATION — every source sums, and the shape is what the board serves ──
{
  const wf = waterfall();
  assert.deepEqual(wf.map((s) => s.id), ['fee', 'store', 'bond', 'tax', 'trade', 'auction', 'polfees', 'harvest', 'toll'],
    'the waterfall declares every real-value inflow, in one place');
  // THE BANK's harvest fee is declared in the market's UNDERLYING, not ETH. That is not cosmetic:
  // `rwa_revenue`'s sum IS the vault's `held` wall, so a USDC amount mirrored there would inflate the
  // one number bounding what players may be owed.
  const harvest = wf.find((s) => s.id === 'harvest');
  assert.equal(harvest.currency, 'usd', "the harvest fee is denominated in the market's underlying, never ETH");
  assert.equal(harvest.splits[0].dest, 'treasury', 'the harvest fee lands in the treasury (the one address that only ever receives)');
  // The rate here RESTATES Alchemist.harvestFeeBps (this layer cannot import Solidity), so it is
  // pinned against the contract source — the preflight vig-defaults discipline. A restatement nobody
  // crosses against its source is exactly how the bond's fourth slice read zero for months.
  const alch = fs.readFileSync('omerta-contracts/src/Alchemist.sol', 'utf8');
  const m = alch.match(/harvestFeeBps\s*=\s*(\d[\d_]*)/);
  assert(m, 'found the contract default');
  assert.equal(Number(m[1].replace(/_/g, '')), BANK_HARVEST_FEE_BPS,
    'the router restates the CONTRACT\'s harvest fee — if the contract moves, this must move with it');
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
    { ref: 'rt-tax-1', omrTaxed: 90, price: 500, txHash: '0x' + 'd'.repeat(64), bootstrap: true });
  assert.equal(r3.code, 200, 'real sell-tax episode ingests');

  const inv = await runRouterInvariants(pool);
  assert(inv.ok, `router invariants hold over real ingests: ${JSON.stringify(inv.checks.filter((c) => !c.ok))}`);

  // THE RETIRED RAIL — the declaration still carries it (a rail that vanishes from the map explains
  // nothing, and a historical row would have nothing to reconcile against) and the freshness check
  // asserts nothing NEW books it. MUTATION: insert a fresh source='trade' row and the run fails BY
  // NAME on 'trade fee retired (nothing new books it)'.
  // THE BANK's ingest through its real entry (the mod route carries the same anti-fabrication gate
  // as fees/store/bonds: a comp records the episode and books ZERO).
  const h1 = await mod('POST', '/v1/mod/bank/harvest',
    { ref: '0xharvest:1', asset: 'usdc', amount: 12.5, txHash: '0x' + '1'.repeat(64) });
  assert.equal(h1.code, 200, 'a real harvest fee ingests');
  const h2 = await mod('POST', '/v1/mod/bank/harvest', { ref: '0xharvest:2', asset: 'USDC', amount: 99 }); // comp
  assert.equal(h2.code, 200, 'a comp harvest records the episode');
  const hr = (await pool.query("SELECT asset, amount, real FROM bank_revenue WHERE ref='0xharvest:1'")).rows[0];
  assert.equal(hr.asset, 'USDC', 'the asset is named and normalised');
  assert.equal(Number(hr.amount), 12.5, 'the amount is booked in whole units of the asset, not wei');
  const hc = (await pool.query("SELECT amount, real FROM bank_revenue WHERE ref='0xharvest:2'")).rows[0];
  assert.equal(Number(hc.amount), 0, 'a comp books ZERO — "the treasury received this" is never assertable by a QA call');
  assert.equal(hc.real, false, 'and it is marked as not real');
  const again = await mod('POST', '/v1/mod/bank/harvest',
    { ref: '0xharvest:1', asset: 'USDC', amount: 999, txHash: '0x' + '2'.repeat(64) });
  assert.equal(again.body.duplicate, true, 'a re-delivered log is a clean no-op (idempotent on the log key)');

  const traded = waterfall().find((s) => s.id === 'trade');
  assert(traded?.retired, "the retired trade rail stays DECLARED and is marked retired");
  assert.equal((await pool.query("SELECT COUNT(*)::int c FROM vig_revenue WHERE source='trade'")).rows[0].c, 0,
    'the retired rail has no producer left, so it books nothing');

  // the comp booked ZERO revenue on both ledgers (the txHash gate — restated here because the
  // router's mirrors would drift if a comp ever booked)
  const compVig = (await pool.query("SELECT 1 FROM vig_revenue WHERE source='fee' AND ref='910002'")).rows[0];
  const compTre = (await pool.query("SELECT 1 FROM rwa_revenue WHERE source='fee' AND ref='910002'")).rows[0];
  assert(!compVig && !compTre, 'a comp fee books zero revenue on both ledgers');
}

// ── 3. THE BOARD — where a dollar goes, lifetime, with implicit remainders labelled ──
{
  const b = await routerBoard(pool);
  assert.equal(b.lifetime.harvest.byAsset.USDC, 12.5, 'the board reports bank revenue by ASSET, so a stablecoin is never read as ETH');
  assert(b.waterfall.length === 9 && b.invariants.ok, 'the board carries the waterfall + a passing verdict');
  assert.equal(b.lifetime.fee.gross, 0.01, 'the fee gross counts ONLY the real payment (the comp is excluded)');
  assert.equal(b.lifetime.fee.vig, 0.01 * VIG_BPS / 10000, 'the fee vig slice matches the declared split');
  assert.equal(b.lifetime.store.treasury, 0.01 * STORE.SPLIT_BPS.rwa / 10000, 'the store treasury slice matches');
  assert(b.lifetime.tax.gross > 0 && Math.abs(b.lifetime.tax.operations + b.lifetime.tax.treasury + b.lifetime.tax.pol - b.lifetime.tax.gross) < 1e-6,
    'the sell-tax slices sum to the taxed gross (the remainder rule holds on the board)');
  const feeDecl = b.waterfall.find((s) => s.id === 'fee');
  assert(feeDecl.splits.find((x) => x.dest === 'operations').implicit === true,
    'the never-stored operations remainder is LABELLED implicit — arithmetic is not a ledger');
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

console.log("✅ THE MONEY ROUTER test passed — one declared waterfall over every real-value inflow (9 sources, each summing exactly, derived from the LIVE levers), the cross-source invariants the five per-system runners cannot see (source membership on all THREE revenue ledgers naming an unknown source, the two orphan 'fee'/'store' mirrors reconciled against the declared splits, the retired trade rail staying retired — the freshness shape that replaced the F1 constant-vs-wiring check, with the declaration kept so history still has something to reconcile against — and the dev-fund balance==ledger identity on both legs), the WHERE-A-DOLLAR-GOES board (real-only grosses, implicit remainders labelled, the sell-tax remainder rule summing exactly), and the mod-gated surface. The router moves NO money — declare, verify, display.");
await app.close();
