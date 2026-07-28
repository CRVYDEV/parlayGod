// TOKENOMICS v2 — THE EXCHANGE and THE FAMILY YIELD (the 57th suite).
// Design: omerta-tokenomics-v2-design.md
//
// What this has to prove, in order of how much it would cost to get wrong:
//   1. The window's cash side is a BOUNDED REDISTRIBUTION, not inflation. It pays only what real
//      sinks funded, and `exchange pool backed` (paid <= funded) proves it after the fact.
//   2. A dry pool burns NOTHING. The window is a claim on what was funded, never a promise — and
//      burning into an empty till would take the token and give nothing back.
//   3. §10.4 still reconciles exactly with a burn on one side and a faucet on the other.
//   4. The family yield is a TRANSFER, so the $OMR bucket sum is unmoved by a distribution.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { fundExchange, payFamilyYield, fundFamilyYield, exchangePool, familyYieldPool,
  runExchangeInvariants } from '../src/exchange.js';
import { EXCHANGE, FAMILY_YIELD } from '../src/rules.js';
import * as Rwa from '../src/rwa.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, token, payload) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
  let body = null; try { body = res.json(); } catch { /* empty */ }
  return { code: res.statusCode, body: body || {} };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', token, { name });
  const me = (await call('GET', '/v1/me', token)).body.character;
  return { token, id: me.id, acct: (await pool.query('SELECT account_id FROM characters WHERE id=$1', [me.id])).rows[0].account_id };
};
// Every SQL cash grant this file makes is un-ledgered by construction, so it shows up as aggregate
// drift. Track it here rather than hardcoding a total: a fixture added later then can't silently
// break the "no leak" claim by shifting a magic number. (SET cash=X REPLACES the $500 creation
// base, which is itself un-ledgered and already counted in the invariant's own baseline.)
let sqlCash = 0;
let sqlOmr = 0;   // same discipline for the $OMR grants (see the conservation assertions below)
const setCash = async (id, amt) => {
  await pool.query('UPDATE characters SET cash=$2 WHERE id=$1', [id, amt]);
  sqlCash += amt - 500;
};
const omrOf = async (a) => Number((await pool.query('SELECT omr FROM account_persistent WHERE account_id=$1', [a])).rows[0].omr);
const cashOf = async (c) => Number((await pool.query('SELECT cash FROM characters WHERE id=$1', [c])).rows[0].cash);
const sumOmrBuckets = async () => Number((await pool.query(
  `SELECT (SELECT COALESCE(SUM(omr+staked+unbonding),0) FROM account_persistent)
        + (SELECT COALESCE(SUM(omr_reserve),0) FROM amm_pool)
        + (SELECT COALESCE(SUM(fund),0) FROM street_tax)
        + (SELECT COALESCE(SUM(omr_reserve),0) FROM gangs)
        + (SELECT COALESCE(SUM(balance),0) FROM stake_pool)
        + (SELECT COALESCE(SUM(omr),0) FROM dev_fund)
        + (SELECT COALESCE(SUM(pool),0) FROM rwa_dividend_pool)
        + (SELECT COALESCE(SUM(pool),0) FROM rwa_family_dividend_pool)
        + (SELECT COALESCE(SUM(balance),0) FROM family_yield_pool) AS s`)).rows[0].s);

