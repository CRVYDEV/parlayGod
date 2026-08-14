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
    /// @notice Where the DEV share of every fee is forwarded. The Safe/owner can rotate it.
    address payable public feeRecipient;
    /// @notice Where the VIG share is forwarded (the Phase-2 redistribution wallet, a Safe). Owner
    ///         can rotate it. The backend's src/vig.js MUST book revenue with VIG_BPS == `vigBps`.
    address payable public vigRecipient;
    /// @notice The Vig's share of every fee, in basis points (0–10000). IMMUTABLE — set once at
    ///         deploy in lockstep with the backend's VIG_BPS so on-chain and off-chain never drift
    ///         (an owner-settable ratio would let the two diverge; 0 = no split, 100% to dev).
    uint256 public immutable vigBps;
    /// @notice Flat fees, in wei. Owner-settable (launch tuning); enforced exactly.
    uint256 public mintFee;
    uint256 public respawnFee;
    /// @notice The stat RE-ROLL fee, in wei. Owner-settable; enforced exactly. Initialized to
    ///         `mintFee` at deploy (0.01 ETH) — a player pays it (again) each time they re-roll
    ///         their build off-chain, so it's an unbounded repeat fee, not a one-time entitlement.
    uint256 public rerollFee;
    /// @notice The on-chain STORE paywall: the exact price (in wei) of each package SKU. Owner-settable and
    ///         FAIL-CLOSED — a sku with price 0 is UNBUYABLE (an unset/retired sku reverts), so a player can
    ///         never underpay and an off-chain-retired package cannot be purchased on-chain. The four-way Store
    ///         earmark (founder/buyback/rwa/community) is a BACKEND concern computed from the gross `amount`;
    ///         on-chain this splits dev/vig exactly like the other fees and forwards, custodying nothing.
    mapping(uint256 => uint256) public packagePrice; // sku => wei (0 = not for sale)

    /// @notice Monotonic id stamped on every payment — the off-chain idempotency key.
    uint256 public nonce;

    event MintFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount);
    event RespawnFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount);
    event RerollFeePaid(address indexed payer, uint256 indexed nonce, uint256 amount);
    event PackagePaid(address indexed payer, uint256 indexed nonce, uint256 indexed sku, uint256 amount);
    event PackagePriceSet(uint256 indexed sku, uint256 price);
    event RerollFeeChanged(uint256 rerollFee);
    /// @dev On-chain transparency of each split; the backend does NOT rely on it (it computes the
    ///      Vig share from the gross `amount` in MintFeePaid/RespawnFeePaid × VIG_BPS == vigBps).
    event FeeSplit(uint256 indexed nonce, uint256 toDev, uint256 toVig);
    event FeeRecipientChanged(address indexed recipient);
    event VigRecipientChanged(address indexed recipient);
    event FeesChanged(uint256 mintFee, uint256 respawnFee);

    error WrongFee(uint256 sent, uint256 required);
    error ForwardFailed();
    error ZeroAddress();
    error ZeroFee();
    error BadBps();

    constructor(
        address owner_,
        address payable feeRecipient_,
        address payable vigRecipient_,
        uint256 vigBps_,
        uint256 mintFee_,
        uint256 respawnFee_
    ) Ownable(owner_) {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (vigBps_ > 10000) revert BadBps();
        if (vigBps_ > 0 && vigRecipient_ == address(0)) revert ZeroAddress(); // a split needs a destination
        if (mintFee_ == 0 || respawnFee_ == 0) revert ZeroFee();
        feeRecipient = feeRecipient_;
        vigRecipient = vigRecipient_;
        vigBps = vigBps_;
        mintFee = mintFee_;
        respawnFee = respawnFee_;
        rerollFee = mintFee_;   // the re-roll costs the same as a mint by default (0.01 ETH); owner-tunable
        emit FeeRecipientChanged(feeRecipient_);
        emit VigRecipientChanged(vigRecipient_);
        emit FeesChanged(mintFee_, respawnFee_);
        emit RerollFeeChanged(mintFee_);
    }

    /// @notice Pay the mint fee to make your character permanent. Exact-value only.
    function payMintFee() external payable nonReentrant {
        if (msg.value != mintFee) revert WrongFee(msg.value, mintFee);
        uint256 n = ++nonce;              // effect before interaction (CEI + guard)
        _forward(n, msg.value);
        emit MintFeePaid(msg.sender, n, msg.value);
    }

    /// @notice Pay for one pre-paid respawn (revive insurance). Exact-value only.
    function payRespawnFee() external payable nonReentrant {
        if (msg.value != respawnFee) revert WrongFee(msg.value, respawnFee);
        uint256 n = ++nonce;
        _forward(n, msg.value);
        emit RespawnFeePaid(msg.sender, n, msg.value);
    }

    /// @notice Pay to re-roll your build. Exact-value only; repeatable (each pays the fee again).
    function payRerollFee() external payable nonReentrant {
        if (msg.value != rerollFee) revert WrongFee(msg.value, rerollFee);
        uint256 n = ++nonce;
        _forward(n, msg.value);
        emit RerollFeePaid(msg.sender, n, msg.value);
    }

    /// @notice Pay for a Store package (SKU). Exact-value only; fail-closed on an unpriced sku. The backend
    ///         watches `PackagePaid` and grants the package's (non-§10.4) entitlement idempotently on `nonce`.
    function payForPackage(uint256 sku) external payable nonReentrant {
        uint256 price = packagePrice[sku];
        if (price == 0) revert ZeroFee();                 // sku not for sale (unset/retired) — fail closed
        if (msg.value != price) revert WrongFee(msg.value, price);
        uint256 n = ++nonce;                              // effect before interaction (CEI + guard)
        _forward(n, msg.value);
        emit PackagePaid(msg.sender, n, sku, msg.value);
    }

    /// @dev Splits `amount` into a Vig share (vigBps) forwarded to `vigRecipient` and the remainder
    ///      to `feeRecipient` (dev), in the same tx — the contract still custodies NOTHING and mints
    ///      NOTHING. INVARIANT: both recipients MUST accept ETH (an EOA or a trivial receiver); if
    ///      either reverts, the fee call reverts (a recoverable DoS — the Safe rotates the recipient).
    ///      CEI + nonReentrant make this safe against a reentrant recipient.
    function _forward(uint256 n, uint256 amount) private {
        uint256 toVig = (amount * vigBps) / 10000;
        uint256 toDev = amount - toVig;
        if (toVig > 0) {
            (bool okV, ) = vigRecipient.call{value: toVig}("");
            if (!okV) revert ForwardFailed();
        }
        if (toDev > 0) {
            (bool okD, ) = feeRecipient.call{value: toDev}("");
            if (!okD) revert ForwardFailed();
        }
        emit FeeSplit(n, toDev, toVig);
    }

    // ── owner (Safe) admin ──
    function setFeeRecipient(address payable recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient;
        emit FeeRecipientChanged(recipient);
    }

    /// @notice Rotate the Vig destination (Safe hygiene). Cannot be zeroed while a split is active.
    function setVigRecipient(address payable recipient) external onlyOwner {
        if (recipient == address(0) && vigBps > 0) revert ZeroAddress();
        vigRecipient = recipient;
        emit VigRecipientChanged(recipient);
    }

    function setFees(uint256 mintFee_, uint256 respawnFee_) external onlyOwner {
        if (mintFee_ == 0 || respawnFee_ == 0) revert ZeroFee(); // a 0 fee = free entitlements off-chain
        mintFee = mintFee_;
        respawnFee = respawnFee_;
        emit FeesChanged(mintFee_, respawnFee_);
    }

    /// @notice Tune the re-roll fee (launch/live). A 0 fee would make off-chain re-rolls free.
    function setRerollFee(uint256 rerollFee_) external onlyOwner {
        if (rerollFee_ == 0) revert ZeroFee();
        rerollFee = rerollFee_;
        emit RerollFeeChanged(rerollFee_);
    }

    /// @notice Set (or retire) a Store package's on-chain price. `price == 0` RETIRES the sku (unbuyable) —
    ///         intentional, so the Safe can pull a package on-chain the way the backend retires one off-chain.
    function setPackagePrice(uint256 sku, uint256 price) external onlyOwner {
        packagePrice[sku] = price;
        emit PackagePriceSet(sku, price);
    }

    /// @notice Rescue any ETH that somehow lands here outside the pay* paths (e.g. a
    ///         selfdestruct push) — the pay paths never leave a balance behind. Routes to
    ///         `owner()` (the Safe), NOT `feeRecipient`, so a misconfigured recipient can't
    ///         also trap the rescue.
    function sweep() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = payable(owner()).call{value: bal}("");
            if (!ok) revert ForwardFailed();
        }
    }
}
