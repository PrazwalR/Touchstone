// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A calendar that always reports the market closed but reverts on nextOpen, so a closure record taken
/// under it would have no settlement time.
contract MockNoNextOpenCalendar {
    uint256 internal immutable VALID_UNTIL;

    constructor(uint256 validUntil_) {
        VALID_UNTIL = validUntil_;
    }

    function validUntil() external view returns (uint256) {
        return VALID_UNTIL;
    }

    function isOpen(uint256) external pure returns (bool) {
        return false;
    }

    function nextOpen(uint256) external pure returns (uint256) {
        revert("no next open");
    }
}
