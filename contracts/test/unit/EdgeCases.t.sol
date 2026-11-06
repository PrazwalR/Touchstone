// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IALFHook} from "../../src/interfaces/IALFHook.sol";
import {IRebateLedger} from "../../src/interfaces/IRebateLedger.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {BlockLib} from "../../src/libraries/BlockLib.sol";
import {DepositQuote} from "../../src/types/DepositQuote.sol";
import {Guard} from "../../src/types/Guard.sol";
import {Lease} from "../../src/types/Lease.sol";
import {Payout} from "../../src/types/Payout.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {Record} from "../../src/types/Record.sol";
import {MockArbSys} from "../mocks/MockArbSys.sol";
import {MockReentrantToken} from "../mocks/MockReentrantToken.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";
import {LicenceBase} from "./Licence.t.sol";
import {SettlementBase} from "./Settlement.t.sol";

/// @notice Swaps twice inside one transaction, the case the first-touch rule treats as a single touch.
contract DoubleSwapper {
    function approve(MockERC20 token, address spender) external {
        token.approve(spender, type(uint256).max);
    }

    function swapTwice(PoolSwapTest router, PoolKey calldata key, SwapParams calldata p) external {
        router.swap(key, p, PoolSwapTest.TestSettings(false, false), "");
        router.swap(key, p, PoolSwapTest.TestSettings(false, false), "");
    }
}

