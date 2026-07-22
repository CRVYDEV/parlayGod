// LOAN SHARKING — the Shylock (design omerta-loan-sharking-design.md). The game's first player-to-
// player CASH primitive: escrowed offers (the bounty-pot pattern), a taken loan is a live debt, and a
// default is enforced (seize pocket + in-transit, a beating, the welsher mark). Every value movement
// is a §10.4-ledgered transfer; only the house vig leaves the economy (a sink → the buyback pool).
import crypto from 'node:crypto';
import { GameError, ledger, notify, bus, track } from './game.js';
import { LOAN, loanVig, loanOwed, paperTake, M3, carCollateralValue, levelOf } from './rules.js';

const uid = () => crypto.randomUUID();
const hospitalized = (ch) => ch.hosp_until && new Date(ch.hosp_until) > new Date();
const jailed = (ch) => ch.jail_until && new Date(ch.jail_until) > new Date();
const safeHoused = (ch) => ch.safe_until && new Date(ch.safe_until) > new Date();
const isWanted = (ch) => ch.wanted_until && new Date(ch.wanted_until) > new Date();

// LOAN step 4 (WANTED): the underworld posts a WANTED_BOUNTY on a defaulter's head, funded from the
// confiscation pool. It rides the (target,'kill') pot as a `HOUSE`-contributor share — so any player
// who kills them collects it through the EXISTING claimBounty, refundPot returns it to the pool on
// expiry, and the estate burns it (death:bounty) on an NPC/mod kill. Idempotent (one price at a time).
// §10.4: pool → escrow, ledgered `bounty:wanted` (NULL char) — the bounty-escrow check gains the term.
async function postWantedBounty(client, targetId, h) {
  const already = (await client.query("SELECT 1 FROM bounty_contributors WHERE target_character=$1 AND kind='kill' AND contributor='HOUSE'", [targetId])).rows[0];
  if (already) return; // already has a standing price on their head
  // alt-farm mitigation (audit F2): no pool cash bounty on a low-level defaulter — a throwaway rookie
  // alt is the cheap farm fodder, and a $25k pool price on a ~$500-estate nobody is the +EV the farm
  // exploited. They're still WANTED (omertà stripped + NPC hunters); only the CASH price is gated.
  const tgt = (await client.query('SELECT respect FROM characters WHERE id=$1', [targetId])).rows[0];
  if (!tgt || levelOf(Number(tgt.respect)) < LOAN.WANTED_MIN_LVL) return;
  const bounty = LOAN.WANTED_BOUNTY;
  // lock the POT first, THEN street_tax — the canonical characters→pots→singletons order (postBounty/
  // refundPot/cancelBounty all lock the pot before touching street_tax). A street_tax-before-pot order
  // here would AB-BA every pot→takeHouse path (audit HIGH). The pool fronts the price — if it can't
  // cover it, the mark is still WANTED (omertà stripped + NPC hunters), just with no cash bounty.
  const pot = (await client.query("SELECT amount, expires_at FROM bounties WHERE target_character=$1 AND kind='kill' FOR UPDATE", [targetId])).rows[0];
  const poolRow = (await client.query('SELECT pool FROM street_tax WHERE id=1 FOR UPDATE')).rows[0];
  if (!poolRow || Number(poolRow.pool) < bounty) return; // never drive the confiscation pool negative
  const wantedExp = new Date(Date.now() + LOAN.WANTED_MS);
  if (pot) { // ride a player's existing kill pot — top it up, keep it live for the pursuit window
    const exp = pot.expires_at && new Date(pot.expires_at) > wantedExp ? new Date(pot.expires_at) : wantedExp;
    await client.query("UPDATE bounties SET amount=$2, expires_at=$3 WHERE target_character=$1 AND kind='kill'", [targetId, Number(pot.amount) + bounty, exp]);
  } else {
    await client.query("INSERT INTO bounties (target_character, kind, amount, posted_by, reason, expires_at) VALUES ($1,'kill',$2,'HOUSE',$3,$4)", [targetId, bounty, 'WANTED — welshed on a debt', wantedExp]);
  }
  await client.query("INSERT INTO bounty_contributors (target_character, kind, contributor, amount) VALUES ($1,'kill','HOUSE',$2)", [targetId, bounty]);
  await client.query('UPDATE street_tax SET pool = pool - $1 WHERE id=1', [bounty]);
  await h.ledger(client, { currency: 'cash', amount: -bounty, reason: 'bounty:wanted', counterparty: targetId });
}

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
    `SELECT l.id, l.principal, l.rate, l.due_at, l.lender_character, l.borrower_character, l.collateral_car, l.for_sale,
            lc.name AS lender, bc.name AS borrower
       FROM loans l JOIN characters lc ON lc.id=l.lender_character
       LEFT JOIN characters bc ON bc.id=l.borrower_character
      WHERE l.status='active' AND (l.lender_character=$1 OR l.borrower_character=$1)`, [ch.id])).rows
    .map((r) => ({ id: r.id, owed: loanOwed(r.principal, r.rate),
      role: r.lender_character === ch.id ? 'lender' : 'borrower',
      counterparty: r.lender_character === ch.id ? r.borrower : r.lender,
      collateral: !!r.collateral_car, forSale: r.for_sale != null ? Number(r.for_sale) : null,
      dueSeconds: Math.ceil((new Date(r.due_at) - Date.now()) / 1000),
      overdue: new Date(r.due_at) <= new Date() }));
  // step 3: the PAPER market — active loans the lender has put up for sale (a receivables market; a
  // buyer weighs the borrower's creditworthiness — owed, collateral, overdue, the welsher mark).
  const paper = (await pool.query(
    `SELECT l.id, l.principal, l.rate, l.due_at, l.for_sale, l.collateral_car, l.lender_character,
            lc.name AS lender, bc.name AS borrower, bc.welsher AS borrower_welsher
       FROM loans l JOIN characters lc ON lc.id=l.lender_character
       JOIN characters bc ON bc.id=l.borrower_character
      WHERE l.status='active' AND l.for_sale IS NOT NULL ORDER BY l.for_sale ASC LIMIT 50`)).rows
    .map((r) => ({ id: r.id, price: Number(r.for_sale), owed: loanOwed(r.principal, r.rate),
      lender: r.lender, borrower: r.borrower, mine: r.lender_character === ch.id,
      collateral: !!r.collateral_car, borrowerWelsher: !!r.borrower_welsher,
      dueSeconds: Math.ceil((new Date(r.due_at) - Date.now()) / 1000), overdue: new Date(r.due_at) <= new Date() }));
  return { offers, active, paper, terms: { min: LOAN.MIN, max: LOAN.MAX, rateMax: LOAN.RATE_MAX, termMaxHours: LOAN.TERM_MAX_H, vigBps: LOAN.VIG_BPS, paperTakeBps: LOAN.PAPER_TAKE_BPS } };
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
  // WANTED first: postWantedBounty locks the (target,'kill') pot BEFORE any street_tax, so the vig
  // update below re-locks the already-held singleton — keeping the canonical pots→singletons order
  // (a street_tax-before-pot collect would AB-BA a concurrent postBounty on the same mark, audit HIGH).
  // The marks are in-memory (persisted by withTwoCharacters).
  borrower.hosp_until = new Date(Date.now() + LOAN.COLLECT_HOSP_MS); // the leg-breaking
  borrower.welsher = true;                                          // marked — can't borrow again
  borrower.wanted_until = new Date(Date.now() + LOAN.WANTED_MS);     // WANTED: omertà stripped + hunted
  await postWantedBounty(client, borrower.id, h);                   // the underworld puts a price on their head
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
    await client.query('UPDATE cars SET character_id=$2, pledged=false, race_limit=NULL, pink_slip=false, nos=0 WHERE id=$1', [loan.collateral_car, ch.id]); // clear race flags on seizure (lender consent)
    if (h.victimOwned?.cars) h.victimOwned.cars = h.victimOwned.cars.filter((c) => c.id !== loan.collateral_car);
    // push the FULL row into the lender's garage (the market auction-settle precedent) — a bare
    // {id} stub would render the seized car with null model/trim/dmg in this response's view.
    if (h.owned?.cars && !h.owned.cars.some((x) => x.id === loan.collateral_car)) {
      const row = (await client.query('SELECT * FROM cars WHERE id=$1', [loan.collateral_car])).rows[0];
      if (row) h.owned.cars.push(row);
    }
    carSeized = loan.collateral_car;
  }
  await client.query("UPDATE loans SET status='collected' WHERE id=$1", [loanId]);
  await h.notify(client, borrower.id, 'loan_collected', { by: ch.name, seized: collected, car: !!carSeized, wanted: true });
  bus.emit('streets', { type: 'welsher', who: borrower.name, by: ch.name });
  await track(client, ch.account_id, 'loan_collect', { seized: collected, shortfall: owed - collected, car: !!carSeized });
  return { ok: true, seized: collected, toLender, vig, shortfall: owed - collected, carSeized, wanted: true };
}

