# Hardcoded values

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/TouchstoneHook.sol:258` `fallback` | Bare `164` for the end of the encoded PoolKey | Written inline | Fixed: named constant `KEY_END = 4 + 5 * 32` |
| Info | `src/libraries/StaticQuoteLib.sol` | Gas figures for `maxGas()` | Must be measured, not chosen | Named constants `QUOTE_BASE_GAS`, `QUOTE_GAS_PER_TICK`, each citing the test that measures it |
| Info | `script/config/*.json` | Quote tick budget | Per-chain parameter | `maxQuoteTicks` read by `DeployCore`, 64 on both testnets; lens rejects zero |
