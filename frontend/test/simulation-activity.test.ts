import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { SimulationActivity } from "../src/components/SimulationActivity.tsx";
import { swapContext } from "../src/swap/context.ts";
import type { SwapResult } from "../src/swap/swap.ts";

const hash = `0x${"11".repeat(32)}` as const;
const entry = { hash, side: "buy" as const };
const time = 1_800_000_000;
const result = {
  hash, receipt: { logs: [], blockNumber: 10n }, paid: 6_000_000n, received: 3_000_000_000_000n,
  record: { poolId: swapContext.poolId, id: 3n, timestamp: time, deposit: 20_000_000n, depositIn0: true, mode: 0 },
} as unknown as SwapResult;
const render = (value: SwapResult) => renderToStaticMarkup(createElement(SimulationActivity, { entry, confirmed: value }));
afterEach(() => vi.useRealTimers());

it("reveals the confirmed swap before its delayed deposit review", () => {
  vi.useFakeTimers();
  vi.setSystemTime((time + 2) * 1000);
  expect(render(result)).toContain("Swap confirmed");
  expect(render(result)).not.toContain("flagged for settlement review");
  vi.setSystemTime((time + 3) * 1000);
  expect(render(result)).toContain("Trade flagged for settlement review");
  expect(render(result)).toContain("did not record individual trigger reasons");
});
it("finishes a swap without a deposit immediately", () => {
  const receipt = render({ ...result, record: null });
  expect(receipt).toContain("collected no deposit");
  expect(receipt).not.toContain("Trade flagged");
});
