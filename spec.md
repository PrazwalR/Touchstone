Touchstone developer docs

> Edited 31 October 2026 (decision 0050): the owners are not entering ETHGlobal Mumbai. The hackathon sections (the Mumbai plan, the hackathon compliance checklist and the demo script) were removed; the licence is no longer date-gated, and the schedule below is superseded by the plan in decision 0050.


Oct 18, 2026 · @Someone
Overview

Touchstone v2 is a Uniswap v4 hook and settlement system that prices order flow after the fact, against a canonical outside price. A single primitive drives four markets: a refundable deposit, settled against the earliest signed Pyth update after the trade.

Market
	

What it does
	

Money flow

Clawback
	

Flagged swaps post a deposit; settlement keeps a share of any markout above a margin
	

Arbitrageurs pay LPs

Licence auction
	

A continuously auctioned lease exempts one arbitrageur's first swap in each block; inside a price band, everyone else faces a steeper clawback
	

The holder pays LPs rent by the second

Benign-flow rebates
	

A slice of retained deposits and rent pays whoever a benign flagged swap names, usually its router
	

Clawback income and rent pay the routers that bring large benign trades

Quote integrity
	

previewDeposit, a URC-4 quote and a guarded router make the deposit exact inside the transaction
	

Routers stop seeing quote–execution gaps

Settlement runs in two modes. Continuous mode settles seconds after the trade. Closed-market mode settles tokenized-stock swaps at the reopen.
What differs from Hindsight

Hindsight (UHI10) bonds every swap and judges it about a minute later by the pool's own TWAP. It built ex-post settlement first, and Touchstone does not claim that idea. The two differ in what judges a trade, who posts a deposit, and three markets Hindsight does not have.


	

Hindsight
	

Touchstone v2

What judges the trade
	

The pool's own TWAP, about 45–60 s later
	

The first signed Pyth update at or after t + Δ, chosen by the contract, not the caller

Who posts a deposit
	

Every swap: 25 bps × a reputation multiplier
	

Flagged swaps only; retail below N₀ is untouched

Gas on an ordinary swap
	

About 233k (reported)
	

Target: 15k below N₀, 40k above it

Arbitrage rights
	

Not sold
	

Leased by auction; settlement makes the lease exclusive (section 7)

Closed markets
	

Not handled
	

Settled at the reopen, with their own α and ε and a jump guard (section 6)

Benign flow
	

Bond scaled by reputation
	

Cash rebates on markout-proven benign trades, paid to whoever the swap names (section 8)

Router quotes
	

A bond-aware minimum output, listed as future work
	

previewDeposit, a URC-4 quote, URC-2 events and GuardedRouter (section 9)

Splitting a trade
	

Cannot evade it: every swap is bonded
	

Bounded by the flow bucket; E5 measures the leak

Evidence
	

Built; a 7-day Unichain backtest clawed back 53.8% of positive markout
	

Nothing built yet; E1 to E12 pre-registered, with Hindsight-style settlement as a baseline in E7

The licence is the largest difference. Hindsight can only punish arbitrage after the fact. Touchstone can also sell the right to it in advance, and settlement is what makes that sale exclusive. That is why Touchstone works on first-come-first-served chains, where MEV taxes cannot.
Scope of v2.0

    Contracts: TouchstoneHook, Settler, LicenceAuction, RebateLedger, TouchstoneFactory, TouchstoneLens, GuardedRouter, NyseCalendar, and their libraries.

    Off-chain: keeper, indexer, dashboard, demo bots, and the research pipeline (E1–E12).

    Networks: Arbitrum Sepolia first, then Base Sepolia. No mainnet before an external audit.

Non-goals

    No owner, admin key or upgrade path. Parameters are fixed per pool at initialisation.

    No custom curve: the AMM stays plain v4 concentrated liquidity at a static fee.

    No off-chain auctioneer, no token and no prediction model. Triggers are fixed rules.

This is a design specification. Nothing in it has been built or tested yet. Every gas or performance figure marked target is a goal, not a measurement.
Architecture

Seven contracts and a market calendar, three off-chain services, and two outside price sources. Money moves in only four places, finalize, creditRent, drip and the ledger's claims, and each checks conservation before it pays.
A flagged swap leaves a deposit, and a signed price seconds later splits itArrows are calls or payments. The dashed box runs off-chain.swapcallbacksrefundrentfinalizesigned pricesettle at t₀vested donationsrebatesTrader or routerAny caller worksGuardedRouter caps depositsPoolManagerUniswap v4 runs the swapand calls the hook twicePythSigned outside pricesFirst update after t₀ onlyLicenceAuctionLeases a deposit exemptionon the first swap per blockRent to LPs by the secondTouchstoneHookFlags likely arbitrageHolds deposits as claimsPays refunds, LPs, rebatesSettlerChecks record and priceComputes markout and splitHolds no fundsRebateLedgerRebates for benign tradesand refunds that bouncedLPs in rangeRetained value and rent,vested over 30 minutesKeeper (off-chain)Gets the update from HermesAnyone may do its job
The life of a flagged swap

    Swap. A trader or router swaps through the PoolManager. In beforeSwap the hook snapshots the price and liquidity. In afterSwap it checks the licence and the triggers, takes the deposit as ERC-6909 claims, commits the record's hash, and emits DepositTaken and URC-2 HookSwap.

    Wait. Δ seconds in continuous mode, or until the reopen for a closure record.

    Settle. A keeper fetches the first Pyth update at or after t₀ from Hermes and calls Settler.settle. The Settler checks the record against its hash, lets Pyth enforce that the update is the first one, computes the markout, picks the regime and builds the split.

    Pay. finalize burns the record's claims. The refund goes to the beneficiary, or to the ledger if the push fails; the tip goes to the caller; a rebate is credited in the ledger; and the LPs' share joins the vesting buffer, which drip donates to in-range LPs over 30 minutes.

    Licence, alongside. Bidders lease the exemption. accrue sends rent to the hook, and afterSwap asks holderOf whether a swap is the holder's first in its block.

Contracts

Contract
	

Role
	

Holds funds
	

Called by

TouchstoneHook
	

Swap callbacks, triggers, records, vesting, payouts
	

Claims for open records, vesting and the rebate pool
	

PoolManager; Settler (finalize); auction (creditRent); anyone (drip)

Settler
	

Pyth verification, markout, regime and split
	

No; it forwards the Pyth fee
	

Anyone

LicenceAuction
	

The lease state machine
	

Bidders' deposits, in the quote token
	

Bidders; anyone (accrue); the hook (holderOf)

RebateLedger
	

Rebates and deferred refunds
	

Claims it owes
	

The hook (credit); recipients (claim)

TouchstoneFactory
	

Validates configs and creates pools
	

No
	

Pool creators

TouchstoneLens
	

URC-4 quotes through StaticQuoteLib
	

No
	

The hook's forwarders; routers

GuardedRouter
	

Single-pool swaps with an in-transaction deposit check
	

Only during a swap
	

Traders

NyseCalendar
	

Regular-session times for stock pools
	

No
	

The hook and the Settler

Off-chain, the keeper, the indexer and the dashboard are described in section 12. Outside, Pyth supplies settlement prices, Hermes serves them, and Chainlink supplies the drift trigger's reference.
Design rules

    One-way trust. The hook trusts only its immutables: the PoolManager, the Settler, the auction, the ledger, the factory, the lens and its listed routers.

    The swap path never reverts on a dependency. A failed reference, licence or calendar read means no deposit or no exemption, never a failed swap.

    Conservation where money moves. Every payout is checked against the record's deposit before anything is paid.

    No admin. Nothing can be paused, upgraded or re-parameterised after deployment.

Repository layout, toolchain and conventions

The repository is one monorepo. Contracts sit at the root, and each off-chain service is its own package with its own lockfile.

touchstone/
  src/
    TouchstoneHook.sol            callbacks, custody of deposits, records, vesting, payouts
    Settler.sol                   Pyth verification, markout math, regime choice, split
    LicenceAuction.sol            lease of the clawback exemption (section 7)
    RebateLedger.sol              rebates and deferred refunds, claimed by recipients
    TouchstoneFactory.sol         validate config, register, initialize
    periphery/GuardedRouter.sol   quote-then-swap-then-assert router; implements IMsgSender
    periphery/TouchstoneLens.sol  URC-4 quotes behind the hook's forwarders
    calendar/NyseCalendar.sol     market schedule for closed-market pools
    libraries/                    TriggerLib, MarkoutLib, PythPriceLib, RecordLib, VestingLib,
                                  BlockLib, StaticQuoteLib, TransientLib
    interfaces/                   ITouchstoneHook, ISettler, ILicenceAuction, IRebateLedger,
                                  ITouchstoneFactory, IGuardedRouter, IMarketCalendar, IALFHook,
                                  ITouchstoneErrors, ITouchstoneEvents
    types/                        PoolConfig.sol, PoolState.sol, Record.sol, Payout.sol
  test/     unit/ invariant/ fuzz/ fork/ gas/ differential/ mocks/ (Mock* only)
  script/   MineHookAddress.s.sol DeployCore.s.sol CreatePool.s.sol Verify.s.sol config/<chain>.json
  keeper/     TypeScript, viem
  indexer/    TypeScript, SQLite or Postgres
  dashboard/  Next.js, read-only
  research/   Python package: ingest/ replay/ experiments/ sims/ prereg/
  sim/        Rust revm bytecode replay, adapted from VANE
  docs/       SPEC.md (this document, exported) threat-model.md gas.md decisions/ lessons/ ai/
  README.md FEEDBACK.md AI_USAGE.md DEPLOYMENTS.md .env.example

Pinned dependencies

Dependency
	

Pin
	

Why this one

Solidity
	

0.8.26, EVM cancun
	

Matches OpenZeppelin uniswap-hooks; transient storage needs Cancun

Uniswap v4-core
	

46c6834 (2 Apr 2026)
	

SwapParams lives in types/PoolOperation.sol at this commit

Uniswap v4-periphery
	

9969eec (19 Sep 2026)
	

IMsgSender, HookMiner (test/shared)

OpenZeppelin uniswap-hooks
	

v1.3.0 (b5f1057)
	

BaseHook with _beforeSwap/_afterSwap override points

Pyth SDK (Solidity)
	

pin to a release tag on day 1
	

IPyth.parsePriceFeedUpdatesUnique, PythStructs

Foundry
	

