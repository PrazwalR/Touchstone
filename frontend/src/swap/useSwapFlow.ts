// The swap's life on the page: preview while typing, then approve, swap, and follow the record to its outcome.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseUnits, type Hex } from "viem";
import { POLL_MS } from "../config.ts";
import { useWallet } from "../wallet/WalletContext.tsx";
import { walletErrorText } from "../wallet/wallet.ts";
import {
  approveExact,
  executeSwap,
  guardFor,
  previewSwap,
  recordOutcome,
  shortError,
  tokenIn,
  tokenOut,
  type Guard,
  type Preview,
  type RecordOutcome,
  type Side,
  type SwapContext,
  type SwapResult,
} from "./swap.ts";

export type Phase = "idle" | "approving" | "signing" | "confirming" | "done" | "failed";

export interface TrackedRecord {
  poolId: Hex;
  recordId: bigint;
  fromBlock: bigint;
  timestamp: number;
  deposit: bigint;
  depositIn0: boolean;
  outcome: RecordOutcome;
}

const AMOUNT = /^(0|[1-9]\d{0,17})(\.\d{1,18})?$/;
const DEADLINE_S = 600n;

export function parseAmount(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!AMOUNT.test(t)) return null;
  const frac = t.split(".")[1];
  if (frac && frac.length > decimals) return null;
  const v = parseUnits(t, decimals);
  return v > 0n ? v : null;
}

/** Previews `amountText` of `side`, refreshing on input and on the poll interval. */
export function useSwapFlow(ctx: SwapContext, side: Side, amountText: string, slippageBps: bigint, exactOutput = false) {
  const wallet = useWallet();
  const decimals = (exactOutput ? tokenOut : tokenIn)(ctx, side).decimals;
  const specified = parseAmount(amountText, decimals);
  const [lastPreview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const seq = useRef(0);
  const account = wallet.onRightChain ? (wallet.account ?? undefined) : undefined;

  const preview = lastPreview && lastPreview.side === side && lastPreview.exactOutput === exactOutput &&
    lastPreview.specified === specified && lastPreview.account === account ? lastPreview : null;

  const refresh = useCallback(async () => {
    if (specified === null) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    try {
      const p = await previewSwap(ctx, side, specified, account, exactOutput);
      if (n === seq.current) {
        setPreview(p);
        setPreviewError(null);
      }
    } catch (err) {
      if (n === seq.current) {
        setPreview(null);
        setPreviewError(shortError(err));
      }
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [ctx, side, specified, account, exactOutput]);

  // Debounce typing; then keep the quote current while the page is visible.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 350);
    const i = setInterval(() => {
      if (document.visibilityState === "visible" && phase === "idle") void refresh();
    }, POLL_MS);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [refresh, phase]);

  const guard: Guard | null = preview ? guardFor(preview, slippageBps) : null;

  const maxIn = guard?.maxNetIn ?? null;
  const approve = useCallback(async () => {
    if (!wallet.client || maxIn === null) return;
    setActionError(null);
    setPhase("approving");
    try {
      await approveExact(ctx, wallet.client, tokenIn(ctx, side), maxIn);
      setPhase("idle");
      await refresh();
    } catch (err) {
      setActionError(walletErrorText(err) || shortError(err));
      setPhase("idle");
    }
  }, [wallet.client, maxIn, ctx, side, refresh]);

  const swap = useCallback(async () => {
    if (!wallet.client || specified === null || !guard) return;
    setActionError(null);
    setPhase("signing");
    try {
      const block = await ctx.client.getBlock({ blockTag: "latest" });
      const r = await executeSwap(ctx, wallet.client, side, specified, guard, block.timestamp + DEADLINE_S, exactOutput);
      setResult(r);
      if (r.record) {
        setTracked({
          poolId: r.record.poolId,
          recordId: r.record.id,
          fromBlock: r.receipt.blockNumber,
          timestamp: r.record.timestamp,
          deposit: r.record.deposit,
          depositIn0: r.record.depositIn0,
          outcome: { kind: "open" },
        });
      }
      setPhase("done");
    } catch (err) {
      setActionError(walletErrorText(err));
      setPhase("failed");
    }
  }, [wallet.client, specified, guard, ctx, side, exactOutput]);

  const reset = useCallback(() => {
    setPhase("idle");
    setResult(null);
    setTracked(null);
    setActionError(null);
    void refresh();
  }, [refresh]);

  return { wallet, specified, preview, previewError, loading, guard, phase, actionError, result, tracked, setTracked, approve, swap, reset, refresh };
}

/** Polls a record until it is settled or expired. */
export function useRecordOutcome(ctx: SwapContext, tracked: TrackedRecord | null, onChange: (t: TrackedRecord) => void) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tracked || tracked.outcome.kind !== "open") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const outcome = await recordOutcome(ctx, tracked.poolId, tracked.recordId, tracked.fromBlock);
        if (cancelled) return;
        setError(null);
        if (outcome.kind !== "open") onChange({ ...tracked, outcome });
      } catch (err) {
        if (!cancelled) setError(shortError(err));
      }
    };
    void tick();
    const i = setInterval(() => void tick(), Math.min(POLL_MS, 5_000));
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [ctx, tracked, onChange]);
  return error;
}
