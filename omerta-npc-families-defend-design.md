# NPC families that DEFEND (NPC families step two, the antagonist leg)

**Status:** BUILT (2026-08-04) — the offensive loop + the severed legend + BOTH retaliation layers:
the inline scene-counter AND **THE MANHUNT** (the scheduled, shield-honouring worker retaliation,
chained so a raider is caught now OR hunted later, never both). `src/npcwar.js`, `test/npcwar.js`,
`sim.js` P-probe. Only NPC-family contestable turf remains a step-three candidate (see the end).

**AS BUILT (deviation from the scoping body below):** the loot is a bounded cash FAUCET off a
regen-bounded `war_pool` strength reservoir (the `world:raid` model exactly), NOT a transfer out of the
NPC family's treasury. This is cleaner and more faithful to "borrow the World outfit" — an NPC family's
treasury is $0 at founding (the `gang:found` cost is a sink), so there was nothing to transfer; the
reservoir gives a bounded, regen-metered faucet with the same interlock. §10.4: `family:raid` is a
bounded cash faucet + ammo sink under the `family:` prefix; `war_pool` is a strength reservoir, not a
§10.4 bucket (the World precedent). The §2/§10.4 sections below describe the original treasury-transfer
idea and are superseded by this.

The founder's step-two candidate list
(`omerta-npc-families-design.md`, BALANCE.md § NPC FAMILIES) names *"NPC families that DEFEND (a war
score, a garrison, spoils worth taking — the cartel-outfit shape, which re-opens the standing faucet)."*
Step one made NPC families joinable shells (real `gangs` rows, deliberately inert: no Commission seat,
no yield, no wars, no turf). This makes them a reason to FIGHT — a PvE antagonist — while solving the
one risk the deferral flagged: **war-score + spoils must not become a Commission-seat farm.**

## The load-bearing decision: borrow the WORLD outfit, not the player-gang war

There are two existing "attack an organization" systems, and picking the right parent is the whole design:

- **Player-gang war** (`declareWar` → `season_wars` / `lifetime_tribute` → Commission standing). This is
  the standing faucet. An NPC family that never retaliates makes `declareWar` a **fixed-price purchase of
  standing, repeatable, with treasury spoils on top** — exactly what the deferral warned about. So NPC
  families stay **un-declarable** (the step-one exclusion holds), and this is NOT the parent.
