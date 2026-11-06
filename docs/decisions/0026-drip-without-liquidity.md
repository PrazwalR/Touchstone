# 0026 Drip with no in-range liquidity

Status: decided; implementation detail of §8.4.

The spec says the amount waits when in-range liquidity is zero. If the vesting clock kept running during the wait,
the first position to come back into range would receive the whole buffer at once, which is the JIT capture §8.4
exists to prevent (T8). So every drip attempt restarts the clock, and once liquidity returns the waiting amount
vests over a fresh period. Tested by `test_Drip_WaitsWithoutInRangeLiquidity`.
