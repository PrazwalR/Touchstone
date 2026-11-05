"""Writes reference/vectors/trigger_vectors.json: cases the Foundry differential test replays through
PriceLib and FlowBucketLib, so the backtest's trigger port and the contracts cannot drift apart."""

from __future__ import annotations

import json
import random

import numpy as np

from tsr.config import RESEARCH_ROOT
from tsr.triggers import flow_hits, pool_price_x36, signed_gap_bps

SEED = 20_261_028
MIN_SQRT = 4_295_128_739
MAX_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342


def main() -> int:
    rnd = random.Random(SEED)
    gaps = []
    for _ in range(64):
        ref = rnd.randrange(1, 1 << rnd.choice([40, 80, 120, 200, 248]))
        pool = rnd.randrange(0, 1 << rnd.choice([40, 80, 120, 200, 248]))
        gap_buys = rnd.random() < 0.5
        gaps.append(
            {"ref": str(ref), "pool": str(pool), "buys": gap_buys, "out": str(signed_gap_bps(ref, pool, gap_buys))}
        )
    prices = []
    for _ in range(64):
        s = rnd.randrange(MIN_SQRT, MAX_SQRT)
        risky0 = rnd.random() < 0.5
        prices.append({"sqrt": str(s), "risky0": risky0, "out": str(pool_price_x36(s, risky0))})
    flows = []
    for _ in range(16):
        n_min = rnd.randrange(1, 10**12)
        h = rnd.randrange(1, 3_601)
        t = 1_000
        ts: list[int] = []
        ns: list[int] = []
        buys: list[bool] = []
        for _ in range(40):
            t += rnd.choice([0, 0, 1, 3, 12, 100])
            ts.append(t)
            ns.append(rnd.randrange(0, n_min))
            buys.append(rnd.random() < 0.5)
        # The expected hits come from the backtest's own port, which is what this differential tests.
        # A leading zero-notional step at t = 1,000 matches the contract test's starting timestamp.
        hits = flow_hits(np.array([1_000, *ts]), [0, *ns], np.array([True, *buys]), n_min, h)[1:]
        flows.append(
            {
                "nMin": str(n_min),
                "h": h,
                "t": ts,
                "n": [str(n) for n in ns],
                "buy": buys,
                "hits": [bool(x) for x in hits],
            }
        )
    out = RESEARCH_ROOT / "reference" / "vectors" / "trigger_vectors.json"
    out.write_text(json.dumps({"seed": SEED, "gaps": gaps, "prices": prices, "flows": flows}, indent=1) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
