// LOAN SHARKING — the Shylock (design omerta-loan-sharking-design.md). The game's first player-to-
// player CASH primitive: escrowed offers (the bounty-pot pattern), a taken loan is a live debt, and a
// default is enforced (seize pocket + in-transit, a beating, the welsher mark). Every value movement
// is a §10.4-ledgered transfer; only the house vig leaves the economy (a sink → the buyback pool).
import crypto from 'node:crypto';
import { GameError, ledger, notify, bus, track } from './game.js';
import { LOAN, loanVig, loanOwed, M3, carCollateralValue } from './rules.js';

const uid = () => crypto.randomUUID();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();

// GET /v1/loans — the board: open offers (the market) + your active loans, both sides. Unlocked read.
// step 2: a DIRECTED offer (offered_to) is shown only to its named borrower + the lender; secured
// offers surface their collateral_min. Active loans surface any pledged collateral (both roles).
export async function loanBoard(pool, ch) {
  const offers = (await pool.query(
    `SELECT l.id, l.principal, l.rate, l.hours, l.collateral_min, l.offered_to, c.name AS lender, l.lender_character
       FROM loans l JOIN characters c ON c.id = l.lender_character
      WHERE l.status='open' AND (l.offered_to IS NULL OR l.offered_to=$1 OR l.lender_character=$1)
      ORDER BY l.offered_at DESC LIMIT 50`, [ch.id])).rows
    .map((r) => ({ id: r.id, principal: Number(r.principal), rate: Number(r.rate), hours: r.hours,
      owed: loanOwed(r.principal, r.rate), lender: r.lender, mine: r.lender_character === ch.id,
      collateralMin: Number(r.collateral_min) || 0, secured: Number(r.collateral_min) > 0,
      directed: !!r.offered_to, forMe: r.offered_to === ch.id }));
  const active = (await pool.query(
    `SELECT l.id, l.principal, l.rate, l.due_at, l.lender_character, l.borrower_character, l.collateral_car,
            lc.name AS lender, bc.name AS borrower
       FROM loans l JOIN characters lc ON lc.id=l.lender_character
       LEFT JOIN characters bc ON bc.id=l.borrower_character
      WHERE l.status='active' AND (l.lender_character=$1 OR l.borrower_character=$1)`, [ch.id])).rows
    .map((r) => ({ id: r.id, owed: loanOwed(r.principal, r.rate),
      role: r.lender_character === ch.id ? 'lender' : 'borrower',
      counterparty: r.lender_character === ch.id ? r.borrower : r.lender,
      collateral: !!r.collateral_car,
      dueSeconds: Math.ceil((new Date(r.due_at) - Date.now()) / 1000),
      overdue: new Date(r.due_at) <= new Date() }));
  return { offers, active, terms: { min: LOAN.MIN, max: LOAN.MAX, rateMax: LOAN.RATE_MAX, termMaxHours: LOAN.TERM_MAX_H, vigBps: LOAN.VIG_BPS } };
}