// POST /v1/loans/:id/sell — step 3 (the paper market): the current lender puts this ACTIVE loan's
// CLAIM up for sale at an ask price. No escrow (a claim, not cash); the debt/collateral are untouched.
export async function sellPaper(ch, loanId, body, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No trading paper from a cell.');
  const price = Math.floor(Number(body?.price) || 0);
  if (price < LOAN.PAPER_MIN || price > LOAN.PAPER_MAX) throw new GameError('price', `A paper sells for $${LOAN.PAPER_MIN}–$${LOAN.PAPER_MAX}.`);
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.status !== 'active') throw new GameError('no_loan', 'No such debt to sell.');
  if (loan.lender_character !== ch.id) throw new GameError('not_yours', 'That’s not your book to sell.');
  await client.query('UPDATE loans SET for_sale=$2 WHERE id=$1', [loanId, price]);
  return { ok: true, price };
}

// POST /v1/loans/:id/unsell — the lender pulls the paper off the market (just clears the flag)
export async function unsellPaper(ch, loanId, client, h) {
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.lender_character !== ch.id) throw new GameError('not_yours', 'That’s not your book.');
  if (loan.for_sale == null) throw new GameError('not_listed', 'That paper isn’t on the market.');
  await client.query('UPDATE loans SET for_sale=NULL WHERE id=$1', [loanId]);
  return { ok: true };
}

