# AMM and flash-loan findings

Scope: `contracts/src` (TouchstoneHook, Settler, TouchstoneFactory, RebateLedger, libraries), checked against `checklist-defi-amm.md` and `checklist-flashloans.md`. I changed nothing in the repository. Scratch PoCs are in `docs/audits/ethskills-2026-10-28/poc/`. That project reuses `contracts/test/utils/TouchstoneFixture.sol`, which deploys the hook and Settler with deployCodeTo/deployCode. Run them with `forge test` in that directory. Each PoC runs its steps as separate top-level calls because of `isolate = true`. Every sequence below can also be done atomically from one attacker contract: separate unlocks inside one transaction, with an external flash loan for capital where noted.

## [AMM-1] Wash trading against one's own concentrated liquidity drains the rebate pool
**Severity**: High
**Category**: evm-audit-defi-amm
**Location**: contracts/src/Settler.sol:165-166, contracts/src/libraries/SettlementMath.sol:120-145, contracts/src/TouchstoneHook.sol:280-282, 468-475
**Description**: A benign record gets a rebate of min(kappa * f * N, rebatePool). The tip comes out of that rebate, and the settling caller receives the tip. This only discourages wash trading if the LP fee f * N goes to other LPs. In v4 the swapper can also be almost all of the in-range liquidity: it adds a narrow position around the current tick, trades both ways, and removes the position. The fee then comes back to the attacker, but the rebate is still paid as kappa * f * N from the shared rebate pool.

Both legs are flagged by the flow bucket (each leg ≥ nMin), or by first touch when the legs are in one transaction. Both legs settle as benign, because markout ≈ -fee and the ITM leg is empty. The attacker can also be the settler and collect the tip. Nothing ties a rebate to a fee paid to third parties, and nothing caps rebates per address or per window. The rebate pool is LP-funded (the rho share of retained value), so it can be emptied every settlement cycle. Threat T15 is listed as M10. This PoC shows the self-LP variant, which makes the trade profitable rather than merely break-even.
**Proof of Concept**: `poc-amm/test/WashRebateDrain.t.sol::test_WashAgainstOwnLiquidityDrainsRebatePool` (passes).
1. Two honest arbitrages are settled, which funds `rebatePool0` = 1,393.66 USDC and `rebatePool1` = 0.0383 ETH.
2. The attacker adds 400x the full-range liquidity over three tick spacings around the price. That is about 99.75% of in-range liquidity.
3. The attacker buys $1M exact-in, then sells the ETH back exact-in. Both legs are flagged.
4. The attacker removes the liquidity and settles both legs itself at the unmanipulated pool price.
5. Both payouts are benign. `rebatePool1` goes to 0 and `rebatePool0` falls by 196.58 USDC. The attacker's value rises by 307.51 USDC net of all fees, measured as balances plus ledger credits at P*.

Without the self-liquidity, the same round trip costs about $1,000 in LP fees against at most $400 in rebates.
**Recommendation**: This touches money flow, so it needs an owner decision record (§0.11). Options:
- Pay rebates only when the swap's fee went to liquidity that was in range before the swap's block. That needs an `afterAddLiquidity` timestamp per tick range, or a per-pool "liquidity added this block" flag set from `beforeAddLiquidity`, which does not block exits.
- Cap rebates per `rebateTo` per window.
- Deny rebates to a flagged swap whose opposite-direction bucket was filled by the same sender within `flowHorizon`.

Keep this PoC as a regression test for T15.

## [AMM-2] JIT liquidity around a permissionless drip captures the vested buffer
**Severity**: Medium
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:150-155, 528-552; contracts/src/libraries/VestingLib.sol:7-8
**Description**: Anyone can call `drip`. It donates vest * min(1, elapsed/vestPeriod) to whoever is in range at that moment. The VestingLib NatSpec says "a JIT position must stay in range for about one vesting period to share in it". That is not true. The position only has to be in range at the instant `drip` runs.

