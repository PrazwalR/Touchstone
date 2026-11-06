# 0066 Draft licence path replay and input validation

Date: 6 November 2026. Status: implementation preparation; E10 remains draft.

The M11 handoff left E10 with one-race and auction-clearing primitives. Add a pure sequential replay in
`research/simulations/licence_path.py`, using the existing constant-product execution and retention functions.
Reserves carry forward, while fees, retained amounts and rent are tracked outside the reserves. All scenario
inputs come from the caller. No historical tape is opened, threshold changed, or experiment frozen.

Rent is an explicit quote-per-second rate over a funded lease covering the entire supplied interval. It is
deducted once from the holder and split to LPs after the protocol and rebate allocations, without a settler
tip. Idle-holder runs remove that holder's arrivals while retaining its rent obligation. They do not model
lease lapse, eviction or capital costs. Freshness uses the time-weighted post-race gap, ignoring within-block
waiting time. These assumptions must be reviewed in E10 before registration.

Bidder value compares pre-rent profit on paired paths with identical observations and arrival draws.
The caller must name the outsider counterfactual explicitly. A different holder and an unlicensed pool have
different retention rules; silently selecting one would embed an economic assumption. No automatic choice
or pass/kill verdict is provided. Empty fills produce an undefined win rate.

## Defect fixed

Severity: medium, research correctness. `simulations/licence.py:first_fill` previously returned at the first
profitable arrival before validating later agents' costs. It also accepted invalid terms and could accept a
NaN trade size when no agent arrived. Malformed sensitivity cases could therefore appear valid or produce
invalid accounting. Ten synthetic regressions failed before the repair and passed afterwards.

Validate terms at construction and every arrival and trade size before considering a winner. Path replay
also rejects duplicate or unordered times, arrivals outside their block, invalid idle-holder inputs, rent
without a holder, and nonfinite aggregate accounting. Neither the frozen E1–E6 analysis nor their saved
results are changed. The E5/E6 hash input list excludes both licence modules.

## Validation scope

Synthetic tests cover sequential state, elapsed-time weighting, rent allocation and conservation, idle-holder
participation, absent fills, paired counterfactuals, invalid data and independence from future price observations.
The complete research suite passed 93 tests, with Ruff and strict mypy clean. These are measured software
checks, not an E10 simulation result or a licence-enable recommendation.
