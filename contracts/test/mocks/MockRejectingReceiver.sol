// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";

interface IDrip {
    function drip(PoolKey calldata key) external returns (uint256, uint256);
}

/// @notice A refund beneficiary that rejects native ETH, or tries to re-enter the hook when paid.
contract MockRejectingReceiver {
    address public hook;
    PoolKey internal _key;
    bool public reenter;

    function setReenter(address hook_, PoolKey calldata key) external {
        hook = hook_;
        _key = key;
        reenter = true;
    }

    receive() external payable {
        if (reenter) IDrip(hook).drip(_key);
        else revert("MockRejectingReceiver: no ETH");
    }
}
