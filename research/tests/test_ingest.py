"""Decoding of untrusted RPC payloads and the fair-price lookup rule."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from tsr.fair import FairPrice
from tsr.ingest_swaps import decode_swap
from tsr.rpc import Rpc, RpcError, signed


def _word(x: int) -> str:
    return f"{x % (1 << 256):064x}"


def test_decode_swap_signs_and_fields() -> None:
    data = "0x" + "".join(_word(v) for v in (-500_000_000, 166 * 10**18, 1 << 96, 10**18, -887_220))
    row = decode_swap(
        {
            "data": data,
            "blockNumber": "0x10",
            "blockTimestamp": "0x64",
            "transactionHash": "0xAB",
            "transactionIndex": "0x2",
            "logIndex": "0x3",
        }
    )
    assert row["amount0"] == -500_000_000
    assert row["amount1"] == 166 * 10**18
    assert row["sqrtPriceX96"] == 1 << 96
    assert row["tick"] == -887_220
    assert (row["block"], row["ts"], row["tx"]) == (16, 100, "0xab")


def test_decode_swap_rejects_missing_timestamp_and_bad_data() -> None:
    with pytest.raises(RpcError):
        decode_swap({"data": "0x00", "blockNumber": "0x1"})
    good = "0x" + _word(0) * 5
    with pytest.raises(RpcError):
        decode_swap(
            {"data": good, "blockNumber": "0x1", "transactionHash": "0x", "transactionIndex": "0x0", "logIndex": "0x0"}
        )


def test_signed_word() -> None:
    assert signed((1 << 256) - 1) == -1
    assert signed(5) == 5


def test_rpc_requires_https() -> None:
    with pytest.raises(ValueError):
        Rpc("http://insecure.example")


def test_fair_price_uses_close_of_previous_second(tmp_path: Path) -> None:
    np.savez_compressed(tmp_path / "a.npz", start=np.int64(1_000), close=np.array([10.0, 20.0, 30.0]))
    np.savez_compressed(tmp_path / "b.npz", start=np.int64(1_000), close=np.array([1.0, 2.0, 1.0]))
    f = FairPrice.load(tmp_path / "a.npz", tmp_path / "b.npz")
    # Price standing at t = 1,002 is the close of the candle that opened at 1,001: 20 / 2.
    assert f.at(np.array([1_002]))[0] == 10.0
    with pytest.raises(ValueError):
        f.at(np.array([1_000]))
