"""A pool's swaps as numpy arrays, in trader-side units (spec §2.1 BalanceDelta convention)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from tsr.config import Pool
from tsr.store import read_rows


@dataclass(frozen=True)
class Swaps:
    block: np.ndarray
    ts: np.ndarray
    tx: list[str]
    x_quote: np.ndarray  # quote base units the trader received; negative if paid (fee included)
    x_risky: np.ndarray
    sqrt_price_after: list[int]
    sqrt_price_before: list[int]  # the previous swap's post price; v3 liquidity events do not move price

    @property
    def notional(self) -> np.ndarray:
        return np.abs(self.x_quote)

    @property
    def buys_risky(self) -> np.ndarray:
        return self.x_risky > 0

    def __len__(self) -> int:
        return int(self.block.size)

    def mask(self, keep: np.ndarray) -> Swaps:
        idx = np.flatnonzero(keep)
        return Swaps(
            block=self.block[idx],
            ts=self.ts[idx],
            tx=[self.tx[i] for i in idx],
            x_quote=self.x_quote[idx],
            x_risky=self.x_risky[idx],
            sqrt_price_after=[self.sqrt_price_after[i] for i in idx],
            sqrt_price_before=[self.sqrt_price_before[i] for i in idx],
        )


def load_swaps(path: Path, pool: Pool) -> Swaps:
    rows = list(read_rows(path))
    # The first swap has no known pre-swap price, so it is dropped rather than guessed.
    rows = rows[1:] if rows else rows
    prev = [int(str(r["sqrtPriceX96"])) for r in read_rows(path)]
    a0 = np.array([float(int(str(r["amount0"]))) for r in rows])
    a1 = np.array([float(int(str(r["amount1"]))) for r in rows])
    # v3 Swap amounts are from the pool's side; the trader receives their negation.
    xq, xr = (-a0, -a1) if pool.quote_is_0 else (-a1, -a0)
    return Swaps(
        block=np.array([int(str(r["block"])) for r in rows], dtype=np.int64),
        ts=np.array([int(str(r["ts"])) for r in rows], dtype=np.int64),
        tx=[str(r["tx"]) for r in rows],
        x_quote=xq,
        x_risky=xr,
        sqrt_price_after=prev[1:],
        sqrt_price_before=prev[:-1],
    )
