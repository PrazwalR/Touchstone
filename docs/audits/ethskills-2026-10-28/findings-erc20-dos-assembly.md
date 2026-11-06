# ERC-20, DoS and assembly findings

Note: the forge `--rerun` failures file at `/Users/prazw/Desktop/Web3/touchstone/contracts/cache/test-failures` was overwritten while I ran the PoCs. Forge writes it there even when `--cache-path` points elsewhere. It now holds the name of one PoC test (`test_PoC_GasBurnerRaisesSettlementCost`), and that test passes now. I left the file alone because touching it would be another repository write. It is safe to delete. Nothing else in the repository was changed.

**Proofs of concept.** They are in `/private/tmp/claude-501/-Users-prazw-Desktop-Web3-touchstone/fb6f214e-9eef-4eba-b9df-79c5d2a7b8e0/scratchpad/audit/poc-dos/DosPoC.t.sol`. They reuse `test/unit/Settlement.t.sol::SettlementBase` and deploy the hook and the Settler from their compiled artifacts. To run them from `contracts/`:

```bash
S=/private/tmp/claude-501/-Users-prazw-Desktop-Web3-touchstone/fb6f214e-9eef-4eba-b9df-79c5d2a7b8e0/scratchpad/audit
FOUNDRY_TEST=$S/poc-dos forge test --out $S/out --cache-path $S/cache --match-contract PoC -vv
```

All four pass against the current code; each pass confirms the problem it tests. I read decision records 0001 to 0041 first, and none of these findings re-reports a recorded trade-off.

**Totals:** 1 High, 2 Medium, 2 Low, 3 Info.

## [TOK-1] Native-ETH refund recipient can leave an unsettled PoolManager delta, so settle always reverts (clawback bypass) and the deposit can be locked permanently
**Severity**: High
**Category**: evm-audit-dos
**Location**: contracts/src/TouchstoneHook.sol:512-518 (`_refund`), contracts/src/TouchstoneHook.sol:183-187 (`pushOut`), contracts/src/TouchstoneHook.sol:146 (`finalize` unlock); contracts/lib/v4-core/src/types/Currency.sol:48 (native `call(gas(), to, amount, ...)`); contracts/lib/v4-core/src/PoolManager.sol:112 (`CurrencyNotSettled` checked after the callback returns)
**Description**: The refund is pushed with `try this.pushOut(c, beneficiary, amount) {} catch { _toLedger(...) }`. That handles a recipient that reverts (T9). It does not handle a recipient that returns successfully after changing PoolManager state.

How the attack works:
- On a native-ETH deposit, `poolManager.take` runs `call(gas(), beneficiary, ...)` while the hook still holds the PoolManager unlock.
- The beneficiary can therefore call any `onlyWhenUnlocked` function. For example, `poolManager.mint(self, 0, 1)` books a 1 wei debt against its own address. It then returns normally.
- `pushOut` succeeds, so the catch branch never runs.
- After `unlockCallback` returns, `PoolManager.unlock` reverts with `CurrencyNotSettled`. This revert is outside the try/catch, so `finalize` reverts, and with it `Settler.settle` or `Settler.expire`.

Why the trader can always set this up:
- The trader chooses the beneficiary: through hookData, through a trusted router's `msgSender()`, or as `tx.origin` (which can carry code under EIP-7702).
- The trader also chooses the deposit currency by picking exact-in or exact-out. So on any pool with native ETH as `currency0`, the deposit can always be made in ETH.
- The beneficiary can tell settlement from expiry by `msg.value`. A settlement that retains value pays `D - R < D`; expiry pays `D`.

Consequences:
1. **Clawback bypass.** The beneficiary stalls whenever `msg.value < D`. No keeper can ever settle a record that retains value. After `expiresAt`, the trader calls `expire` and gets the whole deposit back. LPs lose R on every such arbitrage, so the mechanism does not work for native deposits.
2. **Permanent lock (I10 broken).** If the beneficiary always stalls, neither settle nor expire can ever succeed. The record hash stays set and `outstanding0` is never reduced.
3. **Cap capture.** The trader can release a stalled record whenever they choose (switch the stall off, then expire). So they can keep `maxOutstanding` full indefinitely at no capital cost. `_withinCap` (TouchstoneHook.sol:358-375) then refuses every later deposit on the pool.

