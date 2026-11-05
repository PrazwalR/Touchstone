"""Uniswap v3 Swap logs for one pool over the M4 window, with block timestamps from the logs."""

from __future__ import annotations

import argparse
import logging

from tsr.chunks import fetch_all
from tsr.config import DATA_DIR, ETH_USDC_WETH_500, WINDOW_END, WINDOW_START, Pool
from tsr.rpc import Rpc, RpcError, hex_int, signed
from tsr.store import Row, write_rows

log = logging.getLogger("tsr.ingest_swaps")

# keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
# drpc's free tier serves eth_getLogs over at most about 100 blocks (checked 28 October 2026).
CHUNK_BLOCKS = 100
WORKERS = 3


def decode_swap(entry: dict[str, object]) -> Row:
    data = entry["data"]
    if not isinstance(data, str) or len(data) != 2 + 64 * 5:
        raise RpcError("malformed Swap data")
    words = [int(data[2 + 64 * i : 2 + 64 * (i + 1)], 16) for i in range(5)]
    if "blockTimestamp" not in entry:
        raise RpcError("rpc does not return blockTimestamp on logs")
    return {
        "block": hex_int(entry["blockNumber"]),
        "ts": hex_int(entry["blockTimestamp"]),
        "tx": str(entry["transactionHash"]).lower(),
        "txIndex": hex_int(entry["transactionIndex"]),
        "logIndex": hex_int(entry["logIndex"]),
        "amount0": signed(words[0]),
        "amount1": signed(words[1]),
        "sqrtPriceX96": words[2],
        "liquidity": words[3],
        "tick": signed(words[4]),
    }


def fetch_chunk(rpc: Rpc, pool: Pool, start: int, end: int) -> list[Row]:
    result = rpc.call(
        "eth_getLogs",
        [{"address": pool.address, "fromBlock": hex(start), "toBlock": hex(end), "topics": [SWAP_TOPIC]}],
    )
    if not isinstance(result, list):
        raise RpcError("eth_getLogs returned a non-list")
    rows = []
    for e in result:
        if not isinstance(e, dict) or e.get("removed"):
            continue
        rows.append(decode_swap(e))
    return rows


def block_range(rpc: Rpc, start_ts: int, end_ts: int) -> tuple[int, int]:
    head = rpc.block_number()
    first = rpc.first_block_at_or_after(start_ts, 1, head)
    last = rpc.first_block_at_or_after(end_ts, first, head) - 1
    return first, last


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--rpc", default="https://eth.drpc.org")
    args = p.parse_args()
    rpc = Rpc(args.rpc)
    pool = ETH_USDC_WETH_500
    first, last = block_range(rpc, WINDOW_START, WINDOW_END)
    log.info("blocks %d..%d", first, last)
    jobs = [(pool.chain, s, min(s + CHUNK_BLOCKS - 1, last)) for s in range(first, last + 1, CHUNK_BLOCKS)]
    rows = fetch_all(DATA_DIR / "chunks" / "swaps", jobs, lambda _t, a, b: fetch_chunk(rpc, pool, a, b), WORKERS)
    rows.sort(key=lambda r: (int(str(r["block"])), int(str(r["logIndex"]))))
    out = DATA_DIR / f"swaps_{pool.chain}_{first}_{last}.jsonl.gz"
    n = write_rows(out, rows)
    log.info("wrote %d swaps to %s", n, out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
