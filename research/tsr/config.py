"""Every constant the M4 experiments use. This file is part of the pre-registered analysis code: its
hash is recorded in research/prereg/E1.md and E2.md, and changing it after a run means a new
pre-registration (spec §16.6)."""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from pathlib import Path

RESEARCH_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = RESEARCH_ROOT / "data"
RESULTS_DIR = RESEARCH_ROOT / "results"


def utc(year: int, month: int, day: int) -> int:
    return calendar.timegm((year, month, day, 0, 0, 0))


@dataclass(frozen=True)
class Pool:
    chain: str
    address: str
    quote_symbol: str
    risky_symbol: str
    quote_is_0: bool
    quote_decimals: int
    risky_decimals: int
    fee_pips: int


# Uniswap v3 USDC/WETH 0.05% on Ethereum: token0 USDC (6), token1 WETH (18). The pool Assay calibrated on.
ETH_USDC_WETH_500 = Pool(
    chain="ethereum",
    address="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    quote_symbol="USDC",
    risky_symbol="WETH",
    quote_is_0=True,
    quote_decimals=6,
    risky_decimals=18,
    fee_pips=500,
)

# Chainlink ETH/USD on Ethereum (proxy). The aggregators behind it are resolved at ingest time.
CHAINLINK_ETH_USD_PROXY = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
CHAINLINK_DECIMALS = 8
# Spec §14.1: feed heartbeat + 10%. The ETH/USD mainnet feed's heartbeat is 3,600 s.
REFERENCE_MAX_AGE = 3_960

# Windows, split by time only (spec §16.7). 56 whole UTC days ending before the run.
WINDOW_START = utc(2026, 8, 30)
SPLIT = utc(2026, 9, 27)
WINDOW_END = utc(2026, 10, 25)

# Fair price: Binance ETHUSDT divided by USDCUSDT, 1-second klines, so markouts are in USDC.
BINANCE_SYMBOLS = ("ETHUSDT", "USDCUSDT")
BINANCE_DUMP = "https://data.binance.vision/data/spot/daily/klines/{sym}/1s/{sym}-1s-{date}.zip"

# Mechanism constants at their spec §14 defaults. Not tuned by these experiments.
SETTLE_DELAY = 3  # Delta, seconds
LP_NET_HORIZON = 15  # seconds, the Uniswap Labs and Columbia horizon (spec §16.3)
EPS_BPS = 2
ALPHA_BPS = 8_000
PHI_MAX = 0.30
BPS_DENOM = 10_000
REPORT_AVERAGE_R_STAR = 0.451  # spec §4.6, report averages, for context only

# The trigger grid E1 searches on the development window (spec §16.4 E1 sets N0, N_min, h, tau).
# Dollar amounts are whole quote tokens.
GRID_N0 = (1_000, 2_500, 5_000, 10_000, 25_000, 50_000)
GRID_N_MIN = (50_000, 100_000, 250_000, 500_000)
GRID_H = (6, 12, 24, 60)
GRID_TAU = (2, 5, 10, 20)
DEFAULT_TRIGGER = (5_000, 100_000, 12, 5)

BOOTSTRAP_REPS = 2_000
SEED = 20_261_028
