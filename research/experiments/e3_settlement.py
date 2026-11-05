"""E3 settlement replay (spec §16.4), which also sets delta, delta_max and beta (spec §14.1, "Set by E3").

Development window: every swap the E1 trigger flags becomes a record, settled against Binance at t + Delta
(Pyth history is requested only for the held-out window; E4 measures the Pyth-Binance basis), for every point
of the deposit grid. The pre-registered rule picks one point. Held-out window: the spec defaults and the picked
point are each settled against the first Pyth update at or after t + Delta and judged on the pass line: the cap
binds on under 5% of toxic markout and the retail effective fee stays within 0.1 bp of f."""

from __future__ import annotations

import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from itertools import product

import numpy as np

from experiments.common import Data, prereg_hash
from experiments.e34_common import Exact, inputs_sha256, load_all, load_pyth, require_frozen, write_e34
from tsr.config import BINANCE_SYMBOLS, BOOTSTRAP_REPS, DATA_DIR, ETH_USDC_WETH_500, SEED, SPLIT
from tsr.fair import FairPrice
from tsr.hermes import PythPrice, Tick
from tsr.metrics import TriggerGrid
from tsr.settle import Amounts, Params, Priced, deposit_at_swap, payout, price
from tsr.settle_config import (
    ALPHA_BPS,
    BETA_X100,
    CAP_BIND_MAX_SHARE,
    DELTA_BPS,
    DELTA_MAX_BPS,
    EPS_BPS,
    GRID_BETA_X100,
    GRID_DELTA_BPS,
    GRID_DELTA_MAX_BPS,
    KAPPA_BPS,
    MAX_CONF_BPS,
    MAX_LAG,
    PROTOCOL_SHARE_BPS,
    RETAIL_FEE_TOLERANCE_BPS,
    RHO_BPS,
    SETTLE_DELAY,
    TIP_BPS,
    TIP_CAP_USD,
)
from tsr.stats import day_bootstrap

BPS = 10_000
Point = tuple[int, int, int]  # delta_bps, delta_max_bps, beta_x100
POOL = ETH_USDC_WETH_500
UNIT = 10**POOL.quote_decimals
F_BPS = POOL.fee_pips / 100


@dataclass
class Run:
    """Per-swap arrays for one window and one deposit point; zero for swaps that posted no record."""

    retained: np.ndarray
    rebate: np.ndarray
    tip: np.ndarray
    to_lps: np.ndarray
    deposit_q: np.ndarray
    toxic: np.ndarray
    bound_toxic: np.ndarray
    kinds: Counter[str]
    rebate_pool_end: int


def params() -> Params:
    return Params(
        alpha_bps=ALPHA_BPS,
        eps_bps=EPS_BPS,
        max_conf_bps=MAX_CONF_BPS,
        max_lag=MAX_LAG,
        tip_bps=TIP_BPS,
        tip_cap_quote=TIP_CAP_USD * UNIT,
        protocol_bps=PROTOCOL_SHARE_BPS,
        rho_bps=RHO_BPS,
        kappa_bps=KAPPA_BPS,
        fee_pips=POOL.fee_pips,
        quote_decimals=POOL.quote_decimals,
        risky_decimals=POOL.risky_decimals,
        quote_is_0=POOL.quote_is_0,
    )


def binance_tick(fair: FairPrice, t: int) -> Tick:
    """A settlement price from Binance with zero confidence, used only on the development window."""
    usd = float(fair.at(np.array([t]))[0])
    return Tick(t, PythPrice(round(usd * 10**8), 0, -8, t), PythPrice(10**8, 0, -8, t))


def price_records(
    data: Data, ex: Exact, idx: np.ndarray, tick_at: Callable[[int], Tick | None], p: Params
) -> list[tuple[int, Priced]]:
    out = []
    for i in (int(j) for j in idx):
        a = Amounts(ex.x_risky[i], ex.x_quote[i], ex.sqrt_before[i], ex.sqrt_after[i], ex.liquidity_before[i])
        t0 = int(data.sw.ts[i]) + SETTLE_DELAY
        out.append((i, price(a, tick_at(t0), t0, p)))
    return out


