# AUDIT — THE POPULATION (steps one + two)

**Scope:** `src/population.js` (spawn / retire / top-up / behaviours), the `is_npc` / `npc_flag`
exclusions across `emission.js` · `standing.js` · `ops.js` · `growth.js`, the `runEstate` heir
inheritance, and every system a resident now transacts with (bodyguards, duels, the fade board, the
Shylock, the Black Market).

**Lenses:** §10.4 / faucet accounting · concurrency + lock order · exploit / grief · cross-system
consistency.

**Result: no CRITICAL, no HIGH, no §10.4 drift.** Four findings fixed in-commit (regression each),
one measurement corrected, one item flagged for founder sign-off.

---

## Fixed in-commit

### F1 (MED) — residents undercut the signed bodyguard floor

`residentAct` writes `guard_price` / `fade_limit` / `duel_limit` by **direct SQL**, which bypasses
`offerBodyguard` / `listDuel` / `setFadeLimit` — and with them every bound those routes enforce.
`hireBodyguard` trusts the offer route and never re-validates the price.

The sharp one is the bodyguard. Phase 1.3 deliberately repriced `M3.BODYGUARD_MIN_PRICE`
**1000 → 10000** for safehouse parity: a bodyguard absorbs one lethal `fire`/`npcHit`, and that
shield is priced to matter. Residents were offering the same one-bullet shield at **12% of their
cash**, gated only by a population-local floor of $250 — so a player could buy a lethal-hit absorb
for a few hundred dollars. That silently undercuts a signed Make-Risk-Pay lever by up to ~40×, in
the same session the L3a/L3b/L3c package strengthened PvP stakes.

**Fix:** each limit is now gated by **its own system's constant**, not a population-local one, so
those constants stay the single source of truth and moving one moves the residents with it.

It also exposed a category error in my own code: a guard *price* is income the resident **receives**,
not a stake they must **cover** — sizing it to holdings was copied from the two stake columns and
left all but the richest ~3% unable to reach the floor at all (an empty protection market, which is
the exact thing step two exists to fix). It's now `max(BODYGUARD_MIN_PRICE, bps(cash, GUARD_BPS))`:
the floor, or more if they're worth more.

### F2 (LOW-MED) — unchallengeable duel listings

`duelChallenge` requires `amt >= DUELS.STAKE_MIN (1000) && amt <= limit`. A resident listed below
`STAKE_MIN` therefore sits on the ladder inside an **empty window** — permanently unactionable.
With the old $250 floor that was every corner resident and most of the made band: a majority of the
ladder was decoration. A board that *looks* full and isn't is worse than an empty one.

**Fix:** a resident lists a duel stake only when it clears `DUELS.STAKE_MIN`.

### F3 (LOW) — `fade_limit` bypassed the table limits

Same bypass class: `setFadeLimit` bounds the value to `CASINO.MIN_BET..MAX_BET`, the direct-SQL
write didn't. Not reachable at today's band seeds (max ~$16k against a $250k table cap), but the
fix is the same clamp and costs nothing.

### F4 (LOW) — a drained resident kept advertising

The three limits were written **once** and never refreshed. `duelChallenge`/`pvpDice` both check
`their_cash`, so there was no correctness bug — but a resident emptied by a player kept a stale
stake on the board that could only ever answer `their_cash`. Same dead-board failure as F2.

**Fix:** a stored stake that the resident's cash no longer covers triggers a relist on their next
turn, dropping them off the board honestly. (A guard *price* needs no cover, so it only moves on a
relist.)

### F5 (LOW, defensive) — the secured-loan recourse guarantee could be silently voided

Residents lend **secured only** because they never call `collectLoan`: the recourse is the audited
grace-forfeit sweep seizing a car worth `LOAN_COLLATERAL_MULT` (1.3×) of what's owed. The code
clamped that floor down to `LOAN.COLLATERAL_MAX`, which would ship an **under-secured** NPC loan —
free money for a defaulter — the moment the clamp bound.

