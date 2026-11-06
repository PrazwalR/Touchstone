# Deployments

Every address here was read back on chain before use. Testnet only; nothing is deployed to a mainnet.

## Arbitrum Sepolia (421614), current deployment: 7 November 2026

Status: **deployed 7 November 2026** from `0xaE0CCAC79AfFE82c8d736b1Eaa8351fe9E0f1A23`, with the licence auction. All
seven contracts are verified on Arbiscan. The wiring was read back on chain: the hook's Settler, Lens and licence, the
Lens's and the auction's `HOOK`, the hook address flag bits (`0x20C4`), the pool's lease terms (K = 60 s, 10% increment,
minimum rent 1) and a hook size of 23,993 bytes. Total gas paid: about 0.00044 ETH. This replaces the 31 October
deployment below for the dashboard, the keeper and the indexer; the older contracts remain on chain and unused.

| Contract | Address | Block (L2) | Transaction |
| --- | --- | ---: | --- |
| TouchstoneHook | [`0xeD486b0a1d875bBac3DE259AFc583984389420c4`](https://sepolia.arbiscan.io/address/0xeD486b0a1d875bBac3DE259AFc583984389420c4#code) | 326729262 | [`0xac3645…b2a5`](https://sepolia.arbiscan.io/tx/0xac364570c4e361b9014c9c592b389b753d21376f578619323545133da0a0b2a5) |
| TouchstoneLens | [`0x4085E5BD0D5a60128487705D017F2B312AFAefd2`](https://sepolia.arbiscan.io/address/0x4085E5BD0D5a60128487705D017F2B312AFAefd2#code) | 326729255 | [`0x7b10b1…81a0`](https://sepolia.arbiscan.io/tx/0x7b10b177454cc14e023c75ba747bee16132d498e4c765eeff5cc867c7ea681a0) |
| Settler | [`0xBC3ff14B7e4cC5549f52436a45F74EF5d4caf287`](https://sepolia.arbiscan.io/address/0xBC3ff14B7e4cC5549f52436a45F74EF5d4caf287#code) | 326729239 | [`0xd3cada…7e10`](https://sepolia.arbiscan.io/tx/0xd3cadaed4d061f33524d740ee89e1baff56a201f90847ebd407552395f0f7e10) |
| RebateLedger | [`0x693a7eF9cF0eA06b634f3673C2805627Eb7e78f8`](https://sepolia.arbiscan.io/address/0x693a7eF9cF0eA06b634f3673C2805627Eb7e78f8#code) | 326729230 | [`0xb11d9e…06a2`](https://sepolia.arbiscan.io/tx/0xb11d9e2520ac1387b3ed0268be7e77244d909ae8c3f1b0d7ea95cba7917c06a2) |
| TouchstoneFactory | [`0xfbbBC7b89682BeCC22ddFCe4B8941cd2867466Fb`](https://sepolia.arbiscan.io/address/0xfbbBC7b89682BeCC22ddFCe4B8941cd2867466Fb#code) | 326729235 | [`0xb60ca8…a339`](https://sepolia.arbiscan.io/tx/0xb60ca88461392c8b0c16df1a3046618d721f6b3cfd2589f70ee629065c8aa339) |
| GuardedRouter | [`0xdb8C7995200759C6FD5c5f5c803d94184A577Ddb`](https://sepolia.arbiscan.io/address/0xdb8C7995200759C6FD5c5f5c803d94184A577Ddb#code) | 326729245 | [`0x89b2db…11fc`](https://sepolia.arbiscan.io/tx/0x89b2dbe627f0ab3928e3b25bada2e1be0df6ceeb41c49d6faf6fcc1677a311fc) |
| LicenceAuction | [`0xA050C01CeeCA0F8c5158223C5C2bDF8B69Ac0b89`](https://sepolia.arbiscan.io/address/0xA050C01CeeCA0F8c5158223C5C2bDF8B69Ac0b89#code) | 326729250 | [`0xf9bb4a…0225`](https://sepolia.arbiscan.io/tx/0xf9bb4aade6991cedf8e049163a40d6094c75bc5e3f796682115d6e1ff9ff0225) |

**Demo pool**: native ETH / Circle USDC, 0.05%, tick spacing 60, pool id
`0x09741a6de859ce342be323e80855894ab0a44691d286784447041d056b448051`, created in
[`0x6a13fa…ccfb`](https://sepolia.arbiscan.io/tx/0x6a13faa121a1d91efb1bb58aed91b4623134cef8a5524fca136c6002d951ccfb) at the Chainlink price.
- Seeded in two positions (decision 0067): a 15 USDC full-range backstop (L = 317,630,726,738) in
  [`0xcfaa2e…1e1874`](https://sepolia.arbiscan.io/tx/0xcfaa2e946b041bfb241d5eeb1c511e62c5cdd726f233b1a5ed1256ebb53e1874) and a 60 USDC band from tick
  -199,560 to -198,900, about 3% either side of the reference (L = 75,786,644,369,063) in
  [`0xed764e…d1c`](https://sepolia.arbiscan.io/tx/0xed764ece7f87af9d6e6faa10b3b1420ac62a7f5332aceaccf41d8aca7e471d1c).
- Read back after creation (*measured*, 7 November 2026): pool price 2,230.3 USDC per ETH against a Chainlink answer of
  2,229.48, a gap of about 4 bps; active liquidity 7.61e13.
- Thresholds are scaled down 1,000x for testnet amounts (`script/config/arbitrum-sepolia.json`).

**Services**: the keeper and the indexer start from block 326,729,230 with new state files. The keeper account is
unchanged, `0x5E48Fda9d06f646aa6Bc4714462Ecb21327bC30a`, holding 0.05 ETH.

### Previous deployment, 31 October 2026 (superseded)

Status: **deployed 31 October 2026** (19:12 to 19:15 UTC) from `0xaE0CCAC79AfFE82c8d736b1Eaa8351fe9E0f1A23`. Every
contract is verified on Arbiscan, and the wiring was read back on chain: the hook's Settler, ledger, factory, trusted
router 0 and block source (ArbSys), and each support contract's `HOOK`. Total gas paid: about 0.00028 ETH.

| Contract | Address | Block (L2) | Transaction |
| --- | --- | ---: | --- |
| TouchstoneHook | [`0x6b28f9F334C4c00b0C24E5b270a6C17B70DCe0c4`](https://sepolia.arbiscan.io/address/0x6b28f9F334C4c00b0C24E5b270a6C17B70DCe0c4#code) | 324756338 | [`0xe35eaa…a1a3`](https://sepolia.arbiscan.io/tx/0xe35eaaecdd3c46daec05b63e244d0ce403811ce678943beafd4f9debd964a1a3) |
| Settler | [`0x0A5e3b238B1BB30b1FEa41382c5B906d30e1f6E4`](https://sepolia.arbiscan.io/address/0x0A5e3b238B1BB30b1FEa41382c5B906d30e1f6E4#code) | 324756327 | [`0x4f6d3e…e181`](https://sepolia.arbiscan.io/tx/0x4f6d3e15c12429289ca121ac9c324685d30e9a07a073294e5650dbf0e75ce181) |
| RebateLedger | [`0x75A3B7fAFD32e966D774fD69A701Ae78A591dEc6`](https://sepolia.arbiscan.io/address/0x75A3B7fAFD32e966D774fD69A701Ae78A591dEc6#code) | 324756316 | [`0x7cd5b4…a036`](https://sepolia.arbiscan.io/tx/0x7cd5b4d28ab372804c09e5bb9577dc4384e03108354014c2753a1b91b15da036) |
| TouchstoneFactory | [`0x94B26D0B923f34a0F34C926c7B2C56a3e44C1C18`](https://sepolia.arbiscan.io/address/0x94B26D0B923f34a0F34C926c7B2C56a3e44C1C18#code) | 324756322 | [`0x956350…db54`](https://sepolia.arbiscan.io/tx/0x956350a01eca8dffa5f6dbf56da42d0a46835d74642bf00e7cde2d4efa56db54) |
| GuardedRouter | [`0x3fBc2B624Ee8C30Be8b350eb7E93CdDE47303cAb`](https://sepolia.arbiscan.io/address/0x3fBc2B624Ee8C30Be8b350eb7E93CdDE47303cAb#code) | 324756331 | [`0x2b4ac3…6950`](https://sepolia.arbiscan.io/tx/0x2b4ac3691907feda701e0049023dac19a5ea0f2a7845e6a388e1dbefff356950) |
| NyseCalendar (2026 to 2028) | [`0x12337866dA4d6f349D63F960f571f2afb3933309`](https://sepolia.arbiscan.io/address/0x12337866dA4d6f349D63F960f571f2afb3933309#code) | 324756581 | [`0xdb1708…4f7e`](https://sepolia.arbiscan.io/tx/0xdb1708e04d93157621e1abfd966958c4393612103243e1f4e74bc36176b54f7e) |

Hook CREATE2 salt `0x…0a50`; the address ends in `0x20C4`, as its permissions require.

**Demo pool**: native ETH / Circle USDC, 0.05%, tick spacing 60, pool id
`0xf8a66da96ebbf91b64c26cf2410b71400bd6a6369afb8659c614010329df2f76`.
- Created at the Chainlink price (about $2,254) in [`0x2df184…e526`](https://sepolia.arbiscan.io/tx/0x2df184518363babf514e0dab89bab489cbb1b5c24c2291867591709a81bfe526).
- Seeded with about 10 USDC of full-range liquidity (L = 210,628,865,210) in [`0xd40f0e…c69`](https://sepolia.arbiscan.io/tx/0xd40f0e44931700631525ef79974008897ef2b6d4ac275b148c375fb369728c69).
- Thresholds are scaled down 1,000x for testnet amounts (`script/config/arbitrum-sepolia.json`).

**Services**:
- **Indexer.** Reads from block 324756322 and has indexed both pool events.
- **Keeper.** Reads from block 324756338. It uses the public RPC `https://sepolia-rollup.arbitrum.io/rpc`, because
  Alchemy's free tier allows only 10-block log queries.
- **Keeper account.** `0x5E48Fda9d06f646aa6Bc4714462Ecb21327bC30a`, funded with 0.05 ETH.

Dependencies, checked on chain on 28 to 31 October 2026 (sources in `contracts/script/config/arbitrum-sepolia.json`):

| Contract | Address | Check |
| --- | --- | --- |
| Uniswap v4 PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` | Uniswap deployments page; 24,009 bytes of code |
| PoolSwapTest (Uniswap) | `0xf3a39c86dbd13c45365e57fb90fe413371f65af8` | `manager()` is the PoolManager |
| PoolModifyLiquidityTest (Uniswap) | `0x9a8ca723f5dccb7926d00b71dec55c2fea1f50f7` | `manager()` is the PoolManager |
| Pyth | `0x4374e5a8b9C22271E9EB878A2AA31DE97DF15DAF` | `version()` 1.4.6; both price ids exist |
| Chainlink ETH/USD | `0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165` | `description()` "ETH / USD", 8 decimals |
| Circle USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `symbol()` USDC, 6 decimals |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` | code present |

## Dry run, 31 October 2026

On an anvil fork of Arbitrum Sepolia. The fork has no ArbSys precompile, so MockArbSys bytecode was placed at
`0x64`; the deployer was anvil's development account with test USDC written to its balance.

1. `DeployCore` deployed the core; the mined hook address ends in `0x20C4`.
2. `CreatePool` created the native ETH / USDC pool at the Chainlink price and seeded about 10 USDC of full-range
   liquidity.
3. A 6 USDC buy through Uniswap's `PoolSwapTest` was flagged (`DepositTaken`, `HookSwap`).
4. The real keeper (`backend/keeper`) ingested the record, fetched the first Pyth updates after t0 from Hermes,
   and settled it on the forked Pyth contract: benign, full refund, as the buy paid heavy price impact in a
   10 USDC pool.

Fork addresses are not real deployments and are not listed.

## How to deploy

See `docs/runbook.md`. In short:

```sh
set -a; . ./.env; set +a
scripts/rehearse-deploy.sh base-sepolia     # fork rehearsal; touches nothing live
scripts/deploy-testnet.sh base-sepolia      # checks funds, rehearses, deploys with verification, syncs the dashboard
```

`deploy-testnet.sh` needs `<CHAIN>_RPC_URL`, `ETHERSCAN_API_KEY`, `DEPLOYER_ADDRESS` and the `touchstone-deployer`
cast keystore; cast asks for the password. The deployer must send no other transaction while DeployCore runs
(spec 19.2), and must hold the pool's `liquidityQuote` plus `concentratedQuote` in USDC and the matching ETH
(decision 0067; the script prints both amounts). Contracts are immutable, so a
redeploy is a new set: record it here beside the 31 October deployment above, which stays live.
