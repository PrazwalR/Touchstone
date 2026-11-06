# General EVM checklist: findings

Scope: `contracts/src`, `contracts/script/base/CoreDeployer.sol`, and the keeper's settlement decision (`backend/keeper/src/keeper.ts`) where it matters. Decided trade-offs (0025, 0026, 0031, 0036 and others) and the threats owned by later milestones (T3, T6 to T8, T12 to T15, T20) are not reported again. The PoCs run in a scratch Foundry project that compiles `contracts/src` and reuses `TouchstoneFixture.sol`.

Counts: High 0, Medium 3, Low 1, Info 1.

## [GEN-1] A refund beneficiary can burn the refund push's gas, making settlement about 8.6 times as expensive, so toxic records go unsettled and expire with a full refund
**Severity**: Medium
**Category**: evm-audit-general
**Location**:
- src/TouchstoneHook.sol:512-518 (`_refund`) and :183-187 (`pushOut`)
- lib/v4-core/src/types/Currency.sol:48
- backend/keeper/src/keeper.ts:247-252

**Description**:
- **Mechanism.** The refund is pushed with `try this.pushOut(...)`. For native ETH, `CurrencyLibrary.transfer` uses `call(gas(), to, ...)`, which forwards all remaining gas to the beneficiary. The try/catch handles a beneficiary that reverts (T9). It does not handle one that burns all the gas it receives.
- **Why that is expensive.** The hook keeps only 1/64 of its gas when it calls `pushOut`. Everything after the push has to fit in that 1/64: `_toLedger` (an ERC-6909 transfer plus `credit` writing fresh storage), the unlock's delta check, releasing the lock, `Settled`, and the fee refund. So whoever settles must supply about 64 times the cost of those steps.
- **Who controls it.** The trader chooses the beneficiary (through hookData, a trusted router, or `tx.origin`).
- **Selective trigger.** The beneficiary can burn gas only when it is paid less than the full deposit, which is exactly the case where a clawback applies. On `expire` and on benign settlements it is paid in full and behaves normally.
- **Keeper response.** The keeper estimates gas and declines records where the tip does not cover it (`keeper.ts:247-252`).
- **Outcome.** After `window`, the arbitrageur calls `expire` and gets the whole deposit back. The arbitrageur risks nothing: if someone does pay the gas, the catch path credits the partial refund to the ledger as usual. This is a griefing lever on LP liveness (T2), not direct theft.
- **ERC-20 variant.** ERC-777-style tokens with receive hooks give the same lever for ERC-20 deposit currencies.

**Proof of Concept**: `RefundGasGrief.t.sol`, native ETH pool.
- `test_Baseline_HonestBeneficiary`: a $500k buy settled at $3,300 needs at least 236,456 gas.
- `test_PoC_GasBurningBeneficiaryInflatesSettleCost`: the beneficiary runs `invalid()` when `msg.value < deposit`.
  - The minimum becomes 2,028,813 gas.
  - `settle{gas: 1_000_000}` reverts.
  - At 2.03M gas, settle succeeds and the 26,140,969 wei refund is deferred to the ledger.
- `test_PoC_ExpiryPaysAttackerInFull`: `expire` pays the same contract the full 0.4759 ETH deposit.

**Recommendation**: Bound the gas the push can consume. Either:
- call `this.pushOut{gas: REFUND_PUSH_GAS}` with a per-chain constructor immutable (§0.3), or
- credit native refunds to the ledger whenever the beneficiary has code.

Keep the PoC as a regression test that bounds settle gas relative to the honest case.

## [GEN-2] Pool creation is permissionless and nothing ties a pool's Pyth IDs, reference feed or protocol recipient to its tokens, so the first caller sets the terms for a key and can turn "refundable" deposits into its own revenue
**Severity**: Medium
**Category**: evm-audit-general
**Location**:
- src/TouchstoneFactory.sol:113-131, :148-152, :160, :187-190
- src/TouchstoneHook.sol:121-128, :216-221
- src/Settler.sol:69, :73-81

**Description**:
- **No caller restriction.** `createPool` has no access control, each key can be registered only once, and its config is immutable.
- **Bounds only.** `_validate` checks numeric bounds:
  - price IDs need only be non-zero;
  - `referenceFeed` can be any address;
  - `protocolRecipient` can be anyone, with up to a 50% share.
- **Settler trusts the config.** It prices records with whatever IDs the creator wrote. A creator who names the wrong Pyth feed makes every flagged swap look toxic and collects the protocol share.
- **Consequence 1: canonical-key squatting.** After the hook is deployed, anyone can front-run the owners' `createPool` for ETH/USDC at the intended fee and tick spacing. The owners' call then reverts, and the pool stays hostile forever. The same lever can disable large swaps (GEN-3).
- **Consequence 2: the guarantee does not hold.** Lesson 02 says "every pool has a validated config", and deposits are described as refundable. A quoter shows the deposit only as a refundable hold; the loss happens at settlement.

