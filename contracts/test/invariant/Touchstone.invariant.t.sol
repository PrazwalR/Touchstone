// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {CustomRevert} from "v4-core/libraries/CustomRevert.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTestNoChecks} from "v4-core/test/PoolModifyLiquidityTestNoChecks.sol";
import {TouchstoneFixture, IHookUnderTest} from "../utils/TouchstoneFixture.sol";
import {ISettler} from "../../src/interfaces/ISettler.sol";
import {RebateLedger} from "../../src/RebateLedger.sol";
import {ITouchstoneEvents} from "../../src/interfaces/ITouchstoneEvents.sol";
import {PoolState} from "../../src/types/PoolState.sol";
import {Record} from "../../src/types/Record.sol";
import {Payout} from "../../src/types/Payout.sol";
import {PriceLib} from "../../src/libraries/PriceLib.sol";
import {MockPythUnique} from "../mocks/MockPythUnique.sol";
import {MockV3Aggregator} from "../mocks/MockV3Aggregator.sol";

/// @notice Drives random sequences of swaps, settlements, expiries, drips, liquidity changes,
/// reference failures and ledger claims against the real contracts.
contract Handler is Test, ITouchstoneEvents {
    using StateLibrary for IPoolManager;

    struct Env {
        IPoolManager manager;
        IHookUnderTest hook;
        ISettler settler;
        RebateLedger ledger;
        PoolSwapTest swapRouter;
        MockPythUnique pyth;
        MockV3Aggregator feed;
        PoolKey key;
        bool quoteIs0;
        uint8 decRisky;
        uint8 decQuote;
        bytes32 baseId;
        bytes32 quoteId;
    }

    Env internal env;
    /// @dev v4's checked test router asserts that adding liquidity never returns tokens, which fails
    /// when the add also collects accrued fees; the unchecked router does not.
    PoolModifyLiquidityTestNoChecks internal lpRouter;
    Record[] internal open;
    address[] internal recipients;

    // Ghosts. Any violation flag set here fails the invariant that reads it.
    uint256 public recordsTaken;
    uint256 public recordsClosed;
    bool public conservationBroken;
    bool public expiryPaidExtra;
    bool public rebateRuleBroken;
    bool public liquidityBlocked;
    bool public swapRevertedOnDependency;
    bool public recordBlocked;
    uint256 public rebatesPaid;
    uint256 public rebateInflows;

    constructor(Env memory e) {
        env = e;
        lpRouter = new PoolModifyLiquidityTestNoChecks(e.manager);
        MockERC20(Currency.unwrap(e.key.currency0)).mint(address(this), type(uint128).max);
        MockERC20(Currency.unwrap(e.key.currency1)).mint(address(this), type(uint128).max);
        MockERC20(Currency.unwrap(e.key.currency0)).approve(address(e.swapRouter), type(uint256).max);
        MockERC20(Currency.unwrap(e.key.currency1)).approve(address(e.swapRouter), type(uint256).max);
        MockERC20(Currency.unwrap(e.key.currency0)).approve(address(lpRouter), type(uint256).max);
        MockERC20(Currency.unwrap(e.key.currency1)).approve(address(lpRouter), type(uint256).max);
    }

    // --- actions -------------------------------------------------------------------------------

    function swap(uint256 usdSeed, bool buy, bool exactIn, uint256 hookDataSeed) external {
        uint256 usd = bound(usdSeed, 100, 600_000);
        uint256 amount = (buy == exactIn) ? usd * 10 ** env.decQuote : usd * 10 ** env.decRisky / 3_000;
        if (amount == 0) return;
        bool zeroForOne = buy == env.quoteIs0;
        bytes memory hookData;
        if (hookDataSeed % 3 == 1) hookData = abi.encode(_recipient(hookDataSeed));
        if (hookDataSeed % 3 == 2) hookData = abi.encode(_recipient(hookDataSeed), _recipient(hookDataSeed >> 8));
        vm.recordLogs();
        try env.swapRouter
            .swap(
                env.key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: exactIn ? -int256(amount) : int256(amount),
                    sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                PoolSwapTest.TestSettings(false, false),
                hookData
            ) {
            _collectRecords();
        } catch (bytes memory err) {
            // PoolManager wraps every revert raised inside a hook callback in WrappedError; anything
            // else (a price limit already reached, an exhausted range) is the AMM's own behaviour.
            if (bytes4(err) == CustomRevert.WrappedError.selector) swapRevertedOnDependency = true;
        }
    }

    function settle(uint256 index, uint256 moveBps, bool up) external {
        if (open.length == 0) return;
        index = bound(index, 0, open.length - 1);
        Record memory r = open[index];
        (uint256 t0,,) = env.settler.settleTime(r);
        if (block.timestamp < t0) vm.warp(t0);
        int64 price8 = _fairPrice8(bound(moveBps, 0, 300), up);
        if (price8 <= 0) return;
        bytes[] memory u = new bytes[](2);
        u[0] = env.pyth.encode(env.baseId, price8, 0, -8, uint64(t0), uint64(t0 - 1));
        u[1] = env.pyth.encode(env.quoteId, 1e8, 0, -8, uint64(t0), uint64(t0 - 1));
        PoolState memory before = env.hook.poolState(r.poolId);
        // I10: an open record with its first update in hand always settles, whoever its recipients are.
        try env.settler.settle(r, u) returns (Payout memory p) {
            _checkPayout(r, p, before);
            _close(index);
        } catch {
            recordBlocked = true;
        }
    }

    function expire(uint256 index) external {
        if (open.length == 0) return;
        index = bound(index, 0, open.length - 1);
        Record memory r = open[index];
        (,, uint256 expiresAt) = env.settler.settleTime(r);
        if (block.timestamp < expiresAt) vm.warp(expiresAt);
        Currency c = r.depositIn0 ? env.key.currency0 : env.key.currency1;
        uint256 owedBefore = env.ledger.owed(r.beneficiary, c);
        uint256 balBefore = c.balanceOf(r.beneficiary);
        try env.settler.expire(r) {}
        catch {
            recordBlocked = true;
            return;
        }
        uint256 got = (c.balanceOf(r.beneficiary) - balBefore) + (env.ledger.owed(r.beneficiary, c) - owedBefore);
        if (got != r.deposit) expiryPaidExtra = true;
        _close(index);
    }

    function drip(uint256 warpSeed) external {
        vm.warp(block.timestamp + bound(warpSeed, 0, 2 hours));
        env.hook.drip(env.key);
    }

    function liquidity(uint256 seed, bool add) external {
        int24 spacing = env.key.tickSpacing;
        int256 delta = int256(bound(seed, 1e9, 1e15));
        ModifyLiquidityParams memory p = ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(spacing),
            tickUpper: TickMath.maxUsableTick(spacing),
            liquidityDelta: add ? delta : -delta,
            salt: bytes32(uint256(1))
        });
        if (!add) {
            uint128 mine = _myLiquidity(p);
            if (mine == 0) return;
            p.liquidityDelta = -int256(uint256(mine) < uint256(delta) ? uint256(mine) : uint256(delta));
        }
        try lpRouter.modifyLiquidity(env.key, p, "") {}
        catch {
            liquidityBlocked = true;
        }
    }

    function breakReference(uint256 mode) external {
        mode = bound(mode, 0, 2);
        env.feed.setReverts(mode == 1);
        env.feed.set(int256(3_000e8), mode == 2 ? block.timestamp - 7_200 : block.timestamp);
    }

    function nextBlock(uint256 seconds_) external {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + bound(seconds_, 0, 30));
    }

    function claim(uint256 who, bool asClaims) external {
        if (recipients.length == 0) return;
        address r = recipients[bound(who, 0, recipients.length - 1)];
        for (uint256 i; i < 2; ++i) {
            Currency c = i == 0 ? env.key.currency0 : env.key.currency1;
            if (env.ledger.owed(r, c) == 0) continue;
            vm.prank(r);
            if (asClaims) env.ledger.claimAsClaims(c, r);
            else env.ledger.claim(c, r);
        }
    }

    // --- views for the invariants --------------------------------------------------------------

    function openCount() external view returns (uint256) {
        return open.length;
    }

    function openRecord(uint256 i) external view returns (Record memory) {
        return open[i];
    }

    // --- internals -----------------------------------------------------------------------------

    function _recipient(uint256 seed) internal returns (address a) {
        a = address(uint160(uint256(keccak256(abi.encode(seed % 5, "recipient")))));
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == a) return a;
        }
        recipients.push(a);
    }

    function _collectRecords() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == DepositTaken.selector && logs[i].emitter == address(env.hook)) {
                open.push(abi.decode(logs[i].data, (Record)));
                ++recordsTaken;
            }
        }
    }

    function _close(uint256 index) internal {
        open[index] = open[open.length - 1];
        open.pop();
        ++recordsClosed;
    }

    /// @dev I3 and I7 for one settlement.
    function _checkPayout(Record memory r, Payout memory p, PoolState memory before) internal {
        uint256 pool = r.depositIn0 ? before.rebatePool0 : before.rebatePool1;
        if (p.benign) {
            if (p.refund != r.deposit || p.toLPs != 0 || p.toProtocol != 0 || p.toRebatePool != 0) {
                conservationBroken = true;
            }
            if (uint256(p.tip) + p.rebate > pool) rebateRuleBroken = true;
            rebatesPaid += uint256(p.tip) + p.rebate;
        } else {
            uint256 sum = uint256(p.refund) + p.tip + p.toProtocol + p.toRebatePool + p.toLPs;
            if (sum != r.deposit || p.rebate != 0) conservationBroken = true;
            rebateInflows += p.toRebatePool;
        }
    }

    /// @dev Fair price near the pool's current price, in 1e-8 quote per whole risky token.
    function _fairPrice8(uint256 moveBps, bool up) internal view returns (int64) {
        (uint160 s,,,) = env.manager.getSlot0(env.key.toId());
        uint256 x36 = PriceLib.poolPriceX36(s, !env.quoteIs0);
        uint256 usd8 = x36 * 10 ** env.decRisky * 1e8 / (10 ** env.decQuote * 1e36);
        usd8 = up ? usd8 * (10_000 + moveBps) / 10_000 : usd8 * (10_000 - moveBps) / 10_000;
        if (usd8 > uint256(uint64(type(int64).max))) return 0;
        return int64(int256(usd8));
    }

    function _myLiquidity(ModifyLiquidityParams memory p) internal view returns (uint128 l) {
        (l,,) = env.manager.getPositionInfo(env.key.toId(), address(lpRouter), p.tickLower, p.tickUpper, p.salt);
    }
}

