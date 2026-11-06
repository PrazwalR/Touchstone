# Touchstone

Touchstone is a Uniswap v4 hook prototype that collects refundable deposits on flagged swaps and settles them against a signed external price. It includes a guarded swap interface, keeper, indexer, rebate ledger and optional arbitrage licence.

**Testnet only.** The implementation and research are experimental. Deployment manifests describe the contracts actually deployed; the working tree can contain newer functionality.

## Start here

| Task | Guide |
| --- | --- |
| Understand the mechanism and its mathematics | [Formula definitions and research basis](docs/formulas-research-and-current-code.md) |
| Run, deploy or operate the project | [Operations runbook](docs/runbook.md) |
| Find contract addresses | [Deployments](DEPLOYMENTS.md) |
| Review measured results and limitations | [Research results](research/results/README.md) |
| Browse the documentation | [Documentation index](docs/README.md) |

## Requirements

- Node.js 24 and pnpm 10.14.0
- Foundry 1.5.1, with Solidity 0.8.26 and the Cancun EVM target
- Python 3.13 and uv for research
- Rust and Cargo for the replay engine

Dependency lockfiles and vendored Solidity dependencies are included. Copy `.env.example` to `.env` for service or deployment configuration. Keep credentials outside Git.

## Build and run the interface

From the repository root:

```sh
pnpm -C frontend install --frozen-lockfile
pnpm -C frontend build
pnpm -C frontend dev
```

The interface uses the committed testnet deployment metadata. Wallet transactions require funds on the selected testnet. A local history service is optional; configure it as described in the [frontend guide](frontend/README.md).

## Build contracts and services

```sh
(cd contracts && forge build)
pnpm -C backend install --frozen-lockfile
pnpm -C backend abi
pnpm -C backend typecheck
```

To regenerate frontend ABIs and deployment metadata after a contract build:

```sh
pnpm -C frontend sync
```

To start configured services:

```sh
pnpm -C backend preflight
scripts/run-services.sh indexer api keeper
```

Preflight requires a complete `.env`, keeper credentials with private file permissions, and a consistent deployment. See the [runbook](docs/runbook.md) before sending transactions.

## Validate changes

| Component | Commands |
| --- | --- |
| Contracts | `cd contracts && forge fmt --check && forge build && forge test` |
| Backend | `pnpm -C backend typecheck` and `pnpm -C backend test` |
| Frontend | `pnpm -C frontend test` and `pnpm -C frontend build` |
| Research | `cd research && uv sync --locked && uv run ruff check . && uv run mypy && uv run pytest` |
| Rust replay | `cd sim && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked` |
| Release sizes | `python3 scripts/check_release_gates.py sizes` after building contracts |

Backend integration suites need Foundry artifacts and Anvil. They use local PoolManager and mock-oracle fixtures; they do not establish live oracle performance. Historical research datasets are not included.

## Evidence and limits

- **E1/E2:** historical backtests on one Ethereum v3 pool. Held-out trigger recall is about 98.9% of measured toxic markout, with about 23.4% of swaps flagged. This is detection evidence, not a measured improvement in LP returns.
- **E3/E4:** registered settlement and oracle-basis experiments have no published verdict in this checkout.
- **E5:** delayed fine splitting can reduce held-out recall to 9.7–11.1%. Its profitability after costs remains unevaluated.
- **E6:** all 21 registered simulated configurations failed the freshness threshold. Held-out price error was 39.2–73.3% higher than the static-fee baseline in the stated model.
- **Other experiments:** E7, E10 and E11 remain drafts; E9 is skipped. See the [full results](research/results/README.md) for scope and reproducibility details.

Fee-on-transfer tokens are unsupported. Best-effort refunds can become claimable ledger balances. Oracle uncertainty, approximate tick reconstruction, routing friction and market response remain material limitations. No mainnet readiness or Uniswap endorsement is claimed.

## Repository layout

| Directory | Contents |
| --- | --- |
| `contracts/` | Solidity contracts, tests, deployment scripts and manifests |
| `backend/` | Keeper, indexer, history API, bots and shared interfaces |
| `frontend/` | Wallet interface, live records and documentation reader |
| `research/` | Registered experiments, replay models and recorded results |
| `sim/` | Rust replay engine and local integration tooling |
| `docs/` | Mechanism, operations, lessons, decisions and verification evidence |
| `scripts/` | Deployment, service and release-check helpers |
