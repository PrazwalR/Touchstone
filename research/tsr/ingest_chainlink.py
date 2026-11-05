"""Chainlink AnswerUpdated logs for ETH/USD, from every aggregator behind the proxy in the window."""

from __future__ import annotations

import argparse
import logging

from tsr.chunks import fetch_all
from tsr.config import CHAINLINK_ETH_USD_PROXY, DATA_DIR, REFERENCE_MAX_AGE, WINDOW_END, WINDOW_START
from tsr.ingest_swaps import block_range
from tsr.rpc import Rpc, RpcError, hex_int, signed
from tsr.store import Row, write_rows

log = logging.getLogger("tsr.ingest_chainlink")

# keccak256("AnswerUpdated(int256,uint256,uint256)")
ANSWER_UPDATED = "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f"
AGGREGATOR_SELECTOR = "0x245a7bfc"  # aggregator()
CHUNK_BLOCKS = 100
WORKERS = 2


def aggregator_at(rpc: Rpc, block: int) -> str:
    word = rpc.eth_call(CHAINLINK_ETH_USD_PROXY, AGGREGATOR_SELECTOR, block)
    return "0x" + word[-40:]


def fetch_chunk(rpc: Rpc, agg: str, start: int, end: int) -> list[Row]:
    res = rpc.call(
        "eth_getLogs",
        [{"address": agg, "fromBlock": hex(start), "toBlock": hex(end), "topics": [ANSWER_UPDATED]}],
    )
    if not isinstance(res, list):
        raise RpcError("eth_getLogs returned a non-list")
    rows: list[Row] = []
    for e in res:
        if not isinstance(e, dict) or e.get("removed"):
            continue
        topics = e["topics"]
        if not isinstance(topics, list) or len(topics) != 3:
            raise RpcError("malformed AnswerUpdated")
        rows.append(
            {
                "aggregator": agg,
                "block": hex_int(e["blockNumber"]),
                "logIndex": hex_int(e["logIndex"]),
                "answer": signed(int(str(topics[1]), 16)),
                "round": int(str(topics[2]), 16),
                "updatedAt": int(str(e["data"]), 16),
            }
        )
    return rows


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--rpc", default="https://eth.drpc.org")
    args = p.parse_args()
    rpc = Rpc(args.rpc)
    # Start one max-age earlier so the answer standing at the window's first swap is known.
    first, last = block_range(rpc, WINDOW_START - REFERENCE_MAX_AGE, WINDOW_END)
    aggregators = sorted({aggregator_at(rpc, first), aggregator_at(rpc, last)})
    log.info("aggregators %s over blocks %d..%d", aggregators, first, last)
    jobs = [
        (agg, st, min(st + CHUNK_BLOCKS - 1, last))
        for agg in aggregators
        for st in range(first, last + 1, CHUNK_BLOCKS)
    ]
    rows = fetch_all(DATA_DIR / "chunks" / "chainlink", jobs, lambda a, s, e: fetch_chunk(rpc, a, s, e), WORKERS)
    rows.sort(key=lambda r: (int(str(r["block"])), int(str(r["logIndex"]))))
    out = DATA_DIR / f"chainlink_eth_usd_{first}_{last}.jsonl.gz"
    log.info("wrote %d answers to %s", write_rows(out, rows), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
