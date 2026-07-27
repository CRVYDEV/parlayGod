# AUDIT — the full line-by-line sweep (2026-07-27)

*Point-in-time. Findings below were fixed in the same session unless marked otherwise.*

The brief was "a full line-by-line sweep, look for interactions and bugs and exploits." This tree has
had 58 prior audits, so a 59th pass of *reading modules and thinking hard* was unlikely to find much
that a previous reading missed. The approach was inverted instead: **mechanical exhaustiveness first**
— sweeps that genuinely touch every line of the relevant class — and deep reading spent only on what
the sweeps flagged. A sweep does not get tired at file 60, and it produces a number, which is the only
honest way to say "clean."

Seven lenses. Two real findings, both fixed. Five lenses clean, and one of those corrected a piece of
the codebase's own documentation that is wrong.

The scan scripts are not committed (they are throwaway analysis, not guards); the two findings worth
catching *again* were converted into permanent tests instead — see "What became permanent" below.

---

## Summary

| # | Lens | Method | Result |
|---|---|---|---|
| A | §10.4 reason vocabulary | 370 literal ledger reasons vs `KNOWN_REASONS` | **clean** — 0 uncovered, 0 unreadable |
| B | Lock order | transaction-aware lock graph: 214 lock-holding fns, 81 multi-lock, 73 ordered pairs | **1 REAL — `districts↔gangs` AB-BA** |
| C | Persist-clobber | 62 + 18 persisted columns vs every direct-SQL `UPDATE` | **clean** — 79 sites resolved, 0 unreadable |
| D | Auth coverage | all 497 mounted routes | **1 posture defect — 8 boards public, and the guard that should have caught it had been silenced** |
| E | Input validation on money | 71 money-ish params on exported fns | **clean** — no new instance of the `$1`-price class |
| F | pg-mem INT-arithmetic quirk | measured empirically against pg-mem | **clean** — 0 affected; **the codebase's own note is wrong about the quirk's shape** |
| G | Death / dissolution completeness | 52 `character_id` tables, 18 gang-referencing tables | **clean** — char side already guarded; gang side hand-verified |

---

## B — the real defect: a `districts → gangs` lock-order inversion (MED)

**`src/sov.js:buildSov` locked `gangs` before `districts`. Its two siblings lock the other way.**

Three paths in the tree hold both a `districts` and a `gangs` row lock:

| path | order |
|---|---|
| `social/gangs.js:seizeDistrict` | districts → gangs |
| `territory.js:establishRacket` | districts → gangs (its comment says *"the same district → gang order seizeDistrict uses"*) |
| `sov.js:buildSov` | **gangs → districts** |

That is a textbook AB-BA. A boss seizing a district while an underboss builds a stronghold on it —
different characters, so genuinely concurrent — is two transactions each holding what the other wants.
The window is not narrow: `seizeDistrict` makes several round trips while holding the district lock
(`outfitStrengthFrac`, a `territory_rackets` query, `sovGarrisonBonus`, `coalitionDiscountActive`).

**What made it survive four prior audits is more interesting than the bug.** The code carried a comment
asserting its own safety:

> *"Lock order is gang → district here; seizeDistrict locks district → gang, but no sov path ever locks
> district THEN gang, so the only shared pair serializes without a cycle."*

The reasoning is confident, specific, and analyses the wrong pair. A cycle does not require another
*sov* path to take the opposite order — it requires **any path in the tree** to, and two do. A reader
checking this comment against `sov.js` would agree with it; you only see the bug by looking at all
three files at once, which is exactly what a human reading module-by-module will not do and what a
graph does for free.

It was masked in production by the standard `40P01 → contention` retry, so it surfaced as an occasional
retryable error rather than a 500. The codebase's standing rule is to fix the order regardless; three
prior audits fixed this same class (`fightBout`/`resolveMainEvent`, `pvpDice`, `refundPot`).

**Fixed** — `buildSov` now locks districts first, matching both siblings. The holder re-verification
under the lock is preserved.

