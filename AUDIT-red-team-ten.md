# AUDIT — RED TEAM #10

**Date:** 2026-08-17 · **Scope:** the whole tree, aimed at classes established by RT#1–#9 and never
swept to their edges, plus the two structural gaps those reports leave open by construction.
**Method:** first-hand throughout. Nothing was called a finding before it was reproduced against a
running engine or the source; nothing was fixed before it was reproduced. Two lenses needed real
Postgres (a live database older than the build; a lock-order property pg-mem cannot express).

**Result: no CRITICAL, no HIGH. Two MED, seven lenses clean, two permanent guards added, seven
mutations each failing at its own named assertion.**

Point-in-time, like every report in `docs/AUDITS.md`.

---

## Why these lenses

RT#7 named the shape the previous reports leave behind: *a class established, applied where it was
discovered, and never swept to its edge*. RT#8 and RT#9 each found more of exactly that. So this pass
took the two remaining instances of it — **lock order**, fixed four separate times at four separate
sites and never checked as a whole; and **error mapping**, fixed at three sites and never checked as
a whole — plus the classes a red team can only close by sweeping: units, day boundaries, the
idempotency perimeter, and the one migration failure that has actually taken production down.

---

## F1 (MED) — a lock pair with two orders, and a safety argument that was false

`callOutChamp` locked `boxing_title` → `fighters`. `acceptCallout` locks `fighters` → `boxing_title`.
Both are correct about themselves. Neither is correct about the other.

`callOutChamp` carried a careful comment arguing the inversion was safe, on a stated precondition:

> *"any counter-path that would lock this fighter must first block on the held caller char"*

That precondition is **false**, and the counterexample is a function the same comment NAMES as
canonical. `acceptCallout` locks the CHALLENGER's fighter — the very row — without holding the
challenger's char, and says so in its own words: *"The challenger's fighter is another player's row
we don't hold the char lock for."*

**Reachability**, stated honestly because it is narrow: the champ in `acceptCallout` reads the title
UNLOCKED, then locks the two fighters, then locks the title. For the cycle to close, the callout must
be cleared inside that window — which `enforceBeltDefense` does when it strips or forfeits a belt —
so that a fresh contender can enter `callOutChamp`, take the title lock, and reach for a fighter the
champ is already holding.

**Consequence**: a Postgres deadlock → `40P01` → `deadlockToRetry` → a retryable `contention`. Both
sides retry and succeed. No money was ever at risk, which is why this is MED and not higher.

