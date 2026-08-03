# AUDIT — NPC FAMILIES

Focused red-team over the NPC-families drop (`omerta-npc-families-design.md`), run immediately after it
shipped, on the project's pattern for a pillar-scale build. Four lenses: **§10.4 / lost updates**,
**locks + lifecycle**, **the exclusions as exploit surface**, and **the worker's own scheduling**.

**No CRITICAL. One HIGH (§10.4, reproduced at the seam), two LOW-MED. All three fixed in-commit with a
regression that fails by name under mutation.**

---

## F1 (HIGH) — the founder's cash writeback clobbered a concurrent debit, drifting §10.4

`createGang` deducts the founding fee **in memory** and leaves persistence to the caller — that is the
player path's contract, where `persistCharacter` writes back under the character lock `withCharacter`
already holds. `foundNpcFamily` had no such lock: it picked a founder from a plain
`SELECT … ORDER BY cash DESC LIMIT 32` and later wrote `UPDATE characters SET cash=$2` with an
**absolute** value computed from that read.

So anything that debited the founder between the two was **clobbered by the writeback** — and the
highest-frequency writer against exactly these residents is the ordinary crime **TAKE**
(`takeFromMark`, Street War step three), which targets NPC residents standing in the district by
design. `residentAct` escrow posts and a player robbing them are the same shape.

The damage is a §10.4 drift, not just a lost dollar: `gang:found` books −25,000 while the row only
falls 25,000 **from a stale figure**, so the take's own ledger row is left with no matching movement.

**Reproduced at the seam before the fix**, driving the exact interleave the code has:

```
baseline character-cash drift: 63584          (the probe's own SQL seeding)
cash 200000 → 175000  (honest: 170000)
character-cash drift now: 68584   (ALARM)
CLOBBERED — the take came back: +5000
```

The drift moved by **exactly the clobbered amount**.

**Fixed:** the chosen founder is re-read `FOR UPDATE` and the **locked row** is used from there on,
with affordability and still-ungangged **re-verified under the lock** (they may have been drained, or
have joined a family, since the shortlist). Every other resident writer in the file already follows
this discipline — `retireResident` and `residentAct` both re-read `FOR UPDATE` before writing — so
this is that rule applied, not a new one. Lock order is unchanged and acyclic: characters → gangs,
and `createGang` INSERTs a new `gangs` row rather than locking an existing one.

**Regression:** a source-level tripwire in `test/population.js`, **labelled as one** — pg-mem is a
single caller, so no test in this suite can make two writers race. It pins the three parts that make
the fix correct (the `FOR UPDATE` re-read, that it is taken *before* `createGang`, and the re-verify).
Mutation-verified twice, each caught at its own named assertion.

---

## F2 (LOW-MED) — the flag cleared one way, leaving an unflagged farm target

`removeMember`'s succession cleared `npc_flag` when the chair passed to a player. Correct as far as it
went — a player-run family carrying the flag would be barred from the Commission and the family yield,
a penalty applied to a player by a flag that was never about them.

But **only clearing** leaves a family that briefly had a player boss permanently unflagged. A resident
then inherits it back, and it is a **resident-run family that can be declared war on** — repeatedly,
for the `season_wars` standing that is half the Commission ladder, against an opponent that never
retaliates. That is precisely the fixed-price standing farm the war block exists to stop.

Reachable rather than theoretical: a player joins a local outfit as a soldier, the senior residents
retire over generations (worker-driven), succession hands them the chair, they leave, and the chair
goes back to a resident.

**Fixed:** the flag is **re-derived from the new chair** rather than cleared —
`npc_flag = COALESCE((SELECT c.is_npc FROM characters c WHERE c.id=$2), npc_flag)`. Symmetric, one
statement, and a no-op on real player families since residents only ever join flagged ones.
**Regression + mutation-verified** (restore the one-way clear and it fails by name).

---

## F3 (LOW-MED) — a city that could not afford a new family stopped filling the ones it had

`runFamilies` makes one structural change per tick and checks founding first, then returned
**unconditionally** — including when `foundNpcFamily` returned `false`. So on a city where nobody can
cover `M3.GANG_FOUND_COST` (a drained population; the names pool exhausted), the recruit pass never
ran at all, and families under `MIN_MEMBERS` stayed thin **forever**.

This is the JAILBIRDS-vs-turnover starvation (population audit **T1**) in a second costume: two passes,
one budget, the first taking priority whether or not it can use it.

**Fixed:** return early only when a founding actually happened; otherwise fall through and spend the
tick recruiting. `live` is read before the founding attempt, and we only fall through when founding
failed, so it is still accurate. **Regression + mutation-verified.**

---

## Verified CLEAN (stated rather than assumed)

- **§10.4 shape.** Step one can write exactly two reasons, both already audited: `gang:found` (a SINK,
  paid from the founder's own `npc:seed` cash) and `gang:dissolved` (the existing dissolution burn).
  No new faucet, no new reason, no `invariants.js` change — and `invariants.js` deliberately does NOT
  exclude NPC families, because their treasuries are real buckets holding real ledgered value and
  filtering them would manufacture the drift the check exists to catch.
- **`recruitIntoFamily` has no lost-update surface.** `joinGang` writes no character row — it locks the
  gang, counts members, and INSERTs into `gang_members`. Nothing to clobber.
- **Retirement lock order.** `retireResident` holds the character `FOR UPDATE` (its own re-read) before
  calling `removeMember`, which locks the gang row: characters → gangs, the canonical order, and the
  dissolution path's further locks (turf, territory, frontier, sov, diplomacy) are all singletons-last.
- **No emission through the family.** NPC families never pay tribute, never win wars, never collect
  territory or sov income, and hold a treasury of 0 (founding costs the founder's pocket and deposits
  nothing). A player who joins as a soldier cannot spend a treasury, and a player who inherits the
  chair inherits nothing.
- **The exclusions hold at the query.** Both `seatedGangs` and the family-yield ranking filter
  `NOT npc_flag` explicitly, on top of the `standing > 0` filter that excludes them today by accident.
- **No collision on the `npc` error code** — it is the only `GameError('npc', …)` in the tree, and it
  carries a message, so the client renders it without an ERRMAP entry.
- **Pact / coalition angles are dead ends.** A pact with an NPC family can never be accepted, and it
  would only block a war that is already blocked; a coalition needs a DOMINANT target, and an NPC
  family has no turf and no standing.

## Flagged, not changed

- `recruitIntoFamily` shortlists `ORDER BY id LIMIT 64`. With `POPULATION.TARGET` 48 that covers the
  whole city, but raising TARGET past 64 would let a fully-ganged prefix stall recruiting. A note
  rather than a fix, since the constant that would break it is a pinned lever.
