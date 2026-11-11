// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {PoolLiquidityVault} from "../../script/support/PoolLiquidityVault.sol";

/// @notice The vault that holds the demo pool's positions: only its owner can change them, and the open test router
/// cannot reach them (decision 0070).
contract PoolLiquidityVaultTest is TouchstoneFixture {
    using StateLibrary for IPoolManager;

    PoolLiquidityVault internal vault;
    int24 internal lower;
    int24 internal upper;

    function _params(int256 delta) internal view returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: delta, salt: 0});
    }

    function _vaultLiquidity() internal view returns (uint128 l) {
        (l,,) = manager.getPositionInfo(id, address(vault), lower, upper, 0);
    }

    function _prepare(uint8 riskyDecimals) internal {
        _setUp(riskyDecimals, 6);
        vault = new PoolLiquidityVault(manager, address(this));
        // A range around the current price that the open router has never touched. The fixture seeds the full range
        // through that router, so a full-range vault position would share an owner-less slot with it in the test.
        (, int24 tick,,) = manager.getSlot0(id);
        lower = (tick / TICK_SPACING) * TICK_SPACING - 600;
        upper = lower + 1200;
        MockERC20(Currency.unwrap(quote)).approve(address(vault), type(uint256).max);
        if (!risky.isAddressZero()) MockERC20(Currency.unwrap(risky)).approve(address(vault), type(uint256).max);
    }

    function _native(uint256 amount) internal view returns (uint256) {
        return risky.isAddressZero() ? amount : 0;
    }

    function test_OwnerAddsAndRemovesLiquidity() public {
        _prepare(18);
        uint256 quoteBefore = _balance(quote, address(this));
        vault.modifyLiquidity(key, _params(1e12));
        assertEq(_vaultLiquidity(), 1e12);
        assertLt(_balance(quote, address(this)), quoteBefore);

        vault.modifyLiquidity(key, _params(-1e12));
        assertEq(_vaultLiquidity(), 0);
        // Rounding in the pool's favour can leave a few units behind, never more.
        assertApproxEqAbs(_balance(quote, address(this)), quoteBefore, 2);
        assertEq(_balance(quote, address(vault)), 0);
    }

    function test_NativeValueIsRefundedAndTheVaultKeepsNothing() public {
        _prepare(0);
        uint256 ethBefore = address(this).balance;
        vault.modifyLiquidity{value: 10 ether}(key, _params(1e12));
        assertEq(_vaultLiquidity(), 1e12);
        assertEq(address(vault).balance, 0);
        // Only what the position needs was spent, so most of the 10 ether came back.
        assertGt(address(this).balance, ethBefore - 10 ether);

        vault.modifyLiquidity(key, _params(-1e12));
        assertApproxEqAbs(address(this).balance, ethBefore, 2);
        assertEq(address(vault).balance, 0);
    }

    function test_NonOwnerCannotChangeThePositions() public {
        _prepare(18);
        vault.modifyLiquidity(key, _params(1e12));
        vm.prank(trader);
        vm.expectRevert(PoolLiquidityVault.PoolLiquidityVault__NotOwner.selector);
        vault.modifyLiquidity(key, _params(-1e12));
        assertEq(_vaultLiquidity(), 1e12);
    }

    /// @dev The failure the vault exists to prevent: through the open router anyone could take a position it owns.
    function test_TheOpenRouterCannotRemoveTheVaultsPosition() public {
        _prepare(18);
        vault.modifyLiquidity(key, _params(1e12));
        vm.prank(trader);
        vm.expectRevert();
        lpRouter.modifyLiquidity(key, _params(-1e12), "");
        assertEq(_vaultLiquidity(), 1e12);
    }

    function test_TheCallbackAnswersOnlyThePoolManager() public {
        _prepare(18);
        vm.expectRevert(PoolLiquidityVault.PoolLiquidityVault__NotManager.selector);
        vault.unlockCallback("");
    }

    function test_AnOwnerThatCannotReceiveEtherCannotBeRefunded() public {
        _prepare(0);
        PoolLiquidityVault stuck = new PoolLiquidityVault(manager, address(new Rejecter()));
        vm.deal(address(stuck.OWNER()), 1 ether);
        vm.prank(stuck.OWNER());
        vm.expectRevert();
        stuck.modifyLiquidity{value: 1 ether}(key, _params(1e6));
    }
}

contract Rejecter {
    receive() external payable {
        revert();
    }
}
