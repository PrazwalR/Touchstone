# Test coverage

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Info | `test/unit/Quote.t.sol` | 10 tests: execution parity (fuzz, both directions and exactness), price limit (fuzz), V4Quoter differential (fuzz), tick budget, invalid limit, malformed hookData, ERC-165 and URC-4 answers, flag trust, zero budget | | Added |
| Info | `test/gas/SwapGas.t.sol` `QuoteGasTest` | Worst-case, dense and base quote gas; empty-word budget | | Added |
| Info | `test/unit/QuoteIntegrity.t.sol` | previewDeposit parity, now through the lens | | Unchanged, passing |
| Low | coverage gate | Lines and branches were under 95% under `--ir-minimum` | Tool attribution (decision 0035) plus real gaps | Fixed: 33 new tests (measured 88.9% lines, 85.9% branches) and a reviewed attribution list with evidence; the 95% gate passes (decision 0059) |
| Low | `test/unit/Licence.t.sol` | `test_Activation_DisplacesTheHolderAndReturnsItsRemainder` and `test_Lapse_MatchesTheReference` failed under `forge coverage --ir-minimum`, which made forge drop the whole coverage report | Under via-IR the compiler may reuse a `block.timestamp` read from before `vm.warp`; the contracts were not at fault | Fixed: the suite reads `vm.getBlockTimestamp()`. Both pass under coverage |
| Info | `test/gas/SwapGas.t.sol` `QuoteGasTest` | The `maxGas()` bound failed under coverage | Coverage compiles without the optimizer | The bound is asserted outside coverage only (`vm.isContext`); the snapshot is still written |