def run(data: Data, ex: Exact, priced: list[tuple[int, Priced]], pt: Point, p: Params) -> Run:
    n = len(data.sw)
    z = [np.zeros(n) for _ in range(7)]
    r = Run(z[0], z[1], z[2], z[3], z[4], z[5], z[6], kinds=Counter(), rebate_pool_end=0)
    pool_q = 0
    for i, pr in priced:
        nq = abs(ex.x_quote[i])
        d = deposit_at_swap(nq, int(data.gaps[i]), ex.x_risky[i], *pt)
        if d.amount == 0:
            r.kinds["no_deposit"] += 1
            continue
        o = payout(pr, d, nq, p, pool_q)
        r.kinds[o.kind] += 1
        pool_q += o.to_rebate_pool_q - (o.rebate_q + o.tip_q if o.kind == "benign" else 0)
        r.retained[i], r.rebate[i], r.tip[i], r.to_lps[i], r.deposit_q[i] = (
            o.retained_q,
            o.rebate_q,
            o.tip_q,
            o.to_lps_q,
            o.deposit_q,
        )
        if pr.kind == "ok":
            r.toxic[i] = pr.toxic_q
            if o.cap_binds:
                r.bound_toxic[i] = pr.toxic_q
    r.rebate_pool_end = pool_q
    return r


def cap_share(r: Run, idx: np.ndarray) -> float:
    t = r.toxic[idx].sum()
    return float(r.bound_toxic[idx].sum() / t) if t > 0 else float("nan")


def retail_fee(r: Run, notional: np.ndarray, idx: np.ndarray) -> float:
    return F_BPS + BPS * float((r.retained[idx] - r.rebate[idx]).sum() / notional[idx].sum())


def deposit_rate(r: Run, notional: np.ndarray, flagged: np.ndarray) -> float:
    return BPS * float(r.deposit_q[flagged].sum() / notional[flagged].sum())


def passes(share: float, fee: float) -> bool:
    return bool(share < CAP_BIND_MAX_SHARE and abs(fee - F_BPS) <= RETAIL_FEE_TOLERANCE_BPS)


def select(scores: dict[Point, tuple[float, float, float]]) -> tuple[Point, bool]:
    """Pre-registered rule: among points meeting the pass line on the development window, the lowest mean
    deposit rate (capital the trader posts); ties go to the smaller delta, then beta, then delta_max. If no
    point qualifies, the lowest cap share, reported as such."""
    ok = [(pt, s) for pt, s in scores.items() if passes(s[0], s[1])]
    if ok:
        return min(ok, key=lambda ps: (ps[1][2], ps[0][0], ps[0][2], ps[0][1]))[0], True
    return min(scores.items(), key=lambda ps: (ps[1][0], ps[0][0], ps[0][2], ps[0][1]))[0], False


def held_report(data: Data, r: Run, held: np.ndarray, retail: np.ndarray, flagged: np.ndarray) -> dict[str, object]:
    notional = data.sw.notional
    share = cap_share(r, held)
    fee = retail_fee(r, notional, retail)
    share_ci = day_bootstrap(data.day[held], lambda s: cap_share(r, held[s]), BOOTSTRAP_REPS, SEED + 3)
    fee_ci = day_bootstrap(data.day[retail], lambda s: retail_fee(r, notional, retail[s]), BOOTSTRAP_REPS, SEED + 4)
    vol = float(notional[held].sum())
    static_lp = -float(data.m15[held].sum())
    touch_lp = static_lp + float(r.to_lps[held].sum())
    usd = 1 / UNIT
    return {
        "records": dict(r.kinds),
        "cap_bound_toxic_share": share,
        "cap_bound_toxic_share_ci95": list(share_ci),
        "records_cap_bound": int((r.bound_toxic[held] > 0).sum()),
        "toxic_usd": float(r.toxic[held].sum() * usd),
        "retail_effective_fee_bps": fee,
        "retail_effective_fee_bps_ci95": list(fee_ci),
        "mean_deposit_rate_bps": deposit_rate(r, notional, flagged),
        "lp_net_15s": {
            "volume_usd": vol * usd,
            "static_usd": static_lp * usd,
            "static_bps": BPS * static_lp / vol,
            "touchstone_usd": touch_lp * usd,
            "touchstone_bps": BPS * touch_lp / vol,
        },
        "flows_usd": {
            "deposits": float(r.deposit_q[held].sum() * usd),
            "retained": float(r.retained[held].sum() * usd),
            "refunded": float((r.deposit_q[held] - r.retained[held]).sum() * usd),
            "to_lps": float(r.to_lps[held].sum() * usd),
            "rebates_paid": float(r.rebate[held].sum() * usd),
            "tips": float(r.tip[held].sum() * usd),
            "rebate_pool_end": r.rebate_pool_end * usd,
        },
        "verdict": "pass" if passes(share, fee) else "kill",
    }


