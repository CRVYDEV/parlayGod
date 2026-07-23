# CLAUDE.md — omerta-contracts

Solidity suite for OMERTÀ on Robinhood Chain. Rules for future sessions:
1. `forge test` must pass after every change; new behavior needs new tests (happy path + every revert).
   **The suite IS runnable in the sandboxed build environment**: `./run-forge-test-sandboxed.sh`
   (forge from the official npm dist, forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim —
   same compiler version+commit as native). First executed 2026-07-23: **73/73 green** incl. both
   512-run fuzzes. On an open-internet machine prefer `./run-forge-test.sh` (native toolchain).
   Test-authoring footgun that run caught: NEVER put `_sign(...)`/any external call inline in the
   arguments of a call guarded by `vm.prank`/`vm.expectRevert` — argument evaluation makes a
   staticcall (e.g. `hashQuote`) that consumes the cheatcode. Hoist `bytes memory sig = _sign(...)`
   above the cheatcodes.
2. NOTHING MINTS VALUE: VoucherClaim transfers pre-funded OMR only (bounded by tranche + daily cap); GearVault mints only via VoucherClaim AND enforces its OWN per-gearId lifetime supply cap at the asset layer (`GearVault.cap`/`minted` + `setGearCap`, fail-closed at 0) — the cap survives a minter swap because the count lives on the durable asset, not the swappable bridge (audit G-MED-1; VoucherClaim keeps a matching `gearSupplyCap` pre-flight for a clean revert, but GearVault is the authoritative bound); Staking pays only from its funded pool; OmertaFees mints/holds nothing — it forwards each exact fee straight to the dev wallet in the same tx and emits a nonce'd event; OmertaBond transfers pre-funded OMR only (bounded by `committedOMR + payout <= omr.balanceOf(this)`, enforced at bond time) and forwards each bond's ETH split in-tx (custodies no ETH) — `sweep` can pull only the UNCOMMITTED tranche, never OMR backing outstanding bonds. Preserve these invariants and their fuzz/regression tests. Do NOT raise `MAX_DISCOUNT_BPS`, remove the tranche cap, or make `polBps` mutable (on-chain/off-chain drift) — audit-surface decisions for humans; keep `polBps`/`MAX_DISCOUNT_BPS` in lockstep with the backend `BONDS.*`.
3. No hardcoded chainIds/addresses — env-driven; Arbitrum One/Base are fallback targets.
4. M6-B lives in the backend at the repo root (src/, test/…) — the chain service on viem. The signing snippet in README here must stay in exact parity with VOUCHER_TYPEHASH.
5. Do not raise MAX_APY_BPS, remove the daily cap, remove the per-gearId gear cap (gear is fail-closed by design), or add owner mint paths — these are audit-surface decisions for humans.
6. OMR carries a founder-directed DEX SELL TAX: flat, owner-armed, applies ONLY to transfers into registered `ammPairs`, split 50/50 dev/buyback in-transfer, default 0. Do NOT raise `MAX_SELL_TAX_BPS` (10% hard cap — the anti-rug/anti-honeypot wall), tax buys or wallet transfers, or remove the exempt list (protocol flows must move 1:1). Canonical liquidity must be Uniswap V2-COMPATIBLE (V3 rejects fee-on-transfer tokens) — a deploy-time requirement in CHAIN-DEPLOY.md.
