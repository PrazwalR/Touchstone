// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title PriceLib
/// @notice The one place where prices change units. Every price Touchstone compares is quote base
/// units per risky base unit, scaled by 1e36.
/// @dev Pyth prices are (price, expo) pairs in USD per whole token; token decimals then move them to
/// base units. Getting either wrong mis-scales every markout, so this library is fuzzed against an
/// exact rational implementation (research/reference/touchstone_ref.py).
library PriceLib {
    /// @dev 1e36, not 1e18: an 18-decimal token worth $0.0001 against 6-decimal USDC has a base-unit
    /// ratio of 1e-16, which 1e18 would hold to two significant digits. Across the whole v4 price
    /// range a 1e36-scaled price stays below 2**248.
    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;
    /// @dev 10**76 is the largest power of ten below 2**256.
    int256 internal constant MAX_POW10 = 76;
    /// @dev Largest gap signedGapBps reports; 2^127 bps is beyond any meaningful dislocation.
    int256 internal constant MAX_GAP_BPS = type(int128).max;

    /// @notice P* from two Pyth USD prices.
    /// @param pBase Pyth price of the risky asset.
    /// @param eBase Pyth exponent of the risky asset.
    /// @param pQuote Pyth price of the quote asset.
    /// @param eQuote Pyth exponent of the quote asset.
    /// @param decRisky Decimals of the risky token (18 for native ETH).
    /// @param decQuote Decimals of the quote token.
    /// @return priceX36 Quote base units per risky base unit, times 1e36, rounded down.
    function fairPriceX36(int64 pBase, int32 eBase, int64 pQuote, int32 eQuote, uint8 decRisky, uint8 decQuote)
        internal
        pure
        returns (uint256 priceX36)
    {
        if (pBase <= 0 || pQuote <= 0) revert ITouchstoneErrors.Touchstone__NonPositivePrice();
        int256 k = int256(eBase) - int256(eQuote) + int256(uint256(decQuote)) - int256(uint256(decRisky)) + 36;
        if (k > MAX_POW10 || k < -MAX_POW10) revert ITouchstoneErrors.Touchstone__ExponentOutOfRange(k);
        uint256 base = uint256(int256(pBase));
        uint256 quote = uint256(int256(pQuote));
        if (k >= 0) return FullMath.mulDiv(base, 10 ** uint256(k), quote);
        return base / (quote * 10 ** uint256(-k));
    }

    /// @notice Pyth confidence of the ratio, conf_b/p_b + conf_q/p_q, in basis points, rounded up.
    /// @dev Rounding up widens the deadband, which can only lower what LPs retain.
    function confBpsUp(int64 pBase, uint64 confBase, int64 pQuote, uint64 confQuote) internal pure returns (uint256) {
        if (pBase <= 0 || pQuote <= 0) revert ITouchstoneErrors.Touchstone__NonPositivePrice();
        uint256 b = uint256(int256(pBase));
        uint256 q = uint256(int256(pQuote));
        uint256 num = (uint256(confBase) * q + uint256(confQuote) * b) * BPS;
        return FullMath.mulDivRoundingUp(num, 1, b * q);
    }

    /// @notice The pool's price as quote base units per risky base unit, times 1e36.
    /// @param sqrtPriceX96 Pool sqrt price, token1 per token0.
    /// @param riskyIs0 True if currency0 is the risky asset.
    function poolPriceX36(uint160 sqrtPriceX96, bool riskyIs0) internal pure returns (uint256) {
        uint256 q192 = uint256(FixedPoint96.Q96) << 96;
        if (sqrtPriceX96 <= type(uint128).max) {
            // The square fits in 256 bits, so one mulDiv keeps every digit.
            uint256 sq = uint256(sqrtPriceX96) * sqrtPriceX96;
            return riskyIs0 ? FullMath.mulDiv(sq, PRICE_SCALE, q192) : FullMath.mulDiv(PRICE_SCALE, q192, sq);
        }
        // Above 2^128 the square needs two steps; the first rounding is below 2^-32 relative here.
        uint256 p96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, FixedPoint96.Q96);
        return riskyIs0
            ? FullMath.mulDiv(p96, PRICE_SCALE, FixedPoint96.Q96)
            : FullMath.mulDiv(PRICE_SCALE, FixedPoint96.Q96, p96);
    }

    /// @notice The sqrt price, token1 per token0, at which the pool would quote `priceX36`.
    function sqrtPriceX96At(uint256 priceX36, bool riskyIs0) internal pure returns (uint160) {
        return riskyIs0 ? _sqrtRatioX96(priceX36, PRICE_SCALE) : _sqrtRatioX96(PRICE_SCALE, priceX36);
    }

    /// @notice Signed gap s * (ref - pool) / ref in basis points; positive means the swap trades toward the reference.
    /// @param refX36 Reference price, same units as poolX36.
    /// @param poolX36 Pre-swap pool price.
    /// @param buysRisky True if the swap buys the risky asset.
    /// @dev Saturates at +/- MAX_GAP_BPS. Near v4's price bounds a 1e36-scaled price reaches 2^248, so
    /// the unsaturated product overflowed and reverted the swap path (decision 0031). Every gap the
    /// mechanism reads is far below the cap, and in range the result equals (ref - pool) * 1e4 / ref
    /// truncated toward zero, exactly as before.
    function signedGapBps(uint256 refX36, uint256 poolX36, bool buysRisky) internal pure returns (int256) {
        bool towardUp = refX36 > poolX36;
        uint256 diff = towardUp ? refX36 - poolX36 : poolX36 - refX36;
        uint256 mag =
            diff / refX36 >= uint256(MAX_GAP_BPS) / BPS ? uint256(MAX_GAP_BPS) : FullMath.mulDiv(diff, BPS, refX36);
        // mag <= MAX_GAP_BPS < 2^255, so the cast and the negation are exact.
        int256 gap = towardUp ? int256(mag) : -int256(mag);
        return buysRisky ? gap : -gap;
    }

    /// @dev sqrt(num / den) * 2^96. Below a ratio of 2^64 the square is taken at full 2^192 scale;
    /// above it at 2^128 and shifted, which still leaves at least 96 significant bits.
    function _sqrtRatioX96(uint256 num, uint256 den) private pure returns (uint160) {
        if (num / den < (uint256(1) << 64)) return uint160(_sqrt(FullMath.mulDiv(num, uint256(1) << 192, den)));
        return uint160(_sqrt(FullMath.mulDiv(num, uint256(1) << 128, den)) << 32);
    }

    /// @dev Babylonian square root, rounded down.
    function _sqrt(uint256 x) private pure returns (uint256 r) {
        if (x == 0) return 0;
        r = 1 << ((_log2(x) >> 1) + 1);
        // Each step at least halves the error; seven steps converge from a power-of-two start.
        for (uint256 i; i < 7; ++i) {
            r = (r + x / r) >> 1;
        }
        uint256 down = x / r;
        return r < down ? r : down;
    }

    function _log2(uint256 x) private pure returns (uint256 n) {
        for (uint256 s = 128; s > 0; s >>= 1) {
            if (x >= (uint256(1) << s)) {
                x >>= s;
                n += s;
            }
        }
    }
}
