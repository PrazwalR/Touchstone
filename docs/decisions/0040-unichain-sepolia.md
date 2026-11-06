# 0040 Unichain Sepolia as a deployment chain

Status: open for the owners. Checked 28 October 2026.

The owners asked whether to deploy on Unichain Sepolia (chain id 1301) as well as Arbitrum Sepolia and Base
Sepolia. What the chain offers, against what the hook needs at construction and registration:

| Dependency | Unichain Sepolia | Source |
| --- | --- | --- |
| v4 PoolManager | `0x00b036b58a818b1bc34d502d3fe730db729e62ac`, 24,009 bytes of code, same size as on Arbitrum and Base Sepolia | developers.uniswap.org v4 deployments; `cast code` |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43`, `version()` 1.4.3, ETH/USD feed exists | `cast call`; not listed on Pyth's EVM address page, which lists Arbitrum and Base Sepolia at 1.4.6 |
| Chainlink ETH/USD | not found | Chainlink's feed directory timed out and no published address turned up |
| Chainlink sequencer uptime feed | not found | as above |

The drift trigger reads a Chainlink `AggregatorV3Interface` (D-3, decision 0003). Without a Chainlink feed on
the chain, the hook cannot be deployed with the specified reference, and replacing it with Pyth for the trigger
is a mechanism change that §0.1 reserves for the owners.

Recommendation: keep Arbitrum Sepolia as the primary chain (Chainlink ETH/USD and the sequencer feed are
published there) and Base Sepolia as the second. Add Unichain Sepolia at M8 only if a Chainlink ETH/USD feed
is confirmed on it then. Pyth 1.4.3 there would also need `parsePriceFeedUpdatesUnique` confirmed against
current Hermes blobs on a fork before any deployment.

`UNICHAIN_SEPOLIA_RPC_URL` is in `.env.example` so the check can be rerun without code changes.
