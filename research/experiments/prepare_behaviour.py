"""Create hashed E5/E6 input tapes only after the matching committed preregistration freeze."""

from __future__ import annotations

import argparse
import json
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from experiments.behaviour import analysis_hash, guard, integer
from experiments.common import _one, load
from tsr.config import RESULTS_DIR
from tsr.fair import FairPrice
from tsr.store import Row, sha256, sha256_files, write_rows


def e5_rows() -> tuple[Iterator[Row], dict[str, str]]:
    data = load()

    def rows() -> Iterator[Row]:
        skipped = 0
        for i in range(len(data.sw)):
            notional = int(data.sw.notional[i])
            # A handful of raw Ethereum swaps carry notional 0: one leg's integer delta rounded exactly to
            # zero against extreme concentrated-liquidity depth (confirmed by an unchanged tick across the
            # swap), not a parsing error. They cannot be classified as buy or sell exposure and carry zero
            # toxic weight by construction, so the trigger model excludes them rather than treating a
            # degenerate, value-free event as a trade. Amendment 2026-11-06, FROZEN.md.
            if notional <= 0:
                skipped += 1
                continue
            yield {
                "timestamp": int(data.sw.ts[i]),
                "block": int(data.sw.block[i]),
                "tx": data.sw.tx[i],
                "notional": notional,
                "buy": bool(data.sw.buys_risky[i]),
                "gap_bps": int(data.gaps[i]),
                "toxic": int(data.tox[i]),
                "exact_output": False,
            }
        if skipped > len(data.sw) // 1000:
            # A large skipped share would mean something other than a rare rounding degenerate; refuse
            # rather than silently drop a meaningful fraction of the tape.
            raise ValueError(f"unexpectedly many zero-notional rows skipped: {skipped}")

    return rows(), data.inputs


def e6_rows(config: dict[str, object]) -> tuple[Iterator[Row], dict[str, str]]:
    eth, quote = _one("binance_ETHUSDT_1s_*.npz"), _one("binance_USDCUSDT_1s_*.npz")
    fair = FairPrice.load(eth, quote)
    start, end = integer(config["development_start"]), integer(config["end"])
    if start >= end:
        raise ValueError("invalid registered price window")
    times = np.arange(start, end + 1, dtype=np.int64)
    prices = fair.at(times)

    def rows() -> Iterator[Row]:
        for t, p in zip(times, prices, strict=True):
            yield {"timestamp": int(t), "price": float(p)}

    return rows(), sha256_files([eth, quote])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", choices=["E5", "E6"])
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    prereg = guard(args.experiment, args.config)
    if args.output.exists() or args.manifest.exists():
        raise SystemExit("output or manifest exists; refuse to overwrite historical inputs")
    config: object = json.loads(args.config.read_text())
    if not isinstance(config, dict):
        raise ValueError("configuration object required")
    rows, sources = e5_rows() if args.experiment == "E5" else e6_rows(config)
    # These experiments reuse the published E2 sources. Paths vary between machines.
    published = json.loads((RESULTS_DIR / "E2.json").read_text())["inputs_sha256"]
    expected = {
        Path(path).name: digest
        for path, digest in published.items()
        if args.experiment == "E5" or Path(path).name.startswith("binance_")
    }
    if {Path(path).name: digest for path, digest in sources.items()} != expected:
        raise ValueError("source files differ from the published E2 inputs")
    count = write_rows(args.output, rows)
    body = {
        "experiment": args.experiment,
        "operation": "input normalization, no experiment verdict",
        "rows": count,
        "code_sha256": analysis_hash(),
        "prereg_sha256": sha256(prereg),
        "config_sha256": sha256(args.config),
        "source_sha256": sources,
        "tape_sha256": sha256(args.output),
        "caveats": [
            "E5 inherits the original E1/E2 block-level Chainlink timing and floating-point markout.",
            "E5 toxic weights are floored to quote base units; execution type is unobserved, assumed input.",
            "E6 uses Binance close-price proxies, not canonical Pyth settlement observations.",
        ],
    }
    with args.manifest.open("x") as out:
        out.write(json.dumps(body, indent=2, sort_keys=True, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
