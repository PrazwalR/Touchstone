# 0057: TouchstoneLens, URC-4 quotes and the quote budget (M10)

Status: accepted. The owners chose option A (keep `maxQuoteTicks` at 64) on 3 November 2026.
Date: 3 November 2026.

## Context

Spec §12.1 and §12.2 ask for `previewDeposit` and URC-4's `IALFHook` (`getIndicativeQuote`, `swapToPrice`,
`isLive`, `maxGas`, ERC-165) served from a `TouchstoneLens` behind thin forwarders, with an AMM quote from
`StaticQuoteLib`, a view port of v4-core's `Pool.swap`. After M9 the hook was 24,437 bytes, 139 under EIP-170,
so the forwarders could not simply be added.

## Decisions

1. **previewDeposit moves to the lens.** The hook keeps a one-line forwarder that passes the one input only it
   can read: whether this transaction has already made the block's first touch on the pool (transient
   `FIRST_TOUCH_TX`). `_classify` and `_settlementTimes`, which only the preview used, left the hook;
   `_calendarNextOpen` became `_calendarAnswersNextOpen`, since the swap path needs only the yes or no.
2. **URC-4 is served by the hook's fallback, not by four forwarders.** Each external function in the hook adds a
   dispatcher comparison that `beforeSwap` and `afterSwap` may pay. The fallback static-calls the lens with the
   original calldata plus one appended word (the in-transaction flag, keyed by `keccak256` of the 160-byte pool
   key that every pool-naming call carries first). Lens reverts, such as `MalformedHookData`, bubble through.
   Rejected: explicit forwarders. They fitted (24,504 bytes) but cost the at-or-above-N0 path 5.34% over the
   pre-repair baseline, above the 5% gate. With the fallback the hook is 23,993 bytes and that path is +4.68%.
3. **The lens trusts the appended flag only from the hook.** A direct caller of the lens gets `false`. The flag
   can only make a quote stricter for the caller's own transaction, and the lens is a view, so a forged flag
   could at worst mislead its own caller; the check removes even that.
4. **One evaluation for both quotes.** `previewDeposit` and the URC-4 quote run the same `_evaluate`, a copy of
   the hook's classification on the state the next swap would see. The URC-4 quote has no swapper, so the
   licence exemption never applies to it: a holder's quote is conservative. The deposit is converted into the
   unspecified currency at the quote's own amounts, as the hook converts it at execution.
5. **The quote budget has two halves.** The spec's rule is kept: a quote that would cross more than
   `maxQuoteTicks` initialized ticks returns 0. Steps across empty bitmap words are a second cost the spec does
   not bound; without a bound `maxGas()` could not be a worst case, since a quote can walk thousands of empty
   words on a tick-spacing-1 pool. A quote that steps across more than `maxQuoteTicks` empty words also returns
   0. Tests: `test_QuoteBeyondTheTickBudgetIsZero`, `test_QuoteBeyondTheEmptyWordBudgetIsZero`.
6. **`maxQuoteTicks` is a deploy parameter** in `script/config/<chain>.json`, 64 on both testnets (the spec's
   default), and the lens rejects zero (`Touchstone__ZeroQuoteBudget`).
7. **`maxGas()` is computed, not a constant:** `QUOTE_BASE_GAS + maxQuoteTicks * QUOTE_GAS_PER_TICK`, each a
   measured figure rounded up (`QuoteGasTest`). A constant would be wrong for any chain that sets a different
   budget.

## Open question for the owners: the 300k target

Measured on a tick-spacing-1 pool (`snapshots/QuoteGasTest.json`):

| Quote | Gas, **measured** |
| --- | ---: |
| No tick in range, one step (fixed cost) | 100,052 |
| 64 adjacent initialized ticks (dense) | 682,643 |
| 64 initialized ticks, one per bitmap word (worst layout found) | 1,144,740 |

`maxGas()` reports 105,000 + 64 × 17,000 = **1,193,000**. The spec's *target* is 300k. Every crossing reads at
least one cold PoolManager slot through `extsload`, so per-step cost cannot fall far; meeting 300k needs a
budget of about 11 ticks ((300,000 − 105,000) / 17,000). That is a parameter change, so it is not made here.
Options:

- **A. Keep 64** and report 1,193,000. Quotes price through deep books; routers that cap quote gas at 300k may
  skip the hook.
- **B. Set `maxQuoteTicks` to 11** per chain. `maxGas()` becomes 292,000; large quotes on fragmented books
  return 0 ("cannot price") and routers fall back to V4Quoter, which runs the real swap.

**Owner decision, 3 November 2026: A.** Both testnet configs keep 64, and `maxGas()` reports 1,193,000. The
300k figure stays a *target*, not met at this budget; the README and dashboard must not present it as met.

## Tests

`test/unit/Quote.t.sol` (quote equals execution in both directions and both exactness modes, a price limit,
V4Quoter differential, tick budget, invalid limit, malformed hookData, ERC-165, the flag trust check, zero
budget), `QuoteIntegrity` (previewDeposit parity, unchanged, now through the lens) and `QuoteGasTest`.
