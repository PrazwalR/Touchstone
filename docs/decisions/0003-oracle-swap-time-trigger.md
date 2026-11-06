# 0003 Oracle for the swap-time trigger (spec D-3)

Status: closed by the owners on 25 October 2026.

Choice: the spec default. A Chainlink push feed drives the drift trigger (and, from M9, the licence fast path);
Pyth drives settlement only. The read lives entirely in `ReferenceLib`, so moving to the Pyth-only alternative
(stored price plus an age check, keeper-pushed) later changes one library and one immutable.

`ReferenceLib.readX36` never reverts: a reverting feed, a non-positive answer, an answer from the future, one
older than `referenceMaxAge`, or an unconvertible exponent all return `ok = false`, and the hook treats the
reference as absent. An optional sequencer uptime feed (`SEQUENCER_FEED`, `SEQUENCER_GRACE` immutables, zero to
skip) does the same on L2s.