An attacker adds concentrated liquidity, calls `drip`, and removes the liquidity. `drip` opens its own unlock, so this needs three unlocks in one transaction with flash-loaned capital, but no time in range. The attacker gets its liquidity share of everything released since the last drip, or of the whole buffer if nobody dripped for a vesting period. Vesting only limits loss when honest parties drip often. Nothing on-chain guarantees that, and finalize drips only on settlements. Threat T8 is "Partial; JIT PoC in M10".
**Proof of Concept**: `poc-amm/test/JitDrip.t.sol::test_JitAroundDripCapturesVestedValue` (passes). An arbitrage settles with `toLPs` = 0.34466 ETH. Nobody drips for 30 minutes. The attacker adds 400x liquidity, calls `drip`, and removes it, gaining 0.34380 ETH (99.75% of the donation) and losing 1 wei of quote to rounding.
**Recommendation**: Correct the NatSpec and lesson claim. Choose a mechanism-level mitigation in a decision record, for example:
- make `drip` keeper-driven every block, with the residual risk documented;
- release per block, where elapsed is capped at one block's worth per call and calls inside a block where liquidity changed are rejected;
- account LP rewards per position with seconds-in-range, which needs liquidity callbacks.

## [AMM-3] maxOutstanding can be filled with refundable self-wash deposits so a following toxic swap posts no deposit
**Severity**: Medium
**Category**: evm-audit-flashloans
**Location**: contracts/src/TouchstoneHook.sol:292, 358-375
**Description**: `_withinCap` returns false once outstanding deposits plus this deposit exceed `maxOutstanding`. The swap then executes with no deposit, which decision 0025 accepts for organic load. Outstanding is a single per-pool value that anyone can fill.

An attacker can fill it with flagged round trips against its own concentrated liquidity. Fees mostly return to the attacker (see AMM-1), and the deposits come back in full at settlement, possibly with a rebate. Then, in the same transaction or block, the attacker removes the liquidity and runs the real arbitrage, which posts no deposit and so escapes the clawback. Every other flagged swap is also deposit-free until the wash records settle (t + settleDelay + keeper latency), and the attacker can repeat this every block with the same recycled capital. The capital needed is about `maxOutstanding`, which is small by design during the guarded launch.
**Proof of Concept**: `poc-amm/test/CapExhaustion.t.sol` (both tests pass).
- `test_ControlArbPostsDeposit`: a $400k buy posts a deposit.
- `test_FillCapThenArbPostsNothing`: the attacker adds 40,000x concentrated liquidity and runs 36 wash legs of descending size ($100M down to $300k), about 8.2M gas in total. That brings outstanding to 301,798 USDC plus 232.8 ETH, about $1M = `maxOutstanding`. The attacker removes the liquidity, and the same $400k buy then emits no `DepositTaken`.
**Recommendation**: Escalate to the owners, since this touches money flow. Options:
- Reserve cap headroom per block or per sender.
- Count only deposits older than one block toward the cap.
- Make swaps above n0 that fail the cap revert rather than pass free. This is a liveness trade-off and needs a decision.

At minimum, record in decision 0025 that the cap can be exhausted by the attacker.

## [AMM-4] Native-ETH refund recipient can make settlement need about 64x its normal tail gas
**Severity**: Medium
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:512-518, 183-187
**Description**: `_refund` runs `try this.pushOut(...)`. For native currency, `PoolManager.take` forwards all remaining gas to the beneficiary, which the trader chooses through hookData or a contract `tx.origin` under EIP-7702. A beneficiary that burns its gas leaves only 1/64 for `_toLedger`, the unlock's delta check, and `Settler`'s event and fee refund. Settling therefore needs about 64 times that tail cost, which is several million gas.

An arbitrageur expecting a clawback can make settlement uneconomic against the capped tip. If nobody settles, `expire` refunds the deposit in full. This overlaps with `poc-general/test/RefundGasGrief.t.sol` from the general pass. I did not re-run that PoC; the analysis above is from the code path.
**Recommendation**: Cap the gas on the refund push, for example a `gasleft()`-bounded call through a self-call that runs `take` into the hook and then a gas-limited native send, with the ledger as the fallback. Or credit native refunds to the ledger instead of pushing them.

