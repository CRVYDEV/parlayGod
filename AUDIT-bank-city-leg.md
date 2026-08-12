# AUDIT — the Bank's city leg (`src/bank.js`)

**2026-08-12. Point-in-time**, against `046d904`. One module, 498 lines, shipped
2026-08-11 in #35 with mutation-verified tests and no adversarial pass. It mints
(`prize:omr`), it funds the withdrawal reserve, and its pool is fed by a caller-supplied
number — which is why it went to the front of the queue.

**Result: no CRITICAL, no HIGH, no MED, no LOW. Nothing changed.**

That is the whole finding, and it is worth writing down rather than leaving as silence:
this file has already absorbed the lessons the rest of the project paid for, and the next
person to look at it should know which questions were asked so they can ask different ones.

One defect *was* found in this module earlier the same day and is already fixed —
`recordBankBuy` took an unbounded price (`AUDIT-family-buyback.md` F3). That is the reason
this pass exists; it is not a finding of this pass.

---

## What was attacked, and why each was the question worth asking

### 1. The lost update on the city pool — the shape that bit `foundNpcFamily`

`runCityLegInner` reads the pool at the top and writes it back **absolutely**
(`SET balance = $1`, not `balance - $1`), which is the exact shape that produced a §10.4
drift when `foundNpcFamily` computed an absolute cash value from an unlocked read. A
concurrent `recordBankBuy` landing between the read and the write would have had its
credit silently erased.

**Clean.** Both writers go through `poolRow()`, which is `SELECT … FOR UPDATE`. The
serialization is on the singleton, not on the advisory lock, which matters because the
advisory lock only serializes *this* function against itself.

### 2. Lock order — pool-then-accounts inverts the house rule

The canonical order is characters → accounts → gangs → **singletons last**. This function
takes the singleton *first*, then `FOR UPDATE`s every payee.

**Clean, and the reason is worth stating.** A cycle needs a second path holding an account
row and then reaching for `bank_city_pool`. There is none: the only two writers are in this
file, `recordBankBuy` locks the pool *alone*, and every reader (`bankBoard`,
`runBankInvariants`, the Vig's `cityPaid` term) reads it unlocked. A single-direction edge
cannot cycle. The payee loop is sorted by `account_id` for the `refundPot` reason, so the
multi-row acquisition is itself stable.

### 3. The invariants — are they real checks, or the blind kind?

The class this project keeps finding is a check comparing two numbers *both* derived from
the same bad input. `distributed ≤ bought` is exactly that shape on its face.

**Clean, because the chain is closed at both ends.** Checks (3) and (4) validate each
counter against its own rows (`bought == Σ buys`, `paid == Σ payouts`), so a counter cannot
drift from the record it summarises; `spend ≤ revenue` bounds the input per asset; and the
ratio feeding `bought` is now bounded by F3's price wall. A summary that agrees with its own
rows *and* an input bounded by a wall is not a blind check.

### 4. Sybil — the distribution is linear and uncapped by design

`share = pool × score / totalScore`, and splitting one player's score across N accounts
yields `pool × S/T` either way. Verified algebraically rather than trusted: `totalScore` is a
sum, so splitting does not move it.

The gates *sharpen* this rather than softening it. `MIN_TRACKS: 3` is a fixed per-account
cost — a farm must clear breadth on every account it runs — and `MIN_SCORE` refuses dust.
Both are Sybil-**negative**, which is the opposite of a cap and is why the file says never
to add one.

### 5. Does a refused action still score?

`activity_log` is written inside `bumpMastery`, on the **caller's client** — so it is inside
the action's own transaction and a rollback takes the score with it. (The contrast is
`recordContact`, which needed a SAVEPOINT because it ran in both contexts.)

It records **counts, not XP**, so no progression multiplier can propagate into the
distribution key. That is already pinned by `test/activity.js`; re-derived here rather than
taken on trust.

Every tag in `ACTIVITY.TAGS` carries a game throttle, and the file keeps the *exclusion* list
with a reason per entry (`dice`/`blackjack` because the Madame comps their nerve;
`sell`/`fill` because commerce has no per-action throttle). An exclusion list with reasons is
the audit trail; a tag added without one is what a future pass should look for.

### 6. The post-commit `fundReserve` gap

The soft $OMR commits, then `fundReserve` runs in its own transaction. A crash in between
leaves players holding credited $OMR with no hard token behind it.

**Covered, and verified rather than assumed.** `vig.js` sums `bank_city_pool.paid_total` into
the reserve sandwich, so the *under-funded* half fires. This is the `cityPaid` lesson already
recorded — an unnamed funder does not fail open, it fires spuriously on both halves at once —
and the name is really there.

### 7. Is the payer wired at all?

A built-and-never-called payer is a silent non-feature. `worker.js:567` calls `runCityLeg`
and `:568` calls `runBankInvariants` into `alertDrift`. Wired.

---

## Not defects, recorded so they are not re-derived

- **The remainder lands on the last sorted payee.** If a mid-list account vanished between
  the score read and the pay loop, the last payee absorbs that share rather than dust. The
  total is still clamped to `poolOmr`, so no §10.4 consequence — and there is no `DELETE`
  path for `account_persistent`, so it is unreachable today. A fairness quirk in an
  unreachable branch, not a leak.
- **The distribution weight is coupled to `MASTERY.XP`.** Retuning a mastery XP value for
  progression reasons silently reweights the bank's distribution. This is deliberate and
  documented ("the relative weighting is the one already sized against each action's resource
  cost") — noted so the coupling is not rediscovered as a surprise.

## Scope

Read-and-reason plus targeted source verification; no live reproduction was attempted,
because no candidate survived to the point of needing one. The chain-facing half
(`bankPosition`, the Alchemist reader) is dormant until `ALCHEMIST_ADDRESS` is set and was
read for shape only — it is a pure read that writes no `transactions` row, which is the
property that keeps the two ledgers separate, and that property was checked.
