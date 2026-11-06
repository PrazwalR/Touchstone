// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {ISettler} from "../../src/interfaces/ISettler.sol";
import {RebateLedger} from "../../src/RebateLedger.sol";
import {TouchstoneFactory} from "../../src/TouchstoneFactory.sol";
import {LicenceAuction} from "../../src/LicenceAuction.sol";
import {TouchstoneLens} from "../../src/periphery/TouchstoneLens.sol";
import {ITouchstoneFactory} from "../../src/interfaces/ITouchstoneFactory.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {ITouchstoneHook} from "../../src/interfaces/ITouchstoneHook.sol";
import {ITouchstoneEvents} from "../../src/interfaces/ITouchstoneEvents.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {Record} from "../../src/types/Record.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {BlockLib} from "../../src/libraries/BlockLib.sol";
import {MockPythUnique} from "../mocks/MockPythUnique.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {MockTrustedRouter} from "../mocks/MockTrustedRouter.sol";
import {GuardedRouter} from "../../src/periphery/GuardedRouter.sol";

/// @notice Deploys a real v4 PoolManager, the Touchstone contracts and one ETH/USDC-style pool.
/// @dev The hook is placed with deployCodeTo at an address whose low 14 bits are exactly 0x20C4, which
/// is what MineHookAddress produces on a live chain.
/// @notice The hook's surface as tests see it; tests never import the hook's source, because it compiles
/// under its own compiler profile (decision 0028).
interface IHookUnderTest is ITouchstoneHook {
    function getHookPermissions() external pure returns (Hooks.Permissions memory);
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

abstract contract TouchstoneFixture is Test, ITouchstoneEvents {
    using StateLibrary for IPoolManager;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    bytes32 internal constant BASE_ID = keccak256("ETH/USD");
    bytes32 internal constant QUOTE_ID = keccak256("USDC/USD");
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 60;
    /// @dev Full-range depth: about 3,333 risky and 10,000,000 quote, whatever the decimals.
    uint256 internal constant DEPTH_RISKY = 3_333;
    uint256 internal constant DEPTH_QUOTE = 10_000_000;
    uint256 internal constant ETH_USD = 3_000;
    uint160 internal constant MIN_LIMIT = TickMath.MIN_SQRT_PRICE + 1;
    uint160 internal constant MAX_LIMIT = TickMath.MAX_SQRT_PRICE - 1;

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal lpRouter;
    MockTrustedRouter internal trustedRouter;
    GuardedRouter internal guardedRouter;
    MockPythUnique internal pyth;
    MockV3Aggregator internal feed;

    IHookUnderTest internal hook;
    ISettler internal settler;
    RebateLedger internal ledger;
    TouchstoneFactory internal factory;
    LicenceAuction internal licence;
    TouchstoneLens internal lens;

    Currency internal risky;
    Currency internal quote;
    uint8 internal decRisky;
    uint8 internal decQuote;
    PoolKey internal key;
    PoolId internal id;
    bool internal quoteIs0;

    address internal trader = makeAddr("trader");
    address internal keeper = makeAddr("keeper");

    /// @dev Routers return unused native ETH to the caller.
    receive() external payable {}

    function _deployCore() internal {
        // Sunday 25 October 2026, 12:00 UTC; tests start from a realistic clock, not timestamp 1.
        vm.warp(1_792_929_600);
        manager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);
        trustedRouter = new MockTrustedRouter(manager);
        pyth = new MockPythUnique(0);
        feed = new MockV3Aggregator(8, int256(ETH_USD * 1e8));

        address hookAddr = address(HOOK_FLAGS | (uint160(0x4444) << 144));
        ledger = new RebateLedger(manager, hookAddr);
        // The factory and the auction each name the other, so the auction's address is predicted from the nonce.
        address licenceAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new TouchstoneFactory(manager, ITouchstoneHook(hookAddr), ILicenceAuction(licenceAddr));
        licence = new LicenceAuction(manager, ITouchstoneHook(hookAddr), address(factory));
        assertEq(address(licence), licenceAddr, "auction address prediction");
        lens = new TouchstoneLens(manager, ITouchstoneHook(hookAddr), ITouchstoneFactory(address(factory)), 64);
        settler = ISettler(deployCode("Settler.sol:Settler", abi.encode(address(pyth), hookAddr, address(factory))));
        guardedRouter = new GuardedRouter(manager, ITouchstoneHook(hookAddr));
        deployCodeTo("TouchstoneHook.sol:TouchstoneHook", hookArgs(address(trustedRouter)), hookAddr);
        hook = IHookUnderTest(hookAddr);
    }

