# OMERTÀ TOKENOMICS v2 — the one-way economy

Founder-directed 2026-07-27. Supersedes the Risk-to-Earn token architecture where the two conflict;
everything not named here is unchanged.

**Founder rulings recorded on this date:**
1. Burn-to-redeem of real stock tokens is **legal-cleared and Robinhood-approved**. R3 delivery is
   green-lit as a product, not gated behind further review.
2. Cash → OMR is removed. OMR → cash survives as a purpose-built redemption window.
3. Individual yield (staking rewards, personal RWA dividends) is **repurposed to a family yield**
   split among the top families on the standing leaderboard.
4. OMR supply becomes unbounded; **bonds are the only mint**, with the daily cap, the discount
   ceiling and an accretive-only rule kept as the walls.
5. **Sell-only tax at 9%**, no buy tax, split three ways: LP depth / stock buying / founder.

---

## 0. The thesis, in one paragraph

Today every cash faucet in the game is secretly a token-price decision, because in-game cash converts
to OMR. The measured maxed passive stack is **$21.6M/day for one player**, and the only things between
that and sell pressure are a wash cap and AMM depth. v2 severs that link: **cash is a purely internal
gameplay resource with no exit, and OMR enters circulation only when someone pays real ETH for it.**
Playing well no longer prints tokens; it earns position, and position earns a share of what spenders
put in. The token's supply, its backing, and its price stop being downstream of how generous a racket
is.

---

## 1. What is removed

| removed | why | fallout to absorb |
|---|---|---|
| **cash → OMR** (`swap` buy direction) | the coupling described above | laundering is the mechanic built on top of it |
| `launderAtBusiness`, `LAUNDER_DISTRICTS`, `PUBLIC_WASH_CAP_DAY`, launder heat/scrutiny | nothing left to launder into | Business Empire loses its second value proposition; the RICO meter loses one of its feeds |
| individual `stake:reward` payouts | repurposed to the family yield | staking principal still returns whole; the yield moves, not the deposit |
| personal `dividend:omr` claims | repurposed to the family yield | the Dynasty Fund keeps its tier/status axis, loses its personal payout |
| the fixed 20M supply cap on `OMR` | bonds mint | the contract's "nothing mints" audit property is replaced by three explicit walls (§4) |

**Laundering is a pillar, not a line.** Removing it is real content coming out. It is the honest cost
of the change and is accepted deliberately.

---

## 2. THE EXCHANGE — the one-way window

### The problem with "just disable the buy side"

The in-game `swap` is a constant-product AMM over a cash reserve and an OMR reserve. A one-directional
AMM is **not a market** — every trade removes cash and adds OMR, nothing refills the cash side, and the
reserves skew monotonically until the price approaches zero and the window shuts itself. This is a
mechanical certainty, not a risk.

So the AMM is retired and replaced with a purpose-built redemption window.

### The design

**Burn OMR, receive cash from a funded pool, at a published rate, capped by the pool.**

```
burn X OMR        →   X × EXCHANGE.RATE  cash
                      clamped to the exchange pool balance
                      clamped to EXCHANGE.DAILY_CAP_OMR per account per rolling 24h
```

- **The pool is fed by real cash sinks**, not created. A `EXCHANGE.FUND_BPS` slice of the street-tax
  pool (which every in-game take already feeds) is moved into `exchange_pool` on the same 12h worker
  tick the buyback runs on.
- **A dry pool refuses cleanly** (`dry`) and burns nothing. This is the stake-pool discipline from
  Phase 4: the window is a claim on what was funded, never a promise.
- **The rate is a founder lever.** Anchor it at the current AMM genesis spot (~$500 cash per OMR).
- **Arbitrage is impossible by construction** — cash has no exit, so there is no outside price to
  arbitrage the window against. This is the quiet benefit of the one-way design.

### THE INTERLOCK (found while building step 1, and load-bearing)

