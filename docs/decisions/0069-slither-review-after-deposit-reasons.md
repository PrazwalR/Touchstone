# 0069 Slither review after the DepositReasons change

Date: 7 November 2026. Status: reviewed; no code change, no new economic parameter.

The hook gained a `DepositReasons` event and a `triggers` field so a receipt can name the triggers that fired. The
change shifted lines in `TouchstoneHook.sol`, and Slither's finding ids depend on source location, so the CI gate
(`scripts/check_release_gates.py slither`) reported 30 ids that were not in
`docs/audits/m0-m5-repair-2026-10-30/slither-reviewed.json`. It reports 138 findings in total.

## Classification

- **25 findings moved only.** They are findings already reviewed and triaged (naming-convention for the
  SCREAMING_SNAKE_CASE immutables the specification requires, and the existing timestamp, equality and
  divide-before-multiply notes in `slither-triage.md`). Only their line numbers changed.
- **5 findings are new ids on the hook, all false positives of known detectors:**
  - `incorrect-equality` on `deposit == 0` in `_afterSwap`. A deposit of zero means no deposit was taken, which is
    exactly the intended branch. The value is an integer product, not a balance an attacker can nudge to or from zero.
  - `incorrect-equality` on `v.depositIn0 == v.quoteIs0` in `_depositFor`. Both sides are booleans choosing the
    deposit currency. The lens carries the same line and its finding was already reviewed.
  - `timestamp` on the same two functions and on `_outstandingOverflows`. The flagged comparisons are `deposit == 0`,
    the currency boolean and an overflow bound against `type(uint128).max`. None of them depends on
    `block.timestamp`; the detector fires because the call chain reads it elsewhere (flow-bucket draining).

## Result

All 30 ids are added to the reviewed baseline with this record as their triage reference. The gate still fails on any
finding whose id is not reviewed, so a future contract change that moves or adds findings needs the same review.

The source files under `contracts/src` are unchanged by this decision.
