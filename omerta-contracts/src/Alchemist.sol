// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FlashGuard} from "./FlashGuard.sol";
import {CollateralEscrow} from "./CollateralEscrow.sol";
import {Transmuter} from "./Transmuter.sol";
import {NUSD} from "./NUSD.sol";

/// @title Alchemist — the borrow side of one denomination-matched market
/// @notice Design: `omerta-bank-protocol-design.md` §2.1–2.5.
///
///         ── THERE IS NO ORACLE IN THIS FILE, AND THAT IS THE HEADLINE ────────────────────────
///         The market is denomination-matched: USD debt against USD collateral. So a borrow
///         decision never reads a price, and **a price that is never read cannot be manipulated,
///         at any size, by anyone, ever.** That is FlashGuard's L0 and it is worth more than every
///         other guard here combined — both Inverse losses (~$21M) were exactly this class.
///
///         The consequence to state plainly: **there is no price at which a user is liquidated.**
///         There is no `liquidate()` in this contract. Debt only ever falls, from harvest or from
///         repayment. If a future market is cross-denominated it is a SEPARATE deployment with its
///         own oracle stack and its own audit — never a parameter change to this one.
///
///         ── NO POOL, THEREFORE NO SHARES ─────────────────────────────────────────────────────
///         Every depositor gets their own `CollateralEscrow`. The design's §5 sketch called for
///         shares accounting to fix Runtime Verification's finding #1 against Alchemix; escrows
///         make that finding UNREACHABLE instead, because the bug it describes only exists when a
///         pool must be divided. See CollateralEscrow's header for the full argument. Do not
///         reintroduce an internal share layer — it would re-create the bug it was meant to fix.
///
///         ── THE INVARIANT THIS FILE EXISTS TO HOLD ───────────────────────────────────────────
///             Σ nUSD supply ≤ Σ collateral × LTV
///         Enforced per-user at every issuance and every withdrawal, and fuzzed in the tests.
contract Alchemist is Ownable, ReentrancyGuard, FlashGuard {
    using SafeERC20 for IERC20;

    /// @notice Compile-time hard ceiling on loan-to-value. The Safe sets `ltvBps` beneath this and
    ///         **a stolen key cannot raise it** — the OmertaBond `MAX_DISCOUNT_BPS` discipline.
    ///         90% is defensible here ONLY because the market is denomination-matched, so high LTV
    ///         costs a slower payoff rather than liquidation risk (§2.2). It would be reckless in a
    ///         cross-denominated market, which is why that is a different contract.
    uint16 public constant MAX_LTV_BPS = 9_000;
    uint16 public constant BPS = 10_000;

    NUSD public immutable debtToken;
    IERC20 public immutable asset;
    IERC4626 public immutable vault;
    Transmuter public immutable transmuter;
    /// @dev 10^(18 - assetDecimals): asset units → debt units. Read from the token, not passed in.
    uint256 public immutable scale;

    uint16 public ltvBps = 5_000; // 50% at deploy; the Safe raises it deliberately

    mapping(address => CollateralEscrow) public escrowOf;
    /// @notice Underlying deposited by the user, in asset units. Yield above this is harvestable.
    mapping(address => uint256) public principalOf;
    /// @notice Outstanding debt in nUSD (18dp). Never negative in this batch — repayment credits
    ///         are clamped at zero rather than banked, because a negative balance is a claim on
    ///         the protocol and this batch deliberately issues none.
    mapping(address => uint256) public debtOf;

    uint256 public mintPerBlockCap;
    uint256 public mintPerDayCap;
    Flow private _mintFlow;

    event EscrowCreated(address indexed user, address escrow);
    event Deposited(address indexed user, uint256 assets);
    event Withdrawn(address indexed user, uint256 assets);
    event Minted(address indexed user, uint256 debt);
    event Repaid(address indexed user, uint256 assets, uint256 debtCleared);
    event Harvested(address indexed user, uint256 assets, uint256 debtCleared);
    event LtvSet(uint16 bps);
    event MintCapsSet(uint256 perBlock, uint256 perDay);

    error ZeroAmount();
    error NoEscrow();
    error LtvTooHigh();
    error Undercollateralised();
    error BufferUnhealthy();
    error NothingToHarvest();

    constructor(NUSD debtToken_, IERC20 asset_, IERC4626 vault_, Transmuter transmuter_, address safe)
        Ownable(safe)
    {
        debtToken = debtToken_;
        asset = asset_;
        vault = vault_;
        transmuter = transmuter_;
        // A vault whose underlying is not OUR asset would silently mismatch every deposit — the
        // escrow would approve USDC to a vault expecting DAI and every deposit would revert, or
        // worse, succeed against a look-alike. Immutables cannot be corrected after deploy, so this
        // is checked here rather than trusted to a deploy script.
        require(vault_.asset() == address(asset_), "vault asset mismatch");
        require(address(transmuter_.asset()) == address(asset_), "transmuter asset mismatch");
        require(address(transmuter_.debtToken()) == address(debtToken_), "transmuter token mismatch");
        uint8 d = IERC20Metadata(address(asset_)).decimals();
        require(d <= 18, "asset decimals > 18");
        scale = 10 ** (18 - d);
    }

    // ── admin ────────────────────────────────────────────────────────────────────────────────────

    function setLtvBps(uint16 bps) external onlyOwner {
        if (bps > MAX_LTV_BPS) revert LtvTooHigh();
        ltvBps = bps;
        emit LtvSet(bps);
    }

    function setMintCaps(uint256 perBlock, uint256 perDay) external onlyOwner {
        mintPerBlockCap = perBlock;
        mintPerDayCap = perDay;
        emit MintCapsSet(perBlock, perDay);
    }

    function setAllowedContract(address who, bool allowed) external onlyOwner {
        _allowedContract[who] = allowed;
    }

    // ── views ────────────────────────────────────────────────────────────────────────────────────

    /// @notice This user's collateral valued in underlying (asset units).
    function collateralOf(address user) public view returns (uint256) {
        CollateralEscrow e = escrowOf[user];
        if (address(e) == address(0)) return 0;
        return e.totalAssets();
    }

    /// @notice The most debt (18dp) this user may owe against their current collateral.
    function maxDebtOf(address user) public view returns (uint256) {
        return (collateralOf(user) * scale * ltvBps) / BPS;
    }

    // ── deposit / withdraw ───────────────────────────────────────────────────────────────────────

    function deposit(uint256 assets) external nonReentrant onlyAllowedCaller {
        if (assets == 0) revert ZeroAmount();
        CollateralEscrow e = escrowOf[msg.sender];
        if (address(e) == address(0)) {
            e = new CollateralEscrow(msg.sender, asset, vault);
            escrowOf[msg.sender] = e;
            emit EscrowCreated(msg.sender, address(e));
        }
        // FlashGuard L1: this stamps the block, so a borrow or withdrawal in the SAME transaction
        // reverts. That is what makes the atomic deposit→borrow→exit round trip impossible.
        _recordEntry(msg.sender);

        asset.safeTransferFrom(msg.sender, address(e), assets);
        e.deployToVault(assets);
        principalOf[msg.sender] += assets;
        emit Deposited(msg.sender, assets);
    }

    function withdraw(uint256 assets) external nonReentrant onlyAllowedCaller notSameBlockAsEntry(msg.sender) {
        if (assets == 0) revert ZeroAmount();
        CollateralEscrow e = escrowOf[msg.sender];
        if (address(e) == address(0)) revert NoEscrow();

        e.withdraw(assets, msg.sender);
        // principal is a floor-tracked figure: withdrawing more than principal means the excess
        // came from yield, and principal simply bottoms out at zero.
        uint256 p = principalOf[msg.sender];
        principalOf[msg.sender] = assets >= p ? 0 : p - assets;

        // the invariant, checked AFTER the move
        if (debtOf[msg.sender] > maxDebtOf(msg.sender)) revert Undercollateralised();
        emit Withdrawn(msg.sender, assets);
    }

    // ── borrow ───────────────────────────────────────────────────────────────────────────────────

    /// @notice Draw `debtAmount` of nUSD (18dp) against your escrow.
    function mint(uint256 debtAmount) external nonReentrant onlyAllowedCaller notSameBlockAsEntry(msg.sender) {
        if (debtAmount == 0) revert ZeroAmount();
        if (address(escrowOf[msg.sender]) == address(0)) revert NoEscrow();
        // §2.4's ordering: the protocol stops ISSUING before it stops paying. A thin buffer halts
        // new debt here; it never touches the Transmuter's ability to honour existing claims.
        if (!transmuter.bufferHealthy()) revert BufferUnhealthy();

        _meter(_mintFlow, debtAmount, mintPerBlockCap, mintPerDayCap);

        uint256 newDebt = debtOf[msg.sender] + debtAmount;
        if (newDebt > maxDebtOf(msg.sender)) revert Undercollateralised();
        debtOf[msg.sender] = newDebt;

        debtToken.mint(msg.sender, debtAmount);
        emit Minted(msg.sender, debtAmount);
    }

    // ── repay ────────────────────────────────────────────────────────────────────────────────────

    /// @notice Repay in UNDERLYING. The assets go to the Transmuter as backing.
    /// @dev    Repayment is deliberately not "burn your nUSD here": the Transmuter is the single
    ///         burn authority (NUSD's header), and paying in underlying is strictly better for the
    ///         system — it clears debt AND deepens the buffer, leaving the outstanding nUSD fully
    ///         redeemable rather than merely destroyed. Anyone holding nUSD who wants out uses the
    ///         Transmuter directly.
    ///
    ///         Overpayment is REFUSED rather than banked as a credit. A negative debt balance is a
    ///         claim on the protocol, and this batch issues none — clamping at zero keeps
    ///         `Σ supply ≤ Σ collateral × LTV` a statement about debt only.
    function repay(uint256 assets) external nonReentrant {
        if (assets == 0) revert ZeroAmount();
        uint256 d = debtOf[msg.sender];
        if (d == 0) revert ZeroAmount();

        uint256 asDebt = assets * scale;
        if (asDebt > d) {
            asDebt = d;
            assets = (d + scale - 1) / scale; // round UP so the protocol is never short-changed
        }

        asset.safeTransferFrom(msg.sender, address(this), assets);
        debtOf[msg.sender] = d - asDebt;

        asset.forceApprove(address(transmuter), assets);
        transmuter.fund(assets);
        asset.forceApprove(address(transmuter), 0);

        emit Repaid(msg.sender, assets, asDebt);
    }

    // ── harvest: the self-repaying half ──────────────────────────────────────────────────────────

    /// @notice Realise the yield a user's escrow has earned above principal and apply it to debt.
    /// @dev    Permissionless by design — anyone may harvest anyone. It can only ever REDUCE the
    ///         target's debt and move their yield into backing, so there is nothing for a caller to
    ///         extract and no reason to gate it. That also means a keeper can run it, which is what
    ///         makes the loan self-repaying without the user doing anything.
    function harvest(address user) external nonReentrant {
        CollateralEscrow e = escrowOf[user];
        if (address(e) == address(0)) revert NoEscrow();

        uint256 total = e.totalAssets();
        uint256 p = principalOf[user];
        if (total <= p) revert NothingToHarvest();
        uint256 yield_ = total - p;

        uint256 d = debtOf[user];
        if (d == 0) revert NothingToHarvest(); // leave the yield compounding in the escrow

        // Take the whole yield unless it would clear more than is owed, in which case take only
        // what the debt needs — rounded UP, so the assets moved always cover the debt cleared and
        // never the other way round. `take` can never exceed `yield_`, so the two clamps below are
        // the same statement from both sides.
        uint256 take = yield_;
        uint256 asDebt = take * scale;
        if (asDebt > d) {
            take = (d + scale - 1) / scale; // ceil(d / scale)
            if (take > yield_) take = yield_;
            asDebt = take * scale;
            if (asDebt > d) asDebt = d;
        }

        e.withdraw(take, address(this));
        debtOf[user] = d - asDebt;

        asset.forceApprove(address(transmuter), take);
        transmuter.fund(take);
        asset.forceApprove(address(transmuter), 0);

        emit Harvested(user, take, asDebt);
    }
}
