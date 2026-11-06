// The swap's life on the page: preview while typing, then approve, swap, and follow the record to its outcome.
import { useCallback, useEffect, useRef, useState } from "react";
import { parseUnits, type Hex } from "viem";
import { POLL_MS } from "../config.ts";
import { useWallet } from "../wallet/WalletContext.tsx";
import { walletErrorText } from "../wallet/wallet.ts";
import { clearPendingSwap, pendingSwapKey, PENDING_SWAP_CHANGED, readPendingSwap, savePendingSwap } from "./pendingSwap.ts";
import {
  approveExact,
  confirmSwap,
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
  SwapRevertedError,
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
  const storageKey = pendingSwapKey(ctx.client.chain?.id, ctx.poolId, ctx.router);
  const [restored, setRestored] = useState(() => readPendingSwap(storageKey));
  const [lastPreview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>(restored ? "failed" : "idle");
  const [actionError, setActionError] = useState<string | null>(restored
    ? "A submitted swap was restored. Check its confirmation before starting another swap."
    : null);
  const [submittedHash, setSubmittedHash] = useState<Hex | null>(restored?.hash ?? null);
  const [result, setResult] = useState<SwapResult | null>(null);
  const [tracked, setTracked] = useState<TrackedRecord | null>(null);
  const submitted = useRef<{ hash: Hex; side: Side; ctx: SwapContext } | null>(restored ? { ...restored, ctx } : null);
  const actionInFlight = useRef(false);
  const seq = useRef(0);
  const account = wallet.onRightChain ? (wallet.account ?? undefined) : undefined;
  const confirmationPending = submittedHash !== null && result === null;

  useEffect(() => {
    const restoreLateSubmission = () => {
      if (submitted.current) return;
      const pending = readPendingSwap(storageKey);
      if (!pending) return;
      submitted.current = { ...pending, ctx };
      setRestored(pending);
      setSubmittedHash(pending.hash);
      setResult(null);
      setActionError("A submitted swap was restored. Check its confirmation before starting another swap.");
      setPhase("failed");
    };
    window.addEventListener(PENDING_SWAP_CHANGED, restoreLateSubmission);
    return () => window.removeEventListener(PENDING_SWAP_CHANGED, restoreLateSubmission);
  }, [storageKey, ctx]);

  const preview = lastPreview && lastPreview.side === side && lastPreview.exactOutput === exactOutput &&
    lastPreview.specified === specified && lastPreview.account === account ? lastPreview : null;

  const refresh = useCallback(async () => {
    // Invalid input cancels older requests too: an old failure must not clear a newer quote.
    const n = ++seq.current;
    if (specified === null) {
      setPreview(null);
      setPreviewError(null);
      setLoading(false);
      return;
    }
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
    // A wallet rejection is retryable, so keep its quote current just as in the idle state.
    if ((phase !== "idle" && phase !== "failed") || confirmationPending) {
      setLoading(false);
      return;
    }
    const readWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const t = setTimeout(readWhenVisible, 350);
    const i = setInterval(readWhenVisible, POLL_MS);
    document.addEventListener("visibilitychange", readWhenVisible);
    return () => {
      // Invalidate before the replacement input's debounce starts a new request.
      ++seq.current;
      clearTimeout(t);
      clearInterval(i);
      document.removeEventListener("visibilitychange", readWhenVisible);
    };
  }, [refresh, phase, confirmationPending]);

  const guard: Guard | null = preview ? guardFor(preview, slippageBps) : null;

  const maxIn = guard?.maxNetIn ?? null;
  const approve = useCallback(async () => {
    if (!wallet.client || maxIn === null || submitted.current || actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setPhase("approving");
    try {
      await approveExact(ctx, wallet.client, tokenIn(ctx, side), maxIn);
      setPhase("idle");
      await refresh();
    } catch (err) {
      setActionError(walletErrorText(err) || shortError(err));
      setPhase("idle");
    } finally {
      actionInFlight.current = false;
    }
  }, [wallet.client, maxIn, ctx, side, refresh]);

  const finish = useCallback((r: SwapResult) => {
    clearPendingSwap(storageKey, r.hash);
    submitted.current = null;
    setSubmittedHash(null);
    setResult(r);
    setTracked(r.record ? {
      poolId: r.record.poolId,
      recordId: r.record.id,
      fromBlock: r.receipt.blockNumber,
      timestamp: r.record.timestamp,
      deposit: r.record.deposit,
      depositIn0: r.record.depositIn0,
      outcome: { kind: "open" },
    } : null);
    setPhase("done");
  }, [storageKey]);

  const fail = useCallback((err: unknown) => {
    // Only a confirmed reverted receipt proves that retrying a new swap is safe.
    if (err instanceof SwapRevertedError) {
      clearPendingSwap(storageKey, err.hash);
      submitted.current = null;
      setSubmittedHash(null);
    }
    setActionError(submitted.current
      ? `Transaction submitted; confirmation is unavailable. Check confirmation before starting another swap. ${walletErrorText(err)}`
      : walletErrorText(err));
    setPhase("failed");
  }, [storageKey]);

  const swap = useCallback(async () => {
    if (!wallet.client || specified === null || !guard || submitted.current || actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setSubmittedHash(null);
    setResult(null);
    setPhase("signing");
    try {
      const block = await ctx.client.getBlock({ blockTag: "latest" });
      const r = await executeSwap(ctx, wallet.client, side, specified, guard, block.timestamp + DEADLINE_S, exactOutput, (hash) => {
        // Preserve the submitted direction and deployment even if the wallet or form later changes.
        submitted.current = { hash, side, ctx };
        // Persist before React state updates: a route change may already have unmounted this form.
        savePendingSwap(storageKey, { hash, side });
        setSubmittedHash(hash);
        setPhase("confirming");
      });
      finish(r);
    } catch (err) {
      fail(err);
    } finally {
      actionInFlight.current = false;
    }
  }, [wallet.client, specified, guard, ctx, side, exactOutput, finish, fail, storageKey]);

  const resumeConfirmation = useCallback(async () => {
    const pending = submitted.current;
    if (!pending || actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(null);
    setPhase("confirming");
    try {
      finish(await confirmSwap(pending.ctx, pending.side, pending.hash));
    } catch (err) {
      fail(err);
    } finally {
      actionInFlight.current = false;
    }
  }, [finish, fail]);

  const reset = useCallback(() => {
    if (submitted.current || actionInFlight.current) return;
    setPhase("idle");
    setResult(null);
    setTracked(null);
    setActionError(null);
    setSubmittedHash(null);
    void refresh();
  }, [refresh]);

  const restoredSubmission = confirmationPending && restored !== null && submittedHash === restored.hash;
  return { wallet, specified, preview, previewError, loading, guard, phase, actionError, submittedHash, submittedSide: submitted.current?.side ?? null, restoredSubmission, confirmationPending, result, tracked, setTracked, approve, swap, resumeConfirmation, reset, refresh };
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
