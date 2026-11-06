// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SettlementBase} from "test/unit/Settlement.t.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {PriceLib} from "src/libraries/PriceLib.sol";
import {RecordLib} from "src/libraries/RecordLib.sol";
import {SettlementMath} from "src/libraries/SettlementMath.sol";
import {Record} from "src/types/Record.sol";
import {Payout} from "src/types/Payout.sol";

/// @notice Original protocol-fee witness, updated to assert the approved repair.
/// @dev Before decision 0044, this losing swap retained 1.754427 USDC and sent 1.547406 USDC to LPs.
contract ProtocolFeeWitness is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
        PoolManager(address(manager)).setProtocolFeeController(address(this));
        manager.setProtocolFee(key, uint24(1_000 | (1_000 << 12)));
    }

    /// @notice The executed fee snapshot prevents retaining from the originally demonstrated losing swap.
    function test_ProtocolFeeNoLongerInflatesRetainedMarkout() public {
        Record memory r = _flagExactOutBuy(2);
        (int256 xRisky, int256 xQuote) = RecordLib.receipts(r, quoteIs0);
        uint256 fair = PriceLib.fairPriceX36(3_005e8, -8, 1e8, -8, decRisky, decQuote);
        int256 actualMarkout = SettlementMath.markout(xRisky, xQuote, fair);
        emit log_named_int("actual markout, quote base units", actualMarkout);
        emit log_named_int("actual quote receipt, quote base units", xQuote);
        Payout memory p = _settleAt(r, 3_005e8, 0);
        uint256 retained = uint256(p.tip) + p.toProtocol + p.toRebatePool + p.toLPs;
        emit log_named_uint("retained, quote base units", retained);
        emit log_named_uint("to LPs, quote base units", p.toLPs);
        assertTrue(RecordLib.depositIsQuote(r, quoteIs0), "quote deposit");
        assertLt(actualMarkout, 0, "trader loses against the same Pyth price");
        assertEq(r.swapFeePips, 1_500);
        assertEq(retained, 0, "a losing full-ITM swap must not pay a clawback");
        assertEq(p.refund, r.deposit);
    }
}
