# AUDIT — THE FLOAT (the full-reserve RWA layer, R2 redesigned)

Two independent red-team lenses over the drop (`src/rwa.js`, the fees FEE_RWA_BPS slice, the
routes, the schema, the test block), every finding verified against source before any fix.
**No CRITICAL.** The core walls held on inspection: **the wall is airtight in code** (no
path anywhere decrements `rwa_vault`/`rwa_reserve.units`, no unit transfer between accounts, no
redeem/sell affordance, entry is exclusively the `spendOmr` burn, zero RNG grants), **§10.4 is
exact** (`rwa:vault` rides the pre-existing `rwa:%` vocabulary + burn term — genuinely zero
invariants.js change; everything else is out-of-band real-value accounting with zero
`transactions` rows), **allocated ≤ held holds by construction** (claims clamp under the
per-ticker `FOR UPDATE`; all quantities on the round6 grid), the lock discipline is acyclic
(chars → accounts → reserve leaf), the daily bucket is clobber-safe (`vault_used/vault_at`
outside `persistAccount`'s named columns, written under the held account lock) and conservative
(gated on the ask, advanced by the smaller actual charge), and death survival is proven.

- Lens A: reserve accounting / §10.4 / concurrency
- Lens B: economic exploits / Sybil / the wall / cross-system

## Fixed in-commit (regression each)

### B-F1 (MED) — a claim could burn $OMR for ZERO units at an extreme unit price
`wanted = round6(amt/omrPerUnit)` floors to 0 when the ask is under the round6 grid
(`omrPerUnit > amt × 2×10⁶`) — then `units = 0`, the clamp branch doesn't fire (`0 < 0` false),
and the FULL amount burned for a 0-unit row. Reachable via a typo'd buy price, or legitimately on
mainnet (cheap $OMR × an expensive unit). **Fix:** `if (!(units > 0)) throw 'amount'` before any
$OMR moves. Regression: a 5-$OMR ask at a 5×10⁸-$OMR unit is refused with not a single $OMR moved.

### A-F3 (MED) — unbounded `priceEth` could reprice (and sweep) the whole float
Every buy overwrites `last_price_eth` for the ENTIRE float, and the claim prices off it — with no
continuity bound, a dust buy at a typo'd price made all previously-bought real units claimable for
~pennies; in the degenerate `omrPerUnit → 0` edge, `wanted` went Infinite and the whole float
allocated for the `Math.max(1,…)` floor charge of **1 $OMR** (verified numerically). Blast radius
bounded by what the treasury spent (never a mint) — but an unbounded loss of the real backing.
**Fix (both halves):** a price-continuity bound on the buy (`RWA_MAX_PRICE_JUMP` 10×, the
`runVigBuyback` VIG_MAX_PRICE_JUMP twin — first buy per ticker is the unavoidable bootstrap) AND
an `omrPerUnit > 0` guard in the claim so the Infinity path can never execute. Regressions: the
fat-finger buy throws `price_sanity`; the zero-unit path is covered above.

### A-F1 / B-F2 (MED) — `/v1/mod/rwa/buy` bypassed the `modRealTxHash` gate
The route passed the caller's `txHash` raw while its siblings (`mod/fees/record`,
`mod/bond/simulate`) strip it unless `ALLOW_MOD_REAL_REVENUE=on` — so a mod comp (or leaked key)
could stamp a simulated buy `real=true`, poisoning the real-vs-simulated unit ledger that the
design makes the R3 reconciliation gate. (No revenue fabrication — buys SPEND revenue — but the
flag R3 depends on was forgeable.) **Fix:** `txHash: modRealTxHash(req)`, route parity.
Regression: a mod buy carrying a txHash records `real=false`.

### A-F2 / B-F6 (MED) — the cross-ticker budget race
The global `spend ≤ revenue` budget was read under only a per-TICKER row lock — two concurrent
buys on different tickers could each read the full unspent budget and together overspend revenue
(self-surfacing: the invariant goes red, never silent; mod/single-bot seat). **Fix:** a
txn-scoped `pg_advisory_xact_lock` serializes the budget read across tickers (the `runWageEpoch`
advisory-lock precedent; real Postgres only — pg-mem is single-caller).

### B-F5 (LOW-MED) — the fee split summed unvalidated
`VIG_BPS` (60%) + `FEE_RWA_BPS` (10%) book each real fee into two independently-capped revenue
buckets; a misconfig summing past 100% would let combined ETH spend exceed ETH received while
BOTH per-bucket invariants stayed green. **Fix:** a load-time assert
`VIG_BPS + FEE_RWA_BPS ≤ 10000` (the BONDS/STORE sum-validation precedent).

### A-LOW / B-F8 — buyback first-touch race surfaced raw
A two-first-touch `rwa_reserve` INSERT race (23505) or lock cycle (40P01) in the mod buyback
threw a raw 500 (the claim path was already covered by `withCharacter`'s `deadlockToRetry`).
**Fix:** mapped to the clean retryable `contention` error (the world_npcs/auction F1 posture).

Plus a coverage gap closed: the **FEE_RWA_BPS fee slice now has an end-to-end test** — a real
1-ETH `recordFeePayment` books exactly 0.1 ETH into `rwa_revenue(source='fee')`, and a
re-delivered event books it exactly once.

## Flagged for founder sign-off (NOT patched — ground rule #1; all mainnet-gate items)

1. **The stale-oracle free option (B-F3)** — the claim price is frozen at the last buy's
   `price_eth` × the latest Vig TWAP; between buybacks the real token/$OMR move, so on mainnet a
   claimer holds a free option against the treasury. Moot pre-mainnet. Dials: refresh the price
   from the oracle at claim time, a repricing bot, a `PREMIUM_BPS` spread (the PLEX precedent).
   **This is the #1 economics item to resolve before the real bot switches on.**
2. **Minted-only claims (B-F4)** — `claimVaulted` has no `minted` gate. Two independent reasons
   to add one: the Street Wage D1 precedent (every claiming identity should cost the 0.01-ETH
   mint fee, blunting Sybil multiplication of the daily cap via cash-funnel → alt-swap → claim),
   and R3 dead allocation (units claimed by never-to-identity verification alts permanently shrink the claimable
   float, since nothing ever decrements `rwa_vault`). Recommended; one-line gate when signed.
3. **First-come sniping (B-F7)** — claims are FCFS and agents are first-class; a bot ring takes
   most of a small float within seconds of a buyback. Fair-priced it's a race to pay fair value;
   compounded with #1 it's a race to the free option. Dials: per-buyback per-account unit cap, a
   claim window with pro-rata fill, minted-only claims (#2), unannounced buyback timing.
4. **R3 precondition (recorded):** `rwa_vault` rows carry no per-row real/simulated attribution —
   only the aggregate `realUnits` vs `simulatedUnits` gap is knowable. Before ANY extraction
   ships, simulated units must be reconciled/zeroed against actual Safe holdings; the invariant
   view exists to make that gap visible, never hidden.
5. **Cosmetic:** the founder revenue dashboard's `rwaSpent` (all buys) vs `rwaEth` (Store-sourced
   only) can read spent > earmarked once fee revenue funds buys — confusing, not a leak;
   `runRwaInvariants` (spend ≤ TOTAL revenue) is the real guard.

## Remaining coverage notes (non-blocking)
Concurrent same-ticker claims (the reserve-row lock design is correct; pg-mem can't exercise it —
the real-Postgres concurrency-pass precedent applies when one next runs).
