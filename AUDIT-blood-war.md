# AUDIT — THE BLOOD WAR + THE MANHUNT (2026-08-04)

A focused adversarial pass over the NPC-families DEFEND drop (`src/npcwar.js`): the `raidFamily` loop, the
`sweepFamilyAggro` manhunt worker, and the population/estate surfaces they touch. Four lenses:
§10.4/faucet, concurrency + lock order, estate/dissolution, exploit/grief. Every concern re-verified
against source. **No CRITICAL, no HIGH, no MED — CLEAN.** The feature closely follows the audited
`world:raid` pattern, which is why it inherits that pattern's safety.

## §10.4 / faucet — CLEAN

- **The loot is a bounded, regen-metered faucet, not a treasury transfer.** `family:raid` cash credits the
  raider (character_id'd → the per-character cash check reconciles it) and drains `war_pool` by exactly the
  loot; `war_pool` regens toward `POOL_MAX` at `POOL_REGEN_HR`, so total emission ≤ `regen × time` per
  family (sim probe: ≤ $288k/day base-wide across 3 families, below the weakest World outfit). `war_pool`
  is a strength reservoir, NOT a §10.4 bucket (the world strength precedent).
- **The gang treasury is untouched by a raid** (verified: the gang-treasuries invariant sums gang-reason
  rows with a NULL character_id; `family:raid` carries the raider's character_id and rides the per-character
  cash check instead, so a raid produces zero treasury movement and no drift). The `counterparty=gangId` is
  metadata only.
- `family:raid` joined both the cash and ammo `KNOWN_REASONS` — the vocabulary check stays closed; the full
  sim holds drift-0 with the faucet live.
- **The manhunt moves no currency** (a hospitalization) — zero §10.4.

## Concurrency + lock order — CLEAN

- **`raidFamily` locks char → gang** (the raider is held by `withCharacter`; then `SELECT gangs FOR UPDATE`
  on the target). This is the canonical order (characters → accounts → gangs → singletons). Every other
  `gangs FOR UPDATE` in the tree (diplomacy, `social/gangs.js`) also runs inside a `withCharacter`, i.e.
  char-first, so there is no operation that locks a gang before a character — no AB-BA. The raider's OWN
  family is only READ (the `own_family` check), never locked, so no two-gang cycle.
- **The manhunt worker is lost-update-safe.** `sweepFamilyAggro` locks the target `characters` row
  `FOR UPDATE` and writes `hosp_until` by direct SQL (headless — the `huntWanted` pattern). A concurrent
  player action on that character takes the same `FOR UPDATE` in its `withCharacter`, so the two serialize:
  whichever runs second reads the other's committed row, and the player's `persistCharacter` writes back the
  value it loaded under the lock. No clobber in either order.
- Per-row txn isolation in the worker (a poison row can't starve the tick — the `safe()`/sweep precedent).

## Estate / dissolution — CLEAN

- **A dead raider isn't hunted**: `family_aggro` is estate-wiped by `target_character` (in `runEstate`), and
  the worker independently checks `alive` (a target dead before the wipe races → `t` null → the row is
  deleted, no strike). Belt and suspenders.
- **A dissolved NPC family**: its `war_pool` dies with the gang row; a dangling `family_aggro` row is
  cleaned on the next sweep (the worker's `SELECT … WHERE npc_flag` returns null `g` and still deletes the
  row). An NPC family's treasury is $0 (the `gang:found` cost is a sink), so dissolution reconciles the
  gang-treasuries check with no drift.
- `family_aggro` carries a `migrate.js` DISPOSITION entry.

## Exploit / grief — CLEAN

- **Sybil / alt-farming is bounded by the SHARED reservoir**, not per-attacker: N raiders (or alts) compete
  for the same `regen`-bounded `war_pool`, so alts cannot multiply the faucet beyond the base-wide ceiling
  (the world:raid anti-Sybil property). The per-attacker `family_raid_at` (4h) caps a single raider at ~one
  raid / 4h across ALL families.
- **The retaliation is self-inflicted** (it targets the raider, who chose to raid) — not griefable by a
  third party. One pending per family; a single raider can hold at most one pending manhunt (they're on
  cooldown otherwise). Shield-honouring, so the earned defences (safehouse/witpro/Pen/hospital/lockup) let a
  raider dodge it.
- No self-dealing: a player cannot found an NPC family, and a player who JOINED one (step one) is blocked
  from raiding it (`own_family`); the board excludes the raider's own gang.

## Flagged, NOT patched (design notes, not defects)

- **`raiderPower` uses raw `muscle + cunning/2`, not `effStat`** (so gear/assets don't boost blood-war raid
  odds, unlike a World raid). A deliberate simplification — `raidFamily` doesn't load `h.owned` gear/assets,
  and a pure stat contest is defensible. If parity with World raids is wanted, thread the loaded gear.
- **A `war_pool_at`-NULL family regens to `POOL_MAX`** regardless of stored `war_pool` (a live-DB migration
  edge for a family founded before this feature). This is bounded (never above `POOL_MAX`) and desirable (an
  old NPC family becomes raidable at full strength) — intended, not a leak.

## Verdict

The Blood War and the Manhunt are a faithful application of the audited `world:raid`/`huntWanted`/frontier
patterns, and inherit their safety. No changes required.
