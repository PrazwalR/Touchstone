import { describe, expect, it } from "vitest";
import { nextAction, RecordBook } from "../src/schedule.ts";
import { keeperEnvSchema } from "../src/config.ts";
import type { TouchstoneRecord } from "@touchstone/shared";

const w = { t0: 100n, latest: 110n, expiresAt: 100n + 86_400n };

describe("nextAction", () => {
  it("waits before t0", () => expect(nextAction(w, 99n)).toEqual({ kind: "wait", until: 100n }));
  it("settles from t0 to latest", () => {
    expect(nextAction(w, 100n).kind).toBe("settle");
    expect(nextAction(w, 110n).kind).toBe("settle");
  });
  it("continues settlement attempts after latest publish time", () => expect(nextAction(w, 111n).kind).toBe("settle"));
  it("expires from expiresAt", () => expect(nextAction(w, w.expiresAt).kind).toBe("expire"));
});

describe("RecordBook", () => {
  const r = { poolId: "0xAB", id: 1n } as unknown as TouchstoneRecord;
  it("ingests a record once", () => {
    const book = new RecordBook();
    expect(book.add(r)).toBe(true);
    expect(book.add({ ...r, poolId: "0xab" } as TouchstoneRecord)).toBe(false);
    book.close(r);
    expect(book.open()).toHaveLength(0);
  });
});

describe("keeper config", () => {
  it("rejects a missing financial parameter instead of defaulting it", () => {
    const parsed = keeperEnvSchema.safeParse({ KEEPER_CHAIN: "arbitrum-sepolia" });
    expect(parsed.success).toBe(false);
  });
});
