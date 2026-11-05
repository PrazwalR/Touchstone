// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {Lease} from "../types/Lease.sol";

/// @notice Leases one arbitrageur per pool an exemption from the clawback, for rent paid to the pool's LPs by the
/// second (spec §10). Reimplemented from the am-AMM paper (arXiv 2403.03367); no code is taken from BidDog.
interface ILicenceAuction {
    /// @notice Per-pool lease terms, fixed at registration.
    /// @param k Notice period in seconds: a bid becomes the holder k seconds after it is placed.
    /// @param minIncrementBps A new bid must beat the higher standing rent by this share, rounded up.
    /// @param minRent Reserve rent, quote base units per second.
    struct LeaseParams {
        uint32 k;
        uint16 minIncrementBps;
        uint128 minRent;
    }

    /// @notice Register a licence pool. Factory only.
    /// @param key The pool; its quote currency must be an ERC-20.
    /// @param params Its lease terms, already validated by the factory.
    function register(PoolKey calldata key, LeaseParams calldata params) external;

    /// @notice Place a pending bid. It becomes the holder k seconds from now unless a higher bid replaces it.
    /// @param id The pool.
    /// @param swapper The address whose swaps the lease will exempt.
    /// @param rent Quote base units per second; at least minNextRent(id).
    /// @param deposit Quote base units pulled from the caller; at least rent * k.
    function bid(PoolId id, address swapper, uint128 rent, uint128 deposit) external;

    /// @notice Add to a lease's deposit. Lease owner only.
    /// @param id The pool.
    /// @param amount Quote base units pulled from the caller.
    /// @param isTop True for the holder's lease, false for the pending bid.
    function topUp(PoolId id, uint128 amount, bool isTop) external;

    /// @notice Withdraw from a lease's deposit while it still covers k seconds of rent. Lease owner only.
    /// @param id The pool.
    /// @param amount Quote base units to withdraw.
    /// @param isTop True for the holder's lease, false for the pending bid.
    /// @param to Recipient.
    function withdraw(PoolId id, uint128 amount, bool isTop, address to) external;

    /// @notice Change the exempt address, effective at once. Lease owner only.
    /// @param id The pool.
    /// @param swapper The new exempt address.
    /// @param isTop True for the holder's lease, false for the pending bid.
    function setSwapper(PoolId id, address swapper, bool isTop) external;

    /// @notice Apply every transition up to now and send the rent charged since the last call to the hook.
    /// @param id The pool.
    /// @return rentCharged Rent charged and credited by this call.
    function accrue(PoolId id) external returns (uint256 rentCharged);

    /// @notice Withdraw the caller's displaced deposits in `currency`.
    /// @param currency The quote currency.
    /// @param to Recipient.
    /// @return amount Amount sent.
    function claimRefund(Currency currency, address to) external returns (uint256 amount);

    /// @notice The exempt address and whether a lease is live now, with every transition applied in memory.
    /// @param id The pool.
    /// @return swapper The holder's exempt address; zero when no lease is live.
    /// @return live True while a lease is live.
    function holderOf(PoolId id) external view returns (address swapper, bool live);

    /// @notice The holder's lease and the pending bid as of now.
    /// @param id The pool.
    /// @return top The holder's lease; all zero when none is live.
    /// @return next The pending bid; all zero when none.
    function leases(PoolId id) external view returns (Lease memory top, Lease memory next);

    /// @notice The lowest rent a new bid may offer now.
    /// @param id The pool.
    /// @return The minimum rent, quote base units per second.
    function minNextRent(PoolId id) external view returns (uint128);

    /// @notice Displaced deposits `owner` can claim in `currency`.
    /// @param owner The former lease owner.
    /// @param currency The quote currency.
    /// @return The claimable amount.
    function refunds(address owner, Currency currency) external view returns (uint256);

    /// @notice A pool's lease terms, fixed at registration; all zero for a pool without the licence.
    /// @param id The pool.
    /// @return quote The currency rent and deposits are paid in.
    /// @return k Notice in seconds: a bid activates k seconds after it is placed, and a deposit must cover k seconds.
    /// @return minIncrementBps How far a bid must outbid the holder and the pending bid.
    /// @return minRent The lowest rent any bid may offer, quote base units per second.
    function terms(PoolId id) external view returns (address quote, uint32 k, uint16 minIncrementBps, uint128 minRent);
}
