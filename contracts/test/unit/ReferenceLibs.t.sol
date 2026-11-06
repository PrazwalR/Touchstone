// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BlockLib} from "../../src/libraries/BlockLib.sol";
import {FlowBucketLib} from "../../src/libraries/FlowBucketLib.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {DepositLib} from "../../src/libraries/DepositLib.sol";
import {SettlementMath} from "../../src/libraries/SettlementMath.sol";
import {ItmLib} from "../../src/libraries/ItmLib.sol";
import {VestingLib} from "../../src/libraries/VestingLib.sol";
import {Payout} from "../../src/types/Payout.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {MockArbSys} from "../mocks/MockArbSys.sol";

/// @dev External wrappers so reverts happen one call frame below the test.
contract Harness {
    function fairPrice(int64 pb, int32 eb, int64 pq, int32 eq, uint8 dr, uint8 dq) external pure returns (uint256) {
        return PriceLib.fairPriceX36(pb, eb, pq, eq, dr, dq);
    }

    function conf(int64 pb, int64 pq) external pure returns (uint256) {
        return PriceLib.confBpsUp(pb, 1, pq, 1);
    }

    function flow(uint32 horizon) external pure returns (uint104, uint104, bool) {
        return FlowBucketLib.update(1, 1, 0, 1, 100, horizon, 1, true);
    }

    function split(uint128 d, uint128 r) external pure returns (Payout memory) {
        return SettlementMath.splitRetained(d, r, SettlementMath.SplitParams(200, 5e6, 0, 1000), address(1));
    }

    function blockNumber(uint8 source) external view returns (uint64) {
        return BlockLib.number(source);
    }
}

