# THE POPULATION — NPC residents of the city

**Status:** step one BUILT. Founder-directed 2026-07-25 ("full residents" + "living population").
**Numbers:** every `POPULATION.*` constant is a founder sign-off lever. The one new faucet
(`npc:seed`) is measured in `tools/sim.js` like any other.

---

## The problem

OMERTÀ is a multiplayer game being launched with ~zero players. Almost every social surface reads
from the `characters` table, so in an empty alpha they are all dead:

streets roster · the contract board · the duelling ladder · the Black Market · the Shylock's offers ·
the bodyguard market · the nightlife board · the boxing circuit · the races strip · fade/poker tables ·
crew heists · co-op raids · the Wire's tap targets · Secrets' dig targets

The progression harness measured the consequence exactly: a plausible player reaches **level 128 with
$51M in 30 days having never once interacted with another person**, because there is nobody to
interact with. The content is built; the city is empty.

## The shape

A **living population** of NPC residents that are *real characters* — not per-system filler. One
population lights up every board at once, because every board already reads `characters`.

This follows the precedent the codebase already set with `convoys.is_npc`: an NPC convoy is a real
row in the real table with a flag, driven by the worker, hijackable through the same code path a
player convoy uses. Nothing about the ambush logic knows it's fighting a ghost.

### Identity

An NPC resident is:

| Layer | Row | Why |
|---|---|---|
| `accounts` | a real row, `auth_provider='npc'` | `characters.account_id` is `NOT NULL`; one account per resident matches the one-living-character-per-account model |
| `account_persistent` | a real row, **`npc_flag=true`** | the `agent_flag` twin — the account-level exclusion hook |
| `characters` | a real row, **`is_npc=true`** | cheap filtering for the character-level counts (ops, funnel) |

Two flags, each used where it is cheap, mirroring the two existing conventions exactly.

### Population maintenance

`runPopulation()` (worker) keeps headcount at `POPULATION.TARGET`, spawning across
`POPULATION.BANDS` so the roster spans the level range rather than clustering at the bottom. It also
**retires** residents past `POPULATION.RETIRE_GENERATIONS` so no NPC bloodline accumulates prestige
forever. Spawn is rate-limited per tick (`SPAWN_PER_TICK`) so the city fills in visibly rather than
appearing all at once.

### Death — the heir IS the respawn

Deliberately **no new death path.** An NPC killed by a player runs the ordinary `runEstate`: the
body is looted on the audited loot surfaces, the estate burns what's left, and the heir is born with
the same name at generation+1 — "Sal Fontana II" takes the corner his father held. `social.js` needs
**zero changes**, the population self-heals, and every loot/vendetta/contract interaction a player
has with an NPC is the same audited code that runs against a real player.

---

## §10.4 — the ledger story

This is the part that has to be exact. NPCs hold cash, so they are inside the per-character cash
check; every dollar they hold must have arrived through an enumerated reason.

**Two new reasons, both under a new `npc:` cash vocabulary prefix:**

| Reason | Direction | Meaning |
|---|---|---|
| `npc:seed` | **FAUCET** (character_id = the resident) | the cash a resident is spawned holding |
| `npc:retire` | **SINK** (character_id = the resident) | the cash burned when the worker retires them |

Everything else an NPC touches is an existing audited flow: a fire-kill loots them through
`whack:loot`, the estate burns the remainder through the existing death rows, the heir's legacy
stake is the existing `death:legacy`.

### The faucet, and its bound

`npc:seed` is a **new cash faucet** — that is the honest cost of the founder's "full residents"
choice, and it is why violence-on-NPCs was a decision to make rather than assume. Players extract it
by killing residents and looting the body.

It is bounded by construction:

```
base-wide emission  ≤  TARGET × SEED_MAX × (turnover per day)
```

- **TARGET** caps how many bodies exist at once.
- **SEED** is level-banded and modest — a resident is not a treasure chest.
- **Turnover** is throttled by the player-side cost of a kill: a fire needs a search, ammo, and a
  cooldown. The existing kill economy is the throttle; this adds no new way to kill faster.
- **`M3.LOOT_MIN_LVL` (10) already applies** — low-band residents carry nothing lootable, so the
  cheap end of the population can't be farmed at all.

Measured in `tools/sim.js` (P9.21) and recorded in BALANCE.md.

### Exclusions — what an NPC must never touch

| Surface | Why it must exclude NPCs |
|---|---|
| **The Street Wage** (`emission.js`) | **critical** — residents drawing real emission would be theft from the endowment |
| **City Standing** (`standing.js`) | the "who's winning" board is a human contest |
| **Ops overview** (`ops.js`) | founder metrics must count real players, not scenery |
| **The onboarding funnel** (`growth.js`) | drop-off analysis over fake accounts is meaningless |

Most *other* leaderboards need no change: they rank by `account_persistent` legend columns
(`boxing_wins`, `smuggled`, `statecraft`, `prestige_sunk`, …) that a resident never accrues, so an
NPC is naturally absent. That is a property worth preserving — **if a later step gives NPCs a legend,
its board needs an explicit `npc_flag` exclusion at the same time.**

Referrals are safe by construction: an NPC account has no `referred_by` and never calls a route.

---

## Deliberately NOT in step one

- **Behaviours.** Residents do not yet list on the Black Market, post loan offers, take fade/duel
  listings, or open clubs. They are present, targetable, and interactable — the commerce layer is
  step two, and it is the step that needs care (an NPC that *posts* value is a second faucet).
- **NPC families.** No gangs founded, so the Commission and turf are untouched.
- **Telemetry.** Residents emit none, so `/v1/online` presence stays a true human count. A later
  behaviour step must keep that true or explicitly exclude them.

## Step two (planned)

Give residents a daily behaviour tick: list a car or goods on the Black Market at fair value, post a
small loan offer, set a `fade_limit`/`duel_limit`/`bout_limit` so the tables have takers, and drift
between districts. Each of those moves value, so each needs its own §10.4 reasoning — the discipline
is that a resident may only ever *recycle* value it already holds, never conjure it at the point of
sale.
