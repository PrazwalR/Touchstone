"""What E3 and E4 share: their analysis-code hash, the exact integer swap amounts, the flagged held-out swaps
under the E1 trigger, the E4 sample and the Pyth times both experiments request. experiments/common.py is
part of the frozen E1 and E2 hash, so it is reused, not edited."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from experiments.common import ANALYSIS_FILES, Data, _one, code_hash, load
from tsr.config import ETH_USDC_WETH_500, RESEARCH_ROOT, RESULTS_DIR, SEED, SPLIT, WINDOW_END, WINDOW_START
from tsr.hermes import Tick, from_row
from tsr.metrics import Trigger, TriggerGrid
from tsr.settle_config import E4_DELTAS, E4_SAMPLE, SETTLE_DELAY
from tsr.store import read_rows, sha256

E34_FILES = (
    *ANALYSIS_FILES,
    "reference/touchstone_ref.py",
    "tsr/settle_config.py",
    "tsr/hermes.py",
    "tsr/settle.py",
    "experiments/e34_common.py",
    "experiments/fetch_pyth.py",
    "experiments/rekey_pyth.py",
    "experiments/e3_settlement.py",
    "experiments/e4_basis.py",
)

PYTH_GLOB = "pyth_hermes_eth_usdc_*.jsonl.gz"


def e34_code_hash() -> str:
    """SHA-256 over the E3 and E4 analysis files, in a fixed order; recorded in their pre-registrations."""
    h = hashlib.sha256()
    for f in E34_FILES:
        h.update(f.encode())
        h.update((RESEARCH_ROOT / f).read_bytes())
    return h.hexdigest()


def require_frozen(*experiments: str) -> None:
    """Refuse data access under a draft or stale analysis hash; Git chronology still requires owner review."""
    expected = e34_code_hash()
    for name in experiments:
        path = RESEARCH_ROOT / "prereg" / f"{name}.md"
        try:
            document = path.read_text()
        except OSError as exc:
            raise SystemExit(f"{name}: pre-registration is missing or unreadable") from exc
        if not re.search(r"^Status:\s*\*\*frozen\b", document, re.IGNORECASE | re.MULTILINE):
            raise SystemExit(f"{name}: pre-registration must be frozen and committed before data access")
        field = re.search(r"^\|\s*Analysis code hash\s*\|\s*(.*?)\s*\|\s*$", document, re.IGNORECASE | re.MULTILINE)
        digest = re.fullmatch(r"(?:SHA-256\s*)?`?([0-9a-fA-F]{64})`?", field[1]) if field else None
        if digest is None or digest[1].lower() != expected:
            raise SystemExit(f"{name}: frozen analysis code hash is absent or differs from the current code")


@dataclass(frozen=True)
class Exact:
    """Integer swap amounts and pool state, aligned index for index with Data.sw."""

    x_quote: list[int]
    x_risky: list[int]
    sqrt_before: list[int]
    sqrt_after: list[int]
    liquidity_before: list[int]


def exact_amounts(data: Data) -> Exact:
    """Re-reads the swap file with Python integers (WETH amounts exceed 2^53), applying the same drop of the
    first row and the same window mask as experiments.common.load. Pre-swap liquidity is the previous swap's
    post-swap liquidity, the same approximation as the pre-swap price."""
    pool = ETH_USDC_WETH_500
    rows = list(read_rows(_one(f"swaps_{pool.chain}_*.jsonl.gz")))
    prev, cur = rows[:-1], rows[1:]
    keep = [WINDOW_START <= int(str(r["ts"])) < WINDOW_END for r in cur]
    sel = [i for i, k in enumerate(keep) if k]
    a0 = [-int(str(cur[i]["amount0"])) for i in sel]
    a1 = [-int(str(cur[i]["amount1"])) for i in sel]
    xq, xr = (a0, a1) if pool.quote_is_0 else (a1, a0)
    ex = Exact(
        x_quote=xq,
        x_risky=xr,
        sqrt_before=[int(str(prev[i]["sqrtPriceX96"])) for i in sel],
        sqrt_after=[int(str(cur[i]["sqrtPriceX96"])) for i in sel],
        liquidity_before=[int(str(prev[i]["liquidity"])) for i in sel],
    )
    if len(ex.x_quote) != len(data.sw) or any(
        int(data.sw.ts[i]) != int(str(cur[sel[i]]["ts"])) for i in range(0, len(sel), 997)
    ):
        raise ValueError("exact amounts are not aligned with the loaded swaps")
    return ex


def e1_trigger() -> Trigger:
    e1 = json.loads((RESULTS_DIR / "E1.json").read_text())
    if e1["code_sha256"] != code_hash():
        raise SystemExit("E1 was produced by different analysis code")
    s = e1["selected_trigger"]
    return int(s["n0"]), int(s["n_min"]), int(s["h"]), int(s["tau_bps"])


def flagged_held(data: Data, trig: Trigger) -> np.ndarray:
    """Indices of held-out swaps the E1 trigger flags, in chain order."""
    f = TriggerGrid(data.sw, data.gaps, ETH_USDC_WETH_500).flagged(trig)
    held = np.flatnonzero(data.sw.ts >= SPLIT)
    out: np.ndarray = held[f[held]]
    return out


def e4_sample(flagged: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng(SEED)
    picked: np.ndarray = rng.choice(flagged, size=min(E4_SAMPLE, flagged.size), replace=False)
    return np.sort(picked)


def requested_times(data: Data, flagged: np.ndarray, sample: np.ndarray) -> list[int]:
    ts = {int(t) + SETTLE_DELAY for t in data.sw.ts[flagged]}
    ts |= {int(t) + d for t in data.sw.ts[sample] for d in E4_DELTAS}
    return sorted(ts)


def pyth_path() -> Path:
    return _one(PYTH_GLOB)


def load_pyth() -> dict[int, Tick]:
    return {k.t: k for k in (from_row(r) for r in read_rows(pyth_path()))}


def load_all() -> tuple[Data, Exact, Trigger, np.ndarray, np.ndarray]:
    data = load()
    trig = e1_trigger()
    flagged = flagged_held(data, trig)
    return data, exact_amounts(data), trig, flagged, e4_sample(flagged)


def inputs_sha256(data: Data) -> dict[str, str]:
    p = pyth_path()
    return {**data.inputs, str(p): sha256(p)}


def write_e34(name: str, body: dict[str, object]) -> Path:
    out = RESULTS_DIR / f"{name}.json"
    rev = subprocess.run(["uv", "--version"], capture_output=True, text=True, check=False).stdout.strip()
    out.write_text(
        json.dumps({"code_sha256": e34_code_hash(), "uv": rev, **body}, indent=2, sort_keys=True, allow_nan=False)
        + "\n"
    )
    return out