**Proof of Concept**: `PoolSquat.t.sol`. The attacker creates the ETH/USDC key with `basePriceId = keccak256("BTC/USD")`, `protocolRecipient = attacker`, `protocolShareBps = 5000`, and every bound passes.
- `test_PoC_LegitCreatorLockedOut`: the owners' `createPool` reverts with `Touchstone__AlreadyRegistered`.
- `test_PoC_HonestTradeClawedBackToAttacker`: a $20k buy at the fair $3,000 posts a deposit of 19,950,117,720,512,865 wei.
  - It is settled against honest Pyth prices (ETH $3,000, BTC $60,000).
  - The trader is refunded 3,846,199 wei.
  - The attacker is credited 9,933,392,191,666,666 wei, about 50% of the deposit.

**Recommendation**: This is a trust-model change, so per §0.11 it needs a decision from you first. Options:
1. Restrict creation to a registrar fixed at deployment.
2. Record each pool's creator and have the keeper, indexer and dashboard serve only pools from allowlisted creators in the per-chain config, documenting that a pool's terms are only as trustworthy as its creator.
3. Create the canonical keys in the same broadcast as the hook deployment, before the hook address is public, so they cannot be squatted.

Also fix the wording in lesson 02.

## [GEN-3] A reference feed with no code, or one that returns short data, reverts every large or flow-flagged swap, contrary to "ReferenceLib.readX36 never reverts"
**Severity**: Medium
**Category**: evm-audit-general
**Location**:
- src/libraries/ReferenceLib.sol:33-38, :42-46, :55-63
- src/TouchstoneHook.sol:333-335
- src/TouchstoneFactory.sol:148-152

**Description**:
- **The compiler behaviour.** High-level `try` calls that decode return data skip the `extcodesize` check (Solidity 0.8.10 and later). A failure while decoding is raised in the caller and is not caught by `catch`.
- **Which feeds trigger it.** A `referenceFeed` (per pool) or `SEQUENCER_FEED` (immutable, all pools) that:
  - has no code, such as a feed address from another chain;
  - is a proxy with no implementation;
  - has a fallback that returns nothing;
  - returns short data.
- **Effect.** Every swap that reaches `_gap` (notional at or above N0, or a flow-bucket hit) reverts. The config is immutable, so large trading on that pool is disabled permanently.
- **Contradiction.** This breaks decision 0003, the `ReferenceLib` NatSpec and lesson 02 / I10. The factory does not check the feed's code.

**Proof of Concept**: `CodelessFeed.t.sol`.
- `test_PoC_FeedWithoutCodeRevertsLargeSwaps`: a $1k swap passes. A $20k swap reverts, and the trace shows "call to non-contract address" inside `afterSwap`.
- `test_PoC_SilentFallbackFeedRevertsLargeSwaps`: the same result with a feed whose fallback returns empty data.

**Recommendation**:
- Replace the high-level `try` with a low-level `staticcall`. Check `success` and that `returndatasize()` is at least 160 bytes (32 for `decimals`), copy only that many bytes, and otherwise return `ok = false`.
- Reject a non-zero `referenceFeed` with no code in `_validate`.
- Check `SEQUENCER_FEED` and the trusted routers for code in `CoreDeployer`.
- Keep the PoCs as regression tests under I10.

## [GEN-4] Unchecked accumulation of rebatePool and vest relies on a bound the code does not enforce
**Severity**: Low
**Category**: evm-audit-general
**Location**: src/TouchstoneHook.sol:499-508
**Description**:
- **The code.** `rebatePool += toRebatePool` and `vest += toLPs` are uint128 additions inside `unchecked`.
- **Why the stated bound fails.** The comment says claims are bounded by deposits, but `maxOutstanding` bounds only open deposits. The rebate pool accumulates over every settled record and drains only through capped benign rebates.
- **When it bites.** A token with supply above about 3.4e38 base units can push the slot past 2^128.
- **Result.** The slot wraps silently, I1 breaks, and claims are stranded. Mainstream tokens are many orders of magnitude below this, so the bug is latent.

**Proof of Concept**: Not executed; it follows from the types (`PoolState.sol:20`), and no code path caps the sum.
**Recommendation**: Use checked or saturating addition; a revert there would be limited to settlement. Or state the supply assumption and reject tokens with `totalSupply() > type(uint128).max` at pool creation.

## [GEN-5] Anyone can force a ledger recipient's balance out as the underlying token through `push`
**Severity**: Info
**Category**: evm-audit-general
**Location**: src/RebateLedger.sol:56-60
**Description**:
- **The behaviour.** Any caller can turn a recipient's ledger balance into the underlying token sent to the recipient's own address. The recipient loses the choice between `claim(to)` and `claimAsClaims`.
- **When it matters.** A recipient that can collect through the ledger but cannot safely hold the token. Example: a router named as `rebateTo` whose token balances anyone can sweep.
- **Limit.** Funds go only to the named recipient, so this is not a theft path against an EOA or a treasury.

