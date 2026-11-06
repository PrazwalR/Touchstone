# 0043 Mechanism findings requiring owner decisions

Date: 30 October 2026. Status: open except for the executed-fee omission approved and fixed in 0044. Remaining items are not accepted trade-offs.

CLAUDE.md sections 0.1 and 0.11 prohibit changing formulas, regimes, parameters, money flow or trust assumptions
without an owner decision. The approval of 0042 applies only to refund/tip delivery; 0044 separately authorizes executed-fee capture. Full spec sections 4, 14,
16 and 21 are absent from this checkout; this document does not reconstruct or amend them.

| Finding | Evidence | Decision needed |
| --- | --- | --- |
| High: self-LP wash rebates | Existing WashRebateDrain PoC reproduced in this audit | Preserve rebates with an independently validated eligibility rule, or explicitly approve removing them; no silent default change |
| Fixed under 0044: ITM reconstruction omitted protocol fees | Original EVM witness and `ProtocolFeeSettlement.t.sol` regression | Owner approved capturing the effective swap-time fee in Record and using it in settlement |
| Medium: tick-crossing ITM approximation | `ItmLib.leg` uses one pre-swap liquidity; lesson 03 acknowledges gap | Choose exact execution reconstruction or an enforceable narrower scope; arbitrary clamping does not establish correctness |
| Medium: JIT donation capture | Existing JitDrip PoC reproduced | Choose LP reward eligibility/accounting; frequent keeper drips alone are not a holding-period guarantee |
| Medium: cap exhaustion | Existing CapExhaustion PoC reproduced | Decide trading pass-through without deposits versus rejection or headroom policy |
| Medium: hostile first registration | Factory validates numeric bounds, not canonical economic configuration | Choose permissionless config verification or explicitly approve a changed registration trust model; no new owner introduced |
| Low: vesting dust / call-dependent decay | Existing MathPoC reproduced | Choose intended release schedule; preserving fractional accrual changes timing and must be explicit |
| Low: risky deposit double rounding | Existing MathPoC reproduced | Preserve existing rounding or approve direct risky-side calculation |
| Medium residual: gas-burning payout delivery | 0042 has no gas budget | Approve a measured push gas-budget policy or explicitly retain gas-grief exposure; isolated unlocks do not bound gas |

## New protocol-fee witness

Measured on local EVM mocks, not a historical return or live-chain result: LP fee 500 pips, protocol fee 1,000
pips in each direction, exact-output purchase of 2 ETH, fair price USD 3,005. Actual quote paid is
6,012.621274 USDC, giving actual trader markout -2.621274 USDC. Before the 0044 repair, ITM reconstruction nevertheless
retained 1.754427 USDC, of which 1.547406 USDC goes toward LPs. The initial witness asserted this failure. After approval, the normal regression verifies no clawback,
asymmetric directional fee capture and invariance under subsequent protocol-fee changes. The docs witness
now also asserts corrected behavior and retains the pre-fix measurement as historical evidence.

## Corrected prior finding

The historical 100%-fee ITM division-by-zero report does not establish a reachable record: pinned v4 rejects
exact-output at that fee, and exact-input yields a zero output leg, so the hook skips creating a record.
No new fee bound is introduced on that unproven basis.

## Research restrictions

E1/E2 artifacts and thresholds remain frozen. Correcting same-block reference look-ahead and future timestamps
requires a separately versioned analysis/pre-registration. E3 is draft and differs from Solidity in ITM handling,
risky deposit rounding, rebate currency pools, exact-input assumptions, outstanding caps and settlement order.
It must not be represented as faithful execution replay or run to justify deployment before reconciliation.
E3/E4 freeze-before-run enforcement and proxy-history ingestion also need completion before research execution.

## Other release blockers

Original specification and raw datasets are missing. Real Pyth fork fixtures, chain-specific L1/operator fees,
address/code identity probes, complete dependency provenance/licence review, coverage gate and production
monitoring remain separate validation work. Existing indexer databases damaged by old partial writes require
rebuild from trusted raw history; keeper cursor recovery cannot make an incorrect configured start block safe.
