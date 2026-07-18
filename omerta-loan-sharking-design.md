# Loan Sharking — the Shylock (design)

## 1. Why
The game has no player-to-player CASH primitive: trades move cars/goods/gear, but you can't put
money in another player's hands. Loan sharking adds exactly that — and wraps it in risk. A lender
fronts capital at usurious interest; a borrower takes it and must repay by a deadline; a **default**
is enforced — the shylock's people come collecting, and a welsher can't borrow again. It gives
peacetime muscle an economic purpose ("break his legs"), a new use for idle cash, and a genuine
credit market between players. Grounded in existing machinery: the bounty-escrow pattern (the offer
holds the principal like a pot), `withTwoCharacters` (repay/collect lock both sides), the loot-exposure
surface (collection reaches pocket + in-transit, never cleared bank), the streets feed, and the
`rat`/informant precedent for a bloodline-agnostic status mark (here, per-street).

## 2. Step one — the loop
Numbers live in the `LOAN` rules-tail block (founder sign-off levers).

- **Offer** (`POST /v1/loans` `{amount, rate, hours}`) — the lender ESCROWS `amount` from cash into an
  open offer (a §10.4 escrow-out `loan:offer`, the `bounty:post` pattern). `rate ≤ LOAN.RATE_MAX`
  (usurious cap), `LOAN.MIN ≤ amount ≤ LOAN.MAX`, `hours ≤ LOAN.TERM_MAX_H`. `GET /v1/loans` is the
  board (open offers + your active loans, both sides).
- **Take** (`POST /v1/loans/:id/take`) — a borrower takes an open offer: the principal moves from
  escrow to the borrower (`loan:take`), the loan goes `active`, `due_at = now + hours`, and the debt is
  `principal × (1 + rate)`. Gated: not the lender, not a **welsher**, under `LOAN.MAX_ACTIVE` active
  loans (no debt-stacking).
- **Repay** (`POST /v1/loans/:id/repay`, two-party) — the borrower pays `principal + interest` from
  cash → the lender, minus the house **vig** (`LOAN.VIG_BPS` → the buyback pool). §10.4: `loan:repay`
  (borrower − / lender +) is a transfer; `loan:vig` is the carved NULL-character sink (the market-take
  precedent). Loan `repaid`.
- **Cancel** (`POST /v1/loans/:id/cancel`) — the lender pulls an untaken offer; the escrow refunds
  (`loan:refund`, the `bounty:refund` pattern). Only an OPEN offer.
- **Collect** (`POST /v1/loans/:id/collect`, two-party) — after `due_at`, if unpaid, the lender
  collects by force: seize the borrower's POCKET + IN-TRANSIT cash (the loot-exposure surface — cleared
  bank is safe) up to the outstanding debt → the lender minus the vig (`loan:collect` + `loan:vig`);
  the shortfall is written off (the lender's real risk). The borrower is **leg-broken** (hospitalized
  `LOAN.COLLECT_HOSP_MS`) and marked a **welsher** — a per-street status that blocks new borrowing
  (dies with the man, like stats). The point: a defaulter banks their cash to dodge the seizure, but
  the welsher mark + the beating are the deterrent that makes repayment matter.

Worker: `sweepLoans` refunds EXPIRED open offers (`OFFER_TTL_MS`) to the lender and marks **overdue**
borrowers welsher (so defaulting is marked even before the lender collects). Death (`runEstate`): the
dead man's OPEN offers burn their escrow (`loan:death`, the `death:bounty` pattern — a dead lender's
cash is already zeroed); his ACTIVE loans (as lender or borrower) are voided (the principal already
moved — §10.4-neutral, just delete the row).

## 3. §10.4
- New cash reasons under a `loan:` prefix: `loan:offer` (escrow out), `loan:take` (escrow → borrower),
  `loan:refund` (cancel), `loan:repay` (transfer), `loan:collect` (transfer), `loan:vig` (NULL sink →
  pool), `loan:death` (escrow burn).
- **New invariant — loan escrow:** `SUM(principal WHERE status='open') == offered − taken − refunded −
  deathBurned` (the bounty-escrow twin). The vig is the only value that LEAVES the player economy (a
  sink to the pool, the buyback loop); everything else is a conserved transfer.
- A loan is a taxed transfer (the vig) with real default risk, so it can't be a free alt-funding rail
  the way an untaxed unlimited transfer would — and the sim's §10.4 sweep stays drift-0.