pin to a release tag on day 1
	

Reproducible builds and gas snapshots

Solidity dependencies are git submodules pinned to a commit, never a branch. Node, Python and Rust dependencies are locked (pnpm-lock.yaml, requirements.lock, Cargo.lock).
Conventions

The standing rules from the Assay developer specification (§0) apply unchanged. In short:

    Code. pragma solidity 0.8.26; pinned, never ^. Custom errors only, named Touchstone__ReasonInPascalCase. NatSpec on every external and public member. Named imports only.

    Storage. Structs are packed, with a comment above each struct giving the bit budget. No public state variables unless the getter is part of the API.

    Unchecked blocks carry a comment stating the invariant that rules out overflow.

    No hardcoded values. Every address, threshold, window and fee comes from PoolConfig, an immutable, a named constant or a deploy-script parameter.

    No stubs in src/. Mocks live only in test/mocks/ and are named Mock*.

    Commits. Conventional, imperative, one logical change each, no emoji. The rationale goes in the body.

    Validation after every change: forge fmt --check, forge build --sizes, forge test, the invariant suite, forge coverage, slither, plus ruff/mypy --strict, cargo clippy and tsc --noEmit for the packages touched.

TouchstoneHook

TouchstoneHook is the only contract the PoolManager calls. It flags swaps, takes deposits as ERC-6909 claims and commits a hash of each record. It moves funds only when the Settler finalizes a record. It inherits OpenZeppelin's BaseHook (v1.3.0), which supplies onlyPoolManager and permission validation.
Permissions

Flag
	

Bit
	

Why

beforeInitialize
	

1 << 13
	

Lock the pool's config; reject pools the factory did not create

beforeSwap
	

1 << 7
	

Snapshot the pre-swap price, tick and liquidity in transient storage

afterSwap
	

1 << 6
	

Check the licence, evaluate triggers, take the deposit

afterSwapReturnDelta
	

1 << 2
	

Return +D on the unspecified currency

The mined hook address must end in the flag bits 0x20C4. The hook has no liquidity callbacks, so it can never block an LP's exit. It has no beforeSwapReturnDelta, so it never changes the AMM's execution. Pools use an ordinary static fee, and beforeSwap returns a zero fee override.
Immutables

POOL_MANAGER (from BaseHook), SETTLER, LICENCE, LEDGER, FACTORY, LENS, BLOCK_SOURCE, and up to four TRUSTED_ROUTER_n addresses: routers that implement v4-periphery's IMsgSender, such as the Universal Router and GuardedRouter on each chain. Section 11 explains how the deploy script resolves the circular references.
Storage

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

Records are committed by hash. The full record is emitted in DepositTaken, and the settler passes it back as calldata. One new storage slot per flagged swap, cleared at settlement for a refund, instead of four.

Transient slots are keyed by PoolId, so swaps on different pools inside one unlock never overwrite each other: PRE_SQRT_PRICE, PRE_LIQUIDITY, FIRST_TOUCH_TX, LAST_DEPOSIT and LAST_RECORD. beforeSwap zeroes the last two, so a read after an unflagged swap returns nothing. A separate transient LOCK guards finalize, creditRent and drip against reentrancy.
Swap path

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
    if mode == CONTINUOUS and licence pool and N >= n0 and the fast path holds (section 7):
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

Returning +D credits the hook on the unspecified currency, and the PoolManager subtracts it from the swapper (callerDelta = swapDelta − hookDelta in v4-core Hooks.afterSwap). The mint call balances the hook's credit within the same callback.
Triggers

The flow bucket sees every swap. The other triggers apply only when N ≥ N₀, so an ordinary retail swap posts no deposit and pays for no oracle read unless it belongs to a burst large enough to fill the bucket.

Trigger
	

Rule
	

Notes

First touch
	

The first swap at or above N₀ in the block, by BlockLib's block number
	

Every later swap in that transaction also counts. A swap below N₀ never uses up the status. On sub-second chains nearly every swap above N₀ is a first touch

Flow
	

The bucket for the swap's direction, after adding N, holds at least N_min
	

Applies to every swap, even below N₀. The bucket drains at N_min / h per second, so splitting a trade across swaps or blocks still fills it

Drift
	

g = s · (P_ref − p_pre) / P_ref ≥ τ
	

P_ref is the Chainlink answer, ignored if older than referenceMaxAge. Read only for swaps that pass the retail check

Closed market
	

The calendar is closed now, or at t + Δ + maxLag
	

Every swap at or above N₀ is flagged, at the closure rate δ_c (section 6)
Deposit size and currency

Scaling by the pre-swap gap g⁺ keeps the cap from binding on large dislocations. When the unspecified currency is the risky token, the hook converts at the swap's own execution price, D = D_quote / p_exec, so no oracle is needed at swap time. Closed-market records use δ_c in place of the bracket.
Refund beneficiary

    If sender is a trusted router, the beneficiary is IMsgSender(sender).msgSender(). The Universal Router's Dispatcher returns the address that started the lock.

    Otherwise, the beneficiary named in hookData, if it is non-zero (the 32- and 64-byte forms in section 8). hookData is untrusted and supplies only the beneficiary and the rebate recipient.

    Otherwise tx.origin. Relayed and ERC-4337 transactions should go through a trusted router or name a beneficiary, or the refund reaches the relayer (section 15, T16).

Gas targets

Targets, measured in test/gas/ and recorded in docs/gas.md: at most 15k gas added to an unflagged swap below N₀; 40k to an unflagged swap at or above N₀, which reads the reference once; and 90k to a flagged swap, with one new slot, one mint and two events. Section 14 has the rest.
Settlement

The Settler takes a record and a signed Pyth update and turns them into a split. It then tells the hook to pay that split out. Anyone can call it, and in practice the keeper does. The Settler holds no funds: deposits stay in the hook as ERC-6909 claims, and the hook re-checks every amount it is told to pay.
Entry points

/// @notice Settle an open record against the first Pyth update at or after its settlement time.
function settle(Record calldata record, bytes[] calldata pythUpdate) external payable returns (Payout memory);

/// @notice Refund an open record in full once its window has passed.
function expire(Record calldata record) external;

Steps

    Authenticate. Require keccak256(abi.encode(record)) == hook.recordHash(poolId, id), which also proves the record is still open.

    Settlement time. In continuous mode, t₀ = timestamp + Δ. In closed-market mode, t₀ = calendar.nextOpen(timestamp) + openDelay. Require block.timestamp ≥ t₀.

    Parse. Call parsePriceFeedUpdatesUnique{value: fee}(pythUpdate, [basePriceId, quotePriceId], t₀, t₀ + maxLag), with fee = getUpdateFee(pythUpdate). Pyth accepts an update only if publishTime ≥ t₀ and prevPublishTime < t₀. The result is therefore the first price at or after t₀, and no caller can choose another.

    Fair price. P* = (p_base · 10^e_base) / (p_quote · 10^e_quote), held as an 18-decimal quote-per-risky price, scaled for token decimals. Confidence c* = conf_base/p_base + conf_quote/p_quote. If c* exceeds maxConfBps, refund in full.

    Markout. From the AMM part of the swap, x_r and x_q are the trader's signed receipts of the risky and quote tokens.

    Regime. Closure records use α_c and ε_c (section 6). Otherwise the licence rules of section 7 decide: 0 on the holder's slow path, α_lic for anyone else inside the band, and α outside the band or when no licence was live.

    Split and pay. The Settler calls hook.finalize(record, payout, false). Inside one unlock the hook burns the record's claims, takes the refund to the beneficiary and the tip to the caller, and keeps the LP share as claims for vesting. It moves any rebate's claims to the ledger and credits the recipient. If the refund transfer fails, the hook credits the refund in the ledger in the beneficiary's name instead. Finally it deletes the record hash and emits Settled.

In-the-money accounting. When itmAccounting is on and the post-swap price overshoots P*, only the part of the swap executed before the price crossed P* counts. That part runs from sqrtPriceBefore to √P* at liquidityBefore, computed with SqrtPriceMath, and gives m⁺ and N⁺. Otherwise m⁺ = m and N⁺ = N. This removes the padding incentive (section 15). A swap that crossed initialized ticks makes the constant-liquidity step an approximation, and differential tests compare it with an exact off-chain replay.

Splitting R. tip = min(tipCap, tipBps · R) goes to the caller. Of the remainder, protocolShareBps is credited in the ledger to the pool's protocol recipient (section 9), ρ of what is left goes to the rebate pool, and the rest goes to LPs through vesting. A benign record (R = 0 and m ≤ 0) instead earns a rebate of min(κ · f · N, rebate pool), and its tip comes out of that rebate (section 8).

Closed-market jump guard. If |P*/p_exec − 1| exceeds jumpRefundBps, the record refunds in full. A jump that large is treated as a corporate action or halt, not as information.
Expiry

After t₀ + W (or windowClosed for closure records), anyone may call expire. It refunds in full and pays no tip and no rebate. A missed settlement therefore costs LPs that record's clawback and never costs a trader the deposit.
Vesting donations

Retained value and rent wait in a vesting buffer. Each call to drip(PoolKey) donates vest × min(1, elapsed / vestPeriod) of it to in-range LPs, so new money spreads over roughly one vesting period, and a JIT position must stay in range about that long to share in it. Settlement, expiry and rent crediting all drip, and anyone else may call it. donate reverts when in-range liquidity is zero, so drip skips that pool and the amount waits.
Units and rounding

    Markout math runs in signed quote units with 18-decimal prices, using FullMath.mulDiv.

    R, the tip and the rebate round down, and the refund is D − R, so refund + R = D exactly. When D is held in the risky token, R converts at P* and rounds down.

    The hook re-checks in finalize that refund + R = D, that tip + toProtocol + toRebatePool + toLPs = R, and, for a benign record, that tip + rebate does not exceed the rebate pool. It reverts otherwise.

Failure handling

Case
	

Result

Update missing, or not the first after t₀
	

parsePriceFeedUpdatesUnique reverts; the keeper fetches the right update and retries

No usable update before the window ends
	

expire refunds in full

Confidence above maxConfBps
	

Refund in full

Zero in-range liquidity
	

The LP share waits in vesting

Record already closed
	

Revert Touchstone__RecordClosed

Refund transfer fails (blocklisted or reverting recipient)
	

Credited in the ledger in the beneficiary's name, with a RefundDeferred event
Closed-market mode