def main() -> int:
    require_frozen("E3")
    data, ex, trig, flagged_held, _ = load_all()
    p = params()
    notional = data.sw.notional
    n0 = trig[0] * UNIT
    is_dev = data.sw.ts < SPLIT

    flags = TriggerGrid(data.sw, data.gaps, POOL).flagged(trig)
    dev = np.flatnonzero(is_dev)
    held = np.flatnonzero(~is_dev)
    flagged_dev = dev[flags[dev]]
    retail_dev = dev[notional[dev] < n0]
    retail_held = held[notional[held] < n0]

    eth, usdc = (next(DATA_DIR.glob(f"binance_{s}_1s_*.npz")) for s in BINANCE_SYMBOLS)
    fair = FairPrice.load(eth, usdc)
    priced_dev = price_records(data, ex, flagged_dev, lambda t: binance_tick(fair, t), p)

    grid = [pt for pt in product(GRID_DELTA_BPS, GRID_DELTA_MAX_BPS, GRID_BETA_X100) if pt[0] <= pt[1]]
    scores: dict[Point, tuple[float, float, float]] = {}
    for pt in grid:
        r = run(data, ex, priced_dev, pt, p)
        scores[pt] = (
            cap_share(r, dev),
            retail_fee(r, notional, retail_dev),
            deposit_rate(r, notional, flagged_dev),
        )
    chosen, qualified = select(scores)

    pyth = load_pyth()
    priced_held = price_records(data, ex, flagged_held, pyth.get, p)
    default: Point = (DELTA_BPS, DELTA_MAX_BPS, BETA_X100)
    at_default = held_report(data, run(data, ex, priced_held, default, p), held, retail_held, flagged_held)
    at_chosen = held_report(data, run(data, ex, priced_held, chosen, p), held, retail_held, flagged_held)

    write_e34(
        "E3",
        {
            "experiment": "E3",
            "label": "historical backtest",
            "prereg_sha256": prereg_hash("E3"),
            "inputs_sha256": inputs_sha256(data),
            "trigger": list(trig),
            "development": {
                "settlement_price": "Binance ETHUSDT / USDCUSDT 1 s close at t + Delta, confidence 0",
                "flagged": int(flagged_dev.size),
                "retail_swaps": int(retail_dev.size),
                "grid": [
                    {"point": list(pt), "cap_share": s[0], "retail_fee_bps": s[1], "deposit_rate_bps": s[2]}
                    for pt, s in scores.items()
                ],
                "selected": list(chosen),
                "selected_met_pass_line": qualified,
            },
            "held_out": {
                "settlement_price": "first Pyth ETH/USD and USDC/USD updates at or after t + Delta (Hermes)",
                "flagged": int(flagged_held.size),
                "retail_swaps": int(retail_held.size),
                "retail_definition": f"held-out swaps below N0 = ${trig[0]:,}",
                "spec_default": {"point": list(default), **at_default},
                "selected": {"point": list(chosen), **at_chosen},
            },
            "verdict_spec_default": at_default["verdict"],
            "verdict_selected": at_chosen["verdict"],
        },
    )
    for name, rep, pt in (("spec default", at_default, default), ("selected", at_chosen, chosen)):
        print(
            f"E3 {name} {pt}: cap binds on {rep['cap_bound_toxic_share']:.4f} of toxic markout, "
            f"retail fee {rep['retail_effective_fee_bps']:.4f} bp vs {F_BPS} bp -> {str(rep['verdict']).upper()}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
