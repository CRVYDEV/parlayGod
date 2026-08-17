# AUDIT — RED TEAM #7 (2026-08-17)

**Scope.** The seventh max-effort pass, run immediately after RT#6 merged. RT#4 through RT#6 each closed
their own scope well, and the shape they leave open is the same each time: **a class this project has
already established, applied where it was discovered, and never swept to its edge.** So the primary lens
was one such class — the population layer's own recorded rule — and the secondary lenses were the
mechanical sweeps nobody has run as a sweep.

**Method.** First-hand throughout; no fan-out. Nothing was called a finding before it was reproduced
against a running engine, and nothing was fixed before it was reproduced. The headline needed a **booted
server driving real routes** (the boards are read-only aggregates; the question is what they *contain*
with scenery in the database, which is not answerable by reading them), and the persist-clobber re-sweep
needed its own extractor **rebuilt after the first one silently returned zero** — recorded below, because
a tool you wrote and did not check is not evidence.

**Result. No CRITICAL, no HIGH. One MED finding across 27 boards, five lenses clean.** Three mutations,
each failing at its own named assertion.

---

## F1 (MED) — human status boards rank NPC scenery

The population layer's design is deliberate and its consequences are written down in CLAUDE.md:

> A resident is a **REAL character** … so ONE population lights up every board at once and **every
> interaction runs the same audited code that runs against a player**.

and, in the same entry, the rule that follows from it:

> most other leaderboards need no change since they rank by legend columns a resident never accrues —
> **a future step that gives residents a legend must exclude them on that board at the same time**.

That rule is correct, and it was **applied per-board as each was discovered** — `boxingLeaderboard`,
`stableLeaderboard`, `raceLeaderboard`, the hitmen board, the Trades board and the Firsts each carry an
`is_npc` exclusion, added by the drop or the audit that noticed. It has **never been swept as a class**,
and residents accrue far more than they did when it was written: Street War step two gave them fighters
and racers, step three gave them stables, the population steps gave them duels, deaths and heirs.

**Reproduced end to end**, on a booted server with the population worker allowed to run:

**The duelling ladder** (`duels.js:duelLeaderboard`) is the sharpest case, because it is the one board
with **no threshold at all** — it ranks every living character by raw `duel_elo`, and a resident's
`duel_elo` **defaults to `ELO_START`**. So it needs no kills, no duels and no play of any kind to fill
with scenery:

```
  #1  Sal Roselli      1200   ← resident
  #2  Nunzio Pesca     1200   ← resident
  #3  Bo Fontaine      1200   ← resident
  #4  Mimi Castellano  1200   ← resident
  #5  Vito Marchetti   1200   ← resident
  #6  (the only human)  1200
  #7  Angie Deluca     1200   ← resident
```

Six of seven entries are NPCs, and the server's only human sits **sixth**, behind five bots, on an
identical rating.

**The ancestral hall** (`bloodline.js:bloodlineLeaderboard`) is the second, and it follows from the
population layer's own most deliberate decision — *death is deliberately not special*, so a killed
resident runs the **ordinary `runEstate`**, which writes a `bloodline` row and raises an heir. With
`RETIRE_GENERATIONS` 6, one boss-band line accrues six generations of level-and-kill score. Four
mod-kills put a resident house on the great-houses board at **score 520** while the server's only human
was not on it at all — because he had not died yet.

The other two are the same shape with a lower ceiling: `contracts.js` ranks assassins by
`hitman_rep`/`season_kills` (a resident who wins a duel or takes a contract earns both), and
`social/estate.js:feudLeaderboard` ranks the deadliest blood feuds — and the vendetta swear in
`runEstate` never consults `is_npc`, so a resident killed by a player is sworn against exactly like a
person and the feud is board-eligible.

**Not a leak** — no §10.4 surface, no value moves, nothing farmable. What it damages is the thing a
status board is *for*: a ladder topped by scenery tells a real player nothing about where they stand
against real people, and it is worst precisely where it matters most — a thin server on launch night,
which is the only condition under which residents outnumber players.

### The fix, and why it is a guard rather than 25 edits

Adding the exclusion to 27 boards is the easy half and it is not the durable half: the class has now
been rediscovered three times, and the 26th board will be written by somebody who has not read this
report. So the exclusions went in **and** `test/gates.js` gained **THE SCENERY LEDGER** — the same
catalogue-or-declare shape as the connection ledger, the handover ledger and the watcher poison ledger:

- every exported `*[Ll]eaderboard` is discovered from the source, not listed;
- each must either exclude residents **or** be waived with a stated reason (11 are, and each reason is
  a property of the board — a gang board where NPC families hold nothing, a retired board, the agent
  board whose whole population is agents);
- an **anti-vacuity floor** (`boards.length >= 40`) so a broken extractor reports as a *failure* rather
  than as zero problems — the recurring lesson, and the one this guard's own mutation run re-taught;
- a **stale-waiver check**, so a waiver for a board that no longer exists fails the build rather than
  quietly protecting nothing.

Two boards are **deliberately left including agents** and are not touched here: `wireLeaderboard` and
`worldLeaderboard` include them by a decision already recorded in CLAUDE.md (a $OMR-bought, payout-free
status axis). Residents are excluded from both; agents are a separate, decided question.

