// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title FlowBucketLib
/// @notice Two leaky buckets per pool, one per direction, that catch arbitrage split into small swaps.
/// @dev Both buckets share one timestamp in PoolState slot B, so every update drains both to the
/// same time before adding to one of them. Levels are stored plus one so the slot never returns to
/// zero, which keeps every later write a 2,900-gas reset instead of a 20,000-gas set.
library FlowBucketLib {
    uint256 internal constant MAX_LEVEL = type(uint104).max - 1;

    /// @notice Drain both buckets to `nowTs`, add `notional` to one, and report whether it is full.
    /// @param storedBuy Stored buy level, plus one; zero means never written.
    /// @param storedSell Stored sell level, plus one.
    /// @param lastTime Time of the last update.
    /// @param nowTs Current block timestamp.
    /// @param nMin Threshold at which a bucket flags, in quote units.
    /// @param horizon Seconds for a full bucket to drain to empty.
    /// @param notional This swap's notional in quote units.
    /// @param isBuy True if this swap buys the risky asset.
    /// @return newBuy New stored buy level, plus one.
    /// @return newSell New stored sell level, plus one.
    /// @return hit True if this swap's bucket holds at least nMin after adding `notional`.
    function update(
        uint104 storedBuy,
        uint104 storedSell,
        uint40 lastTime,
        uint40 nowTs,
        uint256 nMin,
        uint32 horizon,
        uint256 notional,
        bool isBuy
    ) internal pure returns (uint104 newBuy, uint104 newSell, bool hit) {
        if (horizon == 0) revert ITouchstoneErrors.Touchstone__ZeroHorizon();
        // A timestamp never moves backwards within a chain, so nowTs >= lastTime.
        uint256 drained = (nMin * (nowTs - lastTime)) / horizon;
        uint256 buy = _drain(storedBuy, drained);
        uint256 sell = _drain(storedSell, drained);
        if (isBuy) {
            buy = _add(buy, notional);
            hit = buy >= nMin;
        } else {
            sell = _add(sell, notional);
            hit = sell >= nMin;
        }
        // buy, sell <= MAX_LEVEL, so plus one fits in 104 bits.
        unchecked {
            newBuy = uint104(buy + 1);
            newSell = uint104(sell + 1);
        }
    }

    function _drain(uint104 stored, uint256 drained) private pure returns (uint256) {
        uint256 level = stored == 0 ? 0 : uint256(stored) - 1;
        return level > drained ? level - drained : 0;
    }

    function _add(uint256 level, uint256 notional) private pure returns (uint256) {
        uint256 sum = level + notional;
        return sum > MAX_LEVEL ? MAX_LEVEL : sum;
    }
}
