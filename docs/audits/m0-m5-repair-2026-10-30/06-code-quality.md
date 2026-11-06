# Code quality: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Low. Location: `backend/keeper/src/hermes.ts:responseSchema; backend/keeper/src/state.ts:loadState`.

Hermes numeric/hex fields and persisted keeper state need boundary validation. Retain decision 0038 allowing unknown Hermes metadata; do not override it with a generic strict-fields rule. Existing docs overstate expiry automation and simulation race guarantees.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Hermes validates signed-price/confidence ranges, byte-aligned hex and finite positive valuations; invalid JSON is classified. Keeper persisted records are typed and range-validated, including the new executed-fee snapshot. Existing decision 0038 unknown-metadata policy is preserved. Misleading oracle, JIT, ITM, expiry and simulation claims are corrected or qualified.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
