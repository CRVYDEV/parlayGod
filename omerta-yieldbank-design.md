# THE YIELDBANK — self-repaying loans, player-owned banks, and a debt-backed marker

*Founder-directed 2026-08-10. Synthesis of Alchemix (self-repaying loans), Inverse/DOLA
(debt-backed positive-sum stablecoin) and Monolith, wrapped around the noir RPG. Target chain for
the on-chain layer: Robinhood Chain (EVM, chain ID 4663, Arbitrum Orbit, ETH gas).*

**Status: DESIGN. Layer 1 (in-game) is buildable now and is what ships. Layer 2 (on-chain) is
designed here in full and is BLOCKED on counsel rows A9–A12 (new, below) plus the standing
third-party audit gate. Layer 3 (a bridge between them) must not be built — see §5.**

---

## 0. The decision this document makes, up front

The brief contains **two different products**, and the first sentence names the one that is a game
feature:

> *"I want ingame users to eventually using cash and grinding the system at higher levels be able
> to open their own types of banks/vaults/loans."*

That is a **mechanic**: cash-denominated, in-game, no real money, no counterparty outside the
server. It is buildable now, it needs no licence, and — the finding of §1 — it is the version where
the mechanic actually *works*.

The rest of the brief (real USDG routed into Morpho Blue / Steakhouse / Maple / Ethena / Spark, a
USD-pegged synthetic, protocol revenue distributed to stablecoin holders and governance stakers) is
**a licensed financial business** that happens to have a game attached. It is four separately
regulated activities stacked (§6), and at least two of them have produced eight-figure enforcement
against firms doing exactly this since 2022.

So: **build Layer 1 in full, design Layer 2 completely and hand it to counsel, and never build the
bridge.** The rest of this document does those three things in that order.

---

## 1. THE MEASUREMENT THAT DECIDES THE DESIGN

Alchemix's core identity is that debt is repaid by yield on the **full** collateral, not on the
borrowed amount. So time-to-repay is:

```
T  =  LTV ÷ yield
```

Run that against the brief's own numbers (**stated inputs — see the honesty note in §7.1; I cannot
verify live APY/TVL from here**) and against this game's measured front economics
(`tools/sim.js` P9.20b, post-L1a, measured 2026-08-10):

| Yield source | 50% LTV | 80% LTV |
|---|---|---|
| Steakhouse organic, low end (2.4%) | 20.8 years | **33.3 years** |
| Steakhouse organic, high end (3.04%) | 16.4 years | **26.3 years** |
| Steakhouse advertised w/ Merkl (7%) | 7.1 years | 11.4 years |
| **An OMERTÀ business front** (measured) | **6.1 days** | **9.7 days** |

The measured front table behind that last row:

| Front | Level | Tier-1 cost | Payback | Effective APY |
|---|---|---|---|---|
| Laundromat | 15 | $250,000 | 0.9 d | 42,048% |
| Restaurant | 22 | $500,000 | 0.9 d | 38,544% |
| Nightclub | 30 | $1,200,000 | 1.0 d | 35,040% |
| Hotel | 42 | $3,000,000 | 2.3 d | 16,060% |
| Casino | 58 | $8,000,000 | 2.4 d | 15,330% |

**Three conclusions, and they set the whole design:**

**(a) The requested 80–90% LTV is incompatible with real yields.** At 80% LTV against organic
Steakhouse yield the loan repays in a quarter of a century. Alchemix runs ~50% precisely because
`T = LTV ÷ yield` is unforgiving. Marketing a 26-year amortisation as "self-repaying" to a retail
game audience is not a rounding error — it is a false product description, and it is the kind of
statement the standing no-promise rule exists to prevent.

**(b) The same mechanic is *excellent* in-game, and needs a brake rather than a boost.** In-game
yields are three orders of magnitude larger, so an unmodified self-repaying loan clears in **hours**
— which fails the opposite way (the strategy pass's "have I clicked it yet" problem: a loan that
repays before you log back in is a formality, not a decision). The in-game design therefore
introduces `REPAY_BPS` — the fraction of collateral income diverted to debt — as the timescale dial:

```
T_days  =  365 × LTV ÷ (effAPY × REPAY_BPS)
```

