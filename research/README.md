# Research

uv project, Python 3.13. `reference/` holds the exact rational reference (`touchstone_ref.py`), the script that
reproduces every number the spec quotes (`check_report_numbers.py`) and the vectors the Solidity tests read.

Run: `uv sync`, `uv run ruff check .`, `uv run mypy`, `uv run pytest`. Experiments run as `uv run python -m experiments.e1_census`.

Experiments are pre-registered in `prereg/` before they run (spec §16.6). E1 to E3 start from Assay's calibration
pipeline (`../Assay/calibration`): swap logs over RPC and Binance 1-second klines. E1/E2 results record a G1 pass under their original pre-registration; see `results/README.md` for its
limitations. The original swap and Chainlink inputs are absent here. The two public Binance series match the E2 hashes. E3/E4 have renewed committed freezes (1 November, decision 0052), but no run or verdict exists on this checkout. E3 explicitly remains an approximate fixed-flow counterfactual, not a faithful stateful contract replay.
The frozen E1/E2 analysis and saved results must not be overwritten by corrected analyses.

E10 remains draft. `simulations/licence_path.py` provides sequential races, rent accounting and explicitly
paired bidder valuations for synthetic validation. It has no historical-data CLI or experiment verdict.
Register its assumptions and sensitivity inputs in `prereg/E10.md` before adding a freeze-gated runner.
The fork-data and sampling requirements for E12 are in `prereg/E12.md`, also draft.

The E5 and E6 configurations were committed in `584628a` and frozen separately in `263bb7d`. Both require the published E2 source hashes. To reproduce E6 with a fresh research data directory:

```sh
uv run python -m tsr.ingest_binance
uv run python -m experiments.prepare_behaviour E6 --config config/E6.json --output data/E6.jsonl.gz --manifest data/E6.manifest.json
uv run python -m experiments.behaviour E6 --config config/E6.json --tape data/E6.jsonl.gz --input-manifest data/E6.manifest.json --output data/E6.reproduced.json
```

The exporter and runner refuse to overwrite existing outputs. Keep the original input basenames. The normalization manifest contains machine-specific source paths, so its digest can differ across machines even when the raw and normalized tapes match. E5 uses the same commands with E5 in place of E6 after transferring the published swap and reference logs. See `results/README.md` for outcomes. E9 remains skipped under decision 0054.

Legacy Pyth migration: `uv run python -m experiments.rekey_pyth --cache data/cache/pyth --source-manifest <source-manifest.json> --receipt <new-receipt.json>` after the renewed E3/E4 freeze. The manifest must contain the exact pre-registered `base_id`, `quote_id`, and `chunks` entries with `file` basename and `sha256`. Obtain it from the original download provenance; do not guess feed IDs from row data. This checkout has neither legacy chunks nor the raw data needed to reconstruct request times.

Use `experiments.prepare_behaviour E5` (or E6) with the same `--config`, a new `--output` tape and `--manifest` path to normalize the existing E1/E2 raw inputs after the matching freeze. The exporter records original source hashes and the normalization assumptions. It refuses a draft or an existing output.
