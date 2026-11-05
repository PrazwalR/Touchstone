"""Draft E10 sequential races, with explicit lease rent and paired bidder counterfactuals.

Pure model functions only: no dataset loader or experiment verdict. Prices and arrivals must be
registered before a real run. Each observation is one block opportunity, with at most one fill.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise

from simulations.freshness import BPS, Market
from simulations.licence import Arrival, Terms, first_fill


@dataclass(frozen=True)
class Observation:
    timestamp: float
    fair: float
    settled: float
    markout_price: float
    arrivals: tuple[Arrival, ...]


@dataclass(frozen=True)
class PathResult:
    market: Market
    trader_profits: dict[str, float]
    lp_trading_income: float
    rent_paid: float
    lp_rent: float
    fills: int
    holder_fills: int
    mean_gap_bps: float
    duration: float

    @property
    def lp_income(self) -> float:
        return self.lp_trading_income + self.lp_rent

    @property
    def holder_win_rate(self) -> float | None:
        return self.holder_fills / self.fills if self.fills else None


def replay_path(
    initial: Market,
    observations: tuple[Observation, ...],
    end: float,
    sizes: list[float],
    terms: Terms,
    holder: str | None,
    rent_per_second: float,
    *,
    idle_holder: bool = False,
) -> PathResult:
    """Carry reserves across races; rent covers the entire explicitly funded lease interval.

    Freshness is the time-weighted post-race gap until the next observation. Rent is accounted
    separately and does not compound liquidity. An idle holder pays rent but never enters a race.
    """
    if not observations or not math.isfinite(end):
        raise ValueError("need a nonempty path and finite end time")
    if not math.isfinite(rent_per_second) or rent_per_second < 0:
        raise ValueError("invalid rent")
    if holder is None and (rent_per_second != 0 or idle_holder):
        raise ValueError("rent and idle-holder policy require a holder")
    times = [o.timestamp for o in observations] + [end]
    if any(not math.isfinite(t) or t < 0 for t in times) or any(b <= a for a, b in pairwise(times)):
        raise ValueError("observation times and end must strictly increase")
    market = initial
    profits: dict[str, float] = {}
    lp_trading_income = gap_seconds = 0.0
    fills = holder_fills = 0
    for index, row in enumerate(observations):
        interval = times[index + 1] - row.timestamp
        arrivals = list(row.arrivals)
        # Validate every agent before omitting an idle holder or short-circuiting at a winner.
        if any(
            not a.bidder
            or any(not math.isfinite(v) or v < 0 for v in (a.latency, a.hedge_bps, a.gas))
            or a.latency >= interval
            for a in arrivals
        ) or len({a.bidder for a in arrivals}) != len(arrivals):
            raise ValueError("arrivals must be distinct and fall inside their model block")
        for agent in arrivals:
            profits.setdefault(agent.bidder, 0.0)
        fill = first_fill(
            market,
            row.fair,
            row.settled,
            row.markout_price,
            sizes,
            [a for a in arrivals if not idle_holder or a.bidder != holder],
            holder,
            terms,
        )
        if fill is not None:
            market = fill.market
            profits[fill.bidder] += fill.profit
            lp_trading_income += fill.lp_net
            fills += 1
            holder_fills += int(fill.bidder == holder)
        gap_seconds += abs(market.spot - row.fair) / row.fair * BPS * interval
    duration = end - times[0]
    rent_paid = rent_per_second * duration
    if holder is not None:
        profits[holder] = profits.get(holder, 0.0) - rent_paid
    # Auction rent has no settlement tip; the protocol share precedes rebate funding.
    lp_rent = rent_paid * (1 - terms.protocol_bps / BPS) * (1 - terms.rho_bps / BPS)
    result = PathResult(
        market,
        profits,
        lp_trading_income,
        rent_paid,
        lp_rent,
        fills,
        holder_fills,
        gap_seconds / duration,
        duration,
    )
    if not all(math.isfinite(v) for v in (*profits.values(), result.lp_income, result.mean_gap_bps, rent_paid)):
        raise ValueError("nonfinite path accounting")
    return result


def bidder_value(
    initial: Market,
    observations: tuple[Observation, ...],
    end: float,
    sizes: list[float],
    terms: Terms,
    bidder: str,
    outsider_holder: str | None,
) -> float:
    """Incremental pre-rent profit on paired paths with an explicitly chosen outsider policy.

    None selects the plain clawback; a different name selects an opposing licence holder.
    The experiment must register which counterfactual it uses. Never infer it from outcomes.
    """
    if (
        not bidder
        or bidder == outsider_holder
        or not any(a.bidder == bidder for row in observations for a in row.arrivals)
    ):
        raise ValueError("need a participating bidder and a distinct outsider counterfactual")
    own = replay_path(initial, observations, end, sizes, terms, bidder, 0)
    outside = replay_path(initial, observations, end, sizes, terms, outsider_holder, 0)
    return own.trader_profits[bidder] - outside.trader_profits[bidder]
