# Oracle and chain-specific findings

Scope: `contracts/src` as of 28 October 2026, walked against `checklist-oracles.md` and `checklist-chain-specific.md`. Pyth semantics were checked against the vendored SDK (`contracts/lib/pyth-sdk-solidity/IPyth.sol`, `PythErrors.sol`) and the project's `MockPythUnique`. The mock encodes the rule `minPublishTime <= publishTime <= maxPublishTime && prevPublishTime < minPublishTime`.

Proofs of concept: `docs/audits/ethskills-2026-10-28/poc/OraclePoC.t.sol`. There are 7 tests and all pass against the current code. The hook and Settler are deployed from artifacts through `TouchstoneFixture`.

Answers to the specific questions:

- **Keeper cherry-picking a Pyth update:** not possible for the price.
  - `parsePriceFeedUpdatesUnique` accepts, per feed, only the update whose previous publish time is before t0. So each feed has exactly one valid signed update in `[t0, t0 + maxLag]` (Settler.sol:73-78).
  - The keeper still chooses when to call, but the price does not change with the call time.
  - The keeper also chooses whether to call at all; if nobody does, the record ends at expiry with a full refund (ORC-4).
  - The guarantee is tested only against the project's own mock (ORC-5).
- **No Pyth update in the window:** correct.
  - Settle reverts with `PriceFeedNotFoundWithinRange` for every update.
  - `expire` pays `refund = deposit`, `tip = 0` after `t0 + window` (Settler.sol:92-98, 246-249).
  - The hook rejects any expiry payout that is benign or short (TouchstoneHook.sol:138).
  - The same fallback covers a non-positive Pyth price, an out-of-range exponent, and any other deterministic revert in `_payout`.
- **Chainlink answer checks:**
  - `answer <= 0`, `updatedAt == 0`, `updatedAt` in the future, and age above `referenceMaxAge` all return ok = false (ReferenceLib.sol:39-40).
  - Decimals come from the feed (42-47).
  - `answeredInRound` is deprecated by Chainlink and correctly unused.
  - `minAnswer`/`maxAnswer` are not checked. The only effect is on the drift trigger and the deposit size (ORC-3).
- **Stale or down Chainlink feed:** the code chooses liveness. The drift trigger turns off and the deposit falls to the floor rate, consistent with decision 0003. There are two caveats:
  - A feed address without code, or one returning short data, reverts the swap (ORC-1).
  - Decision 0022's claim that no amount depends on the reference is wrong (ORC-3).
- **Exponent mismatch between base and quote Pyth feeds:** handled.
  - `fairPriceX36` combines both exponents and both token decimals into one power `k` (PriceLib.sol:39).
  - It reverts outside `|k| <= 76`, and that revert only routes the record to the expiry refund.

## [ORC-1] Reference and sequencer reads revert the swap on a feed without code or with short return data
**Severity**: Medium
**Category**: evm-audit-oracles
**Location**: contracts/src/libraries/ReferenceLib.sol:33, contracts/src/libraries/ReferenceLib.sol:42, contracts/src/libraries/ReferenceLib.sol:55, contracts/src/TouchstoneHook.sol:333-335, contracts/src/TouchstoneFactory.sol:148-152, contracts/src/TouchstoneHook.sol:103
**Description**: `ReferenceLib` promises that it "never reverts", and the hook relies on that: "No dependency failure can revert the swap" (TouchstoneHook.sol:242-243, decision 0003).

Solidity's `try`/`catch` only catches a revert raised inside the callee. When the call succeeds but returns fewer bytes than the declared return types, the ABI decode fails in the caller and is not caught. Two cases cause this:
- The target has no code. A call to an empty account succeeds with empty return data, and 0.8.26 skips the extcodesize check when return data is expected.
- A contract returns short data, for example a proxy whose implementation was removed, or a contract that is not an aggregator.

Nothing checks the address. The factory accepts any non-zero `referenceFeed` (TouchstoneFactory.sol:148-152), and the hook constructor accepts any `sequencerFeed` (TouchstoneHook.sol:103). Both values are immutable after deployment.

Effect: every swap that reaches `_gap` reverts. That is every swap with notional at least `n0`, or one that fills the flow bucket (TouchstoneHook.sol:280-285).
- A bad `referenceFeed` disables one pool's large swaps for good.
- A bad `SEQUENCER_FEED` disables the large swaps of every pool that has a reference feed, because the sequencer read comes first (TouchstoneHook.sol:333).
- LP exits are unaffected, because the hook has no liquidity callbacks. Funds are not frozen, but the pool stops serving its main trade size and must be abandoned.

