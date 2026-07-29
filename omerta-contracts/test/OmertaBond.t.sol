// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";
import {OmertaBond} from "../src/OmertaBond.sol";
import {IOmrOracle} from "../src/IOmrOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A settable stand-in for the TWAP feed. The real one (OmrTwapOracle) has its own suite; here we
/// want to drive the WALL rather than the maths — including the states a real feed reaches only
/// under failure: reporting zero, going stale, and reverting outright.
contract MockOracle is IOmrOracle {
    uint256 public price;
    uint256 public updatedAt;
    bool public broken;

    constructor(uint256 p) { price = p; updatedAt = block.timestamp; }
    function set(uint256 p, uint256 t) external { price = p; updatedAt = t; }
    function breakIt(bool b) external { broken = b; }
    function consult() external view returns (uint256, uint256) {
        if (broken) revert("oracle down");
        return (price, updatedAt);
    }
}

/// A recipient that rejects all ETH — exercises the ForwardFailed / DoS path.
contract RejectETH2 {
    receive() external payable { revert("no ETH"); }
}

/// A malicious POL recipient that re-enters the bond on receiving its ETH share — exercises the
/// nonReentrant guard (the re-entry reverts, is swallowed by the forward `.call`, ForwardFailed bubbles).
contract ReenterOnPol {
    OmertaBond public target;
    function set(OmertaBond b) external { target = b; }
    receive() external payable { target.claim(1); } // re-entry attempt — must be blocked
}

