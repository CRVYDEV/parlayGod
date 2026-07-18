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
