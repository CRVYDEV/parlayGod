# CLAUDE.md — omerta-contracts

Solidity suite for OMERTÀ on Robinhood Chain. Rules for future sessions:
1. `forge test` must pass after every change; new behavior needs new tests (happy path + every revert).
   **The suite IS runnable in the sandboxed build environment**: `./run-forge-test-sandboxed.sh`
   (forge from the official npm dist, forge-std/OZ/v4-core from npm, solc native-or-shim).
   First executed 2026-07-23 (73/73); **296/296 green** after THE BANK's Denari market (né nUSD),
   `GenesisOracle`, the hook's buy side, and GearVault's on-chain metadata rail, incl. the 512-run fuzzes. The runner PREFERS the
   NATIVE solc binary and NEEDS it — the solc-js shim (same version+commit) runs out of wasm heap
   compiling v4's `PoolManager`, so on a shim-only box every suite runs EXCEPT `OmertaHook.t.sol`. On an open-internet machine prefer
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
   enforces its OWN per-gearId cap at the asset layer (`GearVault.cap`/`minted`/`redeemed` +
   `setGearCap`, fail-closed at 0) — the cap survives a minter swap because the count lives on the
   durable asset, not the swappable bridge (audit G-MED-1; VoucherClaim keeps a matching
   `gearSupplyCap` pre-flight for a clean revert, but GearVault is the authoritative bound).
   **BOTH bound LIVE on-chain supply (`minted - redeemed <= cap`), never lifetime mints, and they
   must keep measuring the SAME quantity** — a redeem (re-import) vacates exactly one slot, and the
   red team of 2026-08-16 found the bridge still holding a lifetime counter while the vault had
   moved to live supply. Fail-closed either way, nothing over-mints — which is why it was invisible:
   what it killed was the shipped re-import round trip (`omerta-nft-reimport-design.md` §4), since
   once a class had ever hit its cap a re-imported item could never be re-extracted, with every one
   of them burned back and zero live on-chain. An epic class caps at 10, so the wall was reachable
   in ordinary play. Pinned by `test_reimport_frees_a_slot_the_bridge_can_re_extract`; Staking
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
5. **ONE signer key signs FOUR self-minting contracts** (VoucherClaim, OmertaBond, StreetDeed,
   DynastyNFT), so its blast radius is the SUM of their four daily caps. All four take that cap as a
   CONSTRUCTOR argument — do not demote any of them to setter-only. `0` still means unlimited, so the
   constructor arg does not force a number; it forces a DECISION at deploy, which is exactly what was
   missing: the two NFTs were setter-only until R33 (2026-08-17), so a fresh deploy minted unbounded
   deeds and identities per day with nobody doing anything wrong, and the runbook called one of the two
   walls "optional". A wall that lives only in a deploy checklist is one a deploy can forget.
   Do not raise MAX_APY_BPS, remove any daily cap, remove the
   per-gearId gear cap, OmertaBond's `maxOmrPerEth` or its accretion `oracle` (all fail-closed by
   design), or add an OWNER mint path to OMR — these are audit-surface decisions for humans. The bond mint is the one
   sanctioned exception and it goes through `minter`, never through `onlyOwner`.
6. OMR carries a founder-directed DEX SELL TAX: flat, owner-armed, applies ONLY to transfers into
   registered `ammPairs`, default 0, split **four ways in-transfer — dev / rwa / community / lp** (founder revenue,
   the treasury — historically the stock float, retired 2026-07-31 — the family buyback (the community-buyback keeper wallet, a SEPARATE key: the custody rule), and liquidity depth), which must
   stay in lockstep with the backend's `SELL_TAX`
   constants (`src/rules.tail.js`) so the two layers can never disagree about where the money went. The
   remainder rule sits on the LP slice so the four shares sum to the tax EXACTLY — do not "naturalise"
   it into independent bps divisions or a wei goes unowned. Do NOT raise `MAX_SELL_TAX_BPS` (10%
   hard cap — the anti-rug/anti-honeypot wall), tax buys or wallet transfers, or remove the exempt list
   (protocol flows must move 1:1). Canonical liquidity must be Uniswap V2-COMPATIBLE (V3 rejects
   fee-on-transfer tokens) — a deploy-time requirement in CHAIN-DEPLOY.md, and one that DIES if the
   v4 hook (rule 7) becomes the canonical venue, since the fee then lives in the pool rather than in
   `_update`. **Keep this path anyway, armed at ZERO.** A hook tax is a property of ONE POOL and
   anyone may open an unhooked one; the token tax is universal by construction. It is the backstop
   the Safe arms if a meaningful untaxed pool appears — and the trigger is not "we lost some tax", it
   is "bonds have become an arbitrage" (design §9.6: a bonder holds known size on a known schedule
   and is the most motivated bypass-seeker OMR will have).

