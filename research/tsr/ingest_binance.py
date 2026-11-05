"""Binance 1-second klines from the public daily dumps, verified against Binance's published SHA-256."""

from __future__ import annotations

import csv
import hashlib
import io
import logging
import time
import urllib.request
import zipfile
from datetime import UTC, datetime

import numpy as np

from tsr.config import BINANCE_DUMP, BINANCE_SYMBOLS, DATA_DIR, LP_NET_HORIZON, WINDOW_END, WINDOW_START

log = logging.getLogger("tsr.ingest_binance")
SECONDS_PER_DAY = 86_400


def _get(url: str) -> bytes:
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return bytes(r.read())
        except OSError:
            time.sleep(2**attempt)
    raise RuntimeError(f"download failed: {url}")


def day_closes(sym: str, day_start: int) -> np.ndarray:
    """Close prices for each second of one UTC day; NaN where Binance published no candle."""
    date = datetime.fromtimestamp(day_start, UTC).strftime("%Y-%m-%d")
    raw_path = DATA_DIR / "binance" / f"{sym}-1s-{date}.zip"
    url = BINANCE_DUMP.format(sym=sym, date=date)
    if not raw_path.exists():
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        blob = _get(url)
        expected = _get(url + ".CHECKSUM").decode().split()[0]
        if hashlib.sha256(blob).hexdigest() != expected:
            raise RuntimeError(f"checksum mismatch for {url}")
        raw_path.write_bytes(blob)
    out = np.full(SECONDS_PER_DAY, np.nan)
    with zipfile.ZipFile(raw_path) as z:
        name = z.namelist()[0]
        with z.open(name) as f:
            for row in csv.reader(io.TextIOWrapper(f)):
                if not row or not row[0].isdigit():
                    continue
                open_time = int(row[0])
                # Binance spot dumps moved to microsecond timestamps on 1 January 2025.
                seconds = open_time // 1_000_000 if open_time > 10**14 else open_time // 1_000
                i = seconds - day_start
                if 0 <= i < SECONDS_PER_DAY:
                    out[i] = float(row[4])
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # One extra day covers markouts of swaps in the window's last seconds.
    last_day = WINDOW_END + SECONDS_PER_DAY
    days = range(WINDOW_START, last_day, SECONDS_PER_DAY)
    for sym in BINANCE_SYMBOLS:
        series = np.concatenate([day_closes(sym, d) for d in days])
        missing = int(np.isnan(series).sum())
        # Forward-fill: a second with no trades keeps the last traded price.
        idx = np.where(~np.isnan(series), np.arange(series.size), 0)
        np.maximum.accumulate(idx, out=idx)
        filled = series[idx]
        out = DATA_DIR / f"binance_{sym}_1s_{WINDOW_START}_{last_day}.npz"
        np.savez_compressed(out, start=np.int64(WINDOW_START), close=filled)
        log.info("%s: %d seconds, %d without a candle, horizon check %ds", sym, series.size, missing, LP_NET_HORIZON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
