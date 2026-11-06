# Architecture

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `script/base/CoreDeployer.sol` | Factory and auction name each other; both addresses are predicted from the deployer nonce and checked, including each back-reference | Mutual immutables | No change; order differs from the spec text (decision 0056) |
| None | `src/TouchstoneHook.sol` | Trust stays one-way: the hook reads `holderOf` and accepts `creditRent` only from its immutable auction |  | No change |
