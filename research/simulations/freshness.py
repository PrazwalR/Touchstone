"""E6 stylized constant-product price-response model, with explicit liquidity, cost and latency inputs.

Trade sizes are a preregistered grid. Markout and the fee are calculated from the model's actual
receipts. In-the-money markout stops at fair; fees and impact are not approximated by a linear tax.
This model is not v4 bytecode or concentrated-liquidity replay.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

BPS = 10_000


@dataclass(frozen=True)
class Market:
    risky: float
    quote: float
    fee_bps: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(v) for v in (self.risky, self.quote, self.fee_bps)):
            raise ValueError("nonfinite market")
        if self.risky <= 0 or self.quote <= 0 or not 0 <= self.fee_bps < BPS:
            raise ValueError("invalid market")

    @property
    def spot(self) -> float:
        return self.quote / self.risky


@dataclass(frozen=True)
class Execution:
    market: Market
    notional: float
    markout: float
    itm_markout: float
    itm_notional: float


def execute(m: Market, fair: float, quote_notional: float, buy: bool) -> Execution:
    """Quote notional means quote paid for a buy, quote received for a sell (same observable as E3)."""
    if not math.isfinite(fair) or fair <= 0 or not math.isfinite(quote_notional) or quote_notional <= 0:
        raise ValueError("invalid execution")
    rate = 1 - m.fee_bps / BPS
    k = m.risky * m.quote
    if buy:
        net = quote_notional * rate
        risky_out = m.risky - k / (m.quote + net)
        nxt = Market(m.risky - risky_out, m.quote + net, m.fee_bps)
        markout = risky_out * fair - quote_notional
        to_fair = max(0.0, math.sqrt(k * fair) - m.quote) / rate
    else:
        if quote_notional >= m.quote:
            raise ValueError("sell output exhausts quote liquidity")
        risky_in = (k / (m.quote - quote_notional) - m.risky) / rate
        nxt = Market(m.risky + risky_in * rate, m.quote - quote_notional, m.fee_bps)
        markout = quote_notional - risky_in * fair
        to_fair = max(0.0, m.quote - math.sqrt(k * fair))
    if to_fair <= 0:
        itm_m = itm_n = 0.0
    elif quote_notional <= to_fair:
        itm_m, itm_n = markout, quote_notional
    else:
        leg = execute(m, fair, to_fair, buy)
        itm_m, itm_n = leg.markout, to_fair
    return Execution(nxt, quote_notional, markout, itm_m, itm_n)


def choose(
    market: Market,
    fair: float,
    sizes: list[float],
    cost_bps: float,
    gas_quote: float,
    alpha_bps: float,
    eps_bps: float,
    deposit_bps: float,
) -> Execution | None:
    """Choose the grid trade with maximum post-retention profit; abstain at nonpositive profit."""
    values = (fair, cost_bps, gas_quote, alpha_bps, eps_bps, deposit_bps, *sizes)
    if not all(math.isfinite(v) for v in values) or fair <= 0 or cost_bps < 0 or gas_quote < 0:
        raise ValueError("invalid strategy")
    if not 0 <= alpha_bps < BPS or not 0 <= eps_bps < BPS or not 0 <= deposit_bps <= BPS:
        raise ValueError("invalid mechanism inputs")
    best: Execution | None = None
    best_profit = 0.0
    for size in sizes:
        leg = execute(market, fair, size, fair > market.spot)
        retained = min(
            size * deposit_bps / BPS, alpha_bps / BPS * max(0, leg.itm_markout - eps_bps / BPS * leg.itm_notional)
        )
        profit = leg.markout - retained - cost_bps / BPS * size - gas_quote
        if profit > best_profit:
            best, best_profit = leg, profit
    return best
