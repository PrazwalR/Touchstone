// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {LiquidityAmounts} from "v4-periphery/libraries/LiquidityAmounts.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {AggregatorV3Interface} from "../../src/interfaces/external/AggregatorV3Interface.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {PoolLiquidityVault} from "./PoolLiquidityVault.sol";

/// @notice What CreatePool and RecenterPool share: the chain config, the pool key, the Chainlink starting price, and
/// the two liquidity positions the demo pool holds (a full-range backstop and a band around the reference, decision
/// 0067), sized from the config and placed in a PoolLiquidityVault that only the deployer controls (decision 0070).
abstract contract PoolSeeding is Script {
    error PoolSeeding__WrongChain(uint256 expected, uint256 actual);
    error PoolSeeding__BadReference(int256 answer);
    error PoolSeeding__NoDecimals(address token);
    error PoolSeeding__BadBand(uint256 halfWidthBps);

    uint256 internal constant BPS = 10_000;

    /// @dev The full-range backstop.
    struct Seed {
        uint256 quoteAmount;
        uint256 riskyBudget;
        uint128 liquidity;
    }

    /// @dev The concentrated position around the price.
    struct Band {
        int24 tickLower;
        int24 tickUpper;
        uint256 quoteAmount;
        uint256 riskyBudget;
        uint128 liquidity;
    }

    string internal cfg;
    string internal deploymentPath;
    string internal deployed;
    PoolKey internal key;
    address internal risky;
    address internal quote;
    bool internal quoteIs0;

    /// @dev Reads the chain config and the deployment record, and builds the pool key.
    function _loadPool() internal {
        string memory chain = vm.envString("CHAIN");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        cfg = vm.readFile(string.concat("script/config/", chain, ".json"));
        deploymentPath = vm.envOr("DEPLOYMENT_OUT", string.concat("deployments/", chain, ".json"));
        uint256 chainId = vm.parseJsonUint(cfg, ".chainId");
        if (block.chainid != chainId) revert PoolSeeding__WrongChain(chainId, block.chainid);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        deployed = vm.readFile(deploymentPath);
        risky = vm.parseJsonAddress(cfg, ".pool.risky");
        quote = vm.parseJsonAddress(cfg, ".pool.quote");
        quoteIs0 = quote < risky;
        key = PoolKey({
            currency0: Currency.wrap(quoteIs0 ? quote : risky),
            currency1: Currency.wrap(quoteIs0 ? risky : quote),
            fee: uint24(_u("fee")),
            tickSpacing: int24(int256(_u("tickSpacing"))),
            hooks: IHooks(vm.parseJsonAddress(deployed, ".hook"))
        });
    }

    /// @dev The Chainlink answer in quote base units per risky base unit times 1e36, as ReferenceLib scales it.
    function _referencePriceX36() internal view returns (uint256) {
        AggregatorV3Interface feed = AggregatorV3Interface(vm.parseJsonAddress(cfg, ".referenceFeed"));
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert PoolSeeding__BadReference(answer);
        uint256 k = 36 + uint256(_decimals(quote)) - uint256(_decimals(risky)) - uint256(feed.decimals());
        return uint256(answer) * 10 ** k;
    }

    function _sqrtPrice(uint256 priceX36) internal view returns (uint160) {
        return PriceLib.sqrtPriceX96At(priceX36, !quoteIs0);
    }

    /// @dev Full range: L = sqrt(x * y) in base units at the price.
    function _seed(uint256 priceX36, uint256 quoteAmount) internal view returns (Seed memory seed) {
        seed.quoteAmount = quoteAmount;
        uint256 riskyAmount = quoteAmount * 1e36 / priceX36;
        seed.liquidity = uint128(Math.sqrt(quoteAmount * riskyAmount));
        seed.riskyBudget = riskyAmount * (BPS + _u("liquidityRiskyMarginBps")) / BPS;
    }

    /// @dev A position from about `concentratedHalfWidthBps` below the price to as far above, widened outward to the
    /// tick spacing. One tick is 1.0001x, so a tick is about one basis point at these widths. The liquidity is set by
    /// the quote amount on the quote side of the current price; the risky side follows from it.
    function _band(uint160 sqrtP, uint256 quoteAmount) internal view returns (Band memory band) {
        uint256 halfWidth = _u("concentratedHalfWidthBps");
        int24 spacing = key.tickSpacing;
        if (halfWidth < uint24(spacing) || halfWidth > 5000) revert PoolSeeding__BadBand(halfWidth);
        int24 centre = TickMath.getTickAtSqrtPrice(sqrtP);
        band.tickLower = _floorTo(centre - int24(int256(halfWidth)), spacing);
        band.tickUpper = -_floorTo(-(centre + int24(int256(halfWidth))), spacing);
        uint160 sqrtA = TickMath.getSqrtPriceAtTick(band.tickLower);
        uint160 sqrtB = TickMath.getSqrtPriceAtTick(band.tickUpper);
        band.quoteAmount = quoteAmount;
        uint256 riskyAmount;
        if (quoteIs0) {
            band.liquidity = LiquidityAmounts.getLiquidityForAmount0(sqrtP, sqrtB, quoteAmount);
            riskyAmount = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtP, band.liquidity, true);
        } else {
            band.liquidity = LiquidityAmounts.getLiquidityForAmount1(sqrtA, sqrtP, quoteAmount);
            riskyAmount = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtB, band.liquidity, true);
        }
        band.riskyBudget = riskyAmount * (BPS + _u("liquidityRiskyMarginBps")) / BPS;
    }

    /// @dev Approves the vault for the tokens both positions pull from the caller, then adds them. Call inside a
    /// broadcast. Twice the quote amounts are approved: the vault pulls exact deltas, and rounding must never make a
    /// seed fail.
    function _addToVault(PoolLiquidityVault vault, Seed memory seed, Band memory band) internal {
        IERC20Minimal(quote).approve(address(vault), (seed.quoteAmount + band.quoteAmount) * 2);
        if (risky != address(0)) IERC20Minimal(risky).approve(address(vault), seed.riskyBudget + band.riskyBudget);
        _addPosition(
            vault,
            seed.riskyBudget,
            TickMath.minUsableTick(key.tickSpacing),
            TickMath.maxUsableTick(key.tickSpacing),
            seed.liquidity
        );
        _addPosition(vault, band.riskyBudget, band.tickLower, band.tickUpper, band.liquidity);
    }

    function _addPosition(PoolLiquidityVault vault, uint256 riskyBudget, int24 lower, int24 upper, uint128 liquidity)
        private
    {
        vault.modifyLiquidity{value: risky == address(0) ? riskyBudget : 0}(
            key,
            ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liquidity)), salt: 0
            })
        );
    }

    /// @dev The largest multiple of `spacing` at or below `tick`; Solidity's division truncates toward zero.
    function _floorTo(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 q = tick / spacing;
        if (tick < 0 && tick % spacing != 0) q -= 1;
        return q * spacing;
    }

    function _decimals(address token) internal view returns (uint8) {
        if (token == address(0)) return 18;
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert PoolSeeding__NoDecimals(token);
        return abi.decode(ret, (uint8));
    }

    function _u(string memory field) internal view returns (uint256) {
        return vm.parseJsonUint(cfg, string.concat(".pool.", field));
    }
}
