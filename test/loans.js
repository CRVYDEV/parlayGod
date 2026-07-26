// LOAN SHARKING — the Shylock. Offer (escrow) → take (escrow → borrower) → repay (transfer − vig) or
// default → collect (seize pocket + in-transit up to the debt, leg-break + welsher). Gates (amount/
// rate/term/own/welsher/max-active/not-due), the worker sweep (expired-offer refund + overdue welsher),
// death (a dead lender's open escrow burns; an active loan's debt SURVIVES to the heir), and §10.4 (the loan-escrow check +
// closed vocabulary + a scoped repay/collect transfer). pg-mem, zero infra.
process.env.MOD_KEY = 'test-mod-key';
import assert from 'node:assert';
import { buildServer } from '../src/server.js';
import { LOAN, loanVig, loanOwed, carCollateralValue } from '../src/rules.js';
import { runLedgerInvariants } from '../src/invariants.js';
import { sweepLoans, voidLoansAtDeath } from '../src/loans.js';
import { huntWanted } from '../src/social.js';
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
const check = async (name) => (await runLedgerInvariants(pool, { alert: false })).checks.find((c) => c.name === name);

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
// step 5: the vig SPLITS — half to the buyback pool, half to the loan-house window
const vigHouse = Math.floor(vig * LOAN.HOUSE_VIG_BPS / 10000), vigPool = vig - vigHouse;
assert.equal(await poolCash() - poolBefore, vigPool, 'the street share of the vig reaches the buyback pool');
assert.equal(Number((await pool.query('SELECT pool FROM loan_house WHERE id=1')).rows[0].pool), vigHouse,
  'the house share of the vig funds the window');
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
assert.equal(await poolCash() - poolB2, collectVig - Math.floor(collectVig * LOAN.HOUSE_VIG_BPS / 10000),
  'the street share of the collection vig reaches the pool (the rest funds the house window)');
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
// AUDIT F1: a sweep-marked welsher (loan still ACTIVE) can't buy their name back until the debt is
// settled — else the very next sweep re-brands + re-posts the bounty, making the pardon last <1 tick.
await seedCh(late.id, `cash=${LOAN.SQUARE_COST}`);
assert.equal((await call('POST', '/v1/loans/square', { token: late.token })).body.error, 'overdue', 'no squaring while still overdue on the debt');
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
// AUDIT F2: the seized car shows FULLY in the lender's response view (not a null-model stub)
const seizedInView = (collectRes.body.character?.cars || []).find((c) => c.id === goodCar);
assert(seizedInView && seizedInView.model === 'pigeon', 'the seized car renders complete in the lender’s garage (full row, not a bare id stub)');
assert.equal(Number((await pool.query('SELECT COUNT(*) c FROM cars')).rows[0].c), carsBefore, 'car conservation: the seizure MOVED a row, never minted or destroyed one');

// SIGN-OFF (Tier 4): dead lender → the DEBT SURVIVES to the HEIR (killing your lender no longer wipes it).
// The active loan carries over reassigned to the heir, and the pledged car stays locked (secured claim).
const dLender = await mk('Doomed Lender');
const survivor = await mk('Survivor Sid');
await seedCh(dLender.id, 'cash=200000');
const survCar = await mkCar(survivor.id, 'pigeon', 'stock', 0);
const secured3 = (await call('POST', '/v1/loans', { token: dLender.token, body: { amount: 20000, rate: 0.1, hours: 24, collateral: 1500 } })).body;
await call('POST', `/v1/loans/${secured3.id}/take`, { token: survivor.token, body: { carId: survCar } });
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${survCar}'`)).rows[0].pledged, true, 'pledged while the loan is live');
const dLenderAcct = (await pool.query(`SELECT account_id a FROM characters WHERE id='${dLender.id}'`)).rows[0].a;
const killL = await app.inject({ method: 'POST', url: '/v1/mod/kill', headers: { 'x-mod-key': 'test-mod-key' }, payload: { characterId: dLender.id } });
assert.equal(killL.statusCode, 200, 'the lender is dead');
const dHeir = (await pool.query(`SELECT id FROM characters WHERE account_id='${dLenderAcct}' AND alive=true`)).rows[0].id;
const survived = (await pool.query(`SELECT lender_character, status FROM loans WHERE id='${secured3.id}'`)).rows[0];
assert(survived && survived.status === 'active', 'the debt SURVIVES the lender — killing your lender no longer erases it');
assert.equal(survived.lender_character, dHeir, 'the receivable passed to the heir (the bloodline inherits the book)');
assert.equal((await pool.query(`SELECT pledged FROM cars WHERE id='${survCar}'`)).rows[0].pledged, true, 'and the pledged car stays locked (the heir holds the secured claim)');

