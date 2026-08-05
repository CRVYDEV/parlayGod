// THE PORTFOLIO — RETIRED (D11, founder-directed 2026-08-05) — this suite is the emission.js-style
// rewrite: it no longer proves the stock book pays correctly, it proves it CANNOT pay at all, in
// every way it could come back — the routes (tombstones, not 404s), the ledger (nothing writes a new
// rwa:invest/dividend row, asserted by the 'portfolio retired' freshness check), and history (a
// PRE-retirement row still reconciles §10.4, because conservation is a claim about the whole ledger).
// THE ETH VAULT (src/treasury.js) STAYS — its block below is kept whole, with the one leg that used
// the retired paper-invest route re-proved through the vault's own till (the SHARED RICO window).
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { buildServer } from '../src/server.js';
import { PORTFOLIO } from '../src/rules.js';
import * as Treasury from '../src/treasury.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { mergeLegacyYieldPools } from '../src/exchange.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url,
    headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const acctOmr = (id, n) => pool.query(
  `UPDATE account_persistent SET omr = omr + ${n} WHERE account_id = (SELECT account_id FROM characters WHERE id='${id}')`);

let grantDrift = 0; // running tally of every unledgered SQL $OMR grant (the only legit drift)

const boss = await mk('Legit Larry');

// ── 1. EVERY ROUTE IS A TOMBSTONE (the /v1/wage precedent: a polling client learns what happened) ──
for (const [method, url, body] of [
  ['GET', '/v1/portfolio'],
  ['POST', '/v1/portfolio/invest', { ticker: 'AAPL', omr: 100 }],
  ['POST', '/v1/gangs/portfolio/invest', { ticker: 'AAPL', omr: 100 }],
  ['POST', '/v1/portfolio/dividend'],
  ['POST', '/v1/gangs/portfolio/dividend'],
  ['POST', '/v1/dynasty/name', { name: 'The Medici' }],
  ['POST', '/v1/gangs/portfolio/name', { name: 'The Fund' }],
  ['GET', '/v1/leaderboard/portfolio'],
  ['GET', '/v1/leaderboard/family-portfolio'],
]) {
  const r = await call(method, url, { token: boss.token, body });
  assert.equal(r.body.error, 'retired', `${method} ${url} is a tombstone, not a live till (${r.code}: ${JSON.stringify(r.body).slice(0, 80)})`);
}

// …and the module's payers cannot pay even if called directly — the exports throw, they are not
// dormant code an env flag could re-arm (the emission.js "DELETED, not dormant" posture, adapted:
// tombstoned, and the tombstone is the WHOLE function body).
const P = await import('../src/portfolio.js');
for (const fn of ['invest', 'familyInvest', 'claimFamilyDividend', 'nameDynasty', 'nameFamilyDynasty', 'grantShares'])
  if (fn === 'grantShares') assert.equal(P[fn], undefined, 'grantShares (the free-share payer) is DELETED, not left dormant — a payer that still exists is one import from a live faucet');
  else await assert.rejects(P[fn](), (e) => e.code === 'retired', `${fn}() throws retired even called directly`);

// ── 2. THE PUBLIC CLAIMS: /v1/rules says the book is gone; the view no longer carries one ──
const rules = (await call('GET', '/v1/rules')).body;
assert.equal(rules.portfolio, null, '/v1/rules makes the positive claim (the emission {faucet: null} precedent)');
const me = await meOf(boss.token);
assert.equal(me.portfolio, undefined, 'the character view no longer carries a book field');

// ── 3. HISTORY STILL RECONCILES; A FRESH ROW TRIPS THE ALARM ──
// A live database holds real pre-retirement rows. Simulate one: a 2-day-old rwa:invest burn paired
// with its account debit — conservation must hold WITHOUT any special-casing, because the reason
// stayed in the vocabulary and the burn term (the §10.4 half of the emission.js lesson).
await acctOmr(boss.id, 100); grantDrift += 100;
await pool.query(
  `UPDATE account_persistent SET omr = omr - 60 WHERE account_id = (SELECT account_id FROM characters WHERE id='${boss.id}')`);
