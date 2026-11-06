# Code quality

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Low | `src/TouchstoneHook.sol:86` `GAP_UNKNOWN` | A sentinel replaces a separate freshness flag | Gas on every swap | Accepted: documented at the constant; the rate and drift treat it as a zero gap |
