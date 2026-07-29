// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OmrTwapOracle, IUniswapV2Pair} from "../src/OmrTwapOracle.sol";

/// A Uniswap V2 pair, faithful to the ONE behaviour this oracle depends on: `price*CumulativeLast`
/// is only written when the pair is TOUCHED, and it accumulates price x elapsed-time in UQ112x112.
/// Everything else about a real pair is irrelevant here and deliberately absent.
contract MockPair is IUniswapV2Pair {
    address public token0;
    address public token1;
    uint112 private r0;
    uint112 private r1;
    uint32 private tsLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address t0, address t1, uint112 reserve0, uint112 reserve1) {
        token0 = t0; token1 = t1; r0 = reserve0; r1 = reserve1;
        tsLast = uint32(block.timestamp % 2 ** 32);
    }

    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, tsLast); }

    /// Move the price, accruing the cumulative for the elapsed period FIRST — exactly what
    /// `_update` does inside a real pair on every swap/mint/burn/sync.
    function setReserves(uint112 reserve0, uint112 reserve1) external {
        uint32 ts = uint32(block.timestamp % 2 ** 32);
        unchecked {
            uint32 elapsed = ts - tsLast;
            if (elapsed > 0 && r0 != 0 && r1 != 0) {
                price0CumulativeLast += ((uint256(r1) << 112) / r0) * elapsed;
                price1CumulativeLast += ((uint256(r0) << 112) / r1) * elapsed;
            }
        }
        r0 = reserve0; r1 = reserve1; tsLast = ts;
    }
}

