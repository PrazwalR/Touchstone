"""Downloads the Pyth updates E3 and E4 request from Hermes' timestamp endpoint and writes them as one hashed
dataset. Run only after E3.md and E4.md are frozen (spec §16.6). Reads HERMES_URL, HERMES_API_KEY and
HERMES_API_KEY_HEADER from the environment; the key value carries its scheme, for example "Bearer <key>"."""

from __future__ import annotations

import logging
import os
import sys

from experiments.e34_common import PYTH_GLOB, load_all, requested_times, require_frozen
from tsr.config import DATA_DIR
from tsr.hermes import Hermes, to_row
from tsr.settle_config import (
    HERMES_MAX_RETRIES,
    HERMES_RATE_PER_S,
    HERMES_TIMEOUT_S,
    HERMES_WORKERS,
    PYTH_ETH_USD,
    PYTH_USDC_USD,
)
from tsr.store import sha256, write_rows


def _env(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        raise SystemExit(f"{name} is not set")
    return v


def main() -> int:
    require_frozen("E3", "E4")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    url = _env("HERMES_URL")
    if not url.startswith("https://"):
        raise SystemExit("HERMES_URL must be https")
    hermes = Hermes(
        url=url.rstrip("/"),
        auth_header=_env("HERMES_API_KEY_HEADER"),
        auth_value=_env("HERMES_API_KEY"),
        base_id=PYTH_ETH_USD,
        quote_id=PYTH_USDC_USD,
        rate_per_s=HERMES_RATE_PER_S,
        workers=HERMES_WORKERS,
        timeout_s=HERMES_TIMEOUT_S,
        max_retries=HERMES_MAX_RETRIES,
    )
    data, _, _, flagged, sample = load_all()
    times = requested_times(data, flagged, sample)
    logging.info("%d flagged held-out swaps, %d in the E4 sample, %d Pyth times", flagged.size, sample.size, len(times))
    ticks = hermes.fetch(times, DATA_DIR / "cache" / "pyth")
    for old in DATA_DIR.glob(PYTH_GLOB):
        old.unlink()
    out = DATA_DIR / f"pyth_hermes_eth_usdc_{times[0]}_{times[-1]}.jsonl.gz"
    n = write_rows(out, (to_row(ticks[t]) for t in times))
    print(f"{n} Pyth times -> {out.name} sha256 {sha256(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
