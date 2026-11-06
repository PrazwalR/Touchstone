// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {Record} from "../../src/types/Record.sol";

import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {IALFHook} from "../../src/interfaces/IALFHook.sol";

import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {VmSafe} from "forge-std/Vm.sol";

/// @notice Gas the hook adds to each swap path, measured as the difference from a hookless twin pool
/// with identical liquidity, executing the identical swap from the identical state. Each path is
/// written to snapshots/ and checked against the preserved baseline by scripts/check_release_gates.py.
contract SwapGasTest is TouchstoneFixture {
    PoolKey internal twin;

    function setUp() public {
        _setUp(18, 6);
        twin = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        manager.initialize(twin, _sqrtPriceAt(ETH_USD));
        _addLiquidity(twin, liquidity());
        // Warm both pools and the bucket slot once so every measured swap is a steady-state swap.
        _buy(trader, 100);
        _twinBuy(100);
        vm.roll(block.number + 1);
    }

    function _twinBuy(uint256 usd) internal returns (uint256) {
        bool zeroForOne = quoteIs0;
        vm.prank(trader, trader);
        swapRouter.swap(
            twin,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(usd * 10 ** decQuote),
                sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
            }),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        return vm.lastCallGas().gasTotalUsed;
    }

    function _hookBuy(uint256 usd) internal returns (uint256) {
        _buy(trader, usd);
        return vm.lastCallGas().gasTotalUsed;
    }

    function test_Gas_UnflaggedBelowN0() public {
        uint256 hooked = _hookBuy(1_000);
        uint256 plain = _twinBuy(1_000);
        vm.snapshotValue("hook_added_unflagged_below_n0", hooked - plain);
    }

    function test_Gas_UnflaggedAtOrAboveN0() public {
        _hookBuy(20_000); // uses this block's first touch
        _twinBuy(20_000);
        uint256 hooked = _hookBuy(20_000);
        uint256 plain = _twinBuy(20_000);
        assertEq(hook.poolState(id).nextRecordId, 1, "second swap must be unflagged");
        vm.snapshotValue("hook_added_unflagged_at_or_above_n0", hooked - plain);
    }

    function test_Gas_Flagged() public {
        uint256 hooked = _hookBuy(20_000);
        uint256 plain = _twinBuy(20_000);
        assertEq(hook.poolState(id).nextRecordId, 1, "swap must be flagged");
        vm.snapshotValue("hook_added_flagged", hooked - plain);
    }

    function test_Gas_SettleExpireDrip() public {
        vm.recordLogs();
        _buy(trader, 500_000);
        (Record memory r,) = _lastRecord();
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        vm.prank(keeper, keeper);
        settler.settle(r, u);
        vm.snapshotValue("settle_retaining", vm.lastCallGas().gasTotalUsed);

        vm.roll(block.number + 1);
        vm.recordLogs();
        _buy(trader, 20_000);
        (Record memory r2,) = _lastRecord();
        (,, uint256 expiresAt) = settler.settleTime(r2);
        vm.warp(expiresAt);
        settler.expire(r2);
        vm.snapshotValue("expire", vm.lastCallGas().gasTotalUsed);

        vm.warp(block.timestamp + 10 minutes);
        hook.drip(key);
        vm.snapshotValue("drip", vm.lastCallGas().gasTotalUsed);
    }
}

