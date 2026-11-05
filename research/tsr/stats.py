"""Block bootstrap over days (spec §16.7)."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np


def day_bootstrap(day: np.ndarray, stat: Callable[[np.ndarray], float], reps: int, seed: int) -> tuple[float, float]:
    """95% interval of `stat` over swaps, resampling whole UTC days with replacement."""
    days = np.unique(day)
    groups = [np.flatnonzero(day == d) for d in days]
    rng = np.random.default_rng(seed)
    out = np.empty(reps)
    for k in range(reps):
        pick = rng.integers(0, days.size, days.size)
        idx = np.concatenate([groups[j] for j in pick])
        out[k] = stat(idx)
    lo, hi = np.nanpercentile(out, [2.5, 97.5])
    return float(lo), float(hi)
