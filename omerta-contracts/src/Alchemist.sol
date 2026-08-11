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

    /// @notice Compile-time hard ceiling on the harvest performance fee — the `MAX_LTV_BPS` /
    ///         `MAX_DISCOUNT_BPS` discipline applied to the one lever that touches the product's
    ///         central promise. **A stolen key cannot take the whole yield**, which is the entire
    ///         reason this is a constant rather than just an owner-set number: without it, the
    ///         self-repaying loan can be turned into a non-repaying one in a single transaction.
    uint16 public constant MAX_HARVEST_FEE_BPS = 3_000; // 30%

    NUSD public immutable debtToken;
    IERC20 public immutable asset;
    IERC4626 public immutable vault;
    Transmuter public immutable transmuter;
    /// @dev 10^(18 - assetDecimals): asset units → debt units. Read from the token, not passed in.
    uint256 public immutable scale;

    uint16 public ltvBps = 5_000; // 50% at deploy; the Safe raises it deliberately

    /// @notice The protocol's performance fee on harvested yield, in bps. 20% at deploy — the
    ///         canonical DeFi performance fee (Yearn's number), so it needs no explaining, and
    ///         double Alchemix's 10%.
    ///
    ///         ── WHAT IT COSTS THE BORROWER, STATED PLAINLY ────────────────────────────────────
    ///         Debt repays from yield, so `T = LTV / yield` and a fee f stretches it to
    ///         `T = LTV / (yield * (1-f))`. At 50% LTV and 8% yield that is 6.25 years -> 7.8.
    ///         Nobody pays this out of pocket; it lengthens the payoff date. Which is exactly why
    ///         §2.2's disclosure rule is load-bearing: the UI must show the projected payoff date
    ///         from the LIVE REALISED, POST-FEE yield. Charging the fee and quoting a pre-fee date
    ///         would be the dishonest version of this.
    ///
    ///         ── WHY IT IS CHARGED ON WHAT IS APPLIED, NOT ON THE ESCROW BALANCE ───────────────
    ///         The fee is proportional to the yield actually MOVED to service debt (see `harvest`),
    ///         never to yield sitting in the escrow compounding for the user. A fee on the standing
    ///         balance is the management-fee antipattern: it charges repeatedly for the same money,
    ///         and it would bill a user whose debt is already clear.
    uint16 public harvestFeeBps = 2_000;

    /// @notice Where the performance fee goes. **Zero disables the fee entirely.** This is not
    ///         tidiness: measured by removing it, an unset recipient makes `safeTransfer` revert
    ///         `ERC20InvalidReceiver` and **every harvest in the market fails** — so a deploy that
    ///         forgets this one address would brick the product's core function while looking
    ///         perfectly configured. The guard turns that into under-charging, which is recoverable
    ///         with one transaction (the GearVault fail-closed precedent).
    address public feeRecipient;

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
    event HarvestFeeSet(uint16 bps, address recipient);
    /// @dev Emitted alongside `Harvested` so the fee is independently indexable: the backend books
    ///      protocol revenue off THIS event, and never off a figure it derived itself.
    event HarvestFeeTaken(address indexed user, address indexed recipient, uint256 assets);

    error ZeroAmount();
    error NoEscrow();
    error LtvTooHigh();
    error Undercollateralised();
    error BufferUnhealthy();
    error NothingToHarvest();
    error FeeTooHigh();

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

    /// @notice Set the harvest performance fee and its recipient. Bounded by `MAX_HARVEST_FEE_BPS`,
    ///         which a stolen key cannot raise. Setting the recipient to zero turns the fee OFF.
    function setHarvestFee(uint16 bps, address recipient) external onlyOwner {
        if (bps > MAX_HARVEST_FEE_BPS) revert FeeTooHigh();
        harvestFeeBps = bps;
        feeRecipient = recipient;
        emit HarvestFeeSet(bps, recipient);
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

        // THE PERFORMANCE FEE comes off the yield BEFORE it services debt, so `net` is what this
        // harvest can actually repay. A zero recipient disables it (fail-safe: an unset recipient
        // under-charges rather than burning the yield).
        uint16 feeBps = feeRecipient == address(0) ? 0 : harvestFeeBps;
        uint256 net = yield_ - (yield_ * feeBps) / BPS;

        // Take the whole (net) yield unless it would clear more than is owed, in which case take
        // only what the debt needs — rounded UP, so the assets moved always cover the debt cleared
        // and never the other way round.
        uint256 take = net;
        uint256 asDebt = take * scale;
        if (asDebt > d) {
            take = (d + scale - 1) / scale; // ceil(d / scale)
            if (take > net) take = net;
            asDebt = take * scale;
            if (asDebt > d) asDebt = d;
        }

        // The fee is PROPORTIONAL TO WHAT WAS TAKEN, not to the escrow balance: fee / (take + fee)
        // == feeBps / BPS. When the debt is smaller than the yield, the untouched remainder keeps
        // compounding for the user and is never billed — which is what stops this becoming a
        // management fee that charges for the same money every harvest.
        //   Both branches satisfy `take + fee <= yield_`:
        //     debt-bound   take = need <= net = yield_(1-f)  =>  take + fee = need/(1-f) <= yield_
        //     yield-bound  take = net  = yield_(1-f)         =>  take + fee = yield_ exactly
        //   Integer division rounds the fee DOWN, which only widens the margin.
        uint256 fee = feeBps == 0 ? 0 : (take * feeBps) / (BPS - feeBps);
        if (take + fee > yield_) fee = yield_ - take; // defence in depth; unreachable by the above

        e.withdraw(take + fee, address(this));
        debtOf[user] = d - asDebt;

        if (fee > 0) {
            asset.safeTransfer(feeRecipient, fee);
            emit HarvestFeeTaken(user, feeRecipient, fee);
        }

        asset.forceApprove(address(transmuter), take);
        transmuter.fund(take);
        asset.forceApprove(address(transmuter), 0);

        emit Harvested(user, take, asDebt);
    }
}
