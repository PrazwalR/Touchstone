# Static analysis triage, 30 October 2026

Scope: first-party `contracts/src`, dependencies/tests filtered by existing config. Tool: Slither 0.11.6.
The final post-fee-repair run completed with 62 findings and no High-class detector results. A nonzero raw
detector exit is not an execution crash or a clean security verdict. The economic defects in decision 0043
are not dismissed by this triage. The 62 exact finding fingerprints are recorded in slither-reviewed.json;
CI rejects any unreviewed or changed fingerprint and any analyzer execution failure.

| Detector | Count | Disposition |
| --- | ---: | --- |
| divide-before-multiply | 7 | CalendarMath era/day decomposition intentionally uses integer quotient/remainder; existing round-trip fuzz tests cover supported dates |
| incorrect-equality | 3 | Zero checks on internal masks and computed buffer/donation amounts, not equality on attacker-controlled balances |
| unused-return | 10 | Unlock/donate/initialize return values not needed; PoolManager claim transfer reverts on failure. Overshooting ITM reconstruction remains approximate; recording fee and using actual receipts when not overshot does not prove exact tick reconstruction |
| missing-zero-check | 1 | RebateLedger immutable deployment address assumption, previously triaged in 0032; deploy identity verification remains required |
| reentrancy-events | 10 | State accounting precedes external interactions; hook lock remains held through isolated delivery. Ledger debits before unlock; failed delivery rolls back ledger state. Event ordering is observable and not an unconditional reentrancy-safety proof |
| timestamp | 7 | Settlement, expiry, freshness and vesting intentionally use timestamps. No source of randomness |
| assembly | 4 | Existing transient TLOAD/TSTORE helpers; no new assembly introduced |
| low-level-calls | 3 | Settler fee refund remains checked; oracle staticcalls now validate success, length and canonical narrow fields. Unbounded returndata/gas remains a residual risk |
| naming-convention | 17 | SCREAMING_SNAKE_CASE immutables required by the specification's style rules (§0.4) |

No blanket detector suppression or severity lowering was added. CI verifies the exact reviewed fingerprints
after checking analyzer success; changed/new findings require review. This is not a zero-finding run.
