// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title nUSD — the debt token of THE BANK's USD market
/// @notice Design: `omerta-bank-protocol-design.md` §2.1 / §5.
///
///         ── WHAT THIS TOKEN IS ────────────────────────────────────────────────────────────────
///         A borrower's claim, not a currency we sell. It comes into existence ONLY when somebody
///         locks collateral in their own escrow and draws against it, and it leaves existence ONLY
///         when it is redeemed 1:1 at the Transmuter or burned to repay. Nothing else can create
///         or destroy it — not the owner, not a multisig, not an upgrade.
///
///         ── TWO AUTHORITIES, EACH SINGULAR AND FAIL-CLOSED ────────────────────────────────────
///         `minter`  — the Alchemist for this market, and only it.
///         `burner`  — the Transmuter for this market, and only it.
///         Both default to `address(0)`, which is OFF: the token ships inert and the Safe arms it
///         after the market is wired. That is the GearVault cap discipline (fail-closed at zero)
///         and the OMR `minter` discipline, applied to both directions.
///
///         Setting either to `address(0)` afterwards is a one-transaction emergency stop —
///         `setMinter(0)` halts all issuance without touching redemption, which is the correct
///         asymmetry: **the protocol must stop issuing before it stops paying** (§2.4). Do not
///         "improve" this into a pause modifier that covers both.
///
///         ── WHAT IS DELIBERATELY ABSENT, AND MUST STAY ABSENT ─────────────────────────────────
///         • **No owner mint.** So "the Safe was compromised" and "supply was inflated" remain two
///           separate events — the argument OMR.sol already rests on.
///         • **No blacklist, no freeze, no confiscation, no forced transfer.** A confiscation path
///           is a rug vector, and adding one resets the third-party audit clock. It is also the
///           first thing an integrator's risk team greps for.
///         • **No upgradeability.** No proxy, no admin slot.
///         • **No rebasing, no fee-on-transfer.** Integrators may assume `transfer(x)` moves
///           exactly `x`; a debt token that lies about its own transfers breaks every downstream
///           accounting assumption, including our own Transmuter's.
contract NUSD is ERC20, ERC20Permit, Ownable {
    /// @notice The only address that may mint. `address(0)` = issuance off.
    address public minter;
    /// @notice The only address that may burn. `address(0)` = redemption off.
    address public burner;

    event MinterSet(address indexed minter);
    event BurnerSet(address indexed burner);

    error NotMinter();
    error NotBurner();

    constructor(string memory name_, string memory symbol_, address safe)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(safe)
    {}

    /// @notice Arm or disarm issuance. Zero is legal and means OFF (the emergency stop).
    function setMinter(address m) external onlyOwner {
        minter = m;
        emit MinterSet(m);
    }

    /// @notice Arm or disarm redemption. Zero is legal and means OFF.
    /// @dev    Disarming this while `minter` is armed inverts the §2.4 asymmetry (issuing while
    ///         unable to pay). The Safe must never do that; it is not enforced in code because a
    ///         contract that refuses a legitimate emergency is worse than one that trusts its Safe.
    function setBurner(address b) external onlyOwner {
        burner = b;
        emit BurnerSet(b);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter || minter == address(0)) revert NotMinter();
        _mint(to, amount);
    }

    /// @dev Burns from `from`'s balance WITHOUT an allowance check. That is safe only because the
    ///      single burner is the Transmuter, which pulls the tokens into itself before burning —
    ///      i.e. it burns its OWN balance. Do not widen `burner` to something that burns third
    ///      parties' balances; the allowance check is absent, not implied.
    function burn(address from, uint256 amount) external {
        if (msg.sender != burner || burner == address(0)) revert NotBurner();
        _burn(from, amount);
    }
}
