#!/usr/bin/env bash
# Fork rehearsal of a testnet deployment (spec 19.3, step 1). Forks the chain in anvil, deploys the core and the
# demo pool with the real scripts and the chain's config, then checks the wiring, URC-4, a flagged swap and a full
# bid-to-activation cycle on the licence. Nothing touches the live chain: every transaction goes to the local fork,
# signed by anvil's public development key, and broadcast records go to a scratch folder so the real deployment's
# records are never overwritten.
#
#   scripts/rehearse-deploy.sh arbitrum-sepolia
#   scripts/rehearse-deploy.sh base-sepolia
set -euo pipefail

chain="${1:?usage: scripts/rehearse-deploy.sh arbitrum-sepolia|base-sepolia}"
root="$(cd "$(dirname "$0")/.." && pwd)"
contracts="$root/contracts"
config="$contracts/script/config/$chain.json"
[ -f "$config" ] || { echo "no config for $chain" >&2; exit 2; }
case "$chain" in
  arbitrum-sepolia) rpc_var=ARBITRUM_SEPOLIA_RPC_URL; port=8601 ;;
  base-sepolia) rpc_var=BASE_SEPOLIA_RPC_URL; port=8602 ;;
  *) echo "unsupported chain $chain" >&2; exit 2 ;;
esac
json() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); [d:=d[k] for k in sys.argv[2].split(".")]; print(d)' "$1" "$2"; }
# The configured RPC if set, else the chain's public endpoint. Either way it is only read from.
fork_rpc="${!rpc_var:-$(json "$config" publicRpc)}"
local_rpc="http://127.0.0.1:$port"
# Anvil's first development account: a public key, funded only on this local fork.
key=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
me=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
out="$contracts/test/integration/out/rehearsal-$chain"
rm -rf "$out" && mkdir -p "$out"
deployment="test/integration/out/rehearsal-$chain/deployment.json"

anvil --fork-url "$fork_rpc" --port "$port" --silent &
anvil_pid=$!
trap 'kill $anvil_pid 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1 && break; sleep 0.2; done
step() { printf '\n== %s\n' "$1"; }
check() { if [ "$(echo "$2" | tr 'A-F' 'a-f')" = "$(echo "$3" | tr 'A-F' 'a-f')" ]; then echo "ok   $1"; else echo "FAIL $1: got $2, want $3" >&2; exit 1; fi; }

cd "$contracts"
if [ "$(json "$config" blockSource)" = "1" ]; then
  step "Arbitrum fork: anvil has no ArbSys precompile, so MockArbSys code is placed at 0x64"
  forge build >/dev/null
  code="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["deployedBytecode"]["object"])' out/MockArbSys.sol/MockArbSys.json)"
  cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$code" --rpc-url "$local_rpc" >/dev/null
fi

step "Fund the development account with fork-only USDC (Circle FiatToken balances live in slot 9)"
usdc="$(json "$config" pool.quote)"
slot="$(cast index address "$me" 9)"
cast rpc anvil_setStorageAt "$usdc" "$slot" "$(cast to-uint256 1000000000000)" --rpc-url "$local_rpc" >/dev/null
check "USDC balance" "$(cast call "$usdc" 'balanceOf(address)(uint256)' "$me" --rpc-url "$local_rpc" | awk '{print $1}')" 1000000000000

export CHAIN="$chain" DEPLOYMENT_OUT="$deployment" FOUNDRY_BROADCAST="$out/broadcast"
step "DeployCore"
forge script script/DeployCore.s.sol:DeployCore --rpc-url "$local_rpc" --private-key "$key" --sender "$me" --broadcast --slow >"$out/deploy-core.log" 2>&1 \
  || { tail -30 "$out/deploy-core.log" >&2; exit 1; }
step "CreatePool"
forge script script/CreatePool.s.sol:CreatePool --rpc-url "$local_rpc" --private-key "$key" --sender "$me" --broadcast --slow >"$out/create-pool.log" 2>&1 \
  || { tail -30 "$out/create-pool.log" >&2; exit 1; }

hook="$(json "$deployment" hook)"; lens="$(json "$deployment" lens)"; licence="$(json "$deployment" licenceAuction)"
settler="$(json "$deployment" settler)"; factory="$(json "$deployment" factory)"; pool="$(json "$deployment" pool.poolId)"
c0="$(json "$deployment" pool.currency0)"; c1="$(json "$deployment" pool.currency1)"
fee="$(json "$deployment" pool.fee)"; spacing="$(json "$deployment" pool.tickSpacing)"
poolkey="($c0,$c1,$fee,$spacing,$hook)"