## D — the posture defect: eight public boards, and a silenced guard

35 `/v1/leaderboard/*` routes exist. **27 required auth; 8 did not** — `tycoons`, `launderers`,
`statesmen`, `convoy`, `kingpins`, `honor`, `builders`, `family-build`.

Two of those are the sharpest targeting signals in the game: `tycoon_earned` is lifetime front income
and `laundered_lifetime` is lifetime laundering — i.e. *who has the biggest passive empire*, which is
precisely who to hunt under THE SACKING (a fire-kill seizes a business front). An unauthenticated
scraper got that list for free.

**The part worth recording is why it lasted.** `test/routes.js` already guards exactly this — *"every
/v1 route is authenticated unless it is EXPLICITLY listed here as public"*, checked both ways. It is a
well-designed guard and it worked: it forced a diff. But the diff that got made was **adding the eight
routes to the allowlist** rather than adding `auth`. They sat in a bare `Set` of strings under a header
saying *"boards the console reads before sign-in"* — and all eight are read only from authed console
tabs, so the stated rationale applied to none of them.

A bare string carries no reason, so the guard could not tell a considered exemption from a silencing
one. Contrast `GET /v1/yield`, added the previous session, which carries an inline comment explaining
why it is public.

**Fixed both halves:**
- the 8 routes now require `auth`, matching their 27 siblings (all are called from authed tabs, verified against the client, so nothing breaks);
- `PUBLIC` is now a **map of route → the reason it is public**, and a placeholder reason fails the test. Silencing now costs the same effort as explaining, which makes adding `auth` the cheapest way past the guard.

Three tests were calling these boards without a token and are now authenticated
(`test/economy.js` ×2, `test/commission.js`).

Zero `/v1/mod/*` routes lack `modAuth`. The remaining 22 public routes are the deliberate surface
(landing page, wiki, cards/profiles, agent discovery, auth entry points, the rulebook), each now with
its reason stated.

---

## F — the pg-mem INT quirk is mischaracterised in our own notes

`CLAUDE.md` and several source comments say:

> *arithmetic UPDATEs on INT columns (`SET qty = qty - $n`) mis-evaluate to `0 − n`*

Measured against pg-mem directly, that is wrong in both directions — too broad about what breaks, and
wrong about how:

| form | column | result |
|---|---|---|
| `i = i + $1` | INT | **correct** |
| `i = i - $1` | INT | **WRONG** — sign-flipped (`100 − 5` → `−95`), not `0 − n` |
| `i = i + 5` / `i = i - 5` (literal) | INT | **correct** |
| `i = $1` (absolute) | INT | **correct** |
| `GREATEST(0, i - $1)` | INT | **WRONG — silently returns `0`** |
| any arithmetic | BIGINT, NUMERIC | **correct** |

So the quirk is narrow: **INT column, subtraction, bound parameter**. Addition is fine, literals are
fine, NUMERIC and BIGINT are fine.

Two practical consequences of the correction. The note as written would push someone away from
`col = col + $1`, which is safe and used correctly in ~20 places. And it does not warn about the one
genuinely dangerous form: `GREATEST(0, col - $1)` does not sign-flip, it **zeroes the column**, which
reads exactly like a clamp doing its job.

Swept for the affected form: **zero sites**. Every INT decrement in the tree is a literal, an absolute
write, or on a NUMERIC/BIGINT column. The discipline held everywhere even though the note describing it
was imprecise. Notably the three escrow pools most at risk (`poker_tournaments.pool`,
`grand_prix.pool`, `stakes_races.pool`) all use absolute writes.

---

## The clean lenses, with their numbers

