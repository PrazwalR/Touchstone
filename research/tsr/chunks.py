"""Resumable chunked log fetching: each finished chunk is cached on disk, so a failure late in a long ingest
loses one chunk, not the whole run. Cached chunks are plain inputs; the final dataset is hashed as usual."""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from tsr.store import Row, read_rows, write_rows

log = logging.getLogger("tsr.chunks")


def fetch_all(
    cache: Path, jobs: list[tuple[str, int, int]], fetch: Callable[[str, int, int], list[Row]], workers: int
) -> list[Row]:
    """Runs fetch(tag, start, end) for every job not already cached, then returns every row in job order."""
    cache.mkdir(parents=True, exist_ok=True)

    def path(job: tuple[str, int, int]) -> Path:
        return cache / f"{job[0]}_{job[1]}_{job[2]}.jsonl.gz"

    todo = [j for j in jobs if not path(j).exists()]
    log.info("%d chunks, %d cached, %d to fetch", len(jobs), len(jobs) - len(todo), len(todo))
    failed = 0
    with ThreadPoolExecutor(workers) as ex:
        futures = {ex.submit(fetch, *j): j for j in todo}
        for i, fut in enumerate(as_completed(futures), 1):
            job = futures[fut]
            try:
                write_rows(path(job), fut.result())
            except Exception as exc:  # one bad chunk must not discard the rest; a rerun retries it
                failed += 1
                log.warning("chunk %s failed: %s", job, exc)
            if i % 200 == 0:
                log.info("%d/%d chunks done, %d failed", i, len(todo), failed)
    if failed:
        raise RuntimeError(f"{failed} chunks failed; rerun to fetch only those")
    return [r for j in jobs for r in read_rows(path(j))]
