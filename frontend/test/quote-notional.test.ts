import { describe, expect, it, vi } from "vitest";
import { notionalFromQuote, previewSwap, type DepositPreview, type SwapContext } from "../src/swap/swap.ts";

const preview = (n: bigint, flagged = true): DepositPreview => ({
  flaggedNow: flagged, exempt: false, mode: 0, rateBps: 30, triggers: flagged ? 1 : 0,
  depositIfFlagged: n * 30n / 10_000n, depositNow: flagged ? n * 30n / 10_000n : 0n,
  settleAfter: 0n, expiresAt: 0n,
});

describe("quote-side notional", () => {
  it("uses actual quoted proceeds for a shallow-pool sell rather than spot-valuing the ETH", async () => {
    const gross = 1_840_000n;
    const net = gross - preview(gross).depositNow;
    const n = await notionalFromQuote(net, "sell", 13_760_000_000_000_000_000n, false, async (v) => preview(v));
    expect(n).toBe(gross);
  });
  it("recognizes a trigger on gross proceeds even when net output is below N0", async () => {
    const gross = 5_000_001n;
    const n = await notionalFromQuote(gross - preview(gross).depositNow, "sell", 1n, false,
      async (v) => preview(v, v >= 5_000_000n));
    expect(n).toBe(gross);
  });
  it("does not invent a hold on an unflagged swap", async () => {
    expect(await notionalFromQuote(1_234_567n, "sell", 1n, false, async (v) => preview(v, false))).toBe(1_234_567n);
  });
  it("excludes the input deposit from an exact-output buy", async () => {
    const gross = 6_000_000n;
    expect(await notionalFromQuote(gross + preview(gross).depositNow, "buy", 1n, true, async (v) => preview(v))).toBe(gross);
  });
  it("uses the specified quote leg directly when it is known", async () => {
    const unused = async (): Promise<DepositPreview> => { throw new Error("not needed"); };
    expect(await notionalFromQuote(9n, "buy", 6_000_000n, false, unused)).toBe(6_000_000n);
    expect(await notionalFromQuote(9n, "sell", 6_000_000n, true, unused)).toBe(6_000_000n);
  });
  it("runs an available real-account simulation before an approximate near-budget inversion", async () => {
    // The view values outstanding risky claims at spot, while the real swap knows its execution price.
    // Its budget branch can therefore change across these candidate notionals, leaving no view-only inverse.
    const approximateDeposit = async (n: bigint) => preview(n, n < 1_002n);
    await expect(notionalFromQuote(1_000n, "sell", 10n, false, approximateDeposit)).rejects.toThrow("disagree");
    const account = "0x0000000000000000000000000000000000000006";
    const readContract = vi.fn(async (call: { functionName: string; args?: readonly unknown[] }) => {
      if (call.functionName === "extsload") return `0x${(1n << 96n).toString(16).padStart(64, "0")}`;
      if (call.functionName === "previewDeposit") return approximateDeposit(call.args![2] as bigint);
      throw new Error(`unexpected read: ${call.functionName}`);
    });
    const client = {
      getBlockNumber: vi.fn().mockResolvedValue(1n),
      getBalance: vi.fn().mockResolvedValue(100n),
      readContract,
      simulateContract: vi.fn(async (call: { functionName: string }) => call.functionName === "quoteExactInputSingle"
        ? { result: [1_000n, 0n] }
        : { result: [BigInt.asIntN(256, (BigInt.asUintN(128, -10n) << 128n) | 1_000n), 0n] }),
    } as unknown as SwapContext["client"];
    const ctx = {
      client, key: { currency0: "0x0000000000000000000000000000000000000000" },
      poolId: `0x${"11".repeat(32)}`,
      quote: { address: "0x0000000000000000000000000000000000000002" },
      risky: { address: "0x0000000000000000000000000000000000000000" },
    } as unknown as SwapContext;
    const p = await previewSwap(ctx, "sell", 10n, account);
    expect(p.notionalQuote).toBe(1_000n);
    expect(p.exact).toEqual({ netIn: 10n, netOut: 1_000n, deposit: 0n });
    expect(readContract.mock.calls.filter(([call]) => call.functionName === "previewDeposit")).toHaveLength(1);
  });
});
