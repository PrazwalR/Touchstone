// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BitMath} from "v4-core/libraries/BitMath.sol";
import {LiquidityMath} from "v4-core/libraries/LiquidityMath.sol";
import {ProtocolFeeLibrary} from "v4-core/libraries/ProtocolFeeLibrary.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {SwapMath} from "v4-core/libraries/SwapMath.sol";
import {TickBitmap} from "v4-core/libraries/TickBitmap.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolId} from "v4-core/types/PoolId.sol";

/// @title StaticQuoteLib
/// @notice A view-only port of v4-core's Pool.swap loop at the pinned commit (spec §12.2). It reads the pool through
/// StateLibrary and returns the AMM amounts a swap would execute with, without the hook's deposit.
/// @dev Mirrors Pool.swap line for line: fee from slot0 (the Touchstone hook never overrides it), protocol fee as
/// calculateSwapFee combines it, the step loop with SwapMath.computeSwapStep, and the tick transition. Fee growth
/// is not tracked, because it does not change the amounts. A quote that would cross more than `maxTicks` initialized
/// ticks (spec §12.2), or step across more than `maxTicks` empty bitmap words, or whose inputs Pool.swap would reject,
/// returns ok = false, which URC-4 reads as "cannot price". The second cap is what makes maxGas() a bound: empty
/// words cost a loop iteration each and are otherwise unlimited (decision 0057).
library StaticQuoteLib {
    using StateLibrary for IPoolManager;
    using SafeCast for uint256;
    using SafeCast for int256;

    /// @notice Upper bound on a quote's fixed cost: the hook's forward, the lens's evaluation and one loop step.
    /// Measured 100,052 (QuoteGasTest.test_Gas_QuoteBase), rounded up.
    uint32 internal constant QUOTE_BASE_GAS = 105_000;
    /// @notice Upper bound on the cost of one unit of tick budget: an initialized-tick crossing in a cold word plus
    /// one empty-word step. Measured 16,323 per unit on the worst layout found (1,144,740 gas for 64 units,
    /// QuoteGasTest.test_Gas_QuoteWorstCaseOnePerWord), rounded up.
    uint32 internal constant QUOTE_GAS_PER_TICK = 17_000;

    struct Quote {
        bool ok;
        int128 amount0; // the swapper's side, as BalanceDelta signs it: negative is paid in
        int128 amount1;
    }

    /// @dev The swap's inputs and the loop's running state, kept in memory to stay within the stack limit.
    struct Run {
        PoolId id;
        int24 tickSpacing;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 limit;
        int256 remaining;
        int256 calculated;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint24 swapFee;
        uint256 crossed; // initialized ticks crossed
        uint256 skipped; // empty bitmap-word boundaries stepped across
    }

    /// @notice The amounts `amountSpecified` would swap for in the pool's current state.
    /// @param manager The PoolManager.
    /// @param id The pool.
    /// @param tickSpacing The pool's tick spacing.
    /// @param zeroForOne Direction.
    /// @param amountSpecified Negative for exact input, positive for exact output, as Pool.swap takes it.
    /// @param sqrtPriceLimitX96 Price limit.
    /// @param maxTicks Most initialized ticks the quote may cross, and most empty bitmap words it may step across.
    /// @return q The amounts, or ok = false.
    function quote(
        IPoolManager manager,
        PoolId id,
        int24 tickSpacing,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        uint256 maxTicks
    ) internal view returns (Quote memory q) {
        Run memory r = Run({
            id: id,
            tickSpacing: tickSpacing,
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            limit: sqrtPriceLimitX96,
            remaining: amountSpecified,
            calculated: 0,
            sqrtPriceX96: 0,
            tick: 0,
            liquidity: 0,
            swapFee: 0,
            crossed: 0,
            skipped: 0
        });
        if (!_start(manager, r)) return q;
        while (!(r.remaining == 0 || r.sqrtPriceX96 == r.limit)) {
            _step(manager, r);
            if (r.crossed > maxTicks || r.skipped > maxTicks) return q;
        }
        int128 specified = (amountSpecified - r.remaining).toInt128();
        int128 calculated = r.calculated.toInt128();
        // Pool.swap: "if currency1 is specified".
        (q.amount0, q.amount1) = zeroForOne != (amountSpecified < 0) ? (calculated, specified) : (specified, calculated);
        q.ok = true;
    }

    /// @dev Pool.swap's set-up: the fee, and the checks it would revert on. False means the quote cannot price.
    function _start(IPoolManager manager, Run memory r) private view returns (bool) {
        uint24 protocolFees;
        uint24 lpFee;
        (r.sqrtPriceX96, r.tick, protocolFees, lpFee) = manager.getSlot0(r.id);
        if (r.sqrtPriceX96 == 0 || r.amountSpecified == 0) return false;
        uint16 protocolFee = r.zeroForOne
            ? ProtocolFeeLibrary.getZeroForOneFee(protocolFees)
            : ProtocolFeeLibrary.getOneForZeroFee(protocolFees);
        r.swapFee = protocolFee == 0 ? lpFee : ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee);
        if (r.swapFee >= SwapMath.MAX_SWAP_FEE && r.amountSpecified > 0) return false;
        if (!_limitValid(r.zeroForOne, r.limit, r.sqrtPriceX96)) return false;
        r.liquidity = manager.getLiquidity(r.id);
        return true;
    }

    /// @dev One iteration of Pool.swap's loop.
    function _step(IPoolManager manager, Run memory r) private view {
        uint160 start = r.sqrtPriceX96;
        (int24 tickNext, bool initialized) = _nextInitializedTick(manager, r.id, r.tick, r.tickSpacing, r.zeroForOne);
        if (tickNext <= TickMath.MIN_TICK) tickNext = TickMath.MIN_TICK;
        if (tickNext >= TickMath.MAX_TICK) tickNext = TickMath.MAX_TICK;
        uint160 sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(tickNext);

        uint256 amountIn;
        uint256 amountOut;
        uint256 feeAmount;
        (r.sqrtPriceX96, amountIn, amountOut, feeAmount) = SwapMath.computeSwapStep(
            r.sqrtPriceX96,
            SwapMath.getSqrtPriceTarget(r.zeroForOne, sqrtPriceNextX96, r.limit),
            r.liquidity,
            r.remaining,
            r.swapFee
        );
        // As in Pool.swap: SwapMath never returns more than the remaining amount, so these cannot overflow.
        if (r.amountSpecified > 0) {
            unchecked {
                r.remaining -= amountOut.toInt256();
            }
            r.calculated -= (amountIn + feeAmount).toInt256();
        } else {
            unchecked {
                r.remaining += (amountIn + feeAmount).toInt256();
            }
            r.calculated += amountOut.toInt256();
        }

        if (r.sqrtPriceX96 == sqrtPriceNextX96) {
            _cross(manager, r, tickNext, initialized);
        } else if (r.sqrtPriceX96 != start) {
            r.tick = TickMath.getTickAtSqrtPrice(r.sqrtPriceX96);
        }
    }

    /// @dev Pool.swap's tick transition at a tick boundary.
    function _cross(IPoolManager manager, Run memory r, int24 tickNext, bool initialized) private view {
        if (initialized) {
            (, int128 liquidityNet) = manager.getTickLiquidity(r.id, tickNext);
            // liquidityNet is never type(int128).min, as in Pool.swap.
            unchecked {
                if (r.zeroForOne) liquidityNet = -liquidityNet;
            }
            r.liquidity = LiquidityMath.addDelta(r.liquidity, liquidityNet);
            r.crossed += 1;
        } else {
            r.skipped += 1;
        }
        // Pool.swap: tickNext is within [MIN_TICK, MAX_TICK], so tickNext - 1 cannot underflow int24.
        unchecked {
            r.tick = r.zeroForOne ? tickNext - 1 : tickNext;
        }
    }

    /// @dev TickBitmap.nextInitializedTickWithinOneWord, with the bitmap word read through StateLibrary.
    function _nextInitializedTick(IPoolManager manager, PoolId id, int24 tick, int24 tickSpacing, bool lte)
        private
        view
        returns (int24 next, bool initialized)
    {
        // As in TickBitmap: tick and tickSpacing are bounded by TickMath, so the arithmetic cannot overflow.
        unchecked {
            int24 compressed = TickBitmap.compress(tick, tickSpacing);
            if (lte) {
                (int16 wordPos, uint8 bitPos) = TickBitmap.position(compressed);
                uint256 mask = type(uint256).max >> (uint256(type(uint8).max) - bitPos);
                uint256 masked = manager.getTickBitmap(id, wordPos) & mask;
                initialized = masked != 0;
                next = initialized
                    ? (compressed - int24(uint24(bitPos - BitMath.mostSignificantBit(masked)))) * tickSpacing
                    : (compressed - int24(uint24(bitPos))) * tickSpacing;
            } else {
                (int16 wordPos, uint8 bitPos) = TickBitmap.position(++compressed);
                uint256 mask = ~((1 << bitPos) - 1);
                uint256 masked = manager.getTickBitmap(id, wordPos) & mask;
                initialized = masked != 0;
                next = initialized
                    ? (compressed + int24(uint24(BitMath.leastSignificantBit(masked) - bitPos))) * tickSpacing
                    : (compressed + int24(uint24(type(uint8).max - bitPos))) * tickSpacing;
            }
        }
    }

    /// @dev Pool.swap's price-limit checks.
    function _limitValid(bool zeroForOne, uint160 limit, uint160 current) private pure returns (bool) {
        if (zeroForOne) return limit < current && limit > TickMath.MIN_SQRT_PRICE;
        return limit > current && limit < TickMath.MAX_SQRT_PRICE;
    }
}
