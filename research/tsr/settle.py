"""Settlement replay for E3: each flagged swap becomes a record, settled against the first Pyth update at or
after t + Delta. Arithmetic ports use integers; currency pooling, execution-type assumptions and
settlement ordering remain approximations documented in the E3 pre-registration and decision 0052.

Settlement is split in two so E3 can search deposit parameters cheaply: `price` does everything that does not
depend on the deposit (P*, confidence, markout, in-the-money leg, toxic markout), once per record, and `payout`
applies a deposit size and the payout split.

Ports of ItmLib.leg and PriceLib.sqrtPriceX96At live here because the reference module predates in-the-money
accounting; tests/test_settle.py pins them against hand-checked cases."""

from __future__ import annotations

from dataclasses import dataclass
from math import isqrt

import touchstone_ref as ref

from tsr.hermes import Tick

Q96 = 2**96
PIPS = 1_000_000


def _mul_div_up(a: int, b: int, d: int) -> int:
    return -((-a * b) // d)


def amount0_delta(a: int, b: int, liquidity: int, round_up: bool) -> int:
    """SqrtPriceMath.getAmount0Delta."""
    lo, hi = min(a, b), max(a, b)
    n1, n2 = liquidity << 96, hi - lo
    if round_up:
        return -((-_mul_div_up(n1, n2, hi)) // lo)
    return (n1 * n2 // hi) // lo


def amount1_delta(a: int, b: int, liquidity: int, round_up: bool) -> int:
    """SqrtPriceMath.getAmount1Delta."""
    lo, hi = min(a, b), max(a, b)
    return _mul_div_up(liquidity, hi - lo, Q96) if round_up else liquidity * (hi - lo) // Q96


def sqrt_price_x96_at(price_x36: int, risky_is_0: bool) -> int:
    """PriceLib.sqrtPriceX96At."""
    num, den = (price_x36, ref.PRICE_SCALE) if risky_is_0 else (ref.PRICE_SCALE, price_x36)
    if num // den < 1 << 64:
        return isqrt(num * (1 << 192) // den)
    return isqrt(num * (1 << 128) // den) << 32


def itm_leg(
    zero_for_one: bool, sqrt_before: int, sqrt_after: int, sqrt_fair: int, liquidity: int, fee_pips: int
) -> tuple[int, int, bool]:
    """ItmLib.leg: the trader's (amount0, amount1) for the part of the swap executed before price crossed P*,
    and whether the swap overshot P*."""
    if zero_for_one:
        if sqrt_fair >= sqrt_before:
            return 0, 0, True
        end = max(sqrt_after, sqrt_fair)
        net_in = amount0_delta(end, sqrt_before, liquidity, True)
        out = amount1_delta(end, sqrt_before, liquidity, False)
        return -_mul_div_up(net_in, PIPS, PIPS - fee_pips), out, sqrt_after < sqrt_fair
    if sqrt_fair <= sqrt_before:
        return 0, 0, True
    end = min(sqrt_after, sqrt_fair)
    net_in = amount1_delta(sqrt_before, end, liquidity, True)
    out = amount0_delta(sqrt_before, end, liquidity, False)
    return out, -_mul_div_up(net_in, PIPS, PIPS - fee_pips), sqrt_after > sqrt_fair


def in_the_money(x_risky: int, x_quote: int, a0: int, a1: int, overshot: bool, quote_is_0: bool) -> tuple[int, int]:
    """Actual receipts unless the swap overshot P*, then the constant-liquidity leg (spec settlement).

    The overshot leg can exceed actual receipts across initialized ticks. The specification acknowledges
    that approximation; applying a receipt-based clamp here would replay a different contract mechanism.
    ItmLib also returns an empty leg when the swap starts past fair, which remains empty here."""
    if not overshot:
        return x_risky, x_quote
    return (a1, a0) if quote_is_0 else (a0, a1)


@dataclass(frozen=True)
class Params:
    alpha_bps: int
    eps_bps: int
    max_conf_bps: int
    max_lag: int
    tip_bps: int
    tip_cap_quote: int
    protocol_bps: int
    rho_bps: int
    kappa_bps: int
    fee_pips: int
    quote_decimals: int
    risky_decimals: int
    quote_is_0: bool


@dataclass(frozen=True)
class Amounts:
    """One flagged swap: trader-side receipts in base units and the pool state the hook recorded."""

    x_risky: int
    x_quote: int
    sqrt_before: int
    sqrt_after: int
    liquidity_before: int


@dataclass(frozen=True)
class Priced:
    """Everything about a record's settlement that does not depend on its deposit."""

    kind: str  # "ok", "conf_refund" (confidence above maxConfBps) or "expired" (no update within maxLag)
    price_x36: int
    markout_q: int  # m = x_r * P* + x_q, full swap
    toxic_q: int  # max(0, m+ - eps_eff * N+), in-the-money leg
    uncapped_q: int  # alpha * toxic, before the min with the deposit


def price(a: Amounts, tick: Tick | None, t0: int, p: Params) -> Priced:
    """Settler._payout up to the clawback, for a continuous record; licence regime off (§0.1), closure off (M6)."""
    if tick is None or max(tick.base.publish_time, tick.quote.publish_time) > t0 + p.max_lag:
        return Priced("expired", 0, 0, 0, 0)
    b, q = tick.base, tick.quote
    px = ref.fair_price_x36(b.price, b.expo, q.price, q.expo, p.risky_decimals, p.quote_decimals)
    conf = ref.conf_bps_up(b.price, b.conf, q.price, q.conf)
    m = ref.markout_quote(a.x_risky, a.x_quote, px)
    if conf > p.max_conf_bps:
        return Priced("conf_refund", px, m, 0, 0)
    zero_for_one = (a.x_quote < 0) if p.quote_is_0 else (a.x_risky < 0)
    a0, a1, overshot = itm_leg(
        zero_for_one,
        a.sqrt_before,
        a.sqrt_after,
        sqrt_price_x96_at(px, not p.quote_is_0),
        a.liquidity_before,
        p.fee_pips,
    )
    leg_r, leg_q = in_the_money(a.x_risky, a.x_quote, a0, a1, overshot, p.quote_is_0)
    m_plus = ref.markout_quote(leg_r, leg_q, px)
    toxic = max(0, m_plus - ((p.eps_bps + conf) * abs(leg_q)) // ref.BPS)
    return Priced("ok", px, m, toxic, (p.alpha_bps * toxic) // ref.BPS)


@dataclass(frozen=True)
class Deposit:
    amount: int  # in the deposit currency
    quote_at_swap: int  # D_quote as the hook computed it
    is_quote: bool


def deposit_at_swap(notional_q: int, gap_bps: int, x_risky: int, delta: int, delta_max: int, beta_x100: int) -> Deposit:
    """DepositLib: rate = min(delta_max, max(delta, beta * g+)), taken in the unspecified currency.

    v3 logs do not say whether a swap was exact input or exact output; every swap is treated as exact input,
    so the unspecified currency is the one the trader received. Match DepositLib's two rounding steps:
    floor the quote deposit, then convert it at the swap's execution price."""
    rate = ref.deposit_rate_bps(ref.MODE_CONTINUOUS, gap_bps, delta, delta_max, beta_x100, 0)
    dq = ref.deposit_quote(notional_q, rate)
    if x_risky <= 0:
        return Deposit(dq, dq, True)
    return Deposit(dq * abs(x_risky) // notional_q, dq, False)


@dataclass(frozen=True)
class Outcome:
    """A record's payout, every amount in quote base units at P*."""

    kind: str  # "settled", "benign", "conf_refund" or "expired"
    deposit_q: int
    retained_q: int
    tip_q: int
    protocol_q: int
    to_rebate_pool_q: int
    to_lps_q: int
    rebate_q: int  # net of the tip, paid to the trader on a benign record
    cap_binds: bool


def payout(pr: Priced, d: Deposit, notional_q: int, p: Params, rebate_pool_q: int) -> Outcome:
    """The rest of Settler._payout. Amounts are split in quote units at P*; the Settler splits in the deposit
    currency, so a risky deposit differs by at most one base unit per rounding step. The rebate pool is tracked
    in quote units; on chain it is held per currency."""
    if pr.kind == "expired":
        return Outcome("expired", d.quote_at_swap, 0, 0, 0, 0, 0, 0, False)
    dq = d.amount if d.is_quote else d.amount * pr.price_x36 // ref.PRICE_SCALE
    if pr.kind == "conf_refund":
        return Outcome("conf_refund", dq, 0, 0, 0, 0, 0, 0, False)
    retained = min(dq, pr.uncapped_q) if pr.toxic_q > 0 else 0
    if retained == 0 and pr.markout_q <= 0:
        gross = min((notional_q * p.fee_pips * p.kappa_bps) // (PIPS * ref.BPS), rebate_pool_q)
        tip = min(p.tip_cap_quote, (gross * p.tip_bps) // ref.BPS)
        return Outcome("benign", dq, 0, tip, 0, 0, 0, gross - tip, pr.uncapped_q > dq)
    s = ref.split_retained(dq, retained, p.tip_bps, p.tip_cap_quote, p.protocol_bps, p.rho_bps)
    return Outcome("settled", dq, retained, s.tip, s.to_protocol, s.to_rebate_pool, s.to_lps, 0, pr.uncapped_q > dq)
