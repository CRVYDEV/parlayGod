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
**Tier 6 remains a separate legal/audit track** — not signed here.

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
| 2.3 | **`whack:loot` has no level floor** | A colluding pair can funnel lootable gear/$OMR from disposable low-level alts onto one main before extracting (mints nothing — pure concentration). | **WATCH** — the fight-fix/referral Sybil posture; dial is a per-bloodline loot cap or a target-level floor |
| 2.4 | **Family-contract laundering** | The funder-lockout only blocks *current* members, so leave→kill-for-the-pot→rejoin routes gang treasury into a personal wallet. | **WATCH → fix later** — real but fiddly; the clean fix is to snapshot the funding gang's member list for the pot's life |
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

## TIER 6 — SEPARATE TRACK: legal + audit gated (NOT balance — do not "sign" here)

These are **not economy levers** — they're gated on **legal counsel + a third-party audit** before any
mainnet/real-money step, independent of everything above. Listed so nothing's lost.

**Legal-gated (counsel signs, not you):**
- Reserve Bond, the Store's RWA revenue share, PLEX pricing, R2/R3 real-RWA extraction, the tier-2
  "family tree" referral — all held until counsel + audit. Keep the tier-2 referral **flat, cash-only,
  depth-2, agent-excluded** (the anti-MLM line) — do not deepen without counsel.

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

### Chain go-live — engineering-ready, still legal/audit-gated
The `Bonded` → `recordBond` **watcher wiring is now complete** (`src/watcher.js:syncBondEvents` + the worker
tick, dormant unless `OMERTA_BOND_ADDRESS` is set; test/watcher.js covers it). A new **`CHAIN-DEPLOY.md`**
runbook sequences the whole on-chain go-live. **The three Tier-6 hard gates are unchanged and remain the only
blockers to mainnet — they are NOT signed here (legal/audit track, not a founder tuning call):**
1. **`forge test`** green on a real Foundry toolchain (`omerta-contracts/run-forge-test.sh` — the suite compiles
   clean here but the Foundry VM is egress-blocked; this is the hard pre-audit gate).
2. **Third-party audit of the contracts AND the off-chain EIP-712 signer** (`src/chain.js`).
3. **Legal counsel** on the Risk-to-Earn / RWA line (jurisdiction/KYC/geofence).

Still deferred engineering (not blockers, but needed before real bonds flow): the bond **quote signer** (no
on-chain bond can be created until it ships — the watcher is wired but idle), the POL-pairing + DEX buyback
bots, and the on-chain Store paywall. See `CHAIN-DEPLOY.md` §7.

**Fastest path:** reply *"ship S1/S2"* (or name a CHANGE), and confirm the three chain gates are owned by the
legal/audit track. The correctness fixes above need nothing from you.

---

## 📌 FINAL SWEEP (founder-directed 2026-07-24: *"Bring up a list of all not patched items and apply your game balancing recommendations to all"*)

Every item still marked open across `BALANCE.md`, the 56 `AUDIT-*.md` reports and the sheet above was
re-read, classified, and **acted on**. Nothing is left as an un-owned "flagged" note: each row below is
either **APPLIED** (the recommendation is now in the code), **ACCEPTED** (my recommendation *was* to keep
it — recorded as a decision, not a to-do), or **NOT-A-BALANCE-ITEM** (legal/chain/infra — a separate track,
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
| A17 | **RWA float claims weren't minted-gated** (rwa-float #2) | `claimVaulted` now requires `minted`. Two independent reasons the audit gave: the per-account daily cap only bounds anything if an account *costs* something (the Wage D1 precedent), and un-KYC'd alt claims permanently shrink the float (nothing decrements `rwa_vault`). |
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
  signer, and **legal counsel** on the Risk-to-Earn / RWA line. Neither is a founder tuning call.
- **RWA float pre-mainnet economics** (rwa-float #1/#3/#4): the stale-oracle free option, FCFS sniping, and
  the R3 simulated-unit reconciliation. #2 (minted-only) shipped as A17; the rest genuinely need the real
  buy bot + oracle to exist before they can be decided. **#1 remains the single most important economics
  decision before the bot switches on.**
- **Infra:** the per-IP throttle gap is largely closed (auth bucket + keyless heavy-GET limiter). Residual
  hardening is a deploy concern.
- **Deploy config:** production must run `SOCIAL_VERIFY_MODE=live`, `INVITE_MODE=on` for the closed alpha,
  and must **not** set any `*_P` / `*_MS` test knob (`SHANK_P`, `LAW_BUST_P`, `SEARCH_MS`, `PEN_SHANK_CD_MS`,
  `TERRITORY_RAID_P`, `GEAR_LOOT_CHANCE`, …).
