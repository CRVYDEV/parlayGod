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

## 5. Step two — BUILT (all numbers in `UNDERWORLD.STEP2`, founder sign-off levers)
Relationships that LIVE — they open, cool, feud, and outlive you a little:

- **The Madame** (the fifth fixture, den/intel loop). Earned by den play (dice +1/round, numbers
  +1/ticket, back-room fade +3, fight bet +2 — actor-side like everyone). T1 **the comped seat**:
  dice cost no nerve (pacing QoL — the house edge still gets paid, so this is a sink
  *amplifier*). T2 **the velvet rope**: the high-stakes room opens at any level (an ACCESS perk;
  odds/limits inside are untouched). T3 **pillow talk**: the board shows how many hunters
  currently have a search out on you — a COUNT, never a name (the $OMR peek stays the only
  name-piercing intel; flagged as a defense-intel lever).
- **The daily LEAD** (`npc_leads`): the FIRST business bump each day with your BEST fixture
  (highest standing ≥ LEAD_MIN 25) pays +LEAD_BONUS 5, once. Gifts are not business and never
  claim it. Simplified from "rotating jobs" — the job is *doing business at all*; task variety
  is a step-three option.
- **Standing DECAY** (lazy, §7.1 pattern — no cron): past DECAY_GRACE_DAYS 7 idle, a standing
  cools DECAY_PER_DAY 1 toward DECAY_FLOOR 25 (tier 1 — old friends stay friends, the inner
  circle needs upkeep; below the floor nothing decays). The EFFECTIVE value is what every read
  and every perk uses; the stored row catches up on the next bump.
- **RIVALRY**: the Doc took an oath — a fire-kill or an NPC hire costs RIVAL_LOSS 2 Doc
  standing (the doctors-friend assassin now maintains two relationships in tension). One pair
  only, kept legible.
- **BLOODLINE MEMORY**: the heir inherits floor(standing × MEMORY_BPS 25%) with each fixture
  ("the Doc remembers your father"); sub-1 remainders are forgotten, the clock restarts. A
  deliberate, DIALED soft corner on "everything dies with the street" — MEMORY_BPS 0 restores
  the hard rule; at 25% even a maxed street hands down ~22, below tier 1.

Zero new money flows in all of step two — every mechanic is status/access/pacing, §10.4
untouched by construction.

## 6. Step three — BUILT (levers in `UNDERWORLD.STEP3` + `tasks` on the cast)
- **Rotating lead TASKS**: the daily lead is now a specific job, drawn per day per fixture off
  the §7.11 seed (`leadTaskOf` — the same draw for the whole town: "the Doc needs a hand at
  the clinic today"). Off-task business with your best fixture pays flat; only the drawn task
  claims the +5. Task lists hold only ALWAYS-repeatable actions (heal; post/hire; craft/ammo;
  depart/list; dice/numbers) so no day draws a dead lead (the undrawable-daily-contract gap is
  deliberately not reproduced here).
- **Rivalry pair #2 — road piracy picks a side**: a convoy ambush ATTEMPT (win or lose — the
  attempt is what the town hears) pays Bella +AMBUSH_ARMORER 2 and costs Big Tuna
  −AMBUSH_HARBOR 2. The bandit build now trades against the shipper relationship it preys on.
- **GRUDGES — the names remember who you whack**: killing a character who was a REAL friend of
  a fixture (effective standing ≥ GRUDGE_MIN 60) docks the KILLER GRUDGE_LOSS 5 with that
  fixture — a fire-kill charges the shooter, an NPC hit charges the PAYER, mod-kills have no
  killer and bear no grudge. Read from the victim's loaded standings before the estate wipe;
  returned as `grudges` on the kill response. Composes naturally: the loss echoes down the
  killer's bloodline through step-two memory, and a doc-connected victim stacks with the Doc
  rivalry (−2 attempt −5 grudge). Whacking a connected man now burns your own bridges — social
  cover is a real, earnable defense layer that costs the attacker STATUS, never money (§10.4
  untouched by construction, like all of steps two and three).

