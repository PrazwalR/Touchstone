# Security

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Medium | `src/libraries/StaticQuoteLib.sol:70` `quote` | Steps across empty bitmap words were unbounded, so a quote on a sparse tick-spacing-1 pool could walk thousands of words and `maxGas()` bounded nothing | The spec bounds initialized ticks only | Fixed: empty-word steps share the `maxQuoteTicks` cap (decision 0057). Test `test_QuoteBeyondTheEmptyWordBudgetIsZero` |
| Low | `src/periphery/TouchstoneLens.sol:356` `_touched` | Any caller could append a word claiming the transaction already touched the pool | The flag travels in calldata | Fixed: read only when `msg.sender` is the hook. Test `test_LensIgnoresTheFlagFromOtherCallers` |
| Info | `src/TouchstoneHook.sol:258` `fallback` | Unknown selectors reach the lens | URC-4 served by fallback | Accepted: static call to an immutable, stateless lens; non-payable, so ETH sent to the hook still reverts. Lens reverts bubble unchanged |
| Info | `src/periphery/TouchstoneLens.sol:150` `_quote` | URC-4 quotes ignore the licence exemption | URC-4 passes no swapper | Accepted: the quote is conservative for a holder, never optimistic |
