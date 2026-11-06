# 0035 Coverage measurement at the end of M3

Status: closed by decision 0059 on 3 November 2026 (the 95% gate stands).

`forge coverage` needs `--ir-minimum` here, and under it calls to internal library functions are often not
attributed. Libraries that are fuzzed thousands of times (for example `SettlementMath`, which every settlement
test exercises) report 55 to 65% lines. Measured at the end of M3: 82% lines and 66% branches over `src/` in total;
Factory 100%, RebateLedger 100% lines, Settler 90% lines, TouchstoneHook 73% lines.

Known real gaps: the Settler's closure branch (M6), the sequencer-feed path through the hook, and a trusted router
whose `msgSender()` reverts. Next step: direct unit harnesses for each library function so coverage is attributed,
and the three paths above.

## Measured again, 1 November 2026 (after M6 and M7)

`forge coverage --ir-minimum`:

| Scope | Lines | Branches |
| --- | ---: | ---: |
| `src/` total | 74.0% | 69.0% |
| Factory | 100% | 100% |
| RebateLedger | 100% | 75% |
| Settler | 98.9% | 76.9% |
| GuardedRouter | 100% | 80% |
| NyseCalendar | 94.2% | 100% |
| TouchstoneHook | 76.0% | 80.8% |

**Most of the hook's unhit lines are attribution failures, not untested code.** The lcov report marks these
unhit, although every swap test executes them:
- the body of `register`;
- the first line of `_afterSwap`;
- `_beforeSwap`'s transient writes;
- `poolState` and `lastDeposit`, which dozens of tests call directly.

Library functions that every settlement runs (`PriceLib.fairPriceX36`, `SettlementMath.clawback`) report zero
function hits for the same reason. So the 95% gate cannot be judged with this tool under the IR profiles.

**Real gaps found while reading the report, now covered:**
- previewing a closure record;
- a calendar that cannot give `nextOpen`. This was a real I10 hazard, now fixed (decision 0048, update);
- the calendar's data getter.

**Two process notes:**
- `forge coverage` runs the gas test on an instrumented build and overwrites `snapshots/SwapGasTest.json`. Run the
  gas gate before coverage, or rebuild and retest afterwards; CI should keep them in separate jobs.
- **Options for the owners:**
  1. accept a per-line review of the lcov report as the coverage evidence;
  2. measure coverage on a non-IR build of the libraries through direct harnesses;
  3. wait for Foundry's IR coverage attribution to improve.

  Recommendation: option 2 for the libraries plus option 1 for the hook.

## Measured again, 2 November 2026 (CI gate)

`python scripts/check_release_gates.py coverage` after `forge coverage --report lcov --ir-minimum`, run with
`FORGE_SNAPSHOT_EMIT=false` so the gas snapshot is untouched:

| Scope | Lines | Branches |
| --- | ---: | ---: |
| `src/` total | 867/1029 (84.26%) | 167/222 (75.23%) |
| Largest unhit counts | `TouchstoneHook` 66, `PriceLib` 34, `SettlementMath` 30, `ReferenceLib` 10 | |

The gate fails against 95%. The per-file numbers differ from the table above because that table was read from
the summary report; this one sums the lcov records the gate reads.

**New evidence against option 2 (direct harnesses).** `test/unit/ReferenceLibs.t.sol` already calls
`PriceLib.fairPriceX36` (line 21) and `SettlementMath.clawback` (lines 46, 65, 161) directly, and fuzzes them
2,000 runs, yet lcov reports every line of both function bodies as unhit (`PriceLib` 38 to 44, `SettlementMath`
73 to 78). More direct tests will not change those numbers. The gap is in the tool's source mapping under
`--ir-minimum`, not in the tests.

Not changed: the 95% threshold and the gate. Remaining options for the owners:
1. accept a per-line review of the lcov report as the evidence, and record it per milestone;
2. measure coverage with a build that does not use `--ir-minimum`. This needs the Settler and hook to compile
   without the IR pipeline, which their stack depth currently prevents;
3. wait for Foundry's IR attribution to improve, and treat the gate as informational until then.

Until one is chosen, the `Coverage evidence and gate` CI step stays red, and that is accurate.

**Update, 3 November 2026:** closed by decision 0059 (tests plus a reviewed attribution list; the 95% gate stands).
