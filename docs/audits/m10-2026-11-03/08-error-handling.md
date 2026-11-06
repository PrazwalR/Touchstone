# Error handling

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/periphery/TouchstoneLens.sol:292`, `:299`, `:306` | Calendar and auction staticcalls never revert a quote | Same policy as the hook | Accepted: a failure classifies as unknown or not exempt, exactly as the swap would |
| Info | `src/libraries/StaticQuoteLib.sol:108` `_start` | Inputs `Pool.swap` would revert on return `ok = false` instead | URC-4: 0 when it cannot price | Tests `test_InvalidPriceLimitCannotPrice`; `MalformedHookData` still reverts as URC-4 requires |
