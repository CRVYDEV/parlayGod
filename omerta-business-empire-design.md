# OMERTÀ — Business Empire (detailed design)

**Status: STEPS ONE + TWO BUILT** (`src/business.js`, `test/economy.js`). The cash-farming +
private-laundering loop ships with its risk layer (§5): scrutiny, Bureau raids, rival shakedowns.
A late-game, upgradeable, launder-capable business layer:
own restaurants, laundromats, clubs and other **legit fronts** that farm in-game cash *and* serve
as your private money-laundering infrastructure — the endgame extraction pipe.

## 1. Why a new layer (not more of the old)

OMERTÀ already has **flat** income businesses: the 18 `RACKETS` (laundro → invisible empire) and the
15 "Legit Fronts" `ASSETS` (diner, nightclub, funeral parlor, bank…). They are the *entry/mid-game*
version — buy once, drip passive cash forever, no upgrades, no risk, no interaction. Those stay
exactly as they are (they're sim-audited; ground rule #1). **Businesses** are the *premium, acquired-
later* layer that adds the depth the flat fronts lack, and — crucially — plugs the passive-income
idea straight into the Risk-to-Earn pivot so it's the endgame engine, not a side idle:

- **Upgradeable tiers** — reinvest cash to grow each front (a deep late-game cash sink *and* a
  compounding money engine).
- **Private laundering** — a front is where the mob washes money. Phase 1 made cash→$OMR laundering
  a located, heat-drawing act at *public* wash houses. Owning a business gives you a **private wash
  house**: launder through your own books with a per-day capacity that scales with the front's tier,
  at lower heat than the street. So a bigger business empire = more (and safer) extraction throughput
  — the reason to build one in a Risk-to-Earn game.
- **(Step two) Risk** — fronts draw scrutiny and can be Bureau-raided or rival-extorted, so the
  passive income is something you must protect, not free money. Deferred; see §5.

## 2. Model

A **business** is a character-owned venue with per-instance state (a new `businesses` table, one row
per owned front — unlike the flat `character_assets`). A catalog (`BUSINESSES` in rules.js) defines a
handful of premium front types, each with a level gate ("acquired later") and a tier ladder:

| field (per catalog type) | meaning |
|---|---|
| `lvl` | level gate to acquire |
| `tiers[]` | ladder: each tier has `cost`, `incomePerHr`, `launderCapDay` |

Per-instance state: `kind`, `tier`, `last_collect_at` (lazy income clock), `launder_used` +
`launder_at` (a per-day laundering-capacity window).

### 2.1 The three actions (step one)
- **Buy** (`buyBusiness`) — cash cost = tier-1 `cost`, level-gated, one per kind per character. §10.4
  cash SINK `business:buy`.
- **Collect** (`collectBusiness`) — lazy income to pocket cash: `incomePerHr × min(elapsed,
  BUSINESS_CAP_MS)`, banked on demand, clock reset (the territory-racket pattern). §10.4 cash FAUCET
  `business:income`. Capped so an uncollected front can't hoard unboundedly.
- **Upgrade** (`upgradeBusiness`) — pay the next tier's `cost` (collecting pending income at the old
  rate first, so an upgrade never wastes earnings); tier up → more income + more launder capacity.
  §10.4 cash SINK `business:upgrade`.

### 2.2 Private laundering (the integration)
- **`launderAtBusiness`** (`businessId`, `amount`) — cash→$OMR through the AMM (the same
  constant-product swap Phase 1 uses), but gated by the business's **daily launder capacity**
  (`tier.launderCapDay`, a fixed 24h window on `launder_used`/`launder_at`) instead of the public
  wash-house district gate, and drawing **less heat** (`BUSINESS_LAUNDER_HEAT` < the street's
  `LAUNDER_HEAT`) — your own front is safer than the street. §10.4: rides the existing `swap:buy`
  ledger rows (cash out / $OMR in), plus the 2% house take — no new reason.
- The public Phase-1 wash-house swap stays for players without a front; businesses are the upgrade
  path to private, higher-throughput, lower-heat extraction.

## 3. §10.4 discipline
`business:income` joins the cash faucet vocabulary (like `racket:income`/`territory:income`);
`business:buy` and `business:upgrade` are cash sinks (like `racket:buy:`/`asset:buy:`). All carry a
`character_id` (personal property, unlike the gang-level `territory:*`). Laundering is `swap:buy`
(unchanged). No new $OMR flow. The character-cash check reconciles with the faucet/sinks added to the
vocabulary; net worth includes owned businesses' resale value.

## 4. Surface
- `GET /v1/catalog` — the discoverable catalog (businesses + tiers + gates), which also closes the
  audit's API-discoverability gap.
- `POST /v1/business/:kind/buy`, `POST /v1/business/:id/upgrade`, `POST /v1/business/collect`,
  `POST /v1/business/:id/launder` `{amount}`, `GET /v1/business` (your empire + pending income +
  launder headroom). Surfaced in the character view.

## 5. Step two — the risk layer (BUILT)
Passive income you must protect — the Risk-to-Earn framing applied to the business layer.

- **Scrutiny** (per-front, `scrutiny`/`scrutiny_at`): only **laundering** draws the Bureau's eyes —
  `BUSINESS_SCRUTINY_PER_CAP` (25) points per full day-capacity washed, decaying
  `BUSINESS_SCRUTINY_DECAY_HR` (2)/hour. Income-only fronts never get raided; their risk is PvP
  shakedowns — so PvE risk tracks *extraction*, PvP risk tracks *wealth*.
- **Bureau raid** (lazy, resolved whenever the owner touches the row — collect/upgrade/launder, the
  §7.1 kitchen-raid pattern): while the front sat above `BUSINESS_RAID_THRESHOLD` (60), one roll over
  those minutes at `BUSINESS_RAID_P_PER_MIN` (0.002). A raid **seizes all pending uncollected income**
  (clock reset — never minted, no ledger row; the territory-seizure precedent) and levies a fine of
  `BUSINESS_RAID_FINE_RATE` (10%) × the current tier's cost, clamped to pocket cash — a ledgered
  §10.4 sink `business:raid`. Scrutiny resets to 0 (the heat's off). `BUSINESS_RAID_P` is a
  test-only env knob (the GEAR_LOOT_CHANCE precedent) — never set it in production.
- **Shakedown** (`POST /v1/business/:id/shakedown`, `withTwoCharacters`): a rival extorts
  `SHAKEDOWN_RATE` (30%) of a front's **pending** income in a muscle/cunning contest. The cut is the
  same bounded income faucet as a collect (`business:shakedown`, attacker's character_id), just
  redirected; the owner keeps the rest pending (the clock advances by only the stolen share).
  Per-venue cooldown `SHAKEDOWN_CD_MS` (8h), `SHAKEDOWN_ENERGY` (15), `SHAKEDOWN_HEAT` (10) on the
  attacker win or lose (extortion is exposure). Family fronts are off-limits; a safehouse blocks the
  *attacker* (P1.3 — offense) but not the venue (a street address, not the man); a hospitalized
  owner is off-limits (the jump mercy rule). A failed attempt costs the attacker health.
- Fronts die with the street: `businesses` joined the `runEstate` property wipe.

All step-two numbers are founder sign-off levers (ground rule #1).

## 6. Numbers (all founder sign-off levers)
Catalog costs, per-tier income curves, `launderCapDay`, `BUSINESS_CAP_MS` (income accrual cap),
`BUSINESS_LAUNDER_HEAT`, and the level gates are new/tunable — sim + sign-off before production, per
ground rule #1. Proposed defaults ship in `rules.js` as starting points.
