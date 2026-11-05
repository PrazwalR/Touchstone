// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolConfig} from "../types/PoolConfig.sol";
import {Record} from "../types/Record.sol";
import {Payout} from "../types/Payout.sol";
import {IRebateLedger} from "./IRebateLedger.sol";

/// @notice Events of the hook, the Settler and the RebateLedger.
/// @dev Settled and Expired are emitted by the Settler, which alone knows the markout, fair price
/// and alpha (decision 0018). LicensedSwap and RentCredited come from the hook; the rest of the licence events
/// from the LicenceAuction.
interface ITouchstoneEvents {
    /// @notice A pool's config was registered by the factory.
    event PoolRegistered(PoolId indexed id, PoolConfig cfg);
    /// @notice A flagged swap posted a deposit; the record is everything a settler needs.
    event DepositTaken(PoolId indexed id, uint64 indexed recordId, Record record);
    /// @notice A record was settled against the first Pyth update at or after its settlement time.
    event Settled(
        PoolId indexed id, uint64 indexed recordId, int256 markout, uint256 fairPriceX36, uint16 alphaBps, Payout payout
    );
    /// @notice A record expired and was refunded in full.
    event Expired(PoolId indexed id, uint64 indexed recordId, uint256 refund);
    /// @notice A refund could not be pushed and was credited in the ledger instead.
    event RefundDeferred(PoolId indexed id, uint64 indexed recordId, address beneficiary, uint256 amount);
    /// @notice Vested value was donated to in-range LPs.
    event Dripped(PoolId indexed id, uint256 amount0, uint256 amount1);
    /// @notice A benign record's rebate was credited in the ledger.
    event RebateCredited(
        PoolId indexed id, uint64 indexed recordId, address indexed recipient, Currency currency, uint256 amount
    );
    /// @notice URC-2: exactly one per swap to which the hook contributed a token delta.
    event HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee);
    /// @notice The Uniswap Foundation's 2025 hook data guide event for hooks that rebate swappers.
    event HookBonus(bytes32 indexed id, uint128 amount0, uint128 amount1);

    /// @notice The licence holder's first swap in a block, inside the band, posted no deposit.
    event LicensedSwap(PoolId indexed id, address indexed swapper, int128 amount0, int128 amount1);
    /// @notice Lease rent reached the hook: the protocol share went to the ledger, then rho to the rebate pool, and
    /// the rest started vesting to in-range LPs.
    event RentCredited(PoolId indexed id, uint256 amount, uint256 toRebatePool, uint256 toVesting);

    /// @notice A pending bid was placed; it becomes the holder at activatesAt unless a higher bid replaces it.
    event BidPlaced(
        PoolId indexed id, address indexed owner, address swapper, uint128 rent, uint128 deposit, uint40 activatesAt
    );
    /// @notice A pending bid became the holder.
    event LeaseActivated(PoolId indexed id, address indexed owner, address swapper, uint128 rent);
    /// @notice The holder's deposit ran out at `at`; the pool runs the plain clawback until a bid activates.
    event LeaseLapsed(PoolId indexed id, address indexed owner, uint40 at);
    /// @notice Rent charged since the last accrual, sent to the hook.
    event RentCharged(PoolId indexed id, uint256 amount);
    /// @notice A lease's exempt address changed.
    event SwapperSet(PoolId indexed id, bool isTop, address swapper);
    /// @notice A lease's deposit changed through a top-up or a withdrawal.
    event DepositChanged(PoolId indexed id, bool isTop, uint128 deposit);
    /// @notice A displaced deposit was credited to its owner, claimable with claimRefund.
    event RefundCredited(address indexed owner, Currency currency, uint256 amount);
    /// @notice An owner withdrew its displaced deposits.
    event RefundClaimed(address indexed owner, Currency currency, address to, uint256 amount);

    /// @notice The ledger credited `amount` to `recipient`.
    event Credited(address indexed recipient, Currency currency, uint256 amount, IRebateLedger.Kind kind);
    /// @notice `recipient` withdrew `amount` to `to`.
    event Claimed(address indexed recipient, Currency currency, address to, uint256 amount);
}
