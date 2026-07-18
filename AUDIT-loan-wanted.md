# AUDIT — Loan Sharking step four (WANTED)

A three-lens max-effort red-team over the WANTED system (a loan default marks the borrower WANTED:
omertà stripped + a pool-funded player bounty + NPC bounty hunters + a "square your name" exit).
Lens 1: §10.4 / bounty-escrow integration. Lens 2: the headless `huntWanted` death path + locks.
Lens 3: omertà-strip + cross-system + economics. Every finding re-verified against the real code.
**Two confirmed defects fixed (a HIGH §10.4 drift + a MED pardon-trap), one LOW lock-order hardening;
five design-calls flagged.** Suite 20/20 + `node tools/sim.js` drift-0.

## Fixed in-commit (regression per fix)

### HIGH — §10.4: the HOUSE bounty refund corrupted the gang-treasuries check (CONFIRMED, reproduced)
The wanted pool bounty rides the (target,'kill') pot as a `'HOUSE'` contributor. When it refunds to the
confiscation pool (on `squareWanted` or an expiry `refundPot`), it was ledgered `bounty:refund` (NULL
character) — **byte-identical to a family-contract treasury refund**. Invariants check (b) *gang
treasuries* sums every NULL-character `bounty:refund` as treasury inflow, so each square/expiry drifted
it **−$25k** (empirically reproduced with zero gangs in the DB — structural, unbounded, and it would
*mask* a genuine treasury leak). The escrow check (c) was exact throughout; the bug was purely the
reason collision. **Fix:** the pool-destined refund now uses a DISTINCT reason `bounty:wanted:refund`
(still under the `bounty:` vocab prefix) — excluded from check (b)'s `treasuryRefunds`, added to check
(c)'s refunded term. Regression: `gang treasuries` asserted clean after a square (the missing assertion
that let it ship green), plus a new NPC-kill-burns-the-HOUSE-bounty test.

### MED — the square pardon lasted <1 tick for a sweep-marked welsher (CONFIRMED)
`squareWanted` cleared welsher+wanted+the bounty but did NOT settle the underlying loan. A borrower
marked by the *sweep* path (the loan stays `active` — unlike `collectLoan`, which sets `'collected'`)
who paid $50k to square was re-branded welsher+wanted with a fresh $25k bounty on the very next worker
tick, because the overdue sweep keys on a still-active overdue loan, not the welsher flag. **Fix:**
`squareWanted` now refuses while the actor has an active overdue loan (`overdue` error) — settle the debt
first (repay it or let the shark collect), THEN square your name. Regression: a sweep-marked welsher is
refused the square until the debt resolves.

### LOW — squareWanted lock-order hardening (F5)
`squareWanted` locked the `bounty_contributors` HOUSE row before the `bounties` pot — inverting the
pot→contributor order `refundPot`/`cancelBounty`/the expiry sweep use, an AB-BA that (though mapped to a
clean `contention` retry by `withCharacter`) is cleaner to eliminate. **Fix:** lock the pot first, then
the contributor — matching the established order, so a square can't cross-lock a concurrent expiry sweep.

## Max-effort concurrency pass — three lock/serialization defects (all fixed, regression-covered by the functional paths)
A fourth lens (real-Postgres lock cycles + §10.4 under concurrency) over the whole WANTED value path found
three defects the pg-mem suite cannot reproduce (single-connection, no row locks). Each is a global-lock-order
correction verified by reasoning; the functional paths they guard stay green.

### HIGH — §10.4: `runEstate`'s bounty burn read the pot un-locked → double-resolution drift (CONFIRMED)
The estate summed `bounties.amount` for the dying target **without a lock**, then ledgered `death:bounty −sum`
and DELETEd the pots. The expiry sweep (`sweepExpiredBounties → refundPot`) locks characters→pot and refunds
the same pot; run between the estate's un-locked SUM and its DELETE, **both** the estate's `death:bounty` burn
**and** the sweep's `bounty:refund` fire for the identical escrow → the escrow check (c) drifts by that pot.
The WANTED pool bounty (a live `HOUSE` pot with a 3-day expiry) makes this reachable on any wanted mark who
dies while their pot is expiring. **Fix:** lock the pot rows first with a plain `SELECT … FOR UPDATE` (Postgres
forbids `FOR UPDATE` on an aggregate) before the SUM — serializing with the sweep, which also locks
characters→pot, so no AB-BA and no double-resolution.

### MED — street_tax-before-pot AB-BA on every WANTED value path (CONFIRMED)
`postWantedBounty` originally locked `street_tax` before the `(target,'kill')` pot; `collectLoan` updated the
vig into `street_tax` and `squareWanted` paid the square into `street_tax` **before** the pot was locked. Any of
these racing a concurrent `postBounty`/`takeHouse` (pot→`street_tax`) on the same mark is an AB-BA
(pot↔singleton) — mapped to a clean `contention` retry, but a real cross-lock. **Fix:** all three now acquire
the pot (and, in `squareWanted`, the `HOUSE` contributor) `FOR UPDATE` **before** touching `street_tax`,
restoring the canonical characters→pots→singletons order the rest of the bounty code uses.