At a laundromat's 42,048% APY, 50% LTV, a **7-day** target repayment wants `REPAY_BPS ≈ 620`
(6.2%). That is a founder sign-off lever and it is the single number that makes the mechanic feel
like a loan instead of a gift.

**(c) The looped 15–20% ROE is a levered subsidy, not a yield.** The brief's own figures give the
USDe/USDG spread as roughly `4.4% collateral − 3.48% borrow = 92 basis points`. Reaching 15–20% ROE
on a 92bp spread requires leverage in the high single digits to low teens against a 91.5% LLTV.
That is not a yield source; it is **a leveraged bet that an incentive programme continues** — and
the brief itself says "while incentives last." Two consequences:

- **The gap is the subsidy.** Organic 2.4–3.04% against an advertised ~7% means roughly 55–65% of
  the headline is Merkl incentive. Size any promise against organic, never against advertised.
- **The spread can invert.** If Ethena's incentive falls from ~4.4% to ~2%, the spread goes to
  −1.48%; at 10× leverage that is −14.8% ROE, and a "self-repaying" loan begins **growing**. A
  mechanic whose name is a promise must not have a state in which the promise reverses. Looping is
  therefore explicitly **excluded from the MYT's primary basket** (§4.2) and available only as an
  isolated, capped, opt-in sleeve with the inversion stated in the UI.

---

## 2. LAYER 1 — THE YIELDBANK, in-game (this is what ships)

Four primitives. Every one of them moves **cash only** — the currency tokenomics v2 deliberately
severed from $OMR — so nothing here touches the token economy, and §10.4 stays exact because
**nothing is ever minted; cash only moves.**

### 2.1 THE VAULT — the self-repaying loan

Pledge a **productive** asset and borrow against its future income.

- **Collateral:** a business front, a territory racket, a speakeasy, or a stable of cash. Assessed
  at the same book value the game already computes for takeovers (`assessedValueOf`) so the bank and
  the seizure market can never disagree about what a thing is worth.
- **Borrow** up to `VAULT.LTV_BPS` of assessment (proposed **5000** for productive assets, **8000**
  for a pure cash stake — the brief's "high LTV for stable collateral", honestly applied only where
  the collateral genuinely is stable).
- **Zero nominal interest.** The debt carries no rate. Instead `VAULT.REPAY_BPS` of the collateral's
  income is diverted to the debt at every accrual touch, until the debt is zero and the asset comes
  back clean. This is the Alchemix identity, on a game clock.
- **No price liquidation.** The debt only ever falls. There is no oracle to be wrong, no margin
  call, no cascade — which is the whole point of the Alchemix shape and the reason it is the right
  primitive to import.
- **But it is not risk-free, and this is where the game lives.** Three ways the bank takes the
  asset:
  1. **COLD.** The pledged front's pad goes unpaid past `BUSINESS_UPKEEP_COLD_MS` — income stops, so
     the debt stops falling. Past `VAULT.COLD_SEIZE_MS` the bank forecloses.
  2. **SACKED.** A pledged front stays PvP-losable. A killer who sacks it takes the asset; the debt
     stays with **you**, unsecured, and is called immediately. *Borrowing against your empire makes
     your empire worth killing you for* — the L3a Sacking lever, given teeth on the money side.
  3. **SHUTTERED.** Close a pledged front and the debt is called on the spot.
- **The cost of the loan** is an origination fee (`VAULT.ORIGINATION_BPS`, a cash **sink**) plus the
  seizure risk above. Without a fee a 0%-interest loan is free money and the mechanic becomes
  mandatory rather than a decision — the failure mode the strategy pass named for the asset ladder.

### 2.2 THE MARKER — the deposit receipt, and the run

The brief asks for a debt-backed USD-pegged synthetic. The in-game analogue is **the Marker**, and
the design choice that keeps it §10.4-clean is that a Marker is a **liability, not a currency**:

- Deposit cash at a bank → receive **Markers 1:1**. Markers are a claim on that bank, not spendable
  as cash.
- The bank **lends its cash reserve** to Vault borrowers. Nothing is minted — the cash that reaches
  a borrower is cash a depositor put in.
- Depositors are paid from **borrower origination fees and diverted income** — a redistribution
  between players, never emission. **Wall 1 (no faucet) holds by construction.**
- Redeem Markers for cash from the un-lent reserve.

