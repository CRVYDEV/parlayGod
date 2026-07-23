# AUDIT — THE MEGAPROJECT (founder pick #1) — focused three-lens red-team

Scope: `src/megaproject.js`, the `megaprojects`/`megaproject_contributions` schema, the
`MEGAPROJECT` rules block, the routes + skyline cache, the invariants vocabulary, the test suite.
Lenses: (A) §10.4/economy, (B) concurrency/locks/persistence, (C) exploit/grief/info-leak.
Every finding re-verified against source. **Verdict: no CRITICAL/HIGH/MED.**

## Verified CLEAN
- §10.4: `megaproject:cash` is a character_id'd burn (check (a) reconciles); `megaproject:omr`
  rides the audited `spendOmr` primitive + the omrBurns term; goods deletion is a non-currency
  ownership sink (the convoy/market precedent). Nothing mints; completion pays no currency; a
  completed wall takes no more bricks.
- Concurrency: the materialize race is the auction-F1 pattern (deterministic PK → 23505 →
  `contention` retry, confirmed in deadlockToRetry); crossing-completion under contention
  re-evaluates correctly (EvalPlanQual); zero persistCharacter clobber (cash/omr ride the
  canonical persist rails, cargo is DELETE+INSERT, project/plaque writes are absolute NUMERIC);
  lock order char → account → megaprojects-row is acyclic against every sibling.
- Exploit/info: no account-UUID leakage on any response; spam bounded by floors + rate buckets +
  idempotency; the build cannot be griefed (contributions only add, no refunds/escrow/death
  surface); the deliberately-ungated safehouse argument HOLDS (a burn is scorched-earth denial,
  not shelter — strictly value-negative, no P1.3/D2 wall weakened).

## Fixed in-commit (regression each)
- **A2** `giveGoods` coerced qty 0/negative/NaN into a silent 1-unit donation → now a clean
  `amount` refusal (reject, never coerce — the MIN_CASH/MIN_OMR posture).
- **C4** the design promises the plaque "forever" but only the Architect survived completion →
  `skylineOf` now carries each monument's top-8 plaque (names + tiers) permanently; console renders it.
- **C1** tie-handling was inconsistent (plaque positional vs `you.rank` competition-rank vs an
  invisible UUID tiebreak for the Architect) → `you.rank` now uses the SAME total ordering
  (contributed DESC, account_id ASC) as the plaque and the Architect pick.
- **C2** the "last known street" name fallback was doc-only → `nameAccounts` now resolves
  living street → `House <dynasty>` → `the late <last street>` (by generation).
- **B2** a completion with no living top-contributor street announced "an unknown hand" →
  the celebration line now falls back through `nameAccounts`.
- **B3** added `ix_megacontrib_top (project_id, contributed DESC)` for the plaque/rank reads.
- **A1 (accepted, documented)** fractional $OMR progress can leave a sub-dollar `need`; the final
  brick may pay ≤ $1 of dust — the ledger row always equals exactly what left the player, so
  §10.4 stays bit-exact (comment added at the clamp).

## Flagged for founder sign-off (NOT patched — ground rule #1; recorded in BALANCE.md)
- **C3** agents are not excluded from the plaque/Architect (every other status board excludes
  them; here the plaque is bought with burned value — inclusion may be intended).
- **C5** the goods rail has no $-value floor (1 cheap unit ≈ $40 vs the $100 cash floor) —
  a dust-spam dial if telemetry warrants.
- **B1 (accepted, norm-consistent)** pre-commit bus emits can announce a phantom milestone on a
  rolled-back txn — the established codebase-wide pattern, not unique to this module.

Suite 39/39 + sim drift-0 after all fixes.
