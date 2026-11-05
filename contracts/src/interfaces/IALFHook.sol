// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/// @notice URC-4, Active Liquidity Framework Hook Interface (draft, in Discussion since 11 June 2026).
/// @dev Copied from the draft's reference implementation, which extends IERC165. The two errors keep
/// URC-4's names, the only exception to the Touchstone__ prefix rule. The hook raises
/// MalformedHookData from M2; it implements the quoting functions through the lens in M10.
interface IALFHook is IERC165 {
    error MissingHookData();
    error MalformedHookData();

    /// @notice Indicative quote including the hook's effect; 0 when the hook cannot price.
    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, bytes calldata hookData)
        external
        view
        returns (uint256 quoteAmount);

    /// @notice True if the hook can execute swaps now.
    function isLive() external view returns (bool);

    /// @notice Worst-case gas of getIndicativeQuote.
    function maxGas() external view returns (uint32);

    /// @notice Quote a swap that stops at a price limit.
    function swapToPrice(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external view returns (uint256 amountIn, uint256 amountOut);
}
