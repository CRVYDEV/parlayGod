# CLAUDE.md — omerta-contracts

Solidity suite for OMERTÀ on Robinhood Chain. Rules for future sessions:
1. `forge test` must pass after every change; new behavior needs new tests (happy path + every revert).
2. NOTHING MINTS VALUE: VoucherClaim transfers pre-funded OMR only (bounded by tranche + daily cap); GearVault mints only via VoucherClaim, which is fail-closed and bounded by a per-gearId supply cap; Staking pays only from its funded pool. Preserve these invariants and their fuzz/regression tests.
3. No hardcoded chainIds/addresses — env-driven; Arbitrum One/Base are fallback targets.
4. M6-B lives in the backend at the repo root (src/, test/…) — the chain service on viem. The signing snippet in README here must stay in exact parity with VOUCHER_TYPEHASH.
5. Do not raise MAX_APY_BPS, remove the daily cap, remove the per-gearId gear cap (gear is fail-closed by design), or add owner mint paths — these are audit-surface decisions for humans.
