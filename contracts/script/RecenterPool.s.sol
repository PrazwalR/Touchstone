// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolLiquidityVault} from "./support/PoolLiquidityVault.sol";
import {PoolSeeding} from "./support/PoolSeeding.sol";

/// @notice Puts the demo pool back in working order after the market has moved or someone has traded it out of
/// range (decision 0070). In one run, from the deployer account: withdraw every position (the legacy ones held by
/// Uniswap's open test router and the ones in the vault), move the pool price onto the Chainlink reference, and seed
/// the backstop and the band again at that price inside the vault.
/// @dev With no liquidity left the price moves with no tokens changing hands, so the run needs no capital to undo a
/// dump. It needs the tokens to seed again: the withdrawn amounts plus whatever the deployer still holds. If those
/// fall short, both positions are scaled down together and the shortfall is printed; top up the deployer and run again
/// to restore the configured depth.
contract RecenterPool is PoolSeeding {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error RecenterPool__NotTheVaultOwner(address owner, address caller);
    error RecenterPool__PriceNotReached(uint160 expected, uint160 actual);
    error RecenterPool__InsufficientFunds(uint256 quoteHave, uint256 quoteNeed, uint256 riskyHave, uint256 riskyNeed);

    /// @dev Native balance kept back for gas.
    uint256 internal constant GAS_RESERVE = 0.004 ether;
    /// @dev Below this share of the configured depth the run stops instead of seeding a pool too thin to use.
    uint256 internal constant MIN_SCALE_BPS = 1000;
    /// @dev The pool does not use all of what it is offered; this slack keeps rounding from failing a seed.
    uint256 internal constant SCALE_SLACK_BPS = 9900;

    IPoolManager internal manager;
    PoolId internal poolId;

    function run() external {
        _loadPool();
        manager = IPoolManager(vm.parseJsonAddress(cfg, ".poolManager"));
        poolId = key.toId();
        uint256 priceX36 = _referencePriceX36();
        uint160 target = _sqrtPrice(priceX36);
        console2.log("pool price before (sqrtPriceX96)", _sqrtNow());
        console2.log("reference price   (sqrtPriceX96)", target);

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        PoolLiquidityVault vault = _vault(me);
        _withdrawAll(vault);
        _movePrice(target, me);
        (Seed memory seed, Band memory band) = _size(priceX36, target, me);
        _addToVault(vault, seed, band);
        vm.stopBroadcast();

        if (_sqrtNow() != target) revert RecenterPool__PriceNotReached(target, _sqrtNow());
        console2.log("backstop quote", seed.quoteAmount);
        console2.log("band quote    ", band.quoteAmount);
        console2.log("band ticks lower", int256(band.tickLower));
        console2.log("band ticks upper", int256(band.tickUpper));
        console2.log("vault", address(vault));
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) _write(vault, seed, band);
    }

    /// @dev The vault from the deployment record, or a new one owned by the caller.
    function _vault(address me) internal returns (PoolLiquidityVault vault) {
        if (!vm.keyExistsJson(deployed, ".pool.vault")) return new PoolLiquidityVault(manager, me);
        vault = PoolLiquidityVault(vm.parseJsonAddress(deployed, ".pool.vault"));
        if (vault.OWNER() != me) revert RecenterPool__NotTheVaultOwner(vault.OWNER(), me);
    }

    /// @dev Removes the full-range position and the band from both possible owners. A position that does not exist is
    /// skipped, so the run is safe to repeat.
    function _withdrawAll(PoolLiquidityVault vault) internal {
        PoolModifyLiquidityTest router =
            PoolModifyLiquidityTest(vm.parseJsonAddress(cfg, ".routers.poolModifyLiquidityTest"));
        int24 bandLower = int24(vm.parseJsonInt(deployed, ".pool.bandTickLower"));
        int24 bandUpper = int24(vm.parseJsonInt(deployed, ".pool.bandTickUpper"));
        int24 fullLower = TickMath.minUsableTick(key.tickSpacing);
        int24 fullUpper = TickMath.maxUsableTick(key.tickSpacing);
        _remove(router, vault, address(router), fullLower, fullUpper);
        _remove(router, vault, address(router), bandLower, bandUpper);
        _remove(router, vault, address(vault), fullLower, fullUpper);
        _remove(router, vault, address(vault), bandLower, bandUpper);
    }

    function _remove(PoolModifyLiquidityTest router, PoolLiquidityVault vault, address owner, int24 lower, int24 upper)
        private
    {
        (uint128 liquidity,,) = manager.getPositionInfo(poolId, owner, lower, upper, bytes32(0));
        if (liquidity == 0) return;
        console2.log("withdrawing liquidity", liquidity);
        ModifyLiquidityParams memory p = ModifyLiquidityParams({
            tickLower: lower, tickUpper: upper, liquidityDelta: -int256(uint256(liquidity)), salt: 0
        });
        if (owner == address(vault)) vault.modifyLiquidity(key, p);
        else router.modifyLiquidity(key, p, "");
    }

    /// @dev Swaps to the target price. The limit stops the swap there, so the amount only has to be large enough.
    /// Native input is sent as value and the router returns what it does not use.
    function _movePrice(uint160 target, address me) internal {
        uint160 current = _sqrtNow();
        if (current == target) return;
        bool zeroForOne = target < current;
        PoolSwapTest swapRouter = PoolSwapTest(vm.parseJsonAddress(cfg, ".routers.poolSwapTest"));
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        uint256 value;
        if (input.isAddressZero()) {
            value = me.balance > GAS_RESERVE ? me.balance - GAS_RESERVE : 0;
        } else {
            IERC20Minimal(Currency.unwrap(input)).approve(address(swapRouter), type(uint256).max);
        }
        swapRouter.swap{value: value}(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(uint256(uint128(type(int128).max))),
                sqrtPriceLimitX96: target
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @dev The two positions at the configured depth, or scaled down together to what the caller holds.
    function _size(uint256 priceX36, uint160 target, address me)
        internal
        view
        returns (Seed memory seed, Band memory band)
    {
        uint256 backstop = _u("liquidityQuote");
        uint256 concentrated = _u("concentratedQuote");
        seed = _seed(priceX36, backstop);
        band = _band(target, concentrated);
        uint256 quoteNeed = backstop + concentrated;
        uint256 riskyNeed = seed.riskyBudget + band.riskyBudget;
        uint256 quoteHave = IERC20Minimal(quote).balanceOf(me);
        uint256 riskyHave = risky == address(0)
            ? (me.balance > GAS_RESERVE ? me.balance - GAS_RESERVE : 0)
            : IERC20Minimal(risky).balanceOf(me);
        uint256 scale = BPS;
        if (quoteHave < quoteNeed) scale = quoteHave * BPS / quoteNeed;
        if (riskyHave < riskyNeed && riskyHave * BPS / riskyNeed < scale) scale = riskyHave * BPS / riskyNeed;
        if (scale == BPS) return (seed, band);
        if (scale < MIN_SCALE_BPS) revert RecenterPool__InsufficientFunds(quoteHave, quoteNeed, riskyHave, riskyNeed);
        console2.log("funds cover only this share of the configured depth (bps)", scale);
        scale = scale * SCALE_SLACK_BPS / BPS;
        seed = _seed(priceX36, backstop * scale / BPS);
        band = _band(target, concentrated * scale / BPS);
    }

    function _sqrtNow() internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = manager.getSlot0(poolId);
    }

    /// @dev Records the vault and the new band, so the next run withdraws exactly what this one placed.
    function _write(PoolLiquidityVault vault, Seed memory seed, Band memory band) internal {
        // forge-lint: disable-start(unsafe-cheatcode)
        vm.writeJson(string.concat('"', vm.toString(address(vault)), '"'), deploymentPath, ".pool.vault");
        vm.writeJson(vm.toString(int256(band.tickLower)), deploymentPath, ".pool.bandTickLower");
        vm.writeJson(vm.toString(int256(band.tickUpper)), deploymentPath, ".pool.bandTickUpper");
        vm.writeJson(vm.toString(uint256(band.liquidity)), deploymentPath, ".pool.bandLiquidity");
        vm.writeJson(vm.toString(uint256(seed.liquidity)), deploymentPath, ".pool.liquidity");
        // forge-lint: disable-end(unsafe-cheatcode)
    }
}
