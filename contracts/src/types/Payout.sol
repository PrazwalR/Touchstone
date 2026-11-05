// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A settlement split, built by the Settler and checked for conservation by the hook.
/// @dev All amounts are in the record's deposit currency.
struct Payout {
    bool benign; // true: rebate path, nothing retained
    uint128 refund; // to the beneficiary
    uint128 tip; // to tipTo; from R, or from the rebate pool if benign
    uint128 toProtocol; // share of R, credited to protocolRecipient
    uint128 toRebatePool; // share of R
    uint128 toLPs; // share of R, vested
    uint128 rebate; // from the rebate pool to rebateTo
    address tipTo;
}
