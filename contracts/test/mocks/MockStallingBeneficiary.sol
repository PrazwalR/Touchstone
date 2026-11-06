// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

/// @notice Leaves an unsettled PoolManager delta while returning successfully from a native refund.
contract MockStallingBeneficiary {
    IPoolManager internal immutable POOL_MANAGER;

    constructor(IPoolManager manager) {
        POOL_MANAGER = manager;
    }

    receive() external payable {
        POOL_MANAGER.mint(address(this), 0, 1);
    }
}
