"""The E3 settlement ports: ItmLib.leg, PriceLib.sqrtPriceX96At, the payout path and the Hermes parser."""

from __future__ import annotations

import pytest
import touchstone_ref as ref

from tsr.hermes import HermesError, PythPrice, Tick, parse
from tsr.settle import (
    Amounts,
    Deposit,
    Params,
    amount0_delta,
    amount1_delta,
    deposit_at_swap,
    in_the_money,
    itm_leg,
    payout,
    price,
    sqrt_price_x96_at,
)
from tsr.triggers import pool_price_x36

# USDC (token0, 6 decimals) / WETH (token1, 18 decimals), as the E1 to E4 pool.
P_3000 = 3_000 * 10**6 * ref.PRICE_SCALE // 10**18
L = 4_500_000_000_000_000_000
FEE = 500
ETH = "ee" * 32
USD = "dd" * 32


def params(**kw: int) -> Params:
    base = dict(
        alpha_bps=8_000,
        eps_bps=2,
        max_conf_bps=25,
        max_lag=10,
        tip_bps=200,
        tip_cap_quote=25 * 10**6,
        protocol_bps=0,
        rho_bps=1_000,
        kappa_bps=4_000,
        fee_pips=FEE,
        quote_decimals=6,
        risky_decimals=18,
    )
    base.update(kw)
    return Params(quote_is_0=True, **base)


def tick(t: int, eth_usd: int, conf: int = 0, lag: int = 0) -> Tick:
    return Tick(t, PythPrice(eth_usd * 10**8, conf, -8, t + lag), PythPrice(10**8, 0, -8, t + lag))


def test_sqrt_price_round_trips_through_pool_price() -> None:
    sq = sqrt_price_x96_at(P_3000, risky_is_0=False)
    back = pool_price_x36(sq, risky_is_0=False)
    assert abs(back - P_3000) * 10**12 < P_3000


def test_itm_leg_is_the_whole_swap_when_it_stops_short_of_fair() -> None:
    before = sqrt_price_x96_at(P_3000, False)
    after = before * 9_990 // 10_000  # buying WETH: price in USDC per WETH rises, sqrt(token1/token0) falls
    fair = before * 9_900 // 10_000
    a0, a1, overshot = itm_leg(True, before, after, fair, L, FEE)
    assert not overshot
    net_in = amount0_delta(after, before, L, True)
    assert a0 == -ref_gross_up(net_in)
    assert a1 == amount1_delta(after, before, L, False)


def test_itm_leg_stops_at_fair_when_the_swap_overshoots() -> None:
    before = sqrt_price_x96_at(P_3000, False)
    fair = before * 9_990 // 10_000
    after = before * 9_900 // 10_000
    a0, a1, overshot = itm_leg(True, before, after, fair, L, FEE)
    assert overshot
    assert a1 == amount1_delta(fair, before, L, False)
    assert -a0 == ref_gross_up(amount0_delta(fair, before, L, True))


