# Results

Every number here is a **historical backtest** on Ethereum mainnet, Uniswap v3 USDC/WETH 0.05%, with the fair
price from Binance ETHUSDT / USDCUSDT 1-second closes. The JSON files next to this one carry the
pre-registration hash, the analysis-code hash and the SHA-256 of every input dataset.

## E1, markout census and trigger calibration (development window, 30 Aug to 27 Sep 2026)

Pre-registration `prereg/E1.md` (SHA-256 `2c68d43d...`), analysis code `40041d0c...`. 209,406 swaps,
$1.98 billion volume.

- **Where toxic markout sits.** Swaps of $25,000 and above carry 97% of toxic markout (markout above fee and
  2 bp margin at 3 s); the 70 swaps above $500,000 alone carry 46%. Swaps below $5,000 (72% of swaps) carry
  0.3%. Swaps trading toward the Chainlink reference by 20 bp or more carry 55%. By block position the split
  is 43% first-in-block, 57% later, so first touch alone would not suffice on Ethereum's 12 s blocks; the
  size and flow rules carry the rest.
- **Selected trigger** (pre-registered rule: highest development recall with phi_count <= 0.30):
  N0 = $5,000, N_min = $50,000, h = 6 s, tau = 2 bp. Development recall 0.996, phi_count 0.293,
  phi_volume 0.945. The spec-default trigger ($5,000, $100,000, 12 s, 5 bp) scored recall 0.990,
  phi_count 0.269.
- Reporting note: in the census size and drift tables of `E1.json`, the `toxic` column is in USDC base units
  (1e-6 USD) while `markout` and `volume` are in dollars. Shares are unaffected. The frozen code is not amended
  for a display unit; the next pre-registration fixes it.

## E2, trigger recall, gate G1 (held-out window, 27 Sep to 25 Oct 2026)

Pre-registration `prereg/E2.md` (SHA-256 `148795c2...`), same analysis code. 184,145 swaps.

| Metric | Value |
| --- | --- |
| Held-out recall | **0.989** (95% day-bootstrap interval 0.986 to 0.992) |
| phi_count | **0.234** (gate: at most 0.30) |
| phi_volume | 0.896 |
| Break-even recall r* (3 s) | -0.312 (interval -0.500 to -0.182) |
| r* with LP net at 15 s | -0.256 |
| Report-average r*, for context | 0.451 |
| Net LP markout, held-out | LPs gained $62,654 net of fees at 3 s |
| Weekly recall | 0.985, 0.993, 0.991, 0.987 |
| Weekly phi_count | 0.225, 0.162, 0.271, **0.323** |
| Spec-default trigger, held-out | recall 0.972, phi_count 0.222 |

**Verdict: pass, under the pre-registered rule.** G1 is met on one chain.

What the pass does and does not show:
1. Recall is far above any plausible break-even, including the report-average 0.451. The trigger catches
   almost all toxic markout because toxic markout is concentrated in large swaps.
2. The break-even comparison itself is uninformative on this window: LPs did not lose at 3 s or 15 s net of
   fees on the held-out weeks, so r* is negative. As pre-registered, this is reported as a pass with that
   caveat. On the development window LPs lost $62,737 net at 3 s (r* = 0.13 there, exploratory).
3. The cost side is large. About 90% of volume would post a refundable deposit. The gate measures phi by swap
   count, as pre-registered, and one held-out week exceeded 0.30 by count (0.323). Locked capital, router
   friction and quote gaps on that volume are what E3, E6 and E12 must price.
4. One pool, one chain, eight weeks. Arbitrum and Base, and longer windows, are separate pre-registrations.

## Exploratory, not pre-registered

- The whole 56-day window's net LP markout at 3 s is +$82, against a per-day standard deviation of about
  $7,300; development and held-out are nearly equal and opposite. At 15 s the total is -$14,814, so this is not
  structural. A few very large same-block round trips (for example block 26,026,265: a $4.1 million sell at
  +$160,499 and a $4.08 million buy at -$140,144) dominate daily sums.
