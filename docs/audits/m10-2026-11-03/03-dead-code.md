# Dead code

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Low | `src/libraries/StaticQuoteLib.sol` `Quote.sqrtPriceAfterX96` | Field written, never read | Carried over from the first draft | Fixed: removed |
| Info | `src/TouchstoneHook.sol` | `_classify`, `_settlementTimes`, `_calendarNextOpen` were used only by the preview | Preview moved to the lens | Fixed: removed from the hook; `_calendarAnswersNextOpen` keeps the one use the swap path has |
| Info | `src/periphery/TouchstoneLens.sol` | Explicit `quote` from the first draft | Replaced by the URC-4 functions | Removed before the first build that passed |
