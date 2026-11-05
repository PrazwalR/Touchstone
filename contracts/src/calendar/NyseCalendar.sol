// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IMarketCalendar} from "../interfaces/IMarketCalendar.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";
import {CalendarMath} from "../libraries/CalendarMath.sol";

/// @title NyseCalendar
/// @notice The New York Stock Exchange's regular session, 09:30 to 16:00 New York time on weekdays, with the
/// holidays and 13:00 early closes NYSE has published for the covered years (spec §9.1). No owner: the data
/// is fixed at construction, and a calendar for later years is a new contract.
/// @dev Days are counted since 1970-01-01 in New York local time. Daylight saving follows the US rule since
/// 2007 (CalendarMath). Days outside [FIRST_DAY, LAST_DAY] count as closed, and validUntil() is the opening
/// time of the last covered session, so for every t before it nextOpen(t) is fully determined by published
/// data and never reverts. The hook takes no deposits on a calendar pool after validUntil.
contract NyseCalendar is IMarketCalendar, ITouchstoneErrors {
    uint256 internal constant DAY = CalendarMath.SECONDS_PER_DAY;
    uint256 internal constant OPEN_TIME = 9 hours + 30 minutes;
    uint256 internal constant CLOSE_TIME = 16 hours;
    uint256 internal constant EARLY_CLOSE_TIME = 13 hours;
    /// @dev Longest run of closed days in the NYSE rules: a holiday on each side of a weekend is four days.
    uint256 internal constant MAX_CLOSED_RUN = 7;

    /// @notice First and last covered day, as days since 1970-01-01.
    uint256 public immutable FIRST_DAY;
    uint256 public immutable LAST_DAY;
    uint256 internal immutable VALID_UNTIL;

    uint32[] internal _holidays;
    uint32[] internal _earlyCloses;

    /// @param firstDay First covered day.
    /// @param lastDay Last covered day.
    /// @param holidays Weekdays the exchange is closed, strictly increasing, within the covered days.
    /// @param earlyCloses Weekdays the session ends at 13:00, strictly increasing, none of them a holiday.
    constructor(uint32 firstDay, uint32 lastDay, uint32[] memory holidays, uint32[] memory earlyCloses) {
        if (firstDay >= lastDay) revert Touchstone__CalendarDataInvalid(0);
        FIRST_DAY = firstDay;
        LAST_DAY = lastDay;
        _check(holidays, firstDay, lastDay);
        _check(earlyCloses, firstDay, lastDay);
        _holidays = holidays;
        _earlyCloses = earlyCloses;
        for (uint256 i; i < earlyCloses.length; ++i) {
            if (_contains(_holidays, earlyCloses[i])) revert Touchstone__CalendarDataInvalid(i);
        }
        uint256 last = lastDay;
        while (!_isTradingDay(last)) --last;
        VALID_UNTIL = _openAt(last);
    }

    /// @inheritdoc IMarketCalendar
    function isOpen(uint256 t) external view returns (bool) {
        uint256 local = CalendarMath.toNewYork(t);
        uint256 day = local / DAY;
        if (!_isTradingDay(day)) return false;
        uint256 time = local % DAY;
        return time >= OPEN_TIME && time < (_contains(_earlyCloses, day) ? EARLY_CLOSE_TIME : CLOSE_TIME);
    }

    /// @inheritdoc IMarketCalendar
    function nextOpen(uint256 t) external view returns (uint256) {
        uint256 day = CalendarMath.toNewYork(t) / DAY;
        for (uint256 i; i <= MAX_CLOSED_RUN; ++i) {
            if (!_isTradingDay(day + i)) continue;
            uint256 open = _openAt(day + i);
            if (open > t) return open;
        }
        revert Touchstone__CalendarExhausted(t);
    }

    /// @inheritdoc IMarketCalendar
    function validUntil() external view returns (uint256) {
        return VALID_UNTIL;
    }

    /// @notice Holidays and early closes, as given at construction.
    /// @return holidays Holiday days.
    /// @return earlyCloses Early-close days.
    function calendarDays() external view returns (uint32[] memory holidays, uint32[] memory earlyCloses) {
        return (_holidays, _earlyCloses);
    }

    function _isTradingDay(uint256 day) internal view returns (bool) {
        if (day < FIRST_DAY || day > LAST_DAY) return false;
        uint256 wd = CalendarMath.weekday(day);
        return wd != 0 && wd != 6 && !_contains(_holidays, day);
    }

    /// @dev 09:30 New York time on `day`, in UTC. Daylight saving changes at 02:00 on a Sunday, so the offset at
    /// 09:30 on a trading day is the offset of the whole day.
    function _openAt(uint256 day) internal pure returns (uint256) {
        uint256 standard = day * DAY + OPEN_TIME + CalendarMath.EST_OFFSET;
        return CalendarMath.isNewYorkDst(standard) ? standard - 1 hours : standard;
    }

    function _contains(uint32[] storage list, uint256 day) internal view returns (bool) {
        uint256 lo;
        uint256 hi = list.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (list[mid] < day) lo = mid + 1;
            else hi = mid;
        }
        return lo < list.length && list[lo] == day;
    }

    function _check(uint32[] memory list, uint256 firstDay, uint256 lastDay) internal pure {
        for (uint256 i; i < list.length; ++i) {
            uint256 d = list[i];
            uint256 wd = CalendarMath.weekday(d);
            bool ordered = i == 0 || list[i - 1] < d;
            if (!ordered || d < firstDay || d > lastDay || wd == 0 || wd == 6) {
                revert Touchstone__CalendarDataInvalid(i);
            }
        }
    }
}