// ── THE INTERLOCK ────────────────────────────────────────────────────────────────────────────────
// The design's claim that arbitrage is impossible "by construction" is only true once cash → $OMR
// is severed. While the AMM buy side is live and spot sits under RATE, buy-then-redeem is a money
// pump. So this asserts the two are NEVER both open — and it is written to catch the mistake from
// either direction: whoever opens the window must have retired the buy side in the same change,
// and whoever re-enables the buy side must shut the window.
{
  const t = await mk('Interlock Probe');
  await setCash(t.id, 50000);
  const buy = await call('POST', '/v1/swap', t.token, { direction: 'buy', amount: 1000 });
  const buySideLive = buy.code === 200;

  // The invariant itself, asserted unconditionally so it cannot pass by taking neither branch.
  // (It did exactly that when step 2 landed: the buy started throwing, `buySideLive` went false,
  // and the whole block below was skipped while the file still reported a pass. A check that can
  // only fire in a world that no longer exists is indistinguishable from a check that works.)
  assert.ok(!(buySideLive && EXCHANGE.OPEN),
    'cash buys $OMR AND the redemption window is open — that is a money pump: buy under RATE, redeem '
    + 'at RATE, repeat. Retire the swap buy direction (design §2) in the same change that sets OPEN.');

  if (buySideLive) {
    // the pre-step-2 world: the window must be shut, and must say so plainly
    const shut = await call('POST', '/v1/window/redeem', t.token, { amount: 1 });
    assert.equal(shut.body.error, 'closed', 'and the window says so plainly');
  } else {
    // step 2 has landed. Assert what actually replaced it, so this side has teeth too.
    assert.equal(buy.body.error, 'retired', 'cash → $OMR is retired, not merely failing for some other reason');
    // BOTH directions. A sell-only constant-product AMM drains its cash reserve monotonically until
    // the price collapses (design §2) — leaving it would be the degenerate case, not a half-measure.
    const sell = await call('POST', '/v1/swap', t.token, { direction: 'sell', amount: 1 });
    assert.equal(sell.body.error, 'retired', 'the sell side went with it — a one-way AMM is a draining bucket, not a market');
    // and the PRIVATE rail. Retiring only the public wash house would leave the same money pump
    // open through a business front, which is the whole reason the design lists both.
    const wash = await call('POST', '/v1/business/any/launder', t.token, { amount: 1000 });
    assert.equal(wash.body.error, 'retired', 'laundering at your own front went with it — otherwise the pump just moves indoors');
    assert.equal(EXCHANGE.OPEN, true, 'and the window that replaces them is open');
  }
}

// ── THE EXCHANGE ─────────────────────────────────────────────────────────────────────────────────
// Everything below exercises the window as it will behave once step 2 lands, via the test override.
process.env.EXCHANGE_OPEN = 'on';
const a = await mk('Window Walker');
await pool.query('UPDATE account_persistent SET omr=100 WHERE account_id=$1', [a.acct]); sqlOmr += 100;

{ // the board is honest about the direction, before anything is funded
  const b = (await call('GET', '/v1/window', a.token)).body;
  assert.equal(b.rate, EXCHANGE.RATE, 'the published rate is the lever');
  assert.equal(b.pool, 0, 'an unfunded window holds nothing');
  assert.match(b.note, /never becomes/i, 'the board says out loud that cash never becomes $OMR');
}

{ // A DRY POOL BURNS NOTHING. This is the load-bearing one: the window is a claim on what was
  // funded, and burning into an empty till would be taking the token for nothing.
  const before = await omrOf(a.acct);
  const r = await call('POST', '/v1/window/redeem', a.token, { amount: 10 });
  assert.equal(r.code, 400, 'a dry window refuses');
  assert.equal(r.body.error, 'dry');
  assert.equal(await omrOf(a.acct), before, 'and NOTHING was burned — not one token');
  // Assert the LEDGER too, not just the balance. Under pg-mem ROLLBACK is a no-op (see the
  // withCharacterRead note / SPEC D1), so a burn written before this gate leaves its row behind
  // even though the balance appears untouched — the balance alone would pass for the wrong reason.
  assert.equal(Number((await pool.query(
    "SELECT COUNT(*) n FROM transactions WHERE reason='window:burn'")).rows[0].n), 0,
  'and no burn was even written — the gate comes BEFORE the burn, not after it');
}

// fund it the only way it can be funded: out of the street-tax pool, which real sinks feed
await pool.query('UPDATE street_tax SET pool = pool + 1000000 WHERE id=1');
const taxPool = Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const funded = await fundExchange(pool);
assert.equal(funded.funded, Math.floor(taxPool * EXCHANGE.FUND_BPS / 10000),
  'the window takes its slice of the take — and only its slice');
assert.equal(Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool),
  taxPool - funded.funded, 'which came OUT of the street tax — the pool is fed, never created');

