# THE STOCK MACHINE — tax → daily Commission-voted stock buy → gas-paid claims

**Status: DESIGN ONLY (founder-directed 2026-08-09). Counsel approval recorded as a founder
assertion ("Counsel has approved"), the standing directive pattern. Nothing here is built; the
chain half is mainnet-gated on the third-party audit clock like every contract change.**

The founder's proposal, verbatim in spirit: (1) the fee slice dedicated to RWA should buy the
stock *programmably, like a v4 hook*; (2) the top families should vote **daily**, through the
Commission, on **which stock** gets bought — a live call-to-action; (3) distribution costs money,
so the bought stock **sits and accumulates** until a user **claims their airdrop by paying the
gas** themselves.

**Verdict: FEASIBLE — all three legs — with two engineering corrections and one compliance
transfer.** The corrections: the buy should be **hook-accrued but keeper-executed** (per-swap
atomic buying is technically possible in v4 and a bad idea — §2); and "airdrop" needs an
**allocation rule** (who is owed how much), for which the retired float design's burn-earned-$OMR
rail is the sound answer (§4). The compliance transfer: Robinhood Stock Tokens are **standard
ERC-20s with no on-chain transfer allowlist** — they move peer-to-peer and trade on a day-one
Uniswap deployment — so the not-for-US-persons restriction is enforced by the *distributor*, i.e.
by OUR claim rail, not by the token (§5).

---

## 0. What is already true (verified 2026-08-09)

- **Robinhood Chain is live** (public mainnet 2026-07-01): an Arbitrum Orbit L2, ETH for gas —
  the SAME chain family OMERTÀ's whole M6 rail targets. No bridge is needed anywhere in this
  design. (The tokenomics-v2 §10.2 cross-chain flag is moot here too.)
- **Stock Tokens are ordinary ERC-20s**: ~200+ US stocks/ETFs, EU-facing, each with a Chainlink
  price feed; corporate actions land as **on-chain multipliers, not balance changes** — which is a
  gift: a vault holding N token units still holds N units after a split, so `allocated ≤ held`
  in TOKEN UNITS stays exact across corporate actions with zero code.
- **Uniswap runs on Robinhood Chain from day one** (a dedicated deployment). OPEN DEPENDENCY:
  which version the stock-token pools run (v3 vs v4) — the keeper's swap call differs, nothing
  else in this design does. Verify before Phase B.
- **Not for US persons** is a securities-law restriction on offer/sale, not a token-level gate.
  Anyone technically *can* hold the ERC-20; the party distributing to a US person is the one with
  the problem. The moment we distribute, that party is us — §5.
- **In our own tree**: the four tax slices already flow into `rwa_revenue` (bond 2500 bps,
  sell-tax 400, Store 2000, gameplay-fee 1000); the v4 `OmertaHook` already **accrues** its RWA
  slice in ETH with a permissionless `sweep` to Safe-set recipients; the Commission has weekly
  vote machinery (`commission_votes`, seats recomputed live); the retired float
  (`omerta-rwa-float-design.md` + `src/rwa.js` at pre-retirement history) had the reserve
  bookkeeping, the `allocated ≤ held` invariant, the anti-fabrication txHash gate, and the
  oracle-priced burn-to-claim rail; and `VoucherClaim` is a battle-tested server-signed EIP-712
  claim contract. **Almost every part of this machine exists; the new work is one keeper, one
  vault contract, one daily ballot, and the geofence.**

## 1. The pipeline at a glance

```
  sells on the OMR pool                     daily, once
  ────────────────────►  OmertaHook accrues  ──────────►  THE BUY (keeper)
                         the RWA slice in ETH             ETH → today's TICKER
                         (already designed)               on its Uniswap pool
                                                              │
  Commission daily TICKER BALLOT  ────────────────────────────┘
  (seated families vote; the town watches)                    ▼
                                                    StockVault (Safe-owned)
                                                    holds the tokens; per-ticker
                                                    units + cost basis booked in
                                                    rwa_reserve (txHash-gated)
                                                              │
  player burns earned $OMR at the oracle price  ──────────────┤  allocation
  (rwa:vault — the reason already in the vocabulary)          ▼
                                                    CLAIM: server-signed EIP-712
                                                    voucher; THE PLAYER PAYS GAS;
                                                    geofence + eligibility at sign
```

## 2. Leg one — "programmable like a v4 hook": accrue in the hook, buy with a keeper

**Can a v4 hook buy the stock inside the taxed swap itself?** Yes, technically: v4 pool
operations run inside the PoolManager's unlock callback, and a hook may itself call
`poolManager.swap` against ANOTHER pool in the same transaction — atomic ETH→ticker per sell is
expressible. **We should not do it**, for the same reasons the shipped `OmertaHook` accrues fees
rather than forwarding them in-transaction:

