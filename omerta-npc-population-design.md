# THE POPULATION — NPC residents of the city

**Status:** steps one + two BUILT. Founder-directed 2026-07-25 ("full residents" + "living population").
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

## Step two — THE CITY ACTS (BUILT)

`runResidentBehaviour` gives `ACT_PER_TICK` residents one turn each worker tick. **The one rule: a
resident may only ever RECYCLE value it already holds, never conjure it at the point of sale.** So
step two adds **no new faucet and no new §10.4 reason** — every behaviour is either zero-value or
parks already-seeded cash in an existing audited escrow that the existing sweeps refund on expiry.

| Behaviour | What it lights up | §10.4 |
|---|---|---|
| **Consent limits** — `guard_price` / `fade_limit` / `duel_limit` | the bodyguard market, the back-room fade board, the duelling ladder — all three are consent-by-listing, so an empty alpha has *nobody to play against* without them | zero value (column writes) |
| **The Shylock** — a SECURED loan offer | the Shylock's board | `loan:offer` (existing escrow) |
| **The Black Market** — a standing buy order | the market board, and a reliable cash buyer for goods a player actually holds | `market:list` + `market:order` (existing escrow) |
| **Drift** — move district | the city moves | zero value |

**Why each consent limit obeys its own system's floor** (red-team F1–F3). Those three columns are
written by **direct SQL**, which bypasses `offerBodyguard` / `listDuel` / `setFadeLimit` and every
bound they enforce. So each is gated by the constant its own system owns:

- `guard_price = max(M3.BODYGUARD_MIN_PRICE, 12% of cash)`. A guard price is income the resident
  **receives**, not a stake they must **cover** — sizing it to holdings was a category error copied
  from the two stake columns, and it sold a lethal-hit absorb for a few hundred dollars against a
  floor Phase 1.3 deliberately set at **$10,000** for safehouse parity.
- `duel_limit` only when 9% of cash clears `DUELS.STAKE_MIN`. Below it, `amt >= STAKE_MIN && amt <=
  limit` is an **empty window** — an entry nobody can ever act on. A short honest ladder beats a
  long decorative one.
- `fade_limit` bounded by `CASINO.MIN_BET`/`MAX_BET`.

A stake that the resident's cash no longer covers (they've been drained) triggers a **relist**,
dropping them off the board rather than leaving a listing that can only answer `their_cash`.

**Why residents lend SECURED only.** A resident never calls `collectLoan`, so an *unsecured* NPC
loan would be free money for a defaulter — `LOAN.MAX` is $1M against a $50k square cost. Requiring
collateral worth `LOAN_COLLATERAL_MULT` × what's owed means the **already-audited grace-forfeit
sweep** seizes a pledged car worth more than they borrowed. Recourse without an NPC ever acting.

**Retirement pulls escrow back first.** A retiring resident cancels its open offers and orders
(`loan:refund` / `market:refund`, mirroring the audited cancel paths) before the burn — otherwise an
offer would stand on the board forever with nobody behind it, and a player could take a loan from a
lender who no longer exists.

**Measured, before → after** (empty alpha, then the city filled in):

| Board | before | after |
|---|---|---|
| streets roster | 1 | 49 |
| loan offers | 0 | 12 |
| market listings | 0 | 11 |
| duelling ladder | 0 | 20 |
| bodyguards for hire | 0 | 21 |

§10.4 clean throughout.

**The open founder call — the city DEPLETES.** Residents have no income, so once players drain the
seed pool (duels, fades, order-fills, kills) the boards go quiet again: stakes stop clearing the
floors, loan offers stop firing below `LOAN.MIN`, orders stop. Step two lights the city up **once**.
Making it renewable — resident income, or retiring-and-respawning a *broke* resident rather than only
an old bloodline — turns a one-shot ~$998k into a **recurring faucet**, so it's a balance decision
rather than a bug fix. It partly recycles unaided: `hireBodyguard` and loan repayment both pay cash
*into* residents. Flagged in BALANCE.md; the red-team write-up is `AUDIT-population.md`.

**Still deliberately NOT done:** residents don't emit telemetry or bus events, so `/v1/online`
presence stays a true human count and the feed isn't padded with fake activity. No NPC families, so
the Commission and turf are untouched. Residents don't *take* the other side of a player's listing
(they post their own), which keeps every interaction player-initiated.
