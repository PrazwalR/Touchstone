import { describe, expect, it } from "vitest";
import {
  continuousRateBps,
  firedTriggers,
  inputToReach,
  quoteDeposit,
  signedGapBps,
  sqrtPriceX96At,
} from "../src/swap/arbitrage.ts";

// The Arbitrum Sepolia fork rehearsal of 7 November 2026 (decision 0067): ETH is currency0, USDC currency1.
const SQRT = 3739813288222029106261109n;
const BAND_L = 103879127119190n;
const TERMS = { deltaBps: 30, deltaMaxBps: 300, betaX100: 125 };

const priceE6 = (s: bigint) => (s * s * 10n ** 18n) >> 192n;

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
