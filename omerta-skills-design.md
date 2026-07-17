# Skills & Specializations (design)

## 1. Why
The game had stats, level, and prestige — but no BUILD. Two level-40s played identically. A
skill tree gives long-horizon goals per street and makes specialization real: the Enforcer, the
Operator, and the Wheelman feel different in the hands.

## 2. Shape
- Three branches × three tiers. Tier costs 1/2/3 points; the previous tier is the prerequisite.
- Points DERIVE from level: `floor(level / LVL_PER_POINT)` (1 per 4 levels). Never stored, never
  granted — there is no point currency and no §10.4 surface. One maxed branch = level 24, two =
  level 48, all three ≈ never: choices bind.
- **Skills die with the street** (estate wipes `character_skills`) — like stats, unlike
  prestige. The heir rebuilds; prestige's legacy stake already softens restarts.
- **Respec** burns `RESPEC_OMR` (10 $OMR, `respec:skills` — rides the `respec` vocabulary
  prefix and the widened `respec%` burn term) on the SHARED M8 respec cooldown
  (`characters.respec_at`) — the trainer sees you once a day, for stats or skills.

## 3. The tree (all FX are NEW single-touchpoint modifiers — founder sign-off levers)
| Branch | T1 (1pt) | T2 (2pt) | T3 (3pt) |
|---|---|---|---|
| **Enforcer** | Bruiser — jump & shakedown attack ×1.08 | The Doc's Friend — healing ×0.75 | Executioner — hit searches ×0.8 time |
| **Operator** | Fast Talker — laylow ×0.8 | Fence Network — fence & melt yields ×1.08 | Broker — Black Market listing fees ×0.5 |
| **Wheelman** | Pack Mule — trunk +3 | Getaway — crime stints ×0.8 | Road Captain — your convoys ×0.8 time |

## 4. Discipline (why these nine and not others)
Every effect reads one helper (`hasSkill`/`skillMult`/`trunkCap` from game.js) at exactly one
site, and the tree deliberately stays OFF the audit-locked surfaces: **no heat-deterrent
discounts** (fire/launder heat are audit fixes), **no loot-exposure windows** (bank in-transit /
unbonding are Make-Risk-Pay surfaces), **no extraction caps** (wash/launder buckets), **no kill
economics** (btk/ammo/loot rates), **no accrual curves** (income/interest are signed). The
Executioner search multiplier composes with the TEST-ONLY `SEARCH_MS` knob at both of the
hunter's clock sites so they always agree. Pack Mule routes through `trunkCap(h)` everywhere a
player trunk is measured (goods buy, market pickup/claim/reclaim, convoy load/hijack/collect).

## 5. §10.4
Zero new money flows except the respec burn (`respec:skills`, account-side, in the widened
`respec%` burn term). Points aren't a currency. Effects are multipliers on flows that are
already ledgered at their sites (the discounted/boosted number is what's ledgered — the
amnesty-decree precedent).

## 6. Step two (deferred)
ACTIVE abilities with cooldowns (a second search slot, a one-shot convoy escort), branch
capstones at a fourth tier, prestige-carried skill slots (a founder call — it would soften
death), and per-skill respec (unlearn one, not all).
