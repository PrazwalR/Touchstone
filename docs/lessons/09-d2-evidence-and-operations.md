# D2 evidence and operations

## Concept

An experiment and a test answer different questions. A test can prove that an implementation rejects a malformed cache or conserves a split. It cannot establish that a historical market counterfactual is profitable. A result must bind its code, preregistration, configuration and input hashes. A dashboard can display confirmed evidence without becoming a signer.

The reporting chain is: frozen assumptions → committed analysis → hashed inputs → measured/simulated outcomes → pre-registered verdict. Changing a threshold after seeing a window breaks that chain. Keeping an approximation explicit is preferable to silently changing either the contract or the research model to make numbers agree.

Settlement lag here is `closure block timestamp − record swap timestamp`. Median is the middle observation (or mean of the two middle observations), p95 uses nearest rank, and the sample is bounded to the latest 1,000 eligible settlements. That is measured process evidence, not a keeper heartbeat or economic return. LP net needs `fees + retained value + rent − markout loss at 15 seconds`; the outside-price tape is missing, so the API returns null.

## Design decisions

- Preserve contract formulas, including the overshooting approximation and current rounding; reject a silent clamp or release-schedule change (0052).
- Retain Vite instead of migrating the existing site to Next.js. Add a separate read-only API instead of scanning all event history through every visitor's RPC (0053).
- Record confirmed closure headers with the same transaction as event/derived state. Reject independent timestamp writes that survive a reorg.
- Keep the original legacy cache and validate a feed/hash manifest before copying to the current identity. Filename similarity is insufficient provenance.
- Keep E5/E6 as draft, explicitly limited sensitivity models. Do not present synthetic fixtures as an experiment or a constant-product model as tick-exact v4 execution.
- Keep signing in a separate testnet bot/keeper process. The dashboard has no wallet connection; a successful simulation is not a retaining settlement.

## Code walkthrough

Line references identify the entry points; related helpers are directly below them.

- `backend/indexer/src/indexer.ts:64`, `tick`: fetch closure headers before writes and commit them atomically with the range cursor. RPC failures leave the range unapplied.
- `backend/indexer/src/store.ts:70`, `rewind`: delete invalid headers together with invalid event history. `saveBlock` at line 90 stores the confirmed evidence.
- `backend/indexer/src/history.ts:31`, `History`: separate read-only SQLite connection. `events` at line 40 uses fixed SQL with bound values and bounded pages; `health` at line 77 aggregates statuses and eligible lag samples. No signer or raw SQL endpoint exists.
- `backend/indexer/src/api.ts:40`, `historyServer`: validate methods, exact origins and query fields; rate-limit the socket address with bounded client memory; return generic failures rather than exception stacks.
- `frontend/src/sections/History.tsx:17`, `History`: validate chain/response, abort obsolete reads, expose errors and raw event fields, preserve large token values as strings, and clear evidence on invalid filters. Query links provide a record-specific view.
- `backend/bots/src/strategy.ts:2`, `seeded`, and line 42, `sampleAmount`: fixed-seed reproducibility and integer sampling without converting token amounts through floating point. Price arithmetic is only a reference-direction signal; actual transactions retain explicit base-unit guards.
- `backend/bots/src/main.ts:101`, `run`: verify RPC chain and router wiring, check configured signal/allowance, simulate, enforce gas bounds, then wait for and inspect a receipt. No unbounded approval is sent.
- `research/experiments/rekey_pyth.py:20`, `rekey`: freeze gate before source access, manifest/feed/hash/coverage checks, conflict refusal and original preservation.
- `research/experiments/behaviour.py:48`, `guard`: require current frozen and committed preregistration, committed analysis and matching configuration before reading a tape. `e5` and `e6` report registered sensitivities; `main` records source/tape/config/code/preregistration hashes and refuses overwriting results.
- `research/experiments/prepare_behaviour.py:53`, `main`: normalize original raw data only under the same guard and save source provenance. It does not manufacture the missing datasets.

## Failure modes

- Wrong-chain API evidence: frontend rejects mismatched chain (`history boundary` test).
- SQL injection, duplicate or oversized query: strict query validation and prepared SQL (`read-only history API` tests).
- Rate-limit bypass through forwarded IP headers: forwarding headers are ignored (`limits requests without trusting spoofed forwarding headers`).
- Reorg keeps a settled record's old time: the header is removed on rewind (`measures lag ... clears it on rewind`).
- Legacy chunk has an attractive filename but wrong feeds/hash/coverage: migration refuses it (`test_rekey_*`).
- Large token amount loses precision: string-preserving API/frontend and BigInt bot sampling tests.
- Evasion pieces move toxic weight or corrupt order: split conservation and ordered-tape tests. Padding-profit completeness is still unknown.
- Bot finds an edge but loses after gas/retention: explicit limitation, not solved by a direction signal. Later economic verdict is still required.
- No keeper signer or no research inputs: startup preflight/runbook and unavailable metrics, never a fabricated demonstration.

## Audit questions

1. Can the API move funds? No: its database is read-only, it has no account or write RPC, and the frontend has no signing capability.
2. Are all displayed credits rebates? No. Kind distinguishes rebates, deferred refunds, protocol amounts and tips; raw ledger events retain their Kind. A ledger event does not identify a pool, so the UI does not invent one.
3. Does a current hash prove blind research? No. Git chronology, prior disclosures and the separate freeze commit matter. E3's previously seen-window disclosure remains unchanged.
4. Are E5/E6 complete release experiments? No. Inputs/configurations are not frozen or run. E5 does not establish padding-margin profit resistance; E6 is a stylized sensitivity model. Exact v4/revm confirmation remains required.
5. Can live deployments demonstrate every outcome today? Not from this task. No local signer was available in that environment. Closed-market economics is untested while E9 is skipped, and licence outcomes require M9.

## Exercises

1. Insert a synthetic deposit at time 100 and a confirmed settlement at 107. Verify lag 7, then rewind the closure block and confirm the lag disappears.
2. Split a 100,000-unit toxic trade into pieces under N0. Sum notional/toxic weights and follow both flow buckets by hand. Explain why exact output changes deposit accounting even when flags match.
3. Compare `02e29dc` and `aca218f`: verify that code precedes the renewed E3/E4 freeze, the current hash matches both files and the original disclosure has not changed. Explain why that still does not make the previously seen window blind.
