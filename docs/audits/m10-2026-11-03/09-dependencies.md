# Dependencies

Milestone M10 (TouchstoneLens, StaticQuoteLib, URC-4 through the hook's fallback), 3 November 2026. Scope: `src/periphery/TouchstoneLens.sol`, `src/libraries/StaticQuoteLib.sol`, `src/interfaces/ITouchstoneLens.sol`, the M10 changes to `src/TouchstoneHook.sol`, `script/base/CoreDeployer.sol`, `script/DeployCore.s.sol`, the chain configs, and their tests. Decision 0057 records the design.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| None | `src/TouchstoneHook.sol` | Uses OpenZeppelin `Address.functionStaticCall` | Bubbles lens reverts without assembly | Vendored OZ at the pinned commit (`lib/PINS.md`), MIT |
| None | `src/libraries/StaticQuoteLib.sol` | Uses v4-core `SwapMath`, `TickBitmap`, `ProtocolFeeLibrary`, `LiquidityMath`, `BitMath`, `StateLibrary` | Port of `Pool.swap` | Pinned v4-core commit; a v4 upgrade must rerun `testFuzz_QuoteMatchesV4Quoter`. No AGPL code |
