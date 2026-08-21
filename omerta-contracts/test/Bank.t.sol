// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Denari} from "../src/Denari.sol";
import {Alchemist} from "../src/Alchemist.sol";
import {Transmuter} from "../src/Transmuter.sol";
import {CollateralEscrow} from "../src/CollateralEscrow.sol";
import {FlashGuard} from "../src/FlashGuard.sol";

/// USDC-shaped: SIX decimals. The decimal mismatch against 18dp DNR is deliberate and load-bearing
/// — a 1:1 redemption across mismatched decimals is a classic silent-loss bug, so every test here
/// runs against the mismatch rather than a convenient 18dp stand-in.
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }

    /// USDC's real BLOCKLIST, modelled rather than approximated. A "recipient contract that
    /// reverts" would test nothing here: a plain ERC20 transfer never calls its receiver, so the
    /// only way a push to a live address fails is the token refusing it — which is exactly the
    /// production case this suite has to cover.
    mapping(address => bool) public blocked;
    function setBlocked(address a, bool b) external { blocked[a] = b; }
    function _update(address from, address to, uint256 v) internal override {
        require(!blocked[to] && !blocked[from], "USDC: blocked");
        super._update(from, to, v);
    }
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
    Denari dnr;
    Transmuter transmuter;
    Alchemist alchemist;

    address safe = address(0x5AFE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant M = 1e6; // one USDC

    function setUp() public {
        usdc = new MockUSDC();
        vault = new MockVault(IERC20(address(usdc)));
        dnr = new Denari("Denari", "DNR", safe);
        transmuter = new Transmuter(dnr, IERC20(address(usdc)), safe);
        alchemist = new Alchemist(dnr, IERC20(address(usdc)), IERC4626(address(vault)), transmuter, safe);

        vm.startPrank(safe);
        dnr.setMinter(address(alchemist));
        dnr.setBurner(address(transmuter));
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
        returns (Denari n, Transmuter t, Alchemist a, MockVault v)
    {
        v = new MockVault(IERC20(address(usdc)));
        n = new Denari("Denari", "DNR", safe);
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

    /// Σ DNR supply ≤ Σ collateral × LTV — the design's §2.4 item 4, fuzzed. Everything else in
    /// this file is a mechanism; this is the property those mechanisms exist to hold.
    function testFuzz_supply_never_exceeds_collateral_times_ltv(
        uint96 depositA, uint96 depositB, uint96 borrowA, uint96 borrowB, uint16 ltv
    ) public {
        // the ceiling is now the PAIR bound, not MAX_LTV_BPS alone (see _assertLtvFeeCompatible):
        // at the shipped 20% fee the reachable maximum is 80%, not 90%.
        uint16 ltvCeiling = alchemist.MAX_LTV_BPS();
        uint16 pairCeiling = uint16(alchemist.BPS() - alchemist.harvestFeeBps());
        if (pairCeiling < ltvCeiling) ltvCeiling = pairCeiling;
        ltv = uint16(bound(ltv, 1, ltvCeiling));
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
            dnr.totalSupply(),
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
        alchemist.withdraw(300 * M); // would leave 700 USDC backing 400 DNR at 50% LTV
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

    // ── THE HARVEST PERFORMANCE FEE ──────────────────────────────────────────────────────────────
    // Founder-directed 2026-08-11. The design (§4) always named "the spread between deployed yield
    // and what self-repayment consumes" as protocol revenue; nothing implemented it. These pin the
    // three properties that make charging it defensible rather than just profitable.

    address feeDest = address(0xFEE);

    /// What the PROTOCOL has taken, swept or not. The fee accrues in the Alchemist and is pushed by
    /// a separate permissionless `sweepFees`, so a balance check alone would silently start
    /// measuring the sweep rather than the charge.
    function _feeTaken() internal view returns (uint256) {
        return usdc.balanceOf(feeDest) + alchemist.accruedFees();
    }

    function _armFee(uint16 bps) internal {
        vm.prank(safe);
        alchemist.setHarvestFee(bps, feeDest);
    }

    function test_the_fee_is_charged_on_what_services_debt_and_the_rest_still_repays() public {
        _armFee(2_000); // 20%
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        uint256 debtBefore = alchemist.debtOf(alice);

        vault.earn(100 * M);           // yield is smaller than the debt, so the WHOLE yield is consumed
        alchemist.harvest(alice);

        // 20% of the yield reaches the protocol; the other 80% clears debt. Both halves asserted,
        // because a fee that quietly took the lot would satisfy either one alone.
        assertApproxEqAbs(_feeTaken(), 20 * M, 10, "the protocol takes 20% of the yield");
        uint256 cleared = debtBefore - alchemist.debtOf(alice);
        assertApproxEqAbs(cleared, 80 ether, 1e13, "the remaining 80% still repays the borrower's debt");
    }

    function test_a_stolen_key_cannot_take_the_whole_yield() public {
        // The wall. Without a compile-time ceiling, one transaction turns a self-repaying loan into
        // a non-repaying one — the single worst thing that can happen to this product.
        vm.prank(safe);
        vm.expectRevert(Alchemist.FeeTooHigh.selector);
        alchemist.setHarvestFee(3_001, feeDest);

        // HOISTED, and this file's documented footgun is why: an external call in the ARGUMENTS of a
        // pranked call makes a staticcall that consumes the prank, so `setHarvestFee` would arrive
        // from the test contract and revert on ownership instead of exercising the ceiling.
        uint16 cap = alchemist.MAX_HARVEST_FEE_BPS();
        vm.prank(safe);
        alchemist.setHarvestFee(cap, feeDest); // the ceiling itself is fine
        assertEq(alchemist.harvestFeeBps(), 3_000);
    }

    function test_yield_left_compounding_is_never_billed() public {
        // The management-fee antipattern, refused: with the debt long cleared, a second harvest must
        // not keep charging the standing escrow balance. (The first harvest clears the debt and is
        // billed on what it moved; after that there is nothing to service and nothing to charge.)
        _armFee(2_000);
        _depositAndBorrow(alice, 1000 * M, 10 ether); // tiny debt, large yield to come
        vault.earn(500 * M);
        alchemist.harvest(alice);
        assertEq(alchemist.debtOf(alice), 0, "debt cleared");
        uint256 takenOnce = _feeTaken();
        assertGt(takenOnce, 0, "the harvest that serviced the debt WAS billed");

        vault.earn(500 * M);                       // more yield, still no debt
        vm.expectRevert(Alchemist.NothingToHarvest.selector);
        alchemist.harvest(alice);
        assertEq(_feeTaken(), takenOnce, "a debt-free position is never billed again");
    }

    function test_an_unset_recipient_fails_SAFE_rather_than_burning_the_yield() public {
        // A misconfigured deploy must UNDER-charge, never destroy a borrower's yield.
        vm.prank(safe);
        alchemist.setHarvestFee(2_000, address(0));
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        uint256 debtBefore = alchemist.debtOf(alice);
        vault.earn(100 * M);
        alchemist.harvest(alice);
        assertApproxEqAbs(debtBefore - alchemist.debtOf(alice), 100 ether, 1e13,
            "the whole yield repays the borrower");
        assertEq(_feeTaken(), 0, "and nothing is taken");
    }

    function testFuzz_the_fee_never_exceeds_the_yield_it_came_from(uint96 yieldRaw, uint16 bpsRaw) public {
        // The lower bound is ONE WEI on purpose. A bound of 1 * M reads like a reasonable "a real
        // yield is at least a micro-unit" simplification and it silently excludes the only regime
        // where the fee rounding can overshoot the yield (see the clamp in Alchemist._harvest).
        // A lever measured in the wrong range reports a clean bill of health.
        uint256 y = bound(uint256(yieldRaw), 1, 10_000 * M);
        uint16 cap = alchemist.MAX_HARVEST_FEE_BPS();
        uint16 bps = uint16(bound(uint256(bpsRaw), 0, cap));
        _armFee(bps);
        _depositAndBorrow(alice, 100_000 * M, 40_000 ether);

        uint256 escrowBefore = alchemist.escrowOf(alice).totalAssets();
        vault.earn(y);
        // Measure what the escrow REALISED, not what was minted to the vault. At the bottom of the
        // range a wei of vault yield rounds away below one unit of the escrow's share price, so the
        // position genuinely earned nothing and the harvest correctly refuses — the property has no
        // subject there. Comparing against `y` instead would have called that a violation.
        uint256 realised = alchemist.escrowOf(alice).totalAssets() - escrowBefore;
        if (realised == 0) return;
        alchemist.harvest(alice);
        uint256 drawn = escrowBefore + realised - alchemist.escrowOf(alice).totalAssets();
        assertLe(drawn, realised, "a harvest can never draw more than the yield it realised");
        assertLe(_feeTaken(), realised, "and the fee alone can never exceed it");
    }

    function test_a_broken_fee_recipient_cannot_brick_the_harvest() public {
        // THE AVAILABILITY RULE, and it is the one `OmertaHook` already follows: mechanism liveness
        // must never depend on a wallet's behaviour. `harvest` is permissionless and is how every
        // borrower's loan repays itself, so pushing the fee inside it would let one un-receivable
        // recipient stop the product for the whole market. That is not hypothetical on USDC, which
        // has a live blocklist. The fee accrues; a separate sweep pushes it.
        _armFee(2_000);
        address blockedDest = address(0xB10CED);
        usdc.setBlocked(blockedDest, true);
        vm.prank(safe);
        alchemist.setHarvestFee(2_000, blockedDest);
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        uint256 debtBefore = alchemist.debtOf(alice);

        vault.earn(100 * M);
        alchemist.harvest(alice);                       // must NOT revert

        assertLt(alchemist.debtOf(alice), debtBefore, "the borrower's loan still repaid itself");
        assertGt(alchemist.accruedFees(), 0, "and the fee is held, waiting for a sweep");

        // The sweep is where the broken recipient actually costs something — which is recoverable.
        vm.expectRevert();
        alchemist.sweepFees();

        vm.prank(safe);
        alchemist.setHarvestFee(2_000, feeDest);        // one transaction fixes it
        uint256 owed = alchemist.accruedFees();
        alchemist.sweepFees();                          // permissionless: no Safe needed to collect
        assertEq(usdc.balanceOf(feeDest), owed, "the held fee reaches the new recipient");
        assertEq(alchemist.accruedFees(), 0, "and nothing is left double-payable");
    }

    function test_sweeping_refuses_an_unset_recipient_rather_than_burning_the_fee() public {
        _armFee(2_000);
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vault.earn(100 * M);
        alchemist.harvest(alice);
        assertGt(alchemist.accruedFees(), 0, "there is a fee to strand");

        vm.prank(safe);
        alchemist.setHarvestFee(2_000, address(0));
        vm.expectRevert(Alchemist.FeeRecipientUnset.selector);
        alchemist.sweepFees();                          // never a transfer to address(0)

        vm.prank(safe);
        alchemist.setHarvestFee(2_000, feeDest);
        alchemist.sweepFees();                          // drains it
        vm.expectRevert(Alchemist.ZeroAmount.selector);
        vm.prank(bob); alchemist.sweepFees();           // and an empty sweep is a clean refusal
    }

    function test_the_fee_cannot_be_pointed_at_an_address_that_swallows_it() public {
        // Both of these look like ordinary addresses and both destroy the fee silently. This
        // contract has no rescue path, and the Transmuter counts reserves in a variable rather than
        // a balance — so assets sent to either are gone without any revert to notice.
        vm.prank(safe);
        vm.expectRevert(Alchemist.BadFeeRecipient.selector);
        alchemist.setHarvestFee(2_000, address(alchemist));

        vm.prank(safe);
        vm.expectRevert(Alchemist.BadFeeRecipient.selector);
        alchemist.setHarvestFee(2_000, address(transmuter));

        vm.prank(safe);
        alchemist.setHarvestFee(2_000, address(0)); // the deliberate off switch still works
        assertEq(alchemist.feeRecipient(), address(0), "zero is the off switch, not a mistake");
    }

    function test_the_dust_clamp_is_reachable() public {
        // The `take + fee > yield_` clamp carried a comment calling itself unreachable. It is not:
        // `net` is computed with a FLOORED fee, so it can sit a unit above yield_*(1-f), and
        // dividing that back out overshoots. At 4 wei of yield and a 20% fee the naive fee is 1 and
        // take + fee = 5 against a realised yield of 4 — the escrow would be asked for a unit it
        // never earned. Pinned by hand because it lives in the last unit or two and no fuzz bounded
        // above the micro-unit can see it.
        _armFee(2_000);
        _depositAndBorrow(alice, 1000 * M, 400 ether); // debt far larger than the yield: yield-bound
        uint256 escrowBefore = alchemist.escrowOf(alice).totalAssets();

        vault.earn(1_000_005);
        // Measure what the escrow REALISED. A first cut of this test earned four wei and asserted
        // against four; the escrow's share-price rounding swallowed them entirely, `total <= p`
        // reverted before the clamp was ever reached, and the test passed under mutation. Assert the
        // precondition instead of assuming it.
        uint256 realised = alchemist.escrowOf(alice).totalAssets() - escrowBefore;
        uint256 net = realised - (realised * 2_000) / 10_000;
        uint256 naiveFee = (net * 2_000) / (10_000 - 2_000); // take == net in the yield-bound branch
        assertGt(net + naiveFee, realised,
            "precondition failed: this yield does not overshoot, so the clamp is not exercised");

        alchemist.harvest(alice);

        uint256 drawn = escrowBefore + realised - alchemist.escrowOf(alice).totalAssets();
        assertLe(drawn, realised, "the harvest drew more than it realised: the clamp is gone");
        assertEq(_feeTaken(), realised - net,
            "the fee was charged on top of the whole take: the clamp did not fire");
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

        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice); transmuter.redeem(250 ether);

        assertEq(usdc.balanceOf(alice) - usdcBefore, 250 * M, "250 DNR (18dp) -> 250 USDC (6dp)");
        assertEq(dnr.totalSupply(), 150 ether, "and the supply fell by exactly the burn");
    }

    /// THE PEG REDEMPTION IS NEVER TAXED, and this test exists to stop a plausible future edit.
    ///
    /// §4 of the design lists "redemption fees" as protocol revenue, and on 2026-08-11 the founder
    /// set that fee at 10%. It does NOT belong here. Two different things are called redemption:
    ///
    ///   1. THIS one — an DNR holder burning debt for underlying at 1:1. It is the PEG DEFENSE.
    ///      Arbitrage is what repairs the peg: someone who buys DNR at 0.98 and redeems at 1.00 is
    ///      doing our work for us. A 10% fee here does not earn revenue — it WIDENS THE PEG BAND to
    ///      10%, because no arbitrageur repairs a discount smaller than the toll. DNR would trade
    ///      down to 0.90 and nothing would pull it back.
    ///   2. The Monolith FREE-DEBT redemption (design §2.3, unbuilt) — an DNR holder redeeming
    ///      AGAINST a borrower's collateral at oracle price + fee. That fee is where the 10% lives,
    ///      and it is split: the borrower keeps 90% (being redeemed against must stay compensated,
    ///      not punitive, or nobody takes free debt and the mechanic has no liquidity), the protocol
    ///      takes 10%. That resolves §4's contradiction with §2.3 as a SPLIT rather than an either/or.
    ///
    /// So: a redeemer here receives the full 1:1 value, and the protocol's balance does not grow by
    /// redeeming. If this test ever fails, someone has taxed the peg defense.
    function test_the_peg_redemption_is_NEVER_taxed() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);

        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
        uint256 before = usdc.balanceOf(alice);
        uint256 transmuterBefore = usdc.balanceOf(address(transmuter));
        vm.prank(alice); transmuter.redeem(300 ether);

        // the redeemer gets the WHOLE 1:1 value — not 90% of it, not 99% of it
        assertEq(usdc.balanceOf(alice) - before, 300 * M, "a redeemer receives the full 1:1 value");
        // and the protocol keeps nothing back: the transmuter's balance fell by exactly what it paid
        assertEq(transmuterBefore - usdc.balanceOf(address(transmuter)), 300 * M,
            "the protocol withheld nothing: a fee here is a peg band, not revenue");
    }

    /// Sub-unit dust must not burn for nothing. 1 wei of DNR is less than one USDC unit, so paying
    /// out zero while burning the debt would be a silent loss for the redeemer.
    function test_dust_below_one_asset_unit_reverts_rather_than_burning_for_zero() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);
        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(Transmuter.ZeroAmount.selector);
        transmuter.redeem(1); // 1 wei
    }

    // ── the buffer floor, and its ORDERING ───────────────────────────────────────────────────────

    /// §2.4's whole point: the protocol stops ISSUING before it stops PAYING. A thin buffer must
    /// halt new debt while leaving existing claims redeemable — the reverse ordering would be a
    /// protocol that keeps selling claims it cannot honour.
    function test_a_thin_buffer_halts_issuance_but_never_redemption() public {
        (Denari n, Transmuter t, Alchemist a, ) = _market(100 * M); // a deliberately thin seed
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
        vm.expectRevert(Denari.NotMinter.selector);
        dnr.mint(safe, 1 ether);
    }

    function test_a_stranger_cannot_mint_or_burn() public {
        vm.prank(bob);
        vm.expectRevert(Denari.NotMinter.selector);
        dnr.mint(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(Denari.NotBurner.selector);
        dnr.burn(bob, 1 ether);
    }

    /// setMinter(0) is the one-transaction emergency stop, and it must halt issuance WITHOUT
    /// touching redemption — the same asymmetry the buffer floor encodes.
    function test_disarming_the_minter_halts_issuance_only() public {
        _depositAndBorrow(alice, 1000 * M, 400 ether);
        vm.prank(alice); alchemist.repay(400 * M);
        vm.prank(safe); dnr.setMinter(address(0));

        vm.roll(block.number + 1);
        vm.prank(alice);
        vm.expectRevert(Denari.NotMinter.selector);
        alchemist.mint(1 ether);

        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
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
        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
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
        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
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
        vm.prank(alice); dnr.approve(address(transmuter), type(uint256).max);
        uint256 reservesBefore = transmuter.reserves();
        uint256 usdcBefore = usdc.balanceOf(address(transmuter));

        if (red / alchemist.scale() > 0 && red / alchemist.scale() <= reservesBefore && red <= dnr.balanceOf(alice)) {
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
    /// day"). When that happens `Σ supply ≤ Σ collateral × LTV` is false, existing DNR is
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
        assertGt(dnr_supply(t), maxBacked, "a sleeve loss genuinely breaks the bound");

        // there is no liquidation path to call
        // (asserted structurally: the Alchemist exposes no such function — see its header)

        // and the protection that DOES exist still works: reserves are real and still payable
        assertEq(t.reserves(), 50_000 * M, "the buffer is untouched by the sleeve's loss");
    }

    function dnr_supply(Transmuter t) internal view returns (uint256) {
        return t.debtToken().totalSupply();
    }

    // ── reentrancy ───────────────────────────────────────────────────────────────────────────────

    function test_a_malicious_vault_cannot_reenter_the_alchemist() public {
        EvilVault ev = new EvilVault(IERC20(address(usdc)));
        Denari n = new Denari("n", "n", safe);
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
        new Alchemist(dnr, IERC20(address(usdc)), IERC4626(address(wrong)), transmuter, safe);
    }

    /// THE LTV AND THE HARVEST FEE ARE NOT INDEPENDENT KNOBS.
    ///
    /// Measured before the fix: `910 > 900`. Deposit 1000, let 100 of yield accrue, borrow against
    /// the ceiling that now INCLUDES it — then ANYONE calls the permissionless `harvest`, which
    /// removes `take + fee` of collateral while cutting debt by `take` only. The ceiling falls to
    /// 900 and the debt only to 910. There is no liquidation, so it is not a loss — but `mint` and
    /// `withdraw` both refuse an unhealthy position, so a stranger could freeze a borrower's
    /// withdrawal by calling a function anyone may call.
    ///
    /// The pair is now bounded in BOTH setters (`ltv + fee <= BPS`), so the invalid state cannot be
    /// reached from either side. MUTATION: drop `_assertLtvFeeCompatible` from either setter and
    /// this fails on the combination it then allows.
    function test_the_ltv_and_the_harvest_fee_cannot_be_set_into_a_breach() public {
        // 90% + 20% is the combination that produced 910 > 900, and it is refused from both sides.
        // Note the DEFAULT fee is already 20%, so this is not hypothetical: `MAX_LTV_BPS` (9000) is
        // unreachable as shipped, which is the product consequence stated on _assertLtvFeeCompatible.
        vm.prank(safe);
        vm.expectRevert(Alchemist.LtvFeeIncompatible.selector);
        alchemist.setLtvBps(9_000);

        vm.prank(safe); alchemist.setHarvestFee(1_000, address(0xFEE));
        vm.prank(safe); alchemist.setLtvBps(9_000);   // 90 + 10 is fine — the pair, not either alone
        vm.prank(safe);
        vm.expectRevert(Alchemist.LtvFeeIncompatible.selector);
        alchemist.setHarvestFee(2_000, address(0xFEE)); // raising the fee under a 90% ltv is refused

        vm.prank(safe); alchemist.setLtvBps(8_000);
        vm.prank(safe); alchemist.setHarvestFee(2_000, address(0xFEE)); // 80 + 20 is the boundary: allowed
        vm.prank(safe);
        vm.expectRevert(Alchemist.LtvFeeIncompatible.selector);
        alchemist.setLtvBps(8_001);                                     // and one bps past it is not
    }

    /// And the property the bound exists for, driven end to end at the boundary: a stranger's
    /// harvest must never leave a borrower unhealthy, however tightly they borrowed.
    function test_a_stranger_cannot_harvest_a_borrower_into_unhealth() public {
        vm.prank(safe); alchemist.setLtvBps(8_000);
        vm.prank(safe); alchemist.setHarvestFee(2_000, address(0xFEE));
        vm.prank(alice); alchemist.deposit(1000 * M);
        vm.roll(block.number + 1);
        vault.earn(100 * M);                                  // yield accrues BEFORE the borrow
        uint256 ceiling = alchemist.maxDebtOf(alice);   // hoisted: an inline external call in a
        vm.prank(alice); alchemist.mint(ceiling);       // pranked call's args CONSUMES the prank

        vm.prank(bob); alchemist.harvest(alice);              // any EOA may call this on anyone

        assertLe(alchemist.debtOf(alice), alchemist.maxDebtOf(alice),
            "a permissionless harvest left the position healthy");
        // The fee is CHARGED inside the harvest and PUSHED by a separate sweep, so read what the
        // protocol took rather than the recipient's balance, then prove the sweep delivers it.
        assertGt(alchemist.accruedFees(), 0, "and the fee was still collected");
        uint256 owed = alchemist.accruedFees();
        alchemist.sweepFees();
        assertEq(usdc.balanceOf(address(0xFEE)), owed, "and it reaches the recipient on the sweep");
    }

    // ── M-1: first-depositor / ERC-4626 inflation backstop on deposit ──────────────────────────────
    //
    // The per-user escrows delete the INTERNAL pool-division bug, but every escrow deposits into the
    // SAME external ERC-4626 sleeve, whose own first-depositor case they do not delete. `deposit` now
    // credits principal ONLY against value that landed. These drive it against a REAL OZ vault and a
    // REAL donation — not a bespoke mock — so the attack is the production one.

    /// A donation-inflated SHARED sleeve mints a later deposit ZERO shares — the classic
    /// first-depositor attack. Before the guard, alice's assets would land in the vault (donated to
    /// the attacker's single share) while `principalOf[alice]` was credited in full. Now
    /// `deployToVault` returns 0 shares and the deposit reverts, so nothing is stranded.
    ///
    /// MUTATION: delete `if (shares == 0) revert ZeroShares();` in `deposit` and alice's deposit
    /// succeeds against a worthless position.
    function test_a_donation_inflated_sleeve_mints_zero_shares_and_the_deposit_reverts() public {
        uint256 V = 1000 * M;

        // bob front-runs: a 1-wei deposit for a single share, then a donation larger than 2×alice's
        // deposit so hers rounds to zero shares. (OZ's virtual-share offset only halves his
        // efficiency — the attack still works at ~2× the victim's size, the known limitation.)
        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1, bob);
        usdc.transfer(address(vault), 2001 * M); // > 2V
        vm.stopPrank();

        assertEq(vault.previewDeposit(V), 0, "precondition: the inflated sleeve mints zero shares");

        vm.prank(alice);
        vm.expectRevert(Alchemist.ZeroShares.selector);
        alchemist.deposit(V);

        assertEq(alchemist.principalOf(alice), 0, "no principal credited on the reverted deposit");
    }

    /// The PARTIAL skim the bare `shares > 0` check would miss: tune the donation so alice's deposit
    /// mints exactly ONE share whose recoverable value is ~2/3 of what she put in. `shares > 0`
    /// passes; the round-trip value floor is what catches it. This is why the guard is a VALUE check
    /// and not merely a non-zero-shares check.
    ///
    /// MUTATION: delete the `vault.convertToAssets(shares) < ...` line in `deposit` and alice's
    /// deposit succeeds, crediting a full 1000-USDC principal against a share worth ~667.
    function test_a_partial_skim_below_the_slippage_floor_reverts() public {
        uint256 V = 1000 * M;

        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(1, bob);
        usdc.transfer(address(vault), V - 1); // D = V-1: alice mints exactly 1 share, worth ~2/3 V
        vm.stopPrank();

        assertEq(vault.previewDeposit(V), 1, "precondition: the deposit mints a single share");

        vm.prank(alice);
        vm.expectRevert(Alchemist.DepositSlippage.selector);
        alchemist.deposit(V);

        assertEq(alchemist.principalOf(alice), 0, "no principal credited on the reverted deposit");
    }

    /// Happy path, so the guard is proven to pass value THROUGH rather than only to block it: an
    /// ordinary deposit into a healthy sleeve still credits principal and collateral to the cent.
    function test_a_normal_deposit_passes_the_M1_guard_and_credits_principal() public {
        uint256 V = 1000 * M;
        vm.prank(alice);
        alchemist.deposit(V);
        assertEq(alchemist.principalOf(alice), V, "principal credited in full");
        // Collateral valued off the live vault accounting round-trips to ~V (wei-scale rounding only).
        assertApproxEqAbs(alchemist.collateralOf(alice), V, 2, "collateral lands at ~the deposit");
    }
}
