// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery-test/shared/HookMiner.sol";
import {RebateLedger} from "../../src/RebateLedger.sol";
import {TouchstoneFactory} from "../../src/TouchstoneFactory.sol";
import {LicenceAuction} from "../../src/LicenceAuction.sol";
import {ILicenceAuction} from "../../src/interfaces/ILicenceAuction.sol";
import {ITouchstoneHook} from "../../src/interfaces/ITouchstoneHook.sol";
import {ISettler} from "../../src/interfaces/ISettler.sol";
import {GuardedRouter} from "../../src/periphery/GuardedRouter.sol";
import {TouchstoneLens} from "../../src/periphery/TouchstoneLens.sol";
import {ITouchstoneFactory} from "../../src/interfaces/ITouchstoneFactory.sol";

/// @notice Deploys the Touchstone core in the order of spec §14.6. The support contracts and the hook point at
/// each other, so CREATE2 alone cannot predict both sides: the ledger, factory and Settler are predicted from the
/// deployer's nonces, the hook's CREATE2 salt is mined with those addresses in its init code, the support contracts
/// are deployed with the hook's predicted address, and the hook is deployed last through the deterministic
/// CREATE2 deployer. Every address is checked against its prediction. GuardedRouter is deployed with the support
/// contracts and takes the hook's first trusted-router slot; the config's slot 0 is ignored (spec §12.4). The
/// LicenceAuction and the TouchstoneLens come last among the support contracts; the auction and the factory name
/// each other (M9), and the hook forwards its quotes to the lens (M10).
/// @dev The hook and the Settler are created from their artifacts, because they compile under their own
/// profiles (decision 0028) and cannot be imported alongside the other contracts.
abstract contract CoreDeployer is Script {
    /// @dev The CREATE2 Deployer Proxy present on every chain Touchstone targets and in anvil.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    error CoreDeployer__NonceMoved(uint256 expected, uint256 actual);
    error CoreDeployer__AddressMismatch(string what, address predicted, address actual);
    error CoreDeployer__Create2Failed();

    struct CoreParams {
        IPoolManager manager;
        address pyth;
        uint8 blockSource;
        address sequencerFeed;
        uint32 sequencerGrace;
        address[4] trustedRouters;
        uint16 maxQuoteTicks;
    }

    struct Core {
        address hook;
        address settler;
        address ledger;
        address factory;
        address router;
        address licence;
        address lens;
        bytes32 salt;
    }

    /// @notice Deploys the core from `deployer`, which must send no other transaction meanwhile.
    function _deployCore(address deployer, CoreParams memory p) internal returns (Core memory c) {
        uint64 nonce = vm.getNonce(deployer);
        c.ledger = vm.computeCreateAddress(deployer, nonce);
        c.factory = vm.computeCreateAddress(deployer, nonce + 1);
        c.settler = vm.computeCreateAddress(deployer, nonce + 2);
        c.router = vm.computeCreateAddress(deployer, nonce + 3);
        c.licence = vm.computeCreateAddress(deployer, nonce + 4);
        c.lens = vm.computeCreateAddress(deployer, nonce + 5);
        address[4] memory routers = [c.router, p.trustedRouters[1], p.trustedRouters[2], p.trustedRouters[3]];

        bytes memory hookArgs = abi.encode(
            p.manager,
            c.settler,
            c.ledger,
            c.factory,
            c.licence,
            c.lens,
            p.blockSource,
            p.sequencerFeed,
            p.sequencerGrace,
            routers
        );
        bytes memory hookCode = vm.getCode("TouchstoneHook.sol:TouchstoneHook");
        (c.hook, c.salt) = HookMiner.find(CREATE2_DEPLOYER, HOOK_FLAGS, hookCode, hookArgs);

        vm.startBroadcast(deployer);
        if (vm.getNonce(deployer) != nonce) revert CoreDeployer__NonceMoved(nonce, vm.getNonce(deployer));
        address ledger = address(new RebateLedger(p.manager, c.hook));
        address factory = address(new TouchstoneFactory(p.manager, ITouchstoneHook(c.hook), ILicenceAuction(c.licence)));
        address settler = deployCode("Settler.sol:Settler", abi.encode(p.pyth, c.hook, c.factory));
        address router = address(new GuardedRouter(p.manager, ITouchstoneHook(c.hook)));
        address licence = address(new LicenceAuction(p.manager, ITouchstoneHook(c.hook), c.factory));
        address lens = address(
            new TouchstoneLens(p.manager, ITouchstoneHook(c.hook), ITouchstoneFactory(c.factory), p.maxQuoteTicks)
        );
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(c.salt, hookCode, hookArgs));
        vm.stopBroadcast();

        if (!ok || c.hook.code.length == 0) revert CoreDeployer__Create2Failed();
        _check("ledger", c.ledger, ledger);
        _check("factory", c.factory, factory);
        _check("settler", c.settler, settler);
        _check("router", c.router, router);
        _check("licence", c.licence, licence);
        _check("lens", c.lens, lens);
        // The hook trusts these three addresses for life; prove each points back at it (audit TOK-8).
        _check("ledger.HOOK", c.hook, RebateLedger(ledger).HOOK());
        _check("factory.HOOK", c.hook, address(TouchstoneFactory(factory).HOOK()));
        _check("settler.HOOK", c.hook, address(ISettler(settler).HOOK()));
        _check("router.HOOK", c.hook, address(GuardedRouter(router).HOOK()));
        _check("licence.HOOK", c.hook, address(LicenceAuction(licence).HOOK()));
        _check("licence.FACTORY", c.factory, address(LicenceAuction(licence).FACTORY()));
        _check("factory.LICENCE", c.licence, address(TouchstoneFactory(factory).LICENCE()));
        _check("lens.HOOK", c.hook, address(TouchstoneLens(lens).HOOK()));
        _check("lens.FACTORY", c.factory, address(TouchstoneLens(lens).FACTORY()));
    }

    function _check(string memory what, address predicted, address actual) private pure {
        if (predicted != actual) revert CoreDeployer__AddressMismatch(what, predicted, actual);
    }
}
