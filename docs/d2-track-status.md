# D2 track status — 1 November 2026

**Superseded 6 November 2026 — read [`docs/HANDOFF.md`](HANDOFF.md) first.** This file is kept for history.
Its claim below that "the swap/reference logs and Pyth provenance still need transfer" turned out to be wrong:
the raw swap, Chainlink and Binance files were already present in this checkout and had already been read by
E1/E2/E5; only the Pyth price history was partial, and it didn't need any external transfer either, just
resuming the download. `HANDOFF.md` §2 has the corrected, verified state.

This records work on `codex/d2-track`, starting from main `72a2cbc`. “Implemented” means local code and checks, not a deployed service or an economic pass. Decision 0050 makes this a private project; the pasted hackathon dates do not govern the remaining order.

The table below is the 1 November handoff. On 3 November the E5/E6 registrations were frozen, the two Binance inputs were reproduced and E6 hit its kill line. [E6 decision](decisions/0065-e6-freshness-kill.md) · [Current research results](../research/results/README.md)

| Track | Implemented or decided | Still required |
| --- | --- | --- |
| A1 mechanism reconciliation | Owner selected unchanged formulas and explicit approximate replay. Decision 0052 checks all six E3 differences and records preserved release risks. No contract code changed. | Overshot tick reconstruction, self-LP wash, JIT/dust, cap/registration/delivery-gas policies remain risks; do not treat the present research choice as release approval. |
| A2 E3/E4 freeze | Analysis/migration code committed as `02e29dc`; renewed preregistrations separately committed as `aca218f`. Current analysis hash is in both documents and FROZEN.md. Original E3 disclosure unchanged. | Any later hashed-code change requires a new documented freeze/amendment before data access. |
| A3 Pyth resume | *(Corrected 6 Nov — see `HANDOFF.md` §2: the swap/reference/Binance inputs were local the whole time, and the Pyth download was resumed directly with no migration or transfer, since `fetch_pyth.py` writes fresh, code-attributed chunks rather than needing the old ones re-keyed.)* Tested, freeze-gated legacy migration with required source feed IDs/hashes, exact chunk coverage and a copy receipt. Originals preserved. | ~~Transfer original swap/reference/Binance inputs and legacy chunks from the data machine.~~ Not needed. |
| A4 live services | Secret-safe config/file preflight and signer-machine runbook. Existing deployed addresses are in manifests. Backend Anvil tests cover real local process interactions. | Owner chose a runbook for the other developer. They must configure missing environment names, private local wallet/password paths, fund the keeper, start/supervise services and produce real testnet records. This task did not start a live keeper or an indexer daemon. |
| B1 E3/E4 verdicts | Frozen analysis and unchanged pass/kill lines ready; both default and selected-point verdicts remain required. | Raw data and complete canonical price coverage are absent. No E3/E4 JSON or economic verdict fabricated. |
| B2/C1 E9 | Owner explicitly selected “skip e9 for now”, recorded in 0054. | No E9 ingest, freeze, data download or verdict is claimed. Skipping research does not establish closed-market economics. |
| C2 dashboard | Keep Vite (0053). Read-only indexed API; record filters, deep links, full emitted prices/alpha/payout fields; ledger credits/claims by recipient; open/settled/expired/deferred counts and measured lag. API origin enters CSP; missing/stale data remains labelled. | Deploy/configure an actual API against the running indexer. Older histories need a start-block rescan to fill closure headers. LP net and static-fee comparison need an independent 15-second outside-price tape and methodology; explicitly unavailable today. Licence view waits for M9. |
| C3 bots | Strict TypeScript workspace package for seeded retail and outsider modes, GuardedRouter simulation/submission with explicit amount/output/deposit/deadline/gas bounds, chain/wiring checks and encrypted signer. No automatic allowance increase. | Configure test-token amounts/limits and fund signer. Run demonstrations and classify from confirmed settlement events. No live swap, payout, expiry, drip or claim tx link has been added without evidence. |
| D1 E5/E6 | Draft preregistrations, committed-freeze/config-hash guards, input normalizer with raw-source hashes, day-bootstrap reporting and tested sensitivity models. Separate simulation labels. | Freeze complete sensitivity configurations before data access. Transfer raw tapes and run every window/case. E5 currently provides detection-only padding evidence, not margin-profit resistance; E6 is a stylized constant-product model, not concentrated-liquidity bytecode. No release pass claimed. |
| D2 write-ups | E1/E2 saved outputs and original code hashes preserved. New results status explains exactly why E3/E4/E5/E6 have no verdict. | Populate window metrics and intervals only from actual frozen runs, failures included. Corrected same-block reference timing needs a newly named preregistration/version. |
| E licence/E10 | Dependency gate recorded. No invented lease state. | D1 M9 contract, registered latency/cost/reserve simulations, two funded bidder bots, holder demonstration and dashboard. |
| F hardening | Existing non-fork tests, invariant suite, real-Pyth fork tests and backend integration rechecked. New attack-boundary tests for API/migration/model code; lesson and scoped audit records added. | E7/E10/E11/E12 evidence, E8 gas targets, coverage/gas release gates and external audit are not closed. Sibling `../Vane/sim` is absent; no Rust adaptation claimed. |

## First actions on the other developer's machine

1. Use `docs/keeper-handoff.md`, supply the existing encrypted signer locally and run the preflight. Start the actual indexer and keeper with explicit environment loading and supervision.
2. Transfer the original hashed research inputs and cache provenance. Run the validated migration only after confirming the renewed freeze and save its real receipt; then resume the Pyth fetch.
3. Register complete E5/E6 sensitivity configurations; a draft or uncommitted analysis cannot read its tape through the CLI.
4. Once data is complete, run E3/E4 and report both verdicts; stop/re-plan on the pre-registered kill condition. Keep E9 skipped unless the owner revisits it.

See `docs/audits/d2-2026-11-01/validation.md` for measured checks and limits. `graphify-out/` predates this change and remains local/untracked; rebuild it to include the new D2 code.
