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
await mod('POST', '/v1/mod/treasury/tax',
  { ref: 'tax:1', omrTaxed: 100000, price: 500, txHash: '0xtax' });

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
  { ref: 'buy:1', ticker: 'TSLA', units: 10, ethSpent: 2, txHash: '0xfill1' });
assert.equal(r.body.real, true);
assert.equal(r.body.units, 10, 'a real fill books its units');
r = await mod('POST', '/v1/mod/treasury/buy', { ref: 'buy:1', ticker: 'TSLA', units: 10, ethSpent: 2, txHash: '0xfill1' });
assert.equal(r.body.duplicate, true, 'a re-delivered fill is a clean no-op, not a second holding');

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
  { ref: 'buy:2', ticker: 'AMZN', units: 50, ethSpent: 1, txHash: '0xfill2' });
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
  + 'units, ETH spent on stock stops backing ETH claims, and §10.4 never sees any of it.');
