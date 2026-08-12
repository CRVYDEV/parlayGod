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
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

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

    /// @notice THE LONGEST HALT THIS CONTRACT CAN EXPRESS. Anti-snipe is the only thing here that can
    ///         refuse a swap, and the header is explicit that a hook able to revert can halt a public
    ///         market. That objection is answered by CONSTRUCTION rather than by promise: the window
    ///         is counted from an initialization block that is already in the past, and its length is
    ///         capped at compile time — so a compromised Safe cannot extend it, cannot renew it, and
    ///         cannot re-arm it on a pool that has already opened. It expires with nobody acting.
    ///         ~200 blocks is minutes, not hours, on any chain we would deploy to.
    uint256 public constant MAX_ANTISNIPE_BLOCKS = 200;

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

    // ── the opening window (anti-snipe) ──────────────────────────────────────────────────────────
    // The launch argues nobody can dump at the bell because the 120h bond vest outlasts the 72h
    // window — but that is an argument about BONDERS. It says nothing about someone who buys in
    // block 0 and sits on it, and since the genesis price equals the LP init price by design, that
    // buyer captures the whole early move for the price of a 9% exit tax they are glad to pay.
    uint256 public antiSnipeBlocks; // 0 = off (the deploy default)
    uint256 public antiSnipeBuyBps; // extra fee on buys inside the window
    uint256 public antiSnipeMaxBuy; // largest single buy inside the window, in QUOTE. 0 = uncapped.

    /// @notice The block a pool opened, per pool. Written once, in `afterInitialize`. Never updated —
    ///         which is what makes the window non-renewable.
    mapping(PoolId => uint256) public openedAt;

    // ── surge (design §2.2) ──────────────────────────────────────────────────────────────────────
    // Scales the rate with PRICE IMPACT rather than with depth consumed, because impact is the damage
    // metric `tools/bond-dials.js` identified when it sized `dailyCapOMR` ("the damage metric that
    // matters, since a griefer need not profit"), and because measuring the price the pool actually
    // moved to needs no oracle and no conversion between L and token units.
    uint256 public surgeMaxBps; // 0 = off. The ceiling impact can drive the rate to.
    uint256 public surgeFullBps; // the impact (in bps) at which the ceiling is reached.

    /// @dev Transient slot holding the pre-swap `sqrtPriceX96`. Per-swap scratch, never state: it is
    ///      written in `beforeSwap` and read in `afterSwap` of the SAME call, so it must not survive
    ///      the transaction and must not cost a cold SSTORE on every trade.
    bytes32 private constant PRE_PRICE_SLOT = keccak256("omerta.hook.prePrice");

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
    event AntiSnipeSet(uint256 blocks_, uint256 buyBps, uint256 maxBuy);
    event SurgeSet(uint256 maxBps, uint256 fullBps);
    event PoolOpened(PoolId indexed poolId, uint256 blockNumber);

    // ── errors ───────────────────────────────────────────────────────────────────────────────────
    error HookAddressMismatch();
    error NotPoolManager();
    error HookNotImplemented();
    error BadBps();
    error ZeroAddress();
    error PoolNotAllowed();
    error NothingToSweep();
    /// @dev The opening window's two refusals. Named separately from `PoolNotAllowed` so a swapper
    ///      who hits one can tell "this pool is not for me" from "you are early and too big".
    error SnipeTooLarge();
    error SnipeExactOutput();

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

    /// @notice Arm the opening window. `blocks_ = 0` is off and is the deploy default.
    /// @dev    Setting this AFTER a pool has opened does not re-arm that pool: the window is measured
    ///         from `openedAt`, which is written once and never updated, so a pool whose opening
    ///         block is already `blocks_` in the past is permanently past its window whatever the
    ///         Safe does later. That is the property that keeps this from being a pause.
    function setAntiSnipe(uint256 blocks_, uint256 buyBps, uint256 maxBuy) external onlyOwner {
        if (blocks_ > MAX_ANTISNIPE_BLOCKS) revert BadBps();
        // The extra buy fee lives under the same compile-time cap as the sell tax. The window must
        // not become a way to charge a rate the anti-rug wall forbids everywhere else.
        if (buyBps > MAX_SELL_TAX_BPS) revert BadBps();
        if (buyBps > 0 && (devRecipient == address(0) || rwaRecipient == address(0) || lpRecipient == address(0))) {
            revert ZeroAddress();
        }
        antiSnipeBlocks = blocks_;
        antiSnipeBuyBps = buyBps;
        antiSnipeMaxBuy = maxBuy;
        emit AntiSnipeSet(blocks_, buyBps, maxBuy);
    }

    /// @notice Arm the surge. `maxBps = 0` is off and is the deploy default.
    /// @dev    `maxBps` is a CEILING WITHIN the existing cap, never an escape from it — the surge
    ///         raises the rate toward it as price impact grows, so a pool that is never moved much
    ///         is never charged more than `sellTaxBps`.
    function setSurge(uint256 maxBps, uint256 fullBps) external onlyOwner {
        if (maxBps > MAX_SELL_TAX_BPS) revert BadBps();
        // A zero `fullBps` would mean "reach the ceiling at zero impact", i.e. a flat raise wearing a
        // surge's name. Require a real ramp whenever the surge is armed.
        if (maxBps > 0 && fullBps == 0) revert BadBps();
        surgeMaxBps = maxBps;
        surgeFullBps = fullBps;
        emit SurgeSet(maxBps, fullBps);
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
        // Stamp the birth block. Written ONCE, here, and never updated anywhere — that is what makes
        // the opening window non-renewable, and it is why this is recorded rather than configured.
        PoolId id = key.toId();
        openedAt[id] = block.number;
        emit PoolOpened(id, block.number);
        _observe(key);
        return IHooks.afterInitialize.selector;
    }

    /// @notice THE OPENING WINDOW, and the surge's price snapshot.
    ///
    /// @dev    Returns no delta and no fee override (a zero override means "use the pool's stored
    ///         fee", correct for a static-fee pool and harmless for a dynamic-fee one) — the surge is
    ///         charged in `afterSwap` with the rest of the tax, because that is where the amount that
    ///         REALLY moved is known. All this does here is refuse the two snipe shapes and record the
    ///         price to measure impact against.
    ///
    ///         This is the ONLY function in this contract that can refuse a swap, and it can only do
    ///         so for `antiSnipeBlocks` (≤ `MAX_ANTISNIPE_BLOCKS`) after a pool opens. See that
    ///         constant for why that is not a pause.
    function beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _guardOpening(key, params);

        // Snapshot for the surge. Unconditional and transient: cheaper than branching on whether the
        // surge is armed, and it must be written before the swap moves the price.
        if (surgeMaxBps > 0) {
            (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());
            bytes32 slot = PRE_PRICE_SLOT;
            assembly ("memory-safe") {
                tstore(slot, sqrtPriceX96)
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev The opening window's refusals, split out to keep `beforeSwap` readable.
    ///      Applies to BUYS only: a sell during the window is already taxed, and refusing sells would
    ///      be a honeypot — the exact thing `MAX_SELL_TAX_BPS` exists to make impossible.
    function _guardOpening(PoolKey calldata key, SwapParams calldata params) private view {
        uint256 window = antiSnipeBlocks;
        if (window == 0) return; // off — the deploy default
        uint256 opened = openedAt[key.toId()];
        // A pool that predates the stamp (impossible for a pool created against this hook, since
        // `afterInitialize` always runs) reads zero and is treated as long since open.
        if (opened == 0 || block.number >= opened + window) return;

        bool zeroIsOmr = Currency.unwrap(key.currency0) == omr;
        if (zeroIsOmr == (Currency.unwrap(key.currency1) == omr)) return; // not an OMR pool: not ours to guard
        if (params.zeroForOne == zeroIsOmr) return; // OMR is the INPUT ⇒ a sell ⇒ untouched

        // EXACT-OUTPUT BUYS ARE REFUSED OUTRIGHT, and this is the load-bearing half of the cap rather
        // than an extra. A cap on the quote spent is trivially circumvented by naming the OMR you
        // want and letting the router work out the input — so a cap without this is not a cap.
        if (params.amountSpecified > 0) revert SnipeExactOutput();

        uint256 cap = antiSnipeMaxBuy;
        if (cap == 0) return; // fee-only window: legitimate, and the default when no size is set
        // Exact input: `amountSpecified` is negative and denominated in the input, which for a buy is
        // the QUOTE currency. That is the number the cap is written in.
        if (uint256(-params.amountSpecified) > cap) revert SnipeTooLarge();
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
        bool zeroIsOmr = Currency.unwrap(key.currency0) == omr;
        // Defensive: `beforeInitialize` already guarantees exactly one side is OMR, and a pool that
        // predates this hook cannot exist (the hook is part of the PoolKey). Belt-and-braces.
        if (zeroIsOmr == (Currency.unwrap(key.currency1) == omr)) return (feeCurrency, 0);

        // A SELL is OMR flowing IN. `zeroForOne` means currency0 is the input.
        bool isSell = params.zeroForOne == zeroIsOmr;

        // BUYS ARE FREE, except inside the opening window — and even there the rate is windowed
        // rather than permanent. The permanent buy-side rate the four-slice resolution calls for is
        // deliberately NOT this (design §3): it is an economic surface with a fourth recipient, and it
        // should not arrive smuggled in behind a launch guard.
        uint256 rate = isSell ? _sellRate(key) : _openingBuyRate(key);
        if (rate == 0) return (feeCurrency, 0);

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

    /// @dev The sell rate: the flat base, raised toward `surgeMaxBps` by the PRICE IMPACT this swap
    ///      actually caused. Impact is measured, not modelled — the pre-swap `sqrtPriceX96` was
    ///      stashed in transient storage by `beforeSwap`, and the post-swap price is read here — so
    ///      there is no oracle, no liquidity math, and nothing for a manipulated feed to loosen.
    ///      The result can only ever sit BETWEEN `sellTaxBps` and `surgeMaxBps`, both of which the
    ///      Safe set under `MAX_SELL_TAX_BPS` — the anti-rug wall binds the surge by construction.
    function _sellRate(PoolKey calldata key) private view returns (uint256) {
        uint256 base = sellTaxBps;
        uint256 ceil = surgeMaxBps;
        if (ceil <= base) return base; // surge off, or configured at/below base: flat

        bytes32 slot = PRE_PRICE_SLOT;
        uint256 pre;
        assembly ("memory-safe") {
            pre := tload(slot)
        }
        if (pre == 0) return base; // no snapshot (surge armed mid-tx?) — charge the base, never guess

        (uint160 postX96,,,) = StateLibrary.getSlot0(poolManager, key.toId());
        uint256 post = uint256(postX96);
        if (post == 0) return base;

        // |Δ sqrtPrice| / sqrtPrice, in bps. sqrtPrice moves ~half as much as price for small moves,
        // which is fine: `surgeFullBps` is a Safe-set lever calibrated against THIS measure, and a
        // consistent measure beats a converted one on a mint-adjacent path.
        uint256 diff = post > pre ? post - pre : pre - post;
        uint256 impactBps = (diff * 10000) / pre;
        if (impactBps >= surgeFullBps) return ceil;
        return base + ((ceil - base) * impactBps) / surgeFullBps;
    }

    /// @dev The opening window's buy fee. Zero — the permanent state — outside the window, when the
    ///      window is off, and when the window carries no fee (a size-cap-only configuration).
    function _openingBuyRate(PoolKey calldata key) private view returns (uint256) {
        uint256 window = antiSnipeBlocks;
        if (window == 0) return 0;
        uint256 opened = openedAt[key.toId()];
        if (opened == 0 || block.number >= opened + window) return 0;
        return antiSnipeBuyBps;
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
