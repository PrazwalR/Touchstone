import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { E1, E2, E5, E6, EXPERIMENTS } from "../src/content/evidence.ts";

const results = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "research", "results");
const read = (name: string) => JSON.parse(readFileSync(join(results, name), "utf8"));

describe("research figures shown in Docs", () => {
  it("match E1.json exactly", () => {
    const e1 = read("E1.json");
    expect(e1.label).toBe("historical backtest");
    expect(E1.prereg).toBe(e1.prereg_sha256);
    expect(E1.code).toBe(e1.code_sha256);
    expect(E1.selected).toEqual({ n0: e1.selected_trigger.n0, nMin: e1.selected_trigger.n_min, h: e1.selected_trigger.h, tauBps: e1.selected_trigger.tau_bps });
    expect(E1.devRecall).toBe(e1.selected_dev_score.recall);
    expect(E1.devPhiCount).toBe(e1.selected_dev_score.phi_count);
    expect(E1.devPhiVolume).toBe(e1.selected_dev_score.phi_volume);
  });

  it("match E2.json exactly", () => {
    const e2 = read("E2.json");
    expect(e2.label).toBe("historical backtest");
    expect(E2.verdict).toBe(e2.verdict);
    expect(E2.prereg).toBe(e2.prereg_sha256);
    expect(E2.swaps).toBe(e2.held_out.swaps);
    expect(E2.recall).toBe(e2.held_out.recall);
    expect([...E2.recallCi]).toEqual(e2.held_out.recall_ci95);
    expect(E2.phiCount).toBe(e2.held_out.phi_count);
    expect(E2.phiVolume).toBe(e2.held_out.phi_volume);
    expect(E2.rStar).toBe(e2.held_out.r_star);
    expect(E2.reportAverageRStar).toBe(e2.held_out.report_average_r_star);
    // The JSON signs markout from the trader's side: negative means LPs gained.
    expect(E2.lpNetUsd).toBe(Math.round(-e2.held_out.net_lp_markout_usd));
    expect([...E2.weeklyRecall]).toEqual(e2.weekly.map((w: { recall: number }) => w.recall));
    expect([...E2.weeklyPhiCount]).toEqual(e2.weekly.map((w: { phi_count: number }) => w.phi_count));
  });

  it.each(["E5", "E6"])("matches the committed freeze for %s", (id) => {
    const prereg = readFileSync(join(results, "..", "prereg", id + ".md"));
    const ledger = readFileSync(join(results, "..", "prereg", "FROZEN.md"), "utf8");
    expect(ledger).toContain(`| ${id}.md | ${createHash("sha256").update(prereg).digest("hex")} |`);
    expect(EXPERIMENTS.find((e) => e.id === id)?.status).toBe(id === "E6" ? "killed" : "partly measured");
  });

  it("reports E5's worst held-out recall and its r* caveat from the frozen output", () => {
    const result = read("E5.json");
    const scenarios = result.scenarios as Record<string, { windows: { heldout: { recall: number; recall_ci95: [number, number]; r_star: number; below_break_even: boolean } } }>;
    const heldout = Object.values(scenarios).map((s) => s.windows.heldout);
    expect(result.label).toBe("simulation");
    expect(result.prereg_sha256).toBe(E5.prereg);
    expect(Object.keys(scenarios)).toHaveLength(E5.cases);
    // r* is negative on this window, so nothing is ever formally below it, however low recall gets.
    expect(heldout.every((h) => !h.below_break_even)).toBe(true);
    expect(heldout.filter((h) => h.below_break_even)).toHaveLength(E5.heldoutKills);
    expect(heldout.every((h) => h.r_star === E5.rStar)).toBe(true);
    const worst = heldout.reduce((a, b) => (b.recall < a.recall ? b : a));
    expect(worst.recall).toBe(E5.worstHeldoutRecall);
    expect(worst.recall_ci95).toEqual(E5.worstHeldoutRecallCi);
    expect(scenarios.unchanged.windows.heldout.recall).toBe(E5.unchangedHeldoutRecall);
  });

  it("reports all E6 kills and the held-out range from the frozen output", () => {
    const result = read("E6.json");
    type Window = { freshness_ratio: number; kill: boolean };
    const cases: { windows: { development: Window; heldout: Window } }[] = result.scenarios;
    const ratios = cases.map((c) => c.windows.heldout.freshness_ratio);
    expect(result.label).toBe("simulation");
    expect(result.prereg_sha256).toBe(E6.prereg);
    expect(cases).toHaveLength(E6.cases);
    expect(cases.filter((c) => c.windows.development.kill)).toHaveLength(E6.developmentKills);
    expect(cases.filter((c) => c.windows.heldout.kill)).toHaveLength(E6.heldoutKills);
    expect([Math.min(...ratios), Math.max(...ratios)]).toEqual(E6.heldoutRange);
    expect(result.normalization_manifest_sha256).toBe(createHash("sha256").update(readFileSync(join(results, "E6.manifest.json"))).digest("hex"));
  });

  it("claim a result only where a result file exists", () => {
    for (const e of EXPERIMENTS.filter((x) => x.status === "passed")) {
      expect(() => read(`${e.id}.json`), `${e.id} is shown as passed`).not.toThrow();
    }
  });
});
