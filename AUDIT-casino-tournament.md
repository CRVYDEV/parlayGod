# AUDIT — Gambling Den step four (the poker tournament)

A focused three-lens red-team over the scheduled tournament (§10.4 / escrow exactness, the enter→settle
concurrency, exploit / grief), every claim verified against source. **No CRITICAL / HIGH.** One MED
fixed in-commit; everything else verified clean.

## Fixed in-commit

**MED — an enter-vs-settle deadlock (poker_state lock order)** (`casino.js:resolveTournament`).
`enterTournament` locks `poker_state` (the state singleton) FOR UPDATE, then the tournament row.
`resolveTournament` locked the tournament row FOR UPDATE first and only touched `poker_state` later
(via `clearCurrent()`'s UPDATE) — an AB-BA cycle: a concurrent settle-holding-tournament + entry-holding-
poker_state would deadlock. It was masked by the codebase's standard 40P01 handling (`deadlockToRetry`
→ a clean `contention` retry on the enter side, the per-tournament worker retry on the settle side), so
it always *resolved* — but the cycle shouldn't exist. **Fix:** `resolveTournament` now locks
`poker_state` FOR UPDATE (right after the entrant chars, before the tournament row), so both paths lock
`poker_state → tournament` — acyclic. (pg-mem is single-threaded, so a true deadlock can't be
reproduced in-harness; the fix is the lock-order convention, verified by reasoning + the tournament
test staying green.)

## Verified CLEAN

**§10.4 / escrow.** The `poker tourney escrow` check (`open pool == Σ buyin − win − refund − take −
death`) is exact: an OPEN tournament contributes `pool == Σ buyin` to both sides; a RESOLVED one
contributes 0 (`buyin − win − take − death == pool − handedOut − (rake + net − handedOut) − deadBurn
== 0` by the settle math); a REFUNDED one contributes 0 (`buyin − refund − death == 0`). The
`casino:tourney:*` reasons ride the `casino:` per-character vocabulary (buyin/win/refund are
character_id'd → the cash check reconciles; take/death are NULL-char burns). The half-take → `street_tax`
+ half-burn while the FULL take is ledgered as a NULL row is the **audited casino:pvp / boxing pattern**
— and `street_tax.pool` (cash) is NOT a reconciled §10.4 bucket (only `street_tax.fund`, the $OMR side,
is), so no drift. The exact-reason matches sit UNDER the den-book `casino:bet:%`/`casino:win:%` LIKE
patterns, so a tournament never pollutes the PvE house book. No new emission — a pure competitive
redistribution (the field loses exactly the rake).

**Concurrency (beyond the fix).** The `poker_state` FOR UPDATE serializes tournament materialization
(two first-entries can't create two tournaments — the second reads the committed `current`) and all
same-tournament entries (no lost `pool +=`). Two workers settling the same tournament: the second's
`status='open' FOR UPDATE` re-check returns null (idempotent). Death-vs-settle serializes on the shared
char lock (settle burns a dead entrant's stake or pays a live one, both consistent); `poker_entries` is
deliberately NOT in the runEstate wipe (settle must reconcile the escrow, not orphan it — the boxing-bet
precedent). Payouts are direct `UPDATE characters SET cash` in the worker (no `persistCharacter` → no
clobber). The brief window between registration-close and the worker sweep where a new entry gets
`closed` (current still points at the un-swept tournament) is benign (the worker runs frequently).

**Exploit / grief.** Alt-stuffing the field is −EV: hands are independent random deals, the payouts
renormalize to `net = pool − rake`, so EVERY entrant's expectation is exactly `−rake/N` regardless of
turnout — a stuffer just funds a bigger pool they mostly win back minus the rake, and a legit player's
`−rake/N` is unchanged (no dilution). Deals are server-side Fisher-Yates, rng-audited. No user-supplied
amount (buyin is a constant → no overflow/injection). A dead-dealt "winner" is excluded (only live
entrants rank/pay). An all-dead field burns cleanly (`refund` branch, 0 refunds, escrow closes).

## Design note (not a defect)

The tournament is a CHANCE-based pooled lottery (server-dealt random hands — you don't choose cards), not
skill poker; the "showdown" framing is cosmetic. This matches the den's other games (dice/numbers) and
the renormalized `−rake/N` EV is fair. Flagged for the founder as a characteristic, not a bug.

Suite 32/32 + sim drift-0.
