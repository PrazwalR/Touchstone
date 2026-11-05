// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @title VestingLib
/// @notice Computes the release from the remaining buffer for one drip interval.
/// @dev Donation recipients are the LPs in range when drip executes; this does not enforce a
/// holding period or prevent JIT capture. Repeated drips change the remaining-balance schedule.
library VestingLib {
    /// @notice Amount to donate now: vest * min(1, elapsed / period), rounded down.
    /// @param vest Buffer balance not yet donated.
    /// @param elapsed Seconds since the last drip.
    /// @param period vestPeriod from PoolConfig.
    function releasable(uint256 vest, uint256 elapsed, uint256 period) internal pure returns (uint256) {
        if (elapsed >= period) return vest;
        return FullMath.mulDiv(vest, elapsed, period);
    }
}
