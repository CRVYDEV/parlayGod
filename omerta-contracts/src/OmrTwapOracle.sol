// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOmrOracle} from "./IOmrOracle.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

/// @title OmrTwapOracle — a Uniswap V2 cumulative-price TWAP for the OMR/WETH pool.
/// @notice Feeds OmertaBond's accretion wall (v2 §4). A TWAP and not a spot read, because this
///         number sits on a MINT path: a spot price can be moved and restored inside one block by
///         anyone with a flash loan, so a spot-priced mint wall is not a wall.
///
///         HOW IT WORKS. A V2 pair accumulates `price*CumulativeLast` — the integral of price over
///         time. Two snapshots give the exact time-weighted average across the interval, with no
///         storage on the pair's side and no trust in whoever reads it. `update()` closes an
///         interval and is permissionless: anyone may poke it, and the worst a hostile poker can do
///         is close the window at a moment of their choosing — which is exactly why `PERIOD` is a
///         MINIMUM. Manipulating a TWAP means holding the price away from the market for the whole
///         window, in public, against arbitrageurs, and the cost scales with the window.
///
///         OPERATIONAL REQUIREMENT — THIS IS NOT SELF-DRIVING. `update()` must be poked by a keeper
///         at least once per `maxOracleAge` (the bond's staleness bound), or the reading goes stale
///         and bonding stops. That failure direction is deliberate: a dead keeper must halt the mint,
///         never open it. See CHAIN-DEPLOY.md.
///
///         FEE-ON-TRANSFER IS FINE HERE. OMR taxes transfers INTO the pair, so a seller delivers
///         less than they sent — that moves the price a TRADER receives, not the pool's own reserve
///         ratio, which is what the cumulative price integrates. The TWAP reads the pool price
///         correctly with the tax armed. (It is also why canonical liquidity must be V2 and not V3.)
///
///         WHAT THIS DOES NOT PROMISE. A TWAP is manipulation-RESISTANT, not manipulation-PROOF: a
///         sufficiently funded adversary can push a thin pool for a full window. That is why the
///         wall above composes this with `OmertaBond.maxOmrPerEth`, an absolute Safe-set ceiling the
///         oracle cannot raise. The oracle can only ever make the mint wall TIGHTER. Read
///         OmertaBond's header for why that composition, and not the oracle alone, is the guarantee.
contract OmrTwapOracle is IOmrOracle, Ownable2Step {
    /// @notice Minimum interval an `update()` may close. A shorter window is a cheaper window to
    ///         manipulate, so this is a floor and not a target — poking late is safe, poking early
    ///         reverts.
    uint32 public immutable PERIOD;
    /// @notice Floor on PERIOD at construction. Deploying a 30-second "TWAP" would be a spot price
    ///         wearing a TWAP's name, and this contract exists to prevent exactly that.
    uint32 public constant MIN_PERIOD = 10 minutes;

    IUniswapV2Pair public immutable pair;
    /// @dev True when OMR is the pair's token1, i.e. price0 (= token1 per token0) is OMR per WETH.
    bool public immutable omrIsToken1;

    uint256 public priceCumulativeLast;  // the OMR-per-WETH cumulative, whichever side that is
    uint32 public blockTimestampLast;    // when the last snapshot was taken (mod 2^32, V2 convention)
    /// @notice The TWAP, as UQ112x112. Zero until the first `update()` closes a full PERIOD, which
    ///         is what makes a freshly-deployed oracle read as unavailable rather than as zero-price.
    uint224 public priceAverage;
    uint256 public lastUpdate;           // unix seconds the current average closed (full width)

    event Updated(uint224 priceAverage, uint256 omrPerEth, uint32 timeElapsed);

    error PeriodTooShort();
    error ZeroAddress();
    error NotOmrPair();
    error NoReserves();
    error PeriodNotElapsed(uint32 elapsed, uint32 required);

    /// @param pair_ the OMR/WETH Uniswap V2-compatible pair
    /// @param omr   the OMR token, so the constructor can work out which side of the pair it is
    ///              rather than trusting a caller-supplied flag
    constructor(address owner_, IUniswapV2Pair pair_, address omr, uint32 period_) Ownable(owner_) {
        if (address(pair_) == address(0) || omr == address(0)) revert ZeroAddress();
        if (period_ < MIN_PERIOD) revert PeriodTooShort();
        pair = pair_;
        PERIOD = period_;

        address t0 = pair_.token0();
        address t1 = pair_.token1();
        if (t0 != omr && t1 != omr) revert NotOmrPair();
        // price0Cumulative is token1-per-token0. We want OMR per WETH, so we want the cumulative
        // whose NUMERATOR is OMR: price0 when OMR is token1, price1 when OMR is token0.
        omrIsToken1 = (t1 == omr);

        // Seed the first snapshot. `priceAverage` stays 0 until an update closes a full PERIOD, so
        // the oracle reports UNAVAILABLE (not zero-price) for its whole first window.
        (uint256 p0, uint256 p1, uint32 ts) = _currentCumulativePrices();
        priceCumulativeLast = omrIsToken1 ? p0 : p1;
        blockTimestampLast = ts;
    }

    /// @notice Close the current window and roll the average forward. PERMISSIONLESS by design —
    ///         gating it on a keeper role would mean a lost key freezes the price feed, and through
    ///         it the bond product. Anyone may poke; nobody can poke it early.
    function update() external {
        (uint256 p0, uint256 p1, uint32 ts) = _currentCumulativePrices();
        uint32 timeElapsed;
        unchecked { timeElapsed = ts - blockTimestampLast; } // wraps at 2^32, the V2 convention
        if (timeElapsed < PERIOD) revert PeriodNotElapsed(timeElapsed, PERIOD);

        uint256 cumulative = omrIsToken1 ? p0 : p1;
        unchecked {
            // The subtraction is deliberately wrapping: V2's cumulatives are allowed to overflow and
            // the DIFFERENCE stays correct across the wrap. This is the one place unchecked maths is
            // load-bearing rather than an optimisation.
            priceAverage = uint224((cumulative - priceCumulativeLast) / timeElapsed);
        }
        priceCumulativeLast = cumulative;
        blockTimestampLast = ts;
        lastUpdate = block.timestamp;

        emit Updated(priceAverage, _decode(priceAverage), timeElapsed);
    }

    /// @inheritdoc IOmrOracle
    function consult() external view returns (uint256 omrPerEth, uint256 updatedAt) {
        // Reports 0 before the first closed window — the interface's "no usable reading" signal,
        // which OmertaBond turns into a revert. Never a free pass.
        return (_decode(priceAverage), lastUpdate);
    }

    /// @dev UQ112x112 → OMR-wei per 1e18 ETH-wei. `mulDiv` for the 512-bit intermediate: the naive
    ///      `priceAverage * 1e18` overflows uint256 for large averages (2^224 * 10^18 > 2^256), which
    ///      would silently corrupt the exact reading the mint wall depends on.
    function _decode(uint224 avg) private pure returns (uint256) {
        if (avg == 0) return 0;
        return Math.mulDiv(uint256(avg), 1e18, uint256(1) << 112);
    }

    /// @dev The pair's cumulatives brought forward to NOW. A pair only writes its cumulative on a
    ///      touch (mint/burn/swap/sync), so on a quiet pool the stored value lags; V2's own periphery
    ///      does this same counterfactual accrual, and skipping it would silently shorten every
    ///      window by however long the pool sat idle.
    function _currentCumulativePrices()
        private view returns (uint256 price0Cumulative, uint256 price1Cumulative, uint32 blockTimestamp)
    {
        blockTimestamp = uint32(block.timestamp % 2 ** 32);
        price0Cumulative = pair.price0CumulativeLast();
        price1Cumulative = pair.price1CumulativeLast();
        (uint112 reserve0, uint112 reserve1, uint32 tsLast) = pair.getReserves();
        if (reserve0 == 0 || reserve1 == 0) revert NoReserves();
        if (tsLast != blockTimestamp) {
            unchecked {
                uint32 timeElapsed = blockTimestamp - tsLast; // wrapping, per V2
                price0Cumulative += ((uint256(reserve1) << 112) / reserve0) * timeElapsed;
                price1Cumulative += ((uint256(reserve0) << 112) / reserve1) * timeElapsed;
            }
        }
    }
}
