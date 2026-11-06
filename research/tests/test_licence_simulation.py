"""Analytic examples for the E10 race, not simulation verdicts."""

from dataclasses import replace

import pytest

from simulations.freshness import Market
from simulations.licence import Arrival, Fill, Terms, clearing_rent, first_fill


def test_first_profitable_arrival_wins_even_when_it_is_an_outsider() -> None:
    terms = Terms(100, 25, 8000, 9500, 2, 30, 300, 1.25, 200, 5, 1000, 0)
    market = Market(1000, 2_000_000, 5)
    fast, slow = Arrival("outside", 0.1, 0, 0), Arrival("holder", 0.2, 0, 0)

    def run(arrivals: list[Arrival], holder: str | None, settled: float) -> Fill | None:
        return first_fill(market, 2004, settled, 2004, [100], arrivals, holder, terms)

    outside = run([slow, fast], "holder", 2004)
    ordinary = run([slow, fast], None, 2004)
    exempt = run([slow], "holder", 2100)
    assert outside and ordinary and exempt
    assert outside.bidder == "outside" and outside.retained > ordinary.retained > 0
    assert exempt.exempt and exempt.retained == 0
    # Changing the later observation cannot change which agent the race admits.
    future = run([slow, fast], "holder", 2100)
    assert future and future.bidder == outside.bidder and future.market == outside.market


def test_reserve_nonparticipation_and_second_price() -> None:
    assert clearing_rent({"a": 2}, 3) is None
    assert clearing_rent({"a": 8}, 3) == ("a", 3)
    assert clearing_rent({"a": 8, "b": 6, "c": 2}, 3) == ("a", 6)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1.0])
def test_invalid_later_arrival_cannot_hide_behind_a_profitable_winner(bad: float) -> None:
    terms = Terms(100, 25, 8000, 9500, 2, 30, 300, 1.25, 200, 5, 1000, 0)
    with pytest.raises(ValueError):
        first_fill(
            Market(1000, 2_000_000, 5),
            2004,
            2004,
            2004,
            [100],
            [Arrival("fast", 0, 0, 0), Arrival("slow", 1, bad, 0)],
            None,
            terms,
        )


@pytest.mark.parametrize("field", ["n0", "band_bps", "beta", "tip_cap", "rho_bps", "protocol_bps"])
def test_nonfinite_terms_are_rejected_at_construction(field: str) -> None:
    terms = Terms(100, 25, 8000, 9500, 2, 30, 300, 1.25, 200, 5, 1000, 0)
    with pytest.raises(ValueError):
        replace(terms, **{field: float("nan")})


def test_invalid_size_is_rejected_even_without_arrivals() -> None:
    terms = Terms(100, 25, 8000, 9500, 2, 30, 300, 1.25, 200, 5, 1000, 0)
    with pytest.raises(ValueError):
        first_fill(Market(1000, 2_000_000, 5), 2004, 2004, 2004, [100, float("nan")], [], None, terms)
