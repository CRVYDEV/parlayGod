# CLAUDE.md — omerta-contracts

Solidity suite for OMERTÀ on Robinhood Chain. Rules for future sessions:
1. `forge test` must pass after every change; new behavior needs new tests (happy path + every revert).
   **The suite IS runnable in the sandboxed build environment**: `./run-forge-test-sandboxed.sh`
   (forge from the official npm dist, forge-std/OZ from npm, solc via a solc-js 0.8.26 stdio shim —
   same compiler version+commit as native). First executed 2026-07-23 (73/73); **103/103 green** after
   tokenomics v2 step 4 + the accretion oracle, incl. four 512-run fuzzes. On an open-internet machine prefer
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
   - OmertaBond's FOUR walls: (1) `dailyCapOMR` — with no tranche this is the entire blast radius of a
     leaked signer key, and therefore the most load-bearing number in the system (0 = unlimited, so a
     deploy that forgets it has no wall); (2) `MAX_DISCOUNT_BPS` (2000, compile-time) — a discount is a
     mint at a price; (3) `maxOmrPerEth` — an ABSOLUTE post-discount mint-RATE ceiling, **fail-closed at
     0** (the GearVault gear-cap precedent); (4) `oracle` — the ACCRETION wall, a TWAP the signed quote's
     claimed price must agree with, also fail-closed (unset / stale / zero / reverting all revert).
   - **DO NOT "simplify" walls 3 and 4 into one.** A price feed sits on the mint path; what makes that
     safe is that the absolute ceiling is checked INDEPENDENTLY, so the effective bound is
     `MIN(maxOmrPerEth, oracle x (1+tolerance) / (1-discount))` and **a manipulated oracle can only ever
     TIGHTEN it, never loosen it**. Pushing the feed up buys an attacker nothing; pushing it down only
     halts bonding. `test_oracle_CANNOT_LOOSEN_the_static_ceiling` fails if this is ever collapsed.
   - The oracle (`OmrTwapOracle`) must be a TWAP, never spot — spot on a mint path is flash-loanable.
     `PERIOD` has a compile-time floor for that reason. `update()` is permissionless on purpose (a
     keeper-gated poke means a lost key freezes the bond product) and **must be poked at least once per
     `maxOracleAge`** or bonding halts: an operational dependency, documented in CHAIN-DEPLOY.md.
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
   make `polBps`/`devBps`/`rwaBps` mutable (on-chain/off-chain drift) — audit-surface decisions for
   humans; keep `polBps`/`devBps`/`rwaBps`/`MAX_DISCOUNT_BPS` in lockstep with the backend `BONDS.*`.
   OmertaBond's ETH split is FOUR-way (POL / dev / treasury / Vig-as-remainder) as of 2026-07-31: it
   was three-way with the backend booking four, so the fourth slice was zero on every real bond and
   BOTH bond invariants stayed green (the Vig remainder absorbed it exactly). The `rwaBps`/`rwaRecipient`
   names are historical — that slice funded a stock float until the founder retired the layer the same
   day (`omerta-stock-layer-retirement.md`); the bps and the split are unchanged, only the destination
   (a cold treasury Safe, not a stock-buy bot). Do not collapse it back;
   `rwaRecipient` is a SEPARATE key from `vigRecipient` by founder ruling — and the argument is stronger
   now, since a treasury that only ever receives has no reason to share a key with anything that spends. The remainder rule sits on
   the Vig so the four shares sum to the principal EXACTLY — do not "naturalise" it into four
   independent bps divisions or a wei goes unowned (the OMR sell-tax LP-slice precedent).
3. No hardcoded chainIds/addresses — env-driven; Arbitrum One/Base are fallback targets.
4. M6-B lives in the backend at the repo root (src/, test/…) — the chain service on viem. The signing snippet in README here must stay in exact parity with VOUCHER_TYPEHASH.
5. Do not raise MAX_APY_BPS, remove either daily cap (VoucherClaim's or OmertaBond's), remove the
   per-gearId gear cap, OmertaBond's `maxOmrPerEth` or its accretion `oracle` (all fail-closed by
   design), or add an OWNER mint path to OMR — these are audit-surface decisions for humans. The bond mint is the one
   sanctioned exception and it goes through `minter`, never through `onlyOwner`.
6. OMR carries a founder-directed DEX SELL TAX: flat, owner-armed, applies ONLY to transfers into
   registered `ammPairs`, default 0, split **three ways in-transfer — dev / rwa / lp** (founder revenue,
   the treasury — historically the stock float, retired 2026-07-31 — and liquidity depth), which must
   stay in lockstep with the backend's `SELL_TAX`
   constants (`src/rules.tail.js`) so the two layers can never disagree about where the money went. The
   remainder rule sits on the LP slice so the three shares sum to the tax EXACTLY — do not "naturalise"
   it into three independent bps divisions or a wei goes unowned. Do NOT raise `MAX_SELL_TAX_BPS` (10%
   hard cap — the anti-rug/anti-honeypot wall), tax buys or wallet transfers, or remove the exempt list
   (protocol flows must move 1:1). Canonical liquidity must be Uniswap V2-COMPATIBLE (V3 rejects
   fee-on-transfer tokens) — a deploy-time requirement in CHAIN-DEPLOY.md.
