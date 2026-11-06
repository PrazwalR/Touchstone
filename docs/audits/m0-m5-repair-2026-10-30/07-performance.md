# Performance: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Medium. Location: `docs/gas.md:12; contracts/snapshots/SwapGasTest.json`.

Historical swap paths exceed stated targets. Baseline gas and size must be rerun with pinned compiler/tool settings; no claim of optimization or measured improvement before executing checks. Additional oracle parsing may affect gas and must be disclosed.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Production core bytecode is checked separately from the oversized test PoolManager. New measurements and pre-repair gas baseline are retained; settlement and expiry regressions are not auto-approved. The release-gate checker fails above 5% and tests the exact boundary. See gas.md and validation.md for final measured values and failures.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
