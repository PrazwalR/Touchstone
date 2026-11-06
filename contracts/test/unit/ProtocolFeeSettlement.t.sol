// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/PoolManager.sol";
import {SettlementBase} from "./Settlement.t.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {RecordLib} from "../../src/libraries/RecordLib.sol";
import {SettlementMath} from "../../src/libraries/SettlementMath.sol";
import {Record} from "../../src/types/Record.sol";
import {Payout} from "../../src/types/Payout.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";

contract ProtocolFeeSettlementTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
        PoolManager(address(manager)).setProtocolFeeController(address(this));
    }

    function test_ProtocolFeeDoesNotRetainFromLosingTrader() public {
        manager.setProtocolFee(key, uint24(1_000 | (1_000 << 12)));
        Record memory r = _flagExactOutBuy(2);
        assertEq(r.swapFeePips, 1_500);
        (int256 xRisky, int256 xQuote) = RecordLib.receipts(r, quoteIs0);
        uint256 fair = PriceLib.fairPriceX36(3_005e8, -8, 1e8, -8, decRisky, decQuote);
        assertLt(SettlementMath.markout(xRisky, xQuote, fair), 0, "trader lost against the same fair price");
        Payout memory p = _settleAt(r, 3_005e8, 0);
        assertTrue(p.benign);
        assertEq(p.refund, r.deposit);
        assertEq(uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs, 0);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
    }

    function test_SnapshotsDirectionalFeesForAllSwapCases() public {
        manager.setProtocolFee(key, uint24(1_000 | (100 << 12)));
        for (uint256 i; i < 4; ++i) {
            bool buy = i < 2;
            bool exactIn = i % 2 == 0;
            uint256 amount = buy == exactIn ? 6_000 * 10 ** decQuote : 2 * 10 ** decRisky;
            vm.roll(block.number + 1);
            vm.recordLogs();
            _swap(trader, buy, exactIn, amount, "");
            (Record memory r, bool found) = _lastRecord();
            assertTrue(found, "first touch must post a record");
            assertEq(r.swapFeePips, r.zeroForOne ? 1_500 : 600);
        }
    }

    function test_SettlementKeepsOriginalFeeAfterProtocolFeeIsRemoved() public {
        manager.setProtocolFee(key, uint24(1_000 | (1_000 << 12)));
        Record memory r = _flagExactOutBuy(2);
        manager.setProtocolFee(key, 0);
        Payout memory p = _settleAt(r, 3_005e8, 0);
        assertEq(r.swapFeePips, 1_500);
        assertTrue(p.benign, "current fee must not replace the executed fee");
        assertEq(p.refund, r.deposit);
        assertEq(p.toLPs, 0);
    }

    function test_SettlementKeepsOriginalFeeAfterProtocolFeeIsAdded() public {
        Record memory r = _flagExactOutBuy(2);
        assertEq(r.swapFeePips, FEE);
        uint256 snapshot = vm.snapshotState();
        Payout memory original = _settleAt(r, 3_005e8, 0);
        assertGt(original.toLPs, 0, "control must retain value");
        vm.revertToState(snapshot);
        manager.setProtocolFee(key, uint24(1_000 | (1_000 << 12)));
        Payout memory changed = _settleAt(r, 3_005e8, 0);
        assertEq(
            keccak256(abi.encode(changed)),
            keccak256(abi.encode(original)),
            "post-swap fee changes cannot reprice a record"
        );
    }

    function test_ExecutedFeeCannotBeForgedAtSettlement() public {
        Record memory r = _flagExactOutBuy(2);
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        r.swapFeePips += 1;
        bytes[] memory updates = _updateRaw(3_005e8, t0, t0 - 1, 0);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RecordClosed.selector, r.poolId, r.id));
        settler.settle(r, updates);
    }
}
