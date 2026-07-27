# OMERTÀ TOKENOMICS v2 — the one-way economy

Founder-directed 2026-07-27. Supersedes the Risk-to-Earn token architecture where the two conflict;
everything not named here is unchanged.

**Founder rulings recorded on this date:**
1. Burn-to-redeem of real stock tokens is **legal-cleared and Robinhood-approved**. R3 delivery is
   green-lit as a product, not gated behind further counsel.
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
   **This is what opens the window**, and the two must land in the SAME change (see the interlock below).
3. **Re-source the float** — point `rwa_revenue` at the tax + bond slices.
4. **Contracts** — `OMR.mint()` + the 9% three-way tax; `OmertaBond` mints with the three walls. Both
   reset the audit clock: `forge test` green, then third-party re-audit before mainnet.
5. **Re-sim.** The entire cash economy was balanced against an extraction threat model that no longer
   exists. Every "sim + sign-off" faucet flag in BALANCE.md needs re-reading in that light.

---

## 8. Open levers

`EXCHANGE.OPEN` (the interlock) · `EXCHANGE.RATE` · `EXCHANGE.FUND_BPS` · `EXCHANGE.DAILY_CAP_OMR` ·
`FAMILY_YIELD.FUND_BPS` (the migration dial, ships at 0) · `FAMILY_YIELD.SEATS` and weights ·
the bond ETH split · the 900bps tax split · `dailyCapOMR` · premium-bond design (unresolved).
