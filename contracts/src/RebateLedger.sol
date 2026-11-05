// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IRebateLedger} from "./interfaces/IRebateLedger.sol";
import {ITouchstoneErrors} from "./interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "./interfaces/ITouchstoneEvents.sol";

/// @title RebateLedger
/// @notice Holds rebates, the protocol share, tips and refunds as ERC-6909 claims in the PoolManager,
/// until delivery succeeds or each recipient claims them.
/// @dev Crediting is a claim transfer plus a counter, so a bad recipient can never block a
/// settlement. After every credit the ledger checks that its claims cover everything it owes (I2).
contract RebateLedger is IRebateLedger, IUnlockCallback, ITouchstoneErrors, ITouchstoneEvents {
    IPoolManager public immutable POOL_MANAGER;
    address public immutable HOOK;

    mapping(address => mapping(Currency => uint256)) internal _owed;
    mapping(Currency => uint256) internal _totalOwed;

    /// @param manager The v4 PoolManager.
    /// @param hook The TouchstoneHook, the only address that may credit.
    constructor(IPoolManager manager, address hook) {
        POOL_MANAGER = manager;
        HOOK = hook;
    }

    /// @inheritdoc IRebateLedger
    function credit(address recipient, Currency currency, uint256 amount, Kind kind) external {
        if (msg.sender != HOOK) revert Touchstone__NotHook();
        _owed[recipient][currency] += amount;
        uint256 total = _totalOwed[currency] + amount;
        _totalOwed[currency] = total;
        uint256 balance = POOL_MANAGER.balanceOf(address(this), currency.toId());
        if (balance < total) revert Touchstone__LedgerShortfall(balance, total);
        emit Credited(recipient, currency, amount, kind);
    }

    /// @inheritdoc IRebateLedger
    function claim(Currency currency, address to) external returns (uint256 amount) {
        amount = _debit(msg.sender, currency);
        POOL_MANAGER.unlock(abi.encode(currency, to, amount));
        emit Claimed(msg.sender, currency, to, amount);
    }

    /// @inheritdoc IRebateLedger
    function claimAsClaims(Currency currency, address to) external returns (uint256 amount) {
        amount = _debit(msg.sender, currency);
        POOL_MANAGER.transfer(to, currency.toId(), amount);
        emit Claimed(msg.sender, currency, to, amount);
    }

    /// @inheritdoc IRebateLedger
    function push(address recipient, Currency currency) external returns (uint256 amount) {
        amount = _debit(recipient, currency);
        POOL_MANAGER.unlock(abi.encode(currency, recipient, amount));
        emit Claimed(recipient, currency, recipient, amount);
    }

    /// @notice Burns claims and sends the underlying token. PoolManager only.
    /// @param data ABI-encoded currency, receiver and amount.
    /// @return Empty bytes.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert Touchstone__NotPoolManager();
        (Currency currency, address to, uint256 amount) = abi.decode(data, (Currency, address, uint256));
        POOL_MANAGER.burn(address(this), currency.toId(), amount);
        POOL_MANAGER.take(currency, to, amount);
        return "";
    }

    /// @inheritdoc IRebateLedger
    function owed(address recipient, Currency currency) external view returns (uint256) {
        return _owed[recipient][currency];
    }

    /// @notice Total owed in `currency` across all recipients.
    /// @param currency The currency.
    /// @return The total.
    function totalOwed(Currency currency) external view returns (uint256) {
        return _totalOwed[currency];
    }

    function _debit(address recipient, Currency currency) internal returns (uint256 amount) {
        amount = _owed[recipient][currency];
        if (amount == 0) revert Touchstone__NothingToClaim();
        _owed[recipient][currency] = 0;
        // A recipient's balance is part of the total, so the subtraction cannot underflow.
        unchecked {
            _totalOwed[currency] -= amount;
        }
    }
}
