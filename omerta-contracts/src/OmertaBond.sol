// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OmertaBond — the disciplined treasury bond for Protocol-Owned Liquidity (design
///        omerta-reserve-bond-design.md; the OlympusDAO "Option C").
/// @notice A bonder deposits ETH → receives DISCOUNTED OMR, vested linearly; the ETH is split
///         (POL share + Vig share) and forwarded in the SAME tx, so this contract custodies no ETH.
///         Security invariant, mirrored from the game economy's §10.4 rule: NOTHING IS MINTED. The
///         payout OMR is TRANSFERRED from a balance the treasury Safe pre-funded (the VoucherClaim
///         tranche discipline) — `committedOMR + payout <= omr.balanceOf(this)` is enforced at bond
///         time, so total OMR ever bonded out is HARD-CAPPED by the funded balance and can never be
///         reflexive (the Olympus failure mode is structurally excluded). Prices/discounts come in a
///         server-signed EIP-712 quote (the VoucherClaim signer discipline); a compromised signer is
///         bounded by the tranche + MAX_DISCOUNT_BPS and revoked by the Safe. `sweep` can pull only
///         the UNCOMMITTED tranche — never the OMR backing outstanding vested bonds.
contract OmertaBond is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Rogue-discount backstop (a leaked signer can't quote a near-infinite payout). The
    ///         server quotes far less; must equal the backend's BONDS.MAX_DISCOUNT_BPS.
    uint256 public constant MAX_DISCOUNT_BPS = 2000; // 20%
    /// @notice Vesting-window backstop, so a leaked (then-rotated) signer's pre-signed quotes can't
    ///         lock OMR in a decade-long vest. The server signs much shorter windows.
    uint256 public constant MAX_VEST = 30 days;
    /// @notice Deadline backstop (the VoucherClaim MAX_VOUCHER_TTL mirror): a quote can't be signed
    ///         with a deadline arbitrarily far in the future, so a leaked-then-rotated signer's
    ///         pre-signed `deadline=2100` quotes can't stay bondable at a stale favorable price. The
    ///         server signs minute/hour-scale deadlines; this only bounds abuse.
    uint256 public constant MAX_QUOTE_TTL = 30 days;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "BondQuote(address payer,uint256 principal,uint256 priceOmrPerEth,uint256 discountBps,uint256 vestSeconds,uint256 nonce,uint256 deadline)"
    );

    struct BondQuote {
        address payer;            // the bonder (must be msg.sender — a quote is not transferable)
        uint256 principal;        // ETH (wei) the bonder deposits; must equal msg.value
        uint256 priceOmrPerEth;   // OMR (wei) per 1 ETH (1e18 wei) at quote time (the DEX TWAP)
        uint256 discountBps;      // the bonder's incentive (<= MAX_DISCOUNT_BPS)
        uint256 vestSeconds;      // linear vesting window (<= MAX_VEST)
        uint256 nonce;            // server-unique; replay protection
        uint256 deadline;         // unix seconds
    }

    struct Bond {
        address owner;            // who may claim
        uint256 payout;           // total OMR owed (discounted)
        uint256 claimed;          // OMR released so far
        uint64 start;             // vesting start (block.timestamp)
        uint64 vestSeconds;       // vesting window
    }

    IERC20 public immutable omr;
    /// @notice POL share of every bond's ETH, in basis points. IMMUTABLE — set once at deploy in
    ///         lockstep with the backend's BONDS.POL_BPS so on-chain and off-chain never drift.
    uint256 public immutable polBps;
    address public signer;              // the game server's quote signer (rotatable by the Safe)
    address payable public polRecipient; // where the POL ETH share is forwarded (the pairing manager)
    address payable public vigRecipient; // where the Vig ETH share is forwarded (the Vig wallet)

    /// @notice OMR promised to outstanding (unclaimed) bonds. INVARIANT: <= omr.balanceOf(this).
    uint256 public committedOMR;
    mapping(uint256 => bool) public usedNonce; // quote replay protection
    mapping(uint256 => Bond) public bonds;     // bondId => Bond
    uint256 public nextBondId = 1;

    event Bonded(uint256 indexed bondId, address indexed payer, uint256 indexed nonce, uint256 principal, uint256 payout, uint256 toPol, uint256 toVig);
    event BondClaimed(uint256 indexed bondId, address indexed owner, uint256 amount);
    event SignerSet(address indexed signer);
    event RecipientsSet(address indexed pol, address indexed vig);
    event Swept(address indexed to, uint256 amount);

    error ZeroAddress();
    error BadBps();
    error NotPayer();
    error WrongValue(uint256 sent, uint256 required);
    error Expired();
    error DeadlineTooFar();
    error VestTooLong();
    error Replay();
    error BadSignature();
    error TrancheExhausted();      // committed + payout would exceed the funded balance
    error NotOwner();
    error NothingVested();
    error ForwardFailed();
    error OverSweep();             // would dip into OMR backing outstanding bonds

    constructor(
        address owner_,
        address signer_,
        IERC20 omr_,
        uint256 polBps_,
        address payable polRecipient_,
        address payable vigRecipient_
    ) EIP712("OmertaBond", "1") Ownable(owner_) {
        if (signer_ == address(0) || address(omr_) == address(0)) revert ZeroAddress();
        if (polBps_ > 10000) revert BadBps();
        if (polBps_ > 0 && polRecipient_ == address(0)) revert ZeroAddress();
        if (polBps_ < 10000 && vigRecipient_ == address(0)) revert ZeroAddress();
        signer = signer_;
        omr = omr_;
        polBps = polBps_;
        polRecipient = polRecipient_;
        vigRecipient = vigRecipient_;
        emit SignerSet(signer_);
        emit RecipientsSet(polRecipient_, vigRecipient_);
    }

    // ── the bond ──
    function hashQuote(BondQuote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            QUOTE_TYPEHASH, q.payer, q.principal, q.priceOmrPerEth, q.discountBps, q.vestSeconds, q.nonce, q.deadline
        )));
    }

    /// @notice Deposit ETH against a server-signed quote → book a vesting OMR bond. The ETH is split
    ///         (POL + Vig) and forwarded in this tx; the contract custodies no ETH and mints no OMR.
    function bond(BondQuote calldata q, bytes calldata sig) external payable nonReentrant whenNotPaused returns (uint256 bondId) {
        if (msg.sender != q.payer) revert NotPayer();
        if (msg.value != q.principal || msg.value == 0) revert WrongValue(msg.value, q.principal);
        if (block.timestamp > q.deadline) revert Expired();
        if (q.deadline > block.timestamp + MAX_QUOTE_TTL) revert DeadlineTooFar();
        if (q.discountBps > MAX_DISCOUNT_BPS) revert BadBps();
        if (q.vestSeconds == 0 || q.vestSeconds > MAX_VEST) revert VestTooLong();
        if (usedNonce[q.nonce]) revert Replay();
        if (ECDSA.recover(hashQuote(q), sig) != signer) revert BadSignature();
        usedNonce[q.nonce] = true;

        // discounted payout: principal's market OMR value, scaled UP by the discount (cheaper OMR)
        uint256 marketOmr = (q.principal * q.priceOmrPerEth) / 1e18;
        uint256 payout = (marketOmr * 10000) / (10000 - q.discountBps);

        // THE TRANCHE CAP (the anti-Ponzi discipline): the contract must already HOLD enough OMR to
        // cover every outstanding payout PLUS this one. Never mints; bounded by the funded balance.
        if (committedOMR + payout > omr.balanceOf(address(this))) revert TrancheExhausted();
        committedOMR += payout;

        bondId = nextBondId++;
        bonds[bondId] = Bond({ owner: q.payer, payout: payout, claimed: 0, start: uint64(block.timestamp), vestSeconds: uint64(q.vestSeconds) });

        // split + forward the ETH in this tx (the OmertaFees custody-nothing pattern)
        uint256 toPol = (msg.value * polBps) / 10000;
        uint256 toVig = msg.value - toPol;
        if (toPol > 0) { (bool okP, ) = polRecipient.call{value: toPol}(""); if (!okP) revert ForwardFailed(); }
        if (toVig > 0) { (bool okV, ) = vigRecipient.call{value: toVig}(""); if (!okV) revert ForwardFailed(); }

        emit Bonded(bondId, q.payer, q.nonce, msg.value, payout, toPol, toVig);
    }

    /// @notice Claim the vested (linear) OMR of a bond you own. Releases from the pre-funded balance.
    function claim(uint256 bondId) external nonReentrant returns (uint256 amount) {
        Bond storage b = bonds[bondId];
        if (b.owner != msg.sender) revert NotOwner();
        uint256 vested = _vested(b);
        amount = vested - b.claimed;
        if (amount == 0) revert NothingVested();
        b.claimed = vested;
        committedOMR -= amount;         // the released OMR leaves the outstanding commitment
        omr.safeTransfer(b.owner, amount); // transfers pre-funded balance; NEVER mints
        emit BondClaimed(bondId, b.owner, amount);
    }

    function _vested(Bond storage b) private view returns (uint256) {
        uint256 elapsed = block.timestamp - b.start;
        if (elapsed >= b.vestSeconds) return b.payout;
        return (b.payout * elapsed) / b.vestSeconds;
    }

    /// @notice The claimable OMR of a bond right now (a convenience read for the UI/watcher).
    function claimable(uint256 bondId) external view returns (uint256) {
        Bond storage b = bonds[bondId];
        return _vested(b) - b.claimed;
    }

    // ── admin (the Safe) ──
    function setSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        signer = s;
        emit SignerSet(s);
    }

    function setRecipients(address payable pol, address payable vig) external onlyOwner {
        if (polBps > 0 && pol == address(0)) revert ZeroAddress();
        if (polBps < 10000 && vig == address(0)) revert ZeroAddress();
        polRecipient = pol;
        vigRecipient = vig;
        emit RecipientsSet(pol, vig);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Tranche management: the Safe can pull back only the UNCOMMITTED OMR — never the balance
    ///         backing outstanding vested bonds (so a sweep can never strand a bonder's claim).
    function sweep(address to, uint256 amount) external onlyOwner {
        if (amount > omr.balanceOf(address(this)) - committedOMR) revert OverSweep();
        omr.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    /// @notice Rescue any ETH that somehow lands here outside `bond()` (e.g. a selfdestruct push) —
    ///         the bond path forwards its full msg.value in-tx and never leaves a balance behind.
    ///         Routes to `owner()` (the Safe), NOT a recipient, so a misconfigured recipient can't
    ///         also trap the rescue (the OmertaFees.sweep pattern).
    function sweepETH() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = payable(owner()).call{value: bal}("");
            if (!ok) revert ForwardFailed();
        }
    }
}
