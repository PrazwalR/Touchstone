// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice One flagged swap. Passed as calldata and committed by hash; never stored whole.
/// @dev amount0 and amount1 are the AMM part of the swap, from the swapper's side: negative
/// means the swapper paid the pool, positive means it received.
struct Record {
    PoolId poolId;
    uint64 id;
    uint40 timestamp;
    uint8 mode; // 0 continuous, 1 closure
    bool licenceActive;
    bool byHolder;
    bool zeroForOne;
    bool depositIn0; // deposit currency is currency0
    address sender; // caller of PoolManager.swap
    address beneficiary;
    address rebateTo;
    uint128 deposit;
    int128 amount0;
    int128 amount1;
    uint160 sqrtPriceBeforeX96;
    uint160 sqrtPriceAfterX96;
    uint128 liquidityBefore;
    uint24 swapFeePips; // executed directional LP plus PoolManager protocol fee, captured before the swap
}