## 7. Step four — BUILT (levers in `UNDERWORLD.STEP4`)
- **Grudges with TEETH**: a grudge is now recorded state (`npc_grudges`, count per fixture),
  not just a standing loss. While a fixture holds one, your tier with them CAPS at
  GRUDGE_TIER_CAP 2 — they still do business, they just won't do favors (standing 95 reads
  tier 2; every T3 perk site inherits the cap through `npcTier`). Grudges die with the street
  (the fixtures forgive the dead — the standing loss still echoes via bloodline memory).
- **PENANCE**: `POST /underworld/:npc/penance` squares ONE grudge for PENANCE_COST $25k — a
  ledgered `underworld:penance` cash sink (rides the existing vocabulary prefix). Squaring
  buys back SERVICE, never friendship: no standing moves. 'clean' when nothing is held.
- **The WEEKLY FAVOR**: `POST /underworld/:npc/favor` — one per street per week
  (`npc_favors`), from any UN-grudged tier-3 fixture. Every favor is a RESOURCE package,
  never money and never a §10.4 currency: the Doc patches you to 100, the Madame refills
  nerve, Big Tuna refills energy, Bella's boys repair your worst car overnight ('nothing' if
  the garage is clean — a refused errand doesn't burn the week). Vinnie deals in debts, not
  gifts ('debts'). This absorbs the old "den-comp ladder / Madame sends work" ideas.
- **Lead STREAKS**: consecutive claimed lead days sweeten the bonus — +1 per prior day on the
  +5, capped at STREAK_BONUS_CAP +5 (day 6+ pays +10). The streak lives on the `npc_leads`
  row (yesterday's streak + 1); a missed day resets to 1.

Money in step four: ONE new legible cash sink (penance). Everything else is status, access,
and resources — §10.4 untouched beyond the vocabulary the prefix already covers.

## 8. Step five — BUILT (levers in `UNDERWORLD.STEP5`)
- **GRUDGE DECAY** — time heals what money can't: one grudge is forgiven per
  GRUDGE_DECAY_DAYS 14 since the last write (`npc_grudges.since`); a fresh offense — or a
  penance — restarts the clock. Lazy (§7.1): the EFFECTIVE count is what the tier cap and the
  board read; the stored row materializes on the next write. Penance always settles the
  effective count — you never pay for what time already healed.
- **THE ERRAND CHAIN** (NPC storylines): `POST /underworld/:npc/errand` — a tier-1+ fixture
  hands you a job: do their DRAWN daily task on CHAIN_STEPS 3 separate days and the
  relationship jumps CHAIN_BONUS +15 (plus the streets hear about it). One step a day, one
  active chain per street; starting another replaces the half-done job. Rides the step-three
  task machinery inside `bumpStanding` — works for ANY fixture you took the job from, not
  just your best (chains are how you BUILD a second relationship).
- **RIVALRY #3** — nobody fixes HER book: buying the fight referee (`fixFight`) costs the
  boss FIX_LOSS 5 with the Madame. A social tax on the Sybil-flagged fix surface — status,
  never money, so the signed den economics are untouched.

Design calls made honestly rather than built as filler: **favor menus** are ABSORBED — the
step-four favor already IS a menu (you pick which tier-3 fixture to call on); adding second
options per fixture produced only strict-upgrades or filler, so no fake choices shipped.
**Vendetta-refusal** (a fixture refusing you while you hold a vendetta against their other
friend) is DEFERRED with cause: it needs a vendettas→target-street→their-standings join on
hot perk paths, and play-tests legibility poorly ("why won't the Doc talk to me?") — revisit
if live data shows vendettas need more social weight.

## 9. Step six (deferred)
More rivalry pairs, favor menus with real tradeoffs (if any emerge), vendetta-refusal (see
above), errand chains that cross fixtures (a story that passes you from the Doc to Vinnie).
