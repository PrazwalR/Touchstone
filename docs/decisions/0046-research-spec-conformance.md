# 0046 Unfrozen settlement research follows the supplied specification

Status: implemented for E3/E4 validation and local settlement arithmetic. No historical experiment run.

The supplied root `spec.md`, settlement section (line 577 at review), states that when the swap does not
overshoot the fair price, m+ = m and N+ = N. The constant-liquidity reconstruction is used only for an
overshot leg, with its tick-crossing approximation explicitly acknowledged. `tsr/settle.py` therefore keeps
actual receipts in the non-overshot branch and preserves the reconstructed leg unchanged in the overshot
branch. The previous Python-only proportional clamp of oversized reconstructed legs was absent from the
specification and the contract, so it is removed. Swaps that start past fair retain ItmLib's empty leg.

Risky deposits match the existing Solidity sequence: floor the quote deposit and then floor its conversion
at the swap's execution price. The previous single risky-amount multiplication could replay a different
deposit because it skipped the first floor. Neither the contract's deposit formula nor its parameters change.

## Pre-registration gate

The specification's Pre-registration section requires each experiment's hypothesis, windows, metrics,
pass/kill line, and analysis-code hash to be committed before it runs. E3 and E4 now reject a draft header
or absent/stale current E3/E4 analysis hash before accessing datasets or writing results. Their shared Pyth
fetcher checks both pre-registrations before environment setup, data access, or fetching. The gate does not
freeze a document automatically and does not prove Git chronology. The owners must review the complete
pre-registration and commit it before data access or a run, including any separate ingestion commands.

E3/E4 remain drafts. Frozen E1/E2 files, preregistrations, thresholds, windows, and saved results are unchanged.
No data was downloaded and no historical result was regenerated during this repair.

## Remaining replay limitations

- v3 swap logs do not identify exact-input versus exact-output execution; the replay assumes exact input.
- Rebates are tracked in one quote-valued pool instead of separate onchain currency balances.
- Pre-swap liquidity is approximated by the preceding swap's post-swap liquidity and can miss intervening
  liquidity changes. Exact tick-by-tick replay remains required for the approximation assessment.
- Outstanding-cap occupancy, transaction-level settlement ordering, capital costs, and recipient-failure
  behavior are not modeled. E3 is not yet a complete stateful contract/economics replay.
- The E3 draft's retail definition excludes flow bursts, while its current cohort selects all sub-N0 swaps.
  Resolve that methodology before freezing; do not reinterpret a post-run threshold.
- E1/E2's frozen block-level oracle lookup remains unchanged, including its known same-block look-ahead
  limitation. A corrected analysis needs a separate version and pre-registration.

Synthetic regressions distinguish actual receipts from reconstructed amounts, preserve unclamped overshot
legs, exercise both token roles, demonstrate two-step deposit rounding, and prevent draft entrypoints from
loading/fetching data or writing results. Passing those tests does not remove the limitations above.