{ // the round trip: $OMR leaves supply, cash arrives, both ledgered, the pool pays for it
  const omrBefore = await omrOf(a.acct), cashBefore = await cashOf(a.id), poolBefore = (await exchangePool(pool)).balance;
  const r = await call('POST', '/v1/window/redeem', a.token, { amount: 10 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const paid = 10 * EXCHANGE.RATE;
  assert.equal(r.body.cash, paid);
  assert.equal(await omrOf(a.acct), omrBefore - 10, 'the $OMR is gone');
  assert.equal(await cashOf(a.id), cashBefore + paid, 'the cash arrived');
  assert.equal((await exchangePool(pool)).balance, poolBefore - paid, 'and the POOL paid for it — not thin air');

  const burn = Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='window:burn'")).rows[0].s);
  const payout = Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='window:payout'")).rows[0].s);
  assert.equal(burn, -10, 'the burn is ledgered');
  assert.equal(payout, paid, 'the faucet is ledgered');
}

{ // the per-account rolling cap — a whale cannot drain the till in one sitting
  const r = await call('POST', '/v1/window/redeem', a.token, { amount: EXCHANGE.DAILY_CAP_OMR });
  assert.equal(r.code, 400); assert.equal(r.body.error, 'cap', 'the daily cap holds');
  const b = (await call('GET', '/v1/window', a.token)).body;
  assert.equal(b.yourHeadroomOmr, EXCHANGE.DAILY_CAP_OMR - 10, 'and the board shows what is left of it');
}

{ // the floor
  const r = await call('POST', '/v1/window/redeem', a.token, { amount: 0 });
  assert.equal(r.body.error, 'amount', 'no dust redemptions');
}

{ // THE REAL-VALUE INVARIANT: the window can never have paid out more than was funded into it.
  const inv = await runExchangeInvariants(pool);
  assert.ok(inv.ok, JSON.stringify(inv.checks));
  const backed = inv.checks.find((c) => c.name === 'exchange pool backed');
  assert.ok(backed.lhs <= backed.rhs, 'paid <= funded — the window is a redistribution, not a faucet');
}

// ── THE FAMILY YIELD ─────────────────────────────────────────────────────────────────────────────
const boss = await mk('Yield Boss');
await pool.query('UPDATE characters SET respect=200000 WHERE id=$1', [boss.id]);
await setCash(boss.id, 9000000);
const gid = (await call('POST', '/v1/gangs', boss.token,
  { name: 'The Yield Family', tag: 'YLD' })).body.gangId;
assert.ok(gid, 'a family to pay');
await pool.query('UPDATE gangs SET season_tribute=5000000 WHERE id=$1', [gid]);

{ // funding the pot moves nothing between players — it is a bucket, and it is INSIDE the $OMR sum
  const bucketsBefore = await sumOmrBuckets();
  const client = await pool.connect();
  try { await client.query('BEGIN'); await fundFamilyYield(client, 100); await client.query('COMMIT'); }
  finally { client.release(); }
  sqlOmr += 100;
  assert.equal(await sumOmrBuckets(), bucketsBefore + 100, 'the pot is inside the bucket sum');
  assert.equal((await familyYieldPool(pool)).balance, 100);

  // (red-team F4) The check above uses this file's OWN bucket sum, which proves nothing about the
  // PRODUCTION one — and the §10.4 assertion at the bottom runs after distribution, when the $OMR
  // has already moved to gangs (also counted), so it cannot tell a counted pot from an uncounted
  // one either. Mutation-verified: dropping family_yield_pool from invariants.js left the whole
  // file GREEN. So assert conservation HERE, with the $OMR sitting in the pot and nowhere else —
  // this is the only moment the pot's membership is observable.
  const midInv = await runLedgerInvariants(pool, { alert: false });
  const midOmr = midInv.checks.find((c) => c.name === '$OMR conservation');
  assert.ok(Math.abs(midOmr.drift - sqlOmr) < 0.01,
    `with 100 $OMR parked in the pot, the REAL conservation check must still see it — if this reads `
    + `${sqlOmr - 100} the pot is missing from omrBuckets and every funded pot looks like a burn: ${midOmr.drift}`);
}

{ // the distribution is a TRANSFER: the family gains exactly what the pot loses, and the total is unmoved
  const bucketsBefore = await sumOmrBuckets();
  const reserveBefore = Number((await pool.query('SELECT omr_reserve FROM gangs WHERE id=$1', [gid])).rows[0].omr_reserve);
  const out = await payFamilyYield(pool);
  assert.ok(out.paid > 0, 'the top family drew the yield');
  assert.equal(out.families[0].rank, 1);
  const reserveAfter = Number((await pool.query('SELECT omr_reserve FROM gangs WHERE id=$1', [gid])).rows[0].omr_reserve);
  assert.ok(reserveAfter > reserveBefore, "it landed in the family's reserve");
  assert.equal(Math.round(await sumOmrBuckets()), Math.round(bucketsBefore),
    'and the $OMR bucket sum did NOT move — a distribution is a transfer, never a mint');

  const led = Number((await pool.query(
    "SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='yield:family'")).rows[0].s);
  assert.equal(Math.round(led * 100), Math.round(out.paid * 100), 'ledgered exactly');
}

{ // (red-team F2/F7) A pot whose per-share rounding sums to MORE than it holds. 0.23 across the
  // 5-4-3-2-1 weights rounds to 0.24 — measured at 53 of the first 400 cent-values — which drove the
  // pool NEGATIVE. `family yield backed` could not see it: its 0.01 tolerance is exactly the size of
  // the overpay, so it read ok. The balance identity is the check that actually catches it.
  // FIVE seats are required to reproduce it: with one family the single share is the whole pot and
  // nothing rounds. (The first cut of this regression seeded one gang, so it passed under the
  // mutation — a vacuous check that read exactly like a clean bill of health.)
  await pool.query(`INSERT INTO gangs (id,name,tag,season_tribute) VALUES
    ('fy2','Seat Two','FY2',400),('fy3','Seat Three','FY3',300),
    ('fy4','Seat Four','FY4',200),('fy5','Seat Five','FY5',100)`);
  await pool.query('UPDATE family_yield_pool SET balance=0.23, lifetime_funded = lifetime_funded + 0.23');
  sqlOmr += 0.23;
  const out = await payFamilyYield(pool);
  const potNow = (await familyYieldPool(pool)).balance;
  assert.ok(out.paid <= 0.23 + 1e-9, `never pay out more than the pot holds: paid ${out.paid} of 0.23`);
  assert.ok(potNow >= -1e-9, `and the pot can never go negative: ${potNow}`);
  const inv = await runExchangeInvariants(pool);
  const bal = inv.checks.find((c) => c.name === 'family yield balance');
  assert.ok(bal && bal.ok, `the balance identity must hold: ${JSON.stringify(bal)}`);
}

{ // the public board names who is drawing it and what their share is
  const b = (await call('GET', '/v1/yield', null)).body;
  assert.equal(b.seats, FAMILY_YIELD.SEATS);
  assert.ok(b.families.length >= 1);
  assert.ok(b.families[0].shareBps > 0, 'the top seat draws the biggest share');
}

// ── THE LEGACY POOL MERGE (red-team A1) ──────────────────────────────────────────────────────────
// `stake_pool` and `rwa_dividend_pool` paid individual yield. Both payouts retired in step 2, and
// with them went the ONLY things that drained those pools — so whatever they still hold has exactly
// one way out: this merge. It used to run inside `runBuyback`, which returns early unless the CASH
// pool is non-empty and the 12h timer is due, so a $OMR migration was gated on an unrelated cash
// condition. On a server whose take is quiet that migration never happens and real, player-earned
// $OMR sits stranded — and NOTHING alarms, because both pools are inside `omrBuckets` and
// conservation stays exact the whole time it is unreachable.
{
  const { mergeLegacyPools, runBuyback } = await import('../src/worker.js');
  await pool.query('UPDATE stake_pool SET balance=40 WHERE id=1');
  await pool.query('UPDATE rwa_dividend_pool SET pool=10 WHERE id=1');
  sqlOmr += 50;
  const potBefore = (await familyYieldPool(pool)).balance;

  // the condition that used to hide it: an empty cash pool. The buyback correctly does nothing…
  await pool.query('UPDATE street_tax SET pool=0 WHERE id=1');
  assert.equal(await runBuyback(pool, { force: true }), null, 'no take, no buyback — that part is right');

  // …but the $OMR must still find its way home, because nothing else can move it.
  const m = await mergeLegacyPools(pool);
  assert.equal(m?.merged ?? 0, 50,
    'both legacy pools must drain regardless of what the CASH pool is doing — a $OMR migration '
    + 'gated on the street take being non-empty simply never runs on a quiet server, and nothing '
    + 'alarms because the stranded $OMR is still inside omrBuckets');
  assert.equal(Number((await pool.query('SELECT balance FROM stake_pool WHERE id=1')).rows[0].balance), 0);
  assert.equal(Number((await pool.query('SELECT pool FROM rwa_dividend_pool WHERE id=1')).rows[0].pool), 0);
  assert.equal((await familyYieldPool(pool)).balance, potBefore + 50, 'and lands in the family pot');

  // a DRAIN, so a second run is a no-op — which is what makes running it every tick safe
  assert.equal(await mergeLegacyPools(pool), null, 'draining an empty pool moves nothing');
  const inv = await runExchangeInvariants(pool);
  assert.ok(inv.checks.find((c) => c.name === 'family yield balance').ok,
    'the pot identity survives the merge — it is a transfer, not a mint');
}

// ── STEP 3: THE FLOAT, RE-SOURCED ────────────────────────────────────────────────────────────────
// The design's §6 gap, in one sentence: the DEX tax scales with TRADING VOLUME, and a one-way
// conversion is designed to produce a quiet market — so a tax-only float grows fastest exactly when
// it is needed least. Bond ETH is primary inflow and does not care whether anyone is trading.
//
// What must not go wrong, in order of cost:
//   1. A comp/QA episode must fund NOTHING. Fabricated backing is how "the game only ever owes stock
//      it already owns" becomes a lie the anti-Ponzi check cannot see, because the check compares
//      allocation to HELD units and fake revenue buys real-looking units.
//   2. The slices must reconcile to the gross. A split that loses or invents ETH means the float is
//      funded by something other than what the tax actually took.
//   3. The whole thing writes ZERO §10.4 rows — it is out-of-band real value, like the Vig and bonds.
{
  const before = Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n);
  const mod = { 'x-mod-key': 'test-mod-key' };
  const modCall = async (url, payload) => {
    const res = await app.inject({ method: 'POST', url, headers: mod, payload });
    return { code: res.statusCode, body: res.json() };
  };

  // (1) a REAL tax episode: 900 OMR taken at 5000 OMR/ETH = 0.18 ETH gross, split 200/400/300 of 900
  process.env.ALLOW_MOD_REAL_REVENUE = 'on'; // the QA escape hatch; production strips caller txHashes
  const tax = await modCall('/v1/mod/rwa/tax', { ref: '0xsell01:3', omrTaxed: 900, price: 5000, txHash: '0xsell01' });
  assert.equal(tax.code, 200);
  assert.equal(tax.body.grossEth, 0.18, '900 OMR at 5000/ETH is 0.18 ETH of tax');
  assert.equal(tax.body.devEth, 0.04, '2 of the 9 points → founder');
  assert.equal(tax.body.rwaEth, 0.08, '4 of the 9 points → the stock float');
  assert.equal(tax.body.lpEth, 0.06, '3 of the 9 points → LP depth');
  assert.equal(tax.body.devEth + tax.body.rwaEth + tax.body.lpEth, tax.body.grossEth,
    'and the three slices sum to the gross exactly');

  // …and a gross that does NOT divide cleanly, which is what the remainder rule is FOR. 0.18 above
  // splits into exact sixth-decimals, so it proves nothing about dust; 0.1 does not (200/900 and
  // 400/900 of it both round DOWN, and three natural slices would sum to 0.099999 — a wei of ETH
  // that belongs to nobody). Every real trade is this case, not the tidy one.
  const dusty = await modCall('/v1/mod/rwa/tax', { ref: '0xsell02:0', omrTaxed: 500, price: 5000, txHash: '0xsell02' });
  assert.equal(dusty.body.grossEth, 0.1);
  assert.equal(dusty.body.devEth + dusty.body.rwaEth + dusty.body.lpEth, 0.1,
    'the remainder rule absorbs the rounding into the LP slice so nothing is lost or invented');

  // (2) a re-delivered log is a clean no-op, not a second helping of revenue
  const dup = await modCall('/v1/mod/rwa/tax', { ref: '0xsell01:3', omrTaxed: 900, price: 5000, txHash: '0xsell01' });
  assert.equal(dup.body.duplicate, true, 'a re-delivered SellTaxTaken log books nothing twice');

  // (3) THE ANTI-FABRICATION GATE: a comp with no real tx books the episode but ZERO revenue
  const comp = await modCall('/v1/mod/rwa/tax', { ref: 'qa-episode-1', omrTaxed: 5000, price: 5000 });
  assert.equal(comp.body.rwaEth, 0, 'a simulate funds the float with NOTHING');
  assert.equal((await pool.query("SELECT 1 FROM rwa_revenue WHERE ref='qa-episode-1'")).rows.length, 0,
    'and leaves no revenue row at all — a comp can never back stock the treasury did not buy');

  // (4) a REAL bond's float slice (the second source) lands alongside the tax's
  const bond = await modCall('/v1/mod/bond/fund', { omr: 100000 });
  assert.equal(bond.code, 200);
  const b = await modCall('/v1/mod/bond/simulate',
    { nonce: 901, principalEth: 4, price: 5000, discountBps: 800, txHash: '0xbondfloat01' });
  assert.equal(b.body.rwaEth, 1, '25% of a 4-ETH bond → the float');
  delete process.env.ALLOW_MOD_REAL_REVENUE;

  // (5) BOTH sources are now spendable by the buy bot, and the anti-Ponzi wall still holds
  const inv0 = await Rwa.runRwaInvariants(pool);
  assert.equal(inv0.revenueBySource.tax, 0.124444, 'the float knows the tax funded 0.124444 ETH of it (0.08 + the dusty episode)');
  assert.equal(inv0.revenueBySource.bond, 1, '…and bonds funded 1 ETH');
  assert.ok(inv0.checks.find((c) => c.name === 'sell-tax split == gross').ok);
  assert.ok(inv0.checks.find((c) => c.name === 'sell-tax RWA slice == rwa_revenue').ok);
  const buy = await modCall('/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 1.124444, priceEth: 0.01 });
  assert.equal(buy.code, 200, 'the bot can spend exactly what the two sources brought in');
  assert.equal(buy.body.budgetLeft, 0);
  const over = await modCall('/v1/mod/rwa/buy', { ticker: 'AAPL', eth: 0.01, priceEth: 0.01 });
  assert.equal(over.body.error, 'over_budget', 'and not a wei more');
  const inv1 = await Rwa.runRwaInvariants(pool);
  assert.ok(inv1.ok, `the float invariant holds with both sources live: ${JSON.stringify(inv1.checks.filter((c) => !c.ok))}`);
  assert.ok(inv1.checks.find((c) => c.name === 'allocated <= held (AAPL)').ok,
    'THE anti-Ponzi wall: never promise a unit that is not already bought and sitting in the reserve');

  // (6) the board publishes what backs the float — "backed" is a claim, and a player may audit it
  const vb = (await call('GET', '/v1/vault', a.token)).body;
  assert.equal(vb.funding.bySource.tax, 0.124444);
  assert.equal(vb.funding.bySource.bond, 1);
  assert.equal(vb.funding.unspentEth, 0, 'and how much of it the bot has yet to deploy');

  // (7) ZERO §10.4 rows — the whole re-sourcing is out-of-band real value
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM transactions')).rows[0].n), before,
    're-sourcing the float writes no ledger rows at all — it moves real ETH, not game currency');
}

// ── §10.4 ────────────────────────────────────────────────────────────────────────────────────────
{
  const inv = await runLedgerInvariants(pool, { alert: false });
  const vocab = inv.checks.find((c) => c.name === 'reason vocabulary');
  assert.ok(vocab.ok, `unknown reason(s): ${JSON.stringify(vocab.extra)}`);
  // The aggregate cash check carries the $9M this file SQL-granted the boss so he can found a
  // family, so it cannot be `ok` here. The sharper claim is the one that matters: the WINDOW
  // PLAYER's own cash reconciles to the penny against his ledger rows, which is exactly what a
  // faucet paying more than it ledgered would break.
  const walkerLedger = Number((await pool.query(
    'SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id=$1 AND currency=$2',
    [a.id, 'cash'])).rows[0].s);
  assert.equal(await cashOf(a.id), 500 + walkerLedger,
    "the window's cash faucet reconciles exactly against its ledger row — it paid what it wrote");
  const cash = inv.checks.find((c) => c.name === 'character cash');
  assert.ok(Math.abs(cash.drift - sqlCash) < 0.01,
    `aggregate cash drift should be exactly this file's own SQL grants ($${sqlCash}), not a leak: ${cash.drift}`);
  // $OMR conservation carries the two SQL grants this file made (100 to the walker, 100 into the
  // pot) and NOTHING else. 200 is load-bearing rather than arbitrary: the 10 burned at the window
  // leaves the buckets AND enters the burn term, so it cancels. If `window:burn` were missing from
  // `omrBurns` this would read 190 — i.e. the exact number proves the burn is accounted, and the
  // family-yield transfer proves it moved no supply.
  const omr = inv.checks.find((c) => c.name === '$OMR conservation');
  assert.ok(Math.abs(omr.drift - sqlOmr) < 0.01,
    `drift should be exactly this file's own $OMR grants ($${sqlOmr}) — the burn cancels and the `
    + `transfer moves nothing: ${omr.drift}`);
}

await app.close();
console.log('✅ tokenomics v2 test passed — THE EXCHANGE burns $OMR for cash out of a pool that only '
  + 'real sinks fund (a dry till burns NOTHING, the daily cap holds, and `exchange pool backed` proves '
  + 'paid <= funded, so the cash side is a bounded redistribution rather than inflation), and THE '
  + 'FAMILY YIELD moves the pot into the top family\'s reserve as a pure transfer that leaves the '
  + '$OMR bucket sum exactly where it was.');
