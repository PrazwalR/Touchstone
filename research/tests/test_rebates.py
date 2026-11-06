"""Synthetic E11 cash-flow examples, not pool results."""

from fractions import Fraction as F

import pytest

from simulations.rebates import Budget, Leg, Position, active_shares


def test_coverage_in_deposit_currency_before_and_after_funding() -> None:
    quote, risky = Budget(), Budget()
    assert quote.gross_coverage is None
    quote.retain(20_000, 10_000, 200, 100, 2000, 1000)
    assert quote.balance == (10_000 - 100) * 80 // 100 // 10
    assert risky.benign(5000, 4_000_000, 500, 4000, 200, 1000) == 0
    rebate = quote.benign(5000, 4_000_000, 500, 4000, 200, 1000)
    assert quote.requested == 800
    assert rebate == 777
    assert quote.tips == 15
    assert quote.funding == quote.paid + quote.tips + quote.balance
    assert quote.gross_coverage == F(792, 800)
    assert risky.gross_coverage == 0


def test_wash_profit_depends_on_active_owner_and_available_budget() -> None:
    shares = active_shares(
        0, [Position("a", -1, 1, 40), Position("a", 0, 2, 30), Position("b", -1, 1, 30), Position("b", -1, 0, 100)]
    )
    assert shares["a"] == F(7, 10)

    def wash(share: F, rebate: int) -> F:
        return Leg(F(-5), F(5), share, F(0), F(rebate), F(0)).profit()

    assert wash(F(0), 2) == -3
    assert wash(F(3, 5), 2) == 0
    assert wash(shares["a"], 2) > 0
    assert wash(shares["a"], 0) < 0
    with pytest.raises(ValueError, match="undefined"):
        active_shares(2, [Position("a", -1, 2, 100)])
