// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {Guard} from "../types/Guard.sol";

/// @notice Single-pool swaps with an in-transaction check of the deposit Touchstone took (spec §12.4).
interface IGuardedRouter {
    /// @notice Swap on one Touchstone pool and revert unless the deposit and output satisfy `guard`.
    /// @param key The pool.
    /// @param params The swap; a negative amountSpecified is exact input.
    /// @param guard The trader's limits.
    /// @param rebateTo Where benign-flow rebates go; zero means the trader.
    /// @param deadline Last timestamp at which the swap may execute.
    /// @return delta The trader's balance delta, deposit included.
    /// @return deposit The deposit the hook took, in the deposit currency; zero if the swap was not flagged.
    function swapGuarded(
        PoolKey calldata key,
        SwapParams calldata params,
        Guard calldata guard,
        address rebateTo,
        uint256 deadline
    ) external payable returns (BalanceDelta delta, uint256 deposit);
}
