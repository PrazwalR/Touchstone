// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

/// @notice PoolSwapTest that also reports the address that started the swap, as IMsgSender routers do.
contract MockTrustedRouter is PoolSwapTest {
    address public msgSender;

    constructor(IPoolManager manager) PoolSwapTest(manager) {}

    function setMsgSender(address who) external {
        msgSender = who;
    }
}