A realistic trigger is a configuration copied across chains. For example, a Chainlink address that is valid on Arbitrum Sepolia has no code on Base Sepolia, or a mainnet L2 uptime-feed address is used on a testnet. There is no per-chain config file yet (`contracts/script/config/` is empty), so nothing catches this before deployment.
**Proof of Concept**: `OraclePoC.t.sol`:
- `test_NoCodeReferenceFeed_RevertsLargeSwaps` creates a second pool whose `referenceFeed` is an address with no code. A $100 swap succeeds and a $50,000 swap reverts inside `afterSwap`. The trace ends at the feed's `latestRoundData` and reverts in the hook.
- `test_ShortReturnReferenceFeed_RevertsLargeSwaps` uses a contract that returns one word. The call succeeds and the hook reverts with empty data, which is the decode failure. This is ordinary EVM behaviour and does not depend on Foundry's non-contract-call check.
- `test_NoCodeSequencerFeed_RevertsLargeSwapsOnAllPools` redeploys the hook with `sequencerFeed` set to a codeless address. The large swap that succeeded before now reverts.
**Recommendation**:
- Read the feeds with a low-level `staticcall` under a fixed gas cap, defined as a named constant or an immutable.
- Before decoding, require `returndata.length >= 160` for `latestRoundData` and `>= 32` for `decimals`. Otherwise return ok = false, or "down" for the sequencer feed.
- Reject `referenceFeed.code.length == 0` in `TouchstoneFactory._validate`.
- Reject `sequencerFeed != address(0) && sequencerFeed.code.length == 0` in the hook constructor.
- Keep the proofs of concept as regression tests under `test/adversarial/`.

## [ORC-2] BLOCK_SOURCE is not validated against the chain
**Severity**: Low
**Category**: evm-audit-chain-specific
**Location**: contracts/src/TouchstoneHook.sol:102, contracts/src/libraries/BlockLib.sol:25-28, contracts/src/TouchstoneHook.sol:286, contracts/src/TouchstoneHook.sol:344, contracts/script/base/CoreDeployer.sol:60
**Description**: The block source is a constructor immutable taken unchecked from the deploy parameters. There are three wrong settings, and none of them is detected:
1. **`SOURCE_ARBSYS` on a chain without the ArbSys precompile.** This covers Base and Ethereum mainnet, the planned second and third targets. `ARBSYS.arbBlockNumber()` is a plain external call without try/catch. On Base and Ethereum, 0x64 has no code, so every swap with notional at least `n0` reverts in `_firstTouch` on every pool, for good.
2. **`SOURCE_EVM` on Arbitrum.** There, `block.number` is an approximate L1 block number. The first-touch rule then fires once per L1 block, which spans many L2 blocks, instead of once per L2 block. First-touch flags silently fall to a fraction of the intended rate.
3. **Any value other than 0 or 1.** It silently means `block.number`.

`BlockLib` rightly avoids chain-ID checks, but then the deployment has to prove the choice, and nothing does.
**Proof of Concept**: In `OraclePoC.t.sol`:
- `test_ArbSysSourceOnNonArbitrum_RevertsLargeSwaps` redeploys the hook with `SOURCE_ARBSYS` on a chain without the precompile. The large swap that succeeded before now reverts with "call to non-contract address 0x...64" inside `afterSwap`.
- `test_UnknownBlockSourceAccepted` deploys with source 7, which works as `SOURCE_EVM`.
**Recommendation**:
- In the hook constructor, revert unless `blockSource <= SOURCE_ARBSYS`.
- When the source is `SOURCE_ARBSYS`, call `arbBlockNumber()` once in the constructor, so that a deployment to the wrong chain fails at construction.
- Put `blockSource` in `script/config/<chain>.json` next to the chain's other values.
- Add a fork test per target chain that deploys the core and checks that `BlockLib.number` advances once per L2 block.

## [ORC-3] The reference sets the deposit size, and a stale, lagging or clamped reference silently caps LP recovery
**Severity**: Low
**Category**: evm-audit-oracles
**Location**: contracts/src/libraries/ReferenceLib.sol:8, contracts/src/TouchstoneHook.sol:285, contracts/src/TouchstoneHook.sol:302-306, contracts/src/libraries/DepositLib.sol:32-35, docs/decisions/0022-reference-denomination.md
**Description**: `ReferenceLib`'s NatSpec says the reference "never sets an amount", and decision 0022 says "no amount depends on it". Both are false.
- The deposit rate is `min(deltaMax, max(delta, beta * g+))`, where `g` is the gap to the Chainlink reference (DepositLib.sol:32-35, TouchstoneHook.sol:302-304).
- The LPs' clawback is capped at the deposit, `R = min(D, ...)` (SettlementMath.sol:78).

