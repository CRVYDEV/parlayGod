// THE PAYROLL (/v1/payroll) — every crew you owe on one page, in one vocabulary. Built from tester
// feedback ("paying the guys in the kitchen is not the same as paying the guys in the empire — it's
// not consistent"). The centre of the test is the AGREEMENT property: the payroll REUSES each
// module's own board readers, so the number here and the number on each tab must be IDENTICAL —
// asserted directly against /v1/me (the crew nut), /v1/business (the pad), /v1/territory (the
// family's operations) and /v1/estate (the household), because "board and till can never disagree"
// is the whole reason the module exists. Plus: every row carries the same field set (the
// consistency the tester asked for), paying through the real till flips the row, an empty book
// renders empty, and the read is §10.4-free (zero transactions rows, cash drift delta unchanged).
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { ESTATE } from '../src/rules.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return token;
};
const board = async (t) => (await call('GET', '/v1/payroll', { token: t })).body;
const txnCount = async () => Number((await pool.query('SELECT count(*) c FROM transactions')).rows[0].c);
const cashDrift = async () => Number((await runLedgerInvariants(pool, { alert: false })).checks.find((x) => x.name === 'character cash').drift);

// ════════════ an empty book renders EMPTY (the empty-state rule) ════════════
const t = await mk('Payroll Boss');
{
  const b = await board(t);
  assert.deepEqual(b.items, [], 'a fresh street owes nobody — the payroll is empty');
  assert.equal(b.owedCash + b.owedOmr + b.owedTreasury, 0);
}

// ── seed real obligations on every book. Clocks are backdated with JS Date params (the pg-mem
//    posture); the crew/front/staff rows are the same rows the real tills read, so the agreement
//    assertions below compare two INDEPENDENT reads of one truth. ──
const cid = (await pool.query('SELECT id, account_id FROM characters WHERE alive ORDER BY created_at DESC LIMIT 1')).rows[0];
const sixH = new Date(Date.now() - 6 * 3600 * 1000);
await pool.query('UPDATE characters SET crew=2, crew_paid_at=$2 WHERE id=$1', [cid.id, sixH]);          // the nut: 2 hands, 6h in arrears
await pool.query("INSERT INTO businesses (id, character_id, kind, tier, last_collect_at, upkeep_at) VALUES ('payb1',$1,'laundromat',1,$2,$2)", [cid.id, sixH]); // the pad
await pool.query('INSERT INTO estates (account_id, staff_paid_at) VALUES ($1,$2)', [cid.account_id, sixH]); // the household
await pool.query('INSERT INTO estate_staff (account_id, staff_id) VALUES ($1,$2)', [cid.account_id, ESTATE.STAFF[0].id]);
// the family's books: found a gang (seeded cash — the §10.4 checks below are DELTAS, the loadtest posture)
await pool.query('UPDATE characters SET cash = cash + 100000, respect = 250 WHERE id=$1', [cid.id]); // level 5+ to found
const g = await call('POST', '/v1/gangs', { token: t, body: { name: 'Payroll Family', tag: 'PAY' } });
assert.equal(g.code, 200, `founding: ${JSON.stringify(g.body)}`);
await pool.query("INSERT INTO territory_rackets (district_id, owner_gang, tier, last_income_at, upkeep_at) VALUES ('docks',$1,1,$2,$2)", [g.body.gangId, sixH]);

// ════════════ the four books, one page, ONE field vocabulary ════════════
{
  const b = await board(t);
  const ids = b.items.map((i) => i.id);
  for (const id of ['crew', 'fronts', 'household', 'territory']) assert.ok(ids.includes(id), `the payroll carries ${id}`);
  for (const it of b.items) {
    // the consistency the tester asked for: every row carries the same shape — what, the till it
    // pays in, what's owed, HOW it settles (stated, not hidden), the pay route and the jump
    assert.ok(it.label && it.flavor && it.tab, `${it.id} names itself + jumps somewhere`);
    assert.ok(['cash', 'omr', 'treasury'].includes(it.currency), `${it.id} names its till`);
    assert.ok(typeof it.owed === 'number' && it.owed > 0, `${it.id} owes something (the clocks were backdated)`);
    assert.ok(it.pay?.startsWith('POST /v1/') && it.how, `${it.id} carries its pay route + settlement semantics`);
  }
  // ONE SHAPE — the consistency claim as a test: every row carries the SAME key set (perHr/perDay
  // null where N/A, never absent), so no renderer can meet a book whose row is missing a field.
  const keys0 = Object.keys(b.items[0]).sort().join(',');
  for (const it of b.items) assert.equal(Object.keys(it).sort().join(','), keys0,
    `${it.id} carries the exact same field set as every other book — one vocabulary, one shape`);
  assert.equal(b.owedCash, b.items.find((i) => i.id === 'crew').owed + b.items.find((i) => i.id === 'fronts').owed);
  assert.equal(b.owedTreasury, b.items.find((i) => i.id === 'territory').owed);
}

// ════════════ THE AGREEMENT — the payroll and each tab read the SAME number ════════════
// The load-bearing property (and the mutation target): the board reuses each module's own reader,
// so re-fetch every tab's own surface and require equality. A payroll that re-derived a formula
// would drift the first time a lever moved — this is what makes it structurally impossible.
{
  const b = await board(t);
  const me = (await call('GET', '/v1/me', { token: t })).body.character;
  assert.equal(b.items.find((i) => i.id === 'crew').owed, me.crewWageOwed,
    'the crew row agrees with the kitchen tab (the view) to the dollar');
  const biz = (await call('GET', '/v1/business', { token: t })).body.businesses;
  assert.equal(b.items.find((i) => i.id === 'fronts').owed, biz.reduce((a, x) => a + Number(x.upkeepOwed || 0), 0),
    'the fronts row agrees with the Empire tab to the dollar');
  const terr = (await call('GET', '/v1/territory', { token: t })).body.territory;
  assert.equal(b.items.find((i) => i.id === 'territory').owed, terr.reduce((a, x) => a + Number(x.upkeepOwed || 0), 0),
    'the territory row agrees with the Family tab to the dollar');
  const est = (await call('GET', '/v1/estate', { token: t })).body.household;
  assert.equal(b.items.find((i) => i.id === 'household').owed, est.owed,
    'the household row agrees with the Estate tab to the $OMR');
  assert.equal(b.items.find((i) => i.id === 'household').currency, 'omr', 'the household names its different till');
  assert.ok(b.items.find((i) => i.id === 'territory').canPay, 'the founder is the boss — the treasury button is live for him');
}

// ════════════ paying through the REAL till flips the row ════════════
{
  const paid = await call('POST', '/v1/kitchen/crew/wages', { token: t });
  assert.equal(paid.code, 200, `the nut settles: ${JSON.stringify(paid.body)}`);
  const b = await board(t);
  assert.equal(b.items.find((i) => i.id === 'crew').owed, 0, 'the payroll reflects the settle — the nut reads square');
  assert.ok(b.items.find((i) => i.id === 'fronts').owed > 0, 'the other books still stand');
}

// ════════════ §10.4 — reading the payroll moves NO value ════════════
{
  const tx0 = await txnCount();
  const d0 = await cashDrift();
  await board(t); await board(t);
  assert.equal(await txnCount(), tx0, 'reading the payroll writes zero transactions rows');
  assert.equal(await cashDrift(), d0, 'the payroll board is §10.4-neutral (drift delta unchanged)');
}

console.log('payroll: THE PAYROLL ok — one page, one vocabulary, every row agreeing with its own tab to the dollar, the real till flipping the row, and a §10.4-free read.');
await app.close();
