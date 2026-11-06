# Error handling

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `src/TouchstoneHook.sol:425` `_licence` | A failed, short or malformed licence answer means no lease, never a reverted swap | Static call, length check, decode as plain words | No change |
| None | `src/TouchstoneHook.sol:446` `_swapper` | A router whose `msgSender()` reverts counts as the swapper itself | try/catch | No change |
