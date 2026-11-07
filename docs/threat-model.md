# Threat model

The threats, mitigations and residual risks are spec §18.2 (T1 to T20). This file tracks which test covers each
one. Status at the end of M3; rows marked later are owned by the milestone shown.

| # | Threat | Test | Status |
| --- | --- | --- | --- |
| T1 | Keeper picks a favourable Pyth update | `Settlement.t.sol::test_Settle_RejectsNonFirstUpdate` | Covered |
| T2 | Pyth withheld or late | `test_Expire_RefundsInFull` | Covered |
| T3 | Padding past the fair price | in-the-money leg in `test_Settle_ArbitrageRetainsAndConserves` (I4) | Partial; padding PoC in M10 |
| T4 | Splitting under N0 or N_min | `TouchstoneHook.t.sol::test_Flow_SplitBelowN0FillsBucket`, `test_Flow_DrainsOverHorizon` | Covered |
| T5 | Switching to exact output | `test_Deposit_UnspecifiedCurrency_AllFourCases` | Covered |
| T6 | Outsider sandwich | | M10 |
| T7 | Holder sandwich, colluding pair | | M9/M10 |
| T8 | JIT liquidity captures donations | `test_Drip_ReleasesLinearly`, `test_Drip_WaitsWithoutInRangeLiquidity` | Partial; JIT PoC in M10 |
| T9 | Blocklisted or reverting refund recipient | `SettlementNativeTest::test_Refund_RejectedIsDeferredToLedger` | Covered |
| T10 | Reentrancy through callbacks | `SettlementNativeTest::test_Reentrancy_DuringFinalizeIsBlocked` | Covered |
| T11 | Forged or replayed records | `test_Settle_OnceAndForgedRecordsRejected` | Covered |
| T12 to T14 | Licence griefing, idle holder, lone bidder | | M9/M10 |
| T15 | Wash trading for rebates | | M10 |
| T16 | Refunds to tx.origin on relayed transactions | `test_TrustedRouter_NamesItsCaller`, `test_HookData_*` | Covered for the trusted-router path |
| T17 | Malformed hookData | `test_HookData_MalformedReverts` | Covered |
| T18 | Mis-scaled prices | `ReferenceLibs.t.sol` Python vectors, `test_Reference_ConvertsToX36`, decimals tests | Covered |
| T19 | Wrong block numbers on Arbitrum | `test_BlockLib_ReadsArbSys` | Covered |
| T20 | Hook unlock inside another unlock | | M10 |

Found in M3 and fixed: swap-path overflow at v4's price bounds (decision 0031), a refund that could be stranded in
the hook by naming it as beneficiary (`test_HookData_NamingTheHookFallsBack`).

## Repair audit, 30 October 2026

The M3 table above is historical, not current security assurance. `PayoutIsolation.t.sol` adds malicious
PoolManager-delta beneficiaries and tip recipients, paused-token settlement, shared recipient delivery and
ledger recovery. Decision 0042 isolates recipient execution from the settlement unlock. Gas-burning delivery
remains an open risk because no push gas budget was introduced. Reference malformed/codeless-response
regressions are in `Libraries.t.sol`. Self-LP rebate drain (T15), JIT donation capture (T8), cap exhaustion and
exact ITM reconstruction remain unresolved; see the repair audit and pending mechanism decisions.

## Merge of 31 October 2026

Added on top of the repair audit:
- **T1 on the deployed Pyth contract.** `test/fork/ArbitrumSepoliaFork.t.sol` settles against Pyth 1.4.6 on an
  Arbitrum Sepolia fork with recorded Hermes updates; the next update after t0 and a mixed pair are rejected.
- **Closed-market mode (M6).** A calendar that reverts, returns short data or has run out of published data
  makes the swap post no deposit instead of reverting it (`ClosedMarket.t.sol`). Closure records can always be
  settled or expired, because `validUntil` is the last covered open.

## D2 read-only history and demonstration tooling (1 November 2026)

The history API opens the indexer database read-only and has no signing capability. Strict query fields, bounded pagination, parameterised SQL, an exact-origin CORS allowlist and bounded per-socket rate limits protect the new HTTP surface. SQL indexes support record/recipient filters and status aggregates. Settlement lag uses confirmed closure headers committed with the indexed range and removed on rewind; samples are bounded to the latest 1,000 eligible settlements. Missing historical headers are disclosed. An API compromise can misrepresent evidence; users can verify transaction links or read contracts directly. It cannot move funds through the dashboard. Serve behind HTTPS; CORS is not authentication.

The testnet bots are separate signing processes with explicit chain, pool/wiring, amount/output/deposit/deadline and gas controls. They accept only the two supported testnets, require a matching encrypted keystore for submission, and do not approve arbitrary allowances. Seeded randomness is reproducibility only, never security. An outsider reference signal is not a profit guarantee, and execution-gas bounds do not include every rollup data/operator fee. A successful simulated swap does not guarantee later settlement economics. Live signing and funding remain with the wallet owner under the runbook.

Service log output recursively redacts secret-named fields, configured credential values and provider URLs, including nested exception messages. Circular objects and excessive nesting are bounded. This addresses the prior top-level-only redactor, which could leave a provider key in a request URL or nested error text. Logs remain private operational artifacts.

## Current surface, reviewed 6 November 2026

The original M3 threat table remains a historical record. M9/M10 and decisions 0056–0064 add these boundaries:

- **Licence mechanics, T7 and T12–T14.** `Licence.t.sol` covers notice, reserve, minimum deposit, displaced
  bids, lapse accounting, first-touch exemption, stale references and a zero swapper. `EdgeCases.t.sol`
  covers untrusted routers and a token trying to reenter the auction. Licence invariants cover claim/rent
  accounting. These establish mechanics; they do not close colluding-sandwich profitability, idle-holder
  freshness or the lone-bidder economic risk. E10 remains draft, including the new sequential model.
- **Wallet dashboard.** Decision 0060 supersedes the earlier read-only-dashboard assumption for Swap and
  Simulation. The page can request approvals and guarded swaps from an injected wallet, so compromised
  frontend code could request a malicious signature. It holds no signing key. Testnet chain checks,
  pre-sign simulation, bounded approvals, CSP and escaped markdown reduce this surface; wallet confirmation
  is still required. `frontend/test/markdown.test.ts` covers HTML escaping and link-scheme rejection.
  The separate history API remains read-only and has no signing capability.
- **Exact-output execution.** Decision 0063 adds payment caps and verifies requested fills in both
  simulations. The existing onchain guard caps input and deposit but does not enforce full output for this
  mode. A pool-state change after simulation can produce a partial fill. This is disclosed in the UI and
  remains a limitation, not a full-fill guarantee.
- **Indicative quotes.** The lens bounds initialized-tick and empty-word traversal, and rejects an appended
  first-touch flag from callers other than the hook. Local differential/fuzz tests cover quote parity.
  The preview's outstanding-cap valuation approximation in 0051 and actual next-block reference/notional
  changes still need the registered E12 assessment. No sampled 99% bound is established.
- **Research evidence.** E6's registered simulation hit its kill line. The E10 input-validation repair in
  0066 prevents malformed candidate sets from silently producing model output. Synthetic tests do not
  resolve E6, self-LP rebate farming, JIT capture, overshooting tick approximation, cap exhaustion or
  unbounded payout-delivery gas. The owner-preserved release risks in 0043/0052 remain open.
