import { describe, expect, it, vi, afterEach } from "vitest";
import { pageSchema, readHistory } from "../src/chain/history.ts";
afterEach(() => vi.unstubAllGlobals());
describe("history boundary", () => {
  const body = { chain: "arbitrum-sepolia", label: "measured indexed events", limit: 20, offset: 0, items: [{ tx: `0x${"ab".repeat(32)}`, logIndex: 0, block: "324756338", name: "Settled", args: { fairPriceX36: "1000000000000000000000000000000000000", payout: { refund: "123456789123456789" } } }] };
  it("preserves payout strings without coercing to unsafe numbers", () => expect(pageSchema.parse(body).items[0].args).toEqual(body.items[0].args));
  it("rejects malformed transaction links and unknown top-level fields", () => {
    expect(() => pageSchema.parse({ ...body, injected: true })).toThrow();
    expect(() => pageSchema.parse({ ...body, items: [{ ...body.items[0], tx: "javascript:alert(1)" }] })).toThrow();
  });
  it("rejects a valid payload from the wrong chain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...body, chain: "base-sepolia" }) }));
    await expect(readHistory("https://api.example", "records?limit=20", "arbitrum-sepolia", new AbortController().signal)).rejects.toThrow("different chain");
  });
});
