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
| rwa | 20% | → `rwa_revenue` — **the TREASURY's inflow ledger.** Was earmarked for a real-stock float; that layer was retired 2026-07-31 (see § THE STOCK LAYER RETIRED). Bps and plumbing unchanged, destination is now a treasury Safe. | KEEP |

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

## Addendum — THE STREET WAGE (**RETIRED 2026-08-01** — economy v3 step 1: kill the faucet)

> **This section is HISTORY.** The wage is gone: `emission.js` is a tombstone, the rules block and its
> five levers are deleted, and `invariants.js` now asserts that no NEW `emission:%` row appears
> (`emission faucet retired`). It went because v3's first wall is **no faucet** — zero mint reasons
> that pay a player, which makes "extraction ≤ inflow" an identity the ledger exhibits rather than a
> constraint the reserve queue enforces — and because the measured Sybil economics below never came
> good. The numbers are kept for the record; none of them is a live lever.


| Lever | Default | Note |
|---|---|---|
| `EMISSION.ENDOWMENT_OMR` | 1,000,000 | lifetime emission ceiling (mirror on-chain in E2) |
| `EMISSION.EPOCH_OMR` | 500/day | day-one budget (a CEILING — unearned budget is never minted) |
| `EMISSION.DECAY` / `DECAY_EVERY` | 0.5 / 180 | the halving schedule (~6 months) |
| `EMISSION.WAGE_CAP_OMR` | 5 | per-account/epoch cap — spreads the pot, bounds Sybil concentration |
| `EMISSION.WAGE_MIN_LVL` / `WAGE_MIN_SCORE` | 5 / 25 | the anti-login-bot floor (respect gain is energy-bounded) |

*(Historical note, kept because it explains the retirement: the wage was the ONLY scheduled mint and
`emission within endowment` was its hard wall. The launch-messaging question it raised — re-deriving
"what a day's grind pays" in real money before any copy mentions earning — is now moot on this axis,
since there is nothing to earn from the protocol. It still applies to anything v3 pays out.)*

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
carries the cash rail's `$MIN_CASH` floor; `claimVaulted` (the RWA float) was minted-only — the whole
claim rail is now RETIRED (see § THE STOCK LAYER RETIRED); `duel_wins`
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

> **⚠ SUPERSEDED 2026-07-31 — every figure in the table above is too high.** Re-running the harness
> at THIS commit's own `src/`, with the harness's measurement code confirmed unchanged and the same
> config defaults, gives **2h → 12 · 5h → ~19 · 10.5h → level 33**, not 14–16 / 26 / 44. Nine
> measurements (three at HEAD, one each at the two harness revisions, four across market seeds)
> all land at 33–34, so the row is not variance and not a later regression — the numbers here were
> never reproducible. See **§ THE 7-DAY SOLO CEILING** at the end of this file for the bisect.
> The findings drawn from this run (energy is vestigial; the gym/mission cooldowns are the throttle)
> are unaffected — those are *shapes*, and they reproduce.

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
zero contact with another player — a 45-min-twice-a-day player reaches ~~level 44, $1.9M, 14/28 of
the story in 7 days~~ → **corrected 2026-07-31 to level 33, $1.39M, 13/28** (see the ⚠ note above
and § THE 7-DAY SOLO CEILING). The *shape* of the finding is unchanged: a solo player gets a long
way alone and never meets anybody.

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
| **The dark risk layer** — **RESOLVED 2026-07-30** (founder-directed option b) | fronts drew Bureau raids via laundering scrutiny; step 2 left the layer unreachable | **scrutiny is INCOME-sourced — a front heats by earning** | `BUSINESS_SCRUTINY_PER_INCOME_DAY` (30) heat per full operating day's income banked, tier-NORMALIZED, so raid PROBABILITY is uniform across the catalog while the raid's COST scales with size (the seized pending + 10% of tier cost). Measured (sim P9.24): a daily collector is raided ~every 10.1 days ≈ 11–12% of gross at every tier; the 5-front stack pays ~$4.24M/day on top of the L1b pad (net ~$21.6M→~$17.4M/day); a vigilant collector who banks often faces only the fine floor (~2% of gross) — the lazy/active spread is the intended shape. THE ACCOUNTANT (income heat ×0.5) + THE FIXER (fine ×0.5, decay ×2) are un-retired — the Bureau-facing specs buy a real effect again. §10.4 unchanged (`business:raid` was always a ledgered sink; the seized pending is never minted). Dial: `PER_INCOME_DAY` (0 restores the dormant state). See the section below. |
| Decorative levers, wired | `CONSTANTS.SEARCH_MS`, `SKILLS.CAPSTONE_COST`, `CASINO.RING.IDLE_MS` duplicated as magic numbers | each now the single source of truth | Retuning them previously changed nothing — the 3h search clock was hardcoded in combat.js, the capstone cost hardcoded per tree entry, the ring idle timeout a SQL literal. |
| Dead levers, marked | 6 step-2 orphans looked live | marked DEAD in place + exempted in the guard WITH reasons | `AMM_LP_BPS`, `STAKE_POOL_BPS`, `LAUNDER_HEAT`, `BUSINESS_LAUNDER_HEAT`, `BUSINESS_SCRUTINY_PER_CAP`, `PUBLIC_WASH_CAP_DAY` — kept for the record, read by nothing, each with a stated reason so the exemption itself cannot rot. |
| Console false copy | the Empire tab sold "PRIVATE laundering" + per-tier wash figures + "launderable" $OMR | removed | A player was making the purchase decision for a front on a capability retired in step 2. |

Levers: `FAMILY_YIELD.FUND_BPS` 500 is a founder sign-off lever (pinned; sized small because the cost
is deflation). The full-balance redemption edge (float re-round) is regression-tested at a
measured-triggering value — the hazard fires on ~13% of 6dp amounts, so a "realistic-looking" fixture
proves nothing.

## THE TRADES (mastery expansion, step one — 2026-07-29)

Founder-directed ("expand the trait and stat system significantly... RuneScape-like farming"), design
`omerta-mastery-design.md`. Step one is a PURE STATUS axis — ten use-XP tracks fed at 24 existing hook
sites through `bumpMastery` (the bumpStanding twin), zero `transactions` rows, zero gameplay power —
so it sits entirely outside §10.4 and the sim-audited balance (the hitman-rep argument). Every lever
below becomes LOAD-BEARING in later steps (milestone perks / paths v2 / stat drip), which is why they
are recorded now:

| lever | value | note |
|---|---|---|
| `MASTERY.XP_DIVISOR` / `MAX_LVL` | 15 / 50 | level = √(xp/15)+1 — at the measured crime pace (~60/hr) L10 ≈ 7h focused, L25 ≈ 2 days, L50 RuneScape-99 territory |
| `MASTERY.XP` (per action) | crime 3 … fire 25 | sized ~proportional to each action's existing resource cost (nerve/energy/cash/cooldown) so XP-per-resource stays comparable across tracks and no track is the one true farm. **XP sources add NO new action** — every point rides an action that already paid its cost |
| `MASTERY.HEIR_KEEP_BPS` | 2500 | **softens death** (the standing flag class — MEMORY_BPS / HONOR.HEIR_KEEP precedent): the heir keeps 25% of each track's XP. 0 restores hard death |
| `MASTERY.RANKS` / `LEGEND_RANKS` | display bands | pure status |

**Flag (step-two gate):** before milestone perks land, re-check the XP table against the playthrough
harness — a perk ladder makes XP/hr a power number, and the table was sized for status only.

## THE TRADES step two — milestone perks + the level-50 trait (2026-07-29)

**The step-2 gate check ran first and forced an XP retune** (the flag predicted this: once perks
exist, XP/hr is a power number). Measured analytically at the loops' real cadences:
The Gambler ran **4×–40× larceny** (dice = 1 nerve/play at 6 nerve/min = 720 XP/hr; the Madame's T1
comp removes even that → rate-limit-bound ~7,200 XP/hr, L40 in ~3 hours of min-bet spam), while the
cooldown-gated tracks starved (Big Scores L25 measured **~4,700 hours** — unreachable). Applied:

| lever | was → now | why |
|---|---|---|
| den XP (dice/blackjack/numbers/trackbet) | 2 → **1** each | the fastest feed, halved |
| `MASTERY.GAMBLER_MIN_STAKE` | — → **1000** | a play under $1,000 schools NOTHING — kills the comped min-bet farm; at $1k+ the house edge prices the fast track (~$50k/hr at the rate limit) |
| score/heist | 8/20 → **25/60** | 8h-cd / daily ops — sized to the loop's natural cadence |
| bout/exhibition | 8/5 → **25/20** | 6h exhibition cd; bouts need a willing rival |
| cook/deal | 6/4 → **12/6** | batches are slow clocks |
| race / port / piracy / duel | 8/10/12/8 → **15/20/25/10** | cooldown / supply-capped / rival-gated |

**The perks** (`MASTERY.PERKS`, one axis per trade, deepening at L10/25/40; every effect a NEW
single-touchpoint multiplicative modifier OFF the audit-locked list — pacing clocks, sink discounts
with the DISCOUNTED number ledgered, contest mults on the bruiser precedent, table-limit ACCESS with
odds untouched; signed floors re-assert after mults). **Flagged stacks** (each an existing flagged
class, now one deeper): larceny jail × getaway (0.85×0.8 = 0.68 fully built), wetwork search clock ×
executioner × Vinnie (0.72 → **0.54** fully built — the deepest stack in the game, sign-off),
commerce fees × broker (LIST_FEE_MIN still floors), muscle atk × bruiser × made_man (1.08×1.08×1.06).
The gambling axis raises only the PvE LIMIT (more exposure per play at unchanged house-favorable
odds → deepens the net sink).

**The trait** (level 50, once, permanent, dies with the street): VIRTUOSO deepens the perk to fx[3];
DYNAST echoes **`MASTERY.TRAIT_HEIR_BPS` (5000 = 50%)** of that ONE trade to the heir instead of the
25% — a death-softening dial on top of HEIR_KEEP_BPS (the standing flag class; 2500 reverts it).

## THE TRADES step three — PATHS v2 (six careers with teeth, 2026-07-29)

The catalog went 3→6 through the machine-owned seam (prototype edit + re-extract — the car-catalog
precedent); the hand-written `PATH_FX` matrix is the teeth. Founder-chosen axis: **progression
speed** — home trades school ×`PATH_XP_HOME` (1.5), rival trades ×`PATH_XP_RIVAL` (0.6, fractional
XP so the penalty never rounds away) — plus ONE signature perk and ONE handicap per path, every
effect a single-touchpoint multiplier off the audit-locked list. The same action always pays the
same MONEY except where a perk/handicap is itself the money lever, flagged below:

| path | perk | handicap | home ×1.5 | rival ×0.6 |
|---|---|---|---|---|
| The Gun | jump ×1.1 · hit eff ×1.15 *(unchanged)* | **goods sales ×0.95** (smaller faucet) | Wet Work, Protection | Commerce, The Cook |
| The Ledger | racket ×1.1 · goods ×1.05 *(unchanged)* + **front income ×1.1 — the M4 promise, real at last** | jump ×0.95 | Commerce, Big Scores | Wet Work, Protection |
| The Kitchen | quality +0.15 · deal heat ×0.75 *(unchanged)* | jail ×1.1 | The Cook, Larceny | The Gambler, Fisticuffs |
| The Wheel | convoys ×0.9 time | cook time ×1.15 | Wheels, Seamanship | The Cook, The Gambler |
| The Shadow | search clock ×0.85 | duels/bouts ×0.95 | Larceny, Wet Work | Fisticuffs, Commerce |
| The Ring | duels/bouts ×1.05 | Doc bills ×1.15 | Fisticuffs, The Gambler | Seamanship, Big Scores |

**Flags:** (1) `frontIncome` ×1.1 widens the L1a-flattened front curve ~10% for ONE path choice
that also carries the soft-hands handicap — at the maxed 5-front stack that is ~+$2.2M/day for a
Ledger player (dial: the fx entry). (2) The search clock now stacks FOUR deep (executioner × Vinnie
× wetwork-perk × Shadow = **0.46** fully built — the deepest stack in the game). (3) The switch
cooldown `PATH_SWITCH_CD_MS` (7d) exists because home/rival XP rates make career-hopping between
activities a rate arbitrage the 25 $OMR burn alone doesn't price; the first pick starts the same
clock. The three ORIGINAL paths' pre-v2 numbers are byte-identical through the ternary→matrix
conversion (asserted in test/mastery.js).

## THE TRADES step four — stats by use (the founder-signed fork, 2026-07-29)

Founder answered the third design fork "yes, tightly capped": working a trade also exercises its
core stat. Every XP-paying action rolls +1 to the track's stat (`MASTERY.STAT_USE` — `P_PER_XP`
0.02 per XP point paid, capped at 0.5/roll) on THE GYM'S OWN diminishing factor
(`GYM_DIM/(GYM_DIM+stat)` = the exact `200/(200+stat)` train() uses, so use-training can never
outpace the gym's shape), metered by a hard rolling daily bucket (`CAP_DAY` 3 — the D3
wash/port token-bucket pattern, columns `characters.statuse_used/statuse_at`, charged with the
full-unit-fits gate so a burst can never leak CAP+1). Actor path only — headless bumps (duel
opponents, heist crew) honestly skip the drip rather than silently lose it.

**Why this is NOT a second gym (the death-of-the-gym non-risk, measured):** the gym pays
~40 pts/hr at the 3-min cooldown; the drip is hard-ceilinged at **≤3/day** whatever you play —
~2 orders of magnitude apart. Stat points ARE power (they feed the signed contest formulas), but
the cap bounds the total inflation at +3/day/street regardless of action volume, and the gym-dim
factor shrinks it exactly where stats are already high. Zero §10.4 surface (a stat is not a
currency; every roll is rng-audited `statuse:<track>`). `STAT_USE_P` is TEST-ONLY (the LAW_BUST_P
precedent, classified in preflight).

| lever | value | note |
|---|---|---|
| `MASTERY.STAT_USE.CAP_DAY` | 3 | the hard daily ceiling — 0 turns the fork off |
| `MASTERY.STAT_USE.P_PER_XP` | 0.02 | roll chance per XP point (a 3-XP crime ≈ 6% before dim) |
| `MASTERY.STAT_USE.GYM_DIM` | 200 | the gym's own curve base — keep in lockstep with train() |

**Playthrough re-run (the design's step-4 requirement, 2026-07-29):** with the drip LIVE the
pacing holds — 2h at the keyboard ≈ level 12, 5h ≈ 20, 10h ≈ 33; the 7-day solo ceiling is
level 34 / $1.4M / 13 of 28 missions (the level-240 speedrun stays closed). The drip's worst case
is ≤3 stat points/day on top of a gym session training ~40/hr — invisible at the pacing scale,
exactly the intent.

**Red-team flags (AUDIT-trades.md — founder sign-off, NOT patched):** (1) the path XP multiplier
COUPLES to the stat drip (a home trade trains its stat ~1.5× faster, still inside CAP_DAY —
retuning `PATH_XP_HOME` moves stat-training speed too); (2) fists bout XP (25) and duel wetwork XP
(10) have NO opponent-quality floor, unlike the legends they sit beside — alt-feeding schools the
mastery at ~the rake's cost (levels die with the street, perks are pacing-only, so blast radius is
small; the dials are the duel pair/day decay or a stake floor); (3) the DYNAST trait is PER-TRACK —
a street maxed in several trades can dynast-mark each, compounding the `TRAIT_HEIR_BPS`
death-softening echo (a one-line per-character uniqueness gate in chooseTrait if one-dynasty-trade
is the intent).

## THE REFERRAL ENTRY FIX (§7.13 — the missing type-in path, 2026-07-30)

Founder report from the live funnel: a new user was never allowed or prompted to TYPE the name of
who sent them — attribution rode only the invisible `?ref=` link stash, so every word-of-mouth
recruit ("check out OMERTÀ — tell them Vito sent you") credited nobody, and a miss at creation was
lost forever. Three changes, all attribution-only (every payout still rides the full §7.13
qualification gates, so the Sybil posture is unchanged): **(1)** the create screen gained a
"who sent you?" field (prefilled by a ?ref link so link arrivals see it working; a typed name
beats the stash), with the server matching exact-then-case-insensitive and the response saying
whether it landed (no more silent drops); **(2) THE LATE CLAIM** — `POST /v1/referral/claim`
lets a recruit name their referrer within `M4.REF_CLAIM_WINDOW_MS` (72h) of ACCOUNT creation,
once, while unset — surfaced as a "did someone send you?" card on Start Here; **(3)** the ops
funnel gained `referral.lateClaims` so a high count reads as "the create-screen field is being
missed". `REF_CLAIM_WINDOW_MS` is a founder sign-off lever (longer = friendlier, slightly wider
retro-attribution surface; the payouts are qualification-gated either way).

## THE REGIMEN (expanded training — five disciplines + trainer drills, 2026-07-30)

Founder-directed ("the training system is way too basic… more stats to train and develop that get
interwoven into the game… daily quests picked up from NPCs"). Five DISCIPLINES beyond
muscle/cunning/speed, trained on the SAME `train_at` gym clock as the core stats — **breadth,
never rate**, so the PACING pass's throughput wall holds by construction (a discipline session and
a core session spend the same slot and the same 10 energy). One trainer DRILL per Underworld
fixture per day (seed-drawn off the §7.11 hash; progress READ from `daily_progress.counters` —
zero new counting surface) pays `DRILL_XP` on claim. XP is not a currency — the whole system
writes ZERO transactions rows (proven in test/regimen.js) — so §10.4 is untouched; the LEVERS are
the five touchpoints, each a NEW single-site modifier off the audit-locked list:

| lever | value | what it does | posture |
| --- | --- | --- | --- |
| `REGIMEN.CAP` | 25 | discipline level ceiling | pacing |
| `REGIMEN.XP_DIVISOR` / `XP_MIN` / `XP_MAX` | 15 / 8 / 12 | the quadratic curve + per-session band (~lvl 10 ≈ 152 sessions ≈ weeks on the 3-min clock) | pacing |
| `REGIMEN.ENERGY` | 10 | session cost (same as a core stat) | pacing |
| `REGIMEN.DRILL_XP` | 25 | a claimed drill ≈ 2.5 sessions, once per fixture per day — the engaged-day bonus | pacing |
| stamina (Roadwork) | +1 max energy/level | `energyCapOf` — at cap +24 energy (~2 extra gym/garage actions per refill); widens the DAY, not any payout | KEEP |
| composure (Steady Hands) | +1 max nerve / 2 levels | `nerveCapOf` — at cap +12 nerve (~1–2 extra crimes per refill window); the crime CASH curve per attempt is untouched, this widens the pool the regen fills | **the one throughput-adjacent dial** — nerve REGEN (6/min) is unchanged, so sustained crimes/hr is regen-bound exactly as the pacing pass measured; the wider pool only deepens a BURST. Sim re-measured drift-0 |
| conditioning (Iron Chin) | −1%/lvl off the Doc's bill, floor 0.75 | `heal()` — a discount stack like doctors_friend (0.75) × Doc T1 (0.9); the discounted number is the ledgered number | KEEP |
| marksmanship (The Range) | +0.6/lvl to YOUR duel score | `DUELS` contest — at cap +14.4 vs VARIANCE 30; ELO self-corrects (a better shooter climbs to opponents who beat him), the wager stays the audited casino:pvp transfer | KEEP |
| presence (Work the Room) | +1/lvl to the DAILY standing budget | `bumpStanding` cap — widens what an ENGAGED day can earn with the fixtures, never what a script earns free (the cap still binds); gifts stay cap-exempt/GIFT_CAP-bound | KEEP |

