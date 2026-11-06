// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {Vm} from "forge-std/Vm.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SettlementBase} from "./Settlement.t.sol";
import {MockStallingBeneficiary} from "../mocks/MockStallingBeneficiary.sol";
import {Record} from "../../src/types/Record.sol";
import {Payout} from "../../src/types/Payout.sol";
import {PoolState} from "../../src/types/PoolState.sol";

contract NativePayoutIsolationTest is SettlementBase {
    function setUp() public {
        _setUp(0, 6);
    }

    function test_StallingBeneficiaryCannotBlockSettlement() public {
        MockStallingBeneficiary beneficiary = new MockStallingBeneficiary(manager);
        Record memory r = _flag(500_000, true, abi.encode(address(beneficiary)));
        Payout memory p = _settleAt(r, 3_300e8, 0);
        assertGt(uint256(p.tip) + p.toLPs + p.toRebatePool, 0);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
        assertEq(ledger.owed(address(beneficiary), key.currency0), p.refund);
        assertEq(hook.poolState(id).outstanding0, 0);
        assertEq(manager.balanceOf(address(beneficiary), 0), 0, "failed push must roll back receiver mint");
        _assertLedgerSolvent(key.currency0);
    }

    function test_StallingBeneficiaryCannotBlockExpiry() public {
        MockStallingBeneficiary beneficiary = new MockStallingBeneficiary(manager);
        Record memory r = _flag(20_000, true, abi.encode(address(beneficiary)));
        (,, uint256 expiry) = settler.settleTime(r);
        vm.warp(expiry);
        settler.expire(r);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
        assertEq(ledger.owed(address(beneficiary), key.currency0), r.deposit);
        PoolState memory st = hook.poolState(id);
        assertEq(st.outstanding0, 0);
        _assertLedgerSolvent(key.currency0);
        address recipient = makeAddr("isolated-expiry-claim");
        vm.prank(address(beneficiary));
        ledger.claimAsClaims(key.currency0, recipient);
        assertEq(manager.balanceOf(recipient, key.currency0.toId()), r.deposit);
    }

    function test_StallingTipRecipientCannotBlockSettlement() public {
        MockStallingBeneficiary recipient = new MockStallingBeneficiary(manager);
        keeper = address(recipient);
        Record memory r = _flag(500_000, true, "");
        uint256 before = trader.balance;
        Payout memory p = _settleAt(r, 3_300e8, 0);
        assertGt(p.tip, 0);
        assertEq(trader.balance - before, p.refund);
        assertEq(ledger.owed(keeper, key.currency0), p.tip);
        assertEq(hook.recordHash(id, r.id), bytes32(0));
        _assertLedgerSolvent(key.currency0);
    }

    function _assertLedgerSolvent(Currency c) internal view {
        assertEq(manager.balanceOf(address(ledger), c.toId()), ledger.totalOwed(c));
    }
}

contract TokenPayoutIsolationTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function test_PausedTokenDefersTipAndRefundWithoutBlockingSettlement() public {
        Record memory r = _flagExactOutBuy(160);
        Currency c = _depositCurrency(r);
        vm.mockCallRevert(Currency.unwrap(c), abi.encodeWithSelector(IERC20Minimal.transfer.selector), "paused");
        Payout memory p = _settleAt(r, 3_300e8, 0);
        assertGt(p.tip, 0);
        assertEq(ledger.owed(keeper, c), p.tip);
        assertEq(ledger.owed(trader, c), p.refund);
        assertEq(manager.balanceOf(address(ledger), c.toId()), ledger.totalOwed(c));
        assertEq(hook.recordHash(id, r.id), bytes32(0));
        vm.clearMockedCalls();
        uint256 before = _balance(c, keeper);
        ledger.push(keeper, c);
        assertEq(_balance(c, keeper) - before, p.tip);
    }

    function test_SameRefundAndTipRecipientReceivesBoth() public {
        keeper = trader;
        Record memory r = _flagExactOutBuy(160);
        Currency c = _depositCurrency(r);
        uint256 before = _balance(c, trader);
        vm.recordLogs();
        Payout memory p = _settleAt(r, 3_300e8, 0);
        assertGt(p.tip, 0);
        assertEq(_balance(c, trader) - before, uint256(p.refund) + p.tip);
        assertEq(ledger.owed(trader, c), 0);
        assertEq(ledger.totalOwed(c), 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != RefundDeferred.selector, "delivered refund was marked deferred");
        }
    }
}