- The grid's highest-recall triggers (N0 = $1,000, h = 60 s) reach recall 0.999 but flag 60% of swaps, outside
  the phi gate.

## E3/E4 renewed freeze — no new backtest result

Label: preparation for a historical backtest, not a result. Decision 0052 records the owner's choice to retain current formulas and disclose approximation. The renewed analysis was committed before the separate E3/E4 freeze commit (`aca218f`). E3's defaults and selected-point pass lines, grid and dry-run disclosure remain unchanged. E4 still kills at a median basis above 1 bp at Delta = 3 seconds; other deltas do not replace that line.

The owner confirmed the original swap/reference logs and Binance inputs on the Mac checkout on 6 November and started fetching all 44,476 required Pyth timestamps. Fresh downloads do not require a legacy cache source manifest; that manifest is needed only when migrating old chunks. Download completion and E3/E4 results are not yet recorded here. See [HANDOFF.md](../../docs/HANDOFF.md) for machine-specific availability. Once coverage is complete, verify input hashes and report both windows and both E3 verdicts under the frozen registration. Prior diagnostic numbers remain historical disclosures, not rerun results. Do not fill E3.json or E4.json with stand-in data.

## E5 · Evasion · No kill under the registered rule, but read the caveat below

**Simulation.** `No full E5 pass may be claimed until padding profit and exact-output currency consequences are independently evaluated` (the pre-registration's own words). Under the literal registered rule — held-out recall at or above r* — **no scenario kills**, including the worst one. That is not the same as "evasion does not work": r* on this window is **−0.3119** (E2's own result), so the rule is satisfied by any non-negative recall, no matter how low. This exact gap was anticipated in the pre-registration before the tape was read.

Read the recall numbers directly, not just the pass/fail column:

| Scenario | Dev recall | Held-out recall | Held-out 95% CI | Formally below r\*? |
| --- | ---: | ---: | --- | :-: |
| Unchanged tape | 99.60% | 98.94% | [98.63%, 99.15%] | No |
| Exact-output | 99.60% | 98.94% | [98.63%, 99.15%] | No |
| Padding ×1.25 / ×2.0 | 99.70% / 99.86% | 99.29% / 99.66% | tight | No |
| Split under N₀, no delay | 99.18% | 98.03% | [97.26%, 98.53%] | No |
| Split under N₀, 24 s delay | 98.71% | 97.62% | [96.81%, 98.21%] | No |
| **Split under N_min/10, no delay** | 84.00% | **66.14%** | [58.24%, 72.16%] | No (r\* is negative) |
| **Split under N_min/10, 12 s delay** | 9.88% | **11.15%** | [0.82%, 27.03%] | No (r\* is negative) |
| **Split under N_min/10, 24 s delay** | 6.65% | **9.74%** | [0.49%, 24.32%] | No (r\* is negative) |

**Reading it straight:** an arbitrageur who splits a toxic trade into pieces below a tenth of N_min and spaces them across blocks drops held-out detection recall to under 10%, and the registered kill line does not catch it, purely because the break-even recall on this historical window happened to be negative (LPs were already ahead on this window net of fees, the same thing E2 flagged). This is real evidence that fine-grained splitting is a meaningfully open evasion path for the size/flow trigger, independent of whether the formal line fires. It does not identify whether such splitting is profitable after gas, delay risk and the flow bucket's own drain (`caveats` in `E5.json`), which is unevaluated here.

Six of 393,551 raw rows (0.0015%) were excluded before this run: a genuine Uniswap V3 rounding degenerate where one swap leg's integer delta rounds to exactly zero at extreme liquidity depth. Documented in `prereg/FROZEN.md`, 6 November 2026; the fix touched no registered threshold. [Result](E5.json) · [Manifest](../data/behaviour/E5.manifest.json) · [Reproduction commands](../README.md)

## E6 · Freshness · Kill

**Simulation.** All 21 registered cases hit the kill line in both windows. The target was a mean absolute price error at most 10% higher than the static-fee pool. On development data the increase was 32.3% to 64.3%. On held-out data it was 39.2% to 73.3%. This includes every case with margin equal to hedging cost.

