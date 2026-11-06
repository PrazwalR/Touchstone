# Lesson 02: the hook's swap path, the factory and records (M2)

## 1. Concept

v4 lets a hook return a delta from `afterSwap` on the swap's **unspecified** currency (the output of an
exact-input swap, the input of an exact-output swap). The PoolManager charges the swapper swapDelta - hookDelta.
Returning +D therefore takes D from the swapper and credits the hook. The hook settles that credit in the same
callback by minting itself D of ERC-6909 claims. Nothing leaves the PoolManager: the deposit is a claim, held
until settlement.

Deposit size: D = N * min(delta_max, max(delta, beta * g+)). Scaling with the pre-swap gap g keeps the cap from
binding on large dislocations, where most toxic markout sits.

## 2. Design decisions

- Records are committed by hash (D-7): one storage slot per open record; the full record travels in
  `DepositTaken` and comes back as calldata.
- Only the factory can initialize a pool (`_beforeInitialize`), so every pool has a validated config.
- The hook compiles under its own profile to stay under EIP-170 (decision 0028), and the factory holds the
  canonical config (decision 0027).
- The guarded-launch cap is valued in quote at the swap's own price and written so it cannot overflow
  (decisions 0025, 0031).
- hookData that names the hook itself is ignored, so a refund can never be stranded in the hook.

## 3. Code walkthrough (src/TouchstoneHook.sol)

- `_beforeSwap` (line 225): validates the hookData length (0, 32 or 64), snapshots the price and liquidity into
  transient slots, and clears the last-deposit slots.
- `_afterSwap` (244) calls `_view` (259), which works out the receipts by token role, notional, direction and
  which currency is unspecified, then `_evaluate` (277): flow bucket first, then the retail early return, then
  drift and first touch, then the deposit and the cap.
- `_depositFor` (297): the rate from `DepositLib`, converted to risky at the execution price when the unspecified
  currency is risky. No oracle is read.
- `_takeDeposit` (378): builds the record, writes its hash, updates outstanding, writes the transient slots,
  emits `DepositTaken` and URC-2 `HookSwap` with -D on the unspecified side, and mints the claims last.
- `_resolve` (435): a trusted router's `msgSender()`, else the hookData beneficiary, else tx.origin.
- `TouchstoneFactory._validate` (src/TouchstoneFactory.sol:142): every bound in §14 with a field code.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Wrong delta sign | Traders paid instead of charged | `test_Deposit_SignChargesSwapper` |
| Wrong unspecified currency | Deposit in the wrong token | `test_Deposit_UnspecifiedCurrency_AllFourCases` |
| Unflagged swap differs from a plain pool | Retail pays for Touchstone | `test_Retail_MatchesHooklessTwin` (I8) |
| A pool with an unvalidated config | Any parameter can be abused | `test_Initialize_RevertsOutsideFactory`, `test_Bounds_EachField` |
| Hook too large to deploy | No deployment | `forge build --sizes`, 20,257 bytes |

## 5. Audit questions

1. *Can a swapper avoid the deposit by switching to exact output?* No. Triggers depend on notional, not swap
   type, and the deposit moves to the input side (T5).
2. *Can hookData redirect someone else's refund?* Only for swaps the trader signs, and a trusted router's
   `msgSender()` overrides it.
3. *What happens at maxOutstanding?* Swaps post no deposit; nothing reverts.
4. *Can afterSwap revert on a dependency?* No path through the reference or the cap can; I10 runs 2M calls.
   The one known revert, malformed hookData, is the caller's own input.
5. *Why is `lastDeposit` zero in tests?* Transient storage clears per transaction (decision 0030).

## 6. Exercises

1. For an exact-input sell of risky with quote as currency0, which currency is unspecified? Check with
   `test_Deposit_SignChargesSwapper`.
2. Recompute the deposit of `test_FirstTouch_FlagsAndTakesDepositFromSwapper` from its record.
3. Explain why the hook still works if the Chainlink feed is set to revert halfway through a block.