Tokenized-stock pools trade around the clock, but the stock's home market does not. While it is closed, the pool quotes a price that the reopen will correct, and an informed trader can trade against LPs at that price. Closed-market mode flags every swap at or above N₀ while the market is closed, and settles it against the first regular-session price after the reopen. Crypto pools set no calendar and never enter this mode.
Market calendar

interface IMarketCalendar {
    /// @notice True while the regular session is open at time t.
    function isOpen(uint256 t) external view returns (bool);

    /// @notice Opening time of the first regular session that starts after t.
    function nextOpen(uint256 t) external view returns (uint256);

    /// @notice Last timestamp the calendar's holiday data covers.
    function validUntil() external view returns (uint256);
}

NyseCalendar implements the regular session, 09:30 to 16:00 New York time on weekdays. It computes daylight saving time from the US rule in force since 2007 (second Sunday in March to first Sunday in November). Holidays and 13:00 early closes are passed to the constructor for the years NYSE has published, and the contract has no owner. isOpen and nextOpen are date arithmetic plus a binary search over that list.

When a pool is registered, the factory copies validUntil() into its config. After that date the pool takes no deposits at all. LPs lose protection, but no trader ever posts a deposit that cannot be settled. The date is visible from the start, and LPs should move to a pool with a newer calendar before it.
Choosing the mode at swap time

A swap at time t on a calendar pool becomes a closure record if either of these holds:

    isOpen(t) is false.

    isOpen(t + Δ + maxLag) is false, so continuous settlement would fall after the close.

The second rule sends swaps made in the last seconds of a session to the reopen, instead of leaving them with no usable price.


	

Continuous record
	

Closure record

Flagged when
	

Any trigger in section 4
	

Every swap at or above N₀; below N₀, the flow trigger

Deposit
	

N · min(δ_max, max(δ, β·g⁺))
	

N · δ_c

Licence exemption
	

Applies
	

Never applies

Settlement time t₀
	

t + Δ
	

nextOpen(t) + openDelay

Latest usable update
	

t₀ + maxLag
	

t₀ + maxLagClosed

Regime
	

α and ε, or α_lic inside the band
	

α_c and ε_c

Expiry
	

t₀ + W
	

t₀ + W_c

The drift trigger plays no part in closure records, because a stock's Chainlink reference is as stale as the pool while the market is closed.
Settling at the reopen

The Settler follows the steps in section 5 with t₀ = nextOpen(t) + openDelay. Pyth's uniqueness rule then selects the first regular-session update after the reopen. If the open is delayed, or the stock is halted at the open, no update arrives before t₀ + maxLagClosed, and the record expires at t₀ + W_c with a full refund. An unscheduled closure, which the calendar cannot know about, ends the same way.

Expiry counts from t₀, not from the swap, so W_c never has to cover the closure itself. A Friday-evening record expires 24 hours after Monday's reopen, not 24 hours after Friday.
Corporate actions

A split, a reverse split or a special dividend can move the reference price far from what the token is worth. Two rules contain this.

    Jump guard. If |P*/p_exec − 1| exceeds jumpRefundBps (J, default 25%), the record refunds in full. A move that large is treated as a corporate action, a halt or a data error, not as information. The cost is that a genuine gap of more than 25% pays LPs nothing.

    Fixed share ratio. v2.0 supports only tokens that track one share at a fixed ratio. Tokens that fold dividends into the price, or change their ratio, need an on-chain ratio source, which is out of scope.

The noise tax

The clawback is one-sided: it keeps part of a positive markout and pays nothing back when the markout is negative. Over three seconds this hardly matters, because the fee is larger than the price noise. Over a weekend it matters a great deal. An uninformed trader's markout is then mostly noise, and the clawback keeps part of the upside.

For a benign trader whose markout has noise σ_c over the closure, the expected clawback is approximately

where φ and Φ are the standard normal density and distribution. My calculation, under that normal approximation:

Case
	

z
	

Expected clawback on a benign trade

Weekend, σ_c = 1.5%, f = 5 bps, ε_c = 50 bps, α_c = 0.5
	

0.37
	

about 18 bps of notional

Weekend, continuous values (ε = 2 bps, α = 0.8)
	

0.05
	

about 45 bps

Continuous, Δ = 3 s at 3% daily volatility (noise about 1.8 bps)
	

4.0
	

effectively zero

Continuous, Δ = 3 s at 5.2% daily volatility
	

2.3
	

about 0.01 bps

That is why closure records get their own α_c and ε_c, set lower and wider than the continuous values. The tax works like the wider spread a market maker quotes overnight. E9 measures both the information in closure-time markouts and the tax on benign closure trades. If the tax exceeds what the clawback recovers from informed trades, closed-market mode is dropped (section 13).

Deposits are also larger and held longer. At δ_c = 300 bps, a $10,000 Saturday swap locks $300 until Monday's settlement. previewDeposit reports this before the trade (section 9).
Extended-hours prices

US equities also trade before the open, after the close, and overnight on weeknights. v2.0 settles only against the regular session. An extended-hours feed would shorten the wait but rest on thinner prices, so it is left for a later version and would need its own E9 run.
Arbitrage licence

LicenceAuction leases one arbitrageur an exemption from the clawback on a pool, for rent paid to that pool's LPs by the second. Exclusivity is enforced at settlement, not by ordering. An outsider can still trade first, but inside the price band it keeps only 1 − α_lic of its markout above the margin, so its win mostly pays LPs. That is why the licence works on first-come-first-served chains such as Arbitrum and Robinhood Chain, where an MEV tax has no priority fee to tax.

The licence is per pool and optional, switched on by the LICENCE flag in PoolConfig. While no lease is live, the pool runs the plain clawback of sections 4 and 5.
What the plain clawback misses

    The margin. Arbitrageurs keep ε·N on every swap, and ε must equal their cost, which LPs can only estimate.

    The cap. R never exceeds D, so markout beyond δ_max·N is lost.

    Overhead. Every flagged arbitrage pays for a record, a settlement and a keeper tip.

    Calibration. A wrong ε either stalls arbitrage or invites padding (section 15).

An auction prices the arbitrage directly, so LPs need no estimate of anyone's cost.
What the holder gets

    Its first swap at or above N₀ in each block posts no deposit, while the pool sits inside the band.

    Nothing else. It does not set the fee, collect fees or get priority. LPs keep every swap fee, unlike the am-AMM, where the manager sets and keeps the fee.

Rules at swap time

In afterSwap, for a continuous-mode swap with N ≥ N₀ on a licence pool:

(swapper, live) = LICENCE.holderOf(id)
byHolder = live and resolveSwapper(sender) == swapper and lastTouchBlock < BlockLib.number()
if byHolder and reference fresh and |g| <= G:          // fast path, no record
    lastTouchBlock = BlockLib.number()                  // uses up the block's first touch
    emit LicensedSwap(id, swapper, amount0, amount1)
    return (selector, 0)
otherwise: normal triggers; the record stores licenceActive = live and byHolder

resolveSwapper returns IMsgSender(sender).msgSender() for a trusted router and sender otherwise. It never reads hookData or tx.origin. Every swap that misses the fast path is treated like anyone else's, including the holder's second swap in the same block.
Rules at settlement

The band test is |p_pre − P*| ≤ G · P*, using the record's pre-swap price.

Licence live at swap time
	

Band test
	

byHolder
	

α used

No
	

Not used
	

Not used
	

α

Yes
	

Inside
	

Yes
	

0, full refund

Yes
	

Inside
	

No
	

α_lic

Yes
	

Outside
	

Either
	

α

The second row is the holder's slow path: its swap missed the fast path because the reference was stale or showed a gap above G, but P* shows it was inside the band.
Why only the first touch

A sandwich needs a back-run in the same block, after the victim. A back-run is never the block's first touch, so it is never byHolder, and inside the band it settles at α_lic. A colluding pair fails the same way: if an outsider front-runs at or above N₀, the front-run takes the first touch, and the holder's back-run gets a deposit. Legs below N₀ post no deposit for anyone, so the holder gains nothing there that others lack, and the flow trigger bounds them for everyone.

On Arbitrum and its Orbit chains, block.number returns an approximate parent-chain block number, not the L2 block. BlockLib therefore reads ArbSys(100).arbBlockNumber() there and block.number elsewhere. The choice is a constructor immutable set by the deploy script, not a chain-ID check.
Why the band

The band does two jobs.

    Freshness backstop. An idle holder can let the pool drift by about G at most before outsiders are paid at the normal α to realign it. Freshness never depends on trusting the holder.

    Tail protection. Jumps beyond G go back to the clawback for everyone, the holder included. A lone bidder at the reserve cannot buy the largest arbitrages cheaply, and every bidder prices a smoother asset.

The fast path tests the band against the Chainlink reference, which can lag. If the reference shows the pool inside the band when P* would not, the holder escapes the clawback on that swap, and the leak is bounded by the reference's deviation threshold. In the opposite case the holder posts a deposit and gets all of it back.
The lease

The mechanics follow the am-AMM of Adams, Moallemi, Reynolds and Robinson (arXiv 2403.03367). Bunni's BidDog library implements the am-AMM, but AmAmm.sol is AGPL-3.0, so Touchstone reimplements the lease from the paper and this spec and copies no code. It differs in three ways: time is measured in seconds, not blocks; rent is paid in the pool's quote token and donated to LPs, where BidDog burns LP shares; and bids carry no fee payload.

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

    Bid. bid(id, swapper, rent, deposit) requires rent ≥ minRent, rent ≥ max(top.rent, next.rent) · (1 + minIncrementBps / 10⁴) rounded up, and deposit ≥ rent · K. It pulls the deposit, credits the displaced next bid's deposit to that owner's refunds, and stores the new bid as next with since = now.

    Activation. At next.since + K the next bid becomes top. The old top pays rent up to that instant, and its remaining deposit goes to refunds.

    Rent. The top pays rent × elapsed seconds out of its deposit.

    Lapse. If the deposit runs out, the lease ends at since + deposit / rent. The pool reverts to the plain clawback until a pending bid activates at its own time.

    Accrual. accrue(id) applies every transition up to now and sends the rent charged since the last call to the hook. Anyone may call it, and bid, topUp and withdraw call it first.

    Deposits. An owner may top up at any time and withdraw while the remaining deposit covers at least K seconds of rent. Displaced deposits are claimed with claimRefund.

    Swapper. The owner may change the exempt address with setSwapper, effective at once.