// ── STEP TWO audit F1: an un-collected SECURED loan auto-forfeits its collateral past due + GRACE ──
const afShark = await mk('Absent Shark');
const afBorrow = await mk('Grace Gary');
await seedCh(afShark.id, 'cash=200000');
const afCar = await mkCar(afBorrow.id, 'pigeon', 'stock', 0);
const afLoan = (await call('POST', '/v1/loans', { token: afShark.token, body: { amount: 20000, rate: 0.1, hours: 1, collateral: 1500 } })).body.id;
await call('POST', `/v1/loans/${afLoan}/take`, { token: afBorrow.token, body: { carId: afCar } });
// overdue but WITHIN grace → NOT forfeited (the lender still has time to collect; the borrower to repay)
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${afLoan}'`);
let afSweep = await sweepLoans(pool);
assert.equal(afSweep.forfeited, 0, 'a loan overdue within grace is NOT auto-forfeited');
assert.equal((await pool.query(`SELECT character_id, pledged FROM cars WHERE id='${afCar}'`)).rows[0].character_id, afBorrow.id, 'the car is still the borrower’s inside the grace window');
// past due + GRACE_MS → the collateral car forfeits to the lender, the loan resolves
await pool.query(`UPDATE loans SET due_at = now() - interval '48 hours' WHERE id='${afLoan}'`);
afSweep = await sweepLoans(pool);
assert.equal(afSweep.forfeited, 1, 'past the grace window the collateral auto-forfeits');
const afRow = (await pool.query(`SELECT character_id, pledged FROM cars WHERE id='${afCar}'`)).rows[0];
assert.equal(afRow.character_id, afShark.id, 'the abandoned collateral goes to the lender');
assert.equal(afRow.pledged, false, 'and unlocks (it changed hands — no frozen car)');
assert.equal((await pool.query(`SELECT status FROM loans WHERE id='${afLoan}'`)).rows[0].status, 'collected', 'the loan resolves on forfeit');
assert((await check('loan escrow')).ok, 'loan-escrow still reconciles after an auto-forfeit (a pure ownership move)');

