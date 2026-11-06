# Performance

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/TouchstoneHook.sol` swap paths | All three gated paths got cheaper (below N0 +3.36%, at/above +4.68%, flagged +3.84% vs baseline) | Smaller dispatcher | No action; `docs/gas.md` |
| Medium | `src/periphery/TouchstoneLens.sol:137` `maxGas` | `maxGas()` is 1,193,000 at the default budget, against a *target* of 300k | Each crossing costs at least one cold `extsload` | Owners chose to keep 64 on 3 November 2026 (decision 0057); the 300k target is recorded as not met |
