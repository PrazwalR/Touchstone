# Test coverage: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Medium. Location: `docs/decisions/0035-coverage-under-ir.md; backend/*/test/e2e.test.ts`.

Historical 82% lines/66% branches does not meet 95% gate. E2E tests access build artifacts while collecting skipped suites and fail on clean checkout. Move artifact setup behind executed hooks and verify both skip and real integration paths. Real Pyth fork and tick-crossing coverage remain open.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Clean-checkout E2E initialization is deferred to beforeAll and creates ignored output directories. Both actual Anvil suites and no-Foundry skip behavior were verified. Unit/fuzz/invariant/protocol-fee/payout/recovery/invalid-data regressions are in place. Coverage is measured and remains a real gate, not a claimed pass based on source-map caveats.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
