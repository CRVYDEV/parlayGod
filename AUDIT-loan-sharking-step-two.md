# AUDIT — Loan Sharking step two (secured credit & enforcement)

A three-lens max-effort red-team over the step-two additions — directed (trust-line) loans,
collateralized loans, and the welsher hunt — plus their interactions with the existing loan
system, the estate, the car economy, and §10.4. Each lens was an independent agent; every
finding re-verified against the real code before any fix. **Suite 20/20 + sim drift-0** after.

## Lenses
1. **Collateral mechanics** — pledge/lock/seize/release, car conservation, concurrency, valuation.
2. **Directed loans + the welsher hunt** — visibility/gate, omertà, dead-target offers, waiver correctness.
3. **Regression risk** — signature changes, schema widening, lock order, does step two break step one.

## Verified CLEAN (high-value negatives)
- **§10.4 car conservation** — collateral is a car, not currency. Seize is a pure `character_id`
  move (row count unchanged, no melt/fence/death row); repay/lender-death unlock only flip `pledged`;
  a dead borrower's pledged car is DELETEd by the estate wipe (`social.js:1227` — `cars` is in the
  wipe list) and counted once in `deathCars`. Traced all four exits: no drift.
- **Loan-escrow §10.4 check** — a directed and a secured offer are both `status='open'` rows with a
  principal, counted identically; collateral adds ZERO cash ledger rows. No new vocabulary.
- **The pledge-lock is airtight** — `findCar` (melt/fence/repair) + market-listing both refuse a
  pledged car; a pledged car can leave the borrower ONLY via repay, collect, or death. `collectLoan`
  can never seize a dangling car (a pledged car's only pre-collect exit is the borrower's death, which
  voids the loan → `no_loan`), so `carSeized` never lies.
- **Regression-clean** — `takeLoan`'s new `carId` arg is passed correctly by its sole caller
  (server.js route) in the right position; `voidLoansAtDeath`'s call site matches; every
  `INSERT INTO loans`/`cars` uses explicit columns (the new cols default); the board query is
  parameterized; no `SELECT … FOR UPDATE` on cars anywhere → the seize UPDATE is a leaf write with
  no lock cycle. No signature mismatch, no schema/positional break.
- **Persist-clobber / concurrency** — cars are separate rows (never written by persistCharacter); the
  in-memory `h.owned.cars` mutations are view-only, the SQL writes authoritative. Every owner-initiated
  car path runs under the owner's char lock, serializing pledge/melt/list/collect.
- **Valuation** — no route raises a car's `dmg` (only repair/favor set it to 0); collateral value can
  only RISE after pledge, so a borrower can't devalue the lender's security.
- **Directed take gate is authoritative** — `takeLoan` re-reads the loan `FOR UPDATE` and throws
  `directed` for anyone but the named borrower, independent of the board's visibility filter.
- **Welsher hunt §10.4-clean** — the waiver only skips the `directed_min` throw; the bounty cash flow
  (amt+fee+tax, escrow, take) is byte-identical whether it fired or not. No value moves.

## Fixed in-commit (LOW correctness/consistency; regression per fix)
### F2 — `collectLoan` pushed an incomplete STUB car into the lender's view
On a collateral seizure the lender's `h.owned.cars` got `{ id }` only — so the collect RESPONSE view
(`withTwoCharacters` returns `view(ch,…)`) rendered the seized car with null model/trim/dmg. **Fix:**
`SELECT * FROM cars` and push the full row (the market auction-settle precedent). Regression: the
collect response's garage shows the seized car with its real model. No §10.4/count effect (view-only).

### F3 — the armorer weekly favor bypassed the pledge repair-lock
`underworld.js` armorer favor filtered `!listed` but not `!pledged`, so a pledged collateral car could
be repaired via the favor — bypassing the escrow discipline `findCar` documents (melt/fence/**repair**
all refuse pledged iron). Benign to the lender (repair only raises collateral value) but inconsistent.
**Fix:** add `&& !c.pledged` to the favor's car filter, matching the existing `!listed` guard (the
same shape the market-skills-underworld audit used to close the listed-car version of this gap).

## FLAGGED for founder sign-off (NOT patched — ground rule #1)
- **F1 (MED) — an overdue secured loan can freeze the borrower's car indefinitely.** An active loan
  has no forced resolution: past due, the sweep only marks the borrower welsher; it never collects or
  releases. A spiteful lender who never collects leaves the pledged car locked (unmeltable/unsellable,
  a permanent garage slot) — the borrower's only cure is repaying in full. The borrower opted in
  (pledged the car) and can always repay, so it's not a §10.4/correctness bug, but a sweep-driven
  auto-forfeit (seize to the lender after a long grace) or an auto-release is a founder design call —
  it interacts with the still-open step-one "no square-your-name route" item.
- **Directed loans make the untaxed A→B collusion rail DETERMINISTIC** (MED). A lender directing an
  offer at their own alt guarantees only that alt can take it (no stranger can snipe it mid-air) — the
  step-one-flagged untaxed transfer becomes reliable. Bounded to ONE-SHOT per throwaway borrower by
  `MAX_ACTIVE=1` (and a collect claws it back). Same-account alt detection isn't feasible; the `own`
  check is correctly character-level. A take-side take or same-IP flag is the lever if it matters.
- **A welsher is a cheap ($500-floor) perpetual named-kill target** (LOW). The intended deterrent (the
  rat-waiver twin); NOT a squat (a directed kill pot pays whoever does the job, per the step-one F2
  fix). A grief incentive on a self-inflicted status — flagged for visibility.
- **Collateral seizure / directed loans bypass `GARAGE_CAP`** (LOW) — matches the market auction-win
  precedent (also cap-exempt); consistent, not a new leak.
- **F4 (accepted) — voidLoansAtDeath unlocks a live third party's car via SQL without holding its
  owner's lock** — benign and consistent with the established third-party-write precedent (bounty/
  market death-refunds do the same); Postgres row-locking serializes it, no drift.

## Result
Two LOW correctness/consistency defects fixed with a regression each; the three new mechanics are
mechanically sound and §10.4-clean (no drift, no deadlock, no persist-clobber, no lock cycle, no
signature/schema regression). Five items flagged for founder sign-off (one MED car-freeze, the rest
LOW/consistency). Suite 20/20 + `node tools/sim.js` drift-0.
