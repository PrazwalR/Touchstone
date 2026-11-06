// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {DepositLib} from "../../src/libraries/DepositLib.sol";
import {TriggerLib} from "../../src/libraries/TriggerLib.sol";
import {DepositQuote} from "../../src/types/DepositQuote.sol";
import {Guard} from "../../src/types/Guard.sol";
import {Record} from "../../src/types/Record.sol";
import {SettlementBase} from "./Settlement.t.sol";

/// @notice M7 quote integrity (spec §12): previewDeposit against the executed deposit (E12's first check), the URC-2
/// HookSwap rule, and GuardedRouter's in-transaction guard.
contract QuoteIntegrityTest is SettlementBase {
    bytes32 internal constant HOOK_SWAP_TOPIC = keccak256("HookSwap(bytes32,address,int128,int128,uint24)");

    function setUp() public {
        _setUp(18, 6);
    }

    /// @dev The specified amount for a swap worth about `usd`: quote for exact-input buys and exact-output sells, risky
    /// for the other two.
    function _amount(uint256 usd, bool buy, bool exactIn) internal view returns (uint256) {
        return buy == exactIn ? usd * 10 ** decQuote : usd * 10 ** decRisky / ETH_USD;
    }

    /// @dev The swap's quote leg, as the hook measures notional.
    function _notional(BalanceDelta d) internal view returns (uint256) {
        int128 q = quoteIs0 ? d.amount0() : d.amount1();
        return uint256(int256(q >= 0 ? q : -q));
    }

    function _riskyAbs(BalanceDelta d) internal view returns (uint256) {
        int128 r = quoteIs0 ? d.amount1() : d.amount0();
        return uint256(int256(r >= 0 ? r : -r));
    }

    function _countHookSwaps(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == HOOK_SWAP_TOPIC) ++n;
        }
    }

    /// @dev E12, first check: within one block, previewDeposit's depositNow equals the executed deposit. A prior
    /// swap in the same block varies the flow bucket and first-touch state the quote must account for.
    function testFuzz_PreviewMatchesExecutionInTheSameBlock(
        uint256 usd,
        bool buy,
        bool exactIn,
        uint256 priorUsd,
        bool priorBuy
    ) public {
        usd = bound(usd, 1, 1_000_000);
        priorUsd = bound(priorUsd, 0, 300_000);
        vm.roll(block.number + 1);
        if (priorUsd != 0) _swap(trader, priorBuy, true, _amount(priorUsd, priorBuy, true), "");

        // Learn the swap's notional as the hook measures it (the swap's own delta, before the deposit), then rewind and
        // quote it before executing for real.
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        BalanceDelta probe = _swap(trader, buy, exactIn, _amount(usd, buy, exactIn), "");
        (Record memory pr, bool probeFlagged) = _lastRecord();
        vm.revertToState(snap);
        uint256 notional = probeFlagged ? _recordNotional(pr) : _notional(probe);
        DepositQuote memory q = hook.previewDeposit(key, buy == quoteIs0, notional, trader);

        vm.recordLogs();
        _swap(trader, buy, exactIn, _amount(usd, buy, exactIn), "");
        (Record memory r, bool flagged) = _lastRecord();
        assertEq(flagged, q.flaggedNow, "flagged now");
        if (!flagged) {
            assertEq(q.depositNow, 0);
            return;
        }
        assertEq(_recordNotional(r), notional, "same swap, same notional");
        uint256 riskyAbs = uint256(int256(quoteIs0 ? _abs(r.amount1) : _abs(r.amount0)));
        bool depositIsQuote = r.depositIn0 == quoteIs0;
        uint256 expected = depositIsQuote ? q.depositNow : DepositLib.toRisky(q.depositNow, riskyAbs, notional);
        assertEq(r.deposit, expected, "depositNow equals the executed deposit");
        assertEq(r.mode, q.mode);
        (uint256 t0,, uint256 expiresAt) = settler.settleTime(r);
        assertEq(q.settleAfter, t0);
        assertEq(q.expiresAt, expiresAt);
    }

    function _abs(int128 x) internal pure returns (int128) {
        return x >= 0 ? x : -x;
    }

    function _recordNotional(Record memory r) internal view returns (uint256) {
        return uint256(int256(_abs(quoteIs0 ? r.amount0 : r.amount1)));
    }

    function test_PreviewReportsTheRateEvenWhenNotFlagged() public view {
        DepositQuote memory q = hook.previewDeposit(key, quoteIs0, 100 * 10 ** decQuote, trader);
        assertFalse(q.flaggedNow);
        assertEq(q.depositNow, 0);
        assertEq(q.rateBps, defaultConfig().deltaBps);
        assertEq(q.depositIfFlagged, 100 * 10 ** decQuote * defaultConfig().deltaBps / 10_000);
        assertFalse(q.exempt, "no licence before M9");
    }

    function test_PreviewNamesTheTriggers() public {
        vm.roll(block.number + 1);
        DepositQuote memory q = hook.previewDeposit(key, quoteIs0, 50_000 * 10 ** decQuote, trader);
        assertTrue(q.flaggedNow);
        assertTrue(q.triggers & TriggerLib.FIRST_TOUCH != 0);
        assertEq(q.depositNow, q.depositIfFlagged);
    }

    function test_PreviewRevertsForAnUnknownPool() public {
        key.tickSpacing = 10;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__PoolNotRegistered.selector, key.toId()));
        hook.previewDeposit(key, true, 1, trader);
    }

    /// @dev URC-2: exactly one HookSwap for a swap that posts a deposit, none for one that does not.
    function test_HookSwapExactlyOncePerDepositAndNeverOtherwise() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, true, 100 * 10 ** decQuote, "");
        assertEq(_countHookSwaps(vm.getRecordedLogs()), 0, "unflagged swap");
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        assertEq(_countHookSwaps(vm.getRecordedLogs()), 1, "flagged swap");
    }

    // --- GuardedRouter ------------------------------------------------------------------------------------------

    function _params(bool buy, bool exactIn, uint256 amount) internal view returns (SwapParams memory p) {
        bool zeroForOne = buy == quoteIs0;
        p = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: exactIn ? -int256(amount) : int256(amount),
            sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
        });
    }

    function _open() internal pure returns (Guard memory g) {
        g.maxDeposit = type(uint256).max;
        g.maxNetIn = type(uint256).max;
    }

    function test_Router_RefundNamesTheTraderWithoutHookData() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        address rebate = makeAddr("rebate");
        vm.prank(trader, trader);
        (, uint256 deposit) = guardedRouter.swapGuarded(
            key, _params(true, true, 50_000 * 10 ** decQuote), _open(), rebate, block.timestamp
        );
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        assertEq(deposit, r.deposit, "the router reports the deposit the hook took");
        assertEq(r.beneficiary, trader);
        assertEq(r.rebateTo, rebate);
        assertEq(guardedRouter.msgSender(), address(0), "no caller outside the lock");
    }

    function test_Router_EnforcesMaxDeposit() public {
        vm.roll(block.number + 1);
        Guard memory g = _open();
        g.maxDeposit = 1;
        vm.prank(trader, trader);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__GuardFailed.selector, uint8(1)));
        guardedRouter.swapGuarded(key, _params(true, true, 50_000 * 10 ** decQuote), g, address(0), block.timestamp);
    }

    function test_Router_GrossLimitAcceptsAnOutputShortOnlyByTheDeposit() public {
        vm.roll(block.number + 1);
        SwapParams memory p = _params(true, true, 50_000 * 10 ** decQuote);
        uint256 snap = vm.snapshotState();
        vm.prank(trader, trader);
        (BalanceDelta d, uint256 deposit) = guardedRouter.swapGuarded(key, p, _open(), address(0), block.timestamp);
        vm.revertToState(snap);
        uint256 net = _riskyAbs(d);
        assertGt(deposit, 0);

        Guard memory g = _open();
        g.minNetOut = net + 1;
        vm.prank(trader, trader);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__GuardFailed.selector, uint8(2)));
        guardedRouter.swapGuarded(key, p, g, address(0), block.timestamp);

        g.minNetOut = net;
        g.minGrossOut = net + deposit + 1;
        vm.prank(trader, trader);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__GuardFailed.selector, uint8(3)));
        guardedRouter.swapGuarded(key, p, g, address(0), block.timestamp);

        g.minGrossOut = net + deposit;
        vm.prank(trader, trader);
        guardedRouter.swapGuarded(key, p, g, address(0), block.timestamp);
    }

    function test_Router_ExactOutputCapsTheInputDepositIncluded() public {
        vm.roll(block.number + 1);
        SwapParams memory p = _params(true, false, 10 * 10 ** decRisky);
        uint256 snap = vm.snapshotState();
        vm.prank(trader, trader);
        (BalanceDelta d, uint256 deposit) = guardedRouter.swapGuarded(key, p, _open(), address(0), block.timestamp);
        vm.revertToState(snap);
        assertGt(deposit, 0, "an exact-output buy deposits the quote input");
        uint256 netIn = _notional(d);

        Guard memory g = _open();
        g.maxNetIn = netIn - 1;
        vm.prank(trader, trader);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__GuardFailed.selector, uint8(4)));
        guardedRouter.swapGuarded(key, p, g, address(0), block.timestamp);
        g.maxNetIn = netIn;
        vm.prank(trader, trader);
        guardedRouter.swapGuarded(key, p, g, address(0), block.timestamp);
    }

    function test_Router_RejectsAnExpiredDeadline() public {
        vm.prank(trader, trader);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__GuardFailed.selector, uint8(0)));
        guardedRouter.swapGuarded(key, _params(true, true, 1e6), _open(), address(0), block.timestamp - 1);
    }

    function test_Router_CallbackIsPoolManagerOnly() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotPoolManager.selector);
        guardedRouter.unlockCallback("");
    }
}

/// @dev Native ETH input: the router settles from the call's value and returns what is unused.
contract QuoteIntegrityNativeTest is SettlementBase {
    function setUp() public {
        _setUp(0, 6);
    }

    function test_Router_NativeInputRefundsUnusedValue() public {
        vm.roll(block.number + 1);
        bool zeroForOne = !quoteIs0; // sell native ETH
        SwapParams memory p = SwapParams({
            zeroForOne: zeroForOne, amountSpecified: -1 ether, sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
        });
        Guard memory g;
        g.maxDeposit = type(uint256).max;
        uint256 before = trader.balance;
        vm.prank(trader, trader);
        guardedRouter.swapGuarded{value: 3 ether}(key, p, g, address(0), block.timestamp);
        assertEq(before - trader.balance, 1 ether, "only the swap's input is spent");
        assertEq(address(guardedRouter).balance, 0);
    }
}
