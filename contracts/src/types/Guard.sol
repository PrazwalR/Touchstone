// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A trader's limits for one GuardedRouter swap (spec §12.4). Amounts are in token base units.
struct Guard {
    uint256 maxDeposit; // most the trader lets the hook hold, in the deposit currency
    uint256 minNetOut; // exact input: least received now; exact output: unused
    uint256 minGrossOut; // exact input: least of received now plus the deposit
    uint256 maxNetIn; // exact output: most paid now, deposit included
}
