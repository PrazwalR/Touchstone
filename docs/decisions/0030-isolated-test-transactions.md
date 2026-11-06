# 0030 Tests run each call as its own transaction

Status: decided.

Without isolation, every call in a Foundry test shares one transaction, so transient storage persists across
swaps and the first-touch rule (persistent block number plus transient per-transaction flag) cannot be tested
as it behaves on chain. `isolate = true` makes every top-level call its own transaction. It also makes gas
measurements include intrinsic and cold-access costs as a chain would.

Consequence: transient values written in one call are gone in the next, so `lastDeposit` can only be observed
inside the transaction that swapped; `GuardedRouter` (M7) is the test for it.
