"""E2 trigger recall, held-out window (spec §16.4, gate G1). Kill if held-out recall is below the pool's
break-even recall, or if held-out phi exceeds 0.30. Uses only the trigger E1 selected on the development
window; refuses to run if E1 was produced by different analysis code."""

from __future__ import annotations

import json
import sys

import numpy as np

from experiments.common import code_hash, load, prereg_hash, write_result
from tsr.config import (
    ALPHA_BPS,
    BOOTSTRAP_REPS,
    BPS_DENOM,
    DEFAULT_TRIGGER,
    ETH_USDC_WETH_500,
    PHI_MAX,
    REPORT_AVERAGE_R_STAR,
    RESULTS_DIR,
    SEED,
)
from tsr.metrics import TriggerGrid, break_even_recall, score
from tsr.stats import day_bootstrap

WEEK = 7 * 86_400


def main() -> int:
    e1 = json.loads((RESULTS_DIR / "E1.json").read_text())
    if e1["code_sha256"] != code_hash():
        raise SystemExit("E1 was produced by different analysis code; re-run E1 under the same pre-registration")
    s = e1["selected_trigger"]
    chosen = (int(s["n0"]), int(s["n_min"]), int(s["h"]), int(s["tau_bps"]))

    pool = ETH_USDC_WETH_500
    d = load()
    held = d.held
    g = TriggerGrid(d.sw, d.gaps, pool)
    flagged = g.flagged(chosen)
    sc = score(flagged, d.tox, d.sw.notional, held)
    r_star = break_even_recall(d.m, d.tox, held)
    alpha = ALPHA_BPS / BPS_DENOM
    r_star_15 = float(d.m15[held].sum()) / (alpha * float(d.tox[held].sum()))

    day = d.day[held]

    def recall_of(sub: np.ndarray) -> float:
        i = held[sub]
        t = d.tox[i]
        return float(t[flagged[i]].sum() / t.sum()) if t.sum() > 0 else float("nan")

    def r_star_of(sub: np.ndarray) -> float:
        return break_even_recall(d.m, d.tox, held[sub])

    recall_ci = day_bootstrap(day, recall_of, BOOTSTRAP_REPS, SEED)
    r_star_ci = day_bootstrap(day, r_star_of, BOOTSTRAP_REPS, SEED + 1)

    weeks = []
    t0 = int(d.sw.ts[held].min())
    for w in range(4):
        sub = np.flatnonzero((d.sw.ts[held] >= t0 + w * WEEK) & (d.sw.ts[held] < t0 + (w + 1) * WEEK))
        if sub.size == 0:
            continue
        ws = score(flagged, d.tox, d.sw.notional, held[sub])
        weeks.append({"week": w + 1, "swaps": int(sub.size), **ws.__dict__, "r_star": r_star_of(sub)})

    passed = bool(sc.recall >= r_star and sc.phi_count <= PHI_MAX)
    default_score = score(g.flagged(DEFAULT_TRIGGER), d.tox, d.sw.notional, held)
    write_result(
        "E2",
        {
            "experiment": "E2",
            "label": "historical backtest",
            "gate": "G1",
            "prereg_sha256": prereg_hash("E2"),
            "inputs_sha256": d.inputs,
            "window": "held-out",
            "trigger": list(chosen),
            "held_out": {
                "swaps": int(held.size),
                **sc.__dict__,
                "recall_ci95": list(recall_ci),
                "r_star": r_star,
                "r_star_ci95": list(r_star_ci),
                "r_star_lp_net_15s": r_star_15,
                "report_average_r_star": REPORT_AVERAGE_R_STAR,
                "net_lp_markout_usd": float(d.m[held].sum() / 10**pool.quote_decimals),
                "toxic_markout_usd": float(d.tox[held].sum() / 10**pool.quote_decimals),
            },
            "weekly": weeks,
            "default_trigger_held_out": default_score.__dict__,
            "verdict": "pass" if passed else "kill",
        },
    )
    verdict = "PASS" if passed else "KILL"
    print(f"E2 {chosen}: recall {sc.recall:.3f} vs r* {r_star:.3f}, phi {sc.phi_count:.3f} -> {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
