// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IALFHook} from "../interfaces/IALFHook.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ILicenceAuction} from "../interfaces/ILicenceAuction.sol";
import {IMarketCalendar} from "../interfaces/IMarketCalendar.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";
import {ITouchstoneFactory} from "../interfaces/ITouchstoneFactory.sol";
import {ITouchstoneHook} from "../interfaces/ITouchstoneHook.sol";
import {ITouchstoneLens} from "../interfaces/ITouchstoneLens.sol";
import {BlockLib} from "../libraries/BlockLib.sol";
import {DepositLib} from "../libraries/DepositLib.sol";
import {FlowBucketLib} from "../libraries/FlowBucketLib.sol";
import {PriceLib} from "../libraries/PriceLib.sol";
import {ReferenceLib} from "../libraries/ReferenceLib.sol";
import {StaticQuoteLib} from "../libraries/StaticQuoteLib.sol";
import {TriggerLib} from "../libraries/TriggerLib.sol";
import {DepositQuote} from "../types/DepositQuote.sol";
import {PoolConfig, PoolFlags} from "../types/PoolConfig.sol";
import {PoolState} from "../types/PoolState.sol";

/// @title TouchstoneLens
/// @notice The quotes behind the hook's previewDeposit and URC-4 forwarders (spec §12.1 and §12.2). The hook passes
/// the one value only it can see, whether this transaction has already touched the pool, and forwards the answer.
/// @dev Lives outside the hook to keep it under EIP-170 (decision 0057). The classification below repeats the hook's
/// swap path; QuoteIntegrity's fuzz tests hold the two equal in the same block, and Quote.t.sol holds the URC-4
/// quote equal to the executed swap. Every function is a view: nothing here can move funds.
contract TouchstoneLens is ITouchstoneLens, IALFHook, ITouchstoneErrors {
    using StateLibrary for IPoolManager;
    using PoolFlags for uint8;

    /// @dev One swap as the lens sees it; mirrors the hook's SwapView.
    struct View {
        PoolId id;
        bool quoteIs0;
        bool buysRisky;
        uint256 notional;
        uint256 riskyAbs;
        int256 gapBps;
        uint8 mode;
        uint160 pre; // the pool's price before the swap
        address swapper; // zero when unknown, which rules out the licence exemption
        bool touchedInTx;
    }

    /// @dev Matches the hook's sentinel for an unmeasured gap (decision 0056).
    int256 internal constant GAP_UNKNOWN = type(int256).min;

    IPoolManager public immutable POOL_MANAGER;
    ITouchstoneHook public immutable HOOK;
    ITouchstoneFactory public immutable FACTORY;
    uint16 public immutable MAX_QUOTE_TICKS;

    /// @param manager The v4 PoolManager.
    /// @param hook The TouchstoneHook that forwards to this lens.
    /// @param factory The TouchstoneFactory, which holds every pool's config.
    /// @param maxQuoteTicks Most initialized ticks a URC-4 quote may cross, and most empty bitmap words it may step
    /// across, before it reports "cannot price".
    constructor(IPoolManager manager, ITouchstoneHook hook, ITouchstoneFactory factory, uint16 maxQuoteTicks) {
        POOL_MANAGER = manager;
        HOOK = hook;
        FACTORY = factory;
        // A zero budget would make every quote that crosses a tick report "cannot price".
        if (maxQuoteTicks == 0) revert Touchstone__ZeroQuoteBudget();
        MAX_QUOTE_TICKS = maxQuoteTicks;
    }

    /// @inheritdoc ITouchstoneLens
    /// @param key The pool.
    /// @param zeroForOne Swap direction.
    /// @param notionalQuote The swap's quote-side amount.
    /// @param swapper The address the swap is attributed to, for the licence fast path.
    /// @param touchedInTx Whether this transaction has already made the block's first touch on the pool.
    /// @return q The deposit quote.
    function previewDeposit(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 notionalQuote,
        address swapper,
        bool touchedInTx
    ) external view returns (DepositQuote memory q) {
        View memory v;
        v.id = key.toId();
        PoolConfig memory cfg = _config(v.id);
        v.quoteIs0 = cfg.flags.has(PoolFlags.QUOTE_IS_0);
        v.buysRisky = zeroForOne == v.quoteIs0;
        v.notional = notionalQuote;
        (v.pre,,,) = POOL_MANAGER.getSlot0(v.id);
        v.swapper = swapper;
        v.touchedInTx = touchedInTx;
        // The cap's risky side converts at the pre-swap price, since only the swap knows its execution price
        // (decision 0051).
        if (notionalQuote != 0) {
            v.riskyAbs = FullMath.mulDiv(notionalQuote, PriceLib.PRICE_SCALE, PriceLib.poolPriceX36(v.pre, !v.quoteIs0));
        }
        q = _evaluate(cfg, HOOK.poolState(v.id), v);
    }

    /// @inheritdoc IALFHook
    /// @dev Exact input: the output less the deposit. Exact output: the input plus the deposit. Full price range.
    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, bytes calldata hookData)
        external
        view
        returns (uint256)
    {
        uint160 limit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        (uint256 amountIn, uint256 amountOut) = _quote(key, zeroForOne, amountSpecified, limit, hookData, _touched());
        return amountSpecified < 0 ? amountOut : amountIn;
    }

    /// @inheritdoc IALFHook
    function swapToPrice(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external view returns (uint256 amountIn, uint256 amountOut) {
        return _quote(key, zeroForOne, amountSpecified, sqrtPriceLimitX96, hookData, _touched());
    }

    /// @inheritdoc IALFHook
    /// @dev Execution never waits on an oracle; only settlement does.
    function isLive() external pure returns (bool) {
        return true;
    }

    /// @inheritdoc IALFHook
    /// @dev The measured fixed cost plus the measured cost of each unit of the tick budget (decision 0057).
    function maxGas() external view returns (uint32) {
        return StaticQuoteLib.QUOTE_BASE_GAS + uint32(MAX_QUOTE_TICKS) * StaticQuoteLib.QUOTE_GAS_PER_TICK;
    }

    /// @notice ERC-165, answered for the hook: it serves IALFHook through its fallback.
    /// @param interfaceId The interface id to test.
    /// @return True for IALFHook and IERC165.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IALFHook).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @dev The AMM amounts with the deposit this swap would post now; (0, 0) when it cannot price. The swapper is
    /// unknown, so the licence exemption never applies and a holder's quote is conservative.
    function _quote(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData,
        bool touchedInTx
    ) internal view returns (uint256 amountIn, uint256 amountOut) {
        _checkHookData(hookData);
        StaticQuoteLib.Quote memory amm = StaticQuoteLib.quote(
            POOL_MANAGER, key.toId(), key.tickSpacing, zeroForOne, amountSpecified, sqrtPriceLimitX96, MAX_QUOTE_TICKS
        );
        if (!amm.ok) return (0, 0);
        (int256 in_, int256 out) = zeroForOne ? (amm.amount0, amm.amount1) : (amm.amount1, amm.amount0);
        amountIn = uint256(-in_);
        amountOut = uint256(out);
        uint256 deposit = _depositFor(key, amm, amountSpecified < 0, zeroForOne, touchedInTx);
        if (deposit == 0) return (amountIn, amountOut);
        if (amountSpecified < 0) amountOut = amountOut > deposit ? amountOut - deposit : 0;
        else amountIn += deposit;
    }

    /// @dev The deposit the quoted swap would post now, in its unspecified currency: the output for exact input, the
    /// input for exact output. Converted from quote units at the quote's own execution price, as the hook does.
    function _depositFor(
        PoolKey calldata key,
        StaticQuoteLib.Quote memory amm,
        bool exactInput,
        bool zeroForOne,
        bool touchedInTx
    ) internal view returns (uint256) {
        View memory v;
        v.id = key.toId();
        PoolConfig memory cfg = _config(v.id);
        (v.pre,,,) = POOL_MANAGER.getSlot0(v.id);
        v.touchedInTx = touchedInTx;
        v.quoteIs0 = cfg.flags.has(PoolFlags.QUOTE_IS_0);
        (int256 xRisky, int256 xQuote) =
            v.quoteIs0 ? (int256(amm.amount1), int256(amm.amount0)) : (int256(amm.amount0), int256(amm.amount1));
        v.notional = xQuote >= 0 ? uint256(xQuote) : uint256(-xQuote);
        v.riskyAbs = xRisky >= 0 ? uint256(xRisky) : uint256(-xRisky);
        v.buysRisky = xRisky > 0;
        uint256 depositQuote = _evaluate(cfg, HOOK.poolState(v.id), v).depositNow;
        if (depositQuote == 0) return 0;
        bool depositIn0 = exactInput != zeroForOne;
        return depositIn0 == v.quoteIs0 ? depositQuote : DepositLib.toRisky(depositQuote, v.riskyAbs, v.notional);
    }

    /// @dev The hook's trigger and deposit evaluation, on the state the next swap in this block would see.
    function _evaluate(PoolConfig memory cfg, PoolState memory st, View memory v)
        internal
        view
        returns (DepositQuote memory q)
    {
        (bool known, bool closed) = _classify(cfg, v, v.pre);
        q.mode = v.mode;
        q.rateBps = uint16(_rate(cfg, v));
        q.depositIfFlagged = DepositLib.quoteAmount(v.notional, q.rateBps);
        (q.settleAfter, q.expiresAt) = _settlementTimes(cfg, closed);
        if (!known || v.notional == 0) return q;

        (,, bool flowHit) = FlowBucketLib.update(
            st.flowBuy,
            st.flowSell,
            st.flowTime,
            uint40(block.timestamp),
            cfg.nMin,
            cfg.flowHorizon,
            v.notional,
            v.buysRisky
        );
        bool large = v.notional >= cfg.n0;
        if (!large && !flowHit) return q;
        if (!closed && large && cfg.flags.has(PoolFlags.LICENCE) && v.swapper != address(0)) {
            q.exempt = _exempt(st, cfg, v, v.swapper);
            if (q.exempt) return q;
        }
        q.triggers = _triggers(cfg, st, v, flowHit, large, closed);
        if (q.triggers == 0) return q;
        if (v.riskyAbs == 0 || !_withinBudget(st, cfg, v, q.depositIfFlagged)) return q;
        q.flaggedNow = true;
        q.depositNow = q.depositIfFlagged;
    }

    function _triggers(PoolConfig memory cfg, PoolState memory st, View memory v, bool flowHit, bool large, bool closed)
        internal
        view
        returns (uint8)
    {
        (bool firstNow,) = TriggerLib.firstTouch(st.lastTouchBlock, BlockLib.number(HOOK.BLOCK_SOURCE()), v.touchedInTx);
        return TriggerLib.triggers(
            flowHit, large, !closed && large && firstNow, closed, TriggerLib.drift(v.gapBps, cfg.tauBps)
        );
    }

    function _config(PoolId id) internal view returns (PoolConfig memory cfg) {
        cfg = FACTORY.poolConfig(id);
        if (cfg.n0 == 0) revert Touchstone__PoolNotRegistered(id);
    }

    /// @dev The hook's _classify.
    function _classify(PoolConfig memory cfg, View memory v, uint160 pre)
        internal
        view
        returns (bool known, bool closed)
    {
        known = true;
        if (cfg.flags.has(PoolFlags.CALENDAR)) {
            (known, closed) = _closedNow(cfg);
            if (!known) return (false, false);
        }
        if (closed) v.mode = DepositLib.MODE_CLOSED;
        else v.gapBps = _gap(cfg, v, pre);
    }

    function _rate(PoolConfig memory cfg, View memory v) internal pure returns (uint256) {
        return DepositLib.rateBps(v.mode, v.gapBps, cfg.deltaBps, cfg.deltaMaxBps, cfg.betaX100, cfg.deltaClosedBps);
    }

    /// @dev The hook's _gap: GAP_UNKNOWN when the reference is absent, stale or unreadable.
    function _gap(PoolConfig memory cfg, View memory v, uint160 pre) internal view returns (int256) {
        address feed = cfg.referenceFeed;
        if (feed == address(0) || !ReferenceLib.sequencerUp(HOOK.SEQUENCER_FEED(), HOOK.SEQUENCER_GRACE())) {
            return GAP_UNKNOWN;
        }
        (uint8 decRisky, uint8 decQuote) = v.quoteIs0 ? (cfg.decimals1, cfg.decimals0) : (cfg.decimals0, cfg.decimals1);
        (bool ok, uint256 refX36) = ReferenceLib.readX36(feed, cfg.referenceMaxAge, decRisky, decQuote);
        if (!ok) return GAP_UNKNOWN;
        return PriceLib.signedGapBps(refX36, PriceLib.poolPriceX36(pre, !v.quoteIs0), v.buysRisky);
    }

    /// @dev The hook's _closedNow.
    function _closedNow(PoolConfig memory cfg) internal view returns (bool known, bool closed) {
        if (block.timestamp >= cfg.calendarValidUntil) return (false, false);
        (bool okNow, bool openNow) = _calendarOpen(cfg.calendar, block.timestamp);
        (bool okLater, bool openLater) = _calendarOpen(cfg.calendar, block.timestamp + cfg.settleDelay + cfg.maxLag);
        if (!okNow || !okLater) return (false, false);
        if (openNow && openLater) return (true, false);
        (bool okNext,) = _calendarNextOpen(cfg.calendar);
        return (okNext, okNext);
    }

    function _calendarNextOpen(address calendar) internal view returns (bool ok, uint256 next) {
        (bool success, bytes memory ret) =
            calendar.staticcall(abi.encodeCall(IMarketCalendar.nextOpen, (block.timestamp)));
        if (!success || ret.length < 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    function _calendarOpen(address calendar, uint256 t) internal view returns (bool ok, bool open) {
        (bool success, bytes memory ret) = calendar.staticcall(abi.encodeCall(IMarketCalendar.isOpen, (t)));
        if (!success || ret.length < 32) return (false, false);
        return (true, abi.decode(ret, (uint256)) != 0);
    }

    /// @dev The hook's _licence, for a named swapper.
    function _exempt(PoolState memory st, PoolConfig memory cfg, View memory v, address swapper)
        internal
        view
        returns (bool)
    {
        (bool success, bytes memory ret) = HOOK.LICENCE().staticcall(abi.encodeCall(ILicenceAuction.holderOf, (v.id)));
        if (!success || ret.length < 64) return false;
        (uint256 holderWord, uint256 liveWord) = abi.decode(ret, (uint256, uint256));
        address holder = address(uint160(holderWord));
        if (liveWord == 0 || holder == address(0) || swapper != holder) return false;
        if (st.lastTouchBlock >= BlockLib.number(HOOK.BLOCK_SOURCE()) || v.gapBps == GAP_UNKNOWN) return false;
        uint256 gap = v.gapBps >= 0 ? uint256(v.gapBps) : uint256(-v.gapBps);
        return gap <= cfg.bandBps;
    }

    /// @dev The hook's _withinBudget.
    function _withinBudget(PoolState memory st, PoolConfig memory cfg, View memory v, uint256 depositQuote)
        internal
        pure
        returns (bool)
    {
        (uint256 outQuote, uint256 outRisky) =
            v.quoteIs0 ? (st.outstanding0, st.outstanding1) : (st.outstanding1, st.outstanding0);
        uint256 budget = cfg.maxOutstanding;
        if (outQuote + depositQuote > budget) return false;
        if (outRisky == 0) return true;
        return outRisky <= FullMath.mulDiv(budget - outQuote - depositQuote, v.riskyAbs, v.notional);
    }

    /// @dev The hook's _settlementTimes.
    function _settlementTimes(PoolConfig memory cfg, bool closed) internal view returns (uint64 t0, uint64 expiresAt) {
        if (!closed) {
            t0 = uint64(block.timestamp + cfg.settleDelay);
            return (t0, t0 + cfg.window);
        }
        (, uint256 next) = _calendarNextOpen(cfg.calendar);
        t0 = uint64(next + cfg.openDelay);
        expiresAt = t0 + cfg.windowClosed;
    }

    /// @dev The hook's hookData rule: 0, 32 or 64 bytes, each word a clean address.
    function _checkHookData(bytes calldata hookData) internal pure {
        uint256 len = hookData.length;
        if (len != 0 && len != 32 && len != 64) revert IALFHook.MalformedHookData();
        if (len != 0 && uint256(bytes32(hookData[:32])) >> 160 != 0) revert IALFHook.MalformedHookData();
        if (len == 64 && uint256(bytes32(hookData[32:64])) >> 160 != 0) revert IALFHook.MalformedHookData();
    }

    /// @dev The hook's in-transaction flag, appended as the last calldata word by the hook's fallback. Trusted only
    /// from the hook; a direct caller gets false.
    function _touched() internal view returns (bool) {
        if (msg.sender != address(HOOK) || msg.data.length < 36) return false;
        return uint256(bytes32(msg.data[msg.data.length - 32:])) != 0;
    }
}