// POST /v1/loans/:id/buy — two-party: ch=buyer (actor, the NEW lender), seller=current lender. The buyer
// pays the ask (minus PAPER_TAKE_BPS → the pool) and takes over the claim; debt + collateral unchanged.
// A pure taxed cash transfer (the loan's principal/vig fire later on repay/collect, whoever holds it).
export async function buyPaper(ch, seller, loanId, client, h) {
  if (jailed(ch)) throw new GameError('jailed', 'No buying paper from a cell.');
  const loan = (await client.query('SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId])).rows[0];
  if (!loan || loan.status !== 'active' || loan.for_sale == null) throw new GameError('gone', 'That paper is off the market.');
  if (loan.lender_character !== seller.id) throw new GameError('mismatch', 'The book doesn’t match.');
  if (loan.lender_character === ch.id) throw new GameError('own', 'You already hold that paper.');
  if (loan.borrower_character === ch.id) throw new GameError('own_debt', 'You can’t buy the paper on your own debt.');
  const price = Math.floor(Number(loan.for_sale));
  if (Number(ch.cash) < price) throw new GameError('cash', `That paper costs $${price}.`);
  const take = paperTake(price), toSeller = price - take;
  ch.cash = Number(ch.cash) - price;
  seller.cash = Number(seller.cash) + toSeller;
  await client.query('UPDATE loans SET lender_character=$2, for_sale=NULL WHERE id=$1', [loanId, ch.id]);
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [take]); // the house take → the buyback pool
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -price, reason: 'loan:paper', counterparty: seller.id });
  await h.ledger(client, { characterId: seller.id, currency: 'cash', amount: toSeller, reason: 'loan:paper', counterparty: ch.id });
  await h.ledger(client, { currency: 'cash', amount: -take, reason: 'loan:paper' }); // NULL-char take → pool (the market-take precedent)
  await h.notify(client, seller.id, 'paper_sold', { to: ch.name, price: toSeller });
  if (loan.borrower_character) await h.notify(client, loan.borrower_character, 'paper_transferred', { to: ch.name });
  return { ok: true, price, toSeller, take };
}