That last bullet is true **only after step 2**. While the AMM buy side is still live, a *fixed-rate*
window is a money pump: whenever spot sits below `RATE`, buy $OMR with cash and redeem it for more cash.
So the window ships **shut** (`EXCHANGE.OPEN: false`) and opens in the same change that retires the buy
direction. This is enforced, not remembered — `test/tokenomics.js` performs a swap buy and, if it
succeeds, asserts the window is closed. Opening it early fails the suite instead of quietly printing
money. The `EXCHANGE_OPEN=on` test override is classified TEST_ONLY in `src/preflight.js`, so it also
cannot reach production by being forgotten.

### §10.4

| reason | currency | direction | notes |
|---|---|---|---|
| `window:burn` | omr | **BURN** | joins `omrBurns`; the token leaves supply |
| `window:payout` | cash | **FAUCET** (character_id'd) | bounded by the pool; check (a) reconciles it |
| — | cash | pool bookkeeping | street tax → `exchange_pool` writes no ledger row (a singleton-to-singleton bucket move, the `stake_pool` precedent) |

The prefix is `window:` and **not** `exchange:` — the M3 cb/ammo barter board already owns `exchange:`,
and two systems sharing a reason prefix is how a vocabulary check stops meaning anything.

New invariant **`exchange pool backed`**: `paid ≤ funded`. The window can never have paid out more
cash than was moved into it. This is the same shape as `runVigInvariants` — it proves the faucet is a
redistribution, not an inflation.

### The one number that will need revisiting

`EXCHANGE.RATE` is fixed while cash inflates. At $21.6M/day for a maxed stack, a fixed rate makes the
window progressively less attractive in real terms. That is *acceptable* (it self-limits), but it
should be reviewed each season, and indexing it to the pool's own growth is the obvious v2.1.

---

## 3. THE FAMILY YIELD — what the pools pay for now

`stake_pool` and `rwa_dividend_pool` stop paying individuals and merge into **`family_yield_pool`**,
distributed on the 12h worker tick to the top `FAMILY_YIELD.SEATS` families by standing.

- Weighted descending by seat (5,4,3,2,1 over five seats — the Commission-levy pattern).
- Paid into `gangs.omr_reserve`, which already funds seals, foundations and the family RWA book.
- Ledgered `yield:family` — a **TRANSFER**, pool → reserve, both already in `omrBuckets`, so
  conservation stays exact and nothing is minted.
- A dissolved family is skipped and its share redistributes; the pool never leaks.

**Why this is better than individual yield:** family standing today buys Commission seats, which are
status. Now standing pays, so the whole family politics layer — tribute, wars, the Commission, the
seasonal standing reset that closed the purchasable-seat hole — acquires a real economic prize. It
also gives OMR a reason to be *held by an organisation* rather than sold by an individual.

**Staking after this:** principal still deposits and still returns whole, and the unbonding window
(the P1.1 loot surface) is unchanged. It simply pays no personal yield. Consider retiring the deposit
entirely in v2.1 if it has no remaining purpose.

---

## 4. BONDS — the only mint

`OMR` gains a `mint()` gated to the bond contract. The audited "nothing mints" property is deleted
and replaced by **three walls that must all survive**, because after this they are the only ones left:

1. **`dailyCapOMR`** — today the pre-funded tranche is the blast radius of a leaked signer key.
   Without a tranche, the daily cap *is* the blast radius. It becomes the single most load-bearing
   number in the system.
2. **`MAX_DISCOUNT_BPS` (2000), enforced on-chain.** A discount is a mint at a price; an unbounded
   discount is a mint at any price.
3. **Accretive-only.** A bond may mint only when the ETH received is worth at least the market value
   of the OMR issued. Minting at a loss into your own LP is the OlympusDAO failure mode.

### The ETH split

The founder's original proposal sent 100% of bond ETH to the LP. That starves the stock float (§6),
so it splits three ways:

| destination | bps | why |
|---|---|---|
| LP depth | 6000 | the durable half of bonding — payment deepens the market |
| stock buying | 2500 | primary inflow, independent of trading volume |
| founder | 1500 | profit |

Sum validated at load, the same way `BONDS.POL/VIG/DEV_BPS` already is.

### Premium bonds

A bond priced *above* market is a bond nobody buys — you could buy the pool instead. A premium is only
coherent if it bundles something: guaranteed allocation, a longer vest into the family yield, or a
status tier. **Flagged as unresolved**; the discount path is what ships first.

---

## 5. THE SELL TAX — 9%, sell-side only

`OMR.sol` already implements a sell-only tax on transfers *into* registered AMM pairs, capped at
`MAX_SELL_TAX_BPS` 1000, off by default, with buys and wallet→wallet guaranteed 1:1 and Foundry tests
asserting it. v2 keeps that shape and changes only the rate and the split.

| slice | bps of trade | destination |
|---|---|---|
| founder | 200 | dev wallet — profit |
| stock buying | 400 | the RWA float |
| LP depth | 300 | buybacks / depth |
| **total** | **900** | |

This preserves the founder's stated 2% and 4% exactly; the LP slice absorbs the reduction from the
original 10% proposal. `3/3/3` is the obvious alternative and is a one-line lever.

**No buy tax.** A 10/10 is a 19% round trip, which kills price discovery, and taxing entry taxes the
money you most want to arrive. Bond ETH captures 100% of primary inflow rather than 10% of it, so the
buy tax was doing a job that is already better done elsewhere.

**The stack to be aware of.** A player who earns OMR, withdraws and sells pays: the 2% exit toll, plus
up to 50% early-exit surcharge (`EARLY_SELL_TAX_BPS`, decaying to 0 over 48h), plus 9% on the DEX —
`0.98 × 0.50 × 0.91` ≈ **45% of face** on a same-day dump, and ≈ **89%** after 48h. That is the intended
anti-dump gradient, stated so it is a decision rather than a discovery.

**Deploy requirement (unchanged, load-bearing):** canonical liquidity must be Uniswap **V2**-compatible.
V3 rejects fee-on-transfer, and swaps must route through `*SupportingFeeOnTransferTokens`.

---

## 6. THE FLOAT — backing, and burn-to-redeem

Mechanically this is nearly what `src/rwa.js` already does. The changes are the revenue source and
the fact that redemption is now a shipped product rather than a gated boundary.

```
9% sell tax (400bps slice)  ─┐
bond ETH (2500bps slice)    ─┴─→  rwa_revenue  ─→  buy bot  ─→  rwa_reserve (real stock tokens)
                                                                      │
                              player burns OMR ──────────────────────→ claim units at oracle price
```

**Two sources, deliberately.** The LP tax scales with trading volume; bond ETH scales with primary
inflow. In a quiet market the tax yields little — and a quiet market is exactly what the one-way
conversion produces, since gameplay no longer generates sellers. Bond ETH is what keeps the float
growing when volume is thin. **This was the single largest gap in the original proposal.**

### The wall that does not move

**`allocated ≤ held`, per ticker.** Never promise a unit that is not already bought and sitting in the
reserve. No IOUs, no "redeemable once the bot catches up." `runRwaInvariants` enforces it and it is
the reason this design is honest rather than a claim. Legal clearance changes what may be *delivered*;
it does not change what may be *owed*.

Retained regardless of clearance, as cheap deploy-time config rather than a blocker:
- the per-account rolling-24h claim cap
- the jurisdiction/geofence hook (a switch, defaulting open)
- the RICO graduation on large conversions (`SCRUTINY_MIN_OMR`, cumulative window)

---

## 7. Sequencing

1. **THE EXCHANGE + the family yield** — off-chain, testable today, no contract dependency. **BUILT**
   (`src/exchange.js`, `test/tokenomics.js` — the 57th suite). Ships with the window **SHUT** and both
   funding carves at no-op, so this drop changed no signed balance number.
2. **Retire cash → OMR and the laundering surface** — the content removal, once the window replaces it.
   **This is what opens the window**, and the two must land in the SAME change. **BUILT** (§7.2).
3. **Re-source the float** — point `rwa_revenue` at the tax + bond slices. **BUILT** (§7.3).
4. **Contracts** — `OMR.mint()` + the 9% three-way tax; `OmertaBond` mints with the three walls. Both
   reset the audit clock: `forge test` green, then third-party re-audit before mainnet.
5. **Re-sim.** The entire cash economy was balanced against an extraction threat model that no longer
   exists. Every "sim + sign-off" faucet flag in BALANCE.md needs re-reading in that light. **DONE**
   (§7.6; `tools/sim.js` P9.23, BALANCE.md "TOKENOMICS v2 STEP 5").

---

## 7.2 Step 2 in detail — what the sequencing above understates

Written before building it, because tracing the code turned up a dependency §7 does not name.

### The thing §7 understates: retiring the AMM breaks the buyback

`runBuyback` (the 12h tick) is the ONLY in-game conversion of cash into $OMR: it takes the
street-tax pool and *buys $OMR off the AMM*, then splits the proceeds to the event fund, the top-25
families, `stake_pool` (30%) and the LP carve (25%). Retiring the AMM is the whole point of v2 — but
it also deletes that mechanism, and with it the funding path for every $OMR pool in the game.

So the family-yield migration (§3) is **not a later step**. It is forced by the same change, because
the moment the AMM is gone `stake_pool` has no inflow and the buyback has no verb.

### What the 12h tick becomes

`carveExchange` already runs inside the buyback's transaction and needs no AMM — it is a cash → cash
singleton move. After step 2 that IS the tick: **street tax → `exchange_pool`**, so the window can pay
people who burn $OMR. The AMM buy, the family $OMR split and the LP carve all retire with the pool.

### Where `family_yield_pool` gets its $OMR without an AMM

Three sources, all already $OMR-denominated, so none of them needs a market:

| source | today | after |
|---|---|---|
| the one-time balances of `stake_pool` + `rwa_dividend_pool` | pay individuals | **merged in** (§3's "merge into") |
| the exit toll's `tax:buyback` half (withdrawal + early-exit surcharge) | → `stake_pool` | → `family_yield_pool` |
| the RWA invest `DIVIDEND_BPS` (15%) slice | → `rwa_dividend_pool` | → `family_yield_pool` |
| bond mint (step 4) | — | later |

All four are transfers between buckets already inside `omrBuckets`, so `$OMR conservation` stays
exact and nothing is minted. `FAMILY_YIELD.FUND_BPS` — the migration dial shipped at 0 — is what
turns the distribution on.

### Decisions I am making (routine, recorded so they are checkable)

- **The AMM ROW stays.** Retire the routes, not the bucket. `amm_pool.omr_reserve` is inside
  `omrBuckets`, so deleting it would have to move genesis $OMR somewhere and perturb conservation for
  no gain. Left in place it is simply a bucket nobody trades against, and the sweep stays drift-0.
- **Both directions go, not just the buy.** §1 lists only the buy direction, but §2's own reasoning
  applies harder to what would be left: a sell-only AMM drains its cash reserve monotonically until
  the price collapses. The window is the OMR → cash path; leaving a sell-side AMM beside it would be
  the exact degenerate case §2 exists to avoid.
- **Staking keeps the deposit, loses the yield.** §3 already says principal returns whole and defers
  "retire the deposit entirely" to v2.1. Unchanged here.
- **The price oracle is unaffected.** `plexQuote` and the RWA float read the *vig buyback's* recorded
  `price_omr_per_eth` (the DEX TWAP on mainnet), not the in-game AMM. Only the two display surfaces
  (`ops.js` gauge, `opportunities.js` agent board) read AMM spot, and both become `EXCHANGE.RATE` —
  which after step 2 is the only published price the game has.

### Two calls that are the founder's, not mine — flagged, not silently taken

1. **The business PvE risk layer goes dormant.** Front scrutiny comes *only* from laundering
   (income-only fronts were already explicitly never raided — "their risk is PvP"). Retire laundering
   and every front becomes income-only, so the Bureau-raid mechanic built in Business Empire step two
   is still there and simply never fires. That is coherent and invents nothing, so it is what ships.
   But it means personal fronts carry **no PvE risk at all** — only shakedown, takeover and the
   Sacking. If fronts should still draw heat, scrutiny needs a new feed (income volume is the obvious
   one), and that is new content, not a retune. **RESOLVED (founder-directed option b, 2026-07-30):**
   scrutiny is now INCOME-sourced — `BUSINESS_SCRUTINY_PER_INCOME_DAY` heat per operating day's
   income banked (tier-normalized; measured in sim P9.24 at ~one raid/10.1 days ≈ 11–12% of gross
   for a daily collector), and the Bureau-facing specs (accountant/fixer) are un-retired. Recorded
   in BALANCE.md § THE BUREAU RETURNS.


2. **The RICO meter loses a feed.** `LAUNDER_HEAT` (15) and `BUSINESS_LAUNDER_HEAT` (8) were a
   recurring, self-inflicted heat source on the wealthiest players. Without them the investigation
   meter is fed by crime/kill/port heat only, so a passive earner is meaningfully harder for the Law
   to reach. Whether that wants compensating is a balance call for the re-sim (§7 step 5).

---

## 8. Open levers

`EXCHANGE.OPEN` (the interlock) · `EXCHANGE.RATE` · `EXCHANGE.FUND_BPS` · `EXCHANGE.DAILY_CAP_OMR` ·
`FAMILY_YIELD.FUND_BPS` (the migration dial, ships at 0) · `FAMILY_YIELD.SEATS` and weights ·
the bond ETH split · the 900bps tax split · `dailyCapOMR` · premium-bond design (unresolved).

---

## 7.3 Step 3 as built — the float's two sources

`rwa_revenue` was fed by the Store's 20% earmark and the gameplay-fee `FEE_RWA_BPS` slice. §6 adds
the two that matter at scale.

### The DEX sell tax (`recordSellTax`, `src/rwa.js`)

One row per taxed episode in `sell_tax_events` — a `SellTaxTaken` log on mainnet, a mod/QA
`POST /v1/mod/rwa/tax` until step 4 arms the contract's three-way split. The tax is charged in OMR
at the pool; the bot realizes it as ETH; that ETH splits `SELL_TAX.DEV/RWA/LP_BPS`. Only the RWA
slice mirrors into `rwa_revenue` (source `tax`) — the bucket the buy bot draws on. The other two are
recorded so the episode reconciles and the founder can see where the money went.

**The remainder rule sits on the LP slice.** Two of the three slices round down at six decimals, so
three "natural" slices of a 0.1-ETH gross sum to 0.099999 — a wei belonging to nobody. Every real
trade is that case, not a tidy one; the test uses a gross that actually produces dust, because a
gross that divides cleanly proves nothing about the rule.

### Bond ETH (`recordBond`, `src/bonds.js`)

A fourth destination alongside POL / Dev / Vig, mirrored into `rwa_revenue` (source `bond`).
`runBondInvariants` now reconciles **POL + Dev + Vig + RWA == principal** over real bonds, plus a new
check that the RWA slice actually reached the bucket — the accumulator alone is not what gets spent.

### Why both, and not just the tax

The tax scales with **trading volume**. Bond ETH scales with **primary inflow**. A one-way conversion
is *designed* to produce a quiet market — gameplay no longer manufactures sellers — so a tax-only
float grows fastest exactly when it is needed least. §6 calls this the single largest gap in the
original proposal, and it is the whole reason step 3 is two sources rather than one.

### The anti-fabrication gate, restated because it is the load-bearing one

A comp/QA episode records the episode and books **zero** revenue. This is not politeness about test
data: fake revenue buys real-looking units, and `allocated ≤ held` compares allocation to HELD units,
so fabricated backing is invisible to the very check that makes "the game only ever owes stock it
already owns" true. The `txHash` gate is what keeps that sentence honest. Mutation-verified: drop the
gate and the suite names the assertion.

### The Vig slice: a discrepancy I resolved rather than took literally — FOUNDER CALL

§4's table gives the whole remaining 6000 bps to LP and shows **no Vig slice at all**. I did not
implement that, and the reasoning is worth checking rather than trusting:

- The sentence directly under that table names `BONDS.POL/VIG/DEV_BPS`. The author knew the Vig slice
  existed and still produced a table without it. That reads as an oversight.
- Taking it literally defunds the withdrawal reserve. `vig_revenue` → `runVigBuyback` → `fundReserve`
  → the full-reserve queue is the chain a player's $OMR withdrawal travels, and after step 2 that is
  the only real-value exit anyone has.
- The asymmetry decides it. A slightly thinner LP than designed is recoverable. A withdrawal queue
  that cannot sign is a failure players feel the same day.

So RWA 2500 and DEV 1500 are the design's numbers as written, and the remaining 6000 keeps the signed
5:3 POL:VIG relationship (3750 / 2250) instead of zeroing one side of it.

**If the Vig slice really is meant to go: `BOND_POL_BPS=6000 BOND_VIG_BPS=0`.** One line, load-time
sum-validated, and `runBondInvariants` reconciles whatever is set.

### What step 3 does NOT do

It writes no `transactions` rows, adds no §10.4 reason, and moves no game-currency faucet — it routes
real ETH between out-of-band destinations. The suite asserts that directly by counting ledger rows
across a full re-sourcing cycle. The chain half (the contract's three-way tax, a `SellTaxTaken`
watcher, the real buy bot) is step 4 and stays mainnet-gated.

---

## 7.4 Step 4 as built — the contracts, and where I did NOT follow §4

Step 4 is `OMR.mint()` + the three walls + the three-way sell tax, on-chain. `forge test` 77/77
(from 73/73), incl. both 512-run fuzzes.

### What shipped as designed

- **`OMR.mint()`** gated to a single `minter` address, owner-set, evented, shipping **unset**
  (minting off). No owner mint — the Safe chooses who may mint and can revoke it in one transaction,
  but cannot itself print, so "the Safe was compromised" and "supply was inflated" stay two separate
  events. `setMinter(address(0))` is an emergency stop that needs no pause.
- **Wall 1, `dailyCapOMR`** — as specified. Note for the deploy runbook: **`0` means UNLIMITED**, so
  a deploy that forgets it has no wall at all, which is the opposite of the failure mode wall 3 has.
- **Wall 2, `MAX_DISCOUNT_BPS`** 2000, compile-time, mirroring the backend.
- **The sell tax** at 900 bps split dev 200 / rwa 400 / lp 300, with the **remainder rule on the LP
  slice** so the three shares sum to the tax exactly (the same discipline the step-3 ingest uses —
  two of three shares round down, and a "natural" third slice strands a wei belonging to nobody).
- The payout is minted **at bond time, not at claim**, which keeps `committedOMR <=
  omr.balanceOf(this)` true at every instant — so `sweep` still cannot reach OMR backing an
  outstanding bond, and a claim can never fail for want of balance.

### Wall 3: "accretive-only" as written is not implementable, and would forbid the product

§4's wall 3 says a bond may mint only when the ETH received is worth **at least** the market value of
the OMR issued. Taken literally that forbids **every discounted bond** — a discount is by definition
issuing OMR worth more than the ETH paid — so the rule as phrased and the product it guards
contradict each other. The discount path is what §4 itself says ships first.

The intended (Olympus) meaning is treasury-BACKING accretion: reserves ÷ supply must not fall. That
is a real and correct rule, and it is **not checkable in this contract**. `OmertaBond` custodies
nothing — it forwards every wei of the split in the same transaction — so it cannot know treasury
reserves without an oracle. And an oracle on the mint path becomes the thing standing between a
leaked key and unbounded supply: it would be the softest wall of the three while looking like the
strongest.

**What shipped instead: `maxOmrPerEth`** — a hard, Safe-set ceiling on OMR minted per ETH, checked on
the POST-discount rate (the rate actually issued, not the quoted market rate), and **fail-closed at
zero** (the GearVault gear-cap precedent), so an unconfigured deploy cannot bond rather than bonding
at any price. It is weaker as economics and stronger as a wall, and it is documented as exactly that
in the contract header, in `CHAIN-DEPLOY.md` gate 2, and in `BALANCE.md`.

**Where backing accretion belongs: the off-chain pricing policy that decides what to sign.** That is
the layer that can read the whole treasury, and where getting it wrong costs one bad bond instead of
the token. It is not built — flagged here as the real remaining piece of §4's intent.

**FOUNDER CALL:** if wall 3 is meant literally as a market-value test, it needs an oracle on the mint
path and that trade-off should be taken deliberately, not by me.

### What step 4 does not do

No in-game faucet moved; zero `transactions` rows; §10.4 untouched. Mainnet is unchanged and still
gated on the launch checklist and the third-party audit — **whose clock this drop resets**, since the
property every prior contract review leaned on is the one it deletes. The step-5 **RE-SIM is still
owed** and is now the largest open item in the pivot.

---

## 7.5 Wall 3 resolved — the oracle goes in (founder call, 2026-07-29)

§7.4 flagged that "accretive-only" as written is not implementable and shipped a static rate ceiling
instead, with the trade-off recorded and the decision put to the founder. **The founder ruled: build
the oracle.** This section supersedes §7.4's "what shipped instead" — but NOT its reasoning, which is
what shaped how the oracle went in.

### What was built

- **`IOmrOracle`** — a deliberately minimal interface (one price, one timestamp). The mint path
  should be reviewable without reading a fixed-point maths library, and the feed should be swappable
  (V2 pool → V3 → a Chainlink-style aggregator) without ever touching that path.
- **`OmrTwapOracle`** — a Uniswap V2 cumulative-price TWAP. A TWAP and **not a spot read**, because
  spot on a mint path can be moved and restored inside a single block by anyone with a flash loan; a
  spot-priced mint wall is not a wall. `PERIOD` has a compile-time floor (10 min) so a 30-second
  "TWAP" — a spot price wearing a TWAP's name — cannot be deployed. `update()` is permissionless:
  gating the poke on a keeper role would mean a lost key freezes the feed and, through it, the whole
  bond product.
- **`OmertaBond` wall 4** — the signed quote's claimed market price must sit within
  `priceToleranceBps` of the TWAP. Fail-closed on all four failure modes: unset feed, unset
  `maxOracleAge`, a zero reading, and a reverting feed.

### The property that makes a price feed safe on a mint path

§7.4's objection was that an oracle becomes the thing standing between a leaked key and unbounded
supply. That objection is answered **structurally, not by trusting the feed**: wall 3 was KEPT and is
checked independently, so the real ceiling is

```
MIN( maxOmrPerEth , oracle x (1 + tolerance) / (1 - discount) )
```

**A manipulated oracle can only ever tighten this, never loosen it.** Push the feed down and bonding
halts — a liveness problem, recoverable, no supply created. Push it up and `maxOmrPerEth` still binds,
because that is the Safe's number and no oracle can raise it. Deleting wall 3 as now-redundant would
remove exactly this guarantee, which is why the contract header says so and a dedicated test
(`test_oracle_CANNOT_LOOSEN_the_static_ceiling`) fails if anyone does.

### On the word "accretive"

The literal rule is now a **setting**, not something dropped: `priceToleranceBps = 0` with
`MAX_DISCOUNT_BPS = 0` is exactly "mint only when the ETH received is worth at least the OMR issued".
At the shipped values it is a bounded, market-tracking dilution ceiling — the treasury receives ETH
worth at least `(1 - maxDiscount) / (1 + tolerance)` of the OMR issued at market. **Say that number
when tuning; do not call it accretion.** True treasury-BACKING accretion (reserves ÷ supply) is still
not checkable here — the contract custodies nothing — and remains the job of the off-chain pricing
policy, which is where it belongs and where a mistake costs one bad bond instead of the token.

### Two things this created that did not exist before

1. **A keeper is now a production dependency.** `update()` must be poked at least once per
   `maxOracleAge` or bonding halts. The failure direction is deliberate and correct, but it is an
   operational commitment and is in CHAIN-DEPLOY.md as a deploy step, not a footnote.
2. **The backend had to be taught the chain's price.** `quoteBond` signed against the Vig buyback
   TWAP, which is a *different feed* from the on-chain oracle. Left alone, any drift beyond tolerance
   would revert every honest quote while the server looked perfectly healthy. `makeBondPriceReader`
   now reads the contract's own `priceCeiling()` and CLAMPS the signed price to it, so the two agree
   by construction; a chain whose oracle is unset/stale/broken is reported as a paused product rather
   than papered over with quotes that cannot land.

### Founder levers this adds

`priceToleranceBps` (0 = literal accretion; hard-capped 20%), `maxOracleAge` (must exceed the keeper
interval), and the oracle's `PERIOD` (longer = more manipulation-resistant, more lag). All three are
deploy-time and all three are properly a function of the step-5 re-sim, **which remains owed**.


---

## 7.6 Step 5 as done — the re-sim

Measured by a new `tools/sim.js` **P9.23**; the reclassification is in BALANCE.md. **No lever retuned.**

**The finding is categorical, not numerical.** `invariants.js:omrMints` is the enumerated set of
everything that can create $OMR — `mission:%`, `prize:omr`, `emission:%` — and none takes cash as an
input. There is no direct path and no laundered path through a third asset. This is not a measurement
that could come out differently later; it is a property of the code that a §10.4 check enforces.

**What that does to the flags.** Every cash faucet carried two worries, and they now separate: *"this
becomes sell pressure"* is **moot** (the path is gone), and *"this breaks pacing or concentrates
wealth"* is **still live and now the only question**. The open flags — the passive stack, the apex
purses, the port curve, the `npc:seed` recycle, co-op raid throughput — are therefore **reduced in
stakes and narrowed in scope, not resolved**. Getting one wrong is now a game-design problem fixable by
a retune rather than a token-holder problem.

**The token model, now that it stands alone.** Supply is decided by three bounded things: the wage
(fixed, halving, endowment-capped, minted-only), bonds (four walls + the oracle), and the sink catalog.
P9.22's standing finding is unchanged and is the most important number left: **the Exchange window
absorbs only a few percent of emission until the base is in the thousands**, so the real exit is the
sink catalog and the reserve-backed chain withdrawal. `FUND_BPS` / `RATE` / `EPOCH_OMR`, in that order
of directness. Founder call.

**A trap worth recording.** P9.23's first cut split reasons into faucets and sinks by net sign and
reported `gang:tribute` as a $120k "sink" for cash that had moved into a treasury and still existed —
mirrored transfers are ledgered once and the treasury credit is derived. The probe now splits by
`character_id` the way the invariants do. A measurement that looks authoritative and is subtly wrong is
worse than none.

**The pivot is complete.** Steps 1-5 are built; what remains is mainnet, which is gated on the launch checklist
and the third-party audit (whose clock step 4 reset).
