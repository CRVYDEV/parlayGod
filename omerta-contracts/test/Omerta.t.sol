// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";
import {GearVault} from "../src/GearVault.sol";
import {VoucherClaim, IGearVault} from "../src/VoucherClaim.sol";
import {OMRStaking} from "../src/OMRStaking.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OmertaTest is Test {
    OMR omr;
    GearVault gear;
    VoucherClaim vc;
    OMRStaking staking;

    address safe = makeAddr("safe");
    uint256 signerPk = 0xA11CE;
    address signer;
    address player = makeAddr("player");

    uint256 constant TRANCHE = 1_000_000e18;
    uint256 constant DAILY_CAP = 50_000e18;

    function setUp() public {
        signer = vm.addr(signerPk);
        omr = new OMR(safe);
        gear = new GearVault(safe, "https://omerta.example/gear/");
        vc = new VoucherClaim(safe, signer, IERC20(address(omr)), IGearVault(address(gear)), DAILY_CAP);
        staking = new OMRStaking(safe, IERC20(address(omr)), 1400);
        vm.startPrank(safe);
        gear.setMinter(address(vc));
        vc.setGearSupplyCap(7, 1000);                // gear class 7 mintable up to 1000
        omr.transfer(address(vc), TRANCHE);          // tranche 1
        omr.approve(address(staking), type(uint256).max);
        staking.fundRewards(100_000e18);             // reward pool
        omr.transfer(player, 10_000e18);             // player working capital
        vm.stopPrank();
    }

    // ── helpers ──
    function _sign(VoucherClaim.Voucher memory v, uint256 pk) internal view returns (bytes memory) {
        VoucherClaim.Voucher[] memory a = new VoucherClaim.Voucher[](1); a[0] = v;
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, vc.hashVoucher(a[0]));
        return abi.encodePacked(r, s, vv);
    }

    function _voucher(address to, uint256 amount, uint8 kind, uint256 gearId, uint256 nonce)
        internal view returns (VoucherClaim.Voucher memory)
    {
        return VoucherClaim.Voucher(to, amount, kind, gearId, nonce, block.timestamp + 1 hours);
    }

    // ── OMR ──
    function test_supply_minted_to_safe_once() public view {
        assertEq(omr.totalSupply(), 100_000_000e18);
        assertEq(omr.balanceOf(safe) + TRANCHE + 100_000e18 + 10_000e18, 100_000_000e18);
    }

    // ── VoucherClaim: happy paths ──
    function test_claim_omr() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1_000e18, 0, 0, 1);
        vm.prank(player);
        vc.claim(v, _sign(v, signerPk));
        assertEq(omr.balanceOf(player), 11_000e18);
        assertTrue(vc.usedNonce(1));
    }

    function test_claim_gear_mints_1155() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1, 1, 7, 2);
        vm.prank(player);
        vc.claim(v, _sign(v, signerPk));
        assertEq(gear.balanceOf(player, 7), 1);
    }

    // ── AUDIT F-1: gear is fail-closed and bounded by a per-gearId cap ──
    // An uncapped gearId cannot mint at all (a compromised signer can't mint unknown gear).
    function test_gear_uncapped_class_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1, 1, 42, 20); // class 42 has no cap
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert("VC: gear cap");
        vm.prank(player); vc.claim(v, sig);
    }

    // The per-gearId lifetime cap bounds total supply — a leaked signer can't exceed it.
    function test_gear_cap_enforced() public {
        vm.prank(safe); vc.setGearSupplyCap(9, 2);
        VoucherClaim.Voucher memory v1 = _voucher(player, 2, 1, 9, 21);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk)); // mints 2 of 2
        assertEq(gear.balanceOf(player, 9), 2);
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 1, 9, 22);
        bytes memory s2 = _sign(v2, signerPk);
        vm.expectRevert("VC: gear cap"); // the 3rd exceeds the cap
        vm.prank(player); vc.claim(v2, s2);
    }

    function test_set_gear_cap_only_owner() public {
        vm.expectRevert();
        vc.setGearSupplyCap(1, 100);
        vm.prank(safe); vc.setGearSupplyCap(1, 100);
        assertEq(vc.gearSupplyCap(1), 100);
    }

    // ── AUDIT F-5: a deadline beyond the TTL backstop is rejected ──
    function test_deadline_too_far_reverts() public {
        VoucherClaim.Voucher memory v =
            VoucherClaim.Voucher(player, 100e18, 0, 0, 23, block.timestamp + 31 days);
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert("VC: deadline too far");
        vm.prank(player); vc.claim(v, sig);
    }

    // ── VoucherClaim: every gate ──
    function test_replay_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 3);
        bytes memory sig = _sign(v, signerPk);
        vm.prank(player); vc.claim(v, sig);
        vm.expectRevert("VC: replay");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_wrong_signer_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 4);
        bytes memory sig = _sign(v, 0xBAD);
        vm.expectRevert("VC: bad signature");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_expired_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 5);
        bytes memory sig = _sign(v, signerPk);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert("VC: expired");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_tampered_amount_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 6);
        bytes memory sig = _sign(v, signerPk);
        v.amount = 100_000e18; // player edits the voucher
        vm.expectRevert("VC: bad signature");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_pause_blocks_claims() public {
        vm.prank(safe); vc.pause();
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 7);
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert();
        vm.prank(player); vc.claim(v, sig);
    }

    function test_daily_cap_enforced_and_resets() public {
        VoucherClaim.Voucher memory v1 = _voucher(player, DAILY_CAP, 0, 0, 8);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk));
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 0, 0, 9);
        bytes memory s2 = _sign(v2, signerPk);
        vm.expectRevert("VC: daily cap");
        vm.prank(player); vc.claim(v2, s2);
        vm.warp(block.timestamp + 1 days); // next UTC day
        VoucherClaim.Voucher memory v3 = _voucher(player, 1, 0, 0, 10);
        vm.prank(player); vc.claim(v3, _sign(v3, signerPk));
    }

    function test_only_minter_can_mint_gear() public {
        vm.expectRevert("GearVault: not minter");
        gear.mint(player, 1, 1);
    }

    function test_sweep_only_owner() public {
        vm.expectRevert();
        vc.sweep(player, 1e18);
        vm.prank(safe); vc.sweep(safe, 1e18);
    }

    // ── FUZZ: any well-signed voucher claims exactly once; total out ≤ tranche ──
    function testFuzz_claims_bounded_by_tranche(uint96[8] memory amounts) public {
        vm.prank(safe); vc.setDailyCap(0); // isolate the tranche invariant
        uint256 totalOut;
        for (uint256 i = 0; i < 8; i++) {
            uint256 amt = uint256(amounts[i]) % 200_000e18;
            if (amt == 0) continue;
            VoucherClaim.Voucher memory v = _voucher(player, amt, 0, 0, 100 + i);
            bytes memory sig = _sign(v, signerPk);
            if (totalOut + amt <= TRANCHE) {
                vm.prank(player); vc.claim(v, sig);
                totalOut += amt;
            } else {
                vm.expectRevert(); // ERC20 transfer exceeds tranche balance
                vm.prank(player); vc.claim(v, sig);
            }
        }
        assertLe(totalOut, TRANCHE);
        assertEq(omr.balanceOf(address(vc)), TRANCHE - totalOut);
    }

    // ── Staking ──
    function test_stake_accrue_claim() public {
        vm.startPrank(player);
        omr.approve(address(staking), type(uint256).max);
        staking.stake(10_000e18);
        vm.warp(block.timestamp + 365 days);
        uint256 pending = staking.pendingRewards(player);
        assertApproxEqRel(pending, 1_400e18, 1e15); // 14% APY
        staking.claimRewards();
        assertEq(omr.balanceOf(player), 1_400e18 - (1_400e18 - pending)); // rewards received
        staking.unstake(10_000e18);
        vm.stopPrank();
        assertEq(staking.totalStaked(), 0);
    }

    function test_principal_withdrawable_when_pool_dry() public {
        vm.prank(safe); staking.setApy(5_000);
        vm.startPrank(player);
        omr.approve(address(staking), type(uint256).max);
        staking.stake(10_000e18);
        vm.warp(block.timestamp + 100 * 365 days); // accrue far beyond the pool
        vm.expectRevert("Staking: pool dry");
        staking.claimRewards();
        staking.unstake(10_000e18); // principal ALWAYS comes back
        vm.stopPrank();
        assertEq(omr.balanceOf(player), 10_000e18);
    }

    function test_apy_ceiling() public {
        vm.prank(safe);
        vm.expectRevert("Staking: apy too high");
        staking.setApy(5_001);
    }
}
