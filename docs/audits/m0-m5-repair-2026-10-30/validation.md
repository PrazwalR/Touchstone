# Final validation, 30 October 2026

Findings and decisions are in the audit README and decisions 0042 to 0047. Raw machine counts are in validation.json.
No commit, push, deployment or historical experiment was performed. The GitHub workflow is prepared but has
not run on GitHub; local commands below are not evidence of a remote green build.

## Tools and scope

- Foundry1.5.1, downloaded to an isolated /tmp path. Release archive SHA-256 verified against GitHub release
  metadata:73640b01bd9ed29fdb4965085099371f8cf0dbbec3e2086cf54564efc4dcfe88.
- Solc0.8.26, Cancun, existing per-contract optimizer/IR profiles and isolated test transactions.
- Node24.22.2, pnpm10.14.0, Python3.13 project environment, locked dependencies.
- Slither0.11.6 and pip-audit2.10.1. No upstream dependency or economic parameter upgraded to obtain a pass.

## Executed checks

| Check | Result |
| --- | --- |
| forge fmt --check | Passed |
| forge build | Passed |
| Full forge test -vv | 130 passed, no failures/skips; includes6 invariant properties at configured256 runs/depth500 |
| Full forge coverage --report lcov --ir-minimum | 130 passed, no failures/skips; evidence generation passed but coverage gate failed |
| Core runtime gate | Hook20,753B; Settler14,363B; Factory8,571B; Ledger3,882B; all below24,576 |
| Unrestricted forge build --sizes | Nonzero because vendored test PoolManager exceeds EIP-170; documented in0039, not suppressed globally |
| Backend tsc --noEmit | Passed on Node24 |
| Keeper | 35 passed, including3 actual Anvil E2E tests |
| Indexer | 17 passed, including2 actual Anvil E2E tests |
| No-Foundry E2E initialization | 47 unit tests passed,5 integration tests correctly skipped; no artifact/database collection errors |
| Research Ruff / mypy | Passed; mypy32 source files |
| Research pytest | 55 passed |
| Release gate checker tests | 5 passed, including exact5%/95% boundaries and rejected unreviewed static results |
| Reference-number/vector regeneration | Both checked JSON files reproduced byte for byte in a temporary directory |
| E1/E2 integrity | Both preregistration hashes match saved results; frozen analysis SHA-256 remains40041d0c9d7e078aacce4a1aeee36135bc6fe385304b6db08d36b08135de64c6 |
| Slither | Analyzer completed;62 findings, no High-class detector reports, all exact fingerprints triaged. Not a zero-finding security verdict |
| pnpm audit | No known vulnerabilities reported for the scanned backend lock |
| pip-audit -r requirements.lock | No known vulnerabilities reported; export now includes the existing locked numpy dependency |
| git diff --check | Passed |

The full invariant configuration remains unchanged. No fuzz/invariant runs, gate thresholds, oracle guards or
price parameters were lowered to pass tests. Coverage reports warn of inaccurate/minimum-IR source anchors;
that is a limitation, not grounds for claiming uncovered code is tested or waiving the gate.

## Gates that are not green

Full first-party src LCOV:687/855 lines =80.35%;122/175 branches =69.71%. Both are below95%.
The existing attribution problem, staged closure branch and remaining real coverage gaps need work.

| Named measured path | Original tracked baseline | Final measured | Change |
| --- | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,242 | +2.02% |
| Unflagged at/above N0 | 45,398 | 47,069 | +3.68% |
| Flagged | 139,453 | 141,857 | +1.72% |
| Retaining settlement | 245,418 | 298,640 | +21.69% |
| Expiry | 172,206 | 217,662 | +26.40% |
| Drip | 41,183 | 41,098 | -0.21% |

Settlement/expiry violate the5% regression gate. Settlement also exceeds its250,000 target. Below-N0 swaps
still exceed the20,000 E8 pass line and15,000 target. Other swap paths remain above their documented targets.
Security approvals did not silently approve a new gas baseline. scripts/check_release_gates.py gas exits
nonzero against gas-before.json; coverage exits nonzero against95%. CI preserves these failures.

Raw Slither detector exit is nonzero because findings exist. The reviewed-fingerprint check passes only the
62 inspected findings and rejects changed/new IDs or analyzer failures; no blanket detector exclusion added.
See slither-triage.md for each category's disposition. Unresolved economic findings are not removed by this check.

## Reproductions and limitations

Eight oracle tests failed on original malformed/codeless responses and passed after repair. Native-stalling and
paused-token payout cases failed before approved isolation and pass afterward. Five protocol-fee regressions
prove fee direction, historical snapshot, forgery protection and no retention from the original losing trade.
Two real liquidity-boundary tests failed before the actual-receipt repair and pass afterward.

Ten existing math/AMM witness tests reproduced self-LP wash drain, JIT capture, cap exhaustion, dust/call-dependent
vesting and rounding/library-precondition examples. They demonstrate unresolved limits, not safety passes.
The historical100%-fee denominator report was not established as reachable through a valid record; no new bound
was introduced based solely on that claim.

No original E1/E2 raw datasets were available. No historical metrics, cross-chain prices, external addresses,
event eligibility or returns were independently reproduced. Pyth integration here uses MockPythUnique; real
signed-update fork and testnet evidence remains pending. Existing damaged indexer databases need an explicit
rebuild; ABI/state migration must not invent historical fee fields. Fee-on-transfer tokens remain unsupported.
