# Lesson 01: the libraries and the trigger rules (M0, M1)

## 1. Concept

A pool loses money to a trade when, a few seconds later, the outside price shows the trader bought cheap or sold
dear. That loss is the **markout**, m = x_r * P* + x_q: what the trader received in risky (x_r) valued at the fair
price P*, plus what it received in quote (x_q, negative when it paid). Positive m means LPs lost exactly m.

Touchstone does not try to predict m. It uses cheap, fixed rules to decide which swaps post a refundable deposit,
and settles the deposit later against P*. The rules (spec §7.5):

- **First touch**: the first swap of at least N0 in a block. Arbitrage after an outside move races to be first.
- **Flow**: a leaky bucket per direction. It fills with every swap's notional and drains at N_min / h per second,
  so splitting a $100k trade into 25 pieces still fills it.
- **Drift**: the swap trades toward a Chainlink reference by at least tau bps.
- **Closed market**: comes with M6.

Why fixed rules and not a model: two pre-registered prediction attempts failed (spec §3.1). A rule's false
positives are refunded, so a rule can lean toward recall.

## 2. Design decisions

- Prices are quote base units per risky base unit times 1e36, not 1e18 (D-1). At 1e18 a $0.0001 18-decimal token
  against USDC keeps two significant digits.
- Both buckets share one timestamp and drain together (D-2). The alternative, one timestamp per bucket, needs a
  second write per swap.
- The reference read never reverts (decision 0003). A swap must never fail because an oracle did.
- First touch is a persistent block number plus a transient per-transaction flag. Transient storage alone resets
  every transaction and cannot see block boundaries.

## 3. Code walkthrough

- `PriceLib.fairPriceX36` (src/libraries/PriceLib.sol): one exponent k = e_base - e_quote + dec_quote -
  dec_risky + 36 folds Pyth's exponents and both tokens' decimals into one power of ten. Rejects |k| > 76.
- `PriceLib.signedGapBps`: (ref - pool) * 1e4 / ref, signed toward the reference. Saturates at 2^127 bps since
  decision 0031.
- `FlowBucketLib.update`: drains both levels by nMin * dt / h, adds to one, clamps at 2^104 - 2, stores plus one.
- `ReferenceLib.readX36` (src/libraries/ReferenceLib.sol:25): try/catch around `latestRoundData` and `decimals`,
  four rejection rules, then the same power-of-ten conversion as Pyth's.
- `TriggerLib.firstTouch`: a three-row table. Already first in this transaction: true, nothing to record. Last
  touch in an earlier block: true, record now. Otherwise: false.
- `TransientLib`: `keccak256(label, poolId)` slots, so two pools in one unlock never collide.
- `CalendarMath`: Hinnant's civil-date algorithms and the 2007 US daylight-saving rule, for M6.

## 4. Failure modes

| Failure | Blast radius | Test |
| --- | --- | --- |
| Wrong decimals or exponent in a conversion | Every markout mis-scaled | `test_FairPrice_PythonVectors`, `test_Reference_ConvertsToX36` |
| Bucket never drains | Every swap flagged | `test_Flow_DrainsOverHorizon` |
| Reference revert propagates | Swaps blocked | `test_Reference_StaleOrRevertingNeverReverts`, I10 |
| Gap overflow at extreme prices | Swaps in one direction blocked | `ExtremePriceReplayTest`, decision 0031 |

## 5. Audit questions

1. *Can a stale Chainlink answer cause a deposit?* It can only fail to cause one: stale means ok = false, which
   means g = 0 and no drift trigger.
2. *Is the bucket's plus-one encoding safe at the clamp?* Levels clamp at 2^104 - 2, so plus one fits in 104 bits.
3. *Does first touch work on Arbitrum?* Only if the deploy script sets `BLOCK_SOURCE` to ArbSys; `block.number`
   there is the parent chain's. Confident, but the deploy check is M8's.
4. *What does the reference assume about the quote token?* That it tracks the feed's denomination (decision 0022).
5. *Is the transient flag cleared between transactions?* By the EVM, yes; tested with isolation on (decision 0030).

## 6. Exercises

1. With N_min = $100,000 and h = 12 s, how many $4,000 swaps in one second fill the bucket? Check against
   `test_Flow_SplitBelowN0FillsBucket`.
2. Compute `fairPriceX36(300000000000, -8, 100000000, -8, 18, 6)` by hand and compare with the first Python vector.
3. Explain why `signedGapBps(1, 2**248, true)` must return -2^127 rather than revert.
