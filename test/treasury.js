// THE STOCK RESERVE — `allocated <= held`, per ticker, in units.
// Design: `omerta-brokers-design.md` §3.2 wall 1, step 2 of the order of work.
//
// WHY THIS FILE EXISTS AT ALL, given nothing in production writes either side yet. §3.3 decided that
// stock lands straight in the NFT's bound account with NO claim gate, which removes every other
// checkpoint between the treasury and a delivery. That makes this wall load-bearing rather than one
// check among several, and it is why it is built BEFORE the keeper and the delivery rather than
// retrofitted after — the two systems that will move real stock get written against a wall that
// already exists.
//
// A wall with no writers is a VACUOUS check, and this project has been caught by that shape more than
// once. So the file DRIVES BOTH SIDES: real fills go in, real allocations come out, and the
// over-allocation is attempted rather than assumed impossible.
process.env.MOD_KEY = 'test-mod-key';
process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // QA: let the mod route book a REAL fill (the D-MED2 gate)
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { allocateStock, runTreasuryInvariants, stockBudget } from '../src/treasury.js';
import { runLedgerInvariants } from '../src/invariants.js';

const app = await buildServer();
const pool = app.pool;
const mod = async (method, url, body) => {
  const res = await app.inject({ method, url, headers: { 'x-mod-key': 'test-mod-key' }, payload: body });
  return { code: res.statusCode, body: res.json() };
};
// asserts the check EXISTS before reading it. Without this, deleting the per-ticker arm outright
// fails as `Cannot read properties of undefined` on whichever line happens to touch it first — a
// true failure that tells the next reader nothing about what was lost.
const check = (inv, name) => {
  const c = inv.checks.find((x) => x.name === name);
  assert(c, `the sweep must CARRY the check "${name}" — a wall nobody computes is not a wall`);
  return c;
};
const ledgerRows = async () => Number((await pool.query('SELECT COUNT(*) c FROM transactions')).rows[0].c);

// The treasury needs ETH before it can buy anything. A real sell-tax episode is the honest way to put
// it there — the same ingest production uses, so the budget below is a real number and not a seed.
const rows0 = await ledgerRows();
// THE FIRST EPISODE IS DELIBERATE. `grossEth = omrTaxed / price`, and that gross is what `held` is
// built from — so an unreferenced first fill setting its own reference would let the very first
// episode be the absurd one. Asserted here rather than in the wall's own block below, because this
// is the one moment in the suite when both anchor tables are genuinely empty.
{
  const unanchored = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:0', omrTaxed: 100000, price: 500, txHash: '0xtax0' });
  assert.equal(unanchored.body?.error, 'price_unanchored',
    'the first REAL tax episode is refused until it is seeded deliberately');
  assert.equal((await pool.query('SELECT COUNT(*) c FROM sell_tax_events')).rows[0].c, '0',
    'a refused episode books nothing at all');

  // AND A COMP CANNOT BECOME THE ANCHOR. An unanchored comp is free (it books zero, so there is
  // nothing to bound), which is precisely why the reference must read REAL prints only: otherwise a
  // QA call would plant the reference and the first real episode would inherit it — the QA path
  // moving the wall, which is the anti-fabrication gate's whole point one level up.
  const comp = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:0-comp', omrTaxed: 100000, price: 0.0001 }); // no txHash
  assert.equal(comp.code, 200, 'an unanchored comp records the episode');
  assert.equal(comp.body.rwaEth, 0, 'and books zero, as comps always do');
  const after = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:0b', omrTaxed: 100000, price: 0.0001, txHash: '0xtax0b' });
  assert.equal(after.body?.error, 'price_unanchored',
    'a comp does not anchor the wall — the first REAL episode is still refused');
}
await mod('POST', '/v1/mod/treasury/tax',
  { ref: 'tax:1', omrTaxed: 100000, price: 500, txHash: '0xtax', bootstrap: true });

