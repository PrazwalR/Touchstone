import { useEffect, useState } from "react";
import { formatUnits, type Hex } from "viem";
import { confirmedReasons } from "../swap/recordSettlement.ts";
import { deployment, explorerTx } from "../chain/deployment.ts";
import { units } from "../format.ts";
import { TRIGGERS } from "../swap/arbitrage.ts";
import { swapContext } from "../swap/context.ts";
import { confirmSwap, shortError, tokenIn, tokenOut, type Side, type SwapResult } from "../swap/swap.ts";
import type { TrackedRecord } from "../swap/useSwapFlow.ts";
import { RecordTracker } from "./RecordTracker.tsx";

export interface ActivityEntry { hash: Hex; side: Side }
const storageKey = `touchstone.activity:${deployment.chainId}:${swapContext.poolId}`;

export function readActivity(): ActivityEntry[] {
  try {
    const rows: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(rows) ? rows.filter((r) => r && /^0x[0-9a-f]{64}$/i.test(r.hash) && ["buy", "sell"].includes(r.side)).slice(0, 20) : [];
  } catch { return []; }
}

export function rememberActivity(rows: ActivityEntry[]) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(rows)); } catch { /* In-memory activity still works. */ }
}

export function SimulationActivity({ entry, confirmed }: { entry: ActivityEntry; confirmed: SwapResult | null }) {
  const [loaded, setLoaded] = useState<SwapResult | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (confirmed) return;
    let cancelled = false;
    void confirmSwap(swapContext, entry.side, entry.hash).then(
      (r) => { if (!cancelled) setLoaded(r); },
      (err) => { if (!cancelled) setError(shortError(err)); },
    );
    return () => { cancelled = true; };
  }, [entry.hash, entry.side, confirmed, attempt]);
  const result = confirmed ?? loaded;
  if (!result) return <p role="status">{error || "Reading the confirmed swap…"} {error && <button type="button" onClick={() => { setError(""); setAttempt(attempt + 1); }}>Retry</button>}</p>;
  return <TradeReceipt result={result} side={entry.side} />;
}

function TradeReceipt({ result, side }: { result: SwapResult; side: Side }) {
  const r = result.record;
  const [tracked, setTracked] = useState<TrackedRecord | null>(() => r && ({
    poolId: r.poolId, recordId: r.id, fromBlock: result.receipt.blockNumber, timestamp: r.timestamp,
    deposit: r.deposit, depositIn0: r.depositIn0, outcome: { kind: "open" },
  }));
  // Presentation delay starts at execution. Historical receipts reveal their review immediately.
  const [showReview, setShowReview] = useState(() => !!r && Date.now() >= (r.timestamp + 3) * 1000);
  useEffect(() => {
    if (!r || showReview) return;
    const timer = setTimeout(() => setShowReview(true), Math.max(0, (r.timestamp + 3) * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [r, showReview]);
  const input = tokenIn(swapContext, side);
  const output = tokenOut(swapContext, side);
  const mask = r ? confirmedReasons(swapContext.hook, result.receipt, r.poolId, r.id) : null;
  const heldToken = r?.depositIn0 === (swapContext.key.currency0.toLowerCase() === swapContext.quote.address.toLowerCase()) ? swapContext.quote : swapContext.risky;
  return <article className="sim-settle" aria-label="Trade receipt">
    <div className="trade-confirmed" role="status">
      <strong>Swap confirmed</strong>
      <p>Paid {units(result.paid, input.decimals, 8)} {input.symbol} · received {units(result.received, output.decimals, 8)} {output.symbol}</p>
      <a href={explorerTx(result.hash)} target="_blank" rel="noreferrer">View swap transaction ↗</a>
      {!r && <p>Complete. The hook collected no deposit.</p>}
    </div>
    {showReview && r && tracked && <>
      <div className="trade-confirmed" role="status">
        <strong>Trade flagged for settlement review</strong>
        <p>{formatUnits(r.deposit, heldToken.decimals)} {heldToken.symbol} was held during the swap.</p>
        <p>{mask !== null ? TRIGGERS.filter((v) => mask & v.bit).map((v) => v.name + " — " + v.detail).join(" · ")
          : r.mode === 1 ? "Closed-market record. This receipt has no individual trigger flags."
          : "The swap receipt confirms a deposit. This version of the hook did not record individual trigger reasons."}</p>
      </div>
      <RecordTracker ctx={swapContext} tracked={tracked} onChange={setTracked} />
    </>}
  </article>;
}