## [AMM-5] Permissionless createPool lets anyone squat the canonical PoolKey with their own config
**Severity**: Medium
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneFactory.sol:113-131; contracts/src/TouchstoneHook.sol:121-128, 216-221
**Description**: The PoolId covers only (currencies, fee, tickSpacing, hooks), not the config. Anyone can call `createPool` first for a canonical key such as ETH/USDC at 5 bps with a config that passes `_validate`, including:
- `protocolRecipient` = self with `protocolShareBps` = 5,000;
- a `basePriceId` for another asset, which the code cannot check;
- an attacker-controlled `referenceFeed` that can turn drift on or off at will.

The legitimate `createPool` then reverts (`AlreadyRegistered` / `PoolAlreadyInitialized`), and frontends and LPs find the squatted pool under the expected key. Pool isolation itself is correct; this is a trust-model issue. It overlaps with `poc-general/test/PoolSquat.t.sol`.
**Recommendation**: Commit the config to the key, for example by deriving `tickSpacing` or a salt in `PoolKey` from a config hash (not possible in v4 without a different key). Alternatively, restrict `createPool` to an immutable deployer, or publish a canonical config hash per key in `script/config/<chain>.json` and have the lens and dashboard reject mismatches. Record the choice.

## [AMM-6] Frequent drips make vesting exponential rather than linear
**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:528-541; contracts/src/libraries/VestingLib.sol:14-17
**Description**: Each drip releases elapsed/period of the current buffer and resets `vestLast`. With drips every Δ seconds, the buffer after time T is vest * (1 - Δ/period)^(T/Δ) ≈ vest * e^(-T/period). After one full vestPeriod about 37% is still undonated, rather than 0% as the lesson's "vest * min(1, elapsed/vestPeriod)" says.

Anyone can force this by calling `drip` every block. Each settlement also calls `_dripEffects`. Small buffers can also round to zero on every call (vest * Δ < period), so the release stalls until a longer gap. Nothing is lost, but LP income is delayed. Delay helps a JIT position (AMM-2) only marginally.
**Recommendation**: Track a per-tranche linear schedule: a start time plus an amount and rate per currency, with `unlockedAt = min(now, end)`. Or document the exponential behaviour and fix the lesson's formula.

## [AMM-7] An attacker can pre-fill the flow bucket so retail swaps in that direction are flagged
**Severity**: Low
**Category**: evm-audit-flashloans
**Location**: contracts/src/TouchstoneHook.sol:280-282, 310-328; contracts/src/libraries/FlowBucketLib.sol:38-47
**Description**: The bucket is per pool and per direction, not per sender. One wash leg of nMin in a direction makes `hit` true for every later swap in that direction until it drains (up to `flowHorizon`, at most 3,600 s). Any retail swap above zero notional then posts a deposit, which locks capital until settlement and uses up `maxOutstanding`. With self-liquidity (AMM-1), filling the bucket costs the attacker almost nothing and earns it a benign rebate.
**Recommendation**: Document this as a griefing vector in the threat model (T4/T15). Optionally add a minimum notional for flow-only flags.

## [AMM-8] Refunds fall back to tx.origin for untrusted routers, so ERC-4337 bundlers and solvers receive them
**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:435-454
**Description**: When `sender` is not one of the four trusted routers and hookData names nobody, `beneficiary = tx.origin`. Examples are an aggregator, a CoW-style settlement contract, or a smart account calling PoolManager through its own router. For a 4337 UserOperation, `tx.origin` is the bundler; for an intent settlement, it is the solver. The user's refund and rebate go to them. T16 is covered only for the trusted-router path.
**Recommendation**: When `sender` is an untrusted contract and hookData is empty, credit the refund in the ledger to `sender` rather than paying `tx.origin`. Or document the residual risk in T16 and require integrators to pass hookData.

