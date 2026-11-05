"""E4 oracle basis (spec §16.4): on a fixed-seed sample of flagged held-out swaps, the gap per unit notional
between the markout settled against Pyth and against Binance, at each Delta. Kill if the median gap at the
deployed settleDelay exceeds eps / 2."""

from __future__ import annotations

import sys
from math import isfinite

import numpy as np
import touchstone_ref as ref

from experiments.common import prereg_hash
from experiments.e34_common import inputs_sha256, load_all, load_pyth, require_frozen, write_e34
from tsr.config import BINANCE_SYMBOLS, BOOTSTRAP_REPS, DATA_DIR, ETH_USDC_WETH_500, SEED
from tsr.fair import FairPrice, base_units_price
from tsr.settle_config import E4_DECISION_DELTA, E4_DELTAS, E4_KILL_BPS, MAX_LAG
from tsr.stats import day_bootstrap

BPS = 10_000


def summarize(gaps: list[float], days: list[int], delta: int) -> dict[str, object]:
    """Reject invalid observations before a non-finite comparison can become a pass verdict."""
    g = np.array(gaps)
    if not gaps or len(gaps) != len(days) or not np.all(np.isfinite(g)) or np.any(g < 0):
        raise ValueError(f"E4 delta {delta}: expected nonempty, finite, nonnegative basis gaps and aligned days")

    def median_of(idx: np.ndarray) -> float:
        return float(np.median(g[idx]))

    ci = day_bootstrap(np.array(days), median_of, BOOTSTRAP_REPS, SEED + 10 + delta)
    med = float(np.median(g))
    p90 = float(np.percentile(g, 90))
    mean = float(g.mean())
    if not all(isfinite(v) for v in (*ci, med, p90, mean)):
        raise ValueError(f"E4 delta {delta}: basis statistics are not finite")
    return {
        "swaps": int(g.size),
        "median_gap_bps": med,
        "median_gap_bps_ci95": list(ci),
        "p90_gap_bps": p90,
        "mean_gap_bps": mean,
    }


def main() -> int:
    require_frozen("E4")
    if E4_DECISION_DELTA not in E4_DELTAS:
        raise ValueError("E4 decision delta is absent from the analysis deltas")
    pool = ETH_USDC_WETH_500
    data, ex, _, _, sample = load_all()
    pyth = load_pyth()
    eth, usdc = (next(DATA_DIR.glob(f"binance_{s}_1s_*.npz")) for s in BINANCE_SYMBOLS)
    fair = FairPrice.load(eth, usdc)

    per_delta: dict[str, object] = {}
    decision_median = float("nan")
    for d in E4_DELTAS:
        gaps: list[float] = []
        days: list[int] = []
        late = 0
        for i in (int(j) for j in sample):
            t = int(data.sw.ts[i]) + d
            k = pyth[t]
            if max(k.base.publish_time, k.quote.publish_time) > t + MAX_LAG:
                late += 1
                continue
            px = ref.fair_price_x36(
                k.base.price, k.base.expo, k.quote.price, k.quote.expo, pool.risky_decimals, pool.quote_decimals
            )
            m_pyth = ref.markout_quote(ex.x_risky[i], ex.x_quote[i], px)
            p_bin = float(base_units_price(fair.at(np.array([t])), pool)[0])
            m_bin = ex.x_risky[i] * p_bin + ex.x_quote[i]
            gaps.append(BPS * abs(m_pyth - m_bin) / abs(ex.x_quote[i]))
            days.append(int(data.day[i]))
        summary = summarize(gaps, days, d)
        per_delta[str(d)] = {**summary, "dropped_late_update": late}
        if d == E4_DECISION_DELTA:
            decision_median = float(np.median(gaps))

    if not isfinite(decision_median):
        raise ValueError("E4 decision median is not finite")
    killed = bool(decision_median > E4_KILL_BPS)
    write_e34(
        "E4",
        {
            "experiment": "E4",
            "label": "historical backtest",
            "prereg_sha256": prereg_hash("E4"),
            "inputs_sha256": inputs_sha256(data),
            "window": "held-out",
            "sample": int(sample.size),
            "decision_delta_s": E4_DECISION_DELTA,
            "kill_line_bps": E4_KILL_BPS,
            "by_delta_s": per_delta,
            "verdict": "kill" if killed else "pass",
        },
    )
    print(
        f"E4: median Pyth-Binance markout gap at {E4_DECISION_DELTA} s = {decision_median:.3f} bp "
        f"(kill above {E4_KILL_BPS}) -> {'KILL' if killed else 'PASS'}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
