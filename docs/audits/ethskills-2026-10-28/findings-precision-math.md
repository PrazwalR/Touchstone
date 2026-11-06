# Precision and math audit (ethskills checklist, 2026-10-28)

Scope: `contracts/src` (TouchstoneHook, Settler, RebateLedger, TouchstoneFactory, all libraries and types). Compared against `research/reference/touchstone_ref.py` and `research/reference/vectors/vectors.json`. The spec fixes the formulas, so this report covers only precision, rounding direction, casts and overflow in the implementation. Trade-offs already decided in decisions 0022, 0025, 0026 and 0031 are not reported again.

The proofs of concept are in `/private/tmp/claude-501/-Users-prazw-Desktop-Web3-touchstone/fb6f214e-9eef-4eba-b9df-79c5d2a7b8e0/scratchpad/audit/poc-math/test/MathPoC.t.sol`, a standalone Foundry project that imports the libraries from `contracts/src/libraries`. All six tests pass with 5,000 fuzz runs.

## [MATH-1] Drip rounds to zero and still restarts the vesting clock, so small buffers never vest under frequent drips
**Severity**: Low
**Category**: evm-audit-precision-math
**Location**: contracts/src/libraries/VestingLib.sol:15; contracts/src/TouchstoneHook.sol:530-541 (`_dripEffects`), 150-155 (`drip`), 166 (finalize path)
**Description**: `_dripEffects` writes `st.vestLast = block.timestamp` on every call (line 531) and then releases `floor(vest * elapsed / period)`. When `vest * elapsed < period` the release is zero, but the elapsed time has already been used up. Anyone can call `drip`, and every `finalize` also drips. So if calls come every `e` seconds, any buffer below `period / e` base units per currency stays in the buffer for as long as the calls continue.

The value is not lost: it vests once there is a quiet gap of one full period. But LPs never receive it while the pool is busy, or while a griefer keeps calling `drip`. Above that threshold, the remainder lost to rounding is also lost from the time budget on every call, so release is slower than the formula intends. The Python `drip_amount` uses the same floor; the reference does not model how the clock interacts with it. Decision 0026 covers the clock restart only for the no-liquidity case, not this zero-release case.
**Proof of Concept**: `test_DripRoundsToZeroForever`. With vestPeriod = 86,400 s, vest = 86,399 base units and one drip per second (a 1 s L2 block time) for two full periods, nothing is released and 86,399 stays in the buffer. A single drip after one period releases all 86,399. In WBTC that is about $86 per pool. With 12 s mainnet blocks the threshold is 7,200 base units. On a busy pool, settlements alone produce this cadence without any griefer.
**Recommendation**: When liquidity is present and both releasable amounts are zero, return without writing `vestLast`, so elapsed time accumulates until at least one unit vests. Keep the restart for the no-liquidity case in decision 0026. Record this as an implementation detail of §8.4, and add a test showing that a buffer below `period` base units vests in full within one period under per-second drips.