/// @notice Branches of the swap path, the lens and the Settler that the scenario suites do not reach.
contract SwapEdgeTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function _records() internal view returns (uint64) {
        return hook.poolState(id).nextRecordId;
    }

    function _buyParams(uint256 usd) internal view returns (SwapParams memory) {
        bool zeroForOne = quoteIs0;
        return SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(usd * 10 ** decQuote),
            sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
        });
    }

    /// @dev Spec 7.4: the first touch belongs to the transaction, so a second large swap in it is flagged too,
    /// without consuming the block's touch again.
    function test_FirstTouch_CoversEveryLargeSwapInTheTransaction() public {
        DoubleSwapper d = new DoubleSwapper();
        MockERC20 q = MockERC20(Currency.unwrap(quote));
        q.mint(address(d), 1e12 * 10 ** decQuote);
        d.approve(q, address(swapRouter));
        vm.roll(block.number + 1);
        uint64 before = _records();
        vm.prank(trader, trader);
        d.swapTwice(swapRouter, key, _buyParams(20_000));
        assertEq(_records() - before, 2, "both swaps of the first-touch transaction are flagged");
        assertEq(hook.poolState(id).lastTouchBlock, BlockLib.number(BlockLib.SOURCE_EVM));
        // A later transaction in the same block is no longer the first touch.
        vm.recordLogs();
        _swap(trader, true, true, 20_000 * 10 ** decQuote, "");
        assertEq(_records() - before, 2, "the block's touch is used up");
    }

    /// @dev Spec 7.4: sustained small flow trips the leaky bucket even though no single swap is large.
    function test_Flow_TripsOnManySmallSwaps() public {
        uint64 before = _records();
        for (uint256 i; i < 21; ++i) {
            _swap(trader, true, true, 4_900 * 10 ** decQuote, "");
        }
        assertGt(_records(), before, "flow over nMin within the horizon is flagged");
    }

    /// @dev URC-4: hookData must be empty or clean address words, on the swap path as in quotes.
    function test_Swap_RejectsDirtyHookData() public {
        vm.prank(trader, trader);
        vm.expectRevert();
        swapRouter.swap(key, _buyParams(100), PoolSwapTest.TestSettings(false, false), abi.encode(uint256(1) << 200));
        _swap(trader, true, true, 100 * 10 ** decQuote, abi.encode(trader));
    }

    function test_Quote_ZeroAmountCannotPrice() public view {
        assertEq(IALFHook(address(hook)).getIndicativeQuote(key, quoteIs0, 0, ""), 0);
    }

    function test_Quote_RejectsADirtySecondHookDataWord() public {
        vm.expectRevert(IALFHook.MalformedHookData.selector);
        IALFHook(address(hook)).getIndicativeQuote(key, quoteIs0, -1e6, abi.encode(trader, uint256(1) << 200));
    }

    /// @dev An exact-output quote adds the deposit to the input, and that is what the flagged swap pays.
    function test_Quote_ExactOutputFlaggedAddsTheDeposit() public {
        vm.roll(block.number + 1);
        bool zeroForOne = quoteIs0;
        int256 riskyOut = int256(20 * 10 ** decRisky);
        (uint256 qIn,) =
            IALFHook(address(hook)).swapToPrice(key, zeroForOne, riskyOut, zeroForOne ? MIN_LIMIT : MAX_LIMIT, "");
        uint256 before = _balance(quote, trader);
        vm.recordLogs();
        _swap(trader, true, false, uint256(riskyOut), "");
        (, bool found) = _lastRecord();
        assertTrue(found, "the swap is flagged");
        assertEq(before - _balance(quote, trader), qIn, "paid in equals the quote, deposit included");
    }

    function test_Drip_WithNothingVestingDoesNothing() public {
        (uint256 a0, uint256 a1) = hook.drip(key);
        assertEq(a0 + a1, 0);
    }

    function test_Finalize_RejectsARecordAlreadyClosed() public {
        Record memory r = _flag(50_000, true, "");
        Payout memory p = _settleAt(r, int64(int256(ETH_USD * 1e8)), 0);
        vm.prank(address(settler));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RecordClosed.selector, id, r.id));
        hook.finalize(r, p, false);
    }

    /// @dev A caller that cannot take back its excess Pyth fee makes the settlement revert, not lose the ether.
    function test_Settle_RevertsWhenTheExcessFeeCannotBeReturned() public {
        Record memory r = _flag(50_000, true, "");
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _update(ETH_USD, t0, t0 - 1, 0);
        address noReceive = address(feed);
        vm.deal(noReceive, 1 ether);
        vm.prank(noReceive, noReceive);
        vm.expectRevert(ITouchstoneErrors.Touchstone__FeeRefundFailed.selector);
        settler.settle{value: 1 ether}(r, u);
    }

    function test_Settle_RejectsANonPositivePrice() public {
        Record memory r = _flag(50_000, true, "");
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(-1, t0, t0 - 1, 0);
        vm.prank(keeper, keeper);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NonPositivePrice.selector);
        settler.settle(r, u);
    }

    /// @dev On Arbitrum the first-touch rule counts L2 blocks from ArbSys, not the L1-based block.number.
    function test_ArbSysBlockSource_FirstTouchUsesTheL2Block() public {
        vm.etch(address(100), address(new MockArbSys()).code);
        MockArbSys(address(100)).setBlock(777);
        deployCodeTo(
            "TouchstoneHook.sol:TouchstoneHook",
            hookArgsWith(address(trustedRouter), BlockLib.SOURCE_ARBSYS, address(0)),
            address(hook)
        );
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).lastTouchBlock, 777);
    }

    function test_Ledger_RejectsACreditItDoesNotHold() public {
        vm.prank(address(hook));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__LedgerShortfall.selector, 0, 1));
        ledger.credit(trader, quote, 1, IRebateLedger.Kind.REBATE);
    }
}

