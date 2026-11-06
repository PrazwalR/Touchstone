# Backend

pnpm workspace, Node 24 (native TypeScript type stripping, so no build step).

| Package | Status |
| --- | --- |
| `shared` | ABIs exported from `contracts/out` (`pnpm abi` after `forge build`), the record type, env validation, JSON logs |
| `keeper` | Spec §15.1 steps 1 to 5 and 7: ingest, schedule from `Settler.settleTime`, fetch first-after-t0 updates from Hermes, simulate, settle or expire, drip and push. One settlement per transaction (decision 0036) |
| `indexer` | Every Touchstone event and the PoolManager's Swap, ModifyLiquidity and Donate for Touchstone pools, in SQLite (`node:sqlite`), idempotent, with reorg detection. Derived per-pool tables come with the dashboard |
| `bots` | Demo bots, M8 |

Configuration is read from the environment and validated at startup; see `.env.example` at the repository root.

Tests: `pnpm -r test`. The keeper and indexer end-to-end tests start anvil, deploy
`contracts/test/integration/LocalStack.s.sol` (run `forge build` in `contracts/` first), and are skipped if
anvil or forge is missing. The keeper's test serves Pyth updates from a local Hermes stand-in in Hermes'
response format, encoded for `MockPythUnique`.

The record ABI includes the effective fee captured at swap time as `swapFeePips`; the keeper persists it
without replacing it with the pool's current fee. Old state files with open records missing that field fail
validation. Keep those files for recovery, rather than adding an invented snapshot. For a fresh development
deployment, use a new `KEEPER_STATE_PATH` and set `KEEPER_START_BLOCK` to that deployment's start block to
rebuild state from its events. Records from an older contract ABI must be handled with that version's client
and deployment; changing a local state file cannot change an existing record commitment.