Unreachable today (`LOAN.MAX` × 1.5 vig × 1.3 = $1.95M against a $5M cap), but
`LOAN_COLLATERAL_MULT` and the seed bands are founder levers. **Fix:** if the required collateral
would exceed the cap, the resident simply doesn't lend. A guarantee that can be quietly clamped
away isn't one.

---

## Measurement corrected (sim P9.21)

The probe claimed *"the worker refills, so the faucet cannot be drained faster than it is topped
up."* **That was wrong, in the direction that matters.** The top-up refills **headcount, not cash**:
a resident drained to $0 stays alive and no replacement spawns. The seed pool is a **stock, not a
flow**.

Step two also changed how much of it is realizable. A kill leaks only `CASH_LOOT_RATE` (25%) — the
estate burns the rest. A duel win, a fade win or an order-fill transfers **the whole stake**. So
step two didn't add a faucet (no new reason, no new emission — that part holds), but it moved the
existing one from ~25%-realized to ~100%-realized.

The honest bound is now printed every run: **~$998k lifetime**, against a $21.6M/day passive stack.
Petty, as intended.

---

## Verified clean

- **§10.4.** `npc:seed` correctly ledgers the **delta** from the un-ledgered $500 base and handles
  the negative case (the `corner` band seeds below it). `npc:retire` burns pocket + bank + reclaimed
  escrow. Step two adds no reason: the loan offer and buy order mirror `offerLoan` / `postOrder`
  accounting exactly (`loan:offer`; `market:list` fee + `market:order` escrow), and the test asserts
  the **only** credit reasons a resident ever holds are `npc:seed`, `death:legacy`, `loan:refund`,
  `market:refund`.
- **Escrow reconciliation.** `retireResident` mirrors the audited cancel paths (`loan:refund` +
  `status='cancelled'`; `market:refund` on the unfilled `qty × price` + `qty=0, status='cancelled'`)
  before burning, so no offer outlives its lender and both escrow checks stay balanced.
