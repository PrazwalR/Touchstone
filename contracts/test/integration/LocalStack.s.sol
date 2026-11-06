// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {CoreDeployer} from "../../script/base/CoreDeployer.sol";
import {TouchstoneFactory} from "../../src/TouchstoneFactory.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {BlockLib} from "../../src/libraries/BlockLib.sol";
import {MockPythUnique} from "../mocks/MockPythUnique.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";

/// @notice A complete local Touchstone deployment on anvil, with mock oracles and test tokens, for the keeper's
/// and indexer's end-to-end tests. Not a deploy script: it lives under test/ because it deploys mocks (§0.2).
/// Writes every address to $STACK_OUT, by default test/integration/out/stack.json.
contract LocalStack is CoreDeployer {
    bytes32 internal constant BASE_ID = keccak256("ETH/USD");
    bytes32 internal constant QUOTE_ID = keccak256("USDC/USD");
    // Lease terms of the licence pool: the factory's shortest notice, so the Anvil suites activate a bid quickly.
    uint32 internal constant LEASE_K = 60;
    uint16 internal constant LEASE_MIN_INCREMENT_BPS = 1_000;
    uint128 internal constant LEASE_MIN_RENT = 1;

    function run() external {
        address deployer = msg.sender;
        vm.startBroadcast(deployer);
        IPoolManager manager = new PoolManager(deployer);
        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        MockPythUnique pyth = new MockPythUnique(1);
        MockV3Aggregator feed = new MockV3Aggregator(8, 3_000e8);
        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        vm.stopBroadcast();

        Core memory c = _deployCore(
            deployer,
            CoreParams({
                manager: manager,
                pyth: address(pyth),
                blockSource: BlockLib.SOURCE_EVM,
                sequencerFeed: address(0),
                sequencerGrace: 0,
                trustedRouters: [address(0), address(0), address(0), address(0)],
                maxQuoteTicks: 64
            })
        );

        bool quoteIs0 = address(usdc) < address(weth);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(quoteIs0 ? address(usdc) : address(weth)),
            currency1: Currency.wrap(quoteIs0 ? address(weth) : address(usdc)),
            fee: 500,
            tickSpacing: 60,
            hooks: IHooks(c.hook)
        });

        vm.startBroadcast(deployer);
        TouchstoneFactory(c.factory)
            .createPool(
                key,
                _config(quoteIs0, address(feed)),
                ILicenceAuction.LeaseParams(0, 0, 0),
                PriceLib.sqrtPriceX96At(3_000e6 * 1e36 / 1e18, !quoteIs0)
            );
        // A licence pool beside the plain one, with no liquidity: the Anvil suites use it for bids, accrual and rent
        // delivery, which need no swaps (spec §10, I12).
        PoolKey memory licenceKey = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: 3_000, tickSpacing: 60, hooks: IHooks(c.hook)
        });
        PoolConfig memory licenceCfg = _config(quoteIs0, address(feed));
        licenceCfg.flags |= PoolFlags.LICENCE;
        TouchstoneFactory(c.factory)
            .createPool(
                licenceKey,
                licenceCfg,
                ILicenceAuction.LeaseParams({
                    k: LEASE_K, minIncrementBps: LEASE_MIN_INCREMENT_BPS, minRent: LEASE_MIN_RENT
                }),
                PriceLib.sqrtPriceX96At(3_000e6 * 1e36 / 1e18, !quoteIs0)
            );
        usdc.mint(deployer, 1e15 * 1e6);
        weth.mint(deployer, 1e12 * 1e18);
        usdc.approve(address(lpRouter), type(uint256).max);
        weth.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(swapRouter), type(uint256).max);
        weth.approve(address(swapRouter), type(uint256).max);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 182_574_185_835_055_371, // sqrt(3,333 WETH x 10,000,000 USDC) in base units
                salt: 0
            }),
            ""
        );
        vm.stopBroadcast();

        string memory o = "stack";
        vm.serializeAddress(o, "poolManager", address(manager));
        vm.serializeAddress(o, "swapRouter", address(swapRouter));
        vm.serializeAddress(o, "pyth", address(pyth));
        vm.serializeAddress(o, "feed", address(feed));
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "weth", address(weth));
        vm.serializeAddress(o, "hook", c.hook);
        vm.serializeAddress(o, "settler", c.settler);
        vm.serializeAddress(o, "ledger", c.ledger);
        vm.serializeAddress(o, "factory", c.factory);
        vm.serializeAddress(o, "guardedRouter", c.router);
        vm.serializeAddress(o, "licence", c.licence);
        vm.serializeAddress(o, "lens", c.lens);
        vm.serializeUint(o, "leaseK", LEASE_K);
        vm.serializeBytes32(o, "licencePoolId", PoolId.unwrap(licenceKey.toId()));
        vm.serializeBool(o, "quoteIs0", quoteIs0);
        vm.serializeBytes32(o, "baseId", BASE_ID);
        vm.serializeBytes32(o, "quoteId", QUOTE_ID);
        string memory json = vm.serializeBytes32(o, "poolId", PoolId.unwrap(key.toId()));
        vm.writeJson(json, vm.envOr("STACK_OUT", string("test/integration/out/stack.json")));
    }

    function _config(bool quoteIs0, address feed) internal pure returns (PoolConfig memory c) {
        c.n0 = 5_000e6;
        c.nMin = 100_000e6;
        c.flowHorizon = 12;
        c.flags = (quoteIs0 ? PoolFlags.QUOTE_IS_0 : 0) | PoolFlags.ITM_ACCOUNTING;
        c.tauBps = 5;
        c.referenceFeed = feed;
        c.referenceMaxAge = 3_960;
        c.deltaBps = 30;
        c.deltaMaxBps = 300;
        c.betaX100 = 125;
        c.deltaClosedBps = 300;
        c.maxConfBps = 25;
        c.bandBps = 25;
        c.basePriceId = BASE_ID;
        c.quotePriceId = QUOTE_ID;
        c.settleDelay = 3;
        c.maxLag = 10;
        c.window = 1 hours;
        c.openDelay = 60;
        c.maxLagClosed = 1 hours;
        c.windowClosed = 1 days;
        c.alphaBps = 8_000;
        c.epsBps = 2;
        c.alphaLicensedBps = 9_500;
        c.alphaClosedBps = 5_000;
        c.epsClosedBps = 50;
        c.jumpRefundBps = 2_500;
        c.tipBps = 200;
        c.rhoBps = 1_000;
        c.kappaBps = 4_000;
        c.vestPeriod = 30 minutes;
        c.tipCap = 5e6;
        c.maxOutstanding = 1_000_000e6;
    }
}
