# Static analysis triage, M10, 3 November 2026

Scope: first-party `contracts/src` after M10 (TouchstoneLens, StaticQuoteLib, the hook's URC-4 fallback).
Tool: Slither 0.11.6, same configuration as the 30 October triage. The run completed with 132 findings,
54 of them with fingerprints not yet in `slither-reviewed.json`. No High-impact detector fired.

Two causes account for all 54:

1. **Moved code in the hook (30 fingerprints).** M10 removed `previewDeposit`'s body, `_classify` and
   `_settlementTimes` from `TouchstoneHook` and replaced `_calendarNextOpen` with `_calendarAnswersNextOpen`.
   Every function below them shifted lines, and Slither's fingerprint includes the line range. The findings
   are the same detector on the same function as already reviewed: `timestamp`, `unused-return`,
   `reentrancy-events`, `incorrect-equality`, `low-level-calls`.
2. **The lens repeats the hook's classification (24 fingerprints).** `TouchstoneLens` is a view port of the
   hook's trigger and deposit evaluation, so it inherits the same detector classes.

| Detector | New | Disposition |
| --- | ---: | --- |
| timestamp | 14 | Calendar, settlement-time and flow-bucket comparisons, intentional as in the hook. No randomness |
| unused-return | 12 | Hook: as reviewed on 30 October. Lens: `getSlot0` partial reads; `TriggerLib.firstTouch`'s second value (whether to store the block, irrelevant to a view); `FlowBucketLib.update`'s new buckets (a quote writes nothing); `getTickLiquidity`'s gross liquidity, which `Pool.swap` also ignores |
| naming-convention | 9 | SCREAMING_SNAKE_CASE immutables and their interface getters, required by CLAUDE.md |
| incorrect-equality | 6 | Zero checks on computed deposits and notionals, not on attacker-controlled balances |
| low-level-calls | 6 | Calendar and auction staticcalls that check success and returndata length and never revert the quote, as in the hook |
| reentrancy-events | 5 | Hook functions as reviewed on 30 October and 2 November; line shift only |
| uninitialized-local | 2 | `View memory v` in the lens, a zero-initialised memory struct whose fields are assigned before use; the zero `mode` and `gapBps` are the open-market defaults, as in the hook's `SwapView` |

The lens is view-only: it holds no funds, has no state, and every external call it makes is a staticcall or a
view. Its trust in the in-transaction flag is limited to calls from the hook (`_touched`), covered by
`test_LensIgnoresTheFlagFromOtherCallers`.

No detector was suppressed and no severity lowered. The 54 fingerprints are appended to
`../m0-m5-repair-2026-10-30/slither-reviewed.json` with this file as their triage. Two later edits in M10 (the
`KEY_END` constant in the hook, the removed `Quote.sqrtPriceAfterX96` field) shifted lines again; the 25
fingerprints that moved were each matched to an already-reviewed finding with the same detector and the same
description apart from line numbers, and appended. Final run: 132 findings, 0 unreviewed.

**Licence operations follow-up, 3 November 2026.** Removing an unused import from the hook and adding
`LicenceAuction.terms`, a view of the registered lease terms for the bots and the dashboard, shifted lines in both
contracts. The 33 fingerprints that moved were each matched to an already-reviewed finding with the same detector
and description apart from line numbers, and appended. `terms` itself raised no finding. Run: 132 findings, 0
unreviewed.