// ── A COMP BOOKS ZERO UNITS — the sharpest instance of the anti-fabrication gate ────────────────
// Everywhere else a comp merely fails to credit revenue. Here the fabricated quantity IS the wall's
// input: units are the ceiling on what may ever be delivered, so a QA fill that booked them would
// raise that ceiling with no asset behind it, and `allocated <= held` would wave the delivery
// through while reading green. Driven through the route rather than the function, because the route
// is where the gate lives.
let r = await mod('POST', '/v1/mod/treasury/buy', { ref: 'buy:comp', ticker: 'TSLA', units: 500, ethSpent: 5 });
assert.equal(r.code, 200, 'a comp fill is recorded');
assert.equal(r.body.real, false, 'and marked as a comp');
assert.equal(r.body.units, 0, 'a comp books ZERO UNITS — fabricated holdings would raise the delivery ceiling');
assert.equal(r.body.ethSpent, 0, 'and ZERO spend');
let inv = await runTreasuryInvariants(pool);
assert.equal(inv.stock.length, 0, 'so a comp leaves the reserve genuinely empty');

// ── a REAL fill stocks the reserve ──────────────────────────────────────────────────────────────
r = await mod('POST', '/v1/mod/treasury/buy',
  { ref: 'buy:1', ticker: 'TSLA', units: 10, ethSpent: 2, txHash: '0xfill1', bootstrap: true });
assert.equal(r.body.real, true);
assert.equal(r.body.units, 10, 'a real fill books its units');
r = await mod('POST', '/v1/mod/treasury/buy', { ref: 'buy:1', ticker: 'TSLA', units: 10, ethSpent: 2, txHash: '0xfill1' });
assert.equal(r.body.duplicate, true, 'a re-delivered fill is a clean no-op, not a second holding');

// ── AND THE INGEST WALLS THE RATE, not just the realness ───────────────────────────────────────
// The comp gate above stops a FABRICATED fill. It cannot stop a real one at an absurd RATE, and the
// quantity is the wall's input: `SUM(units) WHERE real` IS `held`. The keeper enforces this too,
// but the keeper is not the only way in — this route is, and so is whatever the mainnet bot calls.
{
  const wild = await mod('POST', '/v1/mod/treasury/buy',
    { ref: 'buy:wild', ticker: 'TSLA', units: 1000000, ethSpent: 0.01, txHash: '0xfillwild' });
  assert.equal(wild.body?.error, 'price_sanity',
    'a million units for a penny is refused at the ingest, not just at the keeper');
  const stillTen = (await runTreasuryInvariants(pool)).stock.find((s) => s.ticker === 'TSLA');
  assert.equal(stillTen.held, 10, 'and the ceiling on what may be delivered did not move');
  // per TICKER — a TSLA print says nothing about AMZN, so AMZN's first fill is still unanchored
  const other = await mod('POST', '/v1/mod/treasury/buy',
    { ref: 'buy:other', ticker: 'AMZN', units: 5, ethSpent: 1, txHash: '0xfillother' });
  assert.equal(other.body?.error, 'price_unanchored',
    "a TSLA print does not anchor AMZN — the wall is per ticker");
}

inv = await runTreasuryInvariants(pool);
const tsla = inv.stock.find((s) => s.ticker === 'TSLA');
assert.equal(tsla.held, 10, 'the reserve holds what was really bought');
assert.equal(tsla.allocated, 0);
assert(check(inv, 'allocated <= held (TSLA, units)').ok, 'and the per-ticker wall holds');

// ── THE WALL: you cannot promise units you do not hold ──────────────────────────────────────────
// Not asserted as "impossible" — attempted. The clamp is the PREVENTION (the invariant is only the
// detector, and with no delivery gate a detector that fires the next night is too late).
const client = await pool.connect();
let a = await allocateStock(client, { epochId: 'e1', accountId: '00000000-0000-0000-0000-000000000001', ticker: 'TSLA', units: 4 });
assert.equal(a.units, 4, 'a within-reserve allocation is paid in full');
assert.equal(a.clamped, false);
a = await allocateStock(client, { epochId: 'e1', accountId: '00000000-0000-0000-0000-000000000002', ticker: 'TSLA', units: 99 });
assert.equal(a.units, 6, 'an over-ask is CLAMPED to what is left, not refused wholesale');
assert.equal(a.clamped, true, 'and says so, so an epoch can record that it was short');
a = await allocateStock(client, { epochId: 'e1', accountId: '00000000-0000-0000-0000-000000000003', ticker: 'TSLA', units: 1 });
assert.equal(a.units, 0, 'an empty reserve promises NOTHING — the wall, at the point the promise is made');