- **Death.** A killed resident runs the ordinary `runEstate` — loot, burn, heir. `voidLoansAtDeath`
  and `voidListingsAtDeath` / `burnBidsAtDeath` already cover a dead lender's / poster's escrow on
  the audited paths. The heir now correctly inherits `is_npc` (fixed during the build; without it a
  killed resident's line became a "player" and quietly polluted the ops/funnel real-player counts).
- **Lock order.** `residentAct` and `retireResident` lock the character row first, then leaf rows
  (`loans`, `market_listings`) — the canonical characters → … order. Neither locks a second
  character, a gang or a singleton, so there is no new cycle. One transaction per resident per tick.
- **pg-mem.** `cash` is `NUMERIC`, so the arithmetic `UPDATE`s are safe. Turn selection shuffles in
  JS because pg-mem has no `random()`.
- **Exclusions.** The Street Wage (the critical one — emission theft), City Standing, ops and the
  funnel all exclude residents. Most other leaderboards need no change because they rank by
  `account_persistent` legend columns a resident never accrues — **a later step that gives residents
  a legend must add that board's exclusion at the same time.**
- **Loan exploitation.** Taking an NPC loan is −EV either way: repay costs the vig, default forfeits
  a car worth 1.3× owed. The pledge-lock is airtight (melt/fence/repair/list/race all refuse a
  pledged car), and the collateral can't dangle since a pledged car's only pre-collect exit is death,
  which voids the loan.

---

---

# Round two — step three (THE TURNOVER)

Same four lenses over the renewal loop. **No CRITICAL, no HIGH, no §10.4 drift** — the recycle adds
no reason and fires the existing `npc:seed` faucet and `npc:retire` sink, both already reconciled.
Four findings fixed in-commit, regression each.

### T1 (LOW-MED) — maintenance could starve the renewal loop indefinitely

Old-bloodline retirement and drained retirement shared one per-tick room, and old lines were taken
**first**. With `SPAWN_PER_TICK` or more lines past `RETIRE_GENERATIONS`, no drained resident is ever
replaced — the loop step three exists for simply stops.

Not hypothetical: a resident's `generation` only rises when players **kill** them, so heavy PvP is
exactly what sustains a backlog of old lines. It is self-limiting (each tick clears four and the
replacements are generation 0), but "self-limiting" is the wrong bar for a loop that only matters
when the city is under pressure.

**Fix:** old-bloodline retirement is bounded *maintenance*; the drained pass is the *renewal loop*.
The loop is now guaranteed a slot whenever it has a candidate, and maintenance takes what's left.

### T2 (LOW-MED) — a drained heir could become permanently un-recyclable

The arrival stake (`npc_seed`) is what distinguishes drained from born-poor. Residents are stamped at
spawn, but an **heir** is born through the ordinary `runEstate`, which knew nothing about it — so the
stamp was backfilled lazily on the heir's first worker turn. With `ACT_PER_TICK` 6 against a 48-body
city on an hourly worker, that window is up to ~8 hours.

Drain the heir inside it and the backfill records the **drained** cash as their arrival stake. They
then read as "holding 100% of what they came with" forever: never retired, never replaced, a broke
body occupying a slot. A griefer could manufacture these deliberately to hollow the city out.

**Fix:** the stake is known at the heir's INSERT — record it there, alongside the `is_npc` flag that
is already carried on the same row. No window, no backfill.

### T3 (LOW) — no advisory lock on the metered faucet

The day's replacement allowance is read once, then spent across separate transactions. Two worker
replicas could each read it as untouched and each spend all 24, doubling the day's emission past the
ceiling that is the entire point of metering it. `runWageEpoch` already takes a session advisory lock
for exactly this; `runPopulation` is the other metered faucet and had none.

**Fix:** the same session advisory lock, distinct class. pg-mem is single-process, so dev is unaffected.

### T4 (cosmetic) — `seededToday` was production-dead

The ops dashboard duplicated its query inline, leaving the exported helper used only by the test.
Pointed ops at the helper so the reading has one definition.

### Verified clean (round two)

- **§10.4.** The recycle adds no reason; retirement reclaims escrow then burns, `npc:retire` exact.
  A drained resident's remaining escrow can lift them back over the line *after* the decision to
  retire — harmless, the burn ledgers whatever is actually there.
- **The allowance charge** is in the same transaction as the retirement, so a crash between them
  cannot hand out a free replacement.
- **Bodyguards are self-correcting.** A hired guard has just *received* ≥$10k, which pushes them well
  clear of the drained line — so the resident most likely to be retired out from under a paying
  principal is, in fact, the least likely. And a retired guard fails the same `alive` check a killed
  one does, so `bodyguardAbsorbs` degrades identically.
- **The drained threshold vs escrow.** A resident parking the maximum in a loan offer plus a buy
  order still holds ~52% of their stake — a 3.5× margin over the 15% line.

### Flagged (accepted by design)

**The reroll.** Draining a cheap `corner` resident (a few jumps) forces a retirement whose
replacement is drawn from the full band distribution — expected seed $20,798 against that corner
kid's ~$700. A player can therefore convert cheap drains into richer targets. They receive nothing
directly, and total extraction stays bounded by `PER_DAY × mean seed`, so the ceiling is doing its
job — but note that the ceiling is the *only* thing bounding it, and the reroll is cheap.

---

## Flagged for founder sign-off (NOT patched — ground rule #1)

**The city is a depleting resource.** Residents have no income, so once players drain the seed pool
(duels, fades, order-fills, kills) the boards go quiet again: stakes stop clearing the floors, the
loan offers stop firing below `LOAN.MIN`, the orders stop. Step two lights the city up **once**.

Making it renewable — resident income, or retiring-and-respawning a broke resident instead of only
an old bloodline — converts a one-shot ~$998k into a **recurring faucet**, which is a balance
decision, not a bug fix. The dials are `POPULATION.TARGET`, the band seeds, and whether depletion
triggers retirement. Recorded in BALANCE.md.

Note the pool does partially recycle without any change: `hireBodyguard` and loan repayment both pay
cash **into** residents, so an active city refills itself somewhat from player pockets.
