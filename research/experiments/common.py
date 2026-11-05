"""Loads the M4 datasets once and builds everything E1 and E2 share."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from tsr.config import (
    CHAINLINK_DECIMALS,
    DATA_DIR,
    ETH_USDC_WETH_500,
    LP_NET_HORIZON,
    REFERENCE_MAX_AGE,
    RESEARCH_ROOT,
    SETTLE_DELAY,
    SPLIT,
    WINDOW_END,
    WINDOW_START,
)
from tsr.fair import FairPrice
from tsr.metrics import markout, toxic
from tsr.store import read_rows, sha256, sha256_files
from tsr.swaps import Swaps, load_swaps
from tsr.triggers import Reference, drift_gaps

ANALYSIS_FILES = (
    "tsr/config.py",
    "tsr/fair.py",
    "tsr/metrics.py",
    "tsr/swaps.py",
    "tsr/triggers.py",
    "tsr/stats.py",
    "experiments/common.py",
    "experiments/e1_census.py",
    "experiments/e2_recall.py",
)


def code_hash() -> str:
    """SHA-256 over the analysis files, in a fixed order; recorded in the pre-registration."""
    import hashlib

    h = hashlib.sha256()
    for f in ANALYSIS_FILES:
        h.update(f.encode())
        h.update((RESEARCH_ROOT / f).read_bytes())
    return h.hexdigest()


def _one(pattern: str) -> Path:
    found = sorted(DATA_DIR.glob(pattern))
    if len(found) != 1:
        raise FileNotFoundError(f"expected exactly one {pattern} in {DATA_DIR}, found {len(found)}")
    return found[0]


@dataclass(frozen=True)
class Data:
    sw: Swaps
    m: np.ndarray
    m15: np.ndarray
    tox: np.ndarray
    gaps: np.ndarray
    day: np.ndarray
    dev: np.ndarray
    held: np.ndarray
    inputs: dict[str, str]


def load() -> Data:
    pool = ETH_USDC_WETH_500
    swaps_path = _one(f"swaps_{pool.chain}_*.jsonl.gz")
    cl_path = _one("chainlink_eth_usd_*.jsonl.gz")
    eth = _one("binance_ETHUSDT_1s_*.npz")
    usdc = _one("binance_USDCUSDT_1s_*.npz")
    sw = load_swaps(swaps_path, pool)
    sw = sw.mask((sw.ts >= WINDOW_START) & (sw.ts < WINDOW_END))
    fair = FairPrice.load(eth, usdc)
    cl = list(read_rows(cl_path))
    ref = Reference(
        blocks=[int(str(r["block"])) for r in cl],
        answers=[int(str(r["answer"])) for r in cl],
        updated_at=[int(str(r["updatedAt"])) for r in cl],
        decimals=CHAINLINK_DECIMALS,
    )
    m = markout(sw, fair, SETTLE_DELAY, pool)
    return Data(
        sw=sw,
        m=m,
        m15=markout(sw, fair, LP_NET_HORIZON, pool),
        tox=toxic(m, sw.notional),
        gaps=drift_gaps(sw.block, sw.ts, sw.sqrt_price_before, sw.buys_risky, ref, REFERENCE_MAX_AGE, pool),
        day=(sw.ts // 86_400).astype(np.int64),
        dev=np.flatnonzero(sw.ts < SPLIT),
        held=np.flatnonzero(sw.ts >= SPLIT),
        inputs=sha256_files([swaps_path, cl_path, eth, usdc]),
    )


def write_result(name: str, body: dict[str, object]) -> Path:
    out = RESEARCH_ROOT / "results" / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    rev = subprocess.run(["uv", "--version"], capture_output=True, text=True, check=False).stdout.strip()
    body = {"code_sha256": code_hash(), "uv": rev, **body}
    out.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n")
    return out


def prereg_hash(experiment: str) -> str:
    return sha256(RESEARCH_ROOT / "prereg" / f"{experiment}.md")
