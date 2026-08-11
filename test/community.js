// ── THE COMMUNITY EARMARK + THE FAMILY BUYBACK — Phase 1 of the treasury→family split ────────────
// (`omerta-treasury-to-family-design.md` §4/§8; `src/community.js`.)
//
// The assertions aim at the five ways this could go wrong, not the happy path:
//
//   (1) PHASE 1 IS NOT BYTE-IDENTICAL. Every slice lever ships at ZERO, so with no env set the five
//       ingests must book EXACTLY what they booked before this drop existed — no community row, the
//       full harvest amount to the bank, the full POL fee to the buyback budget, a sell-tax episode
//       whose LP remainder is the original three-way split. A nonzero default is a silent production
//       balance change wearing a dormant feature's clothes.
//   (2) SUPPLY IS FABRICATED. `yield:buyback` is a MINT; a comp/QA call with a caller-supplied price
//       must book ZERO spend and ZERO $OMR (the bank posture, stricter than the desk's — the pool's
//       exit reaches real families), and the mod route must STRIP a txHash unless
//       ALLOW_MOD_REAL_REVENUE is on (the D-MED2 discipline).
//   (3) MORE GOES OUT THAN CAME IN. The keeper's root cap (`spend ≤ community revenue`, per
//       currency) is the wall; a comp consuming the budget would starve the real buy that follows.
//   (4) THE FLIP IS A SILENT SQUEEZE. The rules.tail.js load guard makes turning the sell-tax slice
//       on REQUIRE lowering a sibling scalar in the same deploy — proven in a subprocess, both ways.
//   (5) §10.4 DRIFTS. The mint has no counted-bucket debit, so it is admissible exactly to the
//       extent the exact `yield:buyback` reason is in omrMints (the kitchen:module class) — asserted
//       ABSOLUTE (this suite SQL-seeds no unledgered $OMR).
//
// pg-mem, zero infra. The five slice levers are FUNCTION-levers (env read per call), so they are set
// AFTER buildServer — setting SELL_TAX_COMMUNITY_BPS before rules.js loads would (correctly) refuse
// the boot via the four-way guard this suite proves in block 6.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildServer } from '../src/server.js';
import { SELL_TAX } from '../src/rules.js';
import * as Community from '../src/community.js';
import { recordFeePayment } from '../src/fees.js';
import { recordStorePurchase } from '../src/store.js';
import { recordSellTax, recordHarvestFee } from '../src/treasury.js';
import { recordPolFees } from '../src/desk.js';
import { runRouterInvariants, routerBoard } from '../src/router.js';
import { runExchangeInvariants } from '../src/exchange.js';
import { runLedgerInvariants } from '../src/invariants.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const app = await buildServer();
const pool = app.pool;
const mod = async (method, url, body) => {
  const res = await app.inject({ method, url, headers: { 'x-mod-key': 'test-mod-key', 'content-type': 'application/json' }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const wallet = '0x' + 'a'.repeat(40);
const tx = () => '0x' + crypto.randomUUID().replace(/-/g, '');
const commRows = async (source) => (await pool.query(
  'SELECT * FROM community_revenue' + (source ? ' WHERE source=$1' : ''), source ? [source] : [])).rows;
const poolRow = async () => (await pool.query('SELECT * FROM family_yield_pool WHERE id=1')).rows[0];
const mintedOmr = async () => Number((await pool.query(
  "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE currency='omr' AND reason='yield:buyback'")).rows[0].s);
const checkOf = async (runner, name) => {
  const r = await runner(pool);
  const c = r.checks.find((x) => x.name === name);
  assert(c, `the "${name}" check exists`);
  return c;
};

// ── 1. PHASE 1 DEFAULTS ARE ZERO — production is byte-identical until the flip ──────────────────
// Every ingest driven REAL (a txHash) with no lever set: the community ledger must stay EMPTY and
// each booking must be the pre-drop figure exactly.
{
  await recordFeePayment(pool, { nonce: 800001, kind: 'mint', payer: wallet, amountWei: (10n ** 16n).toString(), txHash: tx() });
  await recordStorePurchase(pool, { nonce: 800002, sku: 'decor_deco', payer: wallet, amountWei: (2n * 10n ** 16n).toString(), txHash: tx() });
  const taxed = await recordSellTax(pool, { ref: 'cm-tax-0', omrTaxed: 900, priceOmrPerEth: 1000, txHash: tx() });
  // gross 0.9 ETH → the ORIGINAL three-way split: dev 0.2 / rwa 0.4 / lp 0.3, community 0
  assert.equal(taxed.communityEth, 0, 'a default sell-tax episode carves NO community slice');
  assert.equal(taxed.lpEth, round6(0.9 * SELL_TAX.LP_BPS / SELL_TAX.BPS), 'the LP remainder is the pre-drop figure exactly');
  const harv = await recordHarvestFee(pool, { ref: 'cm-harv-0', asset: 'USDC', amount: 50, txHash: tx() });
  assert.equal(harv.amount, 50, 'a default harvest fee books the FULL amount to the bank (the city leg budget is untouched)');
  assert.equal(harv.communityAmount, 0, '...and no community carve');
  const pf = await recordPolFees(pool, { ref: 'cm-pf-0', eth: 1, txHash: tx() });
  assert.equal(pf.eth, 1, 'a default POL fee books the FULL eth to the buyback budget');
  assert.equal(pf.vigEth, 0, '...and diverts nothing to the Vig');
  assert.equal((await pool.query("SELECT 1 FROM vig_revenue WHERE source='polfees'")).rows.length, 0,
    'no polfees vig row exists at the defaults');
  assert.equal((await commRows()).length, 0, 'the community ledger is EMPTY at the defaults — Phase 1 is byte-identical');
  assert.equal(await Community.runFamilyBuyback(pool, { priceOmr: 100 }), null,
    'the keeper has nothing to spend at the defaults (a clean null, never a zero-buy row)');
  assert.equal((await pool.query('SELECT COUNT(*)::int c FROM family_buybacks')).rows[0].c, 0,
    'no buyback row was written for the empty budget');
}

// ── 2. THE FLIP — the five levers on (function-levers, read per call), every carve exact ────────
// The locked design's Phase-2 values. NOTE the sell-tax runtime here: the RWA sibling is a LOADED
// const (400), so the LP remainder absorbs the 240 — the LOAD guard proven in block 6 is what makes
// production lower RWA in the same deploy. What this block asserts is the carve arithmetic and that
// the four shares still sum to the gross exactly.
process.env.FEE_COMMUNITY_BPS = '1500';
process.env.STORE_COMMUNITY_BPS = '1500';
process.env.SELL_TAX_COMMUNITY_BPS = '240';
process.env.HARVEST_COMMUNITY_BPS = '6280';
process.env.POL_FEES_VIG_BPS = '2500';
{
  // the gameplay fee: 0.01 ETH × 15% = 0.0015
  await recordFeePayment(pool, { nonce: 800003, kind: 'mint', payer: wallet, amountWei: (10n ** 16n).toString(), txHash: tx() });
  const fee = await commRows('fee');
  assert.equal(fee.length, 1, 'the real fee carved ONE community row');
  assert.equal(Number(fee[0].amount), 0.0015, 'fee slice = gross × FEE_COMMUNITY_BPS exactly');
  assert.equal(fee[0].currency, 'eth');
  // a COMP fee (no txHash) books nothing, lever on or not — the txHash gate lives at the caller
  await recordFeePayment(pool, { nonce: 800004, kind: 'mint', payer: wallet, amountWei: (10n ** 16n).toString() });
  assert.equal((await commRows('fee')).length, 1, 'a comp fee books NO community slice even with the lever on');

  // the Store: 0.02 ETH × 15% = 0.003, carved BEFORE the founder remainder
  await recordStorePurchase(pool, { nonce: 800005, sku: 'decor_deco', payer: wallet, amountWei: (2n * 10n ** 16n).toString(), txHash: tx() });
  const store = await commRows('store');
  assert.equal(store.length, 1, 'the real Store purchase carved ONE community row');
  assert.equal(Number(store[0].amount), 0.003, 'store slice = gross × STORE_COMMUNITY_BPS exactly');

  // the sell tax: gross 0.9 → dev 0.2 / rwa 0.4 / community 0.9×240÷900 = 0.24 / lp = the remainder
  const taxed = await recordSellTax(pool, { ref: 'cm-tax-1', omrTaxed: 900, priceOmrPerEth: 1000, txHash: tx() });
  assert.equal(taxed.communityEth, 0.24, 'tax slice = gross × TAX_BPS ÷ SELL_TAX.BPS exactly');
  assert.equal(round6(taxed.devEth + taxed.rwaEth + taxed.communityEth + taxed.lpEth), taxed.grossEth,
    'the FOUR shares sum to the gross exactly — the LP remainder rule holds with the fourth slice in');
  const evRow = (await pool.query('SELECT community_eth FROM sell_tax_events WHERE ref=$1', ['cm-tax-1'])).rows[0];
  assert.equal(Number(evRow.community_eth), 0.24, 'the episode row carries the authoritative per-episode split');
  assert.equal(Number((await commRows('tax'))[0].amount), 0.24, '...mirrored into the community ledger (the 9d pair)');
  // a comp tax episode books zero across ALL FOUR slices
  const comped = await recordSellTax(pool, { ref: 'cm-tax-comp', omrTaxed: 900, priceOmrPerEth: 1000 });
  assert.equal(comped.communityEth, 0, 'a comp tax episode books a zero community slice');

  // the harvest fee: 100 USDC → community 62.8, the bank keeps the exact remainder 37.2 — IN THE
  // MARKET'S UNDERLYING (currency = the asset symbol), which is what the keeper's per-currency
  // root cap and price wall exist for.
  const harv = await recordHarvestFee(pool, { ref: 'cm-harv-1', asset: 'USDC', amount: 100, txHash: tx() });
  assert.equal(harv.communityAmount, 62.8, 'harvest slice = amount × HARVEST_COMMUNITY_BPS exactly');
  assert.equal(harv.amount, 37.2, 'the bank books the exact remainder (the city leg budget shrinks by the carve)');
  const hRow = (await commRows('harvest'))[0];
  assert.equal(hRow.currency, 'USDC', "the harvest carve is denominated in the underlying, never 'eth'");

  // the POL-fee diversion: 2 ETH × 25% = 0.5 to the Vig, the buyback budget books the NET 1.5
  const pf = await recordPolFees(pool, { ref: 'cm-pf-1', eth: 2, txHash: tx() });
  assert.equal(pf.vigEth, 0.5, 'polfees vig diversion = eth × POL_FEES_VIG_BPS exactly');
  assert.equal(pf.eth, 1.5, 'pol_fees books the NET — polBudget needs no new term');
  const vig = (await pool.query("SELECT gross_eth, vig_eth FROM vig_revenue WHERE source='polfees' AND ref='cm-pf-1'")).rows[0];
  assert.equal(Number(vig.vig_eth), 0.5, 'the vig row landed');
  assert.equal(Number(vig.gross_eth), 2, '...carrying the FULL fee as its gross');
  // re-delivery heals cleanly on BOTH sides (the vig-INSERT-first ordering argument)
  assert.equal((await recordPolFees(pool, { ref: 'cm-pf-1', eth: 2, txHash: tx() })).duplicate, true,
    'a re-delivered POL fee is a clean duplicate');
  assert.equal((await pool.query("SELECT COUNT(*)::int c FROM vig_revenue WHERE source='polfees' AND ref='cm-pf-1'")).rows[0].c, 1,
    '...and did not double-book the vig share');
  // a comp POL fee books zero on both sides
  const pfComp = await recordPolFees(pool, { ref: 'cm-pf-comp', eth: 9 });
  assert.equal(pfComp.eth + pfComp.vigEth, 0, 'a comp POL fee books ZERO on both sides');
}

// ── 3. THE KEEPER — real buys credit the pool; the root cap, the clamp, the wall, per currency ──
{
  // the ETH budget so far: fee 0.0015 + store 0.003 + tax 0.24 = 0.2445
  const before = await poolRow();
  const buy = await Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000, txHash: tx() });
  assert.equal(buy.spent, 0.2445, 'the keeper spends EXACTLY the unspent community revenue (the root cap)');
  assert.equal(buy.omrBought, round6(0.2445 * 200000), 'bought = spend × price');
  const after = await poolRow();
  assert.equal(round6(Number(after.balance) - Number(before.balance)), buy.omrBought,
    'the pool balance grew by exactly what was bought');
  assert.equal(round6(Number(after.lifetime_funded) - Number(before.lifetime_funded)), buy.omrBought,
    '...and lifetime_funded moved WITH it (fundFamilyYield is the one implementation)');
  assert.equal(await mintedOmr(), buy.omrBought, 'the yield:buyback mint row matches the credit to the unit');
  assert.equal(await Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000, txHash: tx() }), null,
    'a second run finds nothing left — the budget is a stock, not a promise');

  // the price-continuity wall, against the last REAL buy, per currency
  await pool.query("INSERT INTO community_revenue (source, ref, currency, gross, amount) VALUES ('fee','cm-wall','eth',0.01,0.0015)");
  await assert.rejects(() => Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000 * 11, txHash: tx() }),
    (e) => e.code === 'price_sanity', 'a price 11x the last real buy is refused');
  await assert.rejects(() => Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000 / 11, txHash: tx() }),
    (e) => e.code === 'price_sanity', '...and 11x cheap is refused the same way (a fat-finger mints a colossal credit)');
  // maxSpend clamps below the budget; the remainder stays spendable
  const clamped = await Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000, maxSpend: 0.001, txHash: tx() });
  assert.equal(clamped.spent, 0.001, 'maxSpend clamps the buy');
  const rest = await Community.runFamilyBuyback(pool, { currency: 'eth', priceOmr: 200000, txHash: tx() });
  assert.equal(rest.spent, 0.0005, 'the unclamped remainder is still there for the next run');

  // per-currency: the USDC budget (62.8) is untouched by every ETH buy above, and the ETH price
  // wall does not reach across — a first USDC buy has no last real USDC buy to be continuous with.
  const usdcComp = await mod('POST', '/v1/mod/community/buy', { currency: 'USDC', price: 4, txHash: '0xtry-to-fabricate' });
  assert.equal(usdcComp.code, 200);
  assert.equal(usdcComp.body.real, false, 'the mod route STRIPS the txHash without ALLOW_MOD_REAL_REVENUE (D-MED2)');
  assert.equal(usdcComp.body.spent + usdcComp.body.omrBought, 0, 'a comp books ZERO spend and ZERO $OMR');
  assert.equal(usdcComp.body.quote.toSpend, 62.8, '...but quotes the notional for QA legibility');
  const poolAfterComp = await poolRow();
  const usdcReal = await Community.runFamilyBuyback(pool, { currency: 'USDC', priceOmr: 4, txHash: tx() });
  assert.equal(usdcReal.spent, 62.8, 'the comp did NOT consume the budget — the real buy still spends the full carve');
  assert.equal(usdcReal.omrBought, round6(62.8 * 4), 'a USDC buy at 4 clears with no ETH-wall interference (per-currency walls)');
  assert.equal(round6(Number((await poolRow()).balance) - Number(poolAfterComp.balance)), usdcReal.omrBought,
    'only the REAL buy moved the pool');
}

