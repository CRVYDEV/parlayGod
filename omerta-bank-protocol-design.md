# THE BANK — OMERTÀ as a dual game / DeFi protocol

*Founder-directed 2026-08-10. A synthesis of **Alchemix** (self-repaying loans), **Inverse
Finance / DOLA + FiRM** (a debt-backed stablecoin and the security architecture its two 2022
exploits forced), and **Monolith Market** (free-vs-paid debt, redemptions as peg defense, an
autonomous rate controller). Deployed on Robinhood Chain (EVM, chain ID 4663, Arbitrum Orbit,
ETH gas). The player-facing surface is the **Bank** tab.*

**This supersedes the first draft of this document (PR #26), which split the ask into an in-game
mechanic and a blocked on-chain protocol. That framing was wrong: the founder's direction is one
protocol that is simultaneously a game system and a real DeFi protocol.**

---

## 0. What this is

The Bank tab stops being play money and becomes the front-end of a real protocol:

1. A player deposits **ETH or a high-quality stablecoin** (USDC/USDG) — *founder-constrained
   2026-08-10: those are the only collateral types, chosen for depth and low liquidity risk.*
2. The collateral is deployed into vetted yield.
3. The player borrows our stablecoin against it at high LTV and **near-zero nominal rate**.
4. **The yield repays the debt.** The player never makes a payment.
5. **Protocol profit routes back into the game** — split to NFT holders, and/or used to buy $OMR
   on the open market and hand it to free players.

Step 5 is the part that makes this a *dual* system rather than a DeFi protocol with a game
attached. It is also, structurally, the safest thing in the design — see §4.

---

## 1. What we take from each source, and what each one's scars teach

### 1.1 Alchemix — the self-repaying mechanic

**Architecture** (v2, from the [C4 audit target](https://github.com/code-423n4/2022-05-alchemix)):
`AlchemistV2` holds accounts and issues debt; balances are held as **shares** of a yield token —
an accounting abstraction whose stated purpose is to *"avoid bank-run scenarios"*; debt is a
signed `int256` so credit and debt are one field. `TransmuterV2` is the peg: any holder exchanges
the debt token for underlying **1:1**. `TransmuterBuffer` sits between them, buffering the flow
from `repay()`, `liquidate()` and `harvest()` with configurable rate limits.

**The two findings that forced redesign** ([Runtime Verification, 7 weeks, Jan
2022](https://runtimeverification.com/blog/alchemix-v2-audit-and-reviewed-code-fixes)):
1. **Large depositors could obtain an unfair advantage** in the accounting.
2. **The Transmuter had to be guaranteed solvent even if the backing yield token unexpectedly
   lost value.**

Finding 2 is the one to internalise. *A 1:1 redemption promise is only as good as the worst day of
the asset behind it.* Alchemix's answer was the buffer plus flow limits; ours is §2.4.

Alchemix later encoded the audit's invariants **in Solidity for fuzzing** — the practice this
project already follows (`forge test`, 128 tests, two 512-run fuzzes), so it is the standard our
batch must meet, not an aspiration.

**Also on the record:** Alchemix was hit for ~$13M in the July 2023 Curve/Vyper reentrancy
incident — *not a flaw in Alchemix's own code*, but in a pool it depended on. That is the
composability tax, and it is an argument for §2.6's isolation rule.

### 1.2 Inverse Finance — the stablecoin, and two very expensive lessons

DOLA is a debt-backed stablecoin: supply expands only when someone borrows it against collateral.
That is the right model and we adopt it.

**But Inverse was drained twice in 2022, and both were the same bug in different clothes:**

| Date | Loss | Mechanism |
|---|---|---|
| **2 Apr 2022** | ~**$15.6M** | The Keep3r **TWAP oracle for INV** was manipulated via the INV/WETH Sushiswap pool. The attacker borrowed 1,588 ETH, 94 WBTC, ~4M DOLA and 39 YFI against INV worth far less. |
| **16 Jun 2022** | ~**$5.8M** protocol loss | Flash-borrowed 27,000 wBTC into Curve's tricrypto pool, inflating the **yvCurve-3Crypto LP price**, then borrowed DOLA against it. |

**Both are oracle manipulation of thin, manipulable collateral** — their own governance token in
the first case, a leveraged LP token in the second. There is also a [March 2026 DOLA manipulation
incident (~$240K)](https://www.cryptotimes.io/2026/03/02/inversefinance-faces-240k-loss-in-dola-manipulation-alert/),
so the class is live, not historical.

**FiRM is their rewrite, and it is a catalogue of the right answers:**
- **Personal Collateral Escrows** — every user's collateral sits in **its own contract**, never a
  shared pool. *"There is no single, centralized pool for attackers to target."*
- **Pessimistic price oracles** (worst recent price, not spot).
- **Daily borrowing limits** — a cap on damage per block-window even if everything else fails.
- **Flash-loan protection.**
- **DBR** (DOLA Borrowing Rights): a token = the right to borrow 1 DOLA for 1 year, which makes
  borrowing fixed-rate. Its cleverest property: force-replenishment prices DBR **at a deliberate
  premium so the protocol never has to consult an oracle about DBR at all.** *The best oracle is
  the one you removed.*

### 1.3 Monolith — the peg mechanism that needs no liquidator

Monolith's [factory](https://docs.monolith.market/) deploys an immutable stablecoin per
(collateral, price feed). Its distinctive move is **two borrowing modes**:

- **Free debt — 0% interest, but redeemable.** Any Coin holder can
  [redeem](https://docs.monolith.market/protocol/redemptions.md) against your position at oracle
  price **+ a fee** (0.3% in their example), **pro-rata across all free-debt holders** — hold 40%
  of free debt, absorb 40% of the redemption. Your debt falls by exactly what was redeemed, and
  **the fee stays with you**, so being redeemed against is compensated, not punitive.
- **Paid debt — a variable rate, and untouchable by redemptions.** That interest is what funds the
  **sToken** staking vault.

An **autonomous rate controller** ties them together: if the free-debt share falls below target
the paid rate *rises* (pushing borrowers into free debt, deepening redemption liquidity); if it
runs high the rate *decays toward a floor*. **The rate is a peg-defense instrument, not a revenue
knob** — that is the insight worth stealing.

Why this matters for us: redemption is a **price floor that works when DEX liquidity does not**.
Any holder can always get $1 of collateral for 1 Coin. No liquidator, no keeper, no auction.

---

## 2. The architecture

### 2.1 THE DECISION THAT REMOVES LIQUIDATIONS ENTIRELY

The founder's ETH/USDC-only constraint enables the strongest structural choice available, and it
should be taken deliberately rather than stumbled into:

> **Match the debt's denomination to the collateral's denomination, and price risk — therefore
> liquidation, therefore the oracle on the borrow path — disappears.**

This is precisely why Alchemix runs `alUSD` against DAI/USDC and `alETH` against ETH/stETH, and
never one against the other. So we run **two isolated markets**:

| Market | Collateral | Debt token | Price risk | Liquidations | Oracle on borrow path |
|---|---|---|---|---|---|
| **The Vault** | USDC / USDG | **`nUSD`** (USD-denominated) | none | **none** | **none** |
| **The Ledger** | ETH / wstETH | **`nETH`** (ETH-denominated) | none | **none** | **none** |

**A cross-denominated market (ETH collateral → USD debt) is exactly the shape that lost Inverse
$21M and it is out of scope.** If it is ever wanted, it is a separate market with a separate risk
budget, its own oracle stack, and its own audit — never a parameter change to these two.

The consequence is worth stating plainly: **there is no price at which a user in either market is
liquidated.** Their debt only ever falls. That is a *better product* than any competitor offering
"low liquidation risk," and it is achieved by removing the mechanism rather than tuning it.

### 2.2 Self-repaying, and the honest timescale

Debt repays from yield on the **full** collateral, so `T = LTV ÷ yield`:

| Yield | 50% LTV | 80% LTV | 90% LTV |
|---|---|---|---|
| 3% (organic stable) | 16.7 yrs | 26.7 yrs | 30 yrs |
| 5% | 10 yrs | 16 yrs | 18 yrs |
| 7% (incentivised) | 7.1 yrs | 11.4 yrs | 12.9 yrs |

**This is not a flaw to be engineered away — it is what self-repaying means, and Alchemix ships it
at ~50% LTV for this reason.** The product requirement it creates is a *copy* requirement: the UI
must show the **actual projected payoff date from the live realised yield**, recomputed as the
yield moves, and must never use a phrase implying speed. The mechanic's honesty is the feature;
a user who understands "this repays itself over years, and I am never liquidated meanwhile" is
getting a genuinely good deal. One who was told "self-repaying" and expected months is a
complaint and a regulatory exhibit.

At the founder's requested 80–90% LTV against stables, the collateral is USD and the debt is USD,
so high LTV carries *no liquidation risk* — the only cost is that repayment takes longer. **90% is
therefore defensible here in a way it never is in a cross-denominated market.** The binding
constraint on LTV becomes the Transmuter's solvency (§2.4), not price.

### 2.3 Free debt and paid debt (Monolith), which is also the game's difficulty setting

Both markets carry Monolith's two modes, and they map onto the noir fiction with no strain:

- **"On the arm"** (free debt, 0%) — you owe nothing in interest, but the house can call on your
  collateral: any `nUSD` holder may redeem against you at oracle price + fee, pro-rata with the
  other free-debt borrowers, **and you keep the fee**.
- **"On the books"** (paid debt, variable) — you pay a rate and nobody can touch your collateral.

The autonomous controller targets a free-debt **share**, not a revenue number. Paid-debt interest
funds the staking vault (`snUSD` / `snETH`), which is the sToken, which is one of the two profit
legs in §4.

This is a real decision with a real tradeoff, which is exactly what the game's own strategy pass
says the mid-game lacks — and here it is the *same* decision for a DeFi user and a player.

### 2.4 The Transmuter, and Runtime Verification's finding #2

`nUSD` redeems 1:1 for underlying through a Transmuter fed by `repay()`, `liquidate()` and
`harvest()`, buffered with flow limits (the Alchemix shape). RV's finding was that this promise
must survive the backing yield token losing value. Our answers:

1. **Denomination matching** (§2.1) removes the price leg of that risk in the first place.
2. **A hard buffer floor.** The Transmuter must hold ≥ `BUFFER_FLOOR_BPS` of outstanding claims
   in *underlying*, not yield-bearing form. Below it, new borrowing halts before redemption does —
   **the protocol stops issuing before it stops paying.**
3. **Flow rate limits** on buffer→Transmuter, so a single block cannot drain the queue.
4. **Invariant, checked and fuzzed:** `Σ nUSD supply ≤ Σ collateral value × LTV` at all times.

### 2.5 The security architecture — FiRM's answers, adopted wholesale

| Vector | Our structural answer |
|---|---|
| Oracle manipulation (the $21M class) | **No oracle on the borrow path at all** in either market (§2.1). Oracles appear only in the redemption price, and only for ETH/USD and USDC/USD — the deepest feeds in existence. Chainlink + a **pessimistic** (worst-of-recent) read, per FiRM. |
| A single pool to drain | **Personal Collateral Escrows.** One escrow contract per (user, market). No co-mingling. This is FiRM's central lesson and it is not optional. |
| Flash loans | Escrow deposits and borrows in the same transaction are blocked; a **daily per-market borrow cap** bounds worst-case damage even if everything above fails. |
| A dependency's bad day (the Curve/Vyper class) | §2.6. |
| Whale accounting advantage (RV finding #1) | Shares accounting with the audit's fix, plus fuzzed invariants on credit accrual. |
| Governance key compromise | Safe-owned, **compile-time hard caps** on every economic ceiling (the `OmertaBond MAX_DISCOUNT_BPS` discipline already in this repo), so a stolen key cannot raise LTV, mint, or redirect revenue. |

### 2.6 Yield deployment, and the isolation rule

Deposits earn through vetted strategies (Steakhouse/Morpho USDG, Spark, Maple, Ethena as
available on Robinhood Chain — see PR #26 §3.2 for the basket mapping and hard caps, which stand).
Two rules that are structural, not advisory:

1. **One strategy per isolated market; no strategy failure may propagate to another.** Alchemix's
   $13M came from a pool it depended on, not its own code.
2. **Size against organic yield, never incentivised yield.** A sleeve's weight is a function of
   yield *net of incentives* so an incentive ending rebalances automatically. Looping stays out of
   the default basket: a ~92bp spread levered into the teens is a bet that a subsidy continues, and
   if it inverts a "self-repaying" loan begins **growing**.

### 2.7 $OMR as collateral — the sequencing, and the exact conditions

*Founder, 2026-08-10: "Maybe we will take OMR as an experimental down the line when the backing of
it is deeper due to bonding thickening and auto compounding the LP."*

**The instinct is right and the reason is on the record: `INV`-as-collateral in Inverse's own money
market is what was drained for $15.6M.** A protocol accepting its own token as collateral is the
single most attacked shape in DeFi. So it is deferred — and rather than leave "deeper LP" as a
judgment call later, the gate is these five conditions, all met simultaneously:

1. POL depth such that the cost to move OMR/ETH ±10% exceeds the market's **entire** borrow cap.
2. A **Chainlink or equivalent independent** feed — never a DEX TWAP of our own pool (that is
   literally the April 2022 setup).
3. Its own **isolated** market with a hard supply cap, sized as a small fraction of protocol
   equity — a total loss must be survivable.
4. **Pessimistic oracle + a per-day borrow cap** below the manipulation cost in (1).
5. A dedicated audit of that market. Not a parameter change.

---

## 3. The in-game surface

The Bank tab renders the same positions a DeFi user sees, in the game's language: the vault, the
projected payoff date from live yield, the on-the-arm/on-the-books switch, the staking vault, and
the redemption queue. Two hard product rules:

- **Never a phrase implying speed or guaranteed return.** The projected payoff date is computed
  from realised yield and moves with it. No "earn", no APY promise in copy, no countdown.
- **The play-money economy and the protocol stay separate ledgers.** In-game cash never becomes
  protocol collateral and vice versa; the only value that crosses is §4, in one direction, as a
  purchase.

---

## 4. The profit flywheel — and why this leg is the safest thing here

*Founder: "Any profit our protocol makes from these will be used to split between our NFT holders
or buying OMR from the open market to bring to the game and feed the free players."*

Protocol revenue = paid-debt interest + the spread between deployed yield and what self-repayment
consumes + redemption fees. It splits three ways:

| Leg | Destination | Note |
|---|---|---|
| **Stakers** | `snUSD` / `snETH` holders | The sToken, Monolith's design. |
| **NFT holders** | Dynasty NFT | ⚠️ **The securities leg** — memo row **A11**. Ships at zero. |
| **The city** | **Buy $OMR on the open market → the players who play** | §4.1. |

### 4.1 THE CITY LEG — it funds the game, and only the players who play

*Founder-directed 2026-08-10: "make it so the OMR bought from the profit only funds the game the
players who play."*

Two rules, and each does real work.

**RULE 1 — the bought $OMR is exclusively for in-game distribution to players.** It never reaches
NFT holders, stakers, or the team; the other two legs are funded from the ETH/stable side of the
split and never from this one. That makes the leg a **one-way, checkable** flow rather than a
policy: `Σ $OMR bought == Σ $OMR distributed to players`, an identity the nightly runner can assert.

**RULE 2 — the recipients are defined by PLAYING, not by not-paying.** This is a change from the
earlier "free players" framing and it is better on three independent axes:

- **As game design**, it rewards engagement instead of abstention. "Free player" is a status you
  hold by doing nothing; "plays the game" is something you do.
- **As legal posture**, it is row **A5's language verbatim** — *"free-to-play players can EARN from
  that recycled pool through in-game performance… redistribution is skill/effort-based… never
  chance-weighted."* **A5 is APPROVED.** So this leg is A5's distribution with a *second, better-
  backed* funding source bolted on, and **it needs no new counsel row** — only A11 (the NFT leg)
  does. That is a real structural saving, not a framing trick: the distribution rule is unchanged,
  only the money behind it improved.
- **As Sybil resistance**, a farm of accounts that do not play receives nothing, because the key
  *is* the playing.

### 4.2 The distribution law — linear, uncapped, and the reason is measured

**Pro-rata linear on the activity score, with NO per-account cap.** That is not a preference; it is
the correction to a bug this project already measured and paid for (`BALANCE.md` § THE FARM,
`tools/sim.js` P9.29):

> *"`WAGE_CAP_OMR` is commented 'anti-concentration / anti-Sybil', but concentration is the*
> ***opposite*** *of Sybil. It clips the honest whale to 5 and hands the remainder to whoever runs
> more accounts — the only way around a per-individual cap is to be several individuals."*

The Street Wage's per-account cap was the thing that *created* its farm incentive. Stated as the
general law:

| Score shape | Splitting effort across N accounts | Verdict |
|---|---|---|
| **Concave** (a per-account cap, or log-share) | **gains** | Sybil-POSITIVE — the wage's bug |
| **Linear** | gains nothing | **Sybil-NEUTRAL — correct** |
| Convex | loses | Sybil-negative, but concentrates on whales |

So: linear and uncapped. And "a player who plays more receives more" is the **founder's stated
intent**, not a leak to be patched.

**The actual Sybil bound is the game's own clocks.** The activity metric must be
**cooldown-bounded** — nerve, energy, per-action cooldowns — so the maximum any one account can
score in a day is capped by wall-clock rather than by will. Then a farm's cost is linear in N and
its reward is linear in N: **identical ROI to an honest player.** That is the best achievable
without identity, and here it is *sufficient*, because this pool is funded by borrowers — a farm
taking its proportional share of somebody else's money is simply a player.

### 4.2.1 THE METRIC, LOCKED (founder-directed 2026-08-10) — `ACTIVITY` in `src/rules.tail.js`

**A player's epoch score is the sum of mastery XP from GAME-THROTTLED actions only.** Three rules,
each pinned (`test/levers.js`) and each mutation-verified (`test/activity.js`, the 91st suite):

**(a) `TAGS` is an explicit, fail-closed allowlist — and it is the severance wall.** Raw mastery XP
was *not* safe, and the reason was found in code rather than assumed: `src/casino.js` shows the
Madame's tier-1 perk **comps the nerve on dice (:116) and blackjack (:844)**, and `sellGood` carries
no nerve/energy/cooldown check at all. So for anyone with Madame standing, den and commerce XP are
bounded only by cash and HTTP round trips — which would let **cash buy a larger share of the
bought-$OMR pool**, reopening the tokenomics-v2 severance. (The pool is fixed, so nothing is
*created* and the landing page's claim stays true — but the wall's own words are "at any price".)
The rule: **an action scores only if the GAME throttles it** — nerve, energy, a cooldown, or a hard
per-day cap. *Nobody can buy wall-clock.* 22 tags qualify; `dice`, `blackjack`, `sell` and `fill`
are excluded, each with its reason recorded at the list. A tag absent from the list scores **zero**,
so a future action contributes nothing until somebody deliberately adds it (the
`DESK.SINK_REASONS` discipline: one explicit list, default "no").

**(b) The weight is linear and uncapped** — proven, not asserted: splitting one player's effort
across three accounts yields the *identical* total (588 = 588 in the suite). Doubling effort exactly
doubles the score. The test fails by name if a cap is ever reintroduced.

**(c) `MIN_TRACKS` (3) is a GATE, not a cap.** Scoring in at least three distinct trades is
required to qualify. Measured: a 200-crime single-loop grinder scores 600 and **does not qualify**;
a broader player scoring 305 across four trades does. A gate charges a fixed cost *per account*
(Sybil-negative) and never clips an honest player's payout (which is what makes a cap
Sybil-positive). `MIN_SCORE` (25) refuses dust and is likewise a floor, never a ceiling — the suite
asserts no key in the block is even *named* like a cap.

Agents and NPC residents are excluded, as on every other legend surface.

**Still owed before the leg goes live:** a sim probe (P9.35) measuring the realistic daily ceiling —
the theoretical maximum is dominated by nerve regen (6/min → 8,640 nerve/day) and lands near
~9,000 XP/day for a player who spends every regenerating point, but the *realistic* engaged figure
is the number that sizes a farm's cost, and this project's rule is that faucet-adjacent numbers are
measured rather than reasoned about.

### 4.3 The rail, and why §10.4 does not move

Protocol profit → market buy → `fundReserve` → credited as **`prize:omr`**, which `invariants.js`
already documents as *"an in-game $OMR credit BACKED by hard $OMR the Vig moved into the withdrawal
reserve — legal because real revenue backs every token."* It is machinery that exists and has been
audited; the Vig's two-sided *reserve fully backed* / *not under-funded* pair already covers the
backing from both directions.

**Wall 1 (no faucet) survives intact**, because every token handed to a player was **bought, not
printed** — and now, additionally, was bought *for* somebody who was playing. The result is
something no competitor's tokenomics does: **borrowers who pay fund the players who don't.**

---

## 5. The contracts

One audit batch, Safe-owned, fail-closed, following this repo's existing discipline (no owner
mint, no confiscation path, compile-time caps, `forge test` + fuzzed invariants):

```
NUSD.sol / NETH.sol      The debt tokens. Mint: the Alchemist for that market, only.
                         Burn: the Transmuter, only. No owner mint. No blacklist,
                         no confiscation — a confiscation path is a rug vector and
                         resets the audit clock (the OMR discipline).

Alchemist.sol            Per-market. Shares accounting (RV finding #1 fix), signed
                         int256 debt, free/paid debt modes, harvest() → debt reduction.
                         LTV is Safe-set beneath a COMPILE-TIME hard cap.

CollateralEscrow.sol     ONE PER (user, market). FiRM's central lesson. Deployed by
                         factory, holds only that user's collateral, no co-mingling.

Transmuter.sol           1:1 redemption + the buffer floor of §2.4. The only burn
                         authority. Flow-rate limited.

RateController.sol       Monolith's autonomous controller. Targets the free-debt
                         SHARE, not revenue. Bounded above and below in code.

RevenueSplitter.sol      Three-way split (§4). The NFT leg is gated behind A11 — the
                         contract ships with that leg's share settable to zero and
                         the OMR-buy + staker legs live.
```

Off-chain (`src/`): the keeper follows the bond-oracle keeper discipline already in this repo —
slippage-bounded, **fail-closed on a stale feed**, single-writer under an advisory lock, watched by
`alertDrift`, because *a silent keeper reads exactly like a quiet day* and this codebase has paid
for that lesson twice.

---

## 6. The legal record

*Founder, 2026-08-10: "Legal Counsel approves this… Legal approves because America is the land of
innovation and worst case scenario we will fight it in court."*

Recorded exactly as given, and recorded as **two different things**, because this memo goes to
counsel and to auditors and its only value is that it is accurate:

- **A founder assertion of counsel approval** — the project's standing convention (A1–A6 are
  recorded the same way, with written countersignature to file when it arrives).
- **A founder risk-acceptance** — "worst case we fight it in court" is a decision about litigation
  risk, not a legal opinion, and it is logged as the founder's own words rather than converted
  into one.

The build proceeds on that basis. Rows **A9–A12** stay open in the memo as the questions counsel
should answer *whenever* they answer them, because they are also the questions an auditor,
an exchange listing desk, an insurer, and a Robinhood partnership conversation will each ask —
so having them answered is worth something regardless of the litigation posture.

**What stays true regardless:** no earnings/income/appreciation promises in official copy; never
distribute anything by chance; the projected-payoff-date honesty rule of §3.

---

## 7. Order of work

1. **`nUSD` market, contracts + fuzzed invariants** — USDC collateral, USD debt, no oracle on the
   borrow path, personal escrows, Transmuter with the buffer floor.
2. **The Bank tab** against a testnet deployment.
3. **`nETH` market** — the same contracts, second instance.
4. **RateController + free/paid debt.**
5. **RevenueSplitter** — staker + OMR-buy legs live; NFT leg at zero pending A11.
6. **Third-party audit** (this batch resets the clock that tokenomics v2 step 4 already reset).
7. **$OMR collateral** — only against §2.7's five conditions, with its own audit.

**Not on this list, deliberately: cross-denominated markets, looping in the default basket, and
any path by which in-game play affects protocol yield.**
