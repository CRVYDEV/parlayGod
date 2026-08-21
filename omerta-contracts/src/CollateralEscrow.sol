// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CollateralEscrow — one per (user, market). No co-mingling, ever.
/// @notice Design: `omerta-bank-protocol-design.md` §2.5. This is FiRM's central lesson and the
///         design records it as "not optional."
///
///         ── WHY THIS EXISTS, AND WHY IT DELETES A WHOLE BUG CLASS ─────────────────────────────
///         Alchemix pools every depositor's collateral into shared yield positions and tracks each
///         user's claim as internal SHARES. Runtime Verification's finding #1 against that design
///         was an accounting advantage available to large depositors — the kind of rounding bug
///         that only exists because a pool has to be divided.
///
///         **We do not divide a pool, because there is no pool.** Each user's collateral sits in
///         their own contract at their own address. Their position is a concrete token balance, not
///         a fraction of anything. So RV finding #1 — the INTERNAL pool-division rounding advantage —
///         is not *fixed* here, it is **unreachable**, which is a strictly stronger property and the
///         reason the design's own mention of shares accounting was dropped rather than implemented.
///
///         The escrow holds the EXTERNAL yield vault's ERC-4626 shares. Those are that vault's
///         shares, not ours — one balance, one owner, no internal share price for us to round.
///         A depositor's yield is simply the growth of `convertToAssets` on the shares they alone
///         hold, so one user's rounding can never move another user's balance: there is no shared
///         denominator between them.
///
///         ── WHAT THIS DOES NOT DELETE, AND WHERE THAT IS HANDLED (audit M-1) ──────────────────
///         Making OUR internal accounting bug unreachable is NOT the same as making the external
///         sleeve safe, and it is easy to conflate the two. Every escrow deploys into the SAME
///         shared ERC-4626 vault, so that vault's own first-depositor / inflation case is a real
///         surface: a griefer can donate to inflate its share price so a later deposit mints zero
///         shares (funds stranded) or few (value skimmed). That is the sleeve's bug, not this
///         contract's — and it is closed at the one place value enters. `deployToVault` RETURNS the
///         shares actually minted, and `Alchemist.deposit` credits principal only against value that
///         landed (`shares > 0` + a round-trip slippage floor). The residual expectation on the
///         sleeve is that it be inflation-resistant (an OZ 5.x virtual-shares, no-fee vault); the
///         on-chain guard is the backstop if it is not. So: internal pool-division rounding —
///         unreachable here; external first-depositor — bounded on-chain in the Alchemist.
///
///         ── THE TRUST MODEL, STATED PLAINLY ──────────────────────────────────────────────────
///         The escrow is DUMB. It holds tokens and obeys exactly one controller, set once at
///         construction and never changeable. All policy — loan-to-value, caps, timing — lives in
///         the Alchemist. That split is deliberate: it means auditing "can a user's collateral be
///         taken?" is reading this ~90-line file, not the whole protocol.
///
///         There is deliberately **no sweep, no rescue, no owner withdrawal**. A sweep is how an
///         escrow becomes a rug vector, and "recover a mistakenly-sent token" is not worth a
///         function that can move value out on a non-user's say-so. Tokens sent here directly by
///         mistake are lost; that is the correct trade for a contract whose entire job is custody.
contract CollateralEscrow {
    using SafeERC20 for IERC20;

    /// @notice The Alchemist for this market. Immutable — an escrow cannot be re-pointed.
    address public immutable controller;
    /// @notice The user this escrow belongs to. Recorded for off-chain attribution; the contract
    ///         itself never grants this address any authority (all calls come via the controller).
    address public immutable owner;
    /// @notice The underlying collateral asset (e.g. USDC).
    IERC20 public immutable asset;
    /// @notice The external ERC-4626 yield vault the collateral is deployed into.
    IERC4626 public immutable vault;

    error NotController();

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    constructor(address owner_, IERC20 asset_, IERC4626 vault_) {
        controller = msg.sender; // the Alchemist deploys these; nothing else can
        owner = owner_;
        asset = asset_;
        vault = vault_;
    }

    /// @notice Deploy `assets` (already transferred in by the controller) into the yield vault.
    /// @dev    The controller transfers first, then calls. Approving only `assets` each time —
    ///         never `type(uint256).max` — bounds what a compromised vault can take to what we
    ///         just deposited, rather than to everything this escrow will ever hold.
    function deployToVault(uint256 assets) external onlyController returns (uint256 shares) {
        asset.forceApprove(address(vault), assets);
        shares = vault.deposit(assets, address(this));
        asset.forceApprove(address(vault), 0); // leave no standing allowance
    }

    /// @notice Redeem enough shares to send exactly `assets` of underlying to `to`.
    function withdraw(uint256 assets, address to) external onlyController {
        vault.withdraw(assets, to, address(this));
    }

    /// @notice Redeem ALL shares to `to`. Used for a full exit, where asking for an exact amount
    ///         would leave dust stranded behind a rounding step.
    function withdrawAll(address to) external onlyController returns (uint256 assets) {
        uint256 shares = vault.balanceOf(address(this));
        if (shares == 0) return 0;
        assets = vault.redeem(shares, to, address(this));
    }

    /// @notice This user's collateral, valued in underlying.
    /// @dev    `convertToAssets` is the vault's own accounting and is not a price feed we read for
    ///         a borrow decision — the market is denomination-matched (§2.1), so there is no
    ///         exchange rate in the borrow path at all. This is "how much USDC do my vault shares
    ///         represent", which is the vault's own bookkeeping, not an oracle.
    function totalAssets() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }
}
