// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythErrors} from "@pythnetwork/pyth-sdk-solidity/PythErrors.sol";
import {ISettler} from "../../src/interfaces/ISettler.sol";
import {ITouchstoneHook} from "../../src/interfaces/ITouchstoneHook.sol";
import {RebateLedger} from "../../src/RebateLedger.sol";
import {TouchstoneFactory} from "../../src/TouchstoneFactory.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {LicenceAuction} from "../../src/LicenceAuction.sol";
import {ITouchstoneFactory} from "../../src/interfaces/ITouchstoneFactory.sol";
import {TouchstoneLens} from "../../src/periphery/TouchstoneLens.sol";
import {PoolConfig} from "../../src/types/PoolConfig.sol";
import {Payout} from "../../src/types/Payout.sol";
import {Record} from "../../src/types/Record.sol";
import {IHookUnderTest, TouchstoneFixture} from "../utils/TouchstoneFixture.sol";

/// @notice The settlement path against the real Uniswap v4 PoolManager, the real Pyth contract and the real
/// Chainlink ETH/USD feed on Arbitrum Sepolia, with real Hermes updates recorded in
/// test/fixtures/hermes/arbitrum-sepolia-323745826.json (audit ORC-5: T1 had only been tested against
/// MockPythUnique). Skipped when ARBITRUM_SEPOLIA_RPC_URL is not set.
/// @dev Addresses were checked on chain on 28 October 2026: PoolManager from Uniswap's v4 deployments page,
/// Pyth `version()` 1.4.6 from Pyth's EVM address page, the Chainlink proxy's `description()` "ETH / USD".
/// Foundry has no ArbSys precompile, so the fork uses the EVM block source.
contract ArbitrumSepoliaForkTest is TouchstoneFixture {
    IPoolManager internal constant POOL_MANAGER = IPoolManager(0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317);
    IPyth internal constant PYTH = IPyth(0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF);
    address internal constant CHAINLINK_ETH_USD = 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165;
    string internal constant FIXTURE = "test/fixtures/hermes/arbitrum-sepolia-323745826.json";

    string internal fixture;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARBITRUM_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        // forge-lint: disable-next-line(unsafe-cheatcode)
        fixture = vm.readFile(FIXTURE);
        vm.createSelectFork(rpc, vm.parseJsonUint(fixture, ".forkBlock"));
        forked = true;

        manager = POOL_MANAGER;
        swapRouter = new PoolSwapTest(manager);
        lpRouter = new PoolModifyLiquidityTest(manager);
        address hookAddr = address(HOOK_FLAGS | (uint160(0x7777) << 144));
        ledger = new RebateLedger(manager, hookAddr);
        address licenceAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new TouchstoneFactory(manager, ITouchstoneHook(hookAddr), ILicenceAuction(licenceAddr));
        licence = new LicenceAuction(manager, ITouchstoneHook(hookAddr), address(factory));
        lens = new TouchstoneLens(manager, ITouchstoneHook(hookAddr), ITouchstoneFactory(address(factory)), 64);
        settler = ISettler(deployCode("Settler.sol:Settler", abi.encode(address(PYTH), hookAddr, address(factory))));
        deployCodeTo("TouchstoneHook.sol:TouchstoneHook", hookArgs(address(0)), hookAddr);
        hook = IHookUnderTest(hookAddr);

        decQuote = 6;
        decRisky = 18;
        quote = Currency.wrap(address(new MockERC20("Quote", "Q", 6)));
        risky = Currency.wrap(address(new MockERC20("Risky", "R", 18)));
        quoteIs0 = Currency.unwrap(quote) < Currency.unwrap(risky);
        (Currency c0, Currency c1) = quoteIs0 ? (quote, risky) : (risky, quote);
        key = PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(hookAddr)});
        id = key.toId();
        _fund(address(this));
        _fund(trader);

        PoolConfig memory c = defaultConfig();
        c.referenceFeed = CHAINLINK_ETH_USD;
        c.referenceMaxAge = 90_000;
        c.basePriceId = vm.parseJsonBytes32(fixture, ".feeds.ethUsd.id");
        c.quotePriceId = vm.parseJsonBytes32(fixture, ".feeds.usdcUsd.id");
        factory.createPool(key, c, noLease(), _sqrtPriceAt(2_332));
        _addLiquidity(key, liquidity());
    }

    function _updates(string memory which) internal view returns (bytes[] memory u) {
        u = new bytes[](2);
        u[0] = vm.parseJsonBytes(fixture, string.concat(".feeds.ethUsd.", which, ".data"));
        u[1] = vm.parseJsonBytes(fixture, string.concat(".feeds.usdcUsd.", which, ".data"));
    }

    function _record() internal returns (Record memory r) {
        vm.recordLogs();
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        bool found;
        (r, found) = _lastRecord();
        assertTrue(found, "a $50,000 first-touch swap is flagged");
        assertEq(uint256(r.timestamp) + 3, vm.parseJsonUint(fixture, ".t0"), "fixture t0 matches the record");
    }

    function test_Fork_SettlesAgainstTheFirstRealUpdateAndRejectsTheNext() public {
        if (!forked) vm.skip(true);
        Record memory r = _record();
        vm.warp(uint256(r.timestamp) + 3);

        bytes[] memory next = _updates("next");
        uint256 fee = PYTH.getUpdateFee(next);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper, keeper);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        settler.settle{value: fee}(r, next);

        bytes[] memory first = _updates("first");
        fee = PYTH.getUpdateFee(first);
        vm.prank(keeper, keeper);
        Payout memory p = settler.settle{value: fee}(r, first);
        assertEq(hook.recordHash(id, r.id), bytes32(0), "record closed");
        if (p.benign) assertEq(p.refund, r.deposit, "benign: full refund");
        else assertEq(uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs, r.deposit, "conserves");
    }

    function test_Fork_MixedFirstAndNextUpdatesAreRejected() public {
        if (!forked) vm.skip(true);
        Record memory r = _record();
        vm.warp(uint256(r.timestamp) + 3);
        bytes[] memory u = new bytes[](2);
        u[0] = vm.parseJsonBytes(fixture, ".feeds.ethUsd.first.data");
        u[1] = vm.parseJsonBytes(fixture, ".feeds.usdcUsd.next.data");
        uint256 fee = PYTH.getUpdateFee(u);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper, keeper);
        vm.expectRevert(PythErrors.PriceFeedNotFoundWithinRange.selector);
        settler.settle{value: fee}(r, u);
    }

    function test_Fork_RealChainlinkFeedReadsWithoutReverting() public {
        if (!forked) vm.skip(true);
        // A large swap reads the real feed through ReferenceLib; whether it is fresh on testnet or not, the
        // swap must go through.
        vm.recordLogs();
        _swap(trader, false, true, 30 * 10 ** decRisky, "");
        (, bool found) = _lastRecord();
        assertTrue(found, "a large first-touch sell is flagged and posts a deposit");
    }
}
