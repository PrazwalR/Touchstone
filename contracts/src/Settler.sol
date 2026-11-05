// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {ISettler} from "./interfaces/ISettler.sol";
import {ITouchstoneHook} from "./interfaces/ITouchstoneHook.sol";
import {ITouchstoneErrors} from "./interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "./interfaces/ITouchstoneEvents.sol";
import {IMarketCalendar} from "./interfaces/IMarketCalendar.sol";
import {PoolConfig, PoolFlags} from "./types/PoolConfig.sol";
import {PoolState} from "./types/PoolState.sol";
import {Record} from "./types/Record.sol";
import {Payout} from "./types/Payout.sol";
import {PriceLib} from "./libraries/PriceLib.sol";
import {SettlementMath} from "./libraries/SettlementMath.sol";
import {ItmLib} from "./libraries/ItmLib.sol";
import {RecordLib} from "./libraries/RecordLib.sol";
import {DepositLib} from "./libraries/DepositLib.sol";

/// @notice The factory's config registry, as the Settler reads it.
interface IConfigRegistry {
    /// @notice A pool's config.
    function poolConfig(PoolId id) external view returns (PoolConfig memory);
}

/// @title Settler
/// @notice Turns an open record and a signed Pyth update into a split, and tells the hook to pay it.
/// @dev Anyone may call. The Settler holds no funds and keeps no state beyond its immutables; the
/// hook re-checks every payout for conservation. Pyth's parsePriceFeedUpdatesUnique accepts only
/// the first update at or after t0, so no caller can choose the settlement price (T1).
contract Settler is ISettler, ITouchstoneErrors, ITouchstoneEvents {
    using PoolFlags for uint8;

    /// @dev Everything a settlement computes, gathered to keep each function within the stack limit.
    struct Quote {
        uint256 priceX36;
        uint256 confBps;
        int256 markout;
        uint16 alpha;
    }

    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;

    IPyth public immutable PYTH;
    ITouchstoneHook public immutable HOOK;
    IConfigRegistry public immutable FACTORY;

    /// @param pyth The Pyth contract on this chain.
    /// @param hook The TouchstoneHook.
    /// @param factory The TouchstoneFactory, which holds every pool's config.
    constructor(IPyth pyth, ITouchstoneHook hook, address factory) {
        PYTH = pyth;
        HOOK = hook;
        FACTORY = IConfigRegistry(factory);
    }

    /// @inheritdoc ISettler
    function settle(Record calldata record, bytes[] calldata pythUpdate)
        external
        payable
        returns (Payout memory payout)
    {
        _checkOpen(record);
        PoolConfig memory cfg = FACTORY.poolConfig(record.poolId);
        (uint256 t0, uint256 latest,) = _settleTime(record, cfg);
        if (block.timestamp < t0) revert Touchstone__TooEarly(t0);

        uint256 fee = PYTH.getUpdateFee(pythUpdate);
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = cfg.basePriceId;
        ids[1] = cfg.quotePriceId;
        PythStructs.PriceFeed[] memory feeds =
            PYTH.parsePriceFeedUpdatesUnique{value: fee}(pythUpdate, ids, uint64(t0), uint64(latest));

        Quote memory q;
        (payout, q) = _payout(record, cfg, feeds[0].price, feeds[1].price);
        HOOK.finalize(record, payout, false);
        emit Settled(record.poolId, record.id, q.markout, q.priceX36, q.alpha, payout);

        if (msg.value > fee) {
            (bool ok,) = msg.sender.call{value: msg.value - fee}("");
            if (!ok) revert Touchstone__FeeRefundFailed();
        }
    }

    /// @inheritdoc ISettler
    function expire(Record calldata record) external {
        _checkOpen(record);
        PoolConfig memory cfg = FACTORY.poolConfig(record.poolId);
        (,, uint256 expiresAt) = _settleTime(record, cfg);
        if (block.timestamp < expiresAt) revert Touchstone__NotExpired(expiresAt);
        HOOK.finalize(record, _fullRefund(record), true);
        emit Expired(record.poolId, record.id, record.deposit);
    }

    /// @inheritdoc ISettler
    function settleTime(Record calldata record) external view returns (uint256 t0, uint256 latest, uint256 expiresAt) {
        return _settleTime(record, FACTORY.poolConfig(record.poolId));
    }

    function _checkOpen(Record calldata record) internal view {
        if (HOOK.recordHash(record.poolId, record.id) != RecordLib.hash(record)) {
            revert Touchstone__RecordClosed(record.poolId, record.id);
        }
    }

    /// @dev Continuous records settle at t + delay; closure records at the next regular open plus
    /// openDelay. Expiry counts from t0, so the closure itself never eats into the window.
    function _settleTime(Record calldata record, PoolConfig memory cfg)
        internal
        view
        returns (uint256 t0, uint256 latest, uint256 expiresAt)
    {
        if (record.mode == DepositLib.MODE_CLOSED) {
            t0 = IMarketCalendar(cfg.calendar).nextOpen(record.timestamp) + cfg.openDelay;
            return (t0, t0 + cfg.maxLagClosed, t0 + cfg.windowClosed);
        }
        t0 = uint256(record.timestamp) + cfg.settleDelay;
        return (t0, t0 + cfg.maxLag, t0 + cfg.window);
    }

    /// @dev Spec §8.7: fair price, confidence, guards, markout, regime, clawback, then split or rebate.
    function _payout(
        Record calldata record,
        PoolConfig memory cfg,
        PythStructs.Price memory base,
        PythStructs.Price memory quote
    ) internal view returns (Payout memory payout, Quote memory q) {
        bool quoteIs0 = cfg.flags.has(PoolFlags.QUOTE_IS_0);
        (uint8 decRisky, uint8 decQuote) = quoteIs0 ? (cfg.decimals1, cfg.decimals0) : (cfg.decimals0, cfg.decimals1);
        q.priceX36 = PriceLib.fairPriceX36(base.price, base.expo, quote.price, quote.expo, decRisky, decQuote);
        q.confBps = PriceLib.confBpsUp(base.price, base.conf, quote.price, quote.conf);
        (int256 xRisky, int256 xQuote) = RecordLib.receipts(record, quoteIs0);
        q.markout = SettlementMath.markout(xRisky, xQuote, q.priceX36);

        if (q.confBps > cfg.maxConfBps || _jumped(record, cfg, q.priceX36, xRisky, xQuote)) {
            return (_fullRefund(record), q);
        }

        bool closed = record.mode == DepositLib.MODE_CLOSED;
        q.alpha = SettlementMath.alphaBps(
            record.mode,
            record.licenceActive,
            record.byHolder,
            record.licenceActive && _inBand(record, cfg, q.priceX36, quoteIs0),
            cfg.alphaBps,
            cfg.alphaLicensedBps,
            cfg.alphaClosedBps
        );
        (int256 mPlus, uint256 nPlus) = _inTheMoney(record, cfg, q.priceX36, xRisky, xQuote);
        bool depositIsQuote = RecordLib.depositIsQuote(record, quoteIs0);
        uint256 depositQuote =
            depositIsQuote ? record.deposit : FullMath.mulDiv(record.deposit, q.priceX36, PRICE_SCALE);
        uint256 retainedQuote = SettlementMath.clawback(
            depositQuote, mPlus, nPlus, closed ? cfg.epsClosedBps : cfg.epsBps, q.confBps, q.alpha
        );

        if (retainedQuote == 0 && q.markout <= 0) {
            return (_benign(record, cfg, q.priceX36, depositIsQuote, RecordLib.notional(record, quoteIs0)), q);
        }
        // retainedQuote <= depositQuote = floor(D * P / 1e36), so converting back rounds to at most D.
        uint256 retained = depositIsQuote ? retainedQuote : FullMath.mulDiv(retainedQuote, PRICE_SCALE, q.priceX36);
        payout = SettlementMath.splitRetained(
            record.deposit,
            uint128(retained),
            SettlementMath.SplitParams({
                tipBps: cfg.tipBps,
                tipCap: _toDepositCurrency(cfg.tipCap, depositIsQuote, q.priceX36),
                protocolShareBps: cfg.protocolShareBps,
                rhoBps: cfg.rhoBps
            }),
            msg.sender
        );
    }

    /// @dev Spec §10 band test, |p_pre - P*| <= G * P*, on the record's pre-swap pool price. Rounding the ratio up
    /// makes the comparison exact, so a record on the boundary is inside.
    function _inBand(Record calldata record, PoolConfig memory cfg, uint256 priceX36, bool quoteIs0)
        internal
        pure
        returns (bool)
    {
        uint256 poolX36 = PriceLib.poolPriceX36(record.sqrtPriceBeforeX96, !quoteIs0);
        uint256 diff = poolX36 > priceX36 ? poolX36 - priceX36 : priceX36 - poolX36;
        return FullMath.mulDivRoundingUp(diff, BPS, priceX36) <= cfg.bandBps;
    }

    /// @dev Reconstruct only an overshooting leg; otherwise the actual receipts already give m+ and N+.
    function _inTheMoney(Record calldata record, PoolConfig memory cfg, uint256 priceX36, int256 xRisky, int256 xQuote)
        internal
        pure
        returns (int256 mPlus, uint256 nPlus)
    {
        bool quoteIs0 = cfg.flags.has(PoolFlags.QUOTE_IS_0);
        if (!cfg.flags.has(PoolFlags.ITM_ACCOUNTING)) {
            return (SettlementMath.markout(xRisky, xQuote, priceX36), RecordLib.notional(record, quoteIs0));
        }
        (int256 a0, int256 a1, bool overshot) = ItmLib.leg(
            record.zeroForOne,
            record.sqrtPriceBeforeX96,
            record.sqrtPriceAfterX96,
            PriceLib.sqrtPriceX96At(priceX36, !quoteIs0),
            record.liquidityBefore,
            record.swapFeePips
        );
        if (!overshot) {
            return (SettlementMath.markout(xRisky, xQuote, priceX36), RecordLib.notional(record, quoteIs0));
        }
        (int256 legRisky, int256 legQuote) = quoteIs0 ? (a1, a0) : (a0, a1);
        mPlus = SettlementMath.markout(legRisky, legQuote, priceX36);
        nPlus = legQuote >= 0 ? uint256(legQuote) : uint256(-legQuote);
    }

    /// @dev Closure records refund in full when |P* / p_exec - 1| exceeds J: a corporate action, a
    /// halt or a data error, not information (§9.4).
    function _jumped(Record calldata record, PoolConfig memory cfg, uint256 priceX36, int256 xRisky, int256 xQuote)
        internal
        pure
        returns (bool)
    {
        if (record.mode != DepositLib.MODE_CLOSED) return false;
        uint256 r = xRisky >= 0 ? uint256(xRisky) : uint256(-xRisky);
        uint256 qAbs = xQuote >= 0 ? uint256(xQuote) : uint256(-xQuote);
        if (r == 0 || qAbs == 0) return true;
        uint256 execX36 = FullMath.mulDiv(qAbs, PRICE_SCALE, r);
        uint256 diff = priceX36 > execX36 ? priceX36 - execX36 : execX36 - priceX36;
        return FullMath.mulDiv(diff, BPS, execX36) > cfg.jumpRefundBps;
    }

    /// @dev Benign record: full refund plus min(kappa * f * N, rebate pool), the tip taken from it.
    function _benign(
        Record calldata record,
        PoolConfig memory cfg,
        uint256 priceX36,
        bool depositIsQuote,
        uint256 notionalQuote
    ) internal view returns (Payout memory) {
        PoolState memory st = HOOK.poolState(record.poolId);
        PoolKey memory key = HOOK.poolKey(record.poolId);
        uint256 notional = depositIsQuote ? notionalQuote : FullMath.mulDiv(notionalQuote, PRICE_SCALE, priceX36);
        return SettlementMath.benign(
            record.deposit,
            notional,
            key.fee,
            cfg.kappaBps,
            record.depositIn0 ? st.rebatePool0 : st.rebatePool1,
            cfg.tipBps,
            _toDepositCurrency(cfg.tipCap, depositIsQuote, priceX36),
            msg.sender
        );
    }

    function _fullRefund(Record calldata record) internal view returns (Payout memory payout) {
        payout.refund = record.deposit;
        payout.tipTo = msg.sender;
    }

    /// @dev Quote units to the deposit currency at P*, rounded down, capped at uint128.
    function _toDepositCurrency(uint128 amountQuote, bool depositIsQuote, uint256 priceX36)
        internal
        pure
        returns (uint128)
    {
        if (depositIsQuote) return amountQuote;
        uint256 converted = FullMath.mulDiv(amountQuote, PRICE_SCALE, priceX36);
        return converted > type(uint128).max ? type(uint128).max : uint128(converted);
    }
}
