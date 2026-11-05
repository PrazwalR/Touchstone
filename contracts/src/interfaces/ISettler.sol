// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Record} from "../types/Record.sol";
import {Payout} from "../types/Payout.sol";
import {ITouchstoneHook} from "./ITouchstoneHook.sol";

/// @notice Settles records against Pyth, or expires them.
interface ISettler {
    /// @notice Settle against the first Pyth update at or after t0. Excess msg.value is returned.
    /// @param record The open record, as emitted in DepositTaken.
    /// @param pythUpdate Hermes update data for the base and quote feeds.
    /// @return payout The split paid out.
    function settle(Record calldata record, bytes[] calldata pythUpdate) external payable returns (Payout memory payout);

    /// @notice Refund in full once t0 + W (or W_c) has passed. Pays no tip.
    /// @param record The open record.
    function expire(Record calldata record) external;

    /// @notice Settlement times for a record.
    /// @return t0 Earliest publish time accepted.
    /// @return latest Latest publish time accepted.
    /// @return expiresAt Time from which the record may be expired.
    function settleTime(Record calldata record) external view returns (uint256 t0, uint256 latest, uint256 expiresAt);

    /// @notice The hook this Settler finalizes on.
    /// @return The TouchstoneHook.
    function HOOK() external view returns (ITouchstoneHook);
}
