# Lesson 11: the lens and URC-4 quotes (M10)

## 1. Concept

A router choosing between pools asks each one: "if I swap X now, what do I get?" For a plain v4 pool the
answer is the AMM curve. For Touchstone the answer is the AMM curve **minus the deposit** the hook would take,
because the deposit leaves the swapper's output in the same transaction. A quote that ignores the deposit makes
Touchstone look better than it is, and the router's minimum-output check then fails at execution.

URC-4 (`IALFHook`) is Uniswap's draft interface for hooks to answer that question:

- exact input, `amountSpecified < 0`: `getIndicativeQuote = out_AMM − D_out`
- exact output, `amountSpecified > 0`: `getIndicativeQuote = in_AMM + D_in`

Here `D` is the deposit converted into the swap's unspecified currency, the same currency the hook takes it in
(spec §7.9). `D` in quote units is `rate × notional`, flagged or zero, exactly as `previewDeposit` computes it.

Why not run the real swap and revert, as V4Quoter does? Because URC-4 wants a call routers can make cheaply
and repeatedly, and because the hook's own `beforeSwap` reads transient state that a nested simulated swap
would disturb. So the AMM part is recomputed in a view: `StaticQuoteLib` walks the same loop as `Pool.swap`
(next initialized tick, `SwapMath.computeSwapStep`, cross, repeat), reading ticks and bitmaps through
`StateLibrary`'s `extsload`.

## 2. Design decisions