    /// @notice Constructor arguments of the hook: the manager and its Deployment struct.
    function hookArgs(address router) internal view returns (bytes memory) {
        return hookArgsWith(router, BlockLib.SOURCE_EVM, address(0));
    }

    /// @notice Constructor arguments with a chosen block source and sequencer feed.
    function hookArgsWith(address router, uint8 blockSource, address sequencerFeed)
        internal
        view
        returns (bytes memory)
    {
        address[4] memory routers = [router, address(guardedRouter), address(0), address(0)];
        return abi.encode(
            manager,
            address(settler),
            address(ledger),
            address(factory),
            address(licence),
            address(lens),
            blockSource,
            sequencerFeed,
            uint32(0),
            routers
        );
    }

    /// @notice Deploys tokens and creates the pool. riskyDecimals 0 means native ETH.
    function _setUp(uint8 riskyDecimals, uint8 quoteDecimals) internal {
        _deployCore();
        decQuote = quoteDecimals;
        quote = Currency.wrap(address(new MockERC20("Quote", "Q", quoteDecimals)));
        if (riskyDecimals == 0) {
            decRisky = 18;
            risky = Currency.wrap(address(0));
        } else {
            decRisky = riskyDecimals;
            risky = Currency.wrap(address(new MockERC20("Risky", "R", riskyDecimals)));
        }
        quoteIs0 = Currency.unwrap(quote) < Currency.unwrap(risky);
        (Currency c0, Currency c1) = quoteIs0 ? (quote, risky) : (risky, quote);
        key = PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
        id = key.toId();

        _fund(address(this));
        _fund(trader);
        factory.createPool(key, defaultConfig(), defaultLease(), _sqrtPriceAt(ETH_USD));
        _addLiquidity(key, liquidity());
    }

    /// @notice Lease terms for a pool without the licence; createPool reads them only when LICENCE is set.
    function noLease() internal pure returns (ILicenceAuction.LeaseParams memory) {}

    /// @notice Lease terms of the fixture's pool; licence suites override this together with defaultConfig.
    function defaultLease() internal view virtual returns (ILicenceAuction.LeaseParams memory) {
        return noLease();
    }

    /// @notice Full-range liquidity L = sqrt(x * y) for the depth constants above.
    function liquidity() internal view returns (uint128) {
        return uint128(Math.sqrt(DEPTH_RISKY * 10 ** decRisky * DEPTH_QUOTE * 10 ** decQuote));
    }

    function defaultConfig() internal view virtual returns (PoolConfig memory c) {
        c.n0 = uint96(5_000 * 10 ** decQuote);
        c.nMin = uint96(100_000 * 10 ** decQuote);
        c.flowHorizon = 12;
        c.flags = (quoteIs0 ? PoolFlags.QUOTE_IS_0 : 0) | PoolFlags.ITM_ACCOUNTING;
        c.tauBps = 5;
        c.referenceFeed = address(feed);
        c.referenceMaxAge = 3_600;
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
        c.window = 1 days;
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
        c.tipCap = uint128(5 * 10 ** decQuote);
        c.maxOutstanding = uint128(1_000_000 * 10 ** decQuote);
    }

    // --- helpers ------------------------------------------------------------------------------

    function _fund(address who) internal {
        uint256 amountQ = 1e12 * 10 ** decQuote;
        MockERC20(Currency.unwrap(quote)).mint(who, amountQ);
        if (risky.isAddressZero()) {
            vm.deal(who, 1e9 ether);
        } else {
            MockERC20(Currency.unwrap(risky)).mint(who, 1e9 * 10 ** decRisky);
        }
        vm.startPrank(who);
        _approveAll(quote);
        if (!risky.isAddressZero()) _approveAll(risky);
        vm.stopPrank();
    }

