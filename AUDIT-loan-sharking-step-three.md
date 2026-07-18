# AUDIT — Loan Sharking step three (the paper market)

A two-lens max-effort red-team over the paper market (debt trading — a lender sells an active loan's
claim to another player, who becomes the new lender for a 2% take → the pool) and its interactions.
Lens 1: §10.4 / concurrency / persist-clobber. Lens 2: cross-system + economic exploits. Both agents
traced the real code; findings re-verified. **No code bug found — the core is sound.** Two founder
design-calls flagged (ground rule #1); zero patches. **Suite 20/20 + sim drift-0** (unchanged).

## Verified CLEAN (both lenses, high-value negatives)
- **§10.4 check (a)** — `buyPaper`'s three rows (buyer −price, seller +net, NULL −take → pool) net to
  −take, matching the actual player-cash delta; the NULL take is the accepted unreconciled pool buffer
  (the `loan:vig`/`market:take` precedent). `paperTake` uses `ceil` → no sub-cent mint, `toSeller` never
  negative (`PAPER_MIN` 1 → worst case take 1, toSeller 0).
- **Loan-escrow check (f4) untouched** — paper trades are on `status='active'` loans and ledger
  `loan:paper` (none of offer/take/refund/death/loot); `for_sale` can never be set on an `open` offer
  (`sellPaper` + the route both require `active`). Provably unaffected.
- **Persist-clobber** — `buyPaper` mutates only `ch.cash` (buyer=actor) + `seller.cash` (=victim),
  both persisted by `withTwoCharacters`; raw SQL touches only `loans` + `street_tax`. The
  `lender_character` reassignment is authoritative (loans never written via character rows).
- **Concurrency** — two buyers serialize on the seller's char lock (winner reassigns + nulls
  `for_sale`; loser re-reads `gone`/`mismatch`). Buy-vs-repay/collect share the old-lender char lock →
  a borrower's repayment can never land on the old lender after a sale (stale repay throws `mismatch`,
  retries onto the new lender). Buy-vs-sweep-forfeit is acyclic (forfeit locks only the loan). Lock
  order unchanged (chars → loan → singleton). No double-buy, no double-resolve, no deadlock.
- **Collateral carryover** — after a paper sale the collateral stays pledged to the same borrower; a
  later `collectLoan` (car → `ch.id` = current lender = buyer) and the sweep auto-forfeit (car →
  `loan.lender_character` = buyer) both send it to the NEW lender. No path routes it to the old lender,
  no double-transfer.
- **Death** — a `for_sale` loan whose lender or borrower dies is voided (the listing vanishes with the
  row); paper escrows no cash, so voiding is §10.4-neutral; a pending buy on a voided loan gets `gone`.
  If the buy commits first, the buyer keeps the claim (the dead old-lender no longer matches).
- **Idempotency** — a re-executed buy hits `gone`/`own` (state-defended), no double-charge.
- **Self-dealing / directed × paper / price-manip** — the `own_debt` guard blocks buying your own debt;
  an alt buying-and-not-collecting still trips the `due_at`-keyed welsher sweep (no dodge); `offered_to`
  is dead metadata post-take (no leftover semantics break when the lender changes); a $1 paper sale to
  an alt still requires a REAL default to route a collateral car (the step-two GARAGE_CAP-bypass flag,
  not worsened). No new untaxed rail (paper is a proper 2% transfer, dearer than the step-two directed-
  default rail).

## FLAGGED for founder sign-off (NOT patched — ground rule #1; both DESIGN-CALLs, no code bug)
- **F1 (MED) — `buyPaper` has no safehouse gate, unlike `offerLoan`.** An ACTIVE lender claim is
  loot-immune (a fire-kill's `voidLoansAtDeath` voids active loans with no loot to the killer), so
  buying paper converts the buyer's lootable pocket cash into a loot-immune claim — and `offerLoan`
  blocks exactly this (parking cash un-lootably) while safehoused. **Assessment (why flagged, not
  patched):** (1) buying paper is a *purchase* — the cash goes to a LIVE, lootable seller, not into
  reclaimable escrow (the vault `offerLoan`'s gate exists to block); the game does NOT safehouse-gate
  buying cars/goods/assets, which likewise reduce pocket exposure. (2) The Make-Risk-Pay design
  *intends* wealth to be shelterable in safe harbours (cleared bank, staked $OMR, goods) — the loot
  only hits exposed pocket+in-transit. (3) The "shelter" is self-defeating: to shelter via an alt's
  paper you disperse cash across alts at 2%/hop and hold a claim you can only realize if the borrower
  has cash (an alt won't repay). So it touches a SIGNED Make-Risk-Pay surface and is a balance call,
  not a clear bug. **If the founder wants offerLoan-parity, it's a one-line `if (safeHoused(ch)) throw`
  in `buyPaper`.**
- **F2 (LOW) — the public paper board discloses the borrower's name/debt/welsher to everyone.** Inherent
  to a receivables market (buyers must price the borrower's creditworthiness), but it surfaces a
  previously-private *directed* loan's borrower once its paper is listed. A founder call on whether the
  board should anonymize borrowers (at the cost of the market's risk-assessment function).

## Result
Zero code defects — the paper mechanic is §10.4-clean, deadlock-free, persist-clobber-free, and its
collateral/directed/death/idempotency interactions are sound. Two design-calls flagged for founder
sign-off. Suite 20/20 + `node tools/sim.js` drift-0.