// POST /v1/loans/square — pay to square your name: clears WANTED (calls off the NPC hunters + the pool
// bounty, restores omertà) AND the welsher mark (borrow again). SQUARE_COST is a cash sink → the pool.
export async function squareWanted(ch, client, h) {
  if (!ch.welsher && !isWanted(ch)) throw new GameError('clean', 'Your name is already clean.');
  if (jailed(ch)) throw new GameError('jailed', 'Square your name when you get out.');
  // audit F1: settle the DEBT before you square the NAME — a still-active overdue loan (a sweep-marked
  // welsher, whose loan isn't 'collected') would have the sweep re-brand + re-post the bounty next tick,
  // making the $50k pardon last < 1 tick. Repay it (or let the shark collect) first, THEN clear your name.
  const stillOwed = (await client.query("SELECT 1 FROM loans WHERE borrower_character=$1 AND status='active' AND due_at < now()", [ch.id])).rows[0];
  if (stillOwed) throw new GameError('overdue', 'Settle the debt you welshed on first — repay it or let the shark collect. Then square your name.');
  const cost = LOAN.SQUARE_COST;
  if (Number(ch.cash) < cost) throw new GameError('cash', `Squaring your name runs $${cost}.`);
  // lock the POT (then the contributor) BEFORE any street_tax — the canonical characters→pots→
  // singletons order refundPot/cancelBounty/postBounty use, so a square can't AB-BA a concurrent
  // expiry sweep or postWantedBounty on the same pot (audit HIGH; the earlier F5 note only reordered
  // pot-vs-contributor, but the SQUARE_COST street_tax update below still sat BEFORE the pot lock).
  const pot = (await client.query("SELECT amount FROM bounties WHERE target_character=$1 AND kind='kill' FOR UPDATE", [ch.id])).rows[0];
  const house = (await client.query("SELECT amount FROM bounty_contributors WHERE target_character=$1 AND kind='kill' AND contributor='HOUSE' FOR UPDATE", [ch.id])).rows[0];
  ch.cash = Number(ch.cash) - cost;
  await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [cost]); // the payment → the buyback pool
  await h.ledger(client, { characterId: ch.id, currency: 'cash', amount: -cost, reason: 'loan:square' });
  // call off the pool's WANTED_BOUNTY — refund the HOUSE share to the pool, leaving any PLAYER share
  if (house) {
    const amt = Math.floor(Number(house.amount));
    await client.query("DELETE FROM bounty_contributors WHERE target_character=$1 AND kind='kill' AND contributor='HOUSE'", [ch.id]);
    if (pot) {
      const rest = Number(pot.amount) - amt;
      if (rest > 0) await client.query("UPDATE bounties SET amount=$2 WHERE target_character=$1 AND kind='kill'", [ch.id, rest]);
      else await client.query("DELETE FROM bounties WHERE target_character=$1 AND kind='kill'", [ch.id]);
    }
    await client.query('UPDATE street_tax SET pool = pool + $1 WHERE id=1', [amt]);
    // DISTINCT reason (not plain bounty:refund) so the pool-destined refund doesn't drift the
    // gang-treasuries check (b), which counts NULL bounty:refund as a family-contract refund (audit HIGH).
    await h.ledger(client, { currency: 'cash', amount: amt, reason: 'bounty:wanted:refund', counterparty: ch.id });
  }
  ch.welsher = false;
  ch.wanted_until = null;
  return { ok: true, cost, cleared: true };
}

