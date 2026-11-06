# Gas

Every figure is labeled. **Measured** figures come from `contracts/test/gas/SwapGas.t.sol` and are written to
`contracts/snapshots/SwapGasTest.json`. Regressions are judged against the tables below at a 5% tolerance (there
is no `.gas-snapshot` file; the JSON snapshot is the record). *Target* figures
are spec §17.5 goals.

Method: gas the hook adds is the difference between a swap on the Touchstone pool and the identical swap, from the
identical state, on a hookless twin pool with the same liquidity, in isolated transactions (decision 0030). Pool:
18-decimal risky, 6-decimal quote, full-range liquidity of about $20M, after one warm-up swap on each pool.
Compiler settings: decision 0028.

## End of M3, 27 October 2026

| Path | Measured | *Target* | Status |
| --- | --- | --- | --- |
| Unflagged swap below N0 | 20,822 | 15,000 (E8 pass line 20,000) | Above target and above the E8 pass line |
| Unflagged swap at or above N0 (one reference read) | 45,398 | 40,000 | Above target |
| Flagged swap (reference read, record, mint, two events) | 139,453 | 90,000 | Above target; first deposit in the pool |
| `settle`, retaining | 245,311 | 250,000 | Within target |
| `expire` | 171,810 | measured and recorded | |
| `drip` | 41,079 | measured and recorded | |

## Where the gas goes, and what to try (audit 7, M12)

Unflagged below N0: two hook calls (the first is a cold account access), two `extsload`s for the snapshot, four
`TSTORE`s with keccak-derived slots, one cold read of config slot 0, and one read and one write of state slot B.
Candidates, each to be measured, not assumed:
1. Skip the `PRE_LIQUIDITY` snapshot and the two clears for swaps that can never be flagged. That needs the
   notional, which beforeSwap does not know for exact-output swaps, so it is not free.
2. Pack the pre-swap sqrt price and liquidity into one transient slot (160 + 96 bits would need a liquidity cap).
3. Precompute the transient slot keys once per call instead of hashing per access.

Flagged: the `DepositTaken` event carries the whole 17-field record, about 550 bytes of log data; that is the price
of letting a keeper settle without storage reads (D-7) and is not a candidate for removal.

## Repair measurements, 30 October 2026

Measured with Foundry1.5.1, Solc0.8.26 and the repository production compiler profiles after approved decisions
0042 and0044. The pre-repair comparison is the tracked `SwapGasTest.json` at07f4bbe, preserved separately in
`docs/audits/m0-m5-repair-2026-10-30/gas-before.json`; it differs slightly from the older M3 prose table.

| Path | Pre-repair measured | Post-repair measured | Change |
| --- | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,242 | +2.02% |
| Unflagged at/above N0 | 45,398 | 47,069 | +3.68% |
| Flagged | 139,453 | 141,857 | +1.72% |
| Retaining settlement | 245,418 | 298,640 | +21.69% |
| Expiry | 172,206 | 217,662 | +26.40% |
| Drip | 41,183 | 41,098 | -0.21% |

The extra snapshot writes/log field and isolated ledger delivery have measured costs. The 5% regression gate
fails for settlement and expiry; their security approvals are not an implicit baseline reset. Settlement now
exceeds the250,000 target, while previously failing swap targets remain unmet. CI retains the original baseline.
Production runtime sizes: TouchstoneHook20,753 bytes, Settler14,363, TouchstoneFactory8,571, RebateLedger3,882.
The hook remains below24,576; the vendored test PoolManager still makes the unrestricted `forge build --sizes`
command fail (decision0039). `scripts/check_release_gates.py sizes` checks first-party deployable core artifacts
without relaxing EIP-170 or treating a local unlimited-size test deployment as production evidence.

The existing snapshots are named `snapshotGasLastCall`/`snapshotValue` outputs. `forge snapshot --check` alone
expects a different `.gas-snapshot` file and did not enforce these JSON path deltas. CI now compares the actual
named measurements with the preserved pre-repair baseline and rejects increases above5%.

## Merge with the repair, 31 October 2026

Measured after merging closed-market mode (M6, decision 0048) and the construction-time checks onto the repair
(decision 0049). Closed-market mode is gated on a factory-set `PoolFlags.CALENDAR` bit in the flags word the
swap path already reads, so crypto pools pay no extra storage read; before that gate the at-or-above-N0 path cost
2,331 gas more than the repair.