holderOf(id) is a view that applies the same transitions in memory, so the swap path never writes auction state.

State
	

Bid placed
	

K seconds after the pending bid
	

Deposit runs out

No holder, no bid
	

Pending bid
	

—
	

—

No holder, pending bid
	

A higher bid replaces it
	

Bid becomes holder
	

—

Holder, no bid
	

Pending bid
	

—
	

No holder

Holder, pending bid
	

A higher bid replaces it
	

Bid becomes holder; old holder refunded
	

Pending bid waits for its own activation

The delay K does three jobs. A bidder cannot take the licence just for a scheduled event, such as a CPI release, an earnings call or the reopen. The holder always gets K seconds of notice. And a holder that stops topping up still owes rent until the deposit runs out.
Where rent goes

accrue transfers the rent to the hook and calls creditRent(key, amount). The hook settles the tokens into ERC-6909 claims, credits the protocol share in the ledger, sends ρ of the rest to the rebate pool and vests what remains to in-range LPs through drip. Rent also accrues while a stock's market is closed, when the licence does not apply, and bidders price that in. Licence pools need an ERC-20 quote token.
When LPs come out ahead

    Two or more bidders. Competition pushes rent toward the inside-band arbitrage the winner expects, net of its costs. That rent replaces the clawback LPs would have collected and adds the leaks listed above. Outsiders who beat the holder still pay α_lic of their excess.

    One bidder. Rent sinks to the reserve. Jumps beyond G still go to the clawback, but inside-band arbitrage may be worth more than the reserve, and LPs would then collect less than the plain clawback pays.

E10 compares LP income under one and two bidders with the plain clawback. A pool enables the licence only if the one-bidder case at its reserve does no worse.
Defaults

K = 3,600 s on mainnets (60 s on testnet demos), a 10% minimum increment (the am-AMM default in BidDog), α_lic = 0.95, G = 25 bps, and a per-pool reserve set from E10. Section 11 gives the bounds.
Gas

Target: the licence check adds at most 18k gas to a swap at or above N₀ on a licence pool: one external call and up to six cold reads. The fast path writes one slot and emits one event, so an exempt swap costs less than a flagged one.
Prior art

MEV taxes need priority ordering. Arbitrum's Timeboost sells ordering for the whole chain, and the revenue goes to the chain, not to LPs. McAMM-style designs sell the first swap of each block, which depends on the winner landing first, and LodeHook charges the first swap of each block a premium. The am-AMM sells fee-setting and fee-free trading. As far as my search found, none of these enforces exclusivity by ex-post markout settlement against an outside price.
Benign-flow rebates

Every settlement already measures whether a flagged trade hurt LPs. Rebates turn that measurement into an order-flow payment. A flagged trade that settles benign earns a rebate, paid to whoever the transaction names, usually the router or wallet that built it. No attestation, reputation or allowlist is involved, because the markout is the proof. Uniswap's ALF design gives better prices to flow that a frontend attests, and lists producing those attestations as open work. Touchstone's rebates need no attester.
Funding

The rebate pool receives ρ (rhoBps, default 10%) of everything LPs retain: the clawback after the keeper tip, and licence rent. It is held per pool and per currency, in rebatePool0 and rebatePool1. A pool created with ρ = 0 has no rebates.
Eligibility and amount

A record earns a rebate when it is settled, not expired, with R = 0 and m ≤ 0, so the trader lost to the pool after the fee.

Here c is the record's deposit currency, f is the pool's LP fee, and κ is kappaBps (default 40%). When c is the risky token, κ·f·N converts at P*. The tip pays whoever settles the record, so benign records are worth settling even though they retain nothing. Rebates are paid first come, first served, and a record settled after the pool runs dry gets a partial rebate or none.
Recipient and hookData

hookData length
	

Layout
	

Effect

0
	

Empty
	

Default beneficiary (section 4); rebate to the beneficiary

32
	

abi.encode(address beneficiary)
	

Beneficiary as given, unless the sender is a trusted router; rebate to the beneficiary

64
	

abi.encode(address beneficiary, address rebateTo)
	

As above, with the rebate to rebateTo; a zero beneficiary falls back to the default

Any other
	

—
	

Revert MalformedHookData (the URC-4 error)

Both addresses are untrusted and used for nothing else. The trader signs the transaction, so a router that names itself as rebateTo does so with the trader's consent, as with an interface fee.
Payment through the RebateLedger

Rebates are credited, not pushed. At settlement the hook transfers ERC-6909 claims to RebateLedger and calls credit(recipient, currency, amount). ERC-6909 transfers need no unlock, so crediting is cheap.

    claim(currency, to): the recipient withdraws the underlying token. The ledger unlocks the PoolManager, burns its claims and takes the token to to.

    claimAsClaims(currency, to): the recipient receives the ERC-6909 claims instead.

    push(recipient, currency): anyone sends a recipient's balance to that recipient, which lets a keeper pay many routers in one batch.

The ledger also holds refunds that could not be pushed at settlement, such as a USDC refund to a blocklisted address or a native-ETH refund to a contract that reverts. The beneficiary claims them later to an address it controls, so a bad recipient can never block a settlement. The ledger checks after every credit that its claim balance covers everything it owes.
Why wash trading loses

A wash leg pays the full fee f·N to LPs and gets back at most κ·f·N, so each leg loses (1 − κ)·f·N plus price impact and gas. That holds for any κ below 1.

The exception is an LP washing against its own liquidity. An LP that owns a share φ of in-range liquidity gets φ of the fee back, so a wash leg pays it if φ > 1 − κ (60% at the default), before impact and gas. The most it can take is the rebate pool, which costs the other LPs at most their share of ρ of retained income. E11 measures in-range concentration on target pools; where one address holds more than 1 − κ, the pool is created with a lower κ.

Splitting an arbitrage to farm rebates fails too. The benign piece loses more than its rebate, and the toxic piece is clawed back as usual.
What a backtest cannot show

A backtest holds flow fixed. It can price the rebates and bound the gaming, but it cannot show whether rebates attract flow. That needs a live pool and a router partner, which belongs to the adoption phase.
Events

RebateCredited(id, recordId, recipient, currency, amount) on every credit. The hook also emits HookBonus(id, amount0, amount1) from the Uniswap Foundation's 2025 hook data guide, for indexers that follow it.
Quote integrity

A deposit depends on block state: whether the swap is the block's first touch, how full the flow bucket is, and where the reference sits. A quote fetched in one block can therefore differ from the execution in the next, and routers see that gap as slippage. They also count a deposit as a loss, although it is refundable. Hooks in general have a trust problem here as well: 0x reported flagging 54.2% of 84,163 hooks as malicious for quoting one price and settling another (reported by CryptoSlate). Touchstone answers with four pieces.

Piece
	

What it gives a router

previewDeposit
	

The deposit a swap would post now, and the deposit if flagged

URC-4 functions
	

A deposit-aware quote in one static call

URC-2 HookSwap
	

An event for every swap that posts a deposit

GuardedRouter
	

An in-transaction check of the deposit actually taken

The swap path and every quote function call the same internal function, _depositFor, so within one block a quote and an execution cannot disagree.
previewDeposit

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

depositNow is exact for the current block. It turns wrong only if another swap lands first in the same block, or if the swap lands in a later block where the first touch is fresh. A router that cannot control which block it lands in should plan with depositIfFlagged, which ignores the trigger state.
URC-4 quotes

URC-4 (Active Liquidity Framework Hook Interface, in Discussion since 11 June 2026) defines IALFHook, a router-facing quoting interface. Touchstone implements it as thin forwarders from the hook to an immutable TouchstoneLens, which keeps the hook under the 24 KB size limit.

Function
	

Touchstone's answer

getIndicativeQuote(key, zeroForOne, amountSpecified, hookData)
	

Exact input: expected output minus the deposit the swap would post now. Exact output: expected input plus that deposit. 0 when it cannot price.

swapToPrice(key, zeroForOne, amountSpecified, sqrtPriceLimitX96, hookData)
	

The same, stopping at the price limit

isLive()
	

true. Execution never waits on an oracle; only settlement does, and settlement delays never change what a swap pays at the time

maxGas()
	

The measured worst case of getIndicativeQuote, recorded in docs/gas.md (target: 300k)

The AMM part comes from StaticQuoteLib, a view-only port of v4-core's swap loop. It reads ticks and bitmaps through StateLibrary, applies the protocol fee the way Pool.swap does, and returns 0 when a quote would cross more than maxQuoteTicks initialized ticks, as URC-4 asks of a hook that cannot price. It is tested against V4Quoter on forks (E12). Malformed hookData reverts with URC-4's MalformedHookData, and the hook answers ERC-165 for type(IALFHook).interfaceId.

In July 2026 a URC-4 co-author agreed to drop the view requirement in favour of quoting through eth_call. Touchstone's functions are views, which work either way. The repository pins the draft text it implements.
URC-2 HookSwap

URC-2 (Custom Accounting Hook Swap Event, in Discussion) says a hook must emit exactly one HookSwap for each successful swap in which it contributes a token delta, fee-only hooks included.

event HookSwap(PoolId indexed id, address indexed sender, int128 amount0, int128 amount1, uint24 swapFee);

    Emitted from afterSwap for every swap that posts a deposit, and for no other swap.

    The deposit is −D on the unspecified currency and 0 on the other. URC-2 signs amounts from the swapper's side, and the swapper pays the deposit whether the swap is exact input or exact output.

    swapFee is 0, because a refundable deposit has no single pips rate.

    Indexers add HookSwap to the core Swap to get what the swapper paid at the time. The refund arrives later, in Settled or Expired.

GuardedRouter

struct Guard {
    uint256 maxDeposit;   // most the trader lets the hook hold, in the deposit currency
    uint256 minNetOut;    // exact input: least received now; exact output: unused
    uint256 minGrossOut;  // exact input: least of received now plus the deposit
    uint256 maxNetIn;     // exact output: most paid now, deposit included
}

function swapGuarded(PoolKey calldata key, SwapParams calldata params, Guard calldata guard,
    address rebateTo, uint256 deadline) external payable returns (BalanceDelta delta, uint256 deposit);

    Unlock the PoolManager and swap with hookData = abi.encode(msg.sender, rebateTo).

    Read hook.lastDeposit(poolId). The hook writes it to transient storage in afterSwap and clears it in beforeSwap, so a view call in the same transaction sees exactly this swap's deposit.

    Require deposit ≤ maxDeposit, plus the limit that applies: minNetOut and minGrossOut for exact input, maxNetIn for exact output. Otherwise revert Touchstone__GuardFailed.

    Settle the input and take the output to the trader.

