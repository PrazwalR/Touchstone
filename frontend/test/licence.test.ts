import { afterEach, describe, expect, it, vi } from "vitest";
import { licencePageSchema, licenceSummarySchema, readHistory } from "../src/chain/history.ts";
import { licenceTimeline, rentPerHour } from "../src/chain/licence.ts";

afterEach(() => vi.unstubAllGlobals());
const none = { owner: `0x${"00".repeat(20)}`, since: 0, swapper: `0x${"00".repeat(20)}`, rent: 0n, deposit: 0n };
const holder = { owner: `0x${"11".repeat(20)}`, since: 1_000, swapper: `0x${"12".repeat(20)}`, rent: 10n, deposit: 3_605n };

describe("licence timeline", () => {
  it("lapses at since + deposit / rent, rounding down to whole seconds of rent", () => {
    const t = licenceTimeline(holder, none, 60);
    expect(t).toEqual({ live: true, lapsesAt: 1_360n, activatesAt: null, displaces: false });
  });
  it("activates a pending bid k seconds after it was placed, and says when it displaces the holder", () => {
    const early = licenceTimeline(holder, { ...holder, since: 1_100, rent: 20n }, 60);
    expect(early.activatesAt).toBe(1_160n);
    expect(early.displaces).toBe(true);
    const late = licenceTimeline(holder, { ...holder, since: 1_350, rent: 20n }, 60);
    expect(late.displaces).toBe(false);
  });
  it("reads an empty auction as no licence", () => {
    expect(licenceTimeline(none, none, 60)).toEqual({ live: false, lapsesAt: null, activatesAt: null, displaces: false });
    expect(licenceTimeline(none, { ...holder, since: 5 }, 60)).toEqual({ live: false, lapsesAt: null, activatesAt: 65n, displaces: false });
  });
  it("shows rent per hour without floating point", () => expect(rentPerHour(2n ** 100n)).toBe(2n ** 100n * 3_600n));
});

describe("licence history boundary", () => {
  const summary = {
    chain: "arbitrum-sepolia",
    poolId: `0x${"ab".repeat(32)}`,
    label: "measured indexed events",
    counts: { BidPlaced: 1, LeaseActivated: 1, LeaseLapsed: 0, RentCharged: 2, RentCredited: 1, SwapperSet: 0, DepositChanged: 0, LicensedSwap: 3, RefundCredited: 0, RefundClaimed: 0 },
    rentCharged: (2n ** 200n + 7n).toString(),
    rentCredited: (2n ** 200n).toString(),
    toRebatePool: "1",
    toVesting: "2",
    rentInFlight: "7",
    lastActivation: { tx: `0x${"cd".repeat(32)}`, block: "11", args: { rent: "5" } },
    lastLapse: null,
  };
  it("keeps uint256 totals as exact strings", () => {
    const parsed = licenceSummarySchema.parse(summary);
    expect(BigInt(parsed.rentCharged) - BigInt(parsed.rentCredited)).toBe(7n);
  });
  it("rejects relabelled or extended summaries", () => {
    expect(() => licenceSummarySchema.parse({ ...summary, label: "simulation" })).toThrow();
    expect(() => licenceSummarySchema.parse({ ...summary, extra: 1 })).toThrow();
  });
  it("rejects record events in the licence page", () => {
    const item = { tx: `0x${"ab".repeat(32)}`, logIndex: 0, block: "1", args: {} };
    const page = { chain: "arbitrum-sepolia", label: "measured indexed events", limit: 12, offset: 0 };
    expect(licencePageSchema.parse({ ...page, items: [{ ...item, name: "RentCharged" }] }).items).toHaveLength(1);
    expect(() => licencePageSchema.parse({ ...page, items: [{ ...item, name: "Settled" }] })).toThrow();
  });
  it("routes the summary through its own schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => summary }));
    const got = await readHistory("https://api.example", `licence/summary?poolId=${summary.poolId}`, "arbitrum-sepolia", new AbortController().signal);
    expect(licenceSummarySchema.parse(got).rentInFlight).toBe("7");
  });
});
