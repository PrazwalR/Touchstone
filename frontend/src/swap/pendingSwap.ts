import type { Hex } from "viem";
import type { Side } from "./swap.ts";

export interface PendingSwap {
  hash: Hex;
  side: Side;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const PENDING_SWAP_CHANGED = "touchstone:pending-swap-changed";

export function pendingSwapKey(chainId: number | undefined, poolId: string, router: string): string | null {
  if (!Number.isSafeInteger(chainId) || (chainId ?? 0) <= 0 || !HASH.test(poolId) || !ADDRESS.test(router)) return null;
  return `touchstone.pending-swap.v1:${chainId}:${poolId.toLowerCase()}:${router.toLowerCase()}`;
}

function sessionStore(): Store | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

/** This is public transaction metadata, scoped to this tab and deployment, never wallet credentials. */
export function readPendingSwap(key: string | null, store = sessionStore()): PendingSwap | null {
  if (!key || !store) return null;
  try {
    const raw: unknown = JSON.parse(store.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || typeof value.hash !== "string" || !HASH.test(value.hash)
      || (value.side !== "buy" && value.side !== "sell")) return null;
    return { hash: value.hash as Hex, side: value.side };
  } catch { return null; }
}

export function savePendingSwap(key: string | null, pending: PendingSwap, store = sessionStore()): void {
  if (!key || !store || !HASH.test(pending.hash) || (pending.side !== "buy" && pending.side !== "sell")) return;
  try {
    store.setItem(key, JSON.stringify({ version: 1, hash: pending.hash, side: pending.side }));
    // A wallet may return a hash after its original route has already unmounted.
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PENDING_SWAP_CHANGED));
  }
  catch { /* Storage restrictions never turn a submitted transaction into a UI failure. */ }
}

export function clearPendingSwap(key: string | null, confirmedHash: Hex, store = sessionStore()): void {
  if (!key || !store) return;
  // An old unmounted confirmation must not delete a more recent submission for this deployment.
  try { if (readPendingSwap(key, store)?.hash.toLowerCase() === confirmedHash.toLowerCase()) store.removeItem(key); }
  catch { /* Confirmation still succeeds if storage is unavailable. */ }
}
