// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OMRStaking — the Vault, on-chain.
/// @notice Simple per-user accrual at an owner-set APY (basis points, capped).
///         Rewards pay ONLY from a pre-funded reward pool — no emission, no
///         mint, consistent with the game's value-conservation rule. If the
///         pool runs dry, claims revert until the Safe tops it up; principal
///         is always withdrawable regardless.
contract OMRStaking is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_APY_BPS = 5_000; // 50% hard ceiling
    uint256 private constant YEAR = 365 days;

    IERC20 public immutable omr;
    uint256 public apyBps; // e.g. 1400 = 14%
    uint256 public totalStaked;
    uint256 public rewardPool; // accounted separately from principal

    struct Position { uint256 staked; uint256 accrued; uint64 lastAccrued; }
    mapping(address => Position) public positions;

    event ApySet(uint256 bps);
    event PoolFunded(uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);

    constructor(address owner_, IERC20 omr_, uint256 apyBps_) Ownable(owner_) {
        require(apyBps_ <= MAX_APY_BPS, "Staking: apy too high");
        omr = omr_;
        apyBps = apyBps_;
    }

    function setApy(uint256 bps) external onlyOwner {
        require(bps <= MAX_APY_BPS, "Staking: apy too high");
        apyBps = bps;
        emit ApySet(bps);
    }

    /// @notice The Safe funds rewards explicitly — never confused with principal.
    function fundRewards(uint256 amount) external {
        omr.safeTransferFrom(msg.sender, address(this), amount);
        rewardPool += amount;
        emit PoolFunded(amount);
    }

    function _accrue(address user) internal {
        Position storage p = positions[user];
        if (p.staked > 0) {
            p.accrued += (p.staked * apyBps * (block.timestamp - p.lastAccrued)) / (10_000 * YEAR);
        }
        p.lastAccrued = uint64(block.timestamp);
    }

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Staking: zero");
        _accrue(msg.sender);
        omr.safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender].staked += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        _accrue(msg.sender);
        Position storage p = positions[msg.sender];
        require(amount > 0 && amount <= p.staked, "Staking: bad amount");
        p.staked -= amount;
        totalStaked -= amount;
        omr.safeTransfer(msg.sender, amount); // principal always withdrawable
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _accrue(msg.sender);
        Position storage p = positions[msg.sender];
        uint256 amount = p.accrued;
        require(amount > 0, "Staking: nothing accrued");
        require(amount <= rewardPool, "Staking: pool dry");
        p.accrued = 0;
        rewardPool -= amount;
        omr.safeTransfer(msg.sender, amount);
        emit RewardsClaimed(msg.sender, amount);
    }

    function pendingRewards(address user) external view returns (uint256) {
        Position memory p = positions[user];
        uint256 live = p.staked > 0
            ? (p.staked * apyBps * (block.timestamp - p.lastAccrued)) / (10_000 * YEAR)
            : 0;
        return p.accrued + live;
    }
}
