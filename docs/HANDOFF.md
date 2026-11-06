# Handoff — 6 November 2026

The owner is stepping back from active sessions. This is the single entry point for whoever picks this up next
(the other developer, or a future session). It supersedes the scattered status notes in `docs/d2-track-status.md`
and prior chat summaries — read this file first, then follow its pointers.

## 0. Non-negotiable rules (read before touching anything)

These are in `CLAUDE.md` / `docs/SPEC.md` §0 verbatim. Repeating the ones that matter most for not breaking
something irreversibly:

1. **Never change the mechanism.** Formulas, trigger rules, default parameters, pass/kill lines are fixed by
   spec §4, §14, §16. Disagree with one → write `docs/decisions/NNNN-topic.md` with evidence and ask the owner.
   Do not "improve" it silently.
2. **Never change a research threshold after a run.** Freeze the pre-registration in its own commit *before*
   reading any data. A bug fix to analysis *code* (not thresholds) before any metric is read is allowed, but
   must be documented as an amendment with a new code hash — see `research/prereg/FROZEN.md`'s amendment
   entries for the exact pattern (three examples now: settle.py rounding, hermes.py pacing, and the 6
   November E5 zero-notional exclusion).
3. **Every number carries a label**: measured, historical backtest, simulation, testnet demonstration, or
   *target*. Never claim Uniswap/Foundation endorsement. Never claim ex-post settlement is novel (Hindsight
   did it first). Never cite Assay's withdrawn 0.781 AUC.
4. **No stubs/mocks in `src/`.** Mocks only in `test/mocks/Mock*`. No hardcoded addresses/thresholds/keys.
   No secrets in the repo, ever — `gitleaks detect --no-git --source . --redact` before every push.
5. **Never copy Bunni's BidDog code** (AGPL). The licence is reimplemented from the am-AMM paper.
6. **Git:** don't commit/push without being asked, *except* where a tool's own integrity mechanism requires a
   commit to function (the research freeze guard is the one case in this repo — see §2). When in doubt, make
   the change and hand over the exact commit command instead of running it.

## 1. What's actually done (verified today, not claimed from memory)

Run these yourself before trusting any of this — it takes about 10 minutes total:

```bash
cd contracts && forge fmt --check && forge build --sizes && forge test
cd .. && python3 -I scripts/check_release_gates.py sizes
python3 -I scripts/check_release_gates.py gas
(cd contracts && FOUNDRY_PROFILE=coverage FORGE_SNAPSHOT_EMIT=false forge coverage --report lcov --ir-minimum && forge build)
python3 -I scripts/check_release_gates.py coverage
(cd contracts && rm -f /tmp/s.json && slither . --config-file slither.config.json --json /tmp/s.json; forge build)
python3 -I scripts/check_release_gates.py slither /tmp/s.json
(cd backend && pnpm -r exec tsc --noEmit && pnpm -r test)
(cd frontend && pnpm typecheck && pnpm test && pnpm build)
(cd sim && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
cd research && uv run ruff check . && uv run mypy && uv run pytest && cd ..
python3 -I research/reference/check_report_numbers.py research/reference/vectors
```

**Contracts (milestones M0–M10): done.** 254/254 tests pass (3 fork tests skip without a live RPC). All 6
contracts under the 24,576-byte limit (hook at 23,993). Gas gate passes, no regression beyond approved
baselines. Slither: 132 findings, 0 unreviewed. Coverage: 99.69% lines / 100% branches after the reviewed
attribution list (`docs/audits/coverage-reviewed.json`, decision 0059) — **if you touch any `src/` line, that
list's entries for lines near your change may go stale; the gate script detects and refuses stale entries
automatically, it will tell you which ones to rebuild.**

Known, accepted gap: **E8's gas pass line is 20,000 for an unflagged swap below N0; measured is 21,522**
(`contracts/snapshots/SwapGasTest.json`). This has been measured and reported as a miss, not optimized away.
Don't "fix" this without an owner decision — the swap path's size was already fought hard to fit under EIP-170
(decision 0028, 0057).

