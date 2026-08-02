// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";

/// @notice The seam the hook-native oracle (omerta-v4-hook-design.md §5, sequencing step 3) plugs
///         into. It exists NOW, unused, because THIS HOOK'S PERMISSION SET AND LOGIC ARE BOTH
///         IMMUTABLE: a callback the roadmap needs later cannot be added later. See the header note
///         "what an immutable hook must ship on day one".
interface IOmrHookObserver {
    /// @param key the pool the observation belongs to. The observer reads price state off the
    ///        PoolManager itself, so the hook stays thin and every line of oracle logic — including
    ///        the both-sided window bound and the fail-closed rule the oracle audit established —
    ///        lives in the contract that gets audited as an oracle.
    function observe(PoolKey calldata key) external;
}

/// @title OmertaHook — the OMR sell tax, taken inside the swap, in the currency it is spent in.
///
/// @notice Replaces `OMR.sol`'s `_update` transfer tax (economy v3 §9.6 / omerta-v4-hook-design.md).
///         Same economics — dev / rwa / lp, same rates, same hard cap, same remainder rule — but
///         charged by a Uniswap v4 hook rather than by the token.
///
///         ── WHY THIS EXISTS (the flaw it fixes) ──────────────────────────────────────────────
///         The ERC-20 tax collects **OMR**, and every downstream consumer needs **ETH**. Paying the
///         founder, funding the treasury or deepening liquidity all require SELLING that OMR — and
///         each of those sales is itself sell pressure on the very pool being taxed. The tax was
///         reflexive: we taxed a sell, then sold to realise the tax. A v4 hook charges its fee
///         inside the swap and can charge it in EITHER currency, so pointing it at the quote side
///         makes the three slices arrive as ETH already. The bracketed step disappears.
///
///         ── WHAT IS TAXED, EXACTLY ───────────────────────────────────────────────────────────
///         A SELL (OMR in, quote out) — the swap-direction expression of the old `ammPairs[to]`
///         semantics. **BUYS ARE FREE**, as they are today.
///
///         The fee lands in `afterSwap`, on the UNSPECIFIED currency, which is what v4 lets a hook
///         take there. That has one consequence worth stating plainly rather than burying:
///
///           - **exact-input sell** (what every router and aggregator produces for a sell): the
///             unspecified currency is the OUTPUT, so the fee is taken in the QUOTE. This is the
///             upgrade, and it is where the volume is.
///           - **exact-output sell** (the swapper names the ETH they want): the unspecified currency
///             is the INPUT, so the fee is taken in OMR — at the same rate, on the actual input
///             consumed. That is EXACTLY what the ERC-20 tax does today, so this path is at parity
///             with the status quo rather than a regression, and it is not a bypass: it is taxed,
///             just in the worse currency. Both accrue and both sweep to the same three wallets.
///
///         `afterSwap` is deliberately the charging point rather than `beforeSwap`: it sees the
///         BalanceDelta the swap actually produced, so a partially-filled swap (one that hits a
///         price limit) is charged on what really moved. `beforeSwap` would overcharge it.
///
///         ── THE PROPERTY THAT MAKES THE EVENT TRUSTWORTHY ────────────────────────────────────
///         A hook address is part of a PoolKey, so **anyone can create a pool that uses this hook**.
///         Without a gate, an attacker could stand up an (OMR, WORTHLESS) pool, swap against
///         themselves, and emit a real `SellTaxTaken` with a real transaction hash — fabricated
///         revenue wearing the one credential the backend's anti-fabrication gate trusts. So
///         `beforeInitialize` REVERTS unless one side is OMR and the other is a quote currency the
///         Safe has allowed. Every event this contract emits therefore describes a real OMR sell
///         into a real approved market, and every wei it accrues is an asset the Safe chose to hold.
///
///         ── WHAT AN IMMUTABLE HOOK MUST SHIP ON DAY ONE ──────────────────────────────────────
///         v4 encodes a hook's permissions in the low 14 bits of its ADDRESS. They cannot be
///         changed; adding a callback later means a new hook and a full liquidity migration. This
///         contract's logic is immutable too (no proxy — see the note on neutrality below), so the
///         same is true of any seam the roadmap needs. Hence two things that look unused today:
///           - `beforeSwap` / the fee-override return slot, so a dynamic-fee pool can use THIS hook
///             later. The rate ships FLAT (no override) — a fee curve is a new economic surface and
///             belongs in its own sign-off, not smuggled in with an infrastructure migration.
///           - `observer`, the oracle seam (§5). The oracle is step 3 and is its own contract with
///             its own audit surface; without this seam it could not be wired to this pool at all.
///
///         ── ANTI-RUG POSTURE, for the auditor and the token scanners ─────────────────────────
///         - `MAX_SELL_TAX_BPS` (1000 = 10%) is a COMPILE-TIME cap, mirroring `OMR.sol`. The Safe
///           can never set a confiscatory rate.
///         - The remainder rule sits on the LP slice, so dev + rwa + lp == total EXACTLY however the
///           bps divide. Two of three round down; a "natural" third slice would strand wei belonging
///           to nobody. Same discipline as `OMR.sol`, `OmertaBond` and the backend's ingest.
///         - **There is no pause.** A hook that can revert `beforeSwap` can halt a public market,
///           and that is a power this contract deliberately does not take. The off switch is
///           `setSellTax(0, 0, 0)`: the fee stops, the pool keeps trading.
///         - The fee ACCRUES here and is swept in a separate transaction. It is not pushed to three
///           external addresses mid-swap, because then any one of them reverting on receipt would
///           brick the pool. Pool liveness must not depend on a recipient's behaviour.
///         - `sweep` is permissionless and pays ONLY the Safe-set recipients. Nobody can redirect
///           it; the balance it holds is bounded by how often it is called.
///
///         ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────
///         No age-based rate. `beforeSwap`/`afterSwap` receive the ROUTER as `sender`, not the
///         person, and the documented `IMsgSender(sender).msgSender()` recovery is a courtesy a
///         router may simply not implement — a wall that stops contributing precisely when someone
///         attacks it. The 48h early-exit decay stays at the game boundary (`src/tax.js`), where the
///         account's own ledger is authoritative and unfakeable.
///
///         Pool-local enforcement is the accepted cost (design §4): anyone may open an unhooked OMR
///         pool and trade untaxed. The defence is depth (protocol-owned liquidity), backed by
///         `OMR.sol`'s transfer tax retained ARMED AT ZERO as a universal backstop.
contract OmertaHook is IHooks, Ownable {
    // ── permissions (immutable, encoded in this contract's address) ──────────────────────────────
    /// @notice The exact flag set this hook implements. The constructor refuses to deploy anywhere
    ///         that does not carry it, which is what makes the CREATE2 salt search part of the
    ///         deploy rather than an assumption. Mined deliberately WIDE (design §2.2): an unused
    ///         callback that returns its selector is nearly free; a missing one is a migration.
    uint160 public constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG // gate: only OMR / approved-quote pools may use this hook
            | Hooks.AFTER_INITIALIZE_FLAG // seed the oracle observer
            | Hooks.BEFORE_SWAP_FLAG // reserved: the dynamic-fee override slot
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG // reserved: input-side fees
            | Hooks.AFTER_SWAP_FLAG // the sell tax
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG // ...taken as a delta on the unspecified currency
    );

    /// @notice Mirrors `OMR.MAX_SELL_TAX_BPS`. Kept as a compile-time constant in BOTH contracts on
    ///         purpose: the cap must survive the migration whichever layer is charging.
    uint256 public constant MAX_SELL_TAX_BPS = 1000; // 10%

    /// @notice Gas stipend for the observer call. Bounded so a misbehaving or griefing observer can
    ///         cost a swapper a little gas but can never consume the swap's whole budget.
    uint256 public constant OBSERVER_GAS = 150_000;

    IPoolManager public immutable poolManager;
    /// @notice The taxed token. A pool is only allowed on this hook if one of its currencies is OMR.
    address public immutable omr;

    // ── configuration (Safe) ─────────────────────────────────────────────────────────────────────
    uint256 public sellTaxBps; // 0 = off (the deploy default). The TOTAL rate.
    uint256 public taxDevBps; // of the total; founder revenue
    uint256 public taxRwaBps; // of the total; the treasury
    // LP takes the remainder — never stored, so it can never disagree with the other two.

    address public devRecipient;
    address public rwaRecipient;
    address public lpRecipient;

    /// @notice Quote currencies the Safe permits to be paired with OMR on this hook. The empty map
    ///         is the deploy default, so until the Safe allows one, NO pool can be created here.
    mapping(Currency => bool) public allowedQuote;

    /// @notice Optional oracle sink (design §5). Zero = no observer, which is the deploy default.
    IOmrHookObserver public observer;

    /// @notice Fees taken and not yet swept, per currency. Three counters rather than one total, so
    ///         the split that the event reports is exactly the split that gets transferred.
    struct Owed {
        uint256 dev;
        uint256 rwa;
        uint256 lp;
    }

    mapping(Currency => Owed) public owed;

    // ── events ───────────────────────────────────────────────────────────────────────────────────
    /// @notice One per taxed swap. `sender` is the PoolManager's caller — for an ordinary trade that
    ///         is the ROUTER, not the person (see "what this does not do"). It is emitted as
    ///         telemetry, never relied on as identity.
    event SellTaxTaken(
        address indexed sender,
        PoolId indexed poolId,
        Currency indexed currency,
        uint256 total,
        uint256 dev,
        uint256 rwa,
        uint256 lp
    );
    event Swept(Currency indexed currency, uint256 dev, uint256 rwa, uint256 lp);
    event SellTaxSet(uint256 bps, uint256 devBps, uint256 rwaBps);
    event RecipientsSet(address dev, address rwa, address lp);
    event QuoteAllowed(Currency indexed currency, bool allowed);
    event ObserverSet(address observer);

    // ── errors ───────────────────────────────────────────────────────────────────────────────────
    error HookAddressMismatch();
    error NotPoolManager();
    error HookNotImplemented();
    error BadBps();
    error ZeroAddress();
    error PoolNotAllowed();
    error NothingToSweep();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    constructor(IPoolManager poolManager_, address omr_, address safe) Ownable(safe) {
        if (address(poolManager_) == address(0) || omr_ == address(0) || safe == address(0)) revert ZeroAddress();
        // The permission bits ARE the address. Deploying to an address that does not carry exactly
        // this flag set would silently give the pool a different hook contract than the one audited.
        if (uint160(address(this)) & Hooks.ALL_HOOK_MASK != HOOK_FLAGS) revert HookAddressMismatch();
        poolManager = poolManager_;
        omr = omr_;
    }

    // ── admin (the Safe) ─────────────────────────────────────────────────────────────────────────

    /// @notice Arm/tune the sell tax and how it splits. Signature mirrors `OMR.setSellTax` exactly so
    ///         the two layers stay in lockstep and neither can be tuned by habit into disagreement.
    ///         `devBps + rwaBps <= bps`; LP takes the remainder.
    function setSellTax(uint256 bps, uint256 devBps, uint256 rwaBps) external onlyOwner {
        if (bps > MAX_SELL_TAX_BPS) revert BadBps();
        if (devBps + rwaBps > bps) revert BadBps();
        if (bps > 0 && (devRecipient == address(0) || rwaRecipient == address(0) || lpRecipient == address(0))) {
            revert ZeroAddress();
        }
        sellTaxBps = bps;
        taxDevBps = devBps;
        taxRwaBps = rwaBps;
        emit SellTaxSet(bps, devBps, rwaBps);
    }

    function setRecipients(address dev, address rwa, address lp) external onlyOwner {
        if (dev == address(0) || rwa == address(0) || lp == address(0)) revert ZeroAddress();
        devRecipient = dev;
        rwaRecipient = rwa;
        lpRecipient = lp;
        emit RecipientsSet(dev, rwa, lp);
    }

    /// @notice Allow (or revoke) a quote currency for OMR pools on this hook. Revoking does not close
    ///         an existing pool — v4 pools cannot be closed — it only stops new ones being created.
    function setAllowedQuote(Currency currency, bool allowed) external onlyOwner {
        allowedQuote[currency] = allowed;
        emit QuoteAllowed(currency, allowed);
    }

    function setObserver(IOmrHookObserver observer_) external onlyOwner {
        observer = observer_;
        emit ObserverSet(address(observer_));
    }

    // ── the sweep ────────────────────────────────────────────────────────────────────────────────

    /// @notice Push accrued fees to the three wallets. Permissionless — it cannot send anywhere but
    ///         the Safe-set recipients, and keeping it open means a stalled Safe cannot strand fees.
    ///         Deliberately NOT done inside the swap: a recipient that reverts on receipt would then
    ///         brick the pool. Here it only fails this sweep, and the Safe can repoint and retry.
    function sweep(Currency currency) external {
        Owed memory o = owed[currency];
        if (o.dev == 0 && o.rwa == 0 && o.lp == 0) revert NothingToSweep();
        delete owed[currency]; // effects before interactions
        if (o.dev > 0) currency.transfer(devRecipient, o.dev);
        if (o.rwa > 0) currency.transfer(rwaRecipient, o.rwa);
        if (o.lp > 0) currency.transfer(lpRecipient, o.lp);
        emit Swept(currency, o.dev, o.rwa, o.lp);
    }

    /// @notice Native fees arrive here when the hook `take`s them out of the PoolManager.
    receive() external payable {}

    // ── hooks ────────────────────────────────────────────────────────────────────────────────────

    /// @notice THE POOL GATE. One side must be OMR; the other must be an allowed quote currency.
    ///         Without this, anyone could mint this contract's events out of a worthless pool.
    function beforeInitialize(address, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        bool zeroIsOmr = Currency.unwrap(key.currency0) == omr;
        bool oneIsOmr = Currency.unwrap(key.currency1) == omr;
        if (zeroIsOmr == oneIsOmr) revert PoolNotAllowed(); // neither side is OMR (both is impossible)
        Currency quote = zeroIsOmr ? key.currency1 : key.currency0;
        if (!allowedQuote[quote]) revert PoolNotAllowed();
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external
        onlyPoolManager
        returns (bytes4)
    {
        _observe(key);
        return IHooks.afterInitialize.selector;
    }

    /// @notice Reserved. The rate ships FLAT, so this returns no delta and no fee override (a zero
    ///         override means "use the pool's stored fee", which is correct for a static-fee pool
    ///         and harmless for a dynamic-fee one). Its flags are mined so a future dynamic-fee pool
    ///         can be created against this same hook without a new address.
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @notice THE SELL TAX. Returns a positive delta on the unspecified currency, which the
    ///         PoolManager credits to this hook and debits from the swapper; the hook then `take`s
    ///         it. Zero on a buy, on an untaxed pool, and whenever the rate is off.
    function afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        _observe(key);

        (Currency feeCurrency, uint256 total) = _fee(key, params, delta);
        if (total == 0) return (IHooks.afterSwap.selector, 0);

        _accrue(sender, key, feeCurrency, total); // effects
        poolManager.take(feeCurrency, address(this), total); // then the interaction
        return (IHooks.afterSwap.selector, int128(uint128(total)));
    }

    /// @dev Which currency the fee lands in and how much of it. Returns `total == 0` — the "charge
    ///      nothing" answer — for a buy, for an unrecognised pool, and whenever the rate is off.
    ///      Split out from `afterSwap` because the two together do not fit the EVM's stack.
    function _fee(PoolKey calldata key, SwapParams calldata params, BalanceDelta delta)
        private
        view
        returns (Currency feeCurrency, uint256 total)
    {
        uint256 rate = sellTaxBps;
        if (rate == 0) return (feeCurrency, 0);

        bool zeroIsOmr = Currency.unwrap(key.currency0) == omr;
        // Defensive: `beforeInitialize` already guarantees exactly one side is OMR, and a pool that
        // predates this hook cannot exist (the hook is part of the PoolKey). Belt-and-braces.
        if (zeroIsOmr == (Currency.unwrap(key.currency1) == omr)) return (feeCurrency, 0);

        // A SELL is OMR flowing IN. `zeroForOne` means currency0 is the input.
        if (params.zeroForOne != zeroIsOmr) return (feeCurrency, 0); // BUYS ARE FREE

        // The unspecified currency is the OUTPUT for an exact-input swap and the INPUT for an
        // exact-output one — see the header for why that is left as-is rather than forced. Derived
        // from `zeroForOne` rather than from `zeroIsOmr`: the two are equal only because of the sell
        // guard directly above, and a fee-currency derivation that silently depends on a guard three
        // lines away is a trap for whoever edits the guard.
        bool feeOnCurrency0 = params.amountSpecified < 0 ? !params.zeroForOne : params.zeroForOne;
        feeCurrency = feeOnCurrency0 ? key.currency0 : key.currency1;

        // Positive when the swapper is receiving (exact input: their output), negative when paying
        // (exact output: their input). The rate applies to the magnitude either way.
        int128 swapperDelta = feeOnCurrency0 ? delta.amount0() : delta.amount1();
        uint256 base = swapperDelta < 0 ? uint256(uint128(-swapperDelta)) : uint256(uint128(swapperDelta));
        total = (base * rate) / 10000;
    }

    /// @dev Book the three slices. The remainder rule sits on LP, so they sum to `total` exactly.
    function _accrue(address sender, PoolKey calldata key, Currency feeCurrency, uint256 total) private {
        uint256 dev = (total * taxDevBps) / sellTaxBps;
        uint256 rwa = (total * taxRwaBps) / sellTaxBps;
        uint256 lp = total - dev - rwa;

        Owed storage o = owed[feeCurrency];
        o.dev += dev;
        o.rwa += rwa;
        o.lp += lp;

        emit SellTaxTaken(sender, key.toId(), feeCurrency, total, dev, rwa, lp);
    }

    /// @dev Fail-safe by construction: a reverting or gas-hungry observer must never be able to stop
    ///      a swap. The oracle's OWN fail-closed rule is what keeps this honest — if observations
    ///      stop arriving, the oracle goes stale, `priceCeiling()` reverts, and bonds refuse. Silent
    ///      here, loud there.
    function _observe(PoolKey calldata key) private {
        IOmrHookObserver obs = observer;
        if (address(obs) == address(0)) return;
        try obs.observe{gas: OBSERVER_GAS}(key) {} catch {}
    }

    // ── unused callbacks ─────────────────────────────────────────────────────────────────────────
    // Their flags are NOT set, so the PoolManager never calls them. They revert rather than return a
    // selector so that a mis-mined address (one carrying a flag this contract does not implement)
    // fails loudly on first use instead of silently no-op'ing a permission nobody meant to grant.

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
