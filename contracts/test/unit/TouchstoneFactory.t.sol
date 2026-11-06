// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/libraries/LPFeeLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TouchstoneFixture} from "../utils/TouchstoneFixture.sol";
import {ITouchstoneErrors} from "../../src/interfaces/ITouchstoneErrors.sol";
import {PoolConfig, PoolFlags} from "../../src/types/PoolConfig.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {TouchstoneFactory} from "../../src/TouchstoneFactory.sol";

contract TouchstoneFactoryTest is TouchstoneFixture {
    PoolKey internal fresh;

    function setUp() public {
        _setUp(18, 6);
        fresh = key;
        fresh.tickSpacing = 10;
    }

    function _expectField(PoolConfig memory c, uint8 field) internal {
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, field));
        factory.createPool(fresh, c, noLease(), _sqrtPriceAt(ETH_USD));
    }

    function test_CreatePool_StoresConfigWithChainDecimals() public view {
        PoolConfig memory c = factory.poolConfig(id);
        (uint8 d0, uint8 d1) = quoteIs0 ? (decQuote, decRisky) : (decRisky, decQuote);
        assertEq(c.decimals0, d0);
        assertEq(c.decimals1, d1);
        assertEq(c.n0, defaultConfig().n0);
    }

    function test_CreatePool_RejectsForeignHook() public {
        fresh.hooks = IHooks(address(0));
        _expectField(defaultConfig(), 33);
    }

    function test_CreatePool_RejectsDynamicFee() public {
        fresh.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        vm.expectRevert(ITouchstoneErrors.Touchstone__DynamicFeeNotSupported.selector);
        factory.createPool(fresh, defaultConfig(), noLease(), _sqrtPriceAt(ETH_USD));
    }

    /// @dev Spec §14 licence bounds: K from 60 s to 7 days, increment 1% to 50%, a non-zero reserve.
    function test_CreatePool_LicenceLeaseBounds() public {
        PoolConfig memory c = defaultConfig();
        c.flags |= PoolFlags.LICENCE;
        ILicenceAuction.LeaseParams memory l = ILicenceAuction.LeaseParams({k: 60, minIncrementBps: 1_000, minRent: 1});
        uint160 p = _sqrtPriceAt(ETH_USD);

        l.k = 59;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(35)));
        factory.createPool(fresh, c, l, p);
        l.k = 7 days + 1;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(35)));
        factory.createPool(fresh, c, l, p);
        l.k = 60;
        l.minIncrementBps = 99;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(36)));
        factory.createPool(fresh, c, l, p);
        l.minIncrementBps = 5_001;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(36)));
        factory.createPool(fresh, c, l, p);
        l.minIncrementBps = 1_000;
        l.minRent = 0;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__ConfigOutOfBounds.selector, uint8(37)));
        factory.createPool(fresh, c, l, p);

        l.minRent = 1;
        factory.createPool(fresh, c, l, p);
        assertTrue(factory.poolConfig(fresh.toId()).flags & PoolFlags.LICENCE != 0);
        assertEq(licence.minNextRent(fresh.toId()), 1, "registered with the auction");
    }

    function test_CreatePool_LicenceNeedsAnAuction() public {
        TouchstoneFactory bare = new TouchstoneFactory(manager, hook, ILicenceAuction(address(0)));
        PoolConfig memory c = defaultConfig();
        c.flags |= PoolFlags.LICENCE;
        vm.expectRevert(abi.encodeWithSelector(ITouchstoneErrors.Touchstone__LicenceDisabled.selector, fresh.toId()));
        bare.createPool(fresh, c, ILicenceAuction.LeaseParams({k: 60, minIncrementBps: 1_000, minRent: 1}), 1);
    }

    /// @dev Rent is paid in the quote token, so a pool whose quote side is the native token cannot be a licence pool.
    function test_CreatePool_LicenceNeedsAnErc20Quote() public {
        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: quote,
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        PoolConfig memory c = defaultConfig();
        c.flags |= PoolFlags.QUOTE_IS_0 | PoolFlags.LICENCE;
        vm.expectRevert(ITouchstoneErrors.Touchstone__QuoteNotErc20.selector);
        factory.createPool(k, c, ILicenceAuction.LeaseParams({k: 60, minIncrementBps: 1_000, minRent: 1}), 1);
    }

    function test_Bounds_EachField() public {
        PoolConfig memory c;
        c = defaultConfig();
        c.n0 = 0;
        _expectField(c, 0);
        c = defaultConfig();
        c.n0 = c.nMin + 1;
        _expectField(c, 1);
        c = defaultConfig();
        c.flowHorizon = 3_601;
        _expectField(c, 2);
        c = defaultConfig();
        c.flags = 16; // an unknown bit; 8 is CALENDAR, which the factory sets itself
        _expectField(c, 3);
        c = defaultConfig();
        c.tauBps = 101;
        _expectField(c, 4);
        c = defaultConfig();
        c.referenceMaxAge = 59;
        _expectField(c, 5);
        c = defaultConfig();
        c.deltaBps = 4;
        _expectField(c, 6);
        c = defaultConfig();
        c.deltaMaxBps = 29;
        _expectField(c, 7);
        c = defaultConfig();
        c.betaX100 = 99;
        _expectField(c, 8);
        c = defaultConfig();
        c.calendar = address(1);
        _expectField(c, 9);
        c = defaultConfig();
        c.deltaClosedBps = 2_001;
        _expectField(c, 10);
        c = defaultConfig();
        c.maxConfBps = 0;
        _expectField(c, 11);
        c = defaultConfig();
        c.bandBps = 501;
        _expectField(c, 12);
        c = defaultConfig();
        c.quotePriceId = 0;
        _expectField(c, 13);
        c = defaultConfig();
        c.settleDelay = 61;
        _expectField(c, 14);
        c = defaultConfig();
        c.maxLag = c.window;
        _expectField(c, 15);
        c = defaultConfig();
        c.window = 7 days + 1;
        _expectField(c, 16);
        c = defaultConfig();
        c.openDelay = 3_601;
        _expectField(c, 17);
        c = defaultConfig();
        c.maxLagClosed = c.windowClosed;
        _expectField(c, 18);
        c = defaultConfig();
        c.windowClosed = 1 hours - 1;
        _expectField(c, 19);
        c = defaultConfig();
        c.alphaBps = 9_501;
        _expectField(c, 20);
        c = defaultConfig();
        c.epsBps = 51;
        _expectField(c, 21);
        c = defaultConfig();
        c.alphaLicensedBps = c.alphaBps - 1;
        _expectField(c, 22);
        c = defaultConfig();
        c.alphaClosedBps = c.alphaBps + 1;
        _expectField(c, 23);
        c = defaultConfig();
        c.epsClosedBps = c.epsBps - 1;
        _expectField(c, 24);
        c = defaultConfig();
        c.jumpRefundBps = 9_001;
        _expectField(c, 25);
        c = defaultConfig();
        c.tipBps = 2_001;
        _expectField(c, 26);
        c = defaultConfig();
        c.rhoBps = 3_001;
        _expectField(c, 27);
        c = defaultConfig();
        c.kappaBps = 9_001;
        _expectField(c, 28);
        c = defaultConfig();
        c.vestPeriod = 59;
        _expectField(c, 29);
        c = defaultConfig();
        c.tipCap = 0;
        _expectField(c, 30);
        c = defaultConfig();
        c.maxOutstanding = 0;
        _expectField(c, 31);
        c = defaultConfig();
        c.protocolShareBps = 100;
        _expectField(c, 32);
    }

    function test_Bounds_NoReferenceSkipsMaxAge() public {
        PoolConfig memory c = defaultConfig();
        c.referenceFeed = address(0);
        c.referenceMaxAge = 0;
        factory.createPool(fresh, c, noLease(), _sqrtPriceAt(ETH_USD));
        assertEq(factory.poolConfig(fresh.toId()).referenceFeed, address(0));
    }
}