// ── 4. §10.4 + the sibling invariants hold with the new funder in the mix ───────────────────────
{
  const inv = await runLedgerInvariants(pool, { alert: false });
  const cons = inv.checks.find((c) => c.name === '$OMR conservation');
  assert(cons.ok, `$OMR conservation holds ABSOLUTE with yield:buyback minting: ${JSON.stringify(cons)}`);
  const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
  assert(vocab.ok, `the vocabulary is closed over the new reason: ${JSON.stringify(vocab.detail || vocab)}`);
  // the exchange's own family-yield identities stay exact with a SECOND funder — balance and
  // lifetime_funded move together through the one fundFamilyYield implementation
  const ex = await runExchangeInvariants(pool);
  for (const name of ['family yield backed', 'family yield balance']) {
    const c = ex.checks.find((x) => x.name === name);
    assert(c.ok, `"${name}" holds with the buyback funding the pot: ${JSON.stringify(c)}`);
  }
}

// ── 5. THE INVARIANT RUNNER — green baseline, then each violation fails BY NAME ─────────────────
{
  const base = await Community.runFamilyBuybackInvariants(pool);
  assert(base.ok, `the baseline is green: ${JSON.stringify(base.checks.filter((c) => !c.ok))}`);
  assert.equal(base.summary.walletMustHold, round6(await mintedOmr()),
    'walletMustHold attests exactly the bought $OMR (the treasury safeMustHold shape)');

  // (a) a pool credit with no purchase behind it
  await pool.query(
    "INSERT INTO transactions (id, character_id, account_id, currency, amount, reason, counterparty) VALUES ($1,NULL,NULL,'omr',500,'yield:buyback',NULL)",
    [crypto.randomUUID()]);
  assert.equal((await checkOf(Community.runFamilyBuybackInvariants, 'buyback credited == bought')).ok, false,
    'a credit with no purchase fails BY NAME');
  await pool.query("DELETE FROM transactions WHERE reason='yield:buyback' AND amount=500");

  // (b) spend past the revenue that arrived
  await pool.query(
    "INSERT INTO family_buybacks (id, currency, spent, price_omr, omr_bought, tx_hash, real) VALUES ($1,'eth',9,1,9,'0xover',true)",
    [crypto.randomUUID()]);
  const over = await Community.runFamilyBuybackInvariants(pool);
  assert.equal(over.checks.find((c) => c.name === 'spend <= revenue (eth)').ok, false,
    'overspending the community budget fails BY NAME, per currency');
  await pool.query("DELETE FROM family_buybacks WHERE tx_hash='0xover'");

  // (c) a comp that moved money
  await pool.query(
    "INSERT INTO family_buybacks (id, currency, spent, price_omr, omr_bought, tx_hash, real) VALUES ($1,'eth',1,1,1,NULL,false)",
    [crypto.randomUUID()]);
  assert.equal((await checkOf(Community.runFamilyBuybackInvariants, 'comps buy nothing')).ok, false,
    'a comp that booked spend or $OMR fails BY NAME');
  await pool.query('DELETE FROM family_buybacks WHERE NOT real AND spent > 0');
  assert((await Community.runFamilyBuybackInvariants(pool)).ok, 'green again after cleanup');

  // the mod surface: the invariant IS the GET body, and both routes are mod-gated
  const got = await mod('GET', '/v1/mod/community');
  assert.equal(got.code, 200);
  assert(got.body.ok && got.body.summary.walletMustHold >= 0, 'GET /v1/mod/community serves the runner');
  const ungated = await app.inject({ method: 'GET', url: '/v1/mod/community' });
  assert(ungated.statusCode >= 400, 'no mod key, no invariant view');
}

