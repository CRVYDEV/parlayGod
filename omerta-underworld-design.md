# The Underworld — NPCs as relationships (design)

## 1. Why
The game is mechanically rich but faceless: every action is a menu. A small cast of NAMED
fixtures — each attached to one existing loop — turns flat actions into relationships. Skills
are *what you are*; the Underworld is *who you know*.

## 2. The cast (step one: four, one per loop)
| NPC | Loop | Standing earned by | T1 (25) | T2 (60) | T3 (90) |
|---|---|---|---|---|---|
| **Doc Moretti** | survival | heals, discharges | healing ×0.9 | **early discharge** — pay to halve a hospital stay | discharges release IN FULL |
| **Vinnie the Match** (the Fixer) | PvP/contracts | posting contracts, NPC hits, confirmed kills | NPC hitmen ×0.9 | your contract-post FEE is waived (the street tax stands) | your searches place ×0.9 faster |
| **Bella Bang-Bang** (the Armorer) | gear | guns, crafts, ammo boxes | guns ×0.9 cash | workshop crafts ×0.9 cash | she BUYS BACK guns at 30% |
| **Big Tuna** (the Harbor Master) | trade | convoys, market listings | guard fees ×0.9 | your listings run 72h (vs 48) | a fourth market listing slot |

## 3. Standing
- Per-character 0–100 (`npc_standing`), earned by DOING BUSINESS (actor-side bumps at the
  loop's touchpoints: heal +2, gun +3, craft +1, ammo +1, contract post +3, NPC hit +4,
  fire-kill +5, convoy depart +2 / collect +3, listing +1). Never decays (trade_rep precedent).
- **Gifts** (`underworld:gift`, a $5k cash sink): +5 standing — but ONLY below 50. Money opens
  doors; the top tiers are earned. (The Commission audit's purchasable-standing critique is
  answered structurally here.)
- Tiers at 25/60/90. Standing DIES WITH THE STREET (like stats/skills; "bloodline memory" is a
  step-two option — the Doc remembering your father is great lore, but it softens death).

## 4. Discipline (ground rule #1)
Every perk is a NEW single-touchpoint modifier (the skills/decree precedent), stacking
multiplicatively where it overlaps a skill (Doc ×0.9 with doctors_friend ×0.75; Fixer search
×0.9 with executioner ×0.8 → 0.72, flagged as PvP-throughput stacking). Deliberately UNTOUCHED:
$OMR burns (vests), ammo prices (the D1-signed kill-EV anchor), heat deterrents, loot-exposure
windows, extraction caps, income curves. New money flows, all ledgered + vocabulary'd
(`underworld:`): `gift` (sink), `discharge` (sink — remaining minutes × DISCHARGE_PER_MIN,
halved stays T2 / full release T3), `gunsale` (a small bounded FAUCET: 30% of the gun's cash
price, once per owned gun — flagged for the sim pass). Standing itself has no §10.4 surface.

## 5. Step two (deferred)
The Madame (a fifth NPC on the den/intel loop), bloodline memory (standing partially inherited),
NPC LEADS (daily rotating jobs from your best relationship), standing decay, rivalry (helping
one NPC costs standing with another).
