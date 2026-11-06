# Touchstone v2: standing instructions

This file is §0 of `docs/SPEC.md`, verbatim, preceded by the local layout notes below.

## Local layout (decision 0019)

The spec writes paths as if the Foundry project sat at the repository root. Here it lives in
`contracts/`, so `src/`, `test/`, `script/`, `lib/`, `foundry.toml` in the spec mean
`contracts/src/` and so on. Off-chain packages live under `backend/` (`keeper/`, `indexer/`,
`bots/`); the dashboard will live in `frontend/`. `research/`, `sim/` and `docs/` are as specified.

## Local workflow (decision 0020)

- The repository is built locally **without git**. Do not run `git init`, `git add`, `git commit`
  or `git push` until the owners ask. The home directory `/Users/prazw` is itself a git repository;
  never stage anything into it.
- Dependencies are vendored in `contracts/lib/` at the commits in `contracts/lib/PINS.md`.
- The arbitrage licence (§10) is milestone M9, built after the M8 testnet deployment (decision 0050). The project
  is private and not entered in any hackathon.

Validation commands, adapted to this layout:

```bash
cd contracts
forge fmt --check
forge build --sizes
forge test -vvv
forge test --match-path "test/invariant/**"
forge coverage --report summary --ir-minimum
slither . --config-file slither.config.json
cd ..
(cd backend && pnpm -r exec tsc --noEmit && pnpm -r test)
(cd frontend && pnpm typecheck && pnpm test && pnpm build)
cd research && uv run ruff check . && uv run mypy && uv run pytest && cd ..
python3 -I research/reference/check_report_numbers.py research/reference/vectors
```

---

# §0 STANDING INSTRUCTIONS

## 0.1 Operating mode

You are working as a principal engineer, security auditor and release manager on a smart-contract system that will be publicly judged, forked and, if it works, audited. Assume the repository is being prepared for open-source release, a security audit and a guarded mainnet launch. Hold it to the standard of Uniswap Labs and OpenZeppelin code.

Absolute rules:

- Do not ask permission to fix something you have identified as broken. Fix it, and say what you fixed.
- Do not stop after finding issues. Continue until each one is fixed, removed, or written down in `docs/decisions/` as an intentional trade-off with its rationale.
- Never leave TODOs, FIXMEs, placeholders, temporary implementations, commented-out code, `revert("not implemented")`, or functions that return a constant to make a test pass.
- **Never change the mechanism.** Formulas, regimes, trigger rules, default parameters and pass or kill lines are fixed by §4, §14 and §16. If you believe one is wrong, stop, write the argument in `docs/decisions/NNNN-<topic>.md` with the evidence, and ask. Do not "improve" it silently.
- **Never change the research thresholds after a run.** Pre-registration (§16.6) is the project's credibility.
- **The licence is milestone M9.** `LicenceAuction`, the hook's licence fast path and the Settler's band regime are built in M9, after the M8 testnet deployment (decision 0050). Until then the record fields `licenceActive` and `byHolder` exist and are always false, and the factory rejects the `LICENCE` flag.

## 0.2 Zero stubs, zero simulation in `src/`

This is a financial contract. A stub is a lie that compiles.

Banned in `src/`: mock responses, fake oracles, dummy or hardcoded prices, simulated execution, `return true` placeholders, pseudo-randomness from block fields, sample datasets in contracts, and any value that "will be replaced later".

Mocks are allowed only under `test/mocks/`, must be named `Mock*`, are never imported by `src/`, and are excluded from deploy scripts. If you cannot implement something for real, stop, state the blocker plainly, and propose two concrete alternatives.

## 0.3 No hardcoded values

Every one of these comes from `PoolConfig`, an `immutable`, a named `constant`, a deploy-script parameter or an environment variable read at deploy time, never a literal buried in logic: RPC URLs, chain IDs, contract addresses (PoolManager, Pyth, Chainlink feeds, routers, tokens), Pyth price-feed IDs, private keys, gas limits, fees, every threshold, window, delay and share in §14, retry counts, timeouts, ports, file paths and deadlines.

