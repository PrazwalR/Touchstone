# 0034 forge-std pinned to the local Foundry

Status: decided.

forge-std v1.17.0 declares `Vm.Gas` with fields that Foundry 1.5.1 (the version the reference pack was built with,
built 22 December 2025) does not return, so `vm.lastCallGas()` reverted on decode. forge-std v1.12.0 (26 November
2025) matches 1.5.1's cheatcodes. When CI moves to a newer Foundry tag, move forge-std with it.
