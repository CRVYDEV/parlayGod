// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title StockVault — the delivery contract for OMERTÀ's tokenized-stock reward (brokers step 7,
///        omerta-brokers-design.md §3.3 / §5.1; omerta-dynasty-machine-design.md §3/§8).
/// @notice Holds tokenized-stock ERC-20s the treasury keeper PRE-BOUGHT (runStockBuyback) and PUSHES the
///         allocated units straight into a player's ERC-6551 token-bound account.
///
///         GATELESS PUSH (founder decision, §3.3): delivery is automatic and there is NO claim process and
///         NO on-chain eligibility gate — stock accrues straight into the token-bound account, so the NFT
///         sells self-contained. This is a DELIBERATE decision, recorded here rather than omitted: the design
///         (§6) flags that Robinhood's tokenized stocks are issuer-restricted (EU-facing), so a gateless
///         push has no on-chain control over who receives them. Any operational eligibility is a backend/
///         keeper concern; this contract enforces none.
///
///         IT MINTS NOTHING. Every delivery is a plain SafeERC20 transfer of a PRE-HELD balance — the same
///         "the bridge never mints" invariant as VoucherClaim. `held` is `balanceOf(this)` per token, so a
///         delivery physically CANNOT exceed what the vault holds (the ERC-20 reverts). That is the on-chain
///         half of the design's `allocated ≤ held (per ticker, in units)` wall; the OTHER half — the
///         allocation LEDGER and its clamping writer (`allocateStock`) plus the nightly `runTreasuryInvariants`
///         — lives in the backend, because a per-account owed-side ledger is not a thing a stateless
///         distributor should hold. The clamp is the prevention; this contract is the last physical bound.
///
///         A leaked KEEPER key is bounded by: the per-token daily delivery cap (rate), the Safe pausing
///         deliveries, the Safe rotating the keeper (`setKeeper`), and — decisively — that the keeper can
///         only ever move stock the vault ALREADY HOLDS, which the Safe can pull back at any time (`sweep`).
///         No mint path, so a compromised keeper cannot conjure units, only move held ones to a wrong
///         address, which the Safe stops by pausing + rotating and recovers to the extent units remain.
contract StockVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The automated delivery bot (the treasury's push keeper). Safe-set; 0 = deliveries disabled.
    address public keeper;

    /// @notice Per-token daily delivery cap in units (0 = unlimited) — a leaked-keeper rate wall, the
    ///         VoucherClaim.dailyCapOMR discipline applied per stock so one key can't drain a whole ticker
    ///         in a block. The Safe sets it per token.
    mapping(address => uint256) public dailyCap;                 // token => max units/UTC day (0 = unlimited)
    mapping(address => mapping(uint256 => uint256)) public deliveredOnDay; // token => day => units delivered

    /// @notice Idempotency: the backend stamps each allocation a unique deliveryId; a re-driven delivery
    ///         (retry, reorg re-scan) is a clean no-op, so a delivery lands AT MOST once.
    mapping(uint256 => bool) public usedDeliveryId;

    event KeeperSet(address indexed keeper);
    event DailyCapSet(address indexed token, uint256 cap);
    event Delivered(uint256 indexed deliveryId, address indexed token, address indexed to, uint256 units);
    event Swept(address indexed token, address indexed to, uint256 amount);

    modifier onlyKeeper() {
        require(msg.sender == keeper && keeper != address(0), "SV: not keeper");
        _;
    }

    constructor(address owner_, address keeper_) Ownable(owner_) {
        keeper = keeper_; // may be 0 at deploy (deliveries off until the Safe wires the bot)
        emit KeeperSet(keeper_);
    }

    // ── admin (the Safe) ──
    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setDailyCap(address token, uint256 cap) external onlyOwner {
        require(token != address(0), "SV: zero token");
        dailyCap[token] = cap;
        emit DailyCapSet(token, cap);
    }

    // Pausing stops NEW deliveries. It can never trap a player's stock — delivered stock already sits in the
    // player's token-bound account, and undelivered stock is the Safe's to `sweep`.
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Tranche management: the Safe pulls unspent stock back (the VoucherClaim.sweep precedent).
    ///         Routes to a Safe-chosen `to`, never a fixed recipient, so a misconfig can't trap the pull.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "SV: zero recipient");
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    // ── the push (keeper-driven, gateless) ──
    /// @notice Deliver `units` of `token` into `to` (the player's ERC-6551 token-bound account, computed by
    ///         the backend and resolved at delivery time). Pre-held transfer only — NEVER mints. Idempotent
    ///         on `deliveryId`.
    function deliver(uint256 deliveryId, address token, address to, uint256 units)
        external onlyKeeper nonReentrant whenNotPaused
    {
        _deliver(deliveryId, token, to, units);
    }

    /// @notice Batch the push for gas — the distributor delivers to many accounts per run. Same per-item
    ///         idempotency + daily cap + pre-held bound; any one item reverting reverts the batch (the
    ///         backend re-drives the survivors on the next tick, their deliveryIds still unused).
    function deliverBatch(
        uint256[] calldata deliveryIds,
        address[] calldata tokens,
        address[] calldata tos,
        uint256[] calldata unitsArr
    ) external onlyKeeper nonReentrant whenNotPaused {
        uint256 n = deliveryIds.length;
        require(tokens.length == n && tos.length == n && unitsArr.length == n, "SV: length mismatch");
        for (uint256 i = 0; i < n; i++) {
            _deliver(deliveryIds[i], tokens[i], tos[i], unitsArr[i]);
        }
    }

    function _deliver(uint256 deliveryId, address token, address to, uint256 units) private {
        require(to != address(0), "SV: zero recipient");
        require(token != address(0), "SV: zero token");
        require(units != 0, "SV: zero units");
        require(!usedDeliveryId[deliveryId], "SV: replay");
        usedDeliveryId[deliveryId] = true;

        uint256 cap = dailyCap[token];
        if (cap != 0) {
            uint256 day = block.timestamp / 1 days;
            uint256 newTotal = deliveredOnDay[token][day] + units;
            require(newTotal <= cap, "SV: daily cap");
            deliveredOnDay[token][day] = newTotal;
        }

        IERC20(token).safeTransfer(to, units); // transfers a pre-held balance; reverts if > held; NEVER mints
        emit Delivered(deliveryId, token, to, units);
    }
}
