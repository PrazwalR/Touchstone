# 0045 Use actual receipts when a swap did not overshoot

Status: specification conformance, implemented 30 October 2026.

## Requirement

The authoritative `spec.md` Settlement section, "In-the-money accounting" (line 577 at review), requires
reconstruction only when the post-swap price overshoots P*. Otherwise m+ = m and N+ = N. The previous Settler
reconstructed every ITM-enabled swap with pre-swap liquidity, including complete non-overshooting swaps.
That introduced approximation error unnecessarily when a swap crossed initialized liquidity boundaries.

## Repair

Use the `overshot` result of `ItmLib.leg`. When false, compute m+ from the record's actual signed receipts and
N+ from its actual quote notional, as the specification requires. When true, preserve the existing reconstructed
leg, including the empty wrong-side leg and the executed fee snapshot from decision 0044. No overshot-leg clamp,
new trigger, payout parameter or research threshold is introduced.

## Regression evidence

Measured local tests in `contracts/test/unit/ItmActualReceipts.t.sol` add a narrow position over the full-range
fixture, execute a swap across its boundary, and settle against a fair price beyond the swap's endpoint.
The tests independently compute alpha * (actual markout - epsilon * actual notional), ensure the deposit cap is
nonbinding, and compare settlement with that result in both trade directions.

Before the repair, the buy retained 560.380461 USDC instead of 484.263090 USDC; the sell retained
1,418.096887 USDC instead of 736.171448 USDC. Both tests failed before the source change. These figures are
local measurements, not historical backtest results or production-return claims.

The constant-liquidity approximation for the genuinely overshooting branch remains. The frozen E1/E2 Python
analysis code, preregistrations and recorded results are unchanged.
