# THE FIVE PILLARS — content expansion design (2026-07-24)

Founder-directed: *"Spec all 5 and implement them"* — the five expansion directions drawn from
Fable / Europa Universalis / EVE Online / RuneScape, chosen because the game's economy is
faucet-saturated (AUDIT-full-product Lens G) while **politics, identity, and narrative** are thin.
None of the five adds a meaningful new faucet; four are sinks/status, one (Campaigns) reuses the
missions pay-once precedent at mission scale. Every number is a founder sign-off lever.

The pillars compose: HONOR (2) gates DIPLOMACY (1); diplomacy fights over SOVEREIGNTY (3);
CAMPAIGNS (4) are how a street *earns* honor and standing; the BLOODLINE (5) is what persists
through it all.

---

## 1 · HONOR ↔ INFAMY (Fable — "your legend precedes you") — `src/honor.js`

One unifying identity axis the world reacts to, derived from how you actually play. A
`characters.honor` NUMERIC (−100..+100, NUMERIC so set-based clamped arithmetic is pg-mem-safe),
**dies with the street** like stats, with a bloodline echo: the heir inherits
`round(honor × HEIR_KEEP 0.25)` (the npc-memory precedent — identity shadows the name).

**Deeds** (single touchpoints at existing sites, each a small clamped bump via `bumpHonor`):
repay a loan **+2** · a bodyguard takes the bullet **+8** (the guard) · settle a vendetta **+10**
· welsh **−15** (collect + the overdue sweep, set-based `GREATEST(−100, honor−15)`) · flip to the
Bureau (RAT) **−30** · a landed shank **−12** · hire an NPC hitman **−5** (cowardly) · break a
sworn pact **−20** (the OATHBREAK, pillar 2) · campaign choices **±** (pillar 4).

**Tiers** (`HONOR.TIERS`): Mad Dog (≤−60) · Ruthless · Unproven · Respected · Man of Honor (≥+60).

**Teeth** (deliberately few, all NEW levers off signed surfaces, flagged):
- **Man of Honor**: laylow ×`HONOR_LAYLOW_MULT` 0.9 (stacks multiplicatively with the amnesty
  decree + fast_talker — the exact precedent stack at the one kitchen.js site).
- **Mad Dog**: bodyguards refuse the contract (`hireBodyguard` throws `mad_dog`) — nobody takes a
  bullet for a mad dog; and a Mad Dog boss can't propose pacts or form coalitions (pillar 2) —
  shut out of the political game.
- Campaign branches honor-gate (pillar 4). Everything else is display (view, bloodline record).

§10.4: **zero** — honor moves no value; the laylow discount ledgers the discounted number
(decree precedent).

## 2 · DIPLOMACY & COALITIONS (EU4) — `src/diplomacy.js`

