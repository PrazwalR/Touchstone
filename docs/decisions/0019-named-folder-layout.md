# 0019 Named top-level folders

Status: decided by the owners on 25 October 2026.

Context: spec §6 puts the Foundry project at the repository root. The owners asked for named top-level folders.

Choice: `contracts/` (Foundry), `backend/` (pnpm workspace: `shared`, `keeper`, `indexer`; `bots` from M8),
`frontend/` (dashboard, later), `research/`, `sim/`, `docs/`. Every path in the spec that names `src/`, `test/`,
`script/`, `lib/` or `foundry.toml` means the same path under `contracts/`.

Consequence: commands run from `contracts/`; the README lists them. `fs_permissions` reaches the Python vectors with
`../research/reference/vectors`.