// runEstate hook — the dead man's loans. OPEN offers hold escrowed cash: on a PLAYER fire-kill
// (killerCh + lootRate>0) the killer LOOTS CASH_LOOT_RATE of it (whack:loot + a NULL loan:loot
// escrow-side outflow — parked capital is no longer a loot-proof vault, the market-order precedent);
// the rest BURNS (loan:death, the dead-funder pattern). NPC/mod kills pass 0 → the whole escrow burns.
// ACTIVE loans (as lender or borrower) void with no ledger (the principal already moved — §10.4-neutral);
// both sides are notified. Called inside the estate txn (victim + killer rows already locked).
export async function voidLoansAtDeath(client, victimId, h, killerCh = null, lootRate = 0, heirId = null) {
  // LOCK the open offers, then sum over the LOCKED set (the bounty-sweep precedent, social.js) — takeLoan
  // locks the loan row FOR UPDATE but NOT the lender's character, so it doesn't serialize with the estate
  // on the char lock; without this lock a concurrent open→active take could be counted in openEscrow here
  // AND kept by the borrower (double-resolution: the escrow check drifts −principal and loot mints cash).
  // FOR UPDATE re-evaluates status='open' under the lock, so a just-committed take is excluded and an
  // in-flight one blocks until this estate txn deletes the row (the take then finds no row → 'gone').
  const openRows = (await client.query(
    "SELECT principal FROM loans WHERE lender_character=$1 AND status='open' FOR UPDATE", [victimId])).rows;
  const openEscrow = openRows.reduce((a, r) => a + Number(r.principal), 0);
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
  let inherited = 0;
  for (const l of active) {
    if (l.lender_character === victimId && l.borrower_character) {
      // SIGN-OFF (Tier 4): THE DEBT SURVIVES. Killing your lender no longer wipes what you owe — the
      // receivable (and any pledged collateral) passes to the lender's HEIR, who can still collect.
      // §10.4-neutral (no money moves; the claim + the pledge just change hands — the principal already
      // moved at take-time). No heir (a lender who somehow dies without one) falls back to voiding.
      // ORDERING NOTE (R37): runEstate calls voidLoansAtDeath (loot-before-stake) BEFORE it INSERTs the heir
      // character row, so this reassigns lender_character to an id whose row doesn't exist yet in the txn —
      // safe TODAY because the schema declares no FK on lender_character (the row is created a few lines
      // later in the SAME txn, so the committed state is consistent). If an FK on loans.lender_character is
      // ever added, this reassignment must move to AFTER the heir INSERT (split voidLoansAtDeath's loot pass
      // from its inherit pass), or the estate txn will FK-fail here.
      if (heirId) {
        await client.query('UPDATE loans SET lender_character=$2 WHERE id=$1', [l.id, heirId]);
        await h.notify(client, l.borrower_character, 'loan_inherited', { reason: 'lender_dead' });
        inherited++;
      } else {
        if (l.collateral_car) await client.query('UPDATE cars SET pledged=false WHERE id=$1', [l.collateral_car]);
        await h.notify(client, l.borrower_character, 'loan_voided', { reason: 'lender_dead' });
      }
    } else if (l.borrower_character === victimId) {
      // the borrower is dead: the claim is uncollectable, any pledged car dies with the fleet (the estate wipe).
      await h.notify(client, l.lender_character, 'loan_defaulted', { reason: 'borrower_dead' });
    }
  }
  // delete only the loans that did NOT survive: borrower-dead actives (+ any no-heir lender-dead actives).
  // The heir-reassigned loans now carry the heir as lender_character, so this predicate no longer matches them.
  await client.query("DELETE FROM loans WHERE (lender_character=$1 OR borrower_character=$1) AND status='active'", [victimId]);
  return { looted, inherited };
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
  // overdue debts → the borrower is branded a welsher AND goes WANTED (the underworld posts a pool
  // bounty on their head). Per-borrower txn so the bounty posts atomically; each re-checks under the
  // character lock that a STILL-active overdue loan exists (audit TOCTOU: repay has no due gate, so a
  // borrower who squared up after `due_at` but before this pass must keep a clean name).
  const overdue = (await pool.query(
    "SELECT DISTINCT borrower_character FROM loans WHERE status='active' AND due_at < $1", [now])).rows;
  for (const { borrower_character } of overdue) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query('SELECT id, welsher FROM characters WHERE id=$1 AND alive FOR UPDATE', [borrower_character])).rows[0];
      const still = b && (await client.query("SELECT 1 FROM loans WHERE borrower_character=$1 AND status='active' AND due_at < $2", [borrower_character, now])).rows[0];
      if (!b || b.welsher || !still) { await client.query('ROLLBACK'); continue; }
      await client.query('UPDATE characters SET welsher=true, wanted_until=$2 WHERE id=$1', [borrower_character, new Date(now.getTime() + LOAN.WANTED_MS)]);
      await postWantedBounty(client, borrower_character, { ledger });
      await client.query('COMMIT'); welshed++;
    } catch (e) { await client.query('ROLLBACK'); console.error('sweepLoans welsher', borrower_character, e.message); }
    finally { client.release(); }
  }
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
      // Lock the counterparty characters (sorted, the global order) BEFORE the loan row. runEstate holds
      // the dead borrower's char lock while it both DELETEs the pledged car (the estate wipe) and voids
      // the loan — so a forfeit that grabbed the loan lock first would deadlock (it wants the car the
      // estate deleted; the estate wants the loan lock we hold). Chars→loan keeps us behind any death.
      const pre = (await client.query("SELECT lender_character, borrower_character FROM loans WHERE id=$1 AND status='active'", [id])).rows[0];
      if (!pre) { await client.query('ROLLBACK'); continue; }
      for (const cid of [pre.lender_character, pre.borrower_character].filter(Boolean).sort())
        await client.query('SELECT 1 FROM characters WHERE id=$1 FOR UPDATE', [cid]);
      const loan = (await client.query("SELECT * FROM loans WHERE id=$1 AND status='active' FOR UPDATE", [id])).rows[0];
      if (!loan || !loan.collateral_car || new Date(loan.due_at) >= graceCut) { await client.query('ROLLBACK'); continue; }
      // a paper sale can reassign lender_character between the unlocked pre-read and the lock — if the
      // counterparties moved under us, skip this tick (the next sweep re-reads; 24h grace has many ticks)
      if (loan.lender_character !== pre.lender_character || loan.borrower_character !== pre.borrower_character) { await client.query('ROLLBACK'); continue; }
      // the pledged car goes to the lender (it can only still be pledged to a LIVE active loan)
      const car = (await client.query('SELECT id FROM cars WHERE id=$1', [loan.collateral_car])).rows[0];
      if (car) await client.query('UPDATE cars SET character_id=$2, pledged=false, race_limit=NULL, pink_slip=false, nos=0 WHERE id=$1', [loan.collateral_car, loan.lender_character]); // clear race flags on forfeit (lender consent)
      await client.query("UPDATE loans SET status='collected' WHERE id=$1", [id]);
      await notify(client, loan.lender_character, 'loan_forfeited', { car: !!car });
      await notify(client, loan.borrower_character, 'loan_forfeited', { car: !!car, lost: true });
      await client.query('COMMIT'); forfeited++;
    } catch (e) { await client.query('ROLLBACK'); console.error('sweepLoans forfeit', id, e.message); }
    finally { client.release(); }
  }
  return { refunded, welshed, forfeited, offers: stale.length };
}