// POST /v1/loans — offer capital (escrow the principal, the bounty:post pattern). step 2: `to` names a
// borrower for a DIRECTED (trust-line) offer only they can take; `collateral` requires a car worth ≥ it.
export async function offerLoan(ch, body, client, h) {
  const amount = Math.floor(Number(body?.amount) || 0);
  const rate = Number(body?.rate);
  const hours = Math.floor(Number(body?.hours) || 0);
  const collateralMin = Math.max(0, Math.floor(Number(body?.collateral) || 0));
  if (jailed(ch)) throw new GameError('jailed', 'No running your book from a cell.');
  // audit (loot-proof vault): parking cash in an offer while safe-housed would be a loot-immune
  // vault (a killer can't reach escrow AND can't reach you) — the market order-post precedent.
  if (safeHoused(ch)) throw new GameError('safe', 'No fronting money from a safehouse — come out first.');
  if (amount < LOAN.MIN || amount > LOAN.MAX) throw new GameError('amount', `A loan is $${LOAN.MIN}–$${LOAN.MAX}.`);
  if (!(rate > 0) || rate > LOAN.RATE_MAX) throw new GameError('rate', `The vig runs up to ${Math.round(LOAN.RATE_MAX * 100)}%.`);
  if (hours < LOAN.TERM_MIN_H || hours > LOAN.TERM_MAX_H) throw new GameError('hours', `Terms run ${LOAN.TERM_MIN_H}–${LOAN.TERM_MAX_H} hours.`);
  if (collateralMin > LOAN.COLLATERAL_MAX) throw new GameError('collateral', `Collateral tops out at $${LOAN.COLLATERAL_MAX}.`);
  // directed (trust line): name a living borrower who alone can take it (not yourself)
  let offeredTo = null;
  if (body?.to) {
    if (body.to === ch.id) throw new GameError('own', "You can't lend to yourself.");
    const b = (await client.query('SELECT id FROM characters WHERE id=$1 AND alive', [body.to])).rows[0];
    if (!b) throw new GameError('no_borrower', 'No such borrower on the streets.');
    offeredTo = b.id;
  }
  if (Number(ch.cash) < amount) throw new GameError('cash', 'You can’t front what you don’t have.');
  ch.cash = Number(ch.cash) - amount;
  const id = uid();
  await client.query('INSERT INTO loans (id, lender_character, principal, rate, hours, status, offered_to, collateral_min) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, ch.id, amount, rate, hours, 'open', offeredTo, collateralMin]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -amount, reason: 'loan:offer' });
  if (offeredTo) await h.notify(client, offeredTo, 'loan_offered', { by: ch.name, principal: amount, rate, collateralMin });
  return { ok: true, id, principal: amount, owed: loanOwed(amount, rate), hours, directed: !!offeredTo, collateralMin };
}

// POST /v1/loans/:id/take — a borrower takes an open offer (escrow → borrower). step 2: a DIRECTED
// offer is takeable only by its named borrower; a SECURED offer requires pledging a car (carId) worth
// ≥ collateral_min — the car locks (`cars.pledged`) and is seized to the lender on default.
export async function takeLoan(ch, loanId, carId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No taking a loan from lockup.');
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.status !== 'open') throw new GameError('gone', 'That offer is off the table.');
  if (loan.lender_character === ch.id) throw new GameError('own', "You can't take your own money.");
  if (loan.offered_to && loan.offered_to !== ch.id) throw new GameError('directed', 'That offer is spoken for — it names another borrower.');
  if (ch.welsher) throw new GameError('welsher', 'Nobody lends to a welsher. Square your name first.');
  const active = Number((await client.query("SELECT COUNT(*) n FROM loans WHERE borrower_character=$1 AND status='active'", [ch.id])).rows[0].n);
  if (active >= LOAN.MAX_ACTIVE) throw new GameError('maxed', 'Clear the debt you have before taking another.');
  // secured offer: pledge a car worth ≥ collateral_min. Lock it (the market:listed precedent — the
  // row stays for car conservation; melt/fence/repair/list refuse a pledged car until the debt clears).
  let pledgedCar = null;
  if (Number(loan.collateral_min) > 0) {
    const car = (h.owned.cars || []).find((c) => c.id === carId);
    if (!car) throw new GameError('no_car', 'That offer wants collateral — pledge a car from your garage.');
    if (car.listed) throw new GameError('listed', "That car's on the block — cancel the listing before pledging it.");
    if (car.pledged) throw new GameError('pledged', 'That car is already pledged against another debt.');
    const val = carCollateralValue(car.model_id, car.trim_id, car.dmg);
    if (val < Number(loan.collateral_min)) throw new GameError('collateral', `The pledge must be worth $${Number(loan.collateral_min)} — that car books at $${val}.`);
    pledgedCar = car.id;
  }
  ch.cash = Number(ch.cash) + Number(loan.principal);
  const dueAt = new Date(Date.now() + loan.hours * 3600 * 1000);
  await client.query("UPDATE loans SET borrower_character=$2, status='active', due_at=$3, collateral_car=$4 WHERE id=$1", [loanId, ch.id, dueAt, pledgedCar]);
  if (pledgedCar) {
    await client.query('UPDATE cars SET pledged=true WHERE id=$1', [pledgedCar]);
    const c = h.owned.cars.find((x) => x.id === pledgedCar); if (c) c.pledged = true; // keep the view honest
  }
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: Number(loan.principal), reason: 'loan:take', counterparty: loan.lender_character });
  await h.notify(client, loan.lender_character, 'loan_taken', { by: ch.name, principal: Number(loan.principal), collateral: !!pledgedCar });
  return { ok: true, principal: Number(loan.principal), owed: loanOwed(loan.principal, loan.rate), collateral: !!pledgedCar, dueSeconds: Math.ceil((dueAt - Date.now()) / 1000) };
}

