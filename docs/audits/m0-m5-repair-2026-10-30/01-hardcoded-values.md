# Hardcoded values: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Medium. Location: `backend/keeper/src/keeper.ts:#profitable; contracts/src/TouchstoneHook.sol:constructor`.

Cost valuation assumes an 18-decimal native currency; target chain fee components are not explicitly supported. No new chain, gas limit, or financial parameter will be silently introduced. Chain-specific validation remains required.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

No new financial parameter or chain default was introduced. The executed fee is read from PoolManager slot0, selected by direction, and authenticated in Record under approved decision 0044. Existing start-block configuration now drives safe rescans. Native-asset and L2 fee-component scope remains explicit release work.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
