// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Test double for the two Pyth functions the Settler calls, with the exact
/// parsePriceFeedUpdatesUnique rule: publishTime in [min, max] and prevPublishTime < min.
/// @dev Pyth's own MockPyth (SDK at pyth-evm-contract-v1.4.6) passes checkUniqueness = false from
/// parsePriceFeedUpdatesUnique, so it would accept a caller-chosen later update and hide T1.
/// Update data uses the SDK mock's encoding: abi.encode(PythStructs.PriceFeed, uint64 prevPublishTime).
contract MockPythUnique {
    error PriceFeedNotFoundWithinRange();
    error InsufficientFee();

    uint256 public immutable FEE_PER_UPDATE;

    constructor(uint256 feePerUpdate) {
        FEE_PER_UPDATE = feePerUpdate;
    }

    function getUpdateFee(bytes[] calldata updateData) public view returns (uint256) {
        return FEE_PER_UPDATE * updateData.length;
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PythStructs.PriceFeed[] memory feeds) {
        if (msg.value < getUpdateFee(updateData)) revert InsufficientFee();
        feeds = new PythStructs.PriceFeed[](priceIds.length);
        for (uint256 i; i < priceIds.length; ++i) {
            bool found;
            for (uint256 j; j < updateData.length; ++j) {
                (PythStructs.PriceFeed memory f, uint64 prev) =
                    abi.decode(updateData[j], (PythStructs.PriceFeed, uint64));
                if (f.id != priceIds[i]) continue;
                uint256 t = f.price.publishTime;
                if (t >= minPublishTime && t <= maxPublishTime && prev < minPublishTime) {
                    feeds[i] = f;
                    found = true;
                    break;
                }
            }
            if (!found) revert PriceFeedNotFoundWithinRange();
        }
    }

    function encode(bytes32 id, int64 price, uint64 conf, int32 expo, uint64 publishTime, uint64 prevPublishTime)
        external
        pure
        returns (bytes memory)
    {
        PythStructs.PriceFeed memory f;
        f.id = id;
        f.price = PythStructs.Price(price, conf, expo, publishTime);
        f.emaPrice = f.price;
        return abi.encode(f, prevPublishTime);
    }
}
