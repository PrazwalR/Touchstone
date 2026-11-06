"""The backtest's trigger port behaves exactly like TriggerLib, FlowBucketLib and PriceLib."""

from __future__ import annotations

import numpy as np

from tsr.config import ETH_USDC_WETH_500
from tsr.triggers import (
    MAX_GAP_BPS,
    Reference,
    first_touches,
    flow_hits,
    pool_price_x36,
    reference_x36,
    signed_gap_bps,
)

USDC = 10**6


def test_flow_matches_solidity_vector() -> None:
    # test_FlowBucket_PythonVector: level 90k at t=100; at t=106 a 30k buy leaves 70k, below 100k.
    hits = flow_hits(np.array([100, 106]), [90_000 * USDC, 30_000 * USDC], np.array([True, True]), 100_000 * USDC, 12)
    assert hits.tolist() == [False, False]


def test_flow_split_trade_fills() -> None:
    n = 25
    hits = flow_hits(np.full(n, 5), [4_000 * USDC] * n, np.ones(n, dtype=bool), 100_000 * USDC, 12)
    assert hits[-1] and not hits[-2]


def test_flow_buckets_drain_together() -> None:
    # A sell after 12 s drains the untouched buy bucket too (D-2).
    hits = flow_hits(
        np.array([0, 12, 12]),
        [90_000 * USDC, 1 * USDC, 20_000 * USDC],
        np.array([True, False, True]),
        100_000 * USDC,
        12,
    )
    assert hits.tolist() == [False, False, False]


def test_first_touch_rules() -> None:
    block = np.array([1, 1, 1, 2, 2])
    tx = ["a", "a", "b", "c", "c"]
    large = np.array([True, True, True, False, True])
    # Block 1: tx a is first, its second swap also counts, tx b does not. Block 2: the small swap never
    # uses up the status, so the large one in the same tx is first.
    assert first_touches(block, tx, large).tolist() == [True, True, False, False, True]


def test_gap_matches_solidity() -> None:
    assert signed_gap_bps(3003 * 10**9, 3000 * 10**9, True) == 9
    assert signed_gap_bps(3003 * 10**9, 3000 * 10**9, False) == -9
    assert signed_gap_bps(1, 2**248, True) == -MAX_GAP_BPS


def test_reference_staleness_and_scale() -> None:
    ref = Reference(blocks=[10], answers=[3_000 * 10**8], updated_at=[1_000], decimals=8)
    assert ref.at(9, 1_000, 3_960) is None
    assert ref.at(10, 4_960, 3_960) == 3_000 * 10**8
    assert ref.at(11, 4_961, 3_960) is None
    x36 = reference_x36(3_000 * 10**8, 8, ETH_USDC_WETH_500)
    assert x36 == 3_000 * 10**6 * 10**36 // 10**18


def test_pool_price_unit_ratio() -> None:
    q96 = 1 << 96
    assert pool_price_x36(q96, True) == 10**36
    assert pool_price_x36(q96, False) == 10**36
