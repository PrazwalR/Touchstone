import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NODES } from "../src/content/acts.ts";

const here = dirname(fileURLToPath(import.meta.url));

const contracts = join(here, "..", "..", "contracts");

describe("code excerpts", () => {
  for (const node of NODES) {
    it(`${node.name}: every line is in ${node.excerpt.file}, in order`, () => {
      const source = readFileSync(join(contracts, node.excerpt.file), "utf8").split("\n").map((l) => l.trim());
      let at = 0;
      let skipping = false;
      for (const line of node.excerpt.lines) {
        if (line === "…") {
          skipping = true;
          continue;
        }
        const want = line.trim();
        const found = source.indexOf(want, at);
        expect(found, `"${want}" not found after line ${at}`).toBeGreaterThanOrEqual(0);
        // Without an elision marker, consecutive excerpt lines must be consecutive in the source too.
        if (at > 0 && !skipping) expect(found, `"${want}" is not the next source line`).toBe(at);
        at = found + 1;
        skipping = false;
      }
    });
  }
});