/// @notice The drift trigger reads the reference only when it is trustworthy (spec 7.6): every unusable reading
/// leaves the gap unknown, so a large swap that is not the block's first touch is not flagged on drift.
contract ReferenceEdgeTest is SettlementBase {
    uint256 internal constant LARGE = 10_000;

    function setUp() public {
        _setUp(18, 6);
        // The reference sits 3% above the pool, so a small buy moves toward it: drift.
        feed.set(int256(ETH_USD * 103 / 100 * 1e8), block.timestamp);
    }

    /// @dev Spends the block's first touch with one large buy, then reports whether a second large buy toward the
    /// reference, which only drift can flag, is flagged; preview and execution must agree.
    function _flagsOnDrift() internal returns (bool) {
        vm.roll(block.number + 1);
        _swap(trader, true, true, 6_000 * 10 ** decQuote, "");
        DepositQuote memory q = hook.previewDeposit(key, quoteIs0, LARGE * 10 ** decQuote, address(0));
        uint64 before = hook.poolState(id).nextRecordId;
        _swap(trader, true, true, LARGE * 10 ** decQuote, "");
        bool flagged = hook.poolState(id).nextRecordId > before;
        assertEq(q.flaggedNow, flagged, "preview and execution agree");
        return flagged;
    }

    function test_Drift_FlagsAgainstAUsableReference() public {
        assertTrue(_flagsOnDrift());
    }

    function test_Drift_IgnoresANonPositiveAnswer() public {
        feed.set(0, block.timestamp);
        assertFalse(_flagsOnDrift());
    }

    function test_Drift_IgnoresAFutureTimestamp() public {
        feed.set(int256(ETH_USD * 103 / 100 * 1e8), block.timestamp + 1);
        assertFalse(_flagsOnDrift());
    }

    function test_Drift_IgnoresAStaleAnswer() public {
        feed.set(int256(ETH_USD * 103 / 100 * 1e8), block.timestamp - defaultConfig().referenceMaxAge - 1);
        assertFalse(_flagsOnDrift());
    }

    function test_Drift_IgnoresAFeedThatReverts() public {
        feed.setReverts(true);
        assertFalse(_flagsOnDrift());
    }

    /// @dev Decimals that would need a power of ten past the library's bound, either way, read as unusable.
    function test_Drift_IgnoresUnscalableDecimals() public {
        vm.store(address(feed), bytes32(0), bytes32(uint256(77)));
        assertFalse(_flagsOnDrift());
        vm.store(address(feed), bytes32(0), bytes32(uint256(0)));
        feed.set(type(int256).max, block.timestamp);
        assertFalse(_flagsOnDrift());
    }

    /// @dev Spec 7.6: on an L2 with a sequencer feed, a down or just-restarted sequencer leaves the gap unknown.
    function test_Drift_IgnoresTheReferenceWhileTheSequencerIsDown() public {
        MockV3Aggregator sequencer = new MockV3Aggregator(0, 1);
        deployCodeTo(
            "TouchstoneHook.sol:TouchstoneHook",
            hookArgsWith(address(trustedRouter), BlockLib.SOURCE_EVM, address(sequencer)),
            address(hook)
        );
        assertFalse(_flagsOnDrift(), "answer 1 is down");
        sequencer.set(0, 0);
        assertFalse(_flagsOnDrift(), "no start time reads as down");
        sequencer.set(0, block.timestamp);
        assertTrue(_flagsOnDrift(), "up");
    }
}

/// @notice A pool whose budget for outstanding deposits is nearly full posts no new deposit (spec 14).
contract BudgetEdgeTest is SettlementBase {
    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.maxOutstanding = uint128(10 ** decQuote);
    }

    function setUp() public {
        _setUp(18, 6);
    }

    function test_Budget_LargeSwapPostsNoDepositOnceTheBudgetIsFull() public {
        vm.roll(block.number + 1);
        DepositQuote memory q = hook.previewDeposit(key, quoteIs0, 50_000 * 10 ** decQuote, address(0));
        assertGt(q.triggers, 0, "the swap would trigger");
        assertFalse(q.flaggedNow, "but the deposit does not fit the budget");
        uint64 before = hook.poolState(id).nextRecordId;
        _buy(trader, 50_000);
        assertEq(hook.poolState(id).nextRecordId, before);
    }
}

/// @notice Without in-the-money accounting, the markout is taken over the whole swap.
contract NoItmSettlementTest is SettlementBase {
    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.flags &= ~PoolFlags.ITM_ACCOUNTING;
    }

    function setUp() public {
        _setUp(18, 6);
    }

    function test_Settle_WholeSwapMarkoutRetainsOnArbitrage() public {
        Record memory r = _flag(500_000, true, "");
        Payout memory p = _settleAt(r, int64(int256(3_300 * 1e8)), 0);
        uint256 retained = uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs;
        assertGt(retained, 0, "an arbitrage against a 10% move retains value");
        assertEq(p.refund + retained, r.deposit, "conserves");
    }
}

