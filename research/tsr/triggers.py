"""Exact ports of the contracts' trigger rules (TriggerLib, FlowBucketLib, PriceLib.signedGapBps), so a
backtest flags exactly the swaps the hook would. Integer arithmetic throughout, as in Solidity."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass

import numpy as np

from tsr.config import Pool

PRICE_SCALE = 10**36
BPS = 10_000
Q192 = 1 << 192
MAX_LEVEL = (1 << 104) - 2
MAX_GAP_BPS = (1 << 127) - 1


def flow_hits(ts: np.ndarray, notional: list[int], buys: np.ndarray, n_min: int, horizon: int) -> np.ndarray:
    """FlowBucketLib.update over a swap sequence: both buckets drain together, then one is filled."""
    hit = np.zeros(len(notional), dtype=bool)
    buy = sell = 0
    last = int(ts[0]) if len(notional) else 0
    for i, n in enumerate(notional):
        now = int(ts[i])
        drained = n_min * (now - last) // horizon
        buy = max(0, buy - drained)
        sell = max(0, sell - drained)
        last = now
        if buys[i]:
            buy = min(buy + n, MAX_LEVEL)
            hit[i] = buy >= n_min
        else:
            sell = min(sell + n, MAX_LEVEL)
            hit[i] = sell >= n_min
    return hit


def first_touches(block: np.ndarray, tx: list[str], large: np.ndarray) -> np.ndarray:
    """TriggerLib.firstTouch: the first large swap in a block, and every later swap in its transaction."""
    out = np.zeros(block.size, dtype=bool)
    last_block = -1
    first_tx = ""
    for i in range(block.size):
        if not large[i]:
            continue
        b = int(block[i])
        if tx[i] == first_tx and b == last_block:
            out[i] = True
        elif last_block < b:
            out[i] = True
            last_block = b
            first_tx = tx[i]
    return out


def pool_price_x36(sqrt_price_x96: int, risky_is_0: bool) -> int:
    """PriceLib.poolPriceX36 with Python's exact integers (identical floors to FullMath.mulDiv)."""
    sq = sqrt_price_x96 * sqrt_price_x96
    return sq * PRICE_SCALE // Q192 if risky_is_0 else PRICE_SCALE * Q192 // sq


def signed_gap_bps(ref_x36: int, pool_x36: int, buys_risky: bool) -> int:
    """PriceLib.signedGapBps: truncation toward zero, saturating at 2^127 - 1 (decision 0031)."""
    toward_up = ref_x36 > pool_x36
    diff = ref_x36 - pool_x36 if toward_up else pool_x36 - ref_x36
    mag = MAX_GAP_BPS if diff // ref_x36 >= MAX_GAP_BPS // BPS else diff * BPS // ref_x36
    gap = mag if toward_up else -mag
    return gap if buys_risky else -gap


@dataclass(frozen=True)
class Reference:
    """Chainlink answers by block, as AnswerUpdated logs recorded them."""

    blocks: list[int]
    answers: list[int]
    updated_at: list[int]
    decimals: int

    def at(self, block: int, ts: int, max_age: int) -> int | None:
        """The answer a contract reading latestRoundData at `block` would see, or None if stale or absent.
        A log in the same block counts, which is conservative toward flagging only if the update
        transaction preceded the swap."""
        i = bisect_right(self.blocks, block) - 1
        if i < 0:
            return None
        if ts - self.updated_at[i] > max_age or self.answers[i] <= 0:
            return None
        return self.answers[i]


def reference_x36(answer: int, decimals: int, pool: Pool) -> int:
    """ReferenceLib._scale: answer * 10^(36 + decQuote - decRisky - feedDecimals)."""
    k = 36 + pool.quote_decimals - pool.risky_decimals - decimals
    scale: int = 10 ** abs(k)
    return answer * scale if k >= 0 else answer // scale


def drift_gaps(
    block: np.ndarray,
    ts: np.ndarray,
    sqrt_before: list[int],
    buys: np.ndarray,
    ref: Reference,
    max_age: int,
    pool: Pool,
) -> np.ndarray:
    """Signed pre-swap gap g in bps for each swap; 0 where the reference is stale, as in the hook."""
    g = np.zeros(block.size, dtype=np.int64)
    risky_is_0 = not pool.quote_is_0
    for i in range(block.size):
        a = ref.at(int(block[i]), int(ts[i]), max_age)
        if a is None:
            continue
        r = reference_x36(a, ref.decimals, pool)
        if r == 0:
            continue
        g[i] = signed_gap_bps(r, pool_price_x36(sqrt_before[i], risky_is_0), bool(buys[i]))
    return g
