"""Analytical checks for behavioural simulation primitives; these are not experiment results."""

from __future__ import annotations

from dataclasses import asdict, replace
from pathlib import Path
from typing import cast

import pytest

from simulations.evasion import Trade, Trigger, flags, recall, split
from simulations.freshness import Market, choose, execute


def test_split_conservation_and_flow() -> None:
    trade = Trade(0, 1, "tx", 100_000, True, 8, 12345)
    pieces = split(trade, 4999, 0, 0)
    assert sum(t.notional for t in pieces) == trade.notional
    assert sum(t.toxic for t in pieces) == trade.toxic
    selected = flags(pieces, Trigger(5000, 50_000, 6, 2))
    assert not selected[0] and selected[-1]
    assert 0 < recall(pieces, selected) < 1
    assert flags([replace(t, exact_output=True) for t in pieces], Trigger(5000, 50_000, 6, 2)) == selected


def test_first_touch_and_bucket_drain() -> None:
    tape = [
        Trade(0, 1, "a", 5000, True, 0, 1),
        Trade(0, 1, "a", 5000, True, 0, 1),
        Trade(0, 1, "b", 5000, True, 0, 1),
        Trade(7, 2, "c", 1, True, 0, 1),
    ]
    assert flags(tape, Trigger(5000, 50_000, 6, 2)) == [True, True, False, False]
    with pytest.raises(ValueError, match="unordered"):
        flags(list(reversed(tape)), Trigger(5000, 50_000, 6, 2))


def test_constant_product_and_markout() -> None:
    market = Market(100, 200_000, 5)
    buy = execute(market, 2100, 1000, True)
    assert buy.market.risky * buy.market.quote == pytest.approx(market.risky * market.quote)
    assert buy.markout == pytest.approx((market.risky - buy.market.risky) * 2100 - 1000)
    assert buy.itm_markout == buy.markout
    assert execute(market, 1900, 1000, False).markout > 0
    overshot = execute(market, 2001, 1000, True)
    assert overshot.itm_notional < overshot.notional


def test_entry_cost_and_invalid_prices() -> None:
    m = Market(100, 200_000, 5)
    assert choose(m, 2000, [10, 100], 2, 0, 8000, 2, 300) is None
    assert choose(m, 2100, [100, 1000], 2, 0, 8000, 2, 300) is not None
    assert choose(m, 2100, [100, 1000], 2, 1e9, 8000, 2, 300) is None
    with pytest.raises(ValueError):
        execute(m, float("nan"), 100, True)


def test_runner_guard_stops_before_config_or_tape_access(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from experiments.behaviour import guard

    monkeypatch.setattr("experiments.behaviour.RESEARCH_ROOT", tmp_path)
    (tmp_path / "prereg").mkdir()
    (tmp_path / "prereg/E5.md").write_text("Status: **draft**")
    monkeypatch.setattr("experiments.behaviour.analysis_hash", lambda: "test")
    with pytest.raises(SystemExit, match="freeze"):
        guard("E5", tmp_path / "not-read.json")


def test_e5_runner_reports_both_windows_and_boundary_effects(tmp_path: Path) -> None:
    from experiments.behaviour import e5
    from tsr.store import write_rows

    tape = tmp_path / "tape.gz"
    write_rows(tape, [asdict(Trade(100, 1, "a", 100, True, 5, 1000)), asdict(Trade(200, 2, "b", 100, False, 5, 1000))])
    cfg: dict[str, object] = {
        "n0": 10,
        "n_min": 50,
        "horizon": 6,
        "tau_bps": 2,
        "r_star": -0.31,
        "delay_seconds": [0, 1],
        "block_seconds": 1,
        "padding_multipliers": [1, 2],
        "seed": 42,
        "bootstrap_reps": 10,
        "development_start": 100,
        "heldout_start": 200,
        "end": 201,
    }
    result = e5(cfg, tape)
    assert "no full E5 pass claim" in str(result["verdict"])
    assert "outside_window_records" in str(result)
    cfg["r_star"] = 1
    killed = e5(cfg, tape)
    assert killed["verdict"] == "kill"
    assert killed["heldout_kills"]


def test_e6_sensitivity_runner_and_nonfinite_inputs(tmp_path: Path) -> None:
    from experiments.behaviour import e6
    from tsr.store import write_rows

    tape = tmp_path / "prices.gz"
    write_rows(tape, [{"timestamp": i, "price": p} for i, p in enumerate([2000, 2010, 2005, 2020, 2015, 2000])])
    cfg: dict[str, object] = {
        "risky_reserve": 100,
        "quote_reserve": 200_000,
        "fee_bps": 5,
        "trade_sizes": [10, 100],
        "cost_bps": [2],
        "gas_quote": 0.01,
        "latency_seconds": [0, 1],
        "alpha_bps": 8000,
        "eps_bps": [2, 5],
        "deposit_bps": 300,
        "seed": 42,
        "bootstrap_reps": 10,
        "development_start": 0,
        "heldout_start": 3,
        "end": 5,
    }
    assert len(cast(list[object], e6(cfg, tape)["scenarios"])) == 4
    irregular = tmp_path / "irregular.gz"
    write_rows(irregular, [{"timestamp": i, "price": 2000} for i in [0, 1, 3, 4, 5]])
    with pytest.raises(ValueError, match="one-second"):
        e6(cfg, irregular)
    cfg["cost_bps"] = [float("nan")]
    with pytest.raises(ValueError, match="finite"):
        e6(cfg, tape)