contract OmrTwapOracleTest is Test {
    address weth = makeAddr("weth");
    address omr = makeAddr("omr");
    address safe = makeAddr("safe");

    uint32 constant PERIOD = 30 minutes;

    MockPair pair;
    OmrTwapOracle oracle;

    function setUp() public {
        vm.warp(1_000_000);
        // OMR is token1: 1 WETH reserve vs 5000 OMR reserve → 5000 OMR per ETH
        pair = new MockPair(weth, omr, 1_000e18, 5_000_000e18);
        oracle = new OmrTwapOracle(safe, IUniswapV2Pair(address(pair)), omr, PERIOD);
    }

    function test_reads_the_right_side_of_the_pair() public view {
        assertTrue(oracle.omrIsToken1(), "OMR is token1 here, so price0 (token1/token0) is OMR per WETH");
    }

    function test_reversed_pair_ordering_is_detected_not_trusted() public {
        // Pair ordering is decided by address sort, not by us. Getting this backwards would invert
        // every price the mint wall reads, so the constructor works it out rather than being told.
        MockPair flipped = new MockPair(omr, weth, 5_000_000e18, 1_000e18);
        OmrTwapOracle o2 = new OmrTwapOracle(safe, IUniswapV2Pair(address(flipped)), omr, PERIOD);
        assertFalse(o2.omrIsToken1());

        vm.warp(block.timestamp + PERIOD + 1);
        o2.update();
        (uint256 price, ) = o2.consult();
        assertApproxEqRel(price, 5000e18, 1e15, "same market, same price, whichever side OMR sits on");
    }

    function test_unavailable_before_the_first_closed_window() public view {
        // THE ONE THAT MATTERS MOST: a freshly deployed oracle must read as "no reading", because
        // OmertaBond turns 0 into a revert. If this returned a price, the mint wall would be live
        // on a number derived from nothing.
        (uint256 price, ) = oracle.consult();
        assertEq(price, 0, "no usable reading until a full PERIOD has been closed");
    }

    function test_update_refuses_before_the_period_elapses() public {
        vm.warp(block.timestamp + PERIOD - 1);
        vm.expectRevert();
        oracle.update();
    }

    function test_closes_a_window_and_reports_the_average() public {
        vm.warp(block.timestamp + PERIOD + 1);
        oracle.update();
        (uint256 price, uint256 updatedAt) = oracle.consult();
        assertApproxEqRel(price, 5000e18, 1e15, "5000 OMR per ETH");
        assertEq(updatedAt, block.timestamp, "updatedAt is when the average CLOSED");
    }

    function test_a_spike_inside_the_window_is_averaged_not_adopted() public {
        // THE POINT OF A TWAP. Hold a 10x price for a tenth of the window and the reading barely
        // moves — where a spot read would have adopted the manipulated price wholesale.
        vm.warp(block.timestamp + PERIOD + 1);
        oracle.update();

        // 90% of a window at the true price...
        vm.warp(block.timestamp + (PERIOD * 9) / 10);
        pair.setReserves(1_000e18, 50_000_000e18); // ...then spike to 50,000 OMR/ETH
        // ...for the remaining 10%
        vm.warp(block.timestamp + PERIOD / 10 + 1);
        oracle.update();

        (uint256 price, ) = oracle.consult();
        assertLt(price, 12_000e18, "a brief 10x spike must not drag the average anywhere near it");
        assertGt(price, 5_000e18, "but it is not ignored either -- it is averaged in");
    }

    function test_a_sustained_move_IS_adopted() public {
        // The other half of the property: a TWAP must track a real re-pricing, or the wall above it
        // blocks honest bonds forever after any genuine market move.
        vm.warp(block.timestamp + PERIOD + 1);
        oracle.update();
        pair.setReserves(1_000e18, 10_000_000e18); // the market really moved to 10,000 OMR/ETH
        vm.warp(block.timestamp + PERIOD * 10);    // and stayed there
        oracle.update();
        (uint256 price, ) = oracle.consult();
        assertApproxEqRel(price, 10_000e18, 1e16, "a sustained move is tracked");
    }

    function test_counterfactual_accrual_covers_an_idle_pool() public {
        // A pair only writes its cumulative when touched. On a quiet pool the stored value lags, and
        // an oracle that ignored that would shorten every window by however long nobody traded.
        vm.warp(block.timestamp + PERIOD * 5); // nobody touches the pair at all
        oracle.update();                       // must still close a valid 5-period window
        (uint256 price, ) = oracle.consult();
        assertApproxEqRel(price, 5000e18, 1e15, "an untouched pool still prices correctly");
    }

    function test_period_floor_is_enforced_at_construction() public {
        // A 30-second "TWAP" is a spot price wearing a TWAP's name. This contract exists to stop that.
        vm.expectRevert(OmrTwapOracle.PeriodTooShort.selector);
        new OmrTwapOracle(safe, IUniswapV2Pair(address(pair)), omr, 30);
    }

    function test_constructor_rejects_a_pair_that_is_not_an_OMR_pair() public {
        MockPair wrong = new MockPair(weth, makeAddr("other"), 1_000e18, 1_000e18);
        vm.expectRevert(OmrTwapOracle.NotOmrPair.selector);
        new OmrTwapOracle(safe, IUniswapV2Pair(address(wrong)), omr, PERIOD);
    }

    function test_update_is_permissionless() public {
        // Gating the poke on a keeper role would mean a lost key freezes the feed and, through it,
        // the whole bond product. Anyone may poke; nobody can poke early.
        vm.warp(block.timestamp + PERIOD + 1);
        vm.prank(makeAddr("a passing stranger"));
        oracle.update();
        (uint256 price, ) = oracle.consult();
        assertGt(price, 0);
    }

    function test_empty_reserves_revert_rather_than_divide_by_zero() public {
        MockPair empty = new MockPair(weth, omr, 0, 0);
        vm.expectRevert(OmrTwapOracle.NoReserves.selector);
        new OmrTwapOracle(safe, IUniswapV2Pair(address(empty)), omr, PERIOD);
    }

    /// The decode must not overflow. `priceAverage * 1e18` overflows uint256 for large averages,
    /// which is why the implementation uses a 512-bit mulDiv — fuzzed across the whole plausible
    /// price range because a silent overflow here corrupts the exact number the mint wall trusts.
    function testFuzz_price_decode_survives_extremes(uint112 reserveOmr) public {
        reserveOmr = uint112(bound(uint256(reserveOmr), 1e12, type(uint112).max / 2));
        MockPair p = new MockPair(weth, omr, 1_000e18, reserveOmr);
        OmrTwapOracle o = new OmrTwapOracle(safe, IUniswapV2Pair(address(p)), omr, PERIOD);
        vm.warp(block.timestamp + PERIOD + 1);
        o.update();
        (uint256 price, ) = o.consult();
        // the expected OMR-per-ETH, computed independently of the contract's fixed-point path
        uint256 expected = (uint256(reserveOmr) * 1e18) / 1_000e18;
        assertApproxEqRel(price, expected, 1e15, "decoded price tracks the reserve ratio at any scale");
    }
}
