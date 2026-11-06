import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/docs/markdown.tsx";

const source = readFileSync(new URL("../../docs/formulas.md", import.meta.url), "utf8");

describe("docs/formulas.md", () => {
  const blocks = parse(source);
  const tables = blocks.flatMap((b) => (b.t === "table" ? [b] : []));

  it("has the formula table and the variable table, each row complete", () => {
    expect(tables).toHaveLength(2);
    expect(tables[0]?.head).toEqual(["Formula", "What it is", "Basis"]);
    expect(tables[0]?.rows).toHaveLength(8);
    expect(tables[1]?.head).toEqual(["Symbol", "Meaning", "Value or unit"]);
    for (const t of tables) for (const row of t.rows) expect(row.every((c) => c.trim() !== "")).toBe(true);
  });

  it("states the testnet values the deployed config uses", () => {
    const cfg = JSON.parse(
      readFileSync(new URL("../../contracts/script/config/arbitrum-sepolia.json", import.meta.url), "utf8"),
    ).pool;
    const text = tables[1]!.rows.map((r) => r.join(" ")).join("\n");
    expect(text).toContain(`testnet ${cfg.n0 / 1e6} USDC`);
    expect(text).toContain(`testnet ${cfg.nMin / 1e6} USDC`);
    expect(text).toContain(`${cfg.flowHorizon} s`);
    expect(text).toContain(`${cfg.tauBps} bp`);
    expect(text).toContain(`${cfg.alphaBps / 100}%`);
    expect(text).toContain(`testnet ${cfg.lease.k} s`);
  });

  it("keeps the claims it must not make", () => {
    expect(source).toContain("never claimed optimal");
    expect(source).toContain("Hindsight");
    expect(source).not.toMatch(/0\.781/);
  });
});
