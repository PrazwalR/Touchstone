// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "../../src/interfaces/ITouchstoneEvents.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {DepositQuote} from "../../src/types/DepositQuote.sol";
import {Lease} from "../../src/types/Lease.sol";
import {Payout} from "../../src/types/Payout.sol";
import {Record} from "../../src/types/Record.sol";
import {SettlementBase} from "./Settlement.t.sol";

/// @notice The arbitrage licence (spec §10, milestone M9) on a pool with the fixture's $3,000 ETH-like token.
abstract contract LicenceBase is SettlementBase {
    using stdJson for string;

    uint32 internal constant K = 60;
    uint16 internal constant MIN_INCREMENT_BPS = 1_000;
    uint128 internal constant MIN_RENT = 1;

    address internal holder = makeAddr("holder");
    address internal rival = makeAddr("rival");

    function defaultConfig() internal view virtual override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.flags |= PoolFlags.LICENCE;
    }

    function defaultLease() internal pure override returns (ILicenceAuction.LeaseParams memory) {
        return ILicenceAuction.LeaseParams({k: K, minIncrementBps: MIN_INCREMENT_BPS, minRent: MIN_RENT});
    }

    function _setUpLicence() internal {
        _setUp(18, 6);
        for (uint256 i; i < 2; ++i) {
            address who = i == 0 ? holder : rival;
            MockERC20(Currency.unwrap(quote)).mint(who, 1e12 * 10 ** decQuote);
            vm.prank(who);
            MockERC20(Currency.unwrap(quote)).approve(address(licence), type(uint256).max);
        }
        _fund(holder);
    }

    /// @notice Place a bid as `who` exempting `who` itself, and wait out the notice period.
    function _lease(address who, uint128 rent, uint128 deposit) internal {
        vm.prank(who);
        licence.bid(id, who, rent, deposit);
        vm.warp(vm.getBlockTimestamp() + K);
    }

    /// @notice A swap through the trusted router, attributed to `who`.
    function _swapAs(address who, bool buy, uint256 usd) internal {
        trustedRouter.setMsgSender(who);
        _swapVia(
            PoolSwapTest(address(trustedRouter)),
            trader,
            buy,
            true,
            buy ? usd * 10 ** decQuote : usd * 10 ** decRisky / ETH_USD,
            ""
        );
    }

    function _quoteBalance(address who) internal view returns (uint256) {
        return MockERC20(Currency.unwrap(quote)).balanceOf(who);
    }

    /// @notice I12: the auction holds exactly the deposits of both leases and the refunds it owes.
    function _assertAuctionBalance(address[] memory owners) internal view {
        (Lease memory top, Lease memory next) = licence.leases(id);
        uint256 owed = uint256(top.deposit) + next.deposit;
        for (uint256 i; i < owners.length; ++i) {
            owed += licence.refunds(owners[i], quote);
        }
        // leases() applies the transitions in memory; rent charged since the last accrue is still in the balance.
        assertGe(_quoteBalance(address(licence)), owed, "I12: balance covers deposits and refunds");
    }

    function _owners() internal view returns (address[] memory o) {
        o = new address[](2);
        o[0] = holder;
        o[1] = rival;
    }
}

