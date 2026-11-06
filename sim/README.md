# Touchstone bytecode replay

The Rust runner executes ordered Cancun calls in revm against a complete local account and storage snapshot. It binds the PoolManager and TouchstoneHook runtimes to the supplied Foundry artifacts, filling only the compiler's declared immutable ranges from deployed code. Each transaction commits its state into the next one. A mismatched status, gas total or ordered event log fails the replay. Successful output is a JSON array of receipts.

## Reproduce the local check

From the repository root, use the CI-pinned Foundry toolchain and a Rust toolchain compatible with the lockfile.

```sh
(cd contracts && forge build)
(cd sim && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked)
REPLAY_PORT=18568 sim/check-anvil.sh
```

The check starts its own local Anvil process, deploys the repository's LocalStack fixture, captures an approval followed by one small and one flagged guarded swap, and checks the same receipts in revm. Anvil's code-size exception is required by the vendored PoolManager build. Execution uses the actual compiled hook and PoolManager with fixture tokens and test oracles.

To capture another sequence on a local Cancun chain, run `python3 -I capture.py --rpc <local-rpc> snapshot --stack <stack.json> --output <seed.json>` before the transactions. Run the same command with `tape --seed <seed.json> --end <last-block> --output <tape.json>` afterwards, then `cargo run --locked -- <contracts/out> <tape.json>`. Capture includes every mined call after the snapshot and rejects unsupported transaction types. Use a complete local chain rather than an Anvil fork with lazy remote state. This format supports legacy and EIP-1559 calls with empty access lists.

This local result is measured execution parity. Historical swap reconstruction, signed historical Pyth settlement, and the comparison with E3 remain open. E8 requires the owner's deployed testnet receipts. Full-transaction gas from this replay is a different quantity from the hook-added gas target.
