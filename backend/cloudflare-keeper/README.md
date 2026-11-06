# Cloudflare keeper

This Worker runs the existing Touchstone settlement engine in a single SQLite-backed Durable Object.
The Node keeper and contracts remain usable as before. The only shared engine changes add optional
per-run scan/record bounds; the Node process keeps its original defaults.

## What runs

- Alarms discover deposits, obtain the signed historical Pyth updates, simulate settlement, and send it
  when the existing profitability/subsidy policy allows. Expired records follow the existing expiry path.
- One log page and one pending record are processed per alarm. Waiting records rotate fairly. Catch-up
  takes multiple alarms rather than one unbounded invocation. The clock is the actual chain head even
  while the scan cursor is behind.
- The cursor, open records, deployment identity and last result live in Durable Object storage.
- A signed transaction is saved **before** RPC broadcast. After a crash or ambiguous send, the same
  bytes are rebroadcast until a receipt exists; the keeper does not create a replacement transaction
  with a new nonce. A persistently underpriced/dropped transaction needs operator attention. Do not
  run another process with this signing wallet.
- The initial deployment is **stopped**. Only authenticated `POST /start` enables the alarm loop.
  A five-minute Cron watchdog restores a missing alarm for an enabled keeper; it never starts a
  deliberately stopped keeper. Alarms are at least once; on-chain closed-record checks handle repeats.

The default idle interval is **30 seconds**; pending trades and catch-up use **3 seconds between completed
runs**. Therefore a new trade may wait roughly 30 seconds to be discovered, plus processing and chain
confirmation. Three seconds is settlement eligibility, not a delivery guarantee. Other pending records,
catch-up, RPC outages and platform quotas can extend the delay. This is independent of the frontend's
three-second presentation delay.

`CF_HOUSEKEEPING=false` limits this free-tier deployment to settlement/expiry. Automatic licence rent
accrual, LP vesting drips and configured ledger pushes are off. Those permissionless operations remain
available separately. Set it to `true` only after checking resource use; additional pools/transactions
increase per-invocation subrequests and daily usage.

## Install and verify

Requires Node 24 and pnpm 10.14.0. From the repository root:

```sh
pnpm -C backend install --frozen-lockfile
cd backend/cloudflare-keeper
pnpm typecheck
pnpm test
pnpm test:runtime
pnpm build
```

The runtime smoke test launches real local workerd with throwaway keys, a mock RPC and temporary
SQLite storage. It verifies authentication, RPC failure recovery, a successful scan and cursor checkpoint,
stop and restart persistence. It sends
no blockchain transaction. The keeper's settlement regression suite is in `../keeper/test`.

## Deploy and provide credentials

Use the same Cloudflare account for deployment and provisioning. This configuration uses SQLite Durable
Objects, which are supported on Workers Free. It does not upgrade the account or create paid Render
resources. Usage is still subject to Cloudflare's free request, duration, storage and write limits;
exhaustion can stop processing. Check the Cloudflare usage dashboard during the demo.

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm run deploy
```

On **Prazwal's machine**, with access to the existing keystore and password file, authenticate to the
same Cloudflare account and run from this folder:

```sh
pnpm provision ../../.env
```

Use `../../.keeper-env` instead if that is the deployment configuration file. If it provides
`KEEPER_PVT_KEY` (or `KEEPER_PRIVATE_KEY`), the script uses that key directly; otherwise its keystore and
password paths must exist on that machine. The script validates the keeper settings, decrypts the existing
keystore in memory when needed, and streams only keeper configuration and secrets to `wrangler secret bulk` on
stdin. It never prints or writes the private key. It stores a randomly generated admin token in local
`.admin-token` with mode 600, excluded from Git. Protect this file and retain it for status/stop commands.
The signing secret is `KEEPER_PRIVATE_KEY`; `KEEPER_EXPECTED_ADDRESS` pins the expected public signer.
No Mac filesystem paths are used by Cloudflare.

If provisioning configuration from a machine **without** the wallet, this optional command uploads the
non-wallet configuration and admin token but leaves signing disabled until the key is supplied:

```sh
pnpm provision ../../.keeper-env --config-only --signer 0x5E48Fda9d06f646aa6Bc4714462Ecb21327bC30a
```

Ensure the local/Render keeper is stopped, and the wallet has Arbitrum Sepolia ETH. Then use the URL
printed by `pnpm run deploy`:

```sh
pnpm control https://<worker>.<account-subdomain>.workers.dev start
pnpm control https://<worker>.<account-subdomain>.workers.dev status
pnpm exec wrangler tail
pnpm control https://<worker>.<account-subdomain>.workers.dev stop
```

`GET /health` is public process health only; it does not prove settlement. Other routes require the
admin token as a Bearer authorization header. `/status` reports enabled state, cursor, open-record count,
last tick with redacted processing diagnostics, and any pending transaction hash. It exposes no signed bytes or credentials. Stop prevents new
runs; an in-flight transaction may still finish. No public endpoint takes an arbitrary transaction or
record supplied by a caller.

Confirm a successful tick, then a real `settled`/`expired` result and its chain receipt before declaring
the keeper operational. A deployed Worker without its wallet is not operational.

For another deployment, use a new Worker name/namespace or deliberately migrate its state after stopping
the old signer. Existing state refuses different chain/start-block/core-contract identities. Do not
delete pending-transaction state just to unblock the signer: first reconcile its receipt/nonce.

References: [Durable Objects](https://developers.cloudflare.com/durable-objects/),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[free limits and pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
