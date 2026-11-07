# Touchstone v2: Design Specification



**Project:** Touchstone v2. A Uniswap v4 hook and settlement system that settles each flagged swap against a canonical outside price seconds after it trades. On that one primitive it runs four markets: the clawback, an arbitrage licence, benign-flow rebates and quote integrity.
**Use:** this is the design specification: mechanism, formulas, parameters, interfaces, research plan and build plan. Section 0 holds the engineering standards the code follows.

**Source documents.** This spec merges and supersedes, for implementation purposes, two earlier design documents written on 17–18 October 2026: the *Uniswap breakthrough project research report* (rev 167) and the *Touchstone developer docs* (rev 38). Where this file and those docs disagree, this file wins, and §21 lists every place where it changed something.

---

## How to read this file

| Part | Sections | Read it when |
| --- | --- | --- |
| Rules | §0 | Before anything else, every session |
| What and why | §1–§4 | Before the first milestone; again whenever a design question comes up |
| What to build | §5–§14 | While implementing contracts |
| Around the contracts | §15–§19 | While implementing services, research, tests and deployment |
| Order of work | §20 | At the start of every session |
| Decisions | §21 | Before changing anything the spec fixes |
| Compliance, sources | §22–§23 | Before the submission, and whenever you cite a number |
| Reference code | Appendix A | At milestone M1, when importing the libraries |

---

# §0 ENGINEERING STANDARDS

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

*Environment note.* In sandboxes where `binaries.soliditylang.org` is blocked, download the static compiler from `https://github.com/ethereum/solidity/releases/download/v0.8.26/solc-static-linux` and set `solc = "<path>"` and `offline = true` in a local, uncommitted `foundry.toml` override. The reference pack in Appendix A was built that way with Foundry 1.5.1.

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

---

# §1 The idea on one page

## 1.1 One sentence

Touchstone makes a pool charge arbitrage what it actually took, proven afterwards with a signed price, or sell it that right in advance under the same proof, and refunds everyone else.

## 1.2 The insight

Toxicity is unpredictable before a trade and exact a few seconds after it. Almost every fee hook, including Uniswap Labs' VolatilePair, guesses before the swap who is informed. Two pre-registered attempts to predict that per swap failed (Sentinel and Assay, §3.1 and §3.3). Hindsight waits about a minute and asks the pool's own TWAP. Touchstone waits seconds and asks a canonical outside price: the first signed Pyth update at or after the settlement time, chosen by the contract, never by the caller.

## 1.3 The life of a flagged swap

1. **Swap.** A trader or router swaps through the PoolManager. `beforeSwap` snapshots the pre-swap price and liquidity. `afterSwap` checks the triggers, takes a refundable deposit D from the swapper as ERC-6909 claims, commits the record's hash and emits `DepositTaken` and URC-2 `HookSwap`.
2. **Wait.** Δ seconds (3 s by default), or until the reopen for a tokenized-stock swap made while the home market is closed.
3. **Settle.** Anyone, in practice the keeper, fetches the first Pyth update at or after t₀ and calls `Settler.settle`. Pyth itself enforces that the update is the first one.
4. **Pay.** The markout decides R, the part LPs keep. The rest is refunded. A capped tip pays the caller, a share funds rebates, and the LP share vests to in-range LPs through `donate`.

A swap below the retail floor N₀ that is not part of a burst posts nothing and pays only the pool fee.

## 1.4 Four markets on one primitive

| Market | What it does | Money flow |
| --- | --- | --- |
| Clawback | Flagged swaps post a deposit; settlement keeps a share α of markout above a margin ε | Arbitrageurs pay LPs |
| Arbitrage licence | A continuously auctioned lease exempts one arbitrageur's first swap in each block; inside a price band everyone else faces a steeper clawback α_lic | The holder pays LPs rent by the second |
| Benign-flow rebates | A slice ρ of retained value and rent pays whoever a benign flagged swap names, usually its router | Clawback income and rent pay routers that bring large benign trades |
| Quote integrity | `previewDeposit`, a URC-4 quote, URC-2 events and `GuardedRouter` make the deposit exact before and inside the transaction | Routers stop seeing quote–execution gaps |

Settlement runs in two modes: **continuous** (seconds after the trade) and **closed-market** (tokenized stocks, at the reopen).

## 1.5 What Touchstone is not

