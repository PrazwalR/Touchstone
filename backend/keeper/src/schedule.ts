import type { TouchstoneRecord } from "@touchstone/shared";

/** When a record can be settled, the latest publish time Pyth will accept, and when it can expire. */
export interface SettleWindow {
  t0: bigint;
  latest: bigint;
  expiresAt: bigint;
}

export type Action = { kind: "wait"; until: bigint } | { kind: "settle" } | { kind: "expire" };

/**
 * Spec §15.1 steps 2 and 5. The window always comes from Settler.settleTime, so the keeper never
 * re-implements calendar rules. `latest` bounds the update publish time, not the submission time.
 * Before expiry, continue fetching timely updates even if Hermes delivered them late.
 */
export function nextAction(window: SettleWindow, now: bigint): Action {
  if (now < window.t0) return { kind: "wait", until: window.t0 };
  if (now >= window.expiresAt) return { kind: "expire" };
  return { kind: "settle" };
}

/** Records keyed by pool and id, so a re-delivered log is ingested once. */
export class RecordBook {
  readonly #open = new Map<string, TouchstoneRecord>();

  static keyOf(r: Pick<TouchstoneRecord, "poolId" | "id">): string {
    return `${r.poolId.toLowerCase()}:${r.id.toString()}`;
  }

  add(r: TouchstoneRecord): boolean {
    const k = RecordBook.keyOf(r);
    if (this.#open.has(k)) return false;
    this.#open.set(k, r);
    return true;
  }

  close(r: Pick<TouchstoneRecord, "poolId" | "id">): void {
    this.#open.delete(RecordBook.keyOf(r));
  }

  open(): TouchstoneRecord[] {
    return [...this.#open.values()];
  }
}
