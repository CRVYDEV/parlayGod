# OMERTÀ — Balance Sign-off (all economy levers, measured, one document)

**How to use this:** every tunable number in the game is in the tables below with what the
simulation measured and a recommendation. Rows marked **KEEP** are working as designed — signing
this document accepts them. Rows marked **DECIDE** need your call (ranked list at the bottom).
After any change, re-run `node tools/sim.js` (it exits non-zero if money leaks) and `npm test`.

Two classes of number:
- **PROTOTYPE** — extracted from the sim-audited v24 prototype (ground rule #1: locked unless you
  explicitly override). Listed only where they interact with a new lever.
- **PROPOSED** — every number added since the pivot. These are what this document signs.

Measurements: `tools/sim.js` (honest-money simulation, §10.4 drift-0 on every run) — latest run
2026-07-16.

---

## 1. The verdict — what the three balance waves achieved

| Question | Before | Now (measured) | Status |
|---|---|---|---|
| Can a killer profit? | −$75k vs ANY mark | Loot reaches in-transit deposits + unbonding $OMR; kill pays vs marks ≥ ~$344k liquid (break-even = ammo cost ÷ 25%) | ✅ works as "hunt whales" — see **D1** if you want more street killing |
| Is extraction risky? | Raids unreachable (dead code) | Full-cap washing goes raid-eligible in **~2.9 days**, P(raid) ≈ **51%/day** at max scrutiny, fine reaches the bank | ✅ alive |
| Can whales hide for free? | $25k flat ≈ 0.25%/day | 1% of liquid wealth per 4h stay ($45k/4h measured on the sim's grinder; $25k floor for street players) | ✅ scales — see **D2** for the income-side gap |
| Does anyone feed the vig? | Static 5 $OMR PLEX (nobody pays ETH) | Market-linked: mint = fee-ETH × TWAP × 1.2 (sim: 24 $OMR, respawn 240) | ✅ ETH is the economical rail |
| Does the AMM deepen? | Fixed 20k $OMR pool | 25% of every buyback → protocol-owned liquidity (both sides, at spot) | ✅ compounds with activity |
| Can squatters lock the board? | $500 pot blocked all kills 7 days | Directed = $10k min, 24h window, and a kill pays ANY killer | ✅ dead |
| Does the first risky loop pay? | $243/cycle | $327/cycle measured + 50% corner premium at rank 0 | ✅ improved — margin still thin, see **D6** |
| Does the ledger hold? | — | **8/8 §10.4 checks, drift 0, every run** | ✅ |

---

## 2. Combat & loot (PROPOSED unless noted)

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `CASH_LOOT_RATE` | 0.25 | Loot = 25% of pocket + in-transit. Break-even victim wealth = kill cost ÷ rate ≈ $344k (lvl-19 mark) to ~$1.6M (hard lvl-50). | **KEEP** (raise to 0.35 only if D1 says killing should pay vs mid-tier marks) |
| `OMR_LOOT_RATE` | 0.20 | Reaches liquid + unbonding; staked is the safe harbour. | **KEEP** |
| `GEAR_LOOT_CHANCE` | 0.15 | On-chain-minted gear exempt (the extract-or-risk tradeoff). | **KEEP** |
| `BANK_CLEAR_MS` | 2h | The timed-hit window; sim confirmed the deposit is looted inside it. Stacked deposits reset the clock. | **KEEP** |
| `UNSTAKE_CD_MS` | 6h | The stake→extract exposure window; principal always releases whole. | **KEEP** |
| Ammo price / btk | PROTOTYPE | ~$40/round × btk 1670–9700 = $67k–$390k per kill — the dominant kill cost. | **D1** |
| `FIRE_HEAT` | 20 | Wet work heats the shooter like a deal. | **KEEP** |
| `WAR_KILL_POINTS` | 3 (vs jump 1) | Kills decide wars, jumps grind them. | **KEEP** |
| `DIRECTED_MIN` / `DIRECTED_MAX_H` | $10k / 24h | Squat-resistant with kill-pays-any-killer. | **KEEP** |
| NPC hit tiers / heat 25 / cd 6h | PROPOSED | Fee burns win or lose; still no per-TARGET cooldown → repeat-reset griefing on one rival. | **D4** |

## 3. Defense

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `SAFEHOUSE_COST` floor | $25k | Poor players' shield intact (sim: fresh heir quotes $25k). | **KEEP** |
| `SAFEHOUSE_NW_BPS` | 100 (1%/4h) | Rich grinder quoted $45k/4h ≈ 6%/day of wealth. Passive COLLECTION from inside is still legal — cost scales with wealth, not income. | **KEEP**, but read **D2** |
| `BODYGUARD_MIN_PRICE` / `_MS` / `_HOSP_MS` | $10k / 24h / 4h | One bullet absorbed; 2% house take closed the free-transfer hole. | **KEEP** |
| Respawn token (0.10 ETH) | PROTOTYPE §11 | Consumed after bodyguard; mods bypass. | **KEEP** |

## 4. Extraction & laundering

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `LAUNDER_HEAT` / `BUSINESS_LAUNDER_HEAT` | 15 / 8 | Own books safer than the street, both located acts. | **KEEP** |
| `BUSINESS_SCRUTINY_PER_CAP` / `DECAY_HR` / `MAX` | 45 / 1 / 100 | Net +21/day at full cap → hot in ~2.9 days; ≤ half-cap use never raids. | **KEEP** |
| `BUSINESS_RAID_THRESHOLD` / `P_PER_MIN` / `FINE_RATE` | 60 / 0.0005 / 10% | ≈51%/day raid chance at max scrutiny; fine drains pocket THEN bank. | **KEEP** |
| `launderCapDay` (per tier) | $20k→$2.6M | Token-bucket enforced (no boundary bursts). Maxed empire = $4.48M/day vs AMM depth — see **D3**. | **KEEP** caps; **D3** for the public route |
| Public wash (swap buy) | uncapped amount | Located + heat 15, but amount-uncapped: the private caps aren't the binding rail. | **D3** |
| `AMM_LP_BPS` | 25% | Every buyback deepens both reserves at spot; k grew in test + sim. | **KEEP** |

## 5. Passive income

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| BUSINESSES catalog (5 kinds × 3 tiers) | laundromat $250k/$12k-hr → casino $40M/$1.5M-hr | t1 payback 20.8h — 0.91× a racket per dollar (ON-curve), but ADDITIVE to the racket/asset bucket. | **KEEP** curve; **D2** for additivity |
| `BUSINESS_CAP_MS` | 24h | Uncollected income can't hoard; raids seize pending. | **KEEP** |
| `SHAKEDOWN_RATE` / `CD_MS` / `ENERGY` / `HEAT` | 30% / 8h / 15 / 10 | Sim: $86k stolen from a 24h-idle t1 front — an AFK tax; collect cadence is the defense. | **KEEP** |
| RACKETS / ASSETS incomes, 12h bucket | PROTOTYPE | The baseline curve (laundro 18.9h payback measured). | locked |
| Bank interest 2%/12h, 12h/day bucket | PROTOTYPE + B2 cap | Still ~2%/day compounding on banked wealth, PvP-untouchable after clearing. The game's only exponential. | **D5** |

## 6. Territory & war

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `TERRITORY_RACKETS` ladder | $50k/$250k/$1M | Marginal ROI 192% → 115% → 106%/day (tapered; entry tier is the hook). Sim: $96k/24h at t1. | **KEEP** |
| `TERRITORY_SEIZE_BPS` | 50% of build cost | Seizing a maxed front ≈ $650k+garrison vs $45k before. | **KEEP** |
| `TERRITORY_CAP_MS` | 24h | Collect before you lose the turf. | **KEEP** |
| WAR_COST / SEIZE_BASE / spoils | PROTOTYPE M3 | Cheap wars remain the entry point; the premium prices the takeover. | **KEEP** |

## 7. Kitchen

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `KITCHEN_ONRAMP_BONUS` | +50% at rank 0 | Entry cycle $243 → $327 measured (+premium on top). Phases out at rank 1. | **KEEP**, watch **D6** |
| Deal/cook/raid formulas | PROTOTYPE §7.10 | Untouched. | locked |

## 8. $OMR & emission

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| `APY` | 14% ceiling | Now a CEILING on a pool-backed rate (throttles when dry — sim confirmed). | **KEEP** |
| `STAKE_POOL_BPS` | 30% of buyback | Yield = f(economic activity), zero mint. | **KEEP** |
| `VIG_BPS` / `VIG_RESERVE_BPS` | 60% / 50% | Extraction ≤ inflow by construction; two-sided invariant. | **KEEP** |
| `PLEX_PREMIUM_BPS` | 1.2× | $OMR is the premium rail; ETH funds the pool. Floors ($5/$50) pre-market only. | **KEEP** |
| `MINT_FEE_ETH` / `RESPAWN_FEE_ETH` | 0.01 / 0.10 | Deploy-time contract values mirrored in env. | **KEEP** (price in USD terms at launch) |

## 9. The Den (all PROPOSED)

| Lever | Value | Measured / analysis | Rec |
|---|---|---|---|
| Craps 1:1 pass line | edge 1.41% | 150-roll sim session swung +$24k (variance is the product; edge collects at scale). 1% of stakes → tax pool. | **KEEP** |
| Numbers 600:1 | ~40% edge | Historically authentic; $10–$1k keeps it a flutter. | **KEEP** |
| `MAX_BET` / `HIGH_LVL` / `HIGH_MAX` / `HIGH_FEED` | $250k / 30 / $2M / $250k | Whale theater feeds the streets feed (and the kill layer). | **KEEP** |
| `PVP_RAKE_BPS` | 5% | Half to street tax, half burns; consent-by-listing. | **KEEP** |
| `FIGHT_MAX` / fix $50k | $5k cap | The cap is the fix's abuse bound: a fixed bout mints ≤ stake×payout per conspirator; 20-member family ≈ $160k/week net of the fix — a bounded turf perk. | **KEEP** |
| `RAKEBACK_BPS` | 1% of den volume | Split across casino-front owners, cursor-exact. | **KEEP** |

## 10. Sinks & vanity (all PROPOSED, status-only)

Name $5 · title $10 · plate $2 · crest $10 · family rename $25 · seals 25→1500 · anon 3 ·
peek 5 · respec 15 (all $OMR burns, display-only) — **KEEP**; respec has no cooldown (**D7**).

---

## 11. The DECIDE list (ranked) — **SIGNED 2026-07-16: founder approved all recommendations**

Resolution of each item (all recs implemented same day; suite 10/10 + sim drift-0):
- **D1 — SIGNED AS-IS**: killing stays "hunt whales" (break-even ≈ $344k liquid prey); revisit
  with live data. No change.
- **D2 — BUILT**: bank deposits, business collection, and territory collection are now EXPOSED
  acts — blocked from a safehouse (`safe` error). Income accrues while hidden; banking it means
  surfacing. Withdrawals (cash to hand) stay legal.
- **D3 — BUILT**: the public wash route (swap buy) now carries a per-account daily token bucket,
  `PUBLIC_WASH_CAP_DAY` $2.6M (= the top business tier's launderCapDay) — private infra is the
  best rail, no longer the only sane one.
- **D4 — BUILT**: `NPC_HIT_TARGET_CD_MS` 24h per (payer, target) pair (`npc_hits` table, stamped
  win or lose) — no repeat-resetting one rival.
- **D5 — BUILT** (explicit founder override of the prototype rate): bank interest tapers above
  `BANK_TAPER_ABOVE` $10M — full rate on the first $10M, `BANK_TAPER_KEEP` 10% of the rate
  beyond. The vault stops being the game's only unbounded exponential.
- **D6 — SIGNED AS-IS**: kitchen entry margin ($327/cycle + corner premium) — watch in alpha.
- **D7 — BUILT**: `RESPEC_CD_MS` 24h between respecs; failed attempts never arm the clock.
- **D8 — remains documented** (turf goods arbitrage, dice daily contracts, per-IP throttle,
  `GET /v1/me` accrual outside the guard, `payPrizes` batch-id, seizure-loser notification) —
  accepted as-is for alpha, revisit with live data.

**Status: every KEEP row above is production balance. The economy is signed.**

## Post-signing addendum — Crew Heists (new faucet, sign-off pending)

`HEIST_JOBS` (rules tail) adds the game's first co-op faucet: per-member EV targets ~1.3–2.1× the
solo heist (the `1200×lvl`/8h anchor) with real jail risk, sharing the solo `heist_at` cooldown so
total Score throughput per player is unchanged in FREQUENCY — only the per-window EV rises with
coordination + risk. Anti-abuse by construction: pot scales with AVERAGE crew level (alt-dragging
shrinks everyone's take), the stake is sunk at execution, and the rat payout is half the stake
(self-ratting is −EV). Levers: per-job `base/stake/takePerLvl/jailS`, `HEIST_RAT_BPS`,
`HEIST_LEADER_WEIGHT`, `HEIST_PLAN_TTL_MS`. **DECIDE at next sim pass** — run `node tools/sim.js`
and compare the crime-curve rows before tuning.

## Post-signing addendum — the Commission (weekly decree modifiers, sign-off pending)

The Commission moves NO money (no faucet, no sink — §10.4 untouched). Its decrees are temporary
one-week MODIFIERS on levers this document already signed: `OPEN_SEASON_MULT` 0.5 (× SAFEHOUSE_MS),
`AMNESTY_MULT` 0.5 (× LAYLOW_CASH — the discounted cost is what's ledgered), `LOCKDOWN_DEF` +20
(added to convoy defense), and the Pax (blocks NEW `declareWar`; running wars finish). Because a
decree needs a MAJORITY of the top-5 families and lasts one week, abuse is self-limited by politics
— but the multipliers themselves are founder levers: sign the three numbers before production.

## Appendix — the original DECIDE list (for the record)

- **D1 — Should killing pay against mid-tier marks?** Today a kill costs $67k–$390k in ammo
  (PROTOTYPE prices), so only marks worth ≥ ~$344k liquid are +EV prey. This reads as "assassins
  hunt whales", which fits Risk-to-Earn — but street-level killing stays a costs-money sport. To
  broaden the prey pool WITHOUT touching prototype ammo: raise `CASH_LOOT_RATE` 0.25 → 0.35
  (break-even drops to ~$246k) and/or let loot take a small % of CLEARED bank on kills between
  war-declared families. My rec: ship as-is, revisit with live data.
- **D2 — Business/racket additivity + the safehoused landlord's income.** Businesses (24h clock)
  stack on top of the racket/asset 12h bucket, and collection is legal from a safehouse. The
  safehouse now taxes wealth (1%/4h) but not income. Options: (a) accept — hiding costs wealth,
  fine; (b) class `collect`/`deposit` as exposed acts (blocked while safe — the P1.3 pattern);
  (c) businesses share a 16h/day bucket family. My rec: (b) — it completes "shield, not bunker"
  and needs ~20 lines. Decide before launch.
- **D3 — The public wash route is amount-uncapped.** Heat (15/call, decays 1/min) is the only
  brake; slippage is the real limit but a whale can still take ~30% of the pool in a day. Options:
  per-account daily cap on `swap` buys (mirror `launderCapDay`), or slower launder-heat decay. My
  rec: per-account cap = the top business tier's `launderCapDay` ($2.6M/day) — private infra should
  be the best rail, not the only sane one.
- **D4 — NPC-hit per-target cooldown** (flagged twice by audits): one rival can be repeat-reset
  every 6h by a whale. My rec: add `NPC_HIT_TARGET_CD_MS` = 24h per (payer, target). Small change.
- **D5 — Bank interest** (PROTOTYPE 2%/12h): with B2's 12h/day cap it's ~2%/day compounding,
  untouchable after clearing. It out-scales everything eventually. Options: interest taper above a
  threshold ($10M?), or accept until live data. My rec: taper — but it's a prototype value, so
  explicitly yours.
- **D6 — Kitchen entry margin** is improved but still thin ($327/cycle + premium). Watch in alpha;
  the next lever is cheaper starter makings, not formula changes.
- **D7 — Respec cooldown**: 15 $OMR between opposed rolls (shakedown/jump are shape-sensitive). My
  rec: 24h cooldown, one line.
- **D8 — Known design-call leftovers** (unchanged, documented): turf goods arbitrage, daily
  same-kind contract draws + the undrawable dice contract, per-IP throttle, `GET /v1/me` outside
  the rate-limit guard, `payPrizes` batch-id, territory-seizure loser notification.

**Signing this document** = every KEEP row above is production balance; the DECIDE list is the
complete set of open economy questions. Nothing else is pending.