7. **`OmertaHook.sol` is the v4 sell tax, and it is IMMUTABLE IN BOTH SENSES** — its permissions live
   in the low 14 bits of its ADDRESS (`HOOK_FLAGS`, re-checked in the constructor, so deployment needs
   a real CREATE2 salt search) and its logic has no proxy. Consequences that are easy to get wrong:
   - **Do not remove `beforeInitialize`'s pool gate.** A hook address is part of a `PoolKey`, so
     ANYONE can create a pool naming this hook. Without the gate a stranger stands up an
     (OMR, WORTHLESS) pool, swaps against themselves, and emits a genuine `SellTaxTaken` with a
     genuine tx hash — fabricated revenue wearing the exact credential the backend's anti-fabrication
     gate trusts. The gate (one side OMR, the other a Safe-approved quote) is what makes every event
     this contract emits mean something.
   - **The fee ACCRUES and `sweep` pushes it, deliberately** — do NOT "simplify" it into an in-tx
     forward like `OmertaFees`. That precedent is right for a tollbooth and wrong here: four pushes
     inside a swap means one reverting recipient BRICKS THE POOL. Pool liveness must not depend on a
     wallet's behaviour. `sweep` is permissionless on purpose (a stalled Safe must not strand fees)
     and can only ever pay the Safe-set recipients.
   - **There is no pause, and there must not be.** A hook that can revert `beforeSwap` can halt a
     public market. The off switch is `setSellTax(0,0,0,0)` — the fee stops, the pool keeps trading.
   - The unused `beforeSwap` / fee-override slot and the `observer` seam are NOT dead code: with an
     immutable permission set and immutable logic, a callback the roadmap needs later cannot be added
     later. Removing either means the hook-native oracle (design step 3) needs a NEW HOOK and a full
     liquidity migration. `_observe` is try/catch'd with a gas stipend so a broken observer can never
     stop a swap; the oracle's own fail-closed rule is what keeps that honest.
   - `MAX_SELL_TAX_BPS` (1000) and the remainder-on-LP rule mirror `OMR.sol` exactly and must stay in
     lockstep with the backend `SELL_TAX`. **Exact-OUTPUT sells are taxed in OMR rather than the quote**
     — v4 only lets `afterSwap` take a delta on the *unspecified* currency. That is parity with the
     ERC-20 tax it replaces, it is documented in the contract, and it is not a bypass. Do not "fix" it
     by moving the charge to `beforeSwap`: that breaks partially-filled swaps, which is the reason
     `afterSwap` was chosen.
   - `DISCOUNT_BPS` must stay strictly BELOW `sellTaxBps` or a bond becomes an arbitrage rather than a
     hold (design §9.6). Asserted in `test/OmertaHook.t.sol` and warned about in the backend's
     `preflight.js` — the two constants live in different layers, so nothing else relates them.
   - **THE BUY SIDE (anti-snipe + surge, design `omerta-hook-blocks-design.md`, prompted by
     hookr.fun landing on our chain).** Both ship ARMED AT ZERO — `antiSnipeBlocks=0` and
     `surgeMaxBps=0` are byte-for-byte today's flat-tax behaviour (`test_the_surge_off_is_byte_for_byte_the_flat_tax`).
     - **The opening window is the ONLY thing in this contract that can refuse a swap, and it is not a
       pause.** Its length is capped at a COMPILE-TIME `MAX_ANTISNIPE_BLOCKS` (200), counted from
       `openedAt` (written once in `afterInitialize`, never updated). So a compromised Safe cannot
       extend it, renew it, or re-arm a pool that has already been open longer than the window — the
       branch expires by block count with nobody acting. Do not make `openedAt` writable, and do not
       raise the cap into hours. Sells are NEVER refused (a window that blocks exits is the honeypot
       `MAX_SELL_TAX_BPS` exists to forbid) — pinned by `test_sells_are_NEVER_refused_by_the_window`.
     - **The exact-output-buy refusal is load-bearing ONLY when no size cap is set** (`antiSnipeMaxBuy=0`).
       With a cap, `uint256(-amountSpecified)` for an exact-output amount underflows to a huge number
       and `SnipeTooLarge` catches it anyway — so the regression MUST test the cap==0 regime or it
       cannot tell the refusal is doing anything (the first cut tested the wrong regime and a mutation
       survived — see `test_an_exact_output_buy_is_refused_outright...`).
     - **The surge is a rate WITHIN `MAX_SELL_TAX_BPS`, never an escape from it** — the ceiling is
       Safe-set under the same compile-time cap as the base (`test_the_surge_ceiling_cannot_exceed_the_anti_rug_cap`).
       It scales with PRICE IMPACT measured off the pool's own `sqrtPrice` (pre in transient storage
       from `beforeSwap`, post in `afterSwap`) — NO oracle, so nothing for a manipulated feed to
       loosen — because impact is the damage metric `tools/bond-dials.js` sized `dailyCapOMR` on. The
       surge only ever WIDENS the `DISCOUNT_BPS < sellTaxBps` margin.
     - **The permanent four-slice buy rate is DELIBERATELY NOT this** (design §3 /
       `omerta-v4-hook-design.md:584`). The window fee is a WINDOWED buy rate that expires; a
       permanent buy tax adds a fourth recipient and is an economic surface for its own sign-off. It
       shares this audit, so if it is wanted, decide it before the batch — a second buy-side change on
       an immutable contract is a second audit.

