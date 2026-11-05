"""Minimal JSON-RPC client over HTTPS with retries. Every response is treated as untrusted input."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import cast

JsonValue = object


class RpcError(RuntimeError):
    """A JSON-RPC call failed after every retry, or returned an error object."""


@dataclass(frozen=True)
class Rpc:
    url: str
    max_retries: int = 8
    backoff_seconds: float = 1.0
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if not self.url.startswith("https://"):
            raise ValueError(f"rpc url must be https: {self.url}")

    def call(self, method: str, params: list[JsonValue]) -> JsonValue:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        last: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                req = urllib.request.Request(
                    self.url,
                    data=body,
                    headers={"content-type": "application/json", "user-agent": "touchstone-research"},
                )
                with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                    payload = json.loads(resp.read())
                if not isinstance(payload, dict):
                    raise RpcError(f"{method}: response is not an object")
                if "error" in payload:
                    raise RpcError(f"{method}: {payload['error']}")
                return cast(JsonValue, payload["result"])
            except (urllib.error.URLError, TimeoutError, RpcError, json.JSONDecodeError, KeyError) as exc:
                last = exc
                time.sleep(min(30.0, self.backoff_seconds * (2**attempt)))
        raise RpcError(f"{method} failed after {self.max_retries} attempts: {last}")

    def block_number(self) -> int:
        return hex_int(self.call("eth_blockNumber", []))

    def block_timestamp(self, number: int) -> int:
        block = self.call("eth_getBlockByNumber", [hex(number), False])
        if not isinstance(block, dict):
            raise RpcError(f"block {number} missing")
        return hex_int(block["timestamp"])

    def eth_call(self, to: str, data: str, block: int | None = None) -> str:
        tag = "latest" if block is None else hex(block)
        out = self.call("eth_call", [{"to": to, "data": data}, tag])
        if not isinstance(out, str):
            raise RpcError("eth_call returned a non-string")
        return out

    def first_block_at_or_after(self, timestamp: int, low: int, high: int) -> int:
        """Binary search for the first block whose timestamp is at or after `timestamp`."""
        while low < high:
            mid = (low + high) // 2
            if self.block_timestamp(mid) < timestamp:
                low = mid + 1
            else:
                high = mid
        return low


def hex_int(value: JsonValue) -> int:
    if not isinstance(value, str) or not value.startswith("0x"):
        raise RpcError(f"expected a hex quantity, got {value!r}")
    return int(value, 16)


def signed(word: int, bits: int = 256) -> int:
    """Two's-complement interpretation of an ABI word."""
    return word - (1 << bits) if word >= 1 << (bits - 1) else word
