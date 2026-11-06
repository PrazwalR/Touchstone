# Production readiness: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: High. Location: `docs/SPEC.md; backend/indexer/src/indexer.ts:#resume; backend/keeper/src/keeper.ts:#ingest`.

Full spec and historical datasets absent; no live fork evidence/CI. Keeper lacks canonical reorg recovery, indexer rewinds only twice confirmations, and costs omit oracle fee. Repair reviewable local correctness; document remaining chain fee/reorg limits. Production approval cannot be claimed from local tests.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Added pinned-tool CI, ABI drift/type/tests, dependency audits, explicit gas/coverage/size gates and fingerprint-based static triage. No deployment, commit, push or external issue publication performed. Real-oracle fork fixtures, open economic decisions, gas approval and coverage still block readiness. The owner-supplied spec.md is now the source of specification checks. Existing damaged databases require rebuild; old contract/state ABIs need matching client or explicit rescan/migration.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
