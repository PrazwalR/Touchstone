# Stubs and simulation: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Info. Location: `docs/SPEC.md:3; contracts/test/mocks; frontend/README.md; sim/README.md`.

The authoritative specification is a placeholder; dashboard and revm replay are absent. Mock Pyth/local stack establish mechanics only, not production oracle compatibility. Preserve intentional staged interfaces; do not invent missing features or replace the spec with reconstructed requirements.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

No mock or placeholder was added to production source. New malicious receivers live under test/mocks. The design specification is linked from docs/SPEC.md; historical raw data remain unavailable. Frontend, replay and later milestone features remain staged; none is reported complete.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
