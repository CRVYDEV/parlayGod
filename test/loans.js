// LOAN SHARKING — the Shylock. Offer (escrow) → take (escrow → borrower) → repay (transfer − vig) or
// default → collect (seize pocket + in-transit up to the debt, leg-break + welsher). Gates (amount/
// rate/term/own/welsher/max-active/not-due), the worker sweep (expired-offer refund + overdue welsher),
// death (a dead lender's open escrow burns, active loans void), and §10.4 (the new loan-escrow check +
// closed vocabulary + a scoped repay/collect transfer). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LOAN, loanVig, loanOwed, carCollateralValue } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepLoans, voidLoansAtDeath } from '../src/loans.js';
import { ledger, notify } from '../src/game.js';
import crypto from 'node:crypto';

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

// ── AUDIT: actor gates (jailed / safe-housed can't run the book or break legs) ──
const jailedLender = await mk('Jailbird Joe');
await seedCh(jailedLender.id, "cash=200000, jail_until=now() + interval '1 hour'");
assert.equal((await call('POST', '/v1/loans', { token: jailedLender.token, body: { amount: 20000, rate: 0.1, hours: 24 } })).body.error, 'jailed', 'no running your book from a cell');
const safeLender = await mk('Safehouse Sal');
await seedCh(safeLender.id, "cash=200000, safe_until=now() + interval '4 hours'");
assert.equal((await call('POST', '/v1/loans', { token: safeLender.token, body: { amount: 20000, rate: 0.1, hours: 24 } })).body.error, 'safe', 'no fronting money from a safehouse (loot-proof-vault block)');
// a jailed borrower can't take; a jailed/safe-housed collector can't collect
const g1 = await mk('Gate Shark');
const g2 = await mk('Gate Borrower');
await seedCh(g1.id, 'cash=300000');
await seedCh(g2.id, 'cash=100000');
const gOffer = (await call('POST', '/v1/loans', { token: g1.token, body: { amount: 40000, rate: 0.2, hours: 1 } })).body.id;
await seedCh(g2.id, "jail_until=now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/loans/${gOffer}/take`, { token: g2.token })).body.error, 'jailed', 'no taking a loan from lockup');
await seedCh(g2.id, 'jail_until=NULL');
await call('POST', `/v1/loans/${gOffer}/take`, { token: g2.token });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${gOffer}'`);
await seedCh(g1.id, "jail_until=now() + interval '1 hour'");
assert.equal((await call('POST', `/v1/loans/${gOffer}/collect`, { token: g1.token })).body.error, 'jailed', 'no collecting debts from a cell');
await seedCh(g1.id, "jail_until=NULL, safe_until=now() + interval '4 hours'");
assert.equal((await call('POST', `/v1/loans/${gOffer}/collect`, { token: g1.token })).body.error, 'safe', 'no shaking anyone down while to ground (P1.3)');

// ── AUDIT: a fire-kill LOOTS the dead lender's open escrow (not a loot-proof vault) ──
// Direct estate-hook call (a full fire-kill is exercised in test/social.js): killerCh + CASH_LOOT_RATE.
const vaultVic = await mk('Vault Vic');
const killer = await mk('Killer Kim');
await seedCh(vaultVic.id, 'cash=500000');
await call('POST', '/v1/loans', { token: vaultVic.token, body: { amount: 200000, rate: 0.1, hours: 24 } });
assert((await check('loan escrow')).ok, 'escrow ok before the lender is whacked');
{
  const client = await pool.connect();
  await client.query('BEGIN');
  const killerCh = (await client.query(`SELECT * FROM characters WHERE id='${killer.id}' FOR UPDATE`)).rows[0];
  const before = Number(killerCh.cash);
  const res = await voidLoansAtDeath(client, vaultVic.id, { ledger, notify }, killerCh, 0.25);
  await client.query(`UPDATE characters SET cash=${Number(killerCh.cash)} WHERE id='${killer.id}'`); // persist the in-memory killer credit
  await client.query('COMMIT'); client.release();
  assert.equal(res.looted, 50000, 'the killer loots 25% of the $200k open escrow');
  assert.equal(await cashOf(killer.id) - before, 50000, 'the loot lands on the killer');
}
const loanLoot = Number((await pool.query("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='loan:loot'")).rows[0].s);
assert.equal(loanLoot, -50000, 'the escrow-side loot outflow is ledgered (loan:loot)');
const vicBurn = Number((await pool.query(`SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE reason='loan:death' AND counterparty='${vaultVic.id}'`)).rows[0].s);
assert.equal(vicBurn, -150000, 'the remainder of the escrow burns (loan:death)');
assert((await check('loan escrow')).ok, 'loan-escrow reconciles after the loot + burn (loan:loot + loan:death)');

// ── AUDIT (TOCTOU): the sweep never brands a borrower who legitimately repaid AFTER due ──
const ts = await mk('Timely Shark');
const tb = await mk('Timely Borrower');
await seedCh(ts.id, 'cash=200000');
await seedCh(tb.id, 'cash=100000');
const tLoan = (await call('POST', '/v1/loans', { token: ts.token, body: { amount: 30000, rate: 0.1, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${tLoan}/take`, { token: tb.token });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 minute' WHERE id='${tLoan}'`); // now overdue
await seedCh(tb.id, 'cash=100000'); // ensure pocket to repay
r = await call('POST', `/v1/loans/${tLoan}/repay`, { token: tb.token }); // repay is allowed past due
assert.equal(r.code, 200, 'a borrower can square an overdue debt before the shark collects');
await sweepLoans(pool);
assert.equal((await rawCh(tb.id)).welsher, false, 'squaring the debt (even late) keeps the name clean — the sweep re-scopes to STILL-active overdue loans');

// ── STEP TWO: directed (trust-line) offers — only the named borrower can take ──
const dShark = await mk('Directed Shark');
const friend = await mk('Trusted Friend');
const stranger = await mk('Random Stranger');
await seedCh(dShark.id, 'cash=300000');
const dOffer = (await call('POST', '/v1/loans', { token: dShark.token, body: { amount: 50000, rate: 0.1, hours: 24, to: friend.id } })).body;
assert.equal(dOffer.directed, true, 'the offer is directed');
// the stranger doesn't even see it on the board, and can't take it
const strangerBoard = (await call('GET', '/v1/loans', { token: stranger.token })).body.offers;
assert(!strangerBoard.some((o) => o.id === dOffer.id), 'a directed offer is hidden from outsiders');
assert.equal((await call('POST', `/v1/loans/${dOffer.id}/take`, { token: stranger.token })).body.error, 'directed', 'an outsider can’t take a directed offer');
// the named friend sees it (forMe) and can take it
const friendBoard = (await call('GET', '/v1/loans', { token: friend.token })).body.offers;
assert(friendBoard.some((o) => o.id === dOffer.id && o.forMe), 'the named borrower sees the trust line');
assert.equal((await call('POST', `/v1/loans/${dOffer.id}/take`, { token: friend.token })).code, 200, 'the named borrower takes it');

// ── STEP TWO: collateralized loans — pledge a car, forfeit it on default ──
const cShark = await mk('Secured Sam');
const owner = await mk('Car Owner');
await seedCh(cShark.id, 'cash=500000');
await seedCh(owner.id, 'cash=100000');
const mkCar = async (chId, model, trim, dmg = 0) => {
  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO cars (id, character_id, model_id, trim_id, dmg) VALUES ('${id}','${chId}','${model}','${trim}',${dmg})`);
  return id;
};
const goodCar = await mkCar(owner.id, 'pigeon', 'stock', 0);   // carVal 2000
const cheapCar = await mkCar(owner.id, 'junker', 'stock', 0);  // carVal 900
const collat = carCollateralValue('pigeon', 'stock', 0);
assert.equal(collat, 2000, 'the pigeon books at $2000');
// a secured offer requiring $1500 collateral
const secured = (await call('POST', '/v1/loans', { token: cShark.token, body: { amount: 40000, rate: 0.25, hours: 1, collateral: 1500 } })).body;
assert.equal(secured.collateralMin, 1500, 'the offer records its collateral requirement');
assert.equal((await call('POST', `/v1/loans/${secured.id}/take`, { token: owner.token })).body.error, 'no_car', 'a secured offer refuses a bare take');
assert.equal((await call('POST', `/v1/loans/${secured.id}/take`, { token: owner.token, body: { carId: cheapCar } })).body.error, 'collateral', 'a $900 junker can’t secure a $1500 pledge');
const takeRes = await call('POST', `/v1/loans/${secured.id}/take`, { token: owner.token, body: { carId: goodCar } });
assert.equal(takeRes.code, 200, 'the pigeon secures the loan');
assert.equal(takeRes.body.collateral, true, 'the take reports the pledge');
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${goodCar}'`)).rows[0].pledged, true, 'the car is locked (pledged)');
// a pledged car can’t be melted or listed
assert.equal((await call('POST', `/v1/garage/${goodCar}/melt`, { token: owner.token })).body.error, 'pledged', 'no melting pledged collateral');
// repay squares it → the car comes home
await seedCh(owner.id, 'cash=200000');
assert.equal((await call('POST', `/v1/loans/${secured.id}/repay`, { token: owner.token })).code, 200, 'the debt is squared');
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${goodCar}'`)).rows[0].pledged, false, 'the pledged car unlocks on repay');

// default → the collateral is SEIZED to the lender
const secured2 = (await call('POST', '/v1/loans', { token: cShark.token, body: { amount: 30000, rate: 0.2, hours: 1, collateral: 1500 } })).body;
await call('POST', `/v1/loans/${secured2.id}/take`, { token: owner.token, body: { carId: goodCar } });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${secured2.id}'`);
await seedCh(owner.id, 'cash=0, bank=0, bank_intransit=0'); // broke — the shortfall is written off; the car is the recourse
const carsBefore = Number((await pool.query('SELECT COUNT(*) c FROM cars')).rows[0].c);
const collectRes = await call('POST', `/v1/loans/${secured2.id}/collect`, { token: cShark.token });
assert.equal(collectRes.code, 200, 'collected');
assert.equal(collectRes.body.carSeized, goodCar, 'the collateral car is seized on default');
const carRow = (await pool.query(`SELECT character_id, pledged FROM cars WHERE id='${goodCar}'`)).rows[0];
assert.equal(carRow.character_id, cShark.id, 'the car now belongs to the lender');
assert.equal(carRow.pledged, false, 'and is no longer pledged (it changed hands)');
assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM cars')).rows[0].c), carsBefore, 'car conservation: the seizure MOVED a row, never minted or destroyed one');

// dead lender → the surviving borrower's pledged car unlocks + the debt voids
const dLender = await mk('Doomed Lender');
const survivor = await mk('Survivor Sid');
await seedCh(dLender.id, 'cash=200000');
const survCar = await mkCar(survivor.id, 'pigeon', 'stock', 0);
const secured3 = (await call('POST', '/v1/loans', { token: dLender.token, body: { amount: 20000, rate: 0.1, hours: 24, collateral: 1500 } })).body;
await call('POST', `/v1/loans/${secured3.id}/take`, { token: survivor.token, body: { carId: survCar } });
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${survCar}'`)).rows[0].pledged, true, 'pledged while the loan is live');
const killL = await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: dLender.id } });
assert.equal(killL.statusCode, 200, 'the lender is dead');
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${survCar}'`)).rows[0].pledged, false, 'the dead lender’s claim dies — the borrower’s car unlocks');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM loans WHERE id='${secured3.id}'`)).rows[0].c), 0, 'the active loan voided');

// ── §10.4: vocabulary closed (collateral is an ownership move, not currency — no new reasons) ──
const vocab = await check('reason vocabulary');
assert(vocab.ok, `loan:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
assert((await check('loan escrow')).ok, 'loan-escrow still reconciles after the step-two lifecycle');
// (car conservation is proven above by the seize being a row-MOVE with a stable COUNT — the §10.4
// invariant itself is confounded here by directly-seeded cars, the SQL-seeded-cash precedent.)

console.log('✅ test/loans.js — loan sharking (offer/take/repay/cancel/collect, welsher, sweep, death, §10.4)');
process.exit(0);
