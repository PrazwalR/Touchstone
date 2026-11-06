# Research baseline, 30 October 2026

Scope: research ingestion, E3/E4 analysis, and consistency with frozen E1/E2 artifacts.
This is a code review and synthetic-input audit, not a rerun of historical datasets.

## Findings before fixes

- Medium, `experiments/e4_basis.py`: a non-finite median compares false against the kill line,
  allowing invalid input to reach a pass verdict. Empty samples fail through lower-level NumPy errors.
  Root cause: observations and decision statistics are not checked for finiteness and sample presence.
- Medium, `experiments/e34_common.py::write_e34`: default JSON serialization accepts NaN and Infinity.
  Root cause: result output does not enforce the JSON finite-number requirement.
- Medium, `tsr/hermes.py`: live parsing accepts negative confidence and boolean integer fields; cached
  rows bypass live validation and can contain prices published before the requested timestamp.
  Root cause: independent, incomplete live/cache parsing paths.
- Low, `tsr/hermes.py::Hermes.fetch`: cache identity includes only the first/last timestamp and count,
  and reused chunks are not checked against their requested timestamp set. Different interior timestamps
  or feeds can reuse the wrong cache. Root cause: incomplete cache keys and missing completeness checks.

## Issues outside this safe repair

- `tsr/settle.py` includes ITM scaling and direct risky-deposit rounding not implemented by the current
  Solidity contracts. E3 is not an exact contract replay. Formula changes require coordination and review.
- E3 pools rebate balances in quote units, assumes exact-input swaps, approximates pre-swap liquidity
  using the previous swap, and does not model outstanding-cap occupancy or settlement ordering.
- Frozen `tsr/triggers.py` chooses the last Chainlink update by block, permitting same-block look-ahead,
  and accepts future `updatedAt` values. Fixes require versioned analysis and a new preregistration.
- E3/E4 preregistrations remain drafts and historical input datasets are absent. Historical metrics
  cannot be reproduced from this checkout. No experiment will be run as part of this synthetic repair.

The frozen E1/E2 analysis, preregistrations, and results must remain byte-identical.

## Safe repair and validation

- E4 now rejects empty, negative, or non-finite observations, unaligned days, non-finite summary
  statistics, and a decision delta absent from the analysis deltas. Valid-data statistics, seeds,
  deltas, and the kill line are unchanged.
- E3/E4 result serialization rejects NaN and Infinity before an existing output can be overwritten.
- Live and cached Pyth rows share integer/range and publish-time validation. Cache keys include
  both feed IDs and the complete timestamp list; loaded chunks must match every requested timestamp
  exactly once. Existing cache chunks use the old key and will be fetched again if requested.
- Added 18 synthetic regression cases. Before implementation, 16 failed and 2 passed; after the
  repair, the full Python suite passed all 49 tests. Ruff and mypy passed (32 source files).
- Recomputed the frozen E1/E2 analysis hash and both preregistration hashes against saved results:
  all matched. No historical inputs were downloaded and no historical result was recomputed.

The pre-existing formula/model discrepancies listed above remain open; passing synthetic tests
does not establish E3 contract parity or validate the recorded historical metrics.
