# ethskills audit, 28 October 2026

> **Status note, 31 October 2026.** The "Fixed" table below records the local fixes of 28 October. On 30 October the
> repair (`docs/audits/m0-m5-repair-2026-10-30/`) fixed the same findings with owner-approved designs, and the merge
> of 31 October kept those designs (decision 0049). In the current code:
> - **Fixed by the repair:** TOK-1, TOK-2, GEN-3 and ORC-1 (without a push gas budget).
> - **Fixed in the merge:** ORC-2 (unknown source rejected; the ArbSys probe was dropped, decision 0049), AMM-10, ORC-6, TOK-8, ORC-5, the factory's codeless-feed check, and M6.
> - **Open as proposals in decision 0049:** GEN-1/TOK-4 gas budget, ITM-1 overshoot bound, MATH-1, MATH-2,
>   MATH-6, TOK-6 and the ORC-4 expiry policy.
> - **Open for the owners in repair decision 0043:** the AMM findings.


Scope: `contracts/src` at the end of M3 (TouchstoneHook, Settler, RebateLedger, TouchstoneFactory, libraries),
`contracts/script/base/CoreDeployer.sol`, and the keeper where settlement depends on it. Method: the ethskills
audit pipeline (evm-audit-master routing). Five parallel reviewers walked nine checklists: general and access
control, precision math, ERC-20, DeFi AMM with Uniswap v4 hooks, flash loans, oracles, chain-specific, DoS and
assembly. Every reported finding came with a Foundry PoC that passed against the audited code. The per-checklist
reports are next to this file (`findings-*.md`) and the PoC sources are in `poc/`. Labels follow §0.8: the gas
numbers are **measured**, and the dollar figures in PoCs are **testnet-style simulations** on local forks, not
market evidence.

Total after deduplication: 1 High fixed, 1 High for the owners, 9 Medium (5 fixed, 4 for the owners), and the rest
Low or Info. Also: one implementation bug found by the E3 research (ITM-1) and one keeper bug found while fixing
ORC-4.

## Fixed

| ID | Severity | Finding | Fix | Regression test |
| --- | --- | --- | --- | --- |
| TOK-1 | High | Native refund recipient leaves an open PoolManager delta: settle always reverts, clawback dodged, deposit lockable (I10) | Refund and tip credited to the ledger inside the unlock, pushed after it with `PUSH_GAS` (decision 0043) | `test_TOK1_*` |
| GEN-1, TOK-4, AMM-4 | Medium | Gas-burning refund recipient makes settlement cost millions of gas | Same: push runs after the unlock, gas-capped | `test_GEN1_GasBurningBeneficiaryCannotInflateSettlementGas` |
| TOK-2 | Medium | Paused or blocklisting deposit token: the uncaught tip push blocks every settle while expire refunds in full | Same: the tip goes through the ledger | `test_TOK2_PausedTokenDefersTipAndRefundInsteadOfReverting` |
| GEN-3, ORC-1 | Medium | Codeless or short-return Chainlink or sequencer feed reverts every large swap, which try/catch cannot catch | `staticcall` with returndata length checks; factory rejects codeless feeds; constructor rejects a codeless sequencer feed | `test_GEN3_*`, `test_SequencerFeedWithoutCodeFailsAtDeployment` |
| ITM-1 | Medium | In-the-money leg larger than the swap after tick crossings (found by E3) | `ItmLib.bounded` (decision 0042) | `ItmBoundTest`, including a fuzz test |
| ORC-4 (keeper) | Medium | Keeper treated `latest` as a send deadline, so a keeper lagging more than `maxLag` gave every record up to expiry | Keeper settles any time after t0; after expiry it settles first | keeper e2e "settles a record it reaches after maxLag" |
| ORC-2 | Low | `BLOCK_SOURCE` unchecked: ArbSys off Arbitrum reverts large swaps; an unknown value silently means EVM | Constructor rejects unknown sources and probes ArbSys | `test_ORC2_*` |
| MATH-1 | Low | Zero-amount drips restart the vesting clock, so small buffers never vest under frequent drips | Clock kept when nothing is released | `test_MATH1_FrequentDripsStillVestASmallBuffer` |
| MATH-2 | Low | Risky deposit rounded the quote amount first (up to 2.8% low in the PoC) | `DepositLib.riskyAmount = |x_r| * rate` | `test_MATH2_RiskyDepositIsRateTimesRiskyAmount` |
| GEN-4, MATH-4 | Low | Unchecked accumulation of `rebatePool` and `vest` | Checked arithmetic | covered by existing settlement tests |
| ORC-6 | Info | Identical base and quote Pyth IDs accepted | Rejected in `_validate` | `test_ORC6_RejectsIdenticalPriceIds` |
| MATH-6 | Info | 100% LP fee divides by zero at settlement | Rejected in `createPool` | `test_MATH6_RejectsFullFee` |
| TOK-6 | Info | Unbounded token decimals | Decimals at most 36 | `test_TOK6_RejectsAbsurdDecimals` |
| AMM-10 | Info | Dirty hookData address words revert only on flagged swaps | Checked in `beforeSwap` | `test_AMM10_DirtyHookDataRevertsOnEverySwap` |
| MATH-3 | Info | `splitRetained` unchecked block relies on bps at most 10,000 | Precondition stated | n/a |
| TOK-8 | Info | Deployer trusted nonce-predicted support addresses | `CoreDeployer` checks each support contract's `HOOK` | n/a (script) |
| ORC-3 | Low | Decision 0022 and the NatSpec said the reference never sets an amount | Corrected: it sets the deposit rate, which caps the clawback | n/a (documentation) |
| ORC-5 | Info | T1 tested only against the project's own Pyth mock | Fork test on Arbitrum Sepolia: the real PoolManager, Pyth 1.4.6, the Chainlink feed and recorded Hermes updates | `test/fork/ArbitrumSepoliaFork.t.sol` |
| AMM-6 | Low | Vesting is geometric under frequent drips, not linear | NatSpec corrected | n/a |