- **The World outfit** (`WORLD_NPCS`: a strength reservoir, `GRAB_BPS`-bounded loot, `regenPerHr`, a `def`
  garrison, a `routBonus`, co-op raids, the `war_effort`/`WAR_RANKS` **account-level PvE legend**, and the
  frontier's tribute/invasion/uprising). This is the proven cartel-antagonist shape, and it grants a war
  score **without touching Commission standing.** This IS the parent.

So an NPC family becomes an attackable outfit: a garrison to grind, bounded loot from its own treasury, a
SEPARATE PvE "blood war" legend, and — the new piece — it **hits back.**

## The mechanics

### 1. A garrison worth beating (`gangs` gains outfit fields on NPC rows only)
On founding, an NPC family is seeded a `defense` (strength) scaled by its member count and bands —
regen-bounded like a World outfit (`regenPerHr` toward a `max`). This is what stops war being free: you
grind the garrison down with repeated attacks (energy + ammo), and a beaten-down family is cheaper to
hit — the World `enrage`/strength interlock exactly. Player families are untouched (the fields are
NULL/ignored unless `npc_flag`).

### 2. The raid — bounded loot, a §10.4 transfer
`raidFamily` (a `raidNpc` twin): a made man spends energy + ammo to hit an NPC family's operation,
looting `RAID_BPS` (capped) of what its treasury holds. **Spoils are a TRANSFER from the NPC treasury**
(fed only by `npc:seed` at founding + turnover, so bounded by the same turnover budget the population
faucet is metered by — petty by construction, §10.4-neutral). The reason rides the existing gang-treasury
vocabulary as an OUT term on the NPC side and a player cash faucet bounded by that OUT — no new emission
beyond what the population already seeded. A rout (treasury floored) pays a one-time bonus + a streets
event, once, on the CROSSING (the `routBonus` re-farm fix from AUDIT-law-world).

### 3. THE SEVERANCE — a separate war score, never Commission standing
The war score is a NEW `account_persistent.family_war` (or a gang-level `blood_wars`) legend + a
`FAMILY_WAR_RANKS` ladder + `GET /v1/leaderboard/blood-wars` — the `war_effort`/hitman-rep precedent.
It is **PURE STATUS, and it is emphatically NOT `season_wars`/`lifetime_tribute`.** This is the single
decision that closes the flagged faucet: beating NPC families builds a feared-warlord legend that survives
death, but buys **zero** Commission seats. The exclusion must be enforced (a test pins that a
`raidFamily` never bumps `season_wars`/`season_tribute`), because "it's true by construction today" is how
step one's exclusions were described and the explicit check is what stops a later edit re-opening it.

### 4. THE DEFENCE — they hit back (the "DEFEND" in the title)
The reason this is not a one-way purchase: an NPC family whose treasury has been raided **retaliates.**
A worker sweep (the uprising twin) schedules a counter on a recent attacker — an NPC-hitman-style strike
(hospitalization, never a real death — the mod-kill/huntWanted precedent: no chop, no loot, no rep to the
NPC) or a shakedown of the attacker's own front. Bounded: a per-(family, attacker) cooldown, a cap on
open vendettas, and the earned shields (safehouse, bodyguard, revive) still absorb it. So raiding an NPC
family is a real risk decision, not a fixed-price standing buy — which is the whole point of DEFEND.

## What it deliberately does NOT do (the step-one exclusions stay, each decided)

- **No Commission seat, no family yield** — unchanged (§10.4 $OMR into an unspendable reserve; a decree
  moving signed surfaces). The war score is a status axis, outside both.
- **No turf.** NPC families do NOT hold core districts — that overlaps the World OCCUPATION model (5/6
  core districts already start NPC-outfit-held) and the player turf/perk map. Family conflict is the
  garrison/loot/retaliation loop, not a turf grab. (Deferred: an NPC family holding a *frontier-style*
  outpost, if the World and family antagonists are ever unified.)
- **Still un-declarable via `declareWar`.** The formal war system with its Commission implications stays
  player-vs-player; `raidFamily` is the NPC-family path and carries none of it.

## §10.4

- Spoils: a bounded TRANSFER out of the NPC treasury (already a real ledgered bucket in `invariants.js` —
  and it must STAY in the gang-treasuries check, never excluded, or filtering it manufactures the drift
  the check exists to catch — the step-one note, restated). The player-side credit is a faucet bounded by
  that OUT and by the turnover budget.
- The retaliation moves no currency (a hospitalization, the npcHit-absorb shape) — zero §10.4.
- The war-score legend is status — zero §10.4.
- Net: no new emission beyond the population's already-metered `npc:seed`, and the standing faucet is
  severed by construction.

## Sizing (a real pass before build — this is why it's SCOPED, not built)

The garrison strength, `RAID_BPS`, regen, the rout bonus and the retaliation cadence are all new faucet/
risk numbers. The World-outfit numbers (`WORLD_NPCS`) are the calibrated reference — an NPC family should
sit BELOW the weakest World outfit (the Dock Rats, `max` $150k) since its treasury is turnover-seeded, not
a designed reservoir. `tools/sim.js` should gain a probe (the P9.21/P9.25 precedent) measuring the
base-wide loot ceiling and the retaliation pressure before any of it ships. All numbers are founder
sign-off levers.

## Tests

- The **severance**, asserted directly: a `raidFamily` never bumps `season_wars`/`season_tribute`/
  `lifetime_tribute` (mutation: bump it → the Commission-faucet assertion fails).
- Spoils are a bounded transfer that reconciles the gang-treasuries §10.4 check (the NPC treasury falls by
  exactly what the raider gains; sim drift-0).
- The garrison grind (a beaten-down family is cheaper to hit; regen restores it), the rout bonus fires
  only on the crossing (not re-farmable), and the retaliation respects the earned shields + the cooldown.
- Gate matrix: `raidFamily` carries the street-crime gates (jailed/hospitalized/safehoused/level/energy/
  ammo, not your own family).

## Open question for the founder before build

**Is the war score account-level (a personal warlord legend) or gang-level (a family's collective
record)?** Account-level survives death and is the cleaner status axis (the hitman-rep/war-effort twin);
gang-level makes it a family project but dies with the family and needs a dissolution path. The World layer
chose account-level (`cartel_damage`) for the loot and gang-level (`held_by_gang`) for the frontier — a
split this could mirror (personal legend for the loot, a family blood-war record for the vendetta). Decide
before the schema is written.