Whenever the reference is absent, the gap is 0 and every flagged swap pays only the floor rate `delta`. "Absent" covers four cases:
- stale, meaning older than `referenceMaxAge`, which can be up to 90,000 s;
- reverting;
- inside the sequencer grace period;
- a non-positive answer.

The same happens, with no failure at all, in two more cases:
- **The push feed lags a fast move.** The arbitrageur trades before the deviation-triggered round lands, so the gap is measured against the pre-move reference, which is close to the stale pool price.
- **The feed is clamped** at `minAnswer`/`maxAnswer`, which are not checked.

None of these cases emits anything, so the keeper and indexer cannot tell how often deposits were sized without a reference. This is a property of the specified mechanism (D-3 and the §7.6 deposit formula), and the formula is not challenged here. The finding is that the documented trust assumption understates the reference's role.
**Proof of Concept**: `OraclePoC.t.sol::test_StaleReference_DepositDropsToFloor`.
- The feed shows a fair price 3% above the pool. A $50,000 buy posts 497,264,794,924,006,814 wei, with the rate capped at 300 bps.
- The same swap after the feed passes `referenceMaxAge` posts 49,726,479,492,400,681 wei at the 30 bps floor, 10 times less.
- With a settled markout of about 3% of notional and alpha at 80%, R would be about 240 bps of notional, but it is capped at 30 bps.
**Recommendation**:
- Correct decision 0022, the `ReferenceLib` NatSpec and lesson 01 to say that the reference decides both which swaps are flagged and how much they post.
- Emit an event, or keep a per-pool counter, when the hook flags a swap with the reference absent, so that the indexer can alert on it.
- Ask the owners, under §0.11, whether the research backtest models Chainlink round latency on the target chains when it sets the defaults for `delta`, `beta` and `tau`. If it uses an unlagged reference, the pre-registered pass lines measure a different trigger from the one deployed.

## [ORC-4] Expiry is a race, not a deadline: settle stays valid after expiresAt
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: contracts/src/Settler.sol:63-71, contracts/src/Settler.sol:92-96
**Description**: `settle` checks only `block.timestamp >= t0`, and Pyth's parse functions do not check freshness against the block time. So a record can be settled at any time until something finalizes it.

After `expiresAt`, the trader's `expire` (full refund) and a keeper's `settle` are both valid. The sequencer's ordering decides between them: first come, first served on Arbitrum, priority fee on Base.

If the sequencer is down for longer than `window` (at least 1 hour) while a toxic record is open, the trader can submit `expire` for the first block after restart. The Settler never reads the sequencer uptime feed.

This favours LPs compared with a hard deadline and matches lesson 03 ("Nobody settles: LPs lose the clawback"). But it is not documented, and the keeper should treat expiry as a race it can still win.
**Proof of Concept**: `OraclePoC.t.sol::test_SettleAfterExpiry` settles a record one day and one second after t0, with `window = 1 days`.
**Recommendation**: Record the behaviour in a decision, and make sure the keeper keeps trying to settle past `expiresAt` instead of handing the record to `expire`. Whether expiry should pause during sequencer downtime is a mechanism question for the owners.

## [ORC-5] The anti-cherry-pick guarantee (T1) is tested only against a project-written Pyth mock
**Severity**: Info
**Category**: evm-audit-oracles
**Location**: contracts/test/mocks/MockPythUnique.sol:25-46, contracts/test/unit/Settlement.t.sol:132-142, contracts/src/Settler.sol:33-34
**Description**: The Settler's main oracle claim, that "no caller can choose the settlement price", rests entirely on the deployed Pyth contract applying `prevPublishTime < minPublishTime` in `parsePriceFeedUpdatesUnique`.
- The `IPyth.sol` NatSpec describes this only loosely ("the first updates published in minPublishTime").
- The mock's own comment says that Pyth's SDK `MockPyth` passes `checkUniqueness = false`.
- `contracts/test/fork/` and `contracts/test/fixtures/hermes/` are empty. The rule has never been run against the real contract (1.4.6 on Arbitrum and Base Sepolia) or against real Hermes accumulator blobs.

That leaves two things unverified: that `getUpdateFee` counts messages rather than array entries, and that two updates in the same publish second are told apart by `prevPublishTime`.
**Proof of Concept**: Not applicable. This is a gap in test coverage, not an exploit.
**Recommendation**: Add a fork test on Arbitrum Sepolia that uses two consecutive real Hermes updates of ETH/USD and USDC/USD around a chosen t0, recorded as fixtures with their hashes. Assert that:
- the first update is accepted;
- the second reverts with `PriceFeedNotFoundWithinRange`;
- the fee matches what `getUpdateFee` reports.

