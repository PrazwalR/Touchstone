# Error handling: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Medium. Location: `backend/keeper/src/keeper.ts:#process; backend/keeper/src/hermes.ts:#get; backend/indexer/src/store.ts:rewind`.

Record reads outside per-record catch can prevent unrelated processing; housekeeping counts reverted receipts as success; malformed JSON errors bypass HermesError. Indexer rollback leaves deferred flags from removed events and lacks atomicity. Fix and retain failure regressions.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Per-record and housekeeping reads are isolated; reverted housekeeping receipts are not counted as successful. Timely oracle updates can be submitted after latest publish time until keeper expiry policy applies. Indexer rollback reconstructs deferred/closed state from retained events. Research rejects invalid/empty/nonfinite observations and malformed cached Pyth values.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
