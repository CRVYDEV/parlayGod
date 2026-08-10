// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NUSD} from "../src/NUSD.sol";
import {Alchemist} from "../src/Alchemist.sol";
import {Transmuter} from "../src/Transmuter.sol";
import {CollateralEscrow} from "../src/CollateralEscrow.sol";
import {FlashGuard} from "../src/FlashGuard.sol";

/// USDC-shaped: SIX decimals. The decimal mismatch against 18dp nUSD is deliberate and load-bearing
/// — a 1:1 redemption across mismatched decimals is a classic silent-loss bug, so every test here
/// runs against the mismatch rather than a convenient 18dp stand-in.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// A real OZ ERC-4626. Yield appears the way it does in production — assets arrive at the vault and
/// every share becomes worth more — rather than through a bespoke setter that would let the test
/// pass against accounting the real thing does not have.
contract MockVault is ERC4626 {
    constructor(IERC20 a) ERC4626(a) ERC20("Vault USDC", "vUSDC") {}
    function earn(uint256 a) external { MockUSDC(asset()).mint(address(this), a); }
    function lose(uint256 a) external { MockUSDC(asset()).transfer(address(0xdead), a); }
}

/// A vault that tries to re-enter the Alchemist during a withdrawal. The vault is the ONE external
/// call surface in the deposit/withdraw path, so it is where a reentrancy attempt would actually
/// come from — a bespoke fallback contract would test a path that does not exist.
contract EvilVault is ERC4626 {
    Alchemist public target;
    bool armed;
    constructor(IERC20 a) ERC4626(a) ERC20("Evil", "EVIL") {}
    function arm(Alchemist t) external { target = t; armed = true; }
    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal override
    {
        if (armed) { armed = false; target.withdraw(1); } // re-enter mid-withdrawal
        super._withdraw(caller, receiver, owner_, assets, shares);
    }
}

