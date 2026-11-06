"""Runs E1 then E2 end to end on a small synthetic dataset, so the code paths are exercised before any
real data is read. The numbers mean nothing; only that the pipeline runs and writes its results."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

import experiments.common as common
import experiments.e1_census as e1
import experiments.e2_recall as e2
import tsr.config as config
from tsr.store import write_rows

Q96 = 1 << 96


def _sqrt_price(usd: float) -> int:
    # USDC is token0 (6 decimals), WETH token1 (18): raw price token1/token0 = 1e12 / usd.
    return int(math.sqrt(1e12 / usd) * Q96)


def _build(data: Path) -> None:
    rng = np.random.default_rng(7)
    days = (config.WINDOW_END - config.WINDOW_START) // 86_400 + 1
    seconds = days * 86_400
    eth = 3_000 * np.exp(np.cumsum(rng.normal(0, 2e-5, seconds)))
    np.savez_compressed(data / "binance_ETHUSDT_1s_x.npz", start=np.int64(config.WINDOW_START), close=eth)
    np.savez_compressed(data / "binance_USDCUSDT_1s_x.npz", start=np.int64(config.WINDOW_START), close=np.ones(seconds))
    rows = []
    block = 1_000
    for k in range(4_000):
        ts = config.WINDOW_START + 30 + k * ((config.WINDOW_END - config.WINDOW_START - 60) // 4_000)
        block += 1
        fair = float(eth[ts - config.WINDOW_START])
        usd = float(rng.lognormal(8.5, 1.5))
        buy = bool(rng.random() < 0.5)
        stale = fair * (1 + rng.normal(0, 4e-4))
        weth = usd / stale * 10**18
        amount0 = int(usd * 10**6) if buy else -int(usd * 10**6)
        amount1 = -int(weth) if buy else int(weth)
        rows.append(
            {
                "block": block,
                "ts": ts,
                "tx": f"0x{k:064x}",
                "txIndex": 0,
                "logIndex": 0,
                "amount0": amount0,
                "amount1": amount1,
                "sqrtPriceX96": _sqrt_price(stale),
                "liquidity": 10**18,
                "tick": 0,
            }
        )
    write_rows(data / "swaps_ethereum_1_2.jsonl.gz", rows)
    write_rows(
        data / "chainlink_eth_usd_1_2.jsonl.gz",
        [
            {
                "aggregator": "0x0",
                "block": b,
                "logIndex": 0,
                "answer": 3_000 * 10**8,
                "round": b,
                "updatedAt": config.WINDOW_START + (b - 1_000) * 1_200,
            }
            for b in range(1_000, 5_100, 40)
        ],
    )


def test_e1_then_e2_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = tmp_path / "data"
    data.mkdir()
    (tmp_path / "results").mkdir()
    _build(data)
    monkeypatch.setattr(common, "DATA_DIR", data)
    monkeypatch.setattr(common, "RESEARCH_ROOT", tmp_path)
    monkeypatch.setattr(common, "code_hash", lambda: "synthetic")
    monkeypatch.setattr(e2, "code_hash", lambda: "synthetic")
    monkeypatch.setattr(e1, "prereg_hash", lambda name: "synthetic")
    monkeypatch.setattr(e2, "prereg_hash", lambda name: "synthetic")
    monkeypatch.setattr(e2, "RESULTS_DIR", tmp_path / "results")
    assert e1.main() == 0
    assert e2.main() == 0
    out = json.loads((tmp_path / "results" / "E2.json").read_text())
    assert out["verdict"] in ("pass", "kill")
    assert out["inputs_sha256"]