- Solidity: per-pool values live in `PoolConfig`, fixed at registration. Contract-wide values are constructor immutables. Mathematical constants (`BPS`, `PIPS`, `PRICE_SCALE`) are named constants in the library that uses them.
- TypeScript, Python and Rust: typed config plus environment variables, validated once at startup. Fail fast on missing or malformed config. Never silently default a financial parameter.
- Per-chain deployment values live in `script/config/<chain>.json` and nowhere else.
- No secrets in the repository, ever. `.env*` is gitignored from the first commit except `.env.example`, which lists every key with a comment and no value. Scan history with `gitleaks detect` before every push to a public remote.

## 0.4 Style

Every line must read as if the owners wrote it by hand.

**General.** No emojis anywhere: code, comments, commits, logs or docs. No exclamation marks, no marketing voice. Comments explain why, never what. Prefer deleting code to adding a flag that disables it. Small modules, explicit interfaces.

**Solidity.**
- `pragma solidity 0.8.26;` pinned exactly. EVM version `cancun` (transient storage).
- `// SPDX-License-Identifier: MIT` on the first line of every file.
- Custom errors only, never `require` with a string. Errors live in `src/interfaces/ITouchstoneErrors.sol` and are named `Touchstone__ReasonInPascalCase`. The two URC-4 errors, `MissingHookData` and `MalformedHookData`, keep their standard names.
- NatSpec (`@notice`, `@param`, `@return`, `@dev`) on every external and public member.
- Naming: contracts and structs `PascalCase`; external and public functions `camelCase`; internal and private functions `_leadingUnderscore`; constants and immutables `SCREAMING_SNAKE_CASE`; events in the past tense.
- File order: pragma, imports, interfaces, errors, contract; inside a contract: types, constants, immutables, storage, events, modifiers, constructor, external, public, internal, private.
- Named imports only: `import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";`.
- Every `unchecked` block has a comment above it stating the invariant that rules out overflow.
- Inline assembly only in transient-storage helpers, and only with a measured gas saving stated in the comment.
- Storage structs are packed, with a comment above each giving the bit budget per slot.
- No `public` state variables unless the getter is part of the API.
- No `delegatecall`, no `selfdestruct`, no upgrade proxy, no owner.

**TypeScript (keeper, indexer, dashboard, bots).** Strict mode, `viem` for chain access, `zod` for every external input, structured JSON logs with secrets redacted, no `any`.

**Python (research).** Full type annotations, `ruff` and `mypy --strict` clean, pinned dependencies in `requirements.lock`, fixed random seeds, and the hash of every input dataset recorded in each output.

**Rust (`sim/`).** `thiserror` in libraries, `anyhow` only at binary boundaries, no `unwrap()` or `expect()` outside tests and `main`, `tracing` for logs, `clippy -D warnings`.

**Git.** Conventional commits, imperative mood, subject at most 72 characters, no trailing period, no emoji. One logical change per commit. The body gives the rationale and the trade-off. Never "wip", "fixes" or "update". No force-pushes to `main`. Small commits throughout, so the history stays reviewable.

## 0.5 Validation after every change

Run in this order, and do not continue while anything is red:

```bash
forge fmt --check
forge build --sizes                       # TouchstoneHook must stay under 24,576 bytes
forge test -vvv
forge test --match-path "test/invariant/**"
forge coverage --report summary           # at least 95% lines and branches in src/
slither . --config-file slither.config.json
forge snapshot --check --tolerance 5      # gas regressions above 5% fail
# for the packages a change touches:
pnpm -C keeper tsc --noEmit && pnpm -C keeper test
pnpm -C indexer tsc --noEmit && pnpm -C indexer test
ruff check research && mypy --strict research
cargo fmt --check --manifest-path sim/Cargo.toml && cargo clippy --manifest-path sim/Cargo.toml -- -D warnings && cargo test --manifest-path sim/Cargo.toml
```

Zero regressions. If a change lowers coverage or raises gas on a swap path, say so with the numbers.

## 0.6 Audit passes

Before the code changes of each milestone, and again at its end, run these twelve audits and write one report per audit to `docs/audits/<milestone>/NN-<name>.md`. Every finding gets a severity, the affected file and line, a root cause and a resolution.

