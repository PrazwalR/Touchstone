// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title TriggerLib
/// @notice The fixed rules that decide whether a swap posts a deposit (spec §7.5).
/// @dev The flow bucket sees every swap; the other triggers apply only at or above N0.
library TriggerLib {
    uint8 internal constant FIRST_TOUCH = 1;
    uint8 internal constant FLOW = 2;
    uint8 internal constant DRIFT = 4;
    uint8 internal constant CLOSED = 8;

    /// @notice Whether a swap at or above N0 is a first touch, and whether it uses up the block's status.
    /// @param lastTouchBlock BlockLib number of the last first touch on this pool.
    /// @param currentBlock BlockLib number now.
    /// @param inFirstTouchTx True if an earlier swap in this transaction was this pool's first touch.
    /// @return isFirst True if the swap counts as a first touch.
    /// @return consumes True if the caller must record currentBlock and mark the transaction.
    function firstTouch(uint64 lastTouchBlock, uint64 currentBlock, bool inFirstTouchTx)
        internal
        pure
        returns (bool isFirst, bool consumes)
    {
        if (inFirstTouchTx) return (true, false);
        if (lastTouchBlock < currentBlock) return (true, true);
        return (false, false);
    }

    /// @notice True if the signed pre-swap gap reaches the drift threshold.
    /// @param gapBps Signed gap toward the reference, from PriceLib.signedGapBps.
    /// @param tauBps Drift threshold.
    function drift(int256 gapBps, uint16 tauBps) internal pure returns (bool) {
        return gapBps >= int256(uint256(tauBps));
    }

    /// @notice The triggers that fired, as a bitmask; the swap is flagged if it is non-zero.
    /// @param flowHit The direction's bucket holds at least N_min after this swap.
    /// @param large The swap's notional is at least N0.
    /// @param isFirst First touch, from firstTouch.
    /// @param closed The calendar is closed at t or at t + delay + maxLag.
    /// @param drifted Drift threshold reached, from drift.
    function triggers(bool flowHit, bool large, bool isFirst, bool closed, bool drifted)
        internal
        pure
        returns (uint8 mask)
    {
        if (flowHit) mask |= FLOW;
        if (!large) return mask;
        if (isFirst) mask |= FIRST_TOUCH;
        if (closed) mask |= CLOSED;
        if (drifted) mask |= DRIFT;
    }
}
