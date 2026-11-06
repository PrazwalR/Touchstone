"""Synthetic accounting and causality checks; these are not E10 experiment results."""

from dataclasses import replace

import pytest

from simulations.freshness import BPS, Market
from simulations.licence import Arrival, Terms, first_fill
from simulations.licence_path import Observation, bidder_value, replay_path

TERMS = Terms(100, 25, 8000, 9500, 2, 30, 300, 1.25, 200, 5, 1000, 500)
MARKET = Market(1000, 2_000_000, 5)
ARRIVALS = (Arrival("a", 0.1, 0, 0), Arrival("b", 0.2, 0, 0))
PATH = (Observation(0, 2004, 2004, 2004, ARRIVALS), Observation(2, 2008, 2008, 2008, ARRIVALS))


def test_path_carries_reserves_and_weights_gap_by_elapsed_time() -> None:
    first = first_fill(MARKET, 2004, 2004, 2004, [100], list(ARRIVALS), None, TERMS)
    assert first
    second = first_fill(first.market, 2008, 2008, 2008, [100], list(ARRIVALS), None, TERMS)
    assert second
    result = replay_path(MARKET, PATH, 5, [100], TERMS, None, 0)
    assert result.market == second.market
    assert result.lp_income == pytest.approx(first.lp_net + second.lp_net)
    assert result.trader_profits["a"] == pytest.approx(first.profit + second.profit)
    assert result.trader_profits["b"] == 0
    expected = (abs(first.market.spot - 2004) / 2004 * 2 + abs(second.market.spot - 2008) / 2008 * 3) * BPS / 5
    assert result.mean_gap_bps == pytest.approx(expected)


def test_rent_is_paid_once_and_split_without_a_settler_tip() -> None:
    free = replay_path(MARKET, PATH, 5, [100], TERMS, "a", 0)
    paid = replay_path(MARKET, PATH, 5, [100], TERMS, "a", 2)
    assert paid.rent_paid == 10
    assert paid.lp_rent == pytest.approx(10 * 0.95 * 0.9)
    assert paid.lp_income - free.lp_income == pytest.approx(paid.lp_rent)
    assert free.trader_profits["a"] - paid.trader_profits["a"] == 10
    assert paid.market == free.market
    assert paid.holder_win_rate == 1


def test_idle_holder_keeps_paying_and_outsiders_can_trade() -> None:
    result = replay_path(MARKET, PATH, 5, [100], TERMS, "a", 2, idle_holder=True)
    assert result.holder_fills == 0 and result.fills == 2
    assert result.trader_profits["a"] == -10
    assert result.trader_profits["b"] > 0
    assert result.holder_win_rate == 0


def test_no_fills_has_no_invented_win_rate() -> None:
    row = Observation(0, 2000, 2000, 2000, ())
    result = replay_path(MARKET, (row,), 4, [100], TERMS, "idle", 2, idle_holder=True)
    assert result.fills == 0 and result.holder_win_rate is None
    assert result.mean_gap_bps == 0
    assert result.trader_profits == {"idle": -8}


def test_future_prices_change_payouts_but_never_execution_or_entry() -> None:
    future = tuple(replace(row, settled=row.fair * 1.1, markout_price=row.fair * 1.2) for row in PATH)
    original = replay_path(MARKET, PATH, 5, [100], TERMS, None, 0)
    changed = replay_path(MARKET, future, 5, [100], TERMS, None, 0)
    assert (changed.market, changed.fills, changed.mean_gap_bps) == (
        original.market,
        original.fills,
        original.mean_gap_bps,
    )
    assert changed.lp_income != original.lp_income


def test_bidder_value_uses_the_named_outsider_counterfactual_before_rent() -> None:
    own = replay_path(MARKET, PATH, 5, [100], TERMS, "a", 0)
    outsider = replay_path(MARKET, PATH, 5, [100], TERMS, "b", 0)
    assert bidder_value(MARKET, PATH, 5, [100], TERMS, "a", "b") == pytest.approx(
        own.trader_profits["a"] - outsider.trader_profits["a"]
    )
    assert bidder_value(MARKET, PATH, 5, [100], TERMS, "a", "b") > 0
    with pytest.raises(ValueError):
        bidder_value(MARKET, PATH, 5, [100], TERMS, "a", "a")


@pytest.mark.parametrize("end", [2, -1, float("nan"), float("inf")])
def test_invalid_intervals_rejected(end: float) -> None:
    with pytest.raises(ValueError):
        replay_path(MARKET, PATH, end, [100], TERMS, None, 0)


def test_invalid_idle_holder_arrival_is_still_rejected() -> None:
    row = replace(PATH[0], arrivals=(Arrival("a", 0, float("nan"), 0),))
    with pytest.raises(ValueError):
        replay_path(MARKET, (row,), 5, [100], TERMS, "a", 0, idle_holder=True)


def test_overlapping_and_late_arrivals_and_unowned_rent_rejected() -> None:
    for rows in ((PATH[1], PATH[0]), (PATH[0], PATH[0]), (replace(PATH[0], arrivals=(Arrival("a", 5, 0, 0),)),)):
        with pytest.raises(ValueError):
            replay_path(MARKET, rows, 5, [100], TERMS, None, 0)
    with pytest.raises(ValueError):
        replay_path(MARKET, PATH, 5, [100], TERMS, None, 1)