// POST /v1/loans/:id/cancel — the lender pulls an untaken offer (escrow refunds)
export async function cancelLoan(ch, loanId, client, h) {
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.lender_character !== ch.id) throw new GameError('no_loan', 'No such offer of yours.');
  if (loan.status !== 'open') throw new GameError('taken', 'That loan is already out — you can’t pull it.');
  ch.cash = Number(ch.cash) + Number(loan.principal);
  await client.query("UPDATE loans SET status='cancelled' WHERE id=$1", [loanId]);
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: Number(loan.principal), reason: 'loan:refund' });
  return { ok: true, refunded: Number(loan.principal) };
}

// POST /v1/loans/:id/repay — two-party: ch=borrower (actor), victim=lender. Borrower pays principal +
// interest; the lender is credited in-memory (persisted by withTwoCharacters); the vig → the pool.
export async function repayLoan(ch, lender, loanId, client, h) {
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.status !== 'active') throw new GameError('no_loan', 'No such debt to square.');
  if (loan.borrower_character !== ch.id) throw new GameError('not_yours', 'That debt isn’t yours.');
  if (loan.lender_character !== lender.id) throw new GameError('mismatch', 'The book doesn’t match.');
  const owed = loanOwed(loan.principal, loan.rate);
  if (Number(ch.cash) < owed) throw new GameError('cash', `Squaring it takes $${owed} in pocket.`);
  const vig = loanVig(owed), toLender = owed - vig;
  ch.cash = Number(ch.cash) - owed;
  lender.cash = Number(lender.cash) + toLender;
  await client.query("UPDATE loans SET status='repaid' WHERE id=$1", [loanId]);
  if (loan.collateral_car) { // square the debt → the pledged car comes home (unlock it)
    await client.query('UPDATE cars SET pledged=false WHERE id=$1', [loan.collateral_car]);
    const c = (h.owned.cars || []).find((x) => x.id === loan.collateral_car); if (c) c.pledged = false;
  }
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [vig]); // the house vig → the buyback pool
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -owed, reason: 'loan:repay', counterparty: lender.id });
  await h.ledger(client, { characterId: lender.id, currency: 'cash', amount: toLender, reason: 'loan:repay', counterparty: ch.id });
  await h.ledger(client, { currency: 'cash', amount: -vig, reason: 'loan:vig' }); // NULL-character sink (the market-take precedent)
  await h.notify(client, lender.id, 'loan_repaid', { by: ch.name, amount: toLender });
  return { ok: true, paid: owed, toLender, vig };
}

