# D2 validation

Work began 1 November 2026 and continued across the local midnight. All counts below are local engineering measurements, not research returns or testnet transaction results.

## Measured checks

- Foundry v1.5.1 archive verified against the repository-pinned SHA-256. Normal production build passed.
- Contract suite excluding forks: 170 passed, 0 failed, 0 skipped, including the standard invariant suite (21 suites).
- Real-Pyth Arbitrum Sepolia fork suite: 3 passed using the configured RPC. The first attempt against the public RPC failed at setup because historical state at fixture block 323745826 was unavailable; this was an endpoint/archive limitation, not a changed-contract failure. Provider credentials and raw configured-RPC logs are not committed.
- Backend strict typecheck passed. Complete Anvil-enabled suite: shared logger 2, keeper 36, indexer 24, bots 5 passed (67 total), no skipped integration tests in that run. Rechecked indexer after bounded lag queries/indexes: 24 passed with Anvil.
- Research: Ruff clean, strict mypy clean (41 source files); 65 tests passed. E1/E2 frozen analysis still matches both saved result hashes. E3's original disclosure is byte-for-byte unchanged; renewed E3/E4 hash gate passes.
- Frontend: strict typecheck, 26 tests and production build passed. The build reports its existing large-chunk warning; no chunk budget was waived or redefined.
- Backend, frontend and locked Python dependency audits reported no known vulnerabilities. This is a registry check, not proof of absence of vulnerabilities.
- Browser QA: API-unconfigured state, empty configured history, credits/claims tab, invalid recipient validation, cleared evidence and unavailable-metric states verified. The configured UI check used an empty temporary test database, not a live indexer. `history-qa.png` captures that state and must not be described as live settlement evidence.
- `git diff --check` passed. No Solidity source, contract financial formula, default or research pass/kill threshold changed.

## New regression coverage

API tests cover exact integer preservation, record/recipient filtering, duplicate/unknown/injected/oversized query rejection, method/CORS restrictions, rate limits that ignore spoofed forwarding headers, generic error responses, missing database refusal, closure-header lag and rewind. Frontend tests reject wrong-chain/malformed links and preserve token strings. Bot tests cover seeded/integer sampling, token ordering/decimals and actual bounded testnet configuration validation. Migration tests reject missing provenance, duplicate times, stale/draft access and wrong hashes. Simulation tests check conservation, first touch/bucket draining, markout/constant product, cost-based abstention, runner guards and all-window sensitivity output.

## Scoped audit resolutions

| Severity | Surface | Root cause | Resolution / remaining limit |
| --- | --- | --- | --- |
| High, release risk retained | `research/tsr/settle.py`, decisions 0043/0049 | Approximate overshooting reconstruction and other model/state gaps can distort economic conclusions. | Owner preserved formulas; 0052 and E3 disclose all differences. Not declared safe for release. |
| Medium, fixed | `backend/indexer/src/indexer.ts:64`, `store.ts:70` | Event history alone lacked closure time and reorg-safe lag evidence. | Atomically store confirmed closure headers and remove them on rewind; regression test. |
| Medium, fixed | `backend/shared/src/log.ts` | Top-level-only redaction missed provider credentials in URLs and nested error text. | Recursive known-secret/URL redaction, cyclic/depth handling and regression tests. |
| Medium, fixed | `backend/indexer/src/api.ts:40` | A public history endpoint would otherwise expose an unbounded/queryable local database. | Read-only connection, strict bounded parameterized routes, CORS, bounded per-socket rate limiter, generic errors and query indexes. TLS/reverse-proxy deployment still required. |
| Medium, fixed in preparation | `research/experiments/rekey_pyth.py:20` | Legacy rows omit feed IDs, so filename-based reuse can assign wrong provenance. | Require source manifest, hashes and exact coverage; no guessed migration or copied historical data. |
| Medium, pending deployment | `docs/keeper-handoff.md` | Current Linux environment uses incomplete/legacy variable names and missing wallet files. | Preflight reports field names and metadata only; owner chose signer-machine runbook. No local live keeper/indexer claimed. |
| Informational | `research/experiments/behaviour.py` | A simplified simulation can be mistaken for release evidence. | Draft/frozen/commit/config guards, full provenance and explicit incomplete-model verdicts. No result JSON produced. |

## Limits

Coverage/gas release gates and external-audit requirements remain in force. Solidity source is unchanged, so no fresh coverage/Slither/gas certification is claimed here. Existing coverage and gas release concerns are not closed by offchain tests. No real E3/E4/E5/E6 data run, historical cache migration, live demonstration transaction, LP net estimate, E9 verdict, M9 licence or Rust/revm adaptation is claimed.
