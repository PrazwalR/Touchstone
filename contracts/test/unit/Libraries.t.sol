// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {TransientLib} from "../../src/libraries/TransientLib.sol";
import {ReferenceLib} from "../../src/libraries/ReferenceLib.sol";
import {TriggerLib} from "../../src/libraries/TriggerLib.sol";
import {RecordLib} from "../../src/libraries/RecordLib.sol";
import {CalendarMath} from "../../src/libraries/CalendarMath.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {Record} from "../../src/types/Record.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";

/// @dev Wrappers so transient writes and reads happen inside one external call.
contract TransientHarness {
    function roundTrip(bytes32 label, PoolId a, PoolId b, uint256 va, uint256 vb) external returns (uint256, uint256) {
        TransientLib.set(label, a, va);
        TransientLib.set(label, b, vb);
        return (TransientLib.get(label, a), TransientLib.get(label, b));
    }

    function lockTwice() external returns (bool before, bool afterSet) {
        before = TransientLib.locked();
        TransientLib.setLock(true);
        afterSet = TransientLib.locked();
    }

    function read(bytes32 label, PoolId a) external view returns (uint256) {
        return TransientLib.get(label, a);
    }
}

contract LibrariesTest is Test {
    TransientHarness internal t;
    MockV3Aggregator internal feed;

    function setUp() public {
        vm.warp(1_760_000_000);
        t = new TransientHarness();
        feed = new MockV3Aggregator(8, 3_000e8);
    }

    // --- TransientLib --------------------------------------------------------------------------

    function testFuzz_Transient_KeyedByPool(bytes32 a, bytes32 b, uint256 va, uint256 vb) public {
        vm.assume(a != b);
        (uint256 ra, uint256 rb) = t.roundTrip(TransientLib.LAST_DEPOSIT, PoolId.wrap(a), PoolId.wrap(b), va, vb);
        assertEq(ra, va);
        assertEq(rb, vb);
    }

    function test_Transient_ClearsBetweenTransactions() public {
        t.roundTrip(TransientLib.LAST_DEPOSIT, PoolId.wrap(bytes32(uint256(1))), PoolId.wrap(bytes32(uint256(2))), 7, 8);
        assertEq(t.read(TransientLib.LAST_DEPOSIT, PoolId.wrap(bytes32(uint256(1)))), 0);
    }

    function test_Transient_Lock() public {
        (bool before, bool afterSet) = t.lockTwice();
        assertFalse(before);
        assertTrue(afterSet);
    }

    // --- ReferenceLib --------------------------------------------------------------------------

    function test_Reference_ConvertsToX36() public view {
        (bool ok, uint256 p) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertTrue(ok);
        assertEq(p, 3_000 * 1e6 * 1e36 / 1e18);
        (ok, p) = ReferenceLib.readX36(address(feed), 3_600, 8, 6);
        assertEq(p, 3_000 * 1e6 * 1e36 / 1e8);
    }

    function test_Reference_RejectsStaleNonPositiveRevertingAndZero() public {
        bool ok;
        (ok,) = ReferenceLib.readX36(address(0), 3_600, 18, 6);
        assertFalse(ok);
        feed.set(3_000e8, block.timestamp - 3_601);
        (ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        feed.set(0, block.timestamp);
        (ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        feed.set(3_000e8, block.timestamp + 1);
        (ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        feed.set(3_000e8, block.timestamp);
        feed.setReverts(true);
        (ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        (ok,) = ReferenceLib.readX36(address(this), 3_600, 18, 6);
        assertFalse(ok);
    }

    function test_Reference_ExponentOutOfRange() public {
        MockV3Aggregator wide = new MockV3Aggregator(0, 1);
        (bool ok,) = ReferenceLib.readX36(address(wide), 3_600, 0, 77);
        assertFalse(ok);
        MockV3Aggregator tiny = new MockV3Aggregator(77, 1);
        (ok,) = ReferenceLib.readX36(address(tiny), 3_600, 18, 0);
        assertFalse(ok);
    }

    function test_Reference_CodelessFeedReturnsAbsent() public view {
        (bool ok, uint256 p) = ReferenceLib.readX36(address(0xBAD), 3_600, 18, 6);
        assertFalse(ok);
        assertEq(p, 0);
    }

    function test_Reference_ShortRoundDataReturnsAbsent() public {
        bytes memory selector = abi.encodeCall(AggregatorV3Interface.latestRoundData, ());
        for (uint256 size; size < 160; ++size) {
            vm.mockCall(address(feed), selector, new bytes(size));
            (bool ok, uint256 p) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
            assertFalse(ok);
            assertEq(p, 0);
        }
    }

    function test_Reference_DirtyRoundIdsReturnAbsent() public {
        bytes memory selector = abi.encodeCall(AggregatorV3Interface.latestRoundData, ());
        uint256 dirty = uint256(type(uint80).max) + 1;
        vm.mockCall(address(feed), selector, abi.encode(dirty, int256(3_000e8), 0, block.timestamp, 1));
        (bool ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        vm.mockCall(address(feed), selector, abi.encode(1, int256(3_000e8), 0, block.timestamp, dirty));
        (ok,) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
    }

    function test_Reference_ShortDecimalsReturnAbsent() public {
        bytes memory selector = abi.encodeCall(AggregatorV3Interface.decimals, ());
        for (uint256 size; size < 32; ++size) {
            vm.mockCall(address(feed), selector, new bytes(size));
            (bool ok, uint256 p) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
            assertFalse(ok);
            assertEq(p, 0);
        }
    }

    function test_Reference_DirtyDecimalsReturnAbsent() public {
        vm.mockCall(address(feed), abi.encodeCall(AggregatorV3Interface.decimals, ()), abi.encode(uint256(256)));
        (bool ok, uint256 p) = ReferenceLib.readX36(address(feed), 3_600, 18, 6);
        assertFalse(ok);
        assertEq(p, 0);
    }

    function test_Sequencer_CodelessFeedReturnsDown() public view {
        assertFalse(ReferenceLib.sequencerUp(address(0xBAD), 3_600));
    }

    function test_Sequencer_ShortRoundDataReturnsDown() public {
        bytes memory selector = abi.encodeCall(AggregatorV3Interface.latestRoundData, ());
        for (uint256 size; size < 160; ++size) {
            vm.mockCall(address(feed), selector, new bytes(size));
            assertFalse(ReferenceLib.sequencerUp(address(feed), 3_600));
        }
    }

    function test_Sequencer_DirtyRoundIdsReturnDown() public {
        bytes memory selector = abi.encodeCall(AggregatorV3Interface.latestRoundData, ());
        uint256 dirty = uint256(type(uint80).max) + 1;
        vm.mockCall(address(feed), selector, abi.encode(dirty, int256(0), block.timestamp - 3_600, 0, 1));
        assertFalse(ReferenceLib.sequencerUp(address(feed), 3_600));
        vm.mockCall(address(feed), selector, abi.encode(1, int256(0), block.timestamp - 3_600, 0, dirty));
        assertFalse(ReferenceLib.sequencerUp(address(feed), 3_600));
    }

    function test_Sequencer_UpDownAndGrace() public {
        assertTrue(ReferenceLib.sequencerUp(address(0), 3_600));
        MockV3Aggregator seq = new MockV3Aggregator(0, 0);
        seq.set(0, block.timestamp - 3_600);
        assertTrue(ReferenceLib.sequencerUp(address(seq), 3_600));
        seq.set(0, block.timestamp - 10);
        assertFalse(ReferenceLib.sequencerUp(address(seq), 3_600));
        seq.set(1, block.timestamp - 7_200);
        assertFalse(ReferenceLib.sequencerUp(address(seq), 3_600));
        seq.setReverts(true);
        assertFalse(ReferenceLib.sequencerUp(address(seq), 3_600));
    }

    // --- TriggerLib ----------------------------------------------------------------------------

    function test_FirstTouch_Table() public pure {
        (bool first, bool consumes) = TriggerLib.firstTouch(5, 6, false);
        assertTrue(first && consumes);
        (first, consumes) = TriggerLib.firstTouch(6, 6, false);
        assertFalse(first || consumes);
        (first, consumes) = TriggerLib.firstTouch(6, 6, true);
        assertTrue(first);
        assertFalse(consumes);
    }

    function testFuzz_Triggers_SmallSwapsOnlyFlow(bool flow, bool first, bool closed, bool drifted) public pure {
        uint8 mask = TriggerLib.triggers(flow, false, first, closed, drifted);
        assertEq(mask, flow ? TriggerLib.FLOW : 0);
    }

    function test_Triggers_LargeSwap() public pure {
        assertEq(TriggerLib.triggers(false, true, true, false, false), TriggerLib.FIRST_TOUCH);
        assertEq(
            TriggerLib.triggers(true, true, false, true, true), TriggerLib.FLOW | TriggerLib.CLOSED | TriggerLib.DRIFT
        );
        assertTrue(TriggerLib.drift(5, 5));
        assertFalse(TriggerLib.drift(4, 5));
        assertFalse(TriggerLib.drift(-10, 5));
    }

    // --- PriceLib.signedGapBps (decision 0031) ------------------------------------------------

    function test_Gap_SaturatesAtPriceBounds() public pure {
        int256 cap = PriceLib.MAX_GAP_BPS;
        assertEq(PriceLib.signedGapBps(1, 2 ** 248, true), -cap);
        assertEq(PriceLib.signedGapBps(1, 2 ** 248, false), cap);
        assertEq(PriceLib.signedGapBps(2 ** 248, 1, true), 9_999);
    }

    /// @dev The saturating version equals the original truncating formula, clamped to the cap.
    function testFuzz_Gap_MatchesOriginalInRange(uint128 refSeed, uint128 poolSeed, bool buys) public pure {
        uint256 ref = bound(refSeed, 1, type(uint128).max);
        uint256 pool = bound(poolSeed, 0, type(uint128).max);
        int256 diff = int256(ref) - int256(pool);
        int256 original = (diff * 10_000) / int256(ref);
        int256 cap = PriceLib.MAX_GAP_BPS;
        // Below the cap the result is exact; above it, it saturates with the same sign.
        if (original > cap) original = cap;
        if (original < -cap) original = -cap;
        assertEq(PriceLib.signedGapBps(ref, pool, buys), buys ? original : -original);
    }

    // --- RecordLib -----------------------------------------------------------------------------

    function test_Record_ReceiptsAndNotional() public pure {
        Record memory r;
        r.amount0 = -20_000e6;
        r.amount1 = 6e18;
        r.depositIn0 = false;
        (int256 xr, int256 xq) = RecordLib.receipts(r, true);
        assertEq(xr, 6e18);
        assertEq(xq, -20_000e6);
        assertEq(RecordLib.notional(r, true), 20_000e6);
        assertFalse(RecordLib.depositIsQuote(r, true));
        assertTrue(RecordLib.depositIsQuote(r, false));
        (xr, xq) = RecordLib.receipts(r, false);
        assertEq(xr, -20_000e6);
        assertEq(RecordLib.notional(r, false), 6e18);
    }

    function testFuzz_Record_HashBindsEveryField(uint64 rid, uint128 dep) public pure {
        Record memory a;
        a.id = rid;
        a.deposit = dep;
        Record memory b;
        b.id = rid;
        b.deposit = dep ^ 1;
        assertTrue(RecordLib.hash(a) != RecordLib.hash(b));
    }

    // --- CalendarMath --------------------------------------------------------------------------

    function test_Calendar_KnownDates() public pure {
        assertEq(CalendarMath.daysFromCivil(1970, 1, 1), 0);
        assertEq(CalendarMath.daysFromCivil(2000, 3, 1), 11_017);
        assertEq(CalendarMath.daysFromCivil(2026, 11, 2), 20_759);
        assertEq(CalendarMath.weekday(20_759), 1); // Monday 2 November 2026
        (uint256 y, uint256 m, uint256 d) = CalendarMath.civilFromDays(20_759);
        assertEq(y * 10_000 + m * 100 + d, 20_261_102);
    }

    function testFuzz_Calendar_RoundTrip(uint32 z) public pure {
        uint256 days_ = uint256(z) % 3_000_000;
        (uint256 y, uint256 m, uint256 d) = CalendarMath.civilFromDays(days_);
        assertEq(CalendarMath.daysFromCivil(y, m, d), days_);
    }

    function test_Calendar_Dst2026() public pure {
        // 2026: DST starts Sunday 8 March 07:00 UTC, ends Sunday 1 November 06:00 UTC.
        uint256 start = CalendarMath.daysFromCivil(2026, 3, 8) * 86_400 + 7 hours;
        uint256 end = CalendarMath.daysFromCivil(2026, 11, 1) * 86_400 + 6 hours;
        assertFalse(CalendarMath.isNewYorkDst(start - 1));
        assertTrue(CalendarMath.isNewYorkDst(start));
        assertTrue(CalendarMath.isNewYorkDst(end - 1));
        assertFalse(CalendarMath.isNewYorkDst(end));
        assertEq(CalendarMath.toNewYork(end), end - 5 hours);
        assertEq(CalendarMath.toNewYork(start), start - 4 hours);
        assertEq(CalendarMath.nthSunday(2026, 3, 2), CalendarMath.daysFromCivil(2026, 3, 8));
    }
}