- Not a custom curve. The AMM stays plain v4 concentrated liquidity at a static fee. The hook never changes execution: it has no `beforeSwapReturnDelta`.
- Not custody of principal. It holds only deposits (a fraction of a flagged swap's notional), for seconds, as ERC-6909 claims inside the PoolManager.
- Not a blocker. No swap reverts because of the oracle, the licence or the calendar; a failed read means no deposit or no exemption. There are no liquidity callbacks, so no LP exit can be blocked.
- Not administered. No owner, no pause, no upgrade path. Parameters are fixed per pool at creation.
- Not a predictor. Triggers are fixed rules whose mistakes are refunded.

---

# §2 Concepts primer

Each concept below is something the code depends on. Read the linked primary source before implementing the part that uses it. Links marked *(verify)* could not be opened from the sandbox on 25 October 2026; confirm them before citing them in the README.

## 2.1 Uniswap v4 in the parts Touchstone touches

**Singleton PoolManager and flash accounting.** Every v4 pool lives inside one `PoolManager`. A caller `unlock`s it, performs operations whose token balances accumulate as per-currency deltas, and must settle every delta to zero before the unlock returns. Touchstone uses three operations inside its own unlocks: `mint`/`burn` of ERC-6909 claims, `take` and `settle` of tokens, and `donate` to in-range LPs. Source: [v4-core `PoolManager.sol`](https://github.com/Uniswap/v4-core/blob/46c6834/src/PoolManager.sol); [v4 docs: flash accounting](https://docs.uniswap.org/contracts/v4/concepts/flash-accounting).

**Hooks and permission bits.** A hook is a contract whose address encodes which callbacks it implements in its lowest 14 bits. Touchstone uses exactly four:

| Flag | Bit | Value |
| --- | --- | --- |
| `BEFORE_INITIALIZE_FLAG` | `1 << 13` | `0x2000` |
| `BEFORE_SWAP_FLAG` | `1 << 7` | `0x0080` |
| `AFTER_SWAP_FLAG` | `1 << 6` | `0x0040` |
| `AFTER_SWAP_RETURNS_DELTA_FLAG` | `1 << 2` | `0x0004` |

The address must end in `0x20C4` with every other permission bit zero, so the deploy script mines a `CREATE2` salt. Source: [v4-core `Hooks.sol` L29–L45](https://github.com/Uniswap/v4-core/blob/46c6834/src/libraries/Hooks.sol); v4-periphery's `HookMiner` in `test/shared/` at `9969eec`.

**The afterSwap return delta, and its sign.** `afterSwap` may return an `int128` on the *unspecified* currency (the output for exact input, the input for exact output). The PoolManager credits it to the hook and computes `callerDelta = swapDelta − hookDelta`. To take a deposit D from the swapper, the hook therefore returns **+D**, then balances its own credit in the same callback by minting D of ERC-6909 claims to itself. Getting this sign wrong pays traders instead of charging them (§18). Source: v4-core `Hooks.afterSwap` and `PoolManager.swap`.

**BalanceDelta convention.** A swap's `BalanceDelta` is from the caller's side: negative means the caller pays the pool, positive means it receives. Touchstone's `Record.amount0/amount1` keep this convention, so they are the trader's signed receipts x₀, x₁.

**ERC-6909 claims.** The PoolManager is an ERC-6909 multi-token: `mint(to, currency.toId(), amount)` turns a credit into a claim without moving tokens; `burn` turns it back into a credit. Claims can be transferred without an unlock, which is why rebates are credited, not pushed. Sources: [EIP-6909](https://eips.ethereum.org/EIPS/eip-6909); v4-core `ERC6909Claims.sol`.

**Donate.** `donate(key, amount0, amount1, hookData)` pays in-range LPs pro rata. It reverts with `NoLiquidityToReceiveFees` when in-range liquidity is zero, so `drip` must skip that case and let the amount wait. Donations do not pass through the v4 protocol fee, which matters for routing (§12.5).

**Reading pool state.** `StateLibrary.getSlot0(manager, id)` returns `(sqrtPriceX96, tick, protocolFee, lpFee)`; `StateLibrary.getLiquidity(manager, id)` returns in-range liquidity. Source: v4-core `StateLibrary.sol` L40 and L183.

**IMsgSender.** v4-periphery's `IMsgSender.msgSender()` lets a router report the address that started the lock. The Universal Router's `Dispatcher` implements it. Touchstone believes it only from routers in its immutable trusted list. Source: v4-periphery `src/interfaces/IMsgSender.sol`.

**OpenZeppelin BaseHook.** `BaseHook` from [OpenZeppelin uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks) supplies `onlyPoolManager`, validates the hook address against `getHookPermissions()` in its constructor, and exposes `_beforeInitialize`, `_beforeSwap(address, PoolKey, SwapParams, bytes) returns (bytes4, BeforeSwapDelta, uint24)` and `_afterSwap(address, PoolKey, SwapParams, BalanceDelta, bytes) returns (bytes4, int128)` as override points. Pin commit `b5f1057`, which is tagged **v1.3.0-rc.0** (checked 25 October 2026; no final v1.3.0 tag existed then).

## 2.2 Transient storage

EIP-1153 adds `TSTORE`/`TLOAD`, storage that clears at the end of every transaction. Touchstone keys its transient slots by `PoolId` so swaps on different pools inside one unlock never collide, and uses them for the pre-swap snapshot, the per-transaction first-touch flag, the last deposit read by `GuardedRouter`, and a reentrancy lock. Because transient storage resets every *transaction*, it cannot see *block* boundaries; the first-touch rule therefore also needs one persistent slot (`lastTouchBlock`). Source: [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153), live since Dencun (March 2024).

## 2.3 LVR, markouts and adverse selection

**LVR (loss-versus-rebalancing).** A passive LP loses to arbitrageurs who trade against stale pool prices after the outside market moves. For a constant-product pool, LVR per unit time is σ²V/8. Source: [Milionis, Moallemi, Roughgarden, Zhang, arXiv 2208.06046](https://arxiv.org/abs/2208.06046).

**Markout.** The industry's way to measure a single trade's damage: compare the execution price with the fair price a short horizon later. Uniswap Labs and Columbia measure passive LP outcomes with 15-second markouts against an outside price and find them flat from 0 seconds to an hour, which means adverse selection is realised at execution. Source: [Sadeghi et al., arXiv 2609.37963](https://arxiv.org/html/2609.37963v1). Touchstone charges that quantity, per flagged swap, at Δ = 3 s.

**Why fees alone fail.** In major 5 bp pools fees cover about 75–85% of LVR (my calculation from three studies, §3.1). Raising the fee widens the band within which arbitrage is unprofitable, which makes the pool staler. A clawback that leaves arbitrageurs a margin equal to their cost does not (§4.5).

## 2.4 Pyth: a pull oracle with a canonical "first update after t"

Pyth publishes signed price updates off-chain (served by Hermes); a caller posts an update on-chain and the Pyth contract verifies it. With an ordinary read the caller chooses which update to post, which Pyth itself calls "functionally equivalent to latency" ([best practices](https://docs.pyth.network/price-feeds/best-practices)).

`parsePriceFeedUpdatesUnique(bytes[] updateData, bytes32[] priceIds, uint64 minPublishTime, uint64 maxPublishTime) payable returns (PythStructs.PriceFeed[])` accepts an update only if `publishTime ≥ minPublishTime` and `prevPublishTime < minPublishTime`. The result is the **first** price at or after `minPublishTime`, and no caller can pick another ([API reference](https://api-reference.pyth.network/price-feeds/evm/parsePriceFeedUpdates)). Each `Price` has `price` (int64), `conf` (uint64), `expo` (int32) and `publishTime`. The value is `price × 10^expo` USD per whole token; `conf` is a one-sigma-style confidence in the same units.

- Fees: the Pyth Core update fee went to zero on EVM mainnets in August 2026; call `getUpdateFee(updateData)` anyway and forward that value ([current fees](https://docs.pyth.network/price-feeds/current-fees)).
- Hermes needs an API key. Its timestamp endpoint returns the first update at or after a given time ([Hermes docs](https://docs.pyth.network/price-feeds/how-pyth-works/hermes), which since the Pyth Core upgrade of 26 August 2026 says Hermes requires an API key; provider description via [extrnode](https://docs.extrnode.com/chains/hermes)).
- Fetch the base and quote feeds separately: their first updates after t₀ can sit in different blobs.
- Contract addresses per chain: [Pyth EVM contract addresses](https://docs.pyth.network/price-feeds/contract-addresses/evm). Feed IDs: [Pyth price feed IDs](https://pyth.network/developers/price-feed-ids) *(verify)*.
- US equities: Pyth's [market hours](https://docs.pyth.network/price-feeds/market-hours) page gives the overnight session (Sunday to Thursday, 8pm to 4am ET) and closed weekends. Touchstone v2.0 settles only against the regular session.

## 2.5 Chainlink: a push feed for the swap-time trigger

A Chainlink Standard feed stores its latest answer on-chain and updates on a deviation threshold or a heartbeat, whichever comes first (Base ETH/USD updates on a 0.15% deviation, [feed registry JSON](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json)). The hook reads `latestRoundData()` inside `afterSwap` with no payload and no fee to the swapper. Touchstone uses it only for the drift trigger and the licence fast path, never for an amount, and ignores it when older than `referenceMaxAge`. Sources: [Chainlink data feeds](https://docs.chain.link/data-feeds); [L2 sequencer uptime feeds](https://docs.chain.link/data-feeds/l2-sequencer-feeds).

**Why two oracles.** The swap path cannot carry a Pyth payload (routers will not add one, and a swapper-chosen update reopens the latency option), so the trigger needs a push feed. Settlement needs a timestamped, uniqueness-checked price at "swap time + 3 s", which a push feed usually does not have on-chain. §21 D-3 records the one-oracle alternative (Pyth-only, with a keeper pushing updates) as an open decision.

## 2.6 The am-AMM lease, and why Touchstone's licence differs

Adams, Moallemi, Reynolds and Robinson's am-AMM ([arXiv 2403.03367](https://arxiv.org/abs/2403.03367)) runs a continuous lease auction: a bid names rent per unit time and a deposit; a higher bid by a minimum increment replaces the pending one and activates after a delay K; rent flows from the deposit to LPs; the manager sets and keeps the swap fee. Bunni's [BidDog](https://github.com/Bunniapp/biddog) implements it with K = 7,200 blocks and a 10% increment, and is **AGPL-3.0**.

Touchstone's lease follows the paper, not BidDog's code, with three differences: time in seconds, rent in the quote token donated to LPs, and no fee payload. What the holder buys is different too: not the fee, but an exemption from the clawback for its first swap in each block while the pool is inside a band. Exclusivity comes from settlement, not ordering (§10).

## 2.7 Ordering, block numbers and why the licence fits first-come-first-served chains

- MEV taxes scale a fee with the swap's priority fee and need competitive priority ordering ([Paradigm, Priority Is All You Need](https://www.paradigm.xyz/2024/06/priority-is-all-you-need)). Arbitrum chains order first come, first served unless Timeboost is enabled, and priority fees do not change ordering there ([Arbitrum docs](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/priority-fees)). An MEV tax has nothing to tax on such chains; a settlement-enforced licence does not care about ordering.
- On Arbitrum and Orbit chains `block.number` returns an approximate parent-chain block number, so many L2 blocks share one value. The first-touch rule reads `ArbSys(0x64).arbBlockNumber()` there ([Arbitrum: block gas limit, numbers and time](https://docs.arbitrum.io/time)). `BlockLib` in Appendix A implements this.

## 2.8 Router-facing standards

- **URC-2** (Custom Accounting Hook Swap Event, in Discussion since 11 June 2026): a hook emits exactly one `HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee)` for every successful swap in which it contributes a token delta ([forum](https://gov.uniswap.org/t/urc-2-custom-accounting-hook-swap-event/26154)).
- **URC-4** (Active Liquidity Framework Hook Interface, in Discussion since 11 June 2026): `IALFHook`, a router-facing quoting interface with `getIndicativeQuote`, `swapToPrice`, `isLive` and `maxGas`. A co-author agreed in July 2026 to drop the `view` requirement in favour of `eth_call` ([forum](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156)).
- **Routing allowlist.** Uniswap's routing rejects upgradeable proxies, hooks that need custom calldata, and hooks that modify or bypass the protocol fee; return-delta hooks need manual review ([support article](https://support.uniswap.org/hc/en-us/articles/48291859140621-Routing-for-hooked-pools); [routing-api filter](https://github.com/Uniswap/routing-api/blob/main/lib/util/v4HooksPoolsFiltering.ts)).
- **HookBonus.** The Foundation's 2025 hook data guide defines a `HookBonus` event for hooks that rebate swappers ([guide](https://uniswapfoundation.org/blog/developer-guide-establishing-hook-data-standards-for-uniswap-v4)).

## 2.9 Glossary of symbols

| Symbol | Meaning | Field |
| --- | --- | --- |
| N, N⁺ | Swap notional in quote units; its in-the-money part | — |
| x_r, x_q | Trader's signed receipts of risky and quote (negative = paid) | `Record.amount0/1` |
| P*, c* | Fair price from Pyth at t₀; its relative confidence | — |
| m, m⁺ | Markout x_r·P* + x_q; its in-the-money part | — |
| f | Pool's static LP fee | `key.fee` |
| Δ | Settlement delay | `settleDelay` |
| W, W_c | Expiry window after t₀, continuous and closure | `window`, `windowClosed` |
| ε, ε_c | Arbitrage margin, continuous and closure | `epsBps`, `epsClosedBps` |
| α, α_lic, α_c | LPs' share: normal, outsider inside the licence band, closure | `alphaBps`, `alphaLicensedBps`, `alphaClosedBps` |
| δ, δ_max, δ_c, β | Deposit floor, cap, closure rate, gap multiplier | `deltaBps`, `deltaMaxBps`, `deltaClosedBps`, `betaX100` |
| N₀, N_min, h, τ | Retail floor, flow-bucket threshold, drain horizon, drift threshold | `n0`, `nMin`, `flowHorizon`, `tauBps` |
| g | Signed pre-swap gap to the Chainlink reference, positive toward it | — |
| G, K | Licence band; lease activation delay | `bandBps`, lease `k` |
| ρ, κ | Rebate pool's share of retained value; rebate as a share of the fee | `rhoBps`, `kappaBps` |
| J | Closed-market jump guard | `jumpRefundBps` |
| R | Retained by LPs; refund = D − R | — |

---

# §3 Research analysis

This section carries the research behind the design, condensed from the research report of 17–18 October 2026. It is context, not instructions: nothing here overrides §4–§11. Evidence labels: **verified** (primary source read), **reported** (secondary source), **unconfirmed**; "my calc" marks arithmetic on cited figures.

## 3.0 Executive verdict

**Build Touchstone v2:** a settlement layer for Uniswap v4 pools. A swap likely to be arbitrage posts a refundable deposit, and the first signed Pyth price a few seconds later decides how much LPs keep: seconds after the trade while the reference market is open, at the reopen while it is closed. On that one primitive v2 runs four markets: the **clawback** itself; an **arbitrage licence**, a leased exemption whose exclusivity settlement enforces; **benign-flow rebates**, paid to whoever routes trades that settle benign; and **quote integrity**, so routers see the exact deposit before and inside the transaction.

**A correction first.** After the first draft, a direct search found **Hindsight**, a project from the UHI10 hookathon. It bonds every swap, settles about 45–60 seconds later against the pool's own TWAP, and pays forfeited bonds to LPs. Its 7-day Unichain backtest clawed back 53.8% of gross positive markout ([repo](https://github.com/OoJae/hindsight-hook)). Ex-post settlement itself is therefore not new, and the earlier novelty claim is withdrawn. Two arithmetic fixes also landed: markouts are net of the LP fee, which changes the worked example's LP result and raises the break-even recall (§4.6).

**Why a v2.** The two-week design sat too close to Hindsight: both take refundable deposits and settle them after the fact, and the differences lay in the reference price and the trigger. v2 brings back the ideas cut only for scope (§3.5). The oracle-update auction and the bonded arbitrage lane become the licence, markout-proven payment for order flow becomes the rebates, and the quote guard becomes quote integrity. Cross-chain shared state stays out.

**Why v2 wins.** Re-scored for six weeks and two developers, v2 scores 7.60 against 7.35 for the two-market version, and leads under three of four weightings (§3.7). Under feasibility-heavy weights the smaller version leads, because v2 needs all six weeks. Against Hindsight, v2 differs in six ways:

- **It sells arbitrage rights, not only claws them back.** One arbitrageur leases an exemption for its first swap in each block and pays LPs rent by the second. Inside a price band, any outsider keeps only 5% of its excess markout, so the lease is exclusive without any control over ordering. That is why it works on first-come-first-served chains, Arbitrum and Robinhood Chain among them, where MEV taxes cannot. My searches found no other design that enforces exclusivity this way.
- **An outside price, not the pool's own.** Hindsight's own null test finds no signal from pool prices at horizons of a few seconds, while Uniswap Labs' paper finds outside-price markouts flat from zero seconds to an hour. A signed outside price allows settlement within seconds, at a price the pool cannot move.
- **Deposits only on likely arbitrage.** Hindsight bonds every swap, at about 233k gas per swap. Touchstone leaves retail below N₀ untouched, and a leaky flow bucket catches arbitrage split into small pieces.
- **It pays for benign flow.** A flagged trade that settles benign earns a rebate for the router or wallet the swap names. The markout is the proof, so no attestation is needed.
- **Closed markets.** Nearly half of Uniswap's stock-token volume trades while US exchanges are fully closed (Kaiko, via PANews). Touchstone settles those swaps at the reopen, with its own clawback settings, because weekend noise would otherwise tax benign traders.
- **Routability and proof.** `previewDeposit`, a URC-4 quote, URC-2 events and a guarded router make the deposit visible before and inside the transaction. A pre-registered bake-off pits Touchstone against static fees, VolatilePair and Hindsight-style settlement on the same tapes.

**Assay and VANE.** Neither should be the project. Assay's 0.781 AUC was withdrawn in its own repository because it rested on 1-minute candles; the corrected 0.7485 fails its pre-registered gate, and its oracle-gap fee is now deployed by others (SkewHook) and, without an oracle, by Uniswap Labs (VolatilePair). VANE is fully built, but its own replay result is negative. Assay's drift trigger and 1-second markout pipeline carry forward as Touchstone's trigger and first test.

**What could kill it,** in the order it can be tested: trigger recall below break-even, about 0.45 at published averages (day 3); Hindsight-style settlement matching Touchstone in the bake-off, which would mean the oracle adds nothing; weekend flow carrying no information, or a noise tax larger than what the clawback recovers; routers refusing to quote. A licence that fails to beat the plain clawback (E10) switches the licence off and leaves the rest standing. §3.10 has the full list.

**Recommendation.** Build v2 over six weeks, gated by the day-3 recall test: if held-out recall misses break-even, stop and switch to the runner-up. Enter ETHGlobal Mumbai's Continuity track with the core documented as prior work, and build the licence at the event (§22). Ship every pool with the licence switched off until E10 shows it pays. This specification implements all of it, contract by contract.

*Method, stated plainly: eight research tracks ran as parallel agents and a 12-discipline council debate was written by one model. No 1,000 independent agents were run (§3.11).*

## 3.1 Uniswap problem landscape

The most consequential unsolved problem is that passive LPs in Uniswap's largest pools lose money to informed flow, and no hook can yet prove on-chain that it fixes this. Rows are ordered by severity times evidence strength.

| # | Problem | Evidence (measured unless noted) | Who pays | Open gap |
| --- | --- | --- | --- | --- |
| 1 | Passive LPs lose to adverse selection | Fees cover about 75–85% of LVR in major 5 bp pools (my calc from three studies). 15-second passive markouts were −1.5 bps (Ethereum v3) and −3.1 bps (Ethereum v4), Feb–Nov 2025 ([Uniswap Labs/Columbia](https://arxiv.org/html/2609.37963v1)). A preprint finds −$35.6M net across 62 pools, Jan–Sep 2026 ([Kovalenko](https://www.researchsquare.com/article/rs-11118453/v1)). | Passive LPs | No mechanism with a measured improvement on a live hooked pool |
| 2 | Toxicity is concentrated but unpredictable per swap | 2.8% of swaps carried about 29% of Ethereum DEX volume ([Heimbach et al.](https://arxiv.org/html/2401.01622v3)); the top 10% of LVR trades caused about 80% of LVR ([Ahlroos & Eloranta](https://hackmd.io/@anteroe/BkIbSfwmJx)). Two pre-registered prediction tests failed: Sentinel, ρ ≈ 0.02 on 2.5M Unichain trades ([repo](https://github.com/chaosxcode/sentinel-hook)), and Assay, AUC 0.7485 with a failed gate. | LPs (misses), retail (false positives) | Price toxicity without predicting it |
| 3 | Ex-ante oracle fees hand the swapper an option | Pull oracles let the swapper pick the price, which Pyth calls "functionally equivalent to latency" ([Pyth](https://docs.pyth.network/price-feeds/best-practices)). Push feeds lag: Base ETH/USD updates on a 0.15% deviation ([Chainlink](https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-base-1.json)). | LPs | A canonical post-trade price nobody gets to choose |
| 4 | Benign flow bypasses pools | UniswapX carried 87% of interface WETH-USDC volume (Nov–Dec 2023) ([Uniswap Labs](https://blog.uniswap.org/UniswapX_PI.pdf)); over 85% of UniswapX volume settled against market-maker inventory ([Yuminaga et al.](https://arxiv.org/html/2503.00738v3)). | LPs, left the toxic residual | Pools cannot reward benign flow |
| 5 | Hooked liquidity is not trusted | 0x flagged 54.2% of 84,163 hooks as malicious, quoting one price and settling another (reported, [CryptoSlate](https://cryptoslate.com/malicious-uniswap-v4-hooks-are-baiting-defi-traders-with-fake-swap-quotes/)). The Foundation's framework does not certify hooks ([UF](https://uniswapfoundation.org/blog/hook-security-framework)). | Traders, honest hook builders | Verifiable, on-chain execution quality |
| 6 | Routers cannot read custom hooks | URC-2, URC-3 and URC-4 are still in Discussion ([URC-4](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156)); a wallet asked for machine-readable all-in fees ([forum](https://gov.uniswap.org/t/temp-check-activate-v4-protocol-fees/26162?page=2)). | Hook builders, wallets | Implementations and verifiers |
| 7 | Protocol fees press on LP economics | v4 protocol fees went live on 7 chains on 27 Jul 2026 ([vote 100](https://vote.uniswapfoundation.org/proposals/100)); a forum participant (Panoptic's founder) argued LPs should be compensated first. The Protocol Fee Discount Auction is specified, and no public artifact shows it shipped ([UNIfication](https://blog.uniswap.org/unification)). | LPs, governance | An LP-side offset; PFDA itself |
| 8 | Tokenized stocks detach when their anchor closes | 71% of Uniswap stock-token volume traded outside US hours in September (reported, [PANews/Kaiko](https://panews.io/articles/01a101ea-0b22-730a-8344-ff4c64da178c)). HIMS printed $132.64 against a $28.84 close, about 4.6× (reported, [The Defiant](https://thedefiant.io/news/tokens/a-memecoin-called-boner-has-cornered-half-the-tokenized-hims-and-hers-float)). | Traders who overpaid; LPs on weekend news | Market-status-aware pricing; today's hooks go by the clock |
| 9 | Short-lived liquidity cream-skims | Liquidity held 20 s or less supplied 42–84% of volume in several v4 L2 pools; passive LPs underperform the pool aggregate ([Uniswap Labs/Columbia](https://arxiv.org/html/2609.37963v1)). | Passive LPs | Contested: Labs is building on active liquidity |
| 10 | Sandwiches dominate 1 bp ETH-stable pools | Sandwich legs were 48–76% of volume in Ethereum 1 bp ETH-stable pools, Feb–Nov 2025 ([same paper](https://arxiv.org/html/2609.37963v1)). | Traders with loose slippage | Partly closed by per-hop slippage, Mar 2026 ([commit](https://github.com/Uniswap/v4-periphery/commit/03b2d0939b2cb13c4d3cb98eadc563a349fbad3b)) |
| 11 | Liquidity fragments across versions and hooks | ETH/USDC on Ethereum: about $107M a day on v3 against about $11M on v4, Jul–Oct 2026 (my calc from [Bitquery](https://bitquery.io/investigations/uniswap-v3-vs-v4)). | Traders (thinner depth) | Partly addressed by Labs' ALF multiplexer |
| 12 | No hook has measured LP outcomes | No measured LVR or net return was found for any hooked or dynamic-fee v4 pool. VolatilePair went live on 14 Oct 2026 without one ([Uniswap Labs](https://blog.uniswap.org/volatilepair-hook-pricing-both-sides-of-the-trade)). | LPs choosing hooks; governance | Verifiable measurement |

Rows 1, 2, 3, 5 and 12 share one root. A pool cannot see the fair price when a trade executes, and nobody can verify execution quality on-chain afterwards. That root, not any single symptom, is what the winning project attacks. v2 also answers rows 4 and 6 directly: rebates pay for benign flow, and quote integrity shows routers the deposit before and inside the transaction.

## 3.2 Competitive landscape

Almost every answer to LP losses either guesses who is informed before the trade or auctions the right to trade first. One, Hindsight, settles each swap after it trades, but judges it by the pool's own later price. None settles a swap against a canonical outside price after it trades. And every design that sells the right to arbitrage enforces it through ordering or through the fee, never through settlement. Rows are grouped by approach.

| Approach | How it works | Status, Oct 2026 | What it leaves open |
| --- | --- | --- | --- |
| [VolatilePair](https://github.com/Uniswap/v4-hooks-public/blob/main/docs/technical/VolatilePairHook.md) (Uniswap Labs) | Oracle-free. Fees lean toward the last block's move; the side trading against a move pays a one-block temporary fee and a mid-block extra | Live on Ethereum ETH/USDC since 14 Oct 2026; governance-upgradeable; Labs creates the pools | Infers informed flow from the pool's own past path, so the first arbitrage after a new CEX move pays the previous move's fee. No LP-return data published |
| [StablePair](https://blog.uniswap.org/keeping-value-in-the-pool-how-stablepair-hook-works) (Uniswap Labs) | Fixed spread inside a band; corrective swaps from outside it go through a per-block decaying Dutch auction | Live since 10 Sep 2026; $3.1B in four weeks | Stable pairs only; Labs-configured pools |
| [Angstrom](https://defillama.com/protocol/angstrom) (Sorella) | App-specific sequencing by a staked node set; batch auctions internalise arbitrage | Live on Ethereum; about $564M 30-day volume (DefiLlama, reported) | Trust in its node set; one venue |
| [MEV tax](https://www.paradigm.xyz/2024/06/priority-is-all-you-need) (Paradigm), Angstrom L2 | Fee scales with the swap's priority fee, taxing the race to trade first | Works on priority-ordered chains; Angstrom L2 registered on Base | Depends on sequencer ordering; Unichain's ordering is uncommitted after its 29 Oct migration. Cannot work where ordering ignores priority fees: Arbitrum and other Orbit chains such as Robinhood Chain (first come, first served, or Timeboost) |
| am-AMM (Bunni v2) | A manager chosen by a continuous lease auction sets the fee, keeps fee income and trades fee-free, paying rent to LPs. Bunni's BidDog library (AGPL-3.0) implements it with a 7,200-block activation delay and a 10% minimum increment | Bunni was exploited for $8.4M in Sep 2025 and shut down in Oct 2025, as The Block reported ([post-mortem](https://blog.bunni.xyz/posts/exploit-post-mortem/)) | No measured results; a Bunni fork with am-AMM (NomadHook) is registered on Base. Exclusivity comes from fee control, so retail pays the manager's fee too |
| [Detox Hook](https://ethglobal.com/showcase/detox-hook-mppeg) (ETHGlobal Prague 2025) | Pyth price read at swap time; the fee captures 70% of arbitrage profit, 80% donated to LPs | Hackathon prototype | The swapper supplies the price, which Pyth itself calls a latency option |
| Assay, DriftFee, CrossPoolOracleHook, StoikovHook, OrderflowDiscriminator | Direction-aware fees from a reference or own-price gap | Hackathon and research builds | Ex-ante guesses; prediction failed under pre-registration |
| [SkewHook](https://github.com/Uniswap/hooklist/blob/main/hooks/ethereum/0xb8f9aa9f39ffbec861f7014f1604f0b89ab2e080.json) and two wstGBP hooks (Ethereum) | Chainlink gap between pool and market price; gap-closing swaps pay more, gap-widening swaps get a discount; flat fee when the oracle is stale | On Uniswap's hooklist since 17 Sep 2026 (wstGBP since 7 Jul); contract code not reviewed | Assay's mechanism, already deployed by others; still an ex-ante guess |
| [Sentinel](https://github.com/chaosxcode/sentinel-hook) | Volatility-clustering fee, adopted after its per-trade predictability gate failed | Unichain Sepolia | Abandoned per-swap pricing |
| [Diamond](https://eprint.iacr.org/2022/1420) and a [v4 per-block conversion hook](https://ethresear.ch/t/uniswap-v4-hook-lvr-minimization-with-per-block-conversion-vs-futures-contracts/18610) | Block producers auction arbitrage; the hook variant gives the first swap to a collateralised arbitrageur and settles part of the value via later futures | Research, 2022–2024 | Needs a designated, bonded arbitrageur |
| [Whitelisted-arb AMM](https://efalken.substack.com/p/amm-with-whitelisted-arbs) (Falkenstein, 2025) | Margin-account arbitrageurs trade fee-free; positive profit is taxed after the fact, against the AMM's own price | Design essay | Whitelist; own-price reference; settles per position, not per swap |
| [Hindsight](https://github.com/OoJae/hindsight-hook) (UHI10 hookathon) | Every swap posts a refundable bond (25 bps times a reputation multiplier) as ERC-6909 claims; about 45–60 s later, markout against the pool's own TWAP decides refund or forfeit to LPs | Testnet only (Unichain Sepolia); 133 tests; a 7-day Unichain backtest reports 53.8% of gross positive markout clawed back | Own-TWAP reference needs a minute and trusts the pool; bonds every swap (about 233k gas); no closed-market handling |
| [BaseDynamicAfterFee](https://github.com/OpenZeppelin/uniswap-hooks/blob/master/src/fee/BaseDynamicAfterFee.sol) (OpenZeppelin), [BackGeoOracle](https://github.com/RigoBlock/back-geo-oracle/blob/main/src/BackGeoOracle.sol) (Rigoblock) | A fee taken after the swap against a target; an automatic backrun of large swaps, credited to the sender as ERC-6909 | Library code; registered hook | Both settle inside the same transaction, so no later price ever judges the trade |
| [McAMM](https://ethresear.ch/t/mev-capturing-amm-mcamm/13336) | Auction for the first trade in each block | Research, 2022 | Other swaps revert until the winner trades |
| [LodeHook](https://github.com/Uniswap/hooklist/blob/main/hooks/ethereum/0x8f24193cc75fc64a30a038442bcd622ff4070088.json) (Ethereum) | The first swap in each block pays a premium; a minimum input size stops dust swaps from disarming it | On Uniswap's hooklist since 13 May 2026 | Charges the first swap whatever it turns out to be worth, benign or not |
| [MEVCapture](https://github.com/EkuboProtocol/evm-contracts/blob/main/src/extensions/MEVCapture.sol) (Ekubo) | Extra fee in proportion to how far the price has moved since the block began; swaps must use its router | Live on Ekubo, not Uniswap; no measured results found | Ex-ante and router-gated |
| Oracle-extractable-value auctions ([Chainlink SVR](https://docs.chain.link/data-feeds/svr-feeds), API3, RedStone Atom) | Auction the backrun of an oracle update | Live for lending only; about $22M recaptured on Aave, $14.1M of it to Aave and $7.6M to Chainlink | Not built for DEX pools |
| [Pyth Express Relay](https://forum.pyth.network/t/passed-op-pip-124-express-relay-wind-down/2642) | Order-flow auction | Being wound down; revenue under $2,000 a month | Gone |
| UniswapX, CoW, 1inch Fusion | Intents filled by solvers or market makers | Live | Takes benign flow away from pools |
| [Hooks Routing Rebate](https://uniswapfoundation.org/blog/hooks-routing-rebate-program-with-brevis) (UF × Brevis) | Gas rebates for routing through hooked pools, proven with ZK | Announced Oct 2025; up to $9M | Pays for routing, not for flow quality |
| Market-hours hooks (trading-days, SessionHook, MarketHoursFeeHook) | Block or surcharge swaps by the NYSE clock | SessionHook and MarketHoursFeeHook registered on Robinhood Chain since 18 Sep 2026, usage unknown; trading-days is an older mainnet hook | Ignore oracle market status and corporate actions |
| Protocol Fee Discount Auction | Auction fee-free swap windows; proceeds burn UNI | Specified in UNIfication, unshipped | The whole build |

Three gaps run through the table. Nothing settles a swap against a canonical outside price after it trades; Hindsight, the only ex-post design found, uses the pool's own TWAP. Nothing sells the right to arbitrage without controlling either ordering (McAMM, MEV taxes, Timeboost) or the fee (am-AMM). And nothing gives LPs, routers or governance verifiable, on-chain evidence of whether a hook improves outcomes.

## 3.3 Assay and VANE: what carries forward

Assay is a carefully engineered oracle-gap fee whose core rule SkewHook has deployed, and whose aim Uniswap Labs has shipped without an oracle. VANE is fully built, and its own simulator says it does nothing. Both are worth more as parts than as products. Everything below was read from the public repos at Assay `513ce2a` and VANE `33a2302`.

#### What Assay actually does

- **Fee rule (form verified in code; the constants are the deployed values the README reports).** fee = clamp(500 + ⌈signed drift × 100 × 1000 / 10,000⌉, 100, 10,000) pips. Signed drift is the Chainlink ETH/USD reference tick minus the pool tick, signed by trade direction ([Mispricing.sol](https://github.com/PrazwalR/assay/blob/513ce2aba7e76c7af08fc4e1a3141e2286f501c8/src/libraries/Mispricing.sol#L12-L28), [FeeBlend.sol](https://github.com/PrazwalR/assay/blob/513ce2aba7e76c7af08fc4e1a3141e2286f501c8/src/libraries/FeeBlend.sol#L29-L77)). There is no swap-size term.
- **Oracle handling.** The reference is read once per block inside `beforeSwap`. A stale or failing oracle quotes the 1% ceiling and never reverts.
- **The "TWAP".** It is an EWMA of the pool's own tick, used only to sanity-cap Chainlink readings. The f\*(Δx) break-even formula from your public post appears nowhere in the code or its history.
- **Open issue.** High finding H-2 is still open: JIT liquidity can manufacture the drift the fee reads ([README](https://github.com/PrazwalR/assay/blob/513ce2aba7e76c7af08fc4e1a3141e2286f501c8/README.md#L283-L295)).

#### The AUC result

The 0.781 figure was withdrawn by the repo itself, and it should not appear in applications or posts. It came from 1-minute Binance candles, which stretched a 30-second markout to 30–90 seconds. With 1-second candles the same label scores 0.7485, and the pre-registered gate fails two of five criteria: weakest walk-forward fold 0.469, and only 91 test positives ([P0-GATE-RESULT.md](https://github.com/PrazwalR/assay/blob/fcf186ad3cd5f29a9afccd8bf7fbab7858b177c9/P0-GATE-RESULT.md)).

The microstructure features added −0.008 AUC over the oracle gap alone. The label and the main feature come from the same Binance series, so part of the score restates "this swap closed a CEX–DEX gap". What the experiment supports is a known fact, not a novel classifier.

#### What VANE actually does

VANE is not a spec: it has 42 commits, about 231 tests, a Rust revm replay simulator and a Sepolia deployment. Its README reports the M6 result as negative. Under self-generated volatility the open-loop gain is identically zero, and even when it activates (variance ratio above 4) the belief peaks at about 0.53× its own dust threshold, so no offset is ever applied ([README](https://github.com/PrazwalR/vane/blob/33a2302e4ba78fd7193a3d253b6f148e36e4b8f5/README.md#L90-L123)). Worst-case gas is 72,654 against a 45,000 budget.

The reason is structural. If the only price you observe is the pool's own, measured volatility already equals pool impact times flow, so σ = λ\_amm · U and Kyle's λ\* = σ/(2U) = λ\_amm/2. With only its own price, VANE's estimator cannot separate the pool's impact from information, so detecting under-reaction this way needs an outside price. Other oracle-free designs, such as VolatilePair and ZeroSwap, price information by different routes.

#### Prior art against both

- **Assay's core** appears in Detox Hook (ETHGlobal Prague 2025, captures 70% of arbitrage profit against Pyth), OrderflowDiscriminator (2023), CrossPoolOracleHook (2026), DriftFee (2026), StoikovHook (ETHGlobal Tokyo 2026) and Uniswap Labs' VolatilePair, live since 14 Oct 2026. SkewHook, on Uniswap's hooklist for Ethereum since 17 Sep 2026, describes the same rule almost word for word: a Chainlink gap, higher fees for gap-closing swaps, a discount for gap-widening ones, and a flat fee when the oracle is stale.
- **VANE's mechanism** (Kyle-λ matching, signed belief offset, variance-ratio control) matched no v4 hook in the sources scanned. Trade-driven quote updates already exist in papers (ZeroSwap, Adaptive Curves), so the variance-ratio control is the new part, and the mechanism is not effective.

#### What carries forward

| Asset | From | Role in the recommendation |
| --- | --- | --- |
| Signed drift and per-block reference caching | Assay `Mispricing.sol`, `AssayHook.sol` | The cheap trigger for which swaps post a deposit |
| Fail-upward oracle adapter and L2 halt detector | Assay `ChainlinkReferenceAdapter.sol` and AssayHook.sol | Safe degradation when the reference is stale |
| v3 swap fetcher, Binance 1-second candles, markout labels, pre-registered gate | Assay `calibration/` | The replay and the falsification test |
| revm replay of compiled hook bytecode | VANE `sim/` | Running the real hook against historical flow |
| Variance ratio of the pool's own price | VANE `VarianceRatio.sol` | A diagnostic of pool price efficiency, not a control law |
| Invariant, exploit and hostile-oracle suites | Both repos | Test templates |

Verdict on the three strategic paths. A better oracle-gap fee is dead: SkewHook deployed one, and Labs shipped an oracle-free directional fee. An Assay–VANE synthesis adds complexity without a measurable gain. A new direction that reuses these parts is the path the rest of this report takes. Reusing the code at ETHGlobal requires a Continuity entry with the prior work documented; the Classic track requires fresh code.

## 3.4 Against Hindsight, the closest prior art

|  | Hindsight (UHI10) | Touchstone v2 |
| --- | --- | --- |
| Reference price | The pool's own TWAP | A signed Pyth update: the first at or after t + Δ, chosen by the contract |
| Settlement | About 45–60 s after the swap | Seconds after the swap; at the reopen for closed markets |
| Who posts a deposit | Every swap: 25 bps times a reputation multiplier | Flagged swaps only; retail below N₀ untouched; a flow bucket catches split trades |
| Gas on an ordinary swap | About 233k (reported) | *Target:* 15k below N₀, 40k above it |
| Arbitrage rights | Not sold | Leased; inside the band outsiders keep 5% of their excess, so the lease is exclusive without ordering control |
| Benign flow | Bond scaled by reputation | Rebates on markout-proven benign trades, to whoever the swap names |
| Router quotes | A bond-aware minimum output, listed as future work | `previewDeposit`, a URC-4 quote, URC-2 events, `GuardedRouter`, refunds to the router's reported caller |
| Manipulation | Trusts its own TWAP, with jump clamping | No pool price enters settlement |
| Pool freshness | Deadband θ = θ\_min + kσ | Margin ε set at arbitrage cost; in-the-money accounting against padding; the licence band as a backstop |
| Closed markets | Not addressed | Settled at the reopen, with their own α and ε |
| Splitting a trade | Cannot evade: every swap is bonded | Bounded by the flow bucket; E5 measures the leak |
| Evidence | Built; 7 days, Unichain, 55,822 swaps, 53.8% of positive markout clawed back | Nothing built yet; pre-registered E1 to E12 over months on three chains, with Hindsight-style settlement as a baseline |

Hindsight's results also count in Touchstone's favour as evidence: ex-post settlement recovered about half of positive markout even with a weaker reference price, and its per-trade predictive correlation was about zero, which matches this report's case against prediction.

## 3.5 Candidate pipeline

Thirty-seven distinct directions were generated before any were shortlisted; five survived. "Problem" refers to the numbered rows of the problem landscape. A candidate was eliminated if it already exists, if its central thesis failed on evidence, or if it could not be credibly built and measured in about 36 hours.

| # | Candidate | Problem | Mechanism and integration point | Closest prior art | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Harden Assay's oracle-gap fee | 1, 2 | Chainlink gap → fee in `beforeSwap` | Detox, DriftFee, VolatilePair | Eliminated: SkewHook deployed it; Labs shipped an oracle-free version |
| 2 | Toxicity-priced liquidity (logistic score) | 2 | Per-swap posterior → fee and rebate | Assay gate, Sentinel gate | Eliminated: prediction failed twice under pre-registration |
| 3 | **Ex-post settlement of flagged swaps (Touchstone)** | 1, 2, 3, 12 | Refundable deposit in `afterSwap`; settled at a canonical Pyth price shortly after the trade | Hindsight (UHI10; settles every swap against the pool's own TWAP); Falkenstein 2025 and Diamond (both need a bonded arbitrageur) | **Shortlisted** |
| 4 | MEV-tax hook | 1 | Fee scales with priority fee | Paradigm, Angstrom L2 | Eliminated: exists; ordering risk |
| 5 | Closed-form optimal volatility fee | 1 | f\*(σ²) lookup table | Dozens of volatility fees | Eliminated: crowded, volatility-only |
| 6 | VANE Kyle-λ belief offset | 1 | Signed offset from order flow | None found | Eliminated: author's own M6 result is zero gain |
| 7 | Oracle-anchored PMM curve | 1 | Custom curve centred on an oracle | DODO, Lifinity, WOOFi (exploited) | Eliminated: known; manipulation surface; custody |
| 8 | Cross-pool reference fee | 1, 3 | Deepest same-chain pool as reference | CrossPoolOracleHook | Eliminated: exists |
| 9 | Deferred settlement (async swap at next oracle price) | 1, 3 | Hook escrows the trade, settles later | Perp delayed orders | Eliminated: custody risk, unroutable |
| 10 | Bonded arbitrage lane | 1 | Bonded arbitrageurs get first access, settled against the bond | Diamond hook, Falkenstein | Merged into 3 as a later phase |
| 11 | On-chain LVR ledger and LVR insurance | 1, 12 | Cumulative LVR index; underwriters | None live | Ledger merged into 3; insurance deferred |
| 12 | Variance-ratio pool-health metric | 12 | VR(k) of the pool's own price | None found | Kept as a diagnostic in validation |
| 13 | **Protocol Fee Discount Auction prototype** | 7 | Auction fee-free windows through a forked fee adapter | Specified in UNIfication | **Shortlisted** |
| 14 | Markout-proven payment for order flow | 4 | Pools pay routers whose flow is proven benign | UF × Brevis pays gas only | Merged into 3 as its second application |
| 15 | Pool-native UniswapX filler | 4 | Pool fills signed intents at a better price | None | Eliminated: anyone can sign an intent, so it is spoofable |
| 16 | Wallet-attested retail discounts | 4 | EIP-712 retail proofs unlock a discount | Loyalty hooks | Eliminated: spoofable or centralised |
| 17 | Hybrid routing to CoW or Flashbots | 4, 10 | Hook routes flow to private auctions | UHI10 theme | Eliminated: infrastructure-bound, low novelty |
| 18 | Intra-block displacement fee | 10 | Fee grows with in-block move | VolatilePair mid-block extra, Ekubo | Eliminated: shipped |
| 19 | Same-sender sandwich clawback | 10 | Detect front and back legs by sender | Various hooks | Eliminated: two contracts evade it |
| 20 | Oracle-update backrun auction for AMMs | 1 | Auction the first swap after each oracle update | McAMM; SVR is lending-only | Eliminated for the event: needs auction infrastructure |
| 21 | **Bonded execution guarantees for hooks** | 5 | Hooks post a bond; proven settlement worse than fair price minus declared fee is slashed | None found | **Shortlisted** |
| 22 | Quote-versus-settlement guard | 5, 6 | In-transaction quote, then swap, then compare | Router practice | Merged into 21 |
| 23 | Shared reserves across hooks | 11 | One vault feeding many hooked pools | Labs ALF multiplexer, DualPool | Eliminated: Labs is building it |
| 24 | JIT fee maturity curve | 9 | Fees vest by holding time | OZ LiquidityPenaltyHook (bypassed in audit) | Eliminated: prior art; cuts against Labs' direction |
| 25 | Fee-tier unification | 11 | One dynamic pool replaces tiers | VolatilePair | Eliminated |
| 26 | Out-of-range rehypothecation | 1 | Idle liquidity to lending | DualPool | Eliminated: shipped |
| 27 | **URC-3 and URC-4 compliance kit** | 6 | Reference implementations plus a test harness | Standards in Discussion | **Shortlisted** |
| 28 | All-in route fee resolver | 6, 7 | LP + protocol + hook fee before execution | Requested on the forum | Eliminated: SDK, low novelty |
| 29 | Aggregator hook for an uncovered venue | 11 | Wrap Balancer, Ekubo or FluidDexV2 per Labs conventions | Labs aggregator hooks | Eliminated: useful, not a breakthrough |
| 30 | On-chain hook-safety attestations | 5 | Attest analysis results on-chain | None on-chain | Eliminated: curation, not a mechanism |
| 31 | Multi-hook multiplexer | 11 | Several hooks per pool | Community work, ALF | Eliminated |
| 32 | **Market-status-aware tokenized-equity hook** | 8 | Chainlink market status, corporate-action factor, protection widening with time since a trusted price | Clock-based market-hours hooks | **Shortlisted** |
| 33 | Settle weekend stock trades at the reopen | 8 | Weekend swaps post deposits settled at Monday's open | None found | Merged into 3 as a market application |
| 34 | LST exchange-rate-tracking hook | 1 | Curve shifts with the on-chain staking rate | Curve and Balancer rate providers | Eliminated: a port of a known design |
| 35 | Stablecoin depeg breaker | 1 | Fee or halt on depeg | StablePair | Eliminated |
| 36 | Launch-pool price discovery | — | Auctions seeding v4 liquidity | Labs CCA | Eliminated: shipped |
| 37 | Cross-chain shared pool state | 11 | Operators keep aggregate state | EigenLayer idea list | Eliminated: far beyond 36 hours |

Four patterns decided most eliminations. Uniswap Labs shipped the idea in 2026 (1, 18, 23, 25, 26, 35, 36). Prediction failed on evidence (2, 6). The design is spoofable once `sender` is understood to be the router (15, 16, 19). Or the build needs infrastructure no solo team can stand up in a weekend (17, 20, 37).

#### What v2 brings back

The two-week plan revived the ideas cut only for the 36-hour limit, but kept them as separate candidates. v2 builds four of them into Touchstone, because each needs exactly what Touchstone already has: a canonical post-trade price and a per-swap record.

| Cut idea (#) | Why it was cut | What v2 does with it |
| --- | --- | --- |
| Bonded arbitrage lane (10) | Needed a designated, bonded arbitrageur | **The licence.** Anyone may bid; settlement makes the winner's exemption exclusive, so no designation or bond is needed |
| Oracle-update backrun auction (20) | Needed auction infrastructure | Folded into the licence: one continuous on-chain lease instead of an auction per oracle update |
| Markout-proven payment for order flow (14) | Merged as a second application, never specified | **Benign-flow rebates**, paid to whoever the swap names |
| Bonded execution guarantees (21) and the quote guard (22) | Value depended on routers routing on bonds | **Quote integrity**: `previewDeposit`, a URC-4 quote, URC-2 events and `GuardedRouter`. The bond itself stays out: Touchstone never changes execution, so it has nothing to bond against, and the in-transaction check gives routers the same assurance |
| Hybrid routing to CoW or Flashbots (17) | Infrastructure-bound | An optional intents path: a UniswapX filler that routes through Touchstone pools and earns rebates |
| Settle weekend stock trades at the reopen (33) | Already merged | Kept, with its own clawback settings and a jump guard |
| Cross-chain shared pool state (37) | Far beyond 36 hours | **Still out.** It needs cross-chain messaging and trust that a per-pool, admin-free design avoids, and Pyth already gives every chain the same settlement price |

## 3.6 Council debate

The decisive argument was between predicting toxicity and settling it, and settlement won on evidence. Eight disagreements shaped the shortlist; each is shown with how it was resolved and the dissent that remains.

| Question | Position A | Position B | Resolution | Remaining dissent |
| --- | --- | --- | --- | --- |
| Predict or settle? | Quant: better features will lift per-swap AUC | Data and adversarial: two pre-registered failures; Uniswap Labs finds adverse selection is realised at execution | Settle. Prediction survives only as a cheap trigger whose errors are refunded | Settlement cannot recover a toxic swap the trigger missed |
| Oracle or oracle-free? | Protocol: Labs chose oracle-free on purpose; oracles add trust and liveness risk | Mechanism: an oracle-free pool cannot see the move it is protecting against | Use the oracle only to settle amounts capped by the deposit, never for execution or principal | A Pyth dependency, plus Hermes API-key friction for keepers |
| Is a clawback "last look"? | Product: FX last look is reviled; "the pool takes money back" will scare routers | Mechanism: last look is discretionary rejection; this is a published, capped rule that refunds benign trades | Disclose the rule in quotes and docs; compare it to markout-tiered order-flow payments, not last look | Perception risk is real |
| Does protection make the pool stale? | LP: charging arbitrage more widens the no-arbitrage band | Mechanism: a fee raises the threshold; a clawback that leaves arbitrageurs a margin equal to their cost does not | The margin ε becomes the most important parameter; validation must measure pool freshness | Below arbitrageurs' cost the pool goes stale; above it, they pad trades past fair value |
| Build where Labs builds? | Governance: PFDA and the URC kits are what Labs asked for | Adversarial: Labs shipped six hooks in 2026 and will build its own roadmap | Build a primitive Labs' hooks could adopt, not a clone of a roadmap item | PFDA remains a credible second choice |
| Which chain? | Cross-chain: Robinhood Chain has about 36% of v4 volume and 63% of v4 fees (DefiLlama, 30-day) | MEV: Unichain's ordering made MEV taxes credible | Chain-agnostic design with no ordering assumption; build on a testnet with full v4 deployments | Unichain's post-29 Oct ordering is unknown |
| Mechanism or measurement? | Data: verifiable measurement is the scarcest thing in the field | Engineering: measurement alone reads as a dashboard | Ship both: the settlement ledger is the measurement, the clawback is the teeth | Scope pressure in 36 hours |
| Who receives refunds? | Security: `sender` is the router, and `tx.origin` breaks for smart accounts | Product: refunds must reach users without router integration | Beneficiary from `hookData` when the router supplies it, else `tx.origin` | Smart-account flows need router support |
| Sell arbitrage rights, or only claw them back? | MEV: a licence needs ordering control, or it becomes a monopoly that pays the reserve | Mechanism: settlement makes an outsider's win worth 5% of its excess to it and 95% to LPs, so no ordering is needed; jumps beyond the band go back to the clawback | Build it, optional per pool and off until E10 shows that two bidders beat the plain clawback and one bidder at the reserve does no worse | With a lone bidder, inside-band value above the reserve leaks |
| Pay routers for flow? | LP: rebates invite wash trading and read as payment for order flow | Mechanism: a rebate below the fee makes every wash leg lose; only an LP washing against its own liquidity can profit, and only from the rebate pool | Rebates of 40% of the fee, funded by 10% of retained value, with a lower rate on pools where one LP dominates | A backtest cannot show whether rebates attract flow |

#### Arguments rejected

- "Assay is the first per-swap adverse-selection fee." Five public precedents and Labs' VolatilePair say otherwise.
- "AUC 0.781 shows toxicity is predictable." The repo withdrew it; the corrected gate fails.
- "VANE's oracle-free estimator can price information." VANE's own simulator and the identification argument say it cannot.
- "Market-hours pricing for stock tokens is unsolved." Three such hooks exist; only a market-status-aware version is open.
- "A Unichain MEV tax is the obvious win." Angstrom L2 exists, and Unichain's ordering is uncommitted after its migration.

#### Insights that survived every round

1. Adverse selection is realised at execution: passive markouts are flat from 0 seconds to an hour ([Uniswap Labs/Columbia](https://arxiv.org/html/2609.37963v1)). A swap's damage is therefore measurable seconds after it trades.
2. Pyth's `parsePriceFeedUpdatesUnique` returns the earliest update after a given time, so a post-trade price can be canonical rather than chosen, and the Pyth Core update fee is zero ([Pyth](https://api-reference.pyth.network/price-feeds/evm/parsePriceFeedUpdates), [fees](https://docs.pyth.network/price-feeds/current-fees)).
3. A clawback whose margin equals arbitrageurs' cost keeps the pool as fresh as a plain pool while taxing the rent above it; a margin above cost invites padded trades.
4. Refunds remove the fee cost of false positives, though not their side costs (locked capital, moved quotes, possible reverts), so triggers can lean toward recall without ignoring precision.
5. The settlement ledger puts proven markouts for flagged swaps on-chain, which no hook records today; full LP outcomes still need an off-chain replay of the unflagged swaps.

## 3.7 Scoring

In the original 36-hour scoring below, Touchstone scored 7.65 out of 10 and ranked first under every weighting tested; the runner-up, bonded execution guarantees, scored 6.70. Two corrections and a two-week re-score follow the table. Each criterion is scored 1–10 and weighted as your brief specified.

| Criterion (weight) | Touchstone | Bonded guarantees | Equity hook | URC kit | PFDA prototype |
| --- | --- | --- | --- | --- | --- |
| Severity of the problem (15%) | 9 | 8 | 6 | 6 | 6 |
| Novelty and defensibility (15%) | 8 | 8 | 6 | 3 | 4 |
| Quantifiable impact (15%) | 7 | 5 | 5 | 4 | 5 |
| Uniswap relevance (15%) | 9 | 9 | 8 | 9 | 10 |
| Feasibility in 36 hours (10%) | 6 | 5 | 7 | 9 | 6 |
| Evidence and validation (10%) | 8 | 5 | 5 | 6 | 5 |
| Security and robustness (10%) | 6 | 6 | 6 | 8 | 6 |
| Adoption after the event (5%) | 6 | 5 | 6 | 7 | 5 |
| Demo clarity (5%) | 8 | 7 | 8 | 5 | 6 |
| **Weighted total** | **7.65** | **6.70** | **6.25** | **6.20** | **6.00** |

#### Why these scores

- **Touchstone.** Severity 9: LP adverse selection is the most-measured loss in the field. Novelty 8, not 10, because ex-post taxation of arbitrage had two known precedents, both needing a bonded arbitrageur; Hindsight later cut it to 5 (below). Feasibility 6: a hook, a settlement contract, a keeper and a replay fill 36 hours.
- **Bonded execution guarantees.** It answers the hook-trust crisis with no precedent found, but its value depends on aggregators choosing to route on bonds, which a demo cannot show.
- **Market-status equity hook.** Timely on Robinhood Chain, but the documented harm falls on traders, LP losses are unmeasured, and issuers are moving to round-the-clock minting.
- **URC-3 and URC-4 kit.** The most feasible and safest build, and the least novel: it implements Labs' own drafts.
- **PFDA prototype.** The most Uniswap-relevant (a named UNIfication mechanism) and the least original; Labs itself estimates its LP benefit at $0.06–$0.26 per $10,000 traded.


The alternative weightings were feasibility-heavy (feasibility 25%, the first four criteria 11.25% each), novelty-heavy (novelty 30%) and impact-heavy (impact and relevance 20% each, adoption 10%, demo 0%). Touchstone's lead is narrowest under feasibility-heavy, 7.31 against the URC kit's 6.73.

Under the base weights, only a combination changes the winner. If per-swap ex-post settlement turns out to have prior art (novelty 8 → 4) and the replay shows little recaptured LVR (impact 7 → 4), Touchstone falls to 6.60, below 6.70. Either finding alone leaves it first there; under novelty-heavy weights the novelty downgrade alone flips it.

One correction from evidence that arrived after scoring: every router reviewed treats return-delta and dynamic-fee hooks as manual work, and 0x cuts off sources whose execution falls short of their quotes. That cuts Touchstone's adoption score from 6 to 5 (total 7.60) and the equity hook's likewise (6.20). Touchstone still ranks first under all four weightings; its narrowest lead becomes 7.26 against the URC kit's 6.73, under feasibility-heavy weights.

A second correction, and a new constraint. Hindsight (§3.2) already settles swaps after the fact, so Touchstone's novelty falls from 8 to 5. What stays new is settlement against a canonical outside price, deposits gated to likely arbitrage, and closed-market settlement. Separately, two developers and two weeks replace the 36-hour limit: feasibility rises for every candidate, and ideas cut only for scope come back. Re-scored on both changes:

| Two weeks, two developers | Base | Feasibility-heavy | Novelty-heavy | Impact-heavy |
| --- | --- | --- | --- | --- |
| Touchstone, both modes (novelty 5) | **7.25** | **7.17** | 6.75 | **7.20** |
| Oracle-update arbitrage auction | 6.95 | 6.69 | 6.60 | 6.90 |
| Bonded execution guarantees | 6.90 | 6.83 | **7.00** | 6.70 |
| Market-status equity hook | 6.40 | 6.81 | 6.35 | 6.30 |
| URC-3 and URC-4 kit | 6.30 | 6.97 | 5.80 | 6.60 |
| Fee discount auction prototype | 6.20 | 6.46 | 5.75 | 6.40 |

Touchstone leads under three of four weightings; under novelty-heavy weights, bonded execution guarantees edge ahead. With novelty at 4 instead of 5, Touchstone still scores 7.10 at base. Of the ideas cut only for scope, hybrid CoW and Flashbots routing (5.35) and cross-chain shared pool state (5.40) still fall well short.

#### A third re-score: v2

v2 is a larger build, so it is scored for six weeks and two developers, against the two-market Touchstone on the same horizon. The runners-up keep their two-week scores from the table above. Six weeks would lift their feasibility too; two points of it add 0.2 at base weights and 0.5 under feasibility-heavy weights.

| Criterion (weight) | Two markets | v2, four markets | Why it moved |
| --- | --- | --- | --- |
| Severity of the problem (15%) | 9 | 9 | Same problem |
| Novelty and defensibility (15%) | 5 | 7 | Settlement-enforced exclusivity and markout-proven rebates had no precedent in my searches; ex-post settlement (Hindsight) and lease auctions (am-AMM) did |
| Quantifiable impact (15%) | 7 | 8 | The licence prices what the clawback leaves behind (the margin, the deposit cap, per-record overhead), and rebates reach problem 4. Not 9, because the licence's gain depends on bidder competition |
| Uniswap relevance (15%) | 9 | 9 | Same |
| Feasibility in six weeks (10%) | 8 | 6 | Three more contracts and a quoting lens fill all six weeks |
| Evidence and validation (10%) | 8 | 8 | E10 to E12 are added, but two of the three are simulations |
| Security and robustness (10%) | 6 | 5 | More surface: a lease state machine, a payout ledger and a quoting lens |
| Adoption after the event (5%) | 5 | 6 | Rebates give routers revenue, and quote integrity answers their main objection |
| Demo clarity (5%) | 8 | 9 | A holder and an outsider racing on testnet show the licence in seconds |
| **Weighted total, base** | **7.35** | **7.60** |  |

| Six weeks, two developers | Base | Feasibility-heavy | Novelty-heavy | Impact-heavy |
| --- | --- | --- | --- | --- |
| Touchstone v2, four markets | **7.60** | 7.26 | **7.35** | **7.50** |
| Touchstone, two markets | 7.35 | **7.43** | 6.85 | 7.30 |

v2 leads under base, novelty-heavy and impact-heavy weights, and stays ahead of every runner-up there even after a six-week uplift; the closest, bonded execution guarantees, would reach about 7.20 under novelty-heavy weights. Under feasibility-heavy weights v2 is not first: the two-market version leads, and the most feasible runners-up may too.

The lead rests on two judgments, novelty 7 and impact 8. If both fall by one point, v2 scores 7.30 at base, just under the two-market version. That risk is cheap to carry, because the licence and the rebates switch off per pool: a module that fails its test costs build time, not LP money.

## 3.8 Why Touchstone v2

Build **Touchstone v2**: a Uniswap v4 hook and settlement system that settles each flagged swap against the fair price a moment after it trades, so arbitrage pays back the value it took. On the same settlement it sells the right to arbitrage in advance, pays for benign flow, and quotes its deposit exactly. Every other trade pays only the base fee.

**One sentence.** Touchstone makes a pool charge arbitrage what it actually took, proven afterwards with a signed price, or sell it that right in advance under the same proof, and refunds everyone else.

**The insight.** Toxicity is unpredictable before a trade and exact a few seconds after it. Almost every fee hook, including Labs' VolatilePair, guesses who is informed before the swap. Hindsight waits about a minute and asks the pool's own TWAP; Touchstone waits seconds and asks a canonical outside price.

#### Why it should exist

- **It needs no prediction.** Passive LPs lose about 1–3 bps of volume in the largest pools, and two pre-registered attempts to predict the culprits per swap failed. Touchstone settles instead.
- **It charges the field's own yardstick.** Uniswap Labs measures LP outcomes with 15-second markouts against an outside price ([paper](https://arxiv.org/html/2609.37963v1)). Touchstone charges that quantity, swap by swap.
- **It can keep the pool fresh.** A fee widens the band in which arbitrage is unprofitable, so the pool quotes staler prices. Touchstone leaves arbitrageurs a margin equal to their cost and takes a share of the rent above it, so they still align the pool; a margin set above cost would invite padded trades (§4.5).
- **It turns the clawback into a market.** The licence sells the right to arbitrage, and settlement keeps the sale exclusive, so LPs collect rent without trusting the holder or controlling ordering.
- **It pays for the flow LPs want.** A flagged trade that settles benign earns a rebate for whoever routed it. That is the producer side of Uniswap's own attested-flow idea, with the markout in place of an attester.
- **It makes LP outcomes checkable.** Each settlement records a proven markout on-chain for the swaps most likely to hurt LPs; a full LP P&L still needs an off-chain replay of the unflagged swaps.

#### Why now

- Pyth Core's update fee went to zero on EVM mainnets in August 2026, and `parsePriceFeedUpdatesUnique` makes the post-trade price canonical rather than chosen ([Pyth](https://docs.pyth.network/price-feeds/current-fees)).
- Uniswap Labs' September 2026 paper made the 15-second markout the yardstick, and showed markouts are flat out to an hour.
- VolatilePair went live on 14 Oct 2026 with no LP-return evidence; the ecosystem now has competing fee hooks and no way to verify any of them.
- v4 protocol fees went live on 27 Jul 2026, and a forum participant (Panoptic's founder) argued LPs should be compensated first.
- Uniswap's URC-2 and URC-4 drafts (June 2026) give hooks a standard way to report their fills and to quote routers, and v2 implements both; arbitrage on first-come-first-served chains still has no way to pay LPs, which is the gap the licence fills.

#### Why Uniswap

Only v4 lets a third party attach a refundable deposit to any swap in a pool (`afterSwap` return deltas), hold it as ERC-6909 claims inside the PoolManager without touching principal, and pay LPs through `donate`, permissionlessly. Labs could also add it to VolatilePair through that hook's upgrade path, with VolatilePair's signal as the trigger; as a separate hook it competes for the same flow.

#### Why it beats the runners-up

| Alternative | Why Touchstone wins |
| --- | --- |
| Bonded execution guarantees | Same settlement primitive with the sign flipped: a negative markout beyond a hook's declared fee is trader harm. Touchstone ships the LP side first, where a measurable demo exists; v2 adds the router-facing half, an in-transaction quote check, and leaves the bond out, because Touchstone never changes execution |
| Market-status equity hook | Largely covered by Touchstone's closed-market mode (§4.8), which settles stock-token swaps at the reopen and handles market status and corporate actions |
| URC-3 and URC-4 kit | Plumbing. Touchstone implements URC-2 `HookSwap` events and a URC-4 indicative quote as part of the build |
| Fee discount auction prototype | Moves MEV to UNI burns, worth $0.06–$0.26 per $10,000 to LPs by Labs' estimate, and sits on Labs' own roadmap. Touchstone moves LVR straight to LPs |
| Oracle-update arbitrage auction | v2's licence sells the same right as one continuous lease, with no auction per update, and settlement rather than ordering enforces it |

**Positioning for judges.** Touchstone is a settlement layer for fee hooks, not another fee hook: one primitive, four markets. Its most likely home at ETHGlobal Mumbai is the Continuity variant of the Uniswap Foundation's Stack Contribution track, since weeks of prior work rule out Classic, with the licence built at the event.

## 3.9 Adoption strategy

Nothing here assumes the Uniswap Foundation or Uniswap Labs will endorse, fund or integrate Touchstone. Each step is one the project can take alone, and each depends on evidence from the step before.

#### Where it fits first

The clearest fit is where MEV taxes cannot work: chains without priority ordering.

- **Arbitrum** orders first come, first served, plus the Timeboost express lane.
- **Robinhood Chain** is an Arbitrum Orbit chain. Orbit chains order first come, first served unless they enable Timeboost (Arbitrum docs), and a secondary source describes its sequencer as private FCFS. It carries about 36% of v4 volume and 63% of v4 fees (DefiLlama, 30-day, my calculation).
- **Ethereum L1** is ordered by builders.

Touchstone's settlement does not depend on ordering; only its recall does, and E2 measures recall chain by chain. The licence does not depend on ordering either, which makes first-come-first-served chains its natural market.

Two caveats narrow the fit. Nearly half of Uniswap's stock-token volume trades while US exchanges are fully closed (Kaiko, via PANews). Closed-market mode can take deposits then, but it locks benign traders' money until the reopen and charges them a noise tax, so crypto pairs come first on Robinhood Chain, and stock pools follow only if E9 passes. And on Unichain and Base, where priority ordering lets an MEV tax work, Angstrom L2 is already registered on Base; there Touchstone must win on measured LP returns or stay out.

#### Phases

| Phase | Goal | Gate to the next phase |
| --- | --- | --- |
| 1. Evidence (Nov–Dec 2026) | Pre-registered E1–E7 on Ethereum, Base and Arbitrum; code and data published | E2 passes on at least one chain |
| 2. Audit and guarded launch | External audit; one immutable mainnet pool on a chain that passed, with a deposit cap, team liquidity, a running keeper and the licence switched off | Invariants hold live, and settlement records match E3's predictions for flagged swaps |
| 3. Routing | Uniswap allowlist application, a KyberSwap adapter, 0x review, a UniswapX filler, and rebates switched on for router partners | At least one major router quotes the pool without slippage reverts |
| 4. LP capital | LP managers and vaults, who choose pools on measured returns | Outside LP capital exceeds team capital |
| 5. Standard | A URC proposal for refundable deferred settlement and markout reporting | A second team adopts the interface |
| 6. Licence | Switch the licence on for one pool once E10 passes and two independent arbitrage firms commit to bid | Over a month, rent plus outsider clawback beats what the pool's plain clawback earned |

Dates after phase 1 depend on its result and are not commitments.

#### What routers need

Every router reviewed puts return-delta hooks in a manual bucket, and 0x cuts off sources whose execution falls short of their quotes.

- A `previewDeposit` view and a URC-4 indicative quote that both include the deposit.
- `GuardedRouter` for single-pool routes, so a router can cap the deposit inside the transaction.
- An immutable contract, verified source and optional `hookData`. Uniswap's allowlist rejects upgradeable proxies and hooks that need custom calldata.
- A share of retained value equal to the pool's protocol-fee share, paid to the fee recipient. Donations skip the v4 protocol fee, and the allowlist rejects hooks that "modify or bypass" it; that reading of the rule is mine.
- Rebates: revenue for routers whose flagged flow settles benign, credited to the address they name.
- A Go adapter contributed to KyberSwap's open-source library, which rejects unknown hooks with swap permissions.
- A UniswapX filler. Uniswap's documentation says any hooked pool can reach interface flow through a filler that fills against it.
- The UF × Brevis rebate (up to 85% of router gas on hooked pools) lowers routers' cost but not their trust problem, so it helps only after the points above.

#### Who has to be convinced, and by what

- **Passive LPs and LP managers:** LP net in bps against a static pool. Every settled swap leaves a public markout record; with an open replay of the unflagged swaps, anyone can reproduce LP net from chain data.
- **Uniswap Labs and the Foundation:** that Touchstone's settlement could be added to VolatilePair through its upgrade path, and that it raises LP net without raising retail fees or staleness. Adoption is their call.
- **Routers and wallets:** quotes that match execution, refunds that reach smart-account users, and rebates on the benign flow they bring.
- **Arbitrage firms:** that the licence buys a real edge on first-come-first-served chains, worth its rent. At least two must bid for the licence to pay LPs.
- **Researchers:** the markout data itself. No standard for execution-quality reporting exists; URC-2, 3 and 4 cover events, liquidity and quotes, not markouts.

Grants from the Uniswap Foundation or oracle providers are worth applying for once phase 1 has results, with no assumption that they come.

## 3.10 Failure conditions

Any one of these findings ends or redirects the project. Most can be tested before mainnet code exists, and the first can be tested in days with Assay's pipeline.

| # | Finding | How it would show | Consequence |
| --- | --- | --- | --- |
| 1 | No cheap trigger catches toxic markout | E2: held-out recall below the pool's break-even r\* at a flag share of 30% or less, on every chain tested | **Kill.** The settlement is sound but has nothing to settle |
| 2 | Evasion is cheap | E5: recall under splitting, block-spreading, exact-output or padding falls below r\* | Kill, unless a new trigger fixes it without raising the flag share |
| 3 | The oracle disagrees with the market at settlement horizons | E4: median Pyth–Binance gap above ε/2 at Δ = 2–12 s | Kill for that pair; widening ε erases the recapture |
| 4 | Clawback distorts arbitrage | E6: at every feasible ε, pools stay staler than static pools or padded trades overshoot fair value | **Kill.** Stale or overshooting pools cost LPs and traders more than LVR does |
| 5 | Labs' hook already does as well | E7: the VolatilePair baseline matches Touchstone's LP net at the same retail fee | Redirect: offer settlement as an add-on to VolatilePair-style pools, not a rival hook |
| 6 | Routers will not quote it | No major router routes a pilot pool within three months of an allowlist application and an adapter submission | Redirect to UniswapX-filler flow; kill if that flow is too small to matter |
| 7 | Benign users lose money in practice | Misdirected refunds or slippage reverts on more than 1% of flagged swaps | Fix before scaling; kill if the fix needs mandatory `hookData`, which Uniswap's allowlist rejects |
| 8 | The accounting cannot be made safe | Fuzzing finds refunds plus retentions above deposits, or a reverting `beforeSwap`, that only an admin key could patch | Kill. An upgradeable Touchstone is unroutable and untrustworthy |
| 9 | Pyth Core changes terms | Update fees return, Hermes access closes, or historical updates vanish | Move to another signed source with timestamped history (Chainlink rounds, Data Streams) at a longer settlement delay; kill if none is affordable |
| 10 | Prior art surfaced | It did: Hindsight (UHI10) already settles every swap after the fact, against the pool's own TWAP | Novelty cut from 8 to 5; the licence and the rebates bring it back to 7 (§3.7). Touchstone ranks first only by building what Hindsight lacks |
| 11 | The outside price adds nothing | E7: Hindsight-style own-TWAP settlement matches Touchstone's LP net at the same retail cost | Kill Touchstone's central claim; offer the closed-market mode and the routing work to existing designs instead |
| 12 | Weekend flow is noise | E9: closure-time markouts against the reopen show no information, or the noise tax exceeds what the clawback recovers | Drop closed-market mode, which would then only lock up benign deposits |
| 13 | The licence does not pay | E10: two bidders fail to beat the plain clawback by 10%, or one bidder at the reserve does worse than it | Keep the licence off; the clawback stands alone |
| 14 | Nobody bids | No independent arbitrage firm bids on a pilot licence pool within three months | As row 13 |
| 15 | Rebates can be farmed | E11: any wash strategy profits at the pool's κ | Rebates off on that pool |
| 16 | Quotes and execution disagree | E12: any mismatch between previewDeposit and the executed deposit, or between the URC-4 quote and V4Quoter | Block release until fixed; a gap that persists means routers cannot trust the hook |

What does **not** kill it: modest trigger precision (false positives pay no extra fee, though they carry side costs), a licence or rebate program that fails its test (each switches off per pool and the clawback stands alone), a modest hackathon result, or the absence of a Uniswap Foundation endorsement.

## 3.11 Method and its limits

Eight research agents ran in parallel on 17 October 2026 — eight, not a thousand. I did the scoring, elimination and red-teaming myself, because those steps depend on Assay and VANE context the agents never had.

| Track | What it covered | Status |
| --- | --- | --- |
| Uniswap state of play | Labs and Foundation shipments, fee switch, v4 adoption, Unichain | Complete; some searches cut short, gaps logged |
| LVR mechanisms and prior art | Deployed and academic mechanisms; seven explicit prior-art checks | Complete; some searches cut short, gaps logged |
| Empirical evidence | Measured LP losses, toxic-flow share, replay data sources | Complete; some searches cut short, gaps logged |
| MEV, routing and ordering | Sandwiches, intents, router handling of hooks, L2 ordering | Complete; some searches cut short, gaps logged |
| Security and oracles | Hook exploits, audit classes, oracle latency, cost and update model | Complete; some searches cut short, gaps logged |
| ETHGlobal track | Mumbai event, Uniswap tracks 2025–26, rules on prior code and AI | Complete; two past events skipped, gaps logged |
| Specialised markets | Tokenized equities, LSTs, stables, launch pools | Complete |
| Assay and VANE grounding | Both repos cloned at HEAD, the AUC experiment, a hook-overlap scan | Complete; some searches cut short, gaps logged |

The "council" is a set of structured passes over that evidence from twelve mandated perspectives: protocol, mechanism design, quant, security, MEV, LP economics, cross-chain, data, governance, adversarial review, product, and hackathon engineering. Every idea that survived elimination was attacked with a concrete counterexample before it was scored.

Evidence labels follow the research notes: verified (primary source), reported (secondary source), unconfirmed. "My calc" marks arithmetic on cited figures.

Limits worth knowing. Search or tool budgets ran out in seven of the eight tracks; each logged what it could not check. The Atrium hooks directory and GitHub search were unreachable, which is how the prior-art track missed Hindsight (§3.2); a later direct web search found it. Testnet RPCs were blocked, so no deployed state was read, and no test suite or simulator was run.

**The v2 revision, 18 October.** No new agents ran. I read the am-AMM paper's abstract and Bunni's BidDog source for the lease mechanics, the URC-2 and URC-4 drafts on the Uniswap forum for their exact event and interface text, and the documentation of Hermes's timestamp endpoint. Every new number in §3.7 and §4 was re-derived with a script, and on 25 October the numbers this spec quotes were re-derived again by `research/reference/check_report_numbers.py` (Appendix A).

---

# §4 Mechanism and mathematics

Everything in this section is fixed. The Solidity in Appendix A implements §4.2–§4.4, §4.9 regimes, §4.10 rebates and §4.12 rounding; `research/reference/touchstone_ref.py` implements all of it exactly, and every number quoted here is reproduced by `check_report_numbers.py` (§4.14).

## 4.1 Notation

- Swap i trades at block timestamp tᵢ, with direction sᵢ = +1 when it buys the risky asset and −1 when it sells.
- qᵢ is the risky quantity, Nᵢ the notional in the quote token, Pᵢ the execution price including the LP fee.
- P\*(t) is the fair price: the earliest Pyth update published at or after t.
- f is the base LP fee, Δ the settlement horizon, ε the arbitrage margin, α the LPs' share and δ the deposit rate.
- N₀ is the retail floor, N\_min the flow-bucket threshold, h its drain horizon, τ the drift threshold, g the signed pre-swap gap to the reference, β the gap multiplier and δ\_max the deposit cap.
- G is the licence band, α\_lic the outsiders' share inside it, K the lease's activation delay, ρ the rebate pool's share of retained value, and κ the rebate as a share of the LP fee.

## 4.2 Markout

```latex
m_i = s_i \, q_i \, \big( P^{*}(t_i + \Delta) - P_i \big)
```

A positive mᵢ means the trader beat the fair price after paying the fee, and the LPs lost exactly mᵢ. This is the 15-second markout from Uniswap Labs' paper, with Δ shortened to a few seconds (3 s by default; E4 chooses it) and a signed oracle in place of Binance.

In contract terms the trader's signed receipts x_r (risky) and x_q (quote) come straight from the AMM part of the swap's `BalanceDelta`, so the markout needs no direction or price argument:

```latex
m = x_r \cdot P^{*} + x_q
```

`SettlementMath.markout` computes this with `FullMath.mulDiv` and rounds toward negative infinity, which can only lower R.


## 4.3 Trigger and deposit

A swap is flagged when any of four rules fires. **First touch:** it is the first swap at or above a floor N₀ in its block. A per-pool slot records that block, swaps below N₀ never use up the status, and a transient flag marks the rest of the transaction; transient storage alone resets every transaction, so it cannot see block boundaries. On Arbitrum chains the block number comes from `ArbSys`, because `block.number` there is the parent chain's. **Flow:** a leaky bucket for the swap's direction holds at least N\_min. Every swap feeds it, including those below N₀, and it drains at N\_min/h per second, so arbitrage split across swaps or blocks still fills it. **Drift:** the swap trades toward a cached Chainlink reference by at least τ (Assay's signed drift). **Closed market:** the reference market is closed now, or will be by the time the swap settles. A flagged swap posts

```latex
D_i = N_i \cdot \min\big(\delta_{max},\ \max(\delta,\ \beta\, g_i^{+})\big)
```

taken from the unspecified token in `afterSwap` and held as ERC-6909 claims in the PoolManager. Scaling by the pre-swap gap g keeps the cap from binding on large dislocations; closure records use a flat rate δ\_c.

The four triggers in contract form:

| Trigger | Rule | Applies to | Notes |
| --- | --- | --- | --- |
| First touch | First swap at or above N₀ in the block, by `BlockLib`'s block number | N ≥ N₀ | Every later swap in that transaction also counts (transient flag). A swap below N₀ never uses up the status. On sub-second chains nearly every swap above N₀ is a first touch |
| Flow | The bucket for the swap's direction, after adding N, holds at least N_min | Every swap | Drains at N_min / h per second, so splitting across swaps or blocks still fills it |
| Drift | g = s·(P_ref − p_pre)/P_ref ≥ τ | N ≥ N₀, continuous mode | P_ref is the Chainlink answer, ignored when older than `referenceMaxAge` |
| Closed market | Calendar closed at t, or at t + Δ + maxLag | N ≥ N₀ on calendar pools | Deposit at δ_c (§4.8) |

When the deposit currency (the unspecified currency) is the risky token, the hook converts at the swap's own execution price, D = D_quote · |x_r| / |x_q|, so no oracle is read at swap time (`DepositLib.toRisky`).


## 4.4 Settlement

```latex
R_i = \min\!\Big( D_i,\; \alpha_k \cdot \max\big(0,\; m_i^{+} - \varepsilon_{eff}\, N_i^{+} \big) \Big), \qquad \mathrm{refund}_i = D_i - R_i
```

Here α\_k is the regime's share: α normally, α\_lic for an outsider inside the licence band, 0 on the holder's slow path, and α\_c for closure records. ε\_eff adds Pyth's confidence to ε, and m⁺ and N⁺ count only the part of the swap executed before the price crossed P\* (§4.5). Out of Rᵢ, a capped tip pays whoever settled, ρ goes to the rebate pool, and the rest vests to in-range LPs through `donate` over about 30 minutes. The refund goes to the beneficiary. The effective fee is f + Rᵢ / Nᵢ, so a benign swap (mᵢ ≤ εNᵢ) pays exactly f.

The regime α_k is chosen by this table (`SettlementMath.alphaBps`):

| Mode | Licence live at swap time | Band test \|p_pre − P*\| ≤ G·P* | byHolder | α used |
| --- | --- | --- | --- | --- |
| Closure | Any | Not used | Not used | α_c |
| Continuous | No | Not used | Not used | α |
| Continuous | Yes | Inside | Yes | 0 (full refund) |
| Continuous | Yes | Inside | No | α_lic |
| Continuous | Yes | Outside | Either | α |

**In-the-money accounting** (`ITM_ACCOUNTING` flag, on by default). When the post-swap price overshoots P*, only the part of the swap executed before the price crossed P* counts. That part runs from `sqrtPriceBeforeX96` to √P* at `liquidityBefore` and is computed with `SqrtPriceMath`, the input grossed up by the LP fee (`ItmLib.leg`). It gives m⁺ and N⁺; otherwise m⁺ = m and N⁺ = N. A swap that crossed initialized ticks makes the constant-liquidity leg an approximation, which differential tests compare with an exact tick-by-tick replay.

**Splitting R** (`SettlementMath.splitRetained`): tip = min(tipCap, tipBps·R) to the caller; of the remainder, protocolShareBps to the pool's protocol recipient; ρ of what is left to the rebate pool; the rest to LPs through vesting.

**Benign records** (`SettlementMath.benign`): a record settled with R = 0 and m ≤ 0 earns gross = min(κ·f·N, rebate pool); its tip comes out of gross.

**Guards.** Refund in full if c* > `maxConfBps`. For closure records, refund in full if |P*/p_exec − 1| > J (jump guard). After t₀ + W (or W_c) anyone may `expire` the record: full refund, no tip, no rebate.


## 4.5 When the pool stays fresh

Let c be an arbitrageur's marginal cost per unit of notional: exchange fee, gas and hedge risk. Without Touchstone an arbitrage happens when m > cN. With Touchstone, and the deposit not binding, the arbitrageur keeps

```latex
\pi(m) = m - \alpha \max(0,\, m - \varepsilon N) = \begin{cases} m & m \le \varepsilon N \\ \varepsilon N + (1-\alpha)(m - \varepsilon N) & m > \varepsilon N \end{cases}
```

Two things follow. Entry: if ε ≥ c and α < 1, then π(m) > cN exactly when m > cN, so the same arbitrages happen as in a plain pool at fee f. Size: the last unit traded is worth (1 − α)·m′ + αε to the arbitrageur against its cost c, so it stops where m′ = (c − αε)/(1 − α), and only ε = c reproduces the plain pool's stopping point. With ε above c, an arbitrageur can pad the swap, trading past the fair price until its average markout falls to ε, and pay no clawback at all: in a linear-impact model, c = 1 bp, ε = 2 bps and a 5 bp gap give R = 0 and a 1 bp overshoot. With ε below c it stops short, and the pool stays stale. So ε is set at the marginal arbitrageur's measured cost, not above it. Oracle noise matters too: with 1–2 bps of noise in P\*, the effective entry threshold rises from 2 bps to roughly 2.7–3.3 bps (a Monte Carlo with α = 0.8 and ε = c = 2 bps). A refinement removes the padding incentive: compute the clawback only on the part of the swap executed before the pool price crossed P\*(t + Δ), so units traded past the fair price cannot dilute the markout. E5 and E6 test both versions.

Competition among arbitrageurs bids away whatever they keep, and today much of it reaches block builders: Wintermute and SCP pass most of their revenue to integrated builders ([Wu et al., AFT 2025](https://drops.dagstuhl.de/storage/00lipics/lipics-vol354-aft2025/html/LIPIcs.AFT.2025.26/LIPIcs.AFT.2025.26.html)). Under Touchstone, while the deposit does not bind, at most εN + (1 − α)(m − εN) per swap is left to bid; the rest stays with LPs.

## 4.6 What LPs recapture, and the break-even recall

Over a period with LVR L and fee income F (both in bps of volume V), arbitrage share s of notional, and trigger recall r (the share of toxic markout, net of fee and ε, that falls on flagged swaps). Markouts are net of the LP fee, so the arbitrage flow's own fees, F·s, come off first:

```latex
\text{Recaptured} \approx \alpha \, r \, \big( L - (F + \varepsilon)\, s \big) \, V
```

An illustration, not a result. Kovalenko's Ethereum pools show L ≈ 8.5 bps against fees of 6.3 bps, net −2.2 bps (my calc). With α = 0.8, ε = 2 bps and s = 0.29, Touchstone recaptures about 4.9 × r bps, so **the pool breaks even at a trigger recall of about 0.45 (0.42 if arbitrage pays the pool's own 5 bp fee rather than the 6.3 bp average)**. Recall is the number the replay must measure.

**With a licence.** LPs collect rent in place of the holder's clawback. With two or more bidders, rent approaches the inside-band arbitrage the winner expects, net of its costs: the share the clawback would have taken, plus what the clawback misses (the margin εN, value beyond the deposit cap, and per-record gas and tips). Outsiders who beat the holder still pay α\_lic of their excess, and jumps beyond the band go back to the clawback. With one bidder, rent falls to the reserve, which can be less than the clawback would have paid. E10 measures both cases, and a pool keeps the licence off unless the one-bidder case does no worse.

The kill gate E2 uses this break-even (§16.4):

```latex
r^{*} = \frac{L - F}{\alpha \, \big(L - (f_{arb} + \varepsilon)\, s\big)}
```

At L = 8.5 bps, F = f_arb = 6.3 bps, α = 0.8, ε = 2 bps, s = 0.29: r* = 0.451. With f_arb = 5 bps: r* = 0.425.


## 4.7 Worked example

Parameters: f = 5 bps, Δ = 3 s, ε = 2 bps, α = 0.8, δ = 30 bps, and α\_lic = 0.95 for the licence rows.

| Swap | Notional | Markout m | Deposit | Retained by LPs | Refund | Effective fee |
| --- | --- | --- | --- | --- | --- | --- |
| Arbitrage buying after a CEX move | $500,000 | +$500 (10 bps) | $1,500 | $320 | $1,180 | 11.4 bps |
| Large benign swap, lucky +1 bp | $200,000 | +$20 | $600 | $0 | $600 | 5 bps |
| Retail swap flagged as first in block | $20,000 | −$3 | $60 | $0 | $60 | 5 bps |
| Outsider arbitrage while a licence is live, inside the band | $500,000 | +$500 (10 bps) | $1,500 | $380 | $1,120 | 12.6 bps |
| The holder's own arbitrage, first touch, inside the band | $500,000 | +$500 (10 bps) | None | None; paid through rent | — | 5 bps |

Markouts are net of the LP fee. On the arbitrage, LPs collect $250 in fees but lose $750 to the price move, a net −$500 without Touchstone; with it they also keep $320, for −$180. The arbitrageur keeps $180 before costs, of which $100 is the posted margin. With a licence live, an outsider who wins the same trade inside the band leaves $380 with LPs and keeps $120. The holder posts nothing on its own first swap and pays through rent instead.

## 4.8 Closed-market mode and the noise tax

Tokenized stocks lose their reference price when their market closes. Between Friday 8pm and Sunday 8pm ET no oracle publishes a regulated single-name price, and the overnight session (Sunday to Thursday, 8pm to 4am ET) is the first to return. Continuous settlement has no usable price then. Closed-market mode handles those swaps:

- A swap made while the regular session is closed, or so close to the close that its settlement price would fall after it, posts a deposit at a closure rate δ\_c, set above δ because closure gaps are larger.
- Settlement uses the same `parsePriceFeedUpdatesUnique` call, with minPublishTime at the next regular open plus a short delay. The overnight session could settle sooner on thinner prices; v2.0 leaves that as an option for E9 to test.
- Closure records get their own α\_c and ε\_c. The clawback is one-sided, and over a weekend an uninformed trader's markout is mostly noise. With 1.5% of weekend noise, α\_c = 0.5 and ε\_c = 50 bps cost a benign trader about 18 bps of notional in expectation, against about 45 bps at the continuous settings (my calculation, normal approximation). Over three seconds the same tax is effectively zero.
- Expiry counts from the reopen, not from the swap, so an unscheduled closure or a halt at the open ends in a full refund a day later. A move of more than 25% between the trade and the reopen price also refunds in full, as a corporate action or a data error. v2.0 supports only tokens with a fixed share ratio.

Evidence for: weekend token moves anticipate the Monday open (Cong et al.), and in 20 of 25 large gaps the weekend move matched the opening gap (Kaiko, reported). Evidence against: Bitquery found no repeatable weekend effect on Robinhood Chain in July, and by 6pm Sunday tokens had covered only a tenth of the distance to the open. The costs are the lock-up, up to about three days over a long weekend, and the noise tax above. E9 measures both, and drops the mode if the tax exceeds what the clawback recovers from informed trades.

### The noise tax

The clawback is one-sided: it keeps part of a positive markout and pays nothing back when the markout is negative. Over three seconds this hardly matters, because the fee is larger than the price noise. Over a weekend it matters a great deal. An uninformed trader's markout is then mostly noise, and the clawback keeps part of the upside.

For a benign trader whose markout has noise σ\_c over the closure, the expected clawback is approximately

```latex
\mathbb{E}[R] \approx \alpha_c N \sigma_c \big[\varphi(z) - z\,(1 - \Phi(z))\big], \qquad z = \frac{f + \varepsilon_c}{\sigma_c}
```

where φ and Φ are the standard normal density and distribution. My calculation, under that normal approximation:

| Case | z | Expected clawback on a benign trade |
| --- | --- | --- |
| Weekend, σ\_c = 1.5%, f = 5 bps, ε\_c = 50 bps, α\_c = 0.5 | 0.37 | about 18 bps of notional |
| Weekend, continuous values (ε = 2 bps, α = 0.8) | 0.05 | about 45 bps |
| Continuous, Δ = 3 s at 3% daily volatility (noise about 1.8 bps) | 4.0 | effectively zero |
| Continuous, Δ = 3 s at 5.2% daily volatility | 2.3 | about 0.01 bps |

That is why closure records get their own α\_c and ε\_c, set lower and wider than the continuous values. The tax works like the wider spread a market maker quotes overnight. E9 measures both the information in closure-time markouts and the tax on benign closure trades. If the tax exceeds what the clawback recovers from informed trades, closed-market mode is dropped (§16.4).

## 4.9 The arbitrage licence

The clawback leaves value behind: the margin εN that arbitrageurs keep, markout beyond the deposit cap, and the gas and tips of every flagged record. It also needs ε set at arbitrageurs' cost, which LPs can only estimate. The licence prices that value directly, by auction.

**Mechanism.** A continuous lease, adapted from the am-AMM of Adams, Moallemi, Reynolds and Robinson. A bid names a rent per second and a deposit covering at least K seconds of it. A higher bid, by at least 10%, replaces any pending one and takes over K seconds after it was placed. Rent flows from the holder's deposit to LPs by the second, and the lease lapses when the deposit runs out. Touchstone reimplements the lease, because Bunni's BidDog implementation is AGPL-3.0, and differs from it in three ways: time in seconds, rent in the quote token donated to LPs, and no fee-setting payload. LPs keep every swap fee.

**What the holder buys.** Its first swap at or above N₀ in each block posts no deposit, while the pool sits within G of the reference. Every other swap, the holder's second in a block included, is flagged as usual, and settlement picks the share:

```latex
\alpha_k = \begin{cases} 0 & \text{the holder's first touch, with } |p_{pre} - P^{*}| \le G\,P^{*} \\ \alpha_{lic} & \text{anyone else, inside the band} \\ \alpha & \text{outside the band, or no licence live} \end{cases}
```

**Why exclusivity holds without ordering.** An outsider can still trade first. Inside the band it keeps only εN plus 1 − α\_lic of its excess, 5% at the default, so its win mostly pays LPs. The holder's advantage is not priority but the right to keep its markout. That is why the licence works on first-come-first-served chains, where an MEV tax has nothing to tax.

**Why only the first touch.** A sandwich needs a back-run after the victim in the same block, and a back-run is never the block's first touch, so it is never exempt. A colluding pair fails too, because a front-run at or above N₀ takes the first touch. Legs below N₀ post no deposit for anyone, so the holder gains nothing there that others lack.

**Why the band.** It is a freshness backstop: an idle holder can let the pool drift by about G before outsiders are paid at α to realign it. It is also a tail guard: jumps beyond G go back to the clawback for everyone, the holder included, so a lone bidder cannot buy the largest arbitrages at the reserve.

**When LPs come out ahead.** With competition, rent approaches the holder's expected inside-band profit, which exceeds what the clawback collects from the same trades by the margin, the cap and the overhead. With one bidder, rent falls to the reserve. E10 simulates both, with arbitrageurs racing on latency as on a first-come-first-served chain. The licence stays off until two bidders beat the plain clawback by 10% and one bidder does no worse.

## 4.10 Benign-flow rebates

A flagged swap that settles with R = 0 and m ≤ 0, so the trader lost to the pool after the fee, earns

```latex
\text{rebate}_i = \min\big(\kappa\, f\, N_i,\ \text{rebate pool}\big)
```

paid to the address the swap names in its `hookData`, usually the router or wallet that built it, or else to the trader. The rebate pool receives ρ of everything LPs retain, clawback and rent alike, so rebates never touch principal. A keeper's tip on a benign record comes out of its rebate, which makes benign records worth settling.

**Why wash trading loses.** A wash leg pays the full fee and gets back at most κ of it, so it loses (1 − κ)·f·N plus impact and gas. The one exception is an LP washing against its own liquidity. Owning a share φ of in-range liquidity, it profits when φ > 1 − κ, 60% at κ = 0.4, and the most it can take is the rebate pool, which costs the other LPs at most their share of ρ of retained value. Pools where one address holds that much get a lower κ.

**What it is, and what it is not.** Uniswap's ALF design gives better prices to flow that a frontend attests, and lists producing those attestations as open work. Rebates are a version with no attester: the markout proves after the fact that the flow was benign. A backtest can price them and bound the gaming (E11), but it cannot show whether they attract flow.

## 4.11 Quote integrity

A deposit depends on block state, so a router's quote can differ from its execution, and routers treat the gap as slippage. v2 closes the gap four ways.

- **`previewDeposit`** returns the deposit a swap would post now, and the deposit if flagged, which ignores trigger state for routers that cannot choose their block.
- **URC-4's `IALFHook`**, implemented through a lens contract, returns indicative quotes net of the deposit from a view-only port of v4's swap loop, tested against `V4Quoter` (E12).
- **URC-2's `HookSwap`** event fires on every swap that posts a deposit, so indexers can add it to the core `Swap` event.
- **`GuardedRouter`** swaps, reads the deposit actually taken from transient storage, and enforces the trader's deposit cap and net and gross output limits inside the transaction.

The swap path and every quote share one internal function, so within a block a quote and an execution cannot disagree. Uniswap's routing allowlist also asks for an immutable, verified contract that needs no custom calldata, which v2 meets, because its `hookData` is optional.

## 4.12 Units and rounding

- **Prices are quote base units per risky base unit, scaled by 1e36** (`PRICE_SCALE`). The developer docs said 1e18; that loses precision for low-priced tokens (an 18-decimal token worth $0.0001 against 6-decimal USDC has a base-unit ratio of 1e-16, which 1e18 holds to two significant digits). Across the whole v4 price range a 1e36-scaled price stays below 2^248. Decision D-1 in §21.
- Pyth conversion: P* = p_base · 10^(e_base − e_quote + dec_quote − dec_risky + 36) / p_quote, rounded down (`PriceLib.fairPriceX36`).
- Confidence c* = conf_base/p_base + conf_quote/p_quote in bps, **rounded up** (`PriceLib.confBpsUp`): a wider deadband can only lower R.
- Markout math runs in signed quote units through `FullMath.mulDiv`, rounding toward negative infinity.
- R, tips and rebates round down; refund = D − R, so refund + R = D exactly.
- When D is held in the risky token, R converts at P* and rounds down.
- The hook re-checks in `finalize` that refund + tip + toProtocol + toRebatePool + toLPs = D (non-benign) or that refund = D and tip + rebate ≤ rebate pool (benign), and reverts with `Touchstone__PayoutMismatch` otherwise (`SettlementMath.conserves`).


## 4.13 Limitations

1. Unflagged arbitrage escapes. A decoy above N₀ placed first, or split flow slower than the bucket drains, evades the trigger, so recall must be measured, not assumed.
2. P\* is Pyth's price, not the true price. At Δ of a few seconds, latency and confidence add an estimated 1–2 bps of noise for ETH, which ε absorbs.
3. Vesting spreads donations over about 30 minutes, which limits JIT capture but does not end it.
4. A falsely flagged retail swap with tight slippage can revert, because the deposit lowers its output at execution. `GuardedRouter`'s gross limit fixes this only for routers that adopt it.
5. Smart accounts need a trusted router or a beneficiary in `hookData`, or refunds reach the relayer.
6. Touchstone moves rent from arbitrageurs and builders to LPs. It does not make the pool's price fresher than a plain pool's.
7. The licence's gain depends on competition. A lone bidder pays only the reserve, and the Chainlink-based fast path can exempt a swap that P\* would place outside the band.
8. Rebates can be priced in a backtest, not proven: whether they attract flow needs a live pool and a router partner.

## 4.14 Numbers reproduced on 25 October 2026

`python3 -I research/reference/check_report_numbers.py out/` recomputes every figure above from the exact reference and asserts the worked example. Output, abridged:

| Quantity | Value |
| --- | --- |
| Worked example: retained / refund / effective fee, arbitrage row | $320 / $1,180 / 11.4 bps |
| Worked example: outsider inside the licence band | $380 / $1,120 / 12.6 bps |
| Worked example: lucky benign and flagged retail rows | $0 retained, 5 bps |
| Split of the arbitrage row (tipBps 2%, tipCap $5, ρ 10%) | tip $5, rebate pool $31.50, LPs $283.50 |
| Rebate on the $200,000 benign row (κ 40%, f 5 bps) | gross $40, tip $0.80, net $39.20 |
| Recapture coefficient α(L − (F + ε)s) | 4.87 bps × r |
| Break-even recall r*, f_arb = 6.3 / 5.0 bps | 0.451 / 0.425 |
| Noise tax, weekend σ = 1.5%, closure settings / continuous settings | 18.2 / 45.1 bps |
| Noise tax, Δ = 3 s at 3% / 5.2% daily volatility | about 1e-5 bps (z = 3.96) / 0.009 bps (z = 2.28) |
| Wash leg loss at κ = 0.4, f = 5 bps | 3.0 bps of notional per leg; LP self-wash pays above 60% in-range share |

---

# §5 Architecture

Seven contracts and a market calendar, three off-chain services, and two outside price sources. Money moves in only four places, `finalize`, `creditRent`, `drip` and the ledger's claims, and each checks conservation before it pays.


## 5.1 The life of a flagged swap

1. **Swap.** A trader or router swaps through the PoolManager. In `beforeSwap` the hook snapshots the price and liquidity. In `afterSwap` it checks the licence and the triggers, takes the deposit as ERC-6909 claims, commits the record's hash, and emits `DepositTaken` and URC-2 `HookSwap`.
2. **Wait.** Δ seconds in continuous mode, or until the reopen for a closure record.
3. **Settle.** A keeper fetches the first Pyth update at or after t₀ from Hermes and calls `Settler.settle`. The Settler checks the record against its hash, lets Pyth enforce that the update is the first one, computes the markout, picks the regime and builds the split.
4. **Pay.** `finalize` burns the record's claims. The refund goes to the beneficiary, or to the ledger if the push fails; the tip goes to the caller; a rebate is credited in the ledger; and the LPs' share joins the vesting buffer, which `drip` donates to in-range LPs over 30 minutes.
5. **Licence, alongside.** Bidders lease the exemption. `accrue` sends rent to the hook, and `afterSwap` asks `holderOf` whether a swap is the holder's first in its block.

## 5.2 Contracts

| Contract | Role | Holds funds | Called by |
| --- | --- | --- | --- |
| `TouchstoneHook` | Swap callbacks, triggers, records, vesting, payouts | Claims for open records, vesting and the rebate pool | PoolManager; Settler (`finalize`); auction (`creditRent`); anyone (`drip`) |
| `Settler` | Pyth verification, markout, regime and split | No; it forwards the Pyth fee | Anyone |
| `LicenceAuction` | The lease state machine | Bidders' deposits, in the quote token | Bidders; anyone (`accrue`); the hook (`holderOf`) |
| `RebateLedger` | Rebates and deferred refunds | Claims it owes | The hook (`credit`); recipients (`claim`) |
| `TouchstoneFactory` | Validates configs and creates pools | No | Pool creators |
| `TouchstoneLens` | URC-4 quotes through `StaticQuoteLib` | No | The hook's forwarders; routers |
| `GuardedRouter` | Single-pool swaps with an in-transaction deposit check | Only during a swap | Traders |
| `NyseCalendar` | Regular-session times for stock pools | No | The hook and the Settler |

Off-chain, the keeper, the indexer and the dashboard are described in §15. Outside, Pyth supplies settlement prices, Hermes serves them, and Chainlink supplies the drift trigger's reference.

## 5.3 Design rules

- **One-way trust.** The hook trusts only its immutables: the PoolManager, the Settler, the auction, the ledger, the factory, the lens and its listed routers.
- **The swap path never reverts on a dependency.** A failed reference, licence or calendar read means no deposit or no exemption, never a failed swap.
- **Conservation where money moves.** Every payout is checked against the record's deposit before anything is paid.
- **No admin.** Nothing can be paused, upgraded or re-parameterised after deployment.

## 5.4 Scope of v2.0

- Contracts: `TouchstoneHook`, `Settler`, `LicenceAuction`, `RebateLedger`, `TouchstoneFactory`, `TouchstoneLens`, `GuardedRouter`, `NyseCalendar`, and their libraries.
- Off-chain: keeper, indexer, dashboard, demo bots, and the research pipeline (E1–E12).
- Networks: Arbitrum Sepolia first, then Base Sepolia. No mainnet before an external audit.

## 5.5 Non-goals

- No owner, admin key or upgrade path. Parameters are fixed per pool at initialisation.
- No custom curve: the AMM stays plain v4 concentrated liquidity at a static fee.
- No off-chain auctioneer, no token and no prediction model. Triggers are fixed rules.

This is a design specification. Apart from the reference pack in Appendix A, nothing in it has been built or tested yet. Every gas or performance figure marked *target* is a goal, not a measurement.

---

# §6 Repository layout, toolchain and conventions

The repository is one monorepo. Contracts sit at the root, and each off-chain service is its own package with its own lockfile.

```text
touchstone/
  README.md                         problem, mechanism, prior work vs event work, partner integrations with file:line links
  FEEDBACK.md                       Uniswap developer feedback (required by the Foundation's tracks)
  DEPLOYMENTS.md                    every address, with the explorer check that confirmed it
  .env.example                      every variable, commented, no values
  foundry.toml  remappings.txt  slither.config.json  .gitignore  .gitmodules
  .github/workflows/ci.yml          §0.5 commands; nightly invariant and fork jobs
  lib/                              git submodules pinned to commits (§6.2)
    v4-core/  v4-periphery/  uniswap-hooks/  pyth-crosschain/  forge-std/
  src/
    TouchstoneHook.sol              callbacks, custody of deposits, records, vesting, payouts
    Settler.sol                     Pyth verification, markout, regime, split
    LicenceAuction.sol              lease of the clawback exemption (§10); built in M9
    RebateLedger.sol                rebates, protocol share and deferred refunds
    TouchstoneFactory.sol           validate config, register, initialize
    periphery/
      GuardedRouter.sol             quote, swap, assert; implements IMsgSender
      TouchstoneLens.sol            URC-4 quotes behind the hook's forwarders
    calendar/
      NyseCalendar.sol              regular-session schedule for closed-market pools
    libraries/
      BlockLib.sol                  EVM or ArbSys block number               (Appendix A)
      FlowBucketLib.sol             two leaky buckets per pool                (Appendix A)
      PriceLib.sol                  Pyth conversion, pool price, sqrt price   (Appendix A)
      DepositLib.sol                deposit rate and conversion               (Appendix A)
      SettlementMath.sol            markout, regime, clawback, split, rebate  (Appendix A)
      ItmLib.sol                    in-the-money leg                          (Appendix A)
      VestingLib.sol                drip amount                               (Appendix A)
      TriggerLib.sol                first touch, drift, closure, flagged decision
      RecordLib.sol                 build, hash and check records
      ReferenceLib.sol              Chainlink read with staleness, never reverts
      StaticQuoteLib.sol            view-only port of the v4 swap loop for URC-4
      TransientLib.sol              PoolId-keyed transient slots and the lock
      CalendarMath.sol              civil-date and US daylight-saving arithmetic
    interfaces/
      ITouchstoneHook.sol  ISettler.sol  ILicenceAuction.sol  IRebateLedger.sol  ITouchstoneFactory.sol
      IGuardedRouter.sol  IMarketCalendar.sol  IALFHook.sol  ITouchstoneErrors.sol  ITouchstoneEvents.sol
      external/AggregatorV3Interface.sol   vendored, MIT, source commit in the header
    types/
      PoolConfig.sol  PoolState.sol  Record.sol  Payout.sol  DepositQuote.sol  Lease.sol  Guard.sol
  test/
    unit/  invariant/  fuzz/  differential/  fork/  gas/  adversarial/
    fixtures/hermes/                recorded Hermes updates for offline fork tests
    mocks/                          Mock* only, never imported by src/
    utils/                          deployers, pool helpers, HookMiner usage
  script/
    MineHookAddress.s.sol  DeployCore.s.sol  CreatePool.s.sol  Verify.s.sol
    config/arbitrum-sepolia.json  config/base-sepolia.json
  keeper/       TypeScript, viem, zod
  indexer/      TypeScript; SQLite in development, Postgres in production
  dashboard/    Next.js, read-only, no wallet
  bots/         demo bots, seeded (§15.4)
  research/
    reference/  exact reference math and report checks (Appendix A)
    ingest/  replay/  experiments/  sims/  prereg/  results/
  sim/          Rust revm bytecode replay, adapted from VANE's sim/
  docs/
    SPEC.md  threat-model.md  gas.md
    decisions/  lessons/  audits/  ai/prompts/
```

## 6.1 Bootstrapping the repository

```bash
forge init --empty touchstone && cd touchstone      # Foundry 1.x: no commit unless --commit
git submodule add https://github.com/Uniswap/v4-core lib/v4-core && git -C lib/v4-core checkout 46c6834
git submodule add https://github.com/Uniswap/v4-periphery lib/v4-periphery && git -C lib/v4-periphery checkout 9969eec
git submodule add https://github.com/OpenZeppelin/uniswap-hooks lib/uniswap-hooks && git -C lib/uniswap-hooks checkout b5f1057
git submodule add https://github.com/pyth-network/pyth-crosschain lib/pyth-crosschain   # pin a release tag on day 1
# Chainlink: vendor the five-function AggregatorV3Interface (MIT) into src/interfaces/external/,
# with the source repository and commit in its header comment, instead of a whole submodule.
git submodule update --init --recursive
```

```toml
# foundry.toml
[profile.default]
src = "src"
test = "test"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 1_000_000      # lower it if TouchstoneHook nears 24,576 bytes; record the choice
bytecode_hash = "none"
fs_permissions = [{ access = "read", path = "./test/fixtures" }]

[fuzz]
runs = 2_000

[invariant]
runs = 256
depth = 500
fail_on_revert = false

[profile.nightly.invariant]
runs = 10_000
depth = 1_000
```

```text
# remappings.txt
forge-std/=lib/forge-std/src/
v4-core/=lib/v4-core/src/
v4-periphery/=lib/v4-periphery/src/
@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/src/
@pythnetwork/pyth-sdk-solidity/=lib/pyth-crosschain/target_chains/ethereum/sdk/solidity/
```

## 6.2 Pinned dependencies

| Dependency | Pin | Why this one |
| --- | --- | --- |
| Solidity | `0.8.26`, EVM `cancun` | Matches OpenZeppelin uniswap-hooks; transient storage needs Cancun |
| Uniswap v4-core | `46c6834` (2 Apr 2026) | `SwapParams` lives in `types/PoolOperation.sol` at this commit. Head on 25 Oct (`bea7f6d`) differs only in CI files |
| Uniswap v4-periphery | `9969eec` (19 Sep 2026) | `IMsgSender`, `HookMiner` (test/shared). Head on 25 Oct (`0c4e5bd`) differs only in CI files |
| OpenZeppelin uniswap-hooks | `b5f1057`, tag v1.3.0-rc.0 (no final v1.3.0 tag on 25 Oct 2026; D-4) | `BaseHook` with `_beforeSwap`/`_afterSwap` override points |
| Pyth SDK (Solidity) | pin to a release tag on day 1 | `IPyth.parsePriceFeedUpdatesUnique`, `PythStructs` |
| Foundry | pin a release tag in CI (v1.8.6 was the latest stable tag on 25 Oct 2026; the reference pack was built with 1.5.1) | Reproducible builds and gas snapshots |

Solidity dependencies are git submodules pinned to a commit, never a branch. Node, Python and Rust dependencies are locked (`pnpm-lock.yaml`, `requirements.lock`, `Cargo.lock`).

## 6.3 Conventions

The standing rules of §0 apply. In short:

- **Code.** `pragma solidity 0.8.26;` pinned, never `^`. Custom errors only, named `Touchstone__ReasonInPascalCase`. NatSpec on every external and public member. Named imports only.
- **Storage.** Structs are packed, with a comment above each struct giving the bit budget. No `public` state variables unless the getter is part of the API.
- **Unchecked blocks** carry a comment stating the invariant that rules out overflow.
- **No hardcoded values.** Every address, threshold, window and fee comes from `PoolConfig`, an immutable, a named constant or a deploy-script parameter.
- **No stubs in `src/`.** Mocks live only in `test/mocks/` and are named `Mock*`.
- **Commits.** Conventional, imperative, one logical change each, no emoji. The rationale goes in the body.
- **Validation after every change:** `forge fmt --check`, `forge build --sizes`, `forge test`, the invariant suite, `forge coverage`, `slither`, plus `ruff`/`mypy --strict`, `cargo clippy` and `tsc --noEmit` for the packages touched.

---

# §7 TouchstoneHook

`TouchstoneHook` is the only contract the PoolManager calls. It flags swaps, takes deposits as ERC-6909 claims and commits a hash of each record. It moves funds only when the `Settler` finalizes a record. It inherits OpenZeppelin's `BaseHook` (v1.3.0), which supplies `onlyPoolManager` and permission validation.

## 7.1 Permissions

| Flag | Bit | Why |
| --- | --- | --- |
| `beforeInitialize` | `1 << 13` | Lock the pool's config; reject pools the factory did not create |
| `beforeSwap` | `1 << 7` | Snapshot the pre-swap price, tick and liquidity in transient storage |
| `afterSwap` | `1 << 6` | Check the licence, evaluate triggers, take the deposit |
| `afterSwapReturnDelta` | `1 << 2` | Return `+D` on the unspecified currency |

The mined hook address must end in the flag bits `0x20C4`. The hook has no liquidity callbacks, so it can never block an LP's exit. It has no `beforeSwapReturnDelta`, so it never changes the AMM's execution. Pools use an ordinary static fee, and `beforeSwap` returns a zero fee override.

## 7.2 Immutables

`POOL_MANAGER` (from `BaseHook`), `SETTLER`, `LICENCE`, `LEDGER`, `FACTORY`, `LENS`, `BLOCK_SOURCE`, and up to four `TRUSTED_ROUTER_n` addresses: routers that implement v4-periphery's `IMsgSender`, such as the Universal Router and `GuardedRouter` on each chain. §14 explains how the deploy script resolves the circular references.

## 7.3 Storage

```solidity
/// Per-pool mutable state, five slots:
/// slot A: lastTouchBlock (64) | nextRecordId (64) | vestLast (40)
/// slot B: flowBuy (104) | flowSell (104) | flowTime (40)    read and written on every swap
/// slot C: outstanding0 (128) | outstanding1 (128)
/// slot D: rebatePool0 (128) | rebatePool1 (128)
/// slot E: vest0 (128) | vest1 (128)
struct PoolState {
    uint64 lastTouchBlock;   // BlockLib number of the last first touch at or above n0
    uint64 nextRecordId;
    uint40 vestLast;         // time of the last drip
    uint104 flowBuy;         // leaky buckets in quote units, stored plus one so the slot never returns to zero
    uint104 flowSell;
    uint40 flowTime;         // time of the last bucket update
    uint128 outstanding0;    // claims held for open records, currency0
    uint128 outstanding1;
    uint128 rebatePool0;     // claims reserved for rebates
    uint128 rebatePool1;
    uint128 vest0;           // retained value and rent not yet donated
    uint128 vest1;
}

mapping(PoolId => PoolConfig) internal _config;          // written by register, locked at initialize
mapping(PoolId => PoolState) internal _state;
mapping(PoolId => mapping(uint64 => bytes32)) internal _recordHash;  // keccak256(abi.encode(Record))
```

Records are committed by hash. The full record is emitted in `DepositTaken`, and the settler passes it back as calldata. One new storage slot per flagged swap, cleared at settlement for a refund, instead of four.

Transient slots are keyed by `PoolId`, so swaps on different pools inside one unlock never overwrite each other: `PRE_SQRT_PRICE`, `PRE_LIQUIDITY`, `FIRST_TOUCH_TX`, `LAST_DEPOSIT` and `LAST_RECORD`. `beforeSwap` zeroes the last two, so a read after an unflagged swap returns nothing. A separate transient `LOCK` guards `finalize`, `creditRent` and `drip` against reentrancy.

## 7.4 Swap path

```text
beforeSwap(sender, key, params, hookData):
    hookData must be 0, 32 or 64 bytes, else revert MalformedHookData
    tstore PRE_SQRT_PRICE[id], PRE_LIQUIDITY[id] from StateLibrary.getSlot0 / getLiquidity
    tstore LAST_DEPOSIT[id] = 0, LAST_RECORD[id] = 0
    return (selector, ZERO_DELTA, 0)

afterSwap(sender, key, params, delta, hookData):
    N, s, pExec = notional, direction and execution price from delta      // AMM part only
    if calendar pool and now > calendarValidUntil: return (selector, 0)
    flowHit = add N to the bucket for direction s; bucket >= nMin         // every swap
    if N < n0 and not flowHit: return (selector, 0)                      // retail: one slot read and write
    mode = CLOSED if the calendar is closed at t or at t + delta + maxLag, else CONTINUOUS
    g = drift(s) if mode == CONTINUOUS, else 0                            // try/catch; 0 if stale
    if mode == CONTINUOUS and licence pool and N >= n0 and the fast path holds (§10):
        lastTouchBlock = BlockLib.number(); emit LicensedSwap; return (selector, 0)
    flagged = flowHit or (N >= n0 and (firstTouch() or mode == CLOSED or g >= tau))
    if not flagged: return (selector, 0)
    D = deposit(N, g, pExec, mode) in the unspecified currency
    if D == 0 or outstanding + D > maxOutstanding: return (selector, 0)   // guarded launch
    POOL_MANAGER.mint(address(this), unspecified.toId(), D)
    (beneficiary, rebateTo) = resolve(sender, hookData)
    write record hash; outstanding += D; tstore LAST_DEPOSIT, LAST_RECORD
    emit DepositTaken(record); emit HookSwap(id, sender, -D on the unspecified side, 0)   // URC-2
    return (selector, int128(D))
```

Returning `+D` credits the hook on the unspecified currency, and the PoolManager subtracts it from the swapper (`callerDelta = swapDelta − hookDelta` in v4-core `Hooks.afterSwap`). The `mint` call balances the hook's credit within the same callback.

## 7.5 Triggers

The flow bucket sees every swap. The other triggers apply only when N ≥ N₀, so an ordinary retail swap posts no deposit and pays for no oracle read unless it belongs to a burst large enough to fill the bucket.

| Trigger | Rule | Notes |
| --- | --- | --- |
| First touch | The first swap at or above N₀ in the block, by `BlockLib`'s block number | Every later swap in that transaction also counts. A swap below N₀ never uses up the status. On sub-second chains nearly every swap above N₀ is a first touch |
| Flow | The bucket for the swap's direction, after adding N, holds at least N\_min | Applies to every swap, even below N₀. The bucket drains at N\_min / h per second, so splitting a trade across swaps or blocks still fills it |
| Drift | g = s · (P\_ref − p\_pre) / P\_ref ≥ τ | P\_ref is the Chainlink answer, ignored if older than `referenceMaxAge`. Read only for swaps that pass the retail check |
| Closed market | The calendar is closed now, or at t + Δ + maxLag | Every swap at or above N₀ is flagged, at the closure rate δ\_c (§9) |

## 7.6 Deposit size and currency

```latex
D_{quote} = N \cdot \min\big(\delta_{max},\ \max(\delta,\ \beta \cdot g^{+})\big)
```

Scaling by the pre-swap gap g⁺ keeps the cap from binding on large dislocations. When the unspecified currency is the risky token, the hook converts at the swap's own execution price, D = D\_quote / p\_exec, so no oracle is needed at swap time. Closed-market records use δ\_c in place of the bracket.

## 7.7 Refund beneficiary

1. If `sender` is a trusted router, the beneficiary is `IMsgSender(sender).msgSender()`. The Universal Router's `Dispatcher` returns the address that started the lock.
2. Otherwise, the beneficiary named in `hookData`, if it is non-zero (the 32- and 64-byte forms in §11). `hookData` is untrusted and supplies only the beneficiary and the rebate recipient.
3. Otherwise `tx.origin`. Relayed and ERC-4337 transactions should go through a trusted router or name a beneficiary, or the refund reaches the relayer (§18, T16).

## 7.8 Gas targets

*Targets*, measured in `test/gas/` and recorded in `docs/gas.md`: at most 15k gas added to an unflagged swap below N₀; 40k to an unflagged swap at or above N₀, which reads the reference once; and 90k to a flagged swap, with one new slot, one mint and two events. §17 has the rest.

## 7.9 Implementation notes for the swap path

These are the places where v4 mechanics are easy to get wrong. Each has a named test.

**Permissions.**

```solidity
function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
    p.beforeInitialize = true;
    p.beforeSwap = true;
    p.afterSwap = true;
    p.afterSwapReturnDelta = true;
    // every other field stays false; the mined address must end in 0x20C4
}
```

**Which currency is unspecified.** In v4-core `Hooks.afterSwap`, the specified currency is currency0 exactly when `(params.amountSpecified < 0) == params.zeroForOne`. The deposit is taken on the other one:

```solidity
bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
Currency unspecified = specifiedIs0 ? key.currency1 : key.currency0;
```

`params.amountSpecified < 0` means exact input. Test: `test_Deposit_UnspecifiedCurrency_AllFourCases` (both directions, exact input and exact output).

**The AMM part.** The `BalanceDelta` passed to `afterSwap` is the pool's swap delta before any hook delta, from the swapper's side. That is what `Record.amount0/amount1` store and what the markout uses. N is the absolute quote-side amount.

**Taking the deposit.** Return `int128(D)` as the unspecified delta and call `POOL_MANAGER.mint(address(this), unspecified.toId(), D)` in the same callback. The PoolManager then charges the swapper `swapDelta − hookDelta`, and the hook's +D credit is cleared by the mint. Test: `test_Deposit_SignChargesSwapper`, which asserts the swapper's balance falls by exactly the AMM amount plus D.

**Exact output.** For exact output the unspecified currency is the input, so the deposit raises what the swapper pays. `GuardedRouter`'s `maxNetIn` and `previewDeposit` exist for this (§12). Test: `test_ExactOutput_DepositRaisesInput`.

**Hook-initiated swaps.** v4-core skips the hook's own callbacks when `msg.sender == address(hook)`. Touchstone never swaps, so this path is unused; keep it that way.

**Flow buckets.** Both directions share one timestamp in slot B, so every update drains both buckets to the current time before adding to one (`FlowBucketLib.update` in Appendix A). The developer docs did not say this; decision D-2.

**Reference read.** `ReferenceLib.read(aggregator, maxAge)` calls `latestRoundData()` inside `try`/`catch`, rejects non-positive answers, answers older than `referenceMaxAge` and incomplete rounds, and returns `(ok, priceX36)`. On any failure it returns `ok = false`, and the drift trigger and the licence fast path treat the reference as absent. It never reverts. On L2s, also check the Chainlink sequencer uptime feed when the chain has one; pass its address as an optional immutable, zero to skip.

**Notional below N₀.** The retail check runs before any external call: a swap below N₀ costs one bucket update (one slot read and write) and nothing else. Keep it that way; the 15k gas target depends on it.

**Size limit.** `TouchstoneHook` must stay under 24,576 bytes. URC-4 quoting lives in `TouchstoneLens` behind thin forwarders for that reason. Check `forge build --sizes` on every change.

---

# §8 Settler and settlement

The `Settler` takes a record and a signed Pyth update and turns them into a split. It then tells the hook to pay that split out. Anyone can call it, and in practice the keeper does. The Settler holds no funds: deposits stay in the hook as ERC-6909 claims, and the hook re-checks every amount it is told to pay.

## 8.1 Entry points

```solidity
/// @notice Settle an open record against the first Pyth update at or after its settlement time.
function settle(Record calldata record, bytes[] calldata pythUpdate) external payable returns (Payout memory);

/// @notice Refund an open record in full once its window has passed.
function expire(Record calldata record) external;
```

## 8.2 Steps

1. **Authenticate.** Require `keccak256(abi.encode(record)) == hook.recordHash(poolId, id)`, which also proves the record is still open.
2. **Settlement time.** In continuous mode, t₀ = timestamp + Δ. In closed-market mode, t₀ = `calendar.nextOpen(timestamp)` + `openDelay`. Require `block.timestamp ≥ t₀`.
3. **Parse.** Call `parsePriceFeedUpdatesUnique{value: fee}(pythUpdate, [basePriceId, quotePriceId], t₀, t₀ + maxLag)`, with `fee = getUpdateFee(pythUpdate)`. Pyth accepts an update only if `publishTime ≥ t₀` and `prevPublishTime < t₀`. The result is therefore the first price at or after t₀, and no caller can choose another.
4. **Fair price.** P\* = (p\_base · 10^e\_base) / (p\_quote · 10^e\_quote), held as quote base units per risky base unit scaled by 1e36 (D-1), via `PriceLib.fairPriceX36`. Confidence c\* = conf\_base/p\_base + conf\_quote/p\_quote. If c\* exceeds `maxConfBps`, refund in full.
5. **Markout.** From the AMM part of the swap, x\_r and x\_q are the trader's signed receipts of the risky and quote tokens.
6. **Regime.** Closure records use α\_c and ε\_c (§9). Otherwise the licence rules of §10 decide: 0 on the holder's slow path, α\_lic for anyone else inside the band, and α outside the band or when no licence was live.
7. **Split and pay.** The Settler calls `hook.finalize(record, payout, false)`. Inside one unlock the hook burns the record's claims, takes the refund to the beneficiary and the tip to the caller, and keeps the LP share as claims for vesting. It moves any rebate's claims to the ledger and credits the recipient. If the refund transfer fails, the hook credits the refund in the ledger in the beneficiary's name instead. Finally it deletes the record hash. When `finalize` returns, the Settler emits `Settled` with the markout, the fair price and the α used, which the hook never sees (D-18).

```latex
m = x_r \, P^{*} + x_q, \qquad \varepsilon_{eff} = \varepsilon + c^{*}
```

```latex
R = \min\Big( D,\ \alpha_{regime} \cdot \max\big(0,\ m^{+} - \varepsilon_{eff} N^{+}\big) \Big), \qquad \mathrm{refund} = D - R
```

**In-the-money accounting.** When `itmAccounting` is on and the post-swap price overshoots P\*, only the part of the swap executed before the price crossed P\* counts. That part runs from `sqrtPriceBefore` to √P\* at `liquidityBefore`, computed with `SqrtPriceMath`, and gives m⁺ and N⁺. Otherwise m⁺ = m and N⁺ = N. This removes the padding incentive (§18). A swap that crossed initialized ticks makes the constant-liquidity step an approximation, and differential tests compare it with an exact off-chain replay.

**Splitting R.** tip = min(`tipCap`, `tipBps` · R) goes to the caller. Of the remainder, protocolShareBps is credited in the ledger to the pool's protocol recipient (§12), ρ of what is left goes to the rebate pool, and the rest goes to LPs through vesting. A benign record (R = 0 and m ≤ 0) instead earns a rebate of min(κ · f · N, rebate pool), and its tip comes out of that rebate (§11).

**Closed-market jump guard.** If |P\*/p\_exec − 1| exceeds `jumpRefundBps`, the record refunds in full. A jump that large is treated as a corporate action or halt, not as information.

## 8.3 Expiry

After t₀ + W (or `windowClosed` for closure records), anyone may call `expire`. It refunds in full and pays no tip and no rebate. A missed settlement therefore costs LPs that record's clawback and never costs a trader the deposit.

## 8.4 Vesting donations

Retained value and rent wait in a vesting buffer. Each call to `drip(PoolKey)` donates vest × min(1, elapsed / `vestPeriod`) of it to in-range LPs, so new money spreads over roughly one vesting period, and a JIT position must stay in range about that long to share in it. Settlement, expiry and rent crediting all drip, and anyone else may call it. `donate` reverts when in-range liquidity is zero, so `drip` skips that pool and the amount waits.

## 8.5 Units and rounding

- Markout math runs in signed quote units with 1e36-scaled prices, using `FullMath.mulDiv` (§4.12).
- R, the tip and the rebate round down, and the refund is D − R, so refund + R = D exactly. When D is held in the risky token, R converts at P\* and rounds down.
- The hook re-checks in `finalize` that refund + R = D, that tip + toProtocol + toRebatePool + toLPs = R, and, for a benign record, that tip + rebate does not exceed the rebate pool. It reverts otherwise.

## 8.6 Failure handling

| Case | Result |
| --- | --- |
| Update missing, or not the first after t₀ | `parsePriceFeedUpdatesUnique` reverts; the keeper fetches the right update and retries |
| No usable update before the window ends | `expire` refunds in full |
| Confidence above `maxConfBps` | Refund in full |
| Zero in-range liquidity | The LP share waits in vesting |
| Record already closed | Revert `Touchstone__RecordClosed` |
| Refund transfer fails (blocklisted or reverting recipient) | Credited in the ledger in the beneficiary's name, with a RefundDeferred event |

## 8.7 Settler in code order

```text
settle(record, pythUpdate) payable:
    require keccak256(abi.encode(record)) == HOOK.recordHash(record.poolId, record.id)        // else RecordClosed
    cfg = HOOK.poolConfig(record.poolId)
    (t0, latest, expiresAt) = settleTime(record)                                               // calendar for closures
    require block.timestamp >= t0                                                              // else TooEarly(t0)
    fee = PYTH.getUpdateFee(pythUpdate)
    feeds = PYTH.parsePriceFeedUpdatesUnique{value: fee}(pythUpdate, [cfg.basePriceId, cfg.quotePriceId], t0, latest)
    refund excess msg.value to msg.sender
    P  = PriceLib.fairPriceX36(base.price, base.expo, quote.price, quote.expo, decRisky, decQuote)
    c  = PriceLib.confBpsUp(base.price, base.conf, quote.price, quote.conf)
    if c > cfg.maxConfBps: payout = full refund                                                // non-benign, R = 0
    else if closure and |P / pExec - 1| > J: payout = full refund                              // jump guard
    else:
        (xR, xQ) = trader receipts from record.amount0/1 by QUOTE_IS_0
        if ITM_ACCOUNTING: (a0, a1) = ItmLib.leg(...); (xR+, xQ+) from (a0, a1)
        m+ = SettlementMath.markout(xR+, xQ+, P);  N+ = |xQ+|
        inBand = |p_pre - P| <= G * P            // only when record.licenceActive
        a  = SettlementMath.alphaBps(record.mode, record.licenceActive, record.byHolder, inBand, ...)
        eps = closure ? cfg.epsClosedBps : cfg.epsBps
        R  = SettlementMath.clawback(depositQuoteValue, m+, N+, eps, c, a)
        m  = SettlementMath.markout(xR, xQ, P)                                                // whole swap, for benign test
        if R == 0 and m <= 0: payout = SettlementMath.benign(...)                            // rebate may be 0
        else: payout = SettlementMath.splitRetained(deposit, R converted to deposit currency, ...)
    HOOK.finalize(record, payout, false)                                                       // hook re-checks conservation
    emit Settled(record.poolId, record.id, m, P, a, payout)                                    // from the Settler (D-18)
```

The Settler is stateless apart from its immutables, so it needs no reentrancy lock of its own; `finalize` holds the hook's transient lock. `settle` is `payable` only to forward the Pyth fee.

---

# §9 Closed-market mode

Tokenized-stock pools trade around the clock, but the stock's home market does not. While it is closed, the pool quotes a price that the reopen will correct, and an informed trader can trade against LPs at that price. Closed-market mode flags every swap at or above N₀ while the market is closed, and settles it against the first regular-session price after the reopen. Crypto pools set no calendar and never enter this mode.

## 9.1 Market calendar

```solidity
interface IMarketCalendar {
    /// @notice True while the regular session is open at time t.
    function isOpen(uint256 t) external view returns (bool);

    /// @notice Opening time of the first regular session that starts after t.
    function nextOpen(uint256 t) external view returns (uint256);

    /// @notice Last timestamp the calendar's holiday data covers.
    function validUntil() external view returns (uint256);
}
```

`NyseCalendar` implements the regular session, 09:30 to 16:00 New York time on weekdays. It computes daylight saving time from the US rule in force since 2007 (second Sunday in March to first Sunday in November). Holidays and 13:00 early closes are passed to the constructor for the years NYSE has published, and the contract has no owner. `isOpen` and `nextOpen` are date arithmetic plus a binary search over that list.

When a pool is registered, the factory copies `validUntil()` into its config. After that date the pool takes no deposits at all. LPs lose protection, but no trader ever posts a deposit that cannot be settled. The date is visible from the start, and LPs should move to a pool with a newer calendar before it.

## 9.2 Choosing the mode at swap time

A swap at time t on a calendar pool becomes a closure record if either of these holds:

- `isOpen(t)` is false.
- `isOpen(t + Δ + maxLag)` is false, so continuous settlement would fall after the close.

The second rule sends swaps made in the last seconds of a session to the reopen, instead of leaving them with no usable price.

|  | Continuous record | Closure record |
| --- | --- | --- |
| Flagged when | Any trigger in §7 | Every swap at or above N₀; below N₀, the flow trigger |
| Deposit | N · min(δ\_max, max(δ, β·g⁺)) | N · δ\_c |
| Licence exemption | Applies | Never applies |
| Settlement time t₀ | t + Δ | `nextOpen(t)` + `openDelay` |
| Latest usable update | t₀ + `maxLag` | t₀ + `maxLagClosed` |
| Regime | α and ε, or α\_lic inside the band | α\_c and ε\_c |
| Expiry | t₀ + W | t₀ + W\_c |

The drift trigger plays no part in closure records, because a stock's Chainlink reference is as stale as the pool while the market is closed.

## 9.3 Settling at the reopen

The Settler follows the steps in §8 with t₀ = `nextOpen(t)` + `openDelay`. Pyth's uniqueness rule then selects the first regular-session update after the reopen. If the open is delayed, or the stock is halted at the open, no update arrives before t₀ + `maxLagClosed`, and the record expires at t₀ + W\_c with a full refund. An unscheduled closure, which the calendar cannot know about, ends the same way.

Expiry counts from t₀, not from the swap, so W\_c never has to cover the closure itself. A Friday-evening record expires 24 hours after Monday's reopen, not 24 hours after Friday.

## 9.4 Corporate actions

A split, a reverse split or a special dividend can move the reference price far from what the token is worth. Two rules contain this.

- **Jump guard.** If |P\*/p\_exec − 1| exceeds `jumpRefundBps` (J, default 25%), the record refunds in full. A move that large is treated as a corporate action, a halt or a data error, not as information. The cost is that a genuine gap of more than 25% pays LPs nothing.
- **Fixed share ratio.** v2.0 supports only tokens that track one share at a fixed ratio. Tokens that fold dividends into the price, or change their ratio, need an on-chain ratio source, which is out of scope.

## 9.5 The noise tax

The clawback is one-sided: it keeps part of a positive markout and pays nothing back when the markout is negative. Over three seconds this hardly matters, because the fee is larger than the price noise. Over a weekend it matters a great deal. An uninformed trader's markout is then mostly noise, and the clawback keeps part of the upside.

For a benign trader whose markout has noise σ\_c over the closure, the expected clawback is approximately

```latex
\mathbb{E}[R] \approx \alpha_c N \sigma_c \big[\varphi(z) - z\,(1 - \Phi(z))\big], \qquad z = \frac{f + \varepsilon_c}{\sigma_c}
```

where φ and Φ are the standard normal density and distribution. My calculation, under that normal approximation:

| Case | z | Expected clawback on a benign trade |
| --- | --- | --- |
| Weekend, σ\_c = 1.5%, f = 5 bps, ε\_c = 50 bps, α\_c = 0.5 | 0.37 | about 18 bps of notional |
| Weekend, continuous values (ε = 2 bps, α = 0.8) | 0.05 | about 45 bps |
| Continuous, Δ = 3 s at 3% daily volatility (noise about 1.8 bps) | 4.0 | effectively zero |
| Continuous, Δ = 3 s at 5.2% daily volatility | 2.3 | about 0.01 bps |

That is why closure records get their own α\_c and ε\_c, set lower and wider than the continuous values. The tax works like the wider spread a market maker quotes overnight. E9 measures both the information in closure-time markouts and the tax on benign closure trades. If the tax exceeds what the clawback recovers from informed trades, closed-market mode is dropped (§16).

Deposits are also larger and held longer. At δ\_c = 300 bps, a $10,000 Saturday swap locks $300 until Monday's settlement. `previewDeposit` reports this before the trade (§12).

## 9.6 Extended-hours prices

US equities also trade before the open, after the close, and overnight on weeknights. v2.0 settles only against the regular session. An extended-hours feed would shorten the wait but rest on thinner prices, so it is left for a later version and would need its own E9 run.

---

# §10 Arbitrage licence

**Build timing.** Everything in this section is milestone M9, built after the M8 testnet deployment (decision 0050). Until then `Record.licenceActive` and `Record.byHolder` exist and are always false, and the `LICENCE` flag is rejected by the factory.

`LicenceAuction` leases one arbitrageur an exemption from the clawback on a pool, for rent paid to that pool's LPs by the second. Exclusivity is enforced at settlement, not by ordering. An outsider can still trade first, but inside the price band it keeps only 1 − α\_lic of its markout above the margin, so its win mostly pays LPs. That is why the licence works on first-come-first-served chains such as Arbitrum and Robinhood Chain, where an MEV tax has no priority fee to tax.

The licence is per pool and optional, switched on by the `LICENCE` flag in `PoolConfig`. While no lease is live, the pool runs the plain clawback of §7 and §8.

## 10.1 What the plain clawback misses

- **The margin.** Arbitrageurs keep ε·N on every swap, and ε must equal their cost, which LPs can only estimate.
- **The cap.** R never exceeds D, so markout beyond δ\_max·N is lost.
- **Overhead.** Every flagged arbitrage pays for a record, a settlement and a keeper tip.
- **Calibration.** A wrong ε either stalls arbitrage or invites padding (§18).

An auction prices the arbitrage directly, so LPs need no estimate of anyone's cost.

## 10.2 What the holder gets

- Its first swap at or above N₀ in each block posts no deposit, while the pool sits inside the band.
- Nothing else. It does not set the fee, collect fees or get priority. LPs keep every swap fee, unlike the am-AMM, where the manager sets and keeps the fee.

## 10.3 Rules at swap time

In `afterSwap`, for a continuous-mode swap with N ≥ N₀ on a licence pool:

```text
(swapper, live) = LICENCE.holderOf(id)
byHolder = live and resolveSwapper(sender) == swapper and lastTouchBlock < BlockLib.number()
if byHolder and reference fresh and |g| <= G:          // fast path, no record
    lastTouchBlock = BlockLib.number()                  // uses up the block's first touch
    emit LicensedSwap(id, swapper, amount0, amount1)
    return (selector, 0)
otherwise: normal triggers; the record stores licenceActive = live and byHolder
```

`resolveSwapper` returns `IMsgSender(sender).msgSender()` for a trusted router and `sender` otherwise. It never reads `hookData` or `tx.origin`. Every swap that misses the fast path is treated like anyone else's, including the holder's second swap in the same block.

## 10.4 Rules at settlement

The band test is |p\_pre − P\*| ≤ G · P\*, using the record's pre-swap price.

| Licence live at swap time | Band test | byHolder | α used |
| --- | --- | --- | --- |
| No | Not used | Not used | α |
| Yes | Inside | Yes | 0, full refund |
| Yes | Inside | No | α\_lic |
| Yes | Outside | Either | α |

The second row is the holder's slow path: its swap missed the fast path because the reference was stale or showed a gap above G, but P\* shows it was inside the band.

## 10.5 Why only the first touch

A sandwich needs a back-run in the same block, after the victim. A back-run is never the block's first touch, so it is never `byHolder`, and inside the band it settles at α\_lic. A colluding pair fails the same way: if an outsider front-runs at or above N₀, the front-run takes the first touch, and the holder's back-run gets a deposit. Legs below N₀ post no deposit for anyone, so the holder gains nothing there that others lack, and the flow trigger bounds them for everyone.

On Arbitrum and its Orbit chains, `block.number` returns an approximate parent-chain block number, not the L2 block. `BlockLib` therefore reads `ArbSys(100).arbBlockNumber()` there and `block.number` elsewhere. The choice is a constructor immutable set by the deploy script, not a chain-ID check.

## 10.6 Why the band

The band does two jobs.

- **Freshness backstop.** An idle holder can let the pool drift by about G at most before outsiders are paid at the normal α to realign it. Freshness never depends on trusting the holder.
- **Tail protection.** Jumps beyond G go back to the clawback for everyone, the holder included. A lone bidder at the reserve cannot buy the largest arbitrages cheaply, and every bidder prices a smoother asset.

The fast path tests the band against the Chainlink reference, which can lag. If the reference shows the pool inside the band when P\* would not, the holder escapes the clawback on that swap, and the leak is bounded by the reference's deviation threshold. In the opposite case the holder posts a deposit and gets all of it back.

## 10.7 The lease

The mechanics follow the am-AMM of Adams, Moallemi, Reynolds and Robinson (arXiv 2403.03367). Bunni's BidDog library implements the am-AMM, but `AmAmm.sol` is AGPL-3.0, so Touchstone reimplements the lease from the paper and this spec and copies no code. It differs in three ways: time is measured in seconds, not blocks; rent is paid in the pool's quote token and donated to LPs, where BidDog burns LP shares; and bids carry no fee payload.

```solidity
/// One lease. Three slots:
/// slot 0: owner (160) | since (40)
/// slot 1: swapper (160)
/// slot 2: rent (128) | deposit (128)
struct Lease {
    address owner;     // pays rent, may top up, withdraw and change the swapper
    uint40 since;      // top: rent paid up to here; next: time of the bid
    address swapper;   // the address whose swaps are exempt
    uint128 rent;      // quote-token base units per second
    uint128 deposit;   // quote-token base units
}

mapping(PoolId => Lease) internal _top;    // current holder
mapping(PoolId => Lease) internal _next;   // pending bid
mapping(address => mapping(Currency => uint256)) internal _refunds;
```

1. **Bid.** `bid(id, swapper, rent, deposit)` requires rent ≥ `minRent`, rent ≥ max(top.rent, next.rent) · (1 + `minIncrementBps` / 10⁴) rounded up, and deposit ≥ rent · K. It pulls the deposit, credits the displaced next bid's deposit to that owner's refunds, and stores the new bid as next with since = now.
2. **Activation.** At next.since + K the next bid becomes top. The old top pays rent up to that instant, and its remaining deposit goes to refunds.
3. **Rent.** The top pays rent × elapsed seconds out of its deposit.
4. **Lapse.** If the deposit runs out, the lease ends at since + deposit / rent. The pool reverts to the plain clawback until a pending bid activates at its own time.
5. **Accrual.** `accrue(id)` applies every transition up to now and sends the rent charged since the last call to the hook. Anyone may call it, and `bid`, `topUp` and `withdraw` call it first.
6. **Deposits.** An owner may top up at any time and withdraw while the remaining deposit covers at least K seconds of rent. Displaced deposits are claimed with `claimRefund`.
7. **Swapper.** The owner may change the exempt address with `setSwapper`, effective at once.

`holderOf(id)` is a view that applies the same transitions in memory, so the swap path never writes auction state.

| State | Bid placed | K seconds after the pending bid | Deposit runs out |
| --- | --- | --- | --- |
| No holder, no bid | Pending bid | — | — |
| No holder, pending bid | A higher bid replaces it | Bid becomes holder | — |
| Holder, no bid | Pending bid | — | No holder |
| Holder, pending bid | A higher bid replaces it | Bid becomes holder; old holder refunded | Pending bid waits for its own activation |

The delay K does three jobs. A bidder cannot take the licence just for a scheduled event, such as a CPI release, an earnings call or the reopen. The holder always gets K seconds of notice. And a holder that stops topping up still owes rent until the deposit runs out.

## 10.8 Where rent goes

`accrue` transfers the rent to the hook and calls `creditRent(key, amount)`. The hook settles the tokens into ERC-6909 claims, credits the protocol share in the ledger, sends ρ of the rest to the rebate pool and vests what remains to in-range LPs through `drip`. Rent also accrues while a stock's market is closed, when the licence does not apply, and bidders price that in. Licence pools need an ERC-20 quote token.

## 10.9 When LPs come out ahead

- **Two or more bidders.** Competition pushes rent toward the inside-band arbitrage the winner expects, net of its costs. That rent replaces the clawback LPs would have collected and adds the leaks listed above. Outsiders who beat the holder still pay α\_lic of their excess.
- **One bidder.** Rent sinks to the reserve. Jumps beyond G still go to the clawback, but inside-band arbitrage may be worth more than the reserve, and LPs would then collect less than the plain clawback pays.

E10 compares LP income under one and two bidders with the plain clawback. A pool enables the licence only if the one-bidder case at its reserve does no worse.

## 10.10 Defaults

K = 3,600 s on mainnets (60 s on testnet demos), a 10% minimum increment (the am-AMM default in BidDog), α\_lic = 0.95, G = 25 bps, and a per-pool reserve set from E10. §14 gives the bounds.

## 10.11 Gas

*Target:* the licence check adds at most 18k gas to a swap at or above N₀ on a licence pool: one external call and up to six cold reads. The fast path writes one slot and emits one event, so an exempt swap costs less than a flagged one.

## 10.12 Prior art

MEV taxes need priority ordering. Arbitrum's Timeboost sells ordering for the whole chain, and the revenue goes to the chain, not to LPs. McAMM-style designs sell the first swap of each block, which depends on the winner landing first, and LodeHook charges the first swap of each block a premium. The am-AMM sells fee-setting and fee-free trading. As far as my search found, none of these enforces exclusivity by ex-post markout settlement against an outside price.

---

# §11 Benign-flow rebates

Every settlement already measures whether a flagged trade hurt LPs. Rebates turn that measurement into an order-flow payment. A flagged trade that settles benign earns a rebate, paid to whoever the transaction names, usually the router or wallet that built it. No attestation, reputation or allowlist is involved, because the markout is the proof. Uniswap's ALF design gives better prices to flow that a frontend attests, and lists producing those attestations as open work. Touchstone's rebates need no attester.

## 11.1 Funding

The rebate pool receives ρ (`rhoBps`, default 10%) of everything LPs retain: the clawback after the keeper tip, and licence rent. It is held per pool and per currency, in `rebatePool0` and `rebatePool1`. A pool created with ρ = 0 has no rebates.

## 11.2 Eligibility and amount

A record earns a rebate when it is settled, not expired, with R = 0 and m ≤ 0, so the trader lost to the pool after the fee.

```latex
\text{gross} = \min\big(\kappa \cdot f \cdot N,\ \text{rebatePool}_c\big), \qquad \text{tip} = \min(\text{tipCap},\ \text{tipBps} \cdot \text{gross}), \qquad \text{net} = \text{gross} - \text{tip}
```

Here c is the record's deposit currency, f is the pool's LP fee, and κ is `kappaBps` (default 40%). When c is the risky token, κ·f·N converts at P\*. The tip pays whoever settles the record, so benign records are worth settling even though they retain nothing. Rebates are paid first come, first served, and a record settled after the pool runs dry gets a partial rebate or none.

## 11.3 Recipient and hookData

| hookData length | Layout | Effect |
| --- | --- | --- |
| 0 | Empty | Default beneficiary (§7); rebate to the beneficiary |
| 32 | `abi.encode(address beneficiary)` | Beneficiary as given, unless the sender is a trusted router; rebate to the beneficiary |
| 64 | `abi.encode(address beneficiary, address rebateTo)` | As above, with the rebate to `rebateTo`; a zero `beneficiary` falls back to the default |
| Any other | — | Revert `MalformedHookData` (the URC-4 error) |

Both addresses are untrusted and used for nothing else. The trader signs the transaction, so a router that names itself as `rebateTo` does so with the trader's consent, as with an interface fee.

## 11.4 Payment through the RebateLedger

Rebates are credited, not pushed. At settlement the hook transfers ERC-6909 claims to `RebateLedger` and calls `credit(recipient, currency, amount)`. ERC-6909 transfers need no unlock, so crediting is cheap.

- `claim(currency, to)`: the recipient withdraws the underlying token. The ledger unlocks the PoolManager, burns its claims and takes the token to `to`.
- `claimAsClaims(currency, to)`: the recipient receives the ERC-6909 claims instead.
- `push(recipient, currency)`: anyone sends a recipient's balance to that recipient, which lets a keeper pay many routers in one batch.

The ledger also holds refunds that could not be pushed at settlement, such as a USDC refund to a blocklisted address or a native-ETH refund to a contract that reverts. The beneficiary claims them later to an address it controls, so a bad recipient can never block a settlement. The ledger checks after every credit that its claim balance covers everything it owes.

## 11.5 Why wash trading loses

A wash leg pays the full fee f·N to LPs and gets back at most κ·f·N, so each leg loses (1 − κ)·f·N plus price impact and gas. That holds for any κ below 1.

The exception is an LP washing against its own liquidity. An LP that owns a share φ of in-range liquidity gets φ of the fee back, so a wash leg pays it if φ > 1 − κ (60% at the default), before impact and gas. The most it can take is the rebate pool, which costs the other LPs at most their share of ρ of retained income. E11 measures in-range concentration on target pools; where one address holds more than 1 − κ, the pool is created with a lower κ.

Splitting an arbitrage to farm rebates fails too. The benign piece loses more than its rebate, and the toxic piece is clawed back as usual.

## 11.6 What a backtest cannot show

A backtest holds flow fixed. It can price the rebates and bound the gaming, but it cannot show whether rebates attract flow. That needs a live pool and a router partner, which belongs to the adoption phase.

## 11.7 Events

`RebateCredited(id, recordId, recipient, currency, amount)` on every credit. The hook also emits `HookBonus(id, amount0, amount1)` from the Uniswap Foundation's 2025 hook data guide, for indexers that follow it.

---

# §12 Quote integrity

A deposit depends on block state: whether the swap is the block's first touch, how full the flow bucket is, and where the reference sits. A quote fetched in one block can therefore differ from the execution in the next, and routers see that gap as slippage. They also count a deposit as a loss, although it is refundable. Hooks in general have a trust problem here as well: 0x reported flagging 54.2% of 84,163 hooks as malicious for quoting one price and settling another (reported by CryptoSlate). Touchstone answers with four pieces.

| Piece | What it gives a router |
| --- | --- |
| `previewDeposit` | The deposit a swap would post now, and the deposit if flagged |
| URC-4 functions | A deposit-aware quote in one static call |
| URC-2 `HookSwap` | An event for every swap that posts a deposit |
| `GuardedRouter` | An in-transaction check of the deposit actually taken |

The swap path and every quote function call the same internal function, `_depositFor`, so within one block a quote and an execution cannot disagree.

## 12.1 previewDeposit

```solidity
struct DepositQuote {
    bool flaggedNow;           // the swap would post a deposit in this block
    bool exempt;               // the licence fast path would apply to `swapper`
    uint8 mode;                // CONTINUOUS or CLOSED
    uint16 rateBps;            // deposit as a share of notional, if flagged
    uint8 triggers;            // bitmask: FIRST_TOUCH | FLOW | DRIFT | CLOSED
    uint256 depositIfFlagged;  // quote units, whatever the trigger state
    uint256 depositNow;        // quote units, 0 unless flaggedNow
    uint64 settleAfter;        // t0
    uint64 expiresAt;          // t0 + W, or t0 + W_c
}

/// @notice The deposit a swap of `notionalQuote` would post if it executed in this block.
function previewDeposit(PoolKey calldata key, bool zeroForOne, uint256 notionalQuote, address swapper)
    external view returns (DepositQuote memory);
```

`depositNow` is exact for the current block. It turns wrong only if another swap lands first in the same block, or if the swap lands in a later block where the first touch is fresh. A router that cannot control which block it lands in should plan with `depositIfFlagged`, which ignores the trigger state.

## 12.2 URC-4 quotes

URC-4 (Active Liquidity Framework Hook Interface, in Discussion since 11 June 2026) defines `IALFHook`, a router-facing quoting interface. Touchstone implements it as thin forwarders from the hook to an immutable `TouchstoneLens`, which keeps the hook under the 24 KB size limit.

| Function | Touchstone's answer |
| --- | --- |
| `getIndicativeQuote(key, zeroForOne, amountSpecified, hookData)` | Exact input: expected output minus the deposit the swap would post now. Exact output: expected input plus that deposit. 0 when it cannot price. |
| `swapToPrice(key, zeroForOne, amountSpecified, sqrtPriceLimitX96, hookData)` | The same, stopping at the price limit |
| `isLive()` | `true`. Execution never waits on an oracle; only settlement does, and settlement delays never change what a swap pays at the time |
| `maxGas()` | The measured worst case of `getIndicativeQuote`, recorded in `docs/gas.md` (*target:* 300k) |

The AMM part comes from `StaticQuoteLib`, a view-only port of v4-core's swap loop. It reads ticks and bitmaps through `StateLibrary`, applies the protocol fee the way `Pool.swap` does, and returns 0 when a quote would cross more than `maxQuoteTicks` initialized ticks, as URC-4 asks of a hook that cannot price. It is tested against `V4Quoter` on forks (E12). Malformed `hookData` reverts with URC-4's `MalformedHookData`, and the hook answers ERC-165 for `type(IALFHook).interfaceId`.

In July 2026 a URC-4 co-author agreed to drop the `view` requirement in favour of quoting through `eth_call`. Touchstone's functions are views, which work either way. The repository pins the draft text it implements.

## 12.3 URC-2 HookSwap

URC-2 (Custom Accounting Hook Swap Event, in Discussion) says a hook must emit exactly one `HookSwap` for each successful swap in which it contributes a token delta, fee-only hooks included.

```solidity
event HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee);
```

- Emitted from `afterSwap` for every swap that posts a deposit, and for no other swap.
- The deposit is −D on the unspecified currency and 0 on the other. URC-2 signs amounts from the swapper's side, and the swapper pays the deposit whether the swap is exact input or exact output.
- `swapFee` is 0, because a refundable deposit has no single pips rate.
- Indexers add `HookSwap` to the core `Swap` to get what the swapper paid at the time. The refund arrives later, in `Settled` or `Expired`.

## 12.4 GuardedRouter

```solidity
struct Guard {
    uint256 maxDeposit;   // most the trader lets the hook hold, in the deposit currency
    uint256 minNetOut;    // exact input: least received now; exact output: unused
    uint256 minGrossOut;  // exact input: least of received now plus the deposit
    uint256 maxNetIn;     // exact output: most paid now, deposit included
}

function swapGuarded(PoolKey calldata key, SwapParams calldata params, Guard calldata guard,
    address rebateTo, uint256 deadline) external payable returns (BalanceDelta delta, uint256 deposit);
```

1. Unlock the PoolManager and swap with `hookData = abi.encode(msg.sender, rebateTo)`.
2. Read `hook.lastDeposit(poolId)`. The hook writes it to transient storage in `afterSwap` and clears it in `beforeSwap`, so a view call in the same transaction sees exactly this swap's deposit.
3. Require deposit ≤ `maxDeposit`, plus the limit that applies: `minNetOut` and `minGrossOut` for exact input, `maxNetIn` for exact output. Otherwise revert `Touchstone__GuardFailed`.
4. Settle the input and take the output to the trader.

The gross limit lets a trader accept a lower immediate output, because the deposit comes back, while capping how much the hook may hold. `GuardedRouter` implements `IMsgSender` and returns the trader for the length of the lock. It is one of the hook's trusted routers, so refunds name the trader even without `hookData`. v2.0 guards single-pool swaps only.

Universal Router users still get refunds, through the `Dispatcher`'s `msgSender`, and `V4Quoter` simulations include the deposit for the current block. They get no in-transaction deposit check beyond their own minimum output.

## 12.5 Allowlist requirements

Uniswap's routing allowlist rejects upgradeable proxies, hooks that need custom calldata, and hooks that modify or bypass the protocol fee. Touchstone is immutable and verified, and its `hookData` is optional. Donations skip the v4 protocol fee, so each pool can route `protocolShareBps` of retained value and rent to `protocolRecipient`, credited in the ledger for that address to claim. That reading of the rule is mine; the team confirms it with the allowlist maintainers before the guarded launch. Because the recipient is fixed per pool, a change of recipient by governance applies to pools created afterwards.

---

# §13 Interfaces, types, errors and events

This is the complete external surface of v2.0. Every external and public member carries full NatSpec in the code; the comments here are short. Types come from v4-core (`PoolKey`, `PoolId`, `Currency`, `BalanceDelta`, `SwapParams`). `PoolState` is in §7, `Lease` in §10, `DepositQuote` and `Guard` in §12, and `IMarketCalendar` in §9.

## 13.1 Types

```solidity
/// Fixed at registration. Slots 0–2 are read on the swap path.
/// slot 0: n0 (96) | nMin (96) | flowHorizon (32) | flags (8) | tauBps (16)
/// slot 1: reference (160) | referenceMaxAge (32) | deltaBps (16) | deltaMaxBps (16) | betaX100 (16)
/// slot 2: calendar (160) | calendarValidUntil (40) | deltaClosedBps (16) | maxConfBps (16) | bandBps (16)
/// slot 3: basePriceId (256)    slot 4: quotePriceId (256)
/// slot 5: settleDelay | maxLag | window | openDelay | maxLagClosed | windowClosed (6 x 32)
///         | decimals0 (8) | decimals1 (8) | alphaBps (16) | epsBps (16)
/// slot 6: alphaLicensedBps | alphaClosedBps | epsClosedBps | jumpRefundBps | tipBps | rhoBps | kappaBps (7 x 16)
///         | vestPeriod (32)
/// slot 7: tipCap (128) | maxOutstanding (128)
/// slot 8: protocolRecipient (160) | protocolShareBps (16)
struct PoolConfig {
    uint96 n0;                 // quote units; below this, only the flow trigger applies
    uint96 nMin;               // flow bucket threshold, quote units
    uint32 flowHorizon;        // seconds for a full bucket to drain
    uint8 flags;               // QUOTE_IS_0 = 1, LICENCE = 2, ITM_ACCOUNTING = 4
    uint16 tauBps;             // drift trigger
    address reference;         // Chainlink aggregator; zero turns the drift trigger off
    uint32 referenceMaxAge;
    uint16 deltaBps;
    uint16 deltaMaxBps;
    uint16 betaX100;           // 125 means 1.25
    address calendar;          // zero for crypto pools
    uint40 calendarValidUntil; // copied from the calendar at registration
    uint16 deltaClosedBps;
    uint16 maxConfBps;
    uint16 bandBps;            // G
    bytes32 basePriceId;       // Pyth
    bytes32 quotePriceId;
    uint32 settleDelay;        // Δ
    uint32 maxLag;
    uint32 window;             // W
    uint32 openDelay;
    uint32 maxLagClosed;
    uint32 windowClosed;       // W_c
    uint8 decimals0;
    uint8 decimals1;
    uint16 alphaBps;
    uint16 epsBps;
    uint16 alphaLicensedBps;
    uint16 alphaClosedBps;
    uint16 epsClosedBps;
    uint16 jumpRefundBps;
    uint16 tipBps;
    uint16 rhoBps;
    uint16 kappaBps;
    uint32 vestPeriod;
    uint128 tipCap;            // quote units
    uint128 maxOutstanding;    // quote units; no new deposits above it (§18)
    address protocolRecipient; // fee recipient for the protocol share (§12)
    uint16 protocolShareBps;   // share of retained value and rent; 0 where no protocol fee applies
}

/// Passed as calldata and committed by hash; never stored whole.
struct Record {
    PoolId poolId;
    uint64 id;
    uint40 timestamp;
    uint8 mode;                // 0 continuous, 1 closure
    bool licenceActive;
    bool byHolder;
    bool zeroForOne;
    bool depositIn0;           // deposit currency is currency0
    address sender;            // caller of PoolManager.swap
    address beneficiary;
    address rebateTo;
    uint128 deposit;
    int128 amount0;            // AMM delta, swapper's side
    int128 amount1;
    uint160 sqrtPriceBeforeX96;
    uint160 sqrtPriceAfterX96;
    uint128 liquidityBefore;
}

/// Built by the Settler; checked for conservation by the hook.
struct Payout {
    bool benign;               // true: rebate path, nothing retained
    uint128 refund;            // to the beneficiary
    uint128 tip;               // to tipTo; from R, or from the rebate pool if benign
    uint128 toProtocol;        // share of R, credited to protocolRecipient
    uint128 toRebatePool;      // share of R
    uint128 toLPs;             // share of R, vested
    uint128 rebate;            // from the rebate pool to rebateTo
    address tipTo;
}
```

The hook rejects a payout unless, in the deposit currency, refund + tip + toProtocol + toRebatePool + toLPs = deposit and rebate = 0 (not benign), or refund = deposit, toProtocol = toRebatePool = toLPs = 0 and tip + rebate ≤ the rebate pool (benign). An expiry is a non-benign payout with refund = deposit.

## 13.2 TouchstoneHook

```solidity
interface ITouchstoneHook is IALFHook {
    function register(PoolKey calldata key, PoolConfig calldata cfg) external;            // factory only
    function finalize(Record calldata record, Payout calldata payout, bool expired) external; // settler only
    function creditRent(PoolKey calldata key, uint256 amount) external;                   // licence only
    function drip(PoolKey calldata key) external returns (uint256 amount0, uint256 amount1);

    function recordHash(PoolId id, uint64 recordId) external view returns (bytes32);
    function poolConfig(PoolId id) external view returns (PoolConfig memory);
    function poolState(PoolId id) external view returns (PoolState memory);
    function lastDeposit(PoolId id) external view returns (uint256 amount, uint64 recordId); // transient
    function previewDeposit(PoolKey calldata key, bool zeroForOne, uint256 notionalQuote, address swapper)
        external view returns (DepositQuote memory);
}
```

The hook also implements `IUnlockCallback` for its own unlocks (finalize, rent and drip), accepting calls from the PoolManager only, and ERC-165.

## 13.3 URC-4

Copied from the draft's reference implementation, which extends `IERC165`; the spec's own block does not. The two errors keep URC-4's names, the only exception to the `Touchstone__` prefix rule.

```solidity
interface IALFHook is IERC165 {
    error MissingHookData();
    error MalformedHookData();

    function getIndicativeQuote(PoolKey calldata key, bool zeroForOne, int256 amountSpecified,
        bytes calldata hookData) external view returns (uint256 quoteAmount);
    function isLive() external view returns (bool);
    function maxGas() external view returns (uint32);
    function swapToPrice(PoolKey calldata key, bool zeroForOne, int256 amountSpecified,
        uint160 sqrtPriceLimitX96, bytes calldata hookData) external view returns (uint256 amountIn, uint256 amountOut);
}
```

## 13.4 Settler

```solidity
interface ISettler {
    /// @notice Settle against the first Pyth update at or after t0. Excess msg.value is returned.
    function settle(Record calldata record, bytes[] calldata pythUpdate) external payable returns (Payout memory);

    /// @notice Refund in full once t0 + W (or W_c) has passed. Pays no tip.
    function expire(Record calldata record) external;

    function settleTime(Record calldata record) external view returns (uint256 t0, uint256 latest, uint256 expiresAt);
}
```

Keepers price a settlement by `eth_call` to `settle` before sending it.

## 13.5 LicenceAuction

```solidity
interface ILicenceAuction {
    struct LeaseParams { uint32 k; uint16 minIncrementBps; uint128 minRent; }

    function register(PoolKey calldata key, LeaseParams calldata params) external;          // factory only
    function bid(PoolId id, address swapper, uint128 rent, uint128 deposit) external;
    function topUp(PoolId id, uint128 amount, bool isTop) external;
    function withdraw(PoolId id, uint128 amount, bool isTop, address to) external;
    function setSwapper(PoolId id, address swapper, bool isTop) external;
    function accrue(PoolId id) external returns (uint256 rentCharged);
    function claimRefund(Currency currency, address to) external returns (uint256 amount);

    function holderOf(PoolId id) external view returns (address swapper, bool live);
    function leases(PoolId id) external view returns (Lease memory top, Lease memory next);
    function minNextRent(PoolId id) external view returns (uint128);
}
```

## 13.6 RebateLedger

```solidity
interface IRebateLedger {
    enum Kind { REBATE, DEFERRED_REFUND, PROTOCOL }

    function credit(address recipient, Currency currency, uint256 amount, Kind kind) external; // hook only
    function owed(address recipient, Currency currency) external view returns (uint256);
    function claim(Currency currency, address to) external returns (uint256 amount);          // underlying
    function claimAsClaims(Currency currency, address to) external returns (uint256 amount);  // ERC-6909
    function push(address recipient, Currency currency) external returns (uint256 amount);
}
```

## 13.7 Factory and router

```solidity
interface ITouchstoneFactory {
    /// @notice Validate bounds (§14), register with the hook and the auction, then initialize.
    function createPool(PoolKey calldata key, PoolConfig calldata cfg,
        ILicenceAuction.LeaseParams calldata lease, uint160 sqrtPriceX96) external returns (PoolId id);
}

interface IGuardedRouter is IMsgSender {
    function swapGuarded(PoolKey calldata key, SwapParams calldata params, Guard calldata guard,
        address rebateTo, uint256 deadline) external payable returns (BalanceDelta delta, uint256 deposit);
}
```

`createPool` requires `key.hooks` to be the hook and a static fee, reads token decimals (18 for native ETH), and copies the calendar's `validUntil`.

## 13.8 Errors

```solidity
interface ITouchstoneErrors {
    error Touchstone__NotFactory();
    error Touchstone__NotSettler();
    error Touchstone__NotLicence();
    error Touchstone__PoolNotRegistered(PoolId id);
    error Touchstone__ConfigOutOfBounds(uint8 field);
    error Touchstone__DynamicFeeNotSupported();
    error Touchstone__RecordClosed(PoolId id, uint64 recordId);
    error Touchstone__TooEarly(uint256 t0);
    error Touchstone__NotExpired(uint256 expiresAt);
    error Touchstone__PayoutMismatch();
    error Touchstone__GuardFailed(uint8 which);
    error Touchstone__DeadlinePassed();
    error Touchstone__LicenceDisabled(PoolId id);
    error Touchstone__BidTooLow(uint128 minimum);
    error Touchstone__DepositBelowNotice(uint256 minimum);
    error Touchstone__NotLeaseOwner();
    error Touchstone__QuoteNotErc20();
    error Touchstone__NothingToClaim();
    // Raised by the math libraries (D-16).
    error Touchstone__NonPositivePrice();
    error Touchstone__ExponentOutOfRange(int256 exponent);
    error Touchstone__RetainedAboveDeposit(uint256 retained, uint256 deposit);
    error Touchstone__ZeroHorizon();
}
```

## 13.9 Events

```solidity
interface ITouchstoneEvents {
    // hook; Settled and Expired are emitted by the Settler (D-18)
    event PoolRegistered(PoolId indexed id, PoolConfig cfg);
    event DepositTaken(PoolId indexed id, uint64 indexed recordId, Record record);
    event LicensedSwap(PoolId indexed id, address indexed swapper, int128 amount0, int128 amount1);
    event Settled(PoolId indexed id, uint64 indexed recordId, int256 markout, uint256 fairPriceX36,
        uint16 alphaBps, Payout payout);
    event Expired(PoolId indexed id, uint64 indexed recordId, uint256 refund);
    event RefundDeferred(PoolId indexed id, uint64 indexed recordId, address beneficiary, uint256 amount);
    event RentCredited(PoolId indexed id, uint256 amount, uint256 toRebatePool, uint256 toVesting);
    event Dripped(PoolId indexed id, uint256 amount0, uint256 amount1);
    event RebateCredited(PoolId indexed id, uint64 indexed recordId, address indexed recipient,
        Currency currency, uint256 amount);
    event HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee); // URC-2
    event HookBonus(bytes32 indexed id, uint128 amount0, uint128 amount1);   // UF hook data guide, 2025

    // LicenceAuction
    event BidPlaced(PoolId indexed id, address indexed owner, address swapper, uint128 rent,
        uint128 deposit, uint40 activatesAt);
    event LeaseActivated(PoolId indexed id, address indexed owner, address swapper, uint128 rent);
    event LeaseLapsed(PoolId indexed id, address indexed owner, uint40 at);
    event RentCharged(PoolId indexed id, uint256 amount);
    event SwapperSet(PoolId indexed id, bool isTop, address swapper);
    event DepositChanged(PoolId indexed id, bool isTop, uint128 deposit);
    event RefundClaimed(address indexed owner, Currency currency, address to, uint256 amount);

    // RebateLedger
    event Credited(address indexed recipient, Currency currency, uint256 amount, IRebateLedger.Kind kind);
    event Claimed(address indexed recipient, Currency currency, address to, uint256 amount);
}
```

`Settled` and `Expired` are emitted by the Settler, which alone knows the markout, fair price and α (D-18); every other event in the hook group is emitted by the hook. `DepositTaken` carries the whole record, so a keeper never needs storage reads to settle. `Settled` carries the markout, the fair price and the α used, so anyone can recompute the split from events alone.

---

# §14 Parameters

Every value below is fixed per pool when the factory creates it, and no one can change it afterwards. Defaults are starting points for a USDC-quoted ETH pool with a 5 bp fee; dollar amounts are written in quote-token units in the config. Each chain's values live in `script/config/<chain>.json`, never in contract code. The research pipeline sets each one on development windows only (§16), and held-out results never retune them.

## 14.1 Triggers and deposits

| Field | Symbol | Default | Factory bounds | Set by |
| --- | --- | --- | --- | --- |
| `n0` | N₀ | $5,000 | 0 < N₀ ≤ N\_min | E1 |
| `nMin` | N\_min | $100,000 | N\_min ≥ N₀ | E1, E5 |
| `flowHorizon` | h | 12 s | 1 s to 3,600 s | E5 |
| `tauBps` | τ | 5 bps | 1 to 100 bps | E1 |
| `reference` | — | Chainlink Standard proxy | Zero turns the drift trigger off | Deploy config |
| `referenceMaxAge` | — | Feed heartbeat + 10% | 60 s to 90,000 s | Feed docs |
| `deltaBps` | δ | 30 bps | 5 to 500 bps | E3 |
| `deltaMaxBps` | δ\_max | 300 bps | δ to 2,000 bps | E3 |
| `betaX100` | β | 1.25 | 1.00 to 4.00 | E3 |
| `deltaClosedBps` | δ\_c | 300 bps | δ to 2,000 bps | E9 |
| `bandBps` | G | 25 bps | 5 to 500 bps | E10 |
| maxOutstanding | — | Small at launch; later pools raise it as evidence builds | Non-zero | §18 |

## 14.2 Settlement

| Field | Symbol | Default | Factory bounds | Set by |
| --- | --- | --- | --- | --- |
| `basePriceId`, `quotePriceId` | — | Pyth IDs for the base and USDC | Non-zero | Deploy config |
| `settleDelay` | Δ | 3 s | 1 to 60 s | E4 |
| `maxLag` | — | 10 s | 1 s, and below W | E4 |
| `window` | W | 24 h | 1 h to 7 days | Ops |
| `openDelay` | — | 60 s | 0 to 3,600 s | E9 |
| `maxLagClosed` | — | 1 h | 60 s, and below W\_c | E9 |
| `windowClosed` | W\_c | 24 h | 1 h to 7 days | Ops |
| `maxConfBps` | — | 25 bps | 1 to 200 bps | E4 |
| `alphaBps` | α | 0.80 | 0.10 to 0.95 | E3, E6 |
| `epsBps` | ε | 2 bps, the measured cost c | 0 to 50 bps | E6 |
| `alphaLicensedBps` | α\_lic | 0.95 | α to 0.99 | E10 |
| `alphaClosedBps` | α\_c | 0.50 | 0.10 to α | E9 |
| `epsClosedBps` | ε\_c | 50 bps | ε to 500 bps | E9 |
| `jumpRefundBps` | J | 25% | 5% to 90% | E9 |
| `ITM_ACCOUNTING` flag | — | On | — | E5, E6 |

## 14.3 Payouts and rebates

| Field | Symbol | Default | Factory bounds | Set by |
| --- | --- | --- | --- | --- |
| `tipBps` | — | 2% | 0 to 20% | Keeper economics |
| `tipCap` | — | $5 on L2s, $25 on Ethereum | Non-zero | Gas at deployment |
| `rhoBps` | ρ | 10% | 0 to 30% | E11 |
| `kappaBps` | κ | 40% | 0 to 90% | E11 |
| `vestPeriod` | — | 30 min | 60 s to 24 h | E3 |
| protocolShareBps | — | The protocol's share of the pool's swap fee at creation; 0 where no protocol fee applies | 0 to 50% | Allowlist review |
| protocolRecipient | — | The fee recipient Uniswap governance designates on that chain | Non-zero when the share is | Deploy config |

## 14.4 Licence

| Field | Symbol | Default | Factory bounds | Set by |
| --- | --- | --- | --- | --- |
| `LICENCE` flag | — | Off until E10 passes | Needs an ERC-20 quote token | E10 |
| `k` | K | 3,600 s (60 s on testnet) | 60 s to 7 days | E10 |
| `minIncrementBps` | — | 10% | 1% to 50% | am-AMM default |
| `minRent` | — | Per pool | Non-zero | E10 |

## 14.5 Cross-field rules

The factory reverts with `Touchstone__ConfigOutOfBounds(field)` unless all of these hold:

- α\_c ≤ α ≤ α\_lic < 1, so the entry condition of §8 holds in every regime.
- ε ≤ ε\_c, and δ ≤ min(δ\_max, δ\_c).
- κ < 1, so wash trades lose (§11).
- maxLag < W and maxLagClosed < W\_c.
- On calendar pools, Δ + maxLag is shorter than the shortest session, and `calendarValidUntil` is at least 30 days away.
- The fee is static, and `key.hooks` is the hook.

## 14.6 Deploy-time immutables

| Contract | Immutables |
| --- | --- |
| `TouchstoneHook` | `POOL_MANAGER`, `SETTLER`, `LICENCE`, `LEDGER`, `FACTORY`, `LENS`, `TRUSTED_ROUTER_0`…`_3`, `BLOCK_SOURCE` (EVM or ArbSys) |
| `Settler` | `PYTH`, `HOOK` |
| `LicenceAuction` | `HOOK`, `FACTORY` |
| `RebateLedger` | `POOL_MANAGER`, `HOOK` |
| `TouchstoneLens` | `POOL_MANAGER`, `HOOK`, `MAX_QUOTE_TICKS` (default 64) |
| `GuardedRouter` | `POOL_MANAGER`, `HOOK` |
| TouchstoneFactory | POOL\_MANAGER, HOOK, LICENCE |

The hook and the contracts around it point at each other, so `CREATE2` alone cannot predict both sides. The deploy script predicts the Settler, auction, ledger, lens, factory and router addresses from the deployer's nonces, which do not depend on init code. It then mines the hook's `CREATE2` salt with those addresses in the hook's init code, deploys the six contracts with the hook's predicted address, and deploys the hook last (§19).

---

# §15 Off-chain services

Nothing off-chain is trusted. If the team's keeper stops, anyone can settle, and a record that nobody settles refunds itself at expiry. The services make the system fast and visible, not correct.

## 15.1 Keeper

`keeper/`, TypeScript and viem. One process per chain.

1. **Ingest.** Watch `DepositTaken`, and backfill from the indexer on restart. The event carries the whole record.
2. **Schedule.** Read t₀, the latest usable time and the expiry from `Settler.settleTime(record)`, so the keeper never recomputes calendar rules.
3. **Fetch.** Shortly after t₀, ask Hermes's timestamp endpoint for each feed, which returns the first update whose publish time is at or after the given value. Fetch the base and quote feeds separately, since their first updates can sit in different blobs, and check each publish time locally before sending. Hermes needs an API key.
4. **Price the call.** `eth_call` to `settle` with `getUpdateFee(update)` as value returns the payout, and so the tip. Send when the tip covers gas with a margin. The team's keeper also settles unprofitable records that retain value for LPs (`settleAtLoss`, on by default) and benign ones whose rebate pool is empty.
5. **Retry, then expire.** If Hermes lags, retry until the latest usable time. After that the record can only expire: call `expire` once its expiry passes. Expiry pays no tip, so this is a service to traders, and it is cheap on L2s.
6. **Batch.** Group settlements through Multicall3's `aggregate3Value`, which forwards value per call. A lost race costs one reverted call (`Touchstone__RecordClosed`), not a failed batch.
7. **Housekeeping.** Call `LicenceAuction.accrue` every few minutes on licence pools, `drip` about ten times per `vestPeriod`, and `RebateLedger.push` for routers that ask.

The keeper key is a dedicated hot key with a small balance, loaded from the environment and never committed.

## 15.2 Indexer

`indexer/`, TypeScript with SQLite for development and Postgres in production. It reads every Touchstone event plus the PoolManager's `Swap`, `ModifyLiquidity` and `Donate` events for Touchstone pools. Rows are keyed by (chain, transaction hash, log index) and written idempotently, and each chain has a confirmation depth for reorgs.

Derived tables:

- records: open, settled, expired, deferred refund;
- per pool and day: volume, flag share φ, retained R, rent, rebates, tips, settlement lag and expiries;
- LP net estimate: fees plus retained value and rent, minus markout losses at the 15 s horizon used in §16;
- retail effective fee and freshness, as defined in the report.

## 15.3 Dashboard

`dashboard/`, Next.js, read-only, with no wallet connection.

| Page | Shows |
| --- | --- |
| Pool | LP net next to a static-fee counterfactual, labelled as an estimate |
| Record explorer | Each record's swap, deposit, settlement price, markout, α and split, linked to its transactions |
| Licence | Current holder, rent, pending bid, activation time, rent paid to date |
| Rebates | Credits and claims by recipient |
| Keeper health | Settlement lag distribution, expiries, deferred refunds |

## 15.4 Demo bots

On testnets the pool holds test tokens, but Pyth publishes real prices there, so a test ETH/USDC pool can track the real ETH price, and bots can arbitrage it against Hermes. Every bot takes a seed, and every chart they produce is labelled testnet demonstration.

| Bot | Shows |
| --- | --- |
| Retail | Swaps below N₀ pay nothing extra; large benign swaps get their deposit back with a rebate |
| Outsider arbitrageur | Part of its deposit stays with LPs |
| Licence holder | Bids, waits K, then arbitrages as the block's first touch with no deposit |
| Sandwicher | Its back-run is clawed back, so the sandwich loses money |
| Splitter | Splitting under N₀ fills the flow bucket and gets flagged |
| Router | Routes benign flow through `GuardedRouter`, names itself as `rebateTo`, then claims |

## 15.5 Intents path, optional

A UniswapX filler that fills orders through Touchstone pools with `GuardedRouter` and names itself as `rebateTo`. It shows that rebates pay intent fillers for benign flow the same way they pay routers. It comes after the core work, runs on a fork of a chain where UniswapX's reactor is deployed (addresses confirmed on day 1), and stays off by default.

## 15.6 Alerts

- 95th-percentile settlement lag above Δ + 30 s;
- any expiry of a record that would have retained value;
- any deferred refund;
- keeper balance below a day of gas;
- Hermes errors above 1% of requests;
- a lease lapsing, or a pending bid about to activate.

---

# §16 Research pipeline

The research decides whether Touchstone deserves to exist. Each experiment is pre-registered, has a pass or kill line, and is labelled as a historical backtest, a simulation or a testnet demonstration. The thresholds below are the ones in the report; E10 to E12 are new in v2.

## 16.1 Two replay engines

| Engine | Location | Use |
| --- | --- | --- |
| Fast replay | `research/replay/`, Python | Markouts, triggers and splits over months of swap logs in minutes; every experiment's first pass |
| Bytecode replay | `sim/`, Rust and revm, adapted from VANE | Runs the compiled hook against historical swap sequences, so gas and accounting come from the contract, not from a model; confirms E3 and E8 |

E1 to E3 can start on Assay's calibration pipeline, which already pulls swap logs over RPC and Binance 1-second klines as the reference. That makes the first kill decision a matter of days.

## 16.2 Data

| Source | Used for | Constraint |
| --- | --- | --- |
| Swap and liquidity logs over RPC, Ethereum, Arbitrum and Base | Every backtest | Archive access and rate limits |
| Binance 1-second klines | Reference for E1, E2 and E5; the basis comparison in E4 | Public files; mid-price proxy only |
| Pyth historical updates, from Hermes's timestamp endpoint | Settlement prices in E3, E4 and E9 | API key; request limits. History after the August 2026 Pythnet sunset is unverified, so E4 falls back to live collection if it is missing |
| Chainlink `AnswerUpdated` logs | The drift trigger's reference as it stood at each swap | Includes each feed's real staleness |
| Robinhood Chain stock-token pools since 1 July 2026 | E9 | About 15 weekends; issuer controls and the HIMS squeeze distort some of them |

## 16.3 Metrics

The report defines toxic markout, recall r, flag share φ, LP net (at the 15 s horizon of the Uniswap Labs and Columbia paper, for comparability), retail effective fee, freshness, arbitrage participation and gas. v2 adds four:

- **Licence income:** rent per day, holder win rate, and outsider clawback, against the plain clawback on the same tape.
- **Rebate cost and coverage:** rebates owed, the share the pool could fund, and wash-strategy profit.
- **Noise tax:** expected clawback on benign closure trades.
- **Quote gap:** how often a quote and its execution differ, and by how much.

## 16.4 Experiments

| # | Experiment | Label | Question | Pass or kill |
| --- | --- | --- | --- | --- |
| E1 | Markout census | Backtest | Where does toxic markout sit: by block position, size, signed drift? | Descriptive. Sets N₀, N\_min, h and τ on development windows only |
| E2 | Trigger recall | Backtest | Does the trigger reach the pool's break-even recall r\* = (L − F) / (α(L − (F + ε)s)), about 0.45 at the report's averages? | Kill if held-out recall is below break-even at φ ≤ 0.30 |
| E3 | Settlement replay | Backtest | LP net, retail fee, refunds against retentions, and how often the cap binds | Pass if the cap binds on under 5% of toxic markout and the retail fee stays within 0.1 bp of f |
| E4 | Oracle basis | Backtest, then live collection | How far do Pyth-settled markouts sit from Binance ones at Δ = 2 to 12 s? | Kill if the median gap exceeds ε/2 |
| E5 | Evasion | Simulation | Recall when arbitrageurs split under N₀ or N\_min, spread across blocks, switch to exact output, or pad into the margin | Kill if recall under evasion falls below r\* |
| E6 | Freshness | Simulation | Do entry and trade size match a plain pool when ε = c, and how much padding appears when ε > c? | Kill if mean \|pool − P\*\| rises more than 10% over the static fee |
| E7 | Baselines | Backtest and simulation | Static 5 bp; VolatilePair from its spec; the Assay or SkewHook oracle gap; a Detox-style tax at swap time; Hindsight-style settlement against the pool's own TWAP; a LodeHook-style first-swap premium; perfect clawback as the ceiling | Touchstone must beat static on LP net and match it on retail fee and freshness |
| E8 | Engineering | Testnet and fuzzing | Gas and every invariant in §17, end to end with real Pyth updates | Every invariant holds; gas within targets, with 20k as the pass line for an unflagged swap |
| E9 | Weekend replay | Backtest | Do closure-time markouts against the reopen carry information, and what is the noise tax on benign closure trades? | Drop closed-market mode if the markouts look like noise, or if the tax exceeds what the clawback recovers |
| E10 | Licence | Simulation, then testnet | LP income under the plain clawback, one bidder at the reserve, and two or more bidders; holder win rate in a first-come-first-served race; freshness with an idle holder | Keep the licence off unless two bidders beat the plain clawback by at least 10% and one bidder at the reserve does no worse; kill if an idle holder lets mean \|pool − P\*\| exceed G plus the fee band |
| E11 | Rebates | Backtest and simulation | Rebate cost and coverage at the chosen ρ and κ; profit of pure wash, LP self-wash at measured concentration, and split-arbitrage farming | Kill rebates on any pool where a wash strategy profits at its κ |
| E12 | Quote integrity | Fork test | Does `depositNow` equal the executed deposit in the same block state? Does `getIndicativeQuote` match `V4Quoter`? Does `depositIfFlagged` bound the next block's deposit? | Any mismatch in the first two is a bug and blocks release; the bound must hold on at least 99% of sampled swaps |

## 16.5 The licence simulation

E10 needs a model of the race, because history cannot show a licence that never existed.

1. Drive prices from Binance 1-second tapes, so volatility clusters as it really does.
2. After each move, each arbitrageur arrives after a latency drawn from its own distribution, and pays gas plus a hedging cost c. The first arrival trades, as on a first-come-first-served chain.
3. The holder keeps its full markout inside the band. Outsiders keep ε·N plus (1 − α\_lic) of the excess. Outside the band, everyone faces α.
4. Each bidder's value is its simulated profit as holder, less its profit as an outsider. With two or more bidders, rent is set at the second-highest value, which is where a continuous English auction ends up; with one, rent is the reserve.
5. Compare LP income with the plain clawback on the same paths, and repeat with the holder switched off to measure the band backstop.

The simulation is labelled as one. Its latency and cost distributions are inputs, so the result is reported as a function of them, not as a single number.

## 16.6 Pre-registration

Every experiment has a file in `research/prereg/`, committed before it runs. It names the hypothesis, the development and held-out windows, the metrics, the pass or kill line, and the hash of the analysis code. Changing any of them after a run means a new file and a new name, and both results are reported.

## 16.7 Discipline

- Split by time only, and report every window, failures included.
- Confidence intervals come from a block bootstrap over days.
- One parameter set per chain, chosen on development windows and never retuned on held-out data.
- A backtest holds flow fixed. Behaviour responds only in E5, E6, E10 and E11, which are labelled simulations.
- The VolatilePair baseline is our reading of its published spec, not Labs' code path, and is labelled that way.
- Testnet flow says nothing about LP returns. Demos show mechanics only.

---

# §17 Testing

Tests live in `test/`, split by kind. Mocks live only in `test/mocks/` and are named `Mock*`. A change is done when every suite below passes, coverage holds, and the gas snapshot has not regressed.

| Suite | Folder | Runs | What it proves |
| --- | --- | --- | --- |
| Unit | `unit/` | Every push | Each function in both swap directions, exact input and exact output, native and ERC-20, quote as currency0 and currency1, token decimals 6, 8 and 18 |
| Invariant | `invariant/` | Every push: 256 runs × 500 calls. Nightly: 10,000 × 1,000 | The properties below, under random sequences of swaps, liquidity changes, bids, settlements, expiries, drips and claims |
| Fuzz | `fuzz/` | Every push | Math and edge cases against reference implementations |
| Differential | `differential/` | Every push | The contract against independent implementations |
| Fork | `fork/` | Nightly and before release | Real deployments on Arbitrum Sepolia and Base Sepolia, with recorded Hermes updates as fixtures so runs are reproducible offline |
| Gas | `gas/` | Every push | Snapshots per path; CI fails on a regression above 5% |

## 17.1 Invariants

| # | Property |
| --- | --- |
| I1 | For each currency, the hook's ERC-6909 balance equals outstanding + vest + rebate pool |
| I2 | The ledger's ERC-6909 balance covers everything it owes, per currency |
| I3 | For every settled record: refund + R = D, R ≤ D, and tip + toProtocol + toRebatePool + toLPs = R |
| I4 | R ≤ α\_regime · max(0, m⁺ − ε\_eff·N⁺), recomputed independently by the test |
| I5 | Each record settles or expires exactly once, and its hash is deleted afterwards |
| I6 | An expired record refunds D and pays no tip and no rebate |
| I7 | A rebate is paid only when R = 0 and m ≤ 0, never exceeds κ·f·N, and total rebates never exceed total inflows to the rebate pool |
| I8 | A swap with no record leaves the swapper's delta identical to a hookless twin pool's |
| I9 | The hook never makes a liquidity change revert |
| I10 | No swap reverts because of the reference, the calendar or the licence; a failed read means no deposit or no exemption |
| I11 | At most one exempt swap per pool per block, and it is the holder's first touch |
| I12 | Auction balance = Σ top deposits + Σ next deposits + Σ refunds, and rent charged = rent credited to the hook |
| I13 | Rent charged never exceeds rent × seconds active |
| I14 | Donations never exceed vested amounts, and total donated = Σ toLPs + the vested share of rent |
| I15 | A refund reaches its beneficiary or the ledger in the beneficiary's name, and no one else |
| I16 | No external entry point can be re-entered during `finalize`, `creditRent` or `drip` (transient lock) |
| I17 | Outside `creditRent`, the hook holds no ERC-20 balance |

A failed reference or licence read is caught with `try`/`catch` and treated as stale or not live. A failed calendar read means no deposit, so a trader is never charged a deposit that cannot settle.

## 17.2 Fuzz and differential targets

| Target | Reference |
| --- | --- |
| `MarkoutLib`: markout, fair-price conversion over Pyth exponents and token decimals | A Python implementation with exact rational arithmetic, called through FFI |
| In-the-money split | An exact tick-by-tick replay in the research package |
| `StaticQuoteLib` | `V4Quoter` on forks, within one wei for swaps under `MAX_QUOTE_TICKS` (E12) |
| `NyseCalendar` | The `exchange_calendars` Python package's XNYS calendar, minute by minute across the covered years, including daylight-saving switches, holidays and early closes |
| `Settler` payouts | The research replay's split, on the same records, so the contract and the backtest cannot drift apart |
| Triggers | Block boundaries, bucket draining, first touch across transactions, ArbSys block numbers |
| Lease state machine | A Python model of §10's table, step by step |

## 17.3 Adversarial tests

Each attack in §18 has a proof-of-concept test that must fail to profit: sandwiches with and without a licence, the colluding pair, splitting under N₀, padding past P\*, JIT liquidity around `drip`, wash trading for rebates, LP self-wash, griefing bids, and settlement with a stale or chosen Pyth update. Tokens with transfer callbacks are covered by the reentrancy tests. Fee-on-transfer tokens are unsupported, and the README says so.

## 17.4 Static analysis and coverage

`slither` runs on every push, and every finding is fixed or triaged in `docs/decisions/`. `forge coverage` must stay at or above 95% of lines and branches in `src/`. Mutation testing with a Solidity mutator is optional before the external audit.

## 17.5 Gas targets

| Path | *Target* added gas |
| --- | --- |
| Unflagged swap below N₀ | 15k |
| Unflagged swap at or above N₀ (one reference read) | 40k |
| Flagged swap (reference read, record, mint, events) | 90k |
| Licence check on a licence pool | 18k on top |
| `settle` | 250k |
| `expire`, `drip`, `accrue`, `bid` | Measured and recorded |

All figures are targets until `test/gas/` measures them, and `docs/gas.md` records each measurement.

---

# §18 Security

Touchstone has no owner, no pause and no upgrade path. A bug cannot be patched in place; the only remedy is a new deployment and a migration. Security therefore rests on four things: a small trusted surface, conservation checks inside the hook, adversarial tests for every attack below, and a guarded launch behind an external audit.

## 18.1 Trust assumptions

| Dependency | Trusted for | If it fails |
| --- | --- | --- |
| Pyth | The settlement price P\* | R is wrong for the affected records, but never above D. The confidence cap and the jump guard refund the worst cases |
| Chainlink | The drift trigger and the licence fast path only, never an amount | The wrong swaps post deposits, or a holder escapes one clawback, bounded by the feed's deviation threshold |
| Keepers | Liveness only | Records expire and refund in full; LPs lose that clawback |
| Market calendar | Session times and holidays | A wrong open finds no price and refunds; past `validUntil` the pool takes no deposits |
| Trusted routers | `msgSender()` for refunds and the licence | Only the immutable list is believed; any other contract's `msgSender()` is ignored |

## 18.2 Threats

| # | Attack | Mitigation | What is left |
| --- | --- | --- | --- |
| T1 | A keeper picks a favourable Pyth update | `parsePriceFeedUpdatesUnique` accepts only the first update at or after t₀ | None |
| T2 | Pyth withheld or late | Expiry refunds in full | Lost clawback; E4 monitors it |
| T3 | Padding past the fair price | In-the-money accounting; ε set at the measured cost | Approximation across initialized ticks |
| T4 | Splitting under N₀ or N\_min, or across blocks | The flow bucket applies to every swap and drains over h | At most about N\_min / h of unflagged flow per second, per direction |
| T5 | Switching to exact output | Triggers and deposits do not depend on the swap type | None |
| T6 | Outsider sandwich | The back-run sells into a price raised above the reference, so the drift trigger flags it and the clawback takes the gain | A stale reference can miss it |
| T7 | Holder sandwich, or an outsider and the holder colluding | Exemption covers only the block's first touch; a front-run at or above N₀ takes it | Legs below N₀, the same for everyone |
| T8 | JIT liquidity captures donations | `drip` releases vested amounts gradually, so a JIT position must stay in range for the vesting period | Small; tested |
| T9 | Blocklisted or reverting refund recipient | Failed pushes become ledger credits | None |
| T10 | Reentrancy through token callbacks | Transient locks on `finalize`, `creditRent` and `drip`; checks before effects before interactions | None |
| T11 | Forged or replayed records | Hash commitment written only by the hook; deleted on settlement | None |
| T12 | Griefing bid: high rent, small deposit | The griefer pays K seconds of rent to LPs | A short gap until the next activation |
| T13 | Idle holder keeps the pool stale, for example to move an external oracle that reads it | Outside the band, outsiders realign at α | Staleness up to about G |
| T14 | A lone bidder buys the licence at the reserve | Tail protection by the band; reserve from E10; licence off by default | Inside-band value above the reserve |
| T15 | Wash trading or LP self-wash for rebates | κ < 1; κ lowered on concentrated pools; budget capped by ρ | Other LPs' share of ρ of retained income |
| T16 | Refunds sent to `tx.origin` on relayed or ERC-4337 transactions | Trusted routers and `GuardedRouter` always name the trader | An untrusted router with no `hookData` refunds the relayer; documented for wallets |
| T17 | Malformed `hookData` | Revert `MalformedHookData` | None |
| T18 | Mis-scaled prices from token decimals or Pyth exponents | One conversion library, fuzzed against exact arithmetic | None |
| T19 | Wrong block numbers on Arbitrum and Orbit chains | `BlockLib` reads `ArbSys` | None |
| T20 | A hook unlock attempted inside someone else's unlock | The PoolManager reverts with `AlreadyUnlocked`; the call fails without effect | None |

Each row has a proof-of-concept test in `test/` that must fail to profit or fail to break an invariant.

## 18.3 Rules for every change

- Conservation is checked where the money moves: `finalize` rejects any payout that does not balance (§13).
- Every external call on the swap path is caught. A failure means no deposit or no exemption, never a revert.
- Rounding favours conservation. R, tips and rebates round down, and the refund is D − R, so nothing is created or lost.
- Unchecked blocks state the invariant that rules out overflow.
- No `delegatecall`, no `selfdestruct`, no inline assembly outside transient-storage helpers and audited v4 libraries.

## 18.4 Guarded launch

The first mainnet pool adds three limits. Each pool has `maxOutstanding`, a ceiling on deposits held at once, in quote units, beyond which swaps post no deposit. The team supplies the initial liquidity. A keeper runs with alerts from day one (§15). The cap bounds the funds a bug could reach, and filling it on purpose is impractical: deposits are a fraction of notional and refund within seconds.

## 18.5 Audit process

Before each milestone closes, the twelve audits of §0.6 run in parallel and each writes a report. Every finding gets a severity, the affected file, a root cause and a resolution.

| Audit | Touchstone focus |
| --- | --- |
| 1. Hardcoded values | Thresholds, windows, addresses, feed IDs |
| 2. Stubs and simulation | Nothing mocked in `src/` |
| 3. Dead code | Leftover trigger variants from the research |
| 4. Security | This section, plus keeper key handling and RPC inputs |
| 5. Architecture | Hook, Settler and lens boundaries; no cycles beyond the immutables |
| 6. Code quality | Naming of regimes and units |
| 7. Performance | SLOADs and SSTOREs per swap path against §17's targets |
| 8. Error handling | Every `try`/`catch` on the swap path, and what it hides |
| 9. Dependencies | Pinned v4, Pyth and OpenZeppelin commits; no AGPL code |
| 10. Test coverage | Every invariant and threat row has a test |
| 11. Bug bounty | Exploits written as failing tests first, then fixed, then kept |
| 12. Production readiness | Deploy dry runs, verification, alerts |

An external audit by a firm with Uniswap v4 hook experience is required before any mainnet pool. Its cost is a real constraint: Bunni shut down in October 2025, citing six to seven figures for a secure relaunch after its exploit. Scope stays small for that reason. The licence and rebates can ship later, as separate audited deployments.

---

# §19 Deployment and operations

## 19.1 Networks

Arbitrum Sepolia comes first, as the closest stand-in for Arbitrum and Robinhood Chain, then Base Sepolia. Unichain Sepolia moved to OP Enterprise on 13 October, mainnet follows on 29 October, and its ordering afterwards is unannounced, so it waits.

| Contract | Arbitrum Sepolia | Base Sepolia |
| --- | --- | --- |
| PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |
| Universal Router | `0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47` | `0x492e6456d9528771018deb9e87ef7750ef184104` |
| StateView | `0x9d467fa9062b6e9b1a46e26007ad82db116c67cb` | Confirm on day 1 |
| PoolSwapTest | `0xf3a39c86dbd13c45365e57fb90fe413371f65af8` | `0x8b5bcc363dde2614281ad875bad385e0a785d3b9` |
| V4Quoter, Pyth, Chainlink feeds | Confirm on day 1 | Confirm on day 1 |

These addresses came through a summarising fetch tool. Check every one against Uniswap's deployment page and the chain explorer before use, and record the check in `DEPLOYMENTS.md`.

## 19.2 Scripts

| Script | Does |
| --- | --- |
| `MineHookAddress.s.sol` | Predicts the six support contracts from the deployer's nonces, builds the hook's init code, and mines a `CREATE2` salt whose address has exactly the flag bits `0x20C4` in its low 14 bits |
| `DeployCore.s.sol` | Asserts the deployer's starting nonce, deploys the Settler, auction, ledger, lens, factory and router in that order, then the hook through the deterministic `CREATE2` deployer, and checks every address against the prediction |
| `CreatePool.s.sol` | Reads `script/config/<chain>.json`, validates it off-chain with the same bounds as the factory, and calls `createPool` |
| `Verify.s.sol` | Verifies all seven contracts on the explorer and writes `DEPLOYMENTS.md` |

`0x20C4` is `beforeInitialize` (1 << 13), `beforeSwap` (1 << 7), `afterSwap` (1 << 6) and `afterSwapReturnDelta` (1 << 2). Every other permission bit must be zero, and `BaseHook` checks the address against the permissions in its constructor.

The deployer is an encrypted keystore through `cast wallet`, never a raw key in `.env`. Any other transaction from that account between prediction and deployment breaks the nonce plan, so `DeployCore` reverts if the starting nonce differs.

## 19.3 Release checklist

1. Dry run on a fork of the target chain, then deploy.
2. Verify every contract and record the addresses.
3. Create the demo pool from the chain's config file.
4. Run the demo bots and record a transaction for each of these: pool creation; an unflagged swap; a flagged swap; a settlement that retains; one that refunds with a rebate; an expiry; a closed-market settlement; a donation; a bid, an activation and an exempt swap; a rebate claim.
5. Link each transaction from the README, next to the file and line that produced it.

## 19.4 Environment

`.env.example` lists every variable with a comment and no value: RPC URLs per chain, explorer API keys, `HERMES_URL`, `HERMES_API_KEY`, the keeper's keystore path, and the indexer's database URL. `.env*` files other than the example are ignored by git, and the history is scanned for secrets before the first push.

## 19.5 Runbook

There is no pause, so the runbook is about watching and migrating, not intervening.

| Event | Response |
| --- | --- |
| Keeper down | Restart it; any third party can settle meanwhile. Records past their latest usable time expire and refund |
| Hermes outage | The keeper retries until the latest usable time, then lets records expire |
| `maxOutstanding` reached | New swaps post no deposit until settlements free room; investigate the keeper |
| Licence lapses | Nothing to do; the pool falls back to the plain clawback |
| Calendar within 30 days of `validUntil` | Deploy a pool with a new calendar and announce the move to LPs |
| Pyth feed deprecated | Deploy a new pool with the replacement feed ID |
| Bug found | Publish it, stop routing new flow to the pool, keep settling open records so traders get refunds, and help LPs exit; the hook never blocks withdrawals |

---

# §20 Build plan and milestones

Two developers, Monday 19 October to Friday 27 November 2026, with ETHGlobal Mumbai in the middle. Developer 1 (D1) owns the contracts. Developer 2 (D2) owns the research, the off-chain services and the write-up. The full v2 takes six weeks, not two; what reaches the Mumbai submission is the core, closed-market mode, the quote tools and the licence.


The plan puts the cheapest kill test first. If trigger recall misses break-even on day 3, nothing built afterwards matters, the licence included: its exclusivity depends on outsiders being flagged.

## 20.1 Gates

| Gate | Date | Test | If it fails |
| --- | --- | --- | --- |
| G1 | Wed 21 Oct | E2: held-out recall at or above break-even, at φ ≤ 0.30, on at least one chain | Stop and switch to the runner-up, bonded execution guarantees (§3.7); the hook scaffolding carries over. Status at handoff unknown (D-17) |
| G2 | Fri 30 Oct | E3 passes, and E4's median basis is at most ε/2 | Re-set Δ and ε on development windows; if E4 kills, stop settlement work and re-plan the oracle |
| G3 | Wed 4 Nov | Arbitrum Sepolia end to end: a flagged swap, a retaining and a refunding settlement, a donation, and a Saturday 31 October closure record settled at Monday's open | The Mumbai demo runs on a fork instead |
| G4 | Removed | No hackathon submission (decision 0050) | — |
| G5 | Fri 20 Nov | E10 | The licence stays off on pilot pools and ships as research |
| G6 | Fri 27 Nov | Audit-ready: every invariant, every gas target, the twelve audit reports, the lessons | The external-audit request slips; the checks do not |

Monday 2 November is also the first reopen after US daylight saving time ends on 1 November, which tests the calendar for free.

## 20.2 Week by week

| Week | D1: contracts | D2: research and services |
| --- | --- | --- |
| 1 · 19–23 Oct | Scaffold, pins and CI; `BlockLib`; triggers (first touch, flow bucket, drift); the deposit and record path; `HookSwap`; the factory; unit tests in both directions | Pre-register E1 to E4; run E1 and E2 on Assay's pipeline for G1; start the live Pyth–Binance basis log; confirm every testnet address |
| 2 · 26–30 Oct | Settler: Pyth parsing, price conversion, markout, in-the-money split, regimes; `finalize`, expiry, vesting and `drip`; `RebateLedger`; invariants I1 to I8 | E3 settlement replay; E5 and E6 simulations; keeper and indexer, first versions; G2 |
| 3 · 2–4 Nov | `NyseCalendar` with its differential test; closed-market mode; `previewDeposit` and `GuardedRouter`; Arbitrum Sepolia deployment; G3 | E9 weekend replay; dashboard; demo bots; README split into pre-existing and event work; video outline |
| Mumbai · 5–7 Nov | `LicenceAuction`, the hook's fast path and the Settler's band regime | Holder bot, licence page on the dashboard, first E10 simulation, demo and submission |
| 5–6 · 9–20 Nov | Licence invariants I11 to I13 and the state-machine differential; rebate wash tests; `TouchstoneLens` and `StaticQuoteLib`; Base Sepolia | E10 in full and on testnet with two bidder bots; E11; E12 fork tests; bytecode replay for E3 and E8; the E7 bake-off; G5 |
| 7 · 23–27 Nov | The twelve audit passes and their fixes; gas report; threat-model document | Lessons for every component; results write-up with every window; external audit request; G6 |

## 20.4 If time runs short

Cut in this order: the intents path; the URC-4 lens (keeping `previewDeposit`, `GuardedRouter` and `HookSwap`); the Base Sepolia deployment; rebates (keeping the ledger for deferred refunds). Never cut: the core hook, settlement, the licence, the invariants, or closed-market mode unless E9 kills it.

## 20.5 Milestones

Work through these in order. Contracts (D1) and research and services (D2) run in parallel; the dependencies column says what must exist first. Each milestone ends with the §0.5 validation, the §0.6 audit passes and the §0.10 lesson.

| # | Milestone | Owner | Target date | Depends on |
| --- | --- | --- | --- | --- |
| M0 | State audit and bootstrap | Both | Mon 26 Oct | — |
| M1 | Libraries | D1 | Tue 27 Oct | M0 |
| M2 | Hook swap path, factory, records | D1 | Wed 28 Oct | M1 |
| M3 | Settler, finalize, expiry, vesting, ledger | D1 | Fri 30 Oct | M2 |
| M4 | Research gates E1–E4 | D2 | G1 now; G2 Fri 30 Oct | M0 |
| M5 | Keeper and indexer, first versions | D2 | Fri 30 Oct | M2 events |
| M6 | Market calendar and closed-market mode | D1 | Mon 2 Nov | M3 |
| M7 | `previewDeposit`, `GuardedRouter`, `HookSwap` checks | D1 | Tue 3 Nov | M3 |
| M8 | Deploy scripts and Arbitrum Sepolia end to end | Both | Wed 4 Nov (G3) | M3, M5, M6, M7 |
| M9 | Arbitrage licence | Both | See decision 0050 | M8 |
| M10 | Hardening: licence invariants, rebates, lens, Base Sepolia | D1 | Fri 20 Nov (G5) | M9 |
| M11 | Research E5–E12 and bytecode replay | D2 | Fri 20 Nov | M4, M8 |
| M12 | Audit passes, gas report, lessons, release | Both | Fri 27 Nov (G6) | M10, M11 |

### M0 State audit and bootstrap

The plan started on Monday 19 October and this spec was written on Sunday 25 October, so some week-1 work may already exist.

1. Inventory the repository against §6 and the milestones below. Record in `docs/decisions/` what exists, what compiles, what passes and what is missing.
2. **Establish gate G1.** It was due Wednesday 21 October. If E2 has run, record its pre-registration file, windows and result. If it has not, M4's E1 and E2 come before anything else in D2's queue, because if held-out recall misses break-even at φ ≤ 0.30 the plan stops (§20.1).
3. Bootstrap whatever is missing: submodules at the pins in §6.2, `foundry.toml`, `remappings.txt`, CI running §0.5, `.gitignore`, `.env.example`, `docs/SPEC.md` (this file).
4. Import the reference pack (Appendix A) into `src/`, `test/` and `research/reference/`, run its 22 tests and the Python check, and commit them as one change with the test output in the body.

Acceptance: CI green on an empty-but-real scaffold; `forge test` passes the reference suite; the state document exists.

### M1 Libraries

Build on Appendix A. Add, each with unit and fuzz tests:

- `TransientLib`: PoolId-keyed `tstore`/`tload` helpers for `PRE_SQRT_PRICE`, `PRE_LIQUIDITY`, `FIRST_TOUCH_TX`, `LAST_DEPOSIT`, `LAST_RECORD`, and the `LOCK`. Slot keys are `keccak256(abi.encode(LABEL, poolId))` with labels as named constants.
- `ReferenceLib`: the never-reverting Chainlink read in §7.
- `TriggerLib`: first touch (persistent `lastTouchBlock` plus the transient flag), drift (`PriceLib.signedGapBps` ≥ τ), closure (calendar at t and at t + Δ + maxLag), and the `flagged` decision of §7.
- `RecordLib`: build the record from callback inputs, hash it, and the calldata check the Settler uses.
- `CalendarMath`: civil-from-days and days-from-civil, weekday, and the US daylight-saving rule since 2007 (second Sunday in March to first Sunday in November, 2:00 local).

Acceptance: every library at 100% line coverage; differential tests against `research/reference/touchstone_ref.py` vectors for every function that has a reference.

### M2 Hook swap path, factory and records

- `TouchstoneHook` inheriting OpenZeppelin `BaseHook`: permissions, immutables, `PoolState` packing, `_beforeInitialize` (factory-registered pools only), `_beforeSwap` (snapshot, zero `LAST_DEPOSIT`/`LAST_RECORD`), `_afterSwap` (§7 swap path, without the licence fast path), `register`, views.
- `TouchstoneFactory.createPool` with every bound and cross-field rule in §14, including static fee and `key.hooks == hook`.
- Events `DepositTaken` and URC-2 `HookSwap`; `HookBonus` arrives with rebates in M3.
- Test harness: deploy a real `PoolManager` from v4-core in tests (not a mock), add liquidity, swap through `PoolSwapTest`.

Acceptance: unit tests in both directions, exact input and exact output, native and ERC-20, quote as currency0 and as currency1, decimals 6, 8 and 18; invariant I8 (an unflagged swap's delta equals a hookless twin pool's); gas targets for the two unflagged paths measured and recorded.

### M3 Settler, finalize, expiry, vesting and ledger

- `Settler.settle`, `expire`, `settleTime` as in §8, against the real Pyth SDK interfaces. In unit tests use Pyth's own mock contract from its SDK under `test/mocks/`, or a `MockPyth` that implements `parsePriceFeedUpdatesUnique`'s first-after-t rule exactly; fork tests use recorded Hermes updates.
- `TouchstoneHook.finalize`, `drip`, the `IUnlockCallback`, the transient lock, deferred refunds.
- `RebateLedger` with `credit`, `claim`, `claimAsClaims`, `push`, protocol credits.
- Invariants I1–I8 and I14–I17.

Acceptance: the worked example (§4.7) end to end through real contracts; T1 (keeper picks a favourable update) fails; settlement gas measured.

### M4 Research gates E1–E4 (D2)

Pre-register E1–E4 in `research/prereg/` before running them (§16). Run E1 and E2 on Assay's calibration pipeline (swap logs over RPC plus Binance 1-second klines). Start the live Pyth–Binance basis log for E4 at once; it needs days of data.

Acceptance: G1 and G2 decided and recorded with every window, failures included.

### M5 Keeper and indexer, first versions (D2)

The keeper's steps 1–6 of §15, and the indexer's raw tables, against a local anvil fork with the M3 contracts. Housekeeping (step 7) follows in M8.

### M6 Market calendar and closed-market mode

`NyseCalendar` with holidays and early closes for the years NYSE has published, `CalendarMath`, closure records in the hook, closure settlement in the Settler, the jump guard. Differential test against Python `exchange_calendars` XNYS minute by minute across the covered years, including both daylight-saving switches.

### M7 Quote integrity, first part

`previewDeposit` sharing `_depositFor` with the swap path; `GuardedRouter` with `IMsgSender`; the URC-2 `HookSwap` rule (exactly one per swap with a deposit, none otherwise). The URC-4 lens comes in M10.

Acceptance: E12's first check holds in-repo: within one block, `previewDeposit(...).depositNow` equals the executed deposit, fuzzed.

### M8 Deploy and Arbitrum Sepolia end to end (gate G3)

`MineHookAddress`, `DeployCore`, `CreatePool`, `Verify` as in §19; verify every address from §19.1 on the explorer first. Run the demo bots and record a transaction for each item of §19.3 that exists before the licence. Settle a Saturday 31 October closure record at Monday 2 November's open, which is also the first reopen after US daylight saving time ends on 1 November.

### M9 Arbitrage licence

`LicenceAuction` (§10), the hook's fast path and `creditRent`, the Settler's band regime, the holder bot, the licence dashboard page, the first E10 simulation, the video and the submission (§22). Commit small and often during the event.

### M10 Hardening

Licence invariants I11–I13 and the lease state-machine differential; rebate wash and LP self-wash tests (T15); `TouchstoneLens` and `StaticQuoteLib` tested against `V4Quoter` on forks; Base Sepolia deployment.

### M11 Research E5–E12 and bytecode replay (D2)

E5, E6, E9, E10, E11 and E12 as pre-registered; the `sim/` revm replay of the compiled hook for E3 and E8; the E7 bake-off including Hindsight-style own-TWAP settlement.

### M12 Audit passes and release

The twelve audits of §0.6 with fixes; `docs/gas.md`; `docs/threat-model.md`; every lesson; the results write-up with every window; the external audit request.

---

# §21 Decisions

Each decision gets a file in `docs/decisions/NNNN-<topic>.md` with context, options, the choice and its consequences. The ones below are already made, or are open and must be closed by the date given. "Changed" marks a place where this spec differs from the developer docs (rev 38).

| # | Decision | Status | Choice and reason |
| --- | --- | --- | --- |
| D-1 | Price scale | Resolved, **changed** | 1e36, not 1e18. At 1e18 an 18-decimal token worth $0.0001 against 6-decimal USDC (base-unit ratio 1e-16) is held to two significant digits. At 1e36 every v4 price stays below 2^248. Implemented and fuzzed in `PriceLib` (Appendix A) |
| D-2 | Flow buckets share one timestamp | Resolved, **clarified** | Every update drains both directions to now, then adds to one. Otherwise the untouched bucket would be drained by time it never saw. `FlowBucketLib.update` |
| D-3 | Oracle for the swap-time trigger | **Open, decide before M1's `ReferenceLib`** | Default as specified: Chainlink push feed for the drift trigger and the licence fast path, Pyth for settlement. Alternative recommended in the 24 October discussion: Pyth only, reading Pyth's last stored price (`getPriceUnsafe` plus a local `publishTime` age check, in `try`/`catch`) with the team's keeper pushing an update every few seconds on L2. It removes one dependency and the Pyth–Chainlink basis, at the cost of keeper gas; a stale stored price only switches the trigger off. Keep the choice behind `ReferenceLib` so either costs one library |
| D-4 | OpenZeppelin uniswap-hooks pin | Resolved, **changed** | `b5f1057` is tag v1.3.0-rc.0 ("Bump version to 1.3.0", 7 October 2026), not a final v1.3.0 release (checked 25 October). Pin it for the `BaseHook` API used here; re-check for a final tag before the audit and record any diff |
| D-5 | Static fee only | Resolved | Pools use a static LP fee and `beforeSwap` returns no fee override. Dynamic-fee pools trigger manual router review and are rejected by the factory |
| D-6 | Default to refund | Resolved | A record nobody settles refunds in full at expiry. A missed settlement costs LPs that clawback, never a trader the deposit |
| D-7 | Records committed by hash | Resolved | One storage slot per open record; the full record travels in `DepositTaken` and in `settle` calldata |
| D-8 | Licence timing | Resolved | Built in M9 after the testnet deployment (decision 0050), off by default on every pool until E10 passes |
| D-9 | Closed-market scope | Resolved | Regular session only, fixed-share-ratio tokens only; dropped if E9 kills it |
| D-10 | No AGPL code | Resolved | The lease is reimplemented from arXiv 2403.03367 and §10; BidDog is read for reference only |
| D-11 | Protocol share through the ledger | Open, before the guarded launch | Donations skip the v4 protocol fee, so each pool can route `protocolShareBps` of retained value and rent to `protocolRecipient`. Confirm this reading of the allowlist rule with the maintainers |
| D-12 | URC-4 text | Open, at M10 | Pin the exact forum draft revision implemented, and the July 2026 change dropping `view`; Touchstone's functions are views, which works either way |
| D-13 | Testnet addresses | Open, at M8 | The addresses in §19.1 came through a summarising fetch tool; verify each against Uniswap's deployment page and the explorer, record the check in `DEPLOYMENTS.md` |
| D-14 | Pyth history | Open, at M4 | History after the August 2026 Pythnet sunset is unverified; if Hermes cannot serve it, E4 falls back to live collection from now on |
| D-15 | Hackathon track | Withdrawn | The owners are not entering ETHGlobal Mumbai (decision 0050) |
| D-16 | Library errors | Resolved, **added** | `Touchstone__NonPositivePrice`, `Touchstone__ExponentOutOfRange(int256)`, `Touchstone__RetainedAboveDeposit(uint256,uint256)` and `Touchstone__ZeroHorizon` join `ITouchstoneErrors` |
| D-17 | Gate G1 | Open, at M0 | Due Wednesday 21 October; status unknown when this spec was written. M0 establishes it |
| D-18 | Who emits `Settled` | Resolved, **changed** | The developer docs had the hook emit `Settled`, but `finalize(record, payout, expired)` never receives the markout, fair price or α the event carries. The Settler emits `Settled` and `Expired` after `finalize` returns; indexers watch both contracts |

---

# §22 AI use, contributions and licences

## 22.1 AI use

AI helped with research, with this specification and with code under review. The rules:

- Every line in `src/` is read and owned by a developer who can explain it. After each milestone that developer writes `docs/lessons/NN-<topic>.md` under the teaching protocol (§0.10): the concept, the design decisions, a code walkthrough, failure modes, audit questions and exercises.
- No generated code merges without tests that would fail without it.
- No number appears anywhere without its source and its label: measured, backtest, simulation, testnet or target.

## 22.2 Contributions

- `main` is protected. Changes arrive by pull request, with the §0.5 validation commands green.
- The other developer reviews every pull request: D2 reviews contracts, D1 reviews research and service code.
- Commits are conventional, imperative and one logical change each, with the rationale in the body. No force-pushes.
- A pull request that touches `src/` updates its tests and the gas snapshot, `docs/gas.md` if gas moved, and the threat model if behaviour changed.
- Design changes get a short decision record in `docs/decisions/`, such as the flow bucket replacing per-block size, or the band applying to the holder.

## 22.3 Licences

The repository is MIT. At the pinned commits, the v4-core interfaces and libraries the hook imports (`IHooks.sol`, `Hooks.sol`) are MIT, while `PoolManager.sol` is BUSL-1.1 and is only called, never copied. v4-periphery and OpenZeppelin's uniswap-hooks are MIT. Bunni's BidDog `AmAmm.sol` is AGPL-3.0, so none of its code is used.

---

# §23 References

## 23.1 Code and pinned dependencies

| Repository | Pin | Licence | Used for |
| --- | --- | --- | --- |
| [Uniswap/v4-core](https://github.com/Uniswap/v4-core) | `46c6834` (2 Apr 2026) | MIT for interfaces and libraries; `PoolManager.sol` BUSL-1.1 (called, never copied) | PoolManager, `Hooks`, `StateLibrary`, `SqrtPriceMath`, `FullMath`, `SafeCast`, `TickMath` |
| [Uniswap/v4-periphery](https://github.com/Uniswap/v4-periphery) | `9969eec` (19 Sep 2026) | MIT | `IMsgSender`, `V4Quoter`, `HookMiner` (test/shared) |
| [Uniswap/universal-router](https://github.com/Uniswap/universal-router) | Read only | — | `Dispatcher.msgSender()` behaviour for refunds |
| [OpenZeppelin/uniswap-hooks](https://github.com/OpenZeppelin/uniswap-hooks) | `b5f1057` (tag v1.3.0-rc.0) | MIT | `BaseHook` |
| [pyth-network/pyth-crosschain](https://github.com/pyth-network/pyth-crosschain) | Release tag chosen on day 1 | Apache-2.0 (verify) | `IPyth`, `PythStructs`, Pyth's mock for unit tests |
| [foundry-rs/forge-std](https://github.com/foundry-rs/forge-std) | Pin with Foundry | MIT/Apache-2.0 | Tests |
| [Bunniapp/biddog](https://github.com/Bunniapp/biddog) | Read only, never copied | **AGPL-3.0** | Reference for the am-AMM lease |
| [PrazwalR/assay](https://github.com/PrazwalR/assay/tree/513ce2aba7e76c7af08fc4e1a3141e2286f501c8) | `513ce2a` | Author's own | Signed drift (`Mispricing.sol`), fail-upward reference adapter, `calibration/` pipeline for E1–E3 |
| [PrazwalR/vane](https://github.com/PrazwalR/vane) | `33a2302` | Author's own | `sim/` revm bytecode replay for E3 and E8; `VarianceRatio.sol` as a diagnostic |
| [OoJae/hindsight-hook](https://github.com/OoJae/hindsight-hook) | Read only | — | Closest prior art; E7 baseline |

## 23.2 Mechanism papers and standards

| Source | Supports |
| --- | --- |
| [Milionis et al., LVR, arXiv 2208.06046](https://arxiv.org/abs/2208.06046) | LVR = σ²V/8 |
| [Adams, Moallemi, Reynolds, Robinson, am-AMM, arXiv 2403.03367](https://arxiv.org/abs/2403.03367) | The lease auction the licence adapts |
| [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153) | Transient storage |
| [EIP-6909](https://eips.ethereum.org/EIPS/eip-6909) | Multi-token claims |
| [Pyth `parsePriceFeedUpdates` reference](https://api-reference.pyth.network/price-feeds/evm/parsePriceFeedUpdates) | The Unique variant returns the earliest update after minPublishTime |
| [URC-2](https://gov.uniswap.org/t/urc-2-custom-accounting-hook-swap-event/26154), [URC-4](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156) | `HookSwap` event; `IALFHook` |

The research report's evidence ledger follows unchanged, so every figure in §3 and §4 can be traced.

The sources the report's main claims rest on, with dates and quality. "Primary" means code, a specification, official documentation or a governance post read directly; a primary source with a commercial stake is marked self-interested. Figures marked "my calculation" in the text are derived from these sources and are hypotheses until the experiments in the validation plan run.

## 23.3 Uniswap and its hooks

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [VolatilePairHook spec](https://github.com/Uniswap/v4-hooks-public/blob/main/docs/technical/VolatilePairHook.md) | Oct 2026 | Primary: spec | Labs' oracle-free directional fee; no LP-return data published |
| [StablePair explainer](https://blog.uniswap.org/keeping-value-in-the-pool-how-stablepair-hook-works) | Sep 2026 | Primary, self-interested | Band plus per-block decaying auction |
| [Routing for hooked pools](https://support.uniswap.org/hc/en-us/articles/48291859140621-Routing-for-hooked-pools) | 3 Sep 2026 | Primary: docs | Return-delta hooks need review; no upgradeable proxies, required calldata or protocol-fee bypass |
| [routing-api hook filter](https://github.com/Uniswap/routing-api/blob/main/lib/util/v4HooksPoolsFiltering.ts) | Mar 2026 | Primary: code | 112 allowlisted hooks; stricter than the support article |
| [Uniswap hooklist](https://github.com/Uniswap/hooklist) | 16 Oct 2026 | Primary registry, AI-generated labels | 4,979 hooks; about 81% need manual allowlisting; SkewHook, LodeHook, Angstrom L2 |
| [Custom hooks in the Labs interface](https://support.uniswap.org/hc/en-us/articles/33829289869965) | 24 Aug 2026 | Primary: docs | Any hooked pool can reach interface flow through a UniswapX filler |
| [URC-4 thread](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156) (with URC-2 and URC-3) | Jun–Aug 2026 | Primary: draft standards | Router quoting interface; no markout or execution-quality metrics |
| [Robinhood Chain fee temp check](https://gov.uniswap.org/t/temp-check-protocol-fee-expansion-robinhood-chain/26168) | 11 Jul 2026 | Primary: governance | Robinhood Chain is an Arbitrum Orbit chain |
| [DefiLlama, Uniswap v4](https://defillama.com/protocol/uniswap-v4) | Oct 2026 | Aggregator data | Robinhood Chain about 36% of v4 volume and 63% of v4 fees (my calculation) |
| [Unichain to OP Enterprise](https://blog.uniswap.org/unichain-is-upgrading-to-op-enterprise) | 9 Oct 2026 | Primary | Migration on 29 Oct; ordering afterwards unannounced |
| [URC-2](https://gov.uniswap.org/t/urc-2-custom-accounting-hook-swap-event/26154) | Created 11 Jun 2026; in Discussion | Primary: governance draft | HookSwap: exactly one event per swap with a hook delta, signed from the swapper's side |
| [URC-4](https://gov.uniswap.org/t/urc-4-active-liquidity-framework-hook-interface/26156) | Created 11 Jun 2026; in Discussion | Primary: governance draft | IALFHook quoting interface; a co-author agreed in July to drop the view requirement |
| [Hook data standards](https://uniswapfoundation.org/blog/developer-guide-establishing-hook-data-standards-for-uniswap-v4) | 3 Mar 2025 | Primary: Foundation blog | The HookBonus event for hooks that rebate swappers |

## 23.4 LP losses and toxic flow

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [Sadeghi et al. (Uniswap Labs, Columbia)](https://arxiv.org/html/2609.37963v1) | Sep 2026 | Preprint, Labs-affiliated | 15 s passive markouts; flat from 0 s to 1 h; sandwich legs 48–76% of 1 bp ETH-stable volume |
| [Kovalenko](https://www.researchsquare.com/article/rs-11118453/v1) | 5 Oct 2026 | Preprint, single author, not replicated | −$35.6M net across 62 pools; fees about 74–83% of LVR (my calculation); an aggregator's minute prices flipped the LVR sign in a validation week |
| [Milionis et al., LVR](https://arxiv.org/pdf/2208.06046v4) | 2022 | Preprint (arXiv), widely cited | LVR = σ²V/8 |
| [Heimbach, Pahari, Schertenleib](https://arxiv.org/html/2401.01622v3) | 2024 | Preprint | 2.8% of swaps carried about 29% of volume (arbitrage identified with heuristics that include being the first swap in its pool and direction) |
| [Ahlroos and Eloranta](https://hackmd.io/@anteroe/BkIbSfwmJx) | Nov 2024 | Research note | The top 10% of LVR transactions caused about 80% of LVR |
| [Wu et al., AFT 2025](https://drops.dagstuhl.de/storage/00lipics/lipics-vol354-aft2025/html/LIPIcs.AFT.2025.26/LIPIcs.AFT.2025.26.html) | 2025 | Peer-reviewed | Three searchers took about 73%, then about 90%, of CEX–DEX arbitrage; much of it passes to builders |

## 23.5 Ordering, MEV and routers

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [Priority Is All You Need](https://www.paradigm.xyz/2024/06/priority-is-all-you-need) | Jun 2024 | Research essay | MEV taxes need competitive priority ordering |
| [Angstrom L2 docs](https://docs.angstrom.xyz/l2/intro) | 2026 | Primary: docs | Priority-fee tax hook; Base, with Unichain claimed but not in the registry |
| [When Priority Fails](https://arxiv.org/html/2506.01462v4) | Sep 2025 | Preprint | After Flashblocks, only the first sub-block is fee-ordered |
| [Timeboost study](https://arxiv.org/html/2511.18328v1) | Nov 2025 | Preprint | Three firms hold Arbitrum's express lane; markouts stable from 2 to 10 s |
| [Robinhood Chain explainer](https://madeonsol.com/blog/robinhood-chain-explained) | Jul 2026 | Secondary, teaser text only | "Private FCFS sequencer" |
| [0x on malicious hooks, via CryptoSlate](https://cryptoslate.com/malicious-uniswap-v4-hooks-are-baiting-defi-traders-with-fake-swap-quotes/) | Sep 2026 | Secondary; 0x is an interested party | 54.2% of 84,163 hooks labelled malicious; quotes that differ from execution |
| [KyberSwap hook adapters](https://github.com/KyberNetwork/kyberswap-dex-lib/blob/main/pkg/liquidity-source/uniswap/v4/hooks.go) | 16 Oct 2026 | Primary: code | Unknown hooks with swap permissions rejected; 47 bespoke adapters |
| [UF × Brevis rebate](https://uniswapfoundation.org/blog/hooks-routing-rebate-program-with-brevis) | 24 Oct 2025 | Primary | Up to 85% of router gas on hooked pools; no results published |
| [Arbitrum chain ordering](https://docs.arbitrum.io/launch-arbitrum-chain/chain-config/costs/priority-fees) | 2026 | Primary: docs | Arbitrum chains order first come, first served unless Timeboost is enabled; priority fees do not change ordering |

## 23.6 Oracles and security

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [Pyth best practices](https://docs.pyth.network/price-feeds/best-practices) | 2026 | Primary: docs | Pull prices are "functionally equivalent to latency"; delayed settlement recommended |
| [parsePriceFeedUpdates](https://api-reference.pyth.network/price-feeds/evm/parsePriceFeedUpdates) | 2026 | Primary: docs | The Unique variant returns the earliest update after minPublishTime |
| [Pyth current fees](https://docs.pyth.network/price-feeds/current-fees) | Aug 2026 | Primary: docs | Zero update fee on EVM mainnets; Hermes needs an API key |
| [EIP-1153](https://eips.ethereum.org/EIPS/eip-1153) | Created 2018; live since Dencun (Mar 2024) | Primary: standard | Transient storage clears after every transaction |
| [Building secure v4 hooks](https://blog.trailofbits.com/2026/07/30/building-secure-uniswap-v4-hooks/) | 30 Jul 2026 | Primary: audit firm | Round-trip invariant; bounded fees; accounting can be wrong even when settlement succeeds |
| [Bunni post-mortem](https://blog.bunni.xyz/posts/exploit-post-mortem/) | Sep 2025 | Primary | $8.4M rounding exploit |
| [Cork incident](https://blocksec.com/blog/cork-protocol-incident-two-independent-flaws-combine-into-one-devastating-exploit-chain) | Feb 2026 (incident May 2025) | Secondary: security firm | Untrusted `hookData` and missing access control |
| [Bunni shutdown](https://www.theblock.co/post/375813/bunni-dex-shuts-down) | 22 Oct 2025 | Secondary (The Block) | Bunni ceased operations after the exploit |
| [Hermes API, via extrnode](https://docs.extrnode.com/chains/hermes) | 2026 | Secondary: provider docs | The timestamp endpoint returns the first update at or after the given time |

## 23.7 Prior art closest to Touchstone

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [Detox Hook](https://ethglobal.com/showcase/detox-hook-mppeg) | 2025 | Hackathon showcase | Arbitrage tax against Pyth at swap time |
| [Whitelisted-arb AMM](https://efalken.substack.com/p/amm-with-whitelisted-arbs) | 12 Jun 2025 | Design essay | After-the-fact profit tax against the AMM's own price |
| [Diamond](https://eprint.iacr.org/2022/1420) | 2022 | Preprint | Bonded block-level arbitrage |
| [LodeHook](https://github.com/Uniswap/hooklist/blob/main/hooks/ethereum/0x8f24193cc75fc64a30a038442bcd622ff4070088.json) | May 2026 | Registry entry | First-swap premium with an anti-dust floor |
| [SkewHook](https://github.com/Uniswap/hooklist/blob/main/hooks/ethereum/0xb8f9aa9f39ffbec861f7014f1604f0b89ab2e080.json) | Sep 2026 | Registry entry; code not reviewed | Assay's oracle-gap fee, already deployed |
| [BaseDynamicAfterFee](https://github.com/OpenZeppelin/uniswap-hooks/blob/master/src/fee/BaseDynamicAfterFee.sol) | 2026 | Primary: code | A post-swap fee inside the same transaction |
| [Hindsight](https://github.com/OoJae/hindsight-hook) | 2026, UHI10 window | Primary: repository README; results self-reported; testnet only | Ex-post settlement of every swap against the pool's own TWAP; 7-day backtest; 233k gas per swap |
| [v4 per-block conversion hook](https://ethresear.ch/t/uniswap-v4-hook-lvr-minimization-with-per-block-conversion-vs-futures-contracts/18610) | 8 Feb 2024 | Research post | The first swap in each block goes to a collateralised arbitrageur; futures settle every τ blocks |
| [am-AMM](https://arxiv.org/abs/2403.03367) | Mar 2024; v4 Feb 2025 | Preprint abstract | A lease auction for pool management with rent to LPs; the manager sets and keeps the fee |
| [BidDog](https://github.com/Bunniapp/biddog) | Jun 2025, last commit read | Primary: code, AGPL-3.0 | Bunni's am-AMM: K = 7,200 blocks, a 10% minimum increment, rent paid by burning LP shares; reads ArbSys for L2 block numbers on Arbitrum |
| [McAMM](https://ethresear.ch/t/mev-capturing-amm-mcamm/13336) | 2022 | Research post | Auctions the first trade in each block; other swaps wait for the winner |

## 23.8 Rules, markets and the author's own work

| Source | Date | Quality | Supports |
| --- | --- | --- | --- |
| [ETHGlobal Mumbai rules](https://ethglobal.com/events/mumbai/info/details) | Oct 2026 | Primary | Deadline, Classic versus Continuity, AI policy, video rules |
| [Kaiko, via PANews](https://panews.io/articles/01a101ea-0b22-730a-8344-ff4c64da178c) | 3 Oct 2026 | Secondary | 71% of Uniswap stock-token volume off-hours; nearly half while exchanges were closed |
| [Assay at `513ce2a`](https://github.com/PrazwalR/assay/tree/513ce2aba7e76c7af08fc4e1a3141e2286f501c8) | 11 Sep 2026 | Author's repository | Fee rule; 0.781 withdrawn; corrected AUC 0.7485 fails its gate |
| [VANE](https://github.com/PrazwalR/vane) (HEAD `33a2302`) | 9 Oct 2026 | Author's repository | Fully built; open-loop gain identically zero |
| [Pyth market hours](https://docs.pyth.network/price-feeds/market-hours) | 2026 | Primary: docs | Overnight session Sunday to Thursday, 8pm to 4am ET; weekends closed |
| [Chainlink 24/5 US equities guide](https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide) | 2026 | Primary: docs | Market status values; halts not flagged; multiplier activation times |
| [Cong et al.](https://www.suomenpankki.fi/globalassets/bof/fi/ajankohtaista/tapahtumat/kalenteri/rabetti_sra2026.pdf) | Mar–May 2026 | Working paper; its slides and one table conflict | Weekend token returns anticipate the Monday open; weekday overnight returns reverse |
| [Bitquery, via KuCoin](https://www.kucoin.com/news/insight/AAPL/6ac4857938a264000792c769) | 6 Oct 2026 | Secondary | By 6pm Sunday, tokens had covered about a tenth of the gap to the Monday open |

**Searches that were cut short.** Seven of eight research tracks hit a search or tool budget before every search was done. The prior-art track's "not found" verdicts, including the one behind Touchstone's novelty claim, rest on Uniswap's hook registry, Labs' public hooks, OpenZeppelin's library and paper abstracts, not on a full web search. They also missed Hindsight, a testnet-only UHI10 project that a later direct web search found, so treat the remaining "not found" verdicts, including the closed-market one, with the same caution. Closed-source routers (1inch, Odos, 0x production) were not inspected.

---

# Appendix A Reference pack (compiled and tested)

These files were written for this spec and compiled with solc 0.8.26 (EVM `cancun`, optimizer on, 1,000,000 runs) against v4-core `46c6834` using Foundry 1.5.1. All 22 tests pass, the fuzz tests at 20,000 runs each, and `forge fmt --check` is clean. The Python reference reproduces every number in §4.14. They are delivered alongside this spec as `touchstone-reference-pack.zip` with the same paths.

**How to use them.** At M0, copy the files into the repository at the paths shown, keep their tests, and extend them; do not rewrite them from the prose. They implement §4.2–§4.4, §4.10 and §4.12 exactly. They are pure libraries: nothing here reads state except `BlockLib`, and none of it is a stub.

| File | Implements | Tests |
| --- | --- | --- |
| `src/types/Payout.sol` | The settlement split type (§13) | — |
| `src/interfaces/ITouchstoneErrors.sol` | Every custom error, including D-16's four | Revert tests |
| `src/libraries/BlockLib.sol` | EVM or ArbSys block number (§2.7) | `test_BlockLib_ReadsArbSys` |
| `src/libraries/FlowBucketLib.sol` | Both leaky buckets, drained together (D-2) | Python vector; split-trade fuzz |
| `src/libraries/PriceLib.sol` | Pyth conversion at 1e36, confidence rounded up, pool price, sqrt price, signed gap | Python vectors; 20,000-run round-trip fuzz across both sides of 2^128 |
| `src/libraries/DepositLib.sol` | Deposit rate and conversion at the execution price | Worked example |
| `src/libraries/SettlementMath.sol` | Markout, regime table, clawback, split, benign rebate, conservation check | Worked example; floor, bound and conservation fuzz |
| `src/libraries/ItmLib.sol` | In-the-money leg with fee gross-up | No-overshoot, overshoot and wrong-side cases |
| `src/libraries/VestingLib.sol` | Drip amount | Bound fuzz |
| `research/reference/touchstone_ref.py` | Exact rational reference for all of §4 | Used by `check_report_numbers.py` and as the differential target |
| `research/reference/check_report_numbers.py` | Recomputes §4.14 and writes `vectors.json` | Asserts the worked example |

**Test run, 25 October 2026:**

```text
[PASS] testFuzz_Benign_NeverExceedsPool(uint128,uint128,uint24,uint16,uint128) (runs: 2000, μ: 3570, ~: 3258)
[PASS] testFuzz_Clawback_Bounded(uint128,int128,uint128,uint16,uint16,uint16) (runs: 2000, μ: 2745, ~: 2674)
[PASS] testFuzz_FlowBucket_SplitTradeFillsLikeOne(uint96,uint8) (runs: 2000, μ: 88960, ~: 42021)
[PASS] testFuzz_Markout_IsFloor(int96,int128,uint128) (runs: 2000, μ: 1823, ~: 1768)
[PASS] testFuzz_Split_Conserves(uint128,uint128,uint16,uint128,uint16,uint16) (runs: 2000, μ: 4617, ~: 4343)
[PASS] testFuzz_SqrtPrice_RoundTrip(uint256,bool) (runs: 2001, μ: 8084, ~: 8220)
[PASS] testFuzz_Vesting_NeverAboveBuffer(uint128,uint32,uint32) (runs: 2000, μ: 1333, ~: 1188)
[PASS] test_Benign_RebateMatchesReference() (gas: 2618)
[PASS] test_BlockLib_ReadsArbSys() (gas: 99899)
[PASS] test_Clawback_CapBindsAtDeposit() (gas: 1357)
[PASS] test_Conf_PythonVector() (gas: 1234)
[PASS] test_FairPrice_PythonVectors() (gas: 13009)
[PASS] test_FairPrice_RevertsOnNonPositive() (gas: 8969)
[PASS] test_FlowBucket_PythonVector() (gas: 2080)
[PASS] test_Itm_NoOvershootEqualsWholeSwap() (gas: 5105)
[PASS] test_Itm_OvershootStopsAtFair() (gas: 4478)
[PASS] test_Itm_WrongSideIsEmpty() (gas: 2607)
[PASS] test_Markout_ArbitrageRow() (gas: 1013)
[PASS] test_SignedGap() (gas: 1267)
[PASS] test_SplitArbitrage_MatchesReference() (gas: 9832)
[PASS] test_Split_RevertsWhenRetainedAboveDeposit() (gas: 11256)
[PASS] test_WorkedExample_MatchesReport() (gas: 6749)
Suite result: ok. 22 passed; 0 failed; 0 skipped; finished in 776.48ms (1.05s CPU time)
```

**Known gaps for M1 to close.** `ItmLib` ignores the v4 protocol fee and assumes constant liquidity across the leg (the differential test against an exact replay is M1's job). `PriceLib.signedGapBps` divides by the reference price, so callers must pass `ok = false` instead of a zero reference. The Python reference has no lease state machine beyond `min_next_rent` and `rent_due`; M10 adds the step-by-step model.

**Local `foundry.toml` used to build the pack** (with `solc` pointing at a downloaded static binary where `binaries.soliditylang.org` is blocked):

```toml
[profile.default]
src = "src"
test = "test"
libs = ["lib"]
solc_version = "0.8.26"
evm_version = "cancun"
optimizer = true
optimizer_runs = 1000000
remappings = ["forge-std/=lib/forge-std/src/", "v4-core/=lib/v4-core/src/"]

[fuzz]
runs = 2000
```


## `src/types/Payout.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A settlement split, built by the Settler and checked for conservation by the hook.
/// @dev All amounts are in the record's deposit currency.
struct Payout {
    bool benign; // true: rebate path, nothing retained
    uint128 refund; // to the beneficiary
    uint128 tip; // to tipTo; from R, or from the rebate pool if benign
    uint128 toProtocol; // share of R, credited to protocolRecipient
    uint128 toRebatePool; // share of R
    uint128 toLPs; // share of R, vested
    uint128 rebate; // from the rebate pool to rebateTo
    address tipTo;
}
```

## `src/interfaces/ITouchstoneErrors.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolId} from "v4-core/types/PoolId.sol";

/// @notice Every custom error in Touchstone, except URC-4's MissingHookData and MalformedHookData.
interface ITouchstoneErrors {
    error Touchstone__NotFactory();
    error Touchstone__NotSettler();
    error Touchstone__NotLicence();
    error Touchstone__PoolNotRegistered(PoolId id);
    error Touchstone__ConfigOutOfBounds(uint8 field);
    error Touchstone__DynamicFeeNotSupported();
    error Touchstone__RecordClosed(PoolId id, uint64 recordId);
    error Touchstone__TooEarly(uint256 t0);
    error Touchstone__NotExpired(uint256 expiresAt);
    error Touchstone__PayoutMismatch();
    error Touchstone__GuardFailed(uint8 which);
    error Touchstone__DeadlinePassed();
    error Touchstone__LicenceDisabled(PoolId id);
    error Touchstone__BidTooLow(uint128 minimum);
    error Touchstone__DepositBelowNotice(uint256 minimum);
    error Touchstone__NotLeaseOwner();
    error Touchstone__QuoteNotErc20();
    error Touchstone__NothingToClaim();
    // Raised by the math libraries.
    error Touchstone__NonPositivePrice();
    error Touchstone__ExponentOutOfRange(int256 exponent);
    error Touchstone__RetainedAboveDeposit(uint256 retained, uint256 deposit);
    error Touchstone__ZeroHorizon();
}
```

## `src/libraries/BlockLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Arbitrum's precompile for the L2 block number.
interface IArbSys {
    /// @return The current L2 block number.
    function arbBlockNumber() external view returns (uint256);
}

/// @title BlockLib
/// @notice The block number the first-touch rule uses.
/// @dev On Arbitrum and its Orbit chains `block.number` returns an approximate parent-chain block
/// number, so many L2 blocks share one value. The source is a constructor immutable chosen by the
/// deploy script, never a chain-ID check, so a new Orbit chain needs no code change.
library BlockLib {
    uint8 internal constant SOURCE_EVM = 0;
    uint8 internal constant SOURCE_ARBSYS = 1;

    /// @dev ArbSys lives at address 0x64 on every Arbitrum chain.
    IArbSys internal constant ARBSYS = IArbSys(address(100));

    /// @notice The block number for `source`.
    /// @param source SOURCE_EVM or SOURCE_ARBSYS.
    /// @return The block number, truncated to 64 bits, which no chain will exceed.
    function number(uint8 source) internal view returns (uint64) {
        if (source == SOURCE_ARBSYS) return uint64(ARBSYS.arbBlockNumber());
        return uint64(block.number);
    }
}
```

## `src/libraries/FlowBucketLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title FlowBucketLib
/// @notice Two leaky buckets per pool, one per direction, that catch arbitrage split into small swaps.
/// @dev Both buckets share one timestamp in PoolState slot B, so every update drains both to the
/// same time before adding to one of them. Levels are stored plus one so the slot never returns to
/// zero, which keeps every later write a 2,900-gas reset instead of a 20,000-gas set.
library FlowBucketLib {
    uint256 internal constant MAX_LEVEL = type(uint104).max - 1;

    /// @notice Drain both buckets to `nowTs`, add `notional` to one, and report whether it is full.
    /// @param storedBuy Stored buy level, plus one; zero means never written.
    /// @param storedSell Stored sell level, plus one.
    /// @param lastTime Time of the last update.
    /// @param nowTs Current block timestamp.
    /// @param nMin Threshold at which a bucket flags, in quote units.
    /// @param horizon Seconds for a full bucket to drain to empty.
    /// @param notional This swap's notional in quote units.
    /// @param isBuy True if this swap buys the risky asset.
    /// @return newBuy New stored buy level, plus one.
    /// @return newSell New stored sell level, plus one.
    /// @return hit True if this swap's bucket holds at least nMin after adding `notional`.
    function update(
        uint104 storedBuy,
        uint104 storedSell,
        uint40 lastTime,
        uint40 nowTs,
        uint256 nMin,
        uint32 horizon,
        uint256 notional,
        bool isBuy
    ) internal pure returns (uint104 newBuy, uint104 newSell, bool hit) {
        if (horizon == 0) revert ITouchstoneErrors.Touchstone__ZeroHorizon();
        // A timestamp never moves backwards within a chain, so nowTs >= lastTime.
        uint256 drained = (nMin * (nowTs - lastTime)) / horizon;
        uint256 buy = _drain(storedBuy, drained);
        uint256 sell = _drain(storedSell, drained);
        if (isBuy) {
            buy = _add(buy, notional);
            hit = buy >= nMin;
        } else {
            sell = _add(sell, notional);
            hit = sell >= nMin;
        }
        // buy, sell <= MAX_LEVEL, so plus one fits in 104 bits.
        unchecked {
            newBuy = uint104(buy + 1);
            newSell = uint104(sell + 1);
        }
    }

    function _drain(uint104 stored, uint256 drained) private pure returns (uint256) {
        uint256 level = stored == 0 ? 0 : uint256(stored) - 1;
        return level > drained ? level - drained : 0;
    }

    function _add(uint256 level, uint256 notional) private pure returns (uint256) {
        uint256 sum = level + notional;
        return sum > MAX_LEVEL ? MAX_LEVEL : sum;
    }
}
```

## `src/libraries/PriceLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/libraries/FixedPoint96.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title PriceLib
/// @notice The one place where prices change units. Every price Touchstone compares is quote base
/// units per risky base unit, scaled by 1e36.
/// @dev Pyth prices are (price, expo) pairs in USD per whole token; token decimals then move them to
/// base units. Getting either wrong mis-scales every markout, so this library is fuzzed against an
/// exact rational implementation (research/reference/touchstone_ref.py).
library PriceLib {
    /// @dev 1e36, not 1e18: an 18-decimal token worth $0.0001 against 6-decimal USDC has a base-unit
    /// ratio of 1e-16, which 1e18 would hold to two significant digits. Across the whole v4 price
    /// range a 1e36-scaled price stays below 2**248.
    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;
    /// @dev 10**76 is the largest power of ten below 2**256.
    int256 internal constant MAX_POW10 = 76;

    /// @notice P* from two Pyth USD prices.
    /// @param pBase Pyth price of the risky asset.
    /// @param eBase Pyth exponent of the risky asset.
    /// @param pQuote Pyth price of the quote asset.
    /// @param eQuote Pyth exponent of the quote asset.
    /// @param decRisky Decimals of the risky token (18 for native ETH).
    /// @param decQuote Decimals of the quote token.
    /// @return priceX36 Quote base units per risky base unit, times 1e36, rounded down.
    function fairPriceX36(int64 pBase, int32 eBase, int64 pQuote, int32 eQuote, uint8 decRisky, uint8 decQuote)
        internal
        pure
        returns (uint256 priceX36)
    {
        if (pBase <= 0 || pQuote <= 0) revert ITouchstoneErrors.Touchstone__NonPositivePrice();
        int256 k = int256(eBase) - int256(eQuote) + int256(uint256(decQuote)) - int256(uint256(decRisky)) + 36;
        if (k > MAX_POW10 || k < -MAX_POW10) revert ITouchstoneErrors.Touchstone__ExponentOutOfRange(k);
        uint256 base = uint256(int256(pBase));
        uint256 quote = uint256(int256(pQuote));
        if (k >= 0) return FullMath.mulDiv(base, 10 ** uint256(k), quote);
        return base / (quote * 10 ** uint256(-k));
    }

    /// @notice Pyth confidence of the ratio, conf_b/p_b + conf_q/p_q, in basis points, rounded up.
    /// @dev Rounding up widens the deadband, which can only lower what LPs retain.
    function confBpsUp(int64 pBase, uint64 confBase, int64 pQuote, uint64 confQuote) internal pure returns (uint256) {
        if (pBase <= 0 || pQuote <= 0) revert ITouchstoneErrors.Touchstone__NonPositivePrice();
        uint256 b = uint256(int256(pBase));
        uint256 q = uint256(int256(pQuote));
        uint256 num = (uint256(confBase) * q + uint256(confQuote) * b) * BPS;
        return FullMath.mulDivRoundingUp(num, 1, b * q);
    }

    /// @notice The pool's price as quote base units per risky base unit, times 1e36.
    /// @param sqrtPriceX96 Pool sqrt price, token1 per token0.
    /// @param riskyIs0 True if currency0 is the risky asset.
    function poolPriceX36(uint160 sqrtPriceX96, bool riskyIs0) internal pure returns (uint256) {
        uint256 q192 = uint256(FixedPoint96.Q96) << 96;
        if (sqrtPriceX96 <= type(uint128).max) {
            // The square fits in 256 bits, so one mulDiv keeps every digit.
            uint256 sq = uint256(sqrtPriceX96) * sqrtPriceX96;
            return riskyIs0 ? FullMath.mulDiv(sq, PRICE_SCALE, q192) : FullMath.mulDiv(PRICE_SCALE, q192, sq);
        }
        // Above 2^128 the square needs two steps; the first rounding is below 2^-32 relative here.
        uint256 p96 = FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, FixedPoint96.Q96);
        return riskyIs0
            ? FullMath.mulDiv(p96, PRICE_SCALE, FixedPoint96.Q96)
            : FullMath.mulDiv(PRICE_SCALE, FixedPoint96.Q96, p96);
    }

    /// @notice The sqrt price, token1 per token0, at which the pool would quote `priceX36`.
    function sqrtPriceX96At(uint256 priceX36, bool riskyIs0) internal pure returns (uint160) {
        return riskyIs0 ? _sqrtRatioX96(priceX36, PRICE_SCALE) : _sqrtRatioX96(PRICE_SCALE, priceX36);
    }

    /// @notice Signed gap s * (ref - pool) / ref in basis points; positive means the swap trades toward the reference.
    /// @param refX36 Reference price, same units as poolX36.
    /// @param poolX36 Pre-swap pool price.
    /// @param buysRisky True if the swap buys the risky asset.
    function signedGapBps(uint256 refX36, uint256 poolX36, bool buysRisky) internal pure returns (int256) {
        int256 diff = int256(refX36) - int256(poolX36);
        int256 gap = (diff * int256(BPS)) / int256(refX36);
        return buysRisky ? gap : -gap;
    }

    /// @dev sqrt(num / den) * 2^96. Below a ratio of 2^64 the square is taken at full 2^192 scale;
    /// above it at 2^128 and shifted, which still leaves at least 96 significant bits.
    function _sqrtRatioX96(uint256 num, uint256 den) private pure returns (uint160) {
        if (num / den < (uint256(1) << 64)) return uint160(_sqrt(FullMath.mulDiv(num, uint256(1) << 192, den)));
        return uint160(_sqrt(FullMath.mulDiv(num, uint256(1) << 128, den)) << 32);
    }

    /// @dev Babylonian square root, rounded down.
    function _sqrt(uint256 x) private pure returns (uint256 r) {
        if (x == 0) return 0;
        r = 1 << ((_log2(x) >> 1) + 1);
        // Each step at least halves the error; seven steps converge from a power-of-two start.
        for (uint256 i; i < 7; ++i) {
            r = (r + x / r) >> 1;
        }
        uint256 down = x / r;
        return r < down ? r : down;
    }

    function _log2(uint256 x) private pure returns (uint256 n) {
        for (uint256 s = 128; s > 0; s >>= 1) {
            if (x >= (uint256(1) << s)) {
                x >>= s;
                n += s;
            }
        }
    }
}
```

## `src/libraries/DepositLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @title DepositLib
/// @notice Deposit size for a flagged swap: D = N * min(deltaMax, max(delta, beta * g+)), or N * delta_c
/// for a closure record.
/// @dev Scaling with the pre-swap gap g keeps the cap from binding on large dislocations, which is
/// where most toxic markout sits.
library DepositLib {
    uint8 internal constant MODE_CONTINUOUS = 0;
    uint8 internal constant MODE_CLOSED = 1;
    uint256 internal constant BPS = 10_000;

    /// @notice Deposit rate in basis points.
    /// @param mode MODE_CONTINUOUS or MODE_CLOSED.
    /// @param gapBps Signed pre-swap gap to the reference, positive toward it; 0 when no reference.
    /// @param deltaBps Floor rate delta.
    /// @param deltaMaxBps Cap delta_max.
    /// @param betaX100 Gap multiplier beta, times 100.
    /// @param deltaClosedBps Closure rate delta_c.
    function rateBps(
        uint8 mode,
        int256 gapBps,
        uint16 deltaBps,
        uint16 deltaMaxBps,
        uint16 betaX100,
        uint16 deltaClosedBps
    ) internal pure returns (uint256) {
        if (mode == MODE_CLOSED) return deltaClosedBps;
        uint256 gPlus = gapBps > 0 ? uint256(gapBps) : 0;
        uint256 scaled = (uint256(betaX100) * gPlus) / 100;
        uint256 rate = scaled > deltaBps ? scaled : deltaBps;
        return rate < deltaMaxBps ? rate : deltaMaxBps;
    }

    /// @notice Deposit in quote units, rounded down.
    function quoteAmount(uint256 notionalQuote, uint256 rate) internal pure returns (uint256) {
        return FullMath.mulDiv(notionalQuote, rate, BPS);
    }

    /// @notice Deposit converted into the risky token at the swap's own execution price, rounded down.
    /// @dev No oracle is read at swap time; the execution price comes from the swap's own delta.
    /// @param depositQuote Deposit in quote units.
    /// @param riskyAmount Risky base units the swap moved (AMM part, absolute).
    /// @param quoteAmountAbs Quote base units the swap moved (AMM part, absolute).
    function toRisky(uint256 depositQuote, uint256 riskyAmount, uint256 quoteAmountAbs)
        internal
        pure
        returns (uint256)
    {
        return FullMath.mulDiv(depositQuote, riskyAmount, quoteAmountAbs);
    }
}
```

## `src/libraries/SettlementMath.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {Payout} from "../types/Payout.sol";
import {ITouchstoneErrors} from "../interfaces/ITouchstoneErrors.sol";

/// @title SettlementMath
/// @notice Markout, regime, clawback and split. Pure functions, shared by the Settler, the lens and
/// the tests, so the contract and the research replay compute the same numbers.
/// @dev R rounds down and the refund is D - R, so refund + R = D exactly (invariant I3).
library SettlementMath {
    uint256 internal constant PRICE_SCALE = 1e36;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant PIPS = 1_000_000;
    uint8 internal constant MODE_CLOSED = 1;

    /// @notice Inputs to the split, all in the deposit currency.
    struct SplitParams {
        uint16 tipBps;
        uint128 tipCap;
        uint16 protocolShareBps;
        uint16 rhoBps;
    }

    /// @notice m = x_r * P* + x_q, from the trader's signed receipts, rounded toward negative infinity.
    /// @param xRisky Risky base units the trader received (negative if paid).
    /// @param xQuote Quote base units the trader received (negative if paid).
    /// @param priceX36 P*, quote base units per risky base unit, times 1e36.
    /// @return Markout in quote units; positive means the trader beat P* after the fee.
    function markout(int256 xRisky, int256 xQuote, uint256 priceX36) internal pure returns (int256) {
        // |x_r| * P* needs 512 bits in the worst case, so the product goes through mulDiv.
        // Rounding is toward negative infinity: down for receipts, up in magnitude for payments.
        if (xRisky >= 0) {
            return SafeCast.toInt256(FullMath.mulDiv(uint256(xRisky), priceX36, PRICE_SCALE)) + xQuote;
        }
        uint256 paid = FullMath.mulDivRoundingUp(uint256(-xRisky), priceX36, PRICE_SCALE);
        return xQuote - SafeCast.toInt256(paid);
    }

    /// @notice The LPs' share for a record.
    /// @param mode 0 continuous, 1 closure.
    /// @param licenceActive A lease was live when the swap executed.
    /// @param byHolder The swap was the holder's first touch in its block.
    /// @param inBand |p_pre - P*| <= G * P*.
    function alphaBps(
        uint8 mode,
        bool licenceActive,
        bool byHolder,
        bool inBand,
        uint16 alpha,
        uint16 alphaLicensed,
        uint16 alphaClosed
    ) internal pure returns (uint16) {
        if (mode == MODE_CLOSED) return alphaClosed;
        if (!licenceActive || !inBand) return alpha;
        return byHolder ? 0 : alphaLicensed;
    }

    /// @notice R = min(D, alpha * max(0, m+ - eps_eff * N+)), in quote units, rounded down.
    /// @param depositQuote The deposit's value in quote units.
    /// @param mPlus Markout of the in-the-money part, quote units.
    /// @param nPlus Notional of the in-the-money part, quote units.
    /// @param epsBps Margin eps.
    /// @param confBps Pyth confidence c*, added to eps.
    /// @param alpha LPs' share for this record.
    function clawback(uint256 depositQuote, int256 mPlus, uint256 nPlus, uint256 epsBps, uint256 confBps, uint256 alpha)
        internal
        pure
        returns (uint256)
    {
        if (mPlus <= 0 || alpha == 0) return 0;
        uint256 margin = FullMath.mulDiv(nPlus, epsBps + confBps, BPS);
        uint256 m = uint256(mPlus);
        if (m <= margin) return 0;
        uint256 r = FullMath.mulDiv(alpha, m - margin, BPS);
        return r < depositQuote ? r : depositQuote;
    }

    /// @notice Split a retained amount. Tip first, then the protocol share, then rho to the rebate pool.
    /// @param deposit Record deposit, deposit currency.
    /// @param retained R, deposit currency.
    /// @param p Split parameters; tipCap already converted to the deposit currency.
    /// @param tipTo The settlement caller.
    function splitRetained(uint128 deposit, uint128 retained, SplitParams memory p, address tipTo)
        internal
        pure
        returns (Payout memory out)
    {
        if (retained > deposit) revert ITouchstoneErrors.Touchstone__RetainedAboveDeposit(retained, deposit);
        uint256 tip = FullMath.mulDiv(retained, p.tipBps, BPS);
        if (tip > p.tipCap) tip = p.tipCap;
        // tip <= retained, toProtocol <= rest and toRebate <= rest, so nothing underflows, and every
        // amount is at most deposit < 2^128, so the uint128 casts cannot truncate.
        unchecked {
            uint256 rest = retained - tip;
            uint256 toProtocol = FullMath.mulDiv(rest, p.protocolShareBps, BPS);
            rest -= toProtocol;
            uint256 toRebate = FullMath.mulDiv(rest, p.rhoBps, BPS);
            out = Payout({
                benign: false,
                refund: uint128(deposit - retained),
                tip: uint128(tip),
                toProtocol: uint128(toProtocol),
                toRebatePool: uint128(toRebate),
                toLPs: uint128(rest - toRebate),
                rebate: 0,
                tipTo: tipTo
            });
        }
    }

    /// @notice Benign record: full refund and a rebate of min(kappa * f * N, pool), with the tip taken from it.
    /// @param deposit Record deposit.
    /// @param notional Record notional, converted to the deposit currency.
    /// @param feePips The pool's static LP fee in pips.
    /// @param kappaBps Rebate as a share of the fee.
    /// @param rebatePool Rebate pool balance in the deposit currency.
    function benign(
        uint128 deposit,
        uint256 notional,
        uint24 feePips,
        uint16 kappaBps,
        uint128 rebatePool,
        uint16 tipBps,
        uint128 tipCap,
        address tipTo
    ) internal pure returns (Payout memory out) {
        uint256 gross = FullMath.mulDiv(notional, uint256(feePips) * kappaBps, PIPS * BPS);
        // gross <= rebatePool < 2^128 and tip <= gross, so the casts below cannot truncate.
        if (gross > rebatePool) gross = rebatePool;
        uint256 tip = FullMath.mulDiv(gross, tipBps, BPS);
        if (tip > tipCap) tip = tipCap;
        out = Payout({
            benign: true,
            refund: uint128(deposit),
            tip: uint128(tip),
            toProtocol: 0,
            toRebatePool: 0,
            toLPs: 0,
            rebate: uint128(gross - tip),
            tipTo: tipTo
        });
    }

    /// @notice The conservation check finalize runs before it pays anything.
    function conserves(Payout memory p, uint256 deposit, uint256 rebatePool) internal pure returns (bool) {
        if (p.benign) {
            return p.refund == deposit && p.toProtocol == 0 && p.toRebatePool == 0 && p.toLPs == 0
                && uint256(p.tip) + p.rebate <= rebatePool;
        }
        return p.rebate == 0 && uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs == deposit;
    }
}
```

## `src/libraries/ItmLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";

/// @title ItmLib
/// @notice In-the-money accounting: the part of a swap executed before the pool price crossed P*.
/// @dev Units traded past P* lose money to the trader, so counting them would dilute the markout
/// and let an arbitrageur pad its swap until its average markout falls inside the margin. This
/// library recomputes the in-the-money leg at the record's pre-swap liquidity. A swap that crossed
/// initialized ticks makes that an approximation; differential tests compare it with an exact
/// tick-by-tick replay in the research package.
library ItmLib {
    uint256 internal constant PIPS = 1_000_000;

    /// @notice Amounts for the in-the-money leg, signed from the trader's side (receipts positive).
    /// @param zeroForOne Swap direction.
    /// @param sqrtBefore Pre-swap sqrt price.
    /// @param sqrtAfter Post-swap sqrt price.
    /// @param sqrtFair sqrt price at P*.
    /// @param liquidity Pre-swap in-range liquidity.
    /// @param feePips LP fee, used to gross up the input.
    /// @return amount0 Trader's currency0 delta for the leg.
    /// @return amount1 Trader's currency1 delta for the leg.
    /// @return overshot True if the swap crossed P*, so the leg is shorter than the swap.
    function leg(
        bool zeroForOne,
        uint160 sqrtBefore,
        uint160 sqrtAfter,
        uint160 sqrtFair,
        uint128 liquidity,
        uint24 feePips
    ) internal pure returns (int256 amount0, int256 amount1, bool overshot) {
        if (zeroForOne) {
            // Price falls. Only units sold while the pool was above P* are in the money.
            if (sqrtFair >= sqrtBefore) return (0, 0, true);
            uint160 end = sqrtAfter > sqrtFair ? sqrtAfter : sqrtFair;
            overshot = sqrtAfter < sqrtFair;
            uint256 inNet = SqrtPriceMath.getAmount0Delta(end, sqrtBefore, liquidity, true);
            uint256 out = SqrtPriceMath.getAmount1Delta(end, sqrtBefore, liquidity, false);
            amount0 = -SafeCast.toInt256(_grossUp(inNet, feePips));
            amount1 = SafeCast.toInt256(out);
        } else {
            if (sqrtFair <= sqrtBefore) return (0, 0, true);
            uint160 end = sqrtAfter < sqrtFair ? sqrtAfter : sqrtFair;
            overshot = sqrtAfter > sqrtFair;
            uint256 inNet = SqrtPriceMath.getAmount1Delta(sqrtBefore, end, liquidity, true);
            uint256 out = SqrtPriceMath.getAmount0Delta(sqrtBefore, end, liquidity, false);
            amount0 = SafeCast.toInt256(out);
            amount1 = -SafeCast.toInt256(_grossUp(inNet, feePips));
        }
    }

    /// @dev Input including the LP fee, as v4's SwapMath charges it on exact input.
    function _grossUp(uint256 amountNet, uint24 feePips) private pure returns (uint256) {
        return FullMath.mulDivRoundingUp(amountNet, PIPS, PIPS - feePips);
    }
}
```

## `src/libraries/VestingLib.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/libraries/FullMath.sol";

/// @title VestingLib
/// @notice Releases retained value and rent to in-range LPs gradually, so a JIT position must stay
/// in range for about one vesting period to share in it.
library VestingLib {
    /// @notice Amount to donate now: vest * min(1, elapsed / period), rounded down.
    /// @param vest Buffer balance not yet donated.
    /// @param elapsed Seconds since the last drip.
    /// @param period vestPeriod from PoolConfig.
    function releasable(uint256 vest, uint256 elapsed, uint256 period) internal pure returns (uint256) {
        if (elapsed >= period) return vest;
        return FullMath.mulDiv(vest, elapsed, period);
    }
}
```

## `test/mocks/MockArbSys.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Test double for Arbitrum's ArbSys precompile, etched at address(100) in tests only.
contract MockArbSys {
    uint256 public arbBlockNumber;

    function setBlock(uint256 n) external {
        arbBlockNumber = n;
    }
}
```

## `test/ReferenceLibs.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {BlockLib} from "../src/libraries/BlockLib.sol";
import {FlowBucketLib} from "../src/libraries/FlowBucketLib.sol";
import {PriceLib} from "../src/libraries/PriceLib.sol";
import {DepositLib} from "../src/libraries/DepositLib.sol";
import {SettlementMath} from "../src/libraries/SettlementMath.sol";
import {ItmLib} from "../src/libraries/ItmLib.sol";
import {VestingLib} from "../src/libraries/VestingLib.sol";
import {Payout} from "../src/types/Payout.sol";
import {ITouchstoneErrors} from "../src/interfaces/ITouchstoneErrors.sol";
import {MockArbSys} from "./mocks/MockArbSys.sol";

/// @dev External wrappers so reverts happen one call frame below the test.
contract Harness {
    function fairPrice(int64 pb, int32 eb, int64 pq, int32 eq, uint8 dr, uint8 dq) external pure returns (uint256) {
        return PriceLib.fairPriceX36(pb, eb, pq, eq, dr, dq);
    }

    function split(uint128 d, uint128 r) external pure returns (Payout memory) {
        return SettlementMath.splitRetained(d, r, SettlementMath.SplitParams(200, 5e6, 0, 1000), address(1));
    }

    function blockNumber(uint8 source) external view returns (uint64) {
        return BlockLib.number(source);
    }
}

contract ReferenceLibsTest is Test {
    uint256 internal constant USDC = 1e6;
    Harness internal h;

    function setUp() public {
        h = new Harness();
    }

    // --- Worked example, spec §4.7 -------------------------------------------------------------

    function _row(uint256 notionalUsd, int256 markoutUsd, uint16 alpha) internal pure returns (uint256 d, uint256 r) {
        uint256 n = notionalUsd * USDC;
        d = DepositLib.quoteAmount(n, DepositLib.rateBps(0, 0, 30, 300, 125, 300));
        r = SettlementMath.clawback(d, markoutUsd * int256(USDC), n, 2, 0, alpha);
    }

    function test_WorkedExample_MatchesReport() public pure {
        (uint256 d, uint256 r) = _row(500_000, 500, 8000);
        assertEq(d, 1_500 * USDC);
        assertEq(r, 320 * USDC);
        (d, r) = _row(200_000, 20, 8000);
        assertEq(d, 600 * USDC);
        assertEq(r, 0);
        (d, r) = _row(20_000, -3, 8000);
        assertEq(d, 60 * USDC);
        assertEq(r, 0);
        (d, r) = _row(500_000, 500, 9500);
        assertEq(r, 380 * USDC);
    }

    function test_Clawback_CapBindsAtDeposit() public pure {
        // Python vector: m = $5,000 on $500,000 with c* = 1 bp; alpha * excess exceeds D.
        assertEq(SettlementMath.clawback(1_500 * USDC, 5_000 * int256(USDC), 500_000 * USDC, 2, 1, 8000), 1_500 * USDC);
    }

    function test_SplitArbitrage_MatchesReference() public view {
        Payout memory p = h.split(uint128(1_500 * USDC), uint128(320 * USDC));
        assertEq(p.refund, 1_180 * USDC);
        assertEq(p.tip, 5 * USDC); // 2% of $320 is $6.40, capped at $5
        assertEq(p.toRebatePool, 31_500_000);
        assertEq(p.toLPs, 283_500_000);
        assertTrue(SettlementMath.conserves(p, 1_500 * USDC, 0));
    }

    function test_Benign_RebateMatchesReference() public pure {
        Payout memory p = SettlementMath.benign(
            uint128(600 * USDC), 200_000 * USDC, 500, 4000, uint128(1_000 * USDC), 200, 5e6, address(1)
        );
        assertEq(p.refund, 600 * USDC);
        assertEq(p.tip, 800_000);
        assertEq(p.rebate, 39_200_000);
        assertTrue(SettlementMath.conserves(p, 600 * USDC, 1_000 * USDC));
    }

    // --- Pyth conversion against the Python vectors --------------------------------------------

    function test_FairPrice_PythonVectors() public view {
        assertEq(h.fairPrice(300000000000, -8, 100000000, -8, 18, 6), 3000000000000000000000000000);
        assertEq(h.fairPrice(6123456789, -8, 99990000, -8, 8, 6), 612406919591959195919591959195919591);
        assertEq(h.fairPrice(2512345, -5, 100001234, -8, 18, 18), 25123139980452641214407414212508617643);
    }

    function test_Conf_PythonVector() public pure {
        assertEq(PriceLib.confBpsUp(300000000000, 150000000, 100000000, 5000), 6);
    }

    function test_FairPrice_RevertsOnNonPositive() public {
        vm.expectRevert(ITouchstoneErrors.Touchstone__NonPositivePrice.selector);
        h.fairPrice(0, -8, 1e8, -8, 18, 6);
    }

    function test_Split_RevertsWhenRetainedAboveDeposit() public {
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__RetainedAboveDeposit.selector, 2, 1));
        h.split(1, 2);
    }

    // --- Flow bucket ---------------------------------------------------------------------------

    function test_FlowBucket_PythonVector() public pure {
        (uint104 buy, uint104 sell, bool hit) =
            FlowBucketLib.update(uint104(90_000 * USDC + 1), 0, 100, 106, 100_000 * USDC, 12, 30_000 * USDC, true);
        assertEq(buy, 70_000 * USDC + 1);
        assertEq(sell, 1);
        assertFalse(hit);
    }

    function testFuzz_FlowBucket_SplitTradeFillsLikeOne(uint96 piece, uint8 count) public pure {
        // A trade split into `count` pieces inside one second fills the bucket as the whole trade would.
        vm.assume(count > 0);
        uint256 nMin = 100_000 * USDC;
        uint104 buy;
        uint104 sell;
        bool hit;
        for (uint256 i; i < count; ++i) {
            (buy, sell, hit) = FlowBucketLib.update(buy, sell, 1_000, 1_000, nMin, 12, piece, true);
        }
        uint256 total = uint256(piece) * count;
        if (total > FlowBucketLib.MAX_LEVEL) total = FlowBucketLib.MAX_LEVEL;
        assertEq(buy, total + 1);
        assertEq(hit, total >= nMin);
    }

    // --- Markout, split and conservation fuzz --------------------------------------------------

    function testFuzz_Markout_IsFloor(int96 xRisky, int128 xQuote, uint128 price) public pure {
        int256 m = SettlementMath.markout(xRisky, xQuote, price);
        int256 exact = int256(xRisky) * int256(uint256(price));
        // m - xQuote is the largest integer q with q * 1e36 <= exact.
        int256 q = m - xQuote;
        assertLe(q * 1e36, exact);
        assertGt((q + 1) * 1e36, exact);
    }

    function test_Markout_ArbitrageRow() public pure {
        // Buy 500,500 / 3,000 ETH for $500,000 at P* = $3,000: markout is $500, less one unit of rounding.
        uint256 p = 3000 * 1e6 * 1e36 / 1e18;
        int256 xRisky = int256(uint256(1e18) * 500_500 / 3000);
        int256 m = SettlementMath.markout(xRisky, -500_000 * int256(USDC), p);
        assertEq(m, 499_999_999);
    }

    function testFuzz_Clawback_Bounded(uint128 d, int128 m, uint128 n, uint16 eps, uint16 conf, uint16 alpha)
        public
        pure
    {
        eps = uint16(bound(eps, 0, 500));
        conf = uint16(bound(conf, 0, 200));
        alpha = uint16(bound(alpha, 0, 9900));
        uint256 r = SettlementMath.clawback(d, m, n, eps, conf, alpha);
        assertLe(r, d);
        if (m <= 0) assertEq(r, 0);
    }

    function testFuzz_Split_Conserves(uint128 d, uint128 r, uint16 tipBps, uint128 tipCap, uint16 proto, uint16 rho)
        public
        pure
    {
        r = uint128(bound(r, 0, d));
        SettlementMath.SplitParams memory p = SettlementMath.SplitParams(
            uint16(bound(tipBps, 0, 2000)), tipCap, uint16(bound(proto, 0, 5000)), uint16(bound(rho, 0, 3000))
        );
        Payout memory out = SettlementMath.splitRetained(d, r, p, address(1));
        assertTrue(SettlementMath.conserves(out, d, 0));
        assertEq(uint256(out.refund) + r, d);
    }

    function testFuzz_Benign_NeverExceedsPool(uint128 d, uint128 n, uint24 fee, uint16 kappa, uint128 pool)
        public
        pure
    {
        fee = uint24(bound(fee, 1, 100_000));
        kappa = uint16(bound(kappa, 0, 9000));
        Payout memory out = SettlementMath.benign(d, n, fee, kappa, pool, 200, 5e6, address(1));
        assertTrue(SettlementMath.conserves(out, d, pool));
        assertLe(uint256(out.rebate) + out.tip, (uint256(n) * fee * kappa) / 1e10 + 1);
    }

    // --- Price conversions ---------------------------------------------------------------------

    function testFuzz_SqrtPrice_RoundTrip(uint256 priceX36, bool riskyIs0) public pure {
        // Base-unit ratios from 1e-18 to 1e30 quote per risky, which covers both sides of 2^128.
        priceX36 = bound(priceX36, 1e18, 1e66);
        uint160 s = PriceLib.sqrtPriceX96At(priceX36, riskyIs0);
        uint256 back = PriceLib.poolPriceX36(s, riskyIs0);
        // A Q64.96 sqrt price holds about 29 significant digits; the round trip loses well under 1e-12.
        assertApproxEqRel(back, priceX36, 1e6);
    }

    function test_SignedGap() public pure {
        assertEq(PriceLib.signedGapBps(3003e9, 3000e9, true), 9); // reference 0.1% above: buying moves toward it
        assertEq(PriceLib.signedGapBps(3003e9, 3000e9, false), -9);
    }

    // --- In-the-money leg ----------------------------------------------------------------------

    function test_Itm_NoOvershootEqualsWholeSwap() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        uint160 afterP = TickMath.getSqrtPriceAtTick(-60);
        uint160 fair = TickMath.getSqrtPriceAtTick(-100); // fair below where the swap stopped
        uint128 liq = 1e21;
        (int256 a0, int256 a1, bool over) = ItmLib.leg(true, before, afterP, fair, liq, 500);
        assertFalse(over);
        uint256 in0 = SqrtPriceMath.getAmount0Delta(afterP, before, liq, true);
        uint256 out1 = SqrtPriceMath.getAmount1Delta(afterP, before, liq, false);
        assertEq(a1, int256(out1));
        assertGt(-a0, int256(in0)); // input grossed up by the fee
    }

    function test_Itm_OvershootStopsAtFair() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        uint160 afterP = TickMath.getSqrtPriceAtTick(-100);
        uint160 fair = TickMath.getSqrtPriceAtTick(-60);
        uint128 liq = 1e21;
        (, int256 a1, bool over) = ItmLib.leg(true, before, afterP, fair, liq, 500);
        assertTrue(over);
        assertEq(a1, int256(SqrtPriceMath.getAmount1Delta(fair, before, liq, false)));
    }

    function test_Itm_WrongSideIsEmpty() public pure {
        uint160 before = TickMath.getSqrtPriceAtTick(0);
        (int256 a0, int256 a1, bool over) =
            ItmLib.leg(true, before, TickMath.getSqrtPriceAtTick(-60), TickMath.getSqrtPriceAtTick(10), 1e21, 500);
        assertEq(a0, 0);
        assertEq(a1, 0);
        assertTrue(over);
    }

    // --- Vesting and block numbers -------------------------------------------------------------

    function testFuzz_Vesting_NeverAboveBuffer(uint128 vest, uint32 elapsed, uint32 period) public pure {
        period = uint32(bound(period, 60, 86_400));
        assertLe(VestingLib.releasable(vest, elapsed, period), vest);
    }

    function test_BlockLib_ReadsArbSys() public {
        MockArbSys impl = new MockArbSys();
        vm.etch(address(100), address(impl).code);
        MockArbSys(address(100)).setBlock(123_456_789);
        vm.roll(21_000_000);
        assertEq(h.blockNumber(BlockLib.SOURCE_ARBSYS), 123_456_789);
        assertEq(h.blockNumber(BlockLib.SOURCE_EVM), 21_000_000);
    }
}
```

## `research/reference/touchstone_ref.py`

```python
"""Exact reference implementation of Touchstone's settlement math.

This module is the source of truth for differential tests. Every function uses
integers or Fractions, rounds exactly where the Solidity code rounds, and is
documented with the spec section it implements. Nothing here touches the
network.

Units
-----
* Quote amounts are integers in the quote token's base units.
* Risky amounts are integers in the risky token's base units.
* Prices are quote base units per risky base unit, scaled by 1e36 (PRICE_SCALE). 1e18 is not
  enough: an 18-decimal token worth $0.0001 against 6-decimal USDC has a base-unit ratio of 1e-16,
  which 1e18 would hold to two significant digits.
* Rates are basis points (1e4) unless named *_pips, which are Uniswap fee pips (1e6).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction

PRICE_SCALE = 10**36
BPS = 10_000
PIPS = 1_000_000
Q96 = 2**96

MODE_CONTINUOUS = 0
MODE_CLOSED = 1


def floor_div(a: int, b: int) -> int:
    """Floor division toward negative infinity, as the Solidity helpers use for signed values."""
    return a // b


# --- Pyth price conversion (spec: Settlement, step 4) -----------------------------------------


def fair_price_x36(
    p_base: int, e_base: int, p_quote: int, e_quote: int, dec_risky: int, dec_quote: int
) -> int:
    """P* in quote base units per risky base unit, times 1e36, rounded down.

    P* = (p_base * 10^e_base) / (p_quote * 10^e_quote) quote tokens per risky token,
    then * 10^dec_quote / 10^dec_risky to move to base units.
    """
    if p_base <= 0 or p_quote <= 0:
        raise ValueError("non-positive price")
    k = e_base - e_quote + dec_quote - dec_risky + 36
    if k >= 0:
        return (p_base * 10**k) // p_quote
    return p_base // (p_quote * 10 ** (-k))


def conf_bps_up(p_base: int, conf_base: int, p_quote: int, conf_quote: int) -> int:
    """c* = conf_b/p_b + conf_q/p_q in basis points, rounded up.

    Rounding up widens the deadband, which can only lower R, so rounding favours the trader.
    """
    num = (conf_base * p_quote + conf_quote * p_base) * BPS
    den = p_base * p_quote
    return -((-num) // den)


# --- Deposit (spec: TouchstoneHook, Deposit size and currency) --------------------------------


def deposit_rate_bps(
    mode: int, gap_bps: int, delta_bps: int, delta_max_bps: int, beta_x100: int, delta_closed_bps: int
) -> int:
    """min(delta_max, max(delta, beta * g+)) for continuous records; delta_c for closure records."""
    if mode == MODE_CLOSED:
        return delta_closed_bps
    g_plus = max(0, gap_bps)
    scaled = (beta_x100 * g_plus) // 100
    return min(delta_max_bps, max(delta_bps, scaled))


def deposit_quote(notional_quote: int, rate_bps: int) -> int:
    return (notional_quote * rate_bps) // BPS


def quote_to_risky(amount_quote: int, price_x36: int) -> int:
    """Convert at a price, rounding down."""
    return (amount_quote * PRICE_SCALE) // price_x36


def risky_to_quote(amount_risky: int, price_x36: int) -> int:
    return (amount_risky * price_x36) // PRICE_SCALE


# --- Flow bucket (spec: Triggers, Flow) ---------------------------------------------------------


def bucket_after(level: int, last_time: int, now: int, n_min: int, horizon: int, add: int) -> int:
    """Leaky bucket: drains at n_min / horizon per second, then adds this swap's notional."""
    drained = (n_min * (now - last_time)) // horizon
    return max(0, level - drained) + add


# --- Markout and clawback (spec §4.2 and §4.4) ----------


def markout_quote(x_risky: int, x_quote: int, price_x36: int) -> int:
    """m = x_r * P* + x_q from the trader's signed receipts, rounded toward negative infinity."""
    return floor_div(x_risky * price_x36, PRICE_SCALE) + x_quote


def alpha_for(
    mode: int,
    licence_active: bool,
    by_holder: bool,
    in_band: bool,
    alpha_bps: int,
    alpha_lic_bps: int,
    alpha_closed_bps: int,
) -> int:
    """Regime table from the Arbitrage licence section."""
    if mode == MODE_CLOSED:
        return alpha_closed_bps
    if not licence_active or not in_band:
        return alpha_bps
    if by_holder:
        return 0
    return alpha_lic_bps


def in_band(sqrt_price_before_x96: int, price_x36: int, risky_is_0: bool, band_bps: int) -> bool:
    """|p_pre - P*| <= G * P*, with p_pre taken from the record's pre-swap sqrt price."""
    pool_price = Fraction(sqrt_price_before_x96 * sqrt_price_before_x96, Q96 * Q96)
    p_pre = pool_price if risky_is_0 else 1 / pool_price
    p_star = Fraction(price_x36, PRICE_SCALE)
    return abs(p_pre - p_star) * BPS <= band_bps * p_star


def clawback_quote(
    deposit_quote_value: int,
    m_plus: int,
    n_plus: int,
    eps_bps: int,
    conf_bps: int,
    alpha_bps: int,
) -> int:
    """R = min(D, alpha * max(0, m+ - eps_eff * N+)), rounded down."""
    excess = m_plus - ((eps_bps + conf_bps) * n_plus) // BPS
    if excess <= 0 or alpha_bps == 0:
        return 0
    return min(deposit_quote_value, (alpha_bps * excess) // BPS)


@dataclass(frozen=True)
class Payout:
    benign: bool
    refund: int
    tip: int
    to_protocol: int
    to_rebate_pool: int
    to_lps: int
    rebate: int


def split_retained(deposit: int, r: int, tip_bps: int, tip_cap: int, protocol_bps: int, rho_bps: int) -> Payout:
    """Split R in the deposit currency. refund + tip + toProtocol + toRebatePool + toLPs == deposit."""
    if r > deposit:
        raise ValueError("R above deposit")
    tip = min(tip_cap, (r * tip_bps) // BPS)
    rest = r - tip
    to_protocol = (rest * protocol_bps) // BPS
    rest -= to_protocol
    to_rebate = (rest * rho_bps) // BPS
    to_lps = rest - to_rebate
    return Payout(False, deposit - r, tip, to_protocol, to_rebate, to_lps, 0)


def rebate_payout(
    deposit: int, notional_dep: int, fee_pips: int, kappa_bps: int, rebate_pool: int, tip_bps: int, tip_cap: int
) -> Payout:
    """Benign record: gross = min(kappa * f * N, pool); the tip comes out of gross."""
    gross = min((notional_dep * fee_pips * kappa_bps) // (PIPS * BPS), rebate_pool)
    tip = min(tip_cap, (gross * tip_bps) // BPS)
    return Payout(True, deposit, tip, 0, 0, 0, gross - tip)


def check_payout(p: Payout, deposit: int, rebate_pool: int) -> bool:
    """The conservation check the hook runs in finalize."""
    if p.benign:
        return (
            p.refund == deposit
            and p.to_protocol == p.to_rebate_pool == p.to_lps == 0
            and p.tip + p.rebate <= rebate_pool
        )
    return p.rebate == 0 and p.refund + p.tip + p.to_protocol + p.to_rebate_pool + p.to_lps == deposit


# --- Vesting (spec: Settlement, Vesting donations) ---------------------------------------------


def drip_amount(vest: int, elapsed: int, vest_period: int) -> int:
    return vest if elapsed >= vest_period else (vest * elapsed) // vest_period


# --- Licence lease (spec: Arbitrage licence, The lease) ----------------------------------------


def min_next_rent(top_rent: int, next_rent: int, min_rent: int, min_increment_bps: int) -> int:
    base = max(top_rent, next_rent)
    if base == 0:
        return min_rent
    raised = -((-base * (BPS + min_increment_bps)) // BPS)
    return max(min_rent, raised)


def rent_due(rent_per_s: int, deposit: int, since: int, now: int) -> tuple[int, int]:
    """Rent charged from `since` to `now`, and the time the deposit runs out."""
    lapse_at = since + deposit // rent_per_s
    end = min(now, lapse_at)
    return rent_per_s * max(0, end - since), lapse_at


# --- Economics used in the report ----------------------------------------------------------------


def break_even_recall(
    lvr_bps: float, fee_income_bps: float, arb_fee_bps: float, alpha: float, eps_bps: float, arb_share: float
) -> float:
    """r* = (L - F) / (alpha * (L - (f_arb + eps) * s)), spec §4.6.

    F is the pool's fee income per unit volume; f_arb is the fee the arbitrage flow itself pays,
    which comes off its markout because markouts are net of the LP fee. The report's headline
    uses f_arb = F.
    """
    return (lvr_bps - fee_income_bps) / (alpha * (lvr_bps - (arb_fee_bps + eps_bps) * arb_share))


def noise_tax_bps(alpha: float, sigma_bps: float, fee_bps: float, eps_bps: float) -> float:
    """E[R]/N for a benign trade whose markout before fee is N(0, sigma), normal approximation."""
    z = (fee_bps + eps_bps) / sigma_bps
    phi = math.exp(-z * z / 2) / math.sqrt(2 * math.pi)
    tail = 0.5 * math.erfc(z / math.sqrt(2))
    return alpha * sigma_bps * (phi - z * tail)


def horizon_sigma_bps(daily_vol: float, seconds: float) -> float:
    return daily_vol * math.sqrt(seconds / 86_400) * BPS


def wash_leg_loss(fee_bps: float, kappa: float, lp_share: float = 0.0) -> float:
    """Loss per unit notional of one wash leg before impact and gas; positive means the wash loses."""
    return fee_bps * (1 - kappa) - fee_bps * lp_share
```

## `research/reference/check_report_numbers.py`

```python
"""Reproduce every number the spec quotes from the report, and write test vectors.

Run: python3 -I check_report_numbers.py <out_dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import touchstone_ref as t  # noqa: E402

USDC = 10**6
results: dict[str, object] = {}

# Worked example: ETH/USDC, f = 5 bps, eps = 2 bps, alpha = 0.8, delta = 30 bps, alpha_lic = 0.95.
# Prices are quote base units per risky base unit x 1e36: $3,000 per ETH with 6 and 18 decimals.
P = t.fair_price_x36(3000_00000000, -8, 1_00000000, -8, 18, 6)
assert P == 3000 * 10**6 * 10**36 // 10**18, P

rows = []
for name, notional, markout, alpha in [
    ("arbitrage", 500_000, 500, 8000),
    ("benign_lucky", 200_000, 20, 8000),
    ("retail_first_touch", 20_000, -3, 8000),
    ("outsider_in_band", 500_000, 500, 9500),
]:
    n = notional * USDC
    m = markout * USDC
    d = t.deposit_quote(n, t.deposit_rate_bps(0, 0, 30, 300, 125, 300))
    r = t.clawback_quote(d, m, n, 2, 0, alpha)
    eff_bps = 5 + r * 10_000 / n
    rows.append({"swap": name, "deposit": d / USDC, "retained": r / USDC, "refund": (d - r) / USDC, "effective_fee_bps": round(eff_bps, 2)})
results["worked_example"] = rows
assert [row["retained"] for row in rows] == [320, 0, 0, 380]
assert [row["effective_fee_bps"] for row in rows] == [11.4, 5.0, 5.0, 12.6]

# Markout from receipts: buy 166.8333.. ETH for $500,000 at an all-in price below P* by 10 bps.
x_r = 10**18 * 500_500 // 3000  # risky received, so x_r * P* = $500,500
results["markout_from_receipts_usd"] = t.markout_quote(x_r, -500_000 * USDC, P) / USDC

# Break-even recall, spec §4.6.
results["break_even_recall_F6.3"] = round(t.break_even_recall(8.5, 6.3, 6.3, 0.8, 2, 0.29), 3)
results["break_even_recall_f5"] = round(t.break_even_recall(8.5, 6.3, 5.0, 0.8, 2, 0.29), 3)
results["recapture_coefficient_bps"] = round(0.8 * (8.5 - (6.3 + 2) * 0.29), 2)

# Noise tax, Closed-market mode.
results["noise_tax"] = {
    "weekend_closed_settings": round(t.noise_tax_bps(0.5, 150, 5, 50), 1),
    "weekend_continuous_settings": round(t.noise_tax_bps(0.8, 150, 5, 2), 1),
    "continuous_3s_vol3pct": {
        "sigma_bps": round(t.horizon_sigma_bps(0.03, 3), 2),
        "z": round(7 / t.horizon_sigma_bps(0.03, 3), 2),
        "tax_bps": t.noise_tax_bps(0.8, t.horizon_sigma_bps(0.03, 3), 5, 2),
    },
    "continuous_3s_vol5.2pct": {
        "z": round(7 / t.horizon_sigma_bps(0.052, 3), 2),
        "tax_bps": round(t.noise_tax_bps(0.8, t.horizon_sigma_bps(0.052, 3), 5, 2), 3),
    },
}

# Wash trading, Benign-flow rebates.
results["wash_leg_loss_bps_kappa0.4"] = t.wash_leg_loss(5, 0.4)
results["lp_self_wash_breakeven_share"] = 1 - 0.4

# Split and conservation on the arbitrage row, deposit in USDC.
d = 1_500 * USDC
r = 320 * USDC
p = t.split_retained(d, r, tip_bps=200, tip_cap=5 * USDC, protocol_bps=0, rho_bps=1000)
assert t.check_payout(p, d, 0)
results["split_arbitrage"] = {k: (v if isinstance(v, bool) else v / USDC) for k, v in p.__dict__.items()}

# Rebate on the large benign swap: kappa 40% of a 5 bp fee on $200,000 = $40.
rp = t.rebate_payout(600 * USDC, 200_000 * USDC, 500, 4000, 1_000 * USDC, 200, 5 * USDC)
assert t.check_payout(rp, 600 * USDC, 1_000 * USDC)
results["rebate_benign"] = {k: (v if isinstance(v, bool) else v / USDC) for k, v in rp.__dict__.items()}

# Lease: 10% increment rounds up; rent stops when the deposit runs out.
results["min_next_rent"] = t.min_next_rent(1001, 0, 1, 1000)
results["rent_due"] = t.rent_due(rent_per_s=10, deposit=36_000, since=0, now=4_000)

# Vectors for the Solidity differential tests.
vectors = {
    "fairPrice": [
        {"pBase": 3000_00000000, "eBase": -8, "pQuote": 1_00000000, "eQuote": -8, "decRisky": 18, "decQuote": 6,
         "out": str(t.fair_price_x36(3000_00000000, -8, 1_00000000, -8, 18, 6))},
        {"pBase": 6123456789, "eBase": -8, "pQuote": 99990000, "eQuote": -8, "decRisky": 8, "decQuote": 6,
         "out": str(t.fair_price_x36(6123456789, -8, 99990000, -8, 8, 6))},
        {"pBase": 2512345, "eBase": -5, "pQuote": 100001234, "eQuote": -8, "decRisky": 18, "decQuote": 18,
         "out": str(t.fair_price_x36(2512345, -5, 100001234, -8, 18, 18))},
    ],
    "conf": [{"pBase": 3000_00000000, "confBase": 150000000, "pQuote": 1_00000000, "confQuote": 5000,
              "out": t.conf_bps_up(3000_00000000, 150000000, 1_00000000, 5000)}],
    "clawback": [
        {"deposit": 1_500 * USDC, "mPlus": 500 * USDC, "nPlus": 500_000 * USDC, "eps": 2, "conf": 0, "alpha": 8000,
         "out": t.clawback_quote(1_500 * USDC, 500 * USDC, 500_000 * USDC, 2, 0, 8000)},
        {"deposit": 1_500 * USDC, "mPlus": 5_000 * USDC, "nPlus": 500_000 * USDC, "eps": 2, "conf": 1, "alpha": 8000,
         "out": t.clawback_quote(1_500 * USDC, 5_000 * USDC, 500_000 * USDC, 2, 1, 8000)},
    ],
    "bucket": [{"level": 90_000 * USDC, "last": 100, "now": 106, "nMin": 100_000 * USDC, "horizon": 12, "add": 30_000 * USDC,
                "out": t.bucket_after(90_000 * USDC, 100, 106, 100_000 * USDC, 12, 30_000 * USDC)}],
}
results["vectors"] = vectors

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
out.mkdir(parents=True, exist_ok=True)
(out / "report_numbers.json").write_text(json.dumps(results, indent=2))
(out / "vectors.json").write_text(json.dumps(vectors, indent=2))
print(json.dumps({k: v for k, v in results.items() if k != "vectors"}, indent=2))
```
