# Stubs and simulation

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `src/LicenceAuction.sol` | No mock, placeholder or constant return. Rent, lapse and refunds are computed and transferred for real |  | No change |
| None | `test/mocks/MockTrustedRouter.sol` | The tests use the existing mock only under `test/` |  | No change |
