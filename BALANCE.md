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
