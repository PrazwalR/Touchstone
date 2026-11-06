# Code quality

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/periphery/TouchstoneLens.sol` `View` | Inputs travel in a memory struct | Legacy pipeline stack limit | Accepted; each field commented |
| Info | `src/libraries/StaticQuoteLib.sol` `Run` | Same, for the swap loop | Same | Accepted; `_start`, `_step`, `_cross` each map to a named part of `Pool.swap` |
