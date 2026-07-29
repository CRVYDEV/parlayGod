// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IOmrOracle — the price feed OmertaBond's accretion wall reads.
/// @notice Deliberately the narrowest possible surface. `OmertaBond` needs one number and the time
///         it was observed, and should be reviewable as needing exactly that. Keeping this an
///         INTERFACE rather than an inlined TWAP is what lets the Safe swap the implementation
///         (V2 pool → V3 pool → a Chainlink-style feed) without touching the mint path, and lets an
///         auditor review the mint path without reading a fixed-point maths library.
///
///         CONTRACT WITH IMPLEMENTORS — all three matter to the wall above:
///         1. `omrPerEth` is OMR (18dp) per ONE ETH (1e18 wei), TIME-AVERAGED, never spot. A spot
///            reading on the mint path is manipulable inside a single block and must never be used.
///         2. Return `omrPerEth == 0` to signal "no usable reading". OmertaBond treats 0 as
///            unavailable and REVERTS — never as a free pass.
///         3. `updatedAt` is when the returned average CLOSED, not when it was asked for. Returning
///            `block.timestamp` unconditionally defeats the caller's staleness check.
interface IOmrOracle {
    /// @return omrPerEth OMR (18dp) per 1 ETH, time-averaged. 0 means no usable reading.
    /// @return updatedAt unix seconds at which the returned average closed.
    function consult() external view returns (uint256 omrPerEth, uint256 updatedAt);
}
