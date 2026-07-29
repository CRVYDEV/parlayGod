# OMERTÀ — THE TRADES (mastery expansion)

**Founder direction (2026-07-29):** expand the trait and stat system significantly; encourage
RuneScape-like farming of the stat and skill trees; more paths with specialties AND disadvantages
between them.

**Founder decisions (same day, asked before design):**
1. **Death rule — die + bloodline echo.** Mastery levels die with the street; the heir inherits
   `MASTERY.HEIR_KEEP_BPS` (2500 = 25%) of each track's XP (the honor/Underworld echo pattern, a
   dial that can go 0 or up); PLUS a lifetime account-level XP legend per track that survives whole,
   for rank titles and leaderboards only.
2. **Path teeth — progression speed.** A path's home masteries farm faster, rival masteries slower,
   plus ONE signature power perk and ONE small signature handicap per path. The same action always
   pays the same money — the sim-signed cash economy is untouched by the primary mechanism.
3. **Stats by use — yes, tightly capped.** Mastery actions drip XP toward the matching core stat,
   on the gym's own diminishing curve, under a hard daily cap, with the progression harness re-run.

---

## Why this shape (grounded in the map, `wf_0dad60a5-cc9`)

The codebase already contains every pattern this needs, which is why the design is mostly
*generalisation*, not invention:

- **`trade_rep` → `TRADE_RANKS` is a one-track RuneScape skill** — XP accrues on deal gross, ranks
  gate drugs and grant a price bonus. THE TRADES is that mechanism made general.
- **`bumpStanding` (game.js) is the funnel shape** — one shared helper with action tags, called
  inline at ~20 touchpoints, feeding daily leads/errands/campaigns. `bumpMastery` is its twin, and
  paths/stat-drip integrate INSIDE the funnel so there is exactly one place the rules live.
- **`npc_standing` is the storage shape** — `(character_id, track_id)` PK, NUMERIC, UPDATE-then-
  INSERT upsert with absolute values, loaded through loadOwned's UNION, wiped at estate, echoed to
  the heir at a BPS dial.
- **Duel styles prove the axis-without-a-column trick**; the skills/decree/Underworld precedent
  proves single-touchpoint perks; the season/lifetime duality (season_kills vs hitman_rep) is the
  established two-faces shape the legend follows.

**The hard constraints it must live inside** (each from a named source in the map):
- Respect stays the ONLY level currency — masteries pay ZERO respect, gate ZERO character levels
  (the level-240 speedrun class). They are the trade_rep class: domain tracks gating domain perks.
- Perks attach ONLY as new single-touchpoint multiplicative modifiers OFF the audit-locked list (no
  heat-deterrent amounts, no loot windows, no extraction caps, no kill economics, no signed income
  curves, no $OMR burn prices, no exact-wealth disclosure). Signed floors re-assert after mults.
- XP sources are bounded by the resources that already pace the game (nerve/energy/cash/cooldowns)
  — no action grants XP without paying its existing cost, so there is no new farm loop, only new
  reward for the existing ones.
- §10.4: XP is not a currency. The funnel writes zero `transactions` rows. Any future $OMR cost
  rides an existing vocabulary prefix through `spendOmr`.
- Storage discipline: NUMERIC columns (pg-mem INT quirk), absolute writes, direct-SQL off the
  positional persist, every-NULL-cast UNION branch, in-memory mirror after in-txn writes.
- Death: `masteries` joins the runEstate wipe array + the test/migrate.js DISPOSITION map; the
  echo reads `h.victimOwned.mastery` BEFORE the wipe and inserts after the heir INSERT
  (`report.kept.masteries`). `mastery_legend` is account-keyed → survives by construction.

---

## The ten trades