**A — §10.4 reason vocabulary.** 370 distinct literal ledger reasons across the tree, every one covered
by its currency's `KNOWN_REASONS`. 12 raw `INSERT INTO transactions` sites outside the `ledger()` helper;
11 unreadable to the parser, all hand-verified (7 are comments; the one dynamic currency,
`social/estate.js:283`'s `currency: e.item_kind`, is constrained by `WHERE item_kind IN ('cb','ammo')`).
An earlier version of this sweep reported ~190 false uncovered reasons because apostrophes inside
comments (`character_id'd`) shifted the quote pairing — stripping `//` comments first fixed it.

**C — persist-clobber.** `persistCharacter` writes 62 columns, `persistAccount` 18. 79 direct-SQL
`UPDATE`s touch one of those columns. A direct write is only a clobber if the same transaction later
persists that entity from stale memory — which happens only for the actor — so each was classified by
target: **72 target a third party** (a bettor, an entrant, a victim, a crew member) where no persist
runs, and **7 target the actor**, all in headless or self-managed transactions with no persist
(`emission.js` wage epoch, `fees.js:rerollCharacter`, `store.js:grantPackage`, `worker.js` season
rollover) or against the recruiter rather than the actor (`game.js` referral). Three dynamic-column
sites were resolved by hand: `convoy.js:40` and `kitchen.js:251` write columns that are not on the
persist lists, and `pen.js:336` writes `health`/`jail_until`/`hole_until` — which *are* — but every
branch guards `if (m.id === ch.id) { …in-memory… } else { …direct SQL… }`. Unreadable count: 0.

**E — input validation on money.** 71 money-ish parameters on exported functions. The casino stakes all
route through one shared `gateBet`, which is airtight against NaN, Infinity and negatives (`Math.floor(NaN)`
fails `>= min`; `Infinity` fails `> max`). `playTable`, `challenge`, `stake` each validate explicitly.
Four sites clamp a bad quantity to a safe default rather than refusing (`sellGood`, `buyListing` goods,
`cook`, `openConvoy`) — but every one of them prices server-side and re-checks affordability, so the
worst outcome is a silent under-execute, not the mispricing that produced the `unitPrice` bug. No new
instance of that class.

**G — death and dissolution.** The character side is already machine-guarded: `test/migrate.js` parses
schema.sql for every `character_id` table and fails CI on an unclassified one (52 tables, 38 wiped, 5
special, 5 escrow, 4 ledger). The guard is honest about its own scope, which is the right posture.

The **gang** side has no equivalent guard — and it produced a HIGH once before (the zombie gang /
stranded treasury). Swept by hand: 18 tables reference a gang; 15 are deleted, nulled or cascade on
dissolution. The 3 that are not all resolve:
- `commission_proposals` — an open deposit is *meant* to outlive the family; `settleProposals` already
  re-verifies the gang exists under the lock and forfeits a dissolved proposer's deposit to the pool,
  so the `commission escrow` identity closes.
- `commission_vetoes` — deliberate and documented ("a vetoing family that later dissolves stays on the record").
- `fight_fixes` — the fix was bought and paid for, so it correctly still applies; the only residue is
  that a week-PK ghost row blocks a *new* neon holder from buying that week's fix. Cosmetic; noted, not changed.

---

## What became permanent

Both findings were converted into guards, because the value is in catching the *next* one:

**1. A districts→gangs lock-order test** (`test/migrate.js`). Anchored on column-0 function
declarations — an earlier hand-rolled version of this analysis bound locks to inner arrow-function
names and reported fake cycles. It also asserts it still *sees* the pair (`both.length >= 3`), because
a scanner that stops matching reads exactly like a clean bill of health.

**2. `PUBLIC` as a reasoned map** (`test/routes.js`), described above.

Both mutation-verified in all directions: revert the `buildSov` order → the test names the function;
blind the scanner → it fails as vacuous rather than passing; use a placeholder reason → it fails;
remove `auth` from a leaderboard → it is reported as an undeclared public route.

---

## Open / not changed

Nothing new. The previously-flagged and accepted items stand (market `bidListing` AB-BA which is
retry-masked, `VoucherClaim.sweep` under the Safe-as-root-of-trust posture, purchasable seasonal
Commission standing, the shared dividend-pool allocation). `forge test` is green (73/73 since
2026-07-23); mainnet still gates on legal counsel and the third-party audit.

Suite 57/57 + sim drift-0 after every change.
