// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {IRebateLedger} from "../../src/interfaces/IRebateLedger.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {PoolConfig} from "../../src/types/PoolConfig.sol";
import {Record} from "../../src/types/Record.sol";
import {Payout} from "../../src/types/Payout.sol";
import {SettlementMath} from "../../src/libraries/SettlementMath.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {ItmLib} from "../../src/libraries/ItmLib.sol";
import {RecordLib} from "../../src/libraries/RecordLib.sol";
import {MockRejectingReceiver} from "../mocks/MockRejectingReceiver.sol";

abstract contract SettlementBase is TouchstoneFixture {
    function _flag(uint256 usd, bool buy, bytes memory hookData) internal returns (Record memory r) {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, buy, true, buy ? usd * 10 ** decQuote : usd * 10 ** decRisky / ETH_USD, hookData);
        bool found;
        (r, found) = _lastRecord();
        assertTrue(found, "swap was not flagged");
    }

    /// @notice Exact-output buy of `riskyUnits` whole risky tokens; the deposit is taken in quote.
    function _flagExactOutBuy(uint256 riskyUnits) internal returns (Record memory r) {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, false, riskyUnits * 10 ** decRisky, "");
        bool found;
        (r, found) = _lastRecord();
        assertTrue(found, "swap was not flagged");
    }

    /// @notice Settle `r` at t0 against a fair price of `usd` (in 1e-8 dollars) with confidence `conf`.
    function _settleAt(Record memory r, int64 price8, uint64 conf) internal returns (Payout memory p) {
        uint64 t0 = uint64(r.timestamp) + 3;
        if (block.timestamp < t0) vm.warp(t0);
        bytes[] memory u = _updateRaw(price8, t0, t0 - 1, conf);
        vm.prank(keeper, keeper);
        p = settler.settle(r, u);
    }

    function _depositCurrency(Record memory r) internal view returns (Currency) {
        return r.depositIn0 ? key.currency0 : key.currency1;
    }
}

