// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {PoolConfig} from "ts/src/types/PoolConfig.sol";
import {Record} from "ts/src/types/Record.sol";
import {BlockLib} from "ts/src/libraries/BlockLib.sol";

/// Returns a single word from latestRoundData: a call that succeeds with short returndata.
contract ShortFeed {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

contract OraclePoC is TouchstoneFixture {
    function setUp() public {
        _setUp(18, 6);
    }

    function _swapLarge() internal returns (bool ok) {
        vm.roll(block.number + 1);
        bool zeroForOne = true == quoteIs0;
        try this.doSwap(zeroForOne) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function doSwap(bool) external {
        _buy(trader, 50_000);
    }

    /// ORC-1: referenceFeed set to an address with no code. try/catch does not catch the ABI decode
    /// failure of empty returndata, so every large swap on the pool reverts.
    function test_NoCodeReferenceFeed_RevertsLargeSwaps() public {
        PoolKey memory k2 = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))
        });
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = makeAddr("feed-address-from-another-chain");
        factory.createPool(k2, c, _sqrtPriceAt(ETH_USD));
        _addLiquidity(k2, liquidity());
        key = k2;
        id = k2.toId();
        // Small swap below n0 and below nMin: never reads the feed, succeeds.
        vm.roll(block.number + 1);
        _buy(trader, 100);
        // Large swap: reverts inside afterSwap.
        assertFalse(_swapLarge(), "large swap should revert");
    }

    function test_ShortReturnReferenceFeed_RevertsLargeSwaps() public {
        PoolKey memory k2 = PoolKey({
            currency0: key.currency0, currency1: key.currency1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(hook))
        });
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = address(new ShortFeed());
        factory.createPool(k2, c, _sqrtPriceAt(ETH_USD));
        _addLiquidity(k2, liquidity());
        key = k2;
        id = k2.toId();
        assertFalse(_swapLarge(), "large swap should revert");
    }

    function _redeployHook(uint8 source, address seqFeed) internal {
        address[4] memory routers = [address(trustedRouter), address(0), address(0), address(0)];
        bytes memory args = abi.encode(
            manager, address(settler), address(ledger), address(factory), source, seqFeed, uint32(3600), routers
        );
        deployCodeTo("TouchstoneHook.sol:TouchstoneHook", args, address(hook));
    }

    /// ORC-1: SEQUENCER_FEED immutable set to an address with no code: every large swap on every pool reverts.
    function test_NoCodeSequencerFeed_RevertsLargeSwapsOnAllPools() public {
        assertTrue(_swapLarge(), "baseline large swap succeeds");
        _redeployHook(BlockLib.SOURCE_EVM, makeAddr("mainnet-uptime-feed"));
        assertFalse(_swapLarge(), "large swap should revert");
    }

    /// ORC-2: BLOCK_SOURCE = ARBSYS on a chain without the ArbSys precompile (Base, Ethereum).
    function test_ArbSysSourceOnNonArbitrum_RevertsLargeSwaps() public {
        assertTrue(_swapLarge(), "baseline large swap succeeds");
        _redeployHook(BlockLib.SOURCE_ARBSYS, address(0));
        assertFalse(_swapLarge(), "large swap should revert");
    }

    /// ORC-2: an out-of-range source is accepted and silently means block.number.
    function test_UnknownBlockSourceAccepted() public {
        _redeployHook(7, address(0));
        assertTrue(_swapLarge(), "source 7 behaves as SOURCE_EVM");
    }

    /// ORC-3: a stale reference silently drops the deposit to the floor rate, capping what LPs can retain.
    function test_StaleReference_DepositDropsToFloor() public {
        // Fair price is 3% above the pool; the feed shows it.
        feed.set(int256(3_090 * 1e8), block.timestamp);
        uint256 snap = vm.snapshotState();
        vm.roll(block.number + 1);
        vm.recordLogs();
        _buy(trader, 50_000);
        (Record memory live,) = _lastRecord();
        vm.revertToState(snap);
        // Same swap with the feed older than referenceMaxAge.
        vm.warp(block.timestamp + 3_601);
        vm.roll(block.number + 1);
        vm.recordLogs();
        _buy(trader, 50_000);
        (Record memory stale,) = _lastRecord();
        emit log_named_uint("deposit with live reference", live.deposit);
        emit log_named_uint("deposit with stale reference", stale.deposit);
        assertGt(live.deposit, stale.deposit * 5, "deposit depends on the reference");
    }

    /// ORC-4: settle still works after expiresAt, so expire and settle race once the window ends.
    function test_SettleAfterExpiry() public {
        vm.roll(block.number + 1);
        vm.recordLogs();
        _buy(trader, 500_000);
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(uint256(t0) + 1 days + 1);
        bytes[] memory u = _updateRaw(3_300e8, t0, t0 - 1, 0);
        vm.prank(keeper, keeper);
        settler.settle(r, u);
    }
}
