// LOAN SHARKING — the Shylock. Offer (escrow) → take (escrow → borrower) → repay (transfer − vig) or
// default → collect (seize pocket + in-transit up to the debt, leg-break + welsher). Gates (amount/
// rate/term/own/welsher/max-active/not-due), the worker sweep (expired-offer refund + overdue welsher),
// death (a dead lender's open escrow burns, active loans void), and §10.4 (the new loan-escrow check +
// closed vocabulary + a scoped repay/collect transfer). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LOAN, loanVig, loanOwed } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepLoans } from '../src/loans.js';

const app = await buildServer();
const pool = app.pool;
const call = async (method, url, { token, body } = {}) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body });
  return { code: res.statusCode, body: res.json() };
};
const meOf = async (t) => (await call('GET', '/v1/me', { token: t })).body.character;
const mk = async (name) => {
  const { body: { token } } = await call('POST', '/v1/auth/guest');
  await call('POST', '/v1/character', { token, body: { name } });
  return { token, id: (await meOf(token)).id };
};
const seedCh = (id, cols) => pool.query(`UPDATE characters SET ${cols} WHERE id='${id}'`);
const rawCh = async (id) => (await pool.query(`SELECT * FROM characters WHERE id='${id}'`)).rows[0];
const cashOf = async (id) => Number((await rawCh(id)).cash);
const poolCash = async () => Number((await pool.query('SELECT pool FROM street_tax WHERE id=1')).rows[0].pool);
const ledgerOf = async (chId, reason) => Number((await pool.query(
  `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE character_id='${chId}' AND currency='cash' AND reason='${reason}'`)).rows[0].s);
const check = async (name) => (await runLedgerInvariants(pool)).checks.find((c) => c.name === name);

// ── offer: escrow the principal ──
const shark = await mk('Sharky Sam');
const bob = await mk('Borrower Bob');
await seedCh(shark.id, 'cash=1000000');
await seedCh(bob.id, 'cash=100000');
assert.equal((await call('POST', '/v1/loans', { token: shark.token, body: { amount: 100, rate: 0.2, hours: 24 } })).body.error, 'amount', 'below the floor is refused');
assert.equal((await call('POST', '/v1/loans', { token: shark.token, body: { amount: 100000, rate: 0.9, hours: 24 } })).body.error, 'rate', 'above the usury cap is refused');
assert.equal((await call('POST', '/v1/loans', { token: shark.token, body: { amount: 100000, rate: 0.2, hours: 999 } })).body.error, 'hours', 'over the term cap is refused');
let r = await call('POST', '/v1/loans', { token: shark.token, body: { amount: 100000, rate: 0.2, hours: 24 } });
assert.equal(r.code, 200, 'offer posted');
const loanId = r.body.id;
assert.equal(r.body.owed, loanOwed(100000, 0.2), 'the debt is principal × (1 + rate)');
assert.equal(await cashOf(shark.id), 900000, 'the principal is escrowed out of the lender');
assert.equal(await ledgerOf(shark.id, 'loan:offer'), -100000, 'the escrow is ledgered');
assert((await check('loan escrow')).ok, 'loan-escrow reconciles after an offer');
let board = (await call('GET', '/v1/loans', { token: bob.token })).body;
assert.equal(board.offers.length, 1, 'the offer is on the board');

// ── take: escrow → borrower ──
assert.equal((await call('POST', `/v1/loans/${loanId}/take`, { token: shark.token })).body.error, 'own', "you can't take your own money");
r = await call('POST', `/v1/loans/${loanId}/take`, { token: bob.token });
assert.equal(r.code, 200, 'loan taken');
assert.equal(await cashOf(bob.id), 200000, 'the borrower gets the principal');
assert.equal(await ledgerOf(bob.id, 'loan:take'), 100000, 'the take is ledgered');
assert((await check('loan escrow')).ok, 'loan-escrow reconciles after a take (escrow → borrower)');
assert.equal((await call('POST', `/v1/loans/${loanId}/take`, { token: bob.token })).body.error, 'gone', 'a taken offer is off the table');

// one active loan at a time (no debt-stacking)
const shark2 = await mk('Second Shark');
await seedCh(shark2.id, 'cash=500000');
const offer2 = (await call('POST', '/v1/loans', { token: shark2.token, body: { amount: 50000, rate: 0.1, hours: 24 } })).body.id;
assert.equal((await call('POST', `/v1/loans/${offer2}/take`, { token: bob.token })).body.error, 'maxed', 'no stacking a second debt');

// ── repay: a transfer minus the vig (scoped §10.4) ──
const owed = loanOwed(100000, 0.2), vig = loanVig(owed), toLender = owed - vig;
const sharkBefore = await cashOf(shark.id), bobBefore = await cashOf(bob.id), poolBefore = await poolCash();
r = await call('POST', `/v1/loans/${loanId}/repay`, { token: bob.token });
assert.equal(r.code, 200, 'repaid');
assert.equal(r.body.paid, owed, 'the borrower pays principal + interest');
assert.equal(bobBefore - await cashOf(bob.id), owed, 'the borrower is out the full debt');
assert.equal(await cashOf(shark.id) - sharkBefore, toLender, 'the lender collects the debt minus the vig');
assert.equal(await poolCash() - poolBefore, vig, 'the house vig reaches the buyback pool');
assert.equal(await ledgerOf(shark.id, 'loan:repay') + await ledgerOf(bob.id, 'loan:repay'), -vig, 'the two repay rows net to −vig (the sink)');
assert((await check('loan escrow')).ok, 'loan-escrow still holds after repay (repay touches no escrow)');

