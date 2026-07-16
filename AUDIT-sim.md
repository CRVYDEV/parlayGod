# OMERTÀ — Full Sim Audit (core loops, contract interactions, technical + economic bugs)

**Method.** Two tracks. (1) Four parallel red-team passes over the source: cross-feature
interactions, the contract/PvP web, economic exploit math, and §10.4/infrastructure coverage —
every claim verified against code with file:line cites. (2) A **simulation harness**
(`tools/sim.js`, kept in-repo, `node tools/sim.js`) that drives the REAL server through the public
API only: every dollar earned honestly (crimes → rackets → businesses → kitchen → kills → washes →
staking → territory → vig/PLEX), clocks warped to compress days, and the full §10.4 sweep asserted
at the end — **any drift is a real leak found by simulation**, and the run exits non-zero.

**Headline: the ledger is sound; the incentives are not.** All 8 §10.4 checks hold with ZERO drift
over an entirely earned economy that exercises death/estate, raids, shakedowns, escrow, the vig and
PLEX. Eleven code-grade bugs found and fixed in-commit (below). But the measured numbers say the
Risk-to-Earn thesis is currently inverted at endgame: risk-free passive income dominates every risky
loop, killing is −EV even against careless victims, and the raid layer that was supposed to price
extraction was mathematically unreachable (now retuned to be alive, still founder-gated).

## 1. What the simulation measured (pg-mem, all honest money)

| Loop | Measured | Reading |
|---|---|---|
| Crime curve | stereo $183 → poker $962 → payroll $3.0k → counting $11.7k → depository $72k per attempt | healthy exponential; jail time is the real cost |
| Top-tier grind ceiling | ~$4.7–14M/day (RNG variance across runs, ~200 attempts) | active play CAN pay big… |
| Laundro racket ($12.5k) | $15,840/day → **19h payback** | …but passive matches it per dollar |
| Laundromat t1 business ($250k) | $288,000/day → **21h payback** | 0.91× per-dollar vs racket — ON-curve, additive though |
| Territory racket (Numbers $50k) | $96,000/day → **12.5h payback** | best ROI in the game (see sign-off list) |
| Kitchen entry (bathtub, vim) | **$243/cycle** net | the risky on-ramp barely beats one stereo boost |
| Kill (lvl-19 mark, btk 1670) | 2,151 rounds @ $40 = $86k cost; loot $10.6k (25% pocket) | **−$75k EV vs a CARELESS mark; −$86k vs a banked one** |
| Private wash (t1 cap ×3d) | $60k → 116.9 $OMR, heat 8/wash | lower heat than street (15), as designed |
| Forced Bureau raid | fine $25k (10% tier) + $60k pending seized, ledgered | mechanics correct under honest money |
| AMM | genesis $10M/20k $OMR = $500; sim washes moved it +1.2% | depth is TINY vs endgame faucets (sign-off F4) |
| Staking | buyback funded pool 30%; 30-day claim paid, pool-throttled | backed emission works; yield = f(activity) |
| Shakedown | one hit = $86,400 (30% of a 24h t1 till) vs jump cap $25k | the AFK tax is real; collect cadence is the defense |
| Vig | 0.066 ETH revenue → 66 hard $OMR bought → reserve+prizes; invariants ✓ | extraction ≤ inflow holds by construction |
| **§10.4 sweep** | **8/8 checks, drift 0** | character cash, treasuries, escrow, $OMR, cars, cb, ammo, vocabulary |

## 2. Fixed in-commit (code-grade, each with a regression where testable)

1. **`jump` war-scoring deadlock** (HIGH) — two unsorted single-gang UPDATEs; simultaneous
   cross-jumps between warring families AB-BA deadlock on real Postgres. The earlier audit's fix
   landed only in `fire`. Now the same single `WHERE id IN … CASE` statement (`social.js`).
2. **Bounty-sweep lock inversion** (MED) — `sweepExpiredBounties` locked all expired pots, then
   wrote funder character rows (pots→characters, inverse of every player path). Now one pot per
   transaction, funder characters locked sorted FIRST, pot re-verified, funder-set change retried
   (`social.js`).
3. **Anon family contract leaked the family on the public streets feed** (MED) — the 3 $OMR bought
   silence on the board but `bus.emit('streets', {family})` outed it live, including on top-ups of
   an anon pot. The emit now respects the POT's flag (`social.js`; regression in `test/social.js`).
4. **Bureau raids were mathematically unreachable** (HIGH, own proposed constants) — scrutiny max
   +25/day vs decay 48/day vs threshold 60: the entire PvE risk layer was dead code, private
   laundering strictly dominated the street. Retuned (founder lever): PER_CAP 45, decay 1/hr,
   scrutiny cap 100, p 0.0005/min — max-throughput washing crosses the threshold in ~days;
   ≤half-cap use stays safe (`rules.js`, `business.js`).
5. **Raid fine dodged by banking** (LOW) — clamped to pocket only; now drains pocket then bank
   (single §10.4 row stays exact) (`business.js`; regression).
6. **Launder "daily" cap allowed 2× at every window boundary** (MED) — fixed 24h window reset in
   full; now a continuous token bucket refilling `launderCapDay`/24h (`business.js`).
7. **Raid-window `floor()` rewarded touch-pacing** (MED) — a 119s collect cadence halved cumulative
   raid probability; the exponent is now the unfloored minute count (pacing-neutral) (`business.js`).