def test_itm_leg_is_empty_when_the_swap_starts_past_fair() -> None:
    before = sqrt_price_x96_at(P_3000, False)
    assert itm_leg(True, before, before * 99 // 100, before + 1, L, FEE) == (0, 0, True)
    assert itm_leg(False, before, before * 101 // 100, before - 1, L, FEE) == (0, 0, True)


def test_in_the_money_uses_the_swap_when_it_never_crossed_fair() -> None:
    assert in_the_money(5, -7, 100, 200, False, True) == (5, -7)


def test_in_the_money_preserves_the_specified_overshot_approximation() -> None:
    # The same distinct actual/reconstructed receipts select actuals only in the non-overshot branch.
    assert in_the_money(2, -300, -1_000, 4, False, True) == (2, -300)
    assert in_the_money(2, -300, -1_000, 4, True, True) == (4, -1_000)
    assert in_the_money(2, -300, 4, -1_000, True, False) == (4, -1_000)
    # Swaps starting past fair keep ItmLib's empty leg, rather than substituting full receipts.
    assert in_the_money(2, -300, 0, 0, True, True) == (0, 0)


def ref_gross_up(x: int) -> int:
    return -((-x * 1_000_000) // (1_000_000 - FEE))


def test_deposit_in_risky_matches_quote_then_conversion_rounding() -> None:
    n = 100_000 * 10**6
    d = deposit_at_swap(n, 0, 33 * 10**18, 30, 300, 125)
    assert d == Deposit(33 * 10**18 * 30 // 10_000, 300 * 10**6, False)
    d = deposit_at_swap(n, 400, -33 * 10**18, 30, 300, 125)
    assert d == Deposit(n * 300 // 10_000, n * 300 // 10_000, True)
    # Distinguish the contract's two floors from a single risky-amount multiplication.
    n, risky = 12_345, 4_567_890_123_456_789_012_345
    d = deposit_at_swap(n, 0, risky, 5, 300, 125)
    assert d == Deposit(2_220_116_706_418_852_496, 6, False)
    assert d.amount != risky * 5 // 10_000


def _arb(edge_bps: int) -> Amounts:
    """Sell $300,000 of USDC for WETH priced edge_bps below a $3,000 fair price."""
    before = sqrt_price_x96_at(P_3000 * (10_000 - edge_bps) // 10_000, False)
    xr = 300_000 * 10**18 * 10_000 // ((10_000 - edge_bps) * 3_000)
    return Amounts(xr, -300_000 * 10**6, before, before * 9_999 // 10_000, L)


DEP = Deposit(900 * 10**6, 900 * 10**6, True)
N = 300_000 * 10**6


def test_payout_conserves_the_deposit_and_caps_at_d() -> None:
    pr = price(_arb(50), tick(100, 3_000), 100, params())
    assert pr.kind == "ok"
    assert pr.markout_q > 0
    o = payout(pr, DEP, N, params(), 0)
    assert o.kind == "settled"
    assert o.retained_q == min(o.deposit_q, pr.uncapped_q)
    assert o.tip_q + o.protocol_q + o.to_rebate_pool_q + o.to_lps_q == o.retained_q
    small = Deposit(1, 1, True)
    assert payout(pr, small, N, params(), 0).cap_binds


def test_wide_confidence_refunds_and_a_late_update_expires() -> None:
    wide = price(_arb(50), tick(100, 3_000, conf=10 * 10**8), 100, params())
    assert wide.kind == "conf_refund"
    assert payout(wide, DEP, N, params(), 0).retained_q == 0
    late = price(_arb(50), tick(100, 3_000, lag=11), 100, params())
    o = payout(late, DEP, N, params(), 0)
    assert (o.kind, o.deposit_q, o.retained_q) == ("expired", DEP.quote_at_swap, 0)
    assert price(_arb(50), None, 100, params()).kind == "expired"


def test_benign_record_draws_its_rebate_from_the_pool() -> None:
    pr = price(_arb(-50), tick(100, 3_000), 100, params())  # bought above fair: the trader lost
    o = payout(pr, DEP, N, params(), 10**9)
    assert o.kind == "benign"
    gross = min(N * FEE * 4_000 // (10**6 * 10_000), 10**9)
    assert o.rebate_q + o.tip_q == gross
    assert payout(pr, DEP, N, params(), 0).rebate_q == 0


def _body(t: int, pt_eth: int, pt_usd: int, ids: tuple[str, str] = (ETH, USD)) -> object:
    def price(pt: int) -> dict[str, object]:
        return {"price": "300000000000", "conf": "100000", "expo": -8, "publish_time": pt}

    return {"parsed": [{"id": ids[0], "price": price(pt_eth)}, {"id": ids[1], "price": price(pt_usd)}]}


def test_hermes_parse_accepts_updates_at_or_after_t() -> None:
    k = parse(_body(10, 10, 11), 10, ETH, USD)
    assert (k.base.price, k.base.expo, k.quote.publish_time) == (300_000_000_000, -8, 11)


@pytest.mark.parametrize(
    "body",
    [
        _body(10, 9, 10),
        _body(10, 10, 10, (ETH, "cc" * 32)),
        {"parsed": [{"id": ETH, "price": {"price": 1, "conf": "0", "expo": -8, "publish_time": 10}}]},
        {"binary": {}},
    ],
)
def test_hermes_parse_rejects_untrusted_shapes(body: object) -> None:
    with pytest.raises(HermesError):
        parse(body, 10, ETH, USD)