/// @notice The lease state machine: bids, notice, rent, lapse, displacement and refunds.
contract LicenceAuctionTest is LicenceBase {
    using stdJson for string;

    function setUp() public {
        _setUpLicence();
    }

    function test_Bid_BecomesHolderOnlyAfterTheNotice() public {
        vm.prank(holder);
        licence.bid(id, holder, 10, 36_000);
        (, bool live) = licence.holderOf(id);
        assertFalse(live, "a bid is pending for k seconds");
        vm.warp(vm.getBlockTimestamp() + K - 1);
        (, live) = licence.holderOf(id);
        assertFalse(live);
        vm.warp(vm.getBlockTimestamp() + 1);
        address swapper;
        (swapper, live) = licence.holderOf(id);
        assertTrue(live);
        assertEq(swapper, holder);
    }

    /// @dev Differential against research/reference: min_next_rent(1001, 0, 1, 1000) = 1102, rounded up.
    function test_Bid_MinimumIncrementMatchesTheReference() public {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile("../research/reference/vectors/report_numbers.json");
        uint256 expected = json.readUint(".min_next_rent");
        _lease(holder, 1_001, 1_001 * K);
        assertEq(licence.minNextRent(id), expected);
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__BidTooLow.selector, uint128(expected)));
        licence.bid(id, rival, uint128(expected - 1), uint128((expected - 1) * K));
        vm.prank(rival);
        licence.bid(id, rival, uint128(expected), uint128(expected * K));
    }

    function test_Bid_DepositMustCoverTheNotice() public {
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(ITouchstoneErrors.Touchstone__DepositBelowNotice.selector, uint256(10 * K))
        );
        licence.bid(id, holder, 10, 10 * K - 1);
    }

    /// @dev Audit 11: a quote token that delivers less than asked (fee-on-transfer) would leave deposits larger than
    /// the auction's balance, breaking I12, so the pull reverts.
    function test_Bid_RejectsAShortTransfer() public {
        vm.mockCall(
            Currency.unwrap(quote),
            abi.encodeWithSignature("balanceOf(address)", address(licence)),
            abi.encode(uint256(0))
        );
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__TransferShortfall.selector, 600, 0));
        licence.bid(id, holder, 10, 600);
    }

    function test_Bid_BelowTheReserveReverts() public {
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__BidTooLow.selector, MIN_RENT));
        licence.bid(id, holder, 0, 0);
    }

    /// @dev A displaced pending bid charged nothing, so its owner can claim the whole deposit back.
    function test_Bid_DisplacedPendingBidIsRefundedInFull() public {
        vm.prank(holder);
        licence.bid(id, holder, 10, 1_000);
        vm.prank(rival);
        licence.bid(id, rival, 11, 1_000);
        assertEq(licence.refunds(holder, quote), 1_000);
        _assertAuctionBalance(_owners());

        uint256 before = _quoteBalance(holder);
        vm.prank(holder);
        assertEq(licence.claimRefund(quote, holder), 1_000);
        assertEq(_quoteBalance(holder) - before, 1_000);
        vm.prank(holder);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NothingToClaim.selector);
        licence.claimRefund(quote, holder);
    }

    /// @dev Differential against research/reference: rent_due(10, 36,000, 0, 4,000) = (36,000, lapses at 3,600).
    function test_Lapse_MatchesTheReference() public {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile("../research/reference/vectors/report_numbers.json");
        uint256[] memory due = json.readUintArray(".rent_due");
        _lease(holder, 10, 36_000);
        uint256 start = vm.getBlockTimestamp();
        vm.warp(start + due[1] - 1);
        (, bool live) = licence.holderOf(id);
        assertTrue(live, "live until the deposit runs out");
        vm.warp(start + 4_000);
        (, live) = licence.holderOf(id);
        assertFalse(live, "lapsed at since + deposit / rent");

        vm.expectEmit(true, true, true, true, address(licence));
        emit ITouchstoneEvents.LeaseLapsed(id, holder, uint40(start + due[1]));
        assertEq(licence.accrue(id), due[0], "charged exactly rent x seconds active");
    }

    /// @dev A deposit that is not a whole number of seconds of rent returns the remainder at the lapse.
    function test_Lapse_ReturnsTheRemainderBelowOneSecondOfRent() public {
        _lease(holder, 7, 7 * K + 5);
        vm.warp(vm.getBlockTimestamp() + K + 1);
        assertEq(licence.accrue(id), 7 * K);
        assertEq(licence.refunds(holder, quote), 5);
    }

    /// @dev I13: the holder is charged rent x seconds, and the hook receives exactly what was charged (I12).
    function test_Rent_ReachesTheHookAsVestingAndRebatePool() public {
        _lease(holder, 100, 100 * 3_600);
        vm.warp(vm.getBlockTimestamp() + 250);
        PoolState memory before = hook.poolState(id);
        uint256 claimsBefore = manager.balanceOf(address(hook), quote.toId());
        uint256 charged = licence.accrue(id);
        assertEq(charged, 100 * 250);

        PoolState memory afterState = hook.poolState(id);
        uint256 toRebate = charged * defaultConfig().rhoBps / 10_000;
        (uint256 rebateBefore, uint256 rebateAfter) =
            quoteIs0 ? (before.rebatePool0, afterState.rebatePool0) : (before.rebatePool1, afterState.rebatePool1);
        (uint256 vestBefore, uint256 vestAfter) =
            quoteIs0 ? (before.vest0, afterState.vest0) : (before.vest1, afterState.vest1);
        assertEq(rebateAfter - rebateBefore, toRebate, "rho to the rebate pool");
        assertEq(vestAfter - vestBefore, charged - toRebate, "the rest vests to LPs");
        assertEq(
            manager.balanceOf(address(hook), quote.toId()) - claimsBefore, charged, "hook holds the rent as claims"
        );
        _assertAuctionBalance(_owners());
    }

    /// @dev Activation: the old holder pays up to that instant and gets the rest of its deposit back.
    function test_Activation_DisplacesTheHolderAndReturnsItsRemainder() public {
        _lease(holder, 10, 10 * 1_000);
        uint256 holderSince = vm.getBlockTimestamp();
        vm.prank(rival);
        licence.bid(id, rival, 20, 20 * 1_000);
        vm.warp(vm.getBlockTimestamp() + K);
        (address swapper, bool live) = licence.holderOf(id);
        assertTrue(live);
        assertEq(swapper, rival);

        uint256 charged = licence.accrue(id);
        assertEq(charged, 10 * (vm.getBlockTimestamp() - holderSince), "old holder pays until activation only");
        assertEq(licence.refunds(holder, quote), 10 * 1_000 - charged);
        _assertAuctionBalance(_owners());
    }

    function test_Terms_ReportsTheRegisteredLease() public view {
        (address quote_, uint32 k, uint16 minIncrementBps, uint128 minRent) = licence.terms(id);
        ILicenceAuction.LeaseParams memory p = defaultLease();
        assertEq(quote_, Currency.unwrap(quote));
        assertEq(k, p.k);
        assertEq(minIncrementBps, p.minIncrementBps);
        assertEq(minRent, p.minRent);
        (quote_, k,,) = licence.terms(PoolId.wrap(bytes32(uint256(1))));
        assertEq(quote_, address(0));
        assertEq(k, 0);
    }

    function test_Withdraw_KeepsKSecondsOfRent() public {
        _lease(holder, 10, 10_000);
        vm.prank(holder);
        vm.expectRevert(
            abi.encodeWithSelector(ITouchstoneErrors.Touchstone__DepositBelowNotice.selector, uint256(10 * K))
        );
        licence.withdraw(id, 10_000 - 10 * K + 1, true, holder);
        uint256 before = _quoteBalance(holder);
        vm.prank(holder);
        licence.withdraw(id, 10_000 - 10 * K, true, holder);
        assertEq(_quoteBalance(holder) - before, 10_000 - 10 * K);
    }

    function test_OnlyTheOwnerManagesALease() public {
        _lease(holder, 10, 10_000);
        vm.startPrank(rival);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotLeaseOwner.selector);
        licence.topUp(id, 1, true);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotLeaseOwner.selector);
        licence.withdraw(id, 1, true, rival);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotLeaseOwner.selector);
        licence.setSwapper(id, rival, true);
        vm.stopPrank();

        vm.startPrank(holder);
        licence.topUp(id, 500, true);
        licence.setSwapper(id, rival, true);
        vm.stopPrank();
        (address swapper,) = licence.holderOf(id);
        assertEq(swapper, rival, "the new swapper is exempt at once");
    }

    /// @dev holderOf's narrow read and the full state machine behind leases() give the same answer, whether or not
    /// an accrual has written the transitions, across bids, displacements, activations and lapses.
    function testFuzz_HolderOfMatchesAdvance(
        uint256 rentA,
        uint256 secsA,
        uint256 rentB,
        uint256 secsB,
        uint256 dt1,
        uint256 dt2,
        bool accrueBetween
    ) public {
        uint128 ra = uint128(bound(rentA, MIN_RENT, 1e6));
        vm.prank(holder);
        licence.bid(id, holder, ra, uint128(uint256(ra) * bound(secsA, K, 30 days)));
        vm.warp(vm.getBlockTimestamp() + bound(dt1, 0, 40 days));
        _assertSameHolder();
        if (accrueBetween) licence.accrue(id);
        uint128 rb = uint128(bound(rentB, licence.minNextRent(id), uint256(licence.minNextRent(id)) * 4));
        vm.prank(rival);
        licence.bid(id, rival, rb, uint128(uint256(rb) * bound(secsB, K, 30 days)));
        _assertSameHolder();
        vm.warp(vm.getBlockTimestamp() + bound(dt2, 0, 40 days));
        _assertSameHolder();
        licence.accrue(id);
        _assertSameHolder();
    }

    function _assertSameHolder() internal view {
        (address swapper, bool live) = licence.holderOf(id);
        (Lease memory top,) = licence.leases(id);
        assertEq(live, top.owner != address(0), "live");
        assertEq(swapper, live ? top.swapper : address(0), "swapper");
    }

    function test_OnlyTheFactoryRegistersAndOnlyTheAuctionCreditsRent() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotFactory.selector);
        licence.register(key, defaultLease());
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotLicence.selector);
        hook.creditRent(key, 1);
        vm.expectRevert(ITouchstoneErrors.Touchstone__NotPoolManager.selector);
        licence.unlockCallback(abi.encode(Currency.unwrap(quote), uint256(1)));
    }
}

