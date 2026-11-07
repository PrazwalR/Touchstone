import type { Side } from "./swap.ts";

/** Price impact above which the Simulation page refuses a trade: 5% of price, in basis points. */
export const BLOCK_IMPACT_BPS = 500;

/**
 * The pool is small, so one typed amount can push its price to single digits and break the demonstration for
 * everyone. A trade costing more than the limit is refused, except one that moves an already broken pool back
 * toward the reference. Returns the message to show, or null when the trade may proceed.
 */
export function impactBlock(trade: { side: Side; impactBps: number }, pool: { outOfRange: boolean; toward: Side }): string | null {
  if (trade.impactBps <= BLOCK_IMPACT_BPS) return null;
  if (pool.outOfRange && trade.side === pool.toward) return null;
  return pool.outOfRange
    ? "The pool is far from the Chainlink price. Until it is restored, only a trade toward the reference is allowed."
    : "This pool's liquidity is limited and a trade this large would push its price far from the market. Use a prepared trade or a smaller amount.";
}
