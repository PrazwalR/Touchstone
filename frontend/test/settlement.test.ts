import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeLab, defaultParams, PRESETS } from "../src/math/lab.ts";
import { benign, clawback, conserves, quoteAmount, rateBps, splitRetained } from "../src/math/settlement.ts";

const here = dirname(fileURLToPath(import.meta.url));

const vectorsDir = join(here, "..", "..", "research", "reference", "vectors");
const report = JSON.parse(readFileSync(join(vectorsDir, "report_numbers.json"), "utf8")) as {
  worked_example: { swap: string; deposit: number; retained: number; refund: number; effective_fee_bps: number }[];
  split_arbitrage: Record<string, number | boolean>;
  rebate_benign: Record<string, number | boolean>;
};
const vectors = JSON.parse(readFileSync(join(vectorsDir, "vectors.json"), "utf8")) as {
  clawback: { deposit: number; mPlus: number; nPlus: number; eps: number; conf: number; alpha: number; out: number }[];
};

const USD = 1_000_000n;
const usd = (x: number) => BigInt(Math.round(x * 1e6));

describe("BigInt port against the research reference", () => {
  it("matches every clawback vector", () => {
    for (const v of vectors.clawback) {
      expect(clawback(BigInt(v.deposit), BigInt(v.mPlus), BigInt(v.nPlus), BigInt(v.eps), BigInt(v.conf), BigInt(v.alpha))).toBe(BigInt(v.out));
    }
  });

  it("reproduces the arbitrage row and its split", () => {
    const N = 500_000n * USD;
    const D = quoteAmount(N, rateBps(0, 0n, 30n, 300n, 125n, 300n));
    const R = clawback(D, 500n * USD, N, 2n, 0n, 8000n);
    const row = report.worked_example.find((r) => r.swap === "arbitrage");
    expect(D).toBe(usd(row?.deposit ?? NaN));
    expect(R).toBe(usd(row?.retained ?? NaN));
    const p = splitRetained(D, R, { tipBps: 200n, tipCap: 5n * USD, protocolShareBps: 0n, rhoBps: 1000n });
    const s = report.split_arbitrage;
    expect(p.refund).toBe(usd(s.refund as number));
    expect(p.tip).toBe(usd(s.tip as number));
    expect(p.toRebatePool).toBe(usd(s.to_rebate_pool as number));
    expect(p.toLPs).toBe(usd(s.to_lps as number));
    expect(conserves(p, D, 0n)).toBe(true);
  });

  it("reproduces the outsider row, where a live lease raises alpha to 95%", () => {
    const N = 500_000n * USD;
    const D = quoteAmount(N, 30n);
    const row = report.worked_example.find((r) => r.swap === "outsider_in_band");
    expect(clawback(D, 500n * USD, N, 2n, 0n, 9500n)).toBe(usd(row?.retained ?? NaN));
  });

  it("reproduces the benign rebate", () => {
    const N = 200_000n * USD;
    const D = quoteAmount(N, 30n);
    const p = benign(D, N, 500n, 4000n, 1000n * USD, 200n, 5n * USD);
    const s = report.rebate_benign;
    expect(p.refund).toBe(usd(s.refund as number));
    expect(p.tip).toBe(usd(s.tip as number));
    expect(p.rebate).toBe(usd(s.rebate as number));
    expect(conserves(p, D, 1000n * USD)).toBe(true);
  });

  it("caps the rate at deltaMax and uses deltaClosed for a closure record", () => {
    expect(rateBps(0, 1000n, 30n, 300n, 125n, 300n)).toBe(300n);
    expect(rateBps(0, 100n, 30n, 300n, 125n, 300n)).toBe(125n);
    expect(rateBps(0, -50n, 30n, 300n, 125n, 300n)).toBe(30n);
    expect(rateBps(1, 0n, 30n, 300n, 125n, 77n)).toBe(77n);
  });

  it("refuses to retain more than the deposit", () => {
    expect(() => splitRetained(10n, 11n, { tipBps: 0n, tipCap: 0n, protocolShareBps: 0n, rhoBps: 0n })).toThrow("RetainedAboveDeposit");
  });
});

describe("laboratory", () => {
  const preset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) throw new Error(id);
    return computeLab({ ...p, params: defaultParams() });
  };

  it("shows the worked example on its default preset", () => {
    const o = preset("arb");
    expect(o.path).toBe("adverse");
    expect(o.D).toBe(1500n * USD);
    expect(o.R).toBe(320n * USD);
    expect(o.pay.refund).toBe(1180n * USD);
    expect(o.eff.toFixed(1)).toBe("11.4");
    expect(o.ok).toBe(true);
  });

  it("pays a rebate only when the markout is at most zero", () => {
    const b = preset("benign");
    expect(b.path).toBe("benign");
    expect(b.pay.rebate).toBe(usd(39.2));
    const inside = computeLab({ ...PRESETS[0], N: 200_000, mBps: 1, params: defaultParams() });
    expect(inside.R).toBe(0n);
    expect(inside.path).toBe("exempt");
    expect(inside.pay.rebate).toBe(0n);
    expect(inside.pay.refund).toBe(inside.D);
  });

  it("retains nothing from the licence holder's first swap", () => {
    const o = preset("holder");
    expect(o.alpha).toBe(0n);
    expect(o.R).toBe(0n);
    expect(o.pay.refund).toBe(o.D);
  });

  it("conserves on every preset and across a sweep of inputs", () => {
    for (const p of PRESETS) expect(computeLab({ ...p, params: defaultParams() }).ok).toBe(true);
    for (let N = 1000; N <= 2_000_000; N += 199_000) {
      for (let m = -20; m <= 60; m += 7.5) {
        for (const gap of [-50, 0, 40, 300]) {
          expect(computeLab({ ...PRESETS[0], N, mBps: m, gap, params: defaultParams() }).ok).toBe(true);
        }
      }
    }
  });
});