| id | name | fed by (hook sites) | stat drip |
|---|---|---|---|
| `larceny` | Larceny | §7.2 crimes (success) | cunning |
| `wetwork` | Wet Work | fire kills · landed shanks · duels | muscle |
| `chemistry` | The Cook | cook collect · deals | cunning |
| `wheels` | Wheels | boosts · street races | speed |
| `seamanship` | Seamanship | clean port landings · piracy wins | speed |
| `gambling` | The Gambler | dice · blackjack · numbers · track bets | cunning |
| `muscle` | Protection | jump wins · shakedown wins · standovers | muscle |
| `commerce` | Commerce | trade-goods sales · market fills | cunning |
| `scores` | Big Scores | the solo Score · crew heists | speed |
| `fists` | Fisticuffs | boxing bouts · exhibitions | muscle |

**Curve:** `masteryLvlOf(xp) = min(MAX_LVL, floor(sqrt(xp / XP_DIVISOR)) + 1)` — the game's own
quadratic (the levelOf shape), `XP_DIVISOR` 15, `MAX_LVL` 50. At the crime grind's measured pace
(~60 crimes/hr) that is roughly: level 10 in ~7 hours of focused farming, 25 in ~2 days of
sustained play, 50 in RuneScape-99 territory. Rank names per band (Green → Made → Craftsman →
Expert → Master of the Trade). All numbers founder sign-off levers.

**XP awards** live in `MASTERY.XP` (action tag → points), flat per action (the bumpStanding
shape). Awards are sized roughly proportional to the action's resource cost so XP-per-nerve and
XP-per-energy stay comparable across tracks and no track becomes the one true farm.

## The four steps

**Step 1 — THE TRADES core** (this drop): schema (`masteries` char-keyed + `mastery_legend`
account-keyed), the `MASTERY` rules block, `bumpMastery` in game.js, ~20 hook sites, `GET
/v1/mastery` board, estate wipe + 25% heir echo + `kept.masteries`, loadOwned branch, the legend
leaderboard (`GET /v1/leaderboard/trades`, agents excluded), console section, `/v1/rules.mastery`,
tests + sim + playthrough unchanged (no perks yet → zero balance surface beyond the pure-status
axis).

**Step 2 — MILESTONE PERKS + TRAITS**: each track grants small perks at milestone levels (10/25/40)
— the skillMult class, off the locked list, display twins updated — and at level 50 a permanent
TRAIT CHOICE (one of two per track, the Fable moment; `character_traits`, dies with the street).

**Step 3 — PATHS v2**: prototype re-extract 3 → 6 paths (ids/names/descs in the generated half;
the car-catalog precedent) + a hand-written `PATH_FX` matrix in the tail; the 7 inline path
ternaries convert to read PATH_FX byte-identically for the 3 originals; each path names home/rival
tracks (`xpMult` ~1.5 home / ~0.6 rival, applied inside bumpMastery); one signature perk + one
small signature handicap per path at existing modifier sites; a switch cooldown (the D7 respec
rationale — today the 25 $OMR burn is the only throttle and XP-rate arbitrage raises the stakes).
Also resolves the ledger path's advertised-but-unimplemented "+10% front income" (map finding).

**Step 4 — STATS BY USE**: `bumpMastery` drips stat XP toward the track's stat on the gym's own
diminishing formula, metered by a rolling daily bucket (`STAT_USE_CAP_DAY`, the D3 wash-bucket
shape) so the signed contest formulas cannot inflate; the gym stays the fast lane;
tools/playthrough.js re-taught and re-run, baselines re-recorded.

Each step lands green (suite + sim drift-0) and committed separately; a combined red-team follows
step 4 (the pillar discipline).

## What this is NOT
- Not a second level system (no respect, no level gates from masteries).
- Not a §10.4 surface (no currency, no ledger rows; the legend is pure status).
- Not a retune of any signed formula — perks/handicaps are NEW levers at single touchpoints,
  flagged in BALANCE.md, with `standard`/absent behaviour byte-identical to today.
- Not tradeable, giftable, or purchasable — every XP point is earned by an action that paid its
  existing resource cost (the GIFT_CAP structural rule, taken to 100%).
