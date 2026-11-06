# 0067 Demo pool: a band around the reference, over a full-range backstop

Date: 7 November 2026. Status: implemented in `script/CreatePool.s.sol` and both chain configs.

## Problem

The Arbitrum Sepolia demo pool was seeded with one full-range position of 10 USDC and its ETH side. The
dollar thresholds in the testnet config are the spec §14 defaults scaled down 1,000 times (N0 = 5 USDC), but
the depth was not. A demonstration swap of 6 USDC moves the price of a 10 USDC full-range position by more
than a factor of two. Swaps since deployment have left the pool at 4.07 USDC per ETH, against a Chainlink
reference of 2,230.51 (read on 7 November 2026), a gap of about +54,700%. Presented as-is, every price
comparison on the dashboard looks fabricated even though it is a real on-chain read.

## Decision

`CreatePool` seeds two positions through Uniswap's PoolModifyLiquidityTest router, both priced from the same
Chainlink read that initialises the pool:

1. A full-range backstop of `pool.liquidityQuote` (15 USDC), so a swap that crosses the band edge still finds
   liquidity instead of running to its price limit.
2. A band of `pool.concentratedQuote` (60 USDC) from about `pool.concentratedHalfWidthBps` (300) below the
   reference to as far above, widened outward to the tick spacing. One tick is a factor of 1.0001, so a tick
   is about one basis point at this width.

The script reverts on a half-width below one tick spacing or above 5,000 bps. The deployment file gains
`bandTickLower`, `bandTickUpper` and `bandLiquidity`. `scripts/deploy-testnet.sh` now checks the sum of
both quote amounts and the ETH they need at the live Chainlink price, plus 0.005 ETH for gas.

## Evidence

Fork rehearsals against Arbitrum Sepolia, 7 November 2026, all wiring, URC-4, flagged-swap and licence checks
passing. At 20 + 80 USDC the band liquidity was about 245 times the full-range liquidity, and a 6 USDC buy quoted
0.0026882 ETH, about 2,232 USDC per ETH against a reference of 2,230.5: the 5 bp fee plus about one basis point
of impact. The configured 15 + 60 USDC, sized to the deployer's 80.5 USDC balance, quoted 0.0026844 ETH for the
same buy, with band liquidity 7.56e13. Moving the price 1% inside the band takes about 18 USDC. *Measured* on a
fork; the live pool will differ by whatever trades it sees.

## Trade-offs and alternatives

- Rejected: raising only the full-range amount. Reaching the same depth would take about 245 times the USDC,
  far beyond what the Circle faucet gives.
- Rejected: scaling the triggers down further instead. That changes the testnet parameters to fit the
  demonstration, and §0.1 forbids that.
- Cost: once the reference moves more than about 3% from the starting price and the pool is traded there,
  only the backstop remains and impact grows again. Before a recording, close the gap with one arbitrage swap
  (it is flagged like any other) or redeploy. The band edges are in the deployment file.
- This is a deployment detail of the demonstration pool. It changes no formula, threshold or contract.