Both pools saw the same one-second ETH/USDC price proxy. With a 2 bp cost, a 2 bp margin and zero observation delay, held-out mean error was 2.293 USDC per ETH for static and 3.521 for Touchstone. The static agent entered 929 times and the Touchstone agent entered 158 times. The model charges retention to every eligible arbitrage candidate. It uses constant-product reserves, a discrete size grid, fixed arrival delays and a single agent. It omits concentrated ticks, competing arbitrageurs and fee compounding. The result measures simulated freshness, not LP returns.

Ratios below are mean absolute pool-to-outside price error divided by static error. Intervals are the frozen 95% paired UTC-day bootstrap. The development window is 20–26 September 2026 UTC and the held-out window is 27 September–3 October 2026 UTC. Each row is a simulation.

| Cost (bp) | Delay (s) | Margin (bp) | Development ratio [interval] | Held-out ratio [interval] | Verdict, both |
| ---: | ---: | ---: | --- | --- | --- |
| 1 | 0 | 1 | 1.487 [1.410, 1.551] | 1.610 [1.521, 1.693] | Kill |
| 1 | 0 | 2 | 1.453 [1.379, 1.513] | 1.574 [1.485, 1.664] | Kill |
| 1 | 0 | 5 | 1.356 [1.290, 1.405] | 1.528 [1.422, 1.659] | Kill |
| 1 | 1 | 1 | 1.484 [1.410, 1.548] | 1.608 [1.519, 1.691] | Kill |
| 1 | 1 | 2 | 1.451 [1.378, 1.510] | 1.573 [1.484, 1.663] | Kill |
| 1 | 1 | 5 | 1.354 [1.289, 1.403] | 1.527 [1.421, 1.658] | Kill |
| 1 | 3 | 1 | 1.480 [1.406, 1.543] | 1.605 [1.516, 1.688] | Kill |
| 1 | 3 | 2 | 1.447 [1.374, 1.506] | 1.570 [1.481, 1.660] | Kill |
| 1 | 3 | 5 | 1.351 [1.287, 1.400] | 1.525 [1.419, 1.655] | Kill |
| 2 | 0 | 2 | 1.425 [1.334, 1.495] | 1.536 [1.459, 1.611] | Kill |
| 2 | 0 | 5 | 1.327 [1.244, 1.386] | 1.459 [1.363, 1.564] | Kill |
| 2 | 1 | 2 | 1.423 [1.333, 1.493] | 1.535 [1.458, 1.610] | Kill |
| 2 | 1 | 5 | 1.326 [1.243, 1.385] | 1.458 [1.362, 1.563] | Kill |
| 2 | 3 | 2 | 1.420 [1.331, 1.490] | 1.532 [1.455, 1.608] | Kill |
| 2 | 3 | 5 | 1.323 [1.241, 1.381] | 1.456 [1.360, 1.562] | Kill |
| 5 | 0 | 2 | 1.643 [1.490, 1.768] | 1.733 [1.602, 1.858] | Kill |
| 5 | 0 | 5 | 1.342 [1.269, 1.414] | 1.394 [1.307, 1.484] | Kill |
| 5 | 1 | 2 | 1.640 [1.489, 1.766] | 1.732 [1.601, 1.856] | Kill |
| 5 | 1 | 5 | 1.341 [1.267, 1.413] | 1.393 [1.307, 1.484] | Kill |
| 5 | 3 | 2 | 1.636 [1.487, 1.761] | 1.729 [1.598, 1.853] | Kill |
| 5 | 3 | 5 | 1.339 [1.265, 1.411] | 1.392 [1.306, 1.483] | Kill |

The two Binance NPZs were rebuilt from checksum-verified public daily dumps using `tsr.ingest_binance`. Both SHA-256 digests match the inputs published in E2. The frozen normalizer exported 1,209,601 observations, including the end boundary. The full result includes every case's errors, entries, volume and intervals. The original normalization manifest preserves the exact paths used by this run. [Result](E6.json) · [Manifest](E6.manifest.json) · [Reproduction commands](../README.md)

E9 remains skipped under decision 0054.
