// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  REFERENCE ONLY — NOT COMPILED, NOT AUDITED, NOT DEPLOYED.
//
//  This file lives in omerta-contracts/reference/ ON PURPOSE: tools/compile-contracts.js globs
//  omerta-contracts/src/*.sol only, so this contract is deliberately OUTSIDE the verified compile
//  path. It does NOT masquerade as one of the shipped, compiled-clean contracts.
//
//  It is the audit-ready DRAFT of the afterSwap→Vig fee hook described in
//  omerta-uniswap-hooks-design.md §2. To build & test it for real you need a toolchain this
//  environment does not have (Foundry's GitHub-release binaries are egress-blocked here) plus the
//  Uniswap v4 dependency tree, and — the load-bearing part — a MINED hook address:
//
//    • deps: @uniswap/v4-core + @uniswap/v4-periphery (BaseHook, IPoolManager, PoolKey, BalanceDelta,
//      Currency, Hooks, the flash-accounting `take`/`settle` surface).
//    • hook-address mining: a v4 hook's PERMISSION BITS are encoded in the low bits of its ADDRESS.
//      A hook that implements afterSwap MUST be deployed (via CREATE2) to an address whose flag bits
//      match `getHookPermissions()`, or PoolManager rejects it at initialize. That is a Foundry
//      deploy-script concern (HookMiner), unrepresentable and unverifiable in this backend repo.
//
//  Everything the OFF-CHAIN side needs is already built, dormant, and TESTED against a mock:
//    • the watcher stream  → src/watcher.js  (syncTradeFees, stream 'trades', TRADE_FEE_HOOK_ADDRESS)
//    • the revenue rail    → src/vig.js      (recordTradeFee → recordVigRevenue source='trade')
//    • the split invariant → src/vig.js      (runVigInvariants: spend ≤ revenue absorbs 'trade')
//    • regression tests    → test/watcher.js (confirmation-depth, backfill, cursor, idempotency)
//                            test/vig.js     (split / idempotency / §10.4 / buyback / invariant)
//
//  The pre-mainnet gate for THIS contract (over and above the standing forge-test + third-party
//  audit gate on the whole suite): run `forge test` on it with a mined hook address, then include
//  it in the third-party audit. Keep every constant in lockstep with the backend (VIG_BPS ==
//  vigBps, HOOK_FEE_BPS == the pool's configured fee) exactly as OmertaFees/OmertaBond do.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// v4 imports (illustrative — resolve against @uniswap/v4-core + @uniswap/v4-periphery in the real build):
//   import {BaseHook} from "@uniswap/v4-periphery/src/base/hooks/BaseHook.sol";
//   import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
//   import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
//   import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
//   import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
//   import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @title OmertaTradeFeeHook — the afterSwap→Vig fee hook (§2 of the Uniswap design).
/// @notice A Uniswap v4 hook on the OMR/ETH pool. On every swap it skims `feeBps` of the swap's
///         ETH leg, forwards it to the Vig wallet in the SAME tx (the OmertaFees forward-to-wallet
///         pattern — this contract custodies nothing and mints nothing), and emits a monotonic-nonce
///         `TradeFeePaid(nonce, amountWei)` the backend watcher ingests as source='trade' Vig revenue.
///         So every secondary-market trade of extracted $OMR funds the redistribution pool —
///         "traders fund earners." It never touches $OMR SUPPLY (fixed, minted nowhere), only takes
///         a fee on the ETH side of a trade.
///
///         SECURITY POSTURE mirrored from OmertaFees:
///           • exact-fee metered take, monotonic nonce (off-chain idempotency key);
///           • forward-in-tx, custody NOTHING (CEI + nonReentrant);
///           • Safe-owned; feeBps / feeWallet owner-settable within a hard `MAX_FEE_BPS` cap;
///           • pausable — a paused hook takes 0 fee and MUST NOT revert (a reverting afterSwap
///             would BRICK the pool / halt trading — see design §2 risk 5). Pausing degrades to a
///             no-op fee, never a revert.
///           • the fee wallet MUST accept ETH; unlike OmertaFees a forward FAILURE here degrades to
///             "skip the skim, don't revert" for the same anti-brick reason (a griefed wallet costs
///             the Vig a fee, it must never halt the pool). The Safe rotates a bad wallet.
///
///         NOTE: `BaseHook`/`IPoolManager`/`PoolKey`/`BalanceDelta`/`Currency` are shown as opaque
///         placeholders below so this file reads without the v4 tree. The real override signature is
///         the standard v4 afterSwap; wire the ETH-leg delta out of `BalanceDelta` per v4-core.
abstract contract BaseHookPlaceholder {
    // In the real build this is @uniswap/v4-periphery BaseHook (holds the immutable poolManager,
    // exposes onlyPoolManager, and validates the mined hook address against getHookPermissions()).
    function afterSwapSelector() internal pure returns (bytes4) {
        return bytes4(keccak256("afterSwap(address,bytes,bytes,int256,bytes)"));
    }
}

