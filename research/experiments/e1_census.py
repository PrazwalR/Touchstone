"""E1 markout census, development window only (spec §16.4). Descriptive: where toxic markout sits by block
position, size and signed drift. Sets N0, N_min, h and tau by the pre-registered grid rule in tsr.metrics.select.
Never reads the held-out window."""

from __future__ import annotations

import sys

import numpy as np

from experiments.common import load, prereg_hash, write_result
from tsr.config import DEFAULT_TRIGGER, ETH_USDC_WETH_500
from tsr.metrics import TriggerGrid, grid, score, select

SIZE_EDGES = (0, 1_000, 5_000, 25_000, 100_000, 500_000)
DRIFT_EDGES = (-(10**9), 0, 2, 5, 10, 20)


def bucket_table(
    values: np.ndarray, edges: tuple[int, ...], tox: np.ndarray, vol: np.ndarray, m: np.ndarray
) -> list[dict[str, object]]:
    total_tox = float(tox.sum())
    rows: list[dict[str, object]] = []
    for i, lo in enumerate(edges):
        hi = edges[i + 1] if i + 1 < len(edges) else None
        sel = (values >= lo) & (values < hi) if hi is not None else values >= lo
        rows.append(
            {
                "from": lo,
                "to": hi,
                "swaps": int(sel.sum()),
                "volume": float(vol[sel].sum()),
                "markout": float(m[sel].sum()),
                "toxic": float(tox[sel].sum()),
                "toxic_share": float(tox[sel].sum() / total_tox) if total_tox else float("nan"),
            }
        )
    return rows


def main() -> int:
    pool = ETH_USDC_WETH_500
    d = load()
    idx = d.dev
    sw = d.sw
    unit = 10**pool.quote_decimals
    n_usd = sw.notional / unit

    # Position within the block: 0 for the block's first swap on this pool.
    pos = np.zeros(len(sw), dtype=np.int64)
    for i in range(1, len(sw)):
        pos[i] = pos[i - 1] + 1 if sw.block[i] == sw.block[i - 1] else 0
    first_mask = pos[idx] == 0

    tox, m, vol = d.tox[idx], d.m[idx], sw.notional[idx] / unit
    census = {
        "swaps": int(idx.size),
        "volume_usd": float(vol.sum()),
        "net_lp_markout_usd": float(m.sum() / unit),
        "toxic_markout_usd": float(tox.sum() / unit),
        "by_block_position": {
            "first_in_block": {"swaps": int(first_mask.sum()), "toxic_share": float(tox[first_mask].sum() / tox.sum())},
            "later_in_block": {
                "swaps": int((~first_mask).sum()),
                "toxic_share": float(tox[~first_mask].sum() / tox.sum()),
            },
        },
        "by_size_usd": bucket_table(n_usd[idx], SIZE_EDGES, tox, vol, m / unit),
        "by_signed_drift_bps": bucket_table(d.gaps[idx], DRIFT_EDGES, tox, vol, m / unit),
    }

    g = TriggerGrid(sw, d.gaps, pool)
    scores = {t: score(g.flagged(t), d.tox, sw.notional, idx) for t in grid()}
    chosen = select(scores)
    ranked = sorted(scores.items(), key=lambda ts: -ts[1].recall)
    write_result(
        "E1",
        {
            "experiment": "E1",
            "label": "historical backtest",
            "prereg_sha256": prereg_hash("E1"),
            "inputs_sha256": d.inputs,
            "window": "development",
            "census": census,
            "selected_trigger": {"n0": chosen[0], "n_min": chosen[1], "h": chosen[2], "tau_bps": chosen[3]},
            "selected_dev_score": scores[chosen].__dict__,
            "default_trigger_dev_score": scores[DEFAULT_TRIGGER].__dict__,
            "grid_size": len(scores),
            "top10_by_recall": [{"trigger": list(t), **s.__dict__} for t, s in ranked[:10]],
        },
    )
    print(f"E1 selected {chosen}: {scores[chosen]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