## 4. Why this shape
- **A real credit market** — usurious rates price default risk; lenders self-select trustworthy
  borrowers (or eat the loss), and the welsher mark is the reputation that makes the market function.
- **Muscle has a peacetime job** — collection is enforcement (the beating + the seizure), and a
  defaulter with a price on their pocket is a target.
- **Clean** — the offer is bounty-style escrow, repay/collect are `withTwoCharacters` transfers, the
  vig is the audited market-take sink; one new table, one new character flag, one new §10.4 check.

## 5. Step two (deferred — the roadmap)
- **Directed loans / trust lines** — offer to a named borrower only; recurring credit lines.
- **The auto-contract** — a defaulted debt seeds a kill/hospitalize contract on the welsher (funded
  from the lender's pocket, the family-contract pattern) so the whole town can collect the leg-breaking.
- **Debt trading** — sell an active loan (a claim) to another player (a secondary market).
- **Collateral** — escrow a car/gear against the loan, forfeit on default.

All numbers are founder sign-off levers — sim + sign-off into BALANCE.md before production.

## Step two — secured credit & enforcement (BUILT 2026-07-18)

The founder signed the step-one default-risk call "the lender vets their counterparties" — so step two
prices and enforces TRUST rather than protecting lenders retroactively. Three mechanics:

1. **Directed (trust-line) loans.** `POST /v1/loans {to}` names a borrower who alone can take the offer
   (`loans.offered_to`). The board hides a directed offer from outsiders (shown only to the lender + named
   borrower, flagged `forMe`); `takeLoan` throws `directed` for anyone else. This is the vetted-counterparty
   market made explicit — a lender extends credit to someone they trust, at terms of their choosing.

2. **Collateralized loans.** `POST /v1/loans {collateral}` requires the borrower to pledge a car worth
   ≥ that figure (its damage-adjusted book value, `carCollateralValue` = `carVal × (1 − dmg/100)`; capped at
   `LOAN.COLLATERAL_MAX` $5M). The borrower picks the car at `take {carId}`; it LOCKS (`cars.pledged`, the
   `cars.listed` escrow precedent — `findCar` and market-listing refuse a pledged car so melt/fence/repair/
   list can't dodge it; CHOP still values it). Repay (or the lender's death) unlocks it; a default
   `collectLoan` SEIZES it to the lender (ownership transfer, §10.4-neutral — cars conserve by row count).
   Secured lending lets credit cross trust gaps, priced up front — consensual, not retroactive protection.
   A dead borrower's pledged car dies with the fleet (collect before they die — "the debt dies with either
   party" applies to the collateral too).

3. **The welsher hunt.** `postBounty` waives the `DIRECTED_MIN` floor on a KILL contract on a WELSHER (the
   rat/vendetta-waiver twin). A defaulter's broken word makes them cheap to put a named gun on — a status
   consequence of the reputation mark, NOT a clawback (no money returns to any lender). Kill-only (a
   hospitalize pot keeps the floor). Unlike a rat, a welsher keeps family omertà (a lesser offense).

§10.4 is untouched (collateral is ownership, not currency; the welsher hunt moves no value). All numbers
(`COLLATERAL_MAX`, the waiver) are founder sign-off levers. Step three deferred: debt trading (selling the
paper — a secondary market), NPC lenders.

## Step two audit follow-up — the collateral auto-forfeit (BUILT 2026-07-18)

Closes the step-two audit's one MED (an overdue secured loan could freeze the borrower's car forever if
a spiteful/absent lender never collected). The worker sweep gains a third pass: a SECURED loan left
un-collected past `due_at + LOAN.GRACE_MS` (24h) auto-forfeits its collateral car to the lender and
resolves the loan. COLLATERAL-ONLY (the pledged car goes to the lender; no cash is seized — the lender
had the grace window to `collectLoan` cash+car manually, the borrower had it to repay). A pure ownership
move (§10.4-neutral); the sweep locks the loan (serializes vs a manual collect/repay), car+loan the only
writes. `LOAN.GRACE_MS` is a founder sign-off lever.

## Step three — the paper market (debt trading, BUILT 2026-07-18)

A secondary market for loan CLAIMS — the natural completion of the loan economy, and the sharpest
expression of "trust gets priced": a receivable's price reflects the borrower's creditworthiness.

- **Sell paper.** `POST /v1/loans/:id/sell {price}` — the current lender puts an ACTIVE loan's claim up
  for sale at an ask (`loans.for_sale`, bounded `PAPER_MIN..PAPER_MAX`). No escrow — a claim, not cash;
  the debt + collateral are untouched. `POST /v1/loans/:id/unsell` pulls it.
