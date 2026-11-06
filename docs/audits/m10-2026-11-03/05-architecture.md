# Architecture

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `src/TouchstoneHook.sol`, `src/periphery/TouchstoneLens.sol` | Hook and lens name each other | The hook forwards to the lens; the lens reads the hook's state and settings | Accepted: both are immutables fixed at deploy, predicted and checked by `CoreDeployer` (`lens`, `lens.HOOK`, `lens.FACTORY`). No runtime cycle: the lens never calls a hook function that calls back |
| Info | `src/periphery/TouchstoneLens.sol:199` `_evaluate` | Classification exists twice, in the hook and the lens | Size: the hook cannot call an internal library large enough to share it | Accepted, as for previewDeposit since M7: parity fuzz in `QuoteIntegrity` and `Quote.t.sol` |