## For the owners (decision 0044)

| ID | Severity | Finding | Recommendation |
| --- | --- | --- | --- |
| AMM-1 | High | Wash trading against one's own concentrated liquidity drains the rebate pool (+$307 per $1M round trip in the PoC) | Rebates off (rho = kappa = 0) until E11 covers the self-LP strategy |
| AMM-2 | Medium | JIT liquidity around a permissionless `drip` takes the released buffer | Keeper drips every block on L2; accepted risk T8 |
| AMM-3, TOK-3 | Medium | `maxOutstanding` can be filled on purpose | A high cap and a settle-at-loss LP keeper for testnet; count only deposits older than one block before mainnet |
| GEN-2, AMM-5, TOK-5 | Medium | Anyone can squat a canonical PoolKey with a hostile config | Create the canonical pools in the deployment broadcast; off-chain allowlist of config hashes |
| AMM-7 | Low | Flow bucket pre-fill flags retail swaps in one direction | Document under T4/T15 |
| AMM-8, ORC-7 | Low | The `tx.origin` fallback pays bundlers, solvers and aliased L1 senders | Integrators pass hookData (T16) |
| AMM-9 | Low | Native ledger credits stranded for contracts that cannot receive ETH | `push` falls back to ERC-6909 claims |
| GEN-5 | Info | Anyone can `push` a recipient's ledger balance | Document that recipients must be able to hold the token |

## Gas impact (measured)

Swap path: +0.4% below N0, +1.2% at or above N0, +0.4% flagged. `settle` +23.9% (303,934) and `expire` +26.4%
(217,236), both from the TOK-1 fix. Details in docs/gas.md.

## QA (ethskills qa)

The qa checklist targets a Scaffold-ETH 2 frontend. Touchstone has no frontend yet (frontend/ is a placeholder),
so the frontend items are **not applicable** and are re-run when the dashboard lands. The dashboard is
read-only, with no wallet connection (§0.7), so most of them will stay not applicable.

| Item | Result |
| --- | --- |
| Wallet button, network switch, four-state button flow, approve cooldowns | Not applicable: no wallet flow; the dashboard is read-only by design |
| Contracts verified on the block explorer | Not yet applicable: nothing deployed. M8's Verify script must pass before deployment counts as done; Etherscan V2 key configured |
| SE2 branding, title, README, favicon | Not applicable: not an SE2 build |
| Contract addresses displayed, USD values, OG image, polling, RPC overrides | Deferred to the dashboard |
| Error mapping | Keeper: every revert is decoded by name (`revertName`) and logged; no silent catch |
| CROPS review | Present below |