contract SettlementTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    /// @dev I3 and I4 on a real arbitrage: buy $500k as the fair price jumps to $3,300.
    function test_Settle_ArbitrageRetainsAndConserves() public {
        Record memory r = _flag(500_000, true, "");
        Currency c = _depositCurrency(r);
        uint256 benBefore = _balance(c, trader);
        uint256 keeperBefore = _balance(c, keeper);

        Payout memory p = _settleAt(r, 3_300e8, 0);

        uint256 retained = uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs;
        assertGt(retained, 0, "nothing retained");
        assertEq(uint256(p.refund) + retained, r.deposit, "I3");
        assertEq(_balance(c, trader) - benBefore, p.refund);
        assertEq(_balance(c, keeper) - keeperBefore, p.tip);

        assertLe(_retainedQuote(r, retained, 3_300e8), _clawbackBound(r, 3_300e8) + 1, "I4");

        PoolState memory st = hook.poolState(id);
        assertEq(hook.recordHash(id, r.id), bytes32(0), "I5");
        assertEq(st.outstanding0 + st.outstanding1, 0);
        assertEq(r.depositIn0 ? st.rebatePool0 : st.rebatePool1, p.toRebatePool);
        assertEq(r.depositIn0 ? st.vest0 : st.vest1, p.toLPs);
        _assertHookBalances();
    }

    function test_Settle_BenignRefundsInFullAndEarnsRebate() public {
        // Fund the rebate pool with one arbitrage first.
        Record memory arb = _flagExactOutBuy(160);
        Payout memory pa = _settleAt(arb, 3_300e8, 0);
        assertGt(pa.toRebatePool, 0);

        // A large sell into a pool near $3,300 when the fair price is $3,700: the trader loses.
        address router = makeAddr("router");
        Record memory r = _flag(60_000, false, abi.encode(trader, router));
        Payout memory p = _settleAt(r, 3_700e8, 0);
        assertTrue(p.benign);
        assertEq(p.refund, r.deposit);
        Currency c = _depositCurrency(r);
        assertEq(ledger.owed(router, c), p.rebate);
        // gross <= kappa * f * N.
        uint256 n = RecordLib.notional(r, quoteIs0);
        uint256 cap = n * FEE * 4_000 / 1e10;
        assertLe(uint256(p.rebate) + p.tip, cap + 1, "I7");
        _assertHookBalances();
    }

    function test_Settle_BenignWithEmptyPoolPaysNoRebate() public {
        Record memory r = _flag(20_000, true, "");
        Payout memory p = _settleAt(r, 2_900e8, 0);
        assertTrue(p.benign);
        assertEq(p.rebate, 0);
        assertEq(p.tip, 0);
        assertEq(p.refund, r.deposit);
    }

    function test_Settle_WideConfidenceRefundsInFull() public {
        Record memory r = _flag(500_000, true, "");
        // c* = 30 bps of the base price, above maxConfBps = 25.
        Payout memory p = _settleAt(r, 3_300e8, uint64(3_300e8 * 30 / 10_000));
        assertEq(p.refund, r.deposit);
        assertFalse(p.benign);
    }

    function test_Settle_TooEarly() public {
        Record memory r = _flag(20_000, true, "");
        uint64 t0 = uint64(r.timestamp) + 3;
        bytes[] memory u = _updateRaw(3_000e8, t0, t0 - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__TooEarly.selector, t0));
        settler.settle(r, u);
    }

    /// @dev T1: a keeper cannot choose a later, more favourable update.
    function test_Settle_RejectsNonFirstUpdate() public {
        Record memory r = _flag(20_000, true, "");
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0 + 5);
        bytes[] memory u = _updateRaw(3_300e8, t0 + 2, t0 + 1, 0);
        vm.expectRevert(bytes4(keccak256("PriceFeedNotFoundWithinRange()")));
        settler.settle(r, u);
        u = _updateRaw(3_300e8, t0 + 11, t0 - 1, 0);
        vm.expectRevert(bytes4(keccak256("PriceFeedNotFoundWithinRange()")));
        settler.settle(r, u);
    }

    /// @dev I5 and T11: a record settles once, and a forged record never matches.
    function test_Settle_OnceAndForgedRecordsRejected() public {
        Record memory r = _flag(20_000, true, "");
        Record memory forged = _copy(r);
        forged.deposit = r.deposit * 2;
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_000e8, t0, t0 - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RecordClosed.selector, id, r.id));
        settler.settle(forged, u);
        settler.settle(r, u);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RecordClosed.selector, id, r.id));
        settler.settle(r, u);
    }

    function test_Settle_ReturnsExcessValue() public {
        Record memory r = _flag(20_000, true, "");
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_000e8, t0, t0 - 1, 0);
        vm.deal(keeper, 1 ether);
        vm.prank(keeper, keeper);
        settler.settle{value: 1 ether}(r, u);
        assertEq(keeper.balance, 1 ether);
    }

    function test_SettleTime() public {
        Record memory r = _flag(20_000, true, "");
        (uint256 t0, uint256 latest, uint256 expiresAt) = settler.settleTime(r);
        assertEq(t0, r.timestamp + 3);
        assertEq(latest, t0 + 10);
        assertEq(expiresAt, t0 + 1 days);
    }

    // --- expiry --------------------------------------------------------------------------------

    /// @dev I6: an expired record refunds D and pays no tip or rebate.
    function test_Expire_RefundsInFull() public {
        Record memory r = _flag(20_000, true, "");
        (,, uint256 expiresAt) = settler.settleTime(r);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__NotExpired.selector, expiresAt));
        settler.expire(r);
        vm.warp(expiresAt);
        Currency c = _depositCurrency(r);
        uint256 before = _balance(c, trader);
        uint256 keeperBefore = _balance(c, keeper);
        vm.expectEmit(true, true, false, true, address(settler));
        emit Expired(id, r.id, r.deposit);
        vm.prank(keeper, keeper);
        settler.expire(r);
        assertEq(_balance(c, trader) - before, r.deposit);
        assertEq(_balance(c, keeper), keeperBefore);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
        _assertHookBalances();
    }

    // --- hook guards ---------------------------------------------------------------------------

    function test_Finalize_OnlySettler() public {
        Record memory r = _flag(20_000, true, "");
        Payout memory p;
        p.refund = r.deposit;
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotSettler.selector);
        hook.finalize(r, p, false);
    }

    function test_Finalize_RejectsPayoutThatDoesNotConserve() public {
        Record memory r = _flag(20_000, true, "");
        Payout memory p;
        p.refund = r.deposit - 1;
        vm.prank(address(settler));
        vm.expectRevert(ITouchstoneErrors.Touchstone__PayoutMismatch.selector);
        hook.finalize(r, p, false);

        p.refund = r.deposit / 2;
        p.toLPs = r.deposit - p.refund;
        vm.prank(address(settler));
        vm.expectRevert(ITouchstoneErrors.Touchstone__PayoutMismatch.selector);
        hook.finalize(r, p, true);

        Payout memory benignOverdraw;
        benignOverdraw.benign = true;
        benignOverdraw.refund = r.deposit;
        benignOverdraw.rebate = 1;
        vm.prank(address(settler));
        vm.expectRevert(ITouchstoneErrors.Touchstone__PayoutMismatch.selector);
        hook.finalize(r, benignOverdraw, false);
    }

    function test_UnlockCallback_OnlyPoolManager() public {
        vm.expectRevert();
        hook.unlockCallback(abi.encode(uint8(1), abi.encode(id)));
    }

    // --- vesting -------------------------------------------------------------------------------

    function test_Drip_ReleasesLinearly() public {
        Record memory r = _flag(500_000, true, "");
        Payout memory p = _settleAt(r, 3_300e8, 0);
        vm.warp(block.timestamp + 15 minutes);
        (uint256 a0, uint256 a1) = hook.drip(key);
        uint256 donated = r.depositIn0 ? a0 : a1;
        assertEq(donated, uint256(p.toLPs) / 2);
        vm.warp(block.timestamp + 1 days);
        (a0, a1) = hook.drip(key);
        assertEq((r.depositIn0 ? a0 : a1) + donated, p.toLPs, "I14");
        PoolState memory st = hook.poolState(id);
        assertEq(st.vest0 + st.vest1, 0);
        _assertHookBalances();
    }

    function test_Drip_WaitsWithoutInRangeLiquidity() public {
        Record memory r = _flag(500_000, true, "");
        Payout memory p = _settleAt(r, 3_300e8, 0);
        int24 lower = TickMath.minUsableTick(TICK_SPACING);
        int24 upper = TickMath.maxUsableTick(TICK_SPACING);
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: -int256(uint256(liquidity())), salt: 0
            }),
            ""
        );
        vm.warp(block.timestamp + 1 days);
        (uint256 a0, uint256 a1) = hook.drip(key);
        assertEq(a0 + a1, 0);
        PoolState memory st = hook.poolState(id);
        assertEq(st.vest0 + st.vest1, p.toLPs);
    }

    function test_Drip_UnknownPoolReverts() public {
        PoolKey memory k = key;
        k.tickSpacing = 1;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__PoolNotRegistered.selector, k.toId()));
        hook.drip(k);
    }

    /// @dev The protocol share of R is credited in the ledger to the pool's recipient (§12.5).
    function test_Settle_ProtocolShareCreditedToRecipient() public {
        address recipient = makeAddr("protocol");
        PoolKey memory k = key;
        k.tickSpacing = 10;
        PoolConfig memory c = defaultConfig();
        c.protocolShareBps = 1_000;
        c.protocolRecipient = recipient;
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        key = k;
        id = k.toId();
        _addLiquidity(key, liquidity());

        Record memory r = _flag(500_000, true, "");
        Payout memory p = _settleAt(r, 3_300e8, 0);
        assertGt(p.toProtocol, 0);
        uint256 retained = uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs;
        assertEq(p.toProtocol, (retained - p.tip) * 1_000 / 10_000);
        assertEq(ledger.owed(recipient, _depositCurrency(r)), p.toProtocol);
    }

    function test_HookData_ThirtyTwoBytesNamesBeneficiaryAndRebate() public {
        address ben = makeAddr("ben32");
        Record memory r = _flag(20_000, true, abi.encode(ben));
        assertEq(r.beneficiary, ben);
        assertEq(r.rebateTo, ben);
        Currency c = _depositCurrency(r);
        uint256 before = _balance(c, ben);
        _settleAt(r, 2_900e8, 0);
        assertEq(_balance(c, ben) - before, r.deposit);
    }

    // --- ledger --------------------------------------------------------------------------------

    function test_Ledger_ClaimPathsAndGuards() public {
        Record memory arb = _flagExactOutBuy(160);
        _settleAt(arb, 3_300e8, 0);
        address router = makeAddr("router");
        Record memory r = _flag(60_000, false, abi.encode(trader, router));
        Payout memory p = _settleAt(r, 3_700e8, 0);
        Currency c = _depositCurrency(r);
        assertGt(p.rebate, 0);

        vm.expectRevert(ITouchstoneErrors.Touchstone__NotHook.selector);
        ledger.credit(router, c, 1, IRebateLedger.Kind.REBATE);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotPoolManager.selector);
        ledger.unlockCallback("");

        uint256 before = _balance(c, router);
        ledger.push(router, c);
        assertEq(_balance(c, router) - before, p.rebate);
        assertEq(ledger.totalOwed(c), 0);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NothingToClaim.selector);
        vm.prank(router);
        ledger.claim(c, router);
    }

    /// @dev alpha * (m+ - eps * N+) in quote units, recomputed from the record's in-the-money leg.
    function _clawbackBound(Record memory r, int64 price8) internal view returns (uint256) {
        uint256 fair = PriceLib.fairPriceX36(price8, -8, 1e8, -8, decRisky, decQuote);
        (int256 a0, int256 a1,) = ItmLib.leg(
            r.zeroForOne,
            r.sqrtPriceBeforeX96,
            r.sqrtPriceAfterX96,
            PriceLib.sqrtPriceX96At(fair, !quoteIs0),
            r.liquidityBefore,
            r.swapFeePips
        );
        (int256 lr, int256 lq) = quoteIs0 ? (a1, a0) : (a0, a1);
        int256 mPlus = SettlementMath.markout(lr, lq, fair);
        uint256 nPlus = uint256(lq >= 0 ? lq : -lq);
        return 8_000 * (uint256(mPlus) - nPlus * 2 / 10_000) / 10_000;
    }

    function _retainedQuote(Record memory r, uint256 retained, int64 price8) internal view returns (uint256) {
        if (r.depositIn0 == quoteIs0) return retained;
        uint256 fair = PriceLib.fairPriceX36(price8, -8, 1e8, -8, decRisky, decQuote);
        return retained * fair / 1e36;
    }

    function _copy(Record memory r) internal pure returns (Record memory c) {
        c = abi.decode(abi.encode(r), (Record));
    }

    /// @dev I1 and I17: the hook's claims equal outstanding + vest + rebate pool, and it holds no tokens.
    function _assertHookBalances() internal view {
        PoolState memory st = hook.poolState(id);
        assertEq(
            manager.balanceOf(address(hook), key.currency0.toId()),
            uint256(st.outstanding0) + st.vest0 + st.rebatePool0,
            "I1 currency0"
        );
        assertEq(
            manager.balanceOf(address(hook), key.currency1.toId()),
            uint256(st.outstanding1) + st.vest1 + st.rebatePool1,
            "I1 currency1"
        );
        assertEq(_balance(key.currency0, address(hook)), 0, "I17");
        assertEq(_balance(key.currency1, address(hook)), 0, "I17");
    }
}

