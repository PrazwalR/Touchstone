# Bug bounty

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Medium | `src/TouchstoneHook.sol:425` | Exploit: exemption through a zero swapper | See 04 | Fixed, test kept: `test_FastPath_ZeroSwapperNeverMatches` |
| Medium | `src/LicenceAuction.sol:329` | Exploit: deposits inflated by a fee-on-transfer token | See 04 | Fixed, test kept: `test_Bid_RejectsAShortTransfer` |
| None | `src/TouchstoneHook.sol:387` | Attempts: a second exempt swap in a block; an exempt swap on a stale reference; exemption by naming the holder in hookData | Rejected by design | Tests: `test_FastPath_OnlyOncePerBlock`, `test_FastPath_StaleReferencePostsADeposit`, `test_FastPath_OthersAreNeverExempt` |