/// @notice Auction and licence branches outside the main licence scenarios.
contract LicenceEdgeTest is LicenceBase {
    function setUp() public {
        _setUpLicence();
    }

    function test_Register_RejectsASecondRegistration() public {
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__AlreadyRegistered.selector, id));
        licence.register(key, defaultLease());
    }

    function test_UnregisteredPool_ReadsEmptyAndRejectsBids() public {
        PoolId other = PoolId.wrap(bytes32(uint256(1)));
        (address swapper, bool live) = licence.holderOf(other);
        assertEq(swapper, address(0));
        assertFalse(live);
        (Lease memory top, Lease memory next) = licence.leases(other);
        assertEq(top.owner, address(0));
        assertEq(next.owner, address(0));
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__PoolNotRegistered.selector, other));
        licence.bid(other, holder, 1, 60);
    }

    /// @dev The exemption follows the address a trusted router reports; any other router names itself.
    function test_FastPath_UntrustedRouterIsNeverExempt() public {
        _lease(holder, 10, 10 * K * 10);
        vm.roll(block.number + 1);
        uint64 before = hook.poolState(id).nextRecordId;
        _swap(holder, true, true, 20_000 * 10 ** decQuote, "");
        assertEq(hook.poolState(id).nextRecordId - before, 1, "flagged like any outsider");
    }

    /// @dev A trusted router that cannot say who swapped is treated as the swapper itself.
    function test_FastPath_RouterThatCannotReportIsNotExempt() public {
        _lease(holder, 10, 10 * K * 10);
        vm.roll(block.number + 1);
        vm.mockCallRevert(address(trustedRouter), abi.encodeWithSignature("msgSender()"), "");
        uint64 before = hook.poolState(id).nextRecordId;
        _swapVia(PoolSwapTest(address(trustedRouter)), trader, true, true, 20_000 * 10 ** decQuote, "");
        assertEq(hook.poolState(id).nextRecordId - before, 1);
    }

    /// @dev I11: once the holder used the block's exempt swap, a preview for it in the same block is not exempt.
    function test_Preview_HolderExemptOncePerBlock() public {
        _lease(holder, 10, 10 * K * 10);
        vm.roll(block.number + 1);
        uint256 notional = 20_000 * 10 ** decQuote;
        assertTrue(hook.previewDeposit(key, quoteIs0, notional, holder).exempt, "first large swap of the block");
        _swapAs(holder, true, 20_000);
        assertFalse(hook.previewDeposit(key, quoteIs0, notional, holder).exempt, "the block's exemption is used");
    }
}

/// @notice Rent on a pool whose quote is currency1, with a protocol share (spec 10.5).
contract LicenceRentCurrency1Test is LicenceBase {
    address internal protocol = makeAddr("protocol");

    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.protocolShareBps = 1_000;
        c.protocolRecipient = protocol;
    }

    function setUp() public {
        // Native ETH as the risky token makes it currency0, so the quote is currency1.
        _setUp(0, 6);
        MockERC20(Currency.unwrap(quote)).mint(holder, 1e12 * 10 ** decQuote);
        vm.prank(holder);
        MockERC20(Currency.unwrap(quote)).approve(address(licence), type(uint256).max);
    }

    function test_Rent_SplitsIntoCurrency1AndPaysTheProtocolShare() public {
        assertFalse(quoteIs0);
        _lease(holder, 100, 100 * 3_600);
        vm.warp(vm.getBlockTimestamp() + 1_000);
        PoolState memory before = hook.poolState(id);
        uint256 charged = licence.accrue(id);
        assertGt(charged, 0);
        PoolState memory afterState = hook.poolState(id);
        uint256 toProtocol = charged * 1_000 / 10_000;
        assertEq(ledger.owed(protocol, quote), toProtocol, "the protocol share is credited in the ledger");
        assertEq(
            (afterState.rebatePool1 - before.rebatePool1) + (afterState.vest1 - before.vest1),
            charged - toProtocol,
            "the rest reaches currency1's rebate pool and vesting"
        );
        assertEq(afterState.rebatePool0 + afterState.vest0, before.rebatePool0 + before.vest0);
    }
}