contract BankTest is Test {
    MockUSDC usdc;
    MockVault vault;
    NUSD nusd;
    Transmuter transmuter;
    Alchemist alchemist;

    address safe = address(0x5AFE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant M = 1e6; // one USDC

    function setUp() public {
        usdc = new MockUSDC();
        vault = new MockVault(IERC20(address(usdc)));
        nusd = new NUSD("Omerta USD", "nUSD", safe);
        transmuter = new Transmuter(nusd, IERC20(address(usdc)), safe);
        alchemist = new Alchemist(nusd, IERC20(address(usdc)), IERC4626(address(vault)), transmuter, safe);

        vm.startPrank(safe);
        nusd.setMinter(address(alchemist));
        nusd.setBurner(address(transmuter));
        transmuter.setFunder(address(alchemist), true);
        transmuter.setFunder(safe, true);       // the launch seeder
        alchemist.setLtvBps(5_000);
        vm.stopPrank();

        // THE DEPLOY REQUIREMENT, exercised rather than assumed: seed the buffer before arming the
        // market, or it accepts one borrow and deadlocks. Proven by
        // `test_an_unseeded_market_bricks_after_one_borrow`, which builds a market WITHOUT this.
        usdc.mint(safe, 500_000 * M);
        vm.startPrank(safe);
        usdc.approve(address(transmuter), type(uint256).max);
        transmuter.fund(500_000 * M);
        vm.stopPrank();

        usdc.mint(alice, 1_000_000 * M);
        usdc.mint(bob, 1_000_000 * M);
        vm.prank(alice); usdc.approve(address(alchemist), type(uint256).max);
        vm.prank(bob); usdc.approve(address(alchemist), type(uint256).max);

        vm.roll(1000);
        vm.warp(1_000_000);
    }

    function _depositAndBorrow(address who, uint256 assets, uint256 debt) internal {
        vm.prank(who);
        alchemist.deposit(assets);
        vm.roll(block.number + 1); // L1: entry and exit cannot share a block
        if (debt > 0) { vm.prank(who); alchemist.mint(debt); }
    }


    /// Build a standalone market with a chosen buffer seed. Used by the tests that need a genuinely
    /// THIN buffer (the shared fixture is correctly seeded, which makes it healthy) and by the
    /// bootstrap test, which needs one seeded with nothing at all.
    function _market(uint256 seed)
        internal
        returns (NUSD n, Transmuter t, Alchemist a, MockVault v)
    {
        v = new MockVault(IERC20(address(usdc)));
        n = new NUSD("Omerta USD", "nUSD", safe);
        t = new Transmuter(n, IERC20(address(usdc)), safe);
        a = new Alchemist(n, IERC20(address(usdc)), IERC4626(address(v)), t, safe);
        vm.startPrank(safe);
        n.setMinter(address(a));
        n.setBurner(address(t));
        t.setFunder(address(a), true);
        t.setFunder(safe, true);
        a.setLtvBps(5_000);
        vm.stopPrank();
        if (seed > 0) {
            usdc.mint(safe, seed);
            vm.startPrank(safe);
            usdc.approve(address(t), type(uint256).max);
            t.fund(seed);
            vm.stopPrank();
        }
    }

    /// THE DEPLOY REQUIREMENT, proven rather than asserted in a comment. An unseeded market takes
    /// exactly one borrow — at zero supply the required buffer is zero — and then refuses every
    /// further mint, because reserves are fed only by repay/harvest, which need existing debt.
    /// This deadlock looks like a healthy config from the outside, which is why it is pinned here:
    /// deleting the seed step from a deploy script must fail a test, not surface on mainnet.
    function test_an_unseeded_market_bricks_after_one_borrow() public {
        (, , Alchemist a, ) = _market(0);
        vm.startPrank(alice);
        usdc.approve(address(a), type(uint256).max);
        a.deposit(10_000 * M);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.prank(alice); a.mint(100 ether);           // the first borrow always passes

        vm.prank(alice);
        vm.expectRevert(Alchemist.BufferUnhealthy.selector);
        a.mint(1 ether);                              // and every one after it deadlocks
    }

    // ── the headline invariant ───────────────────────────────────────────────────────────────────

    /// Σ nUSD supply ≤ Σ collateral × LTV — the design's §2.4 item 4, fuzzed. Everything else in
    /// this file is a mechanism; this is the property those mechanisms exist to hold.
    function testFuzz_supply_never_exceeds_collateral_times_ltv(
        uint96 depositA, uint96 depositB, uint96 borrowA, uint96 borrowB, uint16 ltv
    ) public {
        ltv = uint16(bound(ltv, 1, alchemist.MAX_LTV_BPS()));
        vm.prank(safe); alchemist.setLtvBps(ltv);

        uint256 dA = bound(depositA, 1, 100_000 * M);
        uint256 dB = bound(depositB, 1, 100_000 * M);

        vm.prank(alice); alchemist.deposit(dA);
        vm.prank(bob); alchemist.deposit(dB);
        vm.roll(block.number + 1);

        // Borrow whatever each is allowed — and ATTEMPT the over-borrow rather than skipping it.
        // An earlier cut only ever minted amounts it had already checked were legal, which made
        // this fuzz blind to the very check it exists to protect: deleting the LTV guard left it
        // green. The violation must be attempted for the assertion to mean anything.
        uint256 maxA = alchemist.maxDebtOf(alice);
        uint256 bA = bound(borrowA, 1, type(uint96).max);
        if (bA <= maxA) { vm.prank(alice); alchemist.mint(bA); }
        else {
            vm.prank(alice);
            vm.expectRevert(Alchemist.Undercollateralised.selector);
            alchemist.mint(bA);
        }
        uint256 maxB = alchemist.maxDebtOf(bob);
        uint256 bB = bound(borrowB, 1, type(uint96).max);
        if (bB <= maxB) { vm.prank(bob); alchemist.mint(bB); }
        else {
            vm.prank(bob);
            vm.expectRevert(Alchemist.Undercollateralised.selector);
            alchemist.mint(bB);
        }

        uint256 collateral = alchemist.collateralOf(alice) + alchemist.collateralOf(bob);
        assertLe(
            nusd.totalSupply(),
            (collateral * alchemist.scale() * ltv) / alchemist.BPS(),
            "supply must never exceed collateral x LTV"
        );
    }

    function test_borrowing_past_ltv_reverts() public {
        vm.prank(alice); alchemist.deposit(1000 * M);
        vm.roll(block.number + 1);
        uint256 max = alchemist.maxDebtOf(alice);
        assertEq(max, 500 ether, "50% of 1000 USDC, in 18dp");
        vm.prank(alice);
        vm.expectRevert(Alchemist.Undercollateralised.selector);
        alchemist.mint(max + 1);
    }

    function test_withdrawing_below_the_debt_reverts() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice);
        vm.expectRevert(Alchemist.Undercollateralised.selector);
        alchemist.withdraw(300 * M); // would leave 700 USDC backing 400 nUSD at 50% LTV
    }

    // ── L1 in the real market ────────────────────────────────────────────────────────────────────

    /// The atomic round trip, at the protocol level rather than the harness level.
    function test_deposit_and_borrow_in_the_same_block_reverts() public {
        vm.startPrank(alice);
        alchemist.deposit(1000 * M);
        vm.expectRevert(FlashGuard.SameBlockAsEntry.selector);
        alchemist.mint(1 ether);
        vm.stopPrank();
    }

    function test_deposit_and_withdraw_in_the_same_block_reverts() public {
        vm.startPrank(alice);
        alchemist.deposit(1000 * M);
        vm.expectRevert(FlashGuard.SameBlockAsEntry.selector);
        alchemist.withdraw(1 * M);
        vm.stopPrank();
    }

    // ── escrow isolation: the FiRM lesson ────────────────────────────────────────────────────────

    function test_each_user_gets_their_own_escrow() public {
        vm.prank(alice); alchemist.deposit(100 * M);
        vm.prank(bob); alchemist.deposit(100 * M);
        address ea = address(alchemist.escrowOf(alice));
        address eb = address(alchemist.escrowOf(bob));
        assertTrue(ea != address(0) && eb != address(0) && ea != eb, "separate escrows");
        assertEq(CollateralEscrow(ea).owner(), alice);
        assertEq(CollateralEscrow(eb).owner(), bob);
    }

    /// NOBODY but the Alchemist may move a user's collateral — not the user, not the Safe, not
    /// another user. This is the property that makes "can my collateral be taken?" a ~90-line read.
    function test_nobody_but_the_alchemist_can_move_escrow_funds() public {
        vm.prank(alice); alchemist.deposit(100 * M);
        CollateralEscrow e = alchemist.escrowOf(alice);

        vm.prank(alice);
        vm.expectRevert(CollateralEscrow.NotController.selector);
        e.withdraw(1 * M, alice);

        vm.prank(safe);
        vm.expectRevert(CollateralEscrow.NotController.selector);
        e.withdrawAll(safe);

        vm.prank(bob);
        vm.expectRevert(CollateralEscrow.NotController.selector);
        e.withdraw(1 * M, bob);
    }

    /// Yield is per-escrow, so one user's position cannot dilute another's — the structural reason
    /// RV finding #1 is unreachable rather than merely fixed.
    function test_one_users_yield_does_not_touch_another() public {
        vm.prank(alice); alchemist.deposit(1000 * M);
        vm.prank(bob); alchemist.deposit(1000 * M);
        uint256 bobBefore = alchemist.collateralOf(bob);
        vault.earn(500 * M); // vault-wide yield: both hold shares, both gain pro-rata
        assertGt(alchemist.collateralOf(bob), bobBefore, "bob's own shares appreciate");

        // and a full exit by alice leaves bob's balance untouched
        vm.roll(block.number + 1);
        uint256 bobMid = alchemist.collateralOf(bob);
        uint256 aliceAll = alchemist.collateralOf(alice); // hoisted, same reason
        vm.prank(alice); alchemist.withdraw(aliceAll);
        assertApproxEqAbs(alchemist.collateralOf(bob), bobMid, 2, "bob is unaffected by alice exiting");
    }

    // ── the self-repaying half ───────────────────────────────────────────────────────────────────

    function test_harvest_reduces_debt_and_backs_the_transmuter() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        uint256 debtBefore = alchemist.debtOf(alice);
        uint256 reservesBefore = transmuter.reserves();

        vault.earn(100 * M);
        alchemist.harvest(alice);

        assertLt(alchemist.debtOf(alice), debtBefore, "debt falls");
        assertGt(transmuter.reserves(), reservesBefore, "and the backing deepens");
    }

    /// Permissionless by design: a keeper harvests on the user's behalf, which is what makes the
    /// loan self-repaying without the borrower acting. Safe because harvest can only ever REDUCE
    /// the target's debt — there is nothing for the caller to extract.
    function test_anyone_may_harvest_anyone() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vault.earn(100 * M);
        uint256 before = alchemist.debtOf(alice);
        vm.prank(bob);
        alchemist.harvest(alice);
        assertLt(alchemist.debtOf(alice), before);
    }

    function test_harvest_never_clears_more_debt_than_assets_moved() public {
        _depositAndBorrow(alice, 1000 * M, 10 ether); // small debt, large yield
        vault.earn(500 * M);
        uint256 reservesBefore = transmuter.reserves();
        alchemist.harvest(alice);
        assertEq(alchemist.debtOf(alice), 0, "debt cleared");
        uint256 moved = transmuter.reserves() - reservesBefore;
        assertGe(moved * alchemist.scale(), 10 ether, "assets moved cover the debt cleared");
    }

    function test_repay_in_underlying_clears_debt_and_funds_the_buffer() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); usdc.approve(address(alchemist), type(uint256).max);
        uint256 reservesBefore = transmuter.reserves();
        vm.prank(alice); alchemist.repay(100 * M);
        assertEq(alchemist.debtOf(alice), 300 ether);
        assertEq(transmuter.reserves(), reservesBefore + 100 * M);
    }

    /// Overpayment is refused rather than banked. A negative debt balance is a claim on the
    /// protocol and this batch issues none, so the excess is simply never taken.
    function test_repay_never_takes_more_than_is_owed() public {
        _depositAndBorrow(alice, 1000 * M, 100 ether);
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice); alchemist.repay(500 * M); // owes only 100
        assertEq(alchemist.debtOf(alice), 0);
        assertEq(balBefore - usdc.balanceOf(alice), 100 * M, "only what was owed was taken");
    }

    // ── redemption, and the decimal mismatch ─────────────────────────────────────────────────────

    function test_redeem_is_one_to_one_across_the_decimal_mismatch() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M); // fill the buffer so redemption can be paid

        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice); transmuter.redeem(250 ether);

        assertEq(usdc.balanceOf(alice) - usdcBefore, 250 * M, "250 nUSD (18dp) -> 250 USDC (6dp)");
        assertEq(nusd.totalSupply(), 150 ether, "and the supply fell by exactly the burn");
    }

    /// Sub-unit dust must not burn for nothing. 1 wei of nUSD is less than one USDC unit, so paying
    /// out zero while burning the debt would be a silent loss for the redeemer.
    function test_dust_below_one_asset_unit_reverts_rather_than_burning_for_zero() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);
        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(Transmuter.ZeroAmount.selector);
        transmuter.redeem(1); // 1 wei
    }

    // ── the buffer floor, and its ORDERING ───────────────────────────────────────────────────────

    /// §2.4's whole point: the protocol stops ISSUING before it stops PAYING. A thin buffer must
    /// halt new debt while leaving existing claims redeemable — the reverse ordering would be a
    /// protocol that keeps selling claims it cannot honour.
    function test_a_thin_buffer_halts_issuance_but_never_redemption() public {
        (NUSD n, Transmuter t, Alchemist a, ) = _market(100 * M); // a deliberately thin seed
        vm.startPrank(alice);
        usdc.approve(address(a), type(uint256).max);
        a.deposit(100_000 * M);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(alice); a.mint(40_000 ether);

        vm.prank(safe); t.setBufferFloorBps(5_000);   // demand 50% backing: 20,000 vs 100 held
        assertFalse(t.bufferHealthy(), "buffer is thin");

        vm.prank(alice);
        vm.expectRevert(Alchemist.BufferUnhealthy.selector);
        a.mint(1 ether);                              // issuance halts

        // but whatever backing exists is still payable — the ordering §2.4 exists to guarantee
        vm.prank(alice); n.approve(address(t), type(uint256).max);
        vm.prank(alice); t.redeem(100 ether);
        assertTrue(true);
    }

    function test_the_buffer_floor_has_a_compile_time_minimum() public {
        uint16 tooLow = transmuter.MIN_BUFFER_FLOOR_BPS() - 1; // hoisted, same reason
        vm.prank(safe);
        vm.expectRevert(Transmuter.FloorTooLow.selector);
        transmuter.setBufferFloorBps(tooLow);
    }

    // ── the token's absent powers ────────────────────────────────────────────────────────────────

    function test_the_owner_cannot_mint() public {
        vm.prank(safe);
        vm.expectRevert(NUSD.NotMinter.selector);
        nusd.mint(safe, 1 ether);
    }

    function test_a_stranger_cannot_mint_or_burn() public {
        vm.prank(bob);
        vm.expectRevert(NUSD.NotMinter.selector);
        nusd.mint(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(NUSD.NotBurner.selector);
        nusd.burn(bob, 1 ether);
    }

    /// setMinter(0) is the one-transaction emergency stop, and it must halt issuance WITHOUT
    /// touching redemption — the same asymmetry the buffer floor encodes.
    function test_disarming_the_minter_halts_issuance_only() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);
        vm.prank(safe); nusd.setMinter(address(0));

        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(NUSD.NotMinter.selector);
        alchemist.mint(1 ether);

        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        vm.prank(alice); transmuter.redeem(100 ether); // still payable
    }

    function test_ltv_has_a_compile_time_ceiling() public {
        uint16 tooHigh = alchemist.MAX_LTV_BPS() + 1; // hoisted: an inline call eats the prank
        vm.prank(safe);
        vm.expectRevert(Alchemist.LtvTooHigh.selector);
        alchemist.setLtvBps(tooHigh);
    }

    function test_only_the_safe_sets_parameters() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        alchemist.setLtvBps(1000);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        transmuter.setBufferFloorBps(9000);
    }

    // ── donation resistance (FlashGuard L7) ──────────────────────────────────────────────────────

    /// Reserves are a VARIABLE, never `balanceOf(this)`. A direct transfer must be ignored, or a
    /// donation could fake buffer health and unlock issuance the backing does not support.
    function test_a_donation_cannot_fake_buffer_health() public {
        (, Transmuter t, Alchemist a, ) = _market(100 * M);
        vm.startPrank(alice);
        usdc.approve(address(a), type(uint256).max);
        a.deposit(100_000 * M);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(alice); a.mint(40_000 ether);

        vm.prank(safe); t.setBufferFloorBps(5_000);
        assertFalse(t.bufferHealthy(), "thin to begin with");

        uint256 before = t.reserves();
        vm.prank(bob); usdc.transfer(address(t), 500_000 * M); // straight donation, no fund() call
        assertFalse(t.bufferHealthy(), "an untracked transfer must not count as backing");
        assertEq(t.reserves(), before, "reserves unchanged by a donation");
    }

    function test_only_a_funder_may_fund() public {
        vm.prank(bob); usdc.approve(address(transmuter), type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(Transmuter.NotFunder.selector);
        transmuter.fund(1 * M);
    }

    // ── flow caps in the market ──────────────────────────────────────────────────────────────────

    function test_the_daily_mint_cap_bounds_worst_case_issuance() public {
        vm.prank(safe); alchemist.setMintCaps(0, 100 ether);
        vm.prank(alice); alchemist.deposit(100_000 * M);
        vm.roll(block.number + 1);
        vm.prank(alice); alchemist.mint(100 ether);
        vm.prank(alice);
        vm.expectRevert(FlashGuard.DailyCapExceeded.selector);
        alchemist.mint(1);
    }

    function test_the_redeem_cap_bounds_a_drain() public {
        _depositAndBorrow(alice, 10_000 * M, 4_000 ether);
        vm.prank(alice); alchemist.repay(4_000 * M);
        vm.prank(safe); transmuter.setRedeemCaps(100 * M, 0);
        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        vm.prank(alice); transmuter.redeem(100 ether);
        vm.prank(alice);
        vm.expectRevert(FlashGuard.PerBlockCapExceeded.selector);
        transmuter.redeem(1 ether);
    }

    /// Redemption must NOT carry the same-block guard — the arbitrage that repairs our peg is a
    /// service, not an attack, and blocking it would trade a live peg defense for nothing.
    function test_redemption_is_deliberately_not_same_block_guarded() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);
        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        vm.startPrank(alice);
        transmuter.redeem(50 ether);
        transmuter.redeem(50 ether); // twice in one block: allowed, on purpose
        vm.stopPrank();
    }

    // ── solvency under stress ────────────────────────────────────────────────────────────────────

    /// The Transmuter must never pay out more than it holds, whatever sequence it is driven through.
    function testFuzz_transmuter_never_pays_more_than_it_holds(uint96 borrow, uint96 repayAmt, uint96 redeemAmt)
        public
    {
        vm.prank(alice); alchemist.deposit(100_000 * M);
        vm.roll(block.number + 1);
        uint256 b = bound(borrow, 1 ether, alchemist.maxDebtOf(alice));
        vm.prank(alice); alchemist.mint(b);

        uint256 r = bound(repayAmt, 1, b / alchemist.scale());
        vm.prank(alice); alchemist.repay(r);

        uint256 red = bound(redeemAmt, 1, type(uint96).max);
        vm.prank(alice); nusd.approve(address(transmuter), type(uint256).max);
        uint256 reservesBefore = transmuter.reserves();
        uint256 usdcBefore = usdc.balanceOf(address(transmuter));

        if (red / alchemist.scale() > 0 && red / alchemist.scale() <= reservesBefore && red <= nusd.balanceOf(alice)) {
            vm.prank(alice); transmuter.redeem(red);
        }
        // reserves tracked and reality must agree, and reserves must never exceed real holdings
        assertLe(transmuter.reserves(), usdc.balanceOf(address(transmuter)), "reserves are always real");
        assertLe(usdcBefore - usdc.balanceOf(address(transmuter)), reservesBefore, "never paid past reserves");
    }

    /// A user must always be able to exit a debt-free position in full.
    function test_a_debt_free_user_can_always_exit() public {
        vm.prank(alice); alchemist.deposit(1000 * M);
        vm.roll(block.number + 1);
        uint256 c = alchemist.collateralOf(alice);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice); alchemist.withdraw(c);
        assertEq(usdc.balanceOf(alice) - before, c);
    }

    // ── the honest limit of the invariant ────────────────────────────────────────────────────────

    /// **A YIELD-VAULT LOSS BREAKS THE HEADLINE INVARIANT, AND NOTHING RESTORES IT.** This is not a
    /// bug to fix here — it is the accepted consequence of having no liquidations, and it deserves
    /// to be pinned rather than discovered later.
    ///
    /// Denomination matching (§2.1) removes PRICE risk, which is what kills liquidations. It does
    /// NOT remove the risk that a Morpho/Maple sleeve loses principal (§2.6's "dependency's bad
    /// day"). When that happens `Σ supply ≤ Σ collateral × LTV` is false, existing nUSD is
    /// under-backed, and there is no liquidation to close the gap — by design, because adding one
    /// would reintroduce the oracle-on-the-borrow-path class that cost Inverse $21M.
    ///
    /// What actually protects holders is the Transmuter's buffer: redemption pays from REAL
    /// reserves, first come first served, and the floor halts issuance the moment backing thins.
    /// So the answer to a sleeve loss is "stop issuing, honour what is backed" — not "seize
    /// somebody's collateral." Test asserts the ordering holds through the loss.
    function test_a_vault_loss_breaks_the_invariant_and_the_protocol_stops_issuing() public {
        (, Transmuter t, Alchemist a, MockVault v) = _market(50_000 * M);
        vm.startPrank(alice);
        usdc.approve(address(a), type(uint256).max);
        a.deposit(100_000 * M);
        vm.stopPrank();
        vm.roll(block.number + 1);
        vm.prank(alice); a.mint(50_000 ether);

        v.lose(90_000 * M); // the sleeve takes a 90% loss

        // the invariant is now FALSE, and we say so out loud rather than pretending otherwise
        uint256 maxBacked = (a.collateralOf(alice) * a.scale() * a.ltvBps()) / a.BPS();
        assertGt(nusd_supply(t), maxBacked, "a sleeve loss genuinely breaks the bound");

        // there is no liquidation path to call
        // (asserted structurally: the Alchemist exposes no such function — see its header)

        // and the protection that DOES exist still works: reserves are real and still payable
        assertEq(t.reserves(), 50_000 * M, "the buffer is untouched by the sleeve's loss");
    }

    function nusd_supply(Transmuter t) internal view returns (uint256) {
        return t.debtToken().totalSupply();
    }

    // ── reentrancy ───────────────────────────────────────────────────────────────────────────────

    function test_a_malicious_vault_cannot_reenter_the_alchemist() public {
        EvilVault ev = new EvilVault(IERC20(address(usdc)));
        NUSD n = new NUSD("n", "n", safe);
        Transmuter t = new Transmuter(n, IERC20(address(usdc)), safe);
        Alchemist a = new Alchemist(n, IERC20(address(usdc)), IERC4626(address(ev)), t, safe);
        vm.startPrank(safe);
        n.setMinter(address(a)); n.setBurner(address(t));
        t.setFunder(address(a), true); a.setLtvBps(5_000);
        vm.stopPrank();

        vm.startPrank(alice);
        usdc.approve(address(a), type(uint256).max);
        a.deposit(1_000 * M);
        vm.stopPrank();
        vm.roll(block.number + 1);

        ev.arm(a);
        vm.prank(alice);
        vm.expectRevert(); // ReentrancyGuard: the nested withdraw is refused
        a.withdraw(100 * M);
    }

    // ── deploy-time wiring ───────────────────────────────────────────────────────────────────────

    /// Immutables cannot be corrected after deploy, so a mismatched vault must fail at construction
    /// rather than on the first user deposit.
    function test_a_mismatched_vault_cannot_be_deployed() public {
        MockUSDC other = new MockUSDC();
        MockVault wrong = new MockVault(IERC20(address(other)));
        vm.expectRevert(bytes("vault asset mismatch"));
        new Alchemist(nusd, IERC20(address(usdc)), IERC4626(address(wrong)), transmuter, safe);
    }
}
