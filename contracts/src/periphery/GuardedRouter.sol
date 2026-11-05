// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IMsgSender} from "v4-periphery/interfaces/IMsgSender.sol";
import {IGuardedRouter} from "../interfaces/IGuardedRouter.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";
import {ITouchstoneHook} from "../interfaces/ITouchstoneHook.sol";
import {TransientLib} from "../libraries/TransientLib.sol";
import {Guard} from "../types/Guard.sol";

/// @title GuardedRouter
/// @notice Swaps on one Touchstone pool, reads the deposit the hook actually took from its transient slot, and
/// enforces the trader's limits inside the same transaction (spec §12.4).
/// @dev The trader is reported through IMsgSender for the length of the lock. With the router in the hook's
/// trusted list, refunds name the trader whatever hookData says; without it, hookData names the trader. The
/// router holds no funds between calls: unused native value is returned before the call ends.
contract GuardedRouter is IGuardedRouter, IUnlockCallback, IMsgSender, ITouchstoneErrors {
    using SafeERC20 for IERC20;

    /// @dev Which guard failed, reported in Touchstone__GuardFailed.
    uint8 internal constant FAILED_DEADLINE = 0;
    uint8 internal constant FAILED_MAX_DEPOSIT = 1;
    uint8 internal constant FAILED_MIN_NET_OUT = 2;
    uint8 internal constant FAILED_MIN_GROSS_OUT = 3;
    uint8 internal constant FAILED_MAX_NET_IN = 4;

    IPoolManager public immutable POOL_MANAGER;
    ITouchstoneHook public immutable HOOK;

    /// @param manager The v4 PoolManager.
    /// @param hook The TouchstoneHook whose deposits this router checks.
    constructor(IPoolManager manager, ITouchstoneHook hook) {
        POOL_MANAGER = manager;
        HOOK = hook;
    }

    /// @inheritdoc IGuardedRouter
    function swapGuarded(
        PoolKey calldata key,
        SwapParams calldata params,
        Guard calldata guard,
        address rebateTo,
        uint256 deadline
    ) external payable returns (BalanceDelta delta, uint256 deposit) {
        if (block.timestamp > deadline) revert Touchstone__GuardFailed(FAILED_DEADLINE);
        TransientLib.set(TransientLib.ROUTER_CALLER, PoolId.wrap(bytes32(0)), uint160(msg.sender));
        bytes memory out = POOL_MANAGER.unlock(abi.encode(msg.sender, key, params, guard, rebateTo));
        TransientLib.set(TransientLib.ROUTER_CALLER, PoolId.wrap(bytes32(0)), 0);
        (delta, deposit) = abi.decode(out, (BalanceDelta, uint256));
        uint256 unused = address(this).balance;
        if (unused != 0) {
            (bool ok,) = msg.sender.call{value: unused}("");
            if (!ok) revert Touchstone__NativeRefundFailed();
        }
    }

    /// @notice Runs the swap, checks the guard and settles. PoolManager only.
    /// @param data ABI-encoded trader, key, params, guard and rebate recipient.
    /// @return ABI-encoded balance delta and deposit.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert Touchstone__NotPoolManager();
        (address trader, PoolKey memory key, SwapParams memory params, Guard memory guard, address rebateTo) =
            abi.decode(data, (address, PoolKey, SwapParams, Guard, address));
        BalanceDelta delta = POOL_MANAGER.swap(key, params, abi.encode(trader, rebateTo));
        // lastDeposit is cleared in beforeSwap and written in afterSwap, so it is exactly this swap's deposit.
        (uint256 deposit,) = HOOK.lastDeposit(key.toId());
        _check(params, guard, delta, deposit);
        _resolve(key.currency0, delta.amount0(), trader);
        _resolve(key.currency1, delta.amount1(), trader);
        return abi.encode(delta, deposit);
    }

    /// @notice The trader of the swap in progress; zero outside a swapGuarded call.
    /// @return The trader.
    function msgSender() external view returns (address) {
        return address(uint160(TransientLib.get(TransientLib.ROUTER_CALLER, PoolId.wrap(bytes32(0)))));
    }

    /// @dev Exact input: what the trader receives now, alone and with the deposit added back. Exact output: what the
    /// trader pays now, deposit included. The output and input sides are the delta's positive and negative legs.
    function _check(SwapParams memory params, Guard memory guard, BalanceDelta delta, uint256 deposit) internal pure {
        if (deposit > guard.maxDeposit) revert Touchstone__GuardFailed(FAILED_MAX_DEPOSIT);
        int128 outLeg = params.zeroForOne ? delta.amount1() : delta.amount0();
        int128 inLeg = params.zeroForOne ? delta.amount0() : delta.amount1();
        if (params.amountSpecified < 0) {
            uint256 netOut = outLeg > 0 ? uint256(int256(outLeg)) : 0;
            if (netOut < guard.minNetOut) revert Touchstone__GuardFailed(FAILED_MIN_NET_OUT);
            if (netOut + deposit < guard.minGrossOut) revert Touchstone__GuardFailed(FAILED_MIN_GROSS_OUT);
        } else {
            uint256 netIn = inLeg < 0 ? uint256(-int256(inLeg)) : 0;
            if (netIn > guard.maxNetIn) revert Touchstone__GuardFailed(FAILED_MAX_NET_IN);
        }
    }

    /// @dev Pay what the trader owes from the trader (native from this call's value) and send what it is owed.
    function _resolve(Currency currency, int128 amount, address trader) internal {
        if (amount < 0) {
            uint256 owed = uint256(-int256(amount));
            if (currency.isAddressZero()) {
                POOL_MANAGER.settle{value: owed}();
            } else {
                POOL_MANAGER.sync(currency);
                IERC20(Currency.unwrap(currency)).safeTransferFrom(trader, address(POOL_MANAGER), owed);
                POOL_MANAGER.settle();
            }
        } else if (amount > 0) {
            POOL_MANAGER.take(currency, trader, uint256(int256(amount)));
        }
    }
}
