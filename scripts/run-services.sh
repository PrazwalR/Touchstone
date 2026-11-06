#!/usr/bin/env bash
# Runs the off-chain services on this machine against the root .env: indexer, read-only history API, keeper and
# alert monitor, each logging to var/log/<service>.log. Ctrl-C stops all of them. The dashboard runs separately:
#   (cd frontend && VITE_HISTORY_URL=http://127.0.0.1:$INDEXER_API_PORT pnpm dev)
#
#   scripts/run-services.sh             # all four
#   scripts/run-services.sh indexer api # a subset
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$root/.env"
[ -f "$env_file" ] || { echo "no .env at $env_file" >&2; exit 2; }
logs="$root/var/log"
mkdir -p "$logs"

services=("$@")
[ ${#services[@]} -gt 0 ] || services=(indexer api keeper monitor)

echo "== preflight"
checks=()
for s in "${services[@]}"; do
  case "$s" in
    keeper) checks+=(keeper) ;;
    indexer|api|monitor) checks+=(indexer) ;;
    *) echo "unknown service $s (indexer, api, keeper, monitor)" >&2; exit 2 ;;
  esac
done
(cd "$root/backend" && node --env-file="$env_file" scripts/preflight.mjs "${checks[@]}") || {
  echo "preflight failed; fix the lines above before starting the keeper" >&2
  [[ " ${services[*]} " == *" keeper "* ]] && exit 1
}

pids=()
start() {
  local name="$1" dir="$2" script="$3"
  (cd "$root/backend/$dir" && exec node --env-file="$env_file" "$script") >>"$logs/$name.log" 2>&1 &
  pids+=($!)
  echo "started $name (pid $!), logging to var/log/$name.log"
}
stop() {
  trap - INT TERM EXIT
  echo "stopping"
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop INT TERM EXIT

for s in "${services[@]}"; do
  case "$s" in
    indexer) start indexer indexer src/main.ts ;;
    api) start api indexer src/api-main.ts ;;
    keeper) start keeper keeper src/main.ts ;;
    # The monitor reads the indexer's database, so it starts after the indexer has created it.
    monitor) sleep 3; start monitor indexer src/monitor-main.ts ;;
    *) echo "unknown service $s (indexer, api, keeper, monitor)" >&2; exit 2 ;;
  esac
done
echo "== running; Ctrl-C stops everything. Follow with: tail -f var/log/*.log"
# Portable to macOS's bash 3.2, which has no wait -n: poll until any service exits.
while :; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then echo "a service exited (pid $pid); see var/log" >&2; exit 1; fi
  done
  sleep 2
done
