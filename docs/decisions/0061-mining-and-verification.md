# 0061 Hook address mining and explorer verification

The script inventory in the developer spec names MineHookAddress.s.sol and Verify.s.sol.
Use the existing deployment entry points for both operations.

In `contracts/script/base/CoreDeployer.sol`, `_deployCore` predicts support contracts from the sender nonce, encodes those addresses into the hook constructor, and calls `HookMiner.find` with that init code, the flag mask and the deterministic deployer. It checks the nonce before creating the support contracts and verifies the resulting addresses and back-references. A salt mined independently could become stale after a sender nonce or constructor change.

`scripts/deploy-testnet.sh` rehearses on a fork, then asks Forge to verify the DeployCore broadcast with the selected chain and compiler artifacts. The script also prints the resume-and-verify command for an interrupted broadcast. This decision records the implementation path. Explorer verification for the next deployment still requires the owner's receipts.

## Fork validation

On 3 November 2026 the configured Arbitrum Sepolia RPC served the archive state pinned in `contracts/test/fixtures/hermes/arbitrum-sepolia-323745826.json`. From `contracts/`, Foundry 1.5.1 ran `forge test --match-path 'test/fork/**'`. Measured test output:

```text
[PASS] test_Fork_MixedFirstAndNextUpdatesAreRejected()
[PASS] test_Fork_RealChainlinkFeedReadsWithoutReverting()
[PASS] test_Fork_SettlesAgainstTheFirstRealUpdateAndRejectsTheNext()
3 tests passed, 0 failed, 0 skipped
```

This exercised local fork execution against historical contracts and Hermes fixtures. E8 still needs receipts from the owner's redeployment.