## [AMM-9] Native-ETH credits to a contract that cannot receive ETH or call the ledger are stranded permanently
**Severity**: Low
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:512-518; contracts/src/RebateLedger.sol:42-60
**Description**: A failed refund push is credited to `record.beneficiary` in the ledger. `claim` and `claimAsClaims` require `msg.sender == recipient`, and `push` retries the same native send to the same address. If the beneficiary or `rebateTo` is a contract with no `receive` and no generic call path (for example a router resolved through `msgSender()`), the credit can never leave.
**Recommendation**: Let `push` take a recipient-signed (EIP-1271/712) alternate destination, or allow claiming as ERC-6909 claims by anyone to the recipient (`transfer(recipient, ...)` needs no receive hook).

## [AMM-10] hookData with dirty address bits reverts only on flagged swaps
**Severity**: Info
**Category**: evm-audit-defi-amm
**Location**: contracts/src/TouchstoneHook.sol:231, 447-449
**Description**: `_beforeSwap` checks only the length (0, 32 or 64). `abi.decode(hookData[:32], (address))` in `_resolve` reverts on non-zero upper bits, but it runs only when a deposit is taken. The same hookData is therefore accepted on retail-sized swaps and reverts the swap once it is flagged, which is inconsistent behaviour for integrators.
**Recommendation**: Validate the address words in `_beforeSwap` (`uint256(word) >> 160 == 0`) and revert with `MalformedHookData` there.

## Checked and safe