**And that is fractional reserve, deliberately.** The reserve ratio is public. When redemptions
exceed the un-lent reserve, **the bank fails** — publicly, on the streets feed:

- Depositors are made whole from the **owner's own posted capital first**, then take a pro-rata
  haircut on what remains.
- A failed bank's outstanding Vaults are called and its collateral auctioned.
- **A run is a mechanic.** You can start one — a rumour on the Wire, a coordinated withdrawal by a
  crew, or simply sacking the owner's biggest borrower. This is the most genuinely new PvP surface
  in the design, and it is the reason to build the fractional version rather than a safe full-reserve
  one.

The peg: Markers are transferable on the Black Market, so a stressed bank's Markers trade **below
par** and an arbitrageur buys them cheap and redeems at par when the reserve refills. That price *is*
the public solvency signal, discovered by players rather than published by the server.

### 2.3 THE PRIVATE BANK — "open their own banks"

The headline ask. At `BANK.CHARTER_MIN_LVL` a player buys a charter (`BANK.CHARTER_COST`, a large
cash sink) and posts capital. They then set, and are judged on, four numbers:

| The owner sets | The tension |
|---|---|
| Deposit rate | Higher draws deposits; every point is paid out of spread |
| Lending LTV | Higher draws borrowers; every point is default exposure |
| Reserve ratio | Higher is run-proof; every point is idle capital earning nothing |
| Which collateral they accept | Fronts, rackets, speakeasies, cash — the risk book |

The owner earns the **spread** and bears **default risk**: when a seizure does not cover a debt, the
bank eats it. A well-run bank is a genuine late-game income engine; a greedy one dies in a run. Both
outcomes are public.

### 2.4 THE BOOK — the MYT analogue

The bank's asset allocation, curated by the owner: loans out, cash reserve, its own fronts, its own
territory, a placement in the NPC Loan House. Risk-weighted, rebalanced by the owner, shown to
depositors *before* they deposit. This is the in-game answer to the Mix-Yield Token: a diversified
basket of **real in-game income sources**, with the same job (spread risk, publish the allocation)
and none of the counterparty exposure.

### 2.5 §10.4 — why this is clean

