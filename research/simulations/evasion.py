"""E5 trigger-evasion model. Synthetic executions preserve notional and toxic weight, not AMM state.

This deliberately cannot claim a tick-exact settlement replay: it tests detection under stated
split/delay assumptions. Exact-output changes deposit currency, not trigger eligibility.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

BPS = 10_000
MAX_BUCKET = (1 << 104) - 2


@dataclass(frozen=True)
class Trade:
    timestamp: int
    block: int
    tx: str
    notional: int
    buy: bool
    gap_bps: int
    toxic: int
    exact_output: bool = False


@dataclass(frozen=True)
class Trigger:
    n0: int
    n_min: int
    horizon: int
    tau_bps: int


def split(trade: Trade, max_piece: int, delay_seconds: int, block_step: int) -> list[Trade]:
    """Conserve total notional and toxic weight exactly, with the remainder in the last piece."""
    if max_piece < 1 or delay_seconds < 0 or block_step < 0 or trade.notional <= 0:
        raise ValueError("invalid split")
    pieces: list[Trade] = []
    left = trade.notional
    toxic_left = trade.toxic
    i = 0
    while left:
        amount = min(left, max_piece)
        toxic = trade.toxic * amount // trade.notional if left > amount else toxic_left
        pieces.append(
            replace(
                trade,
                timestamp=trade.timestamp + i * delay_seconds,
                block=trade.block + i * block_step,
                tx=f"{trade.tx}:split:{i}",
                notional=amount,
                toxic=toxic,
            )
        )
        left -= amount
        toxic_left -= toxic
        i += 1
    return pieces


def flags(trades: list[Trade], cfg: Trigger) -> list[bool]:
    """Both buckets drain on every event; large first touches persist for their transaction."""
    if not 0 < cfg.n0 <= cfg.n_min or cfg.horizon < 1 or cfg.tau_bps < 1:
        raise ValueError("invalid trigger")
    out: list[bool] = []
    buy = sell = 0
    last_time = trades[0].timestamp if trades else 0
    last_block = -1
    last_seen_block = -1
    first_tx = ""
    for t in trades:
        if t.timestamp < last_time or t.block < last_seen_block or t.notional <= 0 or t.toxic < 0:
            raise ValueError("invalid or unordered tape")
        drain = cfg.n_min * (t.timestamp - last_time) // cfg.horizon
        buy, sell = max(0, buy - drain), max(0, sell - drain)
        last_time = t.timestamp
        last_seen_block = t.block
        if t.buy:
            buy = min(MAX_BUCKET, buy + t.notional)
        else:
            sell = min(MAX_BUCKET, sell + t.notional)
        flow = (buy if t.buy else sell) >= cfg.n_min
        large = t.notional >= cfg.n0
        first = large and (last_block < t.block or (last_block == t.block and first_tx == t.tx))
        if large and last_block < t.block:
            last_block, first_tx = t.block, t.tx
        out.append(flow or (large and (first or t.gap_bps >= cfg.tau_bps)))
    return out


def recall(trades: list[Trade], selected: list[bool]) -> float:
    if len(trades) != len(selected):
        raise ValueError("flag length mismatch")
    total = sum(t.toxic for t in trades)
    if total <= 0:
        raise ValueError("no positive toxic weight; recall undefined")
    return sum(t.toxic for t, f in zip(trades, selected, strict=True) if f) / total
