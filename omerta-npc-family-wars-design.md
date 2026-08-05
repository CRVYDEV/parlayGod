# NPC FAMILY WARS — scope + sizing (a founder decision artifact, 2026-08-05)

> **BUILT 2026-08-05 (founder-directed "build it").** This note originally recommended HOLD (below).
> The founder directed the build, so it shipped under the FOUR §10.4-safe constraints spelled out here,
> exactly the way every Blood War / Conquest drop shipped: **§10.4-NEUTRAL by construction** (the only
> value flow is the EXISTING `gang:war` treasury sink at declaration — no spoils, no NPC-treasury seed,
> no new faucet; the score and the win trophy are STATUS, never `season_wars`), with the numbers as
> PROPOSED DEFAULTS flagged for sim + sign-off (BALANCE.md § THE FAMILY WAR). Implementation:
> `declareNpcWar` / the raid-scoring hook / `sweepNpcWars` / `familyWarWinsLeaderboard` in
> `src/npcwar.js`, the `npc_wars` table, `FAMILY_WAR.WAR` in the rules tail, routes
> `POST /v1/npcfamily/:gangId/war` + `GET /v1/leaderboard/family-wars`, and a Blood-War-tab UI. The
> analysis below stands as the record of WHY it takes this exact shape.

This resolves the last "deferred content step" from the resident-economy arc. The one genuinely-unbuilt
item touches SIGNED surfaces (the standing faucet, turf, war spoils), so the build stays inside the
four constraints below to keep them severed. It also corrects the deferred list, because two of the
three items I had been carrying as "gaps" are in fact already shipped.

## What is ALREADY BUILT (correcting the deferred list)

- **Residents fill CO-OP crew roles.** `src/heists.js:fillHeist` hires a resident hand into a crew
  heist (its firepower/role counts, it forfeits the cut, no legend/xp/rwa/respect — `hiredIds` in
  `executeHeist`), and `src/world.js:hireRaid` (THE HIRED GUNS) does the same for a World raid. Both
  are the same audited hired-hand shape; `retireResident` cleans up both membership tables, and — as of
  the cross-system red-team this session — `NOT_ON_A_JOB` now makes a resident on EITHER planning op
  inert (never retired out from under a fee the leader paid). So "residents filling crew-heist roles"
  is done; it is not a gap.

- **NPC families DEFEND.** The Blood War (`src/npcwar.js`) already makes an NPC family a real, defended
  antagonist: `raidFamily` loots a bounded `war_pool` (the `family:raid` faucet, regen-metered ≤ ~$288k/
  day base-wide), THE DEFENCE counters or runs a shield-honouring MANHUNT (`sweepFamilyAggro`), and THE
  CONQUEST routs a family into a tribute-paying vassal (`family:tribute`). It has its own red-team
  (`AUDIT-blood-war.md`, two passes) and sim measurement. So "NPC families that defend" is largely done
  — through the RAID verb, not a formal war declaration.

## The ONE unbuilt item: a formal WAR DECLARATION on an NPC family

The remaining gap is narrow: a player cannot `declareWar` on an NPC family the way they can on another
player's family — with a war chest, a scoreboard, turf seizure, and spoils. The Blood War substitutes
for the *experience* (attack an outfit, it fights back), but it is a raid loop, not the war loop.

**Whether this is worth building at all is the first founder question**, because it is mostly redundant
with the Blood War and it re-opens two things the NPC-families design deliberately shut:

1. **`season_wars` → seasonal standing → Commission seats.** The NPC-families design excluded NPC
   families from wars precisely because *"an opponent that never retaliates makes war a fixed-price
   purchase of standing, repeatable, with treasury spoils on top."* A player farming declare-war-on-NPC
   for `season_wars` would buy Commission standing at a fixed price — the exact exploit the econ-pass
   fix (seasonal, re-contestable standing) closed. The `commission.js` seat formula reads
   `season_tribute + 10000×season_wars`, so any war-score grant here is a direct standing faucet.
2. **Treasury spoils.** A war win on a player family loots a slice of the loser's treasury. An NPC
   family's treasury is $0 by construction (the `gang:found` cost is a sink), so there is nothing to
   loot — but if the feature ever seeded an NPC treasury to make spoils "work," that seed is a new cash
   faucet, and the spoils are then a fixed-price cash purchase.

## The ONLY §10.4-safe shape, if it is built

Four hard constraints, each load-bearing — a build that violates any one re-opens a signed faucet:

1. **NO `season_wars` grant.** A war fought against an NPC family scores toward NOTHING that feeds
   Commission standing. Give it a SEPARATE, purely-cosmetic record (a `war record` status axis, the
   hitman-rep posture) if a scoreboard is wanted — never the seasonal-standing column. This is what
   keeps it off the purchasable-standing ladder.
2. **NO treasury spoils and NO NPC-treasury seed.** The reward for warring an NPC family is exactly the
   EXISTING Blood War faucet (raid its `war_pool` while the war is live) — a bounded, regen-metered,
   already-audited surface — plus the status record. Zero new cash reason.
3. **MANDATORY retaliation.** The family must fight back, or the war is a free repeatable status buy.
   The Blood War's DEFENCE (counter + manhunt) is the retaliation primitive; a formal war would need
   the family to also strike the declarer's family on a worker cadence (a bounded, shield-honouring
   hospitalization — the `sweepFamilyAggro` pattern, no §10.4). Sizing: strikes/day, the shield set.
4. **Turf via the OCCUPATION model or NOT AT ALL.** A war win must not hand a player a district for
   free (that is the signed turf surface). Either route it through the existing NPC-occupation
   liberation cost (`world.js:outfitStrengthFrac` — you pay to take held turf, scaled by how beaten
   the outfit is) or grant no turf at all. Never a free seize.

Under all four, the feature is §10.4-NEUTRAL by construction: it adds no cash/standing faucet, reusing
the Blood War loot faucet and a status-only record, with retaliation as pure pacing.

## Sizing levers, for founder sign-off (proposed defaults TBD, sim before production)

- war-declaration cost (a cash SINK from the declarer's treasury — the `declareWar` precedent);
- retaliation cadence + the strike's bounded effect (hospitalization window; the `FAMILY_WAR.COUNTER`
  numbers are the anchor);
- the war-record status ladder (cosmetic; agent/resident-excluded like every status board);
- whether turf is reachable at all, and if so the occupation-liberation cost multiplier.

## Recommendation

**Hold the build; it is low marginal value over the shipped Blood War and carries the standing-faucet
risk.** If the founder wants the formal war loop anyway, build it under the four constraints above with
the sizing levers as proposed defaults, a sim probe (the `family:raid` measurement is the template),
and a BALANCE.md sign-off flag — the same convention every Blood War / Conquest drop shipped under. The
one concrete win available cheaply and safely is already delivered: residents make the family boards,
the crews, and the Blood War live in a thin alpha, which is what the "Nobody survives alone" / "Pull a
crew score" coach rungs needed.
