// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {NyseCalendar} from "../../src/calendar/NyseCalendar.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {DepositLib} from "../../src/libraries/DepositLib.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {Payout} from "../../src/types/Payout.sol";
import {Record} from "../../src/types/Record.sol";
import {MockBrokenCalendar} from "../mocks/MockBrokenCalendar.sol";
import {MockNoNextOpenCalendar} from "../mocks/MockNoNextOpenCalendar.sol";
import {DepositQuote} from "../../src/types/DepositQuote.sol";
import {TriggerLib} from "../../src/libraries/TriggerLib.sol";
import {NyseData} from "../utils/NyseData.sol";
import {SettlementBase} from "./Settlement.t.sol";

/// @notice Closed-market mode (spec §9) on a pool that uses the real NYSE calendar for 2026 to 2028.
/// @dev Times are UTC. US daylight saving ends on Sunday 1 November 2026, so Saturday 31 October's records
/// settle at Monday 2 November's 09:30 EST open, 14:30 UTC (the M8 scenario).
contract ClosedMarketTest is SettlementBase {
    uint256 internal constant SAT_OCT_31 = 1_793_458_800; // 15:00 UTC, market closed
    uint256 internal constant MON_NOV_2_OPEN = 1_793_629_800; // 09:30 EST
    uint256 internal constant TUE_OCT_27_MIDDAY = 1_793_113_200; // 11:00 EDT, market open
    uint256 internal constant TUE_OCT_27_CLOSE = 1_793_131_200; // 16:00 EDT
    uint256 internal constant WED_OCT_28_OPEN = 1_793_194_200; // 09:30 EDT

    NyseCalendar internal cal;

    function setUp() public {
        cal = NyseData.deploy(vm);
        _setUp(18, 6);
    }

    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.calendar = address(cal);
    }

    function _settleClosure(Record memory r, int64 price8) internal returns (Payout memory p) {
        (uint256 t0,,) = settler.settleTime(r);
        vm.warp(t0);
        bytes[] memory u = _updateRaw(price8, uint64(t0), uint64(t0 - 1), 0);
        vm.prank(keeper, keeper);
        p = settler.settle(r, u);
    }

    function test_FactoryCopiesTheCalendarValidity() public view {
        assertEq(factory.poolConfig(id).calendarValidUntil, cal.validUntil());
    }

    function test_FactoryOwnsTheCalendarFlag() public {
        assertTrue(factory.poolConfig(id).flags & PoolFlags.CALENDAR != 0, "set on a calendar pool");
        PoolConfig memory c = super.defaultConfig();
        c.flags |= PoolFlags.CALENDAR;
        PoolKey memory k = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        assertEq(factory.poolConfig(k.toId()).flags & PoolFlags.CALENDAR, 0, "cleared on a crypto pool");
    }

    function test_WeekendLargeSwapIsAClosureRecordAtDeltaC() public {
        vm.warp(SAT_OCT_31);
        Record memory r = _flag(20_000, true, "");
        assertEq(r.mode, DepositLib.MODE_CLOSED);
        uint256 riskyAbs = uint256(int256(quoteIs0 ? r.amount1 : r.amount0));
        uint256 notional = uint256(-int256(quoteIs0 ? r.amount0 : r.amount1));
        uint256 dq = DepositLib.quoteAmount(notional, defaultConfig().deltaClosedBps);
        assertEq(r.deposit, DepositLib.toRisky(dq, riskyAbs, notional), "D = N * delta_c, at the execution price");
    }

    function test_WeekendSmallSwapIsNotFlagged() public {
        vm.warp(SAT_OCT_31);
        vm.recordLogs();
        _swap(trader, true, true, 1_000 * 10 ** decQuote, "");
        (, bool found) = _lastRecord();
        assertFalse(found, "below N0 and below the flow threshold");
    }

    function test_SessionSwapIsContinuous() public {
        vm.warp(TUE_OCT_27_MIDDAY);
        vm.roll(block.number + 1);
        assertEq(hook.previewDeposit(key, quoteIs0, 20_000 * 10 ** decQuote, trader).mode, DepositLib.MODE_CONTINUOUS);
        Record memory r = _flag(20_000, true, "");
        assertEq(r.mode, DepositLib.MODE_CONTINUOUS);
    }

    function test_LastSecondsOfTheSessionGoToTheReopen() public {
        vm.warp(TUE_OCT_27_CLOSE - 10);
        Record memory r = _flag(20_000, true, "");
        assertEq(r.mode, DepositLib.MODE_CLOSED, "t + delta + maxLag is after the close");
        (uint256 t0,,) = settler.settleTime(r);
        assertEq(t0, WED_OCT_28_OPEN + defaultConfig().openDelay);
    }

    function test_SaturdayRecordSettlesAtMondayOpenAfterDstEnds() public {
        vm.warp(SAT_OCT_31);
        Record memory r = _flag(20_000, true, "");
        PoolConfig memory c = defaultConfig();
        (uint256 t0, uint256 latest, uint256 expiresAt) = settler.settleTime(r);
        assertEq(t0, MON_NOV_2_OPEN + c.openDelay, "14:30 UTC, not 13:30");
        assertEq(latest, t0 + c.maxLagClosed);
        assertEq(expiresAt, t0 + c.windowClosed, "expiry counts from the reopen");

        // The reopen prices ETH-like risky 3% above the weekend pool: the buyer's markout is positive.
        Payout memory p = _settleClosure(r, 3_090e8);
        assertFalse(p.benign);
        assertGt(p.toLPs, 0, "closure regime retains part of the markout");
        assertEq(uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs, r.deposit);
    }

    function test_AnUpdateFromBeforeTheReopenCannotSettle() public {
        vm.warp(SAT_OCT_31);
        Record memory r = _flag(20_000, true, "");
        (uint256 t0,,) = settler.settleTime(r);
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_090e8, uint64(SAT_OCT_31 + 60), uint64(SAT_OCT_31), 0);
        vm.prank(keeper, keeper);
        vm.expectRevert();
        settler.settle(r, u);
    }

    function test_JumpGuardRefundsAClosureRecordInFull() public {
        vm.warp(SAT_OCT_31);
        Record memory r = _flag(20_000, true, "");
        Payout memory p = _settleClosure(r, 4_200e8); // 40% above execution: beyond J = 25%
        assertEq(p.refund, r.deposit);
        assertEq(uint256(p.tip) + p.toLPs + p.toRebatePool + p.toProtocol, 0);
    }

    function test_ClosureRecordExpiresOnlyAfterTheWindowFromTheReopen() public {
        vm.warp(SAT_OCT_31);
        Record memory r = _flag(20_000, true, "");
        (,, uint256 expiresAt) = settler.settleTime(r);
        vm.warp(expiresAt - 1);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__NotExpired.selector, expiresAt));
        settler.expire(r);
        vm.warp(expiresAt);
        settler.expire(r);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
    }

    function test_NoDepositsAfterTheCalendarRunsOut() public {
        vm.warp(cal.validUntil());
        vm.roll(block.number + 1);
        assertFalse(hook.previewDeposit(key, quoteIs0, 50_000 * 10 ** decQuote, trader).flaggedNow, "preview agrees");
        vm.recordLogs();
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        (, bool found) = _lastRecord();
        assertFalse(found, "past validUntil the pool takes no deposits, and the swap still goes through");
    }

    function test_BrokenCalendarPostsNoDepositAndNeverRevertsTheSwap() public {
        PoolConfig memory c = super.defaultConfig();
        c.calendar = address(new MockBrokenCalendar(block.timestamp + 365 days));
        PoolKey memory k = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        _addLiquidity(k, liquidity());
        key = k;
        id = k.toId();
        assertFalse(hook.previewDeposit(key, quoteIs0, 50_000 * 10 ** decQuote, trader).flaggedNow, "preview agrees");
        vm.recordLogs();
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        (, bool found) = _lastRecord();
        assertFalse(found);
    }

    /// @dev I10: a calendar that says closed but cannot give the next open would leave a closure record with no
    /// settlement time, so the swap posts no deposit.
    function test_CalendarWithoutNextOpenPostsNoDeposit() public {
        PoolConfig memory c = super.defaultConfig();
        c.calendar = address(new MockNoNextOpenCalendar(block.timestamp + 365 days));
        PoolKey memory k = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        _addLiquidity(k, liquidity());
        key = k;
        id = k.toId();
        vm.recordLogs();
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        (, bool found) = _lastRecord();
        assertFalse(found);
        assertFalse(hook.previewDeposit(key, quoteIs0, 50_000 * 10 ** decQuote, trader).flaggedNow);
    }

    function test_PreviewOfAWeekendSwapIsAClosureQuote() public {
        vm.warp(SAT_OCT_31);
        PoolConfig memory c = defaultConfig();
        DepositQuote memory q = hook.previewDeposit(key, quoteIs0, 20_000 * 10 ** decQuote, trader);
        assertTrue(q.flaggedNow);
        assertEq(q.mode, DepositLib.MODE_CLOSED);
        assertEq(q.rateBps, c.deltaClosedBps);
        assertTrue(q.triggers & TriggerLib.CLOSED != 0);
        assertEq(q.settleAfter, MON_NOV_2_OPEN + c.openDelay);
        assertEq(q.expiresAt, MON_NOV_2_OPEN + c.openDelay + c.windowClosed);
        Record memory r = _flag(20_000, true, "");
        (uint256 t0,, uint256 expiresAt) = settler.settleTime(r);
        assertEq(q.settleAfter, t0);
        assertEq(q.expiresAt, expiresAt);
    }

    function test_CalendarReportsItsData() public view {
        (uint32[] memory holidays, uint32[] memory early) = cal.calendarDays();
        assertEq(holidays.length, 29);
        assertEq(early.length, 5);
    }

    function test_FactoryRejectsCalendarsThatRunOutTooSoonOrHaveNoCode() public {
        PoolConfig memory c = super.defaultConfig();
        PoolKey memory k = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        c.calendar = address(new MockBrokenCalendar(block.timestamp + 29 days));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(9)));
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        c.calendar = makeAddr("no-code-calendar");
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(9)));
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
    }
}
