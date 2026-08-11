// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OMR} from "../src/OMR.sol";
import {OmertaBond} from "../src/OmertaBond.sol";
import {IOmrOracle} from "../src/IOmrOracle.sol";
import {GenesisOracle} from "../src/GenesisOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// THE GENESIS WINDOW's feed. Driven THROUGH `OmertaBond` wherever a property is about what the
/// bond does with this oracle, because that is the only consumer and "returns the right tuple" is
/// not the claim that matters — "bonding works for the whole window and then stops, fail-closed" is.
///
/// The one thing worth stating up front: this contract deliberately returns `block.timestamp` as
/// `updatedAt`, which `IOmrOracle` warns implementors against. The warning protects an OBSERVED
/// feed, where a stale reading means a dead keeper. An administered price has no keeper, so
/// time-staleness is replaced by an EXPLICIT window — and the tests below are what make that
/// substitution honest rather than a loophole: the window must genuinely end, and it must end
/// closed.
contract GenesisOracleTest is Test {
    OMR omr;
    OmertaBond bond;
    GenesisOracle gen;

    address safe = makeAddr("safe");
    uint256 signerPk = 0xB0B;
    address signer;
    address payable pol = payable(makeAddr("pol"));
    address payable dev = payable(makeAddr("dev"));
    address payable rwa = payable(makeAddr("rwa"));
    address payable vig = payable(makeAddr("vig"));
    address bonder = makeAddr("bonder");

    uint256 constant PRICE = 205_882e18;      // the published genesis price, OMR per 1 ETH
    uint256 constant MAX_RATE = 400_000e18;   // wall 3, generous so wall 4 is what binds here
    uint256 constant TOLERANCE_BPS = 500;
    uint256 constant ORACLE_AGE = 1 hours;    // deliberately SHORTER than the window below
    uint256 constant WINDOW = 3 days;         // the launch doc's longest genesis window

    function setUp() public {
        signer = vm.addr(signerPk);
        omr = new OMR(safe);
        bond = new OmertaBond(safe, signer, IERC20(address(omr)), 5000, 2000, 1000, pol, dev, rwa, vig, 0, MAX_RATE);
        gen = new GenesisOracle(safe, PRICE, block.timestamp + WINDOW);
        vm.startPrank(safe);
        omr.setMinter(address(bond));
        bond.setOracle(IOmrOracle(address(gen)), TOLERANCE_BPS, ORACLE_AGE);
        vm.stopPrank();
        vm.deal(bonder, 100 ether);
    }

    function _quote(uint256 principal, uint256 nonce) internal view returns (OmertaBond.BondQuote memory) {
        return OmertaBond.BondQuote(bonder, principal, PRICE, 800, 120 hours, nonce, block.timestamp + 1 hours);
    }

    function _sign(OmertaBond.BondQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, bond.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _bond(uint256 principal, uint256 nonce) internal {
        OmertaBond.BondQuote memory q = _quote(principal, nonce);
        bytes memory sig = _sign(q);            // hoisted above the prank — hashQuote is a STATICCALL
        vm.prank(bonder);                        // that would otherwise consume it (the subtree's own footgun)
        bond.bond{value: principal}(q, sig);
    }

    // ── THE WHOLE POINT: bonding must survive the entire window ───────────────────────────────────
    /// The failure this design exists to avoid: `updatedAt = the moment the Safe last set the price`
    /// would halt bonding one `maxOracleAge` into the window — silently, during the single event
    /// that funds the pool, fixable only by a human re-poking a number that never changed. The
    /// window here is 3 days against a 1-hour age limit, so if that were the shape, bonding would be
    /// dead 71 hours before the window closes.
    function test_bonding_works_for_the_whole_window_not_one_max_age() public {
        _bond(1 ether, 1);
        vm.warp(block.timestamp + WINDOW - 1);   // 71h59m in — far past ORACLE_AGE
        _bond(1 ether, 2);
        assertGt(bond.committedOMR(), 0, "the genesis window must not go stale under the bond's age check");
    }

    // ── AND IT MUST END, CLOSED ───────────────────────────────────────────────────────────────────
    /// Replacing time-staleness with an explicit window is only honest if the window genuinely ends.
    /// Past `validUntil` the feed reports the interface's own "no usable reading", which the bond
    /// turns into a revert — the same fail-closed path a dead TWAP takes.
    function test_past_the_window_the_feed_goes_dark_and_bonding_refuses() public {
        vm.warp(block.timestamp + WINDOW + 1);
        (uint256 p, uint256 t) = gen.consult();
        assertEq(p, 0, "past the window the feed reports no usable reading");
        assertEq(t, 0, "...and does not offer a timestamp to reason about");
        OmertaBond.BondQuote memory q = _quote(1 ether, 3);
        bytes memory sig = _sign(q);
        vm.expectRevert(OmertaBond.OracleUnavailable.selector);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, sig);
    }

    /// The boundary itself: `validUntil` is inclusive, so the last second of the window still bonds.
    function test_the_last_second_of_the_window_still_bonds() public {
        vm.warp(gen.validUntil());
        _bond(1 ether, 4);
        assertGt(bond.committedOMR(), 0, "the window is inclusive of its final second");
    }

    // ── THE KILL SWITCH ───────────────────────────────────────────────────────────────────────────
    /// Zero is already the interface's "unavailable", so stopping the window needs no pause flag and
    /// no second code path — which is the argument for not adding one.
    function test_setting_the_price_to_zero_stops_the_window_immediately() public {
        _bond(1 ether, 5);
        vm.prank(safe);
        gen.setPrice(0, 0);
        (uint256 p,) = gen.consult();
        assertEq(p, 0, "zero closes the window");
        OmertaBond.BondQuote memory q = _quote(1 ether, 6);
        bytes memory sig = _sign(q);
        vm.expectRevert(OmertaBond.OracleUnavailable.selector);
        vm.prank(bonder);
        bond.bond{value: 1 ether}(q, sig);
    }

    // ── AUTHORITY ─────────────────────────────────────────────────────────────────────────────────
    function test_only_the_safe_sets_the_price() public {
        vm.expectRevert();
        vm.prank(bonder);
        gen.setPrice(1, block.timestamp + 1 days);
    }

    /// A window that is already over would deploy a contract that can never answer — a silent no-op
    /// at exactly the moment somebody is trying to open bonding, which is the worst time to debug.
    function test_a_window_in_the_past_is_refused() public {
        vm.warp(1000);
        vm.expectRevert(GenesisOracle.WindowInThePast.selector);
        new GenesisOracle(safe, PRICE, 999);
        vm.prank(safe);
        vm.expectRevert(GenesisOracle.WindowInThePast.selector);
        gen.setPrice(PRICE, 999);
    }

    /// …but deploying CLOSED (price 0) is legal, so the Safe can put the contract in place before
    /// deciding the window, which is the sequence CHAIN-DEPLOY actually follows.
    function test_deploying_closed_is_legal() public {
        GenesisOracle shut = new GenesisOracle(safe, 0, 0);
        (uint256 p,) = shut.consult();
        assertEq(p, 0, "a closed feed answers nothing - and that is a valid deploy state");
    }

    // ── THE CUTOVER ───────────────────────────────────────────────────────────────────────────────
    /// The launch's one operation: at pool init the Safe points the bond at the real TWAP. The
    /// genesis feed is retired by being unreferenced — nothing needs to be torn down, which is why
    /// `IOmrOracle` is an interface at all. Proven by pointing the bond at a second feed and
    /// watching a bond succeed on the new price while the old contract still sits there answering.
    function test_the_safe_can_swap_this_feed_out_for_the_twap() public {
        GenesisOracle successor = new GenesisOracle(safe, PRICE * 2, block.timestamp + 1 days);
        vm.prank(safe);
        bond.setOracle(IOmrOracle(address(successor)), TOLERANCE_BPS, ORACLE_AGE);
        (uint256 ceiling,) = bond.priceCeiling();
        assertGt(ceiling, PRICE * 2, "the bond reads the NEW feed after the swap");
        (uint256 stillLive,) = gen.consult();
        assertEq(stillLive, PRICE, "the retired feed needs no teardown - it is simply unreferenced");
    }
}
