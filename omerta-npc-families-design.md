# NPC FAMILIES — the city has families you can join

Founder-directed 2026-08-03, following the onboarding pass that flagged it as a founder call:

> the two rungs the harness still cannot act on (*"Nobody survives alone"*, *"Pull a crew score"*)
> are structurally multiplayer, and the fix is NPC families — residents that found and recruit —
> which touches the Commission, turf and the war loop, so it is a design decision rather than a patch.

> **Build out NPC families next.**

---

## 1. The problem, stated as a measurement

The coach's first social rung is *"Nobody survives alone — join a family or found your own"*, banded
to levels 3–12 where joining genuinely IS the next thing. On a thin server there is nothing to join:
`GET /v1/gangs` is empty, so the rung's only actionable half is FOUNDING one, at level 5 and $25,000
— which a level-3 player does not have, and which gives them a family of one.

The progression harness measures the consequence: over a 7-day solo run the rung held **43% of
advised play** and could never be acted on. It clears on a populated server; on an empty one it is a
wall, and every rung under it goes unseen for that whole stretch.

The population layer already solved the identical problem for the streets roster, the contract
board, the duelling ladder, the Black Market, the Shylock, the bodyguard market and the fight
circuit — with ONE mechanism: **a resident is a real character**, so one population lights up every
board that reads `characters`. Families are the same shape one level up: a family is a real `gangs`
row, so one NPC family lights up the join board, the roster, omertà and the war map at once.

## 2. Why it was deferred, and what has to be decided now

The population shipped with families deliberately excluded, *"so the Commission and turf stay
untouched."* That was the right call then and the reasons are still real. Each is decided here.

### 2.1 THE COMMISSION — an NPC seat is a silent ballot

The chamber seats the top `COMMISSION.SEATS` (5) families by season standing. Each seated family's
boss casts one vote per week; the decree governing the next week is the weighted majority, and
**silence deadlocks**. A family that cannot vote is therefore not neutral — it shrinks the effective
electorate and makes deadlock more likely, which is a real gameplay effect on every player.

Worse in principle: a decree modifies signed surfaces (safehouse cost, war cost, laylow, convoy
defence, the loot rate). Handing any of that to scenery is exactly the wrong direction.

**Decision: an NPC family can never hold a seat.** `seatedGangs` excludes `npc_flag`.

Today this is also true by construction — the query requires `standing > 0`, and an NPC family that
neither pays tribute nor wins a war has standing 0. That is an accident of two other decisions, not
a promise. The explicit exclusion is what a test can pin, and what stops a future step (residents
paying tribute) from silently re-opening it.

### 2.2 THE FAMILY YIELD — the one real value flow

`payFamilyYield` pays the top families by standing out of `family_yield_pool` — a §10.4 $OMR
TRANSFER into `gangs.omr_reserve`. An NPC family drawing that yield would move real player-funded
value into a reserve nobody can ever spend from: not a leak (the bucket is inside `omrBuckets`, so
conservation still holds) but a permanent sink wearing a payout's clothes, and a smaller pot for
every real family.

**Decision: excluded, explicitly, for the same reason and by the same flag.**

### 2.3 WARS — a family that cannot fight back is a farm

`declareWar` costs `WAR_COST` from the treasury; the winner takes 20% of the loser's treasury as
spoils plus standing (`season_wars`, which is half the Commission ladder). An NPC family never
declares, never scores, and never retaliates — so a war against one is a fixed-price purchase of
standing, repeatable, with the treasury spoils as a bonus.

**Decision: step one BLOCKS declaring war on an NPC family** (`npc` error). This is the same
argument that blocks a player from farming a corpse, and it costs nothing today because there is no
war content against them to lose.

