"""Pyth Hermes timestamp endpoint, rate-limited and cached on disk. Responses are untrusted: every field the
analysis reads is type-checked, and an update published before the requested time is rejected."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from tsr.store import Row, read_rows, write_rows

log = logging.getLogger("tsr.hermes")


class HermesError(RuntimeError):
    """A request failed after every retry, or the response was malformed."""


@dataclass(frozen=True)
class PythPrice:
    price: int
    conf: int
    expo: int
    publish_time: int


@dataclass(frozen=True)
class Tick:
    """The first ETH/USD and USDC/USD updates Hermes serves for one requested time."""

    t: int
    base: PythPrice
    quote: PythPrice


def _checked_price(p: int, c: int, e: int, pt: int) -> PythPrice:
    if any(type(v) is not int for v in (p, c, e, pt)):
        raise HermesError("price fields must be integers, not booleans or coerced values")
    if not (0 < p < 1 << 63 and 0 <= c < 1 << 64 and -(1 << 31) <= e < 1 << 31 and 0 <= pt < 1 << 64):
        raise HermesError("price fields are outside their Pyth ranges")
    return PythPrice(p, c, e, pt)


def _checked_tick(t: int, b: PythPrice, q: PythPrice) -> Tick:
    if type(t) is not int or t < 0:
        raise HermesError("requested time must be a nonnegative integer")
    if b.publish_time < t or q.publish_time < t:
        raise HermesError(f"update for {t} published before it")
    return Tick(t, b, q)


def _price(obj: object) -> PythPrice:
    if not isinstance(obj, dict):
        raise HermesError("price is not an object")
    p, c, e, pt = obj.get("price"), obj.get("conf"), obj.get("expo"), obj.get("publish_time")
    if not (isinstance(p, str) and isinstance(c, str) and isinstance(e, int) and isinstance(pt, int)):
        raise HermesError(f"malformed price {obj!r}")
    try:
        return _checked_price(int(p), int(c), e, pt)
    except ValueError as exc:
        raise HermesError("price or confidence is not an integer string") from exc


def parse(body: object, t: int, base_id: str, quote_id: str) -> Tick:
    if not isinstance(body, dict) or not isinstance(body.get("parsed"), list):
        raise HermesError("response has no parsed list")
    by_id: dict[str, PythPrice] = {}
    for item in body["parsed"]:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            by_id[item["id"].lower().removeprefix("0x")] = _price(item.get("price"))
    if base_id not in by_id or quote_id not in by_id:
        raise HermesError(f"response for {t} lacks a requested feed")
    return _checked_tick(t, by_id[base_id], by_id[quote_id])


def to_row(k: Tick) -> Row:
    return {
        "t": k.t,
        "base": [k.base.price, k.base.conf, k.base.expo, k.base.publish_time],
        "quote": [k.quote.price, k.quote.conf, k.quote.expo, k.quote.publish_time],
    }


def from_row(r: Row) -> Tick:
    b, q, t = r.get("base"), r.get("quote"), r.get("t")
    if not (isinstance(b, list) and isinstance(q, list) and len(b) == len(q) == 4 and type(t) is int):
        raise HermesError("cached row malformed")
    if any(type(v) is not int for v in (*b, *q)):
        raise HermesError("cached price fields must be integers")
    return _checked_tick(t, _checked_price(*b), _checked_price(*q))


class _Pacer:
    """Spaces request starts at a shared rate. A 429 cuts the rate by 30% and waits out Retry-After; each
    success adds 0.05 requests per second back, up to the starting rate (additive increase, multiplicative
    decrease), so one burst of 429s does not leave the download crawling for good."""

    def __init__(self, rate: float) -> None:
        self.rate = rate
        self.max_rate = rate
        self.next = time.monotonic()
        self.lock = threading.Lock()
        self.ok_count = 0
        self.throttled_count = 0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            at = max(now, self.next)
            self.next = at + 1.0 / self.rate
        time.sleep(max(0.0, at - now))

    def throttled(self, retry_after: float) -> None:
        with self.lock:
            self.throttled_count += 1
            self.rate = max(0.3, self.rate * 0.7)
            self.next = max(self.next, time.monotonic() + retry_after)

    def ok(self) -> None:
        with self.lock:
            self.ok_count += 1
            self.rate = min(self.max_rate, self.rate + 0.05)


@dataclass(frozen=True)
class Hermes:
    url: str
    auth_header: str
    auth_value: str
    base_id: str
    quote_id: str
    rate_per_s: float
    workers: int
    timeout_s: float
    max_retries: int

    def _get(self, t: int, pacer: _Pacer) -> Tick:
        q = f"ids[]={self.base_id}&ids[]={self.quote_id}&parsed=true&encoding=hex"
        req = urllib.request.Request(
            f"{self.url}/v2/updates/price/{t}?{q}",
            headers={
                self.auth_header: self.auth_value,
                "User-Agent": "touchstone-research",
                "Accept": "application/json",
            },
        )
        last: Exception | None = None
        failures = 0
        # A 429 is the server pacing us, not a failure of this request, so it does not use up a retry.
        while failures < self.max_retries:
            pacer.wait()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    tick = parse(json.loads(resp.read()), t, self.base_id, self.quote_id)
                pacer.ok()
                return tick
            except urllib.error.HTTPError as exc:
                last = exc
                if exc.code == 429:
                    pacer.throttled(float(exc.headers.get("Retry-After") or 5))
                    continue
                if exc.code == 404 or exc.code >= 500:
                    failures += 1
                    time.sleep(min(30.0, 2.0**failures))
                    continue
                raise HermesError(f"{t}: HTTP {exc.code}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last = exc
                failures += 1
                time.sleep(min(30.0, 2.0**failures))
        raise HermesError(f"{t} failed after {self.max_retries} attempts: {last}")

    def fetch(self, times: list[int], cache: Path, chunk: int = 100) -> dict[int, Tick]:
        """Every requested time, in chunks of `chunk` cached on disk, so a rerun fetches only what is missing."""
        cache.mkdir(parents=True, exist_ok=True)
        ts = sorted(set(times))
        chunks = [ts[i : i + chunk] for i in range(0, len(ts), chunk)]
        pacer = _Pacer(self.rate_per_s)
        out: dict[int, Tick] = {}
        for n, part in enumerate(chunks, 1):
            identity = json.dumps([self.base_id, self.quote_id, part], separators=(",", ":")).encode()
            digest = hashlib.sha256(identity).hexdigest()[:16]
            path = cache / f"pyth_{part[0]}_{part[-1]}_{len(part)}_{digest}.jsonl.gz"
            if not path.exists():
                got: list[Tick] = []
                with ThreadPoolExecutor(self.workers) as ex:
                    futs = [ex.submit(self._get, t, pacer) for t in part]
                    got = [f.result() for f in as_completed(futs)]
                write_rows(path, (to_row(k) for k in sorted(got, key=lambda k: k.t)))
                log.info(
                    "chunk %d/%d written (%d times; rate %.2f/s; %d ok, %d throttled so far)",
                    n,
                    len(chunks),
                    len(part),
                    pacer.rate,
                    pacer.ok_count,
                    pacer.throttled_count,
                )
            rows = [from_row(r) for r in read_rows(path)]
            if len(rows) != len(part) or {k.t for k in rows} != set(part):
                raise HermesError(f"cached chunk {path.name} does not match its requested timestamps")
            out.update((k.t, k) for k in rows)
        return out
