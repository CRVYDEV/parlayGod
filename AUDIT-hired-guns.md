# AUDIT — THE HIRED GUNS + the resident-crew interactions (point-in-time)

A focused four-lens red-team over `THE HIRED GUNS` (residents fill a co-op World
raid crew — the `fillHeist` twin on `executeRaid`) and every place a hired NPC
resident touches the crew machinery. The drop shipped with mutation-verified
tests but no adversarial pass; this closes the loop before new content. Lenses:
**§10.4/emission**, **locks/concurrency**, **death/retirement**, **exploit/grief**.

**Result: no CRITICAL, no HIGH, no §10.4 drift. One LOW-MED finding, fixed in
commit with a mutation-verified regression.** The mechanic is a real cash sink
(`world:hire`) plus a pot-split modification, and it makes the apex reservoirs
solo-realizable — that emission surface is measured (sim P9.31) and flagged for
founder sign-off in `BALANCE.md § THE HIRED GUNS`, not a defect.

---

## F1 (LOW-MED) — retiring a hired resident stranded its crew/raid membership

**The finding.** The DEATH path (`runEstate`, the ~40-table wipe loop) deletes a
character's `crew_heist_members` / `world_raid_members` / `pen_break_members`
rows, so a hired hand *dying* between hire and execute drops the leader's crew
gracefully — `executeHeist`/`executeRaid` sees fewer members and the leader hires
a replacement (or disbands). But **`retireResident` — retirement is not a death —
did not**, so a resident retired by the worker's turnover left a stale
`alive=false` member row. Both execute paths lock members
`SELECT * FROM characters WHERE id=$1 AND alive FOR UPDATE`; a retired gun returns
nothing, and the op **bricks on `crew_not_ready` ("One of the crew is in the
ground. Recrew.")** until the leader disbands and re-plans.

`THE HIRED GUNS` makes the World-raid case reachable — before it, only real
players were raid members, and a player retiring *is* a death (the estate wipe).
`fillHeist` made the heist case reachable earlier and it was missed. This is
exactly the **"retirement is not a death"** class `retireResident`'s own comments
already cite (the stranded-loan and phantom-champion findings from the population
audits).

**Severity LOW-MED, and why it is not higher.** No §10.4 leak: a World raid has
no stake, and a heist's stake sits on the LEADER's row (`heist:crew:stake`),
refunded whole on disband to a living leader — so even the bricked-then-disbanded
path conserves exactly. Not player-triggerable: the worker decides retirement,
not a player, so it is not a grief vector. It self-heals via disband or the 1h
`COOP_TTL_MS` stale-sweep. But it is a real parity gap the death path handles and
retirement did not.

**Fix (`src/population.js:retireResident`).** Delete the retiring resident's own
`crew_heist_members` + `world_raid_members` rows, mirroring the death wipe. A
resident is never a LEADER (planning is a player-only route), so a bare DELETE of
its own membership never abandons a plan. This also **upgrades the leader's
recovery from forced-disband to hire-a-replacement** — the row is gone, the crew
count drops, and the leader hires a fresh gun, which is the graceful death-path
outcome. Regression in `test/population.js` (a hired gun in both a live
`world_raids` and a `crew_heists` row, retired, both membership rows asserted
gone); mutation-verified — reverting the World-raid delete fails by name.

---

## Verified CLEAN

**§10.4 / emission.** `world:hire` is a character_id'd cash SINK on the existing
`world:` prefix (per-character cash check reconciles it; zero invariants change —
the treasury check names `world:tribute`/`invade`/`reinforce` explicitly, never a
`world:%` prefix, so a leader's hire fee is never miscounted there). The pot is
`min(strength×GRAB_BPS, GRAB_MAX, strength)` — **crew-independent**; hired guns
affect only the ROLL (odds), never the pot size, so total per-raid emission is
identical to a real crew's and the sim stays drift-0. The split runs over
`realCrew` only and `cartel_damage` is bumped only where a share is paid, so a
hired gun earns no cash faucet row and no war-effort legend — the faucet the fee
prices is WHO takes the (unchanged) pot, not a larger pot. A landed raid never
mints for the gun; a `'done'` raid leaves the gun re-hirable (a merc takes
another job) with no double-count (each raid is a separate roll + reservoir slice).

**Locks / concurrency.** `hireRaid` order: leader (withCharacter) → raid row
`FOR UPDATE` → resident `FOR UPDATE SKIP LOCKED` (last). `executeRaid` order:
leader → member chars SORTED → raid row → `world_npcs`. A resident already in a
planning raid is EXCLUDED from the hire pick, so a resident locked as a member in
one execute can never be the resident a concurrent hire is locking — no shared
row, acyclic. `SKIP LOCKED` means two concurrent hires take DIFFERENT bodies
rather than blocking (real-Postgres only; pg-mem's fallback picks correctly and
cannot exercise the race). Only the leader hires (withCharacter-serialized), and
the `(raid_id, character_id)` PK backstops a duplicate insert.

**Death.** A hired gun DYING is handled — `runEstate` wipes its
`world_raid_members`/`crew_heist_members` row; a LEADER dying is handled by
`abandonRaidsAtDeath` (the existing AUDIT LOW-1 regression). Both drop the crew
gracefully.

**Emission bound / grief.** Hired guns apply to apex (`coop`) outfits only
(`planRaid` throws `solo` otherwise). The success `p` is clamped `[0.1, 0.85]`, so
even a maxed solo-with-guns is never a certainty; per-raid grab caps at
`GRAB_MAX`, the 2h `RAID_CD_MS` bounds cadence, the apex level floor applies to
BOTH the leader AND the hired gun (`respect >= LEVEL_DIVISOR×(minLvl−1)²`, exactly
mirroring `executeRaid`'s own gate so a hired gun is never the reason a go fails),
and base-wide emission stays REGEN-bounded and shared. A leader-only $75k sink on
scarce apex-level residents makes tying-up-residents griefing self-defeating.

---

## Accepted, not changed (noted for the record)

- **A jailed hired gun bricks the go transiently.** If the JAILBIRDS worker jails
  a hired resident between hire and execute, `executeRaid`'s readiness gate throws
  `crew_not_ready` (the jail gate applies to all crew including hired). Rare
  (JAILBIRDS keeps ~2 of ~48 residents in lockup), self-heals when the jail clears
  or on disband, no value stranded — left as-is (the F1 fix covers the permanent
  retirement case; jail is transient).
- **The apex-solo emission surface** (a solo + 1 gun realizes moreau/volkov at
  +$175k/landed raid) is the flagged founder sign-off item, measured in sim P9.31,
  bounded by regen — a balance dial (`HIRE_FEE`/`HIRE_MAX`), not a defect.