// POST /v1/loans/:id/collect — two-party: ch=lender (actor), victim=borrower. After due, seize the
// borrower's POCKET + IN-TRANSIT cash (cleared bank is safe) up to the debt, minus the vig; the
// shortfall is written off; the deadbeat is leg-broken (hospitalized) + marked a welsher.
export async function collectLoan(ch, borrower, loanId, client, h) {
  // collecting is offense (a seizure + a beating) — gate the actor exactly like shakedownBusiness,
  // the closest two-party seize-and-hospitalize analog: no leg-breaking from a cell, a safehouse
  // (P1.3 shield-not-bunker), or a hospital bed. The borrower is NOT shield-gated — a civil debt
  // recovery reaches a safe-housed deadbeat (the shakedown precedent gates only the actor + victim
  // hospitalization; here we let the shark collect even from a hospitalized mark, no dodge).
  if (jailed(ch)) throw new GameError('jailed', 'No collecting debts from a cell.');
  if (safeHoused(ch)) throw new GameError('safe', 'No shaking anyone down while you’re to ground.');
  if (hospitalized(ch)) throw new GameError('hurt', 'You’re in no shape to break legs.');
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.status !== 'active') throw new GameError('no_loan', 'No such debt to collect.');
  if (loan.lender_character !== ch.id) throw new GameError('not_yours', 'That’s not your book.');
  if (loan.borrower_character !== borrower.id) throw new GameError('mismatch', 'The book doesn’t match.');
  if (new Date(loan.due_at) > new Date()) throw new GameError('not_due', 'The debt isn’t due yet — give them their time.');
  const owed = loanOwed(loan.principal, loan.rate);
  const inTransit = Math.min(Math.floor(Number(borrower.bank_intransit || 0)), Math.floor(Number(borrower.bank)));
  const pocket = Math.floor(Number(borrower.cash));
  const collected = Math.min(owed, pocket + inTransit);
  const fromPocket = Math.min(collected, pocket);
  const fromTransit = collected - fromPocket;
  const vig = loanVig(collected), toLender = collected - vig;
  if (collected > 0) {
    borrower.cash = Number(borrower.cash) - fromPocket;
    borrower.bank = Number(borrower.bank) - fromTransit;
    // seizing from the in-transit slice clears exactly that much of the marker (else the now-cleared
    // remainder would stay flagged lootable — an over-exposure nit); clamp to the reduced bank.
    borrower.bank_intransit = Math.min(Number(borrower.bank_intransit || 0) - fromTransit, Number(borrower.bank));
    ch.cash = Number(ch.cash) + toLender;
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [vig]);
    // one row spans the borrower's cash+bank (check (a) is on cash+bank — the whack:loot precedent)
    await h.ledger(client, { characterId: borrower.id, currency: 'cash', amount: -collected, reason: 'loan:collect', counterparty: ch.id });
    await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: toLender, reason: 'loan:collect', counterparty: borrower.id });
    await h.ledger(client, { currency: 'cash', amount: -vig, reason: 'loan:vig' });
  }
  // step 2: a SECURED default forfeits the collateral — the car changes hands to the lender (a pure
  // ownership move; cars conserve by row count, so NO §10.4 row — the market/chop precedent). Keep
  // both in-memory garages honest so any view off this txn is right (the car is a separate row, not
  // persisted by persistCharacter — the SQL write is authoritative).
  let carSeized = null;
  if (loan.collateral_car) {
    await client.query('UPDATE cars SET character_id=$2, pledged=false WHERE id=$1', [loan.collateral_car, ch.id]);
    if (h.victimOwned?.cars) h.victimOwned.cars = h.victimOwned.cars.filter((c) => c.id !== loan.collateral_car);
    // push the FULL row into the lender's garage (the market auction-settle precedent) — a bare
    // {id} stub would render the seized car with null model/trim/dmg in this response's view.
    if (h.owned?.cars && !h.owned.cars.some((x) => x.id === loan.collateral_car)) {
      const row = (await client.query('SELECT * FROM cars WHERE id=$1', [loan.collateral_car])).rows[0];
      if (row) h.owned.cars.push(row);
    }
    carSeized = loan.collateral_car;
  }
  borrower.hosp_until = new Date(Date.now() + LOAN.COLLECT_HOSP_MS); // the leg-breaking
  borrower.welsher = true;                                          // marked — can't borrow again
  await client.query("UPDATE loans SET status='collected' WHERE id=$1", [loanId]);
  await h.notify(client, borrower.id, 'loan_collected', { by: ch.name, seized: collected, car: !!carSeized });
  bus.emit('streets', { type: 'welsher', who: borrower.name, by: ch.name });
  await track(client, ch.account_id, 'loan_collect', { seized: collected, shortfall: owed - collected, car: !!carSeized });
  return { ok: true, seized: collected, toLender, vig, shortfall: owed - collected, carSeized };
}

