# CLAUDE.md — omerta-contracts

Solidity suite for OMERTÀ on Robinhood Chain. Rules for future sessions:
1. `forge test` must pass after every change; new behavior needs new tests (happy path + every revert).
   **The suite IS runnable in the sandboxed build environment**: `./run-forge-test-sandboxed.sh`
   (forge from the official npm dist, forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim —
   same compiler version+commit as native). First executed 2026-07-23 (73/73); **77/77 green** after
   tokenomics v2 step 4, incl. both 512-run fuzzes. On an open-internet machine prefer
   `./run-forge-test.sh` (native toolchain).
   Test-authoring footgun that run caught: NEVER put `_sign(...)`/any external call inline in the
   arguments of a call guarded by `vm.prank`/`vm.expectRevert` — argument evaluation makes a
   staticcall (e.g. `hashQuote`) that consumes the cheatcode. Hoist `bytes memory sig = _sign(...)`
   above the cheatcodes.
2. **EXACTLY ONE THING MINTS OMR, AND IT IS BONDS.** Until tokenomics v2 step 4 (2026-07-29) the answer
   was "nothing", and that single sentence is what every prior audit of this suite rested on. The
   founder retired it (`omerta-tokenomics-v2-design.md` §4: supply becomes unbounded, bonds are the only
   mint). What replaces a fixed cap is not a promise — it is walls, and **all of them must survive
   review; none is optional**:
   - `OMR.mint()` is callable ONLY by the single `minter` address (the OmertaBond contract), set only by
     the owner and evented. There is deliberately **no owner mint**, so "the Safe was compromised" and
     "supply was inflated" stay two separate events. `minter = address(0)` (the deploy default) is
     minting OFF and doubles as a one-transaction emergency stop.
   - OmertaBond's three walls: (1) `dailyCapOMR` — with no tranche this is the entire blast radius of a
     leaked signer key, and therefore the most load-bearing number in the system (0 = unlimited, so a
     deploy that forgets it has no wall); (2) `MAX_DISCOUNT_BPS` (2000, compile-time) — a discount is a
     mint at a price; (3) `maxOmrPerEth` — the post-discount mint-RATE ceiling, **fail-closed at 0** (the
     GearVault gear-cap precedent), so forgetting it turns the product off rather than open. Read the
     contract header on why wall 3 is a rate ceiling and NOT the design's literal "accretive-only" —
     that deviation is deliberate and flagged for the third-party audit.
   - The payout is minted AT BOND TIME (not at claim), which keeps `committedOMR <= omr.balanceOf(this)`
     true at every instant — so `sweep` still cannot touch OMR backing an outstanding bond and a claim
     can never fail for want of balance.
   Everything else in the suite still mints nothing and that has NOT changed: VoucherClaim transfers
   pre-funded OMR only (bounded by tranche + daily cap); GearVault mints gear only via VoucherClaim AND
   enforces its OWN per-gearId lifetime supply cap at the asset layer (`GearVault.cap`/`minted` +
   `setGearCap`, fail-closed at 0) — the cap survives a minter swap because the count lives on the
   durable asset, not the swappable bridge (audit G-MED-1; VoucherClaim keeps a matching
   `gearSupplyCap` pre-flight for a clean revert, but GearVault is the authoritative bound); Staking
   pays only from its funded pool; OmertaFees mints/holds nothing — it forwards each exact fee straight
   to the dev wallet in the same tx and emits a nonce'd event; OmertaBond forwards each bond's ETH
   split in-tx and custodies no ETH. Preserve these invariants and their fuzz/regression tests. Do NOT
   raise `MAX_DISCOUNT_BPS`, remove the daily cap or the mint-rate ceiling, add a second mint path, or
   make `polBps`/`devBps` mutable (on-chain/off-chain drift) — audit-surface decisions for humans; keep
   `polBps`/`devBps`/`MAX_DISCOUNT_BPS` in lockstep with the backend `BONDS.*`.
3. No hardcoded chainIds/addresses — env-driven; Arbitrum One/Base are fallback targets.
4. M6-B lives in the backend at the repo root (src/, test/…) — the chain service on viem. The signing snippet in README here must stay in exact parity with VOUCHER_TYPEHASH.
5. Do not raise MAX_APY_BPS, remove either daily cap (VoucherClaim's or OmertaBond's), remove the
   per-gearId gear cap or OmertaBond's `maxOmrPerEth` (both fail-closed at 0 by design), or add an
   OWNER mint path to OMR — these are audit-surface decisions for humans. The bond mint is the one
   sanctioned exception and it goes through `minter`, never through `onlyOwner`.
6. OMR carries a founder-directed DEX SELL TAX: flat, owner-armed, applies ONLY to transfers into
   registered `ammPairs`, default 0, split **three ways in-transfer — dev / rwa / lp** (founder revenue,
   the stock float, liquidity depth), which must stay in lockstep with the backend's `SELL_TAX`
   constants (`src/rules.tail.js`) so the two layers can never disagree about where the money went. The
   remainder rule sits on the LP slice so the three shares sum to the tax EXACTLY — do not "naturalise"
   it into three independent bps divisions or a wei goes unowned. Do NOT raise `MAX_SELL_TAX_BPS` (10%
   hard cap — the anti-rug/anti-honeypot wall), tax buys or wallet transfers, or remove the exempt list
   (protocol flows must move 1:1). Canonical liquidity must be Uniswap V2-COMPATIBLE (V3 rejects
   fee-on-transfer tokens) — a deploy-time requirement in CHAIN-DEPLOY.md.
