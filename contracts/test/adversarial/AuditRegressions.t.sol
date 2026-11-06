// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {BlockLib} from "../../src/libraries/BlockLib.sol";
import {PoolConfig} from "../../src/types/PoolConfig.sol";
import {SettlementBase} from "../unit/Settlement.t.sol";
import {MockShortFeed} from "../mocks/MockShortFeed.sol";

/// @dev hookData shape (audit AMM-10).
contract AuditErc20RegressionTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function test_AMM10_DirtyHookDataRevertsOnEverySwap() public {
        bytes memory dirty = abi.encode(uint256(type(uint160).max) + 1);
        vm.expectRevert();
        _swap(trader, true, true, 100 * 10 ** decQuote, dirty);
        bytes memory dirtySecond = abi.encode(address(this), uint256(1) << 200);
        vm.expectRevert();
        _swap(trader, true, true, 100 * 10 ** decQuote, dirtySecond);
        _swap(trader, true, true, 100 * 10 ** decQuote, abi.encode(address(this), address(this)));
    }
}

/// @dev Deployment- and creation-time checks.
contract AuditConfigRegressionTest is SettlementBase {
    function setUp() public {
        _setUp(18, 6);
    }

    function _key(uint24 fee, int24 spacing) internal view returns (PoolKey memory k) {
        k = key;
        k.fee = fee;
        k.tickSpacing = spacing;
    }

    function test_ORC6_RejectsIdenticalPriceIds() public {
        PoolConfig memory c = defaultConfig();
        c.quotePriceId = c.basePriceId;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(13)));
        factory.createPool(_key(3_000, 60), c, noLease(), _sqrtPriceAt(ETH_USD));
    }

    function test_GEN3_RejectsReferenceFeedWithoutCode() public {
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = makeAddr("wrong-chain-feed");
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(34)));
        factory.createPool(_key(3_000, 60), c, noLease(), _sqrtPriceAt(ETH_USD));
    }

    function test_GEN3_ShortReturnFeedReadsAsAbsentInsteadOfRevertingTheSwap() public {
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = address(new MockShortFeed());
        PoolKey memory k = _key(3_000, 60);
        factory.createPool(k, c, noLease(), _sqrtPriceAt(ETH_USD));
        _addLiquidity(k, liquidity());
        PoolKey memory saved = key;
        key = k;
        _swap(trader, true, true, 50_000 * 10 ** decQuote, "");
        key = saved;
    }

    function test_ORC2_RejectsUnknownBlockSource() public {
        bytes memory args = hookArgsWith(address(0), 7, address(0));
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__InvalidBlockSource.selector, uint8(7)));
        deployCodeTo("TouchstoneHook.sol:TouchstoneHook", args, address(uint160(HOOK_FLAGS) | (uint160(0x5555) << 144)));
    }

    function test_SequencerFeedWithoutCodeFailsAtDeployment() public {
        address noCode = makeAddr("no-code-sequencer");
        bytes memory args = hookArgsWith(address(0), BlockLib.SOURCE_EVM, noCode);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__NoCode.selector, noCode));
        deployCodeTo("TouchstoneHook.sol:TouchstoneHook", args, address(uint160(HOOK_FLAGS) | (uint160(0x5557) << 144)));
    }
}
