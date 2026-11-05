// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolConfig} from "../types/PoolConfig.sol";
import {PoolState} from "../types/PoolState.sol";
import {Record} from "../types/Record.sol";
import {Payout} from "../types/Payout.sol";
import {DepositQuote} from "../types/DepositQuote.sol";

/// @notice The hook's external surface beyond the v4 callbacks.
/// @dev The full config is read from the factory's registry (decision 0027). The URC-4 IALFHook forwarders arrive with
/// the lens (M10); decision 0024.
interface ITouchstoneHook {
    /// @notice Register a pool's config before it is initialized. Factory only.
    /// @param key The pool.
    /// @param cfg Its config, already validated by the factory.
    function register(PoolKey calldata key, PoolConfig calldata cfg) external;

    /// @notice Pay out a settled or expired record. Settler only.
    /// @param record The record, matching its committed hash.
    /// @param payout The split, which must conserve the deposit.
    /// @param expired True for an expiry, which must refund in full.
    function finalize(Record calldata record, Payout calldata payout, bool expired) external;

    /// @notice Donate the vested share of retained value to in-range LPs. Anyone may call.
    /// @param key The pool.
    /// @return amount0 Currency0 donated.
    /// @return amount1 Currency1 donated.
    function drip(PoolKey calldata key) external returns (uint256 amount0, uint256 amount1);

    /// @notice Account for lease rent the LicenceAuction has already settled into the hook's ERC-6909 claims of the
    /// pool's quote token. LicenceAuction only.
    /// @param key A licence pool.
    /// @param amount Rent in quote base units.
    function creditRent(PoolKey calldata key, uint256 amount) external;

    /// @notice The LicenceAuction; zero on a deployment without licence pools.
    function LICENCE() external view returns (address);

    /// @notice Where the hook reads block numbers: BlockLib.SOURCE_EVM or SOURCE_ARBSYS.
    function BLOCK_SOURCE() external view returns (uint8);

    /// @notice The Chainlink L2 sequencer uptime feed; zero where the chain has none.
    function SEQUENCER_FEED() external view returns (address);

    /// @notice Seconds after the sequencer restarts before the reference counts as fresh again.
    function SEQUENCER_GRACE() external view returns (uint32);

    /// @notice The hash of an open record; zero once it is settled or expired.
    function recordHash(PoolId id, uint64 recordId) external view returns (bytes32);

    /// @notice A pool's config.

    /// @notice A pool's mutable state.
    function poolState(PoolId id) external view returns (PoolState memory);

    /// @notice A registered pool's key.
    function poolKey(PoolId id) external view returns (PoolKey memory);

    /// @notice The deposit the last swap on `id` in this transaction posted; zero after an unflagged swap.
    /// @return amount Deposit in the deposit currency.
    /// @return recordId Its record.
    function lastDeposit(PoolId id) external view returns (uint256 amount, uint64 recordId);

    /// @notice The deposit a swap of `notionalQuote` would post if it executed in this block (spec §12.1). The swap
    /// path and this view share the trigger, mode and deposit computation, so within one block they agree.
    /// @dev depositNow changes if another swap lands first in the block, or if the swap lands in a later block
    /// where first touch is fresh; a router that cannot choose its block should plan with depositIfFlagged.
    /// @param key The pool.
    /// @param zeroForOne Swap direction.
    /// @param notionalQuote The swap's quote-side amount, in quote base units.
    /// @param swapper The address whose swap this is: the trader for a trusted router, else the caller. It decides
    /// whether the licence fast path would exempt the swap.
    /// @return quote The deposit quote.
    function previewDeposit(PoolKey calldata key, bool zeroForOne, uint256 notionalQuote, address swapper)
        external
        view
        returns (DepositQuote memory quote);
}
