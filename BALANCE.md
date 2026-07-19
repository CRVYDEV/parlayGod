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
| `DIVIDEND_DAILY_BPS` | 30 (0.30%/day) | A claim pays this % of book value, POOL-BOUNDED (the real cap). ~110%/yr nominal, but the pool bound means true yield = what invests fund. | KEEP |
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
