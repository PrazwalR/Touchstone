// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Per-pool parameters, fixed at registration and never changed afterwards.
/// @dev Slots 0-2 are read on the swap path.
/// slot 0: n0 (96) | nMin (96) | flowHorizon (32) | flags (8) | tauBps (16)
/// slot 1: referenceFeed (160) | referenceMaxAge (32) | deltaBps (16) | deltaMaxBps (16) | betaX100 (16)
/// slot 2: calendar (160) | calendarValidUntil (40) | deltaClosedBps (16) | maxConfBps (16) | bandBps (16)
/// slot 3: basePriceId (256)    slot 4: quotePriceId (256)
/// slot 5: settleDelay | maxLag | window | openDelay | maxLagClosed | windowClosed (6 x 32)
///         | decimals0 (8) | decimals1 (8) | alphaBps (16) | epsBps (16)
/// slot 6: alphaLicensedBps | alphaClosedBps | epsClosedBps | jumpRefundBps | tipBps | rhoBps | kappaBps (7 x 16)
///         | vestPeriod (32)
/// slot 7: tipCap (128) | maxOutstanding (128)
/// slot 8: protocolRecipient (160) | protocolShareBps (16)
struct PoolConfig {
    uint96 n0; // quote units; below this, only the flow trigger applies
    uint96 nMin; // flow bucket threshold, quote units
    uint32 flowHorizon; // seconds for a full bucket to drain
    uint8 flags; // QUOTE_IS_0 = 1, LICENCE = 2, ITM_ACCOUNTING = 4
    uint16 tauBps; // drift trigger
    address referenceFeed; // Chainlink aggregator (spec: `reference`, a reserved word); zero turns the drift trigger off
    uint32 referenceMaxAge;
    uint16 deltaBps;
    uint16 deltaMaxBps;
    uint16 betaX100; // 125 means 1.25
    address calendar; // zero for crypto pools
    uint40 calendarValidUntil; // copied from the calendar at registration
    uint16 deltaClosedBps;
    uint16 maxConfBps;
    uint16 bandBps; // G
    bytes32 basePriceId; // Pyth
    bytes32 quotePriceId;
    uint32 settleDelay; // settlement delay
    uint32 maxLag;
    uint32 window; // W
    uint32 openDelay;
    uint32 maxLagClosed;
    uint32 windowClosed; // W_c
    uint8 decimals0;
    uint8 decimals1;
    uint16 alphaBps;
    uint16 epsBps;
    uint16 alphaLicensedBps;
    uint16 alphaClosedBps;
    uint16 epsClosedBps;
    uint16 jumpRefundBps;
    uint16 tipBps;
    uint16 rhoBps;
    uint16 kappaBps;
    uint32 vestPeriod;
    uint128 tipCap; // quote units
    uint128 maxOutstanding; // quote units; no new deposits above it
    address protocolRecipient; // fee recipient for the protocol share
    uint16 protocolShareBps; // share of retained value and rent; 0 where no protocol fee applies
}

/// @notice Bits of PoolConfig.flags.
library PoolFlags {
    uint8 internal constant QUOTE_IS_0 = 1;
    uint8 internal constant LICENCE = 2;
    uint8 internal constant ITM_ACCOUNTING = 4;
    /// @dev Set by the factory, never by the creator: the pool has a market calendar. Kept in the flags word the
    /// swap path already reads, so crypto pools pay no extra storage read for closed-market mode.
    uint8 internal constant CALENDAR = 8;

    /// @notice True if `flag` is set in `flags`.
    function has(uint8 flags, uint8 flag) internal pure returns (bool) {
        return flags & flag != 0;
    }
}
