# Lesson 08: quote integrity (M7)

Current qualification, 6 November 2026: the statements below describe M7's intended guarantees and local
tests. Decision 0051 records the outstanding-cap valuation approximation, so same-state parity is not proven
for every cap-boundary state. `depositIfFlagged` uses the current notional and rate; changing the reference,
mode or notional can exceed it in a later block. The empirical next-block requirement remains an unrun E12
gate. See [current threat model](../threat-model.md) and [E12 draft](../../research/prereg/E12.md).

## 1. Concept

A deposit depends on block state: whether a swap is the block's first touch, how full the flow bucket is, where
the reference sits, and whether the market is closed. A router that quotes in one block and executes in the next
sees the difference as slippage, and counts a refundable deposit as a loss. Quote integrity gives routers three
things:
- **a view** that says exactly what the deposit will be if the swap executes in this block (`previewDeposit`);
- **an event** for every swap that posts one (`HookSwap`, URC-2);
- **a router that checks the real deposit inside the transaction** and reverts if the trader's limits are not met
  (`GuardedRouter`).

    depositNow = flaggedNow ? N * rate : 0           depositIfFlagged = N * rate
    rate = continuous: min(δ_max, max(δ, β·g+))      closed: δ_c

The guarantee is a code property, not a promise. The view and the swap call the same functions, so they cannot
disagree within a block, and a fuzz test proves it.

## 2. Design decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| The view re-runs the pure trigger functions on current state | A separate "estimate" formula | A second formula is a second place for bugs; E12 requires equality |
| Classification written out inline on the swap path | Calling `_classify` from both | About 150 gas on every swap at or above N0, enough to breach the 5% gas gate; the fuzz test keeps them equal |
| Cap's risky side priced at the pre-swap price in the view | Asking for the execution price as input | The spec's signature takes notional only; the gap matters only near a binding guarded-launch cap |
| Trader reported by `IMsgSender` from a transient slot | Trusting hookData alone | A trusted router names the trader even when hookData is empty or wrong |
| Unused native value refunded at the end of `swapGuarded` | Leaving dust in the router | A router that holds nothing between calls has nothing to steal |

## 3. Code walkthrough

- `previewDeposit`:
  1. builds a `SwapView` from the arguments, with direction giving `buysRisky`, and reads the pool's current sqrt
     price as the "pre-swap" price;
  2. `_classify` sets the mode and gap; `_rate` gives the rate; `depositIfFlagged` follows;
  3. `FlowBucketLib.update` (pure) gives the flow hit without writing it;
  4. `TriggerLib.firstTouch` (pure) gives first touch, using the transient same-transaction flag exactly as the
     swap does;
  5. `TriggerLib.triggers` gives the mask, then `_withinBudget` with the risky amount estimated at the pre-swap
     price.
- `_settlementTimes` mirrors `Settler._settleTime`: t + Δ, or `nextOpen` + openDelay through a `staticcall`.
- `GuardedRouter.swapGuarded`:
  1. checks the deadline;
  2. sets the transient caller;
  3. unlocks;
  4. clears the caller;
  5. refunds unused value.
- `unlockCallback`: only the PoolManager may call it. It swaps, reads `lastDeposit`, checks the guard, and settles
  each leg.
- `_check`:
  - for exact input, the output leg is the net received, and net + deposit is the gross;
  - for exact output, the input leg already includes the deposit.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| View and swap drift apart | Routers quote wrong deposits | `testFuzz_PreviewMatchesExecutionInTheSameBlock` (2,000 runs) |
| Another swap lands first in the block | `depositNow` stale; `depositIfFlagged` still bounds it | Documented in the interface NatSpec |
| Guard misread for exact output | Trader overpays | `test_Router_ExactOutputCapsTheInputDepositIncluded` |
| Router keeps native value | Funds stranded in the router | `test_Router_NativeInputRefundsUnusedValue` |
| Refund to the wrong address | Trader loses the refund | `test_Router_RefundNamesTheTraderWithoutHookData` |

## 5. Audit questions

1. *Can someone make the router pull tokens from another user?* No. `trader` is `msg.sender`, written into unlock
   data the router builds itself, and the PoolManager calls back only the contract that called `unlock`.
   Confident.
2. *Can `msgSender` be read by a third party to impersonate the trader?* It returns the trader only during the
   router's own lock and zero otherwise. A hook only believes it from routers on its immutable trusted list.
   Confident.
3. *Why is `exempt` always false?* The licence fast path is M9. Confident.
4. *Is the hook too big now?* 22,690 of 24,576 bytes. M9 needs the lens split first. Confident about the number,
   not about how much the split saves.
5. *Is the cap approximation exploitable?* It changes only the preview, never the swap, so a wrong preview can at
   most make a router's quote differ near a binding cap. Fairly confident.

## 6. Exercises

1. Run the fuzz test with `-vvv` on a seed where the prior swap fills the flow bucket, and trace why both preview
   and swap flag a sub-N0 swap.
2. For an exact-output buy of 10 risky tokens, compute `maxNetIn` by hand from the pool's quote and the 30 bp
   deposit, then check it against `test_Router_ExactOutputCapsTheInputDepositIncluded`.
3. Explain why `GuardedRouter` clears its transient caller before refunding native value, not after.
