"""Exact reference implementation of Touchstone's settlement math.

This module is the source of truth for differential tests. Every function uses
integers or Fractions, rounds exactly where the Solidity code rounds, and is
documented with the spec section it implements. Nothing here touches the
network.

Units
-----
* Quote amounts are integers in the quote token's base units.
* Risky amounts are integers in the risky token's base units.
* Prices are quote base units per risky base unit, scaled by 1e36 (PRICE_SCALE). 1e18 is not
  enough: an 18-decimal token worth $0.0001 against 6-decimal USDC has a base-unit ratio of 1e-16,
  which 1e18 would hold to two significant digits.
* Rates are basis points (1e4) unless named *_pips, which are Uniswap fee pips (1e6).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

PRICE_SCALE = 10**36
BPS = 10_000
PIPS = 1_000_000
Q96 = 2**96

MODE_CONTINUOUS = 0
MODE_CLOSED = 1


def floor_div(a: int, b: int) -> int:
    """Floor division toward negative infinity, as the Solidity helpers use for signed values."""
    return a // b


# --- Pyth price conversion (spec: Settlement, step 4) -----------------------------------------


def fair_price_x36(p_base: int, e_base: int, p_quote: int, e_quote: int, dec_risky: int, dec_quote: int) -> int:
    """P* in quote base units per risky base unit, times 1e36, rounded down.

    P* = (p_base * 10^e_base) / (p_quote * 10^e_quote) quote tokens per risky token,
    then * 10^dec_quote / 10^dec_risky to move to base units.
    """
    if p_base <= 0 or p_quote <= 0:
        raise ValueError("non-positive price")
    k = e_base - e_quote + dec_quote - dec_risky + 36
    # int.__pow__ is typed as Any for a non-literal exponent; k's sign is checked, so both are ints.
    if k >= 0:
        scale: int = 10**k
        return (p_base * scale) // p_quote
    inverse: int = 10 ** (-k)
    return p_base // (p_quote * inverse)


def conf_bps_up(p_base: int, conf_base: int, p_quote: int, conf_quote: int) -> int:
    """c* = conf_b/p_b + conf_q/p_q in basis points, rounded up.

    Rounding up widens the deadband, which can only lower R, so rounding favours the trader.
    """
    num = (conf_base * p_quote + conf_quote * p_base) * BPS
    den = p_base * p_quote
    return -((-num) // den)


# --- Deposit (spec: TouchstoneHook, Deposit size and currency) --------------------------------


def deposit_rate_bps(
    mode: int, gap_bps: int, delta_bps: int, delta_max_bps: int, beta_x100: int, delta_closed_bps: int
) -> int:
    """min(delta_max, max(delta, beta * g+)) for continuous records; delta_c for closure records."""
    if mode == MODE_CLOSED:
        return delta_closed_bps
    g_plus = max(0, gap_bps)
    scaled = (beta_x100 * g_plus) // 100
    return min(delta_max_bps, max(delta_bps, scaled))


def deposit_quote(notional_quote: int, rate_bps: int) -> int:
    return (notional_quote * rate_bps) // BPS


def quote_to_risky(amount_quote: int, price_x36: int) -> int:
    """Convert at a price, rounding down."""
    return (amount_quote * PRICE_SCALE) // price_x36


def risky_to_quote(amount_risky: int, price_x36: int) -> int:
    return (amount_risky * price_x36) // PRICE_SCALE


# --- Flow bucket (spec: Triggers, Flow) ---------------------------------------------------------


def bucket_after(level: int, last_time: int, now: int, n_min: int, horizon: int, add: int) -> int:
    """Leaky bucket: drains at n_min / horizon per second, then adds this swap's notional."""
    drained = (n_min * (now - last_time)) // horizon
    return max(0, level - drained) + add


# --- Markout and clawback (spec §4.2 and §4.4) ----------


def markout_quote(x_risky: int, x_quote: int, price_x36: int) -> int:
    """m = x_r * P* + x_q from the trader's signed receipts, rounded toward negative infinity."""
    return floor_div(x_risky * price_x36, PRICE_SCALE) + x_quote


def alpha_for(
    mode: int,
    licence_active: bool,
    by_holder: bool,
    in_band: bool,
    alpha_bps: int,
    alpha_lic_bps: int,
    alpha_closed_bps: int,
) -> int:
    """Regime table from the Arbitrage licence section."""
    if mode == MODE_CLOSED:
        return alpha_closed_bps
    if not licence_active or not in_band:
        return alpha_bps
    if by_holder:
        return 0
    return alpha_lic_bps


def in_band(sqrt_price_before_x96: int, price_x36: int, risky_is_0: bool, band_bps: int) -> bool:
    """|p_pre - P*| <= G * P*, with p_pre taken from the record's pre-swap sqrt price."""
    pool_price = Fraction(sqrt_price_before_x96 * sqrt_price_before_x96, Q96 * Q96)
    p_pre = pool_price if risky_is_0 else 1 / pool_price
    p_star = Fraction(price_x36, PRICE_SCALE)
    return abs(p_pre - p_star) * BPS <= band_bps * p_star


