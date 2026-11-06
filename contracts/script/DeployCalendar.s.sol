// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {NyseCalendar} from "../src/calendar/NyseCalendar.sol";

/// @notice Deploys NyseCalendar from script/config/nyse-2026-2028.json (NYSE's published holidays and early
/// closes) and records its address in deployments/<CHAIN>.json under `.nyseCalendar`. Calendar pools name it in
/// their config; it has no owner and no dependency on the core, so it can be deployed at any time.
contract DeployCalendar is Script {
    string internal constant DATA = "script/config/nyse-2026-2028.json";

    function run() external returns (NyseCalendar cal) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(DATA);
        uint256[] memory h = vm.parseJsonUintArray(json, ".holidays");
        uint256[] memory e = vm.parseJsonUintArray(json, ".earlyCloses");
        vm.startBroadcast();
        cal = new NyseCalendar(
            uint32(vm.parseJsonUint(json, ".firstDay")), uint32(vm.parseJsonUint(json, ".lastDay")), _u32(h), _u32(e)
        );
        vm.stopBroadcast();
        string memory path = vm.envOr("DEPLOYMENT_OUT", string.concat("deployments/", vm.envString("CHAIN"), ".json"));
        // forge-lint: disable-next-line(unsafe-cheatcode)
        if (vm.isFile(path)) vm.writeJson(vm.toString(address(cal)), path, ".nyseCalendar");
    }

    function _u32(uint256[] memory a) internal pure returns (uint32[] memory out) {
        out = new uint32[](a.length);
        for (uint256 i; i < a.length; ++i) {
            out[i] = uint32(a[i]);
        }
    }
}
