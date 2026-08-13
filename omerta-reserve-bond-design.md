# The Reserve Bond — design (Option C: disciplined treasury bonding for Protocol-Owned Liquidity)

**Goal:** deepen and OWN the OMR-ETH pool (Protocol-Owned Liquidity) instead of renting it from mercenary
farmers — the durable half of the OlympusDAO idea — **without** the discredited half (a reflexive,
inflationary token mint). This document specifies a bond that fits OMERTÀ's three hard walls:

1. **OMR is fixed-supply on-chain — there is no mint.** A bond therefore SELLS a *budgeted allocation of
   existing treasury OMR*, never mints. Total OMR ever bonded out is hard-capped by the tranche.
2. **§10.4 is sacred ("value transfers, never minted").** The bond is REAL-VALUE, OUT-OF-BAND (real ETH in,
   treasury OMR out) — the `fees.js` precedent: it writes ZERO `transactions` rows, so the in-game §10.4
   sweep is untouched by construction. It carries its OWN invariant on the real-value side (the
   `runVigInvariants` twin).
3. **How it ships.** A bond is a financial primitive that could read as a yield product. It ships
   **off-chain-first / chain-dormant** (the M6/Vig/Store pattern), and the on-chain contract + real ETH are
   **MAINNET-GATED on the launch checklist + a third-party audit**, exactly like R2/R3 and the withdrawal rail.
   **No APY / price-appreciation marketing** — the bond is framed as "help capitalize the treasury," not
   "earn X%." (Same rule the whole codebase already holds.)

## The mechanism (Olympus Pro, disciplined)
A bonder deposits **ETH** (a "reserve bond") or **OMR-ETH LP tokens** (a "liquidity bond") and receives
**OMR at a discount, vested linearly** over `VEST_HOURS`. The protocol keeps the ETH/LP forever as POL +
treasury. The discount is the bonder's incentive; the vesting stops an instant dump.

**Sourcing (the anti-Ponzi discipline):** the payout OMR comes from a **budgeted tranche**
(`bond_reserve.capacity_omr` — real treasury OMR the team pre-allocated, exactly like the VoucherClaim
tranche). The invariant `committed_omr ≤ capacity_omr` is enforced at bond time (the full-reserve-queue
discipline applied to bonds): **the protocol can never promise more OMR than it budgeted.** When the tranche
is exhausted, bonding pauses until the treasury refills it. So bond emission is BOUNDED and never reflexive.

**Pricing.** `payout_omr = principal_eth × oracle_price × 1/(1 − DISCOUNT)`, where `oracle_price` is the live
OMR-ETH market rate (mainnet: the DEX TWAP the Vig bot already reads; off-chain: a param). `DISCOUNT` (≤
`MAX_DISCOUNT`) is the incentive — the protocol accepts paying a premium in OMR to acquire the ETH/LP. That
premium IS the cost of owning liquidity; it is bounded by the tranche.