| Path | Pre-repair baseline | Repair | After merge | Change vs repair | Change vs baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,242 | 21,352 | +110 | +2.55% |
| Unflagged at/above N0 | 45,398 | 47,069 | 47,265 | +196 | +4.11% |
| Flagged | 139,453 | 141,857 | 144,335 | +2,478 | +3.50% |
| Retaining settlement | 245,418 | 298,640 | 298,640 | 0 | +21.69% |
| Expiry | 172,206 | 217,662 | 217,662 | 0 | +26.40% |
| Drip | 41,183 | 41,098 | 41,098 | 0 | -0.21% |

The swap-path additions are the hookData address-word check (every swap that passes hookData) and the record's
`mode` from the swap view. Settlement and expiry still fail the 5% gate for the reasons recorded in the repair.

## After M7, 31 October 2026

`previewDeposit` adds a selector to the hook's dispatcher, and the swap path shares its helpers. The swap path
writes the classification out inline instead of calling `_classify`; the call cost about 150 gas on the
at-or-above-N0 path.

| Path | Pre-repair baseline | After merge | After M7 | Change vs baseline |
| --- | ---: | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,352 | 21,591 | +3.69% |
| Unflagged at/above N0 | 45,398 | 47,265 | 47,537 | +4.71% |
| Flagged | 139,453 | 144,335 | 144,632 | +3.71% |

Settlement, expiry and drip are unchanged. GuardedRouter's own gas is outside the hook measurement.

## Approved baselines, 2 November 2026

Settlement (298,640) and expiry (217,662) are now judged against approved baselines recorded in
`docs/audits/gas-approved-baselines.json` (decision 0055); the swap paths still use the pre-repair baseline.
`hook_added_unflagged_at_or_above_n0` is +4.71%, 0.29 points from the gate.

## After M9, 2 November 2026

The licence adds a flag test and two words to the swap path of every pool. A pool without the `LICENCE` flag stops
at the flag test (decision 0056). Measured with `forge test --match-path test/gas/SwapGas.t.sol`:

| Path | Pre-repair baseline | After M7 | After M9 | Change vs baseline |
| --- | ---: | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,591 | 21,643 | +3.94% |
| Unflagged at/above N0 | 45,398 | 47,537 | 47,651 | +4.96% |
| Flagged | 139,453 | 144,632 | 144,994 | +3.97% |

The at-or-above path is 16 gas below the 5% gate.

Licence pools, recorded in `snapshots/LicenceGasTest.json` (no pre-repair baseline, so not gated):

| Path | Measured | *Target* (spec §10) |
| --- | ---: | --- |
| Licence check, steady state (same router, both pools warmed) | 16,235 | at most 18,000 |
| Holder's exempt swap, hook-added | 72,442 | below a flagged swap |
| Outsider's flagged swap on a licence pool, hook-added | 163,936 | |
| `bid` | 146,902 | |
| `accrue` delivering rent to the hook | 234,273 | |

Two measurement traps found while recording these:
- **Claims first written in the test.** The first deposit in a test mints the hook's first claims in that
  currency, a zero-to-non-zero write of about 20k, so licence and plain pools must both be warmed first.
- **Activation not yet written.** A swap measured right after an activation, before any accrual, takes
  `holderOf`'s full route; the keeper's accruals keep pools in the narrow-read state.

## After M10, 3 November 2026

M10 moved `previewDeposit` into `TouchstoneLens` and serves URC-4 through the hook's fallback (decision 0057).
The hook shrank from 24,437 to 23,993 bytes, and its dispatcher lost an entry, so every swap path got cheaper.
Measured with `forge test --match-path test/gas/SwapGas.t.sol`:

| Path | Pre-repair baseline | After M9 | After M10 | Change vs baseline |
| --- | ---: | ---: | ---: | ---: |
| Unflagged below N0 | 20,822 | 21,643 | 21,522 | +3.36% |
| Unflagged at/above N0 | 45,398 | 47,651 | 47,523 | +4.68% |
| Flagged | 139,453 | 144,994 | 144,810 | +3.84% |

Licence pools (`snapshots/LicenceGasTest.json`): check 16,235; exempt swap 72,321; outsider's flagged swap
163,752; `bid` 146,878; `accrue` 234,339.

URC-4 quotes (`snapshots/QuoteGasTest.json`), all **measured**, on a tick-spacing-1 pool:

| Quote | Gas |
| --- | ---: |
| Fixed cost, one step | 100,052 |
| 64 adjacent initialized ticks | 682,643 |
| 64 initialized ticks, one per bitmap word (worst found) | 1,144,740 |
| `maxGas()` at `maxQuoteTicks` = 64 | 1,193,000 (bound: 105,000 + 64 × 17,000) |

The spec's *target* for `maxGas` is 300k. It is not met at the default budget; decision 0057 sets out the
choice for the owners.