**Pacts** — a formal non-aggression treaty between two families. Boss/underboss proposes
(`gang_relations`, sorted-pair PK, pending), the other side's boss accepts → active for
`PACT_MS` 7d. While active, `declareWar` between the two throws `'pact'` (the Commission-pax
precedent — one touchpoint). **Breaking a sworn pact early** is the OATHBREAK: the breaker's
family is marked `oathbreaker_until` (+3d — can't propose new pacts while marked, a public chip)
and the breaking boss eats **−20 honor**. Treaties are cheap to sign and expensive to betray —
trust becomes a priced asset (the loan-shark thesis, applied to politics).

**Coalitions** — the EU4 anti-hegemon. A family is **DOMINANT** when it holds ≥
`DOMINANCE_DISTRICTS` 2 core districts OR its standing ≥ `DOMINANCE_STANDING_MULT` 2× the
runner-up. Any boss (not oathbroken, not a Mad Dog, no active pact with the target) can **form a
coalition** against a dominant family; other bosses join. While a coalition has ≥ `COALITION_MIN`
2 member families, its members get the anti-snowball teeth:
- `declareWar` on the target: war chest ×`COALITION_WAR_MULT` 0.5 (discounted number ledgered).
- `seizeDistrict` on the target's districts: garrison outbid ×`COALITION_SEIZE_MULT` 0.85.
Coalitions expire after `COALITION_MS` 7d (re-form if the target is still dominant). The board is
public — being coalitioned is itself pressure.

*Design note:* the war system is one-war-per-family, so the coalition's power is **economic siege**
(cheaper wars + cheaper seizures for everyone in it), not simultaneous wars — which also spreads
the counterattack across time, the healthier shape.

§10.4: no new money. The two discounts ride existing ledgered sinks at the discounted number
(`gang:war`, `turf:seize:*`). Dissolution deletes a family's relations/coalition rows.

## 3 · SOVEREIGNTY (EVE) — `src/sov.js`

Turf becomes something you **fight to keep**. A family that holds a district can build a
**stronghold** on it (`sov_structures`, district PK): Outpost $100k → Fort $400k → Citadel $1.5M
(treasury sinks `sov:build`/`sov:upgrade`). At build the boss picks a daily **vulnerability
window** (`window_hour`, 2h wide, UTC — the EVE sov-timer, deterministic, no state).

- **Passive**: the structure's garrison adds to the district's seize outbid cost (one line in
  `seizeDistrict`) — turf with a citadel is genuinely hard to take…
- **…except in the window**: a rival boss can **SIEGE** during the window
  (`POST /v1/sov/:district/siege`): pays `SIEGE_COST` $50k treasury (burns win or lose — the
  npchit-fee precedent), rolls a contest vs the tier (rng-audited; `SOV_SIEGE_P` TEST-ONLY knob).
  A win knocks the structure down a tier (razed at 0) and scores **sov points** to the attacker's
  family (`gangs.sov_points`, lifetime, the war-effort precedent) — pure destruction + status,
  no loot. A loss costs health + the per-structure 24h cooldown either way.
- **Overextension (the anti-snowball)**: upkeep = tier rate × (1 + `OVEREXT_BPS` 50% per EXTRA
  district the family holds) — an empire's hold-cost grows superlinearly (EU4). The pad/cold
  pattern: unpaid 3d → **crumbling** (garrison bonus 0, can't upgrade) until paid.
- A **seized** district razes its structure (the victor tears it down — EVE structure destruction,
  deliberately NOT a transfer: anti-snowball). Dissolution razes the family's structures.

§10.4: `sov:` is a pure treasury-sink prefix (`build/upgrade/upkeep/siege`, character_id NULL,
counterparty = gang) — added to the cash vocabulary + the gang-treasuries check's OUT terms.
**No faucet.** Sov points + `SOV.RANKS` + `GET /v1/leaderboard/sov` are status.

## 4 · UNDERWORLD CAMPAIGNS (RuneScape quests × Fable choices) — `src/campaigns.js`

The game's first **authored narrative**. Each Underworld fixer offers a multi-step story chain
(`CAMPAIGNS` catalog in the rules tail — the content lives in data): steps are either **tasks**
(do N of an action from the existing Underworld action vocabulary — heal/craft/hire/deal/dice/…,
advanced automatically inside `bumpStanding`'s action stream, the errand-chain precedent) or
**choices** (branch A/B — the Fable moment: the honorable path pays honor, the ruthless path pays
cash), each wrapped in narrative prose the board renders.

- Gated on fixer standing ≥ `MIN_STANDING` 25 (tier 1 — ties the Underworld in); some branches
  honor-gated.
- **Reward** (on explicit claim, the missions pay-once precedent): one-time cash
  (`campaign:reward`, mission-scale — the ONE new faucet surface, bounded once-per-campaign-per-
  street), fixer standing, honor, and on the finale a **title**. `campaign_progress` dies with
  the street (estate-wiped + DISPOSITION 'wiped') — a new street can walk the stories again
  (RuneScape quests reset with the life, fitting the roguelike spine).
- Launch content: five chains, one per original fixer (Doc/Vinnie/Bella/Big Tuna/Madame), 4–5
  steps each with one choice.

§10.4: `campaign:` joins the cash vocabulary as an enumerated faucet (character_id'd → check (a)
reconciles). Magnitude: ≈ one mission tier — base reward $9k–$12k/chain PLUS the ruthless-branch cash
sweetener ($4k–$10k, always paired with a NEGATIVE honor cost so ruthless cash is never free), so
$9k–$22k/chain, ~$88.5k total across all five chains, ONCE PER STREET (dies with the man) — flagged for
sim + BALANCE.md sign-off.

## 5 · THE BLOODLINE (Fable legacy × EU4 succession) — `src/bloodline.js`

The dynasty made visible. `runEstate` now writes a **`bloodline`** record at every death
(account_id + generation PK — account-level, it IS the death record, survives forever): name,
generation, cause (killer or THE COMMISSION), level reached, kills that season, honor at death.

- **`GET /v1/bloodline`** — the ancestral hall: every generation with its Roman numeral ("Vito,
  III of the line") and a derived **epithet** (kills ≥10 → *the Butcher*; honor ≥60 → *the
  Honorable*; ≤−60 → *the Mad Dog*; level ≥40 → *the Great*…), the cause of each death, and the
  **dynasty score** (Σ level×10 + kills×25 + |honor| across generations — pure status).
- **`GET /v1/leaderboard/bloodline`** — the great houses of the city, ranked by dynasty score,
  shown under their Dynasty name (the F4 naming ties in).
- The heir's honor echo (pillar 1) starts here; muscle memory + prestige already carry.

§10.4: **zero** — a record of the dead, no value moves. No character_id column (account-keyed) →
outside the estate-wipe surface by construction.

---

## Cross-cutting

- **Lock order** respected everywhere: char → gangs (sorted where two) → sov/relation rows →
  never a singleton beyond. Sieges lock attacker char → attacker gang → the sov row (the
  territory-raid convention — the DEFENDER's gang is never locked).
- **Death**: `campaign_progress` wiped; honor echoes ×0.25; bloodline INSERT (before the wipe).
  **Dissolution**: relations, coalition rows, sov structures deleted (die with the family).
- **pg-mem**: honor NUMERIC (arithmetic-safe); all INT counters written absolute.
- **New tables**: `gang_relations`, `coalitions`, `coalition_members`, `sov_structures`,
  `campaign_progress`, `bloodline`. **New columns**: `characters.honor`, `gangs.oathbreaker_until`,
  `gangs.sov_points`.
- **Routes**: diplomacy (5), sov (5+board), campaigns (4), bloodline (2), honor rides the view.
- **Console**: Family tab gains Diplomacy + Sovereignty sections; Life tab gains the Honor line,
  Campaigns, and the Bloodline hall. `/v1/rules` gains `honor`/`diplomacy`/`sov`/`campaigns`.
- **Tests**: `test/expansion.js` (the 34th suite) covers all five + a §10.4 reconcile with the
  `sov:`/`campaign:` reasons in play.
- **Sign-off levers**: every constant in the `HONOR`/`DIPLOMACY`/`SOV`/`CAMPAIGNS`/`BLOODLINE`
  rules-tail blocks. The campaign cash faucet and the two coalition discounts are the only
  economy-touching numbers — sim + BALANCE.md before production.
