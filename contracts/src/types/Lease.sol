// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice One lease of a pool's clawback exemption (spec §10).
/// @dev Three slots:
/// slot 0: owner (160) | since (40)
/// slot 1: swapper (160)
/// slot 2: rent (128) | deposit (128)
struct Lease {
    address owner; // pays rent; may top up, withdraw and change the swapper
    uint40 since; // top: rent paid up to here; pending: time of the bid
    address swapper; // the address whose swaps are exempt
    uint128 rent; // quote-token base units per second
    uint128 deposit; // quote-token base units, as of `since`
}
