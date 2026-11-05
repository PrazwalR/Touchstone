// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Chainlink's price feed interface, vendored instead of adding the whole Chainlink repository.
/// @dev Source: github.com/smartcontractkit/chainlink-evm, contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol
/// (MIT), commit 358bb0dd6765130147d2638f6107818d256c8191. The function signatures are unchanged; the pragma
/// is pinned to this repository's compiler and NatSpec was added.
interface AggregatorV3Interface {
    /// @return The number of decimals in the answer.
    function decimals() external view returns (uint8);

    /// @return A human-readable description of the feed.
    function description() external view returns (string memory);

    /// @return The aggregator version.
    function version() external view returns (uint256);

    /// @notice Data for a given round.
    /// @param _roundId The round to read.
    /// @return roundId The round ID.
    /// @return answer The answer for this round.
    /// @return startedAt Timestamp when the round started.
    /// @return updatedAt Timestamp when the round was updated.
    /// @return answeredInRound Deprecated; the round in which the answer was computed.
    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    /// @notice Data for the latest round.
    /// @return roundId The round ID.
    /// @return answer The latest answer.
    /// @return startedAt Timestamp when the round started.
    /// @return updatedAt Timestamp when the round was updated.
    /// @return answeredInRound Deprecated; the round in which the answer was computed.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
