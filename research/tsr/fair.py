"""Fair price P*(t) in quote base units per risky base unit, from Binance 1-second closes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from tsr.config import Pool


@dataclass(frozen=True)
class FairPrice:
    start: int
    usd: np.ndarray  # ETH in USDC per whole token, one value per second from `start`

    @classmethod
    def load(cls, eth_usdt: Path, usdc_usdt: Path) -> FairPrice:
        a = np.load(eth_usdt)
        b = np.load(usdc_usdt)
        if int(a["start"]) != int(b["start"]) or a["close"].size != b["close"].size:
            raise ValueError("Binance series are not aligned")
        return cls(start=int(a["start"]), usd=a["close"] / b["close"])

    def at(self, t: np.ndarray) -> np.ndarray:
        """Price standing at time t: the close of the 1-second candle that opened at t - 1."""
        i = t.astype(np.int64) - 1 - self.start
        if i.min() < 0 or i.max() >= self.usd.size:
            raise ValueError("markout time outside the Binance series")
        return np.asarray(self.usd[i])


def base_units_price(usd_per_token: np.ndarray, pool: Pool) -> np.ndarray:
    """Whole-token price to quote base units per risky base unit."""
    return usd_per_token * 10.0 ** (pool.quote_decimals - pool.risky_decimals)
