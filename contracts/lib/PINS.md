# Vendored dependencies

Dependencies are vendored as plain directories, not git submodules, because the repository
is built locally without git until the owners choose to publish it (decision 0020). Each was
cloned at the commit below and its `.git`, nested `lib/` and `.github/` were removed. Nested
dependencies are flattened to one copy each so every import resolves to the same source file.

| Directory | Upstream | Commit / tag | Notes |
| --- | --- | --- | --- |
| `v4-core` | github.com/Uniswap/v4-core | `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` | Spec §6.2 pin |
| `v4-periphery` | github.com/Uniswap/v4-periphery | `9969eec44cfdf07e24b41de47f40276a58401976` | Spec §6.2 pin |
| `uniswap-hooks` | github.com/OpenZeppelin/uniswap-hooks | `b5f10574f943911635754dd76ed6ce95858b7d93` (tag v1.3.0-rc.0) | D-4 |
| `pyth-sdk-solidity` | github.com/pyth-network/pyth-crosschain, `target_chains/ethereum/sdk/solidity` | tag `pyth-evm-contract-v1.4.6` (`d657d97eddaeb8984ee197fc60349dc176d98787`, 7 Aug 2026) | Only the SDK subtree is vendored; the monorepo is not |
| `forge-std` | github.com/foundry-rs/forge-std | tag `v1.12.0` (`7117c90c8cf6c68e5acce4f09a6b24715cea4de6`) | Matches the local Foundry 1.5.1 cheatcode set; v1.17.0 adds Vm.Gas fields 1.5.1 does not return |
| `openzeppelin-contracts` | github.com/OpenZeppelin/openzeppelin-contracts | `fcbae5394ae8ad52d8e580a3477db99814b9d565` (v5.5.0) | The commit uniswap-hooks pins |
| `permit2` | github.com/Uniswap/permit2 | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` | The commit v4-periphery pins |
| `solmate` | github.com/transmissions11/solmate | `4b47a19038b798b4a33d9749d25e570443520647` | The commit v4-core pins |

uniswap-hooks pins its own v4-core (`d153b04`) and v4-periphery (`7ebd04b`); remappings point it at the
spec's pins above instead, so the hook and the PoolManager share one set of types.

To convert to submodules before publishing: delete each directory, `git submodule add <url> lib/<dir>`,
and check out the commit in this table.
