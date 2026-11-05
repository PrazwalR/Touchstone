"""E10 first-arrival race on a constant-product pool. One eligible first touch per model block.

All candidate sizes exceed the trigger floor. Agents decide from the currently observable price.
Settlement and LP markout use separate later observations provided only after choosing the winner.
"""

from __future__ import annotations

import math
from dataclasses import astuple, dataclass

from simulations.freshness import BPS, Execution, Market, choose, execute


@dataclass(frozen=True)
class Terms:
    n0: float
    band_bps: float
    alpha_bps: float
    licensed_alpha_bps: float
    eps_bps: float
    delta_bps: float
    delta_max_bps: float
    beta: float
    tip_bps: float
    tip_cap: float
    rho_bps: float
    protocol_bps: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(v) for v in astuple(self)):
            raise ValueError("nonfinite licence terms")
        if self.n0 <= 0 or min(self.band_bps, self.beta, self.tip_cap) < 0:
            raise ValueError("invalid licence terms")
        if not 0 <= self.delta_bps <= self.delta_max_bps <= BPS:
            raise ValueError("invalid deposit rates")
        if any(not 0 <= v < BPS for v in (self.alpha_bps, self.licensed_alpha_bps, self.eps_bps)):
            raise ValueError("invalid retention rates")
        if any(not 0 <= v <= BPS for v in (self.tip_bps, self.rho_bps, self.protocol_bps)):
            raise ValueError("invalid payout shares")


@dataclass(frozen=True)
class Arrival:
    bidder: str
    latency: float
    hedge_bps: float
    gas: float


@dataclass(frozen=True)
class Fill:
    bidder: str
    market: Market
    profit: float
    lp_net: float
    retained: float
    exempt: bool


def alpha(in_band: bool, bidder: str, holder: str | None, terms: Terms) -> float:
    if holder is None or not in_band:
        return terms.alpha_bps
    return 0.0 if bidder == holder else terms.licensed_alpha_bps


def first_fill(
    market: Market,
    fair: float,
    settled: float,
    markout_price: float,
    sizes: list[float],
    arrivals: list[Arrival],
    holder: str | None,
    terms: Terms,
) -> Fill | None:
    if (
        not sizes
        or any(not math.isfinite(size) or size < terms.n0 for size in sizes)
        or not all(math.isfinite(p) and p > 0 for p in (fair, settled, markout_price))
    ):
        raise ValueError("need eligible sizes and positive price observations")
    if len({a.bidder for a in arrivals}) != len(arrivals) or any(
        not a.bidder or any(not math.isfinite(v) or v < 0 for v in (a.latency, a.hedge_bps, a.gas)) for a in arrivals
    ):
        raise ValueError("need distinct bidders with finite nonnegative latencies and costs")
    if holder == "":
        raise ValueError("holder must be named or absent")
    gap = abs(market.spot - fair) / fair * BPS
    buy = fair > market.spot
    in_band = gap <= terms.band_bps
    rate = min(terms.delta_max_bps, max(terms.delta_bps, terms.beta * gap))
    for agent in sorted(arrivals, key=lambda a: a.latency):
        weight = alpha(in_band, agent.bidder, holder, terms)
        leg: Execution | None = choose(market, fair, sizes, agent.hedge_bps, agent.gas, weight, terms.eps_bps, rate)
        if leg is None:
            continue
        exempt = holder == agent.bidder and in_band
        at_settlement = execute(market, settled, leg.notional, buy)
        settled_in_band = abs(market.spot - settled) / settled * BPS <= terms.band_bps
        settled_alpha = 0 if exempt else alpha(settled_in_band, agent.bidder, holder, terms)
        retained = min(
            rate / BPS * leg.notional,
            settled_alpha
            / BPS
            * max(0.0, at_settlement.itm_markout - terms.eps_bps / BPS * at_settlement.itm_notional),
        )
        # Execution markout already includes the LP fee. Only the distributable clawback is added.
        rest = (retained - min(terms.tip_cap, terms.tip_bps / BPS * retained)) * (1 - terms.protocol_bps / BPS)
        lp_net = -execute(market, markout_price, leg.notional, buy).markout + rest * (1 - terms.rho_bps / BPS)
        # The model hedges immediately at observed fair and pays the later realized retention.
        profit = leg.markout - agent.hedge_bps / BPS * leg.notional - agent.gas - retained
        return Fill(agent.bidder, leg.market, profit, lp_net, retained, exempt)
    return None


def clearing_rent(values: dict[str, float], reserve: float) -> tuple[str, float] | None:
    """A bidder's value is its incremental profit as holder for the lease term, in quote tokens."""
    if not math.isfinite(reserve) or reserve < 0 or any(not name or not math.isfinite(v) for name, v in values.items()):
        raise ValueError("invalid lease values")
    qualified = sorted(((v, name) for name, v in values.items() if v >= reserve), reverse=True)
    if not qualified:
        return None
    return qualified[0][1], qualified[1][0] if len(qualified) > 1 else reserve
