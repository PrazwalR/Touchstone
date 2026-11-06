# 0000 State at handoff

Date: 27 October 2026. Status: recorded.

## What existed before this work
Only `touchstone-reference-pack/`: seven pure libraries (`BlockLib`, `FlowBucketLib`, `PriceLib`, `DepositLib`,
`SettlementMath`, `ItmLib`, `VestingLib`), `Payout`, `ITouchstoneErrors`, `MockArbSys`, 22 Foundry tests and the
exact Python reference. No repository, no CI.

## What was done (M0)
- Every pack file was copied into the tree unchanged except the test's import paths (`../src/` became
  `../../src/` after the move to `test/unit/`). Each placed file was diffed against the pack before the pack was
  deleted. `forge test` passed all 22; `check_report_numbers.py` reproduced `report_numbers.json` and
  `vectors.json` byte for byte.
- Dependencies vendored at the spec's pins (`contracts/lib/PINS.md`).

## Gate G1
Run on 28 October 2026 (research/results/README.md): pass under the pre-registered rule on Ethereum
USDC/WETH 0.05%, held-out recall 0.989 at phi_count 0.234, with the break-even uninformative on that window.
What follows was the state before the run: not run. E2 (trigger recall, held-out, phi <= 0.30) was due Wednesday 21 October. It is the cheapest kill test and
comes before anything else on the research side (M4). `research/prereg/E1.md` to `E4.md` are templates to be
completed and frozen before the run.

## Milestones reached in this session
M0, M1, M2 and M3 as described in docs/SPEC.md §20.5, with the deviations recorded in 0019 to 0035.
