// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";

/// THE DEX SELL TAX — a flat, hard-capped, owner-armed tax on transfers INTO registered AMM
/// pairs, split THREE ways (dev / rwa float / LP) in the same transfer. Everything else moves 1:1.
contract OMRTaxTest is Test {
    OMR omr;
    address safe = makeAddr("safe");
    address dev = makeAddr("taxdev");
    address rwa = makeAddr("taxrwa");
    address lp = makeAddr("taxlp");
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
        omr.setTaxRecipients(dev, rwa, lp);
        omr.setPair(pool, true);
        vm.stopPrank();
    }

    /// arm at the v2 shape: the total, then dev + rwa, with LP taking the remainder. The default
    /// split here mirrors the backend's SELL_TAX (2 / 4 / 3 of 9) proportionally.
    function _arm(uint256 bps) internal {
        vm.prank(safe);
        omr.setSellTax(bps, (bps * 200) / 900, (bps * 400) / 900);
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
        // 500 bps armed as dev 111 / rwa 222 / lp remainder, of a 50e18 tax
        assertEq(omr.balanceOf(dev), (50e18 * 111) / 500, "the dev slice");
        assertEq(omr.balanceOf(rwa), (50e18 * 222) / 500, "the stock-float slice");
        assertEq(omr.balanceOf(lp), 50e18 - (50e18 * 111) / 500 - (50e18 * 222) / 500, "LP takes the remainder");
        assertEq(omr.balanceOf(dev) + omr.balanceOf(rwa) + omr.balanceOf(lp), 50e18, "and the three sum to the tax EXACTLY");
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
        omr.setSellTax(1001, 0, 0); // > MAX_SELL_TAX_BPS
        vm.expectRevert(OMR.BadBps.selector);
        omr.setSellTax(900, 500, 500); // the slices cannot exceed the total
        omr.setSellTax(1000, 200, 400); // the cap itself is fine
        vm.stopPrank();
        // a fresh token with no recipients cannot arm
        OMR bare = new OMR(safe);
        vm.prank(safe);
        vm.expectRevert(OMR.ZeroAddress.selector);
        bare.setSellTax(100, 20, 40);
    }

    function test_only_owner_configures() public {
        vm.startPrank(seller);
        vm.expectRevert();
        omr.setSellTax(100, 20, 40);
        vm.expectRevert();
        omr.setPair(otherPool, true);
        vm.expectRevert();
        omr.setExempt(seller, true);
        vm.expectRevert();
        omr.setTaxRecipients(seller, seller, seller);
        vm.expectRevert();
        omr.setMinter(seller); // v2 §4: the mint path is owner-only too
        vm.stopPrank();
    }

    /// fuzz: at any armed rate, SPLIT and amount, pool + the three tax receipts always sum to the
    /// amount sent — the tax redirects, it never mints or burns, and the remainder rule means the
    /// three slices leave no wei behind however the bps divide.
    function testFuzz_conservation(uint256 bps, uint256 devBps, uint256 rwaBps, uint256 amount) public {
        bps = bound(bps, 1, 1000);
        devBps = bound(devBps, 0, bps);
        rwaBps = bound(rwaBps, 0, bps - devBps);
        amount = bound(amount, 1, 10_000e18);
        vm.prank(safe);
        omr.setSellTax(bps, devBps, rwaBps);
        uint256 before = omr.balanceOf(seller);
        uint256 supplyBefore = omr.totalSupply();
        vm.prank(seller);
        omr.transfer(pool, amount);
        uint256 received = omr.balanceOf(pool) + omr.balanceOf(dev) + omr.balanceOf(rwa) + omr.balanceOf(lp);
        assertEq(received, amount, "redirected, never minted/burned");
        assertEq(omr.balanceOf(seller), before - amount, "the seller pays exactly the amount");
        assertEq(omr.totalSupply(), supplyBefore, "a sell never moves total supply -- only the mint path can");
    }

    // ── THE MINT PATH (tokenomics v2 §4) ─────────────────────────────────────────────────────────
    // The suite's oldest property was "nothing mints". It is gone; what has to hold now is that the
    // mint has exactly ONE door, it is shut by default, and the owner cannot walk through it.

    function test_mint_is_off_by_default_and_owner_cannot_print() public {
        assertEq(omr.minter(), address(0), "the token ships with minting OFF");
        vm.prank(safe);
        vm.expectRevert(OMR.NotMinter.selector);
        omr.mint(safe, 1e18); // the OWNER is not a minter — compromise of the Safe is not inflation
        vm.prank(seller);
        vm.expectRevert(OMR.NotMinter.selector);
        omr.mint(seller, 1e18);
    }

    function test_only_the_named_minter_mints_and_the_safe_can_revoke() public {
        address bondCtl = makeAddr("bond");
        uint256 supply0 = omr.totalSupply();
        vm.prank(safe);
        omr.setMinter(bondCtl);
        vm.prank(bondCtl);
        omr.mint(friend, 5e18);
        assertEq(omr.balanceOf(friend), 5e18, "the named minter mints");
        assertEq(omr.totalSupply(), supply0 + 5e18, "and supply moves by exactly that");
        // zero-address mint is refused even from the minter
        vm.prank(bondCtl);
        vm.expectRevert(OMR.ZeroAddress.selector);
        omr.mint(address(0), 1e18);
        // THE KILL SWITCH: one Safe transaction stops issuance without touching the bond contract
        vm.prank(safe);
        omr.setMinter(address(0));
        vm.prank(bondCtl);
        vm.expectRevert(OMR.NotMinter.selector);
        omr.mint(friend, 1e18);
    }
}
