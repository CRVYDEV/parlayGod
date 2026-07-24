# AUDIT — the deep-system deferred four (Estate 2 · Commission 3 · Loan House · Ring+Bracket)

**Date:** 2026-07-24 · **Scope:** the four deferred-system drops on
`omerta-deep-deferred-design.md` — Estate step two (staff/gala/leaderboard), Commission step three
(proposals + the levy), the Loan House (Shylock step five), and Casino step five (ring poker + the
bracket), plus every file they touch.

**Method:** a six-lens ultracode red-team workflow (finder lenses: Estate econ/§10.4, Commission,
Loan House, ring state-machine, ring concurrency/bracket, cross-system exploit) — 34 raw findings.
The 2-refuter verify phase **aborted mid-run on a model-credit limit** (42 of 74 agents errored), so
the workflow's auto-`confirmed`/`rejected` split was unreliable: every finding whose verifiers
crashed defaulted into `rejected`, INCLUDING several HIGH §10.4 items. **I re-verified all
crashed-unverified findings by hand against source** before deciding each. Suite 43/43 + sim drift-0
after all fixes.

**Result: no CRITICAL. Two HIGH §10.4 drifts (both in the new ring/bracket code) found + fixed with
regressions; six MED/LOW correctness fixes; a doc-drift fix; the balance items flagged.**

---

## Fixed in-commit (regression where a test could pin it)

| Sev | System | Defect | Fix |
|-----|--------|--------|-----|
| **HIGH** | Ring | `dealHand` calls `enforceDeadline`, which can RESOLVE a prior stalled hand (setting `t._rake` + distributing the pot), then the `if (t.street)` guard is false so it deals a fresh hand and persists **without `settleFinish`** — the resolved hand's rake never hits `casino:ring:take`, so the ring-escrow §10.4 identity drifts by the un-ledgered rake **on COMMIT**. | `settleFinish` now runs right after `enforceDeadline` in `dealHand` (no-op when nothing resolved). **Regression:** a heads-up table where a stall is resolved by the next deal — the take is ledgered + escrow reconciles. |
| **HIGH** | Bracket | A runner who dies mid-bracket burns their stake (`casino:tourney:death`) in a NON-terminal round, but the bracket COMMITS still `status='open'` with its pool UNCHANGED — the `poker tourney escrow` check counts the open pool, so it drifts by the burned buy-in for the life of the bracket. | The death loop now reduces the pool to match the burns (an ABSOLUTE write — the pg-mem `pool = pool - $n` arithmetic quirk mis-evaluated to a negative), and the final reads the reduced `poolNow`. **Regression:** an 8-runner bracket with a mid-flight death — pool drops by the burn, escrow exact at the open state. |
| MED | Ring | `leaveTable`: if a departing player was NOT the acting seat, `advance()` never ran, so a leave that drops the table to one live player didn't resolve the hand — the survivor's win stalled until the clock folded THEM and burned their rightful pot as `casino:ring:death`. | Added the last-man-standing catch (`live.length <= 1 → finishHand`) that `wipeRingAtDeath` already had. |
| MED | Bracket | A final with zero live runners (all died) crashed on `ranked[0]` — the tournament froze `open` forever with escrow locked. | Guard: an empty final settles `resolved` (the pool was fully burned by the death reductions). |
| MED | Commission | `settleProposals` refunds an enacted motion to a gang dissolved between the unlocked `LEFT JOIN` and the lock — `commission:refund` is ledgered (crediting a ghost) while the treasury UPDATE affects 0 rows → treasury §10.4 drift. | Re-verify each proposer gang EXISTS under the `FOR UPDATE` lock; a dissolved winner forfeits instead (the dead-funder precedent). |
| MED | Worker | The buyback's family split (incl. THE LEVY) credits a payee gang dissolved between the unlocked ranking read and the lock — the `omr_reserve` UPDATE affects 0 rows but `distributed` still counts the share, so `bought` $OMR silently leaves the buckets. | Keep only payees whose row exists under the lock; a dropped share rolls to the event fund. |
| MED | Estate | `payStaffWages` on a walked house runs `resolveWalk` (DELETE staff) then THROWS `walked` — `withCharacter` rolls the DELETE back, so on real Postgres the walk never commits (the board shows stale staff + a payable `owed` forever). | The walked-empty case now RETURNS a benign `{ ok, walked }` so the walk COMMITS. Regression updated. |
| MED | Estate | `attendGala`'s `gala_best` monotonic bump (a guest's session) is clobbered by any concurrent host estate action rewriting the whole row absolutely from a stale `loadEstate` snapshot. | `upsertEstate` writes `gala_best = GREATEST(estates.gala_best, $9)` so a concurrent turnout isn't rolled back. |
| LOW | Estate | `attendGala` missing the design's "not in lockup" gate — a jailed character could attend a gala across the city. | Added the `jailed(ch)` gate. |
| LOW | Estate | `attendGala`'s bare `catch { throw 'attended' }` turned ANY insert failure (a transient serialization error) into a false "already attended" 400. | Only a genuine `23505` dup → `attended`; other errors rethrow (the standard-catch discipline). |
| LOW | Commission | Veto-vs-settle: `settleProposals` uses `tallyWinner` (which ignores the veto), so a vetoed decree's proposal REFUNDED — contradicting the design ("a deadlock/veto forfeits all"). | The governed week's veto now nulls the winner (forfeit all). |
| LOW | Worker | THE LEVY weights used `chamber.length − i` instead of the canonical `COMMISSION.SEATS − i`, giving a different head/tail ratio on a partial chamber than the votes use. | Aligned to `COMMISSION.SEATS − i` (the castVote weight). |
| LOW | Worker | `gala_guests` accumulated forever (no retention). | Added a 7-day worker sweep (the chat/duel-log precedent). |
| doc | Estate | The design doc referenced a nonexistent `STAFF_CAP_MS` (14d); owed is bounded by the 7d walk window. | Design doc corrected. |