step "Wiring"
check "hook address flag bits" "$(python3 -I -c "print(hex(int('$hook',16) & 0x3fff))")" 0x20c4
check "hook.LICENCE" "$(cast call "$hook" 'LICENCE()(address)' --rpc-url "$local_rpc")" "$licence"
check "hook.LENS" "$(cast call "$hook" 'LENS()(address)' --rpc-url "$local_rpc")" "$lens"
check "hook.SETTLER" "$(cast call "$hook" 'SETTLER()(address)' --rpc-url "$local_rpc")" "$settler"
check "lens.HOOK" "$(cast call "$lens" 'HOOK()(address)' --rpc-url "$local_rpc")" "$hook"
check "auction.HOOK" "$(cast call "$licence" 'HOOK()(address)' --rpc-url "$local_rpc")" "$hook"
check "factory.LICENCE" "$(cast call "$factory" 'LICENCE()(address)' --rpc-url "$local_rpc")" "$licence"
check "lease notice" "$(cast call "$licence" 'terms(bytes32)(address,uint32,uint16,uint128)' "$pool" --rpc-url "$local_rpc" | sed -n 2p)" "$(json "$config" pool.lease.k)"

step "URC-4 through the hook's fallback"
alf_id="$(python3 -I - <<'PY'
import subprocess
sigs = [
    "getIndicativeQuote((address,address,uint24,int24,address),bool,int256,bytes)",
    "isLive()",
    "maxGas()",
    "swapToPrice((address,address,uint24,int24,address),bool,int256,uint160,bytes)",
]
x = 0
for s in sigs:
    x ^= int(subprocess.check_output(["cast", "sig", s]).decode().strip(), 16)
print(f"0x{x:08x}")
PY
)"
check "supportsInterface(IALFHook)" "$(cast call "$hook" 'supportsInterface(bytes4)(bool)' "$alf_id" --rpc-url "$local_rpc")" true
check "isLive()" "$(cast call "$hook" 'isLive()(bool)' --rpc-url "$local_rpc")" true
echo "maxGas() = $(cast call "$hook" 'maxGas()(uint32)' --rpc-url "$local_rpc")"
quote_is0=$([ "$(echo "$c0" | tr 'A-F' 'a-f')" = "$(echo "$usdc" | tr 'A-F' 'a-f')" ] && echo true || echo false)
buy_zfo=$quote_is0
indicative="$(cast call --rpc-url "$local_rpc" "$hook" 'getIndicativeQuote((address,address,uint24,int24,address),bool,int256,bytes)(uint256)' -- "$poolkey" "$buy_zfo" -6000000 0x | awk '{print $1}')"
[ "${indicative:-0}" -gt 0 ] && echo "ok   indicative output for a 6 USDC buy: $indicative base units" || { echo "FAIL URC-4 quote: '$indicative'" >&2; exit 1; }

step "A flagged swap through Uniswap's PoolSwapTest opens a record"
swap_router="$(json "$config" routers.poolSwapTest)"
cast send "$usdc" 'approve(address,uint256)' "$swap_router" 100000000 --private-key "$key" --rpc-url "$local_rpc" >/dev/null
if [ "$(json "$config" blockSource)" = "1" ]; then
  # The live ArbSys advances every L2 block; the stand-in only moves when told, and first touch needs a new block.
  cast send 0x0000000000000000000000000000000000000064 'setBlock(uint256)' "$(cast block-number --rpc-url "$local_rpc")" \
    --private-key "$key" --rpc-url "$local_rpc" >/dev/null
fi
state='poolState(bytes32)((uint64,uint64,uint40,uint104,uint104,uint40,uint128,uint128,uint128,uint128,uint128,uint128))'
next_record() { cast call "$hook" "$state" "$pool" --rpc-url "$local_rpc" | tr -d '()' | awk -F', ' '{print $2}' | awk '{print $1}'; }
before="$(next_record)"
limit=$([ "$buy_zfo" = true ] && echo 4295128740 || echo 1461446703485210103287273052203988822378723970341)
cast send "$swap_router" 'swap((address,address,uint24,int24,address),(bool,int256,uint160),(bool,bool),bytes)' \
  "$poolkey" "($buy_zfo,-6000000,$limit)" "(false,false)" 0x --private-key "$key" --rpc-url "$local_rpc" >/dev/null
after="$(next_record)"
check "records opened by the swap" "$((after - before))" 1

step "Licence: bid, notice, activation"
k="$(json "$config" pool.lease.k)"
cast send "$usdc" 'approve(address,uint256)' "$licence" "$((k * 10))" --private-key "$key" --rpc-url "$local_rpc" >/dev/null
cast send "$licence" 'bid(bytes32,address,uint128,uint128)' "$pool" "$me" 1 "$((k * 10))" --private-key "$key" --rpc-url "$local_rpc" >/dev/null
cast rpc evm_increaseTime "$((k + 1))" --rpc-url "$local_rpc" >/dev/null && cast rpc evm_mine --rpc-url "$local_rpc" >/dev/null
check "holderOf after K seconds" "$(cast call "$licence" 'holderOf(bytes32)(address,bool)' "$pool" --rpc-url "$local_rpc" | tr '\n' ' ' | xargs)" "$me true"

printf '\nRehearsal of %s passed. Planned addresses (fork only, not a deployment): %s\n' "$chain" "$out/deployment.json"
