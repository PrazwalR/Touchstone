#!/usr/bin/env bash
# Keeps the testnet demo pool usable (decision 0070). Three modes:
#
#   scripts/recenter-pool.sh check     arbitrum-sepolia   read-only: is the pool ready to demonstrate on?
#   scripts/recenter-pool.sh rehearse  arbitrum-sepolia   on a local fork: dump the pool, recentre it, verify
#   scripts/recenter-pool.sh run       arbitrum-sepolia   live: withdraw, move the price to Chainlink, seed again
#
# `run` is signed by the deployer's encrypted keystore. cast asks for the password itself; this script never sees
# it. Run it after the market has moved more than a few percent or the pool has been traded out of range, and
# before any recording.
#
#   set -a; . ./.env; set +a
#   scripts/recenter-pool.sh check arbitrum-sepolia
set -euo pipefail

mode="${1:?usage: scripts/recenter-pool.sh check|rehearse|run arbitrum-sepolia|base-sepolia}"
chain="${2:?usage: scripts/recenter-pool.sh check|rehearse|run arbitrum-sepolia|base-sepolia}"
root="$(cd "$(dirname "$0")/.." && pwd)"
contracts="$root/contracts"
config="$contracts/script/config/$chain.json"
[ -f "$config" ] || { echo "no config for $chain" >&2; exit 2; }
case "$chain" in
  arbitrum-sepolia) rpc_var=ARBITRUM_SEPOLIA_RPC_URL; port=8611 ;;
  base-sepolia) rpc_var=BASE_SEPOLIA_RPC_URL; port=8612 ;;
  *) echo "unsupported chain $chain" >&2; exit 2 ;;
esac
json() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); [d:=d[k] for k in sys.argv[2].split(".")]; print(d)' "$1" "$2"; }
fail() { echo "STOP: $1" >&2; exit 1; }

# Prints the pool's state and a verdict. $1 is the RPC URL, $2 the deployment record.
check() {
  local rpc="$1" dep="$2"
  local sv pool feed router risky quote
  sv="$(json "$config" stateView)"; pool="$(json "$dep" pool.poolId)"; feed="$(json "$config" referenceFeed)"
  router="$(json "$config" routers.poolModifyLiquidityTest)"; risky="$(json "$config" pool.risky)"; quote="$(json "$config" pool.quote)"
  local lo hi vault=""
  lo="$(json "$dep" pool.bandTickLower)"; hi="$(json "$dep" pool.bandTickUpper)"
  vault="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["pool"].get("vault",""))' "$dep")"
  local active fdec qdec rdec=18
  local slot0 round
  slot0=($(cast call "$sv" 'getSlot0(bytes32)(uint160,int24,uint24,uint24)' "$pool" --rpc-url "$rpc" | awk '{print $1}'))
  local sqrt="${slot0[0]}" tick="${slot0[1]}"
  active="$(cast call "$sv" 'getLiquidity(bytes32)(uint128)' "$pool" --rpc-url "$rpc" | awk '{print $1}')"
  round=($(cast call "$feed" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$rpc" | awk '{print $1}'))
  local ans="${round[1]}" fts="${round[3]}"
  fdec="$(cast call "$feed" 'decimals()(uint8)' --rpc-url "$rpc")"
  qdec="$(cast call "$quote" 'decimals()(uint8)' --rpc-url "$rpc")"
  [ "$risky" = "0x0000000000000000000000000000000000000000" ] || rdec="$(cast call "$risky" 'decimals()(uint8)' --rpc-url "$rpc")"
  local zero=0x0000000000000000000000000000000000000000000000000000000000000000
  local full_lo=-887220 full_hi=887220
  pos() { cast call "$sv" 'getPositionInfo(bytes32,address,int24,int24,bytes32)(uint128,uint256,uint256)' "$pool" "$1" "$2" "$3" "$zero" --rpc-url "$rpc" | head -1 | awk '{print $1}'; }
  local r_full r_band v_full=0 v_band=0
  r_full="$(pos "$router" "$full_lo" "$full_hi")"; r_band="$(pos "$router" "$lo" "$hi")"
  if [ -n "$vault" ]; then v_full="$(pos "$vault" "$full_lo" "$full_hi")"; v_band="$(pos "$vault" "$lo" "$hi")"; fi
  python3 -I - "$sqrt" "$tick" "$active" "$ans" "$fdec" "$fts" "$qdec" "$rdec" "$lo" "$hi" "$r_full" "$r_band" "$v_full" "$v_band" "${vault:-none}" "$(date +%s)" <<'PY'
import sys
sqrt,tick,active,ans,fdec,fts,qdec,rdec,lo,hi,rf,rb,vf,vb=map(int,sys.argv[1:15]); vault=sys.argv[15]; now=int(sys.argv[16])
# Currency0 is the risky token (native ETH) and currency1 the quote token on both demo pools.
pool=(sqrt/2**96)**2*10**(rdec-qdec)
ref=ans/10**fdec
gap=(ref-pool)/ref*1e4
edge=lambda t:1.0001**t*10**(rdec-qdec)
plo,phi=edge(lo),edge(hi)
age=now-fts
print(f"pool price        {pool:,.2f}")
print(f"chainlink         {ref:,.2f}   (updated {age} s ago)")
print(f"gap               {gap:+.0f} bps")
print(f"band              {plo:,.0f} to {phi:,.0f}   (ticks {lo} to {hi})")
print(f"active liquidity  {active:,}")
print(f"vault             {vault}")
bad=[]
if abs(gap)>200: bad.append(f"the pool is {abs(gap):.0f} bps from Chainlink")
if not (plo*1.01<=ref<=phi*0.99): bad.append("Chainlink is outside the liquidity band, or within 1% of its edge")
if not (plo<=pool<=phi): bad.append("the pool price is outside the liquidity band")
if rf>0 or rb>0: bad.append("liquidity is held by Uniswap's open test router: anyone can withdraw it")
if vf+vb==0 and rf+rb==0: bad.append("no liquidity positions were found")
if age>3600: bad.append(f"the Chainlink answer is {age} s old")
if bad:
    print("\nVERDICT: NEEDS RECENTER")
    for b in bad: print("  -",b)
    sys.exit(3)
print("\nVERDICT: READY")
PY
}

case "$mode" in
check)
  rpc="${!rpc_var:-}"; [ -n "$rpc" ] || fail "$rpc_var is not set"
  check "$rpc" "$contracts/deployments/$chain.json" || exit $?
  ;;
rehearse)
  fork_rpc="${!rpc_var:-$(json "$config" publicRpc)}"
  local_rpc="http://127.0.0.1:$port"
  key=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
  me=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  out="$contracts/test/integration/out/recenter-$chain"
  rm -rf "$out" && mkdir -p "$out"
  cp "$contracts/deployments/$chain.json" "$out/deployment.json"
  anvil --fork-url "$fork_rpc" --port "$port" --silent &
  anvil_pid=$!
  trap 'kill $anvil_pid 2>/dev/null || true' EXIT
  for _ in $(seq 1 100); do cast chain-id --rpc-url "$local_rpc" >/dev/null 2>&1 && break; sleep 0.2; done
  cd "$contracts"
  forge build >/dev/null
  if [ "$(json "$config" blockSource)" = "1" ]; then
    code="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["deployedBytecode"]["object"])' out/MockArbSys.sol/MockArbSys.json)"
    cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$code" --rpc-url "$local_rpc" >/dev/null
    cast send 0x0000000000000000000000000000000000000064 'setBlock(uint256)' "$(cast block-number --rpc-url "$local_rpc")" --private-key "$key" --rpc-url "$local_rpc" >/dev/null
  fi
  usdc="$(json "$config" pool.quote)"
  cast rpc anvil_setStorageAt "$usdc" "$(cast index address "$me" 9)" "$(cast to-uint256 1000000000000)" --rpc-url "$local_rpc" >/dev/null
  echo "== Before"
  check "$local_rpc" "$out/deployment.json" || true
  export CHAIN="$chain" DEPLOYMENT_OUT="test/integration/out/recenter-$chain/deployment.json" FOUNDRY_BROADCAST="test/integration/out/recenter-$chain/broadcast"
  echo; echo "== Recentre"
  forge script script/RecenterPool.s.sol:RecenterPool --rpc-url "$local_rpc" --private-key "$key" --sender "$me" --broadcast --slow 2>&1 | grep -E "^\s+(pool|reference|withdrawing|funds|backstop|band|vault)|Error|rror:" || true
  echo; echo "== After"
  check "$local_rpc" "$out/deployment.json" || fail "the rehearsal did not leave the pool ready"
  echo; echo "Rehearsal of $chain passed. Nothing live was touched."
  ;;