/// @dev Native ETH as the risky token, so refunds are ETH pushes that a contract can reject.
contract SettlementNativeTest is SettlementBase {
    function setUp() public {
        _setUp(0, 6);
    }

    /// @dev T9 and I15: a rejected refund is credited to the beneficiary in the ledger, never lost.
    function test_Refund_RejectedIsDeferredToLedger() public {
        MockRejectingReceiver ben = new MockRejectingReceiver();
        Record memory r = _flag(20_000, true, abi.encode(address(ben)));
        assertTrue(r.depositIn0, "deposit should be native ETH");
        vm.expectEmit(true, true, false, true, address(hook));
        emit RefundDeferred(id, r.id, address(ben), r.deposit);
        _settleAt(r, 2_900e8, 0);
        assertEq(ledger.owed(address(ben), key.currency0), r.deposit);

        address dest = makeAddr("dest");
        vm.prank(address(ben));
        ledger.claim(key.currency0, dest);
        assertEq(dest.balance, r.deposit);
    }

    /// @dev I16: a beneficiary that re-enters drip during finalize is stopped by the lock.
    function test_Reentrancy_DuringFinalizeIsBlocked() public {
        MockRejectingReceiver ben = new MockRejectingReceiver();
        ben.setReenter(address(hook), key);
        Record memory r = _flag(20_000, true, abi.encode(address(ben)));
        _settleAt(r, 2_900e8, 0);
        assertEq(ledger.owed(address(ben), key.currency0), r.deposit);

        address dest = makeAddr("dest");
        vm.prank(address(ben));
        ledger.claimAsClaims(key.currency0, dest);
        assertEq(manager.balanceOf(dest, key.currency0.toId()), r.deposit);
    }
}
