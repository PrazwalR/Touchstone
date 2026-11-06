# Keeper and indexer handoff

Prepared 1 November 2026 for the developer holding the existing cast wallet. The contracts are deployed; this handoff does not redeploy them or require a private key in chat.

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
