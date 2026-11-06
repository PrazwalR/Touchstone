# 0051 Quote integrity, first part (M7)

Status: implemented 31 October 2026 as milestone M7 (developer spec §12, §20.5). The URC-4 lens is M10.

## previewDeposit

`TouchstoneHook.previewDeposit(key, zeroForOne, notionalQuote, swapper)` returns a `DepositQuote`.

**Shared with the swap path:**
- `_closedNow` and `_gap`, for mode and drift (`_classify` in the view; written out on the swap path, where it
  saves a call, docs/gas.md);
- `_rate`, for the deposit rate;
- `_withinBudget`, for the outstanding cap;
- `FlowBucketLib.update` and `TriggerLib.firstTouch`, for flow and first touch.

The view applies the trigger functions to the state the next swap would see, and writes nothing.

**Exact within a block.** `testFuzz_PreviewMatchesExecutionInTheSameBlock` (2,000 runs) is E12's first check. It
covers prior same-block swaps that fill the flow bucket or use up first touch, both directions, and exact input
and output. In every run the preview's `depositNow` equals the executed deposit, after the same conversion at the
execution price for a deposit taken in the risky token.

**One stated approximation.** The cap's risky side converts at the swap's execution price, which only the swap
knows; the preview uses the pre-swap pool price. The two can disagree only when risky-currency deposits are
outstanding and the remaining budget is within the swap's price impact of binding. That is a corner of the
guarded-launch cap, not of the mechanism.

`exempt` is always false until the licence (M9).

## GuardedRouter

`src/periphery/GuardedRouter.sol`:
1. swaps with `hookData = abi.encode(trader, rebateTo)`;
2. reads `lastDeposit` for exactly this swap's deposit;
3. reverts with `Touchstone__GuardFailed(which)` on any limit:

| `which` | Limit |
| --- | --- |
| 0 | deadline |
| 1 | `maxDeposit` |
| 2 | `minNetOut` (exact input) |
| 3 | `minGrossOut` (exact input) |
| 4 | `maxNetIn` (exact output) |

Then it settles. Unused native value is returned before the call ends, so the router holds nothing between calls.

**Refund naming.** It implements `IMsgSender` through a transient slot that is set only for the length of its
lock. `CoreDeployer` deploys it with the support contracts and puts it in the hook's first trusted-router slot, so
refunds name the trader even without hookData.

## HookSwap

URC-2's rule (exactly one `HookSwap` per swap that posts a deposit, none otherwise) was already implemented. It
is now tested: `test_HookSwapExactlyOncePerDepositAndNeverOtherwise`.

## Size

The hook is 22,690 bytes of runtime code, leaving 1,886 under EIP-170. The licence fast path (M9) will not fit
without moving code out, as the spec plans with `TouchstoneLens` (M10). M9 should start by moving the view-only
paths, `previewDeposit` and its helpers, into the lens.
