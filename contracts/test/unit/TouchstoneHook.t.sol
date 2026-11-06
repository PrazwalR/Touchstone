// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {CustomRevert} from "v4-core/libraries/CustomRevert.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {Record} from "../../src/types/Record.sol";
import {RecordLib} from "../../src/libraries/RecordLib.sol";

contract TouchstoneHookTest is TouchstoneFixture {
    function setUp() public {
        _setUp(18, 6);
        vm.recordLogs();
    }

    function _abs(int128 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(uint128(x)) : uint256(uint128(-x));
    }

    function _quoteDelta(BalanceDelta d) internal view returns (int128) {
        return quoteIs0 ? d.amount0() : d.amount1();
    }

    function _riskyDelta(BalanceDelta d) internal view returns (int128) {
        return quoteIs0 ? d.amount1() : d.amount0();
    }

    // --- deployment and permissions ------------------------------------------------------------

    function test_Permissions_AddressEndsIn20C4() public view {
        assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, 0x20C4);
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeInitialize && p.beforeSwap && p.afterSwap && p.afterSwapReturnDelta);
        assertFalse(p.beforeAddLiquidity || p.beforeRemoveLiquidity || p.beforeSwapReturnDelta);
    }

    function test_Deploy_RevertsAtWrongAddress() public {
        vm.expectRevert();
        deployCode("TouchstoneHook.sol:TouchstoneHook", hookArgs(address(0)));
    }

    function test_Initialize_RevertsOutsideFactory() public {
        PoolKey memory k = key;
        k.tickSpacing = 10;
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.beforeInitialize.selector,
                abi.encodeWithSelector(ITouchstoneErrors.Touchstone__NotFactory.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        manager.initialize(k, _sqrtPriceAt(ETH_USD));
    }

    function test_Register_OnlyFactory() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotFactory.selector);
        hook.register(key, defaultConfig());
    }

    function test_Register_RejectsDuplicate() public {
        vm.prank(address(factory));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__AlreadyRegistered.selector, id));
        hook.register(key, defaultConfig());
    }

    // --- retail path ---------------------------------------------------------------------------

    function test_Retail_BelowN0_NoDeposit() public {
        BalanceDelta d = _buy(trader, 1_000);
        (uint256 amount,) = hook.lastDeposit(id);
        assertEq(amount, 0);
        (, bool found) = _lastRecord();
        assertFalse(found);
        assertGt(_riskyDelta(d), 0);
    }

    /// @dev I8: an unflagged swap's delta is identical to a hookless twin pool's.
    function test_Retail_MatchesHooklessTwin() public {
        PoolKey memory twin = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        manager.initialize(twin, _sqrtPriceAt(ETH_USD));
        _addLiquidity(twin, liquidity());

        BalanceDelta hooked = _buy(trader, 2_000);
        bool zeroForOne = quoteIs0;
        vm.prank(trader, trader);
        BalanceDelta plain = swapRouter.swap(
            twin,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(2_000 * 10 ** decQuote),
                sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
            }),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        assertEq(BalanceDelta.unwrap(hooked), BalanceDelta.unwrap(plain));
    }

    // --- first touch ---------------------------------------------------------------------------

    function test_FirstTouch_FlagsAndTakesDepositFromSwapper() public {
        uint256 notional = 20_000 * 10 ** decQuote;
        BalanceDelta d = _swap(trader, true, true, notional, "");
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        // Exact input buying risky: the unspecified currency is risky, and D = 30 bps of N at p_exec.
        assertEq(r.depositIn0, !quoteIs0);
        uint256 riskyGross = _abs(quoteIs0 ? r.amount1 : r.amount0);
        // The hook floors the quote deposit before converting it, so the test does too.
        uint256 depositQuote = notional * 30 / 10_000;
        uint256 expected = depositQuote * riskyGross / notional;
        assertEq(r.deposit, expected);
        // The swapper receives the AMM output minus the deposit.
        assertEq(_abs(_riskyDelta(d)), riskyGross - r.deposit);
        assertEq(hook.recordHash(id, r.id), RecordLib.hash(r));
        // lastDeposit is transient and already cleared here; GuardedRouter reads it in-transaction (M7).
        (uint256 last,) = hook.lastDeposit(id);
        assertEq(last, 0);
    }

    function test_Deposit_UnspecifiedCurrency_AllFourCases() public {
        bool[2] memory flags = [true, false];
        for (uint256 i; i < 2; ++i) {
            for (uint256 j; j < 2; ++j) {
                vm.roll(block.number + 1);
                bool buyRisky = flags[i];
                bool exactIn = flags[j];
                uint256 amount = buyRisky == exactIn ? 20_000 * 10 ** decQuote : 7 * 10 ** decRisky;
                _swap(trader, buyRisky, exactIn, amount, "");
                (Record memory r, bool found) = _lastRecord();
                assertTrue(found);
                bool zeroForOne = buyRisky == quoteIs0;
                bool specifiedIs0 = exactIn == zeroForOne;
                assertEq(r.depositIn0, !specifiedIs0, "unspecified currency");
            }
        }
    }

    function test_ExactOutput_DepositRaisesInput() public {
        uint256 out = 7 * 10 ** decRisky;
        BalanceDelta d = _swap(trader, true, false, out, "");
        (Record memory r,) = _lastRecord();
        // Exact output buying risky: the deposit is taken in quote, on top of the AMM input.
        assertEq(r.depositIn0, quoteIs0);
        assertEq(_abs(_quoteDelta(d)), _abs(quoteIs0 ? r.amount0 : r.amount1) + r.deposit);
        assertEq(_abs(_riskyDelta(d)), out);
    }

    function test_Deposit_SignChargesSwapper() public {
        uint256 qBefore = _balance(quote, trader);
        uint256 rBefore = _balance(risky, trader);
        _swap(trader, false, true, 7 * 10 ** decRisky, "");
        (Record memory r,) = _lastRecord();
        // Selling risky exact-in: deposit is in quote, deducted from the output.
        uint256 ammOut = _abs(quoteIs0 ? r.amount0 : r.amount1);
        assertEq(_balance(quote, trader) - qBefore, ammOut - r.deposit);
        assertEq(rBefore - _balance(risky, trader), 7 * 10 ** decRisky);
        assertEq(manager.balanceOf(address(hook), quote.toId()), r.deposit);
    }

    /// @dev With isolate = true each swap below is its own transaction in the same block.
    function test_FirstTouch_LaterTransactionInBlockIsNotFirst() public {
        _buy(trader, 20_000);
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).nextRecordId, 1);
    }

    function test_FirstTouch_BelowN0DoesNotUseStatus() public {
        _buy(trader, 1_000);
        assertEq(hook.poolState(id).lastTouchBlock, 0);
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).lastTouchBlock, block.number);
    }

    function test_FirstTouch_NextBlockFlagsAgain() public {
        _buy(trader, 20_000);
        vm.roll(block.number + 1);
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).nextRecordId, 2);
        assertEq(hook.poolState(id).lastTouchBlock, block.number);
    }

    // --- flow bucket ---------------------------------------------------------------------------

    function test_Drift_BelowThresholdDoesNotFlag() public {
        _buy(trader, 20_000);
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).nextRecordId, 1);
    }

    function test_Flow_SplitBelowN0FillsBucket() public {
        // 25 swaps of $4,000 each, all below N0, inside one second, reach N_min = $100,000.
        for (uint256 i; i < 24; ++i) {
            _buy(trader, 4_000);
        }
        assertEq(hook.poolState(id).nextRecordId, 0);
        _buy(trader, 4_000);
        assertEq(hook.poolState(id).nextRecordId, 1);
    }

    function test_Flow_DrainsOverHorizon() public {
        for (uint256 i; i < 24; ++i) {
            _buy(trader, 4_000);
        }
        vm.warp(block.timestamp + 12);
        _buy(trader, 4_000);
        assertEq(hook.poolState(id).nextRecordId, 0);
    }

    // --- drift ---------------------------------------------------------------------------------

    function test_Drift_FlagsTowardReference() public {
        _buy(trader, 20_000); // uses the block's first touch
        feed.set(int256(3_100 * 1e8), block.timestamp);
        _buy(trader, 20_000); // same block, later transaction: only drift can flag it
        assertEq(hook.poolState(id).nextRecordId, 2);
        (Record memory r,) = _lastRecord();
        // Gap of about 3.3% scaled by beta 1.25 exceeds the 300 bp cap.
        uint256 riskyGross = _abs(quoteIs0 ? r.amount1 : r.amount0);
        uint256 dq = 20_000 * 10 ** decQuote * 300 / 10_000;
        assertEq(r.deposit, dq * riskyGross / (20_000 * 10 ** decQuote));
    }

    function test_Reference_StaleOrRevertingNeverReverts() public {
        feed.set(int256(3_100 * 1e8), block.timestamp);
        vm.warp(block.timestamp + 3_601);
        _buy(trader, 20_000);
        (Record memory r,) = _lastRecord();
        uint256 riskyGross = _abs(quoteIs0 ? r.amount1 : r.amount0);
        // Stale reference: g = 0, so the floor rate applies.
        uint256 n = 20_000 * 10 ** decQuote;
        uint256 depositQuote = n * 30 / 10_000;
        assertEq(r.deposit, depositQuote * riskyGross / n);

        feed.setReverts(true);
        vm.roll(block.number + 1);
        _buy(trader, 20_000);
        assertEq(hook.poolState(id).nextRecordId, 2);
    }

    // --- guarded launch, hookData, events ------------------------------------------------------

    function test_MaxOutstanding_StopsNewDeposits() public {
        // $1M cap at 30 bps: a $400M notional deposit would be $1.2M, above the cap.
        _addLiquidity(key, liquidity() * 1000);
        _buy(trader, 400_000_000);
        assertEq(hook.poolState(id).nextRecordId, 0);
    }

    function test_HookData_MalformedReverts() public {
        vm.expectRevert();
        _swap(trader, true, true, 1_000 * 10 ** decQuote, new bytes(20));
    }

    function test_HookData_BeneficiaryAndRebateTo() public {
        address ben = makeAddr("ben");
        address router = makeAddr("router");
        _swap(trader, true, true, 20_000 * 10 ** decQuote, abi.encode(ben, router));
        (Record memory r,) = _lastRecord();
        assertEq(r.beneficiary, ben);
        assertEq(r.rebateTo, router);
    }

    function test_HookData_NamingTheHookFallsBack() public {
        _swap(trader, true, true, 20_000 * 10 ** decQuote, abi.encode(address(hook), address(hook)));
        (Record memory r,) = _lastRecord();
        assertEq(r.beneficiary, trader);
        assertEq(r.rebateTo, trader);
    }

    function test_HookData_DefaultsToTxOrigin() public {
        _buy(trader, 20_000);
        (Record memory r,) = _lastRecord();
        assertEq(r.beneficiary, trader);
        assertEq(r.rebateTo, trader);
    }

    function test_TrustedRouter_NamesItsCaller() public {
        address user = makeAddr("user");
        trustedRouter.setMsgSender(user);
        _swapVia(trustedRouter, trader, true, true, 20_000 * 10 ** decQuote, abi.encode(makeAddr("spoof")));
        (Record memory r,) = _lastRecord();
        assertEq(r.beneficiary, user);
    }

    function test_HookSwap_EmittedWithNegativeDeposit() public {
        _buy(trader, 20_000);
        (Record memory r,) = _lastRecord();
        int128 neg = -int128(r.deposit);
        vm.roll(block.number + 1);
        vm.expectEmit(true, true, false, false, address(hook));
        emit HookSwap(id, address(swapRouter), r.depositIn0 ? neg : int128(0), r.depositIn0 ? int128(0) : neg, 0);
        _buy(trader, 20_000);
    }

    function test_LiquidityChanges_NeverBlocked() public {
        _buy(trader, 20_000);
        _addLiquidity(key, liquidity());
        _addLiquidity(key, liquidity());
        PoolState memory st = hook.poolState(id);
        assertEq(st.nextRecordId, 1);
    }
}

contract TouchstoneHookDecimalsTest is TouchstoneFixture {
    function _checkFlag(uint8 dr, uint8 dq) internal {
        _setUp(dr, dq);
        vm.recordLogs();
        _swap(trader, true, true, 20_000 * 10 ** dq, "");
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        assertGt(r.deposit, 0);
        vm.roll(block.number + 1);
        _swap(trader, false, true, 6 * 10 ** decRisky, "");
        assertEq(hook.poolState(id).nextRecordId, 2);
    }

    function test_Decimals_8_6() public {
        _checkFlag(8, 6);
    }

    function test_Decimals_18_18() public {
        _checkFlag(18, 18);
    }

    function test_Native_18_6() public {
        _checkFlag(0, 6);
        assertTrue(key.currency0.isAddressZero());
    }
}
