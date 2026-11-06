"""Capture a complete local Anvil seed and subsequent mined calls for the offline Cancun replayer."""

import argparse
import gzip
import json
from pathlib import Path
from typing import Any, TypeVar
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

T = TypeVar("T")


def capture(rpc_url: str, args: argparse.Namespace) -> dict[str, Any]:
    if urlsplit(rpc_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("capture requires a local, fully populated Anvil chain")

    def rpc(method: str, params: list[object], expected: type[T]) -> T:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = Request(rpc_url, body, {"Content-Type": "application/json"})
        with urlopen(req, timeout=60) as response:
            result = json.load(response)
        if "error" in result:
            raise ValueError(f"{method}: {result['error']}")
        value: object = result["result"]
        if not isinstance(value, expected):
            raise ValueError(f"{method}: unexpected result type")
        return value

    node = rpc("anvil_nodeInfo", [], dict)
    if node["hardFork"] != "Cancun" or node["forkConfig"]["forkUrl"] is not None:
        raise ValueError("replay requires an unforked local Cancun chain")
    chain_id = int(rpc("eth_chainId", [], str), 16)
    if args.command == "snapshot":
        stack = json.loads(args.stack.read_text())
        state = json.loads(gzip.decompress(bytes.fromhex(rpc("anvil_dumpState", [], str)[2:])))
        height = state["best_block_number"]
        header = rpc("eth_getBlockByNumber", [hex(height), False], dict)
        if header["hash"] != node["currentBlockHash"]:
            raise ValueError("chain changed while taking the snapshot")
        return {
            "chain_id": chain_id,
            "hook": stack["hook"],
            "manager": stack["poolManager"],
            "snapshot_block": height,
            "snapshot_hash": header["hash"],
            "accounts": state["accounts"],
        }

    tape = json.loads(args.seed.read_text())
    start = tape["snapshot_block"]
    end = int(rpc("eth_blockNumber", [], str), 16) if args.end is None else args.end
    if chain_id != tape["chain_id"] or end <= start:
        raise ValueError("expected later blocks on seed chain")
    # Include all transactions in canonical order; skipping an approval, liquidity change or
    # earlier trader would change all later receipt comparisons. Supply BLOCKHASH history too.
    hashes: dict[int, str] = {}
    calls = []
    for n in range(max(0, start - 255), end + 1):
        block = rpc("eth_getBlockByNumber", [hex(n), True], dict)
        if n == start and block["hash"] != tape.pop("snapshot_hash"):
            raise ValueError("snapshot block differs from current chain")
        if n - 1 in hashes and block["parentHash"] != hashes[n - 1]:
            raise ValueError("chain changed during capture")
        hashes[n] = block["hash"]
        if n <= start:
            continue
        for tx in block["transactions"]:
            if int(tx["type"], 16) not in (0, 2) or tx["to"] is None or tx.get("accessList"):
                raise ValueError("only legacy and EIP-1559 calls with empty access lists are supported")
            r = rpc("eth_getTransactionReceipt", [tx["hash"]], dict)
            if r["blockHash"] != block["hash"]:
                raise ValueError("chain changed during capture")
            calls.append(
                {
                    "block": n,
                    "timestamp": int(block["timestamp"], 16),
                    "beneficiary": block["miner"],
                    "block_gas_limit": int(block["gasLimit"], 16),
                    "base_fee": int(block["baseFeePerGas"], 16),
                    "excess_blob_gas": int(block["excessBlobGas"], 16),
                    "prevrandao": block["mixHash"],
                    "caller": tx["from"],
                    "to": tx["to"],
                    "nonce": int(tx["nonce"], 16),
                    "value": tx["value"],
                    "data": tx["input"],
                    "gas_limit": int(tx["gas"], 16),
                    "gas_price": int(tx.get("maxFeePerGas", tx["gasPrice"]), 16),
                    "priority_fee": int(tx["maxPriorityFeePerGas"], 16) if tx.get("maxPriorityFeePerGas") else None,
                    "expected": {
                        "success": int(r["status"], 16) == 1,
                        "gas_used": int(r["gasUsed"], 16),
                        "logs": [{k: log[k] for k in ("address", "topics", "data")} for log in r["logs"]],
                    },
                }
            )
    if not calls:
        raise ValueError("no mined calls after snapshot")
    return {**tape, "block_hashes": hashes, "calls": calls}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rpc", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    seed = sub.add_parser("snapshot")
    seed.add_argument("--stack", required=True, type=Path)
    tape = sub.add_parser("tape")
    tape.add_argument("--seed", required=True, type=Path)
    tape.add_argument("--end", type=int)
    for p in (seed, tape):
        p.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = capture(args.rpc, args)
    with args.output.open("x") as out:
        json.dump(result, out, separators=(",", ":"))


if __name__ == "__main__":
    main()