// ...and the SAME wall on the ACCUMULATE path. `allocateStock` is UPDATE-then-INSERT and everything
// above only exercises the INSERT half, which is how the brokers recorder shipped half-tested and
// read as whole. A second allocation to the same (epoch, account, ticker) has to ADD, and has to be
// clamped by what the first one already took.
await mod('POST', '/v1/mod/treasury/buy',
  { ref: 'buy:3', ticker: 'TSLA', units: 3, ethSpent: 1, txHash: '0xfill3' });
a = await allocateStock(client, { epochId: 'e1', accountId: '00000000-0000-0000-0000-000000000001', ticker: 'TSLA', units: 2 });
assert.equal(a.units, 2, 'a top-up out of fresh reserve is paid');
const acc = (await pool.query(
  "SELECT units FROM stock_allocations WHERE epoch_id='e1' AND account_id='00000000-0000-0000-0000-000000000001' AND ticker='TSLA'")).rows[0];
assert.equal(Number(acc.units), 6, 'and ACCUMULATES on the existing row — 4 + 2, not a second row and not an overwrite');
a = await allocateStock(client, { epochId: 'e1', accountId: '00000000-0000-0000-0000-000000000001', ticker: 'TSLA', units: 5 });
assert.equal(a.units, 1, 'the wall still binds on the accumulate path — only 1 of the 3 new units is left');
client.release();

inv = await runTreasuryInvariants(pool);
const t2 = inv.stock.find((s) => s.ticker === 'TSLA');
assert.equal(t2.allocated, 13, 'every held unit is promised (10 + the 3-unit top-up fill)');
assert.equal(t2.available, 0);
assert(check(inv, 'allocated <= held (TSLA, units)').ok, 'and the wall still holds at the boundary');
assert.equal(inv.safeMustHoldUnits.TSLA, 13,
  'the attestation line states the obligation in UNITS — the Safe must hold this, not a cash value');

// ── the wall is NOT vacuous: breach it and the nightly check fails ──────────────────────────────
// Written directly, bypassing `allocateStock`, because that is exactly the shape of the failure this
// check exists to catch — a future writer (the keeper, a delivery path, a migration) that reaches the
// table without going through the clamp.
await pool.query(
  "INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e2','00000000-0000-0000-0000-000000000004','TSLA',1)");
inv = await runTreasuryInvariants(pool);
assert.equal(check(inv, 'allocated <= held (TSLA, units)').ok, false,
  'owing 14 units against 13 held is a BREACH — the check can actually fail');
assert.equal(inv.ok, false, 'and the whole sweep goes red, which is what reaches alertDrift');
await pool.query("DELETE FROM stock_allocations WHERE epoch_id='e2'");

// ── PER TICKER, not summed: a surplus in one must never cover a shortfall in another ────────────
// They are not fungible and a delivery is made in a specific ticker, so a summed check would let the
// treasury owe TSLA it does not hold as long as it held enough AMZN.
await mod('POST', '/v1/mod/treasury/buy',
  { ref: 'buy:2', ticker: 'AMZN', units: 50, ethSpent: 1, txHash: '0xfill2', bootstrap: true });
await pool.query(
  "INSERT INTO stock_allocations (epoch_id, account_id, ticker, units) VALUES ('e3','00000000-0000-0000-0000-000000000005','TSLA',5)");
inv = await runTreasuryInvariants(pool);
assert.equal(check(inv, 'allocated <= held (TSLA, units)').ok, false, 'TSLA is short');
assert.equal(check(inv, 'allocated <= held (AMZN, units)').ok, true, 'AMZN is fine');
assert.equal(inv.ok, false, 'and a healthy AMZN surplus does NOT paper over the TSLA shortfall');
await pool.query("DELETE FROM stock_allocations WHERE epoch_id='e3'");

