// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FlashGuard} from "./FlashGuard.sol";
import {Denari} from "./Denari.sol";

/// @title Transmuter — 1:1 redemption, the buffer floor, and the only burn authority
/// @notice Design: `omerta-bank-protocol-design.md` §2.4, answering Runtime Verification's finding
///         #2 against Alchemix (the 1:1 promise must survive the backing losing value).
///
///         ── THE PROMISE, AND THE FOUR THINGS THAT KEEP IT ────────────────────────────────────
///         One DNR redeems for one dollar of underlying. Always, or the peg is a suggestion.
///           1. **Denomination matching** (§2.1) removes the price leg of RV's risk before it
///              starts — the collateral behind this token is the same unit as the debt.
///           2. **A hard buffer floor.** `bufferHealthy()` is false when reserves fall below
///              `BUFFER_FLOOR_BPS` of outstanding supply, and the Alchemist refuses to ISSUE while
///              it is false. **The protocol stops issuing before it stops paying** — that ordering
///              is the whole point and it is why the floor gates minting, not redemption.
///           3. **Flow limits** so one block cannot drain the queue.
///           4. The fuzzed supply-vs-collateral invariant, enforced in the Alchemist.
///
///         ── WHY REDEMPTION IS NOT SAME-BLOCK GUARDED, DELIBERATELY ───────────────────────────
///         `FlashGuard`'s L1 is absent from `redeem()` ON PURPOSE. Somebody who flash-loans to buy
///         DNR at 0.98 and redeems it here at 1.00 is REPAIRING OUR PEG at their own gas risk.
///         Blanket-blocking atomicity would disable the mechanism that keeps the peg honest — the
///         guards attach where atomicity creates an advantage, never where it creates a service.
///
///         Flow caps still apply, and they are a different tool: a cap bounds the SIZE of a drain
///         without forbidding the arbitrage. Do not "harden" this by adding `notSameBlockAsEntry`
///         to `redeem` — that would trade a live peg defense for a guard against nothing.
///
///         ── ACCOUNTING ───────────────────────────────────────────────────────────────────────
///         Reserves are tracked in a VARIABLE, never `asset.balanceOf(this)` (FlashGuard L7). A
///         direct token transfer to this contract is therefore ignored rather than credited, so a
///         donation cannot move the redemption rate or fake buffer health. Someone who wants to
///         strengthen the buffer calls `fund()`.
///
///         ── ⚠ DEPLOY REQUIREMENT: THE BUFFER MUST BE SEEDED, OR THE MARKET BRICKS ────────────
///         Found by this contract's own suite before any deployment, and it is not obvious:
///
///           • at zero supply `requiredBuffer()` is zero, so the FIRST borrow always passes;
///           • the instant supply is non-zero the floor demands real backing;
///           • reserves are fed only by `repay()` and `harvest()`, which require existing debt.
///
///         So an unseeded market accepts exactly one borrow and then refuses every further mint
///         until somebody repays — a deadlock that looks like a healthy config. The launch
///         sequence must therefore be: `setFunder(safe, true)` → `fund(seed)` → arm the Alchemist.
///         `test_an_unseeded_market_bricks_after_one_borrow` pins the failure so the requirement
///         cannot be quietly dropped from a deploy script.
///
///         This is deliberately NOT fixed by exempting early borrows in code. An exemption is a
///         window in which the protocol issues claims it cannot honour, which is the exact
///         ordering §2.4 exists to forbid; requiring real backing up front is the honest version.
contract Transmuter is Ownable2Step, ReentrancyGuard, FlashGuard {
    using SafeERC20 for IERC20;

    /// @notice Compile-time floor on the buffer floor. The Safe may set the floor ANYWHERE AT OR
    ///         ABOVE this; it can never configure the protocol to back claims more thinly than
    ///         this, even with a stolen key. The OmertaBond `MAX_DISCOUNT_BPS` discipline.
    uint16 public constant MIN_BUFFER_FLOOR_BPS = 500; // 5%
    uint16 public constant BPS = 10_000;

    Denari public immutable debtToken;
    IERC20 public immutable asset;
    /// @dev 10^(18 - assetDecimals). DNR is 18dp; USDC is 6dp. A 1:1 redemption across a decimal
    ///      mismatch is a classic silent-loss bug, so the scale is computed once at construction
    ///      from the token itself rather than passed in and trusted.
    uint256 public immutable scale;

    /// @notice Underlying held to honour redemptions, in asset units. Never `balanceOf`.
    uint256 public reserves;
    /// @notice Buffer floor, in bps of outstanding DNR supply.
    uint16 public bufferFloorBps = 2_000; // 20%

    /// @notice Redemption flow caps, in asset units. Zero disables a cap (see FlashGuard._meter).
    uint256 public redeemPerBlockCap;
    uint256 public redeemPerDayCap;
    Flow private _redeemFlow;

    /// @notice Addresses permitted to `fund()` — the Alchemist for this market.
    mapping(address => bool) public funder;

    event Funded(address indexed from, uint256 assets);
    event Redeemed(address indexed who, uint256 debtIn, uint256 assetsOut);
    event BufferFloorSet(uint16 bps);
    event RedeemCapsSet(uint256 perBlock, uint256 perDay);
    event FunderSet(address indexed who, bool allowed);

    error NotFunder();
    error FloorTooLow();
    error ZeroAmount();
    error InsufficientReserves();

    constructor(Denari debtToken_, IERC20 asset_, address safe) Ownable(safe) {
        debtToken = debtToken_;
        asset = asset_;
        uint8 d = IERC20Metadata(address(asset_)).decimals();
        require(d <= 18, "asset decimals > 18");
        scale = 10 ** (18 - d);
    }

    // ── admin ────────────────────────────────────────────────────────────────────────────────────

    function setFunder(address who, bool allowed) external onlyOwner {
        funder[who] = allowed;
        emit FunderSet(who, allowed);
    }

    function setBufferFloorBps(uint16 bps) external onlyOwner {
        if (bps < MIN_BUFFER_FLOOR_BPS) revert FloorTooLow();
        bufferFloorBps = bps;
        emit BufferFloorSet(bps);
    }

    function setRedeemCaps(uint256 perBlock, uint256 perDay) external onlyOwner {
        redeemPerBlockCap = perBlock;
        redeemPerDayCap = perDay;
        emit RedeemCapsSet(perBlock, perDay);
    }

    /// @notice Allow an integrator contract to call `redeem`. EOAs always may (FlashGuard L2).
    function setAllowedContract(address who, bool allowed) external onlyOwner {
        _allowedContract[who] = allowed;
    }

    // ── the buffer ───────────────────────────────────────────────────────────────────────────────

    /// @notice Underlying required, in asset units, to consider the buffer healthy.
    function requiredBuffer() public view returns (uint256) {
        return (debtToken.totalSupply() * bufferFloorBps) / BPS / scale;
    }

    /// @notice False halts ISSUANCE in the Alchemist. It never halts redemption — see the header.
    function bufferHealthy() external view returns (bool) {
        return reserves >= requiredBuffer();
    }

    /// @notice Add underlying backing. Called by the Alchemist on repay/harvest.
    function fund(uint256 assets) external nonReentrant {
        if (!funder[msg.sender]) revert NotFunder();
        if (assets == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), assets);
        reserves += assets;
        emit Funded(msg.sender, assets);
    }

    // ── redemption ───────────────────────────────────────────────────────────────────────────────

    /// @notice Burn `debtAmount` DNR (18dp) for the same value of underlying (asset dp), 1:1.
    /// @dev    Checks-effects-interactions: reserves fall and the burn happens before the transfer
    ///         out, and `nonReentrant` backstops it. The burn is of THIS contract's own balance
    ///         after pulling the tokens in — see Denari.burn's note on why that matters.
    /// @dev    **No `onlyAllowedCaller` here, and that absence is deliberate.** An earlier cut of this
    ///         contract carried the L2 allowlist on this function, which contradicted its own header:
    ///         most redemption arbitrage is executed BY CONTRACTS, so an allowlist on the redeem path
    ///         would block the peg defense while claiming to protect it. The flow caps below bound a
    ///         drain without gating who may repair the peg — that is the right tool for this path.
    function redeem(uint256 debtAmount) external nonReentrant returns (uint256 assetsOut) {
        if (debtAmount == 0) revert ZeroAmount();
        // Round DOWN in the protocol's favour: a redeemer can never extract more underlying than
        // the debt they burned represents. With scale == 1 this is exact.
        assetsOut = debtAmount / scale;
        if (assetsOut == 0) revert ZeroAmount(); // dust below one asset unit would burn for nothing
        if (assetsOut > reserves) revert InsufficientReserves();

        _meter(_redeemFlow, assetsOut, redeemPerBlockCap, redeemPerDayCap);

        // effects
        reserves -= assetsOut;

        // pull the debt in, then burn our own balance (never a third party's — no allowance is
        // checked inside Denari.burn, and this is the reason that is safe)
        IERC20(address(debtToken)).safeTransferFrom(msg.sender, address(this), debtAmount);
        debtToken.burn(address(this), debtAmount);

        asset.safeTransfer(msg.sender, assetsOut);
        emit Redeemed(msg.sender, debtAmount, assetsOut);
    }
}
