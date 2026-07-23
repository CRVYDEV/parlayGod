// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";

/// THE DEX SELL TAX — a flat, hard-capped, owner-armed tax on transfers INTO registered AMM
/// pairs, split 50/50 dev/buyback in the same transfer. Everything else moves 1:1.
contract OMRTaxTest is Test {
    OMR omr;
    address safe = makeAddr("safe");
    address dev = makeAddr("taxdev");
    address buyback = makeAddr("taxbuyback");
    address pool = makeAddr("pool");          // a registered AMM pair
    address otherPool = makeAddr("otherPool"); // NOT registered
    address seller = makeAddr("seller");
    address friend = makeAddr("friend");
    address polManager = makeAddr("polManager");

    function setUp() public {
        omr = new OMR(safe);
        vm.startPrank(safe);
        omr.transfer(seller, 10_000e18);
        omr.transfer(polManager, 10_000e18);
        omr.setTaxRecipients(dev, buyback);
        omr.setPair(pool, true);
        vm.stopPrank();
    }

    function _arm(uint256 bps) internal {
        vm.prank(safe);
        omr.setSellTax(bps);
    }

    function test_default_off_sell_moves_1to1() public {
        vm.prank(seller);
        omr.transfer(pool, 1000e18);
        assertEq(omr.balanceOf(pool), 1000e18, "tax off: the pool receives everything");
        assertEq(omr.balanceOf(dev), 0);
    }

    function test_sell_to_registered_pair_taxed_and_split() public {
        _arm(500); // 5%
        vm.prank(seller);
        omr.transfer(pool, 1000e18);
        assertEq(omr.balanceOf(pool), 950e18, "the pool receives value minus the tax");
        assertEq(omr.balanceOf(dev), 25e18, "half the tax -> the dev wallet");
        assertEq(omr.balanceOf(buyback), 25e18, "half the tax -> the buyback wallet");
        assertEq(omr.balanceOf(seller), 9_000e18, "the seller paid exactly the transfer amount");
    }

    function test_buy_and_wallet_transfers_untaxed() public {
        _arm(500);
        // a buy: pair -> wallet moves 1:1 (the pool is the sender, not the receiver)
        vm.prank(seller);
        omr.transfer(pool, 1000e18); // seed the pool (taxed sell)
        uint256 poolBal = omr.balanceOf(pool);
        vm.prank(pool);
        omr.transfer(friend, 100e18);
        assertEq(omr.balanceOf(friend), 100e18, "a buy is clean");
        assertEq(omr.balanceOf(pool), poolBal - 100e18);
        // wallet -> wallet is clean
        vm.prank(friend);
        omr.transfer(seller, 40e18);
        assertEq(omr.balanceOf(seller), 9_000e18 + 40e18, "a plain transfer is clean");
        // an UNREGISTERED pool is clean
        vm.prank(seller);
        omr.transfer(otherPool, 100e18);
        assertEq(omr.balanceOf(otherPool), 100e18, "an unregistered venue is never taxed");
    }

    function test_exempt_sender_untaxed() public {
        _arm(500);
        vm.prank(safe);
        omr.setExempt(polManager, true);
        vm.prank(polManager);
        omr.transfer(pool, 1000e18); // the POL manager adds liquidity tax-free
        assertEq(omr.balanceOf(pool), 1000e18, "an exempt sender moves 1:1 into the pool");
        assertEq(omr.balanceOf(dev), 0);
    }

    function test_hard_cap_and_recipients_required() public {
        vm.startPrank(safe);
        vm.expectRevert(OMR.BadBps.selector);
        omr.setSellTax(1001); // > MAX_SELL_TAX_BPS
        omr.setSellTax(1000); // the cap itself is fine
        vm.stopPrank();
        // a fresh token with no recipients cannot arm
        OMR bare = new OMR(safe);
        vm.prank(safe);
        vm.expectRevert(OMR.ZeroAddress.selector);
        bare.setSellTax(100);
    }

    function test_only_owner_configures() public {
        vm.startPrank(seller);
        vm.expectRevert();
        omr.setSellTax(100);
        vm.expectRevert();
        omr.setPair(otherPool, true);
        vm.expectRevert();
        omr.setExempt(seller, true);
        vm.expectRevert();
        omr.setTaxRecipients(seller, seller);
        vm.stopPrank();
    }

    /// fuzz: at any armed rate and amount, pool + dev + buyback receipts always sum to the
    /// amount sent — the tax redirects, it never mints or burns.
    function testFuzz_conservation(uint256 bps, uint256 amount) public {
        bps = bound(bps, 1, 1000);
        amount = bound(amount, 1, 10_000e18);
        _arm(bps);
        uint256 before = omr.balanceOf(seller);
        vm.prank(seller);
        omr.transfer(pool, amount);
        uint256 received = omr.balanceOf(pool) + omr.balanceOf(dev) + omr.balanceOf(buyback);
        assertEq(received, amount, "redirected, never minted/burned");
        assertEq(omr.balanceOf(seller), before - amount, "the seller pays exactly the amount");
    }
}
