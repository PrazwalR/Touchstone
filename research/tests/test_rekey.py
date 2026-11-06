"""Migration never guesses feed identity or overwrites a conflicting cache entry."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from experiments import rekey_pyth
from tsr.hermes import HermesError
from tsr.settle_config import PYTH_ETH_USD, PYTH_USDC_USD
from tsr.store import sha256, write_rows


def test_rekey_preserves_source_and_rejects_wrong_hash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rekey_pyth, "require_frozen", lambda *args: None)
    source = tmp_path / "legacy.jsonl.gz"
    write_rows(source, [{"t": 100, "base": [2, 0, 0, 100], "quote": [1, 0, 0, 100]}])
    manifest = tmp_path / "source.json"
    body = {"base_id": PYTH_ETH_USD, "quote_id": PYTH_USDC_USD,
            "chunks": [{"file": source.name, "sha256": sha256(source)}]}
    manifest.write_text(json.dumps(body))
    plan = rekey_pyth.rekey(tmp_path, manifest, [100])
    assert source.exists() and sha256(tmp_path / plan[0]["target"]) == sha256(source)
    body["chunks"] = [{"file": source.name, "sha256": "0" * 64}]
    manifest.write_text(json.dumps(body))
    with pytest.raises(ValueError, match="hash"):
        rekey_pyth.rekey(tmp_path, manifest, [100])


def test_rekey_rejects_duplicate_times_and_missing_provenance(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rekey_pyth, "require_frozen", lambda *args: None)
    source = tmp_path / "legacy.jsonl.gz"
    row = {"t": 100, "base": [2, 0, 0, 100], "quote": [1, 0, 0, 100]}
    write_rows(source, [row, row])
    manifest = tmp_path / "source.json"
    manifest.write_text(json.dumps({"base_id": PYTH_ETH_USD, "quote_id": PYTH_USDC_USD,
                                    "chunks": [{"file": source.name, "sha256": sha256(source)}]}))
    with pytest.raises(HermesError, match="coverage"):
        rekey_pyth.rekey(tmp_path, manifest, [100])
    manifest.write_text("{}")
    with pytest.raises(ValueError, match="manifest"):
        rekey_pyth.rekey(tmp_path, manifest, [100])


def test_rekey_checks_freeze_before_reading(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def deny(*args: str) -> None:
        raise SystemExit("draft")
    monkeypatch.setattr(rekey_pyth, "require_frozen", deny)
    with pytest.raises(SystemExit, match="draft"):
        rekey_pyth.rekey(tmp_path, tmp_path / "missing.json", [100])