/// @notice Gas on a licence pool (spec §10 target: the licence check adds at most 18k to a swap at or above N0, and
/// an exempt swap costs less than a flagged one). Written to snapshots/LicenceGasTest.json; these paths have no
/// pre-repair baseline, so they are recorded, not gated.
contract LicenceGasTest is TouchstoneFixture {
    PoolKey internal twin;
    address internal holder = makeAddr("holder");

    function defaultConfig() internal view override returns (PoolConfig memory c) {
        c = super.defaultConfig();
        c.flags |= PoolFlags.LICENCE;
    }

    function defaultLease() internal pure override returns (ILicenceAuction.LeaseParams memory) {
        return ILicenceAuction.LeaseParams({k: 60, minIncrementBps: 1_000, minRent: 1});
    }

    function setUp() public {
        _setUp(18, 6);
        twin = PoolKey({
            currency0: key.currency0,
            currency1: key.currency1,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        manager.initialize(twin, _sqrtPriceAt(ETH_USD));
        _addLiquidity(twin, liquidity());
        MockERC20 q = MockERC20(Currency.unwrap(quote));
        q.mint(holder, 1e12 * 10 ** decQuote);
        vm.prank(holder);
        q.approve(address(licence), type(uint256).max);
        _routerSwap(key, holder, 100);
        _routerSwap(twin, holder, 100);
        vm.roll(block.number + 1);
    }

    function _routerSwap(PoolKey memory k, address as_, uint256 usd) internal returns (uint256) {
        trustedRouter.setMsgSender(as_);
        bool zeroForOne = quoteIs0;
        vm.prank(trader, trader);
        trustedRouter.swap(
            k,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(usd * 10 ** decQuote),
                sqrtPriceLimitX96: zeroForOne ? MIN_LIMIT : MAX_LIMIT
            }),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
        return vm.lastCallGas().gasTotalUsed;
    }

    function test_Gas_LicenceBidAndAccrue() public {
        vm.prank(holder);
        licence.bid(id, holder, 10, 10 * 1 days);
        vm.snapshotValue("licence_bid", vm.lastCallGas().gasTotalUsed);
        vm.warp(block.timestamp + 60 + 600);
        licence.accrue(id);
        vm.snapshotValue("licence_accrue_with_rent", vm.lastCallGas().gasTotalUsed);
    }

    function test_Gas_ExemptAndOutsiderSwaps() public {
        vm.prank(holder);
        licence.bid(id, holder, 10, 10 * 1 days);
        vm.warp(block.timestamp + 60);
        // Steady state: the activation has been written by an accrual, as the keeper's housekeeping does.
        licence.accrue(id);
        vm.roll(block.number + 1);

        uint256 exempt = _routerSwap(key, holder, 20_000);
        uint256 plain = _routerSwap(twin, holder, 20_000);
        assertEq(hook.poolState(id).nextRecordId, 0, "the holder's first swap posts no deposit");
        vm.snapshotValue("hook_added_licence_exempt", exempt - plain);

        vm.roll(block.number + 1);
        uint256 outsider = _routerSwap(key, makeAddr("outsider"), 20_000);
        plain = _routerSwap(twin, makeAddr("outsider"), 20_000);
        assertEq(hook.poolState(id).nextRecordId, 1, "the outsider's first touch is flagged");
        vm.snapshotValue("hook_added_licence_outsider_flagged", outsider - plain);
    }

    /// @dev The licence check alone: the same flagged first-touch swap, through the same router, on two hooked
    /// pools that differ only in the LICENCE flag.
    function test_Gas_LicenceCheckAlone() public {
        PoolKey memory plainKey = key;
        plainKey.fee = 3_000;
        PoolConfig memory c = defaultConfig();
        c.flags &= ~PoolFlags.LICENCE;
        factory.createPool(plainKey, c, noLease(), _sqrtPriceAt(ETH_USD));
        _addLiquidity(plainKey, liquidity());
        _routerSwap(plainKey, holder, 100);
        // One earlier flagged swap on each pool, so both measured swaps find the hook's claims, outstanding deposits
        // and record counter already non-zero: the comparison then differs only in the licence check.
        vm.roll(block.number + 1);
        _routerSwap(key, makeAddr("warm"), 20_000);
        vm.roll(block.number + 1);
        _routerSwap(plainKey, makeAddr("warm"), 20_000);
        vm.prank(holder);
        licence.bid(id, holder, 10, 10 * 1 days);
        vm.warp(block.timestamp + 60);
        licence.accrue(id);

        vm.roll(block.number + 1);
        uint256 licensed = _routerSwap(key, makeAddr("outsider"), 20_000);
        vm.roll(block.number + 1);
        uint256 unlicensed = _routerSwap(plainKey, makeAddr("outsider"), 20_000);
        assertEq(hook.poolState(id).nextRecordId, 2);
        assertEq(hook.poolState(plainKey.toId()).nextRecordId, 2);
        vm.snapshotValue("licence_check_added", licensed - unlicensed);
    }
}

/// @notice Worst-case gas of a URC-4 quote at the default budget (spec §12.2): 64 initialized ticks crossed and up to
/// 64 empty bitmap words stepped across, each tick in its own cold bitmap word. Measured on a tick-spacing-1 pool,
/// where that many words fit inside the price range. The larger layout's figure, rounded up, is maxGas().
contract QuoteGasTest is TouchstoneFixture {
    using StateLibrary for IPoolManager;

    PoolKey internal fine;

    function setUp() public {
        _setUp(18, 6);
        fine = PoolKey({currency0: key.currency0, currency1: key.currency1, fee: FEE, tickSpacing: 1, hooks: key.hooks});
        factory.createPool(fine, defaultConfig(), noLease(), _sqrtPriceAt(ETH_USD));
    }

    /// @dev `pairs` positions whose 2 * pairs boundaries lie `stride` ticks apart in a buy's direction; returns the
    /// direction and a price limit just past the last boundary.
    function _layout(int24 stride, int24 pairs) internal returns (bool zeroForOne, uint160 limit) {
        zeroForOne = quoteIs0; // buying risky
        int24 dir = zeroForOne ? int24(-1) : int24(1);
        (, int24 tick,,) = manager.getSlot0(fine.toId());
        for (int24 i = 1; i <= pairs; ++i) {
            int24 a = tick + dir * (2 * i - 1) * stride;
            int24 b = tick + dir * (2 * i) * stride;
            (int24 lower, int24 upper) = a < b ? (a, b) : (b, a);
            lpRouter.modifyLiquidity(
                fine,
                ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: 1e15, salt: bytes32(0)}),
                ""
            );
        }
        limit = TickMath.getSqrtPriceAtTick(tick + dir * (2 * pairs * stride + 1));
    }

    function _quote(int24 stride, int24 pairs) internal returns (uint256 gas, uint256 amountIn, uint256 amountOut) {
        (bool zeroForOne, uint160 limit) = _layout(stride, pairs);
        (amountIn, amountOut) =
            IALFHook(address(hook)).swapToPrice(fine, zeroForOne, -int256(1_000_000_000 * 10 ** decQuote), limit, "");
        gas = vm.lastCallGas().gasTotalUsed;
    }

    function _measure(int24 stride, string memory name) internal {
        (uint256 gas, uint256 amountIn, uint256 amountOut) = _quote(stride, 32);
        assertGt(amountIn, 0, "the quote priced");
        assertGt(amountOut, 0, "the quote priced");
        vm.snapshotValue(name, gas);
        // Coverage builds without the optimizer, which inflates every figure; the bound holds for deployed code.
        if (!vm.isContext(VmSafe.ForgeContext.Coverage)) {
            assertLe(gas, IALFHook(address(hook)).maxGas(), "maxGas() covers this layout");
        }
    }

    /// @dev One initialized tick per word: each crossing reads a cold word and a cold tick, with an empty-word step
    /// between crossings. This fills both halves of the budget and is the worst layout found.
    function test_Gas_QuoteWorstCaseOnePerWord() public {
        _measure(256, "quote_64_ticks_one_per_word");
    }

    /// @dev Adjacent ticks: the dense case, where the word stays warm.
    function test_Gas_QuoteDense() public {
        _measure(1, "quote_64_ticks_dense");
    }

    /// @dev A quote with no tick in range: the fixed cost, one step.
    function test_Gas_QuoteBase() public {
        (bool zeroForOne,) = _layout(1, 0);
        (, int24 tick,,) = manager.getSlot0(fine.toId());
        uint160 limit = TickMath.getSqrtPriceAtTick(zeroForOne ? tick - 1 : tick + 1);
        IALFHook(address(hook)).swapToPrice(fine, zeroForOne, -int256(10 ** decQuote), limit, "");
        vm.snapshotValue("quote_base_one_step", vm.lastCallGas().gasTotalUsed);
    }

    /// @dev Two empty words between ticks: more than 64 empty-word steps before the 64th crossing, so the quote
    /// cannot price (decision 0057).
    function test_QuoteBeyondTheEmptyWordBudgetIsZero() public {
        (, uint256 amountIn, uint256 amountOut) = _quote(768, 32);
        assertEq(amountIn + amountOut, 0);
    }
}
