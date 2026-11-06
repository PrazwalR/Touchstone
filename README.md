# Touchstone

Touchstone is a Uniswap v4 hook prototype that takes refundable deposits on flagged swaps and settles them
against a signed outside price. Closed-market records use the reopening price. The repository includes the optional auctioned licence, rebate ledger, guarded router, wallet dashboard, keeper, indexer, bots and two replay engines. The current testnet deployment predates some of these components. Deployment manifests and receipts are tracked in [DEPLOYMENTS.md](DEPLOYMENTS.md).

Start with the owner-supplied [specification](spec.md) and the [decision records](docs/decisions/). The [repair audit](docs/audits/m0-m5-repair-2026-10-30/README.md)
distinguishes repaired defects from remaining design and validation work.

## Run the existing checks

Use Foundry 1.5.1, Solidity 0.8.26/Cancun, Node 24, pnpm 10.14.0 and Python 3.13. Dependency locks are committed.

```sh
cd contracts
forge fmt --check
forge build
forge test -vvv
cd ../backend
pnpm install --frozen-lockfile
pnpm abi
pnpm typecheck
pnpm -r test
cd ../frontend
pnpm install --frozen-lockfile
pnpm sync && pnpm typecheck && pnpm test && pnpm build
cd ../sim
cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked
REPLAY_PORT=18568 ./check-anvil.sh
cd ../research
uv sync --locked
uv run ruff check .
uv run mypy
uv run pytest
```

Backend integration tests use a local Anvil PoolManager and mock oracles. They require Forge build artifacts;
when Foundry tools are absent, those suites skip. They are local mechanics tests, not real Pyth fork evidence.
The locally compiled test PoolManager exceeds EIP-170 under these compiler settings; production uses a verified
canonical deployment. Run `python scripts/check_release_gates.py sizes` from the root after building to check
the first-party core without relaxing its size limit.

## Evidence and limitations

- E1/E2 are **historical backtests** on one Ethereum v3 pool. Saved results report a G1 pass with caveats;
  raw datasets are not included, and the original results are preserved rather than recomputed or retuned.
- E3/E4 have renewed committed pre-registrations (decision 0052), with approximate-replay limits disclosed.
  The owner confirmed swap/Chainlink/Binance inputs on the Mac checkout and started a fresh Pyth download on 6 November. E3/E4 still have no published verdict. Fresh downloads do not need the legacy cache manifest; see [current data status](docs/HANDOFF.md#2-research-exactly-where-each-experiment-stands). The separate freeze commit records pre-data chronology.
- E6 **simulation** hit its freshness kill line in all 21 cases in both windows. Held-out mean absolute price error rose 39.2% to 73.3% against static. [E6 result](research/results/E6.json)
- E5 **simulation** has no formal kill, but negative break-even recall makes that line vacuous on this window; held-out fine-split recall falls to 9.7%–11.1%. Padding profit and exact-output consequences remain unevaluated. E7, E10 and E11 remain drafts. E9 is skipped by owner decision. Experiment results and caveats are in the [research write-up](research/results/README.md).
- [Gas figures](docs/gas.md) distinguish measured values from targets. Coverage and gas gates are not waived.
- A successful settlement may leave a ledger entitlement when best-effort token delivery fails.
- Record/event ABI now includes an authenticated executed-fee snapshot; old deployed ABIs need their matching
  client. Follow the backend recovery notes; do not invent historical fee values.
- Fee-on-transfer tokens are unsupported. No production deployment, router integration, mainnet readiness,
  or endorsement is claimed. The spec requires external audit before mainnet use.

Configuration is validated from the environment; see [.env.example](.env.example). Keep keys and passwords
outside version control. Deployments are recorded in DEPLOYMENTS.md.

The [current handoff](docs/HANDOFF.md) records remaining work and owner inputs, with the [3 November M11 log](docs/m11-handoff-2026-11-03.md) preserving earlier measurements. The [keeper handoff](docs/keeper-handoff.md) covers the existing signer machine; the [read-only API](backend/indexer/README.md) and [demo bots](backend/bots/README.md) have explicit startup/configuration instructions. No live service or demonstration transaction is implied by local tests.
