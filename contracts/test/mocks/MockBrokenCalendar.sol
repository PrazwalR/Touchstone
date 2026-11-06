// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A calendar that reports a validity date but reverts on isOpen, as a buggy or self-destructed
/// implementation behind a proxy might.
contract MockBrokenCalendar {
    uint256 internal immutable VALID_UNTIL;

    constructor(uint256 validUntil_) {
        VALID_UNTIL = validUntil_;
    }

    function validUntil() external view returns (uint256) {
        return VALID_UNTIL;
    }

    function isOpen(uint256) external pure returns (bool) {
        revert("broken");
    }

    function nextOpen(uint256 t) external pure returns (uint256) {
        return t + 1 days;
    }
}