The gross limit lets a trader accept a lower immediate output, because the deposit comes back, while capping how much the hook may hold. GuardedRouter implements IMsgSender and returns the trader for the length of the lock. It is one of the hook's trusted routers, so refunds name the trader even without hookData. v2.0 guards single-pool swaps only.

Universal Router users still get refunds, through the Dispatcher's msgSender, and V4Quoter simulations include the deposit for the current block. They get no in-transaction deposit check beyond their own minimum output.
Allowlist requirements

Uniswap's routing allowlist rejects upgradeable proxies, hooks that need custom calldata, and hooks that modify or bypass the protocol fee. Touchstone is immutable and verified, and its hookData is optional. Donations skip the v4 protocol fee, so each pool can route protocolShareBps of retained value and rent to protocolRecipient, credited in the ledger for that address to claim. That reading of the rule is mine; the team confirms it with the allowlist maintainers before the guarded launch. Because the recipient is fixed per pool, a change of recipient by governance applies to pools created afterwards.
Interfaces and events

This is the complete external surface of v2.0. Every external and public member carries full NatSpec in the code; the comments here are short. Types come from v4-core (PoolKey, PoolId, Currency, BalanceDelta, SwapParams). PoolState is in section 4, Lease in section 7, DepositQuote and Guard in section 9, and IMarketCalendar in section 6.
Types

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
    uint128 maxOutstanding;    // quote units; no new deposits above it (section 15)
    address protocolRecipient; // fee recipient for the protocol share (section 9)
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

The hook rejects a payout unless, in the deposit currency, refund + tip + toProtocol + toRebatePool + toLPs = deposit and rebate = 0 (not benign), or refund = deposit, toProtocol = toRebatePool = toLPs = 0 and tip + rebate ≤ the rebate pool (benign). An expiry is a non-benign payout with refund = deposit.
TouchstoneHook

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

The hook also implements IUnlockCallback for its own unlocks (finalize, rent and drip), accepting calls from the PoolManager only, and ERC-165.
URC-4

Copied from the draft's reference implementation, which extends IERC165; the spec's own block does not. The two errors keep URC-4's names, the only exception to the Touchstone__ prefix rule.

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

Settler

interface ISettler {
    /// @notice Settle against the first Pyth update at or after t0. Excess msg.value is returned.
    function settle(Record calldata record, bytes[] calldata pythUpdate) external payable returns (Payout memory);

    /// @notice Refund in full once t0 + W (or W_c) has passed. Pays no tip.
    function expire(Record calldata record) external;

    function settleTime(Record calldata record) external view returns (uint256 t0, uint256 latest, uint256 expiresAt);
}

Keepers price a settlement by eth_call to settle before sending it.
LicenceAuction

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

RebateLedger

interface IRebateLedger {
    enum Kind { REBATE, DEFERRED_REFUND, PROTOCOL }

    function credit(address recipient, Currency currency, uint256 amount, Kind kind) external; // hook only
    function owed(address recipient, Currency currency) external view returns (uint256);
    function claim(Currency currency, address to) external returns (uint256 amount);          // underlying
    function claimAsClaims(Currency currency, address to) external returns (uint256 amount);  // ERC-6909
    function push(address recipient, Currency currency) external returns (uint256 amount);
}

Factory and router

interface ITouchstoneFactory {
    /// @notice Validate bounds (section 11), register with the hook and the auction, then initialize.
    function createPool(PoolKey calldata key, PoolConfig calldata cfg,
        ILicenceAuction.LeaseParams calldata lease, uint160 sqrtPriceX96) external returns (PoolId id);
}

interface IGuardedRouter is IMsgSender {
    function swapGuarded(PoolKey calldata key, SwapParams calldata params, Guard calldata guard,
        address rebateTo, uint256 deadline) external payable returns (BalanceDelta delta, uint256 deposit);
}

createPool requires key.hooks to be the hook and a static fee, reads token decimals (18 for native ETH), and copies the calendar's validUntil.
Errors

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
}

Events

