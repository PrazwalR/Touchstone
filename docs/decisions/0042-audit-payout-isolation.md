# 0042 Settlement payout isolation

Date: 30 October 2026. Status: approved by the owner in chat on 30 October 2026 and implemented.
Approval applies to isolated ledger delivery of refunds and tips only.

## Evidence

The native refund in `TouchstoneHook._refund` calls `pushOut` inside the hook's PoolManager unlock.
A beneficiary can call `PoolManager.mint` and return normally. The self-call succeeds but the outer unlock
later reverts with `CurrencyNotSettled`, outside the catch. Existing `DosPoC.t.sol` has a selective
clawback-bypass case and an always-stalling case. Direct tip `take` also reverts settlement if token transfer fails.
Existing findings are in `docs/audits/ethskills-2026-10-28/findings-erc20-dos-assembly.md`.
PoC execution status will be recorded in the repair audit; source inspection alone is not a new EVM measurement.

## Approved implementation

Credit refunds and tips to the existing RebateLedger during settlement, using ERC-6909 claim transfers that
execute no beneficiary code. Preserve every amount, currency, beneficiary, tip recipient, and split formula.
After the hook's settlement unlock returns, attempt separate ledger pushes to deliver the underlying assets.
A failed push leaves the recipient's existing ledger entitlement intact and does not roll back settlement.
Keep record deletion, outstanding accounting and conservation checks in the original settlement transaction.
Keep the hook's reentrancy guard around finalize including delivery attempts. Validate hostile recipient,
paused-token, ledger solvency, successful push, failed push, and subsequent claim cases.

This changes delivery timing and the events/ledger entries emitted for payouts. It is not authorized merely by
calling it a security fix: section 0.11.3 says to ask when money flow changes.

## Alternatives

1. Proposed isolated ledger delivery, retaining best-effort underlying delivery.
2. Ledger credit only, with recipients submitting claims; simpler but changes normal withdrawal UX.
3. Preserve present delivery semantics and explicitly accept the demonstrated risks; not recommended for deployment.

## Independent work

Oracle malformed-response handling, backend recovery, invalid-data rejection and accurate documentation proceed
without changing payouts. Rebate eligibility, JIT allocation, cap behavior, ITM accounting and canonical pool
trust remain separate unresolved mechanism decisions; this proposal does not authorize them.

## Delivery semantics and residual risk

The existing `push` API withdraws the recipient's entire balance in that currency, including earlier credits.
A shared refund/tip recipient is pushed once. `TIP` is appended to the credit-kind enum, preserving existing
values; `DEFERRED_REFUND` also labels staging credits that are immediately delivered. `RefundDeferred` is
emitted only for a failed refund delivery attempt. The obsolete hook `pushOut` API is removed.

No new push gas limit was approved or introduced. A gas-burning recipient can still increase required
transaction gas; EIP-150 tail-gas effects remain a liveness/economic risk. Isolation addresses unsettled-delta
sabotage and failed transfers, not arbitrary gas consumption. No claim of unconditional non-reversion is made.