// ── STEP THREE: the PAPER market — sell an active loan's claim to another player ──
const pLender = await mk('Paper Pete');
const pBorrow = await mk('Debtor Dave');
const pBuyer = await mk('Collector Cal');
await seedCh(pLender.id, 'cash=200000');
await seedCh(pBuyer.id, 'cash=200000');
const pLoan = (await call('POST', '/v1/loans', { token: pLender.token, body: { amount: 50000, rate: 0.2, hours: 24 } })).body.id;
await call('POST', `/v1/loans/${pLoan}/take`, { token: pBorrow.token });
assert.equal((await call('POST', `/v1/loans/${pLoan}/sell`, { token: pBorrow.token, body: { price: 40000 } })).body.error, 'not_yours', 'only the lender sells the paper');
assert.equal((await call('POST', `/v1/loans/${pLoan}/sell`, { token: pLender.token, body: { price: 0 } })).body.error, 'price', 'a paper needs a price');
assert.equal((await call('POST', `/v1/loans/${pLoan}/sell`, { token: pLender.token, body: { price: 40000 } })).code, 200, 'the paper is listed');
// unsell then relist (the flag toggles cleanly)
assert.equal((await call('POST', `/v1/loans/${pLoan}/unsell`, { token: pLender.token })).code, 200, 'the lender can pull the paper');
assert.equal((await call('POST', `/v1/loans/${pLoan}/buy`, { token: pBuyer.token })).body.error, 'gone', 'an unlisted paper can’t be bought');
await call('POST', `/v1/loans/${pLoan}/sell`, { token: pLender.token, body: { price: 40000 } });
// the board surfaces the receivable + its risk (owed, collateral, welsher)
const listing = (await call('GET', '/v1/loans', { token: pBuyer.token })).body.paper.find((p) => p.id === pLoan);
assert(listing && listing.price === 40000 && listing.owed === loanOwed(50000, 0.2), 'the paper shows price + owed (the receivable)');
assert.equal((await call('POST', `/v1/loans/${pLoan}/buy`, { token: pBorrow.token })).body.error, 'own_debt', 'you can’t buy the paper on your own debt');
// buy: pay the ask minus the 2% take → the pool; become the new lender
const takeP = Math.ceil(40000 * LOAN.PAPER_TAKE_BPS / 10000);
const buyerBefore = await cashOf(pBuyer.id), sellerBefore = await cashOf(pLender.id), poolBeforeP = await poolCash();
r = await call('POST', `/v1/loans/${pLoan}/buy`, { token: pBuyer.token });
assert.equal(r.code, 200, 'the paper is bought');
assert.equal(buyerBefore - await cashOf(pBuyer.id), 40000, 'the buyer pays the ask');
assert.equal(await cashOf(pLender.id) - sellerBefore, 40000 - takeP, 'the seller gets the ask minus the take');
assert.equal(await poolCash() - poolBeforeP, takeP, 'the 2% take reaches the buyback pool');
assert.equal((await pool.query(`SELECT lender_character, for_sale FROM loans WHERE id='${pLoan}'`)).rows[0].lender_character, pBuyer.id, 'the buyer is the new lender');
assert.equal(await ledgerOf(pBuyer.id, 'loan:paper') + await ledgerOf(pLender.id, 'loan:paper'), -takeP, 'the two paper rows net to −take (the taxed transfer)');
// the NEW lender now holds the claim — the borrower owes THEM
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${pLoan}'`);
await seedCh(pBorrow.id, 'cash=100000, bank=0, bank_intransit=0');
r = await call('POST', `/v1/loans/${pLoan}/collect`, { token: pBuyer.token });
assert.equal(r.code, 200, 'the new lender collects the claim they bought');
assert(r.body.seized > 0, 'and recovers the debt');
assert((await check('loan escrow')).ok, 'loan-escrow unaffected by a paper sale (active loans, not open escrow)');

