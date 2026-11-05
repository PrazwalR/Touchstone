// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Per-pool mutable state, five slots.
/// @dev
/// slot A: lastTouchBlock (64) | nextRecordId (64) | vestLast (40)
/// slot B: flowBuy (104) | flowSell (104) | flowTime (40)    read and written on every swap
/// slot C: outstanding0 (128) | outstanding1 (128)
/// slot D: rebatePool0 (128) | rebatePool1 (128)
/// slot E: vest0 (128) | vest1 (128)
struct PoolState {
    uint64 lastTouchBlock; // BlockLib number of the last first touch at or above n0
    uint64 nextRecordId;
    uint40 vestLast; // time of the last drip
    uint104 flowBuy; // leaky buckets in quote units, stored plus one so the slot never returns to zero
    uint104 flowSell;
    uint40 flowTime; // time of the last bucket update
    uint128 outstanding0; // claims held for open records, currency0
    uint128 outstanding1;
    uint128 rebatePool0; // claims reserved for rebates
    uint128 rebatePool1;
    uint128 vest0; // retained value and rent not yet donated
    uint128 vest1;
}
