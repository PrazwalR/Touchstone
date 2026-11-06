// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {NyseCalendar} from "../../src/calendar/NyseCalendar.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {NyseData} from "../utils/NyseData.sol";

/// @notice NyseCalendar, built from NYSE's published holidays, against exchange_calendars' XNYS sessions for
/// 2026 to 2028 (test/fixtures/nyse_sessions_2026_2028.json, written by research/tools/nyse_vectors.py).
contract NyseCalendarDifferentialTest is Test {
    string internal constant VECTORS = "test/fixtures/nyse_sessions_2026_2028.json";

    NyseCalendar internal cal;
    uint256[] internal opens;
    uint256[] internal closes;

    function setUp() public {
        cal = NyseData.deploy(vm);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(VECTORS);
        opens = vm.parseJsonUintArray(json, ".opens");
        closes = vm.parseJsonUintArray(json, ".closes");
        assertEq(opens.length, closes.length);
    }

    /// @dev Reference answers from the session list: open iff some session holds t; next open is the first
    /// session opening strictly after t.
    function _expected(uint256 t) internal view returns (bool open, uint256 next) {
        uint256 lo;
        uint256 hi = opens.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (opens[mid] <= t) lo = mid + 1;
            else hi = mid;
        }
        open = lo > 0 && t < closes[lo - 1];
        next = lo < opens.length ? opens[lo] : 0;
    }

    function test_EverySessionBoundaryMatchesXnys() public view {
        uint256 n = opens.length;
        for (uint256 i; i < n; ++i) {
            uint256 o = opens[i];
            uint256 c = closes[i];
            assertFalse(cal.isOpen(o - 1), "closed a second before the open");
            assertTrue(cal.isOpen(o), "open at the open");
            assertTrue(cal.isOpen(c - 1), "open a second before the close");
            assertFalse(cal.isOpen(c), "closed at the close");
            assertEq(cal.nextOpen(o - 1), o, "next open just before the open");
            if (i > 0) assertEq(cal.nextOpen(closes[i - 1]), o, "next open from the previous close");
            if (i + 1 < n) assertEq(cal.nextOpen(o), opens[i + 1], "next open is strictly after");
        }
    }

    /// @dev Minute by minute across the weeks where the rules are most likely to break: both 2026 daylight-saving
    /// switches (8 March and 1 November) and Thanksgiving week with its 13:00 early close.
    function test_MinuteByMinuteAroundDstAndEarlyClose() public {
        // About 30,000 minutes, each with two calendar calls and a reference search: correctness, not gas.
        vm.pauseGasMetering();
        // Fridays 6 March, 30 October and 20 November 2026, 00:00 UTC, each swept for seven days.
        uint256[3] memory weekStarts = [uint256(1_772_755_200), 1_793_318_400, 1_795_132_800];
        for (uint256 w; w < 3; ++w) {
            for (uint256 m; m < 7 * 24 * 60; ++m) {
                uint256 t = weekStarts[w] + m * 60;
                (bool open, uint256 next) = _expected(t);
                assertEq(cal.isOpen(t), open, "isOpen");
                assertEq(cal.nextOpen(t), next, "nextOpen");
            }
        }
    }

    function testFuzz_MatchesXnysAnywhereInCoverage(uint256 t) public view {
        t = bound(t, opens[0] - 7 days, cal.validUntil() - 1);
        (bool open, uint256 next) = _expected(t);
        assertEq(cal.isOpen(t), open, "isOpen");
        assertEq(cal.nextOpen(t), next, "nextOpen");
    }

    function test_ValidUntilIsTheLastCoveredOpen() public view {
        assertEq(cal.validUntil(), opens[opens.length - 1]);
        assertEq(cal.nextOpen(cal.validUntil() - 1), cal.validUntil());
    }

    function test_NothingIsOpenOutsideTheCoveredYears() public {
        assertFalse(cal.isOpen(opens[0] - 365 days + 1 hours));
        uint256 last = cal.validUntil();
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__CalendarExhausted.selector, last));
        cal.nextOpen(last);
    }

    function test_ConstructorRejectsBadData() public {
        uint32[] memory none = new uint32[](0);
        uint32[] memory saturday = new uint32[](1);
        saturday[0] = 20_456; // Saturday 3 January 2026
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__CalendarDataInvalid.selector, 0));
        new NyseCalendar(20_454, 21_549, saturday, none);
        uint32[] memory unordered = new uint32[](2);
        unordered[0] = 20_472;
        unordered[1] = 20_454;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__CalendarDataInvalid.selector, 1));
        new NyseCalendar(20_454, 21_549, unordered, none);
        uint32[] memory both = new uint32[](1);
        both[0] = 20_454;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__CalendarDataInvalid.selector, 0));
        new NyseCalendar(20_454, 21_549, both, both);
    }
}