| Chosen | Rejected | Trade-off |
| --- | --- | --- |
| Quote logic in `TouchstoneLens`, hook keeps forwarders | Quote logic in the hook | The hook had 139 bytes left after M9; the lens costs one extra external call per quote |
| URC-4 through the hook's `fallback` | Four explicit forwarders | Explicit forwarders fitted (24,504 bytes) but every function in the dispatcher costs swaps gas: the at-or-above-N0 path went to +5.34%, over the 5% gate. The fallback costs nothing on the swap path; its price is that URC-4 functions are not in the hook's ABI (clients use the exported `IALFHook` ABI) |
| Flag appended as the last calldata word, trusted only from the hook | Pass it as a parameter in a lens-specific function | Keeps the lens's URC-4 functions at their standard selectors, so the fallback forwards calldata unchanged |
| Count both initialized ticks and empty bitmap words against the budget | Initialized ticks only (the spec's wording) | Without the second half no gas figure is a true worst case; on sparse pools some large quotes now return 0 sooner |
| `maxGas()` = measured base + measured per-tick cost × budget | A single constant | A constant is wrong for any chain that sets another budget |
| No licence exemption in URC-4 quotes | Guess the swapper (`tx.origin`) | URC-4 passes no swapper; a holder's quote is conservative, never optimistic |

## 3. Code walkthrough

`src/TouchstoneHook.sol`
- `previewDeposit` (line 244): forwards to the lens with `_touchedInTx(key)` (line 267), the transient
  `FIRST_TOUCH_TX` flag. Without it, a second swap in the same transaction would be quoted as a first touch
  (I11 and the first-touch trigger, spec §7.4).
- `fallback` (line 258): any unknown selector is static-called on the lens with one extra word. Pool-naming
  calls carry the 160-byte `PoolKey` first, so `keccak256(data[4:164])` is the pool id. A static call cannot
  change state, so the fallback cannot be used to reach the hook's own storage or the PoolManager.

`src/periphery/TouchstoneLens.sol`
- `previewDeposit` (82): builds the view at the pre-swap price, converting the cap's risky side at that price
  (decision 0051), then `_evaluate`.
- `getIndicativeQuote` (108) and `swapToPrice` (119): the full-range limit and the caller's limit, both into
  `_quote` (150): hookData check, `StaticQuoteLib.quote`, then `_depositFor` (174), which evaluates the
  deposit on the quote's own amounts and converts it into the unspecified currency.
- `_evaluate` (199): the hook's `_evaluate` without writes: classification (`_classify` 251: calendar, gap),
  flow bucket, licence exemption for a named swapper (`_exempt` 306), triggers (`_triggers` 234), budget
  (`_withinBudget` 322). It must stay equal to the hook's; `QuoteIntegrity` and `Quote.t.sol` enforce it.
- `_touched` (356): reads the appended word only when `msg.sender` is the hook.
- `maxGas` (137): `QUOTE_BASE_GAS + MAX_QUOTE_TICKS * QUOTE_GAS_PER_TICK`.

`src/libraries/StaticQuoteLib.sol`
- `quote` (70): the loop. Stops at zero remaining or at the limit, as `Pool.swap` does; returns `ok = false`
  past either half of the budget.
- `_start` (108): slot0, the fee (LP fee combined with the protocol fee by `calculateSwapFee`), and the checks
  `Pool.swap` reverts on: a 100% fee with exact output, an invalid price limit.
- `_step` (124) and `_cross` (162): one `computeSwapStep`; at a tick boundary, apply `liquidityNet` (negated
  when moving down) and count a crossing, or count an empty word.
- `_nextInitializedTick` (181): `TickBitmap.nextInitializedTickWithinOneWord`, reading the word through
  `StateLibrary.getTickBitmap`.

## 4. Failure modes

| Failure | Blast radius | Caught by |
| --- | --- | --- |
| Lens classification drifts from the hook's | Quotes and previews wrong; routers' min-out checks fail; no funds at risk (views) | `QuoteIntegrity` fuzz, `testFuzz_QuoteMatchesExecution` |
| `StaticQuoteLib` drifts from `Pool.swap` after a v4 upgrade | AMM part of quotes wrong | `testFuzz_QuoteMatchesV4Quoter`, `testFuzz_SwapToPriceStopsAtTheLimit`; the v4 pin in `lib/PINS.md` |
| Quote walks an unbounded number of empty words | Router's `eth_call` runs out of gas | `test_QuoteBeyondTheEmptyWordBudgetIsZero` |
| Forged in-transaction flag | Misleads only the forger's own quote | `test_LensIgnoresTheFlagFromOtherCallers` |
| Malformed hookData quoted instead of rejected | Router gets a quote the swap would revert on | `test_MalformedHookDataReverts` |
| Lens deployed at an address other than the one the hook was built with | Every preview and quote reverts | `CoreDeployer` address prediction and `_check("lens", ...)`, `lens.HOOK`, `lens.FACTORY` |

## 5. Audit questions

1. *Can the fallback be used to call anything with state effects?* No. It only static-calls the immutable
   lens, and the lens has no state. A non-view lens function, had one existed, would revert under STATICCALL.
2. *Why is the deposit converted at the quote's amounts rather than the pre-swap price?* Because the hook
   converts at execution amounts (`DepositLib.toRisky` on the swap's delta); quoting the same way is what
   makes quote and execution equal to the unit. `previewDeposit` has no amounts, so it uses the pre-swap price
   (decision 0051).
3. *Does a quote equal execution when another swap lands first in the block?* No, and no quote can: the
   AMM state and the first-touch flag both change. URC-4 calls these indicative for that reason.
4. *Is 1,193,000 really a worst case?* It bounds the worst layout found (1,144,740), each step reading a cold
   word and a cold tick. A layout that makes every step costlier than 17,000 was not found; I am confident in
   the per-step reasoning (two cold `extsload`s plus the step math) but not that no costlier layout exists.
   `QuoteGasTest` will fail if one is added and exceeds the bound.
5. *What happens at the price-range ends?* `_nextInitializedTick` is clamped to `MIN_TICK` or `MAX_TICK` as in
   `Pool.swap`, and the default limits are `MIN_SQRT_PRICE + 1` and `MAX_SQRT_PRICE - 1`, so the loop stops.

## 6. Exercises

1. Take `test_Gas_QuoteWorstCaseOnePerWord`'s 1,144,740 and `test_Gas_QuoteBase`'s 100,052. Compute the
   per-tick cost, (1,144,740 − 100,052) / 64, and confirm that `QUOTE_GAS_PER_TICK = 17,000` bounds it.
2. For an exact-output buy of the risky token on a pool whose quote is currency0, work out which currency the
   deposit is taken in and confirm it against `bool depositIn0 = exactInput != zeroForOne` in `_depositFor`.
3. Read `Pool.swap` in `lib/v4-core/src/libraries/Pool.sol` side by side with `StaticQuoteLib._step` and
   `_cross`, and list every line of `Pool.swap` the port leaves out. Each one should be fee-growth or
   observation bookkeeping that does not change the amounts.