The same applies to any pool currency whose transfer calls the receiver (ERC-777 `tokensReceived`, ERC-677-style tokens).
**Proof of Concept**: `DosPoC.t.sol::NativeDosPoC`.
- `test_PoC_StallingBeneficiaryDodgesClawback`: a $500k buy is flagged with the deposit in ETH, and hookData names `MockStallingBeneficiary`. Settling at t0 against a $3,300 fair price reverts with `CurrencyNotSettled`. Settling again after the window also reverts. `expire` succeeds, and the beneficiary receives the full deposit.
- `test_PoC_StallingBeneficiaryLocksRecordForever`: with `alwaysStall` set, `expire` still reverts 30 days later. The record hash is still set, and `outstanding0 == deposit`.

The beneficiary's `receive()`:
```solidity
if (msg.sender != address(PM)) return;
if (alwaysStall || msg.value < fullRefund) PM.mint(address(this), 0, 1);
```
**Recommendation**: Never give control to a trader-chosen address while the hook holds the PoolManager unlock. Two options:
- **(a)** Pay refunds as ERC-6909 claims with `poolManager.transfer(beneficiary, id, amount)`. This runs no receiver code, but traders then have to redeem the claims themselves.
- **(b)** Always credit the refund to the ledger inside the unlock. Then, after `poolManager.unlock` returns in `finalize`, call `try LEDGER.push(beneficiary, c) {} catch {}`. The ledger's push runs in its own separate unlock, so a stalling recipient can only revert its own push, and the amount stays owed.

Both options change the refund money flow, so the owners must decide (§0.11). Keep `MockStallingBeneficiary` as a regression test. The existing T9 test only covers a receiver that reverts. Also add a stalling-beneficiary actor to the I10 invariant handler.

## [TOK-2] The tip is pushed outside the try/catch, so a paused or blocklisting deposit token blocks every settlement while expiry still refunds in full
**Severity**: Medium
**Category**: evm-audit-erc20
**Location**: contracts/src/TouchstoneHook.sol:479-482 (tip push in `_payOut`); contracts/src/Settler.sol:92-99, 246-249 (`expire` pays no tip)
**Description**: `_payOut` sends the tip with a bare `poolManager.burn` followed by `poolManager.take(c, payout.tipTo, tip)`. If the deposit token's `transfer` reverts for every caller, `finalize` reverts whenever the tip is nonzero, which it is on every settlement that retains value. Causes include an issuer-wide pause (USDC, USDT), a PoolManager balance shortfall after a negative rebase, or a token upgrade that breaks transfers.

Expiry carries `tip == 0`, and its refund goes through the `pushOut` try/catch with the ledger as fallback. So expiry still succeeds and returns the whole deposit.

During such a pause, records can only resolve by expiring, at full refund. A pause longer than `window` (the factory allows windows as short as 1 hour) turns every arbitrage record from that period into LP loss. Settlement remains possible after `expiresAt`, but the trader can call expire first.

A blocklisted `tipTo` only hurts that keeper itself; other keepers can still settle, so that part is safe.
**Proof of Concept**: `DosPoC.t.sol::ErcPausePoC::test_PoC_PausedTokenBlocksSettleButNotExpire`. It uses an 18/6-decimal ERC-20 pool and an exact-output buy, so the deposit is in quote. It then calls `vm.mockCallRevert(quote, transfer.selector, "paused")`. Settling at a $3,300 fair price reverts. After the window, `expire` succeeds and `ledger.owed(beneficiary, quote) == deposit`.
**Recommendation**: Pay the tip without a token transfer inside finalize: either credit it to the ledger or send it as ERC-6909 claims. Alternatively, wrap it in the same self-call try/catch with a ledger fallback. This changes how keepers are paid, so it needs the owners' sign-off (§0.11).