// ── cancel: pull an untaken offer, escrow refunds ──
const cancelBefore = await cashOf(shark2.id);
r = await call('POST', `/v1/loans/${offer2}/cancel`, { token: shark2.token });
assert.equal(r.code, 200, 'offer cancelled');
assert.equal(await cashOf(shark2.id) - cancelBefore, 50000, 'the escrow refunds to the lender');
assert.equal((await call('POST', `/v1/loans/${offer2}/cancel`, { token: shark2.token })).body.error, 'taken', "a cancelled offer can't be pulled again");

// ── default → collect: seize pocket + in-transit up to the debt, leg-break + welsher ──
const s3 = await mk('Third Shark');
const dan = await mk('Deadbeat Dan');
await seedCh(s3.id, 'cash=500000');
await seedCh(dan.id, 'cash=100000');
const l3 = (await call('POST', '/v1/loans', { token: s3.token, body: { amount: 50000, rate: 0.3, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${l3}/take`, { token: dan.token });
// can't collect before it's due
assert.equal((await call('POST', `/v1/loans/${l3}/collect`, { token: s3.token })).body.error, 'not_due', 'no collecting before the debt is due');
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${l3}'`);
// Dan has $40k pocket + $10k in-transit; cleared bank is safe; owes 65000
await seedCh(dan.id, "cash=40000, bank=30000, bank_intransit=10000, bank_intransit_at=now()");
const dOwed = loanOwed(50000, 0.3);        // 65000
const s3Before = await cashOf(s3.id), poolB2 = await poolCash();
r = await call('POST', `/v1/loans/${l3}/collect`, { token: s3.token });
assert.equal(r.code, 200, 'collected');
assert.equal(r.body.seized, 50000, 'seized pocket ($40k) + in-transit ($10k), cleared bank untouched');
assert.equal(r.body.shortfall, dOwed - 50000, 'the shortfall is written off — the lender ate it');
const collectVig = loanVig(50000);
assert.equal(await cashOf(s3.id) - s3Before, 50000 - collectVig, 'the lender recovers the seizure minus the vig');
assert.equal(await poolCash() - poolB2, collectVig, 'the collection vig reaches the pool');
const danRow = await rawCh(dan.id);
assert.equal(Number(danRow.cash), 0, "Dan's pocket is cleaned out");
assert.equal(Number(danRow.bank), 20000, "Dan's CLEARED bank ($20k) is safe from the shylock");
assert(danRow.welsher, 'Dan is marked a welsher');
assert(danRow.hosp_until && new Date(danRow.hosp_until) > new Date(), 'the deadbeat gets leg-broken');
assert.equal((await meOf(dan.token)).welsher, true, 'the welsher mark is on the view');

// a welsher can't borrow
const s4 = await mk('Fourth Shark');
await seedCh(s4.id, 'cash=200000');
const offer4 = (await call('POST', '/v1/loans', { token: s4.token, body: { amount: 20000, rate: 0.1, hours: 24 } })).body.id;
assert.equal((await call('POST', `/v1/loans/${offer4}/take`, { token: dan.token })).body.error, 'welsher', 'nobody lends to a welsher');

// ── the worker sweep: expired offers refund; overdue debts flag the borrower welsher ──
const s5 = await mk('Fifth Shark');
const late = await mk('Late Larry');
await seedCh(s5.id, 'cash=300000');
await seedCh(late.id, 'cash=100000');
const staleOffer = (await call('POST', '/v1/loans', { token: s5.token, body: { amount: 30000, rate: 0.1, hours: 24 } })).body.id;
const activeLoan = (await call('POST', '/v1/loans', { token: s5.token, body: { amount: 40000, rate: 0.2, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${activeLoan}/take`, { token: late.token });
await pool.query(`UPDATE loans SET offered_at = now() - interval '3 days' WHERE id='${staleOffer}'`);
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${activeLoan}'`);
const s5Before = await cashOf(s5.id);
const sweep = await sweepLoans(pool);
assert.equal(sweep.refunded, 1, 'the stale offer was refunded');
assert.equal(await cashOf(s5.id) - s5Before, 30000, 'the escrow came home to the lender');
assert.equal(sweep.welshed, 1, 'the overdue borrower was flagged');
assert((await rawCh(late.id)).welsher, 'Larry is a welsher for going overdue');
assert((await check('loan escrow')).ok, 'loan-escrow holds after the sweep');

// ── death: a dead lender's OPEN escrow burns; active loans void; escrow stays clean ──
const s6 = await mk('Sixth Shark');
await seedCh(s6.id, 'cash=200000');
const deadOffer = (await call('POST', '/v1/loans', { token: s6.token, body: { amount: 25000, rate: 0.1, hours: 24 } })).body.id;
assert((await check('loan escrow')).ok, 'escrow ok before the lender dies');
// mod-kill the lender (runs runEstate → voidLoansAtDeath)
const kill = await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: s6.id } });
assert.equal(kill.statusCode, 200, 'the lender is dead');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM loans WHERE id='${deadOffer}'`)).rows[0].c), 0, "the dead lender's open offer is gone");
const deathBurn = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='loan:death'")).rows[0].s);
assert.equal(deathBurn, -25000, 'the escrow burn is ledgered (loan:death)');
assert((await check('loan escrow')).ok, 'loan-escrow reconciles after the escrow burn (loan:death)');

// ── §10.4: vocabulary closed ──
const vocab = await check('reason vocabulary');
assert(vocab.ok, `loan:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);

console.log('✅ test/loans.js — loan sharking (offer/take/repay/cancel/collect, welsher, sweep, death, §10.4)');
process.exit(0);
