// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TouchstoneFactory} from "../src/TouchstoneFactory.sol";
import {ILicenceAuction} from "../src/interfaces/ILicenceAuction.sol";
import {PoolConfig, PoolFlags} from "../src/types/PoolConfig.sol";
import {PoolLiquidityVault} from "./support/PoolLiquidityVault.sol";
import {PoolSeeding} from "./support/PoolSeeding.sol";

/// @notice Creates the chain's demo pool from script/config/<CHAIN>.json on the core in deployments/<CHAIN>.json,
/// initialised at the Chainlink reference price, and seeds it with two positions held by a new PoolLiquidityVault: a
/// full-range backstop and a band centred on the reference price. Spec §19.2 and §19.3 step 3. The deployer must
/// hold both configured quote amounts and the matching risky amounts.
/// @dev The band is what makes testnet-sized swaps move the price by a realistic amount (decision 0067): a full-range
/// position of a faucet-sized budget lets one demonstration swap move the price by tens of percent. The vault is what
/// keeps anyone else from withdrawing it (decision 0070). To re-centre a pool after the market has moved, run
/// RecenterPool.
contract CreatePool is PoolSeeding {
    function run() external returns (PoolId id) {
        _loadPool();
        TouchstoneFactory factory = TouchstoneFactory(vm.parseJsonAddress(deployed, ".factory"));
        uint256 priceX36 = _referencePriceX36();
        uint160 sqrtP = _sqrtPrice(priceX36);
        Seed memory seed = _seed(priceX36, _u("liquidityQuote"));
        Band memory band = _band(sqrtP, _u("concentratedQuote"));
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        id = factory.createPool(key, _config(quoteIs0), _lease(), sqrtP);
        PoolLiquidityVault vault =
            new PoolLiquidityVault(IPoolManager(vm.parseJsonAddress(cfg, ".poolManager")), deployer);
        _addToVault(vault, seed, band);
        vm.stopBroadcast();
        _write(id, sqrtP, seed, band, address(vault));
    }

    function _write(PoolId id, uint160 sqrtP, Seed memory seed, Band memory band, address vault) internal {
        string memory o = "pool";
        vm.serializeBytes32(o, "poolId", PoolId.unwrap(id));
        vm.serializeAddress(o, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(o, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(o, "fee", key.fee);
        vm.serializeInt(o, "tickSpacing", key.tickSpacing);
        vm.serializeUint(o, "sqrtPriceX96", sqrtP);
        vm.serializeAddress(o, "vault", vault);
        vm.serializeInt(o, "bandTickLower", band.tickLower);
        vm.serializeInt(o, "bandTickUpper", band.tickUpper);
        vm.serializeUint(o, "bandLiquidity", band.liquidity);
        string memory pool = vm.serializeUint(o, "liquidity", seed.liquidity);
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(pool, deploymentPath, ".pool");
    }

    /// @dev A `pool.lease` section in the chain config makes the pool a licence pool (spec §10); without it the
    /// terms are ignored by the factory.
    function _lease() internal view returns (ILicenceAuction.LeaseParams memory l) {
        if (!vm.keyExistsJson(cfg, ".pool.lease")) return l;
        l.k = uint32(vm.parseJsonUint(cfg, ".pool.lease.k"));
        l.minIncrementBps = uint16(vm.parseJsonUint(cfg, ".pool.lease.minIncrementBps"));
        l.minRent = uint128(vm.parseJsonUint(cfg, ".pool.lease.minRent"));
    }

    function _config(bool quoteIsZero) internal view returns (PoolConfig memory c) {
        c.n0 = uint96(_u("n0"));
        c.nMin = uint96(_u("nMin"));
        c.flowHorizon = uint32(_u("flowHorizon"));
        c.flags = (quoteIsZero ? PoolFlags.QUOTE_IS_0 : 0)
            | (vm.parseJsonBool(cfg, ".pool.itmAccounting") ? PoolFlags.ITM_ACCOUNTING : 0)
            | (vm.keyExistsJson(cfg, ".pool.lease") ? PoolFlags.LICENCE : 0);
        c.tauBps = uint16(_u("tauBps"));
        c.referenceFeed = vm.parseJsonAddress(cfg, ".referenceFeed");
        c.referenceMaxAge = uint32(vm.parseJsonUint(cfg, ".referenceMaxAge"));
        c.deltaBps = uint16(_u("deltaBps"));
        c.deltaMaxBps = uint16(_u("deltaMaxBps"));
        c.betaX100 = uint16(_u("betaX100"));
        c.deltaClosedBps = uint16(_u("deltaClosedBps"));
        c.maxConfBps = uint16(_u("maxConfBps"));
        c.bandBps = uint16(_u("bandBps"));
        c.basePriceId = vm.parseJsonBytes32(cfg, ".basePriceId");
        c.quotePriceId = vm.parseJsonBytes32(cfg, ".quotePriceId");
        c.settleDelay = uint32(_u("settleDelay"));
        c.maxLag = uint32(_u("maxLag"));
        c.window = uint32(_u("window"));
        c.openDelay = uint32(_u("openDelay"));
        c.maxLagClosed = uint32(_u("maxLagClosed"));
        c.windowClosed = uint32(_u("windowClosed"));
        c.alphaBps = uint16(_u("alphaBps"));
        c.epsBps = uint16(_u("epsBps"));
        c.alphaLicensedBps = uint16(_u("alphaLicensedBps"));
        c.alphaClosedBps = uint16(_u("alphaClosedBps"));
        c.epsClosedBps = uint16(_u("epsClosedBps"));
        c.jumpRefundBps = uint16(_u("jumpRefundBps"));
        c.tipBps = uint16(_u("tipBps"));
        c.rhoBps = uint16(_u("rhoBps"));
        c.kappaBps = uint16(_u("kappaBps"));
        c.vestPeriod = uint32(_u("vestPeriod"));
        c.tipCap = uint128(_u("tipCap"));
        c.maxOutstanding = uint128(_u("maxOutstanding"));
        c.protocolShareBps = uint16(_u("protocolShareBps"));
        c.protocolRecipient = vm.parseJsonAddress(cfg, ".pool.protocolRecipient");
    }
}
