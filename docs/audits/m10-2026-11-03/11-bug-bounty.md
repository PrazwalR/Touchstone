# Bug bounty

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Medium | `src/libraries/StaticQuoteLib.sol` | Griefing: add tiny positions so that a router's quote of a large swap walks many empty words and runs out of gas, so routers stop quoting the pool | Unbounded empty-word steps | Written first as `test_QuoteBeyondTheEmptyWordBudgetIsZero`, then fixed with the second budget half; kept as the regression |
| Low | `src/periphery/TouchstoneLens.sol` | Spoofing the in-transaction flag to get a cheaper quote | Calldata flag | `test_LensIgnoresTheFlagFromOtherCallers` |
| Info | `src/TouchstoneHook.sol` `fallback` | Using the fallback to reach state-changing code | Generic forwarder | Static call only; no finding |
