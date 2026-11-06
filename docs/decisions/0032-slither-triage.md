# 0032 Slither triage at the end of M3

Status: triaged. `slither . --config-file slither.config.json` (dependencies and tests excluded).

Fixed during M3: `reentrancy-no-eth` in `TouchstoneHook._payOut` and `unlockCallback` (state is now written
before any external call: `_dripEffects`, `_account`, then `_donate` and the transfers, refund last);
`reentrancy-benign` in `_takeDeposit` (the claim mint moved after the record writes); `unused-state F_N_MIN`.

Accepted:
- `timestamp`: settlement times, expiry, staleness and vesting are defined in seconds by the mechanism.
- `incorrect-equality`: comparisons with zero on amounts the hook computed itself.
- `assembly`: only `TransientLib`, as §0.4 allows.
- `low-level-calls`: `Settler.settle` returns excess msg.value; failure reverts with `Touchstone__FeeRefundFailed`.
- `reentrancy-events`: `Settled` and `Expired` are emitted after `finalize` by design (0018); `finalize` holds the
  hook's transient lock.
- `unused-return`: `unlock` results the callers do not need; ERC-6909 `transfer` reverts rather than returning
  false; `getSlot0` fields beyond the price; `ItmLib.leg`'s overshoot flag.
- `divide-before-multiply` in `CalendarMath`: era and day arithmetic, integer division intended, fuzzed round trip.
- `missing-zero-check` on `RebateLedger` constructor: addresses are set by the deploy script and checked against
  the prediction in `DeployCore` (M8).
- `naming-convention` on immutables: §0.4 requires SCREAMING_SNAKE_CASE for immutables.

Re-run 28 October 2026 after the ethskills audit fixes (decisions 0042 to 0044). No new detector categories. New
instances, all intended:

- `low-level-calls`: `ReferenceLib` reads feeds with `staticcall` and checks the returndata length, because a
  high-level call decodes in the caller and a codeless or short-return feed would revert the swap (audit GEN-3).
- `unused-return`: the hook constructor calls `BlockLib.number(SOURCE_ARBSYS)` only to fail a wrong-chain
  deployment (audit ORC-2); `_push` ignores the pushed amount, which the ledger emits.
- `uninitialized-local` on `readX36` is gone with the `try` it described.

Re-run 31 October 2026 after M6 and M7 (decisions 0048, 0051):

- `arbitrary-send-erc20` (High) in `GuardedRouter._resolve`. False positive. `trader` comes from unlock data that
  only `swapGuarded` builds, from `msg.sender`. The PoolManager calls back only the contract that called `unlock`,
  and a nested `unlock` reverts, so the router can only ever pull from the caller of the current swap.
- `arbitrary-send-eth` (High) in `GuardedRouter.swapGuarded`. False positive. It is the refund of unused native
  value to `msg.sender`.
- `unused-return`. Intentional:
  - `previewDeposit` uses only the hit flag of `FlowBucketLib.update` and only `isFirst` of
    `TriggerLib.firstTouch`; it is a view and writes nothing.
  - `GuardedRouter` ignores the record id from `lastDeposit` and the settled amounts from `settle`.
- `uninitialized-local` on `previewDeposit.v` and `NyseCalendar._contains.lo`. Zero is the intended starting value.
- `low-level-calls`. Calendar reads use `staticcall` for the same reason as the feeds; the router refunds native
  value with `call`.

Re-run 2 November 2026 (after the D2 merge): 89 findings, none in a new category. The fingerprints of 49
findings changed with code movement and were reviewed individually; see decision 0055.
