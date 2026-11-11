# 0070 Demo pool: an owner-only liquidity vault and a recentering script

Date: 11 November 2026. Status: implemented in `contracts/script/` and `scripts/`; the live pool has not been
recentred yet. No contract in `src/` changes, and no formula, threshold or parameter changes.

## Problem

The shared testnet demo pool repeatedly read single-digit prices (3.23, 5.62) against a Chainlink price above 2,000,
and the Simulation page warned that it was out of range. Decision 0067 added a concentrated band and the dashboard
refuses trades that cost more than 5% of price, yet the pool kept breaking. Two causes remained.

1. **The band does not follow the market.** It was placed within about 3% of the Chainlink price on 7 November
   (2,156 to 2,303 USDC per ETH). By 11 November ETH had fallen to about 2,060, below the band, with only the 15 USDC
   full-range backstop underneath. Any trade toward the reference then crosses into that thin liquidity, so every
   quote shows an impact of tens of percent, and a trade of a few USDC can move the price to single digits.
2. **Anyone can withdraw the liquidity.** `CreatePool` seeded both positions through Uniswap's
   `PoolModifyLiquidityTest`. That router calls `PoolManager.modifyLiquidity` as itself, so it owns every position
   it creates, and it pays any caller who removes one. On a fork of the live chain (11 November 2026, measured), an
   unrelated account removed the 60 USDC band (liquidity 75,786,644,369,063) and received 0.0544 ETH and about 26 USDC.
   The page guard cannot prevent this, and neither can any change to the dashboard.

Swaps remain permissionless by nature, so a direct call to the router or the PoolManager can still move the price. That
cannot be removed on a shared pool; it can be undone quickly.

## Decision

- **`PoolLiquidityVault`** (`script/support/`, testnet tooling, not protocol code) holds the positions. It calls
  `modifyLiquidity` itself, so it is the position owner, and only its `OWNER` can make it do so. ERC-20 debts are
  pulled from the owner (which approves the vault), credits go to the owner, and unused native value is returned.
- **`CreatePool`** now deploys a vault and seeds into it. Its maths moved unchanged into `PoolSeeding`, shared with the
  new script. The deployment record gains `pool.vault`.
- **`RecenterPool`** withdraws every position (the legacy ones held by the open router and any in the vault), moves
  the price onto the Chainlink reference, and seeds the backstop and the band again at that price inside the vault. It
  records the vault and the new band in the deployment file. It is safe to repeat.
- **`scripts/recenter-pool.sh`** has three modes: `check` (read-only verdict on whether the pool is ready to
  demonstrate on), `rehearse` (on a local fork: dump the pool, recentre, verify) and `run` (live, rehearses first, then
  signs with the deployer's keystore).

With no liquidity left, a swap to a price limit moves the price and no tokens change hands, so undoing a dump costs no
capital. Seeding again does need tokens. If the deployer holds less than the configured depth, both positions are scaled
down together and the share is printed; below 10% the run stops. A top-up and a second run restore the full depth.

## Evidence

All measured on forks of the live Arbitrum Sepolia state, 11 November 2026, run from an unrelated funded account:

- Pool at 2,187.84 against Chainlink 2,060.5, positions held by the open router: after `RecenterPool` the pool read
  2,060.48, the band was 1,994 to 2,130, the vault owned it, the router owned nothing, and an outsider's removal through
  the router reverted.
- Pool dumped to 3.46 and the account cut to 20 USDC: the second run restored the price to 2,060.48 and seeded at 27%
  depth, as designed.
- `scripts/rehearse-deploy.sh arbitrum-sepolia` still passes with the vault-based `CreatePool`.
- Six unit tests (`test/unit/PoolLiquidityVault.t.sol`): the owner adds and removes, native value is refunded, a
  non-owner reverts, the callback answers only the PoolManager, an owner that cannot receive ether reverts, and the open
  router cannot remove a vault position.

## Trade-offs

- The run is several transactions, not one, so for a few seconds the pool has no liquidity or the wrong range. That is
  acceptable on a testnet pool and not for a real one.
- The deployer must run it, and needs the tokens to seed at full depth. Nobody else can withdraw the liquidity.
- A wider band would need less upkeep and give less depth per USDC (a band of half-width 1,000 bps holds about a third
  of the depth of 300 bps for the same quote amount). The width stays a config value.
- An automatic guardian that trades the pool back toward Chainlink was considered and not built. It would need a funded
  hot key running unattended, and the recenter script does the same job on demand.

## What this does not change

The protocol contracts are unchanged. The vault is not audited and must not be used for a mainnet pool. The live pool
keeps its legacy open-router positions, which anyone can withdraw, until `scripts/recenter-pool.sh run` is executed.
