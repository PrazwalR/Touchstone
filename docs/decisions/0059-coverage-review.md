# 0059: Closing the coverage gate with tests and a reviewed attribution list

Status: accepted. The owners chose this route on 3 November 2026 ("write tests to reach 95%; any line the tool
cannot attribute gets a recorded justification instead of a lowered gate"). Supersedes the open question in 0035.

## Problem

`forge coverage` must compile the hook through the IR pipeline (`--ir-minimum`): in the legacy pipeline without
the optimizer the hook fails with stack-too-deep, and without `--ir-minimum` forge drops `TouchstoneHook.sol`
from the report altogether (both tried on 3 November). Under `--ir-minimum` the source map loses statements that
demonstrably run. Examples, each asserted by a test that can only pass if the code executes:

- `TouchstoneHook._beforeSwap` lines 303 to 308 run on every swap in the suite and read 0 hits.
- `TouchstoneHook._dripEffects` line 727's early return is the only way `test_Drip_WithNothingVestingDoesNothing`
  can see `(0, 0)`, and reads 0.
- `PriceLib.fairPriceX36` runs in every settlement and in five direct tests, and every line reads 0.

## What was done

1. **Tests for every reachable gap.** 33 new tests (`test/unit/EdgeCases.t.sol`, additions to
   `ReferenceLibs.t.sol` and `ClosedMarket.t.sol`, and `MockReentrantToken`). They cover the auction's reentrancy lock,
   unregistered pools and double registration, the ArbSys block source, every unusable-reference case on the swap
   path, the sequencer feed, the deposit budget, whole-swap markouts, a failed fee refund, a failed native refund, a
   non-positive Pyth price, the first-touch transaction rule, flow, dirty hookData, URC-4 edges (zero amount, full fee,
   price-range clamps, exact output) and rent on a currency1 quote with a protocol share. Measured branch coverage
   rose from 74.4% to 85.9%, lines from 87.9% to 88.9%.
2. **A reviewed list** (`docs/audits/coverage-reviewed.json`, 198 entries) for what the tool still reports as missed:
   - 192 *executed*: each names the tests that execute the line or branch and assert its effect. Library entries
     are inlined code; hook and periphery entries are lost source mappings.
   - 6 *unreachable*: defensive checks no input reaches, each with the reason (for example, rent cannot overflow
     `uint128` after a 10% raise because a deposit must cover `k >= 60` seconds of it).
3. **The gate** (`scripts/check_release_gates.py coverage`) keeps the 95% threshold. It excludes a missed line or
   branch only if a review entry names it, has a category, reason and evidence, and pins the line's exact source
   text; an edited line voids its review and fails the gate. It prints the measured figures before review beside
   the gated ones.

## Result (measured 3 November 2026)

| | Measured | After review | Gate |
| --- | ---: | ---: | ---: |
| Lines | 1,274 / 1,433 (88.9%) | 1,274 / 1,278 (99.7%) | 95% |
| Branches | 269 / 313 (85.9%) | 269 / 269 (100%) | 95% |

The reviewed figure is not a coverage measurement; the measured one is. Both are reported.

## Maintenance

After a source change, run coverage, then rebuild the list's entries for the lines that moved. The generator
refuses to classify a missed line in a function it has no evidence for, so a new untested path fails the gate
until it gets a test or a written review.
