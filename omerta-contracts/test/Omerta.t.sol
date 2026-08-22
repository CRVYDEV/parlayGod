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
        gear.setGearCap(7, 1000);                    // G-MED-1: the authoritative asset-layer lifetime cap
        vc.setGearSupplyCap(7, 1000);                // gear class 7 mintable up to 1000 (bridge pre-flight)
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
        vm.prank(safe); gear.setGearCap(9, 2);
        vm.prank(safe); vc.setGearSupplyCap(9, 2);
        VoucherClaim.Voucher memory v1 = _voucher(player, 2, 1, 9, 21);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk)); // mints 2 of 2
        assertEq(gear.balanceOf(player, 9), 2);
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 1, 9, 22);
        bytes memory s2 = _sign(v2, signerPk);
        vm.expectRevert("VC: gear cap"); // the 3rd exceeds the cap
        vm.prank(player); vc.claim(v2, s2);
    }

    // ── RED TEAM 2026-08-16: the bridge's pre-flight cap must bound LIVE on-chain supply, exactly as
    // GearVault does — NOT lifetime mints. A lifetime bound here is STRICTER than the asset layer's,
    // and the gap kills the shipped re-import round trip (omerta-nft-reimport-design.md §4): once a
    // class had ever hit its cap, a re-imported car could never be re-extracted, even with every one
    // burned back and zero live on-chain. Caps here are per (model, rarity), and an epic class caps
    // at 10, so the wall is reachable in ordinary play. Fail-closed either way — nothing over-mints —
    // which is exactly why it would have gone unnoticed until a player hit it. ──
    function test_reimport_frees_a_slot_the_bridge_can_re_extract() public {
        uint256 CAR = 100000 + 3 * 10 + 2; // car catalog idx 3, rarity 2 — redeemable, unlike gear
        vm.prank(safe); gear.setGearCap(CAR, 1);
        vm.prank(safe); vc.setGearSupplyCap(CAR, 1);

        VoucherClaim.Voucher memory v1 = _voucher(player, 1, 1, CAR, 501);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk));
        assertEq(gear.balanceOf(player, CAR), 1, "extracted");

        // A second extraction while it is still live must fail — the cap is 1.
        VoucherClaim.Voucher memory vDup = _voucher(player, 1, 1, CAR, 502);
        bytes memory sDup = _sign(vDup, signerPk);
        vm.expectRevert("VC: gear cap");
        vm.prank(player); vc.claim(vDup, sDup);

        // Re-import: the burn vacates the live slot at the asset layer.
        vm.prank(player); gear.redeem(CAR, 1);
        assertEq(gear.minted(CAR) - gear.redeemed(CAR), 0, "LIVE on-chain supply is back to zero");

        // …so the bridge must let the SAME item be re-extracted. This is the regression.
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 1, CAR, 503);
        vm.prank(player); vc.claim(v2, _sign(v2, signerPk));
        assertEq(gear.balanceOf(player, CAR), 1, "re-extracted into the slot the burn vacated");
        assertEq(gear.minted(CAR) - gear.redeemed(CAR), 1, "and live supply never exceeds the cap");

        // The freed slot is ONE slot, not a reset: a third live token is still refused.
        VoucherClaim.Voucher memory v3 = _voucher(player, 1, 1, CAR, 504);
        bytes memory s3 = _sign(v3, signerPk);
        vm.expectRevert("VC: gear cap");
        vm.prank(player); vc.claim(v3, s3);
    }

    // GEAR JOINED THE ROUND TRIP (nft-reimport §7, founder-signed 2026-08-21): a gear burn vacates a
    // live-supply slot the bridge can re-extract, exactly as a car's does — the same regression shape
    // as test_reimport_frees_a_slot_the_bridge_can_re_extract, on the class that used to be one-way.
    function test_gear_redeem_frees_a_slot_the_bridge_can_re_extract() public {
        vm.prank(safe); gear.setGearCap(9, 1);
        vm.prank(safe); vc.setGearSupplyCap(9, 1);
        VoucherClaim.Voucher memory v1 = _voucher(player, 1, 1, 9, 511);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk));
        vm.prank(player); gear.redeem(9, 1);
        assertEq(gear.minted(9) - gear.redeemed(9), 0, "gear burn vacates the live slot");
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 1, 9, 512);
        vm.prank(player); vc.claim(v2, _sign(v2, signerPk));
        assertEq(gear.balanceOf(player, 9), 1, "re-extracted into the slot the burn vacated");
    }

    // Gear burns ONE AT A TIME: its in-game form is account-level SET MEMBERSHIP, so each Redeemed
    // event must map to exactly one membership change — a batch burn would collapse N tokens into one
    // membership and silently destroy the rest. Cars/boats (instance rows) may still batch.
    function test_gear_redeem_is_one_at_a_time() public {
        vm.prank(safe); gear.setGearCap(9, 2);
        vm.prank(safe); vc.setGearSupplyCap(9, 2);
        VoucherClaim.Voucher memory v1 = _voucher(player, 1, 1, 9, 513);
        vm.prank(player); vc.claim(v1, _sign(v1, signerPk));
        VoucherClaim.Voucher memory v2 = _voucher(player, 1, 1, 9, 514);
        vm.prank(player); vc.claim(v2, _sign(v2, signerPk));
        vm.prank(player);
        vm.expectRevert("GearVault: gear one at a time");
        gear.redeem(9, 2);
        vm.prank(player); vm.expectRevert("GearVault: not redeemable");
        gear.redeem(0, 1); // gearId 0 stays reserved — never redeemable
    }

    function test_set_gear_cap_only_owner() public {
        vm.expectRevert();
        vc.setGearSupplyCap(1, 100);
        vm.prank(safe); vc.setGearSupplyCap(1, 100);
        assertEq(vc.gearSupplyCap(1), 100);
    }

    // ── AUDIT full-system-v2 G-MED-1: the per-gearId lifetime cap is enforced at the ASSET layer
    // (GearVault) and SURVIVES a minter swap — a fresh bridge cannot re-mint a class's supply that a
    // prior bridge already minted to the cap (the bug: the count lived only in the swappable minter). ──
    function test_gear_cap_survives_minter_swap() public {
        address minterA = address(0xA11CE);
        address minterB = address(0xB0B0);
        vm.startPrank(safe);
        gear.setGearCap(11, 2);
        gear.setMinter(minterA);
        vm.stopPrank();
        vm.prank(minterA); gear.mint(player, 11, 2);       // mints the 2 allowed
        assertEq(gear.minted(11), 2);
        vm.prank(minterA); vm.expectRevert("GearVault: cap"); gear.mint(player, 11, 1); // over the cap
        // the Safe upgrades the bridge — the lifetime count must NOT reset with the new minter
        vm.prank(safe); gear.setMinter(minterB);
        vm.prank(minterB); vm.expectRevert("GearVault: cap"); gear.mint(player, 11, 1); // STILL blocked
        assertEq(gear.minted(11), 2);
    }

    function test_gearvault_setcap_gates() public {
        vm.expectRevert();                                  // onlyOwner
        gear.setGearCap(5, 100);
        vm.prank(safe); gear.setGearCap(5, 100);
        assertEq(gear.cap(5), 100);
        vm.prank(safe); gear.setMinter(address(0xCA5E));
        vm.prank(address(0xCA5E)); gear.mint(player, 5, 10);
        vm.prank(safe); vm.expectRevert("GearVault: below live"); // can't lower below LIVE supply (minted - redeemed; here redeemed=0 so it's minted)
        gear.setGearCap(5, 5);
    }

    // an uncapped class (cap 0) is fail-closed even from a valid minter (asset-layer default)
    function test_gearvault_uncapped_class_blocked() public {
        vm.prank(safe); gear.setMinter(address(0xFEED));
        vm.prank(address(0xFEED)); vm.expectRevert("GearVault: cap"); gear.mint(player, 99, 1);
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
        f = new OmertaFees(safe, dev, dev, 0, 0.01 ether, 0.10 ether); // vigBps 0 → 100% to dev (pre-split behaviour)
    }

    function test_fee_split_dev_and_vig() public {
        address payable dev = payable(makeAddr("dev"));
        address payable vig = payable(makeAddr("vig"));
        OmertaFees f = new OmertaFees(safe, dev, vig, 6000, 0.01 ether, 0.10 ether); // 60% Vig / 40% dev
        vm.deal(player, 1 ether);
        vm.expectEmit(true, false, false, true, address(f));
        emit OmertaFees.FeeSplit(1, 0.004 ether, 0.006 ether);
        vm.prank(player);
        f.payMintFee{value: 0.01 ether}();
        assertEq(vig.balance, 0.006 ether, "Vig wallet got its 60% share");
        assertEq(dev.balance, 0.004 ether, "dev got the remaining 40%");
        assertEq(address(f).balance, 0, "contract still custodies nothing");
        // MintFeePaid still carries the GROSS amount (backend keys idempotency on nonce, books gross x VIG_BPS)
    }

    function test_bad_bps_and_missing_vig_recipient_rejected() public {
        address payable dev = payable(makeAddr("dev"));
        vm.expectRevert(OmertaFees.BadBps.selector);
        new OmertaFees(safe, dev, dev, 10001, 0.01 ether, 0.10 ether);         // bps > 100%
        vm.expectRevert(OmertaFees.ZeroAddress.selector);
        new OmertaFees(safe, dev, payable(address(0)), 6000, 0.01 ether, 0.10 ether); // split with no Vig wallet
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

    function test_reroll_fee_defaults_to_mint_forwards_and_repeats() public {
        (OmertaFees f, address payable dev) = _fees();
        assertEq(f.rerollFee(), 0.01 ether, "re-roll defaults to the mint fee (0.01 ETH)");
        vm.deal(player, 1 ether);
        vm.startPrank(player);
        // re-roll is REPEATABLE — pay it twice, each forwards straight to dev, nonce advances each time
        vm.expectEmit(true, true, false, true, address(f));
        emit OmertaFees.RerollFeePaid(player, 1, 0.01 ether);
        f.payRerollFee{value: 0.01 ether}();
        f.payRerollFee{value: 0.01 ether}();
        // wrong value reverts (exact-fee)
        vm.expectRevert(abi.encodeWithSelector(OmertaFees.WrongFee.selector, 0.02 ether, 0.01 ether));
        f.payRerollFee{value: 0.02 ether}();
        vm.stopPrank();
        assertEq(dev.balance, 0.02 ether, "both re-rolls reached the dev wallet");
        assertEq(address(f).balance, 0, "contract custodies nothing");
        assertEq(f.nonce(), 2, "each re-roll advances the monotonic nonce");
    }

    function test_only_owner_sets_reroll_fee_and_zero_reverts() public {
        (OmertaFees f, ) = _fees();
        vm.prank(player);
        vm.expectRevert(); // Ownable: not the owner
        f.setRerollFee(0.05 ether);
        vm.startPrank(safe);
        vm.expectRevert(OmertaFees.ZeroFee.selector);
        f.setRerollFee(0);                 // a 0 re-roll fee would make off-chain re-rolls free
        f.setRerollFee(0.05 ether);
        vm.stopPrank();
        assertEq(f.rerollFee(), 0.05 ether, "owner retuned the re-roll fee");
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
        new OmertaFees(safe, dev, dev, 0, 0, 0.10 ether);              // ctor: zero mint fee
        vm.expectRevert(OmertaFees.ZeroAddress.selector);
        new OmertaFees(safe, payable(address(0)), dev, 0, 0.01 ether, 0.10 ether);
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
        OmertaFees f = new OmertaFees(safe, payable(address(bad)), payable(address(bad)), 0, 0.01 ether, 0.10 ether);
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

    // ── the on-chain STORE paywall: payForPackage (Safe-priced SKUs, fail-closed, dev/vig split) ──
    function test_package_exact_value_forwards_and_emits() public {
        (OmertaFees f, address payable dev) = _fees();
        vm.prank(safe);
        f.setPackagePrice(42, 0.05 ether);                    // Safe prices sku 42
        assertEq(f.packagePrice(42), 0.05 ether);
        vm.deal(player, 1 ether);
        vm.expectEmit(true, true, true, true, address(f));
        emit OmertaFees.PackagePaid(player, 1, 42, 0.05 ether);
        vm.prank(player);
        f.payForPackage{value: 0.05 ether}(42);
        assertEq(dev.balance, 0.05 ether, "package ETH forwarded to dev");
        assertEq(address(f).balance, 0, "contract custodies nothing");
        assertEq(f.nonce(), 1, "nonce advanced");
    }

    function test_unpriced_package_fails_closed() public {
        (OmertaFees f, ) = _fees();
        vm.deal(player, 1 ether);
        // an unset sku is UNBUYABLE — a player can never buy a package the Safe has not priced (or has retired)
        vm.prank(player);
        vm.expectRevert(OmertaFees.ZeroFee.selector);
        f.payForPackage{value: 0.05 ether}(99);
    }

    function test_package_wrong_value_reverts() public {
        (OmertaFees f, ) = _fees();
        vm.prank(safe);
        f.setPackagePrice(7, 0.02 ether);
        vm.deal(player, 1 ether);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OmertaFees.WrongFee.selector, 0.03 ether, 0.02 ether));
        f.payForPackage{value: 0.03 ether}(7);                // exact-value only
    }

    function test_package_price_owner_only_and_retire() public {
        (OmertaFees f, ) = _fees();
        vm.prank(player);
        vm.expectRevert();                                    // Ownable: not the owner
        f.setPackagePrice(1, 0.01 ether);
        vm.startPrank(safe);
        f.setPackagePrice(1, 0.03 ether);
        f.setPackagePrice(1, 0);                              // price 0 RETIRES the sku (unbuyable again)
        vm.stopPrank();
        vm.deal(player, 1 ether);
        vm.prank(player);
        vm.expectRevert(OmertaFees.ZeroFee.selector);
        f.payForPackage{value: 0.03 ether}(1);               // retired → fail closed
    }

    function test_package_splits_dev_and_vig() public {
        address payable dev = payable(makeAddr("dev"));
        address payable vig = payable(makeAddr("vig"));
        OmertaFees f = new OmertaFees(safe, dev, vig, 6000, 0.01 ether, 0.10 ether); // 60% Vig / 40% dev
        vm.prank(safe);
        f.setPackagePrice(3, 0.10 ether);
        vm.deal(player, 1 ether);
        vm.prank(player);
        f.payForPackage{value: 0.10 ether}(3);
        assertEq(vig.balance, 0.06 ether, "Vig share of the package");
        assertEq(dev.balance, 0.04 ether, "dev share of the package");
        assertEq(address(f).balance, 0, "contract custodies nothing");
    }

    function test_reentrant_recipient_is_blocked() public {
        ReentrantDev bad = new ReentrantDev();
        OmertaFees f = new OmertaFees(safe, payable(address(bad)), payable(address(bad)), 0, 0.01 ether, 0.10 ether);
        bad.arm(f);
        vm.deal(player, 1 ether);
        vm.prank(player);
        vm.expectRevert();                                     // re-entry hits nonReentrant → forward fails → tx unwinds
        f.payMintFee{value: 0.01 ether}();
    }

    // ═══════════════ HARDENING PASS (chain on-chain audit) — new coverage ═══════════════

    // THE trust-model keystone: rotating the signer INSTANTLY revokes a leaked key's vouchers.
    // (Was untested — the whole "a compromised signer is bounded + revocable" claim rested on it.)
    function test_signer_rotation_revokes_the_old_key() public {
        VoucherClaim.Voucher memory v = _voucher(player, 100e18, 0, 0, 30);
        bytes memory leakedSig = _sign(v, signerPk);          // signed by the (now-leaked) key
        uint256 newPk = 0xB0B;
        vm.prank(safe); vc.setSigner(vm.addr(newPk));         // the Safe rotates
        vm.expectRevert("VC: bad signature");                 // the leaked key's voucher is dead on arrival
        vm.prank(player); vc.claim(v, leakedSig);
        vm.prank(player); vc.claim(v, _sign(v, newPk));        // the new key works
        assertEq(omr.balanceOf(player), 10_100e18);
        assertTrue(vc.usedNonce(30));
    }

    function test_bad_kind_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1, 2, 0, 31); // kind 2 is neither OMR nor gear
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert("VC: bad kind");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_zero_gearId_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1, 1, 0, 32); // gear kind, gearId 0
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert("VC: zero gear");
        vm.prank(player); vc.claim(v, sig);
    }

    function test_zero_recipient_reverts() public {
        VoucherClaim.Voucher memory v = _voucher(address(0), 1e18, 0, 0, 33);
        bytes memory sig = _sign(v, signerPk);
        vm.expectRevert("VC: zero recipient");                 // the new explicit guard
        vm.prank(player); vc.claim(v, sig);
    }

    function test_constructor_and_setSigner_reject_zero() public {
        vm.expectRevert("VC: zero signer");
        new VoucherClaim(safe, address(0), IERC20(address(omr)), IGearVault(address(gear)), DAILY_CAP);
        vm.expectRevert();                                     // setSigner not owner
        vc.setSigner(player);
        vm.startPrank(safe);
        vm.expectRevert("VC: zero signer");
        vc.setSigner(address(0));
        vc.setSigner(player);                                 // valid rotation
        vm.stopPrank();
        assertEq(vc.signer(), player);
    }

    function test_setMinter_rejects_zero_and_only_owner() public {
        vm.expectRevert();                                     // not owner
        gear.setMinter(player);
        vm.prank(safe);
        vm.expectRevert("GearVault: zero minter");             // the new guard
        gear.setMinter(address(0));
    }

    // gear is real property — it transfers freely and survives the character (the heir/market premise)
    function test_gear_transfers_are_open() public {
        VoucherClaim.Voucher memory v = _voucher(player, 1, 1, 7, 34);
        vm.prank(player); vc.claim(v, _sign(v, signerPk));
        address heir = makeAddr("heir");
        vm.prank(player); gear.safeTransferFrom(player, heir, 7, 1, "");
        assertEq(gear.balanceOf(heir, 7), 1);
        assertEq(gear.balanceOf(player, 7), 0);
    }

    function test_staking_rejects_zero_and_bad_amounts() public {
        vm.startPrank(player);
        omr.approve(address(staking), type(uint256).max);
        vm.expectRevert("Staking: zero");
        staking.stake(0);
        staking.stake(1_000e18);
        vm.expectRevert("Staking: bad amount");
        staking.unstake(2_000e18);                            // more than staked
        vm.expectRevert("Staking: nothing accrued");
        staking.claimRewards();                              // no time elapsed → nothing to claim
        vm.stopPrank();
    }

    function test_vig_recipient_cannot_zero_while_active_but_rotates() public {
        address payable dev = payable(makeAddr("dev"));
        address payable vig = payable(makeAddr("vig"));
        OmertaFees f = new OmertaFees(safe, dev, vig, 6000, 0.01 ether, 0.10 ether);
        vm.startPrank(safe);
        vm.expectRevert(OmertaFees.ZeroAddress.selector);
        f.setVigRecipient(payable(address(0)));              // can't zero a live split's destination
        address payable vig2 = payable(makeAddr("vig2"));
        f.setVigRecipient(vig2);                             // rotation is fine
        vm.stopPrank();
        assertEq(f.vigRecipient(), vig2);
    }

    // every contract is Safe-owned FROM DEPLOY (no hot-deployer window) and the minter is wired
    function test_ownership_is_safe_from_deploy() public view {
        assertEq(vc.owner(), safe);
        assertEq(gear.owner(), safe);
        assertEq(staking.owner(), safe);
        assertEq(gear.minter(), address(vc));
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