// ── STEP FOUR: WANTED — a default marks the borrower + the underworld posts a pool bounty ──
const wShark = await mk('Wanted Shark');
const welch = await mk('Welching Wally');
await seedCh(wShark.id, 'cash=200000');
await seedCh(welch.id, 'cash=100000');
await pool.query('UPDATE street_tax SET pool=500000 WHERE id=1'); // the pool can front the price
const wLoan = (await call('POST', '/v1/loans', { token: wShark.token, body: { amount: 30000, rate: 0.2, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${wLoan}/take`, { token: welch.token });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${wLoan}'`);
await seedCh(welch.id, 'cash=0, bank=0, bank_intransit=0, respect=12500'); // broke, but a real (lvl 36) mark — worth a price
const wPoolBefore = await poolCash();
r = await call('POST', `/v1/loans/${wLoan}/collect`, { token: wShark.token });
assert.equal(r.body.wanted, true, 'the default marks them WANTED');
assert.equal((await meOf(welch.token)).wanted, true, 'the view flags them wanted');
assert.equal(Number((await pool.query(`SELECT amount FROM bounty_contributors WHERE target_character='${welch.id}' AND kind='kill' AND contributor='HOUSE'`)).rows[0].amount), LOAN.WANTED_BOUNTY, 'the underworld posts a WANTED_BOUNTY from the pool');
assert.equal(wPoolBefore - await poolCash(), LOAN.WANTED_BOUNTY, 'the pool fronts the price (nothing seized from the broke deadbeat, so no vig)');
assert((await check('bounty escrow')).ok, 'bounty escrow reconciles with the pool-funded wanted bounty');
// alt-farm mitigation: a LOW-LEVEL (rookie) defaulter is still WANTED but gets NO pool cash bounty
const rookieShark = await mk('Rookie Shark');
const rookie = await mk('Rookie Deadbeat'); // level 1 — a nobody
await seedCh(rookieShark.id, 'cash=200000');
await pool.query('UPDATE street_tax SET pool=500000 WHERE id=1');
const rkLoan = (await call('POST', '/v1/loans', { token: rookieShark.token, body: { amount: 20000, rate: 0.2, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${rkLoan}/take`, { token: rookie.token });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${rkLoan}'`);
await seedCh(rookie.id, 'cash=0, bank=0, bank_intransit=0'); // broke rookie (level 1)
const rkPoolBefore = await poolCash();
r = await call('POST', `/v1/loans/${rkLoan}/collect`, { token: rookieShark.token });
assert.equal(r.body.wanted, true, 'a rookie deadbeat is still WANTED (omertà stripped + NPC hunters)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM bounty_contributors WHERE target_character='${rookie.id}' AND contributor='HOUSE'`)).rows[0].c), 0, 'but NO pool cash bounty on a nobody (alt-farm floor)');
assert.equal(await poolCash(), rkPoolBefore, 'the pool is untouched by a rookie default');
// a wanted defaulter can't dodge by being poor — but they CAN square their name
assert.equal((await call('POST', '/v1/loans/square', { token: welch.token })).body.error, 'cash', 'squaring takes real money');
await seedCh(welch.id, `cash=${LOAN.SQUARE_COST}`);
const sqPoolBefore = await poolCash();
r = await call('POST', '/v1/loans/square', { token: welch.token });
assert.equal(r.code, 200, 'squared up');
const welchAfter = await rawCh(welch.id);
assert.equal(welchAfter.welsher, false, 'squaring clears the welsher mark');
assert(!welchAfter.wanted_until || new Date(welchAfter.wanted_until) <= new Date(), 'and lifts the wanted status');
assert.equal(await poolCash() - sqPoolBefore, LOAN.SQUARE_COST + LOAN.WANTED_BOUNTY, 'the square fee AND the called-off bounty reach the pool');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM bounty_contributors WHERE target_character='${welch.id}' AND contributor='HOUSE'`)).rows[0].c), 0, 'the house bounty is called off');
assert((await check('bounty escrow')).ok, 'bounty escrow reconciles after squaring (house share refunded to pool)');
// AUDIT (HIGH): the pool-destined house refund must NOT drift the gang-treasuries check — it uses a
// DISTINCT reason (bounty:wanted:refund), not the plain bounty:refund that check (b) sums as treasury.
assert((await check('gang treasuries')).ok, 'the wanted-bounty refund goes to the POOL, not a phantom treasury (§10.4 check b clean)');
assert.equal((await meOf(welch.token)).wanted, false, 'the view shows a clean name');
// a squared name can borrow again
const reShark = await mk('Re Shark'); await seedCh(reShark.id, 'cash=200000');
const reOffer = (await call('POST', '/v1/loans', { token: reShark.token, body: { amount: 20000, rate: 0.1, hours: 24 } })).body.id;
assert.equal((await call('POST', `/v1/loans/${reOffer}/take`, { token: welch.token })).code, 200, 'a squared name can take a loan again');

// AUDIT: an NPC bounty hunter killing a wanted mark BURNS the HOUSE bounty (death:bounty) — §10.4 clean
const hShark = await mk('Hunt Shark');
const doomed = await mk('Doomed Deadbeat');
await seedCh(hShark.id, 'cash=200000');
await pool.query('UPDATE street_tax SET pool=500000 WHERE id=1');
const hLoan = (await call('POST', '/v1/loans', { token: hShark.token, body: { amount: 20000, rate: 0.2, hours: 1 } })).body.id;
await call('POST', `/v1/loans/${hLoan}/take`, { token: doomed.token });
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE id='${hLoan}'`);
await seedCh(doomed.id, 'cash=0, bank=0, bank_intransit=0, respect=12500'); // a real (lvl 36) mark
await call('POST', `/v1/loans/${hLoan}/collect`, { token: hShark.token }); // → wanted + a HOUSE bounty
assert.equal(Number((await pool.query(`SELECT amount FROM bounties WHERE target_character='${doomed.id}' AND kind='kill'`)).rows[0].amount), LOAN.WANTED_BOUNTY, 'the HOUSE bounty is live on the deadbeat');
await pool.query(`UPDATE characters SET wanted_until=NULL WHERE id <> '${doomed.id}'`); // isolate: only the doomed mark is hunted
await seedCh(doomed.id, 'hosp_until=NULL'); // the leg-break healed — now reachable by the hunter
process.env.WANTED_HUNT_P = '1';
const hunt = await huntWanted(pool);
delete process.env.WANTED_HUNT_P;
assert.equal(hunt.killed, 1, 'the NPC hunter whacks the wanted deadbeat (the estate runs)');
assert.equal(Number((await pool.query(`SELECT COUNT(*) c FROM bounties WHERE target_character='${doomed.id}'`)).rows[0].c), 0, 'the HOUSE bounty dies with the estate');
assert((await check('bounty escrow')).ok, 'bounty escrow reconciles after the estate burned the HOUSE bounty');
assert((await check('gang treasuries')).ok, 'gang treasuries clean after the NPC-kill bounty burn');

// ══ STEP FIVE — THE LOAN HOUSE (the backed NPC lender) ══
// The window opens with whatever the vig split already funded + a mod top-up from the pool.
const modHdr = { 'x-mod-key': 'test-mod-key' };
const housePool = async () => Number((await pool.query('SELECT pool FROM loan_house WHERE id=1')).rows[0].pool);
await pool.query('UPDATE street_tax SET pool = pool + 100000 WHERE id=1'); // seed the confiscation pool (SQL — non-§10.4 bucket)
const hp0 = await housePool();
let fund = await app.inject({ method: 'POST', url: '/v1/mod/loanhouse/fund', headers: modHdr, payload: { amount: 40000 } });
assert.equal(fund.statusCode, 200, 'the founder seeds the window from the confiscation pool');
assert.equal(await housePool(), hp0 + 40000, 'the window holds the funding');
assert((await check('loan house pool')).ok, 'the loan-house pool reconciles after funding');

// gates: a rookie has no window; a welsher is refused; the marker is level-capped; the pool is THE WALL
const pat = await mk('Payday Pat');
assert.equal((await call('POST', '/v1/loans/house', { token: pat.token, body: { amount: 5000 } })).body.error, 'level',
  'the window opens at a real level');
await seedCh(pat.id, 'respect=810'); // level 10 → cap $20k
r = await call('GET', '/v1/loans', { token: pat.token });
assert.equal(r.body.house.cap, Math.min(LOAN.HOUSE_MAX, LOAN.HOUSE_MAX_PER_LVL * 10), 'the board quotes the level cap');
assert(r.body.house.eligible, 'Pat is good for it');
assert.equal((await call('POST', '/v1/loans/house', { token: pat.token, body: { amount: 25000 } })).body.error, 'amount', 'over the level cap');
assert.equal((await call('POST', '/v1/loans/house', { token: pat.token, body: { amount: 500 } })).body.error, 'amount', 'under the floor');

// take: pool-bounded principal → pocket, ledgered loan:house:take
const patCash0 = await cashOf(pat.id), hp1 = await housePool();
r = await call('POST', '/v1/loans/house', { token: pat.token, body: { amount: 10000 } });
assert.equal(r.code, 200, 'the house writes the marker');
assert.equal(r.body.owed, loanOwed(10000, LOAN.HOUSE_RATE), 'at the house rate');
assert.equal(await cashOf(pat.id), patCash0 + 10000, 'the principal lands in pocket');
assert.equal(await housePool(), hp1 - 10000, 'straight out of the window — the house lends only what it holds');
assert.equal((await call('POST', '/v1/loans/house', { token: pat.token, body: { amount: 5000 } })).body.error, 'maxed', 'one debt at a time');
r = await call('GET', '/v1/loans', { token: pat.token });
assert(r.body.house.yourMarker && r.body.house.yourMarker.owed === loanOwed(10000, LOAN.HOUSE_RATE), 'the marker is on the board');

// repay: the whole owed → the pool (the interest IS the house take — good loans grow the window)
await seedCh(pat.id, 'cash=cash+10000'); // Pat earns the interest elsewhere (SQL seed — drift not asserted here)
const hp2 = await housePool();
r = await call('POST', '/v1/loans/house/repay', { token: pat.token });
assert.equal(r.code, 200, 'the marker is squared');
assert.equal(r.body.interest, loanOwed(10000, LOAN.HOUSE_RATE) - 10000, 'the interest is the house take');
assert.equal(await housePool(), hp2 + loanOwed(10000, LOAN.HOUSE_RATE), 'principal + interest home to the pool');
assert((await check('loan house pool')).ok, 'the pool reconciles after a full cycle');

// THE WALL: the window never writes past the pool
const whale = await mk('Window Willy');
await seedCh(whale.id, 'respect=25000'); // deep level → cap $50k, but the pool is thinner than that
await pool.query('UPDATE loan_house SET pool = 3000 WHERE id=1'); // (SQL squeeze — the check is asserted on ledgered flows only below via drift)
assert.equal((await call('POST', '/v1/loans/house', { token: whale.token, body: { amount: 20000 } })).body.error, 'pool',
  'the house lends only what it holds — full-reserve, never a mint');
await pool.query(`UPDATE loan_house SET pool = ${hp2 + loanOwed(10000, LOAN.HOUSE_RATE)} WHERE id=1`); // undo the squeeze (keeps the §10.4 identity exact)

// DEFAULT: the sweep collects for the house — seize pocket+in-transit → the pool, welsher + WANTED
const dodger = await mk('Duck-out Doug');
await seedCh(dodger.id, 'respect=810');
r = await call('POST', '/v1/loans/house', { token: dodger.token, body: { amount: 10000 } });
assert.equal(r.code, 200, 'Doug takes a marker');
await pool.query(`UPDATE loans SET due_at = now() - interval '1 hour' WHERE borrower_character='${dodger.id}' AND status='active'`);
await seedCh(dodger.id, `cash=4000, bank=0, wanted_until=NULL`); // can only cover part — the pool eats the shortfall
const hp3 = await housePool();
const hsweep = await sweepLoans(pool);
assert.equal(hsweep.houseCollected, 1, 'the house collected');
assert.equal(await housePool(), hp3 + 4000, 'seized what there was — the shortfall is the pool\'s loss (bounded)');
const dougRow = await rawCh(dodger.id);
assert(dougRow.welsher, 'Doug is a welsher');
assert(dougRow.wanted_until && new Date(dougRow.wanted_until) > new Date(), 'and WANTED — the house always enforces');
assert.equal((await call('POST', '/v1/loans/house', { token: dodger.token, body: { amount: 5000 } })).body.error, 'welsher',
  'the window is closed to a welsher');
assert((await check('loan house pool')).ok, 'the pool reconciles after the seizure');

// ── §10.4: vocabulary closed (collateral is an ownership move, not currency — no new reasons) ──
const vocab = await check('reason vocabulary');
assert(vocab.ok, `loan:* rides the §10.4 vocabulary (${JSON.stringify(vocab.unknown || [])})`);
assert((await check('loan escrow')).ok, 'loan-escrow still reconciles after the step-two lifecycle');
// (car conservation is proven above by the seize being a row-MOVE with a stable COUNT — the §10.4
// invariant itself is confounded here by directly-seeded cars, the SQL-seeded-cash precedent.)

console.log('✅ test/loans.js — loan sharking (offer/take/repay/cancel/collect, welsher, sweep, death, §10.4) + STEP FIVE THE LOAN HOUSE (mod funding from the confiscation pool, the vig split feeding the window, level/floor/cap/welsher/one-debt gates, a pool-bounded take + a full repay cycle growing the pool, THE WALL (never lends past the pool), the sweep auto-collecting a default (partial seize, welsher + WANTED, the pool eats the bounded shortfall), and the loan-house-pool §10.4 check exact throughout)');
process.exit(0);
