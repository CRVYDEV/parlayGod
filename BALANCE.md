# OMERTÀ — Balance Sign-off (all economy levers, measured, one document)

> **➤ For the founder-facing, ranked, plain-English decision sheet, see [`SIGN-OFF.md`](./SIGN-OFF.md)** —
> it gathers every open lever below (and every audit's flagged residual) into one page with a SHIP/CHANGE/
> WATCH recommendation on each. This file (`BALANCE.md`) is the technical detail behind those rows. The
> sim now measures the previously-unmeasured faucets (`tools/sim.js` P9.11: frontier tribute, speakeasy
> bar take, pen work, the liberation on-ramp).

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
| The Track `EDGE` / `FIELD` / caps | 15% / 6 / $50–$10k | The dogs & the ponies (the weekly-fight twin). A UNIFORM 15% takeout on every runner (posted odds = (1/p)×(1−EDGE); the seed-drawn winner uses the true p — the odds carry the vig, the draw doesn't). One win bet per race/day, small-capped → a NET SINK in expectation like every den game, no signed faucet touched (rides the `casino:bet:%`/`casino:win:%` den book — zero invariant change). | **KEEP** |
| The Stable (own the dogs & ponies) — `STABLE.*` | dog $30k / horse $120k · circuit meets · match 5% vig | The ownership layer under The Track (the boxing-stable pattern). Buy/train (cash SINKs) → race. The PvE **circuit purse** is the ONE new faucet (the boxing-exhibition twin — the entry fee burns win/lose, the purse pays only on a win, bounded by the 6h per-racer cooldown + injury-on-loss + needing the FORM): dog maiden $2k→$6k / derby $40k→$70k, horse maiden $5k→$15k / Gold Cup $65k→$115k — sim the net EV per meet before production (parity with boxing exhibition). The PvP **match race** is the audited casino:pvp taxed transfer (redistribution, no faucet). | **SIM** the circuit purse; the rest KEEP (sink/status/transfer) |
| The Stable step two — `BREED_*` / `STABLE.STAKES.*` | breed $60k / stakes $20k buy-in / 5% rake | **Breeding** retires two racers into a foal inheriting `floor(avg × 0.6) + rand(0,5)` clamped to [statMin, cap] — a HEAD START (two maxed parents → ~15-20, never the 25 cap), a cash SINK, 2 racers → 1 (bounded). **The Stakes** is the Grand-Prix escrow twin (buy-in → purse, worker settles, top places split net of rake) — a pure REDISTRIBUTION, NO new faucet (own the `stakes escrow` §10.4 check). **The Cornerman** tie-in reuses the boxing fixture (training discount, off the faucet). | **KEEP** (sinks + a redistribution; no signed faucet touched) |
| The Track step four — THE FUTURITY (`CASINO.FUTURITY.*`) | $5k nomination fee · 5% vig · $100–$25k bets | The crowd-bet marquee for player-owned racers (the **boxing-main-event twin** — spectator parimutuel, distinct from The Stakes' owner buy-in competition). The nomination fee is a cash SINK (`casino:futurity:nom` → buyback, non-refundable). The betting is a pure taxed **REDISTRIBUTION** — **NO new faucet**: winners split the LOSING pool net of a 5% vig (half → buyback / half burns), the winning owner takes a promoter purse from the rake, so the house edge stays the rake at any turnout. Own the new `futurity escrow` §10.4 check (open pool == posted − wins − refunds − purse − take − death). | **KEEP** (a sink + a redistribution; no signed faucet touched) |

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
`HEIST_LEADER_WEIGHT`, `HEIST_PLAN_TTL_MS`. **DECIDED (sim pass 2026-07-16)** — the sim's P9.7
probe (30 payroll runs at lvl 25, honest money): 67% score rate, crew-wide EV +$87.4k/run →
per-member ≈ $43.7k/8h window vs the solo heist's guaranteed $30k = **1.46× solo, inside the
1.3–2.1× design band**, with 1-in-3 runs ending in shared jail. §10.4 drift-0 with the faucet
live. **KEEP as proposed.**

## Post-signing addendum — Skills & Specializations (sign-off pending)

A build layer of NEW single-touchpoint modifiers — nothing signed was retuned, and the tree
deliberately avoids the audit-locked surfaces (heat deterrents, loot-exposure windows,
extraction caps, kill economics, accrual curves). Levers: `LVL_PER_POINT` 4, `RESPEC_OMR` 10,
and the nine FX (×1.08 attack, ×0.75 heal, ×0.8 search, ×0.8 laylow, ×1.08 fence/melt, ×0.5
market fees, +3 trunk, ×0.8 stints, ×0.8 convoy time). Economy notes for the sim pass:
fence_network is the only one touching a FAUCET (fence/melt +8% for 2 points at level ≥12 —
bounded by the unchanged GTA faucet rate and garage cap; watch alongside the market's car-price
item); executioner (−20% search) raises assassin throughput ~25% for a 6-point commitment —
the deepest PvP lever here, flag for the whale-hunt economics; everything else is QoL/pacing.
Respec cadence shares the daily M8 cooldown so build-swapping around fights stays impossible.

### Skills step two — tier-4 capstones + active abilities + per-skill respec (sign-off pending)
Extends the same discipline (NEW single-touchpoint modifiers, off every audit-locked surface).
Levers: `CAPSTONE_COST` 4 (a full branch = lvl 40 / 10 points — the tier-3 skill is the prereq),
`MADE_MAN_MULT` 1.08 (jumps+shakedowns+standover, STACKS on bruiser's 1.08 — the deepest PvP
capstone, flag for whale-hunt economics alongside executioner), `KINGPIN_MULT` 1.08 (fence+melt,
STACKS on fence_network — the only capstone touching a FAUCET, still bounded by the unchanged GTA
faucet + garage cap), `ROAD_BOSS_TRUNK` +3 (QoL, stacks on pack_mule's +3 → +6 trunk). The ACTIVE
abilities (`ACTIVE_CD_MS` 8h shared cooldown) refill energy/nerve (pure regen resources) or clear
the heist/world-raid op cooldowns (op pacing, never `jail_until`) — deliberately ZERO §10.4 / no
audit-locked surface, so pure QoL bursts. `RESPEC_ONE_OMR` 5 (< the full `RESPEC_OMR` 10 wipe) is a
leaf-first single-skill unlearn on the SAME shared daily M8 cooldown, ledgered `respec:skills` — so
per-skill build-swapping around fights is still impossible. Capstones are lvl-40 endgame commitments
(one maxed branch); watch the made_man×bruiser and kingpin×fence_network multiplicative stacks in
the sim pass.

### Skills step three — prestige carries into the build (SOFTENS DEATH, sign-off pending)
The deferred founder call: prestige (the account-level death legend) now grants a small BUILD head
start on a new street. **No currency, no §10.4 surface** (skill points are derived, never stored;
skills carried are a pure ownership move). Two levers, both restore the hard "skills die with the
street" rule at 0: **(1) PRESTIGE POINTS** — `PRESTIGE_PER_POINT` 10 / `PRESTIGE_POINT_MAX` 3: a
long bloodline gets `min(3, floor(prestige/10))` bonus skill points on top of the level-derived
budget — a small edge (≤3 extra points = one extra tier-3 skill), NOT a way to skip levels (the
tier prereq chain still gates a maxed branch at lvl 40). **(2) MUSCLE MEMORY** — `PRESTIGE_PER_SLOT`
8 / `MEMORY_MAX` 3: the heir is born knowing a **lowest-tier-first PREFIX** of the deceased's skills
(`min(3, floor(priorPrestige/8))` slots), read from the bloodline's **pre-death accumulated
prestige** (so a FRESH line's skills still fully die — the first death of a lvl-25 street grants 0
memory since prestige is 0 at that moment). The prefix is prereq-safe by construction (any skill at
tier t sorts after all tier<t, so its same-branch tier-(t−1) prereq is always included). This
SOFTENS DEATH — a veteran bloodline keeps ~2-3 foundation skills across a street — so it's a genuine
balance lever, not pure status; `MEMORY_MAX 0` / `PRESTIGE_POINT_MAX 0` reverts to the M-era hard
rule. Watch: does memory-carry make repeat-death too cheap for a whale bloodline? (the dial is
PRESTIGE_PER_SLOT — raise it to demand a deeper dynasty per remembered skill).

### Randomized starting builds + the 0.01-ETH re-roll (sign-off pending; BALANCE-NEUTRAL)
Fresh characters now `rollStats()` a unique muscle/cunning/speed spread instead of flat 5/5/5, and a
paid 0.01-ETH re-roll (`POST /v1/character/reroll`, infinitely repeatable) re-rolls it. **Both are
TOTAL-CONSERVED** — `CREATE_STAT_MIN` 3 / `CREATE_STAT_TOTAL` 15, each stat in [3,9], always summing
to 15 (the same budget as the old fixed build) — so the aggregate stat economy is UNCHANGED (sim
drift-0, suite 32/32, §10.4 untouched: a re-roll writes zero `transactions` rows, the ETH is
out-of-band). The ONLY change is build IDENTITY (a muscle spike costs speed). Levers: `CREATE_STAT_MIN`
(the spread floor — at 5 it collapses to the old fixed 5/5/5; at 3 a stat can reach 9) and the on-chain
`rerollFee` (defaults 0.01 ETH, owner-settable). No cooldown on the re-roll — the ETH cost is the
throttle (total-conserved, so no power-shopping exploit). Watch only whether a stat-weighted meta makes
certain spreads out-perform balanced (a build-identity question, not a power-budget one).

## Post-signing addendum — the Underworld (named NPCs, sign-off pending)

Relationship perks as NEW single-touchpoint modifiers, same discipline as skills — nothing
signed was retuned, and the cast deliberately avoids $OMR burns, ammo prices (the D1 kill-EV
anchor), heat deterrents, loot-exposure windows, extraction caps, and income curves. Levers
(`UNDERWORLD` rules tail): tier thresholds 25/60/90; gifts `GIFT_COST` $5k / `GIFT_STANDING` +5 /
`GIFT_CAP` 50 (money only opens doors — the top tiers are earned, answering the audit's
purchasable-standing critique structurally); `DISCHARGE_PER_MIN` $150; `GUN_BUYBACK` 30%; the
eight FX (heal ×0.9, NPC hit ×0.9, search ×0.9, guns ×0.9 cash, crafts ×0.9, guard fees ×0.9,
72h listings, +1 listing slot). Economy notes for the sim pass: **`underworld:gunsale` is the
only new FAUCET** — 30% of a gun's sticker, once per owned gun, requires standing 90 (≈30 gun
purchases at full price to reach honestly), so the round trip is −61% (buy ×0.9, sell 0.3) and
unfarmable; **fixer T3 × executioner stacks to a 0.72 search clock** — the assassin-throughput
watch item from the skills addendum compounds here, flag both together for the whale-hunt
economics; **Vinnie T2's waived post fee** halves the contract board's friction for regulars
(the tax half of the 2% stands — escrow reconciliation unchanged); everything else is
QoL-priced discounting on sinks (discounted numbers are what's ledgered, so §10.4 stays exact
by construction). Two cash sinks join the vocabulary (`underworld:gift`, `underworld:discharge`).

**Step two** (levers in `UNDERWORLD.STEP2`; zero money flows — every item is a status/access/
pacing dial, §10.4 untouched by construction): `LEAD_BONUS` 5 / `LEAD_MIN` 25 (the daily lead —
raises honest standing velocity by ≤5/day, exactly one claim/day, gifts excluded);
`DECAY_GRACE_DAYS` 7 / `DECAY_PER_DAY` 1 / `DECAY_FLOOR` 25 (idle standings cool to tier 1 —
the T2/T3 perks now demand ongoing play, answering "earn once, keep forever"); `MEMORY_BPS`
2500 (the heir inherits 25% of each standing — a DIALED soft corner on hard death; 0 restores
it; at 25% even a maxed street hands down ~22, below tier 1, so no perk survives death — only
a head start); `RIVAL_LOSS` 2 (kills/NPC hires cost the Doc — the assassin who wants cheap
healing maintains two relationships in tension). The Madame's watch items for the sim pass:
**T1 comped nerve** removes the den's pacing throttle (the ~1.4% edge still gets paid per roll,
so unlimited play is a cash-sink amplifier, not a leak — but standing velocity via dice +1/roll
becomes cash-bounded, ~$1.41 expected cost per point at the $100 minimum: cheap; consider
capping den bumps per day if live data shows madame tiers trivializing); **T3 whispers**
(a count of open searches on you, no names) is new defense intel — it tips a mark to safehouse
before placement, softening the hunter's 3h investment; watch kill-completion rates and pair it
with the fixer-T3×executioner stack already flagged above.

**Step three** (levers in `UNDERWORLD.STEP3` + `tasks` on the cast; zero money flows): the lead
became a rotating TASK (`leadTaskOf`, seed-drawn per day, town-wide — the same +5, now behind a
specific job, so lead velocity is unchanged and gets a reason to touch varied loops); rivalry
pair #2 `AMBUSH_ARMORER` 2 / `AMBUSH_HARBOR` 2 (an ambush attempt trades Bella up and Big Tuna
down — a dedicated bandit slowly locks himself out of Tuna's T2/T3 market perks, a real build
tradeoff); grudges `GRUDGE_MIN` 60 / `GRUDGE_LOSS` 5 (killing a T2+ friend of a fixture docks
the killer — or the PAYER on an arranged hit — with that fixture). Economy note: grudges make
high standing a mild PASSIVE DEFENSE (a connected mark is socially expensive to whack — the
killer pays status, never money), which is deliberate Risk-to-Earn texture: the D1 whale-hunt
economics are untouched (no cash surface moved), but watch whether well-connected whales use
fixture standing as a soft shield; the counterweight is that standing is earned by ACTIVITY,
and active players are already the exposed ones.

**Step four** (levers in `UNDERWORLD.STEP4`): `GRUDGE_TIER_CAP` 2 (an open grudge withholds
tier-3 service until squared — the grudge now COSTS something concrete: walk-outs, buybacks,
the fourth slot, whispers); `PENANCE_COST` $25k per grudge (the ONE new money flow in steps
two–four — a clean, legible cash sink, `underworld:penance`, priced roughly at half a
safehouse stay so a working killer squares up without it being trivial: a five-grudge spree
costs $125k in bridges); `STREAK_BONUS_CAP` +5 (daily-lead streaks raise the standing ceiling
to +10/day for perfect attendance — velocity ×2 for the most engaged, still zero money);
`FAVOR_WEEKLY` 1 (the weekly favor is RESOURCES only — health/nerve/energy/repairs, worth
roughly $1–3k in avoided sink spend per week at endgame perk levels; it slightly softens four
small sinks, bounded at one claim/street/week — watch alongside the other T3 conveniences,
and note the elegant interlock: a grudge suspends exactly this).

**Step five** (levers in `UNDERWORLD.STEP5`; zero new money): `GRUDGE_DECAY_DAYS` 14 (time
heals one grudge per two idle weeks — this SOFTENS the penance sink's demand: a patient
killer waits instead of paying $25k; at 14 days the wait is long enough that active killers —
who re-offend and reset the clock — still pay, while a one-time grudge on a reformed player
fades; shorten it and penance revenue drops toward zero); `CHAIN_STEPS` 3 / `CHAIN_BONUS` +15
(the errand chain adds ≤5/day standing velocity for a committed three-day arc — combined
ceiling with lead+streak is now ~+20/day for perfect play, still a pure status axis);
`FIX_LOSS` 5 (a status tax on the flagged fight-fix surface — the fixing boss slowly locks
himself out of the Madame's velvet rope and whispers, a real cost for serial fixers, zero
touch on the den's signed money).

## Post-signing addendum — the Black Market (P2P trade) — **SIGNED 2026-07-17**

Step-one levers (LIST_FEE_BPS 100/min $10, MAX_LISTINGS 3, MIN_RAISE_BPS 500, TAKE_BPS 200,
MAX_TTL_H 48, MIN_PRICE 50) founder-approved as production balance. Step two added (numbers
sign-off pending): `SNIPE_WINDOW_MS` 5 min (soft close), hidden reserves (no new money surface —
an unmet reserve refunds the bidder whole), and standing BUY ORDERS (escrow = qty×price under the
same `market escrow` §10.4 check; fills pay sellers minus the same 2% take; a dead poster's
escrow burns like any dead funder's). Orders share the MAX_LISTINGS cap so fake WTB walls are
bounded and fee-priced. The two step-one alpha watch items below still stand.

Structurally a TRANSFER layer, not a faucet: every sale moves cash player→player minus the 2%
take carved FROM the hammer (half street tax → the buyback, half burns) — net supply impact is
mildly deflationary, and wash-trading an alt costs 2% + listing fees for nothing (no volume
counter reads market activity). Levers (`BLACK_MARKET` rules tail): `LIST_FEE_BPS` 100 / min
$10 (prices the freed-trunk "warehouse" angle), `MAX_LISTINGS` 3 (bounds it), `MIN_RAISE_BPS`
500 (anti-penny-sniping), `TAKE_BPS` 200, `MAX_TTL_H` 48, `MIN_PRICE` 50. Watch in alpha:
(1) car prices vs the 50% fence floor — if market clears far above fence, GTA farming EV rises
(the faucet itself is unchanged; volume is the thing to watch); (2) goods listings as cheap
cross-district ARBITRAGE storage — pickup is district-pinned so the BUYER carries the transport
leg, but a seller listing at a high-price district they visited once effectively banks goods
there; if live data shows convoys losing volume to pre-positioned listings, pin goods listings
to the seller's CURRENT district at sale-time too, or cap goods listing size at trunk capacity.

## Post-signing addendum — step-two content (convoys / heists / Commission), sign-off pending

All three are extensions of already-signed systems; every new number is a lever.
- **Convoy tolls** (`TOLL_BPS` 5%): a pure TRANSFER (shipper → destination holder's treasury),
  clamped to pocket. Makes turf tax the trade routes — no new emission. Watch: routes may avoid
  held docks entirely if raised much above ~10%.
- **Degrading multi-ambush** (`MAX_AMBUSHES` 3, `GUARD_WEAR_BPS` 25%): raises convoy risk for
  the shipper (three shots at the manifest instead of one) — heavy guards still repel most
  attempts even worn twice (60 → 33.75 base at the third fight). Pure risk redistribution.
- **Freight insurance** (`INSURE_BPS` 10% premium, `INSURE_PAYOUT_BPS` 50% of lost value):
  payouts are CAPPED AT THE POOL (premiums minus prior payouts), so the product is zero-sum
  among shippers BY CONSTRUCTION — the §10.4 check `convoy insurance pool` proves it.
  Collusion (insure → friend hijacks → claim) redistributes premiums, never mints. Honest
  early-alpha behavior: a thin pool underpays claims; that is the design, not a bug.
- **Heist roles** (`HEIST_ROLES`, role stat ×3): same P ceiling/floor as step one, same clamp
  [.15,.92] — a full specialist crew equals a full generalist crew, so the signed heist EV is
  UNCHANGED at the top; mixed crews get there cheaper. Not a rebalance, a build-diversity knob.
- **The Inside Job** (`inside`: crew 2, lvl 12, base .55, stake $15k, `rateBps` 60%,
  `HEIST_INSIDE_CD_MS` 24h): NOT new emission — it redirects the mark's pending business income
  (the shakedown argument; the venue clock advances by only the stolen share). Max damage to an
  owner: 60% of one day's pending per venue per day, on a 55–92% roll, stake at risk. Compare
  shakedown: 30% at 8h cadence but solo. Watch the stack (shakedown + inside job on the same
  venue = up to ~72% of a day's pending lost) — if live data shows fronts turning -EV, put the
  two on a shared per-venue cooldown.
- **Commission weights + veto**: zero money. Weighted ballots concentrate decree power in the
  head seat (5 of 15 total weight vs 1/5 of votes before); the veto concentrates more. Both are
  status-axis politics — outside the signed economy by construction.

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

## Post-signing addendum — market/skills/underworld audit fixes (founder-approved, sign-off levers)

The `AUDIT-market-skills-underworld.md` four-lens pass closed one CRITICAL code bug (buying a
buy-order minted goods) + six correctness fixes, then the founder approved a five-item package for
the balance/design findings. All BUILT; suite 16/16 + sim drift-0. New levers:
- **`BLACK_MARKET.ORDER_MAX_QTY` 200** — a buy-order's units are capped (the warehouse was
  unbounded off-trunk storage); cancelled orders still holding goods now also count against
  `MAX_LISTINGS`. Bounds the trade-goods-arbitrage-vs-convoy concern (D8's turf-arbitrage cousin).
- **`UNDERWORLD.STANDING_DAILY_CAP` 25** — a per-fixture daily cap on RAW actor-side standing bumps
  (the spammable part), so tier 3 takes days of active play, not minutes; the once-a-day
  lead/streak/errand bonuses ride on top, exempt. Restores the "top tiers are EARNED" invariant and
  moots the whispers-vs-silent-hunt worry (madame 90 is no longer a cheap session grind).
- **order-escrow loot** — a fire-kill loots the signed `CASH_LOOT_RATE` (25%) of a victim's live
  buy-order escrow (ledgered `whack:loot` + `market:loot`, remainder burns; §10.4 exact), and
  posting an order is safehouse-blocked. Closes the loot-proof cash vault that undercut
  Make-Risk-Pay — parked liquid is now exposed like pocket cash. Reuses the signed loot rate; no
  new kill-economics number.
Founder call this pass: the two new numbers (200 order cap, +25/day standing) plus the decision to
reuse `CASH_LOOT_RATE` for order loot. Everything else in the audit was a code-correctness fix.

## Post-signing addendum — recurring sinks: "the pad" (business upkeep, sign-off levers)

The economy's first RECURRING, wealth-scaling sink, closing this document's own flagged
safehoused-landlord passive-stack (the deepest un-drained late-game faucet). Every business front
owes protection + wages proportional to its income; the bagman comes whether or not you collect.
Levers (`CONSTANTS`, `omerta-recurring-sinks-design.md`):
- **`BUSINESS_UPKEEP_BPS` 2000** — upkeep = 20% of the tier's `incomePerHr`. A daily-tending owner
  pays ~20% of gross as a recurring tax (the sink); the front stays net-positive. This is the
  primary dial: raise it to drain harder, lower it to soften.
- **`BUSINESS_UPKEEP_CAP_MS` 7d / `BUSINESS_UPKEEP_COLD_MS` 3d** — upkeep accrues on its own clock
  (distinct from the 24h income cap) up to a week; a front unpaid past 3 days goes COLD (no income
  / no launder / no upgrade) until squared. The asymmetry (earn ≤24h, owe ≤7d) is what makes
  neglect a net loss — an absent landlord's empire bleeds and freezes. Numbers chosen so an active
  player never freezes (pay every few days) while a truly absent one pays a real penalty.
§10.4: one sink reason (`business:upkeep`) already inside the `business:` vocabulary — no invariant
change; sim stays drift-0. Economic effect measured directionally: at 20%, business net EV drops
~20% and the passive-stack advantage the sim audit flagged shrinks toward the active loops — watch
in the next sim pass whether 20% is enough to close the gap or wants to climb.

**Step two — territory-racket upkeep** (same pattern, gang level): `TERRITORY_UPKEEP_BPS` 2000 /
`TERRITORY_UPKEEP_CAP_MS` 7d / `TERRITORY_UPKEEP_COLD_MS` 3d — every operation owes 20% of its
income, paid from the TREASURY (`territory:upkeep`, a treasury sink already inside the `territory:`
vocabulary — the invariant treasury check subtracts it with `territory:establish`; no schema/vocab
change beyond the invariant term). Same asymmetry (earn ≤24h, owe ≤7d) and cold penalty (3d → no
income / no upgrade); seizure hands the victor a fresh clock so a raided racket isn't born cold.
This drains the gang-treasury side of the passive stack (territory income was pure treasury faucet
with no recurring counter-flow). Numbers parallel the business pad for sign-off clarity; both dials
are independent.

**Step three — crew wages ("the nut")**: `CREW_WAGE_PER_HR` $1,200 / `CREW_WAGE_CAP_MS` 7d /
`CREW_WAGE_COLD_MS` 3d (M4). Each kitchen corner man draws $1,200/hr whether the stash moves or
not — a flat wage (not a % of sales, since crew income depends on stash supply), owed even when
idle, so it discourages keeping crew you don't supply. `crew:wages` is a cash sink (added to the
vocabulary beside `crew:hire`). Unpaid past 3d the crew goes cold and the §7.1 accrual stops their
offline sales. Economic note: this is the FIRST sink gating an OFFLINE faucet — a busy 5-crew
grosses ~$48k/hr while the nut is $6k/hr (~12%), but an IDLE 5-crew (no stash) still owes $6k/hr
for $0, so the drain is sharpest on hoarded-but-unsupplied crew (intended). The $1,200 flat is the
primary dial — watch the next sim pass on both the busy-crew % and the idle-crew bleed. Roadmap
(deferred, a founder design call — touches signed heat surfaces): the heat-scaled city pad/bribery.

## Post-signing addendum — Loan Sharking (the Shylock, step one) — **core balance SIGNED 2026-07-18**

The game's first PvP credit market. Levers (`LOAN` rules tail, all founder sign-off): `MIN` $5k /
`MAX` $1M loan band, `RATE_MAX` 0.5 (usury cap), `TERM_MIN/MAX_H` 1–72h, `VIG_BPS` 500 (5% house
cut on settlement → the buyback pool, the ONLY value the loan game removes), `COLLECT_HOSP_MS`
30min (the leg-break), `MAX_ACTIVE` 1 (no debt-stacking), `OFFER_TTL_MS` 48h.

**The core call — default risk — SIGNED AS-IS 2026-07-18: "the lender vets their counterparties."**
The audit flagged that first-loan-default is +EV for a throwaway/alt borrower (bank the principal —
cleared bank is a safe harbour — then default; the welsher mark gates only *future borrowing*, which
an alt doesn't value; the lender EATS the shortfall). The founder ruled this is **intended, not a
bug**: loan-sharking is a trust market, the lender carries the counterparty risk, and the market
self-corrects to vetted borrowers (a stranger's paper is priced accordingly, or not written). No
recourse-to-bank, collateral, or extra welsher penalty is added — the risk IS the game. So the
welsher mark stands as a reputation signal (a defaulter is publicly un-lendable-to), not a clawback.

Consequence for the deferred step-two list: **debt trading / directed (trust-line) loans / an
auto-contract on a welsher** become the natural way trust gets priced and enforced — build them as
the market's answer to counterparty risk, NOT as retroactive default protection for the lender.

Other flagged items remain open founder levers (not yet signed, ranked): the untaxed A→B collusion
transfer rail (a take-side take or same-IP flag), a "square your name" welsher-clearing sink, a
per-target collect cooldown, and whether default-collection is "civil" (reaches a safehoused/witpro
borrower, as built — the shakedown precedent) or an "attack" (shield-gated like fire/npcHit). The
five audited CODE defects are fixed in-commit (see `AUDIT-loan-sharking.md`); these are balance dials.

## Post-signing addendum — Loan Sharking step two (secured credit & enforcement, sign-off levers)

Framed by the step-one sign-off ("the lender vets their counterparties") to PRICE trust, not protect
lenders retroactively. All numbers proposed, sim + founder sign-off before production:

- **Directed (trust-line) loans** — no new number (a visibility + take gate; `loans.offered_to`).
- **Collateralized loans** — `LOAN.COLLATERAL_MAX` $5M bounds a secured offer's asking figure; the pledge
  valuation is `carCollateralValue` = `carVal × (1 − dmg/100)` (deterministic book value, reuses the signed
  car catalog). Economic shape: secured lending lets credit reach un-vetted borrowers because the car
  backstops the shortfall the lender would otherwise eat (step-one D1 flag). A default forfeits the car
  (ownership move, §10.4-neutral) ON TOP of the cash seizure — so a secured borrower's default cost = the
  30-min hosp + welsher mark + the pledged car, materially above the unsecured default (which the sign-off
  left as "the lender's risk"). Watch: a lender could demand collateral worth far more than the loan (a
  predatory over-pledge) — bounded only by the borrower declining; a max collateral-to-principal ratio is a
  future lever if over-collateralization becomes a grief.
- **The welsher hunt** — no new number (the `DIRECTED_MIN` waiver on a kill pot, the rat/vendetta twin). A
  status consequence: a defaulter is cheaply huntable. No money moves; outside the signed economy (the
  hitman-rep precedent — a cosmetic/access axis, not §10.4 balance).

Step three deferred (design-only): debt trading (selling the paper — a secondary market with its own escrow),
NPC lenders (a house credit line). Both are new surfaces needing their own sign-off.

## Post-signing addendum — Loan Sharking step two F1 + step three (sign-off levers)

- **Collateral auto-forfeit** (`LOAN.GRACE_MS` 24h) — a SECURED loan left un-collected past due + grace
  auto-forfeits its collateral car to the lender (worker sweep). Collateral-only, no cash — so it only
  resolves genuinely abandoned loans and does NOT touch the signed step-one cash-default behavior (the
  lender still bears cash risk; the borrower always had the grace to repay). A pure ownership move,
  §10.4-neutral. GRACE_MS is the lever.
- **The paper market** (`LOAN.PAPER_TAKE_BPS` 2%, `PAPER_MIN` $1 / `PAPER_MAX` $5M) — a lender sells an
  active loan's claim; the buyer becomes the new lender. A taxed cash transfer (2% → the pool, the
  market/bodyguard-take precedent) so it's not a free alt-rail. Economic shape: a receivable trades at a
  discount to `owed` reflecting default risk (collateral, the welsher mark, overdue) — creating a role
  for collector-specialists who buy risky paper cheap and enforce it. No new faucet (the loan's
  principal/vig fire on repay/collect regardless of who holds it). PAPER_TAKE_BPS + the price bounds are
  the levers.
- **NPC lenders — DEFERRED, not built.** An always-available house lender that MINTS cash to lend is a
  net inflation faucet on default (borrow → spend → default → keep). Doing it §10.4-clean needs a BACKED,
  sink-funded `loan_house` pool (the Phase-4 stake-pool pattern) — its own build, flagged for a step-four
  decision, NOT hand-waved as a mint.

## Post-signing addendum — Loan Sharking step four: WANTED (founder-directed; sign-off levers)

Founder-directed punishment for defaulters ("a hit put on them / become wanted"). A default marks the
borrower WANTED for `LOAN.WANTED_MS` (3d). Levers:
- `WANTED_BOUNTY` $25k — the pool-funded "dead or alive" price any player collects by killing the mark
  (redistribution from the confiscation pool, not a mint — burns/refunds/pays out, §10.4 bounty-escrow
  reconciled; pool-guarded so it never goes negative).
- `WANTED_HUNT_P` 0.05/worker-tick — the NPC bounty-hunter roll (frequency-dependent; a sign-off lever,
  the LAW_BUST_P precedent — env-overridable for tests, never in production). Over a 3-day window at ~hourly
  ticks a mark is very likely whacked unless they hide (safehouse) or square up.
- `SQUARE_COST` $50k — squares the name: clears WANTED **and** the welsher mark + refunds the pool bounty.
  A cash sink → pool. **This changes the step-one "welsher is permanent" sign-off** (defaulting is now
  recoverable at a price — the founder-requested "square your name" route the step-one audit flagged).
Omertà-strip / NPC-hunter existence / the pursuit window are new founder levers — status/PvE pacing on
top of signed BALANCE surfaces, not retunes of them.

## Post-signing addendum — WANTED audit (founder sign-off items)

The step-four WANTED audit (`AUDIT-loan-wanted.md`) fixed a HIGH §10.4 drift + a MED pardon-trap + a LOW
lock-order in-commit. Open founder balance/design calls (NOT patched, ranked):
- **Alt-farm the pool bounty (MED) — MITIGATED (`WANTED_MIN_LVL` 10)**: the pool cash bounty now only
  lands on a defaulter at/above level 10, so a throwaway rookie alt (the cheap farm fodder) generates
  NO price (still WANTED — omertà stripped + NPC hunters). This forces real per-alt leveling friction
  (the npcHit rookie-floor precedent) that doesn't scale like alt-spam. Residual: a determined farmer
  can still level alts; if it bites, a per-account/day cap or principal-scaled bounty is the next lever. §10.4-clean (redistribution, never minted), friction-bounded (the borrower alt
  dies; pool must hold ≥$25k; an NPC hunter/other player may kill first and BURN it). Mitigations if it
  bites: a per-account/day wanted-bounty cap, a borrower level floor on the pool bounty, or funding the
  HOUSE pot from the defaulted principal instead of the communal pool. Same class as the casino
  unbacked-faucet / farmable-faucet flags.
- **Disproportion (LOW)** — a $5k (`LOAN.MIN`) default triggers the full WANTED apparatus + a $50k
  `SQUARE_COST` (~10× the debt). Bounded by consent + the cheaper repay path; a dial.
- **jump-vs-family asymmetry (LOW)** — a family member can fire/npcHit/contract a WANTED mate but not
  the lesser non-lethal jump (consistent with the rat precedent, which also never stripped jump).
- **`WANTED_HUNT_P` 0.05/tick is worker-frequency-dependent** — tune with the real tick cadence.

## Post-signing addendum — the ECON PASS (founder-directed 2026-07-18): the three flagged holes

The founder directed a core-loop economics pass on the audits' three standing flags. Measurement first
(`tools/sim.js` + code reading), then structural fixes — **no signed numeric lever was retuned**.

### 1. The den's mint-on-top (FIXED — structural, both §10.4-identity-checked)
Measured: PvE `takeHouse` credited the street pool 1% of stake volume un-ledgered and independent of
results, and `casino:rakeback` was a ledgered faucet from nowhere — combined ~2%/volume distributed
against dice's 1.41% edge, so dice volume was **net-inflationary (+0.59%/unit)** with volume a free
variable. **Fix: the house now tips only out of REALIZED profit.** `den_volume` carries `profit`
(Σ PvE stakes − Σ PvE payouts — mirrors the ledger exactly) and `distributed`; every street cut and
rakeback is capped at `profit − distributed − open liability` (600:1 numbers + dog-odds fight exposure
held in reserve), each pool credit is a ledgered NULL `casino:take` row, and rakeback that can't be
covered simply WAITS (cursor holds — nothing forfeits). On a bad night the street doesn't get tipped.
PvP untouched (its rake was already carved from the winner). §10.4 gained two exact identities
(`den profit`, `den distributions`). The 1% cut / `RAKEBACK_BPS` 100 numeric levers are UNCHANGED —
they now mean "up to, when the house is ahead," which is the only economically honest reading.

### 2. Purchasable Commission standing (FIXED — seasonal chamber)
Measured: seats ranked by `lifetime_tribute + 10000×wars_won` — tribute is pocket→own-treasury
(~zero net cost) and NEVER decayed, so a parked whale owned the head seat + veto forever (flagged in
three audits). **Fix: the chamber now ranks by THIS SEASON's showing** (`season_tribute` +
10000×`season_wars`, reset at rollover — the hitman legend/season precedent; `gangs.season` is the
lazy marker, founders stamped at creation). Buying a seat still works — but it must be re-bought every
season, and the parked treasury is war-lootable the whole time (spoils take 20%). The buyback family
split keeps the LIFETIME formula — a different, signed surface, untouched.

### 3. Kill EV (D1) — CONFIRMED as signed, now tracked
Re-measured with every loot surface live: standalone loot-EV vs a careless mid mark is **−$72k**
(ammo $82k dominates; break-even liquid ≈ $328k — "hunt whales", exactly the signed D1). This is BY
DESIGN: the kill economy is CONTRACT-driven — pots, the $25k WANTED house bounty, war points, and
vendettas pay for wet work; loot is the tip. The sim now prints a standing `contract break-even`
probe (pot ≥ ~$72k turns a mid-mark job +EV) so the number is tracked at every economy change. No
lever moved.

## Post-signing addendum — the Estate & the Auction House ($OMR sinks, sign-off levers)

Two new $OMR sinks (both status-only, outside the sim-audited gameplay balance — the hitman-rep /
family-seal / Portfolio precedent). All numbers are the founder sign-off levers in the `ESTATE` /
`AUCTION` rules-tail blocks.

- **The Estate** — a one-time-then-upgradeable personal compound (`estate:tier`/`estate:feature`/
  `estate:name` $OMR burns). Account-level, survives death (the heir inherits). No escrow, no §10.4
  faucet — pure deflation.
- **The Auction House** — the competitive, recurring $OMR sink. Weekly server-drawn lots; the
  highest $OMR bid wins and **the winning bid BURNS** (`auction:win` — the only deflation). Bids
  ESCROW $OMR (`auction:bid` account→escrow, `auction:refund` escrow→outbid-account — both transfers;
  the escrow bucket is in `omrBuckets`, reconciled by the new `auction escrow` invariant). $OMR is
  account-level → a live bid survives death, so no death handling is needed. Numbers: `LOTS_PER_WEEK`
  3, `MIN_RAISE_BPS` 500 (+5%), the archetype floors (20–150 $OMR).

**Auction-escrow red-team (accepted-as-designed, founder call — NOT patched, ground rule #1):**
The bid escrow is a **windowless loot-shelter for the P1.1 $OMR loot surface** — parking liquid $OMR
in a standing bid moves it out of the fire-kill `OMR_LOOT_RATE` reach one block ahead of a hit, with
no exposure window (unlike a bank deposit's `BANK_CLEAR_MS` in-transit or an unstake's `UNSTAKE_CD_MS`
unbonding). It is **self-limiting**: there is no bid-cancel (you can only be outbid, which refunds you
but hands the lead — and thus the shelter — to a rival), and a lot you actually win BURNS 100% of the
bid, so the "shelter" costs the full amount if it closes on you. A future sign-off lever could add an
`auction:refund` exposure window (park the refund in-transit like a bank deposit) if whale $OMR-
sheltering via perpetual outbid-churn is observed in the alpha. Two correctness fixes shipped from the
same red-team: the concurrent-first-bid materialize race (`23505` → clean `contention` retry via
`deadlockToRetry`, was a raw 500) and the ops dashboard `$OMR supply` gauge omitting the live escrow.

## Post-signing addendum — the Envelope & the Foundation (Law-surface $OMR sinks, sign-off levers)

Two recurring $OMR sinks that buy LEGITIMACY — the counterweight to the RICO antagonist. Both are NEW
Law levers (real gameplay effect, not pure status), so every number is a founder sign-off lever — sim
+ this file before production. They are NOT retunes of any signed BALANCE.md surface.

- **The Envelope** (`LAW.ENVELOPE_OMR` 15 / `ENVELOPE_MS` 7d / `ENVELOPE_GAIN_MULT` 0.5) — a personal
  recurring $OMR sink (`law:envelope` burn) that, while paid up, halves the investigation-meter GAIN
  (the cops bury the file). NOT immunity (a reckless player still indicts; the bleed is untouched) and
  NOT a trial modifier (it's preventive — the bribe/lawyer/jury/foundation handle a filed case). A
  proactive standing arrangement vs the reactive one-shot bribe. Deliberately not safehouse-gated (a
  wire, not a sit-down). Deflationary — helps extraction-≤-inflow.
- **The Foundation** (`FOUNDATION.TIERS` Community Fund 60 → Youth League 180 → City Trust 500 → The
  Institute 1200 → The Legacy 3000 $OMR; `bustMult` 0.97 → 0.75) — a family/gang tiered $OMR sink from
  the `omr_reserve` (`foundation:tier` burn, the family-seal precedent). Public philanthropy status +
  it softens EVERY member's RICO conviction odds by the tier's `bustMult` (the one gameplay
  touchpoint, threaded into `bustProbOf`; bottoms out at the existing min-clamp floor, composes with
  retainer/jury). Reaches the offline whale via `resolveBust`'s `familyFoundationTier` lookup.

**Balance notes (founder sign-off items):** (1) The Foundation is a wealth-gated defense — a rich
family buys down its members' bust odds; deliberately bounded by the min-clamp floor and the sequential
$OMR cost (Obsidian-tier is 3000 reserve $OMR, a real pool sink). If it proves too strong vs the Law
antagonist, `bustMult` is the dial (or gate the top tiers behind season standing like the Commission
fix). (2) The Envelope's 0.5 gain-mult + 7d window at 15 $OMR is cheap standing protection; if it
neuters the RICO loop for whales, raise `ENVELOPE_OMR` or weaken `ENVELOPE_GAIN_MULT` toward 1. Both
were sim-clean at drift-0 on build; watch the RICO conviction rate in the alpha.

### Envelope/Foundation red-team — accepted design/balance calls (founder sign-off items)

A four-lens red-team returned no CRITICAL/HIGH (§10.4, locks, Law-math, abuse all clean). Three lower
findings, all flagged (NOT patched — ground rule #1):
- **(MED) Foundation freeload via immediate join** — an indicted player can join a high-tier-foundation
  family right before `demandTrial` to grab the members' bust-soften, then leave. This is the
  already-accepted "joining is immediate (no apply/accept queue)" posture that EVERY family perk shares
  (turf perks, war participation, contract protection). A real gate needs per-member join timestamps
  (`gang_members` has none today) + a design decision (does the charity protect brand-new members?).
  Mitigated in practice: needs a genuine high-tier foundation (endgame, 3000+ reserve $OMR), the
  freeloader is publicly in that family, and the effect is bounded by the min-clamp floor. Dial: add
  join timestamps + gate the soften on membership predating `indicted_at` if the alpha shows abuse.
- **(LOW) Foundation wasted at the clamp floor when stacked** — `bustProbOf`'s min floor is
  `BUST_P_MIN × RETAINER_BUST_MULT × JURY_BUST_MULT` and omits `foundationBustMult`, so a member
  already stacking retainer+jury at extreme exposure gets zero marginal reduction from even a tier-5
  foundation. Narrow corner. Dial: fold `foundationBustMult(tier)` into the floor if the charity should
  compose below the standard-defense floor.
- **(LOW) Envelope payable while indicted** — the envelope only scales the meter GAIN, so it can't help
  a FILED case; but an active window still slows the post-acquittal exposure rebuild, so it is NOT
  wasted for a savvy player and the card copy never claims to fix a filed trial. Left as-is.

### Envelope/Foundation step two — new sign-off levers (built)

Three touchpoints (§10.4-neutral — meter-rate + conviction-odds modifiers, Law levers):
- **Freeload gate** (`gang_members.joined_at`) — closes the step-one MED: the Foundation's trial-soften
  applies only to a member who joined before their indictment. No number, a structural gate.
- **Foundation passive heat-bleed** (`FOUNDATION.TIERS[].bleedMult` 1.15 → 2.0) — every member's
  investigation meter bleeds faster while the family holds a Foundation; the charity now PREVENTS the
  case, not just softens a filed one. Dial per tier if it over-protects vs the RICO loop.
- **Envelope accelerated bleed** (`LAW.ENVELOPE_BLEED_MULT` 2) — the envelope also bleeds the meter 2×
  faster while current (builds slower AND cools faster). Dial toward 1 if standing protection is too
  cheap for whales.

Both bleed levers compose multiplicatively with each other and with the event/decay base. Sim-clean at
drift-0 on build; watch the RICO conviction/indictment rate in the alpha.

### Envelope/Foundation step two — red-team result (CLEAN) + sign-off items

A four-lens red-team over the step-two deltas returned no CRITICAL/HIGH/MED (freeload gate airtight,
bleed math floored, §10.4-neutral, no lock/regression). Three flagged items (NOT patched, ground rule #1):
- **(L1, balance)** The foundation bleed accelerates the meter even while a case is FILED, so a
  maxed-foundation offline whale gets bled toward `INDICT_AT` (lowering the exposure-driven `bustProbOf`)
  AND keeps the step-one `bustMult` — a double discount on the same forced trial, bounded by the
  `bustProbOf` min-clamp. Note: base `EXPOSURE_DECAY` already bleeds exposure while indicted; step two
  only accelerates it. Dial = `bleedMult`, or gate the bleed on `!indicted_at` if it over-protects.
- **(L2, design)** The freeload gate keys on join-time vs indict-time only — a family can upgrade the
  foundation AFTER a still-member is indicted and soften that trial. Reads as intended (collective
  defense of a made man who was in the family when the case was filed); confirm it matches design intent.
- **(L3, deploy note)** No migration script exists (`schema.sql` is `CREATE TABLE IF NOT EXISTS`;
  fresh-DB alpha + pg-mem are unaffected). Adding `gang_members.joined_at NOT NULL DEFAULT now()` to a
  LIVE DB via `ALTER TABLE` backfills every existing member with the migration timestamp, so anyone
  indicted BEFORE the migration transiently reads `joined_at > indicted_at` and loses their foundation
  soften for that in-flight case (one-time, player-unfavorable). If a live migration is ever needed,
  backfill `joined_at` from `gangs.created_at` or a sentinel epoch instead of `now()`.

## Post-signing addendum — The Pen step three: THE BREAKOUT (sign-off levers)

A solo, high-risk jailbreak that trades a cell for a MANHUNT, so it never trivialises the RICO sink.
§10.4-clean (no currency moves in the break itself; the cutkit is a normal `pen:commissary` sink).
All numbers are founder sign-off levers:
- `PEN.BREAK_P` 0.35 (base success; a riot's `shankAdd` adds; `PEN_BREAK_P` is a TEST-ONLY roll knob).
- Cutkit cost $50k (a `pen:commissary` cash sink → the buyback pool, burned win or lose).
- `PEN.BREAK_HEAT` 40, `PEN.BREAK_CAUGHT_ADD_S` 900 (15min added stretch on a miss),
  `PEN.BREAK_FAIL_DMG` [20,45], `PEN.FUGITIVE_MS` 2d (the WANTED window on a win).

Design intent: a win FREES you but makes you a WANTED fugitive (omertà stripped + NPC bounty hunters —
the loan-WANTED machinery), so the escape is +EV only if being hunted-but-playable beats waiting out the
cell. A miss is punishing (the hole + a long stretch + a beating). No pool bounty is posted (kept
§10.4-clean); the escapee can clear the warrant by lying low or paying the existing `loans/square`
($50k → pool). Watch in the alpha: whether 0.35 makes breakouts too common vs the RICO sink's intent
(the dial is `PEN.BREAK_P` down, or `FUGITIVE_MS` up to make the manhunt bite harder).

### The Pen breakout — red-team result (CLEAN) + one balance flag

A four-lens red-team over THE BREAKOUT returned no CRITICAL/HIGH/MED (§10.4-clean, state-correct,
concurrency-safe; the win never clears `indicted_at` so a fugitive stays RICO-indictable; `wanted_until`
only ever extends, never shortens; `squareWanted` handles a bounty-less pen fugitive cleanly). Two findings:
- **LOW-1 (fixed):** the non-lethal `jump` path did NOT strip omertà for a WANTED/rat target, unlike
  fire/npcHit/postBounty/startSearch — a fugitive's own family couldn't jump him. Aligned `jump` with the
  others (`!h.victimAcct.rat && !isWanted(victim)`) so a hunted man forfeits protection on EVERY PvP path;
  regression added.
- **LOW-2 (flag, sign-off lever):** no per-attempt breakout cooldown — pacing comes only from energy
  (30/try) and the hole on a miss. A cash-rich inmate can stack $50k cutkits and retry the 35% roll to make
  escape near-certain over time. §10.4-clean (each cutkit is a `pen:commissary` sink → the pool,
  deflationary) and arguably matches the "trade a cell for a manhunt" intent. Dial if the alpha shows escape
  is too reliable: a `break_at` cooldown, `PEN.BREAK_P` down, or `FUGITIVE_MS` up.

## Post-signing addendum — The Pen step four: THE CO-OP BREAKOUT (sign-off levers)

The crew-heist pattern applied inside — 2–4 jailed inmates over the wall together. §10.4-clean (the
cutkit is contraband, not currency; the only ledgered event is buying it, a `pen:commissary` sink).
All numbers are founder sign-off levers:
- `PEN.COOP_MIN` 2 / `COOP_MAX` 4 (crew bounds).
- `PEN.COOP_BASE` 0.4, `COOP_PER_EXTRA` 0.12, `COOP_MAX_P` 0.9 — `p = base + (crew−1)×per_extra + riot`,
  clamped. So a 2-crew ≈ 0.52, a full 4-crew ≈ 0.76 (a riot's `shankAdd` +0.2 helps). `PEN_BREAK_P` is
  the TEST-ONLY roll knob.
- `PEN.COOP_TTL_MS` 1h (a plan goes cold; the worker sweeps it and refunds a living leader's staked cutkit).
- Shared with the solo break: `FUGITIVE_MS` 2d (everyone WANTED on a win), `BREAK_HEAT` 40,
  `BREAK_CAUGHT_ADD_S` 900 + `BREAK_FAIL_DMG` on a miss (the whole crew).

Design intent: a bigger crew improves odds but every escapee becomes a WANTED fugitive (omertà stripped +
NPC bounty hunters), and a bust puts the WHOLE crew in the hole with a longer stretch — a shared,
high-stakes gamble that trades cells for a coordinated manhunt. Watch in the alpha: whether a full 4-crew
at ~0.76 makes group escape too reliable vs the RICO sink (dials: `COOP_BASE`/`COOP_PER_EXTRA` down,
`COOP_MAX_P` down, or `FUGITIVE_MS` up). Same LOW-2 note as the solo break: no per-attempt cooldown
(the hole on a miss + the cutkit cost are the pacing).

### Co-op breakout red-team — HIGH fixed + design flag

A concurrency-focused red-team over the co-op breakout returned CLEAN on the lock order (leader→sorted
members→break row, disjoint executes, residual leader-vs-PvP 40P01→contention), cutkit conservation, and
persist-clobber — and found one HIGH (fixed):
- **HIGH (fixed):** `executeBreak` flipped the plan to `'done'` but never deleted the member rows, and
  `pen_break_members.character_id` is globally `UNIQUE`, so a survivor's NEXT plan/join would trip 23505
  → perpetual `contention` (feature bricked per-character until death). Fixed: `executeBreak` now DELETEs
  the memberships on resolve (the character outcomes are on the character rows, not the membership rows),
  so the UNIQUE constraint only ever guards live planning rows — this also keeps the constraint's benefit
  (it structurally forbids the double-join race the heist gate accepts as residual). Regression added
  (a survivor re-plans a break without contention). Also dropped a redundant execute-time cutkit consume
  (the kit is spent at plan; the redundant call was a no-op that could destroy a leader's *second* kit).
- **LOW / design flag (not patched — sign-off lever):** the co-op break strictly dominates solo — only
  the leader stakes a cutkit, joiners pay nothing, and a full 4-crew escapes at ~0.76 vs solo's 0.35, all
  sentences cleared for one $50k kit. Consistent with "the leader stakes the kit"; price it deliberately.
  Dials: charge joiners a kit/energy, lower `COOP_BASE`/`COOP_PER_EXTRA`, or cap the crew payoff.

## Post-signing addendum — The Pen step five: PRISON FACTIONS + THE BREAK RAT + yard incidents (sign-off levers)

All §10.4-clean (status/pacing only — factions and the rat move no currency; the ratted break's sole
ledgered event is the already-spent cutkit). All numbers are founder sign-off levers:
- `PEN.FACTION_COVER` 0.08 per live jailed same-crew mate, `FACTION_COVER_CAP` 0.24 (so cover tops out at
  3 mates), `SHOTCALLER_COVER` +0.10 for the crew's most-feared (highest `season_kills`). The cover is
  SUBTRACTED from a shank's success `p` against a crew member, and same-crew shanks are blocked outright
  (yard omertà; a rat target voids it). Watch: whether stacked cover + protection makes a well-connected
  inmate effectively un-shankable — the dials are the two cover constants + the cap.
- **The break rat is RELIEF-ONLY** (was `BREAK_RAT_CUT_S` 3600 — retired by AUDIT-session-drops-2.md).
  A ratted break blows; the rat dodges the crew's added stretch (`BREAK_CAUGHT_ADD_S`) + the beating, but
  serves their OWN sentence unchanged — never a cut below it. The original absolute 1h cut let a Sybil pair
  (main leader + throwaway alt) farm a cheap sentence trim ($50k cutkit → 1h off, ~14× under the bribe
  sink), falsifying the "self-rat is −EV by construction" claim. Relief-only restores it (self-rat is now
  net-negative — you burn a $50k kit for nothing) while a legit saboteur still dodges the failure penalty +
  denies the crew the escape. If the founder wants a "reward" flavor back, reintroduce a bounded cut with an
  OFFSETTING cost the rat bears (energy/health/a longer hole) so it stays −EV to manufacture.
- Yard incidents added: `gangwar` (shankAdd +0.15, bribeMult 1.5) + `newfish` (protMult 1.5) — each a
  one-touchpoint block-wide daily modifier (the decree precedent), the same weighting note as step two
  (a hard-block/perturb day is ~drawn share of the pool; if the loop feels too often gated, thin the deck).

Design intent: factions are a purely social/defensive status layer (cover, not power — they move no money
and grant no offense bonus), and the break rat imports the heist-rat's betrayal drama into the co-op break
(the crew never learns the name — the feed only says "somebody talked"). Nothing here touches the signed
economy.

### Territory step three — the upgrade raid-dodge (sign-off flag, AUDIT-session-drops-2.md)

`upgradeRacket` collects the pending income at the old rate and resets the operation's clock WITHOUT
rolling `resolveTerritoryRaid` — so a hot smuggling/protection op can UPGRADE to sidestep a pending Bureau
raid. §10.4-clean (the pending collected is a legitimately ledgered `territory:income` faucet — no drift),
so it's a BALANCE call, not patched per ground rule #1. **The speakeasy audit fixed exactly this class**
(`upgradeSpeakeasy` resolves the raid first + refuses while shut); the parity dial is to mirror it in
`upgradeRacket` (resolve the pending raid before the upgrade; order the fine clamp vs the upgrade cost so
the treasury can't overdraw). Not a new exploit class — frequent-collect already dodges the raid for a hot
type (the "active collection banks the full mult" tradeoff above).

## THE WIRE — the intelligence terminal (proposed levers, sign-off pending)

Off-chain, §10.4-clean recurring $OMR sinks (every burn rides the existing `intel:*` omr vocabulary +
burn term — zero invariant changes; status/access/convenience, never sim-audited power). `WIRE` block:

| Lever | Default | Rationale / measurement | Rec |
|---|---|---|---|
| `TAP_OMR` | 8 $OMR | Wiretap on a rival for a 12h window — the offensive intel sink. Priced as a routine recurring buy (below the peek's 5 $OMR only nominally; a tap reveals far more, over time, than a one-shot peek). | KEEP |
| `TAP_MS` | 12h | The surveillance window. Long enough to be worth 8 $OMR, short enough to be recurring. | KEEP |
| `TAP_MAX` | 5 | Concurrent wire cap — a spy runs a watchlist, not the whole town. | KEEP |
| `SWEEP_OMR` | 5 $OMR | Clears every bug on your line; FREE when clean (the peek precedent — no charge for a no-op). Counter-play to taps; cheaper than a tap so defense is affordable. | KEEP |
| `SUB_OMR` | 12 $OMR / week | The Street Wire premium feed (forecasts + threat-chatter COUNT + war room). A recurring weekly sink — the late-game "Bloomberg terminal" subscription. | KEEP |
| `SUB_MS` | 7d | Subscription window; extends from the later of now/current end (the retainer/envelope precedent). | KEEP |

**The layered intel economy (deliberate, keep the tiers distinct):** the SUB warns you (a hunter
COUNT, never a name), a TAP identifies whether a SPECIFIC rival is hunting you, the $OMR **peek** names
funders. Each tier sells strictly more identity for strictly more cost — don't collapse them.

**Notes / watch-items (not patched — sign-off):**
- The tap INTEL is intentionally *banded* (wealth band, heat band, ops COUNTS, stage) — never exact
  books — so surveillance informs targeting without handing a mark's precise numbers to a rival. If the
  bands prove too coarse/fine, they're the dial (a status-axis read, outside §10.4).
- The premium threat-chatter is a COUNT of hunters, by design (the peek stays the only name-piercer).
  If whales want names on the sub, that's a deliberate re-pricing of the peek, not a free add.
- All numbers are new/tunable — sim + founder sign-off before production (ground rule #1).

## THE STORE — ETH revenue packages (proposed levers, sign-off pending)

Off-chain-first / chain-dormant, **§10.4-neutral** (the Store grants only entitlements / access / status
— zero `transactions` rows, zero new faucet). Real ETH is out-of-band. All prices/splits are sign-off
levers; the anti-pay-to-win guardrail (nothing here grants cash/$OMR/gear/power) is a HARD design rule,
not a lever.

**The three-way revenue split** (`STORE.SPLIT_BPS`, env `REVENUE_{FOUNDER,BUYBACK,RWA}_BPS`, must sum 10000):

| Share | Default | What it does | Rec |
|---|---|---|---|
| founder | 40% | Profit — the ETH already hit the dev wallet on-chain; recorded as the earmark. | KEEP (raise for more near-term profit) |
| buyback | 40% | → the EXISTING Vig flywheel (`vig_revenue`): buys $OMR → reserve + season prize pool. This is "spenders fund earners" + the token support; `extraction ≤ inflow` still holds by construction. | KEEP (raise for a hotter token + happier earners) |
| rwa | 20% | → `rwa_revenue`, **R2 DORMANT** (recorded, never spent until the legal-gated real-RWA reserve ships). | KEEP (raise as you build toward a backed Dynasty Fund) |

**The packages** (`STORE.PACKAGES` — priced as consumables / access / status, never power):

| SKU | Price (ETH) | Grants | Note |
|---|---|---|---|
| `made_man` | 0.01 | +1 mint credit | = the existing mint fee, now a Store SKU on the new split |
| `revive_3` | 0.25 | +3 respawn tokens | bundle vs 0.10 ea (~17% off) |
| `revive_5` | 0.40 | +5 respawn tokens | deeper bulk (20% off) |
| `wire_month` | 0.03 | +30d Street Wire | ETH convenience vs the 7d $OMR sub |
| `season_pass` | 0.05 | +30d pass + 2 revives + patron badge | recurring monthly; status + consumables (no cash/$OMR stipend in v1 — deferred) |
| `patron` | 0.10 | permanent patron badge | the pure Vanity flex; survives death |

**Notes / watch-items (not patched — sign-off):**
- The Season Pass deliberately grants NO cash/$OMR stipend in v1 (a per-buyer prize-pool draw would
  complicate the backed prize accounting — deferred). The pass's value is status + consumables + access;
  the *earner* reward is the prize pool the buyback share already funds.
- `pass_until` + `patron` survive death (account-level, the `minted` precedent) — a real-money purchase
  carries to the heir.
- The Store's real payment path is the on-chain paywall (dormant, mainnet-gated); today's live path is the
  mod comp/simulate route. Deploy note: nothing extracts real value until the `OmertaFees.payForPackage`
  contract + the `StorePaid` watcher ship — both gated on legal + the third-party audit.

## THE LEDGER — Season Pass reward track (proposed levers, sign-off pending)

A daily-claim track unlocked while the ETH Season Pass is active. Anti-pay-to-win + §10.4-safe: rewards
are status / consumables / a backed $OMR stipend (via the prize-pool rail — never a mint). `PASS` block:

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `TRACK` length | 12 tiers | ~12 daily claims over the 30-day pass — a reason to log in. | KEEP |
| claim cooldown | ~20h (`passClaimMs()`) | One mark per day; `PASS_CLAIM_MS` is a TEST-ONLY knob — never in production. | KEEP |
| title tiers | 1/5/9/12 | Pure status (the character title slot; street-scoped like mission titles). | KEEP |
| revive tiers | 2/6/10 (1/1/2) | Consumable revive tokens (account-level, survive death). | KEEP |
| energy tiers | 3/7/11 | A full-tank refill (not §10.4 currency). | KEEP |
| $OMR stipend | tiers 4/8/12 (2/3/5 = 10 total) | Paid through the BACKED prize pool (`payPrizes`), pool-bounded. The pass's own buyback share (0.05 ETH × 40% → the pool) funds ~2× the stipend at typical prices, so the stipend stays below what the pass contributes — net-positive for the earner pool. | KEEP |

**Notes (sign-off):**
- The stipend is the "spenders fund earners" loop closing on itself: the buyer's ETH funds the pool their
  own stipend draws from, bounded so it never drains the pool the skilled earners compete for.
- Pool-bounded: if the prize pool is dry (early alpha, no revenue yet), a stipend tier pays what the pool
  can cover (possibly 0) and still advances — the track is never blocked. In a live economy the pool has
  funds. The stipend amounts + tier placement are the dials if the alpha shows the pool straining.
- The track is account-level (survives death); a fresh pass season (bought after lapse) resets it.

## THE DYNASTY FUND — RWA dividends + tiers (proposed levers, sign-off pending)

Turns the R1 Portfolio from pure status into a productive, generational asset. §10.4-clean via the
stake-pool pattern: dividends are a TRANSFER (pool→account), never a mint; the pool is fed by a slice
of every invest (a transfer, account→pool). `PORTFOLIO` block additions:

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `DIVIDEND_BPS` | 1500 (15%) | Slice of every personal invest redirected from the burn into the dividend pool. New capital pays holders' yield (a real fund). Reduces the RWA deflationary sink by 15% (still 85% burns). | KEEP |
| `DIVIDEND_DAILY_BPS` | 30 (0.30%/day) | A claim pays this % of INVESTED PRINCIPAL (cost basis, not market book — free granted shares earn nothing; the round-2 free-rider fix), POOL-BOUNDED. True yield = what invests fund. | KEEP |
| `DIVIDEND_MS` | ~20h | The ~daily claim cooldown (a login reason). | KEEP |
| `DYNASTY_TIERS` | 100 / 500 / 2500 / 10000 / 50000 $OMR | Pure STATUS on cumulative $OMR invested (monotonic). Outside §10.4 and the sim-audited balance. | KEEP |

**Notes (sign-off):**
- The dividend is self-bounding: the pool can only pay what investment funded it (the stake-pool
  "backed emission" rule). A dry pool is a clean refusal — the fund never mints to pay a dividend.
- "Spenders fund holders": late-game investors' capital pays existing holders' yield, so the RWA layer
  now has a reason to hold beyond the flex — the retirement-fund fantasy realized.
- Economic watch-item: the 15% redirect slightly softens the RWA $OMR sink (deflation). Bounded, and the
  dial (`DIVIDEND_BPS`) is the lever if the sim shows supply pooling. `DIVIDEND_DAILY_BPS` is the yield dial.
- Both dividends (via the account) and tiers (via `rwa_invested`) are account-level → survive death.

---

## Night-session features F1–F4 + shakedown flags (2026-07-19)

Four features shipped this session (all off-chain, §10.4-clean, numbers are proposed defaults —
sign-off levers): **F1** family-book dividend (the Dynasty dividend at the GANG level — reserve yield,
`DIVIDEND_BPS`/`DIVIDEND_DAILY_BPS` reused), **F2** PLEX-for-packages (`PLEX_FLOOR_OMR_PER_ETH` 5000,
`PLEX_PREMIUM_BPS` 12000 — $OMR stays the premium rail, ETH the economical one), **F3** named landmarks
(`LANDMARKS.MIN_DEDICATE` 20, a per-district plaque $OMR flex — a pure deflationary vanity burn),
**F4** family dynasty (`FAMILY_DYNASTY_NAME_OMR` 15 — name the gang RWA book from the reserve + crest tier
+ family-legit leaderboard). All KEEP pending founder sim sign-off.

**Shakedown flags (four max-effort red-teams; no CRITICAL/HIGH; real bugs fixed in-commit, these are the
founder BALANCE decisions):**

| # | Item | Nature | Rec |
|---|---|---|---|
| A1 | **Shared dividend-pool fairness** | The single `rwa_dividend_pool` has no per-account allocation, so the largest book can capture the daily inflow (`book × DIVIDEND_DAILY_BPS`, pool-bounded, first-come each cooldown) and starve small funders who fed 15% into the same pot. **§10.4-CLEAN** (pool never mints, pay ≤ pool always) — a redistribution, not a leak. The structural dial is a per-claim cap tied to the claimant's OWN lifetime `dividend:fund` contributions (needs a new column). | FLAG — decide if small-holder fairness matters for alpha; else KEEP as "spenders fund the biggest holders" |
| — | **Underboss fund-rename drain** | `nameFamilyDynasty` is boss/underboss + uncapped by distinct name (15 $OMR/reserve/rename). A same-name no-op is now guarded (fixed); a rogue underboss spamming DIFFERENT names still drains the reserve — but underbosses already move reserve value via `familyInvest`/tribute, so it's an accepted insider-trust posture. Boss-only is the dial. | KEEP (boss-only if abuse seen) |
| — | **PLEX oracle staleness** | `plexPackageQuote` reads the latest buyback price with no staleness bound — a player can time a buy to a low-oracle print, but always pays ≥ floor AND ≥ 1.2× market. Market-linking by design. | KEEP |

The on-chain Store `grantPackage` guard (made_man-while-minted) + wire_month-before-character reconcile +
the concurrent window-extension lost-update are **dormant-path items for the on-chain Store wiring
milestone** (mainnet-gated; throwing there would break idempotent ingestion) — not balance levers.

---

## The Speakeasy — step one (2026-07-19; the social hub)

The game's first place-based social venue (`omerta-speakeasy-design.md`). All numbers are proposed
defaults — sim + founder sign-off before production (ground rule #1). §10.4-clean, off-chain.

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `SPEAKEASY.MIN_LEVEL` | 15 | A made man's venue — mid-game+. | KEEP |
| `SPEAKEASY.OPEN_COST` | $750,000 | Cash sink to establish the district's one club (scarce → prestige). | KEEP |
| `SPEAKEASY.TIERS` incomePerHr | 8k → 130k/hr (Backroom→Cathedral) | Base bar take, capped 24h — between a laundromat and a restaurant; the club's real draw is patronage. | KEEP |
| `SPEAKEASY.TIERS` cost | 0 → $11M | Decor ladder — a deep cash sink for a prestige venue. | KEEP |
| `SPEAKEASY.ROUNDS` | round $8k / topshelf $40k | Buying a round: a TAXED transfer patron→owner (owner nets 98%, the bodyguard-hire mechanism) — "spenders fund proprietors". | KEEP |
| `SPEAKEASY.VISIT_CD_MS` | 1h | Per-(patron,club) cooldown — bounds the taxed transfer rail (an alt→alt cash pipe is already 2%-taxed like bodyguard). | KEEP |
| `SPEAKEASY.BOTTLES` | 3 / 8 / 20 $OMR | Bottle service — a PURE-STATUS deflationary $OMR burn (rides vanity:%), no owner cut. A recurring $OMR sink. | KEEP |
| `SPEAKEASY.NAME_OMR` | 8 | Name the club (a $OMR vanity burn). | KEEP |
| `SPEAKEASY.REGULAR_VISITS` | 10 | Visits to become a "regular" (status). | KEEP |

**Notes (sign-off):**
- The only NET cash faucet is the base bar take (capped 24h, the business pattern); rounds are
  player-funded taxed TRANSFERS (deflationary overall), not a faucet.
- A club **dies with the proprietor's street** (the business precedent) — a marked man's $750k+ is at
  stake; death frees the district for a new proprietor (no seizure/buyout in step one).
- The round transfer is the audited `bodyguard:hire` mechanism verbatim (1% street tax → buyback + 1%
  dev off-ledger + 98% net) — an untaxed unlimited P2P transfer is the cheapest value pipe in the game.
- Step two is the **revenue layer**: real-money (ETH) cosmetic decor + bottle service, and the club
  hosting the games with a rake to the owner — both gated on the Store/chain rail (mainnet, legal + audit).

## The Speakeasy — step two (the games + the risk)

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `SPEAKEASY.TABLE.RAKE_BPS` | 300 (3%) | The owner's cut of every table stake — carved FROM the bet (a transfer, not minted). Recurring owner income from social play. | KEEP |
| `SPEAKEASY.TABLE.WIN_P` | 0.48 | The wheel's win prob → ~4% house edge (the edge BURNS). Worse than the casino's 1.41% craps — a back-room game costs you for the ambiance. | KEEP |
| `SPEAKEASY.TABLE.MIN/MAX_BET` | $1k / $100k | Table limits. | KEEP |
| `SPEAKEASY.TABLE.NOTORIETY` | 8/play | Gambling draws the Prohibition boys (the raid tie). | KEEP |
| `SPEAKEASY.ROUND_NOTORIETY` | 2/round | A busy bar draws a little heat too. | KEEP |
| `SPEAKEASY.RAID_THRESHOLD` | 60 | Notoriety above which a raid can roll (decays at `NOTORIETY_DECAY_HR` 4/hr). | KEEP |
| `SPEAKEASY.RAID_P_PER_MIN` | 0.0025 | Per-minute raid prob over the above-threshold window (the BUSINESS_RAID_P_PER_MIN precedent; `SPEAKEASY_RAID_P` is a TEST-ONLY knob). | KEEP |
| `SPEAKEASY.RAID_FINE_RATE` | 0.15 | Fine = 15% of the value sunk (open + decor), clamped to pocket+bank. | KEEP |
| `SPEAKEASY.RAID_SHUT_MS` | 2h | The shutter — no rounds/table/income while dark. | KEEP |
| `SPEAKEASY.PATRON_NOTORIETY_CAP` | 24 | Anti-grief (step-two red-team HIGH-1): max notoriety one `(patron, club)` pair adds per rolling 24h (a token bucket). Deliberately < `RAID_THRESHOLD` so no single account can force a raid — a hot club needs distinct patron traffic. Legit play is uncapped; only the heat per account is bounded. | KEEP |
| `SPEAKEASY.SALE_MIN` / `SALE_MAX` (step 3) | $100k / $50M | The P2P buyout price bounds. A consensual sale (taxed transfer, the round pattern) — a district clears without a death. | KEEP |
| `SPEAKEASY.RENOWN.CASH_PER` / `OMR_WEIGHT` / `OWNER_WEIGHT` (step 3) | 10000 / 50 / 0.5 | Cross-club renown weights (pure DERIVED status — outside §10.4 + the sim balance, the hitman-rep argument). $1 spent = 1/10000 renown; 1 $OMR bottle-spend = 50; own-club prestige × 0.5. Bottle-$OMR weighted heaviest (the flex pays most). | KEEP |
| Store cosmetic decor SKUs (step 3) | `decor_deco` 0.02 / `decor_gilded` 0.04 / `decor_midnight` 0.06 ETH | Display-only club skins (account-level unlock, survives death). §10.4-neutral (Store entitlement + the `plex:%` PLEX burn). The ETH-revenue foothold; the NFT/royalty resale market is mainnet-gated (step five). | KEEP |
| `SPEAKEASY.STANDOVER.FEE` (step 4) | $250k | The hostile-takeover "cost of trying" — a `speakeasy:standover` cash SINK that BURNS win or lose (the npcHit-fee precedent). | KEEP |
| `SPEAKEASY.STANDOVER.BASE_P` / `STAT_SCALE` / `MIN_P`/`MAX_P` (step 4) | 0.35 / 400 / 0.05–0.75 | The standover win prob = clamp(BASE + (atk−def)/SCALE). atk/def = muscle+cunning/2 effStat (the shakedown contest). A strong owner defends well; clamped ≤75%. | KEEP |
| `SPEAKEASY.STANDOVER.CD_MS` / `HEAT` (step 4) | 24h / 15 | Per-club standover cooldown (win or lose) + heat on the challenger. Bounds spam. On a WIN the owner is PAID the ASSESSED build value (open + tiers climbed, `assessedValueOf`) — a forced SALE (taxed, the buyout §10.4), not theft; the challenger must carry the full price, so a Cathedral standover commits ~$19M (griefing economically bounded). | KEEP |
| `SPEAKEASY.RENOWN.STYLE_UNLOCKS` (step 4) | `house` 800 / `crown` 2000 | Renown-EARNED decor styles (access/status, never power) — a cosmetic unlocked by being seen, no purchase. §10.4-untouched (display-only). | KEEP |
| `assessedValueOf` — standover forced-sale price (step 4, **sign-off flag F2**) | build cost (open + tiers) | A hostile standover forces a sale at BUILD cost, below a high-income/prestige club's going-concern value (the "hostile discount"). Bounded by the ≤75% stat-gated roll + one-per-man + 24h cooldown + the challenger carrying the full price. **Founder call:** add a goodwill/prestige premium to the assessed value if whale-club predation is seen in the alpha. NOT patched (ground rule #1). | FLAG |

**The Fight Circuit (`BOXING`, mob boxing — a PvP staking loop, the `casino:pvp` transfer pattern):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `BOXING.MANAGER_MIN_LEVEL` / `RECRUIT_COST` | 8 / $50k | Sign a contender at level 8+ for a $50k cash SINK (`boxing:recruit`). | KEEP |
| `BOXING.STAT_MIN`/`STAT_MAX` / `STAT_CAP` | 6–14 / 25 | Stats rolled at signing; trainable to 25 (max form 75). | KEEP |
| `BOXING.TRAIN_COST` / `TRAIN_ENERGY` / `TRAIN_GAIN` | $20k / 15 / +1 | A training session (cash+energy SINK `boxing:train`) adds +1 to one stat. Progression = build a better fighter over time. | KEEP |
| `BOXING.MIN_STAKE`/`MAX_STAKE` / `RAKE_BPS` | $5k–$500k / 5% | Bout purse bounds + the vig (half → the buyback pool, half burns — the `casino:pvp` rate). A pure taxed TRANSFER, never a new faucet. | KEEP |
| `BOXING.VARIANCE` / `INJURY_MS` | 22 / 4h | rng added to each fighter's form (upsets happen, form still tells); a lost bout lays the fighter up 4h (no spam). | KEEP |
| `BOXING.RANKS` | Prospect → Hall of Famer (by wins) | Pure STATUS ladder — the circuit leaderboard, outside §10.4 + the sim balance. | KEEP |

**Fight Circuit red-team (independent) — CLEAN (no CRITICAL/HIGH).** §10.4 rake accounting byte-identical to the audited `casino:pvp`; persist-clobber, lock order, the dynamic-column train UPDATE (allowlist-gated, injection-safe), input validation, reroll termination, and death/estate all verified sound. **MED-1 FIXED** (regression added): `fightBout` now gates a jailed/hospitalized OPPONENT (the `casino:pvp` counterparty-gate precedent) — no draining an incapacitated lister who can't call it off. Two LOW balance items flagged for founder sign-off (NOT patched, ground rule #1): **(L1)** info-asymmetric consent — fighter form/record is public and the challenger self-selects, so listing at a real stake is −EV against a stronger challenger (self-correcting: list only a strong fighter; the incentive is to BUILD a strong one, not list a weak one — but a bout-attractiveness lever is the dial if listing dies out); **(L2)** no energy/nerve cost on the bout initiator (unlike `casino:pvp`'s `DICE_NERVE`), so a strong-fighter manager's only throughput gate is the opponent's 4h injury clock — add an initiator resource cost if leaderboard-farming is seen. Both are status-axis/redistribution concerns (rank is powerless; alt-collusion is −EV via the 5% rake, the signed `casino:pvp` posture), not §10.4 leaks.

**The Fight Circuit — STEP TWO (`BOXING` step-two additions — the stable, NPC exhibitions, the belt, the manager legend):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `BOXING.STABLE_MAX` | 3 | A manager can run up to 3 fighters at once (the stable). Bounds parallel exhibition throughput per account. | Sign-off |
| `BOXING.EXHIBITION_CD_MS` | 6h | Per-fighter cooldown on NPC exhibition bouts — the throughput gate on the new PvE purse faucet (with the fee + needing the form to win). | Sign-off |
| `BOXING.NPC_TIERS` (`fee` / `purse` / `form`) | clubfighter 26/$3k→$9k · journeyman 42/$10k→$26k · gatekeeper 62/$30k→$78k | **NEW cash FAUCET `boxing:purse`** — the fee (`boxing:fee`) is a cash SINK win or lose; the purse pays only on a WIN, so net-positive requires beating the NPC's form (your fighter's power+chin+speed+rand(VARIANCE) vs the tier `form`). Bounded by the fee, the 6h cooldown, and needing genuine form — a solo manager can build a record + earn, but a losing fighter bleeds fees. **Requires sim + founder sign-off before production** (the world-raid faucet precedent). | Sign-off |
| `BOXING.LEGEND_RANKS` | Unknown → The Don of the Ring (by lifetime stable wins) | The MANAGER's career legend (`account_persistent.boxing_wins`), SURVIVES DEATH (the hitman-rep precedent). Pure STATUS — outside §10.4 + the sim balance. | Sign-off |
| Title belt (`boxing_title` singleton) | one per server, claimed by beating the champ (or a vacant belt) | Pure STATUS — the winner takes the belt on a PvP win if it's vacant or held by the loser; vacated on the champion's death. No §10.4 surface. | Sign-off |

*Step-two note:* the exhibition purse is the ONLY new faucet in the boxing pillar — it needs a sim pass to confirm the fee/purse/form spread keeps a losing fighter net-negative and a beatable-NPC net small (the intent: PvE is a slow record-builder, PvP the real money via the taxed transfer). Everything else (stable, belt, legend) is status/access — §10.4-neutral. `boxing:purse`/`boxing:fee` ride the existing `boxing:` cash vocabulary (zero `invariants.js` change), so the per-character cash check reconciles them exactly (proven in `test/boxing.js`).

**The Fight Circuit — STEP THREE (`BOXING` step-three additions — THE MAIN EVENT, spectator parimutuel betting):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `BOXING.MAIN_EVENT_MS` | 30 min | The betting window between announcing a card and the worker resolving it. Long enough for a crowd to gather; `MAIN_EVENT_MS` env override is TEST-ONLY. | Sign-off |
| `BOXING.BET_MIN` / `BET_MAX` | $500 / $250k | A single spectator bet's bounds (CASH only — never $OMR). | Sign-off |
| `BOXING.BET_RAKE_BPS` | 800 (8%) | The house vig, taken from the LOSING pot: half → the winning manager's promoter purse (`boxing:purse:main`), half → the house (`boxing:bet:take`: half street-tax buyback, half burns). A pure taxed **redistribution** — **NO new faucet** (unlike the step-two exhibition purse); winners split the losers net of vig, so the bettors' EV is the parimutuel minus an 8% edge on the losing side. | Sign-off |

*Step-three note:* THE MAIN EVENT is a CASH parimutuel with an escrow (the bounty/market/loan/auction-escrow twin, on the cash side) — a manager books a scheduled card (their fighter vs a listed opponent, **no principal cash wager** — they fight for the belt/legend/record), spectators bet CASH on a fighter, and the worker resolves at the bell paying winners a pro-rata cut of the losing pot net of vig. Every peso is a TRANSFER (bettors → winning bettors + the winning manager's promoter cut + the house vig); **nothing is minted**, so it adds **zero new faucet** and rides the existing `boxing:` cash vocabulary (zero `invariants.js` reason change) behind a NEW **boxing bet escrow** §10.4 check (`escrow == posted − wins − refunds − purse − take − death`; sim drift-0). The one thing to watch in the sim/alpha: a manager with a strong fighter + a crowd earns the promoter purse (a redistribution from losing bettors, bounded by `BET_RAKE_BPS/2` of the losing pot) — not a leak, but a wealth-scaled edge for popular managers; `BET_RAKE_BPS` is the dial.

**The Fight Circuit — STEP FOUR (THE CORNERMAN + BELT DEFENSE — status/pacing only, ZERO §10.4 surface):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `UNDERWORLD.FX.CORNER_TRAIN_MULT` | 0.9 | Mickey the Corner (a 6th Underworld fixture) T1: training sessions cost ×0.9 cash (the DOC_MULT/GUN_MULT precedent — a cash discount, the discounted number ledgered `boxing:train`). | Sign-off |
| `UNDERWORLD.FX.CORNER_CD_MULT` | 0.8 | Cornerman T2: exhibition cooldown ×0.8 — his cutman rests your fighters faster (pure pacing). | Sign-off |
| `UNDERWORLD.FX.CORNER_GAIN` | +1 | Cornerman T3: training builds +2 a session instead of +1. The `STAT_CAP` ceiling is unchanged, so it's PACING (reach a maxed fighter in fewer sessions), not power creep. | Sign-off |
| `BOXING.DEFENSE_MS` | 7 days | The mandatory-defense clock: a champ who doesn't win a bout within this window is STRIPPED (the belt goes vacant). Pure status — makes holding the belt an active commitment. | Sign-off |
| `BOXING.CALLOUT_MS` | 48 h | (step five) The champ's window to ACCEPT a #1-contender callout before the belt forfeits straight to the challenger. A targeted, faster clock than `DEFENSE_MS` (you can't duck the top contender by fighting nobodies). Pure status, no §10.4. | Sign-off |

*Step-four note:* both pieces are **status/pacing with ZERO new §10.4 surface**. The Cornerman is the boxing tie-in for the Underworld cast — standing earned actor-side at the boxing touchpoints, perks that are all actor-local discounts/pacing (no fight-outcome tampering — a trainer builds a better fighter, he doesn't fix the fight), the training discount riding the existing `boxing:train` sink. Belt defense adds a reign counter + a mandatory-defense clock (an inactive champ forfeits) — pure status on the `boxing_title` singleton. Nothing to watch on §10.4; the only balance question is the T3 build-pacing (a maxed fighter reached in half the sessions is a modest competitive edge in PvP + the main event, bounded by the unchanged `STAT_CAP` ceiling) and the 7-day defense window (too short strips casual champs; too long makes the belt static) — both sign-off dials.

**Territory rackets — STEP THREE (`TERRITORY_TYPES` + the Bureau crackdown):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `TERRITORY_TYPES[].incomeMult` | numbers 1.0 / protection 1.15 / smuggling 1.35 | The operation's BUSINESS tilts income. **numbers ×1.0 preserves the sim-signed tier curve** (the safe default); protection/smuggling earn more BUT draw the Bureau. §10.4-safe (still a ledgered `territory:income` faucet) but a real balance change — **sim the NET EV per type** (income mult vs the raid seize + fine) before production; higher-income types must NOT be a strict upgrade. | **Sign-off (measure)** |
| `TERRITORY_TYPES[].scrutinyPerHr` | 0 / 6 / 14 | Net of `TERRITORY_SCRUTINY_DECAY_HR` (4): numbers never heats up (0<4), protection climbs +2/hr (raid-eligible ~30h), smuggling +10/hr (~6h). The risk that pays for the income tilt. | Sign-off |
| `TERRITORY_RAID_THRESHOLD` / `_P_PER_MIN` / `_FINE_RATE` | 60 / 0.0015 / 0.10 | The crackdown: past the threshold, roll `1−(1−p)^min-above`; a raid SEIZES pending (not minted) + fines the treasury 10% of build cost (`territory:raid`, a §10.4 treasury sink). The business-raid pattern at the gang level. `TERRITORY_RAID_P` is TEST-ONLY. | Sign-off |

*Step-three note:* the tier ladder was RENAMED to scale labels (Corner→The Syndicate) with **incomes UNCHANGED** — the old racket names (Numbers/Protection/Smuggling) moved to the new TYPE axis where they belong. The only §10.4 surface is `territory:raid` (a treasury sink → helps extraction-vs-inflow, like every Law/Bureau drain); the income mult is the one balance item to measure — a smuggling ring should be higher-VARIANCE, not higher-EV, than numbers once the raids are priced in.

**The Living World — STEP TWO (`WORLD` — content expansion for the NPC rival families):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `WORLD_NPCS` roster | 5 (was 3) | Two new on-curve outfits: a lvl-4 `dockrats` starter + a lvl-55 `volkov` apex (each ~2-3× the prior tier). The car-catalog precedent — content, not a rebalance. The new fixtures ride the SAME bounded-faucet math (`GRAB_BPS`/`GRAB_MAX`/regen), so total emission stays metered. | Sign-off |
| `WORLD.WAR_RANKS` | Civilian → The Scourge | The War Effort ladder off `account_persistent.cartel_damage` (lifetime NPC loot, survives death). PURE STATUS (the hitman-rep precedent) — outside §10.4 + the sim balance. | Sign-off |
| `WORLD.ENRAGE_MS` / `ENRAGE_DEF` | 3h / +60 | A routed cartel goes to high alert: it defends +60 for 3h → LOWER raid odds. **EMISSION-SAFE by construction** (harder raids = less throughput), so it can only HELP §10.4, never widen it. Stops the shared reservoir being farmed to the floor over and over. | Sign-off |

*Step-two note:* the War Effort is **pure status** (`cartel_damage` isn't a currency; the loot still rides the existing `world:raid` faucet — the test asserts `warEffort.damage == the account's world:raid cash`, so §10.4 is untouched). Enrage is a **defense modifier that reduces emission** — the one thing to confirm in the sim is that a 3h/+60 alert meaningfully slows repeat-routing of the low-tier outfits without making the apex (`volkov`, def 220 + 60 = 280) un-raidable for a solo raider (the odds floor at 0.1 catches that).

**The Living World — STEP THREE (co-op crew raids + THE FRONTIER):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `WORLD_NPCS[].coop` | kryl/moreau/volkov | The apex outfits accept a co-op crew (too well-defended to solo reliably). Solo raids still work on any outfit; co-op is the alternative that cracks a heavy def. | Sign-off |
| `WORLD.COOP_MIN`/`COOP_MAX_CREW` | 2 / 4 | A raid crew is 2–4 made raiders — the crew-heist band. | Sign-off |
| `WORLD.COOP_SCALE`/`COOP_MAX_P` | 600 / 0.85 | Combined firepower (SUM of raider power) over the outfit def; clamped so even a full crew is never certain. Higher scale than solo's 400 (many guns). | Sign-off |
| `WORLD.COOP_LEADER_WEIGHT` | 1.2× | The leader who fronts the op takes a bigger cut (the heist precedent). | Sign-off |
| THE FRONTIER | pure status | Whoever routs an outfit (solo OR co-op) plants their family's flag (`held_by_gang`); the next rout topples it. A conquest leaderboard, zero §10.4 — the Empire/Commission dominance precedent. | Sign-off |

*Step-three AUDIT flag (B1, session red-team `AUDIT-session-drops.md`):* the `raidChance` **0.1 min-clamp**
lets a min-level whale SOLO an apex outfit (Volkov def 220) at 10%/attempt for the full un-split `GRAB_MAX`
every 2h — undercutting the "too well-defended to solo" framing that motivates co-op. §10.4-bounded by the
shared reservoir/regen (not a leak), but the dial is the min-clamp or a **coop-only gate on `raidNpc` for
`fixture.coop` outfits**. Bundle with the apex-reservoir sim below.

*Step-three EMISSION FLAG (the one real §10.4 consideration):* co-op is **§10.4-neutral vs a solo raid** by construction — the pot is the SAME bounded reservoir slice (`GRAB_BPS`/`GRAB_MAX`), just SPLIT among the crew, and every share/ammo row rides the existing `world:raid` vocabulary (the sim stays drift-0). BUT co-op makes the **apex reservoirs actually tappable** — a soloist essentially can't beat moreau (def 150) / volkov (def 220), so those 5M/12M reservoirs were near-locked; a crew unlocks them as a REALIZED faucet. Total emission is still bounded by REGEN (you can't extract past the reservoir + its `regenPerHr`), but previously-dormant reservoirs now flow, so **sim + founder sign-off the apex `regenPerHr`/`GRAB_MAX` at co-op cadence before production** — this is the only new emission surface in the pillar. The frontier itself adds zero emission (pure status). Still deferred: NPC outfits holding real player-map DISTRICTS (the invasive turf-model rewire) + per-district racket-type choice.

**The Wire — STEP TWO (`WIRE` — content expansion for the intelligence terminal):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `WIRE.TRACE_OMR` | 15 $OMR | THE BUG TRACE — NAMES who's on your line (counter-intel; the sweep's offensive twin). Priced above the sweep (5) since it delivers actionable intel, not just a clear. A $OMR sink (`intel:trace`), free when clean. | Sign-off |
| `WIRE.DOSSIER_OMR` | 20 $OMR | THE DOSSIER — a one-shot deep read (kill record / flags / family role / who they tap). The premium intel sink (`intel:dossier`). Keeps wealth BANDED (never exact — the audit anti-kill-EV rule). | Sign-off |
| `WIRE.SPY_RANKS` | Eavesdropper → The Oracle | The Spymaster ladder off `account_persistent.intel_ops` (lifetime intel actions, survives death). PURE STATUS (the hitman-rep precedent) — outside §10.4 + the sim balance. | Sign-off |

*Step-two note:* all three are **$OMR sinks through the EXISTING `intel:` vocabulary** (zero `invariants.js` change) or **pure status** (`intel_ops`), so §10.4 is untouched — every wire spend reconciles as an `intel:*` burn. These are deflationary $OMR sinks that add depth to the terminal (counter-intel, a deep read, a progression axis) without touching any signed economic surface. Nothing to watch on §10.4; the only balance question is the trace/dossier pricing relative to the tap (8) — priced to make the terminal a meaningful recurring $OMR drain for information-hungry players.

**Territory rackets — STEP TWO (`TERRITORY_RACKETS` ladder + THE EMPIRE):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `TERRITORY_RACKETS` ladder | 5 tiers (was 3) | Two new operations — `Vice Empire` (t4, $4M → 200k/hr, ~112% marginal ROI/day) + `The Syndicate` (t5, $15M → 600k/hr, ~87%) on the continuing taper. Content, not a rebalance (`upgradeRacket` already handles any tier). The endgame operations a dominant family climbs to. | Sign-off |
| `TERRITORY_RANKS` | Corner Crew → The Cosa Nostra | The Empire ladder off `gangs.territory_earned` (lifetime territory income). PURE STATUS (gang-level, dies with the family) — outside §10.4 + the sim balance. | Sign-off |

*Step-two note:* the ladder extension continues the SIGNED ROI taper (marginal ROI keeps declining — 192%→…→87%/day — so higher tiers are a bigger commitment for a smaller marginal return, never a runaway). THE EMPIRE is **pure status** (`territory_earned` isn't a currency; the income still rides `territory:income`, so the gang-treasuries §10.4 check stays drift-0 — the test asserts `empire.earned == the family's lifetime collect`). Nothing to watch on §10.4; the t4/t5 income curves are the sim sign-off item (confirm the endgame operations don't over-supply cash to a turf-dominant family beyond what the 24h income cap + the 20% upkeep pad already bound). Deferred: per-district racket-TYPE choice + a Bureau-crackdown risk layer (the business-raid pattern at the gang level).

**The Reserve Bond (`BONDS`, Protocol-Owned Liquidity — off-chain core, chain DORMANT / mainnet-gated):**

| Lever | Default | Rationale | Rec |
|---|---|---|---|
| `BONDS.DISCOUNT_BPS` / `MAX_DISCOUNT_BPS` | 8% / 20% cap | The bonder's incentive (cheaper OMR). The protocol accepts paying an OMR premium to acquire ETH/LP (the cost of POL); bounded by the tranche. MAX is a rogue-discount backstop (invariant-checked). | KEEP |
| `BONDS.VEST_HOURS` | 120h (5d) | Linear vesting — stops an instant dump (the Olympus default). | KEEP |
| `BONDS.POL_BPS` / `VIG_BPS` | 60% / 40% | The bonded-ETH split: 60% → Protocol-Owned Liquidity (deepens the OMR-ETH pool), 40% → the Vig buyback (reserve + prizes). Must sum to 10000 (load-validated). | KEEP |
| `bond_reserve.capacity_omr` (the tranche) | set via `mod/bond/fund` | **The anti-Ponzi cap:** total OMR ever bonded out ≤ the treasury's budgeted allocation. `committed ≤ capacity` enforced at bond time; over it → `over_capacity` until the treasury tops up. This is the discipline that separates this from OlympusDAO's reflexive mint. | KEEP |

**Notes (sign-off):** A bond is a REAL-VALUE / OUT-OF-BAND primitive — it writes ZERO in-game `transactions`
rows, so §10.4 (the in-game sweep) is untouched by construction; it carries its OWN invariant
(`runBondInvariants`) on the real-value side (the `runVigInvariants` twin). The payout is a SALE of budgeted
treasury OMR, NEVER a mint (OMR is fixed-supply on-chain). The on-chain `OmertaBond` contract + `Bonded`
watcher + POL-pairing bot are MAINNET-GATED on legal counsel + a third-party audit (the R2/R3/withdrawal-rail
wall), and there is **no APY / price-appreciation marketing** until counsel signs off.

**Notes (sign-off):**
- The table's RAKE is carved from the stake (never minted on top — the econ-pass casino anti-precedent);
  the win is a gambling faucet, the edge a net sink. All rows character_id'd → §10.4 check (a) reconciles.
- Table collusion (patron alt → owner alt) is −EV: the alt loses the ~7% edge+rake to funnel 3%. No pipe.
- The raid makes the passive income EARNED: the more you monetize (table + patrons), the hotter the club,
  the bigger the raid risk. Self-inflicted notoriety from your own money-making — a real risk/reward dial.
- Step three is the ETH cosmetic-decor revenue layer (mainnet-gated) + a P2P buyout + a renown axis.

## Daily social tasks — "Spread the Word" (organic-growth faucet; founder-directed 2026-07-20)
A recurring petty-cash faucet to grow organic word-of-mouth + referral volume. NUMBERS ARE SIGN-OFF LEVERS.
- `SOCIAL_TASKS.CASH` **$300**/task, `ALL_BONUS` **$500** (all three in a day). 3 tasks → **max $1,400/day**.
- Petty by design: a rounding error for a whale (self-targets newer/engaged players), yet a real nudge for
  a low-level street. CASH ONLY (v24 rule) → farmed cash must clear heat + the $2.6M/day wash cap to become
  extractable $OMR, so the faucet's real value is bounded. Once per (account, day); agent-flagged excluded;
  gated behind `SOCIAL_VERIFY_MODE!=='off'` (alpha `trust`, so it's live with the First-Week socials).
- Anti-abuse posture (flagged): "post a tweet" is inherently unverifiable, so this is a TRUST faucet with a
  proof URL logged via `track('social_task')` for spot-checks. Sybil rings can farm $1,400/day/alt — but
  each alt is a full account (invite-gated alpha), the cash is petty + laundering-bounded, and agents are
  excluded. If abuse shows in the alpha, the dial is: lower `CASH`, require `SOCIAL_VERIFY_MODE=live` with a
  real per-post check, or add a level floor. The share URLs carry the player's name as their referral code,
  so the intended payoff is the EXISTING referral system (real cash + $OMR on a qualified recruit).
- `SOCIAL_GAME_URL` / `SOCIAL_X_HANDLE` are deploy-time (the share intents); default placeholders.

## Referral-funnel expansion — the "spark" early payout + share-a-win (founder-directed 2026-07-20)
Grows the organic/referral loop with a STEPPED payout, a share-a-win brag prompt, and K-factor measurement.
NUMBERS ARE SIGN-OFF LEVERS.
- **The spark** (`M4.REF_SPARK`): a recruiter earns an EARLY partial reward the moment their recruit reaches
  `level` **3** + `jobs` **10** (real playtime, well before the full §7.13 qualify gate at L8/40 jobs/3
  check-ins/$25k). Pays `recruiterCash` **$2,500** / `recruitCash` **$1,500** — CASH ONLY (v24 rule),
  ledgered `referral:spark` (rides the existing `referral:` cash vocabulary, no invariant change).
  Fires ONCE ever per recruit (`account_persistent.ref_spark` flag), agent-excluded, in the same sorted
  two-party lock as `maybeQualifyReferral` (post-commit non-fatal in both game.js hooks). The full qualify
  payout ($10k+3$OMR / $5k+1$OMR + milestones) is UNCHANGED and still fires at the full gate — the spark is
  ADDITIVE, a faster taste that rewards the recruiter for a recruit who's genuinely playing, shortening the
  feedback loop that drives re-sharing. A recruit who blows past both gates in one action collects both.
- **Share-a-win** (client `bragText`/`showBrag`): a WIN (a kill, a survived break, a big-score RWA cut, a
  won bout/purse, a completed First Week) surfaces a one-tap X share intent carrying the player's name as
  their referral code — turning the game's own dopamine beats into recruit funnels. Pure client UI, no
  mechanic, no §10.4 surface; the brag trigger set is a founder content lever.
- **Funnel + K-factor** (`funnelStats.referral` → `GET /v1/mod/funnel`, admin dashboard): accounts, referred,
  sparked, qualified, recruiters, totalRecruits, reReferred, **kFactor** (totalRecruits/accounts), and
  sparkToQualified — so the alpha's viral coefficient + spark→qualify conversion are watchable without a dev.
- Anti-abuse: the spark still requires REAL play (L3 + 10 jobs — not a create-time trigger), cash-only
  (launder-bounded), agent-excluded, once-ever — the same Sybil posture as the full referral. If ring-farmed
  in the alpha, the dial is the spark gate/amount; the full-qualify gate is the harder backstop.

## Referral drive + tier-2 "family tree" (founder green-lit 2026-07-20; numbers are sign-off levers)
Two additions on the §7.13 loop. Both CASH ONLY (v24 rule), agent-excluded, Sybil-bounded by real
qualified recruits (each needs L8/40 jobs/3 check-ins/$25k of real playtime).
- **The recruitment DRIVE ("the push")** — a mod-started, time-boxed window (`REF_PUSH_MAX_HOURS` 336 /
  `REF_PUSH_MAX_MULT` 5 caps) that MULTIPLIES every referral CASH payout (spark + full recruiter/recruit +
  milestone). $OMR is untouched (fund-bounded — the drive never widens the $OMR faucet). The multiplied
  cash is ordinary ledgered `referral:*` — §10.4-exact (credited == ledgered). Faucet magnitude during a
  drive is a founder lever; it's bounded by real qualified recruits, so a 2× drive is a temporary +100% on
  a loop that already requires genuine playtime per payout. Recommended alpha use: short 2× windows to
  seed word-of-mouth, watch `kFactor` on the funnel.
- **Tier-2 "the family tree"** — `REF_TIER2_CASH` **$5,000**, a FLAT one-time finder's fee to the
  grandrecruiter (A) when their recruit's recruit (R2) fully qualifies. Deliberately NOT a percentage and
  NOT ongoing (the anti-MLM line — recorded in the Sensitive design notes); DEPTH 2 only; agents excluded
  at every level (A, R, R2); once ever per R2 (`ref_l2_paid` atomic claim). Ledgered `referral:tier2`
  (rides the `referral:` cash vocabulary). At $5k it's half the direct recruiter payout ($10k) — a modest
  incentive to grow the tree one level, not a living. LEVER: raise/lower `REF_TIER2_CASH`, or set 0 to
  disable the second level entirely if the alpha shows ring-farming (the full-qualify gate is the backstop).

## Faucet measurement pass — sim P9.8–P9.10 (this-session drops, measured 2026-07-21)

The three faucets shipped this session (co-op apex raids, the boxing exhibition purse, territory
racket-type income mults) were all flagged "sim + sign-off." `tools/sim.js` now measures each
(analytic, from the signed constants — the den/kill-EV precedent; §10.4 stays drift-0). The numbers:

**P9.8 — World apex raid emission (co-op step three).** Emission is REGEN-bounded (a reservoir can't
emit faster than it regenerates), so co-op is ACCESS not a ceiling raise:
- Kryl ≤ $960k/day · Moreau ≤ $2.16M/day · Volkov ≤ $4.32M/day — **base-WIDE** ceilings (the whole
  server competes for one reservoir), so per-capita is far lower.
- **B1 (the flagged solo-floor):** one min-level whale at the 0.1 odds floor extracts ≈ $90k (Kryl) /
  $300k (Moreau, Volkov) per day solo. The dial is the `raidChance` min-clamp or a coop-only gate on
  `raidNpc` for `fixture.coop`. **REC: KEEP** for alpha (regen-bounded, competitive), revisit the
  solo-floor if a few whales farm the apex reservoirs dry.

**P9.9 — Boxing exhibition purse (the one new PvE faucet).** EV = −fee + P(win)×purse (exact form model):
- Fresh signee (form 30): **+$2,982/bout** best (Club Fighter @66%) → +$11.9k/day/fighter, +$35.8k/day/3-stable.
- Maxed fighter (form 75): **+$41,237/bout** best (Gatekeeper @91%) → +$164.9k/day/fighter,
  **+$494.8k/day for a maxed 3-stable**.
- **FINDING:** the purse is +EV at every form and scales to a **large sustained faucet** when maxed
  (~half the top passive loop). It self-limits on the ~$1M training investment (payback ~6 days/fighter)
  but the steady state is a real faucet. **REC (founder call):** scale the fee toward the purse (a
  Gatekeeper fee ~$45k instead of $30k drops maxed EV to ~+$26k/bout) OR cap exhibitions/day, so a maxed
  stable isn't near-risk-free income. Flagged, NOT retuned (ground rule #1).

**P9.10 — Territory racket TYPE net income (mult vs the Bureau crackdown), at a tier-3 "District" op.**
The type income mult is meant to be offset by crackdown risk that scales with the type — the intended
shape is **higher-VARIANCE, not higher-EV**. Measured at the two collection cadences:
- **Numbers** ×1.0 → $1,440,000/day, cadence-proof (scrutiny 0 < decay 4, never raided). The safe baseline.
- **Smuggling** ×1.35 → $1,944,000/day gross; hot in 6h, so a LAZY (24h) collector is raided ~80% of days →
  nets only **~$280k/day** (worse than numbers), while an ACTIVE collector (≤6h) banks the full $1.94M.
  **Working as intended** — smuggling is a management/variance play, not free income. **REC: KEEP.**
- **Protection** ×1.15 → $1,656,000/day; hot in **30h**, so a **daily** collector NEVER crosses the
  threshold → **0% realized raid risk → a STRICT +15% upgrade over numbers** at the ordinary daily
  cadence. **FINDING: this violates the "higher-variance not higher-EV" intent** — protection is
  currently free income at daily cadence. **REC (founder call): raise `protection.scrutinyPerHr` 6 → ~10**
  (net +6/hr → hot in ~10h → a daily collector sits ~14h above → P(raid) ~72% → net ~$377k/day, a real
  variance play like smuggling). Flagged, NOT retuned (ground rule #1 — it's an unsigned this-session
  default and the founder may accept a mild safe premium; the sim data is here to decide from).

### RETUNES APPLIED (founder-directed 2026-07-21) — re-measured

Founder signed off on both flagged findings above; applied + re-measured (`tools/sim.js`, §10.4 drift-0):
- **Protection `scrutinyPerHr` 6 → 10.** Now hot in **10h** (was 30h), so a LAZY 24h collector faces
  **P(raid) 72% → net ~$376k/day** (was a strict +15% free upgrade at $1.656M/day). Now a real
  higher-VARIANCE play like smuggling — active collection (≤10h) still banks the full ×1.15. Intent met.
- **Exhibition fees: journeyman $10k→$15k, gatekeeper $30k→$45k** (clubfighter untouched — new-player
  entry stays cheap). Maxed-fighter best EV **+$41,237 → +$26,237/bout** (~$495k → **~$315k/day for a
  maxed 3-stable**); fresh-signee EV unchanged (+$2,982/bout at clubfighter). A meaningful loss now stings
  (9% chance of −$45k) so it's a genuine risk/reward, still a worthwhile endgame reward for a ~$1M stable.

Both are now the recommended defaults (still sim-signed, not yet production-signed). Also fixed a
PRE-EXISTING date-flaky test uncovered en route: `test/growth.js`'s kitchen Bureau-raid loop used a 30-min
accrual window that, on a `heatDecay=2` city-event day, decayed heat 100→40 (below the raid threshold)
before the roll — a 5-min window keeps heat ≥90 so the raid stays reachable on any day.

## Post-signing addendum — World step four: THE FRONTIER MADE REAL (a new emission surface, sign-off pending)

The status frontier (a held NPC outfit's flag) became real turf: a held outfit pays a bounded TRIBUTE to
the overlord family's treasury, and a rival family INVADES a held outpost by outbidding its garrison. All
numbers are founder SIM sign-off levers — the tribute is a **NEW cash faucet**, so measure it before
production (ground rule #1):

- `WORLD.FRONTIER.TRIBUTE_BPS` 200 (2% of the outfit's `regenPerHr`) / `TRIBUTE_CAP_MS` 24h. Per-outfit
  tribute/day: dockrats $2,400 · zappa $5,760 · kryl $19,200 · moreau $43,200 · volkov $86,400. **Base-wide
  max ≈ $157k/day** across ALL five outfits (one holder each) — tiny vs the raid reservoirs' millions/day
  ceilings, and it requires ROUTING the outfit to hold it (apex outfits need a co-op crew), so it's a small,
  well-defended, regen-metered faucet. §10.4-clean: `world:tribute` is a ledgered treasury faucet in the
  gang-treasuries check. **Sim rec:** add a frontier-tribute probe (hold each outfit, collect over a day) to
  confirm the analytic $157k/day base-wide ceiling; keep unless it dwarfs a family's other treasury inflows.
- `ROUT_GARRISON` $25k (installed on rout — the defense a rival outbids), `INVADE_BASE` $50k /
  `INVADE_OUTBID` 1.5× (the treasury cost to take a held outpost — a `world:invade` sink, the seizeDistrict
  twin). Pure treasury→burn sink (helps extraction-≤-inflow), so no emission concern — the levers just set
  how contested the frontier is. **KEEP** unless invasion feels too cheap/expensive vs the tribute it wins.

Design intent: the frontier is now income + contestable (rout to claim → collect tribute → defend vs
invasion) rather than a leaderboard flag, WITHOUT touching the signed 6-district turf-perk map. Deferred:
literal NPC occupation of the core districts (the fullest turf rewire).

## Addendum — World step six: THE UPRISING (a treasury SINK + a status/pacing threat — NO new faucet)

The world's first PROACTIVE threat: a seed-drawn, forecast-able day (`WORLD.UPRISING.CHANCE` 28%) on which
one outfit RISES UP — heightened raid defense (`DEF` 50, the ENRAGE precedent) + suspended tribute while
rising, and at the reckoning it BREAKS FREE of a HELD-but-undefended outpost (garrison < `outfit.max ×
THRESHOLD_BPS/10000 (3%) × live strength fraction`), reclaiming its turf (§10.4-NEUTRAL — the
`releaseFrontierHolds`/seizure ownership move; uncollected tribute forfeits). The defense is
`reinforceOutpost` (`world:reinforce`, `REINFORCE_MIN` $10k floor) — a treasury cash **SINK** (helps
extraction-≤-inflow) that also stiffens the outpost vs a rival's `invadeOutpost` (dual-purpose). **No new
emission surface** — the tribute faucet is UNCHANGED (a suspension only DEFERS it, still 24h-capped) and
the reclaim/reinforce move no faucet value; `world:reinforce` joined the gang-treasuries §10.4 OUT terms
(sim drift-0). Levers `UPRISING.CHANCE`/`DEF`/`THRESHOLD_BPS`/`REINFORCE_MIN` set how often/how punishing
the world pushes back and how much garrison holds the line — **KEEP** unless the reckoning feels too
frequent (lower CHANCE) or the garrison too cheap/expensive to hold (tune THRESHOLD_BPS vs REINFORCE_MIN).
The interlock (threshold scales with the outfit's LIVE strength) means the raid loop and the frontier
defend each other — a beaten-down outfit can't break free even undefended. Founder sign-off levers (pacing
+ a sink; no signed faucet touched).

### World step four — red-team flags (AUDIT-world-frontier.md; founder sign-off)

The three-lens red-team was §10.4/concurrency CLEAN and fixed one LOW (F1: `collectFrontier` now honors
the SIGNED D2 safehouse gate — collecting frontier tribute is an exposed act, like territory/business/
convoy collection). Two balance items flagged, NOT patched (ground rule #1):
- **B1 — invasion level gate — FIXED (founder-directed).** `invadeOutpost` now gates
  `levelOf(ch.respect) < fixture.minLvl` (you can only HOLD turf you could RAID) — closing the
  consistency gap where a rookie family with a fat treasury could seat itself on an apex outpost. A pure
  consistency fix mirroring the rout `minLvl` gate; `test/world.js` proves a lvl-10 boss can't invade
  kryl (lvl 20). The "economic conquest" alternative (money takes a bought outpost) was considered and
  declined for consistency.
- **B2 — the garrison ratchet has no decay/cooldown.** Each invasion sets `garrison = max($50k,
  prev×1.5)`, ratcheting 25k→50k→75k→112k→168k…, exponentially pricing out further invasions. Pure
  treasury SINK (helps extraction≤inflow) and ROUT-resettable (a rout reinstalls the flat $25k garrison),
  so never permanent for anyone who can rout the outfit — but a sub-apex family can be locked out of an
  apex outpost held by a rival. Dial: a garrison decay-over-time, an invade cooldown, or a cap on the
  ratchet. Founder call (feature = an escalating war chest vs annoyance = a stuck-high state).

## Post-signing addendum — World step five: THE OCCUPATION (a change to the signed turf ON-RAMP, sign-off)

The 5 apex outfits now literally garrison 5 of the 6 core districts (dockrats→docks, zappa→brick,
kryl→canal, moreau→foundry, volkov→neon; `cathedral` free). A family LIBERATES an occupied district via
`seizeDistrict`, and the cost scales with the occupying outfit's LIVE strength (`liberationCost` =
`outfit.max × OCCUPY_BPS/10000 × strengthFrac`, floored `OCCUPY_MIN`). §10.4-clean (the existing
`turf:seize:` sink; the sim stays drift-0). **This is a change to the signed turf on-ramp — founder SIM
sign-off before production (ground rule #1):**
- **The signed district PERK VALUES are UNTOUCHED** (docks +50% contraband, neon +15% income, etc.) —
  only WHO you take the district from changed (an NPC garrison, not a free grab). The perk is dormant while
  occupied (holder_gang NULL, exactly like an unowned district) and active the moment a family holds it.
- **The on-ramp:** 5/6 core districts start NPC-held. Liberation cost at FULL outfit strength scales with
  the outfit tier: docks $45k · brick $120k · canal $450k · foundry $1.5M · neon $3.6M. The weak-outfit
  districts (~$45k–$120k) are a soft on-ramp that teaches the World raid loop (rout the outfit → its
  district floors at $30k); `cathedral` stays a pure free ($30k `SEIZE_BASE`) grab. A fresh family can
  still get turf, but the cheap free-seize of a valuable district is gone — the prizes are conquests now.
- **The interlock** (the point of the capstone): beating an outfit down (routing its reservoir) drops its
  district's liberation cost in real time, so the World pillar and core turf are now one loop.
- Levers: `WORLD.OCCUPATION` (the mapping — occupy fewer districts to soften the on-ramp), `OCCUPY_BPS`
  3000 (the full-strength cost fraction), `OCCUPY_MIN` 30000 (the floor). Sim the net on-ramp EV + the
  time-to-first-turf for a new family before production.

### World step five — red-team flags (AUDIT-world-occupation.md; founder sign-off)

The three-lens red-team was §10.4/emission + concurrency CLEAN and fixed two MED consistency bugs
(E1 — the schema seed re-occupied a liberated-then-dissolved district; now guarded on `seized_at IS
NULL`; E2 — the liberation branch was missing the frontier-B1 outfit level gate; now
`levelOf(ch.respect) < fixture.minLvl` throws `level`). Balance items flagged, NOT patched (ground
rule #1):
- **The on-ramp shift (the headline):** 5/6 core districts now start NPC-held, so a fresh family's old
  cheap free-seize is a small liberation (weak outfits' districts docks ~$45k / brick ~$120k — a soft
  on-ramp teaching the World loop; cathedral stays free). Perk VALUES unchanged. Sim the net first-turf
  time before production.
- **Garrison ratchet (carried from frontier B2):** a liberated core district's garrison becomes the new
  player defense budget with no decay/cooldown on the player-vs-player reseize path. A pure sink,
  rout-resettable via the World loop, never permanent — garrison-decay or a reseize-cooldown is the dial.
- **Apex solo-raid floor (carried, World-wide):** the 0.1 min-clamp lets a min-level whale solo an apex
  outfit for the full grab, bounding how fast an apex outfit (hence its core district) is driven to the
  liberation floor — the clamp or a coop-only `raidNpc` gate for `fixture.coop` is the dial.

## SIGN-OFF SHIPPED — founder approved all recommendations (2026-07-21)

Jorge shipped the `SIGN-OFF.md` sheet. Applied + tested (suite 30/30, sim drift-0), all founder-signed:

- **World 1.3 — apex outfits are crew-only** (`raidNpc` refuses `fixture.coop`; board `canRaid && !f.coop`).
  Closes the apex solo-raid floor (B1) — a min-level whale can no longer solo kryl/moreau/volkov for the
  full grab. The crew path (`planRaid`) already gated the inverse (`solo`), so the symmetry is now closed.
- **Casino 2.5 — `CASINO.FIGHT_BET_MIN_LVL` (5)** on fight bets (the `WANTED_MIN_LVL`/npcHit rookie-floor
  precedent) — an anti-alt floor raising a fight-fix Sybil ring's cost per disposable bettor.
- **Pen T3 — `PEN.QUIET_WEIGHT` (0.45)** weights the `quiet` yard day up in `yardEventOf`, so hard-block
  days (lockdown/toss) fall below ~25% (was ~40%). Distributional regression added (`test/pen.js`).
- **Loans Tier 4 — the debt survives the lender.** `voidLoansAtDeath` now reassigns a dead lender's active
  loan (+ pledged collateral) to the **heir** instead of voiding it (§10.4-neutral — no money moves, the
  claim changes hands). `runEstate` hoists `heirId` above the loan-void to pass it. Closes the
  kill-your-lender-to-erase-the-debt moral hazard. Test updated: the collateral loan survives to the heir.
- **Referrals 2.7 (deploy-config, not code):** production **must** run `SOCIAL_VERIFY_MODE=live` so the
  Spread-the-Word cash faucet requires real social verification (alpha keeps `trust`).

Everything else on the sheet is SIGNED at the recommended verdict (SHIP) or on the alpha WATCH-list. The
Tier-6 chain/legal items remain a SEPARATE gate (legal counsel + `forge test` + third-party audit), not
signed by this pass.

### Speakeasy bar take — NET-EV measurement (sim P9.12, 2026-07-21)

The sign-off's one flagged big faucet, now measured net of its costs (analytic probe). Findings:
- **Bar take by tier (gross ≈ net, passive):** Backroom $192k/day (payback 3.9d) → Lounge $384k (3.5d) →
  Blue Room $816k (3.9d) → Copa $1.632M (4.7d) → **Cathedral $3.12M/day (payback ~6.0d, build-to-here $18.65M)**.
- **No raid tax on a passive owner:** notoriety (→ Bureau raids) accrues from the back-room TABLE (8/play) +
  busy ROUNDS (2 each) — PATRON-driven, not the owner's collect. A bar-take-only club draws ~0 notoriety →
  ~0 realized raid risk. (An owner who runs a busy table takes on the raid risk in exchange for the rake.)
- **No recurring upkeep:** unlike a business front (the 20% "pad"), the speakeasy has no upkeep drip.
- **Safehouse-gated collect (D2)** is the only friction on an otherwise passive, low-risk earner.

**Verdict:** §10.4-clean (a ledgered `speakeasy:income` faucet), but the **richest low-risk passive earner
in the game** — ~$3.12M/day at the top, ≈ a maxed territory op ×1.6–2, un-raided when run passively,
sub-week payback at every tier. **FOUNDER DIAL (not retuned — ground rule #1):** if it should be taxed like
other endgame fronts, add (a) a passive-owner notoriety/upkeep drip (the business-`pad` precedent) or (b)
trim the `SPEAKEASY.TIERS[].incomePerHr` curve. Flagged for sign-off with the numbers in hand.

### Speakeasy upkeep — the founder dial SHIPPED (2026-07-21)

Founder chose the upkeep drip (over trimming the income curve) to tax the passive bar take. Applied +
tested (suite 30/30, sim drift-0): **`SPEAKEASY.UPKEEP_BPS` (2000 = 20%)** comes off the top of every
`collectSpeakeasy` as a `speakeasy:upkeep` cash SINK (the business-'pad' 20% rate). §10.4-clean — both the
`speakeasy:income` faucet and the `speakeasy:upkeep` sink are character_id'd under the existing `speakeasy:`
cash prefix (zero invariant/vocabulary change; the per-character check reconciles). Effect: top-tier net
$3.12M → **$2.496M/day**, payback ~6.0d → ~7.5d; every tier keeps 80% of gross. The `incomePerHr` curve
remains the further dial if a leaner front is wanted. `test/speakeasy.js` asserts gross/upkeep/net + the
ledgered sink; sim P9.12 prints net-of-upkeep by tier.

## STREET RACES — a new content drop (2026-07-21; the car catalog as a competitive loop)

Turns the deep 60-car catalog into a competitive loop (PvE circuit + PvP wagers + tuning). Built on the
audited boxing/casino architecture; §10.4-clean (`race:` cash vocabulary; PvP is the casino:pvp taxed
transfer; fees/tunes are sinks). **The PvE purse is the ONLY new faucet — sim-measured (P9.13), sign-off:**
- PvE circuit tiers (fee BURNS win/lose; purse pays only on a win — a matched car is ~break-even, an
  over-powered car nets up to purse−fee, **+$18k/win = +60% of the fee at the top tier** — NOT a "thin
  edge"; corrected per the red-team): Back-Alley $2k→$3.2k · Midnight $8k→$13k · Ghost Circuit $30k→$48k.
  Cooldown **`CD_MS` 2h** (12/day).
- **Measured EV** (P9.13): a tuned contender (power 200) +$5k/race best → **+$60k/day**; a premium monster
  (power 450) +$18k/race best → **+$216k/day** — bounded, in boxing-exhibition parity (~$315k/day maxed).
  **NOTE:** the initial 30-min/48-per-day + fat-purse defaults measured a **$3.12M/day printer** and were
  retuned DOWN to the above before ship (a new number set, not a signed-lever change). A losing race also
  dings the car (a real repair cost), so a mismatched tier is −EV.
- PvP: `RAKE_BPS` 500 (5%), `WAGER_MIN/MAX` $500/$250k, `VARIANCE` 40 — a taxed transfer, no new faucet.
- Tuning: `TUNE_COST` $25k, `TUNE_MAX` 5 — a cash sink + car progression. `LOSS_DMG` 8.

All `RACES` numbers are founder sign-off levers (the exhibition-purse precedent). Sim the PvE purse net-EV
(vs the boxing exhibition) + the PvP wager economy before production. Suite 31/31 + sim drift-0.

### Step two — PINK SLIPS + NITROUS (2026-07-22; sim-measured)
- **PINK SLIPS** (race for the car): a §10.4-NEUTRAL ownership transfer (no cash, no ledger — car
  conservation by row count). **No new lever, no faucet.** A deliberate pink loss is a near-tax-free car
  gift — accepted (the market already allows that via a min-bid listing).
- **NITROUS** (`NOS_COST` **$8k** (was $15k) / `NOS_MAX` 3 / `NOS_POWER` +60): a per-car consumable cash
  SINK — the COMEBACK tool; burn one for a one-race power bump. **Measured (P9.13 addendum) + TUNED
  (founder-directed 2026-07-22):** NOS is a tool FOR AN UNDERDOG, not a favorite — the first flag ("never
  +EV, −$11.3k") was a probe artifact (it modeled a car that was already a mid-tier FAVORITE, whom NOS
  can't help). The corrected probe models an underdog (power = field − 20): NOS is strongly **+EV as a
  comeback** (flip a likely loss to a win on a mid/high-purse race) and correctly **−EV/wasted for a
  favorite** (ΔP≈0) and on the cheap races. Cutting `NOS_COST` $15k→$8k makes the Ghost-Circuit comeback
  genuinely rewarding (an underdog-with-NOS goes from +$600 absolute at $15k to **+$7.6k** at $8k) and
  viable on Midnight, while staying a sink for favorites/cheap races. Still a sink on average (gone
  win/lose) → no faucet, no farm; a monster car already tops the PvE purse ceiling without NOS. Sign-off.

### Step three — THE GRAND PRIX (2026-07-22; sim-measured, a redistribution NOT a faucet)
- A scheduled worker-resolved CASH parimutuel (the poker-tournament twin): N drivers escrow `GP.BUYIN`
  ($25k), the top 3 (`PAYOUTS` 60/30/10) split the pool net of `GP.RAKE_BPS` (5%, half → street tax / half
  BURNS). **Measured (P9.16): ZERO new emission** — the field funds the winners; the only §10.4 effect is a
  net cash SINK of the burned half-rake (~$1.9k on a 3-driver pool, ~$5k on an 8-driver pool). House edge is
  a flat 5% at any turnout (the renormalized-payout property); skill+gear decides (distinct from the poker
  tournament's chance); alt-stuffing is −rake/N per head (−EV). **The ideal for a competitive mechanic — a
  sink, no signed faucet touched.** `GP.*` are sign-off levers. Suite 31/31 + sim drift-0.

## CONVOY step three — NPC TRUCKING (2026-07-22; the ambush loop's PvE target)
The worker keeps `CONVOY.NPC.TARGET` (2) unmarked NPC trucks on the road; players hijack them via the
existing ambush. The hijacked GOODS (sold via the market) are the one new faucet. **Measured (P9.17):**
throughput = `TARGET × 86.4M/CONVOY.MS` = 96 trucks/day, avg manifest ~$4.5k (11 units × ~$410 base) →
**~$216k/day base-wide at 50% hijacked (realistic), ~$433k/day ceiling (100% hijacked).** At
boxing/territory parity (~$300-400k/day base-wide), the World-raid precedent — a bounded, SHARED PvE faucet
(any player can hijack, capped MAX_AMBUSHES=3/truck + the trunk cap; guards repel some). §10.4-invisible
(goods aren't a §10.4 currency; the sale is the existing market faucet). **Sign-off:** `TARGET` /
`NPC.MIN_QTY`-`MAX_QTY` are the dials if the base-wide magnitude wants trimming; the ceiling assumes 100%
hijack (unrealistic — guarded trucks repel). KEEP-at-parity recommendation.

## THE PORT — maritime smuggling (2026-07-21; offshore contraband import by boat)

The SEA counterpart to convoys. Boats are a buyable asset (like cars, `boats` table); runs source
contraband offshore and fence it home if the Coast Guard (PvE interdiction) doesn't catch you. ONE new
faucet — `port:sale` — bounded three ways (per-boat run clock, interdiction eating runs, a daily supply
cap). Measured in `tools/sim.js` P9.14 (analytic, zero value seeded, §10.4 untouched):

| Route | Margin | P(caught) | Net per $ sourced | Daily faucet (best boat, cap-maxed) |
|---|---|---|---|---|
| Coastal Hop (lvl6) | ×1.67 | 3% | 60% | ~$240,667/day |
| Open Water (lvl16) | ×1.83 | 3% | 76% | **~$303,486/day** (the best) |
| The Deep Run (lvl32) | ×2.11 | 30% | 33% | ~$131,111/day (high-variance) |

- **KEEP** — the best realized route (~$303k/day) sits at boxing-exhibition / territory parity
  (~$300-400k/day maxed). The gradient is deliberate: deeper routes pay a richer margin but heavier patrol,
  so the safe route earns steadily and the deep run is a gamble. Bounded by `SUPPLY_CAP_DAY` $400k/day.
- Boat catalog (Dinghy $40k → Cigarette Boat $12M), route curves (buy/sell/patrol/minSpeed),
  `INTERDICT_MIN/MAX` (.03/.85), `FINE_RATE` (50% of cargo on a bust), `SINK_P` (15% boat loss on a bust),
  `ESCORT_COST/DEF` ($15k/+25), `RESALE_BPS` (60%), `FLEET_MAX` (5) — all founder sign-off levers.
- The fine (`port:fine`) + boat loss are the downside that keeps the faucet honest; interdiction odds read
  `patrol ± cityHour patrolMod − boat speed − escort def`, so speed (a pricier boat) + an escort buy safety,
  and the day/night patrol window shifts the odds (the Living-World tie-in).

`port:sale` is the emission surface — sim the net EV per route before production (measured at parity).
Suite 32/32 + sim drift-0.

### Step two (2026-07-21) — naval upgrades + PIRACY + rendezvous (founder sign-off levers)
- **Naval upgrades** (`PORT.STEP2` hull/engine, capped 5): buy efficiency toward the DAILY `SUPPLY_CAP_DAY`,
  NOT a higher ceiling — a bigger hull hits the same $ cap in fewer/bigger runs, and a faster boat lowers
  interdiction so more runs land. Net: upgrades raise REALIZED emission toward the (unchanged) cap, not the
  cap itself. `port:upgrade` is a cash SINK (a $OMR-free money drain — helps, not hurts).
- **Piracy** (`interceptRun`, `port:piracy` cash faucet at `PIRATE_TAKE_BPS` 60%): a WIN redirects a rival
  run's would-be `port:sale` to the pirate at < 100% and VOIDS the run → **total port emission can only FALL
  vs a clean landing** (emission-safe by construction, like a convoy hijack but realized as cash since the
  Port has no goods intermediary). Bounded by the runner's supply cap + a PvP contest + the pirate's ammo
  cost. Sim the realized $/day for a dedicated pirate before production, but it cannot exceed what the
  runners it preys on would have landed.
- **Rendezvous**: §10.4-neutral (a run changes vessels; no currency moves). No emission impact.
- All `STEP2.*` numbers (HULL/ENGINE_STEP, UPGRADE_BASE/MAX, PIRATE_TAKE_BPS/ENERGY/AMMO/MIN_LEVEL) are
  founder sign-off levers.

### Step three (2026-07-21) — the Smuggler's Legend + the Harbormaster (sign-off levers)
- **The Smuggler's Legend** (`account_persistent.smuggled`): PURE STATUS (lifetime landed value → a rank +
  leaderboard, survives death) — zero §10.4, zero balance surface (the hitman-rep/wheel precedent).
- **The Harbormaster toll** (`PORT.STEP3.TOLL_BPS` 5%): a §10.4-clean TRANSFER (shipper → docks-holder
  treasury, the convoy-toll twin — no new emission, reconciled by `portTollIn`). Two balance effects, both
  sign-off levers: (1) it makes HOLDING the docks more valuable (a small treasury faucet on top of the
  district's perks — bounded by shippers' supply-capped landings, and the docks must first be liberated
  from the NPC occupation + defended); (2) it's a 5% haircut on Port runners who land at a rival-held docks
  (they can still run — the toll never gates the freight). Own-family + NPC-held + unheld = free. Reviewed
  §10.4-clean (AUDIT-port-step-three.md); `TOLL_BPS` is the dial if 5% bites too hard or too soft.

### Step four (2026-07-21) — the contraband market + berths (sign-off levers)
- **The fence** (`port:fence`, `fenceMultOf` drifts 0.85–1.25, mean ~1.05): warehousing a landing and
  fencing at a drifting daily rate is a HIGHER-VARIANCE faucet than the guaranteed auto-sell (route.sell).
  §10.4-safe (contraband is a non-currency resource sourced via the supply cap → the fence is bounded by
  sourcing; dying while holding it just forfeits the already-sunk `port:buy` cost — no owed faucet). But a
  savvy player who fences ONLY on high days realizes ABOVE the route rate, so the REALIZED emission for
  skilled play sits above auto-sell (a Risk-to-Earn skill reward, still supply-capped). **Sim the realized
  $/day for a market-timer before production** — the dial is `FENCE_LO`/`FENCE_SPAN` (drop the mean to 1.0
  for a pure gamble, or narrow the span). The death-loss risk + the exposure window offset it.
- **Berths** (`port:berth`, one-time $500k/slip, cap 3): a pure cash SINK — raises the fleet cap, no
  emission. Helps, not hurts.

## AUDIT-full-system-v2 economic flags (2026-07-21) — founder sign-off (NOT patched, ground rule #1)

The overnight full-system red-team found NO new unbounded $OMR extraction (the reserve queue holds —
in-game $OMR faucets are all extraction-capped). Two CONFIRMED IN-GAME-CASH Sybil-split findings defeat
a SIGNED balance lever; left for founder decision because a "fix" would retune/redesign a signed number
and the Sybil-of-a-per-account-cap posture is accepted game-wide (fight-fix / referral precedent):

- **J-1 — bank-interest whale-taper is per-character (defeats signed D5).** The D5 taper (full 2%/day on
  the first $10M/character, 10% of rate beyond) has no cross-account aggregation, so a whale who splits
  $100M across 10 alt banks earns ~$2M/day vs ~$380k/day consolidated (~5.3×). Bank balances are also
  loot-safe (`whack:loot` takes pocket + in-transit only). It's a FAUCET amplification (bank:interest),
  in-game cash, extraction-capped — but it un-bounds the exact exponential the D5 taper was signed to
  cap. **Options:** accept as the Sybil posture (each alt still needs ~$10M parked + the capital moved
  in), OR a global/account-aggregated taper (a design change), OR make alt banks loot-exposed. `accrual.js`
  bank-interest block; `rules.js` BANK_TAPER_ABOVE $10M / BANK_TAPER_KEEP 10%.
- **J-2 — `pen:work` cash faucet has no level floor + no per-account daily cap.** Every sibling faucet
  has a rookie floor (npcHit/WANTED/fight-bet) or a daily cap + agent-exclusion (social tasks); yard work
  (`pen.js:workYard`, ~$400/15 energy, jailed-only) has neither. Self-limiting per sim P9.11 (jailed-only,
  energy-bounded, shaves the sentence), so magnitude is modest — but the structural inconsistency stands.
  **Rec:** add `PEN.WORK_MIN_LVL` (the WHEEL_MIN_LVL/npcHit-floor pattern) + optionally a per-(account,day)
  cap if the alt-grind is seen in the alpha. `rules.js` PEN.WORK_ENERGY/WORK_PAY/WORK_CUT_S are the levers.

## Gambling Den step three — table games (blackjack + heads-up poker) — SIGN-OFF NOTE

Blackjack and heads-up Hold'em ride the audited den-book accounting and add **NO new emission
surface**: blackjack's stake→profit→payout is booked exactly like dice (the street is tipped only
from realized profit via `takeHouse`/`denAvailable`; the `casino:bet:blackjack`/`casino:win:blackjack`
rows join the den-profit §10.4 identity), and poker is a pure `casino:pvp` transfer with the same 5%
rake (half → buyback, half burns). Both are HOUSE-FAVORABLE in expectation (a NET SINK) — blackjack
at the authentic dealer-hits-soft-17 ~0.6% edge, poker rake at 5% of the pot. Levers
(`CASINO.BJ_PAYS_BPS` 15000 = 3:2, `BJ_DEALER_MIN` 17, `BJ_HIT_SOFT_17` true, `CASINO.POKER_MIN`) are
founder sign-off — none touch a signed faucet. §10.4 stays drift-0 (den profit == PvE bets − wins,
proven in test/casino.js over a mixed dice+blackjack+poker session).

## Gambling Den step four — the POKER TOURNAMENT — SIGN-OFF NOTE

The scheduled poker tournament is a pure competitive CASH REDISTRIBUTION with NO new emission: buy-ins
escrow into a pool, the worker deals + pays the top places from that pool net of a 5% house rake
(`TOURNEY.RAKE_BPS`, half → the buyback / half burns). Payouts are RENORMALIZED to the field size, so
the field's net loss is exactly the rake regardless of turnout (an unpaid place never leaks its share
to the house). §10.4-exact (a new `poker tourney escrow` check reconciles pool == Σ buyin − win −
refund − take − death). Levers (`TOURNEY.BUYIN` $5k, `RAKE_BPS` 500, `PAYOUTS` [.5,.3,.2],
`MIN_ENTRANTS` 2, `REGISTER_MS` 24h) are founder sign-off — none touch a signed faucet; the tournament
is a SINK (the rake) on the players' pooled cash, like the fight book but player-funded.

## Territory step four — FORTIFICATION + RIVAL RAIDS — SIGN-OFF NOTE

Two additions, both founder sign-off levers. **Fortify** (`territory:fortify`, `territoryFortCost` = base
$100k × (level+1) × tier, capped 5) is a pure recurring TREASURY SINK — clearly economy-positive (the late
game always wants more sinks). **Rival raids** (`territory:muscle`, 30% of a target op's pending income) are
**§10.4-NEUTRAL by construction**: the cut REDIRECTS uncollected income the owner would otherwise collect as
`territory:income` (the owner's clock advances so they keep the rest pending — the business-shakedown
pattern), so total `territory:income + territory:muscle` emission is bounded by the SAME sim-signed income
curve — no new faucet, just a contestable split. Anti-grief: a per-racket 8h cooldown (win OR lose) bounds
how fast one op can be ground down; a level-8 floor + energy cost + a failed-raid health hit + P1.3 safehouse
block bound the raider. All `TERRITORY_FORT_*` / `TERRITORY_RIVAL_*` numbers (cut %, cooldown, contest
scaling, fortitude defense per level) are sign-off levers — sim the contested-income realized $/day and the
fortify sink drain before production.

## Red-team R1 flag (2026-07-22) — rival-raid over-cap emission (territory:muscle)
`territory.js:raidRivalRacket` advances the owner's income clock to `now − (pending−cut)/rate`, leaving
them exactly `pending−cut`. This is emission-neutral ONLY while the owner is BELOW the 24h income cap. If
the owner neglected collection so `elapsed > TERRITORY_CAP_MS`, `pending` is pinned at `rate×CAP` but the
clock reset hands them ~0.7×CAP of fresh re-accruable headroom (forgiving the over-cap excess time) while
the raider also banked `cut ≈ 0.3×rate×CAP` — so total ledgered emission for that racket can reach ~1.3×
the per-collect ceiling. **§10.4 is NOT broken** — every move (`territory:muscle` raider / `territory:income`
owner) is ledgered and the gang-treasuries check reconciles exactly; this is a faucet-MAGNITUDE lever,
bounded by `TERRITORY_RIVAL_CUT_BPS` + the 8h per-racket cooldown, and only realizable when the owner sits
over-cap (already losing income to the cap). **Recommendation:** accept as a sign-off lever (a raid on a
neglected racket refunding some cap-forfeited time is arguably intended), OR clamp `remainMs` to the real
elapsed-since-collect so a raid can't hand fresh headroom. Not patched per ground rule #1 — founder call.

---

## Addendum — THE STREET WAGE (the value-creation pivot, 2026-07-23; PROPOSED, sim + sign-off)

| Lever | Default | Note |
|---|---|---|
| `EMISSION.ENDOWMENT_OMR` | 1,000,000 | lifetime emission ceiling (mirror on-chain in E2) |
| `EMISSION.EPOCH_OMR` | 500/day | day-one budget (a CEILING — unearned budget is never minted) |
| `EMISSION.DECAY` / `DECAY_EVERY` | 0.5 / 180 | the halving schedule (~6 months) |
| `EMISSION.WAGE_CAP_OMR` | 5 | per-account/epoch cap — spreads the pot, bounds Sybil concentration |
| `EMISSION.WAGE_MIN_LVL` / `WAGE_MIN_SCORE` | 5 / 25 | the anti-login-bot floor (respect gain is energy-bounded) |

The wage is the ONLY scheduled mint; `emission within endowment` is the hard wall. Before launch
marketing mentions earning at all: re-derive per-region "what a day's grind pays" from the live $OMR
price and retune EPOCH_OMR/WAGE_CAP_OMR (counsel-gated messaging — see CLAUDE.md Sensitive notes).

| `WITHDRAW_TAX_BPS` (env, per-call) | 200 (2%) | the Exit Toll on every $OMR withdrawal — gross debited, net signed |
| `TAX.DEV_BPS` | 5000 (50%) | the dev share of the toll; the rest → stake_pool (the buyback/yield pool) |
| `BONDS.POL_BPS/DEV_BPS/VIG_BPS` | 5000/2000/3000 | the bond ETH three-way split (POL / dev wallet / Vig) — mirrored by the contract's immutables |
| `EARLY_SELL_TAX_BPS` (env, per-call) | 5000 (50% at age 0) | the anti-dump surcharge on exits of fresh $OMR — linear decay to 0 over the window |
| `FRESH_WINDOW_MS` (env, per-call) | 48h | the freshness window; no exemptions; split 50% dev / 50% buybacks |
| `OMR.sellTaxBps` (on-chain, owner-armed) | 0 at deploy (arm ≤1000 = 10% cap) | the flat DEX sell tax — registered pools only, 50/50 dev/buyback, V2-compatible pool REQUIRED |

### Red-team resolution (`AUDIT-value-creation.md`, 2026-07-23) — two D-rows for sign-off

The four-lens pass over the five value-creation drops found no conservation leak and one fixed MED
(the wage's crash-resume per-epoch budget breach — `emittedThisEpoch` now makes a resumed run top
up toward the budget, regression in test/emission.js). Two DESIGN calls on the new (unsigned)
levers are open, and they are COUPLED — together a bot farm captures the wage budget and extracts
it near-toll-free after a 48h ramp:

| Row | The call | Measured | Dials (pick before the faucet carries real value) |
|---|---|---|---|
| **D1 wage Sybil gate** | the agent flag is voluntary; guest alts are free; lvl-5 + 25 respect/day ≈ under a minute of automation per alt → ~100 alts capture the whole 500/day budget and pro-rata-starve honest earners | grind cost per alt ≈ one-time ~7 crimes + ~3 crimes/day | `INVITE_MODE=on` in production (built); gate the wage on a linked+MINTED wallet (the 0.01-ETH mint fee = a real per-alt cost); raise `WAGE_MIN_SCORE`/`WAGE_MIN_LVL`; diminishing per-account shares |
| **D2 surcharge FIFO semantics** | FIFO drains AGED lots first → tax-free daily exit allowance == your balance 48h ago → a steady earner exits each day's wage surcharge-free after a 2-day ramp; the toll as built is anti-INSTANT-dump only | 0% realized toll for any patient extractor | if the intent is "every fresh token pays once": price the FRESH end (LIFO or proportional across lots) — one ordering change in `src/tax.js`; if anti-panic-dump is the intent, keep + relabel |

(The doc's stake→unstake wash seam was re-measured and is NOT a real dodge — fresh tokens washed
through staking still price as fresh; only already-aged tokens "re-age." Corrected in the design doc.)

**D1 + D2 — BOTH BUILT (founder-directed 2026-07-23, "apply your recommended fixes").**
**D1:** the wage now pays only **MINTED** accounts (`wageRequireMinted()` — env `WAGE_REQUIRE_MINTED`,
default ON; the board + `/v1/rules.emission` surface `mintedRequired`/`minted`). Every wage-drawing
identity now costs the 0.01-ETH mint fee (or its PLEX price in earned $OMR) — a Sybil farm pays the
house per alt instead of draining the budget; free-trial players still play and earn everything else
(minting was already the extraction gate, so paid-identity-earns-the-extractable-wage closes
coherently). `INVITE_MODE=on` remains the recommended alpha posture on top.
**D2:** `earlySurcharge` now prices exits (and replays historical debits) **NEWEST-first** — an aged
buffer can no longer absorb a fresh dump; every fresh token pays on its first exit, exactly once
(a past taxed exit is consumed newest-first in later replays), and the only free exit is genuinely
holding a token 48h. Regressions: test/emission.js (unminted alt clearing every play gate draws $0;
minted → paid) + test/chain.js (fresh tokens pay ~50% behind a fat aged buffer; the aged remainder
then exits free; conservation unmoved).

## THE MEGAPROJECT (founder pick #1) — levers, all PROPOSED (sign-off before production)
| Lever | Value | Note |
|---|---|---|
| `MONUMENTS[].target` | $25M / $60M / $150M / $400M | pure SINKS — the deeper the base, the faster a wall rises; retune to alpha population (a shared weeks-long goal, not an afternoon) |
| `OMR_RATE` | $500/$OMR | FIXED credit rate (genesis AMM) — deliberately not live spot (deterministic, unmanipulable); re-peg if spot drifts far |
| `MIN_CASH` / `MIN_OMR` | $100 / 1 | spam floors |
| `TIERS` | Architect 1 / Foreman 3 / Patron 10 / Builder ∞ | plaque tiers — pure status |
| Completion perk | NOT BUILT | deliberately deferred — a district perk would touch the signed turf surface; ships only as an explicit sign-off, if ever |
Zero new emission (cash burn + $OMR burn + goods deletion — §10.4-positive; strengthens extraction ≤ inflow).
Red-team flags for sign-off (AUDIT — megaproject): **agents are NOT excluded from the plaque/Architect** (every other status board excludes them; here the plaque is bought with burned value, so inclusion may be intended — your call) · **the goods rail has no $-value floor** (1 cheap unit ≈ $40 vs the $100 cash floor — add a value floor only if dust spam shows in telemetry).

## Slate drops 4/5/6 — levers, all PROPOSED (sign-off before production)
**The Dueling Ladder (#5)** — `DUELS`: K 32 / floor 100 / variance 40 / MIN_LVL 5 / LEGEND_MIN_LVL 10 /
stake floor $1k / 5% rake (the audited casino:pvp split — ZERO new emission). Anti-Sybil: per-account-pair
daily K-diminishing + both floors + every feed pays the rake; residual: a patient multi-alt ring can still
inflate elo slowly (status-only, seasonal reset bounds it — the fight-fix posture). Seasonal reset is a
rollover rider.
**Clue Scrolls (#4)** — `CLUES`: 2% drop / 3–5 steps / dig 5 energy / casket $3k–$12k / 8h cooldown.
THE ONE NEW FAUCET: hard ceiling 3 caskets/day ≈ $22.5k mean/day/char (sim P9.19) — petty by design.
**Seasonal Modifiers (#6)** — `SEASON_MODS`: THE ONE DROP THAT TOUCHES SIGNED LEVERS BY DESIGN (a
season-long twist on laylow/law-gain/loot/safehouse/trade-sell). Pool ships SMALL (4 mods, 1 vanilla);
every multiplier is a named lever; review the pool each season. **DORMANT BY DEFAULT** — the layer ships
vanilla (every season Dead Quiet) until the founder arms `SEASON_MODS=on` (read per call); arming it is
itself the sign-off decision, since it twists signed numbers for 28 days at a time.

**Red-team flags for sign-off (AUDIT-slate-drops.md — flagged, NOT patched):**
- **The Gold Rush round-trip** — the ×1.05 sell-only mult flips a same-district goods buy→sell round
  trip past the 4% fee wall (~+1% riskless per cycle, trunk-bounded) for the whole season. Dials:
  ×1.03, or symmetric buy+sell. Moot while the layer stays unarmed.
- **`duel_wins` legend farmability** — the lifetime legend has no per-pair decay: one funded lvl-10
  alt feeds wins at rate-limit speed (rake-taxed, elo-neutral after K-decay). The accepted
  fight-fix/referral Sybil posture; `LEGEND_MIN_LVL` is the dial.
- **Latent sub-1 `safehouseMult`** — applied OUTSIDE the `max($25k, 1% NW)` floor; no current mod is
  sub-1, but a future discount season would undercut the signed minimum (one-line re-floor if ever).
- **Crackdown `lawGainMult` retroactivity** — at a season boundary the current rate applies to the
  whole (8h-capped) accrual window. Bounded ±25% × 8h; accepted-shape note.
- **Two 28-day season clocks** — `seasonIdxOf` (rules.js) and `runSeasonRollover` (worker.js)
  duplicate `day/28`; linking comments added at both sites so a future lever change touches both.

## Deep-deferred four (2026-07-24) — levers, all PROPOSED (sign-off before production)
**Estate step two** — `ESTATE.STAFF` (wages 0.5–3 $OMR/day, hire 10× daily) / `STAFF_WALK_MS` 7d /
`GALA_OMR` 15 × tier / `GALA_MIN_TIER` 2 / `GALA_MS` 4h. Pure $OMR SINKS (the recurring drain the
one-time burns lacked); staff/gala are status-only — zero gameplay power. The dismiss-dodge is −EV by
construction (rehire fees ≥ 10 days' wage vs a 7-day walk window).
**Commission step three** — `PROPOSAL_DEPOSIT` $100k (treasury escrow; enacted → refund, else → the
confiscation pool — a conditional treasury sink). **THE LEVY** moves NO new money — it redirects the
buyback's existing family split (50% of bought $OMR) to the seated chamber (5..1 by seat) for the
decree's week. Watch item: a chamber that votes itself the levy weekly is self-dealing the split away
from the lifetime top-25 — bounded by the seasonal seat formula + the public vote, but a levy-cadence
cap is the dial if it becomes the permanent decree.
**The Loan House** — `HOUSE_RATE` 0.35 / `HOUSE_TERM_H` 24 / `HOUSE_MIN` $1k / cap $2k×lvl ≤ $50k /
`HOUSE_MIN_LVL` 3 / `HOUSE_VIG_BPS` 5000 (half of every P2P vig funds the window). NOT a faucet: the
pool lends only what sinks funded (full-reserve), defaults are pool-bounded losses. Watch item: the
die-and-default cycle (a lvl-3 alt borrows ~$6k, extracts, dies — the pool eats it); bounded by the
pool itself going dry + the welsher/WANTED marks, but `HOUSE_MIN_LVL` and the level-scaled cap are the
dials if farm telemetry shows drain outpacing vig inflow.
**Ring poker** — `RING.BLINDS` 100/1k/10k / buy-in 20–200bb / `RAKE_BPS` 300 capped 10bb / `TURN_MS`
90s / `IDLE_MS` 30min / `MIN_LVL` 3. A NET SINK (the rake burns half); PvP redistribution otherwise.
Watch item: fold-to-raise chip-dumping is a transfer rail raked at up to 3% (vs the audited 2% takes)
— dumping is strictly worse than the existing rails, so no new collusion surface, but flag for the
ops feed. **The bracket** — `BRACKET.HEAT_SIZE` 6 / `ADVANCE` 2 / `ROUND_MS` 10min; the same 5%
tournament rake; alt-stuffing stays −rake/N per head (renormalized payouts).

## Deep-deferred four — red-team sign-off flags (AUDIT-deep-deferred.md, all NOT patched per ground rule #1)
- **Estate walk economics** — letting the staff WALK (cost: one rehire fee ≈ 10× daily wage) beats
  continuous wages beyond ~10 days, so the "recurring" $OMR sink floors at the rehire fee for a
  player who only staffs up before a gala. Dials: the `hireOmr` multiple, arrears surviving as a
  lien, or wages accruing while the house is listed on the leaderboard.
- **Commission levy self-deal + agenda-control** — a $100k proposal is refunded on enactment (a
  near-free lever) that LOCKS the ballot to proposed decrees AND, for `the_levy`, routes the buyback
  family cut to the seated chamber including the proposer. Bounded by the public vote + the seasonal
  seat formula; a levy-cadence cap is the dial if it becomes the permanent decree.
- **Last-second proposal sniping** — a proposal landing just before the week freezes discards the
  chamber majority's votes for unproposed decrees at ~zero net cost (refunded on enactment). Intended
  leverage vs. abuse is a design call.
- **Loan-house death cycle** — a lvl-3 alt borrows the per-level cap, extracts, dies; the heir
  repeats. Pool-bounded (the house lends only what sinks funded) + welsher/WANTED-marked, but a
  recurring net drain vs. vig inflow. `HOUSE_MIN_LVL` + the level-scaled cap are the dials.
- **Ring soft-play / chip-dumping** — dumping via fold-to-raise is NOT a cheaper transfer rail
  (raked ≥3%, worse than the 2% audited rails), but out-of-band soft-play collusion against a
  non-colluding mark is unpreventable server-side (the poker reality; the rake taxes it).

---

## TIER-1 → TIER-4 DEEPENING PROGRAM (2026-07-24) — new sign-off levers

Six thin systems expanded to Tier-4. All new numbers are founder sign-off levers; §10.4 stayed
drift-0 throughout (sim + 43-suite green after every drop). Red-team: `AUDIT-tier1-deepening.md`
(no CRITICAL/HIGH).

**Dueling Ladder** — `DUELS.DIVISIONS` (6 divisions), `STYLES` (Brawler>Gunslinger>Fencer),
`STYLE_EDGE` (1.15 combat mult), `GRUDGE_CD_MULT` (0.34 rematch cooldown), `DUEL_TITLE_RANKS`.
All status/combat — the wager stays the audited casino:pvp transfer (no faucet). KEEP.

**Crew Heists** — the job ladder 4→12 (`HEIST_JOBS` takePerLvl bands are the sim-signed faucet,
on the existing ROI curve — the marquee jobs `minPulled`-gated); `HEIST_CASE_*` (casing bonus,
capped 0.15); `HEIST_FENCE_LO/SPAN` (fence band 0.80–1.10, mean ~0.95 — a variance play, never a
net faucet increase since it REPLACES the cash payout); `HEIST_LOOT_RATE` (0.5, the P1.1 hot-loot
loot); `HEIST_RANKS`. **Flag:** the new job bands + the fence — sim the 12-job curve; the fence is
safehouse-UNGATED (Port parity — a founder call, one line for D2-parity).

**Clue Scrolls** — `CLUES.TIERS` (easy→master; the **master casket band $55k–120k** is the one
flagged faucet, ≤3/day-capped); puzzle KINDS (anagram/cipher, zero dig-logic change); `RELICS` +
`relicP` (status Collection trophies, never $OMR); a deeper `Master of the Trail` rank. **Flag:**
sim the master casket $/day.

**Territory Rackets** — the TYPE catalog 3→6 (loansharking ×1.20 / chop_shop ×1.25 /
counterfeiting ×1.45 — the income mults INCREASE the ledgered `territory:income` faucet for the hot
types, offset by scrutiny/raid risk; numbers ×1.0 preserves the signed baseline); `TERRITORY_SYNDICATE_MIN`
(3, the same-type meta — PURE STATUS, no income bonus this drop). **Flag:** sim the net EV per new type.

**Sovereignty** — the stronghold ladder 3→6 (`SOV.TIERS` Bastion/Fortress-City/The Iron Capital —
cost/garrison/upkeep sinks); **`incomePerDay` per tier** (the one new treasury FAUCET — a held
stronghold's lazy tribute, `INCOME_CAP_MS` 24h-capped, crumbling-gated, overextension-taxed;
§10.4-neutral to the gang-treasuries check, proven by a before/after drift delta); deeper
SOV_POINTS/RANKS. **Flag:** sim the sov:income curve (base-wide bounded by ≤6 districts × the taxed rate).

**Soldiers** — `SOLDIERS.RANKS` (Associate→Caporegime, derived status) + the COMMANDER LEGEND
(`account_persistent.soldiers_led`, survives death) + `COMMANDER_RANKS` + `/v1/leaderboard/commanders`.
Zero §10.4 (a status counter). KEEP.

## TIER-2 → TIER-4 DEEPENING (2026-07-24) — new/widened levers, sim before production

**Kitchen (`KITCHEN` block).** LAB MODULES (`MODULES` purity 0.03 / yield 0.15 / stealth 0.14 per level,
`MODULE_MAX` 5, `MODULE_BASE_CASH` 60k, `MODULE_OMR_FROM/STEP`) — purity→cook quality, yield→batch cap,
stealth→offline raid odds. **Flag:** the yield module raises how much product a cook yields and stealth
cuts product LOST to the Bureau, both mild widenings of the deal faucet — sim the kitchen curve with a
maxed lab (bounded by the cash+$OMR SINK to buy the levels + the module cap). CUTTING AGENTS (`CUT_COST`
8k / `CUT_UNITS` 0.4 / `CUT_QUALITY` 0.15 / `CUT_FLOOR` 0.55) — a volume-vs-quality trade, roughly
margin-neutral (deal price scales on quality); a cash SINK. KINGPIN legend = pure status (KEEP).

**Assets & Rackets (`RACKET_EMPIRE` block).** RACKET UPGRADES (`UP_MAX` 5, `UP_STEP` 0.12,
`UP_COST_MULT` 0.5) — **the one real faucet-widen**: +12%/level on a racket's `racket:income` accrual, cap
+60%. Bounded by the per-character daily income token bucket (`racket_credit_ms`) + the level cap + the
`racket:upgrade` cash SINK (cost = racket.cost × 0.5 × level). **Flag:** sim the net per-racket EV
(the business/territory-upgrade precedent). TYCOON legend + EMPIRE SETS = pure status (KEEP).

**Megaproject (`MEGAPROJECT` block).** Catalog 4→8 (Opera 900M → Eternal Flame 12B, on-curve — content).
Builder/architect/family-build = pure status; the contribution is still a pure SINK. **Zero faucet — KEEP.**

**Five Pillars (`HONOR` block).** The ladder 5→7 + the honor peak/low legend + the reputation boards =
pure status; the teeth (DREADED −60 / TRUSTED 60) are unchanged. **Zero faucet — KEEP.**

## TIER-3 → TIER-4 DEEPENING PROGRAM (2026-07-24) — new sign-off levers

Six mid-depth systems deepened (Business Empire, Convoys, Commission, Reserve Bond, Store/Ledger,
Estate & Auction). Red-team `AUDIT-tier3-deepening.md`: no CRITICAL/HIGH/MED; §10.4 drift-0; 45/45.
The Tier-4 work is overwhelmingly **status legends** (zero §10.4) + **deflationary $OMR sinks**. The
levers/flags below are the only balance surfaces — none is a bug.

- **Player consignment (`AUCTION.CONSIGN`) — a NEW P2P $OMR TRANSFER rail. NET-DEFLATIONARY, WATCH.**
  A bidder→seller $OMR transfer with a house TAKE (`TAKE_BPS` 5%, burns) + a listing FEE (`FEE_OMR` 2,
  burns), so it can only SHRINK supply; collusion is −EV by the take (the market/loan/bodyguard rake
  precedent). But it IS a new $OMR movement path — sim the volume before production. Dials:
  `TAKE_BPS`, `FEE_OMR`, `MIN_RESERVE`/`MAX_RESERVE`, `MAX_LIVE` 3, `MS` 48h.
- **`blood_oath` decree ×`BLOOD_OATH_LOOT_MULT` (1.25) on the signed `CASH_LOOT_RATE` — WATCH.** A
  temporary ONE-WEEK Commission decree modifier on a signed lever, applied at both fire-kill cash-loot
  sites and clamped at the existing `Math.min(0.5, …)` ceiling (the open_season/amnesty precedent — a
  decree modifying a signed surface is the established pattern). Cash-only (the $OMR loot is
  untouched). The mult is a sign-off lever; it never breaches the 0.5 cap.
- **`smugglers_moon` (port interdiction ×0.75) / `open_roads` (convoy arrival ×0.8) decrees — KEEP.**
  Bounded one-week modifiers, one touchpoint each; open_roads was already wired at convoy depart.
- **The deeper $OMR sinks help extraction ≤ inflow — KEEP (favored).** Estate tier-6 Palazzo (6000),
  the legendary rare auction lots (400–1000 min bids that burn), `business:spec`, `bond:pledge`/
  `bond:charter` — all deflationary; a stronger sink is favored.
- **The status boards (Collector/Statesman/Patron/Benefactor/Underwriter/Teamster) are
  Sybil-inflatable — ACCEPT.** A self-funded whale can inflate them, but NO payout attaches (status
  only — the referral/hitman-rep accepted posture). Agents excluded.
- **`season_sunk` boundary edge — ACCEPT (LOW).** An account whose character dies exactly at a 28-day
  season boundary keeps last season's `season_sunk` one extra season (a cosmetic Patron-crown
  inaccuracy, no §10.4, no payout) — consistent with the codebase's per-char lazy season markers.

All `AUCTION.CONSIGN.*`, `BLOOD_OATH_LOOT_MULT`, `PORT_INTERDICT_MULT`, `OPEN_ROADS_MULT`,
`COMMISSION.STATECRAFT_*`/`OVERRIDE_WEIGHT`, `BONDS.PLEDGE_MIN`/charter costs, and the Tier-6/rare-lot
catalog numbers are founder sign-off levers.

## TRANSPORT DEPTH — Tier C (ROUTE NOTORIETY + THE SMUGGLER'S REPUTATION), founder sign-off levers
Addresses the tester "transport farming is repetitive" feedback (`omerta-transport-depth-design.md`). All
`NOTORIETY.*` numbers are sign-off levers — pure RISK/STATUS modifiers, off every signed FAUCET curve.
- **Route notoriety is EMISSION-SAFE.** Port: heat only RAISES interdiction (fewer clean landings → LESS
  `port:sale` emission; capped `PORT_P_CAP` 0.16, re-clamped to the signed `INTERDICT_MAX`). Convoy: heat only
  LOWERS the shipper's own guard defense (capped `CONVOY_DEF_CAP` 24) — an ambush is a pure ownership TRANSFER,
  not a faucet, so total haul volume is unchanged; only WHO holds it shifts. Neither widens a faucet — both can
  only reduce/redistribute. Sim stays drift-0.
- **The reputation TOLL BREAK (rep T2, ≥$2M legend → `REP_TOLL_MULT` 0.5) is the one value-touching lever** — it
  HALVES the harbormaster/destination `port:toll`/`convoy:toll`, a §10.4-neutral TRANSFER discount (the treasury
  receives less; nothing is created — the ledger row is just smaller). Net effect: a small reduction in family
  toll income from legend-rank runners. FLAG: watch whether it materially softens the turf-toll income loop.
- **The rep decay/gain perks (T1 `REP_DECAY_MULT` 2, T3 `REP_GAIN_MULT` 0.5) are pure risk-management** — they
  only return a legend's lanes toward baseline faster / heat them slower; notoriety never goes below 0, so these
  can never push interdiction below the signed floor or guards above the signed tier. Status→access, no faucet.
- KEEP recommendation for alpha: the numbers make a farmed lane meaningfully riskier (interdiction climbs
  ~0.16 over ~5 un-rotated runs on the port; guards shed up to 24 on a hot convoy lane) while a rotated player
  is untouched — the intended "vary your lanes" pressure. Dials if it bites: `GAIN`/`DECAY_PER_HR`/`MAX` for
  the pressure magnitude, `PORT_P_PER`/`CONVOY_DEF_PER` for the per-point severity, the `REP_*_TIER` thresholds
  for how quickly reputation earns relief.

## THE SACKING (L3a — passive wealth is PvP-losable) — founder sign-off flag
`M3.SACK_ON_KILL` (default on): a PLAYER fire-kill lets the killer SEIZE one of the victim's business
fronts (the most valuable one they can HOLD — level gate + an empty kind slot) instead of it dying with
the street. §10.4-NEUTRAL (a front is an ownership object, not a currency — no ledger row, sim drift-0;
the territory-seize precedent). It's the keystone lever from the stakes/spine review: it makes the
passive-front stack (measured at ~$49M/day NET in sim P9.20) genuine RISK CAPITAL and gives the kill
economy (measured −$72k standalone) a prize worth the ammo — converging findings #1/#2/#3.
**SIGN-OFF:** a seized front is a ZERO-SUM transfer between players (no new base-wide emission), but it
CONCENTRATES the passive stack in fewer hands over time. Sim the concentration + defense-spend response
before production. Dial: `M3.SACK_ON_KILL=false` disables it entirely; a future refinement could seize a
tier-DROP instead of the whole front, or cap seizes-per-victim. Deferred sibling levers (#3): L3b (cap the
eight untouchable states) and L3c (a cheaper contracted-kill ammo floor).

## THE SHIELDS (L3b + L3c) — founder sign-off flags
**L3b — THE SHIELD CAP** (`M3.SAFEHOUSE_DAILY_CAP_MS` 12h): the safehouse is a rolling-window token
bucket (the wash-cap twin) on total off-grid time per day. With a 4h stay, three stays fill the bucket
and the fourth is refused (`safe_cap`) — so a whale can't live permanently unreachable and the rich must
surface. §10.4-untouched (a gate on a cash sink, moves no value). Closes the "eight untouchable states"
gap from the review's #3. Dial: raise/lower the cap; 0 disables (uncapped as before).
**L3c — THE CONTRACT'S BULLETS** (`M3.CONTRACT_AMMO_REBATE` 0.5): ammo is the −EV driver on a hit; a kill
that fulfils a PAID contract (bounty > 0) rebates half the rounds spent as a bounded, ledgered ammo
FAUCET (`contract:rebate`, in the ammo §10.4 vocabulary), so the pot doesn't have to carry the whole
loss and a smaller contract turns a hit +EV. Only on a contracted kill (a standalone kill keeps its
−$72k standalone EV — the D1 anchor is untouched). SIGN-OFF: sim the contract break-even shift (a paid
kill now costs ~half the ammo) before production; dial `CONTRACT_AMMO_REBATE` (0 disables). Both close
review #3 alongside L3a (the Sacking).

## THE L1/L2 ECONOMY BALANCE PACKAGE (review #1 + #2) — founder-directed "Balance the economy"
Applied per the founder's explicit "Balance the economy" direction (the sign-off for these specific
signed levers; ground rule #1's "don't unilaterally retune" is overridden by the founder's pick).
Re-measured in `tools/sim.js` P9.20 (drift-0 throughout).

**L1a — FLATTEN THE APEX FRONT CURVE.** The two endgame personal fronts — `hotel` (lvl 42) and `casino`
(lvl 58) — had their `incomePerHr` HALVED at every tier in the `BUSINESSES` catalog (the casino alone
was $36M/day gross). The early/mid on-ramp fronts (laundromat/restaurant/nightclub) are UNTOUCHED, so a
new player is unaffected — only the top of the curve is trimmed. Every front is still a ledgered
`business:income` faucet → §10.4 drift-0.

**L1b — THE PROGRESSIVE PAD.** `BUSINESS_UPKEEP_PROG_BPS` (500 = +5%) is added per EXTRA front owned
(`business.js:upkeepBps(count)`, threaded through `upkeepOwed` + the empire view + the P9.20 probe). A
1-front operator pays the base 20% pad; a full 5-front stack pays 40% — the 5th front costs twice as
much to run as the 1st, so stacking every kind has diminishing returns. Still a ledgered
`business:upkeep` sink → §10.4 untouched.

**Measured effect (P9.20):** the personal 5-front stack drops **~$48.96M/day → $21.6M/day NET**
(L1a halves the gross to $36M, L1b's 40% progressive pad keeps 60%) — a firm 2.27× cut to the stack. The
passive:active ratio (vs the sim's floating active-grind baseline) lands **~2–3.5×**, down from ~6× — a
maxed empire still out-earns the active grind (as it should), but no longer dwarfs it.
**Remaining dials (NOT applied):** the full front `incomePerHr` curve (L1a only touched the apex two
kinds), a global personal-income cap (L1c), and the family-side territory stack ($20.9M/day/district, L1d).

**L2a — THE DEATH DUTY.** On every death (`runEstate`), succession burns `M3.DEATH_DUTY_RATE` (25%) of
the heir's inherited **LIQUID $OMR** — a §10.4 `death:duty` $OMR BURN (in `omrBurns`), applied AFTER
the P1.1 loot (killer takes their cut, then the estate taxes the remainder). **Staked $OMR, the RWA
portfolio/vault, and the Estate are UNTOUCHED** — the "go legit / retire in safe harbours" pitch stays
intact by design; the duty bites only the *extractable, un-committed* hoard, so dying finally costs the
bloodline something while the wealth it was told is safe stays safe. A respawn-token save skips the
estate → no duty. Runs on all five death paths (fire/shank/npc-hit via the wrapped persist; mod-kill +
NPC-hunter carry the `omr` decrement in their hand-rolled persists). Dial: `DEATH_DUTY_RATE` (0 disables).
**SIGN-OFF:** the duty concentrates nothing (it's a pure deflationary $OMR sink — it helps
extraction≤inflow) but it *does* make repeated death a real $OMR cost; sim the effect on a high-death-rate
PvP player's extraction runway before production.

## THE APPROACH (D6a — the crime risk/reward choice) — founder sign-off flags
Every job now takes a per-job choice (Case It / Standard / Go Loud), `M3.CRIME_APPROACHES`. **The CASH
faucet is EV-NEUTRAL by construction** (`payMult ≈ 1/successMult`) — the sim-signed §7.2 crime cash curve
is UNTOUCHED, and the default/omitted approach IS 'standard' (byte-identical to the old behaviour, so the
sim's measurement holds). The choice differentiates on the SECONDARY axes, which ARE sign-off levers (sim
before production): **materials** (loud crateMult 1.6 / makingsMult 1.5 vs quiet 0.5 — a cb/makings
emission shift, still fully ledgered so §10.4 stays exact, but it changes workshop/kitchen input supply);
**rep** (loud ×1.15 — a mild leveling-speed nudge, status not a §10.4 currency); **heat** (loud +6 on the
attempt → feeds the RICO meter — an opt-in downside the player chose); **bust severity** (loud jailMult 1.4
/ quiet 0.8). `CRIME_LOUD_CASH_PREMIUM` (default 1.0 = EV-neutral) is the dial if Go Loud should pay a real
cash premium (>1 makes it a genuine faucet change → needs its own sim + sign-off). Recommendation: KEEP the
EV-neutral default; sim the cb/makings emission delta from loud-spamming (bounded by nerve + the bust risk +
the heat it draws) before production.

## THE MESSAGE + THE PLAY (D6a step two — the other two entry verbs) — founder sign-off flags
The crime picker's treatment extended to the game's other two shallow entry verbs, each with its OWN
thematic axis. Neither touches a signed CASH curve.

**THE MESSAGE** (`M3.JUMP_INTENTS` — the jump: money vs reputation). *Roll Them* `stealMult` 1.35 /
`repMult` 0.6 / `dmgMult` 0.7 / `hospMult` 0.7; *Send a Message* `stealMult` 0.4 / `repMult` 1.5 /
`dmgMult` 1.4 / `hospMult` 1.5 / +5 law heat; *standard* is the identity (an omitted intent is
byte-identical to the pre-choice jump). **§10.4-free**: the steal is a pure zero-sum TRANSFER
(`jump:steal`/`jump:stolen`), still bounded by `JUMP_STEAL_CAP`, so scaling it moves who holds the cash
and can never create any; rep is a status axis; damage/hospital is pacing. SIGN-OFF: `rob`'s 1.35× is a
larger PvP transfer (capped, and paid for with 40% of the rep) and `message`'s +5 heat is a new Law
touchpoint. Note the built-in self-limiter: the hospital is PROTECTION in this game, so a longer stay
from `message` shields the mark from the attacker too.

**THE PLAY** (`M4.DEAL_PLAYS` — the corner: throughput vs the Law). *careful* `heatMult` 0.5 /
`nerveMult` 2.0 / `repMult` 1.10; *flood* `heatMult` 2.0 / `nerveMult` 0.5 / `repMult` 0.90; *standard*
the identity. **The CASH is IDENTICAL on every play** — the sim-audited §7.10 deal curve is untouched by
construction (a regression asserts `careful.earned == standard.earned == flood.earned`), because the axis
is deliberately not price. What moves is nerve (the corner's real throttle), heat (feeding the RICO meter
+ the Bureau's kitchen raid), and trade rep — and the `repMult` is arranged so the FAST play can only
*slow* rank progression, never accelerate access to the rank price bonus. SIGN-OFF: the heat/nerve/rep
multipliers are new levers; sim whether `flood`'s doubled heat is a real deterrent at endgame laylow
prices before production.

---

## FINAL SWEEP — every open flagged item resolved (founder-directed 2026-07-24)

*"Bring up a list of all not patched items and apply your game balancing recommendations to all."*
The full ranked ledger — APPLIED / ACCEPTED / not-a-balance-item — lives in **`SIGN-OFF.md` § FINAL
SWEEP**. This section records only the **numeric levers that moved**, so BALANCE.md stays the table of
what the economy actually runs on. Suite green + sim drift-0 after the package.

| Lever | Was | Now | Why (one line) |
|---|---|---|---|
| `PORT.ROUTES.deeprun.sell` | 1900 | **2700** | the deepest route was a trap ($131k/day vs Open Water's $303k); ×3.0 is the derived floor for it to actually beat the safe route → ~$380k/day |
| `STABLE.STABLE_MAX` | 4 | **3** | aligned with `BOXING.STABLE_MAX` — identical bounded-purse mechanic, so the 4th slot was a free +33% ceiling |
| `SEASON_MODS.the_gold_rush.tradeSellMult` | 1.05 | **1.03** | 1.05 flipped a same-district round trip past the 4% fee wall (~+1% riskless/cycle for a season) |
| `LOAN.HOUSE_MIN_LVL` | 3 | **10** | the loan-house death cycle: a disposable alt borrowed the cap, extracted, died — now it costs a real grind |
| `M3.LOOT_MIN_LVL` | *(none)* | **10** | a fire-kill loots nothing off a rookie — closes the disposable-alt value funnel; the estate still runs |
| `M3.JUMP_INTENTS.message.energyMult` | *(none, flat 25)* | **1.5 (38)** | prices THE MESSAGE's 1.5× rep + 1.5× hospital so it's rate-neutral per energy, not a free multiplier |
| `M3.DEATH_DUTY_RATE` base | liquid $OMR | **liquid + unbonding** | the sibling P1.1 loot already used that base; dying mid-unbond had sheltered the hoard |
| `PEN.PROTECTION_NW_BPS` | *(none, flat $15k)* | **50 (0.5%)** | a jailed whale bought shank-immunity for pocket change; wealth-scaled like the safehouse |
| `PEN.SHANK_CD_MS` | *(none)* | **30 min** | per-attacker; a stocked-up inmate could work down a whole wing in one sitting |
| Crew-sale raid heat feed | uncapped `heat` | **`min(100, heat)`** | parity with the Law-exposure path; a hot stash can't exceed the heat-100 ceiling's odds |
| `TERRITORY_TYPES[*].desc` | — | **collection-cadence guidance** | Numbers lazy-dominates the hot types; the fix is an informed choice at establish, NOT a curve retune |

**Gates added (no numbers, closing parity holes):** `fenceLoot` and `buyPaper` are safehouse-blocked;
`upgradeRacket` resolves a pending Bureau raid before banking the pending take; the megaproject goods rail
carries the cash rail's `$MIN_CASH` floor; `claimVaulted` (the RWA float) is minted-only; `duel_wins`
credits only the first duel against a bloodline each day.

**All of the above are still founder sign-off levers** — every one is a single constant or a one-line gate,
reversible by setting it back. The three faucet-touching rows (deeprun sell ↑, stable cap ↓, gold rush ↓)
should be re-measured in `tools/sim.js` alongside the existing P9 probes before production.

---

## THE PACING PASS — "level 240 in two hours" (founder-directed 2026-07-24, from live alpha)

An alpha tester reached **level 240 in a couple of hours**. Diagnosed by measurement, not guesswork —
the cause was one chain, not a broadly-too-fast curve:

1. **`train` had no cooldown and no cash cost.** 10 energy against a 40/min regen = **~240 sessions an
   hour**, so every mission STAT gate (muscle/cunning/speed up to 155) fell in a single sitting.
2. **Missions had no cooldown, and the ladder SELF-UNLOCKS.** From ~m6 on, each mission's respect reward
   overshoots the *next* mission's level gate by 30–100 levels — the gates stop gating.
3. **The ladder paid 239,200 respect**, and `levelOf` needed only 228,484 for L240. **The mission chain
   alone was levels 1→245.** For scale, the best sustained crime grind is ~3,257 respect/hr — the ladder
   handed over about three days of hard grinding in one uninterrupted sitting.

Everything is now in one `PACING` block in `src/rules.js` so the whole curve is one place to tune.

| Lever | Was | Now | Effect |
|---|---|---|---|
| `PACING.LEVEL_DIVISOR` (respect(L) = D×(L−1)²) | 4 | **10** | every level costs 2.5× more respect — same shape, stretched |
| `PACING.ENERGY_REGEN_PER_MIN` | 40 (+20 Runner) | **12 (+4)** | a tank refilled in ~75s and paced nothing; now ~15–20 min |
| `PACING.NERVE_REGEN_PER_MIN` | 20 | **6** | the crime clock — 1200 → 360 nerve/hr |
| `PACING.MISSION_CD_MS` | *(none)* | **4h** | the ladder can't cascade — 28 jobs ≈ 4.7 days minimum |
| `PACING.MISSION_RESPECT_MULT` | 1.0 | **0.25** | the full ladder is worth a level ~78 character, not the whole game. **Cash / $OMR / titles UNTOUCHED** — the story still pays |
| `PACING.TRAIN_CD_MS` | *(none)* | **3 min** | ~240 → ~20 sessions/hr; the ~500 sessions the top gates need is a ~25h investment |

**Measured result** (crime grind at the new nerve rate, early ~540 → top-tier ~977 respect/hr):

| | old | new |
|---|---|---|
| 2 hours of play | **level 245** | **level ~11** |
| level 20 | minutes | ~4–7 h |
| level 40 | minutes | ~16–28 h |
| level 100 | minutes | ~100–180 h |
| level 240 | 2 h | **~600–1,000 h** |

§10.4 is untouched — none of this moves value; it changes how fast a player may act and what a level
costs. **Suite 45/45 + sim drift-0.**

**Deploy note:** existing alpha characters keep their respect, so their displayed **level drops** on the
new curve (that is the intended correction). `PACING` is env-free — set `MISSION_CD_MS` / `TRAIN_CD_MS`
to `0` (test knobs) to disable either cooldown; the divisor and regen rates are plain constants.

**Follow-on levers if the alpha still runs hot/cold:** the crime `respect` table itself (untouched — it's
sim-signed), the daily-contract `5×lvl` / Score `8×lvl` level-scaled respect, and jump rep (1% of the
victim's respect — the one *compounding* source, currently bounded by the 3-min hospital window).

---

## THE PROGRESSION HARNESS — the pacing pass, verified by simulation (2026-07-24)

`tools/playthrough.js` (`npm run playthrough`) is the **player-experience** twin of `tools/sim.js`.
The sim answers *"does the economy conserve, and how big is each faucet"*; the harness answers
*"what does a person actually experience"* — what they can do in a sitting, what gates them, where
they stall, and how long a level takes. Same discipline as the sim: **public API only, no value
seeded**; the only SQL is the clock (this character's timestamps pulled back N minutes, which is the
§7.1 lazy-accrual contract). The player is **plausible, not optimal** — a fixed priority ladder
(checklist → Path → bank → boost+melt → the Score → the mission ladder → arm up → the gym → grind
the best crime the nerve pool covers → claim dailies). If a plausible player can speedrun, a real
one certainly can.

The level-240 speedrun was a **progression** bug, not an economy bug — the §10.4 sweep was drift-0
the whole time. This is the harness that would have caught it.

### The headline: the speedrun is closed

| | before the pacing pass | measured now |
|---|---|---|
| 3 hours straight, one sitting | *(tester reached **level 240**)* | **level 17** |
| 2 hours at the keyboard | — | **level 14–16** |
| 5 hours | — | level ~26 |
| 10.5 hours (2 × 45 min/day, 7 days) | — | **level 44** |

The earlier BALANCE estimate of *"2 hours → level ~11"* was analytic; the simulated figure is
**14–16** (the estimate omitted the Score, the mission ladder and the checklist). Same order,
corrected upward — recorded here as the measured number.

### What actually throttles a sitting (measured over 10h30m of play)

| Resource | Reading | Verdict |
|---|---|---|
| **Nerve** | pool sat at **21% of cap** on average, full only **3%** of minutes; funds **60 crimes/hour** | **This is the throttle.** A continuous drip, not burst-then-wait — the player is always limited, never idle. Working as intended. |
| **Energy** | full **94%** of minutes | **Vestigial for a street player.** Only the gym (10) and the garage (10) spend it against 12/min regen. A whole resource bar with no bite on the core loop. **Flagged — founder call.** |
| **The gym** | 209 sessions, hard-capped at **15/sitting** by the 3-min cooldown | The stat gates are now a multi-day investment, as designed. |
| **The mission ladder** | 14 jobs in 14 sittings | The **4h cooldown is longer than a sitting**, so the ladder advances ~**once per session** no matter how long you play. The cascade is now structurally impossible. |
| **Lockup** | **0%** of played minutes | Busts are cheap; jail is not a pacing lever at low level. |

### The solo ceiling

Using **only** crime, the gym, the garage, the Score, the mission ladder and the checklist — with
zero contact with another player — a 45-min-twice-a-day player reaches **level 44, $1.9M, 14/28 of
the story in 7 days.**

### Finding 1 — energy is vestigial for a street player → FIXED (legibility, not a retune)

Energy sits full 94% of minutes. The cause isn't a broken resource; it's a **mislabelled** one. Crime
runs on NERVE; energy is what the *physical* work costs (the gym, boosting cars, heist crews, cartel
raids, convoy ambushes, shakedowns, races). A street grinder simply never touches that content — so a
full bar is **unspent access, not idle capacity**. Adding an energy cost to crime was rejected: it
would double-throttle the signed core loop for no gain. What shipped instead:

- The in-game glossary was **factually wrong** — it read *"Energy fuels most actions (crimes,
  training)"*. Crimes cost nerve. Split into two honest entries naming exactly what each resource buys.
- The sheet's two bars are now labelled (`energy (gym · garage · crews)` / `nerve (crime)`) with
  hover detail.
- The coach's `Full tank` rung now names the content the tank is for, instead of "energy to burn".

**Coach dead-end fixed with it** (`M3.COACH_FAMILY_BAND_LVL`, `CONSTANTS.COACH_BANK_NUDGE`). The
harness reported the coach saying *"Nobody survives alone"* for the entire 7-day run — a rung a player
can **decline forever** sat above every one-time milestone, so the earner / skills / Kitchen /
going-legit / full-tank rungs were unreachable for any solo player. The `$25k` bank nudge had the same
shape (a mid-game session nets ~$360k, so it re-armed on every read). Both are **recurring** nudges and
now live in a tail below the one-time milestones; the family rung keeps its high priority inside the
early band (lvl 3–12), where joining a family genuinely *is* the next thing. General rule, worth
holding: **a rung that never clears must never sit above a rung that does.**

### Finding 2 — "cash outruns progression" → MEASURED, and my claim was wrong

I asserted the passive stack was "affordable long before the content that gates it". The harness now
measures net worth at the first minute a player is AT each front's level gate:

| Front | Gate | Entry cost | Net worth at the gate | Covers |
|---|---|---|---|---|
| laundromat | lvl 15 | $250,000 | $175,858 | **70%** |
| restaurant | lvl 22 | $500,000 | $468,802 | **94%** |
| nightclub | lvl 30 | $1,200,000 | $1,015,451 | **85%** |
| hotel | lvl 42 | $3,000,000 | $2,626,036 | **88%** |
| casino | lvl 58 | $8,000,000 | $5,936,832 | **74%** |

*(30-day solo run, all five gates reached — level 128, $51.3M, 25/28 missions at 45h played.)*

A solo grinder arrives at **every** gate still needing to save — 70–94% across the whole ladder, with
no runaway trend. The cash curve and the front cost curve are matched, so the gates are pacing
correctly and **no retune is warranted**. My earlier claim confused "a level-44 player can afford a
level-15 front" (trivially true, and fine) with "the gate is meaningless" (false). **Nothing changed
here.** The harness prints this table every run; if a gate ever goes over 100%, that front's entry
cost is the dial.

### Using it

    npm run playthrough                          # default: 2 sittings/day × 45 min, 7 days
    node tools/playthrough.js --days 14          # longer horizon
    node tools/playthrough.js --sessions 1 --session 180 --days 1   # the speedrun case

Re-run it after **any** pacing, cooldown, regen, mission or level-curve change — it is the only tool
that measures what a player feels rather than what the ledger conserves.

---

## THE POPULATION — NPC residents (founder-directed 2026-07-25)

Design: `omerta-npc-population-design.md`. Founder picked **"full residents"** (violence-eligible) +
**"living population"** (worker-maintained headcount). All `POPULATION.*` numbers are sign-off levers.

**The one new faucet: `npc:seed`** — the cash a resident spawns holding. Players extract it by
killing residents and looting the body. Measured analytically in the sim (**P9.21**, printed every run):

| | |
|---|---|
| residents standing | 48 (`POPULATION.TARGET`) |
| seed per resident (E) | **$20,798** weighted across the four bands |
| cash standing in the city | ~$998k — the whole faucet exposure at any instant |
| lootable per resident (E) | $20,560 (the two bottom bands are under `M3.LOOT_MIN_LVL` 10 → nothing to take) |
| **a killer nets per resident kill** | **$5,140** (25% of pocket) |

**Verdict: not a farm.** A kill costs ~$82k in ammo (the D1 anchor), so looting a resident is
**strongly −EV** — roughly the same conclusion the econ pass reached for player kills, and for the
same reason: the kill economy is contract-driven, loot is the tip. A resident is scenery with a
wallet, not a payday.

**Correction (red-team, `AUDIT-population.md`).** This section previously claimed turnover was
bounded by `SPAWN_PER_TICK` so *"the faucet can never be drained faster than the worker refills
it."* **That was wrong.** The top-up refills **headcount, not cash** — a resident drained to $0
stays alive and no replacement spawns. The seed pool is a **stock, not a flow**, so the honest
figure is a **~$998k lifetime bound**, not a rate.

Step two also changed how much of it is realizable. A kill leaks only 25% (the estate burns the
rest); a **duel win, a fade win or a buy-order fill transfers the whole stake**. So step two added
no faucet (no new reason, no new emission — that holds) but moved the existing one from
~25%-realized to ~100%-realized. Against a $21.6M/day passive stack, still petty. The sim prints
both figures every run.

**Levers if it ever needs tightening:** `TARGET` (exposure), the per-band `seed` (payday),
`SPAWN_PER_TICK` (turnover), `RETIRE_GENERATIONS` (caps `death:legacy` creep on long-lived lines).
`POPULATION_OFF=on` disables the whole thing for a server with enough real players.

**Two decisions worth the founder's eye:**

1. **The flag is EXPOSED, not hidden.** `GET /v1/streets` returns `npc: true` and the console shows
   a subtle `RESIDENT` chip. Residents are mechanically indistinguishable — every interaction runs
   the same audited code — but in a game with real-money extraction, quietly passing scenery off as
   people is not a call to make silently. Purely a presentation choice; trivially reversible.
2. **Residents draw NO Street Wage**, even when enrolled and minted (`emission.js`). That one is not
   a lever — a resident drawing emission would be theft from the endowment.
3. **RESOLVED (founder-directed 2026-07-25) — step three, THE TURNOVER.** The depletion flagged
   above is closed: the worker now retires residents players have **picked clean** and the top-up
   puts fresh faces in their place, so the city renews itself instead of quietly emptying.

   That deliberately converts `npc:seed` from a one-shot stock into a **recurring faucet**, so it
   ships with an explicit ceiling — and the ceiling meters **retirements, not dollars seeded**,
   because a retirement is exactly what creates the vacancy a fresh seed pays for. Metering dollars
   was the first cut and the test killed it: the day-one fill of an empty city is ~48 seeds that
   replace *nobody* and ate ~$998k of a $1M budget before anyone had been robbed.

   | | |
   |---|---|
   | `TURNOVER.PER_DAY` | **24** replacements/day (half the city), held in `population_state` |
   | bounded faucet | **≈$499k/day** at the weighted mean seed — territory-racket / boxing-purse band, ~2.3% of the passive stack |
   | `TURNOVER.DRAINED_BPS` | **15%** of what a resident ARRIVED with (`characters.npc_seed`) |

   "Picked clean" is measured against their **own arrival stake**, never a flat cash floor — a flat
   floor can't tell a drained boss from a corner kid born with $200 and would recycle the cheap
   bands on spawn, forever (an unbounded loop). The 15% line has margin: a resident with the maximum
   parked in escrow still holds ~52%. The allowance is charged in the same transaction as the
   retirement, so a crash can't hand out a free replacement. Watch it on the ops dashboard
   (`residentTurnoverToday` / `residentTurnoverCap` / `residentSeedToday`); the sim prints the
   ceiling every run. Both numbers are sign-off levers — `PER_DAY` is the direct faucet dial.

   Note the pool also recycles unaided, off-faucet: `hireBodyguard` and loan repayment both pay
   player cash *into* residents.

**Consent-limit floors (red-team F1–F3, applied).** The three consent columns are written by direct
SQL, which bypasses `offerBodyguard` / `listDuel` / `setFadeLimit` and every bound they enforce. Each
is now gated by **its own system's constant** rather than a population-local floor, so those stay the
single source of truth: `guard_price = max(M3.BODYGUARD_MIN_PRICE, 12% of cash)` (a guard price is
income received, not a stake to cover — the old bps-only sizing sold a lethal-hit absorb for a few
hundred dollars against a **signed $10,000** floor), `duel_limit` only when 9% of cash clears
`DUELS.STAKE_MIN` (below it the ladder entry is an empty window — unchallengeable decoration), and
`fade_limit` bounded by `CASINO.MIN_BET/MAX_BET`. Consequence: **fewer but legal listings** — the
duelling ladder now needs a resident holding ≥ ~$11.1k, so it draws from the made band up.

---

## TOKENOMICS v2 — THE EXCHANGE + THE FAMILY YIELD (built 2026-07-27, founder-directed)

Design: `omerta-tokenomics-v2-design.md`. Step 1 of the sequencing. All numbers are founder sign-off
levers. **Nothing signed was retuned in this drop** — the two new carves both default to no-op:

| lever | value | what it does | status |
|---|---|---|---|
| `EXCHANGE.OPEN` | **false** | the interlock — the window is SHUT until cash → $OMR is retired | ships shut; `test/tokenomics.js` fails the suite if it opens while the AMM buy side still works |
| `EXCHANGE.RATE` | 500 | cash paid per $OMR burned | anchored at the AMM genesis spot; fixed while cash inflates, so review each season |
| `EXCHANGE.DAILY_CAP_OMR` | 250 | per account, rolling 24h | the wash-cap token bucket |
| `EXCHANGE.FUND_BPS` | 3000 | share of the street take that fills the till | **diverts nothing today** — `carveExchange` returns 0 while the window is shut. When it opens this is a real 30% reduction of buyback revenue (stake pool + family split + event fund all shrink) — re-sim then |
| `FAMILY_YIELD.FUND_BPS` | **0** | share of each buyback carved to the family pot | ships at 0, so the buyback splits exactly as before. This is the MIGRATION DIAL: raise it as `stake:reward`/`dividend:omr` are retired, or the yield pays twice |
| `FAMILY_YIELD.SEATS` / `WEIGHTS` | 5 / 5-4-3-2-1 | who splits the pot, by this season's standing | the Commission-levy weighting |

**§10.4:** `window:burn` is an $OMR BURN, `window:payout` a character_id'd cash FAUCET bounded by the
pool, `yield:family` a pure pool→reserve TRANSFER (both sides already in `omrBuckets`). New real-value
invariant `exchange pool backed` (paid ≤ funded) proves the cash side is a redistribution rather than
inflation — the `runVigInvariants` shape. Sim drift-0.

**The one thing to know before opening the window:** the design's claim that arbitrage is impossible
"by construction" is true only once cash → $OMR is gone. Until then a fixed-rate window is a money
pump whenever AMM spot sits below `RATE`. That is why `OPEN` is false and why the interlock is a test.

## TOKENOMICS v2 STEP 2 — the two signed levers that moved (2026-07-28)

`test/levers.js` pins every founder-signed number and fails the suite when one moves without
being re-pinned in the same commit. Two moved here, both deliberately, both part of the same
interlocked change (design `omerta-tokenomics-v2-design.md` §2 and §7.2):

| lever | was | now | why |
|---|---|---|---|
| `EXCHANGE.OPEN` | `false` | `true` | The redemption window was shipped SHUT because a fixed-rate window beside a live cash → $OMR buy side is a money pump. Step 2 retires the AMM in both directions, so the pump has no fuel and the window opens. This is the interlock DISCHARGED, not bypassed — `test/tokenomics.js` asserts the two are never both live, from both directions. |
| `EXCHANGE.FUND_BPS` | `3000` | `10000` | The street-tax pool used to be spent buying $OMR off the AMM. There is no AMM, so the window is the take's only destination; leaving a share behind would grow a pile of dead cash and make the window needlessly thinner. The rule is now simply "every cut the house takes in the city is what the window pays out". |

**Neither is a balance retune of a measured curve** — no faucet rate, income figure or drop weight
moved. They are the two switches that turn the pivot on.

**Still owed (design §7 step 5): THE RE-SIM.** The whole cash economy was balanced against an
extraction threat model — cash reaching $OMR reaching a market — that no longer exists. Every
"sim + sign-off" faucet flag in this file needs re-reading in that light, because a cash faucet is
now a purely internal number. That is the real prize of the pivot and it has NOT been done.

---

## TOKENOMICS v2 STEP 3 — the float's four-way bond split (2026-07-28)

Step 3 points `rwa_revenue` — the pot the stock-buy bot draws on — at the two sources design §6
names: the DEX sell tax's 4-point slice and a new slice of bond ETH. The tax slice needed no signed
lever to move (there was no off-chain sell-tax accounting at all before this). The bond split did.

| lever | was | now | why |
|---|---|---|---|
| `BONDS.RWA_BPS` | — | `2500` | NEW. Design §4's own number. Bond ETH is PRIMARY inflow — it arrives whether or not anyone is trading — so it is what keeps the float growing when DEX volume is thin. And a quiet market is precisely what the one-way conversion produces, since gameplay no longer manufactures sellers. The design calls the omission of this slice "the single largest gap in the original proposal". |
| `BONDS.DEV_BPS` | `2000` | `1500` | Design §4's own number, taken as written. |
| `BONDS.POL_BPS` | `5000` | `3750` | The remainder after the two fixed slices, keeping the signed 5:3 POL:VIG relationship (see below). |
| `BONDS.VIG_BPS` | `3000` | `2250` | Same remainder, same ratio. |

**The one judgement call, flagged for the founder.** Design §4's table gives the whole remaining
6000 to LP and shows no Vig slice at all. I did not take that literally, for two reasons. The
sentence directly beneath that table names `BONDS.POL/VIG/DEV_BPS` — so the author knew the Vig
slice existed and still produced a table without it, which reads as an oversight rather than a
decision. And taking it literally would DEFUND the withdrawal reserve: `vig_revenue` →
`runVigBuyback` → `fundReserve` → the full-reserve queue is the chain a player's $OMR withdrawal
travels, and in v2 that is the only real-value exit anyone has. The asymmetry decided it — shipping
a slightly thinner LP than designed is recoverable; shipping a withdrawal queue that cannot sign is
a product failure players feel immediately.

**If the Vig slice really is meant to go, it is one line:** `BOND_POL_BPS=6000 BOND_VIG_BPS=0`. The
load-time sum check keeps any setting honest, and `runBondInvariants` reconciles POL + Dev + Vig +
RWA against the principal on every real bond.

**No faucet moved.** This re-routes real ETH between out-of-band destinations; it writes zero
`transactions` rows and touches no §10.4 vocabulary. `test/tokenomics.js` asserts that directly —
a full re-sourcing cycle leaves the ledger row count unchanged.

**The step-5 RE-SIM is still owed** and this drop does not touch it.

---

## TOKENOMICS v2 STEP 4 — the contracts, and the three numbers that now bound supply (2026-07-29)

Step 4 is the on-chain half. It moves no in-game faucet and writes no `transactions` row — but it
introduces the three most consequential numbers in the system, because they are what replaced a
property that used to need no number at all. **Until this drop OMR had no mint function**, so the
answer to "how much OMR can exist?" was a constant. It is now a policy, and these are its dials.

| lever | value | what it bounds | verdict |
|---|---|---|---|
| `OmertaBond.dailyCapOMR` | **set at deploy** | OMR issuable per UTC day. With no tranche bounding the total, this is the ENTIRE blast radius of a leaked quote-signer key. **`0` means UNLIMITED** — a deploy that forgets it has no daily wall at all. | SET IT DELIBERATELY SMALL FOR LAUNCH |
| `OmertaBond.maxOmrPerEth` | **set at deploy** | The post-discount mint RATE. **Fail-closed at 0** (the GearVault gear-cap precedent), so an unconfigured deploy cannot bond rather than bonding at any price. Doubles as a kill switch — `setMaxRate(0)` stops issuance without a pause. | KEEP FAIL-CLOSED |
| `MAX_DISCOUNT_BPS` | `2000` (compile-time) | A discount is a mint at a price; an unbounded discount is a mint at any price. Must equal the backend `BONDS.MAX_DISCOUNT_BPS`. | KEEP |
| `SELL_TAX.BPS` / `DEV` / `RWA` / `LP` | `900` = 200 / 400 / 300 | The DEX sell tax and its three-way split, replacing the old 50/50 dev/buyback. Hard-capped at 1000 (10%) in the contract. LP takes the remainder so the shares sum EXACTLY. | KEEP (founder-directed 9%) |

**The honest note on wall 3, because it is a deviation and should not be discovered by an auditor.**
Design §4 calls this wall "accretive-only": mint only when the ETH received is worth at least the OMR
issued. Read literally that forbids **every discounted bond** — a discount is by definition issuing
OMR worth more than the ETH paid — so the literal wording and the product contradict each other. The
real (Olympus) meaning is treasury-BACKING accretion: reserves ÷ supply must not fall. That is not
checkable in this contract. It custodies nothing — every wei is forwarded in the same transaction —
so it cannot know treasury reserves without an oracle, and an oracle on the mint path would become
the thing standing between a leaked key and unbounded supply. So wall 3 ships as a hard, Safe-set
ceiling on OMR-per-ETH: **weaker as economics, stronger as a wall.** Backing accretion belongs in the
off-chain policy that decides what price to sign, where it can read the whole treasury and where
getting it wrong costs a bad bond rather than the token. Flagged in the contract header, in
`CHAIN-DEPLOY.md` gate 2, and here.

**The founder decision this leaves open:** what `dailyCapOMR` and `maxOmrPerEth` should actually be.
Both are deploy-time and both are properly a function of the step-5 re-sim, which is still owed —
the daily cap wants to be sized against real bond demand, and the rate ceiling against the price the
buy-side policy expects to sign. Until then they are "set them small" rather than a recommendation.

**Mainnet is unchanged and still gated** on the third-party audit (whose clock this drop RESET — see
`CHAIN-DEPLOY.md` §0.2) and legal counsel. Gate 1 (`forge test`) is green at 77/77.

---

## TOKENOMICS v2 STEP 5 — THE RE-SIM (2026-07-29)

The design's step 5: *"the entire cash economy was balanced against an extraction threat model that no
longer exists. Every 'sim + sign-off' faucet flag needs re-reading in that light."* Done — measured by
a new `tools/sim.js` **P9.23**, and re-read below. **No lever was retuned.**

### The finding, and it is categorical rather than numerical

**Cash can no longer reach the token. At all.** `invariants.js:omrMints` is the enumerated set of
everything that can create $OMR — `mission:%`, `prize:omr`, `emission:%` — and **not one of them takes
cash as an input**. Step 2 deleted the swap and the laundering surface; there is no direct path and no
laundered path through a third asset. So this is not a measurement that could come out differently
next quarter; it is a property of the code that a §10.4 check enforces.

### What that does to the flags

Every cash faucet in this document carried, explicitly or not, two worries. They now separate cleanly:

| the worry | status |
|---|---|
| **"this faucet becomes sell pressure"** — a big cash income is one swap from the token price | **MOOT.** The path is gone. A bigger cash faucet now costs game balance and nothing else. |
| **"this faucet breaks pacing or concentrates wealth"** | **STILL LIVE, and now the only question.** Nothing about it got easier. |

So the open faucet flags are not resolved — they are **reduced in stakes and narrowed in scope**. The
passive stack (P9.20), the apex world/boxing/racing purses, the port sale curve, the `npc:seed` recycle
(P9.21) and the co-op raid throughput all remain founder calls about **pacing and concentration**. What
changed is that getting one wrong is now a game-design problem, recoverable by a retune, rather than a
token-holder problem.

### The $OMR side, now genuinely separable

With cash out of the picture, token supply is decided by exactly three things and they are all bounded:
the **wage** (fixed schedule, halving, lifetime endowment cap, minted-accounts-only), **bonds** (four
walls, and after this session an oracle that tracks the market), and the **sink catalog**. P9.22's
standing finding is unchanged and remains the most important number in the token model: **the Exchange
window absorbs a few percent of emission until the base is in the thousands**, so the real exit is the
sink catalog (which comfortably covers the wage) and, for real value, the reserve-backed chain
withdrawal. `FUND_BPS` / `RATE` / `EPOCH_OMR` are the levers, in that order of directness. Founder call.

### A measurement trap worth recording

P9.23's first cut split cash reasons into faucets and sinks by net sign, and **reported `gang:tribute`
as a $120,000 "sink" for cash that had simply moved into a treasury and still existed**. Mirrored
transfers (`gang:tribute`, `convoy:toll`, `port:toll`) are ledgered ONCE — the character's negative row
— and the treasury credit is *derived* by negating it (`invariants.js` `tributeIn`/`tollIn`/
`portTollIn`). The probe now splits by `character_id` the way the invariants themselves do, and says
plainly that the gang figure is "gang-bound rows", not the treasury delta. Same lesson as always: a
measurement that looks authoritative and is subtly wrong is worse than no measurement.

---

## THE BOND DIALS — sized (2026-07-29)

`OmertaBond.dailyCapOMR`, `maxOmrPerEth`, `priceToleranceBps` and `OmrTwapOracle.PERIOD` were all unset
and all block a real deploy; CHAIN-DEPLOY.md said "set them small", which is advice, not a number.
Derived in **`tools/bond-dials.js`** (`npm run dials`) — pure arithmetic, reads the real constants, no
server or chain. **Re-run it whenever POL materially deepens**: three of the four move with pool depth.

### The threat model, stated once
These walls exist for exactly one attacker: someone holding the quote-signer key. They can sign
anything — but they must still **pay the ETH** (`bond()` requires `msg.value == principal`) and still
**sell the OMR** to realise anything. So the question is never "how much can they steal", it is *how
much better than market can they buy, how much can they buy, and what do they net on the way out*.

### Recommended

| dial | recommendation | why |
|---|---|---|
| **`dailyCapOMR`** | **≈5% of the pool's OMR reserve** — ~27,000/day at a 100-ETH pool | A RULE, not a number, because pool depth is the binding constraint. Sized so a full day at the cap, entirely dumped, moves the price ≤10%. |
| **`maxOmrPerEth`** | **~15,000** (3× the launch price) | A circuit breaker, not a price. The honest max rate is ~6,563; 3× never binds in normal trade but does bind on a manipulated feed. |
| **`priceToleranceBps`** | **500 (5%)** | A TWAP lags spot; zero rejects honest quotes exactly when the market moves. Second-order — see below. |
| **`OmrTwapOracle.PERIOD`** | **30 min** (floor is 10) | Past 30 min the cost curve flattens for a thin pool while lag grows. |
| **`maxOracleAge`** | **90 min** with a 30-min keeper | 3× the poke interval: tolerates two consecutive misses and no more. |

### Four findings, two of which changed the recommendation

**1. "% of supply" is the wrong anchor and would have been ~4× too loose.** My first pass sized the cap
at 0.05% of supply (50,000/day). But a 50,000 dump into a 100-ETH pool makes OMR **19% cheaper in a
day**, and 100,000 makes it **40% cheaper** — while both are a rounding error against supply (0.05%,
0.1%). Price impact, not dilution, is the damage that matters, and it is a function of *pool depth*.
The recommendation above is the inverted form of that.

**2. Do NOT read the attack going loss-making as a defence.** At a 100-ETH pool a 500,000-OMR haul
realises **−32 ETH** — the exit craters the price it is selling into and the 9% tax takes the rest. It
is tempting to call the cap self-limiting. It is not: **a griefer does not need to profit**, and anyone
short elsewhere profits from the crash rather than from the bond. Size on damage, never on attacker P&L.

**3. `MAX_DISCOUNT_BPS` is first-order; the oracle tolerance is second.** At the 20% cap a leaked signer
already buys OMR **25% under market** before touching any feed. Beating the TWAP by 5% adds a few points
on top. So the tolerance is not the wall that matters — `maxOmrPerEth` and the daily cap are.

**4. The 9% sell tax is also an anti-manipulation tax.** Moving the oracle *upward* requires *selling*
OMR, which pays the DEX tax, and the round trip never recovers it. Most tokens' TWAP-manipulation cost
is slippage alone; here it is slippage **plus a hard 9%**. That was not the tax's purpose and is worth
knowing before anyone proposes lowering it.

### Flagged — not dials, and not changed

- **There is no MINIMUM vest.** `OmertaBond` checks only `vestSeconds == 0 || > MAX_VEST`, and the quote
  (which the attacker signs) chooses it — so a leaked signer sets `vestSeconds = 1` and claims a second
  later. `claim()` also has no `whenNotPaused`, so pausing does not stop a claim either. Neither is a
  hole alone; together they mean **the daily cap is realised immediately**, which is the assumption the
  cap is sized under above. For an honest bonder the server sets the full 120h, so vesting is a *product*
  feature and not a security control — the point is not to count it as one.
  **RESOLVED 2026-07-29 (`AUDIT-oracle.md`): do NOT add one.** The tempting reasoning is that a minimum
  vest slows an attacker and buys response time. It buys neither. `claim()` not being `whenNotPaused`
  means a vest is not a window in which the Safe can intervene, only one in which the attacker waits;
  and the blast radius is `dailyCapOMR` whatever the vest is — a vest changes WHEN the capped amount
  lands, not HOW MUCH, and the sizing above already assumes immediate realisation, which is the
  conservative reading. A floor would buy a false sense of a security control while constraining only
  the honest path. Written into CHAIN-DEPLOY.md so nobody later counts it as a control.
- **`quoteBond` clamps to the CEILING, not the oracle price.** When our feed reads above the chain's, it
  signs at `oracle × (1+tolerance)` — the most generous quote the wall allows — so drift always resolves
  toward *more* OMR per ETH. Clamping to the oracle price itself resolves it the other way. Defensible
  either way; worth deciding deliberately.
  **RESOLVED 2026-07-29 (`AUDIT-oracle.md` F1): clamp to the PRICE — and it turned out not to be only a
  question of taste.** `round6` rounds, and it rounds *up* **50.0% of the time** (measured over 200k
  samples; also the theoretical answer), so a price rounded to the ceiling sat one micro-unit ABOVE it
  and reverted `PriceAboveOracle` on-chain — roughly every OTHER clamped quote failing, on the code path
  that exists to prevent failures. Clamping to the oracle price leaves the whole tolerance band as
  headroom so rounding cannot breach it, AND resolves drift in the conservative direction. Both reasons
  point the same way; the arithmetic is pinned in `test/chain.js`.

### The thing that is not a dial at all
Every number here scales with **pool depth**. Thin liquidity is what makes an oracle cheap to move and a
cap expensive to raise. The strongest available action for these walls is not a setting — it is **POL**.

## THE MIGRATION SWEEP — dangling ends of tokenomics v2, closed (2026-07-29)

A reader sweep over all 379 signed levers (alias-resolved, comments stripped — the method is now
`test/levers.js` check 4) found the migration's leftovers. The moved lever and the flags:

| lever / finding | was | now | why |
|---|---|---|---|
| `FAMILY_YIELD.FUND_BPS` | 0, **read by nothing** | **500** (5% of every Window redemption) | Its documented source — "a share of each 12h buyback's bought $OMR" — was deleted by step 2 (the buyback buys no $OMR), so the family yield shipped funded by a one-time legacy drain and then nothing, forever. Re-homed founder-directed: redemption is the only place $OMR now goes to die, so the families take their cut of the money changing hands. §10.4-neutral (a `yield:window` TRANSFER replacing a slice of the `window:burn` — no new reason, both already vocabularied). **The honest cost is less deflation** — at FUND_BPS 500, 5% of redeemed $OMR survives as family reserve instead of burning. Dial: 0 restores full burn. |
| **The dark risk layer** (FLAG, founder sign-off) | fronts drew Bureau raids via laundering scrutiny | **no front can ever be raided** | Business scrutiny grew ONLY from laundering; step 2 retired laundering, so nothing writes scrutiny and the whole Business Empire step-two PvE risk layer is unreachable (`business:raid` can never fire). A front's remaining risk is PvP only (shakedown / hostile takeover / the Sacking). Passive fronts are now strictly SAFER than the curve was balanced against — the L1a/L1b flatten assumed the old risk surface. Options: (a) accept — PvP is the risk model now; (b) re-source scrutiny from INCOME (a front heats by earning); (c) trim the curve again. Not patched (ground rule #1). |
| Decorative levers, wired | `CONSTANTS.SEARCH_MS`, `SKILLS.CAPSTONE_COST`, `CASINO.RING.IDLE_MS` duplicated as magic numbers | each now the single source of truth | Retuning them previously changed nothing — the 3h search clock was hardcoded in combat.js, the capstone cost hardcoded per tree entry, the ring idle timeout a SQL literal. |
| Dead levers, marked | 6 step-2 orphans looked live | marked DEAD in place + exempted in the guard WITH reasons | `AMM_LP_BPS`, `STAKE_POOL_BPS`, `LAUNDER_HEAT`, `BUSINESS_LAUNDER_HEAT`, `BUSINESS_SCRUTINY_PER_CAP`, `PUBLIC_WASH_CAP_DAY` — kept for the record, read by nothing, each with a stated reason so the exemption itself cannot rot. |
| Console false copy | the Empire tab sold "PRIVATE laundering" + per-tier wash figures + "launderable" $OMR | removed | A player was making the purchase decision for a front on a capability retired in step 2. |

Levers: `FAMILY_YIELD.FUND_BPS` 500 is a founder sign-off lever (pinned; sized small because the cost
is deflation). The full-balance redemption edge (float re-round) is regression-tested at a
measured-triggering value — the hazard fires on ~13% of 6dp amounts, so a "realistic-looking" fixture
proves nothing.