contract ReferenceLibsTest is Test {
    uint256 internal constant USDC = 1e6;
    Harness internal h;

    function setUp() public {
        h = new Harness();
    }

    // --- Worked example, spec §4.7 -------------------------------------------------------------

    function _row(uint256 notionalUsd, int256 markoutUsd, uint16 alpha) internal pure returns (uint256 d, uint256 r) {
        uint256 n = notionalUsd * USDC;
        d = DepositLib.quoteAmount(n, DepositLib.rateBps(0, 0, 30, 300, 125, 300));
        r = SettlementMath.clawback(d, markoutUsd * int256(USDC), n, 2, 0, alpha);
    }

    function test_WorkedExample_MatchesReport() public pure {
        (uint256 d, uint256 r) = _row(500_000, 500, 8000);
        assertEq(d, 1_500 * USDC);
        assertEq(r, 320 * USDC);
        (d, r) = _row(200_000, 20, 8000);
        assertEq(d, 600 * USDC);
        assertEq(r, 0);
        (d, r) = _row(20_000, -3, 8000);
        assertEq(d, 60 * USDC);
        assertEq(r, 0);
        (d, r) = _row(500_000, 500, 9500);
        assertEq(r, 380 * USDC);
    }

    function test_Clawback_CapBindsAtDeposit() public pure {
        // Python vector: m = $5,000 on $500,000 with c* = 1 bp; alpha * excess exceeds D.
        assertEq(SettlementMath.clawback(1_500 * USDC, 5_000 * int256(USDC), 500_000 * USDC, 2, 1, 8000), 1_500 * USDC);
    }

    function test_SplitArbitrage_MatchesReference() public view {
        Payout memory p = h.split(uint128(1_500 * USDC), uint128(320 * USDC));
        assertEq(p.refund, 1_180 * USDC);
        assertEq(p.tip, 5 * USDC); // 2% of $320 is $6.40, capped at $5
        assertEq(p.toRebatePool, 31_500_000);
        assertEq(p.toLPs, 283_500_000);
        assertTrue(SettlementMath.conserves(p, 1_500 * USDC, 0));
    }

    function test_Benign_RebateMatchesReference() public pure {
        Payout memory p = SettlementMath.benign(
            uint128(600 * USDC), 200_000 * USDC, 500, 4000, uint128(1_000 * USDC), 200, 5e6, address(1)
        );
        assertEq(p.refund, 600 * USDC);
        assertEq(p.tip, 800_000);
        assertEq(p.rebate, 39_200_000);
        assertTrue(SettlementMath.conserves(p, 600 * USDC, 1_000 * USDC));
    }

    // --- Pyth conversion against the Python vectors --------------------------------------------

    function test_FairPrice_PythonVectors() public view {
        assertEq(h.fairPrice(300000000000, -8, 100000000, -8, 18, 6), 3000000000000000000000000000);
        assertEq(h.fairPrice(6123456789, -8, 99990000, -8, 8, 6), 612406919591959195919591959195919591);
        assertEq(h.fairPrice(2512345, -5, 100001234, -8, 18, 18), 25123139980452641214407414212508617643);
    }

    function test_Conf_PythonVector() public pure {
        assertEq(PriceLib.confBpsUp(300000000000, 150000000, 100000000, 5000), 6);
    }

    function test_FairPrice_RevertsOnNonPositive() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NonPositivePrice.selector);
        h.fairPrice(0, -8, 1e8, -8, 18, 6);
    }

    /// @dev k = eBase - eQuote + decQuote - decRisky + 36 beyond +-MAX_POW10 cannot be scaled exactly.
    function test_FairPrice_RevertsOnExponentOutOfRange() public {
        // k = 6 - 255 + 36 = -213, and 100 + 8 + 6 - 18 + 36 = 132: both past MAX_POW10 = 76.
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ExponentOutOfRange.selector, int256(-213)));
        h.fairPrice(1e8, -8, 1e8, -8, 255, 6);
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ExponentOutOfRange.selector, int256(132)));
        h.fairPrice(1e8, 100, 1e8, -8, 18, 6);
    }

    /// @dev A negative k divides instead of multiplying: a risky token with far more decimals than the quote.
    function test_FairPrice_NegativeScaleDivides() public pure {
        // k = -8 + 8 + 6 - 60 + 36 = -18: 3,000 / 1 / 10^18, rounded down.
        assertEq(PriceLib.fairPriceX36(3_000e8, -8, 1e8, -8, 60, 6), 3_000 / uint256(1e18));
        // k = -8 + 8 + 6 - 48 + 36 = -6: 9e18 / 1 / 10^6.
        assertEq(PriceLib.fairPriceX36(9e18, -8, 1, -8, 48, 6), 9e12);
    }

    function test_Conf_RevertsOnNonPositive() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NonPositivePrice.selector);
        h.conf(1e8, 0);
    }

    function test_SqrtPrice_OfZeroIsZero() public pure {
        assertEq(PriceLib.sqrtPriceX96At(0, true), 0);
    }

    function test_FlowBucket_RejectsAZeroHorizon() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__ZeroHorizon.selector);
        h.flow(0);
    }

    function test_Split_RevertsWhenRetainedAboveDeposit() public {
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RetainedAboveDeposit.selector, 2, 1));
        h.split(1, 2);
    }

    // --- Flow bucket ---------------------------------------------------------------------------

    function test_FlowBucket_PythonVector() public pure {
        (uint104 buy, uint104 sell, bool hit) =
            FlowBucketLib.update(uint104(90_000 * USDC + 1), 0, 100, 106, 100_000 * USDC, 12, 30_000 * USDC, true);
        assertEq(buy, 70_000 * USDC + 1);
        assertEq(sell, 1);
        assertFalse(hit);
    }

    function testFuzz_FlowBucket_SplitTradeFillsLikeOne(uint96 piece, uint8 count) public pure {
        // A trade split into `count` pieces inside one second fills the bucket as the whole trade would.
        vm.assume(count > 0);
        uint256 nMin = 100_000 * USDC;
        uint104 buy;
        uint104 sell;
        bool hit;
        for (uint256 i; i < count; ++i) {
            (buy, sell, hit) = FlowBucketLib.update(buy, sell, 1_000, 1_000, nMin, 12, piece, true);
        }
        uint256 total = uint256(piece) * count;
        if (total > FlowBucketLib.MAX_LEVEL) total = FlowBucketLib.MAX_LEVEL;
        assertEq(buy, total + 1);
        assertEq(hit, total >= nMin);
    }

    // --- Markout, split and conservation fuzz --------------------------------------------------

    function testFuzz_Markout_IsFloor(int96 xRisky, int128 xQuote, uint128 price) public pure {
        int256 m = SettlementMath.markout(xRisky, xQuote, price);
        int256 exact = int256(xRisky) * int256(uint256(price));
        // m - xQuote is the largest integer q with q * 1e36 <= exact.
        int256 q = m - xQuote;
        assertLe(q * 1e36, exact);
        assertGt((q + 1) * 1e36, exact);
    }

    function test_Markout_ArbitrageRow() public pure {
        // Buy 500,500 / 3,000 ETH for $500,000 at P* = $3,000: markout is $500, less one unit of rounding.
        uint256 p = 3000 * 1e6 * 1e36 / 1e18;
        int256 xRisky = int256(uint256(1e18) * 500_500 / 3000);
        int256 m = SettlementMath.markout(xRisky, -500_000 * int256(USDC), p);
        assertEq(m, 499_999_999);
    }

    function testFuzz_Clawback_Bounded(uint128 d, int128 m, uint128 n, uint16 eps, uint16 conf, uint16 alpha)
        public
        pure
    {
        eps = uint16(bound(eps, 0, 500));
        conf = uint16(bound(conf, 0, 200));
        alpha = uint16(bound(alpha, 0, 9900));
        uint256 r = SettlementMath.clawback(d, m, n, eps, conf, alpha);
        assertLe(r, d);
        if (m <= 0) assertEq(r, 0);
    }

    function testFuzz_Split_Conserves(uint128 d, uint128 r, uint16 tipBps, uint128 tipCap, uint16 proto, uint16 rho)
        public
        pure
    {
        r = uint128(bound(r, 0, d));
        SettlementMath.SplitParams memory p = SettlementMath.SplitParams(
            uint16(bound(tipBps, 0, 2000)), tipCap, uint16(bound(proto, 0, 5000)), uint16(bound(rho, 0, 3000))
        );
        Payout memory out = SettlementMath.splitRetained(d, r, p, address(1));
        assertTrue(SettlementMath.conserves(out, d, 0));
        assertEq(uint256(out.refund) + r, d);
    }

    function testFuzz_Benign_NeverExceedsPool(uint128 d, uint128 n, uint24 fee, uint16 kappa, uint128 pool)
        public
        pure
    {
        fee = uint24(bound(fee, 1, 100_000));
        kappa = uint16(bound(kappa, 0, 9000));
        Payout memory out = SettlementMath.benign(d, n, fee, kappa, pool, 200, 5e6, address(1));
        assertTrue(SettlementMath.conserves(out, d, pool));
        assertLe(uint256(out.rebate) + out.tip, (uint256(n) * fee * kappa) / 1e10 + 1);
    }

    // --- Price conversions ---------------------------------------------------------------------

    function testFuzz_SqrtPrice_RoundTrip(uint256 priceX36, bool riskyIs0) public pure {
        // Base-unit ratios from 1e-18 to 1e30 quote per risky, which covers both sides of 2^128.
        priceX36 = bound(priceX36, 1e18, 1e66);
        uint160 s = PriceLib.sqrtPriceX96At(priceX36, riskyIs0);
        uint256 back = PriceLib.poolPriceX36(s, riskyIs0);
        // A Q64.96 sqrt price holds about 29 significant digits; the round trip loses well under 1e-12.
        assertApproxEqRel(back, priceX36, 1e6);
    }

    function test_SignedGap() public pure {
        assertEq(PriceLib.signedGapBps(3003e9, 3000e9, true), 9); // reference 0.1% above: buying moves toward it
        assertEq(PriceLib.signedGapBps(3003e9, 3000e9, false), -9);
    }

    // --- In-the-money leg ----------------------------------------------------------------------

    function test_Itm_NoOvershootEqualsWholeSwap() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        uint160 afterP = TickMath.getSqrtPriceAtTick(-60);
        uint160 fair = TickMath.getSqrtPriceAtTick(-100); // fair below where the swap stopped
        uint128 liq = 1e21;
        (int256 a0, int256 a1, bool over) = ItmLib.leg(true, before, afterP, fair, liq, 500);
        assertFalse(over);
        uint256 in0 = SqrtPriceMath.getAmount0Delta(afterP, before, liq, true);
        uint256 out1 = SqrtPriceMath.getAmount1Delta(afterP, before, liq, false);
        assertEq(a1, int256(out1));
        assertGt(-a0, int256(in0)); // input grossed up by the fee
    }

    function test_Itm_OvershootStopsAtFair() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        uint160 afterP = TickMath.getSqrtPriceAtTick(-100);
        uint160 fair = TickMath.getSqrtPriceAtTick(-60);
        uint128 liq = 1e21;
        (, int256 a1, bool over) = ItmLib.leg(true, before, afterP, fair, liq, 500);
        assertTrue(over);
        assertEq(a1, int256(SqrtPriceMath.getAmount1Delta(fair, before, liq, false)));
    }

    function test_Itm_WrongSideIsEmpty() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        (int256 a0, int256 a1, bool over) =
            ItmLib.leg(true, before, TickMath.getSqrtPriceAtTick(-60), TickMath.getSqrtPriceAtTick(10), 1e21, 500);
        assertEq(a0, 0);
        assertEq(a1, 0);
        assertTrue(over);
    }

    // --- Vesting and block numbers -------------------------------------------------------------

    function testFuzz_Vesting_NeverAboveBuffer(uint128 vest, uint32 elapsed, uint32 period) public pure {
        period = uint32(bound(period, 60, 86_400));
        assertLe(VestingLib.releasable(vest, elapsed, period), vest);
    }

    function test_BlockLib_ReadsArbSys() public {
        MockArbSys impl = new MockArbSys();
        vm.etch(address(100), address(impl).code);
        MockArbSys(address(100)).setBlock(123_456_789);
        vm.roll(21_000_000);
        assertEq(h.blockNumber(BlockLib.SOURCE_ARBSYS), 123_456_789);
        assertEq(h.blockNumber(BlockLib.SOURCE_EVM), 21_000_000);
    }
}