**Off-chain: done, services tested against a real local Anvil node (with test oracle fixtures).** Keeper (settles, expires,
drips, accrues rent — 6/6 e2e), indexer + read-only history API, alert monitor (Discord), demonstration bots
(13/13), frontend's swap module against a real signer (4/4, real approve+swap+settle). `docs/runbook.md` is
the operating manual.

**Frontend: done.** Four views — Overview, Swap, Simulation, Docs — behind hash routes. Swap and Simulation
connect a real injected wallet (decision 0060, a deliberate, documented reversal of the original "no wallet"
rule — scoped to those two views only). 50/50 tests pass.

**`sim/` (Rust bytecode replay, decision 0064): a real local-replay tool, built from scratch** (the referenced
VANE simulator doesn't exist in this environment). `cargo test`/`clippy`/`fmt` all clean. It replays Anvil
receipts through revm against the deployed bytecode and has matched gas on a 3-transaction local fixture
(46,127 / 166,787 / 252,209 full-tx gas). It does **not** yet do the historical adapter (real pool state +
ordered historical swaps) or the E3 settlement replay with authenticated Pyth updates — see decision 0064 for
exactly what's missing and why.

## 2. Research: exactly where each experiment stands

| Experiment | Status | What's actually blocking it |
|---|---|---|
| E1 | ✅ Passed | Nothing. `research/results/E1.json` |
| E2 | ✅ Passed, gate G1 met | Nothing. `research/results/E2.json` |
| E5 | 🟡 Real result, no formal kill, but read the caveat | **Nothing blocking further work, but understand this first:** `r*` (break-even recall) is **negative** on this historical window, so the formal "recall ≥ r*" line cannot fail no matter how low recall drops. It is not a real safety net on this window. Splitting a toxic trade into pieces under a tenth of N_min collapses held-out recall to 9.7%–11.1%, and the pass/fail column says "pass" anyway. Read `research/results/README.md`'s E5 section before citing this as a pass. If you want a real evasion stress test, you need a window where LPs were *losing* net of fees (r* positive) — that's new data, a new pre-registration. |
| E6 | ❌ **Killed.** All 21 registered cases, both windows. | Nothing to unblock — this is the real result. `docs/decisions/0065-e6-freshness-kill.md`. Caveat: one-agent constant-product model, not LP returns. Any mechanism response needs its own owner decision + pre-registration; don't touch the fee/freshness formula based on this alone. |
| E3, E4 | 🔒 Frozen (1 Nov 2026), **unblocked 6 Nov** | **Correction to an earlier version of this file:** the raw swap logs, Chainlink reference data and Binance klines are not missing — they are at `research/data/{swaps_ethereum_*.jsonl.gz, chainlink_eth_usd_*.jsonl.gz, binance_*.npz}` in the owner’s Mac checkout, and E1/E2/E5 already read them successfully. There was no external "data machine" transfer needed for those three. The only real gap was Pyth price history: 12,100 of 44,476 requested times were cached under an old chunk-naming scheme that the current `tsr.hermes.Hermes.fetch()` doesn't recognize as already-fetched (it writes a content digest into the filename that the old chunks lack), so a plain resume re-requests from Hermes rather than reading them — which is fine, not a blocker, just slower. `experiments/rekey_pyth.py`'s source-manifest requirement is about *provenance-auditing the old chunks specifically* (their rows have no embedded feed ID, only position in a 2-element array) — it is not needed to get new, properly-attributed data, since `fetch_pyth.py` pins the feed IDs in code (part of the frozen hash) rather than reading them from the response. **Action taken 6 Nov 2026, 02:16 UTC:** launched `uv run python -m experiments.fetch_pyth` (reads `HERMES_URL`/`HERMES_API_KEY`/`HERMES_API_KEY_HEADER` from `.env`) to fetch the full 44,476 times fresh. At Hermes' configured rate (2/s, `tsr/settle_config.py`), that's roughly 6 hours wall-clock. Check `ps aux \| grep fetch_pyth` for whether it's still running, and `research/data/pyth_hermes_eth_usdc_*.jsonl.gz` for its output once it finishes — the script prints `<n> Pyth times -> <file> sha256 <hash>` on success. If it's done and that file exists: run E3 and E4 for real (`uv run python -m experiments.e3_settlement`, `-m experiments.e4_basis`) and report both the kill/pass verdict and the default-vs-selected-trigger point, per their pre-registrations. If it crashed partway, just rerun the same command — the chunk cache (now under the current naming scheme) resumes correctly within a single run. The old 121 under-the-old-scheme chunk files in `research/data/cache/pyth/` can be left alone; they're harmless, just unused by the current code. |
| E7 | 🔒 Draft, blocked **on the owner** | Needs a human to specify **numerical margins** for "match static fee on retail fee and freshness" (`research/prereg/E7.md` line 25: "Owner instruction, 3 November 2026: keep E7 in draft until the owner specifies numerical margins"). This is not something a developer should decide unilaterally — ask the project owner directly: *how many basis points of retail-fee difference, and what freshness-ratio difference, count as "matching" the static-fee baseline?* |
| E8 | 🟡 Partial | Gas is measured (see §1's known gap). The full run — every invariant checked end-to-end with real Pyth updates on a live testnet — needs the redeploy (see §4). |
| E9 | ⏭️ Skipped | Owner's own decision 0054. Leave it skipped unless the owner revisits it. |
| E10 (licence) | 🟡 Model exists, no verdict | `research/simulations/licence.py` models first-touch licence races and reserve bids. The follow-up adds `licence_path.py`: sequential reserves, explicit paired bidder valuation, rent allocation and idle-holder measurements, with synthetic tests. See [decision 0066](decisions/0066-draft-licence-path-replay.md) and [lesson 14](lessons/14-licence-path-model.md). No tape has been read, no pre-registration frozen with a committed config. Needs: registered latency/cost/reserve simulation configuration, frozen, then run against a tape (same E1/E2 swap data likely works, check `research/prereg/E10.md` for exactly what inputs it specifies). |
| E11 (rebates) | 🔒 Draft | `research/prereg/E11.md` — needs a pool-concentration measurement methodology defined before it can be run. |
| E12 (quote integrity) | 🟡 Partial | `depositNow == executed deposit` and `getIndicativeQuote == V4Quoter` both hold in 2,000-run local fuzz tests (`contracts/test/unit/Quote.t.sol`, `QuoteIntegrity.t.sol`). The **fork-test-against-real-testnet** version, sampling real swaps post-redeploy, has not been implemented/run. [Draft E12](../research/prereg/E12.md) records reconstruction, sampling and scoring requirements; freeze separately before input access. |

**If you want to run E5 again on a different window, or attempt E10/E11:** follow the exact pattern in
`research/prereg/FROZEN.md` — freeze the pre-registration + analysis code hash **in its own commit**, before
touching any data. The `guard()` function in `research/experiments/behaviour.py` mechanically enforces this
(it refuses to run if the prereg file isn't committed with the matching live code hash) — it is not just a
convention, the tooling will stop you.

## 3. Infra question the owner asked: is Vercel enough, or do we need a backend host too?

**Short answer: you need both, for different pieces, and that's fine — it's cheap.**

- **Vercel (or any static host) is enough for the dashboard (`frontend/`).** It's a Vite/React SPA with no
  server-side rendering and no server secrets (CLAUDE.md §0.7: "no API keys in any browser bundle, the
  dashboard is read-only and has no wallet connection" — except Swap/Simulation, which connect the *user's own*
  wallet client-side, never ours). Deploy: `vercel deploy` from `frontend/`, set `VITE_RPC_URL` and
  `VITE_HISTORY_URL` as Vercel environment variables (public values only — an RPC URL and your indexer's public
  API URL, nothing secret). Done.

- **You also need one always-on process host for `backend/` — Vercel genuinely cannot run this.** Here's
  exactly why, concretely, not just "serverless is different":
  - **The keeper is an infinite polling loop** (`backend/keeper/src/main.ts`'s `loop()` calls itself with
    `setTimeout` forever). Vercel functions have a hard execution timeout (seconds to a couple of minutes
    depending on plan) and get torn down between invocations — there is no way to keep a `setTimeout` loop
    alive across them.
  - **The indexer owns a local SQLite file** (`backend/indexer/src/store.ts`, via `node:sqlite`) that it reads
    and writes continuously. Vercel's filesystem is ephemeral and read-only in production (except `/tmp`,
    which doesn't persist across invocations) — every cold start would start the indexer from an empty
    database.
  - **The alert monitor needs to hold in-memory cooldown state** (`Alerter` in `backend/indexer/src/monitor.ts`)
    across ticks, specifically so it doesn't repeat the same Discord alert every single poll. A new serverless
    instance per invocation would re-fire every alert every time.
  - None of these are "hard to port to serverless" problems that disappear with more code — they're structural:
    the keeper, indexer and monitor are services, not request handlers.
  - **What does fit serverless:** the read-only history API (`backend/indexer/src/api-main.ts`) is a plain
    stateless HTTP server reading the SQLite file — it *could* run as a Vercel function if the SQLite file
    lived somewhere network-accessible instead of local disk, but that's more re-architecture than it's worth
    for a testnet demo.
  - **Recommendation:** one small always-on VPS (Hetzner/DigitalOcean/a $5–6/mo droplet is plenty for testnet
    volume) or a container platform that supports long-running processes (Fly.io, Railway — both have free/cheap
    tiers and support persistent volumes, which the indexer's SQLite file needs). Run
    `scripts/run-services.sh` there via systemd or the platform's process supervisor; `docs/runbook.md`
    documents exactly how. Vercel for the frontend, one small VPS for everything in `backend/`. Total cost is
    single-digit dollars a month for testnet traffic.

## 4. What needs the owner specifically (nobody else can do these)

1. **E7's numerical margins** (§2 above) — a judgment call about acceptable difference, not a technical task.
2. **The testnet redeploy** — `scripts/deploy-testnet.sh <chain>` needs a funded, owned deployer keystore and
   signs real transactions. `docs/runbook.md` §1 has the exact steps. It rehearses on a fork first
   automatically — safe to run, asks for the keystore password itself.
3. **Keeper funding** — already confirmed funded. Address `0x5E48Fda9d06f646aa6Bc4714462Ecb21327bC30a` holds
   0.05 ETH on Arbitrum Sepolia (checked live on 4 November 2026), which covers roughly 8,000 settlements at
   current gas price (~0.02 gwei). **No action needed** unless/until a Base Sepolia deploy happens, which needs
   its own separate native-ETH funding of the same address on that chain (same key, different chain balance).
4. ~~E3/E4's raw data transfer~~ — turned out not to be needed; see the corrected §2 row. Nothing from the owner required here anymore.
5. **Discord webhook + Etherscan API key** for the alert monitor and contract verification — see
   `docs/runbook.md` and `.env.example` for exactly which env vars.

## 5. Where everything lives

- `contracts/src/` — the contracts. `docs/decisions/0001`–`0066` (not every number is used — some
  were superseded in place) record every non-obvious choice. `docs/lessons/01`–`13` teach each milestone.
- `backend/{keeper,indexer,bots,shared}/` — off-chain services, each with its own test suite.
- `frontend/` — the dashboard (four views, §1).
- `research/` — `prereg/` (pre-registrations + `FROZEN.md`'s ledger), `experiments/` (runners),
  `simulations/` (models), `results/` (outputs + `README.md`'s write-up), `data/` (gitignored, local only).
- `sim/` — the Rust bytecode replay (decision 0064).
- `docs/runbook.md` — how to deploy, run services, and what each alert means with a concrete example.
- `docs/gas.md`, `docs/threat-model.md` — kept current after every milestone.
- `scripts/rehearse-deploy.sh`, `scripts/deploy-testnet.sh`, `scripts/run-services.sh` — the three scripts you
  actually run; none of them need editing, only env vars.

## 6. Order of work, if you're picking this up cold

1. Run the verification commands in §1. Confirm you get the same numbers. If anything's red that's described
   as green here, stop and figure out why before adding anything — don't build on top of a regression.
2. Keep E7 draft until the owner supplies numerical margins. On the Mac checkout, check Pyth download
   completion and hashes, then run frozen E3/E4. On another machine, first verify local input availability;
   git pulls do not copy ignored data or move running processes. No legacy manifest is required for a fresh fetch.
3. Meanwhile: E10/E11 (model code already exists for E10) and the `sim/` historical adapter are
   productive, unblocked work.
4. Once the owner redeploys (§4.2): E8's full run, E12's fork tests, and the release checklist transactions
   (spec §19.3 step 4 — pool creation, flagged/unflagged swap, settlement with retention, settlement with
   refund+rebate, expiry, closed-market settlement, donation, licence bid/activation/exempt-swap, rebate claim)
   all become possible. Record each transaction hash next to the file/line that produced it.
5. Release (milestone M12): README with every claim labelled and linked to its evidence, the twelve audits of
   §0.6 written to `docs/audits/m12-<date>/`, an external audit request brief. Don't rush this past the gates
   in §1 — they're the whole point.

Good luck. Everything here was true and verified on 6 November 2026 — re-verify before trusting it on any later date.

## 7. Linux follow-up, 6 November 2026

Pulled the five new main commits through `3a62063` onto `codex/m11-followup`, preserving local work.
This session runs at `/home/kunal/touchstone`, not the owner's Mac path
`/Users/prazw/Desktop/Web3/touchstone`. Here, `research/data/` contains both Binance NPZs and the E6
tape/manifest, but no raw swap/Chainlink logs or Pyth archive. The Mac path and `/tmp/fetch_pyth.log`
are absent, and no `experiments.fetch_pyth` process is running here. A search under `/home/kunal` and
`/tmp` found only synthetic pytest swap/reference fixtures. This does not contradict the owner's Mac
inventory or establish whether its background download has completed. Do not launch a duplicate fetch
or treat synthetic fixtures as historical inputs. Running E3/E4 from this session requires access to
the Mac inputs and completed output; alternatively run §2's commands in that checkout.

E10 follow-up fixes validation before race short-circuiting: invalid later-agent costs, nonfinite terms
and invalid size grids now fail explicitly. Ten regressions failed before the fix. The path model remains
draft, with no historical input read or verdict. Its registered runner, scenario configuration and
nonpositive-baseline convention remain unfinished. No mechanism or frozen threshold was changed.

Local verification: 93 research tests, Ruff and strict mypy pass; 95 backend tests pass with local Anvil;
Frontend sync, all 50 tests and production build pass. Rust format, clippy and tests pass.
Contract tests pass 254 with 3 RPC-dependent skips in the default run; all three fork tests also pass
when run separately with the configured RPC. The secret scan reports no leaks. The coverage gate
passes at reviewed 99.69% lines / 100% branches, gas and all six size gates pass, and Slither reports
132 findings with zero unreviewed. These are engineering checks, not historical or live-testnet evidence.

The original [PR #2 CI run](https://github.com/kunalsinghdadhwal/touchstone/actions/runs/41689971079)
was interrupted by runner shutdown during coverage (exit 143), without a failed coverage assertion.
The retry also ended with a runner shutdown during coverage compilation (exit 143), so CI remains red.
It checked the old PR head, not this follow-up. Local coverage and static-analysis gates pass;
these do not replace a successful hosted CI run. Investigate runner interruption before another retry.

Recommended next work: finish E10's registered runner and E11's concentration/counterfactual method;
keep E6's kill visible and the licence disabled pending E10 evidence. E8 swap-path optimization and
responses to the open economic risks require explicit owner decisions. Deployment remains outside this task.