1. **Pool liveness.** A revert anywhere in the stock leg — the stock pool paused, thin, or
   mid-migration — reverts the PLAYER'S swap. That bricks the OMR market whenever a stock pool
   hiccups. Market liveness must never depend on a third pool's behaviour (the exact argument
   that made the hook sweep-based; it holds with more force for a pool we don't operate).
2. **Gas.** Every seller pays for our treasury's shopping. A tax should be cheap to pay.
3. **Execution quality.** Hundreds of micro-buys are sandwich food; one daily buy executed by a
   keeper at a TWAP-checked price with a slippage bound is both cheaper and manipulation-resistant.
4. **The product is daily anyway.** The Commission votes per day; a per-swap buy would front-run
   its own ballot half the time.

So the "programmable" part is exactly what the hook already does — **the RWA slice accrues in
ETH inside the hook, trustlessly, per swap** — and THE BUY is a once-daily keeper transaction:
`sweep()` the hook's accrued slice (plus the bond/Store/fee slices already landing at the
treasury) → swap ETH → today's ticker on that token's own Uniswap pool → deliver to the
StockVault. Keeper discipline copied from the bond-oracle keeper: slippage-bounded against the
token's Chainlink feed, fail-closed on a stale feed, watched by the existing `alertDrift`
watchdog pattern (a silent keeper reads exactly like a quiet day — the recorded lesson).