run)
  rpc="${!rpc_var:-}"; [ -n "$rpc" ] || fail "$rpc_var is not set"
  [ -n "${DEPLOYER_ADDRESS:-}" ] || fail "DEPLOYER_ADDRESS is not set"
  account="${DEPLOYER_ACCOUNT:-touchstone-deployer}"
  cast wallet list 2>/dev/null | grep -q "^$account" || fail "no cast keystore named $account; run: cast wallet import $account --interactive"
  [ "$(cast chain-id --rpc-url "$rpc")" = "$(json "$config" chainId)" ] || fail "$rpc_var serves another chain"
  echo "== Before"
  check "$rpc" "$contracts/deployments/$chain.json" || true
  usdc="$(json "$config" pool.quote)"
  echo; echo "deployer ETH  $(cast from-wei "$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$rpc")")"
  echo "deployer USDC $(python3 -I -c "print($(cast call "$usdc" 'balanceOf(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$rpc" | awk '{print $1}')/1e6)") (configured depth: $(python3 -I -c "print(($(json "$config" pool.liquidityQuote)+$(json "$config" pool.concentratedQuote))/1e6)") USDC)"
  echo; echo "== Rehearsal on a fork first"
  "$root/scripts/recenter-pool.sh" rehearse "$chain" >/dev/null || fail "the rehearsal failed; run scripts/recenter-pool.sh rehearse $chain to see why"
  echo "rehearsal passed"
  echo; echo "== Recentre (cast asks for the keystore password)"
  cd "$contracts"
  CHAIN="$chain" forge script script/RecenterPool.s.sol:RecenterPool --rpc-url "$rpc" --account "$account" --sender "$DEPLOYER_ADDRESS" --broadcast --slow
  cd "$root"
  echo; echo "== After"
  check "$rpc" "$contracts/deployments/$chain.json" || fail "the pool is still not ready; read the verdict above"
  echo; echo "Commit contracts/deployments/$chain.json: it now names the vault and the new band."
  ;;
*) fail "unknown mode $mode (check, rehearse, run)" ;;
esac
