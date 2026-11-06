# Test coverage

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `test/unit/Licence.t.sol`, `test/invariant/Licence.invariant.t.sol` | 24 unit and fuzz tests; I11, I12, I13 and I1 as invariants (256 runs, 128,000 calls each); a check that the I11 handler reaches the fast path |  | No change |
| Medium | `src/` overall | The 95% coverage gate still fails under `--ir-minimum` | Tool attribution (decision 0035) | Open: owner decision in 0035 |