## [ORC-6] Pool creation accepts Pyth IDs that can never settle
**Severity**: Info
**Category**: evm-audit-oracles
**Location**: contracts/src/TouchstoneFactory.sol:113, contracts/src/TouchstoneFactory.sol:160
**Description**: `createPool` is permissionless, and it checks only that `basePriceId` and `quotePriceId` are non-zero.
- `base == quote` is accepted, which gives P* = 1 scaled by decimals, a meaningless price.
- IDs that Pyth does not publish are accepted.

Every record of such a pool reverts in `settle` and ends with a full refund at expiry. The LPs get no protection, even though the pool carries the Touchstone hook.
**Proof of Concept**: By inspection. `_validate` does not compare the two IDs.
**Recommendation**: Reject `basePriceId == quotePriceId`. Have the indexer and dashboard mark pools whose records have never settled, or whose IDs are not on the Hermes feed list.

## [ORC-7] The tx.origin fallback beneficiary is an aliased address for L1-originated swaps
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: contracts/src/TouchstoneHook.sol:452
**Description**: When no trusted router or hookData names a beneficiary, the refund goes to `tx.origin`. A swap sent by an L1 contract as an Arbitrum retryable or an OP Stack deposit transaction runs with `tx.origin` set to the aliased L1 address (`L1 + 0x1111...1111`). The refund transfer succeeds, so the ledger fallback does not engage. The funds then sit at an address that only the L1 contract can reach, through further L1-to-L2 messages.
**Proof of Concept**: By inspection of the Arbitrum and OP Stack aliasing rules.
**Recommendation**: Document in the integration notes that L1-originated swaps must name a beneficiary in hookData (T16).

## [ORC-8] Chain-dependent oracle parameters have no per-chain source and loose bounds
**Severity**: Info
**Category**: evm-audit-chain-specific
**Location**: contracts/src/TouchstoneHook.sol:103-104, contracts/src/TouchstoneFactory.sol:66-67, contracts/src/libraries/ReferenceLib.sol:54
**Description**:
- `SEQUENCER_GRACE` accepts any value, including 0, which reads a pre-outage reference immediately after restart. Chainlink's guidance is about an hour.
- A zero `SEQUENCER_FEED` is read as "up", which is correct only on L1.
- `referenceMaxAge` accepts anything from 60 to 90,000 s for any feed, whatever its heartbeat. Heartbeats differ by feed and by chain, so an ETH/USD feed with a 1-hour heartbeat would accept answers up to 25 hours old.
- No `script/config/<chain>.json` exists yet, so none of these values can be checked against the target chains.
**Proof of Concept**: By inspection.
**Recommendation**: Create the per-chain config files with the feed address, its heartbeat and decimals, the uptime feed, the grace period and the block source. Have the deploy script assert that:
- `referenceMaxAge` is at most the heartbeat plus a margin;
- `grace >= 3600` where an uptime feed exists;
- an uptime feed is set on every L2.

## Checked and safe

