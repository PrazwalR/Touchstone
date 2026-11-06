# 0031 Swap path liveness at v4's price bounds

Status: fixed. Severity: high (a dependency of the swap path could revert every swap in one direction).

Found by: the deep invariant run (2,000 runs x 1,000 calls), invariant I10.

Root cause: after exact-output buys drain a pool to v4's price bound, a 1e36-scaled price reaches about 2^248.
`PriceLib.signedGapBps` computed (ref - pool) x 1e4 in int256, which overflows, so `afterSwap` panicked for every
large swap in the opposite direction. The comment that said it could not overflow was wrong.

Fix: `signedGapBps` saturates at 2^127 bps and is otherwise identical (fuzzed against the original formula; the
Python vectors are unchanged). `_withinCap` was rewritten so that no input can overflow (0025).

Regression: `test/adversarial/ExtremePriceReplay.t.sol` replays the shrunk 25-swap sequence plus the overflowing
sell. It fails with the old `signedGapBps` (panic 0x11 inside afterSwap) and passes with the fix.
