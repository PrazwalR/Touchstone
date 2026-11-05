// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Every custom error in Touchstone, except URC-4's MissingHookData and MalformedHookData.
interface ITouchstoneErrors {
    error Touchstone__NotFactory();
    error Touchstone__NotSettler();
    error Touchstone__NotLicence();
    error Touchstone__PoolNotRegistered(PoolId id);
    error Touchstone__ConfigOutOfBounds(uint8 field);
    error Touchstone__DynamicFeeNotSupported();
    error Touchstone__RecordClosed(PoolId id, uint64 recordId);
    error Touchstone__TooEarly(uint256 t0);
    error Touchstone__NotExpired(uint256 expiresAt);
    error Touchstone__PayoutMismatch();
    error Touchstone__GuardFailed(uint8 which);
    error Touchstone__NativeRefundFailed();
    error Touchstone__DeadlinePassed();
    error Touchstone__LicenceDisabled(PoolId id);
    error Touchstone__BidTooLow(uint128 minimum);
    error Touchstone__DepositBelowNotice(uint256 minimum);
    error Touchstone__NotLeaseOwner();
    error Touchstone__QuoteNotErc20();
    error Touchstone__NothingToClaim();
    // Raised by the math libraries.
    error Touchstone__NonPositivePrice();
    error Touchstone__ExponentOutOfRange(int256 exponent);
    error Touchstone__RetainedAboveDeposit(uint256 retained, uint256 deposit);
    error Touchstone__ZeroHorizon();
    // Added during M2 and M3 (decision 0021).
    error Touchstone__NotHook();
    error Touchstone__NotPoolManager();
    error Touchstone__AlreadyRegistered(PoolId id);
    error Touchstone__Reentrant();
    error Touchstone__LedgerShortfall(uint256 balance, uint256 owed);
    error Touchstone__FeeRefundFailed();
    error Touchstone__InvalidBlockSource(uint8 source);
    error Touchstone__NoCode(address target);
    error Touchstone__CalendarDataInvalid(uint256 index);
    error Touchstone__CalendarExhausted(uint256 t);
    // Added in M9 (decision 0056).
    error Touchstone__TransferShortfall(uint256 expected, uint256 received);
    // Added in M10 (decision 0057).
    error Touchstone__ZeroQuoteBudget();
}
