# Security

Milestone M9 (the arbitrage licence), 2 November 2026. Scope: `LicenceAuction`, the licence changes to `TouchstoneHook`, `Settler`, `TouchstoneFactory`, `CoreDeployer` and `CreatePool.s.sol`, and their tests. Decision 0056 records the design choices.

| Severity | File and line | Finding | Root cause | Resolution |
| --- | --- | --- | --- | --- |
| Medium | `src/TouchstoneHook.sol:425` `_licence` | A lease whose exempt address is zero would match any trusted-router swap whose `msgSender()` returns zero | Trusted routers report zero outside their own swaps | Fixed: a zero holder never matches. Test `test_FastPath_ZeroSwapperNeverMatches` |
| Medium | `src/LicenceAuction.sol:329` `_pull` | A fee-on-transfer quote token would credit deposits the auction does not hold | Deposits were credited at the requested amount | Fixed: balance-delta check reverting with `Touchstone__TransferShortfall`. Test `test_Bid_RejectsAShortTransfer` |
| Low | `src/LicenceAuction.sol` `bid`, `topUp`, `withdraw`, `setSwapper` | State written after external calls (Slither `reentrancy-no-eth`) | `_accrue` sent rent before each caller wrote its own state | Fixed: checks-effects-interactions, with rent sent last; the transient lock remains |
| Low | `src/TouchstoneHook.sol:183` `creditRent` | The hook trusts the auction to have minted `amount` of claims before calling | Rent settlement moved to the auction for hook size | Accepted (decision 0056): the auction is an immutable the hook already trusts |
| Info | `src/LicenceAuction.sol:216` `_sendRent` | `accrue` reverts when called inside another contract's PoolManager unlock | The PoolManager rejects nested unlocks | Accepted: callers accrue outside an unlock. Not covered by a test |
