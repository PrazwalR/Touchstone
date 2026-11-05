// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice What a swap would deposit if it executed in the current block (spec §12.1).
/// @dev Amounts are in quote units. A deposit taken in the risky token is the quote amount converted at the swap's
/// own execution price, which only the swap itself knows.
struct DepositQuote {
    bool flaggedNow; // the swap would post a deposit in this block
    bool exempt; // the licence fast path would apply to the swapper; always false until the licence (M9)
    uint8 mode; // DepositLib.MODE_CONTINUOUS or MODE_CLOSED
    uint16 rateBps; // deposit as a share of notional, if flagged
    uint8 triggers; // TriggerLib bitmask: FLOW | FIRST_TOUCH | DRIFT | CLOSED
    uint256 depositIfFlagged; // quote units, whatever the trigger state
    uint256 depositNow; // quote units, 0 unless flaggedNow
    uint64 settleAfter; // t0
    uint64 expiresAt; // t0 + W, or t0 + W_c
}
