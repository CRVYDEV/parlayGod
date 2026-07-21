# AUDIT — Street Races (the new content drop)

**Date:** 2026-07-21
**Scope:** the Street Races drop — `src/races.js` (raceNpc / raceChallenge / tuneCar / listRace / unlistRace
/ raceBoard / raceLeaderboard), the `RACES` rules block + `carPower`, the schema columns
(`cars.tune`/`race_limit`, `characters.race_at`, `account_persistent.race_wins`), and the wiring.

**Method:** three independent red-team lenses in parallel (§10.4/persist, concurrency/locks,
exploit/grief/economy), each re-verifying against source, cross-checked with my own review.

## Result — no CRITICAL / HIGH.

### §10.4 / persist — CLEAN
Every cash movement is ledgered with a `character_id` under a `race:*` reason in the cash vocabulary:
`race:fee` (sink, burns win/lose), `race:purse` (faucet, win-only), `race:wager` (the PvP transfer both
sides), `race:tune` (sink). The PvP transfer is byte-parallel to the audited `casino:pvp`/`boxing:bout`
pattern (loser −amt, winner +amt−rake, both counterparty'd; `street_tax += floor(rake/2)` direct; the
other half burns) — ledgered net == actual net == −rake, no mint. `race_at`/`tune`/`race_limit`/`race_wins`
are direct-SQL writes absent from persistCharacter/persistAccount → no clobber; cars are a separate row-set
persist never touches; `bumpWheel` uses a literal `+1` and all car writes are absolute (pg-mem-safe).

### Concurrency / locks — CLEAN
`raceChallenge` runs under `withTwoCharacters` (both char rows + accounts locked sorted) → locks the two
car rows FOR UPDATE sorted → `street_tax` singleton last: the canonical characters→…→rows→singletons
order. **races.js is the ONLY `cars … FOR UPDATE` in the whole tree** — every other module updates cars as
a leaf write while already holding the character lock, so the global order is uniformly chars-before-cars
and no AB-BA is possible. Mutual/same-owner concurrent challenges serialize on the sorted char locks; a
rare cycle maps to the retryable `contention` error (`deadlockToRetry`). Single-party paths lock only the
actor. No lost-update on `cars.dmg` (absolute write under the lock).

### Exploit / grief / economy — CLEAN of CRITICAL/HIGH; one LOW fixed
Gates verified: self / family / jailed / hospitalized (actor + opponent), own-car-only, Black-Market-listed
+ loan-pledged cars rejected for both sides (`raceable` + the under-lock re-read), wager/limit
NaN/Infinity/negative guarded, `carPower` floored at 1 (no divide-by-zero on a wrecked car), cars die with
the street (no dangling race state). No cash mint, fee/tax dodge, or escrow violation.

**LOW-1 (FIXED, regression added) — winner-as-owner escaped the per-driver cooldown.** `raceChallenge`
cooled down the CHALLENGER (`ch.id`) but credited THE WHEEL to the WINNER (`winner.account_id`), which may
be the OWNER. So an owner-account could be fed WHEEL wins by disposable alt challengers (racing weak cars
into the owner's strong listed car and losing deterministically) with no throttle of its own — a
cheaper-than-boxing status farm (boxing's loser-fighter injury lockout gates the analog). Impact is
STATUS-ONLY (THE WHEEL is account-level, no gameplay power — the accepted Sybil-status posture), but the
missing winner-side throttle was a real discrepancy vs the design's "per-driver cooldown bounds the loop"
framing. **Fix:** `raceChallenge` now also stamps `race_at` on the WINNER (a losing owner is NOT cooled —
no win to farm, and it can't be griefed into a lockout), bounding WHEEL accrual to the per-driver cap on
either side. Regression: a weak challenger loses to a strong listed owner → BOTH the winning owner and the
losing challenger are cooled down.

## Accepted-design / balance flags (NOT patched — founder sign-off)
- **PvE top-tier is a guaranteed +EV faucet for an over-powered car** (+$18k/win = +60% of the fee at the
  top tier, not the "thin edge" the original comment claimed — **wording corrected** in `rules.js` +
  `BALANCE.md`). Bounded by the shared 2h cooldown (~12/day ≈ +$216k/day — boxing-exhibition parity; a
  matched car is ~break-even and a lost race dings the car). Sim P9.13 measures it; founder sim sign-off.
- **PvP collusion A→B is direction-controllable at a 10%-of-wager tax** (the stronger car always wins) —
  identical to the audited `casino:pvp`/boxing posture; a taxed transfer, no mint. Accepted.
- **The owner has no cooldown / can be race-spammed** — bounded by revocable consent (must list, can
  `unlist`) and each challenger risking their own wager + their own cooldown. Accepted (consent-by-listing).
- **No safehouse gate on a race** — a race is a consensual cash game, not offense/extraction (the casino/
  boxing posture, not P1.3-gated). Accepted.

## Verdict
Street Races is §10.4-clean, deadlock-free, persist-safe, and gate-tight. The one LOW (a status-farm
cooldown gap) is fixed with a regression; the balance flags are the standard new-faucet/casino-PvP
sign-off items. Suite 31/31 + sim drift-0.
