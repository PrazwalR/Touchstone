// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SettlementBase} from "./Settlement.t.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {Record} from "../../src/types/Record.sol";
import {Payout} from "../../src/types/Payout.sol";
import {RecordLib} from "../../src/libraries/RecordLib.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {SettlementMath} from "../../src/libraries/SettlementMath.sol";

contract ItmActualReceiptsTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function test_BuyAcrossLiquidityBoundaryWithoutOvershootUsesActualReceipts() public {
        _assertActualReceipts(false);
    }

    function test_SellAcrossLiquidityBoundaryWithoutOvershootUsesActualReceipts() public {
        _assertActualReceipts(true);
    }

    function _assertActualReceipts(bool sell) internal {
        (, int24 tick,,) = StateLibrary.getSlot0(manager, id);
        int24 lower = tick / TICK_SPACING * TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) lower -= TICK_SPACING;
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: lower,
                tickUpper: lower + TICK_SPACING,
                liquidityDelta: int256(uint256(liquidity())),
                salt: bytes32(uint256(1))
            }),
            ""
        );
        // Keep the deposit cap nonbinding so a reconstruction error cannot hide behind min(D, R).
        feed.set(sell ? int256(1_000e8) : int256(5_000e8), block.timestamp);
        Record memory r = sell ? _flag(100_000, false, "") : _flagExactOutBuy(30);
        assertEq(r.liquidityBefore, uint256(liquidity()) * 2);
        assertEq(StateLibrary.getLiquidity(manager, id), liquidity(), "swap must cross the narrow position's boundary");

        uint256 post = PriceLib.poolPriceX36(r.sqrtPriceAfterX96, !quoteIs0);
        uint256 postUsd8 = FullMath.mulDiv(post, 10 ** decRisky * 1e8, 10 ** decQuote * 1e36);
        int64 fair8 = int64(int256(postUsd8 * (sell ? 9_999 : 10_001) / 10_000));
        uint256 fair = PriceLib.fairPriceX36(fair8, -8, 1e8, -8, decRisky, decQuote);
        uint160 sqrtFair = PriceLib.sqrtPriceX96At(fair, !quoteIs0);
        if (r.zeroForOne) assertLe(sqrtFair, r.sqrtPriceAfterX96, "fair price must lie beyond the full sell leg");
        else assertGe(sqrtFair, r.sqrtPriceAfterX96, "fair price must lie beyond the full buy leg");
        (int256 xRisky, int256 xQuote) = RecordLib.receipts(r, quoteIs0);
        int256 markout = SettlementMath.markout(xRisky, xQuote, fair);
        uint256 notional = RecordLib.notional(r, quoteIs0);
        assertGt(markout, 0);
        // Spec: the whole realized leg applies without overshoot; alpha=.8 and epsilon=2 bps.
        uint256 expected = (uint256(markout) - notional * 2 / 10_000) * 8_000 / 10_000;
        assertGt(expected, 0);
        assertLt(expected, r.deposit, "deposit cap must not mask the actual-receipt result");
        assertEq(SettlementMath.clawback(r.deposit, markout, notional, 2, 0, 8_000), expected);
        Payout memory p = _settleAt(r, fair8, 0);
        uint256 retained = uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs;
        emit log_named_uint("actual-receipt expected retention", expected);
        emit log_named_uint("settlement retention", retained);
        assertEq(retained, expected, "without overshoot, m+ and N+ must use the actual receipts");
    }
}