**The defect is the argument, not the outcome.** A comment asserting a safety precondition its own
named sibling violates is what licenses the next edit — this project's own recorded lesson that *a
wrong claim in a comment licenses the next reader* (RT#4).

**Fixed** by taking the order rather than reasoning about it: `callOutChamp` now reads the title
unlocked to learn who the champ is (and therefore who the contender is), locks the caller's fighter,
then locks the singleton and re-verifies — the `acceptCallout`/`executeHeist` TOCTOU pattern. The
re-verify is not decoration: the belt changing hands changes WHO the contender is, because
`contenderOf` excludes the champ's own fighter, so a shifted holder throws `contention` rather than
proceeding on a stale computation.

### THE LOCK LEDGER — the guard

This class has been fixed four times at four sites (`pvpDice` inverting street_tax/den_volume;
`refundPot` iterating funders unsorted; `payFamilyYield` locking the pool before the gangs; the poker
tournament locking its row before `poker_state`). Each fix stated the canonical order in a comment,
which is exactly as durable as the next person reading that comment. So it is a check now
(`test/gates.js`), in the shape of its six siblings.

**Two rules, and the second exists because the first is blind to it.**

1. No pair of tables may be locked in both orders by any two transactions.
2. No SINGLETON may be locked before a `characters` row — because every player action already holds
   its own character via `withCharacter` before it reaches a pot, that implicit lock makes
   characters→singleton the universal order, and rule 1 cannot see a lock the wrapper took.

**Splitting on transaction boundaries is what makes it usable, and that is a measured claim rather
than a design preference.** A function may open several independent transactions — the ring sweep has
two, a route-registration function has dozens — and concatenating them invents pairs no single
transaction ever holds together. Without the split the sweep reported **two false positives out of
three** (`sweepRingTables`, whose first loop locks only the table; `modtools.js:register`, where
independent handlers were being read as one sequence). A mostly-wrong advisory is worse than none.

Result on the fixed tree: **74 multi-lock transactions agree on one order for each of 46 pairs, and
none of 237 lock-holding segments takes a singleton before a character row.**

Anti-vacuity has two floors because they fail differently: one catches an extractor that has stopped
seeing `FOR UPDATE` at all, the other catches a SINGLETON list that has drifted off the real table
names — which would make rule 2 pass over every pot in the game while looking exactly as clean as it
does when it holds. Verified: 52 singleton lock sites across 20 distinct pots.

**Mutations** — M11 restore the title-first order → fails naming `boxing_title ↔ fighters` and both
sites. M12 drift the singleton list → fails naming the drift, not the absence of findings. M13 plant
a `street_tax`-before-`characters` lock in `pvpDice` → fails naming the site and the order.

---

## F2 (MED) — transient contention reported itself as a server bug

`withCharacter`/`withTwoCharacters` map `40P01`/`23505`/`55P03` to a retryable `contention`. But
**89 functions open their own transaction**, and eight are reachable straight from a player route:
the whole withdraw / gear / item / deed / dynasty rail, plus the bond quote and claim. The global
error handler maps `GameError`, the JWT family, `db_down` and Fastify's own 4xx — and nothing else.
So those eight answered `500 internal`.

**A `55P03` there needs no deadlock at all.** It is the pool's `lock_timeout` safety valve firing
after 8s of ordinary contention on a singleton like `chain_reserve` — which every withdrawal takes.
Nothing is corrupted; the transaction rolled back. What is wrong is the answer: the server calling
itself broken about the one condition the caller should simply retry.

**This is the fourth instance of a class the same handler already argues twice, in its own words** —
`db_down` (*"an outage and a null-dereference produced byte-identical responses"*) and the 4xx branch
(*"blanket-500ing those says 'the server is broken' about a request the server correctly refused …
it matters more for agents than for us — they are first-class players here, they read these codes,
and 500 means 'retry later' when the honest instruction is 'fix your request'"*). All four are the
same sentence about a different cause.

**Fixed once in the handler rather than at 89 call sites.** That is the point: a route that
hand-rolls a transaction can no longer ship this by omission (the H4 denylist-by-default shape), and
the per-site catches become harmless redundancy instead of a thing to remember. The code set comes
from `deadlockToRetry` itself rather than being restated, so the two cannot drift — if it hands back
something other than what it was given, that something is the retryable error.

**Regression** drives the REAL error handler: a route registered by the test (never shipped) throws
each pg-shaped error in turn. All three codes are checked rather than one — they come from the same
set, and a fix that mapped only the famous one would leave the two that actually reach these routes
reporting as bugs. The second half asserts a genuine error still reports as a genuine error, which is
what keeps this a legibility fix rather than a blanket swallow.

**Mutations** — M14 remove the branch → fails at `40P01 is transient contention`. M15 widen it to
swallow everything → fails at `a genuine error still reports as a server bug`.

---

## Clean lenses

Recorded because a red team that publishes only its hits cannot be audited.

**L1 — THE MIGRATION CLASS, and the guard it was missing.** The 2026-08-06 outage (a `CREATE TABLE IF
NOT EXISTS` is a no-op on a live database, so three columns added inline never landed and the next
statement crash-looped the container) is defeated by the derived `ADD COLUMN IF NOT EXISTS` pass in
`db.js`. Every suite is structurally blind to it — pg-mem always starts EMPTY — and `pgcheck` §7 was
blind one step further removed, since re-applying the CURRENT schema twice means the first
application already made the table right. **`pgcheck` §7b** now applies the OLDEST `schema.sql` in the
history and boots the current build on top of it, which is what a deploy does. The original outage is
proven defeated on an M1-era database.

Two things this lens established that were not known before:

- **The deriver contributes nothing today.** Disable it entirely and the check still passes — 0
  statements, all 1,587 columns present — because `schema.sql`'s hand-written ALTER blocks currently
  cover the lot. So the deriver is not the load-bearing half; it is the belt to that discipline's
  braces, and its whole value is the day somebody forgets.
- **Which is exactly what the check is for, and it is guarded on that.** Add an inline-only column to
  a pre-existing table: with the deriver intact it lands (1,468 statements, 1,588 columns); with the
  deriver removed the check FAILS naming `gang_members.zzprobe_only` and the outage class. So a green
  here means "nothing has been forgotten yet", not "the deriver ran".

The assertion's SHAPE was arrived at by discarding two wrong ones, both recorded at the site: naming
the outage column is unfalsifiable (this repository's history begins after that fix, so
`gang_members.post` is in every historical schema), and hand-parsing `schema.sql` reported **17
phantom missing columns** because a one-line table (`stakes_state`) has no `\n);` terminator and the
match ran on into its neighbour. It compares two DATABASES and parses nothing — the reference is
produced by CREATE TABLE, the subject by ALTER, so they share no code path and cannot be satisfied by
both halves making the same mistake.

**L2 — DAY AND WEEK BOUNDARIES.** 31 day/week-keyed tables; eight functions compute the day more than
once. `referralXpBonus` (22 calls) is the known tail-slice artifact — it is the last export in
`rules.tail.js`, so the body slice runs to end-of-file. The real write paths are benign:
`setBondOffering`'s two calls can only produce a spurious refusal at a midnight boundary (fail-closed,
mod-only, retry succeeds), and the boards are reads where a day roll costs a mildly inconsistent
render, never a bypassed latch.

**L3 — UNIT BOUNDARIES.** The class with a 2/2 hit rate (RT#6's `ALCHEMIST_ASSET_DECIMALS`, RT#9's
`STOCK_TOKEN_DECIMALS`) swept three ways: every `_BPS` used in arithmetic without a `10000` on the
line (all declarations or correct intermediate bps), every `_MS` crossing a 1000/60 conversion (all
ms→seconds for API responses), and every chain conversion — `parseUnits`/`formatUnits`/`1e18`. The
lossy `Number(bigint)/1e18` sites are all cap and ceiling COMPARISONS where a few ULPs cannot flip a
meaningful result, and `watcher.js` uses `formatUnits` precisely where precision is load-bearing.
`dexbot.js:414`'s bare `/1e18` was checked for a BigInt/Number mix (which throws) — `Number(liquidity)`
is explicitly converted first.

**L4 — THE IDEMPOTENCY PERIMETER.** The `guarded` predicate is denylist-by-default (POST or DELETE
under `/v1`, minus auth and mod), so the sharp question is what mutates outside those verbs: **there
are no PUT or PATCH routes at all** (19 DELETE, 228 GET, 451 POST). Ban and token revocation are
checked on BOTH paths — the `auth` preHandler carries them too, so an authed GET is covered as well
as a guarded mutation.

**L5 — TWO-PARTY TRANSFERS WITH INDEPENDENT LEGS.** Worth a lens because **§10.4 is structurally blind
to it**: if A is debited 100 and B credited 101, the per-character check sees Σcash and Σledger both
move by +1 and balances. 402 of 404 `ledger()` calls parsed; 27 pairs whose legs are not the same
expression; the ones that share a REASON are the documented taxed-transfer family (`amt - rake`,
`net`, `toLender`), and every one credits the pool or burns — directly, or through `payVig`.

**L6 — SINGLETON-BEFORE-CHARACTERS.** Folded into THE LOCK LEDGER as rule 2 above: zero of 237
lock-holding segments, against 52 singleton lock sites confirming the check bites.

**L7 — THE ERROR HANDLER'S OTHER BRANCHES.** Verified while fixing F2 that the `GameError`, JWT,
`db_down` and 4xx branches all still hold, and that the new branch cannot swallow a real bug (asserted
directly, and mutation-verified in both directions).

---

## What my own tools got wrong

Three tools, three wrong answers, all caught before anything was reported. Recorded because *a finding
produced by a tool you wrote and did not check is not a finding — and neither is a clean bill of
health.*

1. **The lock sweep, v1: 2 false positives out of 3.** Slicing by function concatenated independent
   transactions. Fixed by splitting on `BEGIN`/`COMMIT` boundaries, which is now the guard's own
   documented reason for that split.
2. **The transfer sweep, v1: entirely vacuous.** It assumed positional `ledger()` arguments; the real
   signature is a named object, so it matched **0 debits out of 404 calls** and reported "0 asymmetric
   pairs" — a clean-looking result that meant nothing. Caught by instrumenting the match count rather
   than reading the verdict.
3. **The take-accounting sweep: 2 false positives out of 19.** `repayLoan` delegates its vig to
   `payVig`, which my body-level regex could not see; `career.js` merely names `bodyguard:hire` inside
   a SQL string as a career signal.

And one process note: the schema-parsing version of §7b produced 17 confident, specific, reproducible
phantom findings before being replaced.

---

## Flagged, not changed

- **`setBondOffering` has no `ON CONFLICT` on its first INSERT**, so two concurrent first-sets on one
  day would 23505. It is mod-only and single-operator, and after F2 that now surfaces as a clean
  retryable `contention` rather than a 500 — so the remaining cost is one retry.
- **89 hand-rolled transactions remain hand-rolled.** F2 makes that safe at the boundary rather than
  requiring 89 catches; the per-site catches that exist are now redundancy. Consolidating them is
  churn with no behavioural gain.

---

## Verification

Full suite green (99 files, exit 0) · sim drift-0 · `pgquery` 2,977 statements + `pgcheck` 44/44 on a
FRESH real-Postgres database · seven mutations, each failing at its own named assertion.

Probe files written and deleted before committing; every mutation on a scratchpad copy, never
`git checkout`, with uncommitted work in the same files.
