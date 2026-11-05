"""Gzipped JSON-lines datasets and their SHA-256 manifest (spec §0.4: hash every input in every output)."""

from __future__ import annotations

import gzip
import hashlib
import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import cast

Row = dict[str, object]


def write_rows(path: Path, rows: Iterable[Row]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    n = 0
    # mtime=0 keeps the gzip header, and so the file hash, independent of when it was written.
    with tmp.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as gz:
        for row in rows:
            gz.write((json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n").encode())
            n += 1
    tmp.replace(path)
    return n


def read_rows(path: Path) -> Iterator[Row]:
    with gzip.open(path, "rt") as f:
        for line in f:
            yield cast(Row, json.loads(line))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_files(paths: Iterable[Path]) -> dict[str, str]:
    return {str(p): sha256(p) for p in sorted(paths)}
