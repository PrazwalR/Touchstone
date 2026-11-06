# 0053 Read-only indexed history with the existing Vite dashboard

Date: 1 November 2026. Status: implementation detail under §0.11.2.

Keep Vite and React. The site already works without a server-rendered application or wallet connection; porting it to Next.js would add migration work without helping historical reads. This is an explicit departure from the specification's framework choice, not a mechanism change.

Use an independent Node HTTP process beside the indexer, with SQLite opened read-only. Serve bounded record evidence and ledger credits/claims by configured chain, plus indexer status. Validate strict query fields; allow only GET, exact CORS origins, and bounded per-address fixed-window request budgets. Ignore forwarding headers; behind a reverse proxy the shared socket rate limit applies to all clients. TLS termination and routing remain deployment responsibilities. Do not expose a raw SQL endpoint or keystore.

The frontend validates chain and response shape, preserves raw integer amounts and links each event's transaction. Detail expansion displays the event's full record or payout, including the settlement price and alpha where emitted. Filters and pagination use indexed history when configured; current-state reads still use RPC. Without an API URL the existing RPC history remains available and the new panel explicitly says indexed history is unavailable.

Closure-block timestamps are now stored atomically with each newly indexed range and removed on rewind. The API measures swap-to-settlement lag for records with both a deposit timestamp and closure header, with sample count, median and nearest-rank p95 over at most the latest 1,000 eligible settled records; older databases need a configured-history rescan to populate headers. External 15-second fair prices remain absent, so LP net estimates are explicitly null. Status counts are not a keeper heartbeat, and credits are not called rebates unless their Kind establishes that. Do not infer pool-specific allocation from ledger credits, which have no pool ID.