- Chainlink staleness: `block.timestamp - updatedAt > maxAge` gives ok = false (ReferenceLib.sol:40); maxAge is per pool, not a global constant (PoolConfig.sol:23).
- Chainlink `updatedAt == 0` and `updatedAt` in the future rejected (ReferenceLib.sol:39).
- Chainlink negative or zero answer rejected before any cast (ReferenceLib.sol:39, cast at 47).
- Chainlink `answeredInRound` unused: deprecated by Chainlink; the timestamp check is the supported signal.
- Chainlink `startedAt` on the price feed unused: `updatedAt` is checked instead, which is sufficient.
- Chainlink decimals read from the feed on every call, never assumed to be 8 (ReferenceLib.sol:42-47); scaling range-checked, and no overflow (ReferenceLib.sol:72-83).
- Chainlink revert caught and treated as absent (ReferenceLib.sol:36-38); for no-code or short-return feeds see ORC-1.
- Chainlink feed deprecation: a deprecated feed goes stale, the reference becomes absent, swaps continue (decision 0003); the effect on deposits is ORC-3.
- Chainlink denomination (USD as the quote): recorded as intended in decision 0022; settlement uses Pyth's own quote feed, so a USDC depeg is priced at settlement.
- L2 sequencer uptime: `answer != 0` (down), `startedAt == 0` (uninitialised on Arbitrum) and a future `startedAt` all count as down, plus a grace period (ReferenceLib.sol:59-60); grace bounds are in ORC-8.
- Pyth pull model: the Settler parses the caller's signed update itself and never reads stored prices (Settler.sol:77-78).
- Pyth publish-time window: limited to `[t0, t0 + maxLag]` with `maxLag < window` (Settler.sol:78, TouchstoneFactory.sol:168).
- Pyth uniqueness: one valid update per feed under the documented rule (Settler.sol:78); test coverage in ORC-5.
- Pyth confidence: `conf_b/p_b + conf_q/p_q` rounded up, full refund above `maxConfBps`, otherwise added to eps (PriceLib.sol:49-55, Settler.sol:141, 162); the products cannot overflow (2^64 x 2^63 x 1e4).
- Pyth negative or zero price: `Touchstone__NonPositivePrice` (PriceLib.sol:38, 50); the record falls back to the expiry refund.
- Pyth exponents: both exponents and both token decimals combined in one power, bounded at 76 (PriceLib.sol:39-44); a positive exponent is handled the same way.
- Pyth fee: `getUpdateFee(pythUpdate)` paid exactly, excess refunded with `call`, and a failed refund reverts (Settler.sol:73, 78, 85-88); the Settler has no `receive`, so it can hold ETH only if ETH is force-sent, which only subsidises the next caller.
- Pyth feed order: the returned array follows `ids` order (base, quote), as IPyth specifies (Settler.sol:74-81).
- No Pyth update in the window, or any deterministic settle revert: `expire` after `t0 + window` refunds in full with zero tip, and the hook enforces that (Settler.sol:92-98, TouchstoneHook.sol:138).
- Settlement timing: `TooEarly` before t0 (Settler.sol:71); `settleDelay` 1-60 s and windows in seconds, not blocks (TouchstoneFactory.sol:166-171), so the 2 s blocks on OP Stack and 0.25 s blocks on Arbitrum need no calibration.
- Single oracle per role: Chainlink for the trigger and Pyth for settlement, by design (decision 0003); a failed trigger reference fails open to liveness and a failed settlement oracle falls back to a refund.
- Oracle update front-running: Pyth settlement uses a price after the swap, so the swap cannot react to it; Chainlink round lag is covered in ORC-3.
- Spot price manipulation: pool spot price is used only for the gap, read before the swap from a transient snapshot (TouchstoneHook.sol:233-235, 337); splitting a swap to shrink the gap is T4 and handled by the flow bucket.
- TWAP items (manipulation, geometric mean, window length, rebasing tokens, `observe()`): not applicable, as no TWAP is used.
- Read-only reentrancy on Balancer and Curve: not applicable.
- Peg assumptions (WBTC, stETH, USDC): no hardcoded peg; settlement prices both legs from per-pool Pyth IDs.
- LP token valuation: not applicable.
- VRF and randomness items: not applicable; no randomness is used.
- Multi-hop error: P* is the ratio of two Pyth USD feeds, and the confidence of both is summed into eps.
- Arbitrum `block.number`: the first-touch rule uses `ArbSys.arbBlockNumber()` when configured (BlockLib.sol:26); configuration in ORC-2.
- Arbitrum uniqueness by block: first touch is per BlockLib block, with transient-storage marking for later swaps in the same transaction (TouchstoneHook.sol:343-351).
- `block.basefee`, `prevrandao` and `difficulty`: not used anywhere in `src/`.
- `block.chainid`: not used; there are no signatures to replay.
- Retryable tickets and L2-to-L1 messages: not used.
- Address aliasing in access control: no L1-to-L2 access control exists; the beneficiary side effect is ORC-7.
- PUSH0, Cancun and transient storage: compiled for `cancun` (foundry.toml); Arbitrum (ArbOS 20 and later), Base and OP Stack (Ecotone and later) and Ethereum all support TSTORE, TLOAD, MCOPY and PUSH0, and v4's PoolManager needs the same.
- L1 data fees: no on-chain gas estimation; keeper profitability is computed off chain.
- Precompile address: ArbSys is 0x64 on every Arbitrum chain and is used only when configured; see ORC-2.
- Hardcoded token and infrastructure addresses: none in `src/`; the CREATE2 deployer address in the script is the same on every target chain.
- `transfer` and `send`: not used; ETH moves through `call` (Settler.sol:86) and PoolManager `take`.
- `tx.origin == msg.sender` EOA checks: none; `tx.origin` is used only as the fallback beneficiary (ORC-7).
- Timestamp anchor: records use the L2 `block.timestamp` and Pyth uses its own publish clock; Arbitrum and Base sequencers keep these within about a second in normal operation, and a force-included transaction is stamped no later than its submission, which cannot hide information the trader had then.
- zkSync, Blast, BNB Chain and Polygon items: not applicable; none is a target chain.
