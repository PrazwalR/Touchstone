// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CoreDeployer} from "./base/CoreDeployer.sol";

/// @notice Deploys the Touchstone core on the chain named by CHAIN, from script/config/<CHAIN>.json, and writes the
/// addresses to deployments/<CHAIN>.json. Spec §19.2. Run with an encrypted keystore, never a raw key:
///   CHAIN=arbitrum-sepolia forge script script/DeployCore.s.sol --rpc-url $ARBITRUM_SEPOLIA_RPC_URL \
///     --account touchstone-deployer --sender <deployer address> --broadcast --slow
contract DeployCore is CoreDeployer {
    error DeployCore__WrongChain(uint256 expected, uint256 actual);
    /// @dev Foundry's built-in sender, used when --sender is missing; deploying from it would plan the wrong addresses.
    error DeployCore__DefaultSender();

    address internal constant FOUNDRY_DEFAULT_SENDER = 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38;

    function run() external returns (Core memory c) {
        string memory chain = vm.envString("CHAIN");
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory cfg = vm.readFile(string.concat("script/config/", chain, ".json"));
        uint256 chainId = vm.parseJsonUint(cfg, ".chainId");
        if (block.chainid != chainId) revert DeployCore__WrongChain(chainId, block.chainid);
        if (msg.sender == FOUNDRY_DEFAULT_SENDER) revert DeployCore__DefaultSender();

        address[] memory routers = vm.parseJsonAddressArray(cfg, ".trustedRouters");
        CoreParams memory p = CoreParams({
            manager: IPoolManager(vm.parseJsonAddress(cfg, ".poolManager")),
            pyth: vm.parseJsonAddress(cfg, ".pyth"),
            blockSource: uint8(vm.parseJsonUint(cfg, ".blockSource")),
            sequencerFeed: vm.parseJsonAddress(cfg, ".sequencerFeed"),
            sequencerGrace: uint32(vm.parseJsonUint(cfg, ".sequencerGrace")),
            trustedRouters: [routers[0], routers[1], routers[2], routers[3]],
            maxQuoteTicks: uint16(vm.parseJsonUint(cfg, ".maxQuoteTicks"))
        });
        c = _deployCore(msg.sender, p);

        string memory o = "core";
        vm.serializeUint(o, "chainId", chainId);
        vm.serializeAddress(o, "deployer", msg.sender);
        vm.serializeAddress(o, "hook", c.hook);
        vm.serializeAddress(o, "settler", c.settler);
        vm.serializeAddress(o, "ledger", c.ledger);
        vm.serializeAddress(o, "factory", c.factory);
        vm.serializeAddress(o, "guardedRouter", c.router);
        vm.serializeAddress(o, "licenceAuction", c.licence);
        vm.serializeAddress(o, "lens", c.lens);
        // No block number here: on Arbitrum, block.number is L1-based. The keeper and indexer start blocks come
        // from the broadcast receipts (broadcast/DeployCore.s.sol/<chainId>/run-latest.json).
        string memory json = vm.serializeBytes32(o, "salt", c.salt);
        // A simulation plans addresses from whatever --sender it was given; writing them to deployments/ would leave
        // a file that reads as a real deployment. Simulations write only to an explicit DEPLOYMENT_OUT.
        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (!broadcast && bytes(vm.envOr("DEPLOYMENT_OUT", string(""))).length == 0) return c;
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vm.writeJson(json, _out(chain));
    }

    function _out(string memory chain) internal view returns (string memory) {
        return vm.envOr("DEPLOYMENT_OUT", string.concat("deployments/", chain, ".json"));
    }
}