/// @notice GuardedRouter returns unused native ETH, and a caller that cannot take it back gets a revert.
contract NativeRouterEdgeTest is SettlementBase {
    function setUp() public {
        _setUp(0, 6);
    }

    function test_Router_RevertsWhenUnusedEtherCannotBeReturned() public {
        address noReceive = address(feed);
        vm.deal(noReceive, 10 ether);
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: MIN_LIMIT});
        Guard memory g =
            Guard({maxDeposit: type(uint256).max, minNetOut: 1, minGrossOut: 1, maxNetIn: type(uint256).max});
        vm.prank(noReceive, noReceive);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NativeRefundFailed.selector);
        guardedRouter.swapGuarded{value: 2 ether}(key, p, g, address(0), block.timestamp);
    }
}

/// @notice The auction's lock stops a token from re-entering it in the middle of a deposit transfer.
contract LicenceReentrancyTest is LicenceBase {
    function setUp() public {
        _setUpLicence();
    }

    function test_Bid_ATokenCannotReenterTheAuction() public {
        MockReentrantToken token = new MockReentrantToken();
        bool tokenIs0 = address(token) < Currency.unwrap(risky);
        PoolKey memory k = PoolKey({
            currency0: tokenIs0 ? Currency.wrap(address(token)) : risky,
            currency1: tokenIs0 ? risky : Currency.wrap(address(token)),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        PoolConfig memory c = defaultConfig();
        c.flags = (tokenIs0 ? PoolFlags.QUOTE_IS_0 : 0) | PoolFlags.ITM_ACCOUNTING | PoolFlags.LICENCE;
        factory.createPool(k, c, defaultLease(), _sqrtPriceAt(ETH_USD));
        PoolId other = k.toId();

        token.mint(holder, 1e12);
        vm.prank(holder);
        token.approve(address(licence), type(uint256).max);
        token.arm(address(licence), abi.encodeCall(licence.bid, (other, holder, 20, 20 * K)));
        vm.prank(holder);
        licence.bid(other, holder, 10, 10 * K);
        assertEq(bytes4(token.lastRevert()), ITouchstoneErrors.Touchstone__Reentrant.selector);
        (, Lease memory next) = licence.leases(other);
        assertEq(next.rent, 10, "only the outer bid stands");
    }
}

/// @notice The view swap loop at the edges Pool.swap guards: price-range ends and a 100% fee.
contract StaticQuoteEdgeTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function _pool(uint24 fee, int24 spacing) internal returns (PoolKey memory k) {
        k = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: fee, tickSpacing: spacing, hooks: key.hooks
        });
        factory.createPool(k, defaultConfig(), noLease(), _sqrtPriceAt(ETH_USD));
    }

    /// @dev With the widest tick spacing, the next tick within a bitmap word lies past MIN_TICK or MAX_TICK, so the
    /// loop must clamp it as Pool.swap does; without the clamp the price lookup would revert with InvalidTick.
    function test_Quote_ClampsTheNextTickToThePriceRange() public {
        PoolKey memory k = _pool(500, 32_767);
        (uint256 inDown, uint256 outDown) = IALFHook(address(hook)).swapToPrice(k, true, -1e6, MIN_LIMIT, "");
        (uint256 inUp, uint256 outUp) = IALFHook(address(hook)).swapToPrice(k, false, -1e6, MAX_LIMIT, "");
        assertEq(inDown + outDown + inUp + outUp, 0, "no liquidity: the whole range is crossed for nothing");
    }

    /// @dev Pool.swap reverts on exact output with a 100% fee; the quote reports that it cannot price instead.
    function test_Quote_ExactOutputAtAFullFeeCannotPrice() public {
        PoolKey memory k = _pool(1_000_000, 60);
        (uint256 amountIn, uint256 amountOut) = IALFHook(address(hook)).swapToPrice(k, true, 1e6, MIN_LIMIT, "");
        assertEq(amountIn + amountOut, 0);
    }
}
