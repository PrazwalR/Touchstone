# Hardcoded values

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `src/TouchstoneFactory.sol` lease bounds | Lease bounds are named constants: `LEASE_K_MIN`, `LEASE_K_MAX`, `MIN_INCREMENT_MIN`, `MIN_INCREMENT_MAX` | Spec §14 bounds | No change |
| None | `script/CreatePool.s.sol` `_lease` | Lease terms come from the chain config's `pool.lease` section | Per-chain values live in `script/config/<chain>.json` | No change; absent section means no licence |
