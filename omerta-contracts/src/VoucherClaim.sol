// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGearVault {
    function mint(address to, uint256 gearId, uint256 amount) external;
}

/// @title VoucherClaim — the ONLY bridge between OMERTÀ's game server and the chain.
/// @notice The game server (off-chain authoritative) signs EIP-712 vouchers;
///         players claim them here. Security invariant, mirrored from the game
///         economy's own rule: NOTHING IS MINTED. OMR claims transfer from a
///         balance the treasury Safe pre-funded (tranches); gear claims mint
///         1155s only because the server signed that exact (player, gearId).
///         A compromised game server is bounded by the current tranche +
///         the daily cap. A compromised signer key is revoked by the Safe.
contract VoucherClaim is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant KIND_OMR = 0;
    uint8 public constant KIND_GEAR = 1;

    /// @notice Backstop on how far out a voucher's deadline may be, so a leaked
    ///         (then-rotated) signer key's pre-signed vouchers can't stay claimable
    ///         for months. The server signs much shorter deadlines in practice.
    uint256 public constant MAX_VOUCHER_TTL = 30 days;

    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(address to,uint256 amount,uint8 kind,uint256 gearId,uint256 nonce,uint256 deadline)"
    );

    struct Voucher {
        address to;
        uint256 amount;   // OMR wei for KIND_OMR; quantity (normally 1) for KIND_GEAR
        uint8 kind;
        uint256 gearId;   // 0 for KIND_OMR
        uint256 nonce;    // server-unique; replay protection
        uint256 deadline; // unix seconds
    }

    IERC20 public immutable omr;
    IGearVault public immutable gear;
    address public signer;
    uint256 public dailyCapOMR;               // max OMR claimable per UTC day, 0 = unlimited
    mapping(uint256 => bool) public usedNonce;
    mapping(uint256 => uint256) public claimedOnDay; // day => OMR total
    // Gear is bounded the same way OMR is bounded by the tranche: a per-gearId
    // lifetime supply cap the Safe sets. FAIL-CLOSED — a gearId with cap 0 cannot
    // be minted at all, so a compromised signer can't mint unlimited/unknown gear.
    mapping(uint256 => uint256) public gearSupplyCap;  // gearId => max lifetime supply (0 = mint blocked)
    mapping(uint256 => uint256) public gearMinted;     // gearId => minted so far

    event SignerSet(address indexed signer);
    event DailyCapSet(uint256 cap);
    event GearSupplyCapSet(uint256 indexed gearId, uint256 cap);
    event Claimed(uint256 indexed nonce, address indexed to, uint8 kind, uint256 amount, uint256 gearId);
    event Swept(address indexed to, uint256 amount);

    constructor(address owner_, address signer_, IERC20 omr_, IGearVault gear_, uint256 dailyCapOMR_)
        EIP712("OmertaVoucherClaim", "1")
        Ownable(owner_)
    {
        require(signer_ != address(0), "VC: zero signer");
        signer = signer_;
        omr = omr_;
        gear = gear_;
        dailyCapOMR = dailyCapOMR_;
    }

    // ── admin (the Safe) ──
    function setSigner(address s) external onlyOwner {
        require(s != address(0), "VC: zero signer");
        signer = s;
        emit SignerSet(s);
    }

    function setDailyCap(uint256 cap) external onlyOwner {
        dailyCapOMR = cap;
        emit DailyCapSet(cap);
    }

    /// @notice Per-gearId lifetime supply cap. Must be set (> 0) before any gear of
    ///         that class can be claimed. Lowering below already-minted just blocks
    ///         further mints of that class.
    function setGearSupplyCap(uint256 gearId, uint256 cap) external onlyOwner {
        require(gearId != 0, "VC: zero gear");
        gearSupplyCap[gearId] = cap;
        emit GearSupplyCapSet(gearId, cap);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Tranche management: the Safe can pull unspent OMR back.
    function sweep(address to, uint256 amount) external onlyOwner {
        omr.safeTransfer(to, amount);
        emit Swept(to, amount);
    }

    // ── the claim ──
    function hashVoucher(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            VOUCHER_TYPEHASH, v.to, v.amount, v.kind, v.gearId, v.nonce, v.deadline
        )));
    }

    function claim(Voucher calldata v, bytes calldata sig) external nonReentrant whenNotPaused {
        require(block.timestamp <= v.deadline, "VC: expired");
        require(v.deadline <= block.timestamp + MAX_VOUCHER_TTL, "VC: deadline too far");
        // AUDIT hardening: explicit zero-recipient guard. The underlying ERC20/1155 would revert on
        // a to==0 anyway, but a clear boundary check gives the intended custom reason (a server bug
        // signing to 0x0 fails legibly) and validates external input up front (auditor checklist).
        require(v.to != address(0), "VC: zero recipient");
        require(!usedNonce[v.nonce], "VC: replay");
        require(ECDSA.recover(hashVoucher(v), sig) == signer, "VC: bad signature");
        usedNonce[v.nonce] = true;

        if (v.kind == KIND_OMR) {
            uint256 day = block.timestamp / 1 days;
            uint256 newTotal = claimedOnDay[day] + v.amount;
            require(dailyCapOMR == 0 || newTotal <= dailyCapOMR, "VC: daily cap");
            claimedOnDay[day] = newTotal;
            omr.safeTransfer(v.to, v.amount); // transfers pre-funded balance; NEVER mints
        } else if (v.kind == KIND_GEAR) {
            require(v.gearId != 0, "VC: zero gear");
            // fail-closed per-gearId lifetime cap — bounds a compromised signer's gear
            // blast radius the way the tranche bounds OMR (cap 0 => class can't mint)
            uint256 cap = gearSupplyCap[v.gearId];
            uint256 minted = gearMinted[v.gearId] + v.amount;
            require(cap != 0 && minted <= cap, "VC: gear cap");
            gearMinted[v.gearId] = minted;
            gear.mint(v.to, v.gearId, v.amount);
        } else {
            revert("VC: bad kind");
        }
        emit Claimed(v.nonce, v.to, v.kind, v.amount, v.gearId);
    }
}