// runEstate hook — the dead man's loans. OPEN offers hold escrowed cash: on a PLAYER fire-kill
// (killerCh + lootRate>0) the killer LOOTS CASH_LOOT_RATE of it (whack:loot + a NULL loan:loot
// escrow-side outflow — parked capital is no longer a loot-proof vault, the market-order precedent);
// the rest BURNS (loan:death, the dead-funder pattern). NPC/mod kills pass 0 → the whole escrow burns.
// ACTIVE loans (as lender or borrower) void with no ledger (the principal already moved — §10.4-neutral);
// both sides are notified. Called inside the estate txn (victim + killer rows already locked).
export async function voidLoansAtDeath(client, victimId, h, killerCh = null, lootRate = 0) {
  const openEscrow = Number((await client.query(
    "SELECT COALESCE(SUM(principal),0) s FROM loans WHERE lender_character=$1 AND status='open'", [victimId])).rows[0].s);
  let looted = 0;
  if (openEscrow > 0) {
    const loot = killerCh && lootRate > 0 ? Math.floor(openEscrow * lootRate) : 0;
    if (loot > 0) {
      killerCh.cash = Number(killerCh.cash) + loot; // the killer is the in-memory actor — never SQL (persist clobber)
      looted = loot;
      await h.ledger(client, { characterId: killerCh.id, currency: 'cash', amount: loot, reason: 'whack:loot', counterparty: victimId });
      await h.ledger(client, { currency: 'cash', amount: -loot, reason: 'loan:loot', counterparty: victimId }); // escrow-side outflow
    }
    const burn = openEscrow - loot;
    if (burn > 0) await h.ledger(client, { currency: 'cash', amount: -burn, reason: 'loan:death', counterparty: victimId });
  }
  await client.query("DELETE FROM loans WHERE lender_character=$1 AND status='open'", [victimId]);
  // active loans void — tell the surviving counterparty why the row vanished (a lender loses a claim,
  // a borrower's debt is erased). The killer, if a counterparty, still gets the notification row.
  const active = (await client.query(
    "SELECT id, lender_character, borrower_character, collateral_car FROM loans WHERE (lender_character=$1 OR borrower_character=$1) AND status='active'", [victimId])).rows;
  for (const l of active) {
    if (l.lender_character === victimId && l.borrower_character) {
      // the debt dies with the lender: the surviving borrower keeps the principal AND their pledged
      // car comes home (unlock it — a third-party row, SQL not in-memory).
      if (l.collateral_car) await client.query('UPDATE cars SET pledged=false WHERE id=$1', [l.collateral_car]);
      await h.notify(client, l.borrower_character, 'loan_voided', { reason: 'lender_dead' });
    } else if (l.borrower_character === victimId) {
      // the borrower is dead: any pledged car dies with the fleet (the estate wipe) — nothing to unlock.
      await h.notify(client, l.lender_character, 'loan_defaulted', { reason: 'borrower_dead' });
    }
  }
  await client.query("DELETE FROM loans WHERE (lender_character=$1 OR borrower_character=$1) AND status='active'", [victimId]);
  return { looted };
}

