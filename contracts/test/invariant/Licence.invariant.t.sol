// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {LicenceAuction} from "../../src/LicenceAuction.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {ITouchstoneEvents} from "../../src/interfaces/ITouchstoneEvents.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {Lease} from "../../src/types/Lease.sol";
import {MockTrustedRouter} from "../mocks/MockTrustedRouter.sol";
import {IHookUnderTest, TouchstoneFixture} from "../utils/TouchstoneFixture.sol";

/// @notice Drives random bids, top-ups, withdrawals, accruals, refunds, time jumps and swaps by the holder and an
/// outsider on a licence pool.
contract LicenceHandler is Test, ITouchstoneEvents {
    uint32 internal constant K = 60;

    LicenceAuction internal auction;
    IHookUnderTest internal hook;
    MockTrustedRouter internal router;
    PoolKey internal key;
    PoolId internal id;
    MockERC20 internal quoteToken;
    bool internal quoteIs0;
    uint256 internal quoteUnit;
    address[2] internal actors;

    // Ghosts.
    bool public exemptViolation;
    uint256 public exemptSwaps;
    uint256 public rentCharged;
    uint256 public rentCredited;
    uint256 public chargeBound;
    mapping(uint256 => bool) internal largeSwapInBlock;
    mapping(uint256 => uint256) internal exemptInBlock;

    constructor(LicenceAuction a, IHookUnderTest h, MockTrustedRouter r, PoolKey memory k, bool q0, uint8 decQuote) {
        auction = a;
        hook = h;
        router = r;
        key = k;
        id = k.toId();
        quoteIs0 = q0;
        quoteUnit = 10 ** decQuote;
        quoteToken = MockERC20(Currency.unwrap(q0 ? k.currency0 : k.currency1));
        actors = [makeAddr("holderA"), makeAddr("holderB")];
        for (uint256 i; i < 2; ++i) {
            quoteToken.mint(actors[i], type(uint96).max);
            vm.prank(actors[i]);
            quoteToken.approve(address(a), type(uint256).max);
        }
        for (uint256 i; i < 2; ++i) {
            MockERC20 t = MockERC20(Currency.unwrap(i == 0 ? k.currency0 : k.currency1));
            t.mint(address(this), type(uint128).max);
            t.approve(address(r), type(uint256).max);
        }
    }

    function actorsList() external view returns (address[2] memory) {
        return actors;
    }

    // --- actions -------------------------------------------------------------------------------

    function bid(uint256 who, uint256 rentSeed, uint256 depositSeed) external {
        address a = actors[who % 2];
        uint128 minimum = auction.minNextRent(id);
        uint128 rent = uint128(bound(rentSeed, minimum, uint256(minimum) * 3 + 10));
        uint128 deposit = uint128(bound(depositSeed, uint256(rent) * K, uint256(rent) * K * 50));
        vm.recordLogs();
        vm.prank(a);
        auction.bid(id, a, rent, deposit);
        _collect();
    }

    function topUp(uint256 who, uint256 amountSeed, bool isTop) external {
        address a = actors[who % 2];
        (Lease memory top, Lease memory next) = auction.leases(id);
        if ((isTop ? top.owner : next.owner) != a) return;
        vm.recordLogs();
        vm.prank(a);
        auction.topUp(id, uint128(bound(amountSeed, 1, 1e9)), isTop);
        _collect();
    }

    function withdraw(uint256 who, uint256 amountSeed, bool isTop) external {
        address a = actors[who % 2];
        (Lease memory top, Lease memory next) = auction.leases(id);
        Lease memory l = isTop ? top : next;
        if (l.owner != a) return;
        uint256 notice = uint256(l.rent) * K;
        if (l.deposit <= notice) return;
        vm.recordLogs();
        vm.prank(a);
        auction.withdraw(id, uint128(bound(amountSeed, 1, l.deposit - notice)), isTop, a);
        _collect();
    }

    function accrue() external {
        vm.recordLogs();
        auction.accrue(id);
        _collect();
    }

    function claimRefund(uint256 who) external {
        address a = actors[who % 2];
        if (auction.refunds(a, Currency.wrap(address(quoteToken))) == 0) return;
        vm.prank(a);
        auction.claimRefund(Currency.wrap(address(quoteToken)), a);
    }

    /// @dev I13's bound: whichever lease is active over the jump pays at most the larger of the two standing rents.
    function warp(uint256 secondsSeed) external {
        uint256 dt = bound(secondsSeed, 1, 2 days);
        (Lease memory top, Lease memory next) = auction.leases(id);
        uint256 rate = top.rent > next.rent ? top.rent : next.rent;
        chargeBound += rate * dt;
        vm.warp(block.timestamp + dt);
        vm.roll(block.number + 1);
    }

    /// @dev A large swap attributed to one actor, in this block or the next.
    function swap(uint256 who, uint256 usdSeed, bool buy, bool sameBlock) external {
        if (!sameBlock) vm.roll(block.number + 1);
        address a = actors[who % 2];
        (address swapper, bool live) = auction.holderOf(id);
        bool firstInBlock = !largeSwapInBlock[block.number];
        router.setMsgSender(a);
        uint256 usd = bound(usdSeed, 6_000, 40_000);
        bool zeroForOne = buy == quoteIs0;
        uint256 amount = buy ? usd * quoteUnit : usd * 1e18 / 3_000;
        vm.recordLogs();
        router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        largeSwapInBlock[block.number] = true;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(hook) || logs[i].topics[0] != LicensedSwap.selector) continue;
            exemptSwaps += 1;
            exemptInBlock[block.number] += 1;
            // I11: only the live holder, only as the block's first large swap, at most once per block.
            if (!live || swapper != a || !firstInBlock || exemptInBlock[block.number] > 1) exemptViolation = true;
        }
    }

    function _collect() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(auction) && logs[i].topics[0] == RentCharged.selector) {
                rentCharged += abi.decode(logs[i].data, (uint256));
            }
            if (logs[i].emitter == address(hook) && logs[i].topics[0] == RentCredited.selector) {
                (uint256 amount,,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                rentCredited += amount;
            }
        }
    }
}

