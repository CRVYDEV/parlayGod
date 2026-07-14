// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";
import {GearVault} from "../src/GearVault.sol";
import {VoucherClaim, IGearVault} from "../src/VoucherClaim.sol";
import {OMRStaking} from "../src/OMRStaking.sol";
import {OmertaFees} from "../src/OmertaFees.sol";
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

    // ── §11 OmertaFees: exact-fee entry/revive tollbooth, ETH straight to the dev wallet ──
    function _fees() internal returns (OmertaFees f, address payable dev) {
        dev = payable(makeAddr("dev"));
        f = new OmertaFees(safe, dev, 0.01 ether, 0.10 ether);
    }

    function test_mint_fee_forwards_to_dev_and_emits() public {
        (OmertaFees f, address payable dev) = _fees();
        vm.deal(player, 1 ether);
        uint256 devBefore = dev.balance;
        vm.expectEmit(true, true, false, true, address(f));
        emit OmertaFees.MintFeePaid(player, 1, 0.01 ether);
        vm.prank(player);
        f.payMintFee{value: 0.01 ether}();
        assertEq(dev.balance, devBefore + 0.01 ether, "ETH forwarded to dev wallet");
        assertEq(address(f).balance, 0, "contract custodies nothing");
        assertEq(f.nonce(), 1, "nonce advanced");
    }

    function test_respawn_fee_forwards_and_nonce_monotonic() public {
        (OmertaFees f, address payable dev) = _fees();
        vm.deal(player, 1 ether);
        vm.startPrank(player);
        f.payMintFee{value: 0.01 ether}();       // nonce 1
        vm.expectEmit(true, true, false, true, address(f));
        emit OmertaFees.RespawnFeePaid(player, 2, 0.10 ether);
        f.payRespawnFee{value: 0.10 ether}();     // nonce 2
        vm.stopPrank();
        assertEq(dev.balance, 0.11 ether, "both fees reached the dev wallet");
        assertEq(f.nonce(), 2, "monotonic nonce");
    }

    function test_wrong_fee_reverts() public {
        (OmertaFees f, ) = _fees();
        vm.deal(player, 1 ether);
        vm.startPrank(player);
        vm.expectRevert(abi.encodeWithSelector(OmertaFees.WrongFee.selector, 0.02 ether, 0.01 ether));
        f.payMintFee{value: 0.02 ether}();
        vm.expectRevert(abi.encodeWithSelector(OmertaFees.WrongFee.selector, 0, 0.10 ether));
        f.payRespawnFee{value: 0}();
        vm.stopPrank();
    }

    function test_only_owner_sets_fees_and_recipient() public {
        (OmertaFees f, ) = _fees();
        vm.startPrank(player);
        vm.expectRevert();
        f.setFees(1, 2);
        vm.expectRevert();
        f.setFeeRecipient(payable(player));       // setFeeRecipient is also owner-gated
        vm.stopPrank();
        address payable dev2 = payable(makeAddr("dev2"));
        vm.startPrank(safe);
        f.setFees(0.02 ether, 0.20 ether);
        f.setFeeRecipient(dev2);
        vm.stopPrank();
        assertEq(f.mintFee(), 0.02 ether);
        assertEq(f.feeRecipient(), dev2);
        vm.deal(player, 1 ether);
        vm.prank(player);
        f.payMintFee{value: 0.02 ether}();       // new fee + new recipient in effect
        assertEq(dev2.balance, 0.02 ether);
    }

    function test_zero_fee_and_zero_address_rejected() public {
        address payable dev = payable(makeAddr("dev"));
        vm.expectRevert(OmertaFees.ZeroFee.selector);
        new OmertaFees(safe, dev, 0, 0.10 ether);              // ctor: zero mint fee
        vm.expectRevert(OmertaFees.ZeroAddress.selector);
        new OmertaFees(safe, payable(address(0)), 0.01 ether, 0.10 ether);
        (OmertaFees f, ) = _fees();
        vm.startPrank(safe);
        vm.expectRevert(OmertaFees.ZeroFee.selector);
        f.setFees(0, 1);                                        // setter: zero fee blocked (no free credits)
        vm.expectRevert(OmertaFees.ZeroAddress.selector);
        f.setFeeRecipient(payable(address(0)));
        vm.stopPrank();
    }

    function test_forward_failure_reverts_the_fee() public {
        RejectETH bad = new RejectETH();
        OmertaFees f = new OmertaFees(safe, payable(address(bad)), 0.01 ether, 0.10 ether);
        vm.deal(player, 1 ether);
        vm.prank(player);
        vm.expectRevert(OmertaFees.ForwardFailed.selector);    // recipient rejects → whole fee unwinds, no partial state
        f.payMintFee{value: 0.01 ether}();
        assertEq(f.nonce(), 0, "nonce rolled back on revert");
    }

    function test_sweep_routes_to_owner_not_recipient() public {
        (OmertaFees f, address payable dev) = _fees();
        vm.deal(address(f), 1 ether);                          // force-pushed ETH lands on the contract
        uint256 safeBefore = safe.balance;
        vm.prank(safe);
        f.sweep();
        assertEq(safe.balance, safeBefore + 1 ether, "sweep goes to owner (Safe), not feeRecipient");
        assertEq(dev.balance, 0, "recipient untouched by sweep");
        assertEq(address(f).balance, 0);
    }

    function test_reentrant_recipient_is_blocked() public {
        ReentrantDev bad = new ReentrantDev();
        OmertaFees f = new OmertaFees(safe, payable(address(bad)), 0.01 ether, 0.10 ether);
        bad.arm(f);
        vm.deal(player, 1 ether);
        vm.prank(player);
        vm.expectRevert();                                     // re-entry hits nonReentrant → forward fails → tx unwinds
        f.payMintFee{value: 0.01 ether}();
    }
}

/// Recipient that rejects all ETH — exercises the ForwardFailed / DoS path.
contract RejectETH {
    receive() external payable { revert("no ETH"); }
}

/// Malicious recipient that tries to re-enter payMintFee on receive().
contract ReentrantDev {
    OmertaFees private fees;
    function arm(OmertaFees f) external { fees = f; }
    receive() external payable {
        if (address(fees) != address(0) && address(fees).balance == 0) {
            fees.payMintFee{value: 0.01 ether}(); // re-entry attempt; guard must reject
        }
    }
}
