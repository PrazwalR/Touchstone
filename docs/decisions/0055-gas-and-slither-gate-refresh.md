# 0055 Gas baselines and Slither fingerprints after M6, M7 and the D2 merge

Date: 2 November 2026. Status: applied at the owner's request to restore the validation workflow; the owners
should confirm the two gas approvals below.

CI failed on three gates after the frontend commit: gas, Slither and coverage. This record covers the first two.
Coverage is decision 0035 and is unchanged.

## Gas

`scripts/check_release_gates.py gas` compared every path to the pre-repair measurements
(`docs/audits/m0-m5-repair-2026-10-30/gas-before.json`). Two paths exceed that baseline by more than 5%:

| Path | Pre-repair | Measured now | Change | Cause |
| --- | ---: | ---: | ---: | --- |
| `settle_retaining` | 245,418 | 298,640 | +21.69% | Isolated ledger delivery (0042) and the executed-fee field in the Record (0044) |
| `expire` | 172,206 | 217,662 | +26.40% | The same two decisions |

Both causes were approved by the owners in 0042 and 0044. Those decisions did not reset the baseline, and
docs/gas.md has said since 30 October that the gate fails for these two paths until an approval is recorded.

Change: the gate reads an optional `docs/audits/gas-approved-baselines.json`. An entry moves one path's baseline
and must name the decision that accepted the cost. The 5% tolerance still applies on top of the approved figure,
a path without an entry keeps the original baseline, and an entry for an unknown path fails the gate. Tests:
`scripts/test_release_gates.py`.

Approved baselines: `settle_retaining` 298,640 and `expire` 217,662, both measured on 2 November 2026.

Not changed, and close to the limit: the swap-path additions from M6 and M7 stay judged against the original
baseline. `hook_added_unflagged_at_or_above_n0` is at +4.71%, so the next addition to that path, likely the
licence fast path in M9, will fail the gate. The remedy then is to optimise the path or to record a new decision;
it is not to widen the tolerance.

## Slither

89 findings, 49 with fingerprints not in `slither-reviewed.json`. All 49 belong to detector categories that 0032
accepted; the fingerprints changed because code moved (the M6 and M7 edits in `TouchstoneHook`, the new
`GuardedRouter`, `NyseCalendar` and `CalendarMath`, and the `TransientLib` change). Each was checked against its
code, not only its category:

- `arbitrary-send-erc20` and `arbitrary-send-eth` (High) in `GuardedRouter`: false positives. `trader` is
  `msg.sender`, written into the unlock data by `swapGuarded`; `unlockCallback` reverts unless the PoolManager
  calls it; and the native refund goes to the caller of the same swap.
- `unused-return`: PoolManager `initialize`, `settle`, `transfer`, `unlock` and `donate`, `getSlot0` fields beyond
  the price, and `previewDeposit`'s use of a single tuple member. Each result is either unneeded or reverts on
  failure instead of returning false.
- `incorrect-equality`, `uninitialized-local`: comparisons with zero on amounts the hook computed, and locals
  whose zero default is intended.
- `reentrancy-events`, `timestamp`, `assembly`, `low-level-calls`, `naming-convention`: as accepted in 0032.

The reviewed list now holds exactly the 89 current fingerprints; the 22 obsolete entries were removed. This is
not a clean run, and no detector was suppressed.
