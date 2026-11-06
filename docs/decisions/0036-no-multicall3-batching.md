# 0036 Settlements are not batched through Multicall3

Status: **open, needs the owners**: it touches money flow (§0.11 rule 3).

Context: spec §15.1 step 6 batches settlements through Multicall3's `aggregate3Value`. `Settler.settle` pays the
tip to `msg.sender` (`Payout.tipTo = msg.sender`). Inside a Multicall3 batch, `msg.sender` is the Multicall3
contract, so every tip would be paid to Multicall3, where anyone can sweep it with a crafted call.

Current choice: the M5 keeper sends one settlement per transaction. A lost race costs one simulated call, as
before; the cost is one transaction's base fee per record.

Options for the owners:
1. Add `settleFor(Record, bytes[], address tipTo)` to the Settler. Smallest change; anyone can still settle,
   and the caller names where its own tip goes. It does not let anyone take another caller's tip.
2. A periphery `SettleBatcher` that loops `settle` and forwards the tips it receives to its caller. No Settler
   change, but it needs per-currency balance accounting and is a second contract to audit.
3. Keep one transaction per settlement. On L2s the per-transaction overhead is small.

Recommendation: option 1 before the M8 deployment, since the Settler has no deployment to stay compatible with.
