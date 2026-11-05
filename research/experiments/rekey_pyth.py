"""Validate and copy legacy Pyth chunks after the renewed E3/E4 freeze, without inspecting metrics.

Legacy rows contain no feed IDs. A source manifest with hashes and feed provenance is mandatory;
filenames alone cannot establish which feeds were downloaded. Originals are retained for audit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from experiments.e34_common import load_all, requested_times, require_frozen
from tsr.hermes import HermesError, from_row
from tsr.settle_config import PYTH_ETH_USD, PYTH_USDC_USD
from tsr.store import read_rows, sha256


def rekey(cache: Path, manifest: Path, times: list[int], chunk_size: int = 100) -> list[dict[str, str]]:
    """Require attested source/feed identity and exact timestamp coverage before writing any copies."""
    require_frozen("E3", "E4")
    doc: object = json.loads(manifest.read_text())
    if not isinstance(doc, dict) or set(doc) != {"base_id", "quote_id", "chunks"}:
        raise ValueError("source manifest must contain base_id, quote_id and chunks")
    if doc["base_id"] != PYTH_ETH_USD or doc["quote_id"] != PYTH_USDC_USD:
        raise ValueError("source manifest feed IDs differ from the pre-registered feeds")
    chunks = doc["chunks"]
    if not isinstance(chunks, list) or chunk_size < 1:
        raise ValueError("invalid chunks or chunk size")
    ts = sorted(set(times))
    parts = {tuple(ts[i : i + chunk_size]) for i in range(0, len(ts), chunk_size)}
    plan: list[dict[str, str]] = []
    seen: set[tuple[int, ...]] = set()
    for item in chunks:
        if not isinstance(item, dict) or set(item) != {"file", "sha256"}:
            raise ValueError("each source needs a file and SHA-256")
        name, expected = item["file"], item["sha256"]
        if not isinstance(name, str) or Path(name).name != name or not isinstance(expected, str):
            raise ValueError("source must be a cache basename and hash")
        source = cache / name
        if source.is_symlink() or sha256(source) != expected:
            raise ValueError("legacy cache hash differs from source manifest")
        rows = [from_row(row) for row in read_rows(source)]
        part = tuple(sorted(row.t for row in rows))
        if part not in parts or part in seen:
            raise HermesError("legacy chunk coverage differs from the requested chunk partition")
        seen.add(part)
        identity = json.dumps([PYTH_ETH_USD, PYTH_USDC_USD, list(part)], separators=(",", ":")).encode()
        digest = hashlib.sha256(identity).hexdigest()[:16]
        target = cache / f"pyth_{part[0]}_{part[-1]}_{len(part)}_{digest}.jsonl.gz"
        if target.exists() and sha256(target) != expected:
            raise ValueError("target exists with different content; refusing overwrite")
        plan.append({"source": name, "target": target.name, "sha256": expected})
    for item in plan:
        source, target = cache / item["source"], cache / item["target"]
        if source != target and not target.exists():
            with target.open("xb") as out, source.open("rb") as inp:
                shutil.copyfileobj(inp, out)
    return plan


def main() -> None:
    require_frozen("E3", "E4")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--source-manifest", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    if args.receipt.exists():
        raise SystemExit("receipt already exists; refusing overwrite")
    data, _, _, flagged, sample = load_all()
    plan = rekey(args.cache, args.source_manifest, requested_times(data, flagged, sample))
    receipt = {
        "operation": "cache identity migration, no metric evaluation",
        "source_manifest_sha256": sha256(args.source_manifest), "copies": plan,
    }
    with args.receipt.open("x") as out:
        out.write(json.dumps(receipt, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
