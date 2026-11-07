import { describe, expect, it } from "vitest";
import { BLOCK_IMPACT_BPS, impactBlock } from "../src/swap/impactGuard.ts";

const healthy = { outOfRange: false, toward: "buy" as const };
const broken = { outOfRange: true, toward: "buy" as const };

describe("impactBlock", () => {
  it("allows trades at or under the limit on any pool", () => {
    expect(impactBlock({ side: "sell", impactBps: BLOCK_IMPACT_BPS }, healthy)).toBeNull();
    expect(impactBlock({ side: "buy", impactBps: 24 }, broken)).toBeNull();
  });
  it("refuses a dump-sized trade on a healthy pool, in either direction", () => {
    expect(impactBlock({ side: "sell", impactBps: 9_800 }, healthy)).toMatch(/liquidity is limited/);
    expect(impactBlock({ side: "buy", impactBps: 9_800 }, healthy)).toMatch(/liquidity is limited/);
  });
  it("lets a broken pool be restored but not pushed further", () => {
    expect(impactBlock({ side: "buy", impactBps: 9_800 }, broken)).toBeNull();
    expect(impactBlock({ side: "sell", impactBps: 9_800 }, broken)).toMatch(/only a trade toward the reference/);
  });
});
