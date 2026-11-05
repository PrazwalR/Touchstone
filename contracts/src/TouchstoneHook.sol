// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/base/BaseHook.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {ProtocolFeeLibrary} from "v4-core/libraries/ProtocolFeeLibrary.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {SwapParams} from "v4-core/types/PoolOperation.sol";
import {IMsgSender} from "v4-periphery/interfaces/IMsgSender.sol";
import {ITouchstoneHook} from "./interfaces/ITouchstoneHook.sol";
import {ITouchstoneErrors} from "./interfaces/ITouchstoneErrors.sol";
import {ITouchstoneEvents} from "./interfaces/ITouchstoneEvents.sol";
import {IMarketCalendar} from "./interfaces/IMarketCalendar.sol";
import {IRebateLedger} from "./interfaces/IRebateLedger.sol";
import {IALFHook} from "./interfaces/IALFHook.sol";
import {ILicenceAuction} from "./interfaces/ILicenceAuction.sol";
import {ITouchstoneLens} from "./interfaces/ITouchstoneLens.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {PoolConfig, PoolFlags} from "./types/PoolConfig.sol";
import {PoolState} from "./types/PoolState.sol";
import {DepositQuote} from "./types/DepositQuote.sol";
import {Record} from "./types/Record.sol";
import {Payout} from "./types/Payout.sol";
import {BlockLib} from "./libraries/BlockLib.sol";
import {FlowBucketLib} from "./libraries/FlowBucketLib.sol";
import {PriceLib} from "./libraries/PriceLib.sol";
import {DepositLib} from "./libraries/DepositLib.sol";
import {SettlementMath} from "./libraries/SettlementMath.sol";
import {VestingLib} from "./libraries/VestingLib.sol";
import {TransientLib} from "./libraries/TransientLib.sol";
import {ReferenceLib} from "./libraries/ReferenceLib.sol";
import {TriggerLib} from "./libraries/TriggerLib.sol";
import {RecordLib} from "./libraries/RecordLib.sol";