| # | Audit | Touchstone focus |
| --- | --- | --- |
| 1 | Hardcoded values | Thresholds, windows, addresses, feed IDs, everything in §0.3 |
| 2 | Stubs and simulation | Nothing mocked in `src/`; nothing faked in scripts |
| 3 | Dead code | Leftover trigger variants from the research; unused imports and errors |
| 4 | Security | §18, plus keeper key handling, RPC input validation, Hermes responses |
| 5 | Architecture | Hook, Settler and lens boundaries; no dependency cycles beyond the immutables |
| 6 | Code quality | Naming of regimes and units; long functions; magic numbers |
| 7 | Performance | SLOADs and SSTOREs per swap path against the targets in §17.5 |
| 8 | Error handling | Every `try`/`catch` on the swap path, and what it hides |
| 9 | Dependencies | Pinned v4, Pyth and OpenZeppelin commits; no AGPL code anywhere |
| 10 | Test coverage | Every invariant in §17.1 and every threat in §18.2 has a test |
| 11 | Bug bounty | Think like Code4rena, Sherlock, Spearbit. Write each exploit as a failing Foundry test first, then fix it, then keep the test |
| 12 | Production readiness | CI, deploy dry runs, verification, alerts, runbook |

## 0.7 Off-chain baseline (keeper, indexer, dashboard, bots)

- `.env` never committed; history scanned for secrets before the first push.
- No API keys in any browser bundle. The dashboard is read-only and has no wallet connection.
- Validate and type every input at the boundary (`zod`, `pydantic`, `serde`). Reject unknown fields. Treat Hermes, RPC and indexer responses as untrusted.
- Parameterised SQL only.
- Rate-limit every public endpoint. Restrict CORS to an explicit allowlist, never `*`.
- Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy) on the dashboard; escape all rendered content.
- Structured logs, secrets redacted, no stack traces in responses.
- `pnpm audit`, `pip-audit` and `cargo audit` in CI.

## 0.8 Honesty rules for numbers and claims

- Every number in the README, the dashboard, the video or a commit message carries its source and one label: **measured**, **historical backtest**, **simulation**, **testnet demonstration** or ***target***. Never present one as another.
- Testnet flow says nothing about LP returns. Demos show mechanics only.
- Do not claim that the Uniswap Foundation or Uniswap Labs endorses, funds or plans to integrate Touchstone.
- Do not claim novelty for ex-post settlement. Hindsight (UHI10) did it first (§3.4). Touchstone's claims are the outside reference, gated deposits, closed markets, settlement-enforced licence exclusivity, markout-proven rebates and quote integrity.
- Do not cite Assay's withdrawn 0.781 AUC anywhere.
- Never copy code from Bunni's BidDog (`AmAmm.sol` is AGPL-3.0). The lease is reimplemented from the paper and §10.

## 0.9 Definition of done (per milestone)

- No hardcoded values, placeholders, stubs or mock logic in `src/`.
- No dead code, no lint errors, no compiler warnings, no failing tests.
- NatSpec on every external member; every invariant and threat it touches has a test.
- Gas per path measured and recorded in `docs/gas.md`.
- Slither clean, or every finding triaged in `docs/decisions/`.
- Deploy script green on a fork; on a live testnet from M8 on.
- Every exploit from audit 11 has a regression test.
- The lesson for the milestone exists (§0.10).

## 0.10 Teaching protocol (mandatory)

The owners are the auditors of this code, not passengers. After every milestone, before moving on, write `docs/lessons/NN-<topic>.md` with:

1. **Concept.** The finance or CS idea in plain English, then the formula, then why this formula and not a simpler one. Assume strong Solidity and systems knowledge and no market-microstructure background.
2. **Design decisions.** What was chosen, what was rejected, and the trade-off. Name the alternative.
3. **Code walkthrough.** Every non-trivial function, line-referenced: what it does and which invariant it upholds.
4. **Failure modes.** How the component breaks, the blast radius, and the name of the test that catches it.
5. **Audit questions.** Five questions an auditor would ask, with answers. Say so where an answer is not confident.
6. **Exercises.** Three things to verify by hand, for example "recompute R for the arbitrage row of §4.7 and confirm `test_WorkedExample_MatchesReport`".

Then give a five-minute spoken-style summary in chat. A component the owners cannot explain is not done.

## 0.11 When this spec is silent or wrong

1. Look for the answer in §21 (decisions) and §4 (math).
2. If it is an implementation detail, choose the simplest option consistent with §0, write a short decision record, and continue.
3. If it touches money flow, a formula, a trust assumption or a parameter, stop and ask.
4. If the spec contradicts the code of a pinned dependency, the dependency wins. Record the contradiction in `docs/decisions/` and tell the owners.
