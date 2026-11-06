# 0039 Local stack for end-to-end tests

Status: decided.

`contracts/test/integration/LocalStack.s.sol` deploys a PoolManager, test tokens, `MockPythUnique`,
`MockV3Aggregator` and the Touchstone core on anvil, creates a pool and adds liquidity. It lives under `test/`
because it deploys mocks (§0.2); the core deployment itself is `script/base/CoreDeployer.sol`, which M8's
`DeployCore` reuses unchanged.

The PoolManager compiled at this repository's settings is 26,947 bytes, above EIP-170. Uniswap compiles it with
its own settings, and on testnets the canonical deployment is used, so only the local stack runs anvil and the
script with `--disable-code-size-limit`. The hook itself is checked against the limit in `forge build --sizes`.
