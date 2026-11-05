"""Reproduce every number the spec quotes from the report, and write test vectors.

Run: python3 -I check_report_numbers.py <out_dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import touchstone_ref as t

USDC = 10**6
results: dict[str, object] = {}

# Worked example: ETH/USDC, f = 5 bps, eps = 2 bps, alpha = 0.8, delta = 30 bps, alpha_lic = 0.95.
# Prices are quote base units per risky base unit x 1e36: $3,000 per ETH with 6 and 18 decimals.
P = t.fair_price_x36(3000_00000000, -8, 1_00000000, -8, 18, 6)
assert P == 3000 * 10**6 * 10**36 // 10**18, P

rows = []
for name, notional, markout, alpha in [
    ("arbitrage", 500_000, 500, 8000),
    ("benign_lucky", 200_000, 20, 8000),
    ("retail_first_touch", 20_000, -3, 8000),
    ("outsider_in_band", 500_000, 500, 9500),
]:
    n = notional * USDC
    m = markout * USDC
    d = t.deposit_quote(n, t.deposit_rate_bps(0, 0, 30, 300, 125, 300))
    r = t.clawback_quote(d, m, n, 2, 0, alpha)
    eff_bps = 5 + r * 10_000 / n
    rows.append(
        {
            "swap": name,
            "deposit": d / USDC,
            "retained": r / USDC,
            "refund": (d - r) / USDC,
            "effective_fee_bps": round(eff_bps, 2),
        }
    )
results["worked_example"] = rows
assert [row["retained"] for row in rows] == [320, 0, 0, 380]
assert [row["effective_fee_bps"] for row in rows] == [11.4, 5.0, 5.0, 12.6]

# Markout from receipts: buy 166.8333.. ETH for $500,000 at an all-in price below P* by 10 bps.
x_r = 10**18 * 500_500 // 3000  # risky received, so x_r * P* = $500,500
results["markout_from_receipts_usd"] = t.markout_quote(x_r, -500_000 * USDC, P) / USDC

# Break-even recall, spec §4.6.
results["break_even_recall_F6.3"] = round(t.break_even_recall(8.5, 6.3, 6.3, 0.8, 2, 0.29), 3)
results["break_even_recall_f5"] = round(t.break_even_recall(8.5, 6.3, 5.0, 0.8, 2, 0.29), 3)
results["recapture_coefficient_bps"] = round(0.8 * (8.5 - (6.3 + 2) * 0.29), 2)

# Noise tax, Closed-market mode.
results["noise_tax"] = {
    "weekend_closed_settings": round(t.noise_tax_bps(0.5, 150, 5, 50), 1),
    "weekend_continuous_settings": round(t.noise_tax_bps(0.8, 150, 5, 2), 1),
    "continuous_3s_vol3pct": {
        "sigma_bps": round(t.horizon_sigma_bps(0.03, 3), 2),
        "z": round(7 / t.horizon_sigma_bps(0.03, 3), 2),
        "tax_bps": t.noise_tax_bps(0.8, t.horizon_sigma_bps(0.03, 3), 5, 2),
    },
    "continuous_3s_vol5.2pct": {
        "z": round(7 / t.horizon_sigma_bps(0.052, 3), 2),
        "tax_bps": round(t.noise_tax_bps(0.8, t.horizon_sigma_bps(0.052, 3), 5, 2), 3),
    },
}

# Wash trading, Benign-flow rebates.
results["wash_leg_loss_bps_kappa0.4"] = t.wash_leg_loss(5, 0.4)
results["lp_self_wash_breakeven_share"] = 1 - 0.4

# Split and conservation on the arbitrage row, deposit in USDC.
d = 1_500 * USDC
r = 320 * USDC
p = t.split_retained(d, r, tip_bps=200, tip_cap=5 * USDC, protocol_bps=0, rho_bps=1000)
assert t.check_payout(p, d, 0)
results["split_arbitrage"] = {k: (v if isinstance(v, bool) else v / USDC) for k, v in p.__dict__.items()}

# Rebate on the large benign swap: kappa 40% of a 5 bp fee on $200,000 = $40.
rp = t.rebate_payout(600 * USDC, 200_000 * USDC, 500, 4000, 1_000 * USDC, 200, 5 * USDC)
assert t.check_payout(rp, 600 * USDC, 1_000 * USDC)
results["rebate_benign"] = {k: (v if isinstance(v, bool) else v / USDC) for k, v in rp.__dict__.items()}

# Lease: 10% increment rounds up; rent stops when the deposit runs out.
results["min_next_rent"] = t.min_next_rent(1001, 0, 1, 1000)
results["rent_due"] = t.rent_due(rent_per_s=10, deposit=36_000, since=0, now=4_000)

# Vectors for the Solidity differential tests.
vectors = {
    "fairPrice": [
        {
            "pBase": 3000_00000000,
            "eBase": -8,
            "pQuote": 1_00000000,
            "eQuote": -8,
            "decRisky": 18,
            "decQuote": 6,
            "out": str(t.fair_price_x36(3000_00000000, -8, 1_00000000, -8, 18, 6)),
        },
        {
            "pBase": 6123456789,
            "eBase": -8,
            "pQuote": 99990000,
            "eQuote": -8,
            "decRisky": 8,
            "decQuote": 6,
            "out": str(t.fair_price_x36(6123456789, -8, 99990000, -8, 8, 6)),
        },
        {
            "pBase": 2512345,
            "eBase": -5,
            "pQuote": 100001234,
            "eQuote": -8,
            "decRisky": 18,
            "decQuote": 18,
            "out": str(t.fair_price_x36(2512345, -5, 100001234, -8, 18, 18)),
        },
    ],
    "conf": [
        {
            "pBase": 3000_00000000,
            "confBase": 150000000,
            "pQuote": 1_00000000,
            "confQuote": 5000,
            "out": t.conf_bps_up(3000_00000000, 150000000, 1_00000000, 5000),
        }
    ],
    "clawback": [
        {
            "deposit": 1_500 * USDC,
            "mPlus": 500 * USDC,
            "nPlus": 500_000 * USDC,
            "eps": 2,
            "conf": 0,
            "alpha": 8000,
            "out": t.clawback_quote(1_500 * USDC, 500 * USDC, 500_000 * USDC, 2, 0, 8000),
        },
        {
            "deposit": 1_500 * USDC,
            "mPlus": 5_000 * USDC,
            "nPlus": 500_000 * USDC,
            "eps": 2,
            "conf": 1,
            "alpha": 8000,
            "out": t.clawback_quote(1_500 * USDC, 5_000 * USDC, 500_000 * USDC, 2, 1, 8000),
        },
    ],
    "bucket": [
        {
            "level": 90_000 * USDC,
            "last": 100,
            "now": 106,
            "nMin": 100_000 * USDC,
            "horizon": 12,
            "add": 30_000 * USDC,
            "out": t.bucket_after(90_000 * USDC, 100, 106, 100_000 * USDC, 12, 30_000 * USDC),
        }
    ],
}
results["vectors"] = vectors

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
out.mkdir(parents=True, exist_ok=True)
(out / "report_numbers.json").write_text(json.dumps(results, indent=2))
(out / "vectors.json").write_text(json.dumps(vectors, indent=2))
print(json.dumps({k: v for k, v in results.items() if k != "vectors"}, indent=2))
