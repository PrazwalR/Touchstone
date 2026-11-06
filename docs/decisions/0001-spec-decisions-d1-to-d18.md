# 0001 Spec decisions D-1 to D-18

Status: carried over. These decisions are made in docs/SPEC.md §21 and are not repeated here. This file records
how each is reflected in the code at the end of M3.

| Spec | Where |
| --- | --- |
| D-1 price scale 1e36 | `PriceLib.PRICE_SCALE`, `SettlementMath.PRICE_SCALE`, `ReferenceLib` |
| D-2 shared bucket timestamp | `FlowBucketLib.update`, `PoolState.flowTime` |
| D-3 swap-time oracle | 0003 |
| D-4 OpenZeppelin pin | `contracts/lib/PINS.md` |
| D-5 static fee only | `TouchstoneFactory.createPool` reverts with `Touchstone__DynamicFeeNotSupported` |
| D-6 default to refund | `Settler.expire`; tested by `test_Expire_RefundsInFull` |
| D-7 records by hash | `TouchstoneHook._recordHash`; T11 by `test_Settle_OnceAndForgedRecordsRejected` |
| D-8 licence timing | factory rejects the `LICENCE` flag; record fields always false |
| D-9 closed-market scope | 0029 |
| D-10 no AGPL code | nothing from BidDog is in the tree |
| D-16 library errors | `ITouchstoneErrors`, extended by 0021 |
| D-18 Settler emits Settled | 0018 |

D-11 to D-15 and D-17 are open and owned by later milestones (M4, M8, M10).