**Proof of Concept**: Not executed; it follows from the code.
**Recommendation**: Either restrict `push` to recipients who opted in, or limit it to `DEFERRED_REFUND` balances. Otherwise, document that `rebateTo` and `protocolRecipient` must be able to hold the underlying token.

## Checked and safe

**External calls**
- Calls to codeless addresses: the only low-level `.call` is the fee refund to `msg.sender` (Settler.sol:86), and its result is checked. High-level calls to codeless feeds are GEN-3.
- Returndata bombing: `catch {}` decodes nothing (TouchstoneHook.sol:513-514). The PoolManager copies revert data only in its own frame.
- Fixed gas stipends, delegatecall, `transfer()` and `send()`: none in src.
- `msg.value` reuse: only `settle` is payable; it has no loop, and excess is `msg.value - fee`.
- Gas-limited try/catch on the swap path (feeds, sequencer, `msgSender()`): forcing the catch leaves the swap about 200 to 300 gas, which is not enough to finish, so it is infeasible. Forcing an honest beneficiary's refund into the catch would need a gas limit above 4M and would only defer the refund to the ledger.
- `encodePacked` collisions: none; hashes use `abi.encode`.

**Force-feeding and balances**
- `address(this).balance` is never read.
- ETH force-fed to the Settler only subsidises a later caller's Pyth fee.
- The ledger's `balanceOf` is used only as a solvency floor.
- The hook and ledger hold fixed ERC-6909 claims, so fee-on-transfer and rebasing tokens are not a concern.

**Pause**: there is no pause mechanism, so these items do not apply.

**Reentrancy**
- `finalize` and `drip` hold a transient lock, and state is written before the unlock (decision 0032).
- Reentering from a beneficiary or tip recipient fails:
  - `settle`, `finalize` and `drip` hit the lock;
  - `ledger.claim` and `push` get `AlreadyUnlocked`;
  - `claimAsClaims` debits before it transfers.
- Swaps made inside the hook's unlock come after `_donate` and net their own deltas.
- Read-only reentrancy: the Settler reads state before `finalize`, and a nested settle hits the lock.
- `nonReentrant` is the only modifier on those functions.

**Merkle**: none in the code.

**Reveal gap**
- The Pyth update is the unique first one at or after t0 (T1), and the record, config and key are immutable.
- Only the rebate-pool balance is mutable at settlement; ordering among benign records decides who gets the capped rebate, but not the clawback.
- Copying a keeper's public Pyth update to take the tip is accepted, since anyone may settle.

**Code structure**
- Deposit and finalize are symmetric: the hash, `outstanding` and the claims all leave once, and `conserves` checks the amounts.
- Record id 0 is not ambiguous, because `lastDeposit` returns the amount alongside the id.
- RecordLib helpers are shared by the hook and the Settler.
- The documentation mismatches are GEN-2 and GEN-3.
- CoreDeployer checks the nonce, the predicted addresses and the hook's code. Front-running its CREATE2 call deploys an identical hook and only fails the script.

**Loops, time and comparisons**
- Only constant-bound loops (PriceLib); duplicate or zero trusted routers are harmless.
- Windows are seconds-based and Pyth times are off-chain; Arbitrum block numbers use ArbSys (T19).
- Boundaries (`<` t0, `<` expiresAt, `>` maxConf, `>` budget, `>=` drift, flow and vest) match the documentation. Settling after expiry, until someone expires the record, favours LPs.
- `depositIn0` is correct in all four swap cases (T5).

**Multiple roles and receivers**
- A self-settling arbitrageur still pays the clawback.
- Naming the hook as beneficiary falls back to the default.
- Naming the ledger or the PoolManager as receiver only harms the trader who chose it.

**Compiler and arithmetic**
- Solidity 0.8.26: no known bug applies (transient storage is assembly-only).
- The target chains support PUSH0 and cancun.
- All unchecked blocks are safe except `_account` (GEN-4).
- Downcasts are bounded or use SafeCast; small types are upcast before multiplying.

**Access control**
- `register`: factory only. `finalize`: Settler only, with the record checked by hash. `pushOut`: the hook itself only.
- `unlockCallback` on the hook and the ledger: PoolManager only, and it only calls back whoever called unlock.
- `drip`: open to anyone, bounded by vesting.
- BaseHook applies `onlyPoolManager`, and `beforeInitialize` accepts only the factory.
- `credit`: hook only. `claim` and `claimAsClaims` act on the caller's own balance. `push` is open (GEN-5).
- `settle`, `expire` and `createPool` are open to anyone (GEN-2).
- There are no admin, upgrade, pause or rescue powers.