- **The board.** `GET /v1/loans` gains a `paper` section: every active loan for sale, with `owed`,
  `collateral`, `overdue`, and **`borrowerWelsher`** — so a buyer weighs the risk (a welsher's paper is
  worth far less than face). A collector with the muscle to enforce can buy risky paper cheap.
- **Buy paper.** `POST /v1/loans/:id/buy` — two-party (buyer + current lender). The buyer pays the ask
  minus `PAPER_TAKE_BPS` (2%) → the buyback pool, and BECOMES the new `lender_character`; the debt and
  any collateral carry over unchanged. A pure taxed cash transfer (the loan's principal/vig fire later
  on repay/collect, whoever holds it) — §10.4: `loan:paper` rows (buyer −price, seller +net, NULL take
  → pool), riding the existing `loan:` vocabulary; the loan-escrow check is untouched (paper is active
  loans, not open escrow). A borrower can't buy the paper on their own debt (`own_debt`).

`loan:paper` is a taxed transfer (the 2% take), so the secondary market isn't a free alt-funding rail.
Death needs no new handling (paper escrows nothing; a dead lender/borrower's loan voids, taking the
listing with it). `PAPER_TAKE_BPS` and the price bounds are founder sign-off levers.

## Deferred — NPC lenders (a house credit line) — needs a BACKED pool (§10.4)

An always-available house lender is valuable but is NOT a simple faucet: if the house MINTS cash to
lend, every borrower who defaults and keeps the money is a net inflation faucet (borrow → spend →
default → keep). To stay §10.4-clean it must lend from a BACKED, sink-funded pool (the Phase-4
stake-pool / vig-reserve pattern) — a `loan_house` singleton fed by real sinks (e.g. a slice of the
loan vig), lending as a TRANSFER from that bucket, bounded by its balance, defaults depleting it. That
is its own focused build (a tracked §10.4 bucket, funding, lending limits), deliberately NOT bundled
into step three. Flagged for a step-four decision.

## Step four — WANTED (the defaulter's pursuit, BUILT 2026-07-18)

Founder-directed: "punish defaulters — a hit put on them / become wanted." A default (a `collectLoan` OR
the overdue sweep) now marks the borrower WANTED for `LOAN.WANTED_MS` (3d), on top of the permanent
welsher mark (`characters.wanted_until`). Three teeth + an exit:

1. **Omertà stripped** — a WANTED mark is fair game even to their OWN family. `isWanted(target)` joins the
   rat exception in the `fire` / `startSearch` / `npcHit` / `postBounty` family gates.
2. **A pool-funded player bounty** — `postWantedBounty` fronts `WANTED_BOUNTY` ($25k) from the confiscation
   pool as a `'HOUSE'`-contributor share on the mark's (target,'kill') pot. Any player who kills them
   collects it through the existing `claimBounty` (the HOUSE share never locks a killer out). §10.4: pool →
   escrow ledgered `bounty:wanted` (NULL char; the bounty-escrow check gained the term); `refundPot`'s new
   `'HOUSE'` branch returns it to the pool on expiry; the estate burns it (`death:bounty`) on an NPC/mod
   kill; a player kill pays it out (`bounty:claim`). Guarded so it never drives the pool negative (if the
   pool can't front it, the mark is still WANTED, just with no cash price).
3. **NPC bounty hunters** — the worker's `huntWanted` sweep rolls `WANTED_HUNT_P` (0.05/tick, env-
   overridable) per wanted mark; a landed hit runs the estate with NO killer (no chop/loot/rep, the
   mod-kill precedent — the pool bounty burns). A safehouse / witpro / pen shield / hospital bed / lockup
   blocks the hunter that tick; a bodyguard or a pre-paid revive token absorbs the blow (the shields the
   mark paid for still hold — hide or square up).
4. **Square your name** (`POST /v1/loans/square`) — pay `SQUARE_COST` ($50k, a `loan:square` cash sink →
   pool) to clear WANTED **and** the welsher mark (borrow again) and refund the pool's bounty. This is the
   "square your name" route the step-one audit flagged as missing — a founder-approved change to the
   step-one "welsher is permanent" sign-off (defaulting is now recoverable, at a price).

All numbers (`WANTED_MS`, `WANTED_BOUNTY`, `WANTED_HUNT_P`, `SQUARE_COST`) are founder sign-off levers.