contract OmertaBondTest is Test {
    OMR omr;
    OmertaBond bond;

    address safe = makeAddr("safe");
    uint256 signerPk = 0xB0B;
    address signer;
    address payable pol = payable(makeAddr("pol"));
    address payable dev = payable(makeAddr("dev"));
    address payable vig = payable(makeAddr("vig"));
    address bonder = makeAddr("bonder");

    uint256 constant TRANCHE = 100_000e18;   // OMR the Safe seeds for the sweep/surplus tests
    /// WALL 3 — the mint-rate ceiling. Generous here so the OTHER walls are what bind in each test;
    /// its own coverage is `test_rate_ceiling_*` below. Post-discount rate at PRICE/800bps is ~5435.
    uint256 constant MAX_RATE = 10_000e18;
    uint256 constant POL_BPS = 5000;          // 50% of ETH → POL (matches backend BONDS.POL_BPS)
    uint256 constant DEV_BPS = 2000;          // 20% → the dev wallet (founder revenue; the rest is the Vig)
    uint256 constant PRICE = 5000e18;         // 5000 OMR per 1 ETH
    /// WALL 4's tolerance. The oracle is seeded AT `PRICE` in setUp, so a quote at PRICE sits exactly
    /// on the oracle and the other walls are what bind in each test; wall 4's own coverage is the
    /// `test_oracle_*` block below.
    uint256 constant TOLERANCE_BPS = 500;     // 5%
    uint256 constant ORACLE_AGE = 1 hours;
    MockOracle oracle;

    function setUp() public {
        signer = vm.addr(signerPk);
        omr = new OMR(safe);
        bond = new OmertaBond(safe, signer, IERC20(address(omr)), POL_BPS, DEV_BPS, pol, dev, vig, 0, MAX_RATE); // 0 = uncapped daily
        oracle = new MockOracle(PRICE);
        vm.startPrank(safe);
        omr.setMinter(address(bond));         // v2 §4: the bond IS the mint path now
        omr.transfer(address(bond), TRANCHE); // a surplus balance, so `sweep` has something to pull
        bond.setOracle(IOmrOracle(address(oracle)), TOLERANCE_BPS, ORACLE_AGE); // WALL 4
        vm.stopPrank();
        vm.deal(bonder, 100 ether);
    }

    /// Keeps the mock's reading fresh across a `vm.warp`. A stale feed is a REVERT (that is the
    /// point of wall 4), so any test that moves time and then bonds must re-poke — exactly as a
    /// keeper must in production, which is worth having the tests feel.
    function _pokeOracle() internal { oracle.set(PRICE, block.timestamp); }

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
        bytes memory sig = _sign(q, signerPk);
        uint256 supply0 = omr.totalSupply();
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, sig);

        uint256 expect = _payout(1 ether, 800);
        (, uint256 payout, uint256 claimed, , ) = bond.bonds(id);
        assertEq(payout, expect, "discounted payout");
        assertEq(claimed, 0);
        assertEq(bond.committedOMR(), expect, "committed bumped");
        // the ETH was split + forwarded in the same tx; the contract custodies NOTHING
        assertEq(pol.balance, 0.5 ether, "50% to POL");
        assertEq(dev.balance, 0.2 ether, "20% to the dev wallet");
        assertEq(vig.balance, 0.3 ether, "30% to Vig");
        assertEq(address(bond).balance, 0, "contract holds no ETH");
        // THE MINT (tokenomics v2 §4). This assertion used to read `totalSupply() == 100_000_000e18`
        // -- "nothing minted", the suite's oldest property. It is deliberately gone. What has to hold
        // in its place is that supply moved by EXACTLY the payout and not one wei more: the bond is
        // the only door, and it opens exactly as wide as the quote it was handed.
        assertEq(omr.totalSupply(), supply0 + expect, "supply grew by exactly the payout");
        assertLe(bond.committedOMR(), omr.balanceOf(address(bond)), "and the commitment is covered the instant it is booked");
    }

    // ── WALL 3: the mint-rate ceiling. The tranche cap used to make minting structurally
    //    impossible; this is what stands in its place, so it gets the same scrutiny. ──
    function test_rate_ceiling_binds_on_the_POST_discount_rate() public {
        // 6000 OMR/ETH quoted is already under a 10,000 ceiling — but at the 20% max discount the
        // rate ACTUALLY minted is 7,500/ETH. Set the ceiling between the two: a contract that checked
        // the quoted rate would accept this, and it must not.
        vm.prank(safe);
        bond.setMaxRate(7_000e18);
        oracle.set(6_000e18, block.timestamp); // keep WALL 4 satisfied so WALL 3 is what this measures
        OmertaBond.BondQuote memory q =
            OmertaBond.BondQuote(bonder, 1 ether, 6_000e18, 2000, 5 days, 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.RateCeiling.selector);
        bond.bond{value: 1 ether}(q, sig);
        // the same quote at no discount mints at exactly 6,000/ETH and is accepted
        OmertaBond.BondQuote memory ok =
            OmertaBond.BondQuote(bonder, 1 ether, 6_000e18, 0, 5 days, 2, block.timestamp + 1 hours);
        bytes memory sigOk = _sign(ok, signerPk);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(ok, sigOk);
    }

    function test_rate_ceiling_FAILS_CLOSED_when_unset() public {
        // An unset ceiling must stop every bond — so forgetting to configure wall 3 turns the
        // product OFF rather than opening it (the GearVault gear-cap precedent).
        OmertaBond fresh = new OmertaBond(safe, signer, IERC20(address(omr)), POL_BPS, DEV_BPS, pol, dev, vig, 0, 0);
        vm.startPrank(safe);
        omr.setMinter(address(fresh));
        fresh.setOracle(IOmrOracle(address(oracle)), TOLERANCE_BPS, ORACLE_AGE); // arm wall 4 so wall 3 is what binds
        vm.stopPrank();
        assertEq(fresh.maxOmrPerEth(), 0, "ships with the ceiling unset");
        OmertaBond.BondQuote memory q =
            OmertaBond.BondQuote(bonder, 1 ether, PRICE, 800, 5 days, 1, block.timestamp + 1 hours);
        bytes memory sig = _sign2(fresh, q);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.RateCeiling.selector);
        fresh.bond{value: 1 ether}(q, sig);
        // and it is a KILL SWITCH: arming, then zeroing, stops issuance with no pause needed
        vm.prank(safe);
        fresh.setMaxRate(MAX_RATE);
        vm.prank(bonder);
        fresh.bond{value: 1 ether}(q, sig);
        vm.prank(safe);
        fresh.setMaxRate(0);
        OmertaBond.BondQuote memory q2 =
            OmertaBond.BondQuote(bonder, 1 ether, PRICE, 800, 5 days, 2, block.timestamp + 1 hours);
        bytes memory sig2 = _sign2(fresh, q2);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.RateCeiling.selector);
        fresh.bond{value: 1 ether}(q2, sig2);
    }

    /// The bond can ONLY mint through the token's single minter door — revoke it and bonding stops
    /// dead, whatever this contract's own walls say. Two independent kill switches, on two contracts.
    function test_bond_cannot_mint_without_the_minter_role() public {
        vm.prank(safe);
        omr.setMinter(address(0));
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OMR.NotMinter.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_bond_reverts_wrong_value() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert();
        bond.bond{value: 0.5 ether}(q, sig); // msg.value != principal
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
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.BadBps.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_bond_reverts_vest_too_long_or_zero() public {
        OmertaBond.BondQuote memory q1 = _quote(bonder, 1 ether, 800, 31 days, 1);
        bytes memory sig1 = _sign(q1, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.VestTooLong.selector);
        bond.bond{value: 1 ether}(q1, sig1);
        OmertaBond.BondQuote memory q2 = _quote(bonder, 1 ether, 800, 0, 2);
        bytes memory sig2 = _sign(q2, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.VestTooLong.selector);
        bond.bond{value: 1 ether}(q2, sig2);
    }

    function test_bond_reverts_deadline_too_far() public {
        // a leaked-then-rotated signer's far-future quote can't stay bondable (the MAX_QUOTE_TTL backstop)
        OmertaBond.BondQuote memory q = OmertaBond.BondQuote(
            bonder, 1 ether, PRICE, 800, 5 days, 1, block.timestamp + 31 days
        );
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.DeadlineTooFar.selector);
        bond.bond{value: 1 ether}(q, sig);
        // exactly at the backstop is still fine
        OmertaBond.BondQuote memory ok = OmertaBond.BondQuote(
            bonder, 1 ether, PRICE, 800, 5 days, 2, block.timestamp + 30 days
        );
        bytes memory sigOk = _sign(ok, signerPk);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(ok, sigOk);
        assertEq(bond.committedOMR(), _payout(1 ether, 800));
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
        bytes memory badSig = _sign(q, 0xDEAD); // not the signer
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.BadSignature.selector);
        bond.bond{value: 1 ether}(q, badSig);
    }

    // ── vesting + claim ──
    function test_claim_vests_linearly() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 100, 1); // 100-second vest
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, sig);
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
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        uint256 id = bond.bond{value: 1 ether}(q, sig);
        vm.warp(block.timestamp + 100);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(OmertaBond.NotOwner.selector);
        bond.claim(id);
    }

    // ── sweep: only the UNCOMMITTED tranche, never OMR backing outstanding bonds ──
    function test_sweep_cannot_touch_committed() public {
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, sig);
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
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(); // Pausable: paused
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_bond_reverts_if_eth_forward_fails() public {
        RejectETH2 rej = new RejectETH2();
        vm.prank(safe);
        bond.setRecipients(payable(address(rej)), dev, vig); // POL recipient rejects ETH
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.ForwardFailed.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    // ── ETH rescue: any stray ETH goes to the Safe, never trapped ──
    function test_sweepETH_rescues_stray_eth() public {
        vm.deal(address(bond), 3 ether);      // ETH lands outside bond() (e.g. a selfdestruct push)
        uint256 before = safe.balance;
        vm.prank(safe);
        bond.sweepETH();
        assertEq(address(bond).balance, 0, "contract drained");
        assertEq(safe.balance, before + 3 ether, "rescued to the Safe (owner)");
    }

    function test_sweepETH_only_owner() public {
        vm.deal(address(bond), 1 ether);
        vm.prank(makeAddr("nobody"));
        vm.expectRevert();
        bond.sweepETH();
    }

    // ── the reentrancy guard: a recipient can't re-enter to double-spend the tranche ──
    function test_reentrant_recipient_is_blocked() public {
        ReenterOnPol rej = new ReenterOnPol();
        rej.set(bond);
        vm.prank(safe);
        bond.setRecipients(payable(address(rej)), dev, vig);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.ForwardFailed.selector); // the re-entry reverts, swallowed → forward fails
        bond.bond{value: 1 ether}(q, sig);
        // the whole tx rolled back: nothing committed, no OMR moved, the nonce is free again
        assertEq(bond.committedOMR(), 0, "no commitment survived the reverted bond");
        assertEq(omr.balanceOf(address(rej)), 0, "no OMR leaked");
        assertFalse(bond.usedNonce(1), "nonce rolled back");
    }

    // ── fuzz: committedOMR is ALWAYS covered by the balance. This used to hold because the contract
    //    never minted; it now holds because it mints the payout AT BOND TIME rather than at claim.
    //    Same assertion, different reason — and it is what keeps `sweep` unable to touch OMR backing
    //    a bond, and a bonder's claim unable to fail for want of balance. ──
    function testFuzz_committed_never_exceeds_balance(uint256 principal, uint256 disc) public {
        principal = bound(principal, 1, 15 ether);
        disc = bound(disc, 0, MAX_DISCOUNT_BPS_T);
        vm.deal(bonder, principal);
        OmertaBond.BondQuote memory q = _quote(bonder, principal, disc, 5 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        try bond.bond{value: principal}(q, sig) {
            // a booked bond is fully backed the instant it is booked
            assertLe(bond.committedOMR(), omr.balanceOf(address(bond)), "committed <= held balance");
        } catch {
            // refused (rate ceiling / zero value) — nothing committed, nothing minted
            assertEq(bond.committedOMR(), 0);
        }
    }

    uint256 constant MAX_DISCOUNT_BPS_T = 2000;

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
        assertEq(bond.devBps(), DEV_BPS);
        assertEq(bond.maxOmrPerEth(), MAX_RATE, "wall 3 is armed at deploy");
    }

    // ── the per-UTC-day cap (leaked-signer daily blast-radius backstop) ──
    function test_daily_cap_blocks_over_budget() public {
        // a fresh bond contract with a tight daily cap of 6,000 OMR
        OmertaBond capped = new OmertaBond(safe, signer, IERC20(address(omr)), POL_BPS, DEV_BPS, pol, dev, vig, 6_000e18, MAX_RATE);
        vm.startPrank(safe);
        omr.setMinter(address(capped)); // the DAILY CAP, not a balance, is what must bind here
        capped.setOracle(IOmrOracle(address(oracle)), TOLERANCE_BPS, ORACLE_AGE); // arm wall 4 so the cap is what binds
        vm.stopPrank();
        // 1 ETH @ 5000, 8% disc → payout ≈ 5,434 OMR — under the cap, accepted
        OmertaBond.BondQuote memory q1 = OmertaBond.BondQuote(bonder, 1 ether, PRICE, 800, 7 days, 1, block.timestamp + 1 hours);
        bytes memory sigC1 = _sign2(capped, q1);
        vm.prank(bonder);
        capped.bond{value: 1 ether}(q1, sigC1);
        // a second 1-ETH bond the same day → cumulative ≈ 10,869 > 6,000 cap → reverts
        OmertaBond.BondQuote memory q2 = OmertaBond.BondQuote(bonder, 1 ether, PRICE, 800, 7 days, 2, block.timestamp + 1 hours);
        bytes memory sigC2 = _sign2(capped, q2);
        vm.prank(bonder);
        vm.expectRevert("OB: daily cap");
        capped.bond{value: 1 ether}(q2, sigC2);
        // next UTC day → the budget resets, the same bond now lands
        vm.warp(block.timestamp + 1 days);
        _pokeOracle(); // a day passed, so the feed is stale — a keeper must poke, exactly as in production
        OmertaBond.BondQuote memory q3 = OmertaBond.BondQuote(bonder, 1 ether, PRICE, 800, 7 days, 3, block.timestamp + 1 hours);
        bytes memory sigC3 = _sign2(capped, q3);
        vm.prank(bonder);
        capped.bond{value: 1 ether}(q3, sigC3);
        // the Safe can retune the cap
        vm.prank(safe);
        capped.setDailyCap(0);
        assertEq(capped.dailyCapOMR(), 0);
    }

    function _sign2(OmertaBond target, OmertaBond.BondQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, target.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }
    // ── WALL 4 — THE ACCRETION ORACLE ──
    // The wall's job is to stop a signer claiming OMR is worth more than it is. Its DESIGN job is to
    // do that without becoming a new way to mint, which is why every test here also checks that the
    // failure direction is "refuse", never "allow".

    function test_oracle_FAILS_CLOSED_when_unset() public {
        // A bond contract that has never been told the price must refuse to mint, not mint blind.
        OmertaBond fresh = new OmertaBond(safe, signer, IERC20(address(omr)), POL_BPS, DEV_BPS, pol, dev, vig, 0, MAX_RATE);
        vm.prank(safe);
        omr.setMinter(address(fresh));
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign2(fresh, q);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.OracleUnset.selector);
        fresh.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_unset_maxAge_also_fails_closed() public {
        // Setting the feed but leaving maxAge at 0 must NOT read as "no staleness limit".
        vm.prank(safe);
        bond.setOracle(IOmrOracle(address(oracle)), TOLERANCE_BPS, 0);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.OracleUnset.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_zero_reading_is_unavailable_not_free() public {
        // A feed reporting 0 means "no reading". Treating it as a price would make the ceiling 0 —
        // which happens to refuse — but treating it as "unknown, proceed" would mint blind. Assert
        // the named error so the intent cannot silently change to the accidental one.
        oracle.set(0, block.timestamp);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.OracleUnavailable.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_reverting_feed_is_a_clean_refusal() public {
        oracle.breakIt(true);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.OracleUnavailable.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_stale_reading_refuses() public {
        // A dead keeper must halt the mint, never leave it running on a price nobody maintains.
        uint256 t0 = block.timestamp;
        vm.warp(t0 + ORACLE_AGE + 1);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(abi.encodeWithSelector(OmertaBond.OracleStale.selector, t0, ORACLE_AGE));
        bond.bond{value: 1 ether}(q, sig);
        // ...and a poke revives it, so staleness is a liveness state and not a brick.
        _pokeOracle();
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_refuses_a_quote_priced_above_the_market() public {
        // THE WALL ITSELF: a leaked signer inflating the claimed market price is what this stops.
        uint256 ceiling = (PRICE * (10000 + TOLERANCE_BPS)) / 10000;
        OmertaBond.BondQuote memory bad =
            OmertaBond.BondQuote(bonder, 1 ether, ceiling + 1, 800, 7 days, 1, block.timestamp + 1 hours);
        bytes memory sigBad = _sign(bad, signerPk);
        vm.prank(bonder);
        vm.expectRevert(abi.encodeWithSelector(OmertaBond.PriceAboveOracle.selector, ceiling + 1, ceiling));
        bond.bond{value: 1 ether}(bad, sigBad);

        // exactly ON the ceiling is allowed — the boundary is inclusive, and asserting it stops a
        // later "tighten by one wei" from passing as this test still being green
        OmertaBond.BondQuote memory ok =
            OmertaBond.BondQuote(bonder, 1 ether, ceiling, 800, 7 days, 2, block.timestamp + 1 hours);
        bytes memory sigOk = _sign(ok, signerPk);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(ok, sigOk);
    }

    function test_oracle_tolerance_tracks_a_falling_market() public {
        // The reason wall 4 exists alongside the static wall 3: when OMR halves, the acceptable
        // quote price halves WITH it. A static ceiling alone cannot do this.
        oracle.set(PRICE / 2, block.timestamp);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1); // still claims the OLD price
        bytes memory sig = _sign(q, signerPk);
        uint256 ceiling = ((PRICE / 2) * (10000 + TOLERANCE_BPS)) / 10000;
        vm.prank(bonder);
        vm.expectRevert(abi.encodeWithSelector(OmertaBond.PriceAboveOracle.selector, PRICE, ceiling));
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_CANNOT_LOOSEN_the_static_ceiling() public {
        // THE CENTRAL SAFETY PROPERTY. An oracle pushed to the moon must not widen what can be
        // minted: wall 3 is the Safe's number and no feed can raise it. Manipulating the oracle
        // UPWARD buys an attacker nothing.
        vm.prank(safe);
        bond.setMaxRate(1000e18);              // a tight absolute ceiling
        oracle.set(PRICE * 1000, block.timestamp); // and a wildly manipulated feed
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1); // PRICE is now far under the oracle
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.RateCeiling.selector); // wall 3 still binds — NOT PriceAboveOracle
        bond.bond{value: 1 ether}(q, sig);
    }

    function test_oracle_manipulated_DOWN_only_halts_bonding() public {
        // The other direction: pushing the feed down cannot mint anything either — it can only stop
        // bonds. A liveness problem, recoverable, and the correct failure direction for a mint wall.
        oracle.set(1, block.timestamp);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert();
        bond.bond{value: 1 ether}(q, sig);
        uint256 supplyAfter = omr.totalSupply();
        oracle.set(PRICE, block.timestamp);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, sig);
        assertGt(omr.totalSupply(), supplyAfter, "a recovered feed resumes bonding");
    }

    function test_oracle_zero_tolerance_is_the_literal_accretive_rule() public {
        // The design's literal "accretive-only" is a SETTING here, not a thing that was dropped:
        // tolerance 0 means a quote may not exceed the market price by even one wei.
        vm.prank(safe);
        bond.setOracle(IOmrOracle(address(oracle)), 0, ORACLE_AGE);
        (uint256 ceiling, uint256 oraclePrice) = bond.priceCeiling();
        assertEq(ceiling, PRICE, "zero tolerance means the ceiling IS the oracle price");
        assertEq(oraclePrice, PRICE);
        OmertaBond.BondQuote memory over =
            OmertaBond.BondQuote(bonder, 1 ether, PRICE + 1, 0, 7 days, 1, block.timestamp + 1 hours);
        bytes memory sigOver = _sign(over, signerPk);
        vm.prank(bonder);
        vm.expectRevert(abi.encodeWithSelector(OmertaBond.PriceAboveOracle.selector, PRICE + 1, PRICE));
        bond.bond{value: 1 ether}(over, sigOver);
    }

    function test_oracle_tolerance_is_hard_capped_and_owner_only() public {
        // NOTE (subtree CLAUDE.md rule 1): read the cap BEFORE the cheatcodes. Calling
        // `bond.MAX_PRICE_TOLERANCE_BPS()` inside the argument list makes a staticcall that consumes
        // the pending `vm.prank`, so the guarded call would run as the test contract and revert on
        // ownership -- passing for the wrong reason.
        uint256 cap = bond.MAX_PRICE_TOLERANCE_BPS();
        vm.prank(safe);
        vm.expectRevert(OmertaBond.BadBps.selector);
        bond.setOracle(IOmrOracle(address(oracle)), cap + 1, ORACLE_AGE);
        vm.prank(makeAddr("nobody"));
        vm.expectRevert();
        bond.setOracle(IOmrOracle(address(oracle)), 100, ORACLE_AGE);
    }

    function test_oracle_revocation_is_a_kill_switch() public {
        // Unsetting the feed stops all bonding without a pause and without touching the token.
        vm.prank(safe);
        bond.setOracle(IOmrOracle(address(0)), TOLERANCE_BPS, ORACLE_AGE);
        OmertaBond.BondQuote memory q = _quote(bonder, 1 ether, 800, 7 days, 1);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        vm.expectRevert(OmertaBond.OracleUnset.selector);
        bond.bond{value: 1 ether}(q, sig);
    }

    /// The composition, fuzzed: whatever the oracle says and whatever is quoted, the OMR actually
    /// minted per ETH never exceeds EITHER ceiling. This is the property the whole four-wall design
    /// exists to provide, asserted against arbitrary inputs rather than the cases I thought of.
    function testFuzz_mint_rate_never_exceeds_either_ceiling(uint256 oraclePrice, uint256 quoted, uint256 disc) public {
        oraclePrice = bound(oraclePrice, 1e12, 1e28);
        quoted = bound(quoted, 1e12, 1e28);
        disc = bound(disc, 0, bond.MAX_DISCOUNT_BPS());
        oracle.set(oraclePrice, block.timestamp);

        uint256 supply0 = omr.totalSupply();
        OmertaBond.BondQuote memory q =
            OmertaBond.BondQuote(bonder, 1 ether, quoted, disc, 7 days, 1, block.timestamp + 1 hours);
        bytes memory sig = _sign(q, signerPk);
        vm.prank(bonder);
        try bond.bond{value: 1 ether}(q, sig) {
            uint256 minted = omr.totalSupply() - supply0;
            uint256 rate = (minted * 1e18) / 1 ether;
            assertLe(rate, bond.maxOmrPerEth(), "wall 3: the absolute ceiling always holds");
            (uint256 ceiling, ) = bond.priceCeiling();
            assertLe(quoted, ceiling, "wall 4: a bond that landed was priced within the oracle band");
        } catch {
            assertEq(omr.totalSupply(), supply0, "a refused bond mints nothing");
        }
    }
}
