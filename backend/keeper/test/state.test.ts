import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TouchstoneRecord } from "@touchstone/shared";
import { loadState, saveState } from "../src/state.ts";

const address = `0x${"11".repeat(20)}` as const;
const poolId = `0x${"22".repeat(32)}` as const;
const record: TouchstoneRecord = {
  poolId, id: 1n, timestamp: 100, mode: 0, licenceActive: false, byHolder: false,
  zeroForOne: true, depositIn0: false, sender: address, beneficiary: address, rebateTo: address,
  deposit: 10n, amount0: -1_000n, amount1: 1_000n,
  sqrtPriceBeforeX96: 1n << 96n, sqrtPriceAfterX96: 1n << 96n, liquidityBefore: 1_000n,
  swapFeePips: 500,
};
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function statePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "touchstone-keeper-state-"));
  dirs.push(dir);
  return join(dir, "state.json");
}

describe("record fee snapshot persistence", () => {
  it.each([0, 500, 1_000_000, 2 ** 24 - 1])("preserves ABI uint24 fee %s", (swapFeePips) => {
    const path = statePath();
    const state = { nextBlock: 10n, open: [{ ...record, swapFeePips }] };
    saveState(path, state);
    expect(loadState(path, 0n)).toEqual(state);
  });

  it.each([-1, 0.5, 2 ** 24])("rejects invalid snapshot %s instead of substituting the current fee", (swapFeePips) => {
    const path = statePath();
    saveState(path, { nextBlock: 10n, open: [{ ...record, swapFeePips }] });
    expect(() => loadState(path, 0n)).toThrow();
  });

  it("rejects an old open record without a fee snapshot rather than silently changing its commitment", () => {
    const path = statePath();
    const { swapFeePips: _fee, ...oldRecord } = record;
    saveState(path, { nextBlock: 10n, open: [oldRecord as TouchstoneRecord] });
    expect(() => loadState(path, 0n)).toThrow();
  });
});