contract OmertaTradeFeeHook is BaseHookPlaceholder, Ownable2Step, ReentrancyGuard {
    /// @notice Where the skimmed ETH (the Vig share) is forwarded. Owner (Safe) can rotate it.
    address payable public feeWallet;
    /// @notice The skim, in basis points of the swap's ETH leg. Owner-settable, hard-capped.
    uint256 public feeBps;
    /// @notice A hard ceiling on `feeBps` — an audit backstop so a compromised owner can't tax
    ///         trades arbitrarily (the OmertaBond MAX_DISCOUNT_BPS pattern). IMMUTABLE.
    uint256 public constant MAX_FEE_BPS = 100; // 1.00% ceiling
    /// @notice When paused the hook skims 0 and emits nothing — but NEVER reverts (anti-brick).
    bool public paused;
    /// @notice Monotonic id stamped on every skim — the off-chain idempotency key (source+ref).
    uint256 public nonce;

    /// @dev The watcher's event. `amountWei` is the ETH skimmed; the backend books its Vig share as
    ///      recordVigRevenue(source='trade', ref=nonce, amountWei) — VIG_BPS applied off-chain, in
    ///      EXACT parity with how OmertaFees revenue is split. Real-only: the ONLY producer of
    ///      source='trade' revenue is this log, observed by the watcher (no mod fabrication route).
    event TradeFeePaid(uint256 indexed nonce, uint256 amountWei);
    event FeeWalletChanged(address indexed wallet);
    event FeeBpsChanged(uint256 feeBps);
    event PausedSet(bool paused);
    event SkimSkipped(uint256 indexed nonce, uint256 amountWei); // forward failed / degraded, pool unharmed

    error ZeroAddress();
    error BadBps();

    constructor(address owner_, address payable feeWallet_, uint256 feeBps_) Ownable(owner_) {
        if (feeWallet_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert BadBps();
        feeWallet = feeWallet_;
        feeBps = feeBps_;
        emit FeeWalletChanged(feeWallet_);
        emit FeeBpsChanged(feeBps_);
    }

    // ── the v4 hook surface (real signature in the built version) ──
    //
    // function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
    //     p.afterSwap = true;                 // only afterSwap — keeps the mined-address flag bits minimal
    // }
    //
    // function afterSwap(
    //     address,                            // sender (the router)
    //     PoolKey calldata key,
    //     IPoolManager.SwapParams calldata,
    //     BalanceDelta delta,
    //     bytes calldata
    // ) external override onlyPoolManager nonReentrant returns (bytes4, int128) {
    //     // Derive the ETH-leg amount this swap moved from `delta` (the token that IS native ETH in
    //     // this OMR/ETH pool). feeBps of it is the skim. Use v4 flash-accounting take/settle to pull
    //     // the skim from the PoolManager to `feeWallet` inside the swap's settlement — NEVER hold it.
    //     uint256 ethLeg = _ethLegAmount(key, delta);
    //     _skim(ethLeg);
    //     return (BaseHook.afterSwap.selector, 0); // 0 hook-delta: we take from the manager, not the trader’s output
    // }

    /// @dev The core, toolchain-independent logic, factored out so it CAN be reasoned about /
    ///      unit-tested here: compute the skim, forward it, emit the nonce'd event. Pausing and a
    ///      failed forward BOTH degrade to a no-op (emit SkimSkipped) rather than revert — a
    ///      reverting afterSwap halts the pool (design §2 risk 5). `ethLeg` is supplied by the v4
    ///      afterSwap override above.
    function _skim(uint256 ethLeg) internal {
        if (paused || feeBps == 0 || ethLeg == 0) return;
        uint256 fee = (ethLeg * feeBps) / 10000;
        if (fee == 0) return;
        uint256 n = ++nonce;                          // effect before interaction (CEI + guard)
        (bool ok, ) = feeWallet.call{value: fee}("");
        if (!ok) { emit SkimSkipped(n, fee); return; } // anti-brick: a bad wallet costs a fee, never trading
        emit TradeFeePaid(n, fee);                     // the watcher's source='trade' event
    }

    // ── owner (Safe) admin — mirrors OmertaFees ──
    function setFeeWallet(address payable wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        feeWallet = wallet;
        emit FeeWalletChanged(wallet);
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert BadBps();
        feeBps = bps;
        emit FeeBpsChanged(bps);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Rescue ETH that lands here outside the skim path (the skim forwards in-tx and leaves
    ///         nothing). Routes to owner() (the Safe), NOT feeWallet — the OmertaFees.sweep pattern.
    function sweepETH() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = payable(owner()).call{value: bal}("");
            require(ok, "sweep failed");
        }
    }

    receive() external payable {} // v4 flash-accounting settlement may transiently route ETH here
}
