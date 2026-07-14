// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title OMR — OMERTÀ's utility token.
/// @notice Fixed supply, minted once to the treasury Safe. No owner, no mint
///         function, no pause: the token itself is inert by design. All game
///         logic lives in VoucherClaim / OMRStaking, which merely hold OMR.
contract OMR is ERC20Permit {
    uint256 public constant SUPPLY = 100_000_000e18;

    constructor(address treasurySafe) ERC20("OMERTA", "OMR") ERC20Permit("OMERTA") {
        require(treasurySafe != address(0), "OMR: zero treasury");
        _mint(treasurySafe, SUPPLY);
    }
}
