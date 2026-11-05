// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolConfig} from "../types/PoolConfig.sol";
import {ILicenceAuction} from "./ILicenceAuction.sol";

/// @notice Validates configs, registers them with the hook and the auction, and initializes pools.
interface ITouchstoneFactory {
    /// @notice Validate bounds (spec §14), register with the hook and, for a licence pool, the auction, then
    /// initialize.
    /// @param key The pool; key.hooks must be the hook and the fee static.
    /// @param cfg The config; decimals and calendarValidUntil are overwritten from chain state.
    /// @param lease Lease terms; read only when cfg.flags has LICENCE.
    /// @param sqrtPriceX96 Initial price.
    /// @return id The pool id.
    function createPool(
        PoolKey calldata key,
        PoolConfig calldata cfg,
        ILicenceAuction.LeaseParams calldata lease,
        uint160 sqrtPriceX96
    ) external returns (PoolId id);

    /// @notice The canonical config of a pool created here.
    /// @param id The pool.
    /// @return The config; all zero for an unknown pool.
    function poolConfig(PoolId id) external view returns (PoolConfig memory);
}
