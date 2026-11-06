# Keeper and indexer handoff

## Render worker

`render-keeper.yaml` defines a separate keeper worker with Node 24, one instance and a 1 GB disk at
`/var/data`. It does not manage the existing indexer/API service. Supply its manual environment values
from the deployment machine's configuration; local `.keeper-env` is ignored by Git.

Before the worker can start, add these files in the worker's **Environment → Secret Files**:

| Filename | Contents |
| --- | --- |
| `keeper-keystore.json` | Existing encrypted `touchstone-keeper` keystore JSON |
| `keeper-password.txt` | Password that decrypts that keystore |

The worker reads them from `/etc/secrets/`. The Mac paths in local configuration do not work on Render.
Keep the local keeper stopped while this worker uses the same wallet. If the initial deploy fails because
the secret files are missing, add both files and deploy the latest commit again. Verify the public signer,
history scan completion and a confirmed settlement in Render logs. A live deploy alone does not prove
settlement works. Keep enough Arbitrum Sepolia ETH in the signer for gas. The worker and disk are paid
resources; disk-backed deployments briefly stop the previous instance before starting its replacement.

## Current redeployment: 7 November 2026

Run these commands **on Prazwal's deployment machine**, where the existing encrypted `touchstone-keeper`
wallet lives. Creating the file on another laptop does not unblock that keeper. The file must contain the
wallet's existing password; an empty file or a newly invented password cannot decrypt it.

From the repository root, with Node 24 and backend dependencies installed:

```sh
git pull --ff-only
node backend/keeper/src/setup-password.ts
node --env-file=.env backend/scripts/preflight.mjs keeper
scripts/run-services.sh keeper
```

The setup command reads `KEEPER_KEYSTORE_PATH` and `KEEPER_KEYSTORE_PASSWORD_FILE` from the root `.env`.
If unset, it uses `~/.foundry/keystores/touchstone-keeper` and `~/.touchstone-keeper-pass` on that machine.
It prompts without echo, verifies the password in memory, then creates the password file outside the repo
with mode 600. An existing file is validated, never overwritten. It prints only the public signer address;
compare it with the expected keeper address in `DEPLOYMENTS.md`. It sends no transaction. No password or
private key belongs in chat, Git, shell arguments or environment variables.

Before preflight, verify that `.env` names the **new** hook, Settler, factory, ledger and licence from
`frontend/deployments/arbitrum-sepolia.json`, not the October deployment. Both services start at block
`326729230`. Use fresh state/metrics/database filenames for this deployment; preserve the old files. Include
`TOUCHSTONE_LICENCE` and a positive `KEEPER_ACCRUE_INTERVAL_S`. Configure a short positive
`KEEPER_POLL_INTERVAL_MS` (for example 2000 for the demo). `KEEPER_SETTLE_AT_LOSS=true` allows the existing
policy to subsidize retaining settlements and benign zero-rebate settlements when tips do not cover gas;
this spends the keeper's test ETH. With it false, an uneconomic record may wait until expiry even while the
keeper is healthy. This does not change the keeper's expiry-first policy or guarantee every subsidized case.

Keeper-only preflight no longer depends on unrelated indexer/API configuration. A successful preflight checks
configuration, private-file metadata and deployment wiring; it does not prove the signer has gas or that a
settlement succeeded. Check `var/log/keeper.log` for `keeper started`, then a `settled` entry with a confirmed
transaction. The API's health endpoint alone does not establish keeper liveness.

### Drift demonstration with the deeper pool

The live drift threshold is 5 bps and N₀ is 5 USDC. A 1–4 bps gap cannot satisfy drift. At exactly 5 bps the
signed direction, notional, reference freshness and rounding still matter. Do not lower τ or fabricate a
Chainlink price to make a demo light turn on.

When the current gap is below τ or closing it would trade less than N₀, the simulation offers **Create demo gap**. This prepares a separate real
testnet swap targeting about 40 bps above Chainlink (or twice τ if larger). Review its quote and sign it;
then wait for live prices to refresh and select **Close the gap**. The return trade must clear N₀. The
active-liquidity estimate is approximate across ticks, so check the refreshed gap and exact quote. Both
swaps pay fees, can collect deposits under the full hook rules and can lose test tokens. No swap sends
automatically, and a deposit event alone does not establish which trigger fired.

## Original handoff (1 November 2026)

Prepared for the developer holding the existing cast wallet. The contracts are deployed; this handoff does not redeploy them or require a private key in chat.