8. **`path:` missing from the cash vocabulary** (MED) — every player's $10k first career pick
   tripped a permanent false §10.4 alarm in production (alert fatigue burying real drift). Added +
   regression that runs the invariant job after a path pick (`invariants.js`, `test/growth.js`).
9. **Business laundering bypassed the swap rate bucket** (LOW) — same AMM, 6/min guard now covers
   the launder route (`ratelimit.js`).
10. **Dead bodyguard stranded his principal** (MED) — protection already void, but the stale
    pointer blocked a replacement hire for the paid window; `runEstate` now releases principals
    (with the in-memory killer-as-principal clobber case handled) (`social.js`; regression).
11. **`bodyguard:hire` was the game's only untaxed, unlimited P2P transfer** (MED-econ) — 0% vs 2%
    everywhere else: alt-consolidation + referral net-worth pumping channel. Now the standard 2%
    house take; the guard nets 98% (`social.js`; test updated).

Plus: **vig invariant made two-sided** — a crash between the buyback COMMIT and the post-commit
reserve funding used to be invisible (all checks green, winner's withdrawal queued forever); a new
`reserve not under-funded` check alarms it (`vig.js`). **Fee-credit TOCTOU sweep** — a wallet that
links in the same instant its fee lands could strand the credit with no retrigger; the worker now
re-reconciles uncredited payments against linked wallets (`fees.js`, `worker.js`). Shakedown gained
hospitalized-attacker + health-floor gates; business row locks are ownership-scoped.

## 3. Founder sign-off list (balance/design — NOT patched, per ground rule #1)

Ranked by how hard each undermines Risk-to-Earn:

- **F1 (BREAKS): The safehoused landlord.** Rackets + asset fronts + businesses are three ADDITIVE
  passive systems (~$320M/day fully built) and all collect fine from inside a $150k/day safehouse;
  the riskiest active loop (Cathedral kitchen ~$12M/day) earns ~25× less. Levers: wealth-scaled
  safehouse cost, re-entry cooldown, and/or classing `collect`/`bank deposit` as extraction acts.
- **F7 (BREAKS): Killing doesn't pay** — sim-measured −$75k vs a careless mark, −$86k vs a rational
  one (bank + instant unstake zero out both loot surfaces; on-chain gear is exempt). Levers: delayed
  bank deposits (located act / N-hour clearing), a short unstake cooldown, cheaper ammo for the gun
  path, or loot touching a slice of bank.
- **F3 (BREAKS, token): PLEX prices make the ETH rails irrational** (5 $OMR ≈ minutes of play vs
  0.01 ETH real money) → nobody pays ETH → vig revenue ≈ 0 → the extraction reserve starves.
  Lever: price PLEX off the DEX TWAP with a premium, or hard-ratio it to the reserve's cost basis.
- **F4 (BREAKS): AMM depth vs endgame faucets** — one whale-day of passive income can buy ~90% of
  the 20k $OMR float; the private launder caps aren't the binding constraint, slippage is, and the
  public wash house is amount-uncapped with fast-decaying heat. Levers: protocol-owned liquidity
  growth (tax slice to BOTH sides of the pool), per-account public wash cap, slower launder-heat decay.
- **F5 (DISTORTS): Territory rackets** — fastest payback in the game, tier-flat ROI, and seizing a
  built-out district costs ~$40k vs $1M build cost (~18× capital efficiency for the aggressor →
  top-family snowball). Levers: taper tier ROI, scale war/seize costs with district value.
- **F6 (DISTORTS): Business/racket additivity** — businesses sit on-curve per dollar (0.91×,
  sim-measured) but stack on top of the 12h racket bucket rather than sharing it, roughly doubling
  passive throughput. Lever: shared or parallel daily bucket family for businesses.
- **Directed-contract squatting** — a mark's confederate can hold the `(target,kind)` pot with a
  $500 directed contract on a friendly alt (7-day exclusive window): enemies can only top up a pot
  only the alt can claim, and an outsider kill refunds it. Levers: hitman consent/acceptance,
  higher directed floor, or a funder-majority vote to open the window.
- **Kitchen on-ramp** — $243/cycle at entry tier (sim): the first risky loop barely beats petty
  crime. Lever: shade entry margins up or cut bathtub/makings costs.
- Smaller watch items: NPC-hit per-target cooldown (already flagged), respec-before-contest (no
  cooldown), choose-your-death via NPC hit (skips loot + burns hunters' pots), `GET /v1/me` accrues
  outside the rate-limit guard, `payPrizes` batch-id replay guard, territory-seizure loser gets no
  notification, legacy `mod/reserve/fund` permanently reddens vig check (3) by design.

## 4. Ops notes

- `node tools/sim.js` re-runs the whole economic sim; it exits non-zero on any §10.4 drift. It
  seeds NO value (only clocks/stats/energy), so it doubles as a leak detector — run it after any
  economy-touching change.
- `BUSINESS_RAID_P` joins `SEARCH_MS`/`SHOOT_CD_MS`/`GEAR_LOOT_CHANCE` as TEST-ONLY env knobs —
  never set in production.
- The retuned scrutiny constants (fix #4) are still founder levers: they make the layer REAL;
  the founder sets how punishing it should be.