// ── 6. THE FLIP GUARD — turning the sell-tax slice on requires lowering a sibling, proven both ways
{
  const load = (env) => {
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e',
        "await import('./src/rules.js');"], { env: { ...process.env, ...env }, stdio: 'pipe', cwd: process.cwd() });
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e.stderr || e) }; }
  };
  const bare = load({ SELL_TAX_COMMUNITY_BPS: '240', SELL_TAX_RWA_BPS: '' });
  assert.equal(bare.ok, false, 'a community slice with NO sibling lowered refuses to load');
  assert(/DEV\+RWA\+LP\+COMMUNITY/.test(bare.err), `...for the RIGHT reason (the four-way guard): ${bare.err.slice(0, 200)}`);
  const lockstep = load({ SELL_TAX_COMMUNITY_BPS: '240', SELL_TAX_RWA_BPS: '160' });
  assert.equal(lockstep.ok, true, `the locked design's lockstep (RWA 400→160) loads clean: ${lockstep.err || ''}`);
}

// ── 7. THE ROUTER sees the new ledger — membership + the two lever-history-immune mirrors ───────
{
  const inv = await runRouterInvariants(pool);
  const names = ['community_revenue sources are declared', 'community slice never exceeds its payment',
    'tax → community slice reached the ledger'];
  for (const n of names) {
    const c = inv.checks.find((x) => x.name === n);
    assert(c && c.ok, `router check "${n}" is green over the driven history`);
  }
  // an unknown source on the community ledger fails BY NAME (the every-unfiltered-SUM argument)
  await pool.query("INSERT INTO community_revenue (source, ref, currency, gross, amount) VALUES ('mystery','cm-x-1','eth',1,0.1)");
  const memb = (await runRouterInvariants(pool)).checks.find((c) => c.name === 'community_revenue sources are declared');
  assert(!memb.ok && /mystery/.test(JSON.stringify(memb)), 'an unknown community source fails, naming the source');
  await pool.query("DELETE FROM community_revenue WHERE source='mystery'");
  // a slice bigger than its payment fails BY NAME (the per-row check a moving lever cannot break)
  await pool.query("INSERT INTO community_revenue (source, ref, currency, gross, amount) VALUES ('fee','cm-x-2','eth',1,2)");
  assert.equal((await runRouterInvariants(pool)).checks.find((c) => c.name === 'community slice never exceeds its payment').ok,
    false, 'amount > gross fails by name');
  await pool.query("DELETE FROM community_revenue WHERE ref='cm-x-2'");
  // a tax-side booking that never reached the community ledger (or a phantom row) breaks the pair
  await pool.query("INSERT INTO community_revenue (source, ref, currency, gross, amount) VALUES ('tax','cm-x-3','eth',1,0.24)");
  assert.equal((await runRouterInvariants(pool)).checks.find((c) => c.name === 'tax → community slice reached the ledger').ok,
    false, 'the two-sided tax mirror fails when the sides disagree');
  await pool.query("DELETE FROM community_revenue WHERE ref='cm-x-3'");

  // the board: lifetime community sums per source, the harvest per-asset in the underlying
  const board = await routerBoard(pool);
  assert.equal(board.lifetime.fee.community, 0.003, 'board: fee community lifetime (two real fees × 0.0015)');
  assert.equal(board.lifetime.store.community, 0.003, 'board: store community lifetime');
  assert.equal(board.lifetime.tax.community, 0.24, 'board: tax community lifetime');
  assert.equal(board.lifetime.harvest.community.USDC, 62.8, 'board: harvest community in the underlying');
  assert.equal(board.lifetime.polfees.vig, 0.5, 'board: the polfees vig diversion');
}

// ── 8. THE WORKER WIRING (source tripwire — the nightly runner is not unit-drivable here) ───────
// The invariant that nobody reads is the §10.4-alarm-into-an-unread-log failure mode, so the
// worker's nightly block must run the family-buyback runner AND route a red result into alertDrift.
{
  const src = fs.readFileSync('src/worker.js', 'utf8');
  assert(/runFamilyBuybackInvariants/.test(src), 'the worker runs the family-buyback invariants nightly');
  assert(/familybuyback/.test(src), '...and routes a red result into alertDrift under its own label');
}

console.log('community: Phase 1 defaults byte-identical, the five earmarks exact (comps zero), the keeper capped/walled/clamped per currency crediting the pool through the one implementation, §10.4 absolute with yield:buyback minted, the runner + router fail by name, the flip guard proven both ways, the worker wired.');
process.exit(0);
