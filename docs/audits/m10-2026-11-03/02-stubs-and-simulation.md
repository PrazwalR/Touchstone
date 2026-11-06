# Stubs and simulation

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/periphery/TouchstoneLens.sol:131` `isLive` | Returns a constant `true` | URC-4 asks whether the hook can be swapped through now | Accepted: Touchstone never blocks or delays execution; only settlement waits on an oracle. Not a placeholder: no state could make it false |
| None | `src/libraries/StaticQuoteLib.sol` | The AMM quote is a recomputation, not a simulation | View port of `Pool.swap` reading live state | Held equal to execution by `testFuzz_QuoteMatchesExecution` and to V4Quoter by `testFuzz_QuoteMatchesV4Quoter`. No mock in `src/`; `V4Quoter` is used only in tests |