// ── THE COUPLING: ETH spent on stock stops backing ETH claims ───────────────────────────────────
// The thing this build exists to prevent, and the one that would have broken the EXISTING vault
// silently. `rwa_revenue` is an INFLOW ledger and records nothing about what leaves; without the
// spend term the vault would keep quoting ETH the treasury had already converted into stock.
const budget = await stockBudget(pool);
assert.equal(budget.spentEth, 4, 'the keeper has spent 2 + 1 + 1 ETH across the real fills');
assert.equal(budget.spendableEth, budget.heldEth - budget.allocatedEth - budget.spentEth,
  'and what it may spend next is what arrived, less what is promised, less what it already spent');
// TWO checks, not one stronger one: the vault over-allocating and the keeper overspending are
// different failures with different owners, and an alarm that cannot tell them apart is worse to be
// woken by than one that can.
assert(check(inv, 'allocated <= held (ETH)').ok, 'the vault itself is not over-allocated');
const ethCheck = check(inv, 'allocated + spent <= held (ETH)');
assert.equal(ethCheck.lhs, budget.allocatedEth + budget.spentEth,
  'and the spend-aware arm is what catches an overspending keeper, rather than a healthy-looking '
  + 'ledger with a hollow Safe behind it');

const status = (await mod('GET', '/v1/mod/treasury')).body;
assert.equal(status.holds, 'eth+stock', 'the ops view says what the treasury holds now');
assert.equal(status.spentOnStockEth, 4, 'and publishes the spend, which is why availability can fall');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE BUY KEEPER (step 5) — wall 4 (the root cap) and wall 3 (price continuity, fail-closed)
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Driven, not asserted-impossible: every refusal below is a call that really tries to buy.
const { runStockBuyback } = await import('../src/treasury.js');
const { TREASURY } = await import('../src/rules.js');
const keeperRows = async (tk) => Number((await pool.query(
  'SELECT COUNT(*) c FROM stock_buys WHERE ticker=$1', [tk])).rows[0].c);

// ── the first buy REFUSES, and that is the wall, not a gap ──────────────────────────────────────
// A ticker with no print has nothing to be continuous with. A keeper that set its own reference on
// the first fill would let the very first buy be the absurd one — so it is seeded deliberately.
{
  const before = await keeperRows('NVDA');
  const r0 = await runStockBuyback(pool, { ticker: 'NVDA', priceEthPerUnit: 0.2, maxEth: 1, ref: 'k:nvda:first', txHash: '0xk0' });
  assert.equal(r0.bought, false, 'a ticker with no print cannot be bought into');
  assert.equal(r0.reason, 'no_print', '…and says why, rather than failing obscurely');
  assert.equal(await keeperRows('NVDA'), before, 'and it wrote nothing — a refusal is not a fill');
}

// TSLA has a real print from the fills above. Read it, so every bound below is relative to a REAL
// number rather than a literal that goes stale the moment the fixture moves.
const lastPrint = Number((await pool.query(
  "SELECT price_eth_per_unit p FROM stock_buys WHERE ticker='TSLA' AND real ORDER BY created_at DESC LIMIT 1")).rows[0].p);
assert(lastPrint > 0, 'the fixture really has a TSLA print to bound against');

// ── WALL 3: an absurd rate is refused, in BOTH directions ───────────────────────────────────────
{
  const before = await keeperRows('TSLA');
  const high = await runStockBuyback(pool, { ticker: 'TSLA',
    priceEthPerUnit: lastPrint * TREASURY.KEEPER_MAX_PRICE_JUMP * 1.01, maxEth: 1, ref: 'k:high', txHash: '0xkh' });
  assert.equal(high.bought, false, 'a rate above the ceiling is refused');
  assert.equal(high.reason, 'price_high');
  // the LOW side is the one the RWA float actually shipped as a bug: a rate an order of magnitude
  // cheap reads as a bargain and is a broken feed or a fake token.
  const low = await runStockBuyback(pool, { ticker: 'TSLA',
    priceEthPerUnit: lastPrint * TREASURY.KEEPER_MIN_PRICE_FRAC * 0.99, maxEth: 1, ref: 'k:low', txHash: '0xkl' });
  assert.equal(low.bought, false, 'and so is a rate far below the floor — cheap is a signal, not a bargain');
  assert.equal(low.reason, 'price_low');
  assert.equal(await keeperRows('TSLA'), before, 'neither refusal wrote a fill');
}

