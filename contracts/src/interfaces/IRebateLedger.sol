// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Currency} from "v4-core/types/Currency.sol";

/// @notice Holds payout credits as ERC-6909 claims until delivery or a recipient claim.
interface IRebateLedger {
    /// @notice Why an amount was credited.
    enum Kind {
        REBATE,
        // Refunds are staged here before best-effort delivery, including successful deliveries.
        DEFERRED_REFUND,
        PROTOCOL,
        TIP
    }

    /// @notice Credit `amount` of `currency` to `recipient`. The hook transfers the claims first.
    /// @param recipient Address that may claim the amount.
    /// @param currency Currency of the claims.
    /// @param amount Amount credited.
    /// @param kind Reason for the credit.
    function credit(address recipient, Currency currency, uint256 amount, Kind kind) external;

    /// @notice Amount of `currency` owed to `recipient`.
    /// @param recipient The recipient.
    /// @param currency The currency.
    /// @return The amount owed.
    function owed(address recipient, Currency currency) external view returns (uint256);

    /// @notice Withdraw everything owed to the caller in `currency` as the underlying token.
    /// @param currency The currency to claim.
    /// @param to Receiver of the tokens.
    /// @return amount Amount withdrawn.
    function claim(Currency currency, address to) external returns (uint256 amount);

    /// @notice Withdraw everything owed to the caller in `currency` as ERC-6909 claims.
    /// @param currency The currency to claim.
    /// @param to Receiver of the claims.
    /// @return amount Amount transferred.
    function claimAsClaims(Currency currency, address to) external returns (uint256 amount);

    /// @notice Send everything owed to `recipient` in `currency` to `recipient`, as the underlying token.
    /// @param recipient The recipient whose balance is pushed.
    /// @param currency The currency to push.
    /// @return amount Amount sent.
    function push(address recipient, Currency currency) external returns (uint256 amount);
}