// worker sweep — refund EXPIRED open offers to the lender, and mark OVERDUE borrowers welsher (so
// defaulting is recorded even before the lender collects). Per-loan txn, lock order characters → loans.
export async function sweepLoans(pool, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  let refunded = 0, welshed = 0;
  // expired offers
  const stale = (await pool.query(
    "SELECT id, lender_character FROM loans WHERE status='open' AND offered_at < $1 ORDER BY id",
    [new Date(now.getTime() - LOAN.OFFER_TTL_MS)])).rows;
  for (const { id, lender_character } of stale) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lender = (await client.query('SELECT id, cash FROM characters WHERE id=$1 AND alive FOR UPDATE', [lender_character])).rows[0];
      const loan = (await client.query("SELECT * FROM loans WHERE id=$1 AND status='open' FOR UPDATE", [id])).rows[0];
      if (!loan) { await client.query('ROLLBACK'); continue; }
      if (lender) { // a living lender gets the escrow back; a dead one's estate already burned it
        await client.query('UPDATE characters SET cash = cash + $2 WHERE id=$1', [lender_character, Number(loan.principal)]);
        await ledger(client, { characterId: lender_character, currency: 'cash', amount: Number(loan.principal), reason: 'loan:refund' });
      }
      await client.query("UPDATE loans SET status='cancelled' WHERE id=$1", [id]);
      await client.query('COMMIT'); if (lender) refunded++;
    } catch (e) { await client.query('ROLLBACK'); console.error('sweepLoans offer', id, e.message); }
    finally { client.release(); }
  }
  // overdue debts → the borrower is a welsher (a status write; no value moves). ONE set-based UPDATE
  // whose subquery re-derives the still-overdue set at execution (audit: a snapshot-then-loop could
  // brand a borrower who legitimately repaid — repay has no due gate — after `due_at` but before the
  // per-row write; scoping the write to a loan that is STILL active+overdue closes that TOCTOU).
  const r = await pool.query(
    `UPDATE characters SET welsher=true WHERE alive AND NOT welsher AND id IN (
       SELECT borrower_character FROM loans WHERE status='active' AND due_at < $1)`, [now]);
  welshed = r.rowCount;
  // audit F1: a SECURED loan left un-collected past due + GRACE_MS auto-forfeits its collateral car to
  // the lender — so an absent/spiteful lender can't freeze the borrower's car forever (the borrower
  // always had the grace to repay). COLLATERAL-ONLY: the car changes hands (a pure ownership move, no
  // cash, §10.4-neutral — cars conserve by row count), the loan resolves. The lender who also wanted
  // the cash had the grace window to collectLoan manually. Lock the loan (serializes vs a concurrent
  // manual collect/repay); the car + loan are the only writes (no character rows → no lock cycle).
  let forfeited = 0;
  const graceCut = new Date(now.getTime() - LOAN.GRACE_MS);
  const abandoned = (await pool.query(
    "SELECT id FROM loans WHERE status='active' AND collateral_car IS NOT NULL AND due_at < $1 ORDER BY id", [graceCut])).rows;
  for (const { id } of abandoned) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const loan = (await client.query("SELECT * FROM loans WHERE id=$1 AND status='active' FOR UPDATE", [id])).rows[0];
      if (!loan || !loan.collateral_car || new Date(loan.due_at) >= graceCut) { await client.query('ROLLBACK'); continue; }
      // the pledged car goes to the lender (it can only still be pledged to a LIVE active loan)
      const car = (await client.query('SELECT id FROM cars WHERE id=$1', [loan.collateral_car])).rows[0];
      if (car) await client.query('UPDATE cars SET character_id=$2, pledged=false WHERE id=$1', [loan.collateral_car, loan.lender_character]);
      await client.query("UPDATE loans SET status='collected' WHERE id=$1", [id]);
      await notify(client, loan.lender_character, 'loan_forfeited', { car: !!car });
      await notify(client, loan.borrower_character, 'loan_forfeited', { car: !!car, lost: true });
      await client.query('COMMIT'); forfeited++;
    } catch (e) { await client.query('ROLLBACK'); console.error('sweepLoans forfeit', id, e.message); }
    finally { client.release(); }
  }
  return { refunded, welshed, forfeited, offers: stale.length };
}