/// @title TouchstoneHook
/// @notice Flags likely-arbitrage swaps, takes a refundable deposit from each as ERC-6909 claims,
/// and pays the deposit out when the Settler finalizes the record against a signed Pyth price.
/// @dev The hook never changes AMM execution (no beforeSwapReturnDelta) and has no liquidity
/// callbacks, so it can never block an LP's exit. It moves funds only in finalize and drip, and
/// finalize checks conservation before anything is paid. There is no owner and no upgrade path.
contract TouchstoneHook is BaseHook, IUnlockCallback, ITouchstoneHook, ITouchstoneErrors, ITouchstoneEvents {
    using StateLibrary for IPoolManager;
    using PoolFlags for uint8;

    /// @notice Addresses fixed at deployment. The deploy script predicts the support contracts from
    /// the deployer's nonces and mines the hook's CREATE2 salt with them in its init code.
    struct Deployment {
        address settler;
        address ledger;
        address factory;
        address licence;
        address lens;
        uint8 blockSource;
        address sequencerFeed;
        uint32 sequencerGrace;
        address[4] trustedRouters;
    }

    /// @dev Inputs to one flagged swap, gathered in memory to keep _afterSwap within the stack limit.
    struct SwapView {
        PoolId id;
        bool quoteIs0;
        bool buysRisky;
        bool depositIn0;
        uint256 notional;
        uint256 riskyAbs;
        int256 gapBps;
        uint8 mode;
        uint8 licence; // LICENCE_LIVE | BY_HOLDER, written only on licence pools
    }

    uint8 internal constant ACTION_FINALIZE = 0;
    uint8 internal constant ACTION_DRIP = 1;
    uint8 internal constant ACTION_RENT = 2;
    uint8 internal constant LICENCE_LIVE = 1;
    uint8 internal constant BY_HOLDER = 2;
    /// @dev The gap of a swap whose reference is absent, stale or unreadable. Being negative, it adds nothing to the
    /// deposit rate and never fires the drift trigger, exactly like a zero gap; only the licence fast path, which
    /// needs a measured gap, tells it apart.
    int256 internal constant GAP_UNKNOWN = type(int256).min;
    /// @dev End of an ABI-encoded PoolKey that follows a selector: 4 bytes, then five 32-byte words.
    uint256 internal constant KEY_END = 4 + 5 * 32;
    uint256 internal constant BPS = 10_000;

    address public immutable SETTLER;
    IRebateLedger public immutable LEDGER;
    address public immutable FACTORY;
    address public immutable LICENCE;
    ITouchstoneLens public immutable LENS;
    uint8 public immutable BLOCK_SOURCE;
    address public immutable SEQUENCER_FEED;
    uint32 public immutable SEQUENCER_GRACE;
    address public immutable TRUSTED_ROUTER_0;
    address public immutable TRUSTED_ROUTER_1;
    address public immutable TRUSTED_ROUTER_2;
    address public immutable TRUSTED_ROUTER_3;

    mapping(PoolId => PoolConfig) internal _config;
    mapping(PoolId => PoolState) internal _state;
    mapping(PoolId => PoolKey) internal _keys;
    mapping(PoolId => mapping(uint64 => bytes32)) internal _recordHash;

    modifier nonReentrant() {
        _lock();
        _;
        TransientLib.setLock(false);
    }

    /// @param manager The v4 PoolManager.
    /// @param d Support contracts, block source and trusted routers.
    constructor(IPoolManager manager, Deployment memory d) BaseHook(manager) {
        // The source itself comes from the per-chain deploy config, and DeployCore checks the chain id. ArbSys is not
        // probed here: Foundry's script simulation has no Arbitrum precompiles, so a probe would fail every deployment
        // to Arbitrum itself (decision 0049).
        if (d.blockSource > BlockLib.SOURCE_ARBSYS) revert Touchstone__InvalidBlockSource(d.blockSource);
        if (d.sequencerFeed != address(0) && d.sequencerFeed.code.length == 0) {
            revert Touchstone__NoCode(d.sequencerFeed);
        }
        SETTLER = d.settler;
        LEDGER = IRebateLedger(d.ledger);
        FACTORY = d.factory;
        LICENCE = d.licence;
        LENS = ITouchstoneLens(d.lens);
        BLOCK_SOURCE = d.blockSource;
        SEQUENCER_FEED = d.sequencerFeed;
        SEQUENCER_GRACE = d.sequencerGrace;
        TRUSTED_ROUTER_0 = d.trustedRouters[0];
        TRUSTED_ROUTER_1 = d.trustedRouters[1];
        TRUSTED_ROUTER_2 = d.trustedRouters[2];
        TRUSTED_ROUTER_3 = d.trustedRouters[3];
    }

    /// @notice The four callbacks Touchstone uses; the mined address must end in 0x20C4.
    /// @return p Permissions with beforeInitialize, beforeSwap, afterSwap and afterSwapReturnDelta set.
    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeSwap = true;
        p.afterSwap = true;
        p.afterSwapReturnDelta = true;
    }

    /// @inheritdoc ITouchstoneHook
    function register(PoolKey calldata key, PoolConfig calldata cfg) external {
        if (msg.sender != FACTORY) revert Touchstone__NotFactory();
        PoolId id = key.toId();
        if (_config[id].n0 != 0) revert Touchstone__AlreadyRegistered(id);
        _config[id] = cfg;
        _keys[id] = key;
        _state[id].vestLast = uint40(block.timestamp);
    }

    /// @inheritdoc ITouchstoneHook
    function finalize(Record calldata record, Payout calldata payout, bool expired) external nonReentrant {
        if (msg.sender != SETTLER) revert Touchstone__NotSettler();
        PoolId id = record.poolId;
        if (_recordHash[id][record.id] != RecordLib.hash(record)) revert Touchstone__RecordClosed(id, record.id);
        PoolState storage st = _state[id];
        uint256 pool = record.depositIn0 ? st.rebatePool0 : st.rebatePool1;
        if (!SettlementMath.conserves(payout, record.deposit, pool)) revert Touchstone__PayoutMismatch();
        if (expired && (payout.benign || payout.refund != record.deposit)) revert Touchstone__PayoutMismatch();

        delete _recordHash[id][record.id];
        // The record's deposit was added to outstanding when it was taken and is removed exactly once here.
        unchecked {
            if (record.depositIn0) st.outstanding0 -= record.deposit;
            else st.outstanding1 -= record.deposit;
        }
        poolManager.unlock(abi.encode(ACTION_FINALIZE, abi.encode(record, payout)));
        _deliver(record, payout);
    }

    /// @inheritdoc ITouchstoneHook
    function drip(PoolKey calldata key) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        PoolId id = key.toId();
        if (_config[id].n0 == 0) revert Touchstone__PoolNotRegistered(id);
        bytes memory out = poolManager.unlock(abi.encode(ACTION_DRIP, abi.encode(id)));
        (amount0, amount1) = abi.decode(out, (uint256, uint256));
    }

    /// @inheritdoc ITouchstoneHook
    function creditRent(PoolKey calldata key, uint256 amount) external nonReentrant {
        if (msg.sender != LICENCE) revert Touchstone__NotLicence();
        PoolId id = key.toId();
        if (!_config[id].flags.has(PoolFlags.LICENCE)) revert Touchstone__NotLicence();
        poolManager.unlock(abi.encode(ACTION_RENT, abi.encode(id, amount)));
    }

    /// @notice Runs the hook's own unlocks: finalize, drip and rent. PoolManager only.
    /// @param data ABI-encoded action and its payload.
    /// @return ABI-encoded amounts donated.
    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (uint8 action, bytes memory payload) = abi.decode(data, (uint8, bytes));
        if (action == ACTION_FINALIZE) {
            (Record memory record, Payout memory payout) = abi.decode(payload, (Record, Payout));
            // Every state write happens before any external call. The drip is computed first, so the
            // LP share this payout adds starts vesting now instead of being released at once.
            (uint256 d0, uint256 d1) = _dripEffects(record.poolId);
            _account(record, payout);
            _donate(record.poolId, d0, d1);
            _payOut(record, payout);
            return abi.encode(d0, d1);
        }
        if (action == ACTION_RENT) {
            (PoolId rentPool, uint256 amount) = abi.decode(payload, (PoolId, uint256));
            _creditRent(rentPool, amount);
            return "";
        }
        PoolId id = abi.decode(payload, (PoolId));
        (uint256 a0, uint256 a1) = _dripEffects(id);
        _donate(id, a0, a1);
        return abi.encode(a0, a1);
    }

    /// @inheritdoc ITouchstoneHook
    function recordHash(PoolId id, uint64 recordId) external view returns (bytes32) {
        return _recordHash[id][recordId];
    }

    /// @inheritdoc ITouchstoneHook
    function poolState(PoolId id) external view returns (PoolState memory) {
        return _state[id];
    }

    /// @inheritdoc ITouchstoneHook
    function poolKey(PoolId id) external view returns (PoolKey memory) {
        return _keys[id];
    }

    /// @inheritdoc ITouchstoneHook
    function lastDeposit(PoolId id) external view returns (uint256 amount, uint64 recordId) {
        amount = TransientLib.get(TransientLib.LAST_DEPOSIT, id);
        recordId = uint64(TransientLib.get(TransientLib.LAST_RECORD, id));
    }

    /// @inheritdoc ITouchstoneHook
    function previewDeposit(PoolKey calldata key, bool zeroForOne, uint256 notionalQuote, address swapper)
        external
        view
        returns (DepositQuote memory)
    {
        return LENS.previewDeposit(key, zeroForOne, notionalQuote, swapper, _touchedInTx(key));
    }

    /// @notice URC-4's quoting functions (getIndicativeQuote, swapToPrice, isLive, maxGas) and ERC-165, served by the
    /// lens. Kept out of the function dispatcher so that beforeSwap and afterSwap pay nothing for them (decision
    /// 0057). The call is forwarded as a static call with one word appended: whether this transaction has already
    /// touched the pool, which only the hook can see. Lens reverts, such as URC-4's MalformedHookData, pass through.
    /// @param data The original calldata.
    /// @return The lens's answer, unchanged.
    fallback(bytes calldata data) external returns (bytes memory) {
        // Calls that name a pool carry its key first, so the pool id is the hash of those 160 bytes.
        bool touched = data.length >= KEY_END
            && TransientLib.get(TransientLib.FIRST_TOUCH_TX, PoolId.wrap(keccak256(data[4:KEY_END]))) != 0;
        return Address.functionStaticCall(address(LENS), bytes.concat(data, bytes32(uint256(touched ? 1 : 0))));
    }

    /// @dev Whether this transaction has already made the block's first touch on the pool: the one input to a quote
    /// that only the hook can read.
    function _touchedInTx(PoolKey calldata key) internal view returns (bool) {
        return TransientLib.get(TransientLib.FIRST_TOUCH_TX, key.toId()) != 0;
    }

    function _lock() internal {
        if (TransientLib.locked()) revert Touchstone__Reentrant();
        TransientLib.setLock(true);
    }

    /// @dev Only pools the factory registered may initialize, and only through the factory.
    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal view override returns (bytes4) {
        if (sender != FACTORY) revert Touchstone__NotFactory();
        PoolId id = key.toId();
        if (_config[id].n0 == 0) revert Touchstone__PoolNotRegistered(id);
        return this.beforeInitialize.selector;
    }

    /// @dev Snapshot the pre-swap price, liquidity and executed fee, and clear the last-deposit slots so a read
    /// after an unflagged swap returns nothing.
    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        internal
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint256 len = hookData.length;
        if (len != 0 && len != 32 && len != 64) revert IALFHook.MalformedHookData();
        // Each word must be a clean address, so a payload that decodes on a flagged swap is checked on every swap.
        if (len != 0 && uint256(bytes32(hookData[:32])) >> 160 != 0) revert IALFHook.MalformedHookData();
        if (len == 64 && uint256(bytes32(hookData[32:64])) >> 160 != 0) revert IALFHook.MalformedHookData();
        PoolId id = key.toId();
        (uint160 sqrtPriceX96,, uint24 packedProtocolFee, uint24 lpFee) = poolManager.getSlot0(id);
        uint16 protocolFee = params.zeroForOne
            ? ProtocolFeeLibrary.getZeroForOneFee(packedProtocolFee)
            : ProtocolFeeLibrary.getOneForZeroFee(packedProtocolFee);
        uint24 swapFee = protocolFee == 0 ? lpFee : ProtocolFeeLibrary.calculateSwapFee(protocolFee, lpFee);
        TransientLib.set(TransientLib.PRE_SQRT_PRICE, id, sqrtPriceX96);
        TransientLib.set(TransientLib.PRE_LIQUIDITY, id, poolManager.getLiquidity(id));
        TransientLib.set(TransientLib.PRE_SWAP_FEE, id, swapFee);
        TransientLib.set(TransientLib.LAST_DEPOSIT, id, 0);
        TransientLib.set(TransientLib.LAST_RECORD, id, 0);
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    /// @dev Spec §7.4. Every swap feeds the flow bucket; only a swap that passes the retail check pays
    /// for a reference read. Failed or malformed reference responses remove drift and gap scaling;
    /// first-touch and flow can still take a floor-rate deposit. Oracle gas/returndata is not bounded.
    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        SwapView memory v = _view(key, params, delta);
        uint256 deposit = _evaluate(v, sender, delta);
        if (deposit == 0) return (this.afterSwap.selector, 0);
        _takeDeposit(sender, key, params, delta, hookData, v, deposit);
        return (this.afterSwap.selector, SafeCast.toInt128(deposit));
    }

    /// @dev Signed receipts of the swap, by token role.
    function _view(PoolKey calldata key, SwapParams calldata params, BalanceDelta delta)
        internal
        view
        returns (SwapView memory v)
    {
        v.id = key.toId();
        v.quoteIs0 = _config[v.id].flags.has(PoolFlags.QUOTE_IS_0);
        (int256 xRisky, int256 xQuote) = v.quoteIs0
            ? (int256(delta.amount1()), int256(delta.amount0()))
            : (int256(delta.amount0()), int256(delta.amount1()));
        v.notional = xQuote >= 0 ? uint256(xQuote) : uint256(-xQuote);
        v.riskyAbs = xRisky >= 0 ? uint256(xRisky) : uint256(-xRisky);
        v.buysRisky = xRisky > 0;
        // The unspecified currency is the output for exact input and the input for exact output.
        v.depositIn0 = (params.amountSpecified < 0) != params.zeroForOne;
    }

    /// @dev Licence fast path, triggers and deposit size; zero means the swap posts nothing.
    function _evaluate(SwapView memory v, address sender, BalanceDelta delta) internal returns (uint256 deposit) {
        PoolConfig storage cfg = _config[v.id];
        PoolState storage st = _state[v.id];
        bool flowHit = _updateFlow(st, cfg, v.notional, v.buysRisky);
        bool large = v.notional >= cfg.n0;
        if (!large && !flowHit) return 0;
        if (v.riskyAbs == 0 || v.notional == 0) return 0;

        // The same classification the lens makes for previewDeposit and URC-4 quotes, written out here; the quote
        // integrity tests hold the two equal.
        // The flags word is read once: a pool without the calendar or the licence pays for neither (gate, §0.5).
        uint8 flags = cfg.flags;
        bool closed;
        if (flags.has(PoolFlags.CALENDAR)) {
            bool known;
            (known, closed) = _closedNow(cfg);
            if (!known) return 0;
        }
        if (closed) v.mode = DepositLib.MODE_CLOSED;
        else v.gapBps = _gap(cfg, v, uint160(TransientLib.get(TransientLib.PRE_SQRT_PRICE, v.id)));
        if (flags.has(PoolFlags.LICENCE) && large && !closed) {
            address swapper = _swapper(sender);
            if (_licence(st, cfg, v, swapper)) {
                // The exempt swap uses up the block's first touch, so the holder gets one per block (I11).
                st.lastTouchBlock = BlockLib.number(BLOCK_SOURCE);
                emit LicensedSwap(v.id, swapper, delta.amount0(), delta.amount1());
                return 0;
            }
        }
        bool isFirst = !closed && large && _firstTouch(st, v.id);
        uint8 mask = TriggerLib.triggers(flowHit, large, isFirst, closed, TriggerLib.drift(v.gapBps, cfg.tauBps));
        if (mask == 0) return 0;

        uint256 depositQuote;
        (deposit, depositQuote) = _depositFor(cfg, v);
        if (_outstandingOverflows(st, v, deposit) || !_withinBudget(st, cfg, v, depositQuote)) return 0;
    }

    /// @dev Spec §10, rules at swap time. Records whether a lease was live and whether this is the holder's first
    /// touch in the block; returns true when that first touch is also inside the band of a fresh reference, which
    /// exempts it. A failed or malformed licence read means no lease, never a failed swap.
    function _licence(PoolState storage st, PoolConfig storage cfg, SwapView memory v, address swapper)
        internal
        view
        returns (bool exempt)
    {
        (bool success, bytes memory ret) = LICENCE.staticcall(abi.encodeCall(ILicenceAuction.holderOf, (v.id)));
        if (!success || ret.length < 64) return false;
        // Decoded as plain words, so a malformed answer reads as some address instead of reverting the swap.
        (uint256 holderWord, uint256 liveWord) = abi.decode(ret, (uint256, uint256));
        if (liveWord == 0) return false;
        address holder = address(uint160(holderWord));
        // A zero holder address would match a trusted router whose msgSender() is zero outside its own swaps.
        bool byHolder = holder != address(0) && swapper == holder && st.lastTouchBlock < BlockLib.number(BLOCK_SOURCE);
        v.licence = byHolder ? LICENCE_LIVE | BY_HOLDER : LICENCE_LIVE;
        if (!byHolder || v.gapBps == GAP_UNKNOWN) return false;
        uint256 gap = v.gapBps >= 0 ? uint256(v.gapBps) : uint256(-v.gapBps);
        return gap <= cfg.bandBps;
    }

    /// @dev The address a swap is attributed to: the trader a trusted router reports, else the caller. It never
    /// reads hookData or tx.origin (spec §10).
    function _swapper(address sender) internal view returns (address) {
        if (!_isTrustedRouter(sender)) return sender;
        try IMsgSender(sender).msgSender() returns (address caller) {
            return caller;
        } catch {
            return sender;
        }
    }

    /// @dev Deposit in the unspecified currency and its value in quote units (spec §7.6). A deposit
    /// held in the risky token converts at the swap's own execution price, so no oracle is read.
    function _depositFor(PoolConfig storage cfg, SwapView memory v)
        internal
        view
        returns (uint256 deposit, uint256 depositQuote)
    {
        depositQuote = DepositLib.quoteAmount(v.notional, _rate(cfg, v));
        deposit = v.depositIn0 == v.quoteIs0 ? depositQuote : DepositLib.toRisky(depositQuote, v.riskyAbs, v.notional);
    }

    function _rate(PoolConfig storage cfg, SwapView memory v) internal view returns (uint256) {
        return DepositLib.rateBps(v.mode, v.gapBps, cfg.deltaBps, cfg.deltaMaxBps, cfg.betaX100, cfg.deltaClosedBps);
    }

    /// @dev Drain both buckets to now and add this swap to its direction's bucket.
    function _updateFlow(PoolState storage st, PoolConfig storage cfg, uint256 notional, bool buysRisky)
        internal
        returns (bool hit)
    {
        (uint104 newBuy, uint104 newSell, bool h) = FlowBucketLib.update(
            st.flowBuy,
            st.flowSell,
            st.flowTime,
            uint40(block.timestamp),
            cfg.nMin,
            cfg.flowHorizon,
            notional,
            buysRisky
        );
        st.flowBuy = newBuy;
        st.flowSell = newSell;
        st.flowTime = uint40(block.timestamp);
        return h;
    }

    /// @dev Signed pre-swap gap to the reference in bps; GAP_UNKNOWN when the reference is absent, stale or
    /// unreadable, which the licence fast path must not mistake for a zero gap.
    function _gap(PoolConfig storage cfg, SwapView memory v, uint160 preSqrtPriceX96) internal view returns (int256) {
        address feed = cfg.referenceFeed;
        if (feed == address(0) || !ReferenceLib.sequencerUp(SEQUENCER_FEED, SEQUENCER_GRACE)) return GAP_UNKNOWN;
        (uint8 decRisky, uint8 decQuote) = v.quoteIs0 ? (cfg.decimals1, cfg.decimals0) : (cfg.decimals0, cfg.decimals1);
        (bool ok, uint256 refX36) = ReferenceLib.readX36(feed, cfg.referenceMaxAge, decRisky, decQuote);
        if (!ok) return GAP_UNKNOWN;
        uint256 poolX36 = PriceLib.poolPriceX36(preSqrtPriceX96, !v.quoteIs0);
        return PriceLib.signedGapBps(refX36, poolX36, v.buysRisky);
    }

    /// @dev Whether a swap now would settle outside the regular session (closed), and whether the calendar
    /// could say (known). Past the calendar's published data, or if the calendar cannot be read, nothing is
    /// known and the swap posts no deposit: no trader ever posts a deposit that cannot be settled (§9.1).
    function _closedNow(PoolConfig storage cfg) internal view returns (bool known, bool closed) {
        if (block.timestamp >= cfg.calendarValidUntil) return (false, false);
        (bool okNow, bool openNow) = _calendarOpen(cfg.calendar, block.timestamp);
        (bool okLater, bool openLater) = _calendarOpen(cfg.calendar, block.timestamp + cfg.settleDelay + cfg.maxLag);
        if (!okNow || !okLater) return (false, false);
        if (openNow && openLater) return (true, false);
        // A closure record settles at nextOpen; if the calendar cannot answer that now, the record could never be
        // settled or expired (I10), so the swap posts no deposit instead.
        bool okNext = _calendarAnswersNextOpen(cfg.calendar);
        return (okNext, okNext);
    }

    function _calendarAnswersNextOpen(address calendar) internal view returns (bool) {
        (bool success, bytes memory ret) =
            calendar.staticcall(abi.encodeCall(IMarketCalendar.nextOpen, (block.timestamp)));
        return success && ret.length >= 32;
    }

    /// @dev isOpen through a staticcall with a length check, so a calendar that reverts or returns short data
    /// cannot revert the swap (the same reasoning as ReferenceLib, audit GEN-3).
    function _calendarOpen(address calendar, uint256 t) internal view returns (bool ok, bool open) {
        (bool success, bytes memory ret) = calendar.staticcall(abi.encodeCall(IMarketCalendar.isOpen, (t)));
        if (!success || ret.length < 32) return (false, false);
        return (true, abi.decode(ret, (uint256)) != 0);
    }

    /// @dev First touch by BlockLib's block number; later swaps in the same transaction also count.
    function _firstTouch(PoolState storage st, PoolId id) internal returns (bool) {
        uint64 nowBlock = BlockLib.number(BLOCK_SOURCE);
        bool inTx = TransientLib.get(TransientLib.FIRST_TOUCH_TX, id) != 0;
        (bool isFirst, bool consumes) = TriggerLib.firstTouch(st.lastTouchBlock, nowBlock, inTx);
        if (consumes) {
            st.lastTouchBlock = nowBlock;
            TransientLib.set(TransientLib.FIRST_TOUCH_TX, id, 1);
        }
        return isFirst;
    }

    /// @dev True if adding the deposit would take its currency's outstanding past 2^128.
    function _outstandingOverflows(PoolState storage st, SwapView memory v, uint256 deposit)
        internal
        view
        returns (bool)
    {
        return (v.depositIn0 ? st.outstanding0 : st.outstanding1) + deposit > type(uint128).max;
    }

    /// @dev Guarded launch: deposits held at once, valued in quote units at this swap's price, stay
    /// within maxOutstanding (decision 0025). Written so that no input, however extreme the pool
    /// price, can overflow and revert the swap: the risky side is compared against the remaining
    /// budget converted to risky units instead of being converted to quote.
    function _withinBudget(PoolState storage st, PoolConfig storage cfg, SwapView memory v, uint256 depositQuote)
        internal
        view
        returns (bool)
    {
        (uint256 outQuote, uint256 outRisky) =
            v.quoteIs0 ? (st.outstanding0, st.outstanding1) : (st.outstanding1, st.outstanding0);
        uint256 budget = cfg.maxOutstanding;
        // outQuote < 2^128 and depositQuote <= notional < 2^128, so the sum cannot overflow.
        if (outQuote + depositQuote > budget) return false;
        if (outRisky == 0) return true;
        // budget and riskyAbs are both below 2^128, so the product fits in 256 bits.
        return outRisky <= FullMath.mulDiv(budget - outQuote - depositQuote, v.riskyAbs, v.notional);
    }

    /// @dev Mint the deposit's claims, commit the record and emit its events.
    function _takeDeposit(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData,
        SwapView memory v,
        uint256 deposit
    ) internal {
        PoolState storage st = _state[v.id];
        (address beneficiary, address rebateTo) = _resolve(sender, hookData);
        Record memory r = Record({
            poolId: v.id,
            id: st.nextRecordId,
            timestamp: uint40(block.timestamp),
            mode: v.mode,
            licenceActive: v.licence & LICENCE_LIVE != 0,
            byHolder: v.licence & BY_HOLDER != 0,
            zeroForOne: params.zeroForOne,
            depositIn0: v.depositIn0,
            sender: sender,
            beneficiary: beneficiary,
            rebateTo: rebateTo,
            deposit: uint128(deposit),
            amount0: delta.amount0(),
            amount1: delta.amount1(),
            sqrtPriceBeforeX96: uint160(TransientLib.get(TransientLib.PRE_SQRT_PRICE, v.id)),
            sqrtPriceAfterX96: _sqrtPriceNow(v.id),
            liquidityBefore: uint128(TransientLib.get(TransientLib.PRE_LIQUIDITY, v.id)),
            swapFeePips: uint24(TransientLib.get(TransientLib.PRE_SWAP_FEE, v.id))
        });
        _recordHash[v.id][r.id] = RecordLib.hash(r);
        // A deposit is at most the swap's notional, so outstanding stays far below 2^128, and record ids
        // below 2^64 would take more swaps than any chain will process.
        unchecked {
            st.nextRecordId = r.id + 1;
            if (v.depositIn0) st.outstanding0 += uint128(deposit);
            else st.outstanding1 += uint128(deposit);
        }
        TransientLib.set(TransientLib.LAST_DEPOSIT, v.id, deposit);
        TransientLib.set(TransientLib.LAST_RECORD, v.id, r.id);

        // Returning +D credits the hook on the unspecified currency; minting D of claims to itself
        // settles that credit inside the same callback.
        Currency unspecified = v.depositIn0 ? key.currency0 : key.currency1;
        poolManager.mint(address(this), unspecified.toId(), deposit);

        emit DepositTaken(v.id, r.id, r);
        int128 signed = -SafeCast.toInt128(deposit);
        emit HookSwap(v.id, sender, v.depositIn0 ? signed : int128(0), v.depositIn0 ? int128(0) : signed, 0);
    }

    function _sqrtPriceNow(PoolId id) internal view returns (uint160 sqrtPriceX96) {
        (sqrtPriceX96,,,) = poolManager.getSlot0(id);
    }

    /// @dev Refund beneficiary and rebate recipient (spec §7.7 and §11.3). hookData is untrusted and
    /// supplies only these two addresses.
    function _resolve(address sender, bytes calldata hookData)
        internal
        view
        returns (address beneficiary, address rebateTo)
    {
        // A trusted router reports its trader; for any other caller, or a router that cannot say, _swapper returns
        // the caller itself, which only names the beneficiary when hookData and tx.origin cannot.
        address trader = _swapper(sender);
        if (trader != sender) beneficiary = trader;
        if (hookData.length >= 32) {
            // _beforeSwap rejected any word with bits above 160 on this same swap, so each word is a clean address
            // and a cast reads it exactly. Naming the hook itself would strand the refund in the hook (I17), so it
            // counts as unnamed.
            address named = address(bytes20(hookData[12:32]));
            if (beneficiary == address(0) && named != address(this)) beneficiary = named;
            if (hookData.length == 64) rebateTo = address(bytes20(hookData[44:64]));
            if (rebateTo == address(this)) rebateTo = address(0);
        }
        if (beneficiary == address(0)) beneficiary = tx.origin;
        if (rebateTo == address(0)) rebateTo = beneficiary;
    }

    function _isTrustedRouter(address sender) internal view returns (bool) {
        if (sender == address(0)) return false;
        return sender == TRUSTED_ROUTER_0 || sender == TRUSTED_ROUTER_1 || sender == TRUSTED_ROUTER_2
            || sender == TRUSTED_ROUTER_3;
    }

    /// @dev Pays a payout already checked for conservation, inside the hook's unlock.
    function _payOut(Record memory record, Payout memory payout) internal {
        PoolId id = record.poolId;
        PoolKey storage key = _keys[id];
        Currency c = record.depositIn0 ? key.currency0 : key.currency1;

        if (payout.benign) {
            if (payout.rebate != 0) {
                _toLedger(c, record.rebateTo, payout.rebate, IRebateLedger.Kind.REBATE);
                emit RebateCredited(id, record.id, record.rebateTo, c, payout.rebate);
                emit HookBonus(
                    PoolId.unwrap(id), record.depositIn0 ? payout.rebate : 0, record.depositIn0 ? 0 : payout.rebate
                );
            }
        } else if (payout.toProtocol != 0) {
            _toLedger(c, _config[id].protocolRecipient, payout.toProtocol, IRebateLedger.Kind.PROTOCOL);
        }
        if (payout.tip != 0) _toLedger(c, payout.tipTo, payout.tip, IRebateLedger.Kind.TIP);
        if (payout.refund != 0) {
            _toLedger(c, record.beneficiary, payout.refund, IRebateLedger.Kind.DEFERRED_REFUND);
        }
    }

    /// @dev Effects of a payout on the rebate pool and the vesting buffer, applied before any transfer.
    function _account(Record memory record, Payout memory payout) internal {
        PoolState storage st = _state[record.poolId];
        if (payout.benign) {
            // conserves() checked tip + rebate <= the rebate pool for this currency.
            unchecked {
                uint128 spent = payout.tip + payout.rebate;
                if (record.depositIn0) st.rebatePool0 -= spent;
                else st.rebatePool1 -= spent;
            }
            return;
        }
        // Accumulated buffers require each currency's aggregate claim balance to stay below 2^128;
        // maxOutstanding alone does not bound historical vesting and rebate inflows.
        unchecked {
            if (record.depositIn0) {
                st.rebatePool0 += payout.toRebatePool;
                st.vest0 += payout.toLPs;
            } else {
                st.rebatePool1 += payout.toRebatePool;
                st.vest1 += payout.toLPs;
            }
        }
    }

    /// @dev Recipient execution gets its own ledger unlock, so an unsettled recipient delta rolls
    /// back only delivery. push withdraws the recipient's whole balance, including earlier credits.
    function _deliver(Record calldata record, Payout calldata payout) internal {
        PoolKey storage key = _keys[record.poolId];
        Currency c = record.depositIn0 ? key.currency0 : key.currency1;
        bool refundDelivered = true;
        if (payout.refund != 0) refundDelivered = _push(c, record.beneficiary);
        // A shared beneficiary receives both credits in the first push.
        if (payout.tip != 0 && (payout.refund == 0 || payout.tipTo != record.beneficiary)) _push(c, payout.tipTo);
        if (!refundDelivered) emit RefundDeferred(record.poolId, record.id, record.beneficiary, payout.refund);
    }

    function _push(Currency c, address recipient) internal returns (bool) {
        try LEDGER.push(recipient, c) returns (uint256) {
            return true;
        } catch {
            return false;
        }
    }

    function _toLedger(Currency c, address recipient, uint256 amount, IRebateLedger.Kind kind) internal {
        poolManager.transfer(address(LEDGER), c.toId(), amount);
        LEDGER.credit(recipient, c, amount, kind);
    }

    /// @dev Rent from the LicenceAuction, which settled it into the hook's ERC-6909 claims before calling (spec §10,
    /// decision 0056). The protocol share goes to the ledger, rho of the rest to the rebate pool, and what remains
    /// starts vesting to in-range LPs. State is written before any external call; the three parts sum to `amount`.
    function _creditRent(PoolId id, uint256 amount) internal {
        PoolConfig storage cfg = _config[id];
        PoolState storage st = _state[id];
        PoolKey memory key = _keys[id];
        bool quoteIs0 = cfg.flags.has(PoolFlags.QUOTE_IS_0);
        Currency c = quoteIs0 ? key.currency0 : key.currency1;
        (uint256 d0, uint256 d1) = _dripEffects(id);
        uint256 toProtocol = FullMath.mulDiv(amount, cfg.protocolShareBps, BPS);
        uint256 toRebate = FullMath.mulDiv(amount - toProtocol, cfg.rhoBps, BPS);
        uint128 toVest = SafeCast.toUint128(amount - toProtocol - toRebate);
        if (quoteIs0) {
            st.rebatePool0 += uint128(toRebate);
            st.vest0 += toVest;
        } else {
            st.rebatePool1 += uint128(toRebate);
            st.vest1 += toVest;
        }
        _donate(id, d0, d1);
        if (toProtocol != 0) _toLedger(c, cfg.protocolRecipient, toProtocol, IRebateLedger.Kind.PROTOCOL);
        emit RentCredited(id, amount, toRebate, toVest);
    }

    /// @dev Effects of a drip: vest * min(1, elapsed / vestPeriod) of each currency leaves the buffer.
    /// With no in-range liquidity nothing is released and the clock restarts, so the waiting amount
    /// vests gradually once liquidity returns instead of all at once to the first position (decision 0026).
    function _dripEffects(PoolId id) internal returns (uint256 amount0, uint256 amount1) {
        PoolState storage st = _state[id];
        uint256 elapsed = block.timestamp - st.vestLast;
        st.vestLast = uint40(block.timestamp);
        if (st.vest0 == 0 && st.vest1 == 0) return (0, 0);
        if (poolManager.getLiquidity(id) == 0) return (0, 0);
        uint256 period = _config[id].vestPeriod;
        amount0 = VestingLib.releasable(st.vest0, elapsed, period);
        amount1 = VestingLib.releasable(st.vest1, elapsed, period);
        // releasable never exceeds the buffer it is given.
        unchecked {
            st.vest0 -= uint128(amount0);
            st.vest1 -= uint128(amount1);
        }
    }

    /// @dev Interactions of a drip: burn the released claims and donate them to in-range LPs.
    function _donate(PoolId id, uint256 amount0, uint256 amount1) internal {
        if (amount0 == 0 && amount1 == 0) return;
        PoolKey memory key = _keys[id];
        if (amount0 != 0) poolManager.burn(address(this), key.currency0.toId(), amount0);
        if (amount1 != 0) poolManager.burn(address(this), key.currency1.toId(), amount1);
        poolManager.donate(key, amount0, amount1, "");
        emit Dripped(id, amount0, amount1);
    }
}
