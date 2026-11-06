// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {TouchstoneFactory} from "../src/TouchstoneFactory.sol";
import {ILicenceAuction} from "../src/interfaces/ILicenceAuction.sol";
import {AggregatorV3Interface} from "../src/interfaces/external/AggregatorV3Interface.sol";
import {PriceLib} from "../src/libraries/PriceLib.sol";
import {PoolConfig, PoolFlags} from "../src/types/PoolConfig.sol";

/// @notice Creates the chain's demo pool from script/config/<CHAIN>.json on the core in deployments/<CHAIN>.json,
/// initialised at the Chainlink reference price, and seeds full-range liquidity through Uniswap's deployed
/// PoolModifyLiquidityTest router. Spec §19.2 and §19.3 step 3. The deployer must hold the configured quote amount.
contract CreatePool is Script {
    error CreatePool__WrongChain(uint256 expected, uint256 actual);
    error CreatePool__BadReference(int256 answer);
    error CreatePool__NoDecimals(address token);

    uint256 internal constant BPS = 10_000;

    /// @dev Amounts for the initial price and the full-range seed.
    struct Seed {
        uint256 priceX36;
        uint160 sqrtPriceX96;
        uint256 quoteAmount;
        uint256 riskyBudget;
        uint128 liquidity;
    }

    string internal cfg;
    string internal deploymentPath;
    TouchstoneFactory internal factory;
    PoolKey internal key;
    address internal risky;
    address internal quote;
    bool internal quoteIs0;

    function run() external returns (PoolId id) {
        _load();
        Seed memory seed = _seed();
        vm.startBroadcast();
        id = factory.createPool(key, _config(quoteIs0), _lease(), seed.sqrtPriceX96);
        _addLiquidity(seed);
        vm.stopBroadcast();
        _write(id, seed);
    }

    function _load() internal {
        string memory chain = vm.envString("CHAIN");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        cfg = vm.readFile(string.concat("script/config/", chain, ".json"));
        deploymentPath = vm.envOr("DEPLOYMENT_OUT", string.concat("deployments/", chain, ".json"));
        uint256 chainId = vm.parseJsonUint(cfg, ".chainId");
        if (block.chainid != chainId) revert CreatePool__WrongChain(chainId, block.chainid);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory deployed = vm.readFile(deploymentPath);
        factory = TouchstoneFactory(vm.parseJsonAddress(deployed, ".factory"));
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

    function _seed() internal view returns (Seed memory seed) {
        seed.priceX36 = _referencePriceX36(_decimals(risky), _decimals(quote));
        seed.sqrtPriceX96 = PriceLib.sqrtPriceX96At(seed.priceX36, !quoteIs0);
        seed.quoteAmount = _u("liquidityQuote");
        uint256 riskyAmount = seed.quoteAmount * 1e36 / seed.priceX36;
        // Full range: L = sqrt(x * y) in base units at the initial price.
        seed.liquidity = uint128(Math.sqrt(seed.quoteAmount * riskyAmount));
        seed.riskyBudget = riskyAmount * (BPS + _u("liquidityRiskyMarginBps")) / BPS;
    }

    function _addLiquidity(Seed memory seed) internal {
        PoolModifyLiquidityTest lp =
            PoolModifyLiquidityTest(vm.parseJsonAddress(cfg, ".routers.poolModifyLiquidityTest"));
        IERC20Minimal(quote).approve(address(lp), seed.quoteAmount * 2);
        if (risky != address(0)) IERC20Minimal(risky).approve(address(lp), seed.riskyBudget);
        lp.modifyLiquidity{value: risky == address(0) ? seed.riskyBudget : 0}(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: int256(uint256(seed.liquidity)),
                salt: 0
            }),
            ""
        );
    }

    function _write(PoolId id, Seed memory seed) internal {
        string memory o = "pool";
        vm.serializeBytes32(o, "poolId", PoolId.unwrap(id));
        vm.serializeAddress(o, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(o, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(o, "fee", key.fee);
        vm.serializeInt(o, "tickSpacing", key.tickSpacing);
        vm.serializeUint(o, "sqrtPriceX96", seed.sqrtPriceX96);
        string memory pool = vm.serializeUint(o, "liquidity", seed.liquidity);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(pool, deploymentPath, ".pool");
    }

    /// @dev A `pool.lease` section in the chain config makes the pool a licence pool (spec §10); without it the
    /// terms are ignored by the factory.
    function _lease() internal view returns (ILicenceAuction.LeaseParams memory l) {
        if (!vm.keyExistsJson(cfg, ".pool.lease")) return l;
        l.k = uint32(vm.parseJsonUint(cfg, ".pool.lease.k"));
        l.minIncrementBps = uint16(vm.parseJsonUint(cfg, ".pool.lease.minIncrementBps"));
        l.minRent = uint128(vm.parseJsonUint(cfg, ".pool.lease.minRent"));
    }

    function _config(bool quoteIsZero) internal view returns (PoolConfig memory c) {
        c.n0 = uint96(_u("n0"));
        c.nMin = uint96(_u("nMin"));
        c.flowHorizon = uint32(_u("flowHorizon"));
        c.flags = (quoteIsZero ? PoolFlags.QUOTE_IS_0 : 0)
            | (vm.parseJsonBool(cfg, ".pool.itmAccounting") ? PoolFlags.ITM_ACCOUNTING : 0)
            | (vm.keyExistsJson(cfg, ".pool.lease") ? PoolFlags.LICENCE : 0);
        c.tauBps = uint16(_u("tauBps"));
        c.referenceFeed = vm.parseJsonAddress(cfg, ".referenceFeed");
        c.referenceMaxAge = uint32(vm.parseJsonUint(cfg, ".referenceMaxAge"));
        c.deltaBps = uint16(_u("deltaBps"));
        c.deltaMaxBps = uint16(_u("deltaMaxBps"));
        c.betaX100 = uint16(_u("betaX100"));
        c.deltaClosedBps = uint16(_u("deltaClosedBps"));
        c.maxConfBps = uint16(_u("maxConfBps"));
        c.bandBps = uint16(_u("bandBps"));
        c.basePriceId = vm.parseJsonBytes32(cfg, ".basePriceId");
        c.quotePriceId = vm.parseJsonBytes32(cfg, ".quotePriceId");
        c.settleDelay = uint32(_u("settleDelay"));
        c.maxLag = uint32(_u("maxLag"));
        c.window = uint32(_u("window"));
        c.openDelay = uint32(_u("openDelay"));
        c.maxLagClosed = uint32(_u("maxLagClosed"));
        c.windowClosed = uint32(_u("windowClosed"));
        c.alphaBps = uint16(_u("alphaBps"));
        c.epsBps = uint16(_u("epsBps"));
        c.alphaLicensedBps = uint16(_u("alphaLicensedBps"));
        c.alphaClosedBps = uint16(_u("alphaClosedBps"));
        c.epsClosedBps = uint16(_u("epsClosedBps"));
        c.jumpRefundBps = uint16(_u("jumpRefundBps"));
        c.tipBps = uint16(_u("tipBps"));
        c.rhoBps = uint16(_u("rhoBps"));
        c.kappaBps = uint16(_u("kappaBps"));
        c.vestPeriod = uint32(_u("vestPeriod"));
        c.tipCap = uint128(_u("tipCap"));
        c.maxOutstanding = uint128(_u("maxOutstanding"));
        c.protocolShareBps = uint16(_u("protocolShareBps"));
        c.protocolRecipient = vm.parseJsonAddress(cfg, ".pool.protocolRecipient");
    }

    /// @dev The reference answer in quote base units per risky base unit, times 1e36, as ReferenceLib scales it.
    function _referencePriceX36(uint8 decRisky, uint8 decQuote) internal view returns (uint256) {
        AggregatorV3Interface feed = AggregatorV3Interface(vm.parseJsonAddress(cfg, ".referenceFeed"));
        (, int256 answer,,,) = feed.latestRoundData();
        if (answer <= 0) revert CreatePool__BadReference(answer);
        uint256 k = 36 + uint256(decQuote) - uint256(decRisky) - uint256(feed.decimals());
        return uint256(answer) * 10 ** k;
    }

    function _decimals(address token) internal view returns (uint8) {
        if (token == address(0)) return 18;
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert CreatePool__NoDecimals(token);
        return abi.decode(ret, (uint8));
    }

    function _u(string memory field) internal view returns (uint256) {
        return vm.parseJsonUint(cfg, string.concat(".pool.", field));
    }
}
