// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/// @notice Holds the testnet demo pool's liquidity positions so that only the deployer can add or remove them.
/// @dev Uniswap's PoolModifyLiquidityTest router owns every position it creates and pays any caller who removes one,
/// so liquidity seeded through it can be withdrawn by anyone (decision 0070). The PoolManager keys a position by the
/// address that calls `modifyLiquidity`, which here is this contract, and only `OWNER` can make it do so. Tokens are
/// pulled from and paid to `OWNER`. This is testnet tooling under script/, not part of the protocol in src/.
contract PoolLiquidityVault is IUnlockCallback {
    using CurrencySettler for Currency;

    error PoolLiquidityVault__NotOwner();
    error PoolLiquidityVault__NotManager();
    error PoolLiquidityVault__RefundFailed();

    /// @dev The data passed through the unlock callback.
    struct CallbackData {
        PoolKey key;
        ModifyLiquidityParams params;
    }

    IPoolManager public immutable MANAGER;
    address public immutable OWNER;

    /// @param manager The Uniswap v4 PoolManager.
    /// @param owner_ The only account that can change the positions this vault holds.
    constructor(IPoolManager manager, address owner_) {
        MANAGER = manager;
        OWNER = owner_;
    }

    /// @notice Adds or removes liquidity in a position owned by this vault.
    /// @dev ERC-20 debts are pulled from the owner, which must have approved this contract. Native debts are paid from
    /// `msg.value`; the unused remainder goes back to the owner. Credits (a removal or accrued fees) are sent to the
    /// owner.
    /// @param key The pool.
    /// @param params The tick range, the liquidity change and the salt.
    /// @return delta The owner's net token change.
    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params)
        external
        payable
        returns (BalanceDelta delta)
    {
        if (msg.sender != OWNER) revert PoolLiquidityVault__NotOwner();
        delta = abi.decode(MANAGER.unlock(abi.encode(CallbackData({key: key, params: params}))), (BalanceDelta));
        uint256 remainder = address(this).balance;
        if (remainder != 0) {
            (bool ok,) = OWNER.call{value: remainder}("");
            if (!ok) revert PoolLiquidityVault__RefundFailed();
        }
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(MANAGER)) revert PoolLiquidityVault__NotManager();
        CallbackData memory data = abi.decode(rawData, (CallbackData));
        (BalanceDelta delta,) = MANAGER.modifyLiquidity(data.key, data.params, "");
        _settle(data.key.currency0, delta.amount0());
        _settle(data.key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 amount) private {
        if (amount < 0) {
            // Safe: a negative int128 negated fits in uint128, because int128.min is never returned by the manager.
            currency.settle(MANAGER, OWNER, uint256(uint128(-amount)), false);
        } else if (amount > 0) {
            currency.take(MANAGER, OWNER, uint256(uint128(amount)), false);
        }
    }
}
