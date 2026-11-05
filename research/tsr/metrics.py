"""Markout, toxic markout, recall, flag share and break-even recall, as pre-registered in E1 and E2."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product

import numpy as np

from tsr.config import ALPHA_BPS, BPS_DENOM, EPS_BPS, GRID_H, GRID_N0, GRID_N_MIN, GRID_TAU, PHI_MAX, Pool
from tsr.fair import FairPrice, base_units_price
from tsr.swaps import Swaps
from tsr.triggers import first_touches, flow_hits


def markout(sw: Swaps, fair: FairPrice, horizon: int, pool: Pool) -> np.ndarray:
    """m = x_r * P*(t + horizon) + x_q in quote base units; positive means LPs lost m (spec §4.2)."""
    p = base_units_price(fair.at(sw.ts + horizon), pool)
    return np.asarray(sw.x_risky * p + sw.x_quote)


def toxic(m: np.ndarray, notional: np.ndarray) -> np.ndarray:
    """Markout net of fee and margin: max(0, m - eps * N) (spec §4.6)."""
    return np.maximum(0.0, m - EPS_BPS / BPS_DENOM * notional)


@dataclass(frozen=True)
class Score:
    recall: float
    phi_count: float
    phi_volume: float


def score(flagged: np.ndarray, tox: np.ndarray, notional: np.ndarray, idx: np.ndarray) -> Score:
    t = tox[idx]
    f = flagged[idx]
    total = float(t.sum())
    return Score(
        recall=float(t[f].sum() / total) if total > 0 else float("nan"),
        phi_count=float(f.mean()) if f.size else float("nan"),
        phi_volume=float(notional[idx][f].sum() / notional[idx].sum()) if f.size else float("nan"),
    )


def break_even_recall(m: np.ndarray, tox: np.ndarray, idx: np.ndarray) -> float:
    """r* = (net LP loss) / (alpha * total toxic markout), measured on the same swaps (E2 primary)."""
    denom = ALPHA_BPS / BPS_DENOM * float(tox[idx].sum())
    return float(m[idx].sum()) / denom if denom > 0 else float("nan")


Trigger = tuple[int, int, int, int]  # N0, N_min, h, tau, with dollar amounts in whole quote tokens


class TriggerGrid:
    """Precomputes every rule once per parameter it depends on, so the grid is cheap to search."""

    def __init__(self, sw: Swaps, gaps: np.ndarray, pool: Pool) -> None:
        self.sw = sw
        self.gaps = gaps
        self.unit = 10**pool.quote_decimals
        # Notionals are exact integers below 2^53 base units ($9 billion of USDC), so the float holds them exactly.
        self.notional_int = [int(n) for n in sw.notional]
        self._flow: dict[tuple[int, int], np.ndarray] = {}
        self._first: dict[int, np.ndarray] = {}

    def flagged(self, trig: Trigger) -> np.ndarray:
        n0, n_min, h, tau = trig
        key = (n_min, h)
        if key not in self._flow:
            self._flow[key] = flow_hits(self.sw.ts, self.notional_int, self.sw.buys_risky, n_min * self.unit, h)
        large = self.sw.notional >= n0 * self.unit
        if n0 not in self._first:
            self._first[n0] = first_touches(self.sw.block, self.sw.tx, large)
        return np.asarray(self._flow[key] | (large & (self._first[n0] | (self.gaps >= tau))))


def grid() -> list[Trigger]:
    return [(n0, nm, h, tau) for n0, nm, h, tau in product(GRID_N0, GRID_N_MIN, GRID_H, GRID_TAU) if nm >= n0]


def select(scores: dict[Trigger, Score]) -> Trigger:
    """Pre-registered rule: the highest development recall with phi_count <= PHI_MAX; ties go to the lower
    phi_count, then to the larger N0 (fewer retail swaps touched)."""
    ok = [(t, s) for t, s in scores.items() if s.phi_count <= PHI_MAX and not np.isnan(s.recall)]
    if not ok:
        raise ValueError("no trigger on the grid meets phi <= PHI_MAX on the development window")
    return max(ok, key=lambda ts: (ts[1].recall, -ts[1].phi_count, ts[0][0]))[0]
