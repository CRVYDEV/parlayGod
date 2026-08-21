# OMERTÀ — the sign-off sheet (what needs Jorge's call)

**One page to run the economy from.** Every number in OMERTÀ that isn't sim-locked is a *lever* —
and by ground rule #1 the levers are **yours**, not mine. This sheet gathers every open lever + design
call scattered across `BALANCE.md` and the 25 audit reports into one ranked list so you can decide the
whole game in a sitting.

**Nothing here is a bug.** The game is §10.4-clean (money is only ever moved, never minted from thin air —
proven drift-0 by `node tools/sim.js` every run) and every drop is red-teamed. These are **tuning + design
judgment calls** — how hard the sinks bite, how rich the faucets run, how much Sybil (alt-farming) abuse to
tolerate in alpha.

**How to answer:** three verdicts per row —
- **SHIP** — go with my recommendation as-is (that's what I've marked for most).
- **CHANGE** — tell me the new number / the dial and I apply + re-measure it.
- **WATCH** — ship it, but I'll add it to the alpha watch-list and we revisit if it actually shows up.

The fastest path: read the **bold recommendation** on each row; reply *"ship all except X, Y"* and name
the ones you want to change or discuss. Technical detail for any row lives in `BALANCE.md`.

---

# 📋 THE SHEET, REFRESHED — 2026-08-05

Two parts. **Part A is the honest ledger of your last answers** — five of the fifteen were never
built, and a signed decision that never shipped is worse than an open one, because you think it's
done. **Part B is everything new since 2026-08-02** that wants a verdict. Answer the same way:
*"A3: SHIP. B6: CHANGE."* is a complete reply.

## PART A — your 2026-08-02 answers: what actually shipped

| # | your answer | build state | what I need from you |
|---|---|---|---|
| D1 | fold both fees into ONE hook (a new fee on buys) | **REVERSED AND CLOSED 2026-08-11** (founder: *"get rid of the Vig trade fee"*) — option **B**, not the fold. The sell tax is the canonical pool's one hook; the trade fee is RETIRED (payer deleted, source kept for history, a freshness check pins it shut). The fold was signed on 2026-08-05 and never built, because its ETH-on-buys fee needs the input-side `beforeSwap` path that rule 7 warns breaks partial fills — so what looked like a rate confirmation was a contract-design problem, and closing it removes a carried milestone rather than deferring one again. **Cost, accepted:** the Vig loses its trading leg (backing = fees + Store + bonds), measured every run by sim P9.15. |
| D2 | higher mainnet withdrawal minimum, said plainly | copy/deploy-time | nothing — lands with mainnet config |
| D3 | early-exit toll stays at the game boundary | **BUILT** (it always was) | nothing |
| D4 | bond split confirmed as built (37.5/25/22.5/15) | **BUILT** | nothing |
| D5 | NFT caps scale by rarity (1000/300/60/10) | **BUILT** (`RARITY.SUPPLY_CAP`, deploy config) | nothing |
| D6 | pad envelope 7d → 2d | **BUILT** | nothing |
| D7 | crew nut cap 7d → 2d | **BUILT** (asymmetry 21× → 6×) | nothing |
| D8 | C, then **superseded by your own D8=D the same day** — the gates came back, §4.3 retired | **BUILT as D8=D** (speakeasy + high-stakes gates live, MADE_LADDER live) | **✅ CONFIRMED 2026-08-12** — D8=D is the standing answer. Nothing to build; the row is closed. |
| D9 | rarity weights/prices ship as-is | **BUILT** | revisit only when a real secondary market exists |
| D10 | income assets stay out of extraction | **BUILT** (nothing to build — the exclusion holds) | nothing |
| D11 | *"remove all tickers and RWA assets"* — the whole in-game Portfolio retires | **✅ BUILT 2026-08-05** (founder: *"D11 retire portfolio"*) | Done, on the emission.js retirement pattern: 9 tombstone routes (`retired`, never 404), the payers deleted (grantShares gone; the heist AAPL cut and season SPCX prize with it), the vocabulary + pools KEPT for historical rows, a new `portfolio retired` §10.4 freshness check, the stranded family dividend pool drained into the family yield, and the ETH vault untouched. The coach's lvl-15 legit rung became the stake rung; career's md_legit/dn_dynasty retarget to staked/minted. |
| D12 | identity NFT not built | **HONOURED** (nothing built) | nothing |
| D13 | one loop gets its own energy cost | **✅ BUILT + SIGNED 2026-08-05** — `M4.DEAL_ENERGY` 4 on the Kitchen deal | **CONFIRMED 2026-08-12** (founder re-picked the Kitchen deal, which is what shipped). Gated AND deducted in `kitchen.js:deal`, pinned in `test/levers.js`, the exact spend asserted in `test/growth.js`, recorded in BALANCE.md. Crime stays pure-nerve; energy is regen, so zero §10.4 surface. **This row said NOT BUILT for a week while it was live** — see the note under the table. |
| D14 | stats matter more to the crime roll | **BUILT + SIGNED** (option A, 2026-08-05; the +10% faucet signed as-is 2026-08-06) | `M3.CRIME_STAT` CUN×0.008/SPD×0.004/OFFSET 0.072 — EV-neutral at a mid build (fresh −4.9% / mid 0.0% / maxed +22.3%); the cash-weighted base-wide +10.4% accepted as the cost of "builds matter" over neutralize (hurts fresh/mid) or revert. Tracked by sim P9.33. See BALANCE.md § D14. |
| D15 | cap bust attempts per day | **✅ BUILT + SIGNED 2026-08-05** — `M3.BUST_ATTEMPTS_DAY` 5 | **CONFIRMED 2026-08-12** (founder re-picked 5/day, which is what shipped). A rolling-24h bucket on `bust_used`/`bust_at` (the safehouse-cap shape), charged BEFORE the roll so a failed try is not a free retry, surfaced as `bustAttemptsLeft`, pinned, and load-bearing enough that `test/population.js` documents a flake it caused. **This row said NOT BUILT for a week while it was live.** |

> **A staleness note, recorded rather than quietly fixed.** On 2026-08-12 the founder was asked to
> decide D13 and D15 because this sheet said **NOT BUILT**. Both had shipped on 2026-08-05, at
> exactly the values that were then re-chosen — so two decisions were made twice and the second time
> changed nothing. That is the failure this sheet's own header warns about (*"a signed decision that
> never shipped is worse than an open one, because you think it's done"*) running in the other
> direction: a shipped decision the sheet still calls open. It is not mechanically guardable — the
> rows name no lever, so nothing in `test/levers.js` could have caught the drift — so the discipline
> is simply: **when a row moves to BUILT, edit this file in the same commit as the build.**

## PART B — ✅ SIGNED 2026-08-05 (founder: *"Part B: SHIP"*)