## [TOK-3] maxOutstanding can be filled with benign self-deposits that nobody is paid to settle, switching deposits off for a whole window
**Severity**: Medium
**Category**: evm-audit-dos
**Location**: contracts/src/TouchstoneHook.sol:358-375 (`_withinCap`), contracts/src/TouchstoneHook.sol:143-144 (outstanding is released only in `finalize`); contracts/src/libraries/SettlementMath.sol:130-134 (a benign record's tip is 0 when the rebate pool is empty); backend/keeper/src/keeper.ts:287 (a record with `tip === 0n` is never treated as profitable)
**Description**: Outstanding deposits are released only when a record is finalized. A benign record's tip comes from the rebate pool, so it is 0 while the pool is empty. The reference keeper skips such records unless `KEEPER_SETTLE_AT_LOSS` is set, and nobody else has a reason to settle them.

The attack:
- The attacker makes flagged swaps (large, first touch in the block) whose deposits sum to `maxOutstanding`.
- Closing the price impact with an opposite swap in the same transaction makes both legs benign.
- The deposits come back in full when the records expire.
- Until then, `_withinCap` returns false for every swap on the pool, so real arbitrage posts no deposit for `window` (1 hour to 7 days; 1 day in the default config).

The cost is fees and price impact on `maxOutstanding / rate` of notional, paid once per window. That is cheap under a guarded launch with a small cap. If TOK-1 stays unfixed, the fill can last indefinitely.
**Proof of Concept**: This follows from behaviour that is already tested:
- `test_Settle_BenignWithEmptyPoolPaysNoRebate` shows a benign record with `tip == 0`.
- keeper.ts:287 treats a zero tip as not profitable.
- `_withinCap` returns false once `outQuote + depositQuote > budget`.
- `test_PoC_StallingBeneficiaryLocksRecordForever` shows outstanding stays occupied while a record is open.
**Recommendation**: Make freeing the cap independent of anyone's goodwill. Two ways:
- Stop counting a record's deposit against the cap once `settleDelay + maxLag` has passed, while keeping its claims reserved.
- Pay a fixed settlement tip on benign records from a reserve.

Otherwise, record the dependency in a decision record and make the LP-run keeper run with `KEEPER_SETTLE_AT_LOSS=true`. This is a guard parameter, so it is for the owners to decide.

## [TOK-4] A gas-burning native refund recipient roughly triples settlement gas, which can push records past the keeper's profitability threshold
**Severity**: Low
**Category**: evm-audit-dos
**Location**: contracts/src/TouchstoneHook.sol:513 (`try this.pushOut(...)`); contracts/lib/v4-core/src/types/Currency.sol:48 (forwards all remaining gas)
**Description**: A beneficiary that burns all forwarded gas (for example with `invalid()`) does end up with its refund correctly deferred to the ledger. But first it consumes 63/64 of the gas at each of three nested frames. The transaction must carry enough gas that the remaining fraction still pays for `_toLedger`, the end of the unlock, and the Settler's event. The keeper compares that gas cost with a tip capped at `tipCap`. If the tip no longer covers it, the record is left to expire, which means a full refund to the trader.

A return-data bomb has the same effect, since each frame that copies the data pays quadratic memory cost within the same 63/64 budget. The hook's own `catch {}` copies nothing.
**Proof of Concept**: `DosPoC.t.sol::NativeDosPoC::test_PoC_GasBurnerRaisesSettlementCost` binary-searches the minimum gas `settle` needs on the same $500k arbitrage. Measured: 210,864 gas with an ordinary beneficiary, and 583,776 gas with `MockGasBurner`.
**Recommendation**: Either remedy in TOK-1 fixes this. With option (b), the push can also get an explicit gas cap, `LEDGER.push{gas: PUSH_GAS}`, with `PUSH_GAS` set as a constructor immutable.

## [TOK-5] Pool registration is not bound to the registrant: the canonical PoolKey of a pair can be squatted with a hostile config
**Severity**: Low
**Category**: evm-audit-dos
**Location**: contracts/src/TouchstoneFactory.sol:113-131 (`createPool`), contracts/src/TouchstoneHook.sol:121-128 (`register`)
**Description**: The PoolId hashes only the PoolKey, not the config. So anyone can front-run the intended `createPool` (for example ETH/USDC, 5 bps, tick spacing 10) and register that key with any config inside the §14 bounds. Examples:
- `protocolRecipient = attacker` with `protocolShareBps = 5000`;
- `maxOutstanding = 1`, which effectively turns deposits off;
- a `referenceFeed` the attacker controls.

The legitimate transaction then reverts with `AlreadyRegistered`. There is no owner and no update path, so the key stays taken. LPs who don't read `poolConfig` pay up to half of the retained value to the squatter. The impact is limited because other fee and tick-spacing combinations remain available and the config is public.
**Proof of Concept**: An attacker calls `factory.createPool(key, cfgWithAttackerRecipient, sqrtP)` before the deployer does. The deployer's `createPool(key, cfg, sqrtP)` then reverts with `Touchstone__AlreadyRegistered(id)`.
**Recommendation**:
- Create the canonical pools in the same broadcast as the core deployment, or send them through a private mempool.
- Have the dashboard and indexer flag pools whose `protocolRecipient` is not the published one.
- If permissionless registration is intended, record that in a decision record.

## [TOK-6] Factory accepts any token decimals, so a pool can be created whose settlement always reverts
**Severity**: Info
**Category**: evm-audit-erc20
**Location**: contracts/src/TouchstoneFactory.sol:197-200 (`_decimals`), contracts/src/libraries/PriceLib.sol:39-44
**Description**: Decimals are read once at registration and are not bounded.
- If a token's decimals push `k = eBase - eQuote + decQuote - decRisky + 36` outside ±76, `fairPriceX36` reverts with `ExponentOutOfRange` on every settlement.
- A large negative `k` can round `priceX36` down to 0, and the `mulDiv(..., priceX36)` conversions then divide by zero.
- Records on such a pool can only expire. I10 still holds, because expiry still works.
- If an upgradeable token changes its `decimals()`, the cached value goes stale and prices are mis-scaled.
- Tokens with no `decimals()`, or a non-`uint8` return, make `createPool` revert, which is safe.
**Proof of Concept**: `PriceLib.fairPriceX36(1, -8, 1, -8, 120, 0)` reverts with `ExponentOutOfRange`.
**Recommendation**: Bound `decimals0` and `decimals1` in `_validate` (for example `<= 36`). State in the LP docs that the cached decimals assume a non-upgradeable token.

## [TOK-7] A refund recipient can re-enter the PoolManager (swap, modifyLiquidity) during finalize
**Severity**: Info
**Category**: evm-audit-dos
**Location**: contracts/src/TouchstoneHook.sol:90-94 (the lock is not checked on the swap path), contracts/src/TouchstoneHook.sol:225-256
**Description**: This has the same root cause as TOK-1. While the native refund is being pushed, the recipient can swap on any pool, including this one, inside the hook's unlock. I found no exploit beyond TOK-1:
- Every `finalize` effect has already been written before the push: the hash delete, outstanding, the rebate pool, vest, and the drip.
- `_donate` has already run.
- The nested swap's transient writes are not read by finalize afterwards.
- A nested `drip` or `settle` hits the lock.

This is threat T20, which belongs to M10.
**Proof of Concept**: None. The existing `test_Reentrancy_DuringFinalizeIsBlocked` covers re-entering `drip`.
**Recommendation**: TOK-1's fix resolves this. Otherwise, add a nested-swap actor to the M10 T20 test.

## [TOK-8] The hook trusts nonce-predicted support addresses; a partial broadcast lets the deployer's later transactions decide what code sits there
**Severity**: Info
**Category**: evm-audit-assembly
**Location**: contracts/script/base/CoreDeployer.sol:49-80
**Description**: `SETTLER`, `LEDGER` and `FACTORY` are the deployer's CREATE addresses at nonces n, n+1 and n+2, and they are baked into the hook's CREATE2 init code. The `vm.getNonce` and `_check` assertions only run in the forge simulation.

If a support deployment fails or is dropped on chain while the hook transaction lands, the hook points at whatever the deployer's next transaction at that nonce puts there. That could be a Settler that is allowed to call `finalize`.

A third party cannot exploit this. Only the deployer controls those nonces, and the CREATE2 address commits to the full init code, so someone front-running with the same salt just deploys an identical hook. But users can only confirm the "no owner" claim if they check the code at all three addresses.
**Proof of Concept**: Not applicable; this is a property of the deployment process.
**Recommendation**: Add an on-chain post-deploy check (M8 script and runbook):
- `extcodehash` at `SETTLER`, `LEDGER` and `FACTORY` equals the hashes of the built artifacts;
- `RebateLedger.HOOK`, `TouchstoneFactory.HOOK` and `Settler.HOOK` all equal the hook address.

Publish those hashes with the deployment.

## Checked and safe

**ERC-20 checklist**
- Fee-on-transfer: deposits are ERC-6909 claims minted from the swap delta (TouchstoneHook.sol:422). There is no `transferFrom` and no token-balance accounting, so nothing can be inflated. Recipients receive whatever `take` delivers, which is standard v4 behaviour.
- Rebasing: no token balances are cached. Positive rebases stay in the PoolManager. A negative-rebase shortfall makes `take` revert; the refund try/catch absorbs it, and the tip side is TOK-2.
- Zero-amount transfers: every push and credit is guarded with `!= 0` (TouchstoneHook.sol:469, 476, 479, 484, 546-549; RebateLedger.sol:87).
- LUSD-style rejecting recipient and blocklisted beneficiary: the revert is caught and the refund deferred to the ledger (TouchstoneHook.sol:512-518). `claim(currency, to)` lets the beneficiary redirect it (RebateLedger.sol:42-46), and `claimAsClaims` avoids the token entirely.
- Blocklisted `rebateTo` or `protocolRecipient`: both are always credited to the ledger, never pushed (TouchstoneHook.sol:470, 477).
- A blocklisted or reverting trader cannot brick finalize for other records: each record is finalized independently, and no other record's recipient is pushed to.
- Blocklisting the hook or ledger address has no effect: they hold claims, not tokens, and every token `transfer` is sent by the PoolManager.
- Pausing: the protocol has no pause. A token pause is TOK-2.
- Admin mint/burn, flash-mint and `totalSupply`: unused in `src/`.
- Approvals (USDT race, BNB zero-approve, infinite approvals): Touchstone makes none.
- Missing return values and Solmate's missing code-existence check: there are no direct ERC-20 calls; v4 `CurrencyLibrary` handles both.
- Decimals of 0 or above 18: handled exponent-wise with mulDiv (PriceLib.sol:39-44, ReferenceLib.sol:72-83). Absurd values are TOK-6.
- `decimals()` on address(0): native ETH short-circuits to `NATIVE_DECIMALS` (TouchstoneFactory.sol:198).
- ERC-777 and ERC-677 hooks: same vector as native ETH (TOK-1, TOK-4). Re-entry into the hook is stopped by the lock (TouchstoneHook.sol:90-94).
- Permit variants and phantom permit: unused.
- cUSDCv3-style `type(uint256).max` transfers: all amounts are below 2^128.
- `transferFrom` self-allowance quirks, multiple-address tokens and native ERC-20 aliases: only PoolManager claims move; aliasing is a v4 listing concern.
- Non-string metadata: only `decimals()` is read.
- Native ETH as currency0: the excess Pyth fee is refunded to the caller itself (Settler.sol:85-88). Ledger native pushes run in the ledger's own unlock, so a recipient can only stall its own claim.

**DoS checklist**
- Unbounded loops: there are none in `src/`. The only loops have fixed length (PriceLib.sol:109, 117).
- External calls in loops or batch payouts: none. Records live in a mapping keyed by id; there are no arrays.
- Returndata bomb in the `pushOut` try/catch: the hook's `catch {}` binds no data, and nested copying is bounded by the 63/64 budget (TOK-4).
- Starving the try/catch of gas: if the inner call runs out of gas, the outer frame keeps about 1/64 of it. For a ~45k push that is roughly 700 gas, while the ledger fallback needs about 60k. A keeper cannot use this to force a deferral.
- Conservation check reverting: the benign payout is computed in the same transaction against the same `rebatePool` (Settler.sol:231, TouchstoneHook.sol:136). The expiry payout always conserves (Settler.sol:246-249, SettlementMath.sol:153).
- Trader-forced math reverts at settle time: markout, the ITM leg and the conversions use mulDiv on bounded inputs. Aside from TOK-1, I found no input the trader controls that can force a revert.
- Donate reverting: `_dripEffects` returns zero when liquidity is zero (TouchstoneHook.sol:533), so `NoLiquidityToReceiveFees` cannot fire.
- Drip griefing: the restart without liquidity is decision 0026. Calling drip every block only stalls release while `vest * elapsed < vestPeriod`, which is at most 86,400 base units (dust).
- Swap-path gas griefing: the swap path only calls the immutable sequencer feed, the four immutable trusted routers, and the per-pool Chainlink feed (inside try/catch). A bad feed can only grief the pool whose creator chose it.
- Block stuffing: a settlement can be included any time until someone expires the record, which is at least an hour. `maxLag` limits the Pyth publish time, not when the transaction is included.
- Timelock griefing, pause bricking, paymaster spam and liquidation griefing: not applicable.
- Oracle DoS: the Chainlink reads are wrapped in try/catch (ReferenceLib.sol:33-46, 55-63). If Pyth is unavailable, records resolve through expiry (D-6).
- `balanceOf` reverting: only the PoolManager's ERC-6909 `balanceOf` is read (RebateLedger.sol:36).
- Ledger shortfall: every credit is backed by a claim transfer in the same call (TouchstoneHook.sol:521-522).

**Assembly checklist**
- TransientLib slot derivation: slots are `keccak256(abi.encode(label, id))` with distinct keccak labels. Pools and keys cannot collide short of a keccak collision, and the namespace belongs to the hook alone (TransientLib.sol:22-24).
- Clearing between swaps: `_beforeSwap` resets `LAST_DEPOSIT` and `LAST_RECORD` and overwrites the pre-swap snapshot for each swap (TouchstoneHook.sol:233-237). Nothing runs between a pool's before- and after-swap hooks, so multiple swaps in one unlock each read their own snapshot. `FIRST_TOUCH_TX` lasting for the whole transaction is the specified rule (decision 0030).
- Lock: a global transient flag that is restored on revert and released on success (TouchstoneHook.sol:90-94). It is only ever stored as a clean bool.
- Dirty bits, memory safety, assembly division and overflow: the assembly only does whole-word `tstore`/`tload`, with no memory, arithmetic or returndata use.
- CREATE2 metamorphic contracts: there is no `selfdestruct` and no `delegatecall`. The hook is deployed through the deterministic CREATE2 proxy with fixed init code; the support contracts use plain CREATE from an EOA.
- CREATE2 front-running and salt predictability: the salt is public, but the address commits to the init code, which includes the support addresses. A front-runner therefore deploys an identical hook; the only effect is a griefed `Create2Failed` check in the script.
- Calling the hook before it is deployed: `createPool` reverts on Solidity's code-existence check for `register`.
- extcodesize/isContract checks, precompiles, PUSH0 and calldataload: none are used. The compile target is `cancun`, and the ArbSys address is a named constant selected by an immutable.
- CREATE nonces and reorgs: only the deployer's own nonces are involved. The remaining process risk is TOK-8.
