// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Test double for Arbitrum's ArbSys precompile, etched at address(100) in tests only.
contract MockArbSys {
    uint256 public arbBlockNumber;

    function setBlock(uint256 n) external {
        arbBlockNumber = n;
    }
}
