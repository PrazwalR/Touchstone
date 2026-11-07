import { useEffect, useState } from "react";
import { priceQuotePerRiskyE6, type Snapshot } from "../chain/reads.ts";
import type { Live } from "../chain/useLive.ts";
import { swapContext } from "./context.ts";
import { impactBlock } from "./impactGuard.ts";
import { signedGapBps } from "./arbitrage.ts";
import { readReference } from "./reference.ts";
import { shortError, type Side } from "./swap.ts";

export type Reference = Awaited<ReturnType<typeof readReference>>;

/** The Chainlink reference read at the same block as the pool snapshot, so the two prices always agree on time. */
export function useReference(snapshot: Snapshot | null): { ref: Reference | null; error: string | null } {
  const [state, setState] = useState<{ block: bigint; ref: Reference | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void readReference(swapContext, snapshot).then(
      (ref) => { if (!cancelled) setState({ block: snapshot.blockNumber, ref, error: null }); },
      (err) => { if (!cancelled) setState({ block: snapshot.blockNumber, ref: null, error: shortError(err) }); },
    );
    return () => { cancelled = true; };
  }, [snapshot]);
  return state?.block === snapshot?.blockNumber
    ? { ref: state?.ref ?? null, error: state?.error ?? null }
    : { ref: null, error: null };
}

/** Gap beyond which the pool is treated as out of range, in basis points. */
export const OUT_OF_RANGE_BPS = 500n;

/**
 * One rule for every page that swaps on the shared testnet pool: a trade that costs more than 5% of price is
 * refused, except one that moves an out-of-range pool back toward the Chainlink reference. With no reference
 * the pool is assumed healthy, so a large trade is refused.
 */
export function usePoolGuard(live: Live) {
  const { ref } = useReference(live.error ? null : live.snapshot);
  const s = live.snapshot;
  const poolE6 = s ? priceQuotePerRiskyE6(s.sqrtPriceX96) : null;
  const buyGap = ref && poolE6 !== null ? signedGapBps(ref.priceE6, poolE6, "buy") : null;
  const toward: Side = buyGap !== null && buyGap < 0n ? "sell" : "buy";
  const absGap = buyGap === null ? null : buyGap < 0n ? -buyGap : buyGap;
  const outOfRange = absGap !== null && absGap > OUT_OF_RANGE_BPS;
  const blockReason = (trade: { side: Side; impactBps: number }) => impactBlock(trade, { outOfRange, toward });
  return { blockReason, outOfRange, absGap };
}
