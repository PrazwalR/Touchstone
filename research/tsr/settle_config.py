"""Constants for E3 and E4, kept apart from tsr/config.py so the E1 and E2 analysis hash stays reproducible.
This file is part of the E3 and E4 pre-registered analysis code (spec §16.6)."""

from __future__ import annotations

# Pyth Core price feed ids (Hermes, hex without 0x): Crypto.ETH/USD and Crypto.USDC/USD.
PYTH_ETH_USD = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"
PYTH_USDC_USD = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"

# Hermes client. The key's limit was measured on 28 Oct 2026 at roughly 3 requests per second before 429s;
# the client starts below it and backs off on Retry-After.
HERMES_RATE_PER_S = 2.0
HERMES_WORKERS = 3
HERMES_TIMEOUT_S = 20.0
HERMES_MAX_RETRIES = 12

# Spec §14 defaults for the parameters E3 replays (§14.1 to §14.3). Not tuned by E3.
DELTA_BPS = 30
DELTA_MAX_BPS = 300
BETA_X100 = 125
SETTLE_DELAY = 3
MAX_LAG = 10
MAX_CONF_BPS = 25
ALPHA_BPS = 8_000
EPS_BPS = 2
TIP_BPS = 200
TIP_CAP_USD = 25  # §14.3: $25 on Ethereum
RHO_BPS = 1_000
KAPPA_BPS = 4_000
PROTOCOL_SHARE_BPS = 0  # §14.3: 0 where no protocol fee applies; it moves value between LPs and protocol only

# E3 sets delta, delta_max and beta (spec §14.1). The grid stays inside the factory bounds (§14.1: delta 5 to
# 500 bps, delta_max from delta to 2,000 bps, beta 1.00 to 4.00) and the cross-field rule delta <= delta_c (300).
GRID_DELTA_BPS = (30, 50, 75, 100, 150, 200, 300)
GRID_DELTA_MAX_BPS = (300, 500, 1_000, 2_000)
GRID_BETA_X100 = (125, 200, 300, 400)

# E3 pass line (spec §16.4).
CAP_BIND_MAX_SHARE = 0.05
RETAIL_FEE_TOLERANCE_BPS = 0.1

# E4: deltas and sample (spec §16.4). The decision delta is the deployed settleDelay.
E4_DELTAS = (2, 3, 5, 8, 12)
E4_DECISION_DELTA = 3
E4_SAMPLE = 2_000
E4_KILL_BPS = EPS_BPS / 2