Death: `character_disciplines` + `npc_drills` DIE WITH THE STREET (estate wipe + DISPOSITION) —
no heir echo (deliberately harder than THE TRADES' 25%: disciplines are the BODY, not the craft).
Drills draw only from self-sufficient bumpDaily kinds (crime/train/gta/goods/melt/heist), so every
drill is doable alone on day one. Mickey the Corner trains your WEAKEST (the round-out trainer).

## THE HUSTLE + THE MARK (crime-loop interactivity, 2026-07-30)

Founder-directed ("crimes… have to be always PvP or send the user down a checklist of things to do
around the town… move around the map and talk to NPCs"). Two pieces. **THE MARK** — every §7.2 job
now NAMES a victim, drawn from the NPC residents standing in your district (real characters — the
population layer) with a fictional noir-pool fallback; PRESENTATION ONLY, zero value moves.
**FLAGGED FOR SIGN-OFF (not built): the "always PvP" variant** — making the crime take its cash
FROM the named mark's pocket converts the sim-signed §7.2 crime FAUCET into a §10.4 TRANSFER
(residents' seed pool becomes the source, `npc:seed` recycling becomes the real faucet, and every
crime-EV number in this file changes). That is a full economy redesign of the core loop — a
founder decision, not a patch. **THE HUSTLE** — the daily three-stop chain: meet the contact
(travel), do the legwork (travel + a real drawn action there, verified as a counter DELTA so
stockpiled morning work can't pre-pay it), collect the payoff (travel). The payoff is the one new
faucet: `hustle:payoff` = max(`HUSTLE.PAY_MIN` $600, `HUSTLE.PAY_PER_LVL` $200 × level), ONCE a
day per street (the (character, day) PK is the cap). Analytic ceiling: $6k/day at level 30,
$12k/day at 60 — under the Daily Score at the same level and ~petty vs every measured earner
(the clue-casket posture: the MOVEMENT is the product, the money is the excuse). Both levers
pinned in test/levers.js; §10.4: `hustle:` joined the cash vocabulary, the payoff is
character_id'd so check (a) reconciles.

## THE PEN step six — THE YARD LIVES (in-sentence activities, 2026-07-30)

Founder-directed ("Jail or The Pen get really repetitive when the only level action to do is just
Work"). Three activities, all §10.4-FREE — the whole step writes ZERO transactions rows (test-pinned):
XP and pacing are not currencies. **THE IRON PILE** trains the PHYSICAL disciplines
(stamina/conditioning/composure) through the SAME regimen path on the SAME shared gym clock — the
`{ fromYard }` opt waives ONLY the jail gate (the burner precedent), so jail never trains faster than
the street, it just stops being dead time; the street gym route stays jail-gated. **CARDS WITH THE
CREW** — `PEN.CARDS_ENERGY` (5) energy → gambling mastery XP (`MASTERY.XP.cards` 4; no money on the
blanket — the guards take real cash games, so the den's GAMBLER_MIN_STAKE wall is untouched).
**THE YARD CHARACTER** — a seed-drawn fictional inmate (the Broadcast fictional-names posture), one
conversation per day (`pen_talks` day-PK): wisdom pays `PEN.TALK_WISDOM_XP` (15) composure XP, the
trusty's shortcut shaves `PEN.TALK_CUT_S` (120s — the workYard good-behaviour shape, pacing never
currency), a war story pays `MASTERY.XP.yardtale` (10) to the teller's trade. All three levers are
founder sign-off dials; none touches the signed pen:work faucet or any audit-locked surface.

## JAILBIRDS (the bust verb gets a target, 2026-07-30)

Founder-reported: the daily "Bust a player out of lockup" contract was uncompletable on a solo run —
residents never went to jail, and the §7.8 bust verb had no console control (raw deck only). Fixes:
a "bust them out" button on any LOCKUP-chipped street in the Wet Work roster, the corrected daily
how-line (any jailed street, not "a family member"), and `POPULATION.JAILBIRDS` — the worker keeps
`TARGET` (2) residents serving a `MIN_S`–`MAX_S` (4–20 min) sentence, refilled as they walk or are
sprung. Pure `jail_until` pacing, zero new §10.4 reason. **The faucet it makes reachable is the
SIGNED §7.8 `bust:reward`** (500 + remaining×15, odds 0.7 − remaining/400 floored at 0.10): the
curve pays best near the end of a stretch, so rational play camps the tail — ~$1.4–2.3k a bust at
40–55% odds, a miss costing the buster 3 minutes inside. Bounded by the refill: ≤ TARGET busts per
worker tick ≈ a few $k/hour CITY-WIDE, shared — the clue-casket posture. `JAILBIRDS.*` are founder
sign-off levers; `TARGET: 0` turns the whole thing off.

## THE CAREER (post-First-Week progression ladder, 2026-07-30)

Founder-directed ("Once you complete The First Week there should be another list of tasks in
progression … receive bonuses upon completion … that takes them throughout the game"). Five ranks —
Associate → Soldier → Made Man → Capo → The Don — six once-ever tasks each, every task a
SERVER-VERIFIED signal (ownership, an account legend, mastery XP; nothing client-claimed). Rewards
are CASH ONLY (the v24 rule) and latch once per ACCOUNT (`career_claims` PK, survives death — the
heir keeps the climb and cannot re-farm), so the whole faucet is a FIXED lifetime total:
tier-1 tasks pay $1,000 (+$3,000 capstone), then $2,500/+$7,500, $5,000/+$15,000, $10,000/+$30,000,
$20,000/+$60,000 — **$346,500 lifetime max per account**, spread across a climb whose later ranks
demand level-40-class play. `CAREER.NEED` (4) claims open the next rank, so a declinable task
(a family, blood) never walls a solo player; the capstone pays only on all six. Every payout is a
ledgered `career:<taskId>` cash faucet row (character_id'd — §10.4 check (a) reconciles). Petty vs
every measured earner (the clue-casket posture: the TOUR of the game's systems is the product, the
cash is the excuse); task cash values + `CAREER.NEED` are founder sign-off levers.


## THE BUREAU RETURNS — income-sourced front scrutiny (the dark-risk-layer resolution, 2026-07-30)

Founder-directed option (b) from the tokenomics-v2 migration sweep: business scrutiny's only feed
(laundering) was retired by v2 step 2, leaving the Bureau-raid layer wired up but unreachable — no
personal front could ever be raided, so the passive stack was strictly safer than the L1a/L1b curve
was balanced against. A front now HEATS BY EARNING.

**Mechanism** (`business.js:addIncomeScrutiny`, called at collect + at the upgrade's pending-bank):
`heat += BUSINESS_SCRUTINY_PER_INCOME_DAY × banked / (incomePerHr × 24)` — TIER-NORMALIZED, so every
front runs the same heat per operating day and the raid's COST scales with the size of the operation
on its own (a raid seizes the pending — never ledgered, the territory-seize precedent — and fines
`BUSINESS_RAID_FINE_RATE` (10%) of the tier cost, the existing ledgered `business:raid` sink).
Heat is income-normalized, not per-collect, so cadence cannot game the heat itself; what frequent
collection DOES buy is a small seized pending — the active-play out.

| lever | value | note |
|---|---|---|
| `CONSTANTS.BUSINESS_SCRUTINY_PER_INCOME_DAY` | **30** | heat per full operating day's income banked; 0 restores the dormant state |
| decay / threshold / p / fine | unchanged | `BUSINESS_SCRUTINY_DECAY_HR` 1, `BUSINESS_RAID_THRESHOLD` 60, `BUSINESS_RAID_P_PER_MIN` 0.0005, `BUSINESS_RAID_FINE_RATE` 0.10 — the signed raid math is untouched |

**Measured (sim P9.24 — an expected-value walk of the daily-collector cycle mirroring
`resolveScrutiny`'s exact math; re-run on any retune):** a daily collector is raided ~every
**10.1 days** at every tier — laundromat t3 $170k/day (10.9% of gross) up to casino t3 $2.18M/day
(12.1%); the **5-front stack pays ~$4.24M/day (11.8% of gross)** on top of the L1b progressive pad,
taking the stack's net from ~$21.6M to ~$17.4M/day. A vigilant collector who banks several times a
day faces only the fine floor (~$660k/day across the stack ≈ 1.8% of gross) — risk rewards
attention, the higher-variance-not-higher-EV intent.

**Un-retired with it:** THE ACCOUNTANT (income heat ×0.5) and THE FIXER (raid fine ×0.5, decay ×2)
specs — refused while the layer had no feed, purchasable again now they buy a real effect
(`business:spec` $OMR burn unchanged). §10.4: zero new reasons — the fine rides the existing
`business:raid` sink, the seized pending was never minted, and the sim stays drift-0.


## THE STREET WAR & THE RIVALS LEDGER (founder-directed 2026-07-30)

Founder: "Crimes should also directly target the assets of users at random — PvP … Rob Player X's
Laundromat … a Rivals system to track crimes and players that have shown malice to you … Cars should
be able to get stolen." Design: `omerta-street-rivals-design.md`. The §10.4 record, load-bearing:
**this drop adds ZERO new emission** —

- **Rob a front** (`business:rob`) is a REDIRECT of the venue's PENDING income (the audited shakedown
  mechanism at half the rate: owner keeps the rest pending, the clock advances by only the stolen
  share), and rob + shakedown share ONE per-venue window (`businesses.shakedown_at`, 8h) — so the
  per-venue extraction BOUND is exactly what the signed shakedown audit assumed (max 30% per 8h).
  The reason rides the existing `business:` prefix — zero invariants.js change.
- **Steal a car** moves a ROW — cars conserve by row count (the chop/pink-slip/market-seize
  precedent), no ledger row, no currency. The thief's clock is the signed §7.5 `gta_at` window
  (no new farm cadence).
- **The Rivals ledger** moves NOTHING — pure intel over acts whose existing notify already NAMES the
  aggressor (jump / shakedown / rob / car theft / hostile takeover / a fire-kill). Anonymous acts
  stay anonymous; the $OMR peek/trace remain the only piercers.

| lever | value | note |
|---|---|---|
| `RIVALS.ROB_RATE_BPS` | **1500** | 15% of pending — half the shakedown's 30%, on the SAME shared window |
| `RIVALS.ROB_ENERGY` / `ROB_HEAT` / `ROB_JAIL_S` | **8 / 6 / 300** | cheaper + pettier than the shakedown; a failed rob is JAIL (it's a crime), not a beating |
| `RIVALS.VICTIM_MIN_LVL` | **8** | rookie protection, rob + theft both (the npcHit-floor posture) |
| `RIVALS.CAR_THEFT.BASE_P/STAT_SCALE/ALARM_DIV` | **0.35 / 300 / 3000** | `p = clamp(BASE + (cun+spd/2)/SCALE − √carVal/ALARM_DIV, MIN_P, MAX_P)` — expensive iron protects itself (an apex car floors at MIN_P) |
| `RIVALS.CAR_THEFT.MIN_P/MAX_P` | **0.05 / 0.7** | the clamp |
| `RIVALS.CAR_THEFT.ENERGY/JAIL_S/HEAT` | **10 / 600 / 10** | heat win or lose; a miss is 10 min in lockup |
| `RIVALS.CAR_THEFT.VICTIM_SHIELD_MS` | **24h** | a player loses at most ONE car per day to theft, however many thieves try |
| `RIVALS.RETENTION_D` | **90** | grudges older than a season fade off the ledger |

Grief bounds, each one deliberate: the shared 8h venue window (rob can never stack on top of a
shakedown), the GTA clock, the victim shield, the rookie floor, `GARAGE_CAP` refusal, listed/pledged
iron escrow-locked, hospitalized/witpro/family off-limits. **No new faucet → no new sim probe**
(the sim stays drift-0 with the drop live). `CAR_THEFT_P` is a TEST-ONLY roll knob
(preflight-classified, the BUSINESS_RAID_P precedent). Step-two roadmap (trunk goods, boat theft,
residents as marks, revenge teeth, rival-aware coach/Wire) is founder picks — design doc §4.


## THE STREET WAR step two — trunk robbery, boat theft, sabotage, residents-as-marks, revenge, rival-aware surfaces (founder-directed 2026-07-30)

Founder: "Build step two" (design §4). Five pieces; the only NEW emission is the residents-as-marks
set, each deliberately bounded and sized against the sim:

| lever | value | note |
|---|---|---|
| `RIVALS.TRUNK.ENERGY/HEAT/JAIL_S/SHIELD_MS` | **8 / 5 / 300 / 24h** | trunk robbery — a goods OWNERSHIP move (zero ledger rows), capped by the robber's free trunk space; one landed robbery per victim per day |
| `RIVALS.BOAT_THEFT.ENERGY/JAIL_S/HEAT` | **10 / 600 / 10** | at the docks only; shares the CAR_THEFT p-curve (boat cost as the alarm value), the GTA clock, AND the vehicle shield (`car_stolen_at` — ONE vehicle a day, car OR boat) |
| `RIVALS.SABOTAGE.ENERGY/HEAT/JAIL_S/INJURY_MS/SHIELD_MS` | **8 / 5 / 300 / 4h / 12h** | lays up ONE random fit racer/fighter (pure `injured_until` pacing, zero §10.4); BOOKED fighters untouchable (a main-event card's frozen form stays honest for the crowd's money) |
| `RIVALS.REVENGE_HONOR` | **2** | striking a recorded rival while still NET OWED (their ledger count > yours) pays honor — judged BEFORE the strike records, so a strike can't count against its own claim; kills excluded (the vendetta owns those). The residual slow pair-trade rides the accepted honor-farm posture (the loan-repay precedent) |
| `RIVALS.WIRE_RIVAL_MULT` | **0.5** | tapping a man who wronged you costs half (the discounted number is what's burned — the tradecraft discipline); reveals nothing the mark didn't already announce |
| `POPULATION.MARKS.FRONT_INCOME_BPS` | **500** | the sleepy-joint scale: a resident front's pending prices at 5% of the catalog curve, and only ever REALIZES through the shared-window rob/shakedown/inside redirect (residents never collect). **Sized by sim P9.25**: the first default (1000) measured a ~$683k/day shakedown-cadence ceiling — ~2× the NPC-trucking parity band — so it shipped at 500 (~$342k/day worst case across ~16 sleepy joints) |
| `POPULATION.MARKS.CAR_P/CAR_VAL/FRONT_P/FRONTS/BOAT_P` | see rules tail | which bands own what: made/capo/boss beaters ($800–$20k), laundromat t1/t2 + restaurant t1 fronts, capo/boss dinghies. Cars ride the car-conservation invariant via `rng_audit` `npc:car` grant/retire rows; a dinghy's $24k resale × ~2.8/day turnover ≈ **$68k/day** ceiling; beaters ~11/day at a ~$4.4k mean (melt realizes well under half) |
| `POPULATION.MARKS.GOODS_BPS/GOODS_MAX_UNITS` | **1000 / 10** | resident freight is RECYCLE-ONLY (bought with their own seed cash at the real `goods:buy` rail + take) — the robbery realizes what the resident already paid; the budget floor keeps them clear of the picked-clean turnover line |

**§10.4 record:** zero new reasons anywhere — the trunk/boat/sabotage verbs move ownership or pacing
(no currency); resident fronts realize through the EXISTING `business:rob`/`business:shakedown`/
`heist:inside` redirects at the scaled pending; resident cars extend the car-conservation identity
with two explicitly counted `rng_audit` terms (grants + retires); **the Sacking SKIPS npc victims**
(a free catalog front on a kill would skip the buy sink and then earn the FULL curve — kill-farming
residents for fronts would be a value spawn). Revenge honor is a pure status axis. Sim P9.25 prints
all the marks ceilings every run so any retune is re-measured; drift-0 with the whole drop live.

**Honest framing (AUDIT-street-life, lens A):** `TURNOVER.PER_DAY` meters the `npc:seed` faucet
ONLY (~$499k/day at the weighted mean seed). The resident ASSET faucets ride their own bounded
curves ON TOP: the marks front redirect (~$342k/day worst case), boat resale (~$68k/day) and beater
melts — so **the honest total resident-extraction ceiling is the SUM (~$900k/day base-wide across
every extraction verb), not "PER_DAY × mean seed" alone.** All ledgered, all bounded, no drift —
`FRONT_INCOME_BPS`/`TURNOVER.PER_DAY`/the boat/car maps are the dials if the additive total wants
trimming. Related note: `death:legacy` heir stakes ($500 + $100×prestige) top up the drainable seed
pool OUTSIDE the turnover ceiling — bounded by `RETIRE_GENERATIONS` (6) per line and kill cadence,
not player-extractable directly (the stake lands on the NEW resident), §10.4-clean.

## STREET LIFE — the corner boards, the black book, the call (founder-directed 2026-07-30, task #318)

Founder: "more tasks located in each area… push you into conflict or meet other players… phone
numbers discoverable via meeting or intel… contacts give you quests / requests… the broadcast
button doesn't fit — repurpose or remove." Design: `omerta-streetlife-design.md`. One new petty
faucet, one recycle-only transfer pair, one zero-§10.4 discoverability layer, one chrome removal.

| lever | value | why |
|---|---|---|
| `CORNER.PER_DAY` | **3** | tasks each district posts a day (seed-drawn, town-wide per district) |
| `CORNER.MAX_DAY` | **5** | claims per street per day ACROSS districts — **the hard faucet bound** |
| `CORNER.CASH` | **400** | per envelope → ceiling **MAX_DAY × CASH = $2,000/day/street** (sim P9.26) |
| `CORNER.RESPECT` | **15** | the XP per envelope (75/day ceiling — level 5 ≈ 160 respect, so meaningful early, garnish later) |
| `CORNER.POOLS` / `CONFLICT` | per-district maps | bumpDaily kinds ONLY (zero new counting surface); one `jump`/`bust` conflict pick GUARANTEED per draw |
| `CONTACTS.CALL_FREIGHT_PREMIUM_BPS` | **11500** | a contact pays base × 1.15 for delivered goods — FROM THEIR OWN POCKET (recycle-only, the npc:seed stock) |
| `CONTACTS.CALL_FREIGHT_MAX_QTY` | **8** | request size cap |
| `CONTACTS.VISIT_TIP` | **750** | the "come see me" tip (clamped to the contact's pocket) |
| `CONTACTS.CALL_TTL_MS` | **24h** | an unanswered request lapses (worker sweep) |
| `CONTACTS.GEN_PER_TICK` | **4** | worker placement bound; ONE open call per street (the PK) |

§10.4: `corner:job` is a character_id'd cash FAUCET (check (a) reconciles, hard-bounded above);
`contact:freight`/`contact:visit` are pure two-leg TRANSFERS with counterparty (test-pinned to net
zero — a request never conjures value at fulfilment; an unaffordable freight demotes to a visit at
generation, a robbed-blind contact VOIDS the request at fulfilment). The black book (`contacts`,
account-keyed both sides) and the `no_number` DM gate move no value. The 📣 broadcast button was
REMOVED (founder option) — the share loop lives in the brag prompts + My Profile, both `?ref`-carrying,
so §7.13 attribution is untouched.

**Post-audit tightenings (AUDIT-street-life, all inside the levers above — no new lever):** one
envelope per KIND per day (`done_kind` — one action could otherwise cash every same-kind slot on
the map; MAX_DAY stays reachable via distinct kinds), the freight pay re-clamps to the LIVE price
× premium at fulfilment (the frozen quote was a free option across the daily price drift), and the
visit tip is FIXED — a contact who can't cover it doesn't call (a sub-tip pay encoded the NPC's
exact pocket). The covert opt-out (`{ meet: false }` on npcHit/burnerHit/exposeSecret) keeps the
black book from revealing what the game hides.

### THE FAVOR — the player-posted call (step two, task #320)

Escrowed player-to-player freight requests. **No new faucet, no new sink** — the escrow moves the
poster's own cash to a runner, and the only value that leaves is the house cut carved from the pay.

| lever | value | why |
|---|---|---|
| `FAVOR.MAX_OPEN` | **3** | open requests per poster — bounds parked escrow per street |
| `FAVOR.MIN_PAY` / `MAX_PAY` | **500** / **250,000** | the floor keeps dust off the board; the ceiling bounds one loot target |
| `FAVOR.MAX_QTY` | **20** | units per request (a runner's trunk has to cover it) |
| `FAVOR.TTL_MS` | **24h** | unrun requests refund by the worker sweep |
| `FAVOR.TAKE_BPS` | **200** (2%) | carved FROM the pay, half → street tax / half burns — the market/speakeasy rate. Posting to your own alt is strictly LOSSY, which is the anti-collusion property |
| `FAVOR.NOTE_MAX` | **90** | the public note (angle-brackets stripped) |

§10.4: `favor:` joined the cash vocabulary + a new **`favor escrow`** check (`posted − paid − takes
− refunded − death − loot`, the market's shape verbatim). The loot-proof-vault rule is enforced both
ways — posting is safehouse-blocked, and a player fire-kill takes `CASH_LOOT_RATE` (25%) of a dead
poster's open escrow (`whack:loot` + a NULL `favor:loot`), the remainder burning `favor:death`.

### THE STREET WAR step three — THE TAKE + revenge with teeth (task #322)

Founder-directed 2026-07-30, **explicitly including the transfer**. The headline is a re-SOURCING of
crime, not a retune: the payout a player receives is unchanged (the sim-signed §7.2 band), but when
there is somebody in the district to take it from, that cash comes off THEM instead of appearing.

| lever | value | why |
|---|---|---|
| `RIVALS.TAKE.POCKET_BPS` | **2500** | at most 25% of the mark's pocket per job — nobody is cleaned out in one hit, and the decay is geometric, so crime alone never walks a resident to the turnover threshold |
| `RIVALS.TAKE.MIN` | **50** | below this the transfer is dust and the faucet just pays it |
| `RIVALS.REVENGE_ATK_MULT` | **1.10** | a strike settling a debt you are still net owed carries the hand — attack only, never the mark's defence |
| `RIVALS.REVENGE_CUT_MULT` | **1.5** | a revenge ROB takes 22.5% (15% × 1.5), still under the shakedown's signed 30%, on the SAME shared per-venue window |
| `POPULATION.MARKS.STAKE_BPS` | **1500** | what a resident will put on one bout/match: 15% of their own pocket |
| `POPULATION.MARKS.FIGHTER_P` / `RACER_P` | **capo .4 / boss .6** | capo+boss only — a `made` resident's seed cannot cover the $5,000 system floor |

**The take is an emission REDUCTION, and that is the point.** Every funded dollar is a TRANSFER
(both legs ledgered `crime:take`, netting zero) that would otherwise have been a `crime:<id>` FAUCET
row. `crime:` was already in the cash vocabulary and both legs carry a `character_id`, so the
per-character check reconciles it with **zero `invariants.js` change**. Total funded is bounded by
the same metered resident seed pool P9.21 sizes (~$499k/day of replacement) — so it can only ever
shrink crime's contribution to supply, never widen it. Measured every run at **sim P9.27**.

**Honest about the magnitude: the theme is permanent, the economics decay.** A district holds a
handful of residents, and 25% per job means ~7 successful jobs against the same mark walks them from
their arrival stake down past the turnover system's "picked clean" line. So an active grinder empties
their district's pockets fairly quickly, after which the faucet pays as it always did and the mark is
narrative only. That is the intended shape — the take is a re-sourcing and a piece of texture, NOT a
re-plumbing of where crime's money comes from base-wide, and it should not be described as one. It
also means the take will push the resident turnover meter (`POPULATION.TURNOVER.PER_DAY`) toward its
cap sooner; that meter is the bound, and once it is spent drained residents simply stay drained.

**Marks are NPC RESIDENTS only, and that line is deliberate.** A real player gets no consent, no
notification and no counterplay from a stranger's crime roll. Taking from a player is what the gated
PvP asset crimes are for (rob a front, steal a car, mug the trunk) — shielded, cooldowned, and
written into the rivals ledger so the victim knows who to answer.

**The revenge cut is rob-only** because boosting a shakedown would push past its signed 30% ceiling,
and the venue clock advances by the SAME boosted rate — otherwise the redirect would hand the owner
back income that had already been taken, and stop being emission-neutral.

### THE CHAIN, THE LADDER, THE STANDING (step two, task #321)

Three additions on the corner + the book. **No new §10.4 reason** — the chain bonus rides the
existing `corner:job` faucet, and the ladder and the standing move no value at all.

| lever | value | why |
|---|---|---|
| `CORNER.CHAIN_STEPS` | **3** | separate DAYS working one district's corner — what makes it a week, not an afternoon |
| `CORNER.CHAIN_BONUS` | **1,500** | the block's thank-you: 3.75× a single envelope for three days of showing up |
| `CORNER.CHAIN_RESPECT` | **40** | the XP with it |
| `CONTACTS.RANKS` | 6 tiers, 0 → 150 lines | a badge on how many numbers you hold — display-only, derived from a COUNT |
| `CONTACTS.STANDING_TIERS` | 4 tiers at 0/3/8/20 jobs | how ONE contact treats you: qty ×1.0 → ×3.0, tip ×1.0 → ×2.5 |

**The chain's faucet is bounded by the claim, not added to it.** The bonus is folded into the
COMPLETING claim's own ledger row (the First-Week capstone precedent), so a chain never adds an
envelope. **Measured (sim P9.26, printed every run):** a chain advances at most once per district
per day and needs a real claim there, so advances/day ≤ `min(districts 6, MAX_DAY 5)` = 5 and
completions/day ≤ 5 ÷ `CHAIN_STEPS` = 1.67 — **~$2,500/day + ~67 respect/day on top of the corner's
$2,000 + 75**, and only for a street that keeps five separate corners running. (The naive
`MAX_DAY × CHAIN_BONUS` bound is unreachable: a chain cannot complete twice at one district in a
day.) A second envelope in the same district on the same day pays as an envelope and does NOT
advance the chain. *(Corrected 2026-07-31, `AUDIT-favor-street-life-two.md` F5: the
`÷ CHAIN_STEPS` above was optimistic while a completing chain DELETEd its row — a second claim that
day then found no row, skipped the once-a-day check and took step 1 immediately, so at steady state a
district completed every TWO days and the real bound was 5 ÷ 2 = 2.5. The chain now resets IN PLACE
stamped with today, which makes the code match the figure rather than the figure match the code.)*

**The standing scales the ASK, never the source.** A regular is asked for a bigger load and tipped
better, but generation still skips a request the contact cannot cover and fulfilment still
re-clamps to their live pocket — so recycle-only holds at every tier, and the resident-extraction
ceiling is unchanged (it is bounded by the seed pool, not by how well they know you).



---

## THE STOCK LAYER RETIRED — the vault is backed with ETH (founder-directed 2026-07-31)

Design: `omerta-stock-layer-retirement.md`. **No lever moved.** This is recorded here because it changes
what four signed bps are FOR, and a reader of this file should not have to find that out from a diff.

> "Instead of buying back RWA stock the treasury can hold ETH instead." → **the stock layer goes away.**

The game will not acquire, hold, allocate or deliver real tokenized equities. The float's wall was
`allocated ≤ held` — the game only ever owes stock it already owns, in UNITS — which works only while both
sides of the ledger are the same asset. Backing a stock-denominated claim with ETH was rejected on
substance: legally it turns handing over an asset you own into a cash-settled payout on one you do not,
and mechanically the treasury goes short exactly when players claim. So the cut was **remove the promise,
keep the accounting.**

| Slice | bps | Was | Now |
|---|---|---|---|
| `STORE.SPLIT_BPS.rwa` | 2000 | buy real stock | the treasury |
| `TREASURY.FEE_TREASURY_BPS` (env `FEE_RWA_BPS`) | 1000 | " | " |
| `SELL_TAX.RWA_BPS` | 400 | " | " |
| `BONDS.RWA_BPS` | 2500 | " | " |

**Every bps is unchanged** — only the destination is. Changing them is a separate balance decision, and
folding them into POL/Dev/Vig would silently move real money between destinations.

**The founder amended it the same day: "keep the vault and back it with ETH."** That is not a weaker
version — `allocated ≤ held` never depended on the asset being stock, it depended on the asset being the
SAME on both sides. ETH-for-ETH restores the property exactly and deletes the only thing that could ever
break it. Nothing acquires or owes stock either way.

**What went:** `runRwaBuyback` + `POST /v1/mod/rwa/buy` (nothing needs buying — ETH arrives directly),
the `rwa_reserve`/`rwa_buys` tables, the per-ticker stock oracle + `RWA_MAX_PRICE_JUMP` + the
cross-ticker budget lock (all of them guarded the bot's price input), and the bot invariants
(`held == Σ buys`, cost basis). `src/rwa.js` became `src/treasury.js`; `GET /v1/mod/rwa` →
`/v1/mod/treasury`.

**What stayed, re-denominated:** the vault (`GET`/`POST /v1/vault*`, `claimVaulted`, the console card),
`allocated ≤ held` **in ETH on both sides**, and the claim levers — which meter $OMR, not the backing
asset, so the re-denomination did not touch them:

| Lever | Value | What it does |
|---|---|---|
| `TREASURY.CLAIM_MIN_OMR` | 25 | claim floor — below it the 6dp grid and the ledger row cost more than the claim |
| `TREASURY.CLAIM_DAILY_OMR` | 2000 | per-ACCOUNT rolling cap: one house cannot sweep the vault in a day |
| `TREASURY.CLAIM_WINDOW_MS` | 86400000 | the bucket refills continuously over 24h (the D3 wash-cap shape) |

`rwa_vault (account_id, ticker, units)` became `eth_vault (account_id PK, eth, cost_omr)`; still
account-level, so it still survives death. **Allocation only — nothing is delivered**, and delivery is a
separate decision (unlike the stock version, it would be a transfer of an asset the treasury owns).

**Also stayed:** `rwa_revenue` (the treasury's inflow ledger — the table name is historical; renaming it is
migration risk for no benefit), `recordSellTax` + `sell_tax_events`, and the anti-fabrication `txHash` gate
(a comp/QA call still books ZERO, because "the treasury received this much ETH" must never be assertable
by a mod route).

**R1, the in-game Portfolio, is UNTOUCHED** — `invest`, the deterministic §7.11 hash price, the dividend
pools (`rwa_dividend_pool` / `rwa_family_dividend_pool` are **in-game $OMR**, not the float), dynasty
naming, tiers, landmarks, leaderboards. It was always pure status with no sell and no cash-out. §10.4 is
untouched on that side (`rwa:invest` / `rwa:dynasty` burns and `dividend:` transfers all unchanged).

**Open founder question, flagged not decided:** the Portfolio uses REAL ticker symbols (AAPL, TSLA, GLD,
HOOD, NVDA, SPCX, AMZN, GME) for a purely fictional collectible with a made-up price. That was defensible
while a real-stock rail existed behind it. Keep them as flavour, or move to fictional tickers so nothing
implies a player owns something.

---

## THE CREW BONUS — referrals stop paying $OMR (founder-directed 2026-07-31)

> "In the referral system no longer promise to give away $OMR but instead each referral becomes like an
> XP multiplier depending on what level they are and it scales."

**Retired:** `M4.REF_FUND_OMR` (4) / `REF_RECRUITER_OMR` (3) / `REF_RECRUIT_OMR` (1), and the milestone
ladder's `omr` field (the constants are deleted; the field stays in the MACHINE-OWNED
`RECRUIT_MILESTONES` table per ground rule #2 and is simply no longer read). Cash payouts — the spark,
the full recruiter/recruit cash, milestone cash, the tier-2 finder's fee — are **unchanged**; the
founder named $OMR, and cash is a separate decision.

**What replaces it:** every QUALIFIED recruit makes their recruiter earn respect faster, scaled by the
recruit's CURRENT level.

| Lever | Value | What it does |
|---|---|---|
| `M4.REF_XP.STEP_LEVELS` | 5 | a recruit's level counts in whole steps of this |
| `M4.REF_XP.PER_STEP` | 0.05 | each step is worth this much multiplier (level 5 → +5%, 10 → +10%, 15 → +15%) |
| `M4.REF_XP.MAX_BONUS` | 1.0 | **hard ceiling on the SUM across the whole crew** (+100%) |

**Why the cap is not optional.** Respect drives level, level gates content, and the PACING pass
deliberately slowed levelling. An uncapped bonus across a large crew would walk straight through that
work. At the cap a recruiter earns at most double — a real edge, not a different game.

**Why this is safer than the $OMR it replaces:**

- **Not a currency.** Respect writes no ledger row, so this has **zero §10.4 surface** — the referral
  system stops touching the token economy altogether.
- **Live, never banked.** Recomputed from the crew's current levels on every read (`loadOwned` →
  `gainRespect`). A recruit who dies drops to their heir's level and the bonus falls with them; a
  recruit who quits stops paying. It rewards recruiting people who actually play, which is the whole
  point of a referral programme.
- **Unsellable.** It cannot be gifted, traded or laundered — which is exactly what made a $OMR payout
  worth farming.
- Every existing anti-Sybil gate still applies: qualification (L8 / 40 jobs / 3 check-ins / $25k net
  worth), agents and NPC residents excluded at the source in the loadOwned query, once ever per recruit.

**Applied through ONE helper** (`game.js:gainRespect`), used at all 12 respect-granting sites across six
modules. A bonus some sites apply and others quietly do not would make the number on the sheet a lie.
Headless paths (a duel opponent, a heist crew member written under their own lock) have no loaded
context and correctly degrade to the base amount.

Surfaced as `crewBonusPct` on the character sheet and in My Profile's take box. All three numbers are
founder sign-off levers.

## THE 7-DAY SOLO CEILING — level 33, and there is NO drift (bisected 2026-07-31)

`tools/playthrough.js` was re-run after the onboarding/progression batch (#304 REGIMEN, #305 the coach
road to 30, #306 Pen step six, #308 CAREER, #310 HUSTLE, jailbirds). Three samples, same config
(2 sittings/day × 45 min × 7 days = 10h30m at the keyboard): **level 33 / 34 / 33**, $1.39–1.42M,
13 of 28 missions.

That is ~25% below the **level 44 / $1.9M / 14 missions** this file and the codex had recorded, and my
first reading of it — written into this section earlier the same day — called it a real regression that
"moved 25% without anyone deciding to move it". **That was wrong, and the bisect is what proved it.**

The method matters, because the first attempt at it was itself broken. Holding the *harness* constant
and varying only `src/` requires wiping `src/` first: `git checkout <C> -- src` LEAVES files added
after C, which produced a hybrid tree (old `schema.sql`, new `engagement.js`) that failed on a missing
column — a failure that looks like a finding and is not one. With that fixed, and the harness's own
measurement code confirmed unchanged across its three revisions (only reporting was added):

| what was varied | result |
|---|---|
| HEAD, three runs | 33 · 34 · 33 |
| `src/` at `c013494` (the second harness revision) | **33** |
| `src/` at `2c60c06` — the commit where 44 was RECORDED | **33** |
| four different market seeds at HEAD (city-event luck) | 34 · 33 · 33 · 33 |

Nine measurements, all 33–34, including at the exact commit the 44 was written down at, with identical
config defaults (7 days × 2 sittings × 45 min, unchanged since the harness was built). **The game never
produced 44 with this harness.** The recorded figure is not reproducible under any variation available —
neither code age nor seed draw — so it was a transcription or a differently-configured one-off written
down as the default.

**Nothing is wrong with the curve, and no lever should move on account of this.** 33 at a week of
plausible solo play is the actual shape, and it has been the shape since the pacing pass.

**The lesson is the reusable part: a number in a doc is not a measurement.** I compared today's run
against an unverified historical figure and reported a regression off it. Before calling anything a
drift, re-measure the baseline at the old commit — it costs ~80 seconds per run here and it falsified
the claim outright.

`tools/scale.js` was re-run in the same pass: 36 players / 5 days, **§10.4 held across all 24 checks
with zero movement**, every one of the 9 driven markets reachable, and the census reconciles with the
flow. The one market that ended empty (black-market goods lots) CLEARED — everything posted was taken.

---

## THE JAILBIRD FAUCET — measured, flagged, NOT retuned (2026-07-31)

**What this is.** The onboarding batch's JAILBIRDS drop (task #308) added no reason and no formula.
It keeps `POPULATION.JAILBIRDS.TARGET` (2) residents serving a sentence so the §7.8 bust verb and its
dailies are completable on a solo run — the founder-reported dead end. What it *did* do is make the
pre-existing **`bust:reward` faucet reachable on demand**, and that faucet had never been sized against
a manufactured supply of prisoners. The drop's own note estimated "a few $k/hour shared."

**Measured (`tools/sim.js` P9.28, printed every run, computed from the live constants):**

| | |
|---|---|
| reward line (signed, §7.8) | `500 + remaining × 15` — **linear** in the sentence |
| success chance | `clamp(0.7 − remaining/400 + busts×0.03, 0.10, 0.90)` — **floors at 10%** |
| ⇒ best sentence to camp | **1200s** (`MAX_S`) → **$18,500** at 10%, EV **$1,850/attempt** |
| attempts before it walks | 7 (a failed bust jails you `BUST_FAIL_JAIL_S` 180s, and a jailed player can't bust) |
| ⇒ expected per bird | ~$9,652 (52% land) |
| **city-wide ceiling** | **~$463k/day** (TARGET 2 × 24 hourly worker ticks) |

**Why the estimate was an order of magnitude low:** it did not carry the reward's linear term in
`MAX_S`. The reward keeps growing with the sentence while the chance *floors*, so the two never
offset — the longest spawn is always the most profitable, and the clamp makes that strictly true.

**The other thing that makes it unusual:** the loop spends **no signed resource**. No energy, no
nerve, no ammo — only the 180s fail-jail. Every other faucet at this scale is resource-metered; this
one is only time-metered.

**NOT retuned (ground rule #1).** Both numbers that set it are the founder's: the `500 + r×15` line is
the SIGNED §7.8 faucet, and `JAILBIRDS.MAX_S` is a sign-off lever. Three dials, in increasing
invasiveness:

1. **`JAILBIRDS.MAX_S` 1200 → ~400.** Cheapest, touches nothing signed. Caps the top reward at $6,500
   and lands the chance near the un-clamped part of the curve, so skill starts mattering again.
2. **`JAILBIRDS.TARGET` 2 → 1.** Halves the ceiling; also halves how reliably the daily is completable,
   which is the thing the drop exists to fix.
3. **A jailbird-specific reward scale** — the `MARKS.FRONT_INCOME_BPS` precedent, where resident-owned
   fronts pay a *fraction* of the catalog curve precisely because the NPC never collects. Most
   faithful to intent (a manufactured prisoner is worth less than a real one), most work.

Shared city-wide and first-come, so it is one player's income only in a thin alpha — **which is
exactly the condition it was built for**. `M3.BUST_FAIL_JAIL_S` (180) is now pinned in
`test/levers.js`, since it alone sets the attempt count the ceiling is computed from.

## THE COACH'S SOCIAL BAND — two rungs a solo player can never clear (2026-07-31)

`M3.COACH_SOCIAL_BAND_LVLS = 8` — **new founder sign-off lever**, pinned in `test/levers.js`.

Wiring `tools/playthrough.js` to actually OBEY the coach (rather than only record it) made this
visible in one run. With the Kitchen rung cleared, **"Pull a crew score" took 77% of a seven-day
solo run** and masked eight downstream rungs — the Den, the fights, the races, the first front, the
Port, the Wire, going legit — every one of which the same player could have acted on that minute.

It is **not** the F1 defect. The rung is honest advice, and it clears the moment there is a crew.
But a crew heist needs a second body, and a duel needs somebody listed on the ladder, so on a thin
server neither can ever clear — and a thin server is exactly the population THE POPULATION was built
for. "Wait for company" outranking every solo system is the wrong ladder for an alpha.

Fix follows the existing `COACH_FAMILY_BAND_LVL` precedent: a multiplayer-only milestone LEADS for
`COACH_SOCIAL_BAND_LVLS` levels after it first applies, then drops to the recurring tail, where it
is still said and still clears for good when done.

| Rung | Leads | Then |
|---|---|---|
| Pull a crew score | lvl 9 – 17 | tail: "Find a crew" |
| Blood on the ledger | lvl 22 – 30 | tail: "No blood on your ledger" |

**Measured after** (same 7-day solo run): 17 distinct rungs walked, 13 obeyed, **no rung above 21%**,
no pin, no warning. Set the lever to `0` to restore the old behaviour (they lead forever).

### The Kitchen on-ramp — measured, and it is a non-issue

The question this pass was meant to answer was whether a level-8 player told to "Cook up real money"
can afford a $20,000 lab. They are never told at level 8: "Money while you sleep" holds the top slot
until a racket is bought, so the Kitchen rung is first SAID at **level 13 with ~$118,000 in hand** —
5.9× the price, zero wait. The 70% it held before was the harness ignoring it, nothing more.

The two rungs that DO cost a real wait, and both look healthy:

| Rung | Told at | Done at | Waited |
|---|---|---|---|
| Open your first front ($250k Laundromat) | lvl 18, worth $187k | lvl 19, worth $251k | ~37 min |
| Take it to the water (boat + sail + land it) | lvl 19, worth $2k | lvl 22, worth $77k | ~1h11m |

## THE PAD OUTRUNS THE TILL — the absent front owner (tester-reported, FOUNDER CALL, not retuned)

A tester asked "how can it be that I owe more in wages than my laundromat brings in?" and their
numbers were exactly right. Measured from the signed constants:

| away | pad owed | collectable | net if you square it |
|---|---|---|---|
| 1d | $57,600 | $288,000 | +$230,400 |
| 3d | $172,800 | $288,000 | +$115,200 — the front goes COLD here |
| **5d** | $288,000 | $288,000 | **$0 — break-even** |
| 7d | $403,200 | $288,000 | **−$115,200** |

The cause is the deliberate asymmetry `BUSINESS_CAP_MS` 24h vs `BUSINESS_UPKEEP_CAP_MS` 7d — the
documented "an ABSENT owner earns ≤24h but owes ≤7d (neglect bleeds)". The bleed works. What was
probably not intended is the CROSSOVER: past five days away, squaring the pad costs more than the
front can ever hand back, so the rational move is to abandon it. There is no sell-a-front path, so
an entry-tier asset sold to a level-15 player as "earns while you are away" becomes a dead $75k
purchase the first time they take a week off — and a week off is a normal thing for a player to do.

NOT RETUNED (ground rule #1 — `BUSINESS_UPKEEP_BPS` / `_CAP_MS` / `_COLD_MS` are all signed).

**RESOLVED, and the resolution was not a retune** (founder: *"how can we make it clear that this is
part of the game to the user or expand on this"*). Two things were true at once: the FICTION is
sound — this is exactly what happens to an absentee owner, and "a front wants an owner who shows up"
is a better mechanic than a risk-free drip — but the game never SAID so before the purchase, never
warned as it slid, and, the actual defect, **never let you out**. `businesses` is
`UNIQUE(character_id, kind)`, so a cold front whose pad you could not cover did not merely sit idle:
it held the slot, and that business kind was barred to that street forever. A permanent block on an
entry-tier asset, reached by taking a week off. So what shipped is the terms, the warning, and a door:

| shipped | where |
|---|---|
| The pad quoted with the price, plus the 24h-till / 7d-envelope asymmetry, the cold window and the progressive rate | `GET /v1/catalog` → the Empire catalog card |
| `coldSeconds` — a countdown to the moment it goes dark | the front card ("the boys come for the envelope in 14h") |
| `padOutran` — the server naming the crossover, with the gap in dollars and *why* | the front card |
| a coach rung at the head of the tail when any front is cold | the plan box |
| **`DELETE /v1/business/:id`** — close it up: the pad stops, the slot frees, you can buy that kind again at tier 1 | the front card, confirm-gated |
| the mechanic named in the glossary and both codices | `?` · `docs/WIKI.md` · `/wiki` |

**`BUSINESS_SHUTTER_BPS` = 0** (new lever, pinned): closing up returns nothing — the harshest reading,
chosen because it needs no sign-off (it moves no value at all) and because the point of the door is
to stop a permanent block, not to refund a bad week. Raise it and closing up pays back that share of
everything sunk into the front. The pad dying with the front is not a loophole: `upkeepOwed` is
COMPUTED from `upkeep_at` and never stored, so walking away leaves no debt to forgive — you forfeit
the lot.

**RED-TEAMED (2026-08-01), and the lever has a floor nobody had stated.** The shutter is a way out of
a designed recurring SINK, so the question is whether it can become the way to never pay rent at all.
Both branches end holding a warm tier-1 front, so they compare directly in cash:

| | cash | end state |
|---|---|---|
| **square up** | collect the full till, settle the maxed arrears → `pending − maxPad` | warm front, tier kept |
| **walk away** | forfeit the till, buy tier 1 again, take the refund → `back − tier1cost` | warm front, tier 1 |

At the signed constants paying wins on every front by **$115k (laundromat) to $5.3M (casino)** — the
forfeited 24h till is worth more than the arrears saved — so the door is an escape hatch and not an
opt-out. But the margin is a function of `BUSINESS_SHUTTER_BPS`, and the flip point is **≈ 5400 on the
laundromat**: raise the lever past roughly half and walking away becomes the correct play, at which
point the pad stops draining. That relation is now ASSERTED from the live constants in
`test/economy.js` (mutation-verified: setting the lever to 6000 fails by name), so a retune of the
refund — or a stretch of `BUSINESS_UPKEEP_CAP_MS` — cannot unwind the sink in silence.

Also verified clean and recorded rather than guessed at: the shutter moves no value at 0 bps and rides
the existing `business:` cash vocabulary above it (no invariant change either way); the only row that
references a business (`crew_heists.target_business`) is null-safe at both call sites and answers a
crew with a clean `mark_gone`; the lock order is the sibling one (characters → the business row, and a
heist never locks the mark's character); and `businesses.id` is TEXT, so a junk id is a clean
`not_yours` rather than a 500. **Accepted, not patched:** a marked man can shutter his fronts to deny
a killer the Sacking — the exact shape of the already-accepted "warehouse the fleet before the hit",
and far more self-punishing, since he destroys them rather than parking them; and closing up does not
resolve a pending Bureau raid, which dodges a fine worth 10% of the tier cost at the price of the
whole front, so nobody will.

### HARNESS RUN — 2026-08-01, after the pad + gate-affordance drops

Both measurement harnesses re-run on the shipped tree. **Nothing was retuned from them** — they are
readings, and the two shifts below are founder calls.

**`npm run playthrough`** (a plausible player: 7 days x 2 sittings x 45 min). The speedrun stays
closed — **2h at the keyboard reaches level 14** (the alpha reached 240), 5h reaches 24, 10h reaches
39. The solo ceiling is **level 40, $1.62M, 14 of 28 missions**, reached without meeting another
person. Nerve is still the limiter; the gym hard-caps at 15 sessions a sitting; the mission ladder
advances about once per session whatever the sitting length.

**The coach's road to 30 verified end to end under that diet: 18 rungs walked, and every rung the
player obeyed cleared.** Two asked for a real save — *Open your first front* (44 min) and *Take it to
the water* (1h26m) — and neither stalled.

**SHIFT 1, worth an eye: front-gate coverage fell to 40% / 6% / 36%** (laundromat / restaurant /
nightclub) from the 70–94% the pre-coach-ladder run measured. The cause is not the economy falling
behind — it is that the coach now sends the player SHOPPING (gun, trade goods, a lab, a boat, a den
stake, a fighter) so they arrive at each unlock poorer. The harness labels each one "a real climb"
rather than a wall, and the timeline bears that out: the 44-minute save for the laundromat is the
whole of it. **The dial, if it bites: the entry cost of the front, not the income curve.**

**SHIFT 2: lockup is now the single biggest blocker of actions** — 56 refusals across the run (37
crime, 15 train, 4 score) against 1 for nerve — while jail TIME is still 0% of played minutes (a
plausible player is jailed often and briefly). Worth watching now that THE APPROACH lets a player
choose `go loud` at `jailMult` 1.4.

**`npm run scale`** (36 players + 20 residents, 5 days): **section 10.4 moved by exactly nothing
across all 24 checks**, every one of the 9 driven markets took real posts, and wealth stayed flat —
the top 10% hold **9%** of $141.7M, richest/median $4.20M/$3.97M. Goods lots ended empty CLEARED
(everything posted was taken, the healthy reading). Availability: bodyguards / duel listings /
contracts found a counterparty on 100% of looks, loan offers 92%, goods and buy orders 42%.

**A coach-ladder observation the town surfaced** (flagged, not changed): the ladder is a strict
priority chain of one-time milestones with the social rungs banded below all of them, so **a
high-level player who skipped the mid-game walks a dozen earner rungs before the coach ever mentions
their family, their crew or the wire** — which is precisely the returning veteran. Deliberate today;
worth deciding whether a veteran should be pointed at people sooner.

The economic levers remain OPEN and unretuned if the founder wants the crossover itself gone:
- **`BUSINESS_UPKEEP_CAP_MS` 7d → 2d.** Caps the pad at $115,200 against a $288,000 till, so the
  front is always worth reviving. Smallest change, keeps the bleed, removes the crossover.
- **Cap the pad at the pending take.** The pad can never exceed what the front holds for you; neglect
  costs you the income, not a debt. Strongest guarantee, biggest departure from the current model.
- **`BUSINESS_SHUTTER_BPS` > 0** so closing up returns something.
- **Leave it.** Now defensible in a way it was not before: the terms ship with the price and there is
  a way out.

## LEVELLING UP HANDS YOU SOMETHING — energy + nerve refill on a crossing (F4, 2026-08-01)

Founder direction: *"smooth out the user experience levels 1-30 to get them hooked."* Levelling up
was a number changing on a bar — the one event the whole progression is built around handed the
player nothing at all. Crossing a level now refills **energy and nerve to their newly-raised caps**.

**Why this shape and not a payout.** Energy and nerve are pure regen resources, not currency (the
skills `adrenaline` active is the precedent), so this moves no value, needs no faucet, writes no
ledger row and adds nothing to the §10.4 set. A cash-per-level version was the alternative and was
NOT built: it is a new faucet needing its own sim and sign-off, and the refill already buys the
thing that matters — the moment you go up, you can keep playing.

**It is still a pacing lever, and it was measured rather than assumed.** `npm run playthrough`, same
seed, one run each way:

| | 2 hours | 5 hours | 10 hours |
|---|---|---|---|
| `LEVEL_UP_REFILL: false` (before) | level 14 | level 23 | level 39 |
| `LEVEL_UP_REFILL: true` (shipped) | **level 16** | **level 25** | **level 43** |

≈10% faster, front-loaded into the 1-16 band this is meant to smooth — levels come quadratically
slower, so the refill is frequent early and rare by 30, which is the shape the direction asked for.
Nowhere near the alpha speedrun (level 240 in two hours) the pacing pass closed.

| lever | value | note |
|---|---|---|
| `PACING.LEVEL_UP_REFILL` | `true` | set `false` to revert to the bare number; measured above |

**Deliberately absent (stated so nobody assumes it):** the refill applies only on the ACTOR path
(where a loaded context exists). A headless grant — a heist crew member, a duel opponent — is written
by absolute UPDATE on named columns, so a refill of the in-memory row would be silently dropped, and
a reward that sometimes vanishes is worse than one consistently absent.

## THE BREADTH DROP — 14 crimes + 8 missions fill the silent levels (F3, 2026-08-01)

Founder direction: *"More breadth inside missions and crimes."* The level-gate map found **seven
levels between 17 and 31 that delivered nothing at all** — no job, no mission, no system — which the
progression harness puts at hours 2.5 to 7 of play, exactly where a player commits or drifts.

Both catalogs are MACHINE-OWNED, so this went through the seam: edit `reference-prototype-v24.jsx`,
re-extract (the car-catalog precedent). The re-extract diff was **exactly 22 inserted lines and
nothing else**, which is the seam doing its job.

**CRIMES 29 → 43.** Eight fill the cliff (17, 18, 20, 21, 23, 24, 27, 29); six fill the early band's
gaps (6, 8, 10, 12, 14, 15) so the entry loop has real variety from the first hour. Each is
BRACKETED — pays more than the best job below it and less than the cheapest above it — which is what
"on-curve" has to mean for a content drop, and is asserted per-id in `test/growth.js`.

**Why more crimes is not more money.** NERVE is the throttle (measured: the pool sits at ~21% of cap
and is full 3% of minutes), so the number of crimes on the board does not change how many a player
can pull in an hour. What it changes is CHOICE — and, marginally, that a level-18 player uses a
level-18 job instead of the level-16 one. Measured with `npm run playthrough`: **2h level 16, 5h 26,
10h 42** against 16 / 25 / 43 before — inside run-to-run noise. Content, not a rebalance.

**MISSIONS 28 → 36**, at 17, 18, 21, 23, 24, 27, 29, 31, each interpolated onto the ladder's own
curve and bracketed by its neighbours.

| | missions in the 17-31 band | one-time cash | respect (before ×0.25) |
|---|---|---|---|
| before | 3 | $310,000 | 3,550 |
| added | 8 | $833,000 | 9,360 |

**The honest number, flagged rather than buried:** each rung is on-curve, but the band's DENSITY
roughly tripled, so a player walking 17→31 now collects ~$1.14M in mission cash where they collected
$310k. That is one-time-per-street, on a 4h cooldown that is longer than a sitting, and the harness
still shows the player short of every business-front gate (46% / 7% / 42% / 52% of the entry cost at
the moment they unlock it) — so the gates still mean something. If it wants trimming, the dial is the
new rungs' `reward.cash`, not the curve.

**Untouched on purpose:** the $OMR ladder. The new missions pay cash + respect only, so the
enumerated `mission:omr` faucet is exactly what it was — asserted in the test (9 rungs, unchanged).
Respect actually paid by the eight is **2,340** after `MISSION_RESPECT_MULT`, against 228k for level
240 — a rounding error on the level curve.

## THE ASSET LADDER — the balance check, and what it actually found (2026-08-01)

Founder direction: *"run a balance check on the assets to make sure they are feasible and reasonable
for players to even get or they will get discouraged and the meta fails."* Measured by a new standing
sim probe (**P9.20b**, prints every run) rather than a one-off table, because this is a question that
wants re-asking after every economy change.

**Three catalogs do the same thing** — buy once, drip forever, cost no energy: `RACKETS` (18,
level-gated), the Legit Fronts half of `ASSETS` (13), and `BUSINESSES` (5, level-gated, net of the
pad). Rackets and assets accrue **per minute** metered by `RACKET_DAILY_CAP_MS` (12h/day); fronts
accrue per hour capped at 24h pending.

**The finding is real but INVERTED from the worry.** Nothing is out of reach:

| | payback |
|---|---|
| all 36 income assets | **0.58d — 2.98d** |
| inside a healthy 3–14 day band | **0 of 36** |
| pay for themselves in under a day | 14 of 36 |
| cheapest rung (racket `laundro`, $12,500 → $21,600/day) | 0.58d — about one session's savings |

A passive asset should pay for itself in longer than one sitting (or buying it is a formality) and
shorter than a street's expected life (or it is a trap you die holding). **Every rung is below that
band's floor.** So the mid-game's buy decision is not "can I afford this" but "have I clicked it
yet" — which is the real shape of "17–30 has no reasons": there is nothing to weigh.

**Two structural notes, neither a retune:**
- **`buyAsset` has no level gate** — 13 income assets are bounded by price alone. In practice cash
  tracks level closely enough that this is a soft gate, but it is a gate nobody chose.
- **P9.20's "$21.6M/day passive stack" counts FRONTS ONLY.** The rest of the ladder is rackets
  $166M/day + assets $94M/day if fully bought (both permanent, so a long-lived street accumulates
  all of it), against a top-tier crime grind of $13.8M/day.

**NOT retuned at the time (ground rule #1).** The levers are the per-rung income (prototype tables,
machine-owned — a re-extract), the 12h `RACKET_DAILY_CAP_MS` meter, and a level gate on the Legit
Fronts ladder. **Retuned 2026-08-03 — see the next section.**

## THE ASSET LADDER RE-CURVED — the ROI now tapers (founder-directed 2026-08-03)

Founder direction: *"Run a full economic balance & code audit of every function, every button & task.
Apply your recommended fixes."* — which is the sign-off for the levers above (the L1/L2 precedent,
where *"Balance the economy"* carried the same weight).

**What was wrong was the SCALE, not the shape.** The original curve already tapered slightly (payback
0.58d at the bottom → 1.81d at the apex) — it was simply four to seven times too generous end to end,
so the taper never became a decision. A permanent, energy-free income asset that pays for itself in
under a day is not a purchase, it is a formality.

**The fix went through the machine-owned seam** (ground rule #2 — edit `reference-prototype-v24.jsx`,
run `node tools/extract-rules.js`; the car-catalog / PATHS v2 precedent). The regenerated diff was
**exactly 62 lines — 31 income values across two files and nothing else**, which is the seam doing its
job. Each rung's income is now derived from a target payback that rises with the rung:

    income/min = cost ÷ (paybackDays × 720)      # 720 = the RACKET_DAILY_CAP_MS metered minutes/day

with payback swept linearly **2.0d at the on-ramp → 12.0d at the apex**, on each ladder independently
(18 rackets, 13 Legit Fronts). The bottom is deliberately left generous: a first passive purchase
should still feel like a win, and the entry rungs are cheap enough that their absolute income is petty.
The two ladders now sit on ONE consistent ROI curve, which they did not before (`laundro` at 0.58d
beat `grocery` at 0.69d for no stated reason).

| measured (sim P9.20b) | before | after |
|---|---|---|
| payback range | 0.58d — 2.98d | **1.09d — 12.00d** |
| inside the healthy 3–14d band | 0 of 36 | **27 of 36** |
| pay for themselves in under a day | 14 of 36 | **0 of 36** |
| whole racket ladder | $166,039,200/day | **$24,953,760/day** |
| whole Legit Fronts ladder | $94,262,400/day | **$10,854,000/day** |
| the 12 metered seats a player actually runs | $243,864,000/day | **$33,178,320/day** |
| that against the top-tier crime grind | ~19× | **~2.6–4.4×** (the grind figure moves with the day's city event) |

**The 9 rungs still outside the band are deliberate and named:** the four on-ramp rungs (1.9–2.7d, the
generous first purchase) and the five `BUSINESSES` fronts, whose curve the L1a/L1b package measured and
signed separately on 2026-07-24 — re-cutting a signed number twice within days, unasked, is not an
audit finding. Their shape is also now RIGHT relative to each other: fronts are the premium layer
(level-gated, pad-paying, Bureau-raidable, PvP-losable via the Sacking), so they *should* out-earn the
safe drip per slot, and after this retune they do.

**Progression is unaffected; only the passive cash moved.** `tools/playthrough.js`, same day, both
sides: **level 35 → 34** (inside the recorded ±1 noise at 10h) and **$1,551,736 → $1,065,464** (−31%)
over the 7-day solo run. The business-front gates got *harder* to reach (55/72/80% covered → 62/14/55%),
which is the direction a gate is supposed to point. §10.4 drift-0 throughout — every rung is still an
ordinary ledgered `racket:income` / `business:income` faucet; nothing about conservation changed.

**Still flagged, NOT changed:** `buyAsset` has no level gate, so the 13 Legit Fronts are bounded by
price alone. With payback now stretched to 12 days the price genuinely *is* the gate (the harness has a
solo player at ~$1M by day 7 against a $60M apex), so this is a consistency wart rather than an open
door — but it remains a gate nobody chose, and the founder's dial is a `lvl` field on those entries.

## THE DAILY LOOPS ALREADY OUT-PAY THE GRIND — a retracted claim (2026-08-01)

The early-game design doc claimed the repeatable daily loops pay **75 respect, 5% of a day of crime
clicking**, and proposed F2 to fix it. **That was wrong.** It measured the corner (15 × 5/day) and
generalised, missing the daily CONTRACTS, which are level-scaled in `claimDaily` (`5×lvl` each,
`+15×lvl` for all three) and are the biggest daily payer in the game. Re-measured at level 22:

| | respect |
|---|---|
| one level costs | 430 |
| 45 min of the best crime | 324 |
| **full daily contract board** | **660** |
| corner envelopes (5/day) | 75 |
| a mission (after ×0.25) | 230 |

The daily board pays **2.3× a sitting of crime**. **F2 is retired, not deferred** — building it would
have roughly doubled a daily faucet that already out-pays the loop it was meant to compete with, on
the signed pacing curve, on the strength of a number I got wrong.

## THE NUT — the crew, and the door out (tester-reported; measured, made legible, not retuned)

The same tester who found the pad also wrote **"same for the kitchen. it's unbalanced"** and
**"no way a 25k runner costs 8k in 5h"**. Measured from the signed constants (sim **P9.20c**, printed
every run):

| what | number |
|---|---|
| the nut | **$1,200/hr per hand**, flat, on the wall clock |
| what one hand moves while stocked | **$4,320/hr** on VIM, the cheapest line — **3.6:1** against the wage (360:1 on NOCTURNE) |
| 1 hand, checking in every 8h | **+$24,960** per cycle — 3.60:1 |
| 1 hand, checking in daily | **+$5,760** per cycle — **1.20:1** |
| 1 hand, absent 3 days (the cold line) | **−$51,840** per cycle — **0.40:1** |
| the asymmetry | sales cap at `OFFLINE_CAP_MS` **8h**; the nut runs to `CREW_WAGE_CAP_MS` **168h** — **21×** |

So the tester's arithmetic was right and the mechanic is working as designed. It is the pad's fiction,
sharper: **the corner holds a shift's take, the envelope runs a week.** A stocked, attentive crew is
never the problem; a daily one is thin on the cheapest line; an absent one bleeds. That is attendance
pricing, and it is a better mechanic than a risk-free drip.

**The defect was never the ratio — it was that the game never SAID any of this, and never let you out.**
`crew` only ever incremented. There was no fire button anywhere in the game, so a player who hired ahead
of their kitchen owed $1,200/hr/head with no way to stop, forever, on a street that could live months.

Shipped (no lever moved, §10.4 untouched):

- **the terms ride with the price** — the sheet and `/v1/rules.crew` now carry the per-head rate, the
  cold window, and the week the nut runs to, so the deal is visible before the hire, not after;
- **a countdown** to downed tools on the card;
- **`DELETE /v1/kitchen/crew`** — square up and let one go. A **cold** crew (downed tools past
  `CREW_WAGE_COLD_MS`) walks for **nothing**: men who stopped working three days ago have already gone,
  and that is the exit a broke player needs.

**The dodge is closed on the economics, not with a special rule.** `crewWageOwed` is `crew × elapsed`
and is never stored, so shedding heads retroactively shrinks the nut. But the free door is only open
once you are cold, and reaching cold costs three days of sales: **~$311k of product forgone against
~$86k of wages dodged**, on the cheapest line. Nobody takes that trade. A warm crew's only exit is
through the till.

**OPEN founder levers** (not moved, ground rule #1): `M4.CREW_WAGE_PER_HR` ($1,200),
`M4.CREW_WAGE_CAP_MS` (7d — the week the envelope runs), `CONSTANTS.OFFLINE_CAP_MS` (8h — the shift
the corner holds), `M4.CREW_COST_STEP` ($50k × N), `M4.CREW_MAX` (5). The single number that would
remove the crossover itself is `OFFLINE_CAP_MS`: raise the shift the corner holds toward the week the
envelope runs and an absent owner stops bleeding — which also changes every other offline faucet, so
it is a whole-economy decision, not a kitchen one.

## THE HARNESS MEASURES THE GAME THAT SHIPPED — a calendar, a city, and what moved (2026-08-01)

`tools/playthrough.js` is the only thing that measures what a PERSON experiences rather than what the
ledger conserves, and it had drifted from the game in three ways that each made it under-report. All
three are fixed; the numbers below separate what the GAME did from what the HARNESS was failing to
see, because a single figure cannot tell you which.

**The three gaps.**

1. **THE CALENDAR NEVER TURNED.** The clock warped the character's timestamps, which advances the
   HOURS but never the DATE — and a growing set of loops is keyed on `dayOf()`: the daily contracts,
   the corner and its chains, the hustle, the trainer drills, the fixture leads, the standing bucket.
   Across a seven-day run the player therefore got exactly ONE day of all of it. Measured: **2 daily
   contracts claimed in a week**, against three a day on offer. Every day-keyed loop was being read at
   roughly a seventh of itself, which would have printed as "these barely move the needle" — a limit
   of the harness reported as a finding about the game.
2. **THE CITY WAS EMPTY.** `runPopulation` is a worker job that ships ON, so a server with nobody in
   it is the unrealistic case, and that is what was being measured.
3. **THE LADDER HAD NEVER MET FOUR LOOPS** — the corner, the hustle, the career ladder and the
   regimen/drills. (It was NOT as stale as feared: the coach, the port, races, boxing, fronts, skills,
   rackets and the kitchen lab were all already driven.)

**Run-to-run noise, measured first, because otherwise a movement cannot be read.** Three identical
runs: level at 2h **±2**, at 5h **±1**, at 10h **±0**. So the ten-hour figure is the one to trust and
the two-hour one carries a couple of levels of RNG. Everything below is quoted at 10h.

| configuration | 10h | vs previous |
|---|---|---|
| as the harness stood (no calendar, empty city, old ladder) | 41 | — |
| + the calendar turns | **44** | **+3** — the daily contracts finally paying |
| + the four loops, the residents, and the PvP contracts | **46** | **+2** |
| the shipped game, refill OFF (same config) | 41 | the refill is worth **+4** here — and see the defect above |

**THE HEADLINE, AND IT IS A DEFECT: the level-up refill makes nerve UNBOUNDED past level ~90.**
Nerve is the pacing wall — the PACING pass made it the limiter on purpose. The refill sets nerve to
CAP on every crossing, so it is a nerve faucet whose size is the cap and whose rate is how often you
level. Past the point where a crossing hands back MORE than the next level costs, the wall is gone.

| level | nerve to earn the next level | refilled on the crossing | |
|---|---|---|---|
| 60 | 116 (via *counting*) | 70 | bounded |
| **90** | 96 (via *grandcasino*) | 100 | **turns here** |
| 110 | 81 (via *depository*) | 120 | +39 |
| 300 | 221 | 310 | +89 |
| 1500 | 1105 | 1510 | +405 |

**Proven live, not inferred.** A level-115 character with trained stats, **the clock frozen so regen
is exactly zero**: a nerve pool that funds **3 jobs funded 3000**, taking them from level **115 → 656
in one sitting**, ending at **full nerve**. End-to-end, 30 simulated days (45 hours played) reaches
**level 1636 and $7.5 BILLION** — crimes per sitting climb 43 → 837 as the loop takes hold. This is
the level-240 alpha speedrun class, reborn above level 90.

**Why the shipping A/B missed it, which is the lesson worth keeping.** That A/B measured 2h, 5h and
10h — **all of it under level 50, all of it below where this turns.** The lever was measured; it was
measured in the wrong RANGE. The harness now prints a THE REFILL CEILING probe every run (pure
arithmetic over the signed constants, no runtime cost) so a change to the refill *or* to the top of
the crime respect/nerve curve re-measures it.

**NOT retuned — `PACING.LEVEL_UP_REFILL` is a signed lever and this is the founder's call.** Three
dials, cheapest first: set it `false` (the revert BALANCE already documents, costs the −4 levels at
10h); **refill ENERGY only, not nerve** (energy is not a wall — see H1 below — so the "keep playing"
intent survives intact and the exploit dies); or flatten the top of the CRIMES respect-per-nerve
curve, which F3's breadth drop steepened (*depository* pays 950 respect for 35 nerve = 27:1).

**A second pinned rung, same F2 class.** The harness's own anti-masking bound fails the 30-day run:
*"You've earned skill points"* holds **51% of advised play AFTER the player did what it says**. The
tree is 12 skills costing 30 points total and points are `floor(level/4)`, so **from level 120 a
player owns every skill and the rung fires forever with nothing left to buy.** The guard against
nagging a veteran banking points for a capstone (`≥5 idle`) does not cover "the tree is finished".
Cheapest fix: the rung goes silent when nothing is learnable.

**The refill's SIZE was already measured and that part confirms.** BALANCE's existing A/B (level 14→16 / 23→25
/ 39→43) was run when the refill shipped; re-measured inside the current content it is +4 at ten
hours, the same size. The audit that prompted this pass called it "unmeasured" — that was **wrong**,
and the correction matters: what was unmeasured was the COMBINED state, not the lever.

**Seven days, solo, following the coach:** level **47**, **$2.14M**, 14 of 36 missions, 3% of played
minutes in lockup, 3% idle. The mission ladder is cooldown-bound — 14 jobs is what a 4h cooldown fits
into fourteen sittings however well you play.

**Two findings I nearly filed and did not, both killed by checking.**
- The calendar fix surfaced a coach rung — *"2 of today's contracts unclaimed"* — holding **41% of
  advised play** and never clearing, which is the exact masking class the F2 audit had just closed.
  It survived adding 48 residents (41% → 40%). It turned out to be **the harness**: the ladder had no
  way to jump or bust anyone, so it could not do the work the contract asked for. Wired up, the rung
  drops out of the top line entirely and dailies go 8 → 14 a week. **Not a defect.**
- The first cut of that fix read `j.k` where the board sends `kind`, so the branch was a silent no-op
  that still printed a pass — the client-wiring guard's check-3 class ("the route is right, the field
  is not real") landing in the harness itself.

**Flagged, NOT changed (ground rule #1).**

| # | what | measured | dial |
|---|---|---|---|
| H1 | **Energy is still vestigial.** THE REGIMEN shares the gym's clock AND its 10 energy, so it is a substitution, not an addition. | energy full **96%** of played minutes, before and after | give one loop its own energy cost, or leave it as headroom |
| H2 | **Stat training past the mission gates buys nothing measurable.** The old ladder's idle-gym fallback banked 212 muscle; spending the same sessions on disciplines banks 51 — and both reach level 45+ with comparable cash in seven days. | 212 vs 51 muscle, same level | either stats should matter more to the crime roll, or the gym's idle capacity is a sink with no return |
| H3 | **A failed bust is a stretch in lockup**, so a player who chases a `bust` contract without restraint spends a quarter of their time in a cell. Capped at 3 attempts a sitting to model a person who learns. | uncapped: 26% of play in lockup, a quarter of the run's crimes lost | the contract's odds, or a per-day attempt cap in-game |

**Honest limits of the harness, stated so nobody over-reads it.** The content of a day is a seed
function of the real `dayOf()`, so the drawn corner tasks, hustle stops and drills are identical every
simulated day — fine for throughput and pacing, not a test of variety, and it means whichever daily
contracts today happens to draw are the ones exercised. The player is still solo: no family, no crew
heist, no duel.

## THE REFILL CEILING — the runaway bounded, and two dead rungs (founder-directed 2026-08-01)

The founder chose **the daily bucket** over the other two dials, and it is the right one: the refill's
benefit and its runaway are the SAME mechanism at different scales, so nothing keeps all of one and
none of the other — but a bucket keeps the part the feature exists for (an early sitting crosses
several levels and gets every one of them) and bounds the part that breaks the game.

| lever | value | what it buys |
|---|---|---|
| `PACING.LEVEL_UP_REFILL_MAX_DAY` | **10** | at most 10 free top-ups a day, on a rolling 24h token bucket (`characters.refill_used`/`refill_at` — the wash-cap / safehouse-cap pattern). Above the bucket the crossing still happens; it just hands nothing back. **0 disables the refill entirely; a large value restores the runaway.** |

**Why 10, and why the bound is level-independent.** The exploit is that a crossing returns
`nerveCapOf(L)` nerve while the next level costs `LEVEL_DIVISOR × (2L−1) ÷ (best respect-per-nerve)`
— both grow linearly in L, and past ~level 90 the first wins permanently, so the ratio is FLAT rather
than growing: **~1 level per refill at level 90 and at every level above it**. A daily bucket
therefore caps the refill's whole contribution at ~`MAX_DAY` levels a day — the harness prints the
figure (**≤ 10.43 levels/day at level 90**) — instead of "as fast as you can click". 10 is above what
a real early sitting uses (the measured 2h run crosses ~13 levels with regen doing most of the work),
so the band the feature was built for never feels it.

**Measured, 30 simulated days, solo, following the coach:**

| | uncapped refill | with the bucket | pre-refill baseline (recorded) |
|---|---|---|---|
| level | **1,636** | **190** | 128 |
| net worth | **$7.5B** | **$94.2M** | $51.3M |

The bucket lands the 30-day figure within ~1.5× of the historical pre-refill run — i.e. the refill is
back to being a *feel* feature with a measurable but bounded pacing cost, which is what it was
approved as.

Spending the bucket is **silent** — a gift that scolds you for taking it too often is worse than one
that simply stops. Regen is untouched; only the free top-up is metered.

**The regression is the point.** `test/growth.js` asserts a crossing on a spent bucket hands back NO
nerve, and asserts `MAX_DAY > 0` — so removing the ceiling, or setting it to a value that turns the
loop self-sustaining again, fails by name. `tools/playthrough.js` still prints THE REFILL CEILING
probe every run, so any change to the refill *or* to the top of the crime respect-per-nerve curve
re-measures the crossing point.

**The two dead coach rungs, both fixed (§10.4-free — the coach reads state and moves nothing).**

| rung | was | now |
|---|---|---|
| *"You've earned skill points"* | held **51%** of advised play after the player obeyed it — points keep accruing (`floor(level/4)`) long after the 12-skill / 30-point tree is complete, so from ~level 120 it fires forever pointing at a finished tree | goes silent when `owned.skills.size >= SKILLS.TREE.length` |
| *"You can get made for free"* — NEW | did not exist. An alpha tester read the game as pay-to-win ("we can't earn OMR in game anymore?") when the mechanics say otherwise | fires at level 14 (when *The Dockside Heist*, the first $OMR mission, becomes claimable at exactly the PLEX mint price) and clears the moment the account is minted |

That second one is a **discoverability** fix, not a mechanics change, and it is worth being precise
about why: $OMR is still earned by playing — the mission ladder alone pays **220 across nine jobs,
the first at level 14** — and MINTING, the gate on withdrawing and on the Street Wage, is payable in
that earned $OMR through PLEX (`PLEX_MINT_OMR` **5**), not only in ETH. Nothing was missing but the
sentence saying so. No number moved.

**A flake fixed en route, same class as the recorded ones.** `test/growth.js`'s corner-tail walk
asserted the trainers rung leads once the corner allowance is spent — but the clue rung sits between
them, and every successful crime rolls `CLUES.DROP_P` (2%), so a player who had pulled a dozen jobs
met an organic clue scroll roughly one run in ten. A deterministic assertion resting on a
probabilistic precondition (the population duel-ladder and Doc-drill flakes). The scroll is now
cleared before the walk; the clue rung is still proven a few lines down on a deliberately seeded one.

## THE FARM — what the Street Wage costs a Sybil, and what it pays (measured 2026-08-01)

The founder's open question from the alpha Discord: *"the horde of low-value farmers that will play
strictly to exploit/extract. Open to ideas on how to reach that balance."* The wage is the only
real-value emission to players, so it is the one loop where that question has teeth. Answered
analytically (`tools/sim.js` **P9.29**, prints every run) because the payout is closed-form —
`emission.js:114`: `share = min(WAGE_CAP_OMR, budget × gain / Σgain)`.

**Start from the property, not the number.** A farm's share of the budget *is* its share of total
respect gained, and there is no cheaper path to respect than playing. So a farmer has **no efficiency
edge** over an honest player — only parallelism. Everything therefore turns on the per-account cap,
and the cap does something counter-intuitive.

| finding | measured | why it matters |
|---|---|---|
| **the wage goes FLAT below a population** | **100** wage-eligible accounts | the cap binds at 1.0% of total respect gained (5/500). Below ~100 similar players *every* qualifier is capped, the pro-rata weighting does nothing, and the wage is a flat 5 $OMR/day per identity that clears the floors — **however well or badly it is played.** That regime is the alpha: exactly when the population is smallest and a farm is cheapest to stand up. |
| **the cap is what creates the Sybil incentive** | — | `WAGE_CAP_OMR` is commented "anti-concentration / anti-Sybil", but concentration is the *opposite* of Sybil. It clips the honest whale to 5 and hands the remainder to whoever runs more accounts — the only way around a per-individual cap is to be several individuals. |
| **capturing the entire budget** | **100 identities · 1 ETH** one-time | the mint fee is the only thing charging for that. |
| **payback at the game's own implied rate** | **1.0 day** | the game prices 5 $OMR = 0.01 ETH (`PLEX_MINT_OMR/MINT_FEE_ETH` ⇒ 500 $OMR/ETH), so the 500/day budget is worth ~1 ETH/day and 100 identities cost 1 ETH. **The mint fee is one day of the thing it gates.** |
| **break-even price** | **3,500** (7d) / **15,000** (30d) / **45,000** (90d) $OMR/ETH | farming pays if $OMR trades richer than these. The game's own implied rate is **500** — far richer than all three, so on these assumptions farming pays comfortably. |

**Two things that make this less alarming than it reads, and they change which fix is right.**

**Extraction is already bounded and not by the fee.** A farm can accumulate at that rate, but
*withdrawing* needs the reserve to hold it, and the reserve is fed only by Vig buybacks off real
revenue — so `extraction ≤ inflow` holds by construction however many alts exist. The damage a farm
does is **dilution** (above ~100 players, every $OMR an alt takes is one an honest player does not)
and a **$OMR overhang** it can sell on the DEX. The 48h early-exit surcharge taxes the fast version
of the second hard.

**The endowment cannot be drained.** 500/day halving every 180 days is a geometric series summing to
**180,000 $OMR ever**, against a 1,000,000 endowment — so the schedule can only ever use **18%** of
it. A farm cannot beat the schedule either: the budget is a per-epoch ceiling, so maximum farming
means it runs fully subscribed rather than partly. *(Worth knowing separately: the endowment is
5.5× what the schedule can reach, so the `emission within endowment` invariant would not fire until
long past anything the schedule can do. Harmless as built — a ceiling nobody reaches is a ceiling —
but it is not doing the work it looks like it is doing. If the endowment was meant to be the real
bound, either it or `DECAY_EVERY` is mis-sized. Founder call.)*

Also corrected in the build: the first cut of the drain probe ran a day-by-day loop and reported its
own 50-year guard as though it were a measurement — the shape of a bug that reads exactly like a
result. It is closed-form now.

### The options, ranked — with what each costs an honest small player

**SUPERSEDED 2026-08-01 — none of these options was taken; the wage itself was retired** (economy v3
step 1). The ranking is kept because it is the reasoning that led there: every lever taxed the farm
without making it unprofitable, which is what a faucet with a per-account cap does. `EMISSION.*` no
longer exists.

| # | lever | effect on a farm | **cost to a legitimate small player** |
|---|---|---|---|
| **F1** | **make the cap sub-linear in identities** — cap on a bloodline/wallet/payment instrument rather than per account | strikes the root: splitting stops recovering the pro-rata share, so the incentive the cap creates disappears | **none** for anyone running one identity. Needs a durable identity key to cap against, which is the hard part — the wallet is the honest candidate since minting already requires one |
| **F2** | **raise `WAGE_MIN_SCORE`** (25) so a wage requires real play, not a token session | linear cost increase per alt in *automation minutes*, which is a farm's real scaling constraint | hits the casual player hardest — someone who plays 20 minutes a day is exactly who a high floor excludes, and they are the player the wage exists for. **The worst option on this axis** |
| **F3** | **raise the mint fee** | linear, and the founder has chosen to hold at 0.01 for now | raises the on-ramp for the small earner; minting also gates withdrawing, so it compounds |
| **F4** | **weight by account AGE or a non-farmable axis** (tenure, verified social, prestige) | a farm can wait, but waiting is inventory cost, and cohort-based weighting makes a burst of new identities self-diluting | a genuinely new honest player earns less at first — a real cost, but a *transparent* one, and it decays |
| **F5** | **accept it, and let the reserve be the wall** | none | none. Defensible: extraction is already bounded, the endowment cannot be drained, and the practical loss is dilution among *in-game* $OMR holders. The cost is that honest players' share is halved by a farm that costs 1 ETH to stand up |

**My reading:** F1 is the only one that addresses the actual mechanism rather than taxing the
symptom, and it is the only one with no cost to a legitimate player. F2 is the most tempting and the
worst — it prices out precisely the small earner the wage was built for. F5 is more defensible than
it sounds and is the right *interim* posture while the population is below 100, because in that
regime the wage is flat anyway and the dilution has nobody to dilute.

**The population number is the thing to watch.** Below ~100 wage-eligible accounts none of this
bites; above it, a farm's take comes directly out of honest players. `GET /v1/mod/overview` already
reports active accounts — that figure crossing 100 is the trigger to decide.

---

## THE DESK OPENS — the daily Dutch auction (economy v3 step 3, founder-directed 2026-08-01)

Step 2 taught the desk to COLLECT (a $OMR sink hands the token over instead of destroying it). This
is the outbound half — and it closes an honest gap step 2's own header named out loud: *a desk that
accumulates and never sells is indistinguishable, from the outside, from a burn with extra steps.*

**The one fact that decides everything else: the sale is a TRANSFER, not an issuance.** The desk
sells $OMR it already holds, so `desk_inventory` falls by exactly what the buyer's account rises by,
and both are inside `omrBuckets`. Conservation therefore needs no new mint or burn term and does not
move. That is wall 2 ("the desk never sells inventory it does not hold") holding **by construction**
rather than by assertion — it is one clamped subtraction, and there is no code path that credits a
buyer without decrementing the shelf.

Three consequences worth stating, because each replaced something I expected to have to build:

- **The 48h vest needed no code.** A `desk:sale` credit is a positive $OMR row on the buyer's
  account, and `tax.js:earlySurcharge` replays exactly those rows as FIFO lots. Bought $OMR is
  therefore *already* priced at the full early-exit surcharge decaying to zero over
  `FRESH_WINDOW_MS` — which is 48h, the design's number. One concept, one constant: simultaneously
  the anti-dump, the float creator, and the §5(ii) loot exposure window. The suite asserts it rather
  than assuming it, because "we get it for free" is the kind of claim that stops being true silently.
- **The reserve IS the band.** There is no separate "should the desk sell today?" decision, because
  a Dutch auction that will not clear under its reserve *is* that decision. Unsold inventory rolls,
  and there is nothing to unwind — the lot is a right to sell, never an escrow.
- **It does NOT run over `OmertaBond`,** contrary to the migration line as written. The bond MINTS
  against ETH; the desk RECYCLES. Running the auction through the mint path would issue new supply
  alongside inventory that already exists.

### The numbers (all founder sign-off levers, pinned in `test/levers.js`)

| lever | value | why |
|---|---|---|
| `BAND.ANCHOR_DAYS` | 30 | manipulation cost scales with the window; shorter and a whale sets our price |
| `BAND.UPPER_BPS` | 10000 (1.00×) | sell at or above the 30-day average — roughly half of all days |
| `BAND.LOWER_BPS` | 8000 (0.80×) | the BUY edge (step 4). Pinned now so the pair cannot drift apart |
| `DESK_AUCTION.DURATION_MS` | 6h | long enough for a global player base to see one |
| `DESK_AUCTION.OPEN_BPS` | 15000 (1.5×) | high enough that a genuine squeeze can clear up there; nobody is forced to bid it |
| `DESK_AUCTION.FLOAT_CAP_BPS` | 100 (1%/day) | a huge sink day must not become a dump |
| `DESK_AUCTION.FLOAT_CAP_MIN_OMR` | 1000 | **the bootstrap floor, and it is not decoration** — with a float of zero the cap is zero, so no auction opens, so nobody can buy, so the float stays zero |
| `DESK_AUCTION.ORACLE_MAX_AGE_MS` | 48h | then FAIL-CLOSED |
| `DESK_AUCTION.ETH_POL_BPS` | 5000 | ETH proceeds split 50/50 POL / founder (design §3.1) |

**Fail-closed, and why it is not optional.** No oracle print, or one older than
`ORACLE_MAX_AGE_MS`, and **no auction opens** — it never falls back to a default price. This is the
vault's `ethPrice` lesson on the other side of the trade: "we don't know what $OMR costs" resolving
to "sell it at the default" is a standing free option on the desk's entire shelf. The board renders
the closed state off the *same* read the open path refuses on, so it can never advertise a price the
auction would reject, and it names the reason so an operator can tell "closed on purpose" from
"broken".

**What is deliberately NOT measured yet.** Revenue here is `sink volume × price`, and the price is a
market that does not exist until mainnet. The sim can bound the *quantity* (it is the recycle volume
step 2 already routes) but not the clearing price, so there is no honest $/day figure to publish and
none is claimed. What can be said: the auction cannot emit — every unit it sells was already inside
`omrBuckets` before the sale, which is the whole point.

### The mutation that survived, and what it exposed

Removing the shelf clamp — the third of wall 2's three bounds — left the suite **green**, because the
fixture only ever exercised the LOT bound. "Wall 2 holds" was half-tested and read as fully tested.
The reason is structural: the lot is set at `min(returned, floatCap, shelf)` and the shelf then falls
by exactly what that lot sells, so in today's code the remaining lot **can never exceed the shelf** —
the clamp is unreachable. It is kept as defence in depth (a future ops correction, step 4's buy side
touching the same singleton, a bug) and is now tested against a *synthetic* drain, labelled as such.
An unreachable guard is worth keeping; an untested one that reads as tested is not.

---

## THE BAND'S BUY SIDE — the POL-fee buyback (economy v3 step 4, founder-directed 2026-08-01)

Step 3 opened the sell side. This is the other edge: below the band's `LOWER` the desk **restocks
from the open market**, because buying inventory back is sometimes cheaper than waiting for the sinks
to return it. Bought $OMR goes to the **shelf, not the fire** (design §3.3) — the desk is a rental
business, and this is buying stock.

**The budget is POL trading fees, exclusively** (design §11.10), and the exclusivity is the whole
mechanism rather than a preference: not the founder half (not ours to spend), not the LP half (POL
depth is the binding constraint), and **never by minting** — that last exclusion is wall 4, the single
line between this design and Olympus. Fees are self-limiting (you cannot spend what the pool did not
earn), they scale with real activity rather than with price, and they compound correctly: the sell tax
grows POL, deeper POL earns more fees, more fees buy back more.

### The §10.4 shape, which is the part worth understanding

`desk:buyback` is a **mint**, and it is the **exact inverse of a withdrawal**:

| | in-game | on-chain |
|---|---|---|
| `withdraw:omr` | BURN | hard OMR leaves the reserve |
| `desk:buyback` | MINT (into the SHELF) | hard OMR **enters** the reserve |

Supply exits the game one way and re-enters the other. Wall 1 ("no faucet") is untouched because it
credits the **shelf and never a player** — nobody is paid, and the token only reaches a player by
being bought at the auction for ETH.

It is admissible **exactly to the extent that the hard token really arrived**, and conservation cannot
see that — it counts the mint and moves on. So the backing is checked from three sides rather than
claimed: `runDeskInvariants` asserts the soft credit equals the hard purchase and that the desk's own
books agree, and the Vig's two-sided `reserve fully backed` / `reserve not under-funded` pair now
carries the desk's contribution by name. That pair is EXACT on both sides, so a reserve source the
sandwich does not know about trips both at once — which is why the term was added rather than the
checks loosened. Both legs move **in one transaction**, deliberately not through `fundReserve` (which
opens its own): the Vig funds post-commit and calls that gap a lost-funding alarm, but here the
direction of the gap is worse — soft supply existing before its backing — so they move together or
neither moves.

### The numbers (founder sign-off levers, pinned in `test/levers.js`)

| lever | value | why |
|---|---|---|
| `DESK_BUYBACK.MIN_ETH` | 0.001 | below this it is not worth a transaction |
| `DESK_BUYBACK.PRICE_FLOOR_BPS` | 2000 (0.20× anchor) | **a safety bound, not a balance one.** The shelf credit is `eth / price`, so a price a decimal place too low mints inventory out of a typo. The RWA float shipped exactly that bug. Fail-closed rather than clamped: a price we do not believe is not a price to trade at |

The band's own edges (`BAND.LOWER_BPS` 0.80×, `UPPER_BPS` 1.00×) were pinned with step 3 and are what
actually decides whether the desk trades at all. The **20%-wide dead zone between them is the point**:
running both sides at once is a losing round trip wearing a flywheel costume.

**Not measured, and no figure is claimed.** Buyback volume is `POL fee income ÷ price`, and both terms
are markets that do not exist until mainnet. What CAN be said without a market: the buy side can never
outspend the fees the pool earned, and every $OMR it mints has a hard token behind it — those are
structural, and both are asserted.

---

## THE FLOAT — the tiered loot rate, THE MADE MAN, the access stake (economy v3 step 5, founder-directed 2026-08-01)

Design `omerta-economy-v3-design.md` §5, §11.1, §11.2, §11.5. The step exists to answer one sentence:
**a consumable you should never HOLD cannot be the loot that makes killing worth it.** If the rational
play is buy-and-spend-instantly, nobody carries a balance, there is nothing on the body, and the only
extraction path is empty. Forcing a float is therefore the central mechanic, not a detail.

### THE LOOT RATE IS TIERED, and the flat rate is retired

| lever | was | now | why |
|---|---|---|---|
| `M3.OMR_LOOT_RATE` | 0.20 | **RETIRED** | sized when the Street Wage was the main $OMR source |
| `M3.OMR_LOOT_IDLE` | — | **0.50** | a loose balance + unbonding principal — money doing nothing |
| `M3.OMR_LOOT_COMMITTED` | — | **0.20** | a staked balance — already working, so cheaper. **Never free.** |

**Two failure modes pull in opposite directions**, which is what makes a flat rate wrong at any value.
Too *low* and hunting is not worth the wall-clock time, so the extraction path is dead. Too *high* and
holding is suicide, so nobody carries a float and **there is nothing to loot** — dead the other way.
My own first instinct (a flat 0.50) fails the second test.

**What changed the answer is the severance.** Cash cannot become $OMR at any price, so a hunter now
spends a resource with no real-money value to gain one that has it. The old D1 kill-EV measurement
(−$72k standalone) is not the right question for the $OMR side any more: the cost is nearly free in
real terms, so the rate does not need to be high to be worth doing — it needs to leave something to hunt.

**So exposure is proportional to IDLENESS, not to wealth.** Measured at P9.30 on a 200 $OMR float:
idle pays a killer **100**, committed pays **40**, so committing saves **60 per death**. Both answers
help the economy — committing drives velocity (the one KPI), staying liquid feeds the hunters. It also
protects a new player with no rule at all (a fresh street holding nothing is worth nothing to hunt) and
is self-balancing: as whales learn to commit, typical scores fall and hunters must hunt more.

**THE REVERSAL, stated plainly: staked $OMR is no longer a safe harbour.** §4.1 says $OMR moves three
ways and a protected tier would be a fourth. The player-facing promise in both codices said the
opposite and was corrected in the same commit. Setting `OMR_LOOT_COMMITTED` to 0 restores the old
safe harbour; setting `OMR_LOOT_IDLE` to 0.20 restores the old flat rate.

Unlike the CASH rate these are clamped only at 1 (above 1 would be a mint, not a loot) — §11.1's "no
cap, no floor" — because a 0.5 ceiling on a 0.50 base would silently swallow the season modifier.

### THE MADE MAN — the recurring subscription

| lever | value | note |
|---|---|---|
| `MADE.OMR` | **20** | the dues |
| `MADE.MS` | **30 days** | extended from later-of(now, current end) |
| `MADE.ESTATE_TIER` | **4** | the upper compound wants standing |

≈ **243 $OMR per subscriber per year, continuous** rather than one-off — which is why §5 calls it the
strongest of the float mechanisms. And since step 2 it is a **sink that recycles**: every dues payment
lands on the desk's shelf to be sold again, so it is turnover, not destruction.

**What it deliberately does NOT do.** The obvious version is to re-denominate operating costs —
business upkeep, crew wages, territory upkeep — into $OMR. §11.2 rejects that and the reasoning is the
whole design: a player would then *have* to buy real money to keep earning, which is a subscription
wall on the core loop rather than a premium tier. **Operating costs stay in cash. All of them.**

What the dues open is status, access and time: the badge, the upper compound, a house of your own, and
**the pad pays itself** — a made man's fronts settle their own CASH upkeep when he touches them. That
last one is the only piece that could drift into a discount, so it is asserted to the dollar: the same
cash leaves the same pocket, writes the same `business:upkeep` ledger row, and the front earns the same
income. What is bought is not having to remember.

### THE ACCESS STAKE

`ACCESS_STAKE.HIGH_OMR` = **50**. The high-stakes room now wants a seat (level, or the Madame's velvet
rope) **and** a held stake. Held, not spent, so it earns the house nothing — its whole job is a
permanent, visible, **lootable** float attached to exactly the players worth hunting. It rides the
existing `staked` bucket, so no new schema and no new §10.4 surface.

### OPEN — flagged for founder sign-off, NOT decided here

1. **The Commission is deliberately NOT gated on being made**, though §11.2's list opens with
   "Commission eligibility". A decree moves real gameplay surfaces (safehouse cost, war blocking,
   laylow cost, the fire-kill loot multiplier), so gating the vote on a paid subscription would be
   $OMR buying POWER — against §4.3, which the same section names as the binding constraint. If the
   Commission should be a made-man table, the decree teeth want reviewing at the same time.
2. **A speakeasy DOES earn cash**, so gating it sits at the edge of the same line. It is built as the
   design names it (opening only — an existing owner keeps their house, and every other speakeasy verb
   stays open to everyone); the dial is one line in `openSpeakeasy`.
3. **The high-stakes stake changes an existing signed gate**: a level-30 player who could reach the
   big table before now also needs 50 $OMR staked. That is the design's intent (the stake exists to
   attach float to whales) but it is a real change to a shipped affordance.
4. **Whether whales actually commit** is not measurable from arithmetic. Watch realised $OMR loot per
   kill in the alpha rather than P9.30's numbers.

---

## THE RARITY NFTs (economy v3 step 7, 2026-08-02) — SIGN-OFF LEVERS

Cars and boats carry a rarity rolled when they are EARNED, and an owned one can be extracted on-chain
as a tradeable ERC-1155. Two levers, both new, both founder sign-off (pinned in `test/levers.js`).

| lever | ships at | what it decides |
|---|---|---|
| `RARITY.TIERS[].w` | 700 / 220 / 65 / 15 | the draw. A legendary lands on ~6.5% of earned items and an epic on ~1.5%, which is what a secondary buyer is actually pricing — scarcity is the only thing rarity does. |
| `RARITY.UPGRADE_OMR` | 0 / 25 / 90 / 300 | the one price money pays. Buying common → epic outright costs 415 $OMR, deliberately steeper than the drop is rare, so grinding for the roll stays the cheap path and paying is the impatient one. |

**§10.4: one reason, and it is a sink.** `rarity:upgrade` is a $OMR burn in `DESK.SINK_REASONS`, so
like every sink since step 2 it recycles to the desk's shelf rather than being destroyed. Rarity
itself is status and extraction is an ownership move, so neither writes a ledger row — asserted in
`test/nft.js` rather than assumed. Nothing here is a faucet.

**The one thing NOT to retune without reading §7 first: the upgrade must stay DETERMINISTIC.** Pay
the tier's price, get exactly that tier. A random paid upgrade would be a loot box bought with a
token people reach through ETH, which is the question the design's "sell deterministic, drop random"
rule exists to avoid entirely. Making it a roll is a legal decision wearing a balance decision's
clothes.

**Not a balance flag, but the number that governs supply:** each tokenId's LIFETIME cap is set by the
Safe on `GearVault` at deploy and is fail-closed at 0 (an un-capped class simply cannot mint). That
cap — not the weights — is what bounds how many "1978 Sedan (Epic)" can ever exist on-chain.

---

## THE DECISION PACKAGE — D5 / D6 / D7 / D8 / D9 (founder-answered 2026-08-02)

The A/B/C sheet in `SIGN-OFF.md` was answered in full. Five of the fifteen move a signed number or a
gate; this is the record of what changed and what it cost. The rest are elsewhere: D11 retires the
Portfolio, D13/D14/D15 are the progression package, D1–D4 are chain decisions, D10 and D12 changed
nothing.

### D6=B — the pad can no longer outrun the till

`CONSTANTS.BUSINESS_UPKEEP_CAP_MS` **7d → 2d**.

A front's till holds 24h; the protection envelope ran seven days. Past **five days away** squaring up
cost more than the front could ever hand back, so abandoning an entry-tier asset became the rational
move after a normal week off — a tester found it and their arithmetic was exactly right. At a 2d cap
the pad tops out at 2× the till, so neglect still costs real income (the take stopped banking at 24h
and the front goes COLD at 3d, both unchanged) but the loss can no longer go NEGATIVE at any absence.

The disclosure work and the shutter door from the earlier pass stay — they were the fix for the
*defect*; this is the fix for the *shape*. `test/economy.js` now asserts the crossover is gone from
the CONSTANTS at the worst case (a five-front stack on the top progressive rate), so a future retune
that stretches the cap or steepens the pad fails by name rather than quietly restoring the trap.

### D7=C — the nut is bounded, and that is all it is

`M4.CREW_WAGE_CAP_MS` **7d → 2d**.

Stated precisely, because C **softens** the crossover rather than removing it. A hand draws $1,200/hr
on the wall clock while offline sales cap at 8h, and only raising `OFFLINE_CAP_MS` would close that —
which moves every offline faucet in the game, so it was the wrong tool for a kitchen problem. What the
cap buys is that **the loss stops growing**: three days away goes 0.40:1 → 0.60:1, and a week away is
no longer any worse than three days. Absence has a floor. An attentive owner is unaffected; they were
never near the cap.

### D8=C, THEN D8=D — the gates came back, and §4.3 went (founder, 2026-08-02)

D8=C briefly narrowed the subscription to status only. The founder then **retired §4.3 itself — $OMR
may buy POWER** — and answered **D8=D**, so both retired ACCESS gates are back and there is a new
power layer. Recorded in full because §4.3 is cited at ~15 sites and a reader who finds one needs to
know it no longer binds.

**What replaces §4.3 is a CEILING, not a category.** Three bounds, and the first is the whole claim:

1. **Power is capped, and the cap is reachable without paying.** `MADE_LADDER`'s top rung is **150
   staked**; the mission ladder alone pays **220 $OMR lifetime**. `test/made.js` pins that relation
   against the LIVE `MISSIONS` table, so retuning either the ladder or the missions fails by name
   rather than quietly making the player-facing copy false.
2. **No combat power at any price** — and that is a LOOP argument, not a fairness one. Offensive power
   makes paying players predators on free ones, which empties the free population that makes the
   streets worth walking; defensive power makes made men harder to rob, which directly undercuts
   *"a free man can hunt you for your $OMR"* — the loop the float exists to create. Combat is the one
   axis where power costs you the thing power is supposed to feed.
3. **Operating costs stay in cash.** §11.2's line is untouched: nobody must pay to keep earning. A
   ladder you may climb is a premium tier; a bill you must pay is a rented game.

**THE LADDER keys on HELD $OMR, not spend, and that is the load-bearing choice.** Attached to the
subscription, power creates demand to SPEND (revenue and deflation, no float). Attached to the staked
balance it creates demand to HOLD — which is the float, and what makes `OMR_LOOT_COMMITTED` mean
anything and killing a made man worth the ammo.

| Rung | Staked | Trunk | Energy cap | Nerve cap | Garage | Fence |
|---|---|---|---|---|---|---|
| Earner | 10 | +1 | +5 | +1 | +1 | — |
| Operator | 30 | +2 | +10 | +2 | +2 | — |
| Capo | 75 | +3 | +15 | +3 | +3 | +2.5% |
| Kingmaker | 150 | +4 | +20 | +4 | +4 | +5% |

`MADE_LADDER.MADE_RUNGS` = **1** — dues climb the ladder by a rung and CLAMP at the top. **A shortcut,
never a gate**, and that is a deliberate deviation from the shape first proposed, driven by a
measurement: $OMR has had no faucet since v3 step 1, so a free player's lifetime supply is the mission
ladder. Requiring both a 20/month burn AND a held stake would put the ladder out of a free player's
reach entirely and break bound 1.

**The one economic edge is the FENCE**, at the top rung. Chosen over front/racket income (just trimmed
by L1a/L1b — reopening it undoes that work) and over the business income cap (entangled with the D6
pad decision made the same day). The fence is an ACTIVE loop — you have to boost the car — so the
ladder rewards playing rather than idling, and it composes onto the existing `fence_network`/`kingpin`
skill chain as one more multiplicative term. It is the only ladder number that moves a signed faucet.

**The access stake is AND'ed with the seat, not OR'd**, restoring the original §11.5 shape. OR was
considered and rejected on measurement: it would let a level-30 player sit down holding nothing, so
the only players who ever staked would be the ones with the least $OMR and the float would be worth
nothing. The cost is that a level-30 player who had the table before D8 must now hold to keep it —
pre-launch that is a design choice, not a migration.

**The player-facing copy changed, and had to.** `made.js:buysNoPower`, `/v1/rules.made.buysNoPower`,
the landing page and MARKETING.md all promised *"no pay-to-win"*, which stopped being true the moment
this shipped. All four now make the ceiling claim instead. The Store's own claim is untouched and
still true — ETH packages still grant only cosmetics, access windows and consumables, never $OMR.

**Sensitive, and flagged for the counsel packet:** this game has real-money extraction, so the chain
is real money → in-game earning power → $OMR → the Window / the withdrawal rail. That is a materially
different product posture from "pay for cosmetics" and belongs in front of counsel beside the bond and
the Store, alongside the standing no-earnings-promise rule.

**Asserted from both sides in three suites** (`test/made.js`, `test/speakeasy.js`,
`test/underworld.js`): an unmade man is refused a club then admitted the moment he pays; level alone
will not seat a whale until he holds the stake; the velvet rope is the SEAT half only. Five mutations
each fail at their own named assertion — and a sixth SURVIVED first: comparing the observed climb to
`MADE_RUNGS` is vacuous, since zeroing the lever makes both sides agree. The lever is now pinned
separately (`MADE_RUNGS >= 1`), the `LEVEL_UP_REFILL_MAX_DAY > 0` shape.

**Open for the alpha:** whether the fence edge wants to be bigger (it is deliberately the smallest
change that makes the top rung worth reaching), and whether a second economic slice belongs at Capo.

### D5=B — NFT supply caps scale by rarity

`RARITY.SUPPLY_CAP` = **1000 / 300 / 60 / 10** (common / rare / legendary / epic), per token id.

Deploy config rather than runtime logic — GearVault caps each id for life and fails CLOSED at zero, so
this table is what actually bounds scarcity while the draw weights only decide how often a rarity is
earned. `npm run gearcaps` generates the 264-row deploy table from the live catalogs (and asserts no
two classes share an id, which would mean sharing a lifetime cap); CHAIN-DEPLOY.md consumes it. A new
car or boat therefore cannot ship without a cap decision.

### D9=A — the rarity draw and upgrade prices ship as they are

70 / 22 / 6.5 / 1.5% and 25 / 90 / 300 $OMR per step. Revisit when there is a real secondary market to
measure — scarcity is only meaningful against demand, and there is no demand yet.

---

## THE STRATEGY PACKAGE (founder-directed 2026-08-02: "apply all your strategy decision recommendations")

The diagnosis that produced these was not "the game needs more content" — it was that the game has
**enormous breadth of ACTIONS and almost no scarcity of OPTIONS**. Nearly every choice is *when*, not
*instead of*. Where a decision costs you nothing you did not want anyway, it is not a decision.

### 1. SEASON_MODS armed (was dormant)

`seasonModOf`'s env default flipped `off` → `on`. This is the one shipped drop that twists SIGNED
levers by design (laylow ×0.75, law-gain ×1.25, kill loot ×1.15, safehouse ×1.25, goods-sell ×1.03,
one season in four vanilla), which is why it shipped dormant pending sign-off. It is armed now because
it is **the cheapest strategic lever the game has**: the whole base re-plans around the same twist for
28 days, it reuses content that already exists, and it costs nothing to build. `SEASON_MODS=off`
reverts to vanilla with no deploy, and the pin is regression-tested in both directions.

**Test discipline this forced, and it matters:** the suites measure the SIGNED baseline, so with the
draw live they became date-flaky — a run in a Blood-in-the-Streets season loots 15% deeper and the
exact-number assertions fail three weeks later for no reason anyone can see. That is the recorded
class (the population duel-ladder flake, the Doc-drill flake, the kitchen-raid flake): *a
deterministic assertion resting on a probabilistic precondition.* Affected suites now pin
`SEASON_MOD=dead_quiet`; `test/seasons.js` is the one that exercises the armed path, including the
kill switch.

### 2. THE OPERATION SLOTS — scarce holdings

| Lever | Value | What it does |
|---|---|---|
| `OPERATIONS.SLOTS_BASE` | 2 | operations you may run at level 1 |
| `OPERATIONS.SLOTS_PER_LEVEL` | 4 | one more seat every 4 levels (the `SKILLS.LVL_PER_POINT` cadence) |
| `OPERATIONS.SLOTS_MAX` | 12 | …to a hard 12 — ~39% of the 31-entry metered catalog |
| `OPERATIONS.RACKET_RETIRE_BPS` | 0 | what retiring returns; 0 moves no value, so it needs no sign-off |

The measured problem (P9.20b, since 2026-08-01): 31 income holdings — 18 `RACKETS` + the 13 Legit
Fronts `ASSETS` — every one paying back in **0.58–2.98 days**, none in the healthy 3–14 day band, and
**nothing competing for the seat**. So the mid-game's buy decision was *"have I clicked it yet"*.
A shared slot pool makes it *"which 12 of 31"*.

**Measured after (P9.20b, prints every run):** best-12 = **$243.9M/day** vs all-31 = **$260.3M/day** —
a **1.07× cut**. That number is the honest headline and it cuts against reading this as a nerf: the 12
richest rungs already carried nearly all the income, so what the cap removes is **the 19 marginal
rungs nobody was choosing between**. The early curve is where it bites — best-affordable-at-level is
**$64.8M/day at level 1 (2 seats)** → **$90.8M at 20 (7)** → **$98.4M at 40 (12)**; a level-1 player
with unlimited cash cannot buy past two operations, which is the "affordability was never the gate"
finding turned into a gate.

Deliberately **not** metered: the Wheels and Property asset categories (stat/cargo/energy-cap
progression — metering them would be a pacing change wearing an economy change's clothes) and business
fronts (already capped at 5 by `UNIQUE(character_id, kind)`). §10.4-free by construction: a slot is a
COUNT of rows you already own; retiring at 0 bps writes no ledger row, which the test pins.

**Open for the alpha:** whether 12 is the right ceiling (the 1.07× figure says the income cost is
small, so the ceiling is a *decision-space* dial, not an economy one), and whether
`RACKET_RETIRE_BPS` should rise above 0 — note that raising it makes churning the catalog cheaper,
which is the one thing that would undo the mechanic.

### 3. THE WATCH — a time window on turf

| Lever | Value | What it does |
|---|---|---|
| `M3.WATCH_WINDOW_H` | 4 | how long the declared window stays open |
| `M3.WATCH_SURPRISE_MULT` | 1.5 | what taking the district OUTSIDE that window costs |

Turf changed hands as a **one-sided instant purchase**: the holder had no move, and no reason to be
anywhere in particular. A holder now DECLARES the UTC hour their family stands ready
(`POST /v1/districts/:id/watch`, free, boss-only, changeable — the cost of the decision is having to
BE there); taking the district outside that window costs the surprise premium.

Deliberately a **PREMIUM, not a LOCKOUT**. A hard EVE-style window would make turf untakeable 20
hours a day and stall the whole war loop in a thin alpha population. A premium keeps every hour
playable while making WHEN a real decision on both sides — the holder picks a window they will
actually be online for, so attacks concentrate where they can answer; the attacker chooses between
the plain price and paying to catch them cold. An UNDECLARED district is dear at every hour, so the
declaration is what *buys* the cheap window rather than being a free shield.

§10.4: it scales the EXISTING `turf:seize:` treasury sink — no new reason, no new faucet, and the
vocabulary check is unmoved (asserted).

**A live bug this found.** The sovereignty vulnerability window (`sov.js:windowOpen`) read
`cityHourOf(now)` as a NUMBER, but it returns `{hour, patrol, phase}` — so `hr - start` was NaN and
the comparison was **false for every start hour at every clock time**. The window has been
PERMANENTLY SHUT since it shipped: `siegeSov` threw `window` forever, and the sov map published
`vulnerable: false` on every stronghold. The siege test never caught it because it sets
`SOV_WINDOW_OPEN=on`, which short-circuits above the broken line — **a TEST-ONLY override masking a
dead production path**, which is the "a check that cannot fail reads exactly like a clean bill of
health" class in its live form. Fixed in both places.

### 4. THE SEALED BID — the simultaneous decision

| Lever | Value | What it does |
|---|---|---|
| `M3.CONTEST_MS` | 1,800,000 (30 min) | how long the contest window runs (the WAR_MS precedent) |
| `M3.CONTEST_LOSS_BPS` | 5000 (50%) | what a LOSER forfeits of what they put up |

Turf's price was **public and known**: read `garrison` off the board, pay
`max(SEIZE_BASE, garrison × SEIZE_OUTBID)`, done. The attacker always moved last with perfect
information and the holder never moved at all — no simultaneity, no bluff, no commitment.

A district **a family holds** now changes hands only through a sealed contest
(`POST /v1/districts/:id/claim`). Every family commits a SECRET stake from the treasury; when the
window closes the highest commitment takes the district, **the holder wins ties** (you have to beat
a family off its own turf, not merely match it), and the winning stake becomes the new garrison — so
defending is expensive and buys a dearer door next time. Unheld and NPC-occupied districts still
fall to an outright claim: there is nobody on the other side to contest with.

**The two cannot coexist on the same district**, and that is the load-bearing decision rather than a
preference: if a buyout is available at price P, nobody bids above P and the contest is theatre. So
`seizeDistrict` now refuses a player-held district outright (`contested`), and a live contest also
freezes an unheld one — otherwise a family that had already staked could be undercut at the base
price the moment the incumbent dissolved mid-window.

**`CONTEST_LOSS_BPS` is what makes it a sealed bid rather than "always commit everything."** A loser
gets the rest back but forfeits this share, so over-committing against a family that was never
coming costs real money. Stakes are ESCROWED at commit time, so a bid is a commitment and not a
bluff — you cannot threaten with treasury you have already spent, and you cannot pull it back
(`raise`: a stake only goes up).

THE WATCH composes underneath it rather than being replaced: the surprise multiplier now scales the
**floor** under a stake rather than an instant price. Bidding outside the declared window raises what
it costs to get into the contest at all.

§10.4: three new reasons under one `turf:claim` vocabulary prefix — `turf:claim` (treasury → escrow),
`turf:claim:refund` (a loser's kept share home) and `turf:claim:burn` (the winner's whole stake, plus
every forfeit, leaving for good). A new **`turf contest escrow`** check reconciles the open pot
against the ledger the market/bounty/favor way: `Σ open == staked − refunded − burned`. A family that
dissolves mid-contest burns its whole stake (the dead-funder precedent) — its treasury is already
gone, so there is nothing to refund and no double-count.

Both numbers are founder sign-off levers. `CONTEST_MS` is the tension dial — short enough that a
contest is a live event somebody has to answer, long enough that a holder who is not staring at the
screen gets a chance. `CONTEST_LOSS_BPS` at 0 would make a losing stake free and collapse the bid
back into "everyone commits their whole treasury every time."

### 5. THE ROSTER — the family's made men as scarce posts

| Lever | Value | What it does |
|---|---|---|
| `M3.ROSTER_MIN_LEVEL` | 5 | a man has to be somebody before he holds a post |
| `M3.ROSTER_REASSIGN_CD_MS` | 21,600,000 (6h) | how long before you can move the SAME man to a different post |
| `M3.ROSTER_POWER_DIV` / `_POWER_MAX` | 10 / 8 | power = min(8, floor(stat ÷ 10)) — the man matters, bounded |
| `M3.ROSTER_MULT_FLOOR` | 0.7 | no discount goes below this however good the man is |
| `M3.ROSTER_ENFORCER_GARRISON` | 6,000 | + per power onto what a RIVAL must stake to contest your turf |
| `M3.ROSTER_CAPO_SCRUTINY_PER` | 0.04 | Bureau scrutiny GROWTH on your operations, per power |
| `M3.ROSTER_STREETBOSS_WAR_PER` | 0.03 | the war chest, per power |
| `M3.ROSTER_QM_GUARD_DEF` | 3 | + per power onto your family's convoy guards |
| `M3.ROSTER_BAGMAN_UPKEEP_PER` | 0.03 | the operations pad, per power |

Steps two and three made turf a decision about WHEN and HOW MUCH. This one is about WHO. A family's
made men were interchangeable — a 20-man family and a 3-man family differed only in raw stats, and
every collective system (turf, war, freight, the Bureau, the pad) ran with no allocation decision at
all. Now the family fills five POSTS: **one post per man, one man per post**, so your best cunning
can keep the Bureau off your operations OR keep the pad cheap, never both.

**The teeth are the LIVE gate, not the numbers.** A post counts only while its holder is alive, out
of lockup and out of the hospital. Kill or jail a family's Enforcer and their turf gets cheaper to
take until they put somebody else in the chair — and the reassign cooldown is on the MAN, so the
replacement has to come off the STREET rather than out of another post. That is what makes this
strategy rather than a settings screen: the PvP layer that already exists is how you contest it.

Every effect is ONE touchpoint and **ADDITIVE** — nothing a family has today gets worse, so this
needed no economy retune and breaks no existing player. The scarcity is that filling one chair means
not filling another, not that the baseline moved.

§10.4 is untouched: an assignment moves no currency and writes no ledger row. Two of the five posts
are SINK DISCOUNTS (`gang:war`, `territory:upkeep`) and in both the DISCOUNTED number is what leaves
the treasury AND what is ledgered — the decree/amnesty/coalition discipline — so the gang-treasuries
check reconciles the smaller figure exactly like the larger one (asserted to the dollar).

The two dials that matter: **`ROSTER_POWER_MAX`** bounds what one great man can be worth (at 8 the
top of each effect is +$48k on a turf floor, −24% on the pad — real, not decisive), and
**`ROSTER_MULT_FLOOR`** is the hard floor under both discounts. `ROSTER_ENFORCER_GARRISON` is the
one that composes with the sealed bid and the watch, so re-read that interaction before moving it.



## THE FAMILY LEDGER — is the family treasury scarce? (measured 2026-08-02, sim P9.20d)

The strategy package put every one of its tradeoffs on the FAMILY — which chairs to fill, when to
stand watch, how much to commit blind. A tradeoff only bites if the resource behind it is scarce,
and the family side had never been measured the way `P9.20b` measured the personal side. This is
that measurement, and it found the **same shape one level up**.

The honest metric is not what a family earns. It is what each strategic DECISION costs, priced in
**days of that family's own income** — because a decision costing a fraction of a day is not a
decision, it is a formality with a confirm dialog.

**The climb is sound.** Taking one district from Corner to The Syndicate is a genuine **~14 days of
daily collecting**, each rung funded out of the rung below (3.3d / 3.3d / 3.5d / 3.9d). That half of
the ladder is a wait, not a purchase, and wants nothing.

**The steady state is not.** A maxed family clears **$12.0M/day at one district, $34.4M at three,
$64.5M at six** (Syndicate operations net of the 20% pad, plus strongholds net of overextension —
which correctly turns NEGATIVE past a few districts — plus $157k/day of frontier tribute).

| recurring decision | cost | days of a 6-district family's income |
|---|---|---|
| declare war | $10,000 | **<0.01** |
| siege a rival stronghold | $50,000 | **<0.01** |
| invade a frontier outpost | $50,000 | **<0.01** |
| take an unheld district (floor) | $30,000 | **<0.01** |

**4 of 4.** The one-time build-out — every operation maxed and fortified with a stronghold on every
district — totals $538.8M, about **8 days** of income, after which the recurring menu above is all
that is left to spend on. `WAR_COST` is the sharpest: **$10,000 against $64.5M/day means declaring
war is free for anyone who has arrived.**

**The one cost that scales is the contest ratchet**, and it is the model for the rest: a contest
floor is `max(SEIZE_BASE, garrison × SEIZE_OUTBID)` and the WINNER'S WHOLE STAKE becomes the
garrison, so contested turf gets dearer every time it changes hands — $30k → $45k → $67.5k → $101k →
$152k → $228k over six fights, ×1.5 again off-window under THE WATCH, plus the Enforcer's premium.
Stated honestly: even $228k is only 0.35% of a day at the top, so the ratchet needs many fights on
one district before it bites — it is the right SHAPE at the wrong starting point.

**FLAGGED, NOT APPLIED (ground rule #1 — these are signed levers).** The dial is to INDEX the flat
costs to something the family's own success moves, not to raise them: raising a constant only moves
which week it stops mattering. Three candidates, cheapest first —

- **`M3.WAR_COST`** → a floor plus a slice of the declaring family's holdings or treasury. The
  single highest-value change on this list, and roughly one line.
- **`M3.SEIZE_BASE`** → index the opening floor to the target's operation tier, so a contest over a
  Syndicate district opens dearer than one over a Corner (the ratchet then compounds from a real
  number instead of $30k).
- **`SOV.SIEGE_COST` / `FRONTIER.INVADE_BASE`** → the same treatment, or leave: both already gate on
  a cooldown, so their scarcity is TIME rather than money and that is a defensible design.

The verdict for the strategy package: its tradeoffs bite hardest on families too new to feel them
and barely at all on the ones the endgame is for. Re-run `P9.20d` after any of the above moves.

### VALUE-AT-STAKE INDEXING — APPLIED (founder-directed 2026-08-04, base = "value at stake", "bite hard")

The founder chose to index the two FULLY-FLAT costs to **what's at stake** (not the attacker's
holdings or standing), biting at a real fraction of income. Built:

| cost | was | now | base = the value at stake |
|---|---|---|---|
| `declareWar` | flat `M3.WAR_COST` $10k | `max(WAR_COST, targetTreasury × M3.WAR_COST_BPS)` | the TARGET's treasury — spoils are `WAR_SPOILS` (20%) of it, so you ante a cut of what you'd win. A $5M-treasury rival costs $100k to declare on; a maxed rival ~$1.29M (0.02d, out of the "pocket change" bucket) |
| `siegeSov` | flat `SOV.SIEGE_COST` $50k | `max(SIEGE_COST, tierCost × SOV.SIEGE_COST_BPS)` | the target stronghold's BUILD COST — tearing down The Iron Capital ($40M built) costs $1.2M, a Bastion $150k; the $50k floor binds through Citadel, so the low-tier on-ramp is unchanged |

`M3.WAR_COST_BPS` (200 = 2%) and `SOV.SIEGE_COST_BPS` (300 = 3%) are **founder sign-off levers**
(pinned in `test/levers.js`). Both keep the floor at the old constant, so a fresh/broke target is
unchanged (which is why the `social.js` war flow and the low-tier siege tests are untouched). The
coalition/streetboss war discounts still multiply the scaled base (the discounted number burns AND is
ledgered — the decree discipline), so `gang:war`/`sov:siege` remain treasury cash SINKS and §10.4 is
**untouched** (no new reason, no new bucket — only the amount scales; the P10 sweep stays drift-0).
The console surfaces the price before committing (per-structure `siegeCost` on the sov board; a war
label noting the chest scales with the target's treasury). `test/expansion.js` proves both scalings
(mutation-verified by name); `sim P9.20d` now prints war/siege out of the trivial bucket (4 flat →
**2 flat**). **The two remaining flat entries — invade a frontier outpost, take an unheld district —
were DELIBERATELY LEFT** on the garrison ratchet (`max(BASE, garrison × OUTBID)`): the incumbent's
garrison IS the value at stake there, and a fresh/unheld target being cheap is the intended turf
on-ramp. `M3.SEIZE_BASE` opening-floor indexing (to the target's operation tier) remains an OPEN dial
if the founder wants the ratchet to compound from a bigger opening number.

## THE STRATEGY PACKAGE — step five: THE MAP (founder-directed 2026-08-02)

The six core districts were a flat SET: every holding interchangeable, so THE WATCH and THE SEALED
BID were decisions about unrelated squares rather than moves on a board. Every strategy game's map
IS its strategy, and this one had none — no adjacency, no chokepoints, no "you cannot hold that
because it is cut off."

`DISTRICTS` is MACHINE-OWNED, so the edge list lives in the hand-written tail (`DISTRICT_ADJ`),
which is the right seam anyway: geography is an authored layout, not a table the prototype has an
opinion about. The layout gives two ENDS (docks, cathedral — degree 2, the natural on-ramps) and a
dense middle; symmetry is asserted, because a border that exists on one side only would make the
same frontier cost two prices depending which way you read it.

Two effects, both inside the ONE `turfQuote` the outright claim and the contest floor both read:

| lever | value | what it does |
|---|---|---|
| `MAP.NEIGHBOUR_PREMIUM_MULT` | **1.10** | a held district is dearer ONCE PER bordering district the same family holds — contiguous turf defends itself |
| `MAP.ADJACENT_MULT` | **0.85** | an attacker holding something next door pays less — ONE foothold discount however many borders they share |
| `DISTRICT_ADJ` | the edge list | which districts are chokepoints and which are ends |

**Both are MULTIPLICATIVE on purpose, and that is the family-ledger finding applied.** P9.20d found
every FLAT family cost becomes noise the moment a family is established — raising a constant only
moves which week it stops mattering — so anything added to the turf price from here indexes to the
price rather than sitting beside it. At three neighbours the contiguity premium is ×1.331, which is
a real number against a $450k floor where a flat $24k would not have been.

§10.4 untouched: geography scales the EXISTING `turf:seize:` / `turf:claim` sinks. No new reason, no
new faucet, and the vocabulary check is asserted closed in the same block.

**The dials.** `NEIGHBOUR_PREMIUM_MULT` is how much a wall is worth — raise it and empires become
hard to crack once formed, which is snowball risk; lower it and geography stops mattering.
`ADJACENT_MULT` is how much a foothold is worth, and it is the anti-snowball counterweight: it helps
whoever is expanding INTO a bloc, so the two levers are deliberately pulling against each other.
Re-run `P9.20d` after moving either — the family ledger is where the effect shows up.

## THE STRATEGY PACKAGE — step six: FAMILY CHARTERS (founder-directed 2026-08-02)

Every family was mechanically IDENTICAL apart from what it happened to hold. A 20-man family and a
3-man family differed in scale, never in kind, so "who are we" was not a question anybody could
answer differently — and an alliance between two families was purely additive, because both sides
brought the same thing in different amounts.

A charter is what the family IS: one axis it is good at, one it gives up. Chosen by the boss, free
the first time, and a real $OMR sink from the reserve to change afterwards.

**THE HANDICAP IS THE MECHANIC, and it is asserted rather than described.** A catalog of pure
upgrades is not asymmetry, it is a menu everybody picks the top of and then nothing is asymmetric
again — so `test/social.js` walks the catalog and fails if ANY charter carries only multipliers that
help. That is what a retune has to get past, not a comment.

| charter | the edge | the handicap |
|---|---|---|
| **The Syndicate** | operations run 15% leaner (`upkeepMult` 0.85) | taking turf costs 15% more (`turfMult` 1.15) |
| **The Outfit** | takes ground 15% cheaper (`turfMult` 0.85) | operations cost 15% more to run (`upkeepMult` 1.15) |
| **The Fixers** | the Bureau heats operations 25% slower (`scrutinyMult` 0.75) | a losing contest stake forfeits 25% more (`contestLossMult` 1.25) |

| lever | value | what it is |
|---|---|---|
| `FAMILY_CHARTER_FX.EDGE` | **0.85** | what your strong axis costs you |
| `FAMILY_CHARTER_FX.COST` | **1.15** | …and what the axis you gave up costs you |
| `FAMILY_CHARTER_FX.HEAT_EDGE` | **0.75** | the Fixers' Bureau pace |
| `FAMILY_CHARTER_FX.LOSS_COST` | **1.25** | …paid for when a hedge fails |
| `FAMILY_CHARTER.CHANGE_OMR` | **40** | re-founding, from the family reserve |
| `FAMILY_CHARTER.CHANGE_CD_MS` | **7d** | …and how often |

**NO CHARTER is a legitimate fourth answer.** An unchartered family gets neither side and is
byte-for-byte today's family, which is what makes choosing a real bet rather than a formality — and
it is also why this needed no economy retune and breaks no existing family.

**The Syndicate and the Outfit are deliberate MIRRORS on the same two axes** — do you earn or do you
fight — which is what makes an alliance between them complementary rather than merely additive: a
Syndicate family funds an Outfit family's wars, and each is buying the thing it is bad at. The
Fixers sit on different axes entirely and are the interesting third pick.

**§10.4 untouched.** Two of the effects are sink multipliers (`territory:upkeep`, `turf:seize:` /
`turf:claim`), one is Bureau pacing, one is how much of a losing stake refunds — and in every case
the MODIFIED number is what is charged AND what is ledgered (the decree/roster discipline), so the
gang-treasuries check reconciles the smaller — or larger — figure exactly. The re-founding fee rides
`vanity:charter`, which is inside the existing `vanity:%` burn term and vocabulary, so the invariant
file needed no change at all.

**Fixed while here (a pre-existing mirror gap):** `territoryOf` quoted the pad WITHOUT the Bagman's
discount, so a family with a money man on the books was shown a figure the treasury then disagreed
with. Adding a second modifier to a number the board already got wrong would have widened that, so
both are mirrored properly now — board and till read the same `familyMults`.

**The dials.** `EDGE`/`COST` are how sharp the identity is: at 1.0 both, a charter is cosmetic; far
apart, the pick decides the whole family's shape and a wrong pick is punishing. `CHANGE_OMR` and
`CHANGE_CD_MS` decide whether a charter is a commitment or a costume — the cooldown is armed only by
a PAID re-founding, never by the free first pick, because the trap the free pick exists to avoid is
the decision made before you knew what the choices meant.

## THE STRATEGY PACKAGE — THE GARRISON RATCHETED DOWN (2026-08-02, FIXED 2026-08-03)

The package's own audit (`AUDIT-strategy-package.md`) fixed four defects and left exactly one thing
for the founder, because it is a balance decision rather than a bug.

**What happens.** A contest's winning stake becomes the district's new garrison, and a stake only
has to clear `turfQuote`'s cost — which is the outbid price multiplied by every discount that
applies to that attacker at that moment:

| discount | value | when it applies |
|---|---|---|
| coalition vs a hegemon | `DIPLOMACY.COALITION_SEIZE_MULT` **0.5** | an armed coalition against the holder |
| the foothold | `MAP.ADJACENT_MULT` **0.85** | you already hold a district next door |
| the reckoning | `SEASON_PHASES` `floorMult` **0.75** | the season's last stretch |
| the Outfit charter | `FAMILY_CHARTER_FX.EDGE` **0.85** | your family made turf its speciality |

All four at once is **≈0.46**, so a family conquering under favourable conditions installs a
garrison roughly half what the previous holder paid — and the NEXT attacker's floor is computed from
THAT. A chain of favourable conquests walks a district's standing price down, bounded below only by
`M3.SEIZE_BASE`.

**Both readings are defensible, which is why it is not patched.** Every one of those discounts is a
deliberate reward for arranging something hard, and a cheap district is a CONTESTED district, which
is the entire aim of the package. Against that: the discount is meant to price *this* conquest, not
to become the district's value — and as built it pays out twice, once when you take the ground and
again for everyone who comes for you afterwards, including your enemies.

**APPLIED (founder-directed): the stored garrison is floored at what the ground was worth before** —
`max(winAmt, previous garrison)` in `settleContest`. A discount prices your CONQUEST, not the
district: you paid less for the same turf, and your enemies do not inherit your bargain. A stake
ABOVE the old garrison still counts in full, so a hard-fought district keeps every dollar of what it
took to win it, and a defender's stake (never discounted) clears the old value anyway, making the
floor a no-op on that branch.

**Two corrections to the numbers above, both found by building the regression rather than reasoning
about it.** First, the fall is **not** "roughly half": the 0.46 is the discount PRODUCT, but
`SEIZE_OUTBID` (1.5) is applied first, so the fully-stacked floor is `1.5 × 0.4607 = 0.69×` the
previous garrison — a ~31% fall per conquest, not ~54%. Second, the condition for any fall at all is
`OUTBID × surprise × discounts < 1`, so the ×1.5 surprise premium on an undeclared or off-hours watch
**cancels the ratchet on its own** — it only bites on an attack landing inside the holder's declared
window. Measured in the regression at three of the four discounts (reckoning + Outfit + foothold,
watch open): a floor of **$162,562 against a $200,000 garrison**, i.e. −19% per conquest, compounding.

**Why not the other two dials.** (a) as first written — store the undiscounted `base` — throws away
the winner's over-commitment: a family that staked $10M on a $200k district would install a $300k
garrison and hard-won ground would be cheap again immediately. It also forces a ×1.5 rise on *every*
change of hands, which is monotone inflation rather than a fix. (c) capping the discount product
weakens the rewards themselves, which is a balance change; this is not. Nothing signed moved — the
change is *which* number gets stored.

## NPC FAMILIES — somewhere to join (founder-directed 2026-08-03)

Design + the decisions behind each exclusion: `omerta-npc-families-design.md`.

The coach's first social rung — *"Nobody survives alone"*, banded to levels 3–12 — held **43% of
advised play** across a 7-day solo harness run and could never be acted on: `GET /v1/gangs` is empty
on a thin server, so the only actionable half is FOUNDING one, at level 5 and $25,000, which a
level-3 player does not have and which gives them a family of one. Residents now found and fill
families, so there is somewhere to walk in.

**This adds no faucet, and that is structural rather than incidental.** The founding cost is paid by
a resident out of its own `npc:seed` cash through the audited `createGang`, so the only §10.4 rows
step one can write are `gang:found` (a SINK) and `gang:dissolved` (the existing dissolution burn).
The resident economy can only get *smaller* from it, and the extraction ceiling measured under THE
STREET WAR step two is unchanged.

| lever | ships at | what it does |
|---|---|---|
| `POPULATION.FAMILIES.TARGET` | 3 | families the worker keeps alive. **0 disables the whole feature.** |
| `POPULATION.FAMILIES.MIN_MEMBERS` | 2 | below this the worker recruits |
| `POPULATION.FAMILIES.MAX_MEMBERS` | 5 | far below `M3.GANG_MAX_MEMBERS` (20), so a player always fits |
| `POPULATION.FAMILIES.FOUND_BANDS` | capo, boss | the bands that can cover `M3.GANG_FOUND_COST` |

**What they deliberately cannot do, each decided rather than defaulted.** No Commission seat (a
decree moves signed surfaces — safehouse cost, war cost, laylow, convoy defence, the loot rate — and
a family that cannot vote does not merely abstain, it shrinks the electorate and makes deadlock more
likely). No family yield (that is a real §10.4 $OMR transfer into a reserve nobody can ever spend
from — a permanent sink wearing a payout's clothes, and a smaller pot for every real family). No
wars against them (an opponent that never retaliates makes war a fixed-price purchase of standing,
repeatable, with the treasury spoils on top). No turf, no territory, no strongholds.

Both exclusions are **true by construction today** — the queries require `standing > 0`, and a family
that neither pays tribute nor wins a war has none — but that is an accident of two other decisions,
not a promise. The explicit flag is what a test can pin, and what stops a later step (residents
paying tribute) from re-opening it silently.

**`invariants.js` must NOT exclude them**, and it does not: an NPC family's treasury is a real bucket
holding real ledgered value, so filtering it out would manufacture exactly the drift the check exists
to catch. Noted at both exclusion sites so the next reader does not "finish the job".

**Step two candidates, each wanting its own sizing pass:** NPC families that DEFEND (a war score, a
garrison, spoils worth taking — the cartel-outfit shape, which re-opens the standing faucet);
residents filling crew-heist roles (the co-op faucet measures 1.46× solo per member, so making it
solo-reachable on demand is an emission change); NPC-held turf on the OCCUPATION model rather than the
free-seize one; and residents paying tribute — which would give them standing, and therefore re-open
the two exclusions above.

## RE-SIM + EARLY-GAME HARNESS PASS (2026-08-03) — tokenomics-v2 severance measured, early game re-measured

Two harnesses run against HEAD (`af04b7f`) after the tokenomics-v2 migration and the early-game
content drops, since neither had been re-measured against the current tree. Both green; no lever
retuned (ground rule #1) — this is measurement, not a change.

### The re-sim (`npm run sim`) — §10.4 drift-0, and the v2 properties hold analytically

The sim carries dedicated `re-sim` probe rows that assert the severance directly, and they held:

| property | measured | note |
|---|---|---|
| §10.4 conservation | drift-0 over an entirely earned economy | the full P10 sweep passes; the run exits non-zero on any drift |
| a cash faucet can no longer move the token price | confirmed | the AMM sell side is retired; the only cash exit is the Exchange window ($OMR in, cash out, bounded by a sink-filled till). A bigger cash faucet now costs game balance, never token holders |
| $OMR emission | 0/day — bonds are the only mint | with cash severed AND the wage retired (v3 step 1), in-game $OMR can never exceed what was deposited. No cash back-door, no printer |

**Verdict: the largest open item is CLEAN.** The severance lowered the stakes on the internal-balance
flags (the passive stack at 2.3× the active grind, the apex world/boxing/racing purses, the port sale
curve, the npc:seed recycle at ~$499k/day) but did not answer them — those remain founder
PACING/CONCENTRATION calls, unchanged. The per-faucet $/day ceilings in P9.8–P9.22 are still the
numbers to tune against; the token model is no longer entangled with any of them.

### The early-game harness (`npm run playthrough`) — the coach walks, the cliff is traversable

A plausible solo player, no contact with another human. Result: **the coach walked 20 rungs and every
rung the player obeyed cleared — no masking defect.** The 17→30 content cliff is now traversable (the
crimes/missions expansion, the work board, the level-up refill, and the trades strip all landed):

| played | level | note |
|---|---|---|
| 2h | 13 | |
| 5h | 22 | |
| 10h | 35 | inside the recorded ±1 noise; the alpha speedrun reached 240 |

**THE REFILL CEILING probe: BOUNDED.** A raw crossing goes self-sustaining at level 90 (the next level
costs ~96 nerve, a crossing refills 100), but `PACING.LEVEL_UP_REFILL_MAX_DAY` (10) caps it at
≤10.43 levels/day at level 90 — flat in level (both terms are linear), so it stays that bounded at
every level above. The fix holds; the speedrun class is dead.

**The two rungs still at the top of the held-%-of-advised-play table are both STRUCTURAL, not defects:**

1. **"Pull a crew score" — 22%, never cleared.** A crew heist needs another player to fill a role, and
   a solo player has nobody. This is the single biggest remaining early-game friction, and it is
   exactly the **residents-in-crews** gap deferred under NPC families step two. See
   `omerta-residents-in-crews-design.md` (scoped this session).
2. **"You can get made for free" — 20%, a 2h03m wait.** Not masking — the player is grinding to afford
   the PLEX mint (payable in earned $OMR). Working as designed.

**Recommendation, backed by measurement:** the highest-leverage early-game build is now
**residents filling crew-heist roles** — it is the top masking rung and the only one uncompletable
solo. Scoped below-referenced; the emission concern the deferral flagged is answered by forfeiting the
NPC filler's cut (a resident seat conjures nothing, and a solo leader gets a *smaller* share than a
full human crew, so co-op stays a reason to find real people).

## THE HIRED HAND — residents fill crew-heist seats (BUILT 2026-08-03)

The re-sim/harness pass above named *"pull a crew score"* as the top masking rung in a solo run (22%,
uncompletable alone). Built per `omerta-residents-in-crews-design.md`: a leader with no real crewmate
hires an NPC resident into an open seat (`POST /v1/heists/:id/fill {role}`, leader-only during
planning). The hand is a real `is_npc` character (so `executeHeist`'s per-member lock/roll/gates are
unchanged), but at execute its pot share is **forfeited — never minted**, so the co-op faucet only
SHRINKS and §10.4 stays drift-0 (the hand earns no cash, no `heists_pulled`, no mastery, no RWA cut,
no respect; verified by a zero-`heist:crew`-rows-for-the-hand assertion + a full-suite reconcile). The
hand is stat-NEUTRAL (excluded from the roll average) so hiring a body is not a free success bonus.
A committed resident is made inert (the `eligible`/retire pickers skip anyone on a live plan — the one
population-side change). §10.4: one new reason, `heist:hire` (a cash SINK riding the existing `heist`
prefix — zero invariants change).

| lever | ships at | what it does |
|---|---|---|
| `HEIST_FILL_MAX` | 1 | fillers per heist. `0` disables; **1** makes only the 2-man entry job solo-reachable, keeping the marquee 3–5-man jobs (vault → Federal Reserve) genuinely multiplayer. The dial between "solo-reachable co-op" and "the marquee stays multiplayer" |
| `HEIST_FILL_FEE` | 5000 | cash sink to hire a hand — a small real cost on top of the forfeited share, so a hand is the fallback, never the optimum |

**Founder sign-off flag:** raising `HEIST_FILL_MAX` past 1 makes the marquee co-op jobs solo-reachable,
which re-opens the trivialization concern the deferral raised — the forfeited-cut design keeps the
emission bounded (a soloist's own share shrinks with every hand), but the cap is the real dial.

## THE HIRED HAND — measurement loop closed + red-team (2026-08-03)

Follow-up to the drop above. **Measurement:** `tools/playthrough.js` now hires a hand to complete the
crew-score rung (plan → fill → execute), so *"pull a crew score"* — the top masking rung a solo run had
named — CLEARS in a solo run (moved from `not tested` to the obeyed list; bands 2h/12, 5h/21, 10h/34,
inside the recorded noise). **Red-team** (`AUDIT-hired-hand.md`): no CRITICAL/HIGH, no §10.4 drift — the
emission forfeit, the roll neutrality, the lock order (fillHeist and executeHeist on one heist serialize
under the leader's `withCharacter`), and the population inert-guard are all clean (the guard is now pinned
by a direct SQL assertion in `test/heists.js`). One LOW flagged, NOT patched: a resident can be hired into
two concurrent plans (a benign, §10.4-neutral, pre-existing TOCTOU class — the same race two real
`joinHeist` calls have; the fix is `FOR UPDATE SKIP LOCKED` on the resident pick, which wants the `dbCaps`
pattern and isn't worth the machinery for a benign race).

## NPC FAMILIES step two — the DEFEND variant SCOPED (2026-08-03)

The next step-two candidate is scoped in `omerta-npc-families-defend-design.md`: NPC families become a PvE
antagonist (a garrison to grind, bounded loot from their own `npc:seed`-fed treasury, and — the "defend"
part — they retaliate via a worker-scheduled hospitalization, so war isn't a one-way purchase). **The
flagged risk (re-opening the standing faucet) is solved by construction:** the war score is a SEPARATE
account-level "blood war" legend (the `war_effort`/hitman-rep twin), NEVER `season_wars`/`lifetime_tribute`,
so beating NPC families buys a feared-warlord status but **zero Commission seats** — modelled on the WORLD
outfit (`WORLD_NPCS`), not the player-gang `declareWar`. No turf (avoids the World-OCCUPATION overlap), no
Commission seat, no yield (the step-one exclusions stand). Needs a sim sizing pass (the garrison/RAID_BPS/
regen/retaliation numbers, benchmarked below the weakest World outfit) before build — hence SCOPED.

## THE BLOOD WAR — NPC families as a PvE antagonist (BUILT 2026-08-04)

NPC families step two, the DEFEND leg (`omerta-npc-families-defend-design.md`, `src/npcwar.js`). NPC
families become attackable outfits on the WORLD-raid pattern: `raidFamily` (`POST /v1/npcfamily/:id/raid`)
loots a bounded slice of a regen-bounded `war_pool` (energy + ammo + heat + a per-attacker cooldown; a
muscle+cunning/2 contest vs a pool-scaled garrison, so grinding a family down makes it both easier and
lower-loot — the World interlock). **THE DEFENCE:** a landed raid rolls a counter (`COUNTER_P` 0.35) that
hospitalizes the raider — they hit back, so a raid is a real risk, not a fixed-price buy. **THE
SEVERANCE (the whole design):** the war score is a SEPARATE account-level `family_war` legend
(`FAMILY_WAR.RANKS`, `GET /v1/leaderboard/blood-wars`) that NEVER touches `season_wars`/Commission
standing — mutation-verified. §10.4: `family:raid` is a bounded cash FAUCET + ammo SINK (the `family:`
prefix joined both vocabularies; `war_pool` is a strength reservoir, not a §10.4 bucket — the World
precedent); the step-one exclusions (no Commission seat, no yield, no turf, un-declarable) stand.

**Measured (sim, the blood-war probe, prints every run):** ≤ **$96,000/day/family → ≤ $288,000/day
base-wide** across the 3 NPC families — regen-bounded, below the weakest World outfit (Dock Rats $150k)
by design since the pool is turnover-adjacent. A raider caps at 6/day × $6,000 = $36k/day per family
before regen bites. Petty vs the passive stack; §10.4 drift-0.

| lever | ships at | what it does |
|---|---|---|
| `FAMILY_WAR.POOL_MAX` | 120000 | the loot reservoir at full strength (< Dock Rats 150k). The faucet-size dial |
| `FAMILY_WAR.POOL_REGEN_HR` | 4000 | regen → the base-wide ceiling is `TARGET × this × 24` |
| `FAMILY_WAR.RAID_BPS` / `RAID_MAX` | 500 / 20000 | the bounded per-raid loot |
| `FAMILY_WAR.RAID_CD_MS` | 4h | per-attacker cooldown — bounds farming across all families |
| `FAMILY_WAR.COUNTER_P` | 0.35 | THE DEFENCE — chance a landed raid hospitalizes the raider |
| `FAMILY_WAR.BASE_P`/`DEF_MAX`/`DEF_SCALE`/`MIN_P`/`MAX_P` | 0.55/60/300/.1/.9 | the contest curve |

**Founder SIM sign-off flags:** the `family:raid` faucet is a NEW (small, bounded) emission surface —
`POOL_MAX`/`POOL_REGEN_HR` are the magnitude dials if the base-wide ceiling wants trimming. Deferred
(step three): scheduled/shield-honouring retaliation (a worker sweep vs the current inline counter),
and NPC families holding contestable turf (currently excluded to avoid the World-OCCUPATION overlap).

## THE MANHUNT — blood-war scheduled retaliation (BUILT 2026-08-04)

DEFEND step three, the retaliation deepening. The inline scene-counter (step two) is now CHAINED to a
deferred manhunt: a raider who ESCAPES the scene counter (the `COUNTER_P` roll misses) is remembered by
the family (`family_aggro`, one pending per family — the latest raider), and the worker
(`sweepFamilyAggro`) sends someone after them ~45 min later. Exactly ONE retaliation path fires per raid
(caught now OR hunted later, never both). The manhunt is **shield-honouring** — a raider in a safehouse /
witpro / the Pen / hospital / lockup is unreachable → a clean miss — and one-shot (the row clears on hit
OR miss). §10.4: zero (a hospitalization moves no currency); `family_aggro` is estate-wiped (a dead
raider isn't hunted). `FAMILY_RETAL_P` is a TEST-ONLY roll knob. Mutation-verified.

| lever | ships at | what it does |
|---|---|---|
| `FAMILY_WAR.AGGRO_DELAY_MS` | 45 min | how long before the family comes for an escaped raider |
| `FAMILY_WAR.RETAL_P` | 0.5 | chance the manhunt finds them (a miss if they were hiding/dodged) |
| `FAMILY_WAR.RETAL_HOSP_MS` | 30 min | the manhunt hospitalization |

Deferred (final step): NPC families holding contestable turf — BUILT below.

## RE-SIM PASS 2 (2026-08-04) — the DEFEND pillar folded in, the cash curve re-measured against its gates

The 2026-08-03 re-sim (above) ran before THE HIRED HAND, THE BLOOD WAR, THE MANHUNT and THE CONQUEST.
This pass re-runs both harnesses against HEAD (`6eb8459`) — the first time the full DEFEND pillar and
the resident economy have been measured *together* against the severed model. Both green; no lever
retuned (ground rule #1).

### The re-sim — §10.4 exact across every check, the new faucets fold in clean

| check | measured | note |
|---|---|---|
| the full P10 sweep | drift-0 across all ~30 checks | incl. the surfaces added since the last pass: `turf contest escrow`, `favor escrow`, `loan house pool`, `ring poker escrow`, and `family:tribute` reconciled INSIDE the gang-treasuries check |
| `family:raid` (Blood War loot) | ≤ $288,000/day base-wide (3 NPC families) | regen-bounded (POOL_MAX $120k < the weakest World outfit); a raider caps at $36k/day/family before regen bites; COUNTER_P 0.35 hospitalizes ~35% of landed raids. NO `season_wars` — the severance holds |
| `family:tribute` (Conquest) | ≤ $5,760/day base-wide | 2% of a held vassal's regen, 24h-capped — the World-frontier twin; a small ADDITIVE faucet where the value is the turf goal, not the income |
| the severance | intact | `omrMints` = {mission:%, prize:omr, emission:%}, none takes cash; every cash faucet is MOOT on the extraction axis; only PACING/CONCENTRATION survive, unchanged |

### The playthrough — the top masking rung is now GONE, and the cash curve moved the SAFE way

**The coach walked 19 rungs; every rung the player obeyed cleared.** The prior pass's #1 flag —
"Pull a crew score", 22% and never cleared solo — is **resolved**: the hired hand ships, so the harness
now fills the crew and the rung clears at level 10. No masking rung survives.

**The gate coverage moved in the intended direction — the cash economy is now on the CONSERVATIVE side
of its own gates**, the opposite of the pre-package worry that "cash outruns progression":

| front | gate | net worth at the gate | covers | vs the pre-package pass |
|---|---|---|---|---|
| laundromat | lvl 15 | $98,956 | **40%** | was 70% |
| restaurant | lvl 22 | $137,554 | **28%** | was 94% |
| nightclub | lvl 30 | $676,277 | **56%** | was 85% |

Every gate is now a real climb (none over 100%). The drop is the L1a/L1b front-curve flatten + the
Bureau's income-sourced scrutiny (~11.8% of gross off the passive stack) + THE TAKE re-sourcing crime
cash as a transfer — all landing together. The 7-day solo ceiling came in at **level 34 / $1,078,939 /
14 of 36 missions**, below the pre-package ~$1.4M — cash is genuinely scarcer relative to progression
now, so the fronts gate on affordability again rather than being a formality.

The two structural throttles are unchanged founder calls: **nerve is the loop's real limiter** (26% of
cap on average, full 5% of minutes, ~61 crimes/hr), and **energy is vestigial for a street player**
(full 93% of minutes — only the gym and garage spend it). Idle 5%, lockup 5%; the refill ceiling stays
BOUNDED (≤10.43 levels/day at level 90 and flat above).

**VERDICT: the migration is measured complete.** §10.4 is exact including the newest faucets, the
severance is structurally airtight, the early-game cliff is traversable with no masking rung, and the
big founder-directed balance package (L1a/L1b + Bureau + TAKE) verifiably tightened the cash curve
without touching conservation. **The internal PACING/CONCENTRATION flags survive unchanged** — the
passive stack still runs ~3.1–3.3× the active grind (P9.20), the apex world/boxing/racing purses, the
port sale curve, `jailbirds` at ~$463k/day (the one loop that spends no signed resource), and the
`npc:seed` recycle at ~$499k/day are all still live founder calls. The severance lowered their stakes;
it did not answer them. **The one recommendation this pass surfaced — indexing the flat family
strategic costs — is now APPLIED for war + siege** (founder-directed, base = the value at stake; see
§ THE FAMILY LEDGER → VALUE-AT-STAKE INDEXING). The remaining concentration flags stay open dials.

## THE CONQUEST — NPC families as seizable turf (BUILT 2026-08-04)

DEFEND step four, the deferred final step. Grinding an NPC family's `war_pool` below `ROUT_FLOOR_BPS`
(the rout crossing — the World-frontier precedent, fired only on the CROSSING so it can't re-fire while
the reservoir sits pinned) makes the router's family the VASSAL's overlord: `gangs.held_by_gang` is set,
the tribute clock starts. A held NPC family pays a bounded, lazy-accrued **`family:tribute`** to the
overlord treasury (`familyTribute(tribute_at)` = `POOL_REGEN_HR × TRIBUTE_BPS/10000`, capped at
`TRIBUTE_CAP_MS` 24h — NOT drawn from `war_pool`, the vassal's protection money), banked by any member via
`collectFamilyTribute` (`POST /v1/npcfamily/collect`; the collectTerritory precedent — jailed + D2
safehouse gated). A rival routs the family again to take the hold; a dissolved overlord drops it
(`releaseFamilyHolds`, under the gang lock in dissolution). §10.4: `family:tribute` is a treasury cash
FAUCET (character_id NULL, counterparty=gang; added to the `gang treasuries` check's IN terms alongside
`family:raid`) — the whole DEFEND pillar rides the `family:` cash+ammo vocabulary, zero new reason since
the Blood War. `GET /v1/leaderboard/conquest` ranks families by held NPC outfits. Measured (sim, prints
every run): base-wide **~$5,760/day** at `TARGET` 3 families (regen-metered + 24h-capped + requires a full
rout to hold) — a small additive faucet at frontier-tribute parity.

| lever | ships at | what it does |
|---|---|---|
| `FAMILY_WAR.ROUT_FLOOR_BPS` | 500 | the rout line — pool below 5% of max claims the family |
| `FAMILY_WAR.TRIBUTE_BPS` | 2000 | vassal tribute = 20% of the family's regen/hr |
| `FAMILY_WAR.TRIBUTE_CAP_MS` | 24h | the lazy tribute accrual cap |

**Founder SIM sign-off flag:** `family:tribute` is a NEW (small, bounded, regen-metered) emission surface
at frontier-tribute parity — sim before production; `TRIBUTE_BPS`/`ROUT_FLOOR_BPS` are the dials. The
DEFEND pillar (Blood War → Manhunt → Conquest) is now feature-complete.
