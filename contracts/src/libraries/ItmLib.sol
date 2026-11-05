// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

/// @title ItmLib
/// @notice In-the-money accounting: the part of a swap executed before the pool price crossed P*.
/// @dev Units traded past P* lose money to the trader, so counting them would dilute the markout
/// and let an arbitrageur pad its swap until its average markout falls inside the margin. This
/// library recomputes the in-the-money leg at the record's pre-swap liquidity. A swap that crossed
/// initialized ticks makes that an approximation. Exact tick-by-tick differential validation is
/// outstanding; the current Python replay is not independent proof of exact reconstruction.
library ItmLib {
    uint256 internal constant PIPS = 1_000_000;

    /// @notice Amounts for the in-the-money leg, signed from the trader's side (receipts positive).
    /// @param zeroForOne Swap direction.
    /// @param sqrtBefore Pre-swap sqrt price.
    /// @param sqrtAfter Post-swap sqrt price.
    /// @param sqrtFair sqrt price at P*.
    /// @param liquidity Pre-swap in-range liquidity.
    /// @param feePips Executed swap fee, including the directional protocol fee, used to gross up the input.
    /// @return amount0 Trader's currency0 delta for the leg.
    /// @return amount1 Trader's currency1 delta for the leg.
    /// @return overshot True if the swap crossed P*, so the leg is shorter than the swap.
    function leg(
        bool zeroForOne,
        uint160 sqrtBefore,
        uint160 sqrtAfter,
        uint160 sqrtFair,
        uint128 liquidity,
        uint24 feePips
    ) internal pure returns (int256 amount0, int256 amount1, bool overshot) {
        if (zeroForOne) {
            // Price falls. Only units sold while the pool was above P* are in the money.
            if (sqrtFair >= sqrtBefore) return (0, 0, true);
            uint160 end = sqrtAfter > sqrtFair ? sqrtAfter : sqrtFair;
            overshot = sqrtAfter < sqrtFair;
            uint256 inNet = SqrtPriceMath.getAmount0Delta(end, sqrtBefore, liquidity, true);
            uint256 out = SqrtPriceMath.getAmount1Delta(end, sqrtBefore, liquidity, false);
            amount0 = -SafeCast.toInt256(_grossUp(inNet, feePips));
            amount1 = SafeCast.toInt256(out);
        } else {
            if (sqrtFair <= sqrtBefore) return (0, 0, true);
            uint160 end = sqrtAfter < sqrtFair ? sqrtAfter : sqrtFair;
            overshot = sqrtAfter > sqrtFair;
            uint256 inNet = SqrtPriceMath.getAmount1Delta(sqrtBefore, end, liquidity, true);
            uint256 out = SqrtPriceMath.getAmount0Delta(sqrtBefore, end, liquidity, false);
            amount0 = SafeCast.toInt256(out);
            amount1 = -SafeCast.toInt256(_grossUp(inNet, feePips));
        }
    }

    /// @dev Input including the LP fee, as v4's SwapMath charges it on exact input.
    function _grossUp(uint256 amountNet, uint24 feePips) private pure returns (uint256) {
        return FullMath.mulDivRoundingUp(amountNet, PIPS, PIPS - feePips);
    }
}
