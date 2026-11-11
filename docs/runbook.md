# Runbook

Testnet operations for Touchstone (spec 19.3 to 19.5). There is no pause and no owner: operating means deploying,
watching and, if needed, migrating. Every service here is read-only toward users' funds except the keeper, which
only settles, expires, drips and accrues, and earns tips for it.

## 1. Deploy (owner-signed)

1. Put in `.env`: `<CHAIN>_RPC_URL`, `ETHERSCAN_API_KEY`, `DEPLOYER_ADDRESS`, and import the deployer once with
   `cast wallet import touchstone-deployer --interactive`.
2. Fund the deployer on the target chain with the pool seed in USDC (`pool.liquidityQuote` plus
   `pool.concentratedQuote`: 15 + 60 = 75 USDC on both testnets; faucet.circle.com) and the matching ETH, about
   0.035 ETH at 2,200 USDC per ETH plus 0.005 for gas. `deploy-testnet.sh` prints the exact amounts from the live
   Chainlink price and stops before broadcasting if either is short. Decision 0067 explains the band.
3. Rehearse on a fork, then deploy:

   ```sh
   set -a; . ./.env; set +a
   scripts/rehearse-deploy.sh base-sepolia      # optional; deploy-testnet.sh runs it first anyway
   scripts/deploy-testnet.sh base-sepolia       # asks for the keystore password twice
   ```

4. Copy the printed `TOUCHSTONE_*` and start-block lines into `.env`. Use fresh `KEEPER_STATE_PATH`,
   `KEEPER_METRICS_PATH` and `INDEXER_DATABASE_PATH` files: the old ones describe the previous contracts.
5. Record the addresses, verification links and transactions in `DEPLOYMENTS.md`, keeping the earlier deployment's
   section: contracts are immutable, so a redeploy is a new set beside the old one.

If verification was interrupted, the script prints the `--resume --verify` command that retries it.

## 2. Run the services (this machine)

```sh
pnpm -C backend preflight          # config, key file permissions, deployment wiring; read-only
scripts/run-services.sh            # indexer, history API, keeper, alert monitor; logs in var/log/
(cd frontend && VITE_HISTORY_URL=http://127.0.0.1:$INDEXER_API_PORT pnpm dev)
```

The keeper refuses to start if the configured addresses are not one deployment on the configured chain. The
keystore and its password file must be mode 600; the password file holds only the password.

## 3. Alerts (spec 15.6)

The monitor posts to the Discord webhook in `MONITOR_DISCORD_WEBHOOK_URL`. Each condition is sent once, repeated
every `MONITOR_COOLDOWN_S` while it lasts, and followed by a RESOLVED line when it clears. Events (expiries,
deferred refunds, a bid about to activate) are sent once. On start the monitor posts one line, which confirms the
webhook works.

| Alert | A situation that fires it | What it means | Response |
| --- | --- | --- | --- |
| Settlement lag p95 above the settle delay + 30 s | Hermes is slow or the keeper polls every 2 minutes; settled records took 3 s + 95 s at p95 | Records wait longer than designed; traders' refunds are late | Check keeper logs and Hermes; shorten `KEEPER_POLL_INTERVAL_MS` |
| Record expired | The keeper was down for the whole settlement window (24 h on testnet), or Hermes never served the update after t0 | The deposit went back in full; any value it would have retained for LPs is lost | Find why no one settled; restart the keeper; check Hermes coverage of that feed |
| Refund deferred | The swapper is a contract that rejects the refund token, so the refund was parked in the ledger | Funds are safe and claimable by the beneficiary with `claim` | None for the protocol; tell the integrator their contract cannot receive the token |
| Keeper metrics missing or stale | The keeper process died, its RPC is down, or every tick fails | Nobody is settling for us; anyone else still can | Restart with `scripts/run-services.sh keeper`; read `var/log/keeper.log` |
| Keeper balance below a day of gas | The keeper spent 0.002 ETH in the last 24 h and holds 0.0015 ETH | Within a day it cannot pay for settlements | Send ETH to the keeper account |
| Hermes errors above 1% | The Hermes API key expired (401s), or Hermes returns 5xx | Settlements will retry and may expire | Check the key and Hermes status; a 404 before an update exists is normal and not counted |
| Licence runs out soon | The holder's deposit covers less than `MONITOR_LEASE_WARN_S` more seconds of rent | The pool returns to the plain clawback when it lapses | Nothing required (spec 19.5); the holder may top up |
| Pending bid activates soon | A rival bid was placed and its notice period is ending | The licence changes hands; the old holder's remainder is refunded | Nothing required; the old holder can still outbid until then |
| Monitor cannot read | RPC, database or metrics file unreadable | Alerts are blind | Fix the monitor's inputs first |

## 4. Incidents (spec 19.5)

| Event | Response |
| --- | --- |
| Keeper down | Restart it; any third party can settle meanwhile. Records past their latest usable time expire and refund |
| Hermes outage | The keeper retries until the latest usable time, then lets records expire |
| `maxOutstanding` reached | New swaps post no deposit until settlements free room; investigate the keeper |
| Licence lapses | Nothing to do; the pool falls back to the plain clawback |
| Calendar within 30 days of `validUntil` | Deploy a pool with a new calendar and announce the move to LPs |
| Pyth feed deprecated | Deploy a new pool with the replacement feed ID |
| Bug found | Publish it, stop routing new flow to the pool, keep settling open records so traders get refunds, and help LPs exit; the hook never blocks withdrawals |

## 5. Demonstration bots

`BOT_MODE=retail|outsider|holder|bidder` with `BOT_SUBMIT=false` simulates only and loads no key. Approvals are never
made by the bots: approve the bounded amount yourself first (`cast send <token> 'approve(address,uint256)' ...`).
Each run records a transaction for the release checklist (spec 19.3, step 4).

## 6. Demo pool upkeep

The demo pool is small and open to anyone, and ETH moves. Before any demonstration or recording, run the read-only
check from the repository root with the environment loaded:

```sh
set -a; . ./.env; set +a
scripts/recenter-pool.sh check arbitrum-sepolia
```

It prints the pool price, the Chainlink price, the gap, the liquidity band, who owns the liquidity, and a verdict. A
verdict of `NEEDS RECENTER` means the pool is more than 200 bps from Chainlink, Chainlink is outside or at the edge of
the band, or the liquidity sits with Uniswap's open test router (anyone can withdraw it). To fix it:

```sh
scripts/recenter-pool.sh rehearse arbitrum-sepolia   # optional: dumps a fork of the pool and recentres it
scripts/recenter-pool.sh run arbitrum-sepolia        # live; asks for the deployer keystore password
```

`run` rehearses first, then withdraws every position, moves the price onto Chainlink, and seeds the backstop and the band
again inside an owner-only vault, sized to what the deployer holds. If the deployer has less than the configured depth
(`liquidityQuote` plus `concentratedQuote`, plus the matching ETH) the pool is seeded thinner and the share is printed;
top up and run again for full depth. Commit the updated `contracts/deployments/<chain>.json`, which names the vault and
the band. Decision 0070 has the reasoning and the limits: swaps stay permissionless, so check again just before
presenting.
