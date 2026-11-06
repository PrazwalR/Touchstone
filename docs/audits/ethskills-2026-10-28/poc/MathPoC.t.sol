// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {VestingLib} from "ts/libraries/VestingLib.sol";
import {DepositLib} from "ts/libraries/DepositLib.sol";
import {SettlementMath} from "ts/libraries/SettlementMath.sol";
import {Payout} from "ts/types/Payout.sol";

contract SplitHarness {
    function split(uint128 d, uint128 r, uint16 tipBps, uint128 cap, uint16 prot, uint16 rho)
        external pure returns (Payout memory)
    {
        return SettlementMath.splitRetained(d, r, SettlementMath.SplitParams(tipBps, cap, prot, rho), address(1));
    }
}

contract MathPoC is Test {
    // MATH-1: drip every second with vest < period releases nothing and the clock restarts each time.
    function test_DripRoundsToZeroForever() public pure {
        uint256 vest = 86_399; // e.g. 86,399 sats of WBTC (~$86 at $100k)
        uint256 period = 1 days;
        uint256 released;
        for (uint256 i; i < 2 * period; i += 1) {
            uint256 a = VestingLib.releasable(vest, 1, period);
            released += a;
            vest -= a;
        }
        assertEq(released, 0, "nothing ever vests");
        assertEq(vest, 86_399);
        // Same buffer with a single drip after one period releases everything.
        assertEq(VestingLib.releasable(86_399, period, period), 86_399);
    }

    // MATH-1 (scale): drips every 12 s for one full period on 1 USDC.
    function test_DripFrequentReleasesLess() public pure {
        uint256 vest = 1e6;
        uint256 v = vest;
        uint256 period = 1 days;
        for (uint256 t; t < period; t += 12) {
            v -= VestingLib.releasable(v, 12, period);
        }
        console2.log("left after one period with 12 s drips", v);
    }

    // MATH-2: deposit in risky goes through a floored quote amount first.
    function test_ToRiskyDoubleRounding() public pure {
        uint256 notional = 12_345; // quote base units of an 8-dec quote token (WBTC-quoted pool), ~ $12
        uint256 riskyAbs = 4_567_890_123_456_789_012_345; // 18-dec risky
        uint256 rate = 5;
        uint256 dq = DepositLib.quoteAmount(notional, rate);
        uint256 viaQuote = DepositLib.toRisky(dq, riskyAbs, notional);
        uint256 direct = FullMath.mulDiv(riskyAbs, rate, 10_000);
        console2.log("depositQuote", dq);
        console2.log("viaQuote", viaQuote);
        console2.log("direct", direct);
        assertLt(viaQuote, direct);
    }

    function testFuzz_ToRiskyNeverAboveDirect(uint128 n, uint128 r, uint16 rate) public pure {
        vm.assume(n > 0);
        rate = uint16(bound(rate, 5, 2000));
        uint256 dq = DepositLib.quoteAmount(n, rate);
        uint256 viaQuote = DepositLib.toRisky(dq, r, n);
        uint256 direct = FullMath.mulDiv(r, rate, 10_000);
        assertLe(viaQuote, direct);
        // loss bounded by one quote base unit worth of risky, rounded up
        assertLe(direct - viaQuote, uint256(r) / n + 1);
    }

    // MATH-3: splitRetained's unchecked block relies on tipBps, protocolShareBps <= BPS, which only the factory enforces.
    function test_SplitUncheckedWrapsWithBpsAboveTenThousand() public {
        SplitHarness h = new SplitHarness();
        Payout memory p = h.split(1000, 1000, 0, type(uint128).max, 20_000, 0);
        console2.log("toProtocol", p.toProtocol);
        console2.log("toLPs", p.toLPs);
        uint256 sum = uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs;
        assertTrue(sum != 1000, "conservation breaks; only the hook's conserves() catches it");
    }

    // MATH-4: R in quote > 0 but rounds to zero in a high-value risky token.
    function test_RetainedRoundsToZeroInRisky() public pure {
        // WBTC (8) risky, USDC (6) quote, $100,000: P = 1e5 * 1e6 / 1e8 = 1e3 quote base units per sat.
        uint256 priceX36 = 1e3 * 1e36;
        uint256 retainedQuote = 999; // $0.000999
        uint256 retained = FullMath.mulDiv(retainedQuote, 1e36, priceX36);
        assertEq(retained, 0);
    }
}