def clawback_quote(
    deposit_quote_value: int,
    m_plus: int,
    n_plus: int,
    eps_bps: int,
    conf_bps: int,
    alpha_bps: int,
) -> int:
    """R = min(D, alpha * max(0, m+ - eps_eff * N+)), rounded down."""
    excess = m_plus - ((eps_bps + conf_bps) * n_plus) // BPS
    if excess <= 0 or alpha_bps == 0:
        return 0
    return min(deposit_quote_value, (alpha_bps * excess) // BPS)


@dataclass(frozen=True)
class Payout:
    benign: bool
    refund: int
    tip: int
    to_protocol: int
    to_rebate_pool: int
    to_lps: int
    rebate: int


def split_retained(deposit: int, r: int, tip_bps: int, tip_cap: int, protocol_bps: int, rho_bps: int) -> Payout:
    """Split R in the deposit currency. refund + tip + toProtocol + toRebatePool + toLPs == deposit."""
    if r > deposit:
        raise ValueError("R above deposit")
    tip = min(tip_cap, (r * tip_bps) // BPS)
    rest = r - tip
    to_protocol = (rest * protocol_bps) // BPS
    rest -= to_protocol
    to_rebate = (rest * rho_bps) // BPS
    to_lps = rest - to_rebate
    return Payout(False, deposit - r, tip, to_protocol, to_rebate, to_lps, 0)


def rebate_payout(
    deposit: int, notional_dep: int, fee_pips: int, kappa_bps: int, rebate_pool: int, tip_bps: int, tip_cap: int
) -> Payout:
    """Benign record: gross = min(kappa * f * N, pool); the tip comes out of gross."""
    gross = min((notional_dep * fee_pips * kappa_bps) // (PIPS * BPS), rebate_pool)
    tip = min(tip_cap, (gross * tip_bps) // BPS)
    return Payout(True, deposit, tip, 0, 0, 0, gross - tip)


def check_payout(p: Payout, deposit: int, rebate_pool: int) -> bool:
    """The conservation check the hook runs in finalize."""
    if p.benign:
        return (
            p.refund == deposit
            and p.to_protocol == p.to_rebate_pool == p.to_lps == 0
            and p.tip + p.rebate <= rebate_pool
        )
    return p.rebate == 0 and p.refund + p.tip + p.to_protocol + p.to_rebate_pool + p.to_lps == deposit


# --- Vesting (spec: Settlement, Vesting donations) ---------------------------------------------


def drip_amount(vest: int, elapsed: int, vest_period: int) -> int:
    return vest if elapsed >= vest_period else (vest * elapsed) // vest_period


# --- Licence lease (spec: Arbitrage licence, The lease) ----------------------------------------


def min_next_rent(top_rent: int, next_rent: int, min_rent: int, min_increment_bps: int) -> int:
    base = max(top_rent, next_rent)
    if base == 0:
        return min_rent
    raised = -((-base * (BPS + min_increment_bps)) // BPS)
    return max(min_rent, raised)


def rent_due(rent_per_s: int, deposit: int, since: int, now: int) -> tuple[int, int]:
    """Rent charged from `since` to `now`, and the time the deposit runs out."""
    lapse_at = since + deposit // rent_per_s
    end = min(now, lapse_at)
    return rent_per_s * max(0, end - since), lapse_at


# --- Economics used in the report ----------------------------------------------------------------


def break_even_recall(
    lvr_bps: float, fee_income_bps: float, arb_fee_bps: float, alpha: float, eps_bps: float, arb_share: float
) -> float:
    """r* = (L - F) / (alpha * (L - (f_arb + eps) * s)), spec §4.6.

    F is the pool's fee income per unit volume; f_arb is the fee the arbitrage flow itself pays,
    which comes off its markout because markouts are net of the LP fee. The report's headline
    uses f_arb = F.
    """
    return (lvr_bps - fee_income_bps) / (alpha * (lvr_bps - (arb_fee_bps + eps_bps) * arb_share))


def noise_tax_bps(alpha: float, sigma_bps: float, fee_bps: float, eps_bps: float) -> float:
    """E[R]/N for a benign trade whose markout before fee is N(0, sigma), normal approximation."""
    z = (fee_bps + eps_bps) / sigma_bps
    phi = math.exp(-z * z / 2) / math.sqrt(2 * math.pi)
    tail = 0.5 * math.erfc(z / math.sqrt(2))
    return alpha * sigma_bps * (phi - z * tail)


def horizon_sigma_bps(daily_vol: float, seconds: float) -> float:
    return daily_vol * math.sqrt(seconds / 86_400) * BPS


def wash_leg_loss(fee_bps: float, kappa: float, lp_share: float = 0.0) -> float:
    """Loss per unit notional of one wash leg before impact and gas; positive means the wash loses."""
    return fee_bps * (1 - kappa) - fee_bps * lp_share
