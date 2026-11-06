# Testnet demonstration bots

Retail and outsider modes run seeded, bounded exact-input swaps through GuardedRouter. Every log is labelled `testnet demonstration`. These runs establish mechanics only, never LP returns or a profitable arbitrage strategy. The licence-holder/bidder modes wait for M9.

Use Node 24 and the backend workspace lockfile. Supply every `BOT_*` variable listed in the root `.env.example`; no amount, minimum output, cap or gas budget is defaulted. `BOT_DEPLOYMENT_FILE` points to the matching `frontend/deployments/<chain>.json`; only the two supported testnets are accepted. One pool is required. The signer address, onchain chain ID and router wiring must match the configuration.

`BOT_MODE=retail` uses the configured direction and seeded amount range. `BOT_MODE=outsider` reads current base/quote Hermes updates and slot0, rejects stale/future reference prices and excessive combined confidence, and only trades when the edge clears the configured `BOT_MIN_EDGE_BPS` in the configured direction. That threshold does not prove net profitability: fees, impact, retention and gas still matter. Choose amount/guard units for that direction, and fund the bot with test tokens only.

Run from `backend/bots` with the root environment explicitly loaded: `node --env-file=../../.env src/main.ts`. Use `BOT_SUBMIT=false` first. Simulation does not require the encrypted keystore, but does require the configured address to hold tokens and an adequate router allowance. Approve only the intended bounded token amount separately. The bot never increases allowances automatically. Native input is sent as value; ERC-20 input needs allowance.

Submission requires `BOT_SUBMIT=true`, an encrypted cast-compatible v3 keystore, and a password file with mode 600 whose signer equals `BOT_ACCOUNT`. Transaction simulation and gas-budget checks precede submission; reverted receipts fail the run. Never paste passwords, private keys or environment-file contents in chat. Each invocation runs the configured number of iterations and exits.

Below-N0 swaps can still be flagged by accumulated flow. “Benign” or “retaining” is known only from a real settlement, not from a bot's chosen mode. Record transaction hashes from confirmed logs and classify them from indexed events before adding them to DEPLOYMENTS.md.