    function _approveAll(Currency c) private {
        MockERC20 t = MockERC20(Currency.unwrap(c));
        t.approve(address(swapRouter), type(uint256).max);
        t.approve(address(lpRouter), type(uint256).max);
        t.approve(address(trustedRouter), type(uint256).max);
        t.approve(address(guardedRouter), type(uint256).max);
    }

    function _priceX36(uint256 usd) internal view returns (uint256) {
        return usd * 10 ** decQuote * 1e36 / 10 ** decRisky;
    }

    function _sqrtPriceAt(uint256 usd) internal view returns (uint160) {
        return PriceLib.sqrtPriceX96At(_priceX36(usd), !quoteIs0);
    }

    function _addLiquidity(PoolKey memory k, uint128 amount) internal {
        int24 lower = TickMath.minUsableTick(TICK_SPACING);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING);
        uint256 value = k.currency0.isAddressZero() ? 1e8 ether : 0;
        lpRouter.modifyLiquidity{value: value}(
            k,
            ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(amount)), salt: 0
            }),
            ""
        );
    }

    /// @notice Swap through PoolSwapTest as `who`. buyRisky picks the direction; amount is the
    /// specified amount in base units (positive), exactIn picks its sign.
    function _swap(address who, bool buyRisky, bool exactIn, uint256 amount, bytes memory hookData)
        internal
        returns (BalanceDelta delta)
    {
        return _swapVia(swapRouter, who, buyRisky, exactIn, amount, hookData);
    }

    function _swapVia(
        PoolSwapTest router,
        address who,
        bool buyRisky,
        bool exactIn,
        uint256 amount,
        bytes memory hookData
    ) internal returns (BalanceDelta delta) {
        bool zeroForOne = buyRisky == quoteIs0;
        SwapParams memory p = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: exactIn ? -int256(amount) : int256(amount),
            sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
        });
        uint256 value = (zeroForOne && key.currency0.isAddressZero()) ? 1e6 ether : 0;
        vm.prank(who, who);
        delta = router.swap{value: value}(key, p, PoolSwapTest.TestSettings(false, false), hookData);
    }

    /// @notice Buy risky for `usd` dollars of quote, exact input.
    function _buy(address who, uint256 usd) internal returns (BalanceDelta) {
        return _swap(who, true, true, usd * 10 ** decQuote, "");
    }

    function _balance(Currency c, address who) internal view returns (uint256) {
        return c.balanceOf(who);
    }

    /// @notice Captures the record from the last DepositTaken log.
    function _lastRecord() internal view returns (Record memory r, bool found) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = DepositTaken.selector;
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].topics[0] == topic && logs[i - 1].emitter == address(hook)) {
                r = abi.decode(logs[i - 1].data, (Record));
                return (r, true);
            }
        }
    }

    /// @notice A Pyth update pair published at `t` whose previous update was before `prev`.
    function _update(uint256 usd, uint64 t, uint64 prev, uint64 conf) internal view returns (bytes[] memory u) {
        u = new bytes[](2);
        u[0] = pyth.encode(BASE_ID, int64(int256(usd * 1e8)), conf, -8, t, prev);
        u[1] = pyth.encode(QUOTE_ID, 1e8, 0, -8, t, prev);
    }

    /// @notice A Pyth update pair with the base price given in 1e-8 dollars.
    function _updateRaw(int64 basePrice, uint64 t, uint64 prev, uint64 conf) internal view returns (bytes[] memory u) {
        u = new bytes[](2);
        u[0] = pyth.encode(BASE_ID, basePrice, conf, -8, t, prev);
        u[1] = pyth.encode(QUOTE_ID, 1e8, 0, -8, t, prev);
    }

    function _poolSqrtPrice() internal view returns (uint160 s) {
        (s,,,) = manager.getSlot0(id);
    }
}