### MED — `sweepLoans` collateral-forfeit deadlocks with a borrower's estate (CONFIRMED)
The secured-forfeit pass locked **only** the loan row while `runEstate` (holding the dead borrower's character
lock) both DELETEs the pledged car (the estate wipe) and voids the loan. Cycle: the forfeit holds the loan lock
and wants to UPDATE the car the estate has deleted; the estate holds the car + borrower char and wants the loan
lock. **Fix:** the forfeit now locks the counterparty characters (sorted — the global order) **before** the
loan row, so it always blocks behind an in-flight death instead of cross-locking it; a paper-sale reassignment
between the unlocked pre-read and the lock is caught by a re-verify that skips the tick.

## Verified CLEAN (high-value negatives)
- **The escrow check (c)** is exact on EVERY wanted exit — post (`bounty:wanted`), player kill
  (`claimBounty` pays the whole pot incl the HOUSE share — the anti-self-pay filter never matches the
  `'HOUSE'` literal), NPC/mod kill (the estate burns it `death:bounty`), expiry + square refunds.
  pot.amount always equals the sum of contributor shares; the pool-guard returns before any write (never
  drives the pool negative); the idempotency guard prevents a double-post.
- **The headless `huntWanted` death path is sound** (lens 2): raw-SQL persist correct in all three
  branches (bodyguard/respawn/kill), the `{ id: null }` attacker is safe into `bodyguardAbsorbs` and the
  guard absorbs, the victim-shield gates (safehouse/witpro/pen/hole/hospital/jail) are a correct superset
  of npcHit's with the scan→lock TOCTOU closed, `h` context sufficient, locks per the global order, a
  40P01 rolls back clean (the mark is re-hunted next tick), the heir is born clean.
- **The omertà strip is correctly scoped** (lens 3): `isWanted` is OR'd INSIDE the same-gang condition in
  all four gates (fire/startSearch/npcHit/postBounty) — it can never enable a hit on a non-family target,
  and every independent gate (safehouse/witpro/pen/level/hospital) is untouched; `wanted_until` is loaded
  wherever `isWanted` reads it. Self-square only (no target param), persist-clobber-free, heir/season
  don't carry wanted, MAX_ACTIVE isn't bypassed by clearing welsher.

## FLAGGED for founder sign-off (NOT patched — ground rule #1)
- **F2 (MED) — alt-farm the pool bounty. MITIGATION ADDED (founder-requested), residual FLAGGED.** A
  lender+borrower+killer alt ring can manufacture a $25k HOUSE bounty (borrower defaults on purpose, a
  confederate kills them and collects the $25k from the confiscation pool). §10.4-clean (redistribution,
  never minted — the pool-guard returns before any write, so it can never drive the pool negative),
  friction-bounded (the borrower alt actually dies; the pool must hold ≥$25k; an NPC hunter or another
  player may kill first and BURN the bounty). **Mitigation shipped:** a borrower LEVEL FLOOR
  (`LOAN.WANTED_MIN_LVL` 10) on the CASH bounty only — a throwaway rookie alt earns no pool price on its
  ~$500 estate; the mark is still WANTED (omertà stripped + NPC hunters), just without a cash bounty. This
  imposes a real per-cycle cost: the borrower alt dies each cycle, so the farm must re-level a fresh
  level-10 alt every time (≈30–60 min of crime grind per $25k). **Residual (founder call, ground rule
  #1):** the floor raises but does not eliminate a determined, automated Sybil ring that mass-produces
  level-10 alts — no per-account cap fixes Sybil, and the two Sybil-proof options each have a cost:
  (a) fund the HOUSE pot from the defaulted **principal** instead of the pool — but a ring's principal
  stays inside the ring (the borrower keeps it on default), so it adds no real cost; (b) **remove** the
  auto pool bounty and rely on the lender opting into a self-funded welsher-hunt — but that walks back the
  "both hunter types" the founder chose. Recommend KEEP the level floor (raise `WANTED_MIN_LVL` if the
  farm is observed) and treat the residual as an accepted, §10.4-clean, bounded redistribution — the same
  posture the codebase takes on the fight-fix (Sybil-scalable, flagged not blocked) and referral farming.
- **F3 (LOW) — disproportionate for a small loan.** A defaulted $5k (`LOAN.MIN`) loan triggers the full
  WANTED apparatus + a $50k square (~10× the debt). Bounded by borrower consent + a cheaper repay path;
  a balance dial.
- **F4 (LOW) — the strip is lethal/contract-only; `jump` still blocks same-family.** A family member can
  fire/npcHit/contract a wanted mate but not perform the *lesser* non-lethal jump. Consistent with the
  pre-existing rat precedent (rat also never stripped `jump`); an odd "can kill, can't mug" asymmetry.
- **`WANTED_HUNT_P` 0.05/tick is worker-frequency-dependent** — a sign-off lever (the LAW_BUST_P
  precedent); tune with the real tick cadence.
- **Squaring clears the PERMANENT welsher mark** — a founder-approved change to the step-one "welsher is
  permanent" sign-off (the requested "square your name" route). Recorded in BALANCE.md.

## Result
Round one: HIGH §10.4 drift (HOUSE refund reason collision) + a MED pardon-trap fixed with regressions;
a LOW lock-order hardening. Max-effort concurrency pass: a HIGH estate/sweep §10.4 double-resolution
(pot burn now locked before the SUM), a MED street_tax-before-pot AB-BA across all three WANTED value
paths (pot locked before the singleton), and a MED forfeit-vs-estate deadlock (chars locked before the
loan). The alt-farm residual (F2) is mitigated by the founder-requested level floor and flagged as an
accepted, §10.4-clean, bounded redistribution. The death path, omertà strip, and escrow integration are
otherwise sound. Suite 20/20 + sim drift-0.