8. **THE BANK's Denari market (`Denari` (DNR) / `CollateralEscrow` / `Alchemist` / `Transmuter`) — the
   rules that are structural, not stylistic.** Design: `omerta-bank-protocol-design.md` §2.1–2.5.
   (The debt token was founder-named **Denari / DNR** on 2026-08-13 — it was `nUSD` in every audit
   report and design note before that date; same contract, new name.)
   - **THERE IS NO ORACLE ON THE BORROW PATH, AND NO `liquidate()` ANYWHERE.** The market is
     denomination-matched (USD debt against USD collateral), so a borrow decision never reads a
     price — and a price that is never read cannot be manipulated at any size. Both Inverse losses
     (~$21M) were exactly that class. **Do not add a cross-denominated market as a parameter
     change**; it is a separate deployment with its own oracle stack and its own audit.
   - **NO POOL, THEREFORE NO SHARES.** Every depositor gets their own `CollateralEscrow` holding the
     external vault's ERC-4626 shares. The design's §5 sketch called for internal shares accounting
     to FIX Runtime Verification's finding #1 against Alchemix; escrows make that INTERNAL
     pool-division bug UNREACHABLE, which is strictly stronger, because it only exists when a pool
     must be divided. **Do not reintroduce an internal share layer** — it re-creates the bug it was
     meant to fix. What escrows do NOT delete is the SHARED external sleeve's own first-depositor /
     inflation case (audit M-1): every escrow deposits into the SAME ERC-4626 vault, so a griefer can
     donate to inflate its share price and strand a later deposit's funds (zero shares minted) while
     principal would be credited in full. `Alchemist.deposit` closes this ON-CHAIN — `deployToVault`
     returns the shares minted, and principal is credited only against value that landed (`shares > 0`
     + a round-trip slippage floor, `MAX_DEPOSIT_SLIPPAGE_BPS`). The residual expectation on the
     sleeve is that it be inflation-resistant (OZ 5.x virtual-shares, no-fee); the guard is the
     backstop if it is not, turning a bad sleeve into a clean revert rather than a stranded deposit.
     Do not remove the deposit guard or credit principal against `assets` before checking `shares`.
   - **The escrow has no sweep, no rescue, no owner withdrawal, and must not gain one.** A sweep is
     how an escrow becomes a rug vector. Tokens sent directly by mistake are lost; that is the
     correct trade for a contract whose whole job is custody.
   - **`setMinter(0)` halts issuance WITHOUT touching redemption, and that asymmetry is the point**
     (§2.4): the protocol must stop issuing before it stops paying. The buffer floor encodes the
     same ordering — it gates `mint`, never `redeem`. Do not "simplify" either into a pause that
     covers both.
   - **`Transmuter.redeem` deliberately carries NO same-block guard and NO caller allowlist.**
     Redemption arbitrage is what repairs the peg, and most of it is executed by contracts — an
     allowlist there would block the defense while claiming to be one. (An earlier cut had exactly
     that bug and the red-team caught it.) Flow caps are the right tool for that path: they bound a
     drain without gating who may repair the peg.
   - **⚠ DEPLOY: the buffer MUST be seeded before the market is armed.** At zero supply the required
     buffer is zero so the first borrow always passes; the instant supply is non-zero the floor
     demands real backing, and reserves are fed only by repay/harvest, which need existing debt. An
     unseeded market therefore takes ONE borrow and deadlocks, looking like a healthy config.
     `test_an_unseeded_market_bricks_after_one_borrow` pins it. Do not "fix" this by exempting early
     borrows — an exemption is a window in which the protocol issues claims it cannot honour.
   - **KNOWN AND ACCEPTED: a yield-vault loss breaks `Σ supply ≤ Σ collateral × LTV` and nothing
     restores it.** Denomination matching removes price risk, not sleeve risk (§2.6). There is no
     liquidation by design, so the answer to a bad sleeve is "stop issuing, honour what is backed" —
     which is what the buffer floor does. Pinned by
     `test_a_vault_loss_breaks_the_invariant_and_the_protocol_stops_issuing`. Anyone proposing a
     liquidation path is proposing to reintroduce the oracle class above.