interface ITouchstoneEvents {
    // hook
    event PoolRegistered(PoolId indexed id, PoolConfig cfg);
    event DepositTaken(PoolId indexed id, uint64 indexed recordId, Record record);
    event LicensedSwap(PoolId indexed id, address indexed swapper, int128 amount0, int128 amount1);
    event Settled(PoolId indexed id, uint64 indexed recordId, int256 markout, uint256 fairPriceX18,
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

DepositTaken carries the whole record, so a keeper never needs storage reads to settle. Settled carries the markout, the fair price and the α used, so anyone can recompute the split from events alone.
Parameters

Every value below is fixed per pool when the factory creates it, and no one can change it afterwards. Defaults are starting points for a USDC-quoted ETH pool with a 5 bp fee; dollar amounts are written in quote-token units in the config. Each chain's values live in script/config/<chain>.json, never in contract code. The research pipeline sets each one on development windows only (section 13), and held-out results never retune them.
Triggers and deposits

Field
	

Symbol
	

Default
	

Factory bounds
	

Set by

n0
	

N₀
	

$5,000
	

0 < N₀ ≤ N_min
	

E1

nMin
	

N_min
	

$100,000
	

N_min ≥ N₀
	

E1, E5

flowHorizon
	

h
	

12 s
	

1 s to 3,600 s
	

E5

tauBps
	

τ
	

5 bps
	

1 to 100 bps
	

E1

reference
	

—
	

Chainlink Standard proxy
	

Zero turns the drift trigger off
	

Deploy config

referenceMaxAge
	

—
	

Feed heartbeat + 10%
	

60 s to 90,000 s
	

Feed docs

deltaBps
	

δ
	

30 bps
	

5 to 500 bps
	

E3

deltaMaxBps
	

δ_max
	

300 bps
	

δ to 2,000 bps
	

E3

betaX100
	

β
	

1.25
	

1.00 to 4.00
	

E3

deltaClosedBps
	

δ_c
	

300 bps
	

δ to 2,000 bps
	

E9

bandBps
	

G
	

25 bps
	

5 to 500 bps
	

E10

maxOutstanding
	

—
	

Small at launch; later pools raise it as evidence builds
	

Non-zero
	

Section 15
Settlement

Field
	

Symbol
	

Default
	

Factory bounds
	

Set by

basePriceId, quotePriceId
	

—
	

Pyth IDs for the base and USDC
	

Non-zero
	

Deploy config

settleDelay
	

Δ
	

3 s
	

1 to 60 s
	

E4

maxLag
	

—
	

10 s
	

1 s, and below W
	

E4

window
	

W
	

24 h
	

1 h to 7 days
	

Ops

openDelay
	

—
	

60 s
	

0 to 3,600 s
	

E9

maxLagClosed
	

—
	

1 h
	

60 s, and below W_c
	

E9

windowClosed
	

W_c
	

24 h
	

1 h to 7 days
	

Ops

maxConfBps
	

—
	

25 bps
	

1 to 200 bps
	

E4

alphaBps
	

α
	

0.80
	

0.10 to 0.95
	

E3, E6

epsBps
	

ε
	

2 bps, the measured cost c
	

0 to 50 bps
	

E6

alphaLicensedBps
	

α_lic
	

0.95
	

α to 0.99
	

E10

alphaClosedBps
	

α_c
	

0.50
	

0.10 to α
	

E9

epsClosedBps
	

ε_c
	

50 bps
	

ε to 500 bps
	

E9

jumpRefundBps
	

J
	

25%
	

5% to 90%
	

E9

ITM_ACCOUNTING flag
	

—
	

On
	

—
	

E5, E6
Payouts and rebates

Field
	

Symbol
	

Default
	

Factory bounds
	

Set by

tipBps
	

—
	

2%
	

0 to 20%
	

Keeper economics

tipCap
	

—
	

$5 on L2s, $25 on Ethereum
	

Non-zero
	

Gas at deployment

rhoBps
	

ρ
	

10%
	

0 to 30%
	

E11

kappaBps
	

κ
	

40%
	

0 to 90%
	

E11

vestPeriod
	

—
	

30 min
	

60 s to 24 h
	

E3

protocolShareBps
	

—
	

The protocol's share of the pool's swap fee at creation; 0 where no protocol fee applies
	

0 to 50%
	

Allowlist review

protocolRecipient
	

—
	

The fee recipient Uniswap governance designates on that chain
	

Non-zero when the share is
	

Deploy config
Licence

Field
	

Symbol
	

Default
	

Factory bounds
	

Set by

LICENCE flag
	

—
	

Off until E10 passes
	

Needs an ERC-20 quote token
	

E10

k
	

K
	

3,600 s (60 s on testnet)
	

60 s to 7 days
	

E10

minIncrementBps
	

—
	

10%
	

1% to 50%
	

am-AMM default

minRent
	

—
	

Per pool
	

Non-zero
	

E10
Cross-field rules

The factory reverts with Touchstone__ConfigOutOfBounds(field) unless all of these hold:

    α_c ≤ α ≤ α_lic < 1, so the entry condition of section 5 holds in every regime.

    ε ≤ ε_c, and δ ≤ min(δ_max, δ_c).

    κ < 1, so wash trades lose (section 8).

    maxLag < W and maxLagClosed < W_c.

    On calendar pools, Δ + maxLag is shorter than the shortest session, and calendarValidUntil is at least 30 days away.

    The fee is static, and key.hooks is the hook.

Deploy-time immutables

Contract
	

Immutables

TouchstoneHook
	

POOL_MANAGER, SETTLER, LICENCE, LEDGER, FACTORY, LENS, TRUSTED_ROUTER_0…_3, BLOCK_SOURCE (EVM or ArbSys)

Settler
	

PYTH, HOOK

LicenceAuction
	

HOOK, FACTORY

RebateLedger
	

POOL_MANAGER, HOOK

TouchstoneLens
	

POOL_MANAGER, HOOK, MAX_QUOTE_TICKS (default 64)

GuardedRouter
	

POOL_MANAGER, HOOK

TouchstoneFactory
	

POOL_MANAGER, HOOK, LICENCE

The hook and the contracts around it point at each other, so CREATE2 alone cannot predict both sides. The deploy script predicts the Settler, auction, ledger, lens, factory and router addresses from the deployer's nonces, which do not depend on init code. It then mines the hook's CREATE2 salt with those addresses in the hook's init code, deploys the six contracts with the hook's predicted address, and deploys the hook last (section 16).
Off-chain services

Nothing off-chain is trusted. If the team's keeper stops, anyone can settle, and a record that nobody settles refunds itself at expiry. The services make the system fast and visible, not correct.
Keeper

keeper/, TypeScript and viem. One process per chain.

    Ingest. Watch DepositTaken, and backfill from the indexer on restart. The event carries the whole record.

    Schedule. Read t₀, the latest usable time and the expiry from Settler.settleTime(record), so the keeper never recomputes calendar rules.

    Fetch. Shortly after t₀, ask Hermes's timestamp endpoint for each feed, which returns the first update whose publish time is at or after the given value. Fetch the base and quote feeds separately, since their first updates can sit in different blobs, and check each publish time locally before sending. Hermes needs an API key.

    Price the call. eth_call to settle with getUpdateFee(update) as value returns the payout, and so the tip. Send when the tip covers gas with a margin. The team's keeper also settles unprofitable records that retain value for LPs (settleAtLoss, on by default) and benign ones whose rebate pool is empty.

    Retry, then expire. If Hermes lags, retry until the latest usable time. After that the record can only expire: call expire once its expiry passes. Expiry pays no tip, so this is a service to traders, and it is cheap on L2s.

    Batch. Group settlements through Multicall3's aggregate3Value, which forwards value per call. A lost race costs one reverted call (Touchstone__RecordClosed), not a failed batch.

    Housekeeping. Call LicenceAuction.accrue every few minutes on licence pools, drip about ten times per vestPeriod, and RebateLedger.push for routers that ask.

The keeper key is a dedicated hot key with a small balance, loaded from the environment and never committed.
Indexer

indexer/, TypeScript with SQLite for development and Postgres in production. It reads every Touchstone event plus the PoolManager's Swap, ModifyLiquidity and Donate events for Touchstone pools. Rows are keyed by (chain, transaction hash, log index) and written idempotently, and each chain has a confirmation depth for reorgs.

Derived tables:

    records: open, settled, expired, deferred refund;

    per pool and day: volume, flag share φ, retained R, rent, rebates, tips, settlement lag and expiries;

    LP net estimate: fees plus retained value and rent, minus markout losses at the 15 s horizon used in section 13;

    retail effective fee and freshness, as defined in the report.

Dashboard

dashboard/, Next.js, read-only, with no wallet connection.

Page
	

Shows

Pool
	

LP net next to a static-fee counterfactual, labelled as an estimate

Record explorer
	

Each record's swap, deposit, settlement price, markout, α and split, linked to its transactions

Licence
	

Current holder, rent, pending bid, activation time, rent paid to date

Rebates
	

Credits and claims by recipient

Keeper health
	

Settlement lag distribution, expiries, deferred refunds
Demo bots

On testnets the pool holds test tokens, but Pyth publishes real prices there, so a test ETH/USDC pool can track the real ETH price, and bots can arbitrage it against Hermes. Every bot takes a seed, and every chart they produce is labelled testnet demonstration.

Bot
	

Shows

Retail
	

Swaps below N₀ pay nothing extra; large benign swaps get their deposit back with a rebate

Outsider arbitrageur
	

Part of its deposit stays with LPs

Licence holder
	

Bids, waits K, then arbitrages as the block's first touch with no deposit

Sandwicher
	

Its back-run is clawed back, so the sandwich loses money

Splitter
	

Splitting under N₀ fills the flow bucket and gets flagged

Router
	

Routes benign flow through GuardedRouter, names itself as rebateTo, then claims
Intents path, optional

A UniswapX filler that fills orders through Touchstone pools with GuardedRouter and names itself as rebateTo. It shows that rebates pay intent fillers for benign flow the same way they pay routers. It comes after the core work, runs on a fork of a chain where UniswapX's reactor is deployed (addresses confirmed on day 1), and stays off by default.
Alerts

    95th-percentile settlement lag above Δ + 30 s;

    any expiry of a record that would have retained value;

    any deferred refund;

    keeper balance below a day of gas;

    Hermes errors above 1% of requests;

    a lease lapsing, or a pending bid about to activate.

Research pipeline

The research decides whether Touchstone deserves to exist. Each experiment is pre-registered, has a pass or kill line, and is labelled as a historical backtest, a simulation or a testnet demonstration. The thresholds below are the ones in the report; E10 to E12 are new in v2.
Two replay engines

Engine
	

Location
	

Use

Fast replay
	

research/replay/, Python
	

Markouts, triggers and splits over months of swap logs in minutes; every experiment's first pass

Bytecode replay
	

sim/, Rust and revm, adapted from VANE
	

Runs the compiled hook against historical swap sequences, so gas and accounting come from the contract, not from a model; confirms E3 and E8

E1 to E3 can start on Assay's calibration pipeline, which already pulls swap logs over RPC and Binance 1-second klines as the reference. That makes the first kill decision a matter of days.
Data

Source
	

Used for
	

Constraint

Swap and liquidity logs over RPC, Ethereum, Arbitrum and Base
	

Every backtest
	

Archive access and rate limits

Binance 1-second klines
	

Reference for E1, E2 and E5; the basis comparison in E4
	

Public files; mid-price proxy only

Pyth historical updates, from Hermes's timestamp endpoint
	

Settlement prices in E3, E4 and E9
	

API key; request limits. History after the August 2026 Pythnet sunset is unverified, so E4 falls back to live collection if it is missing

Chainlink AnswerUpdated logs
	

The drift trigger's reference as it stood at each swap
	

Includes each feed's real staleness

Robinhood Chain stock-token pools since 1 July 2026
	

E9
	

About 15 weekends; issuer controls and the HIMS squeeze distort some of them
Metrics

The report defines toxic markout, recall r, flag share φ, LP net (at the 15 s horizon of the Uniswap Labs and Columbia paper, for comparability), retail effective fee, freshness, arbitrage participation and gas. v2 adds four:

    Licence income: rent per day, holder win rate, and outsider clawback, against the plain clawback on the same tape.

    Rebate cost and coverage: rebates owed, the share the pool could fund, and wash-strategy profit.

    Noise tax: expected clawback on benign closure trades.

    Quote gap: how often a quote and its execution differ, and by how much.

Experiments

#
	

Experiment
	

Label
	

Question
	

Pass or kill

E1
	

Markout census
	

Backtest
	

Where does toxic markout sit: by block position, size, signed drift?
	

Descriptive. Sets N₀, N_min, h and τ on development windows only

E2
	

Trigger recall
	

Backtest
	

Does the trigger reach the pool's break-even recall r* = (L − F) / (α(L − (F + ε)s)), about 0.45 at the report's averages?
	

Kill if held-out recall is below break-even at φ ≤ 0.30

E3
	

Settlement replay
	

Backtest
	

LP net, retail fee, refunds against retentions, and how often the cap binds
	

Pass if the cap binds on under 5% of toxic markout and the retail fee stays within 0.1 bp of f

E4
	

Oracle basis
	

Backtest, then live collection
	

How far do Pyth-settled markouts sit from Binance ones at Δ = 2 to 12 s?
	

Kill if the median gap exceeds ε/2

E5
	

Evasion
	

Simulation
	

Recall when arbitrageurs split under N₀ or N_min, spread across blocks, switch to exact output, or pad into the margin
	

Kill if recall under evasion falls below r*

E6
	

Freshness
	

Simulation
	

Do entry and trade size match a plain pool when ε = c, and how much padding appears when ε > c?
	

Kill if mean |pool − P*| rises more than 10% over the static fee

E7
	

Baselines
	

Backtest and simulation
	

Static 5 bp; VolatilePair from its spec; the Assay or SkewHook oracle gap; a Detox-style tax at swap time; Hindsight-style settlement against the pool's own TWAP; a LodeHook-style first-swap premium; perfect clawback as the ceiling
	

Touchstone must beat static on LP net and match it on retail fee and freshness

E8
	

Engineering
	

Testnet and fuzzing
	

Gas and every invariant in section 14, end to end with real Pyth updates
	

Every invariant holds; gas within targets, with 20k as the pass line for an unflagged swap

E9
	

Weekend replay
	

Backtest
	

Do closure-time markouts against the reopen carry information, and what is the noise tax on benign closure trades?
	

Drop closed-market mode if the markouts look like noise, or if the tax exceeds what the clawback recovers

E10
	

Licence
	

Simulation, then testnet
	

LP income under the plain clawback, one bidder at the reserve, and two or more bidders; holder win rate in a first-come-first-served race; freshness with an idle holder
	

Keep the licence off unless two bidders beat the plain clawback by at least 10% and one bidder at the reserve does no worse; kill if an idle holder lets mean |pool − P*| exceed G plus the fee band

E11
	

Rebates
	

Backtest and simulation
	

Rebate cost and coverage at the chosen ρ and κ; profit of pure wash, LP self-wash at measured concentration, and split-arbitrage farming
	

Kill rebates on any pool where a wash strategy profits at its κ

E12
	

Quote integrity
	

Fork test
	

Does depositNow equal the executed deposit in the same block state? Does getIndicativeQuote match V4Quoter? Does depositIfFlagged bound the next block's deposit?
	

Any mismatch in the first two is a bug and blocks release; the bound must hold on at least 99% of sampled swaps
The licence simulation

E10 needs a model of the race, because history cannot show a licence that never existed.

    Drive prices from Binance 1-second tapes, so volatility clusters as it really does.

    After each move, each arbitrageur arrives after a latency drawn from its own distribution, and pays gas plus a hedging cost c. The first arrival trades, as on a first-come-first-served chain.

    The holder keeps its full markout inside the band. Outsiders keep ε·N plus (1 − α_lic) of the excess. Outside the band, everyone faces α.

    Each bidder's value is its simulated profit as holder, less its profit as an outsider. With two or more bidders, rent is set at the second-highest value, which is where a continuous English auction ends up; with one, rent is the reserve.

    Compare LP income with the plain clawback on the same paths, and repeat with the holder switched off to measure the band backstop.

The simulation is labelled as one. Its latency and cost distributions are inputs, so the result is reported as a function of them, not as a single number.
Pre-registration

Every experiment has a file in research/prereg/, committed before it runs. It names the hypothesis, the development and held-out windows, the metrics, the pass or kill line, and the hash of the analysis code. Changing any of them after a run means a new file and a new name, and both results are reported.
Discipline

    Split by time only, and report every window, failures included.

    Confidence intervals come from a block bootstrap over days.

    One parameter set per chain, chosen on development windows and never retuned on held-out data.

    A backtest holds flow fixed. Behaviour responds only in E5, E6, E10 and E11, which are labelled simulations.

    The VolatilePair baseline is our reading of its published spec, not Labs' code path, and is labelled that way.

    Testnet flow says nothing about LP returns. Demos show mechanics only.

Testing

Tests live in test/, split by kind. Mocks live only in test/mocks/ and are named Mock*. A change is done when every suite below passes, coverage holds, and the gas snapshot has not regressed.

Suite
	

Folder
	

Runs
	

What it proves

Unit
	

unit/
	

Every push
	

Each function in both swap directions, exact input and exact output, native and ERC-20, quote as currency0 and currency1, token decimals 6, 8 and 18

Invariant
	

invariant/
	

Every push: 256 runs × 500 calls. Nightly: 10,000 × 1,000
	

The properties below, under random sequences of swaps, liquidity changes, bids, settlements, expiries, drips and claims

Fuzz
	

fuzz/
	

Every push
	

Math and edge cases against reference implementations

Differential
	

differential/
	

Every push
	

The contract against independent implementations

Fork
	

fork/
	

Nightly and before release
	

Real deployments on Arbitrum Sepolia and Base Sepolia, with recorded Hermes updates as fixtures so runs are reproducible offline

Gas
	

gas/
	

Every push
	

Snapshots per path; CI fails on a regression above 5%
Invariants

#
	

Property

I1
	

For each currency, the hook's ERC-6909 balance equals outstanding + vest + rebate pool

I2
	

The ledger's ERC-6909 balance covers everything it owes, per currency

I3
	

For every settled record: refund + R = D, R ≤ D, and tip + toProtocol + toRebatePool + toLPs = R

I4
	

R ≤ α_regime · max(0, m⁺ − ε_eff·N⁺), recomputed independently by the test

I5
	

Each record settles or expires exactly once, and its hash is deleted afterwards

I6
	

An expired record refunds D and pays no tip and no rebate

I7
	

A rebate is paid only when R = 0 and m ≤ 0, never exceeds κ·f·N, and total rebates never exceed total inflows to the rebate pool

I8
	

A swap with no record leaves the swapper's delta identical to a hookless twin pool's

I9
	

The hook never makes a liquidity change revert

I10
	

No swap reverts because of the reference, the calendar or the licence; a failed read means no deposit or no exemption

I11
	

At most one exempt swap per pool per block, and it is the holder's first touch

I12
	

Auction balance = Σ top deposits + Σ next deposits + Σ refunds, and rent charged = rent credited to the hook

I13
	

Rent charged never exceeds rent × seconds active

I14
	

Donations never exceed vested amounts, and total donated = Σ toLPs + the vested share of rent

I15
	

A refund reaches its beneficiary or the ledger in the beneficiary's name, and no one else

I16
	

No external entry point can be re-entered during finalize, creditRent or drip (transient lock)

I17
	

Outside creditRent, the hook holds no ERC-20 balance

A failed reference or licence read is caught with try/catch and treated as stale or not live. A failed calendar read means no deposit, so a trader is never charged a deposit that cannot settle.
Fuzz and differential targets

Target
	

Reference

MarkoutLib: markout, fair-price conversion over Pyth exponents and token decimals
	

A Python implementation with exact rational arithmetic, called through FFI

In-the-money split
	

An exact tick-by-tick replay in the research package

StaticQuoteLib
	

V4Quoter on forks, within one wei for swaps under MAX_QUOTE_TICKS (E12)

NyseCalendar
	

The exchange_calendars Python package's XNYS calendar, minute by minute across the covered years, including daylight-saving switches, holidays and early closes

Settler payouts
	

The research replay's split, on the same records, so the contract and the backtest cannot drift apart

Triggers
	

Block boundaries, bucket draining, first touch across transactions, ArbSys block numbers

Lease state machine
	

A Python model of section 7's table, step by step
Adversarial tests

Each attack in section 15 has a proof-of-concept test that must fail to profit: sandwiches with and without a licence, the colluding pair, splitting under N₀, padding past P*, JIT liquidity around drip, wash trading for rebates, LP self-wash, griefing bids, and settlement with a stale or chosen Pyth update. Tokens with transfer callbacks are covered by the reentrancy tests. Fee-on-transfer tokens are unsupported, and the README says so.
Static analysis and coverage

slither runs on every push, and every finding is fixed or triaged in docs/decisions/. forge coverage must stay at or above 95% of lines and branches in src/. Mutation testing with a Solidity mutator is optional before the external audit.
Gas targets

Path
	

Target added gas

Unflagged swap below N₀
	

15k

Unflagged swap at or above N₀ (one reference read)
	

40k

Flagged swap (reference read, record, mint, events)
	

90k

Licence check on a licence pool
	

18k on top

settle
	

250k

expire, drip, accrue, bid
	

Measured and recorded

All figures are targets until test/gas/ measures them, and docs/gas.md records each measurement.
Security

Touchstone has no owner, no pause and no upgrade path. A bug cannot be patched in place; the only remedy is a new deployment and a migration. Security therefore rests on four things: a small trusted surface, conservation checks inside the hook, adversarial tests for every attack below, and a guarded launch behind an external audit.
Trust assumptions

Dependency
	

Trusted for
	

If it fails

Pyth
	

The settlement price P*
	

R is wrong for the affected records, but never above D. The confidence cap and the jump guard refund the worst cases

Chainlink
	

The drift trigger and the licence fast path only, never an amount
	

The wrong swaps post deposits, or a holder escapes one clawback, bounded by the feed's deviation threshold

Keepers
	

Liveness only
	

Records expire and refund in full; LPs lose that clawback

Market calendar
	

Session times and holidays
	

A wrong open finds no price and refunds; past validUntil the pool takes no deposits

Trusted routers
	

msgSender() for refunds and the licence
	

Only the immutable list is believed; any other contract's msgSender() is ignored
Threats

#
	

Attack
	

Mitigation
	

What is left

T1
	

A keeper picks a favourable Pyth update
	

parsePriceFeedUpdatesUnique accepts only the first update at or after t₀
	

None

T2
	

Pyth withheld or late
	

Expiry refunds in full
	

Lost clawback; E4 monitors it

T3
	

Padding past the fair price
	

In-the-money accounting; ε set at the measured cost
	

Approximation across initialized ticks

T4
	

Splitting under N₀ or N_min, or across blocks
	

The flow bucket applies to every swap and drains over h
	

At most about N_min / h of unflagged flow per second, per direction

T5
	

Switching to exact output
	

Triggers and deposits do not depend on the swap type
	

None

T6
	

Outsider sandwich
	

The back-run sells into a price raised above the reference, so the drift trigger flags it and the clawback takes the gain
	

A stale reference can miss it

T7
	

Holder sandwich, or an outsider and the holder colluding
	

Exemption covers only the block's first touch; a front-run at or above N₀ takes it
	

Legs below N₀, the same for everyone

T8
	

JIT liquidity captures donations
	

drip releases vested amounts gradually, so a JIT position must stay in range for the vesting period
	

Small; tested

T9
	

Blocklisted or reverting refund recipient
	

Failed pushes become ledger credits
	

None

T10
	

Reentrancy through token callbacks
	

Transient locks on finalize, creditRent and drip; checks before effects before interactions
	

None

T11
	

Forged or replayed records
	

Hash commitment written only by the hook; deleted on settlement
	

None

T12
	

Griefing bid: high rent, small deposit
	

The griefer pays K seconds of rent to LPs
	

A short gap until the next activation

T13
	

Idle holder keeps the pool stale, for example to move an external oracle that reads it
	

Outside the band, outsiders realign at α
	

Staleness up to about G

T14
	

A lone bidder buys the licence at the reserve
	

Tail protection by the band; reserve from E10; licence off by default
	

Inside-band value above the reserve

T15
	

Wash trading or LP self-wash for rebates
	

κ < 1; κ lowered on concentrated pools; budget capped by ρ
	

Other LPs' share of ρ of retained income

T16
	

Refunds sent to tx.origin on relayed or ERC-4337 transactions
	

Trusted routers and GuardedRouter always name the trader
	

An untrusted router with no hookData refunds the relayer; documented for wallets

T17
	

Malformed hookData
	

Revert MalformedHookData
	

None

T18
	

Mis-scaled prices from token decimals or Pyth exponents
	

One conversion library, fuzzed against exact arithmetic
	

None

T19
	

Wrong block numbers on Arbitrum and Orbit chains
	

BlockLib reads ArbSys
	

None

T20
	

A hook unlock attempted inside someone else's unlock
	

The PoolManager reverts with AlreadyUnlocked; the call fails without effect
	

None

Each row has a proof-of-concept test in test/ that must fail to profit or fail to break an invariant.
Rules for every change

    Conservation is checked where the money moves: finalize rejects any payout that does not balance (section 10).

    Every external call on the swap path is caught. A failure means no deposit or no exemption, never a revert.

    Rounding favours conservation. R, tips and rebates round down, and the refund is D − R, so nothing is created or lost.

    Unchecked blocks state the invariant that rules out overflow.

    No delegatecall, no selfdestruct, no inline assembly outside transient-storage helpers and audited v4 libraries.

Guarded launch

The first mainnet pool adds three limits. Each pool has maxOutstanding, a ceiling on deposits held at once, in quote units, beyond which swaps post no deposit. The team supplies the initial liquidity. A keeper runs with alerts from day one (section 12). The cap bounds the funds a bug could reach, and filling it on purpose is impractical: deposits are a fraction of notional and refund within seconds.
Audit process

Before each milestone closes, the twelve audits of the Assay specification (§0.6) run in parallel and each writes a report. Every finding gets a severity, the affected file, a root cause and a resolution.

Audit
	

Touchstone focus

1. Hardcoded values
	

Thresholds, windows, addresses, feed IDs

2. Stubs and simulation
	

Nothing mocked in src/

3. Dead code
	

Leftover trigger variants from the research

4. Security
	

This section, plus keeper key handling and RPC inputs

5. Architecture
	

Hook, Settler and lens boundaries; no cycles beyond the immutables

6. Code quality
	

Naming of regimes and units

7. Performance
	

SLOADs and SSTOREs per swap path against section 14's targets

8. Error handling
	

Every try/catch on the swap path, and what it hides

9. Dependencies
	

Pinned v4, Pyth and OpenZeppelin commits; no AGPL code

10. Test coverage
	

Every invariant and threat row has a test

11. Bug bounty
	

Exploits written as failing tests first, then fixed, then kept

12. Production readiness
	

Deploy dry runs, verification, alerts

An external audit by a firm with Uniswap v4 hook experience is required before any mainnet pool. Its cost is a real constraint: Bunni shut down in October 2025, citing six to seven figures for a secure relaunch after its exploit. Scope stays small for that reason. The licence and rebates can ship later, as separate audited deployments.
Deployment and operations
Networks

Arbitrum Sepolia comes first, as the closest stand-in for Arbitrum and Robinhood Chain, then Base Sepolia. Unichain Sepolia moved to OP Enterprise on 13 October, mainnet follows on 29 October, and its ordering afterwards is unannounced, so it waits.

Contract
	

Arbitrum Sepolia
	

Base Sepolia

PoolManager
	

0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317
	

0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408

Universal Router
	

0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47
	

0x492e6456d9528771018deb9e87ef7750ef184104

StateView
	

0x9d467fa9062b6e9b1a46e26007ad82db116c67cb
	

Confirm on day 1

PoolSwapTest
	

0xf3a39c86dbd13c45365e57fb90fe413371f65af8
	

0x8b5bcc363dde2614281ad875bad385e0a785d3b9

V4Quoter, Pyth, Chainlink feeds
	

Confirm on day 1
	

Confirm on day 1

These addresses came through a summarising fetch tool. Check every one against Uniswap's deployment page and the chain explorer before use, and record the check in DEPLOYMENTS.md.
Scripts

Script
	

Does

MineHookAddress.s.sol
	

Predicts the six support contracts from the deployer's nonces, builds the hook's init code, and mines a CREATE2 salt whose address has exactly the flag bits 0x20C4 in its low 14 bits

DeployCore.s.sol
	

Asserts the deployer's starting nonce, deploys the Settler, auction, ledger, lens, factory and router in that order, then the hook through the deterministic CREATE2 deployer, and checks every address against the prediction

CreatePool.s.sol
	

Reads script/config/<chain>.json, validates it off-chain with the same bounds as the factory, and calls createPool

Verify.s.sol
	

Verifies all seven contracts on the explorer and writes DEPLOYMENTS.md

0x20C4 is beforeInitialize (1 << 13), beforeSwap (1 << 7), afterSwap (1 << 6) and afterSwapReturnDelta (1 << 2). Every other permission bit must be zero, and BaseHook checks the address against the permissions in its constructor.

The deployer is an encrypted keystore through cast wallet, never a raw key in .env. Any other transaction from that account between prediction and deployment breaks the nonce plan, so DeployCore reverts if the starting nonce differs.
Release checklist

    Dry run on a fork of the target chain, then deploy.

    Verify every contract and record the addresses.

    Create the demo pool from the chain's config file.

    Run the demo bots and record a transaction for each of these: pool creation; an unflagged swap; a flagged swap; a settlement that retains; one that refunds with a rebate; an expiry; a closed-market settlement; a donation; a bid, an activation and an exempt swap; a rebate claim.

    Link each transaction from the README, next to the file and line that produced it.

Environment

.env.example lists every variable with a comment and no value: RPC URLs per chain, explorer API keys, HERMES_URL, HERMES_API_KEY, the keeper's keystore path, and the indexer's database URL. .env* files other than the example are ignored by git, and the history is scanned for secrets before the first push.
Runbook

There is no pause, so the runbook is about watching and migrating, not intervening.

Event
	

Response

Keeper down
	

Restart it; any third party can settle meanwhile. Records past their latest usable time expire and refund

Hermes outage
	

The keeper retries until the latest usable time, then lets records expire

maxOutstanding reached
	

New swaps post no deposit until settlements free room; investigate the keeper

Licence lapses
	

Nothing to do; the pool falls back to the plain clawback

Calendar within 30 days of validUntil
	

Deploy a pool with a new calendar and announce the move to LPs

Pyth feed deprecated
	

Deploy a new pool with the replacement feed ID

Bug found
	

Publish it, stop routing new flow to the pool, keep settling open records so traders get refunds, and help LPs exit; the hook never blocks withdrawals
Build plan

Two developers, Monday 19 October to Friday 27 November 2026, with ETHGlobal Mumbai in the middle. Developer 1 (D1) owns the contracts. Developer 2 (D2) owns the research, the off-chain services and the write-up. The full v2 takes six weeks, not two; what reaches the Mumbai submission is the core, closed-market mode, the quote tools and the licence.
A kill test on day 3, the licence built at Mumbai, audit-ready on 27 NovemberTwo developers, 2026. D1 builds the contracts; D2 runs the research and the servicesOct 19Oct 26Nov 2Nov 9Nov 16Nov 23Oct 19 to Nov 4Oct 19 to Oct 23Oct 21Oct 26 to Oct 29Oct 26 to Nov 4Oct 30 to Nov 4Nov 5 to Nov 7Nov 7Nov 9 to Nov 20Nov 20Nov 23 to Nov 27E1 to E6 and E9 · D2Hook core and factory · D1Day-3 gate: E2 recallSettlement and ledger · D1Keeper, indexer, bots · D2Closed market, quotes · D1Mumbai: licence builtMumbai submissionv2 hardening, E10 to E12Licence go or no-goAudits, write-up, freeze

The plan puts the cheapest kill test first. If trigger recall misses break-even on day 3, nothing built afterwards matters, the licence included: its exclusivity depends on outsiders being flagged.
Gates

Gate
	

Date
	

Test
	

If it fails

G1
	

Wed 21 Oct
	

E2: held-out recall at or above break-even, at φ ≤ 0.30, on at least one chain
	

Stop and switch to the runner-up in the report, with about eleven working days left; the hook scaffolding carries over

G2
	

Fri 30 Oct
	

E3 passes, and E4's median basis is at most ε/2
	

Re-set Δ and ε on development windows; if E4 kills, stop settlement work and re-plan the oracle

G3
	

Wed 4 Nov
	

Arbitrum Sepolia end to end: a flagged swap, a retaining and a refunding settlement, a donation, and a Saturday 31 October closure record settled at Monday's open
	

The Mumbai demo runs on a fork instead

G4
	

Sat 7 Nov, 09:00 IST
	

Mumbai submission
	

No late entries

G5
	

Fri 20 Nov
	

E10
	

The licence stays off on pilot pools and ships as research

G6
	

Fri 27 Nov
	

Audit-ready: every invariant, every gas target, the twelve audit reports, the lessons
	

The external-audit request slips; the checks do not

Monday 2 November is also the first reopen after US daylight saving time ends on 1 November, which tests the calendar for free.
Week by week

Week
	

D1: contracts
	

D2: research and services

1 · 19–23 Oct
	

Scaffold, pins and CI; BlockLib; triggers (first touch, flow bucket, drift); the deposit and record path; HookSwap; the factory; unit tests in both directions
	

Pre-register E1 to E4; run E1 and E2 on Assay's pipeline for G1; start the live Pyth–Binance basis log; confirm every testnet address

2 · 26–30 Oct
	

Settler: Pyth parsing, price conversion, markout, in-the-money split, regimes; finalize, expiry, vesting and drip; RebateLedger; invariants I1 to I8
	

E3 settlement replay; E5 and E6 simulations; keeper and indexer, first versions; G2

3 · 2–4 Nov
	

NyseCalendar with its differential test; closed-market mode; previewDeposit and GuardedRouter; Arbitrum Sepolia deployment; G3
	

E9 weekend replay; dashboard; demo bots; README split into pre-existing and event work; video outline

Mumbai · 5–7 Nov
	

LicenceAuction, the hook's fast path and the Settler's band regime
	

Holder bot, licence page on the dashboard, first E10 simulation, demo and submission

5–6 · 9–20 Nov
	

Licence invariants I11 to I13 and the state-machine differential; rebate wash tests; TouchstoneLens and StaticQuoteLib; Base Sepolia
	

E10 in full and on testnet with two bidder bots; E11; E12 fork tests; bytecode replay for E3 and E8; the E7 bake-off; G5

7 · 23–27 Nov
	

The twelve audit passes and their fixes; gas report; threat-model document
	

Lessons for every component; results write-up with every window; external audit request; G6
If time runs short

Cut in this order: the intents path; the URC-4 lens (keeping previewDeposit, GuardedRouter and HookSwap); the Base Sepolia deployment; rebates (keeping the ledger for deferred refunds). Never cut: the core hook, settlement, the licence, the invariants, or closed-market mode unless E9 kills it.
AI use, contributions and licences

AI use

AI helped with research, with this specification and with code under review. The rules:

    Every line in src/ is read and owned by a developer who can explain it. After each milestone that developer writes docs/lessons/NN-<topic>.md under the Assay teaching protocol (§0.10): the concept, the design decisions, a code walkthrough, failure modes, audit questions and exercises.

    No generated code merges without tests that would fail without it.

    Prompts are saved under docs/ai/prompts/ with dates. AI_USAGE.md lists the tools, what they produced and what people changed.

    No number appears anywhere without its source and its label: measured, backtest, simulation, testnet or target.

Contributions

    main is protected. Changes arrive by pull request, with the §0.5 validation commands green.

    The other developer reviews every pull request: D2 reviews contracts, D1 reviews research and service code.

    Commits are conventional, imperative and one logical change each, with the rationale in the body. No force-pushes.

    A pull request that touches src/ updates its tests and the gas snapshot, docs/gas.md if gas moved, and the threat model if behaviour changed.

    Design changes get a short decision record in docs/decisions/, such as the flow bucket replacing per-block size, or the band applying to the holder.

Licences

The repository is MIT. At the pinned commits, the v4-core interfaces and libraries the hook imports (IHooks.sol, Hooks.sol) are MIT, while PoolManager.sol is BUSL-1.1 and is only called, never copied. v4-periphery and OpenZeppelin's uniswap-hooks are MIT. Bunni's BidDog AmAmm.sol is AGPL-3.0, so none of its code is used.