**Where the ETH goes (the split — the Store's three-way-split precedent):**
- `POL_BPS` → **Protocol-Owned Liquidity**: paired with treasury OMR into the OMR-ETH pool (deepens the pool,
  the whole point — recorded as `bond_pol.eth`).
- `VIG_BPS` → **`vig_revenue` (source `bond`)**: feeds the EXISTING Vig buyback → the withdrawal reserve +
  the prize pool, so bonds ALSO strengthen "extraction ≤ inflow" (the Store precedent — `runVigInvariants`'
  `spend ≤ revenue` absorbs bond revenue unchanged).
- (POL_BPS + VIG_BPS = 10000.)

So a bond STRENGTHENS the economy on two axes — pool depth (POL) and reserve backing (Vig) — while its OMR
cost is hard-capped by the treasury's own budget. Unlike Olympus, there is no mint and no reflexive APY.

## §10.4 & the bond invariant
**In-game §10.4: UNTOUCHED.** `bonds.js` writes only `bonds` / `bond_reserve` / `bond_pol` /
`vig_revenue(source='bond')` — never `transactions`. Real ETH + treasury OMR are out-of-band value (the
`fees.js` rule). The test asserts the full in-game §10.4 sweep stays drift-0 through a bond run.

**`runBondInvariants` (the real-value side, the `runVigInvariants` twin):**
- (1) `bond_reserve.committed_omr == Σ bonds.payout_omr` (accounting matches the rows).
- (2) `committed_omr ≤ capacity_omr` (**never over-budget** — the hard anti-Ponzi cap).
- (3) `Σ bonds.claimed_omr ≤ committed_omr` (never release more than owed).
- (4) `Σ bonds.principal_eth == bond_pol.eth + Σ vig_revenue.gross_eth(source='bond')` (the ETH split
  reconciles — nothing skimmed).
- (5) every bond's `discount_bps ≤ MAX_DISCOUNT` (no rogue discount).

## Lifecycle (off-chain-first, chain-dormant)
- **`recordBond`** (the `recordFeePayment`/Store `recordStorePurchase` twin) — ingest a bond: idempotent on
  `nonce`; price the payout; **reject if `committed + payout > capacity`** (`over_capacity`); split the ETH
  (POL + Vig); insert the vesting bond; bump `committed_omr`. Attributes to the payer's linked wallet →
  account (the Store reconcile-at-link precedent), else parks for `reconcileBonds` at link.
- **`claimBond`** — vested = `payout × min(1, elapsed/VEST_MS)`; claimable = vested − claimed. Off-chain this
  is accounting only; on mainnet the on-chain contract releases the real OMR from the tranche. A bonder
  becomes a **"Treasury Backer"** (a pure STATUS badge, account-level like `patron` — no gameplay power, no
  §10.4 surface — derived from holding any bond).
- **Worker**: `runBondBuyback`/POL pairing is the on-chain bot's job (mainnet). Off-chain, `sweepBonds` is a
  no-op placeholder; the Vig buyback already spends the bond's Vig share.

## Routes
- `GET /v1/bonds` — public: the offerings (discount, vest, **remaining capacity**), the current oracle
  price, and your bonds (principal, payout, vested, claimable). Informational — real purchases are on-chain
  at the (mainnet, dormant) bond paywall, the Store's on-chain-note precedent.
- `POST /v1/bonds/:id/claim` — claim vested OMR (accounting off-chain; the real release is the on-chain
  contract).
- `POST /v1/mod/bond/fund` — set/top-up the tranche capacity (a treasury act; the reserve/fund precedent).
- `POST /v1/mod/bond/simulate` — mod/QA: drive `recordBond` directly with a synthetic nonce + a price
  (the Store `mod/store/grant` comp precedent — how the off-chain layer is exercised until the paywall).
- `GET /v1/mod/bonds` — the ops view: capacity/committed/remaining, POL ETH acquired, Vig ETH routed, the
  bond invariant. On the admin dashboard's chain panel.

## Red-team (independent)
A focused audit of the financial primitive returned CLEAN — **no CRITICAL/HIGH/MED**. Verified: the
anti-Ponzi cap **cannot be breached even under concurrency** (`bond_reserve` is `FOR UPDATE`-locked before
the capacity check; a second bond re-reads the first's commitment and correctly `over_capacity`-rejects);
§10.4 is genuinely untouched (`bonds.js` writes zero `transactions` rows and `claimBond` credits NO in-game
`account_persistent.omr` — it only advances the bond's accounting); the ETH split + payout are
NaN/negative/zero-divisor-proof (discount ≤ 20% ⇒ divisor ≥ 0.8); idempotency is double-backstopped
(`bonds.nonce` PK + the `vig_revenue(source,ref)` guard, under the tranche lock); claim vesting is clamped
`[0, payout]` and account-scoped; and the five bond invariants each bite. **LOW-1 FIXED** (regression added):
`reconcileBonds` (the `reconcileStore` twin) is now built + wired into `walletVerify` + `bonds.payer_address`
added, so a bond ingested for an unlinked wallet (the on-chain pre-link case) is attributed + made claimable
at wallet-link instead of stranded. **LOW-2 (accepted, reporting-only):** `vigStatus.grossRevenueEth` counts
only the bond's 40% Vig share (the 60% POL share lives in `bond_reserve.pol_eth`, outside Vig accounting) —
semantically correct (POL is not Vig revenue), breaks no invariant (`runVigInvariants` reads `vig_eth`, never
`gross_eth`); the full bond inflow is visible on `GET /v1/mod/bonds`. Bottom line: it cannot over-issue past
the tranche, and it cannot perturb §10.4.

## The on-chain contract (WRITTEN)
`omerta-contracts/src/OmertaBond.sol` + Foundry tests `test/OmertaBond.t.sol` implement the on-chain half:
EIP-712 server-signed `BondQuote`s (the VoucherClaim signer discipline), the tranche cap enforced on-chain
(`committedOMR + payout ≤ omr.balanceOf(this)` — the payout TRANSFERS pre-funded OMR, never mints), linear
vesting `claim`, the ETH split forwarded in-tx (POL + Vig, custodies no ETH — the OmertaFees pattern),
immutable `polBps` + `MAX_DISCOUNT_BPS`/`MAX_VEST` backstops (kept in lockstep with the backend `BONDS.*`),
Safe-owned + pausable, and a `sweep` that can pull ONLY the uncommitted tranche (never OMR backing an
outstanding bond — the test proves a bond is fully honoured after a sweep). It **compiles clean** (solc
0.8.26 + OZ 5.1, 0 warnings, via `tools/compile-contracts.js`); the contracts README carries the viem
quote-signing parity snippet. `forge test` still needs a Foundry-capable environment (egress-blocked here —
the established suite residual) before the third-party audit.

### Contract red-team (focused Solidity audit)
A max-skepticism review of `OmertaBond.sol` verified the five central invariants SOUND — **no
CRITICAL/HIGH**: the no-mint tranche cap can't be breached (the cap check precedes the `committedOMR`
bump; `claim` decrements it; `sweep` guards `amount ≤ balance − committedOMR`; the assumption is a
fixed-supply vanilla ERC-20, documented — a fee-on-transfer/rebasing token would be the only way to
drift `balance` below `committedOMR`, and OMR is neither); the ETH split forwards under
`nonReentrant` + full CEI (nonce/committed/bond all written before the external calls) with
`toPol + toVig == msg.value` exact; vesting is clamped `[0, payout]` and the final claim sums to
exactly `payout`; EIP-712 typehash/domain/`verifyingContract` block cross-contract + cross-chain
replay; and the payout math has divisor ≥ 8000 (no div-by-zero, no realistic overflow). Two items
fixed in-commit (mirroring the sister contracts, regression tests each): **MED-1** — `bond()` bounded
`deadline` only from below (Expired) but not from the FUTURE, so a leaked-then-rotated signer's
`deadline=2100` pre-signed quotes stayed bondable at a stale price up to the tranche; now
`MAX_QUOTE_TTL = 30 days` + `if (q.deadline > block.timestamp + MAX_QUOTE_TTL) revert DeadlineTooFar();`
(the `VoucherClaim.MAX_VOUCHER_TTL` mirror). **LOW-1** — no ETH-rescue path (force-sent ETH was
trapped); now an `onlyOwner nonReentrant sweepETH()` routes `address(this).balance` to `owner()` (the
Safe), the `OmertaFees.sweep` pattern. Added tests: the `DeadlineTooFar` revert (+ the exact-boundary
accept), the ETH sweep (+ owner-gate), a reentrant-recipient re-entry (the guard blocks it → the
forward fails → the whole bond rolls back, nothing committed/leaked, nonce freed), and a **fuzz** of
the anti-Ponzi invariant (`committedOMR ≤ omr.balanceOf(this)` after any bond). LOW-2 (a zero-payout
bond books a nonce + forwards ETH) is accepted as informational self-harm, server-gated.

## Deferred (mainnet milestone — launch + audit gated)
`forge test` execution (the pre-audit gate), the **`Bonded` event watcher** (the `getLogs` cursor pattern,
`watcher.js` precedent → `recordBond`), the **POL pairing bot** (pairs the POL ETH share with treasury OMR
into the DEX pool), and **liquidity bonds** (LP-token deposits). All wired only after the launch checklist + the
third-party audit that already gates mainnet. Numbers (`DISCOUNT`, `MAX_DISCOUNT`, `VEST_HOURS`, the POL/Vig
split, the tranche capacity) are founder sign-off levers.
