// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IMarketCalendar} from "./interfaces/IMarketCalendar.sol";
import {ITouchstoneFactory} from "./interfaces/ITouchstoneFactory.sol";
import {ITouchstoneHook} from "./interfaces/ITouchstoneHook.sol";
import {ILicenceAuction} from "./interfaces/ILicenceAuction.sol";
import {ITouchstoneErrors} from "./interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "./interfaces/ITouchstoneEvents.sol";
import {PoolConfig, PoolFlags} from "./types/PoolConfig.sol";

/// @title TouchstoneFactory
/// @notice Validates a pool's config against the bounds of spec §14, registers it with the hook,
/// keeps the canonical copy that the Settler and off-chain services read, and initializes the pool.
/// @dev Pools cannot be initialized any other way: the hook's beforeInitialize accepts only the
/// factory. Nothing here can be changed after deployment.
contract TouchstoneFactory is ITouchstoneFactory, ITouchstoneErrors, ITouchstoneEvents {
    using PoolFlags for uint8;
    using LPFeeLibrary for uint24;

    // Field codes reported by Touchstone__ConfigOutOfBounds, in PoolConfig order.
    uint8 internal constant F_N0 = 0;
    uint8 internal constant F_N_MIN = 1;
    uint8 internal constant F_FLOW_HORIZON = 2;
    uint8 internal constant F_FLAGS = 3;
    uint8 internal constant F_TAU = 4;
    uint8 internal constant F_REFERENCE_MAX_AGE = 5;
    uint8 internal constant F_DELTA = 6;
    uint8 internal constant F_DELTA_MAX = 7;
    uint8 internal constant F_BETA = 8;
    uint8 internal constant F_CALENDAR = 9;
    uint8 internal constant F_DELTA_CLOSED = 10;
    uint8 internal constant F_MAX_CONF = 11;
    uint8 internal constant F_BAND = 12;
    uint8 internal constant F_PRICE_IDS = 13;
    uint8 internal constant F_SETTLE_DELAY = 14;
    uint8 internal constant F_MAX_LAG = 15;
    uint8 internal constant F_WINDOW = 16;
    uint8 internal constant F_OPEN_DELAY = 17;
    uint8 internal constant F_MAX_LAG_CLOSED = 18;
    uint8 internal constant F_WINDOW_CLOSED = 19;
    uint8 internal constant F_ALPHA = 20;
    uint8 internal constant F_EPS = 21;
    uint8 internal constant F_ALPHA_LICENSED = 22;
    uint8 internal constant F_ALPHA_CLOSED = 23;
    uint8 internal constant F_EPS_CLOSED = 24;
    uint8 internal constant F_JUMP_REFUND = 25;
    uint8 internal constant F_TIP = 26;
    uint8 internal constant F_RHO = 27;
    uint8 internal constant F_KAPPA = 28;
    uint8 internal constant F_VEST_PERIOD = 29;
    uint8 internal constant F_TIP_CAP = 30;
    uint8 internal constant F_MAX_OUTSTANDING = 31;
    uint8 internal constant F_PROTOCOL = 32;
    uint8 internal constant F_HOOKS = 33;
    uint8 internal constant F_REFERENCE = 34;
    uint8 internal constant F_LEASE_K = 35;
    uint8 internal constant F_MIN_INCREMENT = 36;
    uint8 internal constant F_MIN_RENT = 37;

    // Bounds of spec §14, in the field's own units (bps, seconds, beta x 100).
    uint32 internal constant FLOW_HORIZON_MIN = 1;
    uint32 internal constant FLOW_HORIZON_MAX = 3_600;
    uint16 internal constant TAU_MIN = 1;
    uint16 internal constant TAU_MAX = 100;
    uint32 internal constant REFERENCE_MAX_AGE_MIN = 60;
    uint32 internal constant REFERENCE_MAX_AGE_MAX = 90_000;
    uint16 internal constant DELTA_MIN = 5;
    uint16 internal constant DELTA_MAX = 500;
    uint16 internal constant DELTA_CAP_MAX = 2_000;
    uint16 internal constant BETA_MIN = 100;
    uint16 internal constant BETA_MAX = 400;
    uint16 internal constant BAND_MIN = 5;
    uint16 internal constant BAND_MAX = 500;
    uint32 internal constant SETTLE_DELAY_MIN = 1;
    uint32 internal constant SETTLE_DELAY_MAX = 60;
    uint32 internal constant MAX_LAG_MIN = 1;
    uint32 internal constant WINDOW_MIN = 1 hours;
    uint32 internal constant WINDOW_MAX = 7 days;
    uint32 internal constant OPEN_DELAY_MAX = 3_600;
    uint32 internal constant MAX_LAG_CLOSED_MIN = 60;
    uint16 internal constant MAX_CONF_MIN = 1;
    uint16 internal constant MAX_CONF_MAX = 200;
    uint16 internal constant ALPHA_MIN = 1_000;
    uint16 internal constant ALPHA_MAX = 9_500;
    uint16 internal constant ALPHA_LICENSED_MAX = 9_900;
    uint16 internal constant EPS_MAX = 50;
    uint16 internal constant EPS_CLOSED_MAX = 500;
    uint16 internal constant JUMP_REFUND_MIN = 500;
    uint16 internal constant JUMP_REFUND_MAX = 9_000;
    uint16 internal constant TIP_MAX = 2_000;
    uint16 internal constant RHO_MAX = 3_000;
    uint16 internal constant KAPPA_MAX = 9_000;
    uint32 internal constant VEST_PERIOD_MIN = 60;
    uint32 internal constant VEST_PERIOD_MAX = 1 days;
    uint16 internal constant PROTOCOL_SHARE_MAX = 5_000;
    uint32 internal constant LEASE_K_MIN = 60;
    uint32 internal constant LEASE_K_MAX = 7 days;
    uint16 internal constant MIN_INCREMENT_MIN = 100;
    uint16 internal constant MIN_INCREMENT_MAX = 5_000;
    uint8 internal constant NATIVE_DECIMALS = 18;
    uint256 internal constant CALENDAR_MIN_RUNWAY = 30 days;
    /// @dev The shortest regular session: an NYSE early close, 09:30 to 13:00.
    uint256 internal constant SHORTEST_SESSION = 3 hours + 30 minutes;
    uint8 internal constant KNOWN_FLAGS =
        PoolFlags.QUOTE_IS_0 | PoolFlags.LICENCE | PoolFlags.ITM_ACCOUNTING | PoolFlags.CALENDAR;

    IPoolManager public immutable POOL_MANAGER;
    ITouchstoneHook public immutable HOOK;
    ILicenceAuction public immutable LICENCE;

    mapping(PoolId => PoolConfig) internal _config;

    /// @param manager The v4 PoolManager.
    /// @param hook The TouchstoneHook.
    /// @param licence The LicenceAuction; zero on a deployment without licence pools.
    constructor(IPoolManager manager, ITouchstoneHook hook, ILicenceAuction licence) {
        POOL_MANAGER = manager;
        HOOK = hook;
        LICENCE = licence;
    }

    /// @inheritdoc ITouchstoneFactory
    function createPool(
        PoolKey calldata key,
        PoolConfig calldata cfg,
        ILicenceAuction.LeaseParams calldata lease,
        uint160 sqrtPriceX96
    ) external returns (PoolId id) {
        id = key.toId();
        if (address(key.hooks) != address(HOOK)) revert Touchstone__ConfigOutOfBounds(F_HOOKS);
        if (key.fee.isDynamicFee()) revert Touchstone__DynamicFeeNotSupported();
        bool licensed = cfg.flags.has(PoolFlags.LICENCE);
        if (licensed) _validateLease(key, cfg, lease, id);

        PoolConfig memory c = cfg;
        c.decimals0 = _decimals(key.currency0);
        c.decimals1 = _decimals(key.currency1);
        c.calendarValidUntil = _calendarValidUntil(c);
        c.flags = c.calendar == address(0) ? c.flags & ~PoolFlags.CALENDAR : c.flags | PoolFlags.CALENDAR;
        // A feed without code would read as absent on every swap; reject it here rather than run a pool
        // whose drift trigger can never fire (audit GEN-3).
        _check(c.referenceFeed == address(0) || c.referenceFeed.code.length != 0, F_REFERENCE);
        _validate(c);

        _config[id] = c;
        HOOK.register(key, c);
        if (licensed) LICENCE.register(key, lease);
        POOL_MANAGER.initialize(key, sqrtPriceX96);
        emit PoolRegistered(id, c);
    }

    /// @inheritdoc ITouchstoneFactory
    function poolConfig(PoolId id) external view returns (PoolConfig memory) {
        return _config[id];
    }

    /// @dev Spec §14 bounds and §14.5 cross-field rules; the calendar rules are in _calendarValidUntil.
    function _validate(PoolConfig memory c) internal pure {
        _check(c.n0 > 0, F_N0);
        _check(c.nMin >= c.n0, F_N_MIN);
        _check(c.flowHorizon >= FLOW_HORIZON_MIN && c.flowHorizon <= FLOW_HORIZON_MAX, F_FLOW_HORIZON);
        _check(c.flags & ~KNOWN_FLAGS == 0, F_FLAGS);
        _check(c.tauBps >= TAU_MIN && c.tauBps <= TAU_MAX, F_TAU);
        _check(
            c.referenceFeed == address(0)
                || (c.referenceMaxAge >= REFERENCE_MAX_AGE_MIN && c.referenceMaxAge <= REFERENCE_MAX_AGE_MAX),
            F_REFERENCE_MAX_AGE
        );
        _check(c.deltaBps >= DELTA_MIN && c.deltaBps <= DELTA_MAX, F_DELTA);
        _check(c.deltaMaxBps >= c.deltaBps && c.deltaMaxBps <= DELTA_CAP_MAX, F_DELTA_MAX);
        _check(c.betaX100 >= BETA_MIN && c.betaX100 <= BETA_MAX, F_BETA);
        _check(c.deltaClosedBps >= c.deltaBps && c.deltaClosedBps <= DELTA_CAP_MAX, F_DELTA_CLOSED);
        _check(c.maxConfBps >= MAX_CONF_MIN && c.maxConfBps <= MAX_CONF_MAX, F_MAX_CONF);
        _check(c.bandBps >= BAND_MIN && c.bandBps <= BAND_MAX, F_BAND);
        _check(
            c.basePriceId != bytes32(0) && c.quotePriceId != bytes32(0) && c.basePriceId != c.quotePriceId, F_PRICE_IDS
        );
        _validateSettlement(c);
        _validatePayouts(c);
    }

    function _validateSettlement(PoolConfig memory c) internal pure {
        _check(c.settleDelay >= SETTLE_DELAY_MIN && c.settleDelay <= SETTLE_DELAY_MAX, F_SETTLE_DELAY);
        _check(c.window >= WINDOW_MIN && c.window <= WINDOW_MAX, F_WINDOW);
        _check(c.maxLag >= MAX_LAG_MIN && c.maxLag < c.window, F_MAX_LAG);
        _check(c.openDelay <= OPEN_DELAY_MAX, F_OPEN_DELAY);
        _check(c.windowClosed >= WINDOW_MIN && c.windowClosed <= WINDOW_MAX, F_WINDOW_CLOSED);
        _check(c.maxLagClosed >= MAX_LAG_CLOSED_MIN && c.maxLagClosed < c.windowClosed, F_MAX_LAG_CLOSED);
        _check(c.alphaBps >= ALPHA_MIN && c.alphaBps <= ALPHA_MAX, F_ALPHA);
        _check(c.epsBps <= EPS_MAX, F_EPS);
        _check(c.alphaLicensedBps >= c.alphaBps && c.alphaLicensedBps <= ALPHA_LICENSED_MAX, F_ALPHA_LICENSED);
        _check(c.alphaClosedBps >= ALPHA_MIN && c.alphaClosedBps <= c.alphaBps, F_ALPHA_CLOSED);
        _check(c.epsClosedBps >= c.epsBps && c.epsClosedBps <= EPS_CLOSED_MAX, F_EPS_CLOSED);
        _check(c.jumpRefundBps >= JUMP_REFUND_MIN && c.jumpRefundBps <= JUMP_REFUND_MAX, F_JUMP_REFUND);
    }

    function _validatePayouts(PoolConfig memory c) internal pure {
        _check(c.tipBps <= TIP_MAX, F_TIP);
        _check(c.tipCap > 0, F_TIP_CAP);
        _check(c.rhoBps <= RHO_MAX, F_RHO);
        _check(c.kappaBps <= KAPPA_MAX, F_KAPPA);
        _check(c.vestPeriod >= VEST_PERIOD_MIN && c.vestPeriod <= VEST_PERIOD_MAX, F_VEST_PERIOD);
        _check(c.maxOutstanding > 0, F_MAX_OUTSTANDING);
        _check(
            c.protocolShareBps <= PROTOCOL_SHARE_MAX && (c.protocolShareBps == 0 || c.protocolRecipient != address(0)),
            F_PROTOCOL
        );
    }

    /// @dev Spec §9.1 and §14.5: the calendar's data must run at least 30 days past creation, and a continuous
    /// settlement (Delta + maxLag) must fit inside the shortest session, so the last-seconds rule of §9.2 can
    /// send late swaps to the reopen. The date is copied into the config; crypto pools carry zero.
    function _calendarValidUntil(PoolConfig memory c) internal view returns (uint40) {
        if (c.calendar == address(0)) return 0;
        _check(c.calendar.code.length != 0, F_CALENDAR);
        uint256 until = IMarketCalendar(c.calendar).validUntil();
        _check(until >= block.timestamp + CALENDAR_MIN_RUNWAY && until <= type(uint40).max, F_CALENDAR);
        _check(uint256(c.settleDelay) + c.maxLag < SHORTEST_SESSION, F_CALENDAR);
        return uint40(until);
    }

    /// @dev Spec §14 licence bounds. Rent is paid in the quote token, which must be an ERC-20, and the deployment
    /// must include an auction.
    function _validateLease(
        PoolKey calldata key,
        PoolConfig calldata cfg,
        ILicenceAuction.LeaseParams calldata lease,
        PoolId id
    ) internal view {
        if (address(LICENCE) == address(0)) {
            revert Touchstone__LicenceDisabled(id);
        }
        Currency quote = cfg.flags.has(PoolFlags.QUOTE_IS_0) ? key.currency0 : key.currency1;
        if (quote.isAddressZero()) revert Touchstone__QuoteNotErc20();
        _check(lease.k >= LEASE_K_MIN && lease.k <= LEASE_K_MAX, F_LEASE_K);
        _check(
            lease.minIncrementBps >= MIN_INCREMENT_MIN && lease.minIncrementBps <= MIN_INCREMENT_MAX, F_MIN_INCREMENT
        );
        _check(lease.minRent > 0, F_MIN_RENT);
    }

    function _check(bool ok, uint8 field) internal pure {
        if (!ok) revert Touchstone__ConfigOutOfBounds(field);
    }

    function _decimals(Currency currency) internal view returns (uint8) {
        if (currency.isAddressZero()) return NATIVE_DECIMALS;
        return IERC20Metadata(Currency.unwrap(currency)).decimals();
    }
}
