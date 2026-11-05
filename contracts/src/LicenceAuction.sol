// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ILicenceAuction} from "./interfaces/ILicenceAuction.sol";
import {ITouchstoneHook} from "./interfaces/ITouchstoneHook.sol";
import {ITouchstoneFactory} from "./interfaces/ITouchstoneFactory.sol";
import {ITouchstoneErrors} from "./interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "./interfaces/ITouchstoneEvents.sol";
import {TransientLib} from "./libraries/TransientLib.sol";
import {PoolFlags} from "./types/PoolConfig.sol";
import {Lease} from "./types/Lease.sol";

/// @title LicenceAuction
/// @notice Leases one arbitrageur per pool an exemption from the clawback, for rent paid to the pool's LPs by the
/// second (spec §10). A bid waits k seconds before it becomes the holder; the holder pays rent from its deposit until
/// a higher bid activates or the deposit runs out.
/// @dev Reimplemented from the am-AMM of Adams, Moallemi, Reynolds and Robinson (arXiv 2403.03367) and spec §10; no
/// code is taken from Bunni's BidDog (AGPL-3.0). Time is in seconds, rent is in the pool's quote token and goes to
/// the hook, and bids carry no fee payload. Every state transition is computed by one pure function, _advance, which
/// the views apply in memory and accrue applies to storage, so the swap path never writes auction state. There is no
/// owner and no upgrade path. Rent reaches the hook as ERC-6909 claims: accrue settles the quote tokens with the
/// PoolManager and mints the claims to the hook before calling creditRent (decision 0056).
contract LicenceAuction is ILicenceAuction, IUnlockCallback, ITouchstoneErrors, ITouchstoneEvents {
    using SafeERC20 for IERC20;
    using PoolFlags for uint8;

    /// @dev Per-pool terms. slot 0: quote (160) | k (32) | minIncrementBps (16); slot 1: minRent (128).
    struct Terms {
        address quote;
        uint32 k;
        uint16 minIncrementBps;
        uint128 minRent;
    }

    /// @dev What one advance did besides charging rent: up to two holders ended (the standing one, and a pending bid
    /// that activated and then ran out before now), each with the deposit left to return and, if it lapsed, when.
    struct Effects {
        uint256 charged;
        bool activated;
        address endedOwner0;
        uint256 returned0;
        uint40 lapsedAt0;
        address endedOwner1;
        uint256 returned1;
        uint40 lapsedAt1;
    }

    uint256 internal constant BPS = 10_000;

    IPoolManager public immutable POOL_MANAGER;
    ITouchstoneHook public immutable HOOK;
    ITouchstoneFactory public immutable FACTORY;

    mapping(PoolId => Terms) internal _terms;
    mapping(PoolId => Lease) internal _top;
    mapping(PoolId => Lease) internal _next;
    mapping(address => mapping(Currency => uint256)) internal _refunds;

    modifier nonReentrant() {
        _lock();
        _;
        TransientLib.setLock(false);
    }

    /// @param manager The v4 PoolManager, which holds the rent as the hook's claims.
    /// @param hook The TouchstoneHook, which receives rent through creditRent.
    /// @param factory The TouchstoneFactory, the only caller of register.
    constructor(IPoolManager manager, ITouchstoneHook hook, address factory) {
        POOL_MANAGER = manager;
        HOOK = hook;
        FACTORY = ITouchstoneFactory(factory);
    }

    /// @inheritdoc ILicenceAuction
    function register(PoolKey calldata key, LeaseParams calldata params) external {
        if (msg.sender != address(FACTORY)) revert Touchstone__NotFactory();
        PoolId id = key.toId();
        if (_terms[id].quote != address(0)) revert Touchstone__AlreadyRegistered(id);
        Currency quote = FACTORY.poolConfig(id).flags.has(PoolFlags.QUOTE_IS_0) ? key.currency0 : key.currency1;
        if (quote.isAddressZero()) revert Touchstone__QuoteNotErc20();
        _terms[id] = Terms({
            quote: Currency.unwrap(quote), k: params.k, minIncrementBps: params.minIncrementBps, minRent: params.minRent
        });
    }

    /// @inheritdoc ILicenceAuction
    function bid(PoolId id, address swapper, uint128 rent, uint128 deposit) external nonReentrant {
        Terms memory t = _registered(id);
        uint256 charged = _advanceStored(id, t);
        Lease storage next = _next[id];
        uint128 minimum = _minNextRent(t, _top[id].rent, next.rent);
        if (rent < minimum) revert Touchstone__BidTooLow(minimum);
        uint256 notice = uint256(rent) * t.k;
        if (deposit < notice) revert Touchstone__DepositBelowNotice(notice);
        // The displaced pending bid never charged rent, so its whole deposit goes back to its owner.
        if (next.owner != address(0)) _credit(next.owner, t.quote, next.deposit);
        _next[id] =
            Lease({owner: msg.sender, since: uint40(block.timestamp), swapper: swapper, rent: rent, deposit: deposit});
        emit BidPlaced(id, msg.sender, swapper, rent, deposit, uint40(block.timestamp + t.k));
        _pull(t.quote, deposit);
        _sendRent(id, t.quote, charged);
    }

    /// @inheritdoc ILicenceAuction
    function topUp(PoolId id, uint128 amount, bool isTop) external nonReentrant {
        Terms memory t = _registered(id);
        uint256 charged = _advanceStored(id, t);
        Lease storage l = _owned(id, isTop);
        l.deposit += amount;
        emit DepositChanged(id, isTop, l.deposit);
        _pull(t.quote, amount);
        _sendRent(id, t.quote, charged);
    }

    /// @inheritdoc ILicenceAuction
    function withdraw(PoolId id, uint128 amount, bool isTop, address to) external nonReentrant {
        Terms memory t = _registered(id);
        uint256 charged = _advanceStored(id, t);
        Lease storage l = _owned(id, isTop);
        uint256 notice = uint256(l.rent) * t.k;
        if (amount > l.deposit || l.deposit - amount < notice) revert Touchstone__DepositBelowNotice(notice);
        l.deposit -= amount;
        emit DepositChanged(id, isTop, l.deposit);
        IERC20(t.quote).safeTransfer(to, amount);
        _sendRent(id, t.quote, charged);
    }

    /// @inheritdoc ILicenceAuction
    function setSwapper(PoolId id, address swapper, bool isTop) external nonReentrant {
        Terms memory t = _registered(id);
        uint256 charged = _advanceStored(id, t);
        _owned(id, isTop).swapper = swapper;
        emit SwapperSet(id, isTop, swapper);
        _sendRent(id, t.quote, charged);
    }

    /// @inheritdoc ILicenceAuction
    function accrue(PoolId id) external nonReentrant returns (uint256 rentCharged) {
        Terms memory t = _registered(id);
        rentCharged = _advanceStored(id, t);
        _sendRent(id, t.quote, rentCharged);
    }

    /// @inheritdoc ILicenceAuction
    function claimRefund(Currency currency, address to) external nonReentrant returns (uint256 amount) {
        amount = _refunds[msg.sender][currency];
        if (amount == 0) revert Touchstone__NothingToClaim();
        delete _refunds[msg.sender][currency];
        emit RefundClaimed(msg.sender, currency, to, amount);
        IERC20(Currency.unwrap(currency)).safeTransfer(to, amount);
    }

    /// @inheritdoc ILicenceAuction
    /// @dev Read on every licence-pool swap at or above N0, so it reads only what the answer needs: the terms' first
    /// slot, the pending bid's first slot and, unless that bid is already due, the holder's three slots (spec target:
    /// six cold reads). A pending bid that is due falls back to the full state machine; testFuzz_HolderOfMatchesAdvance
    /// and the licence invariants check that both routes agree.
    function holderOf(PoolId id) external view returns (address swapper, bool live) {
        Terms storage t = _terms[id];
        uint32 k = t.k;
        if (t.quote == address(0)) return (address(0), false);
        Lease storage next = _next[id];
        if (next.owner != address(0) && uint256(next.since) + k <= block.timestamp) {
            (Lease memory top,,) = _advance(_top[id], next, k, block.timestamp);
            return top.owner == address(0) ? (address(0), false) : (top.swapper, true);
        }
        Lease storage held = _top[id];
        if (held.owner == address(0)) return (address(0), false);
        // No activation before now, so the holder stands unless its own deposit has run out.
        if (uint256(held.since) + held.deposit / held.rent <= block.timestamp) return (address(0), false);
        return (held.swapper, true);
    }

    /// @inheritdoc ILicenceAuction
    function leases(PoolId id) external view returns (Lease memory top, Lease memory next) {
        Terms memory t = _terms[id];
        if (t.quote == address(0)) return (top, next);
        (top, next,) = _advance(_top[id], _next[id], t.k, block.timestamp);
    }

    /// @inheritdoc ILicenceAuction
    function minNextRent(PoolId id) external view returns (uint128) {
        Terms memory t = _registered(id);
        (Lease memory top, Lease memory next,) = _advance(_top[id], _next[id], t.k, block.timestamp);
        return _minNextRent(t, top.rent, next.rent);
    }

    /// @inheritdoc ILicenceAuction
    function refunds(address owner, Currency currency) external view returns (uint256) {
        return _refunds[owner][currency];
    }

    /// @inheritdoc ILicenceAuction
    function terms(PoolId id) external view returns (address quote, uint32 k, uint16 minIncrementBps, uint128 minRent) {
        Terms storage t = _terms[id];
        return (t.quote, t.k, t.minIncrementBps, t.minRent);
    }

    /// @dev Effects only: apply every transition up to now to storage and credit what ended leases leave behind.
    /// Every caller makes its own state changes next and calls _sendRent last, so no state is written after an
    /// external call (checks-effects-interactions).
    function _advanceStored(PoolId id, Terms memory t) internal returns (uint256 charged) {
        Lease memory before = _next[id];
        (Lease memory top, Lease memory next, Effects memory e) = _advance(_top[id], before, t.k, block.timestamp);
        _top[id] = top;
        _next[id] = next;
        if (e.endedOwner0 != address(0)) _end(id, t.quote, e.endedOwner0, e.returned0, e.lapsedAt0);
        if (e.endedOwner1 != address(0)) _end(id, t.quote, e.endedOwner1, e.returned1, e.lapsedAt1);
        if (e.activated) emit LeaseActivated(id, before.owner, before.swapper, before.rent);
        if (e.charged != 0) emit RentCharged(id, e.charged);
        return e.charged;
    }

    /// @dev Interactions: settle the rent charged into the hook's claims, then let the hook account for it.
    function _sendRent(PoolId id, address quote, uint256 charged) internal {
        if (charged == 0) return;
        POOL_MANAGER.unlock(abi.encode(quote, charged));
        HOOK.creditRent(HOOK.poolKey(id), charged);
    }

    /// @notice Settles rent with the PoolManager and mints it to the hook as claims. PoolManager only, and only
    /// inside this contract's own unlock, which the PoolManager guarantees by calling back the unlocker.
    /// @param data ABI-encoded quote token and amount.
    /// @return Empty.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert Touchstone__NotPoolManager();
        (address quote, uint256 amount) = abi.decode(data, (address, uint256));
        Currency c = Currency.wrap(quote);
        POOL_MANAGER.sync(c);
        IERC20(quote).safeTransfer(address(POOL_MANAGER), amount);
        POOL_MANAGER.settle();
        POOL_MANAGER.mint(address(HOOK), c.toId(), amount);
        return "";
    }

    function _end(PoolId id, address quote, address owner, uint256 returned, uint40 lapsedAt) internal {
        if (lapsedAt != 0) emit LeaseLapsed(id, owner, lapsedAt);
        if (returned != 0) _credit(owner, quote, returned);
    }

    /// @dev The lease state machine of spec §10, from the stored leases to `nowTs`, in time order:
    /// 1. the holder lapses at since + deposit / rent if that comes before the pending bid's activation;
    /// 2. the pending bid activates at its since + k; a holder still standing then pays rent up to that instant and
    ///    the rest of its deposit goes back to its owner;
    /// 3. a holder activated in step 2 lapses too if its own deposit runs out before nowTs;
    /// 4. the holder left standing pays rent up to nowTs, and its since moves to nowTs.
    /// Rent is rent * seconds, never more than the deposit (I13), and a lapse returns the remainder below one
    /// second of rent, as research/reference/touchstone_ref.py rent_due does.
    function _advance(Lease memory top, Lease memory next, uint32 k, uint256 nowTs)
        internal
        pure
        returns (Lease memory, Lease memory, Effects memory e)
    {
        uint256 activation = next.owner == address(0) ? type(uint256).max : uint256(next.since) + k;
        if (top.owner != address(0)) {
            uint256 lapse = _lapseAt(top);
            if (lapse <= nowTs && lapse <= activation) {
                (e.endedOwner0, e.returned0, e.lapsedAt0) = (top.owner, _charge(top, lapse, e), uint40(lapse));
                delete top;
            }
        }
        if (activation <= nowTs) {
            if (top.owner != address(0)) {
                (e.endedOwner0, e.returned0) = (top.owner, _charge(top, activation, e));
            }
            top = next;
            top.since = uint40(activation);
            delete next;
            e.activated = true;
            uint256 lapse = _lapseAt(top);
            if (lapse <= nowTs) {
                (e.endedOwner1, e.returned1, e.lapsedAt1) = (top.owner, _charge(top, lapse, e), uint40(lapse));
                delete top;
            }
        }
        if (top.owner != address(0)) _charge(top, nowTs, e);
        return (top, next, e);
    }

    /// @dev Charges rent from top.since to `until` (at most the lapse time), moves since to `until`, and returns
    /// the deposit left.
    function _charge(Lease memory top, uint256 until, Effects memory e) internal pure returns (uint256 left) {
        uint256 rent = uint256(top.rent) * (until - top.since);
        // until never passes the lapse time, so rent <= deposit and the subtraction cannot underflow; deposit is
        // below 2^128, so the narrowing is exact.
        unchecked {
            left = top.deposit - rent;
            e.charged += rent;
        }
        top.deposit = uint128(left);
        top.since = uint40(until);
    }

    function _lapseAt(Lease memory top) internal pure returns (uint256) {
        return uint256(top.since) + top.deposit / top.rent;
    }

    /// @dev max(minRent, ceil(max(top, next) * (1 + minIncrement))); minRent alone when nothing stands.
    function _minNextRent(Terms memory t, uint128 topRent, uint128 nextRent) internal pure returns (uint128) {
        uint256 base = topRent > nextRent ? topRent : nextRent;
        if (base == 0) return t.minRent;
        uint256 raised = (base * (BPS + t.minIncrementBps) + BPS - 1) / BPS;
        if (raised > type(uint128).max) raised = type(uint128).max;
        return raised > t.minRent ? uint128(raised) : t.minRent;
    }

    function _lock() internal {
        if (TransientLib.locked()) revert Touchstone__Reentrant();
        TransientLib.setLock(true);
    }

    function _registered(PoolId id) internal view returns (Terms memory t) {
        t = _terms[id];
        if (t.quote == address(0)) revert Touchstone__PoolNotRegistered(id);
    }

    function _owned(PoolId id, bool isTop) internal view returns (Lease storage l) {
        l = isTop ? _top[id] : _next[id];
        if (l.owner != msg.sender) revert Touchstone__NotLeaseOwner();
    }

    function _credit(address owner, address quote, uint256 amount) internal {
        _refunds[owner][Currency.wrap(quote)] += amount;
        emit RefundCredited(owner, Currency.wrap(quote), amount);
    }

    /// @dev Pulls exactly `amount`; a fee-on-transfer token would leave deposits larger than the balance (I12).
    function _pull(address quote, uint256 amount) internal {
        uint256 before = IERC20(quote).balanceOf(address(this));
        IERC20(quote).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(quote).balanceOf(address(this)) - before;
        if (received != amount) revert Touchstone__TransferShortfall(amount, received);
    }
}
