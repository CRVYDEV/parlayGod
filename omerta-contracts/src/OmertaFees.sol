// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OmertaFees — the inbound entry/revive fee rail (§11).
/// @notice Players pay two flat native-currency (ETH) fees here:
///           • the MINT fee (start playing: a free trial character becomes a
///             permanent, withdrawal-eligible one), and
///           • the RESPAWN fee (pre-paid revive insurance: a killing blow is
///             absorbed instead of permadeath).
///         Each payment forwards the ETH STRAIGHT to the developer wallet in the
///         same transaction — this contract never custodies funds — and emits an
///         event carrying a monotonic nonce. The off-chain game server watches
///         those events and credits the paying wallet its in-game entitlement.
///         This contract mints nothing and holds nothing; it is a metered tollbooth.
contract OmertaFees is Ownable2Step, ReentrancyGuard {
    /// @notice Where every fee is forwarded. The Safe/owner can rotate it.
    address payable public feeRecipient;
    /// @notice Flat fees, in wei. Owner-settable (launch tuning); enforced exactly.
    uint256 public mintFee;
    uint256 public respawnFee;
    /// @notice Monotonic id stamped on every payment — the off-chain idempotency key.
    uint256 public nonce;

    event MintFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount);
    event RespawnFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount);
    event FeeRecipientChanged(address indexed recipient);
    event FeesChanged(uint256 mintFee, uint256 respawnFee);

    error WrongFee(uint256 sent, uint256 required);
    error ForwardFailed();
    error ZeroAddress();

    constructor(address owner_, address payable feeRecipient_, uint256 mintFee_, uint256 respawnFee_)
        Ownable(owner_)
    {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeRecipient = feeRecipient_;
        mintFee = mintFee_;
        respawnFee = respawnFee_;
        emit FeeRecipientChanged(feeRecipient_);
        emit FeesChanged(mintFee_, respawnFee_);
    }

    /// @notice Pay the mint fee to make your character permanent. Exact-value only.
    function payMintFee() external payable nonReentrant {
        if (msg.value != mintFee) revert WrongFee(msg.value, mintFee);
        uint256 n = ++nonce;              // effect before interaction (CEI + guard)
        _forward(msg.value);
        emit MintFeePaid(msg.sender, n, msg.value);
    }

    /// @notice Pay for one pre-paid respawn (revive insurance). Exact-value only.
    function payRespawnFee() external payable nonReentrant {
        if (msg.value != respawnFee) revert WrongFee(msg.value, respawnFee);
        uint256 n = ++nonce;
        _forward(msg.value);
        emit RespawnFeePaid(msg.sender, n, msg.value);
    }

    function _forward(uint256 amount) private {
        (bool ok, ) = feeRecipient.call{value: amount}("");
        if (!ok) revert ForwardFailed();
    }

    // ── owner (Safe) admin ──
    function setFeeRecipient(address payable recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientChanged(recipient);
    }

    function setFees(uint256 mintFee_, uint256 respawnFee_) external onlyOwner {
        mintFee = mintFee_;
        respawnFee = respawnFee_;
        emit FeesChanged(mintFee_, respawnFee_);
    }

    /// @notice Rescue any ETH that somehow lands here outside the pay* paths (e.g. a
    ///         selfdestruct push) — the pay paths never leave a balance behind.
    function sweep() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal > 0) _forward(bal);
    }
}
