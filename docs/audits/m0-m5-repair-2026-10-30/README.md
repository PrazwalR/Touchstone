# Touchstone M0-M5 repair audit

Date: 30 October 2026. Starting revision: 07f4bbe. Changes are local and uncommitted.
Scope: first-party contracts, keeper, indexer, research, tests, documentation and CI. Dependency source was
inspected where its execution semantics matter; this is not an exhaustive audit of vendored upstream projects.

The design specification is `docs/developer-spec-2026-10-25.md`, indexed from `docs/SPEC.md`. Read it with the
existing decisions and the explicit owner approvals below. The source export is historical; external claims/addresses/event rules were not
independently verified. No deployment, commit, push, submission or public issue publication was performed.

## Fixed

| Area | Root cause / resulting behavior | Evidence |
| --- | --- | --- |
| Oracle fallback | Typed-call return decoding could revert outside catch; failed, short and malformed responses now follow existing absent/down behavior | Libraries.t.sol eight red-before/green-after regressions |
| Refund/tip settlement | Recipient execution inside settlement unlock could poison PoolManager deltas; direct token tips could revert settlement. Credits now precede independent delivery attempts | Approved 0042; PayoutIsolation.t.sol malicious beneficiary/tip/paused-token/shared-recipient cases |
| Executed fee | ITM reconstruction used LP fee while execution also charged protocol fee. Effective directional fee is captured and authenticated with Record | Approved 0044; ProtocolFeeSettlement.t.sol five safety regressions |
| Non-overshooting ITM | Constant-liquidity reconstruction was used where spec requires actual receipts | 0045; ItmActualReceipts.t.sol both directions cross initialized liquidity boundaries |
| Keeper | Publish-time bound treated as submission deadline; oracle fee omitted; reads aborted unrelated work; restart/reorg anchors and idle pool registry missing | keeper.test.ts, schedule/state/Hermes tests and actual Anvil E2E |
| Indexer | Grouped unordered writes and cursor advance were not atomic; rollback retained orphaned deferred flags; bounded rewind could miss old fork history | store/indexer regressions, including reorg between ranges and during first-range fetch |
| Research | Invalid/NaN samples could yield a verdict; cached values bypassed validation; cache identity was incomplete; unfrozen replay used unimplemented clamps/rounding | 0046; invalid-data, cache, arithmetic and draft-entrypoint regressions |
| Reproducibility | Clean-checkout E2E accessed artifacts before execution; requirements export omitted numpy; release gates were not wired to actual named gas snapshots | Deferred E2E initialization, corrected export, CI and tested release gate script |

Numbers in regression examples are measured local EVM values, not historical results or production returns.
The protocol-fee witness originally lost 2.621274 USDC but retained 1.754427; its corrected regression retains 0.
Two non-overshooting examples previously retained 560.380461/1418.096887 USDC instead of 484.263090/736.171448.
The fixes preserve the original retention/split formulas and the supplied spec's no-overshoot rule.

## Decisions and compatibility

- 0042: owner approved isolated ledger delivery for refunds and tips. Pushing can flush earlier ledger credits;
 a successful settlement can leave funds claimable. Unbounded gas-consuming recipients remain a risk.
- 0044: owner approved the appended swapFeePips field. Record/event ABI, hash, backend decoding and persisted
 state must match. No historical fee fallback is invented; old deployment/client pairs need explicit migration.
- 0045/0046: conformance with supplied specification, not new payout policies or experimental thresholds.
- 0043: remaining mechanism decisions and validation limits. Recording an issue does not accept its risk.

## Still pending for the hackathon

The M0-M5 repairs do not implement M6 calendar/closure support, M7 previewDeposit/GuardedRouter, M8 real testnet
scripts/verification/bots, the dashboard, or the date-gated licence.
G1's saved pass is historical and limited to one v3 pool/window; G2/E3/E4 remain draft and unrun. Original E1/E2
code/preregistration hashes and results are preserved. Raw inputs are absent, and corrected oracle ordering
requires separately versioned research. E3 still has stateful/currency/execution-type limitations.

Self-LP rebate drain is explicitly recognized in the supplied spec, which requires E11 to kill rebates on a
pool with profitable wash at its chosen kappa. No silent rebate removal or parameter retuning was done.
JIT donation capture, genuinely overshooting tick approximation, cap exhaustion and canonical pool trust
remain open. The spec's claim that vesting enforces a JIT holding period is not supported by the implementation.
No owner, pause, upgrade path, gate relaxation or rewritten historical result was introduced.

## Validation and audit trail

[validation.md](validation.md) records final commands, counts, measured costs and failed gates. The twelve
numbered files record baseline findings and post-repair dispositions; [slither-triage.md](slither-triage.md)
and slither-reviewed.json record exact static-analysis findings. Fingerprint review is not a zero-finding run.

The CI workflow is prepared but has not been executed on GitHub. It keeps size, coverage and pre-repair gas
thresholds, validates ABI drift and runs unit/invariant/Anvil tests, static review and dependency audits.
Mainnet use remains gated by the specification's external audit requirement.

## Code map

- TouchstoneHook.finalize / _deliver: settlement accounting and isolated delivery.
- Hook.beforeSwap / Record.swapFeePips / Settler._inTheMoney: authenticated historical fee and actual-receipt branch.
- ReferenceLib._roundData: malformed response fallback with no new gas limit or inline assembly.
- Keeper.tick / #process: canonical cursor, independent processing, persisted pool discovery.
- Indexer.tick / Store.transaction / rewind: ordered, atomic writes and evidence-based derived recovery.
- E4.summarize / write_e34 / require_frozen: invalid-data rejection and draft-run prevention.

Review method: ETHSkills EVM audit guidance and its pinned general, oracle, token, DoS, AMM and precision-math
checklists; pinned Uniswap dependency source and the official v4 overview. A human source review and the
lesson walkthrough remain required before merge. See `../../lessons/06-audit-repair.md`.
