# Security: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: High. Location: `contracts/src/TouchstoneHook.sol:183,479,512; contracts/src/libraries/ReferenceLib.sol:25`.

Native refund callbacks can leave PoolManager deltas unsettled after successful self-call; direct tip transfer can block settlement. Oracle malformed returndata can escape typed-call catch. Reproduce exploits; only fallback-preserving oracle handling is an implementation fix. Refund/tip routing needs the owners under CLAUDE 0.11.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Malformed oracle responses now follow existing absent/down fallback; eight new regressions were red before repair. Approved 0042 isolates refund and tip delivery; approved 0044 captures executed fees. Normal regression tests cover stalling recipients, paused tokens, shared recipients, directional fees, post-swap fee changes and forgery. Economic mechanisms still open are enumerated in 0043.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
