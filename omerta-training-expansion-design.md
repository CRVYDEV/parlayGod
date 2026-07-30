# THE REGIMEN — the training expansion (founder-directed 2026-07-30)

**Founder direction (two messages, one program):** "The entire training system is way too basic. It
needs to be expanded on." / "There needs to be an expansion on how the stats that you roll affect your
progression and character development … more stats that you can train and develop that get interwoven
into the game … daily quests picked up from NPCs to develop these skills and traits and have the users
with something always to do, occupied and clicking to accomplish the next goal."

## What already exists (the honest baseline)

The BUILD layer is deep but split across screens a new player rarely reads: three core stats
(muscle/cunning/speed, the gym), the SKILLS tree (12 skills + capstones + actives + grandmastery), THE
TRADES (10 use-XP mastery tracks with perks + level-50 traits), stats-by-use, Paths v2, and the
Underworld's daily leads + errand chains. Part of "too infant" is that the gym itself — the thing the
coach sends a level-2 player to — is one verb over three numbers. This drop expands the gym itself and
gives the fixtures a daily training quest, and the client puts the whole development picture on one
screen.

## Step one (this drop): THE DISCIPLINES + TRAINER DRILLS

### The disciplines — five new trainable attributes

`REGIMEN.DISCIPLINES` (rules tail). Each is a use-agnostic gym attribute with EXACTLY ONE named
touchpoint (the skills/decree discipline — a new single-site modifier, never a retune of a signed
formula). All numbers are founder sign-off levers; §10.4 surface is ZERO by construction (training
costs energy + the shared gym clock, never cash; XP/levels are not currency; no ledger row anywhere).

| id | name | touchpoint (ONE site) | magnitude at cap 25 |
|---|---|---|---|
| stamina | Roadwork | +1 MAX ENERGY per level (`energyCapOf`, the assetEnergyCap precedent) | +25 on a 50+2·lvl base |
| composure | Steady Hands | +1 MAX NERVE per 2 levels (`nerveCapOf`) | +12 on a 10+lvl base |
| conditioning | Iron Chin | heal cost ×(1 − 100bps·lvl) floored ×0.75 (stacks like doctors_friend) | ×0.75 |
| marksmanship | The Range | + lvl × `DUEL_ADD` (0.6) to YOUR duel score (ELO self-corrects) | +15 on a ~tens-scale contest |
| presence | Work the Room | + lvl to the Underworld STANDING_DAILY_CAP (raw-bump budget) | 25 → 50/day |

Cap axes (stamina/composure) grow the POOL, not the regen — the pacing pass's regen numbers are
untouched. The caps thread through ONE helper pair (`energyCapOf`/`nerveCapOf` in the rules tail) used
by view, coachOf and accrual, so the three sites can never disagree.

### Training — breadth, not rate

`POST /v1/regimen/:id` trains a discipline exactly like the gym trains a stat: 10 energy, the SAME
`train_at` cooldown clock. That sharing is the load-bearing design decision: the pacing pass bounded
the gym at ~20 sessions/hour and a tester-proven multi-day grind to the stat gates — adding five more
things to train on the SAME clock adds CHOICE (what do I build this session?) without adding a single
session of throughput. The lvl-240 class of bug cannot come back through this door.

XP per session: `XP_MIN..XP_MAX` (8–12). Level = `min(CAP, floor(√(xp/XP_DIVISOR)) + 1)` — the
masteryLvlOf curve (fast early ranks, a long tail; level 10 ≈ 120 sessions).

### Trainer drills — the NPC daily quests

Each of the six Underworld fixtures posts ONE drill a day (`drillOf(npc, day)` off the §7.11 seed —
town-wide, forecastable, no stored state): a small task over the kinds `bumpDaily` ALREADY counts
(pull N jobs, N gym sessions, boost a car, N goods trades, melt a car, pull the Score — only
self-sufficient kinds, so every drill is doable alone on day one). Progress is READ from
`daily_progress.counters` — zero new counting surface. Claiming (`POST /v1/regimen/drill/:npc`, once
per fixture per day, `npc_drills (character_id, day, npc)` PK) pays `DRILL_XP` (25 ≈ 2.5 gym sessions)
to the fixture's own discipline — the Doc trains conditioning, Bella marksmanship, Big Tuna stamina,
the Madame presence, Vinnie composure, and Mickey the Corner tops up your WEAKEST. Six claimable
goals a day across the city = the "always something to do, always clicking toward the next goal" loop,
and it walks new players into six different systems.

### Death, estate, §10.4

`character_disciplines` + `npc_drills` DIE WITH THE STREET (runEstate wipe + the migrate DISPOSITION
map) — like stats and skills, unlike prestige. A muscle-memory echo for the heir is a deferred founder
call (it softens death). §10.4: zero `transactions` rows in the whole system — the regimen test proves
a full train+drill cycle writes none.

### Surfaces

`GET /v1/regimen` (disciplines + today's six drills with live progress + claim state), `/v1/rules`
`regimen` block (catalog + trainers), view carries `disciplines` + cap-aware maxEnergy/maxNerve. The
console's Train drawer becomes **THE GYM & THE REGIMEN**: core stats, the five disciplines with XP
bars, and the six trainer drills with progress + claim — one screen that finally shows the whole
development picture (with pointers to the Trades and the skill tree on The Life).

## Deferred (step two+, founder picks)

- Discipline PERKS at milestone levels (the mastery 10/25/40 pattern) — deeper teeth per discipline.
- Muscle-memory echo to the heir (death-softening — a sign-off call).
- Trainer COURSES: multi-day NPC storyline programs (the errand-chain machinery) with a capstone gain.
- Interweaving pass two: disciplines as gates/bonuses on late-game content (a sim-measured drop).

## Sign-off levers (BALANCE.md)

Every REGIMEN.* number; the five touchpoint magnitudes (presence's daily-cap raise and the cap axes
brush measured surfaces — playthrough-remeasure noted); DRILL_XP vs session XP (drills should stay the
efficient path so the loop pulls players across the city).
