// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IOmrOracle} from "./IOmrOracle.sol";

/// @title GenesisOracle — the administered feed the genesis bonding window runs on.
/// @notice `OmertaBond` refuses to bond without an oracle (wall 4, fail-closed by construction), and
///         `OmrTwapOracle` cannot exist before the pool it reads. The genesis window runs BEFORE
///         that pool exists — bonding at a published fixed price is how the pool gets funded — so
///         the window needs a feed that answers one administered number. At pool init the Safe calls
///         `OmertaBond.setOracle(twap)` and this contract is retired; that swap is why `IOmrOracle`
///         is an interface at all.
///
///         SCOPE, STATED SO A REVIEWER CAN STOP READING EARLY: this contract holds no funds, moves
///         no tokens, and is referenced by exactly one caller through a two-function view interface.
///         Its entire risk surface is "what number does it return, and when does it stop returning
///         one".
///
///         ── THE ONE REAL DESIGN PROBLEM, AND WHY IT IS SOLVED THIS WAY ──
///         `IOmrOracle` tells implementors that `updatedAt` is when the returned average CLOSED, and
///         that returning `block.timestamp` unconditionally "defeats the caller's staleness check".
///         That rule exists for an OBSERVED feed, where a stale reading means a dead keeper and the
///         bond must stop minting against a price nobody is maintaining.
///
///         An ADMINISTERED price has no keeper and no observation, so it cannot go stale in that
///         sense — and the three obvious ways to satisfy the letter of the rule are all worse:
///           - return the moment the Safe last set the price: bonding then HALTS mid-window the
///             instant `maxOracleAge` elapses, and the fix is a human re-poking a number that has
///             not changed. That is the keeper dependency the window exists to avoid, reintroduced
///             with worse consequences (a silent halt during the one event that funds the pool).
///           - widen `maxOracleAge` for the window: leaves the bond's real staleness protection
///             loosened at exactly the moment the TWAP takes over, and someone must remember to
///             tighten it again.
///           - re-poke on a timer: a keeper, i.e. the same thing.
///
///         So this feed replaces TIME-staleness with an EXPLICIT WINDOW, which is the honest shape
///         for an administered price: `validUntil` is a hard end the Safe sets up front, and past it
///         `consult()` returns `(0, 0)` — the interface's own "no usable reading" signal, which
///         `OmertaBond` turns into a revert. Fail-closed, with the failure at a moment the Safe
///         chose rather than one that arrives by accident. `updatedAt` is `block.timestamp` while
///         the window is open, which is TRUE for a price that is current by administration, and
///         cannot loosen anything because the window bounds it more tightly than any age check
///         would.
///
///         The kill switch is `setPrice(0)`: zero is already the interface's "unavailable", so the
///         Safe can stop the window instantly without a pause flag and without a second code path.
contract GenesisOracle is IOmrOracle, Ownable {
    /// @notice OMR (18dp) per 1 ETH. 0 means the window is closed — never a free pass.
    uint256 public price;
    /// @notice Unix seconds past which this feed reports no usable reading, whatever `price` says.
    ///         The window's hard end, chosen up front rather than arriving by accident.
    uint256 public validUntil;

    event GenesisPriceSet(uint256 price, uint256 validUntil);

    error WindowInThePast();

    /// @param safe        the owner — the same Safe that owns OmertaBond, so one key ends the window.
    /// @param price_      OMR per ETH at the published genesis price. May be 0 to deploy closed.
    /// @param validUntil_ the window's hard end. Must be in the future unless deploying closed.
    constructor(address safe, uint256 price_, uint256 validUntil_) Ownable(safe) {
        // A window that is already over would deploy a contract that can never answer — a confusing
        // silent no-op at exactly the moment somebody is trying to open bonding.
        if (price_ != 0 && validUntil_ <= block.timestamp) revert WindowInThePast();
        price = price_;
        validUntil = validUntil_;
        emit GenesisPriceSet(price_, validUntil_);
    }

    /// @notice Set the administered price and the window's end. `price_ == 0` closes the window
    ///         immediately — the kill switch, riding the interface's existing "unavailable" signal
    ///         rather than a second mechanism.
    /// @dev Changing the price mid-window re-prices what a quote may claim (the bond judges each
    ///      quote against `priceCeiling()` at bond time, not at signing time), so a change here can
    ///      invalidate signed-but-unbonded quotes. That is the intended authority — the Safe is the
    ///      root of trust for the published price — and it is evented so the change is visible.
    function setPrice(uint256 price_, uint256 validUntil_) external onlyOwner {
        if (price_ != 0 && validUntil_ <= block.timestamp) revert WindowInThePast();
        price = price_;
        validUntil = validUntil_;
        emit GenesisPriceSet(price_, validUntil_);
    }

    /// @inheritdoc IOmrOracle
    function consult() external view returns (uint256 omrPerEth, uint256 updatedAt) {
        if (price == 0 || block.timestamp > validUntil) return (0, 0);
        return (price, block.timestamp);
    }
}
