# 0052 D2 replay scope and renewed freeze

Date: 1 November 2026. Status: owner approved preserving current formulas and documenting approximation before freeze.

The owner selected “Preserve formulas; document approximation before freeze” in this session. This is permission to continue E3/E4 using the existing mechanism, not approval to claim exact replay or to change the open proposals in 0043/0049. No contract modification follows from this decision.

## Six replay differences checked against the implementation

| Surface | Current implementation | Classification |
| --- | --- | --- |
| In-the-money handling | `research/tsr/settle.py:in_the_money` uses actual receipts for non-overshooting swaps (0045/0046). Overshooting swaps retain the pre-swap constant-liquidity approximation; no arbitrary clamp. | Non-overshoot defect fixed. Overshoot tick-crossing error remains intentionally modelled under the current contract formula. Previous 1,902/43,080 counts are historical diagnostics under older code, not a new measurement. |
| Risky deposit rounding | `deposit_at_swap` floors quote deposit before conversion, matching `DepositLib.toRisky`. | Arithmetic fixed; preserve both floors. |
| Rebate currency pools | `payout` splits quote-valued amounts and the E3 runner uses one quote-valued rebate buffer. Contracts split in deposit currency and keep two buffers. | Deliberate model difference, affects funding and rounding; E3 is not currency-exact. |
| Execution type | v3 Swap logs do not expose exact input/output; E3 assumes every swap is exact input. | Deliberate identification limitation; E5 must test exact-output separately. |
| Outstanding cap | E3 omits maxOutstanding and release of occupied capacity. | Deliberate model difference; no launch-cap availability claim. |
| Settlement order | E3 processes record outcomes in swap order without keeper scheduling, gas, capital costs or competing callers. | Deliberate ordering assumption; no claim to reproduce actual first-come rebate allocation. |

Pre-swap liquidity is the previous swap's post-swap liquidity; intervening liquidity changes are not reconstructed. The historical static LP fee is assumed as swap-time fee; a v3 tape cannot reproduce v4 protocol-fee changes. Frozen E1/E2 reference look-ahead and future timestamps are inherited and disclosed, not silently corrected under their old preregistration.

## Mechanism decisions retained

Self-LP wash profit remains an E11 kill condition; do not declare rebates safe. Preserve drip schedule/dust behavior and disclose JIT capture. Preserve cap pass-through, permissionless registration, unbounded delivery gas and keeper expire-first policy. These remain release risks requiring separate owner decisions before changing code. This records the present choice to defer changes, not a security sign-off.

## Freeze and data order

1. Commit tested analysis code and this reconciliation.
2. Set the current E3/E4 analysis hash, mark frozen, and commit those preregistrations separately.
3. Only then access historical inputs, validate source-cache provenance, migrate cache names and fetch missing updates.

Keep E3's existing disclosure verbatim. Both default and selected parameter verdicts must be reported, failures included. The 5% cap-share, 0.1 bp retail-fee, and E4 1 bp at 3 seconds thresholds remain unchanged. No data exists locally on this machine as of the preflight; another machine's cache cannot be presumed available.