await pool.query(
  "INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ($1, (SELECT account_id FROM characters WHERE id=$2), 'omr', -60, 'rwa:invest', now() - interval '2 days')",
  [crypto.randomUUID(), boss.id]);
let inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.find((c) => c.name === 'reason vocabulary').ok, 'a historical rwa:invest row is still vocabulary-legal');
assert.equal(inv.checks.find((c) => c.name === '$OMR conservation').drift, grantDrift,
  'a historical burn row still reconciles — the reason stayed in the burn term (drop it and every server that ever ran the Portfolio drifts)');
assert(inv.checks.find((c) => c.name === 'portfolio retired').ok, 'a 2-day-old row does not trip the freshness alarm');
// now a FRESH one — the alarm this retirement installed. (pg-mem: written + deleted around the check.)
const freshId = crypto.randomUUID();
await pool.query(
  "INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ($1, (SELECT account_id FROM characters WHERE id=$2), 'omr', -5, 'dividend:fund', now())",
  [freshId, boss.id]);
inv = await runLedgerInvariants(pool, { alert: false });
assert.equal(inv.checks.find((c) => c.name === 'portfolio retired').ok, false,
  'a FRESH portfolio-reason row trips the alarm — the retirement is checkable, not promised');
await pool.query('DELETE FROM transactions WHERE id=$1', [freshId]);
// …and the VAULT's live burn must NEVER trip it (exact reasons, not rwa:%): planted fresh, checked, removed
const vaultRowId = crypto.randomUUID();
await pool.query(
  "INSERT INTO transactions (id, account_id, currency, amount, reason, at) VALUES ($1, (SELECT account_id FROM characters WHERE id=$2), 'omr', -5, 'rwa:vault', now())",
  [vaultRowId, boss.id]);
inv = await runLedgerInvariants(pool, { alert: false });
assert(inv.checks.find((c) => c.name === 'portfolio retired').ok,
  "a fresh rwa:vault burn does NOT trip it — the vault is live and the check matches exact reasons, never 'rwa:%'");
await pool.query('DELETE FROM transactions WHERE id=$1', [vaultRowId]);
await pool.query('DELETE FROM transactions WHERE id=$1 OR (reason=$2 AND amount=-60)', [freshId, 'rwa:invest']); // tidy the history probe
await pool.query(
  `UPDATE account_persistent SET omr = omr + 60 WHERE account_id = (SELECT account_id FROM characters WHERE id='${boss.id}')`);

// ── 4. THE STRANDED FAMILY POOL DRAINS (the A1 class: money behind a retired claim route) ──
await pool.query('UPDATE rwa_family_dividend_pool SET pool = 37.5 WHERE id=1'); grantDrift += 37.5;
const fyBefore = Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance);
{
  const c = await pool.connect();
  try { await c.query('BEGIN'); await mergeLegacyYieldPools(c); await c.query('COMMIT'); }
  finally { c.release(); }
}
assert.equal(Number((await pool.query('SELECT pool FROM rwa_family_dividend_pool WHERE id=1')).rows[0].pool), 0,
  'the stranded family dividend pool drained — nothing sits behind a tombstone');
assert.equal(Number((await pool.query('SELECT balance FROM family_yield_pool WHERE id=1')).rows[0].balance),
  Math.round((fyBefore + 37.5) * 1e6) / 1e6, '…into the family yield (a bucket-to-bucket transfer, §10.4-neutral)');