Flagged for step two: an NPC family that DOES defend (a garrison, a war score that rises with its
members' levels) would be genuine content — the World's cartel outfits are the precedent for a
defended NPC target. That needs its own sizing pass, because it re-opens the standing faucet.

### 2.4 TURF — step one holds none

An NPC family holding a district would hold a signed turf perk, and seizing it would be a new
on-ramp with its own price curve. The World's step-five OCCUPATION already provides NPC-held core
turf with a liberation cost tied to the outfit's live strength, which is a measured, signed surface.

**Decision: NPC families hold no districts, establish no territory rackets, build no strongholds.**
They are somewhere to belong, not somewhere to conquer.

### 2.5 STATUS BOARDS — safe by construction, and stated

The sov, territory, foundation, megaproject and recruiting boards all filter on a column an NPC
family never moves off zero (`sov_points > 0`, `territory_earned > 0`, `foundation > 0`,
`monument_built > 0`, member recruits). They need no change. `GET /v1/gangs` — the JOIN board — must
of course include them, flagged.

### 2.6 §10.4 — the invariants must NOT exclude them

`invariants.js` sums `treasury`, `omr_reserve` and `ammo_bank` across **all** gangs, and an NPC
family's treasury is a real bucket holding real ledgered value. Excluding it would manufacture the
drift the check exists to catch. Left alone, deliberately, and noted at the exclusion sites so the
next reader does not "finish the job".

## 3. What step one is

**Residents found and fill families, and a player can join one.** That is the whole feature.

- The worker keeps `POPULATION.FAMILIES.TARGET` (3) NPC families alive, each with
  `MIN_MEMBERS`..`MAX_MEMBERS` residents. `MAX_MEMBERS` sits far below `M3.GANG_MAX_MEMBERS` (20), so
  there is always room for a player to walk in.
- Founding runs through **the audited `createGang`**, not a copy of it: the name/tag validation, the
  uniqueness clash check, the ledgered `gang:found` cash SINK and the boss membership row are all the
  same code a player's founding runs. A headless stub supplies `h.ledger` and the caller writes the
  founder's cash back. (A parallel implementation is how the `sackEmpire` rake-cursor drifted; there
  is one founding path.)
- Membership runs through the audited `joinGang` — including its `FOR UPDATE` on the gang row and
  the `GANG_MAX_MEMBERS` count invariant.
- The founding cost comes out of the founder's own `npc:seed` cash. It is a **SINK**, so this adds no
  faucet: the resident economy can only get smaller from it.

### 3.1 The two lifecycle holes it opens, and their fixes

**A retiring resident must leave their family.** `retireResident` is not a death — `runEstate` never
sees it — so today it would leave a `gang_members` row pointing at a dead character: a phantom made
man on the roster, counting against `GANG_MAX_MEMBERS`, and (if they were the last member) a family
that never dissolves and never ledgers `gang:dissolved`, which is a permanent §10.4 treasury drift.
This is exactly the class of the step-two stranded-loan and the phantom-champion findings, and it
gets the same fix: route it through the audited `removeMember`, which handles succession,
dissolution and the ledger.

**A player who inherits the boss chair is running a real family.** `removeMember`'s succession can
hand the chair to a player who joined as a soldier. A family run by a player but still flagged NPC
would be barred from the Commission and the yield — a penalty for a player, applied by a flag that
was never about them. So **the flag clears the moment the boss is not a resident.** One transition,
at the one place succession happens.

## 4. What step one is NOT

- **Not crew heists.** *"Pull a crew score"* is the other structurally-multiplayer rung, and a
  resident filling a crew role would make the co-op heist faucet (measured at 1.46× solo per member)
  reachable by a solo player on demand. That is an emission change and wants its own probe. A crew is
  not a family; this is a separate build.
- **Not NPC family ACTIONS.** They do not pay tribute, post contracts, declare war, seize turf, hold
  territory or vote. Step one's §10.4 surface is exactly two already-audited reasons: `gang:found`
  (a sink, from seeded cash) and `gang:dissolved` (the existing dissolution burn).
- **Not hidden.** The join board flags them, the same way the streets roster flags a resident. In a
  game with real-money extraction, passing scenery off as people is not a call to make silently.

## 5. Levers

All in the `POPULATION.FAMILIES` block, all founder sign-off levers:

| lever | ships at | what it does |
|---|---|---|
| `TARGET` | 3 | families the worker keeps alive. 0 disables the whole feature. |
| `MIN_MEMBERS` | 2 | below this the worker recruits |
| `MAX_MEMBERS` | 5 | never near `GANG_MAX_MEMBERS`, so a player always fits |
| `FOUND_BAND` | capo/boss | which bands can afford to found (the cost is $25,000) |
| `NAMES` | 8 fictional | the pool; fictional only, the Broadcast posture |

## 6. Deferred (step two candidates, each needing its own sizing)

- NPC families that DEFEND: a war score, a garrison, spoils worth taking — the cartel-outfit shape.
- Residents filling crew heist roles (the emission question above).
- NPC families holding turf, on the OCCUPATION model rather than the free-seize one.
- Residents paying tribute (which would give them standing — and therefore re-open §2.1 and §2.2,
  which is precisely why the exclusions are explicit rather than incidental).
