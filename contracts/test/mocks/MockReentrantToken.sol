// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// @notice An ERC-20 that calls back into a target once during transferFrom, as a hostile or hook-bearing token
/// could, and records how the callback failed.
contract MockReentrantToken is MockERC20 {
    address internal target;
    bytes internal payload;
    bytes public lastRevert;

    constructor() MockERC20("Reentrant", "RE", 6) {}

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        address t = target;
        if (t != address(0)) {
            target = address(0);
            (bool ok, bytes memory ret) = t.call(payload);
            if (!ok) lastRevert = ret;
        }
        return super.transferFrom(from, to, amount);
    }
}
