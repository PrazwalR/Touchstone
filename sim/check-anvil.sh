#!/usr/bin/env bash
# Replay an approval and two guarded swaps mined on a disposable local Cancun chain.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
port=${REPLAY_PORT:?set REPLAY_PORT to an unused local port}
[[ $port =~ ^[0-9]+$ ]] && ((port > 0 && port < 65536)) || exit 2
rpc="http://127.0.0.1:$port"
work=$(mktemp -d)
stack_rel="test/integration/out/replay-$port.json"
stack="$root/contracts/$stack_rel"
[[ ! -e "$stack" ]] || { echo "refusing to overwrite $stack" >&2; exit 1; }
anvil --port "$port" --host 127.0.0.1 --hardfork cancun --disable-code-size-limit >"$work/anvil.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -rf "$work"; rm -f "$stack"' EXIT
for ((i=0; i<100; i++)); do
  kill -0 "$pid"
  if grep -q "Listening on" "$work/anvil.log"; then break; fi
  sleep 0.1
done
grep -q "Listening on" "$work/anvil.log"
sender=$(cast rpc eth_accounts --rpc-url "$rpc" | jq -r '.[0]')
cd "$root/contracts"
mkdir -p test/integration/out
STACK_OUT="$stack_rel" forge script test/integration/LocalStack.s.sol --rpc-url "$rpc" --sender "$sender" \
  --unlocked --broadcast --slow --disable-code-size-limit >"$work/deploy.log" 2>&1 || { tail -20 "$work/deploy.log"; exit 1; }
cd "$root/sim"
python3 -I capture.py --rpc "$rpc" snapshot --stack "$stack" --output "$work/seed.json"
read_addr(){ jq -er ".$1" "$stack"; }
quote=$(read_addr usdc)
risky=$(read_addr weth)
router=$(read_addr guardedRouter)
hook=$(read_addr hook)
# Test inputs chosen on opposite sides of the fixture's notional floor.
small=1000000000
large=20000000000
cast send --rpc-url "$rpc" --unlocked --from "$sender" "$quote" 'approve(address,uint256)' "$router" "$((small+large))" >/dev/null
if jq -e '.quoteIs0' "$stack" >/dev/null; then
  key="($quote,$risky,500,60,$hook)"
  direction=true
  limit=4295128740
else
  key="($risky,$quote,500,60,$hook)"
  direction=false
  limit=1461446703485210103287273052203988822378723970341
fi
for amount in "$small" "$large"; do
  cast send --rpc-url "$rpc" --unlocked --from "$sender" "$router" \
    'swapGuarded((address,address,uint24,int24,address),(bool,int256,uint160),(uint256,uint256,uint256,uint256),address,uint256)' \
    "$key" "($direction,-$amount,$limit)" "(1000000000000000000,1,1,$amount)" "$sender" 18446744073709551615 >/dev/null
done
python3 -I capture.py --rpc "$rpc" tape --seed "$work/seed.json" --output "$work/tape.json"
cargo run --locked -- "$root/contracts/out" "$work/tape.json" >"$work/receipts.json"
# Require actual execution through both contracts, including a DepositTaken on the large swap.
topic=$(cast keccak "$(jq -r '.[] | select(.name=="DepositTaken") | .name+"("+([.inputs[]|if .type=="tuple" then "("+([.components[].type]|join(","))+")" else .type end]|join(","))+")"' "$root/frontend/abi/TouchstoneHook.json")")
jq -e --arg topic "$topic" 'length == 3 and all(.[]; .success) and
  ([.[1].logs[].topics[0]] | index($topic) == null) and
  ([.[2].logs[].topics[0]] | index($topic) != null)' "$work/receipts.json" >/dev/null
