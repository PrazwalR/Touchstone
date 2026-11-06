# Performance

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Medium | `src/TouchstoneHook.sol` swap path | Swap at or above N0 is +4.96% against the pre-repair baseline, 16 gas below the gate | M6, M7 and M9 additions | Open: the next swap-path addition must be offset or approved |
| Medium | `src/TouchstoneHook.sol` size | 24,437 of 24,576 bytes | Licence code | Open: M10 must move `previewDeposit` logic behind the lens first |
| None | `src/LicenceAuction.sol:165` `holderOf` | Licence check measured at 16,235 gas, within the 18,000 target | Narrow read of five slots | Recorded in `docs/gas.md` |
