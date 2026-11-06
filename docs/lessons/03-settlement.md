# Lesson 03: settlement, finalize, vesting and the ledger (M3)

## 1. Concept

Settlement asks Pyth for the **first** signed price at or after t0 = swap time + delta.
`parsePriceFeedUpdatesUnique` accepts an update only if its publish time is at or after t0 and the previous
publish time is before t0, so the price is canonical and no keeper can pick a better one (T1).

Then R = min(D, alpha * max(0, m+ - eps_eff * N+)), where eps_eff = eps + Pyth's confidence. LPs keep R, the
trader gets D - R back. The margin eps equal to the arbitrageur's cost is what keeps the pool fresh (§4.5).
m+ and N+ count only the part of the swap executed before the pool price crossed P*, so padding past the fair
price cannot dilute the markout.

R is split as: a capped tip to whoever settled; the protocol share; rho of the rest to the rebate pool; the
remainder to LPs, vested over vestPeriod and donated to in-range LPs. A benign record (R = 0 and m <= 0) instead
gets a rebate of min(kappa * f * N, rebate pool), paid through the ledger.

## 2. Design decisions

- The Settler is stateless and holds no funds; the hook re-checks conservation in `finalize` (§18.3).
- Refunds are pushed. A failed push is credited in the ledger in the beneficiary's name (T9). The push runs
  through a self-call (`pushOut`) so its failure can be caught without reverting the settlement.
- All state is written before any external call (decision 0032). The refund, the only push to an address the
  trader chose, goes last.
- Drip restarts its clock when it cannot donate (decision 0026).

## 3. Code walkthrough

- `Settler.settle` (src/Settler.sol:63): authenticates the record, computes t0, has Pyth parse the update,
  `_payout` (128), `finalize`, then `Settled` and the excess-fee refund.
- `_payout`: fair price, confidence guard, regime alpha, `_inTheMoney` (184), the clawback in quote, then either
  `_benign` (224) or `splitRetained` in the deposit currency.
- `TouchstoneHook.finalize` (src/TouchstoneHook.sol:131): authenticates, checks `conserves`, deletes the hash,
  reduces outstanding, unlocks.
- `unlockCallback` (160): `_dripEffects`, `_account`, `_donate`, `_payOut` (463), in that order.
- `RebateLedger.credit` (src/RebateLedger.sol:31): adds to owed and checks claims >= total owed (I2) every time.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Payout that does not conserve | Funds created or lost | `test_Finalize_RejectsPayoutThatDoesNotConserve`, I1, I3 |
| Keeper chooses the price | LPs or traders robbed | `test_Settle_RejectsNonFirstUpdate` |
| Record settled twice or forged | Double payout | `test_Settle_OnceAndForgedRecordsRejected`, I5 |
| Refund recipient reverts | Settlement blocked | `test_Refund_RejectedIsDeferredToLedger` |
| Reentrancy from a refund recipient | Corrupted accounting | `test_Reentrancy_DuringFinalizeIsBlocked`, I16 |
| Nobody settles | LPs lose the clawback; traders lose nothing | `test_Expire_RefundsInFull`, I6 |

## 5. Audit questions

1. *Can R exceed D?* No. `clawback` caps at the deposit's quote value, and converting back rounds down.
2. *Can the rebate pool be overdrawn?* No. `conserves` checks tip + rebate <= pool before paying, and I7 tracks
   totals over 2M calls.
3. *What if Pyth's confidence is wide?* Above maxConfBps the record refunds in full.
4. *Can the ledger become insolvent?* Every credit checks the claim balance against the total owed (I2).
5. *Is the in-the-money leg exact across initialized ticks?* No. It assumes constant liquidity; the exact
   tick-by-tick differential test is still owed (Appendix A known gap). Not confident beyond single-range pools.

## 6. Exercises

1. In `test_Settle_ArbitrageRetainsAndConserves`, recompute I4's bound from the record by hand.
2. Show from `SettlementMath.splitRetained` that tip + toProtocol + toRebatePool + toLPs = R exactly.
3. Explain why a benign trade's tip comes out of its rebate rather than out of the deposit.
