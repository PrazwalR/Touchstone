# Dependencies: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Info. Location: `contracts/lib/PINS.md; backend/package.json; research/prereg/FROZEN.md`.

Foundry and supported Node runtime initially unavailable. Install isolated pinned Foundry with SHA-256 checked against release metadata and run Node 24 without altering dependency locks. Vendored source provenance and third-party licence inventory need evidence; no AGPL or provenance assurance inferred from a pins table.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Isolated Foundry1.5.1 archive SHA-256 matches release metadata; tests use Node24 and pinned project dependencies. requirements.lock was regenerated from the existing uv lock to include omitted numpy2.5.4. Package audits reported no known vulnerabilities for the scanned requirements/backend lock, not proof of safety. CI action references use immutable SHAs. Full vendored provenance/licence review is still open.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
