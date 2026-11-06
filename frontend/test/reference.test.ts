import { describe, expect, it, vi } from "vitest";
import { zeroAddress } from "viem";
import type { Snapshot } from "../src/chain/reads.ts";
import type { SwapContext } from "../src/swap/swap.ts";
import { readReference, referencePriceE6 } from "../src/swap/reference.ts";

describe("simulation reference validation", () => {
  it("matches ReferenceLib's age boundary and normalizes decimals", () => {
    expect(referencePriceE6(223_000_000_000n, 8, 900n, 1000n, 100)).toBe(2_230_000_000n);
    expect(referencePriceE6(2230n, 0, 999n, 1000n, 100)).toBe(2_230_000_000n);
    expect(() => referencePriceE6(1n, 8, 899n, 1000n, 100)).toThrow();
    expect(() => referencePriceE6(1n, 8, 1001n, 1000n, 100)).toThrow();
    expect(() => referencePriceE6(1n, 8, 0n, 1000n, 100)).toThrow();
    expect(() => referencePriceE6(-1n, 8, 999n, 1000n, 100)).toThrow();
  });
  it("reads the configured feed at the pool snapshot's block, not latest", async () => {
    const feed = "0x0000000000000000000000000000000000000011";
    const hook = "0x0000000000000000000000000000000000000022";
    const readContract = vi.fn(async (call) => {
      if (call.functionName === "SEQUENCER_FEED") return zeroAddress;
      if (call.functionName === "SEQUENCER_GRACE") return 0;
      if (call.functionName === "decimals") return 8;
      return [1n, 223_000_000_000n, 900n, 999n, 1n];
    });
    const snapshot = { blockNumber: 42n, blockTime: 1000n, config: { referenceFeed: feed, referenceMaxAge: 100 } } as unknown as Snapshot;
    const ctx = { client: { readContract }, hook } as unknown as SwapContext;
    expect(await readReference(ctx, snapshot)).toEqual({ priceE6: 2_230_000_000n, updatedAt: 999, blockNumber: 42n });
    expect(readContract.mock.calls.every(([c]) => c.blockNumber === 42n)).toBe(true);
    expect(readContract.mock.calls.find(([c]) => c.functionName === "latestRoundData")?.[0].address).toBe(feed);
  });
  it("refuses a comparison while the sequencer is down or recovering", async () => {
    const sequencer = "0x0000000000000000000000000000000000000033";
    let answer = 1n;
    let startedAt = 900n;
    const readContract = vi.fn(async (call) => {
      if (call.functionName === "SEQUENCER_FEED") return sequencer;
      if (call.functionName === "SEQUENCER_GRACE") return 100;
      if (call.functionName === "decimals") return 8;
      if (call.address === sequencer) return [1n, answer, startedAt, 999n, 1n];
      return [1n, 223_000_000_000n, 900n, 999n, 1n];
    });
    const snapshot = { blockNumber: 42n, blockTime: 1000n, config: { referenceFeed: "0x0000000000000000000000000000000000000011", referenceMaxAge: 100 } } as unknown as Snapshot;
    const ctx = { client: { readContract }, hook: zeroAddress } as unknown as SwapContext;
    await expect(readReference(ctx, snapshot)).rejects.toThrow("sequencer");
    answer = 0n;
    startedAt = 901n;
    await expect(readReference(ctx, snapshot)).rejects.toThrow("grace");
    startedAt = 900n;
    expect((await readReference(ctx, snapshot)).priceE6).toBe(2_230_000_000n);
  });
});
