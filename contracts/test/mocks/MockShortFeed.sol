// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A "feed" that answers every call with a single word, as a feed with a broken implementation might
/// (audit GEN-3).
contract MockShortFeed {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(1));
    }
}
