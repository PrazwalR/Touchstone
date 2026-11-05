// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @title DepositLib
/// @notice Deposit size for a flagged swap: D = N * min(deltaMax, max(delta, beta * g+)), or N * delta_c
/// for a closure record.
/// @dev Scaling with the pre-swap gap g keeps the cap from binding on large dislocations, which is
/// where most toxic markout sits.
library DepositLib {
    uint8 internal constant MODE_CONTINUOUS = 0;
    uint8 internal constant MODE_CLOSED = 1;
    uint256 internal constant BPS = 10_000;

    /// @notice Deposit rate in basis points.
    /// @param mode MODE_CONTINUOUS or MODE_CLOSED.
    /// @param gapBps Signed pre-swap gap to the reference, positive toward it; 0 when no reference.
    /// @param deltaBps Floor rate delta.
    /// @param deltaMaxBps Cap delta_max.
    /// @param betaX100 Gap multiplier beta, times 100.
    /// @param deltaClosedBps Closure rate delta_c.
    function rateBps(
        uint8 mode,
        int256 gapBps,
        uint16 deltaBps,
        uint16 deltaMaxBps,
        uint16 betaX100,
        uint16 deltaClosedBps
    ) internal pure returns (uint256) {
        if (mode == MODE_CLOSED) return deltaClosedBps;
        uint256 gPlus = gapBps > 0 ? uint256(gapBps) : 0;
        uint256 scaled = (uint256(betaX100) * gPlus) / 100;
        uint256 rate = scaled > deltaBps ? scaled : deltaBps;
        return rate < deltaMaxBps ? rate : deltaMaxBps;
    }

    /// @notice Deposit in quote units, rounded down.
    function quoteAmount(uint256 notionalQuote, uint256 rate) internal pure returns (uint256) {
        return FullMath.mulDiv(notionalQuote, rate, BPS);
    }

    /// @notice Deposit converted into the risky token at the swap's own execution price, rounded down.
    /// @dev No oracle is read at swap time; the execution price comes from the swap's own delta.
    /// @param depositQuote Deposit in quote units.
    /// @param riskyAmount Risky base units the swap moved (AMM part, absolute).
    /// @param quoteAmountAbs Quote base units the swap moved (AMM part, absolute).
    function toRisky(uint256 depositQuote, uint256 riskyAmount, uint256 quoteAmountAbs)
        internal
        pure
        returns (uint256)
    {
        return FullMath.mulDiv(depositQuote, riskyAmount, quoteAmountAbs);
    }
}
