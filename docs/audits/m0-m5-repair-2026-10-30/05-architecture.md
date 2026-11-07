# Architecture: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Medium. Location: `contracts/src/TouchstoneFactory.sol:113; backend/indexer/src/indexer.ts:#range`.

Permissionless first registration chooses economic config for a key. Do not add owner access: the design has no owner. Indexer writes grouped-by-contract events without a transaction; crash/reorg may leave raw and derived state inconsistent. Canonical-pool trust changes require owner choice; atomic local indexing preserves existing intent.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Indexer now gathers RPC data before atomic raw/derived/cursor writes, orders by block/log, validates prior and end anchors, and rescans from configured start on detected reorg. Keeper persists canonical anchor and pool registry. No owner, proxy or new registration authority added. ABI/state compatibility for 0044 is explicit.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