**The check is per RANKING STATEMENT, not per board body**, and that distinction is the whole reason the
guard works — see the mutation record below.

---

## Mutation record

Three mutations, each failing at its own named assertion:

| # | Mutation | Result |
|---|---|---|
| M1 | strip `AND NOT c.is_npc` from the duel **elo ladder** only | `duels.js:duelLeaderboard (1 of 2 ranking queries)` |
| M2 | strip the exclusion from the feud board | `social/estate.js:feudLeaderboard (1 of 1 ranking queries)` |
| M3 | waive a board that does not exist | `stale exemption(s): crew.js:gonesomewhere` |

**M1 survived its first two runs, and both causes are worth keeping.**

*First:* the guard asked "does this body mention `is_npc` anywhere?" — and `duelLeaderboard` runs **two**
queries (the elo ladder and the titles board). Stripping one left the other's mention, and the guard read
the board as protected. A board-level check cannot see a board that is half-guarded, which is exactly the
state a partial fix leaves behind. Sharpened to per-statement: every query that reads `FROM characters`
**and** carries an `ORDER BY` is a ranking statement and must carry its own exclusion.

*Second:* the mutation still survived, and the code was not the reason — **I had written SQL `--`
comments containing BACKTICKS inside JS template literals** (`` `> 0` ``, `` `duel_elo` ``,
`` `is_npc` ``), which terminate the literal. `node --check src/duels.js` → *SyntaxError: missing ) after
argument list*. Three files were broken at parse time; `pgquery` could not see it (it reads SQL as text
without importing the module) and only `node --check` catches it. **This is a trap already recorded in
CLAUDE.md, hit a second time**, so it is recorded again with the remedy: the comments now live in JS
above each function, and `node --check` runs on every file after any edit that touches a template
literal.

---

## Clean lenses

Recorded because a red team that publishes only its hits cannot be audited.

**1. The pause matrix.** Five contracts are pausable (`VoucherClaim`, `OmertaBond`, `StreetDeed`,
`DynastyNFT`, `StockVault`), and the question a pause has to answer is *can a paused contract trap a
holder's asset?* Every one of them exempts the exit: `StreetDeed.redeem` is explicitly not
`whenNotPaused` (documented as the never-trap rule), `VoucherClaim`'s reclaim path is a server sweep
rather than a user call, and `OmertaBond.claim` is deliberately unpausable — which RT#5's MIN_VEST
analysis already relies on. `StockVault.sweep` and `pause` are both Safe-only, so a paused vault's
pre-funded units remain recoverable by the owner. No contract can be paused into a state where value is
unreachable by anybody.

**2. The persist-clobber re-sweep.** The class (a direct `UPDATE` writing a column that
`persistCharacter`/`persistAccount` will overwrite from a stale in-memory row) was swept in RT#3 and has
had ~15 new columns added since. Re-swept mechanically: **66 persisted character columns / 18 account
columns** against every direct `UPDATE` in `src/`, narrowed to writes that can touch the *actor's own*
row inside a held transaction → **4 hits, all legitimate** (headless paths with no loaded context, or
worker-owned rows). Class clean.

**The extractor's first version reported "persistCharacter cols: 0" and I nearly recorded that as the
result.** It searched by function name and the persist statement is built as one long template literal,
so it matched nothing — a zero that reads exactly like a clean sweep. Fixed by anchoring on the literal
`` UPDATE characters SET respect=$2 `` and re-run. *A finding produced by a tool you wrote and did not
check is not a finding, and neither is a clean bill of health.*

**3. Keyless-route throttle scoping.** RT#5 F2 fixed `/health` and established that the H4
denylist-by-default is scoped to `/v1`. Re-checked after this session's new routes: every keyless route
added since is either under `/v1` (covered by the default) or static-file/no-DB. No new gap.

**4. The zero-coverage money modules.** `made.js`, `career.js` and `hustle.js` appear in no audit report.
Read for the standard classes: all three write through the audited ledger helper, all three carry their
level/latch gates before the credit, and the career ladder's once-per-account latch is checked *before*
`not_done` (so an heir who no longer holds the proving state is told "already collected" rather than
being re-paid). No finding.

**5. `commissionPiece`'s COUNT+1 serial.** A serial allocated as `COUNT(*)+1` is the classic
concurrent-duplicate shape. Traced: the table's PK backstops it, so the loser of a race takes a `23505`,
which `deadlockToRetry` maps to a clean `contention` and the caller retries into the next serial. Working
as designed; not a finding.

---

## Verification

- full suite **99 ✅ / 0 assertion errors**, exit 0
- `node tools/sim.js` — §10.4 **drift-0** across every check
- `npm run pgquery` — **2971** static statements parse and type-resolve on real Postgres
- `npm run pgcheck` — **43/43** on a **fresh** database (a dirty database reads exactly like a code
  defect — recorded, and followed)
- `node --check` on all seven touched `src/` files

**Process.** Two probe files written and deleted before committing; the M1 mutation ran on a scratchpad
copy (`cp` out, `cp` back), never `git checkout`, with uncommitted work in the same files.
