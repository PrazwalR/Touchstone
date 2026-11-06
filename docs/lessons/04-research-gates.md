# Lesson 04: the research gates, E1 and E2 (M4)

## 1. Concept

Touchstone only helps LPs if its trigger flags the swaps that hurt them. **Recall** r is the share of toxic
markout (markout above fee and margin) that lands on flagged swaps. If LPs lose L - F per unit volume net of
fees, and the clawback keeps alpha of the toxic markout it sees, LPs break even when
alpha * r * (toxic markout) = net loss, so r* = (net loss) / (alpha * toxic markout) (spec §4.6). E2 measures
both on held-out data. The gate also caps the **flag share** phi at 30%, because every flagged swap carries side
costs even though its deposit is refunded.

## 2. Design decisions

- **Pre-registered, then run.** E1 and E2 were frozen with a hash of the analysis code before any data was
  downloaded (`research/prereg/FROZEN.md`). Without git, the ledger is the record; it is committed first when
  the history is created.
- **Split by time.** 28 development days choose the trigger by a fixed rule; 28 later days test it.
- **Fair price in USDC.** ETHUSDT / USDCUSDT, so the USDT basis does not leak into bp-scale markouts.
- **The same trigger the contract runs.** `tsr/triggers.py` ports the Solidity rules exactly, and
  `contracts/test/differential/TriggerPort.t.sol` checks the port against the libraries.
- **r* measured directly** from the held-out swaps rather than from published averages.

## 3. Code walkthrough

- `research/tsr/ingest_*.py`: Swap and AnswerUpdated logs over a public RPC in 100-block chunks, cached per
  chunk so a failure loses one chunk (`tsr/chunks.py`); Binance daily dumps verified against Binance's SHA-256.
- `tsr/swaps.py`: trader-side receipts; the pre-swap price is the previous swap's post price, since v3 liquidity
  events do not move price.
- `tsr/metrics.py`: `markout`, `toxic`, `score` (recall, phi by count and volume), `break_even_recall`,
  `TriggerGrid` (each rule computed once per parameter it depends on), `select` (the pre-registered rule).
- `experiments/e1_census.py`, `experiments/e2_recall.py`: E2 refuses to run if E1 came from different code.

## 4. Failure modes

| Failure | Effect | Guard |
| --- | --- | --- |
| Port differs from the contracts | The backtest measures another mechanism | `TriggerPort.t.sol`, `tests/test_triggers.py` |
| Thresholds tuned on held-out data | Inflated result | Pre-registration hash in every result; E2 checks E1's code hash |
| A sign error in the markout | Toxic markout lands in the wrong buckets | Drift census: 55% of toxic markout trades toward the reference, as it should |
| RPC truncates logs silently | Missing swaps | Logs fetched from a server that errors on oversize ranges, not one that truncates |

## 5. Audit questions

1. *Is recall 0.99 too good?* It follows from concentration: swaps of $25k and up carry 97% of toxic markout and
   are flagged almost always. Confident in the arithmetic; the economic reading needs E3.
2. *Why does a negative r* count as a pass?* Pre-registered: if LPs did not lose on the window, no recall is
   needed to break even. It means the window cannot test break-even, not that Touchstone is proven.
3. *Is phi_count the right gate?* It was pre-registered. phi_volume is 0.90, and one held-out week exceeded
   0.30 by count. A later pre-registration should weigh volume.
4. *Is Binance the right fair price?* For E1 and E2, as the spec says. Settlement uses Pyth; E4 measures the gap.
5. *One pool enough?* For G1, yes by the spec ("at least one chain"). Not for adoption claims.

## 6. Exercises

1. From `results/E2.json`, recompute r* from `net_lp_markout_usd` and `toxic_markout_usd`.
2. Re-run `uv run python -m experiments.e1_census` and confirm the selected trigger and hashes are identical.
3. Explain why E2's verdict would flip to kill if held-out phi_count had been 0.32 instead of 0.234.