## Preflight on the signer machine

1. Pull the D2 changes and install the locked backend workspace with Node 24 and `pnpm -C backend install --frozen-lockfile`.
2. Set the exact keeper and indexer variables validated in `backend/keeper/src/config.ts` and `backend/indexer/src/config.ts`. The current Linux `.env` has several legacy names; `TOUCHSTONE_HOOK`, `TOUCHSTONE_SETTLER`, `TOUCHSTONE_FACTORY`, `TOUCHSTONE_LEDGER`, `POOL_MANAGER`, and indexer storage/poll settings must be configured. Use verified deployment manifests for addresses. Use absolute database, state, keystore and password-file paths.
3. The wallet owner creates the password file interactively, outside the repo, with mode 600. Do not put the password in shell arguments, terminal output, environment variables or chat. Keep both the keystore and password file private. `KEEPER_KEYSTORE_PATH` must point to an encrypted cast-compatible v3 keystore; an address or cast account name alone is insufficient for this keeper.
4. From the repo root, run `node --env-file=.env backend/scripts/preflight.mjs`. It reports missing field names and file permissions only; it does not read the password, sign or send transactions.
5. Confirm the signer address against the intended keeper wallet using cast's interactive wallet tooling, and fund it with Arbitrum Sepolia ETH. Verify chain ID 421614 and deployed addresses. Do not send mainnet ETH to a testnet address expecting it to arrive.

## Start and supervise

From the root, run `node --env-file=.env backend/indexer/src/main.ts` and `node --env-file=.env backend/keeper/src/main.ts` as separate supervised processes. Node loads the environment file explicitly; `pnpm start` alone does not. Use your existing process supervisor with an absolute working directory, private logs, restart-on-failure, and a small funded keeper float. Avoid starting a second keeper against the same state file. Back up state, preserve the configured start block, and allow the canonical rescan after a reorg.

The keeper logs the public signer address on startup. Check chain/balance and startup validation before leaving it running. Hermes credentials remain server-only; never paste `.env` or publish logs containing provider request URLs. Configure log collection with provider-secret redaction. The keeper's current expiry-first policy is preserved by owner decision 0052.

The API is separate: set its exact CORS origin, rate/page limits and loopback listener, then run `node --env-file=.env backend/indexer/src/api-main.ts`. Serve it through HTTPS. Build the frontend with `VITE_HISTORY_URL` pointing to that public read-only service. API health reports indexed evidence, not proof that the keeper process is alive.

## Produce and classify evidence

Start with the bots in dry-run mode and bounded test-token amounts. The demo pool has very shallow liquidity; a large swap can move it substantially. Read the live configuration and GuardedRouter simulation instead of relying on the old “1,000 USDC at 70 bps” example. Swaps below N0 may still fill the flow bucket. Swaps cannot guarantee their later settlement regime or rebate budget.

For each confirmed demonstration, retain the chain, pool ID, transaction hash, event fields and block. Classify retaining settlement, benign refund/rebate, expiry, drip and ledger claim from those events. Add only real confirmed links to DEPLOYMENTS.md. Do not deliberately let a record expire while also claiming a successful settlement demonstration. An expiry can be demonstrated on a separate controlled record by withholding its keeper scheduling until the window elapses. The ETH/USDC pool cannot demonstrate closure settlement; E9 and stock-token data are skipped at the owner's request.

## Research transfer

The E2 manifest records the original directory as `/Users/prazw/Desktop/Web3/touchstone/research/data/`. The two Binance NPZs have been reproduced from public archives with matching E2 hashes. Transfer `swaps_ethereum_25864359_26265958.jsonl.gz`, `chainlink_eth_usd_25864029_26265958.jsonl.gz`, the legacy `cache/pyth/` chunks and their source manifest. Compare the two log hashes with `research/results/E2.json`. Before legacy re-keying, create a source manifest from that machine's original provenance containing base/quote feed IDs plus every chunk basename and SHA-256. Run `experiments.rekey_pyth` only under the renewed committed freeze, save its receipt, and append that actual operation to FROZEN.md. Do not claim the re-key already happened.

Then run `uv run python -m experiments.fetch_pyth` from `research/` with the Hermes environment loaded and private supervisor logs. It reuses validated cache identities and fetches missing chunks. Throughput and remaining time must come from the actual run, not the other machine's older three-day estimate. Run E3/E4 only when all input hashes and required data coverage are available, preserving both defaults and selected-point verdicts and every failure.