| Flow | Reason | Class |
|---|---|---|
| Deposit | `bank:deposit` | TRANSFER (player → bank reserve) |
| Redeem | `bank:redeem` | TRANSFER (reserve → player) |
| Borrow | `vault:draw` | TRANSFER (reserve → borrower) |
| Income diverted to debt | `vault:repay` | TRANSFER (borrower's income → reserve) |
| Origination fee | `vault:fee` | **SINK** |
| Charter | `bank:charter` | **SINK** |
| Depositor yield | `bank:yield` | TRANSFER (reserve → depositor) |
| Haircut on failure | `bank:haircut` | TRANSFER (bounded by the reserve) |

**Zero mints. Two sinks. Every other row is a transfer between existing buckets.** The new bucket
(`bank_reserves`, per bank) joins the cash conservation set, and one new escrow-shaped identity
joins `invariants.js`:

```
per bank:   reserve  ==  deposits − redemptions − drawn + repaid + fees − yield paid − haircuts
globally:   Σ markers outstanding  ==  Σ deposits − Σ redemptions      (the debt-backed identity)
and:        Σ vault debt  ≤  Σ assessed collateral × LTV               (the anti-Ponzi wall)
```

That third line is the same wall as the treasury's `allocated ≤ held` and the desk's "never sells
inventory it does not hold" — stated in the shape this codebase already checks nightly.

### 2.6 The levers (all founder sign-off, all pinned)

`VAULT.LTV_BPS` · `VAULT.LTV_CASH_BPS` · `VAULT.REPAY_BPS` · `VAULT.ORIGINATION_BPS` ·
`VAULT.COLD_SEIZE_MS` · `VAULT.MIN_DEBT` · `BANK.CHARTER_COST` · `BANK.CHARTER_MIN_LVL` ·
`BANK.MIN_RESERVE_BPS` · `BANK.MAX_DEPOSIT_RATE_BPS` · `BANK.HAIRCUT_ORDER` · `MARKER.TRANSFERABLE`.

`REPAY_BPS` is the timescale dial of §1(b) and the most important number in the system.

---

## 3. LAYER 2 — the on-chain protocol (designed, NOT built)

Everything below is a specification for counsel and for a future audited batch. **No contract in
this section should be deployed before A9–A12 are signed and the third-party audit clock (already
reset twice by tokenomics v2 step 4 and the bond's fourth slice) has run.**

### 3.1 Chain facts assumed

Robinhood Chain: EVM, chain ID **4663**, Arbitrum Orbit, ETH gas. Solidity/Foundry as the existing
`omerta-contracts/` suite (solc 0.8.26, OZ 5.x, 128 Foundry tests). Self-custody via Privy is
already wired (`src/auth.js`). **Verify the Uniswap version on Robinhood Chain before writing the
keeper's swap call** — v3 vs v4 changes that call and nothing else in this design.

### 3.2 The MYT basket, mapped to the named strategies

Allocation logic with hard risk limits, curated by governance, rebalanced on a schedule:

| Sleeve | Instrument (as named in the brief) | Stated yield | Target | Hard cap | Risk class |
|---|---|---|---|---|---|
| **Core** | Steakhouse Financial Morpho USDG Vault (Morpho Vault V2) | 2.4–3.04% organic; ~7% w/ Merkl | 50% | 70% | Curated multi-market, instant withdrawal, 0% vault fee |
| **Credit** | syrupUSDG / USDG (Maple) | ~4.6% collateral, ~3.48% borrow | 20% | 25% | Institutional **undercollateralised** lending — default risk is real |
| **Synthetic-$** | USDe / USDG (Ethena) | ~4.28–4.5% incentive | 15% | 20% | Delta-hedged basis trade; funding-rate + depeg risk |
| **Savings** | spUSDG / USDG (Spark) | ~3.2% | 10% | 15% | Conservative |
| **Buffer** | Idle USDG | 0% | 5% | — | Redemption liquidity |
| **Looping sleeve** | Levered USDe/syrupUSDG/spUSDG | 15–20% *while incentives last* | **0%** | **10%, opt-in only** | **See §1(c): a levered 92bp spread. Excluded from the default basket.** |

Allocation rules that are structural rather than advisory:

1. **Isolation is a feature — use it.** Morpho Blue markets are isolated by design; the basket must
   never hold a position whose loss can propagate to another sleeve. One sleeve, one market.
2. **Cap by *organic* yield, never advertised.** A sleeve's weight is a function of its yield net of
   incentives, so an incentive ending rebalances the basket automatically instead of silently
   halving the product.
3. **The buffer is sized to the redemption queue**, not to a fixed percentage — the Transmuter's
   outstanding claims set the floor.
4. **LLTV headroom.** Never operate above `LLTV − SAFETY_BPS` (proposed 91.5% − 1000bp = 81.5%
   effective ceiling) on any collateralised sleeve; utilisation targets around 89–90% are the
   market's, not ours.
5. **A sleeve is removable in one governance action** with a forced unwind path that does not
   require the counterparty's cooperation beyond ordinary withdrawal.

### 3.3 Contract surface

Five contracts, one audit batch, all Safe-owned, all fail-closed:

```
MixYieldVault.sol      ERC-4626. Deposits USDG, allocates across sleeves per the weights above.
                       Per-sleeve caps enforced in code, not config. Emergency unwind to buffer.
                       NEVER holds a position it cannot exit without a counterparty's permission.

Alchemy.sol            The self-repaying position. deposit(collateral) → mint debt token up to
                       LTV. harvest() credits yield against debt. No liquidation for productive
                       collateral; a `repayFrom` accounting split identical to Layer 1's REPAY_BPS.
                       LTV is a Safe-set ceiling with a COMPILE-TIME hard cap (the OmertaBond
                       MAX_DISCOUNT_BPS discipline) so a compromised key cannot raise it.

Transmuter.sol         Fixed-term redemption. Debt-token holders queue; filled FIFO from the
                       repayment stream at 1:1. This is the peg, and it is the only mint/burn
                       authority for the debt token.

DebtToken.sol          The synthetic. Mint authority: Alchemy only. Burn: Transmuter only.
                       No owner mint. No blacklist, no confiscation — the OMR discipline
                       (a confiscation path is a rug vector and resets the audit).

RevenueDistributor.sol ***THE SECURITIES LEG. See §6.3. Specified, deliberately not written.***
```

The keeper (off-chain, `src/` side) follows the bond-oracle keeper discipline already in the tree:
slippage-bounded against the sleeve's own oracle, **fail-closed on a stale feed**, single-writer
under an advisory lock, and watched by `alertDrift` — because *a silent keeper reads exactly like a
quiet day*, which is a lesson this codebase has already paid for twice.

### 3.4 The invariants that make it not-Terra

Stated as checks, in the shape `invariants.js` already runs nightly:

```
(1) Σ debtToken supply  ≤  Σ collateral value × LTV        the over-collateralisation wall
(2) Transmuter claims outstanding  ≤  buffer + scheduled repayments
(3) Σ distributed revenue  ≤  Σ realised yield             never distribute unrealised gains
(4) every sleeve's position  ≤  its hard cap
(5) no sleeve holds > SAFETY_BPS below its market's LLTV
(6) comps/QA book ZERO                                     the standing anti-fabrication gate
```

Check (3) is the one that separates DOLA from UST: **distribute only what actually arrived.**

---

## 4. Economic simulation

Run against the brief's stated inputs (§7.1), sized for a $10M MYT.

**Default basket (no looping), organic yields:**
`0.50×3.04 + 0.20×4.6 + 0.15×4.4 + 0.10×3.2 + 0.05×0 = 3.30%` gross.
Net of a 10% protocol take: **~2.97% to depositors**, ~$297k/yr protocol revenue on $10M.

**With Merkl incentives at the advertised level**, the core sleeve at 7% lifts the blend to
`0.50×7 + 0.20×4.6 + 0.15×4.4 + 0.10×3.2 + 0.05×0 = 5.52%`. **The 2.2-point difference between
those two numbers is subsidy**, and it is 40% of the headline. Every downstream promise must be
sized against 3.30%.

**Self-repaying, at the honest yield.** 50% LTV against 3.30%: `T = 15.2 years`. At the requested
80%: `24.2 years`. This is the §1(a) conclusion restated with the basket's own blend — **the
on-chain self-repaying product is a multi-decade amortisation and cannot be described as anything
faster.**

**The looping sleeve, stressed.** Spread 92bp at 5× → 4.6% ROE; at 10× → 9.2%. To reach the quoted
15–20% requires either leverage above 15× (inside 1000bp of a 91.5% LLTV — one bad print from
liquidation) or incentives materially above those quoted. **Stress: incentive falls to 2%.** Spread
→ −1.48%; ROE at 10× → **−14.8%**, and every self-repaying position in that sleeve begins growing
its debt. This is why the sleeve is capped at 10%, opt-in, and excluded from anything named
"self-repaying."

**Layer 1, for contrast.** The same simulation in-game: a laundromat at 42,048% effective APY, 50%
LTV, `REPAY_BPS = 620` → **7-day** repayment, funded entirely by a redistribution between players,
with zero counterparty and zero regulatory surface. It is the same mechanic and a better product.

---

## 5. THE BRIDGE — why it must not exist

The dangerous version is not Layer 1 or Layer 2. It is **any coupling between them**:

- In-game performance affecting real yield → the game becomes the front-end of an investment
  product and every balance lever becomes a financial-product decision.
- Real yield funding in-game payouts → **wall 1 breached** (a faucet), **wall 4 breached** (minting
  to fund a payout), and the game's own published claim — *"nothing in the game creates $OMR"* —
  becomes false.
- In-game collateral backing real debt → a player's Sacking becomes a real-money credit event.

**Rule, to be enforced by test, not by memory:** no `transactions` row may ever be written as a
consequence of an on-chain yield event, and no on-chain value may move as a consequence of an
in-game action, except through the two rails counsel has already reviewed (the withdrawal queue,
the treasury vault claim). A guard in `test/` asserting exactly that belongs in the Layer-2 batch.

---

## 6. Legal — four regulated activities, and the counsel rows

### 6.1 What is actually being proposed

| Activity | Regime | Precedent |
|---|---|---|
| Issuing a USD-pegged stablecoin | US: GENIUS Act permitted-issuer status. EU: MiCA e-money token — EMI/credit-institution authorisation | Non-permitted issuance is prohibited outright, not penalised |
| Taking deposits and paying yield | Securities (Howey) | **BlockFi $100M (2022)**, **Celsius**, **Genesis/Gemini Earn $21M + shutdown** — all for retail yield accounts |
| Distributing protocol revenue to stakers | Securities (Howey — profits from the efforts of others) | The clearest leg of the four |
| Custody + routing user funds | US: FinCEN MSB + ~49 state MTLs. EU: MiCA CASP | — |

The game's user base is **retail, global, and not age-verified**. That makes every row above worse,
not better.

### 6.2 Counterparty risk, stated plainly

Routing player money into Morpho Blue isolated markets, Ethena USDe (a delta-hedged synthetic with
funding-rate exposure), Maple syrupUSDG (institutional *undercollateralised* credit) and Spark means
**a bad day at any one of them is a player losing real money in what they believed was a game.**
Steakhouse's 0% fee and Lloyd's-insured components cover neither smart-contract loss nor a
collateral depeg inside an isolated market.

### 6.3 New counsel rows (to be added to `omerta-counsel-memo.md`)

- **A9 — Issuance of a USD-pegged synthetic on Robinhood Chain.** Does the Transmuter's 1:1
  redeemable, over-collateralised, debt-backed design fall inside the GENIUS Act's payment-stablecoin
  definition, and if so which permitted-issuer route applies? MiCA EMT/ART classification?
- **A10 — Yield-bearing deposits from game users.** Does the MYT deposit rail constitute an
  investment contract (BlockFi/Celsius/Gemini Earn fact pattern)? Does the game-native framing change
  the analysis at all, or does the retail/global/unverified user base make it worse?
- **A11 — Revenue distribution to stablecoin holders and governance stakers.** Assumed to be the
  clearest securities leg of the four; `RevenueDistributor.sol` is specified but deliberately unwritten
  pending this row.
- **A12 — Custody and transmission.** Is routing user USDG into third-party protocols money
  transmission / CASP activity, and what licensing follows in the target jurisdiction list (still
  owed from A3)?

**Standing rules that continue to bind, unchanged:** no earnings/income/appreciation promises in any
official copy; never distribute securities by chance; approvals recorded as founder assertions with
countersignature to file.

---

## 7. Honesty notes, security, and order of work

### 7.1 What I could not verify

Every APY, TVL, utilisation and LLTV figure in §3–§4 is **as supplied in the brief and used as a
stated input.** I have no live market access from this environment and my training cutoff predates
the quoted state of these markets. Nothing here should be presented to anyone — counsel, an auditor,
or a player — as verified live data. **Before any capital moves, re-derive every figure from the
protocols' own on-chain state**, and re-run §4 against it.

### 7.2 Security considerations specific to the named protocols

- **Morpho Blue:** isolation is the safety property — one sleeve per market, and never a position
  whose liquidation can cascade into another sleeve. Oracle configuration is per-market and is the
  thing to diligence.
- **Steakhouse curation:** the curator can reallocate underneath us. Our cap must bind on *our*
  side; treat curator discretion as a risk parameter, not a guarantee.
- **Ethena USDe:** basis-trade dependent. A sustained negative funding regime is the tail, and the
  incentive that makes the sleeve attractive is separable from the yield that makes it safe.
- **Maple syrupUSDG:** undercollateralised institutional credit. Default is not theoretical —
  Maple's predecessor pools defaulted in 2022. This sleeve's cap is a credit decision.
- **Keeper:** slippage-bounded, fail-closed, single-writer, watchdogged. A silent keeper must alarm.
- **Contracts:** no owner-mint, no confiscation path, compile-time caps on every economic ceiling,
  Safe-owned, pausable where a pause cannot brick a market.

### 7.3 Order of work

1. **Layer 1 build** — the Vault, the Marker, the Private Bank, the Book, the invariants, the suite,
   the console. Ships behind `YIELDBANK.OPEN` (default off) until the numbers are sim-signed.
2. **Sim probe P9.35** — the `REPAY_BPS` timescale table and the bank-failure stress, printed every
   run so a retune re-measures.
3. **Red-team** — the run mechanic and the seizure path are a new escrow surface; that is the class
   this project keeps finding bugs in.
4. **Counsel A9–A12** — in parallel with 1–3, because they gate nothing in Layer 1.
5. **Layer 2** — only after A9–A12 return, with a fresh third-party audit, and with §4 re-derived
   from live on-chain state.

**Nothing in step 5 begins before step 4 returns.**