// ── WALL 3: fail-closed on a STALE print — it does not earn a wider bound ───────────────────────
// The first cut of the sizing scaled the bound with the gap; it had to be thrown away because that
// is not fail-closed. This is the assertion that keeps it thrown away.
{
  const cut = new Date(Date.now() - TREASURY.KEEPER_MAX_PRICE_AGE_MS - 86400000);
  await pool.query("UPDATE stock_buys SET created_at=$1 WHERE ticker='TSLA'", [cut]);
  const stale = await runStockBuyback(pool, { ticker: 'TSLA', priceEthPerUnit: lastPrint, maxEth: 1, ref: 'k:stale', txHash: '0xks' });
  assert.equal(stale.bought, false, 'a print older than the age bound HALTS the keeper');
  assert.equal(stale.reason, 'stale_price', '…rather than widening the bound to accommodate it');
  await pool.query("UPDATE stock_buys SET created_at=now() WHERE ticker='TSLA'"); // restore
}

// ── WALL 4: the root cap, and the reason it is read rather than re-derived ──────────────────────
// ETH already promised to a player's vault line is not the keeper's. Ask for far more than exists
// and the spend CLAMPS to the budget instead of overdrawing it.
{
  const budgetBefore = (await stockBudget(pool)).spendableEth;
  assert(budgetBefore > 0, 'the fixture has something left to spend');
  const big = await runStockBuyback(pool, { ticker: 'TSLA', priceEthPerUnit: lastPrint,
    maxEth: budgetBefore * 100, ref: 'k:clamp', txHash: '0xkc' });
  assert.equal(big.bought, true, 'an over-ask still buys — it clamps rather than refusing');
  assert.equal(big.ethSpent, budgetBefore, 'and spends EXACTLY the budget, never past it');
  const after = await stockBudget(pool);
  assert.equal(after.spendableEth, 0, 'which leaves nothing spendable');
  // the units are the ETH at the achieved rate — the arithmetic the whole wall exists to protect
  assert(Math.abs(big.units - budgetBefore / lastPrint) < 1e-6, 'units == eth / price');
  // and now the budget is empty, the keeper refuses rather than spending ETH it does not have
  const broke = await runStockBuyback(pool, { ticker: 'TSLA', priceEthPerUnit: lastPrint, maxEth: 1, ref: 'k:broke', txHash: '0xkb' });
  assert.equal(broke.bought, false, 'an empty budget halts the keeper');
  assert.equal(broke.reason, 'budget');
}

// ── the invariant still holds after the keeper has run, which is the point of wall 4 ────────────
{
  const inv2 = await runTreasuryInvariants(pool);
  assert(check(inv2, 'allocated + spent <= held (ETH)').ok,
    'the keeper spending to the cap does NOT breach the spend-aware arm — that is what the cap is for');
}

// ── WALL 5: a keeper comp books ZERO, same as the ingest ─────────────────────────────────────────
// It goes through recordStockBuy, so it inherits the gate — asserted rather than assumed, because
// "it goes through X" is exactly the kind of claim that stops being true after a refactor.
{
  await mod('POST', '/v1/mod/treasury/tax', { ref: 'tax:2', omrTaxed: 50000, price: 500, txHash: '0xtax2' });
  const heldBefore = (await stockBudget(pool)).spentEth;
  const comp = await runStockBuyback(pool, { ticker: 'TSLA', priceEthPerUnit: lastPrint, maxEth: 1, ref: 'k:comp' }); // no txHash
  assert.equal(comp.bought, true, 'a comp records the episode');
  assert.equal(comp.units, 0, 'and books ZERO units — the fabricated quantity IS the wall\'s input');
  assert.equal(comp.ethSpent, 0, '…and ZERO spend');
  assert.equal((await stockBudget(pool)).spentEth, heldBefore, 'so the budget is untouched by QA');
}

