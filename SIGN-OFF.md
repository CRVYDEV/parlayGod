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
| 1.2 | **Speakeasy bar take** | **$3.12M/day per club** at top tier (Cathedral) — *newly measured this pass* | A maxed nightclub earns territory-scale money. It's heavily gated (level 15, ~$17M to max, a 20% "pad" upkeep, notoriety→Bureau-raids, safehouse-gated collection), but it was **never sim-measured** until now. | **WATCH → sim the net** — it's capital-gated and risk-taxed so probably fine, but I'd measure net-of-upkeep-and-raid EV before a real-money economy. The one row I'd most want a second look at. |
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
