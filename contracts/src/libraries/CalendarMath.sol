// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title CalendarMath
/// @notice Civil-date arithmetic and the United States daylight-saving rule, for NyseCalendar.
/// @dev The day conversions are Howard Hinnant's days_from_civil and civil_from_days, restricted to
/// dates on or after 1970-01-01, which is all a block timestamp can be. The daylight-saving rule is
/// the one in force since 2007: from the second Sunday in March at 02:00 local standard time to the
/// first Sunday in November at 02:00 local daylight time.
library CalendarMath {
    uint256 internal constant SECONDS_PER_DAY = 86_400;
    uint256 internal constant SECONDS_PER_HOUR = 3_600;
    /// @dev New York is UTC-5 in standard time and UTC-4 in daylight time.
    uint256 internal constant EST_OFFSET = 5 * SECONDS_PER_HOUR;
    uint256 internal constant EDT_OFFSET = 4 * SECONDS_PER_HOUR;
    /// @dev Transitions happen at 02:00 local time.
    uint256 internal constant TRANSITION_HOUR = 2 * SECONDS_PER_HOUR;

    /// @notice Days since 1970-01-01 for a proleptic Gregorian date.
    /// @param year Year, at least 1970.
    /// @param month Month, 1 to 12.
    /// @param day Day of the month, 1 to 31.
    function daysFromCivil(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        // Shift the year to start in March so the leap day is the last day of the year.
        uint256 y = month <= 2 ? year - 1 : year;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 mp = month > 2 ? month - 3 : month + 9;
        uint256 doy = (153 * mp + 2) / 5 + day - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    /// @notice The civil date for a day count since 1970-01-01.
    /// @return year The year.
    /// @return month The month, 1 to 12.
    /// @return day The day of the month.
    function civilFromDays(uint256 z) internal pure returns (uint256 year, uint256 month, uint256 day) {
        z += 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        day = doy - (153 * mp + 2) / 5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        year = yoe + era * 400 + (month <= 2 ? 1 : 0);
    }

    /// @notice Day of the week, 0 for Sunday through 6 for Saturday.
    function weekday(uint256 daysSinceEpoch) internal pure returns (uint256) {
        // 1970-01-01 was a Thursday.
        return (daysSinceEpoch + 4) % 7;
    }

    /// @notice Day count of the n-th Sunday of a month, n starting at 1.
    function nthSunday(uint256 year, uint256 month, uint256 n) internal pure returns (uint256) {
        uint256 first = daysFromCivil(year, month, 1);
        uint256 toSunday = (7 - weekday(first)) % 7;
        return first + toSunday + (n - 1) * 7;
    }

    /// @notice True if New York observes daylight time at UTC timestamp `t`.
    function isNewYorkDst(uint256 t) internal pure returns (bool) {
        (uint256 year,,) = civilFromDays(t / SECONDS_PER_DAY);
        uint256 start = nthSunday(year, 3, 2) * SECONDS_PER_DAY + TRANSITION_HOUR + EST_OFFSET;
        uint256 end = nthSunday(year, 11, 1) * SECONDS_PER_DAY + TRANSITION_HOUR + EDT_OFFSET;
        return t >= start && t < end;
    }

    /// @notice New York local time for UTC timestamp `t`, as seconds since the local epoch.
    function toNewYork(uint256 t) internal pure returns (uint256) {
        return t - (isNewYorkDst(t) ? EDT_OFFSET : EST_OFFSET);
    }
}
