import { describe, expect, it } from "vitest";
import { clearPendingSwap, pendingSwapKey, readPendingSwap, savePendingSwap } from "../src/swap/pendingSwap.ts";

const pool = `0x${"11".repeat(32)}`;
const router = `0x${"22".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}` as const;
const newerHash = `0x${"cd".repeat(32)}` as const;
const key = pendingSwapKey(421614, pool, router)!;
function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, value: string) => { values.set(k, value); },
    removeItem: (k: string) => { values.delete(k); },
  };
}

describe("pending swap persistence", () => {
  it("restores only public hash and original direction on the same chain/pool/router", () => {
    const store = memoryStore();
    savePendingSwap(key, { hash, side: "sell" }, store);
    expect(readPendingSwap(key, store)).toEqual({ hash, side: "sell" });
    expect(readPendingSwap(pendingSwapKey(1, pool, router), store)).toBeNull();
    expect(readPendingSwap(pendingSwapKey(421614, `0x${"33".repeat(32)}`, router), store)).toBeNull();
    expect(readPendingSwap(pendingSwapKey(421614, pool, `0x${"44".repeat(20)}`), store)).toBeNull();
  });

  it("normalizes address case and rejects missing chain identity", () => {
    expect(pendingSwapKey(421614, pool, `0x${"aA".repeat(20)}`)).toBe(pendingSwapKey(421614, pool, `0x${"aa".repeat(20)}`));
    expect(pendingSwapKey(undefined, pool, router)).toBeNull();
    expect(pendingSwapKey(421614, "0x12", router)).toBeNull();
  });

  it("ignores malformed or unsupported stored values", () => {
    const store = memoryStore();
    for (const value of ["{", "null", JSON.stringify({ version: 1, hash: "0x12", side: "sell" }),
      JSON.stringify({ version: 1, hash, side: "other" }), JSON.stringify({ version: 2, hash, side: "buy" })]) {
      store.setItem(key, value);
      expect(readPendingSwap(key, store)).toBeNull();
    }
  });

  it("does not let an old confirmation erase a newer transaction", () => {
    const store = memoryStore();
    savePendingSwap(key, { hash: newerHash, side: "buy" }, store);
    clearPendingSwap(key, hash, store);
    expect(readPendingSwap(key, store)?.hash).toBe(newerHash);
    clearPendingSwap(key, newerHash, store);
    expect(readPendingSwap(key, store)).toBeNull();
  });

  it("keeps wallet/confirmation flow usable when browser storage throws", () => {
    const fail = (): never => { throw new Error("storage unavailable"); };
    const store = { getItem: fail, setItem: fail, removeItem: fail };
    expect(readPendingSwap(key, store)).toBeNull();
    expect(() => savePendingSwap(key, { hash, side: "buy" }, store)).not.toThrow();
    expect(() => clearPendingSwap(key, hash, store)).not.toThrow();
  });
});