// ── the route is wired, mod-gated, and drives the same walls ────────────────────────────────────
{
  const viaRoute = await mod('POST', '/v1/mod/treasury/keeper', { ticker: 'NVDA', price: 0.2, maxEth: 1, ref: 'k:route' });
  assert.equal(viaRoute.code, 200);
  assert.equal(viaRoute.body.reason, 'no_print', 'the route reaches the keeper and its walls, not a stub');
  const unauth = await app.inject({ method: 'POST', url: '/v1/mod/treasury/keeper', payload: { ticker: 'TSLA' } });
  assert.equal(unauth.statusCode, 401, 'and it is mod-gated like every other treasury route');
}

// ── THE INGEST'S PRICE WALL — the number every other wall is measured against ───────────────────
// Placed LAST because the accepted episode at the end adds to `held`, and the budget assertions
// above are exact. Wall 3 protects the SPEND side (runStockBuyback); this is the other side of the
// same trade — `grossEth = omrTaxed / price`, so a deflated price inflates `rwa_revenue` and
// therefore `held`, the figure BOTH halves of the anti-Ponzi sandwich compare `allocated` against.
// The point of the first assertion is not that the call fails; it is that WITHOUT the wall it
// SUCCEEDS and every check still reads green — measured before the wall existed: 900 taxed $OMR at
// a millionth of the last print booked 400,000 ETH of `held`, ok:true throughout.
{
  const heldBefore = (await stockBudget(pool)).heldEth;
  const deflated = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:wall', omrTaxed: 900, price: 0.001, txHash: '0xtaxwall' });
  assert.equal(deflated.body?.error, 'price_sanity',
    'a price a millionth of the last print is refused, not booked');
  assert.equal((await stockBudget(pool)).heldEth, heldBefore,
    'and it moved `held` by nothing — the refusal is before the insert');

  // the wall is symmetric: an INFLATED price under-books the gross, which quietly strands real ETH
  const inflated = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:wall2', omrTaxed: 900, price: 500 * 11, txHash: '0xtaxwall2' });
  assert.equal(inflated.body?.error, 'price_sanity', 'and a price 11x the last print is refused too');

  // ...while a price inside the band still ingests, so the wall bounds the feed rather than closing it
  const sane = await mod('POST', '/v1/mod/treasury/tax',
    { ref: 'tax:wall3', omrTaxed: 900, price: 500 * 2, txHash: '0xtaxwall3' });
  assert.equal(sane.code, 200, 'a price within the band ingests normally');
  assert.equal(sane.body.recorded, true, 'and is really booked');
  assert(sane.body.grossEth > 0, 'with a gross derived from it');
}

// ── §10.4 IS UNTOUCHED ──────────────────────────────────────────────────────────────────────────
// Treasury ETH and tokenized stock are out-of-band real value, exactly like fees.js: buying and
// allocating write ZERO `transactions` rows, so the conservation set gains no reason and no bucket.
assert.equal(await ledgerRows(), rows0,
  'the whole stock layer moved real value and wrote NOT ONE ledger row');
const led = await runLedgerInvariants(pool, { alert: false });
assert(led.checks.find((c) => /vocabulary/i.test(c.name)).ok, 'and the reason vocabulary is untouched');

await app.close();
console.log('✅ treasury test passed — `allocated <= held` is back, PER TICKER in UNITS, it can '
  + 'actually fail, a surplus in one ticker cannot cover a shortfall in another, a comp books ZERO '
  + 'units, ETH spent on stock stops backing ETH claims, and §10.4 never sees any of it. Plus THE '
  + 'BUY KEEPER (step 5): wall 4 CLAMPS a spend to the budget rather than overdrawing it and halts '
  + 'when it is empty, wall 3 refuses a rate above the ceiling AND below the floor, HALTS on a print '
  + 'older than the age bound rather than widening to accommodate it, and refuses a first buy on a '
  + 'ticker with nothing to be continuous with — every refusal driven, not assumed.');