**Bookkeeping** resurrects the float's ledger from git history: `rwa_reserve (ticker, units,
cost basis)` + `rwa_buys` rows **txHash-gated** (a comp/QA call books ZERO units — "the treasury
holds this" must never be assertable by a mod route; the anti-fabrication class that has been
fixed three times in this tree). The invariant is the float's, restored to its original strength
because both sides are the same asset again: **allocated ≤ held, per ticker, in token units** —
nightly, beside vig/bond/treasury/desk in `alertDrift`.

## 3. Leg two — THE TICKER BALLOT (the Commission picks the stock of the day)

Pure off-chain build on existing machinery, and the best part of the proposal — it turns a
treasury operation into a daily server-wide political event.

- `commission_ticker_votes (day, gang_id, ticker)` — the weekly `commission_votes` shape at
  daily cadence. A **seated** family's boss/underboss casts one public vote per day from the
  supported-ticker catalog (start small: 5–8 liquid names); re-cast all day; standing-ranked
  weighted tally at close (the audited step-two ballot discipline: weight frozen at cast,
  electorate bounded at the seat count, dissolved families' ballots deleted).
- **The day's draw resolves at the buy, not at midnight**: the keeper reads yesterday's tally.
  Deadlock/silence → the keeper buys the DEFAULT ticker (a founder lever — e.g. the broad-market
  ETF) rather than skipping, so a quiet chamber never stalls accumulation. (Alternative:
  skip-and-carry the budget; a founder call, but a default keeps the daily beat alive.)
- **Why this is manipulation-safe**: the vote chooses *which* ticker, never *whether*, *how
  much*, or *to whom* — the budget is the accrued slice and the destination is the vault, both
  outside the ballot. The worst a captured chamber does is pick a stock the town disagrees with.
  That is not an exploit; that is the Commission working.
- **The call-to-action**: the open ballot on `GET /v1/city` + a card on the Family tab ("the
  chamber is deciding today's buy — your family's vote is cast/uncast"), the result on the
  streets feed + the city wire ("the Commission put the day's take into NVDA"), and the running
  vault (units per ticker, cost basis, market value via the Chainlink feeds) as a public board —
  the town watching its own treasury grow is the retention hook.

**§10.4: zero surface.** Votes move nothing; the buy is out-of-band real value (zero
`transactions` rows, the fees.js precedent); the vault board is a read.

## 4. Leg three — claims: the user pays the gas, and WHAT they can claim needs a rule

"Anyone can claim while it sits and accumulates, paying the gas for their airdrop" — the
**pull-payment** pattern, and correct: distribution cost lands on the claimant, unclaimed stock
just sits (custody is free), and nobody is ever pushed a token they didn't ask for (which
matters legally — see §5).

**The missing piece is the allocation rule** — an "airdrop" implies everyone is owed something,
but *how much*? Two options, one recommended:

- **RECOMMENDED — the float's rail: burn earned $OMR to allocate.** A player burns $OMR at the
  ticker's oracle price (Chainlink feed × a premium bps — the vault is not a market maker, the
  treasury-claim precedent) to move units from `unallocated` to their account's vault line
  (`rwa_vault (account_id, ticker, units)` — account-level, survives death). The burn reason
  `rwa:vault` is **already in the §10.4 vocabulary** — this is the one in-game flow in the whole
  machine, and it's a sink. Properties: allocation is **purchase-shaped** (earned, chosen, priced
  — "never by chance" holds trivially); it's a deep recurring $OMR sink; clamps to `unallocated`
  so an IOU can never be issued; structuring-guarded by the shared `rwa_used` RICO window that
  already exists.
- **Rejected — pro-rata "everyone accrues a share by playing."** Distribution-by-gameplay makes
  the stock a *dividend on play*, drags every §10.4 faucet into securities analysis, strengthens
  the investment-contract reading of $OMR itself, and still needs a claims registry. The
  founder's "any user can choose to claim" is fully satisfied by the burn rail — anyone CAN
  claim; what they claim is what they allocated.

**The claim mechanics** are the M6 rail with a different asset — `StockVault` is `VoucherClaim`
with an ERC-20 `transfer` instead of a mint: server-signed EIP-712 voucher
`{to, ticker/tokenAddr, units, nonce, deadline}`, replay-proof nonce, deadline-bound, per-ticker
daily caps, pausable, Safe-owned, **pre-funded only** (it can only hand out what it holds — the
tranche discipline; `allocated ≤ held` enforced by construction on-chain and checked off-chain).
The claimant submits and **pays the gas**; the server signs only for an eligible account (§5).
An expired unclaimed voucher's units return to the account's allocation (the
`reclaimExpiredVouchers` pattern, easier here since nothing was burned to sign).

## 5. The compliance transfer — because the token itself won't stop anyone

The searches confirmed the sharp fact: **there is no on-chain allowlist**. A Stock Token moves
like any ERC-20. So every restriction lives at the point of *distribution* — and the claim rail
is our point of distribution. Consequences, all mechanical:

1. **Eligibility is checked at voucher-SIGN time, server-side**: linked SIWE wallet + minted
   account (the extraction gate that already exists) + **geofence/attestation for the excluded
   jurisdictions** (US persons at minimum; Robinhood's own excluded list — UK, Canada,
   Switzerland — mirrored unless counsel narrows it). An ineligible account can still ALLOCATE
   (the in-game burn and the vault line are not the securities event) — it just can't claim
   on-chain until eligible. This is exactly the R3 posture the original design recorded.
2. **Pull, never push.** No token ever moves to a wallet that didn't sign a claim transaction —
   which is both the gas-cost win the founder wants and the clean answer to "did you distribute
   to them?" (they came to the counter, attested, and paid).
3. **The standing copy rules stand**: no appreciation language, no earnings promises, describe
   the machine factually. The counsel approval covers architecture; exact player-facing copy is
   its own review (the recorded rule).
4. **KYC depth is counsel's call, not ours**: the issuer's own redemption path is KYC'd; whether
   our claim counter needs full KYC or geofence+attestation is the one open legal parameter.
   The design works under either — it only changes what `signStockVoucher` checks.

## 6. Build order (each phase shippable alone)

- **PHASE A — off-chain, zero new legal surface, buildable now**: the TICKER BALLOT
  (`commission_ticker_votes` + tally + the city/family/feed surfaces), the vault BOARD (public
  units/cost/value), and `rwa_reserve` bookkeeping resurrected txHash-gated (mod-driven sim
  buys for QA book zero units). Chain-dormant like every M6 sibling.
- **PHASE B — the metal**: `StockVault.sol` (the VoucherClaim fork) + the keeper (sweep → swap →
  vault, slippage-bounded, watchdogged) + real `rwa_buys`. **Resets the third-party audit clock**
  (the recorded rule for any contract change) — batch it with whatever else is queued for that
  audit. Verify the Uniswap version on Robinhood Chain here.
- **PHASE C — claims live**: `signStockVoucher` + the geofence/attestation gate + the client
  claim flow (the wallet picker + calldata rail already exist), behind counsel's final word on
  KYC depth and the jurisdiction list.

## 7. What this deliberately does not do

No per-swap atomic stock buys (§2). No pro-rata airdrops (§4). No custody of claims we don't
hold (allocated ≤ held, both sides in token units). No RNG anywhere near the asset (the
never-by-chance rule — the ballot is a vote, the allocation is a purchase, the claim is a
transaction). No new hook — the deployed-in-design `OmertaHook` already accrues the slice, and
one pool takes one hook. **FOUNDER-RESOLVED 2026-08-09 ("one hook four slices"): the canonical
pool runs ONE hook whose accrued fees route to FOUR destinations — dev / treasury (this
machine's buy budget) / LP / vig — folding the §10.8 trade-fee question and this design's
treasury slice into a single contract. The Stock Machine adds a KEEPER that sweeps the hook's
treasury accrual, never a second hook.** And no copy that promises anything about what the
stock will be worth.
