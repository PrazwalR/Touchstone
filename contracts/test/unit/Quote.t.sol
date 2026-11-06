// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IV4Quoter} from "v4-periphery/interfaces/IV4Quoter.sol";
import {V4Quoter} from "v4-periphery/lens/V4Quoter.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {IALFHook} from "../../src/interfaces/IALFHook.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {ITouchstoneFactory} from "../../src/interfaces/ITouchstoneFactory.sol";
import {ITouchstoneHook} from "../../src/interfaces/ITouchstoneHook.sol";
import {TouchstoneLens} from "../../src/periphery/TouchstoneLens.sol";
import {SettlementBase} from "./Settlement.t.sol";

/// @notice URC-4 quotes (spec §12.2, milestone M10): the quote equals what the swap then executes, deposit included.
contract QuoteTest is SettlementBase {
    IALFHook internal alf;

    function setUp() public {
        _setUp(18, 6);
        alf = IALFHook(address(hook));
    }

    /// @dev Narrow positions around the price, so quotes cross initialized ticks.
    function _addPositions(uint256 seed, uint256 count) internal {
        int24 tick = TickMath.getTickAtSqrtPrice(_poolSqrtPrice()) / TICK_SPACING * TICK_SPACING;
        for (uint256 i; i < count; ++i) {
            int24 lower = tick - int24(int256(1 + (uint256(keccak256(abi.encode(seed, i))) % 40))) * TICK_SPACING;
            int24 upper = tick + int24(int256(1 + (uint256(keccak256(abi.encode(seed, i, 1))) % 40))) * TICK_SPACING;
            lpRouter.modifyLiquidity(
                key,
                ModifyLiquidityParams({
                    tickLower: lower,
                    tickUpper: upper,
                    liquidityDelta: int256(uint256(liquidity() / 8)),
                    salt: bytes32(i)
                }),
                ""
            );
        }
    }

    /// @dev What the trader actually paid and received in the swap, from the router's settled delta.
    function _paidAndReceived(BalanceDelta d, bool zeroForOne) internal pure returns (uint256 paid, uint256 got) {
        (int128 inLeg, int128 outLeg) = zeroForOne ? (d.amount0(), d.amount1()) : (d.amount1(), d.amount0());
        paid = uint256(int256(-inLeg));
        got = uint256(int256(outLeg));
    }

    /// @dev Exact input and exact output, both directions, flagged or not: the URC-4 quote is what executes.
    function testFuzz_QuoteMatchesExecution(uint256 usd, bool buy, bool exactIn, uint256 seed, uint8 positions) public {
        _addPositions(seed, bound(positions, 0, 6));
        usd = bound(usd, 100, 400_000);
        uint256 amount = buy == exactIn ? usd * 10 ** decQuote : usd * 10 ** decRisky / ETH_USD;
        bool zeroForOne = buy == quoteIs0;
        int256 specified = exactIn ? -int256(amount) : int256(amount);
        vm.roll(block.number + 1);
        uint256 quoted = alf.getIndicativeQuote(key, zeroForOne, specified, "");
        (uint256 qIn, uint256 qOut) = alf.swapToPrice(
            key, zeroForOne, specified, zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1, ""
        );
        assertEq(quoted, exactIn ? qOut : qIn, "getIndicativeQuote is swapToPrice over the full range");

        BalanceDelta d = _swap(trader, buy, exactIn, amount, "");
        (uint256 paid, uint256 got) = _paidAndReceived(d, zeroForOne);
        assertEq(qIn, paid, "input");
        assertEq(qOut, got, "output");
    }

    /// @dev A price limit stops the quote where it stops the swap.
    function testFuzz_SwapToPriceStopsAtTheLimit(uint256 usd, uint256 limitBps) public {
        _addPositions(7, 4);
        usd = bound(usd, 1_000, 1_000_000);
        uint160 sqrtPrice = _poolSqrtPrice();
        bool zeroForOne = quoteIs0; // buys risky
        // A limit up to 2% away in the swap's direction.
        uint256 move = bound(limitBps, 2, 200);
        uint160 limit = zeroForOne
            ? uint160(uint256(sqrtPrice) * (10_000 - move / 2) / 10_000)
            : uint160(uint256(sqrtPrice) * (10_000 + move / 2) / 10_000);
        vm.roll(block.number + 1);
        (uint256 qIn, uint256 qOut) = alf.swapToPrice(key, zeroForOne, -int256(usd * 10 ** decQuote), limit, "");

        vm.prank(trader, trader);
        BalanceDelta d =
            swapRouter.swap(key, _params(zeroForOne, -int256(usd * 10 ** decQuote), limit), _settings(), "");
        (uint256 paid, uint256 got) = _paidAndReceived(d, zeroForOne);
        assertEq(qIn, paid);
        assertEq(qOut, got);
    }

    /// @dev The lens itself prices the same swap as v4-periphery's V4Quoter, which runs the real swap, hook included.
    function testFuzz_QuoteMatchesV4Quoter(uint256 usd, uint256 seed) public {
        _addPositions(seed, 5);
        usd = bound(usd, 100, 400_000);
        V4Quoter quoter = new V4Quoter(manager);
        bool zeroForOne = quoteIs0;
        vm.roll(block.number + 1);
        uint256 quoted = alf.getIndicativeQuote(key, zeroForOne, -int256(usd * 10 ** decQuote), "");
        (uint256 out,) = quoter.quoteExactInputSingle(
            IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: uint128(usd * 10 ** decQuote), hookData: ""
            })
        );
        assertEq(quoted, out);
    }

    /// @dev URC-4: a quote crossing more initialized ticks than MAX_QUOTE_TICKS (64) cannot price and returns 0,
    /// while a swap that stays within the budget still prices.
    function test_QuoteBeyondTheTickBudgetIsZero() public {
        int24 tick = TickMath.getTickAtSqrtPrice(_poolSqrtPrice()) / TICK_SPACING * TICK_SPACING;
        // 70 one-spacing positions on each side of the price: more than 64 initialized ticks either way.
        for (int24 i = 1; i <= 70; ++i) {
            _thin(tick + i * TICK_SPACING, tick + (i + 1) * TICK_SPACING, uint256(uint24(i)));
            _thin(tick - (i + 1) * TICK_SPACING, tick - i * TICK_SPACING, 1_000 + uint256(uint24(i)));
        }
        bool zeroForOne = quoteIs0; // a buy of the risky token
        assertGt(alf.getIndicativeQuote(key, zeroForOne, -int256(100 * 10 ** decQuote), ""), 0, "within budget");
        assertEq(alf.getIndicativeQuote(key, zeroForOne, -int256(5_000_000 * 10 ** decQuote), ""), 0, "beyond budget");
    }

    function _thin(int24 lower, int24 upper, uint256 salt) internal {
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: 1e12, salt: bytes32(salt)}),
            ""
        );
    }

    /// @dev A limit Pool.swap would reject (at or past the current price) cannot price, so the quote is (0, 0).
    function test_InvalidPriceLimitCannotPrice() public view {
        bool zeroForOne = quoteIs0;
        (uint256 qIn, uint256 qOut) = alf.swapToPrice(key, zeroForOne, -1e9, _poolSqrtPrice(), "");
        assertEq(qIn + qOut, 0);
    }

    function test_MalformedHookDataReverts() public {
        vm.expectRevert(IALFHook.MalformedHookData.selector);
        alf.getIndicativeQuote(key, true, -1e6, hex"01");
        vm.expectRevert(IALFHook.MalformedHookData.selector);
        alf.getIndicativeQuote(key, true, -1e6, abi.encode(uint256(1) << 200));
    }

    function test_ZeroBudgetIsRejected() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__ZeroQuoteBudget.selector);
        new TouchstoneLens(manager, ITouchstoneHook(address(hook)), ITouchstoneFactory(address(factory)), 0);
    }

    function test_InterfaceAnswers() public view {
        assertTrue(IERC165(address(hook)).supportsInterface(type(IALFHook).interfaceId));
        assertTrue(IERC165(address(hook)).supportsInterface(type(IERC165).interfaceId));
        assertFalse(IERC165(address(hook)).supportsInterface(0xdeadbeef));
        assertTrue(alf.isLive());
        assertEq(alf.maxGas(), 105_000 + 64 * 17_000);
    }

    /// @dev Only the hook can tell the lens a transaction already touched the pool; a direct caller's extra word is
    /// ignored.
    function test_LensIgnoresTheFlagFromOtherCallers() public {
        bool zeroForOne = quoteIs0;
        int256 specified = -int256(20_000 * 10 ** decQuote);
        bytes memory call = abi.encodeCall(IALFHook.getIndicativeQuote, (key, zeroForOne, specified, ""));
        vm.roll(block.number + 1);
        (bool okPlain, bytes memory plain) = address(lens).staticcall(call);
        (bool okForged, bytes memory forged) = address(lens).staticcall(bytes.concat(call, bytes32(uint256(1))));
        assertTrue(okPlain && okForged);
        assertEq(keccak256(plain), keccak256(forged));
    }

    function _params(bool zeroForOne, int256 amountSpecified, uint160 limit) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: limit});
    }

    function _settings() internal pure returns (PoolSwapTest.TestSettings memory) {
        return PoolSwapTest.TestSettings(false, false);
    }
}
