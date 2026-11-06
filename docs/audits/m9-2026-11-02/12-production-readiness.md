# Production readiness

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| High | Arbitrum Sepolia deployment | The live contracts predate M9: the hook's immutables and `createPool` changed | Built after M8 | Open: a new core deployment is needed before the licence can be demonstrated |
| Medium | `backend/keeper`, `backend/indexer` | The keeper does not call `accrue`; the indexer does not read the auction | Off-chain work is D2's | Open: handed to D2 (decision 0056) |
| None | `script/config/*.json` | No pool config enables the licence | E10 has not run | No change: the licence stays off until E10 passes |
