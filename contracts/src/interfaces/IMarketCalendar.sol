// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Regular-session schedule of a closed market (spec §9.1).
interface IMarketCalendar {
    /// @notice True while the regular session is open at time t.
    function isOpen(uint256 t) external view returns (bool);

    /// @notice Opening time of the first regular session that starts after t.
    function nextOpen(uint256 t) external view returns (uint256);

    /// @notice Last timestamp the calendar's holiday data covers.
    function validUntil() external view returns (uint256);
}
