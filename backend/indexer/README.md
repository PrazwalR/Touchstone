# Indexer

## Read-only history API

`pnpm api` runs a separate HTTP reader of the existing SQLite database, which must already exist. Load the root environment file explicitly and set `INDEXER_DATABASE_PATH` to an absolute path (environment files are not loaded implicitly by `pnpm`). Supply `INDEXER_CHAIN` and all `INDEXER_API_*` settings in `.env.example`. Bind to loopback behind an HTTPS reverse proxy. Exact allowed origins must match the dashboard URL. The process never loads a signer.

- `GET /v1/records?poolId=0x…&recordId=7&limit=20&offset=0`: deposit, settlement, expiry and deferred evidence, newest first. Pool and record filters optional.
- `GET /v1/ledger?recipient=0x…&limit=20&offset=0`: credits and claims by recipient; Kind distinguishes rebate, refund, protocol and tip.
- `GET /v1/health`: counts, deferred refunds and indexer cursor. Lag seconds are measured from swap timestamps and indexed closure headers. Older histories need a configured-start rescan to fill those headers. LP net remains unavailable without a 15-second outside-price tape.

Every response is uncached. The configured per-client budget includes rejected requests; IP is the socket address, not an untrusted forwarding header. Cap the number of tracked clients with `INDEXER_API_MAX_CLIENTS`. Set `VITE_HISTORY_URL` for the frontend build and allow its origin in CORS. Changing that build value also updates the production CSP connect-src.
