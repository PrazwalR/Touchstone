"""The exact reference reproduces the worked example and conserves on every split (spec §4.7, §4.12)."""

from __future__ import annotations

import touchstone_ref as t

USDC = 10**6


def test_worked_example_arbitrage_row() -> None:
    n = 500_000 * USDC
    d = t.deposit_quote(n, t.deposit_rate_bps(0, 0, 30, 300, 125, 300))
    assert d == 1_500 * USDC
    assert t.clawback_quote(d, 500 * USDC, n, 2, 0, 8000) == 320 * USDC


def test_split_conserves() -> None:
    for r in range(0, 1_500 * USDC + 1, 37 * USDC):
        p = t.split_retained(1_500 * USDC, r, 200, 5 * USDC, 500, 1000)
        assert t.check_payout(p, 1_500 * USDC, 0)


def test_break_even_recall() -> None:
    assert round(t.break_even_recall(8.5, 6.3, 6.3, 0.8, 2, 0.29), 3) == 0.451
