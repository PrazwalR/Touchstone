#!/usr/bin/env bash
# Deploys the Touchstone core and the demo pool to a testnet (spec 19.3), signed by the owner's encrypted keystore.
# It rehearses on a fork first, checks funds, deploys with explorer verification, syncs the dashboard, and prints the
# environment lines the services need. cast asks for the keystore password itself; this script never sees it.
#
#   set -a; . ./.env; set +a
#   scripts/deploy-testnet.sh base-sepolia
#
# Needs: <CHAIN>_RPC_URL, ETHERSCAN_API_KEY (Etherscan API V2: one key for every chain), DEPLOYER_ADDRESS, and a
# keystore imported with `cast wallet import touchstone-deployer --interactive` (DEPLOYER_ACCOUNT overrides the name).
set -euo pipefail

chain="${1:?usage: scripts/deploy-testnet.sh arbitrum-sepolia|base-sepolia}"
root="$(cd "$(dirname "$0")/.." && pwd)"
contracts="$root/contracts"
config="$contracts/script/config/$chain.json"
case "$chain" in
  arbitrum-sepolia) rpc_var=ARBITRUM_SEPOLIA_RPC_URL ;;
  base-sepolia) rpc_var=BASE_SEPOLIA_RPC_URL ;;
  *) echo "unsupported chain $chain" >&2; exit 2 ;;
esac
json() { python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); [d:=d[k] for k in sys.argv[2].split(".")]; print(d)' "$1" "$2"; }
fail() { echo "STOP: $1" >&2; exit 1; }

rpc="${!rpc_var:-}"
[ -n "$rpc" ] || fail "$rpc_var is not set"
[ -n "${ETHERSCAN_API_KEY:-}" ] || fail "ETHERSCAN_API_KEY is not set (create one at etherscan.io; V2 keys work on every chain)"
[ -n "${DEPLOYER_ADDRESS:-}" ] || fail "DEPLOYER_ADDRESS is not set"
account="${DEPLOYER_ACCOUNT:-touchstone-deployer}"
cast wallet list 2>/dev/null | grep -q "^$account" || fail "no cast keystore named $account; run: cast wallet import $account --interactive"

want_chain="$(json "$config" chainId)"
[ "$(cast chain-id --rpc-url "$rpc")" = "$want_chain" ] || fail "$rpc_var serves another chain"

echo "== Funds of $DEPLOYER_ADDRESS on $chain"
usdc="$(json "$config" pool.quote)"
need_usdc="$(( $(json "$config" pool.liquidityQuote) + $(json "$config" pool.concentratedQuote) ))"
eth="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$rpc")"
usdc_bal="$(cast call "$usdc" 'balanceOf(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$rpc" | awk '{print $1}')"
# The risky side of both positions is worth about the quote side at the Chainlink price CreatePool starts from;
# the margin covers rounding and price movement, and 0.005 ETH covers gas (about 0.0005 ETH measured in rehearsal).
feed="$(json "$config" referenceFeed)"
answer="$(cast call "$feed" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url "$rpc" | sed -n 2p | awk '{print $1}')"
feed_dec="$(cast call "$feed" 'decimals()(uint8)' --rpc-url "$rpc")"
margin="$(json "$config" pool.liquidityRiskyMarginBps)"
need_eth="$(python3 -I -c "print(int($need_usdc * 10**12 * 10**$feed_dec * (10000 + $margin) // ($answer * 10000)) + 5 * 10**15)")"
echo "ETH  $(cast from-wei "$eth") (pool seed and gas need $(cast from-wei "$need_eth"))"
echo "USDC $(python3 -I -c "print($usdc_bal/1e6)") (pool seed needs $(python3 -I -c "print($need_usdc/1e6)"))"
[ "$eth" -ge "$need_eth" ] || fail "deployer needs at least $(cast from-wei "$need_eth") ETH on $chain"
[ "$usdc_bal" -ge "$need_usdc" ] || fail "deployer needs at least $need_usdc USDC base units (faucet.circle.com), or lower pool.concentratedQuote in $config"

echo "== Fork rehearsal"
"$root/scripts/rehearse-deploy.sh" "$chain" >/dev/null || fail "fork rehearsal failed; run scripts/rehearse-deploy.sh $chain to see why"
echo "rehearsal passed"

cd "$contracts"
export CHAIN="$chain"
unset DEPLOYMENT_OUT FOUNDRY_BROADCAST
echo "== DeployCore (cast asks for the keystore password)"
forge script script/DeployCore.s.sol:DeployCore --rpc-url "$rpc" --account "$account" --sender "$DEPLOYER_ADDRESS" \
  --broadcast --slow --verify --etherscan-api-key "$ETHERSCAN_API_KEY"
echo "== CreatePool (password again)"
forge script script/CreatePool.s.sol:CreatePool --rpc-url "$rpc" --account "$account" --sender "$DEPLOYER_ADDRESS" \
  --broadcast --slow

cd "$root"
node frontend/scripts/sync-contracts.mjs
dep="contracts/deployments/$chain.json"
start="$(python3 -I -c 'import json,sys; r=json.load(open(sys.argv[1]))["receipts"]; print(min(int(x["blockNumber"],16) for x in r))' "contracts/broadcast/DeployCore.s.sol/$want_chain/run-latest.json")"
cat <<EOF

== Deployed. Put these in .env (use a fresh KEEPER_STATE_PATH, KEEPER_METRICS_PATH and INDEXER_DATABASE_PATH: the
== old files describe the previous contracts).
TOUCHSTONE_HOOK=$(json "$dep" hook)
TOUCHSTONE_SETTLER=$(json "$dep" settler)
TOUCHSTONE_FACTORY=$(json "$dep" factory)
TOUCHSTONE_LEDGER=$(json "$dep" ledger)
TOUCHSTONE_LICENCE=$(json "$dep" licenceAuction)
KEEPER_START_BLOCK=$start
INDEXER_START_BLOCK=$start
# Pool $(json "$dep" pool.poolId)
# If verification was interrupted: cd contracts && CHAIN=$chain forge script script/DeployCore.s.sol:DeployCore \\
#   --rpc-url \$$rpc_var --account $account --sender $DEPLOYER_ADDRESS --resume --verify --etherscan-api-key \$ETHERSCAN_API_KEY
EOF
