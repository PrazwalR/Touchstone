# AI usage

Date: 30 October 2026. Status: local changes awaiting developer review; no commit, push or deployment performed.

Codex assisted with the M0-M5 source audit, exploit reproduction, targeted repairs, regression tests, CI checks,
and documentation. Parallel audit agents reviewed contract security, AMM/math, backend recovery and research.
The relevant user requests and approval scope are saved under `docs/ai/prompts/2026-10-30-repair.md`.

The owners explicitly approved isolated refund/tip delivery (0042) and effective executed-fee capture (0044).
The supplied spec's actual-receipt rule was implemented as conformance work (0045). Research changes are
unfrozen validation/model alignment (0046); original E1/E2 analysis hashes, preregistrations and results were
preserved. No historical experiment or testnet/mainnet deployment was run by this repair workflow.

Tests and local measurements are listed in `docs/audits/m0-m5-repair-2026-10-30/validation.md`. Mock/local
measurements do not establish returns or production security. GitHub workflow execution, original dataset
replication, real deployed-Pyth fork integration and feature completion remain pending.

A human developer still needs to review and explain each source change, review the proposed diff with the
other developer, and own the remaining design decisions before merging. AI-produced audit notes and passing
tests are not substitutes for that review or the specification's external audit before mainnet use.

## 1 November 2026 — D2 track

AI implemented read-only indexed history, closure-header lag evidence, the frontend history boundary, seeded testnet demonstration tooling, and guarded E5/E6 preparation. The owner chose unchanged formulas, E9 skipped, and a signer-machine handoff. E3/E4 were renewed in a separate local preregistration commit after their analysis code, preserving prior disclosures and thresholds. No raw historical data, live signing or new economic verdict was available. See `docs/ai/prompts/2026-11-01-d2-track.md`, `docs/d2-track-status.md`, and `docs/lessons/09-d2-evidence-and-operations.md`. Human review remains outstanding.