Every row below is now **production balance** at my recommendation. The two CHANGE rows were applied
and re-measured the same day: **A5** `JAILBIRDS.MAX_S` 1200 → 400 (city ceiling ~$463k/day →
**~$84,552/day**, an 82% cut — deeper than the sheet's ~⅔ estimate; sim P9.28 re-prints it every
run) and **A12** `FRONTIER.INVADE_BASE_BPS` 200 (an apex outpost's invade floor is now indexed to
the outfit's size — volkov $240k — while the $30k unheld-district on-ramp stays flat on purpose).
The WATCH rows (A4 hired guns at apex cadence; the Float's whales-actually-commit question) are the
alpha watch-list. **Part A is now closed** (2026-08-12): D8 confirmed, D13 and D15 found already
built and confirmed at the shipped values, D1 a mainnet-milestone contract build and D2 mainnet
config. The only open items on this sheet are the alpha WATCH rows.

Everything here shipped as PROPOSED DEFAULTS under your standing direction and is safe as-is for the
alpha; a verdict makes it production balance. Measurements are the sim's, cited in BALANCE.md.

### B-I · the new emission surfaces (the only rows that touch money supply)

| # | Lever | The number | What it means (plain) | Rec |
|---|---|---|---|---|
| A1 | THE RESIDENT ECONOMY (consolidated, sim P9.32) | **~$928k/day base-wide** | ALL resident-sourced new cash — seeds, mark fronts, vehicles — is 4.3% of the $21.6M/day passive stack. Bounded by construction. Dials: `TURNOVER.PER_DAY`, `MARKS.FRONT_INCOME_BPS`. | **SHIP** |
| A2 | THE BLOOD WAR (`FAMILY_WAR.POOL_*`) | ≤ **$288k/day** base-wide | Raiding NPC families pays from a regen-metered pool; a raider caps at ~$36k/day. | **SHIP** |
| A3 | THE CONQUEST (`ROUT_FLOOR_BPS` 500, `TRIBUTE_BPS` 2000) | ≤ **$5.8k/day** base-wide | Vassal tribute is pocket change; the status is the product. | **SHIP** |
| A4 | THE HIRED GUNS (`WORLD.HIRE_MAX` 2, `HIRE_FEE` $75k) | apex net **+$175k/raid**; a min-lvl whale + 2 guns ≈ 22% odds at volkov | Makes the apex reservoirs solo-reachable for a fee. The old B1 residual (the 0.1 odds floor) rides along. | **WATCH** in alpha; the dial is `HIRE_FEE` toward the grab if apex extraction runs hot |
| A5 | THE JAILBIRDS (`JAILBIRDS.MAX_S` 1200) | city ceiling **~$463k/day**, spends NO signed resource | The one loop with no nerve/energy/cash cost. EV rises with sentence length (the 10% floor). | **CHANGE (recommended): `MAX_S` 1200 → 400** — caps the camp reward at ~$6.5k and cuts the ceiling ~⅔, availability untouched |
| A6 | THE HIRED HAND (`HEIST_FILL_MAX` 1, fee $5k) | entry co-op solo-reachable; marquee jobs still need bodies | **SHIP — and never raise FILL_MAX past 1 without a sim** (the co-op faucet is 1.46× solo per member) |
| A7 | THE FAMILY WAR (`WAR.COST` $25k, `WIN_SCORE` 5) | ~10h+ solo campaign; a 5-man family wins in one salvo | §10.4-neutral (status + an existing sink). | **SHIP**; if one-salvo wins feel cheap the dial is `WIN_SCORE` |

### B-II · strategy + pacing (signed-surface adjacent)

| # | Lever | The number | What it means | Rec |
|---|---|---|---|---|
| A8 | SEASON_MODS **armed** | 4 seasons, one twists signed levers ±15–25% for 28d | The one drop that deliberately moves SIGNED numbers. Kill switch: `SEASON_MODS=off`. | **SHIP** (it's the cheapest strategic content in the game) |
| A9 | OPERATION SLOTS (`SLOTS_MAX` 12) | best-12 vs all-31 = a 1.07× cut | The cap creates the mid-game choice; 12 is the generosity dial. | **SHIP**; revisit with alpha data |
| A10 | THE SEALED BID (`CONTEST_LOSS_BPS` 5000) | losers forfeit half their sealed stake | What makes it a bid, not "always all-in". | **SHIP** |
| A11 | THE ROSTER / MAP / CHARTERS (multiplier sets) | e.g. a maxed Enforcer = +$48k on a turf floor; 3 neighbours = ×1.33 | All additive/multiplicative on existing sinks. | **SHIP** |
| A12 | Flat frontier costs (`FRONTIER.INVADE_BASE` $50k; unheld district $30k) | 0.08% of a maxed family's day | The last two FLAT strategic prices after the war/siege indexing. | **CHANGE (recommended): index `INVADE_BASE` like `WAR_COST_BPS`; LEAVE the $30k unheld price** — it's the new-family on-ramp |
| A13 | `M3.COACH_SOCIAL_BAND_LVLS` 8 + the deep-city/heir coach bands | 23 rungs walked, no rung holds >21% of advised play | Zero economy surface — listed for completeness. | **SHIP** |

### B-III · resolved-by-your-own-later-calls (recorded so nothing haunts us)

- **THE FLOAT's four opens** — three of four are closed by D8=D (the speakeasy + high-stakes gates
  are back and signed); the Commission stays deliberately UNGATED on being made (a decree moves real
  surfaces — $OMR buying POWER there crosses even the new ceiling rule). Remaining: **watch realised
  $OMR loot per kill in the alpha** to see if whales actually commit.
- **THE FARM rows** — superseded whole: the Street Wage (and its endowment schedule) was retired by
  economy v3 step 1. There is no wage to farm.
- **Real ticker symbols** — superseded by whatever D11 resolves to (retire = moot; keep = go fictional).
- **`BUSINESS_SHUTTER_BPS` 0** — stays 0; the suite now pins the walk-away-vs-pay relation, so a
  future raise that flips it fails CI by name.
- **THE NUT** — D7's 2d cap took the asymmetry 21× → 6×. `OFFLINE_CAP_MS` 8h stays the one lever that
  would remove the crossover entirely; my rec is leave it (it's a whole-economy decision).

## The bottom line, 2026-08-05

Three things actually need words from you: **D1's rate** (a number), **D11's confirmation** (the axe
or the fictional-ticker alternative), **D13's loop + D15's number** (or take my picks). Everything in
Part B ships as-is on a one-word "Part B: SHIP"; the two CHANGE rows (A5 jailbirds, A12 invade
indexing) I build the day you nod.

---

# ✅ ANSWERED — all 15, 2026-08-02

Jorge answered every fork. Recorded here as the decision; the build state of each is tracked in
`CLAUDE.md` and `BALANCE.md`.

| # | answer | what it means |
|---|---|---|
| D1 | **A** | Fold both fees into one hook, four destinations. **A new fee on buys** — rate proposed at 20 bps, flagged for confirmation. |
| D2 | **A** | Accept a higher mainnet withdrawal minimum and say so plainly in the copy. |
| D3 | **A** | The early-exit toll stays at the game boundary. No contract change — this is how it is built. |
| D4 | **A** | Bond ETH split confirmed as built: liquidity 37.5 / treasury 25 / Vig 22.5 / dev 15. |
| D5 | **B** | NFT supply caps scale by rarity. Taking the proposed **1000 / 300 / 60 / 10** per class unless told otherwise. |
| D6 | **B** | `BUSINESS_UPKEEP_CAP_MS` 7d → 2d. The pad can no longer outrun the till. |
| D7 | **C** | `CREW_WAGE_CAP_MS` 7d → 2d. Kitchen-local; the offline window is untouched. |
| D8 | **C** | Made Man gates status only. The speakeasy and high-stakes gates come off — nothing that earns or wins sits behind the subscription. |
| D9 | **A** | Rarity weights and upgrade prices ship as they are. |
| D10 | **A** | *(founder deferred to the recommendation)* Income assets stay out of extraction. |
| D11 | **beyond B** | *"remove all tickers and RWA assets"* — the whole in-game Portfolio retires, not just its symbols. **My reading, stated so it can be corrected: the ETH vault STAYS**, because it is neither a ticker nor an RWA asset — the stock-layer retirement already re-denominated it to ETH. |
| D12 | **C** | The identity NFT is not built. |
| D13 | **B** | Give one loop its own energy cost so the bar bites. |
| D14 | **B** | Stats matter more to the crime roll. Touches the signed curve — measured before and after. |
| D15 | **C** | Cap bust attempts per day in-game. |

**Where a letter needed a number I have proposed one rather than block**: D1's trade-fee rate, D5's
four caps, and the size of D13/D14. Each is called out at its build site and is a one-line change if
the number is wrong.

---

# 🔴 LIVE SHEET — the 15 decisions currently open (2026-08-02)

Everything below is a real fork with no default. Each one is written the same way: **the situation**,
**why it is yours and not mine**, three options **A / B / C**, and my recommendation. Answer with the
letter — *"D1: A. D2: C."* is a complete reply. Where a letter needs a number I say so.

Ordered by **deadline, not importance**: D1–D5 block a mainnet deploy and some of them become
expensive or impossible to change afterwards. D6–D10 are live in the game today. D11–D15 can wait.

---

## PART I — decide before anything deploys to mainnet (D1–D5)

### D1 — Two hooks for one Uniswap pool — CLOSED 2026-08-11 by option B

**Answered:** *"Get rid of the Vig trade fee."* The sell tax is the canonical pool's one hook.

**The situation, kept as the record.** A v4 pool's hook address is baked into its identity, so a pool
has exactly one hook forever. Two were designed. `OmertaHook` (built, green) takes **9% on sells
only**, split dev / treasury / liquidity. A second **trade-fee hook** took a small cut of **every**
swap and funded the Vig — the pot that backs $OMR withdrawals — and its entire backend was built and
sitting dormant. The Vig was not one of `OmertaHook`'s three slices. They were not versions of each
other, which is what made this a decision rather than a merge.

**It was signed as option A (the fold) on 2026-08-05 and then never built** — and the reason it
stalled is the strongest argument for B. The fold's fee is taken in ETH so the Vig can book it, and
ETH is the *input* currency on an exact-input buy (the dominant router shape), so charging it needs
the input-side `beforeSwap` path, which the contracts subtree's audited rule 7 warns breaks
partially-filled swaps. What read as a rate confirmation was a contract-design problem, and it was
carried as "its own focused session" for nine days without one. Closing it as B removes a carried
mainnet milestone rather than deferring it a tenth time.

**What B costs, stated plainly and now measured every run.** The Vig loses its trading leg:
withdrawal backing comes from gameplay fees (60%), the Store (40%) and bonds (22.5%), and trading
volume contributes nothing to it. Sim **P9.15** prints the sell tax by destination alongside a
`0.000 to the Vig` line, so a later decision to add a fourth vig slice has a number to price — and
that would be a reallocation OUT of dev / treasury / LP, which is a founder call, not a default.

**Option C** (two pools, one taxed and one not) stays rejected on analysis: the untaxed pool becomes
the real market within a day. On the record as considered.

**My recommendation: A**, at a small rate (10–30 bps). It is the only option that keeps both revenue
lines, and the built-and-dormant backend means it costs almost nothing to wire. **Decide before an
address is mined** — the permission set is permanent.

---

### D2 — On Ethereum mainnet, a small withdrawal can cost more in gas than it is worth

**The situation.** The withdrawal rail was designed against cheap L2 gas. On mainnet the *logic* is
unaffected — the reserve and the exit toll work identically — but the smallest withdrawal that makes
economic sense rises roughly tenfold. Gear claims are worse, because they are claimed one at a time.

**Why it is yours.** Every option trades a cost you pay against a promise you make to players, and
one of them re-introduces a bridge into the extraction path.

- **A. Accept a higher minimum, and say so plainly in the copy.** Free to build. *Cost: small holders
  effectively cannot extract, and the copy has to be honest about that up front.*
- **B. Sponsor the gas (a paymaster).** The player sees a clean withdrawal. *Cost: a real, recurring
  bill that scales with withdrawals, and a new piece of infrastructure to run.*
- **C. Keep the game's rails on an L2 and the token on mainnet.** Best of both on cost. *Cost: a
  bridge sits inside the extraction path — the exact structure the treasury design worked to remove.*

**My recommendation: A for launch, B once withdrawal volume is known.** C buys convenience at the price
of the one property that makes the extraction story simple to explain.

---

### D3 — Should the 48-hour early-exit toll follow the token onto the exchange?

**The situation.** Freshly-acquired $OMR pays a decaying surcharge when it leaves — at the game's own
boundary. On a public exchange, a hook cannot reliably tell *who* is selling (a router stands in the
middle), so an on-chain version of the same rule stops working exactly when someone attacks it.

- **A. Hold it at the game boundary** — the hook has no age logic, which is how it is built today.
- **B. Add age logic on-chain anyway**, accepting that a determined seller routes around it.
- **C. Drop the age rule entirely** and let the flat 9% sell tax be the whole anti-dump story.

**My recommendation: A.** It is already built that way, and the contract is immutable — adding it later
means a redeploy.

---

### D4 — Is the bond's Vig slice supposed to exist at all?

**The situation.** Bonded ETH splits four ways: **liquidity 37.5% / treasury 25% / Vig 22.5% / dev 15%**.
The treasury and dev numbers come straight from the design. The design's own table then puts the whole
remaining 60% into liquidity and shows **no Vig slice** — but the sentence directly beneath that table
names the Vig by variable. I read the omission as an oversight and kept the Vig, because zeroing it
would defund the pot that backs withdrawals.

**Why it is yours.** I made a judgement call on ambiguous source material and want it confirmed rather
than inherited.

- **A. Confirm the split as built** (37.5 / 25 / 22.5 / 15).
- **B. Take the design literally** — liquidity 60%, Vig 0. *One environment variable.*
- **C. A different split.** Name four numbers that sum to 100%.

**My recommendation: A.** Deeper liquidity is good, but not at the price of the withdrawal reserve.

---

### D5 — How many of each NFT car and boat may ever exist?

**The situation.** Step 7 shipped extraction. Every token type has a **lifetime supply cap set once by
the Safe at deploy**, and it fails closed — a type with no cap simply cannot be minted. There are 60
cars and 6 boats, each with 4 rarity tiers, so this is roughly 264 numbers, and the cap — not the drop
rate — is what actually bounds scarcity.

- **A. One blanket rule** — e.g. every type capped at 500. Simple, defensible, one number to give me.
- **B. Scale by rarity** — common generous, epic tight (say 1000 / 300 / 60 / 10). *My lean: this is
  what makes rarity mean something on a secondary market.*
- **C. Cap only the top tiers and leave common effectively uncapped.**

**My recommendation: B.** Give me the four numbers and I will generate the deploy table.

---

## PART II — live in the game right now (D6–D10)

### D6 — A business front you neglect for a week costs more than it can pay back

**The situation.** A front's till holds **24 hours** of income; the protection envelope runs **7 days**.
Past **five days away**, squaring up costs more than the front can ever hand back. A tester found this
and their arithmetic was exactly right. This is intended pressure — an absent owner should bleed — but
the crossover itself was probably not intended. It is now fully disclosed before purchase, warned about
as it slides, and there is a door out (close the front, free the slot, forfeit everything sunk in).

**Why it is yours.** The disclosure fixed the *defect*. Whether the crossover should exist at all is a
design taste question about how punishing absence is.

- **A. Leave it.** Disclosure was the fix; the mechanic stands. *Cost: a player who takes a week off
  loses an entry-tier asset, and that is a normal thing for a player to do.*
- **B. Cap the envelope at what the till holds** (`BUSINESS_UPKEEP_CAP_MS` 7d → 2d). The crossover
  disappears; neglect still costs you income, it just cannot go negative.
- **C. Refund part of the sunk cost on closing** (`BUSINESS_SHUTTER_BPS` above 0). *Careful — past
  roughly 5400 bps walking away becomes the correct play and the sink stops draining. A guard now
  fails the build if that line is crossed, so this cannot go wrong silently.*

**My recommendation: B.** It keeps the pressure and removes the trap. A is defensible if you want
absence to be genuinely punishing.

---

### D7 — The same thing, one step sharper, in the kitchen

**The situation.** Each crew member draws **$1,200/hr** on the wall clock. Offline sales cap at **8
hours**; the wage runs to **168**. A **21×** asymmetry. Stocked and attended, a hand returns 3.6:1 —
so an attentive owner is never the problem. Absent three days, it is 0.40:1. You can now fire crew
(free once they have already downed tools), and the terms are quoted before the hire.

- **A. Leave it.** Attendance pricing, now disclosed.
- **B. Raise the offline sales window** (`OFFLINE_CAP_MS` 8h → 24h+). *This is the single number that
  removes the crossover — and it moves every other offline earning in the game, so it is a
  whole-economy decision, not a kitchen one. I would re-measure everything.*
- **C. Cap the wage clock instead** (`CREW_WAGE_CAP_MS` 7d → 2d). Kitchen-local, no side effects.

**My recommendation: C** if you want it softened — it does the same job as B without touching the rest
of the economy. **A** is genuinely fine now that the deal is visible before the hire.

---

### D8 — Should being a Made Man gate things that earn money, or only status?

**The situation.** The Made Man is the recurring $OMR subscription (20 per 30 days). The design's list
of what it should unlock opens with **Commission eligibility**, and a Commission decree moves real
gameplay surfaces — safehouse cost, war blocking, the kill-loot multiplier. The same design names
"$OMR must never buy power" as its binding rule. Those two sentences pull against each other. As
shipped: opening a **speakeasy** requires it (a speakeasy earns cash), the **high-stakes table** now
needs 50 $OMR staked (a change to an already-shipped affordance), and the **Commission is not gated**.

- **A. Ship as built.** Speakeasy and high-stakes gated, Commission open.
- **B. Gate the Commission too**, and review the decree teeth at the same time so a paid seat is not
  buying gameplay power.
- **C. Pull the gates back to status only** — no gate on anything that earns or wins.

**My recommendation: A**, with the high-stakes stake watched, because it took something away from
level-30 players who already had it. **C** is the cleanest line if you want zero ambiguity about
whether money buys advantage.

> **✅ ANSWERED — C, then §4.3 RETIRED and D (2026-08-02).** The founder first took **C** (status
> only). Reviewing the consequence, they then **retired the underlying rule — "$OMR may buy power" —**
> and answered **D**: both retired ACCESS gates are back (speakeasy, the high-stakes stake, AND'ed with
> the seat as originally designed) plus a new **MADE_LADDER** — a capped, tiered power layer keyed on
> **HELD** $OMR, with capacity perks up the rungs and one economic edge (the fence) at the top. Dues
> climb it by one rung as a **shortcut, never a gate**. The Commission stays UNGATED.
>
> The replacement for §4.3 is a **CEILING**: the top rung is 150 staked and the mission ladder pays 220
> $OMR lifetime, pinned by `test/made.js` against the live `MISSIONS` table. No combat power at any
> price (a loop argument — see BALANCE.md), and operating costs stay in cash. The four surfaces that
> promised players *"no pay-to-win"* now make the ceiling claim instead, because the old one stopped
> being true. Full reasoning, the rung table and the open items: **BALANCE.md § D8=C, THEN D8=D**.
>
> **For the launch packet:** this game has real-money extraction, so the chain is now real money →
> in-game earning power → $OMR → the withdrawal rail. A materially different posture from "pay for
> cosmetics," and it belongs beside the bond and the Store.

---

### D9 — The rarity draw and the price of skipping it

**The situation.** Cars and boats roll a rarity when earned: **70% common / 22% rare / 6.5% legendary /
1.5% epic**. Buying your way up costs **25 / 90 / 300 $OMR** per step — 415 to take a common all the
way to epic, deliberately steeper than the odds, so grinding stays the cheap path and paying is the
impatient one.

- **A. Ship both as they are.**
- **B. Make legendaries rarer** (say 3%) so the top of the secondary market is thinner.
- **C. Change the upgrade prices.** Name three numbers.

**My recommendation: A**, and revisit once there is a real secondary market to look at — scarcity is
only meaningful relative to demand, and there is no demand to measure yet.

**One thing here is not a balance lever and I want it on the record:** the upgrade must stay
**deterministic** — pay the price, get exactly that tier. Making it a random roll turns it into a loot
box bought with a token people reach through real money, which is an outside decision wearing a balance
decision's clothes.

---

### D10 — Extraction for income-producing assets (rackets, legit fronts)

**The situation.** Cars and boats can be taken on-chain; the deliberate trade is that an extracted item
is **safe but inert** — it cannot be raced, stolen, or used, and in exchange it stops dying with your
street. Income assets do not fit that shape. They are stored as "you own one of these", with no
individual record, so extracting one either leaves it **earning while safe** — which is strictly the
best option and would make the trade meaningless — or removes it and needs a new home built for it.

**Why it is yours.** This is a design call about what an extracted asset *is*, not a missing feature.

- **A. Leave assets out.** Only things you can drive or sail are extractable.
- **B. Extract them as inert trophies** — the income stops, the slot frees, you keep a token. Needs a
  new storage design.
- **C. Extract them still earning.** *I would push back hard: nothing would ever be left in play.*

**My recommendation: A.** Cars and boats are the natural collectibles; income assets are the thing you
are supposed to be risking.

---

## PART III — can wait, but should not be forgotten (D11–D15)

### D11 — Real ticker symbols in the Portfolio

**The situation.** The "going legit" Portfolio uses **AAPL, TSLA, GLD, HOOD, NVDA, SPCX, AMZN, GME**
with an entirely made-up in-game price. That was defensible when a real stock rail sat behind it. The
stock layer was retired on 31 July — the treasury holds ETH now — so nothing real backs those symbols.

- **A. Keep them.** Recognisable, and the fantasy of going legit reads instantly.
- **B. Move to fictional tickers**, so nothing implies a player owns anything real.
- **C. Keep them but label the screen explicitly as a fictional in-game collectible.**

**My recommendation: B.** It costs one afternoon and removes a question entirely rather than answering
it. C is the compromise if the real names are doing real work for the fantasy.

---

### D12 — The identity NFT (spec'd, not built)

**The situation.** A generative portrait attached to the 0.01 ETH identity mint. You considered raising
the fee and declined, which is recorded. The load-bearing decision in the spec: the portrait is a
**tradeable trophy**, and the thing it commemorates — the right to withdraw — is **not transferable
with it**. If the entitlement travelled with the token, the real cost of an identity would stop being
the mint price and become the cheapest listing on a marketplace, which by construction is the dead alts
of the last farm.

- **A. Build it as spec'd** — trophy tradeable, entitlement fixed to the account; silhouette-forward
  art (sidesteps likeness questions and composites far better); the portrait persists across death and
  shows the generation; everyone who already minted gets one retroactively.
- **B. Build it with faces** rather than silhouettes. Stronger art, more identity, more questions.
- **C. Do not build it.** *It does not fix anything structural — it is a collectible, and it is worth
  being clear that it is only that.*

**My recommendation: A.** It needs a new contract, which restarts the third-party audit clock — so it
belongs in the same batch as any other contract work, not on its own.

---

### D13 — Energy does almost nothing

**The situation.** Crime runs on **nerve**. Energy is spent only by the gym, the garage and a few crew
actions, and the harness measures it **full 96% of played minutes**. It is a bar on the screen that
mostly does not constrain anything. The labels were corrected so it no longer *lies*, but it still is
not a resource.

- **A. Leave it as headroom** for the physical loops.
- **B. Give one existing loop its own energy cost** so the bar starts to bite.
- **C. Remove it from the sheet** and stop presenting it as a core resource.

**My recommendation: A for now.** Adding a second throttle to a loop that already has nerve is the
kind of change that quietly makes the game worse, and it would need re-measuring end to end.

---

### D14 — Training stats past the mission gates buys nothing measurable

**The situation.** Two simulated players, seven days: one banked **212 muscle**, the other **51** while
spending the same sessions elsewhere. They reached the same level with comparable cash. Once your stats
clear the mission requirements, more of them does not show up anywhere you can feel.

- **A. Leave it.** The gym is a gate you clear, not a curve you climb.
- **B. Make stats matter more to the crime roll** so training keeps paying. *Touches the signed crime
  curve — I would re-measure everything before and after.*
- **C. Cap the gym once gates are cleared** and be honest that it is finished.

**My recommendation: B eventually, A for now.** It is the most interesting of the three progression
flags, and the most invasive.

---

### D15 — Chasing a "bust someone out" contract puts you in a cell

**The situation.** A failed jailbreak is a stretch in lockup. Simulated with no restraint, a player
chasing that daily contract spent **26% of their time in a cell** and lost a quarter of their crimes.
A person learns after two tries; the harness now models that. So this bites new players hardest.

- **A. Leave it.** The lesson is cheap and learning it is the game working.
- **B. Improve the odds** on the bust roll.
- **C. Cap attempts per day in-game**, so the game teaches the restraint instead of the cell.

**My recommendation: A.** It self-corrects after two attempts and the failure is legible.

---

## What is NOT on this sheet

Two things gate mainnet and neither is yours to tune: a **third-party audit** of the contracts and the
off-chain signer, and **the launch checklist** on the extraction line. The contract test suite is green
(128 tests). Nothing above unblocks those, and they do not block anything above.

---

## ✅ RESOLUTION — founder shipped all recommendations (2026-07-21)

Jorge: *"Ship all your recommendations."* Applied + tested (suite 30/30, sim drift-0):

**Code changes (the CHANGE-recommended rows):**
- **1.3 apex solo-raid gate** — `raidNpc` now refuses `coop` outfits (kryl/moreau/volkov); they must be hit
  with a crew (`planRaid`→`executeRaid`). Board `canRaid` reflects it. Closes the min-level-whale solo floor.
- **2.5 fight-fix Sybil bound** — a `FIGHT_BET_MIN_LVL` (5) floor on fight bets (the `WANTED_MIN_LVL`/npcHit
  rookie-floor precedent) — raises a fix-ring's cost per disposable alt.
- **Pen T3 yard-incident reweight** — `PEN.QUIET_WEIGHT` (0.45) weights `quiet` up so the yard is
  hard-blocked (lockdown/toss) &lt;25% of days instead of ~40%.
- **Tier-4 lender-death** — killing your lender no longer erases the debt: an active loan's receivable (and
  any pledged collateral) passes to the lender's **heir** (`voidLoansAtDeath` reassigns instead of voiding;
  §10.4-neutral).

**Deploy-config (2.7):** production **must** set `SOCIAL_VERIFY_MODE=live` so the "Spread the Word" cash
faucet requires real social verification (keeps the alpha `trust` mode for now). An ops requirement, not code.

**Everything else = SIGNED** at my recommended verdict (SHIP or WATCH). WATCH items are the alpha watch-list.
**Tier 6 remains a separate launch/audit track** — not signed here.

Below is the full sheet as-decided (verdicts stand as the record).

---

## TIER 0 — two retunes are applied but not production-signed (decide first)

Both were founder-directed on 2026-07-21, re-measured in the sim, and are live in the code as the
recommended defaults — but flagged "sim-signed, **not yet production-signed**." They just need your yes.

| # | What | The change | Measured effect | Rec |
|---|------|-----------|-----------------|-----|
| 0.1 | **Territory "Protection" racket** heats up too slowly, so a daily collector dodged all raid risk and got a free +15% | `protection.scrutinyPerHr` 6 → **10** | now hot in 10h → a lazy daily collector faces P(raid) 72% → ~$376k/day (was a strict, risk-free +15%) | **SHIP** — makes the hot type genuinely higher-*variance*, not higher-*EV* |
| 0.2 | **Boxing exhibition purse** (fight your NPC bouts for cash) was too generous for a maxed stable | journeyman fee $10k→**$15k**, gatekeeper $30k→**$45k** (cheap entry tier untouched) | maxed 3-stable best EV +$495k/day → **~$315k/day**; a real 9%-chance-of-−$45k risk | **SHIP** |

---

## TIER 1 — the biggest faucets & deepest levers (highest leverage)

These move the most money. Get these right and the economy's shape is right.

| # | Lever | The number | What it means (plain) | Rec |
|---|-------|-----------|----------------------|-----|
| 1.1 | **Staking APY** | 14% APY, now **backed** (paid from a sink-fed pool, never minted) | The deepest lever in the game. Phase-4 made it a *redistribution* (cash sinks fund staker yield), so it can't inflate — but the ceiling rate is still yours. | **SHIP** — backing already fixed the inflation risk; 14% is a fine ceiling |
| 1.2 | **Speakeasy bar take** | **$3.12M/day gross → $2.496M/day NET** at top tier after the shipped 20% upkeep — *measured + dialed (sim P9.12)* | ✅ **RESOLVED (founder dialed).** The net-EV pass corrected two of my own assumptions (no "pad" upkeep existed; raid notoriety is patron-driven, not the owner's collect → a passive owner drew ~0 raid tax). Founder's call: **apply an upkeep drip.** Shipped: `SPEAKEASY.UPKEEP_BPS` (2000 = 20%) comes off the top of every collect as a `speakeasy:upkeep` §10.4 cash sink (the business-'pad' rate) — so the bar take is no longer a risk-free faucet. Top-tier payback moved ~6.0d → ~7.5d. The `incomePerHr` curve remains a further dial if you want it leaner. |
| 1.3 | **World apex raid — solo floor (B1)** | a min-level whale can solo an apex outfit for the full grab; base-wide ceiling **$960k–$4.32M/day** (regen-capped) | Apex cartels were meant to need a *crew* to beat. A 0.1 minimum win-chance lets a lone rich player farm them. Total emission is still capped by regen (can't over-extract), but it undercuts the co-op design. | **CHANGE (recommended): gate solo raids off apex outfits** — one line: `raidNpc` requires a crew for `fixture.coop` outfits. Clean, matches the design. (Or SHIP for alpha — it's bounded.) |
| 1.4 | **World frontier tribute** | **≤ $157k/day** base-wide (all 5 outfits held) — *newly measured* | A conquered NPC outfit pays its overlord family a small vassal cut. Tiny next to territory ops ($1.4M+/day). | **SHIP** |
| 1.5 | **Bank interest — online asymmetry** | always-online accounts compounded ~4%/day vs a casual's ~1.33% | Mostly already closed: a 12h/day interest cap (B2) + a taper above $10M (D5) are live and signed. Residual: a bot online 24/7 still edges a casual. | **SHIP** (already mitigated) — revisit only if bots show up |
| 1.6 | **Trade-goods arbitrage** | ~2.67× max price spread across districts, risk-free | Prices are deterministic and public, so a player can buy-low-sell-high across districts with no risk (bounded by cargo + travel + tax). The one genuinely-open core-economy item. | **WATCH** — the convoy game already competes for this; dial is per-district slippage if it kills convoy volume |

---

## TIER 2 — real balance risks worth a decision now

Each is a genuine "if a clever/coordinated player abuses this" concern. Most are Sybil (one person, many
alts) or wealth-concentration. All are §10.4-clean (no money is created) — the question is *fairness*.

| # | Risk | The concern | Rec |
|---|------|------------|-----|
| 2.1 | **World garrison ratchet** | Each invasion sets the next defense to `max(base, prev×1.5)` with no decay → an apex outpost can get priced out of reach. Rout-resettable, so never permanent. | **WATCH** — dial later: garrison decay-over-time or an invade cooldown |
| 2.2 | **Occupation on-ramp shift** | Step five put 5/6 core districts under NPC control, so a new family's old free land-grab is now a small liberation ($45k–$120k for the weak outfits; cathedral stays free). Teaches the World loop but changes the new-player start. | **SHIP** — soft on-ramp, easy to soften further via the `OCCUPATION` map if new-family retention dips |
| 2.3 | **`whack:loot` has no level floor** | A colluding pair funnels lootable gear/$OMR from disposable low-level alts onto one main before extracting (mints nothing — pure concentration). | **ALREADY FIXED — this row was stale.** `M3.LOOT_MIN_LVL` (10) shipped in the FINAL SWEEP: a fire-kill loots nothing off a mark below it (the estate still runs). Wired at `src/social/combat.js:328`, pinned by `test/levers.js` and asserted in `test/social.js`. |
| 2.4 | **Family-contract laundering** | The funder-lockout only blocked *current* members, so leave→kill-for-the-pot→rejoin routed gang treasury into a personal wallet. | **FIXED 2026-07-27** — `bounty_gang_roster` snapshots the funding family's members when family money goes in (re-snapshotted per top-up) and `claimBounty` locks that roster out for the pot's life, wherever their membership stands at the kill. Torn down with the pot (claim / cancel / expiry sweep / the target's estate). Regression walks the exact exploit in `test/social.js`; mutation-verified. |
| 2.5 | **The fight FIX is Sybil-scalable** | A neon-holding boss sets the weekly fight result; alts betting the fixed side win deterministically (~$347k/week at 50 alts). Not agent-gated. | **CHANGE (recommended): cap total fixed-side payout/week** — a small structural bound; the cleanest of the Sybil items |
| 2.6 | **Dynasty dividend-pool fairness** | The RWA "going legit" dividend pool has no per-account allocation, so the biggest book can drain the daily inflow and starve small holders. §10.4-clean redistribution. | **WATCH** — decide if small-holder fairness matters for alpha; dial is a per-claim cap tied to your own contributions (needs a column) |
| 2.7 | **"Spread the Word" social faucet** | Pays in-game cash ($300/task, $1,400/day max) for unverifiable "post about us" tasks → a Sybil ring farms $1,400/day/alt. Cash-only + agent-excluded + once/day already bound it. | **CHANGE (deploy-config): require `SOCIAL_VERIFY_MODE=live` in production** + keep the amounts petty. Trivial faucet, real growth upside |
| 2.8 | **Speakeasy standover forced-sale price** | A hostile takeover forces a sale at *build cost* (below a going-concern's value) — the "hostile discount." | **SHIP** — the attacker still risks a $250k fee + must front the full assessed price; add a goodwill premium only if whale-club predation shows up |

---

## TIER 3 — the Pen tuning set (all small, all one-line dials)

None of these move much money; they're jail-flavor knobs. My rec is **SHIP the set** and dial any that
annoy players in alpha.

| Lever | Note | Rec |
|-------|------|-----|
| `pen:work` faucet | ~$400/work, energy-gated, **only while jailed** → self-limiting trickle (measured) | **SHIP** (trivial) |
| Shank cooldown | none — soft-limited by energy + shiv + a sentence extension | **WATCH** — "cheap add if wanted" |
| `PROTECTION_COST` $15k flat | not wealth-scaled, so a jailed whale buys shank-immunity cheap | **WATCH** — wealth-scale it like the safehouse if it bites |
| Yard-incident weighting | ~40% of days hard-block the Pen loop (lockdown/toss) | **CHANGE (recommended): weight `quiet` higher** — 40% dead days is a lot of downtime |
| Hole teeth | capped at the sentence, so a short-timer barely feels it | **SHIP** (minor) |

---

## TIER 4 — loan-sharking design calls

The core ("the lender vets their counterparties" — default risk stays with the lender) was **SIGNED
as-is 2026-07-18**. These are the residuals.

| Lever | The call | Rec |
|-------|---------|-----|
| Killing your lender erases the debt | Borrow-max → get your lender whacked → keep the cash. | **CHANGE (recommended)** — make the obligation survive to the estate/pool; it's a clean moral-hazard hole |
| `buyPaper` has no safehouse gate | Buying loan paper turns lootable cash into a loot-immune claim (but it's a purchase, self-defeating as a vault). | **SHIP** — one-line `if (safeHoused) throw` for parity if you want it, but low value |
| No per-target collect cooldown | A lender can repeatedly hospitalize+brand a consenting borrower. | **WATCH** |
| WANTED disproportion | A defaulted $5k loan triggers the full WANTED apparatus + a $50k "square." | **SHIP** — the deterrent is the point; `WANTED_MIN_LVL` already raised 10→20 to kill the alt-farm |
| Alt-farm the $25k pool bounty | A lender+borrower+killer ring manufactures a bounty. Mitigated by `WANTED_MIN_LVL 20`. | **SHIP** (mitigated) |

---

## TIER 5 — accept-for-alpha / WATCH (my rec: ship all, revisit only if seen)

Low-severity, mostly design-consistent-with-the-rest, or expensive-to-abuse. **Rec: SHIP the whole tier.**

- **Boxing:** listing at a stake is mildly −EV vs a self-selecting challenger; no initiator energy cost — dials exist if PvP bouts die out.
- **Territory `upgradeRacket` dodges a pending Bureau raid** — mirror the speakeasy "resolve-raid-before-upgrade" fix if you want parity (one line).
- **Convoy insurance remainder** forfeits silently on a thin pool (shipper pays premium, collects little).
- **Omertà gang-churn** (leave→act→rejoin) — the whole v24 immediate-join family; the real fix is an apply/accept queue (a bigger design call).
- **Open-season decree** halved-stay applies at entry only + is predictable from public votes → pre-buy a stay.
- **Heist leader-rat grief** — a leader can rat their own crew (expensive grief, accepted).
- **`demandTrial` cheap reset** at the exact indictment threshold (85% acquittal) — a `BUST_P_MIN` or a cooldown is the dial.
- **Endgame crime saturates at the 0.97 success cap** (~$9M/hr trivial risk for a maxed vet).
- **Business/racket passive buckets stack** (~2× throughput) rather than sharing a daily bucket.
- **Per-IP throttle still absent** — unauth GETs sit outside the rate limiter (an infra hardening item).

---

## TIER 6 — SEPARATE TRACK: launch + audit gated (NOT balance — do not "sign" here)

These are **not economy levers** — they're gated on **the launch checklist + a third-party audit** before any
mainnet/real-money step, independent of everything above. Listed so nothing's lost.

**Gated (not your call):**
- Reserve Bond, the Store's RWA revenue share, PLEX pricing, R2/R3 real-RWA extraction, the tier-2
  "family tree" referral — all held until the launch checklist + audit. Keep the tier-2 referral **flat, cash-only,
  depth-2, agent-excluded** (the anti-MLM line) — do not deepen without founder sign-off.

**Pre-mainnet chain hardening (engineering gate, mostly needs the Foundry toolchain we don't have here):**
- **Run `forge test`** (the suite compiles clean but the Foundry VM was never executed here) — the hard
  pre-audit gate.
- Adopt full **EIP-4361** SIWE (domain/URI/chainId binding); pin an **explicit gear→tokenId map** before
  minting; decide the **withdrawal-destination policy** (own-wallet-only vs any address); add a
  **`fundReserve` on-chain reconciliation** job (alarm if signed-OMR > on-chain balance); add the two
  contract `require` guards (`cap>0`, `minter!=0`).

---

## The bottom line

The game is enormous, §10.4-clean, and audited. **Most rows are "SHIP."** The handful I'd genuinely
think about before a real-money economy: **1.2 (speakeasy bar-take — sim the net), 1.3 (apex solo-raid —
gate to crews), 2.5 (fight-fix cap), and the Tier-6 chain gates (run `forge test`).** Everything else is
either already mitigated, trivially small, or a fair "ship-and-watch."

Tell me which rows to **CHANGE** and I'll apply the dial + re-run the sim; the rest I'll mark SIGNED in
`BALANCE.md`.

---

## 📌 SESSION ADDENDUM (red-team loop R32–R43 + chain go-live wiring, 2026-07-22)

Since the 2026-07-21 resolution, an automated max-effort red-team loop (12 rounds, `AUDIT-redteam-loop.md`)
and the start of the chain go-live work ran. **No founder decision is needed for the fixes below — they're
correctness (a state gate, a lock order, a snapshot, a bounded param), not balance levers.** Suite 34/34 +
sim drift-0 throughout.

### Shipped this session — FYI, no decision (correctness fixes)
| # | What | Fix |
|---|---|---|
| R34 | **HIGH** — the boxing main-event parimutuel was riggable (the "frozen form" thawed 30 min before the hourly worker settled, and resolution read *live* fighter stats → a manager could train up in the gap) | snapshot each fighter's form at booking; resolve from the snapshot (the Grand-Prix/stakes/futurity precedent) |
| R34 | belt lock-order inversion (`wipeFighterAtDeath` title→fighter) → AB-BA vs `acceptCallout` | reordered to fighter→title |
| R32 | a departed/kicked territory **specialist** kept buffing the racket (only death cleared it) | `removeMember` now mirrors the death-path clear |
| R35 | season-rollover gang reset locked in scan order → AB-BA vs a war op at the boundary | per-gang sorted-id reset (holds ≤1 lock — can't be a cycle party) |
| R40 | `fire`/`jump`/`npcHit` were missing the `hospitalized(ch)` **actor** gate every offense sibling has (and `heal` doesn't clear `hosp_until`, so jump's health gate was bypassable) | added the symmetric action-lock |
| R41 | `mod/vig/buyback` accepted an **unbounded** `priceOmrPerEth` → a leaked mod key could mint $OMR past inflow, invisible to both monitors | a price-continuity bound (see the one lever below) |
| R42 | a dead co-op-raid leader didn't notify the orphaned crew (heist/break paths do) | aligned |

Everything else the loop touched (two-party + co-op PvP, accrual/timing precision, worker-sweep concurrency,
snapshot integrity across all worker-resolved events, chain reserve, the Solidity contracts, auth/token/session,
the mod-tools surface, WebSocket/realtime, death/estate + dissolution over all 66 tables, the gate matrix,
client XSS, and the kitchen economy) came back **clean** — no reachable bug.

### New rows that DO want a verdict
| # | What | Recommendation |
|---|---|---|
| **S1** | **R43 — kitchen crew-sale Bureau-raid probability reads UNCLAMPED heat.** Over a long offline window a very hot stash faces a higher raid chance than the heat-100 ceiling implies (the sibling Law-exposure path deliberately uses the *clamped* value). It is **player-UNFAVORABLE** (raids more likely — no gain, no §10.4 drift) and touches the sim-audited heat/raid surface, so I flagged rather than patched. | **WATCH** (or **CHANGE**: clamp the raid-probability heat feed to `min(100, heat)` for parity — a tiny player-favorable nudge on neglected hot stashes; a one-line dial) |
| **S2** | **`VIG_MAX_PRICE_JUMP` (default 10×)** — the new fraud/fat-finger bound R41 added to the manual `mod/vig/buyback` price (once a first buyback sets a reference, a subsequent manual price must be within 10× of the last, up or down). A real DEX TWAP never moves 10× between 12h buybacks; a 200× typo/attack is refused. Env-configurable ops lever, not a game number. | **SHIP** — confirm 10× is comfortable, or set `VIG_MAX_PRICE_JUMP` to your preferred factor |

### Chain go-live — engineering-ready, still launch/audit-gated
The `Bonded` → `recordBond` **watcher wiring is now complete** (`src/watcher.js:syncBondEvents` + the worker
tick, dormant unless `OMERTA_BOND_ADDRESS` is set; test/watcher.js covers it). A new **`CHAIN-DEPLOY.md`**
runbook sequences the whole on-chain go-live. **The three Tier-6 hard gates are unchanged and remain the only
blockers to mainnet — they are NOT signed here (launch/audit track, not a founder tuning call):**
1. **`forge test`** green on a real Foundry toolchain (`omerta-contracts/run-forge-test.sh` — the suite compiles
   clean here but the Foundry VM is egress-blocked; this is the hard pre-audit gate).
2. **Third-party audit of the contracts AND the off-chain EIP-712 signer** (`src/chain.js`).
3. **Launch review** on the Risk-to-Earn / RWA line (eligibility).

Still deferred engineering (not blockers, but needed before real bonds flow): the bond **quote signer** (no
on-chain bond can be created until it ships — the watcher is wired but idle), the POL-pairing + DEX buyback
bots, and the on-chain Store paywall. See `CHAIN-DEPLOY.md` §7.

**Fastest path:** reply *"ship S1/S2"* (or name a CHANGE), and confirm the three chain gates are owned by the
launch/audit track. The correctness fixes above need nothing from you.

---

## 📌 FINAL SWEEP (founder-directed 2026-07-24: *"Bring up a list of all not patched items and apply your game balancing recommendations to all"*)

Every item still marked open across `BALANCE.md`, the 56 `AUDIT-*.md` reports and the sheet above was
re-read, classified, and **acted on**. Nothing is left as an un-owned "flagged" note: each row below is
either **APPLIED** (the recommendation is now in the code), **ACCEPTED** (my recommendation *was* to keep
it — recorded as a decision, not a to-do), or **NOT-A-BALANCE-ITEM** (chain/infra — a separate track,
listed so nothing is lost).

Suite green + `node tools/sim.js` drift-0 after the package.

### A. APPLIED — the recommendation is now shipped

| # | Item (source) | What shipped |
|---|---|---|
| A1 | **Death duty spared unbonding $OMR** (AUDIT-stakes-spine F1) | the duty now taxes liquid **+ unbonding** — the exact base the sibling P1.1 loot uses, so dying mid-unbond no longer shelters the hoard. Staked/RWA/estate stay safe harbours. Both hand-rolled headless persists carry the column. |
| A2 | **THE MESSAGE was a free 1.5× rep + 1.5× ally-shield** (AUDIT-stakes-spine F2+F3) | `JUMP_INTENTS.energyMult` — `message` costs 1.5× energy, so its rep and its hospital blanket are rate-neutral per **energy** as well as per mark-clock. One change closes both flags; the intent now buys concentration + damage, paid in law heat. |
| A3 | **Port "Deep Run" was a trap route** (full-product #2) | `deeprun.sell` 1900 → **2700** (×3.0). Derived, not guessed: realized/day = `cap × [(m−1)·P(clean) − 1.5·P(caught)]`, so the audit's own "~$2,400" still lost to Open Water; ×3.0 gives ~$380k/day vs $303k — a real reward for L32 + 30% bust odds + the boat-sinking risk. |
| A4 | **Stable vs Boxing cap asymmetry** (full-product #4) | `STABLE.STABLE_MAX` 4 → **3**, aligned with `BOXING.STABLE_MAX`. Identical bounded-PvE-purse mechanic; the 4th slot was a free +33% ceiling. |
| A5 | **Gold Rush round-trip** (slate #1) | `tradeSellMult` 1.05 → **1.03** — back under the 4% fee wall, so the season pays traders who move freight and pays nothing for standing still. |
| A6 | **`duel_wins` farmable off one funded alt** (slate #2) | the lifetime legend now needs a **new opponent bloodline each day** (`prior === 0`, reusing the pair/day counter the ELO K-decay already computes — the hitman-rep diminishing precedent). The level floor bounded *who*; this bounds *how often*. |
| A7 | **Latent sub-1 `safehouseMult`** (slate #3) | the signed $25k floor is re-asserted **after** the season multiplier in both `enterSafehouse` and the view quote. No current mod is <1 — this just makes the floor un-breachable by a future season. |
| A8 | **`whack:loot` had no level floor** (2.3) | `M3.LOOT_MIN_LVL` (10) — a fire-kill on a rookie still runs the full estate but pays **no** cash/$OMR/gear/contraband, closing the disposable-alt value funnel without touching the D1 whale-hunting economics. |
| A9 | **Loan-house death cycle** (deep-deferred) | `LOAN.HOUSE_MIN_LVL` 3 → **10** — a throwaway borrower now costs a real grind (the WANTED_MIN_LVL posture). The P2P market stays open to new players from level 1. |
| A10 | **Pen `PROTECTION_COST` flat** (Tier 3) | wealth-scaled: `max($15k, (cash+bank) × PROTECTION_NW_BPS 50)` per 2h — the SAFEHOUSE_NW_BPS pattern at half rate for half the window. A riot's half-price cover is a *designed* discount, so the floor guards the wealth scale only. |
| A11 | **No shank cooldown** (Tier 3) | `PEN.SHANK_CD_MS` (30 min) per attacker, set win **or** lose. Energy + a shiv + a sentence extension let a stocked-up inmate work down a whole wing in one sitting. `PEN_SHANK_CD_MS` is a test-only knob. |
| A12 | **S1 — crew-sale raid read UNCLAMPED heat** (sheet addendum) | the raid probability now reads `min(100, heat)`, matching the sibling Law-exposure path. Player-favourable; a neglected hot stash can't face worse odds than a maxed heat bar implies. |
| A13 | **`upgradeRacket` dodged a pending Bureau raid** (Tier 5) | it now resolves the crackdown first — parity with the speakeasy's resolve-before-upgrade fix. Upgrading banks the pending take, so it had been a way to launder a hot operation's income past the roll `collectTerritory` runs. |
| A14 | **Heist `fenceLoot` had no safehouse gate** (tier1-deepening) | added — fencing is income-realizing, so it can't run from cover. Now the whole risk layer reads one way. |
| A15 | **`buyPaper` had no safehouse gate** (loan step-three F1) | added for offerLoan parity. Low value on its own (the audit said so) — shipped so the loan surface is consistent: you don't do business from a bunker. |
| A16 | **Megaproject goods rail had no $-value floor** (megaproject C5) | freight worth less than `MIN_CASH` is refused — a $40 unit could buy a plaque row the $100 cash floor rejects. |
| A17 | **RWA float claims weren't minted-gated** (rwa-float #2) | `claimVaulted` now requires `minted`. Two independent reasons the audit gave: the per-account daily cap only bounds anything if an account *costs* something (the Wage D1 precedent), and un-verified alt claims permanently shrink the float (nothing decrements `rwa_vault`). |
| A18 | **Numbers lazy-dominates the hot racket types** (full-product #3) | guidance, not a retune (the curve is signed): every type's description now states the collection cadence it needs — Numbers explicitly "the best type if you collect once a day", the hot types "collect inside ~Nh". Informed choice instead of a trap. |
| A19 | **i18n over-promise** (full-product #5) | the picker is labelled **"(menus)"** with a tooltip saying the game text stays English. Honest about what the 15 packs cover; a prose translation remains a real content project, not an overnight machine pass. |

### B. ACCEPTED — my recommendation was to keep it (now a decision, not an open item)

- **Jump-to-shield** (stakes-spine F2b): hospital = protection is the signed v24 rule, and A2 removed the
  *amplification*. Deliberately jumping an ally to shelter them stays possible and stays symmetric.
- **Megaproject plaque includes agents** (C3): every other status board excludes agents because the axis is
  free to farm. The plaque is **bought with burned value** — an agent paid the same price. Kept inclusive.
- **Secrets: instant expose, late-window quiet expiry, no actor gates, multi-holder stacking**: all bounded
  and intended (real dirt required; a 5-ring day reaches 125 exposure vs `INDICT_AT` 3000). The pressure is
  the mechanic. `exposeHeat` / `MAX_HELD` / `DIG_OMR` remain the dials if the alpha disagrees.
- **Status-board Sybil inflation** (commander / spymaster / collector / statesman / kingpin / tycoon /
  builder / recruiter boards): earned by real play, **no payout attaches**. The hitman-rep posture. A Sybil
  ring can inflate any status axis and no per-account cap fixes Sybil — accepted, as before.
- **Estate staff walking** (deep-deferred): the rehire fee floors the recurring sink for a gala-only owner.
  Bounded and self-correcting (no staff = no gala prestige); dials recorded, no change.
- **Commission levy self-deal / last-second proposal sniping**: bounded by a public vote + the *seasonal*
  seat formula the econ-pass fix installed. Intended leverage; a levy-cadence cap is the dial if it becomes
  the permanent decree.
- **Ring-poker soft play / chip dumping**: dumping is a *worse* transfer rail than the audited 2% ones
  (raked ≥3%); out-of-band collusion is unpreventable server-side in any poker game. The rake taxes it.
- **Mad Dog can name a consigliere**: flavour (a mad dog with a respected adviser). Unlike marriage and
  diplomacy, no lockout is load-bearing here.
- **Trade-goods arbitrage** (1.6), **bank-interest 24/7 edge** (1.5), **occupation on-ramp** (2.2),
  **standover forced-sale price** (2.8), **hole teeth / `pen:work`** (Tier 3), **WANTED disproportion +
  pool-bounty alt-farm** (Tier 4), **convoy insurance remainder**, **omertà gang-churn**, **open-season
  entry-time semantics**, **heist leader-rat grief**, **endgame crime at the 0.97 cap**, **`demandTrial`
  cheap reset**, **business/racket bucket stacking**: previously SHIPPED/WATCH — re-confirmed, unchanged.
- **Passive fronts ≫ active loops** (full-product #1): already acted on this session by the founder-directed
  **L1a + L1b** package (apex front incomes halved, progressive pad) — the maxed 5-front stack fell
  **$48.96M → $21.6M/day net** (2.27×), measured by sim P9.20. The remaining gap is the intended
  "capital works for you" endgame. Further dials (a global personal-income cap, the full front curve,
  territory-side) stay available.
- **Cosmetic LOWs** (full-system-v4): the `raceChallenge` ternary, the `rentBerth` arithmetic UPDATE (proven
  working), the `assertChainId` warning verbosity, `claimPendingWire` defence-in-depth. No behaviour, no value.

### C. NOT A BALANCE ITEM — separate tracks (listed so nothing is lost)

- **Chain / mainnet (Tier 6):** `forge test` is now **GREEN — 73/73 incl. both fuzzes** (first execution,
  2026-07-23), so gate 1 is closed. Remaining: **third-party audit** of contracts + the off-chain EIP-712
  signer, and **the launch checklist** on the Risk-to-Earn / RWA line. Neither is a founder tuning call.
- **RWA float pre-mainnet economics** (rwa-float #1/#3/#4): the stale-oracle free option, FCFS sniping, and
  the R3 simulated-unit reconciliation. #2 (minted-only) shipped as A17; the rest genuinely need the real
  buy bot + oracle to exist before they can be decided. **#1 remains the single most important economics
  decision before the bot switches on.**
- **Infra:** the per-IP throttle gap is largely closed (auth bucket + keyless heavy-GET limiter). Residual
  hardening is a deploy concern.
- **Deploy config:** production must run `SOCIAL_VERIFY_MODE=live`, `INVITE_MODE=on` for the closed alpha,
  and must **not** set any `*_P` / `*_MS` test knob (`SHANK_P`, `LAW_BUST_P`, `SEARCH_MS`, `PEN_SHANK_CD_MS`,
  `TERRITORY_RAID_P`, `GEAR_LOOT_CHANCE`, …).

---

## THE 2026-08-16 QUESTIONNAIRE — every open decision put to the founder as options, all answered

Seventeen decisions across five rounds (the launch-sequence levers, the airdrop, the identity NFT,
and the standing economy calls). Each row below is now the standing answer; the edits landing in the
same commit as this section: the launch doc §6 (rewritten from "none pinned yet" to the answers),
the identity doc §7 (all four answered), and the hook docs (the buy-rate question closed).

**The chain / launch set:**
1. **Hook permanent buy-side rate: REJECTED — buys stay free forever.** The one immutable pre-audit
   choice, made with the immutability stated. The windowed anti-snipe guard ships armed at zero; the
   dormant trade-fee backend never arms. The audit batch goes out as-is.
2. **The genesis price: confirmed at 205,882 $OMR/ETH** (the locked genesis-raise parameter; window
   price == pool opening price).
3. **Window: 3 days, even split** (≈1.47M $OMR/day), the live daily-offering control kept as the
   mid-window trim. **Desk rail open during the window.**
4. **Airdrop delivery (D1): in-game credit via the SIWE rail — confirmed.** No merkle contract.
5. **Airdrop legal: covered** — the founder confirmed counsel's approval extends to the free
   distribution; the launch checklist's open row closes on that word.
6. **Airdrop reserve: 20M $OMR (20% of supply) as a multi-campaign budget** — the founder's framing:
   not dropped at once; the genesis slice is a sub-lever sized at allocation-build time (working
   proposal ~5M, the paid window's own scale).
7. **Communities: the named six PLUS Milady Maker (mainnet) PLUS the $ANSEM-class Solana community —
   and Solana support is a directed launch build** (a Solana enumeration tool + an ed25519 leg on the
   claim rail; its own red-team pass, since it is a new signature-verification surface).
8. **Claim window: 120 days. Provenance colors decoupled** (claimable after the money window lapses).
9. **Stock-delivery verification depth: wallet + paid mint + self-attestation** — one eligibility
   confirm recorded at deed extraction (a small directed build); revisit before volumes grow.

**The identity NFT set (all four §7 questions):** layered composition confirmed; silhouette-forward
confirmed; bloodline-continuous confirmed (freezes only at the token's first owner→owner transfer,
as the shipped watcher enforces); retrofit for every existing minted account confirmed.

**The standing economy set:**
- **Unification: keep the separate signed splits** (folding rates silently moves real money between
  destinations; the money router keeps the whole map legible).
- **Agent participation faucets: leave open to agents — recorded as the deliberate posture.** The
  three petty in-game-cash faucets (corner jobs / the nightly hustle / the first-blood bonus,
  ~$8,500/day combined, no extraction path) stay agent-payable; the asymmetry with the four
  excluding siblings is now a decision, not an oversight.
- **Street Deeds turf perks (phase 2C): BUILD NOW — ✅ BUILT 2026-08-16** (the controller's perks:
  the district perk follows corner CONTROL, OR'd with family turf by set-union so it never stacks,
  + one own-corner op seat capped at `SLOTS_MAX` — free-player parity made literal; sim P9.38,
  BALANCE.md § STREET DEEDS 2C, levers `DEEDS.PERK_TURF`/`PERK_OP_SLOTS` pinned).
- **Launch-night doors: open** (`INVITE_MODE` stays off — the paid mint remains the extraction-side
  Sybil bound). Note this supersedes the older "INVITE_MODE=on for the closed alpha" line above for
  launch itself; the invite tooling remains available if a gated wave is ever wanted.

**Directed builds created by these answers (all three ✅ BUILT 2026-08-16):** the Solana snapshot +
ed25519 claim leg; the deed-extraction self-attestation; Street Deeds phase-2C turf perks.

## THE 2026-08-21 PAIR (founder: "Gear joins the roundtrip & B Wallets also grant bonus points based on history/usage")

1. **GEAR JOINS THE NFT ROUND TRIP — SIGNED + ✅ BUILT same day** (`omerta-nft-reimport-design.md`
   §7). This is the §0 pay-for-power pivot extended from property to the stat layer: a
   marketplace-bought gear NFT, burned, raises `effStat` at every contest — the founder signed that
   explicitly. Built: the frozen `GEAR_TOKEN_IDS` map (append-only, load-guarded), `GearVault.redeem`
   accepts gear one-at-a-time (audit batch — forge 306/306), the three-case rule in `applyReimport`
   (account-level: linked wallet, no living character needed), `GET /v1/mod/items/stranded`.
2. **THE WALLET FORGE at depth B — SIGNED + ✅ BUILT same day** (`omerta-wallet-forged-stats-design.md` §6): the
   wallet decides the stat SHAPE (archetypes, all summing to `CREATE_STAT_TOTAL`) AND grants banded
   BONUS POINTS from wallet history/usage (age/gas tiers, capped at `WALLET_FORGE.BONUS_MAX`). This
   is an explicit, bounded retirement of "outside wealth must not buy power" on the stat layer — the
   §4.3-retirement shape: a small CEILING (+3 vs the 15-point base, once per wallet EVER, dwarfed by
   ordinary stat training), recorded in BALANCE.md § THE LEDGER-BORN. Built: `src/walletforge.js`
   (the `wallet_rolls` once-per-wallet-EVER latch, banded storage only, fail-closed reader read
   OUTSIDE the transaction), `POST /v1/character/forge` + `GET /v1/forge`, THE FORGE card on Going
   Legit, the sheet's forged-archetype line, `WALLET_FORGE` levers pinned in `test/levers.js`,
   `test/walletforge.js` (four mutations, each caught at its own named assertion).
3. **THE BUDGET PERK — DIRECTED + ✅ BUILT same day** (founder, 2026-08-21: *"I want the wallet to
   decide the budget as well for an extra perk"*). The forge's third grant: a banded BUDGET perk —
   `forgeBudgetExtra = max(0, ageTier + velTier − 1)`, hard-capped at `WALLET_FORGE.BUDGET_MAX` (3)
   — extra WHOLE-budget points spread deterministically round-robin across the three stats (the
   wallet widens the build; the bonus is what re-aims it). Total ceiling 15+3+3 = **21 (+40%)**,
   once per wallet ever; an unknown wallet still rolls exactly 15. Recorded in BALANCE.md § THE
   LEDGER-BORN; two more named mutations (the cap dropped; the spread collapsed onto the boost stat).
