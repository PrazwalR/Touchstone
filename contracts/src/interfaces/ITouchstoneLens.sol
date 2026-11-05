// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {DepositQuote} from "../types/DepositQuote.sol";

/// @notice The quotes the hook forwards to (spec §12.1 and §12.2). The lens also implements URC-4's IALFHook, which
/// the hook serves through its fallback. Call the hook, not the lens: only the hook knows whether the current
/// transaction has already touched the pool.
interface ITouchstoneLens {
    /// @notice What a swap of `notionalQuote` would deposit if it executed in this block.
    function previewDeposit(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 notionalQuote,
        address swapper,
        bool touchedInTx
    ) external view returns (DepositQuote memory);
}
