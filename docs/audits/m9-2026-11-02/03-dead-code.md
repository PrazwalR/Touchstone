# Dead code

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Low | `src/LicenceAuction.sol` (first version) | A local `IFactoryConfig` interface duplicated the factory's `poolConfig` | Written before `poolConfig` was on `ITouchstoneFactory` | Fixed: `poolConfig` added to `ITouchstoneFactory`, local interface removed |
| Low | `src/TouchstoneHook.sol` `previewDeposit` | The `swapper` parameter was unnamed and unused | Placeholder from M7 awaiting M9 | Fixed: it now decides `exempt` |
