// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {NyseCalendar} from "../../src/calendar/NyseCalendar.sol";

/// @notice Deploys NyseCalendar from script/config/nyse-2026-2028.json, the data a deployment uses.
library NyseData {
    string internal constant CONFIG = "script/config/nyse-2026-2028.json";

    function deploy(Vm vm) internal returns (NyseCalendar) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory json = vm.readFile(CONFIG);
        return new NyseCalendar(
            uint32(vm.parseJsonUint(json, ".firstDay")),
            uint32(vm.parseJsonUint(json, ".lastDay")),
            _u32(vm.parseJsonUintArray(json, ".holidays")),
            _u32(vm.parseJsonUintArray(json, ".earlyCloses"))
        );
    }

    function _u32(uint256[] memory a) private pure returns (uint32[] memory out) {
        out = new uint32[](a.length);
        for (uint256 i; i < a.length; ++i) {
            out[i] = uint32(a[i]);
        }
    }
}
