# Dependencies

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `src/LicenceAuction.sol` | Only the pinned v4-core and OpenZeppelin (`SafeERC20`) are used. No code from Bunni's BidDog (AGPL-3.0): the lease is written from the am-AMM paper and spec §10 |  | No change |
