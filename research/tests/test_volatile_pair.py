"""Synthetic protocol vectors. No historical E7 input is read."""

import pytest

from simulations.volatile_pair import MAX_FEE, VolatilePair, move


def test_reset_and_directional_fees() -> None:
    pair = VolatilePair()
    # Doubling sqrt price quadruples price. The capture term hits the fee ceiling.
    assert pair.fee(1, 100, False) == 450
    assert pair.fee(1, 200, False) == 650
    assert pair.fee(1, 200, True) == MAX_FEE
    assert pair.fee(2, 200, False) == 750
    assert pair.fee(2, 200, True) == MAX_FEE
    assert pair.fee(3, 200, False) == 750
    assert pair.fee(3, 200, True) == 150
    assert pair.fee(4, 100, True) == 450
    assert pair.fee(4, 100, False) == 375750
    with pytest.raises(ValueError, match="ordered"):
        pair.fee(1, 100, True)


def test_extreme_move_and_subthreshold_rounding() -> None:
    assert move(1 << 100, 1) == (1 << 96) - 1
    pair = VolatilePair()
    assert pair.fee(1, 10**12, True) == 450
    # Below capture threshold. Skew rounds up by a pip and restore adds it back.
    assert pair.fee(2, 10**12 + 1, False) == 451
    assert pair.fee(2, 10**12 + 1, True) == 450
