"""Invalid observations and cached prices must not produce research verdicts."""

from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path

import pytest

import experiments.e4_basis as e4
import experiments.e34_common as common
from tsr.hermes import Hermes, HermesError, PythPrice, Tick, from_row, parse, to_row
from tsr.store import write_rows

BASE = "ee" * 32
QUOTE = "dd" * 32


def _tick(t: int) -> Tick:
    return Tick(t, PythPrice(3_000_00000000, 0, -8, t), PythPrice(1_00000000, 0, -8, t))


@pytest.mark.parametrize("gaps", [[], [float("nan")], [float("inf")], [-1.0]])
def test_e4_rejects_invalid_observations(gaps: list[float]) -> None:
    with pytest.raises(ValueError):
        e4.summarize(gaps, [1] * len(gaps), 3)


def test_e4_valid_observations_keep_the_existing_statistic() -> None:
    out = e4.summarize([0.5, 1.5, 2.5], [1, 1, 1], 3)
    assert out["median_gap_bps"] == 1.5
    assert out["median_gap_bps_ci95"] == [1.5, 1.5]
    assert out["swaps"] == 3


def test_result_writer_rejects_nonfinite_before_touching_existing_output(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(common, "RESULTS_DIR", tmp_path)
    monkeypatch.setattr(common, "e34_code_hash", lambda: "synthetic")
    out = tmp_path / "E4.json"
    out.write_text("existing result")
    with pytest.raises(ValueError):
        common.write_e34("E4", {"median": float("nan")})
    assert out.read_text() == "existing result"


@pytest.mark.parametrize(
    "field,value",
    [("conf", "-1"), ("expo", True), ("publish_time", True), ("price", "not-a-price"), ("price", "0")],
)
def test_live_prices_reject_invalid_values(field: str, value: object) -> None:
    p: dict[str, object] = {"price": "1", "conf": "0", "expo": -8, "publish_time": 100}
    p[field] = value
    body = {"parsed": [{"id": BASE, "price": p}, {"id": QUOTE, "price": p}]}
    with pytest.raises(HermesError):
        parse(body, 100, BASE, QUOTE)


@pytest.mark.parametrize(
    "row",
    [
        {"t": 100, "base": [1, 0, -8, 99], "quote": [1, 0, -8, 100]},
        {"t": 100, "base": [1, -1, -8, 100], "quote": [1, 0, -8, 100]},
        {"t": 100, "base": [True, 0, -8, 100], "quote": [1, 0, -8, 100]},
        {"t": 100, "base": [1, 0, -8], "quote": [1, 0, -8, 100]},
    ],
)
def test_cached_prices_are_as_strict_as_live_prices(row: dict[str, object]) -> None:
    with pytest.raises(HermesError):
        from_row(row)


def _hermes(base_id: str = BASE) -> Hermes:
    return Hermes("https://hermes.example", "Authorization", "unused", base_id, QUOTE, 2.0, 1, 1.0, 1)


def test_cache_identity_covers_every_requested_time_and_feed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def fake_get(self: Hermes, t: int, pacer: object) -> Tick:
        calls.append(t)
        return _tick(t)

    monkeypatch.setattr(Hermes, "_get", fake_get)
    assert set(_hermes().fetch([100, 101, 103], tmp_path)) == {100, 101, 103}
    assert set(_hermes().fetch([100, 102, 103], tmp_path)) == {100, 102, 103}
    _hermes("cc" * 32).fetch([100, 102, 103], tmp_path)
    assert len(calls) == 9
    assert len(list(tmp_path.glob("*.jsonl.gz"))) == 3


def test_cache_rejects_duplicate_or_missing_requested_ticks(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Hermes, "_get", lambda self, t, pacer: _tick(t))
    h = _hermes()
    h.fetch([100, 101], tmp_path)
    cache = next(tmp_path.glob("*.jsonl.gz"))
    write_rows(cache, [to_row(_tick(100)), to_row(_tick(100))])
    with pytest.raises(HermesError):
        h.fetch([100, 101], tmp_path)


def test_valid_cache_row_round_trips() -> None:
    tick = _tick(100)
    assert from_row(json.loads(json.dumps(to_row(tick)))) == tick


def _prereg(root: Path, name: str, status: str, digest: str) -> None:
    folder = root / "prereg"
    folder.mkdir(exist_ok=True)
    (folder / f"{name}.md").write_text(f"Status: **{status}**.\n\n| Analysis code hash | {digest} |\n")


@pytest.mark.parametrize("entrypoint", ["e3_settlement", "e4_basis", "fetch_pyth"])
def test_draft_experiment_exits_before_data_access(
    entrypoint: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(common, "RESEARCH_ROOT", tmp_path)
    monkeypatch.setattr(common, "e34_code_hash", lambda: "a" * 64)
    for name in ("E3", "E4"):
        _prereg(tmp_path, name, "draft, not frozen", "a" * 64)
    module = import_module(f"experiments.{entrypoint}")
    monkeypatch.setattr(module, "load_all", lambda: pytest.fail("must not read data under a draft pre-registration"))
    if entrypoint == "fetch_pyth":
        monkeypatch.setattr(module, "_env", lambda name: pytest.fail("must not initialize fetching under a draft"))
    else:
        monkeypatch.setattr(module, "write_e34", lambda *args: pytest.fail("must not write a result under a draft"))
    with pytest.raises(SystemExit, match="must be frozen"):
        module.main()
    assert not (tmp_path / "results").exists()


@pytest.mark.parametrize("digest", ["", "b" * 64])
def test_frozen_analysis_requires_its_current_hash(
    digest: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(common, "RESEARCH_ROOT", tmp_path)
    monkeypatch.setattr(common, "e34_code_hash", lambda: "a" * 64)
    _prereg(tmp_path, "E3", "frozen 30 October 2026", digest)
    with pytest.raises(SystemExit, match="analysis code hash"):
        common.require_frozen("E3")


def test_shared_fetch_requires_both_experiments_frozen(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(common, "RESEARCH_ROOT", tmp_path)
    monkeypatch.setattr(common, "e34_code_hash", lambda: "a" * 64)
    _prereg(tmp_path, "E3", "frozen 30 October 2026", "a" * 64)
    _prereg(tmp_path, "E4", "draft, not frozen", "a" * 64)
    with pytest.raises(SystemExit, match="E4: pre-registration must be frozen"):
        common.require_frozen("E3", "E4")
    _prereg(tmp_path, "E4", "frozen 30 October 2026", "a" * 64)
    common.require_frozen("E3", "E4")
