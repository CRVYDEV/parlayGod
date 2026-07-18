# AUDIT — Loan Sharking (the Shylock), step one

A four-lens max-effort red-team over `src/loans.js` and every system it touches, run
immediately after the step-one build. Each lens was an independent agent; every finding
below was re-verified against the real code before any fix. Fixes are behavior-preserving
correctness/parity closes with a regression per fix; balance/design tensions are FLAGGED
for founder sign-off and NOT patched (ground rule #1). **Suite 20/20 + sim drift-0** after.

## Lenses
1. **§10.4 ledger discipline** — escrow reconciliation, the vig sink, collect's cash+bank
   spanning row, the death burn, the sweep refund.
2. **Concurrency / locks / persist-clobber** — two-party repay/collect lock order, the worker
   sweep, self-loan, estate-vs-settle races.
3. **Gameplay / economy exploits** — loot-proof vaults, alt collusion, welsher griefing, default EV.
4. **Cross-system** — death/estate, jail/Pen, hospitalization, safehouse/witpro, view/persist,
   worker, idempotency.

## Verified CLEAN (high-value negatives)
- **§10.4 conservation** — no drift in any of the seven traced categories. Every `open`-exit
  is ledgered (`loan:take`/`loan:refund`/`loan:death`/`loan:loot`); repay/collect are check-(a)
  transfers; voiding an ACTIVE loan mints/destroys nothing (principal already moved at take);
  the vig → pool matches the accepted `mod:confiscate`/`market:take` unreconciled-buffer pattern.
- **Locks** — no deadlock, no lock-order inversion. Every loan lock acquires a character (or the
  `street_tax` singleton) first: `characters → accounts → loans → gangs → singletons`. The loan row
  is always the last-acquired join point. repay-vs-collect on the same debt serialize on the two
  shared character rows before either reaches the loan → no double-settle. Estate-vs-settle always
  share a character lock acquired before the loan.
- **`welsher` round-trip** — characters load via `SELECT *`, so `ch.welsher` is always populated;
  `persistCharacter` writes it back. A welsher who acts keeps the mark (no clobber-to-false). The
  heir INSERT omits `welsher` → born clean (dies with the street, not account-carried).
- **All death paths** (fire/npcHit/shank/mod-kill) run `runEstate → voidLoansAtDeath`; a RICO
  bust is NOT death, so a busted borrower correctly keeps their loan + welsher-ability.
- **Idempotency + rate limiting** apply via the global `preHandler` hook — no per-route wiring
  needed, no double-settle from missing middleware. The worker sweep is `safe()`-isolated.
- **Rounding** — `toLender ≥ 0` always; `collected=0` is guarded; no degenerate mint.

## Fixed in-commit (correctness / parity; regression per fix)

### HIGH — loan-offer escrow was a loot-proof cash vault (the market-order hole, reopened)
Cash parked in an OPEN offer leaves `characters.cash` at post time and — before this fix — was
BURNED at the lender's death, so a fire-kill looted **nothing** of it. A whale could park their
whole liquid pile across offers (no offer-count cap; `MAX_ACTIVE` bounds only *borrowing*) and be
loot-immune while alive, then cancel to reclaim it — exactly the hole the prior audit already
closed for market buy-orders, reintroduced. **Fix (mirrors the signed `market:loot` precedent, no
new lever):** `offerLoan` is now safehouse-blocked (posting escrow while untargetable is the vault),
and `voidLoansAtDeath` on a PLAYER fire-kill loots `CASH_LOOT_RATE` (the existing signed Make-Risk-
Pay lever, unchanged) of the open escrow to the killer (`whack:loot` credit + a NULL `loan:loot`
escrow-side outflow), burning the remainder (`loan:death`). NPC/mod kills still burn the whole
escrow. The §10.4 loan-escrow check gained the `loan:loot` term (the `market:loot` twin). Regression:
a fire-kill loots 25% of a $200k offer to the killer, the rest burns, escrow reconciles.

### MED — `collectLoan` (and offer/take) had no jail / safehouse / hospital actor gate
A dead helper `const hospitalized = …` sat unused in the file — the author intended a gate and
dropped it. Every peer economic module gates the actor on `jailed`; the closest analog,
`shakedownBusiness` (a two-party seize-and-hospitalize), gates the actor on jailed + safeHoused +
hospitalized. `collectLoan` gated none — a jailed lender could leg-break a borrower from his cell,
a safehoused one from cover (violating P1.3 shield-not-bunker). **Fix:** `collectLoan` now gates the
actor on `jailed` + `safeHoused` + `hospitalized` (the shakedown set); `offerLoan`/`takeLoan` gate
`jailed` (no running a book / borrowing from lockup). The borrower is deliberately NOT shield-gated
— a civil debt recovery reaches a safehoused deadbeat (the shakedown precedent; see FLAGGED F2).
Regression: jailed can't offer/take/collect; safehoused can't offer/collect.

### LOW–MED — the worker sweep could brand a borrower who legitimately repaid after due
`repayLoan` has no due gate (paying late but before collection is legitimate). The sweep took an
unlocked snapshot of overdue borrowers then wrote `welsher` per-row — a borrower who repaid inside
that loop was still branded. **Fix:** one set-based `UPDATE` whose subquery re-derives the still-
`active`+overdue set at execution, so a squared debt keeps the name clean. Regression: repay-after-
due then sweep → not welsher.

### LOW — collect over-retained the in-transit loot marker
After seizing the in-transit slice, `bank_intransit` was re-clamped to `min(old, bank)` instead of
reduced by the seized amount, leaving now-cleared funds flagged lootable. **Fix:** subtract
`fromTransit` from the marker (then clamp). Not a §10.4 drift (the marker is in no bucket) — a
loot-exposure correctness nit. Covered by the collect regression's marker path.

### LOW — silent loss of claim on a counterparty's death (UX)
`voidLoansAtDeath` issued no notifications, so a lender's active claim vanished from the board with
no explanation (and a borrower wasn't told their debt was erased). **Fix:** it now notifies the
surviving counterparty (`loan_defaulted` to the lender / `loan_voided` to the borrower). Pure UX.

## FLAGGED for founder sign-off (NOT patched — ground rule #1)
- **First-loan-default is +EV for a throwaway/alt borrower.** The welsher mark gates only *future
  borrowing*; a borrower who banks the principal (cleared bank is a safe harbour) and defaults nets
  the principal for a 30-min hosp + a mark they don't value. The market self-corrects to trusted
  counterparties but the first lenders are burned. Options (welsher penalties beyond borrowing,
  partial bank recourse, collateral) are levers, not a silent retune. **This is the core balance call.**
  **→ SIGNED AS-IS 2026-07-18 (founder): "the lender vets their counterparties."** Default risk stays
  with the lender by design — loan-sharking is a trust market; the welsher mark is a reputation signal,
  not a clawback. No recourse/collateral added. Step-two debt-trading / trust-line loans become the
  way trust gets priced, not retroactive lender protection. Recorded in BALANCE.md.
- **Untaxed A→B collusion cash rail.** `take` moves escrow → borrower 1:1 with no house take (the
  vig is only on settlement); a never-settled loan is a free transfer. Cheaper than the 2%-taxed
  markets. A take-side take or same-IP flag is a founder lever.
- **Permanent welsher lockout with no "square your name" route.** The `takeLoan` error promises a
  squaring path that isn't implemented; only death clears the mark. Either build the paid squaring
  sink (a natural step-two mechanic) or accept the permanent lockout — a design call.
- **No per-target collect cooldown.** Short terms + no cooldown let a lender repeatedly hosp+brand a
  consenting borrower who fails to repay. Consent-bounded (LOW), but a cooldown is a lever.
- **Collect reaches a safehoused / witpro borrower** (F2). Consistent with the `shakedownBusiness`
  precedent (a non-lethal economic seizure gates only the actor + victim-hospitalization), but it
  diverges from `fire`/`npcHit` (which shield the victim). Is default-collection "civil" (reaches
  everywhere — the whole deterrent) or an "attack" (blocked by paid shields)? A founder call; the
  actor-side gate is fixed above regardless.
- **Killing your lender erases your debt** (F3). `voidLoansAtDeath` voids active loans on either
  party's death (§10.4-neutral, "dies with either party"). Borrow-max → get the lender killed → keep
  the cash is a moral-hazard loop braked only by the cost of arranging a kill. Consider whether the
  obligation should survive to the estate/pool.
- **Latent sweep coupling** — the sweep's dead-lender handling is correct only because `alive=false`
  is set exclusively inside `runEstate` alongside the open-loan burn. A future non-estate
  `alive=false` path (ban, soft-disable) would strand an open offer past the sweep with no burn →
  escrow drift. Worth a guard when such a path is added.
- **Collect blind-overwrites `hosp_until`** — can shorten a longer hospitalization. Matches the
  codebase-wide convention (no hosp-setter uses `max()`); flagged only if a global `max()` policy is adopted.

## Result
Five confirmed correctness/parity defects fixed with a regression each; eight balance/design tensions
flagged for founder sign-off. No §10.4 drift, no deadlock, no persist-clobber, no double-settle.
Suite 20/20 + `node tools/sim.js` drift-0.
