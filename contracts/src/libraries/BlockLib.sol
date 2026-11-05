// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Arbitrum's precompile for the L2 block number.
interface IArbSys {
    /// @return The current L2 block number.
    function arbBlockNumber() external view returns (uint256);
}

/// @title BlockLib
/// @notice The block number the first-touch rule uses.
/// @dev On Arbitrum and its Orbit chains `block.number` returns an approximate parent-chain block
/// number, so many L2 blocks share one value. The source is a constructor immutable chosen by the
/// deploy script, never a chain-ID check, so a new Orbit chain needs no code change.
library BlockLib {
    uint8 internal constant SOURCE_EVM = 0;
    uint8 internal constant SOURCE_ARBSYS = 1;

    /// @dev ArbSys lives at address 0x64 on every Arbitrum chain.
    IArbSys internal constant ARBSYS = IArbSys(address(100));

    /// @notice The block number for `source`.
    /// @param source SOURCE_EVM or SOURCE_ARBSYS.
    /// @return The block number, truncated to 64 bits, which no chain will exceed.
    function number(uint8 source) internal view returns (uint64) {
        if (source == SOURCE_ARBSYS) return uint64(ARBSYS.arbBlockNumber());
        return uint64(block.number);
    }
}