/// @notice The hook's fast path and the Settler's band regime.
contract LicenceSwapTest is LicenceBase {
    function setUp() public {
        _setUpLicence();
        _lease(holder, 10, 10 * 7 days);
    }

    /// @dev One pass over the recorded logs, which reading consumes: whether the swap was exempt or flagged, and
    /// the record it posted.
    function _exempt() internal view returns (bool exempt, bool flagged, Record memory r) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(hook)) continue;
            if (logs[i].topics[0] == ITouchstoneEvents.LicensedSwap.selector) exempt = true;
            if (logs[i].topics[0] == ITouchstoneEvents.DepositTaken.selector) {
                flagged = true;
                r = abi.decode(logs[i].data, (Record));
            }
        }
    }

    /// @dev The holder's first large swap in a block, inside the band, posts no deposit.
    function test_FastPath_HoldersFirstSwapInTheBandIsExempt() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(holder, true, 10_000);
        (bool exempt, bool flagged,) = _exempt();
        assertTrue(exempt);
        assertFalse(flagged);
        (uint256 deposit,) = hook.lastDeposit(id);
        assertEq(deposit, 0);
    }

    /// @dev I11: the second swap in the same block is not the first touch, so it is never exempt.
    function test_FastPath_OnlyOncePerBlock() public {
        vm.roll(block.number + 1);
        _swapAs(holder, true, 10_000);
        vm.recordLogs();
        _swapAs(holder, false, 10_000);
        (bool exempt, bool flagged, Record memory r) = _exempt();
        assertFalse(exempt, "I11");
        assertTrue(flagged, "the second swap triggers like anyone's");
        assertTrue(r.licenceActive);
        assertFalse(r.byHolder);
    }

    function test_FastPath_OthersAreNeverExempt() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(rival, true, 10_000);
        (bool exempt, bool flagged, Record memory r) = _exempt();
        assertFalse(exempt);
        assertTrue(flagged);
        assertTrue(r.licenceActive);
        assertFalse(r.byHolder);
    }

    /// @dev A stale reference cannot show the band, so the holder's swap posts a deposit marked byHolder.
    function test_FastPath_StaleReferencePostsADeposit() public {
        feed.set(int256(ETH_USD * 1e8), vm.getBlockTimestamp() - 2 hours);
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(holder, true, 10_000);
        (bool exempt, bool flagged, Record memory r) = _exempt();
        assertFalse(exempt);
        assertTrue(flagged);
        assertTrue(r.byHolder);
    }

    /// @dev Holder's slow path: the reference showed a gap beyond G, but P* puts the pre-swap price inside the band,
    /// so the record settles at alpha 0 and refunds in full.
    function test_SlowPath_HolderRefundedInFullWhenPStarIsInTheBand() public {
        feed.set(int256(3_060 * 1e8), vm.getBlockTimestamp()); // 200 bps above the pool
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(holder, true, 10_000);
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        assertTrue(r.byHolder);
        Payout memory p = _settleAt(r, 3_006e8, 0); // 20 bps above the pre-swap price: inside G = 25 bps
        assertEq(p.refund, r.deposit, "alpha 0");
    }

    function test_Settlement_OutsiderInTheBandUsesAlphaLicensed() public {
        assertEq(_settledAlpha(rival, 3_006e8), defaultConfig().alphaLicensedBps);
    }

    function test_Settlement_OutsiderOutsideTheBandUsesAlpha() public {
        assertEq(_settledAlpha(rival, 3_060e8), defaultConfig().alphaBps);
    }

    function test_Settlement_NoLiveLeaseUsesAlpha() public {
        vm.warp(vm.getBlockTimestamp() + 7 days + 1); // the holder's deposit has run out
        assertEq(_settledAlpha(rival, 3_006e8), defaultConfig().alphaBps);
    }

    /// @dev A lease whose exempt address is zero never matches, even through a router reporting no trader.
    function test_FastPath_ZeroSwapperNeverMatches() public {
        vm.prank(holder);
        licence.setSwapper(id, address(0), true);
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(address(0), true, 10_000);
        (bool exempt,,) = _exempt();
        assertFalse(exempt);
    }

    function test_Preview_ReportsTheExemption() public {
        vm.roll(block.number + 1);
        bool zeroForOne = !quoteIs0;
        DepositQuote memory q = hook.previewDeposit(key, zeroForOne, 10_000 * 10 ** decQuote, holder);
        assertTrue(q.exempt);
        assertFalse(q.flaggedNow);
        q = hook.previewDeposit(key, zeroForOne, 10_000 * 10 ** decQuote, rival);
        assertFalse(q.exempt);
        assertTrue(q.flaggedNow);
    }

    function _settledAlpha(address who, int64 price8) internal returns (uint16 alpha) {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swapAs(who, true, 10_000);
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found, "not flagged");
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        vm.recordLogs();
        vm.prank(keeper, keeper);
        settler.settle(r, _updateRaw(price8, t0, t0 - 1, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == ITouchstoneEvents.Settled.selector) {
                (,, alpha,) = abi.decode(logs[i].data, (int256, uint256, uint16, Payout));
            }
        }
    }
}