## CROPS Review

Chosen default:
- No owner, no proxy, no pause, no upgrade. Every entry point (`settle`, `expire`, `drip`, `claim`, `push`,
  `createPool`) is permissionless and callable without any frontend, keeper or indexer. This is the most
  CROPS-aligned choice for a hook that holds trader deposits.

Censorship resistance:
- **Risk:**
  - The only party that can block a trader's exit is the L2 sequencer (Arbitrum, Base), which can delay
    `expire` or `claim`.
  - The reference keeper can decline to settle, but anyone can settle; anyone, including the trader, can expire.
  - The trader's chosen refund recipient can fail its own push but can no longer block settlement (TOK-1 fixed).
- **Mitigation:**
  - No allowlists, blacklists or compliance filters in the contracts.
  - Keeper and indexer are open source and self-hostable.
  - Settlement prices come from any Hermes endpoint, and the update is verified on chain.
- **User escape:**
  - Call `Settler.expire` directly after the window.
  - Claim from `RebateLedger` directly.
  - On Arbitrum, forced inclusion through the L1 delayed inbox (check l2beat for the target chain before mainnet).

Open (visibility):
- **Risk:** The repository is local and unpublished until the owners push it; the dashboard does not exist yet;
  testnet deployments are not verified yet.
- **Mitigation:**
  - The whole stack is in one repository: contracts, keeper, indexer, research with frozen pre-registrations,
    and docs.
  - Every dependency is vendored at a pinned commit (contracts/lib/PINS.md).
  - `.env.example` lists every variable.
  - ABIs are exported to `backend/shared/abi`.
- **User escape:** Run the keeper and indexer from source against any RPC; read events directly.

Free (license):
- **Risk:**
  - AGPL code must not enter (§0.8: Bunni's `AmAmm.sol`).
  - Vendored dependency licenses need checking at publication. In v4-core, `PoolManager` is BUSL-1.1 (it
    becomes MIT no later than 15 June 2027); the v4 libraries `src/` imports, such as FullMath and SqrtPriceMath,
    are MIT. Touchstone calls the deployed PoolManager and only compiles it locally for tests.
- **Mitigation:** Project code is MIT (an SPDX header on every Solidity file). Audit 9 re-checks dependency
  licenses before the first public push.
- **User escape:** Fork and operate under MIT; the deployed hook and Settler have no owner whose permission is
  needed.

Privacy:
- **Risk:**
  - Every record publishes the swap's sender, beneficiary, amounts and timing in `DepositTaken`, as any swap
    does.
  - The keeper's Hermes and RPC providers see which records it is settling.
  - The tx.origin fallback links an EOA to router swaps.
- **Mitigation:**
  - The record carries nothing beyond what the swap already reveals, plus the beneficiary.
  - The beneficiary can be any address named in hookData.
  - RPC and Hermes endpoints are configuration.
- **User escape:** Name a fresh beneficiary in hookData; route through a private RPC.

Security:
- **Risk:**
  - Trader deposits sit in the PoolManager as the hook's ERC-6909 claims between swap and settlement.
  - Correctness rests on Pyth (settlement price), Chainlink (trigger and deposit size) and the v4 PoolManager.
  - Pools are created permissionlessly, so a pool's terms are only as good as its creator (GEN-2).
- **Mitigation:**
  - Every deposit resolves through `settle` or `expire` (I10, now including hostile recipients).
  - Payouts conserve the deposit and are re-checked in `finalize`.
  - `maxOutstanding` caps exposure per pool.
  - Oracle failure falls back to liveness on the swap path and to a full refund at expiry.
  - Canonical pools to be created in the deployment broadcast (decision 0044).
- **User escape (walkaway test):** If the team, keeper, indexer and Hermes all disappear, a trader still calls
  `expire` after the window and receives the full deposit, then `claim`s any ledger balance. No key held by
  anyone can stop that.

Accepted compromises:
- The Chainlink reference can be stale or lag, which sizes the deposit at the floor rate. This is measured in E3,
  not mitigated.
- A centralized L2 sequencer orders transactions; this is disclosed, and the forced-inclusion route is named
  above.
- Rebates are exposed to self-LP wash trading until the owners decide AMM-1; recommended off for launch.
