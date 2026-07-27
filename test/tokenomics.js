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
  if (buySideLive) {
    assert.equal(EXCHANGE.OPEN, false,
      'cash still buys $OMR, so the redemption window MUST be shut — otherwise buy-low/redeem-at-RATE '
      + 'is a money pump. Retire the swap buy direction (design §2) in the same change that sets OPEN.');
    const shut = await call('POST', '/v1/window/redeem', t.token, { amount: 1 });
    assert.equal(shut.body.error, 'closed', 'and the window says so plainly');
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