- Hook permission bits: the address must end in 0x20C4. `BaseHook` constructor validates via `Hooks.validateHookPermissions` (uniswap-hooks BaseHook.sol:101). Permissions are at TouchstoneHook.sol:113-118.
- Correct return types: `_beforeSwap` returns (selector, ZERO_DELTA, 0) at TouchstoneHook.sol:238; `_afterSwap` returns (selector, int128) at 253-255.
- BeforeSwapDelta sign and async custody: always ZERO_DELTA, so there is no custody of the specified amount (TouchstoneHook.sol:238).
- afterSwap return-delta sign: +D on the unspecified currency is subtracted from the swapper (v4 Hooks.afterSwap). `depositIn0 = (amountSpecified<0) != zeroForOne` at TouchstoneHook.sol:273 matches v4's mapping for all four exact-in/out and direction cases.
- Delta settlement: the +D credit is offset by `mint` in the same callback (TouchstoneHook.sol:421-422). Finalize and drip burn, take or donate in balanced pairs (545-550, 480-481, 183-187, 520-522).
- Cap of the afterSwap delta against the swap amount: D ≤ notional × deltaMaxBps ≤ 20% (TouchstoneFactory.sol:70, 154; DepositLib.sol:39-54). Risky-side D ≤ 0.2 × riskyAbs. SafeCast at TouchstoneHook.sol:255.
- Access control on hook callbacks: BaseHook `onlyPoolManager` covers before/afterSwap and beforeInitialize. `unlockCallback` has `onlyPoolManager` (TouchstoneHook.sol:160), `pushOut` checks self (184), `finalize` checks the Settler (132), `register` checks the factory (122).
- unlockCallback data: reachable only through the hook's own `unlock` calls with hook-built payloads (TouchstoneHook.sol:146, 153). RebateLedger checks the PoolManager and builds its own payload (RebateLedger.sol:44, 58, 66).
- Pool-key spoofing and multi-pool: `_beforeInitialize` accepts only the factory and registered ids (TouchstoneHook.sol:216-221). All state is keyed by PoolId (85-88). Transient slots are keyed per pool (TransientLib.sol:22-24). The squatting residual is AMM-5.
- PoolId collisions: the id is keccak of the full PoolKey (v4), and `register` rejects duplicates (TouchstoneHook.sol:124).
- Upgradeability: none. No proxy, owner or delegatecall.
- lpFeeOverride: returns 0, and dynamic fees are rejected (TouchstoneFactory.sol:119).
- Dynamic-fee front-running: not applicable (static fee).
- Unbounded loops on the swap path: none. Only fixed 7-iteration and 8-iteration loops in PriceLib, used by the Settler.
- sqrtPriceLimit and partial fills: notional and deposit come from the realized `delta` (TouchstoneHook.sol:259-274). Records store the actual before and after sqrt prices (404-405).
- Native ETH currency: decimals default to 18 (TouchstoneFactory.sol:198). Claims for address(0) mint and burn normally. A rejecting native refund is deferred to the ledger (512-518). Gas griefing is AMM-4.
- Reentrancy through PoolManager during finalize: all state is written before transfers (TouchstoneHook.sol:140-145, 166-169). `drip` and `finalize` share the transient lock (90-94). A callee swapping during the unlock only creates a normal new record. A nested hook unlock reverts AlreadyUnlocked.
- Donate sandwich: donate does not move price. JIT capture is AMM-2.
- hookData trust: only two addresses are taken. Naming the hook is neutralized (TouchstoneHook.sol:446-450), and a trusted router's `msgSender()` overrides hookData (440-444).
- Router msg.sender identity: the trusted-router path is safe (TouchstoneHook.sol:456-460). Untrusted paths are AMM-8.
- Cross-contract view reentrancy: `poolState`/`recordHash` are updated before any external call in finalize and `_takeDeposit` (TouchstoneHook.sol:140-145, 408-422).
- Flash-loan callback ordering, FlashSwap, and pool.swap without a router: not applicable. The protocol performs no swaps.
- Fee-on-transfer and rebasing tokens: deposits are ERC-6909 claims inside the PoolManager, so token-level quirks only affect v4 itself. Not hook-specific.
- Arbitrary call from user input: none. The only low-level call is the Settler's msg.value refund to msg.sender (Settler.sol:85-88).
- Signed integer balance updates: int128 deltas from v4 are converted with explicit sign handling (TouchstoneHook.sol:266-270). `SafeCast.toInt128(deposit)` at 255 and 425.
- Hardcoded slippage, deadlines, and on-chain minOut: not applicable. The hook adds no router logic, and the router's limits apply to the post-hook delta.
- token0/token1 ordering: handled per pool via the QUOTE_IS_0 flag (TouchstoneHook.sol:265). The factory reads decimals per currency (123-124).
- Factory and pool verification: the Settler and hook read only the factory and hook immutables (Settler.sol:56-60).
- Spot-price manipulation of settlement: settlement uses Pyth `parsePriceFeedUpdatesUnique` (first update at or after t0), never pool reserves (Settler.sol:73-78).
- Pool spot in the trigger: the pre-swap price affects only the drift gap and rate. It is bounded by deltaMax and the Chainlink reference, and a failed read means no deposit (TouchstoneHook.sol:331-340).
- Flash loan with TWAP: no TWAP is used.
- Splitting across transactions or blocks below n0/nMin: T4, accepted by design. The bucket drains at nMin/horizon (FlowBucketLib.sol:38).
- Same-transaction first touch: later swaps in the transaction stay flagged (TriggerLib.sol:24; TouchstoneHook.sol:343-352).
- Rate-limit bypass within one transaction: the flow bucket and first touch are both cumulative, not per-call.
- Governance or voting with flash loans: not applicable.
- Vault share and yield flash attacks: not applicable, beyond the donate JIT in AMM-2.
- totalSupply flash mint: not used.
- Auction flash attacks: the licence is not implemented (factory rejects LICENCE at TouchstoneFactory.sol:120).
- Self-liquidation: not applicable.
- AAVE index: not applicable.
- Settlement manipulation: R ≤ D (SettlementMath.sol:78, 91), checked by `conserves` (TouchstoneHook.sol:137). The keeper cannot choose the price (T1). Forged records are rejected by hash (Settler.sol:106-110; TouchstoneHook.sol:134).
- CLM, TWAMM and slippage items in Dacian's lists: not applicable. Touchstone manages no positions and runs no long-term orders.
