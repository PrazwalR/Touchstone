# Lesson 06: repairing M0-M5 without changing unapproved economics

## 1. Concept

PoolManager flash accounting requires every currency delta to be settled before its unlock ends. A successful
native token callback does not prove that condition: a recipient can create an additional PoolManager debt
and return normally. The enclosing unlock rejects that debt after the hook's own try/catch has completed.

The repair separates entitlement from delivery. Settlement first gives the ledger ERC-6909 claims and credits
the recipient. Delivery runs through a later, independent ledger unlock. A failed delivery rolls back that
attempt and leaves the entitlement intact. Conservation still requires refund plus retained splits to equal
the original deposit; a benign rebate and its tip spend only the rebate pool.

Executed fees are historical data, too. For pinned v4 the effective fee is
`protocolFee + lpFee - floor(protocolFee * lpFee / 1_000_000)`. Reconstructing a swap later with the LP fee alone
can manufacture positive markout for a trader who actually lost money. Capture the directional effective fee
before execution, authenticate it with the record, and use that fee at settlement.

## 2. Design decisions

Decision 0042, approved in chat, uses the existing ledger rather than giving recipient callbacks control of the
settlement unlock. A shared tip/refund recipient is pushed once. Successful pushes can withdraw earlier ledger
credits in that currency. A separate gas budget was not approved, so gas-burning callback grief remains open.

Decision 0044, separately approved, appends swapFeePips to Record rather than reading a mutable current fee at
settlement. This changes the ABI and hash; inventing a default for older records would misstate execution.
The full original specification is absent. Other mechanism changes are not implied by these approvals.

Indexer recovery uses complete configured-history replay after a detected reorg instead of guessing a common
ancestor from one saved hash. It is simpler and safer, but can cost substantial RPC time. Raw events, derived
rows and cursor advance share one database transaction. Keeper persists its anchor and known pool IDs so an
otherwise idle restart can still discover housekeeping work.

## 3. Code walkthrough

- TouchstoneHook.finalize: authenticates the record and conservation, closes accounting, finishes settlement
  unlock, then attempts delivery while its own guard remains held.
- TouchstoneHook._payOut/_deliver: credit tips/refunds, then isolate each recipient's execution from settlement.
- ReferenceLib._roundData: validates successful low-level responses, lengths and narrow ABI words before decoding.
- Hook.beforeSwap and Settler._inTheMoney: snapshot and consume swapFeePips; the record hash prevents substitution.
- Keeper.tick and #process: validate canonical cursor, ingest, handle each record independently, then housekeeping.
- Indexer.tick/Store.transaction/rewind: anchor both range boundaries, commit atomically, restore derived evidence.
- E4.summarize and write_e34: reject invalid statistics and non-standard NaN JSON before producing a verdict.

Current line references are recorded in the audit README; validation.md records actual command outcomes.

## 4. Failure modes

| Failure | Impact | Regression |
| --- | --- | --- |
| Beneficiary or keeper leaves PoolManager debt | Settlement blocked | PayoutIsolation.t.sol stalling-recipient tests |
| Token transfer paused | Tip/refund transfer fails | test_PausedTokenDefersTipAndRefundWithoutBlockingSettlement |
| Protocol fee differs from LP fee | Excess clawback | ProtocolFeeSettlement.t.sol losing-trader test |
| Protocol fee changes after execution | Historical record repriced | ProtocolFeeSettlement.t.sol added/removed-fee tests |
| Oracle ABI malformed | Eligible swaps revert | Libraries.t.sol malformed/codeless regressions |
| Reorg between indexing ranges | Stale history hidden by new cursor | indexer.test.ts boundary/reorg cases |
| Empty or NaN research sample | Invalid pass verdict | test_research_validation.py |

## 5. Audit questions

1. Does a successful settlement promise immediate underlying payment? No. Delivery is best effort; entitlement
   may remain in the ledger, including when transaction gas estimation favors a cheaper deferred path.
2. Can arbitrary recipient gas consumption still be expensive? Yes. No push gas budget was introduced.
3. Is ITM reconstruction now exact across ticks? No. Fee capture is repaired; constant-liquidity approximation
   remains an independent issue requiring a design decision.
4. Do preserved E1/E2 hashes establish economic validity? No. They establish artifact consistency, not data-access
   chronology, corrected oracle ordering, realized economics, or replication without raw inputs.
5. Is passing the test suite enough to ship? No. Coverage/gas gates, live oracle integration, the missing spec,
   and unresolved economic findings remain visible blockers.

## 6. Exercises

1. Trace a failed native ledger push and verify that the hook record is closed while ledger claims still cover owed.
2. For lpFee 500 and protocolFee 1000, compute the effective 1500-pip fee and explain why changing the fee afterward
   cannot change an authenticated record. Try forging swapFeePips and inspect the rejection regression.
3. Simulate a reorg after the first indexed range and verify that the next range cannot conceal the old fork by
   advancing the cursor. Then check the preserved pre-repair gas baseline rather than resetting it.