contract TouchstoneInvariantTest is TouchstoneFixture {
    Handler internal handler;

    function setUp() public {
        _setUp(18, 6);
        Handler.Env memory e = Handler.Env({
            manager: manager,
            hook: hook,
            settler: settler,
            ledger: ledger,
            swapRouter: swapRouter,
            pyth: pyth,
            feed: feed,
            key: key,
            quoteIs0: quoteIs0,
            decRisky: decRisky,
            decQuote: decQuote,
            baseId: BASE_ID,
            quoteId: QUOTE_ID
        });
        handler = new Handler(e);
        targetContract(address(handler));
        // One of the handler's five recipients is blocklisted by both tokens, as USDC can do: every transfer to
        // it reverts, so its tips and refunds can only wait in the ledger (audit TOK-1, TOK-2).
        address blocked = address(uint160(uint256(keccak256(abi.encode(uint256(4), "recipient")))));
        for (uint256 i; i < 2; ++i) {
            address token = Currency.unwrap(i == 0 ? key.currency0 : key.currency1);
            vm.mockCallRevert(token, abi.encodeWithSelector(IERC20Minimal.transfer.selector, blocked), "blocked");
        }
        // tx.origin is an EOA on chain and can never be one of these contracts.
        excludeSender(address(hook));
        excludeSender(address(manager));
        excludeSender(address(ledger));
    }

    /// @dev I1: the hook's claims equal outstanding + vest + rebate pool, per currency.
    function invariant_I1_HookClaimsBalance() public view {
        PoolState memory st = hook.poolState(id);
        assertEq(
            manager.balanceOf(address(hook), key.currency0.toId()), uint256(st.outstanding0) + st.vest0 + st.rebatePool0
        );
        assertEq(
            manager.balanceOf(address(hook), key.currency1.toId()), uint256(st.outstanding1) + st.vest1 + st.rebatePool1
        );
    }

    /// @dev I2: the ledger's claims cover everything it owes, per currency.
    function invariant_I2_LedgerSolvent() public view {
        assertGe(manager.balanceOf(address(ledger), key.currency0.toId()), ledger.totalOwed(key.currency0));
        assertGe(manager.balanceOf(address(ledger), key.currency1.toId()), ledger.totalOwed(key.currency1));
    }

    /// @dev I3, I6, I7.
    function invariant_I3_I6_I7_Payouts() public view {
        assertFalse(handler.conservationBroken(), "I3");
        assertFalse(handler.expiryPaidExtra(), "I6");
        assertFalse(handler.rebateRuleBroken(), "I7");
        assertLe(handler.rebatesPaid(), handler.rebateInflows(), "I7 total");
    }

    /// @dev I5: every open record's hash is live, and taken = open + closed.
    function invariant_I5_RecordsCloseOnce() public view {
        uint256 n = handler.openCount();
        assertEq(handler.recordsTaken(), n + handler.recordsClosed());
        for (uint256 i; i < n; ++i) {
            Record memory r = handler.openRecord(i);
            assertTrue(hook.recordHash(id, r.id) != bytes32(0));
        }
    }

    /// @dev I9 and I10.
    function invariant_I9_I10_NeverBlocks() public view {
        assertFalse(handler.liquidityBlocked(), "I9");
        assertFalse(handler.swapRevertedOnDependency(), "I10");
        assertFalse(handler.recordBlocked(), "I10 records");
    }

    /// @dev I17: outside creditRent the hook holds no ERC-20 balance.
    function invariant_I17_NoTokensInHook() public view {
        assertEq(key.currency0.balanceOf(address(hook)), 0);
        assertEq(key.currency1.balanceOf(address(hook)), 0);
    }
}
