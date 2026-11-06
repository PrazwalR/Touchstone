import { describe, expect, it } from "vitest";
import { notionalFromQuote, type DepositPreview } from "../src/swap/swap.ts";

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
});
