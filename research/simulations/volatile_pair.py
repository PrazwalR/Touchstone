"""E7 reading of the published VolatilePairHook fee specification (pin in prereg/E7.md).

Fees use the upstream worked-example configuration. Inputs are observed pre-swap sqrt
prices in currency1/currency0 orientation. A zero-for-one swap pays the bid.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import ceil

PIPS = 1_000_000
MAX_FEE = PIPS - 2
Q48 = 1 << 48


def move(new: int, previous: int) -> Fraction:
    """Absolute price displacement relative to the old price, with the spec's Q48 rounding."""
    ratio_squared = (min(new, previous) * Q48 // max(new, previous)) ** 2
    if new > previous:
        ratio_squared = max(ratio_squared, 1)
        return Fraction(Q48**2 - ratio_squared, ratio_squared)
    return Fraction(Q48**2 - ratio_squared, Q48**2)


@dataclass(frozen=True)
class FeeConfig:
    spread: int
    skew_rate: int
    max_step: int
    max_skew: int
    capture: int
    capture_threshold: int
    fade_rate: int
    max_fade: int
    restore_fraction: int
    restore_threshold: int


# Published worked example, in fee pips. A comparison on these terms does not
# establish that any particular deployed pool uses this configuration.
WORKED_EXAMPLE = FeeConfig(900, 100_000, 300, 900, 500_000, 1000, 50_000, 200, PIPS, 0)


class VolatilePair:
    def __init__(self, config: FeeConfig = WORKED_EXAMPLE) -> None:
        self.config = config
        self.block = -1
        self.open = 0
        self.ask = config.spread // 2
        self.temporary = 0
        self.temp_on_bid = False

    def fee(self, block: int, sqrt_price: int, zero_for_one: bool) -> int:
        if not 0 < sqrt_price < 1 << 160 or block < 0 or block < self.block:
            raise ValueError("expected ordered blocks and a positive uint160 sqrt price")
        cfg = self.config
        if block != self.block:
            if self.open:
                impact = move(sqrt_price, self.open)
                self.temp_on_bid = sqrt_price > self.open
                old = self.ask if self.temp_on_bid else cfg.spread - self.ask
                lean = min(old + min(ceil(cfg.skew_rate * impact), cfg.max_step), cfg.max_skew)
                self.ask = lean if self.temp_on_bid else cfg.spread - lean
                restore = ceil(Fraction(cfg.restore_fraction * (lean - old), PIPS))
                capture = ceil(cfg.capture * impact)
                self.temporary = min(
                    MAX_FEE,
                    (restore if impact * PIPS >= cfg.restore_threshold else 0)
                    + (capture if impact * PIPS >= cfg.capture_threshold else 0),
                )
            self.block, self.open = block, sqrt_price
        base = cfg.spread - self.ask if zero_for_one else self.ask
        if zero_for_one == self.temp_on_bid:
            base += self.temporary
        displacement = move(sqrt_price, self.open)
        against_move = zero_for_one == (sqrt_price > self.open)
        extra = (
            ceil(cfg.capture * displacement) if against_move else min(ceil(cfg.fade_rate * displacement), cfg.max_fade)
        )
        return min(MAX_FEE, base + extra)
