# 0028 Compiler profile for the hook and the Settler

Status: decided under spec §6.1 ("lower it if TouchstoneHook nears 24,576 bytes; record the choice").

Measured runtime size of TouchstoneHook (bytes): legacy 1,000,000 runs 29,326; legacy 200 runs 22,752; IR
1,000,000 runs 27,768; IR 200 runs 19,726. M7, M9 and M10 still add `previewDeposit`, the licence fast path and the
URC-4 forwarders, so the hook needs real headroom.

Choice: `compilation_restrictions` compile `src/TouchstoneHook.sol` through the IR pipeline at 200 runs, and
`src/Settler.sol` through IR at 1,000,000 runs (its settlement path exceeds the legacy stack limit). Everything
else keeps the spec's settings. Size at the end of M3: 20,257 bytes.

Consequence: a test file cannot import both restricted sources, so tests reach the hook and the Settler through
interfaces and deploy them from their artifacts (`deployCode`, `deployCodeTo`). Gas numbers in docs/gas.md are
for these settings.