// ═══ THE VAULT — BACKED WITH ETH (omerta-stock-layer-retirement.md) — KEPT, it is not a ticker ═══
// The founder retired the STOCK layer on 2026-07-31 and kept the vault, backed with ETH. What that
// buys is not a smaller wall but a stronger one: `allocated <= held` protects a claim only while both
// sides are the SAME asset, so ETH-for-ETH restores the float's original property exactly and there is
// no second asset whose price can put the treasury short. Proved here: the anti-Ponzi wall holds at
// the margin, the claim is a ledgered rwa:vault burn, the daily bucket bounds a sweep, the clamp never
// overcharges, and the RICO graduation window survives the Portfolio's retirement (D11) — it is the
// VAULT's window now, shared across nothing, and still structuring-proof against its own till.
{
  // no revenue → nothing to claim (the wall at zero: the treasury cannot owe what it does not hold)
  const early = await mk('Vault Vinny');
  await acctOmr(early.id, 3000); grantDrift += 3000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${early.id}')`);
  let r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'vault_dry', 'an empty treasury has nothing to allocate');
  // 1.0 ETH of real revenue lands (out-of-band real-value accounting — the vig/bond test precedent)
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('store','vault-test-1',1.0)");
  // …and it STILL refuses, because no ETH price has printed. This is the guard that matters most now
  // that the vault owes real ETH: with no oracle the old code fell back to a FIXED floor, which turns
  // "we don't know what ETH costs" into "sell it at the default" — a standing free option on the
  // treasury. Fail-closed, no fallback.
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'no_price', 'a funded vault with no ETH price REFUSES rather than guessing one');
  let vb = (await call('GET', '/v1/vault', { token: early.token })).body;
  assert.equal(vb.open, false, 'and the board says closed rather than advertising a price the claim would refuse');
  // a buyback prints the OMR/ETH oracle (mainnet: the DEX TWAP)
  await pool.query("INSERT INTO vig_buyback (id, eth_spent, omr_bought, price_omr_per_eth, to_reserve, to_prize) VALUES ('bb-vault', 1, 5000, 5000, 0, 0)");
  // …and a STALE print is refused too — the same hole with a timestamp on it
  await pool.query("UPDATE vig_buyback SET created_at = now() - interval '5 days' WHERE id='bb-vault'");
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'stale_price', 'a stale ETH price is refused, not used');
  await pool.query("UPDATE vig_buyback SET created_at = now() WHERE id='bb-vault'");
  vb = (await call('GET', '/v1/vault', { token: early.token })).body;
  assert.equal(vb.heldEth, 1, 'the board shows what the treasury holds');
  assert.equal(vb.availableEth, 1, 'nothing allocated yet');
  assert.equal(vb.spotOmrPerEth, 5000, 'spot is the oracle print');
  assert.equal(vb.omrPerEth, 5250, 'a claim pays spot + the 5% premium — the vault is not a market maker');
  assert.equal(vb.open, true, 'and now it is open');
  // MINTED-ONLY: a claiming identity pays the mint fee first, so the per-account cap is a real bound
  const free = await mk('Free Freddie');
  await acctOmr(free.id, 500); grantDrift += 500;
  r = await call('POST', '/v1/vault/claim', { token: free.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'mint', 'a free-trial character cannot claim from the vault');
  // the claim: burn $OMR at the oracle → allocated ETH
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 525 } });
  assert.equal(r.code, 200, `claimed: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.eth, 0.1, '525 $OMR at 5250/ETH (spot + premium) = 0.1 ETH');
  assert.equal(Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='rwa:vault'")).rows[0].s),
    -525, 'the claim is a ledgered rwa:vault burn — $OMR is the rationing ticket, the ETH was already paid for');
  // the rolling-24h per-account cap (anti-sweep)
  r = await call('POST', '/v1/vault/claim', { token: early.token, body: { omr: 1600 } });
  assert.equal(r.body.error, 'daily_cap', 'the daily bucket refuses a sweep (525 + 1600 > 2000)');
  // THE WALL, at the margin: a second house claims and the vault clamps to what is left rather than
  // promising ETH the treasury does not hold. 0.9 ETH remain = 4500 $OMR worth; ask for more.
  const whale = await mk('Clamp Carl');
  await acctOmr(whale.id, 3000); grantDrift += 3000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${whale.id}')`);
  await pool.query("UPDATE rwa_revenue SET rwa_eth=0.12 WHERE ref='vault-test-1'"); // held 0.12, 0.1 already owed
  r = await call('POST', '/v1/vault/claim', { token: whale.token, body: { omr: 2000 } });
  assert.equal(r.code, 200, 'the clamped claim lands');
  assert.equal(r.body.clamped, true, 'the treasury ran short of the ask');
  assert.equal(r.body.eth, 0.02, 'clamped to the 0.02 ETH that was unallocated');
  assert.equal(r.body.spent, 105, 'and charged only for what was got (never an IOU, never overpaid)');
  r = await call('POST', '/v1/vault/claim', { token: whale.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'vault_dry', 'a fully-allocated vault refuses cleanly');
  // THE ANTI-PONZI CHECK, in ETH on both sides
  const ti = await Treasury.runTreasuryInvariants(pool);
  const wall = ti.checks.find((c) => c.name === 'allocated <= held (ETH)');
  assert(wall && wall.ok, 'allocated <= held holds');
  assert.equal(wall.lhs, 0.12, 'and it is watching the real allocation');
  assert.equal(wall.rhs, 0.12, 'against the real holding');
  // the RICO graduation window SURVIVES the Portfolio (D11): it was always the shared rwa_used
  // bucket, and the vault still charges it. Structuring against the vault's OWN till: a sub-threshold
  // claim flies from a safehouse, the one that crosses the window is blocked.
  const launderer = await mk('Sly Sal');
  await acctOmr(launderer.id, 2000); grantDrift += 2000;
  await pool.query(`UPDATE account_persistent SET minted=true WHERE account_id=(SELECT account_id FROM characters WHERE id='${launderer.id}')`);
  await pool.query(`UPDATE characters SET safe_until = now() + interval '1 hour' WHERE id='${launderer.id}'`);
  await pool.query("INSERT INTO rwa_revenue (source, ref, rwa_eth) VALUES ('bond','vault-test-2',1.0)");
  r = await call('POST', '/v1/vault/claim', { token: launderer.token, body: { omr: 990 } });
  assert.equal(r.code, 200, 'a sub-threshold vault claim flies from a safehouse');
  r = await call('POST', '/v1/vault/claim', { token: launderer.token, body: { omr: 50 } });
  assert.equal(r.body.error, 'safe',
    'the claim that crosses the rolling window is blocked from a safehouse (structuring-proof against the vault itself)');
  console.log('✓ THE VAULT — backed with ETH: allocated <= held on both sides, the ledgered burn, the daily cap, the honest clamp, the RICO window survives D11');
}

// ── §10.4 CLOSE: the whole retirement pass moved nothing it did not say it moved ──
const inv2 = await runLedgerInvariants(pool, { alert: false });
assert(inv2.checks.find((c) => c.name === 'reason vocabulary').ok, 'the vocabulary stays closed (rwa:/dividend: kept for history + the vault)');
assert(inv2.checks.find((c) => c.name === 'portfolio retired').ok, 'nothing in this suite re-opened a retired till');
assert.equal(inv2.checks.find((c) => c.name === '$OMR conservation').drift, grantDrift,
  `the only $OMR drift is the test's unledgered grants (${grantDrift})`);

console.log('✅ Portfolio RETIRED (D11) test passed — 9 tombstone routes, direct-call payers throw, grantShares deleted, /v1/rules portfolio:null, the view carries no book, a historical rwa:invest row reconciles while a fresh one trips the "portfolio retired" alarm (and a live rwa:vault burn never does), the stranded family pool drains to the family yield, and THE VAULT block holds whole');
await app.close();
