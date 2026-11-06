// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {PoolConfig} from "ts/src/types/PoolConfig.sol";

/// A contract with a fallback that returns nothing, e.g. a proxy without an implementation.
contract SilentFallback { fallback() external {} }

contract CodelessFeedTest is TouchstoneFixture {
    function _create(address ref) internal {
        _deployCore();
        decQuote = 6; decRisky = 18;
        quote = Currency.wrap(address(new MockERC20("Quote", "Q", 6)));
        risky = Currency.wrap(address(0));
        quoteIs0 = false;
        key = PoolKey({currency0: risky, currency1: quote, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
        id = key.toId();
        _fund(address(this));
        _fund(trader);
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = ref;
        factory.createPool(key, c, _sqrtPriceAt(ETH_USD));
        _addLiquidity(key, liquidity());
    }

    function test_PoC_FeedWithoutCodeRevertsLargeSwaps() public {
        _create(makeAddr("wrong-chain-feed"));
        // Below N0 and the flow threshold: the reference is never read, the swap passes.
        _swap(trader, true, true, 1_000 * 10 ** decQuote, "");
        // At or above N0 the hook reads the reference; decoding empty return data is not caught.
        vm.expectRevert();
        _swap(trader, true, true, 20_000 * 10 ** decQuote, "");
    }

    function test_PoC_SilentFallbackFeedRevertsLargeSwaps() public {
        _create(address(new SilentFallback()));
        vm.expectRevert();
        _swap(trader, true, true, 20_000 * 10 ** decQuote, "");
    }
}
