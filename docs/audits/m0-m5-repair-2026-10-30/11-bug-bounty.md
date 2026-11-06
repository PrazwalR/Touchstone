# Bug bounty: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: High. Location: `docs/audits/ethskills-2026-10-28/poc; contracts/src/libraries/ItmLib.sol:28`.

Deduplicate existing PoCs for native callback DoS, self-LP rebate drain, JIT drip capture, and cap exhaustion. Reproduce before claiming confirmed execution. Fee=1e6 division is not yet a reachable-record exploit because pinned v4 rejects exact-output and exact-input produces no two-sided swap. No speculative bound change.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Reproduced10 existing math/AMM witnesses: wash rebate drain, JIT capture, cap exhaustion and rounding/vesting examples. Protocol-fee omission was newly reproduced on EVM, then fixed only after owner approval and retained as a normal safety regression. Native callback and paused-token bugs were red before approved isolation and green afterward. Remaining exploit witnesses are not safety checks.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.

## Supplied-spec reconciliation

The subsequently supplied spec explicitly acknowledges self-LP wash and makes E11 a pool-level kill gate.
That is a documented economic exception, not proof of wash-proof operation. It also explicitly requires actual
receipts for non-overshooting ITM swaps; two variable-liquidity regressions proved excessive retention before
the conformance fix in 0045. The overshooting approximation remains as specified and unvalidated against an
exact tick replay.
