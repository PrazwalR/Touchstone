// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Record} from "../types/Record.sol";

/// @title RecordLib
/// @notice Hashing and unit helpers for records, shared by the hook and the Settler.
library RecordLib {
    /// @notice The commitment the hook stores for an open record.
    function hash(Record memory r) internal pure returns (bytes32) {
        return keccak256(abi.encode(r));
    }

    /// @notice The trader's signed receipts of the risky and quote tokens.
    /// @param r The record.
    /// @param quoteIs0 True if currency0 is the quote token.
    /// @return xRisky Risky base units received (negative if paid).
    /// @return xQuote Quote base units received (negative if paid).
    function receipts(Record memory r, bool quoteIs0) internal pure returns (int256 xRisky, int256 xQuote) {
        return quoteIs0 ? (int256(r.amount1), int256(r.amount0)) : (int256(r.amount0), int256(r.amount1));
    }

    /// @notice The swap's notional in quote base units.
    function notional(Record memory r, bool quoteIs0) internal pure returns (uint256) {
        int256 q = quoteIs0 ? int256(r.amount0) : int256(r.amount1);
        return q >= 0 ? uint256(q) : uint256(-q);
    }

    /// @notice True if the deposit was taken in the quote token.
    function depositIsQuote(Record memory r, bool quoteIs0) internal pure returns (bool) {
        return r.depositIn0 == quoteIs0;
    }
}
