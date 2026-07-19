// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";
import {OmertaBond} from "../src/OmertaBond.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A recipient that rejects all ETH — exercises the ForwardFailed / DoS path.
contract RejectETH2 {
    receive() external payable { revert("no ETH"); }
}

contract OmertaBondTest is Test {
    OMR omr;
    OmertaBond bond;

    address safe = makeAddr("safe");
    uint256 signerPk = 0xB0B;
    address signer;
    address payable pol = payable(makeAddr("pol"));
    address payable vig = payable(makeAddr("vig"));
    address bonder = makeAddr("bonder");

    uint256 constant TRANCHE = 100_000e18;   // OMR the Safe pre-funds for bonding
    uint256 constant POL_BPS = 6000;          // 60% of ETH → POL (matches backend BONDS.POL_BPS)
    uint256 constant PRICE = 5000e18;         // 5000 OMR per 1 ETH

    function setUp() public {
        signer = vm.addr(signerPk);
        omr = new OMR(safe);
        bond = new OmertaBond(safe, signer, IERC20(address(omr)), POL_BPS, pol, vig);
        vm.prank(safe);
        omr.transfer(address(bond), TRANCHE); // fund the tranche (the pre-funded discipline)
        vm.deal(bonder, 100 ether);
    }

    // ── helpers ──
    function _quote(address payer, uint256 principal, uint256 disc, uint256 vest, uint256 nonce)
        internal view returns (OmertaBond.BondQuote memory)
    {
        return OmertaBond.BondQuote(payer, principal, PRICE, disc, vest, nonce, block.timestamp + 1 hours);
    }

    function _sign(OmertaBond.BondQuote memory q, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, bond.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _payout(uint256 principal, uint256 disc) internal pure returns (uint256) {
        uint256 marketOmr = (principal * PRICE) / 1e18;
        return (marketOmr * 10000) / (10000 - disc);
    }

    // ── the happy path ──
    function test_bond_pays_discounted_omr_and_splits_eth() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, _sign(q, signerPk));

        uint256 expect = _payout(1 ether, 800);
        (, uint256 payout, uint256 claimed, , ) = bond.bonds(id);
        assertEq(payout, expect, "discounted payout");
        assertEq(claimed, 0);
        assertEq(bond.committedOMR(), expect, "committed bumped");
        // the ETH was split + forwarded in the same tx; the contract custodies NOTHING
        assertEq(pol.balance, 0.6 ether, "60% to POL");
        assertEq(vig.balance, 0.4 ether, "40% to Vig");
        assertEq(address(bond).balance, 0, "contract holds no ETH");
        // NOTHING MINTED — the OMR still all exists; the payout is committed against the pre-funded tranche
        assertEq(omr.totalSupply(), 100_000_000e18);
        assertLe(bond.committedOMR(), omr.balanceOf(address(bond)), "committed <= funded balance");
    }

    // ── the anti-Ponzi cap: never promise more OMR than the funded tranche ──
    function test_bond_reverts_past_the_tranche() public {
        // 25 ETH @5000 = 125,000 OMR market → ~135,870 discounted > the 100k tranche
        OmertaBond.BondQuote memory q = _quote(bonder, 25 ether, 800, 5 days, 1);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.TrancheExhausted.selector);
        bond.bond{value: 25 ether}(q, _sign(q, signerPk));
    }

    function test_bond_reverts_wrong_value() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        vm.expectRevert();
        bond.bond{value: 0.5 ether}(q, _sign(q, signerPk)); // msg.value != principal
    }

    function test_bond_reverts_not_payer() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        address other = makeAddr("other"); vm.deal(other, 1 ether);
        vm.prank(other);
        vm.expectRevert(OmertaBond.NotPayer.selector);
        bond.bond{value: 1 ether}(q, sig); // a quote is not transferable
    }

    function test_bond_reverts_expired() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.Expired.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_bond_reverts_discount_over_max() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 2001, 5 days, 1); // > MAX_DISCOUNT_BPS
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.BadBps.selector);
        bond.bond{value: 1 ether}(q, _sign(q, signerPk));
    }

    function test_bond_reverts_vest_too_long_or_zero() public {
        OmertaBond.BondQuote memory q1 = _quote(bonder, 1 ether, 800, 31 days, 1);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.VestTooLong.selector);
        bond.bond{value: 1 ether}(q1, _sign(q1, signerPk));
        OmertaBond.BondQuote memory q2 = _quote(bonder, 1 ether, 800, 0, 2);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.VestTooLong.selector);
        bond.bond{value: 1 ether}(q2, _sign(q2, signerPk));
    }

    function test_bond_reverts_replay() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder); bond.bond{value: 1 ether}(q, sig);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.Replay.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_bond_reverts_bad_signature() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.BadSignature.selector);
        bond.bond{value: 1 ether}(q, _sign(q, 0xDEAD)); // not the signer
    }

    // ── vesting + claim ──
    function test_claim_vests_linearly() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 100, 1); // 100-second vest
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, _sign(q, signerPk));
        uint256 expect = _payout(1 ether, 800);

        // immediately nothing vested
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.NothingVested.selector);
        bond.claim(id);

        // halfway → ~50%
        vm.warp(block.timestamp + 50);
        vm.prank(bonder);
        uint256 got = bond.claim(id);
        assertApproxEqAbs(got, expect / 2, 1e16, "half vested");
        assertEq(omr.balanceOf(bonder), got);

        // fully vested → the rest, and the total equals the payout exactly
        vm.warp(block.timestamp + 100);
        vm.prank(bonder);
        uint256 rest = bond.claim(id);
        assertEq(got + rest, expect, "total claimed == payout");
        assertEq(bond.committedOMR(), 0, "commitment fully released");
        // a second claim has nothing left
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.NothingVested.selector);
        bond.claim(id);
    }

    function test_claim_reverts_not_owner() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 100, 1);
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, _sign(q, signerPk));
        vm.warp(block.timestamp + 100);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(OmertaBond.NotOwner.selector);
        bond.claim(id);
    }

    // ── sweep: only the UNCOMMITTED tranche, never OMR backing outstanding bonds ──
    function test_sweep_cannot_touch_committed() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, _sign(q, signerPk));
        uint256 committed = bond.committedOMR();
        uint256 free = omr.balanceOf(address(bond)) - committed;
        // sweeping the free tranche is fine
        vm.prank(safe);
        bond.sweep(safe, free);
        // but not one wei into the committed backing
        vm.prank(safe);
        vm.expectRevert(OmertaBond.OverSweep.selector);
        bond.sweep(safe, 1);
        // the bonder can still claim their full payout (the backing was never swept)
        vm.warp(block.timestamp + 5 days);
        vm.prank(bonder);
        assertEq(bond.claim(1), committed, "bond fully honoured after a sweep");
    }

    // ── pause + forward-failure + ownership ──
    function test_pause_blocks_bonding() public {
        vm.prank(safe); bond.pause();
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        vm.expectRevert(); // Pausable: paused
        bond.bond{value: 1 ether}(q, _sign(q, signerPk));
    }

    function test_bond_reverts_if_eth_forward_fails() public {
        RejectETH2 rej = new RejectETH2();
        vm.prank(safe);
        bond.setRecipients(payable(address(rej)), vig); // POL recipient rejects ETH
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.ForwardFailed.selector);
        bond.bond{value: 1 ether}(q, _sign(q, signerPk));
    }

    function test_only_owner_admin() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert();
        bond.setSigner(makeAddr("evil"));
        vm.prank(makeAddr("nobody"));
        vm.expectRevert();
        bond.sweep(makeAddr("nobody"), 1);
    }

    function test_ownership_is_safe_from_deploy() public view {
        assertEq(bond.owner(), safe);
        assertEq(bond.signer(), signer);
        assertEq(bond.polBps(), POL_BPS);
    }
}
