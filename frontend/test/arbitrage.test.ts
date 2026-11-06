import { describe, expect, it, vi } from "vitest";
import type { SwapContext } from "../src/swap/swap.ts";
import {
  demoGapTarget,
  continuousRateBps,
  firedTriggers,
  inputToReach,
  inputToTarget,
  quoteDeposit,
  signedGapBps,
  sqrtPriceX96At,
} from "../src/swap/arbitrage.ts";

// The Arbitrum Sepolia fork rehearsal of 7 November 2026 (decision 0067): ETH is currency0, USDC currency1.
const SQRT = 3739813288222029106261109n;
const BAND_L = 103879127119190n;
const TERMS = { deltaBps: 30, deltaMaxBps: 300, betaX100: 125 };

const priceE6 = (s: bigint) => (s * s * 10n ** 18n) >> 192n;

describe("inputToTarget", () => {
  it("uses the deployed tick-aware quote instead of extrapolating shallow backstop liquidity", async () => {
    const readContract = vi.fn().mockResolvedValue([79_157_495n, 101_850_448_614_517_467n]);
    const ctx = {
      client: { readContract }, hook: "0x0000000000000000000000000000000000000001",
      key: { currency0: "0x0000000000000000000000000000000000000000" },
      quote: { address: "0x0000000000000000000000000000000000000002" },
    } as unknown as SwapContext;
    const from = sqrtPriceX96At(15_015_669n, false, 18, 6);
    const target = sqrtPriceX96At(2_236_810_586n, false, 18, 6);
    expect(await inputToTarget(ctx, from, target, 326_744_342n)).toEqual({
      side: "buy", amountIn: 79_157_495n, netOut: 101_850_448_614_517_467n,
    });
    expect(readContract.mock.calls[0][0]).toMatchObject({
      functionName: "swapToPrice", blockNumber: 326_744_342n,
      args: [ctx.key, false, -((1n << 127n) - 1n), target, "0x"],
    });
    readContract.mockResolvedValue([0n, 0n]);
    await expect(inputToTarget(ctx, from, target, 326_744_342n)).rejects.toThrow("cannot quote");
  });
});

describe("demoGapTarget", () => {
  it("opens a 40 bps gap without changing tau, then prepares a sell toward the reference", () => {
    const ref = 2_230_510_000n;
    const depth = 76_104_275_095_801n; // Current deployment's active liquidity, read 7 November 2026.
    const target = demoGapTarget(ref, 5);
    const sqrt = sqrtPriceX96At(target, false, 18, 6);
    expect(signedGapBps(ref, priceE6(sqrt), "sell")).toBeGreaterThanOrEqual(39n);
    const seed = inputToReach(sqrtPriceX96At(ref, false, 18, 6), sqrt, depth, 500, false);
    const back = inputToReach(sqrt, sqrtPriceX96At(ref, false, 18, 6), depth, 500, false);
    expect(seed?.side).toBe("buy");
    expect(back?.side).toBe("sell");
    expect(back!.amountIn * ref / 10n ** 18n).toBeGreaterThan(5_000_000n);
  });
  it("scales with a larger threshold and rejects unsafe demo inputs", () => {
    expect(demoGapTarget(100_000_000n, 40)).toBe(100_800_000n);
    expect(() => demoGapTarget(0n, 5)).toThrow();
    expect(() => demoGapTarget(1n, 1_001)).toThrow();
  });
});

describe("signedGapBps", () => {
  it("is positive toward the reference and truncates toward zero", () => {
    expect(signedGapBps(2_230_510_000n, 2_220_000_000n, "buy")).toBe(47n);
    expect(signedGapBps(2_230_510_000n, 2_220_000_000n, "sell")).toBe(-47n);
    expect(signedGapBps(2_230_510_000n, 2_230_510_000n, "buy")).toBe(0n);
  });
  it("refuses a non-positive reference", () => {
    expect(() => signedGapBps(0n, 1n, "buy")).toThrow();
  });
});

describe("continuousRateBps", () => {
  it("floors at delta, scales by beta, caps at deltaMax", () => {
    expect(continuousRateBps(10n, TERMS)).toBe(30n);
    expect(continuousRateBps(47n, TERMS)).toBe(58n);
    expect(continuousRateBps(400n, TERMS)).toBe(300n);
    expect(continuousRateBps(-80n, TERMS)).toBe(30n);
  });
});

describe("quoteDeposit", () => {
  it("is N times the rate, rounded down", () => {
    expect(quoteDeposit(6_000_000n, 58n)).toBe(34_800n);
    expect(quoteDeposit(3n, 30n)).toBe(0n);
  });
});

describe("sqrtPriceX96At", () => {
  it("round-trips the rehearsal pool price to within one millionth", () => {
    const p = priceE6(SQRT);
    const back = priceE6(sqrtPriceX96At(p, false, 18, 6));
    expect(Number(back - p)).toBeLessThanOrEqual(Number(p / 1_000_000n) + 1);
    expect(Number(p - back)).toBeLessThanOrEqual(Number(p / 1_000_000n) + 1);
  });
  it("inverts the price when quote is currency0", () => {
    const a = sqrtPriceX96At(2_000_000_000n, false, 18, 6);
    const b = sqrtPriceX96At(2_000_000_000n, true, 18, 6);
    // a * b = 2^192 for reciprocal prices, up to integer square roots.
    const product = a * b;
    const q192 = 1n << 192n;
    expect(Number((product > q192 ? product - q192 : q192 - product) * 1_000_000n / q192)).toBeLessThanOrEqual(1);
  });
});

describe("inputToReach", () => {
  it("buys about 25 USDC to lift the band's price by 1%", () => {
    const target = sqrtPriceX96At((priceE6(SQRT) * 101n) / 100n, false, 18, 6);
    const r = inputToReach(SQRT, target, BAND_L, 500, false);
    expect(r?.side).toBe("buy");
    expect(r!.amountIn).toBeGreaterThan(24_000_000n);
    expect(r!.amountIn).toBeLessThan(26_000_000n);
  });
  it("sells ETH when the reference is below the pool", () => {
    const target = sqrtPriceX96At((priceE6(SQRT) * 99n) / 100n, false, 18, 6);
    const r = inputToReach(SQRT, target, BAND_L, 500, false);
    expect(r?.side).toBe("sell");
    // About 25 USDC worth of ETH at roughly 2,230 USDC per ETH.
    expect(r!.amountIn).toBeGreaterThan(10n ** 16n);
    expect(r!.amountIn).toBeLessThan(12n * 10n ** 15n);
  });
  it("has nothing to do at the target or without liquidity", () => {
    expect(inputToReach(SQRT, SQRT, BAND_L, 500, false)).toBeNull();
    expect(inputToReach(SQRT, SQRT + 1n, 0n, 500, false)).toBeNull();
  });
});

describe("firedTriggers", () => {
  it("names TriggerLib's bits", () => {
    expect(firedTriggers(5)).toEqual(["First touch", "Drift"]);
    expect(firedTriggers(0)).toEqual([]);
    expect(firedTriggers(15)).toHaveLength(4);
  });
});