## Flagged for founder sign-off (NOT patched — ground rule #1; in BALANCE.md)

- **Estate walk economics** — letting the staff walk (cost: one rehire fee ≈ 10× daily wage) is
  strictly cheaper than continuous wages beyond ~10 days, so the "recurring" $OMR sink floors at the
  rehire fee for a player who only staffs before a gala. Dials: the `hireOmr` multiple, arrears
  surviving as a lien, or wages accruing while listed on the leaderboard.
- **Commission levy self-deal + proposal agenda-control** — a $100k proposal is refunded on enactment
  (a near-free lever) that both LOCKS the ballot to proposed decrees AND, for `the_levy`, redirects
  the buyback family cut to the seated chamber including the proposer. Bounded by the public vote +
  the seasonal seat formula; a levy-cadence cap is the dial if it becomes the permanent decree.
- **Last-second proposal sniping** — a proposal landing just before the week freezes discards the
  chamber majority's votes for unproposed decrees at ~zero net cost. Intended leverage vs. abuse is a
  design call.
- **Loan-house death cycle** — a lvl-3 alt borrows the per-level cap, extracts, and dies; the heir
  repeats. Pool-bounded (the house lends only what sinks funded) and welsher/WANTED-marked, but a
  recurring net drain vs. vig inflow. `HOUSE_MIN_LVL` + the cap are the dials.
- **Ring chip-dumping / soft-play** — dumping via fold-to-raise is NOT a cheaper transfer rail (raked
  ≥3%, worse than the 2% audited rails), but out-of-band soft-play collusion against a
  non-colluding mark is unpreventable server-side (the poker reality; the rake taxes it).

## Verified CLEAN (spot-checks)

- The `sitAt` "seated at two tables" race the finder hypothesized is PREVENTED by `withCharacter`'s
  character-row lock (one action per character at a time), not the table lock — a non-defect.
- The ring escrow identity (`Σ stacks + Σ pots == sit − leave − take − death`) holds at every
  terminal path (showdown, fold-win, all-dead, leave-mid-hand, death) — asserted throughout
  `test/ring.js` and after both HIGH fixes.
- The bracket escrow identity (`posted == wins + take + death`) holds at the terminal + at the
  open mid-death state (the new regression).
- The Loan House pool identity + the full-reserve wall + the commission-escrow check all reconcile
  in their suites after the fixes.