contract LicenceInvariantTest is TouchstoneFixture {
    LicenceHandler internal handler;

    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.flags |= PoolFlags.LICENCE;
    }

    function defaultLease() internal pure override returns (ILicenceAuction.LeaseParams memory) {
        return ILicenceAuction.LeaseParams({k: 60, minIncrementBps: 1_000, minRent: 1});
    }

    function setUp() public {
        _setUp(18, 6);
        handler = new LicenceHandler(licence, hook, trustedRouter, key, quoteIs0, decQuote);
        targetContract(address(handler));
        excludeSender(address(hook));
        excludeSender(address(manager));
        excludeSender(address(licence));
    }

    /// @dev The handler's own actions reach the fast path, so I11 is not vacuous: one exempt swap, then a same-block
    /// repeat that is not exempt.
    function test_HandlerReachesTheFastPath() public {
        handler.bid(0, 0, 0);
        handler.warp(60);
        handler.swap(0, 10_000, true, false);
        assertEq(handler.exemptSwaps(), 1);
        handler.swap(0, 10_000, false, true);
        assertEq(handler.exemptSwaps(), 1);
        assertFalse(handler.exemptViolation());
    }

    /// @dev I11: at most one exempt swap per pool per block, and it is the holder's first touch.
    function invariant_I11_OneExemptSwapPerBlock() public view {
        assertFalse(handler.exemptViolation());
    }

    /// @dev I12: after an accrual the auction holds exactly both deposits plus the refunds it owes, and every unit of
    /// rent charged was credited to the hook.
    function invariant_I12_AuctionBalanced() public {
        uint256 snap = vm.snapshotState();
        licence.accrue(id);
        (Lease memory top, Lease memory next) = licence.leases(id);
        uint256 owed = uint256(top.deposit) + next.deposit;
        address[2] memory a = handler.actorsList();
        for (uint256 i; i < 2; ++i) {
            owed += licence.refunds(a[i], quote);
        }
        assertEq(MockERC20(Currency.unwrap(quote)).balanceOf(address(licence)), owed);
        vm.revertToState(snap);
        assertEq(handler.rentCharged(), handler.rentCredited());
    }

    /// @dev I13: rent charged never exceeds rent x seconds active.
    function invariant_I13_RentWithinTime() public view {
        assertLe(handler.rentCharged(), handler.chargeBound());
    }

    /// @dev I1 with rent flowing in: the hook's claims equal outstanding + vest + rebate pool, per currency.
    function invariant_I1_HookClaimsWithRent() public view {
        PoolState memory st = hook.poolState(id);
        assertEq(
            manager.balanceOf(address(hook), key.currency0.toId()), uint256(st.outstanding0) + st.vest0 + st.rebatePool0
        );
        assertEq(
            manager.balanceOf(address(hook), key.currency1.toId()), uint256(st.outstanding1) + st.vest1 + st.rebatePool1
        );
    }
}