## [MATH-2] Risky-currency deposit is computed from a floored quote amount (division before multiplication)
**Severity**: Low
**Category**: evm-audit-precision-math
**Location**: contracts/src/TouchstoneHook.sol:305-306; contracts/src/libraries/DepositLib.sol:39-41, 48-54
**Description**: The code computes `depositQuote = floor(N * rate / 1e4)` and then `deposit = floor(depositQuote * riskyAbs / N)`. The exact value simplifies to `riskyAbs * rate / 1e4`, so the first floor is a hidden division before multiplication. D is understated by up to `riskyAbs / N` base units (one quote base unit's worth of risky), a relative error of up to `1 / depositQuote`. D caps R, so the LPs' maximum clawback on that record falls by the same amount.

When `N * rate < 10,000` (for example N < 2,000 quote base units at 5 bps), D is zero and a swap flagged by the flow trigger posts nothing. The reference has no execution-price conversion (`quote_to_risky` converts at a given price), and `vectors.json` has no vectors for deposits held in the risky token.
**Proof of Concept**: `test_ToRiskyDoubleRounding`. Take a WBTC-quoted pool with N = 12,345 sats, riskyAbs = 4,567,890,123,456,789,012,345 (an 18-decimal risky token) and rate = 5 bps. Then depositQuote = 6, D = 2,220,116,706,418,852,496, and the exact value is 2,283,945,061,728,394,506, so D is 2.8% low. `testFuzz_ToRiskyNeverAboveDirect` confirms over 5,000 runs that the gap is never negative and is at most `riskyAbs / N + 1`. For USDC-quoted pools at realistic N0 the error is below 1e-6 relative.
**Recommendation**: Compute `deposit = FullMath.mulDiv(riskyAbs, rate, BPS)` directly. This is the same formula without the intermediate floor. Keep `depositQuote` only for `_withinCap`. Add `deposit_risky` to the reference, along with vectors for it.

## [MATH-3] splitRetained's unchecked block depends on bps parameters <= 10,000, which only the factory enforces
**Severity**: Info
**Category**: evm-audit-precision-math
**Location**: contracts/src/libraries/SettlementMath.sol:94-111
**Description**: The comment "tip <= retained, toProtocol <= rest, toRebate <= rest" holds only if `tipBps`, `protocolShareBps` and `rhoBps` are each at most `BPS`. The library takes them as `uint16` and does not check them. Today the factory bounds (TouchstoneFactory.sol:181-189) and the hook's `conserves` stop any bad value. A future caller, such as the lens or the M9 rent split, would inherit a silent overflow.
**Proof of Concept**: `test_SplitUncheckedWrapsWithBpsAboveTenThousand`. With deposit = retained = 1,000 and protocolShareBps = 20,000, toProtocol = 2,000 and toLPs = 340,282,366,920,938,463,463,374,607,431,768,210,456 (wrapped and then truncated). Only `conserves` in `finalize` catches it.
**Recommendation**: State the `<= BPS` precondition in the comment, or remove `unchecked`. This code runs at settlement, not on the swap path, so the extra gas is a few hundred.

## [MATH-4] rebatePool and vest additions are unchecked, bounded only by token supply
**Severity**: Info
**Category**: evm-audit-precision-math
**Location**: contracts/src/TouchstoneHook.sol:499-508
**Description**: `rebatePool += toRebatePool` and `vest += toLPs` are unchecked `uint128` additions. Unlike `outstanding`, which line 366 keeps below 2^128, these two balances have no explicit bound. Their real bound is the hook's ERC-6909 claims, and so the token's total supply. A wrap would need a token with more than 2^128 base units (about 3.4e20 whole 18-decimal tokens) held through one pool with no benign draws. The comment "bounded by its deposits" understates this precondition.
**Proof of Concept**: It cannot be built with a realistic token; it needs a total supply above 2^128 base units.
**Recommendation**: Have the comment name the real bound, or use checked arithmetic. This is off the swap path.

## [MATH-5] Every rounding step in R favours the depositor, not the LPs
**Severity**: Info
**Category**: evm-audit-precision-math
**Location**: SettlementMath.sol:32-40, 77; PriceLib.sol:54; ItmLib.sol:41-42, 49-50, 58; DepositLib.sol:33, 40; Settler.sol:169
**Description**: In R, the markout rounds toward negative infinity, confidence rounds up, the ITM input rounds up and its output down, and the rate, D and R all round down. Converting R back to a risky deposit also rounds down. Only the margin (SettlementMath.sol:74) rounds in the LPs' favour.

This goes against the generic checklist rule, but it is what the spec specifies (I3: "R rounds down, refund = D - R"). It also matches `touchstone_ref.py` exactly, and conservation is exact. No one can repeat it for profit, because each record needs a real swap that pays the LP fee. The bias is a few quote base units per record, plus up to one risky base unit's worth when the deposit is in the risky token.
**Proof of Concept**: `test_RetainedRoundsToZeroInRisky`. For WBTC/USDC at $100,000, P* = 1e39 (×1e36 scale), and `mulDiv(999, 1e36, 1e39) = 0`. So any retainedQuote up to 999 USDC base units gives a full refund.
**Recommendation**: No code change. Write the rounding policy into the lesson or a decision record.

## [MATH-6] Zero denominators in settlement-only paths revert settle instead of refunding at once
**Severity**: Info
**Category**: evm-audit-precision-math
**Location**: ItmLib.sol:58; Settler.sol:218-220, 169, 233, 258; PriceLib.sol:100
**Description**:
- (a) `_grossUp` divides by `PIPS - feePips`. v4 accepts a static fee of exactly 1,000,000 (LPFeeLibrary.sol:25, 37), and the factory checks only `isDynamicFee` (TouchstoneFactory.sol:119). A 100%-fee pool with ITM accounting therefore cannot settle any record.
- (b) `_jumped` divides by `execX36`, which is 0 when `qAbs * 1e36 < r`. This path is closure mode only, which decision 0029 disables until M6.
- (c) `fairPriceX36` can return 0 for an extreme negative exponent. The risky-token conversions and `_sqrtRatioX96` then divide by it.

In every case `settle` reverts, and `expire` refunds in full after the window. No funds are lost, but LPs lose the clawback on those records.
**Proof of Concept**: Reasoned from the code: `mulDivRoundingUp(x, 1e6, 0)` reverts.
**Recommendation**: Reject `fee == MAX_LP_FEE` in `createPool`. When closure mode lands, treat `execX36 == 0` as a jump. Treat `priceX36 == 0` as a guard failure that refunds in full.

## Checked and safe
- Division before multiplication in the Settler round trip: `retained <= D` because `R_q <= floor(D*P/1e36)` (Settler.sol:159-169). The loss is at most one quote base unit.
- Single `mulDiv` per quantity in confBpsUp, clawback, benign, splitRetained and releasable (PriceLib.sol:53-54; SettlementMath.sol:74-77, 92-100, 130-133; VestingLib.sol:15).
- No hidden chained division. `benign` uses one denominator, `PIPS*BPS`. `poolPriceX36` takes one step below 2^128 and two steps (error under 2^-32) above it (PriceLib.sol:62-71).
- No sequential division by the same scale constant.
- Division to zero for small values is covered by MATH-1 and MATH-2. The truncated flow drain keeps the bucket fuller, which favours flagging (FlowBucketLib.sol:38).
- Vault deposit/withdraw consistency: not applicable. There are no shares, and payouts conserve D exactly (SettlementMath.sol:148-154, TouchstoneHook.sol:137).
- Inverse fee: `_grossUp` equals v4's `amountIn + mulDivRoundingUp(amountIn, f, 1e6 - f)` (ItmLib.sol:57-58, SwapMath.sol:74).
- The benign rebate rounds down and is capped by the pool. The tip cap rounds down and saturates at uint128 (SettlementMath.sol:130-132; Settler.sol:252-260).
- Payout never exceeds D: the clawback caps it, `splitRetained` reverts above D, and `conserves` re-checks in uint256 (SettlementMath.sol:78, 91, 153).
- Unchecked outstanding subtraction in `finalize`: the record hash proves the deposit was added once (TouchstoneHook.sol:142-145).
- Unchecked benign `tip + rebate`: `conserves` already checked the sum in uint256 against a uint128 pool (TouchstoneHook.sol:491-496).
- Unchecked `_takeDeposit`: `_withinCap` keeps outstanding + deposit at most 2^128 - 1 (TouchstoneHook.sol:366, 411-415).
- Unchecked `_dripEffects`: releasable is at most the buffer (TouchstoneHook.sol:538-541).
- Unchecked FlowBucketLib: the level is capped at `uint104.max - 1` (FlowBucketLib.sol:49-52).
- Unchecked `RebateLedger._debit`: each owed balance is part of the total (RebateLedger.sol:90-92).
- Every unchecked block has an invariant comment. MATH-3 and MATH-4 cover the two whose comments understate their preconditions.
- Downcasts: deposit is at most 0.2·notional < 2^127 (TouchstoneHook.sol:255, 401, 425). `uint128(retained)` holds because retained ≤ D (Settler.sol:172). Payout fields are at most the deposit. The `uint160` sqrt reverts through `mulDiv` instead of truncating (PriceLib.sol:100-101). The uint64 and uint40 time and block casts are far from their limits.
- Negative-to-unsigned: values are negated in int256 after coming from int128 (TouchstoneHook.sol:269-270; Settler.sol:204, 215-216; RecordLib.sol:26; SettlementMath.sol:38).
- Signed/unsigned mixing: `SafeCast.toInt256` in markout. In `signedGapBps` the magnitude is at most 2^127, and the saturation pre-check is exact (PriceLib.sol:88-94).
- Time arithmetic: `nMin * dt` < 2^136. Oracle timestamps are checked before subtraction (ReferenceLib.sol:39-40, 59-60).
- Time literals are only assigned to uint32 constants (TouchstoneFactory.sol:78-95).
- Pyth decimals: the exponents and both token decimals go into one power of ten, range-checked to 10^76. In confidence the exponents cancel (PriceLib.sol:39-54).
- Chainlink `decimals()` is queried. Overflow or a zero result gives `ok = false` (ReferenceLib.sol:42-47, 72-83).
- Token decimals are read at creation, with 18 for native. The risky and quote mapping is the same in the hook and the Settler (TouchstoneFactory.sol:123-124, 197-200; TouchstoneHook.sol:334; Settler.sol:135).
- No double scaling: prices are base units ×1e36 end to end.
- Extreme pairs have enough precision. An 18-decimal $1e-8 token against USDC gives 1e16 at the ×1e36 scale, and WBTC/DAI gives 1e51.
- The Babylonian sqrt (7 steps from a power of two) has relative error around 1e-61, and `min(r, x/r)` gives the floor (PriceLib.sol:105-114).
- No overflow at v4 sqrt bounds in `poolPriceX36`, `signedGapBps` or `_withinCap` (decision 0031).
- These functions match `touchstone_ref.py` rounding exactly: fairPrice, conf, rate, quoteAmount, markout, clawback, split, benign, conserves, releasable and the bucket drain. The bucket's `MAX_LEVEL` saturation only differs above 2^104, and `hit` is unaffected.
- Accumulator, reward-per-token and fee-share ordering items: not applicable (donations go through `donate`). `finalize` drips before adding the LP share (TouchstoneHook.sol:166-168).
- Assembly division: not applicable; assembly is only TSTORE/TLOAD (TransientLib.sol).
- `uint256.max` sentinel: not used in arithmetic. `uint128.max` appears only in comparisons and a saturating cast.
- Exponential or weighted math: not applicable.
- Off-by-one: `elapsed >= period`, `level >= nMin`, `gap >= tau`, `notional >= n0` and `m <= margin` match the reference and the spec.
- No checked underflow can revert `_afterSwap` (guard at TouchstoneHook.sol:371).
- CalendarMath cannot underflow for years from 1970, and calendar pools are rejected until M6.
- Error does not compound: each step from P* to D_q to R to the risky conversion is a single floor of at most one base unit.
